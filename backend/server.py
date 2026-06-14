import argparse
import hmac
import json
import re
import socket
import sys
import hashlib
import threading
import socketserver
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from .routes_common import GET_ROUTES, POST_ROUTES
from .routes_backup import BackupRoutesMixin
from .routes_browser import BrowserRoutesMixin
from .routes_file import FileRoutesMixin
from .routes_git import GitRoutesMixin
from .routes_settings import SettingsRoutesMixin
from .routes_watch import WatchRoutesMixin
from . import config

def check_static_changed(last_state):
    return config.check_static_changed(last_state)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

class LimitThreadPoolMixIn:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._thread_semaphore = threading.Semaphore(100)

    def process_request(self, request, client_address):
        if not self._thread_semaphore.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n")
                request.shutdown(socket.SHUT_WR)
            except Exception:
                pass
            self.shutdown_request(request)
            return
        t = threading.Thread(target=self._process_request_wrapper, args=(request, client_address))
        t.daemon = self.daemon_threads
        t.start()

    def _process_request_wrapper(self, request, client_address):
        try:
            self.process_request_thread(request, client_address)
        finally:
            self._thread_semaphore.release()

class ThreadLimitedHTTPServer(LimitThreadPoolMixIn, socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


def cleanup_temp_files():
    def bg_cleanup():
        # Architecture decision: Run cleanup on a background thread to avoid blocking server boot.
        try:
            sandbox_root, shared_root = config.get_roots()
            temp_pattern = re.compile(r"^.*\.[0-9a-f]{8}\.tmp$")
            
            # Recursively purge in Termux home sandbox root (typically smaller and faster to walk)
            if sandbox_root.exists():
                for p in sandbox_root.rglob("*.tmp"):
                    if temp_pattern.match(p.name):
                        try:
                            p.unlink()
                        except Exception as e:
                            sys.stderr.write(f"Failed to delete temp file {p}: {e}\n")
            
            # Scan top-level and first-level directories in shared storage to avoid walking Android data folders
            if shared_root.exists():
                for p in shared_root.glob("*.tmp"):
                    if temp_pattern.match(p.name):
                        try:
                            p.unlink()
                        except Exception as e:
                            sys.stderr.write(f"Failed to delete temp file {p}: {e}\n")
                for sub in shared_root.iterdir():
                    try:
                        if sub.is_dir() and not sub.name.startswith("."):
                            for p in sub.glob("*.tmp"):
                                if temp_pattern.match(p.name):
                                    try:
                                        p.unlink()
                                    except Exception as e:
                                        sys.stderr.write(f"Failed to delete temp file {p}: {e}\n")
                    except Exception:
                        pass
        except Exception as e:
            sys.stderr.write(f"Temp file cleanup error: {e}\n")
            
    threading.Thread(target=bg_cleanup, daemon=True).start()

class BaseEditorHandler(BaseHTTPRequestHandler):

    def setup(self):
        super().setup()
        self.connection.settimeout(30.0)

        self._csp_sent = False

    def _resolve_and_validate(self, path_str):
        sandbox_root, shared_root = config.get_roots()
        if path_str == "termux_home" or path_str.startswith("termux_home/"):
            rel = path_str[11:].lstrip("/")
            resolved = (sandbox_root / rel).resolve()
        elif path_str == "storage_shared" or path_str.startswith("storage_shared/"):
            rel = path_str[14:].lstrip("/")
            resolved = (shared_root / rel).resolve()
        else:
            resolved = (sandbox_root / path_str.lstrip("/")).resolve()
        if not config.is_in_sandbox(resolved):
            raise PermissionError("Path traversal detected")
        return resolved

    def _get_backup_prefix(self, file_path):
        try:
            sandbox_root, shared_root = config.get_roots()
            try:
                rel = file_path.relative_to(sandbox_root)
            except ValueError:
                rel = file_path.relative_to(shared_root)
            h = hashlib.sha256(str(rel).encode("utf-8")).hexdigest()[:8]
            return f"MODIE_{h}"
        except Exception:
            try:
                h = hashlib.sha256(str(file_path.resolve()).encode("utf-8")).hexdigest()[:8]
                return f"MODIE_{h}"
            except Exception:
                return "MODIE_generic"


    def _check_auth(self):
        token = self.headers.get("X-Editor-Token")
        if token and hmac.compare_digest(token, config.SESSION_TOKEN):
            return True
        query = urlparse(self.path).query
        params = parse_qs(query)
        if "token" in params and hmac.compare_digest(params["token"][0], config.SESSION_TOKEN):
            return True
        return False

    def log_message(self, format, *args):
        message = format % args
        message = re.sub(r"token=[a-zA-Z0-9]+", "token=[REDACTED]", message)
        # Security constraint: Sanitize control characters and non-printable characters to prevent log injection.
        sanitized = "".join(c if (32 <= ord(c) <= 126) else f"\\x{ord(c):02x}" for c in message)
        sys.stderr.write(f"[{datetime.now().strftime('%H:%M:%S')}] {sanitized}\n")

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):

        if not self._csp_sent:
            self._csp_sent = True
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
        super().end_headers()

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        return self.rfile.read(length)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in GET_ROUTES:
            route_info = GET_ROUTES[path]
            if route_info["require_auth"] and not self._check_auth():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            route_info["handler"](self)
        elif path.startswith("/static/"):
            self._serve_static(path)
        else:
            self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path in POST_ROUTES:
            route_info = POST_ROUTES[path]
            if route_info["require_auth"] and not self._check_auth():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            if path.startswith("/api/"):
                try:
                    length = int(self.headers.get("Content-Length", 0))
                except ValueError:
                    self.send_error(400, "Invalid Content-Length")
                    return
                if length > 5 * 1024 * 1024:
                    self.send_error(413, "Payload Too Large")
                    return
            route_info["handler"](self)
        else:
            self.send_error(404)

    def _serve_static(self, path_str):
        static_dir = (Path(__file__).parent.parent / "static").resolve()
        rel_path = path_str.lstrip("/")
        file_path = (Path(__file__).parent.parent / rel_path).resolve()
        try:
            file_path.relative_to(static_dir)
        except ValueError:
            self.send_error(403, "Forbidden")
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        mime_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".ico": "image/x-icon",
            ".svg": "image/svg+xml",
        }
        ext = file_path.suffix.lower()
        content_type = mime_types.get(ext, "application/octet-stream")
        self._serve_file_no_cache(file_path, content_type)

    def _serve_file_no_cache(self, file_path, content_type):
        try:
            file_size = file_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()

            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception as e:
            self.send_error(500, f"Server Error: {e}")

# Statically declare EditorHandler with explicit mixins to enable static analysis, auto-completion, and direct route visibility without dynamic reflection.
class EditorHandler(
    BackupRoutesMixin,
    BrowserRoutesMixin,
    FileRoutesMixin,
    GitRoutesMixin,
    SettingsRoutesMixin,
    WatchRoutesMixin,
    BaseEditorHandler
):
    pass

def main():
    config.init_config()
    resolved_backup_dir = config.BACKUP_DIR.resolve()
    if not config.is_in_sandbox(resolved_backup_dir):
        raise PermissionError("Path traversal detected")
    resolved_backup_dir.mkdir(parents=True, exist_ok=True)
    cleanup_temp_files()
    parser = argparse.ArgumentParser(description="MODiE Server")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--dev", action="store_true", help="Run in development mode with hot-reload and SW bypass")
    args = parser.parse_args()
    config.DEV_MODE = args.dev
    if not config.DEFAULT_MD_PATH.exists():
        print(f"Warning: {config.DEFAULT_MD_PATH} does not exist. It will be created on first save.")

    for path, info in GET_ROUTES.items():
        assert callable(info["handler"]), f"GET route {path} handler is not callable"
    for path, info in POST_ROUTES.items():
        assert callable(info["handler"]), f"POST route {path} handler is not callable"
    num_get = len(GET_ROUTES)
    num_post = len(POST_ROUTES)
    num_modules = len(set(info["handler"].__module__ for info in (list(GET_ROUTES.values()) + list(POST_ROUTES.values()))))
    print(f"Registered {num_get + num_post} routes ({num_get} GET, {num_post} POST) from {num_modules} modules")

    local_ip = get_local_ip()
    server = ThreadLimitedHTTPServer((args.host, args.port), EditorHandler)
    server.daemon_threads = True
    local_url = f"http://localhost:{args.port}/?token={config.SESSION_TOKEN}"
    net_url = f"http://{local_ip}:{args.port}/?token={config.SESSION_TOKEN}"
    file_path = str(config.DEFAULT_MD_PATH)
    print("=" * 80)
    print(" MODiE Server Running")
    print("=" * 80)
    print(f" File:    {file_path}")
    print(f" Local:   {local_url}")
    print(f" Network: {net_url}")
    print("=" * 80)
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()

if __name__ == "__main__":
    main()

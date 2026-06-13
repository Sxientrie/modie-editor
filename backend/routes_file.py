import os
import secrets
import shutil
import time
from datetime import datetime
from pathlib import Path

from . import config
from .routes_common import get_route, post_route, validate_json
from .file_ops import atomic_write, create_backup
from .routes_backup import get_backup_settings, cleanup_backups


_MAX_READ_SIZE = 10 * 1024 * 1024

class FileRoutesMixin:

    @get_route("/", require_auth=False)
    def _serve_editor(self):
        html_path = Path(__file__).parent.parent / "static" / "index.html"
        if not html_path.exists():
            self.send_error(500, "static/index.html not found")
            return
        if config.DEV_MODE:
            content = html_path.read_text("utf-8")
            dev_script = """
            <script>
            (function() {
                console.log("[MODiE Dev] Hot-Reload client active");
                const devWatch = new EventSource("/api/dev-watch");
                devWatch.onmessage = function(e) {
                    if (e.data === "reload") {
                        console.log("[MODiE Dev] Asset changed. Reloading...");
                        setTimeout(() => window.location.reload(), 100);
                    }
                };
                devWatch.onerror = function() {
                    devWatch.close();
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                };
            })();
            </script>
            """
            content = content.replace("</body>", f"{dev_script}</body>")
            body = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(body)
            return
        self._serve_file_no_cache(html_path, "text/html; charset=utf-8")

    @get_route("/sw.js", require_auth=False)
    def _serve_sw(self):
        if config.DEV_MODE:
            body = b"""self.addEventListener("install", (e) => {
    self.skipWaiting();
});
self.addEventListener("activate", (e) => {
    e.waitUntil(clients.claim());
});
self.addEventListener("fetch", (e) => {
    e.respondWith(fetch(e.request));
});
"""
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(body)
            return
        sw_path = Path(__file__).parent.parent / "static" / "sw.js"
        if not sw_path.exists():
            self.send_error(500, "static/sw.js not found")
            return
        self._serve_file_no_cache(sw_path, "application/javascript; charset=utf-8")

    @get_route("/api/content")
    def _api_get_content(self):
        from urllib.parse import urlparse, parse_qs
        params = parse_qs(urlparse(self.path).query)
        file_param = params.get("path", [""])[0]
        try:
            file_path = self._resolve_and_validate(file_param) if file_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        with config.get_path_lock(file_path):
            try:
                if not file_path.exists():
                    self._send_json({"content": "", "modified": "", "size": 0})
                    return
                stat = file_path.stat()
                if stat.st_size > _MAX_READ_SIZE:
                    self._send_json({"error": f"File too large to open ({stat.st_size:,} bytes). Maximum is {_MAX_READ_SIZE:,} bytes."}, 413)
                    return
                content = file_path.read_text("utf-8")
                mod_time = datetime.fromtimestamp(stat.st_mtime).isoformat()
                self._send_json({"content": content, "modified": mod_time, "size": stat.st_size})
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot read this file"}, 403)
            except Exception as e:
                self._send_json({"error": f"Failed to read file: {e}"}, 500)

    @post_route("/api/content")
    @validate_json(["path", "content"])
    def _api_save_content(self):
        file_param = self.request_data["path"]
        content = self.request_data["content"]
        try:
            file_path = self._resolve_and_validate(file_param) if file_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        incoming_modified = self.request_data.get("modified")
        with config.get_path_lock(file_path):
            try:
                if file_path.exists() and incoming_modified:
                    try:
                        disk_mtime = file_path.stat().st_mtime
                        disk_mtime_iso = datetime.fromtimestamp(disk_mtime).isoformat()
                        if incoming_modified != disk_mtime_iso:
                            try:
                                incoming_ts = datetime.fromisoformat(incoming_modified).timestamp()
                                if abs(incoming_ts - disk_mtime) > 0.002:
                                    self._send_json({"error": "Conflict: File has been modified on disk"}, 409)
                                    return
                            except (ValueError, OSError):
                                self._send_json({"error": "Conflict: File has been modified on disk"}, 409)
                                return
                    except OSError:
                        pass
                if file_path.exists():
                    prefix = self._get_backup_prefix(file_path)
                    create_backup(file_path, config.BACKUP_DIR, prefix)
                    max_count, max_age = get_backup_settings()
                    cleanup_backups(file_path, prefix, max_count, max_age)
                    with config.LAST_SAVE_LOCK:
                        config.LAST_SAVE_TIMES[str(file_path.resolve())] = time.time()
                    config.prune_last_save_times()
                atomic_write(file_path, content)
                stat = file_path.stat()
                new_mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
                self._send_json({"ok": True, "modified": new_mtime, "size": stat.st_size})
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot write to this file"}, 403)
            except Exception as e:
                self._send_json({"error": f"Failed to save file: {e}"}, 500)

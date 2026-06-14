import json
import mimetypes
import os
import re
from pathlib import Path
from . import config
from .routes_common import get_route, post_route, validate_json, validate_query
from .file_ops import atomic_write

def is_binary(file_path):
    try:
        mime, _ = mimetypes.guess_type(str(file_path))
        if mime:
            if mime.startswith("text/") or mime in ("application/json", "application/javascript", "image/svg+xml"):
                return False
            if mime.startswith("image/") or mime.startswith("audio/") or mime.startswith("video/") or mime.startswith("application/"):
                return True
        with open(file_path, "rb") as f:
            chunk = f.read(1024)
            if not chunk:
                return False
            if chunk.startswith((b"\xff\xfe", b"\xfe\xff")):
                return False
            if b"\x00" in chunk:
                return True
            control_chars = sum(1 for byte in chunk if byte < 32 and byte not in (9, 10, 13))
            if control_chars / len(chunk) > 0.30:
                return True
            return False
    except Exception:
        return True

class SettingsRoutesMixin:

    @get_route("/api/settings")
    def _api_get_settings(self):
        with config.SETTINGS_LOCK:
            if config.SETTINGS_FILE.exists():
                try:
                    data = json.loads(config.SETTINGS_FILE.read_text("utf-8"))
                except Exception:
                    data = {}
            else:
                data = {}
        defaults = {
            "theme": "dark",
            "zoom": 14,
            "show_hidden": False,
            "show_all": False,
            "auto_save_delay": 500,
            "word_wrap": True,
            "browser_density": "normal",
            "ignored_dirs": "node_modules, venv, .venv, __pycache__, dist, build, target",
            "backup_max_count": 10,
            "backup_max_age_days": 30
        }
        for k, v in defaults.items():
            if k not in data:
                data[k] = v
        self._send_json(data)

    @post_route("/api/settings")
    @validate_json()
    def _api_save_settings(self):
        data = self.request_data
        allowed = {
            "theme": lambda v: v in ("dark", "light"),
            "zoom": lambda v: isinstance(v, int) and 10 <= v <= 28,
            "show_hidden": lambda v: isinstance(v, bool),
            "show_all": lambda v: isinstance(v, bool),
            "auto_save_delay": lambda v: isinstance(v, int) and v >= 0,
            "word_wrap": lambda v: isinstance(v, bool),
            "browser_density": lambda v: v in ("compact", "normal", "large"),
            "ignored_dirs": lambda v: isinstance(v, str) and len(v) < 500,
            "backup_max_count": lambda v: isinstance(v, int) and 1 <= v <= 100,
            "backup_max_age_days": lambda v: isinstance(v, int) and 1 <= v <= 365
        }
        validated = {k: v for k, v in data.items() if k in allowed and allowed[k](v)}
        with config.SETTINGS_LOCK:
            try:
                atomic_write(config.SETTINGS_FILE, json.dumps(validated))
            except Exception as e:
                self._send_json({"error": f"Failed to save settings: {e}"}, 500)
                return
        self._send_json({"ok": True})

    @get_route("/api/search")
    @validate_query(["query", "path"])
    def _api_search_files(self):
        query = self.query_params["query"]
        path_str = self.query_params["path"]
        case_sensitive = self.query_params.get("case_sensitive", "false").lower() == "true"
        is_regex = self.query_params.get("regex", "false").lower() == "true"
        pattern = None
        query_clean = None
        if not query:
            self._send_json({"results": []})
            return
        try:
            dir_path = self._resolve_and_validate(path_str)
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        if not dir_path.exists() or not dir_path.is_dir():
            self._send_json({"error": "Directory not found"}, 404)
            return
        if is_regex:
            try:
                flags = 0 if case_sensitive else re.IGNORECASE
                pattern = re.compile(query, flags)
            except Exception as e:
                self._send_json({"error": f"Invalid regex: {e}"}, 400)
                return
        else:
            if not case_sensitive:
                query_clean = query.lower()
            else:
                query_clean = query
        with config.SETTINGS_LOCK:
            if config.SETTINGS_FILE.exists():
                try:
                    settings_data = json.loads(config.SETTINGS_FILE.read_text("utf-8"))
                except Exception:
                    settings_data = {}
            else:
                settings_data = {}
        ignored_dirs_str = settings_data.get("ignored_dirs", "node_modules, venv, .venv, __pycache__, dist, build, target")
        ignored_dirs = [d.strip() for d in ignored_dirs_str.split(",") if d.strip()]
        show_hidden = self.query_params.get("show_hidden", "").lower()
        if show_hidden == "":
            show_hidden = settings_data.get("show_hidden", False)
        else:
            show_hidden = show_hidden == "true"
        show_all = self.query_params.get("show_all", "").lower()
        if show_all == "":
            show_all = settings_data.get("show_all", False)
        else:
            show_all = show_all == "true"
        import threading
        import time
        import select
        import socket

        results = []
        status = {"done": False, "error": None, "cancel": False}

        def run_search_thread():
            try:
                sandbox_root, shared_root = config.get_roots()
                limit = 200
                count = 0
                file_counter = 0
                for root, dirs, files in os.walk(dir_path):
                    if status["cancel"]:
                        break
                    if not show_hidden:
                        dirs[:] = [d for d in dirs if not d.startswith('.') and d != ".modie" and d not in ignored_dirs]
                    else:
                        dirs[:] = [d for d in dirs if d != ".modie" and d not in ignored_dirs]
                    for file in files:
                        if status["cancel"]:
                            break
                        file_counter += 1
                        if file_counter % 50 == 0:
                            time.sleep(0.002)
                        if (not show_hidden and file.startswith(".")) or file.endswith(".tmp"):
                            continue
                        ext = Path(file).suffix.lower()
                        if not show_all and ext not in (".md", ".txt", ".js", ".css", ".html", ".json"):
                            continue
                        file_path = Path(root) / file
                        try:
                            stat = file_path.stat()
                            if stat.st_size > 1 * 1024 * 1024:
                                continue
                            if is_binary(file_path):
                                continue
                            content = file_path.read_text("utf-8", errors="ignore")
                        except Exception:
                            continue
                        lines = content.splitlines()
                        for idx, line in enumerate(lines):
                            matched = bool(pattern.search(line)) if is_regex else (query_clean in (line if case_sensitive else line.lower()))
                            if matched:
                                rel_path = None
                                try:
                                    rel = file_path.relative_to(sandbox_root)
                                    rel_path = "termux_home/" + str(rel) if str(rel) != "." else "termux_home"
                                except ValueError:
                                    try:
                                        rel = file_path.relative_to(shared_root)
                                        rel_path = "storage_shared/" + str(rel) if str(rel) != "." else "storage_shared"
                                    except ValueError:
                                        pass
                                if rel_path:
                                    results.append({
                                        "path": rel_path,
                                        "filename": file,
                                        "line": idx + 1,
                                        "text": line.strip()[:100]
                                    })
                                    count += 1
                                    if count >= limit:
                                        break
                        if count >= limit:
                            break
                    if count >= limit:
                        break
            except Exception as e:
                status["error"] = str(e)
            finally:
                status["done"] = True

        # Run recursive directory search on a background thread to prevent blocking request connection thread
        t = threading.Thread(target=run_search_thread, daemon=True)
        t.start()

        while not status["done"]:
            time.sleep(0.01)
            # Check if client connection has disconnected to abort the background search thread immediately
            if hasattr(self, "connection") and self.connection is not None:
                try:
                    r, _, _ = select.select([self.connection], [], [], 0)
                    if r:
                        # Architectural decision: Any readability (new data or EOF) on a GET request
                        # socket indicates the client has either disconnected or reused the socket
                        # for a new request. In either case, the current search is cancelled.
                        status["cancel"] = True
                        break
                except Exception:
                    status["cancel"] = True
                    break

        if status["cancel"]:
            return

        if status["error"]:
            self._send_json({"error": status["error"]}, 500)
            return

        self._send_json({"results": results})

import os
import secrets
import shutil
import sys
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
                let currentBootId = null;
                const devWatch = new EventSource("/api/dev-watch");
                devWatch.onmessage = function(e) {
                    if (e.data.startsWith("boot_")) {
                        const newBootId = e.data.substring(5);
                        if (currentBootId && currentBootId !== newBootId) {
                            console.log("[MODiE Dev] Server restarted. Reloading...");
                            window.location.reload();
                        }
                        currentBootId = newBootId;
                    } else if (e.data === "reload") {
                        console.log("[MODiE Dev] Asset changed. Reloading...");
                        setTimeout(() => window.location.reload(), 100);
                    }
                };
                devWatch.onerror = function() {
                    // Let EventSource automatically reconnect; only reload if the server restarts.
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
        if not isinstance(file_param, str) or not isinstance(content, str):
            self._send_json({"error": "Invalid payload types: 'path' and 'content' must be strings"}, 400)
            return
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
                                sandbox_root, shared_root = config.get_roots()
                                try:
                                    file_path.relative_to(shared_root)
                                    # Emulated SD card storage (exFAT/FAT32) uses 1-2s timestamp resolution.
                                    # We allow disk_mtime to be older due to truncation (up to 2.0s),
                                    # but flag a conflict if disk_mtime is newer (> 0.002s) indicating another write.
                                    is_conflict = (disk_mtime - incoming_ts > 0.002) or (incoming_ts - disk_mtime > 2.0)
                                except ValueError:
                                    # Internal Termux home ext4 storage uses millisecond resolution
                                    is_conflict = abs(incoming_ts - disk_mtime) > 0.002
                                if is_conflict:
                                    try:
                                        if file_path.read_text("utf-8", errors="ignore") == content:
                                            is_conflict = False
                                    except Exception:
                                        pass
                                if is_conflict:
                                    self._send_json({"error": "Conflict: File has been modified on disk"}, 409)
                                    return
                            except (ValueError, OSError):
                                try:
                                    if file_path.read_text("utf-8", errors="ignore") == content:
                                        pass
                                    else:
                                        self._send_json({"error": "Conflict: File has been modified on disk"}, 409)
                                        return
                                except Exception:
                                    self._send_json({"error": "Conflict: File has been modified on disk"}, 409)
                                    return
                    except OSError:
                        pass
                backup_warning = None
                if file_path.exists():
                    prefix = self._get_backup_prefix(file_path)
                    try:
                        create_backup(file_path, config.BACKUP_DIR, prefix)
                        max_count, max_age = get_backup_settings()
                        cleanup_backups(file_path, prefix, max_count, max_age)
                    except Exception as backup_err:
                        # Log the backup failure to stderr and capture it as a warning so file save does not fail completely.
                        sys.stderr.write(f"Backup warning for {file_path}: {backup_err}\n")
                        backup_warning = f"Backup failed: {backup_err}"
                    with config.LAST_SAVE_LOCK:
                        config.LAST_SAVE_TIMES[str(file_path.resolve())] = time.time()
                    config.prune_last_save_times()
                atomic_write(file_path, content)
                stat = file_path.stat()
                new_mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
                response_data = {"ok": True, "modified": new_mtime, "size": stat.st_size}
                if backup_warning:
                    response_data["warning"] = backup_warning
                self._send_json(response_data)
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot write to this file"}, 403)
            except Exception as e:
                self._send_json({"error": f"Failed to save file: {e}"}, 500)

    @post_route("/api/verify-drafts")
    @validate_json(["paths"])
    def _api_verify_drafts(self):
        paths = self.request_data["paths"]
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            self._send_json({"error": "Invalid payload: 'paths' must be a list of strings"}, 400)
            return
        missing = []
        for p in paths:
            try:
                resolved = self._resolve_and_validate(p)
                if not resolved.exists() or not resolved.is_file():
                    missing.append(p)
            except FileNotFoundError:
                missing.append(p)
            except Exception:
                # Architectural constraint: do not mark file as missing if we cannot access
                # or validate it due to a transient permission or system/device mounting error.
                # This protects users from losing their local drafts in localStorage.
                pass
        self._send_json({"missing": missing})

import os
import secrets
import shutil
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import config
from .routes_common import get_route, post_route, validate_json
from .file_ops import atomic_write, create_backup

REPLACE_TASKS = {}
REPLACE_TASKS_LOCK = threading.Lock()


_MAX_DIR_ITEMS = 2000

_MAX_REPLACE_FILES = 500

_MAX_REPLACE_FILE_SIZE = 10 * 1024 * 1024

def _get_disk_usage(path):
    try:
        total, used, free = shutil.disk_usage(path)
        return {"total": total, "used": used, "free": free}
    except Exception:
        return None

class BrowserRoutesMixin:

    @get_route("/api/browser")
    def _api_list_directory(self):
        params = parse_qs(urlparse(self.path).query)
        dir_param = params.get("path", [""])[0]
        show_hidden = params.get("show_hidden", ["false"])[0].lower() == "true"
        show_all = params.get("show_all", ["false"])[0].lower() == "true"
        if dir_param == "":
            sandbox_root, shared_root = config.get_roots()
            sdcard_root = config.get_sdcard_root()
            storage_data = {
                "storage_shared": _get_disk_usage(shared_root)
            }
            if sdcard_root:
                storage_data["storage_external"] = _get_disk_usage(sdcard_root)

            items = [
                {
                    "name": "Termux Home (~)",
                    "isDir": True,
                    "path": "termux_home"
                },
                {
                    "name": "Internal Storage (storage)",
                    "isDir": True,
                    "path": "storage_shared"
                }
            ]
            if sdcard_root:
                items.append({
                    "name": "SD Card",
                    "isDir": True,
                    "path": "storage_external"
                })

            self._send_json({
                "currentPath": "",
                "storage": storage_data,
                "items": items
            })
            return
        try:
            dir_path = self._resolve_and_validate(dir_param)
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        try:
            if not dir_path.exists() or not dir_path.is_dir():
                self._send_json({"error": "Directory not found"}, 404)
                return
        except PermissionError:
            self._send_json({"error": "Permission denied: Access to this directory is restricted"}, 403)
            return
        limit = params.get("limit", ["100"])[0]
        offset = params.get("offset", ["0"])[0]
        try:
            limit_val = max(0, int(limit))
        except ValueError:
            limit_val = 100
        try:
            offset_val = max(0, int(offset))
        except ValueError:
            offset_val = 0
        
        entries = []
        try:
            # Use os.scandir to retrieve directory entries and types without executing stat() system calls
            with os.scandir(dir_path) as it:
                for entry in it:
                    if not show_hidden and entry.name.startswith("."):
                        continue
                    is_dir = entry.is_dir(follow_symlinks=False)
                    if not show_all and not is_dir and not entry.name.lower().endswith((".md", ".txt", ".js", ".css", ".html", ".json")):
                        continue
                    entries.append(entry)
        except PermissionError:
            self._send_json({"error": "Permission denied: Cannot read directory contents"}, 403)
            return
        except Exception as e:
            self._send_json({"error": f"Failed to list directory: {e}"}, 500)
            return
            
        entries.sort(key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
        total_count = len(entries)
        paginated_entries = entries[offset_val : offset_val + limit_val]
        
        items = []
        for entry in paginated_entries:
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                # stat() is only called on the paginated slice of files displayed to the user
                stat = entry.stat(follow_symlinks=False)
                items.append({
                    "name": entry.name,
                    "isDir": is_dir,
                    "path": f"{dir_param}/{entry.name}",
                    "size": stat.st_size if not is_dir else 0,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
            except Exception:
                pass
                
        response = {
            "currentPath": dir_param,
            "items": items,
            "total_count": total_count,
            "offset": offset_val,
            "limit": limit_val
        }
        self._send_json(response)

    @post_route("/api/create")
    @validate_json(["path", "name", "is_dir"])
    def _api_create_item(self):
        path_str = self.request_data["path"]
        name = self.request_data["name"]
        is_dir = self.request_data["is_dir"]

        if not name or "/" in name or "\\" in name or "\x00" in name or name in (".", ".."):
            self._send_json({"error": "Invalid item name"}, 400)
            return
        try:
            parent_path = self._resolve_and_validate(path_str) if path_str else config.DEFAULT_MD_PATH.parent
            target_path = (parent_path / name).resolve()


            if not config.is_in_sandbox(target_path):
                raise PermissionError("Path traversal detected")
        except (PermissionError, ValueError) as e:
            self._send_json({"error": f"Invalid path: {e}"}, 403)
            return
        with config.get_path_lock(target_path):
            try:
                if target_path.exists():
                    self._send_json({"error": "Item already exists"}, 400)
                    return
                if is_dir:
                    target_path.mkdir(parents=True, exist_ok=True)
                else:
                    atomic_write(target_path, "")
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot write to this location"}, 403)
                return
            except Exception as e:
                self._send_json({"error": f"Failed to create: {e}"}, 500)
                return
        self._send_json({"ok": True})

    @post_route("/api/delete")
    @validate_json(["path"])
    def _api_delete_item(self):
        path_str = self.request_data["path"]
        try:
            target_path = self._resolve_and_validate(path_str)
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        if self._is_protected_path(target_path):
            self._send_json({"error": "Permission denied: Cannot modify system configuration directory"}, 403)
            return
        sandbox_root, shared_root = config.get_roots()
        if target_path in (sandbox_root, shared_root):
            # Safeguard to prevent recursive deletion of home directory or shared storage roots
            self._send_json({"error": "Permission denied: Cannot delete sandbox root directory"}, 403)
            return
        with config.get_path_lock(target_path):
            try:
                if not target_path.exists():
                    self._send_json({"error": "Item not found"}, 404)
                    return
                if target_path.is_dir():
                    shutil.rmtree(target_path)
                else:
                    target_path.unlink()
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot delete this item"}, 403)
                return
            except Exception as e:
                self._send_json({"error": f"Failed to delete: {e}"}, 500)
                return
        self._send_json({"ok": True})

    @post_route("/api/rename")
    @validate_json(["path", "new_path"])
    def _api_rename_item(self):
        path_str = self.request_data["path"]
        new_path_str = self.request_data["new_path"]
        try:
            src_path = self._resolve_and_validate(path_str)
            dest_path = self._resolve_and_validate(new_path_str)
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        if self._is_protected_path(src_path) or self._is_protected_path(dest_path):
            self._send_json({"error": "Permission denied: Cannot rename or move system configuration directory"}, 403)
            return
        sandbox_root, shared_root = config.get_roots()
        if src_path in (sandbox_root, shared_root) or dest_path in (sandbox_root, shared_root):
            # Safeguard to prevent moving or clobbering home directory or shared storage roots
            self._send_json({"error": "Permission denied: Cannot rename or move sandbox root directory"}, 403)
            return
        if src_path == dest_path:
            self._send_json({"error": "Destination is same as source"}, 400)
            return
        # Establish a deterministic lock acquisition order alphabetically by resolved path string to prevent deadlocks
        first_path, second_path = sorted([src_path, dest_path], key=lambda p: str(p.resolve()))
        with config.get_path_lock(first_path), config.get_path_lock(second_path):
            try:
                if not src_path.exists():
                    self._send_json({"error": "Source item not found"}, 404)
                    return
                if dest_path.exists():
                    self._send_json({"error": "Destination already exists"}, 400)
                    return
                if not dest_path.parent.exists():
                    self._send_json({"error": "Destination parent directory does not exist"}, 400)
                    return
                shutil.move(str(src_path), str(dest_path))
            except PermissionError:
                self._send_json({"error": "Permission denied: Cannot rename or move this item"}, 403)
                return
            except Exception as e:
                self._send_json({"error": f"Failed to rename: {e}"}, 500)
                return
        self._send_json({"ok": True})

    @post_route("/api/replace")
    @validate_json(["query", "replace", "files"])
    def _api_replace_files(self):
        query = self.request_data["query"]
        replace = self.request_data["replace"]
        files = self.request_data["files"]
        case_sensitive = self.request_data.get("case_sensitive", False)
        is_regex = self.request_data.get("is_regex", False)
        if not query:
            self._send_json({"error": "Query cannot be empty"}, 400)
            return

        if not isinstance(files, list):
            self._send_json({"error": "'files' must be a list"}, 400)
            return
        if len(files) > _MAX_REPLACE_FILES:
            self._send_json({"error": f"Too many files (max {_MAX_REPLACE_FILES})"}, 400)
            return
        import re
        if is_regex:
            try:
                flags = 0 if case_sensitive else re.IGNORECASE
                pattern = re.compile(query, flags)
            except Exception as e:
                self._send_json({"error": f"Invalid regex: {e}"}, 400)
                return
        else:
            if not case_sensitive:
                pattern = re.compile(re.escape(query), re.IGNORECASE)
            else:
                pattern = None

        task_id = str(uuid.uuid4())
        with REPLACE_TASKS_LOCK:
            if len(REPLACE_TASKS) > 100:
                for k in list(REPLACE_TASKS.keys())[:50]:
                    del REPLACE_TASKS[k]
            REPLACE_TASKS[task_id] = {
                "status": "running",
                "replaced_files": 0,
                "errors": []
            }

        def bg_replace():
            replaced_count = 0
            errors = []
            for f_param in files:
                if not isinstance(f_param, str):
                    errors.append("Invalid file path entry (must be a string)")
                    continue
                try:
                    file_path = self._resolve_and_validate(f_param)
                except PermissionError as e:
                    errors.append(f"Permission denied: {f_param}")
                    continue
                if not file_path.exists() or not file_path.is_file():
                    errors.append(f"File not found: {f_param}")
                    continue
                with config.get_path_lock(file_path):
                    try:
                        if file_path.stat().st_size > _MAX_REPLACE_FILE_SIZE:
                            errors.append(f"File too large to process: {f_param}")
                            continue
                        prefix = self._get_backup_prefix(file_path)
                        content = file_path.read_text("utf-8", errors="ignore")
                        if pattern:
                            new_content = pattern.sub(replace, content)
                        else:
                            new_content = content.replace(query, replace)
                        if content != new_content:
                            try:
                                create_backup(file_path, config.BACKUP_DIR, prefix)
                            except Exception as backup_err:
                                # Log the backup failure but still allow the search-and-replace to modify the target file.
                                sys.stderr.write(f"Backup warning during replace for {file_path}: {backup_err}\n")
                                errors.append(f"Backup failed for {f_param} (changes were still applied): {backup_err}")
                            atomic_write(file_path, new_content)
                            replaced_count += 1
                    except PermissionError:
                        errors.append(f"Permission denied: {f_param}")
                    except Exception as e:
                        errors.append(f"Failed to process {f_param}: {e}")
            with REPLACE_TASKS_LOCK:
                REPLACE_TASKS[task_id] = {
                    "status": "done",
                    "replaced_files": replaced_count,
                    "errors": errors
                }

        threading.Thread(target=bg_replace, daemon=True).start()
        self._send_json({"ok": True, "task_id": task_id})

    @get_route("/api/replace/status")
    def _api_replace_status(self):
        params = parse_qs(urlparse(self.path).query)
        task_id = params.get("task_id", [""])[0]
        if not task_id:
            self._send_json({"error": "Missing task_id"}, 400)
            return
        with REPLACE_TASKS_LOCK:
            task = REPLACE_TASKS.get(task_id)
        if not task:
            self._send_json({"error": "Task not found"}, 404)
            return
        self._send_json(task)

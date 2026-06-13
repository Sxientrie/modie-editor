import os
import secrets
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import config
from .routes_common import get_route, post_route, validate_json
from .file_ops import atomic_write, create_backup


_MAX_DIR_ITEMS = 2000

_MAX_REPLACE_FILES = 500

_MAX_REPLACE_FILE_SIZE = 10 * 1024 * 1024

class BrowserRoutesMixin:

    @get_route("/api/browser")
    def _api_list_directory(self):
        params = parse_qs(urlparse(self.path).query)
        dir_param = params.get("path", [""])[0]
        show_hidden = params.get("show_hidden", ["false"])[0].lower() == "true"
        show_all = params.get("show_all", ["false"])[0].lower() == "true"
        if dir_param == "":
            self._send_json({
                "currentPath": "",
                "items": [
                    {
                        "name": "Termux Home (~)",
                        "isDir": True,
                        "path": "termux_home"
                    },
                    {
                        "name": "Shared Storage (storage)",
                        "isDir": True,
                        "path": "storage_shared"
                    }
                ]
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
        items = []
        truncated = False
        try:
            for entry in dir_path.iterdir():
                if not show_hidden and entry.name.startswith("."):
                    continue
                if not show_all and not entry.is_dir() and entry.suffix.lower() not in (".md", ".txt", ".js", ".css", ".html", ".json"):
                    continue
                try:
                    stat = entry.stat()
                    items.append({
                        "name": entry.name,
                        "isDir": entry.is_dir(),
                        "path": f"{dir_param}/{entry.name}",
                        "size": stat.st_size if not entry.is_dir() else 0,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat() if not entry.is_dir() else ""
                    })
                except Exception:
                    pass

                if len(items) >= _MAX_DIR_ITEMS:
                    truncated = True
                    break
        except PermissionError:
            self._send_json({"error": "Permission denied: Cannot read directory contents"}, 403)
            return
        except Exception as e:
            self._send_json({"error": f"Failed to list directory: {e}"}, 500)
            return
        items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
        response = {"currentPath": dir_param, "items": items}
        if truncated:
            response["truncated"] = True
            response["truncated_at"] = _MAX_DIR_ITEMS
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
        with config.get_path_lock(src_path), config.get_path_lock(dest_path):
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
        replaced_count = 0
        errors = []
        for f_param in files:
            if not isinstance(f_param, str):
                errors.append(f"Invalid file path entry (must be a string)")
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
                        create_backup(file_path, config.BACKUP_DIR, prefix)
                        atomic_write(file_path, new_content)
                        replaced_count += 1
                except PermissionError:
                    errors.append(f"Permission denied: {f_param}")
                except Exception as e:
                    errors.append(f"Failed to process {f_param}: {e}")
        self._send_json({
            "ok": True,
            "replaced_files": replaced_count,
            "errors": errors
        })

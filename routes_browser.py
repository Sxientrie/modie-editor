import os
import secrets
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import config
from routes_common import get_route, post_route, validate_json
from file_ops import atomic_write, create_backup

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
        if not dir_path.exists() or not dir_path.is_dir():
            self._send_json({"error": "Directory not found"}, 404)
            return
        items = []
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
        except Exception as e:
            self._send_json({"error": f"Failed to list directory: {e}"}, 500)
            return
        items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
        self._send_json({
            "currentPath": dir_param,
            "items": items
        })

    @post_route("/api/create")
    @validate_json(["path", "name", "is_dir"])
    def _api_create_item(self):
        path_str = self.request_data["path"]
        name = self.request_data["name"]
        is_dir = self.request_data["is_dir"]
        if not name or "/" in name or "\\" in name:
            self._send_json({"error": "Invalid item name"}, 400)
            return
        try:
            parent_path = self._resolve_and_validate(path_str) if path_str else config.DEFAULT_MD_PATH.parent
            target_path = parent_path / name
            self._resolve_and_validate(str(target_path.relative_to(Path.home()) if target_path.is_relative_to(Path.home()) else target_path))
        except (PermissionError, ValueError) as e:
            self._send_json({"error": f"Invalid path: {e}"}, 403)
            return
        with config.get_path_lock(target_path):
            if target_path.exists():
                self._send_json({"error": "Item already exists"}, 400)
                return
            try:
                if is_dir:
                    target_path.mkdir(parents=True, exist_ok=True)
                else:
                    atomic_write(target_path, "")
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
            if not target_path.exists():
                self._send_json({"error": "Item not found"}, 404)
                return
            try:
                if target_path.is_dir():
                    shutil.rmtree(target_path)
                else:
                    target_path.unlink()
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
            if not src_path.exists():
                self._send_json({"error": "Source item not found"}, 404)
                return
            if dest_path.exists():
                self._send_json({"error": "Destination already exists"}, 400)
                return
            if not dest_path.parent.exists():
                self._send_json({"error": "Destination parent directory does not exist"}, 400)
                return
            try:
                shutil.move(str(src_path), str(dest_path))
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
                except Exception as e:
                    errors.append(f"Failed to process {f_param}: {e}")
        self._send_json({
            "ok": True,
            "replaced_files": replaced_count,
            "errors": errors
        })

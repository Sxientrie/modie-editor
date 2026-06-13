import json
import os
import re
import secrets
import shutil
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import config
from .routes_common import get_route, post_route, validate_json, validate_query
from .file_ops import atomic_write, create_backup

def cleanup_backups(file_path, prefix, max_per_file, max_age_days):
    if not config.BACKUP_DIR.exists():
        return
    ext = file_path.suffix or ".md"
    backup_pattern = re.compile(rf"^{re.escape(prefix)}_\d{{8}}_\d{{6}}{re.escape(ext)}$")
    backups = []
    for b in config.BACKUP_DIR.glob(f"{prefix}_*{ext}"):
        if backup_pattern.match(b.name):
            backups.append(b)
    now = time.time()
    age_limit = max_age_days * 86400
    retained_backups = []
    for b in backups:
        try:
            stat = b.stat()
            if now - stat.st_mtime > age_limit:
                b.unlink()
            else:
                retained_backups.append((stat.st_mtime, b))
        except Exception:
            pass
    retained_backups.sort(key=lambda x: x[0], reverse=True)
    if len(retained_backups) > max_per_file:
        for mtime, b in retained_backups[max_per_file:]:
            try:
                b.unlink()
            except Exception:
                pass

def get_backup_settings():
    max_count = 10
    max_age = 30
    if config.SETTINGS_FILE.exists():
        try:
            with config.SETTINGS_LOCK:
                data = json.loads(config.SETTINGS_FILE.read_text("utf-8"))
                max_count = int(data.get("backup_max_count", 10))
                max_age = int(data.get("backup_max_age_days", 30))
        except Exception:
            pass
    return max_count, max_age

class BackupRoutesMixin:

    @get_route("/api/backups")
    def _api_list_backups(self):
        params = parse_qs(urlparse(self.path).query)
        file_param = params.get("path", [""])[0]
        try:
            file_path = self._resolve_and_validate(file_param) if file_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        prefix = self._get_backup_prefix(file_path)
        with config.get_path_lock(file_path):
            if not config.BACKUP_DIR.exists():
                backups = []
            else:
                ext = file_path.suffix or '.md'
                backup_pattern = re.compile(rf"^{re.escape(prefix)}_\d{{8}}_\d{{6}}{re.escape(ext)}$")
                backups = sorted(
                    [b for b in config.BACKUP_DIR.glob(f"{prefix}_*{ext}") if backup_pattern.match(b.name)],
                    reverse=True
                )
            total_count = len(backups)

            total_size = 0
            items = []
            for b in backups:
                try:
                    stat = b.stat()
                    total_size += stat.st_size
                    items.append({
                        "name": b.name,
                        "size": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    })
                except FileNotFoundError:
                    total_count -= 1
                except Exception:
                    pass
        self._send_json({"backups": items, "total_count": total_count, "total_size": total_size})

    @post_route("/api/restore")
    @validate_json(["name", "path"])
    def _api_restore_backup(self):
        backup_name = self.request_data["name"]
        file_param = self.request_data["path"]
        if not backup_name or os.path.isabs(backup_name) or ".." in backup_name:
            self._send_json({"error": "Invalid backup name"}, 400)
            return
        try:
            file_path = self._resolve_and_validate(file_param) if file_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        prefix = self._get_backup_prefix(file_path)
        if not backup_name.startswith(prefix):
            self._send_json({"error": "Forbidden: Backup mismatch"}, 403)
            return
        with config.get_path_lock(file_path):
            try:
                resolved_backup = (config.BACKUP_DIR / backup_name).resolve()
                resolved_base = config.BACKUP_DIR.resolve()
                resolved_backup.relative_to(resolved_base)
            except ValueError:
                self._send_json({"error": "Forbidden"}, 403)
                return
            if not resolved_backup.exists() or not resolved_backup.name.startswith("MODIE_"):
                self._send_json({"error": "Backup not found"}, 404)
                return
            if file_path.exists():
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                pre_restore = (config.BACKUP_DIR / f"{prefix}_{ts}_pre_restore{file_path.suffix or '.md'}").resolve()
                if not config.is_in_sandbox(pre_restore):
                    raise PermissionError("Path traversal detected")
                content = file_path.read_bytes()
                atomic_write(pre_restore, content)
            try:
                backup_content = resolved_backup.read_bytes()
                atomic_write(file_path, backup_content)
            except Exception as e:
                self.log_message("Failed to restore file atomically: %s", e)
                self._send_json({"error": f"Failed to restore: {e}"}, 500)
                return
        self._send_json({"ok": True})

    @get_route("/api/backup-content")
    @validate_query(["name", "path"])
    def _api_get_backup_content(self):
        backup_name = self.query_params["name"]
        file_param = self.query_params["path"]
        if not backup_name or os.path.isabs(backup_name) or ".." in backup_name:
            self._send_json({"error": "Invalid backup name"}, 400)
            return
        try:
            file_path = self._resolve_and_validate(file_param) if file_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return
        prefix = self._get_backup_prefix(file_path)
        if not backup_name.startswith(prefix):
            self._send_json({"error": "Forbidden: Backup mismatch"}, 403)
            return
        with config.get_path_lock(file_path):
            try:
                resolved_backup = (config.BACKUP_DIR / backup_name).resolve()
                resolved_base = config.BACKUP_DIR.resolve()
                resolved_backup.relative_to(resolved_base)
            except ValueError:
                self._send_json({"error": "Forbidden"}, 403)
                return
            if not resolved_backup.exists() or not resolved_backup.name.startswith("MODIE_"):
                self._send_json({"error": "Backup not found"}, 404)
                return
            try:
                content = resolved_backup.read_text("utf-8")
                self._send_json({"content": content})
            except Exception as e:
                self._send_json({"error": f"Failed to read backup: {e}"}, 500)

    @get_route("/api/backup-stats")
    def _api_backup_stats(self):
        total_count = 0
        total_size = 0
        per_file_map = {}
        resolved_backup_dir = config.BACKUP_DIR.resolve()
        if not config.is_in_sandbox(resolved_backup_dir):
            raise PermissionError("Path traversal detected")
        if resolved_backup_dir.exists():
            for b in resolved_backup_dir.iterdir():
                resolved_b = b.resolve()
                if not config.is_in_sandbox(resolved_b):
                    continue
                if resolved_b.is_file() and resolved_b.name.startswith("MODIE_"):
                    try:
                        stat = resolved_b.stat()
                        total_count += 1
                        total_size += stat.st_size
                        parts = resolved_b.name.split("_")
                        if len(parts) >= 2:
                            prefix = f"MODIE_{parts[1]}"
                            if prefix not in per_file_map:
                                per_file_map[prefix] = {"prefix": prefix, "count": 0, "size": 0}
                            per_file_map[prefix]["count"] += 1
                            per_file_map[prefix]["size"] += stat.st_size
                    except Exception:
                        pass
        self._send_json({
            "total_count": total_count,
            "total_size_bytes": total_size,
            "per_file": list(per_file_map.values())
        })

    @post_route("/api/backup-purge")
    def _api_backup_purge(self):
        deleted_count = 0
        resolved_backup_dir = config.BACKUP_DIR.resolve()
        if not config.is_in_sandbox(resolved_backup_dir):
            raise PermissionError("Path traversal detected")
        if resolved_backup_dir.exists():
            for b in resolved_backup_dir.iterdir():
                resolved_b = b.resolve()
                if not config.is_in_sandbox(resolved_b):
                    continue
                if resolved_b.is_file() and resolved_b.name.startswith("MODIE_"):
                    try:
                        resolved_b.unlink()
                        deleted_count += 1
                    except Exception:
                        pass
        self._send_json({"ok": True, "deleted_count": deleted_count})

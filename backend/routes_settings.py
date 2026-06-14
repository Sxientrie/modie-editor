import json
import mimetypes
import os
import re
from pathlib import Path
from . import config
from .routes_common import get_route, post_route, validate_json, validate_query
from .file_ops import atomic_write

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
            "backup_max_age_days": 30,
            "starred_items": [],
            "recent_files": []
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
            "backup_max_age_days": lambda v: isinstance(v, int) and 1 <= v <= 365,
            "starred_items": lambda v: isinstance(v, list) and all(
                isinstance(x, dict) and
                isinstance(x.get("name"), str) and
                isinstance(x.get("path"), str) and
                isinstance(x.get("isDir"), bool)
                for x in v
            ),
            "recent_files": lambda v: isinstance(v, list) and all(
                isinstance(x, dict) and
                isinstance(x.get("name"), str) and
                isinstance(x.get("path"), str)
                for x in v
            )
        }
        validated = {k: v for k, v in data.items() if k in allowed and allowed[k](v)}
        with config.SETTINGS_LOCK:
            try:
                existing = {}
                if config.SETTINGS_FILE.exists():
                    try:
                        existing = json.loads(config.SETTINGS_FILE.read_text("utf-8"))
                    except Exception:
                        pass
                existing.update(validated)
                # Keep only keys in the allowed schema to prune deprecated/stale options when settings are saved.
                existing = {k: v for k, v in existing.items() if k in allowed}
                atomic_write(config.SETTINGS_FILE, json.dumps(existing))
            except Exception as e:
                self._send_json({"error": f"Failed to save settings: {e}"}, 500)
                return
        self._send_json({"ok": True})

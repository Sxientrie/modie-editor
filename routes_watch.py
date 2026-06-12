import json
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs

import config
from routes_common import get_route, validate_query

class WatchRoutesMixin:

    @get_route("/api/watch")
    @validate_query(["path"])
    def _api_watch_file(self):
        file_param = self.query_params["path"]
        try:
            file_path = self._resolve_and_validate(file_param)
        except PermissionError as e:
            self.send_error(403, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            last_mtime = file_path.stat().st_mtime if file_path.exists() else 0
        except Exception:
            last_mtime = 0
        max_cycles = 150
        heartbeat_interval = 15
        cycle = 0
        while cycle < max_cycles:
            time.sleep(2)
            cycle += 1
            try:
                if not file_path.exists():
                    current_mtime = 0
                else:
                    current_mtime = file_path.stat().st_mtime
            except Exception:
                current_mtime = 0
            if current_mtime != last_mtime:
                iso_mod = datetime.fromtimestamp(current_mtime).isoformat() if current_mtime else ""
                data_payload = json.dumps({"changed": True, "modified": iso_mod})
                try:
                    self.wfile.write(f"data: {data_payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    break
                last_mtime = current_mtime
            elif cycle % heartbeat_interval == 0:
                try:
                    self.wfile.write(b":\n\n")
                    self.wfile.flush()
                except Exception:
                    break

    @get_route("/api/dev-watch", require_auth=False)
    def _api_dev_watch(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        _, last_state = config.check_static_changed(None)
        max_cycles = 150
        cycle = 0
        while cycle < max_cycles:
            time.sleep(1)
            cycle += 1
            changed, last_state = config.check_static_changed(last_state)
            if changed:
                try:
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
                except Exception:
                    break
            elif cycle % 15 == 0:
                try:
                    self.wfile.write(b":\n\n")
                    self.wfile.flush()
                except Exception:
                    break

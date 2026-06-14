import json
import time
import select
import socket
import threading
from datetime import datetime
from urllib.parse import urlparse, parse_qs

from . import config
from .routes_common import get_route, validate_query

WATCHER_REGISTRY = []
WATCHER_LOCK = threading.Lock()
MAX_WATCHERS = 10

class WatchRoutesMixin:

    @get_route("/api/watch")
    @validate_query(["path"])
    def _api_watch_file(self):
        file_param = self.query_params["path"]
        try:
            file_path = self._resolve_and_validate(file_param)
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        with WATCHER_LOCK:
            # Why: Limit concurrent EventSource file watchers to prevent exhausting ThreadLimitedHTTPServer threads.
            while len(WATCHER_REGISTRY) >= MAX_WATCHERS:
                oldest_handler = WATCHER_REGISTRY.pop(0)
                try:
                    oldest_handler.connection.close()
                except Exception:
                    pass
            WATCHER_REGISTRY.append(self)

        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                last_mtime = file_path.stat().st_mtime if file_path.exists() else 0
            except Exception:
                last_mtime = 0
            max_cycles = 600
            # Why: Send periodic heartbeats to quickly detect disconnected clients and release the connection thread.
            heartbeat_interval = 10
            cycle = 0
            while cycle < max_cycles:
                cycle += 1
                disconnected = False
                # Check connection state frequently during the sleep window to release the socket thread immediately if the client disconnects or switches tabs.
                for _ in range(5):
                    time.sleep(0.1)
                    if hasattr(self, "connection") and self.connection is not None:
                        try:
                            r, _, _ = select.select([self.connection], [], [], 0)
                            if r:
                                flags = socket.MSG_PEEK
                                if hasattr(socket, "MSG_DONTWAIT"):
                                    flags |= socket.MSG_DONTWAIT
                                data = self.connection.recv(1, flags)
                                if not data:
                                    disconnected = True
                                    break
                        except Exception:
                            disconnected = True
                            break
                if disconnected:
                    break
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
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
                    last_mtime = current_mtime
                elif cycle % heartbeat_interval == 0:
                    try:
                        self.wfile.write(b":\n\n")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
        finally:
            with WATCHER_LOCK:
                if self in WATCHER_REGISTRY:
                    WATCHER_REGISTRY.remove(self)

    @get_route("/api/dev-watch", require_auth=False)
    def _api_dev_watch(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(f"data: boot_{config.BOOT_ID}\n\n".encode("utf-8"))
            self.wfile.flush()
        except Exception:
            return
        _, last_state = config.check_static_changed(None)
        max_cycles = 600
        # Why: Send periodic heartbeats to quickly detect disconnected clients and release the connection thread.
        heartbeat_interval = 10
        cycle = 0
        while cycle < max_cycles:
            cycle += 1
            disconnected = False
            # Check connection state frequently during the sleep window to release the socket thread immediately if the client disconnects or switches tabs.
            for _ in range(5):
                time.sleep(0.1)
                if hasattr(self, "connection") and self.connection is not None:
                    try:
                        r, _, _ = select.select([self.connection], [], [], 0)
                        if r:
                            flags = socket.MSG_PEEK
                            if hasattr(socket, "MSG_DONTWAIT"):
                                flags |= socket.MSG_DONTWAIT
                            data = self.connection.recv(1, flags)
                            if not data:
                                disconnected = True
                                break
                    except Exception:
                        disconnected = True
                        break
            if disconnected:
                break
            changed = False
            # Perform directory walks only every 4th cycle (2 seconds) to avoid CPU spikes
            if cycle % 4 == 0:
                changed, last_state = config.check_static_changed(last_state)
            if changed:
                try:
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
            elif cycle % heartbeat_interval == 0:
                try:
                    self.wfile.write(b":\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break

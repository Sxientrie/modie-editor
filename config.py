import os
import secrets
import threading
import hashlib
import weakref
from pathlib import Path

from file_ops import atomic_write

DEFAULT_MD_PATH = None
BACKUP_DIR = None
SETTINGS_FILE = None
TOKEN_FILE = None
SESSION_TOKEN = None

PATH_LOCKS = weakref.WeakValueDictionary()
PATH_LOCKS_LOCK = threading.Lock()
SETTINGS_LOCK = threading.Lock()
LAST_SAVE_TIMES = {}
LAST_SAVE_LOCK = threading.Lock()

DEV_MODE = False

def get_path_lock(file_path):
    path_key = str(file_path.resolve())
    with PATH_LOCKS_LOCK:
        lock = PATH_LOCKS.get(path_key)
        if lock is None:
            lock = threading.Lock()
            PATH_LOCKS[path_key] = lock
        return lock

def init_config(home_dir=None):
    global DEFAULT_MD_PATH, BACKUP_DIR, SETTINGS_FILE, TOKEN_FILE, SESSION_TOKEN
    h = Path(home_dir) if home_dir else Path.home()
    DEFAULT_MD_PATH = h / ".modie" / "default.md"
    BACKUP_DIR = h / ".modie" / ".backups"
    SETTINGS_FILE = h / ".modie" / "settings.json"
    TOKEN_FILE = h / ".modie" / ".token"
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSION_TOKEN = secrets.token_hex(16)
    atomic_write(TOKEN_FILE, SESSION_TOKEN)

if os.environ.get("MODIE_TESTING") != "1":
    init_config()

def check_static_changed(last_state):
    static_dir = Path(__file__).parent / "static"
    current_state = {}
    if static_dir.exists():
        watch_targets = [
            static_dir / "index.html",
            static_dir / "js",
            static_dir / "css",
        ]
        for target in watch_targets:
            if not target.exists():
                continue
            if target.is_file():
                try:
                    current_state[str(target)] = target.stat().st_mtime
                except Exception:
                    pass
            elif target.is_dir():
                for root, _, files in os.walk(target):
                    for f in files:
                        if f.endswith(".tmp") or f.endswith(".png") or f.endswith(".jpg") or f.endswith(".ico") or f.endswith(".zip") or "bundle" in f:
                            continue
                        p = os.path.join(root, f)
                        try:
                            current_state[p] = os.path.getmtime(p)
                        except Exception:
                            pass
    if last_state is None:
        return False, current_state
    if current_state != last_state:
        return True, current_state
    return False, current_state

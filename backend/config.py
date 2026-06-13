import os
import secrets
import threading
import hashlib
import weakref
from pathlib import Path

from .file_ops import atomic_write

_INITIALIZED = False

def _ensure_initialized():
    global _INITIALIZED
    if not _INITIALIZED:
        _INITIALIZED = True
        init_config()

def __getattr__(name):
    if name in ("DEFAULT_MD_PATH", "BACKUP_DIR", "SETTINGS_FILE", "TOKEN_FILE", "SESSION_TOKEN"):
        _ensure_initialized()
        return globals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

PATH_LOCKS = weakref.WeakValueDictionary()
PATH_LOCKS_LOCK = threading.Lock()
SETTINGS_LOCK = threading.Lock()
LAST_SAVE_TIMES = {}
LAST_SAVE_LOCK = threading.Lock()

DEV_MODE = False


_LAST_SAVE_MAX_AGE = 3600.0

def get_roots():
    sandbox_root = Path.home().resolve()
    shared_root = Path("/storage/emulated/0").resolve()
    try:
        if not shared_root.exists():
            shared_root = (sandbox_root / "modie_shared").resolve()
            shared_root.mkdir(parents=True, exist_ok=True)
    except Exception:
        shared_root = (sandbox_root / "modie_shared").resolve()
        shared_root.mkdir(parents=True, exist_ok=True)
    return sandbox_root, shared_root

def is_in_sandbox(target_path):
    sandbox_root, shared_root = get_roots()
    try:
        target_path.relative_to(sandbox_root)
        return True
    except ValueError:
        pass
    try:
        target_path.relative_to(shared_root)
        return True
    except ValueError:
        pass
    return False


def get_path_lock(file_path):
    path_key = str(file_path.resolve())
    with PATH_LOCKS_LOCK:
        lock = PATH_LOCKS.get(path_key)
        if lock is None:
            lock = threading.Lock()
            PATH_LOCKS[path_key] = lock
        return lock


def prune_last_save_times():
    import time
    now = time.time()
    with LAST_SAVE_LOCK:
        stale_keys = [k for k, v in LAST_SAVE_TIMES.items() if now - v > _LAST_SAVE_MAX_AGE]
        for k in stale_keys:
            del LAST_SAVE_TIMES[k]

def init_config(home_dir=None):
    global DEFAULT_MD_PATH, BACKUP_DIR, SETTINGS_FILE, TOKEN_FILE, SESSION_TOKEN, _INITIALIZED
    _INITIALIZED = True
    h = Path(home_dir) if home_dir else Path.home()
    DEFAULT_MD_PATH = (h / ".modie" / "default.md").resolve()
    BACKUP_DIR = (h / ".modie" / ".backups").resolve()
    SETTINGS_FILE = (h / ".modie" / "settings.json").resolve()
    TOKEN_FILE = (h / ".modie" / ".token").resolve()
    if not is_in_sandbox(DEFAULT_MD_PATH) or not is_in_sandbox(TOKEN_FILE):
        raise PermissionError("Path traversal detected")
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSION_TOKEN = secrets.token_hex(16)
    atomic_write(TOKEN_FILE, SESSION_TOKEN)


def check_static_changed(last_state):
    static_dir = Path(__file__).parent.parent / "static"
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

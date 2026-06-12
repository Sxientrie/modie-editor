import os
import secrets
import shutil
from pathlib import Path
from datetime import datetime

def atomic_write(target_path, content, encoding="utf-8"):
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.parent / f"{target_path.name}.{secrets.token_hex(4)}.tmp"
    try:
        if isinstance(content, bytes):
            mode = "wb"
        else:
            mode = "w"
        with open(temp_path, mode, encoding=None if isinstance(content, bytes) else encoding) as f:
            f.write(content)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(temp_path, target_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass

def create_backup(file_path, backup_dir, prefix):
    file_path = Path(file_path)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"{prefix}_{ts}{file_path.suffix or '.md'}"
    backup_path = backup_dir / backup_name
    shutil.copy2(file_path, backup_path)
    return backup_path

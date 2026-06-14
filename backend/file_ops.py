import os
import secrets
import shutil
from pathlib import Path
from datetime import datetime

def atomic_write(target_path, content, encoding="utf-8", perms=None):
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.parent / f"{target_path.name}.{secrets.token_hex(4)}.tmp"
    try:
        if isinstance(content, bytes):
            mode = "wb"
        else:
            mode = "w"
        
        if perms is not None:
            flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
            if hasattr(os, "O_BINARY") and isinstance(content, bytes):
                flags |= os.O_BINARY
            fd = os.open(temp_path, flags, perms)
            f = os.fdopen(fd, mode, encoding=None if isinstance(content, bytes) else encoding)
        else:
            f = open(temp_path, mode, encoding=None if isinstance(content, bytes) else encoding)

        try:
            f.write(content)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        finally:
            f.close()

        os.replace(temp_path, target_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass

def create_backup(file_path, backup_dir, prefix):
    file_path = Path(file_path)

    if not file_path.exists():
        return None

    b_dir = Path(backup_dir)
    # Raise any write/permission errors directly instead of falling back to the target file's parent directory, avoiding workspace clutter.
    b_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"{prefix}_{ts}{file_path.suffix or '.md'}"
    backup_path = b_dir / backup_name
    
    # Avoid memory exhaustion on large files by copying in chunks via an atomic replace.
    temp_path = backup_path.parent / f"{backup_path.name}.{secrets.token_hex(4)}.tmp"
    try:
        try:
            with open(file_path, "rb") as f_src:
                with open(temp_path, "wb") as f_dest:
                    while True:
                        chunk = f_src.read(64 * 1024)
                        if not chunk:
                            break
                        f_dest.write(chunk)
                    f_dest.flush()
                    try:
                        os.fsync(f_dest.fileno())
                    except OSError:
                        pass
            os.replace(temp_path, backup_path)
        except Exception as e:
            # Wrap all read/write/replace exceptions in OSError for parent clean warning logging.
            raise OSError(f"Failed to copy backup data: {e}") from e
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass
    return backup_path



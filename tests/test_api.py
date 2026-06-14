import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import unittest
from unittest.mock import patch
import json
import io
import shutil
import tempfile

import backend.server as server
from backend.server import EditorHandler
from backend.file_ops import atomic_write

class TestableEditorHandler(EditorHandler):
    def __init__(self):
        self.rfile = io.BytesIO()
        self.wfile = io.BytesIO()
        self.headers = {}
        self.path = ""
        self.request_data = {}
        self._headers_buffer = []
        self.response_data = None
        self.response_status = 200

    def send_response(self, code, message=None):
        self.response_status = code

    def send_header(self, keyword, value):
        self._headers_buffer.append(f"{keyword}: {value}")

    def end_headers(self):
        pass

    def _send_json(self, data, status=200):
        self.response_data = data
        self.response_status = status

    def _check_auth(self):
        return True

class TestAPI(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())
        self.sandbox_patch = patch("backend.server.Path.home", return_value=self.test_dir)
        self.sandbox_patch.start()
        
        from backend import config
        config.init_config(self.test_dir)

        self.handler = TestableEditorHandler()
        self.handler._resolve_and_validate = lambda p: self.test_dir / p

    def tearDown(self):
        self.sandbox_patch.stop()
        shutil.rmtree(self.test_dir)

    def test_token_permissions(self):
        from backend import config
        token_path = config.TOKEN_FILE
        self.assertTrue(token_path.exists())
        mode = token_path.stat().st_mode
        self.assertEqual(mode & 0o077, 0)

    def test_get_content_empty(self):
        self.handler.path = "/api/content?path=test.md"
        self.handler._api_get_content()
        self.assertEqual(self.handler.response_data, {"content": "", "modified": "", "size": 0})

    def test_save_and_get_content(self):
        payload = json.dumps({"path": "test.md", "content": "Hello World"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["ok"])
        
        self.handler.path = "/api/content?path=test.md"
        self.handler._api_get_content()
        self.assertEqual(self.handler.response_data["content"], "Hello World")
        self.assertEqual(self.handler.response_data["size"], len("Hello World"))

    def test_save_idempotent_conflict_bypass(self):
        payload = json.dumps({"path": "test.md", "content": "Hello World"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 200)
        
        import time
        from datetime import datetime
        older_ts = datetime.fromtimestamp(time.time() - 3600).isoformat()
        payload2 = json.dumps({
            "path": "test.md",
            "content": "Hello World",
            "modified": older_ts
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload2)
        self.handler.headers = {"Content-Length": str(len(payload2))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["ok"])
        
        payload3 = json.dumps({
            "path": "test.md",
            "content": "Changed Content",
            "modified": older_ts
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload3)
        self.handler.headers = {"Content-Length": str(len(payload3))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 409)

    def test_directory_listing(self):
        (self.test_dir / "termux_home").mkdir()
        (self.test_dir / "termux_home" / "dir1").mkdir()
        atomic_write(self.test_dir / "termux_home" / "test.md", "Hello")
        
        self.handler.path = "/api/browser?path=termux_home"
        self.handler._api_list_directory()
        self.assertEqual(self.handler.response_status, 200)
        items = self.handler.response_data["items"]
        names = [f["name"] for f in items]
        self.assertIn("dir1", names)
        self.assertIn("test.md", names)

    def test_directory_listing_empty_path(self):
        self.handler.path = "/api/browser?path="
        self.handler._api_list_directory()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["currentPath"], "")
        self.assertIn("storage", self.handler.response_data)
        self.assertNotIn("termux_home", self.handler.response_data["storage"])
        self.assertIn("storage_shared", self.handler.response_data["storage"])

    def test_directory_listing_pagination(self):
        (self.test_dir / "termux_home").mkdir()
        (self.test_dir / "termux_home" / "dir1").mkdir()
        atomic_write(self.test_dir / "termux_home" / "test.md", "Hello")
        
        self.handler.path = "/api/browser?path=termux_home&limit=-10&offset=-5"
        self.handler._api_list_directory()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(len(self.handler.response_data["items"]), 0)
        self.assertEqual(self.handler.response_data["limit"], 0)
        self.assertEqual(self.handler.response_data["offset"], 0)

        self.handler.path = "/api/browser?path=termux_home&limit=invalid&offset=abc"
        self.handler._api_list_directory()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["limit"], 100)
        self.assertEqual(self.handler.response_data["offset"], 0)

        self.handler.path = f"/api/browser?path=termux_home&limit={'9'*5000}&offset=0"
        self.handler._api_list_directory()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["limit"], 100)

    def test_search_and_replace(self):
        f1 = self.test_dir / "file1.md"
        f2 = self.test_dir / "file2.md"
        atomic_write(f1, "I like apple")
        atomic_write(f2, "apple juice is sweet")
        payload = json.dumps({
            "query": "apple",
            "replace": "orange",
            "files": ["file1.md", "file2.md"],
            "case_sensitive": True,
            "is_regex": False
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_replace_files()
        self.assertEqual(self.handler.response_status, 200)
        
        import time
        from backend.routes_browser import REPLACE_TASKS, REPLACE_TASKS_LOCK
        
        task_id = self.handler.response_data["task_id"]
        for _ in range(50):
            with REPLACE_TASKS_LOCK:
                task = REPLACE_TASKS.get(task_id)
            if task and task.get("status") == "done":
                break
            time.sleep(0.02)
            
        self.handler.path = f"/api/replace/status?task_id={task_id}"
        self.handler._api_replace_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["replaced_files"], 2)
        self.assertEqual(f1.read_text("utf-8"), "I like orange")
        self.assertEqual(f2.read_text("utf-8"), "orange juice is sweet")

    def test_search_exclusions(self):
        (self.test_dir / "termux_home").mkdir(exist_ok=True)
        (self.test_dir / "termux_home" / "src").mkdir()
        (self.test_dir / "termux_home" / "node_modules").mkdir()
        atomic_write(self.test_dir / "termux_home" / "src" / "index.js", "const apple = 1;")
        atomic_write(self.test_dir / "termux_home" / "node_modules" / "some-lib.js", "const apple = 2;")
        
        self.handler.path = "/api/search?query=apple&path=termux_home"
        self.handler._api_search_files()
        self.assertEqual(self.handler.response_status, 200)
        results = self.handler.response_data["results"]
        paths = [r["path"] for r in results]
        self.assertTrue(any("index.js" in p for p in paths))
        self.assertFalse(any("some-lib.js" in p for p in paths))

    def test_file_ops_atomic_write(self):
        test_file = self.test_dir / "atomic.txt"
        atomic_write(test_file, "atomic content")
        self.assertEqual(test_file.read_text("utf-8"), "atomic content")
        atomic_write(test_file, b"binary content")
        self.assertEqual(test_file.read_bytes(), b"binary content")

    def test_file_ops_create_backup(self):
        from backend.file_ops import create_backup
        test_file = self.test_dir / "source.txt"
        atomic_write(test_file, "source content")
        backup_dir = self.test_dir / "backups"
        backup_path = create_backup(test_file, backup_dir, "MODIE_test")
        self.assertTrue(backup_path.exists())
        self.assertEqual(backup_path.read_text("utf-8"), "source content")
        self.assertEqual(backup_path.parent, backup_dir)

    def test_file_ops_create_backup_failure(self):
        from backend.file_ops import create_backup
        test_file = self.test_dir / "source.txt"
        atomic_write(test_file, "source content")
        bad_backup_dir = self.test_dir / "bad_backups"
        with patch("backend.file_ops.os.replace", side_effect=OSError("Disk full")):
            with self.assertRaises(Exception):
                create_backup(test_file, bad_backup_dir, "MODIE_test")

    def test_file_ops_create_backup_no_fallback(self):
        from backend.file_ops import create_backup
        test_file = self.test_dir / "source.txt"
        atomic_write(test_file, "source content")
        bad_backup_dir = self.test_dir / "bad_backups"
        bad_backup_dir.touch()
        with self.assertRaises(Exception):
            create_backup(test_file, bad_backup_dir, "MODIE_test")

    def test_save_succeeds_when_backup_fails(self):
        atomic_write(self.test_dir / "test.md", "old")
        payload = json.dumps({"path": "test.md", "content": "new", "modified": None}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        with patch("backend.routes_file.create_backup", side_effect=OSError("fsync unsupported")):
            self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["ok"])
        self.assertIn("warning", self.handler.response_data)
        self.assertEqual((self.test_dir / "test.md").read_text(), "new")

    def test_replace_succeeds_when_backup_fails(self):
        f1 = self.test_dir / "file1.md"
        atomic_write(f1, "I like apple")
        payload = json.dumps({
            "query": "apple",
            "replace": "orange",
            "files": ["file1.md"],
            "case_sensitive": True,
            "is_regex": False
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        patcher = patch("backend.routes_browser.create_backup", side_effect=OSError("fsync unsupported"))
        patcher.start()
        try:
            self.handler._api_replace_files()
            self.assertEqual(self.handler.response_status, 200)
            task_id = self.handler.response_data["task_id"]
            import time
            from backend.routes_browser import REPLACE_TASKS, REPLACE_TASKS_LOCK
            for _ in range(50):
                with REPLACE_TASKS_LOCK:
                    task = REPLACE_TASKS.get(task_id)
                if task and task.get("status") == "done":
                    break
                time.sleep(0.02)
        finally:
            patcher.stop()
        self.handler.path = f"/api/replace/status?task_id={task_id}"
        self.handler._api_replace_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["replaced_files"], 1)
        self.assertEqual(f1.read_text("utf-8"), "I like orange")
        self.assertTrue(any("Backup failed" in err for err in self.handler.response_data["errors"]))

    def test_route_discovery(self):
        from backend.routes_common import GET_ROUTES, POST_ROUTES
        self.assertIn("/api/content", GET_ROUTES)
        self.assertIn("/api/settings", GET_ROUTES)
        self.assertIn("/api/backup-stats", GET_ROUTES)
        self.assertIn("/api/backup-purge", POST_ROUTES)

    def test_backup_stats_and_purge(self):
        from backend import config
        config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        atomic_write(config.BACKUP_DIR / "MODIE_testfile_20260612_120000.md", "backup content 1")
        atomic_write(config.BACKUP_DIR / "MODIE_testfile_20260612_130000.md", "backup content 2")
        self.handler.path = "/api/backup-stats"
        self.handler._api_backup_stats()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["total_count"], 2)
        self.handler.path = "/api/backup-purge"
        self.handler._api_backup_purge()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["ok"])
        self.assertEqual(self.handler.response_data["deleted_count"], 2)
        self.handler.path = "/api/backup-stats"
        self.handler._api_backup_stats()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["total_count"], 0)

    def test_backup_cleanup_retention(self):
        from backend import config
        from backend.routes_backup import cleanup_backups
        config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        f = self.test_dir / "test.md"
        atomic_write(f, "content")
        b1 = config.BACKUP_DIR / "MODIE_testfile_20260612_120000.md"
        b2 = config.BACKUP_DIR / "MODIE_testfile_20260612_130000.md"
        b3 = config.BACKUP_DIR / "MODIE_testfile_20260612_140000.md"
        atomic_write(b1, "1")
        atomic_write(b2, "2")
        atomic_write(b3, "3")
        import time
        now = time.time()
        os.utime(b1, (now - 40 * 86400, now - 40 * 86400))
        os.utime(b2, (now - 10, now - 10))
        os.utime(b3, (now, now))
        cleanup_backups(f, "MODIE_testfile", max_per_file=1, max_age_days=30)
        self.assertFalse(b1.exists())
        self.assertFalse(b2.exists())
        self.assertTrue(b3.exists())

    def test_search_all_and_hidden(self):
        (self.test_dir / "termux_home").mkdir(exist_ok=True)
        atomic_write(self.test_dir / "termux_home" / "normal.md", "matching text")
        atomic_write(self.test_dir / "termux_home" / "script.py", "matching text")
        atomic_write(self.test_dir / "termux_home" / ".hidden.txt", "matching text")
        atomic_write(self.test_dir / "termux_home" / "binary.png", b"\x00matching text")

        self.handler.path = "/api/search?query=matching&path=termux_home&show_all=false&show_hidden=false"
        self.handler.query_params = {"query": "matching", "path": "termux_home", "show_all": "false", "show_hidden": "false"}
        self.handler._api_search_files()
        self.assertEqual(self.handler.response_status, 200)
        results = [r["filename"] for r in self.handler.response_data["results"]]
        self.assertIn("normal.md", results)
        self.assertNotIn("script.py", results)
        self.assertNotIn(".hidden.txt", results)
        self.assertNotIn("binary.png", results)

        self.handler.path = "/api/search?query=matching&path=termux_home&show_all=true&show_hidden=false"
        self.handler.query_params = {"query": "matching", "path": "termux_home", "show_all": "true", "show_hidden": "false"}
        self.handler._api_search_files()
        self.assertEqual(self.handler.response_status, 200)
        results = [r["filename"] for r in self.handler.response_data["results"]]
        self.assertIn("normal.md", results)
        self.assertIn("script.py", results)
        self.assertNotIn(".hidden.txt", results)
        self.assertNotIn("binary.png", results)

        self.handler.path = "/api/search?query=matching&path=termux_home&show_all=true&show_hidden=true"
        self.handler.query_params = {"query": "matching", "path": "termux_home", "show_all": "true", "show_hidden": "true"}
        self.handler._api_search_files()
        self.assertEqual(self.handler.response_status, 200)
        results = [r["filename"] for r in self.handler.response_data["results"]]
        self.assertIn("normal.md", results)
        self.assertIn("script.py", results)
        self.assertIn(".hidden.txt", results)
        self.assertNotIn("binary.png", results)

    def test_serve_sw_dev_mode(self):
        from backend import config
        config.DEV_MODE = True
        self.handler.path = "/sw.js"
        self.handler._serve_sw()
        self.assertEqual(self.handler.response_status, 200)
        self.assertIn(b"self.skipWaiting()", self.handler.wfile.getvalue())

    def test_serve_sw_prod_mode(self):
        from backend import config
        config.DEV_MODE = False
        self.handler.path = "/sw.js"
        self.handler._serve_sw()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(len(self.handler.wfile.getvalue()) > 0)

    def test_verify_drafts(self):
        atomic_write(self.test_dir / "exists.md", "Content")
        payload = json.dumps({
            "paths": ["exists.md", "missing.md"]
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_verify_drafts()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data, {"missing": ["missing.md"]})

    def test_verify_drafts_exception_safety(self):
        def mock_resolve(p):
            raise PermissionError("Permission denied")
        self.handler._resolve_and_validate = mock_resolve
        payload = json.dumps({
            "paths": ["restricted.md"]
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_verify_drafts()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data, {"missing": []})

    def test_save_content_invalid_types(self):
        payload = json.dumps({"path": 12345, "content": "Hello World"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 400)
        self.assertIn("must be strings", self.handler.response_data["error"])

    def test_verify_drafts_invalid_types(self):
        payload = json.dumps({"paths": "not a list"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_verify_drafts()
        self.assertEqual(self.handler.response_status, 400)
        self.assertIn("must be a list of strings", self.handler.response_data["error"])

    def test_invalid_utf8_payload(self):
        payload = b'{"path": "test.md", "content": "\xff\xfe"}'
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 400)
        self.assertIn("Invalid UTF-8 encoding", self.handler.response_data["error"])

    def test_save_and_merge_settings(self):
        from backend import config
        atomic_write(config.SETTINGS_FILE, json.dumps({"theme": "dark", "zoom": 14}))
        
        payload = json.dumps({
            "theme": "light",
            "starred_items": [{"name": "Starred File", "path": "termux_home/starred.md", "isDir": False}],
            "recent_files": [{"name": "Recent File", "path": "termux_home/recent.md"}]
        }).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_save_settings()
        self.assertEqual(self.handler.response_status, 200)
        
        self.handler.path = "/api/settings"
        self.handler._api_get_settings()
        self.assertEqual(self.handler.response_status, 200)
        self.assertEqual(self.handler.response_data["theme"], "light")
        self.assertEqual(self.handler.response_data["zoom"], 14)
        self.assertEqual(self.handler.response_data["starred_items"], [{"name": "Starred File", "path": "termux_home/starred.md", "isDir": False}])
        self.assertEqual(self.handler.response_data["recent_files"], [{"name": "Recent File", "path": "termux_home/recent.md"}])




    def test_cleanup_temp_files_logs_to_stderr(self):
        from backend.server import cleanup_temp_files
        modie_dir = self.test_dir / ".modie"
        modie_dir.mkdir(parents=True, exist_ok=True)
        # Use a filename matching the pattern r"^.*\.[0-9a-f]{8}\.tmp$"
        temp_file = modie_dir / "test_temp.12345678.tmp"
        temp_file.touch()

        import io
        from unittest.mock import patch, MagicMock
        
        stderr_capture = io.StringIO()
        
        # Mock threading.Thread to run the target synchronously in test environment
        def mock_thread_init(target, *args, **kwargs):
            mock_thread = MagicMock()
            mock_thread.start = lambda: target()
            return mock_thread

        with patch("threading.Thread", side_effect=mock_thread_init), \
             patch.object(Path, "unlink", side_effect=OSError("Permission denied")), \
             patch("sys.stderr", stderr_capture):
            cleanup_temp_files()
            
        output = stderr_capture.getvalue()
        # Verify it raises and prints permission error context
        self.assertIn("Failed to delete temp file", output)
        self.assertIn("Permission denied", output)

    def test_resolve_and_validate_android_paths(self):
        real_handler = TestableEditorHandler()
        with patch("backend.config.get_roots") as mock_roots:
            termux_home = (self.test_dir / "home").resolve()
            storage_shared = (self.test_dir / "storage").resolve()
            termux_home.mkdir(exist_ok=True)
            storage_shared.mkdir(exist_ok=True)
            mock_roots.return_value = (termux_home, storage_shared)
            
            p1 = real_handler._resolve_and_validate("termux_home/notes.md")
            self.assertEqual(p1, termux_home / "notes.md")
            
            p2 = real_handler._resolve_and_validate("storage_shared/pictures/photo.png")
            self.assertEqual(p2, storage_shared / "pictures" / "photo.png")
            
            with self.assertRaises(PermissionError):
                real_handler._resolve_and_validate("termux_home/../outside.txt")
                
            with self.assertRaises(PermissionError):
                real_handler._resolve_and_validate("storage_shared/../../outside.txt")

    @patch("os.fsync")
    def test_atomic_write_fat32_behavior(self, mock_fsync):
        mock_fsync.side_effect = OSError("Operation not permitted")
        test_file = self.test_dir / "fat32_test.txt"
        atomic_write(test_file, "fat32 content")
        self.assertEqual(test_file.read_text("utf-8"), "fat32 content")

    def test_save_settings_write_failure(self):
        payload = json.dumps({"theme": "light"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        with patch("backend.routes_settings.atomic_write", side_effect=OSError("Write failed")):
            self.handler._api_save_settings()
        self.assertEqual(self.handler.response_status, 500)
        self.assertIn("Failed to save settings", self.handler.response_data["error"])

    def test_missing_content_length_header(self):
        payload = json.dumps({"path": "test.md", "content": "hello"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {}
        self.handler._api_save_content()
        self.assertEqual(self.handler.response_status, 400)
        self.assertIn("Missing required key", self.handler.response_data["error"])

    def test_protected_path_deletion_and_rename(self):
        modie_dir = self.test_dir / ".modie"
        modie_dir.mkdir(exist_ok=True)
        default_md = modie_dir / "default.md"
        atomic_write(default_md, "test content")

        self.handler._resolve_and_validate = lambda p: (self.test_dir / p).resolve()

        payload = json.dumps({"path": ".modie"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_delete_item()
        self.assertEqual(self.handler.response_status, 403)
        self.assertIn("Cannot modify system configuration directory", self.handler.response_data["error"])

        payload = json.dumps({"path": ".modie/default.md"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_delete_item()
        self.assertEqual(self.handler.response_status, 403)
        self.assertIn("Cannot modify system configuration directory", self.handler.response_data["error"])

        payload = json.dumps({"path": ".modie", "new_path": "new_modie"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_rename_item()
        self.assertEqual(self.handler.response_status, 403)
        self.assertIn("Cannot rename or move system configuration directory", self.handler.response_data["error"])

        payload = json.dumps({"path": "test.md", "new_path": ".modie/test.md"}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_rename_item()
        self.assertEqual(self.handler.response_status, 403)
        self.assertIn("Cannot rename or move system configuration directory", self.handler.response_data["error"])

    def test_watcher_thread_pool_limit(self):
        import threading
        import time
        from unittest.mock import MagicMock
        from backend.routes_watch import WATCHER_REGISTRY, MAX_WATCHERS, WATCHER_LOCK

        with WATCHER_LOCK:
            WATCHER_REGISTRY.clear()

        handlers = []
        threads = []
        
        for i in range(MAX_WATCHERS + 2):
            h = TestableEditorHandler()
            h._resolve_and_validate = lambda p: (self.test_dir / p).resolve()
            h.path = "/api/watch?path=test.md"
            h.query_params = {"path": "test.md"}
            
            mock_conn = MagicMock()
            h.connection = mock_conn
            h.wfile = MagicMock()
            h.send_response = MagicMock()
            h.send_header = MagicMock()
            h.end_headers = MagicMock()
            
            handlers.append(h)

        # Use an Event to hold the threads alive while we verify the registry,
        # then set the event to let them exit cleanly without delay.
        exit_event = threading.Event()
        def mock_sleep(secs):
            exit_event.wait(2.0)

        with patch("backend.routes_watch.select.select", return_value=([], [], [])), \
             patch("backend.routes_watch.time.sleep", side_effect=mock_sleep):
            
            for h in handlers:
                t = threading.Thread(target=h._api_watch_file)
                t.daemon = True
                t.start()
                threads.append(t)
                time.sleep(0.005)

            time.sleep(0.05)

            try:
                with WATCHER_LOCK:
                    reg_size = len(WATCHER_REGISTRY)
                self.assertEqual(reg_size, MAX_WATCHERS)

                handlers[0].connection.close.assert_called()
                handlers[1].connection.close.assert_called()
                
                with WATCHER_LOCK:
                    self.assertNotIn(handlers[0], WATCHER_REGISTRY)
                    self.assertNotIn(handlers[1], WATCHER_REGISTRY)
                    self.assertIn(handlers[2], WATCHER_REGISTRY)
                    self.assertIn(handlers[MAX_WATCHERS + 1], WATCHER_REGISTRY)
            finally:
                exit_event.set()
                for t in threads:
                    t.join(0.1)


if __name__ == "__main__":
    unittest.main()

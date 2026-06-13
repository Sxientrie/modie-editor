import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["MODIE_TESTING"] = "1"
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

if __name__ == "__main__":
    unittest.main()

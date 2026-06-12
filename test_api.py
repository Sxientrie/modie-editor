import os
os.environ["MODIE_TESTING"] = "1"
import unittest
from unittest.mock import patch
import json
import io
import shutil
import tempfile
from pathlib import Path
from datetime import datetime

import server
from server import EditorHandler

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
        self.sandbox_patch = patch("server.Path.home", return_value=self.test_dir)
        self.sandbox_patch.start()
        
        import config
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
        (self.test_dir / "termux_home" / "test.md").write_text("Hello")
        
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
        f1.write_text("I like apple")
        f2.write_text("apple juice is sweet")
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
        (self.test_dir / "termux_home" / "src" / "index.js").write_text("const apple = 1;")
        (self.test_dir / "termux_home" / "node_modules" / "some-lib.js").write_text("const apple = 2;")
        
        self.handler.path = "/api/search?query=apple&path=termux_home"
        self.handler._api_search_files()
        self.assertEqual(self.handler.response_status, 200)
        results = self.handler.response_data["results"]
        paths = [r["path"] for r in results]
        self.assertTrue(any("index.js" in p for p in paths))
        self.assertFalse(any("some-lib.js" in p for p in paths))

    @patch("routes_git.GitRoutesMixin._run_git")
    def test_git_status_not_installed(self, mock_run_git):
        mock_run_git.return_value = (-1, "", "git executable not found")
        self.handler.path = "/api/git/status?path=termux_home"
        self.handler.query_params = {"path": "termux_home"}
        self.handler._api_git_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertFalse(self.handler.response_data["git_installed"])

    @patch("routes_git.GitRoutesMixin._find_git_root")
    @patch("routes_git.GitRoutesMixin._run_git")
    def test_git_status_not_in_repo(self, mock_run_git, mock_find_git_root):
        mock_run_git.return_value = (0, "git version 2.40.0", "")
        mock_find_git_root.return_value = None
        self.handler.path = "/api/git/status?path=termux_home"
        self.handler.query_params = {"path": "termux_home"}
        self.handler._api_git_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["git_installed"])
        self.assertFalse(self.handler.response_data["in_repo"])

    @patch("routes_git.GitRoutesMixin._find_git_root")
    @patch("routes_git.GitRoutesMixin._run_git")
    def test_git_status_with_changes(self, mock_run_git, mock_find_git_root):
        repo_dir = self.test_dir / "termux_home"
        repo_dir.mkdir(exist_ok=True)
        mock_find_git_root.return_value = repo_dir
        
        mock_run_git.side_effect = [
            (0, "git version 2.40.0", ""),
            (0, "main\n", ""),
            (0, " M file1.md\nM  file2.md\n?? newfile.txt\n", "")
        ]
        
        self.handler.path = "/api/git/status?path=termux_home"
        self.handler.query_params = {"path": "termux_home"}
        self.handler._api_git_status()
        
        self.assertEqual(self.handler.response_status, 200)
        data = self.handler.response_data
        self.assertTrue(data["git_installed"])
        self.assertTrue(data["in_repo"])
        self.assertEqual(data["branch"], "main")
        self.assertEqual(len(data["staged"]), 1)
        self.assertEqual(len(data["unstaged"]), 1)
        self.assertEqual(len(data["untracked"]), 1)
        self.assertEqual(data["staged"][0]["path"], "file2.md")
        self.assertEqual(data["unstaged"][0]["path"], "file1.md")
        self.assertEqual(data["untracked"][0], "newfile.txt")

    @patch("routes_git.GitRoutesMixin._find_git_root")
    @patch("routes_git.GitRoutesMixin._run_git")
    def test_git_stage(self, mock_run_git, mock_find_git_root):
        repo_dir = self.test_dir / "termux_home"
        repo_dir.mkdir(exist_ok=True)
        mock_find_git_root.return_value = repo_dir
        mock_run_git.return_value = (0, "", "")
        
        payload = json.dumps({"path": "termux_home", "file_path": "file1.md", "stage": True}).encode("utf-8")
        self.handler.rfile = io.BytesIO(payload)
        self.handler.headers = {"Content-Length": str(len(payload))}
        self.handler._api_git_stage()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["ok"])
        mock_run_git.assert_called_with(repo_dir, ["add", "file1.md"])

    def test_file_ops_atomic_write(self):
        from file_ops import atomic_write
        test_file = self.test_dir / "atomic.txt"
        atomic_write(test_file, "atomic content")
        self.assertEqual(test_file.read_text("utf-8"), "atomic content")
        atomic_write(test_file, b"binary content")
        self.assertEqual(test_file.read_bytes(), b"binary content")

    def test_file_ops_create_backup(self):
        from file_ops import create_backup
        test_file = self.test_dir / "source.txt"
        test_file.write_text("source content")
        backup_dir = self.test_dir / "backups"
        backup_path = create_backup(test_file, backup_dir, "MODIE_test")
        self.assertTrue(backup_path.exists())
        self.assertEqual(backup_path.read_text("utf-8"), "source content")
        self.assertEqual(backup_path.parent, backup_dir)

    def test_route_discovery(self):
        from routes_common import GET_ROUTES, POST_ROUTES
        self.assertIn("/api/content", GET_ROUTES)
        self.assertIn("/api/settings", GET_ROUTES)
        self.assertIn("/api/backup-stats", GET_ROUTES)
        self.assertIn("/api/backup-purge", POST_ROUTES)

    def test_backup_stats_and_purge(self):
        import config
        config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        (config.BACKUP_DIR / "MODIE_testfile_20260612_120000.md").write_text("backup content 1")
        (config.BACKUP_DIR / "MODIE_testfile_20260612_130000.md").write_text("backup content 2")
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
        import config
        from routes_backup import cleanup_backups
        config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        f = self.test_dir / "test.md"
        f.write_text("content")
        b1 = config.BACKUP_DIR / "MODIE_testfile_20260612_120000.md"
        b2 = config.BACKUP_DIR / "MODIE_testfile_20260612_130000.md"
        b3 = config.BACKUP_DIR / "MODIE_testfile_20260612_140000.md"
        b1.write_text("1")
        b2.write_text("2")
        b3.write_text("3")
        import os
        import time
        now = time.time()
        os.utime(b1, (now - 40 * 86400, now - 40 * 86400))
        os.utime(b2, (now - 10, now - 10))
        os.utime(b3, (now, now))
        cleanup_backups(f, "MODIE_testfile", max_per_file=1, max_age_days=30)
        self.assertFalse(b1.exists())
        self.assertFalse(b2.exists())
        self.assertTrue(b3.exists())

if __name__ == "__main__":
    unittest.main()

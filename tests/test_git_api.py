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

from tests.test_api import TestableEditorHandler

class TestGitAPI(unittest.TestCase):
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

    @patch("backend.routes_git.GitRoutesMixin._run_git")
    def test_git_status_not_installed(self, mock_run_git):
        mock_run_git.return_value = (-1, "", "git executable not found")
        self.handler.path = "/api/git/status?path=termux_home"
        self.handler.query_params = {"path": "termux_home"}
        self.handler._api_git_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertFalse(self.handler.response_data["git_installed"])

    @patch("backend.routes_git.GitRoutesMixin._find_git_root")
    @patch("backend.routes_git.GitRoutesMixin._run_git")
    def test_git_status_not_in_repo(self, mock_run_git, mock_find_git_root):
        mock_run_git.return_value = (0, "git version 2.40.0", "")
        mock_find_git_root.return_value = None
        self.handler.path = "/api/git/status?path=termux_home"
        self.handler.query_params = {"path": "termux_home"}
        self.handler._api_git_status()
        self.assertEqual(self.handler.response_status, 200)
        self.assertTrue(self.handler.response_data["git_installed"])
        self.assertFalse(self.handler.response_data["in_repo"])

    @patch("backend.routes_git.GitRoutesMixin._find_git_root")
    @patch("backend.routes_git.GitRoutesMixin._run_git")
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

    @patch("backend.routes_git.GitRoutesMixin._find_git_root")
    @patch("backend.routes_git.GitRoutesMixin._run_git")
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
        mock_run_git.assert_called_with(repo_dir, ["add", "--", "file1.md"])

if __name__ == "__main__":
    unittest.main()

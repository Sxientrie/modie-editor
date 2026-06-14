import os
import subprocess
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import config
from .routes_common import get_route, post_route, validate_json, validate_query


_GIT_ROOT_MAX_DEPTH = 30

_MAX_COMMIT_MSG_LEN = 4096

class GitRoutesMixin:

    # Platform quirk workaround: Git status output (porcelain format) wraps non-ASCII paths in quotes
    # and escapes bytes using octal notation (e.g., "\303\251"). We decode these sequences to original
    # bytes using Latin-1 and then decode them as UTF-8.
    def _unescape_git_path(self, path_str):
        path_str = path_str.strip()
        if path_str.startswith('"') and path_str.endswith('"'):
            try:
                import codecs
                escaped_bytes = path_str[1:-1].encode('latin1')
                unescaped_bytes, _ = codecs.escape_decode(escaped_bytes)
                return unescaped_bytes.decode('utf-8')
            except Exception:
                return path_str.strip('"')
        return path_str

    def _find_git_root(self, target_path):
        if target_path.is_file():
            curr = target_path.parent
        else:
            curr = target_path

        depth = 0
        while depth < _GIT_ROOT_MAX_DEPTH:
            if (curr / ".git").is_dir():
                return curr
            try:
                parent = curr.parent
                self._resolve_and_validate(str(parent))
                if parent == curr:
                    break
                curr = parent
                depth += 1
            except Exception:
                break
        return None

    def _run_git(self, repo_dir, args):
        try:
            res = subprocess.run(
                ["git"] + args,
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=10
            )
            return res.returncode, res.stdout, res.stderr
        except FileNotFoundError:
            return -1, "", "git executable not found"
        except subprocess.TimeoutExpired:
            return -2, "", "git command timed out"
        except Exception as e:
            return -3, "", f"Execution error: {e}"

    @get_route("/api/git/status")
    @validate_query(["path"])
    def _api_git_status(self):
        path_param = self.query_params["path"]
        try:
            target_path = self._resolve_and_validate(path_param) if path_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        code, out, err = self._run_git(Path.home(), ["--version"])
        if code == -1:
            self._send_json({"git_installed": False})
            return

        repo_root = self._find_git_root(target_path)
        if not repo_root:
            self._send_json({"git_installed": True, "in_repo": False})
            return

        code, branch_out, branch_err = self._run_git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        branch = branch_out.strip() if code == 0 else "HEAD (detached)"

        code, status_out, status_err = self._run_git(repo_root, ["status", "--porcelain"])
        if code != 0:
            self._send_json({"error": f"Git status failed: {status_err}"}, 500)
            return

        staged = []
        unstaged = []
        untracked = []

        for line in status_out.splitlines():
            if len(line) < 4:
                continue
            x = line[0]
            y = line[1]


            raw_path = line[3:]
            if (x in ('R', 'C') or y in ('R', 'C')) and " -> " in raw_path:
                parts = raw_path.split(" -> ", 1)
                filepath = self._unescape_git_path(parts[1])
            else:
                filepath = self._unescape_git_path(raw_path)

            if x == '?' and y == '?':
                untracked.append(filepath)
            else:
                if x != ' ' and x != '?':
                    staged.append({"path": filepath, "status": x})
                if y != ' ' and y != '?':
                    unstaged.append({"path": filepath, "status": y})

        self._send_json({
            "git_installed": True,
            "in_repo": True,
            "repo_root": str(repo_root),
            "branch": branch,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked
        })

    @post_route("/api/git/stage")
    @validate_json(["path", "file_path", "stage"])
    def _api_git_stage(self):
        path_param = self.request_data["path"]
        file_path = self.request_data["file_path"]
        stage = self.request_data["stage"]

        try:
            target_path = self._resolve_and_validate(path_param) if path_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        repo_root = self._find_git_root(target_path)
        if not repo_root:
            self._send_json({"error": "Not in a Git repository"}, 400)
            return


        if stage:
            code, out, err = self._run_git(repo_root, ["add", "--", file_path])
        else:
            code, out, err = self._run_git(repo_root, ["reset", "HEAD", "--", file_path])

        if code != 0:
            self._send_json({"error": f"Failed to stage/unstage file: {err}"}, 500)
            return

        self._send_json({"ok": True})

    @post_route("/api/git/commit")
    @validate_json(["path", "message"])
    def _api_git_commit(self):
        path_param = self.request_data["path"]
        message = self.request_data["message"]

        if not message.strip():
            self._send_json({"error": "Commit message cannot be empty"}, 400)
            return

        if len(message) > _MAX_COMMIT_MSG_LEN:
            self._send_json({"error": f"Commit message too long (max {_MAX_COMMIT_MSG_LEN} characters)"}, 400)
            return

        try:
            target_path = self._resolve_and_validate(path_param) if path_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        repo_root = self._find_git_root(target_path)
        if not repo_root:
            self._send_json({"error": "Not in a Git repository"}, 400)
            return

        code, out, err = self._run_git(repo_root, ["commit", "-m", message])
        if code != 0:
            if "Please tell me who you are" in err or "identity" in err.lower():
                self._send_json({
                    "error": "Git identity not configured. Please run standard configuration commands in Termux:\n"
                             "git config --global user.email \"you@example.com\"\n"
                             "git config --global user.name \"Your Name\""
                }, 400)
                return
            self._send_json({"error": f"Commit failed: {err or out}"}, 500)
            return

        self._send_json({"ok": True})

    @get_route("/api/git/diff")
    @validate_query(["path", "file_path", "staged"])
    def _api_git_diff(self):
        path_param = self.query_params["path"]
        file_path = self.query_params["file_path"]
        staged = self.query_params["staged"].lower() == "true"

        try:
            target_path = self._resolve_and_validate(path_param) if path_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        repo_root = self._find_git_root(target_path)
        if not repo_root:
            self._send_json({"error": "Not in a Git repository"}, 400)
            return


        args = ["diff", "--cached", "--", file_path] if staged else ["diff", "--", file_path]
        code, out, err = self._run_git(repo_root, args)
        if code != 0:
            self._send_json({"error": f"Diff failed: {err}"}, 500)
            return

        self._send_json({"diff": out})

    @post_route("/api/git/init")
    @validate_json(["path"])
    def _api_git_init(self):
        path_param = self.request_data["path"]

        try:
            target_path = self._resolve_and_validate(path_param) if path_param else config.DEFAULT_MD_PATH
        except PermissionError as e:
            self._send_json({"error": str(e)}, 403)
            return

        if target_path.is_file():
            target_dir = target_path.parent
        else:
            target_dir = target_path

        code, out, err = self._run_git(target_dir, ["init"])
        if code != 0:
            self._send_json({"error": f"Failed to initialize Git repository: {err}"}, 500)
            return

        self._send_json({"ok": True})

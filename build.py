import hashlib
from pathlib import Path
import os
import subprocess
import secrets
import re
import sys
import glob

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

def run_tests():
    test_files = sorted(glob.glob("tests/test-*.js"))
    if not test_files:
        print("  No test files found, skipping tests.")
        return True
    print(f"  Found {len(test_files)} test file(s)")
    all_passed = True
    for tf in test_files:
        result = subprocess.run(["node", tf], capture_output=True, text=True)
        status = "PASS" if result.returncode == 0 else "FAIL"
        print(f"  [{status}] {tf}")
        if result.returncode != 0:
            all_passed = False
            sys.stderr.write(result.stdout)
            sys.stderr.write(result.stderr)
            
    print("  Running API integration tests...")
    result_py = subprocess.run(["python3", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], capture_output=True, text=True)
    status_py = "PASS" if result_py.returncode == 0 else "FAIL"
    print(f"  [{status_py}] Python unittest discover")
    if result_py.returncode != 0:
        all_passed = False
        sys.stderr.write(result_py.stdout)
        sys.stderr.write(result_py.stderr)
            
    return all_passed

def compute_hash():
    h = hashlib.sha256()
    static_dir = Path("static").resolve()
    for root, dirs, files in os.walk(static_dir):
        for file in sorted(files):
            file_path = Path(root) / file
            if file == "sw.js" or "bundle" in file:
                continue
            try:
                h.update(file_path.read_bytes())
            except Exception:
                pass
    return h.hexdigest()[:8]

def compute_hash_production():
    h = hashlib.sha256()
    production_files = [
        Path("static/index.html"),
        Path("static/css/styles.bundle.css"),
        Path("static/js/app.bundle.js"),
        Path("static/js/lucide.min.js"),
        Path("static/icon_v1.png")
    ]
    for fp in production_files:
        if fp.exists():
            h.update(fp.read_bytes())
    return h.hexdigest()[:8]

def update_sw():
    sw_path = Path("static/sw.js")
    if not sw_path.exists():
        return
    h = compute_hash()
    content = sw_path.read_text("utf-8")
    new_content = re.sub(
        r'const CACHE_NAME = "[^"]+";',
        f'const CACHE_NAME = "modie-{h}";',
        content
    )
    atomic_write(sw_path, new_content, "utf-8")

def update_sw_production(cache_hash):
    sw_path = Path("static/sw.js")
    if not sw_path.exists():
        return
    content = sw_path.read_text("utf-8")
    assets_block = """const ASSETS = [
    "/",
    "/static/index.html",
    "/static/css/styles.bundle.css",
    "/static/js/app.bundle.js",
    "/static/js/lucide.min.js",
    "/static/icon_v1.png"
];"""
    content = re.sub(
        r'const ASSETS = \[[^\]]+\];',
        assets_block,
        content
    )
    content = re.sub(
        r'const CACHE_NAME = "[^"]+";',
        f'const CACHE_NAME = "modie-{cache_hash}";',
        content
    )
    atomic_write(sw_path, content, "utf-8")

def bundle_assets():
    import shutil
    esbuild_cmd = ["esbuild"]
    try:
        subprocess.run(["esbuild", "--version"], capture_output=True)
    except FileNotFoundError:
        termux_esbuild = "/data/data/com.termux/files/usr/lib/node_modules/esbuild/bin/esbuild"
        if os.path.exists(termux_esbuild):
            esbuild_cmd = ["node", termux_esbuild]
        else:
            print("  esbuild not found. Installing globally...")
            subprocess.run(["npm", "install", "-g", "esbuild"], capture_output=True)
            if os.path.exists(termux_esbuild):
                esbuild_cmd = ["node", termux_esbuild]
            else:
                print("  Failed to install esbuild. Skipping bundle.")
                return False

    temp_build_dir = Path.home() / ".modie_temp_build"
    try:
        if temp_build_dir.exists():
            shutil.rmtree(temp_build_dir)
        temp_build_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(Path("static"), temp_build_dir / "static")

        print("  Bundling JS...")
        subprocess.run(
            esbuild_cmd + ["./static/js/app.js", "--bundle", "--minify", "--outfile=./static/js/app.bundle.js"],
            cwd=str(temp_build_dir),
            check=True,
            capture_output=True
        )
        print("  Bundling CSS...")
        subprocess.run(
            esbuild_cmd + ["./static/css/styles.css", "--bundle", "--minify", "--outfile=./static/css/styles.bundle.css"],
            cwd=str(temp_build_dir),
            check=True,
            capture_output=True
        )
        
        Path("static/js").mkdir(parents=True, exist_ok=True)
        Path("static/css").mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp_build_dir / "static/js/app.bundle.js", Path("static/js/app.bundle.js"))
        shutil.copy2(temp_build_dir / "static/css/styles.bundle.css", Path("static/css/styles.bundle.css"))
        return True
    except Exception as e:
        print(f"  Bundling failed: {e}")
        return False
    finally:
        if temp_build_dir.exists():
            try:
                shutil.rmtree(temp_build_dir)
            except Exception:
                pass

def main():
    print("[1/3] Running tests...")
    if not run_tests():
        print("\nBuild ABORTED: tests failed.")
        sys.exit(1)
    print("[2/3] Bundling and updating SW cache...")
    index_path = Path("static/index.html")
    sw_path = Path("static/sw.js")
    orig_index = index_path.read_text("utf-8")
    orig_sw = sw_path.read_text("utf-8")
    try:
        if bundle_assets():
            new_index = orig_index
            new_index = new_index.replace(
                'href="/static/css/styles.css"',
                'href="/static/css/styles.bundle.css"'
            )
            new_index = new_index.replace(
                'type="module" src="/static/js/app.js"',
                'src="/static/js/app.bundle.js"'
            )
            atomic_write(index_path, new_index, "utf-8")
            p_hash = compute_hash_production()
            update_sw_production(p_hash)
        else:
            update_sw()
        print("[3/3] Packaging zip...")
        zip_path = Path("modie-editor.zip")
        if zip_path.exists():
            try:
                zip_path.unlink()
            except Exception:
                pass
        subprocess.run(["zip", "-r", "modie-editor.zip", "server.py", "backend", "README.md", "GEMINI.md", "static", "modie", "build.py", "tests"])
    finally:
        atomic_write(index_path, orig_index, "utf-8")
        atomic_write(sw_path, orig_sw, "utf-8")
        bundle_js = Path("static/js/app.bundle.js")
        bundle_css = Path("static/css/styles.bundle.css")
        if bundle_js.exists():
            try:
                bundle_js.unlink()
            except Exception:
                pass
        if bundle_css.exists():
            try:
                bundle_css.unlink()
            except Exception:
                pass
    update_sw()
    print("\nBuild complete.")

if __name__ == "__main__":
    main()

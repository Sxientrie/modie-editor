# MODiE: A Zero-Dependency Mobile Text Workspace

If you have stumbled upon this repository, welcome. You are looking at a zero-dependency mobile text editor and file explorer, built to run a local, multi-threaded Python web server inside a rootless Android terminal emulator (Termux) to edit text files (`.md, .js .txt .html, etc.`) via a custom Progressive Web App (PWA).

---

## 🧠 Conceptual Overview & Architectural Constraints

Running a local web app on Android via Termux introduces unique operating system constraints that most web developers never have to think about. This project was structured specifically to survive them.

### 1. Android's Low Memory Killer (LMKD) & Process Lifecycle
On Android, background processes are treated as second-class citizens. If the system experiences memory pressure, the LMKD or the Phantom Process Killer will silently kill the Termux terminal session or terminate the background Chrome tab. 
* **The Solution**: To prevent data loss when Android terminates the app mid-sentence, the editor implements a dual-caching strategy. The frontend writes raw inputs to `localStorage` on every keystroke. If the server is killed, the frontend caches changes locally and recovers the state upon the next successful handshake.

### 2. Threading in Python's Standard HTTP Server
Python's default `http.server.BaseHTTPRequestHandler` is single-threaded. In a modern browser environment where a Single Page Application concurrently requests `index.html`, `styles.css`, `app.js`, and API endpoints, a single-threaded server blocks incoming connections until the active socket is closed.
* **The Solution**: The server extends `socketserver.ThreadingMixIn` to spawn a new lightweight thread for each request. This prevents asset-loading bottlenecks and keeps the editor responsive even when large files are being read or written in the background.

### 3. File System Safety via Atomic Writes & Backups
Writing data directly to a target file on a mobile storage layer is a recipe for corruption. If the battery dies or the process is killed while Python is writing to a file, the file is truncated, leaving you with half a document.
* **The Solution**: The server writes content to a temporary file (`.tmp`) in the same directory first. Once the write operation completes successfully, the server performs an atomic rename using `os.replace()`. At the OS level, this updates the filesystem directory entry pointer instantly, ensuring that you either have the old file intact or the complete new file, with zero chance of corruption. Additionally, a backup rotation scheme preserves up to 20 historical copies of your files under `~/.modie/.backups/`.

### 4. Zero-Dependency Markdown Parsing
Rather than pulling in heavy external libraries, the frontend uses a stateful line-by-line parser (`markdown.js`). Regular expressions are excellent for inline styles (like bold or italics), but they fail spectacularly when parsing nested block structures (like code blocks containing markdown syntax). The custom parser runs a state machine that tracks whether the scanner is currently inside a code block, ensuring code blocks are rendered as raw text without leaking formatting into the parent layout.

### 5. Preference Synchronization
To keep preferences consistent across multiple browsers or app sessions, client configuration settings (Theme, Font Size, Hidden Files, Auto-Save Delay) are synchronized in real-time between the browser state and a unified JSON configuration file (`~/.modie/settings.json`) managed by the server.

---

## 📂 The File Manifest

* [server.py](file:///storage/emulated/0/Termux/modie-editor/server.py): Threaded Python server. Handles routing, mime types, and atomic writes.
* [static/index.html](file:///storage/emulated/0/Termux/modie-editor/static/index.html): SPA layout. Hosts editing panels, outline drawers, and modals.
* [static/css/styles.css](file:///storage/emulated/0/Termux/modie-editor/static/css/styles.css): Flexbox/Grid dark mode stylesheet with HSL variables.
* [static/js/app.js](file:///storage/emulated/0/Termux/modie-editor/static/js/app.js): Application lifecycle bootstrapper.
* [static/js/api.js](file:///storage/emulated/0/Termux/modie-editor/static/js/api.js): REST interface that appends auth tokens to headers.
* [static/js/ui.js](file:///storage/emulated/0/Termux/modie-editor/static/js/ui.js): Handles Table of Contents, scroll synchronization, and format insertion.
* [static/js/markdown.js](file:///storage/emulated/0/Termux/modie-editor/static/js/markdown.js): Custom line-by-line Markdown parser.
* [static/manifest.json](file:///storage/emulated/0/Termux/modie-editor/static/manifest.json): Configuration file promoting the web page to a standalone PWA.
* [static/sw.js](file:///storage/emulated/0/Termux/modie-editor/static/sw.js): Cache-first offline service worker.
* [static/icon_v1.png](file:///storage/emulated/0/Termux/modie-editor/static/icon_v1.png): Renamed high-resolution PWA launcher icon.
* [modie](file:///data/data/com.termux/files/usr/bin/modie): Bash helper command.

---

## 📥 Installation

Because you received this as a standalone ZIP archive rather than a clean package registry release, you have to do the heavy lifting yourself. 

### Prerequisites
Ensure Termux has Python 3 installed:
```bash
pkg update && pkg install python
```

### Setup Steps
1. **Extract the Archive**:
   Extract the zip package to your target directory. For consistency with the defaults, we assume `/storage/emulated/0/Termux/modie-editor`:
   ```bash
   unzip modie-editor.zip -d /storage/emulated/0/Termux/modie-editor
   ```
   The `modie` script resolves the path to `server.py` dynamically if you symlink the script or run it directly from the extracted directory. If you copy the script as a standalone file into your `PATH`, it automatically falls back to looking for `server.py` at `/storage/emulated/0/Termux/modie-editor/server.py`.

2. **Configure the CLI Utility**:
   Copy the `modie` helper script into your system path (`$PREFIX/bin`), and mark it as executable:
   ```bash
   cp /storage/emulated/0/Termux/modie-editor/modie $PREFIX/bin/modie
   chmod +x $PREFIX/bin/modie
   ```

3. **Verify Installation**:
   Ensure the setup was successful by running:
   ```bash
   modie status
   ```

---

## 🛠️ CLI Operations

If you are trying to run this setup, use the `modie` wrapper script:

```bash
modie start    # Starts the server in the background and opens the PWA
modie stop     # Terminates the server process cleanly
modie restart  # Restarts the server
modie status   # Checks if port 8765 is actively bound
modie log      # Tails the last 30 lines of backend logs
modie debug    # Runs full system diagnostics and API health check
modie install  # Installs modie globally to user execution path
```

---

## 🏗️ Development & Build Pipeline

If you modify any static files (`static/js/*.js`, `static/css/*.css`, `static/index.html`, etc.), you do **not** need to manually update the Service Worker cache name (`CACHE_NAME` in `static/sw.js`) to bust the browser cache.

Instead, run the build script:
```bash
python3 build.py
```

This script will automatically:
1. **Run Tests**: Execute Node.js unit tests on the custom Markdown parser (`test-markdown.js`).
2. **Compute Asset Hashes**: Calculate a SHA-256 content hash of all static assets (except `sw.js`).
3. **Bust Cache**: Dynamically inject the new hash into the `CACHE_NAME` string in `static/sw.js`.
4. **Package**: Build the final release archive `modie-editor.zip` including `server.py`, `README.md`, `static/`, and the `modie` executable script.

---

## 🔒 Security Model

Because Android exposes loopback ports globally to all apps on the device, any rogue application could query `localhost:8765` and read your files. The system guards against this via token authentication:

1. **Token Generation**: On boot, the server generates a token and writes it to `~/.modie/.token`.
2. **Handshake**: The `modie` startup script opens the browser with the token appended to the URL query parameters.
3. **Consumption**: The frontend reads the parameter, stores it in `localStorage`, and calls `history.replaceState` to strip the token from the browser history.
4. **Requests**: Future API requests use the `X-Editor-Token` header. Missing or invalid tokens result in a `401 Unauthorized` response, blocking input and triggering the login modal.

---

## ⚠️ Markdown Parser Limitations

Because this project uses a custom, zero-dependency stateful line-by-line block parser rather than a heavy library like `marked` or `markdown-it`, it makes a few architectural trade-offs to keep the codebase small:
* **Multi-line Blockquotes**: Consecutive blockquote lines starting with `> ` will emit separate `<blockquote/>` HTML elements rather than wrapping them in a single container.
* **No Image Syntax**: Standard markdown image markup (`![alt](url)`) is not parsed. If you need images, embed raw `<img />` tags.
* **No Setext Headers**: Double-underlined headers (`===` for `h1` or `---` for `h2`) are not supported, as they conflict with horizontal rule rendering. Always use standard ATX `#` heading prefixes.

---

## 🧠 The MIME-Sniffing Trap

If you try to write your own server, do not serve JavaScript files with generic content headers. 

Chromium enforces strict MIME-type checking for Service Workers. If `sw.js` is served with `text/plain` or `application/octet-stream`, the browser will abort registration immediately with a security error. This project's server intercepts requests and maps extensions to their exact MIME types (`application/javascript` for `.js`, `image/png` for `.png`) to ensure registration succeeds.

---

## 👨‍💻 About the Developer & Company

**MODiE Editor** is developed and maintained by **Jason Jamora** (aka **Sxentrie**).

* **Developer:** Jason Jamora (Sxentrie)
* **Company:** Sxentrie IT Solutions
* **Mission:** Providing lightweight, robust, and mobile-optimized developer tools and IT solutions.


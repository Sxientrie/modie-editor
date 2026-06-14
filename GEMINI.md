# Codebase Rules

These are the rules. All of them. Follow them.

---

### 1. Comment-Free Code Policy

Don't write comments that describe what the code does. The code does that. That's what code is.

Write a comment when any of the following are actually true:
- The decision is architectural and the reasoning isn't obvious from structure alone.
- The code works around a platform-specific quirk — Android FAT32/exFAT behavior, Termux path constraints, that kind of nonsense.
- A cleaner or more obvious implementation was deliberately skipped. Say why. Future you will thank present you.
- A security constraint is driving the implementation somewhere non-obvious.
- The behavior would look like a bug to anyone who didn't write it. Which is everyone, including you in six months.

The rule is: no "what" comments. "Why" comments are required when the why isn't obvious. `#!` shebangs are fine, don't touch those.

---

### 2. Safe Atomic Writes

Never write directly to the target file. Not once. Not "just this time."

Write to a randomly-named temp file in the same directory:
`file_path.parent / (file_path.name + '.' + secrets.token_hex(4) + '.tmp')`

Swap atomically with `os.replace()`. Wrap `os.fsync()` in a `try/except OSError` — Android FAT32/exFAT doesn't always implement fsync and it will blow up if you don't account for that.

Direct writes are how you corrupt files halfway through and leave users with truncated garbage. Don't.

---

### 3. Path-Bound Autosave Drafts

Every local editor draft is unique and bound to its file path. Keys are: `modie_draft_[filepath]`.

One flat key — `modie_draft` — shared across different files is how you get cross-file draft clobbering. Someone opens File A, their draft from File B silently overwrites recovery state, and now you're explaining to a user why their work is gone. Use the per-path key. Always.

---

### 4. Dual-Root Sandbox & Security

All file operations stay inside the dual-root path system: `termux_home` and `storage_shared`. That's the sandbox. Stay in it.

Resolve all paths with `Path.resolve()` before validating they fall within an allowed root. Validating unresolved paths doesn't work — traversal attacks operate on unresolved segments. Resolve first, validate second, every time.

Sanitize all dynamic paths, filenames, and breadcrumb values against XSS using the unified `escapeHtml` function from `utils.js`. "Internal" values are not exempt. They're called internal until the day they aren't, and by then it's too late.

---

### 5. Token Authentication

All API requests authenticate via a randomized secure token in the `X-Editor-Token` header.

On client load: extract the token from query params, store it in `localStorage`, then immediately strip it from the URL with `history.replaceState`. A token sitting in the URL is a token in the server logs. That's not where tokens live.

Regenerate and rotate the token file on every server boot.

**On the localStorage pattern:** yes, `localStorage` is used here. That's acceptable because this is a local-only Termux tool with exactly one trusted user. Do not copy this pattern to anything network-exposed or multi-user. It would be inadequate there and you would deserve what happened next.

---

### 6. Offline-First PWA Caching

Every new static asset you create must be manually added to the `ASSETS` registry array in `static/sw.js`. This is not automated. It will not remind you. A missing entry causes a silent offline cache miss — no error, no warning, the asset just isn't there when you're offline and you'll spend an hour debugging something invisible.

Add the entry. Every time.

Do not manually edit or increment `CACHE_NAME` in `static/sw.js`. It's auto-generated from a SHA-256 content hash of all static assets by `build.py`. Your manual edit will be overwritten, cache invalidation will break, and users will get stale builds. Let `build.py` own it.

---

### 7. Packaging and Delivery

After any codebase change, run: `python3 build.py`

In order, it:
1. Runs all unit tests (`test-*.js` via Node.js). Any failure aborts everything.
2. Computes a SHA-256 content hash of all static assets.
3. Writes that hash into `CACHE_NAME` in `static/sw.js`.
4. Runs: `zip -r modie-editor.zip server.py README.md static modie`

Do not run the `zip` command directly. Doing so skips test verification, skips cache invalidation, and ships a broken or stale build. If you bypass `build.py` and something breaks in production, that's on you and there's no ambiguity about why.

---

### 8. Modularity & Concern Separation

Each file owns one concern. That's it. One.

Keep files under 300 lines. If you're approaching 400, stop adding features and refactor secondary concerns into separate modules. `api`, `ui`, `gestures`, `context-menus`, `markdown` rendering — these belong in their own files, not crammed together because splitting felt like overhead at the time.

No heavy libraries. Vanilla, dependency-free, lightweight. Every import is a liability.

---

### 9. Error Handling

All server-side API errors return structured JSON: `{ "error": "<message>" }` with an appropriate HTTP status code. No plain-text error strings from API endpoints. A client that gets back unexpected text instead of JSON will fail in weird ways and the debugging will be miserable.

All client-side `fetch` calls handle both network failures and non-2xx responses explicitly. A resolved promise is not a successful response. Check the status.

Errors surface to the user through the existing UI notification system. Silent failures are not failures you don't have to deal with — they're failures the user can't recover from because they don't know something went wrong.

Log server-side errors to stderr with enough context to trace the failure: endpoint, operation type, sanitized path. Never raw user input in logs. Ever.

---

### 10. Testing

Every new feature and every non-trivial bug fix gets a corresponding test in a `test-*.js` file. Not eventually. Now, with the change.

Tests cover behavior, not implementation internals. Test what a function does. Not how. If the test breaks when you refactor internals without changing behavior, the test was wrong.

Platform-specific edge cases need dedicated coverage: Android path formats, FAT32 atomic write behavior, token extraction from URL. Happy-path-only coverage is not sufficient for this environment. The edge cases are where this codebase actually lives.

Do not delete or weaken an existing test to make a build pass. If a test is failing, fix the code. The test is telling you something true.

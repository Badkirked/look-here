# Look Here Hub Edition 1.2.0

The hub edition adds saved marks, redaction, durable drafts, project/task labels, reviewed acknowledgements and optional tmux link monitoring. It is a separate extension from the standalone offline-export edition in `../extension/`.

## Install the extension

Load `hub/extension/` as an unpacked extension, or extract the `look-here-hub-1.2.0.zip` release asset and load its `look-here-hub` folder. Open Options, enter your own hub origin, and click **Connect** to grant that host permission. No host is pre-permitted and no private deployment address is included. The suggested origin is `http://localhost:8420`.

This edition requires a compatible authenticated hub to save marks; it does not replace the standalone edition's offline export or arbitrary receiver contract. It uses your hub's browser session cookies. Use HTTPS for remote access. The extension does not implement sign-in or create server authentication. Unpacked upgrades require replacing files and clicking Reload in the browser's Extensions page. Chromium is tested; Edge has not been separately tested.

See [extension usage and limits](extension/README.md).

## Server integration

These are FastAPI adapters for an existing hub, **not a standalone public upload server**. Authentication/authorization, secure cookie configuration, same-origin/CSRF enforcement and access to stored files belong to the host application. Authenticate every `/api/look-here/*` and `/files/*` route. The adapters assume a single trusted hub owner; they do not implement per-user tenant isolation. Do not deploy the test fixture as a service.

`look_here_captures.install(app, get_db, uploads)` registers the capture API. `get_db()` returns a fresh SQLite connection with `sqlite3.Row` row factory. `uploads` is a pathlib.Path directory. The host must supply its existing `uploads` table with columns:

```
id INTEGER PRIMARY KEY, filename TEXT, original_name TEXT, path TEXT,
mime_type TEXT, size_bytes INTEGER, uploader TEXT, tags TEXT,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
```

The adapter creates its own metadata/config tables. The host provides authenticated `/files/{filename}` access with path containment checks. Captures are JSON bundles containing PNG data URLs, labels and a stable per-revision `saveKey`; the limit is 32 MiB. Matching retries return the existing ID; different content under the same key is rejected. Deletion removes the capture JSON and its database entries. Capture expiry is opt-in; back up storage before changing retention.

`look_here_urls.install(app, machines, ssh_exec)` registers URL/status/retention routes and returns an async collector function. Start that function in your app's lifespan and cancel it on shutdown. `machines()` returns a mapping of machine labels to records containing `ip` and optional `ssh_port`. `ssh_exec(machine, command, timeout)` is the host's existing trusted SSH executor and returns stdout. The adapter ships no host inventory, keys, passwords or SSH setup. Set the module's `DATABASE` to a private writable path before calling install if its default location beside the module is unsuitable.

The server collector polls configured machines every 15 seconds while running. The extension's watcher toggle controls browser polling/opening, not the server collector. It discovers sockets for the configured SSH user under `/tmp/tmux-UID`, including detached panes, and retains hashes rather than raw terminal text. URLs themselves are stored. Initial panes are baselined; output beyond the last 1,000 lines can be missed. Status reports staleness/failures and detectable history gaps; collection is not lossless. Filtering rejects recognised credential patterns but cannot identify every secret URL.

The hub reader in `../skills/look-here-hub/scripts/review.py` accepts `--hub` or `LOOK_HERE_HUB`. It does not copy browser cookies or bypass authentication: run through an access path your hub already authorizes. The standalone offline reader remains available separately.

## Verification

Run from the repository root:

```bash
python3 -m pip install -r hub/requirements-test.txt
python3 -m unittest discover -s hub/tests -p 'test_*.py'
node hub/tests/watcher.mjs
```

For the isolated Chromium integration test, run the fixture **only on loopback** in one terminal:

```bash
python3 -m uvicorn fixture:app --app-dir hub/tests --host 127.0.0.1 --port 18420
```

Then, using a recent Chromium supporting the Extensions DevTools domain and Node.js with global WebSocket:

```bash
CHROME_PATH=/path/to/chromium node hub/tests/e2e.mjs
```

The runner copies the extension into an isolated temporary directory and grants only the loopback fixture in that copy. It checks capture, black pixels in both redacted uploads, lost-reply retry without duplicates, labels, draft restoration, pause races and history. Screenshots go to `test-results/hub/`. Temporary browser/fixture directories contain synthetic data, not user captures.

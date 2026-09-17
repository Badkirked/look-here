# Look Here

Point at something in your browser instead of writing a long description.

Look Here captures the visible page, opens a frozen copy, and lets you click, draw, or box the part you mean. Export the screenshot and note for a coding assistant, or send it to a receiver you control.

[Try the interactive demo](https://badkirked.github.io/look-here/) · [Download releases](https://github.com/Badkirked/look-here/releases)

## Choose an edition

| Edition | Install folder | Use it for |
| --- | --- | --- |
| Standalone | `extension/` | Offline JSON export and optional upload to your own receiver |
| Hub 1.2.0 | `hub/extension/` | Redaction, saved marks/history, project labels and optional tmux link review with a compatible authenticated hub |

[Hub installation and integration](hub/README.md) · [1.2.0 changes](CHANGELOG.md)

The editions are separate packages. The public hub edition contains no private host inventory, credentials or default LAN destination. The instructions and privacy behavior below apply to the **standalone edition**; use the hub guide for 1.2.0.

## Install

1. Download this repository and extract it.
2. Open `chrome://extensions` (Chrome/Chromium) or `edge://extensions` (Edge).
3. Enable **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
4. Pin **Look Here** in the extensions menu.

This is an unpacked developer release, not a Chrome Web Store listing. Chromium is tested; Edge uses the same package but has not been separately tested.

## Use

Open a page and scroll to the area you want to discuss. Click the extension icon, or press **Ctrl+Shift+Y** (**Command+Shift+Y** on macOS). Mark anywhere on the screenshot, add a note, and choose **Export file**.

Give the exported JSON to your assistant through your usual file workflow. The optional skill under `skills/look-here/` includes an offline Python reader that extracts the two PNGs for the assistant to inspect:

```bash
python3 skills/look-here/scripts/read_capture.py /path/to/export.json
```

The reader uses Python 3 standard libraries, makes no network requests, and creates private temporary image files. Remove the extracted files after use according to your own retention policy.

The capture covers the current viewport, including text, controls, images, and 3D renders. Scroll before capturing content farther down. It does not capture browser chrome, stitch a long scrolling document, monitor clicks continuously, or submit messages to your assistant automatically.

## Optional receiver

Local export needs no account or server. To upload instead, open extension **Settings**, enter your receiver's exact upload URL, and grant access to that host. HTTPS is the default requirement. HTTP to a private IP address or localhost requires an explicit opt-in and is not encrypted.

Bearer tokens are stored in browser session storage and must be re-entered after a browser restart. The extension sends no cookies and follows no redirects. It displays the destination before upload and refuses to send if settings changed since the marking tab loaded. The receiver, not this extension, must enforce authentication.

See [the receiver contract](docs/receiver.md). No upload server is bundled; do not expose an unauthenticated development upload service to the internet.

## Privacy

- No telemetry, analytics, remotely loaded code, or default upload destination.
- Capture happens only when you invoke the extension. The screenshot remains local until you export or upload.
- Exports include **both the original screenshot and marked image**. Marks do not redact content. Inspect everything visible before sharing.
- URL query strings, fragments, and embedded credentials are stripped from metadata. Page titles, URL paths, and the screenshot itself can still contain sensitive information.
- Local drafts expire after 24 hours, with a maximum of 10. Cleanup runs while the browser is running and on the next use. Use **Delete all local drafts** in Settings for immediate removal; close open editor tabs to clear their in-memory copies.
- Successful upload removes that local draft. Downloads and receiver copies have their own retention.

Details and review scope: [SECURITY.md](SECURITY.md).

## Development

There is no build system and no third-party runtime dependency.

```bash
node --test tests/policy.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

The automated browser integration runner is `tests/browser.mjs`. It requires a Chrome/Chromium binary provided via `CHROME_PATH`, a recent Node.js with global WebSocket, and `HEADFUL=1` with a display. Accept the isolated test browser’s permission prompt for `127.0.0.1`. On Linux, `xvfb-run` plus `TEST_ACCEPT_PERMISSION=1` can automate that prompt using Python Xlib and Pillow. It installs the unpacked extension into an isolated profile and checks capture, local export, optional uploads, and failure handling against synthetic content.

## License

[MIT](LICENSE). Copyright (c) 2026 Badkirked.

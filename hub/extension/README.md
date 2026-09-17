# Look here 1.2.0

Capture a browser viewport, annotate or redact it, and save a numbered mark to your authenticated Look here hub. Optional tmux monitoring opens or queues links from the hub's configured machines.

Install/update: extract the ZIP into a persistent folder. Chrome/Edge > Extensions > Developer mode > Load unpacked (first install) or Reload (after replacing files in the existing folder). Unpacked extensions do not update themselves. Open extension Options for hub connection, version checks, watcher controls, local drafts and saved history.

Privacy: screenshots are local until Save. Redact paints pixels black in both the original and annotated upload, and replaces the local draft image. Redaction cannot erase a previously uploaded copy; delete that saved mark through History. Screenshot URL queries/fragments are stripped, but visible page content and URLs can still contain sensitive information. Review before sending.

Reliability: saves use a stable revision ID, so a lost reply/retry does not duplicate the upload. Drafts remain accessible after closing the editor. Optional project/task labels and reviewed status make agent selection less ambiguous. A reviewed mark means viewed, not fixed.

Watcher: opt-in, automatic background tabs or review queue, domain filters, 60-minute repeat cooldown by default, manual reopening. Up to three automatic tabs per check. Machine status shows errors/staleness; recognised credential URL patterns are rejected but detection is not complete. localhost links are mapped to the source machine LAN address and may not be reachable if the service only listens on loopback.

Coverage: configured SSH users; all their discovered sockets in /tmp/tmux-UID, including detached sessions. Other users and sockets outside that directory are not monitored. First-seen panes ignore existing scrollback. Persistent pane positions help catch changes across restarts; fast output beyond 1,000 lines and screen replacements can still lose history. The hub keeps URL events seven days by default (configurable 1–30). Recover retained links adds them to review, never auto-opens a historical batch.

Storage: unsent drafts are never automatically removed. Saved drafts default to 30 days; capture retention on the hub defaults to keep indefinitely and can be set to 7–3650 days. Older legacy captures require individual deletion. Browser history retains 500 completed entries plus up to 500 queued entries; repeated-link timestamps are bounded to 2,000 recent URLs / 30 days. Review helper cache expires after 30 days. Recovery cannot recover expired server events or output never captured.

Permissions: activeTab/scripting for user-triggered screenshots; storage for settings and queues; alarms for URL polling. No hub origin is pre-permitted in this public package. Enter your own hub origin in Options and click Connect to grant access. The suggested origin is localhost:8420. Existing hub authentication remains required; this extension does not configure or bypass authentication.

Version 1.2.0 changes: persistent watcher positions, explicit coverage/health, filters/review/recovery/cooldown, pause race fix, credential-path filtering, redaction, idempotent upload endpoint, draft/saved history, project/task labels, reviewed acknowledgements, configurable hub/version checks and retention controls.

# Optional upload receiver contract

The extension makes one multipart POST to the exact URL configured by the user. No receiver is configured by default.

- `file`: JSON bundle, filename `look-here-UUID.json`, content type `application/json`.
- `uploader`: `look-here` (a label, **not proof of identity**).
- `tags`: `look-here,browser-extension`.
- Optional `Authorization: Bearer …`, from session-only settings.
- Cookies omitted; redirects rejected; timeout 30 seconds; maximum bundle size 40 MiB.

Success: a 2xx response with JSON `{ "id": 123 }`, where `id` is a positive integer. A receiver should use the UUID filename or another authenticated idempotency key to avoid duplicate saves after ambiguous network failures. The client cannot prove that an upload failed to persist if the response was lost.

Bundle schema `look-here/v1` contains `captureKind: browser-viewport`, sanitized `url`, `title`, capture/save timestamps, viewport information, note, pixel dimensions, point/box marks, and `original`/`annotated` PNG data URLs. Treat all metadata and images as untrusted input.

Receiver requirements:

- Authenticate reads and writes. Do not trust `uploader`, filenames, or arbitrary forwarded-IP headers for authorization.
- Terminate HTTPS and configure any trusted reverse proxies explicitly. LAN HTTP opt-in does not authenticate a server or encrypt data.
- Limit request size before multipart parsing, decoded image size/dimensions, total storage, and request rate. Enforce quotas server-side even if the extension validates its own input.
- Generate storage paths on the server. Never use client paths or prefix-string containment checks. Resolve paths and verify directory ancestry.
- Validate the schema and PNGs; never execute content. Return uploads as downloads with a safe content type and `X-Content-Type-Options: nosniff`, or use a separate non-privileged origin.
- Scope each user's list/read access, redact logs, and provide deletion/retention controls. Do not expose upload indexes to the internet without authentication.
- Treat screenshots as potentially confidential and as possible prompt-injection input to agents.

An agent integration can implement authenticated retrieval by mark ID and extract local PNGs. The public offline skill deliberately assumes no central service, cluster paths, database, or shared credentials.

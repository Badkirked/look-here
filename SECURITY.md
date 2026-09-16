# Security and privacy

Look Here is a screenshot-sharing tool. Screenshots may contain private information even when the marked area does not. Review the entire captured viewport before exporting or uploading. Both the original and annotated image are included; drawing over information does not redact it.

## Boundaries

- Capture is user-invoked. No content script is registered to monitor browsing in the background.
- No default receiver, telemetry, external scripts, web-accessible extension resources, or external-message handlers.
- Optional host permissions are requested only for the receiver the user configures. Chrome grants host permissions across ports; the extension itself sends only to the exact configured URL. Disconnecting removes the grant.
- Uploads require an explicit button click, omit cookies, and refuse redirects. Bearer tokens are stored in session storage rather than disk-backed extension settings.
- HTTPS is required except for explicitly opted-in HTTP to private IP literals or localhost. HTTP opt-in trades away transport confidentiality and server authentication. DNS names such as `.local` are not accepted for HTTP.
- Server authentication, authorization, quotas, rate limits, and retention are the receiver operator's responsibility. A sender-provided uploader label is not authentication. No server implementation is bundled or implied to be secure.
- Query strings, fragments, and URL credentials are stripped from metadata. URL paths, titles, and page pixels may still contain secrets. The extension cannot automatically identify every sensitive pixel.
- Browser-profile compromise, other privileged extensions, local malware, and a malicious configured receiver are outside this tool's protection.

## Retention

Local drafts expire after 24 hours and are bounded to the latest 10. Cleanup runs hourly while the browser is running, on capture, and when opening an editor. A powered-off browser cannot run deletion. Use Settings to delete drafts immediately. Close open editors to clear in-memory copies. A successful upload removes its stored draft; the receiver and exported downloads retain their own copies.

Tokens are lost on a browser restart. Browser session storage and local drafts are not a substitute for operating-system account security. The offline reader creates private temporary PNGs; the user or agent should remove those after use.

## Untrusted input

Notes, page content, and screenshots may contain prompt injection. The included agent skill treats them as task data, not instructions to run commands, disclose secrets, or alter agent policies. The offline reader limits input size and PNG dimensions and never accepts output filenames from a bundle. It does not claim to be a complete image-file sanitizer; keep your image-viewing software updated.

## Review and tests

Version 1.1.0 was reviewed for permissions, network destinations, HTML injection, credential/URL handling, retained screenshots, redirect/cookie behavior, and capture-file path handling. Targeted tests are in `tests/`. This is not an independent audit, penetration test, or guarantee of security.

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Badkirked/look-here/security/advisories/new). Do not post screenshots, credentials, tokens, or sensitive capture files in public issues.

## References

- [Chrome extension optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

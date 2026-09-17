# Changelog

## 1.2.0 - 2026-09-17

Adds the separately installable Hub Edition under `hub/extension/` and reusable server adapters under `hub/`. The original standalone extension remains unchanged.

- Pixel redaction affects both uploaded images.
- Reliable saves use per-revision IDs to prevent duplicate marks after lost replies.
- Unsent drafts survive editor closure; saved history supports review and deletion.
- Project/task labels and explicit viewed-in-context acknowledgements.
- Optional tmux link queues or background tabs, filters, cooldowns and recovery.
- Persistent pane positions, explicit machine health/coverage and history-gap notices.
- Pause recheck prevents opening links after an in-flight poll is disabled.
- Configurable retention and hub origin; no private deployment addresses or pre-granted hosts in the public package.
- Hub-specific agent reader, isolated server tests, watcher tests and Chromium integration runner.

Limits: authenticated host integration required; the adapters are not multi-tenant or a standalone server. tmux collection can miss fast output. Credential filtering is heuristic. Unpacked extensions require manual Reload after replacing files.

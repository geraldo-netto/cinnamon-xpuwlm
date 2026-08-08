# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0001 | open | high | xl | — | Add a versioned runtime service and bidirectional command contract; profile, weight, and pause controls currently change local intent and present it as applied without runtime acknowledgement, failure feedback, or rollback. |
| XTPU-0002 | open | high | m | XTPU-0001 | Enforce the complete runtime snapshot schema at the adapter boundary; schema-invalid missing, extra, fractional, and out-of-range fields are currently defaulted or clamped into an apparently connected state. |
| XTPU-0003 | open | high | l | XTPU-0001, XTPU-0002 | Move snapshot and device discovery off Cinnamon’s main loop using cancellable, bounded asynchronous I/O; reject non-regular snapshot inputs and cancel pending work during teardown. |
| XTPU-0004 | open | medium | m | XTPU-0001, XTPU-0002 | Model device, runtime, policy-intent, and policy-application states separately; probe, stale, malformed, unavailable, and unacknowledged states currently fabricate zero/idle/paused telemetry or show irrelevant accelerator-reconnect guidance. |
| XTPU-0005 | open | medium | l | XTPU-0001, XTPU-0002 | Replace the hard-coded eight-profile catalog and limits with a versioned, validated profile registry or descriptor contract so additional workloads are discoverable instead of silently discarded. |
| XTPU-0006 | open | medium | m | XTPU-0004 | Make popup and prototype layouts responsive at small work areas, high scale factors, and large text sizes; fixed minimum widths and single-line ellipsis can overflow or hide essential content. |
| XTPU-0007 | open | medium | m | XTPU-0006 | Use Cinnamon theme-derived semantic colors and verify contrast in light, dark, and high-contrast themes; hard-coded foreground and accent colors do not guarantee readable states. |
| XTPU-0008 | open | medium | m | XTPU-0006 | Expose correct ATK roles and selected/checked states for tabs and profile toggles, add expected keyboard navigation, and preserve meaningful focus when dynamic bodies are rebuilt. |
| XTPU-0009 | open | medium | m | XTPU-0006, XTPU-0008 | Internationalize applet, settings, metadata, status, and accessibility strings with gettext, including plural-aware messages and layout validation using expanded translations. |
| XTPU-0010 | open | medium | m | XTPU-0004 | Prioritize active alerts by severity and recency and surface deduplicated critical notifications; runtime array order can currently bury critical items and severity is visible only after opening the popup. |
| XTPU-0011 | open | medium | s | XTPU-0003 | Add bounded backoff and log deduplication for repeated snapshot-read and device-probe failures; current polling can emit the same warning every refresh interval indefinitely. |
| XTPU-0012 | open | low | xs | — | Update the prototype status and root documentation index to link the implemented applet and clearly separate approved design artifacts from current production behavior. |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0014 | open | low | m | — | Add a pinned CI workflow that enforces lint, artifact validation, coverage, fuzz, mutation, and dependency-audit gates for future hosted changes. |

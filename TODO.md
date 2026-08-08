# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0001 | open | high | xl | — | Add a versioned runtime service and bidirectional command contract; profile, weight, and pause controls currently change local intent and present it as applied without runtime acknowledgement, failure feedback, or rollback. |
| XTPU-0002 | open | high | m | XTPU-0001 | Enforce the complete runtime snapshot schema at the adapter boundary; schema-invalid missing, extra, fractional, and out-of-range fields are currently defaulted or clamped into an apparently connected state. |
| XTPU-0003 | open | high | m | XTPU-0001, XTPU-0002, XTPU-0022 | Replace synchronous snapshot reads with size-bounded cancellable GIO async reads; sequence refreshes, discard stale completions, and cancel pending reads during teardown. |
| XTPU-0004 | open | medium | m | XTPU-0002, XTPU-0003, XTPU-0023 | Model device and runtime health independently; render specific absent, stale, malformed, read-error, and probe-error telemetry and recovery guidance instead of fabricated operational values. |
| XTPU-0005 | open | medium | l | XTPU-0001, XTPU-0002 | Replace the hard-coded eight-profile catalog and limits with a versioned, validated profile registry or descriptor contract so additional workloads are discoverable instead of silently discarded. |
| XTPU-0006 | open | medium | m | XTPU-0004 | Make the Cinnamon popup responsive at narrow work areas, high scale factors, and large text sizes while preserving essential content and controls. |
| XTPU-0007 | open | medium | m | XTPU-0006 | Use Cinnamon theme-derived semantic colors and verify contrast in light, dark, and high-contrast themes; hard-coded foreground and accent colors do not guarantee readable states. |
| XTPU-0008 | open | medium | s | XTPU-0006 | Apply tab-list, tab, and toggle ATK roles plus selected and checked states so assistive technology receives semantic control state. |
| XTPU-0009 | open | medium | m | XTPU-0006, XTPU-0008 | Localize runtime UI, status, and accessibility strings through gettext and ngettext; verify plurals and expanded translations. |
| XTPU-0010 | open | medium | xs | XTPU-0002 | Sort active alerts deterministically by severity, newest timestamp, and stable ID so critical items cannot be buried by runtime array order. |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0017 | open | medium | xs | XTPU-0004 | Make explicit retry bypass or invalidate the device-detection cache; reconnecting and selecting Retry can replay an unavailable result for up to 10 seconds. |
| XTPU-0019 | open | medium | s | XTPU-0004 | Expire displayed runtime state at its freshness deadline independently of polling; the 60-second refresh setting can show a snapshot as online for 45 seconds beyond the 15-second stale threshold. |
| XTPU-0020 | open | medium | m | — | Exercise object- and array-structure mutations instead of excluding them globally; current exclusions omit core domain and view-state behavior from the reported mutation score. |
| XTPU-0021 | open | low | s | XTPU-0011 | Bound repeated manager and listener error logging; a persistent render listener failure is logged on every refresh indefinitely. |
| XTPU-0022 | open | high | s | XTPU-0002 | Reject symlinked and non-regular runtime snapshot inputs using no-follow metadata before reading while retaining the byte limit. |
| XTPU-0023 | open | high | m | XTPU-0003 | Move PCIe and USB discovery plus sysfs reads to bounded cancellable async I/O and cancel pending discovery during teardown. |
| XTPU-0024 | open | low | s | XTPU-0006 | Make reference prototype layouts demonstrate the production popup’s responsive breakpoints and wrapped-content behavior. |
| XTPU-0025 | open | medium | s | XTPU-0008 | Add expected arrow, Home, and End keyboard navigation with roving focus across tabs. |
| XTPU-0026 | open | medium | s | XTPU-0006, XTPU-0008 | Preserve focus by stable semantic control identity when dynamic menu bodies rebuild, with a predictable fallback target. |
| XTPU-0027 | open | medium | s | XTPU-0009 | Localize settings and metadata through Cinnamon conventions and include their strings in extraction and catalog validation. |
| XTPU-0028 | open | medium | s | XTPU-0004, XTPU-0010 | Expose highest active alert severity in panel and popup summaries using text and accessible semantics rather than color alone. |
| XTPU-0029 | open | medium | m | XTPU-0004, XTPU-0010 | Emit each critical desktop notification once per alert occurrence while allowing notification after resolution and reappearance. |
| XTPU-0030 | open | medium | xs | XTPU-0019 | Normalize non-finite freshness windows; injected `Infinity` or `NaN` values can disable stale-state expiration. |

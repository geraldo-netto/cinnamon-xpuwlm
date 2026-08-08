# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0001 | open | high | xl | — | Add a versioned runtime service and bidirectional command contract; profile, weight, and pause controls currently change local intent and present it as applied without runtime acknowledgement, failure feedback, or rollback. |
| XTPU-0002 | open | high | m | XTPU-0001 | Enforce the complete runtime snapshot schema at the adapter boundary; schema-invalid missing, extra, fractional, and out-of-range fields are currently defaulted or clamped into an apparently connected state. |
| XTPU-0003 | open | high | m | XTPU-0001, XTPU-0002, XTPU-0022 | Replace synchronous snapshot reads with size-bounded cancellable GIO async reads; sequence refreshes, discard stale completions, and cancel pending reads during teardown. |
| XTPU-0004 | open | medium | m | XTPU-0002, XTPU-0003, XTPU-0023 | Model device and runtime health independently; render specific absent, stale, malformed, read-error, and probe-error telemetry and recovery guidance instead of fabricated operational values. |
| XTPU-0005 | open | medium | l | XTPU-0001, XTPU-0002, XTPU-0035, XTPU-0036, XTPU-0037, XTPU-0038, XTPU-0039, XTPU-0040, XTPU-0041 | Replace the hard-coded catalog with a modular workload plug-in architecture; the related items define and deliver the contract, registry, migration, lifecycle, safety boundary, low-light workload, and developer tooling. |
| XTPU-0006 | open | medium | m | XTPU-0004 | Make the Cinnamon popup responsive at narrow work areas, high scale factors, and large text sizes while preserving essential content and controls. |
| XTPU-0008 | open | medium | s | XTPU-0006 | Apply tab-list, tab, and toggle ATK roles plus selected and checked states so assistive technology receives semantic control state. |
| XTPU-0009 | open | medium | m | XTPU-0006, XTPU-0008 | Localize runtime UI, status, and accessibility strings through gettext and ngettext; verify plurals and expanded translations. |
| XTPU-0010 | open | medium | xs | XTPU-0002 | Sort active alerts deterministically by severity, newest timestamp, and stable ID so critical items cannot be buried by runtime array order. |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0019 | open | medium | s | XTPU-0004 | Expire displayed runtime state at its freshness deadline independently of polling; the 60-second refresh setting can show a snapshot as online for 45 seconds beyond the 15-second stale threshold. |
| XTPU-0020 | open | medium | xs | XTPU-0031, XTPU-0032 | Enable object- and array-structure mutations globally after their concrete core/UI contract gaps are covered; suppress the single proven-equivalent non-array alert fallback mutant locally. |
| XTPU-0022 | open | high | s | XTPU-0002, XTPU-0003 | Reject symlinked/non-regular snapshots and path-object races using no-follow preflight plus opened-stream identity checks; enforce `MAX + 1` bounded async reads. |
| XTPU-0023 | open | high | m | XTPU-0003 | Move PCIe and USB discovery plus sysfs reads to bounded cancellable async I/O and cancel pending discovery during teardown. |
| XTPU-0024 | open | low | s | XTPU-0006 | Make reference prototype layouts demonstrate the production popup’s responsive breakpoints and wrapped-content behavior. |
| XTPU-0025 | open | medium | s | XTPU-0008 | Add expected arrow, Home, and End keyboard navigation with roving focus across tabs. |
| XTPU-0026 | open | medium | s | XTPU-0006, XTPU-0008 | Preserve focus by stable semantic control identity when dynamic menu bodies rebuild, with a predictable fallback target. |
| XTPU-0027 | open | medium | s | XTPU-0009 | Localize settings and metadata through Cinnamon conventions and include their strings in extraction and catalog validation. |
| XTPU-0028 | open | medium | s | XTPU-0004, XTPU-0010 | Expose highest active alert severity in panel and popup summaries using text and accessible semantics rather than color alone. |
| XTPU-0029 | open | medium | m | XTPU-0004, XTPU-0010 | Emit each critical desktop notification once per alert occurrence while allowing notification after resolution and reappearance. |
| XTPU-0031 | open | low | s | XTPU-0020 | Add structural contract and clone-isolation coverage for device detection, profile statuses, fallback/probe snapshots, portfolio serialization, manager projections, and status labels. |
| XTPU-0032 | open | medium | s | XTPU-0008, XTPU-0020 | Add structural UI contract coverage for panel-state cleanup, metrics, icons, recovery steps, scroll layout, and interactive button properties. |
| XTPU-0033 | open | medium | s | XTPU-0028 | Replace the default long panel label with a compact status icon using theme-derived color plus a non-color shape/badge and an accessible tooltip; status must not depend on color alone. |
| XTPU-0035 | open | medium | m | XTPU-0001, XTPU-0002, XTPU-0005 | Define a versioned declarative workload plug-in manifest and domain contract with stable identity, capabilities, model/runtime requirements, UI metadata, defaults, and strict schema validation. |
| XTPU-0036 | open | medium | m | XTPU-0005, XTPU-0035 | Inject a workload registry port into the domain and application layers, with a Cinnamon adapter that discovers validated descriptors without coupling domain logic to files or framework APIs. |
| XTPU-0037 | open | medium | m | XTPU-0005, XTPU-0035, XTPU-0036 | Migrate all eight built-in workload profiles into independent plug-in descriptors and remove hard-coded catalog knowledge and fixed profile-count limits from the domain. |
| XTPU-0038 | open | medium | s | XTPU-0005, XTPU-0035, XTPU-0036 | Add low-light image enhancement as a normal Visual Library workload plug-in with replaceable model metadata, host-pipeline responsibilities, and measurable quality/performance acceptance criteria. |
| XTPU-0039 | open | medium | m | XTPU-0001, XTPU-0005, XTPU-0036 | Implement deterministic install, enable, disable, upgrade, and removal reconciliation so unknown or removed plug-ins do not corrupt persisted preferences or runtime state. |
| XTPU-0040 | open | high | m | XTPU-0001, XTPU-0002, XTPU-0005, XTPU-0035, XTPU-0036 | Keep applet plug-ins declarative and non-executable, validate all discovered data and paths at the trust boundary, and leave model execution and privileged actions behind the runtime service contract. |
| XTPU-0041 | open | low | s | XTPU-0005, XTPU-0035, XTPU-0036 | Provide a workload plug-in template, authoring guide, schema/compatibility checker, and contract-test fixture so workloads can be added or removed independently. |

# Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

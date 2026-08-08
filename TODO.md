# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0001 | open | high | xl | — | Add a versioned runtime service and bidirectional command contract; profile, weight, and pause controls currently change local intent and present it as applied without runtime acknowledgement, failure feedback, or rollback. |
| XTPU-0005 | open | medium | l | XTPU-0001, XTPU-0002, XTPU-0035, XTPU-0036, XTPU-0037, XTPU-0038, XTPU-0039, XTPU-0040, XTPU-0041 | Replace the hard-coded catalog with a modular workload plug-in architecture; the related items define and deliver the contract, registry, migration, lifecycle, safety boundary, low-light workload, and developer tooling. |
| XTPU-0009 | open | medium | m | XTPU-0006, XTPU-0008 | Localize runtime UI, status, and accessibility strings through gettext and ngettext; verify plurals and expanded translations. |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0023 | open | high | m | XTPU-0003 | Move PCIe and USB discovery plus sysfs reads to bounded cancellable async I/O and cancel pending discovery during teardown. |
| XTPU-0027 | open | medium | s | XTPU-0009 | Localize settings and metadata through Cinnamon conventions and include their strings in extraction and catalog validation. |
| XTPU-0035 | open | medium | m | XTPU-0001, XTPU-0002, XTPU-0005 | Define a versioned declarative workload plug-in manifest and domain contract with stable identity, capabilities, model/runtime requirements, UI metadata, defaults, and strict schema validation. |
| XTPU-0036 | open | medium | m | XTPU-0005, XTPU-0035 | Inject a workload registry port into the domain and application layers, with a Cinnamon adapter that discovers validated descriptors without coupling domain logic to files or framework APIs. |
| XTPU-0037 | open | medium | m | XTPU-0005, XTPU-0035, XTPU-0036 | Migrate all eight built-in workload profiles into independent plug-in descriptors and remove hard-coded catalog knowledge and fixed profile-count limits from the domain. |
| XTPU-0038 | open | medium | s | XTPU-0005, XTPU-0035, XTPU-0036 | Add low-light image enhancement as a normal Visual Library workload plug-in with replaceable model metadata, host-pipeline responsibilities, and measurable quality/performance acceptance criteria. |
| XTPU-0039 | open | medium | m | XTPU-0001, XTPU-0005, XTPU-0036 | Implement deterministic install, enable, disable, upgrade, and removal reconciliation so unknown or removed plug-ins do not corrupt persisted preferences or runtime state. |
| XTPU-0040 | open | high | m | XTPU-0001, XTPU-0002, XTPU-0005, XTPU-0035, XTPU-0036 | Keep applet plug-ins declarative and non-executable, validate all discovered data and paths at the trust boundary, and leave model execution and privileged actions behind the runtime service contract. |
| XTPU-0041 | open | low | s | XTPU-0005, XTPU-0035, XTPU-0036 | Provide a workload plug-in template, authoring guide, schema/compatibility checker, and contract-test fixture so workloads can be added or removed independently. |
| XTPU-0042 | open | low | s | XTPU-0038 | Review the interim low-light catalog and profile draft committed in `828a261` after the plug-in is implemented; reconcile wording, model metadata, host-pipeline responsibilities, and measurable acceptance criteria with test results, then revise or remove the feature if warranted. |
| XTPU-0046 | open | medium | s | — | Add an explicit CJS production-source syntax and import smoke gate for the declared Cinnamon 6.0 floor and the current supported release; the workflow does not visibly enforce the runtime floor. |
| XTPU-0047 | open | low | m | XTPU-0013 | Add deterministic staging, packaging, install and uninstall verification, and checksums; after licensing, add Spices release metadata and a real applet screenshot if public distribution is intended. |

# Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

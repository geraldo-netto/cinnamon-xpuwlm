# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0005 | open | low | m | XTPU-0042 | Plug-in architecture remainder: surface reconciliation changes (installed/upgraded/removed plug-ins) in the UI or notifications instead of computing them silently, and add developer tooling to package and validate a third-party plug-in directory outside the repository gates. Contract, registry, trust boundary, bundled+user directory discovery with bundled-wins merging, and lifecycle reconciliation are delivered. |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0049 | open | low | m | XTPU-0005 | Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |
| XTPU-0047 | blocked | low | s | XTPU-0013 | Deterministic staging, reproducible ustar packaging, SHA-256 checksum manifests, and install/uninstall verification are delivered (`scripts/package-applet.js`, `npm run package`). Remaining and blocked on the license decision (XTPU-0013): Spices release metadata and a real applet screenshot if public distribution is intended. |

# Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

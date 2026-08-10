# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0013 | blocked | low | xs | — | Choose and add an explicit repository license before redistribution; no license currently grants reuse rights. |
| XTPU-0047 | blocked | low | s | XTPU-0013 | Deterministic staging, reproducible ustar packaging, SHA-256 checksum manifests, and install/uninstall verification are delivered (`scripts/package-applet.js`, `npm run package`). Remaining and blocked on the license decision (XTPU-0013): Spices release metadata and a real applet screenshot if public distribution is intended. |
| XTPU-0049 | blocked | low | m | — | Blocked: requires Edge TPU hardware not present on this host (AMD RX 6600 XT and 610M via Vulkan only), and measurements must be measured, never estimated. Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |

# Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

# Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0049 | blocked | low | m | — | Blocked: requires Edge TPU hardware not present on this host (AMD RX 6600 XT and 610M via Vulkan only), and measurements must be measured, never estimated. Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |
| XTPU-0050 | open | high | l | OMNI-0234 | event-extraction UX: once OmniTensor exposes the grounded workload, add an explicit user-invoked file/folder chooser, bounded progress and cancellation, editable evidence-backed event preview/deduplication, and explicit confirmation before ICS/calendar export. Default the large model to GPU; offer NPU preference only after the user installs/configures a qualified NPU variant, retain GPU as its admission/load fallback, and never offer CPU. Never scan automatically, send content through the public snapshot, or represent source-only/model-unavailable states as a runnable importer. |

# Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

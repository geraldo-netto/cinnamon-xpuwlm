# TODO

## Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0051 | open | medium | s | — | Profile-management disclosure wording: the footer's “Manage profiles” action opens the correct online screen, but eight readiness-blocked rows start collapsed behind the ambiguous label “Not available (8)”, which reads like a panel/service outage. Rename it to “Needs setup”, make the footer action expand it, preserve explicit disclosure control, focus, and Setup remedies, and add regression/visual/accessibility coverage. |

## Blocked

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0049 | blocked | low | m | — | Blocked: requires Edge TPU hardware not present on this host (AMD RX 6600 XT and 610M via Vulkan only), and measurements must be measured, never estimated. Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |

## Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

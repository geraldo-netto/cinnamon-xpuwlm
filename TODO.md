# TODO

## Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0054 | in_progress | critical | m | XTPU-0050 | Live explicit-file chooser window churn drives Cinnamon's grouped-window-list teardown from GJS GC callbacks and freezes the desktop; make every chooser non-blocking, correctly parented/focused, and prove cancellation/selection leaves Cinnamon responsive. |
| XTPU-0055 | in_progress | medium | s | XTPU-0054 | Reload guidance omits the exact case-sensitive Cinnamon D-Bus call, allowing an invalid xlet type to unload the applet and fail reload; document and test the safe `APPLET` invocation. |

## Blocked

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0049 | blocked | low | m | — | Blocked: requires Edge TPU hardware not present on this host (AMD RX 6600 XT and 610M via Vulkan only), and measurements must be measured, never estimated. Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |

## Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

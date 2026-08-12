# TODO

## Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0087 | open | high | l | XTPU-0088, XTPU-0089 | A Windows client is feasible as a sibling tray application, with roughly 69% of library code a candidate for reuse, but the GJS/Cinnamon shell, St/Clutter view, GIO/GTK adapters, settings, notifications, and packaging require Windows implementations. Prove an Electron/Node tray and named-pipe handshake spike before committing to parity. |
| XTPU-0089 | open | medium | m | XTPU-0087 | Portable core code still constructs POSIX paths and publishes Linux-only setup guidance, while the mixed Cinnamon runtime adapter combines shared factories with GIO and Linux discovery. Extract path, platform-guidance, transport, and discovery ports before a Windows client release. |
| XTPU-0094 | open | high | xl | OMNI-0236, OMNI-0237 | The licensed acceptance corpus and live tests now cover image, UTF-8 multiscript/Hebrew, Windows-1252, Shift-JIS, KOI8-R, and malformed bytes, but the app still exposes image input only and has no audio/video picker, job contract, progress, result, or error recovery UI. Expose those media only after qualified OmniTensor pipelines exist. |

## Blocked

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0088 | blocked | high | xl | XTPU-0087 | Full Windows inference parity is blocked on a compatible OmniTensor Windows service: the current control plane is Linux session D-Bus, fallback discovery reads `/dev` and `/sys`, and accelerator SDK/driver support must be proven. Replace D-Bus with authenticated per-user IPC and implement service-authoritative Windows discovery in the runtime project before this client can provide full functionality. |
| XTPU-0049 | blocked | low | m | — | Blocked: requires Edge TPU hardware not present on this host (AMD RX 6600 XT and 610M via Vulkan only), and measurements must be measured, never estimated. Record reproducible acceptance measurements for `low-light-enhancement` on named hardware (model, compiler, and runtime versions, input shape, warm-up, sample count, host preprocessing, CPU tone-mapping baseline) against the five manifest acceptance criteria; the workload stays disabled by default until the measured results are recorded. |

## Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

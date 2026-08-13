# TODO

The GPU use-case implementation backlog is tracked directly in XTPU-0104
through XTPU-0138; `related ids` encode its dependency order.

## Work groups

Items remain in the canonical lifecycle tables below; these ranges provide the
domain grouping without weakening the required status schema.

- **Platform and portability:** XTPU-0087–XTPU-0089
- **Hardware and storage:** XTPU-0104–XTPU-0110
- **Scheduling, network, and security:** XTPU-0111–XTPU-0114
- **Developer tools:** XTPU-0115–XTPU-0120
- **Local files and routines:** XTPU-0125
- **Vision and image processing:** XTPU-0049, XTPU-0126–XTPU-0129
- **Camera, equipment, and audio:** XTPU-0130–XTPU-0133

## Findings

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0087 | open | high | l | XTPU-0088, XTPU-0089 | A Windows client is feasible as a sibling tray application, with roughly 69% of library code a candidate for reuse, but the GJS/Cinnamon shell, St/Clutter view, GIO/GTK adapters, settings, notifications, and packaging require Windows implementations. Prove an Electron/Node tray and named-pipe handshake spike before committing to parity. |
| XTPU-0089 | open | medium | m | XTPU-0087 | Portable core code still constructs POSIX paths and publishes Linux-only setup guidance, while the mixed Cinnamon runtime adapter combines shared factories with GIO and Linux discovery. Extract path, platform-guidance, transport, and discovery ports before a Windows client release. |
| XTPU-0111 | open | medium | l | XTPU-0095, XTPU-0099, XTPU-0100, OMNI-0091, OMNI-0092, OMNI-0093 | Promote the existing local forecast foundation into queue-delay forecasting, benchmark host/GPU/hybrid paths, publish a typed advisory, and expose it through the generic Cinnamon surface. |
| XTPU-0115 | open | medium | l | XTPU-0095, XTPU-0097, XTPU-0099, OMNI-0094, OMNI-0095, OMNI-0096 | Implement test prioritization experiments from change, failure, duration, ownership, and coverage history; benchmark host/GPU/hybrid rankers while always retaining mandatory tests. |
| XTPU-0116 | open | medium | l | XTPU-0095, XTPU-0099, XTPU-0101 | Evaluate API-misuse classification on one labeled corpus by comparing AST/rules, GPU classification, and hybrid pipelines for precision, recall, performance, memory, and explanation quality. |
| XTPU-0117 | open | medium | l | XTPU-0095, XTPU-0097, XTPU-0099 | Evaluate fuzz-input prioritization against native fuzzer selection, host, GPU, and hybrid scorers using new paths and bugs per wall-clock and energy budget. |
| XTPU-0118 | open | medium | l | XTPU-0095, XTPU-0099 | Evaluate fuzz-crash deduplication across normalized signatures, host clustering, GPU embeddings, and hybrid cascades by precision/recall, performance, memory, and operator review cost. |
| XTPU-0119 | open | medium | l | XTPU-0095, XTPU-0097, XTPU-0103 | Evaluate compiler-option suggestion using only validated allowlisted profiles; compare search, host, GPU, and hybrid recommenders on correctness, build cost, size, runtime, and memory. |
| XTPU-0120 | open | medium | l | XTPU-0095, XTPU-0096, XTPU-0099, OMNI-0094, OMNI-0095, OMNI-0096 | Implement versioned resource-regression experiments comparing statistical, host-model, GPU-model, and hybrid detection on repeated CPU, memory, I/O, GPU, and startup measurements. |
| XTPU-0133 | open | medium | l | XTPU-0095, XTPU-0097, XTPU-0099, XTPU-0102 | Evaluate music genre, instrument, and mood tagging with separate bounded label sets and host/GPU candidates, returning timestamped confidence evidence for selected audio. |

## Blocked

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |
| XTPU-0088 | blocked | high | xl | XTPU-0087 | Full Windows inference parity is blocked on a compatible OmniTensor Windows service: the current control plane is Linux session D-Bus, fallback discovery reads `/dev` and `/sys`, and accelerator SDK/driver support must be proven. Replace D-Bus with authenticated per-user IPC and implement service-authoritative Windows discovery in the runtime project before this client can provide full functionality. |
| XTPU-0104 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0098, XTPU-0099, XTPU-0101, OMNI-0085, OMNI-0086, OMNI-0087 | Fan degradation prediction is blocked on representative failing/normal fan data, device-specific RPM/PWM/load telemetry, an acoustic or vibration fixture if those signals are claimed, a signed model, and real failure acceptance; NASA aircraft-engine simulation data cannot validate desktop fans. |
| XTPU-0105 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0085, OMNI-0086, OMNI-0087 | Power-supply health scoring is blocked because this host exposes no trustworthy PSU voltage/current/temperature/fan telemetry; obtain supported PMBus/BMC/vendor hardware, labeled failure data, and a signed qualified model. |
| XTPU-0106 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0085, OMNI-0086, OMNI-0087 | UPS battery degradation is blocked because no UPS/power-supply device or Network UPS Tools client exists here; obtain supported hardware, discharge/load histories, failure labels, and a signed qualified model while preserving deterministic shutdown policy. |
| XTPU-0107 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0088, OMNI-0089, OMNI-0090 | Disk/SSD failure warning is blocked on permission to read all seven discovered SMART/NVMe devices, representative local SSD/HDD histories and outcomes, device-family validation, signing identity, and real-drive false-positive/recovery acceptance. |
| XTPU-0108 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0085, OMNI-0086, OMNI-0087 | Memory-fault precursor detection is blocked because EDAC reports no memory controller on this host and representative corrected-error/failure sequences are absent; obtain a supported ECC/RAS host, labels, signed model, and real acceptance. |
| XTPU-0109 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0103, XTPU-0107, OMNI-0088, OMNI-0089, OMNI-0090 | Storage-tier recommendation is blocked on the storage telemetry/model pipeline, representative access/retention histories, measured utility, and safe deterministic migration/rollback adapters; model output must remain advisory. |
| XTPU-0110 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0091, OMNI-0092, OMNI-0093 | Workload placement hints are blocked on representative local job traces and target utility/fairness labels, a signed qualified model, deterministic starvation policy, and named-host acceptance; public cluster traces are prototype data only. |
| XTPU-0112 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0098, XTPU-0101, OMNI-0108, OMNI-0109, OMNI-0110, OMNI-0111, OMNI-0184 | Port-scan/reconnaissance detection is blocked on a least-privilege flow collector, BPF access, privacy-reviewed current traffic labels, signed model, false-positive/attack-recall gates, and real network acceptance. |
| XTPU-0113 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0101, OMNI-0108, OMNI-0109, OMNI-0110, OMNI-0111 | Wi-Fi interference classification is blocked because Wi-Fi is disconnected and `iw` is absent; obtain survey/retry/channel telemetry, controlled congestion/interference/hardware-fault labels, a signed model, and real radio acceptance. |
| XTPU-0114 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0098, XTPU-0101, XTPU-0103, OMNI-0184 | Privilege-escalation precursor detection is blocked on approval of a separate host-security profile, missing audit tools and BPF privilege, a least-privilege redacted event helper, representative attack/normal sequences, and review-only acceptance. |
| XTPU-0125 | blocked | medium | l | XTPU-0095, XTPU-0097, XTPU-0099, XTPU-0100, XTPU-0101, OMNI-0097, OMNI-0098, OMNI-0101 | Visual/semantic image relatedness is blocked on a frozen retrieval corpus and metrics, signed CLIP-compatible ncnn artifact, embedding consumer, batching crossover measurements, and named-GPU acceptance. |
| XTPU-0126 | blocked | high | xl | XTPU-0095, XTPU-0097, XTPU-0099, XTPU-0101 | PCB inspection is blocked on representative boards and missing/misplaced/rotated/damaged-component labels, a signed detector, camera/lighting fixture, and real-board acceptance; DeepPCB surface-defect pairs do not cover the requested component task. |
| XTPU-0127 | blocked | medium | l | XTPU-0095, XTPU-0097, XTPU-0099, XTPU-0102 | Foreground/person segmentation is blocked on selecting a license-compatible model, a frozen labeled mask corpus and quality thresholds, a publisher signing identity, an exported qualified ncnn artifact, and named-Vulkan accuracy and performance evidence; this host provides suitable AMD Vulkan hardware but none of the model evidence. |
| XTPU-0128 | blocked | medium | m | XTPU-0100, XTPU-0102, XTPU-0103, XTPU-0127 | Background removal is blocked on XTPU-0127's absent qualified mask producer and original-geometry contract; after that exists, measure host/GPU composition placement and verify atomic no-overwrite PNG/WebP publication against real masks. |
| XTPU-0049 | blocked | low | m | XTPU-0129, OMNI-0105, OMNI-0106 | Record reproducible `low-light-enhancement` 0.2.0 acceptance on the named RX 6600 XT: exact signed ncnn artifact/runtime identity, full Vulkan execution with no CPU fallback, portable/native and paired-image fidelity, warm p95, and measured end-to-end speedup over the documented CPU baseline. The profile remains disabled until evidence exists. |
| XTPU-0129 | blocked | high | xl | XTPU-0049, XTPU-0095, XTPU-0097, XTPU-0101, OMNI-0048, OMNI-0102, OMNI-0103, OMNI-0104, OMNI-0105, OMNI-0106 | Low-light enhancement 0.2.0 is Vulkan/ncnn-only and returns enhanced RGB. Operational readiness remains blocked on the signed Retinexformer artifact, licensed paired corpus, completed pipeline, fidelity evidence, and named-GPU end-to-end acceptance. |
| XTPU-0130 | blocked | medium | xl | XTPU-0095, XTPU-0097, XTPU-0098, XTPU-0100, XTPU-0101 | Ergonomic posture reminders are blocked because this host has no webcam; obtain consented representative posture data, a camera fixture, signed pose artifact, non-medical thresholds, privacy controls, and real acceptance. |
| XTPU-0131 | blocked | medium | l | XTPU-0100, XTPU-0101, XTPU-0103, XTPU-0130 | Webcam auto-framing is blocked on the pose/person provider, absent webcam, camera-control adapter, smoothing/crop benchmarks, preview/confirmation UX, and real-device acceptance. |
| XTPU-0132 | blocked | high | xl | XTPU-0095, XTPU-0096, XTPU-0097, XTPU-0098, XTPU-0101 | 3D-printer failure detection is blocked on a printer/camera fixture, printer-specific normal/failure corpus, signed model, continuous-monitoring consent/scheduling, and false-positive acceptance; model output must not stop a print. |

## Rejected / Won't fix

| id | status | severity | effort | related ids | description |
| --- | --- | --- | --- | --- | --- |

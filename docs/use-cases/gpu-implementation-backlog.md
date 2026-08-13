# GPU implementation backlog

[Use-case index](../use-cases.md) · [System workflows](system-workflows.md) ·
[Vision and audio](vision-and-audio.md) · [Systems and data](systems-and-data.md)

## Scope and decision rules

This plan covers OmniTensor inference and the `cinnamon-xpuwlm` interaction
surface. Persistent corpus indexing, semantic search, and integration with a
separate indexing product are deliberately deferred. File tasks in this plan
therefore start with explicit user-selected inputs; they do not claim to solve
terabyte-scale inventory or retrieval.

OmniTensor owns qualified artifacts, accelerator admission, worker isolation,
cancellation, schemas, and evidence. Cinnamon owns opt-in controls, progress,
results, warnings, and explicit confirmation. Deterministic host adapters own
capture, parsing, hashes, codecs, storage, policy, and every action. A model may
recommend, rank, transcribe, detect, or describe; it may not silently repair
hardware, change power or storage policy, omit required tests, control a camera,
move files, or take a security action.

The fit labels are benchmark hypotheses, not backend decisions:

- **Proven component:** the installed GPU artifact/provider has passed its own
  acceptance, although the composed use case still needs end-to-end evidence.
- **GPU candidate:** a plausible accelerator model family exists, but no
  performance conclusion is made until the complete pipeline is measured.
- **Crossover unknown:** host, GPU, and hybrid candidates are all retained until
  identical-data measurements establish the useful operating range.

No label authorizes or rejects a backend. GPU-F01 records throughput, latency,
tail latency, startup/warm-up, memory/VRAM, energy where observable, accuracy,
pre/postprocessing, transfer, and desktop contention across input sizes. The
implementation follows measured crossover points. Correctness and safety
requirements remain invariant: for example, byte identity still requires a
full cryptographic digest regardless of which processor computes it.

The delivery labels mean:

- **Partial:** a reusable provider, parser, artifact, or pipeline exists, but
  the named workflow is not end to end.
- **Startable:** the first bounded slice can begin without missing hardware or
  an irreversible design decision.
- **Blocked:** operational readiness cannot be reached until the referenced
  blockers are resolved. Safe foundation work may still proceed.

Planning IDs below are local to this backlog; they are not completion claims or
substitutes for tracked `XTPU-*` and `OMNI-*` findings.

## Current baseline

The baseline was rechecked on 2026-08-13.

| Area | Observed state | Consequence |
| --- | --- | --- |
| GPU | AMD RX 6600 XT and Radeon 610M are visible through RADV Vulkan; two render nodes exist | GPU qualification can run on named hardware; software Vulkan must remain rejected |
| Ready workers | `ask-selected-files`, `event-extraction`, `file-organizer`, `selected-text-tools`, and `media-transcription` report ready | Bounded language, vision, speech, presentation, and selected-file slices can reuse installed workers |
| Media artifacts | Qwen2.5-VL 7B and multilingual Whisper Small report ready | Media transcription is partial delivery, not proof that captions, presentation review, rehearsal analysis, or screenshot assistance work |
| Catalog profiles | Hardware, storage, scheduler, build, network, desktop, and low-light profiles have no ready worker; visual-library has only its classifier artifact | Policy/profile presence must not be shown as application readiness |
| Telemetry | 11 `hwmon` nodes exist; SMART tools exist but cannot open seven discovered drives as this user | Sensor adapters can be designed; disk acceptance is permission-blocked |
| Missing local evidence | No power-supply/UPS device, no EDAC memory controller, disconnected Wi-Fi with no `iw`, no webcam, and no 3D-printer test fixture | UPS, memory, Wi-Fi, pose/camera, and printer readiness cannot be proven here |
| Privileged telemetry | Audit tools are absent and `bpftool prog show` returns `Operation not permitted` | Privilege-sequence and low-level network collectors cannot be accepted here |
| Deterministic media tools | FFmpeg and ImageMagick `convert` exist | Bounded decode, resize, frame sampling, and output rendering can proceed without lossy intermediate formats |

## Shared foundation tasks

Complete these once, then reuse them. This ordering prevents every use case from
inventing a collector, lifecycle, result format, and Cinnamon workflow.

| ID | Task | Completion evidence | Blockers |
| --- | --- | --- | --- |
| GPU-F01 | Add a workload viability record containing input/output contract, host, GPU, and hybrid candidates, input-size matrix, target metrics, data provenance, risk, and measured crossover points | Versioned record validates; identical inputs measure accuracy, throughput, p50/p95 latency, warm-up, transfer, memory/VRAM, energy where observable, and desktop contention | B01, B09 |
| GPU-F02 | Build an opt-in bounded telemetry-window port with monotonic timestamps, schema versions, source identity redaction, retention limits, missing-sample markers, replay, and source-loss recovery | Unit/property/replay tests plus one real unprivileged collector; no unbounded history | B03, B06 |
| GPU-F03 | Standardize artifact qualification from reviewed source recipe through portable export, ncnn/Vulkan binding, tensor contract, digest, signature, license, and evidence bundle | Reproducible build and named-RX-6600-XT run; fail closed on altered files | B02, B05 |
| GPU-F04 | Add explicit periodic and event trigger contracts plus background priority, backpressure, cancellation, lease release, and interactive-job preemption | Stress test proves a background workload cannot make Cinnamon unresponsive and leaves no in-flight work after cancel/reload | B06 |
| GPU-F05 | Version reusable result families for risk scores, forecasts, rankings, detections, masks, embeddings, labels, and timestamped media evidence | Canonical schemas reject unknown, stale, non-finite, oversized, and contradictory output | B11 |
| GPU-F06 | Build generic Cinnamon surfaces for consent, run-now, background enablement, progress/cancel, evidence, warnings, history limits, and review-only results | Keyboard, pointer, screen-reader, reload, empty, unavailable, error, cancellation, and stale-result tests pass | B10 |
| GPU-F07 | Extend system acceptance with recorded input replay, real click-to-result hardware runs, worker/source/device loss, restart, cancellation, GPU pressure, and recovery | A workload becomes `ready` only after a real Cinnamon action performs real work on named hardware and produces its expected validated result | B12 |
| GPU-F08 | Reuse bounded media preprocessing for decode, orientation/color normalization, lossless image normalization, audio resampling, video frame/timestamp sampling, and temporary-file cleanup | Complex PDF, PNG, JPEG, SVG, TIFF, PPTX, ODP, audio, and video fixtures pass without an avoidable lossy intermediate | B05 |
| GPU-F09 | Define deterministic action ports with allowlists, preview, explicit confirmation, conflict checks, audit evidence, rollback where possible, and model-independent safety limits | Malformed or adversarial model output cannot invoke an action | B07 |

## Hardware and storage packages

The existing `hardware-health` (`OMNI-0085`–`0087`) and
`storage-intelligence` (`OMNI-0088`–`0090`) profiles supply policy identities,
not working applications. Incompatible sensor families need separate artifacts
and tensor contracts even when they share collection infrastructure.

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-H01 | Fan degradation prediction | Crossover unknown / blocked | Record RPM, PWM, temperature, load, and optionally consented audio/vibration windows; replay a device-specific anomaly model; report evidence only | GPU-F01–F05, F07; B01, B04, B05, B09, B12 |
| GPU-H02 | Power-supply health scoring | Crossover unknown / blocked | Define a PMBus, BMC, or vendor telemetry port for voltage, current, temperature, power, and fan signals; refuse hosts without trustworthy telemetry | GPU-F01–F05, F07; B01, B03–B05, B09, B12 |
| GPU-H03 | UPS battery degradation | Crossover unknown / blocked | Add a read-only Network UPS Tools adapter, bounded discharge/load histories, health score, and evidence; never replace deterministic low-battery shutdown policy | GPU-F01–F05, F07; B01, B03–B05, B07, B09, B12 |
| GPU-H04 | Disk and SSD failure warning | Crossover unknown / blocked | Normalize model-specific SMART/NVMe, latency, error, workload, and temperature histories; train a device-family-aware risk baseline; never delay backups | GPU-F01–F05, F07; `OMNI-0088`–`0090`; B01–B05, B09, B12 |
| GPU-H05 | Memory-fault precursor detection | Crossover unknown / blocked | Aggregate EDAC/RAS corrected errors with load and thermal windows, preserve DIMM/controller provenance, and surface an advisory risk score | GPU-F01–F05, F07; `OMNI-0085`–`0087`; B01, B03–B05, B09, B12 |
| GPU-S01 | Storage-tier recommendation | Crossover unknown / blocked | Reuse storage windows to rank hot/warm/cold/archive candidates; keep capacity, free-space, retention, migration, and deletion rules deterministic | GPU-F01–F07, F09; `OMNI-0088`–`0090`; B01, B05–B07, B09, B12 |

## Scheduling, network, and security packages

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-R01 | Workload placement hints | Crossover unknown / blocked | Record bounded job features and observed CPU, memory, I/O, latency, and accelerator outcomes; return a ranked placement hint with uncertainty | GPU-F01–F07; `OMNI-0091`–`0093`; B01, B05, B06, B09, B12 |
| GPU-R02 | Queue-delay forecasting | Crossover unknown / partial | Promote the existing opt-in local forecast path into a typed queue forecast, then expose it through the generic advisory surface | GPU-F01, F03–F07; `OMNI-0091`–`0093`; B01, B02, B05, B09, B10, B12 |
| GPU-N01 | Port-scan and reconnaissance detection | Crossover unknown / blocked | Aggregate connection attempts into privacy-bounded flow windows; benchmark rate rules, host models, GPU models, and hybrids; alert only | GPU-F01–F07; `OMNI-0108`–`0111`; B01, B03, B05, B06, B09, B12 |
| GPU-N02 | Wi-Fi interference classification | Crossover unknown / blocked | Define driver-independent features for channel occupancy, retries, signal, bitrate, disconnects, and survey data; classify congestion, interference, and device faults separately | GPU-F01–F07; `OMNI-0108`–`0111`; B01, B03–B06, B09, B12 |
| GPU-N03 | Privilege-escalation precursor detection | Crossover unknown / blocked | Create a separate host-security profile; collect redacted audit/process transition sequences through a privileged helper; publish review-only evidence without blocking or killing processes | GPU-F01–F07; `OMNI-0184`; B01–B07, B09–B12 |

## Developer-tool packages

These features advise existing deterministic test, compiler, static-analysis,
and fuzzing tools. They never lower mandatory quality gates or execute generated
commands.

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-D01 | Test prioritization | Crossover unknown / startable | Benchmark host and GPU rankers from changed paths, historical failures, duration, ownership, and coverage; always retain mandatory tests and show why each optional test moved | GPU-F01, F03, F05, F07; `OMNI-0094`–`0096`; B01, B02, B05, B07, B09, B12 |
| GPU-D02 | API-misuse classification | Crossover unknown / startable | Build one labeled corpus and compare AST/rules, a GPU classifier, and a hybrid on precision, recall, throughput, latency, memory, and explanation quality before selecting the production path | GPU-F01, F05, F07; B01, B07, B09, B11, B12 |
| GPU-D03 | Fuzz-input prioritization | Crossover unknown / startable | Export bounded input features plus novelty and coverage deltas; compare native fuzzer selection, host scoring, GPU scoring, and hybrids by new paths and bugs per wall-clock/energy budget | GPU-F01, F03, F05, F07; B01, B05, B09, B12 |
| GPU-D04 | Fuzz-crash deduplication | Crossover unknown / startable | Compare normalized signatures, host clustering, GPU embeddings, and hybrid cascades across crash volume and batch sizes; select from measured precision/recall, throughput, latency, memory, and operator review cost | GPU-F01, F05, F07; B01, B09, B11, B12 |
| GPU-D05 | Compiler-option suggestion | Crossover unknown / startable | Restrict output to previously validated allowlisted profiles; compare search, host, GPU, and hybrid recommenders using measured correctness, build cost, size, runtime, and memory | GPU-F01, F03, F05, F07, F09; B01, B05, B07, B09, B11, B12 |
| GPU-D06 | Resource-regression detection | Crossover unknown / startable | Version benchmark environments and compare statistical, host-model, GPU-model, and hybrid detectors on repeated CPU, memory, I/O, GPU, and startup measurements | GPU-F01–F05, F07; `OMNI-0094`–`0096`; B01, B05, B09, B12 |

## Local-file and visual packages

Auto-tagging and categorization share one taxonomy and evidence contract.
Segmentation and background removal share one mask provider. Pose reminders and
auto-framing share one landmark provider. Exact identity always uses a complete
cryptographic digest, while processor choice and candidate generation remain
performance-backed decisions.

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-L01 | Local file auto-tagging | Proven GPU component / partial | Extend the ready selected-file organizer with review-only tags for explicitly selected downloads, screenshots, scans, and attachments; benchmark metadata, GPU, and hybrid paths by file family and batch size | GPU-F01, F05–F08; B01, B10, B12, B13 |
| GPU-L02 | Document and download categorization | Proven GPU component / partial | Merge with GPU-L01 under one bounded taxonomy; compare MIME/metadata, extracted text/layout GPU inference, and hybrids on identical corpora | GPU-F01, F05–F08; B01, B09, B10, B12, B13 |
| GPU-L03 | Detect resized or lightly edited duplicates | Crossover unknown / startable | Benchmark scalar/SIMD perceptual hashes, batched GPU kernels or embeddings, and hybrid cascades across corpus and edit types; use full cryptographic digests for exact-duplicate claims | GPU-F01, F07; B09, B12, B13 |
| GPU-L04 | Local routine recognition | Crossover unknown / blocked | Collect only consented content-free event categories and timing; compare statistical, host-model, GPU-model, and hybrid suggestions; require confirmation for every proposed automation | GPU-F01–F07, F09; `OMNI-0112`–`0115`; B01, B05–B07, B09, B10, B12 |
| GPU-V01 | Find visually or semantically related images | GPU candidate / blocked | Complete the reviewed CLIP image-embedding export, ncnn binding, batching, embedding result schema, and selected-set similarity consumer; measure the batch crossover | GPU-F01, F03, F05–F07; `OMNI-0097`–`0101`; B01, B02, B05, B10, B12, B13 |
| GPU-V02 | Electronics or PCB inspection | GPU candidate / blocked | Create a visual-inspection detector contract; begin with aligned board/reference images, then qualify on representative boards and missing, misplaced, rotated, or damaged components | GPU-F01, F03, F05, F07, F08; B01, B02, B04, B05, B11, B12 |
| GPU-V03 | Foreground or person segmentation | GPU candidate / blocked | Select a license-compatible bounded model, export and qualify an ncnn artifact, return a validated alpha/binary mask, and preserve original geometry | GPU-F01, F03, F05, F07, F08; B01, B02, B05, B11, B12 |
| GPU-V04 | Background removal | GPU candidate / blocked on GPU-V03 | Reuse the segmentation worker and mask contract; benchmark composition placement; write a new PNG/WebP output without overwriting the source | GPU-V03, GPU-F06–F09; B07, B10, B12 |
| GPU-V05 | Low-light image enhancement | GPU candidate / blocked | Decide whether to retain the existing Edge-TPU identity or create a distinct Vulkan profile; only then qualify model, tensor contract, fidelity, artifacts, and end-to-end benefit | GPU-F01, F03, F05–F09; `OMNI-0048`, `OMNI-0102`–`0106`; B01, B02, B05, B08–B12 |

## Camera, equipment, and audio packages

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-C01 | Ergonomic posture reminders | GPU candidate / blocked | Qualify one pose-landmark worker, compare end-to-end host/GPU paths, compute transparent non-medical posture heuristics outside the model, and require opt-in camera use | GPU-F01, F03–F07; B01, B02, B04–B07, B10–B12 |
| GPU-C02 | Webcam auto-framing | GPU candidate / blocked on GPU-C01 | Reuse pose/person results, benchmark tracking and smoothing placement, preview the crop, and keep camera control outside model authority | GPU-C01, GPU-F06, F07, F09; B04, B07, B10, B12 |
| GPU-C03 | 3D-printer failure detection | GPU candidate / blocked | Add a low-rate continuous image classifier/detector with printer-specific normal and failure states; measure sample-rate/accuracy/latency tradeoffs; alert only | GPU-F01–F07; B01, B02, B04–B07, B10–B12 |
| GPU-A01 | Music genre, instrument, or mood tagging | GPU candidate / startable for selected audio | Reuse bounded audio decode/resampling, select separate label sets, qualify host/GPU candidates, and return timestamped confidence evidence | GPU-F01, F03, F05, F07, F08; B01, B02, B05, B09, B12 |

## Presentation, media, and screenshot packages

These are the fastest useful route because the installed media worker already
has qualified vision and speech artifacts and bounded PPTX/ODP, document,
image, audio, and video preprocessing. Legacy binary `.ppt` remains unsupported
until a bounded trusted conversion or parser is selected.

| ID | Use case | Fit / delivery | First implementation slice | Dependencies and blockers |
| --- | --- | --- | --- | --- |
| GPU-M01 | Presentation review | Proven GPU components / partial | Feed one explicitly selected PPTX, ODP, or PDF through slide-order-preserving extraction and visual description; measure the composition and return slide-bound issues, notes, accessibility text, and questions | GPU-F05–F08; B01, B10, B12 |
| GPU-M02 | Presentation planning | Proven GPU component / partial | Define a validated editable intermediate deck with titles, claims, source references, speaker notes, and assets; measure generation on selected material; export PPTX/ODP after confirmation | GPU-F05–F09; B01, B07, B10, B12 |
| GPU-M03 | Rehearsal or meeting briefing | Proven GPU components / partial | Align Whisper speech timestamps, sampled video frames, and slide changes; measure each stage and return transcript, timing, summary, decisions, proposed tasks, questions, and event candidates | GPU-F04–F08; B01, B06, B10, B12 |
| GPU-M04 | Media transcription and captions | Proven GPU components / partial | Extend the ready transcription result with SRT and WebVTT rendering, overlapping-speaker/timing validation, frame descriptions, cancellation-safe export, and full-stage measurements | GPU-F05–F08; B01, B10, B12 |
| GPU-M05 | Screenshot assistant | Proven GPU component / partial | Add an explicit screenshot/file action to the ready vision worker; measure capture-to-result and return visible text, scene/error/chart explanation, and reviewable transformations | GPU-F05–F08; B01, B10, B12 |

## Consolidated blocking issues

| ID | Blocking issue | Resolution required |
| --- | --- | --- |
| B01 | Representative labels and evaluation data are missing for most tasks | Freeze provenance-safe training, calibration, validation, drift, adversarial, and real-device holdouts with task-specific metrics; public proxy data alone cannot prove local quality |
| B02 | No approved publisher identity and key-custody process exists for new immutable artifacts | Choose signing ownership, protected key storage, rotation/revocation, build provenance, and release approval |
| B03 | Required collectors lack dependencies or privileges | Package read-only adapters and least-privilege helpers for SMART/NVMe, NUT, EDAC/RAS, audit/eBPF, Wi-Fi survey, camera, and printer sources; fail closed when unavailable |
| B04 | Representative hardware or sensors are absent on this host | Obtain named UPS/PSU telemetry, ECC/EDAC host, connected Wi-Fi test environment, webcam, vibration/acoustic rig, failing devices, and printer fixture as applicable |
| B05 | A qualified model, tensor contract, native artifact, and calibrated output do not exist | Select one model per compatible input/output family, prove license and reproducible export, bind to ncnn/Vulkan, and publish verified artifacts |
| B06 | Continuous collection has no approved consent, trigger, retention, or scheduling contract | Add explicit grants, revocation, bounded history, privacy/redaction, periodic/event triggers, background priority, backpressure, and interactive preemption |
| B07 | Recommendations do not yet have safe deterministic action adapters | Implement review/preview, allowlists, confirmation, conflicts, rollback, audit evidence, and hard policy limits outside inference |
| B08 | Low-light target identity is undecided | Keep and obtain Coral for the existing Edge-TPU profile, or create a separate Vulkan GPU identity and acceptance matrix; do not silently retarget the existing artifact |
| B09 | Useful CPU/GPU/hybrid crossover points are unmeasured | Benchmark identical data across input sizes and batch sizes, including accuracy, full collection/preprocessing/transfer/inference/postprocessing time, p50/p95 latency, throughput, warm-up, memory/VRAM, energy where observable, and desktop contention |
| B10 | Cinnamon exposes no generic contract/UI for most new results and background consent | Version result schemas and implement the shared interaction surface before adding bespoke buttons |
| B11 | Several tasks need a bounded-context/profile decision | Approve separate host-security, visual-inspection, segmentation, pose/camera, and audio-label providers rather than overloading unrelated built-ins |
| B12 | Real end-to-end and resilience acceptance is missing | Run real Cinnamon clicks on real inputs/hardware, verify expected output, warnings and recovery, and archive logs/metrics before showing `ready` |
| B13 | Bulk corpus inventory and persistent semantic indexing are outside this plan | Keep initial file operations manual and selected-input only; revisit large-corpus ownership, permissions, storage, recovery, and search separately |

## Evidence checkpoints

Public sources are useful for prototyping, not automatic acceptance:

- [NASA C-MAPSS](https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data)
  supplies noisy multivariate run-to-failure trajectories and includes fan
  degradation, but an aircraft-engine simulation does not validate desktop fan
  acoustic or vibration behavior.
- [Backblaze Drive Stats](https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data)
  supplies daily operational-drive SMART snapshots and failure outcomes, but
  schemas change and data-center drive behavior needs device-family and local
  workload transfer checks.
- [Network UPS Tools variables](https://networkupstools.org/docs/developer-guide.chunked/index.html)
  define useful charge, current, voltage, temperature, runtime, load, and test
  signals. Availability still depends on a supported UPS and driver.
- [Linux EDAC documentation](https://www.kernel.org/doc/html/latest/driver-api/edac.html)
  defines corrected, uncorrected, deferred, and fatal memory events. It cannot
  supply evidence on a machine whose memory controller is not exposed.
- [Google cluster traces](https://github.com/google/cluster-data) can prototype
  placement and queue features, but a cluster trace is not local workstation
  acceptance data.
- [CICIDS2017](https://www.cs.unb.ca/~alashkar/Data-sets.asp) includes labeled
  flow records and port-scan traffic. It is a historical laboratory corpus, so
  current local-network recall and false-positive rates still need measurement.
- [LLVM MLGO](https://www.llvm.org/docs/MLGO.html) demonstrates learned compiler
  decisions for specific inlining and register-allocation heuristics; it does
  not validate arbitrary compiler-option generation.
- [ClusterFuzz](https://google.github.io/clusterfuzz/) provides a production
  coverage-guided and crash-deduplication reference. Its quality and throughput
  become comparison points for signature, GPU-embedding, and hybrid candidates;
  they do not preselect the implementation.
- [DeepPCB](https://github.com/tangsanli5201/DeepPCB) provides 1,500 aligned
  reference/test pairs across six board-surface defect types. Missing or
  misplaced component inspection needs a different representative corpus.
- [Segment Anything](https://github.com/facebookresearch/segment-anything),
  [MediaPipe Pose Landmarker](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker),
  and [YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet) establish useful
  segmentation, pose, and audio-classification model families. Each still needs
  license review, a compatible native export, task-specific accuracy, and
  named-Vulkan acceptance.

## Dependency-ordered delivery waves

1. **Wave 0 — contracts and truth:** GPU-F01–F09, signing/key decision,
   low-light target decision, plugin taxonomy, and real readiness rules.
2. **Wave 1 — reuse installed workers:** GPU-M04, GPU-M05, GPU-M01, GPU-M02,
   GPU-M03, GPU-L01, and GPU-L02. Keep every input explicit and selected.
3. **Wave 2 — shared visual/audio artifacts:** GPU-V01, GPU-V03, GPU-V04,
   GPU-C01, GPU-C02, GPU-V02, and GPU-A01. One mask provider and one pose
   provider serve their dependent products.
4. **Wave 3 — measured developer and time-series advice:** GPU-D01–D06,
   GPU-R01–R02, GPU-H01–H05, GPU-S01, and GPU-N01–N02 after collectors have
   accumulated representative histories.
5. **Wave 4 — privileged and continuous operation:** GPU-N03, GPU-C03, and any
   automatic actions only after least-privilege helpers, opt-in background
   policy, real fixtures, false-positive limits, and recovery evidence exist.

For every row, use one commit for the result/schema contract, one for the
OmniTensor provider or collector, one for the Cinnamon consumer, and one for
real acceptance evidence when those concerns change independently. Each code
commit must include unit, integration, regression, fuzz/property, mutation, and
at least 80% coverage for every changed function. Documentation-only commits do
not manufacture a readiness claim.

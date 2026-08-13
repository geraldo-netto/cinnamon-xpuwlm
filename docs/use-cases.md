# Use cases and practicality

[Previous: Fundamentals and execution model](fundamentals.md) · [Documentation index](../README.md) · [Next: Hardware and software setup](setup.md)

## How to use this catalog

Start with the decision guide before choosing an application. The remaining material is separated into **evidence-labeled catalogs**, whose entries are classified as documented, derived candidates, or experimental, and a clearly isolated **speculative idea bank**, whose entries are brainstorming rather than capability claims.

Evidence labels such as **documented**, **derived candidate**, and **experimental** use the definitions in [How to read the evidence](fundamentals.md#how-to-read-the-evidence). Every workload still requires a compatible fully quantized model, a compiler report, and an end-to-end benchmark.

This catalog is written against the Edge TPU, and its hardware constraints stand unchanged. The workload manager itself now also routes workloads to NPU and GPU backends through the OmniTensor service, so a use case that fails the Edge TPU suitability gate may still be viable on another backend — that is a separate evaluation against that backend's own runtime, model format, and baseline, not a relaxation of anything stated here.

## Decision guide

### Practicality by workload

This table is an engineering-screening guide derived from the documented execution model. “Derived candidate” is not an official Coral performance claim.

| Workload | Evidence or potential fit | Main concern |
| --- | --- | --- |
| Continuous time-series anomaly detection | Derived candidate | Requires a compatible fixed-shape model and representative data |
| Batch image embedding and similarity indexing | Derived candidate based on documented embedding extractors | Vector indexing and search remain on the host |
| Continuous image classification or object detection | Documented task families | Decode, tracking, storage, and actions remain host work |
| Pose, segmentation, or bounded audio classification | Documented task families | The exact model must compile for the Edge TPU |
| Thermal, memory, or service-health forecasting | Derived candidate | Safety controls must remain deterministic |
| Idle-window and background-job prediction | Derived candidate | Benefits must exceed collection and invocation overhead |
| Process, storage, or job classification | Derived candidate | Many tabular models are already cheap on a CPU |
| High-volume document or event classification | Derived candidate | Parsing and tokenization remain CPU-bound |
| Sensor telemetry classification | Derived candidate based on supported dense/LSTM operations | Sampling and feature costs determine value |
| Predictive caching or application preloading | Experimental | Wrong predictions waste I/O and memory |
| Network-flow classification | Derived candidate | Feature extraction remains CPU-bound |
| Per-packet or per-query inference | Usually poor | Invocation and transfer overhead |
| General system acceleration | Unsupported | Edge TPU is not a general compute device |

### Suitability gate

Evaluate a workload in this order:

1. **Neural formulation:** Does the task genuinely require learned inference rather than a hash, threshold, parser, codec, database query, or deterministic rule?
2. **Framework path:** Can the model originate in TensorFlow and be converted to TensorFlow Lite?
3. **Quantization:** Can it retain acceptable accuracy under full 8-bit integer quantization?
4. **Compiler coverage:** Does the compiler map the entire performance-critical graph to the Edge TPU?
5. **Fixed input:** Can the application provide compile-time tensor shapes and bounded inputs?
6. **Frequency:** Does inference run often enough to amortize setup, transfer, and orchestration?
7. **Host cost:** Are capture, decoding, preprocessing, postprocessing, and actions cheap enough that inference matters?
8. **Risk:** Can an incorrect output be bounded, reviewed, or overridden?
9. **Baseline:** Does the complete Edge TPU pipeline beat the CPU-only TensorFlow Lite implementation on the metric that matters?
10. **Lifecycle:** Can the deployment tolerate the current archived state and version constraints of Coral's public software repositories?

For small tabular, signal, or time-series models, a CPU baseline is especially important. The overhead of invoking an accelerator can exceed the execution time of a tiny model.

### Poor or unsupported fits

| Workload | Why Coral is unsuitable or unnecessary |
| --- | --- |
| Model training from scratch | Edge TPU is designed primarily for inference |
| Large language models and chat assistants | Model size, precision, architecture, and generation requirements do not fit |
| Stable Diffusion or general image generation | Diffusion pipelines and model sizes are not a practical Edge TPU workload |
| Arbitrary CUDA, OpenCL, or Vulkan compute | Edge TPU exposes no general-purpose compute API |
| Video decoding and encoding | Use CPU/GPU/media-engine codecs |
| Compression, encryption, compilation, and rendering | These are not neural-network inference tasks |
| Database queries and filesystem operations themselves | The TPU may predict a policy but cannot execute the underlying work |
| Exact duplicate detection | Hashing is simpler and faster |
| Simple threshold rules or tiny classifiers | CPU execution usually has less overhead |
| Dynamic or unsupported neural architectures | Only compatible, fixed-shape, fully quantized TensorFlow Lite graphs are accelerated |

## Composed GPU workstation workflows

OmniTensor's GPU lane also makes larger, manually invoked workflows practical.
The entries below are proposed compositions, not claims that an end-to-end
application is delivered. They consolidate related atomic ideas from the
catalog so storage, retrieval, generation, and user actions are not described
as separate competing products.

| Workflow | Canonical detail | Composition and boundary |
| --- | --- | --- |
| Local content vault and organization | [Systems and data](use-cases/systems-and-data.md#local-content-vault-and-organization) | Incrementally catalog explicitly configured roots, extract bounded content, generate GPU embeddings, and return grounded search or review-only organization plans; hashing, indexing, filesystem access, and every mutation remain deterministic host work |
| Developer workbench | [Systems and data](use-cases/systems-and-data.md#developer-gpu-workbench) | Combine repository retrieval, logs, test reports, diffs, and local generation for cited investigation, review, and release-drafting assistance; commands, patches, and required quality gates remain under explicit user control |
| Presentation and media studio | [Vision and audio](use-cases/vision-and-audio.md#presentation-and-media-studio) | Reuse document, slide, vision, speech, and generation stages for deck review, rehearsal analysis, transcripts, subtitles, chapters, search, and reviewable edit plans |
| Daily multimedia briefing | [Vision and audio](use-cases/vision-and-audio.md#presentation-and-media-studio) | Compose selected documents, presentations, audio, video, and images into a cited summary, decisions, tasks, and event candidates without silently creating tasks, calendar entries, or edited media |

These workflows share one staged shape: explicit input, bounded deterministic
preprocessing, serialized accelerator work, schema and evidence validation,
then a reviewable result. A large archive must use a resumable tiered scan:
metadata first, full hashes only when required for an exact claim, embeddings
for new or changed bounded content, and expensive generative descriptions only
on demand. Interactive jobs take priority over background indexing, and every
stage remains cancellable so accelerator pressure cannot make the desktop
unresponsive.

## Evidence-labeled catalogs

| Catalog | Contents |
| --- | --- |
| [System, resource, and data workflows](use-cases/system-workflows.md) | Scheduling, resource policy, operations, reliability, classification, and telemetry |
| [Vision and audio](use-cases/vision-and-audio.md) | Image similarity, images, documents, video, camera streams, audio, speech, and vibration |
| [Systems and data](use-cases/systems-and-data.md) | Security, networks, sensors, automation, equipment, text, records, developer workflows, and research |
| [Physical automation](use-cases/physical-automation.md) | Robotics, fabrication, sorting, inspection, navigation, and sample routing |

## Speculative idea bank

This section intentionally suspends the reference requirement used by the earlier catalog. Every entry is a **speculative idea**: it may lack a dataset, model, implementation, accuracy study, compiler-compatible architecture, performance advantage, viable product, lawful deployment path, or even a good reason to use machine learning. Some ideas will fail the suitability gate, some will be better on a CPU/GPU or with deterministic code, and some should remain observation-only because of safety, privacy, fairness, or human-rights concerns.

The proposed Edge TPU role is always the bounded inference step, not the complete system. Capture, parsing, databases, search, rendering, networking, simulation, control, enforcement, and human decisions remain elsewhere. Overlap with the evidence-based catalog is deliberate: the purpose here is to explore contexts and combinations without turning them into claims.

- [Computing and communication](use-cases/speculative-computing.md): infrastructure, networks, storage, software delivery, desktops, accessibility, and collaboration.
- [Media, commerce, and industry](use-cases/speculative-industries.md): games, creative media, retail, finance, manufacturing, logistics, mobility, buildings, and utilities.
- [People, science, and environment](use-cases/speculative-people-and-science.md): agriculture, healthcare, emergency response, sports, science, education, domestic projects, and unusual ideas.

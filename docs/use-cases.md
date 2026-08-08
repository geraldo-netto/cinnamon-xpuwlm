# Use cases and practicality

[Previous: Fundamentals and execution model](fundamentals.md) · [Documentation index](../README.md) · [Next: Hardware and software setup](setup.md)

## Use-case catalog

### System, resource, and data workflows

The ideas below are preserved as derived application mappings, not documented Coral applications. Fully connected networks can represent fixed feature vectors, and Coral documents a constrained unidirectional LSTM plus an LSTM time-series tutorial. The compiler report—not the application label—determines whether a specific implementation is accelerated. [Supported operations](https://coral.ai/docs/edgetpu/models-intro/#supported-operations) · [LSTM time-series tutorial](https://colab.research.google.com/github/google-coral/tutorials/blob/master/train_lstm_timeseries_ptq_tf2.ipynb)

#### 1. Background-task scheduling

Predict suitable idle periods for backups, indexing, synchronization, updates, and maintenance. Features might include CPU load, user idle time, active applications, time of day, battery state, and recent workload patterns.

Possible actions include:

- delaying non-urgent jobs during interactive work;
- starting maintenance during predicted idle windows; and
- pausing or resuming services through `systemd`.

#### 2. Process-priority classification

Classify processes as interactive, background, batch, or latency-sensitive, then apply predefined policies with `nice`, `ionice`, systemd resource controls, or cgroup v2.

The model should recommend a bounded policy class rather than issue unrestricted system commands.

#### 3. Power-policy prediction

Predict an appropriate power profile from recent system activity. A controller can select an existing, tested profile such as:

- performance;
- balanced;
- power saving; or
- a workload-specific CPU or GPU profile.

#### 4. Predictive cache warming

Predict which project, application, dependency set, or file group is likely to be used next, then preload a small, bounded set of data.

Incorrect predictions increase disk activity and memory pressure, so measure cache-hit rate and total resource cost before enabling this permanently.

#### 5. Storage workload classification

Classify observed I/O patterns as interactive, sequential, random, or background. The result can inform per-process I/O priority, read-ahead profiles, or the timing of bulk operations.

The Edge TPU evaluates the model; it does not perform storage operations.

#### 6. Network-flow classification

Classify aggregated flow metadata as interactive, bulk, background, or latency-sensitive, then map each category to an existing traffic-control policy.

Packet capture, feature extraction, queueing, firewall evaluation, and traffic shaping still run on the host. Per-packet inference is usually a poor fit because feature extraction and transfer overhead can outweigh the cost of a small CPU model.

#### 7. System anomaly detection

Score compact system metrics or event summaries to detect unusual resource usage, process behavior, login patterns, or service failures. Results can trigger logging, notification, or a restricted response policy.

An Edge TPU complements rather than replaces normal Linux security controls, auditing, and rule-based detection.

#### 8. Memory-pressure forecasting

Use recent memory, swap, page-fault, reclaim, and per-cgroup activity to predict an approaching period of memory contention. A controller could pause low-priority workers, reduce job concurrency, or notify the user before responsiveness degrades.

Do not use a prediction as a substitute for `systemd-oomd`, cgroup limits, or the kernel OOM handler. Run it as an early-warning layer with conservative actions.

#### 9. Thermal-throttling prediction

Predict whether CPU, GPU, storage, or chassis temperature will cross a threshold in the next time window. Inputs can include temperature trends, utilization, clock frequencies, fan state, and ambient sensor readings.

The output can select an existing fan or power profile before throttling occurs. Firmware safety limits must remain authoritative; the model must never bypass them.

#### 10. Service-failure forecasting

Analyze rolling latency, error rate, queue depth, memory growth, restart history, and request volume to predict whether a local service is becoming unhealthy.

Safe responses include collecting diagnostics, sending an alert, draining new work, or scheduling a controlled restart. This can be useful for home servers, development environments, and always-on desktop services.

#### 11. Job runtime and resource estimation

Estimate the duration or peak resource demand of builds, test suites, backups, data imports, renders, and other repeatable jobs. A scheduler can use the estimate to choose concurrency, CPU affinity, or a start time.

This is most useful when predictions are frequent and derived from inexpensive metadata. For occasional jobs, a conventional regression model on the CPU is likely simpler.

#### 12. Build and test prioritization

Classify a source change by affected subsystem and use historical results to rank build targets or test shards. The goal is to run the most informative checks first and expose failures sooner.

Predictions should reorder required checks, not silently omit them. Extracting source-code embeddings can itself be CPU-heavy, so begin with compact features such as paths, dependency edges, change size, and recent failure history.

#### 13. Application and workspace prediction

Predict the next application, project, terminal session, or desktop workspace from time, active-window history, connected devices, and recent commands. The result can reorder a launcher, prepare a container, or pre-start an allowlisted application.

This is an experimental convenience feature. Incorrect preloading wastes memory and I/O, so require a confidence threshold and cap the number of speculative actions.

#### 14. Log and event triage

Classify high-volume local logs into known, suspicious, noisy, or urgent categories. This can prioritize events for display, route them to different retention policies, or detect a new pattern that deserves investigation.

Tokenization, parsing, and redaction remain CPU tasks. Never discard security or audit records solely because a model labels them unimportant.

#### 15. Document and message classification

Run a compact text or metadata classifier to tag downloaded files, route scanned documents, sort local mail, or flag likely spam and phishing messages without sending their contents to a cloud service.

This requires an Edge TPU-compatible text model and bounded input representation. Treat security labels as an additional signal rather than the only protection layer.

#### 16. Database and local-service workload classification

Classify query or request summaries as interactive, analytical, maintenance, or bulk work. A local database, search index, or self-hosted application can use the class to select a queue, concurrency limit, or maintenance window.

Inference should operate on aggregated metadata rather than every trivial query unless benchmarking shows a real benefit.

#### 17. UPS and battery-runtime prediction

Predict remaining runtime or discharge state from load, voltage, temperature, battery age, and recent discharge behavior. A desktop or home server can use the result to stage notifications, stop nonessential services, and prepare a graceful shutdown.

Keep the UPS's built-in low-battery signal and a deterministic shutdown threshold as fallbacks.

#### 18. Sensor and peripheral telemetry

Continuously classify or forecast non-media time series from USB, serial, Bluetooth, or networked sensors. Examples include temperature, humidity, air quality, vibration, energy consumption, and equipment telemetry.

Possible desktop and home-server applications include detecting an abnormal power signature, predicting a cooling problem, identifying equipment states, or triggering a local automation. Sensor polling and feature construction still run on the CPU.

#### 19. Data-pipeline routing

Classify incoming records, messages, or telemetry batches and route them to a parser, queue, retention policy, or alert path. This can help a desktop acting as a local integration server when the stream is continuous and the classifier is large enough to justify acceleration.

Schema validation and hard routing constraints should remain deterministic. The model should choose among valid destinations rather than invent actions.

### Image similarity and visual search

Yes, an Edge TPU can accelerate the embedding-extraction stage of an image-similarity system. Coral documents converting compatible MobileNet and Inception classifiers into embedding extractors. The Edge TPU converts each image into a compact feature vector; the host stores, compares, indexes, and searches those vectors. Applying the documented extractor pattern to similarity search is a derived use case, not a complete Coral-published search system. [Embedding extractor documentation](https://coral.ai/docs/edgetpu/retrain-classification-ondevice-backprop/)

```text
Image file or frame
        |
        v
Decode, resize, and normalize (CPU)
        |
        v
Quantized embedding model (Edge TPU)
        |
        v
Embedding vector
        |
        v
Normalize and search the vector index (CPU)
        |
        v
Nearest images and similarity scores
```

#### Matching workflow

1. Select or train an image model whose output is an embedding rather than a class label.
2. Fully quantize and compile the model for the Edge TPU.
3. Run every reference image through the model once and store its embedding with the image identifier.
4. Run a query image through the same preprocessing and model.
5. Dequantize the output when necessary and L2-normalize it.
6. Compare it with the stored embeddings using cosine similarity or another metric used during model training.
7. Return the closest matches only when they satisfy a threshold calibrated on representative images.

Cosine similarity is commonly calculated as:

```text
similarity = dot(query, reference) / (norm(query) * norm(reference))
```

After L2 normalization, this reduces to a dot product. A score is meaningful only relative to the chosen model and calibration dataset; there is no universal threshold for “high similarity.”

#### Choose the right similarity method

| Goal | Recommended method | Edge TPU role |
| --- | --- | --- |
| Detect byte-identical files | Cryptographic hash | None; use the CPU |
| Detect resized or lightly edited duplicates | Perceptual hash | Usually none; CPU methods are simpler |
| Find visually or semantically related images | General image embedding | Accelerate embedding generation |
| Match the same product, artwork, place, animal, or object instance | Metric-learning embedding trained for that domain | Accelerate embedding generation |
| Cluster a photo library | Embeddings followed by clustering | Generate embeddings; clustering remains on the CPU |
| Search millions of images | Embeddings plus an approximate nearest-neighbor index | Generate embeddings; indexing and search remain on the host |

Coral's documented MobileNet and Inception embedding extractors establish that compatible models can emit feature vectors. Whether those vectors are suitable for semantic retrieval, instance matching, or another similarity definition must be measured on representative data. A domain-trained metric-learning model is another derived option, but its exact architecture must still satisfy Edge TPU operation and quantization requirements.

For biometric matching, obtain appropriate consent, protect stored embeddings, calibrate false-match and false-rejection rates, and avoid using the result as the sole basis for access or another consequential decision.

### Domain catalog

The tables below separate the neural-network task from the surrounding application. **Documented** rows correspond to an official Coral model, example, or platform capability. A **derived candidate** maps an application to one of those documented model families but still requires a suitable dataset, a compatible quantized model, compilation, and end-to-end benchmarking. **Experimental** rows carry additional compatibility or cost uncertainty. The documented task families and examples are indexed in Coral's [trained-model catalog](https://coral.ai/models/) and [example catalog](https://coral.ai/examples/).

#### Images and documents

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Semantic image search | Embedding vector | Derived candidate; vector search runs on the CPU |
| Photo-library clustering | Embedding vector | Derived candidate; clustering and album management run on the CPU |
| Same-object or product matching | Domain-specific embedding | Derived candidate; requires metric-learning data |
| Image tagging | One or more labels | Documented classification family |
| Scene classification | Indoor, outdoor, office, street, and similar labels | Derived candidate based on the documented classification family |
| Object inventory | Object classes and boxes | Derived candidate based on the documented detection family; database updates run on the CPU |
| Face detection | Face boxes | Documented detection example; identity matching is separate |
| Face grouping or recognition | Face embeddings | Derived candidate; biometric safeguards required |
| Logo or brand detection | Labels or boxes | Derived candidate based on classification or detection |
| Artwork, landmark, or collectible matching | Embedding or class | Derived candidate; domain-specific data improves results |
| Image-quality triage | Blur, exposure, composition, or quality score | Derived candidate; simple blur metrics may be cheaper on the CPU |
| Sensitive-content screening | Content labels | Derived candidate; use as a review signal, not an infallible filter |
| Screenshot or UI-state classification | Screen or dialog class | Derived candidate; capture and automation remain on the CPU |
| Visual regression detection | Difference or anomaly score | Derived candidate; requires stable baselines and careful calibration |
| Document-type classification | Invoice, receipt, form, letter, and similar labels | Derived candidate classification workload |
| Document-layout detection | Text, table, signature, stamp, or field regions | Derived candidate detection or segmentation workload |
| OCR region detection | Text-region boxes | Derived candidate; character recognition and language processing may remain on the CPU |
| Handwriting or symbol recognition | Character, symbol, or short-token class | Derived candidate for bounded vocabularies |
| Barcode and QR localization | Code-region box | Usually use conventional decoders unless difficult scenes justify ML |
| Industrial defect inspection | Defect class, location, or anomaly score | Derived candidate when images arrive continuously |
| Electronics or PCB inspection | Missing, misplaced, or damaged component | Derived candidate detection workload |
| Microscopy slide triage | Cell, particle, or anomaly class | Derived candidate; not a substitute for validated clinical review |
| Plant-health classification | Species, disease, or stress class | Derived candidate classification workload |
| Wildlife or bird identification | Species class | Derived candidate classification workload |
| Food and ingredient recognition | Food class or object boxes | Derived candidate classification/detection workload |
| Aerial or map-tile classification | Land-use, damage, or object class | Derived candidate batch workload |
| Foreground or person segmentation | Per-pixel mask | Documented segmentation family |
| Background removal | Foreground mask | Derived candidate based on the documented segmentation family; compositing runs on the host |
| Privacy redaction | Face, person, screen, or plate mask/box | Derived candidate; blurring and policy logic run on the host |
| Depth or surface estimation | Depth map or surface class | Experimental; verify architecture and output cost |
| Denoising, super-resolution, or colorization | Reconstructed image | Experimental; large outputs and unsupported operations can erase the benefit |

#### Video and camera streams

Video decoding, frame selection, tracking, overlays, recording, and encoding generally remain on the CPU or GPU. The Edge TPU accelerates inference on selected frames.

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Local NVR object detection | Person, vehicle, animal, or package boxes | Derived candidate built on documented object detection; decoding and recording remain host work |
| Multi-camera event filtering | Objects or event class per sampled frame | Derived candidate when inference is sustained |
| Object tracking | Detections feeding persistent track IDs | Documented detection example; tracker runs on the host |
| Line crossing and zone entry | Tracked object and location | Derived candidate; geometry and event rules run on the host |
| Occupancy and people counting | Person detections or density estimate | Derived candidate; avoid identity inference when counts are sufficient |
| Parking-space monitoring | Vehicle and space occupancy | Derived candidate detection/segmentation workload |
| Traffic and queue monitoring | Object class, count, speed proxy, or queue state | Derived candidate; tracking and aggregation run on the host |
| Package or delivery detection | Package/person boxes | Derived candidate detection workload |
| Pet-door or feeder control | Species or individual class | Derived candidate; physical safety interlocks remain deterministic |
| Wildlife camera filtering | Animal class and box | Derived candidate; retain uncertain events to avoid false negatives |
| Pose estimation | Body keypoints | Documented pose family |
| Gesture control | Pose, hand state, or gesture class | Derived candidate built on pose/classification |
| Ergonomic posture reminders | Pose or posture class | Derived candidate; avoid medical claims |
| Fall-event alerting | Pose sequence or fall score | Derived candidate but high stakes; require confirmation and fallback monitoring |
| Head or gaze direction | Facial landmarks or direction class | Derived candidate; accessibility and privacy considerations apply |
| Webcam auto-framing | Person box or pose | Derived candidate; camera control and cropping run on the host |
| Virtual background | Person mask | Derived candidate based on the documented person-segmentation example |
| Live anonymization | Face/person mask or box | Derived candidate; rendering and encoding run on the host |
| Sign or bounded gesture recognition | Pose sequence or gesture label | Derived candidate; full sign-language translation is substantially harder |
| 3D-printer failure detection | Print-state or defect class | Derived candidate continuous-monitoring workload |
| Manufacturing-line inspection | Object, defect, or state class | Derived candidate when frames and classes are controlled |
| Retail shelf or stock monitoring | Product boxes and counts | Derived candidate; inventory reconciliation runs on the host |
| Sports pose or event tagging | Keypoints or bounded event class | Derived candidate; long temporal reasoning remains on the host |
| Time-lapse event selection | Interesting-frame or event score | Derived candidate batch/stream workload |
| Stream content moderation | Visual content labels | Derived candidate; human review and policy enforcement remain separate |

#### Audio, speech, and vibration

Audio capture, resampling, spectrogram creation, beamforming, decoding, and playback remain host tasks unless incorporated into a compatible model.

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Wake-word detection | Wake-word probability | Derived candidate based on the documented audio-classification and keyphrase families |
| Bounded voice commands | Command label | Documented keyphrase example |
| Environmental-sound classification | Sound-event label | Documented audio-classification family |
| Alarm, siren, glass-break, or smoke-alarm recognition | Event class | Derived candidate; never replace certified alarm systems |
| Baby-cry, cough, or snore event detection | Event label | Derived candidate; not medical diagnosis or safety assurance |
| Appliance-state recognition | Appliance or operating-state class | Derived candidate based on acoustic features |
| Machine acoustic anomaly detection | Normal/anomalous score | Derived candidate continuous-monitoring workload |
| Vibration-based predictive maintenance | State, fault, or remaining-life class | Derived candidate time-series workload |
| Speaker grouping or verification | Speaker embedding | Derived candidate; biometric consent and fallback required |
| Audio similarity and sound search | Audio embedding | Derived candidate; vector indexing remains on the CPU |
| Music genre, instrument, or mood tagging | Audio labels | Derived candidate classification workload |
| Voice activity detection | Speech/non-speech class | Usually better with conventional CPU methods unless part of a larger model |
| Direction-of-arrival classification | Direction class | Experimental; multichannel signal processing remains on the host |
| Speech enhancement or noise suppression | Enhanced samples or mask | Experimental; streaming and model compatibility are demanding |
| General speech-to-text | Token sequence | Usually a poor Coral fit; full ASR models often exceed practical compatibility constraints |

#### Security and network operations

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Flow-type classification | Interactive, bulk, streaming, or background class | Derived candidate; capture and traffic control run on the host |
| Network anomaly detection | Normal/anomalous score | Derived candidate on aggregated flow features |
| Intrusion-event prioritization | Risk or event class | Derived candidate; conventional IDS rules remain authoritative |
| DNS or domain-risk classification | Risk score | Derived candidate; blocklists and policy checks remain deterministic |
| Authentication anomaly detection | Login-risk score | Derived candidate; do not grant or deny access solely from the model |
| Process-behavior anomaly detection | Normal/anomalous score | Derived candidate based on aggregated metrics or event sequences |
| Malware triage from metadata | Suspicion or family class | Derived candidate; not a replacement for signatures, sandboxing, or EDR |
| USB or peripheral-behavior anomaly detection | Device-risk score | Derived candidate; device authorization remains rule-based |
| Local phishing and spam screening | Message-risk score | Derived candidate; links, signatures, and user review remain separate |
| Data-loss-prevention triage | Content or destination risk | Experimental; never silently destroy or block data without policy safeguards |
| Security-log prioritization | Severity or novelty score | Derived candidate; retain required audit records regardless of score |
| Resource-abuse detection | Mining, runaway job, or normal class | Derived candidate based on process and performance counters |

#### Sensors, home automation, and equipment

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Temperature or cooling forecast | Future temperature or threshold probability | Derived time-series candidate |
| Air-quality anomaly detection | Normal/anomalous or source class | Derived candidate using environmental sensors |
| Energy-load classification | Appliance or workload class | Derived candidate; electrical safety remains outside the model |
| Non-intrusive load monitoring | Appliance state from aggregate power | Derived candidate but model and sampling dependent |
| Water-use or leak-pattern detection | Usage class or anomaly score | Derived candidate; physical leak sensors remain valuable fallbacks |
| PIR or mmWave occupancy inference | Occupancy or activity class | Derived candidate non-camera presence detection |
| Radar or proximity gesture recognition | Gesture class | Derived candidate when preprocessing is inexpensive |
| Indoor comfort prediction | Comfort or ventilation recommendation | Derived candidate; user preferences and safe ranges remain explicit |
| Local weather or microclimate forecast | Future measurement or event probability | Derived candidate time-series workload |
| Garden irrigation recommendation | Watering class or moisture forecast | Derived candidate; hard moisture and weather constraints remain rule-based |
| Solar generation or demand forecast | Future power estimate | Derived candidate time-series workload |
| UPS runtime and battery-state forecast | Runtime or discharge class | Derived candidate with deterministic shutdown fallback |
| Server-rack or homelab health monitoring | Thermal, load, or failure score | Derived candidate when monitoring is continuous |
| Disk or SSD health trend detection | Failure-risk score | Derived candidate using SMART and latency history; never delay backups |
| Pump, fan, motor, or compressor state | Operating-state or fault class | Derived candidate using current, vibration, or acoustic inputs |
| Equipment predictive maintenance | Fault or remaining-life estimate | Derived candidate with representative failure data |
| Indoor localization from radio features | Location or zone class | Experimental; radio preprocessing and environment drift matter |
| Assistive switch from biosignals | Bounded intent or event class | Experimental and potentially high stakes; require reliable fallback input |

#### Text, records, and personal productivity

Most transformer-based language models are not Edge TPU compatible. These ideas assume a compact CNN, fully connected, or supported sequence model with a fixed input shape. Tokenization and embedding lookup may remain on the CPU.

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Document and download categorization | Document class | Derived candidate using text, layout, or metadata features |
| Mail, ticket, or notification routing | Intent, topic, or urgency class | Derived candidate for bounded taxonomies |
| Spam and phishing scoring | Risk score | Derived candidate; use alongside deterministic checks |
| Language identification | Language class | Derived candidate, though CPU libraries may be faster overall |
| Sentiment or bounded intent classification | Label | Derived candidate for compact models |
| Toxicity or content-policy triage | Risk labels | Derived candidate; policy and human review remain separate |
| Text similarity or local semantic search | Text embedding | Experimental; many modern embedding models are incompatible |
| Command or launcher prediction | Next-action class | Derived candidate but often too small to justify TPU overhead |
| Notification interruption control | Urgency or defer class | Experimental; provide transparent user controls |
| File-retention recommendation | Retention class | Experimental; never delete automatically based only on inference |
| Local recommendation ranking | Item score or class | Derived candidate for bounded catalogs and inexpensive features |
| Form and record routing | Destination class | Derived candidate; schema validation remains deterministic |
| Data-quality anomaly detection | Validity or anomaly score | Derived candidate for continuous structured-data streams |
| Duplicate-record candidate generation | Embedding or match score | Derived candidate; final merge needs deterministic checks or review |

#### Developer, operations, and research

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Edge-model prototyping | Inference outputs and latency | Documented development use |
| Quantization validation | Accuracy and compiler-coverage comparison | Documented development use |
| Compiler compatibility testing | Mapped versus CPU operations | Documented development use |
| Local inference microservice | Task-specific prediction | Derived candidate for sustained compatible workloads |
| Batch image or sensor backfill | Batched predictions or embeddings | Derived candidate when preprocessing keeps pace |
| Multiple independent inference workers | Concurrent predictions | Derived candidate for multiple TPUs |
| Model pipelining across TPUs | Intermediate and final outputs | Documented Coral capability for suitable large models |
| On-device transfer learning | New image classes | Documented specialized Coral workflow |
| Build and test prioritization | Target or test rank | Derived candidate using compact repository features |
| Job runtime and capacity prediction | Runtime or peak-resource estimate | Derived candidate for repeated jobs |
| Service-health forecasting | Failure or saturation probability | Derived candidate continuous-monitoring workload |
| Log clustering and incident triage | Event class or embedding | Derived candidate; parsing remains on the host |
| Automated experiment classification | Outcome or anomaly class | Derived candidate for high-volume laboratory runs |
| Waveform and pulse classification | Event class | Derived candidate for oscilloscopes, detectors, and instruments |
| RF spectrum classification | Signal or interference class | Derived candidate; FFT and radio processing remain on the host |
| Seismic or structural-event detection | Event or anomaly class | Derived candidate time-series workload |
| Telescope or sky-survey triage | Object or transient class | Derived candidate image-stream workload |
| Educational inference lab | Predictions, benchmarks, and compiler reports | Documented learning/prototyping use |

#### Robotics, fabrication, and physical automation

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Object sorting | Object class or box | Documented project pattern; actuators need safety interlocks |
| Pick-and-place part recognition | Part class, pose, or box | Derived candidate; motion planning runs elsewhere |
| Robot navigation perception | Object, free-space, or landmark class | Derived candidate; control and collision safety remain deterministic |
| Docking or target recognition | Target box or pose | Derived candidate visual workload |
| Bin-picking inventory | Object classes and locations | Derived candidate detection/segmentation workload |
| CNC or tool-condition monitoring | State or fault class | Derived candidate using image, vibration, or acoustic data |
| 3D-printer monitoring | Layer or failure class | Derived candidate continuous visual workload |
| Package and mail sorting | Destination or type class | Derived candidate classification/OCR pipeline |
| Agricultural sorting and grading | Crop class, quality, or defect | Derived candidate controlled-vision workload |
| Lab sample routing | Sample or container class | Derived candidate; identifiers should also use deterministic codes |

#### Poor or unsupported fits

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

## Speculative and extrapolated idea bank

This section intentionally suspends the reference requirement used by the earlier catalog. Every entry is a **speculative idea**: it may lack a dataset, model, implementation, accuracy study, compiler-compatible architecture, performance advantage, viable product, lawful deployment path, or even a good reason to use machine learning. Some ideas will fail the suitability gate, some will be better on a CPU/GPU or with deterministic code, and some should remain observation-only because of safety, privacy, fairness, or human-rights concerns.

The proposed Edge TPU role is always the bounded inference step, not the complete system. Capture, parsing, databases, search, rendering, networking, simulation, control, enforcement, and human decisions remain elsewhere. Overlap with the evidence-based catalog is deliberate: the purpose here is to explore contexts and combinations without turning them into claims.

### Servers, data centers, and platform operations

| Idea | Possible inference role |
| --- | --- |
| Rack thermal-hotspot prediction | Forecast a local temperature excursion from sensor histories |
| Cooling-loop anomaly detection | Classify pump, valve, pressure, and temperature patterns |
| Fan degradation prediction | Recognize vibration or acoustic signatures before failure |
| Power-supply health scoring | Detect abnormal voltage, current, temperature, or fan behavior |
| UPS battery degradation | Estimate battery state from discharge and load histories |
| Disk and SSD failure warning | Score SMART, latency, error, and temperature sequences |
| Memory-fault precursor detection | Classify corrected-error and workload patterns |
| Noisy-neighbor detection | Identify workloads causing shared-resource interference |
| Workload placement hints | Classify jobs by predicted CPU, memory, I/O, and latency profile |
| Queue-delay forecasting | Predict saturation before a request queue breaches a target |
| Autoscaling demand hints | Forecast near-term service demand from compact telemetry |
| Capacity-exhaustion warning | Predict when storage, memory, connections, or quota will run out |
| Cache-admission scoring | Predict whether an object is likely to be reused |
| Cache-eviction scoring | Rank objects by expected future value |
| Artifact and image prefetching | Predict which container layer or package will be requested next |
| Backup-window selection | Predict a low-impact period for snapshots or replication |
| Backup-integrity anomaly triage | Classify unusual size, duration, churn, or deduplication patterns |
| Storage-tier recommendation | Predict hot, warm, cold, or archival placement |
| Replica-placement hints | Score likely latency and failure-domain tradeoffs |
| Service-dependency incident ranking | Rank likely upstream causes from correlated telemetry |
| Alert grouping and deduplication | Embed alerts and cluster likely copies of one incident |
| Log-storm classification | Identify repetitive, novel, cascading, or urgent log bursts |
| SLO-breach forecasting | Predict a latency, availability, or error-budget breach |
| Graceful-degradation selection | Classify the safest predefined reduced-service profile |
| Maintenance impact estimation | Predict which services are likely to be affected by planned work |
| Spare-capacity estimation | Forecast recoverable capacity under a node or rack failure |
| Data-center energy shaping | Classify workloads that can be shifted to a lower-energy window |
| Carbon-aware batch timing | Predict flexible jobs that can tolerate a delayed start |
| Multi-TPU inference routing | Select a device or model queue from current load and cache state |
| Edge-site health summarization | Compress many local signals into a bounded health state |

### Networks, security, privacy, and identity

| Idea | Possible inference role |
| --- | --- |
| Application-aware flow classification | Infer traffic category from bounded flow metadata |
| Encrypted-traffic behavior classification | Classify timing and size patterns without inspecting payload text |
| DDoS precursor detection | Recognize shifts that precede a flood or exhaustion event |
| Port-scan and reconnaissance detection | Score connection patterns for coordinated probing |
| DNS anomaly detection | Classify unusual domain, timing, and resolver behavior |
| Data-exfiltration warning | Detect abnormal destination, volume, cadence, or protocol patterns |
| Rogue-device discovery | Compare a new device's network fingerprint with known classes |
| IoT device-type fingerprinting | Infer device family from passive traffic features |
| Wi-Fi interference classification | Recognize congestion, interference, or hardware-fault patterns |
| Radio-spectrum event classification | Identify bounded modulation or interference categories |
| Authentication risk scoring | Classify a login attempt from device and behavioral context |
| Impossible-behavior warning | Detect account activity inconsistent with recent local patterns |
| Privilege-escalation precursor detection | Score process and audit-event sequences for suspicious transitions |
| Endpoint process-behavior classification | Classify compact syscall, resource, or parent-child summaries |
| Malware-family triage | Classify static or behavioral feature vectors for analyst review |
| Ransomware early warning | Recognize unusual file-change, rename, and entropy patterns |
| Phishing-message triage | Classify local text, metadata, and rendered-page features |
| Lookalike-login-page detection | Compare screenshot embeddings with trusted interfaces |
| Secret-leak detection | Classify code or document spans likely to contain credentials |
| Sensitive-screen warning | Detect confidential content before screen sharing begins |
| Shoulder-surfing warning | Detect an additional nearby face without identifying the person |
| Privacy-redaction assistance | Detect faces, plates, screens, documents, or badges for masking |
| Tailgating warning | Classify door-entry sequences with deterministic access control retained |
| Badge/face consistency signal | Produce a review-only mismatch score with biometric safeguards |
| Package-risk triage | Rank updates from metadata, provenance, and behavior features |
| Configuration-drift classification | Distinguish expected, suspicious, and unexplained changes |
| Honeytoken interaction classification | Rank likely automation, accident, test, or hostile use |
| Abuse and bot detection | Classify request sequences without making irreversible decisions |
| Spam-campaign clustering | Embed messages and group likely coordinated campaigns |
| Local content-moderation signal | Flag bounded content categories for configurable review |

### Storage, databases, search, and data engineering

| Idea | Possible inference role |
| --- | --- |
| Query-intent classification | Route interactive, analytical, maintenance, and batch requests |
| Query-latency forecasting | Predict slow queries from plans, parameters, and current load |
| Plan-regression warning | Classify a new execution plan against prior behavior |
| Learned cardinality hint | Estimate a bounded selectivity or row-count class |
| Index-candidate ranking | Score proposed indexes for later deterministic evaluation |
| Hot-shard prediction | Forecast uneven access before a partition saturates |
| Compaction timing | Predict a low-impact window or high-benefit compaction |
| Connection-pool pressure warning | Forecast exhaustion from request and transaction patterns |
| Deadlock-risk warning | Classify transaction-order and lock-history summaries |
| Cache policy selection | Choose among tested cache profiles for a workload class |
| Record-linkage assistance | Embed fields and rank likely duplicate entities |
| Schema-drift detection | Classify incoming records that no longer match learned patterns |
| ETL failure prediction | Detect batches likely to fail validation or transformation |
| Data-quality anomaly scoring | Identify implausible values, combinations, or missingness patterns |
| Dataset-shift warning | Compare feature distributions with a known deployment baseline |
| PII and confidential-data classification | Label bounded fields for deterministic governance rules |
| Retention-policy suggestion | Classify records into allowlisted lifecycle categories |
| Document-ingestion routing | Select OCR, parser, language, or review pipelines |
| Table and field localization | Detect layout regions before conventional extraction |
| Semantic record search | Produce embeddings while the host maintains the index |
| Cold-data rehydration prediction | Forecast archived objects likely to be requested soon |
| Backup-delta forecasting | Estimate the size or duration class of the next backup |
| Restore-risk triage | Rank backups by anomalous history or incomplete validation |
| Synthetic-data quality scoring | Classify generated records for plausibility and coverage review |
| Data-labeling prioritization | Rank uncertain or diverse samples for human annotation |
| Stream-partition routing | Classify events into valid queues or processing branches |

### Developer tools, software delivery, and operations

| Idea | Possible inference role |
| --- | --- |
| Test prioritization | Rank tests most likely to reveal a regression first |
| Flaky-test prediction | Score tests from timing, host, and failure histories |
| Build-failure prediction | Classify a change before committing expensive build capacity |
| Build-duration estimation | Predict duration or resource classes from change metadata |
| CI runner selection | Match a job with an allowlisted runner profile |
| Change-risk scoring | Rank commits for deeper review without skipping required checks |
| Code-owner suggestion | Classify changed paths and semantics into ownership groups |
| Duplicate-bug detection | Embed reports, logs, and traces for similarity search |
| Crash and stack-trace clustering | Group likely instances of one underlying failure |
| Static-warning triage | Rank warnings likely to be actionable or security-sensitive |
| Code-review focus hints | Identify files or patterns deserving extra human attention |
| API-misuse classification | Detect bounded call patterns associated with common mistakes |
| Dependency-update risk | Score an update from API, test, and historical compatibility features |
| Release-regression warning | Detect metric changes resembling previous bad releases |
| Rollback recommendation signal | Classify telemetry into continue, observe, pause, or rollback candidates |
| Canary cohort selection | Rank representative nodes or users under deterministic constraints |
| Fuzz-input prioritization | Score generated inputs for novelty or likely code-path reach |
| Fuzz-crash deduplication | Embed traces or coverage summaries for clustering |
| Compiler-option suggestion | Classify a build into previously validated optimization profiles |
| Resource-regression detection | Recognize memory, CPU, I/O, or startup regressions |
| Semantic code search | Produce code embeddings for a host-side index |
| Commit-intent classification | Label fixes, features, refactors, tests, and documentation |
| Issue routing | Classify incoming issues by component and expertise |
| Documentation-gap detection | Rank code or API changes likely to need documentation |
| Example-code relevance ranking | Match a developer question with local sample embeddings |
| IDE command prediction | Predict a small set of likely next actions |
| Local completion candidate ranking | Re-rank pre-generated suggestions with a compact model |
| Terminal-command risk warning | Classify proposed commands before execution, never auto-authorize them |
| Infrastructure-change impact | Rank resources likely to be affected by a configuration change |
| Postmortem event alignment | Classify and group timeline events from several systems |

### Desktop, workstation, accessibility, and personal computing

| Idea | Possible inference role |
| --- | --- |
| Next-application prediction | Reorder launcher suggestions or prepare an allowlisted application |
| Workspace prediction | Predict the next virtual desktop from activity context |
| Window-layout suggestion | Select among predefined layouts for the current task class |
| Notification prioritization | Rank local notifications by urgency and context |
| Interruption-cost estimation | Delay noncritical prompts during likely focused work |
| Meeting-mode detection | Infer a call, presentation, or recording state from local signals |
| Adaptive power profile | Select among tested profiles from workload and battery context |
| Fan-profile anticipation | Predict thermal demand before a burst begins |
| Local file auto-tagging | Classify downloads, screenshots, scans, and attachments |
| Screenshot semantic search | Generate embeddings for a private local index |
| Clipboard sensitivity warning | Classify copied material before it is pasted or synchronized |
| Download-risk triage | Classify file metadata or previews for a review prompt |
| Typing-error correction signal | Classify likely mistypes in a bounded vocabulary |
| Keyboard-layout prediction | Suggest a likely input layout without silently changing it |
| Gesture shortcuts | Classify webcam, touchpad, or wearable gestures into allowlisted actions |
| Gaze-region estimation | Infer coarse focus regions for accessibility or UI studies |
| Voice-command selection | Classify a bounded offline command vocabulary |
| Screen-reader region detection | Detect controls, text blocks, images, and reading order hints |
| Local alt-text assistance | Classify objects and scenes for editable descriptions |
| Visual-salience estimation | Suggest magnification or reading focus regions |
| Tremor-aware pointer assistance | Classify motion patterns for a configurable smoothing profile |
| Posture reminder | Estimate coarse pose and issue nonmedical reminders |
| Fatigue-break suggestion | Classify interaction patterns into optional break prompts |
| Ambient-interface adaptation | Select contrast, brightness, or notification profiles from context |
| Presence-aware privacy mode | Hide previews when an additional viewer may be present |
| Lost-file retrieval | Embed previews and metadata for similarity-based recall |
| Personal photo curation | Rank duplicates, blur, expressions, and representative shots |
| Local routine recognition | Classify repeated device-use patterns for opt-in automation |
| Peripheral-failure warning | Classify mouse, keyboard, disk, battery, or dock telemetry |
| Applet status summarization | Compress service telemetry into a small panel state |

### Communication, collaboration, and personal knowledge

| Idea | Possible inference role |
| --- | --- |
| Email-priority ranking | Score messages for user-configurable queues |
| Thread-intent classification | Label requests, decisions, status, social, and reference messages |
| Reply-urgency estimation | Predict whether a message may need prompt attention |
| Local spam and scam triage | Classify content and metadata as an additional signal |
| Meeting action-item detection | Mark likely assignments in local transcript segments |
| Decision and question extraction | Classify transcript or note spans for review |
| Topic-boundary detection | Segment meetings, lectures, or podcasts into sections |
| Speaker-change detection | Classify audio windows without claiming speaker identity |
| Language identification | Select an offline transcription or translation path |
| Tone and sentiment cue | Offer an editable communication-quality warning |
| Conversation moderation cue | Flag likely abuse, escalation, or policy categories for review |
| Contact prediction | Rank likely recipients from local context |
| Attachment-mismatch warning | Detect when message intent suggests a missing attachment |
| Note auto-linking | Embed notes and rank likely conceptual connections |
| Personal knowledge retrieval | Generate embeddings for a private host-side search index |
| Duplicate-document detection | Compare semantic and visual embeddings |
| Calendar-overrun prediction | Forecast whether a meeting is likely to exceed its slot |
| Scheduling-friction estimation | Score proposed times from local historical patterns |
| Inbox batching | Classify messages that can be reviewed together |
| Voice-note routing | Classify short recordings by project, topic, or urgency |
| Offline keyword alerts | Detect a bounded phrase set in local audio streams |
| Shared-screen privacy filter | Detect sensitive regions before transmission |

### Games, esports, simulations, and interactive worlds

| Idea | Possible inference role |
| --- | --- |
| Adaptive difficulty | Classify player mastery into predefined difficulty adjustments |
| Tutorial intervention timing | Predict when a player is stuck or confused |
| Hint selection | Rank authored hints without generating unrestricted actions |
| Player-intent prediction | Classify likely next action from recent input state |
| Play-style classification | Identify exploration, combat, collection, building, or social patterns |
| Matchmaking-style features | Produce a play-style embedding under fair deterministic constraints |
| Churn-risk signal | Predict disengagement for optional, nonmanipulative interventions |
| Controller-gesture recognition | Classify motion-controller or camera gestures |
| Controller-drift detection | Recognize anomalous stick or sensor patterns |
| Accessibility-assist selection | Choose among tested input, subtitle, contrast, or timing aids |
| Voice-command shortcuts | Recognize bounded local game commands |
| NPC state classification | Select an authored behavior state from game observations |
| Companion responsiveness | Classify player context for predefined companion reactions |
| Bot-behavior detection | Distinguish likely automated and human input patterns for review |
| Cheat anomaly triage | Score impossible or unusual play sequences without automatic punishment |
| Toxic-chat signal | Flag bounded text or voice categories for moderation review |
| Dynamic-music intensity | Classify game tension to select authored music layers |
| Haptic-profile selection | Predict an authored vibration pattern from gameplay state |
| Stream highlight detection | Detect goals, wins, eliminations, reactions, or rare events |
| Automatic replay markers | Classify moments worth adding to a replay timeline |
| Spectator-camera selection | Rank predefined camera targets from current action |
| Esports event recognition | Detect tactical events from game telemetry or broadcast frames |
| Esports posture analysis | Estimate pose for optional ergonomics feedback |
| Speedrun split prediction | Forecast segment completion or likely time loss |
| Puzzle-state recognition | Classify a board or screen into authored hint states |
| Tabletop-piece recognition | Detect cards, dice, miniatures, tiles, or board state |
| Board-game referee aid | Identify moves or state changes for human confirmation |
| AR object anchoring aid | Detect or embed known physical objects for host tracking |
| Procedural-content quality scoring | Rank generated levels, maps, or items before human review |
| Level-balance telemetry | Classify playtest traces into difficulty or flow problems |
| Automated playtest triage | Rank simulations likely to contain a bug or dead end |
| Visual-regression testing | Detect UI, shader, asset, or animation anomalies |
| Asset-similarity search | Embed textures, props, characters, and animations |
| Animation-transition classifier | Select among authored transitions from pose and state |
| Game-stream scene classification | Detect menus, loading, gameplay, cutscenes, and interruptions |
| Cloud-gaming route hint | Classify network conditions into predefined transport profiles |

### Creative media, design, and entertainment

| Idea | Possible inference role |
| --- | --- |
| Photo-library curation | Rank representative, sharp, well-exposed, or emotionally salient shots |
| Near-duplicate photo grouping | Generate embeddings for host-side grouping |
| Live framing assistance | Classify composition and subject placement for optional guides |
| Focus or exposure warning | Detect blur, clipping, or missed subject focus |
| Shot-type classification | Label wide, medium, close-up, insert, and camera movement |
| Storyboard retrieval | Embed sketches and frames to find similar shots |
| Continuity-error detection | Compare props, wardrobe, position, or lighting across takes |
| Slate and take detection | Classify production frames or audio cues |
| Lip-sync drift warning | Classify local audio/video alignment windows |
| Dance and performance pose analysis | Estimate keypoints for rehearsal feedback |
| Animation reference indexing | Embed poses, motion snippets, and expressions |
| Music genre or mood classification | Label local tracks or live audio windows |
| Instrument and source recognition | Classify bounded instruments or sound sources |
| Beat, onset, and section cues | Classify audio windows for host-side timing logic |
| Sound-effect retrieval | Generate audio embeddings for a local library |
| Voice-activity detection | Separate likely speech and nonspeech windows |
| Podcast chapter suggestion | Detect topic or acoustic boundaries |
| Ad, jingle, and intro detection | Recognize known acoustic patterns |
| Profanity review cue | Flag bounded audio segments for editorial review |
| Broadcast highlight detection | Recognize applause, crowd peaks, graphics, or action patterns |
| Thumbnail candidate ranking | Score authored frames for clarity and relevance |
| Layout salience scoring | Predict visual hierarchy for a designer's review |
| Font or style classification | Tag assets by visual style for search |
| Palette and color-style classification | Group images or designs by learned appearance |
| Brush and pen gesture recognition | Map stylus motion into authored tool shortcuts |
| 3D asset auto-tagging | Classify rendered previews of meshes and materials |
| Texture-seam or defect detection | Flag tiling, compression, UV, or rendering artifacts |
| Costume and wardrobe indexing | Embed garment images for production search |
| Archive-footage search | Generate visual and audio embeddings locally |
| Content-version comparison | Detect meaningful visual changes among edits or exports |

### Retail, commerce, hospitality, finance, and insurance

| Idea | Possible inference role |
| --- | --- |
| Shelf-stock detection | Detect empty facings, misplacement, or low inventory |
| Product recognition | Classify or detect items at checkout or intake |
| Visual product search | Generate embeddings for host-side catalog search |
| Price-label mismatch warning | Compare detected product and displayed label regions |
| Queue-length estimation | Count or estimate waiting customers without identity tracking |
| Footfall pattern classification | Classify occupancy flow for staffing or layout analysis |
| Store-zone congestion warning | Detect crowding or blocked paths |
| Counterfeit-product triage | Compare packaging or item embeddings with references |
| Return-condition classification | Detect visible wear, damage, missing parts, or wrong items |
| Return-fraud review signal | Score transaction and item features for human review |
| Demand-shift warning | Forecast short-horizon category demand from local signals |
| Basket-intent classification | Classify a session for noncoercive assistance |
| Vending-machine restock prediction | Detect item count and forecast depletion |
| Cash-drawer anomaly detection | Classify transaction and sensor sequences |
| Receipt and invoice routing | Detect document type, fields, and exception classes |
| Transaction-anomaly triage | Score patterns for analyst review, not automatic denial |
| Payment-terminal tamper detection | Classify visual or sensor changes around a terminal |
| ATM surroundings warning | Detect obstruction, tampering, or unsafe maintenance conditions |
| Insurance damage triage | Classify visible damage type and severity for adjuster review |
| Claim-document completeness | Detect missing document or field categories |
| Hotel-room inspection | Detect missing, damaged, or misplaced inventory |
| Restaurant plate-quality review | Classify presentation or portion consistency |
| Food-waste measurement | Detect and categorize discarded food |
| Kitchen process timing | Recognize authored preparation stages from vision or audio |
| Drive-through queue prediction | Forecast wait and staffing needs from bounded telemetry |
| Loyalty-fraud anomaly signal | Classify unusual redemption behavior for review |
| Branch cash-demand forecast | Predict bounded replenishment classes from local history |
| Market-display monitoring | Detect stale, missing, or inconsistent displayed information |

### Industrial systems, manufacturing, and maintenance

| Idea | Possible inference role |
| --- | --- |
| Surface-defect inspection | Detect scratches, dents, cracks, stains, or finish anomalies |
| Assembly-completeness check | Detect missing, misplaced, reversed, or wrong components |
| Assembly-step recognition | Classify the current step for optional operator guidance |
| Fastener verification | Detect presence, position, or visible seating of fasteners |
| Weld-quality triage | Classify images, thermal patterns, current, or acoustic signatures |
| Solder-joint inspection | Detect bridges, voids, insufficient solder, or misalignment |
| PCB inspection | Detect missing, rotated, damaged, or substituted components |
| Tool-wear prediction | Classify vibration, sound, force, or image patterns |
| Machine-state recognition | Identify idle, setup, cutting, jammed, starved, or fault states |
| Predictive-maintenance signal | Score multivariate sensor windows for impending failure |
| Bearing and gearbox diagnosis | Classify vibration and acoustic signatures |
| Pump cavitation warning | Recognize characteristic pressure, vibration, or sound patterns |
| Valve-state inference | Classify actuator and process signals when direct sensing is absent |
| Leak detection | Identify visual, acoustic, pressure, or thermal signatures |
| Conveyor-jam prediction | Recognize flow changes before a stoppage |
| Product counting | Detect or classify items crossing a station |
| Label and packaging verification | Detect wrong, missing, skewed, or unreadable labels |
| Gauge and display reading | Detect a bounded dial, indicator, or screen state |
| Thermal-anomaly inspection | Classify hotspot shapes and locations |
| Process-drift warning | Detect multivariate patterns departing from a validated process |
| Yield-loss prediction | Forecast scrap or rework risk from process features |
| Recipe/profile selection hint | Choose among validated machine profiles for a material class |
| Quality-sampling prioritization | Rank items that deserve destructive or human inspection |
| PPE detection | Detect prescribed visible equipment as one safety signal |
| Restricted-zone presence | Detect people or objects near a guarded area |
| Ergonomic-risk cue | Estimate coarse pose for optional workstation feedback |
| Robotic-cell anomaly detection | Classify unusual motion or object states |
| Spare-part visual identification | Embed or classify parts for maintenance lookup |
| Maintenance-procedure step check | Recognize expected visible stages for technician confirmation |
| End-of-line anomaly summarization | Combine several bounded inspection outputs into review classes |

### Logistics, warehouses, postal systems, and supply chains

| Idea | Possible inference role |
| --- | --- |
| Parcel classification | Detect size, shape, package type, and handling category |
| Parcel-damage detection | Classify dents, tears, wetness, crushing, or opened seals |
| Pallet-state inspection | Detect leaning, missing wrap, overhang, or damaged loads |
| Container-seal verification | Compare seal presence and appearance with expected state |
| Barcode-localization assistance | Find difficult code regions before conventional decoding |
| Handwritten-address routing | Classify bounded postal zones or character sequences |
| Inventory-count reconciliation | Detect shelf items and flag disagreement with records |
| Misplaced-item detection | Compare detected item class with an allowed storage zone |
| Pick-error warning | Verify an item or bin before confirmation |
| Pack-station completeness | Detect required components before sealing |
| Dock-congestion prediction | Forecast queue growth from arrivals and handling telemetry |
| Forklift near-miss signal | Detect unsafe proximity or trajectory patterns |
| Cold-chain anomaly prediction | Classify temperature, door, route, and dwell-time sequences |
| Shipment-delay risk | Predict a bounded delay class from local route events |
| Load-stability scoring | Classify visual load arrangement before deterministic checks |
| Route-condition classification | Select among predefined transport or handling profiles |
| Proof-of-delivery validation | Detect expected package and location context for review |
| Lost-object search | Generate embeddings from warehouse camera snapshots |
| Baggage routing assistance | Classify bag type, state, and likely exception conditions |
| Conveyor-diverter timing hint | Predict an item class early enough for deterministic control |
| Yard occupancy classification | Detect trailers, containers, open slots, and blockages |
| Drone inventory audit | Detect or embed rack labels and stock from captured imagery |

### Robotics, drones, vehicles, and mobility

| Idea | Possible inference role |
| --- | --- |
| Semantic obstacle classification | Label nearby people, vehicles, animals, tools, or terrain |
| Traversability estimation | Classify image or sensor patches as safe, uncertain, or blocked |
| Terrain-type recognition | Select among validated locomotion profiles |
| Grasp-candidate scoring | Rank host-generated grasp candidates |
| Object-pose estimation | Predict bounded keypoints or orientation classes |
| Grip-slip warning | Classify tactile, force, audio, or visual sequences |
| Tool recognition | Detect which known tool is present or requested |
| Human gesture commands | Map bounded gestures to allowlisted robot actions |
| Human-intent cue | Classify coarse approach, stop, pass, or handover patterns |
| Human-fall detection | Detect pose transitions for an alert, not a diagnosis |
| Docking-target detection | Locate a known marker, port, or charging station |
| Battery-health prediction | Score discharge, temperature, and load history |
| Motor and actuator fault detection | Classify current, vibration, temperature, and position errors |
| Fleet anomaly detection | Identify one robot behaving unlike its peers |
| Swarm-role suggestion | Classify local context into predefined cooperative roles |
| Drone landing-zone classification | Rank host-generated zones by visible suitability |
| Drone crop or infrastructure survey | Detect anomalies in captured frames |
| Driver-attention cue | Estimate coarse gaze, pose, or eyelid state with privacy controls |
| Cabin occupancy classification | Detect occupied seats or unsafe object placement |
| Road-hazard detection | Detect debris, potholes, standing water, or stopped objects |
| Traffic-sign recognition | Classify visible signs as an advisory sensor input |
| Cyclist or pedestrian intent cue | Classify coarse motion patterns without replacing control logic |
| Parking-space occupancy | Detect open, occupied, obstructed, or restricted spaces |
| Rail-surface inspection | Detect cracks, obstructions, fastener, or alignment anomalies |
| Platform-edge safety signal | Detect a person or object in a predefined risk zone |
| Maritime debris detection | Detect floating hazards in camera imagery |
| Person-overboard cue | Detect a fall or person in water for rapid review |
| Underwater species or structure inspection | Classify organisms, corrosion, damage, or debris |
| Prosthetic gesture intent | Classify muscle or motion signals into bounded control states |
| Wheelchair navigation intent | Classify user input and context into assisted motion commands |
| Delivery-robot handoff verification | Detect recipient interaction state without autonomous identity judgment |

### Buildings, campuses, cities, utilities, and energy

| Idea | Possible inference role |
| --- | --- |
| Room-occupancy estimation | Detect or infer coarse occupancy without identity tracking |
| HVAC demand prediction | Forecast local heating or cooling need |
| Air-quality anomaly detection | Classify particulate, gas, humidity, and airflow patterns |
| Water-leak warning | Detect acoustic, flow, pressure, or visual signatures |
| Appliance signature classification | Identify bounded loads from aggregate power signals |
| Elevator-fault prediction | Classify vibration, motor, door, and timing patterns |
| Escalator anomaly detection | Recognize step, handrail, motor, or obstruction patterns |
| Adaptive lighting profile | Select among validated scenes from occupancy and ambient context |
| Waste-bin fill estimation | Detect capacity and contamination for collection planning |
| Recycling-stream classification | Detect material categories for assisted sorting |
| Parking occupancy and turnover | Detect space state and forecast short-horizon availability |
| Intersection-flow classification | Classify traffic density and movement patterns |
| Pedestrian-density warning | Detect crowding without identifying individuals |
| Crowd-flow anomaly cue | Classify counterflow, stoppage, or rapid density changes |
| Road-surface damage survey | Detect potholes, cracks, markings, and debris |
| Streetlight fault detection | Classify lamp state from electrical or visual telemetry |
| Water-network anomaly detection | Recognize leak, blockage, pressure, or meter patterns |
| Sewer and drain inspection | Detect cracks, roots, blockages, or deformation |
| Grid-load forecasting | Predict local load classes from recent telemetry |
| Transformer health scoring | Classify thermal, acoustic, electrical, or dissolved-gas patterns |
| Solar-panel fault detection | Detect hot cells, soiling, shading, or output anomalies |
| Wind-turbine condition monitoring | Classify vibration, acoustic, thermal, or power signatures |
| Battery-storage health estimation | Predict degradation or abnormal cell behavior |
| EV-charger fault triage | Classify session, thermal, connector, and power failures |
| Demand-response eligibility | Identify flexible loads under deterministic user policy |
| Smoke and flame cue | Detect visible or sensor patterns as an additional alarm signal |
| Building-envelope inspection | Detect moisture, insulation gaps, cracks, or thermal leakage |
| Noise-source classification | Label bounded environmental sounds for local planning |
| Campus shuttle demand | Forecast stop-level demand from local histories |
| Public-facility maintenance triage | Detect visible damage, litter, blockage, or missing equipment |

### Agriculture, animals, food systems, and the environment

| Idea | Possible inference role |
| --- | --- |
| Crop-disease classification | Detect visible disease or stress patterns |
| Weed detection | Distinguish crop, weed, soil, and residue regions |
| Pest detection | Detect insects, damage, traps, or infestation signs |
| Fruit-ripeness estimation | Classify visible maturity stages |
| Harvest-yield estimation | Count or score visible fruit, grain, or plant development |
| Irrigation-need prediction | Forecast a bounded watering class from soil and weather signals |
| Soil-condition classification | Classify sensor or image features into management categories |
| Greenhouse climate prediction | Forecast temperature, humidity, condensation, or disease risk |
| Livestock counting | Detect animals in pens, fields, or passages |
| Livestock-behavior classification | Recognize feeding, resting, walking, agitation, or isolation patterns |
| Animal-health warning | Classify gait, posture, sound, intake, or temperature anomalies |
| Feed-consumption anomaly | Detect changes in feeding patterns or dispenser telemetry |
| Fence and gate inspection | Detect gaps, damage, obstruction, or open state |
| Wildlife-camera triage | Detect species, count events, and reject empty frames |
| Invasive-species detection | Classify known plants, insects, fish, or other organisms |
| Bird and bat acoustic monitoring | Classify local call or activity categories |
| Pollinator activity estimation | Detect visits and classify coarse pollinator groups |
| Beehive health signal | Classify audio, vibration, temperature, and entrance activity |
| Aquaculture behavior monitoring | Detect feeding, schooling, surface activity, or distress cues |
| Water-quality anomaly detection | Classify chemical, optical, temperature, and flow patterns |
| Algal-bloom warning | Detect visual or sensor signatures associated with blooms |
| Wildfire smoke cue | Classify camera or air-sensor patterns for rapid review |
| Flood and runoff warning | Forecast local water-level or flow state |
| Landslide precursor detection | Classify soil-motion, moisture, acoustic, and weather sequences |
| Erosion and shoreline survey | Detect visual change in repeated local imagery |
| Litter and illegal-dumping detection | Detect waste categories for cleanup dispatch |
| Habitat-change monitoring | Compare repeated visual embeddings and segmentation outputs |
| Coral-reef survey | Classify reef organisms, bleaching, damage, or debris |
| Local weather nowcasting | Forecast a bounded near-term weather class from local sensors |
| Food-spoilage signal | Classify visual, gas, temperature, or spectral patterns |

### Healthcare, wellness, care, and assistive technology

These ideas are especially sensitive. Any implementation would require appropriate clinical evidence, regulation, consent, security, bias analysis, and human oversight. The Edge TPU should not be the sole basis for diagnosis, treatment, access to care, medication, restraint, or an emergency decision.

| Idea | Possible inference role |
| --- | --- |
| Medical-image triage cue | Flag a bounded visual pattern for qualified review |
| Microscopy sample screening | Detect cells, organisms, particles, or morphology classes |
| Assay-strip interpretation | Classify a controlled test-strip image under validated conditions |
| Specimen-label consistency | Compare label, container, and workflow states for review |
| Medication-package recognition | Detect a known package as one verification step |
| Pill appearance comparison | Compare shape, color, and imprint with a verified reference |
| Rehabilitation pose feedback | Estimate keypoints and compare with clinician-authored exercises |
| Range-of-motion tracking | Classify movement stages for supervised rehabilitation |
| Fall-detection alert | Recognize a possible fall from pose or wearable signals |
| Gait-change monitoring | Embed or classify repeated walking patterns for review |
| Tremor pattern classification | Classify motion windows for longitudinal measurement |
| Sleep-stage proxy | Classify bounded wearable or bedside sensor patterns |
| Breathing-pattern warning | Detect unusual respiratory audio or motion patterns |
| Cough-event classification | Detect and count bounded acoustic event categories |
| Seizure-pattern alert cue | Classify wearable or video sequences for rapid human response |
| Fatigue and alertness cue | Estimate coarse behavioral state for optional prompts |
| Posture and pressure-risk cue | Classify pose or pressure patterns for caregiver review |
| Handwashing step recognition | Detect authored hygiene-procedure stages |
| Wound-image change tracking | Compare controlled images for clinician review |
| Dental-image triage cue | Flag bounded visible patterns for a qualified professional |
| Nutrition photo logging | Classify foods or portions for editable records |
| Hearing-assist environment classification | Select among user-approved sound profiles |
| Sound-event alerts for deaf users | Recognize alarms, knocks, speech, vehicles, or appliances |
| Obstacle cues for blind users | Detect nearby object categories as an assistive signal |
| Document and label reading assistance | Detect regions and route them to OCR or speech |
| Sign-language component recognition | Estimate hands, pose, or bounded signs for communication aids |
| Augmentative-communication gesture input | Classify personalized gestures into a controlled vocabulary |
| Prosthetic-control intent | Classify EMG or motion features into bounded device commands |
| Elder-routine anomaly cue | Detect an opt-in departure from an established local pattern |
| Caregiver workload triage | Classify nonclinical alerts for routing and prioritization |
| Therapy-game adaptation | Classify task performance into clinician-authored difficulty levels |
| Privacy-preserving room activity | Recognize coarse care events without retaining raw imagery |

### Emergency response and public safety

| Idea | Possible inference role |
| --- | --- |
| Smoke, flame, and heat cue | Detect a possible event as an additional alarm channel |
| Structural-damage survey | Classify visible cracks, collapse, debris, or blocked access |
| Disaster-image triage | Rank imagery likely to contain severe damage or urgent needs |
| Search-and-rescue person detection | Detect possible people in bounded camera or thermal imagery |
| Trapped-person acoustic cue | Classify knocks, calls, alarms, or movement sounds |
| Flood-depth classification | Estimate bounded water-level classes from fixed cameras |
| Wildfire-front observation | Segment smoke, flame, and burned-area patterns for analysts |
| Evacuation-route congestion | Detect blockage, density, or counterflow patterns |
| Crowd-crush precursor cue | Classify dangerous density and motion changes for human response |
| Railway-crossing obstruction | Detect a person, vehicle, or object in a predefined zone |
| Person-overboard alert | Detect a likely fall or person in water for confirmation |
| Siren and alarm classification | Identify bounded local emergency sound categories |
| Hazard-label recognition | Detect known placards for responder information |
| PPE and team-state awareness | Detect visible responder equipment and coarse activity state |
| Emergency-call routing cue | Classify local transcript segments into dispatch categories |
| Damage-report deduplication | Embed images and reports to group the same incident |
| Supply-priority classification | Rank requests into human-defined emergency logistics classes |
| Shelter occupancy estimation | Detect coarse occupancy without identity tracking |
| Water-contamination anomaly cue | Classify local sensor patterns for immediate sampling |
| Avalanche or rockfall signal | Classify acoustic, seismic, radar, or visual events |
| Rescue-drone landing-zone cue | Rank candidate zones for human pilots |
| False-alarm pattern analysis | Classify recurring sensor combinations for maintenance review |

### Sports, fitness, coaching, and officiating

| Idea | Possible inference role |
| --- | --- |
| Exercise repetition counting | Detect pose stages or wearable motion cycles |
| Technique feedback | Compare keypoints with coach-authored movement patterns |
| Running-gait classification | Classify stride patterns for optional coaching |
| Cycling posture feedback | Estimate pose and bike-relative alignment |
| Swimming-stroke classification | Recognize stroke type, phase, or turn events |
| Strength-training form cue | Detect bounded movement deviations without medical claims |
| Reaction-time training | Detect stimulus and response events locally |
| Ball and puck tracking aid | Detect a fast object for host-side tracking |
| Shot, serve, or swing classification | Classify motion and impact signatures |
| Score-event detection | Recognize goals, baskets, hits, laps, or finishes |
| Officiating review cue | Detect a possible line, boundary, contact, or sequence event |
| Player-position classification | Estimate keypoints or field positions for analysis |
| Tactical-pattern recognition | Classify authored formations or play phases |
| Substitution and fatigue cue | Score workload patterns for coach review |
| Equipment-state inspection | Detect wear, damage, fit, or setup anomalies |
| Sports-video highlight detection | Classify action, crowd, scoreboard, and celebration events |
| Amateur automatic camera | Rank host-generated framing targets |
| Climbing-move recognition | Estimate body and hold interaction for training |
| Martial-arts sequence recognition | Classify authored movement stages for practice review |
| Dance timing feedback | Compare pose and beat-aligned movement patterns |
| Esports ergonomics reminder | Classify posture and break patterns locally |
| Venue congestion monitoring | Detect coarse crowd density and flow without identity tracking |

### Science, laboratories, field research, and space

| Idea | Possible inference role |
| --- | --- |
| Microscopy cell classification | Detect morphology, count objects, or flag anomalies |
| Particle and droplet counting | Detect bounded objects in controlled imagery |
| Colony and growth measurement | Segment biological growth in repeated images |
| Lab-instrument display reading | Detect indicators, digits, plots, or alarm states |
| Experiment anomaly detection | Classify multivariate telemetry departing from normal runs |
| Sample mix-up warning | Compare container, label, position, and workflow state |
| Chromatogram pattern classification | Classify curve shapes or run-quality states |
| Spectral signature classification | Map bounded spectra into known material or event classes |
| Materials-defect microscopy | Detect cracks, grains, inclusions, pores, or phase patterns |
| Geological sample classification | Classify rock, mineral, sediment, or texture images |
| Fossil-fragment matching | Generate embeddings for host-side similarity search |
| Archaeological fragment matching | Compare pottery, inscription, tool, or material embeddings |
| Plankton and organism counting | Detect and classify bounded microscopy or camera samples |
| Bioacoustic field monitoring | Classify species calls and reject background noise |
| Camera-trap event triage | Detect organisms and discard empty frames |
| Seismic-event classification | Distinguish bounded quake, blast, vehicle, and noise patterns |
| Volcano-sensor anomaly cue | Classify seismic, gas, acoustic, and thermal sequences |
| Telescope transient triage | Classify candidate flashes, trails, artifacts, or variable sources |
| Meteor detection | Detect streaks or flashes in local sky-camera frames |
| Satellite-image change triage | Detect land, water, fire, cloud, or infrastructure change |
| Radio-signal event classification | Identify bounded interference or candidate signal classes |
| Radiation-detector pulse classification | Classify pulse-shape windows into known event categories |
| Autonomous lab quality gate | Score an observation before deterministic continuation |
| Rover terrain classification | Label traversability and geological context for host planning |
| Spacecraft telemetry anomaly cue | Classify compact sensor sequences for operator review |
| Orbital hardware visual inspection | Detect damage, debris, alignment, or thermal anomalies |
| Ocean-instrument anomaly detection | Classify drift, fouling, calibration, or sensor failure |
| Citizen-science edge station | Filter and classify local images, sounds, or sensor events |
| SETI candidate triage | Rank bounded signal windows for later scientific analysis |
| Reproducibility monitor | Classify experiment runs that diverge from a validated profile |

### Education, training, museums, and skill development

| Idea | Possible inference role |
| --- | --- |
| Handwriting feedback | Classify characters, stroke order, or legibility patterns |
| Pronunciation practice | Classify bounded phonemes, words, or error categories |
| Reading-aloud cue | Detect pauses, skipped lines, or known-word mistakes |
| Sign-language practice | Estimate pose and classify a bounded sign vocabulary |
| Musical-instrument practice | Detect notes, rhythm events, posture, or technique classes |
| Laboratory-safety cue | Detect prescribed equipment and procedure states |
| Vocational procedure training | Recognize authored assembly, maintenance, or craft steps |
| Sports and dance instruction | Compare pose sequences with instructor examples |
| Adaptive exercise selection | Classify mastery into teacher-authored next activities |
| Flashcard difficulty prediction | Estimate recall class from local practice history |
| Misconception triage | Classify answer patterns into instructor-defined categories |
| Diagram and object recognition | Trigger local explanatory content from a camera view |
| Museum exhibit recognition | Detect an object and select a local guide segment |
| Offline field-guide assistant | Classify plants, animals, rocks, or artifacts locally |
| Classroom acoustic classification | Detect speech, silence, noise, or alarm categories |
| Collaborative participation cue | Summarize coarse turn-taking for voluntary reflection |
| Project and resource recommendation | Embed local work and match it with curated materials |
| Plagiarism-similarity triage | Embed submissions for human review, not automatic judgment |
| Makerspace tool-safety cue | Detect tool, material, PPE, and authorized activity state |
| Educational robot perception | Recognize objects, gestures, and course markers |
| Accessibility adaptation | Select teacher-approved visual, audio, timing, or input support |
| Local quiz scanning | Detect marked regions and route ambiguous answers for review |

### Playful, domestic, artistic, and deliberately unusual ideas

| Idea | Possible inference role |
| --- | --- |
| Smart-mirror wardrobe search | Embed garments and find visually related combinations |
| Outfit repetition diary | Cluster opt-in outfit images without cloud upload |
| Fridge leftover inventory | Detect known containers and food categories |
| Pantry depletion warning | Count visible items and forecast restocking |
| Bread-doneness classifier | Classify crust appearance under one controlled camera |
| Coffee or tea brew-state cue | Classify color, sound, temperature, and timing patterns |
| Laundry sorting assistant | Classify garment color, material, or care category |
| Lost-sock matcher | Compare garment embeddings after a wash |
| Dish-loading suggestion | Detect item classes and rank authored rack zones |
| Houseplant mood lamp | Classify plant and soil state into decorative light scenes |
| Plant-generated music | Map sensor-state classes into authored musical patterns |
| Pet activity diary | Classify sleep, play, feeding, pacing, or door events |
| Pet sound classifier | Label a personal set of barks, meows, chirps, or cage sounds |
| Pet-door species filter | Detect authorized species or object classes with a safe fallback |
| Aquarium behavior monitor | Classify feeding, schooling, hiding, algae, or equipment state |
| Terrarium climate cue | Predict a habitat profile from local sensors and activity |
| Backyard wildlife radio | Trigger authored sounds or facts from species detections |
| Telescope observing assistant | Reject clouds, detect drift, and classify visible targets |
| Meteor-shower counter | Detect likely meteor streaks in a local sky camera |
| Neighborhood sound diary | Classify opt-in local sound categories without storing audio |
| Personal memory search | Embed private photos, notes, and audio for local retrieval |
| Dream-journal clustering | Embed user-written entries and group recurring themes |
| Time-capsule curator | Rank representative local media from a chosen period |
| Meme and reaction-image search | Generate embeddings for a private image collection |
| Cosplay reference matcher | Match costume components, poses, and visual details |
| Building-block sorter | Detect shape, color, printed pattern, or known part class |
| Trading-card organizer | Detect card identity, set, condition, or visual similarity |
| Puzzle-piece matcher | Embed piece shape and artwork for host-side candidate ranking |
| Board-game state assistant | Detect pieces and changes for player confirmation |
| Magic-trick cue system | Recognize an authored gesture or prop state to trigger effects |
| Escape-room controller | Classify bounded prop, pose, sound, or progress states |
| Interactive haunted-house timing | Detect approach and posture to select an authored effect |
| Museum or gallery reactive art | Map local pose, movement, or sound classes into artwork states |
| Gesture-controlled synthesizer | Classify hand or body gestures into musical controls |
| Dance-floor lighting | Classify motion density and rhythm into authored light scenes |
| Mood-object classifier | Classify a chosen set of personal objects into playful labels |
| Scent or electronic-nose classification | Classify bounded sensor-array signatures |
| Household mystery-noise finder | Classify known appliance, plumbing, pet, and structure sounds |
| Mailbox event classifier | Detect delivery, collection, tampering, or false triggers |
| Package-arrival sorter | Classify incoming parcels into household notification groups |
| Model-railroad observer | Detect trains, rolling stock, signals, and layout anomalies |
| Miniature-robot arena referee | Detect robots, zones, objects, and authored rule events |
| Generative-art quality filter | Rank host-generated images or sounds for an artist's review |
| Offline personal pattern oracle | Forecast harmless routines while clearly presenting uncertainty |
| Serendipity engine | Rank locally stored media that is dissimilar but contextually adjacent |
| Intentional anti-recommender | Find overlooked items outside the user's dominant clusters |
| Ambient home status icon | Compress many local classifiers into a calm, nonverbal display |
| Coral-on-Coral reef exhibit | Classify reef imagery locally and drive an educational installation |

## Practicality by workload

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

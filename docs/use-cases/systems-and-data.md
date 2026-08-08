# Systems and data use cases

[Previous: Vision and audio](vision-and-audio.md) · [Use-case index](../use-cases.md) · [Documentation index](../../README.md) · [Next: Physical automation](physical-automation.md)

## Security and network operations

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

## Sensors, home automation, and equipment

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

## Text, records, and personal productivity

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

## Developer, operations, and research

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

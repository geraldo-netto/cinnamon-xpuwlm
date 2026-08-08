# Proposed workload profiles

## 1. Hardware health

- Power-supply health scoring
- UPS and battery-runtime prediction
- Memory-fault precursor detection
- Suggested: thermal-throttling forecast
- Suggested: TPU runtime, temperature, and disconnect monitoring

## 2. Storage intelligence

- Disk and SSD failure warning
- Disk or SSD health trend detection
- Storage workload classification
- Cache-eviction scoring
- Storage-tier recommendation
- Suggested: backup-window selection
- Suggested: storage-capacity exhaustion warning

The two disk-health cases become one risk pipeline with short-term alerts and long-term trends.

## 3. Resource scheduler

- Noisy-neighbor detection
- Workload placement hints
- Queue-delay forecasting
- Background-task scheduling
- Job runtime and capacity prediction
- Suggested: service-failure forecasting
- Suggested: bounded admission and overload classification

## 4. Build advisor

- Compiler-option suggestion
- Resource-regression detection
- Suggested: build and test prioritization
- Suggested: compiler compatibility and Edge TPU delegation checks

## 5. Network and peripherals

- Wi-Fi interference classification
- USB or peripheral-behavior anomaly detection
- Suggested: aggregated network-flow classification

Device authorization and network enforcement remain rule-based.

## 6. Desktop context

- Window-layout suggestion
- Suggested: application and workspace prediction

Only predefined layouts and allowlisted actions may be selected.

## 7. Document intelligence

- Document and download categorization
- Duplicate-document detection
- Suggested: document-layout and OCR-region detection

## 8. Visual library

- Screenshot semantic search
- Personal photo curation
- Match the same product, artwork, place, animal, or object instance
- Semantic image search
- Image tagging
- Scene classification
- Suggested: image-quality triage

Screenshot semantic search and general semantic image search share one embedding and vector-index service with separate collections and retention policies.

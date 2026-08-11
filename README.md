# Cinnamon XPU Workload Manager

## Overview

Cinnamon XPU Workload Manager (`cinnamon-xpuwlm`) is a Cinnamon panel client
for local accelerator workloads served by OmniTensor. Here **XPU** is the
product's umbrella term for any supported accelerator: TPU, NPU, or GPU. It is
not a fourth runtime backend; manifests and snapshots continue to use the
precise `tpu`, `npu`, and `gpu` backend identifiers.

The project began as an Edge TPU integration, so the evidence and use-case
catalog below retain detailed Coral coverage. Those hardware-specific terms
remain intentionally unchanged.

The Google Coral Edge TPU is a small application-specific integrated circuit (ASIC) for low-power machine-learning inference. A single Edge TPU is rated for up to 4 trillion fixed-point operations per second (4 TOPS) at 2 TOPS per watt. This is a peak arithmetic specification, not a promise of application throughput. Actual performance depends on the model, host, interface, runtime, and the work performed outside the accelerator. [Coral FAQ](https://coral.ai/docs/edgetpu/faq/) · [Coral benchmarks](https://coral.ai/docs/edgetpu/benchmarks/)

The Edge TPU is a coprocessor. It executes compatible portions of a compiled, fully quantized TensorFlow Lite model; the host system remains responsible for input acquisition, decoding, feature preparation, unsupported operations, output interpretation, storage, networking, user interfaces, and actions. [Inferencing overview](https://coral.ai/docs/edgetpu/inference/) · [Model requirements](https://coral.ai/docs/edgetpu/models-intro/)

The workload manager built around this hardware is no longer TPU-only. Its version 1 runtime snapshot models one to sixteen accelerator devices across three backends — `tpu`, `npu`, and `gpu`, preferred in that order — and a separate sibling project, the OmniTensor runtime service (private repository, Python), owns device discovery, per-backend execution, scheduling, and snapshot publishing. There is deliberately no CPU backend: the CPU is the host's scarcest shared resource, and inference never falls back onto it; when no accelerator is available, the applet shows an explicit unavailable/recovery state rather than degrading silently. None of this relaxes the Edge TPU's own capabilities or constraints described below.

This document is application-neutral. It explains the hardware and software boundary first, then preserves the existing application ideas as mappings onto documented model families. Inclusion in the catalog means that an idea can be formulated as a neural-network task; it does not mean Coral publishes that application, that a compatible model already exists, or that the Edge TPU will outperform a CPU.

## Documentation index

- Product artifacts
  - [Production Cinnamon applet](docs/applet.md) — current behavior, runtime boundary, quality gates, and installation
  - [Reference UI/interaction design](design/prototype/DESIGN.md) — approved prototype rationale and states; not the live implementation
  - [Consolidated workload profiles](design/prototype/WORKLOADS.md)
  - [Prototype screen gallery](design/prototype/mockup/screens/all-screens.png)
  - [Compact panel status montage](design/prototype/mockup/xpuwlm-panel-status-montage.png)
- [Fundamentals and execution model](docs/fundamentals.md)
  - [Documentation and maintenance status](docs/fundamentals.md#documentation-and-maintenance-status)
  - [How to read the evidence](docs/fundamentals.md#how-to-read-the-evidence)
  - [What the Edge TPU is](docs/fundamentals.md#what-the-edge-tpu-is)
  - [What the Edge TPU is not](docs/fundamentals.md#what-the-edge-tpu-is-not)
  - [What it can and cannot do](docs/fundamentals.md#what-it-can-and-cannot-do)
  - [Neural-network inference](docs/fundamentals.md#neural-network-inference)
  - [Execution boundary](docs/fundamentals.md#execution-boundary)
  - [Model compatibility](docs/fundamentals.md#model-compatibility)
  - [Memory, performance, and scaling](docs/fundamentals.md#memory-performance-and-scaling)
- [Use cases and practicality](docs/use-cases.md)
  - [Decision guide](docs/use-cases.md#decision-guide)
  - [System, resource, and data workflows](docs/use-cases/system-workflows.md)
  - [Vision and audio](docs/use-cases/vision-and-audio.md)
  - [Systems and data](docs/use-cases/systems-and-data.md)
  - [Physical automation](docs/use-cases/physical-automation.md)
  - [Speculative idea bank](docs/use-cases.md#speculative-idea-bank)
- [Hardware and software setup](docs/setup.md)
  - [Hardware integration](docs/setup.md#hardware-integration)
  - [Software setup](docs/setup.md#software-setup)
- [Cinnamon applet integration](docs/cinnamon-integration.md)
- [Workload plug-in authoring](docs/workload-plugins.md)
- [Runtime control contract](docs/runtime-control.md)
- [Deployment, safety, and references](docs/deployment.md)
  - [Virtualization](docs/deployment.md#virtualization)
  - [Deployment and evaluation workflow](docs/deployment.md#deployment-and-evaluation-workflow)
  - [Safety and operational limits](docs/deployment.md#safety-and-operational-limits)
  - [References](docs/deployment.md#references)

## Summary

The Edge TPU is a narrow but capable accelerator: it executes the compatible, compiled, 8-bit TensorFlow Lite portion of an inference pipeline. It can support documented classification, detection, segmentation, pose, audio-classification, embedding, limited sequence, multi-model, multi-device, and final-layer transfer-learning workflows. It cannot replace the host, run arbitrary models or general compute, train a full network, or guarantee an end-to-end speed or power improvement.

The evidence-based application catalog is therefore a set of mappings, not promises, while the separate speculative idea bank is intentionally a source-free brainstorming inventory. A use case is justified only when its model compiles well, quantized accuracy remains acceptable, the host-side work is controlled, the complete pipeline beats a CPU baseline, operational risk is bounded, and the archived software stack can be maintained for the intended lifetime.

The repository now includes the production Cinnamon panel applet. It presents
accelerator and workload state, persists local profile intent, and reads a
validated snapshot from a trusted local service; it does not contain the
inference service or directly enforce workload policy. That service — the
OmniTensor runtime, not the panel UI — owns the per-backend runtimes, compiled
models, input validation, per-workload queues, scheduling, inference,
accounting, and recovery. It can accept many jobs concurrently, but it
serializes dispatch to each physical accelerator. Weighted userspace scheduling
can approximate shares such as 25/25/25/25 under contention; it cannot
physically partition one device or provide hard isolation.

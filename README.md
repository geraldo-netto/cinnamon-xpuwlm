# Cinnamon XPU Workload Manager

## Overview

Cinnamon XPU Workload Manager (`cinnamon-xpuwlm`) is a third-party Cinnamon
panel helper for local machine-learning workload profiles across supported TPU,
NPU, and GPU backends.

The helper is a panel presence and a way into the client. It reads the runtime's
published snapshot to show whether the accelerator is working and whether
anything is waiting, and it starts the Python client (`xpuwlm`), which owns
every real interaction: workload screens, workflow forms, policy controls, and
contract validation against the canonical schemas. The helper never talks to the
runtime's control socket and ships no schema copies of its own.

[OmniTensor](https://github.com/geraldo-netto/omnitensor) is the current
reference runtime and test integration, not the definition of this applet. A
different local runtime can integrate by publishing the same validated snapshot
contract and serving the same framed control socket the client speaks. The
snapshot the helper reads is version 1 and retains the OmniTensor namespace, so
another provider must publish that exact document until a provider-neutral
successor is versioned. Without a compatible runtime, the helper falls back to
device-only monitoring of what the snapshot last said and the client has
nothing to drive.

Here **XPU** is an umbrella for the supported `gpu`, `npu`, and `tpu` backend
families. It is not a fourth backend, a claim of universal accelerator support,
or a substitute for each workload's hardware and model acceptance evidence.

> **Status:** early preview (`0.1.0`). Monitoring, control, setup guidance, and
> the client foundations are implemented. End-to-end inference requires a
> compatible runtime service, matching hardware and runtime packages,
> configured input roots, and exact
> model artifacts. Most built-in profiles are readiness-gated. Event extraction
> becomes available only when a compatible external provider is installed,
> configured, qualified, and reported ready by the live runtime inventory.

The project began as an Edge TPU integration, so the evidence and use-case
catalog below retain detailed Coral coverage. Those hardware-specific terms
remain intentionally unchanged.

The Google Coral Edge TPU is a small application-specific integrated circuit (ASIC) for low-power machine-learning inference. A single Edge TPU is rated for up to 4 trillion fixed-point operations per second (4 TOPS) at 2 TOPS per watt. This is a peak arithmetic specification, not a promise of application throughput. Actual performance depends on the model, host, interface, runtime, and the work performed outside the accelerator. [Coral FAQ](https://coral.ai/docs/edgetpu/faq/) · [Coral benchmarks](https://coral.ai/docs/edgetpu/benchmarks/)

The Edge TPU is a coprocessor. It executes compatible portions of a compiled, fully quantized TensorFlow Lite model; the host system remains responsible for input acquisition, decoding, feature preparation, unsupported operations, output interpretation, storage, networking, user interfaces, and actions. [Inferencing overview](https://coral.ai/docs/edgetpu/inference/) · [Model requirements](https://coral.ai/docs/edgetpu/models-intro/)

The workload manager built around this hardware is no longer TPU-only. Its
version 1 runtime snapshot models one to sixteen accelerator devices across the
three backend families. Each workload declares its own allowed backends and
preference order. OmniTensor deliberately defines no CPU scheduling backend:
it refuses CPU-only inference providers instead of silently changing lanes.
The host CPU still performs ordinary application work such as acquisition,
decoding, validation, preprocessing, transport, and result handling. When no
declared accelerator lane is available, the applet shows an explicit setup or
recovery state. None of this relaxes the Edge TPU's own capabilities or
constraints described below.

This document is application-neutral. It explains the hardware and software boundary first, then preserves the existing application ideas as mappings onto documented model families. Inclusion in the catalog means that an idea can be formulated as a neural-network task; it does not mean Coral publishes that application, that a compatible model already exists, or that the Edge TPU will outperform a CPU.

## Documentation index

- Product artifacts
  - [Cinnamon helper](docs/applet.md) — what the panel shows, what moved to the client, and the quality gates
  - The reference design, the mockups, the execution model and the use-case notes
    live with the client that implements them, in `../xpuwlm/design` and
    `../xpuwlm/docs`: they described that client rather than this applet
  - Workload guides — event extraction, ask-selected-files, selected-text tools, file organizer and media transcription are documented with the runtime that implements them, in `../omnitensor/docs/`
- [Hardware and software setup](docs/setup.md)
  - [Hardware integration](docs/setup.md#hardware-integration)
  - [Software setup](docs/setup.md#software-setup)
- [Cinnamon applet integration](docs/cinnamon-integration.md)
- Workload plug-in authoring and the runtime control contract — `../omnitensor/docs/extension-guide.md` and `../omnitensor/docs/control-boundary.md`
- [Deployment, safety, and references](docs/deployment.md)
  - [Installing the applet](docs/deployment.md#installing-the-applet)
  - [Virtualization](docs/deployment.md#virtualization)
  - [Deployment and evaluation workflow](docs/deployment.md#deployment-and-evaluation-workflow)
  - [Safety and operational limits](docs/deployment.md#safety-and-operational-limits)
  - [References](docs/deployment.md#references)

## Summary

The Edge TPU is a narrow but capable accelerator: it executes the compatible, compiled, 8-bit TensorFlow Lite portion of an inference pipeline. It can support documented classification, detection, segmentation, pose, audio-classification, embedding, limited sequence, multi-model, multi-device, and final-layer transfer-learning workflows. It cannot replace the host, run arbitrary models or general compute, train a full network, or guarantee an end-to-end speed or power improvement.

The evidence-based application catalog is therefore a set of mappings, not promises, while the separate speculative idea bank is intentionally a source-free brainstorming inventory. A use case is justified only when its model compiles well, quantized accuracy remains acceptable, the host-side work is controlled, the complete pipeline beats a CPU baseline, operational risk is bounded, and the archived software stack can be maintained for the intended lifetime.

The repository includes the deployable Cinnamon panel helper. It shows
accelerator and runtime state read from a snapshot a trusted local service
publishes, and opens the Python client for everything else; it holds no policy,
no job submission, and no inference service. A compatible runtime
service — not the panel UI — owns per-backend runtimes, compiled models, input
validation, per-workload queues, scheduling, inference, accounting, and
recovery. OmniTensor is the current reference implementation. Such a service
can accept many jobs concurrently, but it
serializes dispatch to each physical accelerator. Weighted userspace scheduling
can approximate shares such as 25/25/25/25 under contention; it cannot
physically partition one device or provide hard isolation.

## Mutation testing

The Stryker campaign runs each behavior module only against its matching unit
tests. After the split the helper has three: the status model, the snapshot
read, and the launcher. Scoped campaigns deliberately keep incremental mode disabled: the old
command-runner cache attributed coverage to one anonymous test and could not
invalidate results safely. Regenerate mutation evidence from a clean campaign
until the harness provides reliable per-test attribution.

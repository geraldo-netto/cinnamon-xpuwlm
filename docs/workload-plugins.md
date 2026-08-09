# Workload plug-in authoring

[Documentation index](../README.md) · [Applet runtime boundary](applet.md#runtime-boundary)

Workload plug-ins are declarative directories containing one `manifest.json`.
Copy [`../templates/workload-plugin/manifest.json`](../templates/workload-plugin/manifest.json)
to `files/cinnamon-tpuwm@geraldo-netto/workloads/<id>/manifest.json`, then replace
every placeholder. Directory name and manifest `id` must match.

## Contract

`workload-manifest.schema.json` is authoritative. Version 1 requires:

- stable workload and semantic-version identities;
- bounded capability names;
- runtime API, accelerator, device, and optional replaceable model requirements;
- user-facing title, group, description, symbolic icon, and unique display order;
- disabled/enabled and weight defaults;
- explicit host-pipeline responsibilities; and
- measurable acceptance criteria.

### Accelerator requirements

`requirements.accelerator` is the backend the workload was designed for, one of
`tpu`, `npu`, or `gpu`. The former `edge-tpu` value is retired: a third-party
manifest that still declares `accelerator: "edge-tpu"` now fails validation
loudly. Migration is mechanical — change the value to `"tpu"` and optionally
add an `acceleratorPreference`.

Optional `requirements.acceleratorPreference` is an ordered, unique list of one
to three backends from the same enum. It is routing intent that the OmniTensor
service consumes; the applet does not enforce it. When omitted, the global
default `["tpu", "npu", "gpu"]` applies. Built-in manifests must lead with
their designed-for backend as the first preference entry; a repository lint
enforces this.

`requirements.minimumDevices` counts devices of the backend actually selected
for the workload, not total accelerators. It is validate-only: the contract
checker enforces its shape, and the service — not the applet — decides what to
do when the count is unmet.

### Model requirements

`model.format` is one of `tflite-edgetpu`, `tflite`, `onnx`, or `openvino`,
with a `fullyQuantized` boolean. A tpu-designed workload must keep `model`
null or declare `tflite-edgetpu` with `fullyQuantized: true`, because the Edge
TPU only executes fully quantized, edgetpu-compiled TensorFlow Lite models.

Use `model: null` when catalog identity does not select one concrete artifact.
When a model is named, update its ID and version independently from workload
identity. `fullyQuantized: true` and `tflite-edgetpu` describe contract
requirements; they do not replace compiler-report or hardware validation.

Keep host work explicit. Decode, validation, resizing, normalization,
quantization, capture, post-processing, policy, persistence, display, and result
routing do not become accelerator work merely because a model is accelerated,
regardless of whether the workload routes to a TPU, NPU, or GPU backend.

## Check and test

```bash
npm run check:workloads
node --test tests/contract/workload-plugin-contract.test.js
```

The checker validates every manifest, directory/manifest identity parity,
unique workload IDs, and unique display order. Contract fixture tests prove the
template remains loadable by the same descriptor and registry ports used by the
applet.

Before enabling a workload, add unit and integration coverage, boundary fuzzing,
mutation coverage for changed logic, and reproducible acceptance measurements
on named hardware. Record model/compiler/runtime versions, input shape, warm-up,
sample count, host preprocessing, and baseline implementation with results.

## Compatibility

Increment `manifestVersion` only for an incompatible manifest shape. Increment
workload `version` when workload behavior or metadata changes. A compatible
model replacement changes `requirements.model` without changing workload `id`.
Keep runtime API 1 until both service and applet support a newer command and
snapshot contract.

Installation is deterministic: one directory is one workload. Removing a
directory removes it from the active registry; stale persisted keys and runtime
entries are ignored during reconciliation. Reinstalling the same ID restores
schema defaults unless retained compatible preferences are still present.

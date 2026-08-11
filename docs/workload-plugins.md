# Workload plug-in authoring

[Documentation index](../README.md) · [Applet runtime boundary](applet.md#runtime-boundary)

Workload plug-ins are declarative directories containing one `manifest.json`.
Copy [`../templates/workload-plugin/manifest.json`](../templates/workload-plugin/manifest.json)
to `files/cinnamon-xpuwlm@geraldo-netto/workloads/<id>/manifest.json`, then replace
every placeholder. Directory name and manifest `id` must match.

## Installation locations

The applet merges two plug-in directories at startup and on every applet
reload:

- **Bundled**: `<applet>/workloads/<id>/manifest.json`, shipped with the
  applet. A defective bundled manifest fails loudly — the repository gates
  (`npm run check:workloads`) keep this impossible in a release.
- **User-installed**: `$XDG_DATA_HOME/cinnamon-xpuwlm@geraldo-netto/workloads/<id>/manifest.json`
  (normally `~/.local/share/cinnamon-xpuwlm@geraldo-netto/workloads/`). Install a
  plug-in by creating its directory; uninstall by deleting it. One invalid
  user manifest is skipped with a logged warning, and an unreadable user
  directory yields an empty user catalog — neither can take down the applet
  or the bundled workloads.

Identity collisions resolve **bundled-wins**: a user plug-in that reuses a
bundled `id` is ignored and logged, so third-party directories can never
shadow or replace a built-in workload. Reconciliation treats user plug-ins
exactly like bundled ones: a new directory installs with schema defaults, a
changed `version` reports an upgrade, and a removed directory drops its
persisted profile state on the next reconciliation.

## Change reporting

Reconciliation runs at startup and on every applet reload. When it finds
installed, upgraded, or removed plug-ins, the popup shows a notice above the
metrics naming each one — installed and upgraded workloads by their title,
removed ones by the identifier that is all the catalog has left. The notice
stays until it is dismissed, and does not return: reconciliation has already
persisted the new versions, so the next start has nothing left to report.

A first run is deliberately silent. Every workload would be reported as newly
installed, which would bury the plug-in changes the notice exists to show.

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

`model.format` is one of `tflite-edgetpu`, `tflite`, `onnx`, `openvino`, or `ncnn`,
with a `fullyQuantized` boolean. A tpu-designed workload must keep `model`
null or declare `tflite-edgetpu` with `fullyQuantized: true`, because the Edge
TPU only executes fully quantized, edgetpu-compiled TensorFlow Lite models.

Optional `model.sha256` is the lower-case hexadecimal digest of the exact
artifact the profile may run. It is optional for compatibility with manifests
written before the runtime verified the digest; when it is absent the runtime
can only trust the digest recorded when the artifact was installed.

Use `model: null` when catalog identity does not select one concrete artifact.
When a model is named, update its ID and version independently from workload
identity. `fullyQuantized: true` and `tflite-edgetpu` describe contract
requirements; they do not replace compiler-report or hardware validation.

Keep host work explicit. Decode, validation, resizing, normalization,
quantization, capture, post-processing, policy, persistence, display, and result
routing do not become accelerator work merely because a model is accelerated,
regardless of whether the workload routes to a TPU, NPU, or GPU backend.

## Trust boundary

Plug-ins are declarative data, never code: the applet parses `manifest.json`
with a strict version 1 validator and executes nothing from a plug-in
directory. Discovery validates everything it touches:

- directory names must match the workload identifier grammar before any path
  is built from them, and discovery is bounded to the registry maximum;
- manifest reads never follow symlinks, only accept regular files (a fifo or
  device node fails loudly instead of blocking the desktop), re-verify the
  opened file's identity, and bound the bytes actually read to 64 KiB rather
  than trusting the declared size;
- a manifest whose `id` differs from its directory name is rejected, and
  duplicate identifiers fail registration.

Model execution, device authorization, and every privileged action stay behind
the runtime service contract (see [runtime-control.md](runtime-control.md));
the applet only publishes intent and renders published state.

## Check and test

```bash
npm run check:workloads
node --test tests/contract/workload-plugin-contract.test.js
```

The checker validates every manifest, directory/manifest identity parity,
unique workload IDs, and unique display order. Contract fixture tests prove the
template remains loadable by the same descriptor and registry ports used by the
applet.

## Third-party tooling

`npm run check:workloads` only ever sees the bundled catalog, so a plug-in
maintained outside this repository has no gate at all. Two commands give an
out-of-tree directory the same verdict the applet reaches at discovery time:

```bash
npm run check:plugin -- /path/to/my-plugin
npm run package:plugin -- /path/to/my-plugin
```

`check:plugin` reports every reason the directory would not load: a missing,
oversized, unparsable, or non-conforming `manifest.json`; a directory name that
is not a valid identifier or disagrees with the manifest `id`; a symlink or any
file other than `manifest.json`, which the applet ignores rather than installs;
an identifier already used by a bundled workload, which bundled-wins merging
would silently drop; and a `ui.order` already taken by a bundled workload.
Unlike the repository checker it does not require `acceleratorPreference`,
which is optional for third-party manifests.

`package:plugin` validates first, then writes a deterministic ustar archive and
its SHA-256 to `dist/plugins/<id>-<version>.tar`. Members are prefixed with the
workload id, so extracting the archive in
`$XDG_DATA_HOME/cinnamon-xpuwlm@geraldo-netto/workloads/` produces exactly the
directory discovery expects.

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

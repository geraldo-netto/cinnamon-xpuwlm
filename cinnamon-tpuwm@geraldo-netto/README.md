# TPU Workload Manager Cinnamon applet

`cinnamon-tpuwm@geraldo-netto` is the production applet corresponding to the approved visual prototype in `../tpu-workloads@local/`.

The applet owns panel presentation, persisted local profile intent, contention
weights, pause/resume intent, local device discovery, and alert/recovery UX. A
separate workload runtime must consume and enforce that policy; the applet does
not claim job enforcement from hardware discovery alone. It does not make model
scores authoritative or bypass deterministic device authorization, backup,
shutdown, firmware, or access-control policy.

## Panel status

The panel defaults to a compact icon without a text label; the label remains an
opt-in setting. Cinnamon recolors each symbolic status icon from the active
theme. Online, detected, attention, paused, and unavailable states also use
different center shapes, and the tooltip plus accessible name state the status
in text, so meaning never depends on color alone.

[Review the actual-size 16/20/24-pixel light and dark status montage](../tpu-workloads@local/mockup/tpuwm-panel-status-montage.png).

## Runtime boundary

A trusted local workload service may atomically publish
`~/.local/state/tpu-workload-manager/state.json`. The accepted version 1
contract is defined by `runtime-snapshot.schema.json`. The applet validates the
complete document before normalizing or displaying any runtime field; it never
executes its content.

If no snapshot exists, the applet probes for Coral USB runtime
(`18d1:9302`), Coral USB DFU (`1a6e:089a`), and PCIe (`/dev/apex_*`)
devices and reports device-only state. USB authorization uses those exact
vendor/product pairs; mixed pairs are rejected. Missing or empty snapshot
content enables this trusted local probe. A present snapshot that is malformed,
stale, oversized, unsupported, missing a required field, contains an unknown
field, or violates a type or bound fails closed into an explicit
unavailable/recovery state and never falls back to a device-only probe.

## Local quality gates

```bash
npm ci
npm test
```

`npm test` runs ESLint, artifact validation, unit/integration/regression tests,
per-function coverage checks, deterministic fuzz and real 16/20/24-pixel icon
rendering tests, and Stryker mutation tests.

## Module loading

Cinnamon resolves `require()` calls from the applet root, including calls made
inside nested modules. Thin root bridge modules preserve that platform behavior
while domain and adapter implementations stay under `lib/` for Node-based
quality gates.

## Install

Install the directory at:

```text
~/.local/share/cinnamon/applets/cinnamon-tpuwm@geraldo-netto
```

Then add **TPU Workload Manager** from Cinnamon Settings → Applets. Reload an installed copy with Cinnamon's `ReloadXlet` D-Bus method after changes.

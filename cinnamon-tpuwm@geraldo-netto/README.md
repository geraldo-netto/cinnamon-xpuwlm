# TPU Workload Manager Cinnamon applet

`cinnamon-tpuwm@geraldo-netto` is the production applet corresponding to the approved visual prototype in `../tpu-workloads@local/`.

The applet owns panel presentation, profile enablement, contention weights, pause/resume state, local device discovery, and alert/recovery UX. It does not make model scores authoritative and does not bypass deterministic device authorization, backup, shutdown, firmware, or access-control policy.

## Runtime boundary

A trusted local workload service may atomically publish `~/.local/state/tpu-workload-manager/state.json`. The accepted version 1 contract is defined by `runtime-snapshot.schema.json`. The applet only reads and validates this file; it never executes its content.

If no snapshot exists, the applet probes for Coral USB (`18d1:9302`) and PCIe (`/dev/apex_*`) devices and reports device-only state. Missing, malformed, stale, oversized, or unsupported snapshots fail closed into an explicit unavailable/recovery state.

## Local quality gates

```bash
npm ci
npm test
```

`npm test` runs ESLint, artifact validation, unit/integration/regression tests, per-function coverage checks, deterministic fuzz tests, and Stryker mutation tests.

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

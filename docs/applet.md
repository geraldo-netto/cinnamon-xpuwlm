# TPU Workload Manager Cinnamon applet

`cinnamon-tpuwm@geraldo-netto` is the production applet corresponding to the approved visual prototype in [`../design/prototype/`](../design/prototype/DESIGN.md). Its deployable source is kept under [`../files/cinnamon-tpuwm@geraldo-netto/`](../files/cinnamon-tpuwm@geraldo-netto/).

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

[Review the actual-size 16/20/24-pixel light and dark status montage](../design/prototype/mockup/tpuwm-panel-status-montage.png).

## Responsive popup

St stylesheets have no media queries, so the popup resolves its own breakpoints
in `lib/layout.js` from the monitor work area, the display scale factor, and the
text scale factor. The result is pure data — width, scroll height, metric
columns, evidence columns, and a wrap flag — applied imperatively by the menu
view and re-measured every time the popup opens.

| Mode | Content width | Layout |
| --- | --- | --- |
| Wide | above 520 px | Four metric tiles in one row, single-line rows |
| Compact | 401–520 px | Two metric columns, wrapped descriptive text, 44 px targets |
| Dense | 400 px and below | Compact rules plus single-column alert evidence |

The popup never claims more width than the work area offers, its scroll region
is bounded to the work-area height so the footer actions stay visible, and
navigation, pause/resume, recovery, and manager actions remain present in every
mode. An unusable measurement falls back to the default desktop layout.

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

Displayed runtime state expires on its own freshness deadline rather than at the
next poll. A connected snapshot reads as fresh for at most 15 seconds after its
`generatedAt`; the applet arms a single-shot timer for that deadline, so a long
refresh interval can no longer present expired state as online.

## Local quality gates

```bash
# Run from the repository root.
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

Install the contents of `files/cinnamon-tpuwm@geraldo-netto/` at:

```text
~/.local/share/cinnamon/applets/cinnamon-tpuwm@geraldo-netto
```

Then add **TPU Workload Manager** from Cinnamon Settings → Applets. Reload an installed copy with Cinnamon's `ReloadXlet` D-Bus method after changes.

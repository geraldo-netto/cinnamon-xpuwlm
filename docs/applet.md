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

When alerts need review, the highest active severity is stated as text in the
panel label, tooltip, and accessible name, in the attention metric tile, and in
the alerts section heading. Resolved alerts and unknown severities never raise
it. The alert card border colour is a second cue, never the only one.

## Lifecycle

Construction is transactional: if any step fails, the applet tears down whatever
it already created — settings bindings, timers, subscriptions, the manager, the
notifier, and the popup — and rethrows, so a half-built applet never stays in
the panel. The icon search path is appended only when absent, so a retry does
not duplicate it.

Teardown attempts every cleanup step even after an earlier step throws, reports
each failure through the logger, and remains idempotent afterwards.

## Critical notifications

Each unresolved critical alert raises exactly one desktop notification per
occurrence. An alert that stays active is never repeated, and an alert that
resolves or disappears is forgotten, so the same identity notifies again if it
reappears. A notification that cannot be shown is reported once and retried on
the next observation rather than dropped.

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

## Accessible semantics

Controls expose their ATK role and state, not only an accessible name: the tab
strip is a page tab list, each tab is a page tab that carries the selected
state, profile switches are toggle buttons that carry the checked state, and an
unavailable weight control drops its sensitive state. Names still spell the
state out in text, so nothing depends on role support alone, and a Cinnamon
build that does not expose a role or state simply renders without it.

A workload whose manifest declares no model cannot be executed by the runtime,
which refuses to build a pipeline for it. The popup states that on the profile
row and in the profile switch's accessible name, and counts the affected
profiles in the section heading, rather than presenting the same controls for a
profile that can never run. The controls stay live: enabling such a profile is
still a policy statement, and installing the missing model must not require
first recovering a control the applet took away.

The tab strip uses roving focus: only the selected tab is reachable with Tab,
Left/Up and Right/Down move to the neighbouring tab and wrap, and Home and End
jump to the first and last tab. Every movement selects and focuses together, and
any other key propagates so Cinnamon keeps its own shortcuts.

Popup bodies are rebuilt whenever their content changes. Every body control
carries a stable semantic identity (`toggle:<profile>`, `weight-up:<profile>`,
`retry-detection`, and so on), so keyboard focus returns to the same control
across a rebuild. When that control no longer exists the first control in the
rebuilt body takes focus, and when the body has no control the selected tab
does. Focus on a control outside the body is never disturbed.

## Runtime boundary

A trusted local workload service — in practice the OmniTensor runtime — may
atomically publish
`~/.local/state/tpu-workload-manager/state.json`. The accepted version 1
contract is defined by `runtime-snapshot.schema.json`; the canonical schemas
live in the OmniTensor repository and the applet ships mirror copies. The
applet validates the complete document before normalizing or displaying any
runtime field; it never executes its content.

A version 1 snapshot carries a `devices` array of 1–16 accelerator entries
rather than a single `device` object. Each entry requires `id`, `backend`
(`tpu`, `npu`, or `gpu`), `available`, `name`, and `kind` (`usb`, `pcie`,
`accel`, `dri`, or `unknown`), with optional `vendor`, per-device `load`
(0–100 or null), and `reason`. The snapshot `metrics` object carries only
`queueDepth` and `runningProfiles`; load is reported per device. The applet
aggregates `devices` to a primary device — the first available device in
tpu > npu > gpu hierarchy order — which drives the panel label (for example
"GPU 55%", "TPU Detected", "Accel Offline", "Accel Unknown", "Accel Paused"),
while the menu overview's "Accelerators" group lists every device with its
availability and per-device load. There is deliberately no CPU backend: the CPU
is the host's scarcest shared resource, inference never falls back onto it, and
all-accelerators-absent shows the unavailable/recovery screen with generalized
copy such as "Accelerator discovery failed" and "No accelerator available".

If no snapshot exists, the applet probes for accelerator device nodes and
reports device-only state. Coral TPU probing is unchanged: PCIe
`/dev/apex_0`–`/dev/apex_7`, then USB runtime (`18d1:9302`) and USB DFU
(`1a6e:089a`) devices. USB authorization uses those exact vendor/product pairs;
mixed pairs are rejected. NPU probing covers the kernel accel subsystem,
`/dev/accel/accel0`–`/dev/accel/accel7`, with a best-effort vendor read from
`/sys/class/accel/accelN/device/vendor` (`0x8086` Intel NPU, `0x1002`/`0x1022`
AMD NPU, otherwise a generic "NPU accelerator"). GPU probing covers DRM render
nodes `/dev/dri/renderD128`–`/dev/dri/renderD135`, with vendor from
`/sys/class/drm/renderDN/device/vendor` (`0x10de` NVIDIA, `0x1002` AMD,
`0x8086` Intel, otherwise generic). An unreadable vendor file never fails
detection. Only found devices are reported; absence is expressed by omission.
Probing reports the presence of device nodes only — it does not verify that a
driver is usable or that a runtime can be installed. Missing or empty snapshot
content enables this trusted local probe. A present snapshot that is malformed,
stale, oversized, unsupported, missing a required field, contains an unknown
field, or violates a type or bound fails closed into an explicit
unavailable/recovery state and never falls back to a device-only probe.

The snapshot is only ever read as a regular file the applet has verified. A
no-follow preflight rejects a symlink, directory, or special file outright, and
the identity (device and inode) of the opened stream must match the identity the
preflight saw, so a path object swapped in between is refused rather than read.
The declared size and the delivered bytes are both bounded, so a file that grows
after the preflight is refused too.

Snapshot reads are asynchronous, size-bounded, sequenced, and cancellable. The
applet never blocks the Cinnamon main loop on the file system: it asks GIO to
load at most one byte past the accepted maximum, keeps a single read in flight,
discards any completion that arrives after a newer refresh, and cancels the
pending read when the runtime path changes or the applet is removed.

Device presence and runtime availability are modelled as independent facts.
Every snapshot carries `health` with a device state (`present`, `absent`,
`unknown`) and a runtime state (`connected`, `not-started`, `absent`, `stale`,
`malformed`, `unreadable`, `probe-failed`).

| Runtime state | Meaning |
| --- | --- |
| `connected` | A valid, fresh snapshot is being read |
| `not-started` | Monitoring has not read anything yet |
| `absent` | No runtime publishes a snapshot; device-only monitoring |
| `stale` | The last snapshot passed its freshness deadline |
| `malformed` | The document was read but failed contract validation |
| `unreadable` | The document could not be read at all |
| `probe-failed` | Local device discovery could not complete |

A runtime problem never reports the device as absent: an unreadable, malformed,
stale, or not-yet-started runtime leaves device health `unknown`, and load,
queue depth, and running-profile counts read as `—` rather than as zero. Each
runtime state renders its own recovery guidance and its own numbered steps.

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

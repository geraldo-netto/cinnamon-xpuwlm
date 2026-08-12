# XPU Workload Manager Cinnamon applet

`cinnamon-xpuwlm@geraldo-netto` is the deployable early-preview applet
corresponding to the approved visual prototype in
[`../design/prototype/`](../design/prototype/DESIGN.md). Its source is kept
under [`../files/cinnamon-xpuwlm@geraldo-netto/`](../files/cinnamon-xpuwlm@geraldo-netto/).

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

The applet enforces a 32×32-pixel minimum panel icon and retains any larger
panel-zone size. This keeps the compact status glyph legible in a tall panel
even when Cinnamon's zone preference still requests 16 pixels.

[Review the compact light and dark status montage](../design/prototype/mockup/xpuwlm-panel-status-montage.png).

When alerts need review, the highest active severity is stated as text in the
panel label, tooltip, and accessible name, and each Activity/Diagnostics alert
card names its severity. Resolved alerts and unknown severities never raise it.
The alert card border colour is a second cue, never the only one.

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
text scale factor. The result is pure data — width, scroll height, evidence
columns, and a wrap flag — applied imperatively by the menu
view and re-measured every time the popup opens.

| Mode | Content width | Layout |
| --- | --- | --- |
| Wide | above 520 px | Mockup-aligned cards, single-line rows, and horizontal controls |
| Compact | 401–520 px | Wrapped descriptive text and 44 px targets |
| Dense | 400 px and below | Compact rules plus single-column alert evidence |

The popup never claims more width than the work area offers. Every tab uses the
same fixed-height scroll viewport, sized for the largest tab and bounded to the
work-area height, so switching tabs never expands or contracts the popup.
Overflow remains vertically scrollable, footer actions stay inside the stable
viewport, and navigation, recovery, and contextual actions remain present in
every mode. An unusable measurement falls back to the default desktop layout.

Every popup button crosses one shared main-loop boundary before its action is
run. This lets Cinnamon finish the `clicked` signal before an action publishes
state and rebuilds the actor tree containing that button. Repeated activation
before the next turn is collapsed, and teardown cancels queued actions.
Interactive applet-state writes are also serialized and coalesced through GIO's
asynchronous replace API. Runtime input roots are enumerated asynchronously in
bounded batches and cancelled when superseded or when the applet is removed, so
a slow local, FUSE, or network-backed path does not block the compositor.

The wide mode implements the approved v4 task-first mockups with a 560 px
content width, 760 px maximum scroll region, framed non-Tools surfaces, aligned
icon/copy/status columns, semantic status cues, a vertical Diagnostics state
table, and right-aligned action groups. Compact and dense modes retain those
relationships while wrapping text and expanding acquisition targets.

## System profiles and Diagnostics setup

The runtime refuses to serve a profile for three genuinely different reasons,
and the user's next action differs in each:

| `profiles[].reason` | Class | Remedy |
| --- | --- | --- |
| `no-model` on `resource-scheduler` | local forecast recipe available | Record real bounded queue history, train the supported forecast, install its restricted binding, restart the service, then run the trusted forecast client |
| `no-model` on another profile | no qualified model or recipe | None. Define and qualify the task-specific data, semantics, model, consumer, and acceptance evidence in OmniTensor; arbitrary weights are not a remedy |
| `artifact-unavailable`, `format-unsupported` | declared model installation is unusable | Reinstall the exact declared artifact and companions; keep its model and tensor contracts unchanged |
| `runtime-missing`, `runtime-unusable` | needs an accelerator runtime | Install the matching Python extra, for example `pip install 'omnitensor[gpu]'` |
| `device-absent`, `no-executor`, `no-preference` | needs hardware | None. The profile stays unavailable until supported hardware is attached |
| `serving`, `paused-by-policy`, `profile-disabled` | not blocked | Nothing to install; the profile runs, or the user's own policy stopped it |

`lib/profile-blockers.js` classifies from `profiles[].reason`, the
machine-readable code the service publishes beside the sentence. It used to
classify from the sentence in `profiles[].detail`, which made the exact wording
a contract: rewording or localising a service message demoted every affected
profile to "unrecognised" and named no remedy at all, with nothing on either
side able to catch it. The sentence is still shown, because it names *which*
device or package, which the code deliberately does not; it is also still the
classifier's fallback for a snapshot that carries no code, such as one written
by a service older than this contract.

Neither is read from the manifest shipped here: the service owns the catalog
that decides what executes, so a manifest in this tree can be older than the
one it loaded. The bundled `requirements.model` flag answers only where the
snapshot cannot — no runtime has published anything for the profile, or the
only thing it published is the user's own policy decision, which is reported
before the service looks at a backend and therefore says nothing about whether
the profile could run if it were enabled. A code this build does not recognise
leaves the profile `unknown` with its sentence repeated verbatim, rather than
relabelled or dropped.
`tests/contract/profile-blocker-reason-contract.test.js` pins the codes, the
fallback phrases, and the mirrored schema against the service sources wherever
both checkouts are present.

The System tab shows current device/runtime status and progressively discloses
Advanced workload profiles. That detail lists runnable profiles first and
collapses everything else into a single `Needs setup (n)` group at the bottom.
Every count is derived from the live snapshot, so the group shrinks as models
and runtimes are installed. Its rows keep enable and weight controls, but
controls that the runtime cannot apply are insensitive and name the reason in
text, accessible names, and tooltips.

Diagnostics always shows device, runtime, workload-service, current-state, and
recent-issue information. Its Needs setup row opens remedy detail organised by
remedy rather than profile, because one package or artifact can unblock several
profiles. Commands remain selectable labels. When nothing is missing the detail
says so and states how many profiles run instead of rendering empty.

Resource Scheduler is the one bundled null-model profile with a supported
local recipe. Its Setup section starts with bounded, opt-in snapshot recording:

```sh
omnitensor-record-runtime-snapshot \
  --profile resource-scheduler \
  --selector queueDepth \
  --selector runningProfiles

omnitensor-train-model \
  --profile resource-scheduler \
  --id <id> \
  --version <v> \
  --features queueDepth,runningProfiles \
  --target queueDepth \
  --window <n> \
  --horizon <n>

omnitensor-install-trained-model \
  ~/.local/share/omnitensor/training/resource-scheduler/<v>/training-report.json \
  --targets auto
systemctl --user restart omnitensor.service
omnitensor-run-forecast --profile resource-scheduler
```

Recording needs enough representative real history for the trainer's holdout
gate; these lines are a workflow, not an immediate script to run after one
sample. No recorder timer is installed or enabled automatically. The popup
does not submit a forecast itself because only OmniTensor's trusted client owns
the recorded-history and binding checks.

The six other null-model profiles do not gain a model by copying this scalar
forecast. Their distinct corpus, privacy, task metrics, preprocessing,
post-processing, result-consumer, signing, and acceptance work remains tracked
in OmniTensor. Setup intentionally offers no generic artifact command for them.

An installed and live-qualified external `event-extraction` worker enables the
Extract calendar events tool. It is not inferred from the bundled
catalog: the applet checks `DescribePlugins` on startup and whenever the popup
opens, then requires a ready executable worker, granted declared permissions,
and ready declared artifacts. File choice is explicit, folder choice is
non-recursive, candidate evidence and editable fields remain local to the
popup, and export requires human Keep/Reject decisions plus a separate
confirmation. See [Private event import](event-import.md) for dependencies,
formats, accelerator policy, privacy, and write guarantees.

An installed and live-qualified external `ask-selected-files` worker enables
Ask documents. It accepts one explicit bounded file
selection and one explicit question, keeps no question history, and displays
only a grounded answer with mandatory file/page/span citations. See
[Ask selected files](document-questions.md).

An installed and live-qualified external `selected-text-tools` worker enables
Work with selected text. Choosing Explain, Summarize, Rewrite,
Translate, or Extract tasks is the explicit action that reads the clipboard
once. The selection is submitted in that request and never copied into applet
state or history. Results are review-only: the applet has no paste, apply,
task-creation, or clipboard-monitor action. See
[Selected-text tools](selected-text-tools.md).

An installed and live-qualified external `file-organizer` worker enables
Organize files. It accepts only files chosen for that request and shows
evidence-backed tags, names, relative folders, and exact duplicate groups as a
review-only plan. The applet has no apply, move, rename, overwrite, delete, or
command action. See [File organizer](file-organizer.md).

## Accessible semantics

Controls expose their ATK role and state, not only an accessible name: the tab
strip is a page tab list, each tab is a page tab that carries the selected
state, profile switches are toggle buttons that carry the checked state, and an
unavailable weight control drops its sensitive state. Names still spell the
state out in text, so nothing depends on role support alone, and a Cinnamon
build that does not expose a role or state simply renders without it.

The collapsed group of profiles that cannot run is a toggle button carrying the
expanded state, and it says "collapsed" or "expanded" in its accessible name as
well, so the arrow glyph is never the only cue.

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

A trusted compatible local workload service may atomically publish
`~/.local/state/xpu-workload-manager/state.json`. The accepted version 1
contract is defined by `runtime-snapshot.schema.json`; the canonical schemas
are currently maintained with the OmniTensor reference runtime and the applet
ships mirror copies. The applet validates the complete document before
normalizing or displaying any runtime field; it never executes its content.

### Where the snapshot path is configured

The snapshot is the observation channel for device, profile, queue, and alert
state. The two sides also communicate over the versioned user-session D-Bus
contract for handshake, controls, job submission, cancellation, and results;
those calls never replace snapshot publication. Each side names the snapshot
path independently, so a move has to be made twice:

| Side | What names the path | Default |
| --- | --- | --- |
| Applet | The `runtime-state-path` setting, shown as "Runtime snapshot file" in the applet settings | `~/.local/state/xpu-workload-manager/state.json` |
| Compatible runtime | Provider configuration; the OmniTensor reference uses `OMNITENSOR_STATE_PATH` | the same path for the reference runtime when the variable is unset |

Both sides expand a leading `~` to the invoking user's home directory, and both
read and write as the session user, so the snapshot stays inside the user's own
state directory by default.

For the OmniTensor reference runtime, move it by setting
`OMNITENSOR_STATE_PATH` where the service is started — for a systemd user unit,
`systemctl --user edit`, an
`Environment=OMNITENSOR_STATE_PATH=/new/path/state.json` line, and
`systemctl --user restart`, so the change survives the next start — and set the
same path in the applet setting. Changing only one side leaves the applet
reading a file nobody writes: it reports "No runtime service is publishing
state" and drops to device-only probing, which is indistinguishable from a
service that is not running at all, so check both names before concluding the
service is down.

A version 1 snapshot carries a `devices` array of 1–16 accelerator entries
rather than a single `device` object. Each entry requires `id`, `backend`
(`tpu`, `npu`, or `gpu`), `available`, `name`, and `kind` (`usb`, `pcie`,
`accel`, `dri`, or `unknown`), with optional `vendor`, per-device `load`
(0–100 or null), and `reason`. The snapshot `metrics` object carries only
`queueDepth` and `runningProfiles`; load is reported per device. The applet
aggregates `devices` to a primary device — the first available device in
tpu > npu > gpu hierarchy order — which drives the panel label (for example
"GPU 55%", "TPU Detected", "Accel Offline", "Accel Unknown", "Accel Paused"),
while the System and Diagnostics tabs report the current device/runtime state.
The applet contract deliberately exposes no
CPU scheduling backend; the OmniTensor reference additionally refuses CPU-only
inference providers. Host-side capture, decoding, validation, preprocessing,
transport, and result handling can still use the CPU. An absent declared
accelerator lane produces an explicit setup or recovery state rather than a
silent inference fallback.

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

### Migrating from the TPU-named applet

The UUID changed from `cinnamon-tpuwm@geraldo-netto` to
`cinnamon-xpuwlm@geraldo-netto`, so Cinnamon correctly treats this as a new
applet identity. Remove the old panel instance in Cinnamon Settings before
adding the new one; do not leave both identities active against the same
runtime.

On first start, the new applet performs one bounded import from the old
Cinnamon settings file. It copies only the panel-label choice, refresh interval,
and runtime snapshot path, and it never overwrites a value already changed
under the new UUID. The old default snapshot path is translated to
`~/.local/state/xpu-workload-manager/state.json`; a genuinely custom path is
preserved. Profile intent and the selected tab fall back read-only to
`~/.config/tpu-workload-manager/applet-state.json` until the new applet writes
`~/.config/xpu-workload-manager/applet-state.json`.

Upgrade OmniTensor and this applet together. Their mirrored schemas now use the
XPU identity, so the contract handshake deliberately refuses a mixed old/new
pair instead of pretending incompatible schema digests agree. After the new
applet is working, the old applet directory and legacy state/settings files may
be archived or removed.

Install the contents of `files/cinnamon-xpuwlm@geraldo-netto/` at:

```text
~/.local/share/cinnamon/applets/cinnamon-xpuwlm@geraldo-netto
```

Then add **XPU Workload Manager** from Cinnamon Settings → Applets. Reload an
installed copy with the exact command below:

```bash
gdbus call --session \
  --dest org.Cinnamon \
  --object-path /org/Cinnamon \
  --method org.Cinnamon.ReloadXlet \
  'cinnamon-xpuwlm@geraldo-netto' 'APPLET'
```

`APPLET` is case-sensitive. Do not substitute `applet`, a numeric value, or an
empty argument: Cinnamon unloads the current xlet before resolving that type,
so an invalid value can leave the applet absent instead of reloaded. Repeating
the command with `APPLET` restores it.

## File chooser interaction

All event import, calendar export, document-question, and file-organizer
choices use the familiar GTK file-selection UI through a short-lived `zenity`
helper process. Choosing an action first closes the applet popup and releases
its input grab; the helper is started on the next main-loop turn and owns its
native window, GTK state, and teardown outside Cinnamon. A chooser fault can
therefore fail one workflow with visible feedback but cannot corrupt or crash
the desktop shell. The popup reopens after the helper exits so keyboard and
pointer users see the same selected, cancelled, or failed state. Applet removal
or reload cancels and terminates every outstanding helper and suppresses late
responses.

Cancellation is explicit and non-destructive: the relevant surface reports
that selection or export was cancelled and remains usable. Accepted selections
show the chosen source names; I/O and validation failures show an error; a
successful export reports the new path. No chooser scans, writes, or submits
anything until its labeled confirmation action is used.

`zenity` is a runtime dependency. Missing helper discovery fails closed: file
tools report chooser unavailability and never fall back to an in-process GTK
dialog.

See the [case-specific full Laws of UX audit](chooser-ux-audit.md) for the
design-to-verification matrix covering all chooser workflows.

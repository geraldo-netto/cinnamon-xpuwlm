# XPU Workload Manager Cinnamon helper

`cinnamon-xpuwlm@geraldo-netto` is the Cinnamon half of the XPU Workload
Manager: a panel presence and a way into the client. Its source is kept under
[`../files/cinnamon-xpuwlm@geraldo-netto/`](../files/cinnamon-xpuwlm@geraldo-netto/).

It used to be the whole product — workload screens, workflow forms, policy
controls, and a hand-written mirror of every runtime contract, all in GJS. All
of that now lives in the Python client (`../../xpuwlm`), which owns its own
window, its own GTK, and its own validation against the canonical schemas. What
a panel is genuinely good at is what is left here.

## What it does

- **Panel presence.** A symbolic status icon, a tooltip, and an accessible
  name, from the runtime's own published snapshot. No text beside the icon: the
  five status shapes and the desktop's own symbolic colours carry the status,
  and a word repeating them costs pixels in the most contested strip on the
  screen. The words are in the tooltip and the popup, where they are read
  deliberately rather than glanced past.
- **A five-line popup.** Runtime state, which accelerator is serving, queued,
  running, and how much needs review. Read-only: anything a person can act on
  belongs in the client.
- **One action.** "Open XPU Workload Manager" starts the client and closes the
  menu.

## What it deliberately does not do

- **It never talks to the runtime's control socket.** Drawing an icon must not
  cost a round trip, so the panel reads the published snapshot file and nothing
  else. Commands, jobs and policy are the client's.
- **It ships no schema copies.** The client validates the runtime's documents
  against the canonical schemas with a real schema engine. A mirror here would
  be a second reader to keep in parity — the drift that made the applet reject
  every snapshot the runtime published, once.
- **It reads five fields.** Whatever the snapshot carries beyond what the panel
  draws is not read, not validated, and not modelled.
- **It is not a load meter.** The panel used to show the accelerator's
  instantaneous busy percentage, which answers "was it busy the moment I
  looked" rather than "is it busy". The client's Health page keeps a minute of
  samples per device and shows the ninetieth percentile; a second, worse copy
  of that in the tray is not worth the pixels or the poll.

## Panel status

The panel is a compact icon and nothing else. Cinnamon recolours each symbolic
status icon from the active theme, and the stylesheet maps the five statuses onto the desktop's own
symbolic success, warning, and error colours. Online, detected, attention,
paused, and unavailable also use different centre shapes, and the tooltip and
accessible name state the status in text, so meaning never depends on colour
alone.

A status the helper does not recognise draws as unavailable rather than asking
Cinnamon for an icon file the payload does not ship.

## Reading the runtime

The snapshot is read on a timer — two seconds by default, bounded to between
one and sixty — from the path in settings. Each outcome is a state the panel
draws rather than an error it swallows:

| State | What it means |
| --- | --- |
| `connected` | The runtime published recently; the panel shows its figures. |
| `absent` | No snapshot file: the runtime is not running. |
| `stale` | Published more than fifteen seconds ago; the runtime stopped. |
| `malformed` | Not JSON, not an object, or larger than the panel reads. |
| `unreadable` | The file exists but could not be read. |

Absent and zero are different facts throughout: a runtime that published no
figure reads as unknown, never as idle.

### The one file the two sides share

The helper and the runtime service meet at exactly one path, and neither
derives it from the other:

`~/.local/state/xpu-workload-manager/state.json`

Moving it is a two-sided edit. The service side is the `OMNITENSOR_STATE_PATH`
environment variable; the helper side is the `runtime-state-path` setting. Change
one without the other and the panel reports that the runtime is not running,
which is a configuration mistake wearing the costume of an absent service.

## Launching the client

The launcher resolves the client before spawning it — a user install lands in
`~/.local/share/xpuwlm/venv/bin` or `~/.local/bin`, neither of which is reliably
on the session's PATH — and falls back to the bare command so PATH still gets a
chance. Verbs are matched against a plain word pattern and every argument is
shell-quoted, so a filename with a quote in it cannot break out into a second
command.

A launch reports that the client *started*, not that it succeeded: the client
owns its own window and its own errors, and the panel must not sit waiting to
find out. A launch that could not start at all is reported as a notification
naming the likely cause.

## Lifecycle

Construction is transactional: if any step fails, the helper tears down whatever
it already created — the settings binding, the timer, and the popup — and
rethrows, so a half-built applet never stays in the panel holding a timer.

## Quality gates

`npm run test:ci` runs lint, artifact validation, coverage (line, branch,
function, and statement thresholds plus a per-function gate), fuzz, and the
visual icon gate. Two contract gates keep the tree from growing back:

- **Reachability** — every JavaScript file in the payload must be reachable
  from `applet.js`. A module that is present but unwired is how fourteen unused
  libraries once accumulated here.
- **Root shims** — Cinnamon resolves a nested CommonJS import from the applet
  root, so a module in `lib/` that another `lib/` module imports needs a
  same-name bridge at the root. The inventory is derived from the require graph
  rather than listed, and is exactly one file today.

## Where the rest went

| Looking for | Now in |
| --- | --- |
| Workload screens, workflow forms, policy controls | `../../xpuwlm` (Python client) |
| Snapshot, control, job, and manifest contracts | `../../omnitensor/schemas` |
| Workload manifests and plug-in authoring | `../../omnitensor` (`docs/extension-guide.md`) |
| Ask-selected-files, selected-text, file organizer, event extraction, media transcription | `../../omnitensor/docs` |

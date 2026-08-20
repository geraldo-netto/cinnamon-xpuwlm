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
- **It reads a handful of fields.** Whatever the snapshot carries beyond what
  the panel draws is not read, not validated, and not modelled. The one
  contract number it does check is `version`: the reader is deployed before the
  writer, so a document announcing a version this panel does not know is
  reported as malformed rather than rendered field by field into a picture
  indistinguishable from an idle desk. `unreadable` is a different fact — the
  file is there and the panel could not read it at all.
- **It is not a load meter.** The panel used to show the accelerator's
  instantaneous busy percentage, which answers "was it busy the moment I
  looked" rather than "is it busy". The client's Health page keeps a minute of
  samples per device and shows the ninetieth percentile; a second, worse copy
  of that in the tray is not worth the pixels or the poll.

## Panel status

The panel is a compact icon and nothing else, drawn at 28 pixels minimum —
Cinnamon's zone preference still asks for 16 on a 40-pixel panel, which draws
the glyph visibly smaller than the systray icons beside it, and the glyph is
the whole message now that the panel carries no text.

The status ink is the glyph's own semantic colour rather than the theme's
foreground. GTK's symbolic recolouring rewrites `fill` and leaves `stroke`
alone, so a stroked chip painted in the foreground placeholder stayed that
placeholder — `#2e3436`, a shade off a dark panel — and only the small status
mark was visible. The payload's icon directory is registered with the icon
theme on construction, so Cinnamon can resolve those names at all, and the
stylesheet maps the five statuses onto the desktop's own symbolic success,
warning, and error colours. Online, detected, attention,
paused, and unavailable also use different centre shapes, and the tooltip and
accessible name state the status in text, so meaning never depends on colour
alone.

Paused is the runtime's own state, read from the `policy` block of the
snapshot rather than guessed from an empty queue: the service enforces a hold
with or without a client attached, so a hold that ended when a window closed
would not be a hold. It ranks below attention — something waiting for a person
outranks a hold that person chose — and carries the backlog waiting behind it.

A status the helper does not recognise draws as unavailable rather than asking
Cinnamon for an icon file the payload does not ship.

## Reading the runtime

The snapshot is read on a timer — once a second by default, bounded to between
one and sixty seconds — from the path in settings. Each outcome is a state the
panel draws rather than an error it swallows:

| State | What it means |
| --- | --- |
| `connected` | The runtime published recently; the panel shows its figures. |
| `absent` | No snapshot file: the runtime is not running. |
| `stale` | Published more than fifteen seconds ago; the runtime stopped. |
| `malformed` | Not JSON, not an object, not snapshot version 1, or missing a member the panel's figures come from — `devices`, `metrics`, `alerts`, and the two counts inside `metrics`, all of which the canonical schema requires. The line names the member. A snapshot is read whatever size it has grown to. |
| `unreadable` | The file exists but could not be read. Permission denied and a path that names a directory are said in those words; anything else keeps the platform's own error. |

Absent and zero are different facts throughout: a runtime that published no
figure is refused rather than drawn as an idle desk. A snapshot with no
`metrics`, or with a `queueDepth` the writer renamed or started quoting, used
to read as "online, ready" with nothing queued and nothing to review — the
same picture the version check exists to keep off the panel.

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
  rather than listed, and is empty today: every `lib/` module is imported by
  `applet.js` at the root and none imports another, which is also why the
  settings-window placer is handed its placement rules rather than importing
  them.

## Where the rest went

| Looking for | Now in |
| --- | --- |
| Workload screens, workflow forms, policy controls | `../../xpuwlm` (Python client) |
| Snapshot, control, job, and manifest contracts | `../../omnitensor/schemas` |
| Workload manifests and plug-in authoring | `../../omnitensor` (`docs/extension-guide.md`) |
| Ask-selected-files, selected-text, file organizer, event extraction, media transcription | `../../omnitensor/docs` |

# Private event import

The Profiles screen can turn explicitly selected local documents, calendars,
and images into an evidence-backed event preview. It is a Cinnamon XPU WLM
workload: the applet owns file choice, review, editing, decisions, and export;
the compatible runtime owns parsing, OCR, model generation, grounding, and the
isolated worker.

The feature is hidden until the live `DescribePlugins` inventory reports an
external `event-extraction` worker in `ready` state with the `execute`
capability, every declared permission granted, and every declared artifact
ready. A packaged template alone is never presented as runnable. Worker startup
is also the provider-qualification boundary: a missing, unpinned, CPU-only, or
unqualified provider must not reach `ready`.

## Dependencies

Mandatory client dependencies are Cinnamon's GTK, GIO, and ByteArray APIs, plus
a compatible local runtime implementing the version 1 `DescribePlugins`,
`SubmitJob`, `GetJobResult`, and `CancelJob` methods. The runtime needs an
installed external event-extraction provider distribution, the explicitly
granted `files:read-selected` permission, and a pinned model whose artifacts and
qualification evidence pass that provider's startup checks.

GPU is the default generation lane. NPU is optional and used only after the
administrator explicitly configures and qualifies it; failure before NPU
generation may fall back to the qualified GPU lane. CPU generation is not a
fallback. Parser and OCR dependencies are provider-side optional capabilities:
the provider must refuse unsupported formats honestly rather than fabricate an
event.

## Workflow

1. Open Profiles and choose files, or choose one folder. The folder choice is
   non-recursive and considers at most 32 direct supported files.
2. Review the selected names, then explicitly start extraction.
3. Inspect each proposed event and its source, page, and character-span
   evidence. Edit title, start, end, named timezone, or location as needed.
4. Mark every candidate Keep or Reject. Deterministic duplicate handling keeps
   the first equal title/start/location tuple.
5. Review the final kept set, then confirm export and choose a new `.ics` file.

Each chooser action closes the applet popup before presenting an external
`zenity` GTK dialog, so focus is visible and keyboard navigation stays with the chooser.
Cancel returns to the import surface with an explicit cancellation message;
accepted sources, validation errors, and the final exported path are shown in
that surface. Reloading or removing the applet terminates an outstanding helper
without delivering a late selection or sharing native GTK state with Cinnamon.

Supported source suffixes are `.ics`, `.jpeg`, `.jpg`, `.md`, `.pdf`, `.png`,
`.txt`, and `.webp`. Inputs must be absolute, non-empty regular files no larger
than 128 MiB each. Symlinks, hidden files, recursive discovery, duplicate paths,
and more than 32 sources are refused.

Cancellation reaches the runtime job rather than merely hiding progress. A
late result from a cancelled or superseded request is discarded.

## Privacy and write safety

The applet sends selected paths only after explicit selection. It never scans a
home directory automatically, never puts source bytes or extracted content in
the public runtime snapshot, and retains only local transient selection,
evidence addresses, edits, and decisions.

Export never edits, replaces, deletes, or moves a source. The selected output
must differ from every source, is created as a new private file, and fails if a
file already exists. No calendar is written until every candidate has a human
decision, at least one is kept, every kept event has a named timezone, and the
separate confirmation step is accepted.

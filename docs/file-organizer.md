# File organizer

File organizer is a manual, local workflow. It appears only when the live
plug-in inventory reports a ready external `file-organizer` worker with
`execute`, a granted `files:read-selected` permission, and every declared
artifact ready. A bundled manifest or model metadata alone never makes it
available.

## One explicit selection

Choose between one and sixteen supported non-empty regular files. Cinnamon
passes only those absolute paths for this request; it does not watch folders,
expand a selected parent directory, or retain file content. The file picker
accepts the same bounded text, PDF, and image formats as Ask selected files.

The provider reads bounded private spans and returns one ordered suggestion per
file. Each suggestion may contain:

- zero to sixteen bounded kebab-case tags;
- a safe basename or `null` to keep the current name;
- a safe relative folder or `null` to keep the current folder;
- an exact duplicate-group identifier computed by OmniTensor from full-file
  SHA-256, never guessed by the language model;
- a bounded reason and one to eight exact file/page/span/digest evidence items.

Cinnamon validates the closed version-1 result again before displaying it. It
also requires the ordered file IDs and basenames to match the explicit
selection. Absolute paths and source text do not enter the public plan.

## Review only

The applet shows tags, proposed names and folders, exact duplicate groups,
reasons, and evidence. It exposes no apply, move, rename, overwrite, delete, or
arbitrary-command action. Choosing **Clear** only clears the displayed plan; it
does not touch a selected file. Cancellation and every refusal likewise leave
all files unchanged.

Choosing files first closes the applet popup, then presents a familiar external
`zenity` GTK chooser with visible focus and keyboard navigation. Cancelling reports
**Selection cancelled**; acceptance lists the selected files; validation and
I/O failures appear in the organizer surface. Reloading or removing the applet
terminates an outstanding chooser helper and suppresses its late response.

## Runtime and dependencies

The applet uses `zenity` for isolated file selection and its D-Bus job client;
no GTK chooser is created inside Cinnamon. The external worker needs the base OmniTensor
service, a qualified Qwen generation provider, and optional document ingestion
dependencies for PDF/image inputs. The bundled policy prefers GPU. NPU is
supported only when explicitly configured and qualified. There is no CPU
fallback.

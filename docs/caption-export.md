# Caption export

`caption-export.js` converts a validated audio/video transcription into separate
non-overlapping speech and visual-description tracks. SRT and WebVTT timestamps
and text are rendered deterministically without an intermediate lossy transcode.

Exports include decode-through-write stage measurements and request an atomic,
no-overwrite host action with partial-file cleanup on cancellation. The existing
deterministic action boundary still requires preview, audit, conflict checks, and
a fresh one-use confirmation before writing.

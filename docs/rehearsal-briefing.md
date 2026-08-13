# Rehearsal and meeting briefing

`rehearsal-briefing.js` joins a validated video transcription, an editable deck
review, and explicit slide-change timestamps. Transcript segments, sampled
frames, and per-slide timing retain their original timestamps and slide numbers.

Generated summaries, decisions, questions, task suggestions, and event
suggestions must cite bounded transcript or frame indices. Tasks and events are
returned only with `status: "proposed"` and `reviewOnly: true`; this module has no
task, calendar, file, or UI mutation port.

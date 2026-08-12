# File chooser UX audit

This audit applies the full [Laws of UX catalog](https://lawsofux.com/) to the
event-import, calendar-export, document-question, and file-organizer chooser
flow. It is case-specific: each principle is translated into a concrete design
or engineering constraint instead of being treated as a reason to add more UI.

| Law | Application in this chooser flow |
| --- | --- |
| Aesthetic-Usability Effect | Use the desktop-themed `zenity` GTK chooser; do not introduce a visually foreign custom picker. |
| Choice Overload | Present only the source choices relevant to the current phase: files and, for event import only, one non-recursive folder. |
| Chunking | Keep chooser, selected-source list, progress, review, and actions in distinct groups with headings and boundaries. |
| Cognitive Bias | State privacy and write effects plainly, require evidence review and explicit export confirmation, and never imply that a model result is automatically correct. |
| Cognitive Load | Close the popup before opening the chooser, keep one focus context, use direct action labels, and retain chosen names so users need not remember them. |
| Doherty Threshold | Hand focus to the chooser on the next zero-delay main-loop turn and return rendered feedback immediately after its response; add no artificial wait. |
| Fitts's Law | Keep chooser-workflow targets at least 44px high and rely on the native dialog's conventional large Cancel/Accept targets. |
| Flow | Preserve keyboard navigation, give the external chooser exclusive visible focus, and restore the workflow popup when selection finishes. |
| Goal-Gradient Effect | Expose a linear choose → submit → progress → review → confirm/result sequence and show progress during runtime work. |
| Hick's Law | Render only actions valid for the current workflow phase; disable or omit unavailable choices. |
| Jakob's Law | Use familiar GTK file/folder/save dialogs and conventional Choose, Cancel, Back, and Save language. |
| Law of Common Region | Keep status, sources, evidence, and controls inside their workflow section or card. |
| Law of Proximity | Place the two event-source alternatives together, and keep each primary action beside its related secondary actions. |
| Law of Prägnanz | Prefer one native dialog and one linear state transition over a custom overlay or parallel popup. |
| Law of Similarity | Use shared source rows, feedback labels, button styles, focus cues, and disabled states across all four workflows. |
| Law of Uniform Connectedness | Use section containers, cards, and control rows to make source/result/action relationships explicit. |
| Mental Model | Match the desktop model: Choose opens a chooser, Cancel writes nothing, Back returns to review, and Save creates one new file. |
| Miller's Law | Show counts and persistent source names rather than requiring recall; bound selection and progressively disclose evidence. |
| Occam's Razor | Reuse one external chooser lifecycle and the platform helper instead of adding a custom picker or background watcher. |
| Paradox of the Active User | Make labels, accessible names, confirmation copy, and result feedback sufficient without requiring the documentation. |
| Pareto Principle | Keep common choose/cancel paths direct; put rare validation, duplicate, and lifecycle handling behind the same actions. |
| Parkinson's Law | Bound source counts, file sizes, folder depth, question length, and each request to one explicit task. |
| Peak-End Rule | End every chooser interaction by restoring the popup with a clear cancellation, selected-source, error, or saved-path message. |
| Postel's Law | Treat helper status 0 as selection and status 1 as safe cancellation, reject every other status, suppress late responses, and validate selected output strictly. |
| Selective Attention | Close the applet popup while the helper owns focus; keep chooser GTK/window lifetime outside Cinnamon so shell app-group handling cannot be re-entered by chooser teardown. |
| Serial Position Effect | Put source choice at the start, final confirmation at the end, and order native dialog buttons Cancel then Accept. |
| Tesler's Law | Keep scheduling, response de-duplication, cleanup, path validation, and reload safety in the lifecycle/port/controller rather than burdening the user. |
| Von Restorff Effect | Give the single next-step action the primary style while alternatives, Back, Cancel, Clear, and reset actions remain secondary. |
| Working Memory | Preserve selected names, counts, progress, evidence, and the final message in the reopened popup. |
| Zeigarnik Effect | Keep an interrupted workflow visibly pending until it reaches cancel/error/result, while teardown safely ends an abandoned chooser without a late update. |

## Verification

Automated coverage checks shell-process isolation, subprocess argument safety,
popup focus handoff and restoration, one-shot response delivery, reload teardown, keyboard
focusability, accessible labels and states, primary-action hierarchy, 44px
targets, explicit cancellation/result messages, and hostile response ordering.
Manual live acceptance still checks Cinnamon 6.0–6.6 under keyboard and pointer
input, light/dark/high-contrast themes, supported scale factors, narrow/large
text layouts, acceptance, cancellation, I/O failure, applet reload, and applet
removal while a chooser is open.

The earlier native-window-hint mitigation was superseded after an in-process
GTK chooser could still crash Cinnamon. This fix moves all open, folder, and
save dialogs into `zenity`; regression coverage now forbids the
applet from selecting any GTK-native chooser adapter. Live acceptance must keep
Cinnamon's PID and D-Bus responsiveness stable across selection, cancellation,
helper failure, applet reload, and removal. This bounded regression acceptance
does not replace the broader keyboard, pointer, theme, scale, and failure matrix above.

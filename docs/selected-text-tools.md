# Selected-text tools

Selected-text tools is a manual, one-shot workflow for text the user has
explicitly placed on the desktop clipboard. It appears only when the live
plug-in inventory reports a ready external `selected-text-tools` worker with
the `clipboard:read-once` grant and execution capability.

1. Select text in any application and copy it.
2. Open **Profiles** and choose Explain, Summarize, Rewrite, Extract tasks, or
   enter a target language and choose Translate.
3. That click reads the clipboard once and submits at most 32,768 characters.
4. Review the bounded result, provider, accelerator, selection digest, and
   source span. Extracted tasks are suggestions only.
5. Choose **Clear** to remove the result from the popup.

The applet does not install a clipboard watcher, poll the clipboard, retain a
selection history, or read anything before an operation click. It never pastes
or applies rewritten text, creates tasks, or changes another application. The
private selection is absent from public UI state and evidence; only its digest
and full-selection span cross the result boundary.

## Dependencies and accelerator policy

The Cinnamon applet needs the GTK/GDK clipboard API already supplied by the
Cinnamon desktop. It adds no optional Python, tokenizer, or model dependency.
A compatible local runtime and an external generation provider are mandatory.
The provider must implement the versioned job contract, declare the one-shot
grant, discard private fragments after the job, and report live readiness.

Qwen3 generation uses a qualified GPU lane by default. A provider may advertise
a qualified NPU lane through the same public workload contract. No CPU fallback
is accepted, and the applet does not infer NPU compatibility from a model name.
Model files, tokenizer packages, backend runtimes, license compliance, and
device-specific acceptance evidence belong to that provider, not the applet.

OmniTensor is the reference runtime for the cross-project contract tests; it is
not required by the product definition. Another service can implement the same
negotiated D-Bus methods and live plug-in inventory.

## Fail-closed behavior

The applet refuses unavailable or bundled-template-only workers, denied grants,
unready declared artifacts, malformed or oversized results, CPU-labelled
results, mismatched request IDs or operations, duplicate tasks, and evidence
whose selection and text digests differ. Transport failures can be cancelled
or cleared without retaining the clipboard contents.

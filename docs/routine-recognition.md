# Local routine recognition

Routine evaluation is explicitly opt-in and accepts only bounded, content-free
activity summaries: time buckets, weekday, categorical application and device
classes, active duration, transition count, and monotonic sequence numbers. It
does not accept window titles, typed text, paths, URLs, document names, audio,
images, or screen content.

The same labeled windows are measured with statistical, host-model, GPU-model,
and hybrid candidates. Accuracy gates candidate selection before measured p95
latency. Every result is a review-only suggestion from a host allowlist, carries
the exact feature sequences used as evidence, and requires a fresh explicit
confirmation. This boundary contains no executor and revocation or disabled
consent supplies no input.

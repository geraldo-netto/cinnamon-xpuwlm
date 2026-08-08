# TPU Workload Manager design proposal

Status: reference visual and interaction prototype. The production Cinnamon
applet is implemented in [`../cinnamon-tpuwm@geraldo-netto/`](../cinnamon-tpuwm@geraldo-netto/README.md);
the prototype files in this directory are design artifacts, not executable
applet code. No inference service, model runner, scheduler, or hardware-control
service is implemented in this repository.

## Current production boundary

The production applet presents device and workload state, persists local
profile intent and contention weights, provides pause/resume and recovery UX,
validates a trusted local runtime snapshot, and falls back to local Coral device
discovery when no snapshot exists. It does not execute models, schedule jobs, or
claim that UI intent has been enforced by hardware. See the [production applet
README](../cinnamon-tpuwm@geraldo-netto/README.md) for the current runtime
contract, quality gates, and installation instructions.

The profile taxonomy remains documented in [WORKLOADS.md](WORKLOADS.md). The
screens below preserve the approved design direction and responsive references;
live behavior is defined by the production applet.

## Reference screens

The panel prototype covers every primary navigation screen and critical recovery state:

1. **Overview:** device metrics, grouped active profiles, one expanded advisory, and paused-profile summary.
2. **Profiles:** all eight consolidated profiles, enabled state, and contention weights.
3. **Active alert:** evidence, confidence, safety boundary, review action, and recent history.
4. **No alerts:** explicit empty state with evaluation recency and retention context.
5. **All paused:** held-queue behavior, collector behavior, safety-rule continuity, and recovery action.
6. **TPU unavailable:** preserved jobs, deterministic no-fallback behavior, recovery steps, and diagnostics.

Approval images live in `mockup/screens/`. `all-screens.png` is the review gallery. Individual 1440×1080 images preserve readable detail; `768/` and `900/` contain responsive validation renders.

## Recommended panel design

Keep the Cinnamon popup focused on operations rather than exposing every model as a separate toggle:

1. **Panel indicator:** Coral status dot plus current TPU utilization. Clicking it opens the popup.
2. **Device summary:** connection state, TPU utilization, total queue depth, and on-chip model-cache use.
3. **Global controls:** pause/resume all workloads and select the scheduling profile.
4. **Workload profiles:** consolidated rows grouped as System health, Orchestration, and Local intelligence, each showing health, queue depth, and a priority weight.
5. **Expanded profile:** only a profile requiring attention expands automatically; its alert and action remain connected to that profile.
6. **Alerts:** the popup shows one contextual actionable alert; historical alerts belong in the full manager.
7. **Full manager:** detailed model, data-source, threshold, retention, and scheduling settings open outside the panel popup.

Priority weights are normalized only during contention. They are not physical TPU partitions, hard quotas, percentages, or guaranteed capacity.

## Accessibility baseline

- Use readable system-scaled typography; no essential text below 11 CSS pixels in the visual prototype.
- Maintain at least 4.5:1 contrast for normal text.
- Give every pointer target at least a 24 by 24 CSS-pixel activation area; primary actions target 44 pixels high.
- Provide visible labels for global actions, visible keyboard focus, semantic buttons, and screen-reader names.
- Communicate status with text and shape in addition to color.

## Why profiles instead of individual use cases

Several requested cases share inputs, preprocessing, models, or actions. Profiles avoid duplicated polling and competing inference jobs:

- one SMART and I/O collector feeds disk warning, trend detection, workload classification, cache scoring, and storage-tier recommendations;
- one scheduler combines noisy-neighbor detection, placement hints, queue forecasts, background-task timing, and job-capacity estimates;
- one image-embedding service supports screenshots, photos, documents, semantic search, and instance matching;
- power-supply, UPS, thermal, and memory signals share one hardware-health pipeline;
- compiler suggestions and resource-regression checks share build metadata and historical baselines.

## Proposed states

- **Healthy:** profile active; no signal crosses its review threshold.
- **Running:** inference or indexing work currently executing.
- **Watching:** noncritical anomaly requires review.
- **Idle:** enabled with no queued work.
- **Paused:** no new jobs accepted; existing policy determines whether queued work drains or cancels.
- **Unavailable:** required device, model, collector, or permission missing.

## Safety and privacy rules

- Keep device authorization, shutdown thresholds, backups, firmware limits, and access control deterministic.
- Treat model output as a score or recommendation, never an unrestricted command.
- Keep screenshot, photo, document, and embedding indexes local by default.
- Show retention controls and data-source permissions in the full manager.
- Serialize dispatch per physical Edge TPU; concurrency belongs in bounded queues.
- Expose model version, last successful run, confidence, latency, and failure reason.
- Never delay backups because a disk model reports low risk.

## Prototype review scope

Approve or revise:

- popup density and width;
- dark Cinnamon styling;
- eight-profile consolidation in `WORKLOADS.md`;
- soft-share controls;
- expanded storage profile in the overview;
- single-alert preview;
- separate full manager for advanced settings.

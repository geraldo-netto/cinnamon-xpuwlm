# Cinnamon applet integration

[Previous: Hardware and software setup](setup.md) · [Documentation index](../README.md) · [Next: Deployment, safety, and references](deployment.md)

## Overview

Assuming the Coral device is detected and its kernel-level driver or USB device rules are already working, a Cinnamon applet still should not talk to the hardware as though it were a generic peripheral. The device is used through the Edge TPU user-space runtime while executing a compiled model. The recommended integration is a thin Cinnamon panel client connected to a separate inference service.

There is no general Edge TPU command surface for an applet to manipulate. In this design, “control” means observing service/device availability, enabling or pausing application-level work, selecting an installed model, submitting or canceling inference jobs, and displaying results. Runtime package choice, clock mode, driver loading, device permissions, and model installation are administrative concerns and should not become panel toggles.

This is one concrete desktop adapter, not a change to the application-neutral architecture described above. The same service boundary can support a command-line client, desktop application, web UI, automation daemon, or another desktop environment.

### Required layers

| Layer | What is required | Responsibility |
| --- | --- | --- |
| Cinnamon applet | `metadata.json`, `applet.js`, and optionally `settings-schema.json` and `stylesheet.css` | Display state, collect bounded user choices, submit requests, and show results |
| IPC contract | Preferably a versioned session D-Bus interface; a Unix socket is an alternative | Separate Cinnamon/GJS from the runtime language and transport commands, results, state, and errors |
| Inference service | A long-running process written in C++, Python, or another language with a supported TensorFlow Lite binding | Own the interpreters, Edge TPU context, model cache, per-workload queues, scheduler, input processing, inference, and result decoding |
| User-space Edge TPU stack | `libedgetpu`, TensorFlow Lite, and optionally PyCoral or libcoral where their archived version constraints are acceptable | Open the device and execute Edge TPU custom operations |
| Compiled model bundle | One or more fully quantized, Edge TPU-compiled `.tflite` files plus labels and preprocessing metadata | Define what the integration can infer; installing a driver does not supply a model |
| Device permissions | A working `udev`/group policy for USB or access to the relevant `/dev/apex_*` device for PCIe | Allow the service user to open the device without running the applet as root |
| Service lifecycle | A user service or D-Bus activation, with restart and logging policy | Start, supervise, stop, and diagnose the inference process independently of Cinnamon |

Linux Mint documents Cinnamon applets as UUID-named directories containing at least `metadata.json` and `applet.js`, installed per user under `~/.local/share/cinnamon/applets`. Its settings API uses `settings-schema.json` to generate configuration UI and bind settings to an applet instance. [Writing Cinnamon applets](https://github.com/linuxmint/cinnamon/blob/master/docs/reference/cinnamon-tutorials/write-applet.xml) · [Cinnamon applet settings](https://github.com/linuxmint/cinnamon/blob/master/docs/reference/cinnamon-tutorials/xlet-settings.xml)

### Recommended architecture

```text
Cinnamon panel
  applet.js (GJS)
    - icon, tooltip, menu, settings
    - asynchronous requests and signal handlers
                |
                | session D-Bus: small commands, state, results
                v
Coral inference service
    - validates requests
    - captures or reads input
    - preprocesses tensors
    - owns TensorFlow Lite interpreter + libedgetpu delegate
    - admits, prioritizes, and queues jobs by workload
    - serializes inference dispatch per Edge TPU
    - decodes results and emits status signals
                |
                v
Compiled *_edgetpu.tflite model -> Edge TPU
```

Keep inference out of `applet.js`. Applet code participates in the desktop UI event loop, so blocking model loading, file decoding, device recovery, or synchronous inference can make the panel unresponsive. GJS provides asynchronous D-Bus proxies and method calls through `Gio.DBusProxy`; use those calls and service-emitted signals to update the UI. [GJS D-Bus guide](https://gjs.guide/guides/gio/dbus.html) · [`Gio.DBusProxy` reference](https://docs.gtk.org/gio/class.DBusProxy.html)

The service should normally be the only process that owns a given inference interpreter and its model schedule. Put requests into a bounded queue, serialize them initially, and add concurrency only after measuring the specific runtime, models, device count, and host. This also prevents multiple panel instances from independently loading models and competing for the same TPU.

### XPU workload management

The userspace service can be a broker for many clients and workloads, but it must distinguish software concurrency from hardware parallelism. It can accept several requests at once, preprocess inputs on host threads, and hold multiple jobs in flight. For one physical Edge TPU, however, it should dispatch the actual Edge TPU inference stage one job at a time.

Coral's public C++ API allows more than one TensorFlow Lite interpreter to share an `EdgeTpuContext` and declares the context interface thread-safe. That permits coordinated sharing within one process; it does not expose separate compute partitions or promise simultaneous execution inside one Edge TPU. Coral's support guidance for multiple models on one device says to sequence `Invoke()` calls, and its first-party example runs two models alternately through one shared context. [Public `EdgeTpuContext` API](https://github.com/google-coral/libedgetpu/blob/master/tflite/public/edgetpu.h) · [Two-model/one-TPU example](https://github.com/google-coral/libcoral/blob/master/coral/examples/two_models_one_tpu.cc) · [Coral concurrency guidance](https://github.com/google-coral/edgetpu/issues/277)

#### Direct answers

| Question | Answer |
| --- | --- |
| Can clients submit multiple inference jobs at once? | Yes. The service can accept them concurrently and place them in bounded per-workload queues. |
| Can host preprocessing and postprocessing overlap TPU work? | Yes, if separate host workers and buffers are used and end-to-end measurements show a benefit. |
| Can one TensorFlow Lite interpreter be invoked by several jobs simultaneously? | Do not design for that. Give an interpreter only one active invocation and serialize access to it. |
| Can several interpreters share one Edge TPU? | The C++ API supports interpreters sharing one `EdgeTpuContext`, but the service should schedule their TPU invocations sequentially. |
| Do several queued jobs execute in parallel inside one Edge TPU? | No supported parallel-compute guarantee exists. Treat one physical TPU as one non-preemptive inference server. |
| Can one TPU be partitioned as 25% + 25% + 25% + 25%? | Not in hardware. The public runtime exposes no percentage partition, virtual TPU, compute slice, memory slice, or per-tenant quota. |
| Can userspace approximate percentage shares? | Yes. A broker can allocate dispatch opportunities or measured TPU time with a weighted scheduler. This is soft time sharing, not isolation. |
| Can a running inference be preempted to serve a higher-priority job? | No public Edge TPU preemption primitive is documented. Priority takes effect between invocations. |
| Can queued work be canceled? | Yes, before dispatch. For an invocation already running, the safe portable behavior is to let it finish and discard its result. |
| Can multiple physical Edge TPUs run jobs in parallel? | Yes. Assign an independent worker/context to each device and dispatch jobs across them. |
| Does compiler model segmentation partition one TPU? | No. Compiler segmentation pipelines one model across multiple physical TPUs. |
| Does co-compilation reserve compute percentages? | No. It statically coordinates parameter-cache allocation for models that alternate on the same TPU. |

#### What a percentage can mean

A policy such as “25% for each of four workloads” needs an explicit userspace definition:

| Policy meaning | Behavior under contention | Limitation |
| --- | --- | --- |
| Invocation share | Roughly one of every four dispatches belongs to each workload | Inaccurate when models have different inference times |
| Measured invocation-time share | Each workload receives about 25% of measured `Invoke()` wall time over a window | Model loading, cache effects, USB transfer, CPU-mapped operations, and measurement noise affect the estimate |
| Minimum reservation | The scheduler attempts to deliver at least a target share to a busy workload | Requires admission control; unused reserved time may or may not be borrowed |
| Maximum cap | A workload cannot exceed its configured share | Can leave the TPU idle even when other work is waiting |
| Relative weight | Each active workload receives service in proportion to its weight | An idle workload's capacity is normally redistributed |
| Deadline or latency class | Interactive work may pass bulk work to meet a target | Does not provide a stable percentage and can starve background jobs without aging |

For general sharing, use measured invocation-time weights rather than job counts. Maintain an exponentially weighted estimate of warm inference time for each model, give each active workload time credit proportional to its weight, subtract actual invocation time after completion, and dispatch the eligible workload with the greatest deficit or earliest virtual finish time. Reconcile estimates with measured time continuously.

Invocation wall time is a service-time proxy, not a measurement of on-chip cycles. It can include host scheduling, transfers, and CPU-mapped operations, but it is still more representative of capacity consumption than counting a 2 ms job and a 40 ms job equally.

This produces approximate long-term fairness only. An inference is a non-preemptive scheduling unit, so a 40 ms job can delay a newly arrived 2 ms interactive job. Shares also drift over short windows, and a cold model load or cache replacement can temporarily consume much more time than a warm invocation.

#### Recommended scheduler design

```text
D-Bus clients
     |
     v
Admission control
  - validate workload and model
  - enforce queue, rate, size, and deadline limits
     |
     v
Per-workload queues
  interactive | monitoring | batch | maintenance | ...
     |
     v
Weighted/deadline scheduler
  - priority with aging
  - measured TPU-time deficits
  - bounded model-affinity batching
     |
     v
One dispatch worker per physical Edge TPU
  - one active Invoke() per interpreter
  - one scheduled inference at a time per device
     |
     v
Completion, accounting, result signal, and next dispatch
```

Use the following controls per workload:

| Control | Purpose |
| --- | --- |
| `weight` | Relative share of TPU time while several workloads are runnable |
| `min_share` | Optional soft reservation checked over a defined window |
| `max_share` | Optional cap that can deliberately leave capacity unused |
| `priority_class` | Separate interactive, normal, background, and maintenance latency classes |
| `max_queue` | Bound memory use and maximum stale work |
| `max_inflight` | Bound host-side preprocessing and result work; it does not create TPU parallelism |
| `max_rate` and `burst` | Token-bucket admission control before the scheduler |
| `deadline_ms` | Drop, degrade, or reroute a job that can no longer be useful |
| `max_consecutive` | Limit cache-friendly batching so one model cannot monopolize the device |
| `max_batch_wait_ms` | Bound how long the scheduler waits to collect same-model work |
| `device_affinity` | Prefer or require a particular physical TPU |
| `overflow_policy` | Reject newest, reject oldest, coalesce, or sample according to workload semantics; CPU fallback is deliberately excluded |

A reasonable hybrid policy is:

1. Reject unknown workload IDs, unknown model IDs, oversized inputs, expired deadlines, and requests beyond queue or rate limits.
2. Serve urgent jobs whose deadlines are approaching, subject to a bounded urgent-work budget.
3. Otherwise choose by weighted measured-time deficit, with aging so low-priority queues eventually progress.
4. Prefer the currently cached model only within `max_consecutive` and `max_batch_wait_ms` bounds.
5. Invoke exactly one scheduled job on that physical TPU.
6. Measure queue wait, device invocation wall time, total latency, and outcome; charge device time to the workload.
7. Recompute eligibility and repeat.

Strict priority alone is unsuitable for a shared service because continuous high-priority traffic can starve every other workload. Pure round-robin prevents starvation but ignores job cost. Pure cache-affinity maximizes throughput at the risk of unbounded latency. Combining deadlines, aging, measured-time deficit, and bounded model batching makes those tradeoffs explicit.

#### Example soft-share policy

```json
{
  "share_window_ms": 1000,
  "accounting_unit": "measured_invoke_time",
  "workloads": {
    "interactive": {
      "weight": 25,
      "priority_class": "interactive",
      "max_queue": 8,
      "max_consecutive": 2
    },
    "monitoring": {
      "weight": 25,
      "priority_class": "normal",
      "max_queue": 32,
      "max_consecutive": 4
    },
    "indexing": {
      "weight": 25,
      "priority_class": "background",
      "max_queue": 128,
      "max_consecutive": 8
    },
    "maintenance": {
      "weight": 25,
      "priority_class": "maintenance",
      "max_queue": 16,
      "max_consecutive": 4
    }
  }
}
```

In this example, `weight` means an equal relative share when all four queues are active. It is not a reserved physical quarter of the chip. If only one workload has jobs, a work-conserving scheduler can give it the whole TPU. If a strict cap is required, define `max_share` separately and accept that the device can be intentionally idle.

#### Model-cache-aware scheduling

Switching independently compiled models can clear and rewrite the Edge TPU parameter cache, increasing latency. Co-compiling frequently alternating models gives them a shared cache token so their statically assigned parameter data can coexist when space permits. Compiler input order affects which model receives cache space first. This is memory placement, not compute partitioning. [Co-compiling multiple models](https://coral.ai/docs/edgetpu/compiler/#co-compiling-multiple-models)

The scheduler should therefore:

- keep one prepared interpreter per active model when host memory permits;
- reuse a shared `EdgeTpuContext` for models assigned to the same device;
- co-compile models that really alternate on that same TPU, after comparing compiler memory reports;
- record warm, cold, and post-switch invocation time separately;
- group a small bounded number of same-model jobs to preserve cache locality; and
- stop batching when another workload approaches its latency or fairness limit.

Do not co-compile models merely because they exist in the same installation. A rarely used model can lose more from permanently reduced cache allocation than the service gains from avoiding an occasional cache rewrite.

#### Multiple physical Edge TPUs

Multiple devices are the only documented path to actual device-level parallelism. Enumerate devices once, open each by type/path, and give each device an independent serial worker. Then select a placement policy:

| Placement policy | Use |
| --- | --- |
| Dedicated device | Hardest practical isolation: reserve a whole TPU for one workload or trust domain |
| Pooled least-loaded | Send compatible jobs to the device with the least queued estimated time |
| Model affinity | Keep a model on one device to preserve its parameter cache |
| Workload affinity | Keep latency-sensitive or high-volume work on a predictable device |
| Spillover | Use a preferred device, then another accelerator when a queue limit is reached; this design deliberately never spills onto the CPU |
| Replicated model | Load the same model on several TPUs for higher request throughput |
| Segmented pipeline | Reserve several TPUs for consecutive segments of one large model |

A Dual Edge TPU module contains two independent Edge TPU devices; it is not one TPU with two percentage partitions. The host must expose both PCIe links before both can be scheduled. Pipelining also consumes whole devices and should be treated as a multi-device reservation. [Multiple Edge TPUs](https://coral.ai/docs/edgetpu/multiple-edgetpu/) · [Model pipelining](https://coral.ai/docs/edgetpu/pipeline/)

The production snapshot contract generalizes this multi-device model beyond the Edge TPU. A version 1 snapshot publishes a `devices` array of 1–16 accelerator entries — not a single `device` object — where each entry requires `id`, `backend` (`tpu`, `npu`, or `gpu`), `available`, `name`, and `kind`, with optional `vendor`, per-device `load` (0–100 or null), and `reason`. The `metrics` object carries only `queueDepth` and `runningProfiles`; load is per device rather than a global metric. The backend hierarchy is tpu > npu > gpu, and there is deliberately no CPU backend: inference never falls back onto the host CPU, and the absence of every accelerator is presented as an explicit unavailable/recovery state. The OmniTensor runtime service owns discovery and per-backend execution; the scheduling principles in this section — one serial dispatch worker per physical device, weighted soft shares, no hardware partitioning — apply per accelerator regardless of backend.

If hard performance or security isolation is required, dedicate complete devices and enforce device access outside the inference service. Weighted scheduling on one process is cooperative policy, not a security boundary and not a guaranteed service-level reservation.

#### Workload telemetry

The public Coral stack does not provide a `top`-like per-workload utilization meter or documented hardware counters for percentage attribution. Report broker measurements and label them accurately rather than presenting them as hardware telemetry. Coral support explicitly noted the absence of a TPU-usage tool in its concurrency guidance. [Coral TPU-status discussion](https://github.com/google-coral/edgetpu/issues/277)

Track at least:

- accepted, rejected, canceled, coalesced, expired, and completed jobs;
- current and peak queue depth per workload;
- queue-wait, preprocessing, invocation, postprocessing, and end-to-end latency distributions;
- measured invocation time charged to each workload and its achieved share over named windows;
- requested weight, minimum, cap, deadline misses, and starvation/aging events;
- cold loads, model switches, cache-affinity batches, and consecutive jobs per model;
- per-device ready, busy-by-scheduler, degraded, disconnected, and error states; and
- throughput, fallback count, result-discard count, and service restart count.

“Busy” should mean that the broker currently has an invocation dispatched, and “share” should mean the fraction of broker-measured invocation wall time. Neither should be labeled as an internal Edge TPU hardware-utilization percentage.

### Suggested D-Bus contract

Use a session-bus name such as `org.example.CoralControl1`, an object path such as `/org/example/CoralControl1`, and a matching interface name. Include a version in the API or bus name so the applet and service can reject incompatible peers. The names below are illustrative for a from-scratch integration; the production applet's actual control surface is the much smaller `org.cinnamon.OmniTensor1` contract implemented by the OmniTensor service, documented in [Runtime control contract](runtime-control.md).

| Member | Direction | Purpose |
| --- | --- | --- |
| `GetStatus()` | Method | Return service, device, scheduler, queue, active-model, and last-error summaries |
| `ListDevices()` | Method | Return enumerated physical TPUs, readiness, assignment, and broker-measured queue/busy state |
| `ListModels()` | Method | Return allowlisted model identifiers and their declared input/output purposes |
| `ListWorkloads()` | Method | Return configured workload IDs and their nonsecret scheduling policy |
| `ConfigureWorkload(workload_id, policy)` | Method | Validate and atomically update an authorized workload policy |
| `GetWorkloadStats(workload_id)` | Method | Return queue, latency, accounting, share, rejection, and deadline statistics |
| `SelectModel(model_id)` | Method | Change a default model in a simple single-workload mode; multi-workload jobs should name the model explicitly |
| `SubmitFile(workload_id, model_id, uri, options)` | Method | Validate a local input reference, apply admission control, and return a job ID immediately |
| `SubmitFeatures(workload_id, model_id, values, options)` | Method | Submit a small bounded feature vector through the same scheduler |
| `Cancel(job_id)` | Method | Cancel queued work or mark an in-flight result to be discarded |
| `SetEnabled(enabled)` | Method | Enable or pause application-level inference without changing driver state |
| `StatusChanged(status)` | Signal | Update icon, tooltip, menu, model, queue, or fault state |
| `WorkloadStatsChanged(workload_id, stats)` | Signal | Publish rate-limited queue, latency, and soft-share accounting updates |
| `JobFinished(job_id, result)` | Signal | Deliver a bounded result payload |
| `JobFailed(job_id, error_code, message)` | Signal | Report a stable machine-readable failure and a displayable message |

D-Bus supports typed method calls, replies, errors, signals, byte arrays, and Unix file-descriptor passing. It is well suited to control messages and small results, but do not copy continuous video frames or large tensors through the session bus. For streams, let the service own capture; for large one-shot inputs, pass a validated file reference, a Unix file descriptor, shared memory, or a dedicated local socket. [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html)

An illustrative interface skeleton is:

```xml
<node>
  <interface name="org.example.CoralControl1">
    <method name="GetStatus">
      <arg name="status" type="a{sv}" direction="out"/>
    </method>
    <method name="ListDevices">
      <arg name="devices" type="aa{sv}" direction="out"/>
    </method>
    <method name="ListModels">
      <arg name="models" type="aa{sv}" direction="out"/>
    </method>
    <method name="ListWorkloads">
      <arg name="workloads" type="aa{sv}" direction="out"/>
    </method>
    <method name="ConfigureWorkload">
      <arg name="workload_id" type="s" direction="in"/>
      <arg name="policy" type="a{sv}" direction="in"/>
    </method>
    <method name="GetWorkloadStats">
      <arg name="workload_id" type="s" direction="in"/>
      <arg name="stats" type="a{sv}" direction="out"/>
    </method>
    <method name="SelectModel">
      <arg name="model_id" type="s" direction="in"/>
    </method>
    <method name="SubmitFile">
      <arg name="workload_id" type="s" direction="in"/>
      <arg name="model_id" type="s" direction="in"/>
      <arg name="uri" type="s" direction="in"/>
      <arg name="options" type="a{sv}" direction="in"/>
      <arg name="job_id" type="t" direction="out"/>
    </method>
    <method name="SubmitFeatures">
      <arg name="workload_id" type="s" direction="in"/>
      <arg name="model_id" type="s" direction="in"/>
      <arg name="values" type="v" direction="in"/>
      <arg name="options" type="a{sv}" direction="in"/>
      <arg name="job_id" type="t" direction="out"/>
    </method>
    <method name="Cancel">
      <arg name="job_id" type="t" direction="in"/>
    </method>
    <method name="SetEnabled">
      <arg name="enabled" type="b" direction="in"/>
    </method>
    <signal name="StatusChanged">
      <arg name="status" type="a{sv}"/>
    </signal>
    <signal name="WorkloadStatsChanged">
      <arg name="workload_id" type="s"/>
      <arg name="stats" type="a{sv}"/>
    </signal>
    <signal name="JobFinished">
      <arg name="job_id" type="t"/>
      <arg name="result" type="a{sv}"/>
    </signal>
    <signal name="JobFailed">
      <arg name="job_id" type="t"/>
      <arg name="error_code" type="s"/>
      <arg name="message" type="s"/>
    </signal>
  </interface>
</node>
```

The dictionaries above are convenient during prototyping. For a stable public interface, document required keys and types or replace important fields with explicit typed arguments so accidental schema drift is detected.

### Minimal asynchronous GJS client pattern

The applet can turn the same interface XML into a GJS proxy. The following is intentionally only the transport pattern; the applet class, popup menu, translations, and panel-orientation handling should follow the Cinnamon API available on the target system.

```javascript
const Gio = imports.gi.Gio;

const BUS_NAME = 'org.example.CoralControl1';
const OBJECT_PATH = '/org/example/CoralControl1';
const CoralProxy = Gio.DBusProxy.makeProxyWrapper(CORAL_INTERFACE_XML);

function connectCoralService(applet) {
    const cancellable = new Gio.Cancellable();

    CoralProxy(
        Gio.DBus.session,
        BUS_NAME,
        OBJECT_PATH,
        (proxy, error) => {
            if (error !== null) {
                applet._setUnavailable(error.message);
                return;
            }

            applet._coralProxy = proxy;
            applet._statusSignalId = proxy.connectSignal(
                'StatusChanged',
                (_proxy, _sender, args) => applet._applyStatus(args[0])
            );

            proxy.GetStatusRemote((result, callError) => {
                if (callError !== null)
                    applet._setUnavailable(callError.message);
                else
                    applet._applyStatusReply(result);
            });
        },
        cancellable,
        Gio.DBusProxyFlags.NONE
    );

    return cancellable;
}
```

Store the returned `Gio.Cancellable`, proxy, and signal-handler ID on the applet instance. In `on_applet_removed_from_panel`, cancel pending connection work and call `disconnectSignal()` for every connected service signal. Use `SelectModelRemote`, `SubmitFileRemote`, and `CancelRemote` from menu callbacks; never use their synchronous variants in the panel UI path. The callback return shape follows the D-Bus output arguments, so keep `_applyStatusReply()` aligned with the frozen interface version. [GJS high-level proxy documentation](https://gjs.guide/guides/gio/dbus.html#high-level-proxies)

### Suggested file layout

```text
~/.local/share/cinnamon/applets/coral-control@example/
    metadata.json
    applet.js
    settings-schema.json       optional
    stylesheet.css             optional

~/.local/libexec/
    coral-control-service

~/.local/share/coral-control/
    models/
        model-name_edgetpu.tflite
        model-name.labels
        model-name.json        preprocessing and output metadata

~/.config/coral-control/
    scheduler.json             workloads, weights, limits, and placement

~/.config/systemd/user/
    coral-control.service
```

The UUID directory and the `uuid` value in `metadata.json` must match. The applet can expose configuration for the selected model, threshold, data source, request rate, result retention, notifications, and service behavior through `settings-schema.json`. Do not put secrets, unrestricted commands, or arbitrary model paths in applet settings.

### User-service example

```ini
[Unit]
Description=Coral Edge TPU inference service

[Service]
Type=dbus
BusName=org.example.CoralControl1
ExecStart=%h/.local/libexec/coral-control-service
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes

[Install]
WantedBy=default.target
```

Install the unit under the same account that runs Cinnamon, then load and start it with:

```bash
systemctl --user daemon-reload
systemctl --user enable --now coral-control.service
systemctl --user status coral-control.service
journalctl --user -u coral-control.service
```

`Type=dbus` requires the service to acquire the declared bus name. If the implementation does not own a D-Bus name, use `Type=simple` instead. A D-Bus activation file can replace eager startup; choose one coherent ownership/startup design rather than allowing several applet instances to spawn workers. See the [`systemd.service` documentation](https://manpages.debian.org/testing/systemd/systemd.service.5.en.html).

### Applet behavior

The applet should expose only small, reversible controls:

- show `offline`, `starting`, `idle`, `busy`, `paused`, `degraded`, and `error` states;
- display physical-device state, active model, total queue depth, last result time, and a concise fault message;
- show per-workload queue, latency, achieved soft share, deadline misses, and rejection counts in a detail view;
- enable or pause inference, select an allowlisted model, submit a bounded job, and cancel queued work;
- label scheduler weights and shares as userspace policy rather than physical TPU partitions;
- receive D-Bus signals instead of rapidly polling the service;
- disable controls while the service or device is unavailable;
- reconnect when the D-Bus name owner changes or Cinnamon reloads the applet;
- cancel outstanding applet-side calls during removal; and
- close the popup before presenting a native GTK chooser, then disconnect and
  destroy every chooser before rendering its deferred result or unloading the
  applet;
- provide explicit actions to open settings and view service logs.

The applet should not install packages, load kernel modules, modify `udev` rules, run `sudo`, change arbitrary file permissions, download untrusted models, or execute a model's output as a shell command.

### Service behavior and safeguards

- Verify the device and run a known compiled model from the same unprivileged account before involving Cinnamon.
- Load only models from an allowlisted bundle and validate model metadata, tensor shapes, preprocessing, labels, and runtime compatibility.
- Create one serial dispatch worker per physical TPU and never equate host thread count with TPU capacity.
- Validate scheduler configuration atomically; reject negative weights, impossible hard reservations, invalid devices, unknown models, and unbounded queues.
- Normalize relative weights instead of requiring them to add to 100, and define whether unused reservations or caps are borrowable.
- Bound input size, queue length, request rate, execution time, result size, and retained history.
- Treat paths, URIs, file descriptors, feature values, and applet settings as untrusted input even on the session bus.
- Use stable error codes for device missing, permission denied, incompatible runtime, model load failure, invalid input, timeout, cancellation, overload, and internal failure.
- Keep deterministic safety or authorization policy outside the model and outside the applet.
- Drop stale results after a model change, disable request, Cinnamon restart, or caller disconnect when appropriate.
- Record model version, request source, latency, confidence, and failure reason without retaining sensitive input by default.
- Recover from device disconnect without a tight restart loop; expose a degraded state and use bounded backoff.
- If several local clients are allowed, authenticate or authorize them at the service boundary rather than trusting the panel UI as a security boundary.

### Minimum implementation sequence

1. Confirm device access and inference with a command-line smoke test as the Cinnamon user.
2. Implement the standalone service and test model loading, preprocessing, inference, postprocessing, shutdown, and device-disconnect recovery without an applet.
3. Add one serial worker per physical TPU and prove that direct concurrent clients cannot bypass the broker.
4. Add bounded per-workload queues, admission control, deadlines, cancellation, and FIFO scheduling first.
5. Add measured-time accounting, weighted fairness, aging, and bounded model-affinity batching; test them with synthetic long and short jobs.
6. Verify requested versus achieved shares under saturation, partial load, idle workloads, cold loads, model switches, failures, and overload.
7. Freeze a small versioned D-Bus contract and test it with `gdbus` or `busctl --user`.
8. Add the user-service unit and verify startup, restart limits, logs, and clean shutdown.
9. Create the UUID-named Cinnamon applet with `metadata.json` and a minimal `applet.js` status icon.
10. Connect asynchronously to the session-bus service and render service and scheduler availability before adding controls.
11. Add job submission, cancellation, workload/model selection, statistics, signals, timeouts, and stale-result handling.
12. Add `settings-schema.json`, validation, accessibility labels, notifications, and localization.
13. Test Cinnamon restart, applet removal/re-addition, multiple panel instances, service crash, device removal, malformed requests, scheduling starvation, overload, and incompatible applet/service versions.

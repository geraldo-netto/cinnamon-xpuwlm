# Deployment, safety, and references

[Previous: Cinnamon applet integration](cinnamon-integration.md) · [Documentation index](../README.md)

## Virtualization

Coral does not publish a universal hypervisor recipe. The following is general device-ownership guidance derived from the host interfaces:

- **USB passthrough:** assign the complete USB device to the guest or container, then make the runtime available where the application executes.
- **PCIe passthrough to a virtual machine:** the host uses an IOMMU/VFIO path to assign the PCIe function or its required IOMMU group; the guest that owns the function loads the Coral PCIe driver and runtime.
- **Linux containers:** containers share the host kernel, so the host loads the kernel driver and exposes the resulting USB or character device with explicit device and cgroup permissions.

Device paths, group membership, reset behavior, permissions, and isolation depend on the host and virtualization platform. VFIO enforces IOMMU-group ownership, while LXC/Incus device access requires explicit device rules. [Linux VFIO documentation](https://docs.kernel.org/driver-api/vfio.html) · [LXC device-controller documentation](https://linuxcontainers.org/lxc/manpages/man5/lxc.container.conf.5.html) · [Incus character-device documentation](https://linuxcontainers.org/incus/docs/main/reference/devices_unix_char/)

## Deployment and evaluation workflow

Use the same workflow for any application rather than selecting a favored use case:

1. Define the input tensor, output meaning, accuracy target, latency/throughput target, and failure policy.
2. Implement and measure a CPU-only TensorFlow Lite baseline.
3. Train or select a TensorFlow model using operations that have quantized TensorFlow Lite implementations.
4. Validate the float model on held-out data.
5. Apply quantization-aware training or full-integer post-training quantization with representative calibration data.
6. Re-evaluate accuracy after quantization.
7. Compile with the Edge TPU Compiler and inspect every mapped and CPU-mapped operation.
8. Record on-chip and off-chip parameter-memory use from the compiler output.
9. Execute through TensorFlow Lite and `libedgetpu`, optionally using the archived PyCoral or libcoral convenience API when its version constraints are acceptable.
10. Warm the model before measuring steady-state latency, but also record first-inference and model-switch costs.
11. Benchmark capture, preprocessing, inference, postprocessing, storage, and action separately and end to end.
12. Test overload, malformed input, device disconnect, runtime error, low confidence, and fallback behavior.
13. Pin all runtime, compiler, model, driver, and host versions needed to reproduce the result.

### Preserved example: idle-window prediction

The earlier idle-window use case can be evaluated without making it the document's target application:

1. Record system metrics and user-idle state without taking action.
2. Define the prediction target, such as a bounded period of low foreground activity.
3. Train and fully quantize a small compatible classifier.
4. Compare CPU-only and Edge TPU inference latency, CPU time, power use, and orchestration overhead.
5. Run in observation mode and measure false-idle and missed-idle rates.
6. If the Edge TPU provides a net benefit, map predictions only to safe, predefined actions.

## Localization

The applet ships a gettext template at
`files/cinnamon-tpuwm@geraldo-netto/po/cinnamon-tpuwm@geraldo-netto.pot`,
generated deterministically by `npm run generate:pot`. Cinnamon translates
`settings-schema.json` (titles, descriptions, tooltips, units) and
`metadata.json` (name, description) through the applet UUID text domain, so
those strings are harvested into the template and a unit test fails whenever
the committed template drifts from the sources. Translators add
`po/<language>.po` files against the template; Cinnamon compiles and installs
them under `~/.local/share/locale` when the applet is installed from Spices.

## Safety and operational limits

- Only compiler-delegated operations are accelerated.
- TensorFlow Lite compatibility is broader than Edge TPU compatibility.
- Hardware detection does not establish model compatibility.
- Full model training is unsupported; documented on-device transfer learning updates only the final classification layer.
- Preprocessing, CPU fallback, result handling, I/O, and application logic can dominate performance.
- A larger model may stream parameters from external memory, but that can reduce performance.
- The first inference and model switches can be slower because parameter data must be loaded.
- One physical Edge TPU does not provide documented percentage partitions, virtual devices, preemptive priorities, or hard per-workload quotas.
- Userspace weights provide approximate scheduling fairness only; they are not hardware isolation or guaranteed capacity.
- Concurrent request acceptance does not imply parallel inference on one TPU; serialize device dispatch and use multiple physical TPUs for device-level parallelism.
- Multiple devices introduce bus, host, transfer, power, and thermal limits and do not guarantee linear scaling.
- Quantization can alter accuracy and must be evaluated on representative held-out data.
- Tiny models and simple deterministic methods can be faster, safer, and easier on the CPU.
- Public Coral software repositories are archived, increasing long-term integration and maintenance risk.
- Biometric, medical, security, safety, deletion, access-control, and actuator decisions require domain-specific validation and deterministic safeguards.

## References

### Core behavior and models

- [Coral FAQ](https://coral.ai/docs/edgetpu/faq/)
- [Edge TPU inferencing overview](https://coral.ai/docs/edgetpu/inference/)
- [TensorFlow models on the Edge TPU](https://coral.ai/docs/edgetpu/models-intro/)
- [Edge TPU Compiler](https://coral.ai/docs/edgetpu/compiler/)
- [Edge TPU performance benchmarks](https://coral.ai/docs/edgetpu/benchmarks/)
- [Coral trained-model catalog](https://coral.ai/models/)
- [Coral examples and project tutorials](https://coral.ai/examples/)
- [TensorFlow post-training quantization](https://www.tensorflow.org/model_optimization/guide/quantization/post_training)

### Embeddings, time series, training, and scaling

- [On-device image classification and embedding extractors](https://coral.ai/docs/edgetpu/retrain-classification-ondevice-backprop/)
- [Coral LSTM time-series tutorial](https://colab.research.google.com/github/google-coral/tutorials/blob/master/train_lstm_timeseries_ptq_tf2.ipynb)
- [Run multiple models with multiple Edge TPUs](https://coral.ai/docs/edgetpu/multiple-edgetpu/)
- [Pipeline a model with multiple Edge TPUs](https://coral.ai/docs/edgetpu/pipeline/)

### Workload sharing and scheduling

- [Public `EdgeTpuContext` and `EdgeTpuManager` API](https://github.com/google-coral/libedgetpu/blob/master/tflite/public/edgetpu.h)
- [Coral example alternating two models on one TPU](https://github.com/google-coral/libcoral/blob/master/coral/examples/two_models_one_tpu.cc)
- [Coral support guidance on sequential access and utilization reporting](https://github.com/google-coral/edgetpu/issues/277)
- [Co-compiling multiple models for shared parameter caching](https://coral.ai/docs/edgetpu/compiler/#co-compiling-multiple-models)
- [Running workloads on multiple Edge TPUs](https://coral.ai/docs/edgetpu/multiple-edgetpu/)

### Hardware and setup

- [USB Accelerator setup](https://coral.ai/docs/accelerator/get-started/)
- [M.2 and Mini PCIe setup](https://coral.ai/docs/m2/get-started/)
- [USB Accelerator datasheet](https://coral.ai/docs/accelerator/datasheet/)
- [M.2 Accelerator datasheet](https://coral.ai/docs/m2/datasheet/)
- [Mini PCIe Accelerator product specifications](https://coral.ai/products/pcie-accelerator/)
- [M.2 Accelerator with Dual Edge TPU datasheet](https://coral.ai/docs/m2-dual-edgetpu/datasheet/)

### Software lifecycle and platform infrastructure

- [Archived PyCoral repository](https://github.com/google-coral/pycoral)
- [Archived libcoral repository](https://github.com/google-coral/libcoral)
- [Archived libedgetpu repository](https://github.com/google-coral/libedgetpu)
- [Archived legacy Edge TPU repository](https://github.com/google-coral/edgetpu)
- [Linux Mint guide to writing Cinnamon applets](https://github.com/linuxmint/cinnamon/blob/master/docs/reference/cinnamon-tutorials/write-applet.xml)
- [Linux Mint Cinnamon applet settings guide](https://github.com/linuxmint/cinnamon/blob/master/docs/reference/cinnamon-tutorials/xlet-settings.xml)
- [GNOME JavaScript D-Bus guide](https://gjs.guide/guides/gio/dbus.html)
- [`Gio.DBusProxy` reference](https://docs.gtk.org/gio/class.DBusProxy.html)
- [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html)
- [`systemd.service` documentation](https://manpages.debian.org/testing/systemd/systemd.service.5.en.html)
- [Debian `apt-key` documentation](https://manpages.debian.org/unstable/apt/apt-key.8.en.html)
- [Debian APT `signed-by` documentation](https://manpages.debian.org/testing/apt/sources.list.5.en.html)
- [Linux VFIO documentation](https://docs.kernel.org/driver-api/vfio.html)
- [LXC device-controller documentation](https://linuxcontainers.org/lxc/manpages/man5/lxc.container.conf.5.html)

# Hardware and software setup

[Documentation index](../README.md) · [Next: Cinnamon applet integration](cinnamon-integration.md)

## Hardware integration

### Form factors

| Hardware | Documented host interface | Compatibility check |
| --- | --- | --- |
| Coral USB Accelerator | USB 3.0 / USB 3.1 Gen 1 through a Type-C socket | Host port, cable, USB topology, power, runtime support, and airflow |
| M.2 Accelerator, A+E key | M.2-2230 A+E key; PCIe Gen2 x1 | The slot must expose standard PCIe and provide the required power |
| M.2 Accelerator, B+M key | M.2-2280 B+M key; PCIe Gen2 x1 | Keying, 80 mm card length, PCIe routing, and available slot |
| Mini PCIe Accelerator | Half-Mini PCIe; PCIe Gen2 x1 | A true Mini PCIe interface, power, and physical clearance |
| M.2 Accelerator with Dual Edge TPU | M.2-2230 E key; two independent PCIe Gen2 x1 interfaces | Both PCIe links, MSI-X, power transients, and cooling |

Sources: [USB Accelerator datasheet](https://coral.ai/docs/accelerator/datasheet/) · [M.2 Accelerator datasheet](https://coral.ai/docs/m2/datasheet/) · [Mini PCIe Accelerator product specifications](https://coral.ai/products/pcie-accelerator/) · [Dual Edge TPU datasheet](https://coral.ai/docs/m2-dual-edgetpu/datasheet/)

Connector shape alone does not establish electrical compatibility. Check the host manual and exact Coral datasheet before selecting an internal module.

### Dual Edge TPU compatibility

The Dual Edge TPU module exposes two PCIe Gen2 x1 interfaces, one per TPU. Coral explicitly warns that this is not compatible with all M.2 E-key slots. If the host exposes only one link, it cannot enumerate both TPUs. A compatible host design or adapter must expose both functions and satisfy the module's power requirements. [Dual Edge TPU datasheet](https://coral.ai/docs/m2-dual-edgetpu/datasheet/)

### Thermal and power requirements

Power and heat depend on model, inference rate, and operating frequency. The PCIe module datasheets describe short current transients substantially above average current and require appropriate power delivery and thermal design. The USB runtime's maximum-frequency mode increases heat; the archived `libedgetpu` documentation gives lower ambient-temperature limits for maximum-frequency operation than for reduced-frequency operation. Measure sustained temperature and power with the actual model. [M.2 datasheet](https://coral.ai/docs/m2/datasheet/) · [libedgetpu thermal warning](https://github.com/google-coral/libedgetpu#warning)

## Software setup

### Accelerator probing reference

The OmniTensor service discovers accelerators by probing device nodes per
backend and uses the matching runtime stack for each. The applet itself never
probes hardware: it reads only the published snapshot, and when none is
present it reports that the runtime is not running.

| Backend | Device nodes probed | Vendor source | Runtime stack |
| --- | --- | --- | --- |
| `tpu` | PCIe `/dev/apex_0`–`/dev/apex_7`; USB runtime `18d1:9302`; USB DFU `1a6e:089a` | Fixed Coral vendor/product IDs | `tflite-runtime` with the `libedgetpu.so.1` delegate |
| `npu` | `/dev/accel/accel0`–`/dev/accel/accel7` | `/sys/class/accel/accelN/device/vendor` (`0x8086` Intel NPU, `0x1002`/`0x1022` AMD NPU, otherwise generic "NPU accelerator") | OpenVINO NPU plugin |
| `gpu` | `/dev/dri/renderD128`–`/dev/dri/renderD135` | `/sys/class/drm/renderDN/device/vendor` (`0x10de` NVIDIA, `0x1002` AMD, `0x8086` Intel, otherwise generic) | ncnn Vulkan compute first (any Vulkan driver; software llvmpipe devices are never selected), then ONNX Runtime CUDA/ROCm execution providers; the CPU provider is deliberately never used |

Node presence is not a working runtime. Probing reports only that a device
node exists; it does not verify that the driver is usable or that the runtime
library, execution provider, or plugin can be installed. An unreadable vendor
file never fails detection — the device is reported with a generic name.

### Development quality-gate dependencies

Complete local quality gates need Cinnamon's `cjs` runtime and `St-1.0.typelib`,
ImageMagick, and either librsvg or Inkscape. On Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install cinnamon cjs imagemagick librsvg2-bin
npm ci
npm test
```

On a host where Cinnamon and raster tools cannot be installed, use
`npm run test:local`. This explicit local-only mode skips theme-runtime and icon
raster checks while keeping lint, syntax, coverage, fuzz, and mutation gates.
Any `CI` environment ignores `XPUWLM_SKIP_HOST_GATES`; CI always enforces every
host-backed test.

Mutation runs allocate half the host's logical CPUs to Stryker and at most two
Node test workers inside each process. This bounds nested parallelism near the
available CPU count. Successful results are cached under the ignored
`mutation-report/` directory and reused when source remains unchanged; use
`npx stryker run --force` for a deliberate clean mutation audit.

GitHub Actions runs `npm run test:ci`, which preserves lint, artifact,
workload-contract, coverage, fuzz, and visual gates but deliberately excludes
Stryker so mutation runtime cannot block pull-request and push pipelines.
`npm test` remains the complete local gate and still includes mutation testing.

### Compatibility warning

Coral's public setup pages document older operating-system and Python ranges, while the relevant public software repositories are now archived. Before changing a host, verify that the target distribution, kernel, Python version, TensorFlow Lite runtime, Edge TPU runtime, PCIe driver, and compiler/runtime pair are mutually compatible. Prefer a reproducible environment whose versions are known to work. [USB setup requirements](https://coral.ai/docs/accelerator/get-started/#requirements) · [M.2 setup requirements](https://coral.ai/docs/m2/get-started/#requirements)

The commands below preserve the existing Debian/Ubuntu package workflow. They are reference commands, not a guarantee that every current distribution is supported.

### Add the Coral APT repository

Coral's official pages still show `apt-key`, which Debian deprecates. This equivalent form stores the key under `/etc/apt/keyrings` and limits it to the Coral source with `signed-by`, following Debian's current APT guidance. [Coral repository instructions](https://coral.ai/docs/accelerator/get-started/#1a-on-linux) · [Debian `apt-key` deprecation](https://manpages.debian.org/unstable/apt/apt-key.8.en.html) · [Debian `signed-by` documentation](https://manpages.debian.org/testing/apt/sources.list.5.en.html)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/coral-edgetpu.gpg
echo "deb [signed-by=/etc/apt/keyrings/coral-edgetpu.gpg] https://packages.cloud.google.com/apt coral-edgetpu-stable main" \
  | sudo tee /etc/apt/sources.list.d/coral-edgetpu.list >/dev/null
sudo apt-get update
```

### USB runtime

```bash
sudo apt-get install libedgetpu1-std
```

Reconnect an already attached USB Accelerator after installation so the installed `udev` rule takes effect. Coral recommends USB 3.0 for best performance. [USB setup](https://coral.ai/docs/accelerator/get-started/#1a-on-linux)

### M.2 or Mini PCIe runtime and driver

PCIe devices require Coral's Gasket/Apex driver in addition to the Edge TPU runtime:

```bash
sudo apt-get install gasket-dkms libedgetpu1-std
```

After following the official driver and permission steps and rebooting, Coral documents this PCIe detection check:

```bash
lspci -nn | grep 089a
```

Kernel API changes, DKMS build requirements, module signing, and Secure Boot policy can affect an archived out-of-tree driver. Use the host distribution's documented module-signing process; do not disable a security control merely to make the driver load. [M.2 Linux setup and troubleshooting](https://coral.ai/docs/m2/get-started/#2a-on-linux)

### Python and C++ APIs

Coral's Debian package for the convenience Python API is:

```bash
sudo apt-get install python3-pycoral
```

The Coral setup page documents PyCoral for Python 3.6 through 3.9, and the PyCoral repository is archived. Verify interpreter and native-library compatibility instead of assuming a current system Python will work. Python can also use TensorFlow Lite with the Edge TPU delegate directly. C++ can use TensorFlow Lite with `libedgetpu`; `libcoral` is the archived convenience layer. [PyCoral installation](https://coral.ai/docs/accelerator/get-started/#2-install-the-pycoral-library) · [Inferencing APIs](https://coral.ai/docs/edgetpu/inference/)

### Edge TPU Compiler

On a supported x86-64 Debian-based build host:

```bash
sudo apt-get install edgetpu-compiler
```

The deployed model must not require a newer runtime than the target device provides. Use `edgetpu_compiler --version`, inspect the compile log, and set `--min_runtime_version` only when the documented compiler/runtime compatibility permits it. [Compiler installation and version compatibility](https://coral.ai/docs/edgetpu/compiler/)

### Standard and maximum-frequency runtimes

`libedgetpu1-std` uses the standard/reduced-frequency configuration. `libedgetpu1-max` replaces it with the maximum-frequency configuration; the two are not installed together. Maximum frequency can improve model execution latency but raises power and heat. Start with `libedgetpu1-std` and switch only after measurement and thermal review. [USB runtime options](https://coral.ai/docs/accelerator/get-started/#install-with-maximum-operating-frequency-optional)

### Other operating systems

Coral publishes separate USB instructions for supported Linux, macOS, and Windows versions and separate PCIe instructions for supported Linux and Windows versions. Follow the hardware-specific official page; do not apply Debian package commands to another operating system. [USB setup](https://coral.ai/docs/accelerator/get-started/) · [PCIe setup](https://coral.ai/docs/m2/get-started/)

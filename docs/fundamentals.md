# Fundamentals and execution model

[Documentation index](../README.md) · [Next: Use cases and practicality](use-cases.md)

## Documentation and maintenance status

The public Coral documentation and package repository remain available, but the upstream `pycoral`, `libcoral`, and `libedgetpu` GitHub repositories were archived and made read-only during 2025, and the legacy `edgetpu` repository was archived in April 2026. Treat the documented Python, operating-system, compiler, and TensorFlow version ranges as compatibility constraints rather than assumptions about current distributions. Verify the complete toolchain before choosing hardware for a new deployment. [PyCoral repository](https://github.com/google-coral/pycoral) · [libcoral repository](https://github.com/google-coral/libcoral) · [libedgetpu repository](https://github.com/google-coral/libedgetpu) · [legacy Edge TPU repository](https://github.com/google-coral/edgetpu)

Archive status does not by itself mean that installed hardware stops working. It does mean that future kernel, Python, TensorFlow, compiler, packaging, and security compatibility should not be assumed without testing.

## How to read the evidence

This README uses five evidence labels:

| Label | Meaning |
| --- | --- |
| **Documented** | Coral publishes the capability, model family, API, benchmark, or example directly. |
| **Derived candidate** | The application is a reasoned mapping to a documented task or supported operation, but Coral does not publish that complete application. |
| **Experimental** | The mapping is plausible, but model compatibility, accuracy, preprocessing cost, or output cost presents substantial uncertainty. |
| **Poor or unsupported fit** | The task is outside the Edge TPU execution model or is normally cheaper with a conventional method. |
| **Speculative idea** | Deliberate brainstorming with no claim of an existing model, successful compilation, useful accuracy, or performance benefit. |

The use-case catalog is intentionally broader than Coral's official example set. Its application rows should therefore be read together with their model family and fit label. The authoritative test is always the Edge TPU Compiler report followed by an end-to-end benchmark on the target host. [Compiler documentation](https://coral.ai/docs/edgetpu/compiler/)

## What the Edge TPU is

- A fixed-function ML accelerator designed by Google for on-device inference in low-power systems.
- A coprocessor available in USB, M.2, Mini PCIe, system-on-module, and integrated product forms.
- A device that runs TensorFlow Lite models only after they have been quantized and compiled for the Edge TPU.
- An integer-oriented accelerator: supported tensor parameters use 8-bit fixed-point values (`int8` or `uint8`).
- An accelerator for supported deep feed-forward networks, especially convolutional networks, with a restricted operation set that also includes fully connected layers and a constrained unidirectional LSTM operation.
- A device with roughly 8 MiB of compiler-managed on-chip SRAM used for the executable and cached model parameters; this memory is a scratchpad, not a conventional transparent cache.
- A local accelerator that can avoid sending inference inputs to a cloud service when the rest of the application is also local.

These characteristics are documented in the [Coral FAQ](https://coral.ai/docs/edgetpu/faq/), [model requirements](https://coral.ai/docs/edgetpu/models-intro/), and [compiler memory documentation](https://coral.ai/docs/edgetpu/compiler/#parameter-data-caching).

## What the Edge TPU is not

- It is not a Cloud TPU. Cloud TPUs and Edge TPUs have different architectures, performance envelopes, and intended workloads.
- It is not a general-purpose CPU, GPU, DSP, video codec, storage controller, or network processor.
- It is not a CUDA, OpenCL, Vulkan Compute, ONNX, PyTorch, or arbitrary TensorFlow execution device.
- It is not an automatic accelerator for an entire program; only compiled model operations delegated to the Edge TPU run there.
- It is not a general training accelerator. The documented exception is specialized transfer learning that updates only the final classification layer of a specially prepared model.
- It is not a requirement for TensorFlow Lite inference. The pre-compilation TensorFlow Lite model can be measured on the CPU as a baseline; Edge TPU compilation then replaces compatible graph portions with Edge TPU custom operations.
- It is not guaranteed to save CPU time or energy. Transfer, preprocessing, postprocessing, Python overhead, unsupported operations, and I/O can dominate a pipeline.
- It is not a vector database, media decoder, tracker, policy engine, actuator controller, or user interface.

See the [Coral FAQ](https://coral.ai/docs/edgetpu/faq/), [inferencing overview](https://coral.ai/docs/edgetpu/inference/), and [on-device transfer-learning documentation](https://coral.ai/docs/edgetpu/models-intro/#transfer-learning-on-device).

## What it can and cannot do

| Area | What it can do | What it cannot do by itself |
| --- | --- | --- |
| Inference | Execute compatible, compiled TensorFlow Lite operations | Execute arbitrary framework graphs or unsupported operators |
| Classification | Produce class scores from image, audio, fixed-feature, or compatible sequence inputs | Define labels, collect training data, or enforce decisions |
| Detection | Produce supported detector outputs such as classes and bounding boxes | Decode video, track identities over time, or store events |
| Segmentation and pose | Run compatible pixel-label and keypoint models | Composite images, render overlays, or interpret long event sequences |
| Embeddings | Produce feature vectors from a compatible extractor | Maintain or search a vector index |
| Time series | Run compatible fixed-shape networks, including the documented constrained unidirectional LSTM | Accept arbitrary dynamic sequences or unsupported recurrent architectures |
| Multiple models | Run or co-compile multiple compatible models | Avoid parameter-cache costs automatically |
| Multiple devices | Assign models to different TPUs or pipeline compatible model segments | Guarantee linear scaling or remove host and bus bottlenecks |
| Transfer learning | Accelerate documented final-layer weight imprinting or backpropagation | Retrain all layers or train an arbitrary model from scratch |
| Privacy | Keep inference local when the application is local | Provide encryption, access control, retention policy, or consent management |

Coral publishes trained models for image classification, object detection, semantic segmentation, pose estimation, and audio classification, plus examples for tracking, keyphrases, face detection, and model pipelining. These prove the underlying task families, not every downstream application listed later. [Trained models](https://coral.ai/models/) · [Examples](https://coral.ai/examples/)

## Neural-network inference

Inference applies an already-trained network to new input and produces an output such as a class, score, bounding box, mask, keypoint set, embedding, or forecast.

| Training | Inference |
| --- | --- |
| Learns or updates model weights | Normally uses fixed, pre-trained weights |
| Uses forward and backward passes | Uses a forward pass |
| Requires an optimization objective and training data | Processes new observations |
| Usually runs on training-oriented hardware | Can run on CPUs or specialized edge accelerators |

The limited Coral transfer-learning APIs are an explicit exception to the usual fixed-weight inference model: they keep the compiled base network fixed and update only a separated final classification layer. [Transfer learning on-device](https://coral.ai/docs/edgetpu/models-intro/#transfer-learning-on-device)

## Execution boundary

```text
Input source
    |
    v
Capture / read / decode / parse                    host CPU, GPU, or media engine
    |
    v
Resize / normalize / tokenize / build features     usually the host
    |
    v
Compiled compatible TensorFlow Lite subgraph       Edge TPU
    |
    v
CPU-mapped model operations, if any                host CPU
    |
    v
Decode outputs / search / track / aggregate        host CPU or another accelerator
    |
    v
Store / display / notify / control / enforce       host application
```

For policy-producing applications, keep inference separate from enforcement:

1. Collect bounded, versioned inputs.
2. Validate and transform them into the model's fixed input tensor.
3. Run the compiled model.
4. Validate the output and confidence.
5. Map it to an allowlisted action or recommendation.
6. Apply rate limits, thresholds, and cooldown periods.
7. Log the input version, model version, output, action, and measured effect.
8. Fall back to a deterministic policy if inference or validation fails.

## Model compatibility

### Mandatory model properties

To take full advantage of the Edge TPU, a model must satisfy the documented requirements:

- Tensor parameters are quantized as 8-bit fixed-point values (`int8` or `uint8`).
- Tensor sizes are constant at compile time; dynamic tensor sizes are unsupported.
- Model parameters such as bias tensors are constant at compile time.
- Tensors are one-, two-, or three-dimensional, or only the three innermost dimensions have a size greater than one.
- Every accelerated operation appears in Coral's supported-operation list and satisfies that operation's restrictions.
- The TensorFlow Lite model is compiled with the Edge TPU Compiler before execution.

The exact operation list is versioned. It includes convolution, depthwise convolution, fully connected, pooling, element-wise arithmetic, selected reductions, reshape/slice/pad/transpose operations, common activations, L2 normalization, softmax, and a unidirectional LSTM in supported runtime/compiler versions. Check the current restrictions rather than inferring compatibility from an operation name alone. [Model requirements and supported operations](https://coral.ai/docs/edgetpu/models-intro/#model-requirements)

### Quantization

Coral documents quantization-aware training or full-integer post-training quantization. Full-integer post-training quantization requires a representative dataset to calibrate activation ranges. Weight-only, dynamic-range, FP16, and mixed float models do not satisfy the Edge TPU's full-integer execution requirement. [Coral quantization requirements](https://coral.ai/docs/edgetpu/models-intro/#quantization) · [TensorFlow post-training quantization](https://www.tensorflow.org/model_optimization/guide/quantization/post_training)

Float input or output tensors can be left at the model boundary, but the compiler leaves quantize or dequantize work on the CPU. Fully integer input and output tensors avoid that conversion overhead. [Float input and output tensors](https://coral.ai/docs/edgetpu/models-intro/#float-input-and-output-tensors)

### Partial compilation and CPU fallback

The compiler maps supported operations from the beginning of the graph into an Edge TPU custom operation. At the first unsupported operation, that operation and the remainder of the graph execute on the CPU; the compiler does not resume Edge TPU compilation later in the graph. A small number of CPU-mapped operations can dominate latency, so operation count is not a reliable performance percentage. Review the compiler log and aim for a completely delegated graph when acceleration matters. [Compiling a model](https://coral.ai/docs/edgetpu/models-intro/#compiling)

### Framework and API boundary

The hardware runtime executes compiled TensorFlow Lite models. Python applications can use TensorFlow Lite with the Edge TPU delegate or the convenience PyCoral API; C++ applications can use TensorFlow Lite with `libedgetpu` or the convenience `libcoral` API. PyCoral and libcoral are wrappers, not additional model formats. [Inferencing overview](https://coral.ai/docs/edgetpu/inference/)

The Edge TPU Compiler distributed by Coral runs on x86-64 Debian-based Linux; Coral states that compiler release 2.1 and later is unavailable for ARM64. A model can be compiled on a separate supported machine and deployed to an ARM host. [Compiler system requirements](https://coral.ai/docs/edgetpu/compiler/#system-requirements)

## Memory, performance, and scaling

### On-chip parameter memory

The Edge TPU has roughly 8 MiB of SRAM shared between the inference executable and cached parameter data. The compiler allocates this scratchpad statically. A model larger than the available parameter area is not automatically rejected; uncached parameters can be fetched from external memory, with a performance cost reported by the compiler. The first inference is slower because parameters must be loaded. [Parameter data caching](https://coral.ai/docs/edgetpu/compiler/#parameter-data-caching)

### Performance claims

The 4-TOPS figure describes peak 8-bit arithmetic. Coral's published benchmark table measures model execution only and explicitly excludes input preparation such as image downscaling. USB performance also depends on host CPU, USB speed, and other resources. Therefore measure at least:

- warm and cold inference latency;
- throughput at the intended concurrency;
- host CPU time for the complete pipeline;
- preprocessing and postprocessing time;
- bus transfer and model-switching overhead;
- memory use and parameter-cache spill;
- sustained power and temperature; and
- accuracy after quantization.

[Coral performance benchmarks](https://coral.ai/docs/edgetpu/benchmarks/)

### One device, multiple models

Performance is normally best with one frequently used model per Edge TPU because switching independently compiled models can replace cached parameters. Co-compilation gives several models a shared cache token and can reduce repeated cache clearing, but the fixed scratchpad capacity is divided among them. The compiler reports on-chip and off-chip parameter use. [Multiple-model caching](https://coral.ai/docs/edgetpu/compiler/#co-compiling-multiple-models)

### Multiple devices

Documented scaling patterns include:

- assigning independent models to separate Edge TPUs;
- loading the same model on several TPUs for data parallelism; and
- segmenting one compatible model across several TPUs for pipeline parallelism.

Scaling is not automatically linear. Host preprocessing, Python CPU work, USB bandwidth, hub topology, intermediate-tensor transfer, unequal segment latency, power, and cooling can become bottlenecks. [Multiple Edge TPUs](https://coral.ai/docs/edgetpu/multiple-edgetpu/) · [Model pipelining](https://coral.ai/docs/edgetpu/pipeline/)

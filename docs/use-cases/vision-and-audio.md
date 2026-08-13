# Vision and audio use cases

[Previous: System workflows](system-workflows.md) · [Use-case index](../use-cases.md) · [Documentation index](../../README.md) · [Next: Systems and data](systems-and-data.md)

## Image similarity and visual search

Yes, an Edge TPU can accelerate the embedding-extraction stage of an image-similarity system. Coral documents converting compatible MobileNet and Inception classifiers into embedding extractors. The Edge TPU converts each image into a compact feature vector; the host stores, compares, indexes, and searches those vectors. Applying the documented extractor pattern to similarity search is a derived use case, not a complete Coral-published search system. [Embedding extractor documentation](https://coral.ai/docs/edgetpu/retrain-classification-ondevice-backprop/)

```text
Image file or frame
        |
        v
Decode, resize, and normalize (CPU)
        |
        v
Quantized embedding model (Edge TPU)
        |
        v
Embedding vector
        |
        v
Normalize and search the vector index (CPU)
        |
        v
Nearest images and similarity scores
```

### Matching workflow

1. Select or train an image model whose output is an embedding rather than a class label.
2. Fully quantize and compile the model for the Edge TPU.
3. Run every reference image through the model once and store its embedding with the image identifier.
4. Run a query image through the same preprocessing and model.
5. Dequantize the output when necessary and L2-normalize it.
6. Compare it with the stored embeddings using cosine similarity or another metric used during model training.
7. Return the closest matches only when they satisfy a threshold calibrated on representative images.

Cosine similarity is commonly calculated as:

```text
similarity = dot(query, reference) / (norm(query) * norm(reference))
```

After L2 normalization, this reduces to a dot product. A score is meaningful only relative to the chosen model and calibration dataset; there is no universal threshold for “high similarity.”

### Choose the right similarity method

| Goal | Recommended method | Edge TPU role |
| --- | --- | --- |
| Detect byte-identical files | Cryptographic hash | None; use the CPU |
| Detect resized or lightly edited duplicates | Perceptual hash | Usually none; CPU methods are simpler |
| Find visually or semantically related images | General image embedding | Accelerate embedding generation |
| Match the same product, artwork, place, animal, or object instance | Metric-learning embedding trained for that domain | Accelerate embedding generation |
| Cluster a photo library | Embeddings followed by clustering | Generate embeddings; clustering remains on the CPU |
| Search millions of images | Embeddings plus an approximate nearest-neighbor index | Generate embeddings; indexing and search remain on the host |

Coral's documented MobileNet and Inception embedding extractors establish that compatible models can emit feature vectors. Whether those vectors are suitable for semantic retrieval, instance matching, or another similarity definition must be measured on representative data. A domain-trained metric-learning model is another derived option, but its exact architecture must still satisfy Edge TPU operation and quantization requirements.

For biometric matching, obtain appropriate consent, protect stored embeddings, calibrate false-match and false-rejection rates, and avoid using the result as the sole basis for access or another consequential decision.

## Application catalog

The tables below separate the neural-network task from the surrounding application. **Documented** rows correspond to an official Coral model, example, or platform capability. A **derived candidate** maps an application to one of those documented model families but still requires a suitable dataset, a compatible quantized model, compilation, and end-to-end benchmarking. **Experimental** rows carry additional compatibility or cost uncertainty. The documented task families and examples are indexed in Coral's [trained-model catalog](https://coral.ai/models/) and [example catalog](https://coral.ai/examples/).

### Images and documents

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Semantic image search | Embedding vector | Derived candidate; vector search runs on the CPU |
| Photo-library clustering | Embedding vector | Derived candidate; clustering and album management run on the CPU |
| Same-object or product matching | Domain-specific embedding | Derived candidate; requires metric-learning data |
| Image tagging | One or more labels | Documented classification family |
| Scene classification | Indoor, outdoor, office, street, and similar labels | Derived candidate based on the documented classification family |
| Object inventory | Object classes and boxes | Derived candidate based on the documented detection family; database updates run on the CPU |
| Face detection | Face boxes | Documented detection example; identity matching is separate |
| Face grouping or recognition | Face embeddings | Derived candidate; biometric safeguards required |
| Logo or brand detection | Labels or boxes | Derived candidate based on classification or detection |
| Artwork, landmark, or collectible matching | Embedding or class | Derived candidate; domain-specific data improves results |
| Image-quality triage | Blur, exposure, composition, or quality score | Derived candidate; simple blur metrics may be cheaper on the CPU |
| Sensitive-content screening | Content labels | Derived candidate; use as a review signal, not an infallible filter |
| Screenshot or UI-state classification | Screen or dialog class | Derived candidate; capture and automation remain on the CPU |
| Visual regression detection | Difference or anomaly score | Derived candidate; requires stable baselines and careful calibration |
| Document-type classification | Invoice, receipt, form, letter, and similar labels | Derived candidate classification workload |
| Document-layout detection | Text, table, signature, stamp, or field regions | Derived candidate detection or segmentation workload |
| OCR region detection | Text-region boxes | Derived candidate; character recognition and language processing may remain on the CPU |
| Handwriting or symbol recognition | Character, symbol, or short-token class | Derived candidate for bounded vocabularies |
| Barcode and QR localization | Code-region box | Usually use conventional decoders unless difficult scenes justify ML |
| Industrial defect inspection | Defect class, location, or anomaly score | Derived candidate when images arrive continuously |
| Electronics or PCB inspection | Missing, misplaced, or damaged component | Derived candidate detection workload |
| Microscopy slide triage | Cell, particle, or anomaly class | Derived candidate; not a substitute for validated clinical review |
| Plant-health classification | Species, disease, or stress class | Derived candidate classification workload |
| Wildlife or bird identification | Species class | Derived candidate classification workload |
| Food and ingredient recognition | Food class or object boxes | Derived candidate classification/detection workload |
| Aerial or map-tile classification | Land-use, damage, or object class | Derived candidate batch workload |
| Foreground or person segmentation | Per-pixel mask | Documented segmentation family |
| Background removal | Foreground mask | Derived candidate based on the documented segmentation family; compositing runs on the host |
| Privacy redaction | Face, person, screen, or plate mask/box | Derived candidate; blurring and policy logic run on the host |
| Depth or surface estimation | Depth map or surface class | Experimental; verify architecture and output cost |
| Low-light image enhancement | Enhanced image or pixel-wise tonal-curve map | Dedicated `low-light-enhancement` catalog workload, disabled by default until its manifest acceptance criteria are measured on named hardware; use a fixed-shape, fully quantized lightweight CNN; keep decoding, resizing, capture/ISP, re-encoding, display, and downstream decisions on the host; verify full Edge TPU compilation, quantized fidelity, noise, color, artifacts, and end-to-end benefit over CPU/GPU tone mapping |
| Denoising, super-resolution, or colorization | Reconstructed image | Experimental; large outputs and unsupported operations can erase the benefit |

### Video and camera streams

Video decoding, frame selection, tracking, overlays, recording, and encoding generally remain on the CPU or GPU. The Edge TPU accelerates inference on selected frames.

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Local NVR object detection | Person, vehicle, animal, or package boxes | Derived candidate built on documented object detection; decoding and recording remain host work |
| Multi-camera event filtering | Objects or event class per sampled frame | Derived candidate when inference is sustained |
| Object tracking | Detections feeding persistent track IDs | Documented detection example; tracker runs on the host |
| Line crossing and zone entry | Tracked object and location | Derived candidate; geometry and event rules run on the host |
| Occupancy and people counting | Person detections or density estimate | Derived candidate; avoid identity inference when counts are sufficient |
| Parking-space monitoring | Vehicle and space occupancy | Derived candidate detection/segmentation workload |
| Traffic and queue monitoring | Object class, count, speed proxy, or queue state | Derived candidate; tracking and aggregation run on the host |
| Package or delivery detection | Package/person boxes | Derived candidate detection workload |
| Pet-door or feeder control | Species or individual class | Derived candidate; physical safety interlocks remain deterministic |
| Wildlife camera filtering | Animal class and box | Derived candidate; retain uncertain events to avoid false negatives |
| Pose estimation | Body keypoints | Documented pose family |
| Gesture control | Pose, hand state, or gesture class | Derived candidate built on pose/classification |
| Ergonomic posture reminders | Pose or posture class | Derived candidate; avoid medical claims |
| Fall-event alerting | Pose sequence or fall score | Derived candidate but high stakes; require confirmation and fallback monitoring |
| Head or gaze direction | Facial landmarks or direction class | Derived candidate; accessibility and privacy considerations apply |
| Webcam auto-framing | Person box or pose | Derived candidate; camera control and cropping run on the host |
| Virtual background | Person mask | Derived candidate based on the documented person-segmentation example |
| Live anonymization | Face/person mask or box | Derived candidate; rendering and encoding run on the host |
| Sign or bounded gesture recognition | Pose sequence or gesture label | Derived candidate; full sign-language translation is substantially harder |
| 3D-printer failure detection | Print-state or defect class | Derived candidate continuous-monitoring workload |
| Manufacturing-line inspection | Object, defect, or state class | Derived candidate when frames and classes are controlled |
| Retail shelf or stock monitoring | Product boxes and counts | Derived candidate; inventory reconciliation runs on the host |
| Sports pose or event tagging | Keypoints or bounded event class | Derived candidate; long temporal reasoning remains on the host |
| Time-lapse event selection | Interesting-frame or event score | Derived candidate batch/stream workload |
| Stream content moderation | Visual content labels | Derived candidate; human review and policy enforcement remain separate |

### Audio, speech, and vibration

Audio capture, resampling, spectrogram creation, beamforming, decoding, and playback remain host tasks unless incorporated into a compatible model.

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Wake-word detection | Wake-word probability | Derived candidate based on the documented audio-classification and keyphrase families |
| Bounded voice commands | Command label | Documented keyphrase example |
| Environmental-sound classification | Sound-event label | Documented audio-classification family |
| Alarm, siren, glass-break, or smoke-alarm recognition | Event class | Derived candidate; never replace certified alarm systems |
| Baby-cry, cough, or snore event detection | Event label | Derived candidate; not medical diagnosis or safety assurance |
| Appliance-state recognition | Appliance or operating-state class | Derived candidate based on acoustic features |
| Machine acoustic anomaly detection | Normal/anomalous score | Derived candidate continuous-monitoring workload |
| Vibration-based predictive maintenance | State, fault, or remaining-life class | Derived candidate time-series workload |
| Speaker grouping or verification | Speaker embedding | Derived candidate; biometric consent and fallback required |
| Audio similarity and sound search | Audio embedding | Derived candidate; vector indexing remains on the CPU |
| Music genre, instrument, or mood tagging | Audio labels | Derived candidate classification workload |
| Voice activity detection | Speech/non-speech class | Usually better with conventional CPU methods unless part of a larger model |
| Direction-of-arrival classification | Direction class | Experimental; multichannel signal processing remains on the host |
| Speech enhancement or noise suppression | Enhanced samples or mask | Experimental; streaming and model compatibility are demanding |
| General speech-to-text | Token sequence | Usually a poor Coral fit; a separately qualified GPU speech provider can support bounded transcription while capture, decoding, timestamps, and delivery remain host work |

## Presentation and media studio

This proposed GPU composition is the canonical home for presentation review,
meeting and rehearsal analysis, multimedia transcription, captioning, archive
retrieval, and reviewable edit planning. It combines capabilities rather than
claiming that any single model decodes media, edits an office archive, or
controls the filesystem.

| Workflow | Accelerator stages | Deterministic host and user boundary |
| --- | --- | --- |
| Presentation review | Vision and language workers summarize slides, describe charts and images, find repeated or contradictory claims, propose speaker notes, and generate likely audience questions | Parse PPTX, ODP, and PDF structure; preserve slide order; bind observations to slides and source documents; keep every proposed revision editable |
| Presentation planning | A language worker turns selected grounded sources into an outline, slide plan, notes, and accessibility descriptions | A validated intermediate document owns titles, citations, and asset references; a deterministic writer may create PPTX or ODP only after explicit confirmation |
| Rehearsal or meeting briefing | Speech, vision, and language workers combine a recording with slide changes to produce a transcript, summary, decisions, tasks, questions, timing feedback, and event candidates | Preserve timestamps and slide references; distinguish suggestions from confirmed assignments; never create tasks or calendar entries silently |
| Media transcription and captions | Speech and vision workers produce timestamped speech, visible text, scene descriptions, topic boundaries, and subtitle candidates | Decode, resample, sample frames, validate timing, and render SRT or WebVTT deterministically; do not transcode through an avoidable lossy intermediate |
| Searchable media archive | Embed transcripts, selected frames, slide text, and bounded descriptions for cross-modal retrieval | The local content vault owns the persistent index and returns file, page, slide, and timestamp evidence; exact duplicates use cryptographic hashes |
| Reviewable edit planning | Language and vision workers suggest chapters, highlights, slate or take boundaries, thumbnails, and a timestamped cut list | The model never edits source media; a deterministic FFmpeg or media-engine plan is shown for review and writes a new output without overwriting the original |
| Screenshot assistant | Vision and language workers extract visible text, describe the scene, explain an error or chart, and transform or translate explicitly selected text | Capture is explicit, output is reviewable, and no UI control is activated from model output |

A daily multimedia briefing is a view over these same stages: select documents,
slides, audio, video, or images; receive one cited summary plus decisions, tasks,
and event candidates; then copy or export only the parts the user confirms.
GPU stages must share the accelerator lease, unload incompatible models between
stages, yield to interactive work, expose progress, and remain cancellable.

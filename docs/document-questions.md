# Ask selected files

Ask selected files is a manual, local workflow. It appears only when the live
plug-in inventory reports a ready external `ask-selected-files` provider with
its explicit-file grant and execution capability. A packaged template is not
treated as a usable provider.

1. Open **Profiles**, choose **Choose files**, and select 1–16 supported text,
   Markdown, PDF, or image documents.
2. Enter one question and choose **Ask**. The applet submits that question once;
   it does not install a clipboard or directory watcher and keeps no question
   history.
3. Review the answer and every mandatory `file · page · span` citation. The
   public reply includes digests and a safe basename, never source text or an
   absolute path.
4. Choose **New question** to clear the answer and selected-file metadata.

The external worker must provide a qualified BGE embedding lane and grounded
Qwen generation lane. Current production evidence covers BGE on a named Vulkan
GPU. NPU/TPU embedding ports remain possible through the same embedding
contract but are not claimed as qualified. Qwen uses GPU unless an external
provider explicitly supplies a qualified NPU lane; there is no CPU fallback.

The applet refuses malformed answers, mismatched job identities, uncited
answers, duplicate citations, invalid pages/spans, CPU-labelled results, and
providers that are not live and ready. OmniTensor's broader malicious-document,
retrieval-quality, privacy, latency, and native-device acceptance remains a
separate gate; until it passes, this workflow is available only through an
external provider that has performed equivalent qualification.

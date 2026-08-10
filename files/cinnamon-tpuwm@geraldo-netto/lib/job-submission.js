"use strict";

// Picture in, job out: the steps between a file a user picked and a job the
// runtime accepted.
//
// Decode the picture to the size the model declares, apply the model's own
// normalisation, write the raw buffer where the service is allowed to read
// from, digest it, and submit a reference to it. Every one of those is a step
// the service will not take: it decodes nothing, it reads only inside roots the
// user opted into, and it refuses a reference whose digest does not match the
// bytes it read.
//
// The staged buffer outlives the acknowledgement deliberately. The service
// re-reads and re-digests the file when it dispatches, because only the bytes
// actually read can be trusted to be the ones executed, so deleting on
// "accepted" would delete the input out from under the job. It is removed when
// the job reaches a state it cannot leave.

const Encoder = require("./tensor-encoder.js");
const Job = require("./runtime-job-contract.js");

// A subdirectory of the runtime's own input root: inside the boundary the user
// opted into, so no new permission is involved, and out of the way of the
// pictures the user drops there.
const STAGING_DIRECTORY = ".tpuwm-staged";
const STAGED_SUFFIX = ".f32";
const STAGED_FILENAME = /^[A-Za-z0-9._-]+$/u;

// Deterministic squash to the declared size, not a fit-and-crop. The contract
// states one shape and no resize policy, so the applet states its own: the
// picture is scaled to exactly the declared width and height. Upstream Caffe
// and ncnn classifier examples do the same, and a crop would silently discard
// whatever the user framed.
const PRESERVE_ASPECT_RATIO = false;

class JobStagingError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "JobStagingError";
        this.code = code;
        this.detail = detail;
        this.jobStagingRefusal = true;
    }
}

// One question — "why could this job not be submitted?" — asked of an encoder
// refusal, a staging failure, or a transport error without the caller having
// to know which layer answered.
function refusalCode(error) {
    if (error === null || typeof error !== "object") {
        return null;
    }
    return Encoder.isRefusal(error) || error.jobStagingRefusal === true
        ? error.code
        : null;
}

// Why this contract cannot become a tensor, asked without starting anything,
// so a surface can explain a profile it will not offer instead of offering it
// and refusing after the user has chosen a file.
function encodingRefusalFor(spec) {
    return Encoder.encodingRefusal(spec ?? null);
}

function requireImagePort(candidate) {
    const required = ["decode", "write", "remove", "digest"];
    if (!candidate || required.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError("An image port with decode/write/remove/digest is required");
    }
    return candidate;
}

function requireJobGateway(candidate) {
    if (!candidate
        || typeof candidate.submit !== "function"
        || typeof candidate.cancel !== "function") {
        throw new TypeError("A runtime job gateway with submit/cancel is required");
    }
    return candidate;
}

function stagedFilename(workloadId, requestId) {
    const name = `${workloadId}-${requestId}${STAGED_SUFFIX}`;
    if (!STAGED_FILENAME.test(name) || name.includes("..")) {
        // Both halves are generated here and both are already pattern-bounded,
        // so this can only fire if one of those grammars is widened later —
        // which is exactly when a staged filename would stop being a filename.
        throw new JobStagingError("staging-name-invalid", `refusing to stage as ${name}`);
    }
    return name;
}

function stagedPath(root, workloadId, requestId) {
    return `${root}/${STAGING_DIRECTORY}/${stagedFilename(workloadId, requestId)}`;
}

class JobSubmitter {
    constructor({gateway, imagePort, clock = Date}) {
        this._gateway = requireJobGateway(gateway);
        this._images = requireImagePort(imagePort);
        this._clock = clock;
        this._sequence = 0;
        this._pending = null;
    }

    // The request this submitter would issue next, so a caller can name the
    // staged file it will have to clean up.
    _nextRequestId() {
        this._sequence += 1;
        return `tpuwm-${this._clock.now()}-${this._sequence}`;
    }

    submit(request, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A job submission callback is required");
        }
        this.cancel();
        const requestId = this._nextRequestId();
        const sequence = this._sequence;
        try {
            this._stage({...request, requestId, sequence}, callback);
        } catch (error) {
            this._settle(sequence, callback, error, null);
        }
        return true;
    }

    _stage(request, callback) {
        const refusal = Encoder.encodingRefusal(request.spec);
        if (refusal !== null) {
            throw new Encoder.TensorEncodingError(refusal, Encoder.REFUSAL_KINDS[refusal]);
        }
        const path = stagedPath(request.stagingRoot, request.workloadId, request.requestId);
        this._pending = {sequence: request.sequence, path};
        this._images.decode(
            request.sourcePath,
            Encoder.targetGeometry(request.spec),
            (error, image) => this._encoded(request, callback, error, image),
        );
    }

    _encoded(request, callback, error, image) {
        if (this._pending === null || this._pending.sequence !== request.sequence) {
            return false;
        }
        if (error) {
            this._settle(request.sequence, callback, decodeFailure(error), null);
            return true;
        }
        try {
            this._write(request, callback, image);
        } catch (encodeError) {
            this._settle(request.sequence, callback, encodeError, null);
        }
        return true;
    }

    _write(request, callback, image) {
        const bytes = Encoder.tensorBytes(Encoder.encodeTensor(image, request.spec));
        const path = this._pending.path;
        this._images.write(path, bytes, (error) => {
            if (error) {
                this._settle(request.sequence, callback, writeFailure(error), null);
                return;
            }
            this._send(request, callback, path, bytes);
        });
    }

    _send(request, callback, path, bytes) {
        if (this._pending === null || this._pending.sequence !== request.sequence) {
            return false;
        }
        const submission = Job.jobSubmission({
            requestId: request.requestId,
            workloadId: request.workloadId,
            references: [{
                path,
                shape: [...request.spec.shape],
                dtype: "float32",
                sha256: this._images.digest(bytes),
            }],
        });
        this._gateway.submit(submission, (error, acknowledgement) => {
            this._settle(request.sequence, callback, error, acknowledgement, path);
        });
        return true;
    }

    _stagedFor(path) {
        if (path !== null) {
            return path;
        }
        return this._pending === null ? null : this._pending.path;
    }

    // A submission that never reached the runtime leaves nothing behind: the
    // staged buffer exists only to be read by a job, and no job will read this
    // one. A submission that was accepted keeps its buffer, because the job
    // still has to read it.
    _settle(sequence, callback, error, acknowledgement, path = null) {
        if (this._pending !== null && this._pending.sequence !== sequence) {
            return false;
        }
        const staged = this._stagedFor(path);
        this._pending = null;
        if (error === null) {
            callback(null, {...acknowledgement, stagedPath: staged});
            return true;
        }
        this.discard(staged);
        callback(error, null);
        return true;
    }

    discard(path) {
        if (typeof path !== "string") {
            return false;
        }
        try {
            return this._images.remove(path);
        } catch {
            // A buffer that cannot be removed is litter in a directory the user
            // owns, not a failure of the job that produced it.
            return false;
        }
    }

    cancel() {
        const pending = this._pending;
        if (pending === null) {
            return false;
        }
        this._pending = null;
        this._sequence += 1;
        this._gateway.cancel();
        this.discard(pending.path);
        return true;
    }
}

function decodeFailure(error) {
    return new JobStagingError("image-decode-failed", `the picture could not be read: ${error}`);
}

function writeFailure(error) {
    return new JobStagingError(
        "staging-write-failed",
        `the input buffer could not be written: ${error}`,
    );
}

module.exports = {
    JobStagingError,
    JobSubmitter,
    PRESERVE_ASPECT_RATIO,
    STAGED_SUFFIX,
    STAGING_DIRECTORY,
    decodeFailure,
    encodingRefusalFor,
    refusalCode,
    requireImagePort,
    requireJobGateway,
    stagedFilename,
    stagedPath,
    writeFailure,
};

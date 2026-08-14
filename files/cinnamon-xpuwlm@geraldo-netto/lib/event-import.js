"use strict";

// Application boundary for one explicitly invoked event import. Source bytes
// remain behind the OmniTensor worker boundary: this module keeps only paths
// the chooser returned, display names, grounded evidence addresses, and human
// decisions. Nothing here is part of the public runtime snapshot.

const {EventImportError} = require("./event-import-error.js");
const I18n = require("./i18n.js");
const IcsExport = require("./ics-export.js");
const Job = require("./runtime-job-contract.js");
const Paths = require("./path-port.js");
const Validation = require("./validation.js");

const {_, format} = I18n;

const {
    confirmedIcs,
    exportRefusal,
    foldIcsLine,
    icsDateProperty,
    isNamedTimezone,
    utf8Width,
} = IcsExport;

const EVENT_PROFILE_ID = "event-extraction";
const MAX_SOURCES = 32;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_EVENTS = 64;
const MAX_EVIDENCE = 16;
const MAX_POLLS = 600;
const POLL_INTERVAL_MS = 500;
const SOURCE_SUFFIXES = Object.freeze([
    ".ics", ".jpeg", ".jpg", ".md", ".pdf", ".png", ".txt", ".webp",
]);
const {DIGEST, REQUEST_ID} = Validation;
const PRIVATE_REFERENCE = /^private:[A-Za-z0-9._:-]{1,200}$/u;
const CODE = /^[a-z0-9-]{1,64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/u;
const SOURCE_NUMBER = /:source:(\d+)(?::page:\d+)?$/u;
const EVENT_FIELDS = new Set([
    "candidateId", "title", "start", "end", "timezone", "location", "confirmation", "evidence",
]);
const EVIDENCE_FIELDS = new Set([
    "sourceRef", "sourceSha256", "page", "span", "textSha256",
]);
const SPAN_FIELDS = new Set(["start", "end"]);
const RESULT_FIELDS = new Set([
    "version", "requestId", "outcome", "code", "detail", "duplicatePolicy", "confirmationState", "events",
]);

const isRecord = Validation.isRecord;
const exactRecord = Validation.exactKeys;
const boundedText = Validation.boundedText;

function suffixOf(path) {
    const lowered = String(path).toLowerCase();
    return SOURCE_SUFFIXES.find((suffix) => lowered.endsWith(suffix)) || "";
}

function isSupportedSourceName(path, pathPort = Paths.POSIX_PATHS) {
    return suffixOf(path) !== ""
        && !Paths.requirePathPort(pathPort).basename(path).startsWith(".");
}

function hasSourceIdentity(candidate, pathPort = Paths.POSIX_PATHS) {
    return isRecord(candidate)
        && Paths.requirePathPort(pathPort).isSafeAbsolute(candidate.path)
        && boundedText(candidate.name, 1, 255)
        && pathPort.isSafeName(candidate.name);
}

function hasSourceKind(candidate) {
    return candidate.regular === true
        && candidate.symlink !== true
        && Number.isInteger(candidate.size)
        && candidate.size >= 1
        && candidate.size <= MAX_SOURCE_BYTES;
}

function sourceItem(candidate, pathPort = Paths.POSIX_PATHS) {
    if (!hasSourceIdentity(candidate, pathPort)
        || !hasSourceKind(candidate)
        || !isSupportedSourceName(candidate.path, pathPort)) {
        throw new EventImportError("source-invalid", "choose supported non-empty regular files");
    }
    return Object.freeze({
        path: candidate.path,
        name: candidate.name,
        size: candidate.size,
        regular: true,
        symlink: false,
    });
}

function selectedSources(candidates, pathPort = Paths.POSIX_PATHS) {
    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_SOURCES) {
        throw new EventImportError("sources-invalid", `choose 1-${MAX_SOURCES} source files`);
    }
    const sources = candidates.map((candidate) => sourceItem(candidate, pathPort));
    if (new Set(sources.map((source) => source.path)).size !== sources.length) {
        throw new EventImportError("source-duplicate", "the same source was selected twice");
    }
    return Object.freeze(sources);
}

function validDate(value, nullable = false) {
    if (nullable && value === null) {
        return true;
    }
    return boundedText(value, 16, 35) && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function validEvidence(candidate) {
    return validEvidenceIdentity(candidate)
        && validEvidenceLocation(candidate)
        && DIGEST.test(candidate.textSha256);
}

function validEvidenceIdentity(candidate) {
    return exactRecord(candidate, EVIDENCE_FIELDS)
        && PRIVATE_REFERENCE.test(candidate.sourceRef)
        && DIGEST.test(candidate.sourceSha256);
}

function validEvidenceLocation(candidate) {
    return (candidate.page === null || validPage(candidate.page))
        && validSpan(candidate.span);
}

function validPage(page) {
    return Number.isInteger(page) && page >= 1 && page <= 2000;
}

function validSpan(span) {
    return exactRecord(span, SPAN_FIELDS)
        && Number.isInteger(span.start)
        && Number.isInteger(span.end)
        && span.start >= 0
        && span.end > span.start
        && span.end <= 5_000_000;
}

function validEvent(candidate) {
    return validEventIdentity(candidate)
        && validEventSchedule(candidate)
        && validEventEvidence(candidate);
}

function validEventIdentity(candidate) {
    return exactRecord(candidate, EVENT_FIELDS)
        && REQUEST_ID.test(candidate.candidateId)
        && boundedText(candidate.title, 1, 200);
}

function validEventSchedule(candidate) {
    return validDate(candidate.start)
        && validDate(candidate.end, true)
        && isNamedTimezone(candidate.timezone)
        && (candidate.location === null || boundedText(candidate.location, 1, 200))
        && candidate.confirmation === "pending";
}

function validEventEvidence(candidate) {
    return Array.isArray(candidate.evidence)
        && candidate.evidence.length >= 1
        && candidate.evidence.length <= MAX_EVIDENCE
        && candidate.evidence.every(validEvidence);
}

function duplicateKey(candidate) {
    const normalized = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
    return JSON.stringify([normalized(candidate.title), candidate.start, normalized(candidate.location)]);
}

function copyEvidence(evidence) {
    return evidence.map((item) => ({...item, span: {...item.span}}));
}

function copyCandidate(candidate) {
    return {...candidate, evidence: copyEvidence(candidate.evidence)};
}

function dedupeCandidates(candidates) {
    const seen = new Set();
    const kept = [];
    for (const candidate of candidates) {
        const key = duplicateKey(candidate);
        if (!seen.has(key)) {
            seen.add(key);
            kept.push(copyCandidate(candidate));
        }
    }
    return {candidates: kept, dropped: candidates.length - kept.length};
}

function groundedEventResult(document, expectedJobId) {
    if (!validResultEnvelope(document, expectedJobId)
        || !validResultEvents(document)) {
        throw new EventImportError("result-invalid", "event result does not match version 1");
    }
    if (!consistentResultState(document)) {
        throw new EventImportError("result-invalid", "event result state is inconsistent");
    }
    if (!uniqueCandidateIds(document.events)) {
        throw new EventImportError("result-invalid", "candidate identifiers must be unique");
    }
    const deduped = dedupeCandidates(document.events);
    return {
        outcome: document.outcome,
        code: document.code,
        detail: document.detail,
        candidates: deduped.candidates,
        duplicatesDropped: deduped.dropped,
    };
}

function validResultEnvelope(document, expectedJobId) {
    return exactRecord(document, RESULT_FIELDS)
        && document.version === 1
        && document.requestId === expectedJobId
        && REQUEST_ID.test(document.requestId)
        && validResultReport(document);
}

function validResultReport(document) {
    return ["succeeded", "partial", "refused"].includes(document.outcome)
        && CODE.test(document.code)
        && boundedText(document.detail, 0, 500)
        && document.duplicatePolicy === "keep-first-title-start-location"
        && ["pending", "refused"].includes(document.confirmationState);
}

function validResultEvents(document) {
    return Array.isArray(document.events)
        && document.events.length <= MAX_EVENTS
        && document.events.every(validEvent);
}

function consistentResultState(document) {
    const refused = document.outcome === "refused";
    return refused === (document.confirmationState === "refused")
        && (!refused || document.events.length === 0);
}

function uniqueCandidateIds(candidates) {
    const ids = candidates.map((candidate) => candidate.candidateId);
    return new Set(ids).size === ids.length;
}

function sourceLabel(evidence, sources) {
    const matched = SOURCE_NUMBER.exec(evidence.sourceRef);
    const index = matched === null ? -1 : Number(matched[1]) - 1;
    return index >= 0 && index < sources.length ? sources[index].name : "Selected source";
}

function eventSubmission(requestId, sources, pathPort = Paths.POSIX_PATHS) {
    const submission = {
        version: Job.JOB_VERSION,
        requestId,
        workloadId: EVENT_PROFILE_ID,
        payload: {sources: selectedSources(sources, pathPort).map((source) => source.path)},
    };
    if (!Job.isJobSubmission(submission)) {
        throw new EventImportError("request-invalid", "event submission is invalid");
    }
    return submission;
}

function editedCandidate(candidate, patch) {
    const allowed = new Set(["title", "start", "end", "timezone", "location"]);
    if (!isRecord(patch) || Object.keys(patch).some((name) => !allowed.has(name))) {
        throw new EventImportError("edit-invalid", "event edit fields are invalid");
    }
    const edited = {...candidate, ...patch, confirmation: "pending"};
    if (!validEvent(edited)) {
        throw new EventImportError("edit-invalid", "edited event is invalid");
    }
    return copyCandidate(edited);
}

function decidedCandidate(candidate, decision) {
    if (!["confirmed", "rejected"].includes(decision)) {
        throw new EventImportError("decision-invalid", "event decision is invalid");
    }
    return {...copyCandidate(candidate), confirmation: decision};
}

function requirePort(candidate, methods, label) {
    if (!candidate || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError(`${label} with ${methods.join("/")} is required`);
    }
    return candidate;
}

function initialState() {
    return {
        available: false,
        availabilityDetail: _("Event provider is not ready"),
        phase: "idle",
        selectionKind: "",
        sources: [],
        jobId: "",
        progress: null,
        message: "",
        candidates: [],
        duplicatesDropped: 0,
        exportedPath: "",
    };
}

function cloneState(state) {
    return {
        ...state,
        sources: state.sources.map((source) => ({...source})),
        progress: state.progress === null ? null : {...state.progress},
        candidates: state.candidates.map(copyCandidate),
    };
}

class EventImportController {
    constructor({picker, gateway, exporter, scheduler, clock = Date, paths = Paths.POSIX_PATHS}) {
        this._picker = requirePort(picker, ["chooseFiles", "chooseFolder"], "Event source picker");
        this._gateway = requirePort(
            gateway,
            ["submit", "requestResult", "cancelJob", "cancel"],
            "Event job gateway",
        );
        this._exporter = requirePort(exporter, ["saveIcs"], "Event exporter");
        this._scheduler = requirePort(scheduler, ["schedule", "cancel"], "Event scheduler");
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError("Event clock is required");
        }
        this._clock = clock;
        this._paths = Paths.requirePathPort(paths);
        this._sequence = 0;
        this._polls = 0;
        this._pollHandle = null;
        this._state = initialState();
        this._listeners = new Set();
        this._disposed = false;
    }

    state() {
        return cloneState(this._state);
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Event import listener is required");
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    setAvailability(available, detail = "") {
        const next = available === true;
        const text = boundedText(detail, 0, 240) ? detail : "";
        if (this._state.available === next && this._state.availabilityDetail === text) {
            return false;
        }
        this._replace({available: next, availabilityDetail: text});
        return true;
    }

    chooseFiles() {
        return this._choose("files", this._picker.chooseFiles.bind(this._picker));
    }

    chooseFolder() {
        return this._choose("folder", this._picker.chooseFolder.bind(this._picker));
    }

    _choose(kind, choose) {
        this._ensureActive();
        if (!this._state.available || ["submitting", "running", "cancelling", "exporting"].includes(this._state.phase)) {
            return false;
        }
        const sequence = this._nextSequence();
        this._replace({phase: "selecting", selectionKind: kind, message: "", exportedPath: ""});
        try {
            choose((error, sources) => this._selected(sequence, error, sources));
        } catch (error) {
            this._selected(sequence, error, null);
        }
        return true;
    }

    _selected(sequence, error, candidates) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (Array.isArray(candidates) && candidates.length === 0) {
            this._replace({phase: "idle", selectionKind: "", message: _("Selection cancelled")});
            return true;
        }
        try {
            const sources = selectedSources(candidates, this._paths);
            this._replace({phase: "selected", sources: [...sources], message: _("Sources selected")});
            return true;
        } catch (selectionError) {
            return this._fail(selectionError.detail || String(selectionError));
        }
    }

    start() {
        this._ensureActive();
        if (!this._state.available || this._state.phase !== "selected") {
            return false;
        }
        const sequence = this._nextSequence();
        const requestId = `xpuwlm-event-${this._clock.now()}-${sequence}`;
        const submission = eventSubmission(requestId, this._state.sources, this._paths);
        this._replace({phase: "submitting", message: _("Submitting selected files…"), progress: null});
        try {
            this._gateway.submit(submission, (error, reply) => this._accepted(sequence, error, reply));
        } catch (error) {
            this._accepted(sequence, error, null);
        }
        return true;
    }

    _accepted(sequence, error, acknowledgement) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (!acknowledgement || acknowledgement.status !== "accepted" || !acknowledgement.jobId) {
            return this._fail(acknowledgement?.message || _("Runtime rejected event extraction"));
        }
        this._polls = 0;
        this._replace({
            phase: "running",
            jobId: acknowledgement.jobId,
            message: acknowledgement.message,
            progress: {fraction: 0, detail: _("Queued")},
        });
        this._schedulePoll(sequence);
        return true;
    }

    _schedulePoll(sequence) {
        this._pollHandle = this._scheduler.schedule(POLL_INTERVAL_MS, () => {
            this._pollHandle = null;
            this._poll(sequence);
        });
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail(_("Runtime did not report an event result"));
        }
        const requestId = `xpuwlm-event-poll-${this._clock.now()}-${this._polls}`;
        try {
            this._gateway.requestResult(
                {requestId, jobId: this._state.jobId},
                (error, result) => this._result(sequence, error, result),
            );
        } catch (error) {
            this._result(sequence, error, null);
        }
        return true;
    }

    _result(sequence, error, result) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        if (error) {
            this._schedulePoll(sequence);
            return false;
        }
        if (result.state === "running") {
            return this._runningResult(sequence, result);
        }
        if (result.state !== "succeeded") {
            return this._fail(result.message || format(_("Event extraction %s"), result.state));
        }
        return this._completedResult(result);
    }

    _runningResult(sequence, result) {
        this._replace({progress: result.progress || this._state.progress, message: result.message});
        this._schedulePoll(sequence);
        return true;
    }

    _completedResult(result) {
        try {
            const parsed = groundedEventResult(result.output, result.jobId);
            if (parsed.outcome === "refused") {
                return this._fail(parsed.detail || parsed.code);
            }
            this._replace({
                phase: "preview",
                progress: {fraction: 1, detail: _("Preview ready")},
                message: parsed.detail,
                candidates: parsed.candidates,
                duplicatesDropped: parsed.duplicatesDropped,
            });
            return true;
        } catch (parseError) {
            return this._fail(parseError.detail || String(parseError));
        }
    }

    cancel() {
        this._ensureActive();
        if (!["submitting", "running"].includes(this._state.phase)) {
            return false;
        }
        this._clearPoll();
        const sequence = this._nextSequence();
        const jobId = this._state.jobId;
        this._replace({phase: "cancelling", message: _("Cancelling event extraction…")});
        if (jobId === "") {
            this._gateway.cancel();
            this._cancelled(sequence, null);
            return true;
        }
        const requestId = `xpuwlm-event-cancel-${this._clock.now()}-${sequence}`;
        try {
            this._gateway.cancelJob(
                {requestId, jobId},
                (error) => this._cancelled(sequence, error),
            );
        } catch (error) {
            this._cancelled(sequence, error);
        }
        return true;
    }

    _cancelled(sequence, error) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        this._replace({phase: "selected", jobId: "", progress: null, message: _("Event extraction cancelled")});
        return true;
    }

    edit(candidateId, patch) {
        this._ensureActive();
        if (this._state.phase !== "preview") {
            return false;
        }
        const index = this._candidateIndex(candidateId);
        if (index < 0) {
            return false;
        }
        try {
            const candidates = this._state.candidates.map(copyCandidate);
            candidates[index] = editedCandidate(candidates[index], patch);
            const deduped = dedupeCandidates(candidates);
            this._replace({
                candidates: deduped.candidates,
                duplicatesDropped: this._state.duplicatesDropped + deduped.dropped,
                message: deduped.dropped > 0 ? _("Duplicate event removed") : _("Event updated"),
            });
            return true;
        } catch (error) {
            return this._fail(error.detail || String(error), "preview");
        }
    }

    decide(candidateId, decision) {
        this._ensureActive();
        if (this._state.phase !== "preview") {
            return false;
        }
        const index = this._candidateIndex(candidateId);
        if (index < 0) {
            return false;
        }
        const candidates = this._state.candidates.map(copyCandidate);
        candidates[index] = decidedCandidate(candidates[index], decision);
        this._replace({candidates, message: _("Decision recorded")});
        return true;
    }

    beginExport() {
        this._ensureActive();
        if (this._state.phase !== "preview") {
            return false;
        }
        const refusal = exportRefusal(this._state.candidates);
        if (refusal !== "") {
            return this._fail(refusal, "preview");
        }
        this._replace({phase: "confirm-export", message: _("Confirm before writing the calendar file")});
        return true;
    }

    backToPreview() {
        this._ensureActive();
        if (this._state.phase !== "confirm-export") {
            return false;
        }
        this._replace({phase: "preview", message: _("Export not written")});
        return true;
    }

    confirmExport() {
        this._ensureActive();
        if (this._state.phase !== "confirm-export") {
            return false;
        }
        let calendar;
        try {
            calendar = confirmedIcs(this._state.candidates);
        } catch (error) {
            return this._fail(error.detail || String(error), "preview");
        }
        const sequence = this._nextSequence();
        this._replace({phase: "exporting", message: _("Choose a new calendar file…")});
        try {
            this._exporter.saveIcs(
                calendar,
                this._state.sources.map((source) => source.path),
                (error, path) => this._exported(sequence, error, path),
            );
        } catch (error) {
            this._exported(sequence, error, null);
        }
        return true;
    }

    _exported(sequence, error, path) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error), "preview");
        }
        if (!boundedText(path, 1, 4096)) {
            return this._fail(_("Calendar export was cancelled"), "preview");
        }
        this._replace({phase: "complete", exportedPath: path, message: _("Calendar file written")});
        return true;
    }

    reset() {
        this._ensureActive();
        if (["submitting", "running", "cancelling", "exporting"].includes(this._state.phase)) {
            return false;
        }
        const availability = {
            available: this._state.available,
            availabilityDetail: this._state.availabilityDetail,
        };
        this._state = {...initialState(), ...availability};
        this._publish();
        return true;
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        this._nextSequence();
        this._clearPoll();
        this._gateway.cancel();
        this._listeners.clear();
        return true;
    }

    _candidateIndex(candidateId) {
        return this._state.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
    }

    _replace(patch) {
        this._state = {...this._state, ...patch};
        this._publish();
    }

    _fail(message, phase = "error") {
        this._clearPoll();
        this._replace({phase, message: boundedText(message, 1, 500) ? message : _("Event import failed")});
        return false;
    }

    _publish() {
        for (const listener of this._listeners) {
            try {
                listener(this.state());
            } catch {
                // A view subscriber cannot unwind a transport or scheduler callback.
            }
        }
    }

    _nextSequence() {
        this._sequence += 1;
        return this._sequence;
    }

    _current(sequence) {
        return !this._disposed && sequence === this._sequence;
    }

    _clearPoll() {
        if (this._pollHandle === null) {
            return false;
        }
        this._scheduler.cancel(this._pollHandle);
        this._pollHandle = null;
        return true;
    }

    _ensureActive() {
        if (this._disposed) {
            throw new Error("Event import controller is disposed");
        }
    }
}

module.exports = {
    CODE,
    DIGEST,
    EVENT_PROFILE_ID,
    EventImportController,
    EventImportError,
    MAX_EVENTS,
    MAX_EVIDENCE,
    MAX_POLLS,
    MAX_SOURCES,
    MAX_SOURCE_BYTES,
    POLL_INTERVAL_MS,
    PRIVATE_REFERENCE,
    REQUEST_ID,
    SOURCE_SUFFIXES,
    confirmedIcs,
    dedupeCandidates,
    decidedCandidate,
    duplicateKey,
    editedCandidate,
    eventSubmission,
    exactRecord,
    exportRefusal,
    foldIcsLine,
    groundedEventResult,
    initialState,
    icsDateProperty,
    isRecord,
    isNamedTimezone,
    isSupportedSourceName,
    selectedSources,
    sourceItem,
    sourceLabel,
    suffixOf,
    utf8Width,
    validDate,
    validEvent,
    validEvidence,
};

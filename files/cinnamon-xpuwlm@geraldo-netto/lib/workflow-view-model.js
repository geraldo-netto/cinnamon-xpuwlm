"use strict";

const DocumentQuestion = require("./document-question.js");
const EventImport = require("./event-import.js");
const FileOrganizer = require("./file-organizer.js");
const I18n = require("./i18n.js");
const Job = require("./runtime-job-contract.js");
const MediaTranscription = require("./media-transcription.js");
const SelectedText = require("./selected-text.js");

const {_, N_, format, ngettext} = I18n;

const MAX_RUN_PICTURES = 24;
const MAX_READING_ROWS = 5;
const RUN_TITLE = N_("Analyze a picture");
const NO_ROOTS_TEXT = N_("The runtime service is not configured to read input files, so no picture can be submitted");
const NO_RUNNABLE_TEXT = N_("No installed profile states what input it needs, so no picture can be prepared");
const NONE_SERVING_TEXT = N_("No profile that accepts a picture can serve right now; Diagnostics says why");
// A profile the same popup reports as paused, disabled, or unavailable will
// refuse every job it is given. Offering it a picture anyway spends a decode,
// a staged buffer, and a bus call to learn what the row above already said.
const SERVING_STATUSES = new Set(["healthy", "running", "watching", "idle"]);
const EMPTY_ROOT_TEXT = N_("Put a picture in %s and it will be listed here");

function runReason(declared, serving, inputs) {
    if (inputs.roots.length === 0) {
        return _(NO_ROOTS_TEXT);
    }
    if (declared.length === 0) {
        return _(NO_RUNNABLE_TEXT);
    }
    if (serving.length === 0) {
        // The profile can accept a picture and cannot act on one: a different
        // fact from declaring no input, and a different remedy.
        return _(NONE_SERVING_TEXT);
    }
    return inputs.pictures.length === 0
        ? format(_(EMPTY_ROOT_TEXT), inputs.roots[0])
        : "";
}

function canServe(profile) {
    return SERVING_STATUSES.has(profile.status) && profile.enabled !== false;
}

// What the runtime says became of the job, in the words a user reads. `unknown`
// answers both a job that never existed and one belonging to another caller,
// so it is worded as an absence rather than as a failure.
const JOB_STATE_LABELS = Object.freeze({
    running: N_("Running"),
    succeeded: N_("Finished"),
    failed: N_("Failed"),
    cancelled: N_("Cancelled"),
    unknown: N_("No longer known to the runtime"),
});

// A job that was accepted has not succeeded, and saying otherwise is the whole
// defect this surface removes: the acknowledgement is a receipt, and only a
// terminal state is an outcome.
const ATTENTION_STATES = new Set(["failed", "cancelled", "unknown"]);

function jobTone(job) {
    if (job.pending === true || job.state === "running") {
        return "pending";
    }
    if (ATTENTION_STATES.has(job.state)) {
        return "attention";
    }
    if (job.state === "succeeded") {
        return "normal";
    }
    return job.status === "accepted" ? "normal" : "attention";
}

function jobStateText(job) {
    const label = JOB_STATE_LABELS[job.state];
    return label === undefined ? "" : _(label);
}

function progressText(progress) {
    if (!progress || !Number.isFinite(progress.fraction)) {
        return "";
    }
    const percent = `${Math.round(progress.fraction * 100)}%`;
    return progress.detail ? `${percent} · ${progress.detail}` : percent;
}

// The reading is the point of running the job at all. An index with no label is
// printed as an index: the runtime reports names only where a labels file was
// installed and digest-verified beside the weights, and inventing one here
// would be wrong in a form that reads as right.
function readingEntryText(entry) {
    const score = entry.score.toFixed(3);
    return entry.label === undefined
        ? format(_("class %d · %s"), entry.index, score)
        : `${entry.label} · ${score}`;
}

function forecastReadingText(reading) {
    const horizon = format(
        ngettext("%d observation ahead", "%d observations ahead", reading.horizon),
        reading.horizon,
    );
    return format(
        _("Forecast · %s · %s · %s"),
        reading.targetFeature,
        horizon,
        String(reading.value),
    );
}

function readingModel(reading) {
    const forecast = Job.forecastReadingOf(reading);
    if (forecast !== null) {
        return {kind: forecast.kind, entries: [forecastReadingText(forecast)]};
    }
    if (reading?.kind !== "classification") {
        return null;
    }
    return {
        kind: reading.kind,
        entries: reading.top.slice(0, MAX_READING_ROWS).map(readingEntryText),
    };
}

function jobModel(job, profiles) {
    if (!job?.profileId) {
        return null;
    }
    const profile = profiles.find((candidate) => candidate.id === job.profileId)
        || {title: job.profileId};
    const optionalText = (value) => typeof value === "string" ? value : "";
    return {
        pending: job.pending === true,
        state: optionalText(job.state),
        status: optionalText(job.status),
        title: profile.title,
        sourceName: optionalText(job.sourceName),
        message: optionalText(job.message),
        jobId: optionalText(job.jobId),
        tone: jobTone(job),
        stateText: jobStateText(job),
        progressText: progressText(job.progress),
        reading: readingModel(job.reading),
    };
}

const TOOL_SPECS = Object.freeze([
    Object.freeze({
        id: "documents",
        detail: "documents",
        icon: "folder-documents-symbolic",
        title: N_("Ask documents"),
        description: N_("Choose files and ask a grounded question"),
        workflow: "documentQuestion",
    }),
    Object.freeze({
        id: "events",
        detail: "events",
        icon: "x-office-calendar-symbolic",
        title: N_("Extract calendar events"),
        description: N_("Review events before exporting"),
        workflow: "eventImport",
    }),
    Object.freeze({
        id: "text",
        detail: "text",
        icon: "edit-select-all-symbolic",
        title: N_("Work with selected text"),
        description: N_("Explain, summarize, rewrite, or translate"),
        workflow: "selectedText",
    }),
    Object.freeze({
        id: "organizer",
        detail: "organizer",
        icon: "folder-symbolic",
        title: N_("Organize files"),
        description: N_("Review suggestions; files are never changed"),
        workflow: "fileOrganizer",
    }),
    Object.freeze({
        id: "media",
        detail: "media",
        icon: "audio-x-generic-symbolic",
        title: N_("Transcribe media"),
        description: N_("Speech, document pages, visible text, scenes, and slides"),
        workflow: "mediaTranscription",
    }),
]);

const ACTIVE_WORKFLOW_PHASES = new Set([
    "selecting", "submitting", "running", "cancelling", "exporting",
]);
const REVIEW_WORKFLOW_PHASES = new Set(["preview", "confirm-export"]);
const RECENT_WORKFLOW_PHASES = new Set(["complete", "error"]);

function toolModels(state, workflows, run) {
    return TOOL_SPECS.map((spec) => toolModel(spec, state, workflows, run));
}

function toolStatus(available, working) {
    if (working) {
        return {text: _("Working"), tone: "running"};
    }
    return available
        ? {text: _("Ready"), tone: "healthy"}
        : {text: _("Unavailable"), tone: "unavailable"};
}

function workflowPhase(workflow) {
    return workflow && typeof workflow.phase === "string" ? workflow.phase : "idle";
}

function workflowAvailable(workflow) {
    return Boolean(workflow?.available === true);
}

function workflowAvailabilityDetail(workflow) {
    return workflow && typeof workflow.availabilityDetail === "string"
        ? workflow.availabilityDetail
        : "";
}

function usesLegacyPictureReadiness(spec, state) {
    // Older persisted/test state predates this workflow. Preserve its former
    // picture readiness only until the live controller publishes a state.
    return spec.workflow === null
        || (spec.workflow === "mediaTranscription" && state[spec.workflow] === undefined);
}

function toolModel(spec, state, workflows, run) {
    const picture = usesLegacyPictureReadiness(spec, state);
    const workflow = picture ? null : state[spec.workflow];
    const pictureReady = run.roots.length > 0 && run.profiles.length > 0;
    const available = picture ? pictureReady : workflowAvailable(workflow);
    const phase = workflowPhase(workflow);
    const status = toolStatus(available, ACTIVE_WORKFLOW_PHASES.has(phase));
    return {
        id: spec.id,
        detail: spec.detail,
        icon: spec.icon,
        title: _(spec.title),
        description: _(spec.description),
        available,
        enabled: available || phase !== "idle",
        phase,
        status: status.text,
        statusTone: status.tone,
        setupDetail: picture ? run.reason : workflowAvailabilityDetail(workflow),
        projected: picture ? run : workflows[spec.workflow],
    };
}

function workflowActivity(id, title, workflow) {
    if (workflow === null || workflow === undefined) {
        return null;
    }
    const phase = workflow.phase || "idle";
    if (ACTIVE_WORKFLOW_PHASES.has(phase)) {
        return runningWorkflowActivity(id, title, workflow);
    }
    if (REVIEW_WORKFLOW_PHASES.has(phase)) {
        return reviewWorkflowActivity(id, title, workflow);
    }
    if (!RECENT_WORKFLOW_PHASES.has(phase)) {
        return null;
    }
    return recentWorkflowActivity(id, title, workflow);
}

function runningWorkflowActivity(id, title, workflow) {
    return {
        id, title,
        detail: workflow.progressText || workflow.message || _("Work in progress"),
        status: _("Running"), tone: "running", kind: "running",
    };
}

function reviewWorkflowActivity(id, title, workflow) {
    return {
        id, title,
        detail: workflow.message || _("Review required before continuing"),
        status: _("Review"), tone: "watching", kind: "running",
    };
}

function recentWorkflowActivity(id, title, workflow) {
    const complete = workflow.phase === "complete";
    return {
        id, title,
        detail: workflow.message || (complete ? _("Finished") : _("Could not finish")),
        status: complete ? _("Finished") : _("Failed"),
        tone: complete ? "healthy" : "unavailable", kind: "recent",
    };
}

function jobActivity(job) {
    if (job === null) {
        return null;
    }
    const running = job.pending || job.state === "running";
    const status = running ? _("Running") : (job.stateText || _("Submitted"));
    let tone = "healthy";
    if (running) {
        tone = "running";
    } else if (job.tone === "attention") {
        tone = "unavailable";
    }
    return {
        id: "picture-job",
        title: job.title,
        detail: [job.sourceName, job.message, job.progressText].filter(Boolean).join(" · "),
        status,
        tone,
        kind: running ? "running" : "recent",
    };
}

function activityModel(state, workflows, run) {
    const items = [
        workflowActivity("documents", _("Ask documents"), workflows.documentQuestion),
        workflowActivity("events", _("Extract calendar events"), workflows.eventImport),
        workflowActivity("text", _("Work with selected text"), workflows.selectedText),
        workflowActivity("organizer", _("Organize files"), workflows.fileOrganizer),
        workflowActivity("media", _("Transcribe media"), workflows.mediaTranscription),
        jobActivity(run.job),
    ].filter(Boolean);
    const running = items.filter((item) => item.kind === "running");
    const recent = items.filter((item) => item.kind === "recent");
    const reportedRunning = Number.isInteger(state.metrics?.runningProfiles)
        ? state.metrics.runningProfiles
        : 0;
    const otherRunning = Math.max(0, reportedRunning - running.length);
    if (otherRunning > 0) {
        running.push({
            id: "runtime-workloads",
            title: ngettext("Runtime workload", "Runtime workloads", otherRunning),
            detail: format(
                ngettext("%d workload reported by the runtime", "%d workloads reported by the runtime", otherRunning),
                otherRunning,
            ),
            status: _("Running"),
            tone: "running",
            kind: "running",
        });
    }
    return {
        running,
        recent,
        activeCount: Math.max(reportedRunning, running.length),
        canClear: recent.length > 0,
    };
}

function omittedCount(inputs) {
    const listed = Array.isArray(inputs.pictures) ? inputs.pictures.length : 0;
    const trimmed = Math.max(0, listed - MAX_RUN_PICTURES);
    return trimmed + (Number.isInteger(inputs.omitted) ? inputs.omitted : 0);
}

function runModel(state) {
    const inputs = state.inputs || {roots: [], pictures: [], runnable: [], omitted: 0};
    const runnableIds = new Set(inputs.runnable || []);
    const declared = state.profiles.filter((profile) => runnableIds.has(profile.id));
    const serving = declared.filter(canServe);
    return {
        title: _(RUN_TITLE),
        reason: runReason(declared, serving, inputs),
        roots: [...inputs.roots],
        profiles: serving.map((profile) => ({id: profile.id, title: profile.title})),
        pictures: inputs.pictures.slice(0, MAX_RUN_PICTURES).map((picture) => ({...picture})),
        omitted: omittedCount(inputs),
        job: jobModel(state.job, state.profiles),
    };
}

function evidenceText(evidence, sources) {
    const page = evidence.page === null ? "" : format(_(" · page %d"), evidence.page);
    return format(
        _("Evidence: %s%s · characters %d–%d"),
        EventImport.sourceLabel(evidence, sources),
        page,
        evidence.span.start,
        evidence.span.end,
    );
}

function eventCandidateModel(candidate, sources) {
    return {
        ...candidate,
        endText: candidate.end === null ? "" : candidate.end,
        locationText: candidate.location === null ? "" : candidate.location,
        evidenceText: candidate.evidence.map((evidence) => evidenceText(evidence, sources)),
        kept: candidate.confirmation === "confirmed",
        rejected: candidate.confirmation === "rejected",
    };
}

function eventImportModel(state) {
    const workflow = state.eventImport;
    if (workflow === null || workflow === undefined) {
        return null;
    }
    const visible = workflow.available === true || workflow.phase !== "idle" || workflow.message !== "";
    if (!visible) {
        return null;
    }
    const candidates = workflow.candidates.map(
        (candidate) => eventCandidateModel(candidate, workflow.sources),
    );
    const confirmed = candidates.filter((candidate) => candidate.kept).length;
    const rejected = candidates.filter((candidate) => candidate.rejected).length;
    return {
        ...workflow,
        title: _("Extract calendar events"),
        chooserEnabled: workflow.available === true
            && !["selecting", "submitting", "running", "cancelling", "exporting"].includes(workflow.phase),
        startEnabled: workflow.available === true && workflow.phase === "selected",
        cancelEnabled: ["submitting", "running"].includes(workflow.phase),
        preview: ["preview", "exporting"].includes(workflow.phase),
        confirmation: workflow.phase === "confirm-export",
        complete: workflow.phase === "complete",
        candidates,
        confirmed,
        rejected,
        pending: candidates.length - confirmed - rejected,
        exportRefusal: EventImport.exportRefusal(workflow.candidates),
        progressText: progressText(workflow.progress),
    };
}

function documentCitationText(citation) {
    return format(
        _("%s · page %d · span %d–%d"),
        citation.fileName,
        citation.page,
        citation.span.start,
        citation.span.end,
    );
}

function documentQuestionModel(state) {
    const workflow = state.documentQuestion;
    if (workflow === null || workflow === undefined) {
        return null;
    }
    const visible = workflow.available === true || workflow.phase !== "idle" || workflow.message !== "";
    if (!visible) {
        return null;
    }
    return {
        ...workflow,
        title: _("Ask documents"),
        chooserEnabled: workflow.available === true
            && !["selecting", "submitting", "running", "cancelling"].includes(workflow.phase),
        askEnabled: workflow.available === true && workflow.phase === "selected",
        cancelEnabled: ["submitting", "running"].includes(workflow.phase),
        complete: workflow.phase === "complete",
        progressText: progressText(workflow.progress),
        citations: workflow.citations.map((citation) => ({
            ...citation,
            text: documentCitationText(citation),
        })),
        limits: {
            sources: DocumentQuestion.MAX_SOURCES,
            questionCharacters: DocumentQuestion.MAX_QUESTION_CHARACTERS,
        },
    };
}

function selectedTextModel(state) {
    const workflow = state.selectedText;
    if (workflow === null || workflow === undefined) {
        return null;
    }
    const visible = workflow.available === true || workflow.phase !== "idle";
    if (!visible) {
        return null;
    }
    return {
        ...workflow,
        title: _("Work with selected text"),
        operationEnabled: workflow.available === true
            && !["selecting", "submitting", "running", "cancelling"].includes(workflow.phase),
        cancelEnabled: ["selecting", "submitting", "running"].includes(workflow.phase),
        complete: workflow.phase === "complete",
        progressText: progressText(workflow.progress),
        evidenceText: workflow.evidence === null
            ? ""
            : format(
                _("Selection digest %s · span %d–%d"),
                workflow.evidence.selectionSha256.slice(0, 12),
                workflow.evidence.span.start,
                workflow.evidence.span.end,
            ),
        operations: [...SelectedText.OPERATIONS],
    };
}

function organizerEvidenceText(evidence) {
    return format(
        _("%s · page %d · span %d–%d"),
        evidence.fileName,
        evidence.page,
        evidence.span.start,
        evidence.span.end,
    );
}

function fileOrganizerModel(state) {
    const workflow = state.fileOrganizer;
    if (workflow === null || workflow === undefined) {
        return null;
    }
    const visible = workflow.available === true || workflow.phase !== "idle" || workflow.message !== "";
    if (!visible) {
        return null;
    }
    return {
        ...workflow,
        title: _("Organize files"),
        chooserEnabled: workflow.available === true
            && !["selecting", "submitting", "running", "cancelling"].includes(workflow.phase),
        startEnabled: workflow.available === true && workflow.phase === "selected",
        cancelEnabled: ["submitting", "running"].includes(workflow.phase),
        complete: workflow.phase === "complete",
        progressText: progressText(workflow.progress),
        plan: workflow.plan.map((item) => ({
            ...item,
            tagsText: item.tags.length === 0 ? _("No tags suggested") : item.tags.join(", "),
            nameText: item.proposedName === null
                ? _("Keep current name")
                : format(_("Suggested name: %s"), item.proposedName),
            folderText: item.proposedFolder === null
                ? _("Keep current folder")
                : format(_("Suggested folder: %s"), item.proposedFolder),
            duplicateText: item.duplicateGroup === null
                ? _("No exact duplicate in this selection")
                : format(_("Exact duplicate group: %s"), item.duplicateGroup),
            evidence: item.evidence.map((evidence) => ({
                ...evidence,
                text: organizerEvidenceText(evidence),
            })),
        })),
        limits: {sources: FileOrganizer.MAX_PLAN_ITEMS},
    };
}

function mediaSpeechModel(result) {
    return result.speech.segments.map((segment) => ({
        ...segment,
        timeText: `${MediaTranscription.timestampText(segment.startMs)}–${MediaTranscription.timestampText(segment.endMs)}`,
    }));
}

function mediaVisualModel(visual) {
    let timeText;
    if (visual.pageNumber !== null) {
        timeText = format(_("Page %d"), visual.pageNumber);
    } else if (visual.slideNumber !== null) {
        timeText = format(_("Slide %d"), visual.slideNumber);
    } else if (visual.timestampMs === null) {
        timeText = _("Image");
    } else {
        timeText = format(_("Frame %s"), MediaTranscription.timestampText(visual.timestampMs));
    }
    return {
        ...visual,
        timeText,
    };
}

function mediaResultModel(result) {
    if (result === null) {
        return {copyText: "", speech: [], language: "", visuals: [], modality: ""};
    }
    return {
        copyText: MediaTranscription.transcriptText(result),
        speech: mediaSpeechModel(result),
        language: result.speech.language || "",
        visuals: result.visuals.map(mediaVisualModel),
        modality: result.source.modality,
    };
}

function mediaWorkflowVisible(workflow) {
    return workflow.available === true || workflow.phase !== "idle" || workflow.message !== "";
}

function mediaTranscriptionModel(state) {
    const workflow = state.mediaTranscription;
    if (workflow === null || workflow === undefined) {
        return null;
    }
    if (!mediaWorkflowVisible(workflow)) {
        return null;
    }
    const result = workflow.result;
    return {
        ...workflow,
        ...mediaResultModel(result),
        title: _("Transcribe media"),
        chooserEnabled: workflow.available === true
            && !["selecting", "submitting", "running", "cancelling"].includes(workflow.phase),
        startEnabled: workflow.available === true && workflow.phase === "selected",
        cancelEnabled: ["submitting", "running"].includes(workflow.phase),
        complete: workflow.phase === "complete" && result !== null,
        progressText: progressText(workflow.progress),
    };
}

module.exports = {
    ACTIVE_WORKFLOW_PHASES,
    ATTENTION_STATES,
    EMPTY_ROOT_TEXT,
    JOB_STATE_LABELS,
    MAX_READING_ROWS,
    MAX_RUN_PICTURES,
    NONE_SERVING_TEXT,
    NO_ROOTS_TEXT,
    NO_RUNNABLE_TEXT,
    RECENT_WORKFLOW_PHASES,
    REVIEW_WORKFLOW_PHASES,
    RUN_TITLE,
    SERVING_STATUSES,
    TOOL_SPECS,
    activityModel,
    canServe,
    documentCitationText,
    documentQuestionModel,
    eventCandidateModel,
    eventImportModel,
    evidenceText,
    fileOrganizerModel,
    forecastReadingText,
    jobActivity,
    jobModel,
    jobStateText,
    jobTone,
    mediaResultModel,
    mediaSpeechModel,
    mediaTranscriptionModel,
    mediaVisualModel,
    mediaWorkflowVisible,
    omittedCount,
    organizerEvidenceText,
    progressText,
    readingEntryText,
    readingModel,
    recentWorkflowActivity,
    reviewWorkflowActivity,
    runModel,
    runReason,
    runningWorkflowActivity,
    selectedTextModel,
    toolModel,
    toolModels,
    toolStatus,
    usesLegacyPictureReadiness,
    workflowActivity,
    workflowAvailabilityDetail,
    workflowAvailable,
    workflowPhase,
};

"use strict";

const I18n = require("./i18n.js");
const Result = require("./workload-result.js");

const {_, format, ngettext} = I18n;
const VERSION = 1;
const MAX_EVIDENCE_ROWS = 24;
const PHASES = Object.freeze(["idle", "queued", "running", "cancelling", "complete", "error"]);
const CONSENT_STATES = Object.freeze(["not-required", "required", "granted", "denied"]);
const ACTIVE_PHASES = new Set(["queued", "running", "cancelling"]);
const DEFINITION_KEYS = Object.freeze([
    "version", "id", "title", "description", "consentPurpose",
    "supportsBackground", "retentionText", "reviewOnly",
]);
const STATE_KEYS = Object.freeze([
    "available", "unavailableReason", "consent", "backgroundEnabled",
    "phase", "progress", "warning", "retainedCount", "result",
]);
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

class SurfaceError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "SurfaceError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
    return isRecord(value)
        && Object.keys(value).length === keys.length
        && keys.every((key) => Object.hasOwn(value, key));
}

function boundedText(value, maximum, allowEmpty = false) {
    return typeof value === "string"
        && [...value].length <= maximum
        && (allowEmpty || [...value].length > 0);
}

function validProgress(value) {
    return value === null || (exactKeys(value, ["fraction", "detail"])
        && Number.isFinite(value.fraction)
        && value.fraction >= 0
        && value.fraction <= 1
        && boundedText(value.detail, 240, true));
}

function validDefinitionIdentity(value) {
    return value.version === VERSION
        && typeof value.id === "string"
        && value.id.length <= 120
        && IDENTIFIER.test(value.id);
}

function validDefinitionCopy(value) {
    return boundedText(value.title, 160)
        && boundedText(value.description, 500)
        && boundedText(value.consentPurpose, 500, true)
        && boundedText(value.retentionText, 500);
}

function isDefinition(value) {
    return exactKeys(value, DEFINITION_KEYS)
        && validDefinitionIdentity(value)
        && validDefinitionCopy(value)
        && typeof value.supportsBackground === "boolean"
        && value.reviewOnly === true;
}

function validStateControl(value) {
    return typeof value.available === "boolean"
        && boundedText(value.unavailableReason, 500, true)
        && CONSENT_STATES.includes(value.consent)
        && typeof value.backgroundEnabled === "boolean"
        && PHASES.includes(value.phase)
        && validProgress(value.progress);
}

function validStateOutput(value) {
    return boundedText(value.warning, 500, true)
        && Number.isSafeInteger(value.retainedCount)
        && value.retainedCount >= 0
        && (value.result === null || Result.isWorkloadResult(value.result));
}

function isState(value) {
    return exactKeys(value, STATE_KEYS)
        && validStateControl(value)
        && validStateOutput(value)
}

function percent(value) {
    return `${Math.round(value * 100)}%`;
}

function score(value) {
    return Number(value).toFixed(3);
}

function boxText(box) {
    return `${score(box.x)}, ${score(box.y)}, ${score(box.width)} × ${score(box.height)}`;
}

function riskRows(payload) {
    const references = payload.evidenceIds.length === 0
        ? _("No evidence references")
        : payload.evidenceIds.join(", ");
    return [{title: payload.label, detail: format(
        _("Score %s · threshold %s · %s"), score(payload.score), score(payload.threshold), references,
    )}];
}

function forecastRows(payload) {
    return payload.points.map((point) => ({
        title: format(_("Offset %d %s"), point.offset, payload.unit),
        detail: `${point.value} · ${point.lower}–${point.upper}`,
    }));
}

function rankingRows(payload) {
    return payload.items.map((item) => ({
        title: format(_("Rank %d · %s"), item.rank, item.id), detail: score(item.score),
    }));
}

function detectionRows(payload) {
    return payload.items.map((item) => ({
        title: `${item.label} · ${score(item.score)}`, detail: boxText(item.box),
    }));
}

function maskRows(payload) {
    return [{
        title: format(_("%d × %d mask"), payload.width, payload.height),
        detail: `${payload.encoding.toUpperCase()} · ${payload.sourceWidth} × ${payload.sourceHeight}`,
    }];
}

function embeddingRows(payload) {
    return [{
        title: format(ngettext("%d embedding value", "%d embedding values", payload.dimensions),
            payload.dimensions),
        detail: format(_("%s vector hidden from the interface"), payload.dtype),
    }];
}

function labelRows(payload) {
    return payload.items.map((item) => ({title: item.label, detail: score(item.score)}));
}

function mediaRows(payload) {
    return payload.segments.map((segment) => ({
        title: `${segment.startMs}–${segment.endMs} ms · ${segment.kind}`,
        detail: `${segment.text} · ${score(segment.confidence)} · ${segment.sourceRef}`,
    }));
}

const ROW_PROJECTORS = Object.freeze({
    "risk-score": riskRows,
    forecast: forecastRows,
    ranking: rankingRows,
    detection: detectionRows,
    mask: maskRows,
    embedding: embeddingRows,
    labels: labelRows,
    "media-evidence": mediaRows,
});

function resultModel(result) {
    if (result === null) {
        return null;
    }
    const rows = ROW_PROJECTORS[result.kind](result.payload);
    return {
        kind: result.kind,
        operationId: result.operationId,
        rows: rows.slice(0, MAX_EVIDENCE_ROWS),
        omitted: Math.max(0, rows.length - MAX_EVIDENCE_ROWS),
    };
}

function consentModel(definition, state) {
    const visible = definition.consentPurpose !== "";
    return {visible, purpose: definition.consentPurpose, state: state.consent};
}

function consentAllowsRun(consent) {
    return consent === "not-required" || consent === "granted";
}

function action(id, label, enabled, pressed = false) {
    return {id, label, enabled, pressed};
}

function consentActions(definition, state, active) {
    if (definition.consentPurpose === "") {
        return [];
    }
    return [state.consent === "granted"
        ? action("revoke-consent", _("Revoke consent"), !active)
        : action("grant-consent", _("Grant consent"), !active)];
}

function backgroundActions(definition, state, enabled) {
    return definition.supportsBackground ? [action(
        "toggle-background", _("Run in background"), enabled,
        state.backgroundEnabled,
    )] : [];
}

function cancelActions(state, active) {
    return active ? [action("cancel", _("Cancel"), state.phase !== "cancelling")] : [];
}

function clearActions(state, active) {
    return state.result !== null || state.retainedCount > 0
        ? [action("clear", _("Clear retained results"), !active)]
        : [];
}

function actionModels(definition, state) {
    const active = ACTIVE_PHASES.has(state.phase);
    const consented = consentAllowsRun(state.consent);
    const enabled = state.available && consented && !active;
    return [
        ...consentActions(definition, state, active),
        action("run-now", _("Run now"), enabled),
        ...backgroundActions(definition, state, enabled),
        ...cancelActions(state, active),
        ...clearActions(state, active),
    ];
}

function statusModel(state) {
    if (!state.available) {
        return {label: _("Unavailable"), tone: "unavailable"};
    }
    if (ACTIVE_PHASES.has(state.phase)) {
        return {label: _("Working"), tone: "running"};
    }
    if (state.phase === "error") {
        return {label: _("Needs attention"), tone: "attention"};
    }
    return {label: _("Ready"), tone: "healthy"};
}

function createSurfaceModel(definition, state) {
    if (!isDefinition(definition)) {
        throw new SurfaceError("definition-invalid", "generic workflow definition is invalid");
    }
    if (!isState(state)) {
        throw new SurfaceError("state-invalid", "generic workflow state is invalid");
    }
    const progress = state.progress === null ? "" : `${percent(state.progress.fraction)}${
        state.progress.detail === "" ? "" : ` · ${state.progress.detail}`
    }`;
    return Object.freeze({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        status: statusModel(state),
        unavailable: {visible: !state.available, detail: state.unavailableReason},
        consent: consentModel(definition, state),
        background: {visible: definition.supportsBackground, enabled: state.backgroundEnabled},
        progress: {visible: ACTIVE_PHASES.has(state.phase), text: progress},
        warning: state.warning,
        retention: {text: definition.retentionText, count: state.retainedCount},
        reviewOnly: definition.reviewOnly,
        result: resultModel(state.result),
        actions: actionModels(definition, state),
    });
}

module.exports = {
    ACTIVE_PHASES,
    CONSENT_STATES,
    MAX_EVIDENCE_ROWS,
    PHASES,
    SurfaceError,
    VERSION,
    actionModels,
    boxText,
    consentAllowsRun,
    createSurfaceModel,
    isDefinition,
    isState,
    resultModel,
};

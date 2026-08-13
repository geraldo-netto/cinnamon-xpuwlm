"use strict";

// Models may propose parameters, but only host-owned definitions, confirmation,
// conflict detection, and adapters can mutate state. Every apply is preceded by
// durable audit evidence and a one-use UI confirmation token.

const VERSION = 1;
const MAX_ACTIONS = 32;
const MAX_TARGETS = 32;
const MAX_EFFECTS = 64;
const MAX_PENDING = 16;
const MIN_CONFIRMATION_TTL_MS = 1000;
const MAX_CONFIRMATION_TTL_MS = 300_000;
const MAX_PARAMETER_BYTES = 32 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 512;
const MAX_JSON_COLLECTION = 64;
const MAX_REFERENCE_LENGTH = 4096;
const MAX_DETAIL_LENGTH = 512;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const DEFINITION_FIELDS = Object.freeze([
    "id", "maxTargets", "maxEffects", "allowedEffects", "rollbackSupported", "validate", "port",
]);
const REQUEST_FIELDS = Object.freeze([
    "requestId", "actionId", "sourceResultSha256", "targets", "parameters",
]);
const PREVIEW_FIELDS = Object.freeze(["revision", "effects"]);
const EFFECT_FIELDS = Object.freeze([
    "id", "kind", "target", "summary", "beforeSha256", "afterSha256",
]);
const CONFLICT_FIELDS = Object.freeze(["target", "code", "detail", "observedRevision"]);
const RECEIPT_FIELDS = Object.freeze(["revision", "changedTargets", "detail"]);
const ROLLBACK_FIELDS = Object.freeze(["restoredTargets", "detail"]);
const CONFIRMATION_FIELDS = Object.freeze(["token", "confirmed"]);
const AUDIT_EVIDENCE_FIELDS = Object.freeze(["sequence", "recordedAt", "digest"]);

class DeterministicActionError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "DeterministicActionError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
    return isRecord(value)
        && Object.keys(value).length === expected.length
        && expected.every((name) => Object.hasOwn(value, name));
}

function boundedText(value, minimum, maximum) {
    return typeof value === "string"
        && !value.includes("\0")
        && [...value].length >= minimum
        && [...value].length <= maximum;
}

function identifier(value) {
    return boundedText(value, 1, 80) && IDENTIFIER.test(value);
}

function nullableDigest(value) {
    return value === null || (typeof value === "string" && DIGEST.test(value));
}

function utf8ByteLength(value) {
    let length = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        if (point <= 0x7f) {
            length += 1;
        } else if (point <= 0x7ff) {
            length += 2;
        } else {
            length += point <= 0xffff ? 3 : 4;
        }
    }
    return length;
}

function validJsonScalar(value) {
    if (value === null || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    return typeof value === "string" && boundedText(value, 0, MAX_REFERENCE_LENGTH);
}

function validJsonArray(value, state, depth) {
    return value.length <= MAX_JSON_COLLECTION
        && value.every((item) => validJsonValue(item, state, depth + 1));
}

function validJsonRecord(value, state, depth) {
    const keys = Object.keys(value);
    return keys.length <= MAX_JSON_COLLECTION
        && keys.every((key) => boundedText(key, 1, 80))
        && keys.every((key) => validJsonValue(value[key], state, depth + 1));
}

function validJsonValue(value, state, depth) {
    state.nodes += 1;
    if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH || state.seen.has(value)) {
        return false;
    }
    if (validJsonScalar(value)) {
        return true;
    }
    if (typeof value !== "object" || value === null) {
        return false;
    }
    state.seen.add(value);
    const valid = Array.isArray(value)
        ? validJsonArray(value, state, depth)
        : validJsonRecord(value, state, depth);
    state.seen.delete(value);
    return valid;
}

function validParameters(value) {
    if (!isRecord(value) || !validJsonValue(value, {nodes: 0, seen: new Set()}, 0)) {
        return false;
    }
    try {
        return utf8ByteLength(JSON.stringify(value)) <= MAX_PARAMETER_BYTES;
    } catch {
        return false;
    }
}

function frozenJson(value) {
    if (Array.isArray(value)) {
        return Object.freeze(value.map(frozenJson));
    }
    if (isRecord(value)) {
        return Object.freeze(Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, frozenJson(item)]),
        ));
    }
    return value;
}

function requirePort(candidate, methods, label) {
    if (!isRecord(candidate) || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new DeterministicActionError("port-invalid", `${label} port is invalid`);
    }
    return candidate;
}

function validDefinitionBounds(value) {
    return Number.isSafeInteger(value.maxTargets)
        && value.maxTargets >= 1
        && value.maxTargets <= MAX_TARGETS
        && Number.isSafeInteger(value.maxEffects)
        && value.maxEffects >= 1
        && value.maxEffects <= MAX_EFFECTS;
}

function validDefinitionShape(value) {
    return exactKeys(value, DEFINITION_FIELDS)
        && identifier(value.id)
        && validDefinitionBounds(value)
        && typeof value.rollbackSupported === "boolean"
        && typeof value.validate === "function";
}

function validAllowedEffects(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= 16
        && value.every(identifier)
        && new Set(value).size === value.length;
}

function ownedDefinition(value) {
    if (!validDefinitionShape(value) || !validAllowedEffects(value.allowedEffects)) {
        throw new DeterministicActionError("definition-invalid", "action definition is invalid");
    }
    const methods = ["preview", "conflicts", "apply"];
    if (value.rollbackSupported) {
        methods.push("rollback");
    }
    const port = requirePort(value.port, methods, `action ${value.id}`);
    return Object.freeze({
        id: value.id,
        maxTargets: value.maxTargets,
        maxEffects: value.maxEffects,
        allowedEffects: Object.freeze([...value.allowedEffects]),
        rollbackSupported: value.rollbackSupported,
        validate: value.validate,
        port,
    });
}

function ownedDefinitions(values) {
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_ACTIONS) {
        throw new DeterministicActionError("definitions-invalid", "action allowlist is invalid");
    }
    const definitions = values.map(ownedDefinition);
    if (new Set(definitions.map((item) => item.id)).size !== definitions.length) {
        throw new DeterministicActionError("definition-duplicate", "action allowlist contains duplicates");
    }
    return new Map(definitions.map((item) => [item.id, item]));
}

function validTargets(value, maximum) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= maximum
        && value.every((target) => boundedText(target, 1, MAX_REFERENCE_LENGTH))
        && new Set(value).size === value.length;
}

function validRequestShape(value, definition) {
    return exactKeys(value, REQUEST_FIELDS)
        && REQUEST_ID.test(value.requestId)
        && value.actionId === definition.id
        && typeof value.sourceResultSha256 === "string"
        && DIGEST.test(value.sourceResultSha256)
        && validTargets(value.targets, definition.maxTargets)
        && validParameters(value.parameters);
}

function ownedRequest(value, definition) {
    if (!validRequestShape(value, definition)) {
        throw new DeterministicActionError("request-invalid", "action request is invalid");
    }
    const parameters = frozenJson(value.parameters);
    let accepted;
    try {
        accepted = definition.validate(parameters) === true;
    } catch {
        accepted = false;
    }
    if (!accepted) {
        throw new DeterministicActionError("parameters-refused", "action parameters were refused");
    }
    return Object.freeze({
        requestId: value.requestId,
        actionId: value.actionId,
        sourceResultSha256: value.sourceResultSha256,
        targets: Object.freeze([...value.targets]),
        parameters,
    });
}

function validEffectIdentity(effect, definition, request) {
    return exactKeys(effect, EFFECT_FIELDS)
        && identifier(effect.id)
        && definition.allowedEffects.includes(effect.kind)
        && request.targets.includes(effect.target)
        && boundedText(effect.summary, 1, MAX_DETAIL_LENGTH);
}

function validEffectTransition(effect) {
    return nullableDigest(effect.beforeSha256)
        && nullableDigest(effect.afterSha256)
        && (effect.beforeSha256 !== null || effect.afterSha256 !== null)
        && effect.beforeSha256 !== effect.afterSha256;
}

function validEffects(effects, definition, request) {
    if (!Array.isArray(effects) || effects.length < 1 || effects.length > definition.maxEffects) {
        return false;
    }
    if (!effects.every((effect) => (
        validEffectIdentity(effect, definition, request) && validEffectTransition(effect)
    ))) {
        return false;
    }
    const effectIds = new Set(effects.map((effect) => effect.id));
    const previewTargets = new Set(effects.map((effect) => effect.target));
    return effectIds.size === effects.length
        && request.targets.every((target) => previewTargets.has(target));
}

function frozenEffect(effect) {
    return Object.freeze({...effect});
}

function ownedPreview(value, definition, request) {
    if (!exactKeys(value, PREVIEW_FIELDS)
        || !boundedText(value.revision, 1, 200)
        || !validEffects(value.effects, definition, request)) {
        throw new DeterministicActionError("preview-invalid", "action preview is invalid");
    }
    return Object.freeze({
        revision: value.revision,
        effects: Object.freeze(value.effects.map(frozenEffect)),
    });
}

function validConflict(value, request) {
    return exactKeys(value, CONFLICT_FIELDS)
        && request.targets.includes(value.target)
        && identifier(value.code)
        && boundedText(value.detail, 1, MAX_DETAIL_LENGTH)
        && boundedText(value.observedRevision, 1, 200);
}

function ownedConflicts(value, request) {
    if (!Array.isArray(value)
        || value.length > request.targets.length
        || !value.every((item) => validConflict(item, request))
        || new Set(value.map((item) => item.target)).size !== value.length) {
        throw new DeterministicActionError("conflicts-invalid", "action conflicts are invalid");
    }
    return Object.freeze(value.map((item) => Object.freeze({...item})));
}

function effectTargets(preview) {
    return Object.freeze([...new Set(preview.effects.map((effect) => effect.target))]);
}

function sameMembers(left, right) {
    return left.length === right.length && left.every((item) => right.includes(item));
}

function ownedReceipt(value, preview) {
    const targets = effectTargets(preview);
    if (!exactKeys(value, RECEIPT_FIELDS)
        || !boundedText(value.revision, 1, 200)
        || !validTargets(value.changedTargets, MAX_TARGETS)
        || !sameMembers(value.changedTargets, targets)
        || !boundedText(value.detail, 1, MAX_DETAIL_LENGTH)) {
        throw new DeterministicActionError("receipt-invalid", "action receipt is invalid");
    }
    return Object.freeze({
        revision: value.revision,
        changedTargets: Object.freeze([...value.changedTargets]),
        detail: value.detail,
    });
}

function ownedRollback(value, preview) {
    const targets = effectTargets(preview);
    if (!exactKeys(value, ROLLBACK_FIELDS)
        || !validTargets(value.restoredTargets, MAX_TARGETS)
        || !sameMembers(value.restoredTargets, targets)
        || !boundedText(value.detail, 1, MAX_DETAIL_LENGTH)) {
        throw new DeterministicActionError("rollback-invalid", "action rollback receipt is invalid");
    }
    return Object.freeze({
        restoredTargets: Object.freeze([...value.restoredTargets]),
        detail: value.detail,
    });
}

function validAuditEvidence(value) {
    return exactKeys(value, AUDIT_EVIDENCE_FIELDS)
        && Number.isSafeInteger(value.sequence)
        && value.sequence >= 1
        && Number.isSafeInteger(value.recordedAt)
        && value.recordedAt >= 0
        && typeof value.digest === "string"
        && DIGEST.test(value.digest);
}

function ownedAuditEvidence(value) {
    if (!validAuditEvidence(value)) {
        throw new DeterministicActionError("audit-invalid", "action audit evidence is invalid");
    }
    return Object.freeze({...value});
}

function failureCode(error) {
    return identifier(error?.code) ? error.code : "action-failed";
}

function resultDocument(pending, status, code, values, audit) {
    return Object.freeze({
        version: VERSION,
        status,
        requestId: pending.request.requestId,
        actionId: pending.definition.id,
        code,
        conflicts: values.conflicts,
        receipt: values.receipt,
        rollback: values.rollback,
        audit: Object.freeze(audit),
    });
}

class DeterministicActionPort {
    constructor({definitions, confirmation, audit, clock = Date, confirmationTtlMs = 60_000}) {
        if (!Number.isSafeInteger(confirmationTtlMs)
            || confirmationTtlMs < MIN_CONFIRMATION_TTL_MS
            || confirmationTtlMs > MAX_CONFIRMATION_TTL_MS) {
            throw new DeterministicActionError("ttl-invalid", "confirmation lifetime is invalid");
        }
        if (!clock || typeof clock.now !== "function") {
            throw new DeterministicActionError("clock-invalid", "action clock is invalid");
        }
        this._definitions = ownedDefinitions(definitions);
        this._confirmation = requirePort(confirmation, ["issue", "consume"], "confirmation");
        this._audit = requirePort(audit, ["record"], "audit");
        this._clock = clock;
        this._confirmationTtlMs = confirmationTtlMs;
        this._pending = new Map();
    }

    _now() {
        const value = this._clock.now();
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new DeterministicActionError("clock-invalid", "action clock returned invalid time");
        }
        return value;
    }

    _sweep(now) {
        for (const [token, pending] of this._pending) {
            if (pending.expiresAt < now) {
                this._pending.delete(token);
            }
        }
    }

    _definition(actionId) {
        const definition = this._definitions.get(actionId);
        if (definition === undefined) {
            throw new DeterministicActionError("action-not-allowed", "action is not allowlisted");
        }
        return definition;
    }

    async _record(pending, phase, outcome, code) {
        const evidence = await this._audit.record(Object.freeze({
            version: VERSION,
            phase,
            outcome,
            requestId: pending.request.requestId,
            actionId: pending.definition.id,
            targetCount: pending.request.targets.length,
            effectCount: pending.preview.effects.length,
            code,
        }));
        return ownedAuditEvidence(evidence);
    }

    async preview(value) {
        if (!isRecord(value) || typeof value.actionId !== "string") {
            throw new DeterministicActionError("request-invalid", "action request is invalid");
        }
        const now = this._now();
        this._sweep(now);
        if (this._pending.size >= MAX_PENDING) {
            throw new DeterministicActionError("preview-capacity", "too many action previews are pending");
        }
        const definition = this._definition(value.actionId);
        const request = ownedRequest(value, definition);
        const preview = ownedPreview(await definition.port.preview(request), definition, request);
        const expiresAt = now + this._confirmationTtlMs;
        const metadata = Object.freeze({
            requestId: request.requestId,
            actionId: request.actionId,
            sourceResultSha256: request.sourceResultSha256,
            revision: preview.revision,
            expiresAt,
        });
        const token = await this._confirmation.issue(metadata);
        if (!boundedText(token, 16, 256) || this._pending.has(token)) {
            throw new DeterministicActionError("confirmation-invalid", "confirmation token is invalid");
        }
        const pending = Object.freeze({definition, request, preview, metadata, expiresAt});
        this._pending.set(token, pending);
        let audit;
        try {
            audit = await this._record(pending, "preview", "prepared", "confirmation-required");
        } catch (error) {
            this._pending.delete(token);
            throw error;
        }
        return Object.freeze({
            version: VERSION,
            requestId: request.requestId,
            actionId: request.actionId,
            confirmationToken: token,
            expiresAt,
            revision: preview.revision,
            effects: preview.effects,
            audit,
        });
    }

    async execute(confirmation) {
        if (!exactKeys(confirmation, CONFIRMATION_FIELDS)
            || !boundedText(confirmation.token, 16, 256)
            || confirmation.confirmed !== true) {
            throw new DeterministicActionError("confirmation-required", "explicit confirmation is required");
        }
        const pending = this._pending.get(confirmation.token);
        this._pending.delete(confirmation.token);
        if (pending === undefined) {
            throw new DeterministicActionError("preview-missing", "action preview is missing or already used");
        }
        const audit = [];
        if (this._now() > pending.expiresAt) {
            audit.push(await this._record(pending, "confirmation", "refused", "confirmation-expired"));
            throw new DeterministicActionError("confirmation-expired", "action confirmation expired");
        }
        const accepted = await this._confirmation.consume(confirmation.token, pending.metadata);
        if (accepted !== true) {
            audit.push(await this._record(pending, "confirmation", "refused", "confirmation-invalid"));
            throw new DeterministicActionError("confirmation-invalid", "action confirmation was refused");
        }
        audit.push(await this._record(pending, "confirmation", "accepted", "confirmed"));
        const conflicts = ownedConflicts(
            await pending.definition.port.conflicts(pending.preview, pending.request),
            pending.request,
        );
        if (conflicts.length > 0) {
            audit.push(await this._record(pending, "conflict-check", "refused", "conflict"));
            return resultDocument(pending, "conflict", "conflict", {
                conflicts, receipt: null, rollback: null,
            }, audit);
        }
        audit.push(await this._record(pending, "apply", "authorized", "audit-recorded"));
        return this._apply(pending, conflicts, audit);
    }

    async _apply(pending, conflicts, audit) {
        try {
            const receipt = ownedReceipt(
                await pending.definition.port.apply(pending.preview, pending.request),
                pending.preview,
            );
            audit.push(await this._record(pending, "apply", "succeeded", "applied"));
            return resultDocument(pending, "succeeded", "applied", {
                conflicts, receipt, rollback: null,
            }, audit);
        } catch (error) {
            return this._failedApply(pending, conflicts, audit, error);
        }
    }

    async _failedApply(pending, conflicts, audit, error) {
        const code = failureCode(error);
        if (!pending.definition.rollbackSupported) {
            audit.push(await this._record(pending, "apply", "failed", code));
            return resultDocument(pending, "failed", code, {
                conflicts, receipt: null, rollback: null,
            }, audit);
        }
        try {
            const rollback = ownedRollback(
                await pending.definition.port.rollback(pending.preview, pending.request, code),
                pending.preview,
            );
            audit.push(await this._record(pending, "rollback", "succeeded", "rolled-back"));
            return resultDocument(pending, "rolled-back", "rolled-back", {
                conflicts, receipt: null, rollback,
            }, audit);
        } catch {
            audit.push(await this._record(pending, "rollback", "failed", "rollback-failed"));
            return resultDocument(pending, "rollback-failed", "rollback-failed", {
                conflicts, receipt: null, rollback: null,
            }, audit);
        }
    }
}

module.exports = {
    MAX_ACTIONS,
    MAX_CONFIRMATION_TTL_MS,
    MAX_EFFECTS,
    MAX_JSON_COLLECTION,
    MAX_JSON_DEPTH,
    MAX_JSON_NODES,
    MAX_PARAMETER_BYTES,
    MAX_PENDING,
    MAX_TARGETS,
    MIN_CONFIRMATION_TTL_MS,
    DeterministicActionError,
    DeterministicActionPort,
    failureCode,
    frozenJson,
    ownedAuditEvidence,
    ownedConflicts,
    ownedDefinition,
    ownedDefinitions,
    ownedPreview,
    ownedReceipt,
    ownedRequest,
    ownedRollback,
    utf8ByteLength,
    validAllowedEffects,
    validAuditEvidence,
    validEffectTransition,
    validEffects,
    validJsonValue,
    validParameters,
    validRequestShape,
    validTargets,
};

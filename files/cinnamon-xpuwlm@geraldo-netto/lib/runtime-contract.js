"use strict";

const Domain = require("./domain.js");

// What the running service speaks, learned before anything is sent to it.
//
// Until this existed the applet could only find out by calling a method and
// reading the failure, and "this service is older than you" arrives looking
// exactly like "this service is broken": a D-Bus `UnknownMethod`, or a
// `method-unknown` refusal. Both were diagnosed after the fact, and neither
// told a user the one thing that would help — update the service. D-Bus
// introspection would not have closed the gap either: it enumerates method
// *names*, and two services can both export `ApplyCommand` while disagreeing
// completely about what a command document looks like.
//
// So the handshake reports both halves and this module compares both against
// what this build actually sends. The comparison is deliberately here, in a
// module with no transport and no UI: what the applet requires is a property
// of the applet, not of the socket it learned the answer over.

const CONTRACT_DOCUMENT_VERSION = 1;
const DOCUMENT_PROPERTIES = new Set(["version", "methods", "schemas"]);
const METHOD_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const CONTRACT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_METHODS = 32;
const MAX_CONTRACTS = 32;
const MAX_CONTRACT_VERSION = 65535;

// Everything this build calls, and the version of every document it sends or
// parses. Listed rather than derived, because a handshake that asks for
// whatever it happens to find compares nothing.
const REQUIRED_METHODS = Object.freeze(["ApplyCommand"]);
const REQUIRED_CONTRACTS = Object.freeze({
    "runtime-command": 2,
    "runtime-acknowledgement": 2,
    "runtime-refusal": 1,
    "runtime-snapshot": 1,
});

const INCOMPATIBILITY_KINDS = Object.freeze([
    "method-missing",
    "contract-missing",
    "contract-newer",
    "contract-older",
]);

function isMethodList(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_METHODS
        && value.every((name) => typeof name === "string" && METHOD_NAME.test(name))
        && new Set(value).size === value.length;
}

function isContractVersion(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_CONTRACT_VERSION;
}

function isContractMap(value) {
    if (!Domain.isPlainObject(value)) {
        return false;
    }
    const names = Object.keys(value);
    return names.length <= MAX_CONTRACTS
        && names.every((name) => CONTRACT_NAME.test(name) && isContractVersion(value[name]));
}

function isRuntimeContractDocument(value) {
    return Domain.exactRecord(value, DOCUMENT_PROPERTIES)
        && value.version === CONTRACT_DOCUMENT_VERSION
        && isMethodList(value.methods)
        && isContractMap(value.schemas);
}

// A version this build does not send is not a mismatch to report: the service
// speaking a newer `runtime-job-submit` costs nothing to an applet that never
// submits a job. Only the documents in REQUIRED_CONTRACTS are compared.
function contractIncompatibility(name, required, offered) {
    if (offered === undefined) {
        return {kind: "contract-missing", name, required, offered: null};
    }
    if (offered > required) {
        return {kind: "contract-newer", name, required, offered};
    }
    if (offered < required) {
        return {kind: "contract-older", name, required, offered};
    }
    return null;
}

class RuntimeContract {
    // `document` is null when nothing has been learned yet — a service that
    // has not answered, or one too old to have the method at all. That state
    // is deliberately distinct from "answered, and incompatible": the first
    // is not knowing, and reporting it as a mismatch would tell a user their
    // service is wrong when the applet simply has not asked.
    constructor(document = null) {
        this._document = isRuntimeContractDocument(document)
            ? Object.freeze({
                version: document.version,
                methods: Object.freeze([...document.methods]),
                schemas: Object.freeze({...document.schemas}),
            })
            : null;
    }

    static unknown() {
        return new RuntimeContract(null);
    }

    get known() {
        return this._document !== null;
    }

    get methods() {
        return this._document === null ? Object.freeze([]) : this._document.methods;
    }

    get schemas() {
        return this._document === null ? Object.freeze({}) : this._document.schemas;
    }

    supports(method) {
        return this.methods.includes(method);
    }

    speaks(name, version) {
        return this.schemas[name] === version;
    }

    // Empty when the service is compatible *and* when nothing is known, for
    // the reason above. Callers that need to tell those apart read `known`.
    incompatibilities() {
        if (this._document === null) {
            return Object.freeze([]);
        }
        const found = REQUIRED_METHODS
            .filter((method) => !this.supports(method))
            .map((method) => ({kind: "method-missing", name: method, required: null, offered: null}));
        for (const [name, required] of Object.entries(REQUIRED_CONTRACTS)) {
            const mismatch = contractIncompatibility(name, required, this.schemas[name]);
            if (mismatch !== null) {
                found.push(mismatch);
            }
        }
        return Object.freeze(found);
    }

    get compatible() {
        return this.incompatibilities().length === 0;
    }

    // A projection for the view, so nothing above the domain holds the
    // instance or reaches into its document.
    describe() {
        return Object.freeze({
            known: this.known,
            compatible: this.compatible,
            methods: this.methods,
            schemas: this.schemas,
            incompatibilities: this.incompatibilities(),
        });
    }
}

module.exports = {
    CONTRACT_DOCUMENT_VERSION,
    CONTRACT_NAME,
    DOCUMENT_PROPERTIES,
    INCOMPATIBILITY_KINDS,
    MAX_CONTRACTS,
    MAX_CONTRACT_VERSION,
    MAX_METHODS,
    METHOD_NAME,
    REQUIRED_CONTRACTS,
    REQUIRED_METHODS,
    RuntimeContract,
    contractIncompatibility,
    isContractMap,
    isContractVersion,
    isMethodList,
    isRuntimeContractDocument,
};

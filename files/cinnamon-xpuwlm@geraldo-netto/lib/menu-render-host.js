"use strict";

const HOSTS = new WeakMap();

function requireRecord(candidate, label) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new TypeError(`${label} is required`);
    }
    return candidate;
}

function method(candidate, name, label) {
    if (typeof candidate[name] !== "function") {
        throw new TypeError(`${label}.${name} is required`);
    }
    return candidate[name];
}

function methods(candidate, names, label) {
    const source = requireRecord(candidate, label);
    return Object.freeze(Object.fromEntries(names.map((name) => [name, method(source, name, label)])));
}

function createRenderHost({body, label, headings, events, actions}) {
    if (typeof label !== "function") {
        throw new TypeError("Render host label is required");
    }
    return Object.freeze({
        body: methods(body, ["addChild"], "Render host body"),
        label,
        headings: methods(headings, ["group", "section"], "Render host headings"),
        events: methods(events, [
            "action", "box", "button", "entry", "identify", "setAccessibleRole",
            "setAccessibleState", "setButtonEnabled",
        ], "Render host events"),
        actions: Object.freeze({...requireRecord(actions, "Render host actions")}),
    });
}

function registerRenderHost(owner, contract) {
    if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
        throw new TypeError("Render host owner is required");
    }
    const host = createRenderHost(contract);
    HOSTS.set(owner, host);
    return host;
}

function renderHostOf(owner) {
    const host = HOSTS.get(owner);
    if (host === undefined) {
        throw new TypeError("Menu renderer host is not registered");
    }
    return host;
}

function unregisterRenderHost(owner) {
    return HOSTS.delete(owner);
}

module.exports = {
    createRenderHost,
    registerRenderHost,
    renderHostOf,
    unregisterRenderHost,
};

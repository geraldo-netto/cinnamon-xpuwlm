"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib");
const RenderHost = require(path.join(ROOT, "menu-render-host.js"));

function contract() {
    const noop = () => false;
    return {
        body: {addChild: noop},
        label: noop,
        headings: {group: noop, section: noop},
        events: {
            action: noop,
            box: noop,
            button: noop,
            entry: noop,
            identify: noop,
            setAccessibleRole: noop,
            setAccessibleState: noop,
            setButtonEnabled: noop,
        },
        actions: {dispatch: noop},
    };
}

test("render host exposes only the explicit renderer contract", () => {
    const source = contract();
    const host = RenderHost.createRenderHost(source);
    assert.deepEqual(Object.keys(host), ["body", "label", "headings", "events", "actions"]);
    assert.deepEqual(Object.keys(host.body), ["addChild"]);
    assert.deepEqual(Object.keys(host.headings), ["group", "section"]);
    assert.deepEqual(Object.keys(host.events), [
        "action", "box", "button", "entry", "identify", "setAccessibleRole",
        "setAccessibleState", "setButtonEnabled",
    ]);
    assert.equal(host.label, source.label);
    assert.equal(host.actions.dispatch, source.actions.dispatch);
    for (const value of [host, host.body, host.headings, host.events, host.actions]) {
        assert.equal(Object.isFrozen(value), true);
    }
});

test("render hosts are owner-scoped and explicitly releasable", () => {
    const owner = {};
    const host = RenderHost.registerRenderHost(owner, contract());
    assert.equal(RenderHost.renderHostOf(owner), host);
    assert.equal(RenderHost.unregisterRenderHost(owner), true);
    assert.equal(RenderHost.unregisterRenderHost(owner), false);
    assert.throws(() => RenderHost.renderHostOf(owner), /not registered/u);
});

test("render host rejects incomplete owners and surfaces", () => {
    assert.throws(() => RenderHost.registerRenderHost(null, contract()), /owner/u);
    assert.throws(() => RenderHost.registerRenderHost(7, contract()), /owner/u);
    assert.throws(() => RenderHost.createRenderHost({...contract(), label: null}), /label/u);
    for (const [name, candidate] of [
        ["body", null],
        ["headings", []],
        ["events", "events"],
        ["actions", null],
    ]) {
        assert.throws(
            () => RenderHost.createRenderHost({...contract(), [name]: candidate}),
            new RegExp(name, "iu"),
        );
    }
    const missing = contract();
    delete missing.events.action;
    assert.throws(() => RenderHost.createRenderHost(missing), /events\.action/u);
});

test("renderer modules do not reach into MenuView private host fields", () => {
    const forbidden = /this\._(?:actions|addGroupHeading|addSectionHeading|body|box|button|entry|eventAction|identify|label|setAccessibleRole|setAccessibleState|setButtonEnabled)\b/u;
    for (const name of [
        "generic-workflow-menu-view.js",
        "workflow-document-question-menu-view.js",
        "workflow-event-import-menu-view.js",
        "workflow-file-organizer-menu-view.js",
        "workflow-media-menu-view.js",
        "workflow-selected-text-menu-view.js",
        "workflow-shared-menu-view.js",
    ]) {
        const source = fs.readFileSync(path.join(ROOT, name), "utf8");
        assert.doesNotMatch(source, forbidden, name);
        assert.match(source, /hostOf\(this\)/u, name);
    }
    const aggregate = fs.readFileSync(path.join(ROOT, "workflow-menu-view.js"), "utf8");
    assert.doesNotMatch(aggregate, forbidden, "workflow-menu-view.js");
});

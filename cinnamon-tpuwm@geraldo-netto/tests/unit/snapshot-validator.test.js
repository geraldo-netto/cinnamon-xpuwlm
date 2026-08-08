"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const SnapshotValidator = require("../../lib/snapshot-validator.js");

test("snapshot validator contract creates immutable reports", () => {
    const accepted = SnapshotValidator.validationAccepted();
    assert.deepEqual(accepted, {valid: true, code: "accepted"});
    assert.equal(Object.isFrozen(accepted), true);
    assert.equal(SnapshotValidator.validationAccepted(), accepted);

    assert.deepEqual(SnapshotValidator.validationRejected(" range "), {
        valid: false,
        code: "range",
    });
    assert.deepEqual(SnapshotValidator.validationRejected(""), {valid: false, code: "schema"});
    assert.deepEqual(SnapshotValidator.validationRejected(null), {valid: false, code: "schema"});
});

test("snapshot validator contract requires the port and validates its report", () => {
    const accepted = {validate: () => SnapshotValidator.validationAccepted()};
    assert.equal(SnapshotValidator.requireSnapshotValidator(accepted), accepted);
    assert.deepEqual(SnapshotValidator.validateSnapshot(accepted, {}), {
        valid: true,
        code: "accepted",
    });
    assert.throws(() => SnapshotValidator.requireSnapshotValidator(null), /validator/u);
    assert.throws(() => SnapshotValidator.requireSnapshotValidator({}), /validator/u);

    for (const report of [
        null,
        {},
        {valid: "yes", code: "accepted"},
        {valid: false, code: ""},
        {valid: false, code: "   "},
        {valid: false, code: Object("schema")},
        {valid: true, code: "schema"},
    ]) {
        assert.throws(
            () => SnapshotValidator.validateSnapshot({validate: () => report}, {}),
            /invalid report/u,
        );
    }
});

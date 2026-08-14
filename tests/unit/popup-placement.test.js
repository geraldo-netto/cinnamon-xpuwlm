"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Placement = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js");

test("centered popup placement honors an offset monitor work area", () => {
    assert.deepEqual(
        Placement.centeredPopupPosition({x: 1920, y: 24, width: 1920, height: 1056}, 560, 760),
        [2600, 172],
    );
});

test("oversize popups pin to the work-area origin instead of escaping it", () => {
    assert.deepEqual(
        Placement.centeredPopupPosition({x: -1280, y: 30, width: 1280, height: 690}, 1400, 800),
        [-1280, 30],
    );
});

test("unusable work areas and popup sizes fail closed", () => {
    const validArea = {x: 0, y: 0, width: 1920, height: 1080};
    const callableArea = Object.assign(() => {}, validArea);
    for (const area of [
        null,
        [],
        {},
        callableArea,
        {...validArea, x: NaN},
        {...validArea, width: 0},
    ]) {
        assert.equal(Placement.centeredPopupPosition(area, 560, 760), null);
    }
    for (const size of [0, -1, NaN, Infinity, "560", true, null]) {
        assert.equal(Placement.centeredPopupPosition(validArea, size, 760), null);
        assert.equal(Placement.centeredPopupPosition(validArea, 560, size), null);
    }
});

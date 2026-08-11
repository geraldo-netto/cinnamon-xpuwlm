"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Layout = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/layout.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

const HOSTILE = [
    undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    -1, 0, "1024", {}, [], true,
];

test("property: every layout stays inside its declared bounds", () => {
    const random = generator(0x4c41594f);

    for (let iteration = 0; iteration < 3000; iteration += 1) {
        const measurements = {
            workAreaWidth: Math.floor(random() * 4000),
            workAreaHeight: Math.floor(random() * 3000),
            scaleFactor: random() * 5,
            textScaleFactor: random() * 5,
        };
        const layout = Layout.popupLayout(measurements);

        assert.equal(Layout.MODES.includes(layout.mode), true);
        assert.equal(layout.styleClass, Layout.MODE_STYLE_CLASSES[layout.mode]);
        assert.equal(Number.isInteger(layout.widthPx), true);
        assert.equal(layout.widthPx >= Layout.MINIMUM_WIDTH, true);
        assert.equal(
            layout.widthPx <= Math.round(Layout.PREFERRED_WIDTH * Layout.normalizeScale(measurements.textScaleFactor)),
            true,
        );
        assert.equal(Number.isInteger(layout.scrollHeightPx), true);
        assert.equal(layout.scrollHeightPx >= Layout.MINIMUM_SCROLL_HEIGHT, true);
        assert.equal(layout.scrollHeightPx <= Layout.PREFERRED_SCROLL_HEIGHT, true);
        assert.equal([2, 4].includes(layout.metricColumns), true);
        assert.equal([1, 2].includes(layout.evidenceColumns), true);
        assert.equal(layout.wrapText, layout.mode !== "wide");
        assert.equal(layout.metricColumns === 4, layout.mode === "wide");
        assert.equal(layout.evidenceColumns === 1, layout.mode === "dense");
        assert.equal(Object.isFrozen(layout), true);
    }
});

test("property: the popup never claims more width than the work area offers", () => {
    const random = generator(0x57494454);

    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const scaleFactor = 0.5 + random() * 3.5;
        const workAreaWidth = 320 + Math.floor(random() * 3600);
        const layout = Layout.popupLayout({workAreaWidth, scaleFactor, textScaleFactor: 1});
        const availableLogical = workAreaWidth / scaleFactor;
        assert.equal(
            layout.widthPx <= Math.max(Layout.MINIMUM_WIDTH, availableLogical - Layout.EDGE_MARGIN * 2) + 1,
            true,
            `${workAreaWidth}@${scaleFactor}`,
        );
    }
});

test("fuzz: hostile measurements always resolve to a usable layout", () => {
    const keys = ["workAreaWidth", "workAreaHeight", "scaleFactor", "textScaleFactor"];
    const random = generator(0x484f5354);

    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const measurements = {};
        for (const key of keys) {
            measurements[key] = HOSTILE[Math.floor(random() * HOSTILE.length)];
        }
        const layout = Layout.popupLayout(measurements);
        assert.equal(Layout.MODES.includes(layout.mode), true);
        assert.equal(layout.widthPx >= Layout.MINIMUM_WIDTH, true);
        assert.equal(layout.scrollHeightPx >= Layout.MINIMUM_SCROLL_HEIGHT, true);
    }

    for (const hostile of HOSTILE) {
        assert.deepEqual(Layout.popupLayout(hostile), Layout.defaultLayout());
    }
});

test("property: narrower work areas never widen the popup", () => {
    const random = generator(0x4d4f4e4f);

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const wider = 400 + Math.floor(random() * 3000);
        const narrower = 200 + Math.floor(random() * (wider - 200));
        const wide = Layout.popupLayout({workAreaWidth: wider, scaleFactor: 1, textScaleFactor: 1});
        const narrow = Layout.popupLayout({workAreaWidth: narrower, scaleFactor: 1, textScaleFactor: 1});
        assert.equal(narrow.widthPx <= wide.widthPx, true, `${narrower} <= ${wider}`);
        assert.equal(
            Layout.MODES.indexOf(narrow.mode) >= Layout.MODES.indexOf(wide.mode),
            true,
            "a narrower popup can only become more compact",
        );
    }
});

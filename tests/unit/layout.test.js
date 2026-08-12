"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Layout = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/layout.js");

test("scale normalization clamps unusable values to a usable factor", () => {
    assert.equal(Layout.normalizeScale(1), 1);
    assert.equal(Layout.normalizeScale(2), 2);
    assert.equal(Layout.normalizeScale(0.25), 0.5);
    assert.equal(Layout.normalizeScale(9), 4);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "big"]) {
        assert.equal(Layout.normalizeScale(value), 1, String(value));
    }
});

test("device pixels convert to logical pixels or report an unusable measurement", () => {
    assert.equal(Layout.logicalPixels(1920, 1), 1920);
    assert.equal(Layout.logicalPixels(1920, 2), 960);
    assert.equal(Layout.logicalPixels(1920, 0), 1920);
    for (const value of [0, -10, Number.NaN, null, undefined, "wide"]) {
        assert.equal(Layout.logicalPixels(value, 1), null, String(value));
    }
});

test("mode boundaries follow the approved 520 and 400 breakpoints", () => {
    assert.equal(Layout.popupMode(Layout.COMPACT_MAX_WIDTH + 1), "wide");
    assert.equal(Layout.popupMode(Layout.COMPACT_MAX_WIDTH), "compact");
    assert.equal(Layout.popupMode(Layout.DENSE_MAX_WIDTH + 1), "compact");
    assert.equal(Layout.popupMode(Layout.DENSE_MAX_WIDTH), "dense");
    assert.equal(Layout.popupMode(0), "dense");
    assert.deepEqual(Layout.MODES, ["wide", "compact", "dense"]);
    assert.deepEqual(Layout.MODE_STYLE_CLASSES, {
        wide: "xpuwlm-mode-wide",
        compact: "xpuwlm-mode-compact",
        dense: "xpuwlm-mode-dense",
    });
    assert.deepEqual(Layout.MODE_STYLE_CLASS_LIST, [
        "xpuwlm-mode-wide", "xpuwlm-mode-compact", "xpuwlm-mode-dense",
    ]);
});

test("popup width never exceeds the work area or the preferred width", () => {
    assert.equal(Layout.popupWidth(1920, 1, 1), Layout.PREFERRED_WIDTH);
    assert.equal(Layout.popupWidth(480, 1, 1), 480 - Layout.EDGE_MARGIN * 2);
    assert.equal(Layout.popupWidth(1920, 2, 1), Layout.PREFERRED_WIDTH);
    assert.equal(Layout.popupWidth(960, 2, 1), 480 - Layout.EDGE_MARGIN * 2);
    assert.equal(Layout.popupWidth(200, 1, 1), Layout.MINIMUM_WIDTH);
    assert.equal(Layout.popupWidth(0, 1, 1), Layout.PREFERRED_WIDTH);
    assert.equal(Layout.popupWidth(1920, 1, 1.25), Math.round(Layout.PREFERRED_WIDTH * 1.25));
});

test("scroll height leaves room for the header and footer at every work-area size", () => {
    assert.equal(Layout.scrollHeight(1080, 1), 756);
    assert.equal(Layout.scrollHeight(600, 1), 420);
    assert.equal(Layout.scrollHeight(200, 1), Layout.MINIMUM_SCROLL_HEIGHT);
    assert.equal(Layout.scrollHeight(2160, 2), 756);
    assert.equal(Layout.scrollHeight(0, 1), Layout.PREFERRED_SCROLL_HEIGHT);
});

test("the approved reference viewports resolve to complete layout descriptions", () => {
    assert.deepEqual(Layout.popupLayout({
        workAreaWidth: 1920,
        workAreaHeight: 1080,
        scaleFactor: 1,
        textScaleFactor: 1,
    }), {
        mode: "wide",
        styleClass: "xpuwlm-mode-wide",
        widthPx: 560,
        scrollHeightPx: 756,
        metricColumns: 4,
        evidenceColumns: 2,
        wrapText: false,
    });

    assert.deepEqual(Layout.popupLayout({
        workAreaWidth: 480,
        workAreaHeight: 900,
        scaleFactor: 1,
        textScaleFactor: 1,
    }), {
        mode: "compact",
        styleClass: "xpuwlm-mode-compact",
        widthPx: 432,
        scrollHeightPx: 630,
        metricColumns: 2,
        evidenceColumns: 2,
        wrapText: true,
    });

    assert.deepEqual(Layout.popupLayout({
        workAreaWidth: 800,
        workAreaHeight: 1200,
        scaleFactor: 2,
        textScaleFactor: 1,
    }), {
        mode: "dense",
        styleClass: "xpuwlm-mode-dense",
        widthPx: 352,
        scrollHeightPx: 420,
        metricColumns: 2,
        evidenceColumns: 1,
        wrapText: true,
    });

    assert.deepEqual(Layout.popupLayout({
        workAreaWidth: 640,
        workAreaHeight: 800,
        scaleFactor: 1,
        textScaleFactor: 1.5,
    }), {
        mode: "dense",
        styleClass: "xpuwlm-mode-dense",
        widthPx: 592,
        scrollHeightPx: 560,
        metricColumns: 2,
        evidenceColumns: 1,
        wrapText: true,
    });
});

test("an unusable measurement falls back to the default desktop layout", () => {
    const fallback = Layout.defaultLayout();
    assert.deepEqual(fallback, Layout.popupLayout({}));
    assert.deepEqual(fallback, Layout.popupLayout(null));
    assert.deepEqual(fallback, Layout.popupLayout("wide"));
    assert.equal(fallback.mode, "wide");
    assert.equal(Object.isFrozen(fallback), true);
});

test("layout equality tracks only the properties that force a rebuild", () => {
    const wide = Layout.defaultLayout();
    assert.equal(Layout.sameLayout(wide, Layout.defaultLayout()), true);
    assert.equal(Layout.sameLayout(wide, {...wide, widthPx: wide.widthPx - 1}), false);
    assert.equal(Layout.sameLayout(wide, {...wide, scrollHeightPx: 100}), false);
    assert.equal(Layout.sameLayout(wide, {...wide, mode: "dense"}), false);
    assert.equal(Layout.sameLayout(wide, {...wide, metricColumns: 2}), true);
    assert.equal(Layout.sameLayout(null, wide), false);
    assert.equal(Layout.sameLayout(wide, null), false);
});

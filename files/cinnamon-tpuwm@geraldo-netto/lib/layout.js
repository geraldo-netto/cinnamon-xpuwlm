"use strict";

// Cinnamon's St stylesheets have no media queries, so popup responsiveness is
// resolved here as pure data: work-area size, display scale, and text scale in,
// a layout description out. No St, Clutter, or Gio type is referenced.

const PREFERRED_WIDTH = 560;
const MINIMUM_WIDTH = 280;
const COMPACT_MAX_WIDTH = 520;
const DENSE_MAX_WIDTH = 400;
const EDGE_MARGIN = 24;

const PREFERRED_SCROLL_HEIGHT = 480;
const MINIMUM_SCROLL_HEIGHT = 160;
const SCROLL_HEIGHT_FRACTION = 0.55;

const MINIMUM_SCALE = 0.5;
const MAXIMUM_SCALE = 4;

const MODES = Object.freeze(["wide", "compact", "dense"]);
const MODE_STYLE_CLASSES = Object.freeze({
    wide: "tpuwm-mode-wide",
    compact: "tpuwm-mode-compact",
    dense: "tpuwm-mode-dense",
});
const MODE_STYLE_CLASS_LIST = Object.freeze(MODES.map((mode) => MODE_STYLE_CLASSES[mode]));

function normalizeScale(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 1;
    }
    return Math.min(MAXIMUM_SCALE, Math.max(MINIMUM_SCALE, numeric));
}

function logicalPixels(devicePixels, scale) {
    const numeric = Number(devicePixels);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return numeric / normalizeScale(scale);
}

function popupMode(contentWidth) {
    if (contentWidth <= DENSE_MAX_WIDTH) {
        return "dense";
    }
    if (contentWidth <= COMPACT_MAX_WIDTH) {
        return "compact";
    }
    return "wide";
}

function popupWidth(workAreaWidth, scale, textScale) {
    const preferred = PREFERRED_WIDTH * textScale;
    const available = logicalPixels(workAreaWidth, scale);
    if (available === null) {
        return Math.round(preferred);
    }
    return Math.round(Math.max(MINIMUM_WIDTH, Math.min(preferred, available - EDGE_MARGIN * 2)));
}

function scrollHeight(workAreaHeight, scale) {
    const available = logicalPixels(workAreaHeight, scale);
    if (available === null) {
        return PREFERRED_SCROLL_HEIGHT;
    }
    return Math.round(Math.min(
        PREFERRED_SCROLL_HEIGHT,
        Math.max(MINIMUM_SCROLL_HEIGHT, available * SCROLL_HEIGHT_FRACTION),
    ));
}

function popupLayout(measurements = {}) {
    const source = measurements === null || typeof measurements !== "object" ? {} : measurements;
    const scale = normalizeScale(source.scaleFactor);
    const textScale = normalizeScale(source.textScaleFactor);
    const widthPx = popupWidth(source.workAreaWidth, scale, textScale);
    const mode = popupMode(widthPx / textScale);
    return Object.freeze({
        mode,
        styleClass: MODE_STYLE_CLASSES[mode],
        widthPx,
        scrollHeightPx: scrollHeight(source.workAreaHeight, scale),
        metricColumns: mode === "wide" ? 4 : 2,
        evidenceColumns: mode === "dense" ? 1 : 2,
        wrapText: mode !== "wide",
    });
}

function defaultLayout() {
    return popupLayout({});
}

function sameLayout(left, right) {
    if (!left || !right) {
        return false;
    }
    return left.mode === right.mode
        && left.widthPx === right.widthPx
        && left.scrollHeightPx === right.scrollHeightPx;
}

module.exports = {
    COMPACT_MAX_WIDTH,
    DENSE_MAX_WIDTH,
    EDGE_MARGIN,
    MINIMUM_SCROLL_HEIGHT,
    MINIMUM_WIDTH,
    MODES,
    MODE_STYLE_CLASSES,
    MODE_STYLE_CLASS_LIST,
    PREFERRED_SCROLL_HEIGHT,
    PREFERRED_WIDTH,
    defaultLayout,
    logicalPixels,
    normalizeScale,
    popupLayout,
    popupMode,
    popupWidth,
    sameLayout,
    scrollHeight,
};

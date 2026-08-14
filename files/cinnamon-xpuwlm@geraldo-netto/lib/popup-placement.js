"use strict";

// Popup placement is pure domain data. Cinnamon monitor/display lookups stay in
// the host adapter so this calculation remains deterministic and fuzzable.

function finiteNumber(value) {
    return Number.isFinite(value);
}

function positiveFinite(value) {
    return finiteNumber(value) && value > 0;
}

function validWorkArea(workArea) {
    return workArea !== null && typeof workArea === "object"
        && finiteNumber(workArea.x) && finiteNumber(workArea.y)
        && positiveFinite(workArea.width) && positiveFinite(workArea.height);
}

function centeredPopupPosition(workArea, popupWidth, popupHeight) {
    if (!validWorkArea(workArea)
            || !positiveFinite(popupWidth) || !positiveFinite(popupHeight)) {
        return null;
    }
    const horizontalSpace = Math.max(0, workArea.width - popupWidth);
    const verticalSpace = Math.max(0, workArea.height - popupHeight);
    return Object.freeze([
        Math.round(workArea.x + horizontalSpace / 2),
        Math.round(workArea.y + verticalSpace / 2),
    ]);
}

module.exports = {
    centeredPopupPosition,
};

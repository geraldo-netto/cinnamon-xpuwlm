"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Placement = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js");

test("fuzz: centered popups remain symmetric or pin at the work-area origin", () => {
    let seed = 0x58505557;
    for (let iteration = 0; iteration < 8_192; iteration += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const area = {
            x: (seed % 7_681) - 3_840,
            y: ((seed >>> 3) % 4_321) - 2_160,
            width: 1 + ((seed >>> 7) % 7_680),
            height: 1 + ((seed >>> 11) % 4_320),
        };
        const popupWidth = 1 + ((seed >>> 13) % 8_000);
        const popupHeight = 1 + ((seed >>> 17) % 4_600);
        const [x, y] = Placement.centeredPopupPosition(area, popupWidth, popupHeight);

        assert.equal(Number.isInteger(x) && Number.isInteger(y), true);
        assert.ok(x >= area.x && y >= area.y);
        if (popupWidth <= area.width) {
            assert.ok(Math.abs((x - area.x) * 2 - (area.width - popupWidth)) <= 1);
        } else {
            assert.equal(x, area.x);
        }
        if (popupHeight <= area.height) {
            assert.ok(Math.abs((y - area.y) * 2 - (area.height - popupHeight)) <= 1);
        } else {
            assert.equal(y, area.y);
        }
    }
});

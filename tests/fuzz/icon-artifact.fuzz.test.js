"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PAYLOAD_ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto");
const ICON_DIRECTORY = path.join(PAYLOAD_ROOT, "icons");
const PanelStatus = require(path.join(PAYLOAD_ROOT, "lib/panel-status.js"));

// The icons the payload carries, not a list written out beside them: a list
// only fuzzes what someone remembered to add to it, so a new icon shipped to
// every desktop was bounded by nothing.
const ICON_NAMES = Object.freeze(
    fs.readdirSync(ICON_DIRECTORY).filter((name) => name.endsWith(".svg")).sort(),
);
const STATUS_NAMES = PanelStatus.PANEL_STATUSES;

function readIcon(name) {
    return fs.readFileSync(path.join(ICON_DIRECTORY, name), "utf8");
}

function tagById(icon, id) {
    const match = icon.match(new RegExp(`<[^>]+id="${id}"[^>]*>`, "u"));
    assert.ok(match, `missing ${id}`);
    return match[0];
}

function numericAttribute(tag, name) {
    const match = tag.match(new RegExp(`${name}="([0-9.]+)"`, "u"));
    assert.ok(match, `missing ${name}`);
    return Number(match[1]);
}

function geometryNumbers(icon) {
    return [...icon.matchAll(/<(?:circle|path|rect)\b[^>]*>/gu)]
        .flatMap((geometry) => [...geometry[0].matchAll(/(?:^|[=" ,])(-?(?:\d+\.?\d*|\.\d+))/gu)])
        .map((number) => Number(number[1]));
}

test("fuzz: all icon geometries stay visible and bounded across panel sizes", () => {
    const names = ICON_NAMES;
    assert.equal(names.length > 0, true, "the payload ships no icon to fuzz");
    let seed = 0x58545055;

    for (let iteration = 0; iteration < 4_096; iteration += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const icon = readIcon(names[seed % names.length]);
        const root = icon.match(/^<svg[^>]+>/u)[0];
        const viewBox = root.match(/viewBox="([0-9. ]+)"/u)[1].split(" ").map(Number);
        const body = tagById(icon, "chip-body");
        const strokeWidth = Number(icon.match(/stroke-width="([0-9.]+)"/u)[1]);
        const bodyLeft = numericAttribute(body, "x");
        const bodyWidth = numericAttribute(body, "width");
        const panelSize = 16 + (seed % 9);
        const scale = panelSize / viewBox[2];
        const leftPadding = bodyLeft * scale;
        const rightEdge = (bodyLeft + bodyWidth) * scale;

        assert.deepEqual(viewBox, [0, 0, 16, 16]);
        assert.ok(strokeWidth * scale >= 2, "outline fell below two device pixels");
        assert.ok(leftPadding >= 3.5, "chip body lost optical padding");
        assert.ok(rightEdge <= panelSize - 3.5, "chip body escaped the view box");
        assert.match(icon, /id="chip-pins"/u);
        const numbers = geometryNumbers(icon);
        assert.ok(numbers.length >= 20, "icon lost required geometry");
        assert.equal(numbers.every((number) => Number.isFinite(number) && Math.abs(number) <= 16), true);
        if (icon.includes("graph-node-north-west")) {
            const nodeRadius = numericAttribute(tagById(icon, "graph-node-north-west"), "r");
            assert.ok(nodeRadius * 2 * scale >= 2, "graph node lost its compact landmark");
        }
        const status = STATUS_NAMES.find((name) => icon.includes(`id="status-${name}"`));
        if (status) {
            const glyph = tagById(icon, `status-${status}`);
            assert.match(glyph, /paint-order="stroke fill"/u);
        }
    }
});

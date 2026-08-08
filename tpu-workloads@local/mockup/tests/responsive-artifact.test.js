"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function pngSize(filename) {
  const header = fs.readFileSync(filename).subarray(0, 24);
  assert.equal(header.subarray(1, 4).toString("ascii"), "PNG");
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

test("regression: prototype declares maintainable responsive source contracts", () => {
  const html = read("index.html");
  const css = read("styles.css");
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/u);
  assert.match(html, /<script type="module">[\s\S]*responsive-contract\.mjs/u);
  assert.match(html, /document\.body\.dataset\.layout = activeLayout/u);
  assert.match(css, /container-name:\s*tpu-popup/u);
  assert.match(css, /@container tpu-popup \(max-width: 520px\)/u);
  assert.match(css, /@container tpu-popup \(max-width: 400px\)/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.equal((css.match(/\{/gu) || []).length, (css.match(/\}/gu) || []).length);
});

test("regression: compact references wrap content without hiding essential controls", () => {
  const css = read("styles.css");
  const compact = css.slice(css.indexOf("@container tpu-popup (max-width: 520px)"));
  assert.match(compact, /\.profile-copy p[\s\S]*white-space:\s*normal/u);
  assert.match(compact, /\.device-metrics[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(compact, /\.alert-evidence[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(compact, /\.pause-all[\s\S]*min-width:\s*0/u);
  assert.match(compact, /\.compact-primary,[\s\S]*min-height:\s*44px/u);
  for (const essential of [".pause-all", ".tabs", ".popup-footer", ".primary-button"]) {
    const selector = compact.match(new RegExp(`${essential.replace(".", "\\.")}[^}]*\\}`, "u"));
    if (selector) {
      assert.doesNotMatch(selector[0], /display:\s*none/u);
    }
  }
});

test("regression: renderer covers every approval layout and generated artifact", () => {
  const renderer = read("render-responsive-screens.sh");
  const dimensions = {
    wide: [900, 1080],
    narrow: [480, 900],
    "high-scale": [1200, 1800],
    "large-text": [720, 1000],
  };
  for (const [layout, expectedSize] of Object.entries(dimensions)) {
    assert.match(renderer, new RegExp(`render ${layout} [^\n]+layout=${layout}`, "u"));
    const screenshot = path.join(ROOT, "screens", "responsive", `${layout}.png`);
    assert.equal(fs.existsSync(screenshot), true, `${layout} screenshot is required`);
    assert.ok(fs.statSync(screenshot).size > 10_000, `${layout} screenshot must contain rendered pixels`);
    assert.deepEqual(pngSize(screenshot), expectedSize);
  }
  const matrix = path.join(ROOT, "screens", "responsive", "responsive-matrix.png");
  assert.equal(fs.existsSync(matrix), true);
  assert.ok(fs.statSync(matrix).size > 20_000);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {clientRepository} = require("../helpers/sibling-repository.js");

// The one number this applet cannot publish, and somebody else reads anyway.
//
// The service writes the snapshot document; the panel and the Python client
// each read exactly one version of it. When the three disagree the panel draws
// a working runtime as `malformed` and the launcher shows an idle desk — both
// correct, neither saying which half is behind. `xpuwlm verify` in `../xpuwlm`
// asks all three at install time and prints a row for each, and for the panel
// there is nothing to ask: an applet is a panel presence, not a service, so the
// installer reads the constant straight out of the installed source file.
//
// That makes `SNAPSHOT_VERSION` in `lib/snapshot-reader.js` an interface rather
// than a private detail. Renaming it, moving the file, or writing the value as
// anything but a bare integer literal — a computed expression, a frozen object,
// a re-export — leaves the installer reporting "pins no snapshot version"
// against a perfectly good applet, and nothing in this repository would notice.
//
// Two halves, as with the other cross-repository gates here. The first needs
// nothing but this payload and always runs. The second reads the installer's
// own path and pattern out of `../xpuwlm` and holds this payload to them; the
// sibling checkout is not a dependency, so an unavailable one is reported as
// skipped, never as passing.

const repositoryRoot = path.resolve(__dirname, "../..");
const UUID = "cinnamon-xpuwlm@geraldo-netto";
const appletRoot = path.join(repositoryRoot, "files", UUID);
const READER_RELATIVE_PATH = "lib/snapshot-reader.js";
const SnapshotReader = require(path.join(appletRoot, READER_RELATIVE_PATH));

const client = clientRepository();
const SKIP_REASON = client.skipReason;

// The shape the installer's pattern needs, stated here in the strictest form
// that satisfies it: `const`, the name, one bare decimal literal, a semicolon,
// alone on its line. Anything the installer would still match but a reader of
// this file would not recognise is not worth the latitude.
const DECLARATION = /^const SNAPSHOT_VERSION = (\d+);$/mu;

function readerSource() {
    return fs.readFileSync(path.join(appletRoot, READER_RELATIVE_PATH), "utf8");
}

test("the pinned snapshot version is declared where a reader can find it", () => {
    const found = DECLARATION.exec(readerSource());
    assert.ok(
        found,
        `${READER_RELATIVE_PATH} must declare SNAPSHOT_VERSION as one bare integer literal`,
    );
    // And the literal is the value the module exports: a declaration the
    // installer can read but the panel does not use would report a version
    // nothing draws with.
    assert.equal(Number(found[1]), SnapshotReader.SNAPSHOT_VERSION);
});

test("the installer's own path and pattern still resolve this payload", (t) => {
    const installer = client.readText("src/xpuwlm/runtime/installation.py");
    if (installer === null) {
        t.skip(SKIP_REASON);
        return;
    }

    // Read from the installer rather than restated, so a change to either side
    // of this agreement is what fails rather than a copy of it kept here.
    const appletReader = /APPLET_READER\s*=\s*\(?\s*"([^"]+)"/u.exec(installer);
    assert.ok(appletReader, "the installer no longer names an applet reader path");
    assert.equal(
        appletReader[1].endsWith(`/${UUID}/${READER_RELATIVE_PATH}`),
        true,
        `the installer reads ${appletReader[1]}, which this payload does not install`,
    );

    const pinned = /PINNED_VERSION\s*=\s*re\.compile\(\s*r"([^"]+)"/u.exec(installer);
    assert.ok(pinned, "the installer no longer compiles a pinned-version pattern");
    const found = new RegExp(pinned[1], "u").exec(readerSource());
    assert.ok(found, `the installer's pattern ${pinned[1]} finds no version in this payload`);
    assert.equal(Number(found[1]), SnapshotReader.SNAPSHOT_VERSION);
});

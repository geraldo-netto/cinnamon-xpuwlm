"use strict";

// One recursion over a directory tree, for the repository's own scripts.
//
// There were three: `payloadFiles` and `installedFiles` in the packaging
// script and `payloadPaths` in the artifact validator. They differ in policy —
// refuse an irregular entry, list it as the finding, or assert on it — and in
// whether directories are named at all, and those differences are real. The
// walk is not: it is the same descent, the same relative-path join and the
// same total order, and that order is what a release's staged tree, checksum
// manifest and archive all have to agree on. Three copies of it are three
// places that agreement can drift apart without anything saying so.
//
// So the recursion is here once and the policy arrives as an argument.
// `inspect` is called for every entry, directories included, before anything
// descends into one: it is where a walk refuses, records or asserts. What it
// returns is ignored — an entry is dropped by throwing, not by filtering,
// because a payload walk that silently skipped a file would stage a release
// missing it.

const fs = require("node:fs");
const path = require("node:path");

const {compareText} = require("./compare-text.js");

function walkTree(root, inspect, {directories = false} = {}) {
    const names = [];
    const visit = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            inspect(entry, relativePath);
            if (!entry.isDirectory()) {
                names.push(relativePath);
                continue;
            }
            if (directories) {
                names.push(relativePath);
            }
            visit(path.join(directory, entry.name), relativePath);
        }
    };
    visit(root, "");
    // Sorted once over the whole tree rather than at every level. The two are
    // the same order — a subtree's entries all carry its name as a prefix, so
    // they stay contiguous and in the same place among their siblings — and
    // one sort is one place for the comparator to be.
    return names.sort(compareText);
}

module.exports = {walkTree};

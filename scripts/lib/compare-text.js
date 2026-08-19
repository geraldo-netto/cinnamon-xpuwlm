"use strict";

// One total order over names, for the repository's own scripts.
//
// The payload ships no shared module any more — everything it used to hold
// moved to the Python client, which validates against the canonical schemas
// rather than a mirror of them — and this comparator was left written out
// three times over, in the packaging script, the artifact validator, and the
// coverage gate. Three copies of a total order are three places a sort can
// drift: a staged inventory, a checksum manifest and an archive that disagree
// on order are three files that no longer describe the same release.
//
// It lives under scripts/ rather than in the payload deliberately. Nothing the
// desktop loads needs it, and a module beside the applet would have to be
// staged, shimmed and shipped for the sake of a comparator only the build
// uses.
function compareText(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

module.exports = {compareText};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The sibling checkouts, resolved once for every cross-repository gate.
//
// Three contract files each carried their own resolver — one walking a list of
// roots, one taking a single root, one returning file *contents* instead of a
// path — for the same two environment variables and the same skip rule. Three
// copies of a rule that is about to change is three chances for it to change
// in two places.
//
// The rule itself: a sibling repository is not a dependency, so a gate that
// needs one and cannot find it reports itself unavailable rather than passing.
// But an explicitly configured root is a promise. `XPUWLM_OMNITENSOR_ROOT`
// pointing at a typo used to skip exactly as quietly as no checkout at all, so
// the one run asked to prove the cross-repository half proved nothing and said
// it passed. A configured root that does not carry the file is a failure of
// the run, not an unavailable half.

const repositoryRoot = path.resolve(__dirname, "../..");

function createSiblingRepository({fallback, label, variable}) {
    const configured = process.env[variable] || null;
    const root = configured || path.resolve(repositoryRoot, fallback);

    function resolve(relativePath) {
        const candidate = path.join(root, relativePath);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        if (configured !== null) {
            throw new Error(
                `${variable}=${configured} does not carry ${relativePath}: `
                + "a configured checkout that cannot answer this gate is a "
                + "misconfigured run, not an unavailable one",
            );
        }
        return null;
    }

    function readText(relativePath) {
        const filename = resolve(relativePath);
        return filename === null ? null : fs.readFileSync(filename, "utf8");
    }

    function readJson(relativePath) {
        const text = readText(relativePath);
        return text === null ? null : JSON.parse(text);
    }

    return {
        readJson,
        readText,
        resolve,
        root,
        skipReason: `the ${label} checkout is not available; `
            + `set ${variable} to run the cross-repository half of this gate`,
    };
}

function omnitensorRepository() {
    return createSiblingRepository({
        fallback: "../omnitensor",
        label: "OmniTensor",
        variable: "XPUWLM_OMNITENSOR_ROOT",
    });
}

function clientRepository() {
    return createSiblingRepository({
        fallback: "../xpuwlm",
        label: "xpuwlm client",
        variable: "XPUWLM_CLIENT_ROOT",
    });
}

module.exports = {clientRepository, createSiblingRepository, omnitensorRepository, repositoryRoot};

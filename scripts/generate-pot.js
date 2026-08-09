"use strict";

// Deterministic gettext template generation for the applet. Cinnamon harvests
// settings-schema.json and metadata.json text through the xlet UUID text
// domain, so every harvestable string must land in the shipped .pot catalog.
// The output is byte-stable: fixed header, sorted entries, sorted references.

const fs = require("node:fs");
const path = require("node:path");

const UUID = "cinnamon-tpuwm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const appletRoot = path.join(repositoryRoot, "files", UUID);
const potPath = path.join(appletRoot, "po", `${UUID}.pot`);

// The keys cinnamon-json-makepot harvests from an xlet settings schema, plus
// the metadata keys the Spices catalog and the applet list translate.
const SETTINGS_TEXT_KEYS = Object.freeze(["title", "description", "tooltip", "units"]);
const METADATA_TEXT_KEYS = Object.freeze(["name", "description"]);

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

class MessageCatalog {
    constructor() {
        this._entries = new Map();
    }

    add(msgid, reference, msgidPlural = null) {
        if (typeof msgid !== "string" || msgid === "") {
            return false;
        }
        const key = JSON.stringify([msgid, msgidPlural]);
        if (!this._entries.has(key)) {
            this._entries.set(key, {msgid, msgidPlural, references: new Set()});
        }
        this._entries.get(key).references.add(reference);
        return true;
    }

    entries() {
        return [...this._entries.values()]
            .map((entry) => ({
                msgid: entry.msgid,
                msgidPlural: entry.msgidPlural,
                references: [...entry.references].sort(compareText),
            }))
            .sort((left, right) => compareText(left.msgid, right.msgid)
                || compareText(left.msgidPlural || "", right.msgidPlural || ""));
    }
}

function collectSettingsStrings(record, reference, catalog) {
    for (const [key, value] of Object.entries(record)) {
        if (SETTINGS_TEXT_KEYS.includes(key) && typeof value === "string") {
            catalog.add(value, reference);
        } else if (key === "options" && isRecord(value)) {
            for (const label of Object.keys(value)) {
                catalog.add(label, reference);
            }
        } else if (isRecord(value)) {
            collectSettingsStrings(value, reference, catalog);
        }
    }
    return catalog;
}

function collectMetadataStrings(metadata, reference, catalog) {
    for (const key of METADATA_TEXT_KEYS) {
        if (typeof metadata[key] === "string") {
            catalog.add(metadata[key], reference);
        }
    }
    return catalog;
}

function escapePo(text) {
    return text
        .replace(/\\/gu, "\\\\")
        .replace(/"/gu, "\\\"")
        .replace(/\n/gu, "\\n")
        .replace(/\t/gu, "\\t");
}

function potHeader() {
    return [
        "# Translation template for the TPU Workload Manager Cinnamon applet.",
        `# This file is distributed under the same terms as the ${UUID} applet.`,
        "#",
        "#, fuzzy",
        "msgid \"\"",
        "msgstr \"\"",
        `"Project-Id-Version: ${UUID}\\n"`,
        "\"Report-Msgid-Bugs-To: \\n\"",
        "\"POT-Creation-Date: \\n\"",
        "\"MIME-Version: 1.0\\n\"",
        "\"Content-Type: text/plain; charset=UTF-8\\n\"",
        "\"Content-Transfer-Encoding: 8bit\\n\"",
        "\"Plural-Forms: nplurals=2; plural=(n != 1);\\n\"",
    ].join("\n");
}

function formatPotEntry(entry) {
    const lines = [`#: ${entry.references.join(" ")}`, `msgid "${escapePo(entry.msgid)}"`];
    if (entry.msgidPlural === null) {
        lines.push("msgstr \"\"");
    } else {
        lines.push(`msgid_plural "${escapePo(entry.msgidPlural)}"`);
        lines.push("msgstr[0] \"\"");
        lines.push("msgstr[1] \"\"");
    }
    return lines.join("\n");
}

function buildPot(catalog) {
    const sections = [potHeader(), ...catalog.entries().map(formatPotEntry)];
    return `${sections.join("\n\n")}\n`;
}

function readJson(filename) {
    return JSON.parse(fs.readFileSync(path.join(appletRoot, filename), "utf8"));
}

function buildRepositoryCatalog() {
    const catalog = new MessageCatalog();
    collectSettingsStrings(readJson("settings-schema.json"), "settings-schema.json", catalog);
    collectMetadataStrings(readJson("metadata.json"), "metadata.json", catalog);
    return catalog;
}

function buildRepositoryPot() {
    return buildPot(buildRepositoryCatalog());
}

if (require.main === module) {
    const catalog = buildRepositoryCatalog();
    fs.mkdirSync(path.dirname(potPath), {recursive: true});
    fs.writeFileSync(potPath, buildPot(catalog));
    console.log(`gettext template: ${catalog.entries().length} messages -> ${potPath}`);
}

module.exports = {
    METADATA_TEXT_KEYS,
    MessageCatalog,
    SETTINGS_TEXT_KEYS,
    UUID,
    buildPot,
    buildRepositoryCatalog,
    buildRepositoryPot,
    collectMetadataStrings,
    collectSettingsStrings,
    compareText,
    escapePo,
    formatPotEntry,
    isRecord,
    potHeader,
    potPath,
};

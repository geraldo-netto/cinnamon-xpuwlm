"use strict";

// Translation port for shipped modules. Library code never imports GJS
// gettext directly: the applet installs the Cinnamon UUID text domain at
// startup, tests run against the identity fallback, and English msgids double
// as the untranslated UI. All user-visible text flows through _() and
// ngettext() so one catalog covers panel, popup, and accessibility strings.

function identityTranslate(msgid) {
    return msgid;
}

function identityTranslatePlural(singular, plural, count) {
    return count === 1 ? singular : plural;
}

const IDENTITY_TRANSLATOR = Object.freeze({
    translate: identityTranslate,
    translatePlural: identityTranslatePlural,
});

let translator = IDENTITY_TRANSLATOR;

function requireTranslator(candidate) {
    if (!candidate || typeof candidate.translate !== "function"
        || typeof candidate.translatePlural !== "function") {
        throw new TypeError("A translator with translate/translatePlural is required");
    }
    return candidate;
}

function install(candidate) {
    const previous = translator;
    translator = requireTranslator(candidate);
    return previous;
}

function reset() {
    return install(IDENTITY_TRANSLATOR);
}

// No-op extraction marker for strings stored in tables and translated later
// at their lookup site.
function N_(msgid) {
    return msgid;
}

// A broken or empty catalog answer must never blank the UI; the msgid is the
// guaranteed fallback.
function _(msgid) {
    const text = translator.translate(msgid);
    return typeof text === "string" && text !== "" ? text : msgid;
}

function ngettext(singular, plural, count) {
    const text = translator.translatePlural(singular, plural, count);
    if (typeof text === "string" && text !== "") {
        return text;
    }
    return identityTranslatePlural(singular, plural, count);
}

// Positional substitution for translated templates: each %s or %d consumes
// the next value, so translations may reorder words but not placeholders.
function format(template, ...values) {
    let index = 0;
    return String(template).replace(/%[sd]/gu, (token) => {
        if (index >= values.length) {
            return token;
        }
        const value = values[index];
        index += 1;
        return String(value);
    });
}

module.exports = {
    IDENTITY_TRANSLATOR,
    N_,
    _,
    format,
    identityTranslate,
    identityTranslatePlural,
    install,
    ngettext,
    requireTranslator,
    reset,
};

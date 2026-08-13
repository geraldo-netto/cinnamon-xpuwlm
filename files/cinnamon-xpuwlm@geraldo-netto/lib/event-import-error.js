"use strict";

class EventImportError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "EventImportError";
        this.code = code;
        this.detail = detail;
    }
}

module.exports = {EventImportError};

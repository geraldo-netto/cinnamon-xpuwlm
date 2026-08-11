"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

const MAXIMUM_BYTES = 64;

function nextRandom(state) {
    return ((state * 1664525) + 1013904223) >>> 0;
}

function environmentFor(entry) {
    const Gio = {
        FileQueryInfoFlags: {NONE: 0, NOFOLLOW_SYMLINKS: 1},
        IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 19},
        FileType: {REGULAR: 1, DIRECTORY: 2, SYMBOLIC_LINK: 3, SPECIAL: 4},
        File: {
            new_for_path: () => ({
                query_info: () => ({
                    get_file_type: () => entry.type,
                    get_size: () => entry.declaredSize,
                    get_attribute_uint64: () => 1,
                    get_attribute_uint32: () => 1,
                }),
                read: () => {
                    let consumed = false;
                    return {
                        query_info: () => ({
                            get_attribute_uint64: () => 1,
                            get_attribute_uint32: () => 1,
                        }),
                        read_bytes: (count) => {
                            const text = consumed ? "" : entry.contents.slice(0, count);
                            consumed = true;
                            return {get_data: () => text};
                        },
                        close() {},
                    };
                },
            }),
        },
    };
    return {Gio, ByteArray: {toString: (bytes) => String(bytes)}, GLib: {}};
}

// The reader must accept exactly the regular files whose declared and actual
// sizes both fit the budget, and must never return truncated content.
test("property: bounded manifest reads accept exactly the in-budget regular files", () => {
    let state = 0xC0FFEE;
    for (let round = 0; round < 400; round += 1) {
        state = nextRandom(state);
        const actualLength = state % (MAXIMUM_BYTES * 2 + 2);
        state = nextRandom(state);
        const declaredSize = state % (MAXIMUM_BYTES * 2 + 2);
        state = nextRandom(state);
        const type = [1, 2, 3, 4][state % 4];
        const entry = {
            contents: "m".repeat(actualLength),
            declaredSize,
            type,
        };
        const environment = environmentFor(entry);
        const expectAccept = type === 1
            && declaredSize <= MAXIMUM_BYTES
            && actualLength <= MAXIMUM_BYTES;
        if (expectAccept) {
            assert.equal(
                Cinnamon.readBoundedRegularFileText("/fuzz", environment, MAXIMUM_BYTES),
                entry.contents,
            );
        } else {
            assert.throws(() => Cinnamon.readBoundedRegularFileText("/fuzz", environment, MAXIMUM_BYTES));
        }
    }
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Port = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-source-port.js");

function environment() {
    const infos = new Map();
    return {
        ByteArray: {},
        Gio: {
            FileType: {REGULAR: 1, SYMBOLIC_LINK: 2},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
            File: {new_for_path(path) {
                return {
                    get_path: () => path,
                    get_basename: () => path.split("/").at(-1),
                    query_info() {
                        const item = infos.get(path);
                        return {
                            get_file_type: () => item.type,
                            get_name: () => item.name,
                            get_size: () => item.size,
                        };
                    },
                };
            }},
        },
        infos,
    };
}

test("media picker delegates one explicit filtered selection and describes it", () => {
    const env = environment();
    env.infos.set("/private/clip.mp4", {type: 1, name: "clip.mp4", size: 42});
    let request = null;
    const picker = Port.createExternalMediaPicker(env, {
        choose(options, callback) { request = {options, callback}; return true; },
        dispose() { return true; },
    });
    let reply = null;
    assert.equal(picker.chooseFiles((error, sources) => { reply = {error, sources}; }), true);
    assert.equal(request.options.mode, "open");
    assert.equal(request.options.multiple, false);
    assert.equal(request.options.title, "Choose media to transcribe");
    assert.ok(request.options.filter.patterns.includes("*.mp4"));
    assert.ok(request.options.filter.patterns.includes("*.WAV"));
    assert.ok(request.options.filter.patterns.includes("*.pdf"));
    assert.ok(request.options.filter.patterns.includes("*.SVG"));
    assert.ok(request.options.filter.patterns.includes("*.tiff"));
    request.callback(null, ["/private/clip.mp4"]);
    assert.deepEqual(reply, {
        error: null,
        sources: [{
            path: "/private/clip.mp4", name: "clip.mp4", size: 42,
            regular: true, symlink: false,
        }],
    });
});

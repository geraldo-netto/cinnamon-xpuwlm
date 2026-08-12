"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

function pseudoRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state;
    };
}

function asynchronousStateEnvironment() {
    const pending = [];
    const written = [];
    const file = {
        get_parent: () => ({query_exists: () => true}),
        replace_contents_async(text, _etag, _backup, _flags, _cancellable, callback) {
            pending.push({text, callback});
        },
        replace_contents_finish(result) {
            written.push(result.text);
            return true;
        },
        replace_contents(text) { written.push(text); },
    };
    return {
        pending,
        written,
        finish() {
            const entry = pending.shift();
            entry.callback(file, {text: entry.text});
        },
        environment: {
            GLib: {get_home_dir: () => "/home/tester", file_get_contents: () => [false, null]},
            ByteArray: {toString: String},
            Gio: {
                Cancellable: class { cancel() {} },
                FileCreateFlags: {REPLACE_DESTINATION: 2},
                FileQueryInfoFlags: {NONE: 0},
                File: {new_for_path: () => file},
            },
        },
    };
}

test("fuzz: state bursts retain order, bound writes, and persist the newest transition", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const random = pseudoRandom(seed);
        const count = 1 + random() % 100;
        const io = asynchronousStateEnvironment();
        const repository = new Cinnamon.FileStateRepository({
            path: "/state.json", environment: io.environment,
        });
        const completions = Array(count).fill(0);
        for (let index = 0; index < count; index += 1) {
            repository.save({
                portfolio: {paused: random() % 2 === 0},
                selectedTab: `tab-${index}`,
                activityClearedAt: random(),
            }, (error) => {
                assert.equal(error, null, `seed ${seed}, state ${index}`);
                completions[index] += 1;
            });
        }

        assert.equal(io.pending.length, 1, `seed ${seed}: one active write`);
        io.finish();
        if (count > 1) {
            assert.equal(io.pending.length, 1, `seed ${seed}: one coalesced write`);
            io.finish();
        }

        assert.equal(io.pending.length, 0, `seed ${seed}: queue drained`);
        assert.ok(io.written.length <= 2, `seed ${seed}: bounded filesystem writes`);
        assert.equal(JSON.parse(io.written.at(-1)).selectedTab, `tab-${count - 1}`);
        assert.deepEqual(completions, Array(count).fill(1), `seed ${seed}: callbacks settle once`);
    }
});

function imageInfo(name, regular) {
    return {
        get_name: () => name,
        get_file_type: () => regular ? 1 : 2,
    };
}

test("fuzz: asynchronous input batches accept only bounded regular images", () => {
    const suffixes = [".png", ".JPG", ".webp", ".txt", ".png.exe", ".tiff"];
    for (let seed = 1; seed <= 200; seed += 1) {
        const random = pseudoRandom(seed);
        const entries = [];
        const expected = [];
        const count = random() % 200;
        for (let index = 0; index < count; index += 1) {
            const name = `item-${index}${suffixes[random() % suffixes.length]}`;
            const regular = random() % 5 !== 0;
            entries.push(imageInfo(name, regular));
            if (regular && Cinnamon.isImageFilename(name) && expected.length < Cinnamon.MAX_INPUT_FILES) {
                expected.push(name);
            }
        }
        let offset = 0;
        let closed = 0;
        const enumerator = {
            next_files_async(size, _priority, _cancellable, callback) {
                callback(this, {size});
            },
            next_files_finish({size}) {
                const batch = entries.slice(offset, offset + size);
                offset += batch.length;
                return batch;
            },
            close_async(_priority, _cancellable, callback) { callback(this, {}); },
            close_finish() { closed += 1; },
        };
        let result = null;
        Cinnamon.collectInputImagesAsync(
            enumerator,
            {Gio: {FileType: {REGULAR: 1}, IOErrorEnum: {CANCELLED: 19}}},
            null,
            [],
            (error, names) => { result = {error, names}; },
        );

        assert.equal(result.error, null, `seed ${seed}`);
        assert.deepEqual(result.names, expected.sort(), `seed ${seed}`);
        assert.equal(closed, 1, `seed ${seed}: enumerator closed once`);
    }
});

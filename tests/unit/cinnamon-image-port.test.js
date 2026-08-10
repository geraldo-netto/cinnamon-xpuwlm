"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");

// The Cinnamon side of turning a picture into a model's input: GdkPixbuf for
// the decode, GIO for the write and the directory listing, GLib for the digest
// the service will recompute. Faked here at the GI boundary, so the rules this
// layer enforces — regular files only, a byte ceiling before the decode, an
// exact scale, a digest over the bytes actually staged — are checked without a
// display server.

const ROOT = "/home/tester/omnitensor-inputs";

function ioError(env, name) {
    const code = env.Gio.IOErrorEnum[name];
    return {
        matches: (enumeration, candidate) => enumeration === env.Gio.IOErrorEnum
            && candidate === code,
    };
}

class FakeFile {
    constructor(path, env) {
        this.path = path;
        this.env = env;
    }

    entry() {
        return this.env.files.get(this.path);
    }

    query_exists() {
        return this.env.files.has(this.path) || this.env.directories.has(this.path);
    }

    get_parent() {
        const parent = this.path.slice(0, this.path.lastIndexOf("/"));
        return parent === "" ? null : new FakeFile(parent, this.env);
    }

    make_directory_with_parents() {
        this.env.created.push(this.path);
        this.env.directories.add(this.path);
        return true;
    }

    query_info() {
        const entry = this.entry();
        if (entry === undefined) {
            throw ioError(this.env, "NOT_FOUND");
        }
        return {
            get_file_type: () => entry.type ?? this.env.Gio.FileType.REGULAR,
            get_size: () => entry.size ?? 0,
        };
    }

    read_async(priority, cancellable, callback) {
        this.env.reads.push(this.path);
        callback(this, {});
    }

    read_finish() {
        const entry = this.entry();
        if (entry.readError) {
            throw entry.readError;
        }
        return {stream: this.path};
    }

    replace_contents_bytes_async(bytes, etag, backup, flags, cancellable, callback) {
        this.env.written.push({path: this.path, bytes: bytes.data});
        callback(this, {failed: this.env.writeFails});
    }

    replace_contents_finish(result) {
        if (result.failed) {
            throw new Error("no space left on device");
        }
        return true;
    }

    delete() {
        if (this.env.deleteThrows) {
            throw new Error("read-only file system");
        }
        this.env.deleted.push(this.path);
        return true;
    }

    enumerate_children() {
        const names = (this.env.listings[this.path] || []).slice();
        let index = 0;
        const env = this.env;
        return {
            next_file() {
                if (index >= names.length) {
                    return null;
                }
                const entry = names[index];
                index += 1;
                return {
                    get_name: () => entry.name,
                    get_file_type: () => entry.type ?? env.Gio.FileType.REGULAR,
                };
            },
            close() {
                env.closed += 1;
            },
        };
    }
}

function environment(overrides = {}) {
    const env = {
        files: new Map(),
        directories: new Set(),
        listings: {},
        created: [],
        written: [],
        deleted: [],
        reads: [],
        closed: 0,
        writeFails: false,
        deleteThrows: false,
        scaled: [],
        decodeThrows: null,
        ...overrides,
    };
    env.Gio = {
        File: {new_for_path: (path) => new FakeFile(path, env)},
        FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        FileCreateFlags: {REPLACE_DESTINATION: 2},
        FileType: {REGULAR: 1, DIRECTORY: 2},
        IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 19},
    };
    env.GLib = {
        get_home_dir: () => "/home/tester",
        Bytes: class {
            constructor(data) {
                this.data = data;
            }
        },
        ChecksumType: {SHA256: 2},
        compute_checksum_for_bytes(kind, bytes) {
            return `${kind}:${bytes.data.length}`;
        },
    };
    env.GdkPixbuf = {
        Pixbuf: {
            new_from_stream_at_scale_async(stream, width, height, preserve, cancellable, callback) {
                env.scaled.push({stream: stream.stream, width, height, preserve});
                callback(this, {width, height});
            },
            new_from_stream_finish(result) {
                if (env.decodeThrows !== null) {
                    throw env.decodeThrows;
                }
                const channels = env.channels ?? 3;
                const rowstride = (result.width * channels) + (env.padding ?? 0);
                return {
                    get_width: () => result.width,
                    get_height: () => result.height,
                    get_n_channels: () => channels,
                    get_rowstride: () => rowstride,
                    get_pixels: () => new Uint8Array(
                        ((result.height - 1) * rowstride) + (result.width * channels),
                    ),
                };
            },
        },
    };
    return env;
}

function picture(env, path, size = 4096) {
    env.files.set(path, {size});
}

function decode(env, path, geometry = {width: 8, height: 8}) {
    return new Promise((resolve) => {
        Cinnamon.decodeImageAsync(path, geometry, env, {}, (error, image) => {
            resolve({error, image});
        });
    });
}

test("a picture is decoded to exactly the size the model declares", async () => {
    const env = environment({padding: 2});
    picture(env, `${ROOT}/cat.png`);

    const {error, image} = await decode(env, `${ROOT}/cat.png`, {width: 8, height: 8});

    assert.equal(error, null);
    assert.deepEqual(env.scaled[0], {stream: `${ROOT}/cat.png`, width: 8, height: 8, preserve: false});
    assert.equal(image.width, 8);
    assert.equal(image.height, 8);
    assert.equal(image.channels, 3);
    assert.equal(image.rowstride, 26);
    assert.ok(image.pixels instanceof Uint8Array);
    // The last row carries no rowstride padding, which is what GdkPixbuf
    // actually returns and what the encoder is written to survive.
    assert.equal(image.pixels.length, (7 * 26) + 24);
});

test("a picture is refused before it is decoded, not after", async () => {
    const env = environment();
    env.files.set(`${ROOT}/huge.png`, {size: Cinnamon.MAX_IMAGE_BYTES + 1});
    env.files.set(`${ROOT}/pipe`, {size: 1, type: env.Gio.FileType.DIRECTORY});

    const huge = await decode(env, `${ROOT}/huge.png`);
    const directory = await decode(env, `${ROOT}/pipe`);
    const absent = await decode(env, `${ROOT}/gone.png`);

    assert.match(String(huge.error), /exceeds/u);
    assert.match(String(directory.error), /Not a regular file/u);
    assert.ok(absent.error !== null);
    assert.deepEqual(env.scaled, [], "nothing reached the decoder");
});

test("a decode failure is reported rather than turned into a blank picture", async () => {
    const env = environment();
    picture(env, `${ROOT}/broken.png`);
    env.decodeThrows = new Error("Unrecognized image file format");

    const {error, image} = await decode(env, `${ROOT}/broken.png`);

    assert.match(String(error), /Unrecognized/u);
    assert.equal(image, null);
});

test("a cancelled decode never calls back at all", async () => {
    const env = environment();
    picture(env, `${ROOT}/cat.png`);
    env.decodeThrows = ioError(env, "CANCELLED");
    let called = false;

    Cinnamon.decodeImageAsync(`${ROOT}/cat.png`, {width: 4, height: 4}, env, {}, () => {
        called = true;
    });

    assert.equal(called, false);
});

test("an environment without an image decoder says so instead of failing later", async () => {
    const env = environment();
    picture(env, `${ROOT}/cat.png`);
    delete env.GdkPixbuf;

    const {error} = await decode(env, `${ROOT}/cat.png`);

    assert.match(String(error), /No image decoder/u);
});

test("the staged buffer is written under a directory that is created if absent", () => {
    const env = environment();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const completions = [];

    Cinnamon.writeBufferAsync(`${ROOT}/.tpuwm-staged/x.f32`, bytes, env, (error) => {
        completions.push(error);
    });

    assert.deepEqual(env.created, [`${ROOT}/.tpuwm-staged`]);
    assert.equal(env.written[0].bytes, bytes);
    assert.deepEqual(completions, [null]);
});

test("an existing staging directory is not created again", () => {
    const env = environment();
    env.directories.add(`${ROOT}/.tpuwm-staged`);
    const completions = [];

    Cinnamon.writeBufferAsync(`${ROOT}/.tpuwm-staged/x.f32`, new Uint8Array(4), env, (error) => {
        completions.push(error);
    });

    assert.deepEqual(env.created, []);
    assert.deepEqual(completions, [null]);
});

test("a write that cannot even be started is reported like one that fails", () => {
    const env = environment();
    env.Gio.File.new_for_path = () => {
        throw new Error("no such device");
    };
    const completions = [];

    Cinnamon.writeBufferAsync("/x.f32", new Uint8Array(4), env, (error) => completions.push(error));

    assert.match(String(completions[0]), /no such device/u);
});

test("a write that fails is reported, never silently dropped", () => {
    const env = environment({writeFails: true});
    const completions = [];

    Cinnamon.writeBufferAsync(`${ROOT}/.tpuwm-staged/x.f32`, new Uint8Array(4), env, (error) => {
        completions.push(error);
    });

    assert.match(String(completions[0]), /no space/u);
});

test("a buffer that cannot be removed is not a failure of the job", () => {
    const env = environment({deleteThrows: true});

    assert.equal(Cinnamon.removeFile(`${ROOT}/.tpuwm-staged/x.f32`, env), false);

    const clean = environment();
    assert.equal(Cinnamon.removeFile(`${ROOT}/.tpuwm-staged/x.f32`, clean), true);
    assert.deepEqual(clean.deleted, [`${ROOT}/.tpuwm-staged/x.f32`]);
});

test("the digest is computed over the bytes that were staged", () => {
    const env = environment();

    assert.equal(Cinnamon.digestBytes(new Uint8Array(7), env), "2:7");
});

test("only pictures are listed, and never the staging directory", () => {
    const env = environment();
    env.directories.add(ROOT);
    env.listings[ROOT] = [
        {name: "zebra.PNG"},
        {name: "cat.png"},
        {name: "notes.txt"},
        {name: ".hidden.png"},
        {name: ".tpuwm-staged", type: env.Gio.FileType.DIRECTORY},
        {name: "photo.jpeg"},
    ];

    assert.deepEqual(Cinnamon.listInputImages(ROOT, env), ["cat.png", "photo.jpeg", "zebra.PNG"]);
    assert.equal(env.closed, 1, "the enumerator is closed even on the happy path");
});

test("an input root that does not exist lists nothing rather than failing", () => {
    assert.deepEqual(Cinnamon.listInputImages("/absent", environment()), []);
});

test("every accepted suffix is recognised and nothing else is", () => {
    for (const suffix of Cinnamon.IMAGE_SUFFIXES) {
        assert.ok(Cinnamon.isImageFilename(`holiday${suffix}`), suffix);
        assert.ok(Cinnamon.isImageFilename(`holiday${suffix.toUpperCase()}`), suffix);
    }
    assert.ok(!Cinnamon.isImageFilename("holiday.png.txt"));
    assert.ok(!Cinnamon.isImageFilename(".png"));
    assert.ok(!Cinnamon.isImageFilename("holiday"));
});

test("the catalog gathers every root and survives one it cannot read", () => {
    const env = environment();
    env.directories.add(ROOT);
    env.listings[ROOT] = [{name: "cat.png"}];
    const warnings = [];
    const catalog = Cinnamon.createInputCatalog(env, {warn: (message) => warnings.push(message)});

    assert.deepEqual(catalog.pictures([ROOT]), [
        {root: ROOT, name: "cat.png", path: `${ROOT}/cat.png`},
    ]);

    env.directories.add("/broken");
    env.listings["/broken"] = null;
    Object.defineProperty(env.listings, "/broken", {
        get() {
            throw new Error("permission denied");
        },
    });

    assert.deepEqual(catalog.pictures(["/broken"]), []);
    assert.match(warnings[0], /Could not list runtime input root/u);
});

test("the catalog is bounded however many roots are published", () => {
    const env = environment();
    const roots = [];
    for (let index = 0; index < 4; index += 1) {
        const root = `/root${index}`;
        roots.push(root);
        env.directories.add(root);
        env.listings[root] = Array.from({length: 40}, (_unused, item) => ({name: `p${item}.png`}));
    }
    const catalog = Cinnamon.createInputCatalog(env, {warn() {}});

    assert.equal(catalog.pictures(roots).length, Cinnamon.MAX_INPUT_FILES);
});

test("the image port exposes exactly what a submitter needs", async () => {
    const env = environment();
    picture(env, `${ROOT}/cat.png`);
    const port = Cinnamon.createImagePort(env);
    const completions = [];

    const image = await new Promise((resolve) => {
        port.decode(`${ROOT}/cat.png`, {width: 2, height: 2}, (error, decoded) => resolve(decoded));
    });
    port.write(`${ROOT}/.tpuwm-staged/x.f32`, new Uint8Array(8), (error) => completions.push(error));

    assert.equal(image.width, 2);
    assert.deepEqual(completions, [null]);
    assert.equal(port.digest(new Uint8Array(3)), "2:3");
    assert.equal(port.remove(`${ROOT}/.tpuwm-staged/x.f32`), true);
});

test("a job submission is sent to the versioned SubmitJob endpoint", () => {
    const env = environment();
    const calls = [];
    env.Gio.DBusCallFlags = {NONE: 0};
    env.Gio.DBus = {
        session: {
            call(...args) {
                calls.push(args);
                args.at(-1)({call_finish: () => ({deep_unpack: () => ["{}"]})}, {});
            },
        },
    };
    env.GLib.Variant = class {
        constructor(signature, values) {
            this.signature = signature;
            this.values = values;
        }
    };
    env.GLib.VariantType = class {
        constructor(signature) {
            this.signature = signature;
        }
    };
    const completions = [];

    Cinnamon.submitRuntimeJobText("submission", {cancellable: null}, (...args) => {
        completions.push(args);
    }, env);

    assert.deepEqual(calls[0].slice(0, 4), [
        Cinnamon.CONTROL_BUS_NAME,
        Cinnamon.CONTROL_OBJECT_PATH,
        Cinnamon.CONTROL_INTERFACE,
        Cinnamon.SUBMIT_JOB_METHOD,
    ]);
    assert.equal(calls[0][4].values[0], "submission");
    assert.deepEqual(completions, [[null, "{}"]]);
});

test("the job gateway reaches the same endpoint through its own transport", () => {
    const env = environment();
    const calls = [];
    env.Gio.DBusCallFlags = {NONE: 0};
    env.Gio.Cancellable = class {
        cancel() {
            this.cancelled = true;
        }
    };
    env.Gio.DBus = {
        session: {
            call(...args) {
                calls.push(args[3]);
                args.at(-1)({
                    call_finish: () => ({
                        deep_unpack: () => [JSON.stringify({
                            version: 1,
                            requestId: "tpuwm-1-1",
                            jobId: "job-1",
                            status: "accepted",
                            code: "job-accepted",
                            message: "Job accepted",
                            timestamp: 1,
                        })],
                    }),
                }, {});
            },
        },
    };
    env.GLib.Variant = class {
        constructor(signature, values) {
            this.signature = signature;
            this.values = values;
        }
    };
    env.GLib.VariantType = class {
        constructor(signature) {
            this.signature = signature;
        }
    };
    const replies = [];

    Cinnamon.createRuntimeJobGateway(env).submit({
        version: 1,
        requestId: "tpuwm-1-1",
        workloadId: "visual-library",
        payload: {inputRefs: [{
            path: `${ROOT}/.tpuwm-staged/x.f32`,
            shape: [1, 3, 2, 2],
            dtype: "float32",
            sha256: "a".repeat(64),
        }]},
    }, (error, reply) => replies.push([error, reply]));

    assert.deepEqual(calls, [Cinnamon.SUBMIT_JOB_METHOD]);
    assert.equal(replies[0][1].jobId, "job-1");
});

test("a poll reaches the versioned GetJobResult endpoint", () => {
    const env = environment();
    const calls = [];
    env.Gio.DBusCallFlags = {NONE: 0};
    env.Gio.DBus = {
        session: {
            call(...args) {
                calls.push(args[3]);
                args.at(-1)({call_finish: () => ({deep_unpack: () => ["{}"]})}, {});
            },
        },
    };
    env.GLib.Variant = class {
        constructor(signature, values) {
            this.signature = signature;
            this.values = values;
        }
    };
    env.GLib.VariantType = class {
        constructor(signature) {
            this.signature = signature;
        }
    };
    const completions = [];

    Cinnamon.requestRuntimeJobResultText("request", {cancellable: null}, (...args) => {
        completions.push(args);
    }, env);

    assert.deepEqual(calls, [Cinnamon.JOB_RESULT_METHOD]);
    assert.deepEqual(completions, [[null, "{}"]]);

    // The gateway's own result channel reaches the same endpoint, so the
    // factory is wired to the method and not merely capable of being.
    env.Gio.Cancellable = class {
        cancel() {
            this.cancelled = true;
        }
    };
    const gateway = Cinnamon.createRuntimeJobGateway(env);
    assert.equal(gateway.pollable, true);
    gateway.requestResult({requestId: "tpuwm-1-2", jobId: "job-1"}, () => {});
    assert.deepEqual(calls, [Cinnamon.JOB_RESULT_METHOD, Cinnamon.JOB_RESULT_METHOD]);
});

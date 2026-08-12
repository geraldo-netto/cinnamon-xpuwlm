"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

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

function pixbuf(env, width, height) {
    const channels = env.channels ?? 3;
    const rowstride = (width * channels) + (env.padding ?? 0);
    return {
        get_width: () => width,
        get_height: () => height,
        get_n_channels: () => channels,
        get_rowstride: () => rowstride,
        get_pixels: () => new Uint8Array(((height - 1) * rowstride) + (width * channels)),
        new_subpixbuf(x, y, w, h) {
            env.crops.push({x, y, w, h});
            return pixbuf(env, w, h);
        },
        scale_simple(w, h, interp) {
            env.resamples.push({w, h, interp});
            return pixbuf(env, w, h);
        },
    };
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
        crops: [],
        resamples: [],
        sourceSize: [1000, 500],
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
        InterpType: {NEAREST: 0, TILES: 1, BILINEAR: 2, HYPER: 3},
        Pixbuf: {
            get_file_info() {
                return [null, ...(env.sourceSize ?? [0, 0])];
            },
            new_from_stream_at_scale_async(stream, width, height, preserve, cancellable, callback) {
                env.scaled.push({stream: stream.stream, width, height, preserve});
                callback(this, {width, height});
            },
            new_from_stream_finish(result) {
                if (env.decodeThrows !== null) {
                    throw env.decodeThrows;
                }
                return pixbuf(env, result.width, result.height);
            },
        },
    };
    return env;
}

function asyncListingEnvironment(listings = {}) {
    const env = environment();
    env.listings = listings;
    env.enumerations = [];
    class Cancellable {
        constructor() { this.cancelled = false; }
        cancel() { this.cancelled = true; }
        is_cancelled() { return this.cancelled; }
    }
    env.Gio.Cancellable = Cancellable;
    env.Gio.File.new_for_path = (root) => {
        const source = {
            enumerate_children_async(attributes, flags, priority, cancellable, callback) {
                env.enumerations.push({source, attributes, flags, priority, cancellable, callback});
            },
            enumerate_children_finish() {
                if (env.enumerateError?.[root]) {
                    throw env.enumerateError[root];
                }
                const entries = [...(env.listings[root] || [])];
                let index = 0;
                return {
                    next_files_async(count, priority, cancellable, callback) {
                        callback(this, {count, priority, cancellable});
                    },
                    next_files_finish(result) {
                        if (result.cancellable?.is_cancelled()) {
                            throw ioError(env, "CANCELLED");
                        }
                        const batch = entries.slice(index, index + result.count).map((entry) => ({
                            get_name: () => entry.name,
                            get_file_type: () => entry.type ?? env.Gio.FileType.REGULAR,
                        }));
                        index += batch.length;
                        return batch;
                    },
                    close_async(priority, cancellable, callback) {
                        callback(this, {priority, cancellable});
                    },
                    close_finish() {
                        env.closed += 1;
                        return true;
                    },
                };
            },
        };
        return source;
    };
    env.completeEnumeration = () => {
        const request = env.enumerations.shift();
        request.callback(request.source, {});
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

    Cinnamon.writeBufferAsync(`${ROOT}/.xpuwlm-staged/x.f32`, bytes, env, (error) => {
        completions.push(error);
    });

    assert.deepEqual(env.created, [`${ROOT}/.xpuwlm-staged`]);
    assert.equal(env.written[0].bytes, bytes);
    assert.deepEqual(completions, [null]);
});

test("an existing staging directory is not created again", () => {
    const env = environment();
    env.directories.add(`${ROOT}/.xpuwlm-staged`);
    const completions = [];

    Cinnamon.writeBufferAsync(`${ROOT}/.xpuwlm-staged/x.f32`, new Uint8Array(4), env, (error) => {
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

    Cinnamon.writeBufferAsync(`${ROOT}/.xpuwlm-staged/x.f32`, new Uint8Array(4), env, (error) => {
        completions.push(error);
    });

    assert.match(String(completions[0]), /no space/u);
});

test("a buffer that cannot be removed is not a failure of the job", () => {
    const env = environment({deleteThrows: true});

    assert.equal(Cinnamon.removeFile(`${ROOT}/.xpuwlm-staged/x.f32`, env), false);

    const clean = environment();
    assert.equal(Cinnamon.removeFile(`${ROOT}/.xpuwlm-staged/x.f32`, clean), true);
    assert.deepEqual(clean.deleted, [`${ROOT}/.xpuwlm-staged/x.f32`]);
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
        {name: ".xpuwlm-staged", type: env.Gio.FileType.DIRECTORY},
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

    assert.deepEqual(catalog.pictures([ROOT]).pictures, [
        {root: ROOT, name: "cat.png", path: `${ROOT}/cat.png`},
    ]);

    env.directories.add("/broken");
    env.listings["/broken"] = null;
    Object.defineProperty(env.listings, "/broken", {
        get() {
            throw new Error("permission denied");
        },
    });

    assert.deepEqual(catalog.pictures(["/broken"]).pictures, []);
    assert.match(warnings[0], /Could not list runtime input root/u);
});

test("the cap is shared across roots rather than won by the first", () => {
    const env = environment();
    const roots = [];
    for (let index = 0; index < 4; index += 1) {
        const root = `/root${index}`;
        roots.push(root);
        env.directories.add(root);
        env.listings[root] = Array.from({length: 40}, (_unused, item) => ({name: `p${item}.png`}));
    }
    const catalog = Cinnamon.createInputCatalog(env, {warn() {}});

    const listed = catalog.pictures(roots);
    const perRoot = new Set(listed.pictures.map((entry) => entry.root));

    assert.equal(perRoot.size, roots.length, "every root is represented, not just the first");
    assert.ok(listed.pictures.length <= Cinnamon.MAX_INPUT_FILES);
    assert.ok(listed.omitted > 0, "and what was left out is counted rather than hidden");
});

test("the production input catalog lists roots asynchronously and keeps bounds", () => {
    const roots = ["/first", "/second"];
    const env = asyncListingEnvironment(Object.fromEntries(roots.map((root, rootIndex) => [
        root,
        [
            {name: "notes.txt"},
            ...Array.from({length: 40}, (_unused, index) => ({
                name: `${rootIndex}-${String(index).padStart(2, "0")}.png`,
            })),
            {name: ".hidden.png"},
        ],
    ])));
    const warnings = [];
    const catalog = Cinnamon.createInputCatalog(env, {warn: (message) => warnings.push(message)});
    const completions = [];

    const cancel = catalog.picturesAsync(roots, (error, listed) => completions.push({error, listed}));
    assert.equal(typeof cancel, "function");
    assert.deepEqual(completions, [], "enumeration never completes in caller's stack");
    env.completeEnumeration();
    assert.deepEqual(completions, [], "roots are sequenced, not fanned out without a bound");
    env.completeEnumeration();

    assert.equal(completions.length, 1);
    assert.equal(completions[0].error, null);
    assert.equal(completions[0].listed.pictures.length, Cinnamon.MAX_INPUT_FILES);
    assert.equal(new Set(completions[0].listed.pictures.map((entry) => entry.root)).size, 2);
    assert.equal(completions[0].listed.omitted, 16);
    assert.equal(env.closed, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /16 picture/u);
});

test("asynchronous input listing cancels cleanly and isolates one unreadable root", () => {
    const denied = new Error("permission denied");
    const env = asyncListingEnvironment({"/good": [{name: "cat.png"}]});
    env.enumerateError = {"/broken": denied};
    const warnings = [];
    const catalog = Cinnamon.createInputCatalog(env, {warn: (message) => warnings.push(message)});
    const completions = [];
    catalog.picturesAsync(["/broken", "/good"], (error, listed) => completions.push({error, listed}));
    env.completeEnumeration();
    assert.match(warnings[0], /permission denied/u);
    env.completeEnumeration();
    assert.deepEqual(completions[0], {
        error: null,
        listed: {pictures: [{root: "/good", name: "cat.png", path: "/good/cat.png"}], omitted: 0},
    });

    const cancelled = [];
    const cancel = catalog.picturesAsync(["/good"], (error, listed) => cancelled.push({error, listed}));
    assert.equal(cancel(), true);
    assert.equal(cancel(), false);
    env.completeEnumeration();
    assert.deepEqual(cancelled, []);
    assert.throws(() => catalog.picturesAsync([], null), /callback/u);
});

test("asynchronous input listing reports absent and synchronous start failures", () => {
    const absent = asyncListingEnvironment();
    absent.enumerateError = {"/missing": ioError(absent, "NOT_FOUND")};
    const absentReplies = [];
    Cinnamon.listInputImagesAsync(
        "/missing", absent, new absent.Gio.Cancellable(),
        (error, names) => absentReplies.push({error, names}),
    );
    absent.completeEnumeration();
    assert.deepEqual(absentReplies, [{error: null, names: []}]);

    const failed = asyncListingEnvironment();
    failed.Gio.File.new_for_path = () => ({
        enumerate_children_async() { throw new Error("enumeration could not start"); },
    });
    const failures = [];
    Cinnamon.listInputImagesAsync(
        "/broken", failed, new failed.Gio.Cancellable(),
        (error, names) => failures.push({error, names}),
    );
    assert.match(String(failures[0].error), /could not start/u);
    assert.deepEqual(failures[0].names, []);
});

test("the image port exposes exactly what a submitter needs", async () => {
    const env = environment();
    picture(env, `${ROOT}/cat.png`);
    const port = Cinnamon.createImagePort(env);
    const completions = [];

    const image = await new Promise((resolve) => {
        port.decode(`${ROOT}/cat.png`, {width: 2, height: 2},
            {filter: "bilinear", fit: "exact"}, (error, decoded) => resolve(decoded));
    });
    port.write(`${ROOT}/.xpuwlm-staged/x.f32`, new Uint8Array(8), (error) => completions.push(error));

    assert.equal(image.width, 2);
    assert.deepEqual(completions, [null]);
    assert.equal(port.digest(new Uint8Array(3)), "2:3");
    assert.equal(port.remove(`${ROOT}/.xpuwlm-staged/x.f32`), true);
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
                            requestId: "xpuwlm-1-1",
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
        requestId: "xpuwlm-1-1",
        workloadId: "visual-library",
        payload: {inputRefs: [{
            path: `${ROOT}/.xpuwlm-staged/x.f32`,
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
    gateway.requestResult({requestId: "xpuwlm-1-2", jobId: "job-1"}, () => {});
    assert.deepEqual(calls, [Cinnamon.JOB_RESULT_METHOD, Cinnamon.JOB_RESULT_METHOD]);
});

test("a cancellation reaches the versioned CancelJob endpoint", () => {
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
                            requestId: "xpuwlm-cancel-1",
                            jobId: "job-1",
                            status: "cancelled",
                            code: "job-cancelled",
                            message: "Job cancelled",
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
    let received = null;

    Cinnamon.createRuntimeJobGateway(env).cancelJob(
        {requestId: "xpuwlm-cancel-1", jobId: "job-1"},
        (error, reply) => {
            received = {error, reply};
        },
    );

    assert.deepEqual(calls, [Cinnamon.CANCEL_JOB_METHOD]);
    assert.equal(received.error, null);
    assert.equal(received.reply.status, "cancelled");
});

test("the plug-in inventory gateway reaches DescribePlugins without an argument", () => {
    const env = environment();
    const calls = [];
    env.Gio.DBusCallFlags = {NONE: 0};
    env.Gio.DBus = {
        session: {
            call(...args) {
                calls.push(args);
                args.at(-1)({
                    call_finish: () => ({
                        deep_unpack: () => [JSON.stringify({version: 1, generatedAt: 1, plugins: []})],
                    }),
                }, {});
            },
        },
    };
    env.GLib.VariantType = class {
        constructor(signature) {
            this.signature = signature;
        }
    };
    let received = null;

    Cinnamon.createPluginInventoryGateway(env).describe((error, inventory) => {
        received = {error, inventory};
    });

    assert.equal(calls[0][3], Cinnamon.PLUGIN_INVENTORY_METHOD);
    assert.equal(calls[0][4], null);
    assert.equal(received.error, null);
    assert.deepEqual(received.inventory.plugins, []);
});

test("a bilinear exact resize decodes straight to the declared shape", async () => {
    const env = environment();
    picture(env, `${ROOT}/cat.png`);

    await decode(env, `${ROOT}/cat.png`, {width: 227, height: 227});

    assert.deepEqual(env.scaled[0], {stream: `${ROOT}/cat.png`, width: 227, height: 227, preserve: false});
    assert.deepEqual(env.crops, [], "nothing is cropped");
    assert.deepEqual(env.resamples, [], "the streaming scaler is already bilinear");
});

test("a cover fit decodes to the covering size and centre-crops the rest", async () => {
    const env = environment({sourceSize: [1000, 500]});
    picture(env, `${ROOT}/wide.png`);

    const {image} = await new Promise((resolve) => {
        Cinnamon.decodeImageAsync(`${ROOT}/wide.png`, {width: 100, height: 100}, env,
            {resize: {filter: "bilinear", fit: "cover"}},
            (error, decoded) => resolve({error, image: decoded}));
    });

    // 1000x500 covering a 100x100 target scales by 100/500 = 0.2 -> 200x100.
    assert.deepEqual(env.scaled[0].width, 200);
    assert.deepEqual(env.scaled[0].height, 100);
    assert.deepEqual(env.crops[0], {x: 50, y: 0, w: 100, h: 100}, "centred on the long axis");
    assert.equal(image.width, 100);
    assert.equal(image.height, 100);
});

test("a declared filter is honoured by resampling above the target", async () => {
    const env = environment({sourceSize: [4000, 4000]});
    picture(env, `${ROOT}/cat.png`);

    await new Promise((resolve) => {
        Cinnamon.decodeImageAsync(`${ROOT}/cat.png`, {width: 227, height: 227}, env,
            {resize: {filter: "bicubic", fit: "exact"}}, () => resolve());
    });

    assert.equal(env.scaled[0].width, 227 * Cinnamon.RESAMPLE_HEADROOM, "headroom to resample from");
    assert.deepEqual(env.resamples[0], {w: 227, h: 227, interp: env.GdkPixbuf.InterpType.HYPER});
});

test("the headroom never exceeds the picture that exists", () => {
    assert.deepEqual(
        Cinnamon.decodeSize({width: 300, height: 300}, {width: 227, height: 227},
            {filter: "bicubic", fit: "exact"}),
        {width: 300, height: 300},
    );
    assert.deepEqual(
        Cinnamon.decodeSize(null, {width: 227, height: 227}, {filter: "bicubic", fit: "exact"}),
        {width: 227, height: 227},
        "a header this decoder cannot read falls back to the target",
    );
});

test("every declared filter maps to a real GdkPixbuf resampler", () => {
    const env = environment();

    for (const [name, constant] of Object.entries(Cinnamon.RESIZE_INTERPOLATION)) {
        assert.equal(Cinnamon.interpolation(env, name), env.GdkPixbuf.InterpType[constant], name);
    }
    assert.equal(Cinnamon.interpolation(env, "unknown"), env.GdkPixbuf.InterpType.BILINEAR);
});

test("a picture whose header cannot be read still decodes", () => {
    const env = environment({sourceSize: [0, 0]});

    assert.equal(Cinnamon.sourceGeometry(env, "/x.png"), null);
});

test("the cover geometry covers both axes and never shrinks below the target", () => {
    assert.deepEqual(Cinnamon.coverGeometry({width: 1000, height: 500}, {width: 100, height: 100}),
        {width: 200, height: 100});
    assert.deepEqual(Cinnamon.coverGeometry({width: 50, height: 50}, {width: 100, height: 100}),
        {width: 100, height: 100});
});

test("staged buffers a previous session abandoned are swept", () => {
    const env = environment();
    const staged = `${ROOT}/.xpuwlm-staged`;
    env.directories.add(staged);
    env.listings[staged] = [
        {name: "visual-library-xpuwlm-1-1.f32"},
        {name: "visual-library-xpuwlm-2-1.f32"},
        {name: "notes.txt"},
        {name: "nested", type: env.Gio.FileType.DIRECTORY},
    ];

    const removed = Cinnamon.sweepStagedBuffers(staged, env, ".f32");

    assert.equal(removed, 2, "only the buffers, and only the regular files");
    assert.deepEqual(env.deleted.sort(), [
        `${staged}/visual-library-xpuwlm-1-1.f32`,
        `${staged}/visual-library-xpuwlm-2-1.f32`,
    ]);
    assert.equal(env.closed, 1);
});

test("a staging directory that was never created sweeps nothing", () => {
    assert.equal(Cinnamon.sweepStagedBuffers("/absent/.xpuwlm-staged", environment(), ".f32"), 0);
});

test("the image port can sweep as well as stage", () => {
    const env = environment();
    const staged = `${ROOT}/.xpuwlm-staged`;
    env.directories.add(staged);
    env.listings[staged] = [{name: "x.f32"}];

    assert.equal(Cinnamon.createImagePort(env).sweep(staged, ".f32"), 1);
});

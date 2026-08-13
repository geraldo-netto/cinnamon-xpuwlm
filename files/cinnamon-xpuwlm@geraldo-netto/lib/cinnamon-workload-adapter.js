"use strict";

const FileSystem = require("./gio-file-adapter.js");
const WorkloadRegistry = require("./workload-registry.js");

const {
    readBoundedRegularFileText,
    readFileText,
} = FileSystem;

function readTrimmed(path, environment) {
    const text = readFileText(path, environment);
    return text === null ? "" : text.trim().toLowerCase();
}

function listWorkloadDirectories(path, environment) {
    const root = environment.Gio.File.new_for_path(path);
    if (!root.query_exists(null)) {
        return [];
    }
    const enumerator = root.enumerate_children(
        "standard::name,standard::type",
        environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const names = [];
    try {
        let info = enumerator.next_file(null);
        while (info !== null && names.length <= WorkloadRegistry.MAX_WORKLOADS) {
            if (info.get_file_type() === environment.Gio.FileType.DIRECTORY) {
                names.push(info.get_name());
            }
            info = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
    }
    return names;
}

function createWorkloadRegistry(path, environment, onInvalid = null) {
    return new WorkloadRegistry.ManifestDirectoryRegistry({
        root: path,
        listDirectories: (root) => listWorkloadDirectories(root, environment),
        readText: (source, maximumBytes) => readBoundedRegularFileText(source, environment, maximumBytes),
        onInvalid,
    });
}

// User plug-ins install under the XDG data directory; an older GLib without
// get_user_data_dir falls back to the specified default.
function userWorkloadRoot(environment, uuid) {
    const dataDirectory = typeof environment.GLib.get_user_data_dir === "function"
        ? environment.GLib.get_user_data_dir()
        : `${environment.GLib.get_home_dir()}/.local/share`;
    return `${dataDirectory}/${uuid}/workloads`;
}

// Discovery of user-supplied plug-ins is fault-isolated twice: one invalid
// manifest is skipped with a warning, and an unreadable plug-in directory
// yields an empty user catalog instead of taking down the applet.
function createUserWorkloadRegistry(environment, uuid, logger) {
    const registry = createWorkloadRegistry(
        userWorkloadRoot(environment, uuid),
        environment,
        (name, error) => logger.warn(`Ignoring invalid user workload plug-in ${name}: ${error}`),
    );
    return {
        descriptors() {
            try {
                return registry.descriptors();
            } catch (error) {
                logger.warn(`Ignoring unreadable user workload plug-in directory: ${error}`);
                return [];
            }
        },
    };
}

// The applet catalog: bundled workloads merged with user plug-ins,
// bundled-wins on identity collisions. Bundled manifests stay strict — a
// packaging defect must fail loudly, never silently shrink the catalog.
function createMergedWorkloadRegistry({bundledRoot, environment, uuid, logger}) {
    return new WorkloadRegistry.MergedWorkloadRegistry({
        primary: createWorkloadRegistry(bundledRoot, environment),
        secondary: createUserWorkloadRegistry(environment, uuid, logger),
        onCollision: (id) => logger.warn(
            `User workload plug-in ${id} is shadowed by the bundled workload with the same id`,
        ),
    });
}


module.exports = {
    createMergedWorkloadRegistry,
    createUserWorkloadRegistry,
    createWorkloadRegistry,
    listWorkloadDirectories,
    readTrimmed,
    userWorkloadRoot,
};

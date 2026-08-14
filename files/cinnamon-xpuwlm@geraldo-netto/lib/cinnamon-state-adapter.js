"use strict";

const FileSystem = require("./gio-file-adapter.js");
const Validation = require("./validation.js");

const {
    expandHome,
    readFileText,
} = FileSystem;

const APPLET_STATE_PATH = "~/.config/xpu-workload-manager/applet-state.json";
const LEGACY_APPLET_STATE_PATH = "~/.config/tpu-workload-manager/applet-state.json";
const LEGACY_SETTINGS_PATH = "~/.config/cinnamon/spices/cinnamon-tpuwm@geraldo-netto/cinnamon-tpuwm@geraldo-netto.json";
const OLD_RUNTIME_STATE_PATH = "~/.local/state/tpu-workload-manager/state.json";
const RUNTIME_STATE_PATH = "~/.local/state/xpu-workload-manager/state.json";
const IDENTITY_MIGRATION_VERSION = 1;
const IDENTITY_MIGRATION_KEY = "identity-migration-version";
const LEGACY_SETTINGS_MAX_BYTES = 64 * 1024;
const SETTINGS_ID = /^[A-Za-z0-9@._-]+$/u;
const MIGRATABLE_SETTING_DEFAULTS = Object.freeze({
    "show-panel-label": false,
    "refresh-interval": 1,
    "runtime-state-path": RUNTIME_STATE_PATH,
});

// Applet-owned atomic state file. Cinnamon's xlet-settings layer caches
// values in-process and flushes them asynchronously, so an applet reload can
// interleave a stale flush with the fresh instance's reads and silently lose
// profile toggles. This repository owns its file and writes it atomically
// through GIO (replace_contents uses a temp file plus rename), with a one-time
// migration read from the legacy xlet-settings keys.
const STATE_FILE_MAX_BYTES = 64 * 1024;
const EMPTY_APPLET_STATE = Object.freeze({
    portfolio: null,
    selectedTab: null,
    activityClearedAt: null,
});

const isRecord = Validation.isRecord;

function storedSettingValue(document, key) {
    const setting = document[key];
    return isRecord(setting) ? setting.value : undefined;
}

function copyBooleanSetting(document, migrated, key) {
    const value = storedSettingValue(document, key);
    if (typeof value === "boolean") {
        migrated[key] = value;
    }
}

function copyRefreshInterval(document, migrated) {
    const value = storedSettingValue(document, "refresh-interval");
    if (Number.isInteger(value) && value >= 1 && value <= 60) {
        migrated["refresh-interval"] = value;
    }
}

function copyRuntimeStatePath(document, migrated) {
    const value = storedSettingValue(document, "runtime-state-path");
    if (typeof value !== "string" || value.trim() === ""
            || value.length > 4096 || value.includes("\0")) {
        return;
    }
    migrated["runtime-state-path"] = value === OLD_RUNTIME_STATE_PATH
        ? RUNTIME_STATE_PATH
        : value;
}

function migratedIdentitySettings(document) {
    if (!isRecord(document)) {
        return {};
    }
    const migrated = {};
    copyBooleanSetting(document, migrated, "show-panel-label");
    copyRefreshInterval(document, migrated);
    copyRuntimeStatePath(document, migrated);
    return migrated;
}

function readLegacyIdentitySettings(environment, path) {
    try {
        const expanded = expandHome(path, environment.GLib.get_home_dir());
        const text = readFileText(expanded, environment, LEGACY_SETTINGS_MAX_BYTES);
        return text === null ? {} : migratedIdentitySettings(JSON.parse(text));
    } catch {
        return {};
    }
}

function settingsInstanceName(instanceId) {
    if (Number.isSafeInteger(instanceId) && instanceId >= 0) {
        return String(instanceId);
    }
    if (typeof instanceId === "string" && SETTINGS_ID.test(instanceId)) {
        return instanceId;
    }
    return null;
}

function validSettingsUuid(uuid) {
    return typeof uuid === "string" && SETTINGS_ID.test(uuid);
}

function hasSettingsFileApi(environment) {
    return Boolean(environment?.GLib && environment.Gio
        && typeof environment.GLib.get_home_dir === "function"
        && typeof environment.Gio.File?.new_for_path === "function");
}

function appletSettingsPaths(uuid, instanceId, environment) {
    const instanceName = settingsInstanceName(instanceId);
    if (!validSettingsUuid(uuid) || instanceName === null) {
        return null;
    }
    if (!hasSettingsFileApi(environment)) {
        return null;
    }
    const home = environment.GLib.get_home_dir();
    const configRoot = typeof environment.GLib.get_user_config_dir === "function"
        ? environment.GLib.get_user_config_dir()
        : `${home}/.config`;
    return Object.freeze({
        modern: `${configRoot}/cinnamon/spices/${uuid}/${instanceName}.json`,
        legacy: `${home}/.cinnamon/configs/${uuid}/${instanceName}.json`,
    });
}

function selectedAppletSettingsPath(paths, environment) {
    try {
        const modernExists = environment.Gio.File.new_for_path(paths.modern).query_exists(null);
        const legacyExists = environment.Gio.File.new_for_path(paths.legacy).query_exists(null);
        return legacyExists && !modernExists ? paths.legacy : paths.modern;
    } catch {
        return null;
    }
}

function currentAppletSettingsPath(uuid, instanceId, environment) {
    return selectedAppletSettingsPath(appletSettingsPaths(uuid, instanceId, environment), environment);
}

function readCurrentIdentitySettings(uuid, instanceId, environment) {
    return readLegacyIdentitySettings(environment, currentAppletSettingsPath(uuid, instanceId, environment));
}

function restoreCurrentRefreshInterval(settings, snapshot) {
    const value = snapshot?.["refresh-interval"];
    if (!Number.isInteger(value) || value < 1 || value > 60
            || settings.getValue("refresh-interval") === value) {
        return false;
    }
    settings.setValue("refresh-interval", value);
    return true;
}

function importDefaultIdentitySettings(settings, migrated) {
    let imported = false;
    for (const [key, value] of Object.entries(migrated)) {
        if (settings.getValue(key) === MIGRATABLE_SETTING_DEFAULTS[key]) {
            settings.setValue(key, value);
            imported = true;
        }
    }
    return imported;
}

// A UUID change gives Cinnamon a fresh settings namespace. Import only the
// three user-facing settings, only while their new values are still defaults,
// and mark the attempt even when the old file is absent. The old JSON is
// bounded and treated as untrusted input; profile intent has its own migration
// path through FileStateRepository below.
function migrateLegacyAppletSettings(settings, environment, path = LEGACY_SETTINGS_PATH) {
    if (!settings || typeof settings.getValue !== "function" || typeof settings.setValue !== "function") {
        throw new TypeError("Cinnamon applet settings are required");
    }
    if (settings.getValue(IDENTITY_MIGRATION_KEY) >= IDENTITY_MIGRATION_VERSION) {
        return false;
    }
    const migrated = readLegacyIdentitySettings(environment, path);
    const imported = importDefaultIdentitySettings(settings, migrated);
    settings.setValue(IDENTITY_MIGRATION_KEY, IDENTITY_MIGRATION_VERSION);
    return imported;
}

class FileStateRepository {
    constructor({path, environment, legacy = null, legacyPath = null}) {
        if (!path || !environment?.Gio) {
            throw new TypeError("A state file path and a Gio environment are required");
        }
        this._path = expandHome(String(path), environment.GLib.get_home_dir());
        this._legacyPath = legacyPath === null
            ? null
            : expandHome(String(legacyPath), environment.GLib.get_home_dir());
        this._environment = environment;
        this._legacy = legacy;
        this._file = null;
        this._parentReady = false;
        this._activeWrite = null;
        this._pendingWrite = null;
    }

    load() {
        const text = this._readMigratedStateText();
        this._prepareParent();
        if (text === null) {
            return this._legacy ? this._legacy.load() : EMPTY_APPLET_STATE;
        }
        try {
            return persistedAppletState(JSON.parse(text));
        } catch {
            return EMPTY_APPLET_STATE;
        }
    }

    _readMigratedStateText() {
        const current = this._readStateText(this._path);
        if (current !== null || this._legacyPath === null) {
            return current;
        }
        return this._readStateText(this._legacyPath);
    }

    _readStateText(path) {
        try {
            return readFileText(path, this._environment, STATE_FILE_MAX_BYTES);
        } catch {
            return null;
        }
    }

    _prepareParent() {
        if (this._parentReady || typeof this._environment.Gio.File?.new_for_path !== "function") {
            return false;
        }
        const file = this._fileForWrite();
        if (typeof file.get_parent !== "function") {
            return false;
        }
        const parent = file.get_parent();
        if (parent !== null && !parent.query_exists(null)) {
            parent.make_directory_with_parents(null);
        }
        this._parentReady = true;
        return true;
    }

    _fileForWrite() {
        if (this._file === null) {
            this._file = this._environment.Gio.File.new_for_path(this._path);
        }
        return this._file;
    }

    _serialized(state) {
        return JSON.stringify({
            portfolio: state.portfolio,
            selectedTab: state.selectedTab,
            activityClearedAt: state.activityClearedAt,
        });
    }

    _entry(state, callback) {
        return {
            text: this._serialized(state),
            callbacks: typeof callback === "function" ? [callback] : [],
            cancellable: typeof this._environment.Gio.Cancellable === "function"
                ? new this._environment.Gio.Cancellable()
                : null,
            settled: false,
        };
    }

    _supportsAsyncWrites() {
        const file = this._fileForWrite();
        return typeof file.replace_contents_bytes_async === "function"
            && typeof file.replace_contents_finish === "function"
            && typeof this._environment.GLib.Bytes === "function"
            && typeof this._environment.ByteArray?.fromString === "function";
    }

    save(state, callback = null) {
        this._prepareParent();
        const entry = this._entry(state, callback);
        if (!this._supportsAsyncWrites()) {
            this._replace(entry.text);
            this._settleWrite(entry, null);
            return false;
        }
        if (this._activeWrite === null) {
            this._startWrite(entry);
        } else if (this._pendingWrite === null) {
            this._pendingWrite = entry;
        } else {
            entry.callbacks.unshift(...this._pendingWrite.callbacks);
            this._pendingWrite.settled = true;
            this._pendingWrite = entry;
        }
        return true;
    }

    _startWrite(entry) {
        this._activeWrite = entry;
        try {
            this._fileForWrite().replace_contents_bytes_async(
                new this._environment.GLib.Bytes(
                    this._environment.ByteArray.fromString(entry.text),
                ),
                null,
                false,
                this._environment.Gio.FileCreateFlags.REPLACE_DESTINATION,
                entry.cancellable,
                (source, result) => {
                    if (this._activeWrite !== entry || entry.settled) {
                        return;
                    }
                    let error = null;
                    try {
                        source.replace_contents_finish(result);
                    } catch (error_) {
                        error = error_;
                    }
                    this._finishWrite(entry, error);
                },
            );
        } catch (error) {
            this._finishWrite(entry, error);
        }
    }

    _finishWrite(entry, error) {
        if (this._activeWrite !== entry || entry.settled) {
            return false;
        }
        this._activeWrite = null;
        this._settleWrite(entry, error);
        const pending = this._pendingWrite;
        this._pendingWrite = null;
        if (pending !== null) {
            this._startWrite(pending);
        }
        return error === null;
    }

    _settleWrite(entry, error) {
        if (entry.settled) {
            return false;
        }
        entry.settled = true;
        for (const callback of entry.callbacks) {
            try {
                callback(error);
            } catch {
                // Completion observers cannot break persistence ordering.
            }
        }
        entry.callbacks = [];
        return true;
    }

    _replace(text) {
        const Gio = this._environment.Gio;
        this._fileForWrite().replace_contents(
            text,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
    }

    _cancelWrite(entry) {
        if (entry === null || entry.cancellable === null) {
            return false;
        }
        entry.cancellable.cancel();
        return true;
    }

    _settleOutstanding(entries, error) {
        for (const entry of entries) {
            if (entry !== null) {
                this._settleWrite(entry, error);
            }
        }
    }

    // Teardown is outside button dispatch. Cancel the old in-flight write,
    // then atomically publish the newest state so the replacement applet never
    // starts from an older queued selection or policy value.
    flush() {
        const active = this._activeWrite;
        const pending = this._pendingWrite;
        const latest = pending || active;
        if (latest === null) {
            return false;
        }
        this._activeWrite = null;
        this._pendingWrite = null;
        this._cancelWrite(active);
        let error = null;
        try {
            this._replace(latest.text);
        } catch (error_) {
            error = error_;
        }
        this._settleOutstanding([active, pending], error);
        if (error !== null) {
            throw error;
        }
        return true;
    }
}

function persistedAppletState(parsed) {
    const source = parsed && typeof parsed === "object" ? parsed : {};
    return {
        portfolio: source.portfolio ?? null,
        selectedTab: source.selectedTab ?? null,
        activityClearedAt: source.activityClearedAt ?? null,
    };
}

// Falls back to the legacy xlet-settings store when the environment cannot
// reach GIO (test harnesses); production always gets the atomic state file.
function createStateRepository(environment, settings, path = APPLET_STATE_PATH) {
    const legacy = new CinnamonSettingsRepository(settings);
    if (!environment?.Gio || !environment.GLib) {
        return legacy;
    }
    return new FileStateRepository({
        path,
        environment,
        legacy,
        legacyPath: path === APPLET_STATE_PATH ? LEGACY_APPLET_STATE_PATH : null,
    });
}

class CinnamonSettingsRepository {
    constructor(settings) {
        if (!settings || typeof settings.getValue !== "function" || typeof settings.setValue !== "function") {
            throw new TypeError("Cinnamon applet settings are required");
        }
        this._settings = settings;
    }

    load() {
        return {
            portfolio: this._settings.getValue("profile-state"),
            selectedTab: this._settings.getValue("selected-tab"),
            activityClearedAt: this._settings.getValue("activity-cleared-at"),
        };
    }

    save(state) {
        const portfolio = state.portfolio;
        const selectedTab = state.selectedTab;
        if (JSON.stringify(this._settings.getValue("profile-state")) !== JSON.stringify(portfolio)) {
            this._settings.setValue("profile-state", portfolio);
        }
        if (this._settings.getValue("selected-tab") !== selectedTab) {
            this._settings.setValue("selected-tab", selectedTab);
        }
        const activityClearedAt = state.activityClearedAt;
        if (this._settings.getValue("activity-cleared-at") !== activityClearedAt) {
            this._settings.setValue("activity-cleared-at", activityClearedAt);
        }
    }
}

module.exports = {
    APPLET_STATE_PATH,
    LEGACY_APPLET_STATE_PATH,
    LEGACY_SETTINGS_PATH,
    OLD_RUNTIME_STATE_PATH,
    RUNTIME_STATE_PATH,
    CinnamonSettingsRepository,
    FileStateRepository,
    createStateRepository,
    currentAppletSettingsPath,
    migrateLegacyAppletSettings,
    migratedIdentitySettings,
    readCurrentIdentitySettings,
    restoreCurrentRefreshInterval,
};

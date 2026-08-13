"use strict";

// Stable public facade. Platform-specific behavior lives in narrow adapters so
// another desktop or host OS can compose its own ports without importing
// Cinnamon, Linux discovery, GIO persistence, image, and D-Bus concerns as one.
const FileSystem = require("./gio-file-adapter.js");
const Workloads = require("./cinnamon-workload-adapter.js");
const Devices = require("./linux-device-adapter.js");
const State = require("./cinnamon-state-adapter.js");
const Host = require("./cinnamon-host-adapter.js");
const Images = require("./cinnamon-image-adapter.js");
const Dbus = require("./cinnamon-dbus-adapter.js");

module.exports = Object.assign(
    {},
    FileSystem,
    Workloads,
    Devices,
    State,
    Host,
    Images,
    Dbus,
);

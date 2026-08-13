"use strict";

// Portable path syntax belongs at the client composition boundary. The
// running Cinnamon client deliberately uses POSIX_PATHS; WINDOWS_PATHS exists
// for a sibling client to inject without weakening the Linux Omni contract.
const WINDOWS_DRIVE = /^[A-Za-z]:\\/u;
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/u;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_FORBIDDEN = /[<>"|?*]/u;

function pathText(value) {
    return typeof value === "string" && value !== "" && !value.includes("\0");
}

function posixSegments(value) {
    return value.split("/");
}

function windowsSegments(value) {
    if (WINDOWS_DRIVE.test(value)) {
        return value.slice(3).split("\\");
    }
    return value.slice(2).split("\\");
}

function safePosixName(value) {
    return pathText(value) && !value.includes("/") && value !== "." && value !== "..";
}

function hasWindowsControl(value) {
    return [...value].some((character) => character.codePointAt(0) <= 31);
}

function safeWindowsCharacters(value) {
    return !value.includes("\\")
        && !value.includes("/")
        && !value.includes(":")
        && !WINDOWS_FORBIDDEN.test(value)
        && !hasWindowsControl(value);
}

function safeWindowsName(value) {
    return pathText(value)
        && value !== "."
        && value !== ".."
        && safeWindowsCharacters(value)
        && !/[. ]$/u.test(value)
        && !WINDOWS_RESERVED.test(value);
}

function posixAbsolute(value) {
    return pathText(value) && value.startsWith("/");
}

function safePosixAbsolute(value) {
    return posixAbsolute(value) && !posixSegments(value).includes("..");
}

function windowsAbsolute(value) {
    return pathText(value)
        && !value.includes("/")
        && !value.startsWith("\\\\?\\")
        && !value.startsWith("\\\\.\\")
        && (WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value));
}

function safeWindowsSegments(value) {
    const segments = windowsSegments(value);
    return segments.every((segment, index) => (
        safeWindowsName(segment) || (segment === "" && index === segments.length - 1)
    ));
}

function safeWindowsAbsolute(value) {
    if (!windowsAbsolute(value)) {
        return false;
    }
    const offset = WINDOWS_DRIVE.test(value) ? 2 : 0;
    return !value.slice(offset).includes(":")
        && safeWindowsSegments(value);
}

function joinPath(root, name, separator, safeAbsolute, safeName) {
    if (!safeAbsolute(root) || !safeName(name)) {
        throw new TypeError("Safe absolute root and child name are required");
    }
    return `${root.replace(new RegExp(`${separator === "\\" ? "\\\\" : separator}+$`, "u"), "")}${separator}${name}`;
}

const POSIX_PATHS = Object.freeze({
    basename: (value) => String(value).split("/").at(-1),
    isAbsolute: posixAbsolute,
    isSafeAbsolute: safePosixAbsolute,
    isSafeName: safePosixName,
    join: (root, name) => joinPath(root, name, "/", safePosixAbsolute, safePosixName),
    separator: "/",
});

const WINDOWS_PATHS = Object.freeze({
    basename: (value) => String(value).split("\\").at(-1),
    isAbsolute: windowsAbsolute,
    isSafeAbsolute: safeWindowsAbsolute,
    isSafeName: safeWindowsName,
    join: (root, name) => joinPath(root, name, "\\", safeWindowsAbsolute, safeWindowsName),
    separator: "\\",
});

function requirePathPort(candidate) {
    const methods = ["basename", "isAbsolute", "isSafeAbsolute", "isSafeName", "join"];
    if (!candidate || methods.some((name) => typeof candidate[name] !== "function")
        || typeof candidate.separator !== "string") {
        throw new TypeError("Path port is required");
    }
    return candidate;
}

module.exports = {
    POSIX_PATHS,
    WINDOWS_PATHS,
    hasWindowsControl,
    requirePathPort,
    safePosixAbsolute,
    safePosixName,
    safeWindowsAbsolute,
    safeWindowsCharacters,
    safeWindowsSegments,
    safeWindowsName,
    posixAbsolute,
    windowsAbsolute,
};

"use strict";

const js = require("@eslint/js");

module.exports = [
    {
        ignores: ["coverage/**", "mutation-report/**", "node_modules/**", ".stryker-tmp/**"],
    },
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                global: "readonly",
                imports: "readonly",
                module: "readonly",
                require: "readonly",
                __dirname: "readonly",
                process: "readonly",
                console: "readonly",
                Buffer: "readonly",
                structuredClone: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
        rules: {
            "curly": ["error", "all"],
            "eqeqeq": ["error", "always"],
            "no-console": ["error", {"allow": ["log", "error"]}],
            "no-implicit-coercion": "error",
            "no-shadow": "error",
            "no-unused-vars": ["error", {"argsIgnorePattern": "^_", "varsIgnorePattern": "^_"}],
            "prefer-const": "error",
        },
    },
    {
        // Complexity budget for shipped applet sources and repository scripts.
        // Exemptions are permitted only for flat declarative mappings and must
        // carry an inline justification.
        files: ["files/**/*.js", "scripts/**/*.js"],
        rules: {
            "complexity": ["error", {"max": 8}],
        },
    },
    {
        // The payload runs under Cinnamon's engine, which has no Node globals.
        // Asked here rather than by the artifact validator's `\bBuffer\b`
        // search, because a rule that reads identifier references sees a real
        // use and ignores the word in a comment or a string — and because
        // ESLint walks `files/**` to any depth, so a module one directory down
        // is held to it the day it lands.
        files: ["files/**/*.js"],
        rules: {
            "no-restricted-globals": ["error", {
                "name": "Buffer",
                "message": "Cinnamon's engine has no Buffer; use ByteArray or GLib.",
            }],
        },
    },
];

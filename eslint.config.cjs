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
];

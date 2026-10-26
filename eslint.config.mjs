// ESLint flat config. Run with `npm run lint`.
//
// The codebase has three kinds of JS, each linted with its own globals:
//   - engine: browser ES modules (main.js and its imports), with the lib/
//     vendor scripts (ROT, PIXI, createjs, Howler) loaded as globals first
//   - editors/scripts: classic <script src> files sharing one global scope
//   - tools: Node CommonJS scripts

import js from '@eslint/js';
import globals from 'globals';

// Vendor libraries loaded via <script src="lib/..."> before any of our code.
const vendorGlobals = {
    ROT: 'readonly',
    PIXI: 'readonly',
    createjs: 'readonly',
    Howl: 'readonly',
    Howler: 'readonly',
    Handlebars: 'readonly',
};

export default [
    {
        ignores: ['lib/**', 'node_modules/**', '.sass-cache/**'],
    },

    js.configs.recommended,

    {
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
        },
    },

    // Engine: browser ES modules
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...vendorGlobals },
        },
    },

    // Editors: classic scripts sharing one global scope, so top-level
    // declarations are used from other files and can't be resolved per-file.
    {
        files: ['editors/scripts/**/*.js'],
        languageOptions: {
            sourceType: 'script',
        },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
        },
    },

    // Tools: Node CommonJS scripts
    {
        files: ['tools/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },
];

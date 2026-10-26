// Shared by the tools/ scripts: loads the real Architect (architect/) so the checks run
// against the shipped code rather than a copy.
//
// architect/ is ES modules; Node 22.12+ can require() one synchronously.
// The repo has no package.json, so Node detects the module syntax and warns
// about it; that warning is expected and filtered out here.
//
// The generator logs progress through the global console, so console.log/warn
// are silenced once it's loaded. Tools print through the returned `out`.

const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadArchitect({ silenceErrors = false } = {}) {
    const ROT = require(path.join(ROOT, 'lib/rot.js'));
    globalThis.ROT = ROT;

    const emitWarning = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
        if (!String(warning).includes('Module type')) emitWarning.call(process, warning, ...rest);
    };
    const { Architect } = require(path.join(ROOT, 'architect/architect.js'));
    process.emitWarning = emitWarning;

    const out = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
    };
    console.log = () => {};
    console.warn = () => {};
    if (silenceErrors) console.error = () => {};

    return { Architect, ROT, out };
}

module.exports = { loadArchitect, ROOT };

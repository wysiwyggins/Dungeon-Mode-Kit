/* =========================================================================
   proto-render.js — serialize/output, event wiring, init()
   -------------------------------------------------------------------------
   Extracted from prototype-editor.html. These files are plain <script> src
   includes (no bundler) and share one global scope; load order matters:
   proto-state -> proto-widgets -> biome-sections -> proto-sections ->
   proto-render. The final file calls init(). Do not wrap in IIFEs — cross-file
   references rely on the shared top-level scope.
   ========================================================================= */
"use strict";

function serialize() {
    const out = JSON.parse(JSON.stringify(state.proto));
    pruneSpawnDefaults(out);
    // levels may be a dense array or a sparse object keyed by floor number.
    if (Array.isArray(out.levels)) out.levels.forEach(lv => lv && pruneSpawnDefaults(lv));
    else if (out.levels) Object.values(out.levels).forEach(lv => lv && pruneSpawnDefaults(lv));
    return out;
}

// Drop min/max when both are 1 (matches how data files write `{ "chance": N }`).
function pruneSpawnDefaults(scope) {
    for (const tableKey of ['random_actors', 'random_items']) {
        const tbl = scope[tableKey];
        if (!tbl) continue;
        for (const spec of Object.values(tbl)) {
            if (spec && typeof spec === 'object') {
                if (spec.min === 1 && spec.max === 1) { delete spec.min; delete spec.max; }
                else if (spec.min != null && spec.max == null) { spec.max = spec.min; }
            }
        }
    }
}

function updateJSONOutput() {
    if (!state.proto) return;
    document.getElementById('json-output').value = JSON.stringify(serialize(), null, 2);
    const n = totalFloors();
    const lvls = n > 1 ? n + ' floor(s)' : 'flat';
    document.getElementById('output-key').textContent =
        (state.proto.name || '(unnamed)') + ' — ' + lvls
        + (isFloor() ? ' — editing Floor ' + state.activeFloor : ' — editing prototype defaults');
}

// Called on every model mutation. Keeps JSON output live without a full re-render.
function commit() { updateJSONOutput(); }

/* =========================================================================
   Wiring
   ========================================================================= */
async function init() {
    // Register the reusable row partials once so section templates can use them.
    EditorTemplate.registerPartials({
        fieldRow: 'tpl-field-row',
        textareaRow: 'tpl-textarea-row',
        selectRow: 'tpl-select-row',
    });
    await loadBaseData();
    populatePrototypeSelect();
    document.getElementById('prototype-select').addEventListener('change', async (e) => {
        const name = e.target.value;
        document.getElementById('load-status').textContent = name ? 'loading ' + name + '…' : '';
        await loadPrototype(name);
        document.getElementById('load-status').textContent = name ? 'loaded ' + name : '';
    });
    document.getElementById('btn-blank').addEventListener('click', async () => {
        document.getElementById('prototype-select').value = '';
        await loadPrototype('');
        document.getElementById('load-status').textContent = 'new blank prototype';
    });
    document.getElementById('btn-export').addEventListener('click', () => {
        updateJSONOutput();
        const out = document.getElementById('json-output');
        out.focus(); out.select();
    });
    document.getElementById('btn-copy').addEventListener('click', async () => {
        if (!state.proto) return;
        const txt = JSON.stringify(serialize(), null, 2);
        try { await navigator.clipboard.writeText(txt); document.getElementById('load-status').textContent = 'copied to clipboard'; }
        catch { const out = document.getElementById('json-output'); out.focus(); out.select(); document.execCommand('copy'); document.getElementById('load-status').textContent = 'copied'; }
    });

    // JSON output panel show/hide (persisted). The panel is a live convenience
    // view; hiding it gives the form the full width.
    const jsonPanel = document.getElementById('json-output-panel');
    const jsonBtn = document.getElementById('btn-toggle-json');
    const applyJsonHidden = (hidden) => {
        jsonPanel.classList.toggle('hidden', hidden);
        jsonBtn.textContent = hidden ? 'Show JSON' : 'Hide JSON';
    };
    applyJsonHidden(localStorage.getItem('protoEditorJsonHidden') === '1');
    jsonBtn.addEventListener('click', () => {
        const hidden = !jsonPanel.classList.contains('hidden');
        applyJsonHidden(hidden);
        localStorage.setItem('protoEditorJsonHidden', hidden ? '1' : '0');
    });
}

init();

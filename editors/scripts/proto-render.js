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

/* Copy the serialized prototype to the clipboard.
   The execCommand fallback (used outside a secure context, where
   navigator.clipboard is undefined) copies via a temporary off-screen textarea
   rather than #json-output, because that panel is display:none and you can't
   select() inside a hidden element — it would copy nothing and still report
   success. */
async function copyProtoJSON(okMsg) {
    const txt = JSON.stringify(serialize(), null, 2);
    const status = document.getElementById('load-status');
    try {
        await navigator.clipboard.writeText(txt);
        status.textContent = okMsg;
        return;
    } catch { /* fall through */ }
    const tmp = el('textarea', { style: 'position:fixed;top:-9999px;left:-9999px;' });
    tmp.value = txt;
    document.body.appendChild(tmp);
    tmp.focus(); tmp.select();
    let ok;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    status.textContent = ok ? okMsg : 'copy failed';
}

/* =========================================================================
   Reference fields (scripts/ref-fields.js)
   ========================================================================= */
// names() read state live; render() refreshes the lists after a prototype loads.
function initRefFields() {
    RefFields.define('prototype', { file: 'prototypes.json', names: () => state.prototypeNames || [] });
    RefFields.define('actor', { file: 'actors.json', names: () => state.mergedActorIds || [] });
}

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
    // TilePicker.load() pulls the spritesheet for the default_floor tile picker.
    await Promise.all([loadBaseData(), TilePicker.load()]);
    initRefFields();
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
    // "Export" used to just select the JSON textarea so you could hit Cmd-C, but the
    // JSON panel is display:none now — selecting inside a hidden element does
    // nothing. Both buttons therefore copy; Export keeps its name for muscle memory.
    document.getElementById('btn-export').addEventListener('click', () => {
        if (!state.proto) return;
        updateJSONOutput();
        copyProtoJSON('exported to clipboard');
    });
    document.getElementById('btn-copy').addEventListener('click', () => {
        if (!state.proto) return;
        copyProtoJSON('copied to clipboard');
    });

    // JSON output panel show/hide (persisted). The panel is a live convenience
    // view; hiding it gives the form the full width. Both elements are optional —
    // the markup may comment either out — so guard rather than throw.
    const jsonPanel = document.getElementById('json-output-panel');
    const jsonBtn = document.getElementById('btn-toggle-json');
    if (jsonPanel && jsonBtn) {
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
}

init();

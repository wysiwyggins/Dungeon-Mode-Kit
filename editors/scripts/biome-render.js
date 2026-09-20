/* =========================================================================
   biome-render.js — render loop, serialization/output, wiring, init()
   -------------------------------------------------------------------------
   Counterpart to proto-render.js + the render half of proto-sections.js, for
   the standalone biome editor. Plain <script> src include sharing one global
   scope; load order matters:
   biome-state -> proto-widgets -> biome-sections -> biome-render. This file
   calls init() last. Do not wrap in IIFEs — cross-file references rely on the
   shared top-level scope.

   Supplies commit() and render(), the last two pieces of the globals contract
   that proto-widgets.js and biome-sections.js depend on.
   ========================================================================= */
"use strict";

/* =========================================================================
   Render
   ========================================================================= */
function render() {
    renderBiomeSelect();
    renderForm();
    updateJSONOutput();
}

// Keep the header dropdown in sync with the library (names change on rename,
// entries appear on create and vanish on remove).
function renderBiomeSelect() {
    const sel = document.getElementById('biome-select');
    if (!sel) return;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, '— choose —'));
    for (const name of Object.keys(state.library).sort()) {
        sel.appendChild(el('option', { value: name }, name));
    }
    // A rename/remove inside the card can leave activeBiome stale; resync.
    if (state.activeBiome && !state.library[state.activeBiome]) {
        state.activeBiome = Object.keys(state.library)[0] || null;
    }
    sel.value = state.activeBiome || '';
    const empty = Object.keys(state.library).length === 0;
    document.getElementById('empty-hint').classList.toggle('hidden', !!state.activeBiome);
    document.getElementById('form-sections').classList.toggle('hidden', !state.activeBiome);
    if (empty) {
        document.getElementById('empty-hint').textContent =
            'No biomes yet — data/biomes.json is missing or empty. Type a name and press “+ New Biome” to start one.';
    }
}

function renderForm() {
    const root = document.getElementById('form-sections');
    root.innerHTML = '';
    const name = state.activeBiome;
    if (!name || !state.library[name]) return;

    // Preserve which <details> the user had open across the rebuild, keyed by
    // title text — same approach as proto-sections.js's render().
    const openTitles = new Set(
        Array.from(root.querySelectorAll('details.section[open]'))
            .map(d => d.querySelector('.sec-title')?.textContent)
            .filter(Boolean)
    );

    // The whole form IS one biome card, reused verbatim from biome-sections.js.
    // No floorPlan is passed: a library biome has no floor ranges to repoint.
    root.appendChild(biomeCard(state.library, name));

    for (const d of root.querySelectorAll('details.section')) {
        const t = d.querySelector('.sec-title')?.textContent;
        if (t && openTitles.has(t)) d.setAttribute('open', '');
    }
}

/* =========================================================================
   Output
   ========================================================================= */
// The whole library, for pasting over data/biomes.json.
function serializeLibrary() {
    return JSON.parse(JSON.stringify(state.library));
}

// One biome as a `"name": { … }` fragment, for pasting inline into a
// prototype.json's `biomes` object. Matches the fragment style of the
// actor/item/effects/personality editors.
function serializeOne(name) {
    const body = JSON.stringify(state.library[name], null, 2)
        .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
    return `"${name}": ${body}`;
}

function updateJSONOutput() {
    const out = document.getElementById('json-output');
    if (!out) return;
    out.value = JSON.stringify(serializeLibrary(), null, 2);
    const n = Object.keys(state.library).length;
    document.getElementById('output-key').textContent =
        `${n} biome(s)` + (state.activeBiome ? ` — editing “${state.activeBiome}”` : '');
}

// Called by every widget on every model mutation. Keeps the JSON panel live
// without a full re-render (which would drop focus/caret).
function commit() { updateJSONOutput(); }

function setStatus(msg) {
    document.getElementById('load-status').textContent = msg || '';
}

async function copyText(txt, okMsg) {
    try {
        await navigator.clipboard.writeText(txt);
        setStatus(okMsg);
        return;
    } catch {
        // navigator.clipboard is unavailable outside a secure context; fall through.
    }
    // Don't reuse #json-output for this: the JSON panel is display:none, and you
    // can't select() inside a hidden element — execCommand would copy nothing and
    // still look like it worked. Use a temporary off-screen textarea instead.
    const tmp = el('textarea', { style: 'position:fixed;top:-9999px;left:-9999px;' });
    tmp.value = txt;
    document.body.appendChild(tmp);
    tmp.focus(); tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    setStatus(ok ? okMsg : 'copy failed — select the JSON panel text manually');
}

/* =========================================================================
   Wiring
   ========================================================================= */
async function init() {
    EditorTemplate.registerPartials({
        fieldRow: 'tpl-field-row',
        textareaRow: 'tpl-textarea-row',
        selectRow: 'tpl-select-row',
    });

    // TilePicker.load() pulls the spritesheet tileRow() draws its preview from.
    await Promise.all([loadBaseData(), TilePicker.load()]);

    const n = Object.keys(state.library).length;
    setStatus(n ? `loaded ${n} biome(s) from data/biomes.json` : 'no data/biomes.json yet');

    // "design for N floors" — editor-only, persisted, never serialized.
    const df = document.getElementById('design-floors');
    const saved = parseInt(localStorage.getItem(DESIGN_FLOORS_KEY), 10);
    if (Number.isFinite(saved) && saved > 0) state.designFloors = saved;
    df.value = state.designFloors;
    df.addEventListener('input', () => {
        const v = parseInt(df.value, 10);
        if (!Number.isFinite(v) || v < 1) return;
        state.designFloors = v;
        localStorage.setItem(DESIGN_FLOORS_KEY, String(v));
        render();   // depth sliders are built with this as their max
    });

    document.getElementById('biome-select').addEventListener('change', (e) => {
        selectBiome(e.target.value);
        setStatus(e.target.value ? 'editing ' + e.target.value : '');
    });

    const nameInput = document.getElementById('new-biome-name');
    const doCreate = () => {
        const nm = nameInput.value.trim();
        if (!nm) { setStatus('enter a name for the new biome'); return; }
        if (!createBiome(nm)) { setStatus(`“${nm}” already exists`); return; }
        nameInput.value = '';
        render();
        setStatus('created ' + nm);
    };
    document.getElementById('btn-new').addEventListener('click', doCreate);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });

    document.getElementById('btn-copy-library').addEventListener('click', () => {
        copyText(JSON.stringify(serializeLibrary(), null, 2),
            'copied whole library — paste it over data/biomes.json');
    });
    document.getElementById('btn-copy-one').addEventListener('click', () => {
        if (!state.activeBiome) { setStatus('choose a biome first'); return; }
        copyText(serializeOne(state.activeBiome),
            `copied “${state.activeBiome}” — paste inside a prototype's "biomes" object`);
    });

    // JSON panel show/hide, persisted. Separate key from the prototype editor's
    // so the two pages remember independently. Both the panel and the button are
    // optional — the markup may comment either out — and this runs before render(),
    // so a missing element must not throw and abort the rest of init().
    const jsonPanel = document.getElementById('json-output-panel');
    const jsonBtn = document.getElementById('btn-toggle-json');
    if (jsonPanel && jsonBtn) {
        const applyJsonHidden = (hidden) => {
            jsonPanel.classList.toggle('hidden', hidden);
            jsonBtn.textContent = hidden ? 'Show JSON' : 'Hide JSON';
        };
        applyJsonHidden(localStorage.getItem('biomeEditorJsonHidden') === '1');
        jsonBtn.addEventListener('click', () => {
            const hidden = !jsonPanel.classList.contains('hidden');
            applyJsonHidden(hidden);
            localStorage.setItem('biomeEditorJsonHidden', hidden ? '1' : '0');
        });
    }

    render();
}

init();

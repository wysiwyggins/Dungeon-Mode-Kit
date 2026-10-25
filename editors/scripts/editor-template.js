/* =========================================================================
   editor-template.js — shared Handlebars glue for the Dungeon Mode Kit editors
   -------------------------------------------------------------------------
   The editors build their form UI in JavaScript. This helper lets a section's
   *structure* live in editable Handlebars markup instead, while the *behavior*
   (the model two-way binding) stays generic in JS. Vanilla, no build step:
   templates are inline <script type="text/x-handlebars-template"> blocks that
   we compile in the browser.

   Pattern per section:
     1. render template HTML into a container        -> compileById(id)(data)
     2. wire model binding for [data-bind] inputs    -> bindSection(container, resolveScope)
     3. drop any JS-only widgets into placeholders    -> mountInto(container, name, node)

   The binding convention (the template <-> JS contract):
     data-bind="<key>"        the model key this input reads/writes
     data-type="text|number|checkbox|select|textarea"   how to coerce the value
     data-scope="<name>"      which model object the key lives on (default 'proto');
                              resolved by the resolveScope(name) callback the caller passes
     data-empty="delete"      when the field is cleared, delete the key (vs. store '')
     data-tristate            checkbox only: cycles unset -> true -> false -> unset,
                              so a floor can inherit a flag instead of being forced to
                              pin it. Without this, an unchecked box writes `false`,
                              which the engine's mechanics merge treats as an explicit
                              override (engine.js: config -> biome -> floor spread) —
                              there is then no way back to the inherited value.
                              Renders as indeterminate while the key is absent.

   Mount placeholders for JS-only widgets:
     <div data-mount="someName"></div>   filled by mountInto(root, 'someName', node)

   This file is editor-agnostic so the other editors can adopt the same pattern.
   ========================================================================= */
(function (global) {
    "use strict";

    if (typeof global.Handlebars === 'undefined') {
        throw new Error('editor-template.js requires Handlebars to be loaded first.');
    }
    const Handlebars = global.Handlebars;

    // Cache compiled templates by element id so repeated renders are cheap.
    const _compiled = Object.create(null);

    // Compile (once) the inline template block with the given id and return its
    // render function. Throws clearly if the block is missing.
    function compileById(id) {
        if (_compiled[id]) return _compiled[id];
        const node = document.getElementById(id);
        if (!node) throw new Error('editor-template: no template element #' + id);
        const fn = Handlebars.compile(node.innerHTML);
        _compiled[id] = fn;
        return fn;
    }

    // Register inline partial blocks by name -> element id (or raw source).
    // e.g. registerPartials({ fieldRow: 'tpl-field-row', selectRow: 'tpl-select-row' })
    function registerPartials(map) {
        for (const [name, idOrSource] of Object.entries(map)) {
            const el = document.getElementById(idOrSource);
            const source = el ? el.innerHTML : idOrSource;
            Handlebars.registerPartial(name, source);
        }
    }

    // Read a [data-bind] input's current value, coerced per data-type.
    function readValue(input, type) {
        if (type === 'checkbox') return input.checked;
        if (type === 'number') return input.value === '' ? '' : Number(input.value);
        return input.value;
    }

    // Wire model binding for every [data-bind] input under `root`.
    //
    // resolveScope(name) -> the live model object that `name` refers to. The
    // caller owns this map because scopes are app-specific (e.g. 'proto' is the
    // current edit target, 'mechanics' is target.mechanics). Defaults to a
    // single 'proto' scope if no resolver is given.
    //
    // Behavior is a faithful generalization of the old fieldRow/selectRow/etc:
    // on input/change, mutate obj[key] (delete on empty when data-empty="delete")
    // then call onCommit(). It does NOT re-render — that preserves focus/caret.
    function bindSection(root, opts = {}) {
        const resolveScope = opts.resolveScope || (() => opts.proto);
        const onCommit = opts.onCommit || (() => {});

        root.querySelectorAll('[data-bind]').forEach((input) => {
            const key = input.getAttribute('data-bind');
            const type = input.getAttribute('data-type') || 'text';
            const scopeName = input.getAttribute('data-scope') || 'proto';
            const deleteOnEmpty = input.getAttribute('data-empty') === 'delete';
            const tristate = type === 'checkbox' && input.hasAttribute('data-tristate');
            const evt = (type === 'checkbox' || type === 'select') ? 'change' : 'input';

            // Initialize the control from the model.
            const obj = resolveScope(scopeName);
            const cur = obj ? obj[key] : undefined;
            if (type === 'checkbox') {
                input.checked = !!cur;
                // Absent key == "inherit". Shown as indeterminate so it reads as
                // distinct from an explicit false.
                if (tristate) input.indeterminate = (cur === undefined);
            } else {
                input.value = (cur != null) ? cur : '';
            }

            if (tristate) {
                const sync = () => {
                    const o = resolveScope(scopeName);
                    const v = o ? o[key] : undefined;
                    input.indeterminate = (v === undefined);
                    input.checked = !!v;
                    input.title = v === undefined
                        ? 'Inherited — click to set true'
                        : (v ? 'Explicitly true — click to set false' : 'Explicitly false — click to inherit');
                };
                sync();
                // The browser drives checked itself on click, so read the model, not
                // the control, to decide the next state in the cycle.
                input.addEventListener('click', () => {
                    const o = resolveScope(scopeName);
                    if (!o) return;
                    const v = o[key];
                    if (v === undefined) o[key] = true;
                    else if (v) o[key] = false;
                    else delete o[key];
                    sync();
                    onCommit();
                });
                return;
            }

            input.addEventListener(evt, () => {
                // Re-resolve the scope on each event: the edit target can change
                // (proto vs. floor) without re-binding, and mechanics objects are
                // created lazily.
                const o = resolveScope(scopeName);
                if (!o) return;
                const val = readValue(input, type);
                if (deleteOnEmpty && (val === '' || val == null)) delete o[key];
                else o[key] = val;
                onCommit();
            });
        });
    }

    // Replace a <... data-mount="name"> placeholder with a live DOM node built
    // in JS (sliders, color pickers, dynamic-list editors). Returns the mounted
    // node, or null if the placeholder wasn't found.
    function mountInto(root, name, node) {
        const slot = root.querySelector('[data-mount="' + name + '"]');
        if (!slot || !node) return null;
        slot.replaceWith(node);
        return node;
    }

    global.EditorTemplate = { compileById, registerPartials, bindSection, mountInto };
})(window);

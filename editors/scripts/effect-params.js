/* =========================================================================
   effect-params.js — slider schema for the effect primitives in effects.js
   -------------------------------------------------------------------------
   effects.js is the source of truth for WHICH primitives exist; this file only
   describes how to EDIT each one's params — ranges, steps, labels and defaults,
   none of which are recoverable from the function bodies. So the primitive list
   is read from `EffectPrimitives` at runtime and this table is looked up by
   name; a primitive missing here still appears in the editor, it just gets no
   sliders. `warnMissingEffectParams()` reports those, because the last time the
   two lists were maintained separately three primitives went missing and the
   editor silently dropped their params on save.

   Defaults must match the destructured defaults in effects.js — where they
   disagree the editor shows a value the engine will not use.

   Requires effects.js to be loaded first (for the drift check only). Like the
   other editor scripts this is a plain <script src> include sharing one global
   scope — no IIFE, no exports.
   ========================================================================= */
"use strict";

const PRIMITIVE_PARAMS = {
    tint_flicker: [
        { key: 'color_variation', type: 'hex', default: '0x181808', label: 'Color Variation', expandRGB: true },
        { key: 'lighter_min', type: 'range', min: 20, max: 500, step: 10, default: 100, label: 'Lighter Min (ms)' },
        { key: 'lighter_max', type: 'range', min: 50, max: 1000, step: 10, default: 280, label: 'Lighter Max (ms)' },
        { key: 'base_min', type: 'range', min: 50, max: 1000, step: 10, default: 200, label: 'Base Min (ms)' },
        { key: 'base_max', type: 'range', min: 100, max: 2000, step: 10, default: 500, label: 'Base Max (ms)' },
        { key: 'darker_min', type: 'range', min: 20, max: 500, step: 10, default: 80, label: 'Darker Min (ms)' },
        { key: 'darker_max', type: 'range', min: 50, max: 1000, step: 10, default: 200, label: 'Darker Max (ms)' },
        { key: 'transition_ms', type: 'range', min: 10, max: 300, step: 5, default: 80, label: 'Transition (ms)' },
    ],
    tint_cycle: [
        { key: 'color_variation', type: 'hex', default: '0x000000', label: 'Color Variation', expandRGB: true },
        { key: 'amplitude', type: 'range', min: 0, max: 50, step: 1, default: 0, label: 'Amplitude' },
        { key: 'speed', type: 'range', min: 0.0001, max: 0.02, step: 0.0001, default: 0.002, label: 'Speed' },
        { key: 'mod_speed', type: 'range', min: 0, max: 0.005, step: 0.00001, default: 0, label: 'Mod Speed' },
        { key: 'phase_factor', type: 'range', min: 0, max: 2, step: 0.001, default: 0.618, label: 'Phase Factor' },
        { key: 'waveform', type: 'select', options: ['sine', 'step'], default: 'sine', label: 'Waveform' },
        { key: 'step_up', type: 'range', min: 0, max: 1, step: 0.01, default: 0.33, label: 'Step Up', showWhen: { waveform: 'step' } },
        { key: 'step_down', type: 'range', min: -1, max: 0, step: 0.01, default: -0.33, label: 'Step Down', showWhen: { waveform: 'step' } },
        { key: 'blend', type: 'range', min: 0, max: 1, step: 0.01, default: 0, label: 'Blend', showWhen: { waveform: 'step' } },
    ],
    // Cycles hue continuously rather than oscillating around a base tint, so it
    // takes a saturation rather than a colour variation.
    hue_cycle: [
        { key: 'speed', type: 'range', min: 0.0001, max: 0.01, step: 0.0001, default: 0.0012, label: 'Speed' },
        { key: 'saturation', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55, label: 'Saturation' },
    ],
    // `colors` is a cyclic palette ring — the wave sweeps the stops in order and
    // wraps from the last back to the first, so two stops pulse and three rotate.
    gradient_wave: [
        { key: 'colors', type: 'color_list', default: ['0xCC1111', '0xFFCC22'], label: 'Colors' },
        { key: 'speed', type: 'range', min: 0.0001, max: 0.01, step: 0.0001, default: 0.0015, label: 'Speed' },
    ],
    radial_gradient: [
        { key: 'colors', type: 'color_list', default: ['0xCC1111', '0xFFCC22'], label: 'Colors' },
        { key: 'speed', type: 'range', min: 0.0001, max: 0.005, step: 0.0001, default: 0.0009, label: 'Speed' },
        { key: 'rings', type: 'range', min: 1, max: 8, step: 1, default: 2, label: 'Rings' },
    ],
    screen_shake: [
        { key: 'intensity', type: 'range', min: 1, max: 20, step: 1, default: 6, label: 'Intensity' },
        { key: 'duration_ms', type: 'range', min: 50, max: 1000, step: 10, default: 200, label: 'Duration (ms)' },
        { key: 'decay', type: 'checkbox', default: true, label: 'Decay' },
    ],
    canvas_flash: [
        { key: 'color', type: 'hex', default: '0xFFFFFF', label: 'Color' },
        { key: 'duration_ms', type: 'range', min: 50, max: 5000, step: 10, default: 150, label: 'Duration (ms)' },
        { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Opacity' },
        { key: 'blend_mode', type: 'select', options: ['normal', 'add', 'multiply'], default: 'normal', label: 'Blend Mode' },
        { key: 'z_index', type: 'range', min: 0, max: 200, step: 1, default: 0, label: 'Z Index' },
    ],
    hue_oscillate: [
        { key: 'speed', type: 'range', min: 0.0001, max: 0.01, step: 0.0001, default: 0.002, label: 'Speed' },
        { key: 'amplitude', type: 'range', min: 0, max: 180, step: 1, default: 40, label: 'Amplitude' },
        { key: 'secondary_speed', type: 'range', min: 0, max: 0.005, step: 0.0001, default: 0.0007, label: 'Secondary Speed' },
        { key: 'secondary_amplitude', type: 'range', min: 0, max: 90, step: 1, default: 20, label: 'Secondary Amplitude' },
    ],
    brightness_oscillate: [
        { key: 'speed', type: 'range', min: 0.0001, max: 0.01, step: 0.0001, default: 0.003, label: 'Speed' },
        { key: 'amplitude', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.05, label: 'Amplitude' },
    ],
    alpha_pulse: [
        { key: 'speed', type: 'range', min: 0.0001, max: 0.01, step: 0.0001, default: 0.003, label: 'Speed' },
        { key: 'min_alpha', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, label: 'Min Alpha' },
        { key: 'max_alpha', type: 'range', min: 0, max: 1, step: 0.01, default: 1.0, label: 'Max Alpha' },
    ],
    radial_tile_fill: [
        { key: 'color', type: 'hex', default: '0xCC8844', label: 'Color' },
        { key: 'duration_ms', type: 'range', min: 100, max: 2000, step: 10, default: 600, label: 'Duration (ms)' },
        { key: 'radius', type: 'range', min: 1, max: 10, step: 1, default: 3, label: 'Radius' },
        { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7, label: 'Opacity' },
        { key: 'ring_delay_ms', type: 'range', min: 10, max: 200, step: 5, default: 60, label: 'Ring Delay (ms)' },
        { key: 'fade_ms', type: 'range', min: 50, max: 1000, step: 10, default: 300, label: 'Fade (ms)' },
        { key: 'blend_mode', type: 'select', options: ['normal', 'add', 'multiply'], default: 'multiply', label: 'Blend Mode' },
    ],
    line_tile_fill: [
        { key: 'color', type: 'hex', default: '0xAADDFF', label: 'Color' },
        { key: 'duration_ms', type: 'range', min: 100, max: 2000, step: 10, default: 400, label: 'Duration (ms)' },
        { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.9, label: 'Opacity' },
        { key: 'tile_delay_ms', type: 'range', min: 5, max: 100, step: 5, default: 25, label: 'Tile Delay (ms)' },
        { key: 'fade_ms', type: 'range', min: 50, max: 500, step: 10, default: 200, label: 'Fade (ms)' },
        { key: 'blend_mode', type: 'select', options: ['normal', 'add', 'multiply'], default: 'add', label: 'Blend Mode' },
    ],
    color_overlay: [
        { key: 'container', type: 'select', options: ['darkness'], default: 'darkness', label: 'Container' },
        { key: 'blend_mode', type: 'select', options: ['normal', 'multiply', 'add'], default: 'multiply', label: 'Blend Mode' },
        { key: 'z_index', type: 'range', min: 0, max: 200, step: 1, default: 100, label: 'Z Index' },
    ],
    color_invert: [],
    tile_color_drift: [
        { key: 'amplitude', type: 'range', min: 0, max: 120, step: 1, default: 60, label: 'Amplitude' },
        { key: 'throttle_frames', type: 'range', min: 1, max: 10, step: 1, default: 4, label: 'Throttle Frames' },
    ],
    texture_scramble: [
        { key: 'skip_player', type: 'checkbox', default: true, label: 'Skip Player' },
    ],
    floor_swap: [
        { key: 'count_min', type: 'range', min: 1, max: 10, step: 1, default: 1, label: 'Count Min' },
        { key: 'count_max', type: 'range', min: 1, max: 10, step: 1, default: 2, label: 'Count Max' },
    ],
};

/**
 * The effects an actor or item may name in its `effect` field: those declared
 * `"target": "sprite"` in effects.json. The other targets act on the stage or the
 * whole scene and do nothing useful attached to one sprite, so offering them would
 * only invite bug reports. Data-driven for the same reason the animation dropdowns
 * are — a new sprite effect should join the list without an editor edit.
 * @param {Object} effects - Parsed data/effects.json
 * @returns {string[]} Sorted effect names
 */
function spriteEffectNames(effects) {
    return Object.entries(effects || {})
        .filter(([, def]) => def && def.target === 'sprite')
        .map(([name]) => name)
        .sort();
}

/**
 * Fill a <select> with the sprite effects, keeping the current value if it is
 * still offered — an actor may name an effect a prototype defines but the base
 * library does not, and reloading the form shouldn't silently clear it.
 * @param {HTMLSelectElement} sel
 * @param {Object} effects - Parsed data/effects.json
 * @param {string} [current] - Value to preserve/select
 */
function populateSpriteEffectSelect(sel, effects, current) {
    if (!sel) return;
    const names = spriteEffectNames(effects);
    const keep = current ?? sel.value;
    sel.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'none';
    sel.appendChild(none);

    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        // "flicker_tint" -> "Flicker tint", so the list reads as labels.
        opt.textContent = name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
        sel.appendChild(opt);
    }

    // An effect this library doesn't define (a prototype's own) still has to be
    // selectable, or opening the actor would quietly drop it.
    if (keep && !names.includes(keep)) {
        const opt = document.createElement('option');
        opt.value = keep;
        opt.textContent = `${keep} (not in effects.json)`;
        sel.appendChild(opt);
    }
    sel.value = keep || '';
}

/**
 * The primitives the engine actually ships, read from effects.js rather than
 * from the table above — so a new primitive is editable the moment it exists.
 * @returns {string[]} Sorted primitive names
 */
function effectPrimitiveNames() {
    if (typeof EffectPrimitives === 'undefined') {
        console.warn('effect-params.js: effects.js not loaded; falling back to the local schema.');
        return Object.keys(PRIMITIVE_PARAMS).sort();
    }
    return Object.keys(EffectPrimitives).sort();
}

/**
 * Log any primitive that has no slider schema, so drift is loud rather than
 * silent. Called once at editor init.
 */
function warnMissingEffectParams() {
    if (typeof EffectPrimitives === 'undefined') return;
    const missing = Object.keys(EffectPrimitives).filter(n => !PRIMITIVE_PARAMS[n]);
    if (missing.length) {
        console.warn(
            `effect-params.js: no param schema for ${missing.join(', ')} — ` +
            `these primitives are selectable but have no editable params.`
        );
    }
    const extra = Object.keys(PRIMITIVE_PARAMS).filter(n => !EffectPrimitives[n]);
    if (extra.length) {
        console.warn(`effect-params.js: schema for unknown primitive(s) ${extra.join(', ')}.`);
    }
}

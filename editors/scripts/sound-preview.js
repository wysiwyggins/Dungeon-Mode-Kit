/* =========================================================================
   sound-preview.js — play a sound when it's picked in an editor field
   -------------------------------------------------------------------------
   Include on any editor page; it wires itself with one document-level
   listener, so forms that are rebuilt need nothing extra. It watches:

   - sound reference fields (input[data-ref="sound"], see ref-fields.js):
     plays when a name is picked from the datalist, or on change (Enter/blur)
     when the typed text is a known sound. Typing letter by letter doesn't
     play, so "tone3" doesn't sound "tone" on the way.
   - <select data-sound-preview>: plays on change.

   Howler (lib/howler.js) and the audio sprite (data/sounds.json, the same map
   the engine loads) are loaded on the first pick, so pages pay nothing until
   then. Exposes SoundPreview.play(name) for anything that wants it directly.
   ========================================================================= */
const SoundPreview = (() => {
    'use strict';

    let howlPromise = null;
    let current = null;              // id of the sound playing now
    const lastPlayed = new WeakMap(); // input -> value it last played, to skip a repeat on blur

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('could not load ' + src));
            document.head.appendChild(s);
        });
    }

    function loadHowl() {
        howlPromise ??= (async () => {
            if (typeof Howl === 'undefined') await loadScript('../lib/howler.js');
            const data = await (await fetch('../data/sounds.json')).json();
            // The sprite's urls are root-relative ("/assets/..."), written for the
            // root pages; editor pages sit one level down.
            const src = (data.urls || []).map(u => (u.startsWith('/') ? '..' + u : u));
            return new Howl({ src, sprite: data.sprite || {} });
        })().catch((e) => {
            console.warn('Sound preview unavailable:', e);
            howlPromise = null;
            return null;
        });
        return howlPromise;
    }

    async function play(name) {
        name = String(name || '').trim();
        if (!name) return;
        const howl = await loadHowl();
        if (!howl || !howl._sprite?.[name]) return;
        if (current != null) howl.stop(current);
        current = howl.play(name);
    }

    function playFromInput(inp) {
        const val = inp.value.trim();
        if (!val || lastPlayed.get(inp) === val) return;
        lastPlayed.set(inp, val);
        play(val);
    }

    // A datalist pick fires `input` with no inputType (Firefox) or
    // 'insertReplacementText' (Chrome/Safari); typing is 'insertText' etc.
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || t.dataset.ref !== 'sound') return;
        if (!e.inputType || e.inputType === 'insertReplacementText') playFromInput(t);
        else lastPlayed.delete(t);
    });

    document.addEventListener('change', (e) => {
        const t = e.target;
        if (t instanceof HTMLInputElement && t.dataset.ref === 'sound') playFromInput(t);
        else if (t instanceof HTMLSelectElement && t.hasAttribute('data-sound-preview')) play(t.value);
    });

    return { play };
})();

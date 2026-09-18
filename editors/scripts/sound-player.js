// ============================================================================
// SOUND PLAYER
// ============================================================================
// Auditions every sound in the audio sprite. Reads data/sounds.json — the same
// sprite map the engine loads — so the list is never a hand-maintained copy:
// recompile the sprite and new sounds show up here automatically.

(function () {
    'use strict';

    // Editor pages sit one level down, so the sprite's own "/assets/..." urls
    // (absolute, written for the root pages) can't be used as-is.
    const SPRITE_URL = '../data/sounds.json';
    const AUDIO_DIR = '../assets/audio';

    let howl = null;
    let soundNames = [];        // every sprite key, sorted
    let visibleNames = [];      // the subset currently passing the filter
    let selectedIndex = -1;     // keyboard cursor into visibleNames
    let volume = 1.0;
    let rate = 1.0;

    const els = {};

    // ---- Loading ----------------------------------------------------------

    async function loadSprite() {
        setStatus('loading sprite…');

        let data;
        try {
            const res = await fetch(SPRITE_URL);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            data = await res.json();
        } catch (err) {
            setStatus(`could not load ${SPRITE_URL} — ${err.message}`, true);
            return;
        }

        if (!data || !data.sprite) {
            setStatus(`${SPRITE_URL} has no "sprite" map`, true);
            return;
        }

        soundNames = Object.keys(data.sprite).sort();

        // Rewrite the sprite's root-relative urls to reach up out of /editors/.
        const urls = (data.urls || []).map(url =>
            url.startsWith('/') ? `..${url}` : url
        );
        const srcs = urls.length
            ? urls
            : ['mp3', 'ogg', 'm4a'].map(ext => `${AUDIO_DIR}/sounds.${ext}`);

        howl = new Howl({
            src: srcs,
            sprite: data.sprite,
            volume: volume,
            onload: () => setStatus(`${soundNames.length} sounds loaded`),
            onloaderror: (_id, err) => setStatus(`audio failed to load: ${err}`, true)
        });

        renderGrid(soundNames, data.sprite);
    }

    // ---- Rendering --------------------------------------------------------

    function renderGrid(names, sprite) {
        els.grid.innerHTML = '';

        names.forEach(name => {
            const [, durationMs] = sprite[name];

            const btn = document.createElement('button');
            btn.className = 'sound-chip';
            btn.dataset.sound = name;
            btn.type = 'button';

            const label = document.createElement('span');
            label.className = 'sound-name';
            label.textContent = name;

            const meta = document.createElement('span');
            meta.className = 'sound-duration';
            meta.textContent = `${(durationMs / 1000).toFixed(2)}s`;

            btn.append(label, meta);
            btn.addEventListener('click', () => {
                selectByName(name);
                play(name);
            });

            els.grid.appendChild(btn);
        });

        applyFilter();
    }

    // Filtering hides chips rather than re-rendering, so the DOM (and the
    // playing/selected classes on it) survives typing.
    function applyFilter() {
        const query = els.filter.value.trim().toLowerCase();
        visibleNames = [];

        els.grid.querySelectorAll('.sound-chip').forEach(chip => {
            const name = chip.dataset.sound;
            const match = !query || name.toLowerCase().includes(query);
            chip.classList.toggle('hidden', !match);
            if (match) visibleNames.push(name);
        });

        els.emptyHint.classList.toggle('hidden', visibleNames.length > 0);

        // Drop a cursor that the filter just hid.
        if (selectedIndex >= 0 && !visibleNames.includes(currentName())) {
            setSelected(-1);
        }
    }

    function currentName() {
        return visibleNames[selectedIndex];
    }

    function chipFor(name) {
        return els.grid.querySelector(`.sound-chip[data-sound="${name}"]`);
    }

    function setSelected(index) {
        const previous = chipFor(currentName());
        if (previous) previous.classList.remove('selected');

        selectedIndex = index;

        const chip = chipFor(currentName());
        if (chip) {
            chip.classList.add('selected');
            chip.scrollIntoView({ block: 'nearest' });
        }
    }

    function selectByName(name) {
        setSelected(visibleNames.indexOf(name));
    }

    function moveSelection(delta) {
        if (!visibleNames.length) return;
        // From nothing, ↓ lands on the first entry and ↑ on the last.
        const next = selectedIndex < 0
            ? (delta > 0 ? 0 : visibleNames.length - 1)
            : (selectedIndex + delta + visibleNames.length) % visibleNames.length;
        setSelected(next);
    }

    // ---- Playback ---------------------------------------------------------

    function play(name) {
        if (!howl) return;

        const id = howl.play(name);
        howl.rate(rate, id);

        const chip = chipFor(name);
        if (!chip) return;

        chip.classList.add('playing');
        // Whichever of end/stop fires first wins; the other is torn down by
        // hand. Howler only auto-removes a `once` listener when its own event
        // fires, and these ids are never reused, so the loser would otherwise
        // sit in the event list for the life of the page.
        const clear = () => {
            chip.classList.remove('playing');
            howl.off('end', clear, id);
            howl.off('stop', clear, id);
        };
        howl.on('end', clear, id);
        // A stop-all kills the sound without firing 'end', so clear on that too.
        howl.on('stop', clear, id);
    }

    function stopAll() {
        if (howl) howl.stop();
        els.grid.querySelectorAll('.playing').forEach(chip =>
            chip.classList.remove('playing')
        );
    }

    function setStatus(text, isError = false) {
        els.status.textContent = text;
        els.status.classList.toggle('status-error', isError);
    }

    // ---- Wiring -----------------------------------------------------------

    function init() {
        els.grid = document.getElementById('sound-grid');
        els.filter = document.getElementById('sound-filter');
        els.status = document.getElementById('load-status');
        els.emptyHint = document.getElementById('empty-hint');
        els.volume = document.getElementById('master-volume');
        els.rate = document.getElementById('master-rate');

        els.filter.addEventListener('input', applyFilter);

        els.volume.addEventListener('input', () => {
            volume = parseFloat(els.volume.value);
            if (howl) howl.volume(volume);
        });

        els.rate.addEventListener('input', () => {
            rate = parseFloat(els.rate.value);
        });

        document.getElementById('btn-reset-rate').addEventListener('click', () => {
            rate = 1.0;
            els.rate.value = '1';
        });

        document.getElementById('btn-stop').addEventListener('click', stopAll);

        document.addEventListener('keydown', event => {
            // Let the filter box keep its own arrow/space handling.
            const typing = event.target === els.filter;

            if (event.key === 'ArrowDown' && !typing) {
                event.preventDefault();
                moveSelection(1);
            } else if (event.key === 'ArrowUp' && !typing) {
                event.preventDefault();
                moveSelection(-1);
            } else if (event.key === 'Enter' || (event.key === ' ' && !typing)) {
                if (currentName()) {
                    event.preventDefault();
                    play(currentName());
                }
            } else if (event.key === 'Escape') {
                stopAll();
            }
        });

        loadSprite();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

/* =========================================================================
   editor-nav.js — the nav bar across the top of every editor page
   -------------------------------------------------------------------------
   Include as the first thing inside <body>; it prepends the bar right away, so
   it sits above the page header before the rest of the page parses.

   Links carry ?workspace=<name> so the editor you open lands on the same
   workspace even in another tab. The workspace name is shown only on pages
   that use workspaces, recognized by having loaded scripts/workspace.js by
   DOMContentLoaded; other pages still edit the server's files and shouldn't
   look otherwise. Those pages own the label: they call
   EditorNav.setWorkspace(name) whenever their open workspace changes.

   Workspace pages also get a Playtest link, which runs the workspace in the
   game as ?prototype=ws~<name> (served by workspace-sw.js). It opens in one
   named tab, so clicking it again reloads that tab instead of piling up new
   ones. Pages register a save hook with EditorNav.onBeforePlaytest(fn); it
   runs before the game loads, so pending edits are in the files it reads.
   ========================================================================= */
const EditorNav = (() => {
    'use strict';

    const PAGES = [
        ['prototype-editor.html', 'Prototype'],
        ['biome-editor.html', 'Biomes'],
        ['actor-editor.html', 'Actors'],
        ['item-editor.html', 'Items'],
        ['spell-editor.html', 'Spells'],
        ['personality-editor.html', 'Personalities'],
        ['entity-editor.html', 'Entities'],
        ['vfx-editor.html', 'VFX'],
        ['sound-player.html', 'Sounds'],
    ];

    const PLAYTEST_TAB = 'dmk-playtest';

    const here = location.pathname.split('/').pop() || '';
    const links = [];
    const beforePlaytest = [];
    let label = null;
    let playtest = null;

    // Same rule as Workspace.current(), readable without workspace.js loaded.
    function currentWorkspace() {
        return new URLSearchParams(location.search).get('workspace')
            || localStorage.getItem('dmk.workspace') || '';
    }

    function setWorkspace(name) {
        for (const [a, file] of links) {
            a.href = name ? `${file}?workspace=${encodeURIComponent(name)}` : file;
        }
        if (label) {
            label.textContent = name || 'none';
            label.classList.toggle('none', !name);
        }
        if (playtest) {
            playtest.hidden = !name;
            playtest.href = name ? `../index.html?prototype=ws~${encodeURIComponent(name)}` : '';
        }
    }

    function onBeforePlaytest(fn) {
        beforePlaytest.push(fn);
    }

    // The service worker only runs over https or localhost.
    function canPlaytest() {
        return 'serviceWorker' in navigator && window.isSecureContext;
    }

    /* Open the playtest tab right away (a popup blocker only allows it inside
       the click), then save, then point the tab at the game. Opening '' in an
       existing named tab leaves it alone until its location is set. */
    async function startPlaytest(e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const url = playtest.href;
        const win = window.open('', PLAYTEST_TAB);
        for (const fn of beforePlaytest) {
            try { await fn(); } catch (err) { console.error('Save before playtest failed:', err); }
        }
        if (win) win.location.href = url;
        else window.open(url, PLAYTEST_TAB);
    }

    function buildPlaytest(nav) {
        playtest = document.createElement('a');
        playtest.className = 'editor-nav-playtest';
        playtest.textContent = 'Playtest ▸';
        playtest.target = PLAYTEST_TAB;
        playtest.title = 'Run this workspace in the game (in its own tab)';
        playtest.addEventListener('click', startPlaytest);
        nav.appendChild(playtest);
    }

    function build() {
        const nav = document.createElement('nav');
        nav.className = 'editor-nav';
        const home = document.createElement('a');
        home.href = '../index.html';
        home.className = 'editor-nav-home';
        home.textContent = 'DMK';
        home.title = 'Back to the Dungeon Mode Kit index';
        nav.appendChild(home);

        for (const [file, text] of PAGES) {
            const a = document.createElement('a');
            a.textContent = text;
            if (file === here) a.setAttribute('aria-current', 'page');
            links.push([a, file]);
            nav.appendChild(a);
        }

        document.body.prepend(nav);
        setWorkspace(currentWorkspace());

        // Page scripts load after this one, so whether this page uses
        // workspaces is only known once they have run.
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof Workspace === 'undefined') {
                // Not a workspace page: just follow the active workspace that
                // other tabs set, so links stay current.
                window.addEventListener('storage', (e) => {
                    if (e.key === 'dmk.workspace') setWorkspace(e.newValue || '');
                });
                return;
            }
            const ws = document.createElement('span');
            ws.className = 'editor-nav-workspace';
            ws.textContent = 'Workspace: ';
            label = document.createElement('strong');
            ws.appendChild(label);
            nav.appendChild(ws);
            if (canPlaytest()) buildPlaytest(nav);
            setWorkspace(currentWorkspace());
        });
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build, { once: true });

    return { setWorkspace, onBeforePlaytest };
})();

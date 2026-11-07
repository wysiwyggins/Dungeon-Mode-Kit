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

   The Playtest link waits for phase 3 (the service worker that serves
   workspaces to the game); see docs/EDITOR_WORKSPACE.md.
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

    const here = location.pathname.split('/').pop() || '';
    const links = [];
    let label = null;

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
            setWorkspace(currentWorkspace());
        });
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build, { once: true });

    return { setWorkspace };
})();

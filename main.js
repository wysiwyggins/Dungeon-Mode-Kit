/**
 * Dungeon Mode Kit - entry point. Game pages load this one module (after the
 * lib/ scripts); it pulls in the rest of the engine through its imports and
 * exposes initializeGame() plus the console debug helpers on window.
 */

import { DungeonEngine } from './engine/dungeon-engine.js';
import { Item } from './engine/item.js';
import { Prototype } from './engine/prototype.js';

// ============================================================================
// INITIALIZATION
// ============================================================================

let engine = null;

async function initializeGame() {
    const gameContainer = document.getElementById('game');
    
    try {
        console.log('Starting game initialization...');
        
        // Clear any existing content
        gameContainer.innerHTML = '';
        
        // Parse URL parameters early — needed for seed before any RNG consumption
        const urlParams = new URLSearchParams(window.location.search);

        // Seed the RNG before anything else (loadGlobalData, map generation, etc.)
        const urlSeed = urlParams.get('seed');
        const seed = urlSeed ? Number(urlSeed) : Date.now();
        ROT.RNG.setSeed(seed);
        console.log(`RNG seeded: ${seed}${urlSeed ? ' (from URL)' : ' (generated)'}`);

        engine = new DungeonEngine();
        window.engine = engine; // module scope isn't visible from the devtools console
        engine.currentSeed = seed;
        await engine.initialize();

        // Determine which prototype to load (priority order):
        // 1. URL parameter: ?prototype=labyrinth
        // 2. Data attribute on game container: <div id="game" data-prototype="labyrinth">
        // 3. Global config object: window.DUNGEON_CONFIG = { prototype: 'labyrinth' }
        // 4. Default: 'default'
        const urlPrototype = urlParams.get('prototype');
        const dataPrototype = gameContainer.dataset.prototype;
        const configPrototype = window.DUNGEON_CONFIG?.prototype;

        // Normalize prototype name - extract just the name if a full path was provided
        const normalizePrototypeName = (name) => {
            if (!name) return null;
            // Remove leading slashes and any path prefix, keep only the last segment
            return name.replace(/^\/+/, '').split('/').pop();
        };

        const rawPrototype = urlPrototype || dataPrototype || configPrototype || 'default';
        const firstPrototype = normalizePrototypeName(rawPrototype);
        console.log(`Loading prototype: ${firstPrototype} (source: ${urlPrototype ? 'URL' : dataPrototype ? 'data-attribute' : configPrototype ? 'config' : 'default'})`);

        await engine.loadPrototype(firstPrototype);
        
        console.log('Game initialized successfully');
    } catch (error) {
        console.error('Failed to initialize game:', error);
        gameContainer.innerHTML = `
            <div style="color: red; padding: 20px; font-family: monospace;">
                <h2>Failed to Initialize Game</h2>
                <p><strong>Error:</strong> ${error.message}</p>
                <pre style="background: #f5f5f5; padding: 10px; overflow: auto;">${error.stack}</pre>
                <button onclick="initializeGame()" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }
}

// Manual initialization - uncomment to enable auto-start
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', initializeGame);
// } else {
//     initializeGame();
// }

// For debugging: expose initialization function to console
window.initializeGame = initializeGame;

// Level loading utilities for developer console
// This confuses the terms 'level' and 'prototype,' since originally there were only single floor prototypes which we could assign depth to, now there are multi floor prototypes.
// we should have a loadPrototype debug function and a loadFloor for a floor in that prototype
const levelsByDepth = [
    { name: 'test', description: 'Test Prototype' },
    { name: 'labyrinth', description: 'Cretan Labyrinth' }
];

window.loadLevel = async (levelIdentifier) => {
    if (!engine) {
        console.error('Engine not initialized. Run initializeGame() first.');
        return;
    }

    let prototypeName;

    // Check if it's a number (depth) or string (name)
    if (typeof levelIdentifier === 'number') {
        const depth = levelIdentifier;
        if (depth < 0 || depth >= levelsByDepth.length) {
            console.error(`Invalid depth: ${depth}. Valid range: 0-${levelsByDepth.length - 1}`);
            window.listLevels();
            return;
        }
        prototypeName = levelsByDepth[depth].name;
        console.log(`Loading depth ${depth}: ${prototypeName}`);
    } else {
        prototypeName = levelIdentifier;
        console.log(`Loading level: ${prototypeName}`);
    }

    await engine.reloadPrototype(prototypeName);
};

window.listLevels = () => {
    const levels = levelsByDepth.map((level, depth) => ({
        depth,
        name: level.name,
        description: level.description
    }));
    console.table(levels);
    console.log('Use loadLevel(depth) or loadLevel("name") to load a level');
    return levels;
};

window.giveItem = (itemType, count = 1) => {
    if (!engine) {
        console.error('Engine not initialized.');
        return;
    }
    const player = engine.entityManager.player;
    if (!player) {
        console.error('No player found.');
        return;
    }
    const itemData = engine.currentPrototype.getItemData(itemType);
    if (!itemData) {
        console.error(`Item type '${itemType}' not found.`);
        return;
    }
    for (let i = 0; i < count; i++) {
        // Re-resolve each time so `giveItem('potion', 3)` rolls three potions
        // rather than three copies of one.
        const rolled = engine.currentPrototype.getItemData(itemType) || itemData;
        const item = new Item(-1, -1, rolled.id || itemType, rolled, engine);
        item.owner = player;
        player.inventory.push(item);
    }
    console.log(`Gave ${count}x ${itemData.name || itemType} to ${player.name}`);
};

window.goToFloor = async (floorNumber) => {
    if (!engine) {
        console.error('Engine not initialized.');
        return;
    }
    const totalFloors = engine.getTotalFloors();
    if (floorNumber < 1 || floorNumber > totalFloors) {
        console.error(`Invalid floor: ${floorNumber}. Valid range: 1-${totalFloors}`);
        return;
    }
    const prototypeName = engine.currentPrototype.name;
    engine.cleanup();
    const prototypeConfig = await engine.loadPrototypeConfig(prototypeName);
    engine.currentPrototype = new Prototype(prototypeName, prototypeConfig, engine);
    await engine.currentPrototype.loadAssets();
    engine.currentFloor = floorNumber;
    engine.floorStates.clear();
    engine.pendingFallenActors.clear();
    engine.pendingFallenItems.clear();
    engine.pendingStairFollowers.clear();
    engine.sealedDownFloors.clear();
    engine.mappedFloors.clear();
    await engine.loadFloor(floorNumber, 'from_above');
    console.log(`Jumped to floor ${floorNumber}/${totalFloors}`);
};

// Debug: render the win screen directly with an arbitrary message, without
// having to satisfy any win conditions. Routes through the same
// RenderSystem.showWinScreen() path the real win uses, so it exercises the
// line-wrapping. Pass a long string to test wrapping; omit for a default one.
window.testWinScreen = (message) => {
    if (!engine) {
        console.error('Engine not initialized.');
        return;
    }
    if (!engine.renderer) {
        console.error('Renderer not ready.');
        return;
    }
    const text = message ??
        'You have triumphed over the endless dark and carried the amulet of yendor back into the light of day, and this sentence is deliberately far wider than the viewport so the wrapping can be seen.';
    // Mirror buildWinScreenLines: a single message line (wrapping happens in showWinScreen).
    engine.renderer.showWinScreen(engine.viewportWidth, engine.viewportHeight, [text]);
    console.log(`Win screen rendered with message (${text.length} chars). Call location.reload() to dismiss.`);
};

// Debug: open the text input window. Takes the same options as
// InputManager.openTextInput; with none, a name prompt with Submit/Cancel.
//   testTextInput({ prompt: 'Epitaph', maxLength: 60, width: 24, buttons: ['submit'] })
//   testTextInput({ buttons: [] })   // keyboard only: Enter / Esc
// window.testTextInput = async (options = {}) => {
//     if (!engine?.inputManager) {
//         console.error('Engine not initialized.');
//         return;
//     }
//     const result = await engine.inputManager.openTextInput({
//         prompt: 'Enter a name',
//         buttons: ['submit', 'cancel'],
//         ...options
//     });
//     console.log(result === null ? 'Text input cancelled.' : `Text input submitted: "${result}"`);
//     return result;
// };

console.log('Dungeon Mode Kit loaded. Call initializeGame() to start.');
console.log('Level utilities: listLevels(), loadLevel("prototypeName"), giveItem("itemType", count), goToFloor(n)');
console.log('Debug: testWinScreen("optional custom message") — render the win screen to test line-wrapping.');
// console.log('Debug: testTextInput({ prompt, maxLength, width, buttons }) — open the text input window.');

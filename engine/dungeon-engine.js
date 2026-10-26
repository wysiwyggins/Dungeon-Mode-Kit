/**
 * Dungeon Mode Kit - Core Engine, 2025- Wiley Wiggins
 * A modular roguelike engine supporting multiple prototypes with mixed authored/procedural content, built on rot.js and pixi.js
 *
 * DungeonEngine: setup, asset loading, the turn engine, lighting/viewport updates
 * and audio. Its other method groups are installed from engine/dungeon-engine/.
 */

import { installMethods } from '../core/mixin.js';
import { buildWordRegistry, shuffleArray } from '../core/util.js';
import { DungeonEngineFloors } from './dungeon-engine/floors.js';
import { DungeonEnginePersistence } from './dungeon-engine/persistence.js';
import { DungeonEngineProgression } from './dungeon-engine/progression.js';
import { DungeonEngineStairways } from './dungeon-engine/stairways.js';
import { RenderSystem } from './render/render-system.js';
import { SpriteLibrary } from './sprite-library.js';
import { globalVars } from '../globals.js';
import { InputManager } from '../input.js';
import { LightingManager } from '../lighting.js';
import { AudioManager } from '../sound.js';
import { InterfaceManager } from '../ui/interface-manager.js';

// ============================================================================
// CORE ENGINE CLASS
// ============================================================================

export class DungeonEngine {
    constructor(config = {}) {
        this.app = null;
        this.scheduler = null;
        this.turnEngine = null;
        this.renderer = null;
        this.mapManager = null;
        this.entityManager = null;
        this.inputManager = null;
        this.lightingManager = null;
        this.interfaceManager = null;
        this.spriteLibrary = new SpriteLibrary();
        
        // Game state
        this.currentPrototype = null;
        this.prototypeStack = []; // For multi-level navigation
        this.gameOver = false;
        this.gameWon = false;            // terminal game-win latch; prevents the win screen from firing twice

        // Multi-floor state
        this.currentFloor = 1;           // 1-indexed
        this.floorStates = new Map();    // floor# → { entities: [...], map: {...} }
        this.pendingFallenActors = new Map(); // floor# → [serialized actor data]
        this.pendingFallenItems = new Map();  // floor# → [serialized item data] (items that fell through void/collapse)
        this.pendingStairFollowers = new Map(); // floor# → [serialized actor data] (monsters that chased the player through a stairway)
        this.sealedDownFloors = new Set(); // floor#s whose down-stairway is sealed (win conditions unmet) → that floor's N+1 up-stairway must be locked
        this.pendingConditionRelocks = new Set(); // re-locked unlock_conditions actors held open by an occupant; closed once clear
        this.mappedFloors = new Set();   // floor#s revealed by magic mapping; a lasting per-level reveal (layout + machine links) that survives leaving and returning
        this.gameplayStarted = false;    // false during the load sequence; gates sounds/messages so load-time state changes don't leak feedback before the player begins play

        // Configuration
        this.config = {
            containerId: 'game',
            tileWidth: 40,
            tileHeight: 30,
            backgroundColor: 0xf5f5ee,
            ...config
        };
        
        // Canvas dimensions will be set when map loads
        this.canvasWidth = null;
        this.canvasHeight = null;

        // Viewport properties (set in loadPrototype after map loads)
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.viewportEnabled = false;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;
        this.aiMargin = 5;
    }
    
    async initialize() {
        await this.spriteLibrary.load();
        // Data before assets: loadGlobalAssets registers one PIXI texture per entry in
        // the animation manifest, so the manifest has to be in hand first. It used to
        // run second, which was fine only because the animation list was hardcoded.
        await this.loadGlobalData();
        await this.loadGlobalAssets();
        this.setupEventListeners();
        
        console.log('Engine initialized (renderer will be created when map loads)');
    }
    
    async loadGlobalData() {
        try {
            // Load global entity definitions
            const [actorsRes, itemsRes, personalitiesRes, entitiesRes, colorsRes, reagentsRes, substancesRes, statesRes, wordsRes, effectsRes, keybindingsRes, fungiTypesRes, biomesRes, typesRes, attributeInfoRes, animationsRes] = await Promise.all([
                fetch(`${globalVars.BASE_PATH}/data/actors.json`),
                fetch(`${globalVars.BASE_PATH}/data/items.json`),
                fetch(`${globalVars.BASE_PATH}/data/personalities.json`),
                fetch(`${globalVars.BASE_PATH}/data/entities.json`),
                fetch(`${globalVars.BASE_PATH}/data/colors.json`),
                fetch(`${globalVars.BASE_PATH}/data/reagents.json`),
                fetch(`${globalVars.BASE_PATH}/data/substances.json`),
                fetch(`${globalVars.BASE_PATH}/data/states.json`),
                fetch(`${globalVars.BASE_PATH}/data/words.json`),
                fetch(`${globalVars.BASE_PATH}/data/effects.json`),
                fetch(`${globalVars.BASE_PATH}/data/keybindings.json`),
                fetch(`${globalVars.BASE_PATH}/data/fungi_types.json`),
                fetch(`${globalVars.BASE_PATH}/data/biomes.json`),
                fetch(`${globalVars.BASE_PATH}/data/types.json`),
                fetch(`${globalVars.BASE_PATH}/data/attribute-info.json`),
                fetch(`${globalVars.BASE_PATH}/data/animations.json`)
            ]);

            this.globalActors = await actorsRes.json();
            this.globalItems = await itemsRes.json();
            this.globalPersonalities = await personalitiesRes.json();
            this.globalEntities = await entitiesRes.json();
            const colorsData = await colorsRes.json();
            this.globalColors = colorsData.colors || [];

            // Load reagents and sample a random subset to keep in memory
            const fullReagents = await reagentsRes.json();
            this.globalReagents = this.sampleReagents(fullReagents, 100);

            // Load substances
            this.globalSubstances = await substancesRes.json();

            // Load actor states (burning, poisoned, stunned, etc.)
            this.globalStates = await statesRes.json();

            // Every random word list lives in words.json, namespaced by topic
            // (attacks, defenses, adjectives, scrolls). The `[file.category]`
            // description templates name those namespaces, so the slices below
            // keep the template syntax stable now that the files are merged.
            this.globalWords = await wordsRes.json();
            this.globalAdjectives = this.globalWords.adjectives || {};
            this.globalAttacks = this.globalWords.attacks || {};

            // One flat "namespace.category" map over every word list, so templates
            // can name any of them without the engine listing the namespaces it
            // accepts. Built after sampleReagents so it points at the sampled set.
            this.globalWordRegistry = buildWordRegistry({
                words: this.globalWords,
                reagents: this.globalReagents,
                substances: this.globalSubstances
            });

            // Load visual effects definitions
            this.globalEffects = await effectsRes.json();

            // Load keybindings
            this.globalKeybindings = await keybindingsRes.json();

            // Load flavor fungus names (used to randomize scattered fungus appearances)
            this.globalFungiTypes = await fungiTypesRes.json();

            // Default biome library. A prototype's floor_plan names these; a prototype
            // can add or override entries with its own biomes.json (see loadAssets).
            this.globalBiomes = await biomesRes.json();

            // Actor types: named bundles of defaults an actor inherits via its
            // `type` key. A prototype can add or override entries with its own
            // types.json (see loadAssets).
            this.globalTypes = await typesRes.json();

            // Player-facing phrasing for actor attributes, used by the info panel.
            // Only listed attributes are ever described, so engine plumbing stays
            // invisible and a new attribute leaks nothing until someone words it.
            this.globalAttributeInfo = await attributeInfoRes.json();

            // The animated-sprite manifest: name -> { file, speed?, description? }.
            // Adding an animation is a line here plus the PNG; nothing in the engine
            // or the editors enumerates them any more. A prototype can add its own
            // with prototypes/<name>/animations.json (see Prototype.loadAssets).
            this.globalAnimations = await animationsRes.json();

            console.log('Global data loaded:', {
                actors: Object.keys(this.globalActors).length,
                types: Object.keys(this.globalTypes).length,
                items: Object.keys(this.globalItems).length,
                personalities: Object.keys(this.globalPersonalities).length,
                entities: Object.keys(this.globalEntities).length,
                colors: this.globalColors.length,
                wordLists: Object.keys(this.globalWordRegistry).length,
                reagents: Object.keys(this.globalReagents).length,
                substances: this.globalSubstances?.substances?.length || 0,
                states: Object.keys(this.globalStates).length,
                effects: Object.keys(this.globalEffects).length,
                fungiTypes: this.globalFungiTypes?.length || 0
            });
        } catch (error) {
            console.error('Failed to load global data:', error);
            this.globalActors = {};
            this.globalTypes = {};
            this.globalItems = {};
            this.globalPersonalities = {};
            this.globalEntities = {};
            this.globalColors = [];
            this.globalWords = {};
            this.globalAdjectives = {};
            this.globalAttacks = {};
            this.globalWordRegistry = {};
            this.globalReagents = {};
            this.globalSubstances = { substances: [] };
            this.globalStates = {};
            this.globalEffects = {};
            this.globalFungiTypes = [];
            this.globalAttributeInfo = {};
            this.globalAnimations = {};
        }
    }

    /**
     * Sample a random subset from a reagents data object
     * @param {Object} fullData - The full reagents data with category arrays
     * @param {number} sampleSize - Number of items to keep per category
     * @returns {Object} Sampled data with same structure but fewer items
     */
    sampleReagents(fullData, sampleSize) {
        const sampled = {};
        for (const [category, items] of Object.entries(fullData)) {
            if (Array.isArray(items)) {
                // Shuffle and take first sampleSize items
                const shuffled = shuffleArray([...items]);
                sampled[category] = shuffled.slice(0, Math.min(sampleSize, shuffled.length));
            } else {
                sampled[category] = items;
            }
        }
        return sampled;
    }
    
    async initializeRenderer() {
        const container = document.getElementById(this.config.containerId);
        if (!container) {
            throw new Error(`Container element #${this.config.containerId} not found`);
        }

        try {
            this.app = new PIXI.Application({
                width: this.canvasWidth,
                height: this.canvasHeight,
                backgroundColor: this.config.backgroundColor,
                autoDensity: false,
                resolution: 1
            });
            
            this.app.stage.sortableChildren = true;
            this.renderer = new RenderSystem(this.app, this.mapManager.width, this.mapManager.height, this);
            this.interfaceManager = new InterfaceManager(this);
            container.appendChild(this.app.view);
            this.app.view.style.width = `${this.canvasWidth / 2}px`;
            this.app.view.style.height = `${this.canvasHeight / 2}px`;
            
            console.log(`Renderer initialized: ${this.canvasWidth}x${this.canvasHeight}px canvas, scaled to ${this.canvasWidth/2}x${this.canvasHeight/2}px display`);
        } catch (error) {
            console.error('Failed to initialize PIXI renderer:', error);
            throw new Error(`Renderer initialization failed: ${error.message}`);
        }
    }
    
    async loadGlobalAssets() {
        try {
            await Promise.race([
                new Promise((resolve, reject) => {
                    PIXI.Loader.shared.onError.add((error) => {
                        console.error('Asset loading error:', error);
                        reject(error);
                    });
                    
                    PIXI.Loader.shared.add('tiles', globalVars.SPRITESHEET_PATH);
                    this.queueAnimationSheets(this.globalAnimations);
                    PIXI.Loader.shared
                        .load(() => {
                            this.setupAnimationFrames();
                            resolve();
                        });
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Asset loading timeout')), 10000)
                )
            ]);
            
            console.log('Sprites loaded successfully');
        } catch (error) {
            console.error('Failed to load sprite assets:', error);
            throw error;
        }
        

        try {
            const audioData = await fetch(`${globalVars.BASE_PATH}/data/sounds.json`).then(r => r.json());
            this.audioManager = new AudioManager(audioData);
            console.log('Audio loaded successfully');
        } catch (error) {
            console.warn('Failed to load audio effects:', error);
            this.audioManager = null;
        }
        
        console.log('Global assets loaded');
    }
    
    /**
     * Queue one PIXI texture per entry in an animation manifest.
     *
     * `file` is resolved against `basePath` so a prototype can keep its own sprite
     * sheet beside its data instead of dropping it in the shared assets folder, and
     * so the one filename that breaks the `<name>-animation.png` convention (mist ->
     * light-smoke-animation.png) is stated in data rather than encoded in code.
     *
     * Skips anything already queued: the loader throws on a duplicate resource name,
     * and a prototype re-declaring a base animation to change its speed is a normal
     * thing to want. The corollary is that a prototype cannot *replace* a base
     * animation's artwork — same name means the base sheet wins. Use a new name for
     * new art; `speed` is the one property an override can change.
     *
     * @param {Object} manifest - name -> { file, speed?, description? }
     * @param {string} [basePath] - Directory the `file` values are relative to
     */
    queueAnimationSheets(manifest, basePath = `${globalVars.BASE_PATH}/assets/sprites/`) {
        for (const [name, def] of Object.entries(manifest || {})) {
            const file = typeof def === 'string' ? def : def?.file;
            if (!file) {
                console.warn(`Animation '${name}' has no 'file'; skipping.`);
                continue;
            }
            if (PIXI.Loader.shared.resources[name]) continue;
            PIXI.Loader.shared.add(name, `${basePath}${file}`);
        }
    }

    /**
     * Slice every loaded animation sheet into per-frame textures.
     *
     * Frame count is derived from the sheet's width, so a sheet is however many
     * frames wide it is and nothing declares that. Additive rather than a rebuild —
     * a prototype loading its own sheets later must not drop the base set.
     */
    setupAnimationFrames() {
        this.animationFrames ??= {};
        this.animationSpeeds ??= {};

        for (const [name, def] of Object.entries(this.animations || {})) {
            // Speed is re-read every pass, outside the already-sliced guard below: a
            // prototype may re-declare a base animation purely to change its rate, and
            // its textures are the ones already in hand.
            if (typeof def === 'object' && typeof def.speed === 'number') {
                this.animationSpeeds[name] = def.speed;
            } else {
                delete this.animationSpeeds[name];   // back to the default
            }

            if (this.animationFrames[name]) continue;   // already sliced

            const resource = PIXI.Loader.shared.resources[name];
            if (!resource?.texture) {
                console.warn(`Animation '${name}' declared but its sheet failed to load.`);
                continue;
            }

            const baseTexture = resource.texture.baseTexture;
            const frameCount = Math.floor(baseTexture.width / globalVars.TILE_WIDTH);
            const frames = [];
            for (let i = 0; i < frameCount; i++) {
                const rect = new PIXI.Rectangle(
                    i * globalVars.TILE_WIDTH, 0,
                    globalVars.TILE_WIDTH, globalVars.TILE_HEIGHT
                );
                frames.push(new PIXI.Texture(baseTexture, rect));
            }
            this.animationFrames[name] = frames;
        }
    }

    /**
     * The live animation manifest: the base set, plus anything the current prototype
     * adds or overrides. One accessor so the loader, the slicer and the sprite factory
     * can't disagree about which animations exist.
     */
    get animations() {
        return this.currentPrototype?.animations || this.globalAnimations || {};
    }
    
    setupEventListeners() {
        createjs.Ticker.framerate = 60;
        createjs.Ticker.addEventListener("tick", createjs.Tween);
        this.inputManager = new InputManager(this);

        console.log('Event listeners initialized');
    }

    /**
     * Initialize the turn-based engine using ROT.js
     * Uses Simple scheduler - all actors get one turn per round
     */
    initializeTurnEngine() {
        this.scheduler = new ROT.Scheduler.Simple();
        this.turnEngine = new ROT.Engine(this.scheduler);

        this.hasControlledActor = false;

        // Only schedule actors that take turns (have personality or are player-controlled)
        for (const actor of this.entityManager.actors) {
            if (actor.personality || actor.hasAttribute('controlled')) {
                this.scheduler.add(actor, true);
                if (actor.hasAttribute('controlled')) {
                    this.hasControlledActor = true;
                }
            }
        }

        this.turnSpeed = this.currentPrototype?.config.turn_speed ?? 50;
        this.observerPaused = false;
        console.log(`Turn engine initialized with ${this.scheduler._queue._events.len()} scheduled actors`);
        console.log(`Observer mode: ${!this.hasControlledActor}, turn speed: ${this.turnSpeed}ms`);
        this.turnEngine.start();
        if (!this.hasControlledActor) {
            this.advanceObserverTurn();
        }
    }

    /**
     * Advance one turn in observer mode (no player-controlled actors)
     */
    advanceObserverTurn() {
        if (this.observerPaused || this.hasControlledActor) return;
        if (this.turnEngine && this.turnEngine._lock) {
            this.turnEngine.unlock();
        }
        setTimeout(() => this.advanceObserverTurn(), this.turnSpeed);
    }

    /**
     * Toggle play/pause in observer mode
     */
    toggleObserverPause() {
        if (this.hasControlledActor) return;

        this.observerPaused = !this.observerPaused;
        console.log(`Observer mode ${this.observerPaused ? 'paused' : 'playing'}`);

        if (!this.observerPaused) {
            this.advanceObserverTurn();
        }
    }

    /**
     * Called when a controlled actor dies - transition to observer mode
     */
    onControlledActorDied() {
        console.log('Controlled actor died - transitioning to observer mode');
        this.hasControlledActor = false;

        if (this.interfaceManager) {
            this.interfaceManager.hidePlayerInfo();
            // Also drops any pending hover open, whose timer would otherwise fire into
            // a world the player no longer has a stake in.
            this.interfaceManager.closeActorInfo();
        }

        if (this.turnEngine && this.turnEngine._lock) {
            this.turnEngine.unlock();
        }
        const hasActorsWithBehaviors = this.entityManager.actors.some(
            actor => !actor.isDead && actor.personality
        );

        if (hasActorsWithBehaviors) {
            this.observerPaused = false;
            setTimeout(() => this.advanceObserverTurn(), this.turnSpeed);
        } else {
            console.log('No actors with behaviors remaining - game over');
        }
    }

    /**
     * Reload the current prototype or load a different one
     * @param {string} [newPrototypeName] - Optional name of prototype to load (defaults to current)
     */
    async reloadPrototype(newPrototypeName) {
        const prototypeName = newPrototypeName || this.currentPrototype?.name || 'default';
        console.log(`Reloading prototype: ${prototypeName}`);
        this.cleanup();
        await this.loadPrototype(prototypeName);
    }

    updateLighting() {
        if (!this.lightingManager) {
            // A bright level has no lighting pass, and the lighting pass is where actor
            // tints get repainted — so a state tint (impervious, burning, hasted) never
            // reached the sprite here. Paint them directly instead.
            this.renderer.updateEntityStateTints();
            this.renderer.updateProximityTransparency();
            return;
        }

        this.lightingManager.computeLighting();
        const fogOfWar = this._floorMechanics?.fog_of_war || this._runtimeDarknessActive || false;
        this.renderer.updateDarkness(this.lightingManager, fogOfWar);

        // Update the sidebar with visible actors and items
        this.interfaceManager?.updateSidebar();
    }

    /**
     * Coalesced lighting recompute. Multiple callers within the same frame (e.g. a fire
     * trap spawning a burst of fire actors, or an explosion killing several shadow-casters)
     * collapse to a SINGLE updateLighting() on the next animation frame, instead of one
     * expensive shadowcasting pass per spawn/death. The rAF flush lands before the next
     * paint, so the light/shadow change is visible within the same turn — fixing the
     * one-turn lag where a dead actor's shadow lingered or a new fire's light was late.
     * Falls back to a synchronous recompute if requestAnimationFrame is unavailable.
     *
     * Pass the event's (x, y) so an off-screen lighting change on a large scrolling dark
     * level (fire spreading / lava churning many screens away, an out-of-view mob dying)
     * is skipped — computeLighting() does full-map shadowcasting, so recomputing for a
     * change the player can't possibly see is pure waste. When x/y are omitted the update
     * is never gated (used by callers that must always recompute, e.g. viewport changes).
     */
    requestLightingUpdate(x = null, y = null) {
        if (!this.lightingManager) return;
        if (x !== null && !this._lightingEventRelevant(x, y)) return;
        if (this._lightingUpdateQueued) return;
        this._lightingUpdateQueued = true;

        const flush = () => {
            this._lightingUpdateQueued = false;
            if (this.lightingManager) this.updateLighting();
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(flush);
        } else {
            this._lightingUpdateQueued = false;
            this.updateLighting();
        }
    }

    /**
     * A change well outside the current section — beyond a light-bleed
     * margin (max sane light radius) — can't influence any visible tile, so its
     * recompute is skipped. On single-screen levels the whole map is on-screen, so
     * this always returns true.
     */
    _lightingEventRelevant(x, y) {
        if (!this.viewportEnabled) return true;
        const margin = 12; // > largest light radius, so light bleeding into view still counts
        return x >= this.sectionOriginX - margin &&
               x <  this.sectionOriginX + this.viewportWidth + margin &&
               y >= this.sectionOriginY - margin &&
               y <  this.sectionOriginY + this.viewportHeight + margin;
    }

    /**
     * Enable the lighting/FOV system at runtime on a level that doesn't normally have it.
     * Used by vision_cap states (blinded) so the cap shows on bright levels. Ambient
     * light is full: a bright level stays bright, only limited by how far you can see.
     */
    enableRuntimeDarkness() {
        if (this.lightingManager) return;

        this._runtimeDarknessActive = true;

        this.lightingManager = new LightingManager(this);
        this.lightingManager.initialize(
            this.mapManager.width,
            this.mapManager.height,
            { player_auto_light: false, ambient_light: 1.0 }
        );
        this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
        this.updateLighting();
    }

    /**
     * Disable runtime darkness, restoring the level to its original bright state.
     */
    disableRuntimeDarkness() {
        if (!this._runtimeDarknessActive) return; // Wasn't enabled by us

        this._runtimeDarknessActive = false;
        this.lightingManager = null;

        // Remove darkness sprites
        this.renderer.darknessContainer.removeChildren();
        this.renderer.lightColorContainer.removeChildren();
        this.renderer.darknessSprites = [];
        this.renderer.lightColorSprites = [];

        // Restore entity visibility/tinting to defaults
        for (const actor of this.entityManager.actors) {
            const effectiveTint = this.renderer.getEffectiveTint(actor);
            if (actor.spriteBase) {
                actor.spriteBase.tint = effectiveTint ?? 0xFFFFFF;
                actor.spriteBase.visible = true;
            }
            if (actor.spriteTop) {
                actor.spriteTop.tint = effectiveTint ?? 0xFFFFFF;
                actor.spriteTop.visible = true;
            }
            if (actor.spriteSide) {
                actor.spriteSide.tint = effectiveTint ?? 0xFFFFFF;
                actor.spriteSide.visible = true;
            }
        }
        for (const item of this.entityManager.items) {
            if (item.sprite) {
                item.sprite.tint = item.tint ?? 0xFFFFFF;
                item.sprite.visible = item.hasAttribute('visible');
            }
        }
    }

    /**
     * Re-apply full-scene visual state effects (hallucination, confusion) for the
     * player after a floor is (re)built. A floor transition destroys and recreates
     * the RenderSystem, so its effect handles are gone even though the player's
     * states persist through serialize/deserialize. applyState only fires these on
     * first application, so without this the new floor renders normally despite an
     * active state. Mirrors how darkness is re-established on floor load.
     */
    reapplyPersistentVisualEffects() {
        const player = this.entityManager?.player;
        if (!player?.isPlayerControlled?.()) return;
        if (player.hasStateProperty?.('hallucinating')) {
            this.renderer?.applyHallucinationEffect();
        }
        if (player.isConfused()) {
            this.renderer?.applyConfusionEffect();
        }
        // A vision cap on a bright floor needs the runtime FOV system rebuilt
        if (player.findStateWithProperty('vision_cap')) {
            this.enableRuntimeDarkness();
        }
    }

    snapViewportToTile(tileX, tileY) {
        if (!this.viewportEnabled) return false;

        const newCol = Math.floor(tileX / this.viewportWidth);
        const newRow = Math.floor(tileY / this.viewportHeight);

        const maxCol = Math.ceil(this.mapManager.width / this.viewportWidth) - 1;
        const maxRow = Math.ceil(this.mapManager.height / this.viewportHeight) - 1;
        const col = Math.min(newCol, maxCol);
        const row = Math.min(newRow, maxRow);

        if (col === this.sectionCol && row === this.sectionRow) return false;

        this.sectionCol = col;
        this.sectionRow = row;
        this.sectionOriginX = Math.max(0, Math.min(col * this.viewportWidth,
            this.mapManager.width - this.viewportWidth));
        this.sectionOriginY = Math.max(0, Math.min(row * this.viewportHeight,
            this.mapManager.height - this.viewportHeight));
        this.viewportOffsetX = -(this.sectionOriginX * this.config.tileWidth);
        this.viewportOffsetY = -(this.sectionOriginY * this.config.tileHeight);

        return true;
    }

    applyViewportOffset() {
        if (!this.viewportEnabled || !this.renderer) return;
        for (const c of [
            this.renderer.backgroundContainer, this.renderer.floorContainer,
            this.renderer.entityContainer, this.renderer.overlayContainer,
            this.renderer.lightColorContainer,
            this.renderer.darknessContainer, this.renderer.uiContainer
        ]) {
            c.x = this.viewportOffsetX;
            c.y = this.viewportOffsetY;
        }
    }

    onSectionChange() {
        this.applyViewportOffset();
        this.renderer.updateTileVisibility(
            this.sectionOriginX, this.sectionOriginY,
            this.viewportWidth, this.viewportHeight
        );
        this.renderer.updateEntityVisibility(
            this.sectionOriginX, this.sectionOriginY,
            this.viewportWidth, this.viewportHeight
        );
        if (this.lightingManager) this.updateLighting();
        this.renderer.updateSubmersionOverlay();
    }

    playSound(soundName, options) {
        if (!this.gameplayStarted) return;
        if (this.audioManager) {
            return this.audioManager.play(soundName, options);
        }
    }
    playSoundVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance) {
        if (this.audioManager) {
            this.audioManager.playVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance);
        }
    }
    stopSound(soundId) {
        if (this.audioManager?.sound) {
            this.audioManager.sound.stop(soundId);
        }
    }
    muteAudio() {
        if (this.audioManager) {
            this.audioManager.mute();
        }
    }
    unmuteAudio() {
        if (this.audioManager) {
            this.audioManager.unmute();
        }
    }
    setAudioVolume(volume) {
        if (this.audioManager) {
            this.audioManager.setVolume(volume);
        }
    }
    listAvailableSounds() {
        if (this.audioManager) {
            return this.audioManager.listSounds();
        }
        return [];
    }
}

installMethods(DungeonEngine, DungeonEngineFloors, DungeonEngineProgression, DungeonEngineStairways, DungeonEnginePersistence);

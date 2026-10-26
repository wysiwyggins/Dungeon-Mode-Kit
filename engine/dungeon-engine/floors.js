/**
 * DungeonEngine methods: loading prototypes and floors, cutscenes, restoring
 * visited floors, floor config, biomes and spawn budgets, down-seals.
 */

import { Architect } from '../../architect/architect.js';
import { Actor } from '../actor/actor.js';
import { EntityManager } from '../entity-manager/entity-manager.js';
import { Prototype } from '../prototype.js';
import { BASE_PATH } from '../../core/util.js';
import { LightingManager } from '../../lighting.js';

export const DungeonEngineFloors = {
    async loadPrototype(prototypeName, entryDirection = null, fromCutscene = false) {
        console.log(`Loading prototype: ${prototypeName}, entry: ${entryDirection || 'direct'}`);
        let prototypeConfig = await this.loadPrototypeConfig(prototypeName);
        if (!prototypeConfig) {
            prototypeName = 'default';
            prototypeConfig = await this.loadPrototypeConfig('default');
        }

        // Intro hook: a gameplay prototype can name an intro cutscene that plays first.
        // The `fromCutscene` guard suppresses this on the cutscene's own exit transition,
        // so we don't loop back into the cutscene when it chains to its next_level.
        if (!fromCutscene && prototypeConfig.intro_cutscene) {
            console.log(`Playing intro cutscene "${prototypeConfig.intro_cutscene}" before ${prototypeName}`);
            return this.transitionToPrototype(prototypeConfig.intro_cutscene, false, entryDirection);
        }

        this.currentPrototype = new Prototype(prototypeName, prototypeConfig, this);
        await this.currentPrototype.loadAssets();
        this.currentFloor = 1;
        this.floorStates.clear();
        this.pendingFallenActors.clear();
        this.pendingFallenItems.clear();
        this.pendingStairFollowers.clear();
        this.sealedDownFloors.clear();
        this.mappedFloors.clear();

        // Cutscene prototype: play the .tmj flipbook instead of the normal gameplay load.
        if (prototypeConfig.cutscene?.flipbook) {
            return this.playCutscene();
        }

        await this.loadFloor(this.currentFloor, entryDirection);
    },

    /**
     * Build the Architect context object used for wildcard processing and entity spawning
     * @returns {Object} Context with engine resource accessors
     */
    buildArchitectContext() {
        return {
            getActorData: (type) => this.currentPrototype?.getActorData(type),
            getTileIdByName: (name) => this.spriteLibrary?.getTileIdByName(name),
            getPrototypeActors: () => this.currentPrototype?.actors,
            getMapGeneratorConfig: () => {
                const floorConfig = this.getFloorConfig(this.currentFloor);
                return floorConfig?.map_generator?.options || this.currentPrototype?.config?.map_generator?.options || {};
            },
            getActorAt: (x, y) => this.entityManager?.getActorAt(x, y),
            createActor: (x, y, type, actorData) => {
                const actor = new Actor(x, y, type, actorData, this);
                this.entityManager.addEntity(actor);
                actor.loadDefaultItems();
                return actor;
            }
        };
    },

    /**
     * Load a fresh floor within the current prototype
     * @param {number} floor - 1-indexed floor number
     * @param {string|null} entryDirection - 'from_above', 'from_below', or null
     * @param {Object|null} playerState - Serialized player state to restore (null on first load)
     */
    async loadFloor(floor, entryDirection, playerState = null) {
        // Silence feedback until the player begins play
        this.gameplayStarted = false;

        // Passive-search memory is keyed by bare coordinates, so it has to go when
        // the coordinates start meaning somewhere else — otherwise a new floor
        // arrives pre-searched wherever the last one had been walked.
        this.inputManager?.searchedTiles?.clear();
        this.inputManager?.stopSearch?.();
        const prototypeConfig = this.currentPrototype.config;
        const floorConfig = this.getFloorConfig(floor);

        // Determine map generator config: floor-specific overrides prototype-level
        const mapGenerator = floorConfig.map_generator ?? prototypeConfig.map_generator;

        this.mapManager = new Architect({ config: this.buildArchitectConfig(floorConfig) });
        const hasAuthoredMap = await this.checkForAuthoredMap(this.currentPrototype.name, floor);
        if (hasAuthoredMap) {
            const mapFile = floor === 1 ? 'map.tmj' : `${floor}.tmj`;
            await this.mapManager.loadTiledMap(`${BASE_PATH}/prototypes/${this.currentPrototype.name}/${mapFile}`);
        } else {
            this.mapManager.generateProceduralMap(mapGenerator);
        }

        // Viewport: per-prototype viewport_width/height in tile columns/rows
        const mechanics = floorConfig.mechanics || prototypeConfig.mechanics || {};
        const vpW = mechanics.viewport_width || null;
        const vpH = mechanics.viewport_height || null;

        if (vpW && vpH && (vpW < this.mapManager.width || vpH < this.mapManager.height)) {
            this.viewportWidth = vpW;
            this.viewportHeight = vpH;
            this.viewportEnabled = true;
            this.aiMargin = mechanics.ai_margin ?? 5;
        } else {
            this.viewportWidth = this.mapManager.width;
            this.viewportHeight = this.mapManager.height;
            this.viewportEnabled = false;
            this.aiMargin = Infinity;
        }

        this.canvasWidth = this.viewportWidth * this.config.tileWidth;
        this.canvasHeight = this.viewportHeight * this.config.tileHeight;

        await this.initializeRenderer();

        this.entityManager = new EntityManager(this);

        await this.entityManager.spawnEntities(entryDirection);

        const architectContext = this.buildArchitectContext();

        await this.mapManager.processWildcards(architectContext);

        // Join wildcard regions to the authored floor around them (and to each
        // other). Generators can't see past their own region, so without this a
        // region beside authored floor only connects by luck.
        if (hasAuthoredMap && mechanics.connect_regions !== false) {
            this.mapManager.connectRegions({
                doorChance: mechanics.connect_door_chance ?? 50,
                isBlockedByActor: (x, y) => this.entityManager.getActorsAt(x, y).some(a =>
                    !a.isDead && a.hasAttribute('solid') &&
                    !a.hasAttribute('openable') && !a.hasAttribute('pushable'))
            });
        }

        // Check for treasure room before pending doors are spawned
        const treasureRoomChance = mechanics.treasure_room ?? 0;
        let treasureRoomData = null;
        if (treasureRoomChance > 0 && ROT.RNG.getPercentage() <= treasureRoomChance) {
            treasureRoomData = this.mapManager.spawnTreasureRoom();
        }

        // Spawn switch puzzles (levers + gates, pressure plates, etc.)
        if (floorConfig.switch_puzzles) {
            this.mapManager.spawnSwitchPuzzles(floorConfig.switch_puzzles, architectContext);
        }

        this.mapManager.spawnPendingWalls(architectContext);
        this.mapManager.spawnPendingDoors(architectContext);
        this.mapManager.spawnPendingTorches(architectContext);
        this.mapManager.spawnPendingBraziers(architectContext);
        this.mapManager.spawnPendingLiquids(architectContext);
        this.mapManager.spawnPendingPushableWalls(architectContext);
        // After the plain walls, so a late wall can never land on top of a secret.
        // Both generators keep the tiles clear of pendingWallSpawns already; the
        // ordering is belt and braces.
        this.mapManager.spawnPendingSecretDoors(architectContext);
        this.mapManager.spawnPendingHiddenLevers(architectContext);
        this.mapManager.spawnPendingBridges(architectContext);
        this.mapManager.spawnPendingCollapsingFloors(architectContext);

        if (treasureRoomData) {
            this.entityManager.spawnTreasureRoomContents(treasureRoomData, architectContext);
        }

        // Pair keys to their color-locked doors now that all doors and keys exist, so an
        // authored key spawned before its door (order-dependent eager coloring) still matches.
        this.entityManager.reconcileKeyDoorColors();

        // Stairway/portal placement — after pending doors so getActorAt sees them
        if (!prototypeConfig.mechanics?.observer_mode) {
            const totalFloors = this.getTotalFloors();
            const multiFloor = totalFloors > 1;

            this.ensureUpStairway();

            if (multiFloor && floor < totalFloors) {
                this.ensureDownStairway();
            }

            // The last floor has no down-stairway; a prototype that continues
            // elsewhere gets a portal there instead.
            if (multiFloor && floor === totalFloors && prototypeConfig.next_level) {
                this.ensurePortal();
            }

            // Spawn or restore player
            if (playerState) {
                this.restorePlayerOnFloor(playerState, entryDirection);
            } else {
                this.spawnPlayerAtStairway(entryDirection);
            }
        }

        // Snap viewport to the viewpoint's spawn position before rendering
        const spawnViewpoint = this.entityManager.getPrimaryViewpoint();
        if (this.viewportEnabled && spawnViewpoint) {
            this.snapViewportToTile(spawnViewpoint.x, spawnViewpoint.y);
        }

        // Spawn random actors/items using floor-specific config
        this.entityManager.spawnRandomActorsFromConfig(floorConfig);

        // A pov actor (e.g. an observer-prototype hero) is spawned via
        // random_actors above, so the viewpoint may only exist now. Re-snap so
        // the camera starts centered on it.
        if (this.viewportEnabled && !spawnViewpoint) {
            const vp = this.entityManager.getPrimaryViewpoint();
            if (vp) this.snapViewportToTile(vp.x, vp.y);
        }

        // Scatter the biome's floor decorations. Runs after every actor is placed to consider walls and fluids
        this.entityManager.placeBiomeDecorations(floorConfig);

        // Spawn body segment chains for any chain_head actors
        this.entityManager.spawnChainCreatures();

        // Run cellular automata behaviors once to pre-calculate initial state
        this.entityManager.runCellularAutomataStep();

        this.mapManager.addBaseAndShadows();

        this.entityManager.initializeSwitchTints();
        this.renderer.renderTestPattern(this.mapManager);
        this.renderer.renderItems(this.entityManager);
        this.renderer.renderActors(this.entityManager);
        this.entityManager.initializeInventoryDisplays();

        // Lock/unlock this floor's up-stairway to match the floor below's seal state.
        this.reconcileUpStairwayLock();

        // Update sidebar and proximity transparency for non-darkness levels
        // (darkness levels update both via updateLighting)
        if (!mechanics.darkness) {
            this.interfaceManager?.updateSidebar();
            this.renderer.updateProximityTransparency();
        }

        // Check initial submersion state for all actors (after sprites exist)
        for (const actor of this.entityManager.actors) {
            actor.updateSubmersionState();
        }

        // Store resolved floor mechanics for use in updateLighting()
        this._floorMechanics = mechanics;

        if (mechanics.darkness) {
            this.lightingManager = new LightingManager(this);
            this.lightingManager.initialize(
                this.mapManager.width,
                this.mapManager.height,
                mechanics
            );
            this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
            this.updateLighting();
        }

        // Re-establish active full-scene state effects on the fresh renderer.
        this.reapplyPersistentVisualEffects();

        // Apply viewport offset and visibility after all rendering/darkness is set up
        if (this.viewportEnabled) {
            this.applyViewportOffset();
            this.renderer.updateTileVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
            this.renderer.updateEntityVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
        }

        this.spawnPendingFallenActors();
        this.spawnPendingFallenItems();

        this.spawnPendingStairFollowers();

        const startGameplay = () => {
            // Play has begun — feedback (sounds/messages) is allowed from here on,
            // including this function's own loaded_sound and floor banner below.
            this.gameplayStarted = true;
            this.refreshConditionLocks();
            this.initializeTurnEngine();

            if (prototypeConfig.loaded_sound) {
                this.playSound(prototypeConfig.loaded_sound);
            }

            if (this.inputManager) {
                this.inputManager.enable();
                if (floor === 1 && prototypeConfig.description) {
                    this.inputManager.clearMessageStack();
                    this.inputManager.showMessage(prototypeConfig.description);
                } else if (floor > 1) {
                    this.inputManager.clearMessageStack();
                    this.inputManager.showMessage(`Floor ${floor}`);
                }
            }

            this.updateInfoDisplay();
        };

        console.log(`Floor ${floor} loaded successfully`);
        console.log(`Map size: ${this.mapManager.width}x${this.mapManager.height} tiles`);
        if (this.viewportEnabled) {
            console.log(`Viewport: ${this.viewportWidth}x${this.viewportHeight} tiles, section (${this.sectionCol},${this.sectionRow}), origin (${this.sectionOriginX},${this.sectionOriginY})`);
        }
        console.log(`Canvas size: ${this.canvasWidth}x${this.canvasHeight}px`);
        console.log(`Walkable tiles: ${this.mapManager.walkableTiles.length}`);
        console.log(`Actors spawned: ${this.entityManager.actors.length}`);
        console.log(`Items spawned: ${this.entityManager.items.length}`);

        const shouldShowSplash = (floor === 1 && !playerState);

        if (shouldShowSplash) {
            if (this.inputManager) this.inputManager.disable();

            const player = this.entityManager.player;
            let originX, originY;
            if (player) {
                originX = this.viewportEnabled ? player.x - this.sectionOriginX : player.x;
                originY = this.viewportEnabled ? player.y - this.sectionOriginY : player.y;
            } else {
                originX = Math.floor(this.viewportWidth / 2);
                originY = Math.floor(this.viewportHeight / 2);
            }

            this.renderer.showSplash(this.viewportWidth, this.viewportHeight, originX, originY);

            const canvas = this.app.view;
            const dismiss = () => {
                canvas.removeEventListener('click', dismiss);
                canvas.removeEventListener('touchend', onTouch);
                document.removeEventListener('keydown', dismiss);
                this.renderer.dismissSplash(startGameplay);
            };
            const onTouch = (e) => {
                e.preventDefault();
                dismiss();
            };
            canvas.addEventListener('click', dismiss);
            canvas.addEventListener('touchend', onTouch);
            document.addEventListener('keydown', dismiss);
        } else {
            startGameplay();
        }
    },

    /**
     * Play the current prototype's cutscene: a flipbook built from a single .tmj whose numbered
     * tilelayers (any layer named `*-<N>`) are the frames, shown one per `turn_speed` ms over any
     * un-numbered tilelayers as a static backdrop. Any keypress/click/touch skips to next_level.
     * Assumes currentPrototype is built and loadAssets() has run.
     *
     * The whole .tmj loads once; advancing a frame just toggles container visibility — no
     * per-frame teardown. Deliberately omits the gameplay pipeline: no turn engine, no AI, no
     * wildcard/random/pending spawns, no input enable, gameplayStarted stays false.
     */
    async playCutscene() {
        const config = this.currentPrototype.config;
        const flipbook = config.cutscene?.flipbook;
        const nextLevel = config.next_level;
        const frameMs = config.turn_speed ?? 50;

        if (!flipbook) {
            console.warn('Cutscene has no flipbook file; falling back to normal load');
            return this.loadFloor(this.currentFloor, null);
        }

        // Fetch and parse the .tmj once. We keep an Architect instance only for its parseTileGID
        // (the Tiled flip-flag parser); we do NOT run the normal map-collapse pipeline.
        this.mapManager = new Architect();
        const mapPath = `${BASE_PATH}/prototypes/${this.currentPrototype.name}/${flipbook}`;
        console.log(`Loading cutscene flipbook: ${mapPath}`);
        const tiledData = await (await fetch(mapPath)).json();

        // Frame layers: any tilelayer named `*-<N>`, sorted by the trailing number.
        // Backdrop: any other tilelayer (e.g. `background`/`floor`), drawn once beneath frames.
        const frameLayers = [];
        const backdropLayers = [];
        const frameNum = (name) => {
            const m = /-(\d+)$/.exec(name || '');
            return m ? parseInt(m[1], 10) : null;
        };
        for (const layer of tiledData.layers) {
            if (layer.type !== 'tilelayer') continue;
            if (frameNum(layer.name) !== null) frameLayers.push(layer);
            else backdropLayers.push(layer);
        }
        frameLayers.sort((a, b) => frameNum(a.name) - frameNum(b.name));

        if (!frameLayers.length) {
            console.warn(`Cutscene ${flipbook} has no *-N frame layers; falling back to normal load`);
            return this.loadFloor(this.currentFloor, null);
        }

        this.gameplayStarted = false;

        // Full-map, no scrolling.
        this.viewportWidth = tiledData.width;
        this.viewportHeight = tiledData.height;
        this.viewportEnabled = false;
        this.aiMargin = Infinity;
        this.mapManager.width = tiledData.width;
        this.mapManager.height = tiledData.height;
        this.canvasWidth = this.viewportWidth * this.config.tileWidth;
        this.canvasHeight = this.viewportHeight * this.config.tileHeight;

        await this.initializeRenderer();
        const frameContainers = this.renderer.renderCutsceneFrames(frameLayers, backdropLayers);

        let frameTimer = null;
        let finished = false;
        const canvas = this.app.view;

        // Single idempotent exit (end-of-frames and skip share it). The `finished` flag makes the
        // first caller win, so a skip racing the pending advance() timer can't double-transition.
        const finish = () => {
            if (finished) return;
            finished = true;
            if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
            document.removeEventListener('keydown', skip);
            canvas.removeEventListener('click', skip);
            canvas.removeEventListener('touchend', onTouch);
            // saveState=false: don't push the cutscene onto the prototype stack.
            // fromCutscene=true: suppress the intro hook so we don't loop back here.
            this.transitionToPrototype(nextLevel, false, null, true);
        };
        const skip = () => finish();
        const onTouch = (e) => { e.preventDefault(); finish(); };

        const showFrame = (i) => {
            frameContainers.forEach((c, idx) => { c.visible = idx === i; });
            const isLast = i === frameContainers.length - 1;
            frameTimer = setTimeout(() => {
                if (isLast) {
                    // Play-once: chain to next_level. If none, hold on the last frame until input.
                    if (nextLevel) finish();
                } else {
                    showFrame(i + 1);
                }
            }, frameMs);
        };

        document.addEventListener('keydown', skip);
        canvas.addEventListener('click', skip);
        canvas.addEventListener('touchend', onTouch);
        showFrame(0);
    },

    /**
     * Restore a previously visited floor from saved state
     * @param {number} floor - 1-indexed floor number
     * @param {Object} playerState - Serialized player state
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    async restoreFloor(floor, playerState, entryDirection) {
        // Silence feedback until the player begins play (see loadFloor).
        this.gameplayStarted = false;
        const prototypeConfig = this.currentPrototype.config;
        const saved = this.floorStates.get(floor);

        // Restore RNG state if available
        if (saved.rngState && typeof ROT !== 'undefined') {
            ROT.RNG.setState(saved.rngState);
        }

        // Same config as loadFloor: holes and digging on a revisited floor still
        // need the prototype's void tile.
        const floorConfig = this.getFloorConfig(floor);
        this.mapManager = new Architect({ config: this.buildArchitectConfig(floorConfig) });
        this.mapManager.deserializeMap(saved.map);

        // Viewport setup — use floor-specific mechanics (includes ambient_light, etc.)
        const mechanics = floorConfig.mechanics || prototypeConfig.mechanics || {};
        const vpW = mechanics.viewport_width || null;
        const vpH = mechanics.viewport_height || null;

        if (vpW && vpH && (vpW < this.mapManager.width || vpH < this.mapManager.height)) {
            this.viewportWidth = vpW;
            this.viewportHeight = vpH;
            this.viewportEnabled = true;
            this.aiMargin = mechanics.ai_margin ?? 5;
        } else {
            this.viewportWidth = this.mapManager.width;
            this.viewportHeight = this.mapManager.height;
            this.viewportEnabled = false;
            this.aiMargin = Infinity;
        }

        this.canvasWidth = this.viewportWidth * this.config.tileWidth;
        this.canvasHeight = this.viewportHeight * this.config.tileHeight;

        await this.initializeRenderer();

        this.entityManager = new EntityManager(this);

        // Restore saved entities (non-player)
        this.entityManager.deserializeEntities(saved.entities);

        // Restore player
        this.restorePlayerOnFloor(playerState, entryDirection);

        this.mapManager.addBaseAndShadows();

        this.entityManager.initializeSwitchTints();
        this.renderer.renderTestPattern(this.mapManager);
        this.renderer.renderItems(this.entityManager);
        this.renderer.renderActors(this.entityManager);
        this.entityManager.initializeInventoryDisplays();

        // Lock/unlock this floor's up-stairway to match the floor below's seal state.
        // Corrects a cached floor whose paired seal changed while the player was away.
        this.reconcileUpStairwayLock();

        // Snap viewport to the viewpoint actor
        const vp = this.entityManager.getPrimaryViewpoint();
        if (this.viewportEnabled && vp) {
            this.snapViewportToTile(vp.x, vp.y);
        }

        if (!mechanics.darkness) {
            this.interfaceManager?.updateSidebar();
        }

        for (const actor of this.entityManager.actors) {
            actor.updateSubmersionState();
        }

        if (mechanics.darkness) {
            this.lightingManager = new LightingManager(this);
            this.lightingManager.initialize(
                this.mapManager.width,
                this.mapManager.height,
                mechanics
            );
            // Restore what the player had already seen here. initialize() just zeroed
            // exploredMap, so this must land before the first computeLighting, or the
            // floor renders fully fogged and the memory is lost.
            if (saved.explored) {
                this.lightingManager.restoreExplored(saved.explored);
            }
            this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
        }

        // Always refresh, dark or bright: a magic-mapped floor needs its machine-link
        // overlay rebuilt on return. With no LightingManager (bright floor) this falls
        // through to updateProximityTransparency(), the funnel that drives the overlay.
        this.updateLighting();

        // Re-establish active full-scene state effects on the fresh renderer.
        this.reapplyPersistentVisualEffects();

        if (this.viewportEnabled) {
            this.applyViewportOffset();
            this.renderer.updateTileVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
            this.renderer.updateEntityVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
        }

        this.spawnPendingFallenActors();
        this.spawnPendingFallenItems();

        this.spawnPendingStairFollowers();

        // Restoring a cached floor has no splash/click step — play resumes immediately,
        // so allow feedback before showing the floor banner below.
        this.gameplayStarted = true;
        this.refreshConditionLocks();

        this.initializeTurnEngine();

        this.inputManager?.clearMessageStack();
        this.inputManager?.showMessage(`Floor ${floor}`);

        this.updateInfoDisplay();
        console.log(`Floor ${floor} restored from saved state`);
    },

    /**
     * Update the info display with the current prototype name and floor
     */
    updateInfoDisplay() {
        const nameEl = document.getElementById('info-name');
        const floorEl = document.getElementById('info-floor');
        if (!nameEl) return;
        nameEl.textContent = this.currentPrototype?.config?.name || '';
        if (floorEl) {
            const totalFloors = this.getTotalFloors();
            floorEl.textContent = totalFloors > 1 ? `Floor ${this.currentFloor}` : '';
        }
    },

    /**
     * Restore the player on a floor at the appropriate stairway position
     * @param {Object} playerState - Serialized player data
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    restorePlayerOnFloor(playerState, entryDirection) {
        const playerData = this.currentPrototype.getActorData('player');
        if (!playerData) {
            console.error('No player actor data found in prototype');
            return;
        }

        // Remove map-spawned player if one exists (we're restoring from saved state)
        if (this.entityManager.player) {
            this.entityManager.removeEntity(this.entityManager.player);
        }

        let spawnX, spawnY;

        if (entryDirection === 'from_fall') {
            const walkableTiles = this.mapManager.walkableTiles;
            const available = walkableTiles.filter(t => !this.entityManager.getActorAt(t.x, t.y));
            const tile = available.length > 0
                ? available[Math.floor(ROT.RNG.getUniform() * available.length)]
                : walkableTiles[0];
            spawnX = tile?.x ?? 1;
            spawnY = tile?.y ?? 1;
        } else {
            let targetStairwayType;
            if (entryDirection === 'from_above') {
                targetStairwayType = 'up';
            } else if (entryDirection === 'from_below') {
                targetStairwayType = 'down';
            } else {
                targetStairwayType = 'up';
            }
            const stairway = this.entityManager.findActorByAttribute('stairway', targetStairwayType);
            spawnX = stairway ? stairway.x : (this.mapManager.walkableTiles[0]?.x ?? 1);
            spawnY = stairway ? stairway.y : (this.mapManager.walkableTiles[0]?.y ?? 1);
        }

        const player = new Actor(spawnX, spawnY, 'player', playerData, this);
        player.deserialize(playerState);
        player.x = spawnX;
        player.y = spawnY;
        this.entityManager.addEntity(player);
    },
    
    /**
     * Architect config for one floor: the floor look, the prototype's void tile,
     * and actor-definition lookup so generation can read attributes like `hazard`.
     *
     * `default_floor` takes the usual floor-over-prototype precedence. It only
     * reaches generated maps: an authored .tmj names a tile for every cell
     * deliberately, so there is no "default" left to fill in.
     *
     * @param {Object} floorConfig - Merged config for this floor (getFloorConfig)
     * @returns {Object} Config for `new Architect({ config })`
     */
    buildArchitectConfig(floorConfig) {
        const prototypeConfig = this.currentPrototype.config;
        const config = {
            ...this.buildFloorConfigOverrides(floorConfig.default_floor ?? prototypeConfig.default_floor),
            getActorData: (type) => this.currentPrototype.getActorData(type),
        };

        if (prototypeConfig.void_tile) {
            const tileId = this.spriteLibrary?.getTileIdByName(prototypeConfig.void_tile);
            if (tileId) {
                config.voidTileId = tileId;
            } else {
                console.warn(`void_tile: unknown tile name "${prototypeConfig.void_tile}" — using the built-in void tile`);
            }
        }

        return config;
    },

    /**
     * Turn a prototype's `default_floor` block into Architect config overrides.
     *
     * `tile` is authored as a NAME, like every other tile reference in the data
     * files, and getTileIdByName produces exactly the 1-indexed Tiled id the
     * generators write. An unresolvable name warns and falls through to the
     * built-in default rather than painting the map with a broken tile.
     *
     * @param {Object} [defaultFloor] - { tile?: string, tint?: string }
     * @returns {Object} Overrides for the Architect config (empty when unset)
     */
    buildFloorConfigOverrides(defaultFloor) {
        if (!defaultFloor) return {};
        const overrides = {};

        if (defaultFloor.tile) {
            const tileId = this.spriteLibrary?.getTileIdByName(defaultFloor.tile);
            if (tileId) {
                overrides.defaultFloorTileId = tileId;
            } else {
                console.warn(`default_floor: unknown tile name "${defaultFloor.tile}" — using the built-in floor tile`);
            }
        }

        if (defaultFloor.tint) overrides.defaultFloorTint = defaultFloor.tint;

        return overrides;
    },

    async loadPrototypeConfig(prototypeName) {
        try {
            const response = await fetch(`${BASE_PATH}/prototypes/${prototypeName}/prototype.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn(`Prototype "${prototypeName}" not found, falling back to default`);
            if (prototypeName !== 'default') {
                return null;
            }
            return this.getDefaultPrototypeConfig();
        }
    },

    async checkForAuthoredMap(prototypeName, floor = 1) {
        const mapFile = floor === 1 ? 'map.tmj' : `${floor}.tmj`;
        try {
            const response = await fetch(`${BASE_PATH}/prototypes/${prototypeName}/${mapFile}`, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    },

    /**
     * Get the config for a specific floor, merging floor overrides with prototype defaults
     * @param {number} floor - 1-indexed floor number
     * @returns {Object} Merged floor configuration
     */
    getFloorConfig(floor) {
        const config = this.currentPrototype.config;
        // Legacy: a flat prototype — no per-floor overrides and no floor plan — IS
        // its own floor config. (Note the test is floor_plan, not biomes: the biome
        // library is always loaded, so `biomes` alone doesn't mean multi-floor.)
        if (!config.levels && !config.floor_plan) return config;
        const floorOverride = this._getFloorOverride(config, floor);
        // Biome tier: sits between the floor override and the prototype defaults.
        // Empty ({}) when the prototype has no biome for this floor, so biome-less
        // prototypes resolve exactly as before.
        const biome = this.resolveBiome(floor);
        // win_conditions and switch_puzzles have no biome tier on purpose: a biome
        // spans many floors, while both of those are per-floor (a stairway gate, a
        // specific puzzle placement). resolveBiome never emits them, so reading
        // biome.<key> here would always be undefined.
        return {
            win_conditions: floorOverride.win_conditions ?? config.win_conditions ?? [],
            random_actors: floorOverride.random_actors ?? biome.random_actors ?? config.random_actors ?? {},
            random_items: floorOverride.random_items ?? biome.random_items ?? config.random_items ?? {},
            traps: floorOverride.traps ?? biome.traps ?? config.traps ?? null,
            fungus: floorOverride.fungus ?? biome.fungus ?? config.fungus ?? null,
            // Replaces wholesale, like every key but mechanics — a floor override
            // restates the whole list.
            decorations: floorOverride.decorations ?? biome.decorations ?? config.decorations ?? null,
            map_generator: floorOverride.map_generator ?? biome.map_generator ?? config.map_generator,
            default_floor: floorOverride.default_floor ?? biome.default_floor ?? config.default_floor ?? null,
            mechanics: { ...(config.mechanics || {}), ...(biome.mechanics || {}), ...(floorOverride.mechanics || {}) },
            switch_puzzles: floorOverride.switch_puzzles ?? config.switch_puzzles ?? null,
            item_budget: floorOverride.item_budget ?? biome.item_budget ?? config.item_budget ?? null,
        };
    },

    // Total floor count. Prefers an explicit `floors` (used with biomes/sparse
    // levels), falls back to a dense levels array length, else 1 (flat prototype).
    getTotalFloors() {
        const config = this.currentPrototype?.config;
        if (!config) return 1;
        if (config.floors != null) return config.floors;
        if (Array.isArray(config.levels)) return config.levels.length;
        return 1;
    },

    // A floor's explicit override. Supports both the legacy dense array
    // (levels[floor-1]) and a sparse map keyed by floor number (levels["6"]).
    _getFloorOverride(config, floor) {
        const levels = config.levels;
        if (!levels) return {};
        if (Array.isArray(levels)) return levels[floor - 1] || {};
        return levels[String(floor)] || levels[floor] || {};
    },

    /**
     * Resolve the biome covering `floor` into the standard floor-config shape
     * (random_actors / random_items / traps / fungus / map_generator / mechanics
     * / item_budget). Returns {} when the prototype has no biome for this floor,
     * so a prototype without biomes behaves exactly as before.
     *
     * Depth = the absolute 1-based floor index. See docs/BIOMES.md.
     */
    resolveBiome(floor) {
        const config = this.currentPrototype?.config;
        const plan = config?.floor_plan;
        const biomes = config?.biomes;
        if (!Array.isArray(plan) || !biomes) return {};

        // Find the floor_plan entry whose (inclusive, 1-based) range contains floor.
        const entry = plan.find(p => this._floorInRange(floor, p.floors));
        const biome = entry && biomes[entry.biome];
        if (!biome) return {};

        const out = {};
        if (biome.actors) out.random_actors = this._rollBiomeSpawns(biome.actors, biome.actor_budget, floor);
        if (biome.items) out.random_items = this._rollBiomeSpawns(biome.items, biome.item_budget, floor, 'type');
        if (biome.item_budget) out.item_budget = biome.item_budget;
        if (biome.traps) out.traps = this._rampRange(biome.traps, floor);
        if (biome.fungus) {
            const r = this._rampRange(biome.fungus, floor);
            // `cluster` passes through as-is; spawnRandomFungus treats undefined as
            // clustered, so only an explicit false turns clustering off.
            if (r) out.fungus = { ...r, tall_chance: biome.fungus.tall_chance, cluster: biome.fungus.cluster };
        }
        // Decorations pass through as authored: no depth ramp and no budget raffle,
        // since each row carries its own freq and min/max count.
        if (Array.isArray(biome.decorations) && biome.decorations.length) {
            out.decorations = biome.decorations;
        }
        if (biome.map_generator) out.map_generator = biome.map_generator;
        // A biome could already pick its wall actors (wall_types rides along inside
        // map_generator); this lets it pick the floor they stand on to match.
        if (biome.default_floor) out.default_floor = biome.default_floor;
        if (biome.mechanics) out.mechanics = biome.mechanics;
        return out;
    },

    /**
     * Every actor id that can randomly spawn on any floor in `range` ("current",
     * "3-6", 5 or [3,6]): biome catalog rows eligible at that depth plus the keys of
     * each floor's random_actors. Unlike getFloorConfig this skips the budget raffle,
     * so it's the full candidate list, not one roll of it.
     */
    getFloorActorPool(range = 'current') {
        const config = this.currentPrototype?.config || {};
        let lo, hi;
        if (range === 'current') lo = hi = this.currentFloor;
        else if (Array.isArray(range)) [lo, hi] = range;
        else if (typeof range === 'number') lo = hi = range;
        else {
            [lo, hi] = String(range).split('-').map(s => parseInt(s.trim(), 10));
            hi = hi ?? lo;
        }
        hi = Math.min(hi, this.getTotalFloors());
        const ids = new Set();
        const biomes = config.biomes || {};
        const plan = Array.isArray(config.floor_plan) ? config.floor_plan : [];
        for (let floor = lo; floor <= hi; floor++) {
            const override = this._getFloorOverride(config, floor);
            const entry = plan.find(p => this._floorInRange(floor, p.floors));
            const biome = entry && biomes[entry.biome];
            // Same precedence as getFloorConfig: a floor override's random_actors
            // replaces the biome's, which replaces the prototype default.
            if (override.random_actors) Object.keys(override.random_actors).forEach(id => ids.add(id));
            else if (biome?.actors) {
                biome.actors.filter(r => floor >= (r.min ?? 1) && floor <= (r.max ?? Infinity))
                    .forEach(r => ids.add(r.id));
            } else Object.keys(config.random_actors || {}).forEach(id => ids.add(id));
        }
        return ids;
    },

    // Is 1-based `floor` inside a floor_plan range? Accepts "1-8", "5", or [1,8].
    _floorInRange(floor, range) {
        if (Array.isArray(range)) return floor >= range[0] && floor <= range[1];
        if (typeof range === 'number') return floor === range;
        if (typeof range === 'string') {
            const [lo, hi] = range.split('-').map(s => parseInt(s.trim(), 10));
            return floor >= lo && floor <= (hi ?? lo);
        }
        return false;
    },

    /**
     * Turn a depth-ranged biome catalog into a { id/type: {chance,min,max} } spawn
     * table by making `budget` weighted-raffle picks over the rows eligible at this
     * depth (min <= floor <= max), weighted by `freq`.
     */
    _rollBiomeSpawns(rows, budget, floor, keyField = 'id') {
        const eligible = rows.filter(r => floor >= (r.min ?? 1) && floor <= (r.max ?? Infinity));
        if (!eligible.length) return {};

        const picks = this._budgetCount(budget);
        const table = {};
        for (let i = 0; i < picks; i++) {
            const row = this._weightedPick(eligible);
            if (!row) break;
            const key = row[keyField];
            const [lo, hi] = Array.isArray(row.count) ? row.count : [1, 1];
            // Accumulate repeat picks of the same entry into its min/max range.
            const cur = table[key] || { chance: 100, min: 0, max: 0 };
            cur.min += lo;
            cur.max += hi;
            table[key] = cur;
        }
        return table;
    },

    // How many spawn picks this floor: base + up to max_extra rolls at extra_chance%.
    // Defaults keep a bare {} budget from spawning nothing unexpectedly.
    _budgetCount(budget) {
        const b = budget || {};
        const base = b.base ?? 0;
        const maxExtra = b.max_extra ?? 0;
        const extraChance = b.extra_chance ?? 0;
        let n = base;
        for (let i = 0; i < maxExtra; i++) {
            if (ROT.RNG.getUniform() * 100 < extraChance) n++;
        }
        return n;
    },

    // Frequency-weighted raffle over rows (each row has a `freq`, default 1).
    _weightedPick(rows) {
        let total = 0;
        for (const r of rows) total += (r.freq ?? 1);
        if (total <= 0) return null;
        let roll = ROT.RNG.getUniform() * total;
        for (const r of rows) {
            roll -= (r.freq ?? 1);
            if (roll < 0) return r;
        }
        return rows[rows.length - 1];
    },

    /**
     * Hazard count ramp (Brogue's autoGenerator model): count grows linearly with
     * depth as clamp(intercept + floor*slope, 0, max), gated by min_depth. Returns
     * a {min,max} range the existing trap/fungus placers consume, or null if the
     * hazard isn't active yet at this depth.
     */
    _rampRange(spec, floor) {
        if (spec.min_depth != null && floor < spec.min_depth) return null;
        const raw = (spec.intercept ?? 0) + floor * (spec.slope ?? 0);
        const n = Math.max(0, Math.min(spec.max ?? raw, Math.round(raw)));
        // A small band around the computed count so floors aren't identical.
        return { min: Math.max(0, n - 1), max: n };
    },

    /**
     * Is the given floor's down-stairway currently sealed (its win conditions unmet)?
     * When floor N is sealed, floor N+1's up-stairway must be locked as the paired half,
     * so a player who fell down can't simply walk back up. The only ways to reach floor
     * N+1 (descending N's down-stairway, or falling from N) both require N to have been
     * loaded first, so N is always present in sealedDownFloors before its up-stairway is
     * needed. There should be a prototype level setting for an item that unlocks all stairways,
     * i.e. the amulet of yendor is a win condition but also unlocks all staircases in case there
     * is still a locked one above
     */
    isFloorDownSealed(floor) {
        return floor >= 1 && this.sealedDownFloors.has(floor);
    },

    /** Record whether a floor's down-way is sealed (membership in the tracker). */
    setDownSeal(floor, sealed) {
        if (sealed) this.sealedDownFloors.add(floor);
        else this.sealedDownFloors.delete(floor);
    },

    /** Derive a floor's down-seal state from its actual down-stairway actor (authored or generated). */
    updateDownSealFromStairway(stairway) {
        this.setDownSeal(this.currentFloor, !!stairway.getAttribute('locked'));
    },

    getDefaultPrototypeConfig() {
        return {
            name: "Default Prototype",
            mechanics: {
                fog_of_war: false,
                darkness: false,
                turn_based: true
            },
            stats: {
                health: { max: 1, current: 1 }
            },
            inventory: { max_items: 10 },
            available_items: ["key", "sword"],
            available_actors: ["player", "skeleton", "wall"],
            win_conditions: ["reach_exit"]
        };
    },
};

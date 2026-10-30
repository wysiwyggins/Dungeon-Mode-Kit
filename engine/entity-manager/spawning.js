/**
 * EntityManager methods: populating a floor: cellular automata, unplaced and
 * random actors/items/traps, fungus, biome decorations, budgets, treasure rooms,
 * chain creatures and Tiled object layers.
 */

import { spawnChainSegments } from '../../core/pathfinding.js';
import {
    ALL_DIRS,
    CARDINAL_DIRS,
    DECORATION_PATTERN_NAMES,
    parseItemList,
    parseTint,
    randomElement
} from '../../core/util.js';
import { Actor } from '../actor/actor.js';
import { Entity } from '../entity.js';
import { Item } from '../item.js';

export const EntityManagerSpawning = {
    /**
     * Run cellular automata behaviors once to pre-calculate initial state
     * This allows things like sewage pooling to be calculated at load time
     * @param {number} [steps=1] - Number of simulation steps to run
     */
    runCellularAutomataStep(steps = 1) {
        for (let step = 0; step < steps; step++) {
            // Get all actors with cellular_transform behavior
            // We need to collect transformations first, then apply them to avoid order-dependent issues
            const transformations = [];

            for (const actor of this.actors) {
                if (actor.isDead) continue;
                if (!actor.personality) continue;

                // Check if this actor has cellular_transform behavior
                const hasCellularBehavior = actor.personality.behaviors?.includes('cellular_transform');
                if (!hasCellularBehavior) continue;

                const data = actor.personality.data || {};
                const neighborType = data.neighbor_type || actor.type;
                const requiredCount = data.neighbor_count ?? 4;
                const transformTo = data.transform_to || ('deep_' + actor.type);
                const checkCardinal = data.check_cardinal !== false;

                if (actor.type === transformTo) continue;

                const directions = checkCardinal ? CARDINAL_DIRS : ALL_DIRS;

                let matchingNeighbors = 0;

                for (const dir of directions) {
                    const checkX = actor.x + dir.dx;
                    const checkY = actor.y + dir.dy;

                    const neighborsHere = this.getActorsAt(checkX, checkY);
                    for (const a of neighborsHere) {
                        if (a.type === neighborType || a.type === transformTo) {
                            matchingNeighbors++;
                            break;
                        }
                    }
                }

                if (matchingNeighbors >= requiredCount) {
                    transformations.push({
                        actor,
                        x: actor.x,
                        y: actor.y,
                        transformTo
                    });
                }
            }

            // Apply all transformations
            for (const t of transformations) {
                // Remove the old actor (without triggering death effects)
                this.removeEntity(t.actor);

                // Spawn the new actor
                this.spawnActor(t.transformTo, t.x, t.y);
            }

            if (transformations.length > 0) {
                console.log(`Cellular automata step ${step + 1}: ${transformations.length} transformations`);
            }
        }
    },

    /**
     * Spawn actors and items that are defined in the prototype folder but not placed in the map
     * Only considers prototype-specific actors/items, not global defaults from data/
     * @param {Set} placedActorTypes - Actor types already placed from the map
     * @param {Set} placedItemTypes - Item types already placed from the map
     */
    spawnUnplacedEntities(placedActorTypes, _placedItemTypes) {
        const prototype = this.engine.currentPrototype;
        if (!prototype) return;

        const walkableTiles = this.engine.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('No walkable tiles available for spawning unplaced entities');
            return;
        }

        // Get list of tiles not occupied by actors
        const getAvailableTiles = () => {
            const occupied = new Set();
            for (const actor of this.actors) {
                occupied.add(`${actor.x},${actor.y}`);
            }
            return walkableTiles.filter(t => !occupied.has(`${t.x},${t.y}`));
        };

        // Types to skip - these are structural or special and shouldn't be randomly spawned
        const skipActorTypes = new Set(['player', 'wall', 'door', 'stairway_up', 'stairway_down']);

        // Also skip actor types that are configured in random_actors (they'll be spawned separately)
        // getFloorConfig resolves the current floor for multi-level prototypes
        // (levels or floor_plan) and returns the root config for flat ones.
        const floorConfig = this.engine.getFloorConfig(this.engine.currentFloor);
        const randomActorTypes = new Set(Object.keys(floorConfig?.random_actors || {}));

        // Skip chain segment types - they're spawned by spawnChainCreatures via their head
        for (const actorType of prototype.prototypeActorTypes || []) {
            const actorData = prototype.getActorData(actorType);
            if (actorData?.attributes?.chain_segment_type) {
                // The head's segment type should be skipped
                skipActorTypes.add(actorData.attributes.chain_segment_type);
            }
        }

        // In multi-level prototypes, per-floor random_actors fully controls spawning —
        // don't auto-spawn unplaced prototype actors on every floor
        if (prototype.config?.levels || prototype.config?.floor_plan) return;

        // Spawn unplaced actors (only prototype-specific ones, single-level prototypes only)
        for (const actorType of prototype.prototypeActorTypes || []) {
            if (placedActorTypes.has(actorType)) continue;
            if (skipActorTypes.has(actorType)) continue;
            if (randomActorTypes.has(actorType)) continue;

            const actorData = prototype.getActorData(actorType);
            if (!actorData) continue;

            // Spawn 1-3 of each unplaced actor type
            const count = Math.floor(ROT.RNG.getUniform() * 3) + 1;
            const availableTiles = getAvailableTiles();

            for (let i = 0; i < count && availableTiles.length > 0; i++) {
                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles.splice(tileIndex, 1)[0];

                const actor = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                this.addEntity(actor);
                actor.loadDefaultItems();

                console.log(`Randomly spawned ${actorType} at (${tile.x}, ${tile.y})`);
            }
        }

    },

    /**
     * Spawn random actors based on prototype's random_actors config
     * Called after wildcard processing so walkable tiles exist
     * Format: { "actor_type": { "chance": 0-100, "min": 1, "max": 3 }, ... }
     * Each entry places min..max (default 1); chance is rolled per spawn, so 100 places them all
     */
    spawnRandomActorsFromConfig(floorConfig = null) {
        const walkableTiles = this.engine.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('random_actors/items: No walkable tiles available');
            return;
        }

        // Helper to get tiles not occupied by actors
        const getAvailableTiles = () => {
            const occupied = new Set();
            for (const actor of this.actors) {
                occupied.add(`${actor.x},${actor.y}`);
            }
            return walkableTiles.filter(t => !occupied.has(`${t.x},${t.y}`));
        };

        // A random_actors/random_items entry may name a region the generator
        // published (e.g. "sanctum" from the palladian generator) to confine its
        // spawns to. Entirely optional: a generator that publishes no regions costs
        // nothing, and an unknown name warns and falls back to the whole map rather
        // than blanking a floor over a typo.
        const regions = this.engine.mapManager.namedRegions || {};
        const tilesIn = (regionName) => {
            if (!regionName) return getAvailableTiles;
            const region = regions[regionName];
            if (!region || !region.length) {
                const available = Object.keys(regions).join(', ') || 'none';
                console.warn(`random spawn: region "${regionName}" not provided by this floor's generator (available: ${available}); using whole map`);
                return getAvailableTiles;
            }
            const inRegion = new Set(region.map(t => `${t.x},${t.y}`));
            return () => getAvailableTiles().filter(t => inRegion.has(`${t.x},${t.y}`));
        };

        this.spawnRandomActors(getAvailableTiles, floorConfig, tilesIn);
        this.spawnRandomTraps(getAvailableTiles, floorConfig, tilesIn);
        this.spawnRandomFungus(getAvailableTiles, floorConfig, tilesIn);
        this.spawnRandomItems(getAvailableTiles, floorConfig, tilesIn);
        this.spawnBudgetItems(getAvailableTiles, floorConfig, tilesIn);
    },

    /**
     * Give a freshly-spawned fungus actor a random appearance: a flavor name from
     * fungi_types.json (surfaced by the look UI, which reads actor.name) and a random
     * color from colors.json (hex → sprite tint). Each instance is randomized
     * independently — no learnable per-run "species". The tile's mass_noun attribute
     * means the name shows article-free ("you see puffballs").
     */
    randomizeFungusAppearance(actor) {
        const engine = this.engine;
        if (engine.globalFungiTypes?.length) {
            const fungiType = randomElement(engine.globalFungiTypes);
            // Publish as a template var so the data decides how it reads — a name of
            // "[fungi_type]" gives today's bare "puffballs", but a description can
            // also say "A glowing patch of [fungi_type]". Assigning actor.name
            // directly would overwrite whatever the data file authored.
            actor.templateVars.fungi_type = fungiType;
            if (!actor.name.includes('[')) actor.name = fungiType;
        }
        if (engine.globalColors?.length) {
            actor.tint = parseTint(randomElement(engine.globalColors).hex);
            actor.originalTint = actor.tint;
        }
    },

    /**
     * Scatter fungus during generation for prototypes that opt in via a `fungus`
     * config block: { min, max, tall_chance?, cluster? }. Places short glowing
     * `fungus` (spore-releasing, walkable) and, per `tall_chance`, solid sight-blocking
     * `tall_fungus`. Modeled on spawnRandomTraps; clusters patches like pack actors.
     */
    spawnRandomFungus(getAvailableTiles, floorConfig, tilesIn = null) {
        const fungusConfig = floorConfig?.fungus;
        if (!fungusConfig) return;

        const prototype = this.engine.currentPrototype;
        const min = fungusConfig.min ?? 1;
        const max = fungusConfig.max ?? min;
        const tallChance = fungusConfig.tall_chance ?? 0;
        const cluster = fungusConfig.cluster !== false; // default: clustered patches
        const patches = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        // An optional `region` confines the patches to a generator-published area.
        const tiles = tilesIn ? tilesIn(fungusConfig.region) : getAvailableTiles;

        const placeFungus = (tile) => {
            const type = ROT.RNG.getUniform() < tallChance ? 'tall_fungus' : 'fungus';
            const data = prototype.getActorData(type);
            if (!data) return null;
            const actor = new Actor(tile.x, tile.y, type, data, this.engine);
            this.addEntity(actor);
            this.randomizeFungusAppearance(actor);
            return actor;
        };

        for (let p = 0; p < patches; p++) {
            const availableTiles = tiles();
            if (availableTiles.length === 0) {
                console.warn('fungus: No tiles available');
                break;
            }

            const anchorTile = availableTiles[Math.floor(ROT.RNG.getUniform() * availableTiles.length)];
            placeFungus(anchorTile);

            if (cluster) {
                // A patch is the anchor plus 1-3 neighbors within Manhattan distance <= 2.
                const extra = 1 + Math.floor(ROT.RNG.getUniform() * 3);
                for (let i = 0; i < extra; i++) {
                    const nearby = tiles().filter(t =>
                        Math.abs(t.x - anchorTile.x) + Math.abs(t.y - anchorTile.y) <= 2
                    );
                    if (nearby.length === 0) break;
                    placeFungus(nearby[Math.floor(ROT.RNG.getUniform() * nearby.length)]);
                }
            }
        }
        console.log(`fungus: Spawned ${patches} patch(es)`);
    },

    /**
     * Scatter the biome's decorative entities — moss, rubble, skulls — across the
     * floor. Each row is { entity, pattern?, density?, min?, max?, freq?, region? };
     * see docs/BIOMES.md § Decorations for what the fields mean.
     *
     * Call once per generated floor, after every actor is placed and the renderer
     * exists. Don't call it when restoring a floor — those decorations are saved.
     */
    placeBiomeDecorations(floorConfig) {
        const rows = floorConfig?.decorations;
        if (!Array.isArray(rows) || rows.length === 0) return;

        const mm = this.engine.mapManager;
        const walkable = mm?.walkableTiles;
        if (!walkable || walkable.length === 0) {
            console.warn('decorations: No walkable tiles available');
            return;
        }

        // Tiles already taken, extended as we place so two rows never stack.
        const occupied = new Set();
        for (const entity of this.entities) occupied.add(`${entity.x},${entity.y}`);
        for (const actor of this.actors) if (!actor.isDead) occupied.add(`${actor.x},${actor.y}`);
        for (const item of this.items) occupied.add(`${item.x},${item.y}`);

        // Walls, water and lava are actors rather than tiles, so the patterns below
        // test actors. Actors are solid unless their data says otherwise.
        const isSolid = (x, y) => !!this.getSolidActorAt(x, y);
        // near_liquid counts lava as well as water and sewage. Lava has no `liquid`
        // attribute, since that flag governs wading and extinguishing.
        const isLiquid = (x, y) =>
            this.getActorsAt(x, y).some(actor => actor.hasAttribute('liquid') || actor.type === 'lava');
        const anyNeighbor = (pred, x, y) =>
            ALL_DIRS.some(dir => pred(x + dir.dx, y + dir.dy));

        const patternAccepts = (pattern, x, y) => {
            switch (pattern) {
                case 'wall_hugging': return anyNeighbor(isSolid, x, y);
                case 'near_liquid':  return anyNeighbor(isLiquid, x, y);
                // Maps carry no room metadata: a room interior is a tile with 3+
                // walkable cardinal neighbours, the same test the ambush behavior uses.
                case 'room_floor':   return this._walkableCardinalCount(x, y) >= 3;
                case 'scatter':
                case 'clusters':     return true;
                default:             return true;
            }
        };

        const place = (row, tile) => {
            const spawned = row.actor
                ? this.spawnActor(row.actor, tile.x, tile.y)
                : this.spawnEntity(row.entity, tile.x, tile.y);
            if (spawned) occupied.add(`${tile.x},${tile.y}`);
            return spawned;
        };

        for (const row of rows) {
            // A row scatters an entity (inert dressing) or an actor (dressing that
            // does something — a grave, a cairn). `id` stands in for whichever it is
            // so the warnings below read the same either way.
            const id = row?.actor || row?.entity;
            if (!id) continue;

            if (row.actor) {
                const actorData = this.engine.currentPrototype?.getActorData?.(row.actor);
                if (!actorData) {
                    console.warn(`decorations: actor "${row.actor}" not in actors.json; skipping row`);
                    continue;
                }
                // Scattered dressing must never wall off a corridor, and solid actors
                // are placed deliberately (by the generator or by hand in Tiled).
                if (actorData.attributes?.solid !== false) {
                    console.warn(`decorations: actor "${row.actor}" is solid; decorations must be walkable. Skipping row`);
                    continue;
                }
            } else {
                const entityData = this.engine.globalEntities?.[row.entity];
                if (!entityData) {
                    console.warn(`decorations: entity "${row.entity}" not in entities.json; skipping row`);
                    continue;
                }
                // Without a tileIndex or a fillColor there is nothing to draw.
                if (!entityData.tileIndex && !entityData.fillColor) {
                    console.warn(`decorations: entity "${row.entity}" has no tileIndex or fillColor; it will be invisible`);
                }
            }

            let pattern = row.pattern ?? 'scatter';
            if (!DECORATION_PATTERN_NAMES.has(pattern)) {
                console.warn(`decorations: unknown pattern "${pattern}" for "${id}"; using scatter`);
                pattern = 'scatter';
            }

            // Chance this row runs on this floor at all. Absent means always.
            if (row.freq != null && ROT.RNG.getPercentage() > row.freq) continue;

            const min = row.min ?? 0;
            const max = row.max ?? min;
            if (max <= 0) continue;

            // Optionally confine the row to a named region, as traps and fungus do.
            let pool = walkable;
            if (row.region) {
                const regionTiles = mm.namedRegions?.[row.region];
                if (regionTiles && regionTiles.length) {
                    pool = regionTiles;
                } else {
                    const available = Object.keys(mm.namedRegions || {}).join(', ') || 'none';
                    console.warn(`decorations: region "${row.region}" not provided by this floor's generator (available: ${available}); using whole map`);
                }
            }

            const candidates = pool.filter(tile =>
                !occupied.has(`${tile.x},${tile.y}`) && patternAccepts(pattern, tile.x, tile.y));
            if (candidates.length === 0) {
                console.warn(`decorations: no "${pattern}" tiles available for "${id}"`);
                continue;
            }

            // Scale the count to how much of this floor matches the pattern, then
            // clamp it to the row's min/max.
            const density = row.density ?? 0.1;
            let want = Math.round(candidates.length * density);
            want = Math.max(min, Math.min(max, want));
            want = Math.min(want, candidates.length);
            if (want <= 0) continue;

            let placed = 0;
            if (pattern === 'clusters') {
                // Pick a few anchor tiles and grow a patch outward from each.
                const unused = new Set(candidates.map(tile => `${tile.x},${tile.y}`));
                const patchCount = Math.max(1, Math.ceil(want / 4));
                const patchSize = Math.ceil(want / patchCount) - 1;

                for (let patch = 0; patch < patchCount && placed < want; patch++) {
                    const unusedTiles = candidates.filter(tile => unused.has(`${tile.x},${tile.y}`));
                    if (unusedTiles.length === 0) break;
                    const anchor = unusedTiles[Math.floor(ROT.RNG.getUniform() * unusedTiles.length)];
                    unused.delete(`${anchor.x},${anchor.y}`);
                    if (place(row, anchor)) placed++;

                    for (let grown = 0; grown < patchSize && placed < want; grown++) {
                        const nearAnchor = candidates.filter(tile =>
                            unused.has(`${tile.x},${tile.y}`) &&
                            Math.max(Math.abs(tile.x - anchor.x), Math.abs(tile.y - anchor.y)) <= 2);
                        if (nearAnchor.length === 0) break;
                        const tile = nearAnchor[Math.floor(ROT.RNG.getUniform() * nearAnchor.length)];
                        unused.delete(`${tile.x},${tile.y}`);
                        if (place(row, tile)) placed++;
                    }
                }
            } else {
                // Partial shuffle — only draws as many tiles as we need.
                const shuffled = candidates.slice();
                for (let i = 0; i < want; i++) {
                    const swap = i + Math.floor(ROT.RNG.getUniform() * (shuffled.length - i));
                    const tile = shuffled[swap];
                    shuffled[swap] = shuffled[i];
                    shuffled[i] = tile;
                    if (place(row, tile)) placed++;
                }
            }

            console.log(`decorations: Placed ${placed} "${id}" (${pattern}, ${candidates.length} candidate tiles)`);
        }
    },

    spawnRandomTraps(getAvailableTiles, floorConfig, tilesIn = null) {
        const trapsConfig = floorConfig?.traps;
        if (!trapsConfig) return;

        const prototype = this.engine.currentPrototype;
        // Resolve before filtering: `trap` lives on the trap type, so the raw
        // definitions no longer carry it.
        const trapTypes = Object.keys(prototype.actors)
            .filter(id => prototype.getActorData(id)?.attributes?.trap);

        if (trapTypes.length === 0) {
            console.warn('traps: No actor types with trap attribute found');
            return;
        }

        const min = trapsConfig.min ?? 1;
        const max = trapsConfig.max ?? min;
        const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        // An optional `region` confines traps to a generator-published area — e.g.
        // trapping a villa's interior while leaving its courtyard safe.
        const tiles = tilesIn ? tilesIn(trapsConfig.region) : getAvailableTiles;

        for (let i = 0; i < count; i++) {
            const availableTiles = tiles();
            if (availableTiles.length === 0) {
                console.warn('traps: No tiles available');
                break;
            }

            const trapType = trapTypes[Math.floor(ROT.RNG.getUniform() * trapTypes.length)];
            const trapData = prototype.getActorData(trapType);
            const tile = availableTiles[Math.floor(ROT.RNG.getUniform() * availableTiles.length)];

            const actor = new Actor(tile.x, tile.y, trapType, trapData, this.engine);
            this.addEntity(actor);
            console.log(`traps: Spawned "${trapType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
        }
    },

    /**
     * Spawn random actors based on prototype's random_actors config
     * @param {Function} getAvailableTiles - Function that returns available spawn tiles
     */
    spawnRandomActors(getAvailableTiles, floorConfig = null, tilesIn = null) {
        const prototype = this.engine.currentPrototype;
        const randomActors = floorConfig?.random_actors ?? prototype?.config?.random_actors;
        if (!randomActors) return;

        for (const [actorType, spawnConfig] of Object.entries(randomActors)) {
            const chance = spawnConfig.chance ?? 100;
            const min = spawnConfig.min ?? 1;
            const max = spawnConfig.max ?? 1;

            const actorData = prototype.getActorData(actorType);
            if (!actorData) {
                console.warn(`random_actors: No actor data found for "${actorType}"`);
                continue;
            }

            // An optional `region` narrows the pool to a generator-published area
            // (e.g. a palladian sanctum), so a boss can be authored to appear in the
            // room built for it. Composes with the aquatic filter below.
            const regionTiles = tilesIn ? tilesIn(spawnConfig.region) : getAvailableTiles;

            // Aquatic actors (eels) may only spawn on a liquid tile — i.e. inside a
            // water/sewage lake. Lava isn't a liquid, so lava lakes are excluded.
            const isAquatic = actorData.attributes?.aquatic === true;
            const tilesForActor = isAquatic
                ? () => regionTiles().filter(t => this._getLiquidActorAt(t.x, t.y))
                : regionTiles;

            // Roll how many to place between min and max. At chance 100 every one
            // of them lands; below that each spawn rolls chance on its own.
            const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

            // Pack actors spawn clustered together near a single anchor point
            const isPack = actorData.attributes?.pack === true;

            if (isPack) {
                // Roll chance once for the whole pack
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                const availableTiles = tilesForActor();
                if (availableTiles.length === 0) {
                    console.warn(`random_actors: No tiles available for "${actorType}"`);
                    continue;
                }

                // Pick an anchor tile for the pack
                const anchorIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const anchorTile = availableTiles[anchorIndex];

                const anchor = new Actor(anchorTile.x, anchorTile.y, actorType, actorData, this.engine);
                this.addEntity(anchor);
                anchor.loadDefaultItems();
                console.log(`random_actors: Spawned pack anchor "${actorType}" at (${anchorTile.x}, ${anchorTile.y}) (1/${count})`);

                // Spawn remaining pack members nearby (Manhattan distance <= 2)
                for (let i = 1; i < count; i++) {
                    const refreshedTiles = tilesForActor();
                    const nearbyTiles = refreshedTiles.filter(t =>
                        Math.abs(t.x - anchorTile.x) + Math.abs(t.y - anchorTile.y) <= 2
                    );

                    let tile;
                    if (nearbyTiles.length > 0) {
                        tile = nearbyTiles[Math.floor(ROT.RNG.getUniform() * nearbyTiles.length)];
                    } else if (refreshedTiles.length > 0) {
                        // Fall back to random map-wide tile
                        tile = refreshedTiles[Math.floor(ROT.RNG.getUniform() * refreshedTiles.length)];
                    } else {
                        console.warn(`random_actors: No tiles available for pack "${actorType}"`);
                        break;
                    }

                    const packMember = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                    this.addEntity(packMember);
                    packMember.loadDefaultItems();
                    console.log(`random_actors: Spawned pack "${actorType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
                }
                continue;
            }

            for (let i = 0; i < count; i++) {
                // Roll chance for each individual spawn
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                const availableTiles = tilesForActor();
                if (availableTiles.length === 0) {
                    console.warn(`random_actors: No tiles available for "${actorType}"`);
                    break;
                }

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles[tileIndex];

                const actor = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                this.addEntity(actor);
                actor.loadDefaultItems();
                //console.log(`random_actors: Spawned "${actorType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
            }
        }
    },

    /**
     * Spawn random items based on prototype's random_items config
     * @param {Function} getAvailableTiles - Function that returns available spawn tiles
     */
    spawnRandomItems(getAvailableTiles, floorConfig = null, tilesIn = null) {
        const prototype = this.engine.currentPrototype;
        const randomItems = floorConfig?.random_items ?? prototype?.config?.random_items;
        if (!randomItems) return;

        for (const [itemType, spawnConfig] of Object.entries(randomItems)) {
            const chance = spawnConfig.chance ?? 100;
            const min = spawnConfig.min ?? 1;
            const max = spawnConfig.max ?? 1;
            // An optional `region` confines this item to a generator-published area
            // (e.g. an artifact in a palladian sanctum).
            const itemTiles = tilesIn ? tilesIn(spawnConfig.region) : getAvailableTiles;

            const itemData = prototype.getItemData(itemType);
            if (!itemData) {
                console.warn(`random_items: No item data found for "${itemType}"`);
                continue;
            }

            // Roll how many to place between min and max. At chance 100 every one
            // of them lands; below that each spawn rolls chance on its own.
            const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

            // Resolved once and consumed as we go: getAvailableTiles only excludes
            // ACTOR-occupied tiles, so re-querying it per spawn would happily stack
            // every item of a 50-count batch onto the same tile. Same splice
            // approach spawnUnplacedEntities uses.
            const availableTiles = itemTiles();

            for (let i = 0; i < count; i++) {
                // Roll chance for each individual spawn
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                if (availableTiles.length === 0) {
                    console.warn(`random_items: No tiles available for "${itemType}"`);
                    break;
                }

                // Re-resolve per iteration: if itemType names a category, each of
                // the `count` spawns should roll its own member rather than all
                // sharing the one rolled above.
                const spawnData = prototype.getItemData(itemType);
                if (!spawnData) {
                    console.warn(`random_items: No item data found for "${itemType}"`);
                    continue;
                }
                const spawnType = spawnData.id || itemType;

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles.splice(tileIndex, 1)[0];

                const item = new Item(tile.x, tile.y, spawnType, spawnData, this.engine);
                item.rollEnchantment();
                this.addEntity(item);
                console.log(`random_items: Spawned "${spawnType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
            }
        }
    },

    spawnBudgetItems(getAvailableTiles, floorConfig, tilesIn = null) {
        const prototype = this.engine.currentPrototype;
        const budget = floorConfig?.item_budget ?? prototype?.config?.item_budget;
        if (!budget || prototype.activeCatalog.size === 0) return;

        const base = budget.base ?? 3;
        const extraChance = budget.extra_chance ?? 50;
        const maxExtra = budget.max_extra ?? 3;
        // An optional `region` confines the budget drop to a generator-published area.
        const tiles = tilesIn ? tilesIn(budget.region) : getAvailableTiles;

        let totalItems = base;
        for (let i = 0; i < maxExtra; i++) {
            if (ROT.RNG.getPercentage() <= extraChance) totalItems++;
        }

        // Build weighted category list from catalog config
        const catalogConfig = prototype.config.item_catalog;
        if (!catalogConfig) return;

        const categories = [];
        let totalWeight = 0;
        for (const [category, catConfig] of Object.entries(catalogConfig)) {
            if (!prototype.activeCatalog.has(category)) continue;
            const weight = catConfig.weight ?? 10;
            categories.push({ category, weight });
            totalWeight += weight;
        }

        if (categories.length === 0 || totalWeight === 0) return;

        for (let i = 0; i < totalItems; i++) {
            const availableTiles = tiles();
            if (availableTiles.length === 0) break;

            // Weighted random category selection
            let roll = ROT.RNG.getUniform() * totalWeight;
            let selectedCategory = categories[0].category;
            for (const { category, weight } of categories) {
                roll -= weight;
                if (roll <= 0) {
                    selectedCategory = category;
                    break;
                }
            }

            const itemType = prototype.getCatalogTypeForCategory(selectedCategory);
            if (!itemType) continue;

            const itemData = prototype.getItemData(itemType);
            if (!itemData) continue;

            const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
            const tile = availableTiles[tileIndex];

            const item = new Item(tile.x, tile.y, itemType, itemData, this.engine);
            item.rollEnchantment();
            this.addEntity(item);
            console.log(`item_budget: Spawned "${itemType}" (${selectedCategory}) at (${tile.x}, ${tile.y})`);
        }
    },

    /**
     * Spawn the contents of a designated treasure room:
     *  - A color-locked door at the entrance (must come before the key so color pairing works)
     *  - A matching key placed randomly outside the room
     *  - A random weapon or staff inside the room
     */
    spawnTreasureRoomContents({ roomTiles, doorPos }, architectContext) {
        const prototype = this.engine.currentPrototype;

        // 1. Spawn a locked_door at the entrance — triggers assignLockColor() → color enters unpairedLockColors
        const lockedDoorData = prototype.getActorData('locked_door');
        if (lockedDoorData) {
            architectContext.createActor(doorPos.x, doorPos.y, 'locked_door', lockedDoorData);
            console.log(`Treasure room: locked_door at (${doorPos.x}, ${doorPos.y})`);
        } else {
            console.warn('Treasure room: locked_door actor data not found');
        }

        // 2. Spawn a matching key outside the room — triggers getKeyColor() → pops the matching color
        const roomTileSet = new Set(roomTiles.map(t => `${t.x},${t.y}`));
        const occupied = new Set([...this.actors, ...this.items].map(e => `${e.x},${e.y}`));
        const keyTiles = this.engine.mapManager.walkableTiles.filter(
            t => !roomTileSet.has(`${t.x},${t.y}`) && !occupied.has(`${t.x},${t.y}`)
        );

        const keyData = prototype.getItemData('key');
        if (keyData && keyTiles.length > 0) {
            const keyPos = keyTiles[Math.floor(ROT.RNG.getUniform() * keyTiles.length)];
            const key = new Item(keyPos.x, keyPos.y, 'key', keyData, this.engine);
            this.addEntity(key);
            console.log(`Treasure room: key at (${keyPos.x}, ${keyPos.y})`);
        } else {
            console.warn('Treasure room: could not place key (no key data or no valid tiles)');
        }

        // 3. Spawn a random weapon or staff inside the room
        // Resolve before filtering: `weapon` and `treasure_loot` now live on the
        // item's type, so the raw definitions no longer carry them.
        const lootCandidates = Object.keys(prototype.items)
            .map(id => [id, prototype.getItemData(id)])
            .filter(([, data]) => data?.attributes?.weapon || data?.attributes?.treasure_loot);

        if (lootCandidates.length > 0 && roomTiles.length > 0) {
            const [lootType, lootData] = lootCandidates[Math.floor(ROT.RNG.getUniform() * lootCandidates.length)];
            const lootPos = roomTiles[Math.floor(ROT.RNG.getUniform() * roomTiles.length)];

            // Put the prize in a chest rather than loose on the floor. The vault's own
            // locked door already gates the room, so the chest stays unlocked — it's a
            // second beat, not a second lock. If the prototype has no chest actor, fall
            // back to the bare item so a prototype without one still gets its loot.
            const chestData = prototype.getActorData('wooden_chest');
            if (chestData) {
                const chest = new Actor(lootPos.x, lootPos.y, 'wooden_chest', chestData, this.engine);
                this.addEntity(chest);
                // Hand it the rolled prize directly: `defaultItems` is read by
                // loadDefaultItems, which then skips the `drops` roll, so the vault
                // decides the contents instead of the chest's own table.
                chest.defaultItems = [lootType];
                chest.loadDefaultItems();
                chest.inventory.forEach(i => i.rollEnchantment());
                console.log(`Treasure room: chest holding ${lootType} at (${lootPos.x}, ${lootPos.y})`);
            } else {
                const loot = new Item(lootPos.x, lootPos.y, lootType, lootData, this.engine);
                loot.rollEnchantment();
                this.addEntity(loot);
                console.log(`Treasure room: ${lootType} at (${lootPos.x}, ${lootPos.y})`);
            }
        } else {
            console.warn('Treasure room: no weapon/staff candidates found for loot');
        }
    },

    /**
     * Find all chain_head actors and spawn their body segment chains.
     * Called once after all actors (Tiled, unplaced, random) have been created.
     */
    spawnChainCreatures() {
        for (const actor of [...this.actors]) {
            if (actor.isDead) continue;
            if (!actor.hasAttribute('chain_head')) continue;
            if (actor._chainHead) continue;
            spawnChainSegments(actor, this);
        }
    },

    spawnActorsFromLayer(layer, entryDirection = null, placedActorTypes = null) {
        console.log(`Processing actors layer with ${layer.objects.length} objects`);

        for (const obj of layer.objects) {
            // Get actor type from Tiled's class property (newer) or type property (older), then name as fallback
            let actorType = obj.class || obj.type || obj.name;

            if (!actorType) {
                console.warn('Object has no class, type, or name, skipping:', obj);
                continue;
            }

            // Track that this actor type was placed in the map
            if (placedActorTypes) {
                placedActorTypes.add(actorType);
            }

            // Skip player actors when entering via stairway (player will be spawned at stairway)
            if (entryDirection && actorType === 'player') {
                console.log('Skipping player spawn from map (will spawn at stairway)');
                continue;
            }

            // Convert pixel position to tile position
            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            // Get actor data from prototype
            const actorData = this.engine.currentPrototype.getActorData(actorType);
            if (!actorData) {
                console.warn(`No actor data found for type '${actorType}'`);
                continue;
            }

            // Create and add actor
            const actor = new Actor(tileX, tileY, actorType, actorData, this.engine);
            this.addEntity(actor);

            // Parse custom Tiled properties (machine connections, switch overrides, item overrides).
            // Done BEFORE loadDefaultItems() so a default_items override takes effect.
            if (obj.properties) {
                for (const prop of obj.properties) {
                    if (prop.name === 'machine_id') {
                        actor.setAttribute('machine_id', prop.value);
                    } else if (prop.name === 'one_shot') {
                        actor.setAttribute('one_shot', prop.value);
                    } else if (prop.name === 'switch_effects') {
                        try {
                            actor.data = { ...actor.data, switch_effects: JSON.parse(prop.value) };
                        } catch (e) {
                            console.warn(`Invalid switch_effects JSON for ${actorType}:`, prop.value);
                        }
                    } else if (prop.name === 'switch_radius') {
                        actor.data = { ...actor.data, switch_radius: Number(prop.value) };
                    } else if (prop.name === 'default_items') {
                        // Override the actor type's default inventory for this one placement.
                        // Accepts a JSON array (e.g. ["crown"]) or a comma-separated list
                        // (e.g. "crown, torch"). An empty value clears the defaults.
                        actor.defaultItems = parseItemList(prop.value);
                    } else if (prop.name === 'unlock_conditions') {
                        // Condition lock for this placement (see refreshConditionLocks).
                        // A comma-separated list ("killed:linked, holding:key") or a JSON
                        // array, which can also carry {actor, stat, op, value} conditions.
                        const raw = String(prop.value).trim();
                        let conds = null;
                        if (raw.startsWith('[')) {
                            try {
                                conds = JSON.parse(raw);
                            } catch (e) {
                                console.warn(`Invalid unlock_conditions JSON for ${actorType}:`, prop.value);
                            }
                        } else {
                            conds = raw.split(',').map(s => s.trim()).filter(Boolean);
                        }
                        if (Array.isArray(conds) && conds.length > 0) {
                            actor.setAttribute('unlock_conditions', conds);
                        }
                    }
                }
            }

            // Load default items (type defaults, or the per-object override parsed above)
            actor.loadDefaultItems();

            console.log(`Spawned ${actorType} at tile (${tileX}, ${tileY}) from pixel (${obj.x}, ${obj.y})`);
        }
    },
    
    spawnItemsFromLayer(layer, placedItemTypes = null) {
        console.log(`Processing items layer with ${layer.objects.length} objects`);

        for (const obj of layer.objects) {
            // Get item type from Tiled's class property (newer) or type property (older), then name as fallback
            const itemType = obj.class || obj.type || obj.name;
            if (!itemType) continue;

            // Track that this item type was placed in the map
            if (placedItemTypes) {
                placedItemTypes.add(itemType);
            }

            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            const itemData = this.engine.currentPrototype.getItemData(itemType);
            if (!itemData) {
                console.warn(`No item data found for type '${itemType}'`);
                continue;
            }

            // A Tiled object may name a category ("potion") — use the rolled member.
            const item = new Item(tileX, tileY, itemData.id || itemType, itemData, this.engine);
            // Naming a category ("weapon") is asking for a random one; a named item is placed as authored
            if (itemData.id && itemData.id !== itemType) item.rollEnchantment();
            this.addEntity(item);

            console.log(`Spawned ${itemType} at tile (${tileX}, ${tileY})`);
        }
    },

    /**
     * Spawn landmark entities from a Tiled object layer
     * Landmarks are ad-hoc entities defined entirely in the map file,
     * not requiring pre-defined data in entities.json
     * @param {Object} layer - Tiled object layer
     */
    spawnLandmarksFromLayer(layer) {
        for (const obj of layer.objects) {
            // Get tile name from class/type (e.g., "IMPERFECT_DOTTED_LIGHT_SHADE")
            const tileName = obj.class || obj.type;
            if (!tileName) {
                console.warn('Landmark object has no class/type (tile name), skipping:', obj);
                continue;
            }

            // Convert pixel coordinates to tile coordinates
            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            // Create entity directly without requiring entities.json lookup
            const entity = new Entity(tileX, tileY, 'landmark', this.engine);
            entity.name = obj.name || 'landmark';

            // Resolve tile from the tile name
            entity.tileIndex = this.engine.spriteLibrary.resolveTile(tileName);
            if (!entity.tileIndex) {
                console.warn(`Landmark tile '${tileName}' not found in sprite library`);
                continue;
            }

            // Set visible by default
            entity.setAttribute('visible', true);

            // Extract custom properties from Tiled object
            if (obj.properties) {
                for (const prop of obj.properties) {
                    if (prop.name === 'walk_description') {
                        entity.setAttribute('walk_description', prop.value);
                    } else if (prop.name === 'tint') {
                        entity.tint = parseTint(prop.value);
                    } else if (prop.name === 'fillColor') {
                        entity.fillColor = parseTint(prop.value);
                    }
                }
            }

            // Create sprite and add to entities list
            this.engine.renderer?.createEntitySprite(entity);
            this.entities.push(entity);

            console.log(`Spawned landmark at (${tileX}, ${tileY}) with tile '${tileName}'`);
        }
    },
};

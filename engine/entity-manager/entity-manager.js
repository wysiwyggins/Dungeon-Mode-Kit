/**
 * EntityManager: owns the actors and items on a floor: adding/removing them,
 * temporary holes and dug areas, spawning single actors, gas stacking,
 * per-turn ground processing and serialization. Spawning and spatial queries
 * are installed from the sibling modules in engine/entity-manager/.
 */

import { installMethods } from '../../core/mixin.js';
import { ALL_DIRS, CARDINAL_DIRS, parseTint, randomElement } from '../../core/util.js';
import { Actor } from '../actor/actor.js';
import { EntityManagerQueries } from './queries.js';
import { EntityManagerSpawning } from './spawning.js';
import { Entity } from '../entity.js';
import { Item } from '../item.js';
import { globalVars } from '../../globals.js';

// ============================================================================
// ENTITY MANAGER
// ============================================================================

export class EntityManager {
    constructor(engine) {
        this.engine = engine;
        this.entities = [];
        this.actors = [];
        this.items = [];
        // Item ids that have appeared on this floor, for `collected:` win conditions.
        this.spawnedItemTypes = new Set();
        this.player = null;
        this._liquidPosCache = null;
        this._solidPosCache = null;
        this._actorPosCache = null;
    }

    async spawnEntities(entryDirection = null) {
        // Track which actor/item types are placed in the map
        const placedActorTypes = new Set();
        const placedItemTypes = new Set();

        // Process object layers from Tiled map if available
        if (this.engine.mapManager.objectLayers) {
            for (const layer of this.engine.mapManager.objectLayers) {
                if (layer.name === 'actors') {
                    this.spawnActorsFromLayer(layer, entryDirection, placedActorTypes);
                } else if (layer.name === 'items') {
                    this.spawnItemsFromLayer(layer, placedItemTypes);
                } else if (layer.name === 'landmarks') {
                    this.spawnLandmarksFromLayer(layer);
                }
            }
        }

        // Spawn unplaced actors/items from prototype's actors.json and items.json
        this.spawnUnplacedEntities(placedActorTypes, placedItemTypes);

        console.log(`Entities spawned: ${this.actors.length} actors, ${this.items.length} items`);

    }

    /**
     * Pair each key to a color-locked door so their colors match, regardless of the order
     * they spawned in. Key color is assigned eagerly at construction (Item constructor), which
     * is order-dependent: a key spawned before its door (e.g. a pedestal's default key listed
     * before the door in a .tmj) gets a random color and never matches. This deferred pass runs
     * once after ALL map entities exist (fresh loadFloor only) and fixes the mismatch.
     *
     * - Only color_locked doors are paired (generic_locked_door has no color_locked → any key opens
     *   it, so it is intentionally excluded). Stairways/gates are never keys/doors here.
     * - Idempotent: a key already carrying a real door's color is left alone — this preserves the
     *   treasure-room flow (door-then-key already matches) and makes floor reloads safe.
     * - Not run on restoreFloor: serialized lock_color/tint already persist the pairing.
     */
    reconcileKeyDoorColors() {
        const globalColors = this.engine.globalColors;
        if (!globalColors || globalColors.length === 0) return;

        // Collect color-locked doors (deterministic order for reproducible pairing).
        const doors = this.actors
            .filter(a => !a.isDead && a.hasAttribute('color_locked') && a.hasAttribute('locked'))
            .sort((a, b) => (a.y - b.y) || (a.x - b.x));
        if (doors.length === 0) return;

        // Collect every key, on the ground and in any actor's inventory, de-duped by identity.
        const keySet = new Set();
        for (const item of this.items) {
            if (item.hasAttribute?.('key')) keySet.add(item);
        }
        for (const actor of this.actors) {
            for (const item of actor.inventory || []) {
                if (item.hasAttribute?.('key')) keySet.add(item);
            }
        }
        if (keySet.size === 0) return;

        // Colors already claimed by a correctly-paired key shouldn't be reused.
        const doorColors = new Set(doors.map(d => d.getAttribute('lock_color')).filter(Boolean));
        const claimed = new Set();
        const unmatchedKeys = [];
        for (const key of keySet) {
            const kc = key.getAttribute('lock_color');
            if (kc && doorColors.has(kc)) {
                claimed.add(kc); // already paired to a real door — leave it
            } else {
                unmatchedKeys.push(key);
            }
        }

        // Door colors still available to hand out, in deterministic order.
        const freeColors = doors
            .map(d => d.getAttribute('lock_color'))
            .filter(c => c && !claimed.has(c));

        // Assign each unmatched key the next free door color. If keys outnumber doors, extra
        // keys keep their existing color (they can still open generic doors).
        for (const key of unmatchedKeys) {
            const colorName = freeColors.shift();
            if (!colorName) break;
            const colorDef = globalColors.find(c => c.color === colorName);
            key.setAttribute('lock_color', colorName);
            key.templateVars.color = colorName; // drives the "[color] key" unidentified name
            if (colorDef) {
                key.tint = parseTint(colorDef.hex);
                if (key.sprite) key.sprite.tint = key.tint; // refresh any already-created sprite
            }
            console.log(`Paired ${key.name} to ${colorName} door`);
        }
    }

    initializeSwitchTints() {
        const colors = this.engine.globalColors;
        if (!colors || colors.length === 0) return;

        const tinted = new Set();

        for (const actor of this.actors) {
            if (actor.isDead || tinted.has(actor)) continue;

            const machineId = actor.getAttribute('machine_id');
            let targets;

            // Teleporters linked by machine_id share a color too, so the player can
            // tell which pad leads where when a floor has several pairs.
            if (actor.hasAttribute('teleporter')) {
                if (!machineId) continue;
                targets = this.actors.filter(a => a !== actor && !a.isDead
                    && a.hasAttribute('teleporter') && a.getAttribute('machine_id') === machineId);
            } else if (!actor.data?.switch_effects) {
                continue;
            } else if (machineId) {
                targets = this.actors.filter(
                    a => a !== actor && !a.isDead && a.getAttribute('machine_id') === machineId
                );
            } else {
                const radius = actor.data?.switch_radius || 10;
                targets = this.actors.filter(a => {
                    if (a === actor || a.isDead) return false;
                    if (!a.hasAttribute('gate') && !a.hasAttribute('container') && !a.hasAttribute('switchable')) return false;
                    const dist = Math.abs(a.x - actor.x) + Math.abs(a.y - actor.y);
                    return dist <= radius;
                });
            }

            if (targets.length === 0) continue;

            // Reuse an already-assigned color on floor restore. This runs on every floor
            // load, so re-rolling would give a revisited lever a new hue — and now a new
            // name too ("the fire brick lever" becoming "the child's sky lever"), which
            // would break the color as a way to identify which lever drives which gate.
            const existing = actor.getAttribute('lock_color')
                || targets.map(t => t.getAttribute('lock_color')).find(Boolean);
            const color = existing
                ? (colors.find(c => c.color === existing) || randomElement(colors))
                : randomElement(colors);
            const tint = parseTint(color.hex);

            // Store the color's name alongside the tint, not just the hex: the color is
            // how the player tells one lever/gate pair from another, so messages need to
            // be able to say "the fire brick lever" (see Entity.getColorName). Uses the
            // same `lock_color` attribute doors and keys carry, so one seam serves all.
            const applyColor = (a) => {
                a.tint = tint;
                // As with random_color: effects like a teleporter's flicker_tint
                // animate around originalTint, so it has to carry the pair color.
                a.originalTint = tint;
                a.setAttribute('lock_color', color.color);
                // Mirrors reconcileKeyDoorColors: the attribute drives lock matching,
                // the template var drives the name. An actor whose data says
                // "[color] lever" picks the word up from here.
                if (a.templateVars) a.templateVars.color = color.color;
                tinted.add(a);
            };

            applyColor(actor);
            for (const target of targets) {
                applyColor(target);
            }
        }
    }

    initializeInventoryDisplays() {
        for (const actor of this.actors) {
            if (!actor.hasAttribute('display_inventory') || actor.isDead) continue;
            if (actor.inventory.length === 0) continue;
            actor.updateInventoryDisplay();
        }
    }

    addEntity(entity) {
        // Liquids never move, so only a liquid arriving changes the liquid cache.
        // Resetting it for every gas puff/fire/item forced a full actor rescan on
        // the next liquid lookup, many times per turn on the sewer level.
        if (entity.hasAttribute?.('liquid')) this._liquidPosCache = null;
        this._solidPosCache = null;
        this.entities.push(entity);

        if (entity instanceof Actor) {
            // _posSeq mirrors this.actors order so tile buckets keep the same
            // ordering a full rebuild would give (getActorAt returns the first).
            entity._posSeq = this._nextPosSeq = (this._nextPosSeq ?? 0) + 1;
            this.actors.push(entity);
            this._posCacheInsert(entity);
            // Track player if this actor has the controlled attribute
            if (entity.hasAttribute('controlled')) {
                this.player = entity;
                console.log(`Player set: ${entity.name} at (${entity.x}, ${entity.y})`);
            }
        } else if (entity instanceof Item) {
            this.items.push(entity);
            // Remember that this type ever existed on the floor. `collected:` win
            // conditions need it to tell "all taken" from "never spawned", since
            // both leave zero on the ground.
            this.spawnedItemTypes.add(entity.type);
            // Create sprite for dynamically added items
            if (this.engine.renderer) {
                this.engine.renderer.createItemSprite(entity);
            }
        }

        // Update sidebar when entities change
        this.engine.interfaceManager?.updateSidebar();
    }
    
    removeEntity(entity) {
        if (entity.hasAttribute?.('liquid')) this._liquidPosCache = null;
        this._solidPosCache = null;
        this._posCacheRemove(entity);
        // Remove from arrays (order-preserving). Only rebuild the typed arrays the
        // entity actually belongs to — an Actor isn't in items and vice versa, so
        // the old unconditional triple-filter rebuilt arrays that never held it.
        // Matters when many gas clouds expire per turn on the sewer level.
        this.entities = this.entities.filter(e => e !== entity);
        if (entity instanceof Actor) {
            this.actors = this.actors.filter(a => a !== entity);
        } else if (entity instanceof Item) {
            this.items = this.items.filter(i => i !== entity);
        }

        // Clean up sprites
        if (entity.spriteBase) {
            entity.spriteBase.destroy();
            entity.spriteBase = null;
        }
        if (entity.spriteTop) {
            entity.spriteTop.destroy();
            entity.spriteTop = null;
        }
        if (entity.spriteSide) {
            entity.spriteSide.destroy();
            entity.spriteSide = null;
        }
        // Clean up equipment sprites
        if (entity.spriteEquipment) {
            for (const slot of ['top', 'middle', 'lower']) {
                if (entity.spriteEquipment[slot]) {
                    entity.spriteEquipment[slot].destroy();
                    entity.spriteEquipment[slot] = null;
                }
            }
        }
        if (entity.sprite) {
            entity.sprite.destroy();
            entity.sprite = null;
        }
        // The hallucinated name belongs to the scrambled sprite that just died with it.
        // An item picked up mid-trip leaves entityManager.items, so texture_scramble's
        // remove() sweep can no longer reach it — without this it would surface a stale
        // false name if it were ever dropped again.
        delete entity._hallucinatedTileNameBase;
        delete entity._hallucinatedTileNameTop;
        // Clean up tileSprite for entities with both fill color and tile
        if (entity.tileSprite) {
            entity.tileSprite.destroy();
            entity.tileSprite = null;
        }

        // Remove from scheduler if it's an actor
        if (this.engine.scheduler && entity.act) {
            this.engine.scheduler.remove(entity);
        }

        // Update sidebar when entities change
        this.engine.interfaceManager?.updateSidebar();
    }

    /**
     * Make (x, y) temporarily floorless (descent vapor), or keep an open hole
     * open: the floor and overlay go, the background becomes void and gets the
     * cliff shading addBaseAndShadows paints, so it reads as a pit. The ordinary
     * void rules then apply — walk in and you fall, thrown items drop through,
     * pathing avoids it. Each player action counts it down (tickTemporaryHoles)
     * and the original tiles come back when it reaches zero.
     *
     * Only bare ground opens: a tile with no floor already, or holding anything
     * but creatures and gas (stairs, liquid, decorations, traps), is left alone.
     * @param {number} x
     * @param {number} y
     * @param {number} turns - Player actions it stays open; refreshing never shortens it
     * @returns {boolean} Whether the tile is open now
     */
    openTemporaryHole(x, y, turns) {
        if (!this.temporaryHoles) this.temporaryHoles = new Map();
        const key = x * 10000 + y;
        const open = this.temporaryHoles.get(key);
        if (open) {
            open.turnsLeft = Math.max(open.turnsLeft, turns);
            return true;
        }

        const mapManager = this.engine.mapManager;
        const floor = mapManager?.floorMap[y]?.[x];
        if (!floor || floor.tileId <= 0 || globalVars.VOID_FLOOR_FILLS.includes(floor.tileId)) return false;
        const blocked = this.getActorsAt(x, y).some(a =>
            !a.isDead && a.stats?.health === undefined && this._gasDensity(a) === 0);
        if (blocked) return false;

        this.temporaryHoles.set(key, {
            x, y, turnsLeft: turns,
            floor, background: mapManager.backgroundMap[y][x], overlay: mapManager.overlayMap[y][x]
        });
        mapManager.floorMap[y][x] = null;
        mapManager.overlayMap[y][x] = null;
        const renderer = this.engine.renderer;
        renderer?.clearTileAt('floor', x, y);
        renderer?.clearTileAt('overlay', x, y);
        this._reshadeTemporaryHoles([{ x, y }]);
        return true;
    }

    /**
     * Count every open hole down one player action, filling in the expired ones.
     */
    tickTemporaryHoles() {
        if (!this.temporaryHoles?.size) return;
        const expired = [];
        for (const hole of this.temporaryHoles.values()) {
            if (--hole.turnsLeft <= 0) expired.push(hole);
        }
        if (expired.length > 0) this._closeTemporaryHoles(expired);
    }

    /** Fill in every open hole at once — before the floor is saved on leaving it. */
    closeAllTemporaryHoles() {
        if (this.temporaryHoles?.size) this._closeTemporaryHoles([...this.temporaryHoles.values()]);
    }

    _closeTemporaryHoles(holes) {
        const mapManager = this.engine.mapManager;
        const renderer = this.engine.renderer;
        for (const hole of holes) {
            this.temporaryHoles.delete(hole.x * 10000 + hole.y);
            mapManager.floorMap[hole.y][hole.x] = hole.floor;
            mapManager.backgroundMap[hole.y][hole.x] = hole.background;
            mapManager.overlayMap[hole.y][hole.x] = hole.overlay;
            for (const layer of ['floor', 'background', 'overlay']) {
                renderer?.clearTileAt(layer, hole.x, hole.y);
                renderer?.renderTileAt(layer, hole.x, hole.y, mapManager);
            }
        }
        // Ground coming back can put a cliff lip over a hole that's still open
        this._reshadeTemporaryHoles(holes);
    }

    /**
     * Repaint the cliff shading of the open holes near `changed`: reset them to
     * flat void and rerun addBaseAndShadows over their bounding box, so shading
     * follows the edges as holes open and close.
     * @param {Array<{x: number, y: number}>} changed - Cells that just opened or closed
     */
    _reshadeTemporaryHoles(changed) {
        const mapManager = this.engine.mapManager;
        const renderer = this.engine.renderer;
        const holes = [...this.temporaryHoles.values()];
        const cells = [...holes, ...changed];
        const bounds = {
            x1: Math.min(...cells.map(c => c.x)) - 1, y1: Math.min(...cells.map(c => c.y)) - 1,
            x2: Math.max(...cells.map(c => c.x)) + 1, y2: Math.max(...cells.map(c => c.y)) + 1
        };
        for (const hole of holes) {
            mapManager.backgroundMap[hole.y][hole.x] = { tileId: globalVars.VOID_FILL, layer: 'background' };
        }
        if (holes.length > 0) mapManager.addBaseAndShadows(bounds);
        for (const hole of holes) {
            renderer?.clearTileAt('background', hole.x, hole.y);
            renderer?.renderTileAt('background', hole.x, hole.y, mapManager);
        }
        this.engine.updateLighting?.();
    }

    revealDugArea(clearedPositions) {
        const mapManager = this.engine.mapManager;
        if (!mapManager) return;

        const wallData = this.engine.currentPrototype.getActorData('wall');
        if (!wallData) return;

        const DUG_FLOOR_TILE = 135;
        // Void backgrounds: the flat void fill plus the cliffside shading that
        // addBaseAndShadows (architect/architect.js) paints along abyss edges. All of them are
        // only ever set on floorless cells, so each still means "bottomless void",
        // just rendered as a shaded cliff. Sourced from globalVars so it cannot drift
        // out of sync with what the generator paints — if a shaded cliff cell stopped
        // reading as void here, digging beside an abyss would pave over the pit.
        const VOID_BG_TILES = new Set(globalVars.VOID_TILE_IDS);
        const clearedSet = new Set(clearedPositions.map(p => `${p.x},${p.y}`));

        // An abyss cell (void background, no floor) is a deliberate bottomless pit —
        // NOT missing floor to be filled in. Digging must leave it as the void rather
        // than paving it over, otherwise shattering next to an abyss erases the pit
        // (including its shaded cliff edges, which read as void too).
        const isAbyss = (x, y) => {
            const bg = mapManager.backgroundMap[y]?.[x];
            return bg && VOID_BG_TILES.has(bg.tileId) && mapManager.floorMap[y]?.[x] == null;
        };

        for (const { x, y } of clearedPositions) {
            if (x < 0 || x >= mapManager.width || y < 0 || y >= mapManager.height) continue;
            if (isAbyss(x, y)) continue;
            if (!mapManager.floorMap[y][x]) {
                mapManager.floorMap[y][x] = { tileId: DUG_FLOOR_TILE, layer: 'floor' };
                this.engine.renderer?.renderTileAt('floor', x, y, mapManager);
                if (!this.getEntityAt(x, y)) {
                    this.spawnEntity('rubble', x, y);
                }
            }
        }

        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (const { x, y } of clearedPositions) {
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= mapManager.width || ny < 0 || ny >= mapManager.height) continue;
                if (clearedSet.has(`${nx},${ny}`)) continue;
                if (isAbyss(nx, ny)) continue;
                if (mapManager.floorMap[ny]?.[nx]) continue;
                if (this.getActorAt(nx, ny)) continue;

                mapManager.floorMap[ny][nx] = { tileId: DUG_FLOOR_TILE, layer: 'floor' };
                this.engine.renderer?.renderTileAt('floor', nx, ny, mapManager);

                const actor = new Actor(nx, ny, 'wall', wallData, this.engine);
                this.addEntity(actor);
                this.engine.renderer?.createActorSprites(actor);
            }
        }

        this.engine.updateLighting?.();
    }

    /**
     * Spawn an actor from actors.json at a given position
     * @param {string} actorType - The actor type key from actors.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Actor|null} The spawned actor or null if type not found
     */
    spawnActor(actorType, x, y) {
        const actorData = this.engine.currentPrototype?.getActorData(actorType);
        if (!actorData) {
            console.warn(`Actor type '${actorType}' not found in actors.json`);
            return null;
        }

        const actor = new Actor(x, y, actorType, actorData, this.engine);

        // Gas is non-solid but still can't fill a wall tile. Refused here rather
        // than at each spawn site, so every cloud/mist path gets it; callers
        // already treat a null spawn as "nothing happened".
        if (this._gasDensity(actor) > 0 && this.blocksGasAt(x, y)) return null;

        this.addEntity(actor);
        actor.loadDefaultItems();

        // A newly-spawned liquid (new lake tile, or a cellular_transform to a deep
        // variant) is a disturbance: re-wake any settled liquid neighbors so they
        // re-blend toward it. Keeps the liquid_color_mix settle optimization correct.
        if (actor.hasAttribute('liquid')) {
            for (const dir of CARDINAL_DIRS) {
                const neighbor = this._getLiquidActorAt(x + dir.dx, y + dir.dy);
                if (neighbor && neighbor._mixSettled) neighbor._mixSettled = false;
            }
        }

        // Any new actor might be what a settled cellular_transform neighbor was
        // short of. All 8 directions, since that behavior can count diagonals.
        for (const dir of ALL_DIRS) {
            for (const neighbor of this.getActorsAt(x + dir.dx, y + dir.dy)) {
                if (neighbor._caSettled) neighbor._caSettled = false;
            }
        }

        // Create sprites if renderer exists
        if (this.engine.renderer) {
            this.engine.renderer.createActorSprites(actor);
        }

        // Add to scheduler if actor has a personality (takes turns)
        if (actor.personality && this.engine.scheduler) {
            this.engine.scheduler.add(actor, true);
        }

        // Apply immediate damage to actors at this location
        // This ensures fire/cloud damage hits before victims can flee
        this.applySpawnDamage(actor);

        if (actor.hasAttribute('ignites')) {
            // Consume flammable OBJECTS/terrain (trees, webs, bridges, gas, trail
            // entities — no health stat) into fire. Living creatures and the player
            // (health stat) are NOT instantly incinerated here — they take fire damage
            // over time via applySpawnDamage / fire_burn_out (capped once per turn),
            // then catch the burning state. See consumeFlammableAt for the shared logic.
            this.consumeFlammableAt(actor, x, y, actor.type, actor.fireLifetime ?? actor.lifetime);
        }

        // Prevent fire from stacking: one fire actor per tile. A second fire spawn
        // refreshes the existing fire's lifetime (never shortens it) and is discarded,
        // so a fire trap's overlapping center/ring/spread fires collapse to one.
        if (!this._mergingFire && actor.hasAttribute('ignites') && !actor.isDead) {
            const existing = this.getActorsAt(x, y).find(
                a => a !== actor && !a.isDead && a.type === actor.type && a.hasAttribute('ignites')
            );
            if (existing) {
                existing.fireLifetime = Math.max(
                    existing.fireLifetime ?? existing.lifetime ?? 0,
                    actor.fireLifetime ?? actor.lifetime ?? 0
                );
                actor.die();
                return existing;
            }
        }

        // Prevent gas from stacking the moment a second cloud/mist lands on a tile.
        // The _mergingGas guard skips this for the cloud that resolveGasStacking
        // itself spawns, so the merge can't recurse into another merge.
        if (!this._mergingGas && this._gasDensity(actor) > 0) {
            const survivor = this.resolveGasStacking(x, y);
            // If this actor was merged away, return the survivor instead.
            if (actor.isDead) return survivor;
        }

        // A newly-spawned light source (e.g. fire) or solid shadow-caster changes the
        // scene's lighting; recompute so its light/shadow appears this turn rather than
        // one turn late. Coalesced (see requestLightingUpdate): a fire trap's center +
        // ring + spread burst collapses to a single recompute. Merge/early-return paths
        // above didn't create new light — the surviving actor already contributes.
        if (actor.hasAttribute('light_source') || actor.hasAttribute('solid')) {
            this.engine.requestLightingUpdate(x, y);
        }

        return actor;
    }

    /**
     * Classify a gas actor's density by personality: 'Cloud' (dense) = 2,
     * 'Mist' (thin) = 1, anything else = 0 (not gas). Covers sewer_gas/steam/etc.
     * which all use the shared cloud/mist personalities.
     */
    _gasDensity(actor) {
        const n = actor.personality?.name;
        if (n === 'Cloud') return 2;
        if (n === 'Mist') return 1;
        return 0;
    }

    /**
     * Enforce one gas actor per tile with two density levels (cloud > mist).
     * Called at spawn time and once per turn (merge_clouds behavior) so gas
     * concentrates and disperses but never stacks many instances on one tile.
     *
     * Rules:
     *  - Any cloud present → the cloud survives, all other gas on the tile is
     *    removed. Survivor keeps the longer remaining lifetime (never extended
     *    beyond it), so total gas-lifetime strictly decreases on every merge.
     *  - Two or more mists, no cloud → they concentrate: the mists are removed
     *    and one cloud is spawned in their place (a full spreading origin), again
     *    inheriting only the longest remaining lifetime. To prevent runaway
     *    re-spawn waves on a dense lake, a merge-born cloud is tagged so it can't
     *    itself trigger another upgrade-merge, and it won't form if a merge-born
     *    cloud is already adjacent this turn.
     * Returns the surviving/created gas actor on the tile, or null.
     */
    resolveGasStacking(x, y) {
        const gas = this.getActorsAt(x, y).filter(a => !a.isDead && this._gasDensity(a) > 0);
        if (gas.length <= 1) return gas[0] || null;

        const clouds = gas.filter(a => this._gasDensity(a) === 2);
        const longestLifetime = gas.reduce(
            (m, a) => Math.max(m, a.cloudLifetime ?? a.lifetime ?? 0), 0
        );

        if (clouds.length > 0) {
            // Keep one cloud (prefer an existing spreading origin), remove the rest.
            const survivor = clouds.find(c => c.isCloudOrigin) || clouds[0];
            survivor.cloudLifetime = Math.max(survivor.cloudLifetime ?? 0, longestLifetime);
            for (const a of gas) {
                if (a !== survivor) a.die();
            }
            return survivor;
        }

        // Mist-only stack → concentrate into a single cloud. Several guards keep
        // concentration from sustaining an endless spread→disperse→merge→spread loop
        // (the goal is net loss over time, not equilibrium):
        //  - don't upgrade next to a cloud that was itself just born from a merge,
        //  - only a probability of co-located mist actually upgrades; the rest just
        //    collapse to a single mist. So most merges LOSE a gas actor outright and
        //    only some promote, biasing the population downward each turn.
        const mergeBornAdjacent = ALL_DIRS.some(d => {
            const neighbor = this.getActorsAt(x + d.dx, y + d.dy)
                .find(a => !a.isDead && a._fromMerge && this._gasDensity(a) === 2);
            return !!neighbor;
        });
        const upgradeChance = 0.5;
        const doUpgrade = !mergeBornAdjacent && ROT.RNG.getUniform() < upgradeChance;

        // Inherit visible/effect identity from one of the mists before removing them.
        // Flammability carries too, since generic mist/cloud default to non-flammable
        // and only fuel gases (sewer gas, a flammable potion's cloud) should burn.
        const template = gas[0];
        const flammable = !!template.hasAttribute('flammable');
        const tint = template.tint;
        const collisionEffect = template.getAttribute('collision_effect');
        const applyState = template.getAttribute('apply_state');
        const ward = template.getAttribute('ward');

        for (const a of gas) a.die();

        if (!doUpgrade) {
            // No upgrade this time: leave a single mist behind (concentration failed),
            // so two-mist overlaps usually just shed one actor.
            let mist;
            this._mergingGas = true;
            try {
                mist = this.spawnActor('mist', x, y);
            } finally {
                this._mergingGas = false;
            }
            if (mist) {
                mist.cloudLifetime = longestLifetime;
                if (tint != null) mist.tint = tint;
                if (collisionEffect) mist.setAttribute('collision_effect', collisionEffect);
                if (applyState) mist.setAttribute('apply_state', applyState);
                if (ward) mist.setAttribute('ward', ward);
                mist.setAttribute('flammable', flammable);
                if (mist.spriteBase && tint != null) mist.spriteBase.tint = tint;
                if (mist.spriteTop && tint != null) mist.spriteTop.tint = tint;
            }
            return mist;
        }

        let cloud;
        this._mergingGas = true;
        try {
            cloud = this.spawnActor('cloud', x, y);
        } finally {
            this._mergingGas = false;
        }
        if (cloud) {
            cloud._fromMerge = true;
            cloud.isCloudOrigin = true;
            cloud.cloudOriginX = x;
            cloud.cloudOriginY = y;
            // No lifetime boost — concentration costs gas, it doesn't create it.
            cloud.cloudLifetime = longestLifetime;
            if (tint != null) cloud.tint = tint;
            if (collisionEffect) cloud.setAttribute('collision_effect', collisionEffect);
            if (applyState) cloud.setAttribute('apply_state', applyState);
            if (ward) cloud.setAttribute('ward', ward);
            cloud.setAttribute('flammable', flammable);
            if (cloud.spriteBase && tint != null) cloud.spriteBase.tint = tint;
            if (cloud.spriteTop && tint != null) cloud.spriteTop.tint = tint;
        }
        return cloud;
    }

    /**
     * Consume co-located flammable OBJECTS/terrain (trees, webs, bridges, gas, trail
     * entities — anything with no health stat) on a tile into fire. Shared source of
     * truth for both same-tile ignition paths: a fire spawning onto flammables (the
     * ignites block in spawnActor) and a fire sitting on flammables each turn
     * (fire_burn_out). Living creatures and the player (health stat) are deliberately
     * NOT consumed here — they take fire damage over time + the burning state instead.
     *
     * Victims are collected first, then killed, THEN fire is spawned — so the spawned
     * fire's own ignites-block re-scan finds nothing left to consume (no recursion),
     * while the fire dedupe block still runs and collapses the spawned fire into any
     * fire already on the tile (one fire per tile; lifetime refreshed).
     * @param {Entity} fireActor - The igniting fire actor (excluded from consumption)
     * @param {number} x
     * @param {number} y
     * @param {string} fireType - Actor type to spawn for the resulting fire
     * @param {number|null} fireLifetime - Lifetime to stamp on spawned fire(s)
     * @returns {boolean} True if anything was consumed
     */
    consumeFlammableAt(fireActor, x, y, fireType = 'fire', fireLifetime = null) {
        // Flammable actors with no health stat (gas, terrain props). Never consume
        // other igniters (fire-into-fire is the dedupe block's job) or fireproof actors.
        const victimActors = this.getActorsAt(x, y).filter(
            a => a !== fireActor && a.hasAttribute('flammable') && !a.isDead &&
                 a.stats?.health === undefined &&
                 !a.hasAttribute('ignites') && !a.hasAttribute('fireproof')
        );
        // Flammable decorative entities on this exact tile (e.g. thread trail).
        // fire_spread only reaches cardinal neighbors, so same-tile entities need this.
        const victimEntities = this.entities.filter(
            e => e.x === x && e.y === y && !e.isDead &&
                 !(e instanceof Actor) && !(e instanceof Item) &&
                 e.hasAttribute('flammable')
        );

        const consumedCount = victimActors.length + victimEntities.length;
        if (consumedCount === 0) return false;

        // Kill victims first so the spawned fire's ignites-block re-scan finds nothing
        // (all victims are !isDead-filtered out), preventing recursion. Do NOT set
        // _mergingFire: we WANT the dedupe block to merge the new fire into any existing
        // one so fires never stack on a tile.
        for (const a of victimActors) a.die();
        for (const e of victimEntities) e.die();

        for (let i = 0; i < consumedCount; i++) {
            const newFire = this.spawnActor(fireType, x, y);
            if (newFire) newFire.fireLifetime = fireLifetime ?? newFire.lifetime ?? 5;
        }

        return true;
    }

    /**
     * Tick states on actors that are not in the scheduler.
     *
     * Only actors with a personality (or the player) are scheduled, so inert
     * terrain — a pushable wall, a door, a statue — never calls act() and never
     * reaches processStates(). Without this sweep a state applied to such an actor
     * would last forever. Called once per round from the controlled actor's turn.
     */
    processUnscheduledStates() {
        for (const actor of this.actors) {
            if (actor.isDead) continue;
            if (actor.personality || actor.hasAttribute('controlled')) continue;
            if (!actor.states || Object.keys(actor.states).length === 0) continue;
            actor.processStates();
        }
    }

    /**
     * Tick items lying on the floor that are burning (a dropped lit torch or stick
     * of incense) so they spend fuel, emit, and burn out as they would when carried.
     * Only burning items tick — a staff left on the floor doesn't recharge.
     */
    processGroundItems() {
        for (const item of [...this.items]) {
            if (!item.isBurning?.()) continue;
            item.processPerTurnStats();

            if (item.stats.burns.current > 0) {
                this.emitFromItem(item, item.x, item.y);
                continue;
            }

            const { x, y } = item;
            if (this.engine.isTileVisible(x, y)) {
                this.engine.inputManager?.showMessage(`The ${item.getDisplayName()} burns out.`);
            }
            const burnsOutItem = item.getAttribute('burns_out_item');
            this.removeEntity(item);
            if (burnsOutItem) this.spawnItem(burnsOutItem, x, y);
            this.engine.updateLighting();
        }
    }

    /**
     * Let a burning item with `emits` release a spreading puff of that gas at
     * (x, y) every `emit_interval` turns (default 3) — incense smoke. Waits while
     * the tile still holds dense gas, so the stick tops up its haze rather than
     * stacking clouds.
     */
    emitFromItem(item, x, y) {
        const emitType = item.getAttribute('emits');
        if (!emitType) return;
        if (item._emitCooldown > 0) {
            item._emitCooldown--;
            return;
        }
        if (this.getActorsAt(x, y).some(a => !a.isDead && this._gasDensity(a) === 2)) return;

        const cloud = this.spawnActor(emitType, x, y);
        if (cloud) {
            cloud.isCloudOrigin = true;
            cloud.cloudOriginX = x;
            cloud.cloudOriginY = y;
        }
        item._emitCooldown = (item.getAttribute('emit_interval') ?? 3) - 1;
    }

    /**
     * Apply immediate damage from a newly spawned actor to any actors at its location
     * This handles fire, cloud, and other hazardous actors that should damage on contact
     * @param {Actor} hazard - The newly spawned hazardous actor
     */
    applySpawnDamage(hazard) {
        // A fire spawned as a state's attached_actor must not damage on arrival —
        // it's the visual for `burning`, and the state's per_turn_effect delivers
        // the damage. Flagged by applyState around the spawn call, because the
        // hazard's own _isAttachedFire tag can't be set until spawnActor returns.
        if (this._spawningAttachedActor) return;

        // Check if this actor has damage-dealing behaviors
        const personality = hazard.personality;
        if (!personality) return;

        const behaviors = personality.data?.behaviors || [];
        const hasDamageBehavior = behaviors.includes('fire_burn_out') ||
                                   behaviors.includes('cloud_affect_actors') ||
                                   behaviors.includes('incinerate_entities');

        if (!hasDamageBehavior) return;

        for (const other of this.getActorsAt(hazard.x, hazard.y)) {
            if (other === hazard) continue;

            if (!other.hasAttribute('flammable') ||
                other.hasAttribute('hazard_immune')) continue;

            // Skip flying actors (hovering above ground hazards)
            if (other.hasStateProperty?.('flying')) continue;

            // Apply fire damage
            if (behaviors.includes('fire_burn_out')) {
                const damagePerTurn = hazard.data?.damage_per_turn ?? 10;

                // Skip fireproof actors
                if (other.hasAttribute('fireproof')) continue;

                if (damagePerTurn > 0 && other.stats?.health) {
                    // Cap fire damage at once per victim turn so a spawn hit and the
                    // same-turn fire_burn_out tick (and attached-burning fire) can't stack.
                    const burned = other.takeFireDamageOncePerTurn(damagePerTurn);

                    // Show damage message (only when the hit actually landed this turn)
                    if (burned && other.hasAttribute('visible')) {
                        this.engine.inputManager?.showMessage(`The fire burns ${other.getNameWithArticle()} for ${damagePerTurn} damage!`, { x: other.x, y: other.y });
                    }
                }
            }

            // Apply cloud/mist collision effect
            if (behaviors.includes('cloud_affect_actors')) {
                const collisionEffect = hazard.getAttribute('collision_effect');
                if (collisionEffect && typeof collisionEffect === 'object') {
                    for (const [key, value] of Object.entries(collisionEffect)) {
                        if (other.stats && other.stats[key] !== undefined) {
                            const stat = other.stats[key];
                            if (typeof stat === 'object' && stat.current !== undefined) {
                                stat.current = Math.max(0, stat.current + value);

                                // Show effect message
                                if (other.hasAttribute('visible') && value < 0) {
                                    const statCapitalized = key.charAt(0).toUpperCase() + key.slice(1);
                                    this.engine.inputManager?.showMessage(`${other.getNameWithArticle(true)} takes ${Math.abs(value)} ${statCapitalized} damage from ${hazard.getNameWithArticle()}!`, { x: other.x, y: other.y });
                                }

                                // Check for death from health damage
                                if (key === 'health' && stat.current <= 0) {
                                    other.die();
                                }
                            }
                        }
                    }

                    // Flash the victim if there was negative health effect
                    if (collisionEffect.health && collisionEffect.health < 0) {
                        other.flash?.();
                    }
                }

                // Apply state if cloud has apply_state (paralysis, confusion, etc.)
                const applyStateValue = hazard.getAttribute('apply_state');
                if (applyStateValue && other.applyAuthoredState) {
                    other.applyAuthoredState(applyStateValue, { source: hazard });
                }
            }
        }

        // Update sidebar to reflect damage
        this.engine.interfaceManager?.updateSidebar();
    }

    /**
     * Spawn a decorative entity from entities.json
     * @param {string} entityType - The entity type key from entities.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Entity|null} The spawned entity or null if type not found
     */
    spawnEntity(entityType, x, y, overrides = null) {
        const entityData = this.engine.globalEntities?.[entityType];
        if (!entityData) {
            console.warn(`Entity type '${entityType}' not found in entities.json`);
            return null;
        }

        const entity = new Entity(x, y, entityType, this.engine);
        entity.name = entityData.name || entityType;

        // Set tint
        entity.tint = parseTint(entityData.tint);

        // Set fill color if specified (for entities like blood that are just colored fills)
        entity.fillColor = entityData.fillColor ? parseTint(entityData.fillColor) : null;

        // Resolve tile index
        entity.tileIndex = this.engine.spriteLibrary.resolveTile(entityData.tileIndex);

        // Apply attributes
        if (entityData.attributes) {
            for (const [key, value] of Object.entries(entityData.attributes)) {
                entity.setAttribute(key, value);
            }
        }

        // Optional per-instance overrides, such as a saved entity being restored.
        // fillColor and tileIndex can't be overridden — they always come from
        // entities.json, so editing that file also updates existing saves.
        if (overrides) {
            if (overrides.name !== undefined) entity.name = overrides.name;
            if (overrides.tint !== undefined && overrides.tint !== null) entity.tint = overrides.tint;
            if (overrides.attributes) {
                for (const [key, value] of overrides.attributes) {
                    entity.setAttribute(key, value);
                }
            }
        }

        // Create sprite
        this.engine.renderer?.createEntitySprite(entity);

        // Add to entities list
        this.entities.push(entity);

        return entity;
    }

    spawnLiquidTrack(x, y, tint, entryDir, exitDir) {
        const tileName = this.getLiquidTrackTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.getTileByName(tileName);
        if (!tileIndex) return null;

        const entity = new Entity(x, y, 'liquid_track', this.engine);
        entity.name = 'tracks';
        entity.tint = tint;
        entity.fillColor = null;
        entity.tileIndex = tileIndex;
        entity.setAttribute('visible', true);
        entity._trackEntryDir = entryDir;
        entity._trackExitDir = exitDir;

        this.engine.renderer?.createEntitySprite(entity);
        this.entities.push(entity);
        return entity;
    }

    getLiquidTrackTileName(entryDir, exitDir) {
        if (!entryDir && !exitDir) return 'WHITE_DOTTED_BOX_HORIZONTAL';
        if (!entryDir) {
            return (exitDir === 'up' || exitDir === 'down')
                ? 'WHITE_DOTTED_BOX_VERTICAL' : 'WHITE_DOTTED_BOX_HORIZONTAL';
        }
        if (!exitDir) {
            return (entryDir === 'up' || entryDir === 'down')
                ? 'WHITE_DOTTED_BOX_VERTICAL' : 'WHITE_DOTTED_BOX_HORIZONTAL';
        }
        const reverseDir = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
        const connectFrom = reverseDir[entryDir];
        const connectTo = exitDir;
        const connections = [connectFrom, connectTo].sort().join('-');
        const tileMap = {
            'down-up': 'WHITE_DOTTED_BOX_VERTICAL',
            'left-right': 'WHITE_DOTTED_BOX_HORIZONTAL',
            'left-up': 'WHITE_DOTTED_BOX_BOTTOM_RIGHT',
            'right-up': 'WHITE_DOTTED_BOX_BOTTOM_LEFT',
            'down-left': 'WHITE_DOTTED_BOX_TOP_RIGHT',
            'down-right': 'WHITE_DOTTED_BOX_TOP_LEFT'
        };
        return tileMap[connections] || 'WHITE_DOTTED_BOX_HORIZONTAL';
    }

    updateLiquidTrackTile(entity, entryDir, exitDir) {
        const tileName = this.getLiquidTrackTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.getTileByName(tileName);
        if (!tileIndex || !entity.sprite) return;
        entity.tileIndex = tileIndex;
        entity._trackEntryDir = entryDir;
        entity._trackExitDir = exitDir;
        const tileset = PIXI.Loader.shared.resources.tiles;
        const rect = new PIXI.Rectangle(
            tileIndex.x * globalVars.TILE_WIDTH,
            tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        entity.sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
    }

    /**
     * Spawn an item at a specific location
     * @param {string} itemType - The item type key from items.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Item|null} The spawned item or null if item type not found
     */
    spawnItem(itemType, x, y) {
        const itemData = this.engine.currentPrototype.getItemData(itemType);
        if (!itemData) {
            console.warn(`Item type '${itemType}' not found`);
            return null;
        }

        const item = new Item(x, y, itemData.id || itemType, itemData, this.engine);
        this.addEntity(item);

        return item;
    }

    serializeEntities() {
        return this.entities.map(e => e.serialize());
    }
    
    deserializeEntities(data) {
        for (const entityData of data) {
            if (entityData.isActor) {
                const actorDef = this.engine.currentPrototype.getActorData(entityData.type);
                if (!actorDef) continue;
                const actor = new Actor(entityData.x, entityData.y, entityData.type, actorDef, this.engine);
                actor.deserialize(entityData);
                this.addEntity(actor);
            } else if (entityData.isItem) {
                const itemDef = this.engine.currentPrototype.getItemData(entityData.type);
                if (!itemDef) continue;
                const item = new Item(entityData.x, entityData.y, entityData.type, itemDef, this.engine);
                item.deserialize(entityData);
                this.addEntity(item);
            } else if (entityData.isEntity) {
                // Plain decorative entities: rubble, moss, blood. spawnEntity adds it
                // to this.entities and makes the sprite, so don't call addEntity too.
                // liquid_track has no entities.json entry and is dropped here.
                this.spawnEntity(entityData.type, entityData.x, entityData.y, entityData);
            }
        }
    }
    
    cleanup() {
        this.entities.forEach(entity => {
            if (entity instanceof Actor) {
                if (entity.spriteBase) entity.spriteBase.destroy();
                if (entity.spriteTop) entity.spriteTop.destroy();
                if (entity.spriteSide) entity.spriteSide.destroy();
                // Clean up equipment sprites
                if (entity.spriteEquipment) {
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (entity.spriteEquipment[slot]) entity.spriteEquipment[slot].destroy();
                    }
                }
            } else if (entity.sprite) {
                entity.sprite.destroy();
            }
        });
        this.entities = [];
        this.actors = [];
        this.items = [];
        this.spawnedItemTypes = new Set();
        this.player = null;
        // Unindex old-floor actors so a later move can't file them into the next
        // floor's position map (the player is re-added, which re-indexes it).
        for (const a of this._actorPosCache?.values() ?? []) {
            for (const actor of a) actor._posKey = undefined;
        }
        this._actorPosCache = null;
        this._liquidPosCache = null;
        this._solidPosCache = null;
    }
}

installMethods(EntityManager, EntityManagerSpawning, EntityManagerQueries);

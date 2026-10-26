/**
 * DungeonEngine methods: saving and restoring floor state, floor transitions,
 * falling to the next floor (actors, items, stair followers) and cleanup.
 */

import { findAdjacentWalkable } from '../../core/pathfinding.js';
import { Actor } from '../actor/actor.js';
import { Item } from '../item.js';

export const DungeonEnginePersistence = {
    saveGameState() {
        return {
            player: this.entityManager.player.serialize(),
            entities: this.entityManager.serializeEntities(),
            map: this.mapManager.serializeMap()
        };
    },

    restoreGameState(state) {
        this.entityManager.player.deserialize(state.player);
        this.entityManager.deserializeEntities(state.entities);
        this.mapManager.deserializeMap(state.map);
    },

    /**
     * Save the current floor state (entities + map) for later restoration
     * Excludes the player entity since player carries across floors
     */
    saveFloorState() {
        const entities = this.entityManager.serializeEntities();
        const map = this.mapManager.serializeMap();
        // Exclude player from saved entities (player carries across floors)
        const nonPlayerEntities = entities.filter(e => e.type !== 'player');
        // Carry exploration across the round trip. restoreFloor builds a fresh
        // LightingManager, whose initialize() zeroes exploredMap — so without this a
        // revisited floor re-fogs entirely, discarding both walked-over ground and a
        // magic-mapped reveal. Copy the rows; the live arrays get reused/cleared.
        const explored = this.lightingManager?.exploredMap;
        this.floorStates.set(this.currentFloor, {
            entities: nonPlayerEntities,
            map,
            explored: explored ? explored.map(row => row.slice()) : null,
            rngState: typeof ROT !== 'undefined' ? ROT.RNG.getState() : null
        });
    },

    /**
     * Transition to a different floor within the same prototype
     * @param {number} targetFloor - 1-indexed target floor number
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    async transitionToFloor(targetFloor, entryDirection) {
        console.log(`Transitioning from floor ${this.currentFloor} to floor ${targetFloor}`);

        // Fill descent holes back in first, so the saved floor keeps its ground
        this.entityManager?.closeAllTemporaryHoles();

        // Save current floor state
        this.saveFloorState();

        // Save player state before cleanup
        const playerState = this.entityManager.player?.serialize();

        // Clean up current floor (entities, map, renderer — keep Prototype, assets)
        this.cleanupFloor();

        this.currentFloor = targetFloor;

        if (this.floorStates.has(targetFloor)) {
            // Restore previously visited floor
            await this.restoreFloor(targetFloor, playerState, entryDirection);
        } else {
            // Load fresh floor
            await this.loadFloor(targetFloor, entryDirection, playerState);
        }
    },

    /** Whether there's a floor below this one to fall to. */
    hasFloorBelow() {
        const totalFloors = this.getTotalFloors();
        return totalFloors > 1 && this.currentFloor < totalFloors;
    },

    async fallToNextFloor(actor, cause = 'void') {
        const targetFloor = this.currentFloor + 1;
        const fallDamage = Math.floor(actor.stats?.health?.max * 0.3) || 10;
        console.log(`${actor.name} falls to floor ${targetFloor}, taking ${fallDamage} damage`);

        this.playSound?.(cause === 'collapse' ? 'push1' : 'ouch');
        await this.transitionToFloor(targetFloor, 'from_fall');

        const player = this.entityManager?.player;
        if (player) {
            player.modifyStat('health', -fallDamage);
            this.inputManager?.showMessage(`You crash down, injured from the fall! (-${fallDamage} health)`);
            if (player.stats?.health?.current <= 0) {
                player.die();
            }
        }
    },

    spawnPendingFallenActors() {
        const pending = this.pendingFallenActors.get(this.currentFloor);
        if (!pending || pending.length === 0) return;

        const walkableTiles = this.mapManager.walkableTiles;

        for (const data of pending) {
            const fallDamage = data._fallDamage || 0;
            delete data._fallDamage;

            const available = walkableTiles.filter(t =>
                !this.entityManager.getActorAt(t.x, t.y)
            );
            if (available.length === 0) continue;

            const tile = available[Math.floor(ROT.RNG.getUniform() * available.length)];
            const actorData = this.currentPrototype.getActorData(data.type);
            if (!actorData) continue;

            const actor = new Actor(tile.x, tile.y, data.type, actorData, this);
            actor.deserialize(data);
            actor.x = tile.x;
            actor.y = tile.y;
            this.entityManager.addEntity(actor);
            this.renderer?.createActorSprites(actor);

            if (fallDamage > 0 && actor.stats?.health) {
                actor.modifyStat('health', -fallDamage);
                if (actor.stats.health.current <= 0) {
                    actor.die();
                    continue;
                }
            }

            console.log(`${actor.name} landed from above at (${tile.x}, ${tile.y})`);
        }

        this.pendingFallenActors.delete(this.currentFloor);
    },

    /**
     * Send a loose (thrown/dropped) item through a void tile to the floor below.
     * Mirrors Actor.fall: if a floor exists below, the item is queued to reappear
     * on that floor's ground (spawnPendingFallenItems); otherwise it is lost.
     * The item is NOT added to the current floor.
     * @param {Item} item - The item that landed on a void tile
     * @returns {boolean} True if the item fell to a floor below; false if lost to the void
     */
    itemFallsToNextFloor(item) {
        const totalFloors = this.getTotalFloors();
        const hasFloorBelow = totalFloors > 1 && this.currentFloor < totalFloors;

        if (!hasFloorBelow) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            console.log(`${displayName} was lost to the void`);
            return false;
        }

        const targetFloor = this.currentFloor + 1;
        const serialized = item.serialize();
        if (!this.pendingFallenItems.has(targetFloor)) {
            this.pendingFallenItems.set(targetFloor, []);
        }
        this.pendingFallenItems.get(targetFloor).push(serialized);
        return true;
    },

    /**
     * Place items that fell from the floor above onto the newly-loaded floor's ground.
     * Mirrors spawnPendingFallenActors. Called right after it during floor load.
     */
    spawnPendingFallenItems() {
        const pending = this.pendingFallenItems.get(this.currentFloor);
        if (!pending || pending.length === 0) return;

        const walkableTiles = this.mapManager.walkableTiles;

        for (const data of pending) {
            const itemData = this.currentPrototype?.getItemData(data.type);
            if (!itemData) continue;

            // Prefer a walkable tile with no item already on it; fall back to any walkable tile.
            const available = walkableTiles.filter(t =>
                !this.entityManager.items.some(i => i.x === t.x && i.y === t.y)
            );
            const pool = available.length > 0 ? available : walkableTiles;
            if (pool.length === 0) continue;

            const tile = pool[Math.floor(ROT.RNG.getUniform() * pool.length)];
            const item = new Item(tile.x, tile.y, data.type, itemData, this);
            item.deserialize(data);
            item.x = tile.x;
            item.y = tile.y;
            this.entityManager.addEntity(item);

            console.log(`${item.getDisplayName ? item.getDisplayName() : item.name} landed from above at (${tile.x}, ${tile.y})`);
        }

        this.pendingFallenItems.delete(this.currentFloor);
    },

    /**
     * Place monsters that chased the player through a stairway onto the newly-entered
     * floor. Mirrors spawnPendingFallenActors, with two differences: no fall damage, and
     * placement is next to the player rather than a random tile — a follower that landed
     * across the map wouldn't read as having followed at all.
     *
     * Must run after the player is placed (restorePlayerOnFloor / spawnPlayerAtStairway)
     * and before initializeTurnEngine(), which rebuilds the scheduler from
     * entityManager.actors and so picks these up automatically.
     */
    spawnPendingStairFollowers() {
        const pending = this.pendingStairFollowers.get(this.currentFloor);
        if (!pending || pending.length === 0) return;

        const player = this.entityManager.player;
        const walkableTiles = this.mapManager.walkableTiles;
        const placed = [];

        for (const data of pending) {
            const actorData = this.currentPrototype.getActorData(data.type);
            if (!actorData) continue;

            // Beside the player first, then beside the arrival stairway, then anywhere
            // free — so a follower always lands somewhere legal even on a cramped floor.
            let tile = player ? findAdjacentWalkable(player, this.entityManager) : null;

            if (!tile) {
                for (const dir of ['up', 'down']) {
                    const stairway = this.entityManager.findActorByAttribute('stairway', dir);
                    if (!stairway) continue;
                    tile = findAdjacentWalkable(stairway, this.entityManager);
                    if (tile) break;
                }
            }

            if (!tile) {
                const available = walkableTiles.filter(t =>
                    !this.entityManager.getActorAt(t.x, t.y)
                );
                if (available.length === 0) continue;
                tile = available[Math.floor(ROT.RNG.getUniform() * available.length)];
            }

            const actor = new Actor(tile.x, tile.y, data.type, actorData, this);
            actor.deserialize(data);
            actor.x = tile.x;
            actor.y = tile.y;
            this.entityManager.addEntity(actor);
            // Plural: createActorSprites builds the base/top pair and assigns them to
            // the actor. The singular createActorSprite is the low-level helper it calls,
            // and takes a tile index and position — passing it just the actor makes no
            // visible sprite.
            this.renderer?.createActorSprites(actor);

            // Restore the hunt. serialize() carries no AI memory, so without this the
            // follower would arrive and idle — and in darkness canSeeTarget clamps its
            // range to 1.5, so it can't always re-acquire on its own.
            if (player) {
                actor._alerted = true;
                actor._alertTarget = player;
                actor._alertTurns = actor.personality?.data?.memory_duration || 10;
                actor._lastKnownTargetX = player.x;
                actor._lastKnownTargetY = player.y;
            }

            placed.push(actor);
            console.log(`${actor.name} followed the player to floor ${this.currentFloor} at (${tile.x}, ${tile.y})`);
        }

        if (placed.length === 1) {
            this.inputManager?.showMessage(
                `The ${placed[0].name} follows you!`, { x: placed[0].x, y: placed[0].y }
            );
        } else if (placed.length > 1) {
            this.inputManager?.showMessage('You are followed!', { style: 'warning' });
        }

        this.pendingStairFollowers.delete(this.currentFloor);
    },

    /**
     * Clean up the current floor without destroying the app/renderer framework
     * Preserves prototype, assets, and audio — clears entities, map, and rendering
     */
    cleanupFloor() {
        if (this.turnEngine) {
            this.turnEngine.lock();
        }

        if (this.scheduler) {
            this.scheduler.clear();
        }

        if (this.entityManager) {
            this.entityManager.cleanup();
        }

        if (this.mapManager) {
            this.mapManager.cleanup();
        }

        if (this.renderer) {
            this.renderer.clear();
        }

        if (this.interfaceManager) {
            this.interfaceManager.clear();
        }

        if (this.app) {
            this.app.destroy(true, { children: true, texture: false, baseTexture: false });
            this.app = null;
            this.renderer = null;
            this.interfaceManager = null;
        }

        if (this.lightingManager) {
            this.lightingManager = null;
        }
        this._runtimeDarknessActive = false; // runtime FOV belonged to the torn-down floor

        // Reset viewport state
        this.viewportEnabled = false;
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;
    },
    
    cleanup() {

        if (this.turnEngine) {
            this.turnEngine.lock();
        }

        if (this.scheduler) {
            this.scheduler.clear();
        }

        if (this.entityManager) {
            this.entityManager.cleanup();
        }

        if (this.mapManager) {
            this.mapManager.cleanup();
        }

        if (this.renderer) {
            this.renderer.clear();
        }

        if (this.interfaceManager) {
            this.interfaceManager.clear();
        }

        if (this.app) {
            this.app.destroy(true, { children: true, texture: false, baseTexture: false });
            this.app = null;
            this.renderer = null;
            this.interfaceManager = null;
        }

        if (this.lightingManager) {
            this.lightingManager = null;
        }
        this._runtimeDarknessActive = false; // runtime FOV belonged to the torn-down floor

        // Reset viewport state
        this.viewportEnabled = false;
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;

        // Reset floor state
        this.currentFloor = 1;
        this.floorStates.clear();
        this.pendingFallenActors.clear();
        this.pendingFallenItems.clear();
        this.pendingStairFollowers.clear();
        this.sealedDownFloors.clear();
        this.mappedFloors.clear();
    },
};

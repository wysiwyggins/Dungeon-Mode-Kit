/**
 * DungeonEngine methods: using portals and stairways (with followers), tile
 * visibility queries, searching, and placing stairways, escape exits and portals.
 */

import { getChebyshevDistance, hasLineOfSight } from '../../core/pathfinding.js';
import {
    MAX_STAIR_FOLLOWERS,
    STAIRWAY_MIN_SEPARATION,
    parseTint,
    randomElement
} from '../../core/util.js';
import { Actor } from '../actor/actor.js';

export const DungeonEngineStairways = {
    /**
     * Step through a portal to the next prototype.
     * Called when a player actor walks onto a revealed portal.
     */
    async usePortal() {
        const config = this.currentPrototype.config;
        if (!config.next_level) return;

        console.log(`Using portal to transition to ${config.next_level}`);
        this.floorStates.clear();
        this.pendingFallenActors.clear();
        this.pendingFallenItems.clear();
        this.pendingStairFollowers.clear();
        this.mappedFloors.clear();
        this.currentFloor = 1;
        await this.transitionToPrototype(config.next_level, true, 'from_above');
    },

    /**
     * Gather adjacent hunters that should chase the player onto the next floor.
     *
     * Must run BEFORE transitionToFloor, because saveFloorState() serializes every
     * non-player entity into floorStates — a follower still standing on the departing
     * floor would be cached there *and* carried forward, so it would appear twice.
     *
     * Followers leave via removeEntity rather than die(false) (which fall() uses): die()
     * still announces a death, plays death_sound, and drops the actor's whole inventory,
     * none of which should happen to something that merely walked downstairs.
     *
     * No opt-in flag: an actor standing next to the player and aware of them at the
     * moment the player takes the stairs *is* pursuing — the adjacency is the evidence.
     * A separate attribute would only restate what the situation already proves, and
     * would leave every newly-added hostile silently unable to follow.
     *
     * @param {number} targetFloor - 1-indexed floor the player is heading to
     * @returns {number} How many followers were queued
     */
    gatherStairFollowers(targetFloor) {
        const player = this.entityManager?.player;
        if (!player) return 0;

        const candidates = this.entityManager.actors.filter(actor =>
            actor !== player &&
            !actor.isDead &&
            actor.personality?.hostile &&
            !actor.hasAttribute('controlled') &&
            // Segmented creatures (the scutigera) can't cross a floor. Their parts are
            // joined by live object references (_chainPrev/_chainNext/_chainHead) that
            // serialize() can't carry, and the chain is only rebuilt by
            // spawnChainCreatures() — which runs earlier in loadFloor() than this drain,
            // and not at all in restoreFloor(). So a body segment would arrive linked to
            // a destroyed actor, and a head would arrive permanently bodiless. Excluding
            // the whole creature keeps it on its own floor, intact.
            // (The same gap exists for a scutigera that falls; left alone here.)
            !actor._chainHead &&
            getChebyshevDistance(actor.x, actor.y, player.x, player.y) <= 1 &&
            // Aware of its quarry: either provoked, or it can see the player right now.
            // Without this a monster that merely happens to be standing beside the
            // stairs (asleep, or wandering past) would tag along.
            (actor._alerted || actor.canSeeTarget(player))
        );

        if (candidates.length === 0) return 0;

        // Nearest first, capped: arriving beside a whole pack with no room to retreat is
        // an unfair death, not a tense one.
        candidates.sort((a, b) =>
            getChebyshevDistance(a.x, a.y, player.x, player.y) -
            getChebyshevDistance(b.x, b.y, player.x, player.y)
        );

        const followers = candidates.slice(0, MAX_STAIR_FOLLOWERS);

        if (!this.pendingStairFollowers.has(targetFloor)) {
            this.pendingStairFollowers.set(targetFloor, []);
        }

        for (const actor of followers) {
            // serialize() drops the AI's memory fields, so a deserialized follower would
            // arrive with a blank slate and idle beside the player. The hunt intent is
            // reapplied on arrival instead — see spawnPendingStairFollowers().
            this.pendingStairFollowers.get(targetFloor).push(actor.serialize());
            this.entityManager.removeEntity(actor);
            console.log(`${actor.name} follows the player to floor ${targetFloor}`);
        }

        return followers.length;
    },

    /**
     * Use a stairway to transition to another level
     * @param {string} direction - 'up' or 'down'
     */
    async useStairway(direction) {
        const config = this.currentPrototype.config;

        // Multi-floor when the prototype has explicit floors (biomes) or a levels[]
        // array; otherwise legacy cross-prototype stairways.
        const isMultiFloor = config.floors != null || !!config.levels;
        if (!isMultiFloor) {
            // LEGACY: stairways go between prototypes (unchanged behavior)
            let targetLevel = null;

            if (direction === 'down' && config.next_level) {
                targetLevel = config.next_level;
            } else if (direction === 'up' && config.previous_level) {
                targetLevel = config.previous_level;
            }

            if (targetLevel) {
                console.log(`Using stairway ${direction} to ${targetLevel}`);
                const entryDirection = direction === 'down' ? 'from_above' : 'from_below';
                await this.transitionToPrototype(targetLevel, true, entryDirection);
            } else if (direction === 'up' && config.win_state) {
                // Dead-end up-stairway on a single-level prototype IS the exit. It only
                // became walkable because unlockWinConditionStairways() opened it, which
                // only happens once the win condition held (and unequipping re-seals it),
                // so reaching it is proof of victory — no need to re-check conditions.
                this.triggerGameWin();
            } else {
                console.log(`No ${direction === 'down' ? 'next' : 'previous'} level configured`);
            }
            return;
        }

        // NEW: stairways go between floors within the prototype
        const totalFloors = this.getTotalFloors();
        if (direction === 'down' && this.currentFloor < totalFloors) {
            this.gatherStairFollowers(this.currentFloor + 1);
            await this.transitionToFloor(this.currentFloor + 1, 'from_above');
        } else if (direction === 'up') {
            if (this.currentFloor > 1) {
                this.gatherStairFollowers(this.currentFloor - 1);
                await this.transitionToFloor(this.currentFloor - 1, 'from_below');
            } else if (config.previous_level) {
                await this.transitionToPrototype(config.previous_level, true, 'from_below');
            } else if (config.win_state) {
                // Top floor with nowhere above and a win_state: the up-stairway is the
                // exit. Entering it wins (same rationale as the single-level branch — the
                // stairway is only walkable because the win condition unlocked it). The
                // dungeon's floor-1 escape exit stays solid/locked, so it's bumped (see
                // the locked-stairway path), never walked onto, and never reaches here.
                this.triggerGameWin();
            }
        }
    },

    /**
     * Check if a tile is visible to the player
     * Returns true if darkness is disabled (lit prototype) or if the tile is within view
     * @param {number} x - Tile x coordinate
     * @param {number} y - Tile y coordinate
     * @returns {boolean} True if the tile is visible or darkness is disabled
     */
    isTileVisible(x, y) {
        return this.lightingManager ? this.lightingManager.isVisible(x, y) : true;
    },

    /**
     * Check if a tile has been explored by the player
     * Returns true if darkness is disabled (lit prototype) or if the tile has been seen
     * @param {number} x - Tile x coordinate
     * @param {number} y - Tile y coordinate
     * @returns {boolean} True if the tile is explored or darkness is disabled
     */
    isTileExplored(x, y) {
        return this.lightingManager ? this.lightingManager.isExplored(x, y) : true;
    },

    /**
     * The active mechanics block: a floor's own settings win over the prototype's,
     * matching how loadFloor resolves viewport and darkness.
     * @returns {Object} Mechanics settings (empty object if none defined)
     */
    getMechanics() {
        // Guarded: getFloorConfig dereferences currentPrototype.config, and this can
        // be reached from input before a prototype has finished loading.
        if (!this.currentPrototype?.config) return {};
        return this.getFloorConfig(this.currentFloor)?.mechanics
            || this.currentPrototype.config.mechanics
            || {};
    },

    /**
     * Look for hidden things around an actor. ]
     * Designers can retune both per prototype or per floor via
     * `mechanics.search_radius` / `mechanics.thorough_search_strength`.
     *
     * @param {Actor} actor - The searcher (normally the player)
     * @param {number} strength - Search strength; 30 is a passive glance, 200 a
     *   deliberate five-turn search
     * @param {number} [maxRadius] - Hard cap on reach, in tiles. Defaults to the
     *   strength-derived radius (Brogue's rule) when omitted.
     * @returns {boolean} True if anything was found
     */
    searchFrom(actor, strength, maxRadius = null) {
        if (!actor || strength <= 0) return false;

        const radius = maxRadius === null
            ? Math.floor(strength / 10)
            : Math.min(Math.floor(strength / 10), maxRadius);
        let foundSomething = false;

        // Sight is blocked by opaque actors, matching LightingManager.visionPasses.
        // The searcher and the thing being searched for are exempt below via
        // hasLineOfSight's endpoint skipping.
        const isBlocked = (x, y) => !!this.entityManager.getSightBlockerAt(x, y);

        // Copy: reveal() can spawn sprites and fire messages, and we don't want a
        // live list mutating underneath the loop.
        for (const other of [...this.entityManager.actors]) {
            if (other === actor || other.isDead) continue;
            if (!other.hasAttribute('hidden')) continue;

            const distance = getChebyshevDistance(actor.x, actor.y, other.x, other.y);
            if (distance > radius) continue;

            // No finding secrets around corners. Deliberately *not* canSeeTarget:
            // that clamps to vision range, which would cap a deep search at how far
            // the actor can see, and it treats the wall a hidden door sits in as
            // unwalkable. Searching is feeling along surfaces, not spotting things.
            // hasLineOfSight skips both endpoints, so the target's own tile — and
            // the wall it may be embedded in — never blocks the path to itself.
            if (!hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) continue;

            let percent = strength - distance * 10;
            if (other.hasAttribute('solid')) {
                percent = Math.floor(percent * 2 / 3);
            }
            if (percent <= 0) continue;

            if (ROT.RNG.getPercentage() <= Math.min(percent, 100)) {
                if (other.reveal()) foundSomething = true;
            }
        }

        return foundSomething;
    },

    /**
     * Spawn the player at the appropriate stairway based on entry direction
     * @param {string|null} entryDirection - 'from_above', 'from_below', or null for direct load
     */
    spawnPlayerAtStairway(entryDirection) {

        if (this.entityManager.player) {
            console.log('Player already exists from map, skipping stairway spawn');
            return;
        }

        // Determine which stairway to spawn at
        // from_above (descended) = spawn at up_stairway (the stairs leading back up)
        // from_below (ascended) = spawn at down_stairway (the stairs leading back down)
        // from_fall = random walkable tile (fell through collapsed floor)
        // direct load = spawn at up_stairway if it exists
        const playerData = this.currentPrototype.getActorData('player');
        if (!playerData) {
            console.error('No player actor data found in prototype');
            return;
        }

        if (entryDirection === 'from_fall' || entryDirection === null) {
            const walkableTiles = this.mapManager.walkableTiles;
            const available = walkableTiles.filter(t => !this.entityManager.getActorAt(t.x, t.y));
            if (available.length > 0) {
                const tile = available[Math.floor(ROT.RNG.getUniform() * available.length)];
                console.log(`Spawning player at random tile (${tile.x}, ${tile.y}) — entry: ${entryDirection}`);
                const player = new Actor(tile.x, tile.y, 'player', playerData, this);
                this.entityManager.addEntity(player);
                player.loadDefaultItems();
                return;
            }
        }

        let targetStairwayType;
        if (entryDirection === 'from_above') {
            targetStairwayType = 'up';
        } else if (entryDirection === 'from_below') {
            targetStairwayType = 'down';
        } else {
            targetStairwayType = 'up';
        }

        const stairway = this.entityManager.findActorByAttribute('stairway', targetStairwayType);

        if (stairway) {
            console.log(`Spawning player at ${targetStairwayType} stairway (${stairway.x}, ${stairway.y})`);
            const player = new Actor(stairway.x, stairway.y, 'player', playerData, this);
            this.entityManager.addEntity(player);
            player.loadDefaultItems();
        } else {
            console.warn(`No ${targetStairwayType} stairway found to spawn player at`);
        }
    },

    /**
     * Pick a tile to place a stairway on.
     *
     * Prefers a wall niche — a room floor tile flush against a wall, where torches go —
     * so stairs read as built into the architecture instead of dropped in the middle of a
     * room or blocking a corridor. Falls back to any free walkable tile when a map has no
     * such niche (a cave with no straight walls, a tiny map, or one already crowded with
     * actors), so placement never fails outright.
     *
     * @returns {{x: number, y: number}|null} The chosen tile, or null if none is free
     */
    /**
     * Which region a stairway should be placed in, if any.
     *
     * `mechanics.up_stairway_region` / `mechanics.down_stairway_region` win when
     * authored, so a designer always has the final say. Otherwise the generator's own
     * suggestion applies: a generator that builds a recognisable entrance knows where
     * the stairs belong better than a uniform random pick does, and shouldn't need
     * every floor using it to repeat the same mechanics line. Setting the mechanic to
     * `null` explicitly opts back out to random placement.
     *
     * @param {'up'|'down'} direction
     * @param {object} floorConfig - resolved floor config (mechanics already merged)
     */
    stairwayRegionFor(direction, floorConfig) {
        const key = `${direction}_stairway_region`;
        const mechanics = floorConfig?.mechanics || {};
        if (key in mechanics) return mechanics[key];
        return this.mapManager?.suggestedStairwayRegions?.[direction] ?? null;
    },

    /**
     * Pick a tile for a stairway, preferring a wall niche so it can be framed with
     * mounted torches.
     *
     * `preferredRegion` names a region the map generator published (see
     * Architect.namedRegions) to place the stairway inside — e.g. 'portico' so the
     * palladian villa's entrance stair lands in the courtyard out front rather than
     * in an interior room. It is a *preference*, not a constraint: a generator that
     * publishes no regions, or a region with no free tile, falls back to the whole
     * map, so this can never leave a floor without its stairs.
     *
     * @param {string|null} preferredRegion - Optional generator-published region name
     */
    pickStairwayTile(preferredRegion = null) {
        const walkableTiles = this.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) return null;

        let availableTiles = walkableTiles.filter(tile => !this.entityManager.getActorAt(tile.x, tile.y));
        if (availableTiles.length === 0) return null;

        // Keep stairways off the lip of a pit. A stairway is a place the player
        // arrives — sometimes mid-fall from the floor above — so putting one where a
        // stray step is fatal reads as a generation accident rather than a design.
        // Also a preference: a bridge-heavy floor might have nothing else.
        const inland = availableTiles.filter(t => !this.entityManager.isAdjacentToVoid(t.x, t.y));
        if (inland.length > 0) {
            availableTiles = inland;
        } else {
            console.log('Every candidate stairway tile borders a void; placing anyway');
        }

        // Keep the two stairways apart. ensureUpStairway runs before
        // ensureDownStairway, so by the time we place the second one the first is
        // already on the map — back away from it rather than landing next door,
        // which makes a floor trivially skippable.
        //
        // Applied as a preference, not a requirement: a tiny or heavily occupied
        // floor may have nothing far enough away, and placing the stairway is more
        // important than spacing it.
        const otherStairway = this.entityManager.findActorByAttribute('stairway', 'up')
            || this.entityManager.findActorByAttribute('stairway', 'down');
        if (otherStairway) {
            const spaced = availableTiles.filter(t =>
                getChebyshevDistance(t.x, t.y, otherStairway.x, otherStairway.y) >= STAIRWAY_MIN_SEPARATION);
            if (spaced.length > 0) {
                availableTiles = spaced;
            } else {
                console.log('No tile far enough from the other stairway; placing without spacing');
            }
        }

        // Try the preferred region first, then the whole map. Within each, a wall
        // niche wins over open floor.
        const pools = [];
        if (preferredRegion) {
            const region = this.mapManager.namedRegions?.[preferredRegion];
            if (region?.length) {
                const inRegion = new Set(region.map(t => `${t.x},${t.y}`));
                const regionTiles = availableTiles.filter(t => inRegion.has(`${t.x},${t.y}`));
                if (regionTiles.length > 0) pools.push({ name: preferredRegion, tiles: regionTiles });
            }
        }
        pools.push({ name: 'map', tiles: availableTiles });

        for (const pool of pools) {
            const niches = pool.tiles.filter(t => this.entityManager.isWallNicheTile(t.x, t.y));
            if (niches.length === 0) continue;
            if (pool.name !== 'map') console.log(`Stairway placed in the "${pool.name}" region`);
            // Among niches, prefer one that can actually be framed with torches.
            // Some niches are geometric accidents — a gap in a colonnade reads as a
            // 3-neighbour tile but has ornaments, not plain wall, to either side — and
            // a stairway there ends up unframed.
            const framed = niches.filter(t => this.canFlankStairwayAt(t.x, t.y));
            return randomElement(framed.length > 0 ? framed : niches);
        }

        // No niche anywhere: take open floor, still preferring the region.
        console.log('No wall-niche tile available for stairway; falling back to open floor');
        return randomElement(pools[0].tiles);
    },

    /**
     * Flank a stairway with mounted torches, the way an architect would frame a doorway.
     *
     * A stairway in a wall niche has one wall behind it; the two tiles to either side
     * *along* that wall are the sconce positions. Each is only replaced if it's currently
     * a plain wall with nothing on it, so this never eats a door, another stairway, or a
     * corridor mouth — on a stairway that isn't in a niche, usually nothing is placed.
     *
     * @param {Actor} stairway - The freshly-placed stairway
     */
    /**
     * The wall actors either side of the tile a stairway at (x, y) backs onto — the
     * two sconce positions. Shared by flankStairwayWithTorches and by
     * pickStairwayTile, which uses it to prefer a niche that can actually be framed.
     *
     * @returns {Actor[]} 0-2 replaceable wall actors
     */
    stairwaySconceWalls(x, y) {
        const mm = this.mapManager;
        // A usable sconce spot is a non-floor tile occupied by nothing but a plain wall
        // actor, which the torch replaces (the same swap the map generator does for its
        // own wall torches). Walls are spawned as actors before stairways are placed, so
        // requiring an *empty* tile here would find nothing. Anything else standing there
        // — a door, a gate, another stairway — disqualifies the spot.
        const wallActorAt = (wx, wy) => {
            if (wx < 0 || wx >= mm.width || wy < 0 || wy >= mm.height) return null;
            const actors = this.entityManager.getActorsAt(wx, wy).filter(a => !a.isDead);
            if (actors.length !== 1) return null;
            const only = actors[0];
            // Plain static wall only. `pushable` excludes puzzle walls, `openable`
            // excludes doors/gates, and requiring `paint_tile` keeps this to the wall
            // types the generator paints into wall runs.
            if (only.hasAttribute('pushable') || only.hasAttribute('openable')) return null;
            if (only.hasAttribute('stairway') || !only.hasAttribute('solid')) return null;
            // `ornament` marks a solid that is deliberately placed architecture — a
            // colonnade column, a window grille. Those carry a paint_tile like any
            // wall, but swapping one for a torch would eat the very structure a
            // generator just built. This also keeps the pass off the generator's own
            // wall torches, which are ornaments too.
            if (only.hasAttribute('ornament')) return null;
            return only.getAttribute('paint_tile') ? only : null;
        };

        // Locate the wall the stairway backs onto, then step along that wall in both
        // directions. The sconces are the two wall tiles either side of the stairway's
        // own backing tile — e.g. a stairway with wall above gets torches at the wall
        // tiles up-left and up-right of it, framing the stairs.
        //
        // "Backs onto a wall" must be decided by what stands on the tile, NOT by
        // floorMap: generators give wall tiles a floorMap entry too (a wall sits *on*
        // a floor tile), so a floorMap test finds no wall anywhere and no torch is
        // ever placed.
        const back = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]
            .find(d => wallActorAt(x + d.dx, y + d.dy));
        if (!back) return []; // no mountable wall behind it — nothing to frame

        // Walk perpendicular to the wall normal: a vertical normal means a horizontal run.
        const along = back.dx === 0 ? { dx: 1, dy: 0 } : { dx: 0, dy: 1 };
        return [
            wallActorAt(x + back.dx - along.dx, y + back.dy - along.dy),
            wallActorAt(x + back.dx + along.dx, y + back.dy + along.dy)
        ].filter(Boolean);
    },

    /** Whether a stairway at (x, y) could be framed with torches on both sides. */
    canFlankStairwayAt(x, y) {
        return this.stairwaySconceWalls(x, y).length === 2;
    },

    flankStairwayWithTorches(stairway) {
        const torchData = this.currentPrototype.getActorData('wall_torch');
        if (!torchData) return;

        const { x, y } = stairway;
        let placed = 0;
        for (const wall of this.stairwaySconceWalls(x, y)) {
            const pos = { x: wall.x, y: wall.y };
            this.entityManager.removeEntity(wall);
            this.entityManager.addEntity(new Actor(pos.x, pos.y, 'wall_torch', torchData, this));
            placed++;
        }
        if (placed) this.entityManager.invalidateActorPosCache();
        if (placed) console.log(`Flanked stairway at (${x}, ${y}) with ${placed} mounted torch(es)`);
    },

    /**
     * Ensure an up_stairway exists, spawning one randomly if needed
     * This is called after wildcard processing to place stairways in generated areas
     * If the prototype has no previous_level, spawns a locked_up_stairway instead
     */
    ensureUpStairway() {
        // Don't place an up stairway on the top floor of a prototype if there's nowhere to go.
        // Exception: an escape-style win_state turns the top floor's up-stairway into the
        // (locked) escape exit, so we fall through and spawn it.
        const isTopFloor = this.getTotalFloors() <= 1 || this.currentFloor === 1;
        const escapeExit = this.isEscapeExitFloor(this.currentFloor);
        if (isTopFloor && !this.currentPrototype.config.previous_level && !escapeExit) {
            return;
        }

        // Check if an up_stairway already exists (e.g. authored in the map). If this is the
        // escape-exit floor, convert that authored stairway into the locked escape exit in
        // place — so designers can position the exit on the map and it's still gated by the
        // amulet (and not walkable straight through off the map edge).
        const existingStairway = this.entityManager.findActorByAttribute('stairway', 'up');
        if (existingStairway) {
            if (escapeExit) {
                this.makeEscapeExit(existingStairway);
                console.log('Converted authored up stairway to escape exit at', existingStairway.x, existingStairway.y);
            } else {
                console.log('Up stairway already exists at', existingStairway.x, existingStairway.y);
            }
            return;
        }

        // No up_stairway found - place one against a wall (see pickStairwayTile).
        const floorConfig = this.getFloorConfig(this.currentFloor);
        const tile = this.pickStairwayTile(this.stairwayRegionFor('up', floorConfig));
        if (!tile) {
            console.warn('No available tiles to place up_stairway');
            return;
        }

        // The escape exit is always a locked stairway (the down-seal logic below is
        // meaningless on the top floor — there is no floor below it). Otherwise this
        // up-stairway leads up to the previous floor: lock it iff that floor's down-way
        // is sealed (its win conditions unmet), so a player who fell down can't walk back
        // up to bypass the quest — the locked pair of the previous floor's
        // locked_down_stairway.
        const stairwayType = escapeExit
            ? 'locked_up_stairway'
            : (this.isFloorDownSealed(this.currentFloor - 1) ? 'locked_up_stairway' : 'up_stairway');

        // Get the stairway actor data
        const stairwayData = this.currentPrototype.getActorData(stairwayType);
        if (!stairwayData) {
            console.warn(`No ${stairwayType} actor data found`);
            return;
        }

        // Spawn the stairway
        const stairway = new Actor(tile.x, tile.y, stairwayType, stairwayData, this);
        if (escapeExit) this.makeEscapeExit(stairway);
        this.entityManager.addEntity(stairway);
        this.flankStairwayWithTorches(stairway);
        console.log(`Spawned ${stairwayType} at (${tile.x}, ${tile.y})`);
    },

    /**
     * Turn an up-stairway actor into the locked escape exit: lock it (so the player can't
     * walk through it, only bump it) and give it amulet-specific rejection text. Used for
     * both authored (map-placed) and procedurally-spawned exits so they behave identically.
     */
    makeEscapeExit(stairway) {
        if (!stairway) return;
        // solid so the player bumps (and is gated/wins) rather than walking onto the tile —
        // matches how applyStairwayLockState locks a stairway.
        stairway.setAttribute('solid', true);
        stairway.setAttribute('openable', true);
        stairway.setAttribute('open', false);
        stairway.setAttribute('locked', true);
        stairway.setAttribute('collision_description', 'The exit is sealed. You need the Amulet of Yendor.');
        // Mark it so the per-floor win-condition lock/unlock system leaves it alone — the
        // escape exit is gated by the prototype win_state (the amulet), not the floor's
        // win_conditions, so it must not unlock when the floor's conditions are met.
        stairway.setAttribute('escape_exit', true);

        // Adopt the sealed-stairs look so a plain authored up_stairway renders as the locked
        // exit (designers can place either type and get the right sprite). Pull the resolved
        // tiles/tint from the locked_up_stairway definition and refresh the live sprites.
        const lockedData = this.currentPrototype.getActorData('locked_up_stairway');
        if (lockedData) {
            const lib = this.spriteLibrary;
            stairway.name = lockedData.name || stairway.name;
            if (lockedData.tint) stairway.tint = parseTint(lockedData.tint);
            stairway.tileIndexBase = lib.resolveTile(lockedData.tileIndexBase) || stairway.tileIndexBase;
            stairway.tileIndexTop = lib.resolveTile(lockedData.tileIndexTop) || stairway.tileIndexTop;
            stairway.tileIndexBase_open = lib.resolveTile(lockedData.tileIndexBase_open) || stairway.tileIndexBase_open;
            stairway.tileIndexTop_open = lib.resolveTile(lockedData.tileIndexTop_open) || stairway.tileIndexTop_open;
            // Push the closed (sealed) textures to the on-screen sprites now.
            this.renderer?.updateSpriteTexture(stairway.spriteBase, stairway.tileIndexBase);
            this.renderer?.updateSpriteTexture(stairway.spriteTop, stairway.tileIndexTop);
            if (stairway.spriteBase && stairway.tint != null) stairway.spriteBase.tint = stairway.tint;
            if (stairway.spriteTop && stairway.tint != null) stairway.spriteTop.tint = stairway.tint;
        }
    },

    /**
     * Ensure a down_stairway exists on the current floor
     * Used in multi-level prototypes for non-final floors
     */
    ensureDownStairway() {
        const existingStairway = this.entityManager.findActorByAttribute('stairway', 'down');
        if (existingStairway) {
            console.log('Down stairway already exists at', existingStairway.x, existingStairway.y);
            // Record seal state from the existing (e.g. authored) stairway's locked status,
            // so the paired up-stairway on floor N+1 matches even when we didn't spawn it.
            this.updateDownSealFromStairway(existingStairway);
            return;
        }

        const floorConfig = this.getFloorConfig(this.currentFloor);
        const tile = this.pickStairwayTile(this.stairwayRegionFor('down', floorConfig));
        if (!tile) {
            console.warn('No available tiles to place down_stairway');
            return;
        }

        const hasWinConditions = floorConfig.win_conditions && floorConfig.win_conditions.length > 0;
        const stairwayType = hasWinConditions ? 'locked_down_stairway' : 'down_stairway';

        // Record whether this floor's down-way starts sealed, so the paired up-stairway
        // on floor N+1 can be locked to match (the locked-pair source of truth).
        this.setDownSeal(this.currentFloor, hasWinConditions);

        const stairwayData = this.currentPrototype.getActorData(stairwayType);
        if (!stairwayData) {
            console.warn(`No ${stairwayType} actor data found`);
            return;
        }

        const stairway = new Actor(tile.x, tile.y, stairwayType, stairwayData, this);
        this.entityManager.addEntity(stairway);
        this.flankStairwayWithTorches(stairway);
        console.log(`Spawned ${stairwayType} at (${tile.x}, ${tile.y})`);
    },

    /**
     * Ensure a portal exists on the last floor of a prototype that continues
     * into another one. Placed hidden; setPortalsRevealed() shows it once the
     * floor's win conditions are met.
     */
    ensurePortal() {
        if (this.entityManager.actors.some(a => a.hasAttribute('portal'))) return;

        const walkableTiles = this.mapManager.walkableTiles;
        const availableTiles = walkableTiles?.filter(
            tile => !this.entityManager.getActorAt(tile.x, tile.y)
        );
        if (!availableTiles?.length) {
            console.warn('No available tiles to place portal');
            return;
        }

        const portalData = this.currentPrototype.getActorData('portal');
        if (!portalData) {
            console.warn('No portal actor data found');
            return;
        }

        const tile = randomElement(availableTiles);
        const portal = new Actor(tile.x, tile.y, 'portal', portalData, this);
        this.entityManager.addEntity(portal);
        console.log(`Spawned hidden portal at (${tile.x}, ${tile.y})`);
    },
};

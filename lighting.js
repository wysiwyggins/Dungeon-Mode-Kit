// ============================================================================
// LIGHTING MANAGER
// ============================================================================
// Handles FOV computation, visibility, and light source management
// using ROT.js PreciseShadowcasting

class LightingManager {
    constructor(engine) {
        this.engine = engine;
        this.width = 0;
        this.height = 0;

        this.lightMap = [];
        this.losMap = [];
        this.exploredMap = [];
        this.fov = null;
        this.currentSource = null;

        this.ambientLight = 0.0;
        this.playerLightRadius = 6;

        // Shadow entities cast by actors blocking colored light sources
        this.shadowEntities = new Map(); // "x,y" -> Entity
    }

    initialize(width, height, config = {}) {
        this.width = width;
        this.height = height;

        this.ambientLight = config.ambient_light ?? 0.0;
        this.playerLightRadius = config.player_light_radius ?? 6;
        this.playerAutoLight = config.player_auto_light !== false; // default true

        this.ambientTint = null;
        if (config.tint) {
            const hex = parseInt(config.tint.replace('#', ''), 16);
            this.ambientTint = {
                r: (hex >> 16) & 0xFF,
                g: (hex >> 8) & 0xFF,
                b: hex & 0xFF
            };
        }

        this.lightMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => ({ intensity: 0, r: 0, g: 0, b: 0 }))
        );

        this.visibilityMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => false)
        );

        // Line of sight independent of light: how far into the dark you can make out
        // terrain. Distinct from visibilityMap, which stays "lit AND seen" because ~36
        // gameplay callers key off it (targeting, autoexplore, the sidebar, entity
        // rendering) — a monster standing unlit 25 tiles away must not become a target
        // just because the wall behind it is faintly readable.
        //
        // Stores FOV distance rather than a boolean, as `r + 1` so radius 0 is truthy.
        // getDarknessAlpha ramps on that distance to fade the edge of vision.
        this.losMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => 0)
        );

        this.exploredMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => false)
        );

        this.fov = new ROT.FOV.PreciseShadowcasting((x, y) => this.lightPasses(x, y));
        this.visionFov = new ROT.FOV.PreciseShadowcasting((x, y) => this.visionPasses(x, y));
    }

    /**
     * Re-apply a previously saved exploration map (see Engine.saveFloorState). Revisiting
     * a floor builds a fresh LightingManager, so without this the player's memory of the
     * level — including a magic-mapped reveal — would be lost.
     *
     * Copies cell-by-cell within the overlap rather than adopting the array wholesale, so
     * a saved map from different dimensions can't desync width/height from the live map.
     * Only ORs explored cells on; it never un-explores something already seen.
     *
     * @param {boolean[][]} saved - Saved exploredMap rows
     */
    restoreExplored(saved) {
        if (!Array.isArray(saved) || !this.exploredMap) return;

        const rows = Math.min(saved.length, this.exploredMap.length);
        for (let y = 0; y < rows; y++) {
            const savedRow = saved[y];
            const liveRow = this.exploredMap[y];
            if (!Array.isArray(savedRow) || !liveRow) continue;
            const cols = Math.min(savedRow.length, liveRow.length);
            for (let x = 0; x < cols; x++) {
                if (savedRow[x]) liveRow[x] = true;
            }
        }
    }

    visionPasses(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }

        const actorAtTile = this._solidActorCache?.get(x * 10000 + y);
        if (actorAtTile
                && !actorAtTile.hasAttribute('controlled')
                && actorAtTile.getAttribute('opaque') !== false
                && !actorAtTile.hasStateProperty?.('invisible')) {
            return false;
        }

        return true;
    }

    lightPasses(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }

        // Light source's own tile always passes light
        if (this.currentSource && x === this.currentSource.x && y === this.currentSource.y) {
            return true;
        }

        // Mirrors visionPasses' actor test: a solid actor blocks light unless it's
        // see-through (`opaque: false`, e.g. columns, statues, fortifications) or
        // invisible — an unseen creature casting a visible shadow gives away its
        // position, which defeats the point of invisibility.
        const actorAtTile = this._solidActorCache?.get(x * 10000 + y);
        if (actorAtTile
                && actorAtTile.getAttribute('opaque') !== false
                && !actorAtTile.hasStateProperty?.('invisible')) {
            return false;
        }

        return true;
    }

    getLightSources() {
        const sources = [];

        for (const actor of this.engine.entityManager.actors) {
            if (actor.hasAttribute('light_source') && !actor.isDead) {
                sources.push({
                    x: actor.x,
                    y: actor.y,
                    radius: actor.lightRadius || 5,
                    intensity: actor.lightIntensity || 1.0,
                    color: actor.tint
                });
            }

            if ((actor.hasAttribute('controlled') || actor.hasAttribute('pov')) && this.playerAutoLight) {
                sources.push({
                    x: actor.x,
                    y: actor.y,
                    radius: this.playerLightRadius,
                    intensity: 1.0,
                    color: 0xFFFFFF
                });
            }
        }

        // Inventory light sources (e.g. carried torches, equipped rings)
        for (const actor of this.engine.entityManager.actors) {
            if (!actor.inventory || actor.isDead) continue;
            for (const item of actor.inventory) {
                if (!item.hasAttribute('light_source')) continue;
                if (item.getAttribute('wearable') === 'ring' && !actor.isItemEquipped?.(item)) continue;
                const burns = item.stats?.burns;
                if (burns && burns.current <= 0) continue; // burned out
                sources.push({
                    x: actor.x,
                    y: actor.y,
                    radius: item.getAttribute('lightRadius') || 5,
                    intensity: item.getAttribute('lightIntensity') || 1.0,
                    color: item.tint || 0xFFFFFF
                });
            }
        }

        // Ground items with light_source (e.g. thrown lit torches)
        for (const item of this.engine.entityManager.items) {
            if (!item.hasAttribute('light_source') || item.isDead) continue;
            const burns = item.stats?.burns;
            if (burns && burns.current <= 0) continue;
            sources.push({
                x: item.x,
                y: item.y,
                radius: item.getAttribute('lightRadius') || 5,
                intensity: item.getAttribute('lightIntensity') || 1.0,
                color: item.tint || 0xFFFFFF
            });
        }

        return sources;
    }

    computeLighting() {
        // Build solid actor position cache for O(1) lookups in visionPasses/lightPasses callbacks.
        // Keyed by x*10000+y; only includes live solid actors.
        this._solidActorCache = new Map();
        for (const actor of this.engine.entityManager.actors) {
            if (!actor.isDead && actor.hasAttribute('solid')) {
                this._solidActorCache.set(actor.x * 10000 + actor.y, actor);
            }
        }

        // Reset light and visibility maps. Overwrite the existing tile objects in
        // place rather than allocating a fresh object per tile every step — on a
        // 100x100 map that's 10,000 allocations per move, all GC churn.
        const ambientR = this.ambientTint ? this.ambientTint.r * this.ambientLight : 0;
        const ambientG = this.ambientTint ? this.ambientTint.g * this.ambientLight : 0;
        const ambientB = this.ambientTint ? this.ambientTint.b * this.ambientLight : 0;
        for (let y = 0; y < this.height; y++) {
            const lightRow = this.lightMap[y];
            const visRow = this.visibilityMap[y];
            const losRow = this.losMap[y];
            for (let x = 0; x < this.width; x++) {
                const tile = lightRow[x];
                tile.intensity = this.ambientLight;
                tile.r = ambientR;
                tile.g = ambientG;
                tile.b = ambientB;
                visRow[x] = false;
                losRow[x] = 0;
            }
        }

        // Cache whether we have a viewpoint actor (controlled player OR a `pov`
        // actor). Drives the fog-of-war branch in getDarknessAlpha/
        // getEntityVisibility — a pov-only observer level must fog correctly too.
        this._hasControlledActors = this.engine.entityManager.actors.some(
            a => (a.hasAttribute('controlled') || a.hasAttribute('pov')) && !a.isDead
        );

        // Compute lighting from all light sources BEFORE visibility,
        // so player FOV can be clamped by available light.
        // Cache the source list for this pass — getLightSources() is otherwise
        // re-run inside revealDistantLightBeacons() every step (3 actor/inventory/
        // item sweeps per move). Reuse the single result instead.
        const sources = this.getLightSources();
        this._sourcesThisPass = sources;

        for (const source of sources) {
            this.currentSource = source;

            const isColoredLight = source.color && source.color !== 0xFFFFFF;
            const sr = isColoredLight ? (source.color >> 16) & 0xFF : 0;
            const sg = isColoredLight ? (source.color >> 8) & 0xFF : 0;
            const sb = isColoredLight ? source.color & 0xFF : 0;

            this.fov.compute(source.x, source.y, source.radius, (x, y, r, visibility) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
                if (visibility <= 0) return;

                const falloff = Math.max(0, 1 - (r / source.radius));
                const lightLevel = falloff * source.intensity;

                const tile = this.lightMap[y][x];
                tile.intensity = Math.min(1, tile.intensity + lightLevel);
                tile.r = Math.min(255, tile.r + sr * lightLevel);
                tile.g = Math.min(255, tile.g + sg * lightLevel);
                tile.b = Math.min(255, tile.b + sb * lightLevel);
            });
        }
        this.currentSource = null;

        // Compute visibility after lighting so FOV respects light levels
        this.computeVisibility();

        // Update shadow entities for actors blocking colored light
        this.updateShadows();
    }

    updateShadows() {
        const neededShadows = new Map(); // "x,y" -> { tileName, actor }

        // Get colored light sources
        const coloredSources = this.engine.entityManager.actors.filter(actor =>
            actor.hasAttribute('light_source') &&
            !actor.isDead &&
            actor.tint &&
            actor.tint !== 0xFFFFFF
        );

        // For each colored light source, check for nearby actors that block it
        for (const lightSource of coloredSources) {
            const lx = lightSource.x;
            const ly = lightSource.y;
            const radius = lightSource.lightRadius || 5;

            // Check actors within light radius
            for (const actor of this.engine.entityManager.actors) {
                if (actor === lightSource || actor.isDead) continue;
                // Non-solid actors (fire, lava, etc.) don't cast shadows
                if (!actor.hasAttribute('solid')) continue;

                const ax = actor.x;
                const ay = actor.y;
                const dx = ax - lx; // positive = actor is right of light
                const dy = ay - ly; // positive = actor is below light

                // Skip if actor is too far from light source
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist > radius || dist === 0) continue;

                // Determine shadow position and tile based on light direction
                let shadowX, shadowY, tileName;

                if (dx === 0 && dy > 0) {
                    // Light is directly above actor, shadow below
                    shadowX = ax;
                    shadowY = ay + 1;
                    tileName = 'LIGHT_SHADE';
                } else if (dx === 0 && dy < 0) {
                    // Light is directly below actor, shadow above
                    // Skip if actor has a top tile (two-tile actor)
                    if (actor.spriteTop) continue;
                    shadowX = ax;
                    shadowY = ay - 1;
                    tileName = 'LIGHT_SHADE';
                } else if (dx > 0 && dy > 0) {
                    // Light is upper-left of actor, shadow to lower-right
                    shadowX = ax;
                    shadowY = ay + 1;
                    tileName = 'LIGHT_SHADE_UPPER_RIGHT_TRIANGLE';
                } else if (dx < 0 && dy > 0) {
                    // Light is upper-right of actor, shadow to lower-left
                    shadowX = ax;
                    shadowY = ay + 1;
                    tileName = 'LIGHT_SHADE_UPPER_LEFT_TRIANGLE';
                } else if (dx > 0 && dy < 0) {
                    // Light is lower-left of actor, shadow to upper-right
                    // Skip if actor has a top tile
                    if (actor.spriteTop) continue;
                    shadowX = ax;
                    shadowY = ay - 1;
                    tileName = 'LIGHT_SHADE_UPPER_RIGHT_TRIANGLE';
                } else if (dx < 0 && dy < 0) {
                    // Light is lower-right of actor, shadow to upper-left
                    // Skip if actor has a top tile
                    if (actor.spriteTop) continue;
                    shadowX = ax;
                    shadowY = ay - 1;
                    tileName = 'LIGHT_SHADE_LOWER_RIGHT_TRIANGLE';
                } else {
                    continue;
                }

                // Skip if shadow position is out of bounds or has no floor
                if (shadowX < 0 || shadowX >= this.width || shadowY < 0 || shadowY >= this.height) continue;
                const floorTile = this.engine.mapManager?.floorMap[shadowY]?.[shadowX];
                if (!floorTile || !floorTile.tileId) continue;

                const key = `${shadowX},${shadowY}`;
                neededShadows.set(key, { tileName, x: shadowX, y: shadowY });
            }
        }

        // Remove shadows that are no longer needed
        for (const [key, entity] of this.shadowEntities) {
            if (!neededShadows.has(key)) {
                this.engine.entityManager.removeEntity(entity);
                this.shadowEntities.delete(key);
            }
        }

        // Create or update needed shadows
        for (const [key, shadowData] of neededShadows) {
            const existing = this.shadowEntities.get(key);
            if (existing) {
                // Update tile if needed
                const newTileIndex = this.engine.spriteLibrary.resolveTile(shadowData.tileName);
                if (existing.tileIndex?.x !== newTileIndex?.x || existing.tileIndex?.y !== newTileIndex?.y) {
                    // Remove old and create new
                    this.engine.entityManager.removeEntity(existing);
                    this.shadowEntities.delete(key);
                    const newEntity = this.createShadowEntity(shadowData.x, shadowData.y, shadowData.tileName);
                    if (newEntity) this.shadowEntities.set(key, newEntity);
                }
            } else {
                // Create new shadow
                const newEntity = this.createShadowEntity(shadowData.x, shadowData.y, shadowData.tileName);
                if (newEntity) this.shadowEntities.set(key, newEntity);
            }
        }
    }

    createShadowEntity(x, y, tileName) {
        const entity = new Entity(x, y, 'light_shadow', this.engine);
        entity.name = 'shadow';
        entity.tileIndex = this.engine.spriteLibrary.resolveTile(tileName);
        entity.tint = 0xFFFFFF;
        entity.setAttribute('light_shadow', true);

        this.engine.renderer?.createEntitySprite(entity);
        this.engine.entityManager.entities.push(entity);

        return entity;
    }

    /**
     * Two different questions get answered here, and conflating them was the bug:
     *
     *   losMap        — can I make out the shape of this terrain? (geometry + vision range)
     *   visibilityMap — can I perceive something standing here?   (that also needs light)
     *
     * FOV always casts to the actor's full vision range. A held light governs how
     * BRIGHTLY you see, never how FAR. The reverse — clamping FOV to the torch radius —
     * shrank a 30-tile view to 6 while carrying a torch, and an environmental-light scan
     * swept the full 30 while carrying nothing, so losing your torch appeared to IMPROVE
     * your sight.
     */
    computeVisibility() {
        // FOV is cast from every viewpoint actor: the controlled player AND any
        // `pov`-tagged actor (e.g. an AI hero in an observer prototype), so a
        // dark/fog level renders around whatever we're seeing through.
        const viewpointActors = this.engine.entityManager.getViewpointActors();

        this._gradientRange = 0;

        for (const actor of viewpointActors) {
            const range = actor.getEffectiveVisionRange();

            // The dark-terrain gradient is anchored to the light you actually carry, so
            // it can't be used to map a level you have no light for: with a torch you
            // read terrain out to full vision range and it fades into black; with
            // nothing at all you're back to feeling your way one tile at a time.
            const gradientRange = this.getPersonalLightRadius(actor) > 0 ? range : 1;
            if (gradientRange > this._gradientRange) this._gradientRange = gradientRange;

            // dark_vision used to work by dodging the FOV clamp. With the clamp gone
            // that's a no-op, so state it directly: these actors perceive without light.
            const darkVision = actor.hasAttribute('dark_vision');

            this.visionFov.compute(actor.x, actor.y, range, (x, y, r, visibility) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
                if (visibility <= 0) return;

                // Nearest viewpoint wins, so two light-bearers don't darken each other.
                if (r <= gradientRange && (this.losMap[y][x] === 0 || r + 1 < this.losMap[y][x])) {
                    this.losMap[y][x] = r + 1;
                }

                // Unchanged gate. exploredMap stays behind it too — terrain you only
                // dimly made out isn't terrain you've mapped.
                if (darkVision || r <= 1 || this.lightMap[y][x].intensity > 0) {
                    this.visibilityMap[y][x] = true;
                    this.exploredMap[y][x] = true;
                }
            });

            // Reveal distant, unobstructed light sources as lone beacons in the dark.
            this.revealDistantLightBeacons(actor);
        }

        // A telepathic player senses every living creature through walls and darkness.
        this.revealTelepathicSentients();
    }

    /**
     * When the player is telepathic, mark every sentient enemy tile visible (and
     * explored) regardless of walls or distance, and give it a dim "sensed" glow so
     * the creature renders through the darkness as a faint lit figure rather than a
     * raw sprite on black. Flows through the normal entity-lighting/darkness path
     * (getEntityVisibility keys off visibilityMap, getDarknessAlpha off intensity),
     * so a sensed creature is dimly lit exactly like a distant light beacon.
     */
    revealTelepathicSentients() {
        const player = this.engine.entityManager.player;
        if (!player?.hasStateProperty?.('telepathic')) return;

        const SENSED_GLOW = 0.7; // revealed and clearly readable, still slightly dimmed vs. full FOV
        for (const actor of this.engine.entityManager.getSentientActors()) {
            if (actor.hasAttribute('controlled')) continue;
            const { x, y } = actor;
            if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;

            this.visibilityMap[y][x] = true;
            this.exploredMap[y][x] = true;
            const tile = this.lightMap[y][x];
            if (tile.intensity < SENSED_GLOW) tile.intensity = SENSED_GLOW;
        }
    }

    // On a dark level, reveal any unobstructed light source as a lone point of light,
    // even beyond the player's reduced FOV — only the source's own tile, not its surroundings.
    revealDistantLightBeacons(actor) {
        if (this.ambientLight >= 0.5) return; // lit level: normal FOV already shows everything

        // Reuse the source list already gathered this pass (see computeLighting);
        // fall back to a fresh scan if called outside a recompute.
        const allSources = this._sourcesThisPass || this.getLightSources();
        const sources = allSources.filter(
            s => s.intensity > 0 && !(s.x === actor.x && s.y === actor.y) // skip player's own/carried light
        );
        if (sources.length === 0) return; // no distant sources → skip the FOV pass entirely

        // Index source tiles for O(1) lookup inside the FOV callback.
        const sourceKeys = new Set(sources.map(s => s.x * 10000 + s.y));

        // Cap the beacon FOV radius to the farthest actual source. Beacons can only
        // appear on a source tile, so casting past the most distant source is wasted
        // shadowcasting with identical results — on a dark 100x100 level this is the
        // difference between a ~142-radius full-map pass and a tight local one.
        let maxSourceDist = 0;
        for (const s of sources) {
            const d = Math.max(Math.abs(s.x - actor.x), Math.abs(s.y - actor.y));
            if (d > maxSourceDist) maxSourceDist = d;
        }
        const beaconRange = Math.min(this.getBeaconRange(actor), maxSourceDist);
        if (beaconRange <= 0) return;

        // Cast from the PLAYER (controlled origin passes visionPasses) out to beaconRange.
        // Shadowcasting reports an opaque blocker's own tile as visible before shadowing past it,
        // so an unobstructed source tile gets visibility > 0; a blocked one does not.
        this.visionFov.compute(actor.x, actor.y, beaconRange, (x, y, r, visibility) => {
            if (visibility <= 0) return;
            if (!sourceKeys.has(x * 10000 + y)) return;
            // Reveal ONLY the source tile — never its neighbours.
            this.visibilityMap[y][x] = true;
            this.exploredMap[y][x] = true;
        });
    }

    getBeaconRange(actor) {
        const configured = this.engine.currentPrototype?.config?.mechanics?.beacon_range;
        if (typeof configured === 'number') return configured;
        // Default to how far the actor can actually see. Previously the whole map, which
        // let a torch on the far side of the level show through as a pinprick regardless
        // of vision range; a beacon you can't see shouldn't be drawn.
        return actor?.getEffectiveVisionRange?.() ?? Math.ceil(Math.hypot(this.width, this.height));
    }

    /**
     * Radius of the light this actor carries on its own body — a burning torch, a phial,
     * a worn glowing ring, or the `light_source` attribute on the actor itself. Returns 0
     * when the actor carries nothing lit, which is the "am I in the dark?" test.
     *
     * Deliberately ignores environmental light: a wall torch across the room lights the
     * room, but it isn't yours and doesn't travel with you.
     */
    getPersonalLightRadius(actor) {
        if ((actor.hasAttribute('controlled') || actor.hasAttribute('pov')) && this.playerAutoLight) {
            return this.playerLightRadius;
        }

        let personalLightRadius = 0;

        if (actor.hasAttribute('light_source')) {
            personalLightRadius = Math.max(personalLightRadius, actor.lightRadius || 5);
        }

        if (actor.inventory) {
            for (const item of actor.inventory) {
                if (!item.hasAttribute('light_source')) continue;
                if (item.getAttribute('wearable') === 'ring' && !actor.isItemEquipped?.(item)) continue;
                const burns = item.stats?.burns;
                if (burns && burns.current <= 0) continue;
                personalLightRadius = Math.max(personalLightRadius, item.getAttribute('lightRadius') || 5);
            }
        }

        return personalLightRadius;
    }

    getLightLevel(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return { intensity: 0, r: 0, g: 0, b: 0 };
        }
        return this.lightMap[y][x];
    }

    isExplored(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }
        return this.exploredMap[y][x];
    }

    isVisible(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }
        return this.visibilityMap[y][x];
    }

    isTopVisible(x, y) {
        // A tile's "top" is visible if the tile itself is visible,
        // OR if there's an actor at (x, y+1) whose top renders here and whose BASE is visible
        if (this.isVisible(x, y)) {
            return true;
        }

        // Check if there's an actor below whose top would render at this position
        // The top should be visible if the actor's base tile (at y+1) is visible
        const actorBelow = this.engine.entityManager.getActorAt(x, y + 1);
        if (actorBelow && actorBelow.spriteTop && !actorBelow.isDead) {
            // Actor's top is visible if its base tile is visible
            if (this.isVisible(x, y + 1)) {
                return true;
            }
        }

        return false;
    }

    isEquipmentTopVisible(x, y) {
        // Check if equipment at y-2 (above actor's head) should be visible
        // This position is visible if:
        // 1. The tile at y-2 is directly visible, OR
        // 2. There's an actor at (x, y) with "top" slot equipment whose base is visible
        if (this.isVisible(x, y)) {
            return true;
        }

        // Check if there's an actor two tiles below whose equipment would render here
        const actorBelow = this.engine.entityManager.getActorAt(x, y + 2);
        if (actorBelow && actorBelow.spriteEquipment?.top && !actorBelow.isDead) {
            // Equipment is visible if the actor's base tile is visible
            if (this.isVisible(x, y + 2)) {
                return true;
            }
        }

        return false;
    }

    hasControlledActors() {
        // Use cached value from computeLighting() if available. "Controlled" here
        // means "we have a viewpoint" — controlled player OR a `pov` actor.
        if (this._hasControlledActors !== undefined) {
            return this._hasControlledActors;
        }
        return this.engine.entityManager.actors.some(
            a => (a.hasAttribute('controlled') || a.hasAttribute('pov')) && !a.isDead
        );
    }

    getLightTint(light) {
        if (light.intensity > 0 && (light.r > 0 || light.g > 0 || light.b > 0)) {
            const maxComponent = Math.max(light.r, light.g, light.b, 1);
            const r = Math.floor((light.r / maxComponent) * 255);
            const g = Math.floor((light.g / maxComponent) * 255);
            const b = Math.floor((light.b / maxComponent) * 255);
            return (r << 16) | (g << 8) | b;
        }
        return 0xFFFFFF;
    }

    getDarknessAlpha(x, y, fogOfWar = false) {
        const hasControlled = this.hasControlledActors();
        const light = this.getLightLevel(x, y);
        const visible = this.isVisible(x, y);
        const topVisible = this.isTopVisible(x, y);
        const equipmentTopVisible = this.isEquipmentTopVisible(x, y);
        const explored = this.isExplored(x, y);

        if (!hasControlled) {
            if (light.intensity >= 1) {
                return { alpha: 0, useSolidTexture: false };
            } else if (light.intensity > 0) {
                return { alpha: 1.0 - light.intensity, useSolidTexture: false };
            } else {
                return { alpha: 1.0, useSolidTexture: true };
            }
        } else if (visible || topVisible || equipmentTopVisible) {
            if (light.intensity >= 1) {
                return { alpha: 0, useSolidTexture: false };
            } else if (light.intensity > 0) {
                return { alpha: 0.85 * (1.0 - light.intensity), useSolidTexture: false };
            } else {
                return { alpha: 0.85, useSolidTexture: false };
            }
        } else if (this.losMap?.[y]?.[x]) {
            // In line of sight and within vision range, but past the reach of any light:
            // the fade at the edge of the field of view. Ramps 0.85 -> 0.97 with distance
            // so there's no hard ring where the torchlight stops. Crossing fog's 0.92 on
            // the way out is intended — terrain you're straining to make out in the dark
            // should read as murkier than a corridor you already walked.
            const dist = this.losMap[y][x] - 1;
            const t = Math.min(1, dist / Math.max(1, this._gradientRange || 1));
            return { alpha: 0.85 + 0.12 * t, useSolidTexture: false };
        } else if (fogOfWar && explored) {
            return { alpha: 0.92, useSolidTexture: false };
        } else {
            return { alpha: 1.0, useSolidTexture: true };
        }
    }

    getEntityVisibility(x, y, fogOfWar = false, isStatic = false) {
        // Get visibility for an entity at position (x, y)
        // The top sprite should have the same visibility as the base
        // Equipment in "top" slot (at y-2) should also match the actor's visibility
        // isStatic: true for walls/doors/terrain that should stay visible in remembered areas
        const hasControlled = this.hasControlledActors();
        const light = this.getLightLevel(x, y);
        const visible = this.isVisible(x, y);
        const explored = this.isExplored(x, y);
        const lightTint = this.getLightTint(light);

        if (!hasControlled) {
            return {
                showBase: true,
                showTop: true,
                showEquipmentTop: true,
                baseTint: lightTint,
                topTint: lightTint,
                equipmentTopTint: lightTint,
                animateBase: true,
                animateTop: true
            };
        }

        // Static entities (walls, doors, etc.) remain visible in remembered areas
        // Mobile entities (monsters, NPCs, items) are only shown in currently visible areas
        if (isStatic && fogOfWar && explored && !visible) {
            // Static entity in remembered but not visible area - show dimmed
            const dimTint = 0x333333;
            return {
                showBase: true,
                showTop: true,
                showEquipmentTop: true,
                baseTint: dimTint,
                topTint: dimTint,
                equipmentTopTint: dimTint,
                animateBase: false,
                animateTop: false
            };
        }

        // Mobile entities only visible in line of sight
        // Static entities in visible areas use normal lighting
        return {
            showBase: visible,
            showTop: visible,
            showEquipmentTop: visible,
            baseTint: lightTint,
            topTint: lightTint,
            equipmentTopTint: lightTint,
            animateBase: visible,
            animateTop: visible
        };
    }

    getLightColorOverlay(x, y) {
        // Only apply colored light overlays on dark levels
        const darknessEnabled = this.engine._floorMechanics?.darkness;
        if (!darknessEnabled) {
            return { tint: 0xFFFFFF, alpha: 0 };
        }

        const hasControlled = this.hasControlledActors();
        const light = this.getLightLevel(x, y);
        const visible = this.isVisible(x, y);
        const lightTint = this.getLightTint(light);

        // Only tint walkable floor tiles, not void/background
        const floorTile = this.engine.mapManager?.floorMap[y]?.[x];
        const hasFloor = floorTile && floorTile.tileId;

        if (hasFloor && light.intensity > 0 && lightTint !== 0xFFFFFF) {
            if (visible || !hasControlled) {
                return {
                    tint: lightTint,
                    alpha: Math.min(0.5, light.intensity * 0.5)
                };
            }
        }
        return { tint: 0xFFFFFF, alpha: 0 };
    }

    /**
     * The tint a floor tile visually ends up with once the darkness overlay
     * (black, alpha from getDarknessAlpha) and light-color overlay (light hue,
     * multiply blend) are composited over it. Used to light floor-disguised
     * actors (render_layer:"bottom") directly on their sprite, so they read
     * exactly like the floor tile beneath them instead of like a terrain actor.
     * Returns a tint in 0xRRGGBB to multiply into the sprite's native tint.
     */
    getFloorTint(x, y, fogOfWar = false) {
        const light = this.getLightLevel(x, y);
        const lightTint = this.getLightTint(light);
        const darkness = this.getDarknessAlpha(x, y, fogOfWar);

        // Light-color overlay: multiply toward the light hue by its alpha.
        let r = (lightTint >> 16) & 0xFF;
        let g = (lightTint >> 8) & 0xFF;
        let b = lightTint & 0xFF;
        const colorAlpha = (light.intensity > 0 && lightTint !== 0xFFFFFF)
            ? Math.min(0.5, light.intensity * 0.5)
            : 0;
        r = Math.round(255 * (1 - colorAlpha) + r * colorAlpha);
        g = Math.round(255 * (1 - colorAlpha) + g * colorAlpha);
        b = Math.round(255 * (1 - colorAlpha) + b * colorAlpha);

        // Darkness overlay: black at `darkness.alpha` scales brightness down.
        const dim = 1 - darkness.alpha;
        r = Math.round(r * dim);
        g = Math.round(g * dim);
        b = Math.round(b * dim);

        return (r << 16) | (g << 8) | b;
    }

    /**
     * Darkness alpha for the decorative overlay tile layer. Unlike getDarknessAlpha,
     * this does NOT hard-clip an out-of-line-of-sight tile to solid black: an already
     * EXPLORED overlay tile stays visible (fog-dimmed by its light level) even when the
     * player has no current line of sight to the tile beneath it. Never-explored tiles
     * are still fully black. This is what makes overlay decor (canopies, arches, hanging
     * decoration) read as part of the remembered scene instead of winking out with LOS.
     * Mirrors the light-level scaling of getDarknessAlpha so overlay dims consistently
     * with the floor beneath it.
     */
    getOverlayDarknessAlpha(x, y, fogOfWar = false) {
        const hasControlled = this.hasControlledActors();
        const light = this.getLightLevel(x, y);

        // Observer mode (no controlled actor): no LOS restriction at all — dim purely by
        // light level, matching getDarknessAlpha's !hasControlled branch.
        if (!hasControlled) {
            if (light.intensity >= 1) return { alpha: 0 };
            if (light.intensity > 0) return { alpha: 1.0 - light.intensity };
            return { alpha: 1.0 };
        }

        // With a controlled actor, treat visible OR explored the same — the defining
        // difference from getDarknessAlpha, which would black out !visible tiles.
        const seen = this.isVisible(x, y) || this.isExplored(x, y);
        if (seen) {
            if (light.intensity >= 1) return { alpha: 0 };
            if (light.intensity > 0) return { alpha: 0.85 * (1.0 - light.intensity) };
            // Explored-but-currently-unlit reads as fog rather than pitch black.
            return { alpha: fogOfWar ? 0.92 : 0.85 };
        }

        // Unlit terrain inside the vision gradient. Overlay sprites render ABOVE the
        // darkness layer and carry their dimming as a tint, so without this an arch or
        // canopy would sit undimmed over gradient-band floor — the exact seam this
        // function exists to prevent. Same ramp as getDarknessAlpha.
        if (this.losMap?.[y]?.[x]) {
            const dist = this.losMap[y][x] - 1;
            const t = Math.min(1, dist / Math.max(1, this._gradientRange || 1));
            return { alpha: 0.85 + 0.12 * t };
        }

        // Never seen: fully black, same as the floor beneath it.
        return { alpha: 1.0 };
    }

    /**
     * The tint an overlay decorative tile should end up with. Same light-color +
     * darkness compositing as getFloorTint, but using getOverlayDarknessAlpha so
     * line-of-sight blocking doesn't clip explored overlay tiles to black. Returns
     * a tint in 0xRRGGBB to set directly on the overlay sprite (which renders above
     * the darkness layer). 0xFFFFFF means full brightness (no dimming).
     */
    getOverlayTint(x, y, fogOfWar = false) {
        const light = this.getLightLevel(x, y);
        const lightTint = this.getLightTint(light);
        const darkness = this.getOverlayDarknessAlpha(x, y, fogOfWar);

        // Light-color overlay: multiply toward the light hue by its alpha.
        let r = (lightTint >> 16) & 0xFF;
        let g = (lightTint >> 8) & 0xFF;
        let b = lightTint & 0xFF;
        const colorAlpha = (light.intensity > 0 && lightTint !== 0xFFFFFF)
            ? Math.min(0.5, light.intensity * 0.5)
            : 0;
        r = Math.round(255 * (1 - colorAlpha) + r * colorAlpha);
        g = Math.round(255 * (1 - colorAlpha) + g * colorAlpha);
        b = Math.round(255 * (1 - colorAlpha) + b * colorAlpha);

        // Darkness: black at `darkness.alpha` scales brightness down.
        const dim = 1 - darkness.alpha;
        r = Math.round(r * dim);
        g = Math.round(g * dim);
        b = Math.round(b * dim);

        return (r << 16) | (g << 8) | b;
    }

    /**
     * The tint a background-layer tile should end up with. Background tiles are the
     * void fill and the cliffside shading that addBaseAndShadows paints (architect.js),
     * and they render BELOW the darkness layer — but they still need the ambient hue
     * applied directly, because getLightColorOverlay deliberately skips any cell
     * without a floor tile, and void cells are floorless by definition. Without this
     * the background layer ignored ambient_light entirely and read as flat black.
     *
     * Same light-color + darkness compositing as getOverlayTint. Uses
     * getOverlayDarknessAlpha rather than getDarknessAlpha so an explored cliff edge
     * keeps its ambient color instead of being clipped to black the moment the
     * player loses line of sight to it. Returns 0xRRGGBB; 0xFFFFFF means untinted.
     */
    getBackgroundTint(x, y, fogOfWar = false) {
        const light = this.getLightLevel(x, y);
        const lightTint = this.getLightTint(light);
        const darkness = this.getOverlayDarknessAlpha(x, y, fogOfWar);

        // Light-color overlay: multiply toward the light hue by its alpha.
        let r = (lightTint >> 16) & 0xFF;
        let g = (lightTint >> 8) & 0xFF;
        let b = lightTint & 0xFF;
        const colorAlpha = (light.intensity > 0 && lightTint !== 0xFFFFFF)
            ? Math.min(0.5, light.intensity * 0.5)
            : 0;
        r = Math.round(255 * (1 - colorAlpha) + r * colorAlpha);
        g = Math.round(255 * (1 - colorAlpha) + g * colorAlpha);
        b = Math.round(255 * (1 - colorAlpha) + b * colorAlpha);

        // Darkness: black at `darkness.alpha` scales brightness down.
        const dim = 1 - darkness.alpha;
        r = Math.round(r * dim);
        g = Math.round(g * dim);
        b = Math.round(b * dim);

        return (r << 16) | (g << 8) | b;
    }

    reset() {
        // Clean up shadow entities
        for (const entity of this.shadowEntities.values()) {
            this.engine.entityManager.removeEntity(entity);
        }
        this.shadowEntities.clear();

        this.lightMap = [];
        this.visibilityMap = [];
        this.losMap = [];
        this.exploredMap = [];
        this.fov = null;
        this.visionFov = null;
    }
}

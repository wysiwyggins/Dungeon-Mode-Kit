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

        this.lightMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => ({ intensity: 0, r: 0, g: 0, b: 0 }))
        );

        this.visibilityMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => false)
        );

        this.exploredMap = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => false)
        );

        this.fov = new ROT.FOV.PreciseShadowcasting((x, y) => this.lightPasses(x, y));
        this.visionFov = new ROT.FOV.PreciseShadowcasting((x, y) => this.visionPasses(x, y));
    }

    visionPasses(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }

        const wallTile = this.engine.mapManager.wallMap[y][x];
        if (wallTile !== null) {
            return false;
        }

        const actorAtTile = this._solidActorCache?.get(x * 10000 + y);
        if (actorAtTile && !actorAtTile.hasAttribute('controlled')) {
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

        const wallTile = this.engine.mapManager.wallMap[y][x];
        if (wallTile !== null) {
            return false;
        }

        if (this._solidActorCache?.has(x * 10000 + y)) {
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

            if (actor.hasAttribute('controlled') && this.playerAutoLight) {
                sources.push({
                    x: actor.x,
                    y: actor.y,
                    radius: this.playerLightRadius,
                    intensity: 1.0,
                    color: 0xFFFFFF
                });
            }
        }

        // Inventory light sources (e.g. carried torches)
        for (const actor of this.engine.entityManager.actors) {
            if (!actor.inventory || actor.isDead) continue;
            for (const item of actor.inventory) {
                if (!item.hasAttribute('light_source')) continue;
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

        // Reset light and visibility maps
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.lightMap[y][x] = { intensity: this.ambientLight, r: 0, g: 0, b: 0 };
                this.visibilityMap[y][x] = false;
            }
        }

        // Cache whether we have controlled actors (used heavily in getDarknessAlpha/getEntityVisibility)
        this._hasControlledActors = this.engine.entityManager.actors.some(
            a => a.hasAttribute('controlled') && !a.isDead
        );

        // Compute visibility for all controlled actors
        this.computeVisibility();

        // Compute lighting from all light sources
        const sources = this.getLightSources();

        for (const source of sources) {
            this.currentSource = source;

            // Only accumulate color from non-white light sources
            // White light (player) contributes intensity but not color tint
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

    computeVisibility() {
        const controlledActors = this.engine.entityManager.actors.filter(
            a => a.hasAttribute('controlled') && !a.isDead
        );

        for (const actor of controlledActors) {
            this.visionFov.compute(actor.x, actor.y, actor.visionRange, (x, y, r, visibility) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
                if (visibility > 0) {
                    this.visibilityMap[y][x] = true;
                    this.exploredMap[y][x] = true;
                }
            });
        }
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
        // Use cached value from computeLighting() if available
        if (this._hasControlledActors !== undefined) {
            return this._hasControlledActors;
        }
        return this.engine.entityManager.actors.some(
            a => a.hasAttribute('controlled') && !a.isDead
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
        const darknessEnabled = this.engine.currentPrototype?.config?.mechanics?.darkness;
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

    reset() {
        // Clean up shadow entities
        for (const entity of this.shadowEntities.values()) {
            this.engine.entityManager.removeEntity(entity);
        }
        this.shadowEntities.clear();

        this.lightMap = [];
        this.visibilityMap = [];
        this.exploredMap = [];
        this.fov = null;
        this.visionFov = null;
    }
}

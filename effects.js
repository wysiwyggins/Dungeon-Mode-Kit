/**
 * Dungeon Mode Kit - Visual Effects System
 * Data-driven visual effects built from composable primitives.
 * Effects are defined in data/effects.json and can be overridden per-prototype.
 */

// ============================================================================
// CONSTANTS (moved from engine.js - only used by effect primitives)
// ============================================================================

const HALLUCINATION_TINTS = [0xFFFF4F, 0xEE4266, 0x540D6E, 0x3BCEFF, 0x0EAD69];

function generateColorVariation(baseColor, variation = 0x101008) {
    const r = (baseColor >> 16) & 0xFF;
    const g = (baseColor >> 8) & 0xFF;
    const b = baseColor & 0xFF;

    const vr = (variation >> 16) & 0xFF;
    const vg = (variation >> 8) & 0xFF;
    const vb = variation & 0xFF;

    return {
        lighter: ((Math.min(255, r + vr) << 16) | (Math.min(255, g + vg) << 8) | Math.min(255, b + vb)),
        darker: ((Math.max(0, r - vr) << 16) | (Math.max(0, g - vg) << 8) | Math.max(0, b - vb * 0.5))
    };
}

// ============================================================================
// EFFECT PRIMITIVES
// ============================================================================

/**
 * Each primitive is a function (ctx, params) => { apply(), tick?(), remove() }
 * ctx provides access to the renderer's PIXI objects.
 */
const EffectPrimitives = {

    /**
     * Ticker-driven sine hue shift on a ColorMatrixFilter applied to the stage.
     */
    hue_oscillate(ctx, params) {
        const { speed = 0.002, amplitude = 40, secondary_speed = 0.0007, secondary_amplitude = 20 } = params;
        let filter = null;
        let tickerFn = null;

        return {
            apply() {
                filter = new PIXI.filters.ColorMatrixFilter();
                ctx.stage.filters = ctx.stage.filters
                    ? [...ctx.stage.filters, filter]
                    : [filter];

                tickerFn = () => {
                    const t = Date.now();
                    const hueShift = Math.sin(t * speed) * amplitude + Math.sin(t * secondary_speed) * secondary_amplitude;
                    filter.reset();
                    filter.hue(hueShift);
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (filter && ctx.stage.filters) {
                    ctx.stage.filters = ctx.stage.filters.filter(f => f !== filter);
                    if (ctx.stage.filters.length === 0) ctx.stage.filters = null;
                }
                filter = null;
            }
        };
    },

    /**
     * Ticker-driven brightness pulse on a ColorMatrixFilter applied to the stage.
     * Shares the stage filter list with hue_oscillate but uses its own filter instance.
     */
    brightness_oscillate(ctx, params) {
        const { speed = 0.003, amplitude = 0.05 } = params;
        let filter = null;
        let tickerFn = null;

        return {
            apply() {
                filter = new PIXI.filters.ColorMatrixFilter();
                ctx.stage.filters = ctx.stage.filters
                    ? [...ctx.stage.filters, filter]
                    : [filter];

                tickerFn = () => {
                    const t = Date.now();
                    const brightness = 1.0 + Math.sin(t * speed) * amplitude;
                    filter.reset();
                    filter.brightness(brightness, false);
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (filter && ctx.stage.filters) {
                    ctx.stage.filters = ctx.stage.filters.filter(f => f !== filter);
                    if (ctx.stage.filters.length === 0) ctx.stage.filters = null;
                }
                filter = null;
            }
        };
    },

    /**
     * PIXI.Graphics rect with blend mode on a container (for submersion overlay).
     */
    color_overlay(ctx, params) {
        const { container = 'darkness', blend_mode = 'multiply', z_index = 100 } = params;
        let graphics = null;

        return {
            apply(runtimeParams) {
                const tint = runtimeParams?.tint;
                if (!tint) return;

                const targetContainer = ctx.containers[container];
                if (!targetContainer) return;

                graphics = new PIXI.Graphics();
                graphics.beginFill(tint);
                if (ctx.engine.viewportEnabled) {
                    graphics.drawRect(
                        ctx.engine.sectionOriginX * globalVars.TILE_WIDTH,
                        ctx.engine.sectionOriginY * globalVars.TILE_HEIGHT,
                        ctx.engine.viewportWidth * globalVars.TILE_WIDTH,
                        ctx.engine.viewportHeight * globalVars.TILE_HEIGHT
                    );
                } else {
                    graphics.drawRect(0, 0, ctx.mapWidth * globalVars.TILE_WIDTH, ctx.mapHeight * globalVars.TILE_HEIGHT);
                }
                graphics.endFill();

                const blendModes = {
                    'multiply': PIXI.BLEND_MODES.MULTIPLY,
                    'add': PIXI.BLEND_MODES.ADD,
                    'screen': PIXI.BLEND_MODES.SCREEN,
                    'normal': PIXI.BLEND_MODES.NORMAL
                };
                graphics.blendMode = blendModes[blend_mode] || PIXI.BLEND_MODES.MULTIPLY;
                graphics.zIndex = z_index;
                targetContainer.addChild(graphics);

                // Store ref on renderer for updateSubmersionOverlay compatibility
                ctx.renderer.submersionOverlay = graphics;
                ctx.renderer._submersionTint = tint;
            },
            remove() {
                if (graphics) {
                    const targetContainer = ctx.containers[container];
                    if (targetContainer) {
                        targetContainer.removeChild(graphics);
                    }
                    graphics.destroy();
                    graphics = null;
                    ctx.renderer.submersionOverlay = null;
                }
            }
        };
    },

    /**
     * Temporary ColorMatrixFilter.negative() on actor sprites.
     */
    color_invert(ctx, params) {
        let invertFilter = null;
        let sprites = [];
        let timeoutId = null;

        return {
            apply(runtimeParams) {
                const actor = runtimeParams?._target;
                const duration = runtimeParams?.duration_ms || runtimeParams?._definition?.duration_ms || 100;
                if (!actor) return;

                invertFilter = new PIXI.filters.ColorMatrixFilter();
                invertFilter.negative();

                sprites = [];
                if (actor.spriteBase) sprites.push(actor.spriteBase);
                if (actor.spriteTop) sprites.push(actor.spriteTop);
                if (actor.spriteEquipment?.top) sprites.push(actor.spriteEquipment.top);
                if (actor.spriteEquipment?.middle) sprites.push(actor.spriteEquipment.middle);
                if (actor.spriteEquipment?.lower) sprites.push(actor.spriteEquipment.lower);

                for (const sprite of sprites) {
                    sprite.filters = sprite.filters ? [...sprite.filters, invertFilter] : [invertFilter];
                }

                // Auto-remove after duration
                timeoutId = setTimeout(() => {
                    this.remove();
                }, duration);
            },
            remove() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (invertFilter) {
                    for (const sprite of sprites) {
                        if (sprite.filters) {
                            sprite.filters = sprite.filters.filter(f => f !== invertFilter);
                            if (sprite.filters.length === 0) sprite.filters = null;
                        }
                    }
                    invertFilter = null;
                    sprites = [];
                }
            }
        };
    },

    /**
     * TweenJS looping tint animation on a single sprite.
     */
    tint_flicker(ctx, params) {
        const {
            variation = '0x181808',
            lighter_ms = 80,
            wait1_ms = 150,
            base_ms = 200,
            wait2_ms = 300,
            darker_ms = 60,
            wait3_ms = 100
        } = params;

        let tween = null;

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                const baseTint = runtimeParams?.baseTint;
                if (!sprite || baseTint === undefined) return;

                const variationNum = typeof variation === 'string' ? parseInt(variation, 16) : variation;
                const colors = generateColorVariation(baseTint, variationNum);
                tween = new createjs.Tween.get(sprite, { loop: true })
                    .to({ tint: colors.lighter }, lighter_ms)
                    .wait(wait1_ms)
                    .to({ tint: baseTint }, base_ms)
                    .wait(wait2_ms)
                    .to({ tint: colors.darker }, darker_ms)
                    .wait(wait3_ms);
                const totalDuration = lighter_ms + wait1_ms + base_ms + wait2_ms + darker_ms + wait3_ms;
                tween.setPosition(Math.floor(Math.random() * totalDuration));
                sprite._flickerTween = tween;
            },
            remove() {
                if (tween) {
                    tween.setPaused(true);
                    tween = null;
                }
            }
        };
    },

    /**
     * Ticker sine-wave tint modulation on a single sprite.
     */
    tint_ripple(ctx, params) {
        const {
            slow_speed = 0.002,
            mod_speed = 0.000314,
            amplitude = 13,
            phase_factor = 0.618
        } = params;

        let entry = null;

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                const baseTint = runtimeParams?.baseTint;
                if (!sprite || baseTint === undefined) return;

                entry = {
                    sprite: sprite,
                    phase: Math.random() * Math.PI * 2,
                    baseR: (baseTint >> 16) & 0xFF,
                    baseG: (baseTint >> 8) & 0xFF,
                    baseB: baseTint & 0xFF
                };
                ctx.renderer._rippleSprites.push(entry);

                // Set up shared ticker if not already running
                if (!ctx.renderer._rippleTickerFn) {
                    ctx.renderer._rippleTickerFn = () => {
                        const t = Date.now();
                        for (const e of ctx.renderer._rippleSprites) {
                            if (e.sprite.destroyed) continue;
                            const slowSin = Math.sin(t * slow_speed + e.phase);
                            const modSin = Math.sin(t * mod_speed + e.phase * phase_factor);
                            const delta = Math.round(slowSin * (0.5 + 0.5 * modSin) * amplitude);
                            e.sprite.tint = (
                                (Math.min(255, Math.max(0, e.baseR + delta)) << 16) |
                                (Math.min(255, Math.max(0, e.baseG + delta)) << 8) |
                                 Math.min(255, Math.max(0, e.baseB + delta))
                            );
                        }
                    };
                    ctx.ticker.add(ctx.renderer._rippleTickerFn);
                }
            },
            remove() {
                if (entry) {
                    const idx = ctx.renderer._rippleSprites.indexOf(entry);
                    if (idx >= 0) ctx.renderer._rippleSprites.splice(idx, 1);
                    entry = null;
                }
            }
        };
    },

    /**
     * Per-tile background color rects with phased sine drift.
     */
    tile_color_drift(ctx, params) {
        const { amplitude = 60, throttle_frames = 4 } = params;
        let tileRects = null;
        let tilePhases = null;
        let tickerFn = null;

        return {
            apply() {
                const tw = globalVars.TILE_WIDTH;
                const th = globalVars.TILE_HEIGHT;
                const origColor = ctx.engine.config.backgroundColor;
                const origR = (origColor >> 16) & 0xFF;
                const origG = (origColor >> 8) & 0xFF;
                const origB = origColor & 0xFF;

                tileRects = [];
                tilePhases = [];
                for (let y = 0; y < ctx.mapHeight; y++) {
                    for (let x = 0; x < ctx.mapWidth; x++) {
                        const rect = new PIXI.Graphics();
                        rect.beginFill(origColor);
                        rect.drawRect(0, 0, tw, th);
                        rect.endFill();
                        rect.x = x * tw;
                        rect.y = y * th;
                        rect.zIndex = -1;
                        ctx.containers.background.addChild(rect);
                        tileRects.push(rect);
                        tilePhases.push(Math.random() * Math.PI * 2);
                    }
                }

                let frameCount = 0;
                tickerFn = () => {
                    if (++frameCount % throttle_frames !== 0) return;
                    const t = Date.now();
                    for (let i = 0; i < tileRects.length; i++) {
                        const p = tilePhases[i];
                        const r = Math.min(255, Math.max(0, origR + Math.round(Math.sin(t * 0.0005 + p) * amplitude)));
                        const g = Math.min(255, Math.max(0, origG + Math.round(Math.sin(t * 0.0007 + p + 2.0) * amplitude)));
                        const b = Math.min(255, Math.max(0, origB + Math.round(Math.sin(t * 0.0003 + p + 4.0) * amplitude)));
                        tileRects[i].tint = (r << 16) | (g << 8) | b;
                    }
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (tileRects) {
                    for (const rect of tileRects) {
                        ctx.containers.background.removeChild(rect);
                        rect.destroy();
                    }
                    tileRects = null;
                    tilePhases = null;
                }
            }
        };
    },

    /**
     * Replace actor textures with random tiles + random tints.
     */
    texture_scramble(ctx, params) {
        const { skip_player = true } = params;
        let originalActorTextures = null;
        const bgRects = [];

        return {
            apply() {
                const spriteLib = ctx.spriteLibrary;
                const actors = ctx.engine.entityManager?.actors;
                if (!actors || !spriteLib) return;

                const tw = globalVars.TILE_WIDTH;
                const th = globalVars.TILE_HEIGHT;

                if (!originalActorTextures) {
                    originalActorTextures = new Map();
                }

                // Remove previous tick's background rects
                for (const rect of bgRects) {
                    rect.parent?.removeChild(rect);
                    rect.destroy();
                }
                bgRects.length = 0;

                for (const actor of actors) {
                    if (actor.isDead) continue;
                    if (skip_player && actor.isPlayerControlled()) continue;

                    if (!originalActorTextures.has(actor)) {
                        originalActorTextures.set(actor, {
                            baseTexture: actor.spriteBase ? actor.spriteBase.texture : null,
                            topTexture: actor.spriteTop ? actor.spriteTop.texture : null,
                            baseTint: actor.spriteBase ? actor.spriteBase.tint : 0xFFFFFF,
                            topTint: actor.spriteTop ? actor.spriteTop.tint : 0xFFFFFF
                        });
                    }

                    if (actor.spriteBase) {
                        const tile = spriteLib.getRandomTile();
                        if (!(actor.spriteBase instanceof PIXI.AnimatedSprite)) {
                            ctx.renderer.updateSpriteTexture(actor.spriteBase, tile);
                        }
                        actor._hallucinatedTileNameBase = tile.name;
                    }
                    if (actor.spriteTop) {
                        const tile = spriteLib.getRandomTile();
                        if (!(actor.spriteTop instanceof PIXI.AnimatedSprite)) {
                            ctx.renderer.updateSpriteTexture(actor.spriteTop, tile);
                        }
                        actor._hallucinatedTileNameTop = tile.name;
                    }

                    const tint = randomElement(HALLUCINATION_TINTS);
                    if (actor.spriteBase) actor.spriteBase.tint = tint;
                    if (actor.spriteTop) actor.spriteTop.tint = tint;

                    // Add solid background fills behind scrambled sprites
                    // so transparent tile art doesn't blend with the floor
                    const darkTint = ((tint >> 1) & 0x7F7F7F); // darken the tint
                    if (actor.spriteBase) {
                        const bg = new PIXI.Graphics();
                        bg.beginFill(darkTint);
                        bg.drawRect(0, 0, tw, th);
                        bg.endFill();
                        bg.x = actor.spriteBase.x;
                        bg.y = actor.spriteBase.y;
                        bg.zIndex = actor.spriteBase.zIndex - 1;
                        ctx.containers.entity.addChild(bg);
                        bgRects.push(bg);
                    }
                    if (actor.spriteTop) {
                        const bg = new PIXI.Graphics();
                        bg.beginFill(darkTint);
                        bg.drawRect(0, 0, tw, th);
                        bg.endFill();
                        bg.x = actor.spriteTop.x;
                        bg.y = actor.spriteTop.y;
                        bg.zIndex = actor.spriteTop.zIndex - 1;
                        ctx.containers.entity.addChild(bg);
                        bgRects.push(bg);
                    }
                }
            },
            tick() {
                // Re-scramble on each tick
                this.apply();
            },
            remove() {
                for (const rect of bgRects) {
                    rect.parent?.removeChild(rect);
                    rect.destroy();
                }
                bgRects.length = 0;

                if (originalActorTextures) {
                    for (const [actor, originals] of originalActorTextures) {
                        if (actor.spriteBase && originals.baseTexture) {
                            actor.spriteBase.texture = originals.baseTexture;
                            actor.spriteBase.tint = originals.baseTint;
                        }
                        if (actor.spriteTop && originals.topTexture) {
                            actor.spriteTop.texture = originals.topTexture;
                            actor.spriteTop.tint = originals.topTint;
                        }
                        delete actor._hallucinatedTileNameBase;
                        delete actor._hallucinatedTileNameTop;
                    }
                    originalActorTextures = null;
                }
            }
        };
    },

    /**
     * Offsets stage position with random displacement that decays over duration, then auto-removes.
     */
    screen_shake(ctx, params) {
        const { intensity = 6, duration_ms = 200, decay = true } = params;
        let tickerFn = null;
        let timeoutId = null;
        let startTime = 0;

        return {
            apply() {
                startTime = Date.now();

                tickerFn = () => {
                    const elapsed = Date.now() - startTime;
                    const decayFactor = decay ? Math.max(0, 1 - elapsed / duration_ms) : 1;
                    ctx.stage.position.x = Math.round((Math.random() - 0.5) * 2 * intensity * decayFactor);
                    ctx.stage.position.y = Math.round((Math.random() - 0.5) * 2 * intensity * decayFactor);
                };
                ctx.ticker.add(tickerFn);

                timeoutId = setTimeout(() => {
                    this.remove();
                }, duration_ms);
            },
            remove() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                ctx.stage.position.x = 0;
                ctx.stage.position.y = 0;
            }
        };
    },

    /**
     * Fullscreen color rectangle that fades from initial opacity to 0, then auto-removes.
     */
    canvas_flash(ctx, params) {
        const { color = 0xFFFFFF, duration_ms = 150, opacity = 0.5, blend_mode = 'normal' } = params;
        let graphics = null;
        let tickerFn = null;
        let startTime = 0;

        return {
            apply() {
                const colorNum = typeof color === 'string' ? parseInt(color, 16) : color;

                graphics = new PIXI.Graphics();
                graphics.beginFill(colorNum);
                if (ctx.engine.viewportEnabled) {
                    graphics.drawRect(
                        ctx.engine.sectionOriginX * globalVars.TILE_WIDTH,
                        ctx.engine.sectionOriginY * globalVars.TILE_HEIGHT,
                        ctx.engine.viewportWidth * globalVars.TILE_WIDTH,
                        ctx.engine.viewportHeight * globalVars.TILE_HEIGHT
                    );
                } else {
                    graphics.drawRect(0, 0, ctx.mapWidth * globalVars.TILE_WIDTH, ctx.mapHeight * globalVars.TILE_HEIGHT);
                }
                graphics.endFill();

                const blendModes = {
                    'multiply': PIXI.BLEND_MODES.MULTIPLY,
                    'add': PIXI.BLEND_MODES.ADD,
                    'screen': PIXI.BLEND_MODES.SCREEN,
                    'normal': PIXI.BLEND_MODES.NORMAL
                };
                graphics.blendMode = blendModes[blend_mode] || PIXI.BLEND_MODES.NORMAL;
                graphics.alpha = opacity;
                graphics.zIndex = 9999;
                ctx.containers.ui.addChild(graphics);

                startTime = Date.now();
                tickerFn = () => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(1, elapsed / duration_ms);
                    graphics.alpha = opacity * (1 - progress);
                    if (progress >= 1) {
                        this.remove();
                    }
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (graphics) {
                    ctx.containers.ui.removeChild(graphics);
                    graphics.destroy();
                    graphics = null;
                }
            }
        };
    },

    /**
     * Applies BlurFilter to stage or a container, with optional sine-wave oscillation.
     */
    blur_pulse(ctx, params) {
        const { container = null, strength = 4, speed = 0.002, min_strength = 0, max_strength = 6, quality = 2 } = params;
        let filter = null;
        let tickerFn = null;
        let target = null;

        return {
            apply() {
                target = container ? ctx.containers[container] : ctx.stage;
                if (!target) return;

                filter = new PIXI.filters.BlurFilter(strength, quality);
                target.filters = target.filters ? [...target.filters, filter] : [filter];

                if (speed > 0) {
                    tickerFn = () => {
                        const t = Date.now();
                        filter.blur = min_strength + (max_strength - min_strength) * (0.5 + 0.5 * Math.sin(t * speed));
                    };
                    ctx.ticker.add(tickerFn);
                }
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (filter && target && target.filters) {
                    target.filters = target.filters.filter(f => f !== filter);
                    if (target.filters.length === 0) target.filters = null;
                }
                filter = null;
                target = null;
            }
        };
    },

    /**
     * Sine-wave alpha oscillation on a container.
     */
    alpha_pulse(ctx, params) {
        const { container = null, speed = 0.003, min_alpha = 0.3, max_alpha = 1.0 } = params;
        let tickerFn = null;
        let target = null;
        let originalAlpha = 1;

        return {
            apply() {
                target = container ? ctx.containers[container] : ctx.stage;
                if (!target) return;

                originalAlpha = target.alpha;

                tickerFn = () => {
                    const t = Date.now();
                    target.alpha = min_alpha + (max_alpha - min_alpha) * (0.5 + 0.5 * Math.sin(t * speed));
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) {
                    ctx.ticker.remove(tickerFn);
                    tickerFn = null;
                }
                if (target) {
                    target.alpha = originalAlpha;
                    target = null;
                }
            }
        };
    },

    /**
     * Swap random floor tile textures per tick.
     */
    floor_swap(ctx, params) {
        const { count_min = 1, count_max = 2 } = params;
        let originalFloorTextures = null;

        return {
            apply() {
                // Save original floor textures on first apply
                if (!originalFloorTextures) {
                    originalFloorTextures = ctx.floorSprites.map(row =>
                        row.map(sprite => sprite ? sprite.texture : null)
                    );
                }
            },
            tick() {
                const spriteLib = ctx.spriteLibrary;
                if (!spriteLib) return;

                const tileCount = count_min + Math.floor(Math.random() * (count_max - count_min + 1));
                for (let i = 0; i < tileCount; i++) {
                    if (ctx.floorSprites.length === 0) break;
                    const y = Math.floor(Math.random() * ctx.floorSprites.length);
                    const row = ctx.floorSprites[y];
                    if (!row || row.length === 0) continue;
                    const x = Math.floor(Math.random() * row.length);
                    const sprite = row[x];
                    if (!sprite || !sprite.visible) continue;
                    ctx.renderer.updateSpriteTexture(sprite, spriteLib.getRandomTileIndex());
                }
            },
            remove() {
                // Restore original floor textures
                if (originalFloorTextures) {
                    for (let y = 0; y < originalFloorTextures.length; y++) {
                        for (let x = 0; x < originalFloorTextures[y].length; x++) {
                            const sprite = ctx.floorSprites[y]?.[x];
                            const tex = originalFloorTextures[y][x];
                            if (sprite && tex) {
                                sprite.texture = tex;
                                sprite.tint = 0xFFFFFF;
                            }
                        }
                    }
                    originalFloorTextures = null;
                }
            }
        };
    }
};

// ============================================================================
// EFFECT RUNNER
// ============================================================================

class EffectRunner {
    constructor(renderer) {
        this.renderer = renderer;
        this._effects = {};       // Loaded effect definitions from JSON
        this._active = new Map(); // handleId -> { definition, layerHandles[], target }
        this._nextId = 1;

        // Build context object for primitives
        this.ctx = {
            app: renderer.app,
            stage: renderer.app.stage,
            ticker: renderer.app.ticker,
            containers: {
                background: renderer.backgroundContainer,
                floor: renderer.floorContainer,
                entity: renderer.entityContainer,
                darkness: renderer.darknessContainer,
                ui: renderer.uiContainer
            },
            get floorSprites() { return renderer.floorSprites; },
            get mapWidth() { return renderer.mapWidth; },
            get mapHeight() { return renderer.mapHeight; },
            engine: renderer.engine,
            get spriteLibrary() { return renderer.engine.spriteLibrary; },
            renderer: renderer
        };
    }

    /**
     * Load effect definitions from parsed JSON data
     * @param {Object} effectsData - Effect definitions keyed by name
     */
    loadEffects(effectsData) {
        Object.assign(this._effects, effectsData);
    }

    /**
     * Instantiate and apply a named effect
     * @param {string} effectName - Name of the effect from definitions
     * @param {*} target - Target object (sprite, actor, etc.) depending on effect type
     * @param {Object} runtimeParams - Additional parameters passed at apply time
     * @returns {number} Handle ID for later tick/remove, or 0 if effect not found
     */
    apply(effectName, target, runtimeParams) {
        const definition = this._effects[effectName];
        if (!definition) {
            console.warn(`Effect '${effectName}' not found in loaded definitions`);
            return 0;
        }

        const handleId = this._nextId++;
        const layerHandles = [];

        // Instantiate each layer's primitive
        if (definition.layers) {
            for (const layer of definition.layers) {
                const primitiveFn = EffectPrimitives[layer.primitive];
                if (!primitiveFn) {
                    console.warn(`Effect primitive '${layer.primitive}' not found`);
                    continue;
                }

                const instance = primitiveFn(this.ctx, layer.params || {});
                instance.apply({
                    ...runtimeParams,
                    _target: target,
                    _definition: definition
                });
                layerHandles.push(instance);
            }
        }

        // Instantiate on_tick primitives (they get apply() called once, then tick() each turn)
        const tickHandles = [];
        if (definition.on_tick) {
            for (const layer of definition.on_tick) {
                const primitiveFn = EffectPrimitives[layer.primitive];
                if (!primitiveFn) {
                    console.warn(`Effect primitive '${layer.primitive}' not found`);
                    continue;
                }

                const instance = primitiveFn(this.ctx, layer.params || {});
                instance.apply({
                    ...runtimeParams,
                    _target: target,
                    _definition: definition
                });
                tickHandles.push(instance);
            }
        }

        this._active.set(handleId, {
            definition,
            layerHandles,
            tickHandles,
            target
        });

        return handleId;
    }

    /**
     * Per-turn tick for effects that have on_tick layers
     * @param {number} handleId - Handle from apply()
     */
    tick(handleId) {
        const entry = this._active.get(handleId);
        if (!entry) return;

        if (entry.tickHandles) {
            for (const handle of entry.tickHandles) {
                if (handle.tick) handle.tick();
            }
        }
    }

    /**
     * Remove and clean up an active effect
     * @param {number} handleId - Handle from apply()
     */
    remove(handleId) {
        const entry = this._active.get(handleId);
        if (!entry) return;

        for (const handle of entry.layerHandles) {
            if (handle.remove) handle.remove();
        }
        if (entry.tickHandles) {
            for (const handle of entry.tickHandles) {
                if (handle.remove) handle.remove();
            }
        }

        this._active.delete(handleId);
    }

    /**
     * Remove all active effects (e.g., on level transition)
     */
    removeAll() {
        for (const handleId of this._active.keys()) {
            this.remove(handleId);
        }
    }
}

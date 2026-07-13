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

/**
 * Convert HSV (all components 0..1) to a packed 0xRRGGBB integer for use as a PIXI tint.
 * Used by the hue_cycle primitive; standalone so it stays self-contained in effects.js.
 */
function hsvToRgbInt(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q; break;
    }
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
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
                if (actor.spriteSide) sprites.push(actor.spriteSide);
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
     * Parametric tint cycle — shared ticker drives per-channel hue shift and/or
     * uniform brightness oscillation. Waveform "step" quantizes to three levels
     * for a stutter-step fire look; "sine" gives smooth modulation.
     */
    tint_cycle(ctx, params) {
        const {
            color_variation = '0x000000',
            amplitude = 0,
            speed = 0.002,
            mod_speed = 0,
            phase_factor = 0.618,
            waveform = 'sine',
            step_up = 0.33,
            step_down = -0.33,
            blend = 0
        } = params;

        const cv = typeof color_variation === 'string' ? parseInt(color_variation, 16) : color_variation;
        const cvR = (cv >> 16) & 0xFF;
        const cvG = (cv >> 8) & 0xFF;
        const cvB = cv & 0xFF;

        let entry = null;

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                const baseTint = runtimeParams?.baseTint;
                if (!sprite || baseTint === undefined) return;

                entry = {
                    sprite,
                    phase: Math.random() * Math.PI * 2,
                    baseR: (baseTint >> 16) & 0xFF,
                    baseG: (baseTint >> 8) & 0xFF,
                    baseB: baseTint & 0xFF,
                    cvR, cvG, cvB,
                    amplitude,
                    speed,
                    mod_speed,
                    phase_factor,
                    waveform,
                    step_up, step_down, blend
                };
                ctx.renderer._tintCycleSprites.push(entry);

                if (!ctx.renderer._tintCycleTickerFn) {
                    ctx.renderer._tintCycleTickerFn = () => {
                        const t = Date.now();
                        for (const e of ctx.renderer._tintCycleSprites) {
                            if (e.sprite.destroyed) continue;

                            const primary = Math.sin(t * e.speed + e.phase);
                            const mod = e.mod_speed > 0
                                ? (0.5 + 0.5 * Math.sin(t * e.mod_speed + e.phase * e.phase_factor))
                                : 1.0;
                            let wave = primary * mod;

                            if (e.waveform === 'step') {
                                if (e.blend > 0) {
                                    const hw = e.blend * 0.5;
                                    if (wave >= e.step_up + hw) wave = 1;
                                    else if (wave >= e.step_up - hw) wave = (wave - (e.step_up - hw)) / (2 * hw);
                                    else if (wave <= e.step_down - hw) wave = -1;
                                    else if (wave <= e.step_down + hw) wave = -((e.step_down + hw) - wave) / (2 * hw);
                                    else wave = 0;
                                } else {
                                    if (wave > e.step_up) wave = 1;
                                    else if (wave < e.step_down) wave = -1;
                                    else wave = 0;
                                }
                            }

                            const hR = Math.round(wave * e.cvR);
                            const hG = Math.round(wave * e.cvG);
                            const hB = Math.round(wave * e.cvB);
                            const bright = Math.round(wave * e.amplitude);

                            e.sprite.tint = (
                                (Math.min(255, Math.max(0, e.baseR + hR + bright)) << 16) |
                                (Math.min(255, Math.max(0, e.baseG + hG + bright)) << 8) |
                                 Math.min(255, Math.max(0, e.baseB + hB + bright))
                            );
                        }
                    };
                    ctx.ticker.add(ctx.renderer._tintCycleTickerFn);
                }
            },
            remove() {
                if (entry) {
                    const idx = ctx.renderer._tintCycleSprites.indexOf(entry);
                    if (idx >= 0) ctx.renderer._tintCycleSprites.splice(idx, 1);
                    entry = null;
                }
            }
        };
    },

    /**
     * Continuous rainbow hue rotation. Unlike tint_cycle (which oscillates brightness/
     * channel offset around a base and so barely moves a white sprite), this rotates a
     * sprite's tint smoothly through the full hue wheel via HSV — a vivid, always-moving
     * color cycle that shows clearly on a white sprite. Runtime params: baseTint (only
     * its brightness is used as the HSV value, so 0xFFFFFF = full brightness) and
     * spatial_phase (radians, offsets this sprite in the cycle so a field of sprites
     * flows rather than all showing one flat color). Shares a renderer-level ticker and
     * sprite list, mirroring tint_cycle.
     */
    hue_cycle(ctx, params) {
        const {
            speed = 0.0012,       // radians of hue advance per ms
            saturation = 0.55,    // 0..1
        } = params;

        let entry = null;

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                if (!sprite) return;
                const baseTint = runtimeParams?.baseTint ?? 0xFFFFFF;
                // Use the brightest channel of baseTint as the HSV value, so a white base
                // gives full-brightness colors and a dimmer base mutes them.
                const value = Math.max(
                    (baseTint >> 16) & 0xFF,
                    (baseTint >> 8) & 0xFF,
                    baseTint & 0xFF
                ) / 255;

                entry = {
                    sprite,
                    speed,
                    saturation,
                    value,
                    spatialPhase: runtimeParams?.spatial_phase ?? (Math.random() * Math.PI * 2),
                };
                if (!ctx.renderer._hueCycleSprites) ctx.renderer._hueCycleSprites = [];
                ctx.renderer._hueCycleSprites.push(entry);

                if (!ctx.renderer._hueCycleTickerFn) {
                    ctx.renderer._hueCycleTickerFn = () => {
                        const t = Date.now();
                        const TWO_PI = Math.PI * 2;
                        for (const e of ctx.renderer._hueCycleSprites) {
                            if (e.sprite.destroyed) continue;
                            const hue = (((t * e.speed + e.spatialPhase) % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI;
                            e.sprite.tint = hsvToRgbInt(hue, e.saturation, e.value);
                        }
                    };
                    ctx.ticker.add(ctx.renderer._hueCycleTickerFn);
                }
            },
            remove() {
                if (entry) {
                    const list = ctx.renderer._hueCycleSprites;
                    const idx = list ? list.indexOf(entry) : -1;
                    if (idx >= 0) list.splice(idx, 1);
                    entry = null;
                }
            }
        };
    },

    /**
     * Animated multi-color gradient wave. Each sprite's tint cycles around a palette of
     * colors as a ring (last color lerps back to the first) driven by time plus the
     * sprite's spatial_phase runtime param. Feeding spatial_phase from a single axis
     * (e.g. row) makes parallel bands; advancing time scrolls them. The phase uses
     * (time*speed + spatialPhase), so a spatial_phase that increases downward (with screen
     * row y) scrolls the bands UPWARD. Reusable for any banded color wave.
     * Params: colors (array of 0xRRGGBB ints or "0x.." strings) — falls back to
     * [color_a, color_b] for backward compatibility; speed (radians/ms).
     */
    gradient_wave(ctx, params) {
        const parseColor = (c) => (typeof c === 'string' ? parseInt(c, 16) : c);
        let palette = Array.isArray(params.colors) && params.colors.length >= 2
            ? params.colors.map(parseColor)
            : [parseColor(params.color_a ?? 0xFF0000), parseColor(params.color_b ?? 0xFFDD00)];
        // Pre-split into RGB stops for the ticker.
        const stops = palette.map(c => [(c >> 16) & 0xFF, (c >> 8) & 0xFF]);
        const speed = params.speed ?? 0.0015;

        let entry = null;

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                if (!sprite) return;

                entry = {
                    sprite,
                    speed,
                    stops,
                    spatialPhase: runtimeParams?.spatial_phase ?? 0,
                };
                if (!ctx.renderer._gradientWaveSprites) ctx.renderer._gradientWaveSprites = [];
                ctx.renderer._gradientWaveSprites.push(entry);

                if (!ctx.renderer._gradientWaveTickerFn) {
                    const TWO_PI = Math.PI * 2;
                    ctx.renderer._gradientWaveTickerFn = () => {
                        const t = Date.now();
                        for (const e of ctx.renderer._gradientWaveSprites) {
                            if (e.sprite.destroyed) continue;
                            const n = e.stops.length;
                            // Wrapping 0..1 position around the palette ring; + spatialPhase
                            // (rises with row y) scrolls bands upward as t grows.
                            const phase = (((t * e.speed + e.spatialPhase) % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI;
                            const scaled = phase * n;            // 0..n across the ring
                            const i0 = Math.floor(scaled) % n;
                            const i1 = (i0 + 1) % n;
                            const f = scaled - Math.floor(scaled);
                            const a = e.stops[i0], b = e.stops[i1];
                            const r = Math.round(a[0] + (b[0] - a[0]) * f);
                            const g = Math.round(a[1] + (b[1] - a[1]) * f);
                            const bl = Math.round(a[2] + (b[2] - a[2]) * f);
                            e.sprite.tint = (r << 16) | (g << 8) | bl;
                        }
                    };
                    ctx.ticker.add(ctx.renderer._gradientWaveTickerFn);
                }
            },
            remove() {
                if (entry) {
                    const list = ctx.renderer._gradientWaveSprites;
                    const idx = list ? list.indexOf(entry) : -1;
                    if (idx >= 0) list.splice(idx, 1);
                    entry = null;
                }
            }
        };
    },

    /**
     * Random timer-based tint flicker — mimics the old CreateJS Tween fire effect.
     * Cycles through lighter/base/darker states with randomized hold durations.
     */
    tint_flicker(ctx, params) {
        const {
            color_variation = '0x181808',
            lighter_min = 100, lighter_max = 280,
            base_min = 200, base_max = 500,
            darker_min = 80, darker_max = 200,
            transition_ms = 80
        } = params;

        const cv = typeof color_variation === 'string' ? parseInt(color_variation, 16) : color_variation;
        const cvR = (cv >> 16) & 0xFF;
        const cvG = (cv >> 8) & 0xFF;
        const cvB = cv & 0xFF;

        let entry = null;

        function randRange(min, max) { return min + Math.random() * (max - min); }

        function pickNext(e) {
            const roll = Math.random();
            if (roll < 0.35) {
                e.targetState = 1;
                e.holdMs = randRange(e.lighter_min, e.lighter_max);
            } else if (roll < 0.65) {
                e.targetState = -1;
                e.holdMs = randRange(e.darker_min, e.darker_max);
            } else {
                e.targetState = 0;
                e.holdMs = randRange(e.base_min, e.base_max);
            }
            e.transitionStart = Date.now();
            e.transitionEnd = e.transitionStart + e.transition_ms;
            e.holdEnd = e.transitionEnd + e.holdMs;
            e.prevState = e.currentState;
        }

        return {
            apply(runtimeParams) {
                const sprite = runtimeParams?._target;
                const baseTint = runtimeParams?.baseTint;
                if (!sprite || baseTint === undefined) return;

                entry = {
                    sprite,
                    baseR: (baseTint >> 16) & 0xFF,
                    baseG: (baseTint >> 8) & 0xFF,
                    baseB: baseTint & 0xFF,
                    cvR, cvG, cvB,
                    lighter_min, lighter_max,
                    base_min, base_max,
                    darker_min, darker_max,
                    transition_ms,
                    currentState: 0,
                    prevState: 0,
                    targetState: 0,
                    holdMs: 0,
                    transitionStart: 0,
                    transitionEnd: 0,
                    holdEnd: 0
                };
                pickNext(entry);
                entry.holdEnd = Date.now() + randRange(base_min, base_max);

                if (!ctx.renderer._tintFlickerSprites) ctx.renderer._tintFlickerSprites = [];
                ctx.renderer._tintFlickerSprites.push(entry);

                if (!ctx.renderer._tintFlickerTickerFn) {
                    ctx.renderer._tintFlickerTickerFn = () => {
                        const now = Date.now();
                        for (const e of ctx.renderer._tintFlickerSprites) {
                            if (e.sprite.destroyed) continue;

                            if (now >= e.holdEnd) {
                                e.currentState = e.targetState;
                                pickNext(e);
                            }

                            let state;
                            if (now < e.transitionEnd) {
                                const t = (now - e.transitionStart) / e.transition_ms;
                                state = e.prevState + (e.targetState - e.prevState) * t;
                            } else {
                                state = e.targetState;
                            }

                            const rr = Math.min(255, Math.max(0, e.baseR + Math.round(state * e.cvR)));
                            const gg = Math.min(255, Math.max(0, e.baseG + Math.round(state * e.cvG)));
                            const bb = Math.min(255, Math.max(0, e.baseB + Math.round(state * e.cvB)));
                            e.sprite.tint = (rr << 16) | (gg << 8) | bb;
                        }
                    };
                    ctx.ticker.add(ctx.renderer._tintFlickerTickerFn);
                }
            },
            remove() {
                if (entry && ctx.renderer._tintFlickerSprites) {
                    const idx = ctx.renderer._tintFlickerSprites.indexOf(entry);
                    if (idx >= 0) ctx.renderer._tintFlickerSprites.splice(idx, 1);
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
        const { color = 0xFFFFFF, duration_ms = 150, opacity = 0.5, blend_mode = 'normal', z_index = 9999 } = params;
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
                graphics.zIndex = z_index;
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
     * Radiating tile fill effect — fills tiles ring-by-ring outward from _target by Manhattan distance.
     * Each ring appears after a staggered delay, then the whole effect fades out.
     */
    radial_tile_fill(ctx, params) {
        const {
            color = 0xCC8844, duration_ms = 600, radius = 3,
            opacity = 0.7, ring_delay_ms = 60, fade_ms = 300,
            blend_mode = 'multiply'
        } = params;
        let tileSprites = [];
        let tickerFn = null;
        let startTime = 0;

        return {
            apply(runtimeParams) {
                const target = runtimeParams?._target;
                if (!target) return;
                const tw = globalVars.TILE_WIDTH;
                const th = globalVars.TILE_HEIGHT;
                const cx = target.x;
                const cy = target.y;
                const colorNum = typeof color === 'string' ? parseInt(color, 16) : color;
                const blendMode = PIXI.BLEND_MODES[blend_mode?.toUpperCase()] || PIXI.BLEND_MODES.MULTIPLY;

                // Build rings by Manhattan distance
                for (let dist = 0; dist <= radius; dist++) {
                    for (let dx = -dist; dx <= dist; dx++) {
                        const dyAbs = dist - Math.abs(dx);
                        const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];
                        for (const dy of dys) {
                            const g = new PIXI.Graphics();
                            g.beginFill(colorNum, 1);
                            g.drawRect(0, 0, tw, th);
                            g.endFill();
                            g.x = (cx + dx) * tw;
                            g.y = (cy + dy) * th;
                            g.alpha = 0;
                            g.blendMode = blendMode;
                            g.zIndex = 7;
                            ctx.containers.ui.addChild(g);
                            tileSprites.push({ graphic: g, dist });
                        }
                    }
                }

                startTime = Date.now();
                const totalDuration = duration_ms + fade_ms;

                tickerFn = () => {
                    const elapsed = Date.now() - startTime;

                    for (const tile of tileSprites) {
                        const ringStart = tile.dist * ring_delay_ms;
                        const tileElapsed = elapsed - ringStart;

                        if (tileElapsed < 0) {
                            tile.graphic.alpha = 0;
                        } else if (elapsed < duration_ms) {
                            // Fade in quickly
                            const fadeIn = Math.min(1, tileElapsed / 80);
                            tile.graphic.alpha = opacity * fadeIn;
                        } else {
                            // Fade out phase
                            const fadeProgress = Math.min(1, (elapsed - duration_ms) / fade_ms);
                            tile.graphic.alpha = opacity * (1 - fadeProgress);
                        }
                    }

                    if (elapsed >= totalDuration) {
                        this.remove();
                    }
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) { ctx.ticker.remove(tickerFn); tickerFn = null; }
                for (const tile of tileSprites) {
                    ctx.containers.ui.removeChild(tile.graphic);
                    tile.graphic.destroy();
                }
                tileSprites = [];
            }
        };
    },

    /**
     * Fills tiles along a path sequentially with staggered timing.
     * Reads path from runtimeParams.path (array of {x, y}).
     */
    line_tile_fill(ctx, params) {
        const {
            color = 0xAADDFF, duration_ms = 400, opacity = 0.9,
            tile_delay_ms = 25, fade_ms = 200, blend_mode = 'add'
        } = params;
        let tileSprites = [];
        let tickerFn = null;
        let startTime = 0;

        return {
            apply(runtimeParams) {
                const path = runtimeParams?.path;
                if (!path || path.length === 0) return;
                const tw = globalVars.TILE_WIDTH;
                const th = globalVars.TILE_HEIGHT;
                const colorNum = typeof color === 'string' ? parseInt(color, 16) : color;
                const blendMode = PIXI.BLEND_MODES[blend_mode?.toUpperCase()] || PIXI.BLEND_MODES.ADD;

                for (let i = 0; i < path.length; i++) {
                    const point = path[i];
                    const g = new PIXI.Graphics();
                    g.beginFill(colorNum, 1);
                    g.drawRect(0, 0, tw, th);
                    g.endFill();
                    g.x = point.x * tw;
                    g.y = point.y * th;
                    g.alpha = 0;
                    g.blendMode = blendMode;
                    g.zIndex = 7;
                    ctx.containers.ui.addChild(g);
                    tileSprites.push({ graphic: g, index: i });
                }

                startTime = Date.now();
                const lastTileStart = (path.length - 1) * tile_delay_ms;
                const totalDuration = lastTileStart + duration_ms + fade_ms;

                tickerFn = () => {
                    const elapsed = Date.now() - startTime;

                    for (const tile of tileSprites) {
                        const tileStart = tile.index * tile_delay_ms;
                        const tileElapsed = elapsed - tileStart;

                        if (tileElapsed < 0) {
                            tile.graphic.alpha = 0;
                        } else {
                            const holdEnd = tileStart + duration_ms;
                            if (elapsed < holdEnd) {
                                const fadeIn = Math.min(1, tileElapsed / 40);
                                tile.graphic.alpha = opacity * fadeIn;
                            } else {
                                const fadeProgress = Math.min(1, (elapsed - holdEnd) / fade_ms);
                                tile.graphic.alpha = opacity * (1 - fadeProgress);
                            }
                        }
                    }

                    if (elapsed >= totalDuration) {
                        this.remove();
                    }
                };
                ctx.ticker.add(tickerFn);
            },
            remove() {
                if (tickerFn) { ctx.ticker.remove(tickerFn); tickerFn = null; }
                for (const tile of tileSprites) {
                    ctx.containers.ui.removeChild(tile.graphic);
                    tile.graphic.destroy();
                }
                tileSprites = [];
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

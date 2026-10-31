/**
 * Prototype: a loaded prototype folder, its config and its merged data libraries.
 */

import { BASE_PATH, mergeEntityDef, mergeEntityLibrary, randomElement } from '../core/util.js';
import { spellAttributes } from '../core/spells.js';

// ============================================================================
// PROTOTYPE CLASS  (levels)
// ============================================================================

export class Prototype {
    constructor(name, config, engine) {
        this.name = name;
        this.config = config;
        this.engine = engine;
        this.basePath = `${BASE_PATH}/prototypes/${name}/`;

        // Identification tracking: maps item type -> true if identified this session
        this.identifiedTypes = new Set();

        // Random color assignments: maps item type -> assigned color object
        // This ensures all instances of the same item type get the same random color
        this.itemColorAssignments = new Map();

        // Random material assignments: maps item type -> material name string (e.g. "iron")
        // Used by rings, which are named by material rather than color
        this.itemMaterialAssignments = new Map();

        // Glyph name assignments: maps item type -> runic two-word string (e.g. "KZAMRN BIVUHL")
        // Ensures all instances of the same scroll type show the same unidentified name
        this.glyphNameAssignments = new Map();

        // Lock pairing system: tracks color-locked doors and their assigned colors
        // Each locked door gets a unique color, keys are assigned to match
        this.lockColors = [];           // Array of assigned lock colors (color objects)
        this.usedLockColors = new Set(); // Track which colors have been used
        this.unpairedLockColors = [];    // Colors assigned to doors but not yet to keys

        // Item catalog: category -> array of active item types for this run
        this.activeCatalog = new Map();
    }

    async loadAssets() {

        const prototypeActors = await this.loadJSON('actors.json', {});
        const prototypeItems = await this.loadJSON('items.json', {});
        const prototypePersonalities = await this.loadJSON('personalities.json', {});
        const prototypeEffects = await this.loadJSON('vfx.json', {});
        const prototypeKeybindings = await this.loadJSON('keybindings.json', {});
        const prototypeBiomes = await this.loadJSON('biomes.json', {});
        const prototypeAnimations = await this.loadJSON('animations.json', {});
        const prototypeTypes = await this.loadJSON('types.json', {});
        this.types = { ...this.engine.globalTypes, ...prototypeTypes };
        // Spells are read only by item resolution (getItemData), so a prototype's
        // spells.json simply replaces same-named base entries.
        const prototypeSpells = await this.loadJSON('spells.json', {});
        this.spells = { ...this.engine.globalSpells, ...prototypeSpells };
        // States are read straight off engine.globalStates from a dozen call sites
        // (innate states, applyAuthoredState, apply_state_radius, ...), so a
        // prototype's states are merged INTO that library rather than kept beside
        // it — every existing reader then sees them with no change.
        const prototypeStates = await this.loadJSON('states.json', {});
        // Merge off the pristine base, not the live library: prototypes can be
        // swapped at runtime (transitionToPrototype), and layering onto whatever
        // the previous prototype left behind would leak its states into this one.
        this.engine.baseStates ??= { ...this.engine.globalStates };
        this.states = { ...this.engine.baseStates, ...prototypeStates };
        this.engine.globalStates = this.states;
        // Actors merge per-entry rather than wholesale: a prototype that overrides
        // an existing actor supplements the base entry instead of replacing it, so
        // it only has to state what it changes (and keeps the base's `type`).
        // Brand-new prototype actors are unaffected — there is no base to merge.
        this.actors = mergeEntityLibrary(this.engine.globalActors, prototypeActors);
        this.items = { ...this.engine.globalItems, ...prototypeItems };
        this.personalities = { ...this.engine.globalPersonalities, ...prototypePersonalities };
        this.effects = { ...this.engine.globalEffects, ...prototypeEffects };
        // Biomes follow the same global-then-prototype merge as the entity data above.
        // resolveBiome reads config.biomes, so publish the merged library there — that
        // keeps the whole resolution path (resolveBiome, getFloorConfig, ...) unchanged
        // and means a prototype.json never needs an inline `biomes` block.
        this.biomes = { ...this.engine.globalBiomes, ...prototypeBiomes };
        this.config.biomes = this.biomes;
        // Animation sheets a prototype ships itself, merged over the base manifest.
        // Their `file` paths are relative to the prototype folder, so pac's chomp can
        // live with pac rather than in the shared sprite folder. Loading is deferred to
        // loadAnimationSheets below, since it needs PIXI and a network round trip.
        this.animations = { ...this.engine.globalAnimations, ...prototypeAnimations };
        this.keybindings = {
            movement: { ...this.engine.globalKeybindings?.movement, ...prototypeKeybindings.movement },
            actions: { ...this.engine.globalKeybindings?.actions, ...prototypeKeybindings.actions },
            global: { ...this.engine.globalKeybindings?.global, ...prototypeKeybindings.global },
            descriptions: { ...this.engine.globalKeybindings?.descriptions, ...prototypeKeybindings.descriptions }
        };
        this.engine.inputManager?.loadKeybindings(this.keybindings);

        // Load effects into the renderer's EffectRunner if available
        if (this.engine.renderer?.effectRunner) {
            this.engine.renderer.effectRunner.loadEffects(this.effects);
        }

        // Store prototype-specific keys for random distribution
        this.prototypeActorTypes = Object.keys(prototypeActors);
        this.prototypeItemTypes = Object.keys(prototypeItems);

        console.log(`Loaded assets for prototype: ${this.name}`);
        console.log(`  Actors: ${Object.keys(this.actors).length} (${this.prototypeActorTypes.length} prototype-specific)`);
        console.log(`  Items: ${Object.keys(this.items).length} (${this.prototypeItemTypes.length} prototype-specific)`);
        console.log(`  Personalities: ${Object.keys(this.personalities).length} (${Object.keys(prototypePersonalities).length} prototype-specific)`);

        if (Object.keys(this.biomes).length) {
            console.log(`  Biomes: ${Object.keys(this.biomes).length} (${Object.keys(prototypeBiomes).length} prototype-specific)`);
        }

        await this.loadAnimationSheets(prototypeAnimations);

        this.warnUnknownFloorPlanBiomes();
        this.initItemCatalog();
    }

    /**
     * Fetch and slice the sheets for animations this prototype declares itself.
     *
     * The base manifest is already loaded and sliced by the time any prototype exists,
     * so this only handles the additions — and only when there are some, which is the
     * common case, so most prototypes pay nothing.
     *
     * Awaited from loadAssets, which the engine awaits before the first render, so an
     * actor can reference a prototype animation on the very first frame.
     *
     * @param {Object} prototypeAnimations - Just this prototype's entries
     */
    async loadAnimationSheets(prototypeAnimations) {
        const pending = Object.entries(prototypeAnimations || {})
            .filter(([name]) => !this.engine.animationFrames?.[name]);
        if (pending.length === 0) return;

        this.engine.queueAnimationSheets(Object.fromEntries(pending), this.basePath);

        await new Promise((resolve) => {
            // PIXI's shared loader rejects a load() while one is in flight. Nothing else
            // loads at this point (global assets finished during initialize), but resolve
            // rather than hang if that ever stops being true.
            if (PIXI.Loader.shared.loading) {
                console.warn('Shared loader busy; prototype animations deferred.');
                return resolve();
            }
            PIXI.Loader.shared.load(() => resolve());
        });

        this.engine.setupAnimationFrames();
        console.log(`  Animations: ${pending.length} prototype-specific`);
    }

    /**
     * A floor_plan entry naming a biome that no library defines is silent by default:
     * resolveBiome finds nothing, returns {}, and those floors quietly fall back to
     * the prototype's own defaults. Since nothing validates prototype.json, say so.
     */
    warnUnknownFloorPlanBiomes() {
        const plan = this.config.floor_plan;
        if (!Array.isArray(plan)) return;
        for (const name of new Set(plan.map(p => p && p.biome).filter(Boolean))) {
            if (this.biomes[name]) continue;
            console.warn(
                `floor_plan references unknown biome "${name}" — not in data/biomes.json ` +
                `or prototypes/${this.name}/biomes.json. Those floors fall back to the ` +
                `prototype's own defaults.`
            );
        }
    }

    /**
     * Check if an item type has been identified in this prototype session
     */
    isTypeIdentified(itemType) {
        return this.identifiedTypes.has(itemType);
    }

    /**
     * Mark an item type as identified, affecting all items of that type
     */
    identifyType(itemType) {
        if (!this.identifiedTypes.has(itemType)) {
            this.identifiedTypes.add(itemType);
            console.log(`Item type '${itemType}' has been identified!`);

            // Update all existing items of this type
            if (this.engine.entityManager) {
                for (const item of this.engine.entityManager.items) {
                    if (item.type === itemType) {
                        item.identified = true;
                    }
                }
            }
        }
    }

    initItemCatalog() {
        const catalogConfig = this.config.item_catalog;
        // No catalog at all is the worst case for a biome that wants categories, so
        // warn before bailing out rather than after (activeCatalog stays empty, so
        // every category a biome asks for is unsatisfied).
        if (!catalogConfig) { this.warnUnsatisfiedBiomeCategories(); return; }

        for (const [category, catConfig] of Object.entries(catalogConfig)) {
            let pool = catConfig.pool;

            // No explicit pool: derive it from type membership, so adding an item
            // that declares this type is enough to put it in the pool. A raw
            // items.json entry with random_type still wins as a curated override.
            if (!pool) {
                pool = this.getItemsOfType(category);
                const metaItem = this.items[category];
                if (Array.isArray(metaItem?.random_type)) {
                    pool = [...metaItem.random_type];
                }
            }

            if (!pool || pool.length === 0) {
                console.warn(`item_catalog: No pool found for category "${category}"`);
                continue;
            }

            let activeTypes;
            if (catConfig.count !== undefined && catConfig.count < pool.length) {
                // Shuffle and pick N types for this run
                const shuffled = [...pool];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                activeTypes = shuffled.slice(0, catConfig.count);
            } else {
                activeTypes = [...pool];
            }

            this.activeCatalog.set(category, activeTypes);
            console.log(`item_catalog: ${category} — ${activeTypes.length} types active: ${activeTypes.join(', ')}`);
        }

        this.warnUnsatisfiedBiomeCategories();
    }

    /**
     * A biome's `items` rows name item_catalog CATEGORIES, but item_catalog lives only
     * at the prototype root. spawnBudgetItems silently skips any category that isn't in
     * activeCatalog, so a biome asking for a category this prototype doesn't provide
     * spawns nothing at all, with no other signal. That's a portability trap for shared
     * library biomes, so say so loudly at load.
     */
    warnUnsatisfiedBiomeCategories() {
        for (const [name, biome] of Object.entries(this.config.biomes || {})) {
            const wanted = (biome.items || [])
                .map(row => row && row.type)
                .filter(t => t && !this.activeCatalog.has(t));
            if (wanted.length === 0) continue;
            console.warn(
                `biome "${name}" wants item categories [${[...new Set(wanted)].join(', ')}] ` +
                `which this prototype's item_catalog does not provide — those items will ` +
                `not spawn. Add them to item_catalog, or use categories it defines.`
            );
        }
    }

    getCatalogStats(category) {
        const activeTypes = this.activeCatalog.get(category);
        if (!activeTypes) return null;
        const discovered = activeTypes.filter(t => this.identifiedTypes.has(t)).length;
        return { total: activeTypes.length, discovered };
    }

    getCatalogTypeForCategory(category) {
        const activeTypes = this.activeCatalog.get(category);
        if (!activeTypes || activeTypes.length === 0) return null;
        return activeTypes[Math.floor(ROT.RNG.getUniform() * activeTypes.length)];
    }

    /**
     * Get or assign a random color for an item type
     * Ensures all items of the same type get the same color within this prototype
     */
    getColorForItemType(itemType) {
        if (this.itemColorAssignments.has(itemType)) {
            return this.itemColorAssignments.get(itemType);
        }

        // Assign a random color from the global colors list
        const colors = this.engine.globalColors;
        if (colors && colors.length > 0) {
            const randomColor = randomElement(colors);
            this.itemColorAssignments.set(itemType, randomColor);
            console.log(`Assigned color '${randomColor.color}' (${randomColor.hex}) to item type '${itemType}'`);
            return randomColor;
        }

        return null;
    }

    /**
     * Get or assign a random material name for an item type (e.g. rings).
     * Mirrors getColorForItemType: all instances of the same type share the
     * same material within this prototype, so the unidentified name (e.g.
     * "iron ring") is a stable, learnable label. Materials come from
     * substances.json (minerals, woods, metals) rather than colors.
     * @returns {string|null}
     */
    getMaterialForItemType(itemType) {
        if (this.itemMaterialAssignments.has(itemType)) {
            return this.itemMaterialAssignments.get(itemType);
        }

        const materials = this.engine.globalSubstances?.substances;
        if (materials && materials.length > 0) {
            const material = randomElement(materials);
            this.itemMaterialAssignments.set(itemType, material);
            console.log(`Assigned material '${material}' to item type '${itemType}'`);
            return material;
        }

        return null;
    }

    /**
     * Get or assign a runic two-word name for a scroll item type.
     * All instances of the same scroll type show the same greeked name within this prototype.
     */
    getOrAssignScrollName(itemType) {
        if (this.glyphNameAssignments.has(itemType)) {
            return this.glyphNameAssignments.get(itemType);
        }
        const words = this.engine.globalWords?.scrolls?.scroll_glyphs;
        if (words && words.length > 0) {
            const name = `${randomElement(words)} ${randomElement(words)}`;
            this.glyphNameAssignments.set(itemType, name);
            return name;
        }
        return 'ARCANE';
    }

    /**
     * Assign a unique color to a locked door
     * Each door gets its own color that a matching key must have
     * @returns {Object|null} The assigned color object {color, hex}
     */
    assignLockColor() {
        const colors = this.engine.globalColors;
        if (!colors || colors.length === 0) return null;

        // Find an unused color
        const availableColors = colors.filter(c => !this.usedLockColors.has(c.color));

        if (availableColors.length === 0) {
            // All colors used, pick a random one (allows duplicate colors)
            const color = randomElement(colors);
            this.lockColors.push(color);
            this.unpairedLockColors.push(color);
            console.log(`Assigned lock color '${color.color}' (reused, all colors taken)`);
            return color;
        }

        // Pick a random unused color
        const color = randomElement(availableColors);
        this.usedLockColors.add(color.color);
        this.lockColors.push(color);
        this.unpairedLockColors.push(color);
        console.log(`Assigned lock color '${color.color}' to door`);
        return color;
    }

    /**
     * Get a color for a key that matches an unpaired locked door
     * @returns {Object|null} The assigned color object {color, hex}
     */
    getKeyColor() {
        // If there are unpaired doors, assign the key to one of them
        if (this.unpairedLockColors.length > 0) {
            const color = this.unpairedLockColors.shift(); // Take the first unpaired color
            console.log(`Assigned key color '${color.color}' to match a door`);
            return color;
        }

        // No unpaired doors - this key won't match anything yet
        // Assign a random color (the door might be spawned later)
        const colors = this.engine.globalColors;
        if (colors && colors.length > 0) {
            const color = randomElement(colors);
            console.log(`Assigned key color '${color.color}' (no unpaired doors)`);
            return color;
        }

        return null;
    }

    async loadJSON(filename, defaultValue) {
        try {
            const response = await fetch(this.basePath + filename);
            return await response.json();
        } catch (error) {
            console.warn(`No ${filename} found for prototype ${this.name}, using defaults`);
            return defaultValue;
        }
    }
    
    /**
     * Look up an actor definition, resolving its `type` if it declares one.
     *
     * Every spawn path funnels through here, so resolving at this single point
     * means the Actor constructor and everything downstream keep receiving one
     * flat definition and need no knowledge of types.
     *
     * Results are cached: definitions are static for the life of a prototype,
     * and this runs on every spawn.
     *
     * @param {string} actorType - The actor id key (e.g. 'goblin')
     * @returns {Object|null} The resolved definition, or null if unknown
     */
    getActorData(actorType) {
        const def = this.actors[actorType];
        if (!def) return null;
        if (!def.type) return def;

        if (!this._resolvedActors) this._resolvedActors = {};
        if (this._resolvedActors[actorType]) return this._resolvedActors[actorType];

        // types.json holds both domains. Anything not explicitly an item type is
        // fair game — a prototype types.json that predates `domain` and omits it
        // keeps resolving, but an item type can never leak into an actor.
        const typeDef = this.types?.[def.type];
        if (!typeDef || typeDef.domain === 'item') {
            console.warn(`Actor '${actorType}' declares unknown actor type '${def.type}'`);
            this._resolvedActors[actorType] = def;
            return def;
        }

        // Only the shared entity fields are inherited. A type's own bookkeeping
        // (name, description, domain) describes the type itself, not its members
        // — inheriting `name` would rename every beast to "Beast".
        const { name, description, domain, ...inheritable } = typeDef;
        const resolved = mergeEntityDef(inheritable, def);
        this._resolvedActors[actorType] = resolved;
        return resolved;
    }


    /**
     * Item ids belonging to an item type, derived from membership.
     *
     * Inverts the old hand-maintained `random_type` arrays: an item declaring
     * `"type": "potion"` IS a potion, so adding one can't forget to update a
     * list somewhere else. Built once and cached — item libraries are static
     * for the life of a prototype.
     *
     * @param {string} typeKey - An item type key (e.g. 'potion')
     * @returns {string[]} Item ids declaring that type; empty if none do
     */
    getItemsOfType(typeKey) {
        if (!this._itemsByType) {
            this._itemsByType = {};
            for (const [id, def] of Object.entries(this.items)) {
                if (id.startsWith('_') || !def?.type) continue;
                (this._itemsByType[def.type] ||= []).push(id);
            }
        }
        const members = this._itemsByType[typeKey] || [];
        // A type declaring `"pool": "prototype"` (treasure) draws only on items this
        // prototype defines itself, so a prototype never inherits the base game's
        // treasure. item_catalog can still name base items in an explicit `pool`.
        if (this.types?.[typeKey]?.pool === 'prototype') {
            return members.filter(id => this.prototypeItemTypes?.includes(id));
        }
        return members;
    }

    /**
     * Look up an item definition, resolving its `type` if it declares one.
     *
     * The item mirror of getActorData: every `new Item()` funnels through here,
     * so resolving at this one point keeps the Item constructor and everything
     * downstream receiving a single flat definition.
     *
     * Also accepts a bare item TYPE ('potion'), which means "roll a member of
     * that type" — the job the hollow `random_type` meta-entries used to do.
     * Callers that construct an Item must prefer `resolved.id` over the string
     * they passed in, or a rolled item would carry the category as its id and
     * every potion would share one color and one identification state.
     *
     * @param {string} itemType - An item id ('health_potion') or item type ('potion')
     * @returns {Object|null} The resolved definition, or null if unknown
     */
    getItemData(itemType) {
        const def = this.items[itemType];

        if (!def) {
            // Not an item id. If it names an item type, roll one of its members.
            // Prefer the run's active catalog so a default_items entry or a Tiled
            // placement can't leak a type this run deliberately excluded.
            const typeDef = this.types?.[itemType];
            if (typeDef?.domain === 'item') {
                const pool = this.getItemsOfType(itemType);
                const rolled = this.getCatalogTypeForCategory(itemType)
                    || (pool.length ? pool[Math.floor(ROT.RNG.getUniform() * pool.length)] : null);
                if (!rolled) {
                    // A prototype-scoped pool is allowed to be empty: no treasure here.
                    if (typeDef.pool !== 'prototype') {
                        console.warn(`Item type '${itemType}' has no members to roll`);
                    }
                    return null;
                }
                const resolved = this.getItemData(rolled);
                return resolved ? { ...resolved, id: rolled } : null;
            }
            return null;
        }

        // An explicit random_type is still honoured: a hand-curated pool that
        // isn't simply "everything declaring this type".
        if (Array.isArray(def.random_type) && def.random_type.length) {
            const rolled = this.getCatalogTypeForCategory(itemType)
                || def.random_type[Math.floor(ROT.RNG.getUniform() * def.random_type.length)];
            const resolved = this.getItemData(rolled);
            if (!resolved) {
                console.warn(`Item '${itemType}' random_type names unknown item '${rolled}'`);
                return null;
            }
            return { ...resolved, id: rolled };
        }

        if (!this._resolvedItems) this._resolvedItems = {};
        if (this._resolvedItems[itemType]) return this._resolvedItems[itemType];

        let resolved = def;
        const typeDef = def.type ? this.types?.[def.type] : null;
        if (def.type && (!typeDef || typeDef.domain !== 'item')) {
            console.warn(`Item '${itemType}' declares unknown item type '${def.type}'`);
        } else if (typeDef) {
            // `name` IS inherited here, unlike actors: for an item it's the
            // unidentified display noun ("you see a scroll"), a genuine property of
            // the category rather than bookkeeping about the type.
            const { description, domain, pool, ...inheritable } = typeDef;
            resolved = mergeEntityDef(inheritable, def);
        }

        resolved = this.applyItemSpell(itemType, resolved, def);
        this._resolvedItems[itemType] = resolved;
        return resolved;
    }

    /**
     * Expand an item's `spell` attribute (a spells.json id) into the targeted
     * spell attributes the casting code reads. Layered type < spell < item, so
     * the item's own attributes are re-applied on top of the spell's.
     *
     * @param {string} itemType - Item id, for the unknown-spell warning
     * @param {Object} resolved - The type-merged definition
     * @param {Object} def - The item's own definition
     * @returns {Object} The definition with the spell expanded, or `resolved` as is
     */
    applyItemSpell(itemType, resolved, def) {
        const spellId = resolved.attributes?.spell;
        if (!spellId) return resolved;
        const spell = this.spells?.[spellId];
        if (!spell) {
            console.warn(`Item '${itemType}' names unknown spell '${spellId}'`);
            return resolved;
        }
        const withSpell = mergeEntityDef(resolved, { attributes: spellAttributes(spell) });
        return def.attributes ? mergeEntityDef(withSpell, { attributes: def.attributes }) : withSpell;
    }


    getPersonality(personalityName) {
        const entry = this.personalities[personalityName];
        if (!entry) return null;
        if (entry.$alias) return this.personalities[entry.$alias] || null;
        return entry;
    }
}

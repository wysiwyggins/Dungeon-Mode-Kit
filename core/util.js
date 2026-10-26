/**
 * Engine-wide helpers with no engine dependencies: tint/color math, direction
 * constants, random picks, entity-definition merging and text templates.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a tint value from various formats
 * @param {number|string|undefined} value - Tint value as number, hex string ("#FF0000"), or undefined
 * @param {number} defaultValue - Default tint if value is undefined (default: 0xFFFFFF white)
 * @returns {number} Parsed tint as integer
 */
export function parseTint(value, defaultValue = 0xFFFFFF) {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string') {
        let hex = value.startsWith('#') ? value.slice(1) : value;
        const parsed = parseInt(hex, 16);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }

    console.warn('Invalid tint value:', value);
    return defaultValue;
}

function generateLightnessVariation(baseColor, delta = 0x10) {
    const r = (baseColor >> 16) & 0xFF;
    const g = (baseColor >> 8) & 0xFF;
    const b = baseColor & 0xFF;
    return {
        lighter: ((Math.min(255, r + delta) << 16) | (Math.min(255, g + delta) << 8) | Math.min(255, b + delta)),
        darker:  ((Math.max(0, r - delta) << 16)   | (Math.max(0, g - delta) << 8)   | Math.max(0, b - delta))
    };
}

export function extractRGB(color) {
    return {
        r: (color >> 16) & 0xFF,
        g: (color >> 8) & 0xFF,
        b: color & 0xFF
    };
}

export function packRGB(r, g, b) {
    return (r << 16) | (g << 8) | b;
}

export function lerpColor(colorA, colorB, t) {
    const a = extractRGB(colorA);
    const b = extractRGB(colorB);
    return packRGB(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t)
    );
}

export function rgbToHue(color) {
    const r = ((color >> 16) & 0xFF) / 255;
    const g = ((color >> 8) & 0xFF) / 255;
    const b = (color & 0xFF) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h * 60;
}

// How far toward a state's tint an affected actor's sprite is pulled (see
// getEffectiveTint). Short of 1.0 so the actor still reads as itself — a burning goblin
// should look like a goblin on fire, not like a generic orange smear.
export const STATE_TINT_MIX = 0.7;

// How far apart a floor's up and down stairways should be, in tiles (Chebyshev).
// A preference, not a guarantee — see pickStairwayTile. Small enough that cramped
// floors can still satisfy it, large enough that the pair isn't one step apart.
export const STAIRWAY_MIN_SEPARATION = 8;

// How many hunters may chase the player through a stairway at once. The player arrives
// with no room to retreat, so an uncapped pack is an unfair death rather than a tense
// escape — two is enough to feel pursued.
export const MAX_STAIR_FOLLOWERS = 2;

// ── Array / direction helpers ──────────────────────────────────────────

export const CARDINAL_DIRS = [
    {dx: 0, dy: -1}, {dx: 0, dy: 1},
    {dx: -1, dy: 0}, {dx: 1, dy: 0}
];

// Where a dropped item sits in the entity container. Above floor dressing — an entity
// with a tile renders at 6 (see createEntitySprite), and an item you can pick up must
// never hide under rubble, moss or a dug-out hole — but below actors at 10/11, since an
// item should never cover a creature standing on it. Items in liquid override this to
// float at 11.
export const ITEM_Z = 7;

// PIXI AnimatedSprite frame advance per tick. An animation can override this with a
// `speed` in data/animations.json; this is what the engine used for every sheet before
// that was possible, so leaving it out keeps the existing look.
export const DEFAULT_ANIMATION_SPEED = 0.1;

// `flickerTint: true` / `rippleTint: true` predate the named `effect` field and mean
// exactly `effect: "flicker_tint"` / `"ripple_tint"`. Shipped data has been migrated,
// but prototypes outside this repo may still use them, so they keep working.
const LEGACY_TINT_EFFECTS = { flickerTint: 'flicker_tint', rippleTint: 'ripple_tint' };
const _warnedLegacyTintKeys = new Set();

/**
 * Resolve an entity's visual effect id, honouring the deprecated boolean aliases.
 * Shared by Item and Actor so the two cannot drift — they did, and an item with
 * `rippleTint` silently rendered flat because only Actor handled that key.
 * @param {Object} data - Raw actor/item data
 * @returns {string|null} Effect name, or null for none
 */
export function resolveEntityEffect(data) {
    if (data.effect) return data.effect;

    for (const [legacyKey, effectName] of Object.entries(LEGACY_TINT_EFFECTS)) {
        if (!data[legacyKey]) continue;
        // Warn per key, not per entity — a level with forty torches shouldn't
        // print forty identical lines.
        if (!_warnedLegacyTintKeys.has(legacyKey)) {
            _warnedLegacyTintKeys.add(legacyKey);
            console.warn(
                `'${legacyKey}: true' is deprecated; use "effect": "${effectName}" instead.`
            );
        }
        return effectName;
    }
    return null;
}

export const ALL_DIRS = [
    {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1},
    {dx: -1, dy: 0},                   {dx: 1, dy: 0},
    {dx: -1, dy: 1},  {dx: 0, dy: 1},  {dx: 1, dy: 1}
];

// Placement patterns a biome `decorations` row may name. Anything else warns and
// falls back to 'scatter'. Mirrored by DECORATION_PATTERNS in
// editors/scripts/{biome,proto}-state.js, which fills the editor dropdown.
export const DECORATION_PATTERN_NAMES = new Set([
    'scatter', 'clusters', 'wall_hugging', 'near_liquid', 'room_floor'
]);

/**
 * Brogue-style "no cutting corners": a diagonal move is blocked when one of the
 * two orthogonally-adjacent corner cells is a blocker. `isCornerBlocker(x, y)`
 * decides what counts as a blocker; movement passes EntityManager.blocksDiagonalAt,
 * so only solid `blocks_diagonal` actors (walls, doors) block, while creatures
 * and open voids (e.g. maze cells with no floor) do not.
 */
export function isDiagonalBlocked(fromX, fromY, toX, toY, isCornerBlocker) {
    if (fromX === toX || fromY === toY) return false;
    return isCornerBlocker(toX, fromY) || isCornerBlocker(fromX, toY);
}

/** Fisher-Yates shuffle in-place using ROT.RNG for deterministic randomness. */
export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Pick a random element from an array using ROT.RNG. */
export function randomElement(arr) {
    return arr[Math.floor(ROT.RNG.getUniform() * arr.length)];
}

/**
 * Roll a random "potion-style" effect: 50/50 a state (from globalStates, excluding
 * attached-actor states like burning) vs a stat change (70% positive), with stat
 * magnitude scaled by the stat's max.
 */
export function rollRandomEffect(engine) {
    const playerData = engine.currentPrototype?.getActorData('player');
    const statNames = (playerData?.stats) ? Object.keys(playerData.stats) : [];

    // Build pool of applicable states (exclude those with attached_actor like burning)
    const stateEntries = Object.entries(engine.globalStates || {})
        .filter(([_, data]) => !data.attached_actor);

    if (statNames.length === 0 && stateEntries.length === 0) {
        return { apply_state: null, collision_effect: null, effect_description: 'It has no effect' };
    }

    // Decide: state effect vs stat effect. If only one pool exists, use that; otherwise 50/50.
    const useStateEffect = statNames.length === 0 ? true
        : stateEntries.length === 0 ? false
        : ROT.RNG.getUniform() < 0.5;

    if (useStateEffect) {
        const [stateName, stateData] = randomElement(stateEntries);
        return {
            apply_state: stateName,
            collision_effect: null,
            effect_description: stateData.effect_description || stateData.name
        };
    }

    // Pick a random stat to modify — 70% positive, 30% negative.
    const randomStat = randomElement(statNames);
    const isPositive = ROT.RNG.getUniform() < 0.7;
    const statValue = playerData.stats[randomStat];
    const maxStat = typeof statValue === 'object' ? statValue.max : statValue;
    const magnitude = maxStat >= 50
        ? Math.floor(ROT.RNG.getUniform() * 21) + 5  // 5-25
        : Math.floor(ROT.RNG.getUniform() * 5) + 1;  // 1-5
    const effectValue = isPositive ? magnitude : -magnitude;

    const statCapitalized = randomStat.charAt(0).toUpperCase() + randomStat.slice(1);
    return {
        apply_state: null,
        collision_effect: { [randomStat]: effectValue },
        effect_description: effectValue > 0 ? `It restores ${statCapitalized}` : `It drains ${statCapitalized}`
    };
}

/**
 * Parse an item-list value from a Tiled object property into an array of item-type strings.
 * Accepts a JSON array (e.g. '["crown", "torch"]'), a comma-separated string (e.g. 'crown, torch'),
 * an already-parsed array, or an empty value (→ []). Used for per-object default_items overrides.
 */
export function parseItemList(value) {
    if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
        } catch (e) {
            console.warn('Invalid default_items JSON:', value);
        }
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

// Entry keys that merge one level deep instead of replacing wholesale, so a
// layer can add or change a single attribute without restating the whole bag.
// Same idea as `mechanics` in getFloorConfig (root <- biome <- floor).
// `default_items` is deliberately NOT here: it replaces, so an override can
// give an actor an empty loadout. Concatenating would make that impossible.
const MERGED_ENTITY_KEYS = ['attributes', 'stats', 'collision_effect'];

/**
 * Layer one entity definition over another (base <- override).
 *
 * Every key replaces wholesale except those in MERGED_ENTITY_KEYS, which get a
 * single level of spreading. An override value of null deletes the key, which
 * is the only way to drop an attribute the base declares.
 *
 * Always returns a new object — definitions are shared by reference across all
 * instances of an actor (`this.data = data`), so mutating one would leak.
 *
 * @param {Object} base - The underlying definition (global actor, or a type)
 * @param {Object} override - The definition layered on top (wins on conflict)
 * @returns {Object} A new merged definition
 */
export function mergeEntityDef(base, override) {
    if (!base) return { ...(override || {}) };
    if (!override) return { ...base };

    const merged = { ...base, ...override };

    for (const key of MERGED_ENTITY_KEYS) {
        const baseVal = base[key];
        const overrideVal = override[key];
        if (baseVal && overrideVal && typeof baseVal === 'object' && typeof overrideVal === 'object'
            && !Array.isArray(baseVal) && !Array.isArray(overrideVal)) {
            merged[key] = { ...baseVal, ...overrideVal };
        }
    }

    // An explicit null unsets a key the base declared.
    for (const [key, value] of Object.entries(override)) {
        if (value === null) delete merged[key];
    }
    for (const key of MERGED_ENTITY_KEYS) {
        if (!merged[key] || typeof merged[key] !== 'object') continue;
        for (const [attr, value] of Object.entries(merged[key])) {
            if (value === null) delete merged[key][attr];
        }
    }

    return merged;
}

/**
 * Merge a prototype's entity library over the global one, per entry.
 *
 * Entries only the prototype defines pass through untouched; entries that shadow
 * a global one are layered over it rather than replacing it.
 *
 * @param {Object} globalLib - The global library (e.g. engine.globalActors)
 * @param {Object} protoLib - The prototype's overriding library
 * @returns {Object} A new merged library
 */
export function mergeEntityLibrary(globalLib, protoLib) {
    const merged = { ...(globalLib || {}) };
    for (const [key, def] of Object.entries(protoLib || {})) {
        merged[key] = (key in merged && merged[key] && typeof def === 'object' && !Array.isArray(def))
            ? mergeEntityDef(merged[key], def)
            : def;
    }
    return merged;
}

/**
 * Get the indefinite article ('a' or 'an') for a word
 * @param {string} word - The word to get the article for
 * @returns {string} 'a' or 'an'
 */
function getIndefiniteArticle(word) {
    if (!word || word.length === 0) return 'a';
    const firstLetter = word.charAt(0).toLowerCase();
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    return vowels.includes(firstLetter) ? 'an' : 'a';
}

/**
 * Process [a-an] template markers in a string
 * Replaces [a-an] with 'a' or 'an' based on the following word
 * @param {string} text - The text containing [a-an] markers
 * @returns {string} The processed text with proper articles
 */
function processArticleTemplates(text) {
    // Match [a-an] followed by optional whitespace and capture the next word
    return text.replace(/\[a-an\]\s*(\w+)/gi, (_match, nextWord) => {
        const article = getIndefiniteArticle(nextWord);
        return `${article} ${nextWord}`;
    });
}

/**
 * Flatten every random word list into one "namespace.category" -> string[] map.
 *
 * Built once at load so a template can name any list the data files define without
 * the engine knowing that namespace exists. Adding a category to words.json is
 * enough to make `[namespace.category]` work.
 *
 * words.json nests by topic ({attacks: {melee_verbs: [...]}}); reagents.json and
 * substances.json are flat ({reagents: [...]}), so they get their filename as the
 * namespace. That yields `reagents.reagents` and `substances.substances` — the
 * tokens the shipped data already uses.
 *
 * @param {Object} sources - { words, reagents, substances }
 * @returns {Object<string, string[]>} Flat registry keyed "namespace.category"
 */
export function buildWordRegistry({ words, reagents, substances } = {}) {
    const registry = {};

    for (const [namespace, categories] of Object.entries(words || {})) {
        if (!categories || typeof categories !== 'object' || Array.isArray(categories)) continue;
        for (const [category, list] of Object.entries(categories)) {
            if (Array.isArray(list) && list.length) registry[`${namespace}.${category}`] = list;
        }
    }

    for (const [namespace, source] of [['reagents', reagents], ['substances', substances]]) {
        for (const [category, list] of Object.entries(source || {})) {
            if (Array.isArray(list) && list.length) registry[`${namespace}.${category}`] = list;
        }
    }

    return registry;
}

/**
 * Resolve `[token]` templates in a string. The one resolver — display names,
 * descriptions and messages all route through here.
 *
 * Resolution order, first hit wins:
 *   1. `[a-an]`             deferred to processArticleTemplates, which needs the
 *                           resolved word after it to pick the article
 *   2. ctx.providers[key]   caller-specific keys ([damage], [attacked_actor_name])
 *   3. word registry /      order depends on ctx.memoize — see below
 *      subject.templateVars
 *   4. subject[key]         own properties
 *   5. getAttribute(key)    data attributes
 *   6. the token itself     unknown keys pass through, so authored prose that
 *                           happens to contain brackets survives intact
 *
 * `memoize` is the identity-vs-event distinction. A name is rendered on every
 * hover and must not change between renders, so its random picks are cached into
 * templateVars and templateVars is consulted first. A message is read once, so it
 * re-rolls for variety and only falls back to templateVars for assigned values
 * like color or material.
 *
 * @param {string} template - Text possibly containing [token]s
 * @param {Object} subject - Entity supplying templateVars, properties and attributes
 * @param {Object} [ctx]
 * @param {Object<string, function>} [ctx.providers] - key -> thunk. Lazy, so an
 *        unused [item_name] never recurses into getDisplayName().
 * @param {boolean} [ctx.memoize=false] - Cache word picks for a stable result
 * @param {Object} [ctx.registry] - Word registry; defaults to the subject's engine
 * @returns {string} The resolved text (unchanged if it held no tokens)
 */
export function resolveTemplate(template, subject, ctx = {}) {
    // Most names carry no template at all; skip the regex entirely for those.
    if (typeof template !== 'string' || template.indexOf('[') === -1) return template;

    const providers = ctx.providers || {};
    const memoize = ctx.memoize === true;
    const registry = ctx.registry || subject?.engine?.globalWordRegistry || {};
    const vars = subject?.templateVars;

    const resolved = template.replace(/\[([^\]]+)\]/g, (match, key) => {
        if (key.toLowerCase() === 'a-an') return match;

        // hasOwnProperty, not a truthiness check: [critical_chance] must be able
        // to resolve to 0 rather than falling through to the lookups below.
        if (Object.prototype.hasOwnProperty.call(providers, key)) {
            const value = providers[key]();
            return (value === undefined || value === null) ? match : value;
        }

        const list = registry[key];
        if (memoize) {
            if (vars && vars[key] !== undefined) return vars[key];
            if (list && list.length) {
                const picked = randomElement(list);
                if (vars) vars[key] = picked;
                return picked;
            }
        } else {
            if (list && list.length) return randomElement(list);
            if (vars && vars[key] !== undefined) return vars[key];
        }

        if (subject && subject[key] !== undefined && typeof subject[key] !== 'object') {
            return subject[key];
        }

        const attr = subject?.getAttribute?.(key);
        if (attr !== undefined && attr !== null && typeof attr !== 'object') return attr;

        return match;
    });

    // After substitution, so the article sees the word it will actually precede.
    return processArticleTemplates(resolved);
}

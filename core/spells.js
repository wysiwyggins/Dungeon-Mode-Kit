/**
 * Spells: named gameplay records (data/spells.json) that an actor can use, often
 * enabled by an item use verb, for a variety of complex actions, some multi-step or targeted
 * some triggering a visual or sound effect. These were previously all packed into item attributes
 * and this still expands into those attributes, so there's no downstream impact
 * Precedence is type < spell < item: an item can still override any one expanded attribute.
 */

/**
 * Deliveries that need no aim: `burst` hits every creature within `radius` of the
 * caster, `sight` every creature the caster can see.
 */
export const AREA_DELIVERIES = ['burst', 'sight'];

/** Does this spell act on an area around the caster rather than a target tile? */
export function isAreaSpell(spell) {
    return AREA_DELIVERIES.includes(spell?.delivery);
}

/**
 * Translate a spells.json entry into item attributes.
 * @param {Object} spell - A spells.json entry
 * @returns {Object} Attributes to layer between the item's type and the item
 */
export function spellAttributes(spell) {
    const attrs = {};
    if (spell.name !== undefined) attrs.spell_name = spell.name;
    if (spell.effect || spell.delivery === 'bolt') {
        attrs.spell_effect = spell.delivery === 'bolt'
            ? { ...spell.effect, type: 'bolt' }
            : { ...spell.effect };
    }
    if (spell.range !== undefined) attrs.spell_range = spell.range;
    if (spell.target_filter !== undefined) attrs.target_filter = spell.target_filter;
    if (spell.cast_sound !== undefined) attrs.cast_sound = spell.cast_sound;
    if (spell.vfx !== undefined) attrs.spell_vfx = spell.vfx;
    if (spell.projectile?.tile !== undefined) attrs.projectile_tile = spell.projectile.tile;
    if (spell.projectile?.tint !== undefined) attrs.projectile_tint = spell.projectile.tint;
    if (isAreaSpell(spell)) attrs.spell_delivery = spell.delivery;
    if (spell.radius !== undefined) attrs.spell_radius = spell.radius;
    if (spell.affects !== undefined) attrs.spell_affects = spell.affects;
    if (spell.message !== undefined) attrs.spell_message = spell.message;
    if (spell.empty_message !== undefined) attrs.spell_empty_message = spell.empty_message;
    return attrs;
}

/**
 * The spell an item casts, read back off its resolved attributes: the inverse of
 * spellAttributes, so per-item overrides and inline (spell-less) staffs come out
 * in the same shape a spells.json entry has, for DungeonEngine.castSpell.
 * @param {Item} item
 * @returns {Object} A spell: { name, delivery, range, radius, affects, target_filter, cast_sound, vfx, projectile, effect, message, empty_message }
 */
export function spellFromItem(item) {
    const attr = key => item.getAttribute(key);
    // An item with no spell_effect at all has always cast a plain fire burst.
    const { type, ...effect } = attr('spell_effect') || { center: 'fire', radius: 0 };
    return {
        name: attr('spell_name') || item.getDisplayName?.() || item.name,
        delivery: attr('spell_delivery') || (type === 'bolt' ? 'bolt' : 'projectile'),
        range: attr('spell_range'),
        radius: attr('spell_radius'),
        affects: attr('spell_affects'),
        message: attr('spell_message'),
        empty_message: attr('spell_empty_message'),
        target_filter: attr('target_filter'),
        cast_sound: attr('cast_sound'),
        vfx: attr('spell_vfx'),
        projectile: { tile: attr('projectile_tile'), tint: attr('projectile_tint') },
        effect
    };
}

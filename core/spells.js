/**
 * Spells: named gameplay records (data/spells.json) that an actor can use, often
 * enabled by an item use verb, for a variety of complex actions, some multi-step or targeted
 * some triggering a visual or sound effect. These were previously all packed into item attributes
 * and this still expands into those attributes, so there's no downstream impact
 * Precedence is type < spell < item: an item can still override any one expanded attribute.
 */

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
    return attrs;
}

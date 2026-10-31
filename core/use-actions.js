/**
 * Named use actions: the string form of an item's `use_effect`
 * ("use_effect": "reveal_map"), for effects that need engine code rather than a
 * stat change or a state.
 *
 * Each name here is a case in Actor.executeItemEffect (engine/actor/items.js),
 * and this list is what the item editor offers, so a new case there needs an
 * entry here too. `reads` names the item attributes the action takes as
 * settings, with the default used when the item leaves one out.
 */
export const USE_ACTIONS = {
    identify_item: { description: 'Pick an item in the pack to identify.' },
    enchant_item: { description: 'Pick an item in the pack to enchant.' },
    protect_item: { description: 'Pick a weapon or piece of armor to protect from acid.' },
    remove_curse: { description: 'Lift the curse from everything the user has equipped.' },
    teleport: { description: 'Move the user to a random open tile on this floor.' },
    detect_magic: { description: 'Sense whether every item on this floor and in the pack is good or bad magic.' },
    reveal_map: { description: 'Map this floor for good, and show its hidden machinery.' },
    aggravate_monsters: { description: 'Alert every hostile creature on the floor to the player. Only creatures with the pursue_intruders behavior act on it.' },
    discord: { description: 'Confuse every creature within the radius, allies included.', reads: { effect_radius: 5 } },
    negate_nearby: { description: 'Strip every state from creatures within the radius.', reads: { effect_radius: 5 } },
    sanctuary: { description: 'Lay glyphs monsters will not cross on the floor around the user.', reads: { effect_radius: 2, glyph_actor: 'sacred_glyph' } },
    summon_monsters: { description: 'Summon creatures from the floor\'s random_actors around the user.', reads: { summon_min: 2, summon_max: 4 } },
    recharge_items: { description: 'Fully recharge every rechargeable item in the pack (staffs, not wands).' },
    remove_all_states: { description: 'Cure every state on the user.' },
    shatter_walls: { description: 'Turn breakable walls within the radius to rubble.', reads: { effect_radius: 3 } },
    darkness_field: { description: 'Put out light sources within the radius, carried or on the ground.', reads: { effect_radius: 5 } },
    toggle_torch: { description: 'Light or put out the item by swapping it for its other form.', reads: { toggle_to: 'torch / torch_unlit' } },
    spike_door: { description: 'Pick an adjacent door to jam shut.' },
    dig: { description: 'Pick a direction to dig through a wall.' },
    targeted_spell: { description: 'Aim, spend a charge and fire the item\'s spell (staffs and wands).' },
};

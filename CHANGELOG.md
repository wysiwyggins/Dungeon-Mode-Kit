# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Pie in the sky

- music engine
- Alternative first-person view pane (for perspective dungeon style play, this is prob a whole different thing)
- Vaults: interactive fiction riddles in treasure rooms
- Dialogue: npc's with convo trees

### Planned

- change "bridge" actor attribute to "platform," could be reused for collaping floors.
- don't hide stairways (sometimes architect will put walls on top of them)
- falling on a prototype with mutliple levels doesn't instadeath, it takes you to the next level down with a fall injury

### In Progress

- Abysses/ Rope bridges (needs testing)
- Mining (works but requires testing and refinement, Currently 3 hits always removes a breakable actor, which feels unnatural)

## [1.6b] 2026-05-08

### Added

- **Dungeon generator improvements**: lakes and abysses now appear in procedurally generated levels
- **Wall digging**: generated levels allow better digging into walls
- **Better FOV epistemology**: sidebar messages for NPC combat, state changes, traps, and environmental effects are now filtered by player field of vision — events in remembered (dark) areas are no longer reported
- **Help window**: press `?` to open an in-game help screen that dynamically lists all key bindings; dismiss with `?` or `Esc`
- **Keybindings data file**: non-movement key bindings moved to `data/keybindings.json` for designer editing; action descriptions used by the help screen are also defined there
- **Bolt attack behavior**: `bolt_attack` NPC behavior reproducing the Staff of Lightning effect — configurable range, cooldown, and damage via personality data
- **Custom actor light radius**: actors can now define `lightRadius` at the data level (previously all light sources defaulted to radius 5)
- **Torch toggle behavior** light/extenguish

## [1.5b] 2026-04-30

### Added

- **No wall-adjacent corner movement** Decided to disallow moving around wall corners.
- **Side tile system**: actors can now have a third body tile at an offset from the base tile, defined via `tileIndexSide`, `animationSide`, `flipSideH`/`flipSideV`, and `sideOffset` (`{dx, dy}`). Side tiles are cosmetic (no collision footprint), support independent per-tile lighting, viewport clipping, submersion hiding, and flash effects.
- **Facing direction system**: actors can opt into dynamic horizontal flipping with `facingEnabled: true` and `defaultFacing`. When enabled, moving or attacking left/right flips all actor sprites (base, top, side, equipment) and mirrors the side tile offset. Facing is serialized across save/load. Actors without `facingEnabled` are completely unaffected.
- **Monkey actor**: three-tile creature (head: BULLET, base: LEG, tail: BOX_BOTTOM_RIGHT) with `facingEnabled` — tail mirrors when the monkey changes direction
- **Pickpocket personality**: Brogue-inspired AI behavior chain (`flee_with_loot` > `pickpocket_adjacent` > `pursue_target` > `random_walk`)
  - `pickpocket_adjacent` behavior: steals a random unequipped item from an adjacent player, transfers it to the monkey's inventory
  - `flee_with_loot` behavior: after stealing, flees from the player while pathfinding toward the nearest deep liquid; drops the stolen item into deep liquid if it reaches one

### Fixed

- UI boxes (player info, inventory, dialogs, menus) now position within the visible viewport on multi-screen levels instead of rendering off-screen
- Dead cloud/mist actors no longer apply effects when the player walks over their tile
- Scroll of Magic Mapping no longer silently fails on levels without fog of war — now consumes the scroll with "You already know this place well."
- Scroll of Summon Monsters no longer silently fails when the prototype has no random actor config — now consumes the scroll with "Nothing answers the call."
- Unknown item effects now show "You don't understand a word of it!" and consume the scroll instead of doing nothing

## [1.4b] 2026-03-19

### Added

- Starving state: applied automatically when nutrition drops below 10%, removed when it recovers
  - Each turn while starving, 8% chance to faint (sleep 2 turns) and 12% chance of nausea
  - `duration: -1` sentinel in state definitions for infinite-duration states
  - `player_only` state property: restricts state application to controlled actors
  - `random_apply_states` state property: general-purpose per-turn random sub-state rolls with configurable chance, duration, and message
  - `condition_state` stat property: data-driven state application/removal at stat thresholds — any stat can trigger a state

## [1.3b] 2026-03-17

### Added

- Jackal actor: weak (5 HP) hostile creature that spawns in packs of 3-5 using `aggressive_melee` personality
- Pack spawn mechanic: actors with `pack: true` attribute spawn clustered within Manhattan distance 2 of each other

## [1.2b] 2026-03-17

### Added

- Scroll of Shattering visual effect: screen shake, amber canvas flash, and radiating tile fill that expands outward from the caster
- `radial_tile_fill` effect primitive: fills tiles ring-by-ring outward by Manhattan distance with staggered timing and fade-out
- `shatter` composite effect definition in effects.json
- Staff of Lightning bolt visual effect: white-blue tile fill that races along the bolt path with screen shake and flash, replacing the projectile sprite animation
- `line_tile_fill` effect primitive: fills tiles along a path sequentially with staggered timing
- `lightning_bolt` composite effect definition in effects.json

### Changed

- Scroll of Shattering use sound changed from `magic` to `fireball`
- Staff of Lightning bolt spells now use `line_tile_fill` instead of projectile sprite animation

## [1.1b] 2026-03-16

### Added

- Multi-level dungeons: prototypes can define a `levels` array with per-level map generators, win conditions, random actors/items, and descriptions — stairways connect levels within a single prototype
- Level loading utilities: `listLevels()` and `loadLevel()` console helpers for navigating multi-level prototypes
- Sewer gas environmental hazard: sewage tiles emit green gas clouds (3% chance per turn) that spread and apply nauseated state
- `nauseated` state: 25% random chance to skip turn ("You retch!"), 8-turn duration, blocked by `gas_immune`
- `skip_turn_chance` state property and `getStatePropertyValue()` helper for probabilistic turn-skip states
- State collision effects: actors can apply states on contact (e.g., toad applies confused)
- Touch input support
- Screen shake visual effect for dark levels
- Visual effects refactored into standalone `effects.js` module
- `setup.sh` install script for dependencies
- New actors: toad, sewer gas cloud
- Per-level actor and item overrides in dungeon prototype (rats, goblins, bats, skeletons, kobolds scale by depth)

### Changed

- Identify scrolls now consumed even when nothing is available to identify
- Hallucination state applies to all playable actors, not just sentient ones
- Engine refactored: visual effects, behaviors extracted to separate modules

### Fixed

- Game of Life behavior: undefined `directions` variable fixed to `ALL_DIRS`
- State duration counter fix
- Breakable non-explosive thrown items no longer detonate
- Follow thread behavior line-of-sight fix
- Screen shake rendering in dark levels

## [1.0b] 2026-03-13

### Added

- States (flying, confused, blinded, hallucinating)
  - `hasStateProperty(prop)` helper on Actor: generic check for any active state having a given data property
  - **`on_apply_effect` state property**: modifies actor properties while a state is active and restores originals on removal (similar to equipment `wear_effect`)
  - `enableRuntimeDarkness()` / `disableRuntimeDarkness()` engine methods for spinning up the lighting system on non-dark levels
  - `remove_all_states` string use_effect in executeItemEffect
  - **`random_effect` expansion**: generic potions now have a 50% chance to apply a random state (confused, hasted, poisoned, etc.) instead of always modifying a stat. States with `attached_actor` (burning) are excluded from the pool.
  - `effect_description` field on all states in `states.json`: provides potion-style descriptions for randomly generated state-effect potions
- Recharge scroll case
- put an ellipses counter for repeated messages in description
- `z` or `.` key to rest

### Changed

- big refactor of behaviors and visual effects to their own files. First pass at some data-fied effects components but it's still probably confusing

### Fixed

- `follow_thread` behavior: monsters with `follows_thread` (e.g., Asterion) no longer detect the thread trail through walls. Added line-of-sight check using `hasLineOfSight` with solid actor blocking, so the monster must have an unobstructed view to a trail segment before reacting to it. Adjacent/on-trail detection unchanged.

## [0.9b] 2026-03-07

### Added

- `break_sound` item attribute: sound played when a breakable item shatters on throw impact (e.g., `"glass"`)
- `explode_sound` item attribute: sound played when an explosive+breakable item detonates into a gas cloud on throw (e.g., `"gas"`); fire explosions already play `"fireball"` via `createFireExplosion`
- All potions updated with `break_sound: "glass"`; gas-cloud potions also given `explode_sound: "gas"`
- ITEMS.md "Root-Level Properties vs Attributes" section: explains the two-layer item data structure, lists all root-level properties, and notes the actor/item difference
- SOUNDS.md documentation for `break_sound`, `explode_sound`, sound library entries for `glass` and `gas`
- dimmed backgrounded ui boxes
- Fire explosions: items with `fire_explosion: true` now detonate into an immediate burst of `intense_fire` (center + radius 1) and `fire` (outer radius) instead of a gas cloud, play the fireball sound, and give breakable solid actors in range a 60% chance to be destroyed
- Explosive detonation is now gated by `breakable`: items with both `explosive` and `breakable` detonate on throw (potions); items with `explosive` but no `breakable` only detonate when ignited by fire (powder kegs)
- All throwable explosive potions given `breakable: true` to preserve existing throw-to-explode behavior
- `powder_keg` updated: correct name, `fire_explosion: true`, `explosion_radius: 2`
- Entities are flammable by default, allows burning thread trail as fuse etc.
- Torch item with burnout:
  - Torches emit orange light (radius 6) when carried in inventory
  - `burns` stat counts down 500 turns (`per_turn: -1`); warns "Your torch is almost out!" at 10%
  - Burns out into an `Unlit Torch` item (gray, no light)
  - Item stat `warnings` array: threshold-based messages when a stat crosses below `threshold * max` (downward)
  - Item `burns_out_item` attribute: item transforms into another item type when `burns` stat depletes
- `player_auto_light` mechanics config (default `true`): set to `false` to disable the hardcoded player white light, requiring a carried light source instead
  - All dark levels (labyrinth, catacombs, dungeon, treasure, caverns, mine, underworld) now use `player_auto_light: false`
  - Player starts each dark level with a torch in inventory
- Inventory light sources: any item with `light_source: true` carried by an actor emits light at the actor's position, using the item's `tint` and `lightRadius` attribute
- Win condition object format: `{ "actor": "player", "stat": "weight", "op": ">", "value": 10 }` checks a numeric stat or attribute on a named actor; supports `>`, `>=`, `<`, `<=`, `==`, `!=`
- README rewritten as a designer-focused guide covering level creation, Tiled layers, actor/item definition, and win conditions
- Viewport system for maps larger than the canvas:
  - Per-prototype `viewport_width` and `viewport_height` in mechanics config
  - Zelda-style screen snap when player crosses section boundaries
  - Backwards compatible: levels without viewport config display full map as before
  - AI margin system freezes off-screen actors beyond configurable tile distance
  - Mouse input, walk paths, line paths, darkness, and lighting all viewport-aware
- Ball of thread `follow_thread` AI behavior:
  - Monsters with `follows_thread` attribute detect and follow thread trail entities
  - Pathfinds toward nearest trail segment within vision range, then walks along trail toward player
  - At trail end, pursues the trail owner directly
  - Added to `stationed_melee` and `aggressive_melee` personality behavior chains (gated on attribute)
  - Minotaur (Asterion) given `follows_thread` attribute
- Chained actor (scutigera) fixes:
  - Body segments follow head via path history with pathfinding fallback
  - Fixed double sprite creation bug (renderActors no longer orphans spawn-time sprites)
  - Added `getSolidActorAt` to prevent head walking over body segments on shared tiles
  - Chain members skip collision with each other in tryMove

### Fixed

- Throw/spell aiming instruction box no longer appears dimmed: `inventoryMode` flag is now cleared when entering aiming modes, preventing `updateBoxOverlays` from treating a removed `player_info` box as the active box
- Thread trail overlap: trail segments now hidden at actor's `spriteTop` position regardless of movement direction (was only hidden when walking down)
- `getActorAt` returning non-solid actors (water/sewage) before solid ones no longer causes invisible collisions — 10 callsites migrated to `getSolidActorAt`

## [0.8b] 2026-02-25

### Added

- Warning-styled confirm dialogs:
  - `showConfirmDialog` now accepts an `options` parameter for `fillColor`, `borderTint`, and `textTint`
  - New `warningFillColor` property on InterfaceManager (`#EB8A90` light red)
  - All hazard movement confirmations (lava, void, traps) now display with the warning background
- Mouse click support for all dialog types:
  - Confirm dialogs: click "(Y)es" or "(N)o" text regions; clicking outside dismisses
  - Inventory: click item lines to open action menu; click outside to close
  - Item action menu: click numbered actions (Drop, Wear, Equip, Throw, etc.)
  - Throw item menu: click items to select for throwing
  - Equipment menu: click items to toggle equip/unequip
  - Centralized `handleDialogClick` with tile-based hit-testing via `_hitTestBox`
  - All keyboard shortcuts continue to work as before
- Liquid color tint blending
  - adjacent actors with a tint and liquid attribute will mix their tints together over turns
- Chained actors behavior
  - created a scutigera centipede out of a head and body actor that moves like "snake"

### Fixed

- Walk path preview no longer renders behind open dialogs (confirm, throw menu, equipment menu)
- Box geometry (`_boxX`, `_boxY`, `_boxWidth`, `_boxHeight`) now stored universally by `createBox` instead of manually in individual methods

## [0.8b] 2025-01-29

### Added

- Landmarks layer support for Tiled maps:
  - New optional "landmarks" object layer in map.tmj files
  - Create ad-hoc descriptive entities without defining them in entities.json
  - Bitsy-style decorative tiles with walk-over messages
  - Object `class`/`type` specifies tile name from static-tiles.json
  - Supported custom properties: `walk_description`, `tint`, `fillColor`

### Fixed

- Pushing actors into voids now works - pushable actors can be pushed into void tiles and will fall with message "You push [the Wall] into the void!"
- Dropping equipped items now properly unequips them first, fixing visual bug where equipment sprites remained on player after dropping

## [0.8a] 2025-01-26

### Added

- Trap system (Brogue-style):
  - Traps start invisible and become visible when triggered
  - Re-triggerable: same trap can fire multiple times when stepped on again
  - Won't re-trigger while same actor/item remains on tile
  - Items on traps "hold down" the trigger, preventing re-triggering until removed
  - Hazard warning prompts before stepping on visible traps (skipped if item holds trigger)
  - Can be triggered by thrown items landing on them
  - Two trap effect formats:
    - `trap_spawn`: spawns single actor (e.g., poison cloud)
    - `trap_effect`: spell-like area effect with center/radius/outer (e.g., fire trap)
  - `trap_apply_state`: applies a state to actors caught in the trap's effect
  - Trap types:
    - `poison_gas_trap`: spawns spreading poison cloud that damages health
    - `fire_trap`: spawns intense_fire at center with fire in radius 1 (like fireball)
    - `paralysis_gas_trap`: spawns spreading gas that paralyzes actors
    - `confusion_gas_trap`: spawns spreading gas that confuses actors
- State-applying potions:
  - Potions can now apply states via `use_effect: { "apply_state": "state_name" }`
  - `poison_potion`: applies poisoned state (damage over time)
  - `confusion_potion`: applies confused state (random movement)
  - `haste_potion`: applies hasted state (extra turn)
  - `paralysis_potion`: applies paralyzed state (skip turns)
  - `regeneration_potion`: applies regenerating state (heal over time)
  - Thrown explosive potions create clouds that apply their state to actors
- `paralyzed` state: actors skip turns for 6 turns (similar to stunned but longer)
- Actor `data` property: actors now store their full definition data for behavior access
- Per-turn stat modifications (data-driven):
  - Stats can have `per_turn` value for automatic changes each turn (e.g., nutrition drain, health regen)
  - `fatal: true` makes stat depletion kill the actor (health is always fatal)
  - `death_message` for custom death text when stat reaches zero
  - `warnings` array for threshold-based messages (e.g., hunger warnings at 50%, 25%, 10%)
  - Equipment `wear_effect` can modify per-turn rates (e.g., `"nutrition_per_turn": 0.5` reduces hunger)
  - Passive inventory effects can also modify per-turn rates
- Combat turn costs:
  - Item use takes one turn
  - Multi-turn armor equipping based on strength requirement
    - Armor with `requires_stat: { strength: X }` takes X turns to equip and can't be equipped without the minimum strength stat
    - Progress shown in actor list as "(equipping.)" with dots for turns spent
    - Equipping can be cancelled by starting to equip a different item
- Knockback weapon proc now staggers target (target loses next turn)
- Item action menus now close before effects execute for better visual feedback
- Item stats system with per-turn modification (for recharging items like staffs):
  - Items can now have `stats` with `per_turn`, `ready_at`, and `ready_message`
  - Item stats process each turn when item is in actor's inventory
  - `start` value allows items to begin uncharged (e.g., `"start": 0`)
- Targeted spell system for items:
  - `use_effect: "targeted_spell"` enables aiming mode with mouse targeting
  - `charge_stat` and `charge_cost` for items that need to recharge between uses
  - `spell_range` limits how far spells can be cast
  - `spell_effect` spawns actors at target: `{ center, radius, outer }`
  - `projectile_tile` and `projectile_tint` customize the spell projectile appearance
  - Spell aiming shows orange path (gray if out of range)
- Staff of Fireball item:
  - Casts fireball that spawns intense_fire at center and fire in radius 1
  - Recharges 5% per turn, requires 100% charge to cast
  - Shows "Your Staff of Fireball is fully charged!" when ready
  - Starts unidentified with random substance name (e.g., "malachite staff")
- Substances data loaded globally for `[substances.substances]` template syntax
- Item identification now supports `[substances.substances]` template variable

### Fixed

- Click-to-walk path now restores properly after exiting spell aiming or throw aiming modes
- Staff `uses` attribute now works correctly: a staff with `uses: 2` costs half pow per use and shows proper charge count
- Staff thermometer now displays total power as fraction of max, giving clear visual feedback when charges are used
- Gas clouds now properly apply states (paralysis, confusion) to actors:
  - Added `sentient` attribute to creature actors (player, skeleton, etc.) to mark which actors can be affected by states
  - Clouds apply state when spreading to a tile with an actor (not just when actor walks in)
  - Actors check for cloud effects when moving into a tile
- Combat message ordering: attack descriptions now appear before death messages
- Fixed double death messages when multiple enemies attack simultaneously
- Fixed dead actors being attacked (early exit check in applyCollisionEffects)
- Fixed AI attacking twice per turn: missed attacks now properly consume the turn
  - `applyCollisionEffects` now returns `attackAttempted` flag (true even on miss)
  - `attack_adjacent` and `defend_self` behaviors return true on any attack attempt
  - `tryMove` uses `attackAttempted` instead of `effectApplied` for action taken
- Fixed multiple actors spawning when set to 100% max 1 in prototype:
  - `spawnUnplacedEntities` now skips actors configured in `random_actors`
  - `removeEntity` now also removes actor from scheduler
- Fixed doors being attacked instead of opened: openable check now happens before combat
- Fixed stairways being hidden by walls: wall spawning skips tiles with stairways
- Canvas stat thermometers now normalized to fixed width (10 tiles) regardless of max value
- HTML stat ratio numbers hidden for stats with max > 100 (thermometer-only display)
- Canvas stat thermometers hidden when HTML `#actors` element exists (avoids duplication)

### Changed

- Death is now triggered after attack messages are shown, not during stat modification
- Updated COMBAT.md with turn costs, knockback stagger, and multi-turn equipping documentation

## [0.7b] 2025-01-22

### Added

- Optional HTML sidebar for actors and items:
  - `#actors` div displays visible actors with stats
  - `#items` div displays visible items with "Visible Items" header
  - `#description` existing area for action messages and hover inspection messages which clear.
  - Actors with stats are listed in actors, not doors walls lava etc.
  - Stats with current/max ratios displayed as thermometer bars (1/1 stats hidden)
  - Inventory attribute shown as current/max ratio numbers not thermometer
  - Sidebar updates automatically on visibility changes (needs testing), entity add/remove, and actor death
  - Sidebar elements optional - embedded prototypes work without them, could start simply and then add complexity over each level

### Fixed

- Equipment sprites no longer duplicated when actors have default_items equipped
- light_source actors no longer cast a shadow entity

## [0.7a] 2025-01-20

### Added

- Combat system improvements:
  - RNG-based hit rolls using accuracy vs defense (clamped 5-95%)
  - Weapon equipment slot - equipped weapons replace unarmed collision_effect
  - Equipment menu (E key) for managing wearables and weapons
  - Templated attack messages with `[actor_name]`, `[attacked_actor_name]`, `[weapon_name]`, `[attacks.melee_verbs]`
  - Miss messages when attacks fail hit roll
- Procedural dungeon generation:
  - PRISON_WINDOW (tile 16) and OPAQUE_PRISON_WINDOW (tile 152) wildcards for rooms + corridors (ROT.Map.Digger)
  - Existing maze wildcard (tile 210) uses ROT.Map.EllerMaze
  - Automatic up_stairway placement if none manually placed in generated levels
  - Locked up_stairway spawns if prototype has no previous_level
  - Fixed fully procedural maps (no map.tmj) to use correct tile format
- Random actor spawning via prototype config:
  - `random_actors` object in prototype.json
  - Per-actor `chance` (0-100%), `min`, and `max` spawn counts
  - 100% chance = exactly one guaranteed spawn
- Deep water current system:
  - Actors and items float and drift with configurable current direction
  - Items update sprite position when floating

## [0.6b] 2025-01-15

### Added

- Win conditions system for prototypes:
  - `wearing:item_type` - player must have item equipped
  - `holding:item_type` - player must have item in inventory
  - `killed:actor_type` - all actors of that type must be dead
  - Locked down stairways unlock when conditions are met
  - Visual tile change and message when stairway unlocks
- Generic `collision_description` attribute for solid actors
- Entity `walk_description` attribute for messages when walking over entities
- Actor shadows cast from colored light sources (sorta works)
- Mouse-based tile highlighting with color inversion on hover
- Throw action for all items:
  - Aiming mode with red line path preview
  - Path stops at solid actors
  - Projectile animation showing item moving along path
  - Items break on impact by default (Brogue-style), configurable via `breakable_on_throw: false`
  - Collision effects apply to hit targets
  - Worn items auto-unequip before throwing
- Click-to-walk with A* pathfinding:
  - Yellow path preview on hover
  - Auto-walk with configurable delay
  - Notable events interrupt auto-walk (hostile approaches, etc.)
  - Cannot target dark/unexplored tiles
- Collision effect attribute/stat references using `{attribute}` syntax (e.g., `"health": "-{strength}"`)

### Fixed

- Dead actors now stay hidden on dark levels
- White light sources no longer wash out colored light tints
- Floor-only colored light tinting (excludes void tiles)
- Fixed npc deaths on dark levels

## [0.6a] 2026-01-13

### Added

- Description html element shows verbose descriptions of actions and moused-over entities. List of three descriptions (Brogue style)
- Fog of war memory: "You remember seeing [entity]" for explored but not visible tiles
- Message stacking: multiple events in same turn display together (e.g., attack + death)
- Item identification system:
  - Items can have `random_color: true` for randomized appearance per prototype
  - Unidentified/identified name templates (e.g., "blue potion" → "Potion of Healing")
  - Using an item identifies it and all items of that type
- Color-paired keys and locked doors:
  - Keys and locked doors get matching random colors when spawned
  - "The blue key unlocks the blue door!" / "The red door requires a red key"
  - Keys consumed on successful unlock
- Description text templates with `[a-an]` for automatic article selection
- Template variables: `[adjectives.category]`, `[attacks.melee_verbs]`, `[item_name]`, `[actor_name]`
- `collision_description` attribute for actors (templated attack messages)
- `use_description` attribute for items (templated use messages)
- Player info box auto-updates after each turn to reflect stat changes
- Global data loading: colors.json, adjectives.json, attacks.json

### Changed

- Added some .json data for templated text (substances, reagents, adjectives, attacks)
- Default Keys now use color-based unlocking instead of universal unlock

### Fixed

- Item tiles in inventory now respect flipH/flipV properties
- player info window stops listening for item buttons when closed

## [0.5a] 2026-01-05

### Added

- UI tweaks including thermometer UI for health and nutrition stats
- Actors can have a non-item related collision_effect for melee attacks etc
- pushable actors work
- melee attacks use actor collision_effect

### Changed

- Pulled actor and item data from prototype.json, use actors.json and items.json in the prototype folders
- if there's no health for the player in prototype/actors.json, it's a one-hit death with no health bar
- changed effects.json to sounds.json as well as all supporting files and references

### Fixed

- Don't warn when walking into walls
- performance issue with fog of war related to multiple controlled actors

## [0.4a] 2026-01-03

### Added

- Basic UI (textboxes with selectable options)
- Player info window showing name, attributes, and inventory with letter-prefixed items (a, b, c...)
- Item action menu with Drop, Wear/Remove, and custom use_verb options
- Confirmation dialogs for hazardous movement (lava, void) with Y/N input
- A* pathfinding via ROT.js (`findPathAStar`, `findPathDijkstra`, `getNextPathStep`, `pathExists`)
- Bresenham line path algorithm (`getLinePath`, `hasLineOfSight`, `getFirstBlockingPoint`)
- Distance utility functions (`getManhattanDistance`, `getChebyshevDistance`, `getEuclideanDistance`)
- AI behaviors: `attack_adjacent`, `pursue_target` (with A* pathfinding), `flee_from_danger`, `incinerate_entities`
- `aggressive_melee` personality - enemies can chase and attack controlled actors
- `lava_behavior` personality - incinerates solid actors (spawns fire) and liquids (spawns smoke)
- `spawnActor` method for dynamically spawning actors at runtime
- `spawnEntity` method for spawning decorative entities from entities.json
- `remains` attribute for actors - spawns a decorative entity on death (blood, skull, rubble)
- `liquid` attribute for actors
- `fireproof` attribute check for lava hazard warnings

### Changed

- `canSeeTarget` now uses actual line-of-sight checking instead of just distance
- `moveToward` now uses A* pathfinding with fallback to simple directional movement
- `findNearestPlayer` properly calculates distance to find nearest controlled actor
- Equipment status now checked via `actor.isItemEquipped(item)` instead of `item.equipped`

## [0.3a] - 2025-12-30

### Added

- Item system documentation (ITEMS.md)
- Attribute-based item effects replacing hardcoded item types
- Collision effects: items can modify attributes on actors the holder collides with
  - Numeric values add/subtract (e.g., `"health": -10` for damage)
  - Boolean values set directly (e.g., `"locked": false` for keys)
  - `"toggle"` value toggles boolean attributes
- Wear effects: wearable items can modify wearer's attributes while equipped
  - Same value types as collision effects
  - Effects reversed on unequip
- Equipment system with three positional slots:
  - `top`: above actor's head (y-2) for crowns, horns, halos
  - `middle`: on actor's top tile (y-1) for helmets, masks
  - `lower`: on actor's base tile (y) for armor, cloaks
- Use verb system: items define custom UI verbs (e.g., "Drink", "Dig", "Fire")
- Custom pickup and use sounds per item with defaults
- Animated tiles now start on random frames for visual variety
- Sword item with collision damage
- Crown item with strength wear effect

### Changed

- Items auto-equip to appropriate slot when picked up
- Picking up item for occupied slot unequips previous item
- Removed weapon/attack_type attributes in favor of collision_effect
- Item properties (use_effect, restore_amount, etc.) moved into attributes

### Removed

- Hardcoded weapon boolean attribute
- Hardcoded attack_type attribute

## [0.2a] - 2025-12-29

### Added

- Up and down stairway actors for level transitions
- Level linking via next_level and previous_level prototype config attributes
- Player spawns at appropriate stairway when transitioning between levels
- Minotaur actor
- Wall wildcard tile (132) for manual wall placement in Tiled maps
- Tile flip support (flipBaseH, flipBaseV, flipTopH, flipTopV) for actor sprites
- Audio variation system with randomized volume and pitch

### Changed

- Lighting system now shows actor top tiles even when their base casts a shadow
- Footstep audio plays at lower volume with slight randomization for natural feel
- Refactored lighting logic into lighting.js helper methods
- Refactored audio code into separate sound.js module

### Fixed

- Turn engine no longer errors when unlocking an already-unlocked engine

## [0.1a] - 2025-12-18

### Added

- Core engine architecture with DungeonEngine orchestrating all subsystems
- Entity system with hierarchical Entity > Item/Actor classes
- Attribute-based entity properties (solid, pushable, flammable, breakable, visible, etc.)
- PIXI.js rendering pipeline with layered containers (background, floor, entity, darkness, UI)
- Tiled map loading with support for tilelayers and objectgroups
- Audio sprite support via Howler.js wrapper
- Prototype loading system for game configurations
- Wildcard system with contiguous region detection for procedural content
- ROT.js maze generation (EllerMaze) triggered by wildcard tiles
- Room generation with automatic wall actor placement on perimeters
- Maze-room passageway detection (walls omitted where maze paths meet room perimeters)
- Turn engine using ROT.js Scheduler.Simple
- Observer mode with auto-advance turns when no controlled actors
- Play/pause (space) and reload (escape) controls in observer mode
- Diagonal shadow rendering under floor tiles (addBaseAndShadows)
- Actor falling into void (removes from play, transitions to observer mode if player dies)
- Item pickup and per-actor inventory system (inventory attribute determines capacity)
- Sighted attribute for actors to check for floor before moving
- Input handling for keyboard (arrow keys, WASD)
- Animated sprites system with dynamic frame count detection from spritesheet width
- Tint flickering effect for fire animations using CreateJS Tween
- Wildcard tiles for spawning fire (tile 9) and sewage (tile 135) actors
- Darkness and lighting system using ROT.FOV.PreciseShadowcasting
- Light sources cast light that stops at walls and solid actors
- Fog of war with explored/unexplored tile tracking
- Textured darkness overlay using FULL_BLOCK tile with random flipping
- Solid fill for fully dark areas, textured fill for light gradations
- Door actors with open/close functionality
- Opening doors allows light to pass through
- Configurable ambient light and player light radius in prototype config

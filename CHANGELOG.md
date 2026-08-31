# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.19b]

### Next

- info windows for items

### Added

- **`Actor.hasInfoPanel()`** Actors with `description` `sentient` can spawn new info windows. See [docs/ACTORS.md](docs/ACTORS.md#what-earns-a-panel-actorhasinfopanel).
- **`InterfaceManager.growBoxOpen()` — a reusable box-open animation.** A few quick frames of an empty border expanding from an origin tile to the box's final rect.
- `placeBoxAwayFromPlayer` takes an `avoid` point.

### Changed

- **Mouse: hover reads, click acts.** Hovering a visible actor opens its info panel. `Tab` + `Enter` is the keyboard route to info windows for selected actors.
- **The hover panel waits, then grows in.** The pointer must rest on an actor for `HOVER_INFO_DELAY` (260ms) before its panel opens, so sweeping across a crowded room opens nothing and moving on cancels the pending open.
- `showActorInfo` gains a `sticky` option separating the two routes: the keyboard panel takes the active box and holds, while hover must not steal it or claim it can be closed with a key. So the hover panel omits the "Esc to close" footer.
- `actorAtClick` is now `actorAtPointer`, since hover is its main caller.
- Clicking a two-tile actor's head tile attacks it instead of trying to path through it.

## [1.18b]

### Added

- The Search action!
- **Monsters chase you between floors.** segmented creatures are excluded, since their parts are joined by live object references that can't cross a floor. See [docs/ACTORS.md](docs/ACTORS.md#level-transitions) and [docs/SAVING.md](docs/SAVING.md#entities-in-transit-between-floors).
- `hidden` attribute (different from `visible`)
- **Floor decorations** — a biome can scatter floor dressing across its floors with a `decorations` block: `{ entity | actor, pattern, density, min, max, freq, region? }`, the first generation-time use of `data/entities.json`. See [docs/BIOMES.md](docs/BIOMES.md#decorations).
- **decorations (floor scatter)** section in the biome editor, with an entity dropdown fed from `data/entities.json` and a pattern picker.
- `applyTilePattern` gains three extensions: neighbour tests on `tileContext` (`count4`/`count8`/`any4`/`any8`, taking a `(ctx, x, y)` predicate — the same shape as a rule's `when`); `options.bounds` to restrict the sweep to a sub-rectangle; and `options.collect` to return the matched cells (as an array, or a `Set` of `"x,y"`) instead of a paint count. See [docs/TILE_PATTERNS.md](docs/TILE_PATTERNS.md).
- **Graves you dig up.** A walkable, sediment-shaped `grave` actor that a mattock opens in one dig action, leaving a `hole` and rolling a skull, a nugget, a random weapon, a random ring or nothing — all declared in data, so the engine has no idea graves exist. See [docs/ACTORS.md](docs/ACTORS.md#diggable-walkable-actors).
- **A `Dig` verb for mining tools.** Bumping a wall can only reach a *solid* actor, leaving walkable `breakable`s unreachable; a `mining` item with `use_verb: "Dig"` now offers an inventory action that prompts for any one adjacent tile, or the one you're standing on.
- `applyCollisionEffects(target, withItem?)` takes an optional tool, so an item can be wielded straight from the pack — which is what lets an unequipped mattock dig, while equipping still governs bump-mining and attacks.
- **`drops` — a weighted loot table any actor can use.** One `{ item, weight }` alternative wins, an entry with no `item` is the "nothing" outcome, and `item` resolves as an item id, an item *type* (`"weapon"`) or an entity id (`"skull"`) — filling the gap between `remains` and `lode`. See [docs/ACTORS.md](docs/ACTORS.md#death).
- **`pedestal` can be painted in Tiled.** It gains `paint_tile: WHITE_DOOR_TOP` (tile 371) — its own base tile, so what you paint is what you see. No engine change: `getActorWildcardType` already turns any actor's `paint_tile` into a wildcard.
- **Every map generator can now be painted as a wildcard region.** Six had no marker tile: `dungeon` (197 `BOX_VERTICAL_HORIZONTAL`), `uniform` (142 `BLACK_SQUARE`), `rogue` (36 `NUMBER_SIGN`), `divided_maze` (232 `CROSS`), `icey_maze` (43 `ASTERISK`) and `arena` (44 `PLUS_SIGN`) — so the main generator, in particular, could be a whole floor but not one feature of one. Each fills the cells it leaves solid with walls honoring `wall_types`, so a painted region has its own boundary; the pre-existing `maze` (210) keeps its wall-less behaviour so no authored map changes. Regions too small for their generator degrade to walled open floor with a warning instead of throwing, which previously would have taken `loadFloor` down. `cave` (10) and `maze` (210) already covered `cellular` and `eller_maze` under older names. See [docs/MAP.md](docs/MAP.md#wildcard-tiles-generative-fills).

### Added

- **Actor info panels.** Clicking a visible actor now describes it instead of walking there; `Tab` then the confirm key (`Enter`) is the keyboard route, and `Esc` closes it. Modelled on Brogue's `monsterDetails`: name, description, a traits sentence, and — for a `tactician` — a two-sided combat forecast ("You have a 49% chance to hit it, and could defeat it in 5 hits"). Travel to a monster's tile is still reachable via `Tab` + `(x)plore`, so nothing was taken away. See [docs/ACTORS.md](docs/ACTORS.md#info-panel).
- **`data/attribute-info.json`** — maps an actor attribute to the phrase the info panel uses for it. An attribute is described *only* if listed, so engine plumbing stays invisible and a new attribute reveals nothing until someone words it; a string covers the truthy case, an object (`{"true":…,"false":…}`) can also speak for the falsy one, which is how "does not burn" gets said. Adding a trait needs no engine change.
- **`tactician` attribute** gates the combat forecast on the *viewing* actor, so it can be granted or lost mid-run rather than being fixed per prototype. Set on `player` by default.
- **`Actor.predictCombat(defender)`** — hit chance, damage, and hits-to-kill in either direction, computed without rolling or mutating anything. Mirrors the live pipeline (base → critical → backstab → strength → enchantment) and reports the random multipliers rather than sampling them, so the panel can say "5 hits, 3 with a lucky strike". Reads the current world, so an unaware monster shows its backstab figure and that figure changes when it notices you.

### Fixed

- **Damage scaling rounded inconsistently once shared between call sites.** Extracting `Actor.scaleDamage` so `applyCollisionEffects` and `predictCombat` cannot drift exposed that `Math.round` breaks halves toward +Infinity: scaling a positive magnitude turned 0.5 into 1 where the old negative-delta path produced 0 — a real off-by-one on odd damage at low strength (the player's `strength: 5` halves every figure). `scaleDamage` now rounds as the live path always did; verified identical across 7,200 damage/strength/enchantment combinations.
- **Two description fields were authored but unreadable.** `Item`'s constructor extracts a fixed list of root-level keys and silently drops the rest, so the `effect_description` on 34 potions resolved to nothing — and `Actor`'s root-to-attribute bridge omitted `description`, so the text on 23 actors was equally unreachable. Neither was visibly broken: the only item referencing the `[effect_description]` token is `mystery_potion`, which gets its copy from `templateVars` via `random_effect`, and nothing read actor descriptions at all. Both now bridge into attributes and are readable via `Item.getEffectDescription()` and `Actor.getDescription()`. As a side effect `use_description` is now stored as an attribute rather than a bare property, so it survives save/load, which it previously did not.

### Changed

- **Description fields are standardized on attributes.** `description`, `use_description`, `effect_description` and `collision_description` are now listed in `Item.DESCRIPTION_FIELDS` and bridged in from root level if authored there, matching how `Actor` has always treated its own set; an explicit attribute wins over a root-level value of the same name. No data file needed editing. Each field answers a distinct question and they stay separate on purpose — see the new [Description fields](docs/ITEMS.md#description-fields) section, which is the reference for the forthcoming item/actor info windows.
- **Space waits, `z` zaps.** Play/pause only ever meant anything in a zero-player prototype, so it no longer holds the space bar outright: space is bound to `wait` in the `actions` block, and reverts to play/pause when there is no living player to act for — the two share a key because a given prototype only ever wants one of them. That frees `z` (previously a second `wait` binding alongside `.` and Numpad5) for a new `zap` action, which opens the staff/wand picker, or aims straight away when you carry exactly one — the same shortcut `dig` uses. No data change was needed: the `staff` and `wand` types already declared `use_verb: "Zap"`, so `zap` filters the pack by verb and any item declaring that verb is offered. `toggle_pause` remains a bindable action for a prototype that wants pause on its own key. See [docs/ITEMS.md](docs/ITEMS.md#charged-items-staffs).
- **The `brogue` map generator is now `dungeon`.** It was named after Brogue's architect while being studied, and has long since diverged. `brogue` still works as a silent alias in the dispatch, so prototypes outside this repo keep loading. The `dungeon` *wildcard region* type was renamed `digger_region` (it wraps ROT.js's Digger) to free the word — its tile IDs 9/16/152 are unchanged, so no authored `.tmj` needed editing. All 17 `_brogue*` helpers were renamed too: 14 private ones to `_dungeon*`, and the 3 with callers in other generators de-prefixed to `_finalizeMap`, `_makeRoomRecord` and `_makeCavernShape`. No behaviour change — verified with a seeded golden-map diff (`tools/generator-golden.js`). See [docs/GENERATOR_ROADMAP.md](docs/GENERATOR_ROADMAP.md).
- **Biomes are now optional on a multi-level prototype.** The prototype editor's *Floor plan* is renamed **Biome plan** and gains the standard section toggle; switching it off drops `floor_plan` so every floor uses the prototype defaults — already a supported engine mode, since `resolveBiome` returns `{}` and `getFloorConfig` falls through.
- **Editor constants that name engine vocabulary are shared, not duplicated.** `CATEGORY_KEYS`, `GEN_TYPES` and `DECORATION_PATTERNS` moved out of `proto-state.js`/`biome-state.js` into `editors/scripts/editor-constants.js`, loaded first by both editors, with each list pointing at the `data/` or `engine.js` counterpart it must not drift from.
- **`Cancel` attribute lets states cancel one another out.**
- **States can lose a turn at random, entirely from data.** `skip_turn_chance` gains `skip_turn_message`, `skip_turn_sound`, `skip_turn_spawn` and `skip_turn_effect`, so a state describes its own lost round. Nausea's retch-and-spawn-vomit case was hardcoded in `Actor.act()`; it now lives in `states.json`.
- `Actor.applyStatEffect()` is shared by state per-turn effects and one-off state events, so neither path can skip the death check. `findStateWithProperty()` replaces `getStatePropertyValue()`, returning the winning state rather than just its number so the caller can read the rest of its data.
- `isIncapacitated()` and the new `isConfused()` replace scattered raw `hasStateProperty('skip_turn')` / `('random_movement')` checks across `engine.js`, `input.js` and `behaviors.js` — the same concept had been spelled four different ways. `isMindState()`'s seven-term boolean chain is now the `Actor.MIND_STATE_PROPERTIES` list.
- `RenderSystem.applyViewportCulling()` replaces two near-verbatim viewport-culling blocks in `Actor.updateSpritePositions` and `updateEntityVisibility`.
- **Mining messages come from the target, not the engine.** The five progress strings were all about stone, so a target can now override them with a `mine_messages` map keyed by progress band (`"25"`/`"50"`/`"75"`/`"100"`), resolving `[tool_name]`. `dig_fail_message` and `dig_chance` are authorable on the target too.
- `drop_message` replaces the hardcoded "falls from the rubble!" on `lode` drops, defaulting to that same string, so one attribute narrates both drop paths.
- **Docs: explain data type options, don't enumerate the data.** some docs grooming, need to do more
- `generateCollapsingFloors`, `generateAbyssAt` and `generatePalladianAt` now use `applyTilePattern` in collect mode instead of hand-rolled nested loops — taking the method from one caller to four.
- a *lot* of changes to the ~~brogue~~dungeon-style generator to try to get good secret door placement

### Removed

- **Removed the `abyss` wildcard (tile 218).** Painting a region to get a hole was the roundabout way to do it: leaving the floor layer unpainted already makes a void, exactly where you outline it, with no randomness. The wildcard instead scattered blobs over a random 4–45% of the painted region, which is a different thing and not what the tile implied. No map used it. The `abyss` **option** on `map_generator` — the one `depths`, `infernal`, `caves` and `sewer` actually use for random chasms — is unaffected.

### Fixed

- `docs/TILED_KEY.md` listed `collapsing_floor` as tile 47; it is 26. Its generator table also still had two rows called "Dungeon" after the rename — tile 16 is the `digger_region` wildcard.
- **The biome editor only offered 5 of the engine's 11 map generators.** `GEN_TYPES` listed `brogue`, `digger`, `arena`, `infernal` and `palladian`, leaving `cellular`, `uniform`, `rogue`, `divided_maze`, `icey_maze` and `eller_maze` unpickable — including `cellular`, which `prototypes/mine` actually uses, so a designer could load a biome the editor couldn't represent. All eleven are now listed, ordered by capability, and the generator table in [docs/PROTOTYPE.md](docs/PROTOTYPE.md) marks which build walls and rooms: six of them carve floor only and support no walls, doors, torches or room regions.
- **`food` was missing from the editors' item-category list and from the dungeon's spawn tables.** `CATEGORY_KEYS` now matches the `domain: "item"` types in `data/types.json`, and food is in the dungeon's `item_catalog` plus all three biomes, so it drops throughout instead of only from floor 1's hand-placed override.
- **Editor number fields ignored their own bounds.** `fieldRow` accepted `min`/`max`/`step` but never set them on the input, so all 25 number fields in the biome and prototype editors were unbounded and a `min_depth` of 0 saved cleanly; depth and floor fields now clamp to 1, counts and sizes to 0 or 1, with `intercept` and `slope` left unbounded as signed ramp coefficients.
- **Plain entities were silently dropped on save/load and on floor revisit.** `Entity.serialize()` emitted no type discriminator, so `deserializeEntities()` matched neither `isActor` nor `isItem` and discarded dug rubble, blood and slime whenever you left a floor and came back; entities now serialize an `isEntity` flag and restore through `spawnEntity`. (`liquid_track`, which has no `entities.json` entry, is still dropped.)
- `fungus.cluster` was read by the engine but never forwarded by `resolveBiome`, so a biome had no way to turn fungus clustering off.
- generic keys are no longer consumed by walking through unlocked doors
- epistemology and visibility of submerged actors is improved
- **`escape_chance` was read from the wrong states.**
- **A dropped item was hidden underneath floor dressing.** Items on dry land rendered below any entity carrying a tile, so loot landing on rubble, moss, a skull or a dug-out hole vanished under it; items now render at `ITEM_Z` (7), above the dressing and still below actors.

## [1.17b]

### Added

- `MapManager.applyTilePattern(layer, rules, options)` — paints a tile pattern onto a layer by evaluating an ordered `{ when, paint }` rule list at every cell, first match winning. `addBaseAndShadows` is now three rules over it instead of hand-rolled nested loops. See [docs/TILE_PATTERNS.md](docs/TILE_PATTERNS.md).
- Void tile ids live in `globalVars` (`VOID_FILL`/`VOID_SHADE`/`VOID_DIAGONAL`, plus the `VOID_TILE_IDS` recognition set), so an abyss can be restyled from one place instead of five scattered literals.
- Actor **types** — reusable bundles of actor defaults, inherited with `"type": "beast"`. Defaults in `data/types.json`, per-prototype overrides in `prototypes/<name>/types.json`, resolved in `Prototype.getActorData()`. Ships `beast`, `undead`, `humanoid`, `terrain`. The actor's own keys win; `attributes`/`stats`/`collision_effect` merge one level deep, `null` unsets. See [docs/TYPES.md](docs/TYPES.md).
- Type dropdown in the actor editor, showing what the selected type contributes.
- documentation for architect.js' applyTilePattern method
- experimenting with a superheated state for non-flammable actors
- states can grant attributes now
- the tab (default key) to cycle interaction from explore walk targets has been extended to throwing and staffs/wands
- return now commits to a target for both walking and throwing/spells- states can grant attributes now

### Changed

- `applyState()` works on **any** actor now — a tree can burn, a boulder can get stuck.  New `applyCreatureState()` for callers that mean "affect a creature."
- A prototype's `actors.json` **supplements** the base actor instead of replacing it, so an override states only what it changes. **Behavior change:** six overrides that omitted keys their base declares now inherit them — `arena/player` and `labyrinth/player` gain `sentient`. Use `null` to unset deliberately.
- 25 actors converted to types, cutting 57 lines from `actors.json`.
- All random word lists consolidated into `data/words.json`.
- Dropped the vestigial `sighted` attribute from the actor editor.
- refactored addBaseAndShadows() away from old hardcoded tile id's that prevented tinting backgrounds and re-included background layer in the lighting pass
- The weapon tile that flashes during an attack now points at the actor being hit, mirroring horizontally, vertically, or both for a diagonal.
- Type based state immunity tweaks.
- The keybindings screen's private key-name formatter moved to `InputManager.formatKeyName()` and is shared.
- Prototype editor's Advanced section listed `floors`, `floor_plan` and `biomes` as unrecognized keys it couldn't edit, even though the Floor plan section manages them — `KNOWN_TOP_KEYS` was never updated when biomes landed. The dungeon was the visible case.
- Fixed tab targeting offered water, lava, fire, gas clouds and **hidden traps** as travel destinations.
- A floor's up and down stairways could generate right next to each other, making the floor skippable in a step. `pickStairwayTile` now prefers tiles at least `STAIRWAY_MIN_SEPARATION` (8) tiles from the already-placed stairway.
- burning state damage per turn added
- swapped out the braziers that flank generated stairways with an adjusted torch actor, now called wall_torch
- Don't need to force render top on liquids any more to get the wading effect, removed the render attributes on them.
- Removed the old unused drain actor.
- tweaks to lighting and fov
- can't push a pushable actor into a stairway now
- zebra striped lists extended to help window keys

### Fixed

- tinting background layers, see changed
- fixed stairways generating on the lip of abysses.
- The `caves` biome rooms mostly failed to place due to size, resized.
- Fixed burning actors stepping into water not extinguishing.
- Fixed actors falling twice in collapsable floors and pushable actors not triggering collapse.
- `apply_state_radius` counted immune creatures in its "N creatures are affected" message.
- `docs/ACTORS.md` claimed actors are `flammable` by default; the engine defaults it to `false`.
- an attempt to fix an intermittent bridge box-drawing tile bug, needs testing

## [1.16b]

### Added

- "Infrastructure sight" folded into magic mapping
- degrading/breaking items (mattock is the test case)
- new "palladian" map generator for boss/artifact areas
- Biome editor (`editors/biome-editor.html`) and a shared biome library. Biomes are now data files like actors and items: defaults in `data/biomes.json`, per-prototype additions/overrides in `prototypes/<name>/biomes.json`. `prototype.json` only names them in its `floor_plan`. See [docs/BIOMES.md](docs/BIOMES.md).
- `data/prototypes.json`, an index of the prototype folders. Static HTTP can't list a directory, so the editors read it to fill their prototype dropdowns — previously four editors each carried a hardcoded list, all of them out of date. Add a line here when you add a prototype.

### Fixed

- Exploration (map memory) is no longer lost when you revisit a floor
- Item colors are named in text feedback
- `treasure_room` now reads the resolved floor mechanics, so a biome or floor override can set its own rate — previously only the prototype-level value applied. **Behavior change:** in the dungeon this lowers the treasure-room chance on 18 of 26 floors (caves 40%→10%, depths 40%→20%), which is what those biomes always intended. Floors 1 and 26 keep 40% via explicit overrides, and `infernal` inherits the root 40%.
- Burnout no longer fires on items that aren't burning
- Health showed decimals while starving

### Changed

- Moved biome editing to its own devoted editor, just apply them in the floorplan section of prototype-editor
- Torch fuel amount can be set from item data, which sets a precedent for other timed consumable items.
- "walk_description" attribute is extended to Actors as well as Entities

## [1.15b] 2026-07-22

### Added

- **Biomes (depth-ramping)**: a multi-floor prototype can now define a `biome` — a themed bundle of depth-ranged spawn/item/hazard catalogs — and assign it to floor ranges via `floor_plan`.
- **Drink-at-self potions**: a new `use_at_self` item attribute lets a potion that normally only does something when thrown (e.g. the potion of incineration) be drunk anyway — it triggers its own break/explosion effect on the drinker's tile.

### Changed

- **Prototype editor cleanup sweep**: a pass over the whole prototype editor to cut clutter and make implicit settings implicit.

### Fixed

- More corridors
- Better room distribution

## [1.14b] 2026-07-14

### Added

- A new **Tab** key (`cycle_target`) cycles through reachable points of interest — ground items and important actors (doors, stairways, gateways, and any actor with a personality) — previewing the path to each; pressing (x)plore then travels there.
- **Random fungus + spore clouds**: an opt-in `fungus` generation block (`{ min, max, tall_chance? }`, per prototype or per floor) scatters clustered fungus patches, each with a random name (from `fungi_types.json`) and color. Short `fungus` is walkable and glowing; walking onto it crushes it and puffs out a small spore cloud tinted to match, applying a random, usually-beneficial potion-style effect. `tall_fungus` is a solid, flammable, sight-blocking cluster. Enabled on every non-infernal dungeon floor.
- **`crushable` actor attribute**: a general "destroyed when an actor walks onto it" attribute for non-solid actors, decoupled from the separate `spore_release` add-on (which makes a crushed actor also release a spore cloud).

### Fixed

- **Ascend-to-win on single-level prototypes**: a prototype can now be won by walking *onto* an up-stairway that a `win_conditions` unlock opened (e.g. wear the crown → the sealed stairs open → step onto them to win), a clean two-step flow distinct from the dungeon's bump-the-sealed-exit escape.
- **Named bump message**: bumping a solid actor now reads "You bump into the wall." / "You bump into mushrooms." using the actor's own name, instead of always saying "a wall" (and no longer doubles up the generic message).

## [1.13b] 2026-07-02

### Added

- **Goblin ambushers + reach weapons**: a new `goblin_spearman` actor (with the `goblin_ambusher` personality) lies in wait just inside a room beside its entryway and only springs when the player comes into view — otherwise it seeks out the nearest ambush spot rather than wandering.
- **Opt-in auto-wear on pickup**: a new `auto_wear` item attribute makes specific wearables (e.g. the `crown`) equip automatically when picked up, while everything else stays manual.
- **`render_layer` actor attribute**: an actor can declare `render_layer: "bottom"` (or `"top"`) to control how its sprite stack orders against other actors sharing its tile, instead of relying on sprite insertion order.

### Fixed

- **Fire trap instant-kill**: stepping on a fire trap could instantly kill a full-health player instead of dealing ~8 damage. Two separate causes: fire damage now caps at once per victim per turn (overlapping/spawning/adjacent fires can no longer stack many 8-damage hits in a single turn), and — the actual killer — the `ignites` spawn logic no longer instantly incinerates living creatures (actors with a health stat) as if they were flammable scenery; creatures burn for damage over time, only inert flammables (trees, webs, bridges) are consumed into fire. Fire also dedupes to one actor per tile.
- **Flying actors & ground hazards**: a flying actor hovering over a collapsible floor no longer collapses it
- **Dart turret only fired once and couldn't be attacked**
- **Monsters ignoring or freezing near the player**: melee monsters (goblins, rats, jackals, etc.) now retaliate against an attacker they can't currently see (added the `defend_self` behavior to the melee personalities), instead of only chasing by line-of-sight.
- **Hallucination/confusion cleared on level change**: falling or taking stairs to another floor while hallucinating (or confused) no longer drops the full-scene visual effect.

## [1.12b] 2026-06-16

### Added

- **Spider web attack**: the spider's new `web_spinner` personality sprays a cone of webs at the player from range (via the data-driven `spray_web` behavior, tunable range/arc/cooldown/min-distance), then closes in to bite. Webs are non-solid, flammable obstacles that apply the `stuck` state on contact; you roll each turn to break free, and a web tears away when you do (new `consume_on_escape` attribute) — so a patch is something you chew through, not a permanent carpet. Fire also clears webs.
- **Stuck on non-solid hazards**: non-solid actors with a `collision_effect` (stat damage and/or `apply_state`) now apply it when an actor *walks onto* their tile, not just on a melee bump — previously only `cloud`/`mist`/`sewer_gas` qualified. This is what makes webs and quicksand actually stick you; `consume_on_escape` separates consumable stickers (webs tear) from permanent terrain (quicksand stays).
- **Quicksand**: a non-solid deep-liquid hazard that holds actors with the `stuck` state, strips/drifts dropped items, and mixes color with adjacent liquids. Unlike webs it persists — you struggle out tile by tile.
- **`flies` attribute**: a boolean attribute (selectable in the actor editor) granting the permanent `flying` state at spawn, so designers mark a flyer where they'd look for it instead of hand-adding an innate state. Existing flyers (bat, crow, clouds, mist, steam, sewer gas) migrated from `innate_states: ["flying"]`. The editor's Innate States control is now a dropdown of defined states instead of free text.
- **Colorful canvas text UI**: inline `[c=#RRGGBB]…[/c]` color spans let a single line mix colors (e.g. the reddish-purple "Cursed" label), plus zebra-striped lists, amber accents on item stat sub-lines, and colored thermometer/stat bars.

## [1.11b] 2026-06-12

### Added

- **Prototype win screen**: a prototype can declare a top-level `win_state` (distinct from per-floor `win_conditions`) that ends the game when met. The win screen fills the canvas with white full-block tiles running the new `gradient_wave` color-cycle effect (horizontal red/gold/blue bands scrolling upward) and writes the completion message in letter tiles over it. Terminal — input and turns lock. Demoed on the **Combat Arena** (`arena.html`): defeat the Minotaur to win. Designed to display tracked stats (kills, gold, etc.) on the screen later.
- **Reusable `gradient_wave` effect**: a new data-driven effect primitive (in `effects.js` + `data/effects.json`) that tints sprites with scrolling horizontal color bands from an arbitrary `colors` palette (cycled as a ring). Available to any prototype or actor like the other named effects.
- **Roguelike amulet-escape win**: the **dungeon** prototype now has the classic win condition. The Amulet of Yendor spawns on the last floor; carry it back to floor 1 and use the sealed exit to win ("You have escaped with the Amulet of Yendor"). The floor-1 up-stairway is the locked escape exit — bumping it without the amulet rejects you ("The exit is sealed. You need the Amulet of Yendor."), and an authored `up_stairway` placed on the map is automatically converted to the sealed exit (locked, solid, and re-skinned to the Sealed Stairs sprite), so designers can position it freely. Implemented as an `escape`-style `win_state` (`via: "escape"`), an extension of the win-screen system above — the escape is triggered deliberately by using the exit, not the instant the amulet is picked up. The dungeon's old `caverns` transition is removed; the amulet is now the only way out.

### Fixed

- **Silent loading events**: events that fire while a level is loading (before the player clicks to start play) no longer leak sounds or messages — fixes the spurious "The Sealed Stairs opens." that printed at game start for levels with authored locked stairways.
- **Escape exit no longer unlocked by floor win conditions**: the dungeon's floor-1 escape exit is gated solely by the amulet (the prototype `win_state`), so it is now exempt from the per-floor win-condition lock/unlock system — previously, satisfying floor 1's (empty) `win_conditions` by, e.g., killing a monster would wrongly open it. The sealed look and lock also persist correctly when returning to floor 1 after descending.

## [1.10b] 2026-06-06

### Added

- **Overlay layer transparency**: tiles on the authored `overlay` map layer (used for outdoor levels with tall structures) now go translucent when an actor passes behind them, the same way actor "height" tiles already did. Reveals the actor's full two-tile footprint; applies to controlled actors, NPCs, doors, stairways, and gateways.
- **Locked stairways are a locked pair**: when a level's down-stairway is sealed by an unmet win condition, the matching up-stairway on the level below is now locked too. Previously a player who *fell* between levels (bypassing the stairs) could simply walk back up through a stairway that should still be sealed. The pair stays in sync — meeting or re-breaking the win condition unlocks/re-locks both halves, including on levels visited earlier or not yet visited.
- **Generic (any-key) locked doors**: designers can author a simple, unpaired lock. A locked door with `lockable` but no `color_locked` (or the new `generic_locked_door` actor) is opened by *any* key, and any key can open *any* generic locked door — alongside the existing color-paired key/door system. Stairways and gates remain key-proof.
- **Per-object `default_items` override**: an actor object placed in a Tiled `actors` layer can set a `default_items` custom property to override the starting inventory for that one placement (JSON array, comma-separated list, or empty to hold nothing). For example, a `pedestal` can be made to hold a crown instead of its default key — no new actor type needed. See [docs/MAP.md](docs/MAP.md).
- **Splitting creatures**: an actor with the `splits` attribute (e.g. the new `pink_jelly`) divides when it survives a hit — the struck creature drops to half health and a copy spawns on an adjacent tile at matching health. By default the copy is the same type; an optional `split_into` makes it spawn a *different* type — e.g. the large two-tile `pink_jelly` (which can grab) breaks off smaller single-tile `small_pink_jelly` blobs (which can't grab). Splitting stops once health falls below `split_min_health` (a natural cap) or when no adjacent tile is free; a killing blow never splits.
- **Stuck state + engulfing creatures**: missing a melee attack against a non-solid creature now lets the player blunder onto its tile, taking its collision damage. A creature with a `grab_state` (the new `pink_jelly` uses the new `stuck` state) then holds the player fast — each move attempt rolls an `escape_chance` (~⅓) to break free; a failed struggle costs the turn. An optional `grab_sound` on the creature plays when it grabs (the jelly uses `step_mud`). The `stuck` state is data-driven and reusable for future webs, snares, and bear traps.

### Fixed

- **Deep water submersion**: restored the missing `deep` attribute on the `deep_water` actor, so traversing deep water once again submerges the player (a regression that left submersion working only for deep sewage, while the float-items behavior still worked for both).
- **Input during collapsing-floor fall**: player input is now blocked during the pause when a collapsable floor activates, so the character can no longer move again before falling to the next level.
- **Stairway naming**: unlocking a stairway no longer mislabels it "Stairs Down" regardless of direction; up-stairways are now correctly named.
- **Keys open doors, not stairways or gates**: a key bumped against a locked actor now only unlocks doors — either the color-matched `locked_door` it's paired to, or any *generic* locked door. Previously a carried key would silently unlock *any* openable+locked actor on contact — including win-condition-sealed stairways and switch-driven gates — which let complex levels (key → door → crown → win condition → stairway) be short-circuited.
- **Key/door colors pair regardless of spawn order**: a key and its color-locked door now always share a color, even when the key is authored *before* its door on the map (e.g. a pedestal key listed ahead of the door). Previously the key's color was assigned at spawn time from a not-yet-populated queue, so a key placed before its door got a mismatched random color and couldn't open it. Pairing is now reconciled once after all doors and keys are placed.
- **Pink jelly was inadvertently solid**: the `pink_jelly` never set `solid: false`, so the engine's default (`solid: true`) made it block movement like a wall — the "miss → blunder onto the jelly's tile and get stuck" behavior could never trigger. Marked it non-solid so the engulfing/stuck interaction works.

## [1.9b] 2026-05-24

### Added

- **Item editor** (`item-editor.html`): web tool for creating and editing item definitions with live preview, tile picker, and template presets for weapons, potions, scrolls, rings, staffs, wands, armor, and food
- **Actor editor** (`actor-editor.html`): web tool for creating and editing actor definitions with tile preview, stat configuration, and equipment setup
- **Personality editor** (`personality-editor.html`): web tool for editing behavior-driven AI personalities with drag-reorder behavior lists and contextual parameter fields
- **Parameterized behaviors**: behaviors can now have inputs from personality data instead of just hardcoded values

### Fixed

- **Sidebar shows effective stats**: defense, strength, and accuracy in the HTML sidebar now reflect equipment and passive item bonuses, not just base attribute values (try with shield in labyrinth prototype)

## [1.8b] 2026-05-20

### Added

- **Darkness affects FOV** On dark levels, vision is now limited by available light. No torch means you can only see adjacent tiles; environmental light sources expand your view as you approach. Enemies can only detect you from a distance if you're illuminated. New `dark_vision` attribute on bats, rats, spiders, wraiths, and ghasts bypasses this.
- **Switches** There's now a switchable actor attribute that we are using for levers and trap-style pressure plates. These use either proximity or a "machine-id" attribute to activate actors like gates. switch_effects picks what target attributes are effected and switch_message sets the text feedback. The default lever and pressure plate actors are used by architect for some treasure room variation but this needs lots of testing.
- **New Maze Generator** (see in progress) Trying a more Brogue-like approach than the previous "digger" type, needs testing.
- **Collapsable Floor actor** lots of work around the platform actor attribute, which was just a stub before

### Fixed

- bug where dead actors became visible again after leaving and reentering the viewport
- blinking to an invalid spot goes as far as it can now instead of failing in an ugly way
- torch light appears same turn they are lit
- burning condition displays correctly now
- when confused you are no longer only warned when you are actually about to step on a hazard
- invisible playable characters are translucent, npcs are invisible and hidden from sidebar

## [1.7b] 2026-05-12

### Added

- **Attract screen**: prototypes display a "Click to Play" splash overlay on initial load — solid OPAQUE_FULL_BLOCK grid with randomly flipped tiles and white text rendered from new white tile variants. Click, tap, or any keypress triggers a radial wipe originating from the player's position (or viewport center in observer mode) that reveals the game underneath. Input and the turn engine remain disabled until the wipe completes. Splash only appears on first load; floor transitions skip it.
- **Liquid tracks**: actors walking through liquid tiles leave 3 tiles of connected WHITE_DOTTED_BOX track entities tinted with the liquid's color, with directional tile selection for straight segments and corners.
- **Weapon/armor identification**: Brogue-style — enchantment bonuses, curse status, and descriptions are hidden until identified. Scroll of Identify reveals per-instance (not type-based like potions/scrolls). Weapons auto-identify after 20 successful hits; armor after taking 20 hits. Equipping a cursed item reveals its identity immediately.
- **Ring equipment slots**: two ring slots added to the equipment system. Rings must be equipped to apply their effects (defense, strength, vision range, per-turn bonuses, light). Wear/Remove actions available in inventory. Actors auto-equip rings on spawn.

## [1.6b] 2026-05-08

### Added

- **Stat dependencies**: stats can now depend on other stats and attributes via two new JSON sub-fields. `restore_from` makes a stat's regeneration cost another stat (e.g., health regen debits nutrition). `rate_scaled_by` scales a stat's per-turn rate by an attribute (e.g., nutrition drain increases with strength). See [ACTORS.md](docs/ACTORS.md#stat-dependencies).
- **Dungeon generator improvements**: lakes and abysses now appear in procedurally generated levels
- **Wall digging**: generated levels allow better digging into walls
- **Better FOV epistemology**: sidebar messages for NPC combat, state changes, traps, and environmental effects are now filtered by player field of vision — events in remembered (dark) areas are no longer reported
- **Help window**: press `?` to open an in-game help screen that dynamically lists all key bindings; dismiss with `?` or `Esc`
- **Keybindings data file**: non-movement key bindings moved to `data/keybindings.json` for designer editing; action descriptions used by the help screen are also defined there
- **Bolt attack behavior**: `bolt_attack` NPC behavior reproducing the Staff of Lightning effect — configurable range, cooldown, and damage via personality data
- **Custom actor light radius**: actors can now define `lightRadius` at the data level (previously all light sources defaulted to radius 5)
- **Torch toggle behavior** light/extenguish
- **Inventory item stacking** exact same items stack with a number in inventory
- **Spike item** spike doors like in Moria or throw like darts in Brogue

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

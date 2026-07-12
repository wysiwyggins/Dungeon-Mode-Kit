# Bugs and ideas

Items marked [B] are Brogue-parity features, [Z] are ZZT-inspired, [b] are Bitsy-inspired.

## Bugs

- on dark levels collapsable floors can be detected because they are lit like other actors rather than like floor tiles

- don't float away items that are worn or equipped in deep liquid actors

- overlay tile layer shouldn't be affected by line of sight blocking?

- you can currently throw an item onto a void tile and it does not fall to the next level

- scroll of shattering should check to make sure there isn't an abyss already where it creates floor under the areas it "destroys"

- when an opaque actor dies, the shadow it casts remains until the next turn. likewise, when a fire actor is spawned, it does not generate light until the next turn

- rings should have material names not color names

- staff of blinking shouldn't reveal its range before it has been identified

- walking into a locked door displays both 'the door is locked' and you 'bump into a wall' messages.

- prototype editor has lake and abyss checkboxes that create the same forms including a dropdown for either lake or abyss options, consolidate this. also checkbox selection here collapses the section when changed

- jackals should be aligned

- don't use up keys on unlocked doors, don't distribute generic (unpaired) keys on levels without generic locked doors

- mass noun attribute for items in addition to actors. (meat)

- The word "inverse" is used inconsistently in tile names. Some names, like inverse box drawing tiles, should be "white"

---

## Feature ideas

### Hero personality

- a personality anmd behaviors that would automate an actor that would normally be playable, for zero player observer prototypes, code could be re-used for an (x)plore action.

### Game win [b]

- [x] a prototype can have win conditions, similar to levels. when the condition is met, we would fill the canvas with white full block, and write over that in letter tiles all the tracked statistics for the prototype (kills, gold, etc) and run the same color cycle effect on the canvas as the aqua vita potion.
- the basic win conditions would be getting an object on the lowest floor to a locked exit on the top floor or killing a monster on the lowest floor. Another win condition would be being the only remaining controllable actor in a pvp game

### Stepping stones

If you push a pushable actor (like pushable wall) onto a deep actor like deep sewage, it appears to sink (top tile moves to base tile and is replaced by null). This also visually suggests that the actor could serve as a platform to walk on if it is next to a floor tile with no deep actor there. A desired behavior would then be, if a solid actor is on a deep tile and another actor approaches it from a tile with no deep actors, treat the "sunken" actor as platform: true and walk on it without sinking too. If an actor approaches the sunken actor from another deep tile, behave as before. This means inside the deep liquid an actor would push the pushable wall, but approching from the shore, the moving actor would visually "walk on top" of it. This might be an overcomplicated, bad idea!

### PVP

- A prototype should allow for mutliple player controlled actors and become a turn based mutliplayer game as a reuslt. Test this with a Chaos style vs strategy prototype

### Dialogue

- A dialogue/options window
    This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.
- [ ] Dialogue trees — branching conversations with NPC actors, driven by JSON scripts like ink json exports.
- [ ] Dialogue conditions — branches gated by inventory, variables, or prior choices
- [ ] Dialogue effects — conversation choices that give/take items, set variables, trigger events
- [ ] NPC interaction on bump — non-hostile actors open dialogue instead of attacking
- [ ] Ending triggers — dialogue or events that trigger win/loss conditions
- [ ] Multi-page dialogue — pagination for longer conversations

## Variables & Game State [b][Z]

- Arbitrary variables like bools could be added to prototypes that could be changed by events like actor attributes currently are. This would be a tool for designers to add persistent states across levels that can be changed by the player. Can also be a per level "win condition" (stairway unlock).
- [ ] Prototype variables — persistent key-value state across floors (booleans, numbers, strings)
- [ ] Variable modification — actors/items/dialogue set variables on interaction or death
- [ ] Conditional spawning — actors/items appear only when variable conditions are met
- [ ] Global counters — score, collectible counts, tracked in prototype state
- [ ] Time limits — turn countdown per floor or per prototype [Z]

### Scripted Behaviors [Z][b]

- Scripted npc actor actions- a script of turn-by-turn actions that gets executed by an actor and then it returns to other behaviors, expand existing behavior editor page
- [ ] Action sequences — personalities execute a fixed series of actions (move, wait, speak, spawn)
- [ ] State machines — personalities with named states and transition conditions
- [ ] Patrol paths — actors follow a defined waypoint route instead of random patrol, might require a path drawing tool other than Tiled
- [ ] Triggered behaviors — personality switches when a variable or event condition is met
- [ ] Conditional behavior list — behaviors that only execute when a variable/state check passes

### Event System [Z]

- [ ] Event broadcasting — actors emit named events (e.g. "lever_pulled", "boss_killed") this could suppliment or replace win_conditions and machine_id
- [ ] Event listeners — actors respond to events with attribute changes, spawns, or removal
- [ ] Touch events — trigger effects when actors become adjacent (not just collide) [Z]
- [ ] Chain reactions — events trigger other events (button → trap → door → spawn)
- [ ] Actor messaging — actors send commands to specific other actors by machine_id [Z]

### Actors & Creatures

- [ ] Auto-explore — pathfind through safe explored areas, stop on encounter [B]
- [ ] Searching action to discover traps and eventually hidden doors
- [ ] Aquatic creatures — actors restricted to water tiles, can't be pushed onto land
- [ ] Burrowing creatures — can move through wall tiles, leave tunnels behind
- [ ] Splitting creatures — on death, spawn smaller versions (slimes, oozes) [B]
- [ ] Invisible creatures — only visible via telepathy or adjacency (visible: false exists, but needs telepathy build-out) [B]
- [ ] Creature mutations — random bonus traits applied at spawn (agile, poisonous, fire-immune) [B]

### Ally System

- [ ] Ally recruitment — wand of domination or freeing imprisoned creatures [B]
- [ ] Ally commands — follow, wait, attack target, guard area
- [ ] Ally empowerment — spend charges to permanently increase ally stats [B]
- [ ] Ally trait learning — allies absorb abilities from defeated enemies [B]
- [ ] Faction system — actors with faction tags, hostility determined by faction relationships

### Combat

- [x] Backstab — attacking unaware/sleeping enemies for bonus damage [B] (3x vs. sleeping/stunned/paralyzed or unalerted AI; engine.js `BACKSTAB_MULTIPLIER`)
- [ ] Weapon runic enchantments — special procs beyond the existing weapon_proc system (vampiric, slowing, quietus, paralysis) [B]
- [ ] Armor runic enchantments — defensive procs (reflection, reprisal, immunity, absorption) [B]
- [ ] Grappling — creature seizes target, preventing movement until broken free [B]

### Items

- [ ] Charms — new item category: single charge, periodic recharge, area/self effects [B]
- [ ] Item polarity — items classified as positive/negative, revealed before full ID [B]
- [ ] Wand of domination — tame a wounded enemy [B]
- [ ] Wand of empowerment — buff an ally [B]
- [ ] Wand of plenty — clone a creature [B]
- [ ] Containers — chests, bags that hold multiple items

### Terrain & Environment

- [ ] Tall fungus — blocks line of sight, can be trampled flat, flammable [B]
- [ ] Conveyor belts — tiles that push actors/items in a direction each turn [Z]
- [ ] Cobwebs — slow movement, flammable, spiders immune [B]
- [ ] Sunlight tiles — upper-level areas with natural light [B]
- [ ] Brimstone — hot ground near lava, damages non-fire-immune actors [B]
- [ ] Steam vents - periodic scalding clouds [B]

### Dungeon Generation

- [ ] Biome/theme system — per-floor visual and mechanical themes (crypt, sewer, infernal already exists)
- [ ] Secret doors/rooms — would require searching action, could also use pushable walls
- [ ] Outdoor generation — open areas with scattered terrain features

### Lighting & Vision

- [ ] Stealth range — detection radius affected by light level, armor, rings [B]
- [ ] Light-sensitive creatures — enemies that avoid lit areas or are weakened by light

### Map & World Structure

- [ ] use white box drawing tiles to draw a perimeter around the map, giving a visual clue for which parts of the viewport can be crossed over to a new screen. Perimeter should block movement.
- [ ] Persistent floor state — items dropped on a floor remain when you return (partially exists)
- [ ] Hub areas — safe zones between dungeon levels for shops, NPCs, storage (runes of protection could use the existing evil eye tile)

### Progression

- [ ] Achievements — tracked accomplishments across runs
- [ ] Compendium of discoveries — a list of all the things discovered in a prototype across play sessions
- [ ] Score system — point tracking based on depth, kills, items, gold [B]

- [ ] Recording/replay — deterministic action log for replaying completed runs [B]

### Sound & Music

- Add more tones to sound sprite with specified notes for use in simple music tracker for levels. Bitsy is so good at this
- [ ] Background music — looping tracks per prototype or per floor
- [ ] Music notation — simple tracker for composing level music from tone data
- [ ] Adaptive music — track changes based on combat/peaceful state
- [ ] Ambient sound — environmental audio loops (dripping, hauntings, crackling torches)

### Editor Tools

- A web front end level creator would create a prototype that supplements and sometimes overrides the base data. It could even have an upload or pixel art tool for adding tiles to an overriding prototype version. You'd be able to experiment with combining tiles to make actors. A web map editor would replicate some tiled features but would also let you paint entities with color tints, currently tiled can only draw shapes with objects and attributes for entities which you can't see the tile or tint of.
- future- the kit is hosted online in a way that users could create prototypes with web forms and test them, like bitsy.
- Look to Bitsy and ZZT for feature inspiration as well as roguelikes, we want to be surprised by what designers make rather than be proscriptive
- [ ] Dialogue editor or ink — visual tool for authoring branching dialogue trees
- [ ] Prototype editor — configure prototype.json visually (mechanics, win conditions, floors)
- [ ] Variable editor — define and manage prototype variables
- [ ] Event wiring editor — visually connect actors, events, and responses
- [ ] State editor — create/edit states.json entries with duration, effects, immunities
- [ ] Sound composer — simple tone sequencer for creating sound effects and music

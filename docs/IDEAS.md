# Bugs and ideas

Items marked [B] are Brogue-parity features, [Z] are ZZT-inspired, [b] are Bitsy-inspired.

## Bugs

- in the prototype editor, I can turn on the toggles for settings like fog of war and darkness, implying an override of the prototype-level default. But if I deactivate those toggles, that is still an override. There's no way to disable the override altogether, resulting in potentially redundant json (low priority). These types of settings might best be grouped under a activate deactivate toggle that returns us to prototype defaults.

---

### Tweaks

- stairways should be spawning along room walls like braziers rather than in the middle of rooms/hallways. Ideally there would be braziers on either side of them too
- item attribute for an item's integrity/condition (maybe there is a better word- how many uses until it breaks). This is needed for mattocks. Could we reuse work from torch fuel stat for item condition and have the amount an item degrades per use be specified in a json attribute?
- mattocks should have a random chance of successful digging rather than the three-strikes dig they have now, this should also be a json attribute that designers could use in other items if they wanted.
- It doesn't seem like good design to have duration hard coded into states. Confusion from a potion might last longer than confusion from an enemy attack or trap.

## Feature ideas

### corner blocking as an actor attribute

- the brogue style corner movement blocking rule is pretty complex and opinionated for it to be hard coded into the engine, and it would be complex to have it be a prototype-level mechanics toggle. What makes the most sense is to move diagonal movement blocking to an actor attribute that some wall actors have, then it can be used on a per actor basis, or even added as a monster attribute.
- Currently attacks are legal diagonally across corner blocking actors like walls. I'd like to block melee attacks but not staffs or wands around wall corners.
- likewise, the complex engine code that currently closes a door behind you when it was initially unlocked and leaves it open when it was initially locked is an opinionated design that shouldn't have been hard coded. Instead there should have been an attribute that door and locked door actors could have used that determined whether the player closes it as they pass through (swings_shut). Don't hard code design opinions that can be left up to designers with attributes in the data files, as long as the data files don't have so many attributes that they become difficult to read. Having sensible default values for attributes so that more often than not we don't have to specify them helps keep data files readable.

### Make 'infrastructure sight' part of the magic mapping scroll effect

- instead of a separate potion/gas effect, what was called infrastructure sight becomes part of the magic mapping scroll effect, this is a lasting visual reveal of an individual level which should persist when leaving and returning to that level. Remove infrastructure sight from potion and gas effects after adding it to the magic mapping reveal.

### Actor info

- clicking on an actor could show an info window instead of pathing to them with click to walk. This should show the monster name and description, later we can build out more procedural info like brogue.
- In addition to clicking we should have a keyboard-only way to select actors and items and getting info (tab to cycle through objects of interest works now- we add mode-aware action button (enter) to view info, or select when throwing/zapping)
- because the canvas viewport is prototype definable, could this be too much text for the canvas? we might need to implement paging in ui windows for overflow (paging is more desirable than scrolling)
- if possible, clicking an actor or item name in the sidebar could highlight its tiles in the canvas and bring up the info canvas textbox

### Keybinding changes

- movement keys should also be defined in keybindings.json along with actions so we can reclaim wasd for actions if needed. it would probbaly be very easy to make a keybindings-editor.html too, preparing for the time when this all becomes a webapp

### Dialogue

- A dialogue/options window
    This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.
- [ ] Dialogue trees — branching conversations with NPC actors, driven by JSON scripts like ink json exports.
- [ ] Dialogue conditions — branches gated by inventory, variables, or prior choices
- [ ] Dialogue effects — conversation choices that give/take items, set variables, trigger events
- [ ] NPC interaction on bump — non-hostile actors open dialogue instead of attacking
- [ ] Ending triggers — dialogue or events that trigger win/loss conditions
- [ ] Multi-page dialogue — pagination for longer conversations

### Variables & Game State [b][Z]

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

- [x] Auto-explore — pathfind through safe explored areas, stop on encounter [B]
- [ ] Searching action to discover traps and eventually hidden doors
- [x] Aquatic creatures — actors restricted to water tiles, can't be pushed onto land
- [ ] Burrowing creatures — can move through wall tiles, leave tunnels behind
- [x] Splitting creatures — on death, spawn smaller versions (slimes, oozes) [B]
- [x] Invisible creatures — only visible via telepathy or adjacency (visible: false exists, but needs telepathy build-out) [B]
- [ ] Creature mutations — random bonus traits applied at spawn (agile, poisonous, fire-immune) [B]

### Ally System

- [ ] Ally recruitment — wand of domination or freeing imprisoned creatures [B]
- [x] Faction system — actors with faction tags, hostility determined by faction relationships

### Combat

- [x] Backstab — attacking unaware/sleeping enemies for bonus damage [B] (3x vs. sleeping/stunned/paralyzed or unalerted AI; engine.js `BACKSTAB_MULTIPLIER`)
- [ ] Weapon runic enchantments — special procs beyond the existing weapon_proc system (vampiric, slowing, quietus, paralysis) [B]
- [ ] Armor runic enchantments — defensive procs (reflection, reprisal, immunity, absorption) [B]
- [ ] Grappling — creature seizes target, preventing movement until broken free (started working on this for quicksand and an early version of jelllies, test quicksand) [B]

### Items

- [ ] Charms — new item category: single charge, periodic recharge, area/self effects [B]
- [ ] Item polarity — items classified as positive/negative, revealed before full ID [B]
- [ ] Wand of domination — tame a wounded enemy [B]
- [ ] Wand of plenty — clone a creature [B]
- [ ] Containers — chests, bags that hold multiple items

### Terrain & Environment

- [ ] Sunlight tiles — upper-level areas with natural light [B]
- [ ] Steam vents - periodic scalding clouds [B]

### Dungeon Generation

- [ ] Biome/theme system — per-floor visual and mechanical themes (crypt, sewer, infernal already exists)
- [ ] Secret doors/rooms — would require searching action, could also use pushable walls
- [ ] Outdoor generation — open areas with scattered terrain features

### Lighting & Vision

- [ ] Stealth range — detection radius affected by light level, armor, rings [B]
- [ ] Light-sensitive creatures — enemies that avoid lit areas or are weakened by light

### Map & World Structure

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

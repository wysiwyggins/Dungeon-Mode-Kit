
## Bugs

- adding an eel to the sewage in the test prototype revealed that we don't get the hidden actor name from a submerged actor as we would an invisible one, and it would be nice if a submerged actor's name and tiles were only revealed when the player is submerged too. Currently the name is never hidden, the tiles are always hidden.

## Tweaks

- item names and descriptions should be able to use template variables like [color] too, not just unidentified_description. How does the lever actor get color words in its name when paired? I would have expected to see that in the actor data, not just hardcoded, this would show a reusable precedent for templated strings in data.
- should the "map generator" section in prototype defaults be a biomes/single generator/authored map radio button selection? We can eliminate some of this with the single level/multi level toggle. A single level is either a single generator or an authored map, hiding biome stuff. A multi level is either a single generator or biomes with level overrides for authored maps. the current "No procedural generator — the map comes from a hand-authored .tmj. Placed features below still apply." message when a single generator default isn't enabled is misleading, and when the section is disabled we don't expect to be able to set placed features, despite the message saying otherwise.
- in prototype-editor we should be able to turn off biomes on a multi-level prototype and just use defaults- change 'floor plan' section name to 'biome plan' or something, add a top toggle to disable it to use defaults only

---

## Feature ideas

## other actors need to be able to use stairs

- a monster should be able to chase a player actor from one level to another. How does brogue handle this?

## remaning 'types' refactor work

- ~~Earlier I added '[types](TYPES.md)' to actors, this pattern should be extended to items.~~ Done — 8 item types, `domain` now enforced.
- ~~Items already have a 'backwards' version of this: 8 hollow meta-entries hold `random_type` lists pointing *down* at their members.~~ Done — the metas are gone and pools derive from membership. `random_type` survives as a curated-pool override.
- `Entity.type` still holds the entity *id* (`actor.type === 'goblin'`). Renaming the id field to `Entity.id` would free the word — ~66 call sites (engine.js, behaviors.js, interface.js, arena.html; architect.js is exempt, its `.type` hits are wall/region records). No save-compat burden: saves are in-memory only. Deferred — `Item` never stores `this.data`, so the collision is notional, and `serialize`/`deserialize` have to move atomically or floor transitions drop entities.
- Types don't inherit from types (single hop, like `$alias`). Probably fine; revisit if a `dire_beast` wants to extend `beast`.
- Three sites read `.id` on actors, which is always `undefined`: `engine.js:9417` stores it as a trail's `ownerId`, `engine.js:9432` compares `undefined === undefined` (so any actor backtrack-removes any other's trail), and `behaviors.js:315` finds the first living actor instead of the owner. Real bug, unrelated to types; needs a genuine owner reference, not the type id.

### Patrol behavior

- this would be different from the exporing that the hero personality does, it would visit areas in a loop. Simplest version of this possible.

### Machines.json

- As aspects of a data file become more complex, we move them to their own data file to make them modular and reusable and to keep editors focused and simple. Just as biomes got moved out of prototypes to their own data file, trasure rooms would get data files and an editor, and would probably be renamed to something broader, possibly machines.json like Brogue's naming convention. They would encompass parametric designs for various locked areas and unlocking interactions.

### Effects editor

- there's a stub for an effects editor but it isn't good. This is something I should probably find help for. Currently it doesn't show an effect as it would actually appear in the game and there are lots of other issues. This is a pixijs related task. Maybe it should load an actual prototype, like a 3x3 tile map/viewport and a single actor for the preview.

### More digging

- if the mattock could also be used to dig the floor instead of just the walls, we could dig up graves etc. I'm making a "SHALLOW_GRAVE" tile for a dug-up floor tile. On specific entities (a grave marker) this could have a chance of producing loot that it wouldn't on a regular floor tile.

### corner blocking as an actor attribute

- the brogue style corner movement blocking rule is pretty complex and opinionated for it to be hard coded into the engine, and it would be complex to have it be a prototype-level mechanics toggle. What makes the most sense is to move diagonal movement blocking to an actor attribute that some wall actors have, then it can be used on a per actor basis, or even added as a monster attribute.
- Currently attacks are legal diagonally across corner blocking actors like walls. I'd like to block melee attacks but not staffs or wands around wall corners.
- Don't hard code design opinions that can be left up to designers with attributes in the data files, as long as the data files don't have so many attributes that they become difficult to read. Having sensible default values for attributes so that more often than not we don't have to specify them helps keep data files readable.

### Actor info

- clicking on an actor could show an info window instead of pathing to them with click to walk. This should show the monster name and description, later we can build out more procedural info like brogue.
- In addition to clicking we should have a keyboard-only way to select actors and items and getting info (tab to cycle through objects of interest works now- we add mode-aware action button (enter) to view info, or select when throwing/zapping)
- because the canvas viewport is prototype definable, could this be too much text for the canvas? we might need to implement paging in ui windows for overflow (paging is more desirable than scrolling)
- if possible, clicking an actor or item name in the sidebar could highlight its tiles in the canvas and bring up the info canvas textbox

### Looping sound

- spooky looping wind when you're standing next to an abyss and a message (would add both looping sound and adjacent proximity messages)

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

### Rethinking and refactoring items and behaviors

- a research task to think about behaviors and item verbs. Right now behaviors are pretty specific js methods that can be combined into personality data for acrots. Each behavior function is a "thing that an actor can do." This could use an audit to find patterns that could be turned into reusable utility functions. Also some of these behaviors are specific to individual items in a way that feels muddy. I need to think this through. We always want scripts to be multi purpose, modular and reusable in a way that we can make specific cases in data, using them in different ways, allowing for flexability in new designs.

### Items

- [ ] Charms — new item category: single charge, periodic recharge, area/self effects [B]
- [ ] Item polarity — items classified as positive/negative, revealed before full ID [B]
- [ ] Wand of domination — tame a wounded enemy [B]
- [ ] Wand of plenty — clone a creature [B]
- [ ] Containers — chests, bags that hold multiple items

### Dungeon Generation

- [ ] Secret doors, requires search feature. right now there are just pushable walls which are already slightly visually distinct from walls. secret door would have wall tiles until discovered then door tiles. Or is it actually one actor becoming another?

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

### mysteries

- when the player walks onto a water tile, which has render top, the water correctly renders over the player, but a non controllable actor like a skeleton is still rendering over the water when it walks onto it. (render top is how we make it appear like water covers the base tile of another actor). Investigated and couldn't figure it out. deferring.

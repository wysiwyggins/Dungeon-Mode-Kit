
## Bugs

- Why would there be a performance hit when wearing the crown in the test prototype? wearing a normal helmet doesn't do this so it must have to do with the conditional check for keeping the down stairway open.
- ~~In the dungeon generator, adding secret doors led to some occasional weird door placement— such as a secret door that connects to the corner of a rectangular room, which does not grant entry due to the rule that prevents diagonal movement next to a solid wall. I also found a secret door next to a regular door on a wall between two rooms.~~ Fixed. Both symptoms came from the same omission in two separate passes: neither checked that the door had open floor on the *far* side. The dead-end pass scanned 2-3 tiles past the wall and punched the door at distance 1, so any wall run thicker than one tile got a door with rock behind it; the interior-wall pass tested the floor map, which `_finalizeMap` paints under walls and under the ungenerated cells at the map edge alike, so it cut doors into wall runs and into the void. Measured across 560 maps: 151 unusable and 290 door-adjacent, now 0 and 0. Costs about a third of the raw supply, and connectivity is untouched — `EnsureConnected` runs first, so a secret door is always a bonus route, never sole access.
- when we pick a prototype in an editor it should narrow the options in the next dropdown down to the ones in that prototype since there are so many in default /data/

## Tweaks

- we have both 'opened' tile variants for doors and gates and 'toggled' for levers. They could both just be 'toggled' unless there is something that can be both open and toggled (there isn't)
- **Effects defined but never used:** `white_flash`, `heavy_hit`, and `victory_wave` (parked deliberately). The primitives `hue_cycle` and `alpha_pulse` are referenced by nothing at all. Either wire them up or drop them.
- **`effect` means three different things** — the visual effect id on actors/items, the stat-change object in `collision_effect`/`use_effect`, and the `on_apply_effect`/`per_turn_effect` state deltas. Worth disambiguating one day; renaming touches a lot, though.
- **`flicker_tint` (the effect) vs `tint_flicker` (the primitive)** — the words are reversed between the two layers, which is genuinely confusing when reading `effects.json`. Renaming either breaks data or code, so left alone for now.
- Tiled.app tile layers have a tint color property, it would be cool if we could use it for picking floor tile tints in Tiled too. Currently we do this in the prototype editor.
- ~~If an actor's attack induces a state we should probably add that to its info window. (The bat's attack induces the bleeding state for a test case)~~ Done — six actors carry an `apply_state` in their `collision_effect`, not just the bat, and the panel now names it (*"Its attack can leave you bleeding."*). Ungated by `tactician`, since it's a qualitative warning like the traits beside it. `Actor.predictAppliedState` mirrors the three refusals in `applyState`, so a `bloodless` player is told nothing about a bat's bite — it genuinely can't make them bleed.

---

## Feature ideas

## Incense item

- incense, lights like a torch, generates mist that repels/harms undead actors. can be lit and dropped in an area to keep a room clear of undead for a while. Should be a reusable pattern where we can specify an actor type that is harmed or repelled. For the actor use a capitol I base tile and a cloud animated top tile

## Specifying enclosed items in Tiled

- It's not clear to a designer how, in the "test" prototype, the key to the locked door was placed on the pedestal, it isn't specified either in the pedestal object in Tiled or in the prototype. Designers working on an authored map should be able to specify an item in the default_items property of an actor object in order to give that object to the actor (such as a pedestal, grave). This currently works for actors like monsters with inventory, we just need to use inventory in the object holding of container actors.

## Actor selectors in biome editor

- Add the ability to pick which actor is used as main walls
- add the ability to define blob areas of actors other than just lava, sewage, or water

## Sound player page

- page in /editors/ that let's me listen to everything in the howler soundfont as individual named sounds
- maybe one day it will let me load a sound and automate rebuilding the audio sprite

## Bolt bounce logic for actors like metal walls

- would probably add a new attribute like "reflective"

## ~~other actors need to be able to use stairs~~

- ~~a monster should be able to chase a player actor from one level to another.~~ Done — a hostile actor adjacent to a player actor and aware of it when the player takes a stairway is carried to the destination floor and arrives beside them, still hunting. No opt-in attribute: the adjacency *is* the evidence of pursuit. Capped at 2 followers, so arriving beside a whole pack with no room to retreat can't happen. Multi-floor prototypes only (`floors`/`levels`); the legacy cross-prototype stairway path is deferred, since the target prototype may not even define the follower's actor type. Segmented creatures (the scutigera) are excluded — their parts are joined by live object references that can't cross a floor.

## remaning 'types' refactor work

- ~~Earlier I added '[types](TYPES.md)' to actors, this pattern should be extended to items.~~ Done — 8 item types, `domain` now enforced.
- ~~Items already have a 'backwards' version of this: 8 hollow meta-entries hold `random_type` lists pointing *down* at their members.~~ Done — the metas are gone and pools derive from membership. `random_type` survives as a curated-pool override.
- `Entity.type` still holds the entity *id* (`actor.type === 'goblin'`). Renaming the id field to `Entity.id` would free the word — ~66 call sites (engine.js, behaviors.js, interface.js, arena.html; architect.js is exempt, its `.type` hits are wall/region records). No save-compat burden: saves are in-memory only. Deferred — `Item` never stores `this.data`, so the collision is notional, and `serialize`/`deserialize` have to move atomically or floor transitions drop entities.
- Types don't inherit from types (single hop, like `$alias`). Probably fine; revisit if a `dire_beast` wants to extend `beast`.
- ~~Three sites read `.id` on actors, which is always `undefined`~~ Done — `_trailData` now holds `owner`, a direct actor reference, instead of an `ownerId` that was always `undefined`. `Entity` has no id field, so the backtrack guard compared `undefined === undefined` (any actor could rewind any trail) and `follow_thread`'s owner lookup matched the first living actor in spawn order. A reference is safe here because `_trailData` is never serialized. The wider `Entity.type`-holds-the-id rename above is still deferred.
- item-editor still has new item from template rather than type selection

### Patrol behavior

- this would be different from the exporing that the hero personality does, it would visit areas in a loop. Simplest version of this possible.

### Machines.json

- As aspects of a data file become more complex, we move them to their own data file to make them modular and reusable and to keep editors focused and simple. Just as biomes got moved out of prototypes to their own data file, trasure rooms would get data files and an editor, and would probably be renamed to something broader, possibly machines.json like Brogue's naming convention. They would encompass parametric designs for various locked areas and unlocking interactions.

### Effects editor

- there's a stub for an effects editor but it isn't good. This is something I should probably find help for. Currently it doesn't show an effect as it would actually appear in the game and there are lots of other issues. This is a pixijs related task. Maybe it should load an actual prototype, like a 3x3 tile map/viewport and a single actor for the preview.

### More digging

- ~~if the mattock could also be used to dig the floor instead of just the walls, we could dig up graves etc.~~ **Done** as the `grave` actor: a walkable `breakable` dug with the mattock's `Dig` inventory verb (a 1-tile picker), leaving the existing `hole` entity behind and rolling a weighted `drops` table for a skull or treasure. The verb is generic over any non-solid `breakable`, so a cairn or a compost heap needs data only.

### corner blocking as an actor attribute

- the brogue-style corner movement blocking rule is pretty complex and opinionated for it to be hard coded into the engine, and it would be complex to have it be a prototype-level mechanics toggle. What makes the most sense is to move diagonal movement blocking to an actor attribute that some wall actors have, then it can be used on a per actor basis, or even added as a monster attribute.
- Currently attacks are legal diagonally across corner blocking actors like walls. I'd like to block melee attacks but not staffs or wands around wall corners.
- Don't hard code design opinions that can be left up to designers with attributes in the data files, as long as the data files don't have so many attributes that they become difficult to read. Having sensible default values for attributes so that more often than not we don't have to specify them helps keep data files readable.

### Actor info

- ~~clicking on an actor could show an info window instead of pathing to them with click to walk. This should show the monster name and description, later we can build out more procedural info like brogue.~~ Done — clicking a visible actor opens the panel; travel to its tile is still reachable via Tab + (x)plore. Went further than name+description: traits come from `data/attribute-info.json` and a Brogue-style two-sided combat forecast is gated behind `tactician`.
- ~~In addition to clicking we should have a keyboard-only way to select actors and items and getting info (tab to cycle through objects of interest works now- we add mode-aware action button (enter) to view info, or select when throwing/zapping)~~ Done — Tab + Enter opens the panel for anything with `hasInfoPanel()`, actors and floor items alike; frontier picks still travel, and the aiming modes still intercept Enter first.
- ~~Item info panels~~ Done — modelled on Brogue's `itemDetails` (Items.c:1750), but most of that function's 850 lines are hardcoded per-kind prose we already hold in JSON. What was worth porting: the comparative equip forecast ("wearing this would change your defense from 4 to 6"), which names the displaced item, and the unidentified-item honesty. `Item.getPanelDescription` is the single identification gate; `previewEquipDelta` zeroes enchantment when unidentified, so the forecast can't be subtracted to reveal it. One shell (`openInfoPanel`) serves actors and items, and the inventory action menu renders the same body plus its verbs.
- because the canvas viewport is prototype definable, could this be too much text for the canvas? we might need to implement paging in ui windows for overflow (paging is more desirable than scrolling). Measured: the tallest realistic item panel is ~21 rows against a 34-row shortest viewport, so not urgent — but a prototype with a shorter viewport would hit it.
- if possible, clicking an actor or item name in the sidebar could highlight its tiles in the canvas and bring up the info canvas textbox

### Looping sound

- spooky looping wind when you're standing next to an abyss and a message (would add both looping sound and adjacent proximity messages)

### Dialogue

- A dialogue/options window
    This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.
    Presentation is already in place: `growBoxOpen` opens a box out of the speaker's tile, and `showTextBox`'s `growFrom` option wires it up — personality taunts and death lines use it now, so a dialogue window growing from the NPC is the same call. Numbered options can follow `showItemActionMenu`'s pattern (`_actionStartLine`/`_actionCount` on the container for click hit-testing).
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


## Bugs

- we shouldn't see sewer gas spawning in "remembered" areas outside of FOV

## Tweaks

- when we pick a prototype in an editor it should narrow the options in the next dropdown down to the ones in that prototype since there are so many in default /data/ (should it? prototypes also load default data. Maybe the answer is to have less default actors etc and rely more on types as defaults and specifics in prototypes)
- **`flicker_tint` (the effect) vs `tint_flicker` (the primitive)** — the words are reversed between the two layers, which is genuinely confusing when reading `effects.json`. Renaming either breaks data or code, so left alone for now.
- Tiled.app tile layers have a tint color property, it would be cool if we could use it for picking floor tile tints in Tiled too. Currently we do this in the prototype editor.

---

## Feature ideas

## `effect` means three different things

— the visual effect id on actors/items, the stat-change object in `collision_effect`/`use_effect`, and the `on_apply_effect`/. There's also both an effects.js where effect methods live and effects.json data files that define named effects using those methods. It would be a non-trivial refactor but it might be desirable to disambiguate a little.

## Incense item

- ~~incense, lights like a torch, generates mist that repels/harms undead actors. can be lit and dropped in an area to keep a room clear of undead for a while. Should be a reusable pattern where we can specify an actor type that is harmed or repelled.~~ — done, `incense` item + `ward` gas attribute (see [Items](ITEMS.md#emitting-gas-incense), [Actors](ACTORS.md#ward-gas))

## Teleporter actor

- step onto it and be teleported to another teleporter paired by machine id

## Bolt bounce logic for actors like metal walls

- would probably add a new attribute like "reflective"

### Patrol behavior

- this would be different from the exporing that the hero personality does, it would visit areas in a loop. Simplest version of this possible.

### Machines.json

- As aspects of a data file become more complex, we move them to their own data file to make them modular and reusable and to keep editors focused and simple. Just as biomes got moved out of prototypes to their own data file, trasure rooms would get data files and an editor, and would probably be renamed to something broader, possibly machines.json like Brogue's naming convention. They would encompass parametric designs for various locked areas and unlocking interactions.

### Effects editor

- there's a stub for an effects editor but it isn't good. This is something I should probably find help for. Currently it doesn't show an effect as it would actually appear in the game and there are lots of other issues. This is a pixijs related task. Maybe it should load an actual prototype, like a 3x3 tile map/viewport and a single actor for the preview.

### corner blocking as an actor attribute

- the brogue-style corner movement blocking rule is pretty complex and opinionated for it to be hard coded into the engine, and it would be complex to have it be a prototype-level mechanics toggle. What makes the most sense is to move diagonal movement blocking to an actor attribute that some wall actors have, then it can be used on a per actor basis, or even added as a monster attribute.
- Currently attacks are legal diagonally across corner blocking actors like walls. I'd like to block melee attacks but not staffs or wands around wall corners.
- Don't hard code design opinions that can be left up to designers with attributes in the data files, as long as the data files don't have so many attributes that they become difficult to read. Having sensible default values for attributes so that more often than not we don't have to specify them helps keep data files readable.

### Actor info

- if possible, clicking an actor or item name in the sidebar could highlight its tiles in the canvas and bring up the info canvas textbox

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

- [ ] Burrowing creatures — can move through wall tiles, leave tunnels behind
- [ ] Creature mutations — random bonus traits applied at spawn (agile, poisonous, fire-immune) [B]

### Ally System

- [ ] Ally recruitment — wand of domination or freeing imprisoned creatures [B]
- [x] Faction system — actors with faction tags, hostility determined by faction relationships

### Combat

- [ ] Weapon runic enchantments- these should actually be handled by item type and stat/state effects, doable now.
- [ ] Armor runic enchantments — defensive procs (reflection, reprisal, immunity, absorption) [B]
- [ ] Grappling — creature seizes target, preventing movement until broken free (started working on this for quicksand and an early version of jelllies, test quicksand) [B]

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
- [ ] Hub areas — safe zones between dungeon levels for shops, NPCs, storage (runes of protection could use the existing evil eye tile) (could be accomplished with something like the incense item idea, an item or actor that has a range that some actors avoid)

### Progression

- [ ] Achievements — tracked accomplishments across runs, would need to be prototype-definable, not hard-coded
- [ ] Compendium of discoveries — a list of all the things discovered in a prototype across mutliple play sessions, defer till hosted version & storage
- [ ] Score system — point tracking based on depth, kills, items, gold [B] also maybe defer till hosted version and storage
- [ ] Recording/replay — deterministic action log for replaying completed runs [B] defer till hosted version

### Sound & Music

- Need a breaking metal implement sound
- need an additional death sound
- Add more tones to sound sprite with specified notes for use in simple music tracker for levels. Bitsy is so good at this. Build the sound editor page for the first step of this.
- [ ] Background music — looping tracks per prototype or per floor
- [ ] Music notation — simple tracker for composing level music by pitch shifting sounds in the sound sprite
- [ ] loops- example, a spooky looping wind when you're standing next to an abyss (would add both looping sound and adjacent proximity messages). Could be an actor attribute(s) with the sound and its range in tiles.

### More editor development

- future- the kit is hosted online in a way that users could create prototypes with web forms and test them, like bitsy. see [Hosting Roadmap](HOSTING_ROADMAP.md)

### deferred mysteries

- when the player walks onto a water tile, which has render top, the water correctly renders over the player, but a non controllable actor like a skeleton is still rendering over the water when it walks onto it. (render top is how we make it appear like water covers the base tile of another actor). Investigated and couldn't figure it out. deferring.
- Why would there be a performance hit when wearing the crown in the test prototype? wearing a normal helmet doesn't do this so it must have to do with the conditional check for keeping the down stairway open. *Explored this for a while and couldn't figure it out, so deferred for now*

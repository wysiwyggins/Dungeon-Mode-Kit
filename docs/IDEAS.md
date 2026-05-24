# Bugs and ideas

Items marked [B] are Brogue-parity features, [Z] are ZZT-inspired, [b] are Bitsy-inspired.

---

## Dialogue & Narrative [b]

- A dialogue/options window
    This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.
- [ ] Dialogue trees — branching conversations with NPC actors, driven by JSON scripts
- [ ] Dialogue conditions — branches gated by inventory, variables, or prior choices
- [ ] Dialogue effects — conversation choices that give/take items, set variables, trigger events
- [ ] NPC interaction on bump — non-hostile actors open dialogue instead of attacking
- [ ] Ending triggers — dialogue or events that trigger win/loss conditions
- [ ] Text effects — typewriter, shake, color markup in dialogue display
- [ ] Multi-page dialogue — pagination for longer conversations

## Variables & Game State [b][Z]

- Arbitrary variables like bools could be added to prototypes that could be changed by events like actor attributes currently are. This would be a tool for designers to add persistent states across levels that can be changed by the player.
- [ ] Prototype variables — persistent key-value state across floors (booleans, numbers, strings)
- [ ] Variable modification — actors/items/dialogue set variables on interaction or death
- [ ] Conditional exits — stairways/portals gated by variable state, variable state could be a win condition
- [ ] Conditional spawning — actors/items appear only when variable conditions are met
- [ ] Global counters — score, collectible counts, tracked in prototype state
- [ ] Time limits — turn countdown per floor or per prototype [Z]

## Scripted Behaviors [Z][b]

- Scripted npc actor actions- a script of turn-by-turn actions that gets executed by an actor and then it returns to other behaviors, expand existing behavior editor page
- [ ] Action sequences — personalities execute a fixed series of actions (move, wait, speak, spawn)
- [ ] State machines — personalities with named states and transition conditions
- [ ] Patrol paths — actors follow a defined waypoint route instead of random patrol, might require a path drawing tool other than Tiled
- [ ] Triggered behaviors — personality switches when a variable or event condition is met
- [ ] Conditional behavior list — behaviors that only execute when a variable/state check passes

## Event System [Z]

- [ ] Event broadcasting — actors emit named events (e.g. "lever_pulled", "boss_killed") this could suppliment or replace win_conditions and machine_id
- [ ] Event listeners — actors respond to events with attribute changes, spawns, or removal
- [ ] Touch events — trigger effects when actors become adjacent (not just collide) [Z]
- [ ] Chain reactions — events trigger other events (button → trap → door → spawn)
- [ ] Actor messaging — actors send commands to specific other actors by machine_id [Z]

## Actors & Creatures

- [ ] Aquatic creatures — actors restricted to water tiles, can't be pushed onto land
- [ ] Burrowing creatures — can move through wall tiles, leave tunnels behind
- [ ] Splitting creatures — on death, spawn smaller versions (slimes, oozes) [B]
- [ ] Invisible creatures — only visible via telepathy or adjacency (visible: false exists, but needs telepathy build-out) [B]
- [ ] Creature mutations — random bonus traits applied at spawn (agile, poisonous, fire-immune) [B]
- [ ] Totems/turrets — immobile actors like the Dart Turret that project area effects (healing, buffing, debuffing) [B]
- [ ] Mimics — actors disguised as items or terrain until disturbed

## Ally System

- [ ] Ally recruitment — wand of domination or freeing imprisoned creatures [B]
- [ ] Ally commands — follow, wait, attack target, guard area
- [ ] Ally empowerment — spend charges to permanently increase ally stats [B]
- [ ] Ally trait learning — allies absorb abilities from defeated enemies [B]
- [ ] Faction system — actors with faction tags, hostility determined by faction relationships

## Combat

- [ ] Stealth system — detection range based on light level, armor weight, movement [B]
- [ ] Backstab — attacking unaware/sleeping enemies for bonus damage [B]
- [ ] Shields — off-hand equipment that adds block chance
- [ ] Damage types — physical, fire, poison, lightning with per-type resistances
- [ ] Weapon runic enchantments — special procs beyond the existing weapon_proc system (vampiric, slowing, quietus, paralysis) [B]
- [ ] Armor runic enchantments — defensive procs (reflection, reprisal, immunity, absorption) [B]
- [ ] Grappling — creature seizes target, preventing movement until broken free [B]
- [ ] Riposte — chance to counter-attack on a successful dodge

## Items

- [ ] Charms — new item category: single charge, periodic recharge, area/self effects [B]
- [ ] Cursed items — negative enchantment, can't unequip until remove_curse [B]
- [ ] Item polarity — items classified as positive/negative, revealed before full ID [B]
- [ ] Throwing weapons — darts, javelins, incendiary darts as dedicated ranged items [B]
- [ ] Wand of domination — tame a wounded enemy [B]
- [ ] Wand of empowerment — buff an ally [B]
- [ ] Wand of plenty — clone a creature [B]
- [ ] Potion of detect magic — reveal item enchantment levels [B]
- [ ] Potion of creeping death — spawn deadly fungus [B]
- [ ] Scroll of darkness — extinguish light sources in an area [B]
- [ ] Containers — chests, bags that hold multiple items
- [ ] Item durability — equipment degrades with use, repairable
- [ ] Potion throwing — thrown potions apply their effect as an area splash [B]

## Terrain & Environment

- [ ] Chasms — impassable gaps, crossable only with flight or bridges [B]
- [ ] Shallow water — slows movement but doesn't drown, extinguishes fire [B]
- [ ] Mud/bog — slows movement, accumulates swamp gas over time [B]
- [ ] Tall grass — blocks line of sight, can be trampled flat, flammable [B]
- [ ] Crystal walls — conduct lightning, glow when electrified [B]
- [ ] Iron doors — heavier doors that require keys or special force to open [B]
- [ ] Breakable walls — walls with a durability stat, destructible by attacks or mining [Z]
- [ ] Conveyor belts — tiles that push actors/items in a direction each turn [Z]
- [ ] Ice — slippery tiles, actors slide until hitting an obstacle [Z]
- [ ] Forest — dense terrain that blocks movement but can be cleared
- [ ] Cobwebs — slow movement, flammable, spiders immune [B]
- [ ] Sunlight tiles — upper-level areas with natural light [B]
- [ ] Brimstone — hot ground near lava, damages non-fire-immune actors [B]

## Dungeon Generation

- [ ] Biome/theme system — per-floor visual and mechanical themes (crypt, sewer, forest, crystal caves)
- [ ] Secret rooms — hidden passages revealed by searching or breaking walls
- [ ] Shop rooms — merchant NPCs with buy/sell interaction
- [ ] Outdoor generation — open areas with scattered terrain features

## Lighting & Vision

- [ ] Stealth range — detection radius affected by light level, armor, rings [B]
- [ ] Colored light mixing — multiple colored light sources blend on tiles [B]
- [ ] Darkness progression — deeper floors have lower ambient light [B]
- [ ] Infrared/thermal vision — see warm-blooded creatures through walls
- [ ] Light-sensitive creatures — enemies that avoid lit areas or are weakened by light

## Map & World Structure

- [ ] Edge wrapping — movement off one map edge enters the opposite side [Z]
- [ ] Persistent floor state — items dropped on a floor remain when you return (partially exists)
- [ ] World map — non-linear prototype graph with branching paths
- [ ] Hub areas — safe zones between dungeon levels for shops, NPCs, storage (runes of protection could use the existing evil eye tile)
- [ ] Outdoor/overworld — large open maps with different generation rules than dungeons

## Progression

- [ ] Achievements — tracked accomplishments across runs
- [ ] Compendium of discoveries — a list of all the things discovered in a prototype across play sessions
- [ ] Challenges — pre-configured difficulty modifiers (no food, no armor, etc.) [B]
- [ ] Score system — point tracking based on depth, kills, items, gold [B]
- [ ] Auto-explore — pathfind through safe explored areas, stop on encounter [B]
- [ ] Recording/replay — deterministic action log for replaying completed runs [B]

## Sound & Music

- Add more tones to sound sprite with specified notes for use in simple music tracker for levels. Bitsy is so good at this
- [ ] Background music — looping tracks per prototype or per floor
- [ ] Music notation — simple tracker for composing level music from tone data
- [ ] Adaptive music — track changes based on combat/peaceful state
- [ ] Ambient sound — environmental audio loops (dripping, hauntings, crackling torches)
- [ ] Spatial audio — sound volume based on distance from source

## Editor Tools

- A web front end level creator would create a prototype that supplements and sometimes overrides the base data. It could even have an upload or pixel art tool for adding tiles to an overriding prototype version. You'd be able to experiment with combining tiles to make actors. A web map editor would replicate some tiled features but would also let you paint entities with color tints, currently tiled can only draw shapes with objects and attributes for entities which you can't see the tile or tint of.
- future- the kit is hosted online in a way that users could create prototypes with web forms and test them, like bitsy.
- Look to Bitsy and ZZT for feature inspiration as well as roguelikes, we want to be surprised by what designers make rather than be proscriptive
- [ ] Dialogue editor or ink — visual tool for authoring branching dialogue trees
- [ ] Prototype editor — configure prototype.json visually (mechanics, win conditions, floors)
- [ ] Variable editor — define and manage prototype variables
- [ ] Event wiring editor — visually connect actors, events, and responses 
- [ ] State editor — create/edit states.json entries with duration, effects, immunities
- [ ] Sound composer — simple tone sequencer for creating sound effects and music

---

## Bugs found during doc audit (2026-05-23)

- Broken sound references: `trap1` (interface.js:2504) and `match` (behaviors.js:671) call playSound but have no audio sprite entry. They fail silently. Need source audio files added to the sprite.

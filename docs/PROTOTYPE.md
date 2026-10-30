# Prototypes

## About Prototypes

A prototype is a playable game or level built with Dungeon Mode Kit. Each prototype lives in its own folder under `prototypes/` and is mostly configured through a `prototype.json` file. The folder can also hold its own data files, which are merged with the global files in `data/` when the prototype loads. You only need to define what is new or different.

```
prototypes/
  my_level/
    prototype.json       (required)
    actors.json
    items.json
    personalities.json
    biomes.json
    animations.json
    *.png                (sprite sheets named in animations.json)
    map.tmj              (authored Tiled map for floor 1)
    2.tmj, 3.tmj, ...    (authored maps for later floors)
```

Load a prototype by adding `?prototype=my_level` to the URL.

When you add a new prototype folder, also add its name to `data/prototypes.json`. A static web server can't list a folder's contents, so the editors use that file to fill their prototype menus. The game itself doesn't need it, but a prototype missing from that list won't show up in the editors.

## Basic Fields

`name` is the display name, and `description` is the text shown when the level loads (use `\n` for line breaks). `turn_speed` is how many milliseconds each AI turn takes, so lower is faster. The default is 50. `loaded_sound` is a sound played when the prototype loads.

Other top level fields are covered in their own sections below.

## Mechanics

The `mechanics` object turns core systems on and off. Every field is optional.

```json
"mechanics": {
  "fog_of_war": true,
  "darkness": true,
  "ambient_light": 0.1,
  "tint": "#3355AA",
  "player_auto_light": false,
  "viewport_width": 40,
  "viewport_height": 40
}
```

### Lighting and Visibility

`fog_of_war` remembers explored tiles and hides unexplored ones. `darkness` turns on dynamic lighting; without it the whole map is lit. `ambient_light` is the minimum light level from 0 (pitch black away from light sources) to 1 (fully lit). `player_auto_light` makes the player glow on their own and is on by default; turn it off to make the player carry a torch or lantern. `player_light_radius` sets the size of that glow in tiles (default 6). `tint` is a hex color laid over the whole level.

See [LIGHTING.md](LIGHTING.md) for more.

### Viewport and Scrolling

`viewport_width` and `viewport_height` set how many tiles are visible. If the map is bigger than the viewport, the camera scrolls to follow the player. `ai_margin` is how many tiles past the edge of the screen AI actors keep taking turns (default 5). Actors further away skip their turns. This only matters when the map scrolls.

### Searching

These control the search action and hidden actors like secret doors, concealed levers and traps.

`search_radius` is how far a full five turn search reaches (default 5). Everything hidden within that distance and in sight is found, so a finished search reliably means the area is clear.

`thorough_search_strength` sets the odds of that search (default 200). The chance at each tile is the strength minus 10 per tile of distance, and a bit lower for solid things like a door set in a wall. At the default, everything inside the radius is found. Lower it to make searching a dice roll the player may want to repeat.

`passive_search_strength` is the free glance the player gets the first time they stand on a tile (default 30). It reaches about two tiles, and the Ring of Awareness widens it. Set it to 0 to make the search action the only way to find secrets.

See [EPISTEMOLOGY.md](EPISTEMOLOGY.md) for how hidden things work.

### Other Mechanics

`observer_mode` turns off stairways, for prototypes with no player like the cellular automata demo.

`treasure_room` is the percent chance (0 to 100) that a floor gets a locked treasure room.

`connect_regions` applies to Tiled maps only and is on by default. After wildcard regions are filled in, it carves passages so no floor area is cut off from the rest. It only carves inside wildcard regions, so an area you walled off yourself stays sealed. `connect_door_chance` is the percent chance each carved passage gets a door where it joins existing floor (default 50). See [MAP.md](MAP.md#connecting-regions).

`up_stairway_region` and `down_stairway_region` place a stairway inside a named region (see [Named Regions](#named-regions)). Some generators pick one for you. The palladian generator puts the up stairway in its portico, for example. Set one yourself to override it, or set it to `null` for random placement.

## Map Generation

If a floor has no Tiled map, the engine generates one using the `map_generator` block. If a floor has both, the Tiled map wins.

```json
"map_generator": {
  "type": "digger",
  "options": {
    "map_width": 80,
    "map_height": 80,
    "roomWidth": [5, 12],
    "roomHeight": [4, 10],
    "corridorLength": [3, 8],
    "dugPercentage": 0.35
  }
}
```

### Generator Types

Some generators build walls and some only carve open floor. This matters more than it seems. Generators that build walls also place doors, torches and `wall_types`, and they mark rooms as named regions that stairways, treasure rooms and switch puzzles can attach to. Floor only generators give you none of that.

These generators build walls: `dungeon` (the main generator, with varied room shapes, corridors, loops, secret doors and lakes), `palladian` (a symmetrical villa, good for boss floors), `infernal` (a cave with lava pools), `digger` (rooms and corridors, and the fallback if a type is unknown) and `cellular` (organic caves). Of these, `dungeon`, `palladian` and `digger` also mark rooms.

These only carve floor: `uniform` (evenly spaced rooms), `rogue` (classic grid of rooms), `arena` (an empty rectangle), `divided_maze`, `icey_maze` and `eller_maze`.

`brogue` is the old name for `dungeon`. It still works, but use `dungeon` for new prototypes.

### Common Options

`map_width` and `map_height` set the map size in tiles.

For `digger`, `uniform` and `rogue`, `roomWidth` and `roomHeight` are `[min, max]` size ranges. `digger` also takes `corridorLength` and `dugPercentage`, which is how much of the map to carve.

For `cellular`, `probability` is how much of the map starts as wall (default 0.5). Small changes make a big difference: on a 40 by 50 map, 0.35 leaves almost nothing filled in, while 0.55 fills more than half. Around 0.45 gives separate clumps with clearings between them. `iterations` is the number of smoothing passes (default 4). More passes give fewer, bigger blobs. `connected` joins isolated pockets so everything is reachable (default true). Turn it off for sealed areas the player has to dig or burn into.

`wall_types` is a weighted list of wall actors, like `[{ "type": "rock_wall", "weight": 95 }]`. Any actor of the `terrain` type works, including `tree` and `hedge` for woods instead of stone. Only the generators that build walls use it.

`pushableWallChance` is the percent chance an interior wall becomes a wall the player can push (default 2). `secretWallChance` is the percent chance it becomes a hidden door that has to be found by searching (default 0). Both only apply to walls of type `wall`. They scale with map size, so the same number gives about five times as many secrets on a 100 by 100 map as on a 50 by 50 one.

`lakes` and `abyss` add blobs of liquid or empty void. See the next section.

### Lakes and Abyss

`lakes` and `abyss` stamp organic blobs onto a generated map. They take the same options and differ only in what fills them.

```json
"lakes": {
  "count": [1, 3],
  "types": [
    { "type": "water",     "weight": 75 },
    { "type": "quicksand", "weight": 25 }
  ],
  "minSize": 15,
  "maxSize": 80
}
```

`count` is how many blobs to try per floor, as a number or a `[min, max]` range. `minSize` and `maxSize` set the size of each blob in tiles. `types` is what fills them. This can be any non-solid actor that paints a tile, not just water, sewage and lava. You can give weights as above, or just list ids and repeat one to make it more common: `["water", "sewage", "sewage"]`. An id that doesn't match an actor is skipped with a warning.

Items and monsters never spawn on dangerous liquids like lava, quicksand or deep water. That is controlled by the `hazard` attribute, so give it to any new liquid that does damage or is deep.

`abyss` is bottomless empty space rather than an actor. Bridges, causeways and collapsing floors all depend on it, so its `types` is always `["abyss"]`. See [BRIDGES.md](BRIDGES.md).

### Dungeon Options

The `dungeon` generator takes these extra options:

`maxRooms` and `maxAttempts` control how full the map gets. Leave them out and they scale with the map size automatically. `roomWeights` sets how often each room shape appears; the default is `{ "rectangle": 30, "cross": 25, "circular": 20, "cavern": 25 }`.

`corridorChance` (default 55) and `corridorLength` (default `[3, 9]`) control corridors between rooms. `doorChance` (default 50) is the chance of a door where rooms connect, and `torchChance` (default 30) is the chance of a torch in a room.

`loopMinDistance` (default 20) and `maxLoops` (default 5) add shortcuts between rooms that would otherwise be far apart.

`secretDoorChance` (default 35) is the percent of dead end shortcuts that become hidden doors instead of pushable walls. These are blind corridors with a room just past the wall, so they make good finds for a search. This is separate from `secretWallChance`, which converts ordinary walls.

### Palladian Options

The `palladian` generator is based on Stiny and Mitchell's 1978 "Palladian grammar," a formal description of Palladio's villa plans. It builds something that looks designed: a grid of rooms mirrored around a central axis, with some rooms merged into larger halls. One room on the axis can be a cross shaped hall called the sanctum, meant to hold a boss or a reward. Doors line up with each other and with the windows, so there is a long view straight through the villa along the axis.

`bayColumns` (default `[3, 7]`) and `bayRows` (default `[2, 4]`) set the size of the grid. The column count is always made odd so there is a center column. `bayWidth` (default `[4, 11]`) and `bayHeight` (default `[4, 9]`) set the size of each grid cell in tiles. `centralBias` (default 150) makes the center column wider than the others, as a percent.

`mergeChance` (default 45) is the chance that neighboring rooms merge. At 0 you get lots of small rooms; at 100, a few huge halls.

`sanctumChance` (default 70) is the chance of a sanctum. `sanctumShapes` (default `["cross", "tee", "eye"]`) lists the shapes it can take. `cross` keeps the sanctum small, while `eye` can take up most of the plan. Use `["cross"]` if you want a tight boss room.

`porticoStyle` (default `"prostyle"`) sets the entrance porch: `prostyle` sticks out from the building, `in_antis` is set into it, or use `random` or `none`. `porticoDepth` (default 3) is how deep the porch is. `columnSpacing` (default 2) is the gap between columns, or 0 for none.

`doorChance` (default 55) is the chance of a door in an interior doorway. Doorways on the main axis always stay open. `torchChance` (default 40) is the chance of a brazier in a room.

`wall_types` defaults to `brick_wall`. Because pushable and secret walls only come from walls of type `wall`, the villa gets its secrets another way. `secretPassageChance` (default 40) is the chance an interior door is hidden. Every room keeps at least one normal door, and mirrored doors are hidden in pairs so the symmetry doesn't give them away. `secretPassageLeverChance` (default 35) is the percent of those hidden doors that are also locked and opened by a hidden lever in one of the two rooms they join.

The villa uses existing actors for its parts: `column`, `fortification` for windows, `brick_wall`, `wall_torch` and `brazier`.

### Named Regions

Generators can mark areas of the map as named regions, and spawn settings can target them with `"region"`. This is how you put a boss in the room built for it:

```json
"levels": {
  "18": {
    "map_generator": {
      "type": "palladian",
      "options": { "bayColumns": [5, 5], "bayRows": [3, 3], "sanctumShapes": ["cross"] }
    },
    "win_conditions": ["killed:minotaur"],
    "random_actors": { "minotaur": { "chance": 100, "region": "sanctum" } },
    "random_items": { "amulet": { "chance": 100, "region": "sanctum" } }
  }
}
```

`largest_room` is the biggest room, from `dungeon`, `digger` or `palladian`. `treasure_room` is the inside of the treasure room, when one spawns. `sanctum` and `portico` come from `palladian`.

`random_actors`, `random_items`, `traps`, `fungus` and `item_budget` all accept `region`. For `random_actors` and `random_items` it goes on each entry. For the others it goes on the whole block:

```json
"traps":  { "min": 4, "max": 8, "region": "sanctum" },
"fungus": { "min": 2, "max": 5, "region": "largest_room" }
```

If a region doesn't exist on a floor, the engine warns and uses the whole map instead.

## Default Floor

`default_floor` sets the tile generators use for open floor, plus an optional color tint. Leave it out to use the engine's built-in floor tile.

```json
"default_floor": {
  "tile": "LIGHT_SHADE_QUADRANT_LOWER_LEFT_AND_UPPER_RIGHT",
  "tint": "#8899aa"
}
```

`tile` is a tile name from `data/static-tiles.json`. `tint` is a hex color. A biome or a single floor can set its own `default_floor`, and the most specific one wins. This only affects generated maps, since a Tiled map already names a tile for every cell. The tint works fine alongside darkness and fog of war.

## Void Tile

`void_tile` is the tile drawn wherever the map opens into empty space: abyss, collapsing floors and holes. The default is `OPAQUE_FULL_BLOCK`.

```json
"void_tile": "OPAQUE_FULL_BLOCK"
```

Both the default floor and void tile can be picked visually in the prototype editor's Default floor section.

## Spawning

### Random Actors and Items

`random_actors` and `random_items` scatter things around the map when a floor loads.

```json
"random_actors": {
  "skeleton": { "chance": 80, "min": 2, "max": 4 },
  "bat": { "chance": 50, "min": 1, "max": 2 }
},
"random_items": {
  "torch": { "chance": 60, "min": 1, "max": 2 },
  "potion": { "chance": 100 }
}
```

Each entry places a number between `min` and `max` (both default to 1). `chance` (default 100) is rolled separately for each of those, so at 100 they all appear and at 50 about half do. An actor with the `pack` attribute rolls once for the whole group, which spawns close together. Ids can come from the global data files or the prototype's own.

You can also use an item type like `potion`, `weapon` or `scroll` instead of a specific item id. This spawns a random item of that type. Any item with `"type": "potion"` is part of the potion pool automatically. See [TYPES.md](TYPES.md).

### Traps

`traps` hides trap pairs: a pressure plate and a vent, linked by `machine_id` and placed 2 to 5 tiles apart in the same room. The count is the number of pairs. Each vent is picked from every actor with the `vent` attribute, and `plate` names the trigger actor (default `trigger_plate`).

```json
"traps": { "min": 1, "max": 10, "plate": "trigger_plate" }
```

### Switch Puzzles

`switch_puzzles` places linked pairs of actors, like a lever that opens a gate.

```json
"switch_puzzles": {
  "min": 0, "max": 2,
  "patterns": [
    {
      "type": "gated_room",
      "weight": 1,
      "switch_actor": "gate_lever",
      "target_actor": "gate",
      "switch_effects": { "locked": false, "open": true },
      "switch_message": "You pull [name]. A gate grinds open."
    }
  ]
}
```

Each pattern names the actor used as the switch, the actor it controls, and the attributes to change on the target when the switch is used. `weight` sets how often a pattern is picked when there are several. In `switch_message`, `[name]` is replaced with the switch's name, including its color if it has one. See [Machines](ACTORS.md#machines).

### Item Catalog

`item_catalog` sets which item types appear in a prototype and how common each one is.

```json
"item_catalog": {
  "potion":  { "count": 10, "weight": 50 },
  "scroll":  { "count": 7,  "weight": 40 },
  "staff":   { "weight": 15 },
  "weapon":  { "weight": 10 },
  "armor":   { "weight": 8 }
}
```

`count` picks that many items of the type at random when a run starts, and only those appear for the rest of the run. If there are 16 potions and `count` is 10, the player will only ever find 10 kinds. Leave it out to use them all. `weight` is how common the type is when the item budget picks items. `pool` is an optional list of specific item ids to use instead of every item of that type.

When a catalog is set, using a type like `"potion"` in `random_items` draws from the catalog's picks. Using a specific id like `"health_potion"` always works.

Press `d` in game to see how many items of each type have been identified.

### Item Budget

`item_budget` spawns extra items on each floor, picked from the item catalog by weight. It does nothing without an `item_catalog`.

```json
"item_budget": {
  "base": 2,
  "extra_chance": 40,
  "max_extra": 3
}
```

Each floor gets `base` items (default 3), then rolls up to `max_extra` more (default 3), each with an `extra_chance` percent chance (default 50). It runs after `random_items`, so the two add together.

Spawn settings can be set once for the whole prototype or changed for a single floor.

## Win Conditions

`win_conditions` is a list of conditions that must all be met before the floor's down stairway unlocks. To lock a single door or chest the same way, give it `unlock_conditions` (see [ACTORS.md](ACTORS.md)).

```json
"win_conditions": ["killed:ghast", "wearing:crown"]
```

`killed:actor_id` is met when every actor of that kind is dead. `collected:item_id` is met when none of that item is left lying on the floor. It is not met if the item never spawned. `wearing:item_id` means the player has it equipped, and `holding:item_id` means it's in their inventory.

You can also compare a stat:

```json
{ "actor": "player", "stat": "health", "op": ">", "value": 50 }
```

`actor` is `"player"` or an actor id. `op` can be `>`, `>=`, `<`, `<=`, `==` or `!=`. Instead of `stat` you can use `treasure` with a treasure name, or a list of names to add together, like `["gold nugget", "thaler coin"]`.

`win_state` is different. It wins the whole game rather than unlocking a floor: `{ "via": "escape", "exit_floor": 1, "conditions": [...], "message": "..." }`. Reaching the exit on `exit_floor` with the conditions met ends the run in victory.

## Rank

`rank_order` gives a prototype chess-like capture rules instead of dice combat. It is a list of actor ids from weakest to strongest, based on the rules of Animal Chess (Dou Shou Qi).

```json
"rank_order": ["rat", "cat", "dog", "wolf", "leopard", "tiger", "lion", "elephant"]
```

An actor can capture anything of equal or lower rank, and an attack on a higher rank does nothing. The one exception is that the first actor in the list can capture the last, the way the rat takes the elephant. An actor can also have a numeric `rank` attribute, which takes priority over the list. This is useful for things like disguises or promotions.

Actors with no rank are left out of these rules, so a ranked prototype can still have ordinary monsters. Rank only controls damage. The AI doesn't know about it, so a ranked monster will keep attacking a piece it can't capture unless its behavior checks for that.

## Multiple Floors

Add a `levels` list to give a prototype more than one floor. Each entry configures one floor.

```json
{
  "name": "A Dungeon",
  "mechanics": { "fog_of_war": true, "darkness": true },
  "levels": [
    {
      "mechanics": { "ambient_light": 0.7, "tint": "#3355AA" },
      "map_generator": { "type": "digger", "options": { "map_width": 40, "map_height": 40 } },
      "random_actors": { "rat": { "chance": 100, "min": 2, "max": 3 } },
      "random_items": { "torch": { "chance": 60 } }
    },
    {
      "win_conditions": ["killed:ghast"],
      "random_actors": { "ghast": { "chance": 100, "min": 1, "max": 1 } }
    }
  ]
}
```

A floor can set `win_conditions`, `mechanics`, `map_generator`, `default_floor`, `random_actors`, `random_items`, `item_budget`, `traps`, `fungus` and `switch_puzzles`. Anything a floor leaves out comes from its biome if it has one, and otherwise from the top of `prototype.json`. `mechanics` settings are merged together, so a floor only needs the ones it changes. The other fields replace the default completely.

`levels` can also be written as an object keyed by floor number. This is handy with biomes, where only a few floors need hand authoring:

```json
"floors": 26,
"levels": { "6": { "win_conditions": ["killed:ghast"] }, "26": { "map": "throne.tmj" } }
```

The engine places a down stairway on every floor except the last. Each floor's stairway stays locked until its win conditions are met. When the player leaves a floor its state is saved, and it is restored when they come back.

Authored maps are named by floor: `map.tmj` for floor 1, then `2.tmj`, `3.tmj` and so on. Floors without a map file are generated.

## Biomes

Biomes let a long prototype get harder as the player goes deeper without authoring every floor. A biome is a themed set of monsters, items and hazards, each with a range of floors it can appear on. As the player descends, things fade in and out of the mix on their own. This is modeled on Brogue. See [BIOMES.md](BIOMES.md) for details.

`prototype.json` assigns biomes to floors with `floor_plan`, and uses `floors` for the total floor count:

```json
{
  "floors": 26,
  "floor_plan": [
    { "biome": "caves", "floors": "1-8" },
    { "biome": "crypt", "floors": "9-26" }
  ]
}
```

A range can be written as `"1-8"`, a single number, or `[1, 8]`. The ranges should cover every floor without gaps.

Biomes themselves are defined in `data/biomes.json` or the prototype's own `biomes.json`, not in `prototype.json`. A prototype's biome replaces a global one with the same name completely. If a biome name can't be found, those floors use the prototype's defaults. Biomes are easiest to build in the Biome Editor (`editors/biome-editor.html`).

A biome can have an `actors` list, where each entry is `{ "id", "min", "max", "freq" }`. `min` and `max` are the floors it can appear on, `freq` is how common it is, and an optional `count` range spawns several at once. `actor_budget` sets how many picks to make per floor, using the same `base`, `extra_chance` and `max_extra` fields as the item budget. `items` and `item_budget` work the same way, using item types from the item catalog instead of actor ids.

`traps` and `fungus` grow with depth: `{ "min_depth", "intercept", "slope", "max" }`. From `min_depth` on, each floor gets `intercept` plus `slope` times the floor number, up to `max`. `fungus` also takes `tall_chance`.

A biome can also set `map_generator`, `mechanics` and `default_floor` for all its floors. A floor in `levels` can still override any of these.

## Linking Prototypes

`next_level` and `previous_level` link prototypes together by folder name. Going down the stairway on the last floor loads `next_level`, and going up from floor 1 loads `previous_level`. This is left over from early versions of the kit, when each prototype was a single level, but it still works.

```json
{
  "name": "The Mines",
  "previous_level": "default",
  "next_level": "sewer"
}
```

See [MAP.md](MAP.md) for more about stairways.

## Prototype Data Files

Put these next to `prototype.json` to add or replace definitions for one prototype: `actors.json`, `items.json`, `personalities.json`, `biomes.json` and `animations.json`. Each is merged with the file of the same name in `data/`, and an entry with the same id replaces the global one. In `animations.json`, sprite sheet paths are relative to the prototype folder. A prototype can also add its own item types in `types.json`.

See [ACTORS.md](ACTORS.md) and [ITEMS.md](ITEMS.md) for the formats.

## Examples

### A Single Floor

```json
{
  "name": "The Arena",
  "description": "A simple test arena.",
  "mechanics": {
    "fog_of_war": false,
    "darkness": false
  },
  "random_actors": {
    "skeleton": { "chance": 100, "min": 2, "max": 4 }
  },
  "win_conditions": ["killed:skeleton"]
}
```

### No Player

```json
{
  "name": "Cellular Automata",
  "description": "Watch life emerge.",
  "mechanics": {
    "observer_mode": true
  },
  "random_actors": {
    "gol_cell": { "chance": 100, "min": 50, "max": 100 }
  }
}
```

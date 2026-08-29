---
date: 2026-08-29
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

Pulling these two items out of my ideas file to survive as a journal entry, I've been fighting with the base dungeon generator secret door placement (generator is still embarassingly called 'Brogue' because I kind of just wanted Brogue-style dungeons and be done with it, which is ridiculous because Brogue has such elegant and surprising procgen dungeons, I'd spend years trying to get something even close.)

## New procgen model

Architect has gotten so complex that I now find much of it hard to read and working on it feels like churn. If it's this bad for me it will be a black box to anyone trying to design a prototype with anything but authored maps. What if there was an option to author a large tmj map and that got turned into wave function collapse rules? You could still use generator wildcard tiles on it if you wanted to have areas use one of the pre-existing generators.

I used a WFC library called [DeBroglie](https://github.com/BorisTheBrave/DeBroglie) for a non-game project called [Archon](https://wileywiggins.com/archon.html), but that was C#. Is there a javascript library already made that I could use?

Another thing I could do to untangle architect is to try to make it modular- i.e. the generators that are in there get componentized as separate files and when one is missing it fails gracefully to a fallback etc. we end up with a leaner architect that can use or not use the hairball generators, and on top of that we use wfc rules from handmade maps to let designers make their own generators, which could live in their own prototype folder.

## Renaming/semantic remapping of generator and biomes

My main generator is called `brogue` from when I was studying Brogue's architect, but needs its own name now since it's fairly different. This could be the generic dungeon generator. List out and audit all the generators and what they do. Biomes should be able to combine generators in different ways so that designers can come up with their own cocktails of each.
`caverns` and `depths` biomes aren't actually that distinct from one another. Map out what all the actual strata are and create/name approprate biomes for the Dungeon prototype.
I'd like to add an `ossuary` biome to the dungeon prototype, which would need some nice new skull-wall actors... and that suggests adding a wall actor selector in biome editor. You could add the ability to pick which actor is used as main walls, add the ability to define blob areas of actors other than just lava, sewage, or water...

Although if we have wfc rules built from authored maps, then you don't need as much stuff in the biome editor. you use the actor-editor to make a new solid actor, we add a wildcard tile selector to the actor editor, and then you can use that wildcard tile in your rules map that turns into generator rules via wfc. Then you can pick that as a generator in the biome editor. You would be able to have a rules map, biome, custom wall actors, all in your own prototype directory.

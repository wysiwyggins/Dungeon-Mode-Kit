---
date: 2026-09-28
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

# Fire and smoke

Some of the actors I've made have personalities that use cellular automata-style behaviors (aside from the very explicit ones in the Game of Life prototype) like a bunch of adjacent water or sewage actors spawning a deep version in the middle of the bunch. 

I played a bit with gas spawning by sewage, since I noticed gas was spawning on and beyond walls, and then used that as a lauching-off point for fire spawning a smoke actor that can induce a missed-turn choking state. Since clouds and mists were flammable by default that led to some WHOLE WORLD ON FIRE scenarios as the smoke also caught fire, so I switched the default cloud and mist actors to non-flammable and actors like sewer gas can override that. 

![I think I'll start... a forest firee](/assets/images/forest_fire.png)
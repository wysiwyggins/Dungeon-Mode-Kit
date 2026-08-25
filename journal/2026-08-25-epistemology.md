
---

date: 2026-08-25
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

# What is unseen and what is unkown

The Dungeon Mode in my mind is focused on what is unseen and what is unkown, and this is happening at many levels. For starters, visual specificity is part of the experiment of DMK, starting with this quote from *Dungeon Hacks*:

> With each new element Toy and Wichman wrote into Rogue, the game became more and more absorbing. Rather than reveal the entire dungeon map when players set foot in a new level, the game showed only their immediate surroundings. Moving in any direction revealed more of the map—and the creatures lying in wait. The graphics were primitive, but the thrill and apprehension of exploring uncharted terrain, combined with the pseudo-intelligent behavior of the monsters and the permanency of death, drew players deeper into the fantasy.  "We [printed] descriptions as things happened to you, and we had various monsters that we created, and potions, and things like that," Wichman remembered. "It was interesting that we did end up having an atmosphere even though all you're looking at is letters and symbols. We got drawn into the world, and you would imagine yourself in the world. You'd see a letter 'T' on the screen, and it would startle you because you knew it was a troll."

From *The Dungeon Mode*

> I have found, counterintuitively, that specificity of sound and images in games of the dungeon mode is inversely proportional to the amount of fear and suspense I feel playing them. A subjective glyph often has more of an effect on me than a 3D rendered monster. Likewise, the idea of darkness represented as a blank area of a map can induce more anxiety in me than the unrendered darkness of a first-person perspective game. The difference is between what is unknown and what is simply unseen. I have struggled to understand why I am currently gravitating towards symbolic representation of spaces rather than specific views, as I consider myself a highly visually oriented person. Media theorist Markus Rautzenberg perhaps does a better job of explaining how symbolic spaces create affect in dungeon games---

> > Images, symbols, names and finally notions are media in which the harsh urgency of reality could be represented; a reality that one could withdraw from because of those very media \... The breadth of reality could be imagined as potentiality.' Image, symbol, name, notion: according to \[Hans\] Blumenberg, this is the evolution of medial world apprehension. At the beginning there is the image (not the word!) as a first distancing between mind and world, the basic condition for differentiations between illusion and truth, map and territory. But this sequence is not to be understood as hierarchical. Images are not 'weaker' than symbols, names or notions (that would be blatant Platonism), they are just the first way of distancing from reality. Images come first because, for Blumenberg, humans are defined as 'emphatically visible beings' and it is because of this that the visual sense plays such a primary role in human evolution. (Rautzenberg 2020, 132)

The DMK tileset intentionally combines image blocks with symbol blocks and gives them all semantic names, acting more like a characterset than a modern spritesheet. Beyond visual specificity we are also concerned here with light and dark, and what is known and unknown, as when darkness, field of view and fog of war were introduced into dungeon games. I talk sometimes about my very first dungeon game experience, which wasn't a roguelike, but rather the TI-994a version of *Hunt the Wumpus*. A guessing game about drawing a map of places visited and using traces to guess at what lies in the blank "unknown" areas.

This sprint I polished up some mechanics related to vision and epistemology with the eel as a test case. The eel is inherited pretty directly from Brogue with some adjustments. An eel underwater isn't invisible (actors like ghasts have a visible: false attribute)— it's concealed by a medium, and that's a different fact with different rules. A isConcealedBySubmersion returned bool stays distinct from real invisibility which allows the player to also submerge and see the eel, but only in the same body of water. Two viewers in separate ponds still can't see each other.

Concealment is derived, not applied, it comes from isSubmerged on both sides rather than being set as a state, "so it can never go stale."

Like the visibility of the eel's tile, the player character's knowledge of its name changes (you can get bit by a hidden submerged thing, which is described thus).isAnonymous() — an unseen or non-visible actor doesn't get called an eel. This is in the same vein as identification-aware item names. It's the player character knowledge of the world (distinct from the player knowledge of the world!)

I've added a bunch of related tables in a new document called [/docs/EPISTEMOLOGY.md](EPISTEMOLOGY.md)

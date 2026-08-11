---
date: 2026-08-10
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

# Slowing down

> “We build our computers the way we build our cities—over time, without a plan, on top of ruins.”
― Ellen Ullman, Life in Code: A Personal History of Technology

Dungeon Mode Kit is a [tileset](https://codeberg.org/wysiwyggins/Dungeon-Mode-Kit/src/branch/main/docs/tiles.pdf), sound fx sprite (of sounds mostly made by recording and manipulating [one real instrument](https://larkinthemorning.com/products/round-sansula-thumb-piano)), and scripts that sit on top of some existing javascript libraries ([ROT.js](https://ondras.github.io/rot.js/hp/), [PIXI.js](https://pixijs.com/) [Tween.js](http://createjs.com/) and [Howler.js](https://howlerjs.com)) to allow for the quick prototyping of games (primarily turn-based roguelikes) using the free tilemap editor [Tiled](https://www.mapeditor.org) and human-readable data files that are separate from code. The ultimate goal would be an online suite of tools with their own tilemap editor, similar to [Bitsy](https://www.bitsy.org). Where DMK diverges from Bitsy is that it allows the creation of games with mixed procedurally generated maps and authored maps. [ZZT](https://zzt.org) is also an inspiration.

This project is intended to help me make small game prototypes that would play embedded in a piece of writing about dungeons as part of my doctoral research at Concordia University in Montreal. I would love if it was useful to other game designers, too, and I hope to find people to collaborate with on its development.

I'm an amateur programmer with a little bit of Unity C#, python, and javascript experience, but I'm primarily interested in recombining a handful of elements lego-style to get different results. I don't *like* the brittleness of programming itself and would prefer to play with building blocks rather than spend all my tile tooling them. Remembering how absolutely crushed I was for time during my MFA work, I rushed a lot of this project ahead of time so I could avoid programming rabbit holes going forward and focus on design. I've decided to slow down now that I've reached a point where the basic functionality is all there. I've included some changelogs and blog posts from the prior development in the repo itself, in an attempt to gradually adopt methods for my first coursework at Concordia— "[Materializing Design](https://materializing.design)." I'll continue to develop this practice of documentation as I go. Going forward the bland and overstuffed changelog posts I was doing previously will be replaced with more granular reflections of the process, git commits will contain the changelog info which will continue to roughly stick to it's existing [format](keepachangelog.com). My version numbers have always been pretty arbitrary at this experimental stage, but once I declare a "1.0" I'll start organizing features and bugs into major, minor, and patch releases.

All that being said, here is my design struggle for DMK v 1.17b, which was entirely an under-the-hood data organizational structure naming sprint, starting with the idea (I keep features, tweaks and bugs to work on in a messy document called IDEAS.md) and moving through my reasoning and the resulting work. This was a big refactor but I tried to be intentional and talk through what happened here instead of just leaving a sus changelog.

---

### applyState() revisit

- Right now the applyState method only works on sentient or controlled actors, but that is not good design for something just called applyState. there should be an additional method for sentient controlled actors that uses applyState so we can still make up new states for inanimate actors.

this suggests:

### Actor types

- A type would be a set of actor defaults that individual actors could apply through an attribute, which would set a lot of things that would be tedious to apply to each actor. For instance 'beast' could be a type that would add things like state immunities, a personality, stats and attributes. A 'dog' actor could have type: "beast" and then any actor data would supplement or override "beast" and the additional benefit is that we could gate different states by type instead of gating all states to a couple of attributes.

- Would there be a types.json or would this be additional information in actors.json?

---

## Here's where this gets hard

The word 'type' was very overloaded in the codebase. I'm getting into one of the big design problems that always happens in codebases that start to scale up: an overabundance of generic sounding names. 'Type', 'group', 'collection', 'category', 'container' etc, etc. Both visual design and information design are problems of juggling quantities and finding distinct and appropriate containers for them. I come from a css background and this is one of the first problems you learn to tackle. What are containers called, how do they communicate things like hierarchy and containership visually (if they are visible.) What do they mean and how do they keep their contents manageable

In DMK we have Entities, which are a root class that both Actors and Items inherit from, and Entities already had a type — except it didn't mean "what kind of thing is this," it meant "which entry in the data file is this." `actor.type` was `'goblin'`. `item.type` was `'health_potion'`. Prototypes (another generic sounding classification) have an `item_catalog` which calls `potion` and `scroll` *categories* (another generic container word, it can't be avoided), `adjectives.json` and `attacks.json` (word lists that themselves have questionable names) sort their words into *categories* too, and `Object.keys(prototypeActors)` gets called `prototypeActorTypes` — the ids again. So three different jobs, two words, no agreement about which was which.

I went looking for a free word and didn't much like what was available. `kind` was taken by the targeting system. `nature`, `stock` and `mold` all turn up inside the word lists that generate item names, which is exactly the kind of collision that produces a "mold potion of mold." `archetype` was the one word that wasn't used anywhere in the repo, but it felt heavy, didn't communicate much other than add some Jung vibes that I don't want to inherit. I also didn't want to call something one thing in the data files and something else in the code.

My solution was to reorder some of the naming conventions rather than keep adding to the pile. The category concept got the word `type`, because that's the word a designer reaches for when they write `"type": "beast"` in a JSON file, and the data files are the surface I care first about keeping legible. The id keeps `Entity.type` for now, and the type is resolved away before an Actor is ever constructed — merged into a flat definition, so nothing downstream has to know types exist (if I had to use archetype as another word I would probably add it here—meaning "a more primitive type than type"). That leaves exactly one awkward phrase in the engine, `actor.data.type`, and accomplishes the main feature without a bigger refactor (for now).

The naming mess had already made one decision for me. I'd wondered whether types should just live in `actors.json` as specially marked entries, which would mean one less file. They can't, because `prototypeActorTypes` collects every key in that file and the spawner drops one to three of each into the level. Type definitions would have wandered around the dungeon as monsters. So a badly named variable turned out to be load bearing in a way I didn't expect, and types got their own file.

Once it worked I could see what the tedium had been costing me. Skeletons were flammable and could be poisoned, which is silly for a bag of dry bones. `states.json` has had a `poison_immune` flag the whole time and not one actor ever declared it, because setting it by hand on every skeleton and ghast and wraith was more bother than the effect was worth. Now `undead` says it once. That's the whole argument for types in a single example, and it's the kind of thing I only notice after the tedious version stops being the only option.

---

## Next

Currently there are generic items that serve as containers for random individual items— randomized potions, food, staffs etc. The category knows its members but no member knows its category. Extending types to items could cut down on the amount of redundant item data and still support the random item placement code.

`types.json` already has a `domain` field sitting unused, and the merge code doesn't care whether it's handed an actor or an item. What I don't know yet is whether an item type and an actor type are really the same idea or just two things that happen to merge the same way, and I'd rather find that out by trying it on items than by reasoning about it in advance. My thought is that you might place a random beast the same way you place a random potion, but that you'd want to define that placing pool in the prototype not in the types of all beasts or all potions. So maybe the random placement pool is a separate thing from types, but types are the same idea for both items and actors.

Also `Entity.type` still holds the id, so an actor's type has to be read as `actor.data.type`. Need to make it `Entity.id` and give `type` back to the category.

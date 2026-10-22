---
date: 2026-10-21
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

I haven't written a journal in a while because I've been journaling for school projects and just kind of picking wish-and-buglist items off one by one for DMK. I won't rehash changelog stuff here, I'll stick to writing about next steps and current issues etc.

Right now I am thinking a lot about what the hosted version of this is going to be like and how I'm going to get it online.
The last feature I added is a text entry ui window type and I did that with the idea of persistent player headstones in hosted prototypes in mind. Oregon Trail style. Although I am not sure if that is realistic, since I feel like the bitsy model is the best one to follow and bitsy doesn't host people's finished bitsy games, that's up to them, people use itch etc. I definitely don't think I want to host everyone's prototypes myself.

I've deployed web apps before but they were django things and I had help. I've also always used digital ocean in the past, but it seems like they are going [evil now](https://stopomarchy.org), but I also don't really know good alternatives and it seems like every tech platform is getting more and more evil and I need a year off to extract myself from it all.

Anyway, I am going to try to talk to some folks and get advice. I would love to get more folks looking at the project in general and sharing advice. I think I have been working three years on this now(?) maybe four if you count the original ROT.js experiment with tiles.

I am also trying to decide whether or not I am going to implement conversation trees. I had imagined a pretty simple ink-based conversation feature that builds off the taunts you can currently add to personalities. So it would be like a hook from a personality into an ink json file for conversation. I could see people having a lot of fun with this and making different variations of games, but it's not actually a feature I am super excited about myself. When I think of the roguelikes I am trying to cover the features of, it's like Rogue, Brogue and Moria.. and Moria only has shop haggling, which I find to be a kind of boring and annoying mechanic! Maybe it would spark my imagination if I had it to work with, though. I like the idea of being able to have more non-hostile actors that you can interact with, or undecided actors that could turn on you if you piss them off.

As far as recent features go, the biggest ones that jump to mind are building out the blindness state, which now does clever things with item name masking and prevents you from using scrolls (even though this is kind of hardcoded, opinionated stuff, I felt like it was worth it). Also a bow weapon that must be equipped and launches items, pretty much just like bows and crossbows in moria. That one is more in data and modular/reusable. Some things that were hardcoded before have been surfaced to data like they should be. A long-time performance bug that was happening whenever swamp gas was being spawned en masse in dark levels is fixed, I had tried many different ways of fixing it, and fixing map epistemology actually fixed it (I could see the gas spawning in 'remembered' areas that were outside of field of vision and fixing that also fixed the performance).

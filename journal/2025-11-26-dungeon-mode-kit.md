---
title: Dungeon Mode Kit
date: 2025-11-26 13:15:09
layout: post
categories: []
tags: 
- dungeon
- dungeonkit
- studio
---

![DMK test pattern](/images/dmktest.png)
This is project start for *Dungeon Mode Kit*, a set of tools for prototyping games within the Dungeon Mode.

Right now this is an attempt at a more intentionally designed version of the [roguelike experiment](https://wileywiggins.com///grotto_roguelike/) I did last year, which used [Rot.js](https://ondras.github.io/rot.js/hp/) for maze drawing and pixi.js for rendering, but did some very elaborate (and brittle) stuff to draw height (walls and characters are two tiles high instead of looking directly down at a grid of single tile entities) and to draw these hard angular shadows out of tiles based on the walkable map. The result was kind of overly specific, crashy, and the way it built levels meant that I could never properly get saving and reloading levels to work, resulting in a single-floor prototype.

After that experiment I have a better idea of what I would like- something much more flexible, able to both display authored tilemaps using [Tiled](https://www.mapeditor.org) and proceral rot.js mazes together in the same level. Something totally attribute based where I could do different goals, skills, etc on each level. Basically each level is a different game built with the same tools, loading a json file to configure it. Something almost between *Baba Is You* and a roguelike, where if no actor has a player controllable attribute, the level would play as a cellular automata animation.

The goal here is that a book version of the Dungeon Mode would have tools ready for me to make small prototypes of each chapter topic, so there are small conceptual prototypes on those themes, game-a-week style.

This first pass has Tiled .tmj file loading working, rendering to the canvas, (including animated tiles), and the base classes (entity, actor, item). There's also stubs for things like saving state between levels, but I am actually not sure I care about anything other than loading the games (it might be a cool easter egg to have a change in one prototype affect play in another but it could also be distracting) I'm going to take this fairly slow, but hope to have something functional by fall.

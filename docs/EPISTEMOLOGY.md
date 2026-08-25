# Epistemology

What the player can see, and what the player can know. Two separate systems: sight
(is it drawn) and knowledge (is it understood). Several independent rules stack; the
tables below say which is which.

## Visibility

### The states

| State | Set by | Drawn? | Named? | In sidebar? |
|---|---|---|---|---|
| Visible | default (`visible: true` in constructor) | yes | yes | yes |
| Unlit / out of FOV | `lightingManager` | no | n/a | no |
| Remembered | explored, not currently visible, `fogOfWar` | static actors only, dimmed `0x333333`, animation paused | n/a | no |
| Invisible (state) | `invisible` state, e.g. potion | no (player: `alpha 0.35`) | "something" | no |
| Invisible (attribute) | `visible: false` in actors.json | no | "something" | no |
| Submerged | standing on a `deep` liquid actor | body only | yes | yes |
| Concealed by water | submerged + `conceals_when_submerged` | no | "something" | no |
| Telepathy-sensed | viewer has `telepathic`, target `sentient` | body only, `alpha 0.35` | yes | yes |

### Attributes

| Attribute | Meaning | Default |
|---|---|---|
| `visible` | Permanently unseen when false — ghast, portal, oculus, gas/fire traps | `true` |
| `conceals_when_submerged` | Deep liquid hides this actor from anyone above the surface | `false` |
| `deep` | On a liquid actor: submerges whoever stands on it | `false` |
| `opaque` | Blocks line of sight through this tile | `false` |
| `ignore_darkness` | Drawn regardless of light level (still viewport-culled) | `false` |
| `sentient` | Eligible for telepathy reveal | `false` |
| `controlled` | Player-driven; never hidden from itself, shown at `alpha 0.35` instead | `false` |

### Predicates

| Method | Answers | Used by |
|---|---|---|
| `isUnseen()` | invisible state **or** concealed by water | sprite passes, sidebar |
| `isAnonymous()` | `isUnseen()` **or** `visible: false` | message templates |
| `isConcealedBySubmersion()` | is deep water hiding this from the viewer | `isUnseen()` |
| `getLiquidBodyIdAt(x, y)` | which connected pool a tile belongs to | shared-water reveal |
| `getEntityVisibility(x, y)` | FOV/fog/light result per sprite | render passes |

### Submersion

Two separate things, often confused:

| Concern | Mechanism | Applies to |
|---|---|---|
| Looking underwater | `submerge()` moves the top texture to the base slot and hides the top | actors with **both** a base and a top tile |
| Being hidden underwater | `isConcealedBySubmersion()`, derived live | actors with `conceals_when_submerged` |

A single-tile actor (eel: base `LEO`, top `BLANK` → `null`, so no `spriteTop`) has no
head to lower, so the first does nothing for it and only the second hides it.

#### What a submerged actor still shows

Only the base tile reads through the surface.

| Sprite | While submerged |
|---|---|
| base | shown |
| top | hidden |
| side | hidden |
| equipment `top`, `middle` | hidden (sit above the base tile) |
| equipment `lower` | shown (rides the base tile) |

Applied by `RenderSystem.applyViewportCulling()` and the lighting pass, which share
this rule.

#### Who sees a concealed actor

| Viewer | Result |
|---|---|
| Above the surface | hidden, unnamed |
| Submerged in the same connected body of liquid | fully visible and named |
| Submerged in a different body | hidden, unnamed |
| Telepathic (any position) | body sensed at `alpha 0.35` |

"Connected" runs through **any** liquid, shallow or deep — a lake pinched to a shallow
ford is one body. Pools are labelled by an 8-way flood fill cached alongside
`_getLiquidActorAt`.

### Visibility notes

- `hasAttribute()` is truthiness-based, so `visible: false` and an absent `visible` read
  the same.
- Static (no `personality`, not `controlled`) vs mobile decides remembered-area drawing:
  walls and doors persist dimmed, creatures do not.
- Traps' `visible: false` is currently permanent — there is no search action yet.
- Never reduce opacity on a controlled actor's sprite as a "hidden" signal; the `0.35`
  entries above are the established exceptions (self-invisibility and telepathy).

---

## Known and unknown objects

Seeing a thing is not knowing what it is. An unidentified potion is fully drawn and
named — the name is just a lie about its appearance rather than its nature.

### What can be unknown

| Thing | Unknown means | Becomes known by |
|---|---|---|
| Item type | shows an appearance name ("cloudy potion") | using, reading, or a scroll of identify |
| Item enchantment | `+N` hidden on weapons/armor | equipping (cursed reveals itself), identify |
| Map tile | never drawn, no memory | entering line of sight |
| Explored tile | drawn dimmed from memory, may be stale | re-entering line of sight |
| Actor identity | "something" in messages | seeing it (see visibility above) |
| Trap | `visible: false`, indistinguishable from floor | triggering it |

### Item identification

| Property | Value |
|---|---|
| Stored on | `Item.identified` (bool), `prototype.identifiedTypes` (Set) |
| Scope | **per type** — identifying one cloudy potion identifies all of them |
| Exception | `enchantable` items (weapons, armor) identify **per instance** |
| Lifetime | one prototype session; not persisted across runs |
| API | `item.identify()`, `prototype.isTypeIdentified(type)`, `prototype.identifyType(type)` |
| Progress | `prototype.getCatalogStats(category)` → `{ total, discovered }` |

#### Appearance names

An unknown item is labelled by a randomly assigned, **stable** appearance — the same
kind of potion looks the same all session, so it's learnable.

| Flag | Names by | Source | Example |
|---|---|---|---|
| `random_color` | color word | `colors.json` | cloudy potion |
| `random_material` | material | `substances.json` | iron ring |
| `random_glyph_name` | runic two-word name | generated | scroll of "vas kandar" |

Templates: `unidentified_template` while unknown, `identified_template` once known.
Assignments are memoized per item type on the prototype, so they stay consistent.

Keys are a special case: their color comes from `getKeyColor()` and is written to
`lock_color` so it can be matched against a door, not merely displayed.

### Knowledge notes

- `identified` defaults to `true`. An item is only ever unknown if its JSON says
  `"identified": false`.
- Identification is knowledge, not sight: an unidentified item is drawn normally.
- Cursed items force `identified = true` on equip, so the curse announces itself.
- Hallucination (`hallucinating` state) corrupts *appearance* without touching
  knowledge — what you know stays correct, what you see does not.

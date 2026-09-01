# Epistemology

**What the player character can see, and what the player character can know**

## Visibility

### The states

| State | Set by | Drawn? | Named? | In sidebar? |
| --- | --- | --- | --- | --- |
| Visible | default (`visible: true` in constructor) | yes | yes | yes |
| Unlit / out of FOV | `lightingManager` | no | n/a | no |
| Remembered | explored, not currently visible, `fogOfWar` | static actors only, dimmed `0x333333`, animation paused | n/a | no |
| Invisible (state) | `invisible` state, e.g. potion | no (player: `alpha 0.35`) | "something" | no |
| Invisible (attribute) | `visible: false` in actors.json | no | "something" | no |
| Hidden, disguised | `hidden: true` + `_hidden` tiles | as the disguise (wall) | "something" | no |
| Hidden, unsprited | `hidden: true`, no `_hidden` tiles | no | "something" | no |
| Submerged | standing on a `deep` liquid actor | body only | yes | yes |
| Concealed by water | submerged + `conceals_when_submerged` | no | "something" | no |
| Telepathy-sensed | viewer has `telepathic`, target `sentient` | body only, `alpha 0.35` | yes | yes |

### Attributes

| Attribute | Meaning | Default |
| --- | --- | --- |
| `visible` | Permanently unseen when false — ghast, portal, oculus | `true` |
| `hidden` | Concealed but **discoverable** — secret doors, levers, plates, traps | `false` |
| `awareness` | Bonus to search strength; on an actor, or via a ring's `wear_effect` | `0` |
| `conceals_when_submerged` | Deep liquid hides this actor from anyone above the surface | `false` |
| `deep` | On a liquid actor: submerges whoever stands on it | `false` |
| `opaque` | Blocks line of sight through this tile | `false` |
| `ignore_darkness` | Drawn regardless of light level (still viewport-culled) | `false` |
| `sentient` | Eligible for telepathy reveal | `false` |
| `controlled` | Player-driven; never hidden from itself, shown at `alpha 0.35` instead | `false` |

### Submersion

Two separate things, often confused:

| Concern | Mechanism | Applies to |
| --- | --- | --- |
| Looking underwater | `submerge()` moves the top texture to the base slot and hides the top | actors with **both** a base and a top tile |
| Being hidden underwater | `isConcealedBySubmersion()`, derived live | actors with `conceals_when_submerged` |

A single-tile actor (eel: base `LEO`, top `BLANK` → `null`, so no `spriteTop`) has no
head to lower, so the first does nothing for it and only the second hides it.

#### Who sees a concealed actor

| Viewer | Result |
| --- | --- |
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
- `visible: false` means "has no sprite, ever"; `hidden: true` means "concealed but
  findable". Keeping them separate is what lets traps be searchable while a ghast
  stays permanently unseen.
- Never reduce opacity on a controlled actor's sprite as a "hidden" signal; the `0.35`
  entries above are the established exceptions (self-invisibility and telepathy).

---

## Searching

Hidden things are ordinary actors carrying `hidden: true`. Discovery flips that one
attribute — nothing is created or swapped, so a found door keeps its `machine_id`
links, its lock color, and its place in the level. Because attributes serialize with
the floor, a reveal survives leaving and coming back.

### Two ways to be hidden

Which one an actor gets is decided by whether it has `_hidden` tiles, and that follows
from where it stands:

| | Disguised | Unsprited |
| --- | --- | --- |
| Data | `tileIndexBase_hidden` / `tileIndexTop_hidden` | no `_hidden` tiles |
| Stands on | a tile that would otherwise be wall | open floor |
| Renders as | ordinary wall (untinted, so machine color can't betray it) | nothing; the floor shows through |
| Examples | `hidden_door`, `barred_hidden_door`, `hidden_lever` | `hidden_pressure_plate`, gas/fire traps |

A wall-mounted actor *replaces* the wall actor on its tile, so making it merely
invisible would leave a hole in the wall. That's the whole reason the disguise exists.

### The search

| | Trigger | Strength | Radius |
| --- | --- | --- | --- |
| Passive | first time you stand on a tile | `30 + awareness` | strength-derived (~2, ~4 with the ring) |
| Thorough | `(s)`, five turns, interruptible | `200` | capped at `5` |

Radius is capped independently of strength for the thorough search, unlike Brogue's
`strength / 10`. That's what makes a finished search *certain* inside its reach and
silent outside it: "this area is clear" is a fact the player can act on, rather than a
roll worth repeating. Both are retunable per prototype or per floor via
`mechanics.search_radius`, `thorough_search_strength`, `passive_search_strength`
(see [PROTOTYPE.md](PROTOTYPE.md)).

### Where hidden things come from

Hand-authored maps place the actors directly. Two generators also seed them, each in
the idiom of the space it builds (rates in [PROTOTYPE.md](PROTOTYPE.md)):

| Generator | What it hides | Why there |
| --- | --- | --- |
| `dungeon` | a share of dead-end shortcuts (`secretDoorChance`) | The dead-end fixer already finds these cells: a blind corridor with a room just beyond the wall. Finding one is a real shortcut, so it rewards the search. |
| `dungeon` and others | interior walls with floor on both sides (`secretWallChance`, off by default) | the same pool the 2% pushable-wall pass draws from — a wall between two floors is a passage waiting to happen |
| `palladian` | non-axial interior doors (`secretPassageChance`) | a tartan grid has no dead ends, so the villa's secret is a doorway that reads as blank wall. Never the axial door: it carries the enfilade. |

Two invariants hold whatever the rates are set to, because a secret should be a
shortcut and never a wall:

- **Nothing is sealed behind only secrets.** Every Palladian room keeps at least one
  door you can simply walk through. Verified at a 100% conceal rate.
- **No lever is ever behind the door it opens.** A `barred_hidden_door` really does
  block until its lever is pulled, and nothing else opens it, so a badly sited lever
  would seal a room permanently. Each is placed only where it can be reached with
  that door shut *and* every barred door already placed shut — which is also what
  stops two passages holding each other's lever.
- **Symmetry is never broken.** A concealed door and its mirror twin are converted as
  a pair, as are their levers, so a villa can't be read for secrets by looking for
  the side that doesn't match. `tools/palladian-dump.js` checks this.

Some Palladian passages spawn as `barred_hidden_door` — locked, and linked by
`machine_id` to a `hidden_lever` disguised as wall in one of the two rooms it joins.
That takes two discoveries: the lever, then the door it opens.

### Other ways things get found

| Route | Notes |
| --- | --- |
| Magic mapping | reveals every hidden actor on the floor, no LOS or distance test; silent, with a count |
| Springing a trap | discovering it is part of setting it off |
| Stepping on a plate | `toggle()` reveals first, so the effect never fires from nowhere |
| Digging it out | disguised actors are `breakable`, like the wall they imitate |

### Searching notes

- A disguised actor is deliberately inert to every probe short of a search: it can't be
  bumped open, Tab-targeted, hovered for a name, or spotlit by the overlay fade. Each of
  those was a way the secret leaked before it was closed.
- It is `breakable` on purpose — a mattock refusing to dig one spot would give it away
  just as loudly.
- Interrupting a thorough search spends the turns anyway ("You abandon your search"),
  which is what stops it being free to spam.

---

## Known and unknown objects

Seeing a thing is not knowing what it is. An unidentified potion is fully drawn and
named — the name is just a lie about its appearance rather than its nature.

### What can be unknown

| Thing | Unknown means | Becomes known by |
| --- | --- | --- |
| Item type | shows an appearance name ("cloudy potion") | using, reading, or a scroll of identify |
| Item enchantment | `+N` hidden on weapons/armor | equipping (cursed reveals itself), identify |
| Map tile | never drawn, no memory | entering line of sight |
| Explored tile | drawn dimmed from memory, may be stale | re-entering line of sight |
| Actor identity | "something" in messages | seeing it (see visibility above) |
| Trap | `hidden: true`, indistinguishable from floor | searching, or triggering it |
| Secret door / lever | `hidden: true`, drawn as ordinary wall | searching, magic mapping, or digging it out |

### Item identification

| Property | Value |
| --- | --- |
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
| --- | --- | --- | --- |
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
- Hallucinating state hides names of actors and items, and currently scrambles actor tiles (need to extend it to items)

# Description System

The description system displays contextual text to players through an HTML `<details>` element. It handles hover descriptions, event messages, and templated text with automatic article selection.

## HTML Structure

The description element is a collapsible `<details>` tag in `index.html`:

```html
<details id="description">
    <summary>Description</summary>
</details>
```

The element opens automatically when there's content to display and closes when cleared.

## Display Triggers

### 1. Mouse Hover Descriptions

When the player hovers over a tile, `InputManager.updateDescription()` shows what's visible:

- **Currently visible tiles**: "You see a Skeleton."
- **Remembered tiles** (fog of war): "You remember seeing a Skeleton."
- **Multiple entities**: "You see a Skeleton and a Sword."

The system respects visibility—unexplored or non-visible tiles show nothing.

### 2. Event Messages (Turn History)

Game events use `showMessage()` to display feedback. The description element shows the **3 most recent turns** of messages, with older turns styled in gray to emphasize the newest:

```
The Skeleton attacks you.        ← 2 turns ago (lightest gray)
You pick up a Sword.             ← 1 turn ago (medium gray)
The Door opens.                  ← Current turn (black)
```

Multiple messages from the same turn are grouped together. When a new turn begins, the oldest visible turn "scrolls off" the display.

### 3. Prototype Descriptions

When a level loads, the prototype's `description` field displays as the initial message:

```json
{
  "name": "Cretan Labyrinth",
  "description": "It's dark inside these winding corridors."
}
```

Supports `\n` for line breaks in the JSON string.

## Turn History System

The InputManager maintains a complete history of all turn messages:

- `turnHistory[]` - Array of all past turns (each turn is an array of messages)
- `messageStack[]` - Messages for the current turn (not yet committed)
- `visibleTurnCount` - Number of turns to display (default: 3)

When `clearMessageStack()` is called at the start of a new player action, the current turn's messages are committed to history before the stack is cleared.

### CSS Styling

Older messages use CSS classes for visual hierarchy (defined in `_typography.scss`):

| Class            | Applied To      | Color   |
|------------------|-----------------|---------|
| (none)           | Current turn    | black   |
| `.message-age-1` | 1 turn ago      | `#666`  |
| `.message-age-2` | 2+ turns ago    | `#999`  |

## Template System

Any player-facing string in the data files can contain `[token]`s, resolved at
runtime by one shared function — `resolveTemplate` in `engine.js`. That includes
**names**, not just descriptions:

| Field | On | Resolved |
| --- | --- | --- |
| `name` | items, actors | memoized |
| `unidentified_template` / `identified_template` | items | memoized |
| `description` | items | memoized |
| `use_description` | items | re-rolled |
| `collision_description` | actors, weapons | re-rolled |
| `walk_description`, `switch_message` | actors | re-rolled |

**Memoized vs re-rolled** is the difference between an identity and an event. A
name is drawn on every hover, so its random picks are cached — otherwise the thing
would appear to rename itself. A message is read once, so it re-rolls and you get
variety. Nothing in the data has to say which; it follows from the field.

An unknown token is left alone rather than blanked, so prose containing brackets
survives intact.

### Names

A name can carry a token, which is how an entity says *where* a generated word
belongs instead of the engine deciding:

```json
"lever": {
  "name": "[color] lever",
  "collision_description": "[a-an] [color] lever",
  "switch_message": "You pull [name]."
}
```

A lever paired to a machine is assigned a colour (`initializeSwitchTints`), which
lands in `templateVars.color` and reads as "the fire brick lever". Write
`"lever, [color]"` and it reads that way instead — the word order is the data's.

Entities that carry a colour but *don't* mention it in their name (doors, gates)
fall back to a colour prefix, so they read as they always have.

`templateVars` holds these per-instance values. It's seeded from an optional
`template_vars` object in the data, then filled by whatever assigns randomness:
`random_color`, `random_material`, `random_glyph_name`, key/door pairing, switch
pairing, fungus type.

### Item Use Descriptions (`use_description`)

Defined on items, shown when the item is used:

```json
{
  "use_description": "The [item_name] has [a-an] [adjectives.yucky] taste."
}
```

**Supported variables:**

- `[item_name]` - The item's display name (identification-aware)
- `[adjectives.category]` - Random adjective from the `adjectives` list in `data/words.json`
- `[a-an]` - Automatic article based on following word
- `[key]` - Any template variable or attribute on the item

### Actor Collision Descriptions (`collision_description`)

Defined on actors, shown when they attack:

```json
{
  "collision_description": "The [actor_name] [attacks.melee_verbs] [attacked_actor_name]!"
}
```

**Supported variables:**

- `[actor_name]` - The attacking actor's name
- `[attacked_actor_name]` - The target's name
- `[attacks.category]` - Random verb from the `attacks` list in `data/words.json`
- `[adjectives.category]` - Random adjective from the `adjectives` list in `data/words.json`
- `[a-an]` - Automatic article based on following word

### Automatic Articles (`[a-an]`)

The `[a-an]` marker is replaced with "a" or "an" based on the next word:

```text
"[a-an] orange potion"  → "an orange potion"
"[a-an] blue potion"    → "a blue potion"
```

Processing happens after all other substitutions, so it works with random adjectives.

## API Reference

### InputManager Properties

| Property           | Type       | Description                                    |
|--------------------|------------|------------------------------------------------|
| `messageStack`     | `string[]` | Messages for the current turn                  |
| `turnHistory`      | `array[]`  | Complete history of all past turns             |
| `visibleTurnCount` | `number`   | Number of turns to display (default: 3)        |

### InputManager Methods

| Method                      | Description                                 |
|-----------------------------|---------------------------------------------|
| `showMessage(message)`      | Add message to current turn and display     |
| `clearMessageStack()`       | Commit current turn to history, start new   |
| `displayMessages()`         | Render visible turns with age styling       |
| `updateDescription(x, y)`   | Show hover description for tile             |
| `clearDescription()`        | Clear and close the description element     |
| `getIndefiniteArticle(name)`| Returns "a" or "an" for a word              |

### Entity Methods

| Method                                 | Description                          |
|----------------------------------------|--------------------------------------|
| `Item.getUseDescription()`             | Process use_description template     |
| `Actor.getCollisionDescription(target)`| Process collision_description template|

## Message Flow

1. **Player action starts** → `clearMessageStack()` commits previous turn to history
2. **Events occur** → Each calls `showMessage()`
3. **Messages accumulate** → Stored in `messageStack[]`
4. **Display updates** → `displayMessages()` renders recent turns with styling
5. **Turn ends** → Messages persist, visible with history context

## Data Files

| File                  | Purpose                                                   |
|-----------------------|-----------------------------------------------------------|
| `data/words.json`     | All random word lists, namespaced by topic: `attacks`, `defenses`, `adjectives`, `scrolls` |

Every list of random words for flavor text lives in `data/words.json`, grouped
into a top-level namespace. The `[namespace.category]` template syntax reads
those namespaces directly, so `[attacks.melee_verbs]` resolves to a random entry
from `words.json` → `attacks` → `melee_verbs`:

```json
{
  "attacks":    { "melee_verbs": ["swipes at"], "miss_verbs": ["swings wide of"] },
  "defenses":   { "dodge_verbs": ["ducks"] },
  "adjectives": { "yucky": ["foul"], "wine_descriptions": ["oaky"] },
  "scrolls":    { "scroll_glyphs": ["zelgo"] }
}
```

Adding a namespace here **does** make it available to templates: every list is
flattened into one `namespace.category` registry at load (`buildWordRegistry` in
`engine.js`), so no code names the namespaces it accepts. `data/reagents.json` and
`data/substances.json` are flat rather than nested, so they take their filename as
the namespace — hence `[reagents.reagents]` and `[substances.substances]`.

Word lists are global only; unlike actors or biomes, a prototype can't override them.

## Future: Full History Viewer

The `turnHistory` array stores all messages for the entire session, enabling a future history viewer that allows players to scroll through all past messages.

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

## Event Message Types

The engine calls `showMessage()` for various events:

| Event          | Example Message                           |
|----------------|-------------------------------------------|
| Item pickup    | "You pick up a Sword."                    |
| Door open/close| "The Door opens."                         |
| Door locked    | "The Door is locked."                     |
| Key unlock     | "The blue key unlocks the blue door!"     |
| Wrong key      | "The red door requires a red key."        |
| Push           | "You push the Boulder."                   |
| Death          | "You die..." / "The Skeleton dies."       |
| Fall           | "You plunge into the depths!"             |
| Incineration   | "The Lava incinerates the Skeleton!"      |
| Item use       | Templated `use_description`               |
| Attack         | Templated `collision_description`         |
| Identification | "You identified the Potion of Healing!"   |

## Template System

Items and actors can define templated descriptions that are processed at runtime.

### Item Use Descriptions (`use_description`)

Defined on items, shown when the item is used:

```json
{
  "use_description": "The [item_name] has [a-an] [adjectives.yucky] taste."
}
```

**Supported variables:**

- `[item_name]` - The item's display name (identification-aware)
- `[adjectives.category]` - Random adjective from `data/adjectives.json`
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
- `[attacks.category]` - Random verb from `data/attacks.json`
- `[adjectives.category]` - Random adjective from `data/adjectives.json`
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
| `data/adjectives.json`| Random adjective categories (e.g., "yucky": ["foul"])     |
| `data/attacks.json`   | Random attack verbs (e.g., "melee_verbs": ["slashes"])    |

## Future: Full History Viewer

The `turnHistory` array stores all messages for the entire session, enabling a future history viewer that allows players to scroll through all past messages.

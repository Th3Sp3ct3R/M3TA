# Entity sprite sheet

Drop your character sheet here as **`entity.png`** (i.e. `tauri/public/entity.png`).
It is served at `/entity.png` and auto-detected at runtime — until it exists, the
app falls back to the built-in CSS creature, so nothing breaks.

Then set the grid in `tauri/src/App.tsx` → `ENTITY_SHEET`:

```ts
const ENTITY_SHEET = {
  src: "/entity.png",
  frameW: 32,      // pixel width of ONE frame cell
  frameH: 32,      // pixel height of ONE frame cell
  cols: 7,         // number of frame columns in the sheet
  displayH: 34,    // on-screen height in px (width auto-scales to keep ratio)
  clips: {
    // row = 0-based row index, from = first column, count = # frames, fps = speed
    idle:   { row: 0, from: 0, count: 1, fps: 4 },
    walk:   { row: 1, from: 0, count: 7, fps: 12 },
    jump:   { row: 2, from: 0, count: 3, fps: 9 },
    roll:   { row: 3, from: 0, count: 6, fps: 16 },
    attack: { row: 4, from: 0, count: 5, fps: 16 },
    sit:    { row: 0, from: 0, count: 1, fps: 2 },
  },
};
```

## Behavior → animation mapping (already wired)
| Behavior state            | Clip played |
|---------------------------|-------------|
| idle                      | `idle`      |
| wander / chase (running)  | `walk`      |
| jump / flip / fall        | `jump`      |
| roll / slide              | `roll`      |
| punch (grabbing cursor) / work (tools busy) | `attack` |
| sit (bored)               | `sit`       |

Facing left/right is handled automatically (horizontal flip).

## What to send me
After dropping the PNG, tell me: **frame width/height, column count, and which
row is which action** (idle / walk / jump / roll / attack / sit). I'll set the
config exactly. If your sheet uses a different set of actions (e.g. separate
up/down walk rows), say so and I'll extend the clip map.

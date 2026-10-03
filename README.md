# sokoban
Vibecoded sokoban by Devin

A browser Sokoban game in plain HTML/CSS/JS — no build step. Open `index.html` in a browser (or serve the folder, e.g. `python3 -m http.server`).

## How to play
Push every box onto a goal. You can only push (never pull) and only one box at a time.

| Action | Keys |
| --- | --- |
| Move | Arrow keys / WASD (swipe or on-screen pad on touch devices) |
| Undo | Z / Backspace |
| Restart | R |
| Previous / next level | `[` / `]` |
| Toggle light/dark mode | T (or the header button) |

32 levels: 12 hand-made ones from a one-push tutorial to a 4-box warehouse, then 20 generated ones that get steadily harder (up to 48 pushes). Each level shows its **par** (minimum possible moves). Your best move count per level is saved in `localStorage`.

## Adding levels
Levels live in `levels.js` using the standard XSB notation: `#` wall, `.` goal, `$` box, `*` box on goal, `@` player, `+` player on goal.

## Generating levels
`tools/levelgen.py` (Python 3, standard library only) builds random rooms, places boxes on goals, and runs a reverse breadth-first search of pulls to find the starting position that needs the most pushes, so every generated level can be solved. It then finds the minimum move count (par) for each one.

```sh
python3 tools/levelgen.py generate -n 400 > candidates.jsonl   # one JSON level per line
python3 tools/levelgen.py check                                # solve every level in levels.js and verify par
```

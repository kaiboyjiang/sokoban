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

12 levels, from a one-push tutorial to a 4-box warehouse. Each level shows its **par** (minimum possible moves). Your best move count per level is saved in `localStorage`.

## Adding levels
Levels live in `levels.js` using the standard XSB notation: `#` wall, `.` goal, `$` box, `*` box on goal, `@` player, `+` player on goal.

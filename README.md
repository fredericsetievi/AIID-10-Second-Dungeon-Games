# 10-Second Dungeon

A 2D top-down time-attack dungeon game. You get **exactly 10 seconds** to grab
treasure and reach the exit — then the next, harder dungeon generates.

Built with plain HTML5, CSS3 and vanilla JavaScript (ES modules). No build step,
no backend, no dependencies, no external assets.

**[Play it in your browser](#)** *(GitHub Pages URL appears here once enabled)*

## Running it locally

Because it uses ES modules, it needs to be served over `http://` — opening
`index.html` straight from disk will be blocked by the browser's module CORS
rules. Any static server works:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

```bash
npx serve .
```

## How to play

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Move |
| `Esc` | Pause / resume |
| `Space` / `Enter` | Start, restart, continue |

- Grab **coins** (+10) and the **treasure chest** (+50)
- Reach the **exit** before the clock hits zero (+100 bonus, plus 20 per remaining second)
- **Monsters** and **spike traps** kill you instantly
- Traps telegraph themselves: safe → warning → active

## Layout

```
index.html          Markup + DOM overlay screens (menu, pause, game over)
css/style.css       Styling and the responsive 5:3 canvas frame
js/
  main.js           Entry point: wires DOM, storage and audio together
  game.js           State machine, timer, scoring, level setup, rendering
  dungeon.js        Procedural generation + BFS reachability validation
  player.js         Movement and axis-separated wall collision
  enemy.js          Wander / chase AI
  trap.js           Spike trap state cycle
  collectible.js    Coins, treasure, exit
  collision.js      Geometry helpers
  ui.js             DOM overlay screens
  audio.js          Web Audio synthesis (all SFX generated at runtime)
  storage.js        localStorage wrapper with graceful failure handling
```

## Notes on the generator

Every dungeon is validated before you play it. Rooms are carved and joined with
corridors, then a BFS from the spawn point proves a path exists; the exit is only
ever picked from tiles that BFS confirmed reachable. Unusable layouts are thrown
away and regenerated. Difficulty scales per level but is capped so a level can
never become impossible inside the 10 second budget.

## License

MIT

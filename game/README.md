# Hex Planet game

The browser game: a small planet of crooked hex cells, gnomes, traders, houses, water, volcanoes, storms, and the AI league spectator.

- `src/main.js`: world, rendering, gameplay, economy, bots, nature
- `src/arena.js`: HexCore language and the league engine (also used by `engine/arena.mjs` at the repository root)
- `src/league.js`: league panel, spectator mode (`?league=watch`) and headless mode (`?league=run`)
- `src/template.html`: page, styles and HUD
- `assets/m.glb`, `assets/f.glb`: the two reduced avatar models

Build:

```bash
npm install
node build.mjs
```

This writes `dist/index.html` (three.js from the CDN) and `test/index.html` (local three.js for offline tests).
The playable build is published at `/play/`, the league spectator at the site root.

`tools/view.py` and `tools/shot.py` take screenshots with headless Chrome. `../tools/econ` holds the token economy simulation.

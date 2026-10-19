# Pinball Construction Machine

Build your own pinball tables in the browser, play them, and rate other people's. A modern take on Bill Budge's *Pinball Construction Set* (1983).

**Status: Phase 2, the editor.** Phase 0 (physics) and Phase 1 (the 3D look) passed their gates on October 18, 2026. Phase 2 builds the table editor.

## Running it

Requires Node 20+.

```bash
npm install
npm run dev        # 3D table at http://127.0.0.1:5280, editor at /editor.html, Physics Lab at /lab.html
npm test           # physics, determinism, and replay tests
npm run typecheck
npm run check      # type-check the Svelte components
```

Other scripts:

```bash
npm run sim                                   # headless smoke run with throughput numbers
npm run verify-replay -- replay.json          # verify a downloaded replay the way the server will
npm run traps -- tables/test-table.json       # drop 200 balls, report anywhere one can get stuck
npx tsx scripts/make-tables.ts                # regenerate the test tables in /tables
```

## The 3D table

Open `http://127.0.0.1:5280`. Same controls as the lab (below), plus `P` pause, `M` sound on/off, `H` hide the help bar. The top-left menus switch table, playfield theme (Midnight, Sunset Strip, Classic 1977), and graphics quality. **Auto** quality starts at High and steps down if the frame rate can't hold about 50 fps; the corner shows the current fps.

## The editor

At `/editor.html`. Top-down editing on the true collider shapes. On the left, the parts palette (drag a part onto the table, or click it to drop one in the middle of the view) and the list of parts on the table; on the right, the inspector: every setting of the selected part, align and distribute for several parts, or the table's own settings (name, size, slope, balls, ball save, theme and colors) when nothing is selected. The **One-way gate** (in Lanes & switches) lets the ball pass only in its arrow's direction; put one across the top of the shooter lane so a ball can't fall back in. The draft autosaves in your browser and every page can open it: **▶ Play** opens it in the 3D player, and the player and Physics Lab list it as **Editor draft** in their table menus (their links between pages keep the current table). In the lab, **Save to table** on the draft writes the tuning back into the draft, and an open editor picks it up as an undoable change.

| Action | How |
| --- | --- |
| Add | Drag from the palette (snaps like a move; hold `⌘` to place freely), or click a palette tile |
| Select | Click; `⇧`-click adds/removes; drag on empty space to box-select |
| Move, resize, rotate | Drag the part; corner handles resize; the top handle rotates |
| Snapping | 5 mm grid, 5° angles, and guides to other parts, the center line, and mirror images. Hold `⌘` to place freely |
| Draw walls | `P` pen: click to add points, drag to pull out a curve, `⇧` locks 15° angles; click the last point or `Enter` to finish, the first point to close; `⌫` takes back a point. The toolbar picks wood wall, steel rail, rubber or plastic. `V` returns to select |
| Reshape walls | Select a wall: drag its points and curve handles (`⌥` breaks a smooth curve); double-click the wall to add a point, a point to switch corner ↔ curve; `⌫` deletes the selected point. The inspector edits point positions and opens/closes the shape |
| Duplicate, mirror | `⌘D` or `⌥`-drag; `M` makes a mirrored copy across the center line; `⇧H` / `⇧V` flip in place |
| Symmetry | `S`: mirror-image pairs (found from their shapes) move, reshape, change settings and delete together, and the pen draws both sides at once |
| Nudge, rotate, resize | Arrows 1 mm (`⇧` 5 mm), `[` `]` 5° (`⇧` 15°), `−` `=` 5% |
| Undo | `⌘Z` / `⇧⌘Z` |
| View | Pinch or wheel to zoom, two-finger scroll or `Space`-drag to pan, `0` to fit |

## The Physics Lab

At `/lab.html`: the 2D tuning and debugging tool.

| Key | Action |
| --- | --- |
| `Z` / `Left Shift` / `←` | Left flipper |
| `/` / `Right Shift` / `→` | Right flipper |
| `Enter` / `↓` | Plunger: hold to pull, release to fire |
| `Space`, `Q`, `E` | Nudge forward, left, right (too much = tilt) |
| `S` | Start a game |
| `B` | Serve an extra ball (multiball testing) |
| Drag on the table | Place a ball and throw it |
| `P`, `.`, `1` `2` `3` | Pause, single-step 1 ms, time scale 1× / ¼× / 1⁄20× |
| `T`, `V`, `W`, `G` | Overlays: trail, velocity vectors, collider wireframe, grid |

The side panel has live telemetry (ball speed, skid, spin, flipper tip speed, launch speed, physics cost per step), sliders for every physics constant, per table (remembered in your browser; **Save to table** writes them into the table file), replay download/playback with score verification, and a loader for custom table JSON.

Two tables ship with the prototype:

- **Test table**: shooter lane and plunger, three pop bumpers, slingshots, top lanes with lane-change, a drop-target bank, standups, posts, inlanes and outlanes.
- **Flipper lab**: just the lower playfield. Drag balls onto the flippers to practice and tune individual shots.

## Layout

```
src/core/          Pure TypeScript, no DOM. Runs in the browser worker and in Node.
  math/            Deterministic sin/cos, seeded RNG, Bézier flattening
  table/format.ts  Table format v1 (the contract between editor, physics, renderer, server)
  physics/         World (the solver), collision geometry, tuning constants
  sim/             Simulation (physics + game rules + inputs), replays
src/worker/        Web Worker running the sim at a fixed 1000 Hz
src/render3d/      3D renderer (three.js): parts built from table data, materials, lighting, camera
src/play/          The 3D play page
src/editor/        The table editor (Svelte UI; model/ holds the tested transform, snap and history logic)
src/shared/        Code shared by the pages (keyboard mapping, the table list and editor draft)
src/debug/         Physics Lab UI: canvas renderer, tuning panel, synthesized sounds
tables/            Hand-built test tables (generated by scripts/make-tables.ts)
tests/             Vitest suites
docs/              Physics notes and table format reference
```

## Docs

- [`docs/physics.md`](docs/physics.md): how the engine works and what to tune
- [`docs/table-format.md`](docs/table-format.md): the v1 table JSON format

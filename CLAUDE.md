# Pinball Construction Machine: notes for Claude

Web app to build, play, and rate pinball tables (reimagining Bill Budge's Pinball Construction Set). Phases 0 (physics) and 1 (3D look, three.js/WebGL2) are done; currently Phase 2: the editor (Svelte 5). Roadmap: Phase 1 look & feel (3D, Three.js), Phase 2 editor, Phase 3 rules & full game, Phase 4 community (Laravel + Forge backend, ddev for local dev).

## Commands

- `make dev`: Laravel + Vite in ddev at https://pinball-construction-machine.ddev.site (3D table `/`, editor `/editor`, Physics Lab `/lab`); `make test` runs Vitest and PHPUnit. See `docs/backend.md`.
- `npm test`: Vitest; must stay green (no ddev needed). `ddev artisan test`: PHPUnit; also green.
- `npm run typecheck` and `npm run check` (svelte-check)
- `npx tsx scripts/make-tables.ts`: regenerate `tables/*.json` (don't hand-edit those files)

## Rules

- `src/core/` is pure TypeScript with no DOM; it runs in the worker and in Node (server-side replay verification).
- Determinism is a hard requirement. In anything that runs during a physics step: no `Math.sin/cos/atan2/exp/pow/hypot/random`, no `Date`/wall clock, fixed iteration order. Use `dsin`/`dcos` (`math/dmath.ts`) and `Rng`. See `docs/physics.md`.
- Every physics constant goes in `physics/tuning.ts` with a slider spec, not inline.
- Bump `TABLE_VERSION` and add a migration only for changes that break existing tables (renaming or removing a field, changing what a value means). Additive changes (a new part type, a new optional field) keep the version: every existing table still loads unchanged.
- Changing the physics changes replay outcomes; that's expected while in Phase 0, but note it in the commit message.
- Units are SI (meters, kg, s). Table angles are degrees clockwise from +x; internal angles are radians.
- `src/render3d/` only follows physics snapshots; it never affects the simulation. Build part meshes in table space (x, height, table y) from the same data the physics uses, so visuals match colliders.
- Rendering budget: 60 fps on integrated laptop GPUs. One material per mesh (call `clearGroups()`), no transmission materials, light intensities in physical units (key light ≈ 3 lux on the playfield). Bright highlights are clamped before bloom; keep bloom for emissive lamps only.
- Editor: Svelte only for the UI chrome (panels, toolbar); canvas and model logic are plain TS. Keep `src/editor/model/` DOM-free and unit-tested. The table is replaced immutably on each edit (history = whole-table snapshots); drags commit one history entry.
- Backend: Laravel at the repo root, Blade shells in `resources/views/` load the TS entries with `@vite`. Pages get server state as inline JSON (`#pcm-session`, read by `src/shared/session.ts`), not an extra request. Physics workers must be started with the literal `new Worker(new URL(...), { type: 'module' })` pattern; `src/shared/dev-worker.ts` makes that work cross-origin in dev.
- Check in with John before pushing to main or other significant actions.

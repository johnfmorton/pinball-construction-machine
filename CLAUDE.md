# Pinball Construction Machine: notes for Claude

Web app to build, play, and rate pinball tables (reimagining Bill Budge's Pinball Construction Set). Currently Phase 0: physics prototype with a debug renderer. Roadmap: Phase 1 look & feel (3D, Three.js), Phase 2 editor, Phase 3 rules & full game, Phase 4 community (Laravel + Forge backend, ddev for local dev).

## Commands

- `npm run dev`: Physics Lab (Vite)
- `npm test`: Vitest; must stay green
- `npm run typecheck`
- `npx tsx scripts/make-tables.ts`: regenerate `tables/*.json` (don't hand-edit those files)

## Rules

- `src/core/` is pure TypeScript with no DOM; it runs in the worker and in Node (server-side replay verification).
- Determinism is a hard requirement. In anything that runs during a physics step: no `Math.sin/cos/atan2/exp/pow/hypot/random`, no `Date`/wall clock, fixed iteration order. Use `dsin`/`dcos` (`math/dmath.ts`) and `Rng`. See `docs/physics.md`.
- Every physics constant goes in `physics/tuning.ts` with a slider spec, not inline.
- Changing the table format means bumping `TABLE_VERSION` and adding a migration.
- Changing the physics changes replay outcomes; that's expected while in Phase 0, but note it in the commit message.
- Units are SI (meters, kg, s). Table angles are degrees clockwise from +x; internal angles are radians.
- Check in with John before pushing to main or other significant actions.

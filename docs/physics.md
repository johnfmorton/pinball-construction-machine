# Physics engine

A small, purpose-built pinball solver. It is not a general rigid-body library: it knows the playfield is a tilted plane, the ball is a sphere, and the flippers are rotating tapered capsules, and it uses that to be both accurate and fast (~12 µs per step on a laptop, so about 1% of one core at 1000 Hz).

## Units and coordinates

SI units throughout: meters, kilograms, seconds. The origin is the playfield's top-left corner, +x points right, +y points down the slope toward the player. The slope (6.5° by default) is folded into gravity: the ball feels `g·sin(slope)` along +y and `g·cos(slope)` pressing it into the playfield (which sets floor friction).

A standard ball is 27 mm across (`ballRadius` 0.0135) and weighs 80 g.

## The step

`World.step()` advances exactly 1 ms. In order:

1. **Flippers.** Each flipper integrates its swing from coil torque (while swinging up), hold torque (at end of stroke), or return-spring torque (released). End stops clamp the swing with a small bounce.
2. **Plunger.** While held, it retracts at a fixed speed; when released, a spring drives it back and it carries the ball with it.
3. **Ball forces.** Gravity, then floor friction: the ball carries a 3D angular velocity, and the contact point's slip against the playfield is driven to zero by kinetic friction. A ball that's thrown or bounced *skids*, then starts rolling. Rolling resistance and spin damping bleed off energy slowly.
4. **Continuous collision.** The ball moves along its path, stopping at the earliest contact:
   - static parts (walls, posts, bumpers, slings, targets) are all capsules, tested with exact swept-circle math;
   - the plunger is a capsule tested in its own moving frame;
   - flippers use conservative advancement against the rotating tapered shape, so a ball can't slip through even a fast-swinging flipper.
   
   At each contact an impulse is applied, then the ball continues with the remaining time (up to 8 contacts per step).
5. **Safety pass.** If rounding ever leaves a ball overlapping something, it's pushed out (tests assert this never exceeds 0.1 mm).
6. **Ball–ball** collisions, then **sensors** (rollovers, drains).

## Impulses

Every contact uses the same model:

- **Restitution** falls off with impact speed, like real rubber: `e = elasticity / (1 + falloff·|vn|)`. Impacts slower than `restingSpeed` don't bounce at all, which is what lets balls settle.
- **Friction** is Coulomb-limited and acts at the contact point, so it changes both the ball's velocity and its spin (`wz`, "english"). The 7/2 factor in the tangential effective mass is the solid-sphere result.
- **Flippers have mass.** The flipper is a rigid body with inertia, so a hard hit pushes it back, and a ball resting on a moving flipper is carried by it. When the flipper sits against a stop and the coil (or return spring) can hold it there, it behaves as immovable. That distinction is what makes cradling stable while still letting a heavy hit deflect a held flipper.
- **Kickers.** Pop bumpers add speed along the contact normal; slingshots add speed along their face normal, and only for a real hit on the rubber face.

## Determinism

The same table, tuning, seed and inputs always produce the same game, bit for bit. That's what allows high scores to be verified on the server: the client uploads its inputs (a replay), the server re-runs them, and the score must match exactly.

Rules for code under `src/core/`:

- Use only `+ - * /`, `Math.sqrt`, `Math.abs`, `Math.min/max`, `Math.floor/round`, comparisons. These are exact in every engine.
- **Never** use `Math.sin/cos/tan/atan2/exp/pow/hypot/random` in anything that runs during a step. Use `dsin`/`dcos` from `math/dmath.ts` and the seeded `Rng`.
- Iterate in a fixed order. The broadphase sorts its candidate list for this reason.
- No wall-clock time, no `Date`, no async inside the sim.

## Tuning

Every constant is in `src/core/physics/tuning.ts` and has a slider in the Physics Lab. The defaults are educated guesses from real-machine numbers. Phase 0's gate is getting them to *feel* right. Things worth checking against real-table reference video:

| Behavior | Where to look | Current default |
| --- | --- | --- |
| Flipper stroke time | coil torque / inertia | ~30 ms |
| Flipper return time | return torque | ~50 ms |
| Mid-flipper shot speed | inertia, coil torque, flipper rubber | ~4.3 m/s |
| Full-plunge launch | plunger spring / mass | ~5.3 m/s |
| Skid to roll after a bounce | floor slide friction | ~0.3 s for a 1.5 m/s skid |
| Post and sling liveliness | material elasticity, falloff | `table/format.ts` |
| Pop bumper violence | bumper kick / threshold | 1.6 m/s |

Things the tests pin down (see `tests/physics.test.ts`): rolling acceleration of 5/7·g·sinθ, the 5/7 skid-to-roll speed, no tunneling at 12 m/s through a 6 mm guide, stable cradles, stroke time, shot speed, plunger strength, center drains, and exact replay reproduction.

## Known limits (intended for later phases)

- Single level only. Parts carry a `z` field, but ramps and upper playfields need height-aware physics.
- The ball never leaves the playfield (no jumps or airballs).
- Spinners, kickout holes, magnets, gates and diverters aren't implemented yet.
- Ball–ball contacts are discrete; very fast head-on multiball collisions could overlap for a step.

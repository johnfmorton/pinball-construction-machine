# Table format (v1)

A table is one JSON document. The editor writes it, the physics engine and renderer read it, and the server stores it as immutable published versions. The TypeScript definition is the source of truth: [`src/core/table/format.ts`](../src/core/table/format.ts).

## Conventions

- Units are meters. A standard playfield is about 0.51 × 1.07 m.
- Origin is the playfield's top-left corner; +x right, +y toward the player.
- Angles are degrees, clockwise from +x (because +y points down). `0` faces right, `90` faces the player, `180` faces left.
- Every part has a unique `id`. Optional on all parts: `points`, `group`, `label`, and `z` (base elevation, reserved for ramps and upper playfields; v1 physics ignores it).
- Breaking changes bump `version` and get a migration.

## Top level

```json
{
  "format": "pcm-table",
  "version": 1,
  "meta": { "name": "My Table", "author": "John", "description": "…" },
  "dimensions": { "width": 0.51, "length": 1.07, "slope": 6.5 },
  "rules": { "ballsPerGame": 3, "ballSave": 8 },
  "physics": { "bumperKick": 2.2 },
  "materials": { "rubber": { "elasticity": 0.85 } },
  "parts": [ … ]
}
```

`physics` holds the table's own physics settings: only the ones that differ from the engine defaults in [`physics/tuning.ts`](../src/core/physics/tuning.ts), for example `{ "bumperKick": 2.2, "flipperCoilTorque": 4 }`. They're part of the table, so a published table's physics are fixed along with its layout, and high scores are verified with them. A replay recorded with different settings still re-simulates, but isn't eligible for the table's high scores.

`materials` optionally overrides the presets (`rubber`, `postRubber`, `flipperRubber`, `metal`, `wood`, `plastic`, `target`), each with `elasticity`, `falloff`, `friction`.

## Parts

| `type` | Fields | Notes |
| --- | --- | --- |
| `wall` | `path`, `thickness`, `material`, `height?` | Freeform wall, rail, or guide. Ends and joints are rounded. |
| `flipper` | `side`, `pivot`, `length`, `baseRadius`, `tipRadius`, `restAngle`, `stroke`, `strength?`, `input?` | `stroke` is the swing in degrees. |
| `post` | `pos`, `radius`, `material` | Rubber post or metal peg. |
| `bumper` | `pos`, `radius`, `kick?` | Pop bumper. `kick` overrides the global kick (m/s). |
| `slingshot` | `a`, `b`, `c`, `kick?` | Triangle; the `a→b` edge is the kicking rubber. |
| `standupTarget` | `pos`, `angle`, `width` | `angle` is the direction the face points. |
| `dropTarget` | `pos`, `angle`, `width`, `group?` | Drops when hit; a completed `group` scores a bonus and resets. |
| `rollover` | `pos`, `radius?`, `group?` | Lane switch. The `toplanes` group gets lane-change and a multiplier. |
| `drain` | `pos`, `halfSize` | Axis-aligned rectangle; a ball entering it is lost. |
| `plunger` | `pos`, `width`, `maxPull` | `pos` is the tip at rest. |
| `ballStart` | `pos` | Where new balls appear (exactly one per table). |

### Paths

Walls use a pen-tool style path: a start point, then `line`, `quad`, or `cubic` Bézier segments.

```json
{
  "id": "orbit",
  "type": "wall",
  "thickness": 0.006,
  "material": "metal",
  "path": {
    "start": [0.05, 0.6],
    "cmds": [
      { "op": "line", "to": [0.05, 0.3] },
      { "op": "cubic", "c1": [0.05, 0.1], "c2": [0.2, 0.05], "to": [0.3, 0.05] }
    ],
    "closed": false
  }
}
```

Curves are flattened to short straight pieces (0.8 mm tolerance) when the table loads.

## Validation

`validateTable()` checks structure (format/version, unique ids, one `ballStart`, at least one drain and flipper). `findTraps()` (`src/core/table/traps.ts`, or `npm run traps -- table.json`) is the geometry check: it flood-fills the area a ball can reach from the ball start, drops balls at random spots inside it with the flippers idle, and reports any ball that comes to rest instead of draining (resting on the plunger is allowed). It runs with drop targets up and down. The editor will run it before a table can be published.

A common trap is a ledge: a part mounted close to a wall, with a gap narrower than the ball (27 mm). A ball rolling down the wall lands on the part's top end and stays there. Real tables fix this with a sloped deflector from the wall to the part; see `standup-deflector` and `drop-deflector` in the test table.

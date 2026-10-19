/**
 * Generates the hand-built Phase 0 test tables in /tables.
 * Run: npx tsx scripts/make-tables.ts
 *
 * Built in code (rather than by hand in JSON) so left/right parts are exact
 * mirror images. Once the editor exists, tables will be authored there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Part, TableDef } from '../src/core/table/format.ts';
import type { Vec2 } from '../src/core/math/bezier.ts';

const W = 0.51;
const L = 1.07;
const AXIS = 0.236; // mirror axis of the playfield (excluding the shooter lane)
const mx = (x: number) => +(2 * AXIS - x).toFixed(5);
const mv = (v: Vec2): Vec2 => [mx(v[0]), v[1]];

function mirrorPart(p: Part, id: string): Part {
  const q = structuredClone(p) as Part & Record<string, unknown>;
  q.id = id;
  switch (q.type) {
    case 'wall':
      q.path.start = mv(q.path.start);
      q.path.cmds = q.path.cmds.map((c) =>
        c.op === 'line' ? { ...c, to: mv(c.to) } : c.op === 'quad' ? { ...c, c: mv(c.c), to: mv(c.to) } : { ...c, c1: mv(c.c1), c2: mv(c.c2), to: mv(c.to) },
      );
      break;
    case 'flipper':
      q.pivot = mv(q.pivot);
      q.restAngle = 180 - q.restAngle;
      q.side = q.side === 'left' ? 'right' : 'left';
      q.input = q.side;
      break;
    case 'slingshot':
      // keep a→b as the kicking face
      q.a = mv(q.a);
      q.b = mv(q.b);
      q.c = mv(q.c);
      break;
    case 'standupTarget':
    case 'dropTarget':
    case 'gate':
      q.pos = mv(q.pos);
      q.angle = 180 - q.angle;
      break;
    case 'post':
    case 'bumper':
    case 'rollover':
    case 'drain':
    case 'plunger':
    case 'ballStart':
      q.pos = mv(q.pos);
      break;
  }
  return q;
}

function line(id: string, pts: Vec2[], thickness: number, material: 'wood' | 'metal' | 'plastic' | 'rubber'): Part {
  return {
    id,
    type: 'wall',
    thickness,
    height: material === 'metal' ? 0.025 : 0.05,
    material,
    path: { start: pts[0], cmds: pts.slice(1).map((to) => ({ op: 'line' as const, to })) },
  };
}

/** Lower playfield shared by both tables: flippers, slings, inlane guides. */
function lowerPlayfield(): Part[] {
  const leftFlipper: Part = {
    id: 'flipper-left',
    type: 'flipper',
    side: 'left',
    input: 'left',
    pivot: [0.15, 0.925],
    length: 0.072,
    baseRadius: 0.0095,
    tipRadius: 0.005,
    restAngle: 30,
    stroke: 55,
  };
  const leftGuide = line('guide-left', [[0.035, 0.68], [0.035, 0.835], [0.14, 0.905]], 0.006, 'metal');
  const leftSling: Part = { id: 'sling-left', type: 'slingshot', a: [0.075, 0.69], b: [0.13, 0.85], c: [0.075, 0.815], points: 10 };
  const left = [leftFlipper, leftGuide, leftSling];
  return [
    ...left,
    mirrorPart(leftFlipper, 'flipper-right'),
    mirrorPart(leftGuide, 'guide-right'),
    mirrorPart(leftSling, 'sling-right'),
    { id: 'drain', type: 'drain', pos: [AXIS, 1.045], halfSize: [AXIS, 0.03] },
  ];
}

function cabinet(withShooterLane: boolean): Part[] {
  const t = 0.012;
  const o = t / 2;
  const parts: Part[] = [
    {
      id: 'outer-wall',
      type: 'wall',
      thickness: t,
      height: 0.06,
      material: 'wood',
      path: {
        start: [-o, L + 0.01],
        cmds: [
          { op: 'line', to: [-o, 0.28] },
          { op: 'cubic', c1: [-o, -0.04], c2: [W + o, -0.04], to: [W + o, 0.28] },
          { op: 'line', to: [W + o, L + 0.01] },
        ],
      },
    },
    line('bottom-wall', [[-o, L + o], [W + o, L + o]], t, 'wood'),
  ];
  if (withShooterLane) {
    parts.push(line('shooter-lane-wall', [[0.475, 0.36], [0.475, L + 0.01]], 0.006, 'wood'));
    parts.push({ id: 'plunger', type: 'plunger', pos: [0.494, 1.0], width: 0.026, maxPull: 0.06 });
    parts.push({ id: 'ball-start', type: 'ballStart', pos: [0.494, 0.983] });
  } else {
    // flipper lab: close the right side where the lane would be
    // a solid block filling the unused shooter-lane space
    parts.push(line('lab-right-wall', [[0.493, 0.25], [0.493, L + 0.01]], 0.036, 'wood'));
  }
  return parts;
}

function classic(): TableDef {
  const parts: Part[] = [...cabinet(true), ...lowerPlayfield()];

  // pop bumpers
  parts.push(
    { id: 'bumper-1', type: 'bumper', pos: [0.16, 0.28], radius: 0.028, points: 100 },
    { id: 'bumper-2', type: 'bumper', pos: [0.31, 0.28], radius: 0.028, points: 100 },
    { id: 'bumper-3', type: 'bumper', pos: [0.235, 0.37], radius: 0.028, points: 100 },
  );

  // top lanes
  for (const [i, x] of [0.17, 0.215, 0.26, 0.305].entries()) {
    parts.push(line(`toplane-guide-${i + 1}`, [[x, 0.11], [x, 0.165]], 0.006, 'metal'));
  }
  for (const [i, x] of [0.1925, 0.2375, 0.2825].entries()) {
    parts.push({ id: `toplane-${i + 1}`, type: 'rollover', pos: [x, 0.14], radius: 0.012, points: 500, group: 'toplanes' });
  }

  // drop target bank on the right, facing left, with a backstop
  for (const [i, y] of [0.46, 0.49, 0.52].entries()) {
    parts.push({ id: `drop-${i + 1}`, type: 'dropTarget', pos: [0.44, y], angle: 180, width: 0.026, points: 250, group: 'drops' });
  }
  // Sloped deflector from the shooter-lane wall to the top target, so a ball
  // rolling down the wall is turned back onto the playfield instead of landing
  // on a ledge, plus a backstop behind the bank.
  parts.push(line('drop-deflector', [[0.472, 0.405], [0.441, 0.444]], 0.006, 'metal'));
  parts.push(line('drop-backstop', [[0.455, 0.452], [0.455, 0.55], [0.472, 0.565]], 0.006, 'wood'));

  // standup targets on the left, with a deflector so balls can't perch on top
  parts.push(line('standup-deflector', [[-0.003, 0.398], [0.019, 0.436]], 0.006, 'metal'));
  for (const [i, y] of [0.45, 0.49].entries()) {
    parts.push({ id: `standup-${i + 1}`, type: 'standupTarget', pos: [0.02, y], angle: 0, width: 0.024, points: 300 });
  }

  // mid-field rubber posts
  parts.push(
    { id: 'post-1', type: 'post', pos: [0.1, 0.6], radius: 0.008, material: 'postRubber', points: 10 },
    { id: 'post-2', type: 'post', pos: [0.37, 0.62], radius: 0.008, material: 'postRubber', points: 10 },
  );

  // inlane / outlane rollovers
  const lanes: Part[] = [
    { id: 'outlane-left', type: 'rollover', pos: [0.016, 0.88], radius: 0.012, points: 1000 },
    { id: 'inlane-left', type: 'rollover', pos: [0.0545, 0.76], radius: 0.012, points: 500 },
  ];
  parts.push(...lanes, mirrorPart(lanes[0], 'outlane-right'), mirrorPart(lanes[1], 'inlane-right'));

  return {
    format: 'pcm-table',
    version: 1,
    meta: { name: 'Phase 0 Test Table', author: 'Pinball Construction Machine', description: 'Hand-built table for physics tuning.' },
    dimensions: { width: W, length: L, slope: 6.5 },
    rules: { ballsPerGame: 3, ballSave: 8 },
    parts,
  };
}

function flipperLab(): TableDef {
  return {
    format: 'pcm-table',
    version: 1,
    meta: { name: 'Flipper Lab', author: 'Pinball Construction Machine', description: 'Flippers and slings only. Drop balls with the mouse to test shots.' },
    dimensions: { width: W, length: L, slope: 6.5 },
    rules: { ballsPerGame: 99, ballSave: 0 },
    parts: [...cabinet(false), ...lowerPlayfield(), { id: 'ball-start', type: 'ballStart', pos: [0.08, 0.6] }],
  };
}

/** Write a table, keeping any `physics` block already saved into the file from the lab. */
function write(file: string, t: TableDef): void {
  const url = new URL(`../tables/${file}`, import.meta.url);
  if (existsSync(url)) {
    const prev = JSON.parse(readFileSync(url, 'utf8')) as TableDef;
    if (prev.physics && Object.keys(prev.physics).length) t = { ...t, physics: prev.physics };
  }
  writeFileSync(url, JSON.stringify(t, null, 2) + '\n');
}

write('test-table.json', classic());
write('flipper-lab.json', flipperLab());
console.log('wrote tables/test-table.json and tables/flipper-lab.json');

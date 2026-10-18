/**
 * Ball-trap finder. Drops balls all over the table with the flippers down
 * and reports any that come to rest instead of draining. With the flippers
 * idle, every ball on a well-built table should eventually reach a drain
 * (the shooter lane plunger is the one legitimate resting place).
 *
 * This is the "drop 100 balls" check from the plan; the editor will run it
 * before a table can be published.
 */
import { World } from '../physics/world.ts';
import { DEFAULT_TUNING, type Tuning } from '../physics/tuning.ts';
import { Rng } from '../math/rng.ts';
import type { TableDef } from './format.ts';

export interface Trap {
  x: number;
  y: number;
  /** Where the ball was dropped. */
  fromX: number;
  fromY: number;
  /** Parts within reach of the resting ball. */
  near: string[];
}

export interface TrapReport {
  dropped: number;
  drained: number;
  /** Balls that rolled into the shooter lane and rest on the plunger (fine). */
  onPlunger: number;
  traps: Trap[];
}

export function findTraps(table: TableDef, opts: { balls?: number; seed?: number; seconds?: number; tuning?: Tuning; dropTargetsDown?: boolean } = {}): TrapReport {
  const n = opts.balls ?? 200;
  const rng = new Rng(opts.seed ?? 7);
  const W = table.dimensions.width;
  const L = table.dimensions.length;
  const tuning = opts.tuning ?? DEFAULT_TUNING;
  const R = tuning.ballRadius;
  const report: TrapReport = { dropped: 0, drained: 0, onPlunger: 0, traps: [] };
  const plungers = table.parts.filter((p) => p.type === 'plunger');

  const reach = reachable(table, tuning);
  for (let i = 0; i < n; i++) {
    const w = new World(table, tuning);
    if (opts.dropTargetsDown) for (const c of w.statics) if (c.behavior === 'drop') c.enabled = false;
    const x = rng.range(R * 1.5, W - R * 1.5);
    const y = rng.range(0.05, L * 0.8);
    const vx = rng.range(-1.5, 1.5);
    const vy = rng.range(-1.5, 1);
    // only drop where a ball can actually get to
    if (!reach.has(x, y) || w.overlaps(x, y, R)) continue;
    // skip drops inside the shooter lane (balls rightly rest on the plunger there)
    if (plungers.some((p) => Math.abs(x - p.pos[0]) < p.width)) continue;
    report.dropped++;
    const b = w.addBall(x, y, vx, vy);
    let still = 0;
    let drained = false;
    for (let s = 0; s < (opts.seconds ?? 20) * 1000; s++) {
      w.step();
      if (!w.balls.includes(b)) {
        drained = true;
        break;
      }
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      still = sp < 0.01 ? still + 1 : 0;
      if (still > 1500) break; // motionless for 1.5 s
    }
    // resting on the plunger in the shooter lane is fine
    const onPlunger = w.plungers.some((p) => Math.abs(b.x - p.x) < p.halfW + R && b.y > p.restY - 0.05);
    if (drained) report.drained++;
    else if (onPlunger) report.onPlunger++;
    else report.traps.push({ x: b.x, y: b.y, fromX: x, fromY: y, near: w.partsNear(b.x, b.y, R + 0.004) });
  }
  return report;
}

/**
 * Flood-fill the area a ball can reach from the ball start, on a 4 mm grid,
 * treating any cell where a ball would overlap geometry as solid.
 */
export function reachable(table: TableDef, tuning: Tuning = DEFAULT_TUNING): { has(x: number, y: number): boolean } {
  const cell = 0.004;
  const W = table.dimensions.width;
  const L = table.dimensions.length;
  const nx = Math.ceil(W / cell);
  const ny = Math.ceil(L / cell);
  const w = new World(table, tuning);
  const R = tuning.ballRadius * 0.98;
  const state = new Uint8Array(nx * ny); // 0 unknown, 1 open, 2 solid
  const start = table.parts.find((p) => p.type === 'ballStart');
  const seen = new Uint8Array(nx * ny);
  if (start && start.type === 'ballStart') {
    const q: number[] = [];
    const push = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= nx || j >= ny) return;
      const k = j * nx + i;
      if (seen[k]) return;
      seen[k] = 1;
      if (w.overlaps((i + 0.5) * cell, (j + 0.5) * cell, R)) {
        state[k] = 2;
        return;
      }
      state[k] = 1;
      q.push(i, j);
    };
    push(Math.floor(start.pos[0] / cell), Math.floor(start.pos[1] / cell));
    while (q.length) {
      const j = q.pop()!;
      const i = q.pop()!;
      push(i + 1, j);
      push(i - 1, j);
      push(i, j + 1);
      push(i, j - 1);
    }
  }
  return {
    has(x: number, y: number) {
      const i = Math.floor(x / cell);
      const j = Math.floor(y / cell);
      return i >= 0 && j >= 0 && i < nx && j < ny && state[j * nx + i] === 1;
    },
  };
}

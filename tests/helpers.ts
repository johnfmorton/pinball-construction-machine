import { readFileSync } from 'node:fs';
import type { TableDef } from '../src/core/table/format.ts';
import { Simulation } from '../src/core/sim/simulation.ts';
import { DEFAULT_TUNING, type Tuning } from '../src/core/physics/tuning.ts';

export function loadTable(name: 'test-table' | 'flipper-lab'): TableDef {
  return JSON.parse(readFileSync(new URL(`../tables/${name}.json`, import.meta.url), 'utf8')) as TableDef;
}

export function sim(name: 'test-table' | 'flipper-lab', tuning: Partial<Tuning> = {}, seed = 1): Simulation {
  return new Simulation(loadTable(name), { ...DEFAULT_TUNING, ...tuning }, seed);
}

export function run(s: Simulation, ms: number, each?: (s: Simulation) => void): void {
  for (let i = 0; i < ms; i++) {
    s.step();
    each?.(s);
  }
}

export function speed(s: Simulation, i = 0): number {
  const b = s.world.balls[i];
  return b ? Math.sqrt(b.vx * b.vx + b.vy * b.vy) : 0;
}

/** A crude but deterministic player: flips when a ball is over a flipper. */
export function bot(s: Simulation): void {
  for (const f of s.world.flippers) {
    const near = s.world.balls.some((b) => Math.abs(b.x - f.px) < 0.09 && b.y > 0.85 && b.y < 0.93 && b.vy > 0);
    const key = f.input === 'left' ? 'flipperLeft' : 'flipperRight';
    if (near && !f.pressed) s.input(key, 1);
    if (!near && f.pressed && f.phase >= f.stroke) s.input(key, 0);
  }
}

/** Snapshot of all state that matters, as a string, for exact comparisons. */
export function fingerprint(s: Simulation): string {
  const w = s.world;
  return JSON.stringify({
    step: s.steps,
    score: s.state.score,
    ball: s.state.ball,
    balls: w.balls.map((b) => [b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz]),
    flippers: w.flippers.map((f) => [f.phase, f.phaseVel]),
    plungers: w.plungers.map((p) => [p.y, p.vy]),
  });
}

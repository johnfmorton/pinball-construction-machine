import { describe, expect, it } from 'vitest';
import type { Part, TableDef } from '../src/core/table/format.ts';
import { validateTable } from '../src/core/table/format.ts';
import { World, type PhysEvent } from '../src/core/physics/world.ts';
import { DEFAULT_TUNING } from '../src/core/physics/tuning.ts';
import { Simulation } from '../src/core/sim/simulation.ts';
import { findTraps } from '../src/core/table/traps.ts';
import { loadTable } from './helpers.ts';

/** The shooter-lane gate as a player would place it: angled so a ball landing on it rolls off onto the playfield. */
export const LANE_GATE: Part = { id: 'lane-gate', type: 'gate', pos: [0.4935, 0.352], angle: -113, width: 0.042, points: 10 };

function withGate(): TableDef {
  const t = loadTable('test-table');
  return { ...t, parts: [...t.parts, LANE_GATE] };
}

/** A bare box with one gate across the middle, passing upward (−y). */
function box(): TableDef {
  const t = loadTable('flipper-lab');
  return { ...t, parts: [...t.parts, { id: 'g', type: 'gate', pos: [0.24, 0.3], angle: -90, width: 0.2 }] };
}

function runBall(w: World, ms: number): PhysEvent[] {
  const evs: PhysEvent[] = [];
  for (let i = 0; i < ms; i++) {
    w.step();
    evs.push(...w.events);
    w.events.length = 0;
  }
  return evs;
}

describe('one-way gate', () => {
  it('is a valid part', () => {
    expect(validateTable(withGate())).toEqual([]);
  });

  it('lets a ball through in the pass direction and reports it', () => {
    const w = new World(box(), { ...DEFAULT_TUNING, tableVibration: 0 });
    const b = w.addBall(0.24, 0.36, 0, -2);
    const evs = runBall(w, 60);
    expect(b.y).toBeLessThan(0.3 - 0.015);
    expect(evs.some((e) => e.type === 'gate' && e.partId === 'g')).toBe(true);
  });

  it('blocks a ball coming back the other way', () => {
    const w = new World(box(), { ...DEFAULT_TUNING, tableVibration: 0 });
    const b = w.addBall(0.24, 0.24, 0, 2);
    const evs = runBall(w, 80);
    expect(b.y).toBeLessThan(0.3);
    expect(b.vy).toBeLessThan(0); // bounced back up
    expect(evs.some((e) => e.type === 'hit' && e.partId === 'g')).toBe(true);
    expect(evs.some((e) => e.type === 'gate')).toBe(false);
  });

  it('a ball too slow to clear it falls back the way it came', () => {
    const w = new World(box(), { ...DEFAULT_TUNING, tableVibration: 0 });
    const b = w.addBall(0.24, 0.33, 0, -0.35);
    const evs = runBall(w, 1500);
    expect(b.y).toBeGreaterThan(0.3);
    expect(evs.some((e) => e.type === 'gate')).toBe(false);
  });

  it('across the shooter lane: launched balls get out and never fall back into the lane', () => {
    const t = withGate();
    let escaped = 0;
    for (const pull of [0.03, 0.045, 0.06]) {
      for (let seed = 1; seed <= 4; seed++) {
        const s = new Simulation(t, DEFAULT_TUNING, seed);
        s.input('startGame', 1);
        for (let i = 0; i < 200; i++) s.step();
        s.input('plunger', 1);
        while (s.world.plungers[0].y < s.world.plungers[0].restY + pull) s.step();
        s.input('plunger', 0);
        let through = false;
        const id = s.world.balls[0].id;
        for (let i = 0; i < 6000; i++) {
          s.step();
          const b = s.world.balls.find((x) => x.id === id);
          if (!b) break; // drained
          if (b.y < 0.3) through = true;
          // once out, the ball must stay out of the lane (x > 0.478, below the gate)
          if (through) expect(b.x > 0.481 && b.y > 0.38).toBe(false);
        }
        if (through) escaped++;
      }
    }
    expect(escaped).toBeGreaterThan(8);
  });

  it('awards its points when a ball goes through', () => {
    const s = new Simulation(withGate(), DEFAULT_TUNING, 1);
    s.input('startGame', 1);
    for (let i = 0; i < 200; i++) s.step();
    s.input('plunger', 1);
    while (s.world.plungers[0].y < s.world.plungers[0].restY + 0.06) s.step();
    s.input('plunger', 0);
    let gated = false;
    for (let i = 0; i < 400 && !gated; i++) {
      s.step();
      gated = s.drainEvents().some((e) => e.type === 'score' && e.partId === 'lane-gate');
    }
    expect(gated).toBe(true);
  });

  it('adds no ball traps to the test table', () => {
    const r = findTraps(withGate(), { balls: 150 });
    expect(r.traps).toEqual([]);
  });
});

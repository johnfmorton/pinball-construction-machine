import { describe, expect, it } from 'vitest';
import { World } from '../src/core/physics/world.ts';
import { DEFAULT_TUNING } from '../src/core/physics/tuning.ts';
import { loadTable } from './helpers.ts';

/** Every round "top" a ball could balance on: post caps, sling corners, bumpers. */
function perches(): { name: string; x: number; y: number; r: number }[] {
  const t = loadTable('test-table');
  const out: { name: string; x: number; y: number; r: number }[] = [];
  for (const p of t.parts) {
    if (p.type === 'post') out.push({ name: p.id, x: p.pos[0], y: p.pos[1], r: p.radius });
    if (p.type === 'bumper') out.push({ name: p.id, x: p.pos[0], y: p.pos[1], r: p.radius });
    if (p.type === 'slingshot') for (const [i, v] of [p.a, p.b, p.c].entries()) out.push({ name: `${p.id}[${i}]`, x: v[0], y: v[1], r: 0.004 });
  }
  return out;
}

function settle(vibration: number, perch: { x: number; y: number; r: number }): number {
  const R = DEFAULT_TUNING.ballRadius;
  const w = new World(loadTable('test-table'), { ...DEFAULT_TUNING, tableVibration: vibration });
  // directly up-table of the part, 0.05 mm off center, at rest
  const b = w.addBall(perch.x + 0.00005, perch.y - (perch.r + R + 1e-5), 0, 0);
  const x0 = b.x;
  const y0 = b.y;
  for (let i = 0; i < 2000; i++) w.step();
  const live = w.balls.find((q) => q.id === b.id);
  return live ? Math.hypot(live.x - x0, live.y - y0) : Infinity;
}

describe('no perfect balancing', () => {
  it('without vibration, a ball can balance on a post (the bug this guards against)', () => {
    const sling = perches().find((p) => p.name === 'sling-right[0]')!;
    expect(settle(0, sling)).toBeLessThan(0.02); // never rolls off within 2 s
  });

  it('with cabinet vibration, a ball placed on top of any post, sling corner or bumper rolls off', () => {
    for (const p of perches()) {
      const moved = settle(DEFAULT_TUNING.tableVibration, p);
      expect(moved, p.name).toBeGreaterThan(0.02);
    }
  });
});

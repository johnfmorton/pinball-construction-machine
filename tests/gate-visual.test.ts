import { describe, expect, it } from 'vitest';
import { gateLift, type Gate } from '../src/render3d/table3d.ts';

// a gate along the x axis at y = 0.3, passing toward −y
const g = { ax: 0.2, ay: 0.3, bx: 0.28, by: 0.3, nx: 0, ny: -1 } as Gate;

/** Roll a ball through at 1 m/s, letting the flap fall at the renderer's rate, 1 ms frames. */
function pass(): number[] {
  const angles: number[] = [];
  let a = 0;
  for (let y = 0.33; y > 0.24; y -= 0.001) {
    a = gateLift(g, 0.24, y, Math.max(0, a - 0.001 * 9));
    angles.push(a);
  }
  return angles;
}

describe('gate flap (visual)', () => {
  it('hangs shut with no ball nearby', () => {
    expect(gateLift(g, 0.24, 0.36)).toBe(0);
    expect(gateLift(g, 0.24, 0.2)).toBe(0);
    expect(gateLift(g, 0.35, 0.3)).toBe(0); // beside the gate
  });

  it('swings open over a passing ball and moves smoothly', () => {
    const a = pass();
    expect(Math.max(...a)).toBeGreaterThan(0.8);
    for (let i = 1; i < a.length; i++) expect(Math.abs(a[i] - a[i - 1])).toBeLessThan(0.3);
  });

  it('never cuts into the ball on the way down', () => {
    let a = 1.4; // flap still up, ball just past the hinge
    for (let y = 0.29; y > 0.25; y -= 0.0005) {
      a = gateLift(g, 0.24, y, Math.max(0, a - 0.05));
      // re-asking from the same angle must not need to lift it any further
      expect(gateLift(g, 0.24, y, a)).toBe(a);
    }
  });
});

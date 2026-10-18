import { describe, expect, it } from 'vitest';
import { taperedCapsuleDistance } from '../src/core/physics/geometry.ts';

/**
 * Independent reference: distance from an exterior point P to a convex set is
 * max over unit directions d of (d·P − h(d)), where h is the support function.
 * For the hull of two circles, h(d) = max(d·A + rA, d·B + rB).
 */
function reference(px: number, py: number, ax: number, ay: number, ra: number, bx: number, by: number, rb: number): number {
  let best = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const a = (i / 20000) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const h = Math.max(dx * ax + dy * ay + ra, dx * bx + dy * by + rb);
    best = Math.max(best, dx * px + dy * py - h);
  }
  return best;
}

describe('flipper collision shape', () => {
  it('matches the true hull of the base and tip circles', () => {
    const L = 0.072;
    const rb = 0.0095;
    const rt = 0.005;
    const sinT = (rb - rt) / L;
    const cosT = Math.sqrt(1 - sinT * sinT);
    for (const ang of [0.5, 2.6, -1.1]) {
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      const px0 = 0.15;
      const py0 = 0.9;
      const tipX = px0 + ux * L;
      const tipY = py0 + uy * L;
      for (let k = 0; k < 200; k++) {
        // points around the flipper, 1–40 mm from its axis
        const along = -0.02 + (k % 20) * 0.0055;
        const off = (0.001 + (Math.floor(k / 20) % 10) * 0.004) * (k % 2 ? 1 : -1) + (k % 2 ? 0.01 : -0.01);
        const x = px0 + ux * along - uy * off;
        const y = py0 + uy * along + ux * off;
        const out = { d: 0, nx: 0, ny: 0 };
        taperedCapsuleDistance(px0, py0, ux, uy, L, rb, rt, sinT, cosT, x, y, out);
        const ref = reference(x, y, px0, py0, rb, tipX, tipY, rt);
        if (ref > 0) expect(Math.abs(out.d - ref)).toBeLessThan(1e-5);
        else expect(out.d).toBeLessThan(1e-6);
      }
    }
  });
});

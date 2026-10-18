import { len2 } from './dmath.ts';

export type Vec2 = [number, number];

/**
 * A wall path: a start point followed by straight or curved segments.
 * Curves are cubic Béziers (c1, c2 are control points), the same model an
 * editor pen tool produces.
 */
export type PathCmd =
  | { op: 'line'; to: Vec2 }
  | { op: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 }
  | { op: 'quad'; c: Vec2; to: Vec2 };

export interface Path {
  start: Vec2;
  cmds: PathCmd[];
  closed?: boolean;
}

/**
 * Flatten a path into a polyline. Uses fixed recursive subdivision driven by a
 * flatness tolerance, so the same input always yields the same points.
 */
export function flattenPath(path: Path, tolerance = 0.0008): Vec2[] {
  const pts: Vec2[] = [[path.start[0], path.start[1]]];
  let cur: Vec2 = path.start;
  for (const c of path.cmds) {
    if (c.op === 'line') {
      pts.push([c.to[0], c.to[1]]);
    } else if (c.op === 'quad') {
      // elevate to cubic
      const c1: Vec2 = [cur[0] + (2 / 3) * (c.c[0] - cur[0]), cur[1] + (2 / 3) * (c.c[1] - cur[1])];
      const c2: Vec2 = [c.to[0] + (2 / 3) * (c.c[0] - c.to[0]), c.to[1] + (2 / 3) * (c.c[1] - c.to[1])];
      subdivideCubic(cur, c1, c2, c.to, tolerance, pts, 0);
    } else {
      subdivideCubic(cur, c.c1, c.c2, c.to, tolerance, pts, 0);
    }
    cur = c.to;
  }
  if (path.closed) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) pts.push([f[0], f[1]]);
  }
  return pts;
}

function subdivideCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tol: number, out: Vec2[], depth: number): void {
  // flatness: max distance of control points from chord
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const L = len2(dx, dy);
  let flat: number;
  if (L < 1e-12) {
    flat = Math.max(len2(p1[0] - p0[0], p1[1] - p0[1]), len2(p2[0] - p0[0], p2[1] - p0[1]));
  } else {
    const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / L;
    const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / L;
    flat = Math.max(d1, d2);
  }
  if (flat <= tol || depth >= 10) {
    out.push([p3[0], p3[1]]);
    return;
  }
  const m01: Vec2 = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5];
  const m12: Vec2 = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
  const m23: Vec2 = [(p2[0] + p3[0]) * 0.5, (p2[1] + p3[1]) * 0.5];
  const a: Vec2 = [(m01[0] + m12[0]) * 0.5, (m01[1] + m12[1]) * 0.5];
  const b: Vec2 = [(m12[0] + m23[0]) * 0.5, (m12[1] + m23[1]) * 0.5];
  const mid: Vec2 = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
  subdivideCubic(p0, m01, a, mid, tol, out, depth + 1);
  subdivideCubic(mid, b, m23, p3, tol, out, depth + 1);
}

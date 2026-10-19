/**
 * Per-part geometry for the editor: where a part is (its anchor), how big it
 * is (bounds), whether a click hits it, and how it moves, rotates and scales.
 * Pure TypeScript (no DOM), so it's unit-tested.
 *
 * Coordinates are table meters (+x right, +y toward the player). Angles here
 * are radians, clockwise-positive, matching the table's degrees convention.
 */
import { flattenPath, type Path, type PathCmd, type Vec2 } from '../../core/math/bezier.ts';
import type { Part, TableDef } from '../../core/table/format.ts';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const BALL_R = 0.0135;
const SLING_R = 0.004;
/** Length of the pass-direction arrow drawn on gates (m). */
export const GATE_ARROW = 0.018;

// ------------------------------------------------------------------ queries

/** The part's reference point: what snapping aligns and rotation pivots around. */
export function anchor(p: Part): Vec2 {
  switch (p.type) {
    case 'wall': {
      const b = partBounds(p);
      return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    }
    case 'flipper':
      return [p.pivot[0], p.pivot[1]];
    case 'slingshot':
      return [(p.a[0] + p.b[0] + p.c[0]) / 3, (p.a[1] + p.b[1] + p.c[1]) / 3];
    default:
      return [p.pos[0], p.pos[1]];
  }
}

export function partBounds(p: Part): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number, r = 0) => {
    b.minX = Math.min(b.minX, x - r);
    b.minY = Math.min(b.minY, y - r);
    b.maxX = Math.max(b.maxX, x + r);
    b.maxY = Math.max(b.maxY, y + r);
  };
  switch (p.type) {
    case 'wall':
      for (const [x, y] of flattenPath(p.path)) add(x, y, p.thickness / 2);
      break;
    case 'flipper': {
      const a = (p.restAngle * Math.PI) / 180;
      add(p.pivot[0], p.pivot[1], p.baseRadius);
      add(p.pivot[0] + Math.cos(a) * p.length, p.pivot[1] + Math.sin(a) * p.length, p.tipRadius);
      // include the swept area so the selection box covers the flipper's travel
      const sign = p.side === 'left' ? -1 : 1;
      const up = a + sign * (p.stroke * Math.PI) / 180;
      add(p.pivot[0] + Math.cos(up) * p.length, p.pivot[1] + Math.sin(up) * p.length, p.tipRadius);
      break;
    }
    case 'post':
    case 'bumper':
      add(p.pos[0], p.pos[1], p.radius);
      break;
    case 'rollover':
      add(p.pos[0], p.pos[1], p.radius ?? 0.012);
      break;
    case 'slingshot':
      for (const v of [p.a, p.b, p.c]) add(v[0], v[1], SLING_R);
      break;
    case 'standupTarget':
    case 'dropTarget':
    case 'gate': {
      const [a0, a1] = targetEnds(p.pos, p.angle, p.width);
      add(a0[0], a0[1], 0.003);
      add(a1[0], a1[1], 0.003);
      // gates: include the arrow showing which way the ball passes
      if (p.type === 'gate') {
        const a = (p.angle * Math.PI) / 180;
        add(p.pos[0] + Math.cos(a) * GATE_ARROW, p.pos[1] + Math.sin(a) * GATE_ARROW);
      }
      break;
    }
    case 'drain':
      add(p.pos[0] - (p.halfSize?.[0] ?? 0.1), p.pos[1] - (p.halfSize?.[1] ?? 0.02));
      add(p.pos[0] + (p.halfSize?.[0] ?? 0.1), p.pos[1] + (p.halfSize?.[1] ?? 0.02));
      break;
    case 'plunger':
      add(p.pos[0] - p.width / 2, p.pos[1] - 0.004);
      add(p.pos[0] + p.width / 2, p.pos[1] + p.maxPull);
      break;
    case 'ballStart':
      add(p.pos[0], p.pos[1], BALL_R);
      break;
  }
  return b;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  return {
    minX: Math.min(...list.map((b) => b.minX)),
    minY: Math.min(...list.map((b) => b.minY)),
    maxX: Math.max(...list.map((b) => b.maxX)),
    maxY: Math.max(...list.map((b) => b.maxY)),
  };
}

/** Distance from (x, y) to the part's outline (≤ 0 means inside). */
export function partDistance(p: Part, x: number, y: number): number {
  switch (p.type) {
    case 'wall': {
      const pts = flattenPath(p.path);
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(pts[i], pts[i + 1], x, y));
      if (pts.length === 1) d = Math.hypot(x - pts[0][0], y - pts[0][1]);
      return d - p.thickness / 2;
    }
    case 'flipper': {
      const a = (p.restAngle * Math.PI) / 180;
      const tip: Vec2 = [p.pivot[0] + Math.cos(a) * p.length, p.pivot[1] + Math.sin(a) * p.length];
      return segDist(p.pivot, tip, x, y) - (p.baseRadius + p.tipRadius) / 2;
    }
    case 'post':
    case 'bumper':
      return Math.hypot(x - p.pos[0], y - p.pos[1]) - p.radius;
    case 'rollover':
      return Math.hypot(x - p.pos[0], y - p.pos[1]) - (p.radius ?? 0.012);
    case 'slingshot': {
      if (inTriangle(p.a, p.b, p.c, x, y)) return -0.001;
      return Math.min(segDist(p.a, p.b, x, y), segDist(p.b, p.c, x, y), segDist(p.c, p.a, x, y)) - SLING_R;
    }
    case 'standupTarget':
    case 'dropTarget':
    case 'gate': {
      const [a0, a1] = targetEnds(p.pos, p.angle, p.width);
      return segDist(a0, a1, x, y) - 0.003;
    }
    case 'drain':
    case 'plunger': {
      const b = partBounds(p);
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dy = Math.max(b.minY - y, 0, y - b.maxY);
      return dx || dy ? Math.hypot(dx, dy) : -0.001;
    }
    case 'ballStart':
      return Math.hypot(x - p.pos[0], y - p.pos[1]) - BALL_R;
  }
}

/** Rough footprint used to prefer small parts when clicks overlap. */
function footprint(p: Part): number {
  const b = partBounds(p);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  // drains are big invisible zones: always the last resort
  return p.type === 'drain' ? area * 100 : area;
}

/**
 * The part under (x, y), preferring the smallest when several overlap.
 * `tolerance` is how close counts as a hit (meters).
 */
export function hitTest(table: TableDef, x: number, y: number, tolerance: number): Part | null {
  let best: Part | null = null;
  let bestArea = Infinity;
  for (const p of table.parts) {
    if (partDistance(p, x, y) > tolerance) continue;
    const a = footprint(p);
    if (a < bestArea) {
      bestArea = a;
      best = p;
    }
  }
  return best;
}

export function partsInRect(table: TableDef, r: Bounds): Part[] {
  return table.parts.filter((p) => {
    const b = partBounds(p);
    return b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY;
  });
}

// ------------------------------------------------------------------ transforms (return new parts)

type PointFn = (v: Vec2) => Vec2;

function mapPath(path: Path, f: PointFn): Path {
  return {
    ...path,
    start: f(path.start),
    cmds: path.cmds.map((c): PathCmd => {
      if (c.op === 'line') return { ...c, to: f(c.to) };
      if (c.op === 'quad') return { ...c, c: f(c.c), to: f(c.to) };
      return { ...c, c1: f(c.c1), c2: f(c.c2), to: f(c.to) };
    }),
  };
}

/** Round to 0.01 mm so files stay readable and edits don't accumulate float noise. */
export function roundM(n: number): number {
  return Math.round(n * 100000) / 100000;
}
const rv = (v: Vec2): Vec2 => [roundM(v[0]), roundM(v[1])];

function mapPoints(p: Part, f: PointFn): Part {
  const g = (v: Vec2) => rv(f(v));
  switch (p.type) {
    case 'wall':
      return { ...p, path: mapPath(p.path, g) };
    case 'flipper':
      return { ...p, pivot: g(p.pivot) };
    case 'slingshot':
      return { ...p, a: g(p.a), b: g(p.b), c: g(p.c) };
    default:
      return { ...p, pos: g(p.pos) } as Part;
  }
}

export function translatePart(p: Part, dx: number, dy: number): Part {
  return mapPoints(p, ([x, y]) => [x + dx, y + dy]);
}

/** Rotate by `theta` radians (clockwise on screen) around `center`. */
export function rotatePart(p: Part, theta: number, center: Vec2): Part {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rot: PointFn = ([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [center[0] + dx * c - dy * s, center[1] + dx * s + dy * c];
  };
  const moved = mapPoints(p, rot);
  const deg = (theta * 180) / Math.PI;
  switch (moved.type) {
    case 'flipper':
      return { ...moved, restAngle: roundM(normDeg(moved.restAngle + deg)) };
    case 'standupTarget':
    case 'dropTarget':
    case 'gate':
      return { ...moved, angle: roundM(normDeg(moved.angle + deg)) };
    case 'drain': {
      // drains are axis-aligned rectangles: quarter turns swap their extents
      const quarter = Math.round(deg / 90);
      if (Math.abs(deg - quarter * 90) < 1e-6 && quarter % 2 && moved.halfSize) {
        return { ...moved, halfSize: [moved.halfSize[1], moved.halfSize[0]] };
      }
      return moved;
    }
    default:
      return moved;
  }
}

/** Uniform scale by `k` around `center`: positions spread and sizes grow. */
export function scalePart(p: Part, k: number, center: Vec2): Part {
  const moved = mapPoints(p, ([x, y]) => [center[0] + (x - center[0]) * k, center[1] + (y - center[1]) * k]);
  const clamp = (v: number, lo: number, hi: number) => roundM(Math.min(hi, Math.max(lo, v)));
  switch (moved.type) {
    case 'flipper':
      // flipper length is adjustable; the rubber radii stay standard
      return { ...moved, length: clamp(moved.length * k, 0.04, 0.12) };
    case 'post':
      return { ...moved, radius: clamp(moved.radius * k, 0.003, 0.03) };
    case 'bumper':
      return { ...moved, radius: clamp(moved.radius * k, 0.015, 0.05) };
    case 'rollover':
      return { ...moved, radius: clamp((moved.radius ?? 0.012) * k, 0.006, 0.03) };
    case 'standupTarget':
    case 'dropTarget':
      return { ...moved, width: clamp(moved.width * k, 0.012, 0.06) };
    case 'gate':
      return { ...moved, width: clamp(moved.width * k, 0.02, 0.1) };
    case 'drain':
      return moved.halfSize ? { ...moved, halfSize: [roundM(moved.halfSize[0] * k), roundM(moved.halfSize[1] * k)] } : moved;
    default:
      return moved;
  }
}

/** Mirror across the vertical line x = axis (for the mirror tool and symmetric placement). */
export function mirrorPart(p: Part, axis: number): Part {
  const moved = mapPoints(p, ([x, y]) => [2 * axis - x, y]);
  switch (moved.type) {
    case 'flipper': {
      const side = moved.side === 'left' ? 'right' : 'left';
      return { ...moved, side, input: side, restAngle: roundM(normDeg(180 - moved.restAngle)) };
    }
    case 'standupTarget':
    case 'dropTarget':
    case 'gate':
      return { ...moved, angle: roundM(normDeg(180 - moved.angle)) };
    default:
      return moved;
  }
}

/** Flip top-to-bottom across the horizontal line y = axis (for flipping in place). */
export function mirrorPartY(p: Part, axis: number): Part {
  const moved = mapPoints(p, ([x, y]) => [x, 2 * axis - y]);
  switch (moved.type) {
    case 'flipper': {
      const side = moved.side === 'left' ? 'right' : 'left';
      return { ...moved, side, input: moved.input ?? moved.side, restAngle: roundM(normDeg(-moved.restAngle)) };
    }
    case 'standupTarget':
    case 'dropTarget':
    case 'gate':
      return { ...moved, angle: roundM(normDeg(-moved.angle)) };
    default:
      return moved;
  }
}

/** The table's mirror axis: the center of the drain (the playfield without the shooter lane). */
export function mirrorAxis(table: TableDef): number {
  const d = table.parts.find((p) => p.type === 'drain');
  return d && d.type === 'drain' ? d.pos[0] : table.dimensions.width / 2;
}

// ------------------------------------------------------------------ helpers

function normDeg(d: number): number {
  let v = d % 360;
  if (v <= -180) v += 360;
  if (v > 180) v -= 360;
  return v;
}

function targetEnds(pos: Vec2, angleDeg: number, width: number): [Vec2, Vec2] {
  const a = (angleDeg * Math.PI) / 180;
  const tx = -Math.sin(a);
  const ty = Math.cos(a);
  const h = width / 2;
  return [
    [pos[0] - tx * h, pos[1] - ty * h],
    [pos[0] + tx * h, pos[1] + ty * h],
  ];
}

function segDist(a: Vec2, b: Vec2, x: number, y: number): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((x - a[0]) * abx + (y - a[1]) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t));
}

function inTriangle(a: Vec2, b: Vec2, c: Vec2, x: number, y: number): boolean {
  const s1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const s2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
  const s3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

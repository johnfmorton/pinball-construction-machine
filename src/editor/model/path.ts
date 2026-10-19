/**
 * Editable wall paths for the pen tool. A path is a list of nodes, each with
 * optional Bézier handles (absolute positions), like a vector drawing app:
 *   - a segment is straight when neither end has a handle on that side,
 *   - otherwise it's a cubic Bézier using the handles (a missing handle sits
 *     on its node).
 * Converts to and from the table's Path format. Pure TypeScript (tested).
 */
import type { Path, PathCmd, Vec2 } from '../../core/math/bezier.ts';
import { roundM } from './parts.ts';

export interface PathNode {
  p: Vec2;
  /** Handle shaping the segment arriving at this node. */
  in?: Vec2;
  /** Handle shaping the segment leaving this node. */
  out?: Vec2;
}

export interface EditPath {
  nodes: PathNode[];
  closed: boolean;
}

const rv = (v: Vec2): Vec2 => [roundM(v[0]), roundM(v[1])];
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

export function toNodes(path: Path): EditPath {
  const nodes: PathNode[] = [{ p: [...path.start] as Vec2 }];
  for (const c of path.cmds) {
    const prev = nodes[nodes.length - 1];
    if (c.op === 'line') {
      nodes.push({ p: [...c.to] as Vec2 });
    } else if (c.op === 'cubic') {
      if (!same(c.c1, prev.p)) prev.out = [...c.c1] as Vec2;
      const n: PathNode = { p: [...c.to] as Vec2 };
      if (!same(c.c2, c.to)) n.in = [...c.c2] as Vec2;
      nodes.push(n);
    } else {
      // quadratic: elevate to the equivalent cubic
      const p0 = prev.p;
      prev.out = [p0[0] + (2 / 3) * (c.c[0] - p0[0]), p0[1] + (2 / 3) * (c.c[1] - p0[1])];
      nodes.push({ p: [...c.to] as Vec2, in: [c.to[0] + (2 / 3) * (c.c[0] - c.to[0]), c.to[1] + (2 / 3) * (c.c[1] - c.to[1])] });
    }
  }
  // a closed path that ends back on its start: merge the duplicate node
  let closed = !!path.closed;
  if (nodes.length > 2 && same(nodes[0].p, nodes[nodes.length - 1].p)) {
    const last = nodes.pop()!;
    if (last.in) nodes[0].in = last.in;
    closed = true;
  }
  return { nodes, closed };
}

function segment(a: PathNode, b: PathNode): PathCmd {
  if (!a.out && !b.in) return { op: 'line', to: rv(b.p) };
  return { op: 'cubic', c1: rv(a.out ?? a.p), c2: rv(b.in ?? b.p), to: rv(b.p) };
}

export function toPath(e: EditPath): Path {
  const n = e.nodes;
  const cmds: PathCmd[] = [];
  for (let i = 0; i + 1 < n.length; i++) cmds.push(segment(n[i], n[i + 1]));
  if (e.closed && n.length > 2) cmds.push(segment(n[n.length - 1], n[0]));
  const path: Path = { start: rv(n[0].p), cmds };
  if (e.closed && n.length > 2) path.closed = true;
  return path;
}

/** Number of segments (closed paths have one more, back to the start). */
export function segmentCount(e: EditPath): number {
  return e.closed && e.nodes.length > 2 ? e.nodes.length : e.nodes.length - 1;
}

/** The four control points of segment i. */
export function segmentPoints(e: EditPath, i: number): [Vec2, Vec2, Vec2, Vec2] {
  const a = e.nodes[i];
  const b = e.nodes[(i + 1) % e.nodes.length];
  return [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
}

export function bezierAt([p0, p1, p2, p3]: [Vec2, Vec2, Vec2, Vec2], t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

// ------------------------------------------------------------------ edits (all return new paths)

function clone(e: EditPath): EditPath {
  return { closed: e.closed, nodes: e.nodes.map((n) => ({ p: [...n.p] as Vec2, ...(n.in ? { in: [...n.in] as Vec2 } : {}), ...(n.out ? { out: [...n.out] as Vec2 } : {}) })) };
}

/** Move a node; its handles come along. */
export function moveNode(e: EditPath, i: number, to: Vec2): EditPath {
  const r = clone(e);
  const n = r.nodes[i];
  const dx = to[0] - n.p[0];
  const dy = to[1] - n.p[1];
  n.p = [...to] as Vec2;
  if (n.in) n.in = [n.in[0] + dx, n.in[1] + dy];
  if (n.out) n.out = [n.out[0] + dx, n.out[1] + dy];
  return r;
}

/**
 * Move one handle. A smooth node (both handles in a straight line through it)
 * keeps the opposite handle opposite, at its own length, unless `breakSmooth`.
 */
export function moveHandle(e: EditPath, i: number, which: 'in' | 'out', to: Vec2, breakSmooth = false): EditPath {
  const r = clone(e);
  const n = r.nodes[i];
  const other = which === 'in' ? 'out' : 'in';
  const wasSmooth = isSmooth(e.nodes[i]);
  n[which] = [...to] as Vec2;
  if (!breakSmooth && wasSmooth && n[other]) {
    const o = n[other]!;
    const len = Math.hypot(o[0] - n.p[0], o[1] - n.p[1]);
    const dx = n.p[0] - to[0];
    const dy = n.p[1] - to[1];
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) n[other] = [n.p[0] + (dx / d) * len, n.p[1] + (dy / d) * len];
  }
  return r;
}

/** True when the node has both handles, pointing in opposite directions. */
export function isSmooth(n: PathNode): boolean {
  if (!n.in || !n.out) return false;
  const ax = n.in[0] - n.p[0];
  const ay = n.in[1] - n.p[1];
  const bx = n.out[0] - n.p[0];
  const by = n.out[1] - n.p[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return false;
  return (ax * bx + ay * by) / (la * lb) < -0.999;
}

/**
 * Corner ↔ smooth. A node with handles loses them (sharp corner, straight
 * neighbors); a corner gets smooth handles along the line between its
 * neighbors, a third of the way to each.
 */
export function toggleSmooth(e: EditPath, i: number): EditPath {
  const r = clone(e);
  const n = r.nodes[i];
  if (n.in || n.out) {
    delete n.in;
    delete n.out;
    return r;
  }
  const N = r.nodes.length;
  const prev = i > 0 ? r.nodes[i - 1].p : e.closed ? r.nodes[N - 1].p : null;
  const next = i < N - 1 ? r.nodes[i + 1].p : e.closed ? r.nodes[0].p : null;
  const a = prev ?? n.p;
  const b = next ?? n.p;
  let tx = b[0] - a[0];
  let ty = b[1] - a[1];
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-9) return r;
  tx /= tl;
  ty /= tl;
  if (prev) {
    const d = Math.hypot(n.p[0] - prev[0], n.p[1] - prev[1]) / 3;
    n.in = [n.p[0] - tx * d, n.p[1] - ty * d];
  }
  if (next) {
    const d = Math.hypot(next[0] - n.p[0], next[1] - n.p[1]) / 3;
    n.out = [n.p[0] + tx * d, n.p[1] + ty * d];
  }
  return r;
}

/** Split segment `seg` at parameter t, adding a node that keeps the shape exactly. */
export function insertNode(e: EditPath, seg: number, t: number): EditPath {
  const r = clone(e);
  const N = r.nodes.length;
  const a = r.nodes[seg];
  const b = r.nodes[(seg + 1) % N];
  const straight = !a.out && !b.in;
  const [p0, p1, p2, p3] = segmentPoints(r, seg);
  const mid = bezierAt([p0, p1, p2, p3], t);
  const node: PathNode = { p: mid };
  if (!straight) {
    // de Casteljau
    const lerp = (u: Vec2, v: Vec2): Vec2 => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
    const q0 = lerp(p0, p1);
    const q1 = lerp(p1, p2);
    const q2 = lerp(p2, p3);
    const r0 = lerp(q0, q1);
    const r1 = lerp(q1, q2);
    if (a.out) a.out = q0;
    if (b.in) b.in = q2;
    // handles the original segment didn't have stay absent on the outer ends
    if (!a.out && !same(q0, p0)) a.out = q0;
    if (!b.in && !same(q2, p3)) b.in = q2;
    node.in = r0;
    node.out = r1;
  }
  r.nodes.splice(seg + 1, 0, node);
  return r;
}

/** Remove a node (paths keep at least two). */
export function deleteNode(e: EditPath, i: number): EditPath {
  if (e.nodes.length <= 2) return e;
  const r = clone(e);
  r.nodes.splice(i, 1);
  if (r.closed && r.nodes.length < 3) r.closed = false;
  return r;
}

// ------------------------------------------------------------------ hit testing

export type PathHit = { kind: 'node'; index: number } | { kind: 'handle'; index: number; which: 'in' | 'out' } | { kind: 'segment'; index: number; t: number; at: Vec2 };

/** Nearest handle or node within `tol`, else the nearest point on a segment within `segTol`. */
export function hitPath(e: EditPath, x: number, y: number, tol: number, segTol = tol): PathHit | null {
  let best: PathHit | null = null;
  let bestD = tol;
  e.nodes.forEach((n, i) => {
    for (const which of ['in', 'out'] as const) {
      const h = n[which];
      if (!h) continue;
      const d = Math.hypot(h[0] - x, h[1] - y);
      if (d <= bestD) {
        bestD = d;
        best = { kind: 'handle', index: i, which };
      }
    }
  });
  e.nodes.forEach((n, i) => {
    const d = Math.hypot(n.p[0] - x, n.p[1] - y);
    // nodes win ties against their own handles (a fresh handle sits on its node)
    if (d <= bestD + 1e-9) {
      bestD = d;
      best = { kind: 'node', index: i };
    }
  });
  if (best) return best;
  let segBest: PathHit | null = null;
  let segD = segTol;
  for (let s = 0; s < segmentCount(e); s++) {
    const pts = segmentPoints(e, s);
    // coarse sampling, then refine around the best sample
    let bt = 0;
    let bd = Infinity;
    for (let k = 0; k <= 32; k++) {
      const p = bezierAt(pts, k / 32);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) {
        bd = d;
        bt = k / 32;
      }
    }
    for (let step = 1 / 64; step > 1e-4; step /= 2) {
      for (const t of [bt - step, bt + step]) {
        if (t < 0 || t > 1) continue;
        const p = bezierAt(pts, t);
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) {
          bd = d;
          bt = t;
        }
      }
    }
    if (bd <= segD) {
      segD = bd;
      segBest = { kind: 'segment', index: s, t: bt, at: bezierAt(pts, bt) };
    }
  }
  return segBest;
}

/** Every node and handle position, for snapping other points to them. */
export function pathPoints(e: EditPath): Vec2[] {
  return e.nodes.map((n) => n.p);
}

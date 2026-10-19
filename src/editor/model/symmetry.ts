/**
 * Symmetry editing. Most tables are left/right mirror images around the
 * playfield's center line. Two parts are "twins" when one is the mirror image
 * of the other (found from geometry, so no extra data in the table file).
 * With symmetry on, editing one twin applies the mirrored edit to the other.
 */
import { flattenPath, type Vec2 } from '../../core/math/bezier.ts';
import type { Part, TableDef } from '../../core/table/format.ts';
import { mirrorAxis, mirrorPart } from './parts.ts';

const TOL = 0.0005; // half a millimeter
const ANG_TOL = 0.5; // degrees

/** Geometry fingerprint used to compare a mirrored part with another part. */
function matches(a: Part, b: Part): boolean {
  if (a.type !== b.type) return false;
  const near = (u: Vec2, v: Vec2) => Math.abs(u[0] - v[0]) <= TOL && Math.abs(u[1] - v[1]) <= TOL;
  const close = (u: number, v: number, tol = TOL) => Math.abs(u - v) <= tol;
  const ang = (u: number, v: number) => Math.abs(((u - v + 540) % 360) - 180) <= ANG_TOL;
  switch (a.type) {
    case 'wall': {
      const w = b as typeof a;
      if (!close(a.thickness, w.thickness)) return false;
      const pa = flattenPath(a.path);
      const pb = flattenPath(w.path);
      if (pa.length !== pb.length) return false;
      return pa.every((p, i) => near(p, pb[i])) || pa.every((p, i) => near(p, pb[pb.length - 1 - i]));
    }
    case 'flipper': {
      const f = b as typeof a;
      return near(a.pivot, f.pivot) && a.side === f.side && ang(a.restAngle, f.restAngle) && close(a.length, f.length);
    }
    case 'slingshot': {
      const s = b as typeof a;
      return near(a.a, s.a) && near(a.b, s.b) && near(a.c, s.c);
    }
    case 'standupTarget':
    case 'dropTarget':
    case 'gate': {
      const t = b as typeof a;
      return near(a.pos, t.pos) && ang(a.angle, t.angle) && close(a.width, t.width);
    }
    case 'post':
    case 'bumper': {
      const q = b as typeof a;
      return near(a.pos, q.pos) && close(a.radius, q.radius);
    }
    default:
      return near((a as { pos: Vec2 }).pos, (b as { pos: Vec2 }).pos);
  }
}

/**
 * Pairs of mirror-image parts: id → twin id (both directions). Parts that sit
 * on the center line and mirror onto themselves aren't paired.
 */
export function findTwins(table: TableDef): Map<string, string> {
  const axis = mirrorAxis(table);
  const twins = new Map<string, string>();
  const parts = table.parts;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (twins.has(p.id) || p.type === 'drain' || p.type === 'ballStart' || p.type === 'plunger') continue;
    const m = mirrorPart(p, axis);
    for (let j = i + 1; j < parts.length; j++) {
      const q = parts[j];
      if (twins.has(q.id)) continue;
      if (matches(m, q)) {
        twins.set(p.id, q.id);
        twins.set(q.id, p.id);
        break;
      }
    }
  }
  return twins;
}

/**
 * After an edit from `before` to `after`, give every twin of a changed part
 * the mirrored change. A twin that was itself edited (both selected) is left
 * alone. Deleting one twin deletes the other. Each twin keeps its own id,
 * label, points and group.
 */
export function applySymmetry(before: TableDef, after: TableDef, twins = findTwins(before)): TableDef {
  if (!twins.size) return after;
  const axis = mirrorAxis(before);
  const beforeById = new Map(before.parts.map((p) => [p.id, p]));
  const afterById = new Map(after.parts.map((p) => [p.id, p]));
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const [id, p] of beforeById) {
    const q = afterById.get(id);
    if (!q) deleted.add(id);
    else if (q !== p) changed.add(id);
  }
  if (!changed.size && !deleted.size) return after;
  const replace = new Map<string, Part>();
  const remove = new Set<string>();
  for (const id of changed) {
    const twin = twins.get(id);
    if (!twin || changed.has(twin) || deleted.has(twin) || !afterById.has(twin)) continue;
    const old = afterById.get(twin)! as Part & Record<string, unknown>;
    const m = mirrorPart(afterById.get(id)!, axis) as Part & Record<string, unknown>;
    const next = { ...m, id: twin } as Part & Record<string, unknown>;
    for (const k of ['label', 'points', 'group']) {
      if (old[k] === undefined) delete next[k];
      else next[k] = old[k];
    }
    replace.set(twin, next as Part);
  }
  for (const id of deleted) {
    const twin = twins.get(id);
    if (twin && !changed.has(twin)) remove.add(twin);
  }
  if (!replace.size && !remove.size) return after;
  return { ...after, parts: after.parts.filter((p) => !remove.has(p.id)).map((p) => replace.get(p.id) ?? p) };
}

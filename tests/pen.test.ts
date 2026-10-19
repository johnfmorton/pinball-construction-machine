import { describe, expect, it } from 'vitest';
import { flattenPath, type Path } from '../src/core/math/bezier.ts';
import type { Part, TableDef } from '../src/core/table/format.ts';
import { validateTable } from '../src/core/table/format.ts';
import { deleteNode, hitPath, insertNode, isSmooth, moveHandle, moveNode, toNodes, toPath, toggleSmooth } from '../src/editor/model/path.ts';
import { applySymmetry, findTwins } from '../src/editor/model/symmetry.ts';
import { mirrorPart, mirrorPartY, translatePart, anchor } from '../src/editor/model/parts.ts';
import { loadTable } from './helpers.ts';

const t = loadTable('test-table');
const get = (id: string) => t.parts.find((p) => p.id === id)! as Extract<Part, { type: 'wall' }>;

/** Max distance between two flattened paths sampled at the same resolution. */
function shapeDiff(a: Path, b: Path): number {
  const pa = flattenPath(a, 0.0001);
  const pb = flattenPath(b, 0.0001);
  const segDist = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dy * u);
  };
  const toLine = (p: number[], line: number[][]) => Math.min(...line.slice(1).map((q, i) => segDist(p, line[i], q)));
  let worst = 0;
  for (const p of pa) worst = Math.max(worst, toLine(p, pb));
  for (const p of pb) worst = Math.max(worst, toLine(p, pa));
  return worst;
}

describe('wall paths', () => {
  it('every wall on the test table round-trips through the editor exactly', () => {
    for (const w of t.parts.filter((p) => p.type === 'wall') as Extract<Part, { type: 'wall' }>[]) {
      expect(shapeDiff(w.path, toPath(toNodes(w.path))), w.id).toBeLessThan(1e-5);
    }
  });

  it('a quadratic curve becomes the same cubic', () => {
    const q: Path = { start: [0, 0], cmds: [{ op: 'quad', c: [0.05, -0.05], to: [0.1, 0] }] };
    const back = toPath(toNodes(q));
    expect(back.cmds[0].op).toBe('cubic');
    expect(shapeDiff(q, back)).toBeLessThan(1e-5);
  });

  it('adding a point keeps the shape, on straight and curved segments', () => {
    const outer = get('outer-wall').path; // line, cubic arch, line
    const e = toNodes(outer);
    for (let seg = 0; seg < 3; seg++) {
      const more = insertNode(e, seg, 0.37);
      expect(more.nodes.length).toBe(e.nodes.length + 1);
      expect(shapeDiff(outer, toPath(more))).toBeLessThan(2e-4); // within the flattening tolerance
    }
  });

  it('moving a point drags its handles; deleting keeps at least two points', () => {
    const e = toNodes(get('outer-wall').path);
    const i = e.nodes.findIndex((n) => n.out);
    const m = moveNode(e, i, [e.nodes[i].p[0] + 0.01, e.nodes[i].p[1]]);
    expect(m.nodes[i].out![0] - e.nodes[i].out![0]).toBeCloseTo(0.01, 9);
    let two = toNodes(get('shooter-lane-wall').path);
    two = deleteNode(two, 0);
    expect(two.nodes.length).toBe(2);
  });

  it('corner ↔ smooth, and smooth handles stay opposite', () => {
    const e = toNodes(get('drop-backstop').path); // 3 straight points
    const s = toggleSmooth(e, 1);
    expect(isSmooth(s.nodes[1])).toBe(true);
    const n = s.nodes[1];
    const moved = moveHandle(s, 1, 'out', [n.p[0] + 0.02, n.p[1] + 0.005]);
    expect(isSmooth(moved.nodes[1])).toBe(true);
    const broken = moveHandle(s, 1, 'out', [n.p[0] + 0.02, n.p[1] + 0.005], true);
    expect(isSmooth(broken.nodes[1])).toBe(false);
    expect(toggleSmooth(s, 1).nodes[1].out).toBeUndefined();
  });

  it('closing a shape and hit testing', () => {
    const tri: Path = { start: [0, 0], cmds: [{ op: 'line', to: [0.1, 0] }, { op: 'line', to: [0.05, 0.08] }], closed: true };
    const e = toNodes(tri);
    expect(e.closed).toBe(true);
    expect(e.nodes.length).toBe(3);
    expect(flattenPath(toPath(e)).length).toBe(4); // back to the start
    expect(hitPath(e, 0.1005, 0, 0.002)).toEqual({ kind: 'node', index: 1 });
    const seg = hitPath(e, 0.025, 0.04, 0.002, 0.005);
    expect(seg?.kind).toBe('segment');
    expect(seg && seg.kind === 'segment' && seg.index).toBe(2); // the closing segment
  });
});

describe('symmetry', () => {
  it('finds the mirror pairs on the test table', () => {
    const tw = findTwins(t);
    for (const [a, b] of [
      ['flipper-left', 'flipper-right'],
      ['guide-left', 'guide-right'],
      ['sling-left', 'sling-right'],
      ['inlane-left', 'inlane-right'],
      ['outlane-left', 'outlane-right'],
    ]) {
      expect(tw.get(a)).toBe(b);
      expect(tw.get(b)).toBe(a);
    }
    expect(tw.has('bumper-3')).toBe(false); // on the center line: mirrors onto itself
  });

  it('moving one twin moves the other the mirror way, keeping its own points', () => {
    const before = t;
    const after: TableDef = { ...t, parts: t.parts.map((p) => (p.id === 'sling-left' ? translatePart(p, 0.01, 0.02) : p)) };
    const out = applySymmetry(before, after);
    const l = out.parts.find((p) => p.id === 'sling-left')!;
    const r = out.parts.find((p) => p.id === 'sling-right')!;
    const axis = 0.236;
    expect(anchor(r)[0]).toBeCloseTo(2 * axis - anchor(l)[0], 4);
    expect(anchor(r)[1]).toBeCloseTo(anchor(l)[1], 6);
    expect(findTwins(out).get('sling-left')).toBe('sling-right');
    expect(validateTable(out)).toEqual([]);
  });

  it('reshaping one wall reshapes its twin', () => {
    const after: TableDef = {
      ...t,
      parts: t.parts.map((p) => (p.id === 'guide-left' && p.type === 'wall' ? { ...p, path: toPath(insertNode(toNodes(p.path), 0, 0.5)) } : p)),
    };
    const out = applySymmetry(t, after);
    const r = out.parts.find((p) => p.id === 'guide-right')! as Extract<Part, { type: 'wall' }>;
    expect(toNodes(r.path).nodes.length).toBe(4);
  });

  it('deleting one twin deletes the other; editing both leaves both alone', () => {
    const del = applySymmetry(t, { ...t, parts: t.parts.filter((p) => p.id !== 'flipper-left') });
    expect(del.parts.some((p) => p.id === 'flipper-right')).toBe(false);
    const both: TableDef = { ...t, parts: t.parts.map((p) => (p.id === 'post-1' || p.id === 'flipper-left' || p.id === 'flipper-right' ? translatePart(p, 0, 0.01) : p)) };
    expect(applySymmetry(t, both)).toBe(both);
  });

  it('flipping top-to-bottom twice gives back the original', () => {
    for (const p of t.parts) {
      const back = mirrorPartY(mirrorPartY(p, 0.5), 0.5);
      expect(JSON.stringify(back), p.id).toBe(JSON.stringify(p.type === 'flipper' ? { ...p, input: p.input ?? p.side } : p));
    }
    // and left-right too
    for (const p of t.parts) expect(anchor(mirrorPart(mirrorPart(p, 0.2), 0.2))).toEqual(anchor(p));
  });
});

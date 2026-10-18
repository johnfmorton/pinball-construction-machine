import { describe, expect, it } from 'vitest';
import type { Part, TableDef } from '../src/core/table/format.ts';
import { validateTable } from '../src/core/table/format.ts';
import { World } from '../src/core/physics/world.ts';
import { DEFAULT_TUNING } from '../src/core/physics/tuning.ts';
import { anchor, hitTest, mirrorAxis, mirrorPart, partBounds, rotatePart, scalePart, translatePart } from '../src/editor/model/parts.ts';
import { snapAngle, snapPoint } from '../src/editor/model/snap.ts';
import { History, uniqueId } from '../src/editor/model/history.ts';
import { findTraps } from '../src/core/table/traps.ts';
import { loadTable } from './helpers.ts';

const t = loadTable('test-table');
const get = (id: string) => t.parts.find((p) => p.id === id)!;

describe('part transforms', () => {
  it('translate moves every point of every part type', () => {
    for (const p of t.parts) {
      const a = anchor(p);
      const b = anchor(translatePart(p, 0.01, -0.02));
      expect(b[0] - a[0]).toBeCloseTo(0.01, 4);
      expect(b[1] - a[1]).toBeCloseTo(-0.02, 4);
    }
  });

  it('a full turn in 5° steps returns every part to where it started', () => {
    for (const p of t.parts) {
      let q: Part = p;
      for (let i = 0; i < 72; i++) q = rotatePart(q, (5 * Math.PI) / 180, [0.25, 0.5]);
      const a = anchor(p);
      const b = anchor(q);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.0001); // 0.01 mm rounding per step
    }
  });

  it('rotating a flipper about its pivot changes only its rest angle', () => {
    const f = get('flipper-left');
    const r = rotatePart(f, Math.PI / 18, anchor(f));
    expect(r.type === 'flipper' && r.restAngle).toBeCloseTo(40, 4);
    expect(anchor(r)).toEqual(anchor(f));
  });

  it('mirroring the left flipper reproduces the right one', () => {
    const m = mirrorPart(get('flipper-left'), mirrorAxis(t)) as Extract<Part, { type: 'flipper' }>;
    const right = get('flipper-right') as Extract<Part, { type: 'flipper' }>;
    expect(m.side).toBe('right');
    expect(m.pivot[0]).toBeCloseTo(right.pivot[0], 4);
    expect(m.restAngle).toBeCloseTo(right.restAngle, 4);
  });

  it('scaling grows sizes within sensible limits', () => {
    const post = scalePart(get('post-1'), 10, anchor(get('post-1')));
    expect(post.type === 'post' && post.radius).toBe(0.03);
    const bumper = scalePart(get('bumper-1'), 1.5, anchor(get('bumper-1')));
    expect(bumper.type === 'bumper' && bumper.radius).toBeCloseTo(0.042, 4);
  });

  it('edited tables stay valid and still build a physics world', () => {
    const edited: TableDef = {
      ...t,
      parts: t.parts.map((p) => (p.type === 'bumper' ? rotatePart(translatePart(p, 0.01, 0), 0.3, [0.25, 0.3]) : p)),
    };
    expect(validateTable(edited)).toEqual([]);
    expect(() => new World(edited, DEFAULT_TUNING)).not.toThrow();
  });
});

describe('hit testing', () => {
  it('picks the small part, not the wall or drain around it', () => {
    const p = get('post-1');
    expect(p.type === 'post' && hitTest(t, p.pos[0], p.pos[1], 0.002)?.id).toBe('post-1');
  });

  it('a click in open playfield hits nothing', () => {
    expect(hitTest(t, 0.24, 0.5, 0.002)).toBeNull();
  });

  it('bounds contain the part anchor', () => {
    for (const p of t.parts) {
      const b = partBounds(p);
      const [x, y] = anchor(p);
      expect(x >= b.minX - 1e-9 && x <= b.maxX + 1e-9 && y >= b.minY - 1e-9 && y <= b.maxY + 1e-9, p.id).toBe(true);
    }
  });
});

describe('snapping', () => {
  it('snaps to a 5 mm grid with no guides nearby', () => {
    const r = snapPoint([0.1012, 0.2033], { anchors: [], mirror: 10 }, 0.002);
    expect(r.point[0]).toBeCloseTo(0.1, 6);
    expect(r.point[1]).toBeCloseTo(0.205, 6);
    expect(r.guides).toEqual([]);
  });

  it('snaps to the mirror image of another part', () => {
    // a part at x = 0.15 mirrors to 0.322 across an axis at 0.236
    const r = snapPoint([0.3214, 0.4], { anchors: [[0.15, 0.9]], mirror: 0.236 }, 0.002);
    expect(r.point[0]).toBeCloseTo(0.322, 6);
    expect(r.guides[0]).toMatchObject({ axis: 'x', kind: 'mirror' });
  });

  it('aligns rows with other parts', () => {
    const r = snapPoint([0.3, 0.6012], { anchors: [[0.1, 0.6]], mirror: 10 }, 0.002);
    expect(r.point[1]).toBeCloseTo(0.6, 6);
    expect(r.guides.some((g) => g.axis === 'y')).toBe(true);
  });

  it('angles snap to 5°', () => {
    expect((snapAngle((47 * Math.PI) / 180) * 180) / Math.PI).toBeCloseTo(45, 6);
  });
});

describe('history', () => {
  it('undo and redo walk back and forth', () => {
    const h = new History();
    const a = { ...t, meta: { name: 'a' } };
    const b = { ...t, meta: { name: 'b' } };
    const c = { ...t, meta: { name: 'c' } };
    h.push(a, 'one');
    h.push(b, 'two');
    let cur: TableDef = c;
    cur = h.undo(cur)!.table;
    expect(cur.meta.name).toBe('b');
    cur = h.undo(cur)!.table;
    expect(cur.meta.name).toBe('a');
    expect(h.canUndo).toBe(false);
    cur = h.redo(cur)!.table;
    expect(cur.meta.name).toBe('b');
    h.push(cur, 'three'); // a new edit clears the redo stack
    expect(h.canRedo).toBe(false);
  });

  it('makes unique ids', () => {
    expect(uniqueId(t, 'post-1')).toBe('post-3');
    expect(uniqueId(t, 'bumper')).toBe('bumper-4');
  });
});

describe('an edited table still plays', () => {
  it('moving the bumpers keeps the table free of traps', () => {
    const edited: TableDef = { ...t, parts: t.parts.map((p) => (p.type === 'bumper' ? translatePart(p, 0, 0.03) : p)) };
    expect(findTraps(edited, { balls: 80 }).traps).toEqual([]);
  });
});

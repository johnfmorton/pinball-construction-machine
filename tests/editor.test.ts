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

describe('parts palette', () => {
  it('every entry drops a valid part exactly where the cursor is, and the table still builds', async () => {
    const { CATALOG, instantiate, groupAnchor, canPlace } = await import('../src/editor/model/catalog.ts');
    let table: TableDef = { ...t, parts: t.parts.filter((p) => p.type !== 'ballStart') };
    for (const e of CATALOG) {
      expect(canPlace(e, table), e.key).toBe(true);
      const parts = instantiate(e, table, [0.2, 0.5]);
      const [x, y] = groupAnchor(parts);
      expect(x, e.key).toBeCloseTo(0.2, 4);
      expect(y, e.key).toBeCloseTo(0.5, 4);
      table = { ...table, parts: [...table.parts, ...parts] };
    }
    expect(validateTable(table)).toEqual([]); // ids all unique, exactly one ball start
    expect(() => new World(table, DEFAULT_TUNING)).not.toThrow();
  });

  it('numbers new ids and gives each new bank its own group', async () => {
    const { catalogEntry, instantiate } = await import('../src/editor/model/catalog.ts');
    const bank = catalogEntry('drop-bank')!;
    const a = instantiate(bank, t, [0.2, 0.3]);
    expect(a.map((p) => p.id)).toEqual(['drop-4', 'drop-5', 'drop-6']); // the test table has drop-1..3
    expect(new Set(a.map((p) => p.group)).size).toBe(1);
    expect(a[0].group).not.toBe('drops'); // the test table already uses "drops"
    const b = instantiate(bank, { ...t, parts: [...t.parts, ...a] }, [0.2, 0.4]);
    expect(b[0].group).not.toBe(a[0].group);
  });

  it('only one ball start', async () => {
    const { catalogEntry, canPlace } = await import('../src/editor/model/catalog.ts');
    expect(canPlace(catalogEntry('ball-start')!, t)).toBe(false);
  });
});

describe('inspector fields', () => {
  it('every field reads back what it writes', async () => {
    const { typeFields, positionFields } = await import('../src/editor/model/fields.ts');
    const { CATALOG, instantiate } = await import('../src/editor/model/catalog.ts');
    for (const e of CATALOG) {
      for (const p of instantiate(e, t, [0.2, 0.5])) {
        for (const f of [...positionFields, ...typeFields(p)]) {
          const v = f.get(p);
          if (f.kind === 'select') {
            const other = f.options!.find((o) => o.value !== v)!.value;
            expect(f.get(f.set(p, other)), `${p.type}.${f.key}`).toBe(other);
          } else if (typeof v === 'number' || v === undefined) {
            const want = f.kind === 'length' ? 0.0213 : f.kind === 'angle' ? 33 : 1.25;
            const lo = f.min ?? -Infinity;
            const hi = f.max ?? Infinity;
            expect(f.get(f.set(p, want)), `${p.type}.${f.key}`).toBeCloseTo(Math.min(hi, Math.max(lo, want)), 4);
          }
        }
      }
    }
  });

  it('blank clears optional settings back to the table default', async () => {
    const { typeFields } = await import('../src/editor/model/fields.ts');
    const b = { ...get('bumper-1'), kick: 2 } as Part;
    const kick = typeFields(b).find((f) => f.key === 'kick')!;
    expect('kick' in kick.set(b, undefined)).toBe(false);
  });

  it('lengths are clamped to sensible limits', async () => {
    const { typeFields } = await import('../src/editor/model/fields.ts');
    const f = get('flipper-left');
    const len = typeFields(f).find((x) => x.key === 'length')!;
    expect(len.get(len.set(f, 0.5))).toBe(0.12);
  });
});

describe('align and distribute', () => {
  it('aligns left edges and spreads anchors evenly', async () => {
    const { alignParts, distributeParts } = await import('../src/editor/model/arrange.ts');
    const posts: Part[] = [0.1, 0.13, 0.3].map((x, i) => ({ id: `p${i}`, type: 'post', pos: [x, 0.2 + i * 0.05], radius: 0.008 + i * 0.002, material: 'metal' }));
    const left = alignParts(posts, 'left').map((p) => partBounds(p).minX);
    for (const v of left) expect(v).toBeCloseTo(Math.min(...posts.map((p) => partBounds(p).minX)), 6);
    const spread = distributeParts(posts, 'x').map((p) => anchor(p)[0]);
    expect(spread[1] - spread[0]).toBeCloseTo(spread[2] - spread[1], 6);
  });
});

describe('playability', () => {
  it('an unfinished table is still a valid draft, just not playable', () => {
    const bare: TableDef = { ...t, parts: t.parts.filter((p) => p.type === 'wall') };
    expect(validateTable(bare, { playable: false })).toEqual([]);
    expect(validateTable(bare).map((i) => i.message)).toEqual(['needs a ball start', 'needs a drain', 'needs at least one flipper']);
  });
});

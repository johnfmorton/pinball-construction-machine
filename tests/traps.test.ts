import { describe, expect, it } from 'vitest';
import { findTraps } from '../src/core/table/traps.ts';
import { loadTable } from './helpers.ts';

describe('ball traps', () => {
  for (const name of ['test-table', 'flipper-lab'] as const) {
    for (const dropTargetsDown of [false, true]) {
      it(`${name}${dropTargetsDown ? ' (drop targets down)' : ''}: every ball drains with the flippers idle`, () => {
        const r = findTraps(loadTable(name), { balls: 150, dropTargetsDown });
        expect(r.dropped).toBeGreaterThan(80);
        expect(r.traps).toEqual([]);
      });
    }
  }

  it('catches a ledge where a ball can perch', () => {
    const t = loadTable('test-table');
    t.parts = t.parts.filter((p) => p.id !== 'standup-deflector');
    const r = findTraps(t, { balls: 400 });
    expect(r.traps.some((x) => x.near.includes('standup-1'))).toBe(true);
  });
});

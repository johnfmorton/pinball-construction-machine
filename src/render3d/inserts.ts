/**
 * Light inserts: the translucent lamps set into the playfield. Phase 1 derives
 * them from the parts on the table; Phase 3's rules system will let builders
 * place and wire their own.
 */
import { DEG } from '../core/math/dmath.ts';
import type { TableDef } from '../core/table/format.ts';

export type InsertBinding =
  | { kind: 'rollover'; partId: string }
  | { kind: 'target'; partId: string }
  | { kind: 'shootAgain' }
  | { kind: 'multiplier'; value: number };

export interface Insert {
  id: string;
  shape: 'circle' | 'arrow' | 'oval';
  x: number;
  y: number;
  /** Radius (circle) or half-length (arrow, oval). */
  size: number;
  /** Arrow/oval direction, radians clockwise from +x. */
  angle: number;
  label?: string;
  bind: InsertBinding;
}

export function computeInserts(table: TableDef): Insert[] {
  const out: Insert[] = [];
  const cx = table.parts.find((p) => p.type === 'drain')?.type === 'drain' ? (table.parts.find((p) => p.type === 'drain') as { pos: [number, number] }).pos[0] : table.dimensions.width / 2;
  for (const p of table.parts) {
    if (p.type === 'rollover') {
      out.push({ id: `ins-${p.id}`, shape: 'circle', x: p.pos[0], y: p.pos[1], size: (p.radius ?? 0.012) * 0.75, angle: 0, bind: { kind: 'rollover', partId: p.id } });
    } else if (p.type === 'standupTarget' || p.type === 'dropTarget') {
      const a = p.angle * DEG;
      const d = 0.04;
      out.push({
        id: `ins-${p.id}`,
        shape: 'arrow',
        x: p.pos[0] + Math.cos(a) * d,
        y: p.pos[1] + Math.sin(a) * d,
        size: 0.011,
        angle: a + Math.PI,
        bind: { kind: 'target', partId: p.id },
      });
    }
  }
  // multiplier ladder and shoot-again, centered on the drain
  const mults = [2, 3, 4, 5];
  mults.forEach((m, i) => {
    out.push({
      id: `ins-mult-${m}`,
      shape: 'circle',
      x: cx + (i - (mults.length - 1) / 2) * 0.042,
      y: 0.705,
      size: 0.011,
      angle: 0,
      label: `${m}X`,
      bind: { kind: 'multiplier', value: m },
    });
  });
  out.push({ id: 'ins-shoot-again', shape: 'oval', x: cx, y: 0.875, size: 0.016, angle: 0, label: 'SHOOT AGAIN', bind: { kind: 'shootAgain' } });
  return out;
}

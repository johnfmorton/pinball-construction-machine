/**
 * Align and distribute for multi-selections, by part outlines (align) and by
 * anchors (distribute), like a drawing app.
 */
import type { Part } from '../../core/table/format.ts';
import { anchor, partBounds, translatePart, unionBounds } from './parts.ts';

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export function alignParts(parts: Part[], mode: AlignMode): Part[] {
  const all = unionBounds(parts.map(partBounds));
  if (!all || parts.length < 2) return parts;
  return parts.map((p) => {
    const b = partBounds(p);
    switch (mode) {
      case 'left':
        return translatePart(p, all.minX - b.minX, 0);
      case 'right':
        return translatePart(p, all.maxX - b.maxX, 0);
      case 'centerX':
        return translatePart(p, (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
      case 'top':
        return translatePart(p, 0, all.minY - b.minY);
      case 'bottom':
        return translatePart(p, 0, all.maxY - b.maxY);
      case 'centerY':
        return translatePart(p, 0, (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2);
    }
  });
}

/** Space anchors evenly between the first and last part along x or y. Order is kept. */
export function distributeParts(parts: Part[], axis: 'x' | 'y'): Part[] {
  if (parts.length < 3) return parts;
  const k = axis === 'x' ? 0 : 1;
  const order = parts.map((p, i) => ({ i, at: anchor(p)[k] })).sort((a, b) => a.at - b.at);
  const lo = order[0].at;
  const hi = order[order.length - 1].at;
  const out = [...parts];
  order.forEach((o, n) => {
    const want = lo + ((hi - lo) * n) / (order.length - 1);
    const d = want - o.at;
    out[o.i] = axis === 'x' ? translatePart(parts[o.i], d, 0) : translatePart(parts[o.i], 0, d);
  });
  return out;
}

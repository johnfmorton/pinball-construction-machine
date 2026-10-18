/**
 * Snapping for moves and rotations: a 5 mm grid, 5° angle steps, and smart
 * guides that line a part up with other parts and with the mirror axis
 * (including the mirror image of other parts, so symmetric layouts click into
 * place). Guides win over the grid on the axis where they apply.
 */
import type { Vec2 } from '../../core/math/bezier.ts';

export const GRID = 0.005;
export const ANGLE_STEP = (5 * Math.PI) / 180;

export interface Guide {
  /** Vertical guide at x, or horizontal guide at y. */
  axis: 'x' | 'y';
  at: number;
  kind: 'align' | 'mirror';
}

export interface SnapTargets {
  /** Anchors of the parts NOT being moved. */
  anchors: Vec2[];
  /** The table's mirror axis (x). */
  mirror: number;
}

export interface SnapResult {
  point: Vec2;
  guides: Guide[];
}

export function snapGrid(v: number, step = GRID): number {
  return Math.round(v / step) * step;
}

/**
 * Snap a proposed anchor position. `tolerance` is in meters (convert from a
 * few screen pixels at the current zoom).
 */
export function snapPoint(p: Vec2, targets: SnapTargets, tolerance: number, useGrid = true): SnapResult {
  const guides: Guide[] = [];
  let [x, y] = p;

  // x: mirror axis, other anchors' x, and other anchors mirrored across the axis
  let bestX: { at: number; d: number; kind: Guide['kind'] } | null = null;
  const tryX = (at: number, kind: Guide['kind']) => {
    const d = Math.abs(at - p[0]);
    if (d <= tolerance && (!bestX || d < bestX.d)) bestX = { at, d, kind };
  };
  tryX(targets.mirror, 'mirror');
  for (const a of targets.anchors) {
    tryX(a[0], 'align');
    tryX(2 * targets.mirror - a[0], 'mirror');
  }

  let bestY: { at: number; d: number } | null = null;
  for (const a of targets.anchors) {
    const d = Math.abs(a[1] - p[1]);
    if (d <= tolerance && (!bestY || d < bestY.d)) bestY = { at: a[1], d };
  }

  const bx = bestX as { at: number; d: number; kind: Guide['kind'] } | null;
  const by = bestY as { at: number; d: number } | null;
  if (bx) {
    x = bx.at;
    guides.push({ axis: 'x', at: bx.at, kind: bx.kind });
  } else if (useGrid) x = snapGrid(x);
  if (by) {
    y = by.at;
    guides.push({ axis: 'y', at: by.at, kind: 'align' });
  } else if (useGrid) y = snapGrid(y);
  return { point: [x, y], guides };
}

export function snapAngle(theta: number, step = ANGLE_STEP): number {
  return Math.round(theta / step) * step;
}

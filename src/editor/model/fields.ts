/**
 * What the inspector shows for each part type: a list of fields, each knowing
 * how to read its value from a part and how to write a new value back
 * (returning a new part). Kept DOM-free so the rules are unit-tested; the
 * Svelte inspector just renders the list.
 *
 * Length fields read and write meters; the inspector shows millimeters.
 */
import type { Vec2 } from '../../core/math/bezier.ts';
import type { MaterialName, Part } from '../../core/table/format.ts';
import { anchor, roundM, translatePart } from './parts.ts';

export type FieldKind = 'length' | 'angle' | 'number' | 'text' | 'select';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  get(p: Part): number | string | undefined;
  /** `undefined` clears an optional value back to its default. */
  set(p: Part, v: number | string | undefined): Part;
  options?: { value: string; label: string }[];
  /** Step in display units (mm, °, or plain). */
  step?: number;
  /** Limits in stored units (meters for lengths). */
  min?: number;
  max?: number;
  /** Shown when the value is unset (the default that applies). */
  placeholder?: string;
  /** Take the full row instead of half. */
  wide?: boolean;
  hint?: string;
}

const MATERIALS: { value: MaterialName; label: string }[] = [
  { value: 'wood', label: 'Wood' },
  { value: 'metal', label: 'Metal' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'rubber', label: 'Rubber' },
  { value: 'postRubber', label: 'Post rubber' },
];

type AnyPart = Part & Record<string, unknown>;

/** A plain numeric property, optionally clamped. */
function prop(key: string, label: string, kind: FieldKind, opts: Partial<FieldSpec> = {}): FieldSpec {
  return {
    key,
    label,
    kind,
    get: (p) => (p as AnyPart)[key] as number | undefined,
    set: (p, v) => {
      const q = { ...p } as AnyPart;
      if (v === undefined || v === '') delete q[key];
      else q[key] = kind === 'length' ? roundM(clamp(Number(v), opts.min, opts.max)) : typeof v === 'number' ? clamp(v, opts.min, opts.max) : v;
      return q as Part;
    },
    ...opts,
  };
}

function clamp(v: number, lo = -Infinity, hi = Infinity): number {
  return Math.min(hi, Math.max(lo, v));
}

/** One coordinate of a vertex (slingshots). */
function vertex(key: 'a' | 'b' | 'c', axis: 0 | 1, label: string): FieldSpec {
  return {
    key: `${key}${axis ? 'y' : 'x'}`,
    label,
    kind: 'length',
    step: 1,
    get: (p) => ((p as AnyPart)[key] as Vec2)[axis],
    set: (p, v) => {
      const cur = (p as AnyPart)[key] as Vec2;
      const next: Vec2 = axis ? [cur[0], roundM(Number(v))] : [roundM(Number(v)), cur[1]];
      return { ...p, [key]: next } as Part;
    },
  };
}

export const positionFields: FieldSpec[] = [
  {
    key: 'x',
    label: 'X',
    kind: 'length',
    step: 1,
    get: (p) => anchor(p)[0],
    set: (p, v) => translatePart(p, Number(v) - anchor(p)[0], 0),
  },
  {
    key: 'y',
    label: 'Y',
    kind: 'length',
    step: 1,
    get: (p) => anchor(p)[1],
    set: (p, v) => translatePart(p, 0, Number(v) - anchor(p)[1]),
  },
];

const points = prop('points', 'Points', 'number', { step: 10, min: 0, placeholder: '0' });

/** Fields specific to the part's type (position, id, label and group are handled separately). */
export function typeFields(p: Part): FieldSpec[] {
  switch (p.type) {
    case 'wall':
      return [
        prop('material', 'Material', 'select', { options: MATERIALS }),
        prop('thickness', 'Thickness', 'length', { step: 0.5, min: 0.001, max: 0.05 }),
        prop('height', 'Height', 'length', { step: 1, min: 0.005, max: 0.1, placeholder: p.material === 'metal' ? '25' : '50' }),
      ];
    case 'flipper':
      return [
        {
          key: 'side',
          label: 'Swings',
          kind: 'select',
          options: [
            { value: 'left', label: 'Up, counter-clockwise (left)' },
            { value: 'right', label: 'Up, clockwise (right)' },
          ],
          wide: true,
          get: (q) => (q as { side: string }).side,
          set: (q, v) => ({ ...q, side: v as 'left' | 'right' }) as Part,
        },
        prop('input', 'Button', 'select', {
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ],
          get: (q) => (q as { input?: string; side: string }).input ?? (q as { side: string }).side,
        }),
        prop('restAngle', 'Rest angle', 'angle', { step: 1 }),
        prop('stroke', 'Stroke', 'angle', { step: 1, min: 10, max: 90 }),
        prop('length', 'Length', 'length', { step: 1, min: 0.04, max: 0.12 }),
        prop('baseRadius', 'Base radius', 'length', { step: 0.5, min: 0.005, max: 0.015 }),
        prop('tipRadius', 'Tip radius', 'length', { step: 0.5, min: 0.003, max: 0.012 }),
        prop('strength', 'Strength', 'number', { step: 0.05, min: 0.3, max: 2, placeholder: '1' }),
      ];
    case 'post':
      return [
        prop('material', 'Material', 'select', { options: MATERIALS }),
        prop('radius', 'Radius', 'length', { step: 0.5, min: 0.003, max: 0.03 }),
        points,
      ];
    case 'bumper':
      return [
        prop('radius', 'Radius', 'length', { step: 0.5, min: 0.015, max: 0.05 }),
        prop('kick', 'Kick (m/s)', 'number', { step: 0.1, min: 0, max: 5, placeholder: 'table', hint: 'Blank uses the table’s bumper kick' }),
        points,
      ];
    case 'slingshot':
      return [
        prop('kick', 'Kick (m/s)', 'number', { step: 0.1, min: 0, max: 5, placeholder: 'table', hint: 'Blank uses the table’s sling kick' }),
        points,
        vertex('a', 0, 'Face start X'),
        vertex('a', 1, 'Face start Y'),
        vertex('b', 0, 'Face end X'),
        vertex('b', 1, 'Face end Y'),
        vertex('c', 0, 'Back corner X'),
        vertex('c', 1, 'Back corner Y'),
      ];
    case 'standupTarget':
    case 'dropTarget':
      return [
        {
          key: 'type',
          label: 'Kind',
          kind: 'select',
          options: [
            { value: 'standupTarget', label: 'Standup' },
            { value: 'dropTarget', label: 'Drop' },
          ],
          get: (q) => q.type,
          set: (q, v) => ({ ...q, type: v as 'standupTarget' | 'dropTarget' }) as Part,
        },
        prop('angle', 'Faces', 'angle', { step: 5, hint: 'Direction the face points' }),
        prop('width', 'Width', 'length', { step: 0.5, min: 0.012, max: 0.06 }),
        points,
      ];
    case 'gate':
      return [
        prop('angle', 'Passes toward', 'angle', { step: 5, hint: 'The ball can only go through in this direction (the arrow)' }),
        prop('width', 'Width', 'length', { step: 0.5, min: 0.02, max: 0.1 }),
        points,
      ];
    case 'rollover':
      return [prop('radius', 'Radius', 'length', { step: 0.5, min: 0.006, max: 0.03, placeholder: '12' }), points];
    case 'drain':
      return [halfSize(0, 'Width'), halfSize(1, 'Depth')];
    case 'plunger':
      return [prop('width', 'Width', 'length', { step: 0.5, min: 0.015, max: 0.04 }), prop('maxPull', 'Max pull', 'length', { step: 1, min: 0.02, max: 0.1 })];
    case 'ballStart':
      return [];
  }
}

/** Drain size shown as full width/depth; stored as half extents. */
function halfSize(axis: 0 | 1, label: string): FieldSpec {
  const def: Vec2 = [0.1, 0.02];
  return {
    key: axis ? 'depth' : 'width',
    label,
    kind: 'length',
    step: 1,
    min: 0.01,
    get: (p) => 2 * ((p as { halfSize?: Vec2 }).halfSize ?? def)[axis],
    set: (p, v) => {
      const hs: Vec2 = [...((p as { halfSize?: Vec2 }).halfSize ?? def)];
      hs[axis] = roundM(Math.max(0.005, Number(v) / 2));
      return { ...p, halfSize: hs } as Part;
    },
  };
}

/** Types that can score points (used for multi-selection editing). */
export function scores(p: Part): boolean {
  return p.type !== 'wall' && p.type !== 'drain' && p.type !== 'plunger' && p.type !== 'ballStart' && p.type !== 'flipper';
}

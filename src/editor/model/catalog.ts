/**
 * The parts palette: every part a player can drag onto the table, with
 * sensible real-world defaults. Each entry builds its parts around a point,
 * so a drop lands exactly where the cursor is. Pure TypeScript (tested).
 */
import type { Vec2 } from '../../core/math/bezier.ts';
import type { Part, TableDef } from '../../core/table/format.ts';
import { anchor, translatePart, unionBounds, partBounds } from './parts.ts';
import { uniqueId } from './history.ts';

export interface CatalogEntry {
  key: string;
  label: string;
  section: string;
  /** One line for the tooltip. */
  hint: string;
  /** The entry's parts, anywhere: placement re-centers them. Ids are stems that get numbered. */
  build(): Part[];
  /** Only one allowed per table (the ball start). */
  single?: boolean;
}

const line = (id: string, pts: Vec2[], thickness: number, material: 'wood' | 'metal' | 'rubber', height?: number): Part => ({
  id,
  type: 'wall',
  thickness,
  material,
  ...(height ? { height } : {}),
  path: { start: pts[0], cmds: pts.slice(1).map((to) => ({ op: 'line' as const, to })) },
});

export const CATALOG: CatalogEntry[] = [
  // flippers
  {
    key: 'flipper-left',
    label: 'Left flipper',
    section: 'Flippers',
    hint: 'Standard 3-inch flipper on the left button',
    build: () => [
      { id: 'flipper-left', type: 'flipper', side: 'left', input: 'left', pivot: [0, 0], length: 0.072, baseRadius: 0.0095, tipRadius: 0.005, restAngle: 30, stroke: 55 },
    ],
  },
  {
    key: 'flipper-right',
    label: 'Right flipper',
    section: 'Flippers',
    hint: 'Standard 3-inch flipper on the right button',
    build: () => [
      { id: 'flipper-right', type: 'flipper', side: 'right', input: 'right', pivot: [0, 0], length: 0.072, baseRadius: 0.0095, tipRadius: 0.005, restAngle: 150, stroke: 55 },
    ],
  },
  // kickers
  {
    key: 'bumper',
    label: 'Pop bumper',
    section: 'Kickers',
    hint: 'Kicks the ball away whenever it touches the skirt',
    build: () => [{ id: 'bumper', type: 'bumper', pos: [0, 0], radius: 0.028, points: 100 }],
  },
  {
    key: 'sling-left',
    label: 'Left slingshot',
    section: 'Kickers',
    hint: 'Kicks from its long rubber face (the right side)',
    build: () => [{ id: 'sling-left', type: 'slingshot', a: [0.075, 0.69], b: [0.13, 0.85], c: [0.075, 0.815], points: 10 }],
  },
  {
    key: 'sling-right',
    label: 'Right slingshot',
    section: 'Kickers',
    hint: 'Kicks from its long rubber face (the left side)',
    build: () => [{ id: 'sling-right', type: 'slingshot', a: [-0.075, 0.69], b: [-0.13, 0.85], c: [-0.075, 0.815], points: 10 }],
  },
  // targets
  {
    key: 'standup',
    label: 'Standup target',
    section: 'Targets',
    hint: 'Scores when hit; stays up',
    build: () => [{ id: 'standup', type: 'standupTarget', pos: [0, 0], angle: 90, width: 0.024, points: 300 }],
  },
  {
    key: 'drop',
    label: 'Drop target',
    section: 'Targets',
    hint: 'Drops into the playfield when hit',
    build: () => [{ id: 'drop', type: 'dropTarget', pos: [0, 0], angle: 90, width: 0.026, points: 250 }],
  },
  {
    key: 'drop-bank',
    label: 'Drop bank ×3',
    section: 'Targets',
    hint: 'Three grouped drop targets: drop them all for a bonus and a reset',
    build: () =>
      [-0.03, 0, 0.03].map((x): Part => ({ id: 'drop', type: 'dropTarget', pos: [x, 0], angle: 90, width: 0.026, points: 250, group: 'drops' })),
  },
  // lanes and switches
  {
    key: 'rollover',
    label: 'Rollover',
    section: 'Lanes & switches',
    hint: 'A switch the ball rolls over; group several to light a bonus',
    build: () => [{ id: 'rollover', type: 'rollover', pos: [0, 0], radius: 0.012, points: 500 }],
  },
  {
    key: 'gate',
    label: 'One-way gate',
    section: 'Lanes & switches',
    hint: 'Lets the ball through one way only (the arrow). Put one across the top of the shooter lane',
    build: () => [{ id: 'gate', type: 'gate', pos: [0, 0], angle: -110, width: 0.036, points: 0 }],
  },
  {
    key: 'top-lanes',
    label: 'Top lanes ×3',
    section: 'Lanes & switches',
    hint: 'Three grouped rollovers between guide rails',
    build: () => [
      ...[-0.0675, -0.0225, 0.0225, 0.0675].map((x, i) => line(`lane-guide-${i + 1}`, [[x, -0.0275], [x, 0.0275]], 0.006, 'metal')),
      ...[-0.045, 0, 0.045].map((x): Part => ({ id: 'lane', type: 'rollover', pos: [x, 0], radius: 0.012, points: 500, group: 'lanes' })),
    ],
  },
  // posts and walls
  {
    key: 'post',
    label: 'Rubber post',
    section: 'Posts & walls',
    hint: 'A post with a rubber ring',
    build: () => [{ id: 'post', type: 'post', pos: [0, 0], radius: 0.008, material: 'postRubber', points: 10 }],
  },
  {
    key: 'peg',
    label: 'Metal peg',
    section: 'Posts & walls',
    hint: 'A bare metal peg: hard and fast',
    build: () => [{ id: 'peg', type: 'post', pos: [0, 0], radius: 0.004, material: 'metal' }],
  },
  {
    key: 'wall',
    label: 'Wall',
    section: 'Posts & walls',
    hint: 'A straight wooden wall',
    build: () => [line('wall', [[-0.05, 0], [0.05, 0]], 0.012, 'wood', 0.05)],
  },
  {
    key: 'rail',
    label: 'Guide rail',
    section: 'Posts & walls',
    hint: 'A thin steel guide rail',
    build: () => [line('rail', [[0, -0.05], [0, 0.05]], 0.006, 'metal', 0.025)],
  },
  {
    key: 'curve',
    label: 'Curved rail',
    section: 'Posts & walls',
    hint: 'A steel rail bent into an arc',
    build: () => [
      {
        id: 'curve',
        type: 'wall',
        thickness: 0.006,
        material: 'metal',
        height: 0.025,
        path: { start: [-0.05, 0.025], cmds: [{ op: 'quad', c: [0, -0.05], to: [0.05, 0.025] }] },
      },
    ],
  },
  {
    key: 'rubber',
    label: 'Rubber band',
    section: 'Posts & walls',
    hint: 'A bouncy rubber stretched between two posts',
    build: () => [line('rubber', [[-0.03, 0], [0.03, 0]], 0.008, 'rubber', 0.03)],
  },
  // structure
  {
    key: 'drain',
    label: 'Drain',
    section: 'Structure',
    hint: 'A ball that reaches this zone is lost',
    build: () => [{ id: 'drain', type: 'drain', pos: [0, 0], halfSize: [0.1, 0.02] }],
  },
  {
    key: 'plunger',
    label: 'Plunger',
    section: 'Structure',
    hint: 'Launches the ball; usually at the bottom of a shooter lane',
    build: () => [{ id: 'plunger', type: 'plunger', pos: [0, 0], width: 0.026, maxPull: 0.06 }],
  },
  {
    key: 'ball-start',
    label: 'Ball start',
    section: 'Structure',
    hint: 'Where each new ball appears (one per table)',
    single: true,
    build: () => [{ id: 'ball-start', type: 'ballStart', pos: [0, 0] }],
  },
];

export const CATALOG_SECTIONS = [...new Set(CATALOG.map((e) => e.section))];

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.key === key);
}

/** Can this entry be added to the table right now? */
export function canPlace(e: CatalogEntry, table: TableDef): boolean {
  if (!e.single) return true;
  const type = e.build()[0].type;
  return !table.parts.some((p) => p.type === type);
}

/** The point the parts of an entry are centered on (what follows the cursor). */
export function groupAnchor(parts: Part[]): Vec2 {
  if (parts.length === 1) return anchor(parts[0]);
  const b = unionBounds(parts.map(partBounds))!;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/**
 * Build an entry's parts with their anchor at `at`, with ids (and group names)
 * that don't clash with anything already on the table.
 */
export function instantiate(e: CatalogEntry, table: TableDef, at: Vec2): Part[] {
  const raw = e.build();
  const [ax, ay] = groupAnchor(raw);
  const taken = new Set<string>();
  const groups = new Map<string, string>();
  const usedGroups = new Set(table.parts.map((p) => p.group).filter(Boolean));
  return raw.map((p) => {
    const moved = translatePart(p, at[0] - ax, at[1] - ay);
    const id = e.single ? p.id : uniqueId(table, p.id, taken);
    taken.add(id);
    let group = p.group;
    if (group) {
      if (!groups.has(group)) {
        let name = group;
        for (let n = 2; usedGroups.has(name); n++) name = `${group}-${n}`;
        groups.set(group, name);
      }
      group = groups.get(group);
    }
    return { ...moved, id, ...(group ? { group } : {}) } as Part;
  });
}

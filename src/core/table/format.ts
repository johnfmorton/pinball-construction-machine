/**
 * Pinball Construction Machine table format, version 1.
 *
 * This JSON document is the single contract between the editor, the physics
 * engine, the renderer and the server. Rules for changing it:
 *   - Every breaking change bumps `version` and adds a migration in migrate.ts.
 *   - Unknown fields are preserved by tools that load and re-save a table.
 *
 * Coordinates: meters, origin at the playfield's top-left corner, +x to the
 * right, +y toward the player (down the slope). Angles in the file are degrees,
 * measured clockwise from +x (because +y points down).
 *
 * Height: every part carries an optional `z` (base elevation above the
 * playfield, default 0) and `height`. v1 physics is single-level and ignores
 * `z`, but the field exists from day one so ramps and upper playfields don't
 * need a format break.
 */
import type { Path, Vec2 } from '../math/bezier.ts';
import type { Tuning } from '../physics/tuning.ts';

export const TABLE_FORMAT = 'pcm-table';
export const TABLE_VERSION = 1;

export type MaterialName = 'rubber' | 'flipperRubber' | 'postRubber' | 'metal' | 'wood' | 'plastic' | 'target';

export interface MaterialDef {
  /** Coefficient of restitution at low impact speed. */
  elasticity: number;
  /** Restitution falls off with impact speed: e = elasticity / (1 + falloff * |vn|), vn in m/s. */
  falloff: number;
  /** Coulomb friction coefficient against the ball. */
  friction: number;
}

interface PartBase {
  id: string;
  /** Base elevation (m). Ignored by v1 physics; reserved for ramps / upper playfields. */
  z?: number;
  /** Points awarded when the part is hit or triggered. */
  points?: number;
  /** Optional group name, e.g. a drop-target bank or a set of top lanes. */
  group?: string;
  label?: string;
}

/** A freeform wall, rail, or guide drawn with the pen tool. */
export interface WallPart extends PartBase {
  type: 'wall';
  path: Path;
  /** Wall thickness (m). Walls are swept circles, so ends and corners are rounded. */
  thickness: number;
  height?: number;
  material: MaterialName;
}

export interface FlipperPart extends PartBase {
  type: 'flipper';
  side: 'left' | 'right';
  pivot: Vec2;
  /** Pivot-to-tip center distance (m). */
  length: number;
  baseRadius: number;
  tipRadius: number;
  /** Angle at rest, degrees clockwise from +x. */
  restAngle: number;
  /** How far the flipper swings when energized, degrees (always positive). */
  stroke: number;
  /** Multiplier on the global coil torque. 1 = standard. */
  strength?: number;
  /** Which input button drives it. Defaults to `side`. */
  input?: 'left' | 'right';
  height?: number;
}

/** A rubber post or metal peg. */
export interface PostPart extends PartBase {
  type: 'post';
  pos: Vec2;
  radius: number;
  material: MaterialName;
}

export interface BumperPart extends PartBase {
  type: 'bumper';
  pos: Vec2;
  radius: number;
  /** Outgoing speed added along the contact normal when fired (m/s). Default from tuning. */
  kick?: number;
}

/** Triangle with one kicking rubber face (from `a` to `b`). */
export interface SlingshotPart extends PartBase {
  type: 'slingshot';
  a: Vec2;
  b: Vec2;
  c: Vec2;
  kick?: number;
}

export interface TargetPart extends PartBase {
  type: 'standupTarget' | 'dropTarget';
  /** Center of the target face. */
  pos: Vec2;
  /** Direction the face points (degrees clockwise from +x). */
  angle: number;
  width: number;
}

/** A trigger area the ball rolls over (rollover lanes, spinners later, drain). */
export interface SensorPart extends PartBase {
  type: 'rollover' | 'drain';
  pos: Vec2;
  /** Rollovers are circles; drains are axis-aligned rectangles (half-extents). */
  radius?: number;
  halfSize?: Vec2;
}

export interface PlungerPart extends PartBase {
  type: 'plunger';
  /** Center of the plunger tip at rest. */
  pos: Vec2;
  width: number;
  /** Maximum pull distance (m). */
  maxPull: number;
}

export interface BallStartPart extends PartBase {
  type: 'ballStart';
  pos: Vec2;
}

export type Part =
  | WallPart
  | FlipperPart
  | PostPart
  | BumperPart
  | SlingshotPart
  | TargetPart
  | SensorPart
  | PlungerPart
  | BallStartPart;

export interface TableDef {
  format: typeof TABLE_FORMAT;
  version: typeof TABLE_VERSION;
  meta: {
    name: string;
    author?: string;
    description?: string;
  };
  dimensions: {
    width: number;
    length: number;
    /** Playfield slope in degrees. Real machines are ~6.5°. */
    slope: number;
  };
  rules?: {
    ballsPerGame?: number;
    /** Seconds of ball save after each launch. */
    ballSave?: number;
  };
  /** How the table looks. Purely visual: never read by the physics. */
  appearance?: Appearance;
  /**
   * Per-table physics settings: only the values that differ from the engine
   * defaults (see physics/tuning.ts). Part of the published table, so scores
   * are always verified with the physics the table was built for.
   */
  physics?: Partial<Tuning>;
  /** Per-table overrides of the default material presets. */
  materials?: Partial<Record<MaterialName, Partial<MaterialDef>>>;
  parts: Part[];
}

export type ThemeName = 'midnight' | 'sunset' | 'classic';

export interface Appearance {
  /** Playfield art theme. Default 'midnight'. */
  theme?: ThemeName;
  /** Replaces the theme's accent color (CSS hex, e.g. "#ff8a00"). */
  tint?: string;
  /** Color of the light inserts (CSS hex). */
  insertColor?: string;
}

export const THEMES: ThemeName[] = ['midnight', 'sunset', 'classic'];

export const DEFAULT_MATERIALS: Record<MaterialName, MaterialDef> = {
  rubber: { elasticity: 0.8, falloff: 0.06, friction: 0.6 },
  postRubber: { elasticity: 0.85, falloff: 0.05, friction: 0.6 },
  flipperRubber: { elasticity: 0.75, falloff: 0.1, friction: 0.5 },
  metal: { elasticity: 0.35, falloff: 0.02, friction: 0.12 },
  wood: { elasticity: 0.5, falloff: 0.04, friction: 0.25 },
  plastic: { elasticity: 0.55, falloff: 0.04, friction: 0.18 },
  target: { elasticity: 0.3, falloff: 0.02, friction: 0.2 },
};

// Key list for validation, kept here to avoid a runtime import cycle.
const DEFAULT_TUNING_KEYS: Record<string, true> = Object.fromEntries(
  [
    'gravity', 'slopeOverride', 'ballRadius', 'ballMass', 'floorFriction', 'rollingResistance', 'spinDamping',
    'maxBallSpeed', 'flipperInertia', 'flipperCoilTorque', 'flipperHoldTorque', 'flipperReturnTorque',
    'flipperStopBounce', 'bumperKick', 'slingThreshold', 'slingKick', 'bumperThreshold', 'plungerMass',
    'plungerSpring', 'plungerPullSpeed', 'nudgeStrength', 'tiltPerNudge', 'tiltDecay', 'tiltWarning',
    'tiltThreshold', 'restingSpeed', 'elasticityScale', 'frictionScale',
  ].map((k) => [k, true]),
);

export interface ValidationIssue {
  partId?: string;
  message: string;
}

/** Structural validation. Returns a list of issues; empty means OK. */
export function validateTable(t: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tbl = t as Partial<TableDef>;
  if (!tbl || typeof tbl !== 'object') return [{ message: 'Table is not an object' }];
  if (tbl.format !== TABLE_FORMAT) issues.push({ message: `format must be "${TABLE_FORMAT}"` });
  if (tbl.version !== TABLE_VERSION) issues.push({ message: `unsupported version ${String(tbl.version)}` });
  if (!tbl.dimensions || !(tbl.dimensions.width > 0) || !(tbl.dimensions.length > 0)) {
    issues.push({ message: 'dimensions.width and dimensions.length must be positive' });
  }
  if (!Array.isArray(tbl.parts)) {
    issues.push({ message: 'parts must be an array' });
    return issues;
  }
  const ids = new Set<string>();
  let flippers = 0;
  let starts = 0;
  let drains = 0;
  for (const p of tbl.parts) {
    if (!p.id) issues.push({ message: `a ${p.type} part has no id` });
    else if (ids.has(p.id)) issues.push({ partId: p.id, message: 'duplicate id' });
    ids.add(p.id);
    if (p.type === 'flipper') flippers++;
    if (p.type === 'ballStart') starts++;
    if (p.type === 'drain') drains++;
    if (p.type === 'wall' && !(p.thickness > 0)) issues.push({ partId: p.id, message: 'wall thickness must be > 0' });
  }
  if (tbl.physics !== undefined) {
    if (typeof tbl.physics !== 'object' || tbl.physics === null) issues.push({ message: 'physics must be an object' });
    else
      for (const [k, v] of Object.entries(tbl.physics)) {
        if (!(k in DEFAULT_TUNING_KEYS)) issues.push({ message: `physics.${k} is not a known setting` });
        else if (typeof v !== 'number' || !Number.isFinite(v)) issues.push({ message: `physics.${k} must be a number` });
      }
  }
  if (tbl.appearance) {
    const a = tbl.appearance;
    if (a.theme !== undefined && !THEMES.includes(a.theme)) issues.push({ message: `appearance.theme must be one of ${THEMES.join(', ')}` });
    for (const k of ['tint', 'insertColor'] as const) {
      const v = a[k];
      if (v !== undefined && !/^#[0-9a-fA-F]{6}$/.test(v)) issues.push({ message: `appearance.${k} must be a hex color like #ff8a00` });
    }
  }
  if (starts !== 1) issues.push({ message: 'table needs exactly one ballStart' });
  if (drains < 1) issues.push({ message: 'table needs at least one drain' });
  if (flippers < 1) issues.push({ message: 'table has no flippers' });
  return issues;
}

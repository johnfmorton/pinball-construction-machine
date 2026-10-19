/**
 * The pinball physics world.
 *
 * One call to step() advances exactly STEP seconds (1 ms). The engine is:
 *   - 2D in the plane of the playfield, with the slope folded into gravity.
 *   - Continuous: static parts use exact swept-circle tests, flippers use
 *     conservative advancement against their rotating shape, the plunger uses
 *     a swept test in its moving frame. Fast balls cannot tunnel.
 *   - Spin-aware: the ball carries a 3D angular velocity, so it skids after an
 *     impact and gradually starts rolling, and picks up/delivers english.
 *   - Deterministic: no Math.sin/cos/random, fixed iteration order.
 */
import { dcos, dsin, DEG, clamp } from '../math/dmath.ts';
import { flattenPath } from '../math/bezier.ts';
import {
  DEFAULT_MATERIALS,
  type FlipperPart,
  type MaterialDef,
  type MaterialName,
  type PlungerPart,
  type TableDef,
} from '../table/format.ts';
import { rayCapsule, segmentDistance, taperedCapsuleDistance, type Hit } from './geometry.ts';
import type { Tuning } from './tuning.ts';
import { Rng } from '../math/rng.ts';

export const STEP = 0.001; // seconds per physics step (1000 Hz)
const SLOP = 1e-5; // contact tolerance (m)
const SKIN = 2e-6; // keep balls this far outside surfaces after a hit
const MAX_ITER = 8;

export type Behavior = 'none' | 'bumper' | 'sling' | 'target' | 'drop' | 'gate';

export interface StaticCollider {
  index: number;
  partId: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  material: MaterialName;
  behavior: Behavior;
  /** Part-level kick override (m/s); NaN = use tuning. */
  kick: number;
  enabled: boolean;
  /** Sling face normal (pointing out of the triangle); for a gate, the direction balls may pass. */
  fnx: number;
  fny: number;
  lastFire: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Angular velocity (rad/s): x/y components are rolling, z is english. */
  wx: number;
  wy: number;
  wz: number;
  /** Accumulated roll orientation for the debug renderer (not used by physics). */
  rollX: number;
  rollY: number;
  active: boolean;
  /** Sensor ids the ball is currently inside. */
  inside: Set<string>;
}

export interface Flipper {
  partId: string;
  input: 'left' | 'right';
  px: number;
  py: number;
  length: number;
  rb: number;
  rt: number;
  sinT: number;
  cosT: number;
  rest: number; // radians
  stroke: number; // radians
  /** -1 for left (swings counter-clockwise on screen), +1 for right. */
  upSign: number;
  strength: number;
  /** Swing state: phase 0 = rest, `stroke` = fully up. */
  phase: number;
  phaseVel: number;
  /** Phase at the start of the current step (pose is phase0 + phaseVel·τ). */
  phase0: number;
  pressed: boolean;
}

export interface Plunger {
  partId: string;
  x: number;
  restY: number;
  halfW: number;
  maxPull: number;
  y: number;
  vy: number;
  y0: number;
  held: boolean;
  /** True while the spring is driving the tip back toward rest. */
  firing: boolean;
}

export interface Sensor {
  partId: string;
  kind: 'rollover' | 'drain';
  x: number;
  y: number;
  r: number;
  hx: number;
  hy: number;
}

export type PhysEvent =
  | { type: 'hit'; partId: string; ball: number; speed: number }
  | { type: 'kick'; partId: string; ball: number; kind: 'bumper' | 'sling' }
  | { type: 'target'; partId: string; ball: number }
  | { type: 'drop'; partId: string; ball: number }
  | { type: 'rollover'; partId: string; ball: number }
  | { type: 'gate'; partId: string; ball: number }
  | { type: 'drain'; partId: string; ball: number }
  | { type: 'flipper'; partId: string; up: boolean }
  | { type: 'launch'; speed: number };

interface Contact {
  kind: 'static' | 'flipper' | 'plunger';
  index: number;
  t: number;
  nx: number;
  ny: number;
}

const GRID = 0.05;
/** How close to fully through a gate a ball must be before the gate blocks it (m). */
const GATE_TOLERANCE = 1e-4;

export class World {
  readonly table: TableDef;
  tuning: Tuning;
  materials: Record<MaterialName, MaterialDef>;
  statics: StaticCollider[] = [];
  flippers: Flipper[] = [];
  plungers: Plunger[] = [];
  sensors: Sensor[] = [];
  /** One-way gates (also in `statics`), checked each step for balls passing through. */
  gates: StaticCollider[] = [];
  balls: Ball[] = [];
  events: PhysEvent[] = [];
  stepCount = 0;
  tilted = false;
  private nextBallId = 1;

  // broadphase
  private gridW: number;
  private gridH: number;
  private cells: number[][];
  private stamp: Int32Array;
  private stampId = 0;
  private candidates: number[] = [];

  // scratch
  private hit: Hit = { t: 0, nx: 0, ny: 0 };
  private dist = { d: 0, nx: 0, ny: 0 };

  /** Seeded noise source for cabinet vibration (deterministic per game). */
  private rng: Rng;

  constructor(table: TableDef, tuning: Tuning, seed = 1) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.table = table;
    this.tuning = { ...tuning };
    this.materials = { ...DEFAULT_MATERIALS };
    if (table.materials) {
      for (const k of Object.keys(table.materials) as MaterialName[]) {
        this.materials[k] = { ...DEFAULT_MATERIALS[k], ...table.materials[k] };
      }
    }
    this.build();
    this.gridW = Math.ceil((table.dimensions.width + 0.2) / GRID);
    this.gridH = Math.ceil((table.dimensions.length + 0.2) / GRID);
    this.cells = [];
    for (let i = 0; i < this.gridW * this.gridH; i++) this.cells.push([]);
    for (const c of this.statics) this.insert(c);
    this.stamp = new Int32Array(this.statics.length);
  }

  // ---------------------------------------------------------------- build

  private addStatic(
    partId: string,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: number,
    material: MaterialName,
    behavior: Behavior = 'none',
    kick = NaN,
  ): StaticCollider {
    const c: StaticCollider = {
      index: this.statics.length,
      partId,
      ax,
      ay,
      bx,
      by,
      r,
      material,
      behavior,
      kick,
      enabled: true,
      fnx: 0,
      fny: 0,
      lastFire: -100000,
      minX: Math.min(ax, bx) - r,
      minY: Math.min(ay, by) - r,
      maxX: Math.max(ax, bx) + r,
      maxY: Math.max(ay, by) + r,
    };
    this.statics.push(c);
    return c;
  }

  private build(): void {
    for (const p of this.table.parts) {
      switch (p.type) {
        case 'wall': {
          const pts = flattenPath(p.path);
          for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            this.addStatic(p.id, a[0], a[1], b[0], b[1], p.thickness / 2, p.material);
          }
          break;
        }
        case 'post':
          this.addStatic(p.id, p.pos[0], p.pos[1], p.pos[0], p.pos[1], p.radius, p.material);
          break;
        case 'bumper':
          this.addStatic(p.id, p.pos[0], p.pos[1], p.pos[0], p.pos[1], p.radius, 'plastic', 'bumper', p.kick ?? NaN);
          break;
        case 'slingshot': {
          const r = 0.004;
          const face = this.addStatic(p.id, p.a[0], p.a[1], p.b[0], p.b[1], r, 'rubber', 'sling', p.kick ?? NaN);
          // face normal pointing away from the third vertex
          let nx = -(p.b[1] - p.a[1]);
          let ny = p.b[0] - p.a[0];
          const l = Math.sqrt(nx * nx + ny * ny);
          nx /= l;
          ny /= l;
          if ((p.c[0] - p.a[0]) * nx + (p.c[1] - p.a[1]) * ny > 0) {
            nx = -nx;
            ny = -ny;
          }
          face.fnx = nx;
          face.fny = ny;
          this.addStatic(p.id + ':b', p.b[0], p.b[1], p.c[0], p.c[1], r, 'rubber');
          this.addStatic(p.id + ':c', p.c[0], p.c[1], p.a[0], p.a[1], r, 'rubber');
          break;
        }
        case 'standupTarget':
        case 'dropTarget': {
          // face is perpendicular to the facing direction
          const a = p.angle * DEG;
          const tx = -dsin(a);
          const ty = dcos(a);
          const hw = p.width / 2;
          this.addStatic(
            p.id,
            p.pos[0] - tx * hw,
            p.pos[1] - ty * hw,
            p.pos[0] + tx * hw,
            p.pos[1] + ty * hw,
            0.003,
            'target',
            p.type === 'dropTarget' ? 'drop' : 'target',
          );
          break;
        }
        case 'gate': {
          // the wire runs perpendicular to the pass direction, like a target face
          const a = p.angle * DEG;
          const nx = dcos(a);
          const ny = dsin(a);
          const hw = p.width / 2;
          const g = this.addStatic(p.id, p.pos[0] + ny * hw, p.pos[1] - nx * hw, p.pos[0] - ny * hw, p.pos[1] + nx * hw, 0.0015, 'metal', 'gate');
          g.fnx = nx;
          g.fny = ny;
          this.gates.push(g);
          break;
        }
        case 'rollover':
          this.sensors.push({ partId: p.id, kind: 'rollover', x: p.pos[0], y: p.pos[1], r: p.radius ?? 0.012, hx: 0, hy: 0 });
          break;
        case 'drain':
          this.sensors.push({
            partId: p.id,
            kind: 'drain',
            x: p.pos[0],
            y: p.pos[1],
            r: 0,
            hx: p.halfSize?.[0] ?? 0.1,
            hy: p.halfSize?.[1] ?? 0.02,
          });
          break;
        case 'flipper':
          this.flippers.push(makeFlipper(p));
          break;
        case 'plunger':
          this.plungers.push(makePlunger(p));
          break;
        case 'ballStart':
          break;
      }
    }
  }

  private insert(c: StaticCollider): void {
    const x0 = this.cellX(c.minX);
    const x1 = this.cellX(c.maxX);
    const y0 = this.cellY(c.minY);
    const y1 = this.cellY(c.maxY);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.cells[y * this.gridW + x].push(c.index);
  }

  private cellX(x: number): number {
    return clamp(Math.floor((x + 0.1) / GRID), 0, this.gridW - 1);
  }
  private cellY(y: number): number {
    return clamp(Math.floor((y + 0.1) / GRID), 0, this.gridH - 1);
  }

  private gather(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out = this.candidates;
    out.length = 0;
    this.stampId++;
    const x0 = this.cellX(minX);
    const x1 = this.cellX(maxX);
    const y0 = this.cellY(minY);
    const y1 = this.cellY(maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = this.cells[y * this.gridW + x];
        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (this.stamp[idx] !== this.stampId) {
            this.stamp[idx] = this.stampId;
            out.push(idx);
          }
        }
      }
    }
    // deterministic order regardless of cell traversal
    out.sort((a, b) => a - b);
    return out;
  }

  // ---------------------------------------------------------------- API

  get slopeRad(): number {
    const s = this.tuning.slopeOverride >= 0 ? this.tuning.slopeOverride : this.table.dimensions.slope;
    return s * DEG;
  }

  addBall(x: number, y: number, vx = 0, vy = 0): Ball {
    const b: Ball = {
      id: this.nextBallId++,
      x,
      y,
      vx,
      vy,
      wx: 0,
      wy: 0,
      wz: 0,
      rollX: 0,
      rollY: 0,
      active: true,
      inside: new Set(),
    };
    this.balls.push(b);
    return b;
  }

  removeBall(id: number): void {
    this.balls = this.balls.filter((b) => b.id !== id);
  }

  setFlipperButton(input: 'left' | 'right', pressed: boolean): void {
    for (const f of this.flippers) {
      if (f.input === input && f.pressed !== pressed) {
        f.pressed = pressed;
        this.events.push({ type: 'flipper', partId: f.partId, up: pressed });
      }
    }
  }

  setPlungerHeld(held: boolean): void {
    for (const p of this.plungers) {
      if (held && !p.held) {
        p.held = true;
        p.firing = false;
      } else if (!held && p.held) {
        p.held = false;
        p.firing = p.y > p.restY + 1e-4;
      }
    }
  }

  /** Instantly jolt the table: balls see the opposite velocity change. */
  jolt(dvx: number, dvy: number): void {
    for (const b of this.balls) {
      b.vx -= dvx;
      b.vy -= dvy;
    }
  }

  /** True if a ball of radius r at (x, y) would overlap any solid part. */
  overlaps(x: number, y: number, r: number): boolean {
    return this.partsNear(x, y, r).length > 0;
  }

  /** Ids of solid parts within distance r of (x, y). */
  partsNear(x: number, y: number, r: number): string[] {
    const out = new Set<string>();
    const d = this.dist;
    for (const c of this.statics) {
      if (!c.enabled) continue;
      if (c.behavior === 'gate') continue; // a gate swings open, so it never boxes a ball in
      segmentDistance(c.ax, c.ay, c.bx, c.by, x, y, d);
      if (d.d < c.r + r) out.add(c.partId.split(':')[0]);
    }
    for (const f of this.flippers) {
      this.flipperDistance(f, f.phase, x, y);
      if (d.d < r) out.add(f.partId);
    }
    return [...out].sort();
  }

  resetTargets(partIds: string[]): void {
    const set = new Set(partIds);
    for (const c of this.statics) if (set.has(c.partId)) c.enabled = true;
  }

  // ---------------------------------------------------------------- step

  step(): void {
    const h = STEP;
    const T = this.tuning;
    this.stepCount++;

    this.stepFlippers(h);
    this.stepPlungers(h);

    const gAlong = T.gravity * dsin(this.slopeRad);
    const gNormal = T.gravity * dcos(this.slopeRad);

    for (const b of this.balls) {
      if (!b.active) continue;
      b.vy += gAlong * h;
      this.floorFriction(b, gNormal, h);
      this.vibrate(b, h);
      this.moveBall(b, h);
      this.depenetrate(b);
      // speed limit (safety net)
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > T.maxBallSpeed * T.maxBallSpeed) {
        const s = T.maxBallSpeed / Math.sqrt(sp2);
        b.vx *= s;
        b.vy *= s;
      }
      b.rollX += b.wy * h; // for the renderer's spin marker
      b.rollY -= b.wx * h;
    }

    this.ballBall();
    this.checkSensors();
    this.checkGates();
    this.finishFlippers(h);
    this.finishPlungers(h);
  }

  // ---------------------------------------------------------------- ball/floor

  private floorFriction(b: Ball, gNormal: number, h: number): void {
    const T = this.tuning;
    const R = T.ballRadius;
    const m = T.ballMass;
    const I = 0.4 * m * R * R;
    // velocity of the contact point with the playfield
    const sx = b.vx - R * b.wy;
    const sy = b.vy + R * b.wx;
    const slip = Math.sqrt(sx * sx + sy * sy);
    if (slip > 1e-9) {
      // kinetic friction impulse, capped so it can't overshoot pure rolling
      let J = T.floorFriction * m * gNormal * h;
      const Jmax = (slip * 2 * m) / 7;
      if (J > Jmax) J = Jmax;
      const fx = (-sx / slip) * J;
      const fy = (-sy / slip) * J;
      b.vx += fx / m;
      b.vy += fy / m;
      b.wx += (R * fy) / I;
      b.wy += (-R * fx) / I;
    }
    // rolling resistance: slow the rolling motion without creating slip
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > 1e-9) {
      let dv = T.rollingResistance * gNormal * h;
      if (dv > sp) dv = sp;
      const dvx = (-b.vx / sp) * dv;
      const dvy = (-b.vy / sp) * dv;
      b.vx += dvx;
      b.vy += dvy;
      b.wy += dvx / R;
      b.wx -= dvy / R;
    }
    b.wz *= 1 - T.spinDamping * h;
  }

  /**
   * A real cabinet is never perfectly still (coils, hum, the floor, the
   * player). This tiny random acceleration is what stops a ball from ever
   * balancing on the top of a post or a bumper the way a perfectly still
   * simulation would allow. It's seeded, so replays stay exact. Applied after
   * rolling resistance so it can't be cancelled within the same step.
   */
  private vibrate(b: Ball, h: number): void {
    const a = this.tuning.tableVibration;
    if (a <= 0) return;
    // uniform in [-1, 1] scaled to the requested RMS (uniform RMS = 1/√3)
    const k = a * 1.7320508075688772 * h;
    b.vx += (this.rng.next() * 2 - 1) * k;
    b.vy += (this.rng.next() * 2 - 1) * k;
  }

  // ---------------------------------------------------------------- CCD move

  private moveBall(b: Ball, h: number): void {
    const R = this.tuning.ballRadius;
    let remaining = h;
    let lastIndex = -1;
    let lastKind = '';
    for (let iter = 0; iter < MAX_ITER && remaining > 1e-9; iter++) {
      const c = this.findEarliest(b, h - remaining, remaining, R);
      if (!c) {
        b.x += b.vx * remaining;
        b.y += b.vy * remaining;
        remaining = 0;
        break;
      }
      const dt = c.t * remaining;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      remaining -= dt;
      this.resolve(b, c, h - remaining);
      // nudge out of the surface by a hair to keep the next sweep clean
      b.x += c.nx * SKIN;
      b.y += c.ny * SKIN;
      if (c.index === lastIndex && c.kind === lastKind && dt === 0) {
        // stuck in a corner bouncing between iterations: stop this step
        break;
      }
      lastIndex = c.index;
      lastKind = c.kind;
    }
  }

  private findEarliest(b: Ball, tau0: number, remaining: number, R: number): Contact | null {
    let best: Contact | null = null;
    const dx = b.vx * remaining;
    const dy = b.vy * remaining;
    const pad = R + 0.01;
    const cands = this.gather(
      Math.min(b.x, b.x + dx) - pad,
      Math.min(b.y, b.y + dy) - pad,
      Math.max(b.x, b.x + dx) + pad,
      Math.max(b.y, b.y + dy) + pad,
    );
    const hit = this.hit;
    for (let i = 0; i < cands.length; i++) {
      const c = this.statics[cands[i]];
      if (!c.enabled) continue;
      if (c.behavior === 'gate' && !this.gateBlocks(c, b.x, b.y, R)) continue;
      const t = rayCapsule(b.x, b.y, dx, dy, c.ax, c.ay, c.bx, c.by, c.r + R, hit);
      if (t >= 0 && (best === null || t < best.t)) {
        best = { kind: 'static', index: c.index, t, nx: hit.nx, ny: hit.ny };
      }
    }
    // plunger: swept test in the plunger's moving frame
    for (let i = 0; i < this.plungers.length; i++) {
      const p = this.plungers[i];
      const py = p.y0 + p.vy * tau0;
      const rdy = (b.vy - p.vy) * remaining;
      const t = rayCapsule(b.x, b.y, dx, rdy, p.x - p.halfW, py, p.x + p.halfW, py, 0.003 + R, hit);
      if (t >= 0 && (best === null || t < best.t)) {
        best = { kind: 'plunger', index: i, t, nx: hit.nx, ny: hit.ny };
      }
    }
    // flippers: conservative advancement against the rotating tapered capsule
    for (let i = 0; i < this.flippers.length; i++) {
      const f = this.flippers[i];
      const t = this.flipperTOI(f, b, tau0, remaining, R);
      if (t >= 0 && (best === null || t < best.t)) {
        best = { kind: 'flipper', index: i, t, nx: this.dist.nx, ny: this.dist.ny };
      }
    }
    return best;
  }

  private flipperPhaseAt(f: Flipper, tau: number): number {
    return clamp(f.phase0 + f.phaseVel * tau, 0, f.stroke);
  }

  private flipperDistance(f: Flipper, phase: number, x: number, y: number): void {
    const a = f.rest + f.upSign * phase;
    taperedCapsuleDistance(f.px, f.py, dcos(a), dsin(a), f.length, f.rb, f.rt, f.sinT, f.cosT, x, y, this.dist);
  }

  /** Returns hit fraction of `remaining` in [0,1], or -1. Leaves the normal in this.dist. */
  private flipperTOI(f: Flipper, b: Ball, tau0: number, remaining: number, R: number): number {
    // quick reject: is the ball anywhere near the flipper's swept disc?
    const reach = f.length + f.rb + R + Math.sqrt(b.vx * b.vx + b.vy * b.vy) * remaining + 0.005;
    const ex = b.x - f.px;
    const ey = b.y - f.py;
    if (ex * ex + ey * ey > reach * reach) return -1;

    const omega = Math.abs(f.phaseVel);
    const bound = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + omega * (f.length + f.rt + 0.001);
    let t = 0;
    for (let k = 0; k < 48; k++) {
      const tau = tau0 + t;
      const phase = this.flipperPhaseAt(f, tau);
      const x = b.x + b.vx * t;
      const y = b.y + b.vy * t;
      this.flipperDistance(f, phase, x, y);
      const gap = this.dist.d - R;
      if (gap < SLOP) {
        // touching: only a hit if approaching
        const vn = this.flipperRelNormalVel(f, phase, tau, x, y, b.vx, b.vy, R);
        if (vn < 0) return t / remaining;
        // touching but separating: skip ahead a bit
        t += remaining / 8;
      } else {
        if (bound < 1e-9) return -1;
        t += gap / bound;
      }
      if (t > remaining) return -1;
    }
    return -1;
  }

  private flipperSurfaceVel(f: Flipper, tau: number, cx: number, cy: number): [number, number] {
    // world angular velocity; zero when pinned against a stop
    const phase = f.phase0 + f.phaseVel * tau;
    const moving = phase >= 0 && phase <= f.stroke;
    const w = moving ? f.upSign * f.phaseVel : 0;
    return [-w * (cy - f.py), w * (cx - f.px)];
  }

  private flipperRelNormalVel(
    f: Flipper,
    _phase: number,
    tau: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    R: number,
  ): number {
    const nx = this.dist.nx;
    const ny = this.dist.ny;
    const cx = x - nx * R;
    const cy = y - ny * R;
    const [sx, sy] = this.flipperSurfaceVel(f, tau, cx, cy);
    return (vx - sx) * nx + (vy - sy) * ny;
  }

  // ---------------------------------------------------------------- impulses

  private resolve(b: Ball, c: Contact, tau: number): void {
    const T = this.tuning;
    const R = T.ballRadius;
    const m = T.ballMass;
    const nx = c.nx;
    const ny = c.ny;
    const tx = -ny;
    const ty = nx;
    const cx = b.x - nx * R;
    const cy = b.y - ny * R;

    // surface velocity and the other body's inverse mass terms
    let svx = 0;
    let svy = 0;
    let invN = 0; // other body's inverse effective mass along n
    let invT = 0; // ... along t
    let flipper: Flipper | null = null;
    let plunger: Plunger | null = null;
    let collider: StaticCollider | null = null;
    let mat: MaterialDef;
    let partId: string;

    if (c.kind === 'static') {
      collider = this.statics[c.index];
      mat = this.materials[collider.material];
      partId = collider.partId;
    } else if (c.kind === 'flipper') {
      flipper = this.flippers[c.index];
      mat = this.materials.flipperRubber;
      partId = flipper.partId;
      const phase = flipper.phase0 + flipper.phaseVel * tau;
      const atTop = phase >= flipper.stroke;
      const atBottom = phase <= 0;
      [svx, svy] = this.flipperSurfaceVel(flipper, tau, cx, cy);
      const rx = cx - flipper.px;
      const ry = cy - flipper.py;
      const I = T.flipperInertia;
      const crN = rx * ny - ry * nx; // cross(r, n)
      const crT = rx * ty - ry * tx;
      // impulse on the flipper is -J·n; does it push the flipper into a stop?
      const dPhaseDir = flipper.upSign * -crN;
      let pinned = (atTop && dPhaseDir > 0) || (atBottom && dPhaseDir < 0);
      if (!pinned && (atTop || atBottom)) {
        // Resting against a stop, the coil (or return spring) holds it there
        // unless the hit delivers more angular impulse than it can resist in
        // one step. Without this a cradled ball and the coil trade energy forever.
        const relVn = (b.vx - svx + R * b.wz * ny) * nx + (b.vy - svy - R * b.wz * nx) * ny;
        const holding = atTop && flipper.pressed && !this.tilted ? T.flipperHoldTorque * flipper.strength : T.flipperReturnTorque;
        const angImpulse = Math.abs(crN) * 2 * m * Math.max(0, -relVn);
        if (angImpulse <= holding * STEP) pinned = true;
      }
      if (!pinned) {
        invN = (crN * crN) / I;
        invT = (crT * crT) / I;
      }
    } else {
      plunger = this.plungers[c.index];
      mat = this.materials.metal;
      partId = plunger.partId;
      svx = 0;
      svy = plunger.vy;
      if (plunger.firing) invN = (ny * ny) / T.plungerMass;
    }

    // relative velocity at the contact point (includes english)
    const rvx = b.vx - svx + R * b.wz * ny;
    const rvy = b.vy - svy - R * b.wz * nx;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const speed = -vn;

    let e = (mat.elasticity * T.elasticityScale) / (1 + mat.falloff * speed);
    if (speed < T.restingSpeed) e = 0;
    if (e > 0.98) e = 0.98;

    const Jn = (-(1 + e) * vn) / (1 / m + invN);
    b.vx += (Jn * nx) / m;
    b.vy += (Jn * ny) / m;

    // friction (Coulomb), coupling into the ball's english (wz)
    const vt = rvx * tx + rvy * ty;
    let Jt = -vt / (3.5 / m + invT);
    const mu = mat.friction * T.frictionScale;
    const lim = mu * Jn;
    if (Jt > lim) Jt = lim;
    else if (Jt < -lim) Jt = -lim;
    b.vx += (Jt * tx) / m;
    b.vy += (Jt * ty) / m;
    b.wz += (-2.5 * Jt) / (m * R);

    if (flipper && invN > 0) {
      const I = T.flipperInertia;
      const rx = cx - flipper.px;
      const ry = cy - flipper.py;
      // angular impulse from -(Jn n + Jt t) at r
      const ang = -(rx * (Jn * ny + Jt * ty) - ry * (Jn * nx + Jt * tx));
      const dPhaseVel = (flipper.upSign * ang) / I;
      // re-anchor the pose so it stays continuous at tau
      const phaseNow = clamp(flipper.phase0 + flipper.phaseVel * tau, 0, flipper.stroke);
      flipper.phaseVel += dPhaseVel;
      flipper.phase0 = phaseNow - flipper.phaseVel * tau;
    }
    if (plunger && invN > 0) {
      const yNow = plunger.y0 + plunger.vy * tau;
      plunger.vy -= (Jn * ny) / T.plungerMass;
      plunger.y0 = yNow - plunger.vy * tau;
    }

    if (speed > 0.05) this.events.push({ type: 'hit', partId, ball: b.id, speed });

    if (collider) this.behaviors(b, collider, speed, nx, ny);
  }

  private behaviors(b: Ball, c: StaticCollider, speed: number, nx: number, ny: number): void {
    const T = this.tuning;
    switch (c.behavior) {
      case 'bumper':
        // A pop bumper's skirt switch closes on any real hit, and also when a
        // ball merely rests on it (speed below restingSpeed), so a bumper can
        // never hold a ball. Only a glancing graze in between doesn't fire.
        if (!this.tilted && (speed >= T.bumperThreshold || speed < T.restingSpeed) && this.stepCount - c.lastFire > 30) {
          c.lastFire = this.stepCount;
          const k = Number.isNaN(c.kick) ? T.bumperKick : c.kick;
          b.vx += nx * k;
          b.vy += ny * k;
          this.events.push({ type: 'kick', partId: c.partId, ball: b.id, kind: 'bumper' });
        }
        break;
      case 'sling': {
        // only the rubber face kicks, and only on a real hit (not a graze)
        const into = nx * c.fnx + ny * c.fny;
        if (!this.tilted && into > 0.3 && speed >= T.slingThreshold && this.stepCount - c.lastFire > 60) {
          c.lastFire = this.stepCount;
          const k = Number.isNaN(c.kick) ? T.slingKick : c.kick;
          const vnF = b.vx * c.fnx + b.vy * c.fny;
          const add = vnF < 0 ? k - vnF : k;
          b.vx += c.fnx * add;
          b.vy += c.fny * add;
          this.events.push({ type: 'kick', partId: c.partId, ball: b.id, kind: 'sling' });
        }
        break;
      }
      case 'target':
        if (speed > 0.1) this.events.push({ type: 'target', partId: c.partId, ball: b.id });
        break;
      case 'drop':
        if (speed > 0.2) {
          c.enabled = false;
          this.events.push({ type: 'drop', partId: c.partId, ball: b.id });
        }
        break;
      default:
        break;
    }
  }

  /** Signed distance of (x, y) from a gate's wire line, positive on the side balls pass toward. */
  private gateSide(c: StaticCollider, x: number, y: number): number {
    return (x - c.ax) * c.fnx + (y - c.ay) * c.fny;
  }

  /**
   * A gate is solid only for a ball that is fully clear of it on the far
   * (exit) side: that ball can't come back through. A ball arriving from the
   * near side, or still part-way through with the flap swung up, passes freely.
   */
  private gateBlocks(c: StaticCollider, x: number, y: number, R: number): boolean {
    return this.gateSide(c, x, y) >= c.r + R - GATE_TOLERANCE;
  }

  /** Report balls that make it all the way through a gate (for scoring and sound). */
  private checkGates(): void {
    const R = this.tuning.ballRadius;
    for (const c of this.gates) {
      const lx = c.bx - c.ax;
      const ly = c.by - c.ay;
      const len2 = lx * lx + ly * ly;
      for (const b of this.balls) {
        if (!b.active) continue;
        const s = this.gateSide(c, b.x, b.y);
        const u = ((b.x - c.ax) * lx + (b.y - c.ay) * ly) / len2;
        const key = 'gate:' + c.partId;
        const inside = s > -(c.r + R) && s < c.r + R - GATE_TOLERANCE && u > -0.1 && u < 1.1;
        const was = b.inside.has(key);
        if (inside && !was) b.inside.add(key);
        else if (!inside && was) {
          b.inside.delete(key);
          if (s > 0) this.events.push({ type: 'gate', partId: c.partId, ball: b.id });
        }
      }
    }
  }

  /** Discrete safety pass: push the ball out of anything it ended up inside. */
  private depenetrate(b: Ball): void {
    const R = this.tuning.ballRadius;
    const cands = this.gather(b.x - R - 0.01, b.y - R - 0.01, b.x + R + 0.01, b.y + R + 0.01);
    const d = this.dist;
    for (let i = 0; i < cands.length; i++) {
      const c = this.statics[cands[i]];
      if (!c.enabled) continue;
      if (c.behavior === 'gate' && !this.gateBlocks(c, b.x, b.y, R)) continue;
      segmentDistance(c.ax, c.ay, c.bx, c.by, b.x, b.y, d);
      const pen = c.r + R - d.d;
      if (pen > 0) {
        b.x += d.nx * (pen + SKIN);
        b.y += d.ny * (pen + SKIN);
        this.resolve(b, { kind: 'static', index: c.index, t: 0, nx: d.nx, ny: d.ny }, STEP);
      }
    }
    for (let i = 0; i < this.flippers.length; i++) {
      const f = this.flippers[i];
      const phase = this.flipperPhaseAt(f, STEP);
      this.flipperDistance(f, phase, b.x, b.y);
      const pen = R - d.d;
      if (pen > 0) {
        const nx = d.nx;
        const ny = d.ny;
        b.x += nx * (pen + SKIN);
        b.y += ny * (pen + SKIN);
        this.resolve(b, { kind: 'flipper', index: i, t: 0, nx, ny }, STEP);
      }
    }
    for (let i = 0; i < this.plungers.length; i++) {
      const p = this.plungers[i];
      const py = p.y0 + p.vy * STEP;
      segmentDistance(p.x - p.halfW, py, p.x + p.halfW, py, b.x, b.y, d);
      const pen = 0.003 + R - d.d;
      if (pen > 0) {
        b.x += d.nx * (pen + SKIN);
        b.y += d.ny * (pen + SKIN);
        this.resolve(b, { kind: 'plunger', index: i, t: 0, nx: d.nx, ny: d.ny }, STEP);
      }
    }
  }

  private ballBall(): void {
    const R = this.tuning.ballRadius;
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const c = bs[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 < 1e-18) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const pen = 2 * R - d;
        a.x -= nx * pen * 0.5;
        a.y -= ny * pen * 0.5;
        c.x += nx * pen * 0.5;
        c.y += ny * pen * 0.5;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vn < 0) {
          const e = -vn < this.tuning.restingSpeed ? 0 : 0.92;
          const j2 = (-(1 + e) * vn) / 2;
          a.vx -= j2 * nx;
          a.vy -= j2 * ny;
          c.vx += j2 * nx;
          c.vy += j2 * ny;
          if (-vn > 0.05) this.events.push({ type: 'hit', partId: 'ball', ball: a.id, speed: -vn });
        }
      }
    }
  }

  private checkSensors(): void {
    for (const b of this.balls) {
      if (!b.active) continue;
      // safety: a ball that somehow leaves the cabinet counts as drained
      const W = this.table.dimensions.width;
      const L = this.table.dimensions.length;
      if (!(b.x > -0.05 && b.x < W + 0.05 && b.y > -0.05 && b.y < L + 0.05)) {
        b.active = false;
        this.events.push({ type: 'drain', partId: 'out-of-bounds', ball: b.id });
        continue;
      }
      for (const s of this.sensors) {
        let inside: boolean;
        if (s.kind === 'rollover') {
          const dx = b.x - s.x;
          const dy = b.y - s.y;
          inside = dx * dx + dy * dy < s.r * s.r;
        } else {
          inside = Math.abs(b.x - s.x) < s.hx && Math.abs(b.y - s.y) < s.hy;
        }
        const was = b.inside.has(s.partId);
        if (inside && !was) {
          b.inside.add(s.partId);
          if (s.kind === 'drain') {
            b.active = false;
            this.events.push({ type: 'drain', partId: s.partId, ball: b.id });
          } else {
            this.events.push({ type: 'rollover', partId: s.partId, ball: b.id });
          }
        } else if (!inside && was) {
          b.inside.delete(s.partId);
        }
      }
    }
    if (this.balls.some((b) => !b.active)) this.balls = this.balls.filter((b) => b.active);
  }

  // ---------------------------------------------------------------- flippers

  private stepFlippers(h: number): void {
    const T = this.tuning;
    for (const f of this.flippers) {
      const pressed = f.pressed && !this.tilted;
      let torque: number;
      if (pressed) {
        torque = (f.phase >= f.stroke - 1e-6 ? T.flipperHoldTorque : T.flipperCoilTorque) * f.strength;
      } else {
        torque = -T.flipperReturnTorque;
      }
      f.phaseVel += (torque / T.flipperInertia) * h;
      // resting against a stop and pushed into it: stay put
      if (f.phase <= 0 && f.phaseVel < 0) f.phaseVel = 0;
      if (f.phase >= f.stroke && f.phaseVel > 0) f.phaseVel = 0;
      f.phase0 = f.phase;
    }
  }

  private finishFlippers(h: number): void {
    const bounce = this.tuning.flipperStopBounce;
    for (const f of this.flippers) {
      let p = f.phase0 + f.phaseVel * h;
      if (p >= f.stroke) {
        p = f.stroke;
        if (f.phaseVel > 0) f.phaseVel = f.phaseVel > 2 ? -f.phaseVel * bounce : 0;
      } else if (p <= 0) {
        p = 0;
        if (f.phaseVel < 0) f.phaseVel = f.phaseVel < -2 ? -f.phaseVel * bounce : 0;
      }
      f.phase = p;
      f.phase0 = p;
    }
  }

  // ---------------------------------------------------------------- plunger

  private stepPlungers(h: number): void {
    const T = this.tuning;
    for (const p of this.plungers) {
      if (p.held) {
        p.vy = p.y < p.restY + p.maxPull ? T.plungerPullSpeed : 0;
      } else if (p.firing) {
        p.vy += ((-T.plungerSpring * (p.y - p.restY)) / T.plungerMass) * h;
      } else {
        p.vy = 0;
      }
      p.y0 = p.y;
    }
  }

  private finishPlungers(h: number): void {
    for (const p of this.plungers) {
      let y = p.y0 + p.vy * h;
      if (p.held && y > p.restY + p.maxPull) y = p.restY + p.maxPull;
      if (y <= p.restY && !p.held) {
        if (p.firing) this.events.push({ type: 'launch', speed: -p.vy });
        y = p.restY;
        p.vy = 0;
        p.firing = false;
      }
      p.y = y;
      p.y0 = y;
    }
  }

  // ---------------------------------------------------------------- snapshot

  flipperAngle(f: Flipper): number {
    return f.rest + f.upSign * f.phase;
  }
}

function makeFlipper(p: FlipperPart): Flipper {
  // Tilt of the straight sides: the surface narrows from base to tip, so the
  // outward side normal leans toward the tip by asin((rb - rt) / L).
  const sinT = (p.baseRadius - p.tipRadius) / p.length;
  return {
    partId: p.id,
    input: p.input ?? p.side,
    px: p.pivot[0],
    py: p.pivot[1],
    length: p.length,
    rb: p.baseRadius,
    rt: p.tipRadius,
    sinT,
    cosT: Math.sqrt(1 - sinT * sinT),
    rest: p.restAngle * DEG,
    stroke: p.stroke * DEG,
    upSign: p.side === 'left' ? -1 : 1,
    strength: p.strength ?? 1,
    phase: 0,
    phaseVel: 0,
    phase0: 0,
    pressed: false,
  };
}

function makePlunger(p: PlungerPart): Plunger {
  return {
    partId: p.id,
    x: p.pos[0],
    restY: p.pos[1],
    halfW: p.width / 2,
    maxPull: p.maxPull,
    y: p.pos[1],
    vy: 0,
    y0: p.pos[1],
    held: false,
    firing: false,
  };
}

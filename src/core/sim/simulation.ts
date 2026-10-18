/**
 * Simulation = physics world + game rules + input handling.
 *
 * Everything that affects the score lives here and is driven only by
 * (table, tuning, seed, inputs-by-step). That makes a game exactly
 * reproducible: record the inputs, re-run them anywhere, get the same score.
 */
import { Rng } from '../math/rng.ts';
import type { TableDef, Part, BallStartPart } from '../table/format.ts';
import { tableTuning, type Tuning } from '../physics/tuning.ts';
import { World, STEP, type PhysEvent } from '../physics/world.ts';

export type InputKind =
  | 'flipperLeft'
  | 'flipperRight'
  | 'plunger'
  | 'nudge'
  | 'startGame'
  | 'placeBall'
  | 'addBall';

/** [step, kind, value]. Value: 0/1 for buttons, [dx, dy] for nudge, [x, y, vx, vy] for placeBall. */
export type InputRecord = [number, InputKind, (number | number[])?];

export type GameEvent =
  | PhysEvent
  | { type: 'score'; partId: string; points: number }
  | { type: 'tiltWarning'; level: number }
  | { type: 'tilt' }
  | { type: 'ballSaved' }
  | { type: 'ballLost'; ball: number }
  | { type: 'gameOver'; score: number }
  | { type: 'groupComplete'; group: string };

export interface GameState {
  score: number;
  ball: number;
  ballsPerGame: number;
  multiplier: number;
  gameOver: boolean;
  started: boolean;
  tilted: boolean;
  tiltMeter: number;
  ballSaveActive: boolean;
  lit: string[];
  /** True if debug inputs (placing balls) were used: not eligible for high scores. */
  debug: boolean;
}

interface Timer {
  at: number;
  fn: () => void;
}

export class Simulation {
  readonly table: TableDef;
  readonly seed: number;
  world: World;
  rng: Rng;
  state: GameState;
  /** Inputs applied so far, for replays. */
  readonly inputs: InputRecord[] = [];
  /** Events produced since the last drainEvents() call. */
  private pending: GameEvent[] = [];
  private timers: Timer[] = [];
  private parts = new Map<string, Part>();
  private groups = new Map<string, string[]>();
  private lit = new Set<string>();
  private ballSaveUntil = 0;
  private ballSaveArmed = false;
  private lastTiltWarning = 0;

  /** `tuning` defaults to the table's own physics (engine defaults + table.physics). */
  constructor(table: TableDef, tuning: Tuning = tableTuning(table), seed = 1) {
    this.table = table;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.world = new World(table, tuning, seed);
    for (const p of table.parts) {
      this.parts.set(p.id, p);
      if (p.group) {
        const g = this.groups.get(p.group) ?? [];
        g.push(p.id);
        this.groups.set(p.group, g);
      }
    }
    this.state = {
      score: 0,
      ball: 0,
      ballsPerGame: table.rules?.ballsPerGame ?? 3,
      multiplier: 1,
      gameOver: false,
      started: false,
      tilted: false,
      tiltMeter: 0,
      ballSaveActive: false,
      lit: [],
      debug: false,
    };
  }

  get steps(): number {
    return this.world.stepCount;
  }

  get time(): number {
    return this.world.stepCount * STEP;
  }

  setTuning(t: Tuning): void {
    this.world.tuning = { ...t };
  }

  // ------------------------------------------------------------- inputs

  /** Apply an input before the next step. Recorded for replay. */
  input(kind: InputKind, value?: number | number[]): void {
    // A new game starts from a fresh world at step 0, so a replay contains
    // only that game rather than everything since the page loaded.
    if (kind === 'startGame') this.resetWorld();
    const rec: InputRecord = value === undefined ? [this.steps, kind] : [this.steps, kind, value];
    this.inputs.push(rec);
    this.applyInput(kind, value);
  }

  private applyInput(kind: InputKind, value?: number | number[]): void {
    const w = this.world;
    switch (kind) {
      case 'flipperLeft':
      case 'flipperRight': {
        const side = kind === 'flipperLeft' ? 'left' : 'right';
        const down = value === 1;
        w.setFlipperButton(side, down);
        if (down && !this.state.tilted) this.rotateLaneLights(side);
        break;
      }
      case 'plunger':
        w.setPlungerHeld(value === 1);
        break;
      case 'nudge': {
        const [dx, dy] = value as number[];
        this.nudge(dx, dy);
        break;
      }
      case 'startGame':
        this.startGame();
        break;
      case 'placeBall': {
        const [x, y, vx, vy] = value as number[];
        this.state.debug = true;
        w.addBall(x, y, vx, vy);
        break;
      }
      case 'addBall':
        this.state.debug = true;
        this.serveBall();
        break;
    }
  }

  // ------------------------------------------------------------- game flow

  private resetWorld(): void {
    this.world = new World(this.table, this.world.tuning, this.seed);
    this.rng = new Rng(this.seed);
    this.inputs.length = 0;
    this.timers = [];
  }

  private startGame(): void {
    this.state.score = 0;
    this.state.ball = 1;
    this.state.multiplier = 1;
    this.state.gameOver = false;
    this.state.started = true;
    this.state.debug = this.inputs.some((r) => r[1] === 'placeBall' || r[1] === 'addBall');
    this.lit.clear();
    this.timers = [];
    this.ballSaveUntil = 0;
    for (const b of [...this.world.balls]) this.world.removeBall(b.id);
    for (const [, ids] of this.groups) this.world.resetTargets(ids);
    this.resetTilt();
    this.serveBall();
  }

  private ballStart(): BallStartPart | undefined {
    return this.table.parts.find((p): p is BallStartPart => p.type === 'ballStart');
  }

  private serveBall(withBallSave = true): void {
    const s = this.ballStart();
    if (!s) return;
    this.world.addBall(s.pos[0], s.pos[1]);
    if (!withBallSave) return;
    // ball save starts when the ball is launched (or now, if there is no plunger)
    if (this.world.plungers.length === 0) this.armBallSave();
    else this.ballSaveArmed = true;
  }

  private armBallSave(): void {
    const secs = this.table.rules?.ballSave ?? 0;
    this.ballSaveUntil = this.steps + Math.round(secs / STEP);
    this.ballSaveArmed = false;
  }

  private resetTilt(): void {
    this.state.tilted = false;
    this.state.tiltMeter = 0;
    this.world.tilted = false;
    this.lastTiltWarning = 0;
  }

  private nudge(dx: number, dy: number): void {
    const T = this.world.tuning;
    const s = T.nudgeStrength;
    // the cabinet lurches, then stops ~40 ms later; balls feel both halves
    this.world.jolt(dx * s, dy * s);
    this.after(40, () => this.world.jolt(-dx * s, -dy * s));
    if (!this.state.started || this.state.gameOver || this.state.tilted) return;
    this.state.tiltMeter += T.tiltPerNudge;
    if (this.state.tiltMeter >= T.tiltThreshold) {
      this.state.tilted = true;
      this.world.tilted = true;
      this.world.setFlipperButton('left', false);
      this.world.setFlipperButton('right', false);
      this.emit({ type: 'tilt' });
    } else if (this.state.tiltMeter >= T.tiltWarning) {
      this.lastTiltWarning++;
      this.emit({ type: 'tiltWarning', level: this.lastTiltWarning });
    }
  }

  private after(steps: number, fn: () => void): void {
    this.timers.push({ at: this.steps + steps, fn });
  }

  // ------------------------------------------------------------- step

  step(): void {
    const w = this.world;
    w.events.length = 0;
    w.step();

    // tilt meter decays continuously
    if (this.state.tiltMeter > 0) {
      this.state.tiltMeter = Math.max(0, this.state.tiltMeter - w.tuning.tiltDecay * STEP);
    }

    for (const ev of w.events) {
      this.pending.push(ev);
      this.handle(ev);
    }

    if (this.timers.length) {
      const now = this.steps;
      const due = this.timers.filter((t) => t.at <= now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > now);
        for (const t of due) t.fn();
      }
    }
    this.state.ballSaveActive = this.steps < this.ballSaveUntil;
  }

  private award(partId: string, points: number | undefined): void {
    if (!points || !this.state.started || this.state.gameOver || this.state.tilted) return;
    const p = points * this.state.multiplier;
    this.state.score += p;
    this.emit({ type: 'score', partId, points: p });
  }

  private handle(ev: PhysEvent): void {
    switch (ev.type) {
      case 'kick':
        this.award(ev.partId, this.parts.get(ev.partId)?.points);
        break;
      case 'target':
        this.award(ev.partId, this.parts.get(ev.partId)?.points);
        break;
      case 'hit': {
        const p = this.parts.get(ev.partId);
        if (p && p.type === 'post' && ev.speed > 0.3) this.award(ev.partId, p.points);
        break;
      }
      case 'drop': {
        const p = this.parts.get(ev.partId);
        this.award(ev.partId, p?.points);
        if (p?.group) this.checkDropGroup(p.group);
        break;
      }
      case 'rollover': {
        const p = this.parts.get(ev.partId);
        this.award(ev.partId, p?.points);
        if (p?.group) {
          this.lit.add(p.id);
          this.syncLit();
          const ids = this.groups.get(p.group)!;
          if (ids.every((id) => this.lit.has(id))) {
            for (const id of ids) this.lit.delete(id);
            this.syncLit();
            this.state.multiplier = Math.min(5, this.state.multiplier + 1);
            this.award(p.group, 2000);
            this.emit({ type: 'groupComplete', group: p.group });
          }
        }
        break;
      }
      case 'launch':
        if (this.ballSaveArmed) this.armBallSave();
        break;
      case 'drain':
        this.onDrain(ev.ball);
        break;
      default:
        break;
    }
  }

  private checkDropGroup(group: string): void {
    const ids = this.groups.get(group)!;
    const statics = this.world.statics.filter((c) => ids.includes(c.partId));
    if (statics.every((c) => !c.enabled)) {
      this.award(group, 5000);
      this.emit({ type: 'groupComplete', group });
      this.after(1200, () => this.world.resetTargets(ids));
    }
  }

  private onDrain(ballId: number): void {
    if (!this.state.started || this.state.gameOver) return;
    if (this.steps < this.ballSaveUntil && !this.state.tilted) {
      this.emit({ type: 'ballSaved' });
      this.serveBall(false);
      this.ballSaveUntil = 0;
      return;
    }
    if (this.world.balls.some((b) => b.active)) return; // multiball continues
    this.emit({ type: 'ballLost', ball: ballId });
    this.resetTilt();
    this.state.multiplier = 1;
    if (this.state.ball >= this.state.ballsPerGame) {
      this.state.gameOver = true;
      this.emit({ type: 'gameOver', score: this.state.score });
    } else {
      this.state.ball++;
      this.after(800, () => this.serveBall());
    }
  }

  /** Classic lane change: flipper buttons rotate the lit top lanes. */
  private rotateLaneLights(side: 'left' | 'right'): void {
    const ids = this.groups.get('toplanes');
    if (!ids || ids.length < 2) return;
    const on = ids.map((id) => this.lit.has(id));
    const rotated = side === 'left' ? [...on.slice(1), on[0]] : [on[on.length - 1], ...on.slice(0, -1)];
    ids.forEach((id, i) => (rotated[i] ? this.lit.add(id) : this.lit.delete(id)));
    this.syncLit();
  }

  private syncLit(): void {
    this.state.lit = [...this.lit].sort();
  }

  private emit(e: GameEvent): void {
    this.pending.push(e);
  }

  drainEvents(): GameEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }
}

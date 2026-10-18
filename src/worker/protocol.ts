import type { TableDef } from '../core/table/format.ts';
import type { Tuning } from '../core/physics/tuning.ts';
import type { GameEvent, GameState, InputKind } from '../core/sim/simulation.ts';
import type { Replay } from '../core/sim/replay.ts';

export type ToWorker =
  | { type: 'load'; table: TableDef; tuning: Tuning; seed: number }
  | { type: 'input'; kind: InputKind; value?: number | number[] }
  | { type: 'tuning'; tuning: Tuning }
  | { type: 'pause'; paused: boolean }
  | { type: 'stepOnce'; steps: number }
  | { type: 'timeScale'; scale: number }
  | { type: 'getReplay' }
  | { type: 'playReplay'; replay: Replay }
  /** Stop any replay and start over with a fresh table in live mode. */
  | { type: 'reset'; tuning: Tuning };

export interface BallSnap {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
  rollX: number;
  rollY: number;
}

export interface Snapshot {
  step: number;
  time: number;
  balls: BallSnap[];
  /** World angle (radians) of each flipper, in table order. */
  flippers: number[];
  /** Angular velocity of each flipper (rad/s). */
  flipperVel: number[];
  plungers: number[];
  /** Indices of disabled static colliders (dropped targets). */
  disabled: number[];
  state: GameState;
  mode: 'live' | 'replay';
  paused: boolean;
  timeScale: number;
}

export interface Stats {
  /** Physics steps simulated per wall-clock second. */
  stepsPerSecond: number;
  /** Mean CPU time per physics step (µs). */
  stepMicros: number;
}

export type FromWorker =
  | { type: 'frame'; snap: Snapshot; events: GameEvent[]; stats: Stats }
  | { type: 'replay'; replay: Replay }
  | { type: 'replayDone'; ok: boolean; score: number; expected: number; reason?: string }
  | { type: 'error'; message: string };

/**
 * Replays: a game is fully described by (table, tuning, seed, inputs).
 * The server re-runs a submitted replay with the same engine and accepts the
 * score only if it matches exactly.
 */
import type { TableDef } from '../table/format.ts';
import type { Tuning } from '../physics/tuning.ts';
import { Simulation, type InputRecord } from './simulation.ts';

export interface Replay {
  format: 'pcm-replay';
  version: 1;
  tableHash: string;
  tuning: Tuning;
  seed: number;
  /** Total steps simulated. */
  steps: number;
  inputs: InputRecord[];
  score: number;
  debug: boolean;
}

/** FNV-1a over canonical JSON (sorted keys). Stable across engines. */
export function hashJson(value: unknown): string {
  const s = canonical(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export function makeReplay(sim: Simulation): Replay {
  return {
    format: 'pcm-replay',
    version: 1,
    tableHash: hashJson(sim.table),
    tuning: { ...sim.world.tuning },
    seed: sim.seed,
    steps: sim.steps,
    inputs: sim.inputs.map((r) => [...r] as InputRecord),
    score: sim.state.score,
    debug: sim.state.debug,
  };
}

export interface ReplayResult {
  ok: boolean;
  score: number;
  expected: number;
  reason?: string;
  sim: Simulation;
}

/** Re-simulate a replay from scratch. */
export function runReplay(table: TableDef, replay: Replay, onStep?: (sim: Simulation) => void): ReplayResult {
  const sim = new Simulation(table, replay.tuning, replay.seed);
  const tableHash = hashJson(table);
  if (tableHash !== replay.tableHash) {
    return { ok: false, score: 0, expected: replay.score, reason: `table hash mismatch (${tableHash} ≠ ${replay.tableHash})`, sim };
  }
  let i = 0;
  const inputs = replay.inputs;
  for (let s = 0; s < replay.steps; s++) {
    while (i < inputs.length && inputs[i][0] === s) {
      const [, kind, value] = inputs[i];
      sim.input(kind, value);
      i++;
    }
    sim.step();
    onStep?.(sim);
  }
  const score = sim.state.score;
  return {
    ok: score === replay.score,
    score,
    expected: replay.score,
    reason: score === replay.score ? undefined : 'score mismatch',
    sim,
  };
}

/// <reference lib="webworker" />
/**
 * Runs the simulation off the main thread at a fixed 1000 Hz, independent of
 * the render frame rate. The main thread only sends inputs and draws frames.
 */
import { Simulation } from '../core/sim/simulation.ts';
import { makeReplay, hashJson, type Replay } from '../core/sim/replay.ts';
import { STEP } from '../core/physics/world.ts';
import { sameTuning, tableTuning } from '../core/physics/tuning.ts';
import type { GameEvent } from '../core/sim/simulation.ts';
import type { FromWorker, Snapshot, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

let sim: Simulation | null = null;
let paused = false;
let timeScale = 1;
let acc = 0;
let last = performance.now();
let lastPost = 0;
let events: GameEvent[] = [];
let mode: 'live' | 'replay' = 'live';
let replay: Replay | null = null;
let replayCursor = 0;

// stats
let statSteps = 0;
let statCpu = 0;
let statSince = performance.now();
let stats = { stepsPerSecond: 0, stepMicros: 0 };

const MAX_STEPS_PER_TICK = 100; // don't spiral if the tab was suspended

function post(msg: FromWorker): void {
  self.postMessage(msg);
}

function advance(n: number): void {
  if (!sim) return;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    if (mode === 'replay' && replay) {
      const inputs = replay.inputs;
      while (replayCursor < inputs.length && inputs[replayCursor][0] === sim.steps) {
        const [, kind, value] = inputs[replayCursor++];
        sim.input(kind, value);
      }
      if (sim.steps >= replay.steps) {
        const ok = sim.state.score === replay.score;
        post({
          type: 'replayDone',
          ok,
          tuningMatchesTable: sameTuning(replay.tuning, tableTuning(sim.table)),
          score: sim.state.score,
          expected: replay.score,
          reason: ok ? undefined : 'score mismatch',
        });
        mode = 'live';
        replay = null;
        break;
      }
    }
    sim.step();
    const ev = sim.drainEvents();
    if (ev.length) events.push(...ev);
  }
  statCpu += performance.now() - t0;
  statSteps += n;
}

function snapshot(): Snapshot {
  const w = sim!.world;
  const disabled: number[] = [];
  for (const c of w.statics) if (!c.enabled) disabled.push(c.index);
  return {
    step: sim!.steps,
    time: sim!.time,
    balls: w.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, wz: b.wz, rollX: b.rollX, rollY: b.rollY })),
    flippers: w.flippers.map((f) => w.flipperAngle(f)),
    flipperVel: w.flippers.map((f) => (f.phase > 0 && f.phase < f.stroke ? f.upSign * f.phaseVel : 0)),
    plungers: w.plungers.map((p) => p.y),
    disabled,
    state: { ...sim!.state, lit: [...sim!.state.lit] },
    mode,
    paused,
    timeScale,
  };
}

function tick(): void {
  const now = performance.now();
  const elapsed = now - last;
  last = now;
  if (sim && !paused) {
    acc += (elapsed / 1000) * timeScale;
    let n = Math.floor(acc / STEP);
    if (n > MAX_STEPS_PER_TICK) {
      n = MAX_STEPS_PER_TICK;
      acc = 0;
    } else {
      acc -= n * STEP;
    }
    if (n > 0) advance(n);
  }
  if (now - statSince >= 500) {
    const secs = (now - statSince) / 1000;
    stats = { stepsPerSecond: statSteps / secs, stepMicros: statSteps ? (statCpu * 1000) / statSteps : 0 };
    statSteps = 0;
    statCpu = 0;
    statSince = now;
  }
  if (sim && now - lastPost >= 7) {
    lastPost = now;
    post({ type: 'frame', snap: snapshot(), events, stats });
    events = [];
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load':
        sim = new Simulation(msg.table, msg.tuning, msg.seed);
        mode = 'live';
        replay = null;
        acc = 0;
        events = [];
        break;
      case 'input':
        if (sim && mode === 'live') sim.input(msg.kind, msg.value);
        break;
      case 'tuning':
        sim?.setTuning(msg.tuning);
        break;
      case 'pause':
        paused = msg.paused;
        acc = 0;
        break;
      case 'stepOnce':
        advance(msg.steps);
        post({ type: 'frame', snap: snapshot(), events, stats });
        events = [];
        break;
      case 'timeScale':
        timeScale = msg.scale;
        break;
      case 'getReplay':
        if (sim) post({ type: 'replay', replay: makeReplay(sim) });
        break;
      case 'reset':
        if (sim) sim = new Simulation(sim.table, msg.tuning, sim.seed);
        mode = 'live';
        replay = null;
        replayCursor = 0;
        acc = 0;
        events = [];
        break;
      case 'playReplay': {
        if (!sim) break;
        const table = sim.table;
        if (hashJson(table) !== msg.replay.tableHash) {
          post({ type: 'error', message: 'Replay was recorded on a different table.' });
          break;
        }
        sim = new Simulation(table, msg.replay.tuning, msg.replay.seed);
        replay = msg.replay;
        replayCursor = 0;
        mode = 'replay';
        acc = 0;
        events = [];
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

setInterval(tick, 2);

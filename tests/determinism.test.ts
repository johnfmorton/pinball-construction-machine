import { describe, expect, it } from 'vitest';
import { makeReplay, runReplay } from '../src/core/sim/replay.ts';
import { bot, fingerprint, loadTable, run, sim } from './helpers.ts';

function scriptedGame(seconds: number) {
  const s = sim('test-table');
  s.input('startGame');
  s.input('plunger', 1);
  run(s, 450);
  s.input('plunger', 0);
  run(s, seconds * 1000, (x) => {
    bot(x);
    if (x.steps % 3000 === 0) x.input('nudge', [1, 0]);
    // re-plunge whenever a ball sits in the shooter lane
    const b = x.world.balls.find((q) => q.x > 0.476 && q.y > 0.95 && Math.abs(q.vy) < 0.01);
    if (b && !x.world.plungers[0].held) x.input('plunger', 1);
    if (x.world.plungers[0].held && x.world.plungers[0].y >= x.world.plungers[0].restY + 0.05) x.input('plunger', 0);
  });
  return s;
}

describe('determinism', () => {
  it('two identical runs produce bit-identical state', () => {
    const a = scriptedGame(20);
    const b = scriptedGame(20);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.state.score).toBeGreaterThan(0);
  });

  it('a recorded replay re-simulates to the same score and state', () => {
    const live = scriptedGame(20);
    const replay = makeReplay(live);
    const json = JSON.parse(JSON.stringify(replay)); // round-trip through a file
    const res = runReplay(loadTable('test-table'), json);
    expect(res.ok).toBe(true);
    expect(res.score).toBe(live.state.score);
    expect(fingerprint(res.sim)).toBe(fingerprint(live));
  });

  it('a replay against a modified table is rejected', () => {
    const live = scriptedGame(2);
    const t = loadTable('test-table');
    (t.parts.find((p) => p.type === 'bumper') as { radius: number }).radius += 0.001;
    expect(runReplay(t, makeReplay(live)).ok).toBe(false);
  });
});

describe('replay scope', () => {
  it('a replay starts at Start Game, not at page load', () => {
    const s = sim('test-table');
    run(s, 5000); // idle time before the game
    s.input('startGame');
    s.input('plunger', 1);
    run(s, 400);
    s.input('plunger', 0);
    run(s, 3000, bot);
    const replay = makeReplay(s);
    expect(replay.steps).toBe(3400);
    expect(replay.inputs[0]).toEqual([0, 'startGame']);
    expect(runReplay(loadTable('test-table'), replay).ok).toBe(true);
  });
});

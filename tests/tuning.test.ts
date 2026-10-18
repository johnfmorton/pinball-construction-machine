import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, tableTuning, tuningDiff } from '../src/core/physics/tuning.ts';
import { validateTable } from '../src/core/table/format.ts';
import { Simulation } from '../src/core/sim/simulation.ts';
import { makeReplay, runReplay } from '../src/core/sim/replay.ts';
import { loadTable, run } from './helpers.ts';

describe('per-table physics', () => {
  it('a table plays with engine defaults plus its own physics block', () => {
    const t = loadTable('test-table');
    t.physics = { bumperKick: 2.2, gravity: 9.5 };
    const s = new Simulation(t);
    expect(s.world.tuning.bumperKick).toBe(2.2);
    expect(s.world.tuning.gravity).toBe(9.5);
    expect(s.world.tuning.flipperCoilTorque).toBe(DEFAULT_TUNING.flipperCoilTorque);
  });

  it('only stores what differs from the defaults', () => {
    expect(tuningDiff(DEFAULT_TUNING)).toEqual({});
    expect(tuningDiff({ ...DEFAULT_TUNING, slingKick: 1.9 })).toEqual({ slingKick: 1.9 });
    expect(tableTuning({ physics: tuningDiff({ ...DEFAULT_TUNING, slingKick: 1.9 }) }).slingKick).toBe(1.9);
  });

  it('validation rejects unknown or non-numeric settings', () => {
    const t = loadTable('test-table');
    (t as { physics: unknown }).physics = { gravity: 'lots', warpDrive: 1 };
    const msgs = validateTable(t).map((i) => i.message);
    expect(msgs).toContain('physics.gravity must be a number');
    expect(msgs).toContain('physics.warpDrive is not a known setting');
  });

  it('a replay recorded with different settings verifies but is not leaderboard-eligible', () => {
    const t = loadTable('test-table');
    const official = new Simulation(t);
    official.input('startGame');
    run(official, 1000);
    expect(runReplay(t, makeReplay(official)).tuningMatchesTable).toBe(true);

    const lowGravity = new Simulation(t, { ...DEFAULT_TUNING, gravity: 4 });
    lowGravity.input('startGame');
    run(lowGravity, 1000);
    const res = runReplay(t, makeReplay(lowGravity));
    expect(res.ok).toBe(true);
    expect(res.tuningMatchesTable).toBe(false);
  });

  it("changing a table's physics changes its hash, so old replays don't verify against it", () => {
    const t = loadTable('test-table');
    const s = new Simulation(t);
    s.input('startGame');
    run(s, 500);
    const replay = makeReplay(s);
    const tuned = { ...t, physics: { bumperKick: 2 } };
    expect(runReplay(tuned, replay).ok).toBe(false);
  });
});

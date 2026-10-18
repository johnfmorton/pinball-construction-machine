import { describe, expect, it } from 'vitest';
import { dcos, dsin } from '../src/core/math/dmath.ts';
import { flattenPath } from '../src/core/math/bezier.ts';
import { validateTable } from '../src/core/table/format.ts';
import { World } from '../src/core/physics/world.ts';
import { DEFAULT_TUNING } from '../src/core/physics/tuning.ts';
import { bot, loadTable, run, sim, speed } from './helpers.ts';

describe('deterministic math', () => {
  it('dsin/dcos match Math.sin/cos closely', () => {
    for (let x = -20; x <= 20; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-10);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-10);
    }
  });
});

describe('table format', () => {
  it('bundled tables validate', () => {
    expect(validateTable(loadTable('test-table'))).toEqual([]);
  });

  it('Bézier flattening keeps endpoints and stays within tolerance', () => {
    const pts = flattenPath({ start: [0, 0], cmds: [{ op: 'cubic', c1: [0, -1], c2: [1, -1], to: [1, 0] }] });
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([1, 0]);
    expect(pts.length).toBeGreaterThan(10);
  });

  it('reports structural problems', () => {
    const t = loadTable('test-table');
    t.parts.push({ ...t.parts[0] });
    expect(validateTable(t).some((i) => i.message === 'duplicate id')).toBe(true);
  });
});

describe('ball dynamics', () => {
  it('a ball rolling down the slope accelerates at 5/7·g·sinθ (rolling, not sliding)', () => {
    const s = sim('flipper-lab', { rollingResistance: 0 });
    s.input('placeBall', [0.25, 0.2, 0, 0]);
    run(s, 300); // let it settle into rolling
    const v0 = s.world.balls[0].vy;
    run(s, 200);
    const a = (s.world.balls[0].vy - v0) / 0.2;
    const expected = (5 / 7) * 9.81 * Math.sin((6.5 * Math.PI) / 180);
    expect(a).toBeGreaterThan(expected * 0.97);
    expect(a).toBeLessThan(expected * 1.03);
  });

  it('a ball thrown along a flat table skids, then picks up spin and rolls', () => {
    const s = sim('flipper-lab', { slopeOverride: 0, rollingResistance: 0 });
    s.input('placeBall', [0.236, 0.15, 0, 1.5]);
    const R = DEFAULT_TUNING.ballRadius;
    const slip = () => {
      const b = s.world.balls[0];
      return Math.abs(b.vy + R * b.wx);
    };
    run(s, 1);
    expect(slip()).toBeGreaterThan(1.4);
    run(s, 450);
    expect(slip()).toBeLessThan(1e-3);
    // speed after the skid ≈ 5/7 of the initial speed (classic sliding-sphere result)
    expect(speed(s)).toBeGreaterThan(1.5 * (5 / 7) * 0.97);
    expect(speed(s)).toBeLessThan(1.5 * (5 / 7) * 1.01);
  });
});

describe('continuous collision', () => {
  it('a 12 m/s ball never passes through a 6 mm metal guide', () => {
    const table = loadTable('flipper-lab');
    // a lone thin guide in an empty box
    table.parts = table.parts.filter((p) => p.type === 'wall' || p.type === 'drain' || p.type === 'ballStart');
    table.parts.push({ id: 'thin', type: 'wall', thickness: 0.006, material: 'metal', path: { start: [0.05, 0.5], cmds: [{ op: 'line', to: [0.42, 0.5] }] } });
    for (let k = 0; k < 60; k++) {
      const w = new World(table, { ...DEFAULT_TUNING, maxBallSpeed: 30 });
      const ang = -Math.PI / 2 + (k / 60 - 0.5) * 2.6; // fan of directions, all heading up
      const sp = 12;
      const b = w.addBall(0.1 + (k % 10) * 0.03, 0.53, Math.cos(ang) * sp, Math.sin(ang) * sp);
      for (let i = 0; i < 40; i++) w.step();
      expect(b.y).toBeGreaterThan(0.5); // still below the guide
    }
  });

  it('balls are never left overlapping static geometry after a busy game', () => {
    const s = sim('test-table');
    s.input('startGame');
    s.input('plunger', 1);
    run(s, 500);
    s.input('plunger', 0);
    const R = DEFAULT_TUNING.ballRadius;
    let worst = 0;
    const d = { d: 0, nx: 0, ny: 0 };
    run(s, 20000, (x) => {
      bot(x);
      for (const b of x.world.balls) {
        for (const c of x.world.statics) {
          if (!c.enabled) continue;
          const abx = c.bx - c.ax;
          const aby = c.by - c.ay;
          const l2 = abx * abx + aby * aby;
          let t = l2 > 0 ? ((b.x - c.ax) * abx + (b.y - c.ay) * aby) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const dx = b.x - (c.ax + abx * t);
          const dy = b.y - (c.ay + aby * t);
          d.d = Math.sqrt(dx * dx + dy * dy);
          worst = Math.max(worst, c.r + R - d.d);
        }
      }
    });
    expect(worst).toBeLessThan(1e-4); // < 0.1 mm
  });
});

describe('flippers', () => {
  it('cradles a ball on a held-up flipper', () => {
    const s = sim('flipper-lab');
    s.input('flipperLeft', 1);
    run(s, 100);
    s.input('placeBall', [0.19, 0.84, 0, 0]);
    run(s, 3000);
    const b = s.world.balls[0];
    expect(b).toBeDefined();
    expect(speed(s)).toBeLessThan(0.02);
    const f = s.world.flippers.find((x) => x.input === 'left')!;
    expect(Math.hypot(b.x - f.px, b.y - f.py)).toBeLessThan(0.07);
  });

  it('reaches full stroke in roughly 25–50 ms', () => {
    const s = sim('flipper-lab');
    const f = s.world.flippers[0];
    s.input('flipperLeft', 1);
    let t = 0;
    while (f.phase < f.stroke && t < 200) {
      s.step();
      t++;
    }
    expect(t).toBeGreaterThanOrEqual(25);
    expect(t).toBeLessThanOrEqual(50);
  });

  it('a flip from a cradle sends the ball up the playfield hard', () => {
    const s = sim('flipper-lab');
    s.input('flipperLeft', 1);
    run(s, 100);
    s.input('placeBall', [0.19, 0.84, 0, 0]);
    run(s, 2500);
    s.input('flipperLeft', 0); // cradle separation: let it roll to the sweet spot
    run(s, 600);
    s.input('flipperLeft', 1);
    let best = 0;
    run(s, 200, (x) => {
      const b = x.world.balls[0];
      if (b && b.vy < 0) best = Math.max(best, speed(x));
    });
    expect(best).toBeGreaterThan(3.5);
  });

  it('a mid-flipper shot leaves at 3.5+ m/s; a tip shot goes cross-table', () => {
    const shot = (frac: number) => {
      const s = sim('flipper-lab');
      s.input('placeBall', [0.165, 0.89, 0, 0]);
      const f = s.world.flippers.find((x) => x.input === 'left')!;
      let flipped = false;
      let best = 0;
      let angle = 0;
      run(s, 1500, (x) => {
        const b = x.world.balls[0];
        if (!b) return;
        const along = ((b.x - f.px) * Math.cos(f.rest) + (b.y - f.py) * Math.sin(f.rest)) / f.length;
        if (!flipped && along >= frac) {
          x.input('flipperLeft', 1);
          flipped = true;
        }
        if (flipped && b.vy < 0 && speed(x) > best) {
          best = speed(x);
          angle = (Math.atan2(-b.vy, b.vx) * 180) / Math.PI;
        }
      });
      return { best, angle };
    };
    const mid = shot(0.5);
    const late = shot(0.8);
    expect(mid.best).toBeGreaterThan(3.5);
    expect(late.angle).toBeLessThan(mid.angle); // later flip → aimed further right
  });

  it('a ball dropped down the middle drains between the flippers', () => {
    const s = sim('flipper-lab');
    s.input('startGame');
    s.input('placeBall', [0.236, 0.6, 0, 0]);
    let drained = false;
    run(s, 3000, (x) => {
      for (const e of x.drainEvents()) if (e.type === 'drain') drained = true;
    });
    expect(drained).toBe(true);
  });
});

describe('plunger', () => {
  function launch(pullMs: number): number {
    const s = sim('test-table');
    s.input('startGame');
    s.input('plunger', 1);
    run(s, pullMs);
    s.input('plunger', 0);
    let top = 0;
    run(s, 200, (x) => (top = Math.max(top, speed(x))));
    return top;
  }

  it('full pull launches around 4–7 m/s; a short pull is much weaker', () => {
    const full = launch(600);
    const soft = launch(120);
    expect(full).toBeGreaterThan(4);
    expect(full).toBeLessThan(7);
    expect(soft).toBeLessThan(full * 0.4);
  });

  it('the ball rests on the plunger without drifting', () => {
    const s = sim('test-table');
    s.input('startGame');
    run(s, 2000);
    const b = s.world.balls[0];
    expect(speed(s)).toBeLessThan(0.005);
    expect(b.y).toBeGreaterThan(0.97);
  });
});

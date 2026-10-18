/**
 * Headless smoke run: plunge a ball on the test table, print its path, and
 * measure physics throughput. Run: npm run sim
 */
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/core/sim/simulation.ts';
import type { TableDef } from '../src/core/table/format.ts';

const table = JSON.parse(readFileSync(new URL('../tables/test-table.json', import.meta.url), 'utf8')) as TableDef;
const sim = new Simulation(table);
sim.input('startGame');
const pull = Number(process.argv[2] ?? 600);
sim.input('plunger', 1);
for (let i = 0; i < pull; i++) sim.step();
sim.input('plunger', 0);

const t0 = performance.now();
const seconds = Number(process.argv[3] ?? 12);
for (let i = 0; i < seconds * 1000; i++) {
  // simple bot: flip when a ball is near a flipper
  for (const f of sim.world.flippers) {
    const near = sim.world.balls.some((b) => Math.abs(b.x - f.px) < 0.09 && b.y > 0.84 && b.y < 0.93 && b.vy > 0);
    const key = f.input === 'left' ? 'flipperLeft' : 'flipperRight';
    if (near && !f.pressed) sim.input(key, 1);
    if (!near && f.pressed && f.phase >= f.stroke) sim.input(key, 0);
  }
  sim.step();
  if (i % 250 === 0) {
    const b = sim.world.balls[0];
    console.log(
      `t=${sim.time.toFixed(2)}s`,
      b ? `ball (${b.x.toFixed(3)}, ${b.y.toFixed(3)}) v=${Math.sqrt(b.vx * b.vx + b.vy * b.vy).toFixed(2)}` : 'no ball',
      `score=${sim.state.score} ball#=${sim.state.ball}`,
    );
  }
  for (const e of sim.drainEvents()) if (e.type !== 'hit' && e.type !== 'flipper') console.log('   ', JSON.stringify(e));
}
const ms = performance.now() - t0;
console.log(`\n${seconds * 1000} steps in ${ms.toFixed(1)} ms → ${((seconds * 1000) / ms).toFixed(0)} steps/ms (realtime needs 1)`);

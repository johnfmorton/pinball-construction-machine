/**
 * Verify a replay file against a table, the way the server will.
 *   npm run verify-replay -- path/to/replay.json [tables/test-table.json]
 * Exits non-zero if the re-simulated score doesn't match.
 */
import { readFileSync } from 'node:fs';
import { runReplay, type Replay } from '../src/core/sim/replay.ts';
import { validateTable, type TableDef } from '../src/core/table/format.ts';

const [replayPath, tablePath = 'tables/test-table.json'] = process.argv.slice(2);
if (!replayPath) {
  console.error('usage: npm run verify-replay -- <replay.json> [table.json]');
  process.exit(2);
}
const replay = JSON.parse(readFileSync(replayPath, 'utf8')) as Replay;
const table = JSON.parse(readFileSync(tablePath, 'utf8')) as TableDef;
const issues = validateTable(table);
if (issues.length) {
  console.error('invalid table:', issues);
  process.exit(2);
}
const t0 = performance.now();
const res = runReplay(table, replay);
const ms = performance.now() - t0;
console.log(`re-simulated ${(replay.steps / 1000).toFixed(1)} s of play in ${ms.toFixed(0)} ms`);
console.log(`claimed ${replay.score.toLocaleString()} · re-simulated ${res.score.toLocaleString()}${replay.debug ? ' · (debug inputs used: not leaderboard-eligible)' : ''}`);
if (!res.ok) {
  console.error(`REJECTED: ${res.reason}`);
  process.exit(1);
}
console.log('VERIFIED');

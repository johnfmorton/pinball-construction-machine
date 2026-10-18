/**
 * Report spots where a ball can come to rest on a table.
 *   npx tsx scripts/find-traps.ts [tables/test-table.json] [balls]
 */
import { readFileSync } from 'node:fs';
import { findTraps } from '../src/core/table/traps.ts';
import type { TableDef } from '../src/core/table/format.ts';

const path = process.argv[2] ?? 'tables/test-table.json';
const table = JSON.parse(readFileSync(path, 'utf8')) as TableDef;
const balls = Number(process.argv[3] ?? 200);
let failed = false;
for (const dropTargetsDown of [false, true]) {
const r = findTraps(table, { balls, dropTargetsDown, seed: dropTargetsDown ? 11 : 7 });
failed ||= r.traps.length > 0;
console.log(`${table.meta.name}${dropTargetsDown ? ' (drop targets down)' : ''}: dropped ${r.dropped}, drained ${r.drained}, rested on plunger ${r.onPlunger}, trapped ${r.traps.length}`);
const groups = new Map<string, typeof r.traps>();
for (const t of r.traps) {
  const k = `${t.x.toFixed(2)},${t.y.toFixed(2)}`;
  groups.set(k, [...(groups.get(k) ?? []), t]);
}
for (const [k, ts] of groups) console.log(`  trap at (${k}) ×${ts.length} touching: ${ts[0].near.join(', ') || '(nothing — stopped in open space)'}`);
}
process.exit(failed ? 1 : 0);

/**
 * Undo/redo for the table being edited. Tables are small (tens of KB), so
 * each history entry is simply a snapshot of the whole table: simple and
 * impossible to get out of sync. A drag is one entry, not one per mouse move.
 */
import type { TableDef } from '../../core/table/format.ts';

export interface Entry {
  table: TableDef;
  label: string;
}

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  constructor(private limit = 200) {}

  /** Record the state *before* a change. */
  push(before: TableDef, label: string): void {
    this.past.push({ table: before, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: TableDef): Entry | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ table: current, label: e.label });
    return e;
  }

  redo(current: TableDef): Entry | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ table: current, label: e.label });
    return e;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/** A fresh id like "post-3" that isn't used on the table yet. */
export function uniqueId(table: TableDef, base: string, taken = new Set<string>()): string {
  const used = new Set(table.parts.map((p) => p.id));
  for (const t of taken) used.add(t);
  const stem = base.replace(/-\d+$/, '');
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Editor state (Svelte 5 runes). The table is replaced immutably on every
 * edit so history snapshots and change detection stay trivial.
 */
import testTable from '../../tables/test-table.json';
import type { Vec2 } from '../core/math/bezier.ts';
import { validateTable, type Part, type TableDef } from '../core/table/format.ts';
import { History, uniqueId } from './model/history.ts';
import { anchor, mirrorAxis, mirrorPart, partBounds, rotatePart, scalePart, translatePart, unionBounds, type Bounds } from './model/parts.ts';
import type { Guide } from './model/snap.ts';

export const DRAFT_KEY = 'pcm.editor.draft';

function loadDraft(): TableDef {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const t = JSON.parse(raw) as TableDef;
      if (!validateTable(t).length) return t;
    }
  } catch {
    /* no storage or bad draft: start from the test table */
  }
  return structuredClone(testTable as TableDef);
}

export class EditorState {
  table = $state.raw<TableDef>(loadDraft());
  selection = $state.raw<string[]>([]);
  hover = $state<string | null>(null);
  guides = $state.raw<Guide[]>([]);
  snap = $state(true);
  status = $state('');
  /** Bumped on every history change so undo/redo labels re-render. */
  private rev = $state(0);
  private history = new History();
  private dragBefore: TableDef | null = null;
  private saveTimer = 0;

  get canUndo(): boolean {
    void this.rev;
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    void this.rev;
    return this.history.canRedo;
  }
  get undoLabel(): string | undefined {
    void this.rev;
    return this.history.undoLabel;
  }
  get redoLabel(): string | undefined {
    void this.rev;
    return this.history.redoLabel;
  }

  get selectedParts(): Part[] {
    const ids = new Set(this.selection);
    return this.table.parts.filter((p) => ids.has(p.id));
  }

  get selectionBounds(): Bounds | null {
    return unionBounds(this.selectedParts.map(partBounds));
  }

  get selectionCenter(): Vec2 | null {
    const b = this.selectionBounds;
    return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null;
  }

  // ------------------------------------------------------------ editing core

  /** Replace the table as one undoable step. */
  commit(next: TableDef, label: string): void {
    if (next === this.table) return;
    this.history.push(this.table, label);
    this.table = next;
    this.rev++;
    this.changed();
  }

  /** Live edits during a drag: no history until endDrag(). */
  beginDrag(): void {
    this.dragBefore = this.table;
  }
  dragTo(next: TableDef): void {
    this.table = next;
  }
  endDrag(label: string): void {
    if (this.dragBefore && this.dragBefore !== this.table) {
      this.history.push(this.dragBefore, label);
      this.rev++;
      this.changed();
    }
    this.dragBefore = null;
    this.guides = [];
  }
  cancelDrag(): void {
    if (this.dragBefore) this.table = this.dragBefore;
    this.dragBefore = null;
    this.guides = [];
  }

  undo(): void {
    const e = this.history.undo(this.table);
    if (!e) return;
    this.table = e.table;
    this.status = `Undid ${e.label}`;
    this.pruneSelection();
    this.rev++;
    this.changed();
  }

  redo(): void {
    const e = this.history.redo(this.table);
    if (!e) return;
    this.table = e.table;
    this.status = `Redid ${e.label}`;
    this.pruneSelection();
    this.rev++;
    this.changed();
  }

  /** Apply `f` to every selected part. */
  mapSelected(f: (p: Part) => Part, base: TableDef = this.table): TableDef {
    const ids = new Set(this.selection);
    return { ...base, parts: base.parts.map((p) => (ids.has(p.id) ? f(p) : p)) };
  }

  // ------------------------------------------------------------ commands

  select(ids: string[], additive = false): void {
    if (!additive) this.selection = ids;
    else {
      const cur = new Set(this.selection);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      this.selection = [...cur];
    }
  }

  selectAll(): void {
    this.selection = this.table.parts.map((p) => p.id);
  }

  deleteSelected(): void {
    if (!this.selection.length) return;
    const ids = new Set(this.selection);
    const n = ids.size;
    this.commit({ ...this.table, parts: this.table.parts.filter((p) => !ids.has(p.id)) }, n === 1 ? 'delete' : `delete ${n} parts`);
    this.selection = [];
  }

  duplicateSelected(offset: Vec2 = [0.01, 0.01]): void {
    const parts = this.selectedParts;
    if (!parts.length) return;
    const taken = new Set<string>();
    const copies = parts.map((p) => {
      const id = uniqueId(this.table, p.id, taken);
      taken.add(id);
      return { ...translatePart(structuredClone(p), offset[0], offset[1]), id };
    });
    this.commit({ ...this.table, parts: [...this.table.parts, ...copies] }, 'duplicate');
    this.selection = copies.map((c) => c.id);
  }

  /** Mirror copies of the selection across the table's mirror axis (left ↔ right). */
  mirrorSelected(): void {
    const parts = this.selectedParts;
    if (!parts.length) return;
    const axis = mirrorAxis(this.table);
    const taken = new Set<string>();
    const copies = parts.map((p) => {
      const base = p.id.replace(/-(left|right)$/, '');
      const swapped = /-left$/.test(p.id) ? `${base}-right` : /-right$/.test(p.id) ? `${base}-left` : '';
      const free = swapped && !this.table.parts.some((q) => q.id === swapped) && !taken.has(swapped);
      const id = free ? swapped : uniqueId(this.table, p.id, taken);
      taken.add(id);
      return { ...mirrorPart(structuredClone(p), axis), id };
    });
    this.commit({ ...this.table, parts: [...this.table.parts, ...copies] }, 'mirror');
    this.selection = copies.map((c) => c.id);
  }

  nudge(dx: number, dy: number): void {
    if (!this.selection.length) return;
    this.commit(this.mapSelected((p) => translatePart(p, dx, dy)), 'nudge');
  }

  rotateSelected(deg: number): void {
    const c = this.selectionCenter;
    if (!c) return;
    const single = this.selectedParts.length === 1 ? anchor(this.selectedParts[0]) : c;
    this.commit(this.mapSelected((p) => rotatePart(p, (deg * Math.PI) / 180, single)), 'rotate');
  }

  scaleSelected(k: number): void {
    const c = this.selectionCenter;
    if (!c) return;
    this.commit(this.mapSelected((p) => scalePart(p, k, c)), 'resize');
  }

  /** Replace one part (inspector edits). */
  updatePart(id: string, next: Part, label = 'edit'): void {
    this.commit({ ...this.table, parts: this.table.parts.map((p) => (p.id === id ? next : p)) }, label);
  }

  loadTable(t: TableDef, label = 'open table'): void {
    this.commit(structuredClone(t), label);
    this.selection = [];
  }

  // ------------------------------------------------------------ housekeeping

  private pruneSelection(): void {
    const ids = new Set(this.table.parts.map((p) => p.id));
    this.selection = this.selection.filter((id) => ids.has(id));
  }

  private changed(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(this.table));
      } catch {
        /* storage full or blocked: the draft just isn't kept */
      }
    }, 300);
  }
}

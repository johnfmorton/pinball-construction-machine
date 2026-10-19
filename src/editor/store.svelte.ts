/**
 * Editor state (Svelte 5 runes). The table is replaced immutably on every
 * edit so history snapshots and change detection stay trivial.
 */
import testTable from '../../tables/test-table.json';
import type { Vec2 } from '../core/math/bezier.ts';
import { playabilityIssues, validateTable, type Part, type TableDef } from '../core/table/format.ts';
import { DRAFT_KEY, loadDraft, saveDraft } from '../shared/tables.ts';
import { History, uniqueId } from './model/history.ts';
import { anchor, mirrorAxis, mirrorPart, partBounds, rotatePart, scalePart, translatePart, unionBounds, type Bounds } from './model/parts.ts';
import type { Guide } from './model/snap.ts';
import { alignParts, distributeParts, type AlignMode } from './model/arrange.ts';

export { DRAFT_KEY };

function initialTable(): TableDef {
  // no draft yet (or a bad one): start from the test table
  return loadDraft({ playable: false }) ?? structuredClone(testTable as TableDef);
}

export class EditorState {
  table = $state.raw<TableDef>(initialTable());
  selection = $state.raw<string[]>([]);
  hover = $state<string | null>(null);
  guides = $state.raw<Guide[]>([]);
  snap = $state(true);
  status = $state('');
  /** Parts being dragged in from the palette, drawn but not yet on the table. */
  preview = $state.raw<Part[] | null>(null);
  /** Palette entry currently being dragged (HTML drag-and-drop hides the data until drop). */
  dragging = $state<string | null>(null);
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

  /** What the table still needs before it can be played (empty = playable). */
  get problems(): string[] {
    return playabilityIssues(this.table.parts).map((i) => i.message);
  }

  /** Every group name in use, for the inspector's suggestions. */
  get groups(): string[] {
    return [...new Set(this.table.parts.map((p) => p.group).filter((g): g is string => !!g))].sort();
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

  /** Add new parts (ids already unique) and select them. */
  addParts(parts: Part[], label: string): void {
    if (!parts.length) return;
    this.commit({ ...this.table, parts: [...this.table.parts, ...parts] }, label);
    this.selection = parts.map((p) => p.id);
  }

  /** Replace several parts at once, matched by id. */
  replaceParts(next: Part[], label: string): void {
    const byId = new Map(next.map((p) => [p.id, p]));
    this.commit({ ...this.table, parts: this.table.parts.map((p) => byId.get(p.id) ?? p) }, label);
  }

  align(mode: AlignMode): void {
    this.replaceParts(alignParts(this.selectedParts, mode), 'align');
  }

  distribute(axis: 'x' | 'y'): void {
    this.replaceParts(distributeParts(this.selectedParts, axis), 'distribute');
  }

  /** Rename a part. Returns an error message, or null if it worked. */
  renamePart(id: string, next: string): string | null {
    const name = next.trim();
    if (!name) return 'An id can’t be empty';
    if (name === id) return null;
    if (this.table.parts.some((p) => p.id === name)) return `“${name}” is already used`;
    if (name.includes(':')) return 'Ids can’t contain “:”';
    this.commit({ ...this.table, parts: this.table.parts.map((p) => (p.id === id ? { ...p, id: name } : p)) }, 'rename');
    this.selection = this.selection.map((s) => (s === id ? name : s));
    return null;
  }

  /** Change table-level settings (name, size, rules, look). */
  updateTable(next: TableDef, label = 'table settings'): void {
    this.commit(next, label);
  }

  /** Replace one part (inspector edits). */
  updatePart(id: string, next: Part, label = 'edit'): void {
    this.commit({ ...this.table, parts: this.table.parts.map((p) => (p.id === id ? next : p)) }, label);
  }

  /**
   * Another tab (the Physics Lab's "Save to table") rewrote the draft. Adopt it
   * as an undoable edit so this tab's next autosave doesn't overwrite it.
   */
  adoptExternalDraft(raw: string | null): void {
    if (!raw || raw === JSON.stringify(this.table)) return;
    try {
      const t = JSON.parse(raw) as TableDef;
      if (validateTable(t, { playable: false }).length) return;
      this.commit(t, 'tuning from Physics Lab');
      this.pruneSelection();
      this.status = 'Physics settings updated from the Physics Lab';
    } catch {
      /* ignore a malformed write */
    }
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
      saveDraft(this.table); // storage full or blocked: the draft just isn't kept
    }, 300);
  }
}

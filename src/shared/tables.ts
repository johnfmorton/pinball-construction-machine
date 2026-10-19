/**
 * The tables every page can open: the built-in test tables plus the editor's
 * autosaved draft. All three pages (editor, 3D player, Physics Lab) read the
 * draft from here so moving between them never loses the table being built.
 */
import testTable from '../../tables/test-table.json';
import flipperLab from '../../tables/flipper-lab.json';
import { playabilityIssues, validateTable, type TableDef } from '../core/table/format.ts';

export const DRAFT_KEY = 'pcm.editor.draft';

export const BUILT_IN: Record<string, TableDef> = {
  test: testTable as TableDef,
  lab: flipperLab as TableDef,
};

export const TABLE_LABELS: Record<string, string> = {
  test: 'Test table',
  lab: 'Flipper lab',
  draft: 'Editor draft',
};

/**
 * The editor's autosaved draft, or null if there isn't a valid one. With
 * `playable: false` it also returns a draft that's still missing pieces
 * (the editor opens those; the player and lab can't run them).
 */
export function loadDraft(opts: { playable?: boolean } = {}): TableDef | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TableDef;
    return validateTable(t, opts).length ? null : t;
  } catch {
    return null;
  }
}

export function saveDraft(t: TableDef): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

/** Why the draft can't be played yet (empty when it can, or when there's no draft). */
export function draftProblems(): string[] {
  const t = loadDraft({ playable: false });
  return t ? playabilityIssues(t.parts).map((i) => i.message) : [];
}

/** Built-in tables plus the draft (when there is one), keyed for a <select>. */
export function availableTables(): Record<string, TableDef> {
  const draft = loadDraft();
  return draft ? { ...BUILT_IN, draft } : { ...BUILT_IN };
}

/** `?table=<key>` from the URL, if it names a table in `tables`. */
export function tableFromQuery(tables: Record<string, TableDef>): string | null {
  const key = new URLSearchParams(location.search).get('table');
  return key && tables[key] ? key : null;
}

/** Make sure a <select> lists every table, in a stable order. */
export function fillTableSelect(sel: HTMLSelectElement, tables: Record<string, TableDef>): void {
  sel.replaceChildren(
    ...Object.keys(tables).map((key) => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = TABLE_LABELS[key] ?? tables[key].meta.name;
      return o;
    }),
  );
}

/** Point a link at another page, carrying the current table along. */
export function linkWithTable(a: HTMLAnchorElement, page: string, key: string): void {
  a.href = key === 'test' ? page : `${page}?table=${encodeURIComponent(key)}`;
}

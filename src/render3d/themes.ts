import type { Appearance, ThemeName } from '../core/table/format.ts';

/** A playfield art theme: the palette the procedural artwork is painted with. */
export interface Theme {
  name: ThemeName;
  label: string;
  /** Playfield base gradient, top to bottom. */
  baseTop: string;
  baseBottom: string;
  /** Large art shapes (rays, arcs, bands). */
  accent: string;
  accent2: string;
  /** Printed lines, lane outlines, lettering. */
  ink: string;
  /** Default light-insert color. */
  insert: string;
  /** Painted plastics (sling covers, bumper caps). */
  plastic: string;
  /** Interior wood walls. */
  wall: string;
  /** Cabinet side wood. */
  cabinet: string;
}

export const THEME_DEFS: Record<ThemeName, Theme> = {
  midnight: {
    name: 'midnight',
    label: 'Midnight',
    baseTop: '#0d1830',
    baseBottom: '#070c1a',
    accent: '#ff8a1f',
    accent2: '#2a6bd8',
    ink: '#e9eef7',
    insert: '#ffb347',
    plastic: '#ff8a1f',
    wall: '#141c2c',
    cabinet: '#1b1410',
  },
  sunset: {
    name: 'sunset',
    label: 'Sunset Strip',
    baseTop: '#2a0d2e',
    baseBottom: '#12051a',
    accent: '#ff4f8b',
    accent2: '#ffb000',
    ink: '#fff1e3',
    insert: '#ffd166',
    plastic: '#ff4f8b',
    wall: '#24101f',
    cabinet: '#160c12',
  },
  classic: {
    name: 'classic',
    label: 'Classic 1977',
    baseTop: '#efe2c4',
    baseBottom: '#d9c49b',
    accent: '#c8321e',
    accent2: '#1e4fa3',
    ink: '#2b1d10',
    insert: '#ffd23f',
    plastic: '#c8321e',
    wall: '#e9dcc0',
    cabinet: '#3a2414',
  },
};

/** Resolve a table's appearance block into a full theme. */
export function resolveTheme(a: Appearance | undefined): Theme {
  const base = THEME_DEFS[a?.theme ?? 'midnight'] ?? THEME_DEFS.midnight;
  return {
    ...base,
    accent: a?.tint ?? base.accent,
    plastic: a?.tint ?? base.plastic,
    insert: a?.insertColor ?? base.insert,
  };
}

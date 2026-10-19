<script lang="ts">
  import type { EditorState } from './store.svelte.ts';
  import { CATALOG, CATALOG_SECTIONS, canPlace } from './model/catalog.ts';

  let { ed, onplace }: { ed: EditorState; onplace: (key: string) => void } = $props();

  /** Small line icons, drawn in a 24×24 box with currentColor. */
  const ICONS: Record<string, string> = {
    'flipper-left': '<path d="M5 8.5a3.5 3.5 0 0 1 2.4-3.3L19.6 13.7a1.6 1.6 0 0 1-1 2.9L5.6 11.6A3.5 3.5 0 0 1 5 8.5z" fill="currentColor" opacity=".9"/><circle cx="7" cy="8.6" r="1.3" fill="var(--panel)"/>',
    'flipper-right': '<path d="M19 8.5a3.5 3.5 0 0 0-2.4-3.3L4.4 13.7a1.6 1.6 0 0 0 1 2.9l13-5A3.5 3.5 0 0 0 19 8.5z" fill="currentColor" opacity=".9"/><circle cx="17" cy="8.6" r="1.3" fill="var(--panel)"/>',
    bumper: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    'sling-left': '<path d="M7 4l9 15H7z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 4l9 15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    'sling-right': '<path d="M17 4L8 19h9z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 4L8 19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    standup: '<rect x="5" y="9.5" width="14" height="5" rx="1" fill="currentColor"/><path d="M9 12h6" stroke="var(--panel)" stroke-width="1.5"/>',
    drop: '<rect x="5" y="7" width="14" height="5" rx="1" fill="currentColor"/><path d="M12 14v5m-2.5-2.5L12 19l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    'drop-bank': '<rect x="3" y="9.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="16" y="9.5" width="5" height="5" rx="1" fill="currentColor"/>',
    rollover: '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
    gate: '<path d="M4 15h16" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><path d="M8.5 10.5L12 7l3.5 3.5M12 7v6" fill="none" stroke="#7ee787" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    'top-lanes': '<path d="M3 6v12M9 6v12M15 6v12M21 6v12" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
    post: '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
    peg: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
    wall: '<path d="M4 12h16" stroke="#b07a3c" stroke-width="5" stroke-linecap="round"/>',
    rail: '<path d="M12 4v16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    curve: '<path d="M4 18Q12 0 20 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    rubber: '<path d="M6 12h12" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".6"/><circle cx="5" cy="12" r="2.4" fill="currentColor"/><circle cx="19" cy="12" r="2.4" fill="currentColor"/>',
    drain: '<rect x="3" y="9" width="18" height="7" rx="1" fill="none" stroke="#ff7b72" stroke-width="1.5" stroke-dasharray="3 2"/>',
    plunger: '<path d="M12 9v12" stroke="currentColor" stroke-width="2"/><rect x="8" y="4" width="8" height="4" rx="1" fill="currentColor"/><path d="M10 12h4M10 15h4M10 18h4" stroke="currentColor" stroke-width="1.2"/>',
    'ball-start': '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/>',
  };

  // a 1×1 transparent drag image: the canvas draws the real part under the cursor instead
  const blank = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }) : null;

  function dragStart(e: DragEvent, key: string): void {
    ed.dragging = key;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'copy';
      if (blank) e.dataTransfer.setDragImage(blank, 0, 0);
    }
  }

  function dragEnd(): void {
    ed.dragging = null;
    ed.preview = null;
    ed.guides = [];
  }
</script>

<div class="palette">
  {#each CATALOG_SECTIONS as section (section)}
    <div class="section">{section}</div>
    <div class="tiles">
      {#each CATALOG.filter((e) => e.section === section) as entry (entry.key)}
        {@const ok = canPlace(entry, ed.table)}
        <button
          class="tile"
          draggable={ok}
          disabled={!ok}
          title={ok ? `${entry.hint}. Drag onto the table, or click to add it in the middle.` : `${entry.label}: the table already has one`}
          ondragstart={(e) => dragStart(e, entry.key)}
          ondragend={dragEnd}
          onclick={() => onplace(entry.key)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS[entry.key] ?? ''}</svg>
          <span>{entry.label}</span>
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .palette { padding: 4px 8px 8px; }
  .section { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; margin: 10px 2px 4px; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .tile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--panel-2);
    border-color: transparent;
    text-align: left;
    font-size: 11.5px;
    line-height: 1.15;
    cursor: grab;
    min-width: 0;
  }
  .tile:active { cursor: grabbing; }
  .tile:disabled { cursor: not-allowed; }
  .tile span { overflow: hidden; text-overflow: ellipsis; }
  svg { width: 22px; height: 22px; flex: none; color: #c9d3de; }
</style>

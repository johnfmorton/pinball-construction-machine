<script lang="ts">
  import { onMount } from 'svelte';
  import testTable from '../../tables/test-table.json';
  import type { TableDef } from '../core/table/format.ts';
  import { DRAFT_KEY, EditorState, PEN_PRESETS, type PenPreset } from './store.svelte.ts';
  import { EditorCanvas } from './canvas.ts';
  import Inspector from './Inspector.svelte';
  import Palette from './Palette.svelte';
  import { TYPE_LABELS, TYPE_ORDER } from './labels.ts';

  const ed = new EditorState();
  let canvasEl: HTMLCanvasElement;
  let view: EditorCanvas | undefined;
  let cursorText = $state('');
  let zoomPct = $state(100);
  let showHelp = $state(false);

  onMount(() => {
    view = new EditorCanvas(canvasEl, ed);
    if (import.meta.env.DEV) (window as unknown as { __ed: unknown }).__ed = { ed, view };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DRAFT_KEY) ed.adoptExternalDraft(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    const t = setInterval(() => {
      const c = view?.cursor;
      cursorText = c ? `${(c[0] * 1000).toFixed(1)}, ${(c[1] * 1000).toFixed(1)} mm` : '';
      zoomPct = Math.round((view?.zoom ?? 1) * 100);
    }, 100);
    return () => {
      clearInterval(t);
      window.removeEventListener('storage', onStorage);
      view?.destroy();
    };
  });

  const grouped = $derived(
    TYPE_ORDER.map((type) => ({ type, parts: ed.table.parts.filter((p) => p.type === type) })).filter((g) => g.parts.length),
  );

  function resetToTest(): void {
    ed.loadTable(testTable as TableDef, 'reset to test table');
  }

  function playDraft(): void {
    window.open('/?table=draft', 'pcm-play');
  }

  let partsOpen = $state(true);
</script>

<div class="shell">
  <header>
    <div class="brand">
      <strong>Table Editor</strong>
      <span class="name">{ed.table.meta.name}</span>
    </div>
    <div class="tools">
      <div class="seg">
        <button class:on={ed.tool === 'select'} onclick={() => view?.setTool('select')} title="Select and edit (V)">↖ Select</button>
        <button class:on={ed.tool === 'pen'} onclick={() => view?.setTool('pen')} title="Pen: draw walls and rails (P)">✒ Pen</button>
      </div>
      {#if ed.tool === 'pen'}
        <select bind:value={ed.penPreset} title="What the pen draws">
          {#each Object.entries(PEN_PRESETS) as [k, v] (k)}<option value={k as PenPreset}>{v.label}</option>{/each}
        </select>
      {/if}
      <button class:on={ed.symmetry} onclick={() => (ed.symmetry = !ed.symmetry)} title="Symmetry (S): edit mirror-image pairs together, and draw walls on both sides">⟷ Symmetry</button>
      <span class="sep"></span>
      <button disabled={!ed.canUndo} onclick={() => ed.undo()} title={ed.undoLabel ? `Undo ${ed.undoLabel} (⌘Z)` : 'Undo (⌘Z)'}>↶ Undo</button>
      <button disabled={!ed.canRedo} onclick={() => ed.redo()} title={ed.redoLabel ? `Redo ${ed.redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)'}>↷ Redo</button>
      <span class="sep"></span>
      <button disabled={!ed.selection.length} onclick={() => ed.duplicateSelected()} title="Duplicate (⌘D, or ⌥-drag)">⧉</button>
      <button disabled={!ed.selection.length} onclick={() => ed.mirrorSelected()} title="Mirror copy across the center line (M)">Mirror</button>
      <button disabled={!ed.selection.length} onclick={() => ed.flipSelected('x')} title="Flip left-right in place (⇧H)">⇋</button>
      <button disabled={!ed.selection.length} onclick={() => ed.flipSelected('y')} title="Flip top-bottom in place (⇧V)">⇵</button>
      <button disabled={!ed.selection.length} onclick={() => ed.rotateSelected(-15)} title="Rotate −15° ( ⇧[ )">⟲</button>
      <button disabled={!ed.selection.length} onclick={() => ed.rotateSelected(15)} title="Rotate +15° ( ⇧] )">⟳</button>
      <button disabled={!ed.selection.length} onclick={() => ed.deleteSelected()} title="Delete (⌫)">✕</button>
      <span class="sep"></span>
      <button class:on={ed.snap} onclick={() => (ed.snap = !ed.snap)} title="Grid, angle and alignment snapping (hold ⌘ to place freely)">Snap</button>
      <button onclick={() => view?.zoomBy(1 / 1.25)} title="Zoom out">−</button>
      <span class="zoom">{zoomPct}%</span>
      <button onclick={() => view?.zoomBy(1.25)} title="Zoom in">+</button>
      <button onclick={() => view?.fit()} title="Fit table (0)">Fit</button>
    </div>
    <div class="right">
      <button onclick={() => (showHelp = !showHelp)} class:on={showHelp} title="Keyboard shortcuts">?</button>
      <button onclick={resetToTest} title="Replace the draft with the test table (undoable)">Reset</button>
      <button
        class="play"
        onclick={playDraft}
        disabled={ed.problems.length > 0}
        title={ed.problems.length ? `Not playable yet: this table ${ed.problems.join(', ')}` : 'Open this table in the 3D player'}>▶ Play</button
      >
      <a href="/?table=draft" class="link" title="This draft in the 3D player">3D table</a>
      <a href="/lab.html?table=draft" class="link" title="Tune this draft's physics">Lab</a>
    </div>
  </header>

  <aside class="parts">
    <h3>Add parts</h3>
    <Palette {ed} onplace={(key) => view?.placeAtCenter(key)} />
    <h3 class="list-head">
      <button class="disclose" onclick={() => (partsOpen = !partsOpen)} aria-expanded={partsOpen}>{partsOpen ? '▾' : '▸'} On the table</button>
      <span class="count">{ed.table.parts.length}</span>
    </h3>
    {#if partsOpen}
      <div class="list">
        {#each grouped as g (g.type)}
          <div class="group">{TYPE_LABELS[g.type]}</div>
          {#each g.parts as p (p.id)}
            <button
              class="part"
              class:sel={ed.selection.includes(p.id)}
              class:hover={ed.hover === p.id}
              onclick={(e) => ed.select([p.id], e.shiftKey || e.metaKey)}
              onmouseenter={() => (ed.hover = p.id)}
              onmouseleave={() => (ed.hover = null)}>{p.id}</button
            >
          {/each}
        {/each}
      </div>
    {/if}
  </aside>

  <main class="stage">
    <canvas bind:this={canvasEl}></canvas>
    {#if showHelp}
      <div class="help">
        <h4>Editing</h4>
        <p><kbd>Click</kbd> select · <kbd>⇧ Click</kbd> add/remove · drag empty space to box-select</p>
        <p>Drag to move · corner handles resize · top handle rotates</p>
        <p><kbd>⌘</kbd> hold while dragging to turn snapping off · <kbd>⌥</kbd>-drag duplicates</p>
        <p><kbd>←↑↓→</kbd> nudge 1 mm (<kbd>⇧</kbd> 5 mm) · <kbd>[</kbd> <kbd>]</kbd> rotate 5° (<kbd>⇧</kbd> 15°) · <kbd>−</kbd> <kbd>=</kbd> resize 5%</p>
        <p><kbd>M</kbd> mirror copy · <kbd>⌘D</kbd> duplicate · <kbd>⌫</kbd> delete · <kbd>⌘A</kbd> select all · <kbd>Esc</kbd> deselect</p>
        <p><kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo</p>
        <h4>Drawing walls</h4>
        <p><kbd>P</kbd> pen · click to add points · drag to pull out a curve · <kbd>⇧</kbd> locks 15° angles</p>
        <p>Click the last point or press <kbd>Enter</kbd> to finish · click the first point to close · <kbd>⌫</kbd> takes back a point · <kbd>V</kbd> back to select</p>
        <p>Select a wall to edit its points: drag a point or handle (<kbd>⌥</kbd> breaks a smooth curve) · double-click the wall to add a point · double-click a point for corner ↔ curve · <kbd>⌫</kbd> deletes the selected point</p>
        <h4>Mirroring</h4>
        <p><kbd>S</kbd> symmetry: mirror pairs move, reshape and delete together, and the pen draws both sides · <kbd>M</kbd> mirrored copy · <kbd>⇧H</kbd> <kbd>⇧V</kbd> flip in place</p>
        <h4>View</h4>
        <p>Pinch or scroll-wheel zooms · two-finger scroll pans · <kbd>Space</kbd>-drag pans · <kbd>0</kbd> fit</p>
      </div>
    {/if}
  </main>

  <aside class="inspector">
    <Inspector {ed} />
  </aside>

  <footer>
    <span>{ed.status}</span>
    <span class="grow"></span>
    <span>{ed.selection.length ? `${ed.selection.length} selected` : ''}</span>
    <span class="mono">{cursorText}</span>
    {#if ed.problems.length}<span class="warn" title="Add these before you can play">⚠ Not playable yet: {ed.problems.join(', ')}</span>{/if}
    <span class="muted">Draft autosaves in this browser</span>
  </footer>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 236px 1fr 280px;
    grid-template-rows: 44px 1fr 26px;
    height: 100vh;
  }
  header {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; gap: 10px; align-items: baseline; min-width: 0; flex: none; white-space: nowrap; }
  .brand .name { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tools, .right { display: flex; gap: 5px; align-items: center; }
  header button, header a { white-space: nowrap; }
  @media (max-width: 1500px) {
    .brand .name { display: none; }
  }
  @media (max-width: 1340px) {
    .tools { gap: 3px; }
    header button { padding: 4px 7px; }
  }
  .tools { flex: 1; justify-content: center; }
  .seg { display: flex; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; border-left: none; }
  .tools select { padding: 4px 6px; }
  .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
  .zoom { min-width: 44px; text-align: center; color: var(--muted); font: 12px ui-monospace, monospace; }
  .play { background: #1f6f3f; border-color: #2c9a58; }
  .link { color: var(--muted); text-decoration: none; padding: 4px 6px; }
  .link:hover { color: var(--text); }
  .parts {
    background: var(--panel);
    border-right: 1px solid var(--line);
    overflow-y: auto;
  }
  h3 { margin: 10px 12px 2px; font-size: 13px; }
  .list-head { display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px; margin: 8px 0 4px; padding-left: 4px; }
  .disclose { background: none; border: none; padding: 0 4px; font-weight: 600; font-size: 13px; }
  .list { padding: 0 8px 12px; }
  .warn { color: var(--warn); }
  .count { color: var(--muted); font-weight: 400; }
  .group { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin: 10px 4px 3px; }
  .part {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    padding: 2px 6px;
    font: 12px ui-monospace, monospace;
    color: var(--text);
  }
  .part.hover { background: var(--panel-2); }
  .part.sel { border-color: var(--accent); background: rgba(79, 163, 255, 0.12); }
  .stage { position: relative; overflow: hidden; background: radial-gradient(ellipse at 50% 30%, #182231 0%, var(--bg) 70%); }
  canvas { display: block; touch-action: none; }
  .help {
    position: absolute;
    top: 12px;
    left: 12px;
    max-width: 440px;
    background: rgba(19, 26, 35, 0.95);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 4px 14px 10px;
  }
  .help h4 { margin: 10px 0 4px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .help p { margin: 4px 0; }
  .inspector { background: var(--panel); border-left: 1px solid var(--line); overflow-y: auto; }
  footer {
    grid-column: 1 / -1;
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 0 10px;
    background: var(--panel);
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
  }
  .grow { flex: 1; }
  .mono { font-family: ui-monospace, monospace; min-width: 130px; text-align: right; }
  .muted { opacity: 0.7; }
</style>

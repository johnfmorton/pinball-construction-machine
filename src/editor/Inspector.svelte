<script lang="ts">
  import type { Part } from '../core/table/format.ts';
  import type { EditorState } from './store.svelte.ts';
  import { anchor, roundM, translatePart } from './model/parts.ts';
  import { TYPE_LABELS } from './labels.ts';

  let { ed }: { ed: EditorState } = $props();

  const part = $derived(ed.selectedParts.length === 1 ? ed.selectedParts[0] : null);
  const pos = $derived(part ? anchor(part) : null);

  /** The one "size" number each part type exposes, in mm. */
  function sizeOf(p: Part): { label: string; value: number } | null {
    switch (p.type) {
      case 'post':
      case 'bumper':
        return { label: 'Radius', value: p.radius };
      case 'rollover':
        return { label: 'Radius', value: p.radius ?? 0.012 };
      case 'standupTarget':
      case 'dropTarget':
        return { label: 'Width', value: p.width };
      case 'flipper':
        return { label: 'Length', value: p.length };
      case 'wall':
        return { label: 'Thickness', value: p.thickness };
      default:
        return null;
    }
  }

  function withSize(p: Part, v: number): Part {
    switch (p.type) {
      case 'post':
      case 'bumper':
      case 'rollover':
        return { ...p, radius: v };
      case 'standupTarget':
      case 'dropTarget':
        return { ...p, width: v };
      case 'flipper':
        return { ...p, length: v };
      case 'wall':
        return { ...p, thickness: v };
      default:
        return p;
    }
  }

  function angleOf(p: Part): number | null {
    if (p.type === 'flipper') return p.restAngle;
    if (p.type === 'standupTarget' || p.type === 'dropTarget') return p.angle;
    return null;
  }

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) ? v : null;
  }

  function setX(e: Event): void {
    const v = num(e);
    if (part && pos && v !== null) ed.updatePart(part.id, translatePart(part, v / 1000 - pos[0], 0), 'move');
  }
  function setY(e: Event): void {
    const v = num(e);
    if (part && pos && v !== null) ed.updatePart(part.id, translatePart(part, 0, v / 1000 - pos[1]), 'move');
  }
  function setAngle(e: Event): void {
    const v = num(e);
    if (!part || v === null) return;
    if (part.type === 'flipper') ed.updatePart(part.id, { ...part, restAngle: v }, 'rotate');
    else if (part.type === 'standupTarget' || part.type === 'dropTarget') ed.updatePart(part.id, { ...part, angle: v }, 'rotate');
  }
  function setSize(e: Event): void {
    const v = num(e);
    if (part && v !== null && v > 0) ed.updatePart(part.id, withSize(part, roundM(v / 1000)), 'resize');
  }
  function setPoints(e: Event): void {
    const v = num(e);
    if (part && v !== null) ed.updatePart(part.id, { ...part, points: Math.max(0, Math.round(v)) }, 'points');
  }
  const mm = (m: number) => Math.round(m * 10000) / 10;
</script>

{#if part && pos}
  {@const size = sizeOf(part)}
  {@const ang = angleOf(part)}
  <section>
    <div class="kind">{TYPE_LABELS[part.type]}</div>
    <div class="id">{part.id}</div>
    <div class="grid">
      <label><span>X (mm)</span><input type="number" step="1" value={mm(pos[0])} onchange={setX} /></label>
      <label><span>Y (mm)</span><input type="number" step="1" value={mm(pos[1])} onchange={setY} /></label>
      {#if ang !== null}
        <label><span>Angle (°)</span><input type="number" step="5" value={Math.round(ang * 10) / 10} onchange={setAngle} /></label>
      {/if}
      {#if size}
        <label><span>{size.label} (mm)</span><input type="number" step="0.5" min="0.5" value={mm(size.value)} onchange={setSize} /></label>
      {/if}
      {#if part.type !== 'wall' && part.type !== 'drain' && part.type !== 'plunger' && part.type !== 'ballStart' && part.type !== 'flipper'}
        <label><span>Points</span><input type="number" step="10" min="0" value={part.points ?? 0} onchange={setPoints} /></label>
      {/if}
    </div>
    <p class="hint">More settings (material, colors, groups) arrive with the full inspector.</p>
  </section>
{:else if ed.selection.length > 1}
  <section>
    <div class="kind">{ed.selection.length} parts selected</div>
    <p class="hint">Drag to move them together, use the corner handles to resize the group, or press <kbd>M</kbd> for a mirrored copy.</p>
  </section>
{:else}
  <section>
    <div class="kind">Table</div>
    <div class="grid">
      <div class="ro"><span>Name</span><b>{ed.table.meta.name}</b></div>
      <div class="ro"><span>Size</span><b>{mm(ed.table.dimensions.width)} × {mm(ed.table.dimensions.length)} mm</b></div>
      <div class="ro"><span>Slope</span><b>{ed.table.dimensions.slope}°</b></div>
      <div class="ro"><span>Parts</span><b>{ed.table.parts.length}</b></div>
    </div>
    <p class="hint">Click a part to select it. Table settings become editable with the full inspector.</p>
  </section>
{/if}

<style>
  section { padding: 12px; }
  .kind { font-weight: 600; font-size: 14px; }
  .id { color: var(--muted); font: 12px ui-monospace, monospace; margin: 2px 0 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  label, .ro { display: flex; flex-direction: column; gap: 3px; }
  label span, .ro span { color: var(--muted); font-size: 11px; }
  .ro { grid-column: 1 / -1; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 16px; }
</style>

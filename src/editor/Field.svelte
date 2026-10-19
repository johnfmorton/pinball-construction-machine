<script lang="ts">
  import type { FieldSpec } from './model/fields.ts';
  import type { Part } from '../core/table/format.ts';

  let { spec, part, onchange }: { spec: FieldSpec; part: Part; onchange: (next: Part, label: string) => void } = $props();

  const raw = $derived(spec.get(part));
  /** Lengths show in millimeters; everything else as stored. */
  const shown = $derived(format(raw));

  function format(v: number | string | undefined): string {
    if (v === undefined) return '';
    if (spec.kind === 'length') return String(round((v as number) * 1000));
    return typeof v === 'number' ? String(round(v)) : v;
  }
  const unit = $derived(spec.kind === 'length' ? 'mm' : spec.kind === 'angle' ? '°' : '');

  function round(v: number): number {
    return Math.round(v * 100) / 100;
  }

  function commit(e: Event): void {
    const el = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    const text = el.value.trim();
    if (spec.kind === 'select' || spec.kind === 'text') {
      onchange(spec.set(part, text === '' ? undefined : text), spec.label.toLowerCase());
      return;
    }
    if (text === '') {
      // blank clears optional values back to their default; required ones just snap back
      if (spec.placeholder !== undefined) onchange(spec.set(part, undefined), spec.label.toLowerCase());
      else el.value = shown;
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      el.value = shown;
      return;
    }
    const next = spec.set(part, spec.kind === 'length' ? n / 1000 : n);
    // show the value actually stored (it may have been clamped to a sensible range)
    el.value = format(spec.get(next));
    onchange(next, spec.label.toLowerCase());
  }
</script>

<label class:wide={spec.wide} title={spec.hint ?? ''}>
  <span>{spec.label}{unit ? ` (${unit})` : ''}</span>
  {#if spec.kind === 'select'}
    <select value={shown} onchange={commit}>
      {#each spec.options ?? [] as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
  {:else}
    <input
      type={spec.kind === 'text' ? 'text' : 'number'}
      step={spec.step ?? 'any'}
      value={shown}
      placeholder={spec.placeholder ?? ''}
      onchange={commit}
      onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  {/if}
</label>

<style>
  label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  label.wide { grid-column: 1 / -1; }
  span { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  select { padding: 3px 4px; width: 100%; }
</style>

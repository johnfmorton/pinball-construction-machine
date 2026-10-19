<script lang="ts">
  import type { Part, TableDef } from '../core/table/format.ts';
  import { THEMES } from '../core/table/format.ts';
  import type { EditorState } from './store.svelte.ts';
  import { positionFields, scores, typeFields } from './model/fields.ts';
  import { roundM } from './model/parts.ts';
  import { isSmooth, moveNode, toNodes, toggleSmooth } from './model/path.ts';
  import { TYPE_LABELS } from './labels.ts';
  import Field from './Field.svelte';
  import { THEME_DEFS } from '../render3d/themes.ts';

  let { ed }: { ed: EditorState } = $props();

  const part = $derived(ed.selectedParts.length === 1 ? ed.selectedParts[0] : null);
  const many = $derived(ed.selectedParts.length > 1 ? ed.selectedParts : null);
  let idError = $state('');


  function change(next: Part, label: string): void {
    if (part) ed.updatePart(part.id, next, label);
  }

  function rename(e: Event): void {
    if (!part) return;
    const el = e.currentTarget as HTMLInputElement;
    const err = ed.renamePart(part.id, el.value);
    idError = err ?? '';
    if (err) el.value = part.id;
  }

  function setText(key: 'label' | 'group', e: Event): void {
    if (!part) return;
    const v = (e.currentTarget as HTMLInputElement).value.trim();
    const next = { ...part } as Part & Record<string, unknown>;
    if (v) next[key] = v;
    else delete next[key];
    ed.updatePart(part.id, next, key);
  }

  // ---------------------------------------------------------- multi-selection

  function setGroupAll(e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).value.trim();
    ed.replaceParts(
      ed.selectedParts.map((p) => {
        const q = { ...p };
        if (v) q.group = v;
        else delete q.group;
        return q;
      }),
      'group',
    );
  }

  function setPointsAll(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    ed.replaceParts(
      ed.selectedParts.filter(scores).map((p) => ({ ...p, points: Math.max(0, Math.round(v)) })),
      'points',
    );
  }

  const sharedGroup = $derived(many && many.every((p) => p.group === many[0].group) ? (many[0].group ?? '') : '');
  const scoring = $derived(many ? many.filter(scores) : []);
  const sharedPoints = $derived(scoring.length && scoring.every((p) => p.points === scoring[0].points) ? String(scoring[0].points ?? 0) : '');

  // ---------------------------------------------------------- table settings

  const t = $derived(ed.table);
  const physicsCount = $derived(Object.keys(t.physics ?? {}).length);

  function tableChange(next: TableDef, label: string): void {
    ed.updateTable(next, label);
  }
  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) && (e.currentTarget as HTMLInputElement).value.trim() !== '' ? v : null;
  }
  function setMeta(key: 'name' | 'author' | 'description', e: Event): void {
    const v = (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const meta = { ...t.meta };
    if (key === 'name') meta.name = v || 'Untitled table';
    else if (v) meta[key] = v;
    else delete meta[key];
    tableChange({ ...t, meta }, key === 'name' ? 'rename table' : key);
  }
  function setDim(key: 'width' | 'length', e: Event): void {
    const v = num(e);
    if (v !== null && v >= 200 && v <= 1500) tableChange({ ...t, dimensions: { ...t.dimensions, [key]: roundM(v / 1000) } }, `table ${key}`);
    else (e.currentTarget as HTMLInputElement).value = String(Math.round(t.dimensions[key] * 1000));
  }
  function setSlope(e: Event): void {
    const v = num(e);
    if (v !== null && v >= 2 && v <= 12) tableChange({ ...t, dimensions: { ...t.dimensions, slope: v } }, 'slope');
    else (e.currentTarget as HTMLInputElement).value = String(t.dimensions.slope);
  }
  function setRule(key: 'ballsPerGame' | 'ballSave', e: Event): void {
    const v = num(e);
    const rules = { ...t.rules };
    if (v === null) delete rules[key];
    else rules[key] = key === 'ballsPerGame' ? Math.max(1, Math.round(v)) : Math.max(0, v);
    tableChange({ ...t, rules }, key === 'ballsPerGame' ? 'balls per game' : 'ball save');
  }
  function setLook(key: 'theme' | 'tint' | 'insertColor', v: string | undefined): void {
    const appearance = { ...t.appearance } as Record<string, string | undefined>;
    if (v) appearance[key] = v;
    else delete appearance[key];
    tableChange({ ...t, appearance: appearance as TableDef['appearance'] }, key === 'theme' ? 'theme' : 'color');
  }
</script>

<datalist id="group-names">
  {#each ed.groups as g (g)}<option value={g}></option>{/each}
</datalist>

{#if part}
  {@const fields = typeFields(part)}
  <section>
    <div class="kind">{TYPE_LABELS[part.type]}</div>
    <div class="grid">
      <label>
        <span>Id</span>
        <input class="mono" value={part.id} onchange={rename} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      </label>
      <label>
        <span>Label</span>
        <input value={part.label ?? ''} placeholder="optional" onchange={(e) => setText('label', e)} />
      </label>
      {#if idError}<p class="error">{idError}</p>{/if}
    </div>
  </section>

  <section>
    <h4>Position</h4>
    <div class="grid">
      {#each positionFields as spec (spec.key)}<Field {spec} {part} onchange={(n) => change(n, 'move')} />{/each}
    </div>
  </section>

  {#if fields.length}
    <section>
      <h4>{part.type === 'slingshot' ? 'Slingshot' : 'Settings'}</h4>
      <div class="grid">
        {#each fields as spec (spec.key)}<Field {spec} {part} onchange={change} />{/each}
      </div>
      {#if part.type === 'gate'}
        <p class="hint">The ball passes only in the arrow’s direction. Across the top of the shooter lane, it stops a ball from falling back into the lane.</p>
      {:else if part.type === 'slingshot'}
        <p class="hint">The rubber face runs from the face start to the face end; it kicks the ball away from the back corner.</p>
      {/if}
    </section>
  {/if}

  {#if part.type === 'wall'}
    {@const ep = toNodes(part.path)}
    {@const ni = ed.activeNode !== null && ed.activeNode < ep.nodes.length ? ed.activeNode : null}
    <section>
      <h4>Shape</h4>
      <div class="row">
        <span class="muted">{ep.nodes.length} points · {ep.closed ? 'closed' : 'open'}</span>
        <button
          disabled={ep.nodes.length < 3}
          onclick={() => ed.commit(ed.withWallPath(part.id, (e) => ({ ...e, closed: !e.closed })), ep.closed ? 'open shape' : 'close shape')}
          >{ep.closed ? 'Open shape' : 'Close shape'}</button
        >
      </div>
      {#if ni !== null}
        {@const node = ep.nodes[ni]}
        <h4 class="sub">Point {ni + 1}</h4>
        <div class="grid">
          {#each [0, 1] as axis (axis)}
            <label>
              <span>{axis ? 'Y' : 'X'} (mm)</span>
              <input
                type="number"
                step="1"
                value={Math.round(node.p[axis] * 10000) / 10}
                onchange={(e) => {
                  const v = Number((e.currentTarget as HTMLInputElement).value) / 1000;
                  if (!Number.isFinite(v)) return;
                  const to: [number, number] = axis ? [node.p[0], v] : [v, node.p[1]];
                  ed.commit(ed.withWallPath(part.id, (p) => moveNode(p, ni, to)), 'move point');
                }}
              />
            </label>
          {/each}
        </div>
        <div class="buttons two pts">
          <button onclick={() => ed.commit(ed.withWallPath(part.id, (p) => toggleSmooth(p, ni)), 'toggle curve')}>
            {node.in || node.out ? 'Make corner' : 'Make curve'}
          </button>
          <button disabled={ep.nodes.length <= 2} onclick={() => ed.deleteSelected()}>Delete point</button>
        </div>
        {#if node.in || node.out}<p class="hint">{isSmooth(node) ? 'Smooth curve: its handles move together.' : 'Its handles move separately.'} <kbd>⌥</kbd>-drag a handle to break a smooth curve.</p>{/if}
      {:else}
        <p class="hint">Click a point on the wall to select it; drag points and handles to reshape. Double-click the wall to add a point, or a point to switch corner ↔ curve.</p>
      {/if}
    </section>
  {/if}

  {#if part.type !== 'ballStart' && part.type !== 'plunger' && part.type !== 'drain'}
    <section>
      <h4>Rules</h4>
      <div class="grid">
        <label class="wide" title="Parts in the same group work together: light all the rollovers or drop all the targets for a bonus">
          <span>Group</span>
          <input list="group-names" value={part.group ?? ''} placeholder="none" onchange={(e) => setText('group', e)} />
        </label>
      </div>
    </section>
  {/if}
{:else if many}
  <section>
    <div class="kind">{many.length} parts selected</div>
    <h4>Align</h4>
    <div class="buttons">
      <button onclick={() => ed.align('left')} title="Align left edges">⇤ Left</button>
      <button onclick={() => ed.align('centerX')} title="Align centers horizontally">↔ Center</button>
      <button onclick={() => ed.align('right')} title="Align right edges">Right ⇥</button>
      <button onclick={() => ed.align('top')} title="Align top edges">⤒ Top</button>
      <button onclick={() => ed.align('centerY')} title="Align centers vertically">↕ Middle</button>
      <button onclick={() => ed.align('bottom')} title="Align bottom edges">⤓ Bottom</button>
    </div>
    <h4>Distribute</h4>
    <div class="buttons two">
      <button disabled={many.length < 3} onclick={() => ed.distribute('x')} title="Even spacing left to right (3 or more parts)">Horizontally</button>
      <button disabled={many.length < 3} onclick={() => ed.distribute('y')} title="Even spacing top to bottom (3 or more parts)">Vertically</button>
    </div>
  </section>
  <section>
    <h4>Rules</h4>
    <div class="grid">
      <label>
        <span>Group</span>
        <input list="group-names" value={sharedGroup} placeholder={sharedGroup ? '' : 'mixed / none'} onchange={setGroupAll} />
      </label>
      {#if scoring.length}
        <label>
          <span>Points ({scoring.length})</span>
          <input type="number" step="10" min="0" value={sharedPoints} placeholder="mixed" onchange={setPointsAll} />
        </label>
      {/if}
    </div>
    <p class="hint">Drag to move them together, use the corner handles to resize the group, or press <kbd>M</kbd> for a mirrored copy.</p>
  </section>
{:else}
  <section>
    <div class="kind">Table</div>
    <div class="grid">
      <label class="wide"><span>Name</span><input value={t.meta.name} onchange={(e) => setMeta('name', e)} /></label>
      <label class="wide"><span>Author</span><input value={t.meta.author ?? ''} placeholder="optional" onchange={(e) => setMeta('author', e)} /></label>
      <label class="wide">
        <span>Description</span>
        <textarea rows="2" placeholder="optional" onchange={(e) => setMeta('description', e)}>{t.meta.description ?? ''}</textarea>
      </label>
    </div>
  </section>
  <section>
    <h4>Cabinet</h4>
    <div class="grid">
      <label><span>Width (mm)</span><input type="number" step="5" value={Math.round(t.dimensions.width * 1000)} onchange={(e) => setDim('width', e)} /></label>
      <label><span>Length (mm)</span><input type="number" step="5" value={Math.round(t.dimensions.length * 1000)} onchange={(e) => setDim('length', e)} /></label>
      <label title="Real machines are about 6.5°; steeper plays faster"><span>Slope (°)</span><input type="number" step="0.1" value={t.dimensions.slope} onchange={setSlope} /></label>
    </div>
    <p class="hint">Changing the size doesn’t move the walls; adjust the cabinet walls to match.</p>
  </section>
  <section>
    <h4>Game</h4>
    <div class="grid">
      <label><span>Balls per game</span><input type="number" step="1" min="1" value={t.rules?.ballsPerGame ?? ''} placeholder="3" onchange={(e) => setRule('ballsPerGame', e)} /></label>
      <label title="Seconds after each launch when a drained ball is given back"><span>Ball save (s)</span><input type="number" step="1" min="0" value={t.rules?.ballSave ?? ''} placeholder="0" onchange={(e) => setRule('ballSave', e)} /></label>
    </div>
  </section>
  <section>
    <h4>Look</h4>
    <div class="grid">
      <label class="wide">
        <span>Theme</span>
        <select value={t.appearance?.theme ?? 'midnight'} onchange={(e) => setLook('theme', (e.currentTarget as HTMLSelectElement).value)}>
          {#each THEMES as th (th)}<option value={th}>{THEME_DEFS[th].label}</option>{/each}
        </select>
      </label>
      {#each [['tint', 'Accent color'], ['insertColor', 'Insert lights']] as [key, label] (key)}
        {@const k = key as 'tint' | 'insertColor'}
        {@const themeColor = THEME_DEFS[t.appearance?.theme ?? 'midnight'][k === 'tint' ? 'accent' : 'insert']}
        <label>
          <span>{label}</span>
          <div class="color">
            <input type="color" value={t.appearance?.[k] ?? themeColor} onchange={(e) => setLook(k, (e.currentTarget as HTMLInputElement).value)} />
            {#if t.appearance?.[k]}<button title="Use the theme’s color" onclick={() => setLook(k, undefined)}>×</button>{:else}<em>theme</em>{/if}
          </div>
        </label>
      {/each}
    </div>
  </section>
  <section>
    <h4>Physics</h4>
    <p class="hint top">
      {physicsCount ? `${physicsCount} custom setting${physicsCount === 1 ? '' : 's'}.` : 'Standard physics.'}
      Tune them in the <a href="/lab.html?table=draft">Physics Lab</a>; <b>Save to table</b> there brings them back here.
    </p>
  </section>
  {#if ed.problems.length}
    <section>
      <h4 class="warn">Not playable yet</h4>
      <ul class="problems">
        {#each ed.problems as p (p)}<li>This table {p}.</li>{/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  section { padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .kind { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
  h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  h4.warn { color: var(--warn); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  label.wide { grid-column: 1 / -1; }
  label span { color: var(--muted); font-size: 11px; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  .error { grid-column: 1 / -1; color: #ff7b72; margin: 0; font-size: 12px; }
  .hint { color: var(--muted); font-size: 12px; margin: 10px 0 0; }
  .hint.top { margin-top: 0; }
  .hint a { color: var(--accent); }
  .buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 12px; }
  .buttons.two { grid-template-columns: 1fr 1fr; margin-bottom: 0; }
  .buttons button { padding: 4px 2px; font-size: 12px; }
  textarea { font: inherit; color: var(--text); background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; resize: vertical; }
  select { padding: 3px 4px; width: 100%; }
  .color { display: flex; gap: 5px; align-items: center; }
  .color input { width: 44px; height: 24px; padding: 1px; }
  .color button { padding: 0 7px; }
  .color em { color: var(--muted); font-size: 11px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .muted { color: var(--muted); font-size: 12px; }
  h4.sub { margin-top: 12px; }
  .pts { margin-top: 8px; }
  .problems { margin: 0; padding-left: 18px; color: var(--warn); }
</style>

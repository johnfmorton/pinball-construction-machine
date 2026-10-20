/**
 * Physics Lab: the Phase 0 tuning harness. Hosts the physics worker, the
 * debug renderer, live tuning sliders, telemetry, and replay tools.
 */
import '../shared/dev-worker.ts'; // first: patches Worker before anything starts one
import { validateTable, type TableDef } from '../core/table/format.ts';
import { DEFAULT_TUNING, TUNING_SPECS, tableTuning, tuningDiff, type Tuning } from '../core/physics/tuning.ts';
import type { Replay } from '../core/sim/replay.ts';
import type { InputKind } from '../core/sim/simulation.ts';
import type { FromWorker, Snapshot, Stats, ToWorker } from '../worker/protocol.ts';
import { Renderer, type Overlays } from './renderer.ts';
import { Sfx } from './sfx.ts';
import { DRAFT_KEY, availableTables, draftProblems, fillTableSelect, linkWithTable, loadDraft, saveDraft, tableFromQuery } from '../shared/tables.ts';

// built-in tables plus the editor's draft, so the lab can tune what you're building
const TABLES: Record<string, TableDef> = availableTables();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- storage

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: fine */
  }
}

// ---------------------------------------------------------------- state

let tuning: Tuning = { ...DEFAULT_TUNING };
const overlays: Overlays = load('pcm.overlays', { trail: true, vectors: true, wire: false, grid: false });
let tableKey: string = tableFromQuery(TABLES) ?? (() => {
  try {
    return localStorage.getItem('pcm.lab.table') ?? 'test';
  } catch {
    return 'test';
  }
})();
if (!TABLES[tableKey]) tableKey = 'test';
let table: TableDef = TABLES[tableKey];
let snap: Snapshot | null = null;
let stats: Stats = { stepsPerSecond: 0, stepMicros: 0 };
let paused = false;
let lastLaunch = 0;
let lastImpact = 0;
let peakTip = 0;
const speedHistory: number[] = [];

const worker = new Worker(new URL('../worker/physics.worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

const canvas = $<HTMLCanvasElement>('table');
const renderer = new Renderer(canvas, table);
const sfx = new Sfx();

/** Per-table tuning is remembered in this browser under the table's name. */
function tuningKey(t: TableDef): string {
  // the draft gets its own slot so it doesn't share sliders with a same-named table
  return tableKey === 'draft' ? 'pcm.tuning.draft' : `pcm.tuning.${t.meta.name}`;
}

function loadTable(t: TableDef): void {
  table = t;
  tuning = load(tuningKey(t), tableTuning(t));
  $('tuning-for').textContent = t.meta.name;
  buildTuning();
  renderer.setTable(t);
  snap = null;
  send({ type: 'load', table: t, tuning, seed: 1 });
}

// ---------------------------------------------------------------- worker → UI

const banner = $<HTMLDivElement>('banner');
let bannerTimer = 0;
function showBanner(text: string, ms = 1600): void {
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (banner.hidden = true), ms);
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'frame':
      snap = m.snap;
      stats = m.stats;
      for (const ev of m.events) {
        switch (ev.type) {
          case 'kick':
            renderer.flash(ev.partId);
            sfx.kick(ev.kind);
            break;
          case 'hit':
            lastImpact = ev.speed;
            sfx.hit(ev.speed, ev.partId);
            if (ev.partId.startsWith('post') && ev.speed > 0.3) renderer.flash(ev.partId);
            break;
          case 'target':
          case 'drop':
          case 'rollover':
            renderer.flash(ev.partId, 220);
            sfx.ding();
            break;
          case 'gate':
            renderer.flash(ev.partId, 160);
            sfx.gate();
            break;
          case 'flipper':
            if (ev.up) sfx.flipper();
            break;
          case 'launch':
            lastLaunch = ev.speed;
            break;
          case 'tilt':
            showBanner('TILT', 3000);
            sfx.buzz();
            break;
          case 'tiltWarning':
            showBanner('DANGER');
            sfx.buzz();
            break;
          case 'ballSaved':
            showBanner('BALL SAVED');
            break;
          case 'groupComplete':
            showBanner(ev.group === 'drops' ? 'DROP BANK COMPLETE' : 'TOP LANES · MULTIPLIER UP');
            break;
          case 'gameOver':
            showBanner(`GAME OVER · ${ev.score.toLocaleString()}`, 4000);
            break;
          default:
            break;
        }
      }
      break;
    case 'replay':
      download(`replay-${m.replay.score}-${Date.now()}.json`, m.replay);
      break;
    case 'replayDone':
      $('replay-status').textContent = m.ok
        ? `✓ Replay verified: re-simulated score ${m.score.toLocaleString()} matches.` +
          (m.tuningMatchesTable ? '' : ' It was recorded with physics settings that differ from the table file, so it wouldn’t count for high scores.')
        : `✗ Replay mismatch: got ${m.score.toLocaleString()}, expected ${m.expected.toLocaleString()}.`;
      break;
    case 'error':
      $('replay-status').textContent = m.message;
      break;
  }
};

// ---------------------------------------------------------------- input

const held = new Set<string>();
/** Several keys can drive one button; only send real press/release transitions. */
function button(kind: InputKind, down: boolean, code: string): void {
  const isDown = () => [...held].some((c) => KEYMAP[c] === kind);
  const before = isDown();
  if (down) held.add(code);
  else held.delete(code);
  const after = isDown();
  if (before !== after) send({ type: 'input', kind, value: after ? 1 : 0 });
}

const KEYMAP: Record<string, InputKind> = {
  KeyZ: 'flipperLeft',
  ShiftLeft: 'flipperLeft',
  ArrowLeft: 'flipperLeft',
  Slash: 'flipperRight',
  ShiftRight: 'flipperRight',
  ArrowRight: 'flipperRight',
  Enter: 'plunger',
  ArrowDown: 'plunger',
};

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') return;
  sfx.unlock();
  const kind = KEYMAP[e.code];
  if (kind) {
    e.preventDefault();
    if (!e.repeat) button(kind, true, e.code);
    return;
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      send({ type: 'input', kind: 'nudge', value: [0, -1] });
      break;
    case 'KeyQ':
      send({ type: 'input', kind: 'nudge', value: [-1, 0] });
      break;
    case 'KeyE':
      send({ type: 'input', kind: 'nudge', value: [1, 0] });
      break;
    case 'KeyS':
      startGame();
      break;
    case 'KeyB':
      send({ type: 'input', kind: 'addBall' });
      break;
    case 'KeyP':
      setPaused(!paused);
      break;
    case 'Period':
      stepOnce();
      break;
    case 'Digit1':
      setScale(1);
      break;
    case 'Digit2':
      setScale(0.25);
      break;
    case 'Digit3':
      setScale(0.05);
      break;
    case 'KeyT':
      toggleOverlay('trail');
      break;
    case 'KeyV':
      toggleOverlay('vectors');
      break;
    case 'KeyW':
      toggleOverlay('wire');
      break;
    case 'KeyG':
      toggleOverlay('grid');
      break;
  }
});

window.addEventListener('keyup', (e) => {
  const kind = KEYMAP[e.code];
  if (kind) {
    e.preventDefault();
    button(kind, false, e.code);
  }
});

window.addEventListener('blur', () => {
  for (const code of [...held]) button(KEYMAP[code], false, code);
});

// drag on the table to place and throw a ball
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  const [x, y] = renderer.toTable(e.clientX, e.clientY);
  renderer.drag = { x0: x, y0: y, x1: x, y1: y };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!renderer.drag) return;
  const [x, y] = renderer.toTable(e.clientX, e.clientY);
  renderer.drag.x1 = x;
  renderer.drag.y1 = y;
});
canvas.addEventListener('pointerup', () => {
  const d = renderer.drag;
  renderer.drag = null;
  if (!d) return;
  const k = 20; // 5 cm of drag → 1 m/s
  const v = [(d.x1 - d.x0) * k, (d.y1 - d.y0) * k].map((n) => +n.toFixed(4));
  send({ type: 'input', kind: 'placeBall', value: [+d.x0.toFixed(4), +d.y0.toFixed(4), v[0], v[1]] });
});

// ---------------------------------------------------------------- controls

function startGame(): void {
  sfx.unlock();
  renderer.clearTrails();
  peakTip = 0;
  send({ type: 'input', kind: 'startGame' });
}

function setPaused(p: boolean): void {
  paused = p;
  send({ type: 'pause', paused });
  $('btn-pause').textContent = paused ? 'Resume' : 'Pause';
}

function stepOnce(): void {
  if (!paused) setPaused(true);
  send({ type: 'stepOnce', steps: 1 });
}

function setScale(s: number): void {
  send({ type: 'timeScale', scale: s });
  document.querySelectorAll<HTMLButtonElement>('#speed-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.scale) === s));
}

function toggleOverlay(k: keyof Overlays): void {
  overlays[k] = !overlays[k];
  syncOverlayChecks();
  save('pcm.overlays', overlays);
}

function syncOverlayChecks(): void {
  ($('ov-trail') as HTMLInputElement).checked = overlays.trail;
  ($('ov-vec') as HTMLInputElement).checked = overlays.vectors;
  ($('ov-wire') as HTMLInputElement).checked = overlays.wire;
  ($('ov-grid') as HTMLInputElement).checked = overlays.grid;
}

$('btn-start').onclick = startGame;
$('btn-pause').onclick = () => setPaused(!paused);
$('btn-step').onclick = stepOnce;
document.querySelectorAll<HTMLButtonElement>('#speed-seg button').forEach((b) => (b.onclick = () => setScale(Number(b.dataset.scale))));
for (const [id, key] of [
  ['ov-trail', 'trail'],
  ['ov-vec', 'vectors'],
  ['ov-wire', 'wire'],
  ['ov-grid', 'grid'],
] as const) {
  $(id).onchange = (e) => {
    overlays[key] = (e.target as HTMLInputElement).checked;
    save('pcm.overlays', overlays);
  };
}
syncOverlayChecks();

fillTableSelect($<HTMLSelectElement>('table-select'), TABLES);
$<HTMLSelectElement>('table-select').value = tableKey;
linkWithTable($<HTMLAnchorElement>('link-play'), '/', tableKey);
$<HTMLSelectElement>('table-select').onchange = (e) => {
  tableKey = (e.target as HTMLSelectElement).value;
  try {
    localStorage.setItem('pcm.lab.table', tableKey);
  } catch {
    /* fine */
  }
  history.replaceState(null, '', tableKey === 'test' ? location.pathname : `?table=${tableKey}`);
  linkWithTable($<HTMLAnchorElement>('link-play'), '/', tableKey);
  loadTable(TABLES[tableKey]);
  (e.target as HTMLSelectElement).blur();
};

// ---------------------------------------------------------------- tuning panel

function fmt(v: number, step: number): string {
  const d = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  return v.toFixed(d);
}

function buildTuning(): void {
  const root = $('tuning');
  root.innerHTML = '';
  const groups = new Map<string, HTMLDivElement>();
  for (const spec of TUNING_SPECS) {
    let g = groups.get(spec.group);
    if (!g) {
      g = document.createElement('div');
      g.className = 'tune-group';
      g.innerHTML = `<h4>${spec.group}</h4>`;
      root.appendChild(g);
      groups.set(spec.group, g);
    }
    const row = document.createElement('div');
    row.className = 'tune';
    const id = `tune-${spec.key}`;
    row.innerHTML = `<label for="${id}">${spec.label}</label><output></output><input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    const sync = () => {
      input.value = String(tuning[spec.key]);
      out.textContent = fmt(tuning[spec.key], spec.step);
      row.classList.toggle('changed', tuning[spec.key] !== tableTuning(table)[spec.key]);
      row.title = `Table file: ${fmt(tableTuning(table)[spec.key], spec.step)} · engine default: ${fmt(DEFAULT_TUNING[spec.key], spec.step)}`;
    };
    input.oninput = () => {
      tuning = { ...tuning, [spec.key]: Number(input.value) };
      sync();
      save(tuningKey(table), tuning);
      send({ type: 'tuning', tuning });
    };
    input.onkeydown = (e) => e.stopPropagation();
    sync();
    g.appendChild(row);
  }
}

function setTuning(t: Tuning): void {
  tuning = { ...t };
  save(tuningKey(table), tuning);
  send({ type: 'tuning', tuning });
  buildTuning();
}

$('btn-tune-reset').onclick = () => setTuning(DEFAULT_TUNING);
$('btn-tune-table').onclick = () => setTuning(tableTuning(table));

$('btn-tune-save').onclick = () => {
  const physics = tuningDiff(tuning);
  const next: TableDef = { ...table };
  if (Object.keys(physics).length) next.physics = physics;
  else delete next.physics;
  // keep the in-memory copy in step with the saved table for this session
  const sel = $<HTMLSelectElement>('table-select');
  if (TABLES[sel.value] === table) TABLES[sel.value] = next;
  if (sel.value === 'draft') {
    // the editor's draft lives in this browser: write the tuning straight back
    // into it (an open editor picks it up) instead of downloading a file
    saveDraft(next);
    loadTable(next);
    showBanner('Saved to the editor draft · game restarted');
    return;
  }
  const slug = next.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadPretty(`${slug}.json`, next);
  loadTable(next);
  showBanner('Saved to table · game restarted');
};

$('btn-tune-copy').onclick = async () => {
  const text = JSON.stringify({ physics: tuningDiff(tuning) }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showBanner('Tuning copied');
  } catch {
    download('tuning.json', tuningDiff(tuning));
  }
};

// ---------------------------------------------------------------- replays & files

function downloadPretty(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btn-replay-save').onclick = () => send({ type: 'getReplay' });

$('btn-replay-clear').onclick = () => {
  send({ type: 'reset', tuning });
  renderer.clearTrails();
  $('replay-status').textContent = '';
  lastLaunch = 0;
  lastImpact = 0;
  peakTip = 0;
  speedHistory.length = 0;
  (document.activeElement as HTMLElement | null)?.blur();
};

$<HTMLInputElement>('replay-file').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const replay = JSON.parse(await f.text()) as Replay;
    if (replay.format !== 'pcm-replay') throw new Error('Not a replay file.');
    renderer.clearTrails();
    $('replay-status').textContent = `Playing replay (${(replay.steps / 1000).toFixed(1)} s, claimed score ${replay.score.toLocaleString()})…`;
    send({ type: 'playReplay', replay });
  } catch (err) {
    $('replay-status').textContent = String(err);
  }
  (e.target as HTMLInputElement).value = '';
};

$<HTMLInputElement>('table-file').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const t = JSON.parse(await f.text());
    const issues = validateTable(t);
    if (issues.length) throw new Error(issues.map((i) => (i.partId ? `${i.partId}: ` : '') + i.message).join('; '));
    tableKey = 'custom';
    loadTable(t as TableDef);
    $('table-status').textContent = `Loaded “${(t as TableDef).meta.name}”.`;
  } catch (err) {
    $('table-status').textContent = String(err);
  }
  (e.target as HTMLInputElement).value = '';
};

// ---------------------------------------------------------------- HUD / telemetry

const telemetry = $('telemetry');
const spark = $<HTMLCanvasElement>('spark');
let frames = 0;
let fps = 0;
let fpsSince = performance.now();

function updateHud(): void {
  if (!snap) return;
  const s = snap.state;
  $('score').textContent = s.score.toLocaleString();
  $('ball-num').textContent = s.started ? (s.gameOver ? '–' : `${s.ball}/${s.ballsPerGame}`) : '–';
  $('mult').textContent = String(s.multiplier);
  $('save-light').classList.toggle('on', s.ballSaveActive);
  $('tilt-light').classList.toggle('on', s.tilted);

  const b = snap.balls[0];
  const R = tuning.ballRadius;
  const speed = b ? Math.sqrt(b.vx * b.vx + b.vy * b.vy) : 0;
  const slip = b ? Math.sqrt((b.vx - R * b.wy) ** 2 + (b.vy + R * b.wx) ** 2) : 0;
  let tip = 0;
  for (let i = 0; i < snap.flipperVel.length; i++) tip = Math.max(tip, Math.abs(snap.flipperVel[i]) * 0.072);
  peakTip = Math.max(peakTip * 0.995, tip);

  const rows: [string, string][] = [
    ['Ball speed', `${speed.toFixed(2)} m/s`],
    ['Skid (contact slip)', `${slip.toFixed(2)} m/s`],
    ['English (spin)', b ? `${(b.wz / (2 * Math.PI)).toFixed(1)} rev/s` : '–'],
    ['Flipper tip speed', `${peakTip.toFixed(2)} m/s`],
    ['Last launch', `${lastLaunch.toFixed(2)} m/s`],
    ['Last impact', `${lastImpact.toFixed(2)} m/s`],
    ['Balls in play', String(snap.balls.length)],
    ['Sim time', `${snap.time.toFixed(2)} s${snap.mode === 'replay' ? ' (replay)' : ''}`],
    ['Physics rate', `${Math.round(stats.stepsPerSecond)} steps/s`],
    ['Cost per step', `${stats.stepMicros.toFixed(1)} µs`],
    ['Render', `${fps} fps`],
  ];
  telemetry.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  speedHistory.push(speed);
  if (speedHistory.length > 240) speedHistory.shift();
  const sc = spark.getContext('2d')!;
  const w = (spark.width = spark.clientWidth * devicePixelRatio);
  const h = (spark.height = 48 * devicePixelRatio);
  sc.clearRect(0, 0, w, h);
  sc.strokeStyle = '#4fd18b';
  sc.lineWidth = devicePixelRatio;
  sc.beginPath();
  speedHistory.forEach((v, i) => {
    const x = (i / 239) * w;
    const y = h - Math.min(1, v / 6) * (h - 4) - 2;
    if (i === 0) sc.moveTo(x, y);
    else sc.lineTo(x, y);
  });
  sc.stroke();
  sc.fillStyle = '#7d8b9c';
  sc.font = `${10 * devicePixelRatio}px ui-monospace, monospace`;
  sc.fillText('ball speed · 0–6 m/s', 4 * devicePixelRatio, 12 * devicePixelRatio);
}

function frame(): void {
  renderer.draw(snap, overlays);
  frames++;
  const now = performance.now();
  if (now - fpsSince > 500) {
    fps = Math.round((frames * 1000) / (now - fpsSince));
    frames = 0;
    fpsSince = now;
  }
  updateHud();
  requestAnimationFrame(frame);
}

// the editor autosaves its draft; when it changes in another tab, follow along
window.addEventListener('storage', (e) => {
  if (e.key !== DRAFT_KEY) return;
  const draft = loadDraft();
  if (!draft) return;
  const hadDraft = !!TABLES.draft;
  TABLES.draft = draft;
  if (!hadDraft) {
    fillTableSelect($<HTMLSelectElement>('table-select'), TABLES);
    $<HTMLSelectElement>('table-select').value = tableKey in TABLES ? tableKey : 'test';
  }
  if (tableKey === 'draft') {
    loadTable(draft);
    showBanner('Editor draft changed · reloaded');
  }
});

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
// asked for the draft, but it's still missing pieces the game needs
if (new URLSearchParams(location.search).get('table') === 'draft' && !TABLES.draft) {
  const problems = draftProblems();
  if (problems.length) showBanner(`The editor draft can't be played yet: it ${problems.join(', ')}`, 6000);
}
loadTable(table);
requestAnimationFrame(frame);

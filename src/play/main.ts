/**
 * The 3D play page. The physics worker is the same one the lab uses; this page
 * only renders its snapshots in 3D and forwards inputs.
 */
import '../shared/dev-worker.ts'; // first: patches Worker before anything starts one
import { tableTuning } from '../core/physics/tuning.ts';
import type { TableDef, ThemeName } from '../core/table/format.ts';
import type { FromWorker, Snapshot, ToWorker } from '../worker/protocol.ts';
import { Stage, type Quality } from '../render3d/stage.ts';
import { Table3D } from '../render3d/table3d.ts';
import { Sfx } from '../debug/sfx.ts';
import { ButtonState, NUDGE_KEYS } from '../shared/keys.ts';

import { DRAFT_KEY, availableTables, draftProblems, fillTableSelect, linkWithTable, loadDraft, tableFromQuery } from '../shared/tables.ts';

// built-in tables plus the editor's draft (the editor's ▶ Play opens /?table=draft)
const TABLES: Record<string, TableDef> = availableTables();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* fine */
  }
}

// ------------------------------------------------------------------ setup

const canvas = $<HTMLCanvasElement>('view');
const stage = new Stage(canvas);
const sfx = new Sfx();
const worker = new Worker(new URL('../worker/physics.worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

let tableKey: string = tableFromQuery(TABLES) ?? stored<string>('pcm.play.table', 'test');
if (!TABLES[tableKey]) tableKey = 'test';
let theme = stored<ThemeName>('pcm.play.theme', 'midnight');
let qualityChoice = stored<Quality | 'auto'>('pcm.play.quality', 'auto');
let muted = stored<string>('pcm.play.muted', '0') === '1';
let paused = false;
let snap: Snapshot | null = null;
let table3d: Table3D | null = null;

function loadTable(): void {
  const base = TABLES[tableKey];
  // the theme picker previews looks without editing the table file
  const t: TableDef = { ...base, appearance: { ...base.appearance, theme } };
  table3d = new Table3D(t);
  stage.setTable(table3d);
  snap = null;
  // physics always runs the table as defined (appearance is visual only)
  send({ type: 'load', table: base, tuning: tableTuning(base), seed: 1 });
}

fillTableSelect($<HTMLSelectElement>('table-select'), TABLES);
/** The corner links carry the current table, so the lab and editor open it too. */
function syncLinks(): void {
  const lab = document.getElementById('link-lab') as HTMLAnchorElement | null;
  if (lab) linkWithTable(lab, '/lab', tableKey);
}
syncLinks();
$<HTMLSelectElement>('table-select').value = tableKey;
$<HTMLSelectElement>('theme-select').value = theme;
$<HTMLSelectElement>('quality-select').value = qualityChoice;
$<HTMLSelectElement>('table-select').onchange = (e) => {
  tableKey = (e.target as HTMLSelectElement).value;
  store('pcm.play.table', tableKey);
  history.replaceState(null, '', tableKey === 'test' ? location.pathname : `?table=${tableKey}`);
  syncLinks();
  (e.target as HTMLElement).blur();
  loadTable();
};
$<HTMLSelectElement>('theme-select').onchange = (e) => {
  theme = (e.target as HTMLSelectElement).value as ThemeName;
  store('pcm.play.theme', theme);
  (e.target as HTMLElement).blur();
  loadTable();
};
$<HTMLSelectElement>('quality-select').onchange = (e) => {
  qualityChoice = (e.target as HTMLSelectElement).value as Quality | 'auto';
  store('pcm.play.quality', qualityChoice);
  (e.target as HTMLElement).blur();
  stage.setQuality(qualityChoice === 'auto' ? 'high' : qualityChoice);
  autoSince = performance.now();
};
stage.setQuality(qualityChoice === 'auto' ? 'high' : qualityChoice);

// ------------------------------------------------------------------ worker → view

const message = $<HTMLDivElement>('message');
let messageTimer = 0;
function show(text: string, ms = 1600): void {
  message.textContent = text;
  message.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.hidden = true), ms);
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type !== 'frame') return;
  snap = m.snap;
  for (const ev of m.events) {
    switch (ev.type) {
      case 'kick':
        table3d?.flash(ev.partId);
        stage.shake(ev.kind === 'bumper' ? 0.35 : 0.25);
        if (!muted) sfx.kick(ev.kind);
        break;
      case 'hit':
        if (!muted) sfx.hit(ev.speed, ev.partId);
        if (ev.partId.startsWith('post') && ev.speed > 0.3) table3d?.flash(ev.partId);
        break;
      case 'target':
      case 'drop':
      case 'rollover':
        table3d?.flash(ev.partId);
        if (!muted) sfx.ding();
        break;
      case 'gate':
        if (!muted) sfx.gate();
        break;
      case 'flipper':
        if (ev.up && !muted) sfx.flipper();
        break;
      case 'tilt':
        show('TILT', 3000);
        if (!muted) sfx.buzz();
        break;
      case 'tiltWarning':
        show('DANGER');
        stage.shake(0.3);
        if (!muted) sfx.buzz();
        break;
      case 'ballSaved':
        show('BALL SAVED');
        break;
      case 'groupComplete':
        show(ev.group === 'drops' ? 'DROP TARGETS' : 'MULTIPLIER UP');
        break;
      case 'ballLost':
        show('BALL LOST', 1200);
        break;
      case 'gameOver':
        show('GAME OVER', 3500);
        break;
      default:
        break;
    }
  }
};

// ------------------------------------------------------------------ input

const buttons = new ButtonState((kind, down) => send({ type: 'input', kind, value: down ? 1 : 0 }));

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  sfx.unlock();
  if (buttons.key(e.code, true)) {
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  const nudge = NUDGE_KEYS[e.code];
  if (nudge) {
    e.preventDefault();
    send({ type: 'input', kind: 'nudge', value: nudge });
    stage.shake(0.4);
    return;
  }
  switch (e.code) {
    case 'KeyS':
      send({ type: 'input', kind: 'startGame' });
      break;
    case 'KeyP':
      paused = !paused;
      send({ type: 'pause', paused });
      show(paused ? 'PAUSED' : 'GO', paused ? 1e9 : 600);
      break;
    case 'KeyM':
      muted = !muted;
      store('pcm.play.muted', muted ? '1' : '0');
      show(muted ? 'SOUND OFF' : 'SOUND ON', 900);
      break;
    case 'KeyH':
      $('help').classList.toggle('hidden');
      break;
  }
});
window.addEventListener('keyup', (e) => {
  if (buttons.key(e.code, false)) e.preventDefault();
});
window.addEventListener('blur', () => buttons.releaseAll());

// ------------------------------------------------------------------ HUD

const dmdScore = $('dmd-score');
const dmdBall = $('dmd-ball');
const dmdMult = $('dmd-mult');
let shownScore = 0;

function updateHud(dt: number): void {
  const s = snap?.state;
  if (!s) return;
  // roll the score up like a real display
  shownScore = s.score < shownScore ? s.score : shownScore + Math.ceil((s.score - shownScore) * Math.min(1, dt * 12));
  dmdScore.textContent = shownScore.toLocaleString();
  if (!s.started) dmdBall.textContent = 'PRESS S TO START';
  else if (s.gameOver) dmdBall.textContent = 'GAME OVER · PRESS S';
  else dmdBall.textContent = `BALL ${s.ball} OF ${s.ballsPerGame}`;
  dmdMult.textContent = s.started && !s.gameOver && s.multiplier > 1 ? `${s.multiplier}X` : '';
  const gi = s.tilted ? 0.25 : 1;
  stage.setGI(gi);
  if (table3d) table3d.gi = gi;
}

// ------------------------------------------------------------------ loop

const fpsEl = $('fps');
let last = performance.now();
let frames = 0;
let fpsSince = last;
let frameTimeAvg = 16.7;
let autoSince = last;

function frame(now: number): void {
  // rAF timestamps can precede `last` (it is the frame's start time), so clamp at 0
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  frameTimeAvg += (dt * 1000 - frameTimeAvg) * 0.05;
  table3d?.update(snap, dt);
  updateHud(dt);
  stage.render(dt);

  frames++;
  if (now - fpsSince > 1000) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsSince))} fps · ${stage.quality}`;
    frames = 0;
    fpsSince = now;
  }
  // automatic quality: step down if we can't hold ~50 fps for a few seconds
  if (qualityChoice === 'auto' && now - autoSince > 4000 && frameTimeAvg > 20 && !document.hidden) {
    const next: Quality | null = stage.quality === 'high' ? 'medium' : stage.quality === 'medium' ? 'low' : null;
    if (next) {
      stage.setQuality(next);
      autoSince = now;
      frameTimeAvg = 16.7;
    }
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => stage.resize());
if (import.meta.env.DEV) (window as unknown as { __pcm: unknown }).__pcm = { stage };
// keep up with the editor: when its draft changes in another tab, pick it up
window.addEventListener('storage', (e) => {
  if (e.key !== DRAFT_KEY) return;
  const draft = loadDraft();
  if (!draft) return;
  const hadDraft = !!TABLES.draft;
  TABLES.draft = draft;
  if (!hadDraft) {
    fillTableSelect($<HTMLSelectElement>('table-select'), TABLES);
    $<HTMLSelectElement>('table-select').value = tableKey;
  }
  if (tableKey === 'draft') loadTable();
});

// asked for the draft, but it's still missing pieces the game needs
if (new URLSearchParams(location.search).get('table') === 'draft' && !TABLES.draft) {
  const problems = draftProblems();
  if (problems.length) show(`The editor draft can't be played yet: it ${problems.join(', ')}`, 6000);
}
loadTable();
stage.resize();
requestAnimationFrame(frame);

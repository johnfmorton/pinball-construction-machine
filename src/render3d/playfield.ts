/**
 * Procedural playfield artwork, painted to a canvas in table coordinates
 * (meters × PX_PER_M). Each theme paints its own background art; every theme
 * shares the printed details: shadows under parts, lane lines, insert bezels,
 * labels and the table name.
 */
import { flattenPath } from '../core/math/bezier.ts';
import type { TableDef } from '../core/table/format.ts';
import type { Insert } from './inserts.ts';
import type { Theme } from './themes.ts';

export const PX_PER_M = 2000;

export function paintPlayfield(table: TableDef, theme: Theme, inserts: Insert[]): HTMLCanvasElement {
  const { width: W, length: L } = table.dimensions;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * PX_PER_M);
  cv.height = Math.round(L * PX_PER_M);
  const g = cv.getContext('2d')!;
  g.scale(PX_PER_M, PX_PER_M); // draw in meters from here on

  // base
  const base = g.createLinearGradient(0, 0, 0, L);
  base.addColorStop(0, theme.baseTop);
  base.addColorStop(1, theme.baseBottom);
  g.fillStyle = base;
  g.fillRect(0, 0, W, L);

  const bumpers = table.parts.filter((p) => p.type === 'bumper') as { pos: [number, number] }[];
  const focus: [number, number] = bumpers.length
    ? [bumpers.reduce((s, b) => s + b.pos[0], 0) / bumpers.length, bumpers.reduce((s, b) => s + b.pos[1], 0) / bumpers.length]
    : [W / 2, L * 0.3];

  if (theme.name === 'midnight') paintMidnight(g, W, L, theme, focus);
  else if (theme.name === 'sunset') paintSunset(g, W, L, theme, focus);
  else paintClassic(g, W, L, theme, focus);

  // fine grain so large flat areas don't look like plastic
  speckle(g, W, L, theme.name === 'classic' ? 'rgba(60,40,10,0.05)' : 'rgba(255,255,255,0.025)');

  // printed shadows / outlines under parts
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const p of table.parts) {
    if (p.type === 'slingshot') {
      g.beginPath();
      g.moveTo(p.a[0], p.a[1]);
      g.lineTo(p.b[0], p.b[1]);
      g.lineTo(p.c[0], p.c[1]);
      g.closePath();
      g.fillStyle = withAlpha(theme.accent, 0.35);
      g.fill();
      g.lineWidth = 0.004;
      g.strokeStyle = withAlpha(theme.ink, 0.6);
      g.stroke();
    } else if (p.type === 'bumper') {
      ring(g, p.pos[0], p.pos[1], p.radius + 0.012, 0.003, withAlpha(theme.ink, 0.5));
      const rg = g.createRadialGradient(p.pos[0], p.pos[1], p.radius * 0.6, p.pos[0], p.pos[1], p.radius + 0.03);
      rg.addColorStop(0, withAlpha(theme.accent, 0.35));
      rg.addColorStop(1, withAlpha(theme.accent, 0));
      g.fillStyle = rg;
      g.beginPath();
      g.arc(p.pos[0], p.pos[1], p.radius + 0.03, 0, Math.PI * 2);
      g.fill();
    } else if (p.type === 'wall' && p.material === 'metal') {
      // lane guides get a printed lane stripe beside them
      const pts = flattenPath(p.path);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineWidth = 0.012;
      g.strokeStyle = withAlpha(theme.ink, 0.12);
      g.stroke();
    }
  }
  g.restore();

  // insert bezels and labels
  for (const ins of inserts) {
    g.save();
    g.translate(ins.x, ins.y);
    g.rotate(ins.angle);
    g.fillStyle = withAlpha('#000000', 0.55);
    g.strokeStyle = withAlpha(theme.ink, 0.85);
    g.lineWidth = 0.0018;
    insertPath(g, ins, 0.004);
    g.fill();
    g.stroke();
    g.restore();
    if (ins.label) text(g, ins.label, ins.x, ins.y + ins.size + 0.006, ins.shape === 'oval' ? 0.0085 : 0.0075, 700, theme.ink, 'top');
  }

  // table name, set like a printed title on the lower playfield
  text(g, table.meta.name.toUpperCase(), focus[0], 0.565, 0.026, 800, theme.ink, 'middle', 0.3);
  text(g, 'PINBALL CONSTRUCTION MACHINE', focus[0], 0.589, 0.0085, 600, withAlpha(theme.ink, 0.65), 'middle');

  return cv;
}

export function insertPath(g: CanvasRenderingContext2D, ins: Insert, grow = 0): void {
  const s = ins.size + grow;
  g.beginPath();
  if (ins.shape === 'circle') {
    g.arc(0, 0, s, 0, Math.PI * 2);
  } else if (ins.shape === 'oval') {
    g.ellipse(0, 0, s * 2.2, s, 0, 0, Math.PI * 2);
  } else {
    // arrow pointing along +x
    g.moveTo(s * 1.4, 0);
    g.lineTo(-s * 0.6, -s * 0.9);
    g.lineTo(-s * 0.2, 0);
    g.lineTo(-s * 0.6, s * 0.9);
    g.closePath();
  }
}

function paintMidnight(g: CanvasRenderingContext2D, W: number, L: number, t: Theme, f: [number, number]): void {
  // sunburst rays from the bumper cluster
  g.save();
  g.translate(f[0], f[1]);
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + Math.PI / n;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 1.4, a0, a1);
    g.closePath();
    g.fillStyle = withAlpha(t.accent2, i % 2 ? 0.1 : 0.05);
    g.fill();
  }
  g.restore();
  // halo behind the bumpers
  const halo = g.createRadialGradient(f[0], f[1], 0.02, f[0], f[1], 0.26);
  halo.addColorStop(0, withAlpha(t.accent2, 0.45));
  halo.addColorStop(1, withAlpha(t.accent2, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, W, L);
  // a sweeping accent arc across the middle
  g.beginPath();
  g.ellipse(W * 0.46, L * 0.62, W * 0.62, 0.1, -0.08, Math.PI * 1.05, Math.PI * 1.95);
  g.lineWidth = 0.012;
  g.strokeStyle = withAlpha(t.accent, 0.55);
  g.stroke();
  g.lineWidth = 0.003;
  g.strokeStyle = withAlpha(t.accent, 0.8);
  g.beginPath();
  g.ellipse(W * 0.46, L * 0.62 + 0.02, W * 0.62, 0.1, -0.08, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  // stars
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y = rnd() * L * 0.55;
    const r = 0.0006 + rnd() * 0.0014;
    g.fillStyle = withAlpha('#ffffff', 0.3 + rnd() * 0.5);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function paintSunset(g: CanvasRenderingContext2D, W: number, L: number, t: Theme, f: [number, number]): void {
  // a big setting sun behind the bumpers with horizon bands
  const sun = g.createLinearGradient(0, f[1] - 0.16, 0, f[1] + 0.16);
  sun.addColorStop(0, t.accent2);
  sun.addColorStop(1, t.accent);
  g.save();
  g.beginPath();
  g.arc(f[0], f[1] + 0.02, 0.17, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = sun;
  g.fillRect(0, 0, W, L);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = t.baseTop;
    const y = f[1] + 0.02 + i * 0.024;
    g.fillRect(0, y, W, 0.004 + i * 0.0016);
  }
  g.restore();
  // grid floor fading toward the flippers
  g.save();
  g.strokeStyle = withAlpha(t.accent, 0.35);
  g.lineWidth = 0.0015;
  const hy = f[1] + 0.2;
  for (let i = -12; i <= 12; i++) {
    g.beginPath();
    g.moveTo(f[0] + i * 0.004, hy);
    g.lineTo(f[0] + i * 0.06, L);
    g.stroke();
  }
  for (let k = 0; k < 12; k++) {
    const y = hy + (L - hy) * Math.pow(k / 12, 1.8);
    g.globalAlpha = 0.25 + 0.6 * (k / 12);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.restore();
}

function paintClassic(g: CanvasRenderingContext2D, W: number, L: number, t: Theme, f: [number, number]): void {
  // 70s chevrons and bold bands
  g.save();
  for (let i = 0; i < 5; i++) {
    const y = 0.42 + i * 0.05;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W / 2, y + 0.06);
    g.lineTo(W, y);
    g.lineTo(W, y + 0.022);
    g.lineTo(W / 2, y + 0.082);
    g.lineTo(0, y + 0.022);
    g.closePath();
    g.fillStyle = withAlpha(i % 2 ? t.accent2 : t.accent, 0.75);
    g.fill();
  }
  g.restore();
  g.beginPath();
  g.arc(f[0], f[1], 0.2, 0, Math.PI * 2);
  g.fillStyle = withAlpha(t.accent2, 0.18);
  g.fill();
  g.beginPath();
  g.arc(f[0], f[1], 0.14, 0, Math.PI * 2);
  g.fillStyle = withAlpha(t.accent, 0.15);
  g.fill();
}

function speckle(g: CanvasRenderingContext2D, W: number, L: number, color: string): void {
  let seed = 3;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  g.fillStyle = color;
  for (let i = 0; i < 6000; i++) g.fillRect(rnd() * W, rnd() * L, 0.0008, 0.0008);
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, color: string): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.lineWidth = w;
  g.strokeStyle = color;
  g.stroke();
}

/** Text sized in meters, drawn in pixel space so tiny font sizes aren't rounded away. */
function text(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  sizeM: number,
  weight: number,
  color: string,
  baseline: CanvasTextBaseline,
  maxWidthM?: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(1 / PX_PER_M, 1 / PX_PER_M);
  let px = sizeM * PX_PER_M;
  g.font = `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;
  if (maxWidthM) {
    const w = g.measureText(str).width;
    const max = maxWidthM * PX_PER_M;
    if (w > max) {
      px *= max / w;
      g.font = `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;
    }
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = baseline;
  g.fillText(str, 0, 0);
  g.restore();
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

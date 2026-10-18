/**
 * Plain top-down debug renderer (Canvas 2D). Deliberately simple: Phase 0 is
 * about physics feel, so this draws the true collision shapes rather than art.
 */
import { World } from '../core/physics/world.ts';
import type { MaterialName, TableDef } from '../core/table/format.ts';
import { DEFAULT_TUNING } from '../core/physics/tuning.ts';
import type { Snapshot } from '../worker/protocol.ts';

const MAT_COLOR: Record<MaterialName, string> = {
  wood: '#8b6b47',
  metal: '#a9b6c4',
  plastic: '#4fa3ff',
  rubber: '#efe9da',
  postRubber: '#efe9da',
  flipperRubber: '#ff6b5e',
  target: '#ffb547',
};

export interface Overlays {
  trail: boolean;
  vectors: boolean;
  wire: boolean;
  grid: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private geo: World;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private trails = new Map<number, Array<[number, number]>>();
  private flashes = new Map<string, number>();
  private spinAngle = new Map<number, number>();
  private lastTime = 0;
  /** Drag preview for placing a ball (table coords). */
  drag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private table: TableDef,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.geo = new World(table, DEFAULT_TUNING);
  }

  setTable(table: TableDef): void {
    this.table = table;
    this.geo = new World(table, DEFAULT_TUNING);
    this.trails.clear();
    this.flashes.clear();
    this.resize();
  }

  /**
   * Editor mode: the canvas fills its parent and the view can be zoomed and
   * panned. The lab uses the default (canvas sized to fit the table).
   */
  fill = false;
  zoom = 1;
  /** Pan offset in CSS pixels (editor mode). */
  panX = 0;
  panY = 0;
  /** Drawn last, in table coordinates (meters); `px` is one device pixel. */
  overlay: ((ctx: CanvasRenderingContext2D, px: number) => void) | null = null;
  /** CSS pixels per meter at the current zoom. */
  cssScale = 1;

  resize(): void {
    const parent = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const margin = 24;
    const { width: W, length: L } = this.table.dimensions;
    const availW = parent.clientWidth - margin * 2;
    const availH = parent.clientHeight - margin * 2;
    const s = Math.min(availW / W, availH / L);
    if (this.fill) {
      const cssW = parent.clientWidth;
      const cssH = parent.clientHeight;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
      this.cssScale = s * this.zoom;
      this.scale = this.cssScale * dpr;
      this.ox = ((cssW - W * this.cssScale) / 2 + this.panX) * dpr;
      this.oy = ((cssH - L * this.cssScale) / 2 + this.panY) * dpr;
      return;
    }
    const cssW = Math.floor(W * s + 40);
    const cssH = Math.floor(L * s + 40);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.cssScale = s;
    this.scale = s * dpr;
    this.ox = 20 * dpr;
    this.oy = 20 * dpr;
  }

  /** Convert a mouse event position to table coordinates (meters). */
  toTable(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (clientX - r.left) * dpr;
    const py = (clientY - r.top) * dpr;
    return [(px - this.ox) / this.scale, (py - this.oy) / this.scale];
  }

  flash(partId: string, ms = 140): void {
    this.flashes.set(partId.split(':')[0], performance.now() + ms);
  }

  clearTrails(): void {
    this.trails.clear();
  }

  draw(snap: Snapshot | null, ov: Overlays): void {
    const { ctx } = this;
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    const px = 1 / this.scale; // one device pixel in meters

    const { width: W, length: L } = this.table.dimensions;

    // playfield
    const grad = ctx.createLinearGradient(0, 0, 0, L);
    grad.addColorStop(0, '#1b2738');
    grad.addColorStop(1, '#141d2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, L);

    if (ov.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = 0; x <= W + 1e-9; x += 0.05) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, L);
      }
      for (let y = 0; y <= L + 1e-9; y += 0.05) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
    }

    const lit = new Set(snap?.state.lit ?? []);
    const disabled = new Set(snap?.disabled ?? []);

    // sensors
    for (const s of this.geo.sensors) {
      if (s.kind === 'drain') {
        ctx.fillStyle = 'rgba(255,93,93,0.08)';
        ctx.fillRect(s.x - s.hx, s.y - s.hy, s.hx * 2, s.hy * 2);
        continue;
      }
      const on = lit.has(s.partId);
      const fl = (this.flashes.get(s.partId) ?? 0) > now;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = fl ? '#fff3c4' : on ? '#ffb547' : 'rgba(255,181,71,0.12)';
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = 'rgba(255,181,71,0.6)';
      ctx.stroke();
    }

    // static colliders
    ctx.lineCap = 'round';
    for (const c of this.geo.statics) {
      const off = disabled.has(c.index);
      const fl = (this.flashes.get(c.partId.split(':')[0]) ?? 0) > now;
      if (c.behavior === 'bumper') {
        ctx.beginPath();
        ctx.arc(c.ax, c.ay, c.r, 0, Math.PI * 2);
        ctx.fillStyle = fl ? '#d6ecff' : '#1f4f8a';
        ctx.fill();
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = MAT_COLOR.plastic;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.ax, c.ay, c.r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = fl ? '#ffffff' : '#ffb547';
        ctx.fill();
        continue;
      }
      if (c.ax === c.bx && c.ay === c.by) {
        // posts: draw a real circle (WebKit skips zero-length round-capped lines)
        ctx.beginPath();
        ctx.arc(c.ax, c.ay, Math.max(c.r, px), 0, Math.PI * 2);
        ctx.fillStyle = fl ? '#ffffff' : MAT_COLOR[c.material];
        ctx.fill();
        if (ov.wire) {
          ctx.lineWidth = px;
          ctx.strokeStyle = '#ff00aa';
          ctx.stroke();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(c.ax, c.ay);
      ctx.lineTo(c.bx, c.by);
      ctx.lineWidth = Math.max(c.r * 2, 2 * px);
      if (fl) {
        // a just-hit drop target flashes before it disappears, so the ball
        // is never seen bouncing off empty space
        ctx.strokeStyle = '#ffffff';
      } else if (off) {
        ctx.strokeStyle = 'rgba(255,181,71,0.15)';
      } else if (c.behavior === 'sling') {
        ctx.strokeStyle = '#ffe08a';
      } else {
        ctx.strokeStyle = MAT_COLOR[c.material];
      }
      ctx.stroke();
      if (ov.wire) {
        ctx.lineWidth = px;
        ctx.strokeStyle = '#ff00aa';
        ctx.stroke();
      }
    }

    // slingshot fill for readability
    for (const p of this.table.parts) {
      if (p.type !== 'slingshot') continue;
      ctx.beginPath();
      ctx.moveTo(p.a[0], p.a[1]);
      ctx.lineTo(p.b[0], p.b[1]);
      ctx.lineTo(p.c[0], p.c[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,224,138,0.12)';
      ctx.fill();
    }

    // plunger
    this.geo.plungers.forEach((p, i) => {
      const y = snap?.plungers[i] ?? p.restY;
      ctx.fillStyle = '#c9d3de';
      ctx.fillRect(p.x - p.halfW, y - 0.003, p.halfW * 2, 0.006);
      ctx.fillStyle = 'rgba(201,211,222,0.35)';
      ctx.fillRect(p.x - 0.003, y, 0.006, 0.08);
    });

    // flippers
    this.geo.flippers.forEach((f, i) => {
      const a = snap?.flippers[i] ?? f.rest;
      this.drawFlipper(f.px, f.py, a, f.length, f.rb, f.rt, ov.wire, px);
    });

    // balls
    const R = DEFAULT_TUNING.ballRadius;
    const alive = new Set<number>();
    for (const b of snap?.balls ?? []) {
      alive.add(b.id);
      if (ov.trail) {
        let tr = this.trails.get(b.id);
        if (!tr) this.trails.set(b.id, (tr = []));
        const lastP = tr[tr.length - 1];
        if (!lastP || Math.abs(lastP[0] - b.x) + Math.abs(lastP[1] - b.y) > 0.002) tr.push([b.x, b.y]);
        if (tr.length > 400) tr.shift();
        if (tr.length > 1) {
          for (let i = 1; i < tr.length; i++) {
            ctx.beginPath();
            ctx.moveTo(tr[i - 1][0], tr[i - 1][1]);
            ctx.lineTo(tr[i][0], tr[i][1]);
            ctx.strokeStyle = `rgba(79,163,255,${(i / tr.length) * 0.55})`;
            ctx.lineWidth = 2 * px;
            ctx.stroke();
          }
        }
      }

      const g = ctx.createRadialGradient(b.x - R * 0.35, b.y - R * 0.4, R * 0.1, b.x, b.y, R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#c8ced6');
      g.addColorStop(1, '#5d6670');
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // english indicator: a line rotating with the ball's vertical-axis spin
      const sa = (this.spinAngle.get(b.id) ?? 0) + b.wz * dt * (snap?.timeScale ?? 1) * (snap?.paused ? 0 : 1);
      this.spinAngle.set(b.id, sa);
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(sa) * R * 0.8, b.y - Math.sin(sa) * R * 0.8);
      ctx.lineTo(b.x + Math.cos(sa) * R * 0.8, b.y + Math.sin(sa) * R * 0.8);
      ctx.strokeStyle = 'rgba(30,40,55,0.7)';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      // rolling indicator: a dot that travels over the ball as it rolls
      const mx = Math.sin(b.rollX) * R * 0.6;
      const my = Math.sin(b.rollY) * R * 0.6;
      if (Math.cos(b.rollX) * Math.cos(b.rollY) > 0) {
        ctx.beginPath();
        ctx.arc(b.x + mx, b.y + my, R * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6b5e';
        ctx.fill();
      }

      if (ov.vectors) {
        const k = 0.05; // 1 m/s → 5 cm
        this.arrow(b.x, b.y, b.x + b.vx * k, b.y + b.vy * k, '#4fd18b', px);
      }
    }
    for (const id of [...this.trails.keys()]) if (!alive.has(id) && !ov.trail) this.trails.delete(id);
    if (!ov.trail) this.trails.clear();

    // drag-to-throw preview
    if (this.drag) {
      const d = this.drag;
      ctx.beginPath();
      ctx.arc(d.x0, d.y0, R, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffb547';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      this.arrow(d.x0, d.y0, d.x1, d.y1, '#ffb547', px);
    }

    this.overlay?.(ctx, px);
  }

  private drawFlipper(px0: number, py0: number, a: number, L: number, rb: number, rt: number, wire: boolean, px: number): void {
    const { ctx } = this;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const sinT = (rb - rt) / L;
    const cosT = Math.sqrt(1 - sinT * sinT);
    // tangent points on both sides
    const side = (s: number) => {
      const nx = sinT * ux + cosT * -uy * s;
      const ny = sinT * uy + cosT * ux * s;
      return [px0 + nx * rb, py0 + ny * rb, px0 + ux * L + nx * rt, py0 + uy * L + ny * rt];
    };
    const [a1x, a1y, b1x, b1y] = side(1);
    const [a2x, a2y, b2x, b2y] = side(-1);
    ctx.beginPath();
    ctx.moveTo(a1x, a1y);
    ctx.lineTo(b1x, b1y);
    ctx.arc(px0 + ux * L, py0 + uy * L, rt, Math.atan2(b1y - py0 - uy * L, b1x - px0 - ux * L), Math.atan2(b2y - py0 - uy * L, b2x - px0 - ux * L), true);
    ctx.lineTo(a2x, a2y);
    ctx.arc(px0, py0, rb, Math.atan2(a2y - py0, a2x - px0), Math.atan2(a1y - py0, a1x - px0), true);
    ctx.closePath();
    ctx.fillStyle = '#f4f1e8';
    ctx.fill();
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = MAT_COLOR.flipperRubber;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px0, py0, rb * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#7d8b9c';
    ctx.fill();
    if (wire) {
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px0 + ux * L, py0 + uy * L);
      ctx.strokeStyle = '#ff00aa';
      ctx.lineWidth = px;
      ctx.stroke();
    }
  }

  private arrow(x0: number, y0: number, x1: number, y1: number, color: string, px: number): void {
    const { ctx } = this;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-4) return;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    const hx = dx / l;
    const hy = dy / l;
    const hs = Math.min(0.008, l * 0.4);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - hx * hs - hy * hs * 0.5, y1 - hy * hs + hx * hs * 0.5);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - hx * hs + hy * hs * 0.5, y1 - hy * hs - hx * hs * 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }
}

/**
 * The top-down editing canvas: draws the table (with the same renderer as the
 * Physics Lab, so shapes are the true colliders), plus selection, handles,
 * guides and marquee; turns pointer/keyboard input into editor commands.
 */
import { Renderer } from '../debug/renderer.ts';
import type { Vec2 } from '../core/math/bezier.ts';
import type { TableDef } from '../core/table/format.ts';
import { anchor, hitTest, mirrorAxis, partBounds, partsInRect, rotatePart, scalePart, translatePart, unionBounds, type Bounds } from './model/parts.ts';
import { snapAngle, snapPoint } from './model/snap.ts';
import { canPlace, catalogEntry, instantiate } from './model/catalog.ts';
import type { EditorState } from './store.svelte.ts';

type Drag =
  | { kind: 'move'; start: Vec2; base: TableDef; anchor: Vec2 }
  | { kind: 'rotate'; center: Vec2; startAngle: number; base: TableDef }
  | { kind: 'scale'; center: Vec2; startDist: number; base: TableDef }
  | { kind: 'marquee'; start: Vec2; now: Vec2; additive: boolean }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number };

const HANDLE_PX = 7;
const ROTATE_OFFSET_PX = 26;
const OVERLAYS = { trail: false, vectors: false, wire: false, grid: false };

export class EditorCanvas {
  readonly renderer: Renderer;
  private drag: Drag | null = null;
  private spaceDown = false;
  private shownTable: TableDef | null = null;
  private raf = 0;
  cursor: Vec2 | null = null;
  showGrid = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private ed: EditorState,
  ) {
    this.renderer = new Renderer(canvas, ed.table);
    this.renderer.fill = true;
    this.renderer.overlay = (ctx, px) => this.drawOverlay(ctx, px);
    this.renderer.resize();
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dragover', this.onDragOver);
    canvas.addEventListener('dragleave', this.onDragLeave);
    canvas.addEventListener('drop', this.onDrop);
    canvas.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.ed.hover = null;
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.resize);
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.resize);
  }

  resize = (): void => this.renderer.resize();

  fit(): void {
    this.renderer.zoom = 1;
    this.renderer.panX = this.renderer.panY = 0;
    this.renderer.resize();
  }

  zoomBy(k: number, at?: { x: number; y: number }): void {
    const r = this.renderer;
    const rect = this.canvas.getBoundingClientRect();
    const cx = at?.x ?? rect.left + rect.width / 2;
    const cy = at?.y ?? rect.top + rect.height / 2;
    const before = r.toTable(cx, cy);
    r.zoom = Math.min(12, Math.max(0.4, r.zoom * k));
    r.resize();
    const after = r.toTable(cx, cy);
    // keep the point under the cursor fixed
    r.panX += (after[0] - before[0]) * r.cssScale;
    r.panY += (after[1] - before[1]) * r.cssScale;
    r.resize();
  }

  get zoom(): number {
    return this.renderer.zoom;
  }

  // ------------------------------------------------------------ frame

  private shownPreview: unknown = null;

  private frame(): void {
    const { table, preview } = this.ed;
    if (this.shownTable !== table || this.shownPreview !== preview) {
      // the World rebuild re-derives true collider shapes from the table data;
      // a palette drag shows its parts as if already placed
      const keepZoom = [this.renderer.zoom, this.renderer.panX, this.renderer.panY] as const;
      this.renderer.setTable(preview ? { ...table, parts: [...table.parts, ...preview] } : table);
      [this.renderer.zoom, this.renderer.panX, this.renderer.panY] = keepZoom;
      this.renderer.resize();
      this.shownTable = table;
      this.shownPreview = preview;
    }
    this.renderer.draw(null, OVERLAYS);
  }

  /** Meters per screen pixel at the current zoom. */
  private get m(): number {
    return 1 / this.renderer.cssScale;
  }

  // ------------------------------------------------------------ overlay

  private drawOverlay(ctx: CanvasRenderingContext2D, px: number): void {
    const ed = this.ed;
    const t = ed.table;
    const { width: W, length: L } = t.dimensions;
    const cssPx = this.m; // one CSS pixel in meters

    // 5 mm grid (only when zoomed in enough to be useful) and the mirror axis
    if (this.showGrid && this.renderer.cssScale * 0.005 >= 5) {
      ctx.beginPath();
      for (let x = 0; x <= W + 1e-9; x += 0.005) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, L);
      }
      for (let y = 0; y <= L + 1e-9; y += 0.005) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = px;
      ctx.stroke();
    }
    const axis = mirrorAxis(t);
    ctx.save();
    ctx.setLineDash([6 * cssPx, 6 * cssPx]);
    ctx.beginPath();
    ctx.moveTo(axis, 0);
    ctx.lineTo(axis, L);
    ctx.strokeStyle = 'rgba(79,209,255,0.25)';
    ctx.lineWidth = px;
    ctx.stroke();
    ctx.restore();

    // ball start marker
    for (const p of t.parts) {
      if (p.type !== 'ballStart') continue;
      ctx.beginPath();
      ctx.arc(p.pos[0], p.pos[1], 0.0135, 0, Math.PI * 2);
      ctx.setLineDash([3 * cssPx, 3 * cssPx]);
      ctx.strokeStyle = 'rgba(200,206,214,0.8)';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // hover
    const hovered = ed.hover ? t.parts.find((p) => p.id === ed.hover) : null;
    if (hovered && !ed.selection.includes(hovered.id)) this.box(ctx, partBounds(hovered), 'rgba(79,163,255,0.6)', 1.5 * px, cssPx, false);

    // selection
    const sel = ed.selectedParts;
    for (const p of sel) this.box(ctx, partBounds(p), 'rgba(79,163,255,0.9)', 1.5 * px, cssPx, sel.length > 1);
    const b = ed.selectionBounds;
    if (b && (!this.drag || this.drag.kind !== 'marquee')) {
      const pad = 4 * cssPx;
      const gb: Bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
      if (sel.length > 1) this.box(ctx, gb, 'rgba(79,163,255,0.9)', 1.5 * px, cssPx, false);
      // scale handles at the corners
      const hs = HANDLE_PX * cssPx;
      for (const [x, y] of corners(gb)) {
        ctx.fillStyle = '#0d1117';
        ctx.strokeStyle = '#4fa3ff';
        ctx.lineWidth = 1.5 * px;
        ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
        ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
      }
      // rotate handle above the top edge
      const rx = (gb.minX + gb.maxX) / 2;
      const ry = gb.minY - ROTATE_OFFSET_PX * cssPx;
      ctx.beginPath();
      ctx.moveTo(rx, gb.minY);
      ctx.lineTo(rx, ry);
      ctx.strokeStyle = 'rgba(79,163,255,0.7)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, ry, hs * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#4fa3ff';
      ctx.fill();
    }

    // parts being dragged in from the palette
    if (ed.preview?.length) {
      const pb = unionBounds(ed.preview.map(partBounds));
      if (pb) this.box(ctx, pb, 'rgba(126,231,135,0.9)', 1.5 * px, cssPx, true);
    }

    // smart guides
    for (const g of ed.guides) {
      ctx.beginPath();
      if (g.axis === 'x') {
        ctx.moveTo(g.at, 0);
        ctx.lineTo(g.at, L);
      } else {
        ctx.moveTo(0, g.at);
        ctx.lineTo(W, g.at);
      }
      ctx.strokeStyle = g.kind === 'mirror' ? '#4fd1ff' : '#ff4fd8';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
    }

    // marquee
    if (this.drag?.kind === 'marquee') {
      const r = rectOf(this.drag.start, this.drag.now);
      ctx.fillStyle = 'rgba(79,163,255,0.08)';
      ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
      ctx.strokeStyle = 'rgba(79,163,255,0.8)';
      ctx.lineWidth = px;
      ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
    }
  }

  private box(ctx: CanvasRenderingContext2D, b: Bounds, color: string, lw: number, cssPx: number, dashed: boolean): void {
    const pad = 2 * cssPx;
    ctx.save();
    if (dashed) ctx.setLineDash([4 * cssPx, 3 * cssPx]);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
    ctx.restore();
  }

  // ------------------------------------------------------------ pointer

  private handleAt(x: number, y: number): 'rotate' | 'scale' | null {
    const b = this.ed.selectionBounds;
    if (!b) return null;
    const m = this.m;
    const pad = 4 * m;
    const gb: Bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    const rx = (gb.minX + gb.maxX) / 2;
    const ry = gb.minY - ROTATE_OFFSET_PX * m;
    if (Math.hypot(x - rx, y - ry) < 9 * m) return 'rotate';
    for (const [cx, cy] of corners(gb)) if (Math.abs(x - cx) < 7 * m && Math.abs(y - cy) < 7 * m) return 'scale';
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.renderer.toTable(e.clientX, e.clientY);
    const ed = this.ed;
    // pan: middle button, or space held
    if (e.button === 1 || this.spaceDown) {
      this.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: this.renderer.panX, panY: this.renderer.panY };
      return;
    }
    if (e.button !== 0) return;
    const handle = this.handleAt(x, y);
    const c = ed.selectionCenter;
    if (handle && c) {
      const center = ed.selectedParts.length === 1 && handle === 'rotate' ? anchor(ed.selectedParts[0]) : c;
      ed.beginDrag();
      this.drag =
        handle === 'rotate'
          ? { kind: 'rotate', center, startAngle: Math.atan2(y - center[1], x - center[0]), base: ed.table }
          : { kind: 'scale', center, startDist: Math.max(1e-4, Math.hypot(x - center[0], y - center[1])), base: ed.table };
      return;
    }
    const hit = hitTest(ed.table, x, y, 4 * this.m);
    if (hit) {
      if (e.shiftKey) {
        ed.select([hit.id], true);
        return;
      }
      if (!ed.selection.includes(hit.id)) ed.select([hit.id]);
      // option/alt-drag duplicates, like most design tools
      if (e.altKey) ed.duplicateSelected([0, 0]);
      ed.beginDrag();
      const b = ed.selectionBounds!;
      const a: Vec2 = ed.selectedParts.length === 1 ? anchor(ed.selectedParts[0]) : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      this.drag = { kind: 'move', start: [x, y], base: ed.table, anchor: a };
      return;
    }
    this.drag = { kind: 'marquee', start: [x, y], now: [x, y], additive: e.shiftKey };
    if (!e.shiftKey) ed.select([]);
  };

  private onMove = (e: PointerEvent): void => {
    const [x, y] = this.renderer.toTable(e.clientX, e.clientY);
    this.cursor = [x, y];
    const ed = this.ed;
    const d = this.drag;
    const free = e.metaKey || e.ctrlKey; // hold ⌘ (Ctrl) to place freely
    if (!d) {
      const handle = this.handleAt(x, y);
      const hit = handle ? null : hitTest(ed.table, x, y, 4 * this.m);
      ed.hover = hit?.id ?? null;
      this.canvas.style.cursor = this.spaceDown ? 'grab' : handle === 'rotate' ? 'alias' : handle === 'scale' ? 'nwse-resize' : hit ? 'move' : 'default';
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.renderer.panX = d.panX + (e.clientX - d.startX);
        this.renderer.panY = d.panY + (e.clientY - d.startY);
        this.renderer.resize();
        break;
      case 'marquee':
        d.now = [x, y];
        break;
      case 'move': {
        const want: Vec2 = [d.anchor[0] + x - d.start[0], d.anchor[1] + y - d.start[1]];
        let target = want;
        if (ed.snap && !free) {
          const moving = new Set(ed.selection);
          const others = d.base.parts.filter((p) => !moving.has(p.id) && p.type !== 'wall' && p.type !== 'drain').map(anchor);
          const r = snapPoint(want, { anchors: others, mirror: mirrorAxis(d.base) }, 6 * this.m);
          target = r.point;
          ed.guides = r.guides;
        } else ed.guides = [];
        const dx = target[0] - d.anchor[0];
        const dy = target[1] - d.anchor[1];
        ed.dragTo(ed.mapSelected((p) => translatePart(p, dx, dy), d.base));
        break;
      }
      case 'rotate': {
        let theta = Math.atan2(y - d.center[1], x - d.center[0]) - d.startAngle;
        if (ed.snap && !free) theta = snapAngle(theta);
        ed.dragTo(ed.mapSelected((p) => rotatePart(p, theta, d.center), d.base));
        ed.status = `Rotate ${Math.round((theta * 180) / Math.PI)}°`;
        break;
      }
      case 'scale': {
        let k = Math.hypot(x - d.center[0], y - d.center[1]) / d.startDist;
        if (ed.snap && !free) k = Math.max(0.05, Math.round(k * 20) / 20); // 5% steps
        ed.dragTo(ed.mapSelected((p) => scalePart(p, k, d.center), d.base));
        ed.status = `Scale ${Math.round(k * 100)}%`;
        break;
      }
    }
  };

  private onUp = (): void => {
    const d = this.drag;
    this.drag = null;
    const ed = this.ed;
    if (!d) return;
    if (d.kind === 'marquee') {
      const r = rectOf(d.start, d.now);
      if (r.maxX - r.minX > 1e-3 || r.maxY - r.minY > 1e-3) ed.select(partsInRect(ed.table, r).map((p) => p.id), d.additive);
    } else if (d.kind === 'move') ed.endDrag('move');
    else if (d.kind === 'rotate') ed.endDrag('rotate');
    else if (d.kind === 'scale') ed.endDrag('resize');
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // pinch (ctrlKey) or a mouse wheel zooms; two-finger trackpad scroll pans
    if (e.ctrlKey || e.deltaMode !== 0) {
      this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), { x: e.clientX, y: e.clientY });
    } else {
      this.renderer.panX -= e.deltaX;
      this.renderer.panY -= e.deltaY;
      this.renderer.resize();
    }
  };

  // ------------------------------------------------------------ palette drops

  /** The palette parts for `key`, placed at (x, y) with the same snapping as a move. */
  private placed(key: string, x: number, y: number, free: boolean): ReturnType<typeof instantiate> | null {
    const ed = this.ed;
    const entry = catalogEntry(key);
    if (!entry || !canPlace(entry, ed.table)) return null;
    let at: Vec2 = [x, y];
    if (ed.snap && !free) {
      const others = ed.table.parts.filter((p) => p.type !== 'wall' && p.type !== 'drain').map(anchor);
      const r = snapPoint(at, { anchors: others, mirror: mirrorAxis(ed.table) }, 6 * this.m);
      at = r.point;
      ed.guides = r.guides;
    } else ed.guides = [];
    return instantiate(entry, ed.table, at);
  }

  private onDragOver = (e: DragEvent): void => {
    const key = this.ed.dragging;
    if (!key) return;
    const [x, y] = this.renderer.toTable(e.clientX, e.clientY);
    const parts = this.placed(key, x, y, e.metaKey || e.ctrlKey);
    if (!parts) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault(); // allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    this.ed.preview = parts;
    this.cursor = [x, y];
  };

  private onDragLeave = (): void => {
    this.ed.preview = null;
    this.ed.guides = [];
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const parts = this.ed.preview;
    const key = this.ed.dragging;
    this.ed.preview = null;
    this.ed.guides = [];
    this.ed.dragging = null;
    if (parts && key) this.ed.addParts(parts, `add ${catalogEntry(key)?.label.toLowerCase() ?? 'part'}`);
    this.canvas.focus();
  };

  /** Add a palette entry in the middle of the visible table (a click instead of a drag). */
  placeAtCenter(key: string): void {
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.renderer.toTable(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const { width: W, length: L } = this.ed.table.dimensions;
    const parts = this.placed(key, Math.min(W - 0.03, Math.max(0.03, x)), Math.min(L - 0.03, Math.max(0.03, y)), false);
    this.ed.guides = [];
    if (parts) this.ed.addParts(parts, `add ${catalogEntry(key)?.label.toLowerCase() ?? 'part'}`);
  }

  // ------------------------------------------------------------ keyboard

  private onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const ed = this.ed;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 0.005 : 0.001;
    if (e.code === 'Space') {
      this.spaceDown = true;
      e.preventDefault();
      return;
    }
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) ed.redo();
      else ed.undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      ed.redo();
      return;
    }
    if (mod && e.code === 'KeyD') {
      e.preventDefault();
      ed.duplicateSelected();
      return;
    }
    if (mod && e.code === 'KeyA') {
      e.preventDefault();
      ed.selectAll();
      return;
    }
    switch (e.code) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        ed.deleteSelected();
        break;
      case 'Escape':
        if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'marquee') ed.cancelDrag();
        this.drag = null;
        ed.select([]);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        ed.nudge(-step, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        ed.nudge(step, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        ed.nudge(0, -step);
        break;
      case 'ArrowDown':
        e.preventDefault();
        ed.nudge(0, step);
        break;
      case 'BracketLeft':
        ed.rotateSelected(e.shiftKey ? -15 : -5);
        break;
      case 'BracketRight':
        ed.rotateSelected(e.shiftKey ? 15 : 5);
        break;
      case 'Minus':
        ed.scaleSelected(0.95);
        break;
      case 'Equal':
        ed.scaleSelected(1.05);
        break;
      case 'KeyM':
        ed.mirrorSelected();
        break;
      case 'Digit0':
        this.fit();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceDown = false;
  };
}

function corners(b: Bounds): Vec2[] {
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
}

function rectOf(a: Vec2, b: Vec2): Bounds {
  return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}

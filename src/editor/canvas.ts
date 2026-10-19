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
import { hitPath, insertNode, moveHandle, moveNode, toNodes, toPath, toggleSmooth, type EditPath, type PathNode } from './model/path.ts';
import { uniqueId } from './model/history.ts';
import { mirrorPart } from './model/parts.ts';
import { PEN_PRESETS } from './store.svelte.ts';
import type { Part } from '../core/table/format.ts';
import type { EditorState } from './store.svelte.ts';

type Drag =
  | { kind: 'move'; start: Vec2; base: TableDef; anchor: Vec2 }
  | { kind: 'rotate'; center: Vec2; startAngle: number; base: TableDef }
  | { kind: 'scale'; center: Vec2; startDist: number; base: TableDef }
  | { kind: 'marquee'; start: Vec2; now: Vec2; additive: boolean }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'node'; id: string; index: number; base: TableDef }
  | { kind: 'handle'; id: string; index: number; which: 'in' | 'out'; base: TableDef };

/** A wall being drawn with the pen. */
interface PenState {
  nodes: PathNode[];
  /** Mouse is down on the newest node: dragging pulls out its curve handles. */
  pulling: boolean;
  /** Snapped cursor, for the rubber-band segment to the next point. */
  cursor: Vec2 | null;
}

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
  private pen: PenState | null = null;

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
    canvas.addEventListener('dblclick', this.onDoubleClick);
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

    // symmetry: highlight the mirror twins of the selection
    if (ed.symmetry) {
      const twins = ed.twins;
      for (const p of sel) {
        const twin = twins.get(p.id);
        const q = twin ? t.parts.find((x) => x.id === twin) : null;
        if (q && !ed.selection.includes(q.id)) this.box(ctx, partBounds(q), 'rgba(79,209,255,0.85)', 1.5 * px, cssPx, true);
      }
    }

    // point editing on a single selected wall
    const wall = ed.selectedWall;
    if (wall && ed.tool === 'select') this.drawNodes(ctx, toNodes(wall.path), cssPx, px, ed.activeNode);

    // the wall being drawn
    if (this.pen) {
      const e: EditPath = { nodes: this.pen.nodes, closed: false };
      this.drawNodes(ctx, e, cssPx, px, null);
      const first = this.pen.nodes[0];
      const c = this.pen.cursor;
      if (c && this.pen.nodes.length >= 3 && Math.hypot(c[0] - first.p[0], c[1] - first.p[1]) < 8 * cssPx) {
        ctx.beginPath();
        ctx.arc(first.p[0], first.p[1], 7 * cssPx, 0, Math.PI * 2);
        ctx.strokeStyle = '#7ee787';
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      }
    }

    // parts being dragged in from the palette
    if (ed.preview?.length && !this.pen) {
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

  /** Path nodes (squares) and their curve handles (dots on stalks). */
  private drawNodes(ctx: CanvasRenderingContext2D, e: EditPath, cssPx: number, px: number, active: number | null): void {
    const s = 3.5 * cssPx;
    ctx.lineWidth = px;
    for (const n of e.nodes) {
      for (const h of [n.in, n.out]) {
        if (!h) continue;
        ctx.beginPath();
        ctx.moveTo(n.p[0], n.p[1]);
        ctx.lineTo(h[0], h[1]);
        ctx.strokeStyle = 'rgba(126,231,135,0.7)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h[0], h[1], 3 * cssPx, 0, Math.PI * 2);
        ctx.fillStyle = '#7ee787';
        ctx.fill();
      }
    }
    e.nodes.forEach((n, i) => {
      ctx.fillStyle = i === active ? '#7ee787' : '#0d1117';
      ctx.strokeStyle = '#7ee787';
      ctx.lineWidth = 1.5 * px;
      ctx.fillRect(n.p[0] - s, n.p[1] - s, 2 * s, 2 * s);
      ctx.strokeRect(n.p[0] - s, n.p[1] - s, 2 * s, 2 * s);
    });
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
    if (ed.tool === 'pen') {
      this.penDown(x, y, e);
      return;
    }
    // points and curve handles of the selected wall come first
    const wall = ed.selectedWall;
    if (wall) {
      const h = hitPath(toNodes(wall.path), x, y, 6 * this.m, 0);
      if (h && h.kind !== 'segment') {
        ed.beginDrag();
        if (h.kind === 'node') {
          ed.activeNode = h.index;
          this.drag = { kind: 'node', id: wall.id, index: h.index, base: ed.table };
        } else this.drag = { kind: 'handle', id: wall.id, index: h.index, which: h.which, base: ed.table };
        return;
      }
    }
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
      ed.activeNode = null;
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
    if (ed.tool === 'pen') {
      this.penMove(x, y, e);
      return;
    }
    if (!d) {
      const wall = ed.selectedWall;
      const onPoint = wall && hitPath(toNodes(wall.path), x, y, 6 * this.m, 0);
      if (onPoint) {
        this.canvas.style.cursor = onPoint.kind === 'node' ? 'move' : 'crosshair';
        return;
      }
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
      case 'node': {
        const target = this.snapNode([x, y], d.base, d.id, d.index, free);
        ed.dragTo(ed.withWallPath(d.id, (p) => moveNode(p, d.index, target), d.base));
        break;
      }
      case 'handle': {
        const target: Vec2 = free || !ed.snap ? [x, y] : [snapGridM(x), snapGridM(y)];
        ed.dragTo(ed.withWallPath(d.id, (p) => moveHandle(p, d.index, d.which, target, e.altKey), d.base));
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
    if (this.pen) this.pen.pulling = false;
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
    else if (d.kind === 'node') ed.endDrag('move point');
    else if (d.kind === 'handle') ed.endDrag('reshape curve');
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

  // ------------------------------------------------------------ pen tool

  /** Snap a wall point: grid, other parts' anchors and wall points, the mirror axis. */
  private snapNode(p: Vec2, base: TableDef, skipId: string | null, skipIndex: number, free: boolean, from?: Vec2, constrain = false): Vec2 {
    const ed = this.ed;
    if (constrain && from) {
      // Shift: lock the segment to 15° steps from the previous point
      const a = Math.round(Math.atan2(p[1] - from[1], p[0] - from[0]) / (Math.PI / 12)) * (Math.PI / 12);
      const len = Math.hypot(p[0] - from[0], p[1] - from[1]);
      return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
    }
    if (!ed.snap || free) {
      ed.guides = [];
      return p;
    }
    const anchors: Vec2[] = [];
    for (const q of base.parts) {
      if (q.type === 'drain') continue;
      if (q.type === 'wall') {
        toNodes(q.path).nodes.forEach((n, i) => {
          if (q.id !== skipId || i !== skipIndex) anchors.push(n.p);
        });
      } else anchors.push(anchor(q));
    }
    if (this.pen) for (const n of this.pen.nodes) anchors.push(n.p);
    const r = snapPoint(p, { anchors, mirror: mirrorAxis(base) }, 6 * this.m);
    ed.guides = r.guides;
    return r.point;
  }

  /** The wall(s) the pen would make from these nodes (two with symmetry on). */
  private penWalls(nodes: PathNode[], closed: boolean): Part[] {
    const ed = this.ed;
    const preset = PEN_PRESETS[ed.penPreset];
    const id = uniqueId(ed.table, preset.stem);
    const wall: Part = {
      id,
      type: 'wall',
      thickness: preset.thickness,
      height: preset.height,
      material: preset.material,
      path: toPath({ nodes, closed }),
    };
    if (!ed.symmetry) return [wall];
    const twin = { ...mirrorPart(wall, mirrorAxis(ed.table)), id: uniqueId(ed.table, preset.stem, new Set([id])) };
    return [wall, twin];
  }

  private updatePenPreview(): void {
    const pen = this.pen;
    if (!pen) return;
    const nodes = [...pen.nodes];
    if (pen.cursor && !pen.pulling) nodes.push({ p: pen.cursor });
    this.ed.preview = nodes.length >= 2 ? this.penWalls(nodes, false) : null;
  }

  private penDown(x: number, y: number, e: PointerEvent): void {
    const pen = this.pen;
    const last = pen?.nodes[pen.nodes.length - 1];
    const p = this.snapNode([x, y], this.ed.table, null, -1, e.metaKey || e.ctrlKey, last?.p, e.shiftKey);
    const near = (q: Vec2) => Math.hypot(q[0] - x, q[1] - y) < 8 * this.m;
    if (!pen) {
      this.ed.select([]);
      this.pen = { nodes: [{ p }], pulling: true, cursor: p };
      return;
    }
    if (pen.nodes.length >= 3 && near(pen.nodes[0].p)) {
      this.finishPen(true);
      return;
    }
    if (last && near(last.p)) {
      // clicking the last point again (or a double-click) finishes the wall
      this.finishPen(false);
      return;
    }
    pen.nodes.push({ p });
    pen.pulling = true;
    this.updatePenPreview();
  }

  private penMove(x: number, y: number, e: PointerEvent): void {
    this.canvas.style.cursor = 'crosshair';
    const pen = this.pen;
    if (pen?.pulling) {
      // dragging out a curve: the handle follows the mouse, its twin mirrors it
      const n = pen.nodes[pen.nodes.length - 1];
      if (Math.hypot(x - n.p[0], y - n.p[1]) > 3 * this.m) {
        n.out = [x, y];
        n.in = [2 * n.p[0] - x, 2 * n.p[1] - y];
        if (pen.nodes.length === 1) delete n.in;
      }
      this.updatePenPreview();
      return;
    }
    const last = pen?.nodes[pen.nodes.length - 1];
    const p = this.snapNode([x, y], this.ed.table, null, -1, e.metaKey || e.ctrlKey, last?.p, e.shiftKey);
    if (pen) {
      pen.cursor = p;
      this.updatePenPreview();
    }
  }

  /** Finish the wall being drawn (needs two points; fewer just cancels). */
  finishPen(closed = false): void {
    const pen = this.pen;
    this.pen = null;
    this.ed.preview = null;
    this.ed.guides = [];
    if (!pen || pen.nodes.length < 2) return;
    const walls = this.penWalls(pen.nodes, closed && pen.nodes.length >= 3);
    this.ed.addParts(walls, walls.length > 1 ? 'draw mirrored walls' : 'draw wall');
    this.ed.status = 'Wall added. Keep clicking to draw another, or press V to edit it.';
  }

  /** Backspace while drawing: take back the last point. */
  private penUndoPoint(): void {
    if (!this.pen) return;
    this.pen.nodes.pop();
    if (!this.pen.nodes.length) {
      this.pen = null;
      this.ed.preview = null;
    } else this.updatePenPreview();
  }

  get drawing(): boolean {
    return !!this.pen;
  }

  private onDoubleClick = (e: MouseEvent): void => {
    const ed = this.ed;
    if (ed.tool !== 'select') return;
    const wall = ed.selectedWall;
    if (!wall) return;
    const [x, y] = this.renderer.toTable(e.clientX, e.clientY);
    const h = hitPath(toNodes(wall.path), x, y, 6 * this.m, wall.thickness / 2 + 4 * this.m);
    if (!h || h.kind === 'handle') return;
    if (h.kind === 'node') {
      // corner ↔ smooth curve
      ed.commit(ed.withWallPath(wall.id, (p) => toggleSmooth(p, h.index)), 'toggle curve');
      ed.activeNode = h.index;
    } else {
      ed.commit(ed.withWallPath(wall.id, (p) => insertNode(p, h.index, h.t)), 'add point');
      ed.activeNode = h.index + 1;
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
    if (this.pen) {
      if (e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        this.finishPen(false);
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault();
        this.penUndoPoint();
        return;
      }
    }
    if (!mod && e.code === 'KeyP') {
      this.setTool('pen');
      return;
    }
    if (!mod && e.code === 'KeyV' && !e.shiftKey) {
      this.setTool('select');
      return;
    }
    if (!mod && e.shiftKey && e.code === 'KeyH') {
      ed.flipSelected('x');
      return;
    }
    if (!mod && e.shiftKey && e.code === 'KeyV') {
      ed.flipSelected('y');
      return;
    }
    if (!mod && e.code === 'KeyS' && !e.shiftKey) {
      ed.symmetry = !ed.symmetry;
      ed.status = ed.symmetry ? 'Symmetry on: mirror-image pairs edit together' : 'Symmetry off';
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
        if (ed.activeNode !== null) {
          ed.activeNode = null;
          break;
        }
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

  /** Switch tools, finishing any wall being drawn. */
  setTool(tool: 'select' | 'pen'): void {
    if (this.pen) this.finishPen(false);
    this.ed.tool = tool;
    this.canvas.style.cursor = tool === 'pen' ? 'crosshair' : 'default';
    if (tool === 'pen') this.ed.status = 'Pen: click to add points, drag to curve, click the last point (or Enter) to finish, the first point to close';
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceDown = false;
  };
}

function snapGridM(v: number): number {
  return Math.round(v / 0.001) * 0.001; // curve handles snap to 1 mm
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

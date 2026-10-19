/**
 * Builds the 3D table from a TableDef and animates it from physics snapshots.
 * Purely visual: the physics worker owns all state; this only follows it.
 */
import * as THREE from 'three';
import { flattenPath } from '../core/math/bezier.ts';
import { DEG } from '../core/math/dmath.ts';
import { World } from '../core/physics/world.ts';
import { DEFAULT_TUNING } from '../core/physics/tuning.ts';
import type { TableDef } from '../core/table/format.ts';
import type { Snapshot } from '../worker/protocol.ts';
import { computeInserts, type Insert } from './inserts.ts';
import { makeMaterials, type MaterialKit } from './materials.ts';
import { paintPlayfield } from './playfield.ts';
import { barGeometry, blobTexture, extrudeOutline, mergeInto, post, taperedOutline, torusAt, wallGeometry } from './parts.ts';
import { resolveTheme, type Theme } from './themes.ts';

const R = DEFAULT_TUNING.ballRadius;
const BALL_Y = R; // ball center height above the playfield

interface Lamp {
  insert: Insert;
  mat: THREE.MeshStandardMaterial;
  level: number; // current brightness 0..1 (lamps fade like incandescent bulbs)
}

interface Bumper {
  partId: string;
  light: THREE.PointLight;
  cap: THREE.MeshPhysicalMaterial;
  body: THREE.MeshStandardMaterial;
  skirt: THREE.Object3D;
  flash: number;
}

interface Sling {
  partId: string;
  plastic: THREE.MeshPhysicalMaterial;
  band: THREE.Mesh;
  flash: number;
}

/** A one-way gate's wire flap, swung open by balls passing through (visual only). */
export interface Gate {
  flap: THREE.Object3D;
  /** Wire endpoints and the pass direction, in table space. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
  /** Flap rotation sign: local rotation.x that swings the flap toward the pass direction is −sign·θ. */
  sign: number;
  angle: number;
}

const GATE_HINGE = 0.031; // hinge height above the playfield (m)
const GATE_FLAP = 0.027; // flap length, hinge to bottom wire (m)

export class Table3D {
  readonly group = new THREE.Group();
  readonly theme: Theme;
  readonly mats: MaterialKit;
  readonly table: TableDef;
  private geo: World;
  private flippers: { group: THREE.Group; rest: number }[] = [];
  private plungers: { group: THREE.Group; restY: number }[] = [];
  private balls: { mesh: THREE.Mesh; shadow: THREE.Mesh }[] = [];
  private ballGeo = new THREE.SphereGeometry(R, 48, 32);
  private shadowMat: THREE.MeshBasicMaterial;
  private drops = new Map<number, { mesh: THREE.Object3D; offset: number }>();
  private lamps: Lamp[] = [];
  private bumpers: Bumper[] = [];
  private slings: Sling[] = [];
  private targetFlash = new Map<string, number>();
  private gates: Gate[] = [];
  private time = 0;
  /** General illumination level (dims on tilt). */
  gi = 1;

  constructor(table: TableDef) {
    this.table = table;
    this.theme = resolveTheme(table.appearance);
    this.mats = makeMaterials(this.theme);
    this.geo = new World(table, DEFAULT_TUNING);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
    this.build();
  }

  // ------------------------------------------------------------------ build

  private add(geom: THREE.BufferGeometry, mat: THREE.Material, cast = true, receive = true): THREE.Mesh {
    geom.clearGroups(); // one material per mesh: one draw call, not one per face group
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.group.add(m);
    return m;
  }

  private build(): void {
    const { width: W, length: L } = this.table.dimensions;
    const inserts = computeInserts(this.table);
    const M = this.mats;

    // playfield with painted art and a clear coat
    const canvas = paintPlayfield(this.table, this.theme, inserts);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const pfMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.18 });
    const pf = new THREE.PlaneGeometry(W, L);
    pf.rotateX(-Math.PI / 2);
    pf.translate(W / 2, 0, L / 2);
    this.add(pf, pfMat, false, true);
    // the wood under the playfield edge, visible through gaps
    const under = new THREE.BoxGeometry(W + 0.08, 0.02, L + 0.08);
    under.translate(W / 2, -0.0101, L / 2);
    this.add(under, M.cabinet, false, true);

    this.buildCabinet(W, L);

    // walls, guides, outer wall
    for (const p of this.table.parts) {
      if (p.type !== 'wall') continue;
      const pts = flattenPath(p.path);
      const h = p.height ?? (p.material === 'metal' ? 0.025 : 0.05);
      const mat = p.material === 'metal' ? M.steel : p.material === 'rubber' ? M.rubber : p.material === 'plastic' ? M.plastic(this.theme.plastic) : M.wall;
      this.add(wallGeometry(pts, p.thickness, h), mat);
    }

    // posts
    for (const p of this.table.parts) {
      if (p.type !== 'post') continue;
      this.addPost(p.pos[0], p.pos[1], p.radius, p.material === 'metal');
    }

    // slingshots: rubber band + posts + a lit plastic cover
    for (const p of this.table.parts) {
      if (p.type !== 'slingshot') continue;
      const r = 0.004;
      const band = this.add(
        mergeInto([barGeometry(p.a, p.b, r, BALL_Y), barGeometry(p.b, p.c, r, BALL_Y), barGeometry(p.c, p.a, r, BALL_Y)]),
        M.rubber,
      );
      for (const v of [p.a, p.b, p.c]) this.addPost(v[0], v[1], 0, false, true);
      const plastic = M.plastic(this.theme.plastic).clone();
      const cover = this.add(extrudeOutline([p.a, p.b, p.c], 0.033, 0.036), plastic);
      cover.castShadow = true;
      this.slings.push({ partId: p.id, plastic, band, flash: 0 });
    }

    // pop bumpers
    for (const p of this.table.parts) {
      if (p.type !== 'bumper') continue;
      const [x, y] = p.pos;
      const r = p.radius;
      this.add(post(x, y, r * 1.12, 0.004), M.blackPlastic);
      const skirt = this.add(post(x, y, r, 0.003, 0.009, 32), M.whitePlastic);
      const bodyMat = M.lamp('#fff3d6');
      this.add(post(x, y, r * 0.78, 0.03, 0.006, 32), bodyMat);
      const capMat = M.plastic(this.theme.plastic).clone();
      capMat.clearcoatRoughness = 0.35; // softer highlight, so the key light doesn't flare in the bloom
      const cap = new THREE.CylinderGeometry(r * 0.88, r * 0.95, 0.012, 32);
      cap.translate(x, 0.042, y);
      this.add(cap, capMat);
      this.add(torusAt(x, y, r * 0.9, 0.0015, 0.048), M.chrome);
      // Flash lamp above the bumper. Units are candela: the room's key light puts
      // ~3 lux on the playfield, so a 0.016 cd flash 7 cm up roughly doubles it locally.
      const light = new THREE.PointLight(this.theme.insert, 0, 0.3, 2);
      light.position.set(x, 0.075, y);
      this.group.add(light);
      this.bumpers.push({ partId: p.id, light, cap: capMat, body: bodyMat, skirt, flash: 0 });
    }

    // targets (standups fixed, drop targets animate down into the playfield)
    this.geo.statics.forEach((c) => {
      if (c.behavior !== 'target' && c.behavior !== 'drop') return;
      const len = Math.hypot(c.bx - c.ax, c.by - c.ay);
      const g = new THREE.BoxGeometry(len, 0.03, 0.006);
      g.clearGroups();
      g.translate(0, 0.015, 0);
      const color = c.behavior === 'drop' ? this.theme.accent : this.theme.accent2;
      const mesh = new THREE.Mesh(g, M.target(color));
      mesh.castShadow = true;
      mesh.position.set((c.ax + c.bx) / 2, 0, (c.ay + c.by) / 2);
      mesh.rotation.y = -Math.atan2(c.by - c.ay, c.bx - c.ax);
      // white face decal
      const face = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.7, 0.012), M.whitePlastic);
      face.position.set(0, 0.018, 0.0031);
      mesh.add(face);
      const face2 = face.clone();
      face2.rotation.y = Math.PI;
      face2.position.z = -0.0031;
      mesh.add(face2);
      this.group.add(mesh);
      if (c.behavior === 'drop') this.drops.set(c.index, { mesh, offset: 0 });
    });

    // one-way gates: brackets, a hinge rod, and a wire flap that swings
    this.geo.statics.forEach((c) => {
      if (c.behavior !== 'gate') return;
      const len = Math.hypot(c.bx - c.ax, c.by - c.ay);
      const phi = Math.atan2(c.by - c.ay, c.bx - c.ax);
      for (const [x, y] of [
        [c.ax, c.ay],
        [c.bx, c.by],
      ]) {
        this.add(post(x, y, 0.0022, GATE_HINGE + 0.004), M.steel);
      }
      this.add(barGeometry([c.ax, c.ay], [c.bx, c.by], 0.0011, GATE_HINGE), M.chrome);
      const hinge = new THREE.Group();
      hinge.position.set((c.ax + c.bx) / 2, GATE_HINGE, (c.ay + c.by) / 2);
      hinge.rotation.y = -phi;
      const flap = new THREE.Group();
      const w = len / 2 - 0.004;
      const rod = (x0: number, y0: number, x1: number, y1: number) => {
        const g = new THREE.CylinderGeometry(0.0008, 0.0008, Math.hypot(x1 - x0, y1 - y0), 6);
        g.clearGroups();
        g.rotateZ(Math.atan2(x0 - x1, y1 - y0));
        g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
        return g;
      };
      const wire = new THREE.Mesh(mergeInto([rod(-w, 0, -w, -GATE_FLAP), rod(w, 0, w, -GATE_FLAP), rod(-w, -GATE_FLAP, w, -GATE_FLAP)]), M.chrome);
      wire.castShadow = true;
      flap.add(wire);
      hinge.add(flap);
      this.group.add(hinge);
      // local +z of the hinge is the segment's left normal in table space
      const sign = Math.sign(c.fnx * -Math.sin(phi) + c.fny * Math.cos(phi)) || 1;
      this.gates.push({ flap, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, nx: c.fnx, ny: c.fny, sign, angle: 0 });
    });

    // rollover buttons
    for (const p of this.table.parts) {
      if (p.type !== 'rollover') continue;
      this.add(post(p.pos[0], p.pos[1], 0.004, 0.003, 0, 16), M.chrome);
    }

    // light inserts, set flush into the playfield
    for (const ins of inserts) {
      const shape = new THREE.Shape();
      const path = new Path2DRecorder(shape);
      path.trace(ins);
      const g = new THREE.ShapeGeometry(shape, 16);
      g.rotateX(Math.PI / 2); // shape y → table z
      g.rotateY(-ins.angle);
      g.translate(ins.x, 0.0006, ins.y);
      // ShapeGeometry faces point -y after this rotation; flip them up
      flipFaces(g);
      const mat = M.lamp(ins.bind.kind === 'shootAgain' ? '#ff5050' : this.theme.insert);
      mat.side = THREE.DoubleSide;
      this.add(g, mat, false, false);
      this.lamps.push({ insert: ins, mat, level: 0 });
    }

    // flippers
    for (const f of this.geo.flippers) {
      const grp = new THREE.Group();
      grp.position.set(f.px, 0, f.py);
      const outline = taperedOutline(f.length, f.rb, f.rt);
      const inner = taperedOutline(f.length, f.rb - 0.0018, f.rt - 0.0018);
      const bat = new THREE.Mesh(extrudeOutline(inner, 0.001, 0.024, 0.001), M.whitePlastic);
      const rubber = new THREE.Mesh(extrudeOutline(outline, 0.008, 0.019), M.flipperRubber);
      const cap = new THREE.Mesh(post(0, 0, f.rb * 0.45, 0.004, 0.024), M.chrome);
      for (const m of [bat, rubber, cap]) {
        m.geometry.clearGroups();
        m.castShadow = true;
        m.receiveShadow = true;
        grp.add(m);
      }
      this.group.add(grp);
      this.flippers.push({ group: grp, rest: f.rest });
    }

    // plunger
    for (const p of this.geo.plungers) {
      const grp = new THREE.Group();
      const tipG = new THREE.CylinderGeometry(p.halfW * 0.55, p.halfW * 0.55, 0.012, 20);
      tipG.rotateX(Math.PI / 2);
      tipG.translate(0, BALL_Y, 0.006);
      const tipMesh = new THREE.Mesh(tipG, M.blackPlastic);
      const rodG = new THREE.CylinderGeometry(0.003, 0.003, 0.12, 12);
      rodG.rotateX(Math.PI / 2);
      rodG.translate(0, BALL_Y, 0.072);
      const rod = new THREE.Mesh(rodG, M.chrome);
      const springG = new THREE.TorusGeometry(0.006, 0.0012, 6, 20);
      const springs = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(springG, M.steel);
        s.position.set(0, BALL_Y, 0.02 + i * 0.006);
        springs.add(s);
      }
      tipG.clearGroups();
      rodG.clearGroups();
      grp.add(tipMesh, rod, springs);
      grp.position.set(p.x, 0, p.restY);
      this.group.add(grp);
      this.plungers.push({ group: grp, restY: p.restY });
    }

    // apron over the drain
    const drain = this.table.parts.find((p) => p.type === 'drain');
    if (drain && drain.type === 'drain') {
      const hx = drain.halfSize?.[0] ?? 0.2;
      const top = drain.pos[1] - (drain.halfSize?.[1] ?? 0.02) - 0.01;
      const apronPts: [number, number][] = [
        [drain.pos[0] - hx, top + 0.01],
        [drain.pos[0] - 0.06, top + 0.03],
        [drain.pos[0] + 0.06, top + 0.03],
        [drain.pos[0] + hx, top + 0.01],
        [drain.pos[0] + hx, L],
        [drain.pos[0] - hx, L],
      ];
      this.add(extrudeOutline(apronPts, 0, 0.02, 0.002), this.apronMaterial(drain.pos[0] - hx, top, 2 * hx, L - top));
    }
  }

  private apronMaterial(x0: number, y0: number, w: number, h: number): THREE.Material {
    // a printed apron card: table name and instructions
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = this.theme.name === 'classic' ? '#f3ead6' : '#101624';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = this.theme.accent;
    g.fillRect(0, 0, 1024, 10);
    g.fillStyle = this.theme.ink;
    g.textAlign = 'center';
    g.font = '700 54px "Helvetica Neue", Arial, sans-serif';
    g.fillText(this.table.meta.name.toUpperCase(), 512, 150);
    g.font = '500 26px "Helvetica Neue", Arial, sans-serif';
    g.globalAlpha = 0.7;
    g.fillText('PINBALL CONSTRUCTION MACHINE', 512, 196);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // extruded shapes get UVs in meters: map the card onto the apron's bounds
    t.repeat.set(1 / w, -1 / h);
    t.offset.set(-x0 / w, 1 + y0 / h);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  }

  private addPost(x: number, y: number, r: number, metal: boolean, sling = false): void {
    const M = this.mats;
    this.add(post(x, y, 0.0032, sling ? 0.036 : 0.03), M.steel);
    if (!metal && !sling) this.add(torusAt(x, y, Math.max(0.003, r - 0.003), 0.003, BALL_Y), M.rubber);
    if (!sling) this.add(post(x, y, 0.0045, 0.004, sling ? 0.036 : 0.03, 16), M.chrome);
  }

  private buildCabinet(W: number, L: number): void {
    const M = this.mats;
    // side panels rising above the playfield, with chrome side rails on top
    const sideH = 0.085;
    for (const x of [-0.03, W + 0.03]) {
      const side = new THREE.BoxGeometry(0.036, sideH + 0.2, L + 0.12);
      side.translate(x, sideH - (sideH + 0.2) / 2, L / 2 + 0.03);
      this.add(side, M.cabinet);
      const rail = new THREE.BoxGeometry(0.03, 0.006, L + 0.1);
      rail.translate(x, sideH + 0.003, L / 2 + 0.03);
      this.add(rail, M.chrome, false, true);
    }
    // lockdown bar at the front
    const bar = new THREE.BoxGeometry(W + 0.096, 0.03, 0.05);
    bar.translate(W / 2, sideH - 0.012, L + 0.065);
    this.add(bar, M.chrome);
    const front = new THREE.BoxGeometry(W + 0.096, 0.25, 0.03);
    front.translate(W / 2, sideH - 0.15, L + 0.05);
    this.add(front, M.cabinet);
    // back panel behind the arch
    const back = new THREE.BoxGeometry(W + 0.096, sideH + 0.2, 0.03);
    back.translate(W / 2, sideH - (sideH + 0.2) / 2, -0.045);
    this.add(back, M.cabinet);
    // backbox (upright, compensating for the playfield tilt)
    const box = new THREE.Group();
    const bbG = new THREE.BoxGeometry(W + 0.096, 0.62, 0.16);
    bbG.clearGroups();
    const bb = new THREE.Mesh(bbG, M.cabinet);
    bb.position.set(0, 0.31, -0.08);
    box.add(bb);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.01, 0.46), this.backglassMaterial());
    glass.position.set(0, 0.33, 0.0015);
    box.add(glass);
    box.position.set(W / 2, sideH, -0.06);
    box.rotation.x = -this.table.dimensions.slope * DEG;
    this.group.add(box);
  }

  private backglassMaterial(): THREE.Material {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 460;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 460);
    grd.addColorStop(0, this.theme.baseTop);
    grd.addColorStop(1, '#000000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 460);
    g.strokeStyle = this.theme.accent;
    g.lineWidth = 6;
    g.strokeRect(14, 14, 484, 432);
    g.fillStyle = this.theme.accent;
    g.textAlign = 'center';
    g.font = '800 44px "Helvetica Neue", Arial, sans-serif';
    const words = this.table.meta.name.toUpperCase().split(' ');
    words.forEach((w, i) => g.fillText(w, 256, 150 + i * 50));
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.6;
    g.font = '600 18px "Helvetica Neue", Arial, sans-serif';
    g.fillText('PINBALL CONSTRUCTION MACHINE', 256, 410);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.2 });
  }

  // ------------------------------------------------------------------ events

  flash(partId: string): void {
    const id = partId.split(':')[0];
    const b = this.bumpers.find((x) => x.partId === id);
    if (b) b.flash = 1;
    const s = this.slings.find((x) => x.partId === id);
    if (s) s.flash = 1;
    this.targetFlash.set(id, 1);
  }

  // ------------------------------------------------------------------ update

  update(snap: Snapshot | null, dt: number): void {
    this.time += dt;
    const st = snap?.state;

    // flippers
    this.flippers.forEach((f, i) => {
      const a = snap?.flippers[i] ?? f.rest;
      f.group.rotation.y = -a;
    });

    // plunger
    this.plungers.forEach((p, i) => {
      p.group.position.z = snap?.plungers[i] ?? p.restY;
    });

    // balls
    const balls = snap?.balls ?? [];
    while (this.balls.length < balls.length) {
      const mesh = new THREE.Mesh(this.ballGeo, this.mats.ball);
      mesh.castShadow = true;
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 3.2, R * 3.2), this.shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      this.group.add(mesh, shadow);
      this.balls.push({ mesh, shadow });
    }
    this.balls.forEach((b, i) => {
      const s = balls[i];
      b.mesh.visible = b.shadow.visible = !!s;
      if (!s) return;
      b.mesh.position.set(s.x, BALL_Y, s.y);
      b.shadow.position.set(s.x + 0.002, 0.0012, s.y - 0.004);
    });

    // gate flaps ride over any ball passing under them, then fall shut
    for (const g of this.gates) {
      // the flap falls shut by itself, but never into a ball
      let a = Math.max(0, g.angle - dt * 9);
      for (const b of balls) a = gateLift(g, b.x, b.y, a);
      g.angle = a;
      g.flap.rotation.x = -g.sign * g.angle;
    }

    // drop targets sink into the playfield
    const disabled = new Set(snap?.disabled ?? []);
    for (const [idx, d] of this.drops) {
      const goal = disabled.has(idx) ? -0.034 : 0;
      d.offset += (goal - d.offset) * Math.min(1, dt * (goal < d.offset ? 40 : 12));
      d.mesh.position.y = d.offset;
    }

    // bumpers and slings
    const gi = this.gi;
    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - dt * 7);
      b.light.intensity = (0.002 + b.flash * 0.016) * gi;
      b.cap.emissiveIntensity = (0.35 + b.flash * 2.5) * gi;
      b.body.emissiveIntensity = (0.12 + b.flash * 2.2) * gi;
      b.skirt.position.y = -b.flash * 0.003;
    }
    for (const s of this.slings) {
      s.flash = Math.max(0, s.flash - dt * 8);
      s.plastic.emissiveIntensity = (0.25 + s.flash * 3) * gi;
      s.band.position.y = -s.flash * 0.0015;
    }
    for (const [k, v] of this.targetFlash) {
      const nv = v - dt * 3;
      if (nv <= 0) this.targetFlash.delete(k);
      else this.targetFlash.set(k, nv);
    }

    // inserts: attract-mode chase when no game is running, rules-driven otherwise
    const lit = new Set(st?.lit ?? []);
    const attract = !st?.started || st.gameOver;
    this.lamps.forEach((l, i) => {
      let on = 0;
      if (attract) {
        on = Math.sin(this.time * 4 - i * 0.7) > 0.55 ? 1 : 0;
      } else {
        const b = l.insert.bind;
        if (b.kind === 'rollover') on = lit.has(b.partId) ? 1 : 0;
        else if (b.kind === 'multiplier') on = (st?.multiplier ?? 1) >= b.value ? 1 : 0;
        else if (b.kind === 'shootAgain') on = st?.ballSaveActive ? (Math.sin(this.time * 12) > 0 ? 1 : 0.2) : 0;
        else if (b.kind === 'target') on = this.targetFlash.get(b.partId) ?? 0;
      }
      // incandescent feel: fast on, slower off
      const rate = on > l.level ? 25 : 8;
      l.level += (on - l.level) * Math.min(1, dt * rate);
      l.mat.emissiveIntensity = (0.08 + l.level * 3.2) * Math.max(0.3, gi);
    });
  }

  /** World-space ball positions, for the camera. */
  ballPositions(): THREE.Vector3[] {
    return this.balls.filter((b) => b.mesh.visible).map((b) => b.mesh.getWorldPosition(new THREE.Vector3()));
  }
}

/** Trace an insert outline into a THREE.Shape using the same path as the painted bezel. */
class Path2DRecorder {
  constructor(private shape: THREE.Shape) {}
  trace(ins: Insert): void {
    const s = ins.size;
    const sh = this.shape;
    if (ins.shape === 'circle') sh.absarc(0, 0, s, 0, Math.PI * 2, false);
    else if (ins.shape === 'oval') sh.absellipse(0, 0, s * 2.2, s, 0, Math.PI * 2, false, 0);
    else {
      sh.moveTo(s * 1.4, 0);
      sh.lineTo(-s * 0.6, -s * 0.9);
      sh.lineTo(-s * 0.2, 0);
      sh.lineTo(-s * 0.6, s * 0.9);
      sh.closePath();
    }
  }
}

/**
 * The flap angle (radians toward the pass direction) for a gate whose flap
 * would otherwise fall to `from`: raised just enough not to cut into the ball
 * at (x, y). Starting from where the flap already is keeps it continuous: it
 * swings up over a ball, rides on top, then slides down the ball's back.
 * Works in the vertical plane across the wire: hinge at height GATE_HINGE,
 * ball center at height R.
 */
export function gateLift(g: Gate, x: number, y: number, from = 0): number {
  const lx = g.bx - g.ax;
  const ly = g.by - g.ay;
  const u = ((x - g.ax) * lx + (y - g.ay) * ly) / (lx * lx + ly * ly);
  if (u < -0.05 || u > 1.05) return from;
  const s = (x - g.ax) * g.nx + (y - g.ay) * g.ny; // ball's distance past the wire line
  if (s < -R - 0.002 || s > R + GATE_FLAP) return from;
  // does the flap at angle th stay clear of the ball?
  const clear = (th: number) => {
    const dx = Math.sin(th) * GATE_FLAP;
    const dy = -Math.cos(th) * GATE_FLAP;
    // closest point on the flap (hinge (0, GATE_HINGE) → tip) to the ball center (s, R)
    let t = (s * dx + (R - GATE_HINGE) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(s - dx * t, R - GATE_HINGE - dy * t) >= R + 0.0009;
  };
  if (clear(from)) return from;
  let lo = from;
  let hi = 1.5; // nearly level: always above the ball
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function flipFaces(g: THREE.BufferGeometry): void {
  const idx = g.index;
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setY(i, Math.abs(n.getY(i)));
  n.needsUpdate = true;
}

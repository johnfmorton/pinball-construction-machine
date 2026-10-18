/**
 * Geometry builders for each part type. Everything is built in TABLE space:
 * x = table x, y = height above the playfield, z = table y (toward the player).
 * Shapes follow the physics colliders exactly (a wall is a chain of capsules,
 * so it's drawn as boxes with rounded joints), so what you see is what the
 * ball hits.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../core/math/bezier.ts';

/** Prism along a polyline: boxes per segment + cylinders at every joint (a capsule chain). */
export function wallGeometry(pts: Vec2[], thickness: number, height: number, base = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = thickness / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const box = new THREE.BoxGeometry(len, height, thickness);
    box.rotateY(-Math.atan2(by - ay, bx - ax));
    box.translate((ax + bx) / 2, base + height / 2, (ay + by) / 2);
    parts.push(box);
  }
  for (const [x, y] of pts) {
    const cyl = new THREE.CylinderGeometry(r, r, height, 14, 1);
    cyl.translate(x, base + height / 2, y);
    parts.push(cyl);
  }
  return mergeInto(parts);
}

/** A round bar (rubber band edge, rail) between two table points at a given height. */
export function barGeometry(a: Vec2, b: Vec2, radius: number, y: number): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
  g.rotateZ(Math.PI / 2); // along +x
  g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  return g;
}

/** Points around the convex hull of two circles (a flipper outline), in local 2D (x along the bat). */
export function taperedOutline(L: number, rb: number, rt: number, segs = 20): Vec2[] {
  const sinT = (rb - rt) / L;
  const t = Math.asin(Math.max(-1, Math.min(1, sinT)));
  const pts: Vec2[] = [];
  // tip arc: from the lower tangent, around the front, to the upper tangent
  const a0 = -(Math.PI / 2 - t);
  const a1 = Math.PI / 2 - t;
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    pts.push([L + Math.cos(a) * rt, Math.sin(a) * rt]);
  }
  // base arc: from the upper tangent around the back to the lower tangent
  const b0 = Math.PI / 2 - t;
  const b1 = 2 * Math.PI - (Math.PI / 2 - t);
  for (let i = 0; i <= segs * 2; i++) {
    const a = b0 + ((b1 - b0) * i) / (segs * 2);
    pts.push([Math.cos(a) * rb, Math.sin(a) * rb]);
  }
  return pts;
}

/** Extrude a 2D outline (table-space x/y) upward between two heights. */
export function extrudeOutline(pts: Vec2[], y0: number, y1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: y1 - y0 - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  // shape lies in XY and extrudes along +Z; map shape y → table z, extrusion → up
  g.rotateX(Math.PI / 2); // (x, y, d) → (x, -d, y)
  g.translate(0, y1 - bevel, 0);
  g.computeVertexNormals();
  return g;
}

/** Cylinder standing on the playfield. */
export function post(x: number, y: number, r: number, h: number, base = 0, segs = 24): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  g.translate(x, base + h / 2, y);
  return g;
}

export function torusAt(x: number, y: number, major: number, tube: number, h: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, tube, 10, 32);
  g.rotateX(Math.PI / 2);
  g.translate(x, h, y);
  return g;
}

export function mergeInto(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    // keep only the attributes every primitive has
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  const merged = mergeGeometries(norm, false);
  if (!merged) throw new Error('mergeGeometries failed');
  return merged;
}

/** Soft round shadow texture for contact shadows. */
export function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(0,0,0,0.85)');
  rg.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

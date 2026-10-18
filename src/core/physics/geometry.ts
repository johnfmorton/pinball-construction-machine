/**
 * Low-level collision geometry. Everything is plain arithmetic + Math.sqrt so
 * results are bit-identical across JavaScript engines.
 */

export interface Hit {
  /** Fraction of the ray [0, 1] at first contact. */
  t: number;
  nx: number;
  ny: number;
}

/** Closest point on segment AB to P, returned as parameter s in [0,1]. */
export function closestParam(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-18) return 0;
  let s = ((px - ax) * abx + (py - ay) * aby) / l2;
  if (s < 0) s = 0;
  else if (s > 1) s = 1;
  return s;
}

/**
 * Distance from P to segment AB (radius not subtracted), plus the unit normal
 * pointing from the segment toward P. Writes into `out` to avoid allocation.
 */
export function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
  out: { d: number; nx: number; ny: number },
): void {
  const s = closestParam(ax, ay, bx, by, px, py);
  const cx = ax + (bx - ax) * s;
  const cy = ay + (by - ay) * s;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  out.d = d;
  if (d > 1e-12) {
    out.nx = dx / d;
    out.ny = dy / d;
  } else {
    // P exactly on the segment: use the segment's perpendicular
    const abx = bx - ax;
    const aby = by - ay;
    const l = Math.sqrt(abx * abx + aby * aby);
    if (l > 1e-12) {
      out.nx = -aby / l;
      out.ny = abx / l;
    } else {
      out.nx = 0;
      out.ny = -1;
    }
  }
}

/** Ray P + D·t (t in [0,1]) against a circle. Returns t or -1. Ignores starts inside. */
export function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, rad: number): number {
  const mx = px - cx;
  const my = py - cy;
  const c = mx * mx + my * my - rad * rad;
  if (c <= 0) return -1; // starting inside: handled by the discrete pass
  const b = mx * dx + my * dy;
  if (b >= 0) return -1; // moving away
  const a = dx * dx + dy * dy;
  if (a < 1e-24) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Swept circle (radius already folded into `rad`) against a capsule AB.
 * Returns the earliest t in [0,1] or -1. Normal is written to `out`.
 */
export function rayCapsule(
  px: number,
  py: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rad: number,
  out: Hit,
): number {
  let best = -1;
  const abx = bx - ax;
  const aby = by - ay;
  const L2 = abx * abx + aby * aby;
  if (L2 > 1e-18) {
    const L = Math.sqrt(L2);
    const c0 = abx * (py - ay) - aby * (px - ax); // cross(ab, p - a)
    const c1 = abx * dy - aby * dx; // cross(ab, d)
    const band = rad * L;
    if ((c0 > band && c1 < 0) || (c0 < -band && c1 > 0)) {
      const target = c0 > 0 ? band : -band;
      const t = (target - c0) / c1;
      if (t >= 0 && t <= 1) {
        const hx = px + dx * t;
        const hy = py + dy * t;
        const s = ((hx - ax) * abx + (hy - ay) * aby) / L2;
        if (s >= 0 && s <= 1) {
          best = t;
          const sg = c0 > 0 ? 1 : -1;
          out.nx = (-aby / L) * sg;
          out.ny = (abx / L) * sg;
        }
      }
    }
  }
  // end caps
  const ta = rayCircle(px, py, dx, dy, ax, ay, rad);
  if (ta >= 0 && (best < 0 || ta < best)) {
    best = ta;
    const hx = px + dx * ta - ax;
    const hy = py + dy * ta - ay;
    const l = Math.sqrt(hx * hx + hy * hy);
    out.nx = hx / l;
    out.ny = hy / l;
  }
  if (L2 > 1e-18) {
    const tb = rayCircle(px, py, dx, dy, bx, by, rad);
    if (tb >= 0 && (best < 0 || tb < best)) {
      best = tb;
      const hx = px + dx * tb - bx;
      const hy = py + dy * tb - by;
      const l = Math.sqrt(hx * hx + hy * hy);
      out.nx = hx / l;
      out.ny = hy / l;
    }
  }
  out.t = best;
  return best;
}

/**
 * Signed distance from P to a tapered capsule (convex hull of two circles):
 * base circle at pivot (rb), tip circle at pivot + u·L (rt). `u` is the unit
 * direction. `sinT`/`cosT` describe the tilt of the straight sides:
 * sinT = (rb - rt) / L (positive when the tip is narrower than the base).
 * Writes distance and outward normal into `out`.
 */
export function taperedCapsuleDistance(
  pivX: number,
  pivY: number,
  ux: number,
  uy: number,
  L: number,
  rb: number,
  rt: number,
  sinT: number,
  cosT: number,
  px: number,
  py: number,
  out: { d: number; nx: number; ny: number },
): void {
  const qx = px - pivX;
  const qy = py - pivY;
  const lx = qx * ux + qy * uy;
  const crossv = ux * qy - uy * qx; // signed perpendicular coordinate
  const sg = crossv >= 0 ? 1 : -1;
  const ly = crossv * sg;
  // perpendicular unit vector (rotate u by +90° in this y-down frame)
  const perpX = -uy * sg;
  const perpY = ux * sg;
  const s = lx * cosT - ly * sinT;
  if (s < 0) {
    const l = Math.sqrt(lx * lx + ly * ly);
    out.d = l - rb;
    if (l > 1e-12) {
      const nlx = lx / l;
      const nly = ly / l;
      out.nx = nlx * ux + nly * perpX;
      out.ny = nlx * uy + nly * perpY;
    } else {
      out.nx = perpX;
      out.ny = perpY;
    }
  } else if (s > L * cosT) {
    const tx = lx - L;
    const l = Math.sqrt(tx * tx + ly * ly);
    out.d = l - rt;
    if (l > 1e-12) {
      const nlx = tx / l;
      const nly = ly / l;
      out.nx = nlx * ux + nly * perpX;
      out.ny = nlx * uy + nly * perpY;
    } else {
      out.nx = ux;
      out.ny = uy;
    }
  } else {
    out.d = lx * sinT + ly * cosT - rb;
    out.nx = sinT * ux + cosT * perpX;
    out.ny = sinT * uy + cosT * perpY;
  }
}

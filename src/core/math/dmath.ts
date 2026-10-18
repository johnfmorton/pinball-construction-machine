/**
 * Deterministic math.
 *
 * JavaScript guarantees IEEE-754 results for + - * / and Math.sqrt, but NOT for
 * Math.sin, Math.cos, Math.atan2, Math.exp, Math.pow, Math.hypot, etc. Those can
 * differ between V8, SpiderMonkey and JavaScriptCore in the last bits, which is
 * enough to make a replay diverge after a few thousand steps.
 *
 * Everything the physics engine calls during a step must therefore come from
 * here (or be plain arithmetic), so a replay recorded in Safari re-simulates to
 * the exact same score in Node on the server.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG = PI / 180;

/** Sine via range reduction + Taylor series to x^17 (error < 1e-11 on [-π/2, π/2]). */
export function dsin(x: number): number {
  // reduce to [-π, π]
  let r = x - TAU * Math.round(x / TAU);
  // reduce to [-π/2, π/2] using sin(π - r) = sin(r)
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  // Horner form of r - r^3/3! + r^5/5! - ... + r^17/17!
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 *
                (-1 / 5040 +
                  r2 *
                    (1 / 362880 +
                      r2 *
                        (-1 / 39916800 +
                          r2 *
                            (1 / 6227020800 +
                              r2 * (-1 / 1307674368000 + r2 * (1 / 355687428096000)))))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Deterministic length of a 2D vector (Math.hypot is not guaranteed bit-exact). */
export function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

// Film timeline in SECONDS. Frames are derived from fps at runtime (never hardcoded).
// Mirrors docs/STORYBOARD.md.

export const FILM_SECONDS = 90;

export const SCENES = {
  space: {start: 0, end: 10},
  earth: {start: 10, end: 22},
  kazakhstan: {start: 22, end: 35},
  astana: {start: 35, end: 45},
  hub: {start: 45, end: 75},
  finale: {start: 75, end: 90},
} as const;

// Key beats (seconds).
export const BEATS = {
  starsIn: 1.5,
  limbGlow: 6,
  sunrise: 14,
  borderDraw: 27,
  borderDrawEnd: 30.6,
  astanaPulse: 31,
  cloudDive: 35,
  networkStart: 38.2,
  logo: 82.4,
  slogan: 83.8,
  fadeOut: 88,
} as const;

// Text windows (seconds). Every line is on screen for >= 2 s.
export const TEXT = {
  astanaLabel: {in: 31.6, out: 35.0},
  t1: {in: 39.5, out: 44.6},
  t2: {in: 45.0, out: 51.0},
  t3: {in: 51.0, out: 57.0},
  t4: {in: 57.0, out: 63.0},
  t5: {in: 63.0, out: 69.0},
  t6: {in: 69.0, out: 75.0},
  mission: {in: 78.0, out: 82.4},
} as const;

// ---------------------------------------------------------------- easing helpers
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Linear progress of t through [a, b], clamped. */
export const progress = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Quintic smootherstep: C2 continuous (zero velocity AND acceleration at ends). */
export const smoother = (x: number) => {
  const c = clamp01(x);
  return c * c * c * (c * (c * 6 - 15) + 10);
};

export const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Cubic Bezier easing with control points (x1,y1,x2,y2), like CSS / Remotion Easing.bezier. */
export const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dsx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (x: number) => {
    const c = clamp01(x);
    let u = c;
    for (let i = 0; i < 8; i++) {
      const d = dsx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= (sx(u) - c) / d;
      u = clamp01(u);
    }
    return sy(u);
  };
};

// The film's two eases (see docs/DECISIONS.md, motion language).
export const easeCinema = bezier(0.65, 0, 0.35, 1); // long symmetric in-out
export const easeOutSoft = bezier(0.16, 1, 0.3, 1); // reveals: fast start, very long settle

/** 0 -> 1 -> 0 envelope: fades in over [a, a+fin], out over [b-fout, b]. */
export const envelope = (t: number, a: number, b: number, fin = 0.6, fout = 0.6) =>
  smoother(progress(t, a, a + fin)) * (1 - smoother(progress(t, b - fout, b)));

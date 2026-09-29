// Clamped cubic spline through (t_i, y_i): C2 continuous (position, velocity and
// acceleration are continuous), with prescribed end velocities (0 by default so the
// camera starts and ends at rest). Used for every camera channel.

export class CubicSpline {
  private readonly t: number[];
  private readonly y: number[];
  private readonly m: number[]; // second derivatives at the knots

  constructor(t: number[], y: number[], startSlope = 0, endSlope = 0) {
    if (t.length !== y.length || t.length < 2) throw new Error('CubicSpline: bad input');
    for (let i = 1; i < t.length; i++) {
      if (!(t[i] > t[i - 1])) throw new Error('CubicSpline: knots must increase');
    }
    this.t = t;
    this.y = y;
    const n = t.length;
    const h = t.slice(1).map((v, i) => v - t[i]);
    // Tridiagonal system A m = r (clamped boundary conditions).
    const a = new Array(n).fill(0);
    const b = new Array(n).fill(0);
    const c = new Array(n).fill(0);
    const r = new Array(n).fill(0);
    b[0] = 2 * h[0];
    c[0] = h[0];
    r[0] = 6 * ((y[1] - y[0]) / h[0] - startSlope);
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1];
      b[i] = 2 * (h[i - 1] + h[i]);
      c[i] = h[i];
      r[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
    }
    a[n - 1] = h[n - 2];
    b[n - 1] = 2 * h[n - 2];
    r[n - 1] = 6 * (endSlope - (y[n - 1] - y[n - 2]) / h[n - 2]);
    // Thomas algorithm.
    for (let i = 1; i < n; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      r[i] -= w * r[i - 1];
    }
    const m = new Array(n).fill(0);
    m[n - 1] = r[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) m[i] = (r[i] - c[i] * m[i + 1]) / b[i];
    this.m = m;
  }

  private segment(x: number): number {
    const {t} = this;
    if (x <= t[0]) return 0;
    if (x >= t[t.length - 1]) return t.length - 2;
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Value at x (clamped to the knot range: constant outside). */
  at(x: number): number {
    const {t, y, m} = this;
    if (x <= t[0]) return y[0];
    if (x >= t[t.length - 1]) return y[y.length - 1];
    const i = this.segment(x);
    const h = t[i + 1] - t[i];
    const A = (t[i + 1] - x) / h;
    const B = (x - t[i]) / h;
    return A * y[i] + B * y[i + 1] + ((A * A * A - A) * m[i] + (B * B * B - B) * m[i + 1]) * (h * h) / 6;
  }

  /** First derivative at x. */
  slope(x: number): number {
    const {t, y, m} = this;
    if (x <= t[0] || x >= t[t.length - 1]) return 0;
    const i = this.segment(x);
    const h = t[i + 1] - t[i];
    const A = (t[i + 1] - x) / h;
    const B = (x - t[i]) / h;
    return (y[i + 1] - y[i]) / h + ((1 - 3 * A * A) * m[i] + (3 * B * B - 1) * m[i + 1]) * h / 6;
  }
}

/** Vector-valued spline over shared knots. */
export class VectorSpline {
  private readonly channels: CubicSpline[];

  constructor(t: number[], values: number[][]) {
    const dim = values[0].length;
    this.channels = Array.from({length: dim}, (_, d) => new CubicSpline(t, values.map((v) => v[d])));
  }

  at(x: number): number[] {
    return this.channels.map((c) => c.at(x));
  }

  slope(x: number): number[] {
    return this.channels.map((c) => c.slope(x));
  }
}

// Brand constants. The ONLY place where brand colours are defined.
// Source: docs/BRAND.md (values extracted from the vector objects of
// materials/brandbook/ah_brandbook_2024.pdf, pages 1, 23-25, 29, 39, 43, 55).

export const COLORS = {
  black: '#000000',
  light: '#f2f2f2',
  white: '#ffffff',
  richBlack: '#1d1d1b', // start/end of the brand line gradient
  grey: {
    g10: '#1a1a1a',
    g30: '#4d4d4d',
    g50: '#808080',
    g70: '#b3b3b3',
    g80: '#cccccc',
    g90: '#e6e6e6',
  },
} as const;

export type GradientPair = {light: string; dark: string};

// The six brand gradient pairs (brandbook p. 23). Only these may form gradients.
export const PAIRS = {
  blue: {light: '#9da6e1', dark: '#1833da'},
  purple: {light: '#cd66f3', dark: '#3e215b'},
  violet: {light: '#877fe2', dark: '#4b3a8a'},
  mint: {light: '#83f7c8', dark: '#2e94a0'},
  sunset: {light: '#fcb75a', dark: '#cf4555'},
  sky: {light: '#5cb4e2', dark: '#1c4280'},
} as const satisfies Record<string, GradientPair>;

export type PairName = keyof typeof PAIRS;

// Radial glow geometry (PDF shading Sh0): stops 0 -> light, 0.63798 -> dark, 1 -> black.
export const GLOW_STOPS = {mid: 0.63798};
// Radius of the corner glow relative to frame width (1321 px of 1920).
export const GLOW_RADIUS_W = 1321 / 1920;
// Brand line: gradient #1d1d1b (0) -> dark (0.36202) -> light (1). Width 1.956 px @ 1920.
export const LINE_STOPS = {mid: 0.36202};
export const LINE_WIDTH_1080P = 1.956;

export const FONT_FAMILY = 'Inter';
export const WEIGHTS = {regular: 400, medium: 500, semibold: 600} as const;

// ---------------------------------------------------------------- colour maths
export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export const hexToLinear = (hex: string): [number, number, number] =>
  hexToRgb(hex).map(srgbToLinear) as [number, number, number];

// Inverse of the ACES fit used in FilmPipeline (Stephen Hill: M_out * RRT(M_in * c)).
// Emissive elements that must land on an exact brand HEX after tonemapping are
// fed through this. Out-of-gamut solutions are clamped to >= 0.
const M_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const M_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

const invert3 = (m: number[][]): number[][] => {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
};
const M_IN_INV = invert3(M_IN);
const M_OUT_INV = invert3(M_OUT);
const mul = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

// RRT+ODT fit: y = (x(x+a) - b) / (x(c x + d) + e); solve for x (monotonic branch).
const rrtInverse = (y: number): number => {
  const a = 0.0245786;
  const b = 0.000090537;
  const c = 0.983729;
  const d = 0.432951;
  const e = 0.238081;
  // (1 - y c) x^2 + (a - y d) x - (b + y e) = 0
  const A = 1 - y * c;
  const B = a - y * d;
  const C = -(b + y * e);
  if (Math.abs(A) < 1e-9) return -C / B;
  const disc = Math.max(0, B * B - 4 * A * C);
  return (-B + Math.sqrt(disc)) / (2 * A);
};

/** Linear HDR value that the pipeline maps to `hex` at exposure 1. */
export const emissiveForHex = (hex: string, exposure = 1): [number, number, number] => {
  const target = hexToLinear(hex).map((v) => Math.min(v, 0.985));
  const pre = mul(M_OUT_INV, target).map((v) => rrtInverse(Math.max(0, v)));
  return mul(M_IN_INV, pre).map((v) => Math.max(0, v) / exposure) as [number, number, number];
};

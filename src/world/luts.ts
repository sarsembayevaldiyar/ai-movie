import * as THREE from 'three';
import {mulberry32} from '../math/random';

// Precomputed resources that replace per-pixel maths on software GL.

export const ATMO = {
  radius: 1.032,
  HR: 0.0045,
  HM: 0.0012,
  betaR: [3.2, 9.0, 32.0] as [number, number, number],
  betaM: 6.0,
};

/**
 * Sun transmittance LUT T(r, mu): fraction of sunlight reaching radius r when the
 * sun is at cos-zenith mu. u = altitude fraction in the shell, v = (mu + 1) / 2.
 * Integrated numerically (no Chapman approximation); zero inside the planet shadow,
 * softened by a narrow penumbra so the terminator glow has no hard edge.
 */
export const createTransmittanceLut = (W = 64, H = 256): THREE.DataTexture => {
  const data = new Float32Array(W * H * 4);
  const steps = 96;
  for (let j = 0; j < H; j++) {
    const mu = (j / (H - 1)) * 2 - 1;
    for (let i = 0; i < W; i++) {
      const r = 1 + (i / (W - 1)) * (ATMO.radius - 1);
      // Ray from (0, r) towards (sqrt(1-mu^2), mu); intersect the outer shell.
      const sinz = Math.sqrt(Math.max(0, 1 - mu * mu));
      const b = r * mu;
      const c = r * r - ATMO.radius * ATMO.radius;
      const tMax = -b + Math.sqrt(Math.max(0, b * b - c));
      // Closest approach to the planet centre along the ray (for the shadow).
      const tClosest = -b;
      const dClosest = tClosest > 0 ? r * sinz : r;
      let odR = 0;
      let odM = 0;
      const ds = tMax / steps;
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) * ds;
        const px = sinz * t;
        const py = r + mu * t;
        const h = Math.sqrt(px * px + py * py) - 1;
        odR += Math.exp(-Math.max(h, 0) / ATMO.HR) * ds;
        odM += Math.exp(-Math.max(h, 0) / ATMO.HM) * ds;
      }
      const shadow = THREE.MathUtils.smoothstep(dClosest, 0.9985, 1.0025);
      const k = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        data[k + ch] = Math.exp(-(ATMO.betaR[ch] * odR + ATMO.betaM * 1.1 * odM)) * shadow;
      }
      data[k + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
};

/**
 * Tileable value-noise texture (4 independent octave-ready channels) so shaders
 * can sample noise with one texture fetch instead of 8 integer hashes.
 */
export const createNoiseTexture = (size = 256, seed = 4242): THREE.DataTexture => {
  const rnd = mulberry32(seed);
  const lattice = (n: number) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  };
  const data = new Uint8Array(size * size * 4);
  const channels = [8, 16, 32, 64].map((cells) => ({cells, g: lattice(cells)}));
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        const {cells, g} = channels[c];
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx) % cells;
        const y0 = Math.floor(fy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = fade(fx - Math.floor(fx));
        const ty = fade(fy - Math.floor(fy));
        const a = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * tx;
        const b = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * tx;
        data[(y * size + x) * 4 + c] = Math.round((a + (b - a) * ty) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
};

// GLSL: fbm from the noise texture (channels = octaves), 2D domain.
export const GLSL_TEX_FBM = /* glsl */ `
uniform sampler2D tNoise;
float texFbm(vec2 p) {
  vec4 n = texture2D(tNoise, p);
  return n.r * 0.5333 + n.g * 0.2667 + n.b * 0.1333 + n.a * 0.0667;
}
`;

import * as THREE from 'three';
import {emissiveForHex, LINE_STOPS, COLORS} from '../brand';

// Screen-space "fat" polylines with analytic anti-aliasing and the brand line
// gradient (#1d1d1b -> dark -> light, stops 0 / 0.362 / 1). Used for the
// Kazakhstan border, the network arcs, the orbits and the growth trajectory.
//
// Each line has a progress head: the part with u <= progress is visible, the
// colour runs from the head (light) back along `tail` (in u units) to rich black,
// then `settle` blends the drawn line to a steady colour.

export interface LineStyle {
  light: string;
  dark: string;
  widthPx: number; // core width at 1080p
  glowPx?: number; // gaussian halo sigma at 1080p
  glowGain?: number;
  intensity?: number;
  tail?: number;
  headBoost?: number;
}

export const buildRibbonGeometry = (points: THREE.Vector3[], closed = false): THREE.BufferGeometry => {
  const pts = closed ? [...points, points[0]] : points;
  const n = pts.length;
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lengths[n - 1] || 1;
  const pos = new Float32Array(n * 2 * 3);
  const prev = new Float32Array(n * 2 * 3);
  const next = new Float32Array(n * 2 * 3);
  const side = new Float32Array(n * 2);
  const u = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const pp = closed && i === 0 ? pts[n - 2] : pts[Math.max(0, i - 1)];
    const pn = closed && i === n - 1 ? pts[1] : pts[Math.min(n - 1, i + 1)];
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos.set([p.x, p.y, p.z], k * 3);
      prev.set([pp.x, pp.y, pp.z], k * 3);
      next.set([pn.x, pn.y, pn.z], k * 3);
      side[k] = s === 0 ? -1 : 1;
      u[k] = lengths[i] / total;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('prev', new THREE.BufferAttribute(prev, 3));
  g.setAttribute('next', new THREE.BufferAttribute(next, 3));
  g.setAttribute('side', new THREE.BufferAttribute(side, 1));
  g.setAttribute('u', new THREE.BufferAttribute(u, 1));
  g.setIndex(index);
  return g;
};

const v3 = (c: [number, number, number]) => new THREE.Vector3(...c);

export const createLineMaterial = (style: LineStyle, depthTest = true) =>
  new THREE.ShaderMaterial({
    uniforms: {
      resolution: {value: new THREE.Vector2(1920, 1080)},
      widthPx: {value: style.widthPx},
      glowPx: {value: style.glowPx ?? 0},
      glowGain: {value: style.glowGain ?? 0.35},
      colRich: {value: v3(emissiveForHex(COLORS.richBlack))},
      colDark: {value: v3(emissiveForHex(style.dark))},
      colLight: {value: v3(emissiveForHex(style.light))},
      progress: {value: 1},
      start: {value: 0}, // hides u < start (for travelling pulses)
      tail: {value: style.tail ?? 0.35},
      settle: {value: 0},
      headBoost: {value: style.headBoost ?? 1.5},
      intensity: {value: style.intensity ?? 1},
      midStop: {value: LINE_STOPS.mid},
      loop: {value: 0}, // closed orbit mode: the head circles, the tail wraps around
    },
    vertexShader: /* glsl */ `
      attribute vec3 prev;
      attribute vec3 next;
      attribute float side;
      attribute float u;
      uniform vec2 resolution;
      uniform float widthPx, glowPx;
      varying float vU;
      varying float vD; // signed distance from the centre line in px
      varying float vHalf;
      vec2 toScreen(vec4 c) { return c.xy / max(c.w, 1e-5) * resolution * 0.5; }
      void main() {
        float scale = resolution.y / 1080.0;
        mat4 mvp = projectionMatrix * modelViewMatrix;
        vec4 c = mvp * vec4(position, 1.0);
        vec4 p = mvp * vec4(prev, 1.0);
        vec4 n = mvp * vec4(next, 1.0);
        vec2 cs = toScreen(c), ps = toScreen(p), ns = toScreen(n);
        vec2 d1 = cs - ps, d2 = ns - cs;
        vec2 t1 = length(d1) > 1e-5 ? normalize(d1) : vec2(0.0);
        vec2 t2 = length(d2) > 1e-5 ? normalize(d2) : vec2(0.0);
        vec2 dir = t1 + t2;
        dir = length(dir) > 1e-5 ? normalize(dir) : (length(t1) > 0.0 ? t1 : vec2(1.0, 0.0));
        vec2 nrm = vec2(-dir.y, dir.x);
        float half_ = (widthPx * 0.5 + glowPx * 3.0) * scale + 1.5;
        c.xy += nrm * side * half_ / (resolution * 0.5) * c.w;
        gl_Position = c;
        vU = u;
        vD = side * half_;
        vHalf = half_;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 resolution;
      uniform float widthPx, glowPx, glowGain, progress, start, tail, settle, headBoost, intensity, midStop, loop;
      uniform vec3 colRich, colDark, colLight;
      varying float vU;
      varying float vD;
      varying float vHalf;
      vec3 brandGradient(float g) {
        return g < midStop ? mix(colRich, colDark, g / midStop)
                           : mix(colDark, colLight, (g - midStop) / (1.0 - midStop));
      }
      void main() {
        float behind;
        if (loop > 0.5) {
          behind = fract(progress - vU) / max(tail, 1e-4);
        } else {
          if (vU > progress || vU < start) discard;
          behind = (progress - vU) / max(tail, 1e-4);
        }
        float scale = resolution.y / 1080.0;
        float d = abs(vD);
        float core = clamp(widthPx * 0.5 * scale + 0.5 - d, 0.0, 1.0);
        float sigma = max(glowPx * scale, 1e-3);
        float glow = glowPx > 0.0 ? exp(-0.5 * d * d / (sigma * sigma)) * glowGain : 0.0;
        float g = clamp(1.0 - behind, 0.0, 1.0);
        vec3 col = brandGradient(g);
        col = mix(col, colLight, settle);
        float head = exp(-behind * behind * 400.0) * (1.0 - settle);
        col *= 1.0 + head * headBoost;
        float a = (core + glow);
        gl_FragColor = vec4(col * a * intensity, 1.0);
      }
    `,
    transparent: true,
    // MAX instead of ADD: overlapping ribbon segments at joints would otherwise
    // double up into bright beads along curved lines.
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    // Ribbon winding depends on the on-screen direction of travel: never cull.
    side: THREE.DoubleSide,
    depthTest,
    depthWrite: false,
  });

export const makeLine = (points: THREE.Vector3[], style: LineStyle, closed = false, depthTest = true) => {
  const mesh = new THREE.Mesh(buildRibbonGeometry(points, closed), createLineMaterial(style, depthTest));
  mesh.frustumCulled = false;
  return mesh;
};

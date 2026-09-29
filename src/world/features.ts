import * as THREE from 'three';
import kazakhstan from '../data/kazakhstan.json';
import placesData from '../data/places.json';
import {COLORS, PAIRS, emissiveForHex} from '../brand';
import {LOGO_CLEAR_RECT} from '../layout';
import {geoToVec3, greatCircle, angleBetween, DEG} from '../math/geo';
import {mulberry32, gaussian} from '../math/random';
import {BEATS, TEXT, clamp01, envelope, progress, smoother, easeOutSoft, easeCinema} from '../timeline';
import {makeLine} from './lines';

// All story elements drawn on / around the globe: Kazakhstan border, Astana pulse,
// regional network, international arcs, startup constellation, growth trajectory,
// orbits and satellites. Every property is a pure function of time t (seconds).

type Place = {name: string; lon: number; lat: number};
const PLACES = (placesData as {places: Record<string, Place>}).places;
export const ASTANA = PLACES.astana;
const REGIONAL = [
  'uralsk', 'atyrau', 'aktau', 'aktobe', 'kostanay', 'petropavl', 'kokshetau', 'pavlodar',
  'karaganda', 'zhezkazgan', 'kyzylorda', 'turkistan', 'shymkent', 'taraz', 'konaev',
  'taldykorgan', 'almaty', 'semey', 'oskemen',
].filter((k) => PLACES[k]);
const INTERNATIONAL = ['shanghai', 'dubai', 'kualalumpur', 'paloalto'].filter((k) => PLACES[k]);

const vec = (p: Place, r = 1) => geoToVec3(p.lat, p.lon, r);

/** Launch/arrival times of the regional network arcs (seconds). Shared with the soundtrack. */
export const regionalSchedule = () => {
  const a = vec(ASTANA);
  const angs = REGIONAL.map((k) => angleBetween(a, vec(PLACES[k])));
  const maxAng = Math.max(...angs);
  return REGIONAL.map((key, i) => {
    const start = BEATS.networkStart + (i / REGIONAL.length) * 1.6 + (angs[i] / maxAng) * 0.4;
    const dur = 1.0 + 1.6 * (angs[i] / maxAng);
    return {key, start, dur, arrive: start + dur, ang: angs[i]};
  });
};

/** Launch/arrival times of the international arcs (T5). */
export const internationalSchedule = () => {
  const a = vec(ASTANA);
  return INTERNATIONAL.map((key, i) => {
    const ang = angleBetween(a, vec(PLACES[key]));
    const start = TEXT.t5.in + 0.5 + i * 0.35;
    const dur = 1.6 + ang * 0.6;
    return {key, start, dur, arrive: start + dur, ang};
  });
};
const u = (m: THREE.Mesh) => (m.material as THREE.ShaderMaterial).uniforms;

// ---------------------------------------------------------------- glow points
const pointsVertex = /* glsl */ `
  attribute float size;
  attribute float birth;
  attribute float seed;
  attribute vec3 color;
  uniform float time, pixelScale, gain, fadeIn, rise;
  varying vec3 vCol;
  varying float vSigma;
  void main() {
    float age = time - birth;
    float on = smoothstep(0.0, fadeIn, age);
    vec3 p = position * (1.0 + rise * smoothstep(0.0, 4.0, age) * (0.4 + 0.6 * seed));
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float flicker = 0.85 + 0.15 * sin(time * (1.3 + seed * 2.1) + seed * 40.0);
    float flash = 1.0 + 2.5 * exp(-max(age, 0.0) * 6.0) * step(0.0, age);
    vSigma = size * pixelScale;
    vCol = color * gain * on * flicker * flash;
    gl_PointSize = ceil(vSigma * 8.0);
    gl_Position = clip;
  }
`;
const pointsFragment = /* glsl */ `
  varying vec3 vCol;
  varying float vSigma;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    vec2 d = q * ceil(vSigma * 8.0);
    float r2 = dot(d, d) / (vSigma * vSigma);
    float edge = 1.0 - smoothstep(0.3, 0.5, length(q));
    float g = (exp(-0.5 * r2) + 0.05 * exp(-0.5 * r2 / 6.0)) * edge;
    gl_FragColor = vec4(vCol * g, 1.0);
  }
`;

const makePoints = (positions: THREE.Vector3[], sizes: number[], births: number[], colors: THREE.Color[],
                    seed = 1) => {
  const rnd = mulberry32(seed);
  const n = positions.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const birth = new Float32Array(n);
  const sd = new Float32Array(n);
  const col = new Float32Array(n * 3);
  positions.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    size[i] = sizes[i];
    birth[i] = births[i];
    sd[i] = rnd();
    col.set([colors[i].r, colors[i].g, colors[i].b], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('birth', new THREE.BufferAttribute(birth, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: {
        time: {value: 0},
        pixelScale: {value: 1},
        gain: {value: 1},
        fadeIn: {value: 0.35},
        rise: {value: 0},
      },
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    }),
  );
  m.frustumCulled = false;
  return m;
};

const emissiveColor = (hex: string, k = 1) => {
  const [r, g, b] = emissiveForHex(hex);
  return new THREE.Color(r * k, g * k, b * k);
};

// ---------------------------------------------------------------- rings (Astana pulse)
const createRings = () => {
  const center = vec(ASTANA, 1.0016);
  const n = center.clone().normalize();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        time: {value: 0},
        start: {value: BEATS.astanaPulse},
        gain: {value: 0},
        colLight: {value: new THREE.Vector3(...emissiveForHex(PAIRS.blue.light))},
        colWhite: {value: new THREE.Vector3(...emissiveForHex(COLORS.white))},
        radius: {value: 0.085},
        pattern: {value: 0},
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time, start, gain, pattern;
        uniform vec3 colLight, colWhite;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          if (r > 1.0) discard;
          float t = time - start;
          float c = 0.0;
          // Four expanding rings per 2.4 s cycle (brand pattern: concentric steps).
          for (int k = 0; k < 4; k++) {
            float ph = fract(t / 2.4 - float(k) * 0.25);
            float rad = ph;
            float w = 0.006 + 0.012 * ph;
            float ring = exp(-0.5 * pow((r - rad) / w, 2.0)) * pow(1.0 - ph, 2.0) * 0.55;
            c += ring * step(0.0, t - float(k) * 0.6);
          }
          // Static stepped rings (the brand's base pattern), very faint.
          float steps = floor(r * 10.0) / 10.0;
          float stepped = (1.0 - steps) * 0.022 * pattern * (1.0 - smoothstep(0.85, 1.0, r));
          float core = exp(-r * r / 0.0004) * 1.6;
          vec3 col = colLight * (c + stepped) + colWhite * core;
          gl_FragColor = vec4(col * gain, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    }),
  );
  // Orient the plane tangent to the sphere at Astana.
  mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  mesh.frustumCulled = false;
  return mesh;
};

// ---------------------------------------------------------------- orbits
const orbitPoints = (radius: number, normal: THREE.Vector3, phase: number, segments = 360) => {
  const nrm = normal.clone().normalize();
  const a = new THREE.Vector3(0, 1, 0).cross(nrm);
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
  a.normalize();
  const b = new THREE.Vector3().crossVectors(nrm, a).normalize();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const th = phase + (i / segments) * Math.PI * 2;
    pts.push(a.clone().multiplyScalar(Math.cos(th) * radius).add(b.clone().multiplyScalar(Math.sin(th) * radius)));
  }
  return {pts, a, b, nrm};
};

// ---------------------------------------------------------------- polyline tools
const simplify = (pts: number[][], eps: number): number[][] => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = 0;
    for (let i = a + 1; i < b; i++) {
      // Closed rings start and end on the same point: fall back to point distance.
      const d = len < 1e-9
        ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD > eps) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
};

const chaikin = (pts: number[][], iterations: number): number[][] => {
  let out = pts;
  for (let it = 0; it < iterations; it++) {
    const next: number[][] = [];
    for (let i = 0; i < out.length - 1; i++) {
      const [x0, y0] = out[i];
      const [x1, y1] = out[i + 1];
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    next.push(next[0]);
    out = next;
  }
  return out;
};

// ---------------------------------------------------------------- build
export const createFeatures = () => {
  const group = new THREE.Group();

  // Kazakhstan border: Natural Earth 1:10m, simplified (Douglas-Peucker, ~3 km) and
  // Chaikin-smoothed so the glowing line is clean at every zoom, then two draw heads
  // start from the northern point and meet in the south.
  const raw = (kazakhstan as {rings: number[][][]}).rings[0];
  const ring = chaikin(simplify(raw, 0.03), 2).map(([lon, lat]) => geoToVec3(lat, lon, 1.0012));
  let startIdx = 0;
  const astanaV = vec(ASTANA);
  ring.forEach((p, i) => {
    if (p.y > ring[startIdx].y && Math.abs(p.clone().normalize().dot(astanaV.clone().normalize())) > 0.97) startIdx = i;
  });
  const rot = [...ring.slice(startIdx), ...ring.slice(0, startIdx)];
  const half = Math.floor(rot.length / 2);
  const borderStyle = {light: PAIRS.sky.light, dark: PAIRS.sky.dark, widthPx: 2.3, glowPx: 5, glowGain: 0.28, tail: 0.45, headBoost: 2.5};
  const borderA = makeLine(rot.slice(0, half + 1), borderStyle);
  const borderB = makeLine([rot[0], ...rot.slice(half).reverse()], borderStyle);
  group.add(borderA, borderB);

  const rings = createRings();
  group.add(rings);

  // Regional network: great-circle arcs Astana -> hub, slightly lifted.
  const regional = REGIONAL.map((k) => {
    const dest = vec(PLACES[k]);
    const ang = angleBetween(astanaV, dest);
    const pts = greatCircle(astanaV, dest, 64, (s) => 0.0015 + Math.sin(Math.PI * s) * ang * 0.08);
    return {key: k, ang, line: makeLine(pts, {light: PAIRS.sky.light, dark: PAIRS.sky.dark, widthPx: 1.6, glowPx: 3.5, glowGain: 0.3, tail: 0.55, headBoost: 3})};
  });
  const netTiming = regionalSchedule();
  regional.forEach((r) => group.add(r.line));

  // Hub nodes (+ Astana), ignite when their arc arrives.
  const nodePos = [vec(ASTANA, 1.0022), ...regional.map((r) => vec(PLACES[r.key], 1.0022))];
  const nodeBirth = [BEATS.astanaPulse, ...netTiming.map((n) => n.start + n.dur)];
  const nodes = makePoints(
    nodePos,
    nodePos.map((_, i) => (i === 0 ? 2.6 : 1.7)),
    nodeBirth,
    nodePos.map((_, i) => emissiveColor(i === 0 ? COLORS.white : PAIRS.sky.light, i === 0 ? 3 : 2.2)),
    7,
  );
  group.add(nodes);

  // International arcs (T5).
  const intlTiming = internationalSchedule();
  const intl = INTERNATIONAL.map((k, i) => {
    const dest = vec(PLACES[k]);
    const ang = angleBetween(astanaV, dest);
    const pts = greatCircle(astanaV, dest, 160, (s) => 0.002 + Math.sin(Math.PI * s) * (0.03 + ang * 0.16));
    return {
      line: makeLine(pts, {light: PAIRS.sunset.light, dark: PAIRS.sunset.dark, widthPx: 2.0, glowPx: 4, glowGain: 0.3, tail: 0.5, headBoost: 2}),
      start: intlTiming[i].start,
      dur: intlTiming[i].dur,
      dest: vec(PLACES[k], 1.0022),
    };
  });
  intl.forEach((a) => group.add(a.line));
  const intlNodes = makePoints(
    intl.map((a) => a.dest),
    intl.map(() => 2.0),
    intl.map((a) => a.start + a.dur),
    intl.map(() => emissiveColor(PAIRS.sunset.light, 1.6)),
    9,
  );
  group.add(intlNodes);

  // Startup constellation (T3): 2015 lights; 185 already lit ("2019"), the rest ignite.
  const rnd = mulberry32(2015);
  const weights: Record<string, number> = {almaty: 0.2, astana: 0.2, shymkent: 0.08, karaganda: 0.05};
  const keys = ['astana', ...REGIONAL];
  const wsum = keys.reduce((s, k) => s + (weights[k] ?? 0.025), 0);
  const cstPos: THREE.Vector3[] = [];
  for (let i = 0; i < 2015; i++) {
    let x = rnd() * wsum;
    let key = keys[0];
    for (const k of keys) {
      x -= weights[k] ?? 0.025;
      if (x <= 0) {
        key = k;
        break;
      }
    }
    const p = PLACES[key];
    const spread = key === 'almaty' || key === 'astana' ? 0.9 : 0.7;
    const lat = p.lat + gaussian(rnd) * spread * 0.7;
    const lon = p.lon + gaussian(rnd) * spread;
    cstPos.push(geoToVec3(lat, lon, 1.003 + rnd() * 0.006));
  }
  // Ignition order: the first 185 are the "2019" set.
  const cstBirth = cstPos.map((_, i) => (i < 185 ? TEXT.t3.in - 1 : 0));
  const countAt = constellationCount;
  for (let i = 185; i < 2015; i++) {
    // invert countAt: find t where count reaches i+1
    let lo: number = TEXT.t3.in;
    let hi: number = TEXT.t3.in + 5;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (countAt(mid) >= i + 1) hi = mid;
      else lo = mid;
    }
    cstBirth[i] = hi;
  }
  const cstCol = cstPos.map((_, i) => emissiveColor(i % 7 === 0 ? PAIRS.blue.light : PAIRS.violet.light, 1.6));
  const constellation = makePoints(cstPos, cstPos.map((_, i) => (i < 185 ? 1.25 : 0.95)), cstBirth, cstCol, 11);
  group.add(constellation);

  // Growth trajectory (T4): exponential curves rising from Astana.
  const up = astanaV.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const northT = new THREE.Vector3().crossVectors(up, east).normalize();
  const trajectories = [0, 1, 2].map((j) => {
    const k = 3.6 + j * 0.9;
    // Azimuth ~290 deg (WNW): to the right of the T4 camera, which looks SSW.
    const az = (290 + (j - 1) * 14) * DEG;
    const dir = east.clone().multiplyScalar(Math.sin(az)).add(northT.clone().multiplyScalar(Math.cos(az)));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 200; i++) {
      const s = i / 200;
      const h = 0.26 * (Math.exp(k * s) - 1) / (Math.exp(k) - 1) * (1 - j * 0.18);
      const along = s * (0.16 - j * 0.025);
      const surf = up.clone().multiplyScalar(Math.cos(along)).add(dir.clone().multiplyScalar(Math.sin(along)));
      pts.push(surf.multiplyScalar(1.0025 + h));
    }
    return makeLine(pts, {light: PAIRS.purple.light, dark: PAIRS.purple.dark, widthPx: j === 0 ? 2.6 : 1.4, glowPx: j === 0 ? 6 : 3, glowGain: 0.3, tail: 0.6, headBoost: 3});
  });
  trajectories.forEach((l) => group.add(l));

  // Orbits (sky pair): 2 in the sunrise, 3 "goals" with satellites, 2 in the finale.
  const mkOrbit = (radius: number, normal: THREE.Vector3, phase: number, pair: {light: string; dark: string}, width: number) => {
    const o = orbitPoints(radius, normal, phase);
    const line = makeLine(o.pts, {light: pair.light, dark: pair.dark, widthPx: width, glowPx: 3, glowGain: 0.22, tail: 0.75, headBoost: 1.5}, true);
    return {...o, line, radius, phase};
  };
  const sunriseOrbits = [
    // Normal chosen so the ring stays ~70 deg inclined to the view over 12-21 s
    // (never edge-on, where it would read as a straight scratch across the planet).
    mkOrbit(1.22, new THREE.Vector3(-0.6, 0.49, 0.64), 0.4, PAIRS.sky, 1.9),
    mkOrbit(1.36, new THREE.Vector3(-0.55, 1, -0.2), 2.1, PAIRS.sky, 1.9),
  ];
  const goalOrbits = [
    mkOrbit(1.32, new THREE.Vector3(0.15, 1, 0.55), 0.0, PAIRS.sky, 2.0),
    mkOrbit(1.58, new THREE.Vector3(-0.35, 1, 0.1), 1.3, PAIRS.sky, 2.0),
    mkOrbit(1.86, new THREE.Vector3(0.5, 1, -0.3), 2.6, PAIRS.sky, 2.0),
  ];
  const finaleOrbits = [
    mkOrbit(1.9, new THREE.Vector3(0.35, 1, 0.3), 0.9, PAIRS.sky, 1.96),
    mkOrbit(2.6, new THREE.Vector3(-0.45, 1, -0.15), 2.9, PAIRS.sky, 1.96),
  ];
  [...sunriseOrbits, ...goalOrbits, ...finaleOrbits].forEach((o) => group.add(o.line));
  const satellites = makePoints(
    goalOrbits.map((o) => o.a.clone().multiplyScalar(o.radius)),
    goalOrbits.map(() => 2.2),
    goalOrbits.map((_, i) => TEXT.t6.in + 0.8 + i * 0.5),
    goalOrbits.map(() => emissiveColor(COLORS.white, 0.35)),
    13,
  );
  group.add(satellites);

  const lineMeshes = () => [
    borderA, borderB, ...regional.map((r) => r.line), ...intl.map((a) => a.line), ...trajectories,
    ...sunriseOrbits.map((o) => o.line), ...goalOrbits.map((o) => o.line), ...finaleOrbits.map((o) => o.line),
  ];
  const pointMeshes = [nodes, intlNodes, constellation, satellites];

  const setLine = (m: THREE.Mesh, prog: number, gain: number, settle = 0, start = 0) => {
    const uu = u(m);
    uu.progress.value = prog;
    uu.intensity.value = gain;
    uu.settle.value = settle;
    uu.start.value = start;
    m.visible = gain > 1e-4 && prog > 0;
  };

  const update = (t: number, resolution: THREE.Vector2, pixelScale: number) => {
    // Lines leave the logo clear space before the lockup appears (brandbook p. 11).
    const clearAmt = smoother(progress(t, BEATS.logo - 0.8, BEATS.logo));
    for (const m of lineMeshes()) {
      const uu = u(m);
      uu.resolution.value.copy(resolution);
      uu.clearAmt.value = clearAmt;
      uu.clearRect.value.set(LOGO_CLEAR_RECT.x0, LOGO_CLEAR_RECT.y0, LOGO_CLEAR_RECT.x1, LOGO_CLEAR_RECT.y1);
    }
    for (const p of pointMeshes) {
      const uu = (p.material as THREE.ShaderMaterial).uniforms;
      uu.time.value = t;
      uu.pixelScale.value = pixelScale;
    }

    // Border: draws 27.0-30.6, settles, stays through the finale (dimmer in scene 5).
    const bp = easeCinema(progress(t, BEATS.borderDraw, BEATS.borderDrawEnd));
    const bSettle = smoother(progress(t, BEATS.borderDrawEnd - 0.3, BEATS.borderDrawEnd + 1.2));
    const bGain = smoother(progress(t, BEATS.borderDraw - 0.2, BEATS.borderDraw + 0.3)) *
      (1 - 0.35 * smoother(progress(t, 45, 47))) * (1 - smoother(progress(t, 87.5, 89.5)));
    setLine(borderA, bp, bGain, bSettle);
    setLine(borderB, bp, bGain, bSettle);

    // Astana rings.
    const ru = u(rings);
    ru.time.value = t;
    ru.gain.value = envelope(t, BEATS.astanaPulse - 0.1, 51.5, 0.4, 1.5) *
      (1 - smoother(progress(t, 34.2, 35.4)) + smoother(progress(t, 44.5, 46.5)));
    ru.pattern.value = envelope(t, 45, 51, 1.2, 1.5);
    rings.visible = ru.gain.value > 1e-4;
    rings.scale.setScalar(0.05 * (1 + 0.8 * smoother(progress(t, 45, 50))));

    // Regional network.
    const netFade = 1 - 0.5 * smoother(progress(t, 45, 47)) - 0.25 * smoother(progress(t, 51, 53));
    const netOut = 1 - smoother(progress(t, 74, 77));
    regional.forEach((r, i) => {
      const {start, dur} = netTiming[i];
      const p = easeOutSoft(progress(t, start, start + dur));
      const settle = smoother(progress(t, start + dur, start + dur + 1.2));
      setLine(r.line, p, netFade * netOut, settle * 0.45);
    });
    const nu = (nodes.material as THREE.ShaderMaterial).uniforms;
    nu.gain.value = netOut * (1 - 0.3 * smoother(progress(t, 45, 47)));
    nodes.visible = t > BEATS.astanaPulse - 0.5 && nu.gain.value > 1e-4;

    // International arcs.
    const intlOut = 1 - smoother(progress(t, 69.2, 71.4));
    intl.forEach((a) => {
      const p = easeOutSoft(progress(t, a.start, a.start + a.dur));
      const settle = smoother(progress(t, a.start + a.dur, a.start + a.dur + 1));
      setLine(a.line, p, intlOut * (1 - 0.4 * smoother(progress(t, 69, 71))), settle * 0.8);
    });
    (intlNodes.material as THREE.ShaderMaterial).uniforms.gain.value = intlOut;
    intlNodes.visible = t > TEXT.t5.in && intlOut > 1e-4;

    // Constellation.
    const cu = (constellation.material as THREE.ShaderMaterial).uniforms;
    cu.gain.value = envelope(t, TEXT.t3.in - 0.6, 64, 0.6, 2.5);
    cu.rise.value = 0.004;
    constellation.visible = cu.gain.value > 1e-4;

    // Trajectories.
    trajectories.forEach((l, j) => {
      const st = TEXT.t4.in + 0.25 + j * 0.35;
      const p = easeCinema(progress(t, st, st + 2.6));
      const gain = envelope(t, st - 0.1, 66, 0.3, 2.5) * (j === 0 ? 1 : 0.6);
      setLine(l, p, gain, smoother(progress(t, st + 2.6, st + 3.6)) * 0.6);
    });

    // Orbits.
    const drawOrbit = (o: ReturnType<typeof mkOrbit>, s: number, dur: number, gain: number, speed: number, loopAfter = true) => {
      const p = easeCinema(progress(t, s, s + dur));
      const uu = u(o.line);
      // After the reveal the head keeps circling (satellite), tail wraps around.
      const head = p < 1 || !loopAfter ? p : 1 + (t - (s + dur)) * speed;
      uu.loop.value = loopAfter && p >= 1 ? 1 : 0;
      setLine(o.line, loopAfter && p >= 1 ? head : p, gain);
      if (loopAfter && p >= 1) uu.progress.value = head % 1;
      return head;
    };
    sunriseOrbits.forEach((o, i) => drawOrbit(o, BEATS.sunrise + 0.6 + i * 0.5, 3.2, envelope(t, BEATS.sunrise + 0.4, 21, 0.5, 2.5) * 0.9, 0.03));
    const satPos = (satellites.geometry.attributes.position as THREE.BufferAttribute);
    goalOrbits.forEach((o, i) => {
      const s = TEXT.t6.in + 0.3 + i * 0.5;
      const head = drawOrbit(o, s, 2.2, envelope(t, s - 0.1, 78, 0.3, 2.5), 0.05);
      const th = o.phase + head * Math.PI * 2;
      const p = o.a.clone().multiplyScalar(Math.cos(th) * o.radius).add(o.b.clone().multiplyScalar(Math.sin(th) * o.radius));
      satPos.setXYZ(i, p.x, p.y, p.z);
    });
    satPos.needsUpdate = true;
    (satellites.material as THREE.ShaderMaterial).uniforms.gain.value = envelope(t, TEXT.t6.in, 78, 0.5, 2.5);
    satellites.visible = t > TEXT.t6.in && t < 79;
    finaleOrbits.forEach((o, i) => drawOrbit(o, 76.5 + i * 0.6, 4.5, envelope(t, 76.2, 90, 0.8, 2.0) * 0.95, 0.012));
  };

  return {group, update};
};

/** Startup counter shown on screen and used for the constellation (185 -> 2015). */
export const constellationCount = (t: number) => {
  // Settles on the final value ~3 s before T3 leaves (readability >= 2 s).
  const p = easeOutSoft(progress(t, TEXT.t3.in + 0.4, TEXT.t3.in + 3.4));
  return Math.round(185 + (2015 - 185) * clamp01(p));
};

import * as THREE from 'three';
import {mulberry32, gaussian} from '../math/random';

// Deep-space background: a star catalogue at infinity (no parallax), three shells
// of faint star dust at finite distance (parallax during camera moves) and a very
// dim procedural nebula dome. Everything lives in the inertial frame, which rotates
// slowly relative to the Earth-fixed frame (uniform skyRot).

const starVertex = /* glsl */ `
  attribute float mag;
  attribute vec3 tint;
  uniform mat3 skyRot;
  uniform float pixelScale, reveal, gain, atInfinity;
  varying vec3 vCol;
  varying float vSigma;
  void main() {
    vec3 dir = skyRot * position;
    vec3 wp = atInfinity > 0.5 ? cameraPosition + normalize(dir) * 900.0 : dir;
    vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    // Magnitude-ordered reveal: bright stars appear first.
    float start = (mag + 1.5) / 9.0;
    float a = smoothstep(start - 0.25, start + 0.05, reveal);
    float flux = pow(10.0, -0.4 * mag);
    float sigma = (0.62 + 0.28 * clamp(1.0 - mag * 0.25, 0.0, 1.0)) * pixelScale;
    vSigma = sigma;
    vCol = tint * flux * gain * a / (sigma * sigma);
    gl_PointSize = ceil(sigma * 7.0);
    gl_Position = clip;
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vCol;
  varying float vSigma;
  void main() {
    vec2 d = (gl_PointCoord - 0.5) * ceil(vSigma * 7.0);
    float g = exp(-0.5 * dot(d, d) / (vSigma * vSigma));
    gl_FragColor = vec4(vCol * g, 1.0);
  }
`;

// Rough blackbody-ish tints from a colour index in [-0.3, 1.8].
const starTint = (bv: number): [number, number, number] => {
  const t = THREE.MathUtils.clamp((bv + 0.3) / 2.1, 0, 1);
  const hot = [0.72, 0.82, 1.0];
  const mid = [1.0, 0.97, 0.92];
  const cool = [1.0, 0.72, 0.48];
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
  const c = t < 0.35 ? lerp(hot, mid, t / 0.35) : lerp(mid, cool, (t - 0.35) / 0.65);
  return c as [number, number, number];
};

const makeStarPoints = (count: number, seed: number, atInfinity: boolean, radius: [number, number],
                        magRange: [number, number]) => {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const [m0, m1] = magRange;
  const a0 = Math.pow(10, 0.35 * m0);
  const a1 = Math.pow(10, 0.35 * m1);
  // Milky-Way-like concentration: half of the stars cluster near a tilted plane.
  const plane = new THREE.Vector3(0.35, 0.87, 0.35).normalize();
  for (let i = 0; i < count; i++) {
    let v = new THREE.Vector3(gaussian(rnd), gaussian(rnd), gaussian(rnd)).normalize();
    if (rnd() < 0.45) {
      v = v.sub(plane.clone().multiplyScalar(v.dot(plane) * (0.75 + 0.2 * rnd()))).normalize();
    }
    const r = atInfinity ? 1 : radius[0] + (radius[1] - radius[0]) * rnd();
    v.multiplyScalar(r);
    pos.set([v.x, v.y, v.z], i * 3);
    mag[i] = Math.log10(a0 + rnd() * (a1 - a0)) / 0.35;
    tint.set(starTint(-0.3 + 2.1 * Math.pow(rnd(), 1.4)), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      skyRot: {value: new THREE.Matrix3()},
      pixelScale: {value: 1},
      reveal: {value: 1},
      gain: {value: 1},
      atInfinity: {value: atInfinity ? 1 : 0},
    },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: !atInfinity,
    depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
};

export const createSky = (nebulaTex: THREE.Texture) => {
  const stars = makeStarPoints(16000, 20240901, true, [1, 1], [-1.4, 7.6]);
  (stars.material as THREE.ShaderMaterial).uniforms.gain.value = 5.5;
  stars.renderOrder = -10;

  const dust = [
    makeStarPoints(2200, 11, false, [14, 22], [5.5, 9.5]),
    makeStarPoints(2600, 12, false, [26, 40], [5.5, 9.5]),
    makeStarPoints(3000, 13, false, [45, 70], [5.5, 9.5]),
  ];
  dust.forEach((d) => {
    (d.material as THREE.ShaderMaterial).uniforms.gain.value = 3.0;
    d.renderOrder = -9;
  });

  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(950, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {tNebula: {value: nebulaTex}, skyRot: {value: new THREE.Matrix3()}, gain: {value: 0.012}},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec3 wp = cameraPosition + position;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #define PI 3.14159265359
        uniform sampler2D tNebula;
        uniform mat3 skyRot;
        uniform float gain;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(transpose(skyRot) * normalize(vDir));
          vec2 uv = vec2(atan(-d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
          vec3 c = texture2D(tNebula, uv).rgb;
          gl_FragColor = vec4(c * gain, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    }),
  );
  nebula.frustumCulled = false;
  nebula.renderOrder = -11;

  const group = new THREE.Group();
  group.add(nebula, stars, ...dust);

  return {
    group,
    stars,
    dust,
    nebula,
    set(skyRot: THREE.Matrix3, pixelScale: number, reveal: number, dustGain: number, nebulaGain: number) {
      for (const p of [stars, ...dust]) {
        const u = (p.material as THREE.ShaderMaterial).uniforms;
        u.skyRot.value.copy(skyRot);
        u.pixelScale.value = pixelScale;
        u.reveal.value = reveal;
      }
      dust.forEach((d) => ((d.material as THREE.ShaderMaterial).uniforms.gain.value = 3.0 * dustGain));
      const nu = (nebula.material as THREE.ShaderMaterial).uniforms;
      nu.skyRot.value.copy(skyRot);
      nu.gain.value = nebulaGain;
    },
  };
};

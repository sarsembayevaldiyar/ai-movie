import * as THREE from 'three';
import {DEG} from '../math/geo';
import {GLSL_TEX_FBM} from './luts';

// Local cloud bank over Astana for the dive (scene 4): stacked spherical-cap shells
// with texture-based noise density, lit from below by the city and from above by
// the moon. Shells are re-sorted every frame relative to the camera radius, so the
// camera can fly down through them and back out.

const LAYERS = 5;
const R0 = 1.009;
const R1 = 1.021;

export const createCloudBank = (lat: number, lon: number, noise: THREE.Texture) => {
  const group = new THREE.Group();
  const center = new THREE.Vector3(
    Math.cos(lat * DEG) * Math.cos(lon * DEG),
    Math.sin(lat * DEG),
    -Math.cos(lat * DEG) * Math.sin(lon * DEG),
  );
  // three.js SphereGeometry: phi = 180deg + lon, theta = 90deg - lat.
  const phi = (180 + lon) * DEG;
  const theta = (90 - lat) * DEG;
  const span = 8 * DEG;
  const shells: THREE.Mesh[] = [];
  for (let i = 0; i < LAYERS; i++) {
    const r = R0 + ((R1 - R0) * i) / (LAYERS - 1);
    const geo = new THREE.SphereGeometry(r, 72, 72, phi - span, span * 2, theta - span * 0.8, span * 1.6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tNoise: {value: noise},
        center: {value: center},
        layer: {value: i / (LAYERS - 1)},
        time: {value: 0},
        gain: {value: 0},
        cityCol: {value: new THREE.Vector3(0.9, 0.55, 0.3).multiplyScalar(0.012)},
        moonCol: {value: new THREE.Vector3(0.36, 0.44, 0.66).multiplyScalar(0.028)},
      },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        varying vec2 vUv;
        void main() {
          vP = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_TEX_FBM}
        uniform vec3 center, cityCol, moonCol;
        uniform float layer, time, gain;
        varying vec3 vP;
        varying vec2 vUv;
        void main() {
          vec3 n = normalize(vP);
          float ang = acos(clamp(dot(n, center), -1.0, 1.0));
          float bank = 1.0 - smoothstep(0.09, 0.14, ang);
          vec2 q = vUv * vec2(5.0, 3.6) + vec2(time * 0.004, time * 0.002) + layer * 0.37;
          float d = texFbm(q);
          float d2 = texFbm(q * 4.3 + 0.21);
          float mid = 1.0 - abs(layer * 2.0 - 1.0);
          float dens = smoothstep(0.40 - 0.05 * mid, 0.70, d * 0.78 + d2 * 0.3) * bank;
          float alpha = dens * (0.18 + 0.22 * mid) * gain;
          vec3 col = cityCol * (1.15 - layer) + moonCol * (0.5 + layer);
          col *= 0.5 + 0.8 * d2;
          gl_FragColor = vec4(col * alpha, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    shells.push(mesh);
    group.add(mesh);
  }

  const update = (t: number, gain: number, cameraRadius: number) => {
    group.visible = gain > 1e-4;
    shells.forEach((s, i) => {
      const r = R0 + ((R1 - R0) * i) / (LAYERS - 1);
      const uu = (s.material as THREE.ShaderMaterial).uniforms;
      uu.time.value = t;
      uu.gain.value = gain;
      // Farthest (in radius) first, nearest last.
      s.renderOrder = 20 + (1 - Math.min(1, Math.abs(cameraRadius - r) * 50));
    });
  };
  return {group, update};
};

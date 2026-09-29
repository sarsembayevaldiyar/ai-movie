import * as THREE from 'three';
import {GLSL_CONSTANTS, GLSL_RAY_SPHERE} from './common';
import {ATMO} from '../luts';

// Single-scattering atmosphere (Rayleigh + Mie) evaluated per pixel on the back
// faces of the atmosphere shell, additive over the planet and space. Sun
// transmittance comes from a precomputed LUT (see luts.ts); the view ray is
// marched with fewer steps when it hits the planet steeply (short, uniform path).
// Rayleigh coefficients are tuned towards the brand blue (#1833da / #9da6e1).

export const ATMO_RADIUS = ATMO.radius;

export const createAtmosphereMaterial = (lut: THREE.Texture) =>
  new THREE.ShaderMaterial({
    uniforms: {
      tTrans: {value: lut},
      sunDir: {value: new THREE.Vector3(1, 0, 0)},
      sunIntensity: {value: 22.0},
      betaR: {value: new THREE.Vector3(...ATMO.betaR)},
      betaM: {value: ATMO.betaM},
      HR: {value: ATMO.HR},
      HM: {value: ATMO.HM},
      g: {value: 0.8},
      intensity: {value: 1.0},
      nightGlow: {value: new THREE.Vector3(0.0005, 0.001, 0.004)},
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_CONSTANTS}
      ${GLSL_RAY_SPHERE}
      #define R_ATMO ${ATMO.radius.toFixed(4)}
      uniform sampler2D tTrans;
      uniform vec3 sunDir, betaR, nightGlow;
      uniform float sunIntensity, betaM, HR, HM, g, intensity;
      varying vec3 vWorld;

      vec3 sunTrans(float r, float mu) {
        float u = clamp((r - R_PLANET) / (R_ATMO - R_PLANET), 0.0, 1.0);
        float v = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
        return texture2D(tTrans, vec2(u * (63.0 / 64.0) + 0.5 / 64.0, v * (255.0 / 256.0) + 0.5 / 256.0)).rgb;
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        vec2 ta = raySphere(ro, rd, R_ATMO);
        if (ta.y < 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tp = raySphere(ro, rd, R_PLANET);
        bool hitsPlanet = tp.y > 0.0 && tp.x > 0.0;
        int steps = 10;
        if (hitsPlanet) {
          t1 = min(t1, tp.x);
          vec3 surf = ro + rd * tp.x;
          float muV = dot(normalize(surf), -rd);
          steps = muV > 0.35 ? 3 : (muV > 0.12 ? 6 : 10);
        }
        float ds = (t1 - t0) / float(steps);

        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        float odR = 0.0, odM = 0.0;
        for (int i = 0; i < 10; i++) {
          if (i >= steps) break;
          vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds);
          float r = length(p);
          float h = max(r - R_PLANET, 0.0);
          float dR = exp(-h / HR) * ds;
          float dM = exp(-h / HM) * ds;
          odR += dR * 0.5;
          odM += dM * 0.5;
          vec3 view = exp(-(betaR * odR + betaM * 1.1 * odM));
          vec3 sun = sunTrans(r, dot(p / r, sunDir));
          vec3 att = view * sun;
          sumR += dR * att;
          sumM += dM * att;
          odR += dR * 0.5;
          odM += dM * 0.5;
        }
        float mu = dot(rd, sunDir);
        float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
        float g2 = g * g;
        float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) /
                       ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
        vec3 col = sunIntensity * (sumR * betaR * phaseR + sumM * betaM * phaseM);
        // Faint airglow: the night-side limb reads as a thin brand-blue line.
        col += nightGlow * 30.0 * (1.0 - exp(-odR / HR / 30.0));
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

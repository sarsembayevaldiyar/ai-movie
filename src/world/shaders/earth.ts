import * as THREE from 'three';
import {GLSL_CHAPMAN, GLSL_CONSTANTS} from './common';
import {GLSL_TEX_FBM} from '../luts';

// Earth surface: NASA Blue Marble albedo, Black Marble lights + water mask (packed
// R/G), procedural clouds with shadows, twilight band, cool moonlight fill on the
// night side, ocean sun glint and extinction towards the camera. A high-resolution
// regional patch (Kazakhstan) is blended over the global maps.

export interface EarthTextures {
  day: THREE.Texture;
  lw: THREE.Texture;
  clouds: THREE.Texture;
  kzDay: THREE.Texture;
  kzLw: THREE.Texture;
  noise: THREE.Texture;
}

export const KZ_BOUNDS = new THREE.Vector4(45, 90, 39, 57); // lon0, lon1, lat0, lat1

export const createEarthMaterial = (tex: EarthTextures) =>
  new THREE.ShaderMaterial({
    uniforms: {
      tDay: {value: tex.day},
      tLw: {value: tex.lw},
      tClouds: {value: tex.clouds},
      tKzDay: {value: tex.kzDay},
      tKzLw: {value: tex.kzLw},
      tNoise: {value: tex.noise},
      kzBounds: {value: KZ_BOUNDS},
      sunDir: {value: new THREE.Vector3(1, 0, 0)},
      sunRadiance: {value: new THREE.Vector3(3.2, 3.1, 3.0)},
      cloudShift: {value: 0},
      cloudAmount: {value: 1},
      detail: {value: 0},
      lightsGain: {value: 3.0},
      moonGain: {value: 0.012},
      extinction: {value: new THREE.Vector3(5.5, 11.0, 22.0)}, // per unit length at sea level
      scaleHeight: {value: 0.0045},
      kzDim: {value: 0}, // darkens everything outside Kazakhstan (scenes 3-5 focus)
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_CONSTANTS}
      ${GLSL_CHAPMAN}
      ${GLSL_TEX_FBM}
      uniform sampler2D tDay, tLw, tClouds, tKzDay, tKzLw;
      uniform vec4 kzBounds;
      uniform vec3 sunDir, sunRadiance, extinction;
      uniform float cloudShift, cloudAmount, detail, lightsGain, moonGain, scaleHeight, kzDim;
      varying vec2 vUv;
      varying vec3 vPos;

      void main() {
        vec3 N = normalize(vPos);
        // Geographic coordinates straight from the texture coordinates (u: lon, v: lat).
        float lon = (vUv.x - 0.5) * 360.0;
        float lat = (vUv.y - 0.5) * 180.0;

        vec2 kzUv = vec2((lon - kzBounds.x) / (kzBounds.y - kzBounds.x),
                         (lat - kzBounds.z) / (kzBounds.w - kzBounds.z));
        vec2 edge = min(kzUv, 1.0 - kzUv) * vec2(kzBounds.y - kzBounds.x, kzBounds.w - kzBounds.z);
        float inKz = smoothstep(0.0, 0.6, min(edge.x, edge.y));

        vec3 albedo = texture2D(tDay, vUv).rgb;
        vec2 lw = texture2D(tLw, vUv).rg;
        float lightsBlur = texture2D(tLw, vUv, 5.0).r;
        if (inKz > 0.0) {
          albedo = mix(albedo, texture2D(tKzDay, kzUv).rgb, inKz);
          lw = mix(lw, texture2D(tKzLw, kzUv).rg, inKz);
        }
        float lights = lw.r;
        float water = lw.g;

        vec2 cuv = vec2(vUv.x - cloudShift, vUv.y);
        float cloud = texture2D(tClouds, cuv).r;
        if (detail > 0.0) {
          float det = texFbm(cuv * vec2(48.0, 24.0));
          cloud = mix(cloud, clamp(cloud * (0.55 + 0.9 * det), 0.0, 1.0), detail);
        }
        cloud *= cloudAmount;

        float NdL = dot(N, sunDir);
        // Sunlight at the ground: a narrow warm band right at the terminator.
        vec3 sunTint = mix(vec3(1.0, 0.72, 0.52), vec3(1.0), smoothstep(0.0, 0.07, NdL));
        float sunVis = smoothstep(-0.03, 0.05, NdL);
        vec3 E = sunRadiance * sunTint * sunVis;

        // Cloud shadow: offset the lookup towards the sun.
        vec3 T = normalize(sunDir - N * NdL + 1e-5);
        vec3 sp = normalize(N + T * 0.004);
        vec2 suv = vec2(atan(-sp.z, sp.x) / (2.0 * PI) + 0.5 - cloudShift, asin(clamp(sp.y, -1.0, 1.0)) / PI + 0.5);
        float shadow = texture2D(tClouds, suv).r * cloudAmount;

        vec3 V = normalize(cameraPosition - vPos);
        float NdV = max(dot(N, V), 1e-3);

        float diff = max(NdL + 0.04, 0.0) / 1.04;
        vec3 ground = albedo * E * diff * (1.0 - 0.55 * shadow);

        // Ocean glint: GGX + Schlick Fresnel on open water.
        vec3 H = normalize(V + sunDir);
        float NdH = max(dot(N, H), 0.0);
        float a2 = 0.0081;
        float dd = NdH * NdH * (a2 - 1.0) + 1.0;
        float D = a2 / (PI * dd * dd);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
        ground += E * (D * F / (4.0 * NdV) * max(NdL, 0.0)) * water * (1.0 - cloud) * 0.9;
        ground *= mix(1.0, 0.8, water);

        float cdiff = max(NdL + 0.1, 0.0) / 1.1;
        vec3 cloudCol = vec3(0.93, 0.95, 1.0) * E * cdiff * 1.1;

        // Night side: city lights (sodium warm -> LED white), glow under clouds, moon.
        float night = 1.0 - smoothstep(-0.16, 0.02, NdL);
        vec3 cityWarm = vec3(1.0, 0.60, 0.28);
        vec3 cityWhite = vec3(1.0, 0.85, 0.66);
        vec3 city = mix(cityWarm, cityWhite, smoothstep(0.35, 0.9, lights)) * (lights * lights) * lightsGain;
        city *= night * (1.0 - 0.85 * cloud);
        cloudCol += cityWarm * lightsBlur * lightsBlur * lightsGain * 0.3 * night * cloud;
        float moonLum = moonGain * night;
        float alb = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
        ground += mix(vec3(alb), albedo, 0.35) * vec3(0.55, 0.66, 1.0) * moonLum * (1.0 - 0.6 * water);
        cloudCol += vec3(0.62, 0.7, 0.95) * moonLum * 0.9;

        vec3 col = mix(ground, cloudCol, cloud) + city;
        col *= mix(1.0, mix(0.4, 1.0, inKz), kzDim);

        float od = opticalDepth(1.0, dot(N, V), scaleHeight);
        col *= exp(-extinction * od);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

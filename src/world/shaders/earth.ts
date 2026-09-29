import * as THREE from 'three';
import {GLSL_CHAPMAN, GLSL_CONSTANTS} from './common';
import {GLSL_TEX_FBM} from '../luts';

// Earth surface: NASA Blue Marble albedo, Black Marble lights + water mask (packed
// R/G), procedural clouds with shadows, twilight band, cool moonlight fill on the
// night side, ocean sun glint and extinction towards the camera. A high-resolution
// regional patch (Kazakhstan) is blended over the global maps. In the close dive
// over Astana the magnified lights map is reconstructed with a cubic B-spline and
// resolved into a procedural street grid (`cityDetail`).

export interface EarthTextures {
  day: THREE.Texture;
  lw: THREE.Texture;
  clouds: THREE.Texture;
  kzDay: THREE.Texture;
  kzLw: THREE.Texture;
  noise: THREE.Texture;
}

export const KZ_BOUNDS = new THREE.Vector4(45, 90, 39, 57); // lon0, lon1, lat0, lat1
const KZ_SIZE = new THREE.Vector2(8190, 3276); // patch texture size (texels)
const STREET_ORIGIN = new THREE.Vector2(71.43, 51.18); // Astana (lon, lat)

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
      cityDetail: {value: 0}, // 0..1, close-range street structure of the city lights
      kzSize: {value: KZ_SIZE},
      streetOrigin: {value: STREET_ORIGIN},
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
      uniform vec2 kzSize, streetOrigin;
      uniform vec3 sunDir, sunRadiance, extinction;
      uniform float cloudShift, cloudAmount, detail, lightsGain, moonGain, scaleHeight, kzDim, cityDetail;
      varying vec2 vUv;
      varying vec3 vPos;

      // Cubic B-spline reconstruction of the patch lights from 4 bilinear fetches:
      // the bilinear magnification shows texel blocks in the close dive.
      float kzLightsSmooth(vec2 uv) {
        vec2 st = uv * kzSize - 0.5;
        vec2 i = floor(st);
        vec2 f = st - i;
        vec2 f2 = f * f;
        vec2 f3 = f2 * f;
        vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
        vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
        vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
        vec2 w3 = f3 / 6.0;
        vec2 g0 = w0 + w1;
        vec2 g1 = w2 + w3;
        vec2 h0 = (i - 0.5 + w1 / g0) / kzSize;
        vec2 h1 = (i + 1.5 + w3 / g1) / kzSize;
        // Explicit LOD 0: the map is magnified here and the call sits in a branch.
        float a = textureLod(tKzLw, h0, 0.0).r;
        float b = textureLod(tKzLw, vec2(h1.x, h0.y), 0.0).r;
        float c = textureLod(tKzLw, vec2(h0.x, h1.y), 0.0).r;
        float d = textureLod(tKzLw, h1, 0.0).r;
        return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
      }

      void main() {
        vec3 N = normalize(vPos);
        // Geographic coordinates straight from the texture coordinates (u: lon, v: lat).
        float lon = (vUv.x - 0.5) * 360.0;
        float lat = (vUv.y - 0.5) * 180.0;

        vec2 kzUv = vec2((lon - kzBounds.x) / (kzBounds.y - kzBounds.x),
                         (lat - kzBounds.z) / (kzBounds.w - kzBounds.z));
        vec2 edge = min(kzUv, 1.0 - kzUv) * vec2(kzBounds.y - kzBounds.x, kzBounds.w - kzBounds.z);
        float inKz = smoothstep(0.0, 0.6, min(edge.x, edge.y));

        // Fetch only the maps that contribute (software GL is texture-fetch bound):
        // global maps outside the fully-inside patch area, patch maps inside it.
        vec3 albedo = vec3(0.0);
        vec2 lw = vec2(0.0);
        if (inKz < 1.0) {
          albedo = texture2D(tDay, vUv).rgb;
          lw = texture2D(tLw, vUv).rg;
        }
        if (inKz > 0.0) {
          albedo = mix(albedo, texture2D(tKzDay, kzUv).rgb, inKz);
          lw = mix(lw, texture2D(tKzLw, kzUv).rg, inKz);
        }
        float lights = lw.r;
        float water = lw.g;

        // Close range: an organic street network (anti-aliased iso-contours of the
        // ~1.6 km and ~0.8 km noise octaves, not a grid) over district-scale
        // mottling. Derivatives are taken here, outside non-uniform branches, and
        // the network fades out before its contours crowd below a few pixels.
        float streets = 0.0;
        float streetAmt = 0.0;
        float mottle = 1.0;
        if (cityDetail > 0.0) {
          vec2 km = vec2((lon - streetOrigin.x) * cos(radians(lat)), lat - streetOrigin.y) * 111.2;
          vec4 n = texture2D(tNoise, mat2(0.883, 0.469, -0.469, 0.883) * km * 0.04);
          float wg = fwidth(n.g) + 1e-4;
          float wb = fwidth(n.b) + 1e-4;
          float major = 1.0 - smoothstep(0.0, wg * 1.6, abs(n.g - 0.5));
          float minor = max(1.0 - smoothstep(0.0, wb * 1.1, abs(n.b - 0.4)),
                            1.0 - smoothstep(0.0, wb * 1.1, abs(n.b - 0.6)));
          streets = 1.5 * major + minor * (0.35 + 0.9 * n.r);
          // Kept subtle: a texture inside the glow, not a pattern on top of it.
          streetAmt = 0.4 * cityDetail * (1.0 - smoothstep(0.06, 0.16, wb));
          mottle = mix(1.0, 0.55 + 0.9 * n.r, cityDetail);
          if (inKz >= 1.0) lights = mix(lights, kzLightsSmooth(kzUv), cityDetail);
        }

        vec2 cuv = vec2(vUv.x - cloudShift, vUv.y);
        float cloud = texture2D(tClouds, cuv).r;
        if (detail > 0.0) {
          float det = texFbm(cuv * vec2(48.0, 24.0));
          cloud = mix(cloud, clamp(cloud * (0.55 + 0.9 * det), 0.0, 1.0), detail);
        }
        cloud *= cloudAmount;

        float NdL = dot(N, sunDir);
        vec3 V = normalize(cameraPosition - vPos);
        float NdV = max(dot(N, V), 1e-3);
        vec3 ground = vec3(0.0);
        vec3 cloudCol = vec3(0.0);

        // Day side (incl. the twilight band).
        if (NdL > -0.06) {
          vec3 sunTint = mix(vec3(1.0, 0.72, 0.52), vec3(1.0), smoothstep(0.0, 0.07, NdL));
          float sunVis = smoothstep(-0.03, 0.05, NdL);
          vec3 E = sunRadiance * sunTint * sunVis;
          // Cloud shadow: offset the lookup towards the sun.
          vec3 T = normalize(sunDir - N * NdL + 1e-5);
          vec3 sp = normalize(N + T * 0.004);
          vec2 suv = vec2(atan(-sp.z, sp.x) / (2.0 * PI) + 0.5 - cloudShift, asin(clamp(sp.y, -1.0, 1.0)) / PI + 0.5);
          float shadow = texture2D(tClouds, suv).r * cloudAmount;
          float diff = max(NdL + 0.04, 0.0) / 1.04;
          ground = albedo * E * diff * (1.0 - 0.55 * shadow);
          if (water > 0.01) {
            // Ocean glint: GGX + Schlick Fresnel on open water.
            vec3 H = normalize(V + sunDir);
            float NdH = max(dot(N, H), 0.0);
            float a2 = 0.0081;
            float dd = NdH * NdH * (a2 - 1.0) + 1.0;
            float D = a2 / (PI * dd * dd);
            float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
            ground += E * (D * F / (4.0 * NdV) * max(NdL, 0.0)) * water * (1.0 - cloud) * 0.9;
          }
          float cdiff = max(NdL + 0.1, 0.0) / 1.1;
          cloudCol = vec3(0.93, 0.95, 1.0) * E * cdiff * 1.1;
        }
        ground *= mix(1.0, 0.8, water);

        // Night side: city lights (sodium warm -> LED white), glow under clouds, moon.
        float night = 1.0 - smoothstep(-0.16, 0.02, NdL);
        vec3 city = vec3(0.0);
        if (night > 0.0) {
          vec3 cityWarm = vec3(1.0, 0.60, 0.28);
          vec3 cityWhite = vec3(1.0, 0.85, 0.66);
          float structure = mottle * mix(1.0, 0.45 + 1.0 * streets, streetAmt);
          float hot = smoothstep(0.35, 0.9, lights) * mix(1.0, 0.45 + 0.55 * clamp(streets, 0.0, 1.0), streetAmt);
          city = mix(cityWarm, cityWhite, hot) * (lights * lights) * structure * lightsGain;
          city *= night * (1.0 - 0.85 * cloud);
          if (cloud > 0.02) {
            float lightsBlur = texture2D(tLw, vUv, 5.0).r;
            cloudCol += cityWarm * lightsBlur * lightsBlur * lightsGain * 0.3 * night * cloud;
          }
          float moonLum = moonGain * night;
          float alb = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
          ground += mix(vec3(alb), albedo, 0.35) * vec3(0.55, 0.66, 1.0) * moonLum * (1.0 - 0.6 * water);
          cloudCol += vec3(0.62, 0.7, 0.95) * moonLum * 0.9;
        }

        vec3 col = mix(ground, cloudCol, cloud) + city;
        col *= mix(1.0, mix(0.4, 1.0, inKz), kzDim);

        float od = opticalDepth(1.0, dot(N, V), scaleHeight);
        col *= exp(-extinction * od);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

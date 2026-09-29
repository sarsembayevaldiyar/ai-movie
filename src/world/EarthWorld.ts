import * as THREE from 'three';
import {staticFile} from 'remotion';
import type {World, WorldFactory} from '../gl/FilmCanvas';
import {DEFAULT_POST, PostParams} from '../gl/FilmPipeline';
import {geoToVec3, DEG} from '../math/geo';
import {BEATS, SCENES, progress, smoother, envelope} from '../timeline';
import {CameraPath} from './cameraPath';
import {CAMERA_KEYS, OMEGA, SUN_DECLINATION, subsolarLon} from './keyframes';
import {createEarthMaterial} from './shaders/earth';
import {ATMO_RADIUS, createAtmosphereMaterial} from './shaders/atmosphere';
import {createNoiseTexture, createTransmittanceLut} from './luts';
import {createSky} from './sky';
import {createSun} from './sun';
import {ASTANA, createFeatures} from './features';
import {createCloudBank} from './cloudBank';

// The whole film's 3D world. `update(t)` is a pure function of time.

const loadTexture = (renderer: THREE.WebGLRenderer, path: string, srgb: boolean, repeatU = false) =>
  new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      staticFile(path),
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        renderer.initTexture(tex);
        resolve(tex);
      },
      undefined,
      (err) => reject(new Error(`Failed to load ${path}: ${String(err)}`)),
    );
  });

export const sunDirection = (t: number, out = new THREE.Vector3()) =>
  geoToVec3(SUN_DECLINATION, subsolarLon(t), 1, out);

// Grazing transmittance of sunlight past the limb (reddening at sunrise).
const sunTransmittance = (camera: THREE.Vector3, dir: THREE.Vector3): [number, number, number] => {
  const along = -camera.dot(dir);
  const closest = camera.clone().add(dir.clone().multiplyScalar(Math.max(along, 0)));
  const b = closest.length();
  if (along < 0 || b > ATMO_RADIUS) return [1, 1, 1];
  const h = Math.max(b - 1, 0);
  const H = 0.0045;
  const od = 2 * H * Math.exp(-h / H) * Math.sqrt((Math.PI * (1 + h)) / (2 * H));
  const beta = [3.2, 9.0, 32.0];
  return beta.map((bb) => Math.exp(-bb * od)) as [number, number, number];
};

export interface WorldOptions {
  hide?: string[]; // debug/profiling: 'earth' | 'atmo' | 'sky' | 'features' | 'bank' | 'sun'
}

export const makeEarthWorld = (opts: WorldOptions = {}): WorldFactory => (renderer) => {
  const hide = new Set(opts.hide ?? []);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.001, 2000);
  const path = new CameraPath(CAMERA_KEYS);

  const earthGeo = new THREE.SphereGeometry(1, 384, 192);
  const lut = createTransmittanceLut();
  const noise = createNoiseTexture();
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(ATMO_RADIUS, 192, 96), createAtmosphereMaterial(lut));
  atmo.renderOrder = 4;
  atmo.frustumCulled = false;
  const sun = createSun();
  const features = createFeatures();
  features.group.renderOrder = 10;
  const bank = createCloudBank(ASTANA.lat, ASTANA.lon, noise);

  let earth: THREE.Mesh | null = null;
  let sky: ReturnType<typeof createSky> | null = null;

  const ready = (async () => {
    const [day, lw, clouds, kzDay, kzLw, nebula] = await Promise.all([
      loadTexture(renderer, 'textures/earth_day_8k.jpg', true, true),
      loadTexture(renderer, 'textures/earth_lw_8k.png', false, true),
      loadTexture(renderer, 'textures/earth_clouds_4k.png', false, true),
      loadTexture(renderer, 'textures/kz_day.jpg', true),
      loadTexture(renderer, 'textures/kz_lw.png', false),
      loadTexture(renderer, 'textures/nebula_2k.png', true, true),
    ]);
    renderer.initTexture(lut);
    renderer.initTexture(noise);
    earth = new THREE.Mesh(earthGeo, createEarthMaterial({day, lw, clouds, kzDay, kzLw, noise}));
    earth.renderOrder = 0;
    sky = createSky(nebula);
    const parts: [string, THREE.Object3D][] = [
      ['sky', sky.group], ['earth', earth], ['sun', sun], ['atmo', atmo], ['features', features.group], ['bank', bank.group],
    ];
    for (const [name, obj] of parts) if (!hide.has(name)) scene.add(obj);
  })();

  const sunDir = new THREE.Vector3();
  const skyRot = new THREE.Matrix3();
  const resolution = new THREE.Vector2();

  const world: World = {
    scene,
    camera,
    ready,
    update(t, aspect) {
      if (!earth || !sky) return;
      path.apply(camera, t, aspect);
      sunDirection(t, sunDir);
      renderer.getDrawingBufferSize(resolution);
      const pixelScale = resolution.y / 1080;

      // Inertial frame rotates westwards relative to the Earth-fixed frame.
      skyRot.setFromMatrix4(new THREE.Matrix4().makeRotationY(-OMEGA * t * DEG));
      const reveal = smoother(progress(t, BEATS.starsIn, BEATS.starsIn + 4.5));
      const dustGain = 1 - smoother(progress(t, 18, 24)) + smoother(progress(t, 70, 80));
      const nebulaGain = 0.014 * (1 - 0.6 * smoother(progress(t, 20, 26)) + 0.6 * smoother(progress(t, 70, 80)));
      sky.set(skyRot, pixelScale, reveal, dustGain, nebulaGain);

      const eu = (earth.material as THREE.ShaderMaterial).uniforms;
      eu.sunDir.value.copy(sunDir);
      eu.cloudShift.value = t * 0.00008;
      // Cloud micro-detail only matters in close shots.
      eu.detail.value = THREE.MathUtils.clamp(1.4 - (camera.position.length() - 1) * 2.5, 0, 1);
      eu.kzDim.value = envelope(t, 28, 76, 3, 3) * 0.6;
      const alt = camera.position.length() - 1;
      eu.moonGain.value = 0.0025 + 0.0095 * THREE.MathUtils.smoothstep(alt, 0.05, 0.6);
      // Close dive over Astana: resolve the magnified lights into streets and
      // pull the gain down so the city core does not clip into a white blob.
      const city = 1 - THREE.MathUtils.smoothstep(alt, 0.03, 0.08);
      eu.cityDetail.value = city;
      eu.lightsGain.value = (3.0 + 1.5 * envelope(t, SCENES.kazakhstan.start, 76, 3, 3)) * (1 - 0.5 * city);

      const au = (atmo.material as THREE.ShaderMaterial).uniforms;
      au.sunDir.value.copy(sunDir);

      const su = (sun.material as THREE.ShaderMaterial).uniforms;
      su.sunDir.value.copy(sunDir);
      const tr = sunTransmittance(camera.position, sunDir);
      su.tint.value.set(tr[0], tr[1] * 0.97, tr[2] * 0.92);
      // Fraction of the solar disk above the limb drives the corona / star.
      const d = camera.position.length();
      const toC = camera.position.clone().negate().normalize();
      const alpha = Math.acos(THREE.MathUtils.clamp(toC.dot(sunDir), -1, 1));
      const limb = Math.asin(Math.min(1, 1 / d));
      su.glow.value = THREE.MathUtils.smoothstep(alpha - limb, -0.0085, 0.0085);

      features.update(t, resolution, pixelScale);
      const bankGain = envelope(t, BEATS.cloudDive - 0.4, 39.4, 1.0, 1.3);
      bank.update(t, bankGain, camera.position.length());
    },
    // Camera motion blur is done per pixel from depth (see FilmPipeline), so every
    // frame renders the scene once.
    samplesAt: () => 1,
    cameraAt(t, aspect, cam) {
      path.apply(cam, t, aspect);
    },
    postAt(t): PostParams {
      const fadeIn = smoother(progress(t, 0.3, 2.0));
      const fadeOut = 1 - smoother(progress(t, BEATS.fadeOut, 89.6));
      const nightBoost = envelope(t, 22, 77, 3, 3);
      return {
        ...DEFAULT_POST,
        exposure: 1.0 + 0.55 * nightBoost,
        bloomStrength: 0.045 + 0.008 * envelope(t, 13, 20, 1, 3),
        fade: fadeIn * fadeOut,
      };
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    },
  };
  return world;
};

export const createEarthWorld = makeEarthWorld();

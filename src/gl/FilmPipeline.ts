import * as THREE from 'three';
import {FULLSCREEN_VERTEX, FullScreenPass} from './FullScreenPass';

// HDR film pipeline:
//   scene (MSAA, half float) -> [temporal accumulation = shutter/motion blur]
//   -> physically based bloom (13-tap Karis downsample + tent upsample)
//   -> composite: bloom mix, chromatic aberration, exposure, ACES fitted tonemap,
//      sRGB encode, vignette, TPDF dither.
// Film grain and brand DOM layers are applied on top outside WebGL.

export interface PostParams {
  exposure: number;
  bloomStrength: number;
  vignette: number;
  chromatic: number; // px at the frame corner (in 1080p units)
  fade: number; // 0 = black, 1 = picture
  seed: number; // per-frame seed for dithering
}

export const DEFAULT_POST: PostParams = {
  exposure: 1,
  bloomStrength: 0.04,
  vignette: 0.22,
  chromatic: 0.6,
  fade: 1,
  seed: 0,
};

const halfFloatTarget = (w: number, h: number, withDepth = false) => {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: withDepth,
    stencilBuffer: false,
    samples: 0,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  if (withDepth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
  }
  return rt;
};

// Camera motion blur (per-pixel velocity from depth + the camera at shutter open /
// close, GPU Gems 3 ch. 27). One extra full-screen pass instead of N scene renders:
// on software GL this is the difference between minutes and hours.
const velocityBlurMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform mat4 invViewProj;
      uniform mat4 viewProjOpen;
      uniform mat4 viewProjClose;
      uniform vec2 resolution;
      uniform float maxTaps;
      varying vec2 vUv;
      void main() {
        float depth = texture2D(tDepth, vUv).r;
        vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 world = invViewProj * ndc;
        world /= world.w;
        vec4 a = viewProjOpen * world;
        vec4 b = viewProjClose * world;
        vec2 ua = a.xy / a.w * 0.5 + 0.5;
        vec2 ub = b.xy / b.w * 0.5 + 0.5;
        vec2 v = ub - ua;
        float px = length(v * resolution);
        vec3 c = texture2D(tColor, vUv).rgb;
        if (px < 0.75 || a.w <= 0.0 || b.w <= 0.0) {
          gl_FragColor = vec4(c, 1.0);
          return;
        }
        float taps = clamp(ceil(px / 1.25), 2.0, maxTaps);
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          if (float(i) >= taps) break;
          float s = (float(i) + 0.5) / taps - 0.5;
          sum += texture2D(tColor, vUv + v * s).rgb;
        }
        gl_FragColor = vec4(sum / taps, 1.0);
      }
    `,
    uniforms: {
      tColor: {value: null},
      tDepth: {value: null},
      invViewProj: {value: new THREE.Matrix4()},
      viewProjOpen: {value: new THREE.Matrix4()},
      viewProjClose: {value: new THREE.Matrix4()},
      resolution: {value: new THREE.Vector2()},
      maxTaps: {value: 16},
    },
    depthTest: false,
    depthWrite: false,
  });

export interface ShutterCameras {
  open: THREE.Camera; // camera state at shutter open (t - shutter/2)
  close: THREE.Camera; // camera state at shutter close (t + shutter/2)
}

const accumulateMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform float weight;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * weight, 1.0);
      }
    `,
    uniforms: {tSrc: {value: null}, weight: {value: 1}},
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });

// 13-tap downsample from "Next Generation Post Processing in Call of Duty: AW".
// The first pass uses a Karis average per 2x2 group to kill fireflies (sun glints,
// single bright stars) that would otherwise flicker in the bloom.
const downsampleMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 texel;
      uniform float karis;
      varying vec2 vUv;
      vec3 t(vec2 o) { return texture2D(tSrc, vUv + texel * o).rgb; }
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 kw(vec3 c) { return c / (1.0 + luma(c)); }
      void main() {
        vec3 a = t(vec2(-2.0, 2.0)), b = t(vec2(0.0, 2.0)), c = t(vec2(2.0, 2.0));
        vec3 d = t(vec2(-2.0, 0.0)), e = t(vec2(0.0, 0.0)), f = t(vec2(2.0, 0.0));
        vec3 g = t(vec2(-2.0, -2.0)), h = t(vec2(0.0, -2.0)), i = t(vec2(2.0, -2.0));
        vec3 j = t(vec2(-1.0, 1.0)), k = t(vec2(1.0, 1.0));
        vec3 l = t(vec2(-1.0, -1.0)), m = t(vec2(1.0, -1.0));
        vec3 g0 = (j + k + l + m) * 0.25;
        vec3 g1 = (a + b + d + e) * 0.25;
        vec3 g2 = (b + c + e + f) * 0.25;
        vec3 g3 = (d + e + g + h) * 0.25;
        vec3 g4 = (e + f + h + i) * 0.25;
        vec3 plain = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
        vec3 w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
        float s0 = 1.0 / (1.0 + luma(g0)), s1 = 1.0 / (1.0 + luma(g1));
        float s2 = 1.0 / (1.0 + luma(g2)), s3 = 1.0 / (1.0 + luma(g3));
        float s4 = 1.0 / (1.0 + luma(g4));
        vec3 kar = (w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125) /
                   (s0 * 0.5 + (s1 + s2 + s3 + s4) * 0.125);
        gl_FragColor = vec4(mix(plain, kar, karis), 1.0);
      }
    `,
    uniforms: {tSrc: {value: null}, texel: {value: new THREE.Vector2()}, karis: {value: 0}},
    depthTest: false,
    depthWrite: false,
  });

// 3x3 tent upsample of the coarser level, added to the current level.
const upsampleMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tCoarse;
      uniform sampler2D tFine;
      uniform vec2 texel;
      uniform float radius;
      varying vec2 vUv;
      vec3 t(vec2 o) { return texture2D(tCoarse, vUv + texel * o * radius).rgb; }
      void main() {
        vec3 s = t(vec2(-1.0, 1.0)) + 2.0 * t(vec2(0.0, 1.0)) + t(vec2(1.0, 1.0))
               + 2.0 * t(vec2(-1.0, 0.0)) + 4.0 * t(vec2(0.0, 0.0)) + 2.0 * t(vec2(1.0, 0.0))
               + t(vec2(-1.0, -1.0)) + 2.0 * t(vec2(0.0, -1.0)) + t(vec2(1.0, -1.0));
        gl_FragColor = vec4(texture2D(tFine, vUv).rgb + s / 16.0, 1.0);
      }
    `,
    uniforms: {
      tCoarse: {value: null},
      tFine: {value: null},
      texel: {value: new THREE.Vector2()},
      radius: {value: 1},
    },
    depthTest: false,
    depthWrite: false,
  });

const compositeMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform vec2 resolution;
      uniform float exposure;
      uniform float bloomStrength;
      uniform float bloomNorm;
      uniform float vignette;
      uniform float chromatic;
      uniform float fade;
      uniform float seed;
      varying vec2 vUv;

      // Stephen Hill's ACES fitted curve (RRT + ODT), the same fit three.js uses.
      const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383,
                               0.04823, 0.01566, 0.83777);
      const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276,
                                -0.07367, -0.00605, 1.07602);
      vec3 rrtOdt(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 c) { return clamp(ACESOut * rrtOdt(ACESIn * c), 0.0, 1.0); }

      vec3 toSRGB(vec3 c) {
        vec3 lo = c * 12.92;
        vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
        return mix(lo, hi, step(vec3(0.0031308), c));
      }

      // Integer hash (deterministic, no sin() precision issues on software GL).
      float hash(vec3 p) {
        uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
        uint n = (q.x ^ q.y ^ q.z) * 1597334673u;
        return float(n) * (1.0 / 4294967295.0);
      }


      void main() {
        vec2 uv = vUv;
        vec2 centered = uv - 0.5;
        // Lateral chromatic aberration: radial, grows with the square of the radius.
        vec2 dir = centered * dot(centered, centered) * 4.0;
        vec2 ca = dir * chromatic / resolution * (resolution.y / 1080.0);
        vec3 hdr;
        hdr.r = texture2D(tScene, uv + ca).r;
        hdr.g = texture2D(tScene, uv).g;
        hdr.b = texture2D(tScene, uv - ca).b;
        hdr = mix(hdr, texture2D(tBloom, uv).rgb * bloomNorm, bloomStrength);

        vec3 col = aces(hdr * exposure);
        col = toSRGB(col);

        // Optical vignette (cos^4-like falloff), applied in display space.
        vec2 vc = centered * vec2(resolution.x / resolution.y, 1.0);
        float r2 = dot(vc, vc);
        float vig = 1.0 - vignette * smoothstep(0.1, 1.1, r2);
        col *= vig * fade;

        // TPDF dither, 1 LSB, removes banding in slow dark gradients.
        vec3 p = vec3(gl_FragCoord.xy, seed);
        float n1 = hash(p);
        float n2 = hash(p + vec3(17.0, 59.0, 101.0));
        col += (n1 + n2 - 1.0) / 255.0;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    uniforms: {
      tScene: {value: null},
      tBloom: {value: null},
      resolution: {value: new THREE.Vector2()},
      exposure: {value: 1},
      bloomStrength: {value: 0.04},
      bloomNorm: {value: 1},
      vignette: {value: 0.2},
      chromatic: {value: 0.5},
      fade: {value: 1},
      seed: {value: 0},
    },
    depthTest: false,
    depthWrite: false,
  });

export class FilmPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private width = 0;
  private height = 0;
  private readonly levels: number;
  private sceneRT!: THREE.WebGLRenderTarget;
  private accumRT!: THREE.WebGLRenderTarget;
  private blurRT!: THREE.WebGLRenderTarget;
  private readonly blurPass = new FullScreenPass(velocityBlurMaterial());
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly accumPass = new FullScreenPass(accumulateMaterial());
  private readonly downPass = new FullScreenPass(downsampleMaterial());
  private readonly upPass = new FullScreenPass(upsampleMaterial());
  private readonly compositePass = new FullScreenPass(compositeMaterial());

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number, levels = 6) {
    this.renderer = renderer;
    this.levels = levels;
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    this.sceneRT = halfFloatTarget(width, height, true);
    this.accumRT = halfFloatTarget(width, height);
    this.blurRT = halfFloatTarget(width, height);
    this.down = [];
    this.up = [];
    let w = width;
    let h = height;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.down.push(halfFloatTarget(w, h));
      this.up.push(halfFloatTarget(w, h));
    }
  }

  dispose(): void {
    this.sceneRT?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    this.accumRT?.dispose();
    this.blurRT?.dispose();
    this.down.forEach((t) => t.dispose());
    this.up.forEach((t) => t.dispose());
  }

  /**
   * Renders one output frame.
   * @param samples shutter sub-samples rendered and averaged (1 = single render)
   * @param prepare sets the whole scene state for sub-sample i of n
   * @param shutter cameras at shutter open/close for velocity motion blur (optional)
   */
  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    samples: number,
    prepare: (sampleIndex: number, sampleCount: number) => void,
    post: PostParams,
    shutter?: ShutterCameras,
  ): void {
    const {renderer} = this;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    let hdr: THREE.Texture;
    if (samples <= 1) {
      prepare(0, 1);
      renderer.setRenderTarget(this.sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      hdr = this.sceneRT.texture;
      if (shutter) {
        const bm = this.blurPass.material as THREE.ShaderMaterial;
        const vp = (c: THREE.Camera) => new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
        bm.uniforms.tColor.value = this.sceneRT.texture;
        bm.uniforms.tDepth.value = this.sceneRT.depthTexture;
        bm.uniforms.invViewProj.value.copy(vp(camera)).invert();
        bm.uniforms.viewProjOpen.value.copy(vp(shutter.open));
        bm.uniforms.viewProjClose.value.copy(vp(shutter.close));
        bm.uniforms.resolution.value.set(this.width, this.height);
        this.blurPass.render(renderer, this.blurRT);
        hdr = this.blurRT.texture;
      }
    } else {
      const acc = this.accumPass.material as THREE.ShaderMaterial;
      renderer.setRenderTarget(this.accumRT);
      renderer.clear();
      for (let i = 0; i < samples; i++) {
        prepare(i, samples);
        renderer.setRenderTarget(this.sceneRT);
        renderer.clear();
        renderer.render(scene, camera);
        acc.uniforms.tSrc.value = this.sceneRT.texture;
        acc.uniforms.weight.value = 1 / samples;
        renderer.autoClear = false;
        this.accumPass.render(renderer, this.accumRT);
        renderer.autoClear = true;
      }
      hdr = this.accumRT.texture;
    }

    // Bloom pyramid.
    const dm = this.downPass.material as THREE.ShaderMaterial;
    let src = hdr;
    let sw = this.width;
    let sh = this.height;
    for (let i = 0; i < this.levels; i++) {
      dm.uniforms.tSrc.value = src;
      dm.uniforms.texel.value.set(1 / sw, 1 / sh);
      dm.uniforms.karis.value = i === 0 ? 1 : 0;
      this.downPass.render(renderer, this.down[i]);
      src = this.down[i].texture;
      sw = this.down[i].width;
      sh = this.down[i].height;
    }
    const um = this.upPass.material as THREE.ShaderMaterial;
    let coarse = this.down[this.levels - 1].texture;
    let cw = this.down[this.levels - 1].width;
    let ch = this.down[this.levels - 1].height;
    for (let i = this.levels - 2; i >= 0; i--) {
      um.uniforms.tCoarse.value = coarse;
      um.uniforms.tFine.value = this.down[i].texture;
      um.uniforms.texel.value.set(1 / cw, 1 / ch);
      this.upPass.render(renderer, this.up[i]);
      coarse = this.up[i].texture;
      cw = this.up[i].width;
      ch = this.up[i].height;
    }

    const cm = this.compositePass.material as THREE.ShaderMaterial;
    cm.uniforms.tScene.value = hdr;
    cm.uniforms.tBloom.value = this.up[0].texture;
    // The pyramid sums `levels` bands; normalise so bloom has the scene's energy.
    cm.uniforms.bloomNorm.value = 1 / this.levels;
    cm.uniforms.resolution.value.set(this.width, this.height);
    cm.uniforms.exposure.value = post.exposure;
    cm.uniforms.bloomStrength.value = post.bloomStrength;
    cm.uniforms.vignette.value = post.vignette;
    cm.uniforms.chromatic.value = post.chromatic;
    cm.uniforms.fade.value = post.fade;
    cm.uniforms.seed.value = post.seed;
    this.compositePass.render(renderer, null);
  }
}

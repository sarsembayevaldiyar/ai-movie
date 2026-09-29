import * as THREE from 'three';

// The Sun as a camera-facing billboard far behind the planet (depth-tested, so the
// planet limb occludes the disk exactly). HDR disk with limb darkening, a compact
// veiling-glare halo (falls off as r^-3, so it never reads as a flat white ball),
// a short, delicate 6-spoke diffraction star, and a window that reaches zero well
// inside the billboard edge. `glow` scales the halo with the visible fraction of
// the disk.

export const createSun = () => {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: {value: new THREE.Vector3(1, 0, 0)},
      radiance: {value: 900},
      tint: {value: new THREE.Vector3(1, 0.96, 0.9)},
      diskRad: {value: 0.0085}, // angular radius (rad), ~0.5 deg
      extent: {value: 0.3}, // billboard half-size (rad)
      glow: {value: 1},
    },
    vertexShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform float extent;
      varying vec2 vP;
      void main() {
        vec3 center = cameraPosition + normalize(sunDir) * 800.0;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float s = 800.0 * tan(extent);
        vec3 wp = center + (right * position.x + up * position.y) * s;
        vP = position.xy * extent;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float radiance, diskRad, extent, glow;
      uniform vec3 tint;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float edge = 1.0 - smoothstep(extent * 0.35, extent, r);
        float x = r / diskRad;
        float xd = clamp(x, 0.0, 1.0);
        float disk = (1.0 - smoothstep(0.9, 1.0, x)) * (0.45 + 0.55 * sqrt(1.0 - xd * xd));
        // Veiling glare: ~10 at the disk, ~0.3 at 6 disk radii, ~0.01 at 20.
        float q = 1.0 + (x * x) / 4.0;
        float halo = 0.0111 / (q * sqrt(q)) * glow;
        float ang = atan(vP.y, vP.x);
        float spokes = pow(abs(cos(ang * 3.0 + 0.35)), 240.0) * exp(-x / 3.5) * 0.0007 * glow;
        vec3 c = tint * radiance * (disk + (halo + spokes) * edge);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
};

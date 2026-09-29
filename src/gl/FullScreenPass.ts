import * as THREE from 'three';

// Minimal full-screen triangle pass. One oversized triangle avoids the diagonal
// seam of a two-triangle quad and is marginally cheaper on software GL.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
);
geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class FullScreenPass {
  private readonly mesh: THREE.Mesh;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  get material(): THREE.Material {
    return this.mesh.material as THREE.Material;
  }

  set material(value: THREE.Material) {
    this.mesh.material = value;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh as unknown as THREE.Object3D, camera);
  }
}

// Shared vertex shader for all post passes: passes uv through.
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

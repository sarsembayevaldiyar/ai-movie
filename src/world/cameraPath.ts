import * as THREE from 'three';
import {CubicSpline} from '../math/spline';
import {DEG, geoToVec3} from '../math/geo';

// Camera rig in the Earth-fixed frame, parametrised like a map fly-over camera:
//   target (lat, lon, radius) -> the point we frame
//   distance, heading (deg from north the camera looks towards), pitch (deg below
//   horizontal), roll, pan (compositional off-centre framing), vertical fov.
// Every channel is a C2 clamped cubic spline over time, so position, velocity and
// acceleration are continuous and the move starts and ends at rest.

export interface CamKey {
  t: number;
  lat: number;
  lon: number;
  tr: number; // target radius (0 = Earth centre, 1 = surface)
  dist: number; // camera distance from the target
  heading: number;
  pitch: number;
  roll: number;
  panX: number; // deg, positive = look right
  panY: number; // deg, positive = look up
  fov: number;
}

const CHANNELS = ['lat', 'lon', 'tr', 'logDist', 'heading', 'pitch', 'roll', 'panX', 'panY', 'fov'] as const;
type Channel = (typeof CHANNELS)[number];

export class CameraPath {
  private readonly splines: Record<Channel, CubicSpline>;

  constructor(keys: CamKey[]) {
    const t = keys.map((k) => k.t);
    const val = (c: Channel, k: CamKey) => (c === 'logDist' ? Math.log(k.dist) : k[c as keyof CamKey]);
    this.splines = Object.fromEntries(
      CHANNELS.map((c) => [c, new CubicSpline(t, keys.map((k) => val(c, k)))]),
    ) as Record<Channel, CubicSpline>;
  }

  sample(t: number) {
    const s = this.splines;
    return {
      lat: s.lat.at(t),
      lon: s.lon.at(t),
      tr: s.tr.at(t),
      dist: Math.exp(s.logDist.at(t)),
      heading: s.heading.at(t),
      pitch: s.pitch.at(t),
      roll: s.roll.at(t),
      panX: s.panX.at(t),
      panY: s.panY.at(t),
      fov: s.fov.at(t),
    };
  }

  /** Writes position/orientation/fov into `camera` for time t. */
  apply(camera: THREE.PerspectiveCamera, t: number, aspect: number): void {
    const p = this.sample(t);
    const up = geoToVec3(p.lat, p.lon, 1);
    const target = up.clone().multiplyScalar(p.tr);
    // Local tangent frame at the target's geographic position.
    const north = new THREE.Vector3(0, 1, 0).sub(up.clone().multiplyScalar(up.y));
    if (north.lengthSq() < 1e-8) north.set(1, 0, 0);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const h = p.heading * DEG;
    const pitch = p.pitch * DEG;
    const forwardH = east.clone().multiplyScalar(Math.sin(h)).add(north.clone().multiplyScalar(Math.cos(h)));
    // Direction from target to camera: behind (opposite heading) and above.
    const offset = forwardH
      .clone()
      .multiplyScalar(-Math.cos(pitch))
      .add(up.clone().multiplyScalar(Math.sin(pitch)));
    camera.position.copy(target).add(offset.multiplyScalar(p.dist));

    // Orientation: look at target with the local up, then roll and compositional pan.
    // Camera up lies in the (up, heading) plane: exactly `up` when level, the heading
    // direction when looking straight down. Continuous in pitch (no degeneracy).
    const camUp = up
      .clone()
      .multiplyScalar(Math.cos(pitch))
      .add(forwardH.clone().multiplyScalar(Math.sin(pitch)))
      .normalize();
    const m = new THREE.Matrix4().lookAt(camera.position, target, camUp);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.roll * DEG);
    const pan = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.panY * DEG, -p.panX * DEG, 0, 'YXZ'));
    camera.quaternion.copy(q).multiply(roll).multiply(pan);

    camera.fov = p.fov;
    camera.aspect = aspect;
    // Depth range per shot: near plane scales with altitude above the surface.
    const alt = Math.max(1e-4, camera.position.length() - 1);
    camera.near = THREE.MathUtils.clamp(alt * 0.25, 0.0005, 0.5);
    camera.far = 2000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
}

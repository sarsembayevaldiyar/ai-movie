// Prints the camera path diagnostics used to tune src/world/keyframes.ts:
// altitude, speed, angular speed, sun elevation above the limb, where the Earth
// and Astana land in frame. Run: npx tsx tools/camera_report.ts [step]
import * as THREE from 'three';
import {CameraPath} from '../src/world/cameraPath';
import {CAMERA_KEYS, SUN_DECLINATION, subsolarLon} from '../src/world/keyframes';
import {geoToVec3, DEG} from '../src/math/geo';

const step = Number(process.argv[2] ?? 1);
const path = new CameraPath(CAMERA_KEYS);
const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.001, 2000);
const astana = geoToVec3(51.18, 71.43, 1);
const fmt = (v: number, w = 7, d = 2) => v.toFixed(d).padStart(w);

let prevPos: THREE.Vector3 | null = null;
let prevFwd: THREE.Vector3 | null = null;
let prevVel: THREE.Vector3 | null = null;
console.log('    t    alt   speed  dAcc  rot/s  sunLimb  earthX earthY earthR   astX   astY vis');
for (let t = 0; t <= 90 + 1e-9; t += step) {
  path.apply(cam, t, 16 / 9);
  const pos = cam.position.clone();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const sun = geoToVec3(SUN_DECLINATION, subsolarLon(t), 1);
  const toC = pos.clone().negate().normalize();
  const d = pos.length();
  const limb = Math.asin(Math.min(1, 1 / d));
  const sunLimb = (Math.acos(THREE.MathUtils.clamp(toC.dot(sun), -1, 1)) - limb) / DEG;
  const c = new THREE.Vector3(0, 0, 0).project(cam);
  const a = astana.clone().project(cam);
  const astVisible = astana.clone().sub(pos).dot(astana) < 0; // facing the camera
  const vel = prevPos ? pos.clone().sub(prevPos).divideScalar(step) : new THREE.Vector3();
  const acc = prevVel ? vel.clone().sub(prevVel).divideScalar(step).length() : 0;
  const rot = prevFwd ? Math.acos(THREE.MathUtils.clamp(fwd.dot(prevFwd), -1, 1)) / DEG / step : 0;
  console.log(
    `${fmt(t, 5, 1)} ${fmt(d - 1, 7, 3)} ${fmt(vel.length(), 6, 3)} ${fmt(acc, 5, 2)} ${fmt(rot, 6, 1)} ${fmt(sunLimb, 7, 1)}` +
      ` ${fmt(c.x)} ${fmt(c.y)} ${fmt(limb / DEG, 6, 1)} ${fmt(a.x)} ${fmt(a.y)} ${astVisible ? 'yes' : ' - '}`,
  );
  prevPos = pos;
  prevFwd = fwd;
  prevVel = vel;
}

import * as THREE from 'three';

// Earth-fixed frame, Earth radius = 1:
//   +Y = north pole, +X = (lat 0, lon 0), -Z = (lat 0, lon 90 E).
// This matches three.js SphereGeometry UVs with an equirectangular texture
// (u = 0.5 at lon 0, u increases eastwards).

export const DEG = Math.PI / 180;

export const geoToVec3 = (latDeg: number, lonDeg: number, radius = 1, out = new THREE.Vector3()) => {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return out.set(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  );
};

export const vec3ToGeo = (v: THREE.Vector3): {lat: number; lon: number; r: number} => {
  const r = v.length();
  return {
    lat: Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) / DEG,
    lon: Math.atan2(-v.z, v.x) / DEG,
    r,
  };
};

/** Points along the great circle a -> b (unit vectors), lifted by height(s), s in [0,1]. */
export const greatCircle = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  segments: number,
  height: (s: number) => number = () => 0,
): THREE.Vector3[] => {
  const ua = a.clone().normalize();
  const ub = b.clone().normalize();
  const omega = Math.acos(THREE.MathUtils.clamp(ua.dot(ub), -1, 1));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    let p: THREE.Vector3;
    if (omega < 1e-6) {
      p = ua.clone();
    } else {
      const k0 = Math.sin((1 - s) * omega) / Math.sin(omega);
      const k1 = Math.sin(s * omega) / Math.sin(omega);
      p = ua.clone().multiplyScalar(k0).add(ub.clone().multiplyScalar(k1));
    }
    pts.push(p.normalize().multiplyScalar(1 + height(s)));
  }
  return pts;
};

/** Angular distance in radians between two directions. */
export const angleBetween = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1));

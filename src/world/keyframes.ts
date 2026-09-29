import type {CamKey} from './cameraPath';

// One continuous camera move for the whole film (see docs/STORYBOARD.md).
// tr = 0 frames the Earth centre (space shots), tr = 1 frames a surface point.
// Longitudes/headings are kept continuous (no wrap jumps between keys).
const K = (
  t: number, lat: number, lon: number, tr: number, dist: number, heading: number, pitch: number,
  panX: number, panY: number, fov: number, roll = 0,
): CamKey => ({t, lat, lon, tr, dist, heading, pitch, roll, panX, panY, fov});

export const CAMERA_KEYS: CamKey[] = [
  // Scene 1: deep space on the anti-solar axis (the planet eclipses the Sun),
  // the planet below the frame, slowly entering lower-left. Screen-up = west.
  K(0, -9, 129, 0, 7.2, 270, 90, 10, 34, 32),
  K(6, -7, 126, 0, 5.8, 270, 90, 12, 25, 33),
  // Scene 2: drifting off the axis to the north-west: sunrise over the limb (14 s).
  K(10, -3, 121, 0, 4.2, 272, 90, 13, 19, 34),
  K(14, 3, 113, 0, 3.1, 275, 90, 15, 15, 36),
  K(18, 18, 100, 0, 2.4, 268, 90, 10, 10, 38),
  K(22, 33, 88, 0, 1.9, 255, 90, 5, 5, 38),
  K(24.5, 42, 78, 0.5, 1.3, 245, 76, 2, 2, 37),
  // Scene 3: towards Kazakhstan, border, Astana.
  K(27, 48, 68, 1, 0.9, 235, 58, 0, 0, 36),
  K(31, 51.18, 71.43, 1, 0.55, 220, 62, 0, 0, 34),
  K(33, 51.18, 71.43, 1, 0.43, 217, 66, 0, 0, 33),
  K(34.6, 51.18, 71.43, 1, 0.2, 214, 70, 0, 0, 34),
  K(35.6, 51.18, 71.43, 1, 0.05, 212, 71, 0, 0, 37),
  // Scene 4: dive through the cloud bank, rise over the network.
  K(36.4, 51.18, 71.43, 1, 0.0155, 210, 72, 0, 0, 40),
  K(38.6, 51.18, 71.43, 1, 0.06, 204, 58, 0, 0, 38),
  K(40.5, 51.0, 71.0, 1, 0.2, 202, 52, 0, 0, 36),
  K(43, 49.5, 70, 1, 0.38, 204, 49, 0, 0, 34),
  // Scene 5: theses over Kazakhstan, then up to the globe.
  K(48, 51.18, 71.43, 1, 0.36, 188, 58, 0, 0, 34),
  K(54, 48.5, 68.5, 1, 0.62, 200, 50, 0, 0, 34),
  // T4: low, side-on view; the growth curve rises to the right of frame.
  K(57.5, 51.18, 71.43, 1, 0.52, 200, 17, -9, 12, 34),
  K(61.5, 51.18, 71.43, 1, 0.6, 212, 15, -10, 13, 34),
  // T5: spiral pull-out to the globe (north ends up at the top of frame).
  K(66.5, 44, 78, 0.6, 2.2, 290, 72, -12, 0, 38),
  K(72, 42, 72, 0, 2.9, 360, 90, -25, 2, 36),
  // Scene 6: the brand-cover composition: planet low-left, glow, two orbits.
  K(80, 32, 50, 0, 2.3, 360, 90, 28, 16, 34),
  K(90, 31, 48, 0, 2.4, 360, 90, 28.5, 17, 34),
];

// Sun: fixed in the inertial frame; in the Earth frame the subsolar point moves
// west at OMEGA deg/s (cinematic Earth rotation).
export const SUN_DECLINATION = 10;
export const OMEGA = 0.35;
export const subsolarLon = (t: number) => -60 - OMEGA * (t - 30);

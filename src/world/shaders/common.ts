// Shared GLSL snippets. All lighting is in linear HDR units.

export const GLSL_CONSTANTS = /* glsl */ `
#define PI 3.14159265359
#define R_PLANET 1.0
`;

// Analytic ray/sphere intersection. Returns (t_near, t_far); t_far < 0 = miss.
export const GLSL_RAY_SPHERE = /* glsl */ `
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
`;

// Integer hash noise (stable on software GL) + value noise / fbm in 3D.
export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p) {
  uvec3 q = uvec3(ivec3(floor(p)) + ivec3(32768)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint n = (q.x ^ q.y ^ q.z) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash13(i), b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0)), d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0)), f1 = hash13(i + vec3(1.0, 0.0, 1.0));
  float g = hash13(i + vec3(0.0, 1.0, 1.0)), h = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, f1, f.x), mix(g, h, f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / n;
}
`;

// Chapman-function optical depth approximation (Schueler, GPU Pro 3) for an
// exponential atmosphere. x = r / H, mu = cos(zenith angle).
export const GLSL_CHAPMAN = /* glsl */ `
float chapmanUpper(float x, float mu) {
  float c = sqrt(PI * x * 0.5);
  return c / ((c - 1.0) * mu + 1.0);
}
float chapman(float x, float mu) {
  if (mu >= 0.0) return chapmanUpper(x, mu);
  float s = sqrt(max(0.0, 1.0 - mu * mu));
  float c = sqrt(PI * x * s * 0.5);
  return 2.0 * c * exp(min(x - x * s, 60.0)) - chapmanUpper(x, -mu);
}
// Optical depth from radius r towards direction with cos-zenith mu, to space.
float opticalDepth(float r, float mu, float H) {
  float h = max(r - R_PLANET, 0.0);
  return H * exp(-h / H) * chapman(r / H, mu);
}
`;

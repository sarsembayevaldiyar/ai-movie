#!/usr/bin/env python3
"""Builds every raster/vector asset the film needs, from public-domain sources only.

Sources (see docs/ASSETS.md):
  * NASA Blue Marble (shaded relief + bathymetry) and NASA Black Marble (night lights),
    served as EPSG:3857 tiles by the npm packages @freetiler/nasa-bluemarble and
    @freetiler/nasa-blackmarble (zoom 0-7) and their GitHub mirrors (zoom 8).
    NASA imagery is public domain / NASA open data policy.
  * Natural Earth 1:10m vectors (public domain) from github.com/nvkelso/natural-earth-vector.
  * Procedural clouds, generated here from a fixed seed.

Outputs (runtime; intermediates such as the raw night maps live in .asset-cache/):
  public/textures/earth_day_8k.jpg        equirectangular 8192x4096, sRGB (Blue Marble)
  public/textures/earth_lw_8k.png         R = night lights (Black Marble), G = water mask
  public/textures/kz_day.jpg              regional patch, lon 45..90 E, lat 39..57 N
  public/textures/kz_lw.png               same extent, lights + water
  public/textures/earth_clouds_4k.png     procedural cloud coverage, linear
  public/textures/nebula_2k.png           procedural nebula (brand violet/blue)
  src/data/kazakhstan.json                border rings [[lon, lat], ...]
  src/data/places.json                    hub cities (Natural Earth populated places)

Usage: python3 tools/build_assets.py  (idempotent; downloads are cached)
"""
from __future__ import annotations

import concurrent.futures as cf
import io
import json
import math
import os
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get('ASSET_CACHE', ROOT / '.asset-cache'))
TEX = ROOT / 'public' / 'textures'
DATA = ROOT / 'src' / 'data'

GLOBAL_W, GLOBAL_H = 8192, 4096
# Regional patch: Kazakhstan with margin. 182 px/deg ~ Web Mercator zoom 8 at the equator.
KZ_LON0, KZ_LON1, KZ_LAT0, KZ_LAT1 = 45.0, 90.0, 39.0, 57.0
KZ_PPD = 182
NE_RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def log(*a):
    print(*a, flush=True)


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            dest.write_bytes(data)
            return dest
        except Exception as e:  # network hiccup: retry with backoff
            if attempt == 4:
                raise RuntimeError(f'failed {url}: {e}')
            import time
            time.sleep(2 ** attempt)
    return dest


def npm_tiles(pkg: str, version: str) -> Path:
    """Unpacks an npm tile package (zoom 0-7) into the cache and returns the tiles dir."""
    out = CACHE / pkg.replace('/', '_')
    tiles = out / 'package' / 'tiles'
    if tiles.exists():
        return tiles
    out.mkdir(parents=True, exist_ok=True)
    log(f'npm pack {pkg}@{version}')
    subprocess.run(['npm', 'pack', f'{pkg}@{version}', '--silent'], cwd=out, check=True,
                   stdout=subprocess.DEVNULL)
    tgz = next(out.glob('*.tgz'))
    with tarfile.open(tgz) as t:
        t.extractall(out)
    tgz.unlink()
    return tiles


def merc_y(lat_deg: np.ndarray) -> np.ndarray:
    """Web Mercator y in [0, 1] (0 = north edge) for latitude in degrees."""
    lat = np.radians(np.clip(lat_deg, -85.05112878, 85.05112878))
    return (1 - np.log(np.tan(lat) + 1 / np.cos(lat)) / math.pi) / 2


def load_mosaic(tiles_dir: Path, z: int, x0: int, x1: int, y0: int, y1: int,
                down: int = 1) -> np.ndarray:
    """Loads tiles [x0, x1) x [y0, y1) at zoom z into one float32 array (sRGB 0..1)."""
    ts = 256 // down
    mosaic = np.zeros(((y1 - y0) * ts, (x1 - x0) * ts, 3), np.float32)

    def load(xy):
        x, y = xy
        p = tiles_dir / str(z) / str(x) / f'{y}.jpeg'
        im = Image.open(p).convert('RGB')
        if down > 1:
            im = im.resize((ts, ts), Image.BOX)
        return x, y, np.asarray(im, np.float32) / 255.0

    jobs = [(x, y) for x in range(x0, x1) for y in range(y0, y1)]
    with cf.ThreadPoolExecutor(8) as ex:
        for x, y, a in ex.map(load, jobs):
            mosaic[(y - y0) * ts:(y - y0 + 1) * ts, (x - x0) * ts:(x - x0 + 1) * ts] = a
    return mosaic


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def remap_rows(mosaic: np.ndarray, src_y: np.ndarray) -> np.ndarray:
    """Resamples rows of a mosaic at fractional row coordinates, in linear light.
    Downsampling in y uses a box prefilter sized to the local scale to avoid aliasing."""
    lin = srgb_to_linear(mosaic)
    h = lin.shape[0]
    out = np.zeros((len(src_y), lin.shape[1], 3), np.float32)
    # local footprint (source rows per output row)
    fp = np.abs(np.gradient(src_y))
    csum = np.concatenate([np.zeros((1,) + lin.shape[1:], np.float64), np.cumsum(lin, axis=0,
                                                                                  dtype=np.float64)])
    for i, (y, f) in enumerate(zip(src_y, fp)):
        if f > 1.0:  # box filter over the footprint
            a = int(np.clip(math.floor(y - f / 2), 0, h - 1))
            b = int(np.clip(math.ceil(y + f / 2), a + 1, h))
            out[i] = ((csum[b] - csum[a]) / (b - a)).astype(np.float32)
        else:  # bilinear
            y0 = int(np.clip(math.floor(y - 0.5), 0, h - 1))
            y1 = min(y0 + 1, h - 1)
            t = np.clip(y - 0.5 - y0, 0, 1)
            out[i] = lin[y0] * (1 - t) + lin[y1] * t
    return linear_to_srgb(out)


def resize_width(img: np.ndarray, width: int) -> np.ndarray:
    """Area/bicubic resize in x only, in linear light."""
    h = img.shape[0]
    lin = srgb_to_linear(img)
    chans = []
    for c in range(3):
        im = Image.fromarray(lin[..., c].astype(np.float32), mode='F')
        chans.append(np.asarray(im.resize((width, h), Image.BOX if width < img.shape[1]
                                          else Image.BICUBIC), np.float32))
    return linear_to_srgb(np.stack(chans, -1))


def save_jpg(arr: np.ndarray, path: Path, quality=92):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        path, quality=quality, subsampling=0, optimize=True)
    log(f'wrote {path.relative_to(ROOT)} {path.stat().st_size / 1e6:.1f} MB')


def build_global(tiles_dir: Path, out: Path):
    if out.exists():
        log(f'skip {out.name}')
        return
    z, n = 7, 128
    log(f'global mosaic from {tiles_dir.parent.parent.name} z{z}')
    mosaic = load_mosaic(tiles_dir, z, 0, n, 0, n, down=4)  # 8192 x 8192 mercator
    lat = 90 - (np.arange(GLOBAL_H) + 0.5) / GLOBAL_H * 180
    src_y = merc_y(lat) * mosaic.shape[0]
    eq = remap_rows(mosaic, src_y)
    if eq.shape[1] != GLOBAL_W:
        eq = resize_width(eq, GLOBAL_W)
    eq = fill_poles(eq, lat)
    save_jpg(eq, out)


def fill_poles(eq: np.ndarray, lat: np.ndarray, edge=84.0, full=85.0) -> np.ndarray:
    """Web Mercator stops at +-85.05 deg: replace the smeared polar caps with the mean
    colour of the last valid ring, blended smoothly between `edge` and `full` degrees."""
    out = eq.copy()
    for sign in (1, -1):
        ring = np.argmin(np.abs(lat - sign * edge))
        mean = eq[ring].mean(0)
        t = np.clip((np.abs(lat) - edge) / (full - edge), 0, 1) * (np.sign(lat) == sign)
        t = t * t * (3 - 2 * t)
        out = out * (1 - t[:, None, None]) + mean[None, None, :] * t[:, None, None]
    return out


def build_lights(src: Path, out: Path):
    """Isolates artificial lights from the Black Marble composite (which also contains a
    bluish moonlit base layer). Output: single channel, sRGB-encoded intensity."""
    if out.exists():
        log(f'skip {out.name}')
        return
    im = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255.0
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    lights = np.clip((np.minimum(r, g) - 0.45 * b - 0.03) / 0.6, 0, 1)
    Image.fromarray((lights * 255 + 0.5).astype(np.uint8)).save(out, optimize=True)
    log(f'wrote {out.relative_to(ROOT)}')


def build_lights_water(lights: Path, water: Path, out: Path):
    """Packs night lights (R) and the water mask (G) into one texture: one fetch instead
    of two in the Earth shader (software GL is fetch-bound)."""
    if out.exists():
        log(f'skip {out.name}')
        return
    L = Image.open(lights).convert('L')
    Wm = Image.open(water).convert('L')
    if Wm.size != L.size:
        Wm = Wm.resize(L.size, Image.BILINEAR)
    z = Image.new('L', L.size, 0)
    Image.merge('RGB', (L, Wm, z)).save(out, optimize=True)
    log(f'wrote {out.relative_to(ROOT)}')


def fetch_z8_tiles(repo: str, x0, x1, y0, y1) -> Path:
    base = CACHE / f'{repo.replace("/", "_")}_z8'
    jobs = []
    for x in range(x0, x1):
        for y in range(y0, y1):
            dest = base / '8' / str(x) / f'{y}.jpeg'
            url = f'https://raw.githubusercontent.com/{repo}/main/tiles/8/{x}/{y}.jpeg'
            jobs.append((url, dest))
    log(f'z8 tiles {repo}: {len(jobs)}')
    with cf.ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda j: fetch(*j), jobs))
    return base


def build_regional(repo: str, out: Path):
    if out.exists():
        log(f'skip {out.name}')
        return
    n = 256
    x0 = int(math.floor((KZ_LON0 + 180) / 360 * n))
    x1 = int(math.ceil((KZ_LON1 + 180) / 360 * n))
    y0 = int(math.floor(merc_y(np.array([KZ_LAT1]))[0] * n))
    y1 = int(math.ceil(merc_y(np.array([KZ_LAT0]))[0] * n))
    tiles = fetch_z8_tiles(repo, x0, x1, y0, y1)
    mosaic = load_mosaic(tiles, 8, x0, x1, y0, y1)
    W = int(round((KZ_LON1 - KZ_LON0) * KZ_PPD))
    H = int(round((KZ_LAT1 - KZ_LAT0) * KZ_PPD))
    lat = KZ_LAT1 - (np.arange(H) + 0.5) / H * (KZ_LAT1 - KZ_LAT0)
    src_y = merc_y(lat) * n * 256 - y0 * 256
    eq = remap_rows(mosaic, src_y)
    # crop/resample x to the exact longitude window
    lon_px0 = ((KZ_LON0 + 180) / 360 * n - x0) * 256
    lon_px1 = ((KZ_LON1 + 180) / 360 * n - x0) * 256
    img = Image.fromarray((np.clip(eq, 0, 1) * 255 + 0.5).astype(np.uint8))
    img = img.crop((int(round(lon_px0)), 0, int(round(lon_px1)), H)).resize((W, H), Image.LANCZOS)
    save_jpg(np.asarray(img, np.float32) / 255, out)


def geo_to_px(lon, lat, W, H, lon0=-180.0, lon1=180.0, lat0=-90.0, lat1=90.0):
    x = (np.asarray(lon) - lon0) / (lon1 - lon0) * W
    y = (lat1 - np.asarray(lat)) / (lat1 - lat0) * H
    return x, y


def rasterize_land(features, W, H, extent=None, ss=2):
    """Rasterizes land polygons; returns water mask (1 = water) as uint8."""
    lon0, lon1, lat0, lat1 = extent or (-180.0, 180.0, -90.0, 90.0)
    img = Image.new('L', (W * ss, H * ss), 0)
    d = ImageDraw.Draw(img)
    for f in features:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for poly in polys:
            for k, ring in enumerate(poly):
                r = np.asarray(ring)
                if extent and (r[:, 0].max() < lon0 or r[:, 0].min() > lon1 or
                               r[:, 1].max() < lat0 or r[:, 1].min() > lat1):
                    continue
                x, y = geo_to_px(r[:, 0], r[:, 1], W * ss, H * ss, lon0, lon1, lat0, lat1)
                d.polygon(list(zip(x.tolist(), y.tolist())), fill=0 if k else 255)
    img = img.resize((W, H), Image.BOX)
    return 255 - np.asarray(img)


def build_water():
    out_g = CACHE / 'earth_water_8k.png'
    out_r = CACHE / 'kz_water.png'
    if out_g.exists() and out_r.exists():
        log('skip water masks')
        return
    land = json.loads(fetch(NE_RAW + 'ne_10m_land.geojson', CACHE / 'ne_10m_land.geojson').read_text())
    lakes = json.loads(fetch(NE_RAW + 'ne_10m_lakes.geojson', CACHE / 'ne_10m_lakes.geojson').read_text())
    for out, W, H, ext in [(out_g, GLOBAL_W, GLOBAL_H, None),
                           (out_r, int((KZ_LON1 - KZ_LON0) * KZ_PPD) // 2,
                            int((KZ_LAT1 - KZ_LAT0) * KZ_PPD) // 2,
                            (KZ_LON0, KZ_LON1, KZ_LAT0, KZ_LAT1))]:
        water = rasterize_land(land['features'], W, H, ext)
        lake = 255 - rasterize_land(lakes['features'], W, H, ext)  # lakes as water
        water = np.maximum(water, lake)
        out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(water.astype(np.uint8)).save(out, optimize=True)
        log(f'wrote {out}')


# ---------------------------------------------------------------- procedural clouds
def value_noise_3d(p: np.ndarray, seed: int) -> np.ndarray:
    """Smooth value noise on integer lattice via hashing (deterministic)."""
    pi = np.floor(p).astype(np.int64)
    f = p - pi
    f = f * f * f * (f * (f * 6 - 15) + 10)

    def h(ix, iy, iz):
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        n = n ^ (n >> 16)
        return (n & 0xFFFFFF).astype(np.float32) / float(0xFFFFFF)

    x, y, z = pi[..., 0], pi[..., 1], pi[..., 2]
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    c000, c100 = h(x, y, z), h(x + 1, y, z)
    c010, c110 = h(x, y + 1, z), h(x + 1, y + 1, z)
    c001, c101 = h(x, y, z + 1), h(x + 1, y, z + 1)
    c011, c111 = h(x, y + 1, z + 1), h(x + 1, y + 1, z + 1)
    x00 = c000 + (c100 - c000) * fx
    x10 = c010 + (c110 - c010) * fx
    x01 = c001 + (c101 - c001) * fx
    x11 = c011 + (c111 - c011) * fx
    y0 = x00 + (x10 - x00) * fy
    y1 = x01 + (x11 - x01) * fy
    return y0 + (y1 - y0) * fz


def fbm(p, seed, octaves, lac=2.02, gain=0.5):
    s = np.zeros(p.shape[:-1], np.float32)
    a, norm = 1.0, 0.0
    q = p.copy()
    for o in range(octaves):
        s += a * value_noise_3d(q, seed + o * 101)
        norm += a
        a *= gain
        q = q * lac
    return s / norm


def build_clouds(out: Path, W=4096, H=2048, seed=1771):
    """Procedural global cloud coverage with a plausible climatology:
    scattered convection on the ITCZ, clear subtropical belts, long frontal bands
    in the mid-latitude storm tracks. Deterministic (fixed seed)."""
    if out.exists():
        log(f'skip {out.name}')
        return
    log('procedural clouds (numpy, a few minutes)')
    res = np.zeros((H, W), np.float32)
    lon = (np.arange(W) + 0.5) / W * 2 * math.pi - math.pi
    for r0 in range(0, H, 64):
        rows = np.arange(r0, min(H, r0 + 64))
        lat = math.pi / 2 - (rows + 0.5) / H * math.pi
        LAT, LON = np.meshgrid(lat, lon, indexing='ij')
        P = np.stack([np.cos(LAT) * np.cos(LON), np.sin(LAT), -np.cos(LAT) * np.sin(LON)], -1)
        P = P.astype(np.float32)
        la = np.degrees(np.abs(LAT)).astype(np.float32)
        # zonal stretch (jet streams): squash the noise domain along the local east vector
        east = np.stack([-np.sin(LON), np.zeros_like(LON), -np.cos(LON)], -1).astype(np.float32)
        stretch = (0.55 * np.exp(-((la - 50) / 15) ** 2))[..., None]
        Pz = P - east * (P * east).sum(-1, keepdims=True) * stretch
        # two-level domain warp -> swirls and comma shapes
        w1 = np.stack([fbm(Pz * 1.7 + 3.7, seed + 7, 4), fbm(Pz * 1.7 - 1.3, seed + 11, 4),
                       fbm(Pz * 1.7 + 9.1, seed + 13, 4)], -1) - 0.5
        w2 = np.stack([fbm(Pz * 3.9 + w1 * 2.0 + 1.1, seed + 17, 4),
                       fbm(Pz * 3.9 + w1 * 2.0 - 7.7, seed + 19, 4),
                       fbm(Pz * 3.9 + w1 * 2.0 + 4.4, seed + 23, 4)], -1) - 0.5
        q = Pz * 2.6 + w1 * 1.4 + w2 * 0.7
        base = fbm(q, seed, 6)
        ridged = 1.0 - np.abs(fbm(Pz * 5.0 + w2 * 1.5, seed + 31, 4) * 2 - 1)  # frontal bands
        detail = fbm(P * 30.0 + w2 * 4.0, seed + 29, 4)
        fine = fbm(P * 90.0 + w1 * 6.0, seed + 37, 3)
        # ITCZ: many small convective cells instead of large decks
        cells = fbm(P * 22.0 + w2 * 2.0, seed + 41, 4)
        itcz = np.exp(-((la - 5) / 8) ** 2)
        midlat = np.exp(-((la - 50) / 18) ** 2)
        res[rows] = (base * (1 - 0.5 * itcz) + 0.30 * ridged * midlat + 0.18 * (detail - 0.5)
                     + 0.07 * (fine - 0.5) + 0.5 * itcz * (cells - 0.5))
    # Coverage climatology: threshold each latitude band at the quantile that gives the
    # target cloud fraction, interpolated smoothly across latitude (no row banding).
    lat_rows = 90 - (np.arange(H) + 0.5) / H * 180
    def target(la):
        la = abs(la)
        return (0.38 * np.exp(-((la - 4) / 8) ** 2) + 0.12 + 0.46 * np.exp(-((la - 55) / 13) ** 2)
                - 0.08 * np.exp(-((la - 25) / 7) ** 2) + 0.15 * np.exp(-((la - 72) / 10) ** 2))
    centers = np.linspace(-87.5, 87.5, 36)
    th = []
    for c in centers:
        band = np.abs(lat_rows - c) < 5
        th.append(np.quantile(res[band], 1 - np.clip(target(c), 0.02, 0.95)))
    th_rows = np.interp(lat_rows, centers, th)
    # Soft, translucent edges: a wide transition band plus internal density variation.
    c = np.clip((res - th_rows[:, None] + 0.035) / 0.13, 0, 1)
    c = c * c * (3 - 2 * c)
    lon = (np.arange(W) + 0.5) / W * 2 * math.pi - math.pi
    dens = np.zeros_like(res)
    for r0 in range(0, H, 128):
        rows = np.arange(r0, min(H, r0 + 128))
        lat = math.pi / 2 - (rows + 0.5) / H * math.pi
        LAT, LON = np.meshgrid(lat, lon, indexing='ij')
        P = np.stack([np.cos(LAT) * np.cos(LON), np.sin(LAT), -np.cos(LAT) * np.sin(LON)], -1)
        dens[rows] = fbm(P.astype(np.float32) * 60.0, seed + 53, 4)
    res = c * (0.62 + 0.55 * (dens - 0.5) * 2 * 0.5 + 0.2 * c)
    res = np.clip(res, 0, 1)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((res * 255 + 0.5).astype(np.uint8)).save(out, optimize=True)
    log(f'wrote {out.relative_to(ROOT)}')


def build_nebula(out: Path, W=2048, H=1024, seed=90210):
    """Faint procedural nebula for the deep-space background, in brand violet/blue
    (#4b3a8a, #1833da, #3e215b). Stored sRGB; the shader multiplies it by a tiny
    intensity, so it only lifts the black a few codes."""
    if out.exists():
        log(f'skip {out.name}')
        return
    log('procedural nebula')
    img = np.zeros((H, W, 3), np.float32)
    lon = (np.arange(W) + 0.5) / W * 2 * math.pi - math.pi
    cols = [np.array([0x4b, 0x3a, 0x8a]) / 255, np.array([0x18, 0x33, 0xda]) / 255,
            np.array([0x3e, 0x21, 0x5b]) / 255]
    cols = [srgb_to_linear(c) for c in cols]
    for r0 in range(0, H, 128):
        rows = np.arange(r0, min(H, r0 + 128))
        lat = math.pi / 2 - (rows + 0.5) / H * math.pi
        LAT, LON = np.meshgrid(lat, lon, indexing='ij')
        P = np.stack([np.cos(LAT) * np.cos(LON), np.sin(LAT), -np.cos(LAT) * np.sin(LON)], -1)
        P = P.astype(np.float32)
        w = np.stack([fbm(P * 2.0 + 5.1, seed + 1, 4), fbm(P * 2.0 - 2.3, seed + 2, 4),
                      fbm(P * 2.0 + 8.8, seed + 3, 4)], -1) - 0.5
        a = fbm(P * 2.2 + w * 2.2, seed, 6)
        b = fbm(P * 4.0 + w * 3.0, seed + 5, 5)
        # a broad galactic-plane-like band, tilted
        band_axis = np.array([0.35, 0.87, 0.35], np.float32)
        band_axis /= np.linalg.norm(band_axis)
        band = np.exp(-((P @ band_axis) / 0.32) ** 2)
        dens = np.clip((a - 0.45) * 2.4, 0, 1) ** 2 * (0.25 + 0.75 * band)
        dust = np.clip((b - 0.5) * 3.0, 0, 1)
        mix1 = np.clip(b * 1.5 - 0.3, 0, 1)[..., None]
        col = cols[0] * (1 - mix1) + cols[1] * mix1
        col = col * (1 - 0.5 * dust[..., None]) + cols[2] * 0.5 * dust[..., None]
        img[rows] = col * dens[..., None]
    img = img / max(1e-6, img.max())
    Image.fromarray((linear_to_srgb(img) * 255 + 0.5).astype(np.uint8)).save(out, optimize=True)
    log(f'wrote {out.relative_to(ROOT)}')


# ---------------------------------------------------------------- vectors
def build_vectors():
    DATA.mkdir(parents=True, exist_ok=True)
    kz_out = DATA / 'kazakhstan.json'
    if not kz_out.exists():
        adm = json.loads(fetch(NE_RAW + 'ne_10m_admin_0_countries.geojson',
                               CACHE / 'ne_10m_admin_0_countries.geojson').read_text())
        kz = next(f for f in adm['features'] if f['properties'].get('ADM0_A3') == 'KAZ')
        g = kz['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = [[[round(x, 4), round(y, 4)] for x, y in poly[0]] for poly in polys]
        rings.sort(key=len, reverse=True)
        kz_out.write_text(json.dumps({
            'source': 'Natural Earth 1:10m Admin 0 Countries (public domain), ADM0_A3=KAZ',
            'rings': rings}))
        log(f'wrote {kz_out.relative_to(ROOT)} rings={len(rings)} pts={sum(map(len, rings))}')

    pl_out = DATA / 'places.json'
    if not pl_out.exists():
        pp = json.loads(fetch(NE_RAW + 'ne_10m_populated_places_simple.geojson',
                              CACHE / 'ne_10m_populated_places_simple.geojson').read_text())
        feats = pp['features']
        # hub id -> (Natural Earth name candidates, ISO country)
        wanted = {
            'astana': (['Astana', 'Nur-Sultan', 'Nursultan', 'Akmola'], 'KAZ'),
            'uralsk': (['Oral', 'Uralsk'], 'KAZ'), 'atyrau': (['Atyrau'], 'KAZ'),
            'aktau': (['Aqtau', 'Aktau'], 'KAZ'), 'aktobe': (['Aqtobe', 'Aktobe'], 'KAZ'),
            'kostanay': (['Qostanay', 'Kostanay', 'Oostanay'], 'KAZ'),
            'petropavl': (['Petropavlovsk', 'Petropavl'], 'KAZ'),
            'kokshetau': (['Kokshetau', 'Kokchetav'], 'KAZ'),
            'pavlodar': (['Pavlodar'], 'KAZ'), 'karaganda': (['Qaraghandy', 'Karaganda'], 'KAZ'),
            'zhezkazgan': (['Zhezqazghan', 'Zhezkazgan'], 'KAZ'),
            'kyzylorda': (['Qyzylorda', 'Kyzylorda'], 'KAZ'),
            'turkistan': (['Turkistan', 'Turkestan'], 'KAZ'), 'shymkent': (['Shymkent'], 'KAZ'),
            'taraz': (['Taraz'], 'KAZ'), 'konaev': (['Kapshagay', 'Qapshaghay', 'Konaev'], 'KAZ'),
            'taldykorgan': (['Taldyqorghan', 'Taldykorgan'], 'KAZ'),
            'almaty': (['Almaty'], 'KAZ'), 'semey': (['Semey'], 'KAZ'),
            'oskemen': (['Oskemen', 'Ust-Kamenogorsk'], 'KAZ'),
            'paloalto': (['Palo Alto', 'San Jose', 'San Francisco'], 'USA'),
            'shanghai': (['Shanghai'], 'CHN'), 'dubai': (['Dubai'], 'ARE'),
            'kualalumpur': (['Kuala Lumpur'], 'MYS'),
        }
        places = {}
        for key, (names, iso) in wanted.items():
            hit = None
            for nm in names:
                for f in feats:
                    p = f['properties']
                    if p.get('adm0_a3') == iso and nm.lower() in {str(p.get('name', '')).lower(),
                                                                  str(p.get('nameascii', '')).lower()}:
                        hit = f
                        break
                if hit:
                    break
            if not hit:
                log(f'WARNING: {key} not found in Natural Earth populated places')
                continue
            lon, lat = hit['geometry']['coordinates']
            places[key] = {'name': hit['properties']['name'], 'lon': round(lon, 4),
                           'lat': round(lat, 4)}
        pl_out.write_text(json.dumps({
            'source': 'Natural Earth 1:10m Populated Places Simple (public domain)',
            'places': places}, ensure_ascii=False, indent=1))
        log(f'wrote {pl_out.relative_to(ROOT)} ({len(places)} places)')


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    build_vectors()
    day_tiles = npm_tiles('@freetiler/nasa-bluemarble', '1.0.17')
    night_tiles = npm_tiles('@freetiler/nasa-blackmarble', '1.0.14')
    build_global(day_tiles, TEX / 'earth_day_8k.jpg')
    build_global(night_tiles, CACHE / 'earth_night_8k.jpg')
    build_regional('freetiler/nasa-bluemarble', TEX / 'kz_day.jpg')
    build_regional('freetiler/nasa-blackmarble', CACHE / 'kz_night.jpg')
    build_lights(CACHE / 'earth_night_8k.jpg', CACHE / 'earth_lights_8k.png')
    build_lights(CACHE / 'kz_night.jpg', CACHE / 'kz_lights.png')
    build_water()
    build_lights_water(CACHE / 'earth_lights_8k.png', CACHE / 'earth_water_8k.png', TEX / 'earth_lw_8k.png')
    build_lights_water(CACHE / 'kz_lights.png', CACHE / 'kz_water.png', TEX / 'kz_lw.png')
    build_clouds(TEX / 'earth_clouds_4k.png')
    build_nebula(TEX / 'nebula_2k.png')
    log('done')


if __name__ == '__main__':
    sys.exit(main())

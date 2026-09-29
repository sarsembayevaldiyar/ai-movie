#!/usr/bin/env python3
"""Motion / flicker QA on a rendered frame sequence.

For every pair of consecutive frames it measures:
  * mean absolute difference (MAD) of luminance: jumps show up as spikes;
  * mean luminance: flicker shows up as high-frequency oscillation;
  * a coarse global motion estimate (phase correlation of downscaled frames).
A spike is a frame whose MAD exceeds 3.5x the local median (+ a floor), i.e. a
discontinuity that smooth camera motion cannot produce. Writes a PNG chart and a
text report.

Usage: python3 tools/qa_motion.py <frames_dir> <fps> <out_prefix>
"""
import glob
import sys

import numpy as np
from PIL import Image, ImageDraw

src, fps, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
files = sorted(glob.glob(f'{src}/*.jpeg') + glob.glob(f'{src}/*.png') + glob.glob(f'{src}/*.jpg'))
W, H = 240, 135


def load(f):
    im = Image.open(f).convert('L').resize((W, H), Image.BILINEAR)
    return np.asarray(im, np.float32) / 255.0


def shift(a, b):
    """Global translation between two frames via phase correlation (pixels @240px)."""
    fa = np.fft.fft2(a - a.mean())
    fb = np.fft.fft2(b - b.mean())
    r = fa * np.conj(fb)
    r /= np.abs(r) + 1e-9
    c = np.fft.ifft2(r).real
    y, x = np.unravel_index(np.argmax(c), c.shape)
    if y > H // 2:
        y -= H
    if x > W // 2:
        x -= W
    return x, y


prev = None
mad, lum, sx, sy = [], [], [], []
for f in files:
    cur = load(f)
    lum.append(cur.mean())
    if prev is not None:
        mad.append(np.abs(cur - prev).mean())
        x, y = shift(cur, prev)
        sx.append(x)
        sy.append(y)
    prev = cur
mad = np.array(mad)
lum = np.array(lum)
t = np.arange(len(mad)) / fps

med = np.array([np.median(mad[max(0, i - 15): i + 16]) for i in range(len(mad))])
spikes = np.where(mad > med * 3.5 + 0.004)[0]
# flicker: luminance second difference relative to its local scale
d2 = np.abs(np.diff(lum, 2))
flick = np.where(d2 > 0.012)[0]

lines = [f'frames: {len(files)} @ {fps} fps', f'MAD median {np.median(mad):.5f}, max {mad.max():.5f}']
lines.append(f'spikes (MAD > 3.5x local median): {len(spikes)}')
for i in spikes[:40]:
    lines.append(f'  t={t[i]:.3f}s  frame {i}->{i + 1}  MAD {mad[i]:.4f} (local median {med[i]:.4f})')
lines.append(f'luminance flicker events (|d2 lum| > 0.012): {len(flick)}')
for i in flick[:40]:
    lines.append(f'  t={(i + 1) / fps:.3f}s  d2 {d2[i]:.4f}')
open(out + '.txt', 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines[:12]))

# chart
CW, CH = 1800, 600
img = Image.new('RGB', (CW, CH), (12, 12, 14))
d = ImageDraw.Draw(img)
def plot(vals, color, scale, y0):
    pts = [(int(i / max(1, len(vals) - 1) * (CW - 20)) + 10, int(y0 - v * scale)) for i, v in enumerate(vals)]
    d.line(pts, fill=color, width=1)
plot(mad, (92, 180, 226), 180 / max(1e-6, mad.max()), 290)
plot(lum, (252, 183, 90), 180 / max(1e-6, lum.max()), 580)
for i in spikes:
    x = int(i / max(1, len(mad) - 1) * (CW - 20)) + 10
    d.line([(x, 100), (x, 300)], fill=(207, 69, 85), width=1)
for s in range(0, int(len(mad) / fps) + 1, 5):
    x = int(s * fps / max(1, len(mad) - 1) * (CW - 20)) + 10
    d.line([(x, 590), (x, 598)], fill=(128, 128, 128))
    d.text((x + 2, 300), f'{s}s', fill=(128, 128, 128))
d.text((12, 8), 'blue: frame-to-frame MAD (jumps = red markers)   orange: mean luminance (flicker)', fill=(200, 200, 200))
img.save(out + '.png')

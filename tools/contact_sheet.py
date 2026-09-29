#!/usr/bin/env python3
"""Assembles rendered preview frames into labelled contact sheets for review."""
import glob, sys
from PIL import Image, ImageDraw

src = sys.argv[1] if len(sys.argv) > 1 else 'out/preview'
times = [float(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else None
out = sys.argv[3] if len(sys.argv) > 3 else 'out/sheet'
files = sorted(glob.glob(f'{src}/*.png'))
W, H, cols = 480, 270, 4
per = 12
for s in range(0, len(files), per):
    chunk = files[s:s + per]
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new('RGB', (W * cols, H * rows), 'black')
    for j, f in enumerate(chunk):
        im = Image.open(f).convert('RGB').resize((W, H))
        d = ImageDraw.Draw(im)
        label = f't={times[s + j]}' if times else f.split('/')[-1]
        d.text((6, 4), label, fill=(255, 80, 80))
        sheet.paste(im, ((j % cols) * W, (j // cols) * H))
    sheet.save(f'{out}_{s // per}.png')
    print(f'{out}_{s // per}.png')

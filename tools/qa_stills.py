#!/usr/bin/env python3
"""QA stills: extracts frames from the final video (>= 3 per scene) and writes one
labelled sheet per scene (2 columns, 960x540 tiles) for docs/QA.md.

Usage: python3 tools/qa_stills.py <video.mp4> <out_dir>
Frames are decoded with Remotion's bundled ffmpeg (`npx remotion ffmpeg`), seeking
to exact frame times (t = frame / 60).
"""
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FPS = 60
SCENES = [
    ('1', 'Космос', 0, 10, [3.0, 6.5, 9.0, 9.9]),
    ('2', 'Земля, восход', 10, 22, [12.0, 14.6, 16.5, 20.0]),
    ('3', 'Казахстан', 22, 35, [24.0, 28.5, 31.5, 33.5]),
    ('4', 'Астана, пролёт сквозь облака, T1', 35, 45, [35.8, 36.5, 38.8, 42.0]),
    ('5', 'Astana Hub, тезисы T2-T6', 45, 75, [48.0, 54.5, 60.0, 66.0, 72.5, 74.0]),
    ('6', 'Финал, миссия, логотип', 75, 90, [77.0, 80.5, 85.5, 88.8]),
]
TW, TH = 960, 540


def grab(video: str, t: float) -> Image.Image:
    frame = round(t * FPS)
    cmd = ['npx', 'remotion', 'ffmpeg', '-v', 'error', '-ss', f'{frame / FPS:.6f}', '-i', video,
           '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']
    png = subprocess.run(cmd, check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(png)).convert('RGB')


def font(size: int):
    # QA labels only (not part of the film): any system font with Cyrillic.
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    video, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    f = font(22)
    for num, title, a, b, times in SCENES:
        assert all(a <= t < b for t in times), (num, times)
        cols = 2
        rows = (len(times) + cols - 1) // cols
        sheet = Image.new('RGB', (TW * cols, TH * rows + 44), (10, 10, 10))
        d = ImageDraw.Draw(sheet)
        d.text((12, 10), f'Сцена {num} · {title} · {a}-{b} с', fill=(235, 235, 235), font=f)
        for i, t in enumerate(times):
            im = grab(video, t).resize((TW, TH), Image.LANCZOS)
            x, y = (i % cols) * TW, 44 + (i // cols) * TH
            sheet.paste(im, (x, y))
            label = f't = {t:.2f} с · кадр {round(t * FPS)}'
            d.rectangle([x + 8, y + 8, x + 16 + d.textlength(label, font=f), y + 40], fill=(0, 0, 0))
            d.text((x + 12, y + 11), label, fill=(255, 255, 255), font=f)
        path = out / f'scene_{num}.jpg'
        sheet.save(path, quality=86, optimize=True)
        print(path)


if __name__ == '__main__':
    main()

#!/usr/bin/env bash
# Chunked, resumable render of the film + master/delivery encodes.
#
#   tools/render.sh 1080     # 1920x1080 ProRes 422 HQ master chunks -> master + H.264 1080p60
#   tools/render.sh 4k       # 3840x2160 (scale 2) ProRes 422 HQ master chunks -> master + H.264/H.265 4K60
#
# Video is rendered muted in 10 s chunks (resumable: finished chunks are skipped),
# concatenated without re-encoding, then the soundtrack (48 kHz / 24-bit WAV) is
# muxed once, so there are no audio gaps at chunk boundaries.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-1080}"
FPS=60
SECONDS_TOTAL=90
CHUNK_SEC=10
FRAMES_TOTAL=$((SECONDS_TOTAL * FPS))
CHUNK=$((CHUNK_SEC * FPS))
case "$MODE" in
  1080) SCALE=1; TAG=1080p60 ;;
  4k) SCALE=2; TAG=4k60 ;;
  *) echo "usage: $0 1080|4k"; exit 1 ;;
esac

OUT=out/render_$TAG
mkdir -p "$OUT"
FFMPEG="npx remotion ffmpeg"

echo "== bundling"
npx remotion bundle src/index.ts --out-dir=out/bundle >/dev/null

for ((start = 0; start < FRAMES_TOTAL; start += CHUNK)); do
  end=$((start + CHUNK - 1))
  (( end >= FRAMES_TOTAL )) && end=$((FRAMES_TOTAL - 1))
  f="$OUT/chunk_$(printf '%05d' "$start").mov"
  if [[ -s "$f.done" ]]; then echo "skip $f"; continue; fi
  echo "== frames $start-$end -> $f"
  npx remotion render out/bundle Film "$f" --frames="$start-$end" --scale="$SCALE" \
    --codec=prores --prores-profile=hq --muted --image-format=png --concurrency=1 --log=error
  echo ok > "$f.done"
done

echo "== concat master"
ls "$OUT"/chunk_*.mov | sed "s#^#file '$PWD/#; s#\$#'#" > "$OUT/list.txt"
$FFMPEG -hide_banner -y -f concat -safe 0 -i "$OUT/list.txt" -i public/audio/soundtrack.wav \
  -map 0:v -map 1:a -c:v copy -c:a pcm_s24le -shortest "$OUT/astanahub_universe_${TAG}_master_prores.mov"

if [[ "$MODE" == "1080" ]]; then
  echo "== H.264 1080p60 (crf 14, veryslow)"
  $FFMPEG -hide_banner -y -i "$OUT/astanahub_universe_${TAG}_master_prores.mov" \
    -c:v libx264 -preset veryslow -crf 14 -pix_fmt yuv420p -profile:v high -level 4.2 \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 60 -fps_mode cfr \
    -af volume=-0.3dB -c:a aac -b:a 320k -ar 48000 -movflags +faststart out/astanahub_universe_1080p60.mp4
else
  echo "== H.264 4K60 (crf 16, slow)"
  $FFMPEG -hide_banner -y -i "$OUT/astanahub_universe_${TAG}_master_prores.mov" \
    -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -level 5.2 \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 60 -fps_mode cfr \
    -af volume=-0.3dB -c:a aac -b:a 320k -ar 48000 -movflags +faststart out/astanahub_universe_4k60.mp4
  echo "== 1080p60 from the 4K master (Lanczos, 4 samples per pixel)"
  $FFMPEG -hide_banner -y -i "$OUT/astanahub_universe_${TAG}_master_prores.mov" \
    -vf "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int" \
    -c:v libx264 -preset veryslow -crf 14 -pix_fmt yuv420p -profile:v high -level 4.2 \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 60 -fps_mode cfr \
    -af volume=-0.3dB -c:a aac -b:a 320k -ar 48000 -movflags +faststart out/astanahub_universe_1080p60.mp4
fi
echo "== done"

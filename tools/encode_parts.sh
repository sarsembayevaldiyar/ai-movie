#!/usr/bin/env bash
# Restart-safe delivery encode: every 10 s ProRes chunk is encoded to H.264 on its
# own (same x264 settings as render.sh, each segment opens with an IDR frame), the
# segments are joined without re-encoding and the soundtrack is muxed once.
# Also writes the ProRes 422 HQ master with 24-bit PCM.
# AAC gets -0.3 dB so its true peak stays <= -1 dBTP (the codec adds ~0.4 dB of
# overshoot); the concat demuxer drops the BT.709 VUI tags, h264_metadata restores them.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=out/render_1080p60; H=$OUT/h264; mkdir -p "$H"
FF="npx remotion ffmpeg -hide_banner -v error -y"
for c in "$OUT"/chunk_*.mov; do
  s="$H/$(basename "$c" .mov).mp4"
  [[ -s "$s.done" ]] && continue
  $FF -i "$c" -an -c:v libx264 -preset veryslow -crf 14 -pix_fmt yuv420p -profile:v high -level 4.2 \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 60 -fps_mode cfr "$s"
  echo ok > "$s.done"
done
ls "$H"/chunk_*.mp4 | sed "s#^#file '$PWD/#; s#\$#'#" > "$H/list.txt"
$FF -f concat -safe 0 -i "$H/list.txt" -i public/audio/soundtrack.wav -map 0:v -map 1:a \
  -c:v copy -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 \
  -af volume=-0.3dB -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart out/astanahub_universe_1080p60.mp4
ls "$OUT"/chunk_*.mov | sed "s#^#file '$PWD/#; s#\$#'#" > "$OUT/list.txt"
$FF -f concat -safe 0 -i "$OUT/list.txt" -i public/audio/soundtrack.wav -map 0:v -map 1:a \
  -c:v copy -c:a pcm_s24le -shortest "$OUT/astanahub_universe_1080p60_master_prores.mov"
echo "== done"

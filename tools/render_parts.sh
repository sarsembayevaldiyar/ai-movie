#!/usr/bin/env bash
# Renders one 10 s chunk as small resumable parts (for environments that restart
# long jobs), then joins them losslessly into the chunk file render.sh expects.
#   tools/render_parts.sh <first_frame> [part_frames]
set -euo pipefail
cd "$(dirname "$0")/.."
START=$1; PART=${2:-150}; CHUNK=600
OUT=out/render_1080p60; P=$OUT/parts_$(printf '%05d' "$START")
mkdir -p "$P"
[[ -d out/bundle ]] || npx remotion bundle src/index.ts --out-dir=out/bundle >/dev/null
for ((s = START; s < START + CHUNK; s += PART)); do
  e=$((s + PART - 1)); f="$P/part_$(printf '%05d' "$s").mov"
  [[ -s "$f.done" ]] && continue
  npx remotion render out/bundle Film "$f" --frames="$s-$e" --codec=prores --prores-profile=hq \
    --muted --image-format=png --concurrency=1 --log=error
  echo ok > "$f.done"
done
ls "$P"/part_*.mov | sed "s#^#file '$PWD/#; s#\$#'#" > "$P/list.txt"
npx remotion ffmpeg -hide_banner -v error -y -f concat -safe 0 -i "$P/list.txt" -c copy "$OUT/chunk_$(printf '%05d' "$START").mov"
echo ok > "$OUT/chunk_$(printf '%05d' "$START").mov.done"

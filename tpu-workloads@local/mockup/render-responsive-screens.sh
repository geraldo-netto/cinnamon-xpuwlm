#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
output_dir="$script_dir/screens/responsive"
chrome_binary=${TPUWM_CHROME:-}

if [[ -z "$chrome_binary" ]]; then
  chrome_binary=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
fi
if [[ -z "$chrome_binary" || ! -x "$chrome_binary" ]]; then
  echo "A Chrome/Chromium executable is required; set TPUWM_CHROME." >&2
  exit 1
fi
if ! command -v montage >/dev/null 2>&1; then
  echo "ImageMagick montage is required for the responsive gallery." >&2
  exit 1
fi

mkdir -p "$output_dir"

render() {
  local name=$1
  local width=$2
  local height=$3
  local scale=$4
  local query=$5
  "$chrome_binary" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --allow-file-access-from-files \
    --force-device-scale-factor="$scale" \
    --run-all-compositor-stages-before-draw \
    --virtual-time-budget=1000 \
    --window-size="$width,$height" \
    --screenshot="$output_dir/$name.png" \
    "file://$script_dir/index.html?$query" >/dev/null 2>&1
}

render wide 900 1080 1 "screen=overview&layout=wide"
render narrow 480 900 1 "screen=overview&layout=narrow"
render high-scale 600 900 2 "screen=overview&layout=high-scale"
render large-text 720 1000 1 "screen=overview&layout=large-text"

montage \
  "$output_dir/wide.png" \
  "$output_dir/narrow.png" \
  "$output_dir/high-scale.png" \
  "$output_dir/large-text.png" \
  -set label '%t' \
  -font DejaVu-Sans \
  -pointsize 16 \
  -fill '#f3f5f7' \
  -background '#171a1f' \
  -thumbnail '520x620>' \
  -tile 2x2 \
  -geometry '+18+28' \
  -strip \
  -depth 8 \
  "$output_dir/responsive-matrix.png"

identify "$output_dir"/*.png

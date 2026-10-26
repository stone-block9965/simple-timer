#!/usr/bin/env bash
# Simple Timer (Firefox) - XPI ビルドスクリプト
# 使い方: ./build.sh [出力ディレクトリ(既定: dist)]
# XPI は拡張機能のファイルをZIPにしたものです。manifest.json が ZIP の「ルート」に
# 来る必要があるため、フォルダごとではなくファイルを個別に指定して圧縮します。
# （README.md / build.sh / tests/ はXPIに含めません）
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n1)"
OUT="${1:-dist}"
XPI="$OUT/simple-timer-extension-${VERSION}-firefox.xpi"

FILES=(
  manifest.json
  background.js
  audio.js
  popup.html
  popup.css
  popup.js
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "ファイルが見つかりません: $f" >&2; exit 1; }
done

mkdir -p "$OUT"
rm -f "$XPI"
zip -X -9 -q "$XPI" "${FILES[@]}"
echo "作成しました: $XPI"
unzip -l "$XPI"

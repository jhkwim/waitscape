#!/bin/sh
# 트레이 아이콘을 SVG(app/src-tauri/icons/src/tray*.svg)에서 만든다. 필요: rsvg-convert(brew install librsvg).
# 앱 아이콘(icons/*.png, icon.icns, icon.ico)은 하이브리드: 매끈한 머그·배경(icons/src/app-icon/back_*.svg) 위에 햄찌 도트(hamster_dots_64.png).
# 32·16px는 따로 찍은 손도트(small_16.png 등). 디자인 도구로 크기별로 만들어 커밋한 것이라 이 스크립트는 다루지 않는다.
# 결과는 커밋한다 — 빌드 때는 이 스크립트가 필요 없다.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
I="$ROOT/app/src-tauri/icons"
rsvg-convert -w 44 -h 44 "$I/src/tray.svg" -o "$I/tray.png"
rsvg-convert -w 44 -h 44 "$I/src/tray-alert.svg" -o "$I/tray-alert.png"
echo "icons → $I"

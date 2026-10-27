#!/bin/sh
# wr-hook을 따로(작게) 빌드해서 Tauri sidecar 이름 규칙(binaries/wr-hook-<target-triple>[.exe])으로 복사한다.
# cargo tauri dev/build가 beforeDevCommand/beforeBuildCommand로 부른다. 직접 실행해도 된다.
#   TAURI_ENV_TARGET_TRIPLE: Tauri CLI가 넣어 줌. 없으면 rustc 호스트 triple. universal-apple-darwin이면 두 아키텍처를 lipo로 합친다.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/app/src-tauri/binaries"
TRIPLE=${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}
mkdir -p "$OUT"
EXT=""
case "$TRIPLE" in *windows*) EXT=".exe" ;; esac

build() {  # $1 = triple
  cargo build --release -p wr-hook --target "$1" --manifest-path "$ROOT/Cargo.toml" >&2
  echo "$ROOT/target/$1/release/wr-hook$EXT"
}

if [ "$TRIPLE" = "universal-apple-darwin" ]; then
  A=$(build aarch64-apple-darwin)
  X=$(build x86_64-apple-darwin)
  lipo -create -output "$OUT/wr-hook-universal-apple-darwin" "$A" "$X"
else
  B=$(build "$TRIPLE")
  cp "$B" "$OUT/wr-hook-$TRIPLE$EXT"
fi
echo "sidecar: $OUT/wr-hook-$TRIPLE$EXT" >&2

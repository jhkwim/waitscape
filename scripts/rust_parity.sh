#!/bin/sh
# Rust(wr-core) ↔ Python 기준 결과 동등성 + 트랜스크립트 전용 기대값 검사를 한 번에.
#   sh scripts/rust_parity.sh
# 1) cargo로 Rust 스냅샷 러너(crates/wr-core/examples/snapshot.rs)를 cases.json·고정 시계로 실행
# 2) scripts/compare.py fixtures/expected <Rust 결과> --ignore provider,providers  (1.1 추가 필드만 무시)
# 3) scripts/check_transcript_only.py <Rust 트랜스크립트 전용 state.json>
# 서버(포트)는 띄우지 않는다. 가짜 시크릿 원문이 결과에 남으면 러너가 실패한다.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d "${TMPDIR:-/tmp}/wr-rust-parity.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
cd "$ROOT"
cargo run -q -p wr-core --example snapshot -- --out "$OUT/expected" --transcript-only "$OUT/transcript-only.json"
python3 scripts/compare.py fixtures/expected "$OUT/expected" --ignore provider,providers
# 파이프(| tail)는 종료코드를 삼키므로 출력을 변수에 받아 종료코드를 보존한다(set -e).
TO_OUT=$(python3 scripts/check_transcript_only.py "$OUT/transcript-only.json") || {
    printf '%s\n' "$TO_OUT"
    exit 1
}
printf '%s\n' "$TO_OUT" | tail -1

#!/usr/bin/env bash
# Waitscape 릴리스 전 점검 (#61) — Release Prep 전에 Gemini(Antigravity CLI, plan 모드)로 세 가지를 동시에 돌린다.
#   docs  : 문서(README·README.en·INSTALL·MODES·DEVELOPMENT) ↔ 코드 사실 대조, ko/en 짝 (lenses/docs.md)
#   i18n  : web/core/i18n.js ko/en 키·자리표시자·번역 안 된 문구·고정 폭 넘침 (lenses/i18n.md, 키 대조는 스크립트가 먼저 뽑음)
#   notes : CHANGELOG [Unreleased] → 사용자용 릴리스 노트 초안(한국어 해요체, RELEASE_NOTES_PROMPT.md)
# 메인테이너 전용 선택 도구. 결과는 **후보·초안**이다: Claude가 지적마다 코드로 검증하고 노트의 사실을 대조·다듬은 뒤 사람이 쓴다(docs/RELEASE.md §3).
#
# 사용법:
#   .github/review/release_check.sh [--since <태그>] [--version <X.Y.Z>]
#     --since    비교할 지난 태그 (기본: WR_REF에서 가장 가까운 태그)
#     --version  노트 파일 이름의 버전 (기본: [Unreleased]에 추가·바뀜이 있으면 minor, 없으면 patch를 올린 추정값)
#
# 옵션(환경변수):
#   WR_MODEL    모델 (기본 gemini-3.8-flash-medium, Gemini 계열만)
#   WR_PASSES   돌릴 패스 (기본 "docs i18n notes")
#   WR_REF      점검할 커밋 (기본 HEAD) · WR_AGY · WR_TIMEOUT(기본 15m) · WR_OUT(기본 ${TMPDIR:-/tmp}/waitscape-review)
#   WR_EMBED    문서·사전을 프롬프트에 싣는 최대 바이트 (기본 240000) · WR_DIFF 태그 이후 코드 diff를 싣는 최대 바이트 (기본 60000)
#   WR_KEEP=1   임시 체크아웃 유지 · WR_DRY=1 프롬프트만 만들고 agy는 실행하지 않음
#
# 결과: $WR_OUT/release-<버전>-check.json (docs·i18n 지적 합집합, schema.json 형식 + found_by·meta)
#       $WR_OUT/release-<버전>-notes.md   (노트 초안 + 맨 아래 「검토용」 절 — 확인할 것·뺀 항목. 릴리스 본문에 붙이기 전에 지운다)
# 비용(1차 실측 프롬프트 크기 ÷ 3): docs 약 77k · i18n 약 40k · notes 소량(1~2k) 입력 토큰 + 읽은 파일. 릴리스마다 1회.
# 종료 코드: 0 성공 / 2 사용법 / 3 실제 형태 시크릿 발견(전송 중단) / 4 모든 패스 실패
# 외부 통신: Antigravity CLI(대상 Google) — 프롬프트(문서·i18n 사전·CHANGELOG·태그 이후 diff 일부) + 리뷰어가 읽는 스냅숏 파일. 보내기 전에 시크릿 검사.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
AGY="${WR_AGY:-$HOME/.local/bin/agy}"
MODEL="${WR_MODEL:-gemini-3.8-flash-medium}"
TIMEOUT="${WR_TIMEOUT:-15m}"
OUT="${WR_OUT:-${TMPDIR:-/tmp}/waitscape-review}"
EMBED="${WR_EMBED:-240000}"
DIFFMAX="${WR_DIFF:-60000}"
REF="${WR_REF:-HEAD}"
PASSES="${WR_PASSES:-docs i18n notes}"
DOCS="README.md README.en.md docs/INSTALL.md MODES.md docs/DEVELOPMENT.md"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
LIB() { python3 "$HERE/review_lib.py" "$@"; }
die() { echo "release_check: $*" >&2; exit "${2:-2}"; }

SINCE=""; VER=""; VER_GIVEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since) [ $# -ge 2 ] || die "--since <태그>"; SINCE="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version <X.Y.Z>"; VER="$2"; VER_GIVEN=1; shift 2 ;;
    *) die "사용법: $0 [--since <태그>] [--version <X.Y.Z>]" ;;
  esac
done
for p in $PASSES; do case "$p" in docs|i18n|notes) ;; *) die "WR_PASSES는 docs·i18n·notes 중에서: $p" ;; esac; done
COMMIT="$(git -C "$ROOT" rev-parse "$REF")"
[ -n "$SINCE" ] || SINCE="$(git -C "$ROOT" describe --tags --abbrev=0 "$COMMIT")" || die "태그를 찾지 못함 — --since로 지정"
git -C "$ROOT" rev-parse -q --verify "$SINCE^{commit}" >/dev/null || die "태그·커밋 없음: $SINCE"
[ -z "$VER" ] || printf '%s\n' "$VER" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' || die "--version은 X.Y.Z(숫자만): $VER"
[ -x "$AGY" ] || [ "${WR_DRY:-0}" = 1 ] || die "Antigravity CLI 없음: $AGY"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wr-release-XXXXXX")"
PIDS=""
trap wr_cleanup EXIT                # 패스와 agy 손자 프로세스까지 정리(lib.sh wr_killtree) + 임시 폴더 삭제
trap 'exit 130' INT; trap 'exit 143' TERM   # 패스는 백그라운드라 신호를 직접 받지 못함 → 여기서 끝내면 EXIT 트랩이 정리

wr_snapshot "$ROOT" "$COMMIT" "$WORK/repo"
R="$WORK/repo"
CUR="$(python3 "$R/scripts/version.py" --root "$R" show)"
[ -n "$VER" ] || VER="$(LIB next-version "$CUR" "$R/CHANGELOG.md")"
mkdir -p "$OUT"
BASE="$OUT/release-$VER"
echo "릴리스 점검: $SINCE..${COMMIT:0:12} (지금 $CUR → 노트 버전 $VER$( [ -n "${VER_GIVEN:-}" ] || echo ' 추정')) 패스 [$PASSES] 모델 $MODEL" >&2

# 태그 이후 변경: 커밋 제목(작성자·이메일 없음) · 파일 통계 · [Unreleased] · 코드 diff(문서·fixture·잠금 파일 제외, 앞부분만 — 전체는 .review/since.diff)
git -C "$ROOT" diff "$SINCE" "$COMMIT" -- . ':(exclude)*.md' ':(exclude)fixtures/**' ':(exclude)*.lock' ':(exclude)docs/assets/**' > "$R/.review/since.diff"
{
  printf '## 태그 이후 변경 (%s..%s)\n\n### 커밋 제목\n\n```text\n' "$SINCE" "${COMMIT:0:12}"
  git -C "$ROOT" log --no-merges --format='%h %s' "$SINCE..$COMMIT" | sed 's/```/ˋˋˋ/g'
  printf '```\n\n### 바뀐 파일\n\n```text\n'
  git -C "$ROOT" diff --stat=120 "$SINCE" "$COMMIT"
  printf '```\n\n### CHANGELOG [Unreleased]\n\n```markdown\n'
  LIB unreleased "$R/CHANGELOG.md" | sed 's/```/ˋˋˋ/g'
  printf '```\n\n### 코드 diff (%s)\n\n```diff\n' "$( [ "$(wc -c < "$R/.review/since.diff")" -gt "$DIFFMAX" ] && echo "앞 ${DIFFMAX}바이트만 — 나머지는 .review/since.diff" || echo "전체")"
  head -c "$DIFFMAX" "$R/.review/since.diff" | sed 's/```/ˋˋˋ/g'
  printf '\n```\n'
} > "$WORK/since.md"

header() {  # 공통 머리: 공통 프롬프트 + context + 릴리스 점검 규칙 + 점검 정보 + 도구 규칙
  cat "$HERE/REVIEW_PROMPT.md"
  printf '\n\n---\n\n# 프로젝트 요약 (context)\n\n'; cat "$HERE/context.md"
  printf '\n\n---\n\n'; cat "$HERE/RELEASE_CHECK_PROMPT.md"
  printf '\n\n---\n\n# 점검 정보\n\n- 커밋: %s (%s), 지난 태그 %s, 지금 버전 %s → 다음 %s\n- 날짜: %s\n' "${COMMIT:0:12}" "$REF" "$SINCE" "$CUR" "$VER" "$(date +%Y-%m-%d)"
  printf '\n\n---\n\n# 도구 사용 규칙 (headless 실행: 사용자에게 권한을 물을 수 없다)\n\n'
  printf -- '- **셸 명령(run_command·git·gh·curl 등)은 쓰지 않는다.** 허용되지 않아 자동 거부되고 실행이 실패한다.\n'
  printf -- '- 파일 확인은 읽기 전용 도구만: grep_search(먼저), read_file/view_file, list_dir, find_by_name. 파일을 만들거나 고치지 않는다.\n'
  printf -- '- 도구 호출은 **최대 20회**. 코드 사실 확인에만 쓰고, 20회 안에 끝내고 JSON을 출력한다.\n'
  printf -- '- **오탐 방지**: 코드 쪽 사실(상수·키·기본값)은 직접 찾아 evidence에 `파일:줄`로 인용한 뒤에만 지적한다. 찾지 못했으면 question으로만, 찾을 심볼을 적는다.\n\n---\n\n'
  cat "$WORK/since.md"
}
build_pass() {  # $1=패스 → $BASE.$1.prompt.md / .strict.md (본문을 먼저 만들고 마지막 지시는 끝에 한 번만)
  local p="$1" f="$WORK/$1.body.md"
  case "$p" in
    docs)
      { header; printf '\n\n---\n\n## 문서\n\n'; ( cd "$R" && LIB embed-files . "$EMBED" $DOCS )
        printf '\n\n---\n\n'; cat "$HERE/lenses/docs.md"; } > "$f" ;;
    i18n)
      { header; printf '\n\n---\n\n## 키 대조\n\n'; ( cd "$R" && LIB i18n-keys web/core/i18n.js web/core/*.js )
        printf '\n\n## 사전·모드 이름\n\n'; ( cd "$R" && LIB embed-files . "$EMBED" web/core/i18n.js web/modes/*/mode.json )
        printf '\n\n---\n\n'; cat "$HERE/lenses/i18n.md"; } > "$f" ;;
    notes)
      { cat "$HERE/RELEASE_NOTES_PROMPT.md"
        printf '\n\n---\n\n# 자료\n\n- 새 버전: %s (지금 %s, 지난 태그 %s)%s\n\n## CHANGELOG [Unreleased]\n\n```markdown\n' "$VER" "$CUR" "$SINCE" "$( [ -n "${VER_GIVEN:-}" ] || echo ' — 버전은 추정값')"
        LIB unreleased "$R/CHANGELOG.md" | sed 's/```/ˋˋˋ/g'
        printf '```\n\n## 지난 태그 이후 커밋 제목 (참고 — 노트의 사실은 CHANGELOG를 따른다)\n\n```text\n'
        git -C "$ROOT" log --no-merges --format='%s' "$SINCE..$COMMIT" | sed 's/```/ˋˋˋ/g'
        printf '```\n'; } > "$f" ;;
  esac
  if [ "$p" = notes ]; then   # 도구를 쓰지 않는 패스라 엄격 재시도도 같은 프롬프트
    { cat "$f"; printf '\n---\n\n이제 초안을 써라. 출력은 notes_schema.json 형식의 JSON 하나뿐이다(도구 호출 금지).\n'; } > "$BASE.$p.prompt.md"
    cp "$BASE.$p.prompt.md" "$BASE.$p.strict.md"
  else
    { cat "$f"; printf '\n\n---\n\n%s\n' "$WR_LAST"; } > "$BASE.$p.prompt.md"
    { cat "$f"; printf '\n\n---\n\n%s\n\n%s\n' "$WR_STRICT_TAIL" "$WR_LAST"; } > "$BASE.$p.strict.md"
  fi
}
[ -n "$(LIB unreleased "$R/CHANGELOG.md")" ] || echo "주의: CHANGELOG [Unreleased]가 비어 있음 — notes 초안이 빈약할 수 있다" >&2
for p in $PASSES; do build_pass "$p"; done
if wr_secret_scan "$R" "$BASE".*.md; then rm -f "$BASE".*.md; exit 3; fi
for p in $PASSES; do echo "  $p 프롬프트 $(( $(wc -c < "$BASE.$p.prompt.md") / 1024 ))KB" >&2; done
if [ "${WR_DRY:-0}" = 1 ]; then for p in $PASSES; do echo "$BASE.$p.prompt.md"; done; exit 0; fi

started=$(date +%s); n=0; NOTES_N=""; FIND_N=""
for p in $PASSES; do
  n=$((n+1)); wr_clone_checkout "$R" "$WORK/repo-$p"
  schema="$HERE/schema.json"; if [ "$p" = notes ]; then schema="$HERE/notes_schema.json"; NOTES_N=$n; else FIND_N="$FIND_N $n"; fi
  wr_run_one "$MODEL" "$BASE.m$n" "$BASE.$p.prompt.md" "$BASE.$p.strict.md" "$MODEL/$p" "$WORK/repo-$p" "$schema" & PIDS="$PIDS $!"
  sleep 1
done
wait $PIDS || true; PIDS=""
wr_collect "$BASE" "$n"
[ -n "$OKS" ] || die "모든 패스 실패: $BASE.m*.raw.json" 4

# docs·i18n 합집합
FOKS=""; for ok in $OKS; do case " $FIND_N " in *" ${ok%%:*} "*) FOKS="$FOKS $ok" ;; esac; done
if [ -n "$FOKS" ]; then
  python3 - "$BASE.meta.json" "$COMMIT" "$SINCE" "$CUR" "$VER" "$MODEL" "$FAILS" "$(( $(date +%s) - started ))" <<'PY'
import json, sys
p, commit, since, cur, ver, model, fails, wall = sys.argv[1:]
json.dump({"kind": "release-check", "commit": commit, "since": since, "current": cur, "version": ver, "model": model,
           "failed_models": fails.split(), "wall_seconds": int(wall)}, open(p, "w", encoding="utf-8"), ensure_ascii=False)
PY
  LIB merge "$BASE" "$BASE.meta.json" $FOKS
  mv "$BASE.json" "$BASE-check.json"
  echo "점검 결과: $BASE-check.json"
fi

# 노트 초안
if [ -n "$NOTES_N" ] && [ -f "$BASE.m$NOTES_N.ok" ]; then
  python3 - "$BASE.m$NOTES_N.json" "$BASE-notes.md" "$VER" "$SINCE" "${COMMIT:0:12}" "$MODEL" <<'PY'
import json, sys
src, dst, ver, since, commit, model = sys.argv[1:]
d = json.load(open(src, encoding="utf-8"))
with open(dst, "w", encoding="utf-8") as f:
    f.write("<!-- 릴리스 노트 초안 v%s (%s..%s, %s) — Gemini 초안이다. Claude가 CHANGELOG·코드와 대조해 고친 뒤에만 쓴다. -->\n\n" % (ver, since, commit, model))
    f.write(d["notes"].strip() + "\n")
    f.write("\n\n---\n\n## 검토용 (릴리스 본문에 붙이기 전에 이 절을 지운다)\n\n### 확인할 것\n\n")
    f.write("".join("- %s\n" % q for q in d.get("questions", [])) or "- 없음\n")
    f.write("\n### 노트에서 뺀 항목\n\n")
    f.write("".join("- %s\n" % q for q in d.get("omitted", [])) or "- 없음\n")
PY
  echo "노트 초안: $BASE-notes.md"
fi
[ -z "$FAILS" ] || echo "실패한 패스:$FAILS" >&2
echo "소요 $(( $(date +%s) - started ))초"

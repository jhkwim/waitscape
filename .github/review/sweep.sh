#!/usr/bin/env bash
# Waitscape 모듈 점검(sweep) — PR이 아니라 main에 이미 있는 모듈을 Gemini(Antigravity CLI, plan 모드)로 정기 점검한다 (#60).
# 메인테이너 전용 선택 도구. Gemini 출력은 **후보**일 뿐이다: Claude가 지적마다 코드로 검증하고(TRIAGE.md §7) 확인된 것만 이슈로 만든다.
#
# 사용법:
#   .github/review/sweep.sh <모듈>            # modules.txt의 모듈 하나
#   .github/review/sweep.sh all               # 모든 모듈을 차례로(모듈마다 패스는 동시에)
#   .github/review/sweep.sh list              # 모듈 목록과 패스 수·프롬프트 크기
#
# 옵션(환경변수):
#   WR_MODEL    모델 (기본 gemini-3.8-flash-medium). 교차 리뷰이므로 Gemini 계열만
#   WR_LENSES   렌즈 강제(공백 구분). 비우거나 none이면 기본 패스만. 생략하면 modules.txt의 모듈별 렌즈
#   WR_REF      점검할 커밋 (기본 HEAD — 이 저장소 작업 폴더의 현재 커밋. 보통 main에서 돌린다)
#   WR_AGY      Antigravity CLI (기본 ~/.local/bin/agy)
#   WR_TIMEOUT  패스마다 시간 제한 (기본 15m)
#   WR_OUT      결과 폴더 (기본 ${TMPDIR:-/tmp}/waitscape-review)
#   WR_EMBED    모듈 코드를 프롬프트에 싣는 최대 바이트 (기본 200000, 넘치면 나머지 범위는 리뷰어가 직접 읽음)
#   WR_KEEP=1   임시 체크아웃 유지 · WR_DRY=1 프롬프트만 만들고 agy는 실행하지 않음
#
# 패스: 기본 1회(체크리스트 담당) + 렌즈마다 1회를 동시에, 패스마다 체크아웃 사본. 결과는 합집합(run_review.sh와 같은 병합 규칙).
# 비용: 모듈당 (1 + 렌즈 수)회 × 입력 약 (프롬프트 바이트 ÷ 3) 토큰 + 읽은 파일. `list`가 모듈별 추정치를 보여 준다. 권장 주기: 주 1회(TRIAGE.md §7).
# 결과: $WR_OUT/sweep-<날짜-시각>-<모듈>.json (schema.json 형식 + found_by·repeat_of·meta) + .prompt.md·.m<N>.raw.json
#       같은 모듈의 지난 결과가 있으면 같은 지적(파일 같고 줄 ±3 + 제목 비슷, 또는 제목이 거의 같음)에 repeat_of를 붙인다.
# 종료 코드: 0 성공 / 2 사용법·모듈 프롬프트 준비 실패(그 모듈은 보내지 않음) / 3 실제 형태 시크릿 발견(전송 중단) / 4 모든 패스 실패
#            all이면 실패한 모듈을 끝에 모아 보여 주고 첫 실패 코드로 끝난다(나머지 모듈은 계속 돈다)
# 외부 통신: Antigravity CLI(대상 Google) — 프롬프트(모듈 코드 포함) + 리뷰어가 읽는 스냅숏 파일. 보내기 전에 스냅숏 전체와 프롬프트의 실제 형태 시크릿을 검사한다.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
AGY="${WR_AGY:-$HOME/.local/bin/agy}"
MODEL="${WR_MODEL:-gemini-3.8-flash-medium}"
TIMEOUT="${WR_TIMEOUT:-15m}"
OUT="${WR_OUT:-${TMPDIR:-/tmp}/waitscape-review}"
EMBED="${WR_EMBED:-200000}"
REF="${WR_REF:-HEAD}"
MODS="$HERE/modules.txt"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
LIB() { python3 "$HERE/review_lib.py" "$@"; }

die() { echo "sweep: $*" >&2; exit "${2:-2}"; }
[ $# -eq 1 ] || die "사용법: $0 <모듈|all|list>  (모듈: $(LIB modules "$MODS" | tr '\n' ' '))"
TARGET="$1"
ALL="$(LIB modules "$MODS")"
case "$TARGET" in
  all) TARGETS="$ALL" ;;
  list) TARGETS="$ALL" ;;
  *) printf '%s\n' "$ALL" | grep -qxF -- "$TARGET" || die "모르는 모듈: $TARGET ($(echo $ALL))"; TARGETS="$TARGET" ;;
esac

lenses_of() {  # 모듈의 렌즈(WR_LENSES가 설정돼 있으면 그쪽)
  local l
  if [ "${WR_LENSES+set}" = set ]; then l="$WR_LENSES"; else l="$(LIB module "$MODS" "$1" | cut -f2)"; fi
  [ "$l" = none ] && l=""
  for x in $l; do
    case "$x" in ''|*[!a-z0-9-]*) die "렌즈 이름은 영소문자·숫자·-만: $x" ;; esac
    [ -f "$HERE/lenses/$x.md" ] || die "렌즈 없음: lenses/$x.md"
  done
  echo $l
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wr-sweep-XXXXXX")"
PIDS=""
trap wr_cleanup EXIT                # 패스와 agy 손자 프로세스까지 정리(lib.sh wr_killtree) + 임시 폴더 삭제
trap 'exit 130' INT; trap 'exit 143' TERM   # 패스는 백그라운드라 신호를 직접 받지 못함 → 여기서 끝내면 EXIT 트랩이 정리

COMMIT="$(git -C "$ROOT" rev-parse "$REF")"
wr_snapshot "$ROOT" "$COMMIT" "$WORK/repo"

if [ "$TARGET" = list ]; then
  printf '%-16s %-26s %5s %9s %12s\n' 모듈 렌즈 패스 프롬프트KB 입력토큰추정
  tot=0
  for m in $TARGETS; do
    ls_="$(lenses_of "$m")" || exit 2; n=$(( 1 + $(echo $ls_ | wc -w) ))
    LIB embed "$MODS" "$m" "$WORK/repo" "$EMBED" > "$WORK/list.md" || die "모듈 코드를 만들지 못함: $m (modules.txt의 파일·표지 확인)"
    b=$(wc -c < "$WORK/list.md"); b=$((b + 30000))   # + 공통 프롬프트·context·체크리스트 약 30KB
    printf '%-16s %-26s %5d %9d %12s\n' "$m" "${ls_:-(없음)}" "$n" $((b/1024)) "$((n*b/3/1000))k"
    tot=$((tot + n*b/3))
  done
  echo "전체(all) 1회: 입력 약 $((tot/1000))k 토큰 + 리뷰어가 읽는 파일·출력. 패스는 모듈 안에서만 동시에 돈다." >&2
  exit 0
fi

[ -x "$AGY" ] || [ "${WR_DRY:-0}" = 1 ] || die "Antigravity CLI 없음: $AGY"
if wr_secret_scan "$WORK/repo"; then exit 3; fi
mkdir -p "$OUT"

LENS_RULE='- 이 패스는 위 관점만 본다. 파일 읽기는 이 패스에 한해 **최대 15회**(앞의 8회 대신), 모듈 밖의 정의·호출부 확인에만 쓴다(모듈 코드는 이미 위에 있다).
- 관점의 항목마다 summary에 "항목 N: 확인한 파일:줄 — 결론"을 남긴다(문제가 없으면 왜 없는지 근거를). 지적은 근거 규칙(§3)을 그대로 따른다.
- **오탐 방지**: 함수 인자·값의 존재·호출 순서·"다음 프레임에 덮인다" 같은 지적은 정의(넘겨받은 헬퍼면 넘겨주는 곳까지)나 그 값을 설정·갱신하는 코드를 직접 확인하고 evidence에 인용한 뒤에만 쓴다. 확인하지 못했으면(읽기 한도 포함) question으로만, 확인할 파일·심볼을 적는다.'

sweep_one() {  # $1=모듈 → 0 성공 / 2 프롬프트 준비 실패(보내지 않음) / 3 시크릿(즉시 종료) / 4 모든 패스 실패
  # `if sweep_one`으로 불리므로 set -e가 꺼져 있다 — 실패할 수 있는 단계는 모두 직접 검사한다
  local mod="$1" lists lenses base n l prev started B
  lists="$(LIB module "$MODS" "$mod")" || { echo "sweep: $mod — modules.txt 항목을 읽지 못함" >&2; return 2; }
  lists="$(printf '%s' "$lists" | cut -f1)"
  lenses="$(lenses_of "$mod")" || { echo "sweep: $mod — 렌즈 확인 실패" >&2; return 2; }
  base="$OUT/sweep-$(date +%Y%m%d-%H%M%S)-$mod"
  started=$(date +%s)
  echo "== 모듈 $mod: 체크리스트 [${lists:-없음}] 렌즈 [${lenses:-없음}] 모델 $MODEL 커밋 ${COMMIT:0:12}" >&2

  LIB embed "$MODS" "$mod" "$WORK/repo" "$EMBED" > "$WORK/$mod.code.md" && [ -s "$WORK/$mod.code.md" ] \
    || { echo "sweep: $mod — 모듈 코드를 만들지 못함(파일·표지가 이 커밋에 없음?) — 프롬프트를 만들지 않고 건너뜀" >&2; return 2; }
  {
    cat "$HERE/REVIEW_PROMPT.md"
    printf '\n\n---\n\n# 프로젝트 요약 (context)\n\n'; cat "$HERE/context.md"
    printf '\n\n---\n\n'; cat "$HERE/SWEEP_PROMPT.md"
    for c in $lists; do printf '\n\n---\n\n'; cat "$HERE/checklists/$c.md"; done
    printf '\n\n---\n\n# 점검 정보\n\n- 모듈: `%s` (modules.txt)\n- 커밋: %s (%s)\n- 날짜: %s\n' "$mod" "${COMMIT:0:12}" "$REF" "$(date +%Y-%m-%d)"
    printf '\n\n---\n\n# 도구 사용 규칙 (headless 실행: 사용자에게 권한을 물을 수 없다)\n\n'
    printf -- '- **셸 명령(run_command·git·gh·curl 등)은 쓰지 않는다.** 허용되지 않아 자동 거부되고 실행이 실패한다.\n'
    printf -- '- 파일 확인은 읽기 전용 도구만: read_file/view_file, grep_search, list_dir, find_by_name. 파일을 만들거나 고치지 않는다.\n'
    printf -- '- 모듈 코드는 아래에 이미 있다. 파일 읽기는 **최대 8회**, 모듈 밖 정의·호출부 확인에만, 한 번에 넓은 줄 범위로. 8회 안에 끝내고 JSON을 출력한다.\n'
    printf '\n## 모듈 코드\n\n'; cat "$WORK/$mod.code.md"
  } > "$WORK/$mod.body.md" || { echo "sweep: $mod — 프롬프트 조립 실패" >&2; return 2; }
  # 본문(마지막 지시 없음) + 패스별 꼬리 + 마지막 지시 한 번. 엄격 재시도도 본문만 이어 붙인다(지시문 중복 방지)
  B="$WORK/$mod.body.md"
  { cat "$B"; printf '\n\n---\n\n%s\n' "$WR_LAST"; } > "$base.prompt.md"
  { cat "$B"; printf '\n\n---\n\n%s\n\n%s\n' "$WR_STRICT_TAIL" "$WR_LAST"; } > "$base.strict.md"
  for l in $lenses; do
    { cat "$B"; printf '\n\n---\n\n'; cat "$HERE/lenses/$l.md"; printf '\n\n## 렌즈 패스 규칙\n\n%s\n\n---\n\n%s\n' "$LENS_RULE" "$WR_LAST"; } > "$base.$l.prompt.md"
    { cat "$B"; printf '\n\n---\n\n'; cat "$HERE/lenses/$l.md"; printf '\n\n---\n\n%s\n\n%s\n' "$WR_STRICT_TAIL" "$WR_LAST"; } > "$base.$l.strict.md"
  done
  if wr_secret_scan "$base".*.md; then rm -f "$base".*.md; exit 3; fi
  echo "프롬프트 $(( $(wc -c < "$base.prompt.md") / 1024 ))KB × 패스 $(( 1 + $(echo $lenses | wc -w) ))개" >&2
  if [ "${WR_DRY:-0}" = 1 ]; then echo "$base.prompt.md"; for l in $lenses; do echo "$base.$l.prompt.md"; done; return 0; fi

  for l in $lenses; do wr_clone_checkout "$WORK/repo" "$WORK/repo-$mod-$l"; done
  n=1; wr_run_one "$MODEL" "$base.m1" "$base.prompt.md" "$base.strict.md" "$MODEL/base" "$WORK/repo" & PIDS="$PIDS $!"
  for l in $lenses; do
    sleep 1; n=$((n+1)); wr_run_one "$MODEL" "$base.m$n" "$base.$l.prompt.md" "$base.$l.strict.md" "$MODEL/$l" "$WORK/repo-$mod-$l" & PIDS="$PIDS $!"
  done
  wait $PIDS || true; PIDS=""
  for l in $lenses; do rm -rf "$WORK/repo-$mod-$l"; done
  wr_collect "$base" "$n"
  [ -n "$OKS" ] || { echo "sweep: $mod — 모든 패스 실패: $base.m*.raw.json" >&2; return 4; }
  python3 - "$base.meta.json" "$mod" "$COMMIT" "$REF" "$lists" "$lenses" "$MODEL" "$FAILS" "$(( $(date +%s) - started ))" <<'PY'
import json, sys
p, mod, commit, ref, lists, lenses, model, fails, wall = sys.argv[1:]
json.dump({"kind": "sweep", "module": mod, "commit": commit, "ref": ref, "checklists": lists.split(), "lenses": lenses.split(),
           "model": model, "failed_models": fails.split(), "wall_seconds": int(wall)}, open(p, "w", encoding="utf-8"), ensure_ascii=False)
PY
  LIB merge "$base" "$base.meta.json" $OKS || { echo "sweep: $mod — 결과 병합 실패: $base.m*.json" >&2; return 4; }
  # 지난 점검(같은 모듈, 이번 것보다 앞선 최종 결과 파일)
  prev="$(ls "$OUT" | grep -E "^sweep-[0-9]{8}-[0-9]{6}-${mod}\.json$" | grep -vx "$(basename "$base").json" | sort | tail -1 || true)"
  if [ -n "$prev" ]; then prev="$OUT/$prev"; else prev="-"; fi
  LIB repeats "$base.json" "$prev"
  echo "결과: $base.json ($(( $(date +%s) - started ))초)"
}

rc=0; FAILED=""
for m in $TARGETS; do
  if sweep_one "$m"; then :; else
    r=$?; [ "$r" = 3 ] && exit 3
    FAILED="$FAILED $m($r)"; [ "$rc" = 0 ] && rc=$r
  fi
done
if [ -n "$FAILED" ]; then echo "sweep: 실패한 모듈:$FAILED" >&2; exit "$rc"; fi
exit 0

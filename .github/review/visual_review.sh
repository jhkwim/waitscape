#!/usr/bin/env bash
# Waitscape 화면 검수 — web/ 화면을 가짜 데이터로 고정 매트릭스 촬영(head, 선택적으로 base)하고 Gemini(Antigravity CLI, plan 모드)에게
# 스크린샷을 보여 주어 겹침·잘림·대비·다크·움직임 줄이기 잔상·회귀 **후보**를 받는다. Claude가 같은 스크린샷을 열어 확인한 뒤에만 반영(TRIAGE §6).
# 메인테이너 전용 선택 도구다. 기여자는 돌릴 필요가 없다.
#
# 사용법:
#   .github/review/visual_review.sh <PR번호>                 # PR 헤드 vs 베이스(merge-base). git fetch <remote> pull/<N>/head (GitHub API 안 씀)
#   .github/review/visual_review.sh --base <REF> [--head <REF>]   # 로컬 커밋끼리. --head 생략 = 지금 작업 트리의 web/ 추적 파일(커밋 전 수정 포함, 추적 안 하는 파일 제외)
#   .github/review/visual_review.sh --head <REF>             # base 없이 head만 검수
#   추가 인자: --matrix full|quick (기본 full) · --modes studio|all (기본 studio, all = 다른 내장 모드도 light·dark 1장씩)
#              --extra 이름=쿼리 (여러 번. PR별 장면, 예 --extra 'halloween=noask=1&season=halloween')
#
# 옵션(환경변수):
#   WR_AGY         Antigravity CLI (기본 ~/.local/bin/agy)
#   WR_VIS_MODEL   모델 (기본 gemini-3.8-flash-medium. 교차 검수이므로 gemini-* 만)
#   WR_VIS_BATCH   agy 1회에 보여 줄 head 스크린샷 최대 수 (기본 10). 묶음은 (모드·테마)별로 나눠 **동시에** 실행
#   WR_VIS_BASE_READS  묶음마다 base 스크린샷을 열어 볼 최대 수 (기본 6)
#   WR_TIMEOUT     agy 시간 제한 (기본 15m) · WR_OUT 결과 폴더 (기본 ${TMPDIR:-/tmp}/waitscape-review)
#   WR_REMOTE      PR 모드에서 fetch할 원격 (기본 origin) · WR_BASE_BRANCH (기본 main)
#   WR_PLAYWRIGHT  playwright-core 모듈 경로 (저장소에 의존성 없음 — 임시 폴더에서 `npm i playwright-core`) · WR_CHROME Chrome 경로
#   WR_VIS_TIME·WR_VIS_WAIT·WR_VIS_JOBS·WR_VIS_DSF·WR_VIS_SEED  촬영 설정(visual/capture.js 머리말)
#   WR_KEEP=1      임시 폴더 유지 · WR_DRY=1 촬영과 프롬프트 조립까지만 하고 agy는 실행하지 않음
#
# 결과: $WR_OUT/vis-<라벨>-<시각>.json (schema.json 형식 + meta) · .shots/(head·base PNG, index.json, diff.json) · .b<N>.prompt.md · .b<N>.raw.json
# 종료 코드: 0 성공 / 2 사용법 / 3 diff에서 실제 형태 시크릿 발견(전송 중단) 또는 web/에 심볼릭 링크 / 4 agy 전부 실패
#
# 외부 통신: (PR 모드만) git fetch → github.com(보내는 데이터 없음) · Antigravity CLI → Google(프롬프트: 장면 목록·web/ diff 일부, 리뷰어가 여는 가짜 데이터 스크린샷)
# 신뢰: 촬영은 PR의 web/ JS를 헤드리스 Chrome에서 **실행**한다. 외부 요청 차단(서버 포트만·WebSocket·Service Worker·WebRTC UDP)과
#       웹 루트 밖 차단(심볼릭 링크 거부)이 있어도, 외부(포크) PR·신뢰할 수 없는 PR은 **일회용 환경에서만** 돌린다(TRIAGE §3.1·§6).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
AGY="${WR_AGY:-$HOME/.local/bin/agy}"
MODEL="${WR_VIS_MODEL:-gemini-3.8-flash-medium}"
BATCH="${WR_VIS_BATCH:-10}"
BASE_READS="${WR_VIS_BASE_READS:-6}"
TIMEOUT="${WR_TIMEOUT:-15m}"
OUT="${WR_OUT:-${TMPDIR:-/tmp}/waitscape-review}"
REMOTE="${WR_REMOTE:-origin}"
BASE_BRANCH="${WR_BASE_BRANCH:-main}"

die() { echo "visual_review: $*" >&2; exit "${2:-2}"; }
case "$MODEL" in gemini-*) ;; *) die "교차 검수이므로 gemini-* 모델만: $MODEL" ;; esac
for _v in BATCH BASE_READS; do case "${!_v}" in ''|*[!0-9]*) die "WR_VIS_${_v}는 0 이상의 정수" ;; esac; done
for _v in WR_VIS_WAIT WR_VIS_JOBS WR_VIS_DSF; do case "${!_v:-}" in *[!0-9.]*) die "${_v}는 숫자" ;; esac; done   # 범위는 capture.js가 검사
case "${WR_VIS_SEED:-1}" in off|[0-9]*) case "${WR_VIS_SEED:-1}" in off) ;; *[!0-9]*) die "WR_VIS_SEED는 정수 또는 off" ;; esac ;; *) die "WR_VIS_SEED는 정수 또는 off" ;; esac
[ "$BATCH" -ge 1 ] || die "WR_VIS_BATCH는 1 이상"

PR=""; BASE_REF=""; HEAD_REF=""; CAP_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="${2:?--base REF}"; shift 2 ;;
    --head) HEAD_REF="${2:?--head REF}"; shift 2 ;;
    --matrix) case "${2:-}" in full|quick) ;; *) die "--matrix는 full|quick" ;; esac; CAP_ARGS+=("$1" "$2"); shift 2 ;;
    --modes) case "${2:-}" in studio|all) ;; *) die "--modes는 studio|all" ;; esac; CAP_ARGS+=("$1" "$2"); shift 2 ;;
    --extra) CAP_ARGS+=("$1" "${2:?--extra 값}"); shift 2 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *[!0-9]*|'') die "모르는 인자: $1" ;;
    *) PR="$1"; shift ;;
  esac
done
[ -n "$PR$BASE_REF$HEAD_REF" ] || die "사용법: $0 <PR번호> | --base REF [--head REF] | --head REF  [--matrix full|quick] [--modes studio|all] [--extra 이름=쿼리]"
[ -z "$PR" ] || [ -z "$BASE_REF$HEAD_REF" ] || die "PR 번호와 --base/--head는 함께 쓰지 않는다"
[ "${WR_DRY:-0}" = 1 ] || [ -x "$AGY" ] || die "Antigravity CLI 없음: $AGY"
command -v node >/dev/null || die "node 필요"

TOP="$(git -C "$HERE" rev-parse --show-toplevel)"
G() { git -C "$TOP" "$@"; }
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wr-visual-XXXXXX")"
PIDS=""
killtree() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done; kill -TERM "$1" 2>/dev/null || true; }   # 묶음 서브셸 → (cd && agy) → agy 손자까지
cleanup() { if [ -n "$PIDS" ]; then for p in $PIDS; do killtree "$p"; done; wait 2>/dev/null || true; fi; [ "${WR_KEEP:-0}" = 1 ] && echo "임시 폴더 유지: $WORK" >&2 || rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

# 1) head·base 커밋 정하기 → web/ 꺼내기 (작업 트리·브랜치는 건드리지 않는다)
if [ -n "$PR" ]; then
  G fetch -q "$REMOTE" "pull/$PR/head" || die "git fetch $REMOTE pull/$PR/head 실패"
  HEAD_SHA="$(G rev-parse FETCH_HEAD)"
  G fetch -q "$REMOTE" "$BASE_BRANCH" || die "git fetch $REMOTE $BASE_BRANCH 실패"
  BASE_SHA="$(G merge-base "$HEAD_SHA" FETCH_HEAD)"
  LABEL="pr$PR"
else
  BASE_SHA=""; [ -z "$BASE_REF" ] || BASE_SHA="$(G rev-parse --verify "$BASE_REF^{commit}")" || die "base REF 없음: $BASE_REF"
  HEAD_SHA=""; [ -z "$HEAD_REF" ] || HEAD_SHA="$(G rev-parse --verify "$HEAD_REF^{commit}")" || die "head REF 없음: $HEAD_REF"
  LABEL="${HEAD_SHA:0:9}"; [ -n "$LABEL" ] || LABEL="worktree"
fi
BASEP="$OUT/vis-$LABEL-$STAMP"
mkdir -p "$WORK/head" "$WORK/base"
if [ -n "$HEAD_SHA" ]; then G archive "$HEAD_SHA" web | tar -x -C "$WORK/head"
else WT="$(G stash create)"; G archive "${WT:-HEAD}" web | tar -x -C "$WORK/head"; fi   # 작업 트리 = 추적 파일만(커밋 전 수정 포함). stash create는 작업 트리를 바꾸지 않는다
[ -z "$BASE_SHA" ] || G archive "$BASE_SHA" web | tar -x -C "$WORK/base"
LINKS="$(find "$WORK/head" "$WORK/base" -type l 2>/dev/null | sed "s#^$WORK/##")"
[ -z "$LINKS" ] || { echo "web/에 심볼릭 링크가 있어 중단합니다(웹 루트 밖 파일이 노출될 수 있음): $(echo $LINKS)" >&2; exit 3; }
echo "head: ${HEAD_SHA:-작업 트리} · base: ${BASE_SHA:-(없음)}" >&2

# 2) web/ diff (프롬프트 맥락용) + 시크릿 검사 — 값은 출력하지 않고 줄 번호만
if [ -n "$BASE_SHA" ]; then
  if [ -n "$HEAD_SHA" ]; then G diff "$BASE_SHA" "$HEAD_SHA" -- web > "$WORK/web.diff"; else G diff "$BASE_SHA" -- web > "$WORK/web.diff"; fi
else : > "$WORK/web.diff"; fi
SECRET_RE='(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35})'
if grep -nE "$SECRET_RE" "$WORK/web.diff" | cut -d: -f1 > "$WORK/secret_lines" && [ -s "$WORK/secret_lines" ]; then
  echo "diff에서 실제 형태 시크릿 발견 — Gemini로 보내지 않습니다. diff 줄: $(tr '\n' ' ' < "$WORK/secret_lines")" >&2
  exit 3
fi

# 3) 촬영 (head → base) + 픽셀 비교
T0=$(date +%s)
SHOTS="$BASEP.shots"; mkdir -p "$SHOTS"
echo "촬영: head" >&2
node "$HERE/visual/capture.js" shoot --web "$WORK/head/web" --out "$SHOTS/head" ${CAP_ARGS[@]+"${CAP_ARGS[@]}"} >&2
if [ -n "$BASE_SHA" ]; then
  echo "촬영: base" >&2
  node "$HERE/visual/capture.js" shoot --web "$WORK/base/web" --out "$SHOTS/base" ${CAP_ARGS[@]+"${CAP_ARGS[@]}"} >&2
  node "$HERE/visual/capture.js" diff "$SHOTS/base" "$SHOTS/head" >&2
fi
CAP_SECS=$(( $(date +%s) - T0 ))

# 4) 묶음 나누기 + 묶음별 프롬프트. 묶음마다 작업 폴더를 따로(agy 전역 캐시가 cwd 키로 겹침), 이미지만 복사
python3 - "$SHOTS" "$BATCH" "$WORK/batches" <<'PY'
import json, sys, os
shots, batch, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
idx = json.load(open(os.path.join(shots, "head", "index.json"), encoding="utf-8"))["shots"]
groups, miss = {}, []
for s in idx:
    if not os.path.exists(os.path.join(shots, "head", s["file"])): miss.append(s["name"]); continue
    key = ("studio-" + s["scheme"]) if s["mode"] == "studio" else "modes"
    groups.setdefault(key, []).append(s["name"])
with open(out, "w", encoding="utf-8") as f:
    for key in sorted(groups):
        names = groups[key]; k = -(-len(names) // batch); size = -(-len(names) // k)   # 고르게 나눔(13장·최대 10 → 7+6)
        for i in range(0, len(names), size):
            f.write(key + "\t" + " ".join(names[i:i + size]) + "\n")
if miss: print("촬영 실패로 뺀 장면: " + " ".join(miss), file=sys.stderr)
PY
LAST='이제 검수하라. 출력은 schema.json 형식의 JSON 하나뿐이다. 모든 문장은 한국어.'
NB=0
while IFS=$'\t' read -r GROUP NAMES; do
  NB=$((NB+1)); WS="$WORK/ws$NB"; mkdir -p "$WS/shots/head"
  for n in $NAMES; do
    cp "$SHOTS/head/$n.png" "$WS/shots/head/"
    if [ -f "$SHOTS/base/$n.png" ]; then mkdir -p "$WS/shots/base"; cp "$SHOTS/base/$n.png" "$WS/shots/base/"; fi
  done
  echo "$GROUP" > "$BASEP.b$NB.group"
  {
    cat "$HERE/lenses/visual.md"
    printf '\n\n---\n\n# 이번 묶음 (%s, head %d장)\n\n' "$GROUP" "$(echo $NAMES | wc -w | tr -d ' ')"
    python3 - "$SHOTS" "$NAMES" <<'PY'
import json, sys, os
shots, names = sys.argv[1], sys.argv[2].split()
idx = {s["name"]: s for s in json.load(open(os.path.join(shots, "head", "index.json"), encoding="utf-8"))["shots"]}
try: diff = json.load(open(os.path.join(shots, "head", "diff.json"), encoding="utf-8"))
except FileNotFoundError: diff = None
for n in names:
    s = idx[n]; v = s["viewport"]
    line = "- `shots/head/%s.png` — 모드 %s · 상황 %s(%s) · %s · %s · %dx%d · 움직임 줄이기 %s" % (n, s["mode"], s["state"], s.get("note") or "", s["scheme"], s["lang"], v["width"], v["height"], "켬" if s["rm"] else "끔")
    if diff is not None:
        d = diff.get(n + ".png") or {}
        if d.get("size_changed"): line += " · base와 크기 다름"
        elif "changed" in d: line += " · base 대비 바뀐 픽셀 %.1f%%%s (`shots/base/%s.png`)" % (d["changed"] * 100, (" 영역 x=%d,y=%d,w=%d,h=%d" % tuple(d["box"])) if d.get("box") else "", n)
        else: line += " · base 장면 없음"
    if s.get("errors"): line += "\n  - 페이지 오류: " + " | ".join(e[:160] for e in s["errors"][:3])
    print(line)
if diff is not None:
    print("\n바뀐 픽셀 비율에는 움직이는 그림(직원·말풍선·비둘기)의 위치 차이도 섞여 있다. 비율이 큰 장면부터 base와 비교하되, 비율만으로 문제라고 하지 않는다.")
PY
    printf '\n## PR 정보\n\n'
    if [ -n "$PR" ]; then printf -- '- PR #%s · head %s · base(merge-base) %s\n' "$PR" "${HEAD_SHA:0:12}" "${BASE_SHA:0:12}"
    else printf -- '- head %s · base %s\n' "${HEAD_SHA:0:12}" "${BASE_SHA:0:12}"; fi
    [ -n "$PR" ] && [ -n "${HEAD_SHA:-}" ] && printf -- '- 커밋 제목: %s\n' "$(G log -1 --format=%s "$HEAD_SHA" | sed 's/```/ˋˋˋ/g')"
    if [ -s "$WORK/web.diff" ]; then
      printf -- '- 바뀐 web/ 파일: %s\n' "$(grep -E '^diff --git' "$WORK/web.diff" | awk '{print $4}' | sed 's#^b/##' | tr '\n' ' ')"
      printf '\n이 PR이 **의도한** 화면 변화를 가늠하는 참고용 diff(앞 30000바이트). 코드 리뷰는 하지 않는다 — 회귀 판단에만 쓴다.\n\n```diff\n'
      head -c 30000 "$WORK/web.diff" | sed 's/```/ˋˋˋ/g'; printf '\n```\n'
    else printf -- '- (base 없음 또는 web/ 변경 없음 — 회귀 비교 없이 head만 검수)\n'; fi
    printf '\n## 도구 사용 규칙 (headless 실행: 사용자에게 권한을 물을 수 없다)\n\n'
    printf -- '- **셸 명령은 쓰지 않는다**(자동 거부되어 실패한다). 파일을 만들거나 고치지 않는다.\n'
    printf -- '- 이미지는 read_file/view_file로 연다(이미지가 그대로 보인다). 위 목록의 `shots/head/*.png`는 **모두 한 번씩** 연다.\n'
    printf -- '- `shots/base/*.png`는 비교가 필요한 장면만, 이 묶음에서 **최대 %s장**.\n' "$BASE_READS"
    printf '\n## 화면 검수 패스 규칙\n\n- 이 패스는 위 「볼 것」만 본다. 지적은 근거 규칙·오탐 방지를 그대로 따른다.\n- 장면마다 summary에 "파일명: 문제 없음 / F번호"를 남긴다.\n\n---\n\n%s\n' "$LAST"
  } > "$BASEP.b$NB.prompt.md"
done < "$WORK/batches"
echo "묶음 ${NB}개 (모델 $MODEL, 묶음당 최대 head ${BATCH}장) · 촬영 ${CAP_SECS}초" >&2

if [ "${WR_DRY:-0}" = 1 ]; then for i in $(seq 1 "$NB"); do echo "$BASEP.b$i.prompt.md"; done; echo "스크린샷: $SHOTS"; exit 0; fi

# 5) agy 실행 (plan 모드 = 읽기 전용, 구조화 출력). 묶음마다 동시에, 1초씩 엇갈려. 실패하면 1회 재시도
run_batch() {  # $1=묶음 번호
  local i="$1" p="$BASEP.b$1" start; start=$(date +%s)
  for try in 1 2; do
    if ( cd "$WORK/ws$i" && "$AGY" -p "$(cat "$p.prompt.md")" --mode plan --model "$MODEL" --log-file "$p.agy.log" \
          --print-timeout "$TIMEOUT" --output-format json --json-schema "$HERE/schema.json" ) > "$p.raw.json" 2> "$p.err" \
       && python3 - "$p.raw.json" "$p.json" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1], encoding="utf-8")); so = raw.get("structured_output")
if raw.get("status") != "SUCCESS" or not isinstance(so, dict): sys.exit(5)
json.dump(so, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
    then echo "$(( $(date +%s) - start ))" > "$p.ok"; echo "[b$i $(cat "$p.group")] $(( $(date +%s) - start ))초" >&2; return; fi
    echo "[b$i] ${try}차 실패(사유: $(tail -c 300 "$p.err" 2>/dev/null | tr '\n' ' '))" >&2
  done
  : > "$p.fail"
}
for i in $(seq 1 "$NB"); do run_batch "$i" & PIDS="$PIDS $!"; sleep 1; done
wait $PIDS || true; PIDS=""

# 6) 모으기: 묶음은 서로 다른 장면이라 그대로 합치고 등급순 재번호. meta에 묶음·소요·토큰
python3 - "$BASEP" "$NB" "$MODEL" "$CAP_SECS" "${PR:-}" "${HEAD_SHA:-worktree}" "${BASE_SHA:-}" <<'PY'
import json, sys, os
base, nb, model, cap, pr, head, basesha = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6], sys.argv[7]
rank = {"critical": 0, "warning": 1, "info": 2, "question": 3}
found, checked, summ, batches, failed, tok = [], [], [], [], [], 0
for i in range(1, nb + 1):
    p = "%s.b%d" % (base, i); g = open(p + ".group", encoding="utf-8").read().strip()
    if not os.path.exists(p + ".ok"): failed.append("b%d(%s)" % (i, g)); continue
    d = json.load(open(p + ".json", encoding="utf-8")); raw = json.load(open(p + ".raw.json", encoding="utf-8"))
    u = raw.get("usage") or {}; tok += int(u.get("total_tokens") or 0)
    batches.append({"batch": "b%d" % i, "group": g, "seconds": int(open(p + ".ok").read()), "findings": len(d.get("findings", [])), "tokens": u.get("total_tokens")})
    summ.append("[b%d %s] %s" % (i, g, d.get("summary", ""))); checked += d.get("checked", [])
    for f in d.get("findings", []): f = dict(f); f["found_by"] = ["%s/visual-b%d" % (model, i)]; found.append(f)
if not batches: print("모든 묶음 실패: %s.b*.err" % base); sys.exit(4)
found.sort(key=lambda x: rank.get(x.get("severity"), 9))
for n, f in enumerate(found, 1): f["id"] = "V%d" % n
out = {"summary": " / ".join(summ), "checked": sorted(set(checked)), "findings": found,
       "meta": {"kind": "visual", "pr": pr or None, "head": head, "base": basesha or None, "model": model, "capture_seconds": cap,
                "batches": batches, "failed_batches": failed, "total_tokens": tok, "shots": base + ".shots"}}
json.dump(out, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
sev = {k: sum(1 for x in found if x["severity"] == k) for k in rank}
print("화면 검수 %d건 — 🔴%d 🟡%d 🔵%d ❓%d · 묶음 %d개(실패 %d) · 촬영 %d초 + 검수 최대 %d초 · 토큰 %d" % (len(found), sev["critical"], sev["warning"], sev["info"], sev["question"],
      len(batches), len(failed), cap, max(b["seconds"] for b in batches), tok))
PY
echo "결과: $BASEP.json  (스크린샷: $SHOTS)"

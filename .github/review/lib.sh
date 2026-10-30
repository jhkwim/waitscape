# shellcheck shell=bash
# sweep.sh·release_check.sh 공용 함수 (source해서 쓴다). run_review.sh는 같은 로직의 자체 사본을 쓴다 — 고칠 때 함께 본다.
# 필요한 변수: HERE(.github/review 절대 경로), AGY, TIMEOUT, WORK(임시 폴더), PIDS(백그라운드 pid 목록, 빈 값으로 시작)

# 실제 형태 시크릿(run_review.sh와 같은 정규식). 값은 출력하지 않고 위치만
WR_SECRET_RE='(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35})'

# wr_secret_scan <폴더|파일>... → 걸리면 "파일:줄" 목록을 stderr에 쓰고 0, 없으면 1
wr_secret_scan() {
  local hits
  hits="$(grep -rnIE "$WR_SECRET_RE" "$@" 2>/dev/null | cut -d: -f1,2 || true)"
  [ -n "$hits" ] || return 1
  echo "실제 형태 시크릿 발견 — Gemini로 보내지 않습니다. 위치(값은 출력 안 함):" >&2
  echo "$hits" | sed 's/^/  /' >&2
  return 0
}

# wr_snapshot <git 루트> <ref> <대상 폴더>: 추적 파일만(.git·빌드 산출물·.env 없음) 풀어 리뷰어 체크아웃으로 쓴다.
# 바이너리 추적 파일(이미지·폰트·GIF 등 git이 binary로 보는 것)은 뺀다 — 리뷰에 쓸모가 없고 시크릿 검사(grep -I)도 건너뛰는 파일이라
# 보내지 않는 쪽이 안전하다. 뺀 파일 수는 stderr에.
wr_snapshot() {
  local bins
  mkdir -p "$3"
  git -C "$1" archive --format=tar "$2" | tar -x -C "$3"
  # numstat에서 바이너리는 "-<TAB>-<TAB>경로" (빈 트리와 비교 = 모든 추적 파일)
  bins="$(git -C "$1" -c core.quotepath=off diff --numstat "$(git -C "$1" hash-object -t tree /dev/null)" "$2" | awk -F'\t' '$1=="-" && $2=="-" {print $3}')"
  if [ -n "$bins" ]; then
    printf '%s\n' "$bins" | while IFS= read -r f; do rm -f -- "$3/$f"; done
    echo "스냅숏: 바이너리 파일 $(printf '%s\n' "$bins" | wc -l | tr -d ' ')개는 빼고 보냄" >&2
  fi
  mkdir -p "$3/.review"
}

# wr_killtree <pid>...: 자손까지(agy가 띄운 손자 프로세스 포함) 아래부터 TERM. pgrep -P 재귀
wr_killtree() {
  local p c
  for p in "$@"; do
    for c in $(pgrep -P "$p" 2>/dev/null); do wr_killtree "$c"; done
    kill "$p" 2>/dev/null || true
  done
}

# wr_cleanup: 백그라운드 패스(PIDS)와 그 자손 정리 + 임시 폴더 삭제(WR_KEEP=1이면 유지). EXIT 트랩에서 부른다
wr_cleanup() {
  if [ -n "${PIDS:-}" ]; then
    # shellcheck disable=SC2086
    wr_killtree $PIDS
    wait 2>/dev/null || true
  fi
  if [ "${WR_KEEP:-0}" = 1 ]; then echo "체크아웃 유지: $WORK/repo" >&2; else rm -rf -- "$WORK"; fi
}

# wr_run_agy <모델> <결과 접두> <프롬프트 파일> <체크아웃> [스키마] — plan 모드(읽기 전용) + 구조화 출력
wr_run_agy() {
  ( cd "$4" && "$AGY" -p "$(cat "$3")" --mode plan --model "$1" --log-file "$2.agy.log" \
      --print-timeout "$TIMEOUT" --output-format json --json-schema "${5:-$HERE/schema.json}" ) > "$2.raw.json" 2> "$2.err" || return 1
  python3 - "$2.raw.json" "$2.json" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1], encoding="utf-8"))
so = raw.get("structured_output")
if raw.get("status") != "SUCCESS" or not isinstance(so, dict):
    sys.exit(5)
json.dump(so, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
f = so.get("findings")
if isinstance(f, list):
    sev = {k: sum(1 for x in f if x.get("severity") == k) for k in ("critical", "warning", "info", "question")}
    print("지적 %d건 — 🔴%d 🟡%d 🔵%d ❓%d · %.0f초" % (len(f), sev["critical"], sev["warning"], sev["info"], sev["question"], raw.get("duration_seconds", 0)))
else:
    print("구조화 출력 · %.0f초" % raw.get("duration_seconds", 0))
PY
}

# wr_run_one <모델> <결과 접두> <프롬프트> <엄격 프롬프트> <레이블> <체크아웃> [스키마]
# 실패하면 도구 없는 엄격 프롬프트로 1회 재시도. 결과: <접두>.ok("레이블:초") 또는 <접두>.fail, 레이블은 <접두>.label
wr_run_one() {
  local start; start=$(date +%s)
  echo "$5" > "$2.label"; echo "[$5] 실행" >&2
  if ! wr_run_agy "$1" "$2" "$3" "$6" "${7:-}"; then
    echo "[$5] 1차 실패(사유: $(tail -c 300 "$2.err" 2>/dev/null | tr '\n' ' ')) — 도구 없는 엄격 프롬프트로 재시도" >&2
    wr_run_agy "$1" "$2" "$4" "$6" "${7:-}" || { echo "[$5] 실패: $2.raw.json / $2.err" >&2; : > "$2.fail"; return; }
  fi
  echo "[$5] $(( $(date +%s) - start ))초" >&2
  echo "$5:$(( $(date +%s) - start ))" > "$2.ok"
}

# wr_clone_checkout <원본> <사본>: 패스마다 체크아웃을 따로(agy 전역 캐시가 cwd 키로 겹침). APFS면 클론
wr_clone_checkout() { cp -cR "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }

# wr_collect <결과 접두> <패스 수> → 전역 OKS("번호:레이블:초" 목록)·FAILS
wr_collect() {
  OKS=""; FAILS=""
  local i
  for i in $(seq 1 "$2"); do
    if [ -f "$1.m$i.ok" ]; then OKS="$OKS $i:$(cat "$1.m$i.ok")"
    else FAILS="$FAILS $(cat "$1.m$i.label" 2>/dev/null || echo "m$i")$( [ -f "$1.m$i.fail" ] || echo '(무응답)')"; fi
  done
}

# 엄격 재시도 꼬리말(도구 없이)
WR_STRICT_TAIL='**재시도 규칙**: 앞선 실행이 도구 권한 문제로 실패했다. 이번에는 **어떤 도구도 호출하지 말고** 위에 포함된 코드·문서만으로 답하라. 관점의 "찾아 읽어라"는 이번에는 프롬프트 안에서만 따른다. 프롬프트 밖 파일을 봐야 확정되는 사항은 severity `question`으로 남기고 확인할 파일·심볼을 적는다.'
WR_LAST='이제 리뷰하라. 출력은 schema.json 형식의 JSON 하나뿐이다. 모든 문장은 한국어.'

#!/bin/bash
# .github/review/run_review.sh의 Waitscape 보고(#58) 스모크 테스트 — 실제 gh·agy·Gemini·GitHub는 부르지 않는다(가짜 스크립트).
#   bash scripts/test_review_report.sh [새 wr-hook 경로]
# 1) report를 모르는 옛 wr-hook 흉내(인자를 무시하고 stdin을 끝까지 읽음)를 주면: 멈추지 않고, 기능 확인(report --help) 한 번 뒤 보고를 끈다
# 2) 새 wr-hook 경로를 주면(예: target/debug/wr-hook): 성공 = hello … done … bye, agy 실패 = done 없이 bye
# 기록은 모두 임시 폴더의 WAITING_ROOM_REPORTS. macOS 기본 /bin/bash(3.2)로도 돈다.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/wr-review-report.XXXXXX")
trap 'rm -rf "$T"' EXIT
FAILS=0
fail() { echo "✗ $*"; FAILS=$((FAILS+1)); }
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/bin/sh
# WR_GHJ 대역: "gh <인자…>"
shift
case "$1 $2" in
  "pr view") echo '{"number":58,"title":"t","body":"b","labels":[],"files":[{"path":"docs/x.md","additions":3,"deletions":1}],"headRefName":"f","baseRefName":"main","headRefOid":"0123456789abcdef"}' ;;
  "pr diff") printf 'diff --git a/docs/x.md b/docs/x.md\n+hello\n' ;;
  "repo clone") mkdir -p "$4/.git/info"; touch "$4/.git/info/exclude" ;;
esac
EOF
cat > "$T/bin/agy" <<'EOF'
#!/bin/sh
sleep 4
echo '{"status":"SUCCESS","duration_seconds":1,"structured_output":{"summary":"ok","checked":[],"findings":[{"id":"F1","severity":"info","category":"c","title":"t","file":"docs/x.md","line":1,"evidence":"e","suggestion":"s"}]}}'
EOF
printf '#!/bin/sh\nexit 1\n' > "$T/bin/badagy"
cat > "$T/bin/old-wr-hook" <<'EOF'
#!/bin/sh
# 0.5.0 이하 흉내: 모르는 하위 명령을 훅 모드로 보고 stdin을 끝까지 읽는다(출력 없음, 종료 0)
echo "$*" >> "$(dirname "$0")/old.log"
cat > /dev/null
EOF
chmod +x "$T/bin/"*

# 실행(60초 워치독). stdin은 쓰는 쪽이 열려 있는 FIFO = 단말처럼 EOF가 오지 않음 → </dev/null이 빠지면 옛 바이너리에서 멈춘다
mkfifo "$T/stdin"
review() {  # $1=reports 파일, 나머지 = 추가 env
  local rp="$1"; shift
  sleep 1000 > "$T/stdin" & local holder=$!
  env WR_GHJ="$T/bin/gh" WR_AGY="$T/bin/agy" WR_OUT="$T/out" TMPDIR="$T/" WR_LENSES=state \
      WAITING_ROOM_REPORTS="$rp" "$@" /bin/bash "$ROOT/.github/review/run_review.sh" 58 < "$T/stdin" > "$T/last.log" 2>&1 &
  local pid=$! n=0 rc
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1; n=$((n+1))
    [ "$n" -ge 60 ] && { pkill -P "$pid"; kill "$pid"; echo "멈춤(60초)"; break; }
  done
  wait "$pid" 2>/dev/null; rc=$?
  kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
  [ "$n" -ge 60 ] && return 99
  return "$rc"
}
types() { python3 -c 'import json,sys; print(" ".join(json.loads(l)["type"] + (":" + json.loads(l).get("state","") if json.loads(l)["type"] == "status" else "") for l in open(sys.argv[1])))' "$1"; }

# 1) 옛 바이너리 → 보고 끔, 멈추지 않음
review "$T/r-old.jsonl" WR_HOOK="$T/bin/old-wr-hook"; rc=$?
[ "$rc" = 0 ] || fail "옛 wr-hook: 종료 코드 $rc ($(tail -3 "$T/last.log"))"
[ "$(cat "$T/bin/old.log" 2>/dev/null)" = "report --help" ] || fail "옛 wr-hook: 기능 확인 한 번만 불러야 함: $(cat "$T/bin/old.log" 2>/dev/null)"
[ ! -e "$T/r-old.jsonl" ] || fail "옛 wr-hook: 보고 파일이 생김"
grep -q "report 기능이 없음" "$T/last.log" || fail "옛 wr-hook: 보고 끔 안내 없음"

# 2) 새 바이너리 (있을 때만)
NEW="${1:-}"
if [ -n "$NEW" ]; then
  review "$T/r-ok.jsonl" WR_HOOK="$NEW"; rc=$?
  [ "$rc" = 0 ] || fail "성공 실행: 종료 코드 $rc"
  t=$(types "$T/r-ok.jsonl")
  case "$t" in "hello status:working board"*"board status:done bye") ;; *) fail "성공 실행 순서: $t" ;; esac
  case "$t" in *"board board"*|*"board status:working board"*) ;; *) fail "poller 진행 보고(보드 갱신)가 없음: $t" ;; esac
  review "$T/r-fail.jsonl" WR_HOOK="$NEW" WR_AGY="$T/bin/badagy"; rc=$?
  [ "$rc" = 4 ] || fail "agy 실패: 종료 코드 $rc (4여야 함)"
  t=$(types "$T/r-fail.jsonl")
  case "$t" in *done*) fail "중단·실패에 done이 남음: $t" ;; *bye) ;; *) fail "중단·실패에 bye 없음: $t" ;; esac
  review "$T/r-off.jsonl" WR_HOOK="$NEW" WR_REPORT=0; [ ! -e "$T/r-off.jsonl" ] || fail "WR_REPORT=0인데 보고함"
  review "$T/r-dry.jsonl" WR_HOOK="$NEW" WR_DRY=1; [ ! -e "$T/r-dry.jsonl" ] || fail "WR_DRY=1인데 보고함"
fi
pgrep -f "$T/bin/agy" >/dev/null && fail "agy가 남아 있음"
[ "$FAILS" = 0 ] && echo "OK: run_review.sh Waitscape 보고 스모크${NEW:+ (새 wr-hook 포함)}" || exit 1

#!/usr/bin/env python3
"""트랜스크립트 전용 규칙 검사기(check_transcript_only.py)와 기대값(fixtures/transcript-only/expected.json)의 자체 점검.

    python3 scripts/selftest_transcript_only.py

Python 참조 서버에는 트랜스크립트 전용 엔진이 없으므로(RULES.md) 실제 구현 검증은 P1(wr-core engine)부터 한다.
그 전까지 CI는 다음만 확인한다.
  1. 기대값에서 만든 state는 검사기를 통과한다 (기대값 형식·검사기 동작이 맞음)
  2. 값 하나를 바꾼 state, 목록에서 빠져야 할 세션이 들어간 state는 실패한다 (검사기가 실제로 잡아냄)
종료 코드: 0 = 통과, 1 = 실패.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(ROOT, "scripts", "check_transcript_only.py")


def run_check(state, tmp, name):
    p = os.path.join(tmp, name + ".json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    return subprocess.run([sys.executable, CHECK, p], capture_output=True, text=True)


def main():
    with open(os.path.join(ROOT, "fixtures", "transcript-only", "expected.json"), encoding="utf-8") as f:
        exp = json.load(f)
    listed, hidden = [], []
    for sid, want in exp["cases"].items():
        w = dict(want)
        (listed if w.pop("listed", True) else hidden).append(dict(w, sid=sid))
    tmp = tempfile.mkdtemp(prefix="wr-to-selftest-")
    ok = True
    try:
        r = run_check({"sessions": listed}, tmp, "good")
        print("기대값 그대로: exit %d — %s" % (r.returncode, (r.stdout.strip().splitlines() or ["?"])[-1]))
        ok &= r.returncode == 0
        bad = json.loads(json.dumps(listed))
        bad[0]["status"] = "__broken__"
        r = run_check({"sessions": bad}, tmp, "bad")
        print("값 하나 변경: exit %d (1이어야 함)" % r.returncode)
        ok &= r.returncode == 1
        if hidden:
            r = run_check({"sessions": listed + [{"sid": hidden[0]["sid"]}]}, tmp, "hidden")
            print("숨길 세션 포함: exit %d (1이어야 함)" % r.returncode)
            ok &= r.returncode == 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

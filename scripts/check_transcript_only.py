#!/usr/bin/env python3
"""트랜스크립트 전용 엔진의 결과를 손으로 쓴 기대값과 부분 비교한다.

    python3 scripts/check_transcript_only.py <구현이 낸 state.json>

  - 구현은 fixtures/transcript-only/input/projects를 Claude projects 폴더로, fixtures/fixture.json의 now·tz로 돌려
    /state 모양(JSON)을 낸다(훅 이벤트 없음). 규칙: fixtures/transcript-only/RULES.md
  - 기대값(fixtures/transcript-only/expected.json)에 적힌 키만 비교. 배열의 객체도 적힌 키만. 숫자 허용 오차 1e-6.
종료 코드: 0 = 통과, 1 = 실패.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sub(exp, act, path, out):
    if isinstance(exp, dict):
        if not isinstance(act, dict):
            out.append("%s: 객체가 아님 (%r)" % (path, act))
            return
        for k, v in exp.items():
            if k not in act:
                out.append("%s.%s: 없음" % (path, k))
            else:
                sub(v, act[k], "%s.%s" % (path, k), out)
    elif isinstance(exp, list):
        if not isinstance(act, list) or len(act) != len(exp):
            out.append("%s: 길이/형식 다름 (기대 %d, 실제 %r)" % (path, len(exp), len(act) if isinstance(act, list) else act))
            return
        for i, (e, a) in enumerate(zip(exp, act)):
            sub(e, a, "%s[%d]" % (path, i), out)
    elif isinstance(exp, (int, float)) and not isinstance(exp, bool) and isinstance(act, (int, float)) and not isinstance(act, bool):
        if not math.isclose(exp, act, abs_tol=1e-6, rel_tol=0):
            out.append("%s: 기대 %r, 실제 %r" % (path, exp, act))
    elif exp != act:
        out.append("%s: 기대 %r, 실제 %r" % (path, exp, act))


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    with open(os.path.join(ROOT, "fixtures", "transcript-only", "expected.json"), encoding="utf-8") as f:
        exp = json.load(f)
    with open(argv[0], encoding="utf-8") as f:
        st = json.load(f)
    by = {s["sid"]: s for s in st.get("sessions", [])}
    bad = 0
    for sid, want in exp["cases"].items():
        want = dict(want)
        listed = want.pop("listed", True)
        out = []
        if not listed:
            if sid in by:
                out.append("목록에 없어야 함")
        elif sid not in by:
            out.append("목록에 없음")
        else:
            sub(want, by[sid], sid, out)
        print(("✗ " if out else "✓ ") + sid)
        for line in out:
            print("    " + line)
        bad += bool(out)
    print("%s: %d/%d 케이스 통과" % ("OK" if not bad else "FAIL", len(exp["cases"]) - bad, len(exp["cases"])))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""web/modes/*/mode.json을 types/mode.schema.json(JSON Schema 2020-12)으로 검증한다.

    pip install jsonschema   # CI는 버전을 고정해 설치
    python3 scripts/validate_modes.py [mode.json ...]   # 인자가 없으면 web/modes/*/mode.json 전부

추가 검사: 검증하는 모든 mode.json은 폴더 이름 = `id`(스타터 `_template`은 복사용이라 예외). 인자가 없으면 web/modes/index.json의 내장 모드에 폴더가 있는지도 본다. 깨진 JSON은 예외 없이 "읽기 실패"로 보고.
종료 코드: 0 = 통과, 1 = 실패.
"""
import glob
import json
import os
import sys

from jsonschema import Draft202012Validator

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    schema = load(os.path.join(ROOT, "types", "mode.schema.json"))
    Draft202012Validator.check_schema(schema)
    v = Draft202012Validator(schema)
    paths = argv or sorted(glob.glob(os.path.join(ROOT, "web", "modes", "*", "mode.json")))
    bad = 0
    for p in paths:
        rel = os.path.relpath(p, ROOT)
        try:
            doc = load(p)
        except (OSError, ValueError) as e:
            print("✗ %s: 읽기 실패 (%s)" % (rel, e))
            bad += 1
            continue
        errs = sorted(v.iter_errors(doc), key=lambda e: list(e.path))
        msgs = ["%s: %s" % ("/".join(map(str, e.path)) or "(root)", e.message) for e in errs]
        folder = os.path.basename(os.path.dirname(os.path.abspath(p)))
        if folder != "_template" and isinstance(doc, dict) and doc.get("id") != folder:
            msgs.append("id가 폴더 이름(%s)과 다름" % folder)
        print(("✗ " if msgs else "✓ ") + rel)
        for m in msgs:
            print("    " + m)
        bad += bool(msgs)
    if not argv:
        try:
            builtin = load(os.path.join(ROOT, "web", "modes", "index.json")).get("builtin", [])
        except (OSError, ValueError) as e:
            print("✗ web/modes/index.json: 읽기 실패 (%s)" % e)
            return 1
        for mid in builtin:
            if not os.path.isfile(os.path.join(ROOT, "web", "modes", mid, "mode.json")):
                print("✗ index.json: 내장 모드 %s의 mode.json 없음" % mid)
                bad += 1
    print("%s: %d/%d 통과" % ("OK" if not bad else "FAIL", len(paths) - min(bad, len(paths)), len(paths)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

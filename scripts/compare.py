#!/usr/bin/env python3
"""기준 결과(JSON)와 다른 구현(예: Rust wr-core)의 결과를 정규화해서 비교한다.

    python3 scripts/compare.py <기준 폴더> <비교 폴더> [--ignore-now] [--ignore k1,k2] [--max N]

  - 기준 폴더의 *.json마다 비교 폴더에 같은 이름의 파일이 있어야 한다(없으면 실패).
  - 키 순서 무시, 숫자는 int/float 구분 없이 |a-b| <= 1e-6 이면 같음.
  - /trace의 cursor는 "<gen>.<prompt>.<v>" 중 앞 두 부분만 비교한다(v는 구현별 내부 카운터라 값이 달라도 됨.
    대신 같은 since로 다시 물었을 때 돌려주는 steps가 같은지로 검증된다).
  - --ignore-now: 최상위 now 필드를 비교하지 않음(시계를 주입하지 못하는 구현용).
  - --ignore k1,k2: 이름이 같은 키를 어느 깊이에서든 비교하지 않음. Python 기준에 없는 1.1 추가 필드용
    (예: Rust 결과의 provider,providers — 프로바이더 구조에서 추가된 optional 필드).
종료 코드: 0 = 같음, 1 = 다름.
"""
import json
import math
import os
import sys

TOL = 1e-6


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def diff(a, b, path, out, ignore_now, ignore=()):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = path + "." + k if path else k
            if ignore_now and p == "now":
                continue
            if k in ignore:
                continue
            if k not in b:
                out.append("%s: 비교 쪽에 없음 (기준=%s)" % (p, _short(a[k])))
            elif k not in a:
                out.append("%s: 기준에 없는 필드 (비교=%s)" % (p, _short(b[k])))
            elif k == "cursor" and isinstance(a[k], str) and isinstance(b[k], str):
                if a[k].rsplit(".", 1)[0] != b[k].rsplit(".", 1)[0]:
                    out.append("%s: %r != %r (gen.prompt 부분)" % (p, a[k], b[k]))
            else:
                diff(a[k], b[k], p, out, ignore_now, ignore)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append("%s: 길이 %d != %d" % (path, len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, "%s[%d]" % (path, i), out, ignore_now, ignore)
    elif _num(a) and _num(b):
        if not (math.isclose(a, b, abs_tol=TOL, rel_tol=0)):
            out.append("%s: %r != %r" % (path, a, b))
    elif a != b or type(a) is not type(b):
        out.append("%s: %s != %s" % (path, _short(a), _short(b)))


def _short(v, n=80):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n - 1] + "…"


def compare_dirs(exp_dir, act_dir, ignore_now=False, max_lines=20, quiet=False, ignore=()):
    names = sorted(f for f in os.listdir(exp_dir) if f.endswith(".json"))
    bad = 0
    for nm in names:
        ap = os.path.join(act_dir, nm)
        if not os.path.exists(ap):
            print("✗ %s: 비교 폴더에 파일 없음" % nm)
            bad += 1
            continue
        with open(os.path.join(exp_dir, nm), encoding="utf-8") as f:
            a = json.load(f)
        with open(ap, encoding="utf-8") as f:
            b = json.load(f)
        out = []
        diff(a, b, "", out, ignore_now, ignore)
        if out:
            bad += 1
            print("✗ %s: 차이 %d건" % (nm, len(out)))
            for line in out[:max_lines]:
                print("    " + line)
            if len(out) > max_lines:
                print("    … (%d건 더)" % (len(out) - max_lines))
        elif not quiet:
            print("✓ %s" % nm)
    extra = sorted(set(f for f in os.listdir(act_dir) if f.endswith(".json")) - set(names))
    for nm in extra:
        print("! %s: 기준에 없는 파일(무시)" % nm)
    print("%s: %d/%d 파일 일치" % ("OK" if not bad else "FAIL", len(names) - bad, len(names)))
    return bad == 0


def main(argv):
    mx = 20
    ignore = ()
    if "--ignore" in argv:
        i = argv.index("--ignore")
        ignore = tuple(k for k in argv[i + 1].split(",") if k)
        argv = argv[:i] + argv[i + 2:]
    if "--max" in argv:
        i = argv.index("--max")
        mx = int(argv[i + 1])
        argv = argv[:i] + argv[i + 2:] + ["--max"]
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 2
    return 0 if compare_dirs(args[0], args[1], "--ignore-now" in argv, mx, ignore=ignore) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

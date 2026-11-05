#!/usr/bin/env python3
"""🧪 테스트 배지(#138) 판정 동등성: wr-core scan.rs 단위 테스트의 명령 표(CMD_YES·CMD_NO)와 판정 예를
server.py의 같은 규칙으로 다시 확인한다. 정규식 문자열도 두 구현이 같은지 본다. 파일만 읽음(서버를 띄우지 않음)."""
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUST = open(os.path.join(ROOT, "crates/wr-core/src/providers/claude/scan.rs"), encoding="utf-8").read()
spec = importlib.util.spec_from_file_location("server", os.path.join(ROOT, "server.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)


def rust_list(name):
    body = re.search(r"pub const %s: &\[&str\] = &\[(.*?)\];" % name, RUST, re.S).group(1)
    return [json.loads(m) for m in re.findall(r'"(?:[^"\\]|\\.)*"', body)]


bad = 0
for n in ("TEST", "UNQUOTE", "PIPE", "DENIED", "BG", "FAIL", "PASS"):
    r = re.search(r"pub const %s_PAT: &str =\s*r(#?)\"(.*?)\"\1;\n" % n, RUST).group(2)
    if getattr(S, n + "_RE").pattern != r:
        print("정규식 다름:", n)
        bad += 1
yes, no = rust_list("CMD_YES"), rust_list("CMD_NO")
for c in yes:
    if not S.TEST_RE.search(S._shape(c)):
        print("테스트로 봐야 함:", c)
        bad += 1
for c in no:
    if S.TEST_RE.search(S._shape(c)):
        print("테스트가 아님:", c)
        bad += 1
V = [
    ("Permission for this command was denied by a built-in Claude Code safety check", True, False, None),
    ("Command running in background with ID: b1", False, False, None),
    ("running 3 tests\ntest result: FAILED. 2 passed; 1 failed", False, True, "fail"),
    ("test result: ok. 75 passed; 0 failed", False, True, "pass"),
    ("test_inbox: ok", False, True, "pass"),
    ("compiling...\n(출력 일부)", False, True, "ran"),
    ("done", False, False, "pass"),
    ("Exit code 1", True, False, "fail"),
    ("FAILED earlier\n" + "x" * 5000 + "\ntest result: ok. 3 passed", False, True, "pass"),
]
for t, e, p, want in V:
    got = S.verdict(t, e, p)
    if got != want:
        print("판정 다름:", repr(t[:40]), got, "≠", want)
        bad += 1
print("test_test_badge: %s (명령 %d·%d, 판정 %d)" % ("ok" if not bad else "FAIL %d" % bad, len(yes), len(no), len(V)))
sys.exit(1 if bad else 0)

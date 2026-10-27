#!/usr/bin/env python3
"""check_secrets.py 탐지 패턴 회귀 테스트. 시크릿·경로 형태 문자열은 조각으로 이어 붙여 만든다(이 파일 자체가 걸리지 않게).

    python3 scripts/selftest_check_secrets.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_secrets as cs  # noqa: E402

U = "/Us" + "ers/"
H = "/ho" + "me/"
WIN = "C:" + "\\" + "Users" + "\\"
AWS = "AK" + "IA" + "A1B2C3D4E5F6G7H8"
PAT = "gh" + "p_" + "a" * 36
SLACK = "xo" + "xb-" + "1234567890-abc"
ANT = "sk-" + "ant-" + "a" * 24
DU = "-Us" + "ers-"
DH = "-ho" + "me-"

# (이름, 줄, 탐지돼야 하는가)
CASES = [
    ("점 포함 사용자", U + "alex.kim/w", True),
    ("하이픈 포함 사용자", U + "me-mac/r", True),
    ("일반 사용자", U + "alexander/x", True),
    ("home 경로", H + "bob/x", True),
    ("윈도 경로", WIN + "bob" + "\\x", True),
    ("합성 사용자 alex", U + "alex/w", False),
    ("CI runner", H + "runner/work", False),
    ("문서 예시 me", U + "me/proj", False),
    ("문서 예시 <이름>", U + "<name>/x", False),
    ("$USER", H + "$USER/x", False),
    ("%USERNAME%", WIN + "%USERNAME%" + "\\x", False),
    ("대시 인코딩 사용자", "projects/" + DU + "bob-dev-app", True),
    ("대시 인코딩 home", DH + "carol-work", True),
    ("대시 인코딩 숨김 폴더", DU + "dave--claude-mem-x", True),
    ("대시 인코딩 합성 alex", "projects/" + DU + "alex-dev-app", False),
    ("대시 인코딩 합성 a", DU + "a--claude-mem-x", False),
    ("대시 인코딩 runner", DH + "runner-work", False),
    ("대시 인코딩 줄 끝", "cd " + DU + "bob", True),
    ("대시 인코딩 / 앞", "projects/" + DU + "bob/x.jsonl", True),
    ("대시 인코딩 윈도", "C-" + DU + "bob-dev", True),
    ("대시 인코딩 합성 alex 줄 끝", DU + "alex", False),
    ("CSS 변수 --home-", "var(-" + DH + "bg-color)", False),
    ("CLI 옵션 --home-", "-" + DH + "dir-override", False),
    ("AWS 키", AWS, True),
    ("한글 바로 뒤 AWS 키", "키는" + AWS, True),
    ("한글 바로 뒤 PAT", "토큰" + PAT, True),
    ("한글 바로 뒤 Slack", "슬랙" + SLACK, True),
    ("한글 바로 뒤 Anthropic", "키" + ANT, True),
    ("정규식 소스·예시는 통과", "sk-ant-… ghp_ AKIA[0-9A-Z]{16}", False),
]


def hit(line):
    return any(rx.search(line) for _, rx in cs.PATTERNS)


def main():
    bad = [n for n, line, want in CASES if hit(line) != want]
    for n in bad:
        print("✗ " + n)
    print("%s: %d/%d 통과" % ("FAIL" if bad else "OK", len(CASES) - len(bad), len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

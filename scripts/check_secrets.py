#!/usr/bin/env python3
"""저장소에 커밋된 파일에서 실제 형태의 시크릿·개인 경로를 찾는다. CI와 커밋 전 확인용.

    python3 scripts/check_secrets.py            # git ls-files 전체 검사
    python3 scripts/check_secrets.py --leak     # + fixtures/expected에 가짜 시크릿 원문(이어 붙인 값)이 남았는지

검사 패턴(실제 키 모양만. 정규식 소스·자리표시자·문서의 `sk-ant-…` 같은 예시는 걸리지 않게 길이를 요구)
  AWS Access Key  AKIA + 대문자/숫자 16자
  GitHub PAT      ghp_/gho_/ghu_/ghs_/ghr_ + 36자, github_pat_ + 22자 이상
  Slack Token     xoxa-/xoxb-/xoxp-/xoxr-/xoxs- + 10자 이상
  Anthropic Key   sk-ant- + 20자 이상
  개인 홈 경로     /Users/<이름>, /home/<이름>, C:\\Users\\<이름> (합성 사용자 alex, CI runner, 문서 예시 me/user/<이름>/%USERNAME%/$USER는 제외. alex.kim·me-mac처럼 점·하이픈이 이어진 이름은 탐지)
  대시 인코딩 홈   -Users-<이름>, -home-<이름> (Claude Code 프로젝트 폴더 이름 형태, 줄 끝·`/` 앞도. C--Users-<이름>(윈도)도 탐지.
                  합성 이름 alex·a·user·me·runner·name은 제외. --home-bg-color 같은 CSS 변수·옵션은 제외)
                  한계: 인코딩이 점·슬래시를 모두 '-'로 바꾸므로 사용자명 alex.kim의 폴더(-Users-alex-kim-…)는 alex 아래 kim 폴더와 구별할 수 없어 통과한다.
가짜 시크릿(fixtures/fake_secrets.json)은 조각으로만 저장돼 있어 이 검사에 걸리지 않는다.
종료 코드: 0 = 통과, 1 = 발견.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = [
    ("AWS Access Key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub PAT", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("GitHub PAT (fine-grained)", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}")),
    ("Slack Token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("Anthropic API Key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("개인 홈 경로", re.compile(r"(?:/Users/|/home/|[Cc]:\\\\?Users\\\\?)(?!(?:alex|runner|me|user|USERNAME)(?![A-Za-z0-9._-])|[<%$])[A-Za-z0-9._-]+")),
    ("개인 홈 경로(대시 인코딩)", re.compile(r"(?:(?<![A-Za-z0-9])-Users-|(?<![A-Za-z0-9-])-home-)(?!(?:alex|a|user|me|runner|name)(?![A-Za-z0-9]))[A-Za-z0-9]+")),
]
# 한글 등 비ASCII 문자 바로 뒤에 붙은 시크릿도 잡도록 \b를 ASCII 기준으로(유니코드 \w 아님)
PATTERNS = [(name, re.compile(rx.pattern, re.ASCII)) for name, rx in PATTERNS]
SKIP_EXT = {".png", ".jpg", ".webp", ".gif", ".woff2", ".ttf", ".mp3", ".ogg", ".wav", ".ico"}


def tracked_files():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout
    return [p for p in out.decode().split("\0") if p]


def scan_patterns():
    found = []
    for rel in tracked_files():
        if os.path.splitext(rel)[1].lower() in SKIP_EXT:
            continue
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for n, line in enumerate(f, 1):
                for name, rx in PATTERNS:
                    m = rx.search(line)
                    if m:
                        # 값 전체를 출력하지 않는다(로그에 시크릿이 남지 않게)
                        found.append("%s:%d: %s (%s…)" % (rel, n, name, m.group(0)[:8]))
    return found


def scan_leaks():
    with open(os.path.join(ROOT, "fixtures", "fake_secrets.json"), encoding="utf-8") as f:
        d = json.load(f)
    fakes = {k: "".join(v) for k, v in d.items() if not k.startswith("$")}
    found = []
    exp = os.path.join(ROOT, "fixtures", "expected")
    for base, _, files in os.walk(exp):
        for nm in sorted(files):
            p = os.path.join(base, nm)
            with open(p, encoding="utf-8", errors="replace") as f:
                text = f.read()
            for k, v in fakes.items():
                if v in text:
                    found.append("%s: 가짜 시크릿 %s 원문이 마스킹되지 않음" % (os.path.relpath(p, ROOT), k))
    return found


def main(argv):
    bad = scan_patterns()
    if "--leak" in argv:
        bad += scan_leaks()
    for b in bad:
        print("✗ " + b)
    print("%s: %d건" % ("FAIL" if bad else "OK", len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

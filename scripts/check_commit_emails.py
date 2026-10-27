#!/usr/bin/env python3
"""커밋 작성자·커미터 이메일이 차단 도메인에 속하면 실패한다.

차단 도메인은 코드에 두지 않고 환경변수 BLOCKED_EMAIL_DOMAINS(쉼표 구분, CI에서는 저장소 시크릿)로 받는다.
로그에 이메일을 출력하지 않는다(커밋 해시만).

사용: python scripts/check_commit_emails.py <base>..<head>
"""
import os
import subprocess
import sys


def main():
    domains = [d.strip().lower().lstrip("@") for d in os.environ.get("BLOCKED_EMAIL_DOMAINS", "").split(",") if d.strip()]
    if not domains:
        print("차단 도메인이 설정되지 않아 건너뜀 (BLOCKED_EMAIL_DOMAINS)")
        return 0
    rev = sys.argv[1] if len(sys.argv) > 1 else "HEAD~1..HEAD"
    out = subprocess.run(["git", "log", "--format=%H %ae %ce", rev], capture_output=True, text=True, check=True).stdout
    bad = []
    for line in out.splitlines():
        sha, *emails = line.split()
        if any(e.lower().rsplit("@", 1)[-1] == d or e.lower().endswith("." + d) for e in emails for d in domains):
            bad.append(sha[:7])
    if bad:
        print(f"차단된 도메인의 이메일로 만든 커밋 {len(bad)}개: {', '.join(bad)}")
        print("개인 계정 이메일(권장: GitHub noreply)로 작성자를 고친 뒤 다시 올려 주세요 (CONTRIBUTING.md §2).")
        return 1
    print(f"커밋 작성자 이메일 검사 통과 ({len(out.splitlines())}개)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

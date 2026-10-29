#!/usr/bin/env python3
"""third_party_licenses.py 회귀 테스트 (#9): SPDX 식 허용 판정, 원문이 없는 패키지의 표준 원문 채우기. cargo 없이 돈다."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from third_party_licenses import allowed, fallback_text  # noqa: E402

n = 0


def ok(cond, msg):
    global n
    n += 1
    if not cond:
        print("실패:", msg)
        sys.exit(1)


# 허용 판정
ok(allowed("MIT"), "MIT")
ok(allowed("MIT OR Apache-2.0"), "OR")
ok(allowed("MIT/Apache-2.0"), "옛 표기 /")
ok(allowed("(MIT OR Apache-2.0) AND Unicode-3.0"), "괄호 + AND")
ok(allowed("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT"), "WITH")
ok(allowed("MIT OR Apache-2.0 OR LGPL-2.1-or-later"), "OR이면 하나만 맞아도")
ok(not allowed("GPL-3.0-only"), "GPL은 안 됨")
ok(not allowed("MIT AND GPL-3.0-only"), "AND는 모두 맞아야")
ok(not allowed(""), "표기 없음은 안 됨")
ok(not allowed("MIT OR"), "깨진 식은 안 됨")
ok(not allowed("(MIT"), "괄호 짝이 안 맞으면 안 됨")

# 표준 원문 채우기
p = {"name": "demo", "version": "1.0.0", "license": "Zlib OR Apache-2.0 OR MIT", "authors": ["Ann Lee <ann@example.com>"]}
kind, text = fallback_text(p, {})
ok(kind == "MIT" and "Copyright (c) Ann Lee\n" in text and "ann@example.com" not in text, "OR이면 MIT 먼저, 저작권 줄은 이름만")
kind, text = fallback_text({"name": "b", "version": "1", "license": "BSD-3-Clause", "authors": []}, {})
ok(kind == "BSD-3-Clause" and "b contributors" in text, "authors가 없으면 '<이름> contributors'")
kind, text = fallback_text({"name": "s", "version": "1", "license": "MPL-2.0"}, {"MPL-2.0": "Mozilla Public License Version 2.0"})
ok(kind == "MPL-2.0" and text.startswith("Mozilla"), "그 밖은 같은 라이선스의 다른 패키지 원문")
ok(fallback_text({"name": "x", "version": "1", "license": "ISC"}, {}) is None, "원문을 구할 수 없으면 None(목록에 따로 표시)")

print(f"OK: {n}/{n}")

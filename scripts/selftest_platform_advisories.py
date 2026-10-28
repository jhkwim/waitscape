#!/usr/bin/env python3
"""check_platform_advisories.py 회귀 테스트 (#15). 파일을 쓰지 않는다."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_platform_advisories import check, lock_versions, release_platforms, vtuple  # noqa: E402

RELEASE = """
jobs:
  guard:
    runs-on: ubuntu-latest
  build:
    strategy:
      matrix:
        include:
          - name: macOS universal
            os: macos-latest
          - name: Windows x64
            os: windows-latest
"""
LOCK = '''[[package]]
name = "glib"
version = "0.18.5"
source = "registry"

[[package]]
name = "tokio"
version = "1.54.1"
'''
ADV = [{"id": "GHSA-x", "alert": 1, "package": "glib", "fixed": "0.20.0", "platforms": ["linux"], "reason": ""}]

n = 0


def ok(cond, msg):
    global n
    n += 1
    if not cond:
        print("실패:", msg)
        sys.exit(1)


plats = release_platforms(RELEASE)
ok(plats == {"macos", "windows"}, f"보조 잡의 runs-on: ubuntu는 배포 대상이 아님 ({plats})")
ok(release_platforms(RELEASE + "          - os: ubuntu-22.04\n") == {"macos", "windows", "linux"}, "matrix에 ubuntu가 들어오면 linux")
ok(release_platforms("        os: [ubuntu-latest, macos-14]\n") == {"linux", "macos"}, "목록 형식도 읽음")
ok(release_platforms(RELEASE + "            args: --bundles deb,appimage\n") >= {"linux"}, "Linux 번들 형식이 있으면 linux")
ok(lock_versions(LOCK) == {"glib": ["0.18.5"], "tokio": ["1.54.1"]}, "Cargo.lock 파싱")
ok(vtuple("0.20.0") > vtuple("0.18.5") and vtuple("1.2.3-rc.1") == (1, 2, 3), "버전 비교")

errs, notes = check(ADV, plats, lock_versions(LOCK))
ok(not errs and not notes, "macOS·Windows만 배포하면 통과")
errs, _ = check(ADV, plats | {"linux"}, lock_versions(LOCK))
ok(len(errs) == 1 and "#1" in errs[0] and "linux" in errs[0], "linux가 배포 대상이 되면 실패")
errs, notes = check(ADV, plats | {"linux"}, {"glib": ["0.20.1"]})
ok(not errs and len(notes) == 1, "고친 버전이면 실패 대신 '기록 지워도 됨' 안내")
errs, _ = check(ADV, plats | {"linux"}, {"glib": ["0.18.5", "0.20.1"]})
ok(len(errs) == 1, "취약한 버전이 하나라도 남아 있으면 실패")

print(f"OK: {n}/{n}")

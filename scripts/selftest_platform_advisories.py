#!/usr/bin/env python3
"""check_platform_advisories.py 회귀 테스트 (#15). 파일을 쓰지 않는다."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_platform_advisories import check, lock_versions, release_platforms, vkey  # noqa: E402

# 지금 release.yml 모양: 보조 잡(guard·draft-release)은 ubuntu, 빌드 잡은 macOS·Windows
BASE = """
on:
  push:
    tags: ["v*"]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - run: echo ref
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - name: macOS universal
            os: macos-latest
            args: --target universal-apple-darwin --bundles app,dmg
          - name: Windows x64
            os: windows-latest
            args: --bundles nsis,msi   # deb는 아직 안 냄 (주석은 무시)
    steps:
      - run: npx @tauri-apps/cli build ${{ matrix.args }}
  draft-release:
    runs-on: ubuntu-latest
    steps:
      - run: gh release create
"""
LOCK = '''[[package]]
name = "glib"
version = "0.18.5"
source = "registry"
checksum = "abc"

[[package]]
name = "tokio"
version = "1.54.1"
'''
ADV = [{"id": "GHSA-x", "alert": 1, "package": "glib", "fixed": "0.20.0", "platforms": ["linux"], "reason": ""}]
CONF = ["app", "dmg", "nsis", "msi"]

n = 0


def ok(cond, msg):
    global n
    n += 1
    if not cond:
        print("실패:", msg)
        sys.exit(1)


def add_to_build(extra: str) -> str:
    """빌드 잡 matrix include 끝에 줄을 더한다."""
    return BASE.replace("    steps:\n      - run: npx", extra + "    steps:\n      - run: npx", 1)


plats = release_platforms(BASE, CONF)
ok(plats == {"macos", "windows"}, f"지금 모양: 보조 잡의 ubuntu·주석의 deb는 배포 아님 ({plats})")

# Linux를 더하는 여러 방식은 모두 잡혀야 한다(놓치면 경고가 묻힘)
cases = {
    "matrix os: ubuntu": add_to_build("          - name: Linux\n            os: ubuntu-22.04\n"),
    "matrix platform: 키(tauri-action 예제)": add_to_build("          - platform: ubuntu-22.04\n"),
    "번들 deb": add_to_build("            args: --bundles deb\n"),
    "번들 --bundles=all": add_to_build("            args: --bundles=all\n"),
    "번들 -b all": add_to_build("            args: -b all\n"),
    "linux 타깃 triple": add_to_build("            args: --target x86_64-unknown-linux-gnu\n"),
    "새 빌드 잡 runs-on ubuntu": BASE + "  build-linux:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: cargo tauri build\n",
    "self-hosted 러너": BASE + "  build-sh:\n    runs-on: [self-hosted, x64]\n    steps:\n      - uses: tauri-apps/tauri-action@v0\n",
    "목록 형식 os": BASE.replace("          - name: macOS universal\n", "          - os: [macos-latest, ubuntu-latest]\n          - name: macOS universal\n"),
}
for name, yml in cases.items():
    ok("linux" in release_platforms(yml, CONF), f"Linux 추가를 놓침: {name}")
ok("linux" in release_platforms(BASE, CONF + ["deb"]), "tauri.conf.json bundle.targets에 deb")
ok("linux" in release_platforms(BASE, "all"), "tauri.conf.json bundle.targets = \"all\"")
ok(release_platforms(BASE.replace("npx @tauri-apps/cli build", "echo"), CONF) == set(), "빌드 잡이 없으면 빈 결과(스크립트가 실패로 막음)")

ok(lock_versions(LOCK) == {"glib": ["0.18.5"], "tokio": ["1.54.1"]}, "Cargo.lock 파싱")
ok(vkey("0.20.0") > vkey("0.18.5"), "버전 비교")
ok(vkey("0.20.0-alpha.1") < vkey("0.20.0") < vkey("0.20.1"), "프리릴리스는 정식보다 작음")

errs, notes = check(ADV, plats, lock_versions(LOCK))
ok(not errs and not notes, "macOS·Windows만 배포하면 통과")
errs, _ = check(ADV, plats | {"linux"}, lock_versions(LOCK))
ok(len(errs) == 1 and "#1" in errs[0] and "linux" in errs[0], "linux가 배포 대상이 되면 실패")
errs, notes = check(ADV, plats | {"linux"}, {"glib": ["0.20.1"]})
ok(not errs and len(notes) == 1, "고친 버전이면 실패 대신 '기록 지워도 됨' 안내")
errs, _ = check(ADV, plats | {"linux"}, {"glib": ["0.18.5", "0.20.1"]})
ok(len(errs) == 1, "취약한 버전이 하나라도 남아 있으면 실패")
errs, _ = check(ADV, plats | {"linux"}, {"glib": ["0.20.0-alpha.1"]})
ok(len(errs) == 1, "고친 버전의 프리릴리스는 아직 취약")

print(f"OK: {n}/{n}")

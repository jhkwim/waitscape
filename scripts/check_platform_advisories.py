#!/usr/bin/env python3
"""배포 대상에서 쓰이지 않아 닫은 보안 경고가 다시 유효해졌는지 검사한다 (#15).

.github/platform-advisories.json의 각 경고에 대해:
- release.yml 빌드 matrix의 `os:` 값으로 배포 플랫폼(macos·windows·linux)을 정하고,
- Cargo.lock에 아직 취약한 버전(fixed 미만)이 있는데 영향 플랫폼이 배포 대상에 들어오면 실패한다.
- 취약한 버전이 Cargo.lock에서 사라졌으면 기록을 지워도 된다고 알린다(실패 아님).

사용: python3 scripts/check_platform_advisories.py [--root 경로]
"""
import json
import pathlib
import re
import sys


def release_platforms(release_yml: str) -> set:
    """release.yml의 matrix `os:` 값(한 줄·목록 형식)과 Linux 번들 형식(deb·appimage·rpm)으로 배포 플랫폼을 정한다.
    runs-on 고정값인 보조 잡(guard·release)은 배포 대상이 아니라서 보지 않는다."""
    plats = set()
    names = re.findall(r"^\s+(?:-\s+)?os:\s*['\"]?([\w.-]+)", release_yml, re.M)
    for lst in re.findall(r"^\s+os:\s*\[([^\]]*)\]", release_yml, re.M):
        names += [x.strip(" '\"") for x in lst.split(",")]
    if re.search(r"--bundles\s+\S*\b(deb|appimage|rpm)\b", release_yml, re.I):
        plats.add("linux")
    for os_name in names:
        o = os_name.lower()
        if o.startswith("macos"):
            plats.add("macos")
        elif o.startswith("windows"):
            plats.add("windows")
        elif o.startswith(("ubuntu", "linux")):
            plats.add("linux")
    return plats


def lock_versions(cargo_lock: str) -> dict:
    """Cargo.lock의 [[package]] 이름 → 버전 목록."""
    out = {}
    for m in re.finditer(r'^\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', cargo_lock, re.M):
        out.setdefault(m.group(1), []).append(m.group(2))
    return out


def vtuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v.split("-")[0].split("+")[0])[:3])


def check(advisories: list, plats: set, versions: dict):
    """(실패 메시지 목록, 안내 메시지 목록)"""
    errs, notes = [], []
    for a in advisories:
        bad = [v for v in versions.get(a["package"], []) if vtuple(v) < vtuple(a["fixed"])]
        hit = sorted(set(a["platforms"]) & plats)
        if not bad:
            notes.append(f"{a['package']}: 취약한 버전이 Cargo.lock에 없어요 → {a['id']} 기록을 지워도 돼요")
        elif hit:
            errs.append(
                f"{a['package']} {', '.join(bad)} ({a['id']}, Dependabot 경고 #{a['alert']}): "
                f"영향 플랫폼 {', '.join(hit)}이(가) 이제 배포 대상이에요. 경고를 다시 열고 {a['fixed']} 이상으로 올리세요"
            )
    return errs, notes


def main(argv) -> int:
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else pathlib.Path(__file__).resolve().parent.parent
    data = json.loads((root / ".github/platform-advisories.json").read_text(encoding="utf-8"))
    plats = release_platforms((root / ".github/workflows/release.yml").read_text(encoding="utf-8"))
    if not plats:
        print("release.yml에서 배포 대상(os)을 찾지 못했어요", file=sys.stderr)
        return 1
    errs, notes = check(data["advisories"], plats, lock_versions((root / "Cargo.lock").read_text(encoding="utf-8")))
    for n in notes:
        print("안내:", n)
    for e in errs:
        print("::error::" + e)
    if not errs:
        print(f"OK: 배포 대상 {', '.join(sorted(plats))} · 기록된 경고 {len(data['advisories'])}건 모두 대상 밖")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

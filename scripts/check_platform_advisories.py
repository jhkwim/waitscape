#!/usr/bin/env python3
"""배포 대상에서 쓰이지 않아 닫은 보안 경고가 다시 유효해졌는지 검사한다 (#15).

.github/platform-advisories.json의 각 경고에 대해:
- release.yml의 앱 빌드 잡(tauri를 부르는 잡)과 tauri.conf.json bundle.targets로 배포 플랫폼(macos·windows·linux)을 넓게 정하고,
- Cargo.lock에 아직 취약한 버전(fixed 미만)이 있는데 영향 플랫폼이 배포 대상에 들어오면 실패한다.
- 취약한 버전이 Cargo.lock에서 사라졌으면 기록을 지워도 된다고 알린다(실패 아님).

사용: python3 scripts/check_platform_advisories.py [--root 경로]
"""
import json
import pathlib
import re
import sys


LINUX = re.compile(r"ubuntu|linux|self-hosted|\b(deb|appimage|rpm)\b|--bundles[=\s]+all\b|-b\s+all\b", re.I)


def build_jobs(release_yml: str) -> dict:
    """release.yml의 잡 중 앱을 빌드하는 잡(tauri를 부르는 잡)만, 주석을 뺀 본문으로 돌려준다.
    YAML 라이브러리 없이 `jobs:` 아래 두 칸 들여쓴 잡 이름으로 나눈다."""
    lines = [ln.split(" #")[0] if not ln.lstrip().startswith("#") else "" for ln in release_yml.splitlines()]
    try:
        i = next(k for k, ln in enumerate(lines) if ln.rstrip() == "jobs:")
    except StopIteration:
        return {}
    jobs, cur = {}, None
    for ln in lines[i + 1:]:
        m = re.match(r"^  ([\w-]+):\s*$", ln)
        if m:
            cur = m.group(1)
            jobs[cur] = ""
        elif cur and ln.strip():
            jobs[cur] += ln + "\n"
    return {k: v for k, v in jobs.items() if re.search(r"tauri", v, re.I)}


def release_platforms(release_yml: str, bundle_targets=None) -> set:
    """배포 플랫폼을 넓게(실패하는 쪽으로) 판정한다.
    - 빌드 잡(tauri를 부르는 잡) 안에 ubuntu·linux·self-hosted 러너, Linux 번들(deb·appimage·rpm·all)이 보이면 linux.
      러너를 matrix의 어떤 키(os·platform…)로 주든, runs-on에 직접 쓰든, 새 잡을 만들든 잡힌다.
      빌드하지 않는 보조 잡(실행 ref 확인·초안 릴리스)의 ubuntu 러너는 배포가 아니라서 보지 않는다.
    - tauri.conf.json의 bundle.targets에 Linux 형식이나 "all"이 있으면 linux.
    - macos·windows는 빌드 잡의 러너 이름으로."""
    plats = set()
    for body in build_jobs(release_yml).values():
        if LINUX.search(body):
            plats.add("linux")
        if re.search(r"macos", body, re.I):
            plats.add("macos")
        if re.search(r"windows", body, re.I):
            plats.add("windows")
    targets = bundle_targets if isinstance(bundle_targets, list) else [bundle_targets] if bundle_targets else []
    if any(str(t).lower() in ("all", "deb", "appimage", "rpm") for t in targets):
        plats.add("linux")
    return plats


def lock_versions(cargo_lock: str) -> dict:
    """Cargo.lock의 [[package]] 이름 → 버전 목록."""
    out = {}
    for m in re.finditer(r'^\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', cargo_lock, re.M):
        out.setdefault(m.group(1), []).append(m.group(2))
    return out


def vkey(v: str) -> tuple:
    """버전 비교 키. 프리릴리스(1.2.3-rc.1)는 같은 숫자의 정식보다 작다."""
    core = v.split("+")[0]
    nums = tuple(int(x) for x in re.findall(r"\d+", core.split("-")[0])[:3])
    return nums + (0 if "-" in core else 1,)


def check(advisories: list, plats: set, versions: dict):
    """(실패 메시지 목록, 안내 메시지 목록)"""
    errs, notes = [], []
    for a in advisories:
        bad = [v for v in versions.get(a["package"], []) if vkey(v) < vkey(a["fixed"])]
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
    conf = json.loads((root / "app/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    plats = release_platforms((root / ".github/workflows/release.yml").read_text(encoding="utf-8"), conf.get("bundle", {}).get("targets"))
    if not plats:
        print("release.yml에서 앱 빌드 잡·배포 대상을 찾지 못했어요", file=sys.stderr)
        return 1
    versions = lock_versions((root / "Cargo.lock").read_text(encoding="utf-8"))
    if not versions:
        print("Cargo.lock에서 패키지를 하나도 읽지 못했어요(형식이 바뀌었나요?)", file=sys.stderr)
        return 1
    errs, notes = check(data["advisories"], plats, versions)
    for n in notes:
        print("안내:", n)
    for e in errs:
        print("::error::" + e)
    if not errs:
        print(f"OK: 배포 대상 {', '.join(sorted(plats))} · 기록된 경고 {len(data['advisories'])}건 모두 대상 밖")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""앱 버전 관리 (docs/RELEASE.md). 원본은 Cargo.toml `[workspace.package] version` 하나다.

따라 바뀌는 곳(이 스크립트가 한 번에 맞춘다):
  - Cargo.toml                     [workspace.package] version  ← 원본 (crates/*·app/src-tauri는 version.workspace = true)
  - app/src-tauri/tauri.conf.json  "version" (설치 파일·업데이터가 보는 버전. build.rs가 원본과 다르면 빌드를 멈춤)
  - Cargo.lock                     워크스페이스 패키지(waitscape, wr-core, wr-hook, wr-server)의 version
  - CHANGELOG.md                   [Unreleased] → [X.Y.Z] - 날짜 (비어 있으면 지난 태그 이후 커밋 제목으로 채움)
brand.json에는 버전이 없다(User-Agent의 <VERSION>은 실행 시 CARGO_PKG_VERSION으로 채움). mode.json의 version은 모드 자체 버전이라 상관없다.

사용:
  python3 scripts/version.py show
  python3 scripts/version.py check [--tag v0.2.0]          # 모든 곳이 같은지 (태그를 주면 태그와도)
  python3 scripts/version.py bump 0.2.0|major|minor|patch [--dry-run] [--date YYYY-MM-DD]
  python3 scripts/version.py notes 0.2.0                   # CHANGELOG의 그 버전 절 (릴리스 노트·latest.json)
공통: --root <저장소 폴더> (기본: 이 스크립트의 상위 폴더). 표준 라이브러리만 쓴다(Actions Linux 러너에서 바로 실행).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CONF = "app/src-tauri/tauri.conf.json"
MAX_AUTO_NOTES = 40


def die(msg: str) -> None:
    print(f"오류: {msg}", file=sys.stderr)
    sys.exit(1)


def parse(v: str) -> tuple[int, int, int]:
    m = SEMVER.match(v)
    if not m:
        die(f"버전은 X.Y.Z 형식이어야 해요 (받은 값: {v!r})")
    return tuple(int(x) for x in m.groups())  # type: ignore[return-value]


def bumped(cur: str, how: str) -> str:
    a, b, c = parse(cur)
    if how == "major":
        return f"{a + 1}.0.0"
    if how == "minor":
        return f"{a}.{b + 1}.0"
    if how == "patch":
        return f"{a}.{b}.{c + 1}"
    parse(how.removeprefix("v"))
    return how.removeprefix("v")


# ---------- 파일별 읽기·바꾸기 (텍스트 치환: 주석·서식을 그대로 둔다) ----------

WS_VER = re.compile(r'(\[workspace\.package\][^\[]*?\nversion = ")([^"]+)(")', re.S)
CONF_VER = re.compile(r'^(\s*"version":\s*")([^"]+)(")', re.M)


def cargo_version(root: pathlib.Path) -> str:
    m = WS_VER.search((root / "Cargo.toml").read_text(encoding="utf-8"))
    if not m:
        die("Cargo.toml에서 [workspace.package] version을 찾지 못했어요")
    return m.group(2)


def conf_version(root: pathlib.Path) -> str:
    return json.loads((root / CONF).read_text(encoding="utf-8")).get("version", "")


def members(root: pathlib.Path) -> list[str]:
    """version.workspace = true 인 워크스페이스 패키지 이름"""
    ws = (root / "Cargo.toml").read_text(encoding="utf-8")
    m = re.search(r"members\s*=\s*\[([^\]]*)\]", ws)
    out = []
    for d in re.findall(r'"([^"]+)"', m.group(1) if m else ""):
        t = (root / d / "Cargo.toml").read_text(encoding="utf-8")
        name = re.search(r'^name\s*=\s*"([^"]+)"', t, re.M)
        if name and re.search(r"^version\.workspace\s*=\s*true", t, re.M):
            out.append(name.group(1))
    return out


def lock_re(name: str) -> re.Pattern[str]:
    # 워크스페이스 패키지 항목에는 source 줄이 없다 → name 다음 줄이 version이고 그 뒤에 source가 오지 않는 것
    return re.compile(r'(\[\[package\]\]\nname = "' + re.escape(name) + r'"\nversion = ")([^"]+)("\n(?!source))')


def lock_versions(root: pathlib.Path) -> dict[str, str]:
    p = root / "Cargo.lock"
    if not p.exists():
        return {}
    t = p.read_text(encoding="utf-8")
    return {n: m.group(2) for n in members(root) if (m := lock_re(n).search(t))}


def set_versions(root: pathlib.Path, new: str, dry: bool) -> list[str]:
    changed = []
    for rel, fn in (("Cargo.toml", _set_cargo), (CONF, _set_conf), ("Cargo.lock", _set_lock)):
        p = root / rel
        if not p.exists():
            continue
        old = p.read_text(encoding="utf-8")
        txt = fn(root, old, new)
        if txt != old:
            changed.append(rel)
            if not dry:
                p.write_text(txt, encoding="utf-8")
    return changed


def _set_cargo(_root: pathlib.Path, t: str, new: str) -> str:
    return WS_VER.sub(lambda m: m.group(1) + new + m.group(3), t, count=1)


def _set_conf(_root: pathlib.Path, t: str, new: str) -> str:
    return CONF_VER.sub(lambda m: m.group(1) + new + m.group(3), t, count=1)


def _set_lock(root: pathlib.Path, t: str, new: str) -> str:
    for n in members(root):
        t = lock_re(n).sub(lambda m: m.group(1) + new + m.group(3), t, count=1)
    return t


# ---------- CHANGELOG ----------

UNRELEASED = re.compile(r"^## \[Unreleased\][^\n]*\n(.*?)(?=^## \[|\Z)", re.M | re.S)
HEADER = "# 변경 내역 / Changelog\n\n형식: [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전: [SemVer](https://semver.org/lang/ko/). Mode API 변경은 [`types/CHANGELOG.md`](types/CHANGELOG.md).\n\n"


def git_notes(root: pathlib.Path) -> list[str]:
    """지난 v* 태그 이후 main(first-parent)의 커밋 제목. PR 병합 커밋은 PR 제목(본문 첫 줄)을 쓴다"""
    def git(*a: str) -> str:
        r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, encoding="utf-8", errors="replace")
        return r.stdout if r.returncode == 0 else ""

    last = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*").strip()
    rng = [f"{last}..HEAD"] if last else ["HEAD"]
    out = []
    for rec in git("log", "--first-parent", "--format=%s%x1f%b%x1e", *rng).split("\x1e"):
        if not rec.strip():
            continue
        subj, _, body = rec.strip("\n").partition("\x1f")
        m = re.match(r"Merge pull request #(\d+) from \S+", subj)
        m2 = re.match(r"Merge PR #(\d+):\s*(.+)", subj)
        if m:
            title = next((x.strip() for x in body.splitlines() if x.strip()), subj)
            out.append(f"{title} (#{m.group(1)})")
        elif m2:
            out.append(f"{m2.group(2).strip()} (#{m2.group(1)})")
        elif subj.startswith(("Merge branch", "Merge remote-tracking")) or subj.startswith("chore(release)"):
            continue
        else:
            out.append(subj.strip())
    return out


def changelog_release(root: pathlib.Path, new: str, date: str, dry: bool) -> bool:
    p = root / "CHANGELOG.md"
    t = p.read_text(encoding="utf-8") if p.exists() else HEADER + "## [Unreleased]\n"
    if re.search(r"^## \[" + re.escape(new) + r"\]", t, re.M):
        die(f"CHANGELOG.md에 이미 [{new}] 절이 있어요")
    m = UNRELEASED.search(t)
    if not m:
        # [Unreleased]가 없으면 첫 '## [' 앞(없으면 끝)에 만든다
        i = t.find("\n## [")
        t = (t + "\n" if i < 0 else t[: i + 1]) + "## [Unreleased]\n\n" + ("" if i < 0 else t[i + 1 :])
        m = UNRELEASED.search(t)
    body = m.group(1).strip()
    if not body:
        notes = git_notes(root)
        more = len(notes) - MAX_AUTO_NOTES
        body = "\n".join(f"- {n}" for n in notes[:MAX_AUTO_NOTES]) + (f"\n- … 외 {more}개" if more > 0 else "")
        body = body.strip() or "- 자잘한 수정"
    new_t = t[: m.start()] + f"## [Unreleased]\n\n## [{new}] - {date}\n\n{body}\n\n" + t[m.end() :].lstrip("\n")
    new_t = new_t.rstrip("\n") + "\n"
    if not dry:
        p.write_text(new_t, encoding="utf-8")
    return new_t != t


def notes_for(root: pathlib.Path, ver: str) -> str:
    p = root / "CHANGELOG.md"
    if not p.exists():
        return ""
    m = re.search(r"^## \[" + re.escape(ver) + r"\][^\n]*\n(.*?)(?=^## \[|\Z)", p.read_text(encoding="utf-8"), re.M | re.S)
    return m.group(1).strip() if m else ""


# ---------- 명령 ----------


def cmd_check(root: pathlib.Path, tag: str | None) -> int:
    cv = cargo_version(root)
    found = {"Cargo.toml": cv, CONF: conf_version(root)}
    found.update({f"Cargo.lock:{n}": v for n, v in lock_versions(root).items()})
    bad = {k: v for k, v in found.items() if v != cv}
    if tag is not None and tag != f"v{cv}":
        bad[f"태그 {tag}"] = tag
    for k, v in found.items():
        print(f"{k:32} {v}")
    if bad:
        for k, v in bad.items():
            print(f"::error::{k}의 버전({v})이 Cargo.toml({cv})과 달라요. python3 scripts/version.py sync 로 Cargo.toml 버전에 맞추세요", file=sys.stderr)
        return 1
    print(f"OK: 모두 {cv}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Waitscape 앱 버전 관리")
    ap.add_argument("--root", default=str(pathlib.Path(__file__).resolve().parent.parent))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    c = sub.add_parser("check")
    c.add_argument("--tag")
    b = sub.add_parser("bump")
    b.add_argument("to", help="X.Y.Z 또는 major|minor|patch")
    b.add_argument("--dry-run", action="store_true")
    b.add_argument("--date", default=dt.date.today().isoformat())
    s_ = sub.add_parser("sync", help="tauri.conf.json·Cargo.lock 버전을 Cargo.toml(원본)에 맞춤")
    s_.add_argument("--dry-run", action="store_true")
    n = sub.add_parser("notes")
    n.add_argument("version")
    a = ap.parse_args()
    root = pathlib.Path(a.root)

    if a.cmd == "show":
        print(cargo_version(root))
        return 0
    if a.cmd == "check":
        return cmd_check(root, a.tag)
    if a.cmd == "sync":
        cv = cargo_version(root)
        for f in set_versions(root, cv, a.dry_run):
            print(f"  맞춤: {f}", file=sys.stderr)
        print(cv)
        return 0
    if a.cmd == "notes":
        s = notes_for(root, a.version.removeprefix("v"))
        if s:
            print(s)
        return 0

    cur = cargo_version(root)
    new = bumped(cur, a.to.strip())
    if parse(new) <= parse(cur):
        die(f"새 버전({new})이 지금 버전({cur})보다 커야 해요")
    changed = set_versions(root, new, a.dry_run)
    if changelog_release(root, new, a.date, a.dry_run):
        changed.append("CHANGELOG.md")
    tag = " (dry-run: 아무것도 쓰지 않음)" if a.dry_run else ""
    print(f"{cur} → {new}{tag}", file=sys.stderr)
    for f in changed:
        print(f"  바뀜: {f}", file=sys.stderr)
    print(new)
    return 0


if __name__ == "__main__":
    sys.exit(main())

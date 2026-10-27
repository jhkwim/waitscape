#!/usr/bin/env python3
"""업데이터 매니페스트(latest.json) 만들기 — release.yml의 초안 릴리스 잡이 부른다(docs/RELEASE.md).

입력 폴더에 있는 업데이터 산출물과 그 서명(.sig, minisign)을 찾아 tauri-plugin-updater 형식으로 쓴다.
  macOS universal : *.app.tar.gz (+ .sig)  → darwin-aarch64, darwin-x86_64 (+ -app)
  Windows NSIS    : *-setup.exe  (+ .sig)  → windows-x86_64 (기본), windows-x86_64-nsis
  Windows MSI     : *.msi        (+ .sig)  → windows-x86_64-msi
서명 파일이 하나도 없으면(서명 시크릿이 없던 빌드) 아무것도 쓰지 않고 종료 코드 3 — 호출 쪽이 latest.json을 건너뛴다.

  python3 scripts/make_latest_json.py --dir dl --tag v0.2.0 --repo owner/name [--notes-file notes.txt] [--out latest.json]
표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
import urllib.parse

NO_SIGNATURES = 3


def build(d: pathlib.Path, tag: str, repo: str, notes: str, now: dt.datetime) -> dict | None:
    def url(name: str) -> str:
        return f"https://github.com/{repo}/releases/download/{urllib.parse.quote(tag)}/{urllib.parse.quote(name)}"

    def signed(pattern: str) -> tuple[str, str] | None:
        for f in sorted(d.glob(pattern)):
            sig = f.with_name(f.name + ".sig")
            if f.is_file() and sig.is_file():
                return url(f.name), sig.read_text(encoding="utf-8").strip()
        return None

    platforms: dict[str, dict[str, str]] = {}

    def put(keys: list[str], found: tuple[str, str] | None) -> None:
        if found:
            for k in keys:
                platforms[k] = {"url": found[0], "signature": found[1]}

    mac = signed("*.app.tar.gz")
    put(["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"], mac)
    nsis = signed("*-setup.exe")
    put(["windows-x86_64", "windows-x86_64-nsis"], nsis)
    msi = signed("*.msi")
    put(["windows-x86_64-msi"], msi)
    if msi and not nsis:
        put(["windows-x86_64"], msi)
    if not platforms:
        return None
    return {
        "version": tag.removeprefix("v"),
        "notes": notes.strip(),
        "pub_date": now.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "platforms": platforms,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="tauri-plugin-updater latest.json 생성")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--notes-file")
    ap.add_argument("--out", default="latest.json")
    a = ap.parse_args()
    if not a.tag.startswith("v"):
        print("오류: 태그는 v로 시작해야 해요 (예: v0.2.0)", file=sys.stderr)
        return 1
    notes = pathlib.Path(a.notes_file).read_text(encoding="utf-8") if a.notes_file else ""
    m = build(pathlib.Path(a.dir), a.tag, a.repo, notes, dt.datetime.now(dt.timezone.utc))
    if m is None:
        print("서명(.sig)된 업데이터 산출물이 없어 latest.json을 만들지 않아요", file=sys.stderr)
        return NO_SIGNATURES
    pathlib.Path(a.out).write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{a.out}: {', '.join(sorted(m['platforms']))}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

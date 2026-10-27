#!/usr/bin/env python3
"""릴리스 스크립트 회귀 테스트 (CI python 잡): scripts/version.py, scripts/make_latest_json.py.
작은 가짜 저장소를 임시 폴더에 만들어 버전 올리기·검사·CHANGELOG·latest.json을 확인한다. 실제 저장소는 건드리지 않는다."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_latest_json  # noqa: E402

VERSION = [sys.executable, str(HERE / "version.py")]

CARGO = """[workspace]
members = ["crates/a", "app/src-tauri"]

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.88"

[workspace.dependencies]
serde = { version = "1" }
"""
LOCK = """version = 4

[[package]]
name = "a"
version = "0.1.0"

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "a",
]

[[package]]
name = "a"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
"""


def run(root: pathlib.Path, *args: str, ok: bool = True) -> subprocess.CompletedProcess[str]:
    r = subprocess.run([*VERSION, "--root", str(root), *args], capture_output=True, text=True)
    assert (r.returncode == 0) == ok, (args, r.returncode, r.stdout, r.stderr)
    return r


def fake_repo(d: pathlib.Path) -> None:
    (d / "crates/a").mkdir(parents=True)
    (d / "app/src-tauri").mkdir(parents=True)
    (d / "Cargo.toml").write_text(CARGO)
    (d / "crates/a/Cargo.toml").write_text('[package]\nname = "a"\nversion.workspace = true\n')
    (d / "app/src-tauri/Cargo.toml").write_text('[package]\nname = "app"\nversion.workspace = true\n')
    (d / "app/src-tauri/tauri.conf.json").write_text('{\n  "productName": "X",\n  "version": "0.1.0",\n  "plugins": {"x": {"version": "9.9.9"}}\n}\n')
    (d / "Cargo.lock").write_text(LOCK)
    (d / "CHANGELOG.md").write_text("# Changelog\n\n## [Unreleased]\n\n")
    g = ["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid"]
    subprocess.run([*g[:3], "init", "-q"], check=True)
    subprocess.run([*g, "add", "-A"], check=True)
    subprocess.run([*g, "commit", "-qm", "feat: 첫 기능"], check=True)
    subprocess.run([*g, "commit", "-q", "--allow-empty", "-m", "Merge pull request #7 from o/feat-x", "-m", "멋진 PR 제목"], check=True)


def test_version() -> None:
    with tempfile.TemporaryDirectory() as t:
        d = pathlib.Path(t)
        fake_repo(d)
        assert run(d, "show").stdout.strip() == "0.1.0"
        run(d, "check")
        run(d, "check", "--tag", "v0.2.0", ok=False)
        # dry-run: 바뀔 파일만 알려 주고 쓰지 않음
        r = run(d, "bump", "minor", "--dry-run")
        assert r.stdout.strip() == "0.2.0"
        for f in ("Cargo.toml", "app/src-tauri/tauri.conf.json", "Cargo.lock", "CHANGELOG.md"):
            assert f"바뀜: {f}" in r.stderr, r.stderr
        assert '"version": "0.1.0"' in (d / "app/src-tauri/tauri.conf.json").read_text()
        # 실제로
        assert run(d, "bump", "0.2.0", "--date", "2026-01-02").stdout.strip() == "0.2.0"
        run(d, "check", "--tag", "v0.2.0")
        conf = json.loads((d / "app/src-tauri/tauri.conf.json").read_text())
        assert conf["version"] == "0.2.0" and conf["plugins"]["x"]["version"] == "9.9.9", "첫 version만"
        lock = (d / "Cargo.lock").read_text()
        assert lock.count('version = "0.2.0"') == 2 and 'source = "registry+https://github.com/rust-lang/crates.io-index"' in lock
        assert lock.split("[[package]]")[3].count('"0.1.0"') == 1, "레지스트리 패키지는 그대로"
        cl = (d / "CHANGELOG.md").read_text()
        assert "## [Unreleased]\n\n## [0.2.0] - 2026-01-02\n" in cl
        assert "- 멋진 PR 제목 (#7)" in cl and "- feat: 첫 기능" in cl, cl
        assert "멋진 PR 제목 (#7)" in run(d, "notes", "v0.2.0").stdout
        # 거꾸로·형식 오류·같은 버전 거부
        run(d, "bump", "0.1.9", ok=False)
        run(d, "bump", "0.2.0", ok=False)
        run(d, "bump", "1.0", ok=False)
        # 손으로 적은 [Unreleased]는 그대로 옮긴다
        (d / "CHANGELOG.md").write_text(cl.replace("## [Unreleased]\n", "## [Unreleased]\n\n### 수정\n- 손으로 적음\n", 1))
        run(d, "bump", "patch", "--date", "2026-01-03")
        cl = (d / "CHANGELOG.md").read_text()
        assert "## [0.2.1] - 2026-01-03\n\n### 수정\n- 손으로 적음\n" in cl and cl.count("## [Unreleased]") == 1
        assert run(d, "bump", "major").stdout.strip() == "1.0.0"


def test_latest_json() -> None:
    now = dt.datetime(2026, 1, 2, 3, 4, 5, tzinfo=dt.timezone.utc)
    with tempfile.TemporaryDirectory() as t:
        d = pathlib.Path(t)
        assert make_latest_json.build(d, "v0.2.0", "o/r", "", now) is None, "서명 없으면 None"
        for n in ("Waitscape-macos-universal.app.tar.gz", "Waitscape_0.2.0_x64-setup.exe", "Waitscape_0.2.0_x64_en-US.msi", "Waitscape.dmg"):
            (d / n).write_bytes(b"x")
        assert make_latest_json.build(d, "v0.2.0", "o/r", "", now) is None, "산출물만 있고 .sig가 없어도 None"
        (d / "Waitscape-macos-universal.app.tar.gz.sig").write_text("SIGMAC\n")
        (d / "Waitscape_0.2.0_x64-setup.exe.sig").write_text("SIGNSIS")
        (d / "Waitscape_0.2.0_x64_en-US.msi.sig").write_text("SIGMSI")
        m = make_latest_json.build(d, "v0.2.0", "o/r", " 노트 \n", now)
        assert m["version"] == "0.2.0" and m["notes"] == "노트" and m["pub_date"] == "2026-01-02T03:04:05Z"
        p = m["platforms"]
        assert p["darwin-aarch64"] == p["darwin-x86_64"] == {"url": "https://github.com/o/r/releases/download/v0.2.0/Waitscape-macos-universal.app.tar.gz", "signature": "SIGMAC"}
        assert p["windows-x86_64"]["signature"] == "SIGNSIS" and p["windows-x86_64-nsis"] == p["windows-x86_64"]
        assert p["windows-x86_64-msi"]["url"].endswith("/Waitscape_0.2.0_x64_en-US.msi") and p["windows-x86_64-msi"]["signature"] == "SIGMSI"
        r = subprocess.run([sys.executable, str(HERE / "make_latest_json.py"), "--dir", str(d / "none"), "--tag", "v0.2.0", "--repo", "o/r", "--out", str(d / "l.json")], capture_output=True)
        assert r.returncode == make_latest_json.NO_SIGNATURES and not (d / "l.json").exists()


if __name__ == "__main__":
    test_version()
    test_latest_json()
    print("OK: 릴리스 스크립트 (version.py, make_latest_json.py)")

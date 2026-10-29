#!/usr/bin/env python3
"""설치 파일에 넣을 오픈소스 라이선스 고지 만들기 (#9).

배포하는 macOS·Windows 앱(waitscape + wr-hook)에 실제로 들어가는 Rust 의존성만 모은다:
`cargo metadata --filter-platform`으로 대상별 의존성 그래프를 받아, 워크스페이스 크레이트에서 일반(normal) 의존성만 따라간다.
빌드 전용(build-dependencies)·개발 전용(dev-dependencies)·proc-macro(컴파일 때만 쓰임)는 바이너리에 들어가지 않으므로 뺀다.
각 크레이트 폴더의 LICENSE·COPYING·NOTICE 파일 원문을 넣고, 같은 원문은 한 번만 적는다. 웹 쪽 제3자 자산(Galmuri11 폰트)도 함께.

  python3 scripts/third_party_licenses.py --out app/src-tauri/THIRD_PARTY_LICENSES.html   # 고지 파일 (release.yml)
  python3 scripts/third_party_licenses.py --check                                          # 허용 목록 밖 라이선스면 실패 (CI)
표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"]
ROOTS = {"waitscape", "wr-hook"}   # 배포물에 들어가는 워크스페이스 크레이트 (앱, 사이드카)
# 배포해도 되는 라이선스(SPDX). OR이면 하나만 맞아도, AND면 모두 맞아야 한다
ALLOWED = {
    "MIT", "MIT-0", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib",
    "Unicode-3.0", "Unicode-DFS-2016", "MPL-2.0", "Unlicense", "CC0-1.0", "BSL-1.0", "0BSD",
    "CDLA-Permissive-2.0",   # webpki-roots: Mozilla 루트 인증서 데이터(원문 고지 필요 → 아래 원문에 들어감)
}
LICENSE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE)([-._ ].*)?$", re.I)
EXTRA = [  # cargo 메타데이터 밖의 제3자 구성 요소
    ("Galmuri11 (web/fonts)", "OFL-1.1", "https://github.com/quiple/galmuri", ROOT / "web/fonts/OFL.txt"),
    # webview2-com-sys가 Windows exe에 정적 링크하는 WebView2LoaderStatic.lib (크레이트에 원문 없음 → NuGet 패키지의 원문을 저장소에 둠)
    ("Microsoft WebView2 SDK 1.0.3650.58 — WebView2Loader (Windows)", "BSD-3-Clause 형식 (Microsoft)",
     "https://www.nuget.org/packages/Microsoft.Web.WebView2", ROOT / "scripts/licenses/WebView2-SDK-LICENSE.txt"),
    ("Microsoft WebView2 SDK — NOTICE (Windows)", "NOTICE", "https://www.nuget.org/packages/Microsoft.Web.WebView2",
     ROOT / "scripts/licenses/WebView2-SDK-NOTICE.txt"),
]


def allowed(expr: str) -> bool:
    """SPDX 식(AND·OR·WITH·괄호, 옛 표기 '/')이 허용 목록으로 만족되는지"""
    toks = re.findall(r"\(|\)|[^\s()]+", expr.replace("/", " OR "))
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def atom():
        nonlocal pos
        if peek() == "(":
            pos += 1
            v = orx()
            if peek() != ")":
                raise IndexError("괄호 짝이 안 맞음")
            pos += 1
            return v
        lic = toks[pos]
        pos += 1
        if peek() == "WITH":
            lic += " WITH " + toks[pos + 1]
            pos += 2
        return lic in ALLOWED

    def andx():
        nonlocal pos
        v = atom()
        while peek() == "AND":
            pos += 1
            v = atom() and v
        return v

    def orx():
        nonlocal pos
        v = andx()
        while peek() == "OR":
            pos += 1
            v = andx() or v
        return v

    try:
        return bool(toks) and orx() and pos == len(toks)
    except (IndexError, TypeError):
        return False


def shipped_packages() -> list[dict]:
    """대상별 cargo metadata를 합쳐 배포물에 들어가는 외부 패키지 목록"""
    found: dict[str, dict] = {}
    for t in TARGETS:
        meta = json.loads(subprocess.run(
            ["cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", t],
            cwd=ROOT, check=True, capture_output=True, encoding="utf-8").stdout)
        pkgs = {p["id"]: p for p in meta["packages"]}
        nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
        members = set(meta["workspace_members"])
        todo = [i for i in members if pkgs[i]["name"] in ROOTS]
        seen = set()
        while todo:
            i = todo.pop()
            if i in seen:
                continue
            seen.add(i)
            for d in nodes[i]["deps"]:
                if not any(k.get("kind") is None for k in d["dep_kinds"]):
                    continue  # build·dev 전용
                p = pkgs[d["pkg"]]
                if any("proc-macro" in tg["kind"] for tg in p["targets"]):
                    continue  # 컴파일 때만 쓰임
                todo.append(d["pkg"])
        for i in seen - members:
            found[i] = pkgs[i]
    return sorted(found.values(), key=lambda p: (p["name"], p["version"]))


def license_texts(p: dict) -> list[tuple[str, str]]:
    d = pathlib.Path(p["manifest_path"]).parent
    files = sorted(f for f in d.iterdir() if f.is_file() and LICENSE_FILE.match(f.name))
    if p.get("license_file"):
        lf = d / p["license_file"]
        if lf.is_file() and lf not in files:
            files.append(lf)
    return [(f.name, f.read_text(encoding="utf-8", errors="replace").strip()) for f in files]


MIT_BODY = """Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

BSD3_BODY = """Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""


NO_COPYRIGHT_LINE = {"MPL-2.0", "Apache-2.0"}   # 원문에 저작권자가 없어 다른 패키지 원문을 그대로 써도 되는 라이선스


def fallback_text(p: dict, ref: dict[str, str]) -> tuple[str, str] | None:
    """원문 파일이 없는 패키지: SPDX 식에서 하나를 골라 표준 원문을 채운다(OR이면 MIT를 먼저).
    MIT·BSD-3은 저작권 줄에 Cargo.toml의 authors(없으면 '<이름> contributors')를 넣고(추정임을 밝힘),
    그 밖은 저작권 줄이 없는 라이선스(MPL-2.0·Apache-2.0)만 같은 라이선스를 가진 다른 패키지의 원문을 쓴다"""
    ids = re.findall(r"[A-Za-z0-9.+-]+", (p.get("license") or "").replace("/", " "))
    ids = [i for i in ids if i not in ("AND", "OR", "WITH")]
    who = ", ".join(a.split(" <")[0] for a in p.get("authors") or []) or f'{p["name"]} contributors'
    for pick in ["MIT", "BSD-3-Clause"] + ids:
        if pick not in ids:
            continue
        if pick == "MIT":
            return "MIT", f"MIT License\n\nCopyright (c) {who} (Cargo.toml authors 기준 / per Cargo.toml authors)\n\n{MIT_BODY}"
        if pick == "BSD-3-Clause":
            return "BSD-3-Clause", f"BSD 3-Clause License\n\nCopyright (c) {who} (Cargo.toml authors 기준 / per Cargo.toml authors)\n\n{BSD3_BODY}"
        if pick in ref and pick in NO_COPYRIGHT_LINE:
            return pick, ref[pick]
    return None


def render(pkgs: list[dict], version: str) -> str:
    texts: dict[str, tuple[str, list[str]]] = {}   # 원문 해시 → (원문, 패키지들)
    rows, missing = [], []
    # 같은 라이선스 하나만 단 패키지의 원문(채우기용 표준 원문)
    ref: dict[str, str] = {}
    for p in pkgs:
        lic = (p.get("license") or "").strip()
        if re.fullmatch(r"[A-Za-z0-9.+-]+", lic) and lic not in ref:
            lt = license_texts(p)
            if len(lt) == 1:
                ref[lic] = lt[0][1]
    for p in pkgs:
        tag = f'{p["name"]} {p["version"]}'
        lt = license_texts(p)
        rows.append((tag, p.get("license") or "?", p.get("repository") or ""))
        if not lt:
            fb = fallback_text(p, ref)
            if fb:
                lt = [(f"표준 {fb[0]} 원문 / standard {fb[0]} text", fb[1])]
            else:
                missing.append(tag)
        for name, body in lt:
            h = hashlib.sha256(body.encode()).hexdigest()
            texts.setdefault(h, (body, []))[1].append(f"{tag} ({name})")
    e = html.escape
    out = [
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>Waitscape — 오픈소스 라이선스 / Open source licenses</title>",
        "<style>body{font:14px/1.5 -apple-system,'Segoe UI',sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222}"
        "table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:3px 6px;text-align:left;vertical-align:top}"
        "pre{white-space:pre-wrap;background:#f6f6f6;padding:10px;font-size:12px}h2{margin-top:32px}"
        "@media(prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}pre{background:#2a2a2a}td,th{border-color:#444}}</style></head><body>",
        f"<h1>Waitscape {e(version)} — 오픈소스 라이선스 / Open source licenses</h1>",
        "<p>Waitscape는 MIT 라이선스입니다(<a href=\"https://github.com/jhkwim/waitscape\">jhkwim/waitscape</a>). "
        "이 앱에는 아래 오픈소스 소프트웨어가 들어 있습니다. / This app includes the following open source software.</p>",
        "<h2>구성 요소 / Components</h2><table><tr><th>이름 / Name</th><th>라이선스 / License</th><th>출처 / Source</th></tr>",
    ]
    for tag, lic, repo in rows:
        link = ('<a href="%s">%s</a>' % (e(repo), e(repo))) if re.match(r"https?://", repo) else e(repo)   # javascript: 같은 주소는 링크로 만들지 않음
        out.append(f"<tr><td>{e(tag)}</td><td>{e(lic)}</td><td>{link}</td></tr>")
    for name, lic, repo, f in EXTRA:
        out.append(f"<tr><td>{e(name)}</td><td>{e(lic)}</td><td><a href=\"{e(repo)}\">{e(repo)}</a></td></tr>")
    out.append("</table><h2>라이선스 원문 / License texts</h2>")
    for body, who in texts.values():
        out.append(f"<h3>{e(', '.join(who))}</h3><pre>{e(body)}</pre>")
    for name, lic, repo, f in EXTRA:
        out.append(f"<h3>{e(name)} ({e(lic)})</h3><pre>{e(f.read_text(encoding='utf-8').strip())}</pre>")   # noqa
    if missing:
        out.append("<h2>원문 파일이 패키지에 없는 구성 요소 / Packages without a bundled license file</h2>"
                   "<p>라이선스는 위 표의 SPDX 식을 따릅니다. 원문은 각 출처 저장소를 보세요. / See the SPDX expression above and the source repository.</p><ul>")
        out += [f"<li>{e(m)}</li>" for m in missing]
        out.append("</ul>")
    out.append("</body></html>\n")
    return "\n".join(out)


def main(argv: list[str]) -> int:
    # Windows 러너는 파이프 출력에 cp1252를 쓴다 → 한글 출력에서 죽지 않게
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=pathlib.Path)
    ap.add_argument("--check", action="store_true", help="허용 목록 밖 라이선스가 있으면 실패")
    a = ap.parse_args(argv)
    pkgs = shipped_packages()
    bad = [f'{p["name"]} {p["version"]}: {p.get("license") or "(라이선스 표기 없음)"}' for p in pkgs if not allowed(p.get("license") or "")]
    for b in bad:
        print("::error::허용 목록 밖 라이선스 —", b)
    print(f"배포물 의존성 {len(pkgs)}개, 허용 목록 밖 {len(bad)}개")
    if a.out:
        version = re.search(r'^version = "([^"]+)"', (ROOT / "Cargo.toml").read_text(encoding="utf-8"), re.M).group(1)
        a.out.write_text(render(pkgs, version), encoding="utf-8")
        print("쓴 파일:", a.out)
    return 1 if bad and (a.check or a.out) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""sweep.sh·release_check.sh 공용 도우미 (run_review.sh는 자체 사본을 쓴다).

하위 명령:
  modules <modules.txt>                         모듈 이름 목록(한 줄에 하나)
  module <modules.txt> <이름>                    "체크리스트<TAB>렌즈" 한 줄
  embed <modules.txt> <이름> <루트> <최대바이트> 모듈 코드를 줄 번호와 함께 마크다운으로(표준 출력). 넘치면 나머지는 읽을 범위 목록만
  embed-files <루트> <최대바이트> <파일>...       파일 전체를 같은 형식으로
  merge <접두> <meta.json> <번호:레이블:초>...   <접두>.m<번호>.json들을 합집합으로 <접두>.json에 (run_review.sh와 같은 규칙)
  repeats <결과.json> <지난 결과.json|->        지난 점검과 같은 지적에 repeat_of 표시(파일 같고 줄 ±3 + 제목 비슷, 또는 제목이 거의 같음)
  i18n-keys <i18n.js> [코드 파일...]             ko/en 사전에서 한쪽에만 있는 키·자리표시자 차이·코드가 부르는데 없는 키(마크다운)
  unreleased <CHANGELOG.md>                      [Unreleased] 절 본문
  section <CHANGELOG.md> <버전>                  [버전] 절 본문
  next-version <현재 버전> <CHANGELOG.md>         [Unreleased]에 "추가|바뀜" 절이 있으면 minor, 아니면 patch를 올린 추정 버전
"""
import difflib
import fnmatch
import json
import os
import re
import sys

BANNER = re.compile(r"^/\* =+ ")   # web/modes/studio/mode.js 최상위 구역 표지


def parse_modules(path):
    mods = {}
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 4:
            sys.exit("modules.txt 형식 오류(이름 | 체크리스트 | 렌즈 | 파일): %s" % raw.rstrip())
        name, lists, lenses, files = parts
        if not re.fullmatch(r"[a-z0-9-]+", name):
            sys.exit("모듈 이름은 영소문자·숫자·-만: %s" % name)
        mods[name] = {"lists": "" if lists == "-" else lists, "lenses": "" if lenses == "-" else lenses, "files": files.split()}
    return mods


def all_files(root):
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", ".review", "node_modules", "target")]
        for f in files:
            out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return sorted(out)


def resolve(spec, root, files):
    """파일 지정 하나 → [(경로, 시작줄, 끝줄)]. 경로@표지[~끝표지] = 표지가 든 첫 줄부터 다음 최상위 표지(또는 끝표지가 든 줄) 앞까지, 경로:A-B = 줄 범위"""
    m = re.fullmatch(r"(.+?):(\d+)-(\d+)", spec)
    if m:
        return [(m.group(1), int(m.group(2)), int(m.group(3)))]
    if "@" in spec:
        path, marker = spec.split("@", 1)
        marker = marker.replace("_", " ")   # modules.txt는 공백으로 나누므로 표지 안 공백은 _로 적는다
        stop = None
        if "~" in marker:                    # 표지~끝표지 = 끝표지가 든 줄 앞에서 멈춤
            marker, stop = marker.split("~", 1)
        lines = open(os.path.join(root, path), encoding="utf-8").read().split("\n")
        start = next((i for i, l in enumerate(lines) if BANNER.match(l) and marker in l), None)   # 구역 표지 줄 먼저
        if start is None:
            start = next((i for i, l in enumerate(lines) if marker in l), None)
        if start is None:
            sys.exit("표지를 찾지 못함: %s" % spec)
        end = next((i for i in range(start + 1, len(lines)) if BANNER.match(lines[i]) or (stop and stop in lines[i])), len(lines))
        while end > start + 1 and not lines[end - 1].strip():
            end -= 1
        return [(path, start + 1, end)]
    hit = [f for f in files if fnmatch.fnmatch(f, spec)]
    if not hit:
        sys.exit("파일 없음: %s" % spec)
    return [(f, None, None) for f in hit]


def render(root, parts, limit):
    """줄 번호 붙인 코드 블록. 넘치면 넘친 범위는 '직접 읽을 것' 목록으로"""
    out, rest, used = [], [], 0
    for path, a, b in parts:
        lines = open(os.path.join(root, path), encoding="utf-8", errors="replace").read().split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        a = a or 1
        b = min(b or len(lines), len(lines))
        body = "".join("%5d│ %s\n" % (i, lines[i - 1].replace("```", "ˋˋˋ")) for i in range(a, b + 1))
        head = "\n### `%s` (줄 %d–%d / 전체 %d줄)\n\n```text\n" % (path, a, b, len(lines))
        if used + len(body.encode()) > limit:
            room = limit - used
            if room > 4000:   # 앞부분이라도
                cut = body.encode()[:room].decode("utf-8", "ignore")
                cut = cut[: cut.rfind("\n") + 1]
                n = cut.count("\n")
                out.append(head + cut + "```\n")
                used += len(cut.encode())
                rest.append((path, a + n, b))
            else:
                rest.append((path, a, b))
            continue
        out.append(head + body + "```\n")
        used += len(body.encode())
    if rest:
        out.append("\n### 프롬프트에 다 싣지 못한 범위 — 필요한 부분만 read_file로 직접 읽는다\n\n")
        out += ["- `%s` 줄 %d–%d\n" % r for r in rest]
    return "".join(out), used, rest


def cmd_embed(modfile, name, root, limit):
    mods = parse_modules(modfile)
    if name not in mods:
        sys.exit("모르는 모듈: %s (%s)" % (name, " ".join(mods)))
    files = all_files(root)
    parts = [p for s in mods[name]["files"] for p in resolve(s, root, files)]
    text, used, rest = render(root, parts, limit)
    print("모듈 `%s` — 파일 %d개 범위, 프롬프트에 %d바이트%s\n" % (name, len(parts), used, " (일부는 직접 읽기)" if rest else ""))
    print(text)
    sys.stderr.write("embed %s: %d바이트, 넘친 범위 %d개\n" % (name, used, len(rest)))


RANK = {"critical": 0, "warning": 1, "info": 2, "question": 3}


def toks(f):
    return set(re.findall(r"\w+", (f.get("title", "") + " " + f.get("category", "")).lower()))


def same(g, f):   # run_review.sh와 같은 병합 규칙
    return g["file"] == f["file"] and abs(g["line"] - f["line"]) <= 3 and (
        g["category"] == f["category"] or len(toks(g) & toks(f)) >= 2 or g["line"] == f["line"])


def cmd_merge(base, metafile, oks):
    meta = json.load(open(metafile, encoding="utf-8"))
    merged, used, secs, summaries, checked = [], [], {}, [], []
    d = {}
    for ok in oks:
        n, rest = ok.split(":", 1)
        label, sec = rest.rsplit(":", 1)
        used.append(label)
        secs[label] = int(sec)
        d = json.load(open("%s.m%s.json" % (base, n), encoding="utf-8"))
        summaries.append("[%s] %s" % (label, d.get("summary", "")))
        checked += d.get("checked", [])
        for f in d.get("findings", []):
            f = dict(f)
            f["found_by"] = [label]
            for g in merged:
                if same(g, f):
                    g["found_by"].append(label)
                    if RANK[f["severity"]] < RANK[g["severity"]]:
                        g.update({k: f[k] for k in f if k != "found_by"})
                    break
            else:
                merged.append(f)
    merged.sort(key=lambda x: RANK[x["severity"]])
    for i, f in enumerate(merged, 1):
        f["id"] = "F%d" % i
    meta.update({"models": used, "seconds": secs})
    out = {"summary": " / ".join(summaries) if len(summaries) > 1 else d.get("summary", ""),
           "checked": sorted(set(checked)), "findings": merged, "meta": meta}
    json.dump(out, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    sev = {k: sum(1 for x in merged if x["severity"] == k) for k in RANK}
    print("합집합 %d건 — 🔴%d 🟡%d 🔵%d ❓%d (패스 %s)" % (len(merged), sev["critical"], sev["warning"], sev["info"], sev["question"], ", ".join(used)))


def title_sim(a, b):
    return difflib.SequenceMatcher(None, a.get("title", ""), b.get("title", "")).ratio()


def cmd_repeats(cur_path, prev_path):
    cur = json.load(open(cur_path, encoding="utf-8"))
    if prev_path == "-" or not os.path.exists(prev_path):
        cur.setdefault("meta", {})["previous"] = None
        json.dump(cur, open(cur_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("지난 점검 없음 — 반복 표시 생략")
        return
    prev = json.load(open(prev_path, encoding="utf-8"))
    pf = prev.get("findings", [])
    rep = 0
    for f in cur.get("findings", []):
        best = None
        for g in pf:
            if g["file"] != f["file"]:
                continue
            s = title_sim(f, g)
            near = abs(g["line"] - f["line"]) <= 3
            # 줄 ±3이면 제목이 조금만 비슷해도(또는 토큰 2개 겹침), 줄이 움직였으면(코드 수정) 제목이 거의 같을 때만
            if (near and (s >= 0.45 or len(toks(f) & toks(g)) >= 2)) or s >= 0.8:
                if best is None or s > best[1]:
                    best = (g, s, near)
        if best:
            g, s, near = best
            f["repeat_of"] = {"id": g["id"], "line": g["line"], "title": g["title"], "similarity": round(s, 2), "kind": "same-line" if near else "moved"}
            rep += 1
    cur.setdefault("meta", {})["previous"] = os.path.basename(prev_path)
    cur["meta"]["repeats"] = rep
    json.dump(cur, open(cur_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("지난 점검(%s)과 같은 지적 %d건 / 새 지적 %d건" % (os.path.basename(prev_path), rep, len(cur.get("findings", [])) - rep))


def i18n_dicts(path):
    """ko·en 사전: `  ko: {` 본 사전 + `Object.assign(S.ko, {` 덧붙인 사전들을 모두 합친다"""
    src = open(path, encoding="utf-8").read()

    def block(start):   # start = 여는 중괄호 위치. 따옴표 안은 건너뛰며 짝 맞는 닫는 중괄호까지
        depth, i, q = 0, start, None
        while i < len(src):
            c = src[i]
            if q:
                if c == "\\":
                    i += 1
                elif c == q:
                    q = None
            elif c in "\"'`":
                q = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return src[start:i]
            i += 1
        return src[start:]

    out = {"ko": {}, "en": {}}
    for lang in out:
        starts = [m.end() - 1 for m in re.finditer(r"\n  %s: \{|Object\.assign\(S\.%s, \{" % (lang, lang), src)]
        if not starts:
            sys.exit("i18n.js에서 %s 사전을 찾지 못함" % lang)
        for off in starts:
            body = block(off)
            for km in re.finditer(r'"([A-Za-z0-9_.\-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"', body):
                out[lang][km.group(1)] = (km.group(2), src.count("\n", 0, off + km.start()) + 1)
    return out


def cmd_i18n_keys(path, uses=()):
    d = i18n_dicts(path)
    ko, en = d["ko"], d["en"]
    only_ko = sorted(set(ko) - set(en))
    only_en = sorted(set(en) - set(ko))
    ph = re.compile(r"\{[a-zA-Z0-9_]+\}")
    phdiff = [(k, sorted(set(ph.findall(ko[k][0]))), sorted(set(ph.findall(en[k][0])))) for k in sorted(set(ko) & set(en))
              if set(ph.findall(ko[k][0])) != set(ph.findall(en[k][0]))]
    hangul_en = [(k, en[k][1]) for k in sorted(en) if re.search(r"[가-힣]", en[k][0])]
    print("기계적 대조(`review_lib.py i18n-keys`, 문자열 리터럴 키만 — 함수 값·계산된 키는 빠짐): ko %d개 · en %d개\n" % (len(ko), len(en)))
    print("- ko에만 있는 키 (%d): %s" % (len(only_ko), ", ".join("`%s`(%s:%d)" % (k, os.path.basename(path), ko[k][1]) for k in only_ko) or "없음"))
    print("- en에만 있는 키 (%d): %s" % (len(only_en), ", ".join("`%s`(%s:%d)" % (k, os.path.basename(path), en[k][1]) for k in only_en) or "없음"))
    print("- 자리표시자가 다른 키 (%d): %s" % (len(phdiff), "; ".join("`%s` ko%s en%s" % x for x in phdiff) or "없음"))
    print("- en 값에 한글이 남은 키 (%d): %s" % (len(hangul_en), ", ".join("`%s`(줄 %d)" % x for x in hangul_en) or "없음"))
    used = {}
    for f in uses:   # 코드에서 t("키")로 부르는데 어느 사전에도 없는 키(계산된 키 t("a." + x)는 못 봄)
        for i, line in enumerate(open(f, encoding="utf-8", errors="replace"), 1):
            for k in re.findall(r'\bt\(\s*"([A-Za-z0-9_.\-]+)"\s*[,)]', line):
                used.setdefault(k, "%s:%d" % (f, i))
    missing = sorted(k for k in used if k not in ko and k not in en)
    print("- 코드에서 t(\"키\")로 부르는데 사전에 없는 키 (%d, 대상 %d개 파일): %s" % (
        len(missing), len(uses), ", ".join("`%s`(%s)" % (k, used[k]) for k in missing) or "없음"))


def changelog_section(path, name):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"^## \[%s\][^\n]*\n(.*?)(?=^## \[|\Z)" % re.escape(name), src, re.S | re.M)
    return m.group(1).strip() if m else ""


def cmd_next_version(cur, path):
    a, b, c = (int(x) for x in cur.split("."))
    body = changelog_section(path, "Unreleased")
    print("%d.%d.0" % (a, b + 1) if re.search(r"^### (추가|바뀜)", body, re.M) else "%d.%d.%d" % (a, b, c + 1))


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    c = a[0]
    if c == "modules":
        print("\n".join(parse_modules(a[1])))
    elif c == "module":
        m = parse_modules(a[1]).get(a[2]) or sys.exit("모르는 모듈: %s" % a[2])
        print(m["lists"], m["lenses"], sep="\t")
    elif c == "embed":
        cmd_embed(a[1], a[2], a[3], int(a[4]))
    elif c == "embed-files":
        root, limit = a[1], int(a[2])
        text, used, rest = render(root, [(f, None, None) for f in a[3:]], limit)
        print(text)
    elif c == "merge":
        cmd_merge(a[1], a[2], a[3:])
    elif c == "repeats":
        cmd_repeats(a[1], a[2])
    elif c == "i18n-keys":
        cmd_i18n_keys(a[1], a[2:])
    elif c == "unreleased":
        print(changelog_section(a[1], "Unreleased"))
    elif c == "section":
        print(changelog_section(a[1], a[2]))
    elif c == "next-version":
        cmd_next_version(a[1], a[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()

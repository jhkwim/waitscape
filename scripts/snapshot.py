#!/usr/bin/env python3
"""Python 서버(server.py)를 참조 구현으로 삼아 fixture의 기준 결과를 만든다. 서버(포트)는 띄우지 않는다.

    python3 scripts/snapshot.py              # fixtures/expected/*.json 다시 쓰기
    python3 scripts/snapshot.py --check      # 임시 폴더에 만들어 fixtures/expected와 비교 (두 번 돌려 결정성도 확인)
    python3 scripts/snapshot.py --out DIR [--server path/to/server.py]

방법
  1. fixtures/input을 임시 폴더로 복사하면서 @@FAKE_*@@ 자리표시자를 가짜 시크릿으로 치환(fixtures/fake_secrets.json)
  2. 환경을 고정: WAITING_ROOM_LOG/STATUS/PROJECTS/DAYLOG/REPORTS → 임시 폴더, HOME=fixture.json의 home, TZ=fixture.json의 tz,
     사용 한도 직접 조회 끔
  3. server 모듈을 새로 import하고 모듈 안의 time을 가짜 시계로 바꿔 now를 고정(fixture.json의 now, 케이스별 now로 덮어쓰기 가능)
  4. fixtures/cases.json 순서대로 build_state()/build_trace()/daylog_report()/daylog_seen()을 호출
     (HTTP 핸들러와 같은 인자 처리: 120자 제한, trace_gc. 일지는 임시 폴더에 쌓이고 케이스 사이에 이어진다)
  5. 결과를 정렬된 JSON으로 저장하고, 가짜 시크릿 원문이 하나라도 남았으면 실패
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time as _time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, "fixtures")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import compare  # noqa: E402


def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fake_secrets():
    d = load_json(os.path.join(FX, "fake_secrets.json"))
    return {"@@FAKE_%s@@" % k: "".join(v) for k, v in d.items() if not k.startswith("$")}


def stage_input(src, dst, secrets):
    for base, _, files in os.walk(src):
        for nm in files:
            sp = os.path.join(base, nm)
            dp = os.path.join(dst, os.path.relpath(sp, src))
            os.makedirs(os.path.dirname(dp), exist_ok=True)
            with open(sp, "rb") as f:
                raw = f.read()
            for k, v in secrets.items():
                raw = raw.replace(k.encode(), v.encode())
            with open(dp, "wb") as f:
                f.write(raw)


class Clock:
    """server.py가 쓰는 time 함수만 흉내 낸다. now 외에는 실제 time에 위임(TZ는 환경으로 고정)."""

    def __init__(self, now):
        self.now = now

    def time(self):
        return self.now

    def strftime(self, fmt, t=None):
        return _time.strftime(fmt, _time.localtime(self.now) if t is None else t)

    def localtime(self, x=None):
        return _time.localtime(self.now if x is None else x)

    mktime = staticmethod(_time.mktime)
    strptime = staticmethod(_time.strptime)
    sleep = staticmethod(_time.sleep)


def run(out_dir, server_path):
    cfg = load_json(os.path.join(FX, "fixture.json"))
    cases = load_json(os.path.join(FX, "cases.json"))
    secrets = fake_secrets()
    work = tempfile.mkdtemp(prefix="wr-fixture-")
    try:
        stage_input(os.path.join(ROOT, cases["input"]), work, secrets)
        os.environ.update(WAITING_ROOM_LOG=os.path.join(work, "events.jsonl"),
                          WAITING_ROOM_STATUS=os.path.join(work, "statusline.json"),
                          WAITING_ROOM_PROJECTS=os.path.join(work, "projects"),
                          WAITING_ROOM_DAYLOG=os.path.join(work, "daylog"),
                          WAITING_ROOM_REPORTS=os.path.join(work, "reports.jsonl"),
                          HOME=cfg["home"], TZ=cfg["tz"])
        os.environ.pop("WAITING_ROOM_POLL_USAGE", None)
        _time.tzset()
        spec = importlib.util.spec_from_file_location("wr_server_snapshot", server_path)
        srv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(srv)
        clock = Clock(cfg["now"])
        srv.time = clock
        os.makedirs(out_dir, exist_ok=True)
        results, leaks = {}, []
        for c in cases["cases"]:
            clock.now = c.get("now", cfg["now"])
            op = c["op"]
            if op in ("append", "truncate"):
                with open(os.path.join(work, c["from"]), "rb") as f:
                    data = f.read()
                with open(os.path.join(work, c["file"]), "ab" if op == "append" else "wb") as f:
                    f.write(data)
                continue
            if op == "state":
                res = srv.build_state()
            elif op == "trace":
                since = c.get("since", "")
                if since.startswith("$cursor:"):
                    since = results[since[8:]]["cursor"]
                arg = lambda v: (v or "")[:120]  # do_GET과 같은 길이 제한
                res = srv.build_trace(arg(c["session"]), arg(c.get("prompt")) or "last", arg(since))
                with srv._tr_lock:
                    srv.trace_gc()
            elif op == "daylog":
                res, code = srv.daylog_report((c.get("day") or "today")[:20])
                res = {"status": code, "body": res}
            elif op == "daylog_seen":
                res, code = srv.daylog_seen(c.get("day") or "")
                res = {"status": code, "body": res}
            else:
                raise SystemExit("알 수 없는 op: %s" % op)
            # HTTP 응답과 같은 JSON 왕복(튜플→배열 등)
            res = json.loads(json.dumps(res, ensure_ascii=False))
            results[c["name"]] = res
            text = json.dumps(res, ensure_ascii=False, indent=1, sort_keys=True)
            for k, v in secrets.items():
                if v in text:
                    leaks.append("%s: %s 원문 노출" % (c["name"], k))
            with open(os.path.join(out_dir, c["name"] + ".json"), "w", encoding="utf-8") as f:
                f.write(text + "\n")
        return leaks
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv):
    server_path = os.path.join(ROOT, "server.py")
    if "--server" in argv:
        server_path = os.path.abspath(argv[argv.index("--server") + 1])
    if "--check" in argv:
        ok = True
        for i in range(2):
            tmp = tempfile.mkdtemp(prefix="wr-snap-")
            try:
                leaks = run(tmp, server_path)
                for l in leaks:
                    print("LEAK", l)
                print("[%d회차]" % (i + 1))
                ok = compare.compare_dirs(os.path.join(FX, "expected"), tmp, quiet=True) and not leaks and ok
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        return 0 if ok else 1
    out = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.join(FX, "expected")
    leaks = run(out, server_path)
    for l in leaks:
        print("LEAK", l)
    print("기준 결과 → %s" % os.path.relpath(out, ROOT))
    return 1 if leaks else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

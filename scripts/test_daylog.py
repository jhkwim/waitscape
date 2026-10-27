#!/usr/bin/env python3
"""회귀: 퇴근 일보 일지(daylog.py) — 하루 경계(03:59/04:00), 자동 퇴근 판정(오후 이후 45분), 재활동 시 갱신,
어제 일보 seen, 보존 기간 정리, 여러 프로세스 동시 쓰기, server.py HTTP(GET /daylog, POST /daylog/seen CSRF 규칙).
모든 쓰기는 임시 폴더에만 한다(실제 ~/.claude는 건드리지 않음). 실행: python3 scripts/test_daylog.py"""
import http.client
import json
import multiprocessing
import os
import socket
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["TZ"] = "Asia/Seoul"
os.environ.pop("WAITING_ROOM_DAYLOG", None)  # 실제 폴더에 쓰지 않게
time.tzset()
import daylog  # noqa: E402
from daylog import DayLog, QUIET, day_at, day_of, resolve  # noqa: E402

MID = 1792508400.0  # 2026-10-21 00:00 KST
H = 3600.0
FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("✗", msg)


def turn(sid, start, end, prompt="고쳐줘", cwd="/Users/alex/dev/shop"):
    return {"sid": sid, "cwd": cwd, "prompt": prompt, "start": start, "end": end}


def feed(turns, waits=(), act=None):
    return {"turns": list(turns), "waits": list(waits),
            "act": act if act is not None else [{"sid": t["sid"], "cwd": t["cwd"], "last": t["end"]} for t in turns]}


def rec(dl, f, now, limits=None):
    return dl.record([("claude", f)], limits, now)


def test_boundary(d):
    four = MID + 4 * H
    check(day_of(four - 1) == "2026-10-20" and day_of(four) == "2026-10-21", "03:59:59는 어제, 04:00은 오늘")
    check(day_at("2026-10-21", 4) == four, "day_at 04:00")
    check(resolve("yesterday", four) == "2026-10-20", "yesterday")
    check(resolve("2026-10-07", four) is None and resolve("2026-10-08", four) == "2026-10-08", "보존 기간 밖 날짜 거부")
    check(all(resolve(x, four) is None for x in ("../x", "2026-13-01", "2026-1-01", "2026-10-22")), "잘못된 날 거부")
    dl = DayLog(d)
    rec(dl, feed([turn("a", four - 100, four - 1), turn("b", four - 10, four)]), four + 60)
    check([t["sid"] for t in dl._load("2026-10-20")["turns"]] == ["a"], "03:59 턴 → 어제 파일")
    check([t["sid"] for t in dl._load("2026-10-21")["turns"]] == ["b"], "04:00 턴 → 오늘 파일")


def test_ready(d):
    dl = DayLog(d)
    rec(dl, feed([turn("a", MID + 9 * H, MID + 11 * H)]), MID + 11 * H)
    check(dl.report("today", MID + 15 * H)["ready"] is False, "오전에만 일하면 자동 퇴근 아님")
    last = MID + 18 * H
    rec(dl, feed([turn("a", MID + 17 * H, last)]), last)
    check(dl.report("today", last + QUIET - 1)["ready"] is False, "44:59는 아직")
    r = dl.report("today", last + QUIET)
    check(r["ready"] and r["ready_at"] == last + QUIET and r["reason"] == "quiet" and r["unseen"], "45분 조용 → 준비됨")
    # 다시 활동 → 풀림, 본 뒤 다시 준비되면 unseen
    dl.mark_seen("today", last + QUIET + 10)
    check(dl.report("today", last + QUIET + 20)["unseen"] is False, "본 뒤에는 unseen 아님")
    l2 = last + QUIET + 600
    rec(dl, feed([], act=[{"sid": "b", "cwd": "/x/ui", "last": l2}]), l2)
    check(dl.report("today", l2 + 60)["ready"] is False, "재활동 → 준비 풀림")
    r = dl.report("today", l2 + QUIET)
    check(r["ready"] and r["unseen"] and r["last_call"]["sid"] == "b", "다시 45분 → 갱신된 일보(unseen)")


def test_yesterday_seen(d):
    dl = DayLog(d)
    y = MID - 2 * H
    rec(dl, feed([turn("a", y - 900, y)]), y)
    morning = MID + 9 * H
    rec(dl, feed([turn("b", morning - 60, morning)]), morning)
    r = dl.report("today", morning)
    check(r["prev"]["day"] == "2026-10-20" and r["prev"]["unseen"], "다음 날 첫 활동: 어제 일보 unseen")
    check(dl.mark_seen("yesterday", morning + 5) == {"day": "2026-10-20", "seen": morning + 5}, "seen 기록")
    check(dl.report("today", morning + 10)["prev"]["unseen"] is False, "본 뒤에는 어제 일보 안 띄움")
    check(dl.mark_seen("../x", morning) is None, "잘못된 날 seen 거부")


def test_retention(d):
    for day in ("2026-10-06", "2026-10-07", "2026-10-08", "2026-10-20"):
        with open(os.path.join(d, day + ".json"), "w") as f:
            f.write("{}")
    with open(os.path.join(d, "notes.json"), "w") as f:
        f.write("{}")
    dl = DayLog(d)
    now = MID + 10 * H
    rec(dl, feed([turn("a", now - 60, now)]), now)
    names = sorted(n for n in os.listdir(d) if not n.endswith(".lock"))
    check(names == ["2026-10-08.json", "2026-10-20.json", "2026-10-21.json", "notes.json"], "14일 지난 파일 정리: %s" % names)


def _writer(args):
    d, w = args
    os.environ["TZ"] = "Asia/Seoul"
    time.tzset()
    dl = DayLog(d)
    now = MID + 10 * H
    for i in range(15):
        t = now - 3000 + (w * 100 + i) * 7
        rec(dl, feed([turn("w%d" % w, t - 30, t)]), now)


def test_concurrent(d):
    with multiprocessing.get_context("spawn").Pool(6) as p:
        p.map(_writer, [(d, w) for w in range(6)])
    j = DayLog(d)._load("2026-10-21")
    check(len(j["turns"]) == 90 and len(j["act"]) == 6, "여러 프로세스 동시 쓰기: 갱신이 사라지지 않음 (%d)" % len(j["turns"]))
    check(not any(n.endswith(".tmp") for n in os.listdir(d)), "임시 파일 남지 않음")


def test_mask_dedupe_limits(d):
    import server  # redact (WAITING_ROOM_DAYLOG 없이 import → 서버 자체는 기록하지 않음)
    check(server._dl[0] is None, "import만 한 서버는 일지를 쓰지 않음")
    dl = DayLog(d, server.redact)
    now = MID + 10 * H
    key = "".join(["sk-", "ant-", "z" * 16])
    t = turn("a", now - 900, now - 100, prompt="키 %s 바꿔" % key, cwd="/Users/alex/dev/" + key)
    lim = {"five_hour": {"used_percentage": 40, "resets_at": now + 3 * H}, "seven_day": {"used_percentage": 10, "resets_at": now + 90 * H}}
    rec(dl, feed([t], waits=[{"sid": "a", "t0": now - 800, "t1": now - 700}]), now, lim)
    rec(dl, feed([dict(t, start=t["start"] + 2, end=t["end"] + 3)]), now + 10, lim)
    with open(dl.path("2026-10-21"), encoding="utf-8") as f:
        check("zzzzzzzz" not in f.read(), "프롬프트·프로젝트 마스킹")
    r = dl.report("today", now + 20)
    check(r["done"] == 1 and r["wait"] == {"avg": 100.0, "n": 1}, "5초 안 같은 턴은 하나 / 대기 평균")
    check(len(r["limits"]["samples"]) == 1, "5분 안 표본 하나")
    dl.record([], {"five_hour": {"used_percentage": 100, "resets_at": now + 600}}, now + 300)
    dl.record([], None, now + 900)
    r = dl.report("today", now + 1000)
    check(r["outages"] == [{"t0": now + 300, "t1": now + 600}] and r["outage_count"] == 1, "정전 구간: 리셋 시각에 닫힘")


def test_ai_report(d):
    """AI 보고: big이면 10분 미만도 큰 일(by_ai), cheer는 최근 5개. 먼저 기록된 같은 턴에 나중 보고를 합침 (Rust ai_big_and_cheers_merge)"""
    dl = DayLog(d)
    now = MID + 15 * H
    rec(dl, feed([turn("s1", now - 300, now - 200)]), now)
    check(dl.report("today", now)["big"] == [], "보고 없는 5분짜리는 큰 일 아님")
    t = dict(turn("s1", now - 299, now - 198), big=True, cheer="깔끔하게 끝냈어요")
    rec(dl, feed([t]), now)
    r = dl.report("today", now)
    check(r["done"] == 1, "같은 턴은 하나: %s" % r["done"])
    check(r["big"] and r["big"][0].get("by_ai") is True, "by_ai 큰 일: %s" % r["big"])
    check(r["cheers"] == [{"sid": "s1", "provider": "claude", "text": "깔끔하게 끝냈어요", "t": now - 200}], "cheers: %s" % r["cheers"])
    many = [dict(turn("m%d" % k, now - 100 + k * 10, now - 95 + k * 10), cheer="한마디 %d" % k) for k in range(7)]
    rec(dl, feed(many), now)
    check([c["text"] for c in dl.report("today", now)["cheers"]] == ["한마디 %d" % k for k in range(2, 7)], "최근 5개")


def free_port(want=7800):
    for p in (want, 0):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()


def test_http(d):
    port = free_port()
    home = os.path.join(d, "home")
    os.makedirs(home)
    now = time.time()
    log = os.path.join(d, "events.jsonl")
    with open(log, "w") as f:
        for e in ({"ts": now - 50, "sid": "h1", "cwd": "/Users/alex/dev/a", "event": "UserPromptSubmit", "text": "hi"},
                  {"ts": now - 5, "sid": "h1", "cwd": "/Users/alex/dev/a", "event": "Stop"}):
            f.write(json.dumps(e) + "\n")
    env = dict(os.environ, HOME=home, WAITING_ROOM_PORT=str(port), WAITING_ROOM_LOG=log,
               WAITING_ROOM_STATUS=os.path.join(d, "sl.json"), WAITING_ROOM_PROJECTS=os.path.join(d, "projects"),
               WAITING_ROOM_MODES=os.path.join(d, "modes"), WAITING_ROOM_POLL_USAGE="0")
    env.pop("WAITING_ROOM_DAYLOG", None)  # 기본 폴더 = 임시 HOME 아래
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], env=env, stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", port), 0.2).close()
                break
            except OSError:
                time.sleep(0.05)
        host = "127.0.0.1:%d" % port

        def call(method, path, body=None, headers=None):
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request(method, path, body=body, headers={"Host": host, **(headers or {})})
            r = c.getresponse()
            return r.status, r.read().decode()
        code, body = call("GET", "/daylog")
        r = json.loads(body)
        check(code == 200 and r["done"] == 1 and r["today"], "GET /daylog: %s %s" % (code, body[:120]))
        check(call("GET", "/daylog?day=..%2Fx")[0] == 400, "잘못된 날 400")
        j = {"Content-Type": "application/json"}
        code, body = call("POST", "/daylog/seen", json.dumps({"day": "today"}), dict(j, Origin="http://" + host))
        check(code == 200 and json.loads(body)["seen"], "POST /daylog/seen 같은 출처")
        check(call("POST", "/daylog/seen", '{"day":"today"}', dict(j, Origin="http://evil.example"))[0] == 403, "다른 출처 403")
        check(call("POST", "/daylog/seen", '{"day":"today"}', dict(j, **{"Sec-Fetch-Site": "cross-site"}))[0] == 403, "cross-site 403")
        check(call("POST", "/daylog/seen", '{"day":"today"}', {"Content-Type": "text/plain"})[0] == 415, "폼·text/plain 415")
        check(call("POST", "/daylog/seen", json.dumps({"day": "x" * 2000}), j)[0] == 413, "큰 본문 413")
        check(call("POST", "/state", "{}", j)[0] == 501, "다른 경로 POST 501")
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        c.request("GET", "/daylog", headers={"Host": "evil.example:%d" % port})
        check(c.getresponse().status == 403, "Host 검사")
        files = os.listdir(os.path.join(home, ".claude", "waiting-room", "daylog"))
        check(any(f.endswith(".json") for f in files), "일지는 HOME 아래 기본 폴더에만")
    finally:
        p.terminate()
        p.wait(5)


def main():
    for t in (test_boundary, test_ready, test_yesterday_seen, test_retention, test_concurrent, test_mask_dedupe_limits, test_ai_report, test_http):
        with tempfile.TemporaryDirectory(prefix="wr-daylog-") as d:
            t(d)
    if FAILS:
        print("FAIL: %d건" % len(FAILS))
        return 1
    print("OK: daylog 회귀 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())

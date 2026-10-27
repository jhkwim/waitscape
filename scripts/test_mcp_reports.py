#!/usr/bin/env python3
"""MCP 보고 회귀 테스트 (Python 쪽, 임시 폴더만 씀). Rust 쪽은 cargo test(wr-core report.rs·providers/mcp.rs, wr-hook).

    python3 scripts/test_mcp_reports.py

1. 정화 규칙: fixtures/mcp/sanitize.json — Rust report.rs 테스트와 같은 fixture (T5)
2. 훅 경로: hook.py에 mcp__waitscape__* PreToolUse를 넣으면 fixtures/mcp/hook_cases.json과 같은 줄 (T9, wr-hook 테스트와 같은 골든)
3. server.py read_reports(): 개행 없는 줄은 미룸, 파일이 바뀌면(잘림·교체) 처음부터, 죽은 사이드카 pid는 끝(T11), 경로 순서, 끄기(off)
4. 고아 보고(리뷰 PR #35 🔴): 훅이 동작 중이면 Claude 사이드카 보고를 붙이지 않음 — 같은 폴더 두 창·비운 보드·서브에이전트 보드
   (Rust crates/wr-core/tests/mcp_orphans.rs와 같은 사례). 훅이 없을 때 붙이는 규칙은 attach_orphans 직접 호출로
5. 멀티플렉서 이동 정보(#37 cmux · #40 Orca): fixtures/mux/term_cases.json 골든(wr-hook과 같음) · 어댑터 표의 env(Orca 두 개·cmux 두 개)만 조회 · 읽을 때 다시 검증
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time as _time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, "fixtures")
sys.path.insert(0, ROOT)
import mcp_report as MR  # noqa: E402

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("✗", msg)


def load_server(env):
    os.environ.update(env)
    spec = importlib.util.spec_from_file_location("wr_server_mcp_test", os.path.join(ROOT, "server.py"))
    srv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(srv)
    return srv


def fake_secrets():
    d = json.load(open(os.path.join(FX, "fake_secrets.json"), encoding="utf-8"))
    return {"@@FAKE_%s@@" % k: "".join(v) for k, v in d.items() if not k.startswith("$")}


def fill(s, sec):
    for k, v in sec.items():
        s = s.replace(k, v)
    return s


def test_sanitize(srv):
    fx = json.load(open(os.path.join(FX, "mcp", "sanitize.json"), encoding="utf-8"))
    sec = fake_secrets()
    for c in fx["clean"]:
        got = MR.clean(fill(c["in"], sec), c["n"], srv.redact)
        check(got == c["out"], "clean %r: %r != %r" % (c["in"], got, c["out"]))
    for k, f in (("status", MR.status_of), ("board", MR.board_of)):
        for c in fx[k]:
            m, err = f(json.loads(fill(json.dumps(c["in"]), sec)), srv.redact)
            got = m if err is None else {"error": err}
            check(got == c["out"], "%s %s: %s != %s" % (k, c["in"], got, c["out"]))


def no_cmux_env():
    """이 테스트를 cmux·Orca 안에서 돌려도 골든이 바뀌지 않게 CMUX_*·ORCA_* 를 뺀 환경"""
    return {k: v for k, v in os.environ.items() if not k.startswith(("CMUX_", "ORCA_"))}


def test_cmux():
    fx = json.load(open(os.path.join(FX, "mux", "term_cases.json"), encoding="utf-8"))
    for c in fx["cases"]:
        home = tempfile.mkdtemp(prefix="wr-hook-cmux-")
        try:
            env = dict(no_cmux_env(), **c["env"], HOME=home, USERPROFILE=home)
            subprocess.run([sys.executable, os.path.join(ROOT, "hook.py")], input=json.dumps(fx["in"]).encode(), env=env,
                           check=True)
            with open(os.path.join(home, ".claude", "waiting-room", "events.jsonl"), encoding="utf-8") as f:
                ev = json.loads(f.read())
            ev["ts"] = 0.5
            line = json.dumps(ev, ensure_ascii=False)
            check(line == c["out"], "mux hook %s: %s != %s" % (c["env"], line, c["out"]))
            for k, v in c["env"].items():
                if k not in MR.MUX_ENV:
                    check(v not in line, "허용 목록 밖 env %s가 기록됨" % k)
        finally:
            shutil.rmtree(home, ignore_errors=True)

    for c in fx["jump_cases"]:  # 읽을 때 재검증 — Rust term::jump_of와 같은 골든
        check(MR.mux_jump(c["term"]) == c["jump"], "mux_jump(%r) = %r != %r" % (c["term"], MR.mux_jump(c["term"]), c["jump"]))

    class Spy(dict):
        asked = []

        def get(self, k, d=None):
            Spy.asked.append(k)
            return dict.get(self, k, d)

        def __getitem__(self, k):
            Spy.asked.append(k)
            return dict.__getitem__(self, k)

    t = MR.mux_term(Spy(CMUX_WORKSPACE_ID="workspace:1", CMUX_SURFACE_ID="surface:2", CMUX_SOCKET_PASSWORD="pw"))
    check(t == {"mux": {"kind": "cmux", "workspace": "workspace:1", "surface": "surface:2"}}, "mux_term %r" % t)
    check(MR.MUX_ENV == ("ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH", "CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID"), "허용 목록 %r" % (MR.MUX_ENV,))
    check(set(Spy.asked) <= set(MR.MUX_ENV), "허용 목록 밖 env를 조회함: %r" % Spy.asked)
    check(MR.mux_jump({"mux": {"kind": "cmux", "workspace": "workspace:1", "surface": "x y", "token": "t"}})
          == {"mux": {"kind": "cmux", "workspace": "workspace:1"}}, "mux_jump 재검증")
    # Orca(#40): 핸들·경로 두 env만. 토큰·탭/패널 ID는 조회도 하지 않는다
    H = "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d"
    Spy.asked = []
    t = MR.mux_term(Spy(ORCA_TERMINAL_HANDLE=H, ORCA_WORKTREE_PATH="/Users/alex/dev/shop", ORCA_AGENT_HOOK_TOKEN="tok",
                        ORCA_AGENT_LAUNCH_TOKEN="tok2", ORCA_TAB_ID="tab", ORCA_PANE_KEY="pane"))
    check(t == {"mux": {"kind": "orca", "surface": H, "path": "/Users/alex/dev/shop"}}, "orca mux_term %r" % t)
    check(Spy.asked == ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH"], "orca 조회 %r" % Spy.asked)
    # 파이썬만 생기는 서로게이트(비 UTF-8 env)는 경로로 받지 않음 — Rust는 그런 env를 아예 읽지 못함
    check(MR.mux_term({"ORCA_TERMINAL_HANDLE": H, "ORCA_WORKTREE_PATH": "/a\udcffb"}) == {"mux": {"kind": "orca", "surface": H}}, "서로게이트 경로")
    for bad in (None, "mux", {"mux": "workspace:1"}, {"mux": {"kind": "cmux", "workspace": 3}}, {"mux": {"kind": "cmux", "workspace": "-x"}},
                {"mux": {"kind": "other", "workspace": "workspace:1"}}, {"mux": {"workspace": "workspace:1"}}, {"cmux": {"workspace": "workspace:1"}}):
        check(MR.mux_jump(bad) is None, "mux_jump(%r)" % (bad,))


def test_hook_golden():
    fx = json.load(open(os.path.join(FX, "mcp", "hook_cases.json"), encoding="utf-8"))
    for c in fx["cases"]:
        home = tempfile.mkdtemp(prefix="wr-hook-mcp-")
        try:
            env = dict(no_cmux_env(), HOME=home, USERPROFILE=home)
            subprocess.run([sys.executable, os.path.join(ROOT, "hook.py")], input=json.dumps(c["in"]).encode(), env=env,
                           check=True)
            p = os.path.join(home, ".claude", "waiting-room", "events.jsonl")
            line = None
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    ev = json.loads(f.read())
                ev["ts"] = 0.5
                line = json.dumps(ev, ensure_ascii=False)
            check(line == c["out"], "hook %s: %s != %s" % (c["in"].get("tool_name"), line, c["out"]))
        finally:
            shutil.rmtree(home, ignore_errors=True)


def rec(key, ts, typ, **kw):
    d = {"v": 1, "ts": ts, "type": typ, "key": key, "provider": "codex", "cwd": "/w/shop"}
    d.update(kw)
    return json.dumps(d, ensure_ascii=False) + "\n"


def test_reader(work):
    path = os.path.join(work, "reports.jsonl")
    srv = load_server({"WAITING_ROOM_REPORTS": path, "WAITING_ROOM_LOG": os.path.join(work, "events.jsonl"),
                       "WAITING_ROOM_DAYLOG": "off"})
    # 개행 없는 마지막 줄은 다음 읽기로
    with open(path, "w", encoding="utf-8") as f:
        f.write(rec("k1", 100, "status", state="working", title="첫 보고"))
        f.write(rec("k2", 100, "status", state="working")[:-5])
    ss, _, last = srv.read_reports(101)
    check([s["sid"] for s in ss] == ["k1"] and last == 100, "개행 없는 줄은 미룸: %s" % [s["sid"] for s in ss])
    # 파일 교체(잘림): 처음부터 다시 읽지만 key별 상태는 유지
    with open(path, "w", encoding="utf-8") as f:
        f.write(rec("k3", 102, "status", state="asking", title="질문"))
    ss, _, _ = srv.read_reports(103)
    by = {s["sid"]: s for s in ss}
    check(set(by) == {"k1", "k3"} and by["k3"]["status"] == "needs_input" and by["k3"]["note"] == "질문",
          "교체 후 다시 읽기: %s" % sorted(by))
    # 죽은 사이드카 pid → 끝 (Windows는 os.kill로 확인하지 않음)
    if os.name != "nt":
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait()
        with open(path, "a", encoding="utf-8") as f:
            f.write(rec("dead", 104, "status", state="working", pid=child.pid))
            f.write(rec("live", 104, "status", state="working", pid=os.getpid()))
        sids = [s["sid"] for s in srv.read_reports(105)[0]]
        check("dead" not in sids and "live" in sids, "pid 확인: %s" % sids)
    # 경로 순서: WAITING_ROOM_REPORTS가 없으면 CLAUDE_CONFIG_DIR 아래 (Rust McpConfig와 같음)
    os.environ.pop("WAITING_ROOM_REPORTS", None)
    cfg = load_server({"CLAUDE_CONFIG_DIR": os.path.join(work, "cfg")})
    check(cfg.REPORTS == os.path.join(work, "cfg", "waiting-room", "reports.jsonl"), "CLAUDE_CONFIG_DIR 경로: %s" % cfg.REPORTS)
    os.environ.pop("CLAUDE_CONFIG_DIR", None)
    # 끄기: 읽지도 내보내지도 않음
    off = load_server({"WAITING_ROOM_REPORTS": "off"})
    check(off.REPORTS_ON is False and "mcp" not in off.build_state(), "WAITING_ROOM_REPORTS=off")


def test_report_day(work):
    """오늘 집계·일지 피드 (Rust day_feed_and_today와 같은 시나리오): 턴 1 + 질문 대기 1, Claude 사이드카·숨길 프로젝트 제외, 다시 읽어도 중복 없음"""
    path = os.path.join(work, "day.jsonl")
    srv = load_server({"WAITING_ROOM_REPORTS": path, "WAITING_ROOM_LOG": os.path.join(work, "events.jsonl"),
                       "WAITING_ROOM_DAYLOG": "off"})
    hid = "/Users/alex/.claude-mem/observer-sessions"
    with open(path, "w", encoding="utf-8") as f:
        f.write(rec("k1", 100, "status", state="working", title="결제"))
        f.write(rec("k1", 150, "status", state="asking", title="할까요?"))
        f.write(rec("k1", 170, "status", state="asking"))
        f.write(rec("k1", 200, "status", state="working"))
        f.write(rec("k1", 400, "status", state="done", big=True, cheer="버그까지 잡았어요"))
        f.write(rec("k1", 410, "bye"))
        f.write(rec("c1", 100, "status", state="working", provider="claude"))
        f.write(rec("c1", 300, "status", state="done", provider="claude"))
        f.write(rec("h1", 100, "status", state="working", cwd=hid))
        f.write(rec("h1", 300, "status", state="done", cwd=hid))
    srv.read_reports(500)
    today = _time.strftime("%Y-%m-%d", _time.localtime(400))
    feeds, done, waited = srv.report_day(today)
    check([p for p, _ in feeds] == ["codex"] and (done, waited) == (1, 300), "report_day: %s %s %s" % ([p for p, _ in feeds], done, waited))
    f = feeds[0][1] if feeds else {"turns": [], "waits": [], "act": []}
    t = f["turns"][0] if f["turns"] else {}
    check((t.get("start"), t.get("end"), t.get("big"), t.get("prompt"), t.get("cheer")) == (100, 400, True, "할까요?", "버그까지 잡았어요"),
          "MCP 턴: %s" % t)
    check([(w["t0"], w["t1"]) for w in f["waits"]] == [(150, 200)] and len(f["act"]) == 1, "대기·활동: %s %s" % (f["waits"], f["act"]))
    with open(path, "rb") as fh:
        body = fh.read()
    os.remove(path)
    with open(path, "wb") as fh:
        fh.write(body)
    srv.read_reports(501)
    feeds, done, _ = srv.report_day(today)
    check(done == 1 and len(feeds[0][1]["turns"]) == 1 and len(feeds[0][1]["waits"]) == 1, "다시 읽어도 중복 없음")


class FixedClock:
    """server.py의 time.time()만 고정 (나머지는 실제 time)"""

    def __init__(self, now):
        self.now = now

    def time(self):
        return self.now

    def __getattr__(self, k):
        return getattr(_time, k)


def test_orphans(work):
    now = 1800000000.0
    cwd = "/w/shop"
    ev = lambda sid, ago, event, **kw: dict({"ts": now - ago, "sid": sid, "cwd": cwd, "event": event}, **kw)
    side = lambda ago, typ, **kw: dict({"v": 1, "ts": now - ago, "type": typ, "key": "claude-1-1-0000000a",
                                        "provider": "claude", "cwd": cwd}, **kw)
    cases = {
        "two": ([ev("A", 100, "UserPromptSubmit", text="a"), ev("B", 100, "UserPromptSubmit", text="b"),
                 ev("A", 90, "PreToolUse", report={"tool": "status", "state": "working", "title": "A의 작업"})],
                [side(90, "status", state="working", title="A의 작업")], {"A": "A의 작업", "B": None}),
        "stale": ([ev("A", 300, "UserPromptSubmit", text="1"),
                   ev("A", 290, "PreToolUse", report={"tool": "board", "lines": ["옛 계획"], "done": []}),
                   ev("A", 100, "UserPromptSubmit", text="2")],
                  [side(290, "board", lines=["옛 계획"], done=[])], {"A": None}),
        "sub": ([ev("A", 100, "UserPromptSubmit", text="a"), ev("A", 95, "SubagentStart", aid="x", atype="Explore"),
                 ev("A", 90, "PreToolUse", aid="x", atype="Explore",
                    report={"tool": "board", "lines": ["서브에이전트 계획"], "done": []})],
                [side(90, "board", lines=["서브에이전트 계획"], done=[])], {"A": None}),
    }
    for name, (events, rows, want) in cases.items():
        d = os.path.join(work, "orphan-" + name)
        os.makedirs(d)
        for fn, data in (("events.jsonl", events), ("reports.jsonl", rows)):
            with open(os.path.join(d, fn), "w", encoding="utf-8") as f:
                f.write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in data))
        srv = load_server({"WAITING_ROOM_REPORTS": os.path.join(d, "reports.jsonl"),
                           "WAITING_ROOM_LOG": os.path.join(d, "events.jsonl"), "WAITING_ROOM_DAYLOG": "off"})
        srv.time = FixedClock(now)
        got = {s["sid"]: (s.get("report") or {}).get("title") for s in srv.build_state()["sessions"]}
        check(got == want, "고아 보고 %s: %s != %s" % (name, got, want))
    # 훅이 없을 때만 부르는 attach_orphans 규칙: 활성 세션 하나 + 마지막 프롬프트 뒤 보고
    srv = load_server({"WAITING_ROOM_DAYLOG": "off"})
    mk = lambda pts: [{"sid": "a", "cwd": cwd, "last": now - 10, "prompt_ts": pts}]
    o = [{"key": "k", "cwd": cwd, "ts": now - 20, "report": {"ts": now - 20}}]
    ss = mk(now - 30)
    srv.attach_orphans(ss, o, now)
    check("report" in ss[0], "훅 없을 때 붙임")
    ss = mk(now - 15)
    srv.attach_orphans(ss, o, now)
    check("report" not in ss[0], "지난 턴 보고는 안 붙임")


def main():
    work = tempfile.mkdtemp(prefix="wr-mcp-py-")
    names = ("WAITING_ROOM_REPORTS", "WAITING_ROOM_LOG", "WAITING_ROOM_DAYLOG", "WAITING_ROOM_STATUS", "WAITING_ROOM_PROJECTS",
             "CLAUDE_CONFIG_DIR")
    keep = {k: os.environ.get(k) for k in names}
    # 실제 ~/.claude는 읽지 않게 모든 경로를 임시 폴더로
    os.environ.update(WAITING_ROOM_STATUS=os.path.join(work, "statusline.json"), WAITING_ROOM_PROJECTS=os.path.join(work, "projects"))
    try:
        srv = load_server({"WAITING_ROOM_REPORTS": os.path.join(work, "none.jsonl"), "WAITING_ROOM_DAYLOG": "off"})
        test_sanitize(srv)
        test_hook_golden()
        test_cmux()
        test_reader(work)
        test_orphans(work)
        test_report_day(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        for k, v in keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    print("FAIL %d건" % len(FAILS) if FAILS else "OK: MCP 보고 정화·훅 골든·리더·멀티플렉서 이동 정보")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

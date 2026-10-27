#!/usr/bin/env python3
"""합성 fixture 생성기 (결정적: 같은 코드 → 같은 파일).

    python3 fixtures/make_fixtures.py

만드는 것
  fixtures/input/                 훅 이벤트 + 트랜스크립트 (Python 서버 기준 결과 = fixtures/expected/)
    events.jsonl  statusline.json  projects/<인코딩된 cwd>/<sid>.jsonl (+ <sid>/subagents/…)
    reports.jsonl                 MCP 보고 사이드카(wr-hook mcp) 기록 + events.jsonl의 훅 report 이벤트
    patches/                      cases.json의 append/truncate 단계가 쓰는 조각
  fixtures/transcript-only/input/ 훅 없이 트랜스크립트만 있는 세션들 (기대값 = transcript-only/expected.json, 손으로 씀)

규칙
  - 시각은 fixtures/fixture.json의 now 기준 상대값(정수·0.5초 단위)만 쓴다.
  - 실제 사용자 데이터·실제 경로 금지. 홈은 /Users/alex, 프로젝트는 /Users/alex/dev/<이름>.
  - 가짜 시크릿은 파일에 직접 쓰지 않고 @@FAKE_이름@@ 자리표시자로 둔다. 하네스가 입력을 임시 폴더로 복사할 때
    fixtures/fake_secrets.json의 조각을 이어 붙여 치환한다(저장소·로컬 시크릿 감지 도구에 실제 패턴이 남지 않게).
"""
import json
import os
import shutil
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "fixture.json"), encoding="utf-8"))
NOW = CFG["now"]
HOME = CFG["home"]


def iso(x):
    return datetime.fromtimestamp(x, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def enc(cwd):
    """Claude Code의 projects 폴더 이름 규칙(경로의 / 와 . 을 - 로)"""
    return cwd.replace("/", "-").replace(".", "-")


def dump_jsonl(path, rows, tail=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        if tail is not None:  # 개행 없는 마지막 줄(쓰는 도중)
            f.write(tail)


class Tx:
    """트랜스크립트 한 개를 줄 단위로 만든다 (Claude Code jsonl 형식의 필요한 부분만)."""

    def __init__(self, sid, cwd, sidechain=False):
        self.sid, self.cwd, self.side = sid, cwd, sidechain
        self.rows, self.n = [], 0

    def _row(self, ts, typ, message, **kw):
        self.n += 1
        r = {"type": typ, "timestamp": iso(ts), "sessionId": self.sid, "cwd": self.cwd,
             "uuid": "%s-u%d" % (self.sid, self.n), "isSidechain": self.side, "message": message}
        r.update(kw)
        self.rows.append(r)
        return r

    def prompt(self, ts, text, **kw):
        return self._row(ts, "user", {"role": "user", "content": text}, **kw)

    def asst(self, ts, blocks, stop=None, usage=None, mid=None):
        m = {"role": "assistant", "id": mid or "%s-m%d" % (self.sid, self.n + 1), "content": blocks, "stop_reason": stop}
        if usage:
            m["usage"] = {"input_tokens": usage[0], "cache_creation_input_tokens": usage[1],
                          "cache_read_input_tokens": usage[2], "output_tokens": usage[3]}
        return self._row(ts, "assistant", m)

    def say(self, ts, text, stop=None, usage=None):
        return self.asst(ts, [{"type": "text", "text": text}], stop, usage)

    def think(self, ts, text, ms):
        r = self.asst(ts, [{"type": "thinking", "thinking": text}])
        r["thinkingDurationMs"] = ms
        return r

    def tool(self, ts, tid, name, inp, usage=None):
        return self.asst(ts, [{"type": "tool_use", "id": tid, "name": name, "input": inp}], "tool_use", usage)

    def result(self, ts, tid, content="ok", err=False):
        blk = {"type": "tool_result", "tool_use_id": tid, "content": content}
        if err:
            blk["is_error"] = True
        return self._row(ts, "user", {"role": "user", "content": [blk]})

    def call(self, ts, tid, name, inp, dur=1.0, res="ok", err=False, usage=None):
        self.tool(ts, tid, name, inp, usage)
        if dur is not None:
            self.result(ts + dur, tid, res, err)

    def write(self, root, sub=None):
        if sub:
            path = os.path.join(root, enc(self.cwd), sub[0], "subagents", "agent-%s.jsonl" % sub[1])
        else:
            path = os.path.join(root, enc(self.cwd), self.sid + ".jsonl")
        dump_jsonl(path, self.rows)
        return path


def build_reports(E, out, t):
    """MCP 보고: 훅 경로(events.jsonl의 PreToolUse + report)와 사이드카 경로(reports.jsonl).
    pid는 넣지 않는다(실제 프로세스 생존 확인이 환경마다 달라지므로. pid 확인은 Rust·Python 단위 테스트에서)."""
    D = HOME + "/dev/"

    def ev(sid, cwd, ts, event, **kw):
        d = {"ts": ts, "sid": sid, "cwd": cwd, "event": event}
        d.update(kw)
        E.append(d)

    # --- fx-mcp-hook: Claude 훅 경로. 보고는 도구로 세지 않고(tools=1: Read만) report로 접힌다.
    #     서브에이전트(aid)의 보드는 무시, 잘못된 state는 버림, 리더가 다시 마스킹(@@FAKE_GH@@)
    c = D + "report-hook"
    ev("fx-mcp-hook", c, t - 300, "UserPromptSubmit", text="결제 모듈 리팩터해줘")
    ev("fx-mcp-hook", c, t - 290, "PreToolUse",
       report={"tool": "status", "state": "working", "title": "결제 모듈 리팩터", "step": 1, "total": 4})
    ev("fx-mcp-hook", c, t - 285, "PreToolUse",
       report={"tool": "board", "lines": ["타입 정리", "환불 분리", "테스트", "PR"], "done": [0]})
    ev("fx-mcp-hook", c, t - 280, "PreToolUse", icon="📖", text="refund.py 읽는 중", kind="read")
    ev("fx-mcp-hook", c, t - 276, "SubagentStart", aid="r0", atype="Explore")
    ev("fx-mcp-hook", c, t - 275, "PreToolUse", aid="r0", atype="Explore",
       report={"tool": "board", "lines": ["서브에이전트 보드"], "done": []})
    ev("fx-mcp-hook", c, t - 270, "PreToolUse", report={"tool": "status", "state": "bogus"})
    ev("fx-mcp-hook", c, t - 260, "PreToolUse",
       report={"tool": "status", "state": "working", "title": "토큰 @@FAKE_GH@@ 교체", "step": 2, "total": 4})

    # --- fx-mcp-cheer: 턴 안에서 AI가 done(big·cheer)을 보고한 뒤 Stop → 일지 턴에 by_ai·cheer (6분짜리라도 큰 일)
    c = D + "report-cheer"
    ev("fx-mcp-cheer", c, t - 700, "UserPromptSubmit", text="로그인 버그 고쳐줘")
    ev("fx-mcp-cheer", c, t - 400, "PreToolUse",
       report={"tool": "status", "state": "done", "title": "로그인 버그 수정", "big": True, "cheer": "세션 만료까지 깔끔히 정리했어요"})
    ev("fx-mcp-cheer", c, t - 340, "Stop")

    # --- fx-mcp-fb: 훅 보고가 없는 Claude 세션. 훅이 동작 중(이벤트 있음)이므로 같은 cwd의 사이드카(provider claude) 보고도 붙지 않는다
    #     (붙이면 같은 폴더의 다른 창·지난 턴·서브에이전트 보고가 엉뚱하게 붙음. 훅이 없을 때 붙이는 경로는 단위 테스트에서)
    c = D + "report-fb"
    ev("fx-mcp-fb", c, t - 200, "UserPromptSubmit", text="문서 정리")
    ev("fx-mcp-fb", c, t - 100, "PreToolUse", icon="📖", text="README.md 읽는 중", kind="read")
    # --- fx-twin-a/b: 같은 cwd의 활성 Claude 세션이 둘 → 사이드카 보고를 붙이지 않고 버린다
    c = D + "twins"
    for sid in ("fx-twin-a", "fx-twin-b"):
        ev(sid, c, t - 120, "UserPromptSubmit", text="쌍둥이 작업")

    R = []

    def rep(key, prov, cwd, ts, typ, **kw):
        d = {"v": 1, "ts": ts, "type": typ, "key": key, "provider": prov, "cwd": cwd, "wr": "0.1.0"}
        d.update(kw)
        R.append(d)

    k = "codex-4821-1792518300000-0a1b2c3d"   # Codex: working → asking → working → done(big, cheer)
    c = D + "shop-api"
    rep(k, "codex", c, t - 900, "hello", client={"name": "codex-mcp-client", "version": "0.9"}, proto="2025-06-18")
    # 멀티플렉서(cmux) 이동 정보(#37): Codex가 env_vars로 넘겨 준 경우. 잘못된 값(아래 board)은 버리고 마지막 올바른 값을 쓴다
    rep(k, "codex", c, t - 890, "status", state="working", title="결제 API 정리", step=1, total=3,
        term={"mux": {"kind": "cmux", "workspace": "workspace:4", "surface": "surface:11"}})
    rep(k, "codex", c, t - 880, "board", lines=["타입 정리", "환불 로직 분리", "테스트 추가"], done=[],
        term={"mux": {"kind": "cmux", "workspace": "--socket-password"}})
    rep(k, "codex", c, t - 600, "status", state="asking", title="DB 마이그레이션 할까요?")
    rep(k, "codex", c, t - 500, "status", state="working", title="환불 로직 분리", step=2, total=3)
    rep(k, "codex", c, t - 130, "board", lines=["타입 정리", "환불 로직 분리", "테스트 추가"], done=[0, 1, 2, 7])
    rep(k, "codex", c, t - 120, "status", state="done", big=True, cheer="환불 버그까지 잡았어요")
    k = "gemini-77-1792511000000-ffff0001"     # Gemini: 30분 넘게 소식 없는 working → guess, 리더가 다시 마스킹
    c = D + "docs-site"
    rep(k, "gemini", c, t - 2400, "hello", client={"name": "gemini-cli-mcp-client", "version": "0.58.0"})
    rep(k, "gemini", c, t - 2300, "status", state="working", title="password=@@FAKE_PW@@ 바꾸기")
    rep(k, "gemini", c, t - 2290, "board", lines=["첫 보드"], done=[])
    rep(k, "gemini", c, t - 2200, "board", lines=["둘째 보드\n줄바꿈", "@@FAKE_SLACK@@"], done=[1])
    k = "other-5-1792519000000-00000005"       # hello만: idle, report 없음
    rep(k, "other", D + "misc", t - 50, "hello", client={"name": "cursor", "version": "1"})
    k = "codex-9-1792518000000-00000009"       # bye → 목록에서 빠짐
    rep(k, "codex", D + "gone", t - 400, "status", state="working", title="곧 끝남")
    rep(k, "codex", D + "gone", t - 390, "bye")
    k = "codex-8-1792490000000-00000008"       # 7시간 전 → STALE
    rep(k, "codex", D + "old", t - 7 * 3600, "status", state="working", title="오래된 보고")
    k = "codex-6-1792518900000-00000006"       # 숨길 프로젝트(플러그인 내부 세션)
    rep(k, "codex", "/Users/alex/.claude-mem/observer-sessions", t - 30, "status", state="working", title="관찰")
    # Claude 사이드카 보고: 훅이 동작 중이므로 모두 버려진다(fx-mcp-hook·fx-mcp-fb·쌍둥이 cwd)
    rep("claude-11-1792518800000-0000000b", "claude", D + "report-hook", t - 250, "status", state="working", title="사이드카 쪽")
    rep("claude-12-1792518800000-0000000c", "claude", D + "report-fb", t - 150, "status", state="working",
        title="훅 없이 보고", step=1, total=2)
    rep("claude-12-1792518800000-0000000c", "claude", D + "report-fb", t - 140, "board", lines=["읽기", "정리"], done=[0])
    rep("claude-13-1792518800000-0000000d", "claude", D + "twins", t - 110, "status", state="working", title="누구 것?")
    # 버려야 하는 줄: 모르는 v, 모르는 type, 잘못된 key, 잘못된 state, 배열이 아닌 lines, JSON 아님
    rep("codex-1-1-00000001", "codex", D + "bad", t - 10, "hello", v=2)
    rep("codex-1-1-00000001", "codex", D + "bad", t - 10, "ping")
    rep("../etc/passwd", "codex", D + "bad", t - 10, "hello")
    rep("codex-2-2-00000002", "codex", D + "bad", t - 10, "status", state="started")
    rep("codex-3-3-00000003", "codex", D + "bad", t - 10, "board", lines="한 줄")
    dump_jsonl(os.path.join(out, "reports.jsonl"), R, tail=None)
    with open(os.path.join(out, "reports.jsonl"), "a", encoding="utf-8") as f:
        f.write("{not json\n")


# =====================================================================================
# 1) 훅 + 트랜스크립트 (Python 서버 기준 결과용)
# =====================================================================================
def build_base(out):
    t = NOW
    proj = os.path.join(out, "projects")
    E = []

    def ev(sid, cwd, ts, event, **kw):
        d = {"ts": ts, "sid": sid, "cwd": cwd, "event": event}
        d.update(kw)
        E.append(d)

    D = HOME + "/dev/"

    # --- fx-read: 파일 읽는 중 (working, 트랜스크립트 있음)
    c = D + "login-app"
    ev("fx-read", c, t - 40, "UserPromptSubmit", text="로그인 버그 고쳐줘")
    ev("fx-read", c, t - 30, "PreToolUse", icon="🔍", text="'session' 찾는 중", kind="search")
    ev("fx-read", c, t - 5, "PreToolUse", icon="📖", text="Login.swift 읽는 중", kind="read")
    x = Tx("fx-read", c)
    x.prompt(t - 40, "로그인 버그 고쳐줘")
    x.call(t - 30, "r1", "Grep", {"pattern": "session", "path": "Sources/"}, usage=(1200, 8000, 0, 90))
    x.say(t - 6, "세션 만료 처리 부분부터 볼게요.", usage=(300, 0, 9200, 40))
    x.tool(t - 5, "r2", "Read", {"file_path": c + "/Sources/Login.swift"}, usage=(100, 0, 9500, 30))
    x.write(proj)

    # --- fx-bash: 테스트 실행 중 + 할 일(TodoWrite) + 컨텍스트 71%
    c = D + "payment"
    ev("fx-bash", c, t - 420, "UserPromptSubmit", text="결제 테스트 전부 돌려줘")
    ev("fx-bash", c, t - 400, "PreToolUse", icon="🗒️", text="할 일 정리 중", kind="todo",
       todos=[{"text": "구조 파악", "status": "completed"}, {"text": "테스트 수정", "status": "completed"},
              {"text": "전체 테스트 돌리는 중", "status": "in_progress"}, {"text": "리포트", "status": "pending"}])
    ev("fx-bash", c, t - 130, "PreToolUse", icon="⚡", text="xcodebuild test", kind="bash")
    x = Tx("fx-bash", c)
    x.prompt(t - 420, "결제 테스트 전부 돌려줘")
    x.call(t - 400, "b0", "TodoWrite", {"todos": []}, dur=0.5, usage=(4000, 38000, 0, 400))
    x.say(t - 135, "실패한 테스트 2개를 고쳤어요. 이제 전체 테스트를 돌려볼게요.", usage=(500, 0, 42000, 120))
    x.tool(t - 130, "b1", "Bash", {"command": "xcodebuild test -scheme Payment", "description": "xcodebuild test"},
           usage=(80, 0, 42500, 60))
    x.write(proj)

    # --- fx-party: 메인은 끝났고(Stop) 백그라운드 에이전트 3개 (p0 멈춤 의심, p1 정상, p2 완료) → status "agents"
    c = D + "api-server"
    ev("fx-party", c, t - 900, "UserPromptSubmit", text="API 구조 조사해줘")
    for i, d in enumerate(["라우터와 미들웨어 구조 조사", "DB 스키마 비교", "인증 흐름 조사"]):
        ev("fx-party", c, t - 880 + i, "PreToolUse", icon="🤖", text="서브에이전트: " + d, kind="agent",
           agent_desc=d, bg=True, agent_req="Explore")
        ev("fx-party", c, t - 879 + i, "SubagentStart", aid="p%d" % i, atype="Explore")
    ev("fx-party", c, t - 400, "PreToolUse", aid="p0", atype="Explore", icon="🔍", text="'router' 찾는 중", kind="search")
    ev("fx-party", c, t - 60, "PreToolUse", aid="p1", atype="Explore", icon="🔍", text="'migration' 찾는 중", kind="search")
    ev("fx-party", c, t - 20, "PreToolUse", aid="p1", atype="Explore", icon="📖", text="schema.sql 읽는 중", kind="read")
    ev("fx-party", c, t - 300, "SubagentStop", aid="p2", atype="Explore")
    ev("fx-party", c, t - 10, "Stop")
    x = Tx("fx-party", c)
    x.prompt(t - 900, "API 구조 조사해줘")
    x.say(t - 885, "세 갈래로 나눠서 조사할게요.", usage=(9000, 0, 0, 300))
    for i, d in enumerate(["라우터와 미들웨어 구조 조사", "DB 스키마 비교", "인증 흐름 조사"]):
        x.call(t - 880 + i, "pa%d" % i, "Agent", {"description": d, "subagent_type": "Explore", "prompt": "...",
                                                  "run_in_background": True}, dur=0.5,
               res="Async agent launched successfully.\nagentId: p%d (internal ID)" % i)
    x.say(t - 10, "에이전트 세 개가 조사 중이에요. 결과가 오면 정리할게요.", stop="end_turn", usage=(200, 0, 9500, 80))
    x.write(proj)
    a = Tx("fx-party", c, True)
    a.prompt(t - 879, "라우터와 미들웨어 구조 조사")
    a.say(t - 401, "라우터는 src/routes 아래에 있네요. 미들웨어 순서를 확인해볼게요.", usage=(30000, 0, 0, 500))
    a.tool(t - 400, "q1", "Grep", {"pattern": "router", "path": "src/"})
    a.write(proj, ("fx-party", "p0"))
    a = Tx("fx-party", c, True)
    a.prompt(t - 878, "DB 스키마 비교")
    a.call(t - 60, "q2", "Grep", {"pattern": "migration"}, usage=(18000, 0, 0, 200))
    a.say(t - 21, "스키마 파일 3개를 찾았어요. 마이그레이션 히스토리와 비교 중입니다.", usage=(100, 0, 18000, 90))
    a.tool(t - 20, "q3", "Read", {"file_path": c + "/db/schema.sql"})
    a.write(proj, ("fx-party", "p1"))
    a = Tx("fx-party", c, True)
    a.prompt(t - 877, "인증 흐름 조사")
    a.say(t - 301, "인증은 미들웨어 한 곳에서 처리해요.", stop="end_turn", usage=(7000, 0, 0, 150))
    a.write(proj, ("fx-party", "p2"))

    # --- fx-input: 입력 필요 (트랜스크립트 없음 → tokens 필드 없음, /trace는 no-transcript)
    c = D + "infra"
    ev("fx-input", c, t - 50, "UserPromptSubmit", text="배포 스크립트 정리")
    ev("fx-input", c, t - 45, "PreToolUse", icon="⚡", text="terraform plan", kind="bash")
    ev("fx-input", c, t - 40, "Notification", text="Claude needs your permission to use Bash")

    # --- fx-cmux: cmux에서 연 세션(#37). 훅이 term.mux(kind cmux)를 실어 보냄 → 세션 jump.mux (마지막 올바른 값.
    #     잘못된 값·모르는 키는 버림, 서브에이전트 이벤트의 값도 받음, term 없는 이벤트는 유지). fx-cmux-bad: 잘못된 값만 → jump 없음
    c = D + "cmux-app"
    ev("fx-cmux", c, t - 80, "UserPromptSubmit", text="cmux에서 작업",
       term={"mux": {"kind": "cmux", "workspace": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", "surface": "9A8B7C6D-5E4F-3A2B-1C0D-E9F8A7B6C5D4"}})
    ev("fx-cmux", c, t - 70, "SubagentStart", aid="cm1", atype="Explore",
       term={"mux": {"kind": "cmux", "workspace": "workspace:2", "surface": "surface:5", "token": "x"}})
    ev("fx-cmux", c, t - 60, "PreToolUse", icon="📖", text="app.py 읽는 중", kind="read",
       term={"mux": {"kind": "cmux", "workspace": "; rm -rf ~", "surface": "surface:6"}})
    ev("fx-cmux", c, t - 55, "PreToolUse", icon="📖", text="b.py 읽는 중", kind="read",
       term={"mux": {"kind": "unknown", "workspace": "workspace:9"}})   # 표에 없는 종류는 버림
    ev("fx-cmux", c, t - 30, "Stop")
    ev("fx-cmux-bad", c, t - 50, "UserPromptSubmit", text="잘못된 cmux 값", term={"mux": {"kind": "cmux", "workspace": "workspace:2\n"}})

    # --- fx-done: 방금 끝남 (같은 프롬프트에 수정 2회)
    c = D + "blog"
    ev("fx-done", c, t - 90, "UserPromptSubmit", text="글 오타 고쳐줘")
    for k, txt in [("read", "post.md 읽는 중"), ("edit", "post.md 고치는 중"), ("edit", "post.md 고치는 중")]:
        ev("fx-done", c, t - 60, "PreToolUse", icon="✏️", text=txt, kind=k)
    ev("fx-done", c, t - 20, "Stop")
    x = Tx("fx-done", c)
    x.prompt(t - 90, "글 오타 고쳐줘")
    x.call(t - 61, "d1", "Read", {"file_path": c + "/posts/post.md"}, dur=0.5, usage=(2000, 0, 0, 50))
    x.call(t - 60, "d2", "Edit", {"file_path": c + "/posts/post.md", "old_string": "a", "new_string": "b"}, dur=0.5)
    x.call(t - 59, "d3", "Edit", {"file_path": c + "/posts/post.md", "old_string": "c", "new_string": "d"}, dur=0.5)
    x.say(t - 20, "오타 3개를 고쳤어요.", stop="end_turn", usage=(100, 0, 2100, 40))
    x.write(proj)

    # --- fx-idle: 오래 전에 끝남 (core.js가 5분 뒤 idle로 보여 줌. 서버 status는 done)
    c = D + "notes"
    ev("fx-idle", c, t - 2000, "UserPromptSubmit", text="회의록 요약해줘")
    ev("fx-idle", c, t - 1900, "PreToolUse", icon="📖", text="meeting.md 읽는 중", kind="read")
    ev("fx-idle", c, t - 1800, "Stop")

    # --- fx-start: SessionStart만 (status idle, 프롬프트 없음)
    ev("fx-start", D + "empty", t - 100, "SessionStart")

    # --- fx-ended: SessionEnd → 목록에서 빠짐. 에이전트 정리(close_agents) 경로도 탐
    c = D + "gone"
    ev("fx-ended", c, t - 500, "UserPromptSubmit", text="정리해줘")
    ev("fx-ended", c, t - 490, "SubagentStart", aid="e0", atype="Explore")
    ev("fx-ended", c, t - 480, "SessionEnd")

    # --- fx-stale: 7시간 전 → 숨김(STALE 6h)
    ev("fx-stale", D + "old", t - 7 * 3600, "UserPromptSubmit", text="오래된 작업")

    # --- fx-yday: 어제(KST) 끝난 세션. 6시간 안이라 보이지만 today 집계·토큰 계산에서는 빠짐
    c = D + "yesterday"
    ev("fx-yday", c, t - 4 * 3600, "UserPromptSubmit", text="어제 하던 것")
    ev("fx-yday", c, t - 4 * 3600 + 300, "PreToolUse", icon="📖", text="todo.md 읽는 중", kind="read")
    ev("fx-yday", c, t - 4 * 3600 + 600, "Stop")
    x = Tx("fx-yday", c)
    x.prompt(t - 4 * 3600, "어제 하던 것")
    x.say(t - 4 * 3600 + 600, "끝났어요.", stop="end_turn", usage=(1000, 0, 0, 10))
    x.write(proj)

    # --- fx-tasks: TaskCreate/TaskUpdate(PostToolUse) 할 일 + 삭제 + 완료 후 새 프롬프트에서 비우기
    c = D + "tasks"
    ev("fx-tasks", c, t - 700, "UserPromptSubmit", text="작업 셋 만들어")
    for i, s in enumerate(["설계", "구현", "문서"]):
        ev("fx-tasks", c, t - 690 + i, "PreToolUse", icon="🔧", text="TaskCreate", kind="todo")
        ev("fx-tasks", c, t - 689.5 + i, "PostToolUse", task_new={"id": str(i + 1), "text": s})
    ev("fx-tasks", c, t - 600, "PostToolUse", task_upd={"id": "1", "status": "in_progress", "text": "설계하는 중"})
    ev("fx-tasks", c, t - 500, "PostToolUse", task_upd={"id": "1", "status": "completed", "text": ""})
    ev("fx-tasks", c, t - 400, "PostToolUse", task_upd={"id": "3", "status": "deleted", "text": ""})
    ev("fx-tasks", c, t - 300, "PostToolUse", task_upd={"id": "2", "status": "in_progress", "text": "구현하는 중"})
    ev("fx-tasks", c, t - 30, "PreToolUse", icon="✏️", text="main.py 고치는 중", kind="edit")

    # --- fx-mask: /state 마스킹 확인 (훅 텍스트·트랜스크립트 발화·에이전트 설명·할 일·알림)
    c = D + "secrets"
    ev("fx-mask", c, t - 80, "UserPromptSubmit", text="키 교체: @@FAKE_SK@@ 로 바꿔")
    ev("fx-mask", c, t - 75, "PreToolUse", icon="🗒️", text="할 일 정리 중", kind="todo",
       todos=[{"text": "password=@@FAKE_PW@@ 지우기", "status": "in_progress"}])
    ev("fx-mask", c, t - 70, "PreToolUse", icon="🤖", text="서브에이전트: @@FAKE_GH@@ 점검", kind="agent",
       agent_desc="@@FAKE_GH@@ 점검", bg=True, agent_req="Explore")
    ev("fx-mask", c, t - 69, "SubagentStart", aid="m0", atype="Explore")
    ev("fx-mask", c, t - 60, "PreToolUse", aid="m0", atype="Explore", icon="⚡", text="export API_KEY=@@FAKE_PW@@",
       kind="bash")
    # 알림 뒤에 도구가 다시 돌면 status는 working이지만 note는 남는다(현행 동작) → note·say 둘 다 마스킹 대상
    ev("fx-mask", c, t - 15, "Notification", text="token=@@FAKE_PW@@ 확인 필요 (키@@FAKE_AWS@@)")
    ev("fx-mask", c, t - 12, "PreToolUse", icon="⚡", text="Authorization: Bearer @@FAKE_BEARER@@", kind="bash")
    x = Tx("fx-mask", c)
    x.prompt(t - 80, "키 교체: @@FAKE_SK@@ 로 바꿔")
    # 160자 경계에 걸친 시크릿: 마스킹 → 절단 순서면 조각이 남지 않음
    x.say(t - 13, "가" * 150 + " @@FAKE_SLACK@@ 그리고 @@FAKE_JWT@@ 끝", usage=(100, 0, 0, 10))
    x.write(proj)
    a = Tx("fx-mask", c, True)
    a.prompt(t - 69, "점검")
    a.say(t - 61, "secret: @@FAKE_PW@@ 발견", usage=(50, 0, 0, 5))
    a.write(proj, ("fx-mask", "m0"))

    # --- fx-flow: 흐름 모드용 (지난 요청 1 + 진행 중 요청: 에이전트 3, 실패·재시도, 시크릿, 긴 침묵)
    build_flow(E, proj, t)

    # --- fx-big: 600단계 초과 → older bins
    c = D + "bigrepo"
    ev("fx-big", c, t - 3000, "UserPromptSubmit", text="큰 리팩터링")
    ev("fx-big", c, t - 100, "Stop")
    x = Tx("fx-big", c)
    x.prompt(t - 3000, "큰 리팩터링")
    for i in range(700):
        ts = t - 2990 + i * 4
        if i % 3 == 0:
            x.call(ts, "g%d" % i, "Read", {"file_path": c + "/src/m%d.py" % (i % 40)}, dur=1)
        elif i % 3 == 1:
            x.call(ts, "g%d" % i, "Edit", {"file_path": c + "/src/m%d.py" % (i % 40), "old_string": "a", "new_string": "b"},
                   dur=1, err=(i % 50 == 1), res="String not found" if i % 50 == 1 else "ok")
        else:
            x.call(ts, "g%d" % i, "Bash", {"command": "pytest tests/test_m%d.py -q" % (i % 40), "description": "Run test %d" % i}, dur=2)
    x.say(t - 100, "리팩터링을 마쳤어요.", stop="end_turn", usage=(5000, 0, 900000, 20000))
    x.write(proj)

    # --- fx-partial: 마지막 줄이 쓰는 중(개행 없음) → 무시. cases.json의 truncate 단계가 이 파일을 줄임
    c = D + "partial"
    ev("fx-partial", c, t - 200, "UserPromptSubmit", text="부분 기록 테스트")
    ev("fx-partial", c, t - 190, "PreToolUse", icon="⚡", text="ls", kind="bash")
    x = Tx("fx-partial", c)
    x.prompt(t - 200, "부분 기록 테스트")
    x.call(t - 190, "x1", "Bash", {"command": "ls -la", "description": "List files"}, dur=1, usage=(700, 0, 0, 20))
    x.say(t - 180, "목록을 봤어요.", usage=(10, 0, 700, 5))
    p = x.write(proj)
    tail = json.dumps(x.say(t - 170, "아직 쓰는 중인 줄"), ensure_ascii=False)[:-20]
    x.rows.pop()
    dump_jsonl(p, x.rows, tail=tail)

    # --- fx-cmd: 슬래시 명령 프롬프트 + isMeta 줄(무시) + 시스템 태그로 시작하는 사용자 줄(무시)
    c = D + "cmd"
    ev("fx-cmd", c, t - 150, "UserPromptSubmit", text="/review 결제 모듈")
    ev("fx-cmd", c, t - 140, "Stop")
    x = Tx("fx-cmd", c)
    x.prompt(t - 151, "Caveat: local command output", isMeta=True)
    x.prompt(t - 150, "<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>결제 모듈</command-args>")
    x.prompt(t - 149, "<local-command-stdout>ok</local-command-stdout>")
    x.think(t - 148, "", 25000)
    x.think(t - 147, "리뷰 범위를 정해야 함. 아마 gateway.py가 핵심일 것 같다.", 3000)
    x.say(t - 140, "리뷰 결과: 문제 없음. 원인은 설정값이었어요.", stop="end_turn", usage=(300, 0, 0, 30))
    x.write(proj)

    # --- fx-stale: SubagentStop이 오지 않은 에이전트. 마지막 활동(훅 last·트랜스크립트 마지막 기록 중 늦은 것)이
    #     STALE(6시간)보다 오래되면 done + stale. s59: 5시간 59분(유지) / s61: 6시간 1분(종료) /
    #     tx-new: 훅은 8시간 전이지만 트랜스크립트가 1분 전(유지) / tx-old: 훅 7시간·트랜스크립트 6시간 30분 전(종료, 토큰은 유지)
    c = D + "ghosts"
    H = 3600
    ev("fx-stale", c, t - 120, "UserPromptSubmit", text="백그라운드 조사 맡겨둘게")
    ev("fx-stale", c, t - 100, "Stop")
    for aid, ago in (("s59", H * 6 - 60), ("s61", H * 6 + 60), ("txnew", H * 8), ("txold", H * 7)):
        ev("fx-stale", c, t - ago, "SubagentStart", aid=aid, atype="general-purpose")
        ev("fx-stale", c, t - ago + 5, "PreToolUse", aid=aid, atype="general-purpose", icon="📖", text="notes.md 읽는 중", kind="read")
    x = Tx("fx-stale", c)
    x.prompt(t - 120, "백그라운드 조사 맡겨둘게")
    x.say(t - 100, "맡겼어요.", stop="end_turn", usage=(100, 0, 0, 10))
    x.write(proj)
    a = Tx("fx-stale", c, True)
    a.prompt(t - H * 8, "조사")
    a.say(t - 60, "아직 조사 중이에요.", usage=(200, 0, 0, 20))
    a.write(proj, ("fx-stale", "txnew"))
    a = Tx("fx-stale", c, True)
    a.prompt(t - H * 7, "조사")
    a.say(t - H * 6 - 1800, "여기까지 조사했어요.", usage=(300, 0, 0, 30))
    a.write(proj, ("fx-stale", "txold"))

    # --- fx-obs: 플러그인 내부 세션(claude-mem 관찰자) → 기본 숨김이라 어느 결과에도 나오면 안 됨 (훅·트랜스크립트 양쪽)
    c = "/Users/alex/.claude-mem/observer-sessions"
    ev("fx-obs", c, t - 5, "UserPromptSubmit", text="<observation>…</observation>")
    ev("fx-obs", c, t - 4, "PreToolUse", icon="📖", text="x 읽는 중", kind="read")
    x = Tx("fx-obs", c)
    x.prompt(t - 5, "<observation>…</observation>")
    x.say(t - 4, "관찰 기록 중", usage=(10, 0, 0, 5))
    x.write(proj)

    build_reports(E, out, t)

    dump_jsonl(os.path.join(out, "events.jsonl"), sorted(E, key=lambda e: e["ts"]))
    json.dump({"limits": {"five_hour": {"used_percentage": 63, "resets_at": t + 3 * 3600 + 600},
                          "seven_day": {"used_percentage": 27, "resets_at": t + 4 * 86400 + 18 * 3600}},
               "limits_ts": t - 30,
               "sessions": {"fx-read": {"ts": t, "ctx": 34, "model": "Opus"},
                            "fx-bash": {"ts": t, "ctx": 71, "model": "Opus"}}},
              open(os.path.join(out, "statusline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # cases.json의 append 단계용 조각: fx-flow의 진행 중 도구가 끝나고 새 발화가 붙음
    pdir = os.path.join(out, "patches")
    os.makedirs(pdir, exist_ok=True)
    y = Tx("fx-flow", D + "shop-api")
    y.n = 500
    y.result(t + 5, "tuLAST", "64 passed")
    y.say(t + 8, "전체 테스트 64개가 통과했어요. 결제 재시도 문제를 고쳤습니다.", stop="end_turn", usage=(100, 0, 60000, 300))
    dump_jsonl(os.path.join(pdir, "fx-flow.append.jsonl"), y.rows)
    # truncate 단계용: fx-partial을 프롬프트 한 줄로 줄임 (파일 크기 감소 → 캐시 재시작, gen 증가)
    z = Tx("fx-partial", D + "partial")
    z.prompt(t - 200, "부분 기록 테스트")
    dump_jsonl(os.path.join(pdir, "fx-partial.truncate.jsonl"), z.rows)
    build_daylog_patches(pdir, t)


def build_daylog_patches(pdir, t):
    """퇴근 일보(일지) 시나리오 조각. now = 03:00 KST라 1시간 뒤 04:00이 하루 경계.
    오전: 03:59:59에 끝난 턴(어제) / 04:00:00에 끝난 턴(오늘) / 질문 대기 80초 + 큰 일(800초) / 끝난 뒤 알림은 대기 아님
    오후: 13:00~13:15 큰 일(900초) → 13:15 + 45분 = 14:00부터 퇴근 준비됨
    한도: 04:25에 5시간 100%(정전) → 06:15에 새 창 12%(06:10 리셋으로 정전 끝)"""
    D = HOME + "/dev/"
    E = []

    def ev(sid, cwd, ts, event, **kw):
        d = {"ts": ts, "sid": sid, "cwd": cwd, "event": event}
        d.update(kw)
        E.append(d)
    n, a, u = D + "night-batch", D + "daily-api", D + "ui-kit"
    ev("fx-night", n, t + 3480, "UserPromptSubmit", text="새벽 배치 점검")
    ev("fx-night", n, t + 3500, "PreToolUse", icon="⚡", text="배치 로그 확인", kind="bash")
    ev("fx-night", n, t + 3599, "Stop")
    ev("fx-night", n, t + 3599.5, "UserPromptSubmit", text="경계 확인")
    ev("fx-night", n, t + 3600, "Stop")
    ev("fx-day", a, t + 4000, "UserPromptSubmit", text="웹훅 재시도 고쳐줘 token=@@FAKE_PW@@")
    ev("fx-day", a, t + 4010, "PreToolUse", icon="⚡", text="테스트 실행", kind="bash")
    ev("fx-day", a, t + 4020, "Notification", text="Claude needs your permission to use Bash")
    ev("fx-day", a, t + 4030, "Notification", text="Claude needs your permission to use Bash")
    ev("fx-day", a, t + 4100, "PreToolUse", icon="✏️", text="retry.py 고치는 중", kind="edit")
    ev("fx-day", a, t + 4800, "Stop")
    ev("fx-ui", u, t + 4200, "UserPromptSubmit", text="버튼 색 바꿔줘")
    ev("fx-ui", u, t + 4500, "Stop")
    ev("fx-ui", u, t + 4560, "Notification", text="Claude is waiting for your input")
    ev("fx-ui", u, t + 4700, "UserPromptSubmit", text="여백도 줄여줘")
    ev("fx-ui", u, t + 4760, "Stop")
    dump_jsonl(os.path.join(pdir, "daylog.morning.jsonl"), sorted(E, key=lambda e: e["ts"]))
    E.clear()
    ev("fx-day", a, t + 36000, "UserPromptSubmit", text="재시도 로그 정리")
    ev("fx-day", a, t + 36010, "PreToolUse", icon="📖", text="retry.py 읽는 중", kind="read")
    ev("fx-day", a, t + 36900, "Stop")
    dump_jsonl(os.path.join(pdir, "daylog.afternoon.jsonl"), E)
    for name, five, resets, week in (("outage", 100, t + 3 * 3600 + 600, 40), ("reset", 12, t + 8 * 3600 + 600, 41)):
        with open(os.path.join(pdir, "statusline.%s.json" % name), "w", encoding="utf-8") as f:
            json.dump({"limits": {"five_hour": {"used_percentage": five, "resets_at": resets},
                                  "seven_day": {"used_percentage": week, "resets_at": t + 4 * 86400 + 18 * 3600}},
                       "limits_ts": t + 5000}, f, ensure_ascii=False, indent=1)


def build_flow(E, proj, t):
    CWD = HOME + "/dev/shop-api"
    x = Tx("fx-flow", CWD)
    n = [0]

    def tool(ts, name, inp, dur=1.5, err=None, res="ok", tid=None):
        n[0] += 1
        tid = tid or "tu%d" % n[0]
        x.call(ts, tid, name, inp, dur=dur, res=err or res, err=bool(err))
        return tid

    T = t - 3600
    x.prompt(T, "주문 목록 API에 페이지네이션 추가해줘")
    x.say(T + 4, "먼저 주문 라우터 구조를 볼게요.", usage=(6000, 20000, 0, 200))
    tool(T + 6, "Grep", {"pattern": "def list_orders", "path": "app/"})
    tool(T + 9, "Read", {"file_path": CWD + "/app/routes/orders.py"})
    tool(T + 14, "Read", {"file_path": CWD + "/app/db/queries.py"})
    x.say(T + 30, "I'll add limit/offset params and a cursor to the response.")
    tool(T + 33, "Edit", {"file_path": CWD + "/app/routes/orders.py", "old_string": "a", "new_string": "b"})
    tool(T + 40, "Edit", {"file_path": CWD + "/app/db/queries.py", "old_string": "a", "new_string": "b"})
    tool(T + 48, "Bash", {"command": "pytest tests/test_orders.py -q", "description": "Run order tests"}, dur=6)
    x.say(T + 60, "페이지네이션을 추가했고 테스트 12개가 모두 통과했어요.", stop="end_turn", usage=(500, 0, 26000, 400))

    T = t - 900
    x.prompt(T, "결제 실패율이 왜 올랐는지 조사하고 고쳐줘. 키는 @@FAKE_SK@@ 야")
    x.say(T + 5, "Let me look at the payment module first, then I'll split the log analysis to agents.",
          usage=(8000, 30000, 0, 300))
    tool(T + 8, "Glob", {"pattern": "app/payments/**/*.py"})
    tool(T + 11, "Read", {"file_path": CWD + "/app/payments/gateway.py"})
    tool(T + 15, "Read", {"file_path": CWD + "/app/payments/retry.py"})
    tool(T + 21, "Bash", {"command": "grep -rn 'timeout' app/payments/ | head -40", "description": "Find timeout settings"})
    tool(T + 26, "Bash", {"command": "git log --oneline -15 -- app/payments/ && echo token=@@FAKE_PW@@"})
    x.say(T + 34, "재시도 간격이 최근 커밋에서 0.1초로 줄었네요. 이게 원인일 것 같아요. 로그 분석과 PG사 응답 코드 조사는 에이전트에게 나눠 맡길게요.")
    tool(T + 38, "TodoWrite", {"todos": []})
    A = [("a1x", "결제 로그 분석", "Explore", 40, True), ("a2x", "PG 응답 코드 조사", "Explore", 42, False),
         ("a3x", "재시도 로직 테스트 작성", "general-purpose", 44, False)]
    sub = os.path.join(proj, enc(CWD), "fx-flow", "subagents")
    os.makedirs(sub, exist_ok=True)
    for aid, desc, typ, off, fin in A:
        tid = tool(T + off, "Agent", {"description": desc, "subagent_type": typ, "prompt": "...", "run_in_background": True},
                   dur=.5, res="Async agent launched successfully.\nagentId: %s (internal ID)" % aid)
        meta = {"agentType": typ, "description": desc, "toolUseId": tid}
        if fin:
            meta["finished"] = True
        json.dump(meta, open(os.path.join(sub, "agent-%s.meta.json" % aid), "w", encoding="utf-8"), ensure_ascii=False)
    x.say(T + 50, "에이전트 세 개를 보냈어요. 결과가 오면 이어서 고칠게요.", stop="end_turn")
    x.prompt(T + 300, "<task-notification>\n<task-id>a1x</task-id>\n<status>completed</status>\n"
                      "<summary>Agent \"결제 로그 분석\" completed</summary>\n</task-notification>")
    x.say(T + 310, "로그 분석 결과: 실패의 82%가 PG 타임아웃 직후 재시도에서 나왔어요. 재시도 간격을 지수 백오프로 바꿀게요.")
    tool(T + 315, "Bash", {"command": "sed -i 's/0.1/backoff()/' app/payments/retry.py", "description": "Patch retry with sed"},
         err="Permission denied: sed -i blocked by policy")
    tool(T + 322, "Edit", {"file_path": CWD + "/app/payments/retry.py", "old_string": "x", "new_string": "y"})
    tool(T + 330, "Edit", {"file_path": CWD + "/app/payments/config.py", "old_string": "x", "new_string": "y"})
    tool(T + 340, "Bash", {"command": "pytest tests/payments -q", "description": "Run payment tests"}, dur=14,
         err="2 failed, 31 passed")
    x.say(T + 360, "테스트 2개가 실패했어요. 백오프 상한 값을 테스트가 기대하는 30초로 맞출게요.")
    tool(T + 366, "Read", {"file_path": CWD + "/tests/payments/test_retry.py"})
    tool(T + 372, "Edit", {"file_path": CWD + "/app/payments/retry.py", "old_string": "x", "new_string": "y"})
    tool(T + 380, "Bash", {"command": "pytest tests/payments -q", "description": "Re-run payment tests"}, dur=13)
    x.say(T + 560, "Tests pass. Now I'll check the dashboard config (token=@@FAKE_PW@@) and verify the metrics query.")
    tool(T + 565, "Read", {"file_path": CWD + "/deploy/metrics.yml"})
    tool(T + 572, "Bash", {"command": "python3 scripts/check_metrics.py --since 1h", "description": "Verify failure-rate metric"}, dur=5)
    tool(T + 880, "Bash", {"command": "pytest tests -q -x", "description": "Run full test suite"}, dur=None, tid="tuLAST")
    x.write(proj)

    def agent(aid, start, steps):
        a = Tx("fx-flow", CWD, True)
        a.prompt(start, "task prompt for " + aid)
        k = [0]

        def tool(ts, name, inp, dur=1.5, err=None):
            k[0] += 1
            a.call(ts, "%s-t%d" % (aid, k[0]), name, inp, dur=dur, res=err or "ok", err=bool(err))
        for s in steps:
            s(a, tool)
        a.write(proj, ("fx-flow", aid))

    S = T + 41
    agent("a1x", S, [lambda a, tool: a.say(S + 5, "로그 파일부터 찾을게요.", usage=(12000, 0, 0, 100)),
                     lambda a, tool: tool(S + 8, "Glob", {"pattern": "logs/payments-*.log"})]
          + [(lambda k: lambda a, tool: tool(S + 14 + k * 9, "Bash", {"command": "grep -c TIMEOUT logs/payments-0%d.log" % k,
                                                                      "description": "Count timeouts day %d" % k}))(k) for k in range(8)]
          + [lambda a, tool: tool(S + 100, "Read", {"file_path": CWD + "/logs/summary.json"}),
             lambda a, tool: a.say(S + 230, "결론: 실패의 82%가 타임아웃 후 0.1초 재시도에서 발생. 커밋 3f2a 이후 급증했어요."),
             lambda a, tool: tool(S + 250, "SubagentHandback", {"message": "..."}),
             lambda a, tool: a.say(S + 255, "done", stop="end_turn", usage=(100, 0, 12000, 50))])
    S2 = T + 43
    agent("a2x", S2, [lambda a, tool: a.say(S2 + 4, "PG 문서와 응답 코드 매핑을 확인해 볼게요.", usage=(9000, 0, 0, 80)),
                      lambda a, tool: tool(S2 + 7, "WebFetch", {"url": "https://docs.pg.example/codes"}),
                      lambda a, tool: tool(S2 + 20, "Grep", {"pattern": "PG_ERR_", "path": "app/payments"}),
                      lambda a, tool: tool(S2 + 30, "Read", {"file_path": CWD + "/app/payments/codes.py"}),
                      lambda a, tool: a.say(S2 + 380, "응답 코드 4012가 재시도 불가 코드인데 재시도 목록에 들어 있는 것 같아요."),
                      lambda a, tool: tool(S2 + 400, "Read", {"file_path": CWD + "/app/payments/gateway.py"}),
                      lambda a, tool: tool(S2 + 700, "Bash", {"command": "python3 scripts/replay.py --code 4012", "description": "Replay 4012 responses"}),
                      lambda a, tool: tool(S2 + 760, "Bash", {"command": "python3 scripts/replay.py --code 4013", "description": "Replay 4013 responses"}, dur=None)])
    S3 = T + 45
    agent("a3x", S3, [lambda a, tool: a.say(S3 + 6, "I'll write tests for backoff timing first.", usage=(7000, 0, 0, 60)),
                      lambda a, tool: tool(S3 + 10, "Read", {"file_path": CWD + "/tests/payments/test_retry.py"}),
                      lambda a, tool: tool(S3 + 20, "Write", {"file_path": CWD + "/tests/payments/test_backoff.py", "content": "..."}),
                      lambda a, tool: tool(S3 + 34, "Bash", {"command": "pytest tests/payments/test_backoff.py -q", "description": "Run new backoff tests"},
                                           err="ImportError: cannot import name 'backoff'"),
                      lambda a, tool: tool(S3 + 44, "Edit", {"file_path": CWD + "/tests/payments/test_backoff.py", "old_string": "x", "new_string": "y"}),
                      lambda a, tool: tool(S3 + 55, "Bash", {"command": "pytest tests/payments/test_backoff.py -q", "description": "Re-run backoff tests"})]
          + [(lambda k: lambda a, tool: tool(S3 + 600 + k * 20, "Edit", {"file_path": CWD + "/tests/payments/test_case_%d.py" % k,
                                                                         "old_string": "x", "new_string": "y"}))(k) for k in range(6)]
          + [lambda a, tool: a.say(S3 + 830, "Edge cases written; now verifying they fail on the old code as expected."),
             lambda a, tool: tool(S3 + 840, "Bash", {"command": "pytest tests/payments -q -k edge", "description": "Verify edge-case tests"})])

    def ev(ts, event, **kw):
        d = {"ts": ts, "sid": "fx-flow", "cwd": CWD, "event": event}
        d.update(kw)
        E.append(d)
    ev(t - 3600, "UserPromptSubmit", text="주문 목록 API에 페이지네이션 추가해줘")
    ev(t - 3540, "Stop")
    ev(T, "UserPromptSubmit", text="결제 실패율이 왜 올랐는지 조사하고 고쳐줘. 키는 @@FAKE_SK@@ 야")
    for aid, desc, typ, off, fin in A:
        ev(T + off - .5, "PreToolUse", icon="🤖", text="서브에이전트: " + desc, kind="agent", agent_desc=desc, bg=True, agent_req=typ)
        ev(T + off, "SubagentStart", aid=aid, atype=typ)
    ev(T + 50, "Stop")
    ev(T + 296, "SubagentStop", aid="a1x", atype="Explore")
    ev(T + 300, "Resume")
    ev(t - 20, "PreToolUse", icon="⚡", text="Run full test suite", kind="bash")


# =====================================================================================
# 2) 트랜스크립트 전용 (훅 없음). 판정 규칙: fixtures/transcript-only/RULES.md, 기대값: expected.json
#    세션 ID = 케이스 이름. 모두 같은 projects 루트에 둔다(발견 규칙도 함께 검증).
# =====================================================================================
def build_transcript_only(out):
    t = NOW
    proj = os.path.join(out, "projects")
    D = HOME + "/dev/"

    def new(sid, proj_name="demo"):
        return Tx(sid, D + proj_name)

    x = new("to-working-prompt"); x.prompt(t - 3, "README 정리해줘"); x.write(proj)

    x = new("to-working-read")
    x.prompt(t - 40, "구조 설명해줘")
    x.tool(t - 20, "r1", "Read", {"file_path": D + "demo/src/app.py"}, usage=(1000, 0, 0, 20))
    x.write(proj)

    x = new("to-working-result")
    x.prompt(t - 30, "테스트 돌려줘")
    x.call(t - 12, "r1", "Bash", {"command": "pytest -q", "description": "Run tests"}, dur=10)
    x.write(proj)

    x = new("to-done")
    x.prompt(t - 120, "오타 고쳐줘")
    x.call(t - 100, "d1", "Edit", {"file_path": D + "demo/README.md", "old_string": "a", "new_string": "b"}, dur=0.5)
    x.say(t - 90, "고쳤어요.", stop="end_turn", usage=(500, 0, 0, 30))
    x.write(proj)

    x = new("to-input-edit")
    x.prompt(t - 30, "설정 바꿔줘")
    x.tool(t - 15, "e1", "Edit", {"file_path": D + "demo/config.toml", "old_string": "a", "new_string": "b"})
    x.write(proj)

    x = new("to-bash-short")
    x.prompt(t - 10, "빌드해줘")
    x.tool(t - 5, "b1", "Bash", {"command": "make build", "description": "Build"})
    x.write(proj)

    x = new("to-bash-long")
    x.prompt(t - 260, "전체 테스트")
    x.tool(t - 200, "b1", "Bash", {"command": "pytest", "description": "Run all tests"})
    x.write(proj)

    x = new("to-bash-bg")
    x.prompt(t - 100, "서버 띄워줘")
    x.tool(t - 90, "b1", "Bash", {"command": "npm run dev", "description": "Start dev server", "run_in_background": True})
    x.write(proj)

    x = new("to-ask")
    x.prompt(t - 20, "어떤 방식이 좋을까?")
    x.tool(t - 2, "q1", "AskUserQuestion", {"questions": [{"question": "A? B?"}]})
    x.write(proj)

    x = new("to-plan")
    x.prompt(t - 60, "계획 세워줘")
    x.tool(t - 4, "p1", "ExitPlanMode", {"plan": "1. ..."})
    x.write(proj)

    x = new("to-interrupted")
    x.prompt(t - 50, "리팩터링해줘")
    x.tool(t - 40, "i1", "Bash", {"command": "sleep 100", "description": "Wait"})
    x.result(t - 30, "i1", "The user doesn't want to proceed with this tool use.", err=True)
    x.prompt(t - 30, [{"type": "text", "text": "[Request interrupted by user for tool use]"}])
    x.write(proj)

    x = new("to-stall-model")
    x.prompt(t - 500, "분석해줘")
    x.call(t - 420, "s1", "Read", {"file_path": D + "demo/big.log"}, dur=20)
    x.write(proj)

    x = new("to-slow-tool")
    x.prompt(t - 200, "읽어줘")
    x.tool(t - 150, "s1", "Grep", {"pattern": "TODO"})
    x.write(proj)

    x = new("to-null-stop-recent")
    x.prompt(t - 40, "설명해줘")
    x.say(t - 10, "설명 중입니다…")
    x.write(proj)

    x = new("to-null-stop-old")
    x.prompt(t - 200, "설명해줘")
    x.say(t - 100, "설명을 마쳤어요.")
    x.write(proj)

    x = new("to-agents-bg")
    x.prompt(t - 300, "조사 나눠서 해줘")
    x.call(t - 290, "a1", "Agent", {"description": "로그 조사", "subagent_type": "Explore", "prompt": "...",
                                    "run_in_background": True}, dur=0.5,
           res="Async agent launched successfully.\nagentId: bg1 (internal ID)")
    x.say(t - 280, "에이전트를 보냈어요.", stop="end_turn")
    x.write(proj)
    a = Tx("to-agents-bg", D + "demo", True)
    a.prompt(t - 289, "로그 조사")
    a.call(t - 30, "z1", "Grep", {"pattern": "ERROR"}, dur=1, usage=(3000, 0, 0, 40))
    a.write(proj, ("to-agents-bg", "bg1"))
    json.dump({"agentType": "Explore", "description": "로그 조사", "toolUseId": "a1"},
              open(os.path.join(proj, enc(D + "demo"), "to-agents-bg", "subagents", "agent-bg1.meta.json"), "w",
                   encoding="utf-8"), ensure_ascii=False)

    x = new("to-agents-joined")
    x.prompt(t - 400, "조사해줘")
    x.call(t - 390, "a1", "Agent", {"description": "API 조사", "subagent_type": "Explore", "prompt": "...",
                                    "run_in_background": True}, dur=0.5,
           res="Async agent launched successfully.\nagentId: bg2 (internal ID)")
    x.say(t - 385, "보냈어요.", stop="end_turn")
    x.prompt(t - 100, "<task-notification>\n<task-id>bg2</task-id>\n<status>completed</status>\n"
                      "<summary>Agent \"API 조사\" completed</summary>\n</task-notification>")
    x.say(t - 90, "조사 결과를 정리했어요.", stop="end_turn")
    x.write(proj)
    a = Tx("to-agents-joined", D + "demo", True)
    a.prompt(t - 389, "API 조사")
    a.say(t - 110, "끝", stop="end_turn")
    a.write(proj, ("to-agents-joined", "bg2"))

    x = new("to-agent-sync")
    x.prompt(t - 100, "탐색해줘")
    x.tool(t - 90, "a1", "Agent", {"description": "코드 탐색", "subagent_type": "Explore", "prompt": "..."})
    x.write(proj)
    a = Tx("to-agent-sync", D + "demo", True)
    a.prompt(t - 89, "코드 탐색")
    a.tool(t - 5, "y1", "Read", {"file_path": D + "demo/a.py"})
    a.write(proj, ("to-agent-sync", "sy1"))
    json.dump({"agentType": "Explore", "description": "코드 탐색", "toolUseId": "a1"},
              open(os.path.join(proj, enc(D + "demo"), "to-agent-sync", "subagents", "agent-sy1.meta.json"), "w",
                   encoding="utf-8"), ensure_ascii=False)

    x = new("to-stale")
    x.prompt(t - 7 * 3600, "옛날 일")
    x.say(t - 7 * 3600 + 10, "끝", stop="end_turn")
    x.write(proj)

    x = new("to-partial")
    x.prompt(t - 60, "기록 중")
    x.say(t - 50, "확인했어요.", stop="end_turn")
    p = x.write(proj)
    tail = json.dumps(x.tool(t - 1, "pp", "Bash", {"command": "ls"}), ensure_ascii=False)[:-15]
    x.rows.pop()
    dump_jsonl(p, x.rows, tail=tail)

    x = new("to-mask")
    x.prompt(t - 20, "이 키 써: @@FAKE_SK@@ 그리고 password=@@FAKE_PW@@")
    x.write(proj)

    x = new("to-todos")
    x.prompt(t - 60, "할 일 만들고 진행해")
    x.call(t - 50, "t1", "TodoWrite", {"todos": [
        {"content": "구조 파악", "activeForm": "구조 파악하는 중", "status": "completed"},
        {"content": "수정", "activeForm": "수정하는 중", "status": "in_progress"},
        {"content": "테스트", "activeForm": "테스트하는 중", "status": "pending"}]}, dur=0.2)
    x.tool(t - 3, "t2", "Read", {"file_path": D + "demo/main.py"})
    x.write(proj)

    x = new("to-command")
    x.prompt(t - 31, "Caveat: meta", isMeta=True)
    x.prompt(t - 30, "<command-name>/review</command-name>\n<command-args>PR 42</command-args>")
    x.prompt(t - 29, "<local-command-stdout>ok</local-command-stdout>")
    x.write(proj)

    x = new("to-command-run")
    x.prompt(t - 20, "<command-name>/review</command-name>\n<command-args>PR 42</command-args>")
    x.say(t - 5, "PR 42를 리뷰할게요.")
    x.write(proj)


def main():
    for sub in ("input", os.path.join("transcript-only", "input")):
        p = os.path.join(HERE, sub)
        if os.path.isdir(p):
            shutil.rmtree(p)
    build_base(os.path.join(HERE, "input"))
    build_transcript_only(os.path.join(HERE, "transcript-only", "input"))
    print("fixtures ready (now=%d)" % NOW)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""events.jsonl을 읽어 세션별 상태를 /state로 제공하고 web/(코어·내장 모드)과 외부 모드 샌드박스(/_modes/)를 서빙."""
import glob
import json
import re
import os
import sys
import threading
import time
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from statusline_tap import merge_limits  # 한도 병합 규칙 (탭과 같은 코드)
from daylog import DayLog  # 퇴근 일보용 하루치 기록 (Rust wr-core daylog.rs와 같은 규칙)
import mcp_report as MR  # MCP 보고 정화·접기 (Rust wr-core report.rs와 같은 규칙)

LOG = os.environ.get("WAITING_ROOM_LOG", os.path.expanduser("~/.claude/waiting-room/events.jsonl"))
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("WAITING_ROOM_PORT", "7777"))
# DNS 리바인딩 방지: 브라우저가 보낸 Host가 이 둘이 아니면 403 (127.0.0.1 바인딩만으로는 막지 못함)
ALLOWED_HOSTS = {"localhost:%d" % PORT, "127.0.0.1:%d" % PORT}
STATUS = os.environ.get("WAITING_ROOM_STATUS", os.path.expanduser("~/.claude/waiting-room/statusline.json"))
POLL = os.environ.get("WAITING_ROOM_POLL_USAGE") == "1"  # 켜면 사용 한도를 5분마다 직접 조회
_polled = {"limits": None, "ts": 0, "err": None}
_sl_memo = {"limits": None}  # 지금까지 본 statusline 한도의 창별 병합 상태 (파일이 오래된 값으로 덮여도 내려가지 않게)
# 숨길 프로젝트: 플러그인 내부 세션(claude-mem 관찰자 등) 기본 + WAITING_ROOM_HIDE(쉼표 구분). Rust wr-core `hide.rs`와 같은 규칙
DEFAULT_HIDE = [".claude-mem/observer-sessions"]
WEB = os.path.join(HERE, "web")  # 프론트 정적 루트 (Tauri frontendDist와 같은 폴더)
# 정적 파일: 코어·내장 모드 패키지·brand.json만 (경로는 정규식으로 제한. 폴더 이름에 점이 없어 ".."이 들어갈 수 없음)
STATIC = re.compile(r"^/(core/[a-z0-9-]+\.(js|css)|fonts/[A-Za-z0-9-]+\.woff2|modes/index\.json|modes/[a-z0-9-]+/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(js|css|json|svg|png|md))$")
# 사용자(외부) 모드 폴더. 브라우저에서는 /_modes/<id>/… 로 샌드박스 iframe 전용 응답(CSP)과 함께 서빙
USER_MODES = os.environ.get("WAITING_ROOM_MODES", os.path.expanduser("~/.claude/waiting-room/modes"))
MODE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MODE_FILE = re.compile(r"^/_modes/([a-z0-9][a-z0-9-]{0,31})/((?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/){0,4}[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$")
SDK = {"/_sdk/mode-sdk.js": "sdk/mode-sdk.js", "/_sdk/core-lib.js": "core/core-lib.js", "/_sdk/sandbox.css": "sdk/sandbox.css"}
MIME = {"js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif",
        "woff2": "font/woff2", "ttf": "font/ttf", "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav",
        "md": "text/plain; charset=utf-8", "txt": "text/plain; charset=utf-8", "html": "text/html; charset=utf-8"}
MODE_EXT = set(MIME) - {"html"}  # 외부 모드 패키지에서 서빙하는 확장자 (ARCHITECTURE.md §4.6 화이트리스트)
STALE = 6 * 3600  # 이 시간 동안 소식 없는 세션은 숨김


def _norm_path(s):
    """영숫자가 아닌 글자는 모두 '-' (Claude Code의 프로젝트 폴더 이름 규칙과 같음), 소문자"""
    return "".join(c.lower() if c.isalnum() else "-" for c in s)


def hide_patterns():
    user = [x.strip() for x in os.environ.get("WAITING_ROOM_HIDE", "").split(",")]
    base = [] if os.environ.get("WAITING_ROOM_HIDE_DEFAULTS") == "0" else DEFAULT_HIDE
    return [_norm_path(p) for p in base + user if any(c.isalnum() for c in p)]


HIDE = hide_patterns()


def is_hidden(cwd):
    n = _norm_path(cwd or "")
    return bool(cwd) and any(p in n for p in HIDE)


PROJECTS = os.environ.get("WAITING_ROOM_PROJECTS", os.path.expanduser("~/.claude/projects"))
_scan, _paths = {}, {}


SLOW, STALL = 120, 300          # 모델 응답이 이만큼(초) 없으면 느림/멈춤 의심
TOOL_SLOW, TOOL_STALL = 120, 600  # 도구 하나가 이만큼 안 끝나면 느림/멈춤 의심


def iso(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()


def scan(path):
    """트랜스크립트를 이어 읽어 토큰(메시지 id로 중복 제거), 마지막 발화, 실행 중인 도구, 마지막 기록 시각을 모은다."""
    c = _scan.setdefault(path, {"off": 0, "msgs": {}, "say": "", "pending": {}, "last_ts": 0})
    try:
        if os.path.getsize(path) < c["off"]:
            c.update(off=0, msgs={}, say="", pending={}, last_ts=0)
        with open(path, "rb") as f:
            f.seek(c["off"])
            for raw in f:
                if not raw.endswith(b"\n"):
                    break
                c["off"] += len(raw)
                if b'"assistant"' not in raw and b'"user"' not in raw:
                    continue
                try:
                    d = json.loads(raw)
                    kind = d.get("type")
                    if kind not in ("assistant", "user"):
                        continue
                    ts = iso(d["timestamp"])
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
                m = d.get("message") or {}
                content = m.get("content")
                blocks = content if isinstance(content, list) else []
                c["last_ts"] = max(c["last_ts"], ts)
                if kind == "assistant":
                    u = m.get("usage")
                    if u:
                        c["msgs"][m.get("id") or d.get("uuid")] = (
                            ts, u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0),
                            u.get("cache_read_input_tokens", 0), u.get("output_tokens", 0))
                    for blk in blocks:
                        if blk.get("type") == "text" and (blk.get("text") or "").strip():
                            c["say"] = " ".join(redact(blk["text"]).split())[:160]  # 마스킹 → 절단
                        elif blk.get("type") == "tool_use":
                            c["pending"][blk.get("id")] = (blk.get("name", ""), ts)
                else:
                    for blk in blocks:
                        if blk.get("type") == "tool_result":
                            c["pending"].pop(blk.get("tool_use_id"), None)
    except OSError:
        pass
    return c


def usage_of(path):
    return scan(path)["msgs"]


def health(c, last_event, now):
    """조용한 시간으로 느림/멈춤 의심 판단. None이면 정상."""
    if c["pending"]:
        name, since = min(c["pending"].values(), key=lambda p: p[1])
        run = now - since
        if run >= TOOL_SLOW:
            return {"level": "stall" if run >= TOOL_STALL else "slow", "tool": name, "secs": run}
        return None
    quiet = now - max(c["last_ts"], last_event)
    if quiet >= SLOW:
        return {"level": "stall" if quiet >= STALL else "slow", "tool": None, "secs": quiet}
    return None


def transcript(sid):
    if sid not in _paths:
        hits = glob.glob(os.path.join(PROJECTS, "*", sid + ".jsonl"))
        if not hits:
            return None
        _paths[sid] = hits[0]
    return _paths[sid]


def tok_sum(msgs, since=0):
    t = [0, 0, 0]
    for ts, new, cached, out in msgs:
        if ts >= since:
            t[0] += new; t[1] += cached; t[2] += out
    return {"new": t[0], "cached": t[1], "out": t[2], "total": t[0] + t[2]}


def add_tokens(s, day_start, today_msgs, now):
    path = transcript(s["sid"])
    if not path:
        return
    main = scan(path)
    msgs = list(main["msgs"].values())
    if s["status"] == "working":
        s["say"] = main["say"]
        s["health"] = health(main, s["last"], now)
    sub_dir = path[:-len(".jsonl")]
    for a in s["agents"].values():
        sub = os.path.join(sub_dir, "subagents", "agent-%s.jsonl" % a["aid"])
        c = scan(sub)
        am = list(c["msgs"].values())
        a["tokens"] = tok_sum(am)["total"]
        a["say"] = c["say"]
        # 트랜스크립트가 없으면 조용한 시간을 잴 근거가 없으므로 멈춤 판정 생략
        if a["status"] == "running" and os.path.exists(sub):
            a["health"] = health(c, a["last"], now)
        msgs += am
    s["tokens"] = tok_sum(msgs, s.get("prompt_ts") or 0)
    today_msgs.extend(m for m in msgs if m[0] >= day_start)


# ---------- /trace: 🌊 흐름 모드 전용. 그 모드가 켜져 있을 때만 호출되므로 다른 모드에선 비용 0 ----------
SID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
AID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TRACE_MAX = 600    # 응답 하나에 담는 단계 수 상한. 넘으면 오래된 단계는 레인·분 단위로 요약
TRACE_FILES = 48   # 캐시하는 트랜스크립트 수 상한 (오래 안 본 것부터 버림)
TEXT_MAX = 160
_tr, _tr_meta = {}, {}
_tr_lock = threading.Lock()
_tr_v = [0]    # 단계가 생기거나 바뀔 때마다 오르는 번호 → 증분 커서
_tr_gen = [1]  # 캐시를 버리고 다시 읽으면 오름 → 클라이언트는 전체를 다시 받음
HOME = os.path.expanduser("~")

# 민감 정보 마스킹 (프로젝트 보안 정책): 토큰 패턴 + key=value 형태의 비밀 값
# re.ASCII: 한글 바로 뒤에 붙은 시크릿도 잡도록 \b·\w를 ASCII 기준으로 (Rust redact.rs의 (?-u)와 동일)
SECRET = re.compile(r"sk-ant-[\w-]+|\bgh[pousr]_\w{8,}|\bgithub_pat_\w+|\bAKIA[0-9A-Z]{12,}|\bxox[bpasr]-[\w-]+"
                    r"|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*", re.A)
BEARER = re.compile(r"\b(Bearer|Basic)\s+[\w.~+/=-]{8,}", re.I | re.A)
SECRET_KV = re.compile(r"""((?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key"""
                       r"""|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?)([^\s"'&,;)}\]]+)""", re.I)
SCRATCH_RE = re.compile(r"/private/tmp/claude-\d+/[^/\s]+/[^/\s]+/scratchpad/")
TYPE_RE = re.compile(rb'"type": ?"(assistant|user)"')
FILE_RE = re.compile(r"[\w./~$-]*\w\.(?:py|html?|js|mjs|cjs|ts|tsx|jsx|css|scss|md|json|jsonl|png|jpe?g|svg|sh|ya?ml"
                     r"|toml|txt|swift|go|rs|java|kt|sql|rb|php|c|h|cpp|vue|svelte)\b")
WRITES_RE = re.compile(r"sed -i|\.write(_text)?\(|open\([^)]*['\"][wa]|>>?\s*[\w./~-]+\.\w+|\btee\b|\b(cp|mv|rm|mkdir|touch)\s")
VERIFY_RE = re.compile(r"(?i)screenshot|verify|test|confirm|check|measure|captur|lint|확인|검증|테스트|스크린샷|점검")
PLAN_RE = re.compile(r"(?i)\bplan\b|계획|방식|맡길|나눠|I'll|I will|할게요|하겠습니다|\bnext\b|now i|let me|first,|순서")
DONE_RE = re.compile(r"(?i)완성|만들었|완료|done|finished|works|all set|됐어요|되었습니다")
CLAIMS = (("conclusion", r"(?i)원인|because|correctly|works|정상|완성|만들었|완료|확인했|됐어요|turns out|found"),
          ("hypothesis", r"(?i)것 같|아마|probably|likely|might|seems|suspect|의심|일 수|maybe"),
          ("decision", r"(?i)그래서|so i|i'll|i will|할게요|plan|방식|대신|instead|now i|next|하겠습니다"),
          ("check", r"(?i)확인|check|verify|confirm|살펴|let me|look at|볼게"))


def redact(s):
    s = SECRET.sub("<REDACTED>", s)
    s = BEARER.sub(lambda m: m.group(1) + " <REDACTED>", s)
    return SECRET_KV.sub(lambda m: m.group(1) + "<REDACTED>", s)


def clip(s, n=TEXT_MAX, cwd=""):
    """마스킹 → 경로 줄임 → 공백 정리 → n자 절단 (마스킹을 먼저 해야 잘린 비밀 조각이 새지 않음)"""
    s = redact(str(s or ""))
    s = SCRATCH_RE.sub("scratch/", s)
    if cwd and len(cwd) > 1:
        s = s.replace(cwd.rstrip("/") + "/", "")
    s = " ".join(s.replace(HOME, "~").split())
    return s[:n - 1] + "…" if len(s) > n else s


def _mask(v):
    return redact(v) if isinstance(v, str) and v else v


def mask_state(sessions):
    """/state의 자유 텍스트(프롬프트·발화·도구 설명/명령·알림·할 일·에이전트 설명)를 /trace와 같은 redact()로 마스킹.
    필드·형식·길이 규칙은 그대로 두고 값만 바꾼다(redact는 여러 번 적용해도 결과가 같음)."""
    for s in sessions:
        for k in ("prompt", "note", "say"):
            if k in s:
                s[k] = _mask(s[k])
        for a in s["activity"]:
            a["text"] = _mask(a.get("text"))
        s["trail"] = [[k, icon, _mask(t)] for k, icon, t in s["trail"]]
        for t in s["todos"]:
            if isinstance(t, dict):
                t["text"] = _mask(t.get("text"))
        for a in s["agents"]:
            for k in ("desc", "say"):
                if k in a:
                    a[k] = _mask(a[k])
            for x in ([a["now"]] if a.get("now") else []) + a["recent"]:
                x["text"] = _mask(x.get("text"))


def _newv():
    _tr_v[0] += 1
    return _tr_v[0]


def _text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _tool_step(name, inp, cwd):
    """tool_use 하나 → 대상·파일·쓰기 여부·행동 종류"""
    inp = inp if isinstance(inp, dict) else {}
    st = {"kind": "tool", "tool": clip(name, 40)}
    files, writes, act = [], False, "other"
    if name in ("Read", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        f = inp.get("file_path") or inp.get("notebook_path") or ""
        st["target"] = clip(f, 100, cwd)
        files = [clip(f, 200, cwd)] if f else []
        writes = name != "Read"
        act = "edit" if writes else "read"
    elif name == "Bash":
        cmd = inp.get("command") or ""
        st["target"] = clip(inp.get("description") or cmd, 100, cwd)
        st["cmd"] = clip(cmd, 100, cwd)
        files = sorted({clip(x, 200, cwd) for x in FILE_RE.findall(cmd) if "Chrome" not in x})[:6]
        writes = bool(WRITES_RE.search(cmd))
        act = "edit" if writes else "run"
    elif name in ("Grep", "Glob"):
        st["target"] = clip(inp.get("pattern") or "", 80, cwd)
        if inp.get("path"):
            files = [clip(inp["path"], 100, cwd)]
        act = "search"
    elif name in ("Agent", "Task"):
        st["target"] = clip(inp.get("description") or "", 80, cwd)
        st["atype"] = clip(inp.get("subagent_type") or "general-purpose", 40)
        act = "agent"
    elif name in ("WebFetch", "WebSearch"):
        st["target"] = clip(inp.get("url") or inp.get("query") or "", 80, cwd)
        act = "web"
    elif name == "Skill":
        st["target"] = clip(inp.get("skill") or "", 60)
    elif name in ("TodoWrite", "TaskCreate", "TaskUpdate"):
        st["target"] = "할 일 정리"
        act = "plan"
    else:
        st["target"] = clip(inp.get("description") or inp.get("file_path") or name, 80, cwd)
    st.update(files=files, writes=writes, act=act)
    return st


def tr_scan(path, main):
    """트랜스크립트를 이어 읽어 단계(발화·속생각·도구·알림)와 요청 경계를 모은다. 새로 붙은 줄만 읽음."""
    c = _tr.get(path)
    try:
        size = os.path.getsize(path)
    except OSError:
        return c
    if c is None or size < c["off"]:
        if c is not None:
            _tr_gen[0] += 1
        c = _tr[path] = {"off": 0, "steps": [], "pend": {}, "prompts": [], "stop": None, "last": 0,
                         "cwd": "", "task": "", "handback": None}
    c["used"] = time.time()
    if size == c["off"]:
        return c
    steps = c["steps"]

    def add(ts, **kw):
        st = {"s": len(steps), "t": ts, "v": _newv(), **kw}
        steps.append(st)
        return st
    try:
        with open(path, "rb") as f:
            f.seek(c["off"])
            for raw in f:
                if not raw.endswith(b"\n"):
                    break
                c["off"] += len(raw)
                if not TYPE_RE.search(raw[:4000]) and not TYPE_RE.search(raw[-4000:]):
                    continue
                try:
                    d = json.loads(raw)
                    kind = d.get("type")
                    if kind not in ("assistant", "user"):
                        continue
                    ts = iso(d["timestamp"])
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
                if not c["cwd"] and d.get("cwd"):
                    c["cwd"] = d["cwd"]
                cwd = c["cwd"]
                c["last"] = max(c["last"], ts)
                m = d.get("message") or {}
                content = m.get("content")
                if kind == "assistant":
                    if m.get("stop_reason"):
                        c["stop"] = (ts, m["stop_reason"])
                    think_ms = d.get("thinkingDurationMs") or 0
                    for blk in content if isinstance(content, list) else []:
                        if not isinstance(blk, dict):
                            continue
                        bt = blk.get("type")
                        if bt == "thinking":
                            txt = (blk.get("thinking") or "").strip()
                            if txt or think_ms >= 20000:
                                add(ts, kind="think", text=clip(txt, cwd=cwd), dur_ms=int(think_ms))
                                think_ms = 0
                        elif bt == "text" and (blk.get("text") or "").strip():
                            add(ts, kind="say", text=clip(blk["text"], cwd=cwd))
                        elif bt == "tool_use":
                            st = add(ts, **_tool_step(blk.get("name", ""), blk.get("input"), cwd))
                            st["ok"] = None
                            st["tu"] = blk.get("id")
                            c["pend"][blk.get("id")] = st
                            if st["tool"] == "SubagentHandback":
                                c["handback"] = ts
                    continue
                # user
                if d.get("isMeta") or d.get("isSidechain") and main:
                    continue
                blocks = content if isinstance(content, list) else []
                for blk in blocks:
                    if isinstance(blk, dict) and blk.get("type") == "tool_result":
                        st = c["pend"].pop(blk.get("tool_use_id"), None)
                        if not st:
                            continue
                        st["ok"] = not blk.get("is_error", False)
                        st["dur_ms"] = int(max(0, ts - st["t"]) * 1000)
                        res = _text_of(blk.get("content"))
                        if not st["ok"]:
                            st["err"] = clip(res, 120, cwd)
                        if st.get("act") == "agent" and not st.get("aid"):
                            am = re.search(r"agentId: ([A-Za-z0-9_-]+)", res)
                            if am:
                                st["aid"] = am.group(1)
                        st["v"] = _newv()
                if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks):
                    continue
                text = _text_of(content).strip()
                if not text:
                    continue
                if not main:
                    c["task"] = c["task"] or clip(text, 120, cwd)
                    continue
                if text.startswith("<task-notification>"):
                    sm = re.search(r"<summary>(.*?)</summary>", text, re.S)
                    tm = re.search(r"<task-id>([\w-]+)</task-id>", text)
                    add(ts, kind="notify", text=clip(sm.group(1) if sm else "에이전트 소식", 120, cwd),
                        aid=tm.group(1) if tm else None)
                elif text.startswith("<command-name>"):
                    nm = re.search(r"<command-name>(.*?)</command-name>", text)
                    ar = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
                    c["prompts"].append({"t": ts, "at": len(steps), "text": clip(
                        (nm.group(1) if nm else "/?") + " " + (ar.group(1) if ar else ""), cwd=cwd)})
                elif not text.startswith("<"):
                    c["prompts"].append({"t": ts, "at": len(steps), "text": clip(text, 400, cwd)})
    except OSError:
        pass
    return c


def _phase(st, seen_edit):
    k = st["kind"]
    if k == "say":
        t = st.get("text", "")
        return "plan" if PLAN_RE.search(t) and not DONE_RE.search(t) else None
    if k != "tool":
        return None
    n, tg, act = st["tool"], st.get("target", ""), st.get("act")
    if act == "edit":
        return "edit"
    if act == "agent":
        return "delegate"
    if act == "plan":
        return "plan"
    if n in ("SubagentHandback", "SendUserFile", "SendMessage"):
        return "report"
    if (n == "Read" and re.search(r"\.(png|jpe?g)$", tg)) or VERIFY_RE.search(tg):
        return "verify"
    return "explore" if seen_edit else "understand"


FIXED = ("edit", "delegate", "plan", "report")  # 근거가 확실한 단계는 보정하지 않음 (읽기·실행의 이해/탐색/검증만 다수결)


def tr_phases(steps):
    """단계 판정 + 앞뒤 5단계(±2) 다수결 보정 + 한 단계짜리 튐 제거. 바뀐 단계는 버전을 올림."""
    seen, raw = False, []
    for st in steps:
        p = _phase(st, seen)
        seen = seen or p == "edit"
        raw.append(p)
    tools = [i for i, st in enumerate(steps) if st["kind"] == "tool"]
    tp = [raw[i] for i in tools]
    sm = list(tp)
    for j, p in enumerate(tp):
        if p in FIXED:
            continue
        cnt = {}
        for k in range(max(0, j - 2), min(len(tp), j + 3)):
            if tp[k] not in ("plan", "report", "delegate"):
                cnt[tp[k]] = cnt.get(tp[k], 0) + 1 + (0.5 if k == j else 0)
        if cnt:
            sm[j] = max(cnt.items(), key=lambda x: x[1])[0]
    # 한 단계짜리 구간은 앞 구간에 흡수 (위임·계획은 그대로)
    for j in range(1, len(sm) - 1):
        if sm[j] != sm[j - 1] and sm[j] != sm[j + 1] and sm[j] not in FIXED and sm[j - 1] not in FIXED:
            sm[j] = sm[j - 1]
    final = list(raw)
    for j, i in enumerate(tools):
        final[i] = sm[j]
    prev = "understand"
    for i, st in enumerate(steps):
        p = final[i] or prev
        if st["kind"] in ("say", "think") and st.get("text"):
            t = st["text"]
            st["claim"] = next((k for k, r in CLAIMS if re.search(r, t)), "note")
        if st.get("phase") != p:
            st["phase"] = p
            st["v"] = _newv()
        prev = p if st["kind"] == "tool" or final[i] else prev


def _agent_meta(sub_dir):
    """subagents/*.meta.json → toolUseId·aid별 메타 (새 파일만 읽고, 아직 안 끝난 에이전트는 매번 다시 읽음)"""
    mm = _tr_meta.setdefault(sub_dir, {"seen": set(), "by_tool": {}, "by_aid": {}})
    try:
        names = os.listdir(sub_dir)
    except OSError:
        return mm
    for nm in names:
        if not (nm.startswith("agent-") and nm.endswith(".meta.json")):
            continue
        aid = nm[6:-10]
        old = mm["by_aid"].get(aid)
        if nm in mm["seen"] and (old or {}).get("finished"):
            continue
        try:
            with open(os.path.join(sub_dir, nm), encoding="utf-8") as f:
                j = json.load(f)
        except (OSError, ValueError):
            continue
        mm["seen"].add(nm)
        mm["by_aid"][aid] = j
        if j.get("toolUseId"):
            mm["by_tool"][j["toolUseId"]] = aid
    return mm


def _pub(st, lane):
    o = {k: v for k, v in st.items()
         if k not in ("v", "tu") and v is not None and v != [] and v != "" and (v is not False or k == "ok")}
    o["lane"] = lane
    return o


def build_trace(sid, which="last", since=""):
    if not sid or not SID_RE.match(sid):
        return {"error": "bad-session"}
    path = transcript(sid)
    if not path or not os.path.exists(path):
        return {"session": sid, "error": "no-transcript"}
    with _tr_lock:
        c = tr_scan(path, True)
        steps, cwd = c["steps"], c["cwd"]
        prompts = c["prompts"] or [{"t": steps[0]["t"] if steps else c["last"], "at": 0, "text": ""}]
        n = len(prompts)
        try:
            pi = n - 1 if which in ("", "last", None) else max(0, min(n - 1, int(which)))
        except ValueError:
            pi = n - 1
        p = prompts[pi]
        hi = prompts[pi + 1]["at"] if pi + 1 < n else len(steps)
        main = steps[p["at"]:hi]
        tr_phases(main)
        sub_dir = os.path.join(path[:-len(".jsonl")], "subagents")
        meta = None
        lanes = []
        lane_steps = [("main", main)]
        notified = {st.get("aid"): st["t"] for st in main if st["kind"] == "notify" and st.get("aid")}
        for st in main:
            if st.get("act") != "agent":
                continue
            if meta is None:
                meta = _agent_meta(sub_dir)
            aid = st.get("aid") or meta["by_tool"].get(st.get("tu"))
            if aid and not st.get("aid"):
                st["aid"] = aid
            if not aid or not AID_RE.match(aid):
                continue
            j = meta["by_aid"].get(aid, {})
            ap = os.path.join(sub_dir, "agent-%s.jsonl" % aid)
            ac = tr_scan(ap, False) if os.path.exists(ap) else None
            ast = ac["steps"] if ac else []
            tr_phases(ast)
            t_end = max([st["t"]] + [x["t"] for x in ast[-1:]] + ([ac["last"]] if ac else []))
            done = (j.get("finished") or aid in notified or (ac and ac["handback"])
                    or (ac and not ac["pend"] and ac["stop"] and ac["stop"][1] == "end_turn"
                        and time.time() - ac["last"] > 30))
            lanes.append({"id": aid, "desc": clip(j.get("description") or st.get("target") or (ac or {}).get("task", ""), 80, cwd),
                          "type": clip(j.get("agentType") or st.get("atype") or "agent", 40),
                          "from": st["s"], "t_start": st["t"], "t_end": t_end,
                          "t_join": notified.get(aid) or (ac and ac["handback"]) or None,
                          "status": "done" if done else ("running" if ac else "unknown"),
                          "fail": sum(1 for x in ast if x.get("ok") is False)})
            lane_steps.append((aid, ast))
        last_prompt = pi == n - 1
        stop = c["stop"]
        running_agents = any(l["status"] == "running" for l in lanes)
        if not last_prompt:
            mstat = "done"
        elif c["pend"] or not stop or stop[1] != "end_turn" or (main and stop[0] < main[-1]["t"]):
            mstat = "running"
        else:
            mstat = "waiting" if running_agents else "done"
        t_end = max([p["t"]] + [x["t"] for x in main[-1:]] + ([stop[0]] if stop and stop[0] >= p["t"] and (last_prompt or stop[0] < prompts[pi + 1]["t"]) else []))
        lanes.insert(0, {"id": "main", "desc": "메인 Claude", "type": "main", "t_start": p["t"], "t_end": t_end,
                         "status": mstat, "fail": sum(1 for x in main if x.get("ok") is False)})
        # 크기 제한: 가장 최근 TRACE_MAX 단계만 그대로, 그 앞은 레인·분 단위 요약
        allst = sorted(((x["t"], lane, x) for lane, ss in lane_steps for x in ss), key=lambda z: z[0])
        cut, bins = None, {}
        if len(allst) > TRACE_MAX:
            cut = allst[-TRACE_MAX][0]
            for t, lane, x in allst[:-TRACE_MAX]:
                b = bins.setdefault((lane, int(t // 60) * 60), {"lane": lane, "t": int(t // 60) * 60, "n": 0, "fail": 0, "ph": {}})
                b["n"] += 1
                b["fail"] += x.get("ok") is False
                if x["kind"] == "tool":
                    b["ph"][x.get("phase")] = b["ph"].get(x.get("phase"), 0) + 1
            allst = allst[-TRACE_MAX:]
        older = None
        if cut is not None:
            older = {"cut": cut, "bins": [{"lane": b["lane"], "t": b["t"], "n": b["n"], "fail": b["fail"],
                                           "phase": max(b["ph"].items(), key=lambda z: z[1])[0] if b["ph"] else "understand"}
                                          for b in list(bins.values())[-600:]]}
        key = "%d.%d" % (_tr_gen[0], pi)
        sv = 0
        if since and since.rsplit(".", 1)[0] == key:
            try:
                sv = int(since.rsplit(".", 1)[1])
            except ValueError:
                sv = 0
        out_steps = [_pub(x, lane) for t, lane, x in allst if x["v"] > sv]
        return {"session": sid, "project": os.path.basename(cwd.rstrip("/")) or "?", "now": time.time(),
                "prompts": [{"i": i, "t": q["t"], "text": q["text"][:80]} for i, q in enumerate(prompts)][-30:],
                "prompt": {"i": pi, "t": p["t"], "text": p["text"], "last": last_prompt, "t_next": prompts[pi + 1]["t"] if pi + 1 < n else None},
                "cursor": "%s.%d" % (key, _tr_v[0]), "full": sv == 0, "lanes": lanes, "steps": out_steps, "older": older,
                "total": sum(len(ss) for _, ss in lane_steps)}
    # (락 밖) 캐시 정리는 다음 호출에서


def trace_gc():
    if len(_tr) > TRACE_FILES:
        for pth, _ in sorted(_tr.items(), key=lambda kv: kv[1].get("used", 0))[:len(_tr) - TRACE_FILES]:
            _tr.pop(pth, None)


# ---------- MCP 보고: wr-hook mcp 사이드카가 쓰는 reports.jsonl (Rust wr-core providers/mcp.rs와 같은 규칙) ----------
# WAITING_ROOM_REPORTS=off면 읽지도 내보내지도 않는다. 회전은 Rust 리더(앱)만 한다(여기는 크기 감소·inode 변경 시 처음부터).
REPORTS_ON = os.environ.get("WAITING_ROOM_REPORTS") != "off"
# 경로 순서는 Rust McpConfig와 같음: WAITING_ROOM_REPORTS > $CLAUDE_CONFIG_DIR/waiting-room > ~/.claude/waiting-room
REPORTS = os.path.expanduser(os.environ.get("WAITING_ROOM_REPORTS") or os.path.join(
    os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude", "waiting-room", "reports.jsonl"))
GUESS_AFTER = 1800   # 이만큼 보고 없는 working은 추정(guess)
ATTACH_WINDOW = 600  # 사이드카 보고를 Claude 세션에 붙일 때 "활성"으로 보는 시간
CWD_MAX = 400
FEED_MAX = 200       # 일지·오늘 집계용으로 기억하는 MCP 턴·대기 수 (세션 키가 STALE로 지워져도 오늘 집계는 남게)
# turns/waits: 일지로 넘길 MCP 세션 전이 [{key, prov, cwd, prompt, start, end, big, cheer}] · [{key, prov, cwd, t0, t1}]
_rep = {"off": 0, "ino": None, "keys": {}, "last": None, "turns": [], "waits": []}


def _rep_push(lst, rec, same):
    """같은 전이를 두 번 넣지 않는다(파일을 처음부터 다시 읽는 경우). 오래된 것부터 버림"""
    if not any(same(o) for o in lst):
        lst.append(rec)
        del lst[:-FEED_MAX]


def _alive(pid):
    """사이드카 프로세스가 살아 있나. 확인할 수 없으면 True (Windows의 os.kill(pid, 0)은 Ctrl+C를 보내므로 쓰지 않음)"""
    if os.name == "nt" or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except (OSError, OverflowError):
        return True
    return True


def _hook_report(r):
    """훅 이벤트의 report 필드 → (도구, 다시 정화한 값) 또는 None"""
    tool = r.get("tool")
    if tool not in ("status", "board"):
        return None
    m, err = (MR.status_of if tool == "status" else MR.board_of)(r, redact)
    return None if err else (tool, m)


def _report_line(raw):
    """reports.jsonl 한 줄 반영. 모르는 v·형식이 틀린 줄은 버린다(다른 프로세스도 쓸 수 있는 파일이라 다시 정화)"""
    try:
        d = json.loads(raw)
    except ValueError:
        return
    if not isinstance(d, dict) or MR._int(d.get("v")) != MR.VERSION:
        return
    ts, typ, key = d.get("ts"), d.get("type"), d.get("key")
    if not isinstance(ts, (int, float)) or isinstance(ts, bool) or ts != ts or ts in (float("inf"), float("-inf")):
        return
    if typ not in ("hello", "status", "board", "bye") or not MR.key_ok(key):
        return
    m = None
    if typ in ("status", "board"):
        m, err = (MR.status_of if typ == "status" else MR.board_of)(d, redact)
        if err:
            return
    e = _rep["keys"].get(key)
    if e is None:
        e = _rep["keys"][key] = {"provider": "other", "cwd": "", "pid": None, "last": ts, "status": "idle", "since": ts,
                                 "started": None, "run": 0, "ended": False, "fold": MR.new_fold(), "wait0": None}
    p = d.get("provider")
    e["provider"] = p if isinstance(p, str) and p in MR.PROVIDERS else "other"
    if isinstance(d.get("cwd"), str):
        e["cwd"] = d["cwd"][:CWD_MAX]
    if MR._int(d.get("pid")) is not None:
        e["pid"] = d["pid"]
    j = MR.mux_jump(d.get("term"))
    if j:
        e["jump"] = j
    e["last"] = max(e["last"], ts)
    if typ == "status":
        # 일지: 질문 대기 = asking → 다음 보고(working·done)
        if m["state"] != "asking" and e["wait0"] is not None:
            t0 = e["wait0"]
            _rep_push(_rep["waits"], {"key": key, "prov": e["provider"], "cwd": e["cwd"], "t0": t0, "t1": ts},
                      lambda o: o["key"] == key and o["t0"] == t0 and o["t1"] == ts)
            e["wait0"] = None
        elif m["state"] == "asking" and e["wait0"] is None:
            e["wait0"] = ts
        MR.fold_status(e["fold"], m, ts)
        if m["state"] == "done":
            if e["started"] is not None:
                st0 = e["started"]
                e["run"] = ts - st0
                _rep_push(_rep["turns"], {"key": key, "prov": e["provider"], "cwd": e["cwd"], "prompt": e["fold"]["title"] or "",
                                          "start": st0, "end": ts, "big": m.get("big") is True, "cheer": m.get("cheer")},
                          lambda o: o["key"] == key and o["start"] == st0 and o["end"] == ts)
            e["started"] = None
        elif e["started"] is None:
            e["started"] = ts
        status = {"working": "working", "asking": "needs_input"}.get(m["state"], "done")
        if e["status"] != status:
            e.update(status=status, since=ts)
    elif typ == "board":
        MR.fold_board(e["fold"], m, ts)
    elif typ == "bye":
        e["ended"] = True
        e["wait0"] = None
    if m is not None:
        _rep["last"] = ts if _rep["last"] is None else max(_rep["last"], ts)


def read_reports(now):
    """reports.jsonl 증분 읽기 → (MCP 세션 목록, Claude 사이드카 보고 orphans, 마지막 보고 시각)"""
    try:
        st = os.stat(REPORTS)
    except OSError:
        st = None
        _rep.update(off=0, ino=None)
    if st is not None:
        ino = (st.st_dev, st.st_ino)
        if ino != _rep["ino"] or st.st_size < _rep["off"]:
            _rep.update(off=0, ino=ino)
        try:
            with open(REPORTS, "rb") as f:
                f.seek(_rep["off"])
                for raw in f:
                    if not raw.endswith(b"\n"):
                        break
                    _rep["off"] += len(raw)
                    _report_line(raw)
        except OSError:
            pass
    keys = _rep["keys"]
    for k in [k for k, e in keys.items() if now - e["last"] >= STALE]:
        del keys[k]
    sessions, orphans = [], []
    for key in sorted(keys):
        e = keys[key]
        if e["ended"] or is_hidden(e["cwd"]):
            continue
        if e["pid"] is not None and not _alive(e["pid"]):
            e["ended"] = True
            continue
        f = e["fold"]
        reported = f["state"] is not None or f["board"] is not None
        if e["provider"] == "claude":  # 세션을 만들지 않고 Claude 세션에 붙일 후보로만
            if reported:
                orphans.append({"key": key, "cwd": e["cwd"], "ts": f["ts"], "report": MR.report_value(f, now)})
            continue
        title = f["title"] or ""
        s = {"sid": key, "project": os.path.basename(e["cwd"].rstrip("/")) or "?", "status": e["status"],
             "since": e["since"], "started": e["started"], "prompt": title, "tools": 0, "ctx": None, "todos": [],
             "agents": [], "activity": [], "kinds": {}, "trail": [], "run": e["run"], "last": e["last"], "cwd": e["cwd"],
             "source": "mcp",
             "confidence": "guess" if e["status"] == "working" and now - e["last"] >= GUESS_AFTER else "sure"}
        if e["status"] == "needs_input":
            s["note"] = title
        if reported:
            s["report"] = MR.report_value(f, now)
        if e.get("jump"):
            s["jump"] = e["jump"]
        sessions.append(s)
    return sessions, orphans, _rep["last"]


def report_day(today):
    """MCP 세션(Claude 사이드카 제외·숨길 프로젝트 제외)의 일지 피드와 오늘 집계 → ([(provider, feed)], 오늘 완료 수, 오늘 작업 시간).
    Rust McpProvider::snapshot의 Snapshot.days·today와 같은 규칙(read_reports 뒤에 부른다)"""
    ok = lambda prov, cwd: prov != "claude" and not is_hidden(cwd)
    feeds, done, waited = {}, 0, 0.0
    fd = lambda prov: feeds.setdefault(prov, {"turns": [], "waits": [], "act": []})
    for x in _rep["turns"]:
        if not ok(x["prov"], x["cwd"]):
            continue
        fd(x["prov"])["turns"].append({"sid": x["key"], "cwd": x["cwd"], "prompt": x["prompt"], "start": x["start"],
                                       "end": x["end"], "big": x["big"], "cheer": x["cheer"]})
        if time.strftime("%Y-%m-%d", time.localtime(x["end"])) == today:
            done += 1
            waited += x["end"] - x["start"]
    for x in _rep["waits"]:
        if ok(x["prov"], x["cwd"]):
            fd(x["prov"])["waits"].append({"sid": x["key"], "t0": x["t0"], "t1": x["t1"]})
    for key in sorted(_rep["keys"]):
        e = _rep["keys"][key]
        if ok(e["provider"], e["cwd"]):
            fd(e["provider"])["act"].append({"sid": key, "cwd": e["cwd"], "last": e["last"]})
    return sorted(feeds.items()), done, waited


def attach_orphans(sessions, orphans, now):
    """Claude 사이드카 보고를 붙인다(훅이 없을 때만 부름): 최신부터, 보고가 없고 cwd가 같은 활성 세션이 정확히 하나이고
    그 세션의 마지막 프롬프트 뒤 보고일 때만 (못 붙이면 버림)"""
    hooked = [s.get("report") is not None for s in sessions]
    for o in sorted(orphans, key=lambda o: (-o["ts"], o["key"])):
        hits = [i for i, s in enumerate(sessions)
                if not hooked[i] and s.get("cwd", "") == o["cwd"] and now - s["last"] < ATTACH_WINDOW
                and o["ts"] >= (s.get("prompt_ts") or 0)]
        if len(hits) == 1 and sessions[hits[0]].get("report") is None:
            sessions[hits[0]]["report"] = o["report"]


def take_pending(s, atype):
    """Agent 도구 호출 설명 큐에서 같은 타입을 먼저 찾아 꺼낸다(타입 기록이 없는 옛 로그는 순서대로)."""
    q = s["pending_agents"]
    for i, (desc, bg, want) in enumerate(q):
        if want and want == atype:
            return q.pop(i)[:2]
    for i, (desc, bg, want) in enumerate(q):
        if not want:
            return q.pop(i)[:2]
    return q.pop(0)[:2] if q else ("", False)


def track_agent(s, e):
    a = s["agents"].get(e["aid"])
    if a is None:
        # SubagentStart 없이 타입도 없이 나타나는 aid는 Claude Code 내부 보조 에이전트
        # (턴 종료 직후 SubagentStop만 오거나 PreToolUse 하나만 남음, 트랜스크립트 없음) → 무시
        if e["event"] != "SubagentStart" and not e.get("atype"):
            return
        desc, bg = take_pending(s, e.get("atype")) if e["event"] == "SubagentStart" else ("", False)
        a = s["agents"][e["aid"]] = {
            "aid": e["aid"], "type": e.get("atype") or "agent", "desc": desc, "bg": bg,
            "status": "running", "since": e["ts"], "tools": 0, "now": None, "recent": [], "last": e["ts"],
        }
    a["last"] = e["ts"]
    if e["event"] == "PreToolUse":
        a["tools"] += 1
        a["now"] = {"icon": e.get("icon", "🔧"), "text": e.get("text", ""), "kind": e.get("kind", "other")}
        a["recent"] = (a["recent"] + [a["now"]])[-3:]
    elif e["event"] == "SubagentStop":
        a.update(status="done", ended=e["ts"])


def close_agents(s, ts):
    """세션이 끝나면 SubagentStop이 누락된 에이전트도 끝난 것으로 정리.
    (메인 Stop 시점 정리는 안 함: Agent 도구는 run_in_background 없이도 백그라운드로 돌 수 있어 bg 값을 믿을 수 없음)"""
    for a in s["agents"].values():
        if a["status"] == "running":
            a.update(status="done", ended=ts)


def expire_agents(s, now):
    """Stop이 누락돼 running으로 남은 에이전트 정리: 마지막 활동(훅 last와 트랜스크립트 마지막 기록 중 늦은 것)이
    STALE보다 오래됐으면 끝난 것으로 본다(status done + stale). 멈춤 판정·running 집계에서 빠지고 토큰은 그대로."""
    old = [a for a in s["agents"].values() if a["status"] == "running" and now - a["last"] >= STALE]
    if not old:
        return
    path = transcript(s["sid"])
    for a in old:
        last = a["last"]
        if path:
            sub = os.path.join(path[:-len(".jsonl")], "subagents", "agent-%s.jsonl" % a["aid"])
            if os.path.exists(sub):
                last = max(last, scan(sub)["last_ts"])
        if now - last >= STALE:
            a.update(status="done", ended=last, stale=True)
            a.pop("health", None)


def build_state():
    sessions = {}
    today = time.strftime("%Y-%m-%d")
    waited_today = 0.0
    done_today = 0
    today_kinds, today_agents = {}, 0
    # 일지(daylog.py)로 넘길 전이: 턴 완료, 질문 대기(진행 중 턴의 Notification → 다음 진행), 세션 활동
    day_turns, day_waits, wait0 = [], [], {}
    last_report = None  # 마지막 MCP 보고 시각 (훅 report 이벤트 + reports.jsonl)
    hooks_active = False  # 훅 이벤트가 있으면 Claude 사이드카 보고(orphans)는 버린다 (Rust Snapshot.hooks_active)
    try:
        with open(LOG, encoding="utf-8") as f:
            lines = f.readlines()[-5000:]
    except FileNotFoundError:
        lines = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if is_hidden(e.get("cwd")):
            continue  # 숨길 프로젝트(플러그인 내부 세션)의 이벤트는 집계에도 넣지 않음
        hooks_active = True
        s = sessions.setdefault(e["sid"], {
            "sid": e["sid"], "status": "idle", "since": e["ts"], "started": None,
            "activity": [], "tools": 0, "last": e["ts"], "prompt": "",
            "todos": [], "agents": {}, "pending_agents": [], "kinds": {}, "trail": [], "run": 0,
        })
        s["cwd"] = e.get("cwd") or s.get("cwd", "")
        j = MR.mux_jump(e.get("term"))  # 멀티플렉서 이동 정보: 마지막으로 받은 올바른 값 (서브에이전트 이벤트도 같은 셸)
        if j:
            s["jump"] = j
        s["last"] = e["ts"]
        ev = e["event"]
        # MCP 보고(wr-hook이 mcp__waitscape__* 호출에서 기록): 도구 호출로 세지 않고 세션 report로 접는다
        rep = e["report"] if ev == "PreToolUse" and isinstance(e.get("report"), dict) else None
        rm = _hook_report(rep) if rep is not None else None
        if rm:
            last_report = e["ts"] if last_report is None else max(last_report, e["ts"])
        if time.strftime("%Y-%m-%d", time.localtime(e["ts"])) == today:
            if ev == "PreToolUse" and rep is None:
                k = e.get("kind", "other")
                today_kinds[k] = today_kinds.get(k, 0) + 1
            elif ev == "SubagentStart":
                today_agents += 1
        if e.get("aid"):
            if rep is None:  # 서브에이전트의 MCP 보고는 메인 보드를 덮지 않게 버린다
                track_agent(s, e)
            continue
        if e.get("todos") is not None:
            s["todos"] = e["todos"]
        if e.get("task_new"):
            s["todos"].append({"id": e["task_new"]["id"] or str(len(s["todos"]) + 1),
                               "text": e["task_new"]["text"], "status": "pending"})
        if e.get("task_upd"):
            u = e["task_upd"]
            for t in s["todos"]:
                if t.get("id") == u["id"]:
                    if u["status"]:
                        t["status"] = u["status"]
                    if u["text"] and u["status"] == "in_progress":
                        t["text"] = u["text"]
            s["todos"] = [t for t in s["todos"] if t["status"] != "deleted"]
        if e.get("agent_desc"):
            s["pending_agents"].append((e["agent_desc"], e.get("bg", False), e.get("agent_req", "")))
        if ev == "PostToolUse":
            continue
        if ev == "Notification":
            if s["status"] == "working" and s["started"]:
                wait0.setdefault(e["sid"], e["ts"])
        elif ev in ("UserPromptSubmit", "Resume", "PreToolUse", "Stop"):
            if e["sid"] in wait0:
                day_waits.append({"sid": e["sid"], "t0": wait0.pop(e["sid"]), "t1": e["ts"]})
        elif ev == "SessionEnd":
            wait0.pop(e["sid"], None)
        if ev == "UserPromptSubmit":
            if s["todos"] and all(t["status"] == "completed" for t in s["todos"]):
                s["todos"] = []
            s["agents"] = {k: a for k, a in s["agents"].items() if a["status"] == "running"}
            s.pop("fold", None)
            s["prompt_ts"] = e["ts"]
            s.update(status="working", since=e["ts"], started=e["ts"], tools=0,
                     prompt=e.get("text", ""), activity=[], kind="think", kinds={}, trail=[])
        elif ev == "Resume":
            if s["status"] != "working":
                s.update(status="working", since=e["ts"], started=s["started"] or e["ts"])
        elif ev == "PreToolUse":
            if s["status"] != "working":
                s.update(status="working", since=e["ts"])
            if rep is not None:
                if rm:
                    (MR.fold_status if rm[0] == "status" else MR.fold_board)(s.setdefault("fold", MR.new_fold()), rm[1], e["ts"])
                continue
            s["tools"] += 1
            s["kind"] = k = e.get("kind", "other")
            s["kinds"][k] = s["kinds"].get(k, 0) + 1
            s["trail"] = (s["trail"] + [[k, e.get("icon", "🔧"), e.get("text", "")]])[-300:]
            s["activity"] = (s["activity"] + [{"ts": e["ts"], "icon": e.get("icon", "🔧"),
                                               "text": e.get("text", "")}])[-6:]
        elif ev == "Notification":
            s.update(status="needs_input", since=e["ts"], note=e.get("text", ""))
        elif ev == "Stop":
            if s["started"]:
                s["run"] = e["ts"] - s["started"]
                # 이번 턴에 AI가 MCP로 "끝(done)"을 보고했으면 큰 일 표시·칭찬 한마디도 일지에 (보고 읽기가 켜졌을 때만)
                f = s.get("fold") if REPORTS_ON else None
                fin = f is not None and f["state"] == "done"
                day_turns.append({"sid": e["sid"], "cwd": s.get("cwd", ""), "prompt": s["prompt"],
                                  "start": s["started"], "end": e["ts"],
                                  "big": fin and f["big"] is not None, "cheer": f["cheer"] if fin else None})
            if s["started"] and time.strftime("%Y-%m-%d", time.localtime(e["ts"])) == today:
                waited_today += e["ts"] - s["started"]
                done_today += 1
            s.update(status="done", since=e["ts"], started=None)
        elif ev == "SessionEnd":
            s["status"] = "ended"
            close_agents(s, e["ts"])
    now = time.time()
    day_start = time.mktime(time.strptime(today, "%Y-%m-%d"))
    today_msgs = []
    for s in sessions.values():
        if s["last"] >= day_start:
            add_tokens(s, day_start, today_msgs, now)
    alive = [s for s in sessions.values()
             if s["status"] != "ended" and now - s["last"] < STALE and not is_hidden(s.get("cwd", ""))]
    for s in alive:
        expire_agents(s, now)
        s["project"] = os.path.basename(s.get("cwd", "").rstrip("/")) or "?"
        s["agents"] = sorted(s["agents"].values(), key=lambda a: a["since"])
        del s["pending_agents"]
        f = s.pop("fold", None)
        if f and REPORTS_ON:
            s["report"] = MR.report_value(f, now)
        # 메인은 멈췄지만 백그라운드 에이전트가 아직 일하는 경우
        if s["status"] in ("done", "idle") and any(a["status"] == "running" for a in s["agents"]):
            s["status"] = "agents"
    alive.sort(key=lambda s: s["sid"])
    try:
        with open(STATUS, encoding="utf-8") as f:
            sl = json.load(f)
    except (OSError, ValueError):
        sl = {}
    for s in alive:
        s["ctx"] = (sl.get("sessions", {}).get(s["sid"]) or {}).get("ctx")
    mcp_feeds = []
    if REPORTS_ON:
        mcp_sessions, orphans, rts = read_reports(now)
        if not hooks_active:
            attach_orphans(alive, orphans, now)
        alive = sorted(alive + mcp_sessions, key=lambda s: s["sid"])
        if rts is not None:
            last_report = rts if last_report is None else max(last_report, rts)
        mcp_feeds, mdone, mwait = report_day(today)   # MCP 세션의 끝난 일도 오늘 집계·일지에
        done_today += mdone
        waited_today += mwait
    mask_state(alive)
    _sl_memo["limits"] = merge_limits(_sl_memo["limits"], sl.get("limits"), now)
    sl_limits = _sl_memo["limits"]
    st = {"now": now, "sessions": alive, "waited_today": waited_today, "done_today": done_today,
          "today_kinds": today_kinds, "today_agents": today_agents,
          "today_tokens": tok_sum(today_msgs),
          # statusline 값과 직접 조회 값 중 더 최근 것 (내용은 창별 최댓값으로 합침: 오래된 값·지난 창이 섞이지 않게)
          **({"limits": merge_limits(sl_limits, _polled["limits"], now), "limits_ts": _polled["ts"], "limits_src": "poll"}
             if _polled["limits"] and _polled["ts"] > (sl.get("limits_ts") or 0)
             else {"limits": sl_limits, "limits_ts": sl.get("limits_ts"), "limits_src": "statusline"}),
          "poll": {"on": POLL, "err": _polled["err"]}}
    if REPORTS_ON:
        st["mcp"] = {"last_report_age": None if last_report is None else now - last_report}
    if _dl[0] is not None:
        # 숨길 프로젝트(마지막 cwd 기준)는 일지에도 넣지 않는다 (Rust: 훅 세션 retain 뒤 피드)
        keep = {sid for sid, x in sessions.items() if not is_hidden(x.get("cwd", ""))}
        feed = {"turns": [x for x in day_turns if x["sid"] in keep],
                "waits": [x for x in day_waits if x["sid"] in keep],
                "act": [{"sid": sid, "cwd": x.get("cwd", ""), "last": x["last"]} for sid, x in sessions.items() if sid in keep]}
        try:
            _dl[0].record([("claude", feed)] + mcp_feeds, st["limits"], now)
        except Exception:  # 일지 실패가 /state를 막지 않게
            pass
    return st


# 퇴근 일보용 일지. import만 한 테스트는 기록하지 않음(WAITING_ROOM_DAYLOG가 있거나 __main__일 때만 켬). "off"면 끔
_dl = [None]


def daylog_init(folder):
    _dl[0] = DayLog(folder, redact) if folder and folder not in ("off", "0") else None


daylog_init(os.environ.get("WAITING_ROOM_DAYLOG", ""))
_state_lock = threading.Lock()  # build_state 직렬화 (HTTP 스레드 + 일지 tick)


def daylog_report(which):
    """GET /daylog: 상태를 한 번 만들어 일지를 최신으로 한 뒤 집계 → (본문, 상태 코드)"""
    if _dl[0] is None:
        return {"error": "off"}, 404
    with _state_lock:
        now = build_state()["now"]
    res = _dl[0].report(which or "today", now)
    return (res, 200) if res is not None else ({"error": "bad-day"}, 400)


def daylog_seen(which):
    """POST /daylog/seen: 그날 일보를 봤다고 기록 → (본문, 상태 코드)"""
    if _dl[0] is None:
        return {"error": "off"}, 404
    res = _dl[0].mark_seen(which, time.time())
    return (res, 200) if res is not None else ({"error": "bad-day"}, 400)


def _read_manifest(path):
    """mode.json을 읽기만 한다(검증은 코어 core.js validate()가 한 곳에서). 크기 64KB 제한."""
    try:
        if os.path.islink(path) or os.path.getsize(path) > 65536:
            return None, "mode.json이 너무 크거나 링크예요"
        with open(path, encoding="utf-8") as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, "mode.json이 없어요"
    except (OSError, ValueError) as e:
        return None, "mode.json을 읽을 수 없어요 (%s)" % type(e).__name__


def list_modes():
    """내장(web/modes/index.json 순서) + 사용자 모드 폴더. 절대 경로는 응답에 넣지 않는다(홈은 ~로 축약)."""
    out = []
    try:
        with open(os.path.join(WEB, "modes", "index.json"), encoding="utf-8") as f:
            builtin = [d for d in json.load(f).get("builtin", []) if MODE_ID.match(str(d))]
    except (OSError, ValueError):
        builtin = []
    for d in builtin:
        m, err = _read_manifest(os.path.join(WEB, "modes", d, "mode.json"))
        out.append({"dir": d, "source": "builtin", "manifest": m, **({"error": err} if err else {})})
    try:
        names = sorted(os.listdir(USER_MODES))[:100]
    except OSError:
        names = []
    for d in names:
        full = os.path.join(USER_MODES, d)
        if d.startswith(".") or not os.path.isdir(full):
            continue
        if not MODE_ID.match(d) or os.path.islink(full):
            out.append({"dir": d[:40], "source": "user", "manifest": None, "error": "폴더 이름은 모드 id 형식이어야 하고 링크가 아니어야 해요"})
            continue
        m, err = _read_manifest(os.path.join(full, "mode.json"))
        out.append({"dir": d, "source": "user", "manifest": m, **({"error": err} if err else {})})
    home = os.path.expanduser("~")
    shown = "~" + USER_MODES[len(home):] if USER_MODES.startswith(home + os.sep) else USER_MODES
    return {"modes": out, "userDir": shown, "devDirs": []}


def mode_file(mid, rel):
    """사용자 모드 폴더 안의 파일만. 경로 정규화 후 폴더 밖·심볼릭 링크·허용 안 된 확장자 거부 → 실제 경로 또는 None"""
    base = os.path.realpath(os.path.join(USER_MODES, mid))
    full = os.path.realpath(os.path.join(base, rel))
    if not full.startswith(base + os.sep) or rel.rsplit(".", 1)[-1].lower() not in MODE_EXT:
        return None
    p = os.path.join(USER_MODES, mid)
    for part in rel.split("/"):  # 중간 경로까지 링크 금지
        p = os.path.join(p, part)
        if os.path.islink(p):
            return None
    return full if os.path.isfile(full) else None


def sandbox_csp(origin, mid):
    """외부 모드 iframe 응답 CSP (ARCHITECTURE.md §4.5). 네트워크·중첩 frame·폼·Worker 차단, 스크립트는 이 모드 폴더와 SDK만.
    sandbox 지시어는 주소를 탭에 직접 열어도 opaque origin이 되게 한다(메인 화면의 localStorage 접근 차단)."""
    me, sdk = "%s/_modes/%s/" % (origin, mid), "%s/_sdk/" % origin
    return ("default-src 'none'; script-src %(me)s %(sdk)s; style-src %(me)s %(sdk)s 'unsafe-inline'; img-src %(me)s data: blob:; "
            "font-src %(me)s data:; media-src %(me)s data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; "
            "worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts"
            % {"me": me, "sdk": sdk})


def sandbox_page(mid):
    """외부 모드를 싣는 iframe 문서. 인라인 스크립트 없음(CSP). SDK가 모드 코드보다 먼저 실행된다."""
    m, err = _read_manifest(os.path.join(USER_MODES, mid, "mode.json"))
    if not m:
        return None
    ok = lambda p: isinstance(p, str) and re.match(r"^(?!/)(?!.*(^|/)\.\.?(/|$))[A-Za-z0-9._/-]{1,128}$", p)
    entry = m.get("entry") or "mode.js"
    styles = [x for x in (m.get("styles") or []) if ok(x) and x.endswith(".css")][:8]
    if not ok(entry) or not entry.endswith(".js"):
        return None
    esc = lambda x: x.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    return ("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\">"
            "<link rel=\"stylesheet\" href=\"/_sdk/sandbox.css\">"
            + "".join('<link rel="stylesheet" href="%s">' % esc(x) for x in styles)
            + "<script src=\"/_sdk/core-lib.js\"></script><script src=\"/_sdk/mode-sdk.js\"></script>"
            + '<script src="%s"></script></head><body></body></html>' % esc(entry)).encode()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def host_ok(self):
        # Host가 둘 이상이면 허용 값이어도 거부 (Rust wr-server와 동일)
        hosts = self.headers.get_all("Host") or []
        if len(hosts) == 1 and hosts[0].strip().lower() in ALLOWED_HOSTS:
            return True
        self.send_error(403, "Forbidden host")
        return False

    def do_HEAD(self):
        self.do_GET(head=True)

    def send_body(self, body, ctype, head=False, cache="no-cache", csp=None, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if csp:
            self.send_header("Content-Security-Policy", csp)
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()")
            self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def send_file(self, path, head=False, csp=None):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_body(body, MIME.get(path.rsplit(".", 1)[-1].lower(), "application/octet-stream"), head, csp=csp)

    def do_GET(self, head=False):
        if not self.host_ok():
            return
        path = self.path.split("?")[0]
        if path == "/state":
            with _state_lock:
                st = build_state()
            body = json.dumps(st, ensure_ascii=False).encode()
            self.send_body(body, "application/json; charset=utf-8", head, cache="no-store")
        elif path == "/daylog":
            q = parse_qs(urlsplit(self.path).query)
            res, code = daylog_report((q.get("day") or ["today"])[0][:20])
            self.send_body(json.dumps(res, ensure_ascii=False).encode(), "application/json; charset=utf-8", head,
                           cache="no-store", code=code)
        elif path == "/trace":
            q = parse_qs(urlsplit(self.path).query)
            arg = lambda k: (q.get(k) or [""])[0][:120]
            res = build_trace(arg("session"), arg("prompt") or "last", arg("since"))
            with _tr_lock:
                trace_gc()
            body = json.dumps(res, ensure_ascii=False, separators=(",", ":")).encode()
            if res.get("error") == "bad-session":
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if not head:
                    self.wfile.write(body)
            else:
                self.send_body(body, "application/json; charset=utf-8", head, cache="no-store")
        elif path == "/modes":
            self.send_body(json.dumps(list_modes(), ensure_ascii=False).encode(), "application/json; charset=utf-8", head, cache="no-store")
        elif path in ("/", "/index.html"):
            self.send_file(os.path.join(WEB, "index.html"), head)
        elif path == "/brand.json":
            self.send_file(os.path.join(HERE, "brand.json"), head)
        elif STATIC.match(path):
            # 코어와 내장 모드 패키지 (경로는 정규식으로 제한)
            self.send_file(os.path.join(WEB, path.lstrip("/")), head)
        elif path in SDK:
            self.send_file(os.path.join(WEB, SDK[path]), head, csp=sandbox_csp("http://" + self.headers["Host"].strip().lower(), "_none"))
        elif MODE_FILE.match(path):
            mid, rel = MODE_FILE.match(path).groups()
            csp = sandbox_csp("http://" + self.headers["Host"].strip().lower(), mid)
            if rel == "index.html":
                body = sandbox_page(mid)
                if body is None:
                    self.send_error(404)
                    return
                self.send_body(body, MIME["html"], head, csp=csp)
                return
            full = mode_file(mid, rel)
            if not full:
                self.send_error(404)
                return
            self.send_file(full, head, csp=csp)
        else:
            self.send_error(404)

    def do_POST(self):
        """쓰기 엔드포인트는 POST /daylog/seen 하나. 다른 사이트가 보내지 못하게(CSRF) JSON 본문만 받고(단순 요청 불가 →
        preflight인데 OPTIONS·CORS 응답이 없음) Origin·Sec-Fetch-Site가 있으면 같은 출처인지 본다."""
        if not self.host_ok():
            return
        if self.path.split("?")[0] != "/daylog/seen":
            self.send_error(501, "Unsupported method")
            return
        host = self.headers["Host"].strip().lower()
        origins = self.headers.get_all("Origin") or []
        site = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if any(o.strip().lower() != "http://" + host for o in origins) or site not in ("", "same-origin", "none"):
            self.send_error(403, "Forbidden origin")
            return
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            self.send_error(415, "JSON only")
            return
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            n = -1
        if not 0 <= n <= 1024:
            self.send_error(413, "Body too large")
            return
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            d = None
        day = d.get("day") if isinstance(d, dict) else None
        res, code = daylog_seen(day) if isinstance(day, str) else ({"error": "bad-day"}, 400)
        self.send_body(json.dumps(res, ensure_ascii=False).encode(), "application/json; charset=utf-8", cache="no-store", code=code)

    def log_message(self, *a):
        pass


def daylog_loop():
    """화면을 열지 않아도 일지가 쌓이게 1분마다 상태를 만든다(턴 완료·한도 표본·퇴근 판정용 활동 시각)."""
    while True:
        time.sleep(60)
        try:
            with _state_lock:
                build_state()
        except Exception:
            pass


def poll_loop():
    import usage_poll
    while True:
        limits, err = usage_poll.fetch()
        if limits:
            ts = time.time()
            _polled.update(limits=merge_limits(_polled["limits"], limits, ts) or limits, ts=ts, err=None)
        else:
            _polled["err"] = err
        time.sleep(300)


if __name__ == "__main__":
    print(f"☕ 대시보드: http://localhost:{PORT}  (사용자 모드 폴더: {USER_MODES})")
    if not os.environ.get("WAITING_ROOM_DAYLOG"):   # 빈 값 = 설정 안 함 (Rust EnvSource와 같음)
        daylog_init(os.path.expanduser("~/.claude/waiting-room/daylog"))
    if _dl[0] is not None:
        print(f"📋 퇴근 일보 일지: {_dl[0].dir} (14일 보존, 끄기: WAITING_ROOM_DAYLOG=off)")
        threading.Thread(target=daylog_loop, daemon=True).start()
    if POLL:
        print("🔄 사용 한도 직접 조회: 5분마다 (api.anthropic.com)")
        threading.Thread(target=poll_loop, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

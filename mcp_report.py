"""MCP 보고(waitscape_status·waitscape_board) 입력 정화와 접기. hook.py·server.py가 쓴다.
Rust wr-core `report.rs`와 같은 규칙(공유 fixture: fixtures/mcp/sanitize.json, scripts/test_mcp_reports.py).

문자열: 제어문자(Cc) 제거(개행·탭·CR은 공백) → 형식 문자(Cf 표: 양방향·제로폭·soft hyphen 등) 제거 → NFC 정규화 → 공백 정리 → redact → 문자 수 절단(…)
NFC: NFD로 온 한글 자모·결합 악센트를 완성형으로(화면에서 자모가 흩어지지 않게, 절단·길이도 완성형 기준). Rust는 icu_normalizer(같은 결과, 공유 fixture)
redact는 인자로 받는다(server.py의 redact. hook.py는 원래 마스킹하지 않으므로 넘기지 않음 — Rust wr-hook만 마스킹 추가).

멀티플렉서 이동 정보(#37·#40, Rust `term.rs`와 같은 어댑터 표, fixture: fixtures/mux/term_cases.json): env는 표에 적힌 것
(Orca 두 개·cmux 두 개)만 읽는다. Orca 핸들은 term_ + UUID(또는 16진수 32자), 경로는 절대 경로(/…·윈도우 C:\\…·UNC \\\\server\\share…·\\\\?\\C:\\…) 1–1024자·제어 문자 없음,
cmux ID는 UUID나 짧은 참조(workspace:2)만 받는다."""
import re
import unicodedata

TITLE_MAX, CHEER_MAX, LINE_MAX, LINES_MAX, STEP_MAX = 60, 60, 32, 4, 99
STATES = ("working", "asking", "done")
VERSION = 1
BIG_FOR = 600  # 큰 일 축하를 보여 주는 시간 (done 뒤 10분)
HOOK_PREFIX = "mcp__waitscape__"
PROVIDERS = ("claude", "codex", "gemini", "other")
STATE_ERR = "state must be one of: working, asking, done"
LINES_ERR = "lines must be an array of 1-4 short strings"


# 보이지 않는 형식 문자(Cf) 표 — 마스킹 정규식 우회 방지. 유니코드 버전 차이가 없도록 Rust report.rs FORMAT과 같은 표를 쓴다
FORMAT = ((0x00AD, 0x00AD), (0x061C, 0x061C), (0x180E, 0x180E), (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x2064),
          (0x2066, 0x206F), (0xFEFF, 0xFEFF), (0xFFF9, 0xFFFB), (0xE0001, 0xE0001), (0xE0020, 0xE007F))


def _invisible(c):
    o = ord(c)
    return any(a <= o <= b for a, b in FORMAT)


def _ellipsize(s, n):
    return s if len(s) <= n else s[:n - 1] + "…"


def clean(s, n, redact=None):
    t = "".join(" " if c in "\n\t\r" else c for c in s
                if c in "\n\t\r" or (unicodedata.category(c) != "Cc" and not _invisible(c)))
    t = " ".join(unicodedata.normalize("NFC", t).split())
    if redact:
        t = redact(t)
    return _ellipsize(" ".join(t.split()), n)


def _int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _text(v, n, redact):
    if not isinstance(v, str):
        return None
    t = clean(v, n, redact)
    return t or None


def status_of(d, redact=None):
    """→ (정화한 dict, None) 또는 (None, 고칠 방법 한 줄)"""
    st = d.get("state") if isinstance(d, dict) else None
    if not isinstance(st, str) or st not in STATES:
        return None, STATE_ERR
    o = {"state": st}
    t = _text(d.get("title"), TITLE_MAX, redact)
    if t:
        o["title"] = t
    a, b = _int(d.get("step")), _int(d.get("total"))
    if a is not None and b is not None and 1 <= a <= b <= STEP_MAX:
        o["step"], o["total"] = a, b
    if st == "done":
        if d.get("big") is True:
            o["big"] = True
        c = _text(d.get("cheer"), CHEER_MAX, redact)
        if c:
            o["cheer"] = c
    return o, None


def board_of(d, redact=None):
    lines = d.get("lines") if isinstance(d, dict) else None
    if not isinstance(lines, list):
        return None, LINES_ERR
    lines = [clean(x, LINE_MAX, redact) if isinstance(x, str) else "" for x in lines[:LINES_MAX]]
    if not any(lines):
        return None, LINES_ERR
    done = d.get("done")
    done = sorted({i for i in (done if isinstance(done, list) else []) if _int(i) is not None and 0 <= i < len(lines)})
    return {"lines": lines, "done": done}, None


def provider_of(client):
    c = (client or "").lower()
    if "claude" in c:
        return "claude"
    if "codex" in c:
        return "codex"
    if "gemini" in c or "antigravity" in c:
        return "gemini"
    return "other"


def key_ok(k):
    return isinstance(k, str) and 0 < len(k) <= 120 and all(c.isascii() and (c.isalnum() or c in "-_.") for c in k)


def new_fold():
    return {"ts": 0, "state": None, "title": None, "step": None, "board": None, "big": None, "cheer": None}


def fold_status(f, m, ts):
    """status 보고 반영. 제목이 없으면 직전 제목을 이어 쓴다"""
    if m.get("title") is not None:
        f["title"] = m["title"]
    f["step"] = (m["step"], m["total"]) if "step" in m and "total" in m else None
    done = m["state"] == "done"
    f["big"] = ts if done and m.get("big") is True else None
    f["cheer"] = m.get("cheer") if done else None
    f["state"] = m["state"]
    f["ts"] = max(f["ts"], ts)


def fold_board(f, m, ts):
    f["board"] = (list(m["lines"]), list(m["done"]), ts)
    f["ts"] = max(f["ts"], ts)


def report_value(f, now):
    """state.d.ts Report"""
    o = {"source": "mcp", "ts": f["ts"]}
    if f["state"] is not None:
        o["state"] = f["state"]
    if f["title"] is not None:
        o["title"] = f["title"]
    if f["step"]:
        o["step"], o["total"] = f["step"]
    if f["board"]:
        lines, done, ts = f["board"]
        o["board"] = {"lines": lines, "done": done, "ts": ts}
    if f["big"] is not None and now - f["big"] < BIG_FOR:
        o["big"] = {"title": f["title"] or "", "ts": f["big"]}
    if f["cheer"] is not None:
        o["cheer"] = f["cheer"]
    return o


# ---------- 멀티플렉서 이동 정보 (#37) ----------
# 어댑터 표(Rust term.rs ADAPTERS와 같음): (kind, ((필드, env 이름, 필수, 형식 검증), ...)). Orca가 먼저(Orca 터미널이 CMUX_*를 물려받아도)
_HEX = "[0-9A-Fa-f]"
_UUID = "%s{8}-%s{4}-%s{4}-%s{4}-%s{12}" % ((_HEX,) * 5)
_CMUX_ID = re.compile(_UUID + r"|[a-z]{1,16}:[0-9]{1,6}")
_ORCA_HANDLE = re.compile("term_(?:%s|%s{32})" % (_UUID, _HEX))


_UNC = r"(?![.?]\\)[^\\/]+\\[^\\/]"  # Rust unc: server\share (둘 다 비어 있지 않음, 서버 . ? 아님)
# Rust abs_head: /, 윈도우 드라이브 X:\ X:/, UNC \\server\share, \\?\X:\, \\?\UNC\server\share (#61. \\.\ 장치 경로는 아님)
_ABS_HEAD = re.compile(r"/|[A-Za-z]:[\\/]|\\\\(?:\?\\(?:[A-Za-z]:\\|UNC\\%s)|%s)" % (_UNC, _UNC))


def _orca_path_ok(v):
    """절대 경로(맥 /…·윈도우 C:\\…·UNC), 1–1024자, 제어 문자 없음 (Rust char::is_control = Cc. Python만 생기는 서로게이트(Cs)도 버림)"""
    return bool(_ABS_HEAD.match(v)) and len(v) <= 1024 and not any(unicodedata.category(c) in ("Cc", "Cs") for c in v)


MUX = (
    ("orca", (("surface", "ORCA_TERMINAL_HANDLE", True, _ORCA_HANDLE.fullmatch), ("path", "ORCA_WORKTREE_PATH", False, _orca_path_ok))),
    ("cmux", (("workspace", "CMUX_WORKSPACE_ID", True, _CMUX_ID.fullmatch), ("surface", "CMUX_SURFACE_ID", False, _CMUX_ID.fullmatch))),
)
MUX_ENV = tuple(env for _, fields in MUX for _, env, _, _ in fields)  # 읽어도 되는 환경 변수 전부 (토큰·소켓 비밀번호·소켓 경로는 읽지 않음)


def _mux_value(adapter, get):
    kind, fields = adapter
    m = {"kind": kind}
    for field, env, required, ok in fields:
        v = get(field, env)
        if isinstance(v, str) and ok(v):
            m[field] = v
        elif required:
            return None
    return {"mux": m}


def mux_term(env):
    """환경(매핑) → 훅 이벤트의 term 값. 어댑터 표의 env 이름만 조회한다"""
    for a in MUX:
        v = _mux_value(a, lambda _f, e: env.get(e))
        if v:
            return v
    return None


def mux_jump(term):
    """기록된 term 값 → 세션 jump 값 (표로 다시 검증, 모르는 종류·키는 버림)"""
    m = term.get("mux") if isinstance(term, dict) else None
    if not isinstance(m, dict):
        return None
    for a in MUX:
        if a[0] == m.get("kind"):
            return _mux_value(a, lambda f, _e: m.get(f))
    return None

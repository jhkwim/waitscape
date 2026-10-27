#!/usr/bin/env python3
"""퇴근 일보용 하루치 기록(일지). Rust `crates/wr-core/src/daylog.rs`와 같은 규칙·같은 파일 형식(참조 구현).

server.py가 상태를 만들 때마다 상태 엔진이 감지한 전이(턴 완료·질문 대기·세션 활동)와 사용 한도를 넘겨주면
하루 단위 파일에 쌓고(`record`), 카드에 바로 쓸 모양으로 집계한다(`report`). 화면 연출은 이 모듈의 일이 아니다.

  하루    현지 시각 새벽 4시 ~ 다음 날 새벽 4시 (03:59는 전날, 04:00부터 오늘)
  파일    <폴더>/<YYYY-MM-DD>.json  (폴더 기본 ~/.claude/waiting-room/daylog, WAITING_ROOM_DAYLOG로 변경, off면 끔)
  쓰기    <폴더>/daylog.lock flock 아래 읽기 → 병합 → 임시 파일 → 교체 (Python 서버와 앱이 같이 써도 갱신이 사라지지 않음)
  보존    14일이 지난 파일은 지움. 외부 전송 없음. 프로젝트 이름·프롬프트 요약은 redact() 마스킹 후 60자
  중복    훅과 트랜스크립트가 같은 턴을 조금 다른 시각으로 볼 수 있어, 같은 세션에서 시작·끝이 5초 안이면 같은 턴

파일 형식 (v1)
  {"v":1, "day":"YYYY-MM-DD",
   "turns":[{sid, provider, project, job, start, t, run, by_ai?, cheer?}],   턴 완료 (t = 끝난 시각, run = t - start 초)
                                                               by_ai = AI가 MCP 보고로 "큰 일"이라고 알림(10분 미만이어도 큰 일), cheer = 그 턴의 칭찬 한마디
   "waits":[{sid, provider, t0, t1}],                          질문 대기 (입력 필요 시작 → 다음 진행)
   "act":[{sid, provider, project, first, last}],              세션별 그날 첫·마지막 활동
   "limits":[{t, five_hour, five_hour_resets, seven_day, seven_day_resets}],   한도 표본 (5분 간격, 정전 전이 때 추가)
   "outages":[{t0, t1|null, resets|null}],                     정전(5시간 한도 100%) 구간
   "seen": null|epoch}                                         일보를 본 시각 (POST /daylog/seen)
"""
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta

from statusline_tap import _Lock

DAY_HOUR = 4             # 하루 경계(현지 시각)
QUIET = 45 * 60          # 이만큼 아무 세션도 활동이 없으면 퇴근으로 본다
AFTER_HOUR = 12          # 자동 퇴근 판정은 마지막 활동이 이 시각 이후일 때만 (점심 전 공백은 퇴근이 아님)
BIG = 600                # 큰 일 = 실행 10분 이상
BIG_LIST = 10            # 응답에 담는 큰 일 수
KEEP_DAYS = 14           # 보존 기간(일)
SAMPLE_EVERY = 300       # 한도 표본 간격(초)
ACT_STEP = 60            # 활동 시각은 이만큼 바뀌었거나 이만큼 조용해졌을 때만 파일에 쓴다(쓰기 횟수 제한)
SAME = 5.0               # 같은 턴·대기로 보는 시각 오차(초)
SAME_RESET = 120.0       # 같은 리셋 시각으로 보는 오차(초, statusline_tap.SAME_WINDOW와 같음)
TEXT = 60                # 프롬프트 요약 길이
CHEERS = 5               # 응답에 담는 칭찬 한마디 수(최근 것부터)
VERSION = 1
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def _str(v, d):
    return v if isinstance(v, str) else d


def day_of(ts):
    """ts가 속한 하루(현지 시각에서 4시간을 뺀 날짜)"""
    return (datetime.fromtimestamp(ts) - timedelta(hours=DAY_HOUR)).strftime("%Y-%m-%d")


def shift(day, n):
    return (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")


def day_at(day, hour, add_days=0):
    """그날(달력 날짜) + add_days일의 hour시 정각 epoch"""
    d = datetime.strptime(day, "%Y-%m-%d") + timedelta(days=add_days, hours=hour)
    return time.mktime(d.timetuple())


def resolve(which, now):
    """today | yesterday | YYYY-MM-DD(보존 기간 안, 오늘 이전) → 하루 이름. 아니면 None"""
    today = day_of(now)
    if which in (None, "", "today"):
        return today
    if which == "yesterday":
        return shift(today, -1)
    if not isinstance(which, str) or not DAY_RE.match(which):
        return None
    try:
        datetime.strptime(which, "%Y-%m-%d")
    except ValueError:
        return None
    return which if shift(today, -KEEP_DAYS) < which <= today else None


def empty(day):
    return {"v": VERSION, "day": day, "turns": [], "waits": [], "act": [], "limits": [], "outages": [], "seen": None}


def _same_turn(a, b):
    return (a["sid"] == b["sid"] and a["provider"] == b["provider"]
            and abs(a["t"] - b["t"]) <= SAME and abs(a["start"] - b["start"]) <= SAME)


def _same_wait(a, b):
    return (a["sid"] == b["sid"] and a["provider"] == b["provider"]
            and abs(a["t0"] - b["t0"]) <= SAME and abs(a["t1"] - b["t1"]) <= SAME)


def _extra(r, by_ai, cheer):
    """턴 기록에 AI 보고 표시를 붙인다(있을 때만 키를 둔다 → 옛 일지·Rust와 같은 모양)"""
    if by_ai:
        r["by_ai"] = True
    if cheer:
        r["cheer"] = cheer


def _adds(r, o):
    """r이 같은 턴 o에 없는 AI 보고(by_ai·cheer)를 갖고 있나"""
    return (r.get("by_ai") and not o.get("by_ai")) or (r.get("cheer") and not o.get("cheer"))


def _later(a, b):
    """a가 b보다 늦은가: (시각, 프로바이더, 세션) 순 비교. 같으면 먼저 본 쪽을 남긴다(Rust와 같은 동점 규칙)"""
    return (a[0], a[1]["provider"], a[1]["sid"]) > (b[0], b[1]["provider"], b[1]["sid"])


class DayLog:
    def __init__(self, folder, redact=lambda s: s):
        self.dir = folder
        self.redact = redact
        self._mu = threading.RLock()
        self._cache = {}       # day → (파일 서명, 일지)
        self._seen = set()     # 이미 일지에 있는 것으로 확인한 피드 키 (매번 마스킹·비교하지 않게)
        self._cleaned = None   # 마지막으로 정리한 날

    # ---------- 텍스트·파일 ----------
    def clip(self, s, n=TEXT):
        """마스킹 → 공백 정리 → n자 절단(…). 마스킹을 먼저 해야 잘린 비밀 조각이 새지 않음"""
        s = " ".join(self.redact(s if isinstance(s, str) else "").split())
        return s if len(s) <= n else s[:n - 1] + "…"

    def project(self, cwd):
        return self.clip(os.path.basename((cwd if isinstance(cwd, str) else "").rstrip("/")) or "?")

    def path(self, day):
        return os.path.join(self.dir, day + ".json")

    def _norm(self, j, day):
        """읽은 일지를 정해진 모양으로(잘못된 항목은 버림, 텍스트는 다시 마스킹)"""
        out = empty(day)
        if not isinstance(j, dict):
            return out
        lst = lambda k: [x for x in (j.get(k) if isinstance(j.get(k), list) else []) if isinstance(x, dict)]
        for x in lst("turns"):
            st, t = _num(x.get("start")), _num(x.get("t"))
            if isinstance(x.get("sid"), str) and st is not None and t is not None:
                r = {"sid": x["sid"], "provider": _str(x.get("provider"), "claude"),
                     "project": self.clip(_str(x.get("project"), "?")), "job": self.clip(_str(x.get("job"), "")),
                     "start": st, "t": t, "run": t - st}
                _extra(r, x.get("by_ai") is True, self.clip(x["cheer"]) if isinstance(x.get("cheer"), str) else None)
                out["turns"].append(r)
        for x in lst("waits"):
            t0, t1 = _num(x.get("t0")), _num(x.get("t1"))
            if isinstance(x.get("sid"), str) and t0 is not None and t1 is not None:
                out["waits"].append({"sid": x["sid"], "provider": _str(x.get("provider"), "claude"), "t0": t0, "t1": t1})
        for x in lst("act"):
            a, b = _num(x.get("first")), _num(x.get("last"))
            if isinstance(x.get("sid"), str) and a is not None and b is not None:
                out["act"].append({"sid": x["sid"], "provider": _str(x.get("provider"), "claude"),
                                   "project": self.clip(_str(x.get("project"), "?")), "first": a, "last": b})
        for x in lst("limits"):
            t = _num(x.get("t"))
            if t is not None:
                out["limits"].append({"t": t, **{k: _num(x.get(k)) for k in
                                                 ("five_hour", "five_hour_resets", "seven_day", "seven_day_resets")}})
        for x in lst("outages"):
            t0 = _num(x.get("t0"))
            if t0 is not None:
                out["outages"].append({"t0": t0, "t1": _num(x.get("t1")), "resets": _num(x.get("resets"))})
        out["seen"] = _num(j.get("seen"))
        return out

    def _load(self, day):
        try:
            with open(self.path(day), encoding="utf-8") as f:
                j = json.load(f)
        except (OSError, ValueError):
            j = None
        return self._norm(j, day)

    def _sig(self, p):
        try:
            st = os.stat(p)
            return (st.st_mtime_ns, st.st_size)
        except OSError:
            return None

    def get(self, day):
        """하루 일지 (파일이 바뀌었을 때만 다시 읽음)"""
        sig = self._sig(self.path(day))
        c = self._cache.get(day)
        if c is not None and c[0] == sig:
            return c[1]
        j = self._load(day) if sig is not None else empty(day)
        if len(self._cache) > 8:
            self._cache.clear()
        self._cache[day] = (sig, j)
        return j

    def _write(self, day, j):
        p = self.path(day)
        tmp = "%s.%d.%d.tmp" % (p, os.getpid(), threading.get_ident())
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(j, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, p)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
        self._cache[day] = (self._sig(p), j)

    def _locked(self):
        os.makedirs(self.dir, mode=0o700, exist_ok=True)
        return _Lock(os.path.join(self.dir, "daylog"))

    def cleanup(self, today, now):
        """보존 기간이 지난 하루 파일과 오래된 임시 파일을 지운다(프로세스마다 하루 한 번)"""
        if self._cleaned == today:
            return
        self._cleaned = today
        cut = shift(today, -KEEP_DAYS)
        try:
            names = os.listdir(self.dir)
        except OSError:
            return
        for nm in names:
            p = os.path.join(self.dir, nm)
            m = FILE_RE.match(nm)
            try:
                if (m and m.group(1) <= cut) or (nm.endswith(".tmp") and os.path.getmtime(p) < now - 3600):
                    os.remove(p)
            except OSError:
                pass

    # ---------- 기록 ----------
    def record(self, feeds, limits, now):
        """feeds = [(provider, {"turns": [{sid, cwd, prompt, start, end, big?, cheer?}], "waits": [{sid, t0, t1}], "act": [{sid, cwd, last}]})]
        limits = state의 limits. 바뀐 게 있을 때만 파일에 쓴다. 쓴 날 목록을 돌려줌."""
        with self._mu:
            today = day_of(now)
            yday = shift(today, -1)
            days = (yday, today)
            J = {d: self.get(d) for d in days}
            delta = {}
            if len(self._seen) > 20000:
                self._seen.clear()

            def dl(d):
                return delta.setdefault(d, {"turns": [], "waits": [], "act": [], "limits": [], "open": None, "close": None,
                                            "force": False})

            for prov, f in feeds:
                for x in f.get("turns", ()):
                    key = ("t", prov, x["sid"], x["start"], x["end"])
                    if key in self._seen:
                        continue
                    d = day_of(x["end"])
                    if d not in days:
                        continue
                    rec = {"sid": x["sid"], "provider": prov, "project": self.project(x.get("cwd")),
                           "job": self.clip(x.get("prompt")), "start": x["start"], "t": x["end"], "run": x["end"] - x["start"]}
                    _extra(rec, x.get("big") is True, self.clip(x["cheer"]) if x.get("cheer") else None)
                    # 이미 있는 턴(훅·트랜스크립트가 먼저 기록)이면 건너뜀. 단 AI 보고(by_ai·cheer)를 새로 더할 게 있으면 합치러 간다
                    if any(_same_turn(rec, o) and not _adds(rec, o) for o in J[d]["turns"] + delta.get(d, {}).get("turns", [])):
                        self._seen.add(key)
                        continue
                    dl(d)["turns"].append(rec)
                for x in f.get("waits", ()):
                    key = ("w", prov, x["sid"], x["t0"], x["t1"])
                    if key in self._seen:
                        continue
                    d = day_of(x["t1"])
                    if d not in days:
                        continue
                    rec = {"sid": x["sid"], "provider": prov, "t0": x["t0"], "t1": x["t1"]}
                    if any(_same_wait(rec, o) for o in J[d]["waits"] + delta.get(d, {}).get("waits", [])):
                        self._seen.add(key)
                        continue
                    dl(d)["waits"].append(rec)
                for x in f.get("act", ()):
                    last = x["last"]
                    d = day_of(last)
                    if d not in days:
                        continue
                    old = next((o for o in J[d]["act"] if o["provider"] == prov and o["sid"] == x["sid"]), None)
                    if old is not None and not (last > old["last"] and (last - old["last"] >= ACT_STEP or now - last >= ACT_STEP)):
                        continue
                    dl(d)["act"].append({"sid": x["sid"], "provider": prov, "project": self.project(x.get("cwd")),
                                         "first": last, "last": last})

            # 사용 한도: 정전(5시간 100%) 구간 + 표본 (오늘 파일)
            lim = limits if isinstance(limits, dict) else {}

            def pick(k):
                w = lim.get(k) if isinstance(lim.get(k), dict) else {}
                return _num(w.get("used_percentage")), _num(w.get("resets_at"))
            p5, r5 = pick("five_hour")
            p7, r7 = pick("seven_day")
            open_day, open_o = None, None
            for d in (today, yday):
                open_o = next((o for o in reversed(J[d]["outages"]) if o["t1"] is None), None)
                if open_o is not None:
                    open_day = d
                    break
            force = False
            if open_o is None:
                if p5 is not None and p5 >= 100:
                    dl(today)["open"] = {"t0": now, "t1": None, "resets": r5}
                    force = True
            else:
                gone = open_o["resets"] is not None and open_o["resets"] <= now
                if gone or (p5 is not None and p5 < 100):
                    t1 = min(now, open_o["resets"]) if gone else now
                    dl(open_day)["close"] = {"t0": open_o["t0"], "t1": max(t1, open_o["t0"])}
                    force = True
            if p5 is not None or p7 is not None:
                jt = J[today]
                dt = delta.get(today, {})
                active = force or jt["act"] or jt["turns"] or dt.get("act") or dt.get("turns")
                last_s = jt["limits"][-1] if jt["limits"] else None
                if active and (force or last_s is None or now - last_s["t"] >= SAMPLE_EVERY):
                    dl(today)["limits"].append({"t": now, "five_hour": p5, "five_hour_resets": r5,
                                                "seven_day": p7, "seven_day_resets": r7})
                    dl(today)["force"] = force
            if not delta:
                return []
            try:
                lock = self._locked()
            except OSError:
                return []
            with lock:
                for d in sorted(delta):
                    j = self._load(d)
                    _apply(j, delta[d])
                    self._write(d, j)
                self.cleanup(today, now)
            return sorted(delta)

    def mark_seen(self, which, now):
        """그날 일보를 봤다고 기록 → {day, seen}. 잘못된 날이면 None"""
        day = resolve(which, now)
        if day is None:
            return None
        with self._mu:
            try:
                lock = self._locked()
            except OSError:
                return {"day": day, "seen": None}
            with lock:
                j = self._load(day)
                j["seen"] = now
                self._write(day, j)
            return {"day": day, "seen": now}

    # ---------- 집계 ----------
    def report(self, which, now):
        """카드에 바로 쓸 하루 집계. 잘못된 날이면 None"""
        day = resolve(which, now)
        if day is None:
            return None
        with self._mu:
            today = day_of(now)
            out = summarize(self.get(day), day, now, day == today)
            if day == today:
                y = summarize(self.get(shift(day, -1)), shift(day, -1), now, False)
                out["prev"] = {k: y[k] for k in ("day", "done", "ready", "ready_at", "seen", "unseen")}
            else:
                out["prev"] = None
            return out


def _apply(j, dl):
    """잠금 안에서 방금 읽은 일지에 변경분을 합친다 (다른 프로세스가 그 사이 쓴 것과도 중복 제거)"""
    for r in dl["turns"]:
        o = next((o for o in j["turns"] if _same_turn(r, o)), None)
        if o is None:
            j["turns"].append(r)
        else:  # 같은 턴: AI 보고 표시만 더한다(먼저 있던 값은 그대로)
            _extra(o, r.get("by_ai") and not o.get("by_ai"), r.get("cheer") if not o.get("cheer") else None)
    j["turns"].sort(key=lambda x: (x["t"], x["sid"], x["provider"]))
    for r in dl["waits"]:
        if not any(_same_wait(r, o) for o in j["waits"]):
            j["waits"].append(r)
    j["waits"].sort(key=lambda x: (x["t1"], x["sid"], x["provider"]))
    for r in dl["act"]:
        o = next((o for o in j["act"] if o["provider"] == r["provider"] and o["sid"] == r["sid"]), None)
        if o is None:
            j["act"].append(dict(r))
        else:
            o["first"] = min(o["first"], r["first"])
            if r["last"] >= o["last"]:
                o["last"] = r["last"]
                o["project"] = r["project"]
    j["act"].sort(key=lambda x: (x["provider"], x["sid"]))
    c = dl["close"]
    if c:
        for o in j["outages"]:
            if o["t1"] is None and o["t0"] == c["t0"]:
                o["t1"] = c["t1"]
    if dl["open"] and not any(o["t1"] is None for o in j["outages"]):
        j["outages"].append(dict(dl["open"]))
    j["outages"].sort(key=lambda x: x["t0"])
    for s in dl["limits"]:
        last = j["limits"][-1] if j["limits"] else None
        if dl["force"] or last is None or s["t"] - last["t"] >= SAMPLE_EVERY:
            j["limits"].append(s)
    j["limits"].sort(key=lambda x: x["t"])


def summarize(j, day, now, is_today):
    start, end, noon = day_at(day, DAY_HOUR), day_at(day, DAY_HOUR, 1), day_at(day, AFTER_HOUR)
    turns, waits, acts = j["turns"], j["waits"], j["act"]
    done = len(turns)
    work = sum(t["t"] - t["start"] for t in turns)
    # 큰 일 = 10분 넘게 걸린 턴 + AI가 MCP 보고로 큰 일이라고 알린 턴(by_ai)
    bigs = sorted((t for t in turns if t["t"] - t["start"] >= BIG or t.get("by_ai")),
                  key=lambda t: (-(t["t"] - t["start"]), t["t"], t["sid"]))
    big = [dict({"sid": t["sid"], "provider": t["provider"], "project": t["project"], "job": t["job"],
                 "run": t["t"] - t["start"], "t": t["t"]}, **({"by_ai": True} if t.get("by_ai") else {})) for t in bigs[:BIG_LIST]]
    cheers = [{"sid": t["sid"], "provider": t["provider"], "text": t["cheer"], "t": t["t"]} for t in turns if t.get("cheer")][-CHEERS:]
    wn = len(waits)
    wavg = sum(w["t1"] - w["t0"] for w in waits) / wn if wn else None
    by = {}
    for t in turns:
        w = by.setdefault((t["provider"], t["sid"]), {"sid": t["sid"], "provider": t["provider"], "project": t["project"],
                                                        "done": 0, "work": 0})
        w["done"] += 1
        w["work"] += t["t"] - t["start"]
        w["project"] = t["project"]
    workers = sorted(by.values(), key=lambda w: (-w["done"], -w["work"], w["provider"], w["sid"]))
    lasts = [a["last"] for a in acts] + [t["t"] for t in turns] + [w["t1"] for w in waits]
    firsts = [a["first"] for a in acts] + [t["start"] for t in turns] + [w["t0"] for w in waits]
    last = max(lasts) if lasts else None
    first = min(firsts) if firsts else None
    lc = None
    for c in [(a["last"], a) for a in acts] + [(t["t"], t) for t in turns]:
        if lc is None or _later(c, lc):
            lc = c
    samples = [dict(s) for s in j["limits"]]
    resets = []
    for r in sorted(s["five_hour_resets"] for s in samples if s["five_hour_resets"] is not None):
        if start <= r <= min(now, end) and (not resets or r - resets[-1] > SAME_RESET):
            resets.append(r)
    week = [s["seven_day"] for s in samples if s["seven_day"] is not None]
    five = [s["five_hour"] for s in samples if s["five_hour"] is not None]
    # 퇴근 판정: 오늘은 마지막 활동이 정오 이후이고 45분 조용하면 준비됨, 지난 날은 끝났으니 준비됨
    ready_at, reason = None, None
    if done > 0 and last is not None:
        ra = last + QUIET if last >= noon else None
        if is_today:
            if ra is not None and now >= ra:
                ready_at, reason = ra, "quiet"
        elif end <= now:
            if ra is not None and ra <= end:
                ready_at, reason = ra, "quiet"
            else:
                ready_at, reason = end, "day-over"
    seen = j["seen"]
    return {
        "v": VERSION, "day": day, "today": is_today, "start": start, "end": end, "now": now,
        "done": done, "work": work, "big": big, "big_count": len(bigs), "cheers": cheers,
        "wait": {"avg": wavg, "n": wn},
        "workers": workers, "mvp": dict(workers[0]) if workers else None,
        "first": first, "last": last, "quiet": now - last if last is not None else None,
        "last_call": {"sid": lc[1]["sid"], "provider": lc[1]["provider"], "project": lc[1]["project"], "t": lc[0]} if lc else None,
        "limits": {"samples": samples, "resets": resets,
                   "weekly": {"from": week[0], "to": week[-1]} if week else None,
                   "peak": max(five) if five else None},
        "outages": [{"t0": o["t0"], "t1": o["t1"]} for o in j["outages"]], "outage_count": len(j["outages"]),
        "ready": ready_at is not None, "ready_at": ready_at, "reason": reason,
        "seen": seen, "unseen": ready_at is not None and (seen is None or seen < ready_at),
        "rule": {"day_hour": DAY_HOUR, "quiet_min": QUIET // 60, "after_hour": AFTER_HOUR, "big_min": BIG // 60,
                 "keep_days": KEEP_DAYS},
    }

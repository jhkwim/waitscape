#!/usr/bin/env python3
"""statusline 데이터(사용 한도, 컨텍스트)를 받아 대기실용 파일에 저장. 화면 출력 없음, 절대 실패하지 않음.

여러 Claude Code 세션(플러그인이 띄우는 내부 세션 포함)이 각자 마지막 요청 시점의 오래된 rate_limits를 보내므로,
마지막 값으로 덮어쓰면 한도가 깜빡인다. 그래서 **읽기-병합-교체**를 파일 잠금 안에서 하고, 병합은 창별 최댓값 규칙을 따른다.
(같은 창 = 같은 resets_at 안에서 사용률은 줄지 않는다 → 최댓값 / 더 늦게 끝나는 창이 최신 / 지난 창은 폐기 / 5h 없는 보고는 기존 5h를 지우지 않음)
"""
import json
import os
import sys
import time

OUT = os.environ.get("WAITING_ROOM_STATUS") or os.path.expanduser("~/.claude/waiting-room/statusline.json")
SAME_WINDOW = 120.0  # 같은 창으로 보는 resets_at 오차(초). 창 길이(최소 5시간)보다 훨씬 작다


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def _pick_window(cands):
    best = dict(cands[0])
    for x in cands[1:]:
        rb, rx = _num(best.get("resets_at")), _num(x.get("resets_at"))
        if rb is None or rx is None or abs(rb - rx) < SAME_WINDOW:
            for key in ("used_percentage", "resets_at"):
                a, b = _num(best.get(key)), _num(x.get(key))
                if b is not None and (a is None or b > a):
                    best[key] = x[key]
        elif rx > rb:
            best = dict(x)
    return best


def merge_limits(prev, new, now):
    """한도 두 보고를 창별 최댓값으로 합친다. 비면 None. Rust `limits::merge_limits`와 같은 규칙(fixtures/limits_merge.json)."""
    prev = prev if isinstance(prev, dict) else {}
    new = new if isinstance(new, dict) else {}
    out = {}
    for k in list(prev) + [k for k in new if k not in prev]:
        cands = []
        for src in (prev, new):
            c = src.get(k)
            if not isinstance(c, dict):
                continue
            r = _num(c.get("resets_at"))
            if r is not None and r <= now:
                continue  # 이미 지난 창
            cands.append(c)
        if cands:
            out[k] = _pick_window(cands)
    return out or None


class _Lock:
    """statusline.json 읽기-병합-교체를 한 번에 하나씩. 잠금을 못 얻어도(오래 걸림·미지원 OS) 진행한다(절대 실패하지 않음)."""

    def __init__(self, path):
        self.path, self.fd = path + ".lock", None

    def __enter__(self):
        try:
            import fcntl
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            end = time.time() + 3
            while True:
                try:
                    fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.time() > end:
                        break
                    time.sleep(0.01)
        except Exception:
            pass
        return self

    def __exit__(self, *a):
        if self.fd is not None:
            try:
                os.close(self.fd)  # 닫으면 잠금도 풀림
            except OSError:
                pass


def update(state, d, now):
    """state(파일 내용)에 statusline 보고 d를 합쳐 돌려준다."""
    if d.get("rate_limits"):
        merged = merge_limits(state.get("limits"), d["rate_limits"], now)
        if merged != state.get("limits"):
            state["limits_ts"] = now  # 새 정보가 들어온 때만 갱신 (오래된 보고가 시각을 끌어올리지 않게)
        if merged:
            state["limits"] = merged
        else:
            state.pop("limits", None)
    sid = d.get("session_id")
    if sid:
        sessions = {k: v for k, v in state.get("sessions", {}).items() if now - v.get("ts", 0) < 86400}
        sessions[sid] = {
            "ts": now,
            "ctx": (d.get("context_window") or {}).get("used_percentage"),
            "model": (d.get("model") or {}).get("display_name"),
        }
        state["sessions"] = sessions
    return state


def main():
    d = json.load(sys.stdin)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with _Lock(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                state = json.load(f)
            if not isinstance(state, dict):
                state = {}
        except (OSError, ValueError):
            state = {}
        update(state, d, time.time())
        tmp = "%s.%d.tmp" % (OUT, os.getpid())
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, OUT)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass

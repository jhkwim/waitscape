#!/usr/bin/env python3
"""사용 한도 직접 조회 (선택 기능).

- 대상: https://api.anthropic.com/api/oauth/usage (Claude Code의 /usage가 쓰는 것과 같은 비공개 API)
- 보내는 것: macOS 키체인 'Claude Code-credentials'의 OAuth access token (인증 헤더에만)
- 토큰은 메모리에만 두고 화면·파일·로그에 남기지 않음

단독 실행하면 한 번 조회해서 응답 구조만 보여줌:  python3 usage_poll.py
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

URL = "https://api.anthropic.com/api/oauth/usage"
KEYS = {"five_hour": "five_hour", "seven_day": "seven_day", "extra_usage": "spend_limit"}


def _token():
    raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                         capture_output=True, text=True, timeout=5).stdout
    return json.loads(raw)["claudeAiOauth"]["accessToken"]


def _epoch(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v / 1000 if v > 1e12 else v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()


def fetch():
    """statusline의 rate_limits와 같은 모양으로 변환해서 반환. 실패하면 (None, 이유)."""
    try:
        req = urllib.request.Request(URL, headers={
            "Authorization": "Bearer " + _token(),
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-waiting-room",
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # 키체인 없음, 네트워크 등
        return None, type(e).__name__
    limits = {}
    for src, dst in KEYS.items():
        v = d.get(src)
        if not isinstance(v, dict):
            continue
        pct = v.get("utilization", v.get("used_percentage"))
        if pct is None:
            continue
        limits[dst] = {"used_percentage": float(pct), "resets_at": _epoch(v.get("resets_at"))}
    return (limits or None), (None if limits else "알 수 없는 응답 형식")


if __name__ == "__main__":
    limits, err = fetch()
    if limits:
        print("✅ 조회 성공 (변환 결과):")
        print(json.dumps(limits, ensure_ascii=False, indent=1))
    else:
        print("❌ 실패:", err)
        sys.exit(1)

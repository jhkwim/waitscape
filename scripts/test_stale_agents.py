#!/usr/bin/env python3
"""회귀: Stop이 누락된 에이전트 정리(server.py expire_agents). 5시간 59분은 running 유지, 6시간 1분은 done+stale,
훅은 오래됐어도 트랜스크립트가 최근이면 유지. 실행: python3 scripts/test_stale_agents.py"""
import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

NOW, H = 1_000_000.0, 3600


def agent(last):
    return {"aid": "a1", "status": "running", "since": last, "last": last, "health": {"level": "stall"}}


def run(hook_ago, tx_ago=None):
    server._paths.clear()
    with tempfile.TemporaryDirectory() as d:
        main = os.path.join(d, "s1.jsonl")
        open(main, "w").close()
        server._paths["s1"] = main
        if tx_ago is not None:
            os.makedirs(os.path.join(d, "s1", "subagents"))
            open(os.path.join(d, "s1", "subagents", "agent-a1.jsonl"), "w").close()
            server.scan = lambda p: {"last_ts": NOW - tx_ago}
        s = {"sid": "s1", "agents": {"a1": agent(NOW - hook_ago)}}
        server.expire_agents(s, NOW)
        return s["agents"]["a1"]


a = run(6 * H - 60)
assert a["status"] == "running" and "stale" not in a, "5시간 59분은 유지"
a = run(6 * H + 60)
assert a["status"] == "done" and a["stale"] is True and a["ended"] == NOW - (6 * H + 60) and "health" not in a, "6시간 1분은 종료"
a = run(8 * H, tx_ago=60)
assert a["status"] == "running" and "stale" not in a, "트랜스크립트가 최근이면 유지"
a = run(8 * H, tx_ago=7 * H)
assert a["status"] == "done" and a["ended"] == NOW - 7 * H, "둘 다 오래되면 늦은 쪽이 ended"
a = run(2 * H)
assert a["status"] == "running", "최근 활동은 건드리지 않음"
print("OK: stale 에이전트 5건")

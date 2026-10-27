#!/usr/bin/env python3
"""한도 병합 규칙·statusline_tap 동시 실행 테스트 (표준 라이브러리만). 실행: python3 scripts/test_limits_merge.py"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import statusline_tap as tap  # noqa: E402


class Merge(unittest.TestCase):
    def test_shared_cases(self):
        with open(os.path.join(ROOT, "fixtures", "limits_merge.json"), encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        for c in cases:
            self.assertEqual(tap.merge_limits(c["prev"], c["new"], c["now"]), c["expect"], c["name"])

    def test_stale_reports_do_not_flicker(self):
        good = {"five_hour": {"used_percentage": 13, "resets_at": 2000}, "seven_day": {"used_percentage": 52, "resets_at": 5000}}
        stale = {"seven_day": {"used_percentage": 23, "resets_at": 5000}}
        state = {}
        seen = set()
        for i in range(12):
            tap.update(state, {"rate_limits": good if i % 2 == 0 else stale, "session_id": "s%d" % (i % 3)}, 1000.0 + i)
            seen.add(json.dumps(state["limits"], sort_keys=True))
        self.assertEqual(len(seen), 1)
        self.assertEqual(state["limits"], good)

    def test_limits_ts_only_moves_on_new_info(self):
        good = {"seven_day": {"used_percentage": 52, "resets_at": 5000}}
        state = {}
        tap.update(state, {"rate_limits": good}, 1000.0)
        tap.update(state, {"rate_limits": {"seven_day": {"used_percentage": 20, "resets_at": 5000}}}, 1100.0)
        self.assertEqual(state["limits_ts"], 1000.0)
        tap.update(state, {"rate_limits": {"seven_day": {"used_percentage": 60, "resets_at": 5000}}}, 1200.0)
        self.assertEqual(state["limits_ts"], 1200.0)


class Concurrent(unittest.TestCase):
    def test_parallel_taps_lose_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "wr", "statusline.json")
            env = dict(os.environ, WAITING_ROOM_STATUS=out)
            now = time.time()
            good = {"five_hour": {"used_percentage": 13, "resets_at": now + 3600}, "seven_day": {"used_percentage": 52, "resets_at": now + 86400}}
            stale = {"seven_day": {"used_percentage": 23, "resets_at": now + 86400}}
            procs = []
            for i in range(40):
                body = {"session_id": "sess-%d" % i, "rate_limits": good if i % 4 == 0 else stale, "context_window": {"used_percentage": i}}
                p = subprocess.Popen([sys.executable, os.path.join(ROOT, "statusline_tap.py")], stdin=subprocess.PIPE, env=env)
                p.stdin.write(json.dumps(body).encode())
                p.stdin.close()
                procs.append(p)
            for p in procs:
                self.assertEqual(p.wait(), 0)
            with open(out, encoding="utf-8") as f:
                state = json.load(f)
            self.assertEqual(len(state["sessions"]), 40, "동시 실행에서 세션 항목이 사라짐(갱신 손실)")
            self.assertEqual(state["limits"], good)
            self.assertEqual([x for x in os.listdir(os.path.dirname(out)) if x.endswith(".tmp")], [])


if __name__ == "__main__":
    unittest.main()

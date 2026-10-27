#!/usr/bin/env python3
"""회귀: statusline.json이 오래된 값/정상값/5h 없음으로 번갈아 덮여도 /state의 limits는 처음 정상값 이후 내려가지 않는다.
Rust(wr-server)와 Python(server.py) 둘 다. 실행: cargo build -p wr-server && python3 scripts/test_flicker_state.py [wr-server 경로]"""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "target", "debug", "wr-server")


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def run(name, argv, env, port, status):
    now = time.time()
    f5, fw = now + 3600, now + 86400 * 3
    good = {"five_hour": {"used_percentage": 29, "resets_at": f5}, "seven_day": {"used_percentage": 54, "resets_at": fw}}
    stale = [
        {"seven_day": {"used_percentage": 23, "resets_at": fw}},
        {"five_hour": {"used_percentage": 3, "resets_at": f5}, "seven_day": {"used_percentage": 51, "resets_at": fw}},
        {"seven_day": {"used_percentage": 40, "resets_at": fw}},
    ]
    def write(l):
        tmp = status + ".t"
        json.dump({"limits": l, "limits_ts": time.time()}, open(tmp, "w")); os.replace(tmp, status)
    write(good)
    p = subprocess.Popen(argv, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try: urllib.request.urlopen("http://127.0.0.1:%d/state" % port, timeout=1); break
            except Exception: time.sleep(0.1)
        seen = []
        for i in range(24):  # 처음 정상값을 한 번 본 뒤 오래된 값으로 덮기
            if i: write(stale[i % 3])
            d = json.load(urllib.request.urlopen("http://127.0.0.1:%d/state" % port, timeout=3))
            l = d.get("limits") or {}
            seen.append((l.get("five_hour", {}).get("used_percentage"), l.get("seven_day", {}).get("used_percentage")))
            time.sleep(0.05)
        assert set(seen) == {(29, 54)}, "%s: limits가 내려감 %s" % (name, sorted(set(seen), key=str))
        print("OK:", name, "24회 관찰, 전환 0회")
    finally:
        p.kill(); p.wait()


with tempfile.TemporaryDirectory() as d:
    st = os.path.join(d, "statusline.json")
    for sub in ("projects",): os.makedirs(os.path.join(d, sub))
    env = dict(os.environ, WAITING_ROOM_STATUS=st, WAITING_ROOM_LOG=os.path.join(d, "e.jsonl"), WAITING_ROOM_PROJECTS=os.path.join(d, "projects"),
               WAITING_ROOM_MODES=os.path.join(d, "m"), WAITING_ROOM_REPORTS=os.path.join(d, "reports.jsonl"),
               HOME=d, WAITING_ROOM_POLL_USAGE="0")
    port = free_port(); run("wr-server(Rust)", [RUST, "--port", str(port)], dict(env, WAITING_ROOM_PORT=str(port)), port, st)
    port = free_port(); run("server.py(Python)", [sys.executable, os.path.join(ROOT, "server.py")], dict(env, WAITING_ROOM_PORT=str(port)), port, st)

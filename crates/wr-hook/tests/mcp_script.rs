//! `wr-hook mcp` 통합 테스트: 실제 바이너리를 자식 프로세스로 띄워 stdio JSON-RPC 대본을 흘린다.
//! 기록 파일은 모두 임시 폴더(`--reports`/env로 지정). 실제 ~/.claude는 건드리지 않는다.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[path = "../../wr-core/src/binswap.rs"]
mod binswap;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_wr-hook");
/// 자식 프로세스 하나가 넘으면 안 되는 시간 (넘으면 워치독이 죽여서 테스트가 멈추지 않고 실패한다)
const CHILD_LIMIT: Duration = Duration::from_secs(20);

/// 테스트할 바이너리. `target/debug/wr-hook`은 앱 크레이트 빌드(tauri-build의 externalBin 복사)가
/// `app/src-tauri/binaries/wr-hook-<triple>`(오래된 사이드카일 수 있음)로 덮어쓸 수 있다 — 그러면 `mcp`를 모르는 바이너리가
/// 훅 모드(stdin EOF까지 read_to_end)로 들어가 응답 없이 멈춘다. 처음 한 번 `ping`으로 확인하고, 아니면 고칠 방법과 함께 바로 실패
fn bin() -> &'static str {
    static OK: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    let r = OK.get_or_init(|| {
        let mut child = Command::new(BIN_PATH)
            .args(["mcp", "--reports", "off"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("실행 실패: {e}"))?;
        let _w = watchdog(child.id(), Duration::from_secs(5));
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").ok();
        drop(stdin);
        let mut l = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut l).ok();
        child.wait().ok();
        if l.contains("\"id\":1") {
            Ok(())
        } else {
            Err(format!(
                "{BIN_PATH}가 MCP 서버로 답하지 않음 — 앱 크레이트 빌드가 오래된 사이드카(app/src-tauri/binaries)로 덮어썼을 수 있다. \
                 `sh scripts/build_sidecar.sh`로 사이드카를 새로 만들고 `target/debug/wr-hook`을 지운 뒤 다시 테스트 (CI는 테스트 전에 사이드카를 빌드한다)"
            ))
        }
    });
    if let Err(e) = r {
        panic!("{e}");
    }
    BIN_PATH
}

/// `limit` 안에 끝나지 않으면 자식(pid)을 강제로 끝낸다. 돌려받은 값을 버리면(drop) 해제
struct Watchdog(#[allow(dead_code)] std::sync::mpsc::Sender<()>);

fn watchdog(pid: u32, limit: Duration) -> Watchdog {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if let Err(std::sync::mpsc::RecvTimeoutError::Timeout) = rx.recv_timeout(limit) {
            eprintln!("워치독: 자식 {pid}가 {limit:?} 안에 끝나지 않아 강제 종료");
            let pid = pid.to_string();
            if cfg!(windows) {
                Command::new("taskkill").args(["/F", "/PID", &pid]).status().ok();
            } else {
                Command::new("kill").args(["-9", &pid]).status().ok();
            }
        }
    });
    Watchdog(tx)
}

fn tmp(tag: &str) -> PathBuf {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("wr-mcp-it-{tag}-{}-{t}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 홈·설정 env를 비우고(임시 HOME) 바이너리 실행 → (stdout 줄, stderr, 종료 코드)
fn run(args: &[&str], input: &[u8], home: &Path, envs: &[(&str, &str)]) -> (Vec<String>, String, i32) {
    let mut cmd = Command::new(bin());
    cmd.args(args)
        .env_clear()
        .env("HOME", home)
        .env("USERPROFILE", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Ok(p) = std::env::var("PATH") {
        cmd.env("PATH", p);
    }
    if let Ok(r) = std::env::var("SystemRoot") {
        cmd.env("SystemRoot", r);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().unwrap();
    let _w = watchdog(child.id(), CHILD_LIMIT);
    let mut stdin = child.stdin.take().unwrap();
    let data = input.to_vec();
    let w = std::thread::spawn(move || {
        stdin.write_all(&data).ok();
    });
    let out = child.wait_with_output().unwrap();
    w.join().unwrap();
    let text = String::from_utf8(out.stdout).expect("stdout은 UTF-8");
    assert!(text.is_empty() || text.ends_with('\n'), "응답은 줄 단위: {text:?}");
    (
        text.lines().map(String::from).collect(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
        out.status.code().unwrap_or(-1),
    )
}

fn script(msgs: &[Value]) -> Vec<u8> {
    let mut s = String::new();
    for m in msgs {
        s.push_str(&m.to_string());
        s.push('\n');
    }
    s.into_bytes()
}

fn req(id: Value, method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

fn call(id: i64, name: &str, args: Value) -> Value {
    req(json!(id), "tools/call", json!({"name": name, "arguments": args}))
}

fn init(id: i64, ver: &str) -> Value {
    req(
        json!(id),
        "initialize",
        json!({"protocolVersion": ver, "capabilities": {}, "clientInfo": {"name": "claude-code", "version": "2.1.308"}}),
    )
}

fn records(p: &Path) -> Vec<Value> {
    std::fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).expect("기록 줄은 JSON"))
        .collect()
}

/// stdout의 모든 줄이 JSON-RPC 2.0 응답인지 (T3)
fn responses(lines: &[String]) -> Vec<Value> {
    lines
        .iter()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap_or_else(|_| panic!("stdout에 JSON이 아닌 줄: {l:?}"));
            assert_eq!(v["jsonrpc"], "2.0", "{l}");
            assert!(v.get("id").is_some(), "{l}");
            assert!(v.get("result").is_some() ^ v.get("error").is_some(), "{l}");
            v
        })
        .collect()
}

/// T1 + T3: discover(-32601) → initialize → initialized(무응답) → ping → tools/list → tools/call ×2 → EOF → 종료 코드 0 + bye
#[test]
fn handshake_script() {
    let d = tmp("hs");
    let rp = d.join("reports.jsonl");
    let input = script(&[
        req(json!(0), "server/discover", json!({})),
        init(1, "2025-06-18"),
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        req(json!(2), "ping", json!({})),
        req(json!(3), "tools/list", json!({})),
        call(
            4,
            "waitscape_status",
            json!({"state": "working", "title": "결제\n리팩터", "step": 1, "total": 3}),
        ),
        call(5, "waitscape_board", json!({"lines": ["타입 정리", "테스트"], "done": [0]})),
    ]);
    let (out, err, code) = run(&["mcp", "--reports", rp.to_str().unwrap()], &input, &d, &[]);
    assert_eq!(code, 0);
    assert!(err.is_empty(), "stderr는 비어 있어야 함: {err}");
    let r = responses(&out);
    assert_eq!(r.len(), 6, "알림에는 응답하지 않음: {out:?}");
    assert_eq!((r[0]["id"].clone(), r[0]["error"]["code"].clone()), (json!(0), json!(-32601)));
    let res = &r[1]["result"];
    assert_eq!(res["protocolVersion"], "2025-06-18");
    assert_eq!(res["capabilities"], json!({"tools": {"listChanged": false}}));
    assert_eq!(res["serverInfo"]["name"], "waitscape");
    assert!(res["instructions"].as_str().unwrap().contains("waitscape_status"));
    assert_eq!(r[2]["result"], json!({}));
    let tools = r[3]["result"]["tools"].as_array().unwrap();
    assert_eq!(
        tools.iter().map(|t| t["name"].as_str().unwrap()).collect::<Vec<_>>(),
        ["waitscape_status", "waitscape_board"]
    );
    for t in tools {
        assert_eq!(t["inputSchema"]["additionalProperties"], false);
        assert_eq!(t["annotations"]["destructiveHint"], false);
        assert_eq!(t["annotations"]["readOnlyHint"], false);
    }
    for x in &r[4..6] {
        assert_eq!(x["result"], json!({"content": [{"type": "text", "text": "ok"}]}));
    }
    let rec = records(&rp);
    assert_eq!(
        rec.iter().map(|l| l["type"].as_str().unwrap()).collect::<Vec<_>>(),
        ["hello", "status", "board", "bye"]
    );
    assert_eq!(rec[0]["provider"], "claude");
    assert_eq!(rec[0]["client"]["name"], "claude-code");
    assert_eq!(rec[1]["title"], "결제 리팩터");
    assert!(rec.iter().all(|l| l["key"] == rec[0]["key"] && l["v"] == 1));
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn protocol_versions() {
    let d = tmp("ver");
    for (want, got) in [
        ("2025-11-25", "2025-11-25"),
        ("2025-06-18", "2025-06-18"),
        ("2025-03-26", "2025-03-26"),
        ("2024-11-05", "2024-11-05"),
        ("1999-01-01", "2025-11-25"),
        ("2026-07-28", "2025-11-25"),
    ] {
        let (out, _, _) = run(&["mcp", "--reports", "off"], &script(&[init(1, want)]), &d, &[]);
        assert_eq!(responses(&out)[0]["result"]["protocolVersion"], got, "{want}");
    }
    std::fs::remove_dir_all(&d).ok();
}

/// T2: 오류표
#[test]
fn error_table() {
    let d = tmp("err");
    let rp = d.join("reports.jsonl");
    let mut input = script(&[
        req(json!("s-1"), "resources/list", json!({})),
        req(json!(9007199254740993u64), "prompts/list", json!({})),
        call(3, "waitscape_cheer", json!({})),
        call(4, "waitscape_status", json!({"title": "상태 없음"})),
        call(5, "waitscape_status", json!({"state": "started"})),
        call(6, "waitscape_board", json!({"lines": "한 줄"})),
        call(
            7,
            "waitscape_status",
            json!({"state": "working", "title": "가".repeat(200), "step": 7, "total": 3}),
        ),
        json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 1}}),
        json!({"jsonrpc": "2.0", "id": 8, "result": {}}),
        json!({"jsonrpc": "1.0", "id": 9, "method": "ping"}),
        json!([{"jsonrpc": "2.0", "id": 10, "method": "ping"}]),
    ]);
    input.extend_from_slice(b"{not json\n");
    let (out, err, code) = run(&["mcp", "--reports", rp.to_str().unwrap()], &input, &d, &[]);
    assert_eq!((code, err.as_str()), (0, ""));
    let r = responses(&out);
    let codes: Vec<(Value, Value)> = r.iter().map(|x| (x["id"].clone(), x["error"]["code"].clone())).collect();
    assert_eq!(codes[0], (json!("s-1"), json!(-32601)));
    assert_eq!(codes[1], (json!(9007199254740993u64), json!(-32601)), "큰 정수 id도 그대로");
    assert_eq!(codes[2], (json!(3), json!(-32602)));
    assert!(r[2]["error"]["message"].as_str().unwrap().contains("waitscape_cheer"));
    for x in &r[3..6] {
        assert_eq!(x["result"]["isError"], true, "{x}");
        assert!(!x["result"]["content"][0]["text"].as_str().unwrap().is_empty());
    }
    assert_eq!(r[6]["result"]["content"][0]["text"], "ok", "길이·범위 초과는 정화 후 ok");
    assert_eq!(codes[7], (json!(9), json!(-32600)));
    assert_eq!(codes[8], (Value::Null, json!(-32600)), "batch 배열");
    assert_eq!(codes[9], (Value::Null, json!(-32700)));
    assert_eq!(r.len(), 10, "알림·클라이언트 응답에는 무응답");
    let st: Vec<Value> = records(&rp).into_iter().filter(|l| l["type"] == "status").collect();
    assert_eq!(st.len(), 1);
    assert_eq!(st[0]["title"].as_str().unwrap().chars().count(), 60);
    assert!(st[0].get("step").is_none());
    std::fs::remove_dir_all(&d).ok();
}

/// T4: 1MB 넘는 줄, 잘못된 UTF-8, `\r\n` 줄끝
#[test]
fn framing_edges() {
    let d = tmp("frame");
    let mut input = Vec::new();
    input.extend_from_slice(
        format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\",\"pad\":\"{}\"}}\n",
            "x".repeat(1 << 20)
        )
        .as_bytes(),
    );
    input.extend_from_slice(b"\xff\xfe\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\"}\r\n");
    input.extend_from_slice(b"\r\n\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"ping\"}"); // 마지막 줄 개행 없음
    let (out, err, code) = run(&["mcp", "--reports", "off"], &input, &d, &[]);
    assert_eq!((code, err.as_str()), (0, ""));
    let r = responses(&out);
    assert_eq!(r.len(), 4, "{out:?}");
    assert_eq!((r[0]["id"].clone(), r[0]["error"]["code"].clone()), (Value::Null, json!(-32600)));
    assert_eq!(r[1]["error"]["code"], -32700);
    assert_eq!((r[2]["id"].clone(), r[2]["result"].clone()), (json!(3), json!({})));
    assert_eq!(r[3]["id"], 4);
    std::fs::remove_dir_all(&d).ok();
}

/// T10: 경로 우선순위 — Codex처럼 env를 비운 상태에서도 `--reports`로 정확한 파일에 기록
#[test]
fn reports_path_priority() {
    let d = tmp("path");
    let input = script(&[call(1, "waitscape_status", json!({"state": "working"}))]);
    let arg = d.join("arg.jsonl");
    let envp = d.join("env.jsonl");
    let cfg = d.join("cfg");
    let a = arg.to_str().unwrap();
    let e = envp.to_str().unwrap();
    let c = cfg.to_str().unwrap();
    run(
        &["mcp", "--reports", a],
        &input,
        &d,
        &[("WAITING_ROOM_REPORTS", e), ("CLAUDE_CONFIG_DIR", c)],
    );
    assert_eq!(records(&arg).len(), 3, "--reports가 1순위");
    assert!(!envp.exists());
    run(&["mcp"], &input, &d, &[("WAITING_ROOM_REPORTS", e), ("CLAUDE_CONFIG_DIR", c)]);
    assert_eq!(records(&envp).len(), 3);
    run(&["mcp"], &input, &d, &[("CLAUDE_CONFIG_DIR", c)]);
    assert_eq!(records(&cfg.join("waiting-room").join("reports.jsonl")).len(), 3);
    run(&["mcp"], &input, &d, &[]);
    let rec = records(&d.join(".claude").join("waiting-room").join("reports.jsonl"));
    assert_eq!(rec.len(), 3);
    assert_eq!(rec[0]["provider"], "other", "initialize 없이 온 첫 호출도 hello");
    std::fs::remove_dir_all(&d).ok();
}

/// #37: cmux에서 뜬 사이드카·훅은 어댑터 표의 허용 목록 env(cmux 두 개)만 `term`으로 기록 — 토큰·소켓 비밀번호·소켓 경로는 기록되지 않는다
#[test]
fn cmux_term_allowlist() {
    let d = tmp("cmux");
    let rp = d.join("reports.jsonl");
    let envs = [
        ("CMUX_WORKSPACE_ID", "workspace:2"),
        ("CMUX_SURFACE_ID", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"),
        ("CMUX_SOCKET_PASSWORD", "pw-not-recorded-1"),
        ("CMUX_API_TOKEN", "tok-not-recorded-2"),
        ("CMUX_SOCKET_PATH", "/tmp/not-recorded.sock"),
    ];
    let input = script(&[call(1, "waitscape_status", json!({"state": "working", "title": "cmux"}))]);
    run(&["mcp", "--reports", rp.to_str().unwrap()], &input, &d, &envs);
    let want = json!({"mux": {"kind": "cmux", "workspace": "workspace:2", "surface": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"}});
    let rec = records(&rp);
    assert_eq!(rec.len(), 3);
    assert!(rec.iter().all(|r| r["term"] == want), "{rec:?}");
    // 훅 모드도 같은 값
    let log = d.join("events.jsonl");
    let mut he = envs.to_vec();
    he.push(("WAITING_ROOM_LOG", log.to_str().unwrap()));
    let ev = json!({"session_id": "s", "cwd": "/x", "hook_event_name": "Stop"});
    run(&[], ev.to_string().as_bytes(), &d, &he);
    let ev = records(&log);
    assert_eq!(ev[0]["term"], want);
    for f in [&rp, &log] {
        let raw = std::fs::read_to_string(f).unwrap();
        for v in ["pw-not-recorded", "tok-not-recorded", "not-recorded.sock"] {
            assert!(!raw.contains(v), "{v} 기록됨");
        }
    }
    // 잘못된 값이면 term 없음
    std::fs::remove_file(&log).ok();
    run(
        &[],
        br#"{"session_id": "s", "hook_event_name": "Stop"}"#,
        &d,
        &[("CMUX_WORKSPACE_ID", "--help"), ("WAITING_ROOM_LOG", log.to_str().unwrap())],
    );
    assert!(records(&log)[0].get("term").is_none());
    std::fs::remove_dir_all(&d).ok();
}

/// #40: Orca 터미널에서 뜬 사이드카·훅은 핸들·worktree 경로만 `term`으로 기록 — 에이전트 훅·실행 토큰, 탭·패널·작업공간 ID는 기록되지 않는다
#[test]
fn orca_term_allowlist() {
    let d = tmp("orca");
    let rp = d.join("reports.jsonl");
    let h = "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
    let envs = [
        ("ORCA_TERMINAL_HANDLE", h),
        ("ORCA_WORKTREE_PATH", "/Users/alex/dev/shop"),
        ("ORCA_AGENT_HOOK_TOKEN", "tok-not-recorded-3"),
        ("ORCA_AGENT_LAUNCH_TOKEN", "tok-not-recorded-4"),
        ("ORCA_WORKTREE_ID", "wt-not-recorded-5"),
        ("ORCA_WORKSPACE_ID", "ws-not-recorded-6"),
        ("ORCA_TAB_ID", "tab-not-recorded-7"),
        ("ORCA_PANE_KEY", "pane-not-recorded-8"),
    ];
    let input = script(&[call(1, "waitscape_status", json!({"state": "working", "title": "orca"}))]);
    run(&["mcp", "--reports", rp.to_str().unwrap()], &input, &d, &envs);
    let want = json!({"mux": {"kind": "orca", "surface": h, "path": "/Users/alex/dev/shop"}});
    let rec = records(&rp);
    assert_eq!(rec.len(), 3);
    assert!(rec.iter().all(|r| r["term"] == want), "{rec:?}");
    let log = d.join("events.jsonl");
    let mut he = envs.to_vec();
    he.push(("WAITING_ROOM_LOG", log.to_str().unwrap()));
    let ev = json!({"session_id": "s", "cwd": "/x", "hook_event_name": "Stop"});
    run(&[], ev.to_string().as_bytes(), &d, &he);
    assert_eq!(records(&log)[0]["term"], want);
    for f in [&rp, &log] {
        let raw = std::fs::read_to_string(f).unwrap();
        assert!(!raw.contains("not-recorded"), "허용 목록 밖 값이 기록됨: {raw}");
    }
    std::fs::remove_dir_all(&d).ok();
}

/// T12: `wr-hook mcp`는 훅 모드(read_to_end)로 들어가지 않는다 — stdin을 열어 둔 채 1초 안에 initialize 응답
#[test]
fn mcp_mode_answers_without_eof() {
    let d = tmp("live");
    let mut child = Command::new(bin())
        .args(["mcp", "--reports", "off"])
        .env("HOME", &d)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let _w = watchdog(child.id(), CHILD_LIMIT);
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut l = String::new();
        BufReader::new(stdout).read_line(&mut l).ok();
        tx.send(l).ok();
    });
    let t0 = Instant::now();
    stdin.write_all(format!("{}\n", init(1, "2025-11-25")).as_bytes()).unwrap();
    stdin.flush().unwrap();
    let line = rx.recv_timeout(Duration::from_secs(1)).expect("1초 안에 응답");
    assert!(t0.elapsed() < Duration::from_secs(1));
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], 1);
    drop(stdin);
    assert!(child.wait().unwrap().success());
    std::fs::remove_dir_all(&d).ok();
}

/// T8: 사이드카 8개가 각 200번 호출을 동시에 append → 모든 줄이 온전하고 세션마다 hello로 시작해 bye로 끝난다
/// (속도 제한이 있어 줄 수는 호출 수보다 적다)
#[test]
fn concurrent_appends() {
    let d = tmp("conc");
    let rp = d.join("reports.jsonl");
    let msgs: Vec<Value> = (0..200)
        .map(|i| {
            let st = if i % 2 == 0 { "working" } else { "asking" };
            call(i, "waitscape_status", json!({"state": st, "title": format!("동시 기록 {i}")}))
        })
        .collect();
    let input = script(&msgs);
    let hs: Vec<_> = (0..8)
        .map(|_| {
            let (input, rp, d) = (input.clone(), rp.clone(), d.clone());
            std::thread::spawn(move || run(&["mcp", "--reports", rp.to_str().unwrap()], &input, &d, &[]))
        })
        .collect();
    for h in hs {
        let (out, _, code) = h.join().unwrap();
        assert_eq!((code, out.len()), (0, 200));
    }
    let rec = records(&rp);
    let mut keys: Vec<&str> = rec.iter().map(|l| l["key"].as_str().unwrap()).collect();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), 8);
    for k in keys {
        let mine: Vec<&Value> = rec.iter().filter(|l| l["key"] == k).collect();
        assert_eq!(mine.first().unwrap()["type"], "hello");
        assert_eq!(mine.last().unwrap()["type"], "bye");
        assert_eq!(mine[mine.len() - 2]["title"], "동시 기록 199", "마지막 상태는 남는다");
    }
    std::fs::remove_dir_all(&d).ok();
}

/// 리뷰 PR #35 🟡: SIGTERM을 받으면(stdin은 열린 채) 보류된 마지막 보드를 쓰고 bye 후 종료
#[cfg(unix)]
#[test]
fn sigterm_flushes_pending() {
    let d = tmp("term");
    let rp = d.join("reports.jsonl");
    let mut child = Command::new(bin())
        .args(["mcp", "--reports", rp.to_str().unwrap()])
        .env("HOME", &d)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    // 응답을 못 받으면(ping 대기에서 멈춤) 워치독이 죽여 EOF → 아래 kill이 실패해 테스트가 실패로 끝난다
    let _w = watchdog(child.id(), CHILD_LIMIT);
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut msgs: Vec<Value> = (0..10)
        .map(|i| call(i, "waitscape_status", json!({"state": "working", "title": format!("t{i}")})))
        .collect();
    msgs.extend((10..19).map(|i| call(i, "waitscape_board", json!({"lines": [format!("보드 {i}")]}))));
    msgs.push(req(json!(99), "ping", json!({})));
    stdin.write_all(&script(&msgs)).unwrap();
    stdin.flush().unwrap();
    // ping 응답까지 받으면 앞의 호출은 모두 처리됨(보드는 버킷이 비어 보류 중)
    let mut l = String::new();
    while stdout.read_line(&mut l).unwrap() > 0 && !l.contains("\"id\":99") {
        l.clear();
    }
    let ok = Command::new("kill").args(["-TERM", &child.id().to_string()]).status().unwrap();
    assert!(ok.success());
    let t0 = Instant::now();
    let st = child.wait().unwrap();
    assert!(st.success() && t0.elapsed() < Duration::from_secs(2));
    drop(stdin);
    let rec = records(&rp);
    let boards: Vec<&Value> = rec.iter().filter(|l| l["type"] == "board").collect();
    assert_eq!(boards.last().unwrap()["lines"], json!(["보드 18"]));
    assert_eq!(rec.last().unwrap()["type"], "bye");
    std::fs::remove_dir_all(&d).ok();
}

/// 리뷰 PR #35 🟡: 사이드카(`wr-hook mcp`)가 실행 중일 때 앱의 교체 경로(`binswap::swap_in`). Windows CI에서 실제로 비켜 놓기를 탄다
#[test]
fn swap_while_sidecar_runs() {
    let d = tmp("swap");
    let bin = d.join(if cfg!(windows) { "wr-hook.exe" } else { "wr-hook" });
    std::fs::copy(self::bin(), &bin).unwrap();
    let mut child = Command::new(&bin)
        .args(["mcp", "--reports", "off"])
        .env("HOME", &d)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let _w = watchdog(child.id(), CHILD_LIMIT);
    std::thread::sleep(Duration::from_millis(200));
    let tmpf = d.join(".wr-hook.tmp");
    std::fs::write(&tmpf, b"new build").unwrap();
    binswap::swap_in(&tmpf, &bin).expect("실행 중에도 교체");
    assert_eq!(std::fs::read(&bin).unwrap(), b"new build");
    let olds = || {
        std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".old-"))
            .count()
    };
    assert_eq!(olds(), usize::from(cfg!(windows)), "Windows만 옛 파일을 비켜 놓음");
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
    std::fs::write(&tmpf, b"newer").unwrap();
    binswap::swap_in(&tmpf, &bin).unwrap();
    assert_eq!(olds(), usize::from(cfg!(windows)), "종료된 옛 파일은 정리되고 이번 것만");
    std::fs::remove_dir_all(&d).ok();
}

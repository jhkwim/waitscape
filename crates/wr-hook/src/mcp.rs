//! `wr-hook mcp [--reports <절대 경로>]` — MCP stdio 서버. AI CLI가 띄우고, 도구 2개(`waitscape_status`·`waitscape_board`)
//! 호출을 정화해 `reports.jsonl`에 한 줄씩 append한다. 네트워크 코드 없음.
//!
//! - 프로토콜: 줄 단위 JSON-RPC 2.0, legacy 개정(initialize 핸드셰이크) `2025-11-25`·`2025-06-18`·`2025-03-26`·`2024-11-05`.
//!   클라이언트 값이 목록에 있으면 그대로, 없으면 `2025-11-25`. `server/discover`(2026-07-28 probe)를 포함한 모르는 메서드는
//!   초기화 전후 상관없이 즉시 `-32601` → 이중 지원 클라이언트가 initialize로 되돌아간다(명세 예약 범위 -32020~-32099는 쓰지 않음).
//! - 오류 규칙: 알 수 없는 도구 `-32602`, 필수 인자 누락·enum 밖 → `isError:true` + 고칠 방법 한 줄, 길이·범위 초과는 조용히 정화 후 `ok`.
//!   디스크 쓰기 실패·내부 패닉도 `ok`(best-effort 기능이라 모델이 재시도하며 토큰을 쓰지 않게 — 명세 권고의 의도적 예외).
//! - stdout에는 JSON-RPC 응답만(compact JSON + `\n`, 매번 flush). 진단은 `WR_MCP_DEBUG=1`일 때만 stderr.
//! - 기록: 쓸 때마다 열기(append)·한 번 write·닫기 — 리더(앱)가 회전해도 다음 줄은 새 파일로 간다. 줄 2KB 상한, 부분 쓰기 재시도 없음.
//!   모든 줄에 `v, ts, type, key, provider, cwd, pid, (ppid), wr` → 줄 하나만 봐도 어느 세션인지 안다.
//! - 속도 제한: 프로세스당 토큰 버킷(버스트 6, 초당 0.5). 같은 내용 반복은 생략, state가 바뀌는 status는 즉시,
//!   넘치면 종류별 최신 1건을 보류했다가 토큰이 차거나 stdin EOF 때 기록(마지막 상태를 버리지 않음). 결과는 항상 `"ok"`.
//! - 수명: initialize 응답 직후(또는 initialize 없이 온 첫 도구 호출 때) `hello`, stdin EOF → 보류분 기록 → `bye` → 종료 코드 0.
//! - 경로: `--reports` > `WAITING_ROOM_REPORTS` > `$CLAUDE_CONFIG_DIR/waiting-room/reports.jsonl` > `~/.claude/waiting-room/reports.jsonl`.
//!   Codex는 기본 허용 env만 넘기므로 앱·docs/DEVELOPMENT.md의 등록 명령은 항상 `--reports <절대 경로>`를 쓴다. `off`면 기록하지 않는다.
#![deny(clippy::print_stdout)]

use crate::report::{self, board_of, provider_of, status_of};
use crate::{dumps, env, expand, home, now};
use serde_json::{json, Map, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const PROTOCOLS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
pub const LATEST: &str = "2025-11-25";
/// stdin 한 줄 상한
pub const MAX_LINE: usize = 1 << 20;
/// 기록 한 줄 상한
pub const MAX_RECORD: usize = 2048;
const BURST: f64 = 6.0;
const RATE: f64 = 0.5;
/// state 전이는 이 버킷으로 즉시 기록 (번갈아 바꾸며 도배하는 경우는 넘치면 일반 버킷·보류로)
const T_BURST: f64 = 10.0;
const T_RATE: f64 = 1.0;
pub const CWD_MAX: usize = 400;

pub const INSTRUCTIONS: &str = "Waitscape is a small window where the user watches your progress while they wait. \
For any task with 2+ steps: call waitscape_status(state=\"working\", title, step, total) when you start and at each new step; \
call it with state=\"asking\" right before you stop to ask the user something; call it with state=\"done\" when finished. \
Optionally put your short plan on waitscape_board and update `done` as lines finish. Skip it for one-shot answers. \
Main agent only; subagents should not call these tools. Write titles in the user's language, few words, no secrets or file contents. \
Calls are instant and always return \"ok\"; never retry.";

/// tools/list 결과 (순서 고정: status, board)
pub fn tools() -> Value {
    let ann = |title: &str| json!({"title": title, "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false});
    json!([
        {
            "name": "waitscape_status",
            "title": "Waitscape status",
            "description": "Progress status for the user's Waitscape window: report when you start a multi-step task, at each step, right before asking the user, and when done.",
            "inputSchema": {"type": "object", "additionalProperties": false, "required": ["state"], "properties": {
                "state": {"type": "string", "enum": ["working", "asking", "done"],
                          "description": "working = making progress; asking = about to ask the user and wait; done = task finished"},
                "title": {"type": "string", "minLength": 1, "maxLength": 60,
                          "description": "Few words in the user's language: what you are doing, or the question"},
                "step": {"type": "integer", "minimum": 1, "maximum": 99},
                "total": {"type": "integer", "minimum": 1, "maximum": 99},
                "big": {"type": "boolean", "description": "Only with state=done: the finished task was large"},
                "cheer": {"type": "string", "maxLength": 60, "description": "Only with state=done: one upbeat line for the user's daily log"}
            }},
            "annotations": ann("Waitscape status")
        },
        {
            "name": "waitscape_board",
            "title": "Waitscape plan board",
            "description": "Plan whiteboard in the user's Waitscape window: write up to 4 short lines of your current plan and mark finished ones. Replaces the previous board.",
            "inputSchema": {"type": "object", "additionalProperties": false, "required": ["lines"], "properties": {
                "lines": {"type": "array", "minItems": 1, "maxItems": 4, "items": {"type": "string", "minLength": 1, "maxLength": 32}},
                "done": {"type": "array", "uniqueItems": true, "maxItems": 4, "items": {"type": "integer", "minimum": 0, "maximum": 3},
                         "description": "0-based indexes of finished lines"}
            }},
            "annotations": ann("Waitscape plan board")
        }
    ])
}

fn debug(msg: &str) {
    if env("WR_MCP_DEBUG").as_deref() == Some("1") {
        eprintln!("[wr-hook mcp] {msg}");
    }
}

/// 기록 경로 (None = `off`)
pub fn reports_path(args: &[String]) -> Option<PathBuf> {
    let mut arg = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--reports" {
            arg = it.next().cloned();
        } else if let Some(v) = a.strip_prefix("--reports=") {
            arg = Some(v.to_string());
        }
    }
    // 상대 경로는 CLI의 작업 폴더(사용자 저장소)에 파일을 만들게 되므로 무시하고 다음 순위로
    let usable = |v: &String| v == "off" || v.starts_with('~') || std::path::Path::new(v).is_absolute();
    let p = arg.filter(usable).or_else(|| env("WAITING_ROOM_REPORTS"));
    match p {
        Some(v) if v == "off" => None,
        Some(v) => Some(expand(v)),
        None => {
            let root = env("CLAUDE_CONFIG_DIR").map(expand).unwrap_or_else(|| home().join(".claude"));
            Some(root.join("waiting-room").join("reports.jsonl"))
        }
    }
}

/// 받은 한 줄을 해석한 결과
#[derive(Debug, PartialEq)]
pub enum Msg {
    /// 응답할 요청 (id, method, params)
    Request(Value, String, Value),
    /// 알림·클라이언트 응답 → 무응답
    Silent,
    /// 바로 돌려줄 오류 (id, code, message)
    Error(Value, i64, &'static str),
}

pub fn parse(line: &[u8]) -> Msg {
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
        return Msg::Error(Value::Null, -32700, "Parse error");
    };
    let Value::Object(o) = v else {
        // 배열(batch)은 2025-06-18부터 없음
        return Msg::Error(Value::Null, -32600, "Invalid Request");
    };
    let id = o.get("id").cloned();
    if o.get("jsonrpc").and_then(|x| x.as_str()) != Some("2.0") {
        return Msg::Error(id.unwrap_or(Value::Null), -32600, "Invalid Request");
    }
    let Some(method) = o.get("method") else {
        if id.is_some() && (o.contains_key("result") || o.contains_key("error")) {
            return Msg::Silent;
        }
        return Msg::Error(id.unwrap_or(Value::Null), -32600, "Invalid Request");
    };
    let Some(method) = method.as_str() else {
        return Msg::Error(id.unwrap_or(Value::Null), -32600, "Invalid Request");
    };
    // id는 문자열이나 64비트 정수만 (null·객체·실수·아주 큰 정수는 정밀도를 잃어 응답을 짝지을 수 없음)
    if id.as_ref().is_some_and(|v| !(v.is_string() || v.is_i64() || v.is_u64())) {
        return Msg::Error(Value::Null, -32600, "Invalid Request");
    }
    match id {
        None => Msg::Silent,
        Some(id) => Msg::Request(id, method.to_string(), o.get("params").cloned().unwrap_or(Value::Null)),
    }
}

pub fn ok_result() -> Value {
    json!({"content": [{"type": "text", "text": "ok"}]})
}

/// 응답 한 줄 (compact JSON — 문자열 안 개행은 이스케이프되므로 줄이 깨지지 않는다)
pub fn response(id: Value, r: Result<Value, (i64, String)>) -> Vec<u8> {
    let v = match r {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
    };
    let mut out = serde_json::to_vec(&v).unwrap_or_default();
    out.push(b'\n');
    out
}

/// 기록 줄 공통 머리 — 사이드카(`Server`)와 `wr-hook report`·`run`(`cli.rs`)이 같이 쓴다
pub struct Head<'a> {
    pub key: &'a str,
    pub provider: &'a str,
    pub cwd: &'a str,
    /// 수명 기준 프로세스 (리더가 사라지면 세션을 끝냄). None이면 bye·STALE로만 끝난다
    pub pid: Option<u32>,
    pub ppid: Option<u32>,
    pub term: Option<&'a Value>,
    /// 이 작업을 시킨 세션의 key·sid (v1 선택 필드 — 리더는 모르는 필드를 무시한다)
    pub parent: Option<&'a str>,
}

/// 기록 줄 한 줄 append (`v, ts, type, key, provider, cwd, pid, ppid, wr, term?, parent?` + payload).
/// 2KB 상한(보드 줄을 뒤에서부터 덜어 냄), 열기·한 번 write·닫기. 실패해도 패닉하지 않고 false
pub fn append(path: &Path, typ: &str, h: &Head, payload: Map<String, Value>) -> bool {
    let mut o = Map::new();
    o.insert("v".into(), json!(report::VERSION));
    o.insert("ts".into(), json!(now()));
    o.insert("type".into(), json!(typ));
    o.insert("key".into(), json!(h.key));
    o.insert("provider".into(), json!(h.provider));
    o.insert("cwd".into(), json!(crate::py::take(h.cwd, CWD_MAX)));
    if let Some(p) = h.pid {
        o.insert("pid".into(), json!(p));
    }
    if let Some(p) = h.ppid {
        o.insert("ppid".into(), json!(p));
    }
    o.insert("wr".into(), json!(env!("CARGO_PKG_VERSION")));
    if let Some(t) = h.term {
        o.insert("term".into(), t.clone());
    }
    if let Some(p) = h.parent {
        o.insert("parent".into(), json!(p));
    }
    o.extend(payload);
    let mut line = dumps(&Value::Object(o.clone()));
    // 2KB를 넘으면 보드 줄을 뒤에서부터 덜어 낸다(그래도 넘으면 버림)
    while line.len() >= MAX_RECORD {
        let Some(Value::Array(lines)) = o.get_mut("lines") else { break };
        if lines.len() <= 1 {
            break;
        }
        lines.pop();
        let n = lines.len() as i64;
        if let Some(Value::Array(done)) = o.get_mut("done") {
            done.retain(|i| i.as_i64().is_some_and(|i| i < n));
        }
        line = dumps(&Value::Object(o.clone()));
    }
    if line.len() >= MAX_RECORD {
        debug("record too large, dropped");
        return false;
    }
    line.push(b'\n');
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    // 한 번의 write로 append (O_APPEND: 다른 사이드카·훅의 줄과 섞이지 않음). 부분 쓰기는 재시도하지 않는다
    match std::fs::OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut f) => match f.write(&line) {
            Ok(n) if n < line.len() => {
                debug("partial write");
                false
            }
            Ok(_) => true,
            Err(e) => {
                debug(&format!("write failed: {}", e.kind()));
                false
            }
        },
        Err(e) => {
            debug(&format!("open failed: {}", e.kind()));
            false
        }
    }
}

/// 사이드카 상태 (세션 하나)
pub struct Server {
    path: Option<PathBuf>,
    cwd: String,
    start_ms: u128,
    key: Option<String>,
    provider: &'static str,
    client: Option<(String, String)>,
    proto: String,
    hello_due: bool,
    tokens: f64,
    /// state 전이 전용 버킷
    ttokens: f64,
    refill: Instant,
    /// 마지막으로 기록한 payload (0 status, 1 board)
    last: [Option<Map<String, Value>>; 2],
    pending: [Option<Map<String, Value>>; 2],
    /// 멀티플렉서 이동 정보 (`term.rs` 어댑터 표의 허용 목록 env). Codex는 `env_vars`로 넘겨 줄 때만 있다
    term: Option<Value>,
}

const TYPES: [&str; 2] = ["status", "board"];

impl Server {
    pub fn new(path: Option<PathBuf>, cwd: String) -> Server {
        let start_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        Server {
            path,
            cwd: crate::py::take(&cwd, CWD_MAX).to_string(),
            start_ms,
            key: None,
            provider: "other",
            client: None,
            proto: LATEST.into(),
            hello_due: false,
            tokens: BURST,
            ttokens: T_BURST,
            refill: Instant::now(),
            last: [None, None],
            pending: [None, None],
            term: None,
        }
    }

    /// 실제 환경: `CLAUDE_PROJECT_DIR`(Claude Code가 넣어 줌) > 프로세스 cwd
    pub fn from_env(args: &[String]) -> Server {
        let cwd = env("CLAUDE_PROJECT_DIR")
            .or_else(|| std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned()))
            .unwrap_or_default();
        let mut s = Server::new(reports_path(args), cwd);
        s.term = crate::term::from_env(env);
        s
    }

    fn key(&mut self) -> String {
        if let Some(k) = &self.key {
            return k.clone();
        }
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(self.start_ms);
        let k = format!(
            "{}-{}-{}-{:08x}",
            self.provider,
            std::process::id(),
            self.start_ms,
            h.finish() as u32
        );
        self.key = Some(k.clone());
        k
    }

    /// 한 줄 기록 (실패해도 조용히)
    fn write(&mut self, typ: &str, payload: Map<String, Value>) {
        let Some(path) = self.path.clone() else { return };
        let key = self.key();
        #[cfg(unix)]
        let ppid = Some(std::os::unix::process::parent_id());
        #[cfg(not(unix))]
        let ppid = None;
        let head = Head {
            key: &key,
            provider: self.provider,
            cwd: &self.cwd,
            pid: Some(std::process::id()),
            ppid,
            term: self.term.as_ref(),
            parent: None,
        };
        append(&path, typ, &head, payload);
    }

    fn hello(&mut self) {
        if self.key.is_some() {
            return;
        }
        let mut p = Map::new();
        if let Some((name, version)) = &self.client {
            p.insert("client".into(), json!({"name": name, "version": version}));
        }
        p.insert("proto".into(), json!(self.proto));
        self.write("hello", p);
    }

    /// initialize 응답을 내보낸 뒤 부른다
    pub fn after_response(&mut self) {
        if self.hello_due {
            self.hello_due = false;
            self.hello();
        }
    }

    fn refill(&mut self) {
        let t = Instant::now();
        let dt = t.duration_since(self.refill).as_secs_f64();
        self.tokens = (self.tokens + dt * RATE).min(BURST);
        self.ttokens = (self.ttokens + dt * T_RATE).min(T_BURST);
        self.refill = t;
    }

    /// 보고 하나 (속도 제한·같은 내용 생략·state 전이 즉시)
    fn submit(&mut self, i: usize, m: Map<String, Value>) {
        self.flush_due();
        if self.last[i].as_ref() == Some(&m) {
            self.pending[i] = None;
            return;
        }
        // 직전에 받아 둔 status(보류분이 있으면 그것)와 state가 다르면 전이
        let prev = self.pending[0].as_ref().or(self.last[0].as_ref());
        let transition = i == 0 && prev.and_then(|l| l.get("state")) != m.get("state") && self.ttokens >= 1.0;
        // 끝(done) 직전의 마지막 보드는 보류돼 있기 쉽다 → done보다 먼저 기록(신호로 끝나도 남게)
        if i == 0 && m.get("state").and_then(|v| v.as_str()) == Some("done") {
            if let Some(b) = self.pending[1].take() {
                self.write(TYPES[1], b.clone());
                self.last[1] = Some(b);
            }
        }
        if transition || self.tokens >= 1.0 {
            if transition {
                self.ttokens -= 1.0;
            } else {
                self.tokens -= 1.0;
            }
            self.pending[i] = None;
            self.write(TYPES[i], m.clone());
            self.last[i] = Some(m);
        } else {
            self.pending[i] = Some(m);
        }
    }

    /// 토큰이 찬 보류분 기록
    pub fn flush_due(&mut self) {
        self.refill();
        for (i, typ) in TYPES.iter().enumerate() {
            if self.tokens < 1.0 {
                break;
            }
            if let Some(m) = self.pending[i].take() {
                self.tokens -= 1.0;
                self.write(typ, m.clone());
                self.last[i] = Some(m);
            }
        }
    }

    /// 다음 보류분을 쓸 수 있을 때까지 (보류가 없으면 None)
    pub fn next_flush(&self) -> Option<Duration> {
        if self.pending.iter().all(|p| p.is_none()) {
            return None;
        }
        let wait = ((1.0 - self.tokens).max(0.0) / RATE).max(0.01);
        Some(Duration::from_secs_f64(wait))
    }

    /// stdin EOF: 보류분을 모두 기록하고 bye
    pub fn finish(&mut self) {
        for (i, typ) in TYPES.iter().enumerate() {
            if let Some(m) = self.pending[i].take() {
                self.write(typ, m);
            }
        }
        if self.key.is_some() {
            self.write("bye", Map::new());
        }
    }

    pub fn dispatch(&mut self, method: &str, params: &Value) -> Result<Value, (i64, String)> {
        match method {
            "initialize" => {
                let want = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("");
                self.proto = PROTOCOLS.iter().find(|p| **p == want).unwrap_or(&LATEST).to_string();
                if self.key.is_none() {
                    let ci = params.get("clientInfo");
                    let s = |k: &str| report::clean(ci.and_then(|c| c.get(k)).and_then(|v| v.as_str()).unwrap_or(""), 64);
                    let (name, version) = (s("name"), s("version"));
                    self.provider = provider_of(&name);
                    if !name.is_empty() {
                        self.client = Some((name, version));
                    }
                    self.hello_due = true;
                }
                Ok(json!({
                    "protocolVersion": self.proto,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {"name": "waitscape", "title": "Waitscape", "version": env!("CARGO_PKG_VERSION")},
                    "instructions": INSTRUCTIONS
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tools()})),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let empty = json!({});
                let args = params.get("arguments").filter(|a| a.is_object()).unwrap_or(&empty);
                let (i, r) = match name {
                    "waitscape_status" => (0, status_of(args)),
                    "waitscape_board" => (1, board_of(args)),
                    _ => return Err((-32602, format!("Unknown tool: {}", report::clean(name, 64)))),
                };
                match r {
                    Err(msg) => Ok(json!({"content": [{"type": "text", "text": msg}], "isError": true})),
                    Ok(m) => {
                        self.hello();
                        self.submit(i, m);
                        Ok(ok_result())
                    }
                }
            }
            _ => Err((-32601, "Method not found".into())),
        }
    }

    /// 한 줄 처리 → 응답 줄 (없으면 None). 요청마다 패닉을 잡는다: tools/call은 `ok`, 그 밖은 -32603
    pub fn handle(&mut self, line: &[u8]) -> Option<Vec<u8>> {
        match parse(line) {
            Msg::Silent => None,
            Msg::Error(id, code, msg) => Some(response(id, Err((code, msg.into())))),
            Msg::Request(id, method, params) => {
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.dispatch(&method, &params)));
                let r = r.unwrap_or_else(|_| {
                    debug("panic in handler");
                    if method == "tools/call" {
                        Ok(ok_result())
                    } else {
                        Err((-32603, "Internal error".into()))
                    }
                });
                Some(response(id, r))
            }
        }
    }
}

enum Input {
    Line(Vec<u8>),
    TooLong,
    Eof,
}

/// stdin을 줄 단위로 읽는 스레드 (한 줄 1MB 상한, 끝의 `\r` 제거)
fn reader(tx: mpsc::Sender<Input>) {
    let mut r = std::io::stdin().lock();
    let mut buf: Vec<u8> = Vec::new();
    let mut too_long = false;
    loop {
        let (done, used, eof) = match r.fill_buf() {
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => (false, 0, true),
            Ok([]) => (false, 0, true),
            Ok(b) => match b.iter().position(|&c| c == b'\n') {
                Some(i) => {
                    if !too_long {
                        buf.extend_from_slice(&b[..i]);
                    }
                    (true, i + 1, false)
                }
                None => {
                    if !too_long {
                        buf.extend_from_slice(b);
                    }
                    (false, b.len(), false)
                }
            },
        };
        r.consume(used);
        if buf.len() > MAX_LINE {
            too_long = true;
            buf = Vec::new();
        }
        if done || (eof && (!buf.is_empty() || too_long)) {
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
            let msg = if too_long {
                Input::TooLong
            } else {
                Input::Line(std::mem::take(&mut buf))
            };
            too_long = false;
            if tx.send(msg).is_err() {
                return;
            }
        }
        if eof {
            tx.send(Input::Eof).ok();
            return;
        }
    }
}

fn emit(out: &mut std::io::StdoutLock, bytes: &[u8]) -> bool {
    out.write_all(bytes).and_then(|_| out.flush()).is_ok()
}

/// 종료 신호(SIGTERM·SIGINT·SIGHUP)를 받았나 — 신호 처리기는 이 플래그만 세우고, 루프가 보류분을 쓰고 끝낸다
static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 신호 확인 주기
const STOP_POLL: Duration = Duration::from_millis(200);

/// unix: 의존성 없이 `signal()` FFI. Windows는 생략 — CLI가 MCP 서버를 끝낼 때 쓰는 TerminateProcess는 잡을 수 없고,
/// Ctrl 이벤트는 콘솔을 공유할 때만 오므로(파이프로 띄운 사이드카에는 보통 없음) 처리기를 둬도 얻는 게 없다.
/// 대신 done 직전 보류 보드를 먼저 쓰고(위 `submit`), stdin EOF 경로에서 보류분을 비운다.
#[cfg(unix)]
fn on_signals() {
    extern "C" fn on_sig(_: i32) {
        STOP.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    extern "C" {
        fn signal(sig: i32, handler: usize) -> usize;
    }
    // SIGHUP 1, SIGINT 2, SIGTERM 15 (macOS·Linux 같음)
    for sig in [1, 2, 15] {
        // SAFETY: 처리기는 원자 변수 하나만 바꾼다(async-signal-safe)
        unsafe {
            signal(sig, on_sig as extern "C" fn(i32) as usize);
        }
    }
}

#[cfg(not(unix))]
fn on_signals() {}

/// `wr-hook mcp` 진입점
pub fn serve(args: &[String]) {
    let mut srv = Server::from_env(args);
    on_signals();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || reader(tx));
    let mut out = std::io::stdout().lock();
    loop {
        if STOP.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        let wait = srv.next_flush().map_or(STOP_POLL, |d| d.min(STOP_POLL));
        let msg = match rx.recv_timeout(wait) {
            Ok(m) => m,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                srv.flush_due();
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Input::Eof,
        };
        match msg {
            Input::Eof => break,
            Input::TooLong => {
                if !emit(&mut out, &response(Value::Null, Err((-32600, "Request too large".into())))) {
                    break;
                }
            }
            Input::Line(l) => {
                if l.iter().all(|c| c.is_ascii_whitespace()) {
                    continue;
                }
                if let Some(resp) = srv.handle(&l) {
                    if !emit(&mut out, &resp) {
                        break;
                    }
                }
                srv.after_response();
            }
        }
    }
    srv.finish();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("wr-mcp-unit-{tag}-{}-{t}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d.join("reports.jsonl")
    }

    fn lines(p: &PathBuf) -> Vec<Value> {
        std::fs::read_to_string(p)
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn call(s: &mut Server, id: i64, name: &str, args: Value) -> Value {
        let req = json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": name, "arguments": args}});
        let out = s.handle(req.to_string().as_bytes()).unwrap();
        serde_json::from_slice(&out).unwrap()
    }

    #[test]
    fn parse_rules() {
        assert_eq!(parse(b"{"), Msg::Error(Value::Null, -32700, "Parse error"));
        assert_eq!(parse(b"[]"), Msg::Error(Value::Null, -32600, "Invalid Request"));
        assert_eq!(
            parse(br#"{"jsonrpc":"1.0","id":3,"method":"ping"}"#),
            Msg::Error(json!(3), -32600, "Invalid Request")
        );
        assert_eq!(parse(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), Msg::Silent);
        assert_eq!(parse(br#"{"jsonrpc":"2.0","id":"x","result":{}}"#), Msg::Silent);
        assert_eq!(
            parse(br#"{"jsonrpc":"2.0","id":1,"method":5}"#),
            Msg::Error(json!(1), -32600, "Invalid Request")
        );
        assert_eq!(parse(b"\xff\xfe"), Msg::Error(Value::Null, -32700, "Parse error"));
        // id: 문자열·64비트 정수만
        for bad in [r#"null"#, r#"{"a":1}"#, "1.5", "12345678901234567890123"] {
            let line = format!(r#"{{"jsonrpc":"2.0","id":{bad},"method":"ping"}}"#);
            assert_eq!(parse(line.as_bytes()), Msg::Error(Value::Null, -32600, "Invalid Request"), "{bad}");
        }
        assert!(matches!(
            parse(br#"{"jsonrpc":"2.0","id":18446744073709551615,"method":"ping"}"#),
            Msg::Request(..)
        ));
    }

    /// T6: 연속 board 20회 → 버킷이 넘쳐도 마지막 상태는 EOF 때 반드시 기록된다. 같은 내용 반복은 생략
    #[test]
    fn coalesce_keeps_last_state() {
        let p = tmp("burst");
        let mut s = Server::new(Some(p.clone()), "/w".into());
        for i in 0..20 {
            let r = call(&mut s, i, "waitscape_board", json!({"lines": [format!("단계 {i}")], "done": []}));
            assert_eq!(r["result"]["content"][0]["text"], "ok");
        }
        let before = lines(&p);
        assert!(before.len() < 20, "버킷 버스트만큼만 바로 기록");
        s.finish();
        let all = lines(&p);
        let boards: Vec<&Value> = all.iter().filter(|l| l["type"] == "board").collect();
        assert_eq!(boards.last().unwrap()["lines"], json!(["단계 19"]));
        assert_eq!(all.last().unwrap()["type"], "bye");
        // 같은 내용은 다시 쓰지 않음
        let mut s = Server::new(Some(p.clone()), "/w".into());
        let n = lines(&p).len();
        call(&mut s, 1, "waitscape_status", json!({"state": "working", "title": "a"}));
        call(&mut s, 2, "waitscape_status", json!({"state": "working", "title": "a"}));
        assert_eq!(lines(&p).len(), n + 2, "hello + status 한 번");
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    /// done을 기록할 때 보류된 보드를 먼저 쓴다 (신호로 끝나도 마지막 보드가 남게)
    #[test]
    fn done_flushes_pending_board_first() {
        let p = tmp("done");
        let mut s = Server::new(Some(p.clone()), "/w".into());
        for i in 0..8 {
            call(&mut s, i, "waitscape_board", json!({"lines": [format!("b{i}")]}));
        }
        call(&mut s, 50, "waitscape_status", json!({"state": "done"}));
        let all = lines(&p);
        let n = all.len();
        assert_eq!(all[n - 1]["state"], "done");
        assert_eq!(
            (all[n - 2]["type"].clone(), all[n - 2]["lines"].clone()),
            (json!("board"), json!(["b7"]))
        );
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    /// 상태를 번갈아 바꿔도 전이 버킷(버스트 10)을 넘으면 즉시 기록되지 않는다
    #[test]
    fn alternating_states_are_rate_limited() {
        let p = tmp("alt");
        let mut s = Server::new(Some(p.clone()), "/w".into());
        for i in 0..200 {
            let st = if i % 2 == 0 { "working" } else { "asking" };
            call(&mut s, i, "waitscape_status", json!({"state": st}));
        }
        assert!(lines(&p).len() < 30, "{}", lines(&p).len());
        s.finish();
        let all = lines(&p);
        assert_eq!(all[all.len() - 2]["state"], "asking", "마지막 상태는 남는다");
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    /// state가 바뀌는 status는 버킷이 비어도 즉시 기록
    #[test]
    fn transitions_bypass_bucket() {
        let p = tmp("trans");
        let mut s = Server::new(Some(p.clone()), "/w".into());
        for i in 0..10 {
            call(&mut s, i, "waitscape_status", json!({"state": "working", "title": format!("t{i}")}));
        }
        call(&mut s, 99, "waitscape_status", json!({"state": "asking", "title": "질문"}));
        let last = lines(&p).pop().unwrap();
        assert_eq!((last["state"].clone(), last["title"].clone()), (json!("asking"), json!("질문")));
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    #[test]
    fn record_lines_are_self_contained_and_small() {
        let p = tmp("rec");
        let mut s = Server::new(Some(p.clone()), "/Users/alex/dev/shop".into());
        s.dispatch(
            "initialize",
            &json!({"protocolVersion": "2025-06-18", "clientInfo": {"name": "codex-mcp-client", "version": "0.9"}}),
        )
        .unwrap();
        s.after_response();
        call(
            &mut s,
            1,
            "waitscape_board",
            json!({"lines": ["a".repeat(500), "b", "c", "d"], "done": [0, 3]}),
        );
        s.finish();
        let all = lines(&p);
        assert_eq!(
            all.iter().map(|l| l["type"].as_str().unwrap()).collect::<Vec<_>>(),
            ["hello", "board", "bye"]
        );
        for l in &all {
            for k in ["v", "ts", "type", "key", "provider", "cwd", "pid", "wr"] {
                assert!(l.get(k).is_some(), "{k} 없음: {l}");
            }
            assert_eq!(l["provider"], "codex");
            assert!(l["key"].as_str().unwrap().starts_with("codex-"));
        }
        assert_eq!(all[0]["client"], json!({"name": "codex-mcp-client", "version": "0.9"}));
        assert_eq!(all[0]["proto"], "2025-06-18");
        assert_eq!(all[1]["lines"][0].as_str().unwrap().chars().count(), 32);
        assert!(std::fs::read(&p).unwrap().split(|&b| b == b'\n').all(|l| l.len() < MAX_RECORD));
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    #[test]
    fn reports_path_order() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let abs = std::env::temp_dir().join("r.jsonl");
        let abs_s = abs.to_string_lossy().into_owned();
        assert_eq!(reports_path(&a(&["mcp", "--reports", &abs_s])), Some(abs.clone()));
        assert_eq!(reports_path(&a(&["mcp", &format!("--reports={abs_s}")])), Some(abs));
        assert_eq!(reports_path(&a(&["mcp", "--reports", "off"])), None);
        // 상대 경로는 무시 → 다음 순위(여기선 기본 경로)
        assert_ne!(reports_path(&a(&["mcp", "--reports", "r.jsonl"])), Some(PathBuf::from("r.jsonl")));
    }
}

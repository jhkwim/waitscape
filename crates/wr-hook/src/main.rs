//! wr-hook — Claude Code 훅. stdin 이벤트 JSON을 요약해 events.jsonl에 한 줄 추가한다 (hook.py 동등).
//! `wr-hook mcp`면 MCP stdio 서버(보고 사이드카, `mcp.rs`)로 동작한다 — 훅 모드의 `read_to_end`로 들어가지 않는다.
//!
//! - **절대 실패하지 않는다**: 어떤 입력·오류에도 아무것도 출력하지 않고 종료 코드 0.
//!   (UserPromptSubmit 훅의 stdout은 Claude 컨텍스트에 들어가므로 stdout에 쓰지 않는다)
//! - 마스킹: 프롬프트·알림·도구 설명·할 일·에이전트 설명은 **절단 전에** `redact()` (hook.py에는 없던 P0 지적사항)
//! - 출력 형식: hook.py의 `json.dumps(ev, ensure_ascii=False)`와 같은 바이트(키 순서, `", "`·`": "` 구분자)
//! - 경로: `WAITING_ROOM_LOG` > `$CLAUDE_CONFIG_DIR/waiting-room/events.jsonl` > `~/.claude/waiting-room/events.jsonl`
//! - Windows: 기본은 콘솔 서브시스템(부모 콘솔 상속 → 새 창 없음 예상). 깜빡이면 `--features windows-gui`로 빌드.
//! - 의존성: serde_json, regex(마스킹)만. 정규식은 텍스트가 있을 때만 컴파일한다.
//! - 멀티플렉서(Orca·cmux)에서 연 셸이면 `term.mux`(Orca `{kind, surface, path}` · cmux `{kind, workspace, surface}`)를 덧붙인다(`term.rs` 어댑터 표: 허용 목록 env만 읽고 형식 검증).
//! - MCP 보고(`mcp__waitscape__*` PreToolUse): 말풍선용 `icon/text/kind` 대신 정화한 `report`를 기록한다(정확한 sid·aid로 Claude 세션에 붙음).
#![cfg_attr(all(windows, feature = "windows-gui"), windows_subsystem = "windows")]

#[path = "../../wr-core/src/providers/claude/describe.rs"]
mod describe;
#[path = "../../wr-core/src/py.rs"]
mod py;
#[path = "../../wr-core/src/redact.rs"]
mod redact;
#[path = "../../wr-core/src/report.rs"]
mod report;
#[allow(dead_code)] // jump_of(읽을 때 재검증)는 상태 엔진만 쓴다
#[path = "../../wr-core/src/term.rs"]
mod term;

mod mcp;

use describe::{describe, kind_of, short, sval, todos_of};
use py::{get, py_str, truthy};
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::path::PathBuf;

/// 파이썬 json.dumps 기본 구분자(", ", ": ")를 쓰는 포매터
struct PyFormatter;

impl serde_json::ser::Formatter for PyFormatter {
    fn begin_array_value<W: ?Sized + Write>(&mut self, w: &mut W, first: bool) -> std::io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
    fn begin_object_key<W: ?Sized + Write>(&mut self, w: &mut W, first: bool) -> std::io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
    fn begin_object_value<W: ?Sized + Write>(&mut self, w: &mut W) -> std::io::Result<()> {
        w.write_all(b": ")
    }
}

fn dumps(v: &Value) -> Vec<u8> {
    let mut out = Vec::with_capacity(256);
    let mut ser = serde_json::Serializer::with_formatter(&mut out, PyFormatter);
    serde::Serialize::serialize(v, &mut ser).ok();
    out
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn home() -> PathBuf {
    let order: &[&str] = if cfg!(windows) {
        &["USERPROFILE", "HOME"]
    } else {
        &["HOME", "USERPROFILE"]
    };
    order.iter().find_map(|k| env(k)).map(PathBuf::from).unwrap_or_default()
}

fn expand(p: String) -> PathBuf {
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(r) => home().join(r),
        None => PathBuf::from(p),
    }
}

pub fn log_path() -> PathBuf {
    if let Some(p) = env("WAITING_ROOM_LOG") {
        return expand(p);
    }
    let root = env("CLAUDE_CONFIG_DIR").map(expand).unwrap_or_else(|| home().join(".claude"));
    root.join("waiting-room").join("events.jsonl")
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn getd(d: &Value, k: &str, def: Value) -> Value {
    get(d, k).cloned().unwrap_or(def)
}

/// 이벤트 끝에 멀티플렉서 이동 정보를 붙인다 (hook.py와 같은 위치·형식). `get`은 env 조회 — 어댑터 표의 이름으로만 불린다
pub fn with_term(ev: &mut Value, get: impl Fn(&str) -> Option<String>) {
    if let (Some(o), Some(t)) = (ev.as_object_mut(), term::from_env(get)) {
        o.insert("term".into(), t);
    }
}

/// 훅 입력 → 이벤트 한 줄 (기록하지 않을 이벤트면 None)
pub fn summarize(d: &Value, ts: f64) -> Option<Value> {
    if !d.is_object() {
        return None;
    }
    let mut ev = Map::new();
    ev.insert("ts".into(), json!(ts));
    ev.insert("sid".into(), getd(d, "session_id", json!("?")));
    ev.insert("cwd".into(), getd(d, "cwd", json!("")));
    let event = getd(d, "hook_event_name", json!(""));
    let name = event.as_str().unwrap_or("").to_string();
    ev.insert("event".into(), event);
    if let Some(aid) = get(d, "agent_id").filter(|v| truthy(v)) {
        ev.insert("aid".into(), aid.clone());
        ev.insert("atype".into(), getd(d, "agent_type", json!("")));
    }
    let tool = get(d, "tool_name").and_then(|v| v.as_str()).unwrap_or("");
    let empty = json!({});
    let inp = get(d, "tool_input").filter(|v| truthy(v)).unwrap_or(&empty);
    match name.as_str() {
        "PreToolUse"
            if tool.starts_with(report::HOOK_PREFIX)
                && matches!(&tool[report::HOOK_PREFIX.len()..], "waitscape_status" | "waitscape_board") =>
        {
            let (kind, r) = if tool.ends_with("waitscape_status") {
                ("status", report::status_of(inp))
            } else {
                ("board", report::board_of(inp))
            };
            // 인자가 틀린 호출은 사이드카가 isError로 돌려주므로 기록하지 않는다
            let mut m = Map::new();
            m.insert("tool".into(), json!(kind));
            m.extend(r.ok()?);
            ev.insert("report".into(), Value::Object(m));
        }
        "PreToolUse" => {
            let (icon, text) = describe(tool, inp, true);
            ev.insert("icon".into(), json!(icon));
            ev.insert("text".into(), json!(text));
            ev.insert("kind".into(), json!(kind_of(tool)));
            if tool == "TodoWrite" {
                ev.insert("todos".into(), Value::Array(todos_of(inp, true)));
            } else if tool == "Agent" || tool == "Task" {
                ev.insert("agent_desc".into(), json!(short(&sval(get(inp, "description"), true), 50)));
                ev.insert("bg".into(), json!(get(inp, "run_in_background").is_some_and(truthy)));
                let req = get(inp, "subagent_type")
                    .filter(|v| truthy(v))
                    .cloned()
                    .unwrap_or(json!("general-purpose"));
                ev.insert("agent_req".into(), req);
            }
        }
        "PostToolUse" => {
            if tool == "TaskCreate" {
                let resp = get(d, "tool_response").filter(|v| truthy(v)).cloned().unwrap_or(json!({}));
                let task = if resp.is_object() {
                    get(&resp, "task").cloned().unwrap_or(resp.clone())
                } else {
                    json!({})
                };
                if !task.is_object() {
                    return None;
                }
                let id = py_str(get(&task, "id").unwrap_or(&json!("")));
                ev.insert(
                    "task_new".into(),
                    json!({"id": id, "text": short(&sval(get(inp, "subject"), true), 60)}),
                );
            } else if tool == "TaskUpdate" {
                let id = py_str(get(inp, "taskId").unwrap_or(&json!("")));
                let src = get(inp, "activeForm").filter(|v| truthy(v)).or_else(|| get(inp, "subject"));
                ev.insert(
                    "task_upd".into(),
                    json!({"id": id, "status": getd(inp, "status", Value::Null), "text": short(&sval(src, true), 60)}),
                );
            } else {
                return None;
            }
        }
        "UserPromptSubmit" => {
            let p = get(d, "prompt").filter(|v| truthy(v)).map(py_str).unwrap_or_default();
            let p = p.trim_start_matches(py::is_py_space);
            if p.starts_with("<agent-message") || p.starts_with("<task-notification") || p.starts_with("[SYSTEM NOTIFICATION") {
                ev.insert("event".into(), json!("Resume")); // 에이전트 결과 보고: 새 프롬프트가 아님
            } else {
                ev.insert("text".into(), json!(short(&redact::redact(p), 60)));
            }
        }
        "Notification" => {
            ev.insert("text".into(), json!(short(&sval(get(d, "message"), true), 80)));
        }
        _ => {}
    }
    Some(Value::Object(ev))
}

fn run() -> Option<()> {
    let mut buf = Vec::new();
    std::io::stdin().read_to_end(&mut buf).ok()?;
    let d: Value = serde_json::from_slice(&buf).ok()?;
    let mut ev = summarize(&d, now())?;
    with_term(&mut ev, env);
    let mut line = dumps(&ev);
    line.push(b'\n');
    let path = log_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok()?;
    }
    // 한 번의 write로 append (O_APPEND: 작은 쓰기는 다른 훅과 섞이지 않음)
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).ok()?;
    f.write_all(&line).ok()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("wr-hook {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    std::panic::set_hook(Box::new(|_| {}));
    if args.get(1).map(String::as_str) == Some("mcp") {
        mcp::serve(&args[2..]);
        std::process::exit(0);
    }
    let _ = std::panic::catch_unwind(run);
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_formatting_and_masking() {
        let k = ["sk-", "ant-", "api03-", "ZZZZZZZZZZZZZZZZ"].concat();
        let d = json!({"session_id": "s1", "cwd": "/x", "hook_event_name": "UserPromptSubmit", "prompt": format!("  키는 {k} 야")});
        let ev = summarize(&d, 1.5).unwrap();
        let line = String::from_utf8(dumps(&ev)).unwrap();
        assert_eq!(
            line,
            r#"{"ts": 1.5, "sid": "s1", "cwd": "/x", "event": "UserPromptSubmit", "text": "키는 <REDACTED> 야"}"#
        );
    }

    #[test]
    fn events() {
        let d = json!({"session_id": "s", "hook_event_name": "UserPromptSubmit", "prompt": "<task-notification>x"});
        assert_eq!(summarize(&d, 0.0).unwrap()["event"], json!("Resume"));
        let d = json!({"session_id": "s", "hook_event_name": "PostToolUse", "tool_name": "Read"});
        assert!(summarize(&d, 0.0).is_none());
        let d = json!({"session_id": "s", "hook_event_name": "PreToolUse", "tool_name": "Agent", "agent_id": "a1", "agent_type": "Explore",
                       "tool_input": {"description": "조사", "run_in_background": true}});
        let ev = summarize(&d, 0.0).unwrap();
        assert_eq!(
            (ev["aid"].clone(), ev["agent_req"].clone(), ev["bg"].clone(), ev["kind"].clone()),
            (json!("a1"), json!("general-purpose"), json!(true), json!("agent"))
        );
        let d = json!({"session_id": "s", "hook_event_name": "PostToolUse", "tool_name": "TaskCreate", "tool_input": {"subject": "할 일"}, "tool_response": {"task": {"id": 7}}});
        assert_eq!(summarize(&d, 0.0).unwrap()["task_new"], json!({"id": "7", "text": "할 일"}));
        assert!(summarize(&json!([1, 2]), 0.0).is_none());
    }

    /// #37·#40: 멀티플렉서(Orca·cmux) 이동 정보 골든(fixtures/mux/term_cases.json — hook.py와 같은 줄). 허용 목록 밖의 env는 묻지도 않는다
    #[test]
    fn cmux_term_golden() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/mux/term_cases.json");
        let fx: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
        for c in fx["cases"].as_array().unwrap() {
            let asked = std::cell::RefCell::new(vec![]);
            let envs = c["env"].as_object().unwrap();
            let mut ev = summarize(&fx["in"], 0.5).unwrap();
            with_term(&mut ev, |k| {
                asked.borrow_mut().push(k.to_string());
                envs.get(k).and_then(|v| v.as_str()).map(String::from).filter(|v| !v.is_empty())
            });
            let line = String::from_utf8(dumps(&ev)).unwrap();
            assert_eq!(Some(line.as_str()), c["out"].as_str(), "{}", c["env"]);
            assert!(asked.borrow().iter().all(|k| term::env_allow().contains(&k.as_str())));
            for (k, v) in envs {
                if !term::env_allow().contains(&k.as_str()) {
                    assert!(!line.contains(v.as_str().unwrap()), "{k} 값이 기록됨");
                }
            }
        }
    }

    /// T9: MCP 보고 훅 분기 — hook.py가 만든 골든(fixtures/mcp/hook_cases.json)과 바이트 단위로 같다 (ts 고정)
    #[test]
    fn mcp_report_hook_golden() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/mcp/hook_cases.json");
        let fx: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
        for c in fx["cases"].as_array().unwrap() {
            let got = summarize(&c["in"], 0.5).map(|ev| String::from_utf8(dumps(&ev)).unwrap());
            assert_eq!(got.as_deref(), c["out"].as_str(), "{}", c["in"]);
        }
        // 마스킹은 wr-hook만(hook.py는 원래 마스킹하지 않음)
        let k = ["gh", "p_", "aBcDeFgH12345678"].concat();
        let d = json!({"session_id": "s", "hook_event_name": "PreToolUse", "tool_name": "mcp__waitscape__waitscape_status",
                       "tool_input": {"state": "working", "title": format!("토큰 {k}")}});
        assert_eq!(summarize(&d, 0.0).unwrap()["report"]["title"], json!("토큰 <REDACTED>"));
    }
}

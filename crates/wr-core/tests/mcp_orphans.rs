//! 리뷰 PR #35 🔴: 훅이 동작 중이면 Claude 사이드카 보고(고아 보고)를 붙이지 않는다.
//! 붙이면 같은 폴더의 다른 창·지난 턴 보드·서브에이전트 계획이 엉뚱한 세션에 뜬다 (scripts/test_mcp_reports.py에 같은 세 사례).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use wr_core::providers::claude::config::{ClaudeConfig, SourceMode};
use wr_core::providers::mcp::{McpConfig, McpProvider};
use wr_core::{ClaudeProvider, Clock, Engine, EngineConfig, Tz};

const NOW: f64 = 1_800_000_000.0;
const CWD: &str = "/w/shop";

fn tmp(tag: &str) -> PathBuf {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("wr-orphan-{tag}-{}-{t}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write(p: &Path, rows: &[Value]) {
    let s: String = rows.iter().map(|r| format!("{r}\n")).collect();
    std::fs::write(p, s).unwrap();
}

/// 훅 이벤트 + 사이드카 줄 → state의 세션별 report
fn reports(tag: &str, events: &[Value], side: &[Value]) -> Vec<(String, Value)> {
    let d = tmp(tag);
    write(&d.join("events.jsonl"), events);
    write(&d.join("reports.jsonl"), side);
    let cfg = ClaudeConfig {
        root: d.clone(),
        log: d.join("events.jsonl"),
        status: None,
        projects: d.join("projects"),
        settings: d.join("settings.json"),
        credentials: d.join(".credentials.json"),
        source: SourceMode::Hooks,
        poll_on: false,
        v11_fields: false,
        hide_user: vec![],
        hide_builtin: true,
    };
    let mcp = McpConfig {
        path: d.join("reports.jsonl"),
        on: true,
        check_pids: false,
        hide_user: vec![],
        hide_builtin: true,
    };
    let mut e = Engine::new(EngineConfig {
        clock: Clock::Fixed(NOW),
        tz: Tz::Fixed(0),
        home: String::new(),
        emit_providers: false,
    });
    e.add(Box::new(ClaudeProvider::new(cfg)));
    e.add(Box::new(McpProvider::new(mcp)));
    let st = e.state_at(NOW);
    std::fs::remove_dir_all(&d).ok();
    st.sessions.into_iter().map(|s| (s.sid, s.report.unwrap_or(Value::Null))).collect()
}

fn ev(sid: &str, ago: f64, event: &str, extra: Value) -> Value {
    let mut v = json!({"ts": NOW - ago, "sid": sid, "cwd": CWD, "event": event});
    v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    v
}

fn side(ago: f64, typ: &str, extra: Value) -> Value {
    let mut v = json!({"v": 1, "ts": NOW - ago, "type": typ, "key": "claude-1-1-0000000a", "provider": "claude", "cwd": CWD});
    v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    v
}

fn get<'a>(r: &'a [(String, Value)], sid: &str) -> &'a Value {
    &r.iter().find(|(s, _)| s == sid).unwrap().1
}

#[test]
fn two_windows_same_folder() {
    let st = json!({"report": {"tool": "status", "state": "working", "title": "A의 작업"}});
    let r = reports(
        "two",
        &[
            ev("A", 100.0, "UserPromptSubmit", json!({"text": "a"})),
            ev("B", 100.0, "UserPromptSubmit", json!({"text": "b"})),
            ev("A", 90.0, "PreToolUse", st),
        ],
        &[side(90.0, "status", json!({"state": "working", "title": "A의 작업"}))],
    );
    assert_eq!(get(&r, "A")["title"], json!("A의 작업"));
    assert_eq!(get(&r, "B"), &Value::Null, "A 사이드카 보고가 B에 붙으면 안 됨");
}

#[test]
fn cleared_board_stays_cleared() {
    let r = reports(
        "stale",
        &[
            ev("A", 300.0, "UserPromptSubmit", json!({"text": "1"})),
            ev(
                "A",
                290.0,
                "PreToolUse",
                json!({"report": {"tool": "board", "lines": ["옛 계획"], "done": []}}),
            ),
            ev("A", 100.0, "UserPromptSubmit", json!({"text": "2"})),
        ],
        &[side(290.0, "board", json!({"lines": ["옛 계획"], "done": []}))],
    );
    assert_eq!(get(&r, "A"), &Value::Null, "새 프롬프트에서 비운 보드가 되살아나면 안 됨");
}

#[test]
fn subagent_board_not_on_main() {
    let r = reports(
        "sub",
        &[
            ev("A", 100.0, "UserPromptSubmit", json!({"text": "a"})),
            ev("A", 95.0, "SubagentStart", json!({"aid": "x", "atype": "Explore"})),
            ev(
                "A",
                90.0,
                "PreToolUse",
                json!({"aid": "x", "atype": "Explore", "report": {"tool": "board", "lines": ["서브에이전트 계획"], "done": []}}),
            ),
        ],
        &[side(90.0, "board", json!({"lines": ["서브에이전트 계획"], "done": []}))],
    );
    assert_eq!(get(&r, "A"), &Value::Null, "서브에이전트 계획이 메인 보드에 뜨면 안 됨");
}

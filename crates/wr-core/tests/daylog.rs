//! 일지 수집 경로(엔진 → 프로바이더 → DayLog): 훅이 없는 트랜스크립트 전용 세션도 턴 완료·질문 대기가 쌓이는지,
//! 일지를 끈 엔진은 아무것도 쓰지 않는지.

use serde_json::json;
use std::path::{Path, PathBuf};
use wr_core::providers::claude::config::{ClaudeConfig, SourceMode};
use wr_core::{ClaudeProvider, Clock, Engine, EngineConfig, Tz};

fn temp(tag: &str) -> PathBuf {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("wr-daylog-it-{tag}-{}-{t}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn iso(ts: f64) -> String {
    chrono::DateTime::from_timestamp(ts as i64, 0)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S.000Z")
        .to_string()
}

fn engine(work: &Path, now: f64, source: SourceMode) -> Engine {
    let cfg = ClaudeConfig {
        root: work.to_path_buf(),
        log: work.join("events.jsonl"),
        status: None,
        projects: work.join("projects"),
        settings: work.join("settings.json"),
        credentials: work.join(".credentials.json"),
        source,
        poll_on: false,
        v11_fields: true,
        hide_user: vec![],
        hide_builtin: true,
    };
    let mut e = Engine::new(EngineConfig {
        clock: Clock::Fixed(now),
        tz: Tz::Fixed(9 * 3600),
        home: "/Users/alex".into(),
        emit_providers: true,
    });
    e.add(Box::new(ClaudeProvider::new(cfg)));
    e
}

#[test]
fn transcript_only_sessions_feed_turns_and_waits() {
    let work = temp("tonly");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as f64;
    let t = now - 1200.0;
    let cwd = "/Users/alex/dev/plan-app";
    let dir = work.join("projects").join("-Users-alex-dev-plan-app");
    std::fs::create_dir_all(&dir).unwrap();
    let row = |ts: f64, typ: &str, msg: serde_json::Value| {
        json!({"type": typ, "timestamp": iso(ts), "sessionId": "tx1", "cwd": cwd, "isSidechain": false, "message": msg}).to_string()
    };
    let lines = [
        row(t, "user", json!({"role": "user", "content": "배포 계획 세워줘"})),
        row(
            t + 5.0,
            "assistant",
            json!({"id": "m1", "role": "assistant", "content": [
            {"type": "tool_use", "id": "q1", "name": "AskUserQuestion", "input": {"questions": []}}]}),
        ),
        row(
            t + 95.0,
            "user",
            json!({"role": "user", "content": [{"type": "tool_result", "tool_use_id": "q1", "content": "A"}]}),
        ),
        row(
            t + 700.0,
            "assistant",
            json!({"id": "m2", "role": "assistant", "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "계획을 정리했어요."}]}),
        ),
    ];
    std::fs::write(dir.join("tx1.jsonl"), lines.join("\n") + "\n").unwrap();
    let mut e = engine(&work, now, SourceMode::Transcript);
    e.set_daylog(Some(work.join("daylog")));
    // 새벽 4시 경계 근처에서 돌아도 흔들리지 않게 턴이 끝난 날을 직접 묻는다
    let day = wr_core::daylog::day_of(Tz::Fixed(9 * 3600), t + 700.0);
    let r = e.daylog_at(&day, now);
    assert_eq!(r.status, 200);
    let b = r.body;
    assert_eq!(b["done"], json!(1), "{b}");
    assert_eq!(b["big"][0]["job"], json!("배포 계획 세워줘"));
    assert_eq!(b["big"][0]["run"], json!(700.0));
    assert_eq!(
        (b["wait"]["n"].clone(), b["wait"]["avg"].clone()),
        (json!(1), json!(90.0)),
        "AskUserQuestion → 답"
    );
    assert_eq!(b["workers"][0]["project"], json!("plan-app"));
    // 같은 상태를 여러 번 만들어도 중복으로 쌓이지 않는다
    for k in 1..4 {
        e.state_at(now + k as f64);
    }
    assert_eq!(e.daylog_at(&day, now + 5.0).body["done"], json!(1));
    std::fs::remove_dir_all(work).ok();
}

#[test]
fn engine_without_daylog_writes_nothing() {
    let work = temp("off");
    let now = 1792519200.0;
    let mut e = engine(&work, now, SourceMode::Hooks);
    std::fs::write(
        work.join("events.jsonl"),
        [
            json!({"ts": now - 100.0, "sid": "s", "cwd": "/x/a", "event": "UserPromptSubmit", "text": "hi"}).to_string(),
            json!({"ts": now - 10.0, "sid": "s", "cwd": "/x/a", "event": "Stop"}).to_string(),
        ]
        .join("\n")
            + "\n",
    )
    .unwrap();
    e.state_at(now);
    assert_eq!(e.daylog_at("today", now).status, 404);
    assert_eq!(e.daylog_seen_at("today", now).status, 404);
    assert!(e.daylog_dir().is_none());
    assert!(!work.join("daylog").exists() && !work.join("waiting-room").exists());
    std::fs::remove_dir_all(work).ok();
}

/// 폴더 환경변수: off·0은 끔, 없거나 빈 값이면 기본 위치(빈 값이 현재 폴더가 되지 않게 — server.py와 같음)
#[test]
fn daylog_dir_env() {
    use std::collections::HashMap;
    use wr_core::daylog::dir_from_env;
    let root = Path::new("/tmp/claude-root");
    let env = |v: Option<&str>| {
        let mut m: HashMap<String, String> = HashMap::new();
        m.insert("HOME".into(), "/tmp/home".into());
        if let Some(v) = v {
            m.insert("WAITING_ROOM_DAYLOG".into(), v.into());
        }
        m
    };
    for off in ["off", "0"] {
        assert_eq!(dir_from_env(&env(Some(off)), root), None, "{off:?}");
    }
    for unset in [None, Some("")] {
        assert_eq!(
            dir_from_env(&env(unset), root),
            Some(root.join("waiting-room").join("daylog")),
            "{unset:?}"
        );
    }
    assert_eq!(dir_from_env(&env(Some("/x/dl")), root), Some(PathBuf::from("/x/dl")));
}

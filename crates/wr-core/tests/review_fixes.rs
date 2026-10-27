//! PR #1 교차 리뷰 반영 회귀 테스트 (F2 F3 F4 F5 F6). 모든 시계는 주입(Clock::Fixed)이고 파일 mtime은 직접 지정한다.
//! 시각: now = 2026-10-21T03:00+09:00(1792519200), 오늘 시작(KST) = 1792508400.

include!("support/runner.rs");

use std::io::Write;
use std::time::{Duration, UNIX_EPOCH};

const NOW: f64 = 1_792_519_200.0;
const DAY: f64 = 1_792_508_400.0;

fn set_tz() {
    std::env::set_var("TZ", "Asia/Seoul");
}

fn iso(t: f64) -> String {
    chrono::DateTime::from_timestamp(t as i64, 0)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S.000Z")
        .to_string()
}

fn user(sid: &str, t: f64, content: Value, side: bool) -> String {
    json!({"type":"user","timestamp":iso(t),"sessionId":sid,"cwd":"/Users/alex/dev/demo","uuid":format!("{sid}-u{t}"),"isSidechain":side,
           "message":{"role":"user","content":content}})
    .to_string()
}

fn asst(sid: &str, t: f64, content: Value, stop: &str, inp: u64, side: bool) -> String {
    json!({"type":"assistant","timestamp":iso(t),"sessionId":sid,"cwd":"/Users/alex/dev/demo","uuid":format!("{sid}-a{t}"),"isSidechain":side,
           "message":{"role":"assistant","id":format!("{sid}-m{t}"),"content":content,"stop_reason":stop,
                      "usage":{"input_tokens":inp,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":10}}})
    .to_string()
}

fn text(s: &str) -> Value {
    json!([{"type":"text","text":s}])
}

/// 파일을 쓰고 mtime을 지정
fn write(path: &Path, lines: &[String], mtime: f64) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut f = std::fs::File::create(path).unwrap();
    for l in lines {
        writeln!(f, "{l}").unwrap();
    }
    f.set_modified(UNIX_EPOCH + Duration::from_secs_f64(mtime)).unwrap();
}

fn proj(work: &Path, sid: &str) -> PathBuf {
    work.join("projects/-Users-alex-dev-demo").join(format!("{sid}.jsonl"))
}

fn state(work: &Path, source: SourceMode, now: f64) -> Value {
    let mut e = engine(work, "/Users/alex", now, source);
    serde_json::to_value(e.state_at(now)).unwrap()
}

fn sids(st: &Value) -> Vec<String> {
    st["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["sid"].as_str().unwrap().to_string())
        .collect()
}

/// 한 턴짜리 완료 세션 (프롬프트 t0, 끝 t0+30, 토큰 inp+10)
fn done_session(sid: &str, t0: f64, inp: u64) -> Vec<String> {
    vec![
        user(sid, t0, json!("작업해줘"), false),
        asst(sid, t0 + 30.0, text("끝"), "end_turn", inp, false),
    ]
}

/// F2: 지난 턴에 끝난 서브에이전트의 오늘 토큰이 다음 프롬프트 뒤에도 today_tokens에 남아야 한다
#[test]
fn f2_prev_turn_subagent_tokens_stay_in_today() {
    set_tz();
    let work = temp_dir("f2");
    let sid = "f2s";
    let t1 = DAY + 600.0;
    let t2 = DAY + 3600.0;
    let main = vec![
        user(sid, t1, json!("조사해줘"), false),
        asst(
            sid,
            t1 + 10.0,
            json!([{"type":"tool_use","id":"a1","name":"Agent","input":{"description":"조사","subagent_type":"Explore","prompt":"x","run_in_background":true}}]),
            "tool_use",
            100,
            false,
        ),
        user(
            sid,
            t1 + 10.5,
            json!([{"type":"tool_result","tool_use_id":"a1","content":"Async agent launched successfully.\nagentId: ag1 (internal ID)"}]),
            false,
        ),
        asst(sid, t1 + 20.0, text("보냈어요"), "end_turn", 100, false),
        user(sid, t2, json!("다음 일"), false),
        asst(sid, t2 + 5.0, text("네"), "end_turn", 100, false),
    ];
    write(&proj(&work, sid), &main, NOW - 100.0);
    let sub = work.join("projects/-Users-alex-dev-demo").join(sid).join("subagents");
    write(
        &sub.join("agent-ag1.jsonl"),
        &[
            user(sid, t1 + 11.0, json!("조사"), true),
            asst(sid, t1 + 200.0, text("끝"), "end_turn", 20_000, true),
        ],
        NOW - 100.0,
    );
    std::fs::write(
        sub.join("agent-ag1.meta.json"),
        r#"{"agentType":"Explore","description":"조사","toolUseId":"a1"}"#,
    )
    .unwrap();
    let st = state(&work, SourceMode::Transcript, NOW);
    let total = st["today_tokens"]["total"].as_u64().unwrap();
    assert!(total >= 20_010, "서브에이전트 토큰 누락: {total}");
    // 메인 두 번 응답(100+10 ×3: 도구·보냄·네) + 서브에이전트 20010
    assert_eq!(total, 3 * 110 + 20_010, "total={total}");
    std::fs::remove_dir_all(&work).ok();
}

/// F5: 오늘 끝났지만 STALE(6시간)이 지난 세션도 오늘 집계에는 들어가고, 목록에는 없다
#[test]
fn f5_stale_session_still_counts_today() {
    set_tz();
    let work = temp_dir("f5");
    let t0 = DAY + 600.0; // 00:10 KST, now(03:00)와 2시간 50분 차이 → STALE 안
    let now = DAY + 6.0 * 3600.0 + 1800.0; // 06:30 → t0+30에서 6시간 20분 지남
    write(&proj(&work, "f5s"), &done_session("f5s", t0, 500), t0 + 30.0);
    let st = state(&work, SourceMode::Transcript, now);
    assert!(sids(&st).is_empty(), "목록에는 없어야 함: {:?}", sids(&st));
    assert_eq!(st["done_today"], json!(1));
    assert_eq!(st["today_tokens"]["total"], json!(510));
    std::fs::remove_dir_all(&work).ok();
}

fn hook_ev(ts: f64, sid: &str, ev: &str) -> String {
    json!({"ts": ts, "sid": sid, "event": ev, "cwd": "/Users/alex/dev/demo"}).to_string()
}

fn write_events(work: &Path, lines: &[String]) {
    let mut s = lines.join("\n");
    s.push('\n');
    std::fs::write(work.join("events.jsonl"), s).unwrap();
}

/// F3: Auto 모드에서 어제의 훅 기록만 남은 세션이 트랜스크립트로 폴백되면 오늘 집계에 들어가야 한다
#[test]
fn f3_auto_old_hook_history_falls_back_into_today() {
    set_tz();
    let work = temp_dir("f3");
    write_events(
        &work,
        &[
            hook_ev(DAY - 7200.0, "f3s", "UserPromptSubmit"),
            hook_ev(DAY - 7100.0, "f3s", "Stop"),
        ],
    );
    let t0 = DAY + 600.0;
    write(&proj(&work, "f3s"), &done_session("f3s", t0, 500), t0 + 30.0);
    let st = state(&work, SourceMode::Auto, NOW);
    assert_eq!(st["done_today"], json!(1), "{st}");
    assert_eq!(st["today_tokens"]["total"], json!(510));
    std::fs::remove_dir_all(&work).ok();
}

/// F4: SessionEnd 뒤에 같은 세션이 재개되면(훅 없이 트랜스크립트만 계속 늘어남) 목록에서 사라지면 안 된다
#[test]
fn f4_resumed_session_after_session_end_is_listed() {
    set_tz();
    let work = temp_dir("f4");
    let t0 = DAY + 600.0;
    write_events(
        &work,
        &[
            hook_ev(t0, "f4s", "UserPromptSubmit"),
            hook_ev(t0 + 30.0, "f4s", "Stop"),
            hook_ev(t0 + 40.0, "f4s", "SessionEnd"),
        ],
    );
    // 재개: SessionEnd(t0+40) 뒤 15분 지나 새 프롬프트 + 아직 진행 중
    let t1 = t0 + 40.0 + 900.0;
    let mut lines = done_session("f4s", t0, 500);
    lines.push(user("f4s", t1, json!("다시 이어서"), false));
    write(&proj(&work, "f4s"), &lines, t1);
    let now = t1 + 60.0;
    let st = state(&work, SourceMode::Auto, now);
    assert_eq!(sids(&st), vec!["f4s"], "재개된 세션이 사라짐");
    assert_eq!(st["sessions"][0]["source"], json!("transcript"));
    assert_eq!(st["sessions"][0]["status"], json!("working"));

    // 대조: 정말 끝난 세션(트랜스크립트가 SessionEnd 이후 늘지 않음)은 계속 숨겨진다
    let work2 = temp_dir("f4b");
    write_events(
        &work2,
        &[
            hook_ev(t0, "f4s", "UserPromptSubmit"),
            hook_ev(t0 + 30.0, "f4s", "Stop"),
            hook_ev(t0 + 40.0, "f4s", "SessionEnd"),
        ],
    );
    write(&proj(&work2, "f4s"), &done_session("f4s", t0, 500), t0 + 30.0);
    let st2 = state(&work2, SourceMode::Auto, t0 + 3000.0);
    assert!(sids(&st2).is_empty(), "끝난 세션이 보임: {:?}", sids(&st2));
    std::fs::remove_dir_all(&work).ok();
    std::fs::remove_dir_all(&work2).ok();
}

/// F6: 전체 다시 보기 판단은 주입된 시계(now)로 한다 (벽시계 Instant가 아님)
#[test]
fn f6_discovery_rescan_uses_injected_clock() {
    use wr_core::providers::claude::tonly::Discovery;
    let work = temp_dir("f6");
    let stale_at = NOW - 7.0 * 3600.0; // STALE 밖
    let p = proj(&work, "f6s");
    write(&p, &done_session("f6s", NOW - 20000.0, 1), stale_at);
    let projects = work.join("projects");
    let mut d = Discovery::default();
    assert!(d.find(&projects, NOW, DAY, &wr_core::hide::HideRules::default()).is_empty());
    // 폴더 mtime은 그대로 두고 파일 mtime만 최근으로 (증분 경로로는 못 찾는 변화)
    std::fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(UNIX_EPOCH + Duration::from_secs_f64(NOW - 10.0))
        .unwrap();
    // 주입 시계로 31초 뒤 → 전체 다시 보기가 돌아야 한다
    let found = d.find(&projects, NOW + 31.0, DAY, &wr_core::hide::HideRules::default());
    assert_eq!(found.len(), 1, "주입 시계 31초 경과인데 전체 재탐색이 안 됨");
    std::fs::remove_dir_all(&work).ok();
}

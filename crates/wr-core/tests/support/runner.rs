// fixture 러너 (scripts/snapshot.py의 Rust 판). examples/snapshot.rs와 tests/parity.rs가 include!로 같이 쓴다.
// - fixtures/input을 임시 폴더로 복사하면서 @@FAKE_*@@ 자리표시자를 가짜 시크릿(조각을 이어 붙인 것)으로 치환
// - 시계 고정(fixture.json now, 케이스별 now), 홈 고정, 시간대는 TZ 환경변수(호출자가 설정)
// - cases.json 순서대로 state/trace/append/truncate/daylog/daylog_seen 실행 (일지는 임시 폴더 daylog/에 쌓임)
// - MCP 보고 리더는 임시 폴더 reports.jsonl (snapshot.py의 WAITING_ROOM_REPORTS와 같음)

#[allow(unused_imports)]
use serde_json::{json, Value};
#[allow(unused_imports)]
use std::path::{Path, PathBuf};
use wr_core::providers::claude::config::{ClaudeConfig, SourceMode};
use wr_core::providers::mcp::{McpConfig, McpProvider};
use wr_core::{ClaudeProvider, Clock, Engine, EngineConfig, TraceQuery, Tz};

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").canonicalize().unwrap()
}

pub fn load(p: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap()
}

/// fake_secrets.json → [(자리표시자, 원문)]
pub fn fake_secrets(root: &Path) -> Vec<(String, String)> {
    let d = load(&root.join("fixtures/fake_secrets.json"));
    let mut v = vec![];
    for (k, parts) in d.as_object().unwrap() {
        if k.starts_with('$') {
            continue;
        }
        let s: String = parts.as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        v.push((format!("@@FAKE_{k}@@"), s));
    }
    v
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let d = std::env::temp_dir().join(format!("wr-{tag}-{}-{t}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub fn stage(src: &Path, dst: &Path, secrets: &[(String, String)]) {
    for e in std::fs::read_dir(src).unwrap().flatten() {
        let sp = e.path();
        let dp = dst.join(e.file_name());
        if sp.is_dir() {
            std::fs::create_dir_all(&dp).unwrap();
            stage(&sp, &dp, secrets);
        } else {
            let mut raw = std::fs::read(&sp).unwrap();
            for (k, v) in secrets {
                raw = replace_bytes(&raw, k.as_bytes(), v.as_bytes());
            }
            std::fs::write(&dp, raw).unwrap();
        }
    }
}

fn replace_bytes(h: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(h.len());
    let mut i = 0;
    while i < h.len() {
        if h[i..].starts_with(from) {
            out.extend_from_slice(to);
            i += from.len();
        } else {
            out.push(h[i]);
            i += 1;
        }
    }
    out
}

fn engine(work: &Path, home: &str, now: f64, source: SourceMode) -> Engine {
    let cfg = ClaudeConfig {
        root: work.to_path_buf(),
        log: work.join("events.jsonl"),
        status: Some(work.join("statusline.json")),
        projects: work.join("projects"),
        settings: work.join("settings.json"),
        credentials: work.join(".credentials.json"),
        source,
        poll_on: false,
        v11_fields: source != SourceMode::Hooks,
        hide_user: vec![],
        hide_builtin: true,
    };
    let mcp = McpConfig {
        path: work.join("reports.jsonl"),
        on: true,
        check_pids: true,
        hide_user: vec![],
        hide_builtin: true,
    };
    let mut e = Engine::new(EngineConfig { clock: Clock::Fixed(now), tz: Tz::Local, home: home.to_string(), emit_providers: true });
    e.add(Box::new(ClaudeProvider::new(cfg)));
    e.add(Box::new(McpProvider::new(mcp)));
    e
}

/// 기준 시나리오 실행 → (이름, 결과) 목록과 시크릿 노출 목록
pub fn run_cases(root: &Path) -> (Vec<(String, Value)>, Vec<String>) {
    let cfg = load(&root.join("fixtures/fixture.json"));
    let cases = load(&root.join("fixtures/cases.json"));
    let secrets = fake_secrets(root);
    let work = temp_dir("fixture");
    stage(&root.join(cases["input"].as_str().unwrap()), &work, &secrets);
    let home = cfg["home"].as_str().unwrap().to_string();
    let base_now = cfg["now"].as_f64().unwrap();
    let mut eng = engine(&work, &home, base_now, SourceMode::Hooks);
    eng.set_daylog(Some(work.join("daylog")));
    let mut results: Vec<(String, Value)> = vec![];
    let mut leaks = vec![];
    for c in cases["cases"].as_array().unwrap() {
        let now = c.get("now").and_then(|v| v.as_f64()).unwrap_or(base_now);
        let name = c["name"].as_str().unwrap().to_string();
        let res = match c["op"].as_str().unwrap() {
            op @ ("append" | "truncate") => {
                let data = std::fs::read(work.join(c["from"].as_str().unwrap())).unwrap();
                let f = work.join(c["file"].as_str().unwrap());
                if op == "append" {
                    use std::io::Write;
                    std::fs::OpenOptions::new().append(true).open(&f).unwrap().write_all(&data).unwrap();
                } else {
                    std::fs::write(&f, data).unwrap();
                }
                continue;
            }
            "state" => serde_json::to_value(eng.state_at(now)).unwrap(),
            "trace" => {
                let mut since = c.get("since").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if let Some(n) = since.strip_prefix("$cursor:") {
                    since = results.iter().find(|(k, _)| k == n).unwrap().1["cursor"].as_str().unwrap().to_string();
                }
                let q = TraceQuery {
                    session: c["session"].as_str().unwrap_or("").into(),
                    prompt: c.get("prompt").and_then(|v| v.as_str()).unwrap_or("").into(),
                    since,
                };
                eng.trace_at(&q, now).body
            }
            "daylog" => {
                let r = eng.daylog_at(c.get("day").and_then(|v| v.as_str()).unwrap_or("today"), now);
                json!({"status": r.status, "body": r.body})
            }
            "daylog_seen" => {
                let r = eng.daylog_seen_at(c.get("day").and_then(|v| v.as_str()).unwrap_or(""), now);
                json!({"status": r.status, "body": r.body})
            }
            other => panic!("알 수 없는 op: {other}"),
        };
        let text = serde_json::to_string(&res).unwrap();
        for (k, v) in &secrets {
            if text.contains(v.as_str()) {
                leaks.push(format!("{name}: {k} 원문 노출"));
            }
        }
        results.push((name, res));
    }
    std::fs::remove_dir_all(&work).ok();
    (results, leaks)
}

/// 트랜스크립트 전용 엔진으로 /state 하나
pub fn run_transcript_only(root: &Path) -> (Value, Vec<String>) {
    let cfg = load(&root.join("fixtures/fixture.json"));
    let exp = load(&root.join("fixtures/transcript-only/expected.json"));
    let secrets = fake_secrets(root);
    let work = temp_dir("tonly");
    stage(&root.join(exp["input"].as_str().unwrap()), &work, &secrets);
    let now = cfg["now"].as_f64().unwrap();
    let mut eng = engine(&work, cfg["home"].as_str().unwrap(), now, SourceMode::Transcript);
    let st = serde_json::to_value(eng.state_at(now)).unwrap();
    let text = st.to_string();
    let leaks = secrets.iter().filter(|(_, v)| text.contains(v.as_str())).map(|(k, _)| format!("transcript-only: {k} 원문 노출")).collect();
    std::fs::remove_dir_all(&work).ok();
    (st, leaks)
}

/// scripts/compare.py와 같은 규칙: 키 순서 무시, 숫자 1e-6, cursor는 gen.prompt만, ignore 키는 어디서든 무시
#[allow(dead_code)]
pub fn diff(a: &Value, b: &Value, path: &str, out: &mut Vec<String>, ignore: &[&str]) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                if ignore.contains(&k.as_str()) {
                    continue;
                }
                let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                match (x.get(k), y.get(k)) {
                    (Some(_), None) => out.push(format!("{p}: 비교 쪽에 없음")),
                    (None, Some(_)) => out.push(format!("{p}: 기준에 없는 필드")),
                    (Some(Value::String(s1)), Some(Value::String(s2))) if k == "cursor" => {
                        if s1.rsplit_once('.').map(|z| z.0) != s2.rsplit_once('.').map(|z| z.0) {
                            out.push(format!("{p}: {s1} != {s2}"));
                        }
                    }
                    (Some(v1), Some(v2)) => diff(v1, v2, &p, out, ignore),
                    _ => {}
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: 길이 {} != {}", x.len(), y.len()));
            }
            for (i, (v1, v2)) in x.iter().zip(y).enumerate() {
                diff(v1, v2, &format!("{path}[{i}]"), out, ignore);
            }
        }
        (Value::Number(x), Value::Number(y)) => {
            if (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() > 1e-6 {
                out.push(format!("{path}: {x} != {y}"));
            }
        }
        _ => {
            if a != b {
                out.push(format!("{path}: {a} != {b}"));
            }
        }
    }
}

/// check_transcript_only.py와 같은 부분 비교
#[allow(dead_code)]
pub fn sub(exp: &Value, act: &Value, path: &str, out: &mut Vec<String>) {
    match exp {
        Value::Object(o) => {
            for (k, v) in o {
                match act.get(k) {
                    None => out.push(format!("{path}.{k}: 없음")),
                    Some(a) => sub(v, a, &format!("{path}.{k}"), out),
                }
            }
        }
        Value::Array(x) => match act.as_array() {
            Some(y) if y.len() == x.len() => {
                for (i, (e, a)) in x.iter().zip(y).enumerate() {
                    sub(e, a, &format!("{path}[{i}]"), out);
                }
            }
            _ => out.push(format!("{path}: 길이/형식 다름 {act}")),
        },
        Value::Number(n) => {
            if act.as_f64().is_none_or(|a| (a - n.as_f64().unwrap()).abs() > 1e-6) {
                out.push(format!("{path}: 기대 {n}, 실제 {act}"));
            }
        }
        _ => {
            if exp != act {
                out.push(format!("{path}: 기대 {exp}, 실제 {act}"));
            }
        }
    }
}

#[allow(dead_code)]
pub fn check_transcript_only(root: &Path, st: &Value) -> Vec<String> {
    let exp = load(&root.join("fixtures/transcript-only/expected.json"));
    let mut bad = vec![];
    let sessions = st["sessions"].as_array().unwrap();
    for (sid, want) in exp["cases"].as_object().unwrap() {
        let mut want = want.clone();
        let listed = want.as_object_mut().unwrap().remove("listed").and_then(|v| v.as_bool()).unwrap_or(true);
        let got = sessions.iter().find(|s| s["sid"] == json!(sid));
        let mut out = vec![];
        match (listed, got) {
            (false, Some(_)) => out.push("목록에 없어야 함".to_string()),
            (true, None) => out.push("목록에 없음".to_string()),
            (true, Some(g)) => sub(&want, g, sid, &mut out),
            _ => {}
        }
        for o in out {
            bad.push(format!("{sid}: {o}"));
        }
    }
    bad
}

//! /state용 트랜스크립트 증분 읽기 (server.py `scan()` 이식) + 트랜스크립트 전용 엔진이 서브에이전트에 쓰는 몇 가지 확장.
//! 확장 필드(first_ts, stop, handback, tools, recent)는 Python 결과에 영향을 주지 않는다.

use super::describe::{describe, kind_of};
use crate::clock::{iso, Tz};
use crate::jsonl::{contains, read_lines, size};
use crate::model::{AgentTool, Usage};
use crate::py::{get, strip, truthy};
use crate::text::say;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Default, Clone)]
pub struct ScanCache {
    pub off: u64,
    /// 메시지 id(없으면 uuid) → usage. 키는 JSON 표현(None과 "None"을 구분)
    pub msgs: IndexMap<String, Usage>,
    pub say: String,
    /// tool_use id → (도구 이름, 시각)
    pub pending: IndexMap<String, (String, f64)>,
    pub last_ts: f64,
    // --- 확장 ---
    pub first_ts: Option<f64>,
    pub stop: Option<(f64, String)>,
    pub handback: Option<f64>,
    pub tools: i64,
    pub recent: Vec<AgentTool>,
    pub tool_last: Option<f64>,
    /// 🧪 테스트 명령을 실행한 Bash tool_use id → 파이프로 이어졌나 (결과를 기다림, #138) — 명령 원문은 두지 않는다
    pub test_ids: HashMap<String, bool>,
    /// 마지막 테스트 실행 (결과 시각, 판정). 이번 턴인지는 쓰는 쪽이 prompt_ts와 비교
    pub test: Option<(f64, Verdict)>,
}

/// 🧪 테스트 실행 판정
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Fail,
    /// 돌렸지만 결과를 모름(파이프로 종료 코드가 가려지고 출력에 표지도 없음)
    Ran,
}

// 🧪 테스트 배지 규칙(#138, docs/PRD.md §5.3). server.py의 같은 이름 정규식과 **같은 문자열**이어야 한다(동등성).
/// 테스트 명령: 명령 처음·`;`·`&`·`|`·`(`·줄바꿈·`do`·`then` 뒤의 흔한 테스트 실행기(환경 변수·env·timeout·bundle exec·uv run 등 접두어 허용).
/// 따옴표 안은 지우고(UNQUOTE_PAT) heredoc(`<<`) 뒤는 잘라 낸 명령에 쓴다
pub const TEST_PAT: &str = r"(?:^|[;&|(\n]\s*|\b(?:do|then)\s+)(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:bundle\s+exec|poetry\s+run|pipenv\s+run|uv\s+run|time|env(?:\s+[A-Z_][A-Z0-9_]*=\S*)*|timeout\s+\S+)\s+)*(?:cargo\s+(?:test|nextest)\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:python3?\s+-m\s+|uv\s+run\s+)?pytest\b|go\s+test\b|(?:npx\s+)?(?:jest|vitest|playwright\s+test)\b|deno\s+test\b|bun\s+test\b|make\s+(?:test|check)\b|node\s+(?:--test\b|\S*test\S*\.m?js\b)|swift\s+test\b|dotnet\s+test\b|mvn\s+test\b|(?:\./)?gradlew?\s+test\b|rspec\b|phpunit\b)";
/// 따옴표 구간(지워서 `rg "cargo test|pytest"` 같은 검색어를 명령으로 보지 않게)
pub const UNQUOTE_PAT: &str = r#""(?:[^"\\]|\\.)*"|'[^']*'"#;
/// 파이프(`||` 제외) — 종료 코드가 마지막 명령의 것이라 실패를 가린다
pub const PIPE_PAT: &str = r"(?:^|[^|])\|(?:[^|]|$)";
/// 실행되지 않은 결과(사용자 거절·권한 차단·도구 입력 오류) — 결과 앞부분
pub const DENIED_PAT: &str =
    r"^(?:Permission (?:for this (?:action|command) was denied|to use )|The user doesn't want to proceed|<tool_use_error>)";
/// 아직 결과가 없는 실행(백그라운드로 감) — 결과 앞부분
pub const BG_PAT: &str = r"^Command (?:running in background|did not complete within|was moved to the background)";
/// 출력 끝부분의 실패 표지(cargo·pytest·jest/vitest·go·npm·rustc·node assert)
pub const FAIL_PAT: &str = r"(?m)test result: FAILED|\b[1-9][0-9]* (?:failed|failing)\b|^\s*FAIL\b|^FAILED\b|\bTests?:\s+[1-9][0-9]* failed|^npm ERR!|^error\[E[0-9]+\]|^--- FAIL|could not compile|^AssertionError";
/// 출력 끝부분의 통과 표지
pub const PASS_PAT: &str = r"(?m)test result: ok\.|\b[1-9][0-9]* passed\b|^ok\s|^PASS\b|\bTests?:\s+[0-9]+ passed|^OK\b|: ok$";

fn re(slot: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    slot.get_or_init(|| Regex::new(pat).unwrap())
}

/// 판정에 쓰는 명령 모양: 따옴표 구간을 지우고 heredoc 본문을 잘라 낸 것
fn shape(cmd: &str) -> String {
    static Q: OnceLock<Regex> = OnceLock::new();
    let head = cmd.split("<<").next().unwrap_or("");
    re(&Q, UNQUOTE_PAT).replace_all(head, "\"\"").trim_start().to_string()
}

pub fn is_test_cmd(cmd: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, TEST_PAT).is_match(&shape(cmd))
}

fn piped(cmd: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, PIPE_PAT).is_match(&shape(cmd))
}

/// tool_result 내용 글(문자열 또는 text 블록들을 이어 붙임)
fn result_text(blk: &Value) -> String {
    match get(blk, "content") {
        Some(Value::String(t)) => t.clone(),
        Some(Value::Array(a)) => a.iter().filter_map(|b| get(b, "text").and_then(|t| t.as_str())).collect(),
        _ => String::new(),
    }
}

/// 결과 하나의 판정 — None = 실행 결과가 아님(거절·차단·백그라운드). 출력은 판정에만 쓰고 남기지 않는다
pub fn verdict(text: &str, is_error: bool, piped: bool) -> Option<Verdict> {
    static D: OnceLock<Regex> = OnceLock::new();
    static B: OnceLock<Regex> = OnceLock::new();
    static F: OnceLock<Regex> = OnceLock::new();
    static P: OnceLock<Regex> = OnceLock::new();
    let head: String = text.trim_start().chars().take(200).collect();
    if re(&D, DENIED_PAT).is_match(&head) || re(&B, BG_PAT).is_match(&head) {
        return None;
    }
    let n = text.chars().count();
    let tail: String = text.chars().skip(n.saturating_sub(4000)).collect();
    Some(if re(&F, FAIL_PAT).is_match(&tail) || is_error {
        Verdict::Fail
    } else if re(&P, PASS_PAT).is_match(&tail) || !piped {
        Verdict::Pass
    } else {
        Verdict::Ran
    })
}

/// 이번 턴(`prompt_ts` 뒤)의 마지막 테스트 결과 — "pass" | "fail" | "ran", 없으면 None
pub fn test_of(c: &ScanCache, prompt_ts: Option<f64>) -> Option<&'static str> {
    let from = prompt_ts.filter(|&x| x != 0.0)?;
    c.test.filter(|(t, _)| *t >= from).map(|(_, v)| match v {
        Verdict::Pass => "pass",
        Verdict::Fail => "fail",
        Verdict::Ran => "ran",
    })
}

/// 파이썬 dict 키처럼 쓰려고 Value를 JSON 문자열로
pub fn key_of(v: Option<&Value>) -> String {
    v.map(|x| x.to_string()).unwrap_or_else(|| "null".into())
}

fn int_of(u: &Value, k: &str) -> i64 {
    match get(u, k) {
        Some(v) => v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0),
        None => 0,
    }
}

/// 한 줄 파싱: (type, ts, 문서). type이 assistant/user가 아니거나 시각이 없으면 None
pub fn parse_line(raw: &[u8], tz: Tz) -> Option<(bool, f64, Value)> {
    let d: Value = serde_json::from_slice(raw).ok()?;
    let assistant = match get(&d, "type").and_then(|t| t.as_str()) {
        Some("assistant") => true,
        Some("user") => false,
        _ => return None,
    };
    let ts = iso(get(&d, "timestamp")?.as_str()?, tz)?;
    Some((assistant, ts, d))
}

pub fn blocks(m: &Value) -> &[Value] {
    match get(m, "content") {
        Some(Value::Array(a)) => a,
        _ => &[],
    }
}

/// `scan(path)` — c를 이어서 갱신
pub fn scan(c: &mut ScanCache, path: &Path, tz: Tz) {
    let Some(sz) = size(path) else { return };
    if sz < c.off {
        *c = ScanCache::default();
    }
    let mut off = c.off;
    let _ = read_lines(path, &mut off, |raw| {
        if !contains(raw, b"\"assistant\"") && !contains(raw, b"\"user\"") {
            return;
        }
        let Some((assistant, ts, d)) = parse_line(raw, tz) else { return };
        let empty = Value::Null;
        let m = get(&d, "message").filter(|m| m.is_object()).unwrap_or(&empty);
        c.last_ts = c.last_ts.max(ts);
        if c.first_ts.is_none() {
            c.first_ts = Some(ts);
        }
        if assistant {
            if let Some(u) = get(m, "usage").filter(|u| u.is_object() && truthy(u)) {
                let id = get(m, "id").filter(|v| truthy(v)).or_else(|| get(&d, "uuid"));
                c.msgs.insert(
                    key_of(id),
                    Usage {
                        ts,
                        new: int_of(u, "input_tokens") + int_of(u, "cache_creation_input_tokens"),
                        cached: int_of(u, "cache_read_input_tokens"),
                        out: int_of(u, "output_tokens"),
                    },
                );
            }
            if let Some(sr) = get(m, "stop_reason").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                c.stop = Some((ts, sr.to_string()));
            }
            for blk in blocks(m) {
                match get(blk, "type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = get(blk, "text").and_then(|t| t.as_str()) {
                            if !strip(t).is_empty() {
                                c.say = say(t, 160);
                            }
                        }
                    }
                    Some("tool_use") => {
                        let name = get(blk, "name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                        let inp = get(blk, "input").cloned().unwrap_or(Value::Null);
                        let (icon, text) = describe(&name, &inp, true);
                        c.tools += 1;
                        c.tool_last = Some(ts);
                        c.recent.push(AgentTool {
                            icon: icon.into(),
                            text: text.into(),
                            kind: kind_of(&name).into(),
                        });
                        if c.recent.len() > 3 {
                            c.recent.remove(0);
                        }
                        if name == "SubagentHandback" {
                            c.handback = Some(ts);
                        }
                        // 🧪 백그라운드 실행은 결과가 아직 없으므로 세지 않는다
                        if let (true, Some(cmd)) = (name == "Bash", get(&inp, "command").and_then(|v| v.as_str())) {
                            if !get(&inp, "run_in_background").is_some_and(truthy) && is_test_cmd(cmd) {
                                c.test_ids.insert(key_of(get(blk, "id")), piped(cmd));
                            }
                        }
                        c.pending.insert(key_of(get(blk, "id")), (name, ts));
                    }
                    _ => {}
                }
            }
        } else {
            for blk in blocks(m) {
                if get(blk, "type").and_then(|t| t.as_str()) == Some("tool_result") {
                    let id = key_of(get(blk, "tool_use_id"));
                    c.pending.shift_remove(&id);
                    if let Some(p) = c.test_ids.remove(&id) {
                        if let Some(v) = verdict(&result_text(blk), get(blk, "is_error").is_some_and(truthy), p) {
                            c.test = Some((ts, v));
                        }
                    }
                }
            }
        }
    });
    c.off = off;
}

/// 경로별 캐시 묶음
#[derive(Debug, Default)]
pub struct Scans {
    pub map: HashMap<PathBuf, ScanCache>,
}

impl Scans {
    pub fn get(&mut self, path: &Path, tz: Tz) -> &ScanCache {
        let c = self.map.entry(path.to_path_buf()).or_default();
        scan(c, path, tz);
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 🧪 #138 판정 표 — scripts/test_scan_verdict.py가 server.py로 같은 표를 확인한다(동등성)
    pub const CMD_YES: &[&str] = &[
        "cargo test -p wr-core",
        "cargo nextest run",
        "npm test",
        "npm run test -- --watch=false",
        "pnpm test",
        "yarn test",
        "bun test",
        "pytest -q tests",
        "python3 -m pytest -x",
        "uv run pytest",
        "go test ./...",
        "npx vitest run",
        "jest --ci",
        "npx playwright test",
        "make test",
        "make check",
        "node --test",
        "node scripts/test_inbox.js",
        "cd web && npm test 2>&1 | tail -5",
        "RUST_LOG=debug cargo test",
        "RUST_LOG2=1 cargo test",
        "(cd app && cargo test)",
        "swift test",
        "dotnet test",
        "./gradlew test",
        "mvn test",
        "bundle exec rspec",
        "timeout 300 cargo test",
        "env FOO=1 cargo test",
        "cd crates\ncargo test -q",
        "for t in a b; do cargo test -p $t; done",
    ];
    pub const CMD_NO: &[&str] = &[
        "grep -rn test src",
        "ls tests/",
        "cat test_inbox.js",
        "git commit -m 'add test'",
        "echo cargo test",
        "node build.js",
        "npm install",
        "rg 'pytest' docs",
        "sed -n 1,20p scripts/test_inbox.js",
        "rg \"cargo test|pytest\" docs",
        "grep -rE 'jest|vitest' package.json",
        "git commit -m \"fix (cargo test 통과)\"",
        "cargo testx",
        "cat > notes.md <<'EOF'\ncargo test\nEOF",
    ];

    #[test]
    fn test_commands() {
        for c in CMD_YES {
            assert!(is_test_cmd(c), "테스트로 봐야 함: {c}");
        }
        for c in CMD_NO {
            assert!(!is_test_cmd(c), "테스트가 아님: {c}");
        }
        assert!(piped("cargo test 2>&1 | tail -5") && !piped("cargo test || true") && !piped("rg 'a|b' && cargo test"));
    }

    /// 🧪 #138: 출력 끝부분의 표지 > 오류 표시 > 파이프 없는 종료 코드. 실행되지 않은 결과(거절·차단·백그라운드)는 None
    #[test]
    fn verdicts() {
        use Verdict::*;
        let v = |t: &str, e: bool, p: bool| verdict(t, e, p);
        assert_eq!(
            v(
                "Permission for this action was denied by the Claude Code auto mode classifier.",
                true,
                false
            ),
            None
        );
        assert_eq!(
            v(
                "Permission for this command was denied by a built-in Claude Code safety check",
                true,
                false
            ),
            None
        );
        assert_eq!(
            v("Permission to use Bash with command make test has been denied.", true, false),
            None
        );
        assert_eq!(v("The user doesn't want to proceed with this tool use.", true, false), None);
        assert_eq!(v("<tool_use_error>Blocked: sleep 60</tool_use_error>", true, false), None);
        assert_eq!(v("Command running in background with ID: b1", false, false), None);
        assert_eq!(
            v(
                "Command did not complete within its 600s timeout and was moved to the background",
                false,
                false
            ),
            None
        );
        // 파이프: 종료 코드는 tail의 것 → 출력 표지로
        assert_eq!(
            v("running 3 tests\ntest result: FAILED. 2 passed; 1 failed", false, true),
            Some(Fail)
        );
        assert_eq!(v("== 1 failed, 12 passed in 0.3s ==", false, true), Some(Fail));
        assert_eq!(v("test result: ok. 75 passed; 0 failed", false, true), Some(Pass));
        assert_eq!(v("Tests:  12 passed, 12 total", false, true), Some(Pass));
        assert_eq!(v("test_inbox: ok", false, true), Some(Pass));
        assert_eq!(v("compiling...\n(출력 일부)", false, true), Some(Ran));
        // 파이프 없음: 종료 코드가 믿을 만함
        assert_eq!(v("done", false, false), Some(Pass));
        assert_eq!(v("Exit code 1", true, false), Some(Fail));
        assert_eq!(v("Exit code 1\nAssertionError [ERR_ASSERTION]: x", true, true), Some(Fail));
        // 끝부분만 본다: 앞쪽의 옛 실패 로그는 무시
        let long = format!("FAILED earlier\n{}\ntest result: ok. 3 passed", "x".repeat(5000));
        assert_eq!(v(&long, false, true), Some(Pass));
    }

    #[test]
    fn turn_only() {
        let c = ScanCache {
            test: Some((100.0, Verdict::Fail)),
            ..Default::default()
        };
        assert_eq!(test_of(&c, Some(50.0)), Some("fail"));
        assert_eq!(test_of(&c, Some(100.0)), Some("fail"));
        assert_eq!(test_of(&c, Some(150.0)), None);
        assert_eq!(test_of(&c, None), None);
        let c = ScanCache {
            test: Some((100.0, Verdict::Ran)),
            ..Default::default()
        };
        assert_eq!(test_of(&c, Some(1.0)), Some("ran"));
    }
}

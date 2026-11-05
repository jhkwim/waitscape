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
use std::collections::{HashMap, HashSet};
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
    /// 🧪 테스트 명령을 실행한 Bash tool_use id (결과를 기다림, #138) — 명령 원문은 두지 않는다
    pub test_ids: HashSet<String>,
    /// 마지막 테스트 실행 (결과 시각, 통과). 이번 턴인지는 쓰는 쪽이 prompt_ts와 비교
    pub test: Option<(f64, bool)>,
}

/// 🧪 테스트 명령(#138, docs/PRD.md §5.3): 명령 처음이나 `&&`·`;`·`|`·`(` 뒤에서 흔한 테스트 실행기. server.py `TEST_RE`와 같은 문자열
pub const TEST_PAT: &str = r"(?:^|[;&|(]\s*)(?:[A-Z_]+=\S*\s+)*(?:(?:bundle\s+exec|poetry\s+run|pipenv\s+run|uv\s+run|time)\s+)*(?:cargo\s+(?:test|nextest)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:python3?\s+-m\s+|uv\s+run\s+)?pytest\b|go\s+test\b|(?:npx\s+)?(?:jest|vitest|playwright\s+test)\b|deno\s+test\b|bun\s+test\b|make\s+(?:test|check)\b|node\s+(?:--test\b|\S*test\S*\.m?js\b)|swift\s+test\b|dotnet\s+test\b|mvn\s+test\b|(?:\./)?gradlew?\s+test\b|rspec\b|phpunit\b)";
/// 실행되지 않은 결과(사용자 거절·권한 차단·도구 입력 오류) — is_error여도 테스트 실패가 아니다. server.py `DENIED_RE`와 같음
pub const DENIED_PAT: &str = r"^(?:Permission (?:for this action was denied|to use )|The user doesn't want to proceed|<tool_use_error>)";

pub fn is_test_cmd(cmd: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(TEST_PAT).unwrap()).is_match(cmd.trim_start())
}

fn denied(text: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(DENIED_PAT).unwrap()).is_match(text.trim_start())
}

/// tool_result 내용의 앞부분 글(문자열 또는 text 블록들)
fn result_text(blk: &Value) -> String {
    match get(blk, "content") {
        Some(Value::String(t)) => t.chars().take(200).collect(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|b| get(b, "text").and_then(|t| t.as_str()))
            .collect::<String>()
            .chars()
            .take(200)
            .collect(),
        _ => String::new(),
    }
}

/// 이번 턴(`prompt_ts` 뒤)의 마지막 테스트 결과 — "pass" | "fail", 없으면 None
pub fn test_of(c: &ScanCache, prompt_ts: Option<f64>) -> Option<&'static str> {
    let from = prompt_ts.filter(|&x| x != 0.0)?;
    c.test.filter(|(t, _)| *t >= from).map(|(_, ok)| if ok { "pass" } else { "fail" })
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
                        if name == "Bash" && get(&inp, "command").and_then(|v| v.as_str()).is_some_and(is_test_cmd) {
                            c.test_ids.insert(key_of(get(blk, "id")));
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
                    if c.test_ids.remove(&id) && !denied(&result_text(blk)) {
                        c.test = Some((ts, !get(blk, "is_error").is_some_and(truthy)));
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

    /// 🧪 #138: 흔한 테스트 실행기는 맞고, 테스트라는 글자가 든 다른 명령은 아니다
    #[test]
    fn test_commands() {
        for c in [
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
            "(cd app && cargo test)",
            "swift test",
            "dotnet test",
            "./gradlew test",
            "mvn test",
            "bundle exec rspec",
        ] {
            assert!(is_test_cmd(c), "테스트로 봐야 함: {c}");
        }
        for c in [
            "grep -rn test src",
            "ls tests/",
            "cat test_inbox.js",
            "git commit -m 'add test'",
            "echo cargo test",
            "node build.js",
            "npm install",
            "rg 'pytest' docs",
            "sed -n 1,20p scripts/test_inbox.js",
        ] {
            assert!(!is_test_cmd(c), "테스트가 아님: {c}");
        }
    }

    /// 🧪 #138: 실행되지 않은 결과(거절·차단·도구 오류)는 실패로 치지 않는다 · 이번 턴만
    #[test]
    fn denied_and_turn() {
        assert!(denied(
            "Permission for this action was denied by the Claude Code auto mode classifier."
        ));
        assert!(denied("Permission to use Bash with command make test has been denied."));
        assert!(denied("The user doesn't want to proceed with this tool use."));
        assert!(denied("<tool_use_error>Blocked: sleep 60</tool_use_error>"));
        assert!(!denied("Exit code 1\n2 failed"));
        let c = ScanCache {
            test: Some((100.0, false)),
            ..Default::default()
        };
        assert_eq!(test_of(&c, Some(50.0)), Some("fail"));
        assert_eq!(test_of(&c, Some(100.0)), Some("fail"));
        assert_eq!(test_of(&c, Some(150.0)), None);
        assert_eq!(test_of(&c, None), None);
        let c = ScanCache {
            test: Some((100.0, true)),
            ..Default::default()
        };
        assert_eq!(test_of(&c, Some(1.0)), Some("pass"));
    }
}

//! /state용 트랜스크립트 증분 읽기 (server.py `scan()` 이식) + 트랜스크립트 전용 엔진이 서브에이전트에 쓰는 몇 가지 확장.
//! 확장 필드(first_ts, stop, handback, tools, recent)는 Python 결과에 영향을 주지 않는다.

use super::describe::{describe, kind_of};
use crate::clock::{iso, Tz};
use crate::jsonl::{contains, read_lines, size};
use crate::model::{AgentTool, Usage};
use crate::py::{get, strip, truthy};
use crate::text::say;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
                        c.pending.insert(key_of(get(blk, "id")), (name, ts));
                    }
                    _ => {}
                }
            }
        } else {
            for blk in blocks(m) {
                if get(blk, "type").and_then(|t| t.as_str()) == Some("tool_result") {
                    c.pending.shift_remove(&key_of(get(blk, "tool_use_id")));
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

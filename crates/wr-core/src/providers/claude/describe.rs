//! Claude Code 도구 호출 → 사람이 읽는 요약 (hook.py `short()`, `describe()`, `KINDS` 이식).
//!
//! wr-hook도 이 파일을 `#[path]`로 포함한다. 그래서 `crate::py`, `crate::redact`만 쓴다(같은 이름으로 두 크레이트에 있음).
#![allow(dead_code)]

use crate::py::{basename, ellipsize, get, py_str, squash_ws, truthy};
use crate::redact::redact;
use serde_json::Value;

/// `short(s, n)`: 공백 정리 → n자 절단(…). `s`는 이미 문자열(없으면 "")
pub fn short(s: &str, n: usize) -> String {
    ellipsize(squash_ws(s), n)
}

/// 값 하나를 문자열로: `str(v or "")` (+ 마스킹 선택)
pub fn sval(v: Option<&Value>, mask: bool) -> String {
    let s = match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    };
    if mask && !s.is_empty() {
        redact(&s)
    } else {
        s
    }
}

/// `a or b` 문자열 버전
fn first<'a>(inp: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().filter_map(|k| get(inp, k)).find(|v| truthy(v))
}

/// (아이콘, 문구). `mask`면 입력 문자열을 **절단 전에** 마스킹한다(P0 지적사항: 잘린 비밀 조각 방지).
pub fn describe(tool: &str, inp: &Value, mask: bool) -> (&'static str, String) {
    let path_v = first(inp, &["file_path", "notebook_path"]);
    let path_s = sval(path_v, mask);
    let path = basename(&path_s);
    let s = |keys: &[&str]| sval(first(inp, keys), mask);
    match tool {
        "Read" => ("📖", format!("{} 읽는 중", path)),
        "Edit" | "MultiEdit" | "NotebookEdit" => ("✏️", format!("{} 고치는 중", path)),
        "Write" => ("📝", format!("{} 쓰는 중", path)),
        "Bash" => ("⚡", short(&s(&["description", "command"]), 60)),
        "Grep" | "Glob" => ("🔍", format!("'{}' 찾는 중", short(&s(&["pattern"]), 40))),
        "WebFetch" | "WebSearch" => ("🌐", short(&s(&["query", "url"]), 60)),
        "Agent" | "Task" => ("🤖", format!("서브에이전트: {}", short(&s(&["description"]), 50))),
        "TodoWrite" => ("🗒️", "할 일 정리 중".to_string()),
        "SubagentHandback" => ("📨", "결과 보고".to_string()),
        t if t.starts_with("mcp__") => ("🔌", t.rsplit("__").next().unwrap_or("").to_string()),
        t => ("🔧", t.to_string()),
    }
}

/// 도구 분류 (`KINDS`). mcp__*는 web
pub fn kind_of(tool: &str) -> &'static str {
    match tool {
        "Read" => "read",
        "Edit" | "MultiEdit" | "NotebookEdit" | "Write" => "edit",
        "Bash" => "bash",
        "Grep" | "Glob" => "search",
        "WebFetch" | "WebSearch" => "web",
        "Agent" | "Task" => "agent",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => "todo",
        t if t.starts_with("mcp__") => "web",
        _ => "other",
    }
}

/// TodoWrite input의 todos → `[{text, status}]` (진행 중이면 activeForm, 60자)
pub fn todos_of(inp: &Value, mask: bool) -> Vec<Value> {
    let mut out = vec![];
    if let Some(Value::Array(items)) = get(inp, "todos") {
        for t in items {
            let st = get(t, "status").cloned().unwrap_or(Value::Null);
            let src = if st.as_str() == Some("in_progress") {
                get(t, "activeForm")
            } else {
                get(t, "content")
            };
            let mut o = serde_json::Map::new();
            o.insert("text".into(), Value::String(short(&sval(src, mask), 60)));
            o.insert("status".into(), st);
            out.push(Value::Object(o));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn describes() {
        assert_eq!(
            describe("Read", &json!({"file_path": "/a/b/app.py"}), false),
            ("📖", "app.py 읽는 중".into())
        );
        assert_eq!(describe("Bash", &json!({"command": "ls -la"}), false).1, "ls -la");
        assert_eq!(describe("Grep", &json!({"pattern": "TODO"}), false).1, "'TODO' 찾는 중");
        assert_eq!(describe("mcp__srv__do_it", &json!({}), false), ("🔌", "do_it".into()));
        assert_eq!(describe("Foo", &json!(null), false), ("🔧", "Foo".into()));
        assert_eq!(kind_of("mcp__x__y"), "web");
        let k = ["gh", "p_", "abcdefgh12345678"].concat();
        let (_, t) = describe("Bash", &json!({"command": format!("git push https://{k}@host")}), true);
        assert!(!t.contains(&k));
    }
}

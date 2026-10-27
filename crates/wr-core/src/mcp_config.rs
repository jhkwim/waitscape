//! MCP 보고 연결 설정의 순수 변환 — 앱 설정 화면(`app/src-tauri/src/mcp_connect.rs`)과 README의 수동 연결 안내가 같은 값을 쓴다.
//! 파일 읽기·백업·쓰기·연결 기록은 앱 쪽, 여기는 JSON 값 → JSON 값 변환만(테스트하기 쉽게).
//!
//! - Claude Code 등록: `claude mcp add -s user waitscape -- <bin> mcp --reports <절대 경로>` (`~/.claude.json`은 Claude Code가 수시로
//!   다시 쓰므로 직접 고치지 않고 CLI로만). `--reports`를 인자로 고정하는 이유: Codex 등은 MCP 서버에 기본 허용 env만 넘긴다.
//! - Antigravity CLI: `~/.gemini/config/mcp_config.json`의 `mcpServers.waitscape` `{command, args, enabledTools}` (전용 add 명령이 없음).
//!   근거 https://antigravity.google/docs/mcp?tab=cli — `enabledTools`(허용 목록)는 있고 trust 옵션은 문서에 없다.
//! - Codex(TOML)는 원문 보존 편집이 필요해 앱 쪽(`toml_edit`)에서 한다.
//! - 우리 항목 식별: 서버 이름 `waitscape` **그리고** 명령 경로 꼬리 `waiting-room/bin/wr-hook` **그리고** `args[0] == "mcp"`.
//! - 확인창 줄이기(기본 체크): `settings.json` `permissions.allow`에 **도구 2개만** 정확한 이름으로 넣는다.
//!   `mcp__waitscape`(서버 전체)는 같은 이름의 다른 서버·앞으로 늘 도구까지 무확인으로 열어 주므로 쓰지 않는다.
//!   해제할 때는 **우리가 넣은 규칙만** 지운다(`with_allow_tracked`가 무엇을 넣었는지 돌려주고, 앱이 연결 기록에 남긴다).
//!   연결 전부터 있던 같은 규칙·`permissions`/`allow` 키는 남긴다.
//! - 파일 쓰기는 `hooks_config::write_raw`(백업·mtime 재확인·원자적 rename)를 그대로 쓴다.

use serde_json::{json, Map, Value};

/// MCP 서버 이름 (Gemini는 서버 이름에 `_`를 권하지 않음)
pub const SERVER: &str = "waitscape";
pub const TOOLS: [&str; 2] = ["waitscape_status", "waitscape_board"];

/// 이 서버 항목(`{command, args}`)이 우리 것인가: 명령 경로 꼬리 + `args[0] == "mcp"`
pub fn is_ours(entry: &Value) -> bool {
    crate::hooks_config::is_ours(entry) && entry.pointer("/args/0").and_then(|a| a.as_str()) == Some("mcp")
}

/// 서버 등록 인자 (`mcp --reports <절대 경로>`)
pub fn server_args(reports: &str) -> Vec<String> {
    vec!["mcp".into(), "--reports".into(), reports.into()]
}

/// 서버 목록 객체(`mcpServers`) 안의 우리 이름 항목 상태
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Entry {
    /// 없음
    None,
    /// 우리 항목이고 명령·인자까지 지금 값과 같음
    Ours,
    /// 우리 항목이지만 다른 경로·인자(옛 설치) → 다시 연결하면 고침
    Stale,
    /// 같은 이름의 다른 서버 → 건드리지 않음
    Other,
}

/// `servers`(예: `mcpServers` 값)에서 `waitscape` 항목 상태
pub fn entry_state(servers: Option<&Value>, bin: &str, reports: &str) -> Entry {
    match servers.and_then(|s| s.get(SERVER)) {
        None => Entry::None,
        Some(e) if !is_ours(e) => Entry::Other,
        Some(e) => {
            let same = e.get("command").and_then(|c| c.as_str()) == Some(bin) && e.get("args") == Some(&json!(server_args(reports)));
            if same {
                Entry::Ours
            } else {
                Entry::Stale
            }
        }
    }
}

/// Antigravity CLI 항목: `{command, args, enabledTools}` (도구 2개만 노출)
pub fn antigravity_entry(bin: &str, reports: &str) -> Value {
    json!({"command": bin, "args": server_args(reports), "enabledTools": TOOLS})
}

/// `mcpServers.waitscape`를 넣은(바꾼) 사본. `mcpServers`가 없으면 만든다. 최상위·`mcpServers`가 객체가 아니면 `None`
pub fn with_server(config: &Value, entry: Value) -> Option<Value> {
    let mut out = config.clone();
    let servers = out
        .as_object_mut()?
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    servers.as_object_mut()?.insert(SERVER.into(), entry);
    Some(out)
}

/// 우리 항목만 뺀 사본. `drop_parent`(연결할 때 우리가 `mcpServers`를 만들었음)이고 비었으면 `mcpServers`도 지운다.
/// 같은 이름이라도 우리 항목이 아니면 그대로
pub fn without_server(config: &Value, drop_parent: bool) -> Value {
    let mut out = config.clone();
    let Some(o) = out.as_object_mut() else { return out };
    let Some(servers) = o.get_mut("mcpServers").and_then(|s| s.as_object_mut()) else {
        return out;
    };
    if !servers.get(SERVER).is_some_and(is_ours) {
        return config.clone();
    }
    servers.shift_remove(SERVER);
    if drop_parent && servers.is_empty() {
        o.shift_remove("mcpServers");
    }
    out
}

/// `with_allow_tracked`가 실제로 바꾼 것 (해제할 때 이것만 되돌린다)
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AllowAdded {
    /// 우리가 넣은 규칙 (연결 전부터 있던 규칙은 빠짐)
    pub rules: Vec<String>,
    /// `permissions` 키를 우리가 만들었음
    pub created_permissions: bool,
    /// `permissions.allow` 키를 우리가 만들었음
    pub created_allow: bool,
}

/// Claude Code 권한 규칙 (`mcp__<서버>__<도구>`)
pub fn claude_allow_rules() -> Vec<String> {
    TOOLS.iter().map(|t| format!("mcp__{SERVER}__{t}")).collect()
}

/// `claude` CLI 인자 (셸을 거치지 않고 절대 경로 + 인자 배열로 실행)
pub fn claude_add_args(bin: &str, reports: &str) -> Vec<String> {
    ["mcp", "add", "-s", "user", SERVER, "--", bin, "mcp", "--reports", reports]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

pub fn claude_remove_args() -> Vec<String> {
    ["mcp", "remove", "-s", "user", SERVER].iter().map(|s| s.to_string()).collect()
}

/// 규칙 2개를 넣은 사본. 이미 있으면 입력 그대로. `permissions`·`allow`가 예상과 다른 형식이면 건드리지 않는다
pub fn with_allow(settings: &Value) -> Value {
    let mut out = settings.clone();
    let Some(o) = out.as_object_mut() else { return out };
    let perms = o.entry("permissions").or_insert_with(|| Value::Object(Map::new()));
    let Some(perms) = perms.as_object_mut() else {
        return settings.clone();
    };
    let allow = perms.entry("allow").or_insert_with(|| json!([]));
    let Some(allow) = allow.as_array_mut() else {
        return settings.clone();
    };
    let mut changed = false;
    for r in claude_allow_rules() {
        if !allow.iter().any(|x| x.as_str() == Some(r.as_str())) {
            allow.push(json!(r));
            changed = true;
        }
    }
    if changed {
        out
    } else {
        settings.clone()
    }
}

/// `with_allow`와 같고, 무엇을 넣었는지도 돌려준다. 형식이 달라 못 넣으면 `None`
pub fn with_allow_tracked(settings: &Value) -> Option<(Value, AllowAdded)> {
    let perms = settings.get("permissions");
    let created_permissions = perms.is_none();
    let created_allow = perms.and_then(|p| p.get("allow")).is_none();
    let next = with_allow(settings);
    let have = |v: &Value, r: &str| {
        v.pointer("/permissions/allow")
            .and_then(|a| a.as_array())
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(r)))
    };
    if claude_allow_rules().iter().any(|r| !have(&next, r)) {
        return None;
    }
    let rules = claude_allow_rules().into_iter().filter(|r| !have(settings, r)).collect();
    Some((
        next,
        AllowAdded {
            rules,
            created_permissions,
            created_allow,
        },
    ))
}

/// 연결 기록대로 우리가 넣은 것만 되돌린 사본: 넣은 규칙만 빼고, 우리가 만든 `allow`·`permissions`가 비었으면 그 키도 지운다
pub fn without_added(settings: &Value, added: &AllowAdded) -> Value {
    let mut out = settings.clone();
    let Some(o) = out.as_object_mut() else { return out };
    let Some(perms) = o.get_mut("permissions").and_then(|p| p.as_object_mut()) else {
        return settings.clone();
    };
    if let Some(allow) = perms.get_mut("allow").and_then(|a| a.as_array_mut()) {
        allow.retain(|x| !x.as_str().is_some_and(|s| added.rules.iter().any(|r| r == s)));
        if added.created_allow && allow.is_empty() {
            perms.shift_remove("allow");
        }
    }
    if added.created_permissions && perms.is_empty() {
        o.shift_remove("permissions");
    }
    out
}

/// 우리 규칙 2개만 뺀 사본. 키(`permissions`·`allow`)는 비어도 남긴다(원래 있던 빈 키를 지우지 않게. 빈 키는 무해)
pub fn without_allow(settings: &Value) -> Value {
    let mut out = settings.clone();
    let rules = claude_allow_rules();
    let Some(perms) = out.get_mut("permissions").and_then(|p| p.as_object_mut()) else {
        return out;
    };
    let Some(allow) = perms.get_mut("allow").and_then(|a| a.as_array_mut()) else {
        return out;
    };
    let n = allow.len();
    allow.retain(|x| !x.as_str().is_some_and(|s| rules.iter().any(|r| r == s)));
    if allow.len() == n {
        return settings.clone();
    }
    out
}

/// 바뀔 규칙 (확인 화면용) `+ 규칙` / `- 규칙`
pub fn allow_diff(before: &Value, after: &Value) -> Vec<String> {
    let has = |v: &Value, r: &str| {
        v.pointer("/permissions/allow")
            .and_then(|a| a.as_array())
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(r)))
    };
    let mut out = vec![];
    for r in claude_allow_rules() {
        match (has(before, &r), has(after, &r)) {
            (false, true) => out.push(format!("+ permissions.allow: {r}")),
            (true, false) => out.push(format!("- permissions.allow: {r}")),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_only_two_tools_and_round_trip() {
        let orig = json!({"model": "opus", "permissions": {"allow": ["Bash(ls)", "mcp__waitscape"], "deny": ["Read(.env)"]}});
        let a = with_allow(&orig);
        assert_eq!(
            a["permissions"]["allow"],
            json!([
                "Bash(ls)",
                "mcp__waitscape",
                "mcp__waitscape__waitscape_status",
                "mcp__waitscape__waitscape_board"
            ])
        );
        assert_eq!(with_allow(&a), a, "멱등");
        assert_eq!(allow_diff(&orig, &a).len(), 2);
        let b = without_allow(&a);
        assert_eq!(b, orig, "사용자 규칙(mcp__waitscape 포함)은 그대로");
        assert!(allow_diff(&a, &b).iter().all(|l| l.starts_with("- ")));
        // 원래 있던 빈 키는 남긴다
        for orig in [json!({"permissions": {}}), json!({"permissions": {"allow": []}})] {
            assert_eq!(without_allow(&with_allow(&orig))["permissions"]["allow"], json!([]), "{orig}");
        }
        // 형식이 다르면 건드리지 않는다
        let odd = json!({"permissions": {"allow": "x"}});
        assert_eq!(with_allow(&odd), odd);
        assert_eq!(without_allow(&odd), odd);
    }

    #[test]
    fn tracked_allow_keeps_what_was_there() {
        // 원래 없던 키는 해제할 때 같이 지운다
        let empty = json!({"model": "opus"});
        let (a, added) = with_allow_tracked(&empty).unwrap();
        assert!(added.created_permissions && added.created_allow && added.rules.len() == 2);
        assert_eq!(without_added(&a, &added), empty);
        // 빈 키가 원래 있었으면 남긴다
        for orig in [json!({"permissions": {}}), json!({"permissions": {"allow": []}, "x": 1})] {
            let (a, added) = with_allow_tracked(&orig).unwrap();
            assert_eq!(without_added(&a, &added), orig, "{orig}");
        }
        // 연결 전부터 있던 규칙은 기억하고 해제 때 남긴다
        let had = json!({"permissions": {"allow": ["mcp__waitscape__waitscape_status", "Bash(ls)"], "deny": []}});
        let (a, added) = with_allow_tracked(&had).unwrap();
        assert_eq!(added.rules, vec!["mcp__waitscape__waitscape_board".to_string()]);
        assert_eq!(without_added(&a, &added), had);
        // 형식이 다르면 None
        assert!(with_allow_tracked(&json!({"permissions": {"allow": "x"}})).is_none());
    }

    #[test]
    fn server_entry_round_trip() {
        let bin = "/h/.claude/waiting-room/bin/wr-hook";
        let rep = "/h/.claude/waiting-room/reports.jsonl";
        let orig = json!({"mcpServers": {"github": {"command": "gh", "args": ["mcp"], "$typeName": "x"}}, "z": 1});
        assert_eq!(entry_state(orig.get("mcpServers"), bin, rep), Entry::None);
        let a = with_server(&orig, antigravity_entry(bin, rep)).unwrap();
        assert_eq!(a["mcpServers"]["waitscape"]["enabledTools"], json!(TOOLS));
        assert_eq!(entry_state(a.get("mcpServers"), bin, rep), Entry::Ours);
        assert_eq!(
            entry_state(a.get("mcpServers"), "/other/waiting-room/bin/wr-hook", rep),
            Entry::Stale
        );
        let keys: Vec<_> = a["mcpServers"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["github", "waitscape"], "순서 유지, 뒤에 추가");
        assert_eq!(without_server(&a, false), orig);
        // 우리가 만든 mcpServers는 비면 같이 지운다
        let a = with_server(&json!({"z": 1}), antigravity_entry(bin, rep)).unwrap();
        assert_eq!(without_server(&a, true), json!({"z": 1}));
        assert_eq!(without_server(&a, false), json!({"z": 1, "mcpServers": {}}));
        // 같은 이름의 다른 서버는 건드리지 않음
        let other = json!({"mcpServers": {"waitscape": {"command": "npx", "args": ["waitscape"]}}});
        assert_eq!(entry_state(other.get("mcpServers"), bin, rep), Entry::Other);
        assert_eq!(without_server(&other, true), other);
        assert!(with_server(&json!([1]), json!({})).is_none());
        assert!(with_server(&json!({"mcpServers": []}), json!({})).is_none());
    }

    #[test]
    fn cli_args() {
        let a = claude_add_args("/h/.claude/waiting-room/bin/wr-hook", "/h/.claude/waiting-room/reports.jsonl");
        assert_eq!(a[..6], ["mcp", "add", "-s", "user", "waitscape", "--"]);
        assert_eq!(a[7..], ["mcp", "--reports", "/h/.claude/waiting-room/reports.jsonl"]);
        assert_eq!(claude_remove_args().last().unwrap(), "waitscape");
    }
}

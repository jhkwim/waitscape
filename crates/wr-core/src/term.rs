//! 멀티플렉서 이동 정보 (이슈 #37·#40) — 훅(wr-hook)·MCP 사이드카와 상태 엔진이 함께 쓴다 (Python: `mcp_report.py` `MUX`·`mux_term`·`mux_jump`).
//!
//! 멀티플렉서(세션이 도는 터미널 앱)마다 **어댑터 표**(`ADAPTERS`) 한 줄: 종류 이름, 읽을 env(허용 목록)와 필드, 필드별 형식 검증.
//! 지금은 Orca·cmux 두 줄. 다른 앱은 공식 문서·실제 기기로 env와 ID 형식을 확인한 뒤 줄을 더한다.
//!
//! - 읽는 환경 변수는 표에 적힌 것뿐 — Orca: `ORCA_TERMINAL_HANDLE`, `ORCA_WORKTREE_PATH` / cmux: `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`.
//!   `ORCA_*TOKEN*`(에이전트 훅·실행 토큰), `CMUX_*TOKEN*`, `CMUX_SOCKET_PASSWORD`, 소켓 경로 같은 다른 값은 읽지도 기록하지도 않는다.
//! - Orca 터미널 핸들은 `term_` + UUID(`8-4-4-4-12` 16진수) 또는 `term_` + 16진수 32자(원격 생성 핸들)만 받는다(Orca 1.4 소스에서 확인한 발급 형식).
//!   런타임이 발급하는 값이라 Orca를 다시 켜면 바뀔 수 있다 → 앱이 worktree 경로로 다시 찾는다(`path`).
//!   worktree 경로는 절대 경로(`/…`, 윈도우 `C:\…`·`C:/…`·UNC `\\server\share…`·`\\?\C:\…`·`\\?\UNC\server\share…` — #61), 1–1024자, 제어 문자 없음.
//! - cmux ID는 UUID(`8-4-4-4-12` 16진수)나 짧은 참조(`workspace:2`, `surface:5` — 소문자 1–16자 + `:` + 숫자 1–6자리)만 받는다.
//! - 그 밖의 값은 버린다(`-`로 시작하는 값이 CLI 플래그로 읽히는 일도 없다).
//! - 표 순서: Orca가 먼저. cmux 셸에서 Orca를 띄우면 Orca 터미널이 `CMUX_*`를 물려받을 수 있지만, `ORCA_TERMINAL_HANDLE`은 Orca 터미널 안에서만 생긴다.
//! - 훅 이벤트: `"term": {"mux": {"kind": "cmux", "workspace": W, "surface": S}}` · `{"mux": {"kind": "orca", "surface": 핸들, "path": 경로}}`
//!   (필수 필드가 없거나 틀리면 term 자체가 없음, 선택 필드는 맞을 때만)
//! - 상태: 세션 `"jump": {"mux": {...}}` — 읽을 때 같은 표로 다시 검증한다(기록 파일을 믿지 않음).

use serde_json::{json, Map, Value};

/// 어댑터의 필드 하나: (필드 이름, 읽을 env 이름, 필수인가, 형식 검증)
pub type Field = (&'static str, &'static str, bool, fn(&str) -> bool);

/// 멀티플렉서 어댑터 한 줄
pub struct Adapter {
    /// `mux.kind` 값
    pub kind: &'static str,
    /// 이 env만 읽는다
    pub fields: &'static [Field],
}

/// 어댑터 표 (위에서부터 먼저 맞는 것)
pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        kind: "orca",
        fields: &[
            ("surface", "ORCA_TERMINAL_HANDLE", true, orca_handle_ok),
            ("path", "ORCA_WORKTREE_PATH", false, orca_path_ok),
        ],
    },
    Adapter {
        kind: "cmux",
        fields: &[
            ("workspace", "CMUX_WORKSPACE_ID", true, cmux_id_ok),
            ("surface", "CMUX_SURFACE_ID", false, cmux_id_ok),
        ],
    },
];

/// 읽어도 되는 환경 변수 전부 (어댑터 표의 env 이름)
pub fn env_allow() -> Vec<&'static str> {
    ADAPTERS.iter().flat_map(|a| a.fields.iter().map(|f| f.1)).collect()
}

fn uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn short_ref(s: &str) -> bool {
    let Some((k, n)) = s.split_once(':') else { return false };
    (1..=16).contains(&k.len())
        && k.bytes().all(|c| c.is_ascii_lowercase())
        && (1..=6).contains(&n.len())
        && n.bytes().all(|c| c.is_ascii_digit())
}

/// cmux 워크스페이스·패널 id로 받을 수 있는 값인가
pub fn cmux_id_ok(s: &str) -> bool {
    uuid(s) || short_ref(s)
}

fn hex32(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit())
}

/// Orca 터미널 핸들로 받을 수 있는 값인가 (`term_` + UUID 또는 16진수 32자)
pub fn orca_handle_ok(s: &str) -> bool {
    s.strip_prefix("term_").is_some_and(|h| uuid(h) || hex32(h))
}

/// 드라이브 문자 + `:` + 구분자(`seps` 중 하나)로 시작하는가
fn drive(s: &str, seps: &[u8]) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && seps.contains(&b[2])
}

/// `\\` 뒤 UNC `server\share…`: 서버·공유 이름 둘 다 비어 있지 않음. 서버가 `.`·`?`(장치 `\\.\pipe\…` 등)이면 아님
fn unc(r: &str) -> bool {
    let Some((server, share)) = r.split_once('\\') else { return false };
    !server.is_empty()
        && !server.contains('/')
        && !matches!(server, "." | "?")
        && share.chars().next().is_some_and(|c| !matches!(c, '\\' | '/'))
}

/// 절대 경로로 시작하는가: `/`, 윈도우 드라이브 `X:\`·`X:/`, UNC `\\server\share`, `\\?\X:\`·`\\?\UNC\server\share`
/// (`C:foo`·`dev\shop` 같은 상대 경로, `\\.\` 장치 경로, `\\?\GLOBALROOT\…`는 아님)
fn abs_head(s: &str) -> bool {
    if s.starts_with('/') || drive(s, b"\\/") {
        return true;
    }
    let Some(r) = s.strip_prefix(r"\\") else { return false };
    match r.strip_prefix(r"?\") {
        Some(v) => drive(v, b"\\") || v.strip_prefix(r"UNC\").is_some_and(unc),
        None => unc(r),
    }
}

/// Orca worktree 경로로 받을 수 있는 값인가 (절대 경로 — 맥 `/…`·윈도우 `C:\…`·UNC(#61), 1–1024자, 제어 문자 없음)
pub fn orca_path_ok(s: &str) -> bool {
    abs_head(s) && s.chars().count() <= 1024 && !s.chars().any(char::is_control)
}

/// 어댑터 하나로 값 만들기: 필수 필드가 다 맞을 때만, 선택 필드는 맞을 때만 넣는다
fn mux_value(a: &Adapter, get: impl Fn(&str, &str) -> Option<String>) -> Option<Value> {
    let mut m = Map::new();
    m.insert("kind".into(), json!(a.kind));
    for (field, env, required, ok) in a.fields {
        match get(field, env).filter(|v| ok(v)) {
            Some(v) => {
                m.insert((*field).into(), json!(v));
            }
            None if *required => return None,
            None => {}
        }
    }
    Some(json!({"mux": Value::Object(m)}))
}

/// 환경 → 훅 이벤트의 `term` 값. `get`은 어댑터 표의 env 이름으로만 불린다
pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Option<Value> {
    ADAPTERS.iter().find_map(|a| mux_value(a, |_, env| get(env)))
}

/// 기록된 `term` 값 → 세션 `jump` 값 (표로 다시 검증, 모르는 종류·키는 버림)
pub fn jump_of(term: &Value) -> Option<Value> {
    let m = term.get("mux")?;
    let kind = m.get("kind").and_then(|v| v.as_str())?;
    let a = ADAPTERS.iter().find(|a| a.kind == kind)?;
    mux_value(a, |field, _| m.get(field).and_then(|v| v.as_str()).map(String::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0";

    #[test]
    fn formats() {
        for ok in [W, "workspace:2", "surface:123456", "abcdef01-2345-6789-abcd-ef0123456789"] {
            assert!(cmux_id_ok(ok), "{ok}");
        }
        for bad in [
            "",
            "--workspace",
            "workspace:",
            ":2",
            "Workspace:2",
            "workspace:1234567",
            "workspace:2;rm",
            "workspace:2\n",
            "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F",
            "0F1E2D3C_4B5A-6978-8796-A5B4C3D2E1F0",
            "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1FG",
            "/tmp/cmux.sock",
        ] {
            assert!(!cmux_id_ok(bad), "{bad}");
        }
    }

    #[test]
    fn env_allowlist_only() {
        assert_eq!(
            env_allow(),
            ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH", "CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID"]
        );
        let asked = std::cell::RefCell::new(vec![]);
        let get = |k: &str| {
            asked.borrow_mut().push(k.to_string());
            match k {
                "CMUX_WORKSPACE_ID" => Some(W.to_string()),
                "CMUX_SURFACE_ID" => Some("surface:5".into()),
                _ => Some("secret".into()),
            }
        };
        assert_eq!(
            from_env(get),
            Some(json!({"mux": {"kind": "cmux", "workspace": W, "surface": "surface:5"}}))
        );
        assert!(asked.borrow().iter().all(|k| env_allow().contains(&k.as_str())));
        // 잘못된 surface는 빼고, 잘못된 workspace면 통째로 없음
        assert_eq!(
            from_env(|k| Some(if k == "CMUX_WORKSPACE_ID" { "workspace:1" } else { "x y" }.to_string())),
            Some(json!({"mux": {"kind": "cmux", "workspace": "workspace:1"}}))
        );
        assert_eq!(from_env(|k| (k == "CMUX_SURFACE_ID").then(|| "surface:1".to_string())), None);
        assert_eq!(from_env(|_| None), None);
    }

    const H: &str = "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";

    #[test]
    fn orca_formats() {
        for ok in [
            H,
            "term_3F2B1C0D-9E8F-4A7B-8C6D-5E4F3A2B1C0D",
            "term_0123456789abcdef0123456789abcdef",
        ] {
            assert!(orca_handle_ok(ok), "{ok}");
        }
        for bad in [
            "",
            "term_",
            "term_abc123",
            "--terminal",
            "TERM_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
            "3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
            "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d\n",
            "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d;rm",
            "term_0123456789abcdef0123456789abcde",
            "term_0123456789abcdef0123456789abcdef0",
            "term_0123456789abcdef0123456789abcdeg",
        ] {
            assert!(!orca_handle_ok(bad), "{bad}");
        }
        let long = format!("/{}", "a".repeat(1023));
        let win_long = format!(r"C:\{}", "a".repeat(1021));
        for ok in [
            "/",
            "/Users/alex/dev/shop",
            "/Users/알렉스/작업 폴더/shop",
            long.as_str(),
            r"C:\Users\alex\dev\shop",
            r"d:\work\작업 폴더",
            "C:/Users/alex/dev/shop",
            r"\\server\share\shop",
            r"\\nas\s",
            r"\\?\C:\Users\alex",
            r"\\?\UNC\nas\share\shop",
            win_long.as_str(),
        ] {
            assert!(orca_path_ok(ok), "{ok}");
        }
        let too_long = format!("/{}", "a".repeat(1024));
        let win_too_long = format!(r"C:\{}", "a".repeat(1022));
        for bad in [
            "",
            "relative/dir",
            "-x",
            "~/dev",
            "/tmp\n; echo",
            "/tmp\u{7f}",
            "/a\u{85}b",
            too_long.as_str(),
            "C:",
            "C:foo",
            r"dev\shop",
            r"\shop",
            r"\\",
            r"\\\server",
            r"\\a",
            r"\\a\",
            r"\\a/b",
            r"\\.\pipe\x",
            r"\\.\PhysicalDrive0",
            r"\\?\",
            r"\\?\GLOBALROOT\Device\x",
            r"\\?\C:/x",
            r"\\?\UNC\nas",
            r"\\?\UNC\.\pipe\x",
            "1:/x",
            r"CD:\x",
            "C:\\a\nb",
            win_too_long.as_str(),
        ] {
            assert!(!orca_path_ok(bad), "{bad:?}");
        }
    }

    /// Orca: 핸들·경로 두 env만 읽고 토큰류는 묻지도 않는다. 경로가 틀리면 빼고, 핸들이 틀리면 Orca가 아님
    #[test]
    fn orca_env_allowlist_only() {
        let asked = std::cell::RefCell::new(vec![]);
        let get = |k: &str| {
            asked.borrow_mut().push(k.to_string());
            match k {
                "ORCA_TERMINAL_HANDLE" => Some(H.to_string()),
                "ORCA_WORKTREE_PATH" => Some("/Users/alex/dev/shop".into()),
                _ => Some("secret".into()),
            }
        };
        assert_eq!(
            from_env(get),
            Some(json!({"mux": {"kind": "orca", "surface": H, "path": "/Users/alex/dev/shop"}}))
        );
        assert_eq!(*asked.borrow(), ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH"]);
        assert_eq!(
            from_env(|k| (k == "ORCA_TERMINAL_HANDLE").then(|| H.to_string())),
            Some(json!({"mux": {"kind": "orca", "surface": H}}))
        );
        assert_eq!(
            from_env(|k| Some(if k == "ORCA_TERMINAL_HANDLE" { H } else { "rel/path" }.to_string())),
            Some(json!({"mux": {"kind": "orca", "surface": H}}))
        );
        assert_eq!(from_env(|k| (k == "ORCA_WORKTREE_PATH").then(|| "/x".to_string())), None);
        // Orca 터미널이 cmux 값을 물려받았어도 Orca가 먼저
        assert_eq!(
            from_env(|k| match k {
                "ORCA_TERMINAL_HANDLE" => Some(H.to_string()),
                "CMUX_WORKSPACE_ID" => Some("workspace:1".into()),
                _ => None,
            }),
            Some(json!({"mux": {"kind": "orca", "surface": H}}))
        );
        assert_eq!(
            jump_of(&json!({"mux": {"kind": "orca", "surface": H, "path": "/p", "workspace": "workspace:1", "token": "t"}})),
            Some(json!({"mux": {"kind": "orca", "surface": H, "path": "/p"}}))
        );
        assert_eq!(jump_of(&json!({"mux": {"kind": "orca", "path": "/p"}})), None);
    }

    /// Python `mux_jump`과 같은 골든 (fixtures/mux/term_cases.json `jump_cases`: 경계 길이·비ASCII 숫자·비문자열 값 등)
    #[test]
    fn jump_golden() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/mux/term_cases.json");
        let fx: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
        let cases = fx["jump_cases"].as_array().unwrap();
        assert!(cases.len() >= 10);
        for c in cases {
            assert_eq!(jump_of(&c["term"]).unwrap_or(Value::Null), c["jump"], "{}", c["term"]);
        }
    }

    #[test]
    fn jump_revalidates() {
        assert_eq!(
            jump_of(&json!({"mux": {"kind": "cmux", "workspace": W, "surface": "surface:5", "token": "x"}, "other": 1})),
            Some(json!({"mux": {"kind": "cmux", "workspace": W, "surface": "surface:5"}}))
        );
        assert_eq!(jump_of(&json!({"mux": {"kind": "cmux", "workspace": "; rm -rf ~"}})), None);
        assert_eq!(jump_of(&json!({"mux": {"kind": "cmux", "workspace": 3}})), None);
        assert_eq!(jump_of(&json!({"mux": {"kind": "other", "workspace": "workspace:1"}})), None);
        assert_eq!(jump_of(&json!({"mux": {"workspace": "workspace:1"}})), None);
        assert_eq!(jump_of(&json!({"cmux": {"workspace": "workspace:1"}})), None);
        assert_eq!(jump_of(&json!("mux")), None);
    }
}

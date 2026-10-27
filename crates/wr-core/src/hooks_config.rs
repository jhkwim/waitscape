//! Claude Code `settings.json` 훅 설치·제거 (ARCHITECTURE §5.2 `hooks_config`). 앱(설정 화면)과 CLI가 같이 쓴다.
//!
//! - **우리 항목만** 다룬다: 명령 경로가 `waiting-room/bin/wr-hook`(Windows `\`도 같게 취급)으로 끝나는 훅. 다른 훅은 그대로 둔다.
//! - exec form: `{"type":"command","command":"<절대 경로>","args":["event"]}` — 셸을 거치지 않으므로 인용 문제가 없다.
//! - 쓰기 절차: 읽기 → 파싱 실패면 **중단(덮어쓰지 않음)** → 바뀔 게 없으면 끝 → `settings.json.bak-waiting-room-<시각>` 백업 →
//!   쓰기 직전 mtime 재확인(그 사이 다른 프로그램이 고쳤으면 중단) → 임시 파일 + rename(원자적).
//! - 멱등: 설치를 두 번 해도 한 벌, 제거 후에는 원래 내용과 같다(우리가 비운 빈 배열·빈 `hooks`만 같이 지움).

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 등록할 이벤트와 matcher (hook.py 시절과 같은 목록)
pub const EVENTS: [(&str, Option<&str>); 9] = [
    ("SessionStart", None),
    ("UserPromptSubmit", None),
    ("PreToolUse", None),
    ("PostToolUse", Some("TaskCreate|TaskUpdate")),
    ("Notification", None),
    ("Stop", None),
    ("SessionEnd", None),
    ("SubagentStart", None),
    ("SubagentStop", None),
];

/// 우리 훅을 알아보는 경로 꼬리
pub const MARK: &str = "waiting-room/bin/wr-hook";
/// exec form 인자 (wr-hook은 인자를 보지 않지만 `args`가 있어야 셸 없이 실행된다)
pub const ARGS: [&str; 1] = ["event"];

fn norm(cmd: &str) -> String {
    cmd.replace('\\', "/")
}

/// 이 훅 항목(`{"type":"command","command":…}`)이 우리 것인가
pub fn is_ours(h: &Value) -> bool {
    h.get("command").and_then(|c| c.as_str()).is_some_and(|c| {
        let c = norm(c);
        let c = c.trim_end_matches(".exe");
        c.ends_with(MARK)
    })
}

fn our_hook(cmd: &str) -> Value {
    json!({"type": "command", "command": cmd, "args": ARGS, "timeout": 10})
}

/// 우리 항목을 모두 뺀 사본 (다른 훅·키 순서는 그대로)
pub fn removed(settings: &Value) -> Value {
    let mut out = settings.clone();
    let Some(hooks) = out.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return out;
    };
    let mut emptied = vec![];
    for (ev, groups) in hooks.iter_mut() {
        let Some(arr) = groups.as_array_mut() else { continue };
        let before = arr.len();
        let mut touched = false;
        arr.retain_mut(|g| {
            let Some(inner) = g.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
                return true;
            };
            let n = inner.len();
            inner.retain(|h| !is_ours(h));
            if inner.len() != n {
                touched = true;
                return !inner.is_empty();
            }
            true
        });
        if (touched || arr.len() != before) && arr.is_empty() {
            emptied.push(ev.clone());
        }
    }
    let changed = !emptied.is_empty();
    for ev in emptied {
        hooks.remove(&ev);
    }
    if changed && hooks.is_empty() {
        out.as_object_mut().map(|o| o.remove("hooks"));
    }
    out
}

/// 우리 항목을 (다시) 넣은 사본. 이미 같은 항목이면 결과는 입력과 같다.
pub fn merged(settings: &Value, cmd: &str) -> Value {
    let mut out = removed(settings);
    if !out.is_object() {
        out = Value::Object(Map::new());
    }
    let o = out.as_object_mut().unwrap();
    let hooks = o.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        *hooks = Value::Object(Map::new());
    }
    let hooks = hooks.as_object_mut().unwrap();
    for (ev, matcher) in EVENTS {
        let arr = hooks.entry(ev).or_insert_with(|| Value::Array(vec![]));
        if !arr.is_array() {
            *arr = Value::Array(vec![]);
        }
        let mut g = Map::new();
        if let Some(m) = matcher {
            g.insert("matcher".into(), json!(m));
        }
        g.insert("hooks".into(), json!([our_hook(cmd)]));
        arr.as_array_mut().unwrap().push(Value::Object(g));
    }
    // 이미 설치돼 있었다면 원래 위치 그대로가 더 낫다 → 결과가 같으면 입력을 돌려준다
    if same_install(settings, cmd) {
        return settings.clone();
    }
    out
}

/// 설치 상태
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Status {
    /// 우리 항목이 하나라도 있음
    pub installed: bool,
    /// 9개 이벤트 모두 이 명령(`cmd`)으로 등록됨
    pub complete: bool,
    /// 다른 경로의 wr-hook이 등록돼 있음(옛 설치 위치)
    pub stale: bool,
    /// 레거시 `hook.py` 등록이 남아 있음 (우리가 건드리지 않음 — 사용자에게 안내)
    pub legacy: bool,
    pub count: usize,
}

/// (이벤트, matcher, 명령, `args`가 우리 형식인가)
type Ours = (String, Option<String>, String, bool);

fn ours_in(settings: &Value) -> Vec<Ours> {
    let mut v = vec![];
    let Some(hooks) = settings.get("hooks").and_then(|h| h.as_object()) else {
        return v;
    };
    for (ev, groups) in hooks {
        for g in groups.as_array().into_iter().flatten() {
            let m = g.get("matcher").and_then(|m| m.as_str()).map(String::from);
            for h in g.get("hooks").and_then(|h| h.as_array()).into_iter().flatten() {
                if is_ours(h) {
                    v.push((
                        ev.clone(),
                        m.clone(),
                        h.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                        h.get("args") == Some(&json!(ARGS)),
                    ));
                }
            }
        }
    }
    v
}

fn same_install(settings: &Value, cmd: &str) -> bool {
    let have = ours_in(settings);
    have.len() == EVENTS.len()
        && EVENTS
            .iter()
            .all(|(ev, m)| have.iter().any(|(e, hm, c, a)| e == ev && hm.as_deref() == *m && c == cmd && *a))
        && have.iter().all(|(_, _, _, a)| *a)
}

pub fn status(settings: &Value, cmd: &str) -> Status {
    let have = ours_in(settings);
    let raw = norm(&settings.to_string());
    Status {
        installed: !have.is_empty(),
        complete: same_install(settings, cmd),
        stale: have.iter().any(|(_, _, c, _)| c != cmd),
        legacy: raw.contains("waiting-room/hook.py") || raw.contains("/hook.py\""),
        count: have.len(),
    }
}

/// 사람이 읽는 변경 요약 (확인 대화상자용). `+ 이벤트[matcher]: 명령` / `- …`
pub fn diff(before: &Value, after: &Value) -> Vec<String> {
    let a = ours_in(before);
    let b = ours_in(after);
    // args가 없는 옛 항목은 "- …"(args 없음) / "+ …"(args 있음)으로 보여서 diff가 비지 않는다
    let fmt = |(e, m, c, a): &Ours| {
        format!(
            "{e}{}: {c}{}",
            m.as_ref().map(|m| format!("[{m}]")).unwrap_or_default(),
            if *a { format!(" {}", ARGS.join(" ")) } else { String::new() }
        )
    };
    let mut out: Vec<String> = a.iter().filter(|x| !b.contains(x)).map(|x| format!("- {}", fmt(x))).collect();
    out.extend(b.iter().filter(|x| !a.contains(x)).map(|x| format!("+ {}", fmt(x))));
    out
}

#[derive(Debug)]
pub enum HookError {
    /// settings.json이 JSON이 아님 → 덮어쓰지 않는다
    Parse,
    /// 최상위가 객체가 아님
    NotObject,
    /// 읽은 뒤 다른 프로그램이 파일을 고침
    Changed,
    Io(String),
}

impl std::fmt::Display for HookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HookError::Parse => write!(f, "settings.json을 해석할 수 없어 건드리지 않았어요"),
            HookError::NotObject => write!(f, "settings.json 최상위가 객체가 아니라 건드리지 않았어요"),
            HookError::Changed => write!(f, "그 사이 settings.json이 바뀌었어요. 다시 시도해 주세요"),
            HookError::Io(e) => write!(f, "파일 오류: {e}"),
        }
    }
}

/// 디스크에서 읽은 settings.json (없으면 빈 객체)
pub struct Loaded {
    pub value: Value,
    pub exists: bool,
    mtime: Option<SystemTime>,
}

pub fn load(path: &Path) -> Result<Loaded, HookError> {
    match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Loaded {
            value: json!({}),
            exists: false,
            mtime: None,
        }),
        Err(e) => Err(HookError::Io(e.kind().to_string())),
        Ok(raw) => {
            let mtime = std::fs::metadata(path).and_then(|m| m.modified()).ok();
            let v: Value = serde_json::from_slice(&raw).map_err(|_| HookError::Parse)?;
            if !v.is_object() {
                return Err(HookError::NotObject);
            }
            Ok(Loaded {
                value: v,
                exists: true,
                mtime,
            })
        }
    }
}

/// 쓰기 결과
#[derive(Debug, Clone, serde::Serialize)]
pub struct Report {
    pub changed: bool,
    pub backup: Option<PathBuf>,
    pub diff: Vec<String>,
}

/// `next`를 원자적으로 쓴다 (백업 + mtime 재확인 + 임시 파일 rename). `tag`는 백업 파일 이름 꼬리(시각)
pub fn write(path: &Path, loaded: &Loaded, next: &Value, tag: &str) -> Result<Report, HookError> {
    let diff = diff(&loaded.value, next);
    if *next == loaded.value {
        return Ok(Report {
            changed: false,
            backup: None,
            diff,
        });
    }
    let mut text = serde_json::to_string_pretty(next).map_err(|_| HookError::Parse)?;
    text.push('\n');
    let backup = write_raw(path, loaded.exists, loaded.mtime, text.as_bytes(), tag)?;
    Ok(Report {
        changed: true,
        backup,
        diff,
    })
}

/// 파일 수정 시각 (읽은 뒤 바뀌었는지 비교용)
pub fn mtime_of(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// 바이트를 원자적으로 쓴다 — `write`와 MCP 연결(TOML·JSON 원문 보존 편집)이 같이 쓰는 절차.
/// `exists`면 `<이름>.bak-waiting-room-<tag>` 백업(같은 이름이 있으면 `-2`, `-3`…) → `mtime`이 읽을 때와 같은지 재확인 →
/// 같은 폴더 임시 파일 + rename. 원본 권한·심볼릭 링크 유지, 새 파일은 0600. 백업 경로를 돌려준다.
pub fn write_raw(path: &Path, exists: bool, mtime: Option<SystemTime>, bytes: &[u8], tag: &str) -> Result<Option<PathBuf>, HookError> {
    let io = |e: std::io::Error| HookError::Io(e.kind().to_string());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("settings.json").to_string();
    let mut backup = None;
    if exists {
        let mut b = path.with_file_name(format!("{name}.bak-waiting-room-{tag}"));
        let mut n = 2;
        while b.exists() {
            b = path.with_file_name(format!("{name}.bak-waiting-room-{tag}-{n}"));
            n += 1;
        }
        std::fs::copy(path, &b).map_err(io)?;
        backup = Some(b);
    }
    if mtime_of(path) != mtime {
        return Err(HookError::Changed);
    }
    // 심볼릭 링크(dotfiles 관리)면 링크는 두고 가리키는 실제 파일을 갱신한다
    let target = if exists {
        std::fs::canonicalize(path).map_err(io)?
    } else {
        path.to_path_buf()
    };
    let tmp = target.with_file_name(format!(".{name}.tmp-waiting-room-{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(io)?;
    // 원본 권한 유지 (settings.json은 env 등 민감 값을 담을 수 있어 0600일 수 있다). 새 파일은 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&target).map(|m| m.permissions().mode() & 0o7777).unwrap_or(0o600);
        if let Err(e) = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode)) {
            std::fs::remove_file(&tmp).ok();
            return Err(io(e));
        }
    }
    #[cfg(not(unix))]
    if let Ok(m) = std::fs::metadata(&target) {
        std::fs::set_permissions(&tmp, m.permissions()).ok();
    }
    if let Err(e) = std::fs::rename(&tmp, &target) {
        std::fs::remove_file(&tmp).ok();
        return Err(io(e));
    }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: &str = "/Users/alex/.claude/waiting-room/bin/wr-hook";

    fn sample() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo mine"}]}],
                "Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]
            },
            "statusLine": {"type": "command", "command": "x"}
        })
    }

    #[test]
    fn merge_preserves_and_is_idempotent() {
        let s = sample();
        let m = merged(&s, CMD);
        assert_eq!(m["model"], "opus");
        assert_eq!(m["hooks"]["PreToolUse"][0]["hooks"][0]["command"], "echo mine");
        assert_eq!(m["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        assert_eq!(m["hooks"]["PostToolUse"][0]["matcher"], "TaskCreate|TaskUpdate");
        assert_eq!(m["hooks"]["SessionStart"][0]["hooks"][0]["args"], json!(["event"]));
        let st = status(&m, CMD);
        assert!(st.installed && st.complete && !st.stale && st.count == 9);
        assert_eq!(merged(&m, CMD), m, "두 번 설치해도 같음");
        assert_eq!(removed(&m), s, "제거하면 원래대로");
        assert_eq!(removed(&s), s);
        assert!(!status(&s, CMD).installed);
    }

    #[test]
    fn empty_and_stale() {
        let m = merged(&json!({}), CMD);
        assert_eq!(removed(&m), json!({}), "우리가 만든 hooks 객체는 같이 지움");
        let old = merged(&json!({}), "C:\\Users\\alex\\.claude\\waiting-room\\bin\\wr-hook.exe");
        let st = status(&old, CMD);
        assert!(st.installed && st.stale && !st.complete);
        let fixed = merged(&old, CMD);
        assert!(status(&fixed, CMD).complete && !status(&fixed, CMD).stale);
        // 다른 사람이 만든 빈 배열은 건드리지 않음
        let s = json!({"hooks": {"Stop": []}});
        assert_eq!(removed(&s), s);
        assert!(!is_ours(&json!({"command": "/x/wr-hook-like"})));
        let d = diff(&json!({}), &m);
        assert_eq!(d.len(), 9);
        assert!(d.iter().all(|l| l.starts_with("+ ")));
    }

    #[test]
    fn file_roundtrip_with_backup() {
        let dir = std::env::temp_dir().join(format!("wr-hooks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        let orig = serde_json::to_string_pretty(&sample()).unwrap();
        std::fs::write(&p, &orig).unwrap();
        let l = load(&p).unwrap();
        let r = write(&p, &l, &merged(&l.value, CMD), "t1").unwrap();
        assert!(r.changed && r.backup.as_ref().unwrap().exists());
        assert_eq!(std::fs::read_to_string(r.backup.unwrap()).unwrap(), orig);
        let l = load(&p).unwrap();
        assert!(status(&l.value, CMD).complete);
        let r = write(&p, &l, &merged(&l.value, CMD), "t2").unwrap();
        assert!(!r.changed && r.backup.is_none(), "바뀔 게 없으면 쓰지 않음");
        let r = write(&p, &l, &removed(&l.value), "t3").unwrap();
        assert!(r.changed);
        assert_eq!(load(&p).unwrap().value, sample());
        // 깨진 JSON은 덮어쓰지 않음
        std::fs::write(&p, "{ not json").unwrap();
        assert!(matches!(load(&p), Err(HookError::Parse)));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ not json");
        // 없는 파일: 새로 만들고 백업 없음
        let q = dir.join("sub").join("settings.json");
        let l = load(&q).unwrap();
        let r = write(&q, &l, &merged(&l.value, CMD), "t4").unwrap();
        assert!(r.changed && r.backup.is_none() && q.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_entries_without_args_are_updated() {
        // args 없이 등록된 옛 항목: 완전 설치가 아니고, diff가 비지 않아 [훅 켜기]가 동작한다
        let mut old = merged(&json!({}), CMD);
        for g in old["hooks"].as_object_mut().unwrap().values_mut() {
            g[0]["hooks"][0].as_object_mut().unwrap().remove("args");
        }
        let st = status(&old, CMD);
        assert!(st.installed && !st.complete);
        let next = merged(&old, CMD);
        assert!(status(&next, CMD).complete);
        let d = diff(&old, &next);
        assert_eq!(d.len(), 18, "{d:?}");
        assert!(d.iter().any(|l| l.starts_with("- ") && !l.ends_with("event")));
        assert!(d.iter().any(|l| l.starts_with("+ ") && l.ends_with("event")));
    }

    #[cfg(unix)]
    #[test]
    fn write_keeps_mode_and_symlink() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!("wr-hooks-perm-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("dotfiles")).unwrap();
        std::fs::create_dir_all(dir.join("home")).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        // 1) 0600 일반 파일 → 0600 유지
        let p = dir.join("home/settings.json");
        std::fs::write(&p, serde_json::to_string(&sample()).unwrap()).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        let l = load(&p).unwrap();
        let r = write(&p, &l, &merged(&l.value, CMD), "p1").unwrap();
        assert!(r.changed);
        assert_eq!(mode(&p), 0o600);
        assert!(status(&load(&p).unwrap().value, CMD).complete);
        // 2) 심볼릭 링크 → 링크 유지, 대상 파일이 갱신되고 권한 유지
        let real = dir.join("dotfiles/settings.json");
        std::fs::write(&real, serde_json::to_string(&sample()).unwrap()).unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o640)).unwrap();
        let link = dir.join("home/link.json");
        symlink(&real, &link).unwrap();
        let l = load(&link).unwrap();
        let r = write(&link, &l, &merged(&l.value, CMD), "p2").unwrap();
        assert!(r.changed);
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "링크가 그대로");
        assert_eq!(std::fs::read_link(&link).unwrap(), real);
        assert!(status(&load(&real).unwrap().value, CMD).complete, "대상 파일이 갱신됨");
        assert_eq!(mode(&real), 0o640);
        // 3) 새 파일은 0600
        let q = dir.join("home/new/settings.json");
        let l = load(&q).unwrap();
        write(&q, &l, &merged(&l.value, CMD), "p3").unwrap();
        assert_eq!(mode(&q), 0o600);
        std::fs::remove_dir_all(&dir).ok();
    }
}

//! 터미널로 이동 (ARCHITECTURE §3.6). 훅의 터미널 힌트(tty·세션 id)는 아직 없으므로 **세션 cwd에서 터미널/편집기 열기**까지만 한다.
//! - macOS: `/usr/bin/open -a <앱> <cwd>` — 인자 배열(셸 없음), 앱 이름은 화이트리스트. VS Code·Cursor는 그 폴더 창이 있으면 앞으로 온다.
//! - Windows: `wt -d <cwd>` (Windows Terminal). 없으면 "unsupported" → 프론트가 cwd를 클립보드로 복사.
//!
//! - 멀티플렉서(#37): 세션에 `jump.mux = {kind, workspace, surface?}`(훅이 `wr_core::term` 어댑터 표의 허용 목록 env로 기록)가 있고
//!   설정이 `auto`나 그 kind면 **kind별 명령 생성 함수**(`mux_cmds` → 지금은 `cmux_cmds`만)가 만든 명령을 차례로 실행한다(`jump_mux`).
//!   cmux: 번들 CLI `select-workspace --workspace <w>` → `focus-panel --panel <s> --workspace <w>` → `open -a cmux`(앞으로).
//!   셸 없이 인자 배열·명령마다 타임아웃. 워크스페이스가 닫혔으면(소켓은 됨, 읽기 전용 `workspace list`로 확인) 앱만 앞으로,
//!   소켓도 안 되면 앱 실행 여부(`ps -axo comm=`, 읽기 전용)로 나눠 꺼져 있으면 "mux-off", 켜져 있는데 막혔으면(외부 접근 끔·비밀번호) "mux-denied"
//!   → 프론트가 경로를 복사하고 이유를 알린다. CLI가 없으면 원래 방식.
//! - Orca(#40): 세션 `jump.mux = {kind: "orca", surface: 터미널 핸들, path?: worktree 경로}` → `orca_cmds`/`jump_orca`.
//!   `orca terminal switch --terminal <핸들> --json` → 실패하면(핸들은 런타임이 발급해 Orca를 다시 켜면 바뀜) 읽기 전용 `orca status --json`으로 나눈다:
//!   런타임에 닿으면 `orca terminal list --worktree path:<경로> --json`에서 `orca_pick` 규칙으로 하나 골라 switch, 못 고르면 앱만 앞으로("mux-app");
//!   앱이 꺼져 있으면 앱만 띄움("mux-launch", 실패하면 "mux-off" → 경로 복사); 켜져 있는데 닿지 않으면 "mux-denied"(경로 복사).
//!   성공하면 앱을 앞으로. 앞으로·띄우기 = 맥 `open <찾은 번들>`, 윈도우(#54) `Orca.exe`를 인자 없이(단일 인스턴스라 기존 창이 앞으로, 기다리지 않음).
//!   CLI·앱은 PATH를 보지 않고 `orca_find`(실행 중 프로세스 → 레지스트리·Spotlight → 고정 후보, 설치 폴더 안인지 검증)로 찾는다.
//!
//! 탭 단위 포커스(AppleScript `tty` 매칭)는 터미널 힌트가 생긴 뒤(P4 이후)로 미룬다.
//! cargo feature `terminal-jump`를 끄면(Mac App Store 플레이버) 다른 앱을 실행하지 않고 늘 "unsupported"(→ 프론트가 경로 복사).

use crate::mcp_connect::Runner;
use crate::orca_find::Install;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// 설정값 → macOS 앱 이름
fn mac_app(pref: &str) -> &'static str {
    match pref {
        "iTerm" => "iTerm",
        "Visual Studio Code" => "Visual Studio Code",
        "Cursor" => "Cursor",
        "Ghostty" => "Ghostty",
        "WezTerm" => "WezTerm",
        "Warp" => "Warp",
        "cmux" => "cmux",
        _ => "Terminal",
    }
}

/// cwd 검증: 절대 경로이고 존재하는 폴더, 제어 문자 없음
pub fn cwd_ok(cwd: &str) -> bool {
    let p = Path::new(cwd);
    !cwd.is_empty() && p.is_absolute() && !cwd.chars().any(|c| c.is_control()) && p.is_dir()
}

/// 실행할 명령(프로그램, 인자). 테스트를 위해 실행과 분리
pub fn command_for(cwd: &str, pref: &str) -> Option<(String, Vec<String>)> {
    if !cwd_ok(cwd) {
        return None;
    }
    if cfg!(target_os = "macos") {
        Some(("/usr/bin/open".into(), vec!["-a".into(), mac_app(pref).into(), cwd.into()]))
    } else if cfg!(windows) {
        Some(("wt".into(), vec!["-d".into(), cwd.into()]))
    } else {
        None
    }
}

/// 멀티플렉서 이동 대상 (세션 `jump` 값을 `term::jump_of`로 다시 검증한 것만)
#[derive(Debug, Clone, PartialEq)]
pub struct Mux {
    /// `wr_core::term::ADAPTERS`의 kind ("orca" | "cmux")
    pub kind: &'static str,
    /// cmux 워크스페이스 (cmux는 필수)
    pub workspace: Option<String>,
    /// cmux 패널 · Orca 터미널 핸들 (Orca는 필수)
    pub surface: Option<String>,
    /// Orca worktree 경로 (핸들이 바뀌었을 때 다시 찾기)
    pub path: Option<String>,
}

impl Mux {
    pub fn of(jump: &Value) -> Option<Mux> {
        let j = wr_core::term::jump_of(jump)?;
        let m = &j["mux"];
        let kind = wr_core::term::ADAPTERS.iter().find(|a| m["kind"] == a.kind)?.kind;
        let s = |k: &str| m.get(k).and_then(|v| v.as_str()).map(String::from);
        Some(Mux {
            kind,
            workspace: s("workspace"),
            surface: s("surface"),
            path: s("path"),
        })
    }
}

/// 실행할 명령 하나 (프로그램, 인자 배열)
pub type Cmd = (PathBuf, Vec<String>);

/// 멀티플렉서 하나로 이동하는 명령들 (kind별 생성 함수가 만든다)
#[derive(Debug, PartialEq)]
pub struct MuxCmds {
    /// 차례로 실행. 첫 명령(워크스페이스 선택)이 성공해야 이동한 것으로 치고, 나머지(패널 포커스)는 실패해도 넘어간다
    pub go: Vec<Cmd>,
    /// 첫 명령이 실패했을 때 읽기 전용 확인: 성공하면 대상만 닫힌 것(앱만 앞으로), 실패하면 접근이 막힌 것
    pub probe: Cmd,
    /// 앱을 앞으로
    pub front: Cmd,
    /// probe도 실패했을 때 앱이 실행 중인지 확인: (읽기 전용 명령, stdout에 이 줄이 있으면 실행 중).
    /// 꺼져 있으면 "mux-off", 켜져 있는데 안 되면 "mux-denied"(외부 접근이 막힘)
    pub running: Option<(Cmd, String)>,
}

fn args(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// cmux 번들 CLI 후보 (PATH는 보지 않는다)
pub fn cmux_cli(home: &Path) -> Option<PathBuf> {
    const REL: &str = "cmux.app/Contents/Resources/bin/cmux";
    [PathBuf::from("/Applications").join(REL), home.join("Applications").join(REL)]
        .into_iter()
        .find(|p| p.is_file())
}

/// cmux 명령 생성 (`cmux help navigate`·`cmux <cmd> --help`로 확인한 형식)
pub fn cmux_cmds(cli: &Path, m: &Mux) -> MuxCmds {
    let ws = m.workspace.as_deref().unwrap_or_default();
    let mut go = vec![(cli.to_path_buf(), args(&["select-workspace", "--workspace", ws]))];
    if let Some(sf) = &m.surface {
        // --workspace를 꼭 준다(없으면 CLI가 자기 env의 CMUX_WORKSPACE_ID를 씀)
        go.push((cli.to_path_buf(), args(&["focus-panel", "--panel", sf, "--workspace", ws])));
    }
    // 앱 본체: <앱>/Contents/Resources/bin/cmux → <앱>/Contents/MacOS/cmux. ps의 comm(실행 파일 전체 경로)과 정확히 비교
    let main = cli
        .ancestors()
        .nth(3)
        .map(|c| c.join("MacOS").join("cmux").to_string_lossy().into_owned());
    MuxCmds {
        go,
        probe: (cli.to_path_buf(), args(&["workspace", "list"])),
        front: (PathBuf::from("/usr/bin/open"), args(&["-a", "cmux"])),
        running: main.map(|m| ((PathBuf::from("/bin/ps"), args(&["-axo", "comm="])), m)),
    }
}

/// Orca로 이동하는 명령 재료 (`orca <cmd> --help`·`orca agent-context`로 확인한 형식)
#[derive(Debug, PartialEq)]
pub struct OrcaCmds {
    pub cli: PathBuf,
    /// 세션 터미널 핸들 (`term_…`, 검증된 값)
    pub handle: String,
    /// worktree 경로 (검증된 절대 경로)
    pub path: Option<String>,
    /// 앱을 앞으로 (앱이 꺼져 있으면 띄움)
    pub front: Cmd,
}

impl OrcaCmds {
    /// 그 터미널 탭으로 (`--terminal`을 꼭 준다. 없으면 CLI가 자기 env·cwd의 활성 터미널을 고름)
    pub fn switch(&self, handle: &str) -> Cmd {
        (self.cli.clone(), args(&["terminal", "switch", "--terminal", handle, "--json"]))
    }
    /// worktree의 터미널 목록 (읽기 전용)
    pub fn list(&self, path: &str) -> Cmd {
        (
            self.cli.clone(),
            args(&["terminal", "list", "--worktree", &format!("path:{path}"), "--json"]),
        )
    }
    /// 앱·런타임 상태 (읽기 전용, 앱이 꺼져 있어도 답함)
    pub fn status(&self) -> Cmd {
        (self.cli.clone(), args(&["status", "--json"]))
    }
}

/// Orca 명령 생성 (`orca_find`로 찾은 설치). 핸들이 없으면 None (→ 원래 방식)
pub fn orca_cmds(inst: &Install, m: &Mux) -> Option<OrcaCmds> {
    Some(OrcaCmds {
        cli: inst.cli.clone(),
        handle: m.surface.clone()?,
        path: m.path.clone(),
        front: inst.front(),
    })
}

/// kind별 이동 방법
#[derive(Debug, PartialEq)]
pub enum Jump {
    Cmux(MuxCmds),
    Orca(OrcaCmds),
}

/// kind별 명령 생성. 설치되지 않았거나 모르는 kind면 None (→ 원래 방식). `run`은 Orca 찾기의 읽기 전용 조회(프로세스·레지스트리·Spotlight)
pub fn mux_cmds(m: &Mux, home: &Path, run: Runner) -> Option<Jump> {
    let orca_os = cfg!(target_os = "macos") || cfg!(windows);
    match m.kind {
        "cmux" if m.workspace.is_some() => cmux_cli(home).map(|cli| Jump::Cmux(cmux_cmds(&cli, m))),
        "orca" if m.surface.is_some() && orca_os => {
            let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
            let inst = crate::orca_find::find(home, local.as_deref(), cfg!(windows), run)?;
            orca_cmds(&inst, m).map(Jump::Orca)
        }
        _ => None,
    }
}

/// kind별 이동 실행 → `jump_mux`·`jump_orca`의 결과
pub fn run_jump(j: &Jump, run: impl Fn(&Path, &[String]) -> Result<String, String>) -> &'static str {
    match j {
        Jump::Cmux(c) => jump_mux(c, run),
        Jump::Orca(c) => jump_orca(c, run),
    }
}

/// Orca CLI 응답이 성공인가: 종료 코드 0이고, JSON이면 `"ok": false`가 아님
fn orca_ok(r: Result<String, String>) -> Option<String> {
    let out = r.ok()?;
    let failed = serde_json::from_str::<Value>(&out).is_ok_and(|v| v.get("ok") == Some(&Value::Bool(false)));
    (!failed).then_some(out)
}

/// worktree 경로 비교 키. 맥·리눅스 `/…`는 끝 `/`만 떼고 그대로(대소문자 구분).
/// 윈도우 형태(드라이브 `X:`·`\\`로 시작, #61)는 `/`→`\`, `\\?\UNC\`→`\\`·`\\?\` 접두사 제거, 끝 `\` 제거, 대소문자 무시
fn path_key(p: &str) -> String {
    let b = p.as_bytes();
    let win = (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') || p.starts_with(r"\\");
    if !win {
        return p.trim_end_matches('/').to_string();
    }
    let p = p.replace('/', r"\");
    let p = match (p.strip_prefix(r"\\?\UNC\"), p.strip_prefix(r"\\?\")) {
        (Some(r), _) => format!(r"\\{r}"),
        (None, Some(r)) => r.to_string(),
        _ => p,
    };
    p.trim_end_matches('\\').to_lowercase()
}

/// 핸들이 바뀌었을 때 고를 터미널 (ARCHITECTURE §3.6 "Orca 다시 찾기 규칙"):
/// `terminal list --json`의 `result.terminals[]` 중 ① 핸들 형식이 맞고 원래(만료된) 핸들이 아니며 ② `worktreePath`가 세션 경로와 같고(`path_key`로 비교)
/// ③ `connected: true`인 것만. 그중 ④ 에이전트가 도는 창(`agentIdentity` 있음)을 먼저, ⑤ 그다음 `lastOutputAt`이 가장 늦은 것, ⑥ 같으면 목록 앞쪽
pub fn orca_pick(out: &str, path: &str, stale: &str) -> Option<String> {
    let v: Value = serde_json::from_str(out).ok()?;
    let want = path_key(path);
    let mut best: Option<((u8, f64), String)> = None;
    for t in v.pointer("/result/terminals")?.as_array()? {
        let Some(h) = t.get("handle").and_then(|x| x.as_str()) else {
            continue;
        };
        let same = t.get("worktreePath").and_then(|x| x.as_str()).is_some_and(|p| path_key(p) == want);
        if h == stale || !wr_core::term::orca_handle_ok(h) || !same || t.get("connected") != Some(&Value::Bool(true)) {
            continue;
        }
        let key = (
            u8::from(t.get("agentIdentity").is_some_and(|a| !a.is_null())),
            t.get("lastOutputAt").and_then(|x| x.as_f64()).unwrap_or(f64::NEG_INFINITY),
        );
        if best.as_ref().is_none_or(|(k, _)| key > *k) {
            best = Some((key, h.to_string()));
        }
    }
    best.map(|(_, h)| h)
}

/// Orca 이동 실행 → "mux"(이동) | "mux-app"(터미널을 못 찾아 앱만 앞으로) | "mux-launch"(꺼져 있어 앱만 띄움)
/// | "mux-off"(꺼져 있고 띄우지도 못함) | "mux-denied"(켜져 있는데 닿지 않음). 뒤의 둘은 프론트가 경로 복사
pub fn jump_orca(c: &OrcaCmds, run: impl Fn(&Path, &[String]) -> Result<String, String>) -> &'static str {
    let call = |(p, a): &Cmd| orca_ok(run(p, a));
    let front = || run(&c.front.0, &c.front.1).is_ok();
    if call(&c.switch(&c.handle)).is_some() {
        front();
        return "mux";
    }
    let st = call(&c.status()).and_then(|o| serde_json::from_str::<Value>(&o).ok());
    let flag = |p: &str| st.as_ref().and_then(|v| v.pointer(p)).and_then(|x| x.as_bool());
    match (flag("/result/app/running"), flag("/result/runtime/reachable")) {
        (_, Some(true)) => {
            let again = c
                .path
                .as_deref()
                .and_then(|p| call(&c.list(p)).and_then(|o| orca_pick(&o, p, &c.handle)))
                .is_some_and(|h| call(&c.switch(&h)).is_some());
            front();
            if again {
                "mux"
            } else {
                "mux-app"
            }
        }
        (Some(false), _) => {
            if front() {
                "mux-launch"
            } else {
                "mux-off"
            }
        }
        _ => "mux-denied",
    }
}

/// 명령 하나당 시간 제한
pub const MUX_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
/// Orca 찾기 조회 하나당 시간 제한 (윈도우 PowerShell은 처음 뜰 때 몇 초 걸릴 수 있다)
pub const FIND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// 앱 본체 실행(윈도우 `Orca.exe`): 기다리지 않는다. 꺼져 있던 앱이면 계속 떠 있어야 하므로 시간 제한·자손 정리 대상이 아니다.
/// GUI 앱이라 콘솔 창이 없어 CREATE_NO_WINDOW도 주지 않는다(자식 프로세스에 물려주지 않게)
pub fn spawn_app(prog: &Path, args: &[String]) -> Result<String, String> {
    use std::process::Stdio;
    std::process::Command::new(prog)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| String::new())
        .map_err(|e| format!("실행 실패: {:?}", e.kind()))
}

/// 이동 실행. `run`은 (프로그램, 인자 배열) 실행기(테스트에서 가짜로 바꿈) →
/// "mux"(이동) | "mux-app"(대상이 닫혀 앱만 앞으로) | "mux-off"(앱이 꺼져 있음) | "mux-denied"(켜져 있는데 접근 실패). 뒤의 둘은 프론트가 경로 복사
pub fn jump_mux(c: &MuxCmds, run: impl Fn(&Path, &[String]) -> Result<String, String>) -> &'static str {
    let ok = |(p, a): &Cmd| run(p, a).is_ok();
    let mut go = c.go.iter();
    if go.next().is_some_and(ok) {
        go.for_each(|x| {
            ok(x);
        });
        ok(&c.front);
        return "mux";
    }
    if ok(&c.probe) {
        ok(&c.front);
        return "mux-app";
    }
    match &c.running {
        Some(((p, a), main)) => match run(p, a) {
            Ok(out) if !out.lines().any(|l| l.trim() == main) => "mux-off",
            _ => "mux-denied",
        },
        None => "mux-denied",
    }
}

/// 멀티플렉서로 갈지: 설정이 "auto"이거나 세션의 kind와 같을 때만(다른 터미널을 고른 사용자는 원래대로).
/// `os` = `std::env::consts::OS`: cmux는 macOS만, Orca는 macOS·Windows(#54)
pub fn route<'a>(pref: &str, mux: Option<&'a Mux>, os: &str) -> Option<&'a Mux> {
    mux.filter(|m| (pref == "auto" || pref == m.kind) && (os == "macos" || (os == "windows" && m.kind == "orca")))
}

/// "opened" | "unsupported" | "mux" | "mux-app" | "mux-launch" | "mux-off" | "mux-denied"
#[cfg(feature = "terminal-jump")]
pub fn open(cwd: &str, pref: &str, mux: Option<&Mux>, home: &Path) -> &'static str {
    use crate::mcp_connect::run_with_timeout;
    if let Some(m) = route(pref, mux, std::env::consts::OS) {
        let find = |p: &Path, a: &[String]| run_with_timeout(p, a, None, FIND_TIMEOUT);
        if let Some(c) = mux_cmds(m, home, &find) {
            // 윈도우 Orca.exe(앞으로·띄우기)는 기다리지 않고 띄운다
            let app = match &c {
                Jump::Orca(o) if cfg!(windows) => Some(o.front.0.clone()),
                _ => None,
            };
            let r = run_jump(&c, |p, a| {
                if app.as_deref() == Some(p) {
                    spawn_app(p, a)
                } else {
                    run_with_timeout(p, a, None, MUX_TIMEOUT)
                }
            });
            crate::wlog!("jump", "{} 이동 결과 {r}", m.kind);
            return r;
        }
    }
    let Some((prog, args)) = command_for(cwd, pref) else {
        return "unsupported";
    };
    match std::process::Command::new(prog).args(&args).status() {
        Ok(s) if s.success() => "opened",
        _ => "unsupported",
    }
}

/// 터미널 이동을 뺀 빌드: 아무것도 실행하지 않는다
#[cfg(not(feature = "terminal-jump"))]
pub fn open(_cwd: &str, _pref: &str, _mux: Option<&Mux>, _home: &Path) -> &'static str {
    "unsupported"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_not_shell() {
        let d = std::env::temp_dir();
        let cwd = d.to_string_lossy().to_string();
        if cfg!(target_os = "macos") {
            let (p, a) = command_for(&cwd, "iTerm").unwrap();
            assert_eq!(p, "/usr/bin/open");
            assert_eq!(a, vec!["-a", "iTerm", cwd.as_str()]);
            assert_eq!(
                command_for(&cwd, "; rm -rf ~").unwrap().1[1],
                "Terminal",
                "모르는 앱 이름은 Terminal"
            );
        }
        assert!(command_for("relative/dir", "auto").is_none());
        assert!(command_for("/definitely/not/here", "auto").is_none());
        assert!(command_for("/tmp\n; echo", "auto").is_none());
    }

    use serde_json::json;
    use std::cell::RefCell;

    const W: &str = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

    fn mux(ws: &str, sf: Option<&str>) -> Mux {
        Mux {
            kind: "cmux",
            workspace: Some(ws.into()),
            surface: sf.map(String::from),
            path: None,
        }
    }

    /// 가짜 실행기: 부른 명령을 적고, `fail`에 든 첫 인자(또는 프로그램 이름)면 실패
    fn fake<'a>(log: &'a RefCell<Vec<String>>, fail: &'a [&'a str]) -> impl Fn(&Path, &[String]) -> Result<String, String> + 'a {
        move |p: &Path, a: &[String]| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            log.borrow_mut().push(format!("{name} {}", a.join(" ")));
            let first = a.first().map(String::as_str).unwrap_or("");
            if fail.contains(&first) || fail.contains(&name.as_str()) {
                Err("시간 초과".into())
            } else {
                Ok(String::new())
            }
        }
    }

    #[test]
    fn mux_of_revalidates() {
        assert_eq!(
            Mux::of(&json!({"mux": {"kind": "cmux", "workspace": W, "surface": "surface:5"}})),
            Some(mux(W, Some("surface:5")))
        );
        assert_eq!(Mux::of(&json!({"mux": {"kind": "cmux", "workspace": "--socket-password=x"}})), None);
        assert_eq!(Mux::of(&json!({"mux": {"kind": "unknown", "workspace": "workspace:1"}})), None);
        assert_eq!(Mux::of(&json!(null)), None);
        // 모르는 kind는 명령을 만들지 않음(→ 원래 방식)
        assert!(mux_cmds(
            &Mux {
                kind: "unknown",
                ..mux(W, None)
            },
            Path::new("/nonexistent"),
            &|_: &Path, _: &[String]| -> Result<String, String> { panic!("모르는 kind는 아무것도 실행하지 않음") }
        )
        .is_none());
    }

    #[test]
    fn cmux_args_in_order() {
        let cli = Path::new("/Applications/cmux.app/Contents/Resources/bin/cmux");
        let c = cmux_cmds(cli, &mux(W, Some("surface:5")));
        let log = RefCell::new(vec![]);
        assert_eq!(jump_mux(&c, fake(&log, &[])), "mux");
        assert_eq!(
            *log.borrow(),
            [
                format!("cmux select-workspace --workspace {W}"),
                format!("cmux focus-panel --panel surface:5 --workspace {W}"),
                "open -a cmux".to_string(),
            ]
        );
        // 패널이 닫혀도 워크스페이스까지는 이동
        let log = RefCell::new(vec![]);
        assert_eq!(jump_mux(&c, fake(&log, &["focus-panel"])), "mux");
        assert_eq!(log.borrow().last().unwrap(), "open -a cmux");
        // surface가 없으면 focus-panel을 부르지 않음
        let log = RefCell::new(vec![]);
        assert_eq!(jump_mux(&cmux_cmds(cli, &mux("workspace:2", None)), fake(&log, &[])), "mux");
        assert_eq!(*log.borrow(), ["cmux select-workspace --workspace workspace:2", "open -a cmux"]);
    }

    #[test]
    fn cmux_fallbacks() {
        let cli = Path::new("/Applications/cmux.app/Contents/Resources/bin/cmux");
        let c = cmux_cmds(cli, &mux(W, Some("surface:5")));
        let main = "/Applications/cmux.app/Contents/MacOS/cmux";
        assert_eq!(c.running.as_ref().unwrap().1, main, "앱 본체 경로는 CLI 경로에서");
        // 워크스페이스가 닫힘(소켓은 됨) → 앱만 앞으로
        let log = RefCell::new(vec![]);
        assert_eq!(jump_mux(&c, fake(&log, &["select-workspace"])), "mux-app");
        assert_eq!(
            *log.borrow(),
            [
                format!("cmux select-workspace --workspace {W}"),
                "cmux workspace list".into(),
                "open -a cmux".into()
            ]
        );
        // 소켓이 안 되고 앱도 안 떠 있음(ps에 본체 없음) → mux-off. 아무 앱도 띄우지 않는다
        let ps = |out: &'static str| {
            move |p: &Path, a: &[String]| -> Result<String, String> {
                if p == Path::new("/bin/ps") {
                    assert_eq!(a, ["-axo", "comm="]);
                    Ok(out.to_string())
                } else if p == Path::new("/usr/bin/open") {
                    panic!("실패하면 앱을 띄우지 않는다")
                } else {
                    Err("시간 초과".into())
                }
            }
        };
        assert_eq!(
            jump_mux(&c, ps("/sbin/launchd\n/Applications/cmux.app/Contents/Resources/bin/cmux\n")),
            "mux-off"
        );
        // 앱은 떠 있는데 소켓이 안 됨(외부 접근 끔·비밀번호) → mux-denied
        assert_eq!(
            jump_mux(&c, ps("/sbin/launchd\n/Applications/cmux.app/Contents/MacOS/cmux\n")),
            "mux-denied"
        );
        // ps까지 실패하면 보수적으로 denied
        let log = RefCell::new(vec![]);
        assert_eq!(jump_mux(&c, fake(&log, &["cmux", "ps"])), "mux-denied");
        assert!(!log.borrow().iter().any(|l| l.starts_with("open")));
    }

    const H: &str = "term_3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
    const H2: &str = "term_0123456789abcdef0123456789abcdef";
    const OCLI: &str = "/Applications/Orca.app/Contents/Resources/bin/orca";

    fn mac_install(cli: &Path) -> Install {
        Install {
            app: PathBuf::from("/Applications/Orca.app"),
            cli: cli.to_path_buf(),
            win: false,
            via: "고정",
        }
    }

    fn orca(path: Option<&str>) -> OrcaCmds {
        let m = Mux::of(&json!({"mux": {"kind": "orca", "surface": H, "path": path}})).unwrap();
        orca_cmds(&mac_install(Path::new(OCLI)), &m).unwrap()
    }

    /// 가짜 orca: (인자 앞 두 개 → 응답). 없는 명령은 실패. 부른 명령을 적는다
    fn fake_orca<'a>(
        log: &'a RefCell<Vec<String>>,
        resp: &'a [(&'a str, Result<&'a str, &'a str>)],
    ) -> impl Fn(&Path, &[String]) -> Result<String, String> + 'a {
        move |p: &Path, a: &[String]| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            let line = format!("{name} {}", a.join(" "));
            log.borrow_mut().push(line.clone());
            resp.iter()
                .find(|(k, _)| line.starts_with(k))
                .map(|(_, r)| r.map(String::from).map_err(String::from))
                .unwrap_or(Err("종료 코드 1".into()))
        }
    }

    const UP: &str = r#"{"ok": true, "result": {"app": {"running": true}, "runtime": {"reachable": true}}}"#;
    const DOWN: &str =
        r#"{"ok": true, "result": {"app": {"running": false, "pid": null}, "runtime": {"state": "not_running", "reachable": false}}}"#;
    const STUCK: &str = r#"{"ok": true, "result": {"app": {"running": true}, "runtime": {"reachable": false}}}"#;

    #[test]
    fn orca_of_and_args() {
        let m = Mux::of(&json!({"mux": {"kind": "orca", "surface": H, "path": "/w", "token": "t"}})).unwrap();
        assert_eq!(
            (m.kind, m.surface.as_deref(), m.path.as_deref(), m.workspace.as_deref()),
            ("orca", Some(H), Some("/w"), None)
        );
        assert_eq!(Mux::of(&json!({"mux": {"kind": "orca", "surface": "--terminal"}})), None);
        let c = orca(Some("/Users/alex/dev/shop"));
        assert_eq!(c.switch(H).1, ["terminal", "switch", "--terminal", H, "--json"]);
        assert_eq!(
            c.list("/Users/alex/dev/shop").1,
            ["terminal", "list", "--worktree", "path:/Users/alex/dev/shop", "--json"]
        );
        assert_eq!(c.status().1, ["status", "--json"]);
        assert_eq!(c.front, (PathBuf::from("/usr/bin/open"), args(&["/Applications/Orca.app"])));
        // 바로 이동: switch → open <번들>. 목록·상태는 부르지 않음
        let log = RefCell::new(vec![]);
        let r = jump_orca(
            &c,
            fake_orca(&log, &[("orca terminal switch", Ok(r#"{"ok": true}"#)), ("open", Ok(""))]),
        );
        assert_eq!(r, "mux");
        assert_eq!(
            *log.borrow(),
            [
                format!("orca terminal switch --terminal {H} --json"),
                "open /Applications/Orca.app".into()
            ]
        );
        // 종료 코드 0이어도 JSON "ok": false면 실패로 본다
        let log = RefCell::new(vec![]);
        let r = jump_orca(
            &c,
            fake_orca(
                &log,
                &[
                    (
                        "orca terminal switch",
                        Ok(r#"{"ok": false, "error": {"code": "terminal_handle_stale"}}"#),
                    ),
                    ("orca status", Ok(STUCK)),
                ],
            ),
        );
        assert_eq!(r, "mux-denied");
    }

    /// 핸들이 바뀌었을 때(Orca 재시작 등): 목록에서 다시 골라 switch
    #[test]
    fn orca_retarget() {
        let c = orca(Some("/Users/alex/dev/shop"));
        let list = format!(
            r#"{{"ok": true, "result": {{"terminals": [
              {{"handle": "{H}", "worktreePath": "/Users/alex/dev/shop", "connected": true, "lastOutputAt": 99}},
              {{"handle": "term_11111111-1111-4111-8111-111111111111", "worktreePath": "/Users/alex/dev/shop", "connected": true, "lastOutputAt": 50}},
              {{"handle": "{H2}", "worktreePath": "/Users/alex/dev/shop/", "connected": true, "lastOutputAt": 10, "agentIdentity": {{"agent": "claude"}}}}
            ]}}}}"#
        );
        let log = RefCell::new(vec![]);
        let resp = [
            ("orca terminal switch --terminal term_3f2b", Err("terminal_handle_stale")),
            ("orca terminal switch", Ok(r#"{"ok": true}"#)),
            ("orca status", Ok(UP)),
            ("orca terminal list", Ok(list.as_str())),
            ("open", Ok("")),
        ];
        assert_eq!(jump_orca(&c, fake_orca(&log, &resp)), "mux");
        assert_eq!(
            *log.borrow(),
            [
                format!("orca terminal switch --terminal {H} --json"),
                "orca status --json".into(),
                "orca terminal list --worktree path:/Users/alex/dev/shop --json".into(),
                format!("orca terminal switch --terminal {H2} --json"),
                "open /Applications/Orca.app".into(),
            ]
        );
        // 고를 터미널이 없으면 앱만 앞으로
        let log = RefCell::new(vec![]);
        let resp = [
            ("orca status", Ok(UP)),
            ("orca terminal list", Ok(r#"{"ok": true, "result": {"terminals": []}}"#)),
            ("open", Ok("")),
        ];
        assert_eq!(jump_orca(&c, fake_orca(&log, &resp)), "mux-app");
        assert_eq!(log.borrow().last().unwrap(), "open /Applications/Orca.app");
        // 경로가 없으면 목록을 부르지 않고 앱만 앞으로
        let log = RefCell::new(vec![]);
        assert_eq!(
            jump_orca(&orca(None), fake_orca(&log, &[("orca status", Ok(UP)), ("open", Ok(""))])),
            "mux-app"
        );
        assert!(!log.borrow().iter().any(|l| l.contains("list")));
    }

    #[test]
    fn orca_pick_rules() {
        let p = "/w";
        let t = |h: &str, path: &str, conn: Value, at: Value, agent: bool| {
            let mut o = json!({"handle": h, "worktreePath": path, "connected": conn, "lastOutputAt": at});
            if agent {
                o["agentIdentity"] = json!({"agent": "codex"});
            }
            o
        };
        let out = |ts: Vec<Value>| json!({"ok": true, "result": {"terminals": ts}}).to_string();
        let a = "term_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let b = "term_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        // 에이전트가 도는 창이 먼저 (출력이 더 오래됐어도)
        assert_eq!(
            orca_pick(
                &out(vec![t(a, p, json!(true), json!(9), false), t(b, p, json!(true), json!(1), true)]),
                p,
                H
            )
            .as_deref(),
            Some(b)
        );
        // 그다음 최근 출력, 같으면 앞쪽
        assert_eq!(
            orca_pick(
                &out(vec![t(a, p, json!(true), json!(1), false), t(b, p, json!(true), json!(2), false)]),
                p,
                H
            )
            .as_deref(),
            Some(b)
        );
        assert_eq!(
            orca_pick(
                &out(vec![
                    t(a, p, json!(true), json!(null), false),
                    t(b, p, json!(true), json!(null), false)
                ]),
                p,
                H
            )
            .as_deref(),
            Some(a)
        );
        // 원래 핸들·다른 worktree·끊긴 터미널·형식이 틀린 핸들은 고르지 않음
        for bad in [
            t(H, p, json!(true), json!(9), true),
            t(a, "/other", json!(true), json!(9), true),
            t(a, "/w2", json!(true), json!(9), true),
            t(a, p, json!(false), json!(9), true),
            t(a, p, json!(null), json!(9), true),
            t("--terminal", p, json!(true), json!(9), true),
        ] {
            assert_eq!(orca_pick(&out(vec![bad.clone()]), p, H), None, "{bad}");
        }
        // 윈도우 경로(#61): 드라이브 대소문자·구분자·`\\?\` 접두사·끝 `\` 차이는 같은 경로
        let w = r"C:\Users\alex\Dev\Shop";
        for same in [
            r"C:\Users\alex\Dev\Shop\",
            r"c:/users/alex/dev/shop/",
            r"\\?\C:\Users\alex\dev\shop",
        ] {
            let picked = orca_pick(&out(vec![t(a, same, json!(true), json!(1), false)]), w, H);
            assert_eq!(picked.as_deref(), Some(a), "{same}");
        }
        let u = r"\\nas\share\shop";
        for same in [r"\\?\UNC\nas\share\shop", r"\\NAS\Share\shop\"] {
            let picked = orca_pick(&out(vec![t(a, same, json!(true), json!(1), false)]), u, H);
            assert_eq!(picked.as_deref(), Some(a), "{same}");
        }
        for other in [r"C:\Users\alex\Dev\Shop2", r"D:\Users\alex\Dev\Shop", r"\\nas\share\shop\x"] {
            assert_eq!(
                orca_pick(&out(vec![t(a, other, json!(true), json!(1), false)]), w, H),
                None,
                "{other}"
            );
        }
        // 맥·리눅스 경로는 대소문자를 구분하고 `\`를 구분자로 보지 않음
        let m = "/Users/alex/Shop";
        assert_eq!(
            orca_pick(&out(vec![t(a, "/Users/alex/Shop/", json!(true), json!(1), false)]), m, H).as_deref(),
            Some(a)
        );
        for other in ["/Users/alex/shop", r"/Users/alex/Shop\"] {
            assert_eq!(
                orca_pick(&out(vec![t(a, other, json!(true), json!(1), false)]), m, H),
                None,
                "{other}"
            );
        }
        assert_eq!(orca_pick("not json", p, H), None);
        assert_eq!(orca_pick(r#"{"ok": false}"#, p, H), None);
    }

    /// 꺼져 있으면 앱만 띄우고, 그것도 안 되면 mux-off(경로 복사). 켜져 있는데 닿지 않으면 mux-denied
    #[test]
    fn orca_fallbacks() {
        let c = orca(Some("/w"));
        let log = RefCell::new(vec![]);
        assert_eq!(
            jump_orca(&c, fake_orca(&log, &[("orca status", Ok(DOWN)), ("open", Ok(""))])),
            "mux-launch"
        );
        assert!(!log.borrow().iter().any(|l| l.contains("list")), "꺼져 있으면 목록을 부르지 않음");
        let log = RefCell::new(vec![]);
        assert_eq!(jump_orca(&c, fake_orca(&log, &[("orca status", Ok(DOWN))])), "mux-off");
        let deny = |resp: &[(&str, Result<&str, &str>)]| {
            let log = RefCell::new(vec![]);
            let r = jump_orca(&c, fake_orca(&log, resp));
            assert!(!log.borrow().iter().any(|l| l.starts_with("open")), "막혔으면 앱을 띄우지 않는다");
            r
        };
        assert_eq!(deny(&[("orca status", Ok(STUCK))]), "mux-denied");
        assert_eq!(deny(&[]), "mux-denied", "status도 실패");
        assert_eq!(deny(&[("orca status", Ok("garbage"))]), "mux-denied");
    }

    /// 윈도우(#54): 앞으로·띄우기 = 찾은 Orca.exe를 인자 없이 (open -a 없음)
    #[test]
    fn orca_windows_front() {
        let inst = Install {
            app: PathBuf::from("C:/Users/alex/AppData/Local/Programs/orca/Orca.exe"),
            cli: PathBuf::from("C:/Users/alex/AppData/Local/Programs/orca/resources/bin/orca.exe"),
            win: true,
            via: "프로세스",
        };
        let m = Mux::of(&json!({"mux": {"kind": "orca", "surface": H}})).unwrap();
        let c = orca_cmds(&inst, &m).unwrap();
        assert_eq!(c.front, (inst.app.clone(), vec![]));
        let log = RefCell::new(vec![]);
        let resp = [("orca.exe terminal switch", Ok(r#"{"ok": true}"#)), ("Orca.exe", Ok(""))];
        assert_eq!(jump_orca(&c, fake_orca(&log, &resp)), "mux");
        assert_eq!(
            *log.borrow(),
            [format!("orca.exe terminal switch --terminal {H} --json"), "Orca.exe ".into()]
        );
        // 꺼져 있으면 Orca.exe로 띄움
        let log = RefCell::new(vec![]);
        let resp = [("orca.exe status", Ok(DOWN)), ("Orca.exe", Ok(""))];
        assert_eq!(jump_orca(&c, fake_orca(&log, &resp)), "mux-launch");
        // 핸들 없는 orca는 명령을 만들지 않음
        let m = Mux {
            kind: "orca",
            workspace: None,
            surface: None,
            path: Some("/w".into()),
        };
        assert!(orca_cmds(&inst, &m).is_none());
    }

    /// 실제 타임아웃 실행기 + 응답 없는 가짜 orca(스크립트): 제한 시간 안에 denied로 끝나고 손자 프로세스도 남지 않는다
    #[cfg(unix)]
    #[test]
    fn orca_timeout_real_runner() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("wr-fake-orca-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let cli = d.join("orca");
        let pidf = d.join("pid");
        std::fs::write(&cli, format!("#!/bin/sh\nsleep 30 &\necho $! >> '{}'\nwait\n", pidf.display())).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let m = Mux::of(&json!({"mux": {"kind": "orca", "surface": H, "path": "/w"}})).unwrap();
        let c = orca_cmds(&mac_install(&cli), &m).unwrap();
        let t = std::time::Instant::now();
        let limit = std::time::Duration::from_millis(1000);
        let r = jump_orca(&c, |p, a| {
            assert_ne!(p, Path::new("/usr/bin/open"), "실패하면 앱을 띄우지 않는다");
            crate::mcp_connect::run_with_timeout(p, a, None, limit)
        });
        assert_eq!(r, "mux-denied");
        assert!(t.elapsed() < std::time::Duration::from_secs(8), "{:?}", t.elapsed());
        std::thread::sleep(std::time::Duration::from_millis(100));
        for pid in std::fs::read_to_string(&pidf).unwrap().split_whitespace() {
            let alive = std::process::Command::new("/bin/kill")
                .args(["-0", pid])
                .status()
                .unwrap()
                .success();
            assert!(!alive, "손자 프로세스 {pid}가 남음");
        }
        std::fs::remove_dir_all(&d).ok();
    }

    /// 설정별 분기 (PR #39 리뷰 🔵3): auto·같은 kind면 멀티플렉서로, 다른 터미널을 골랐으면 원래대로. cmux는 macOS만, Orca는 Windows도(#54)
    #[test]
    fn route_by_pref() {
        let m = mux(W, None);
        let o = Mux::of(&json!({"mux": {"kind": "orca", "surface": H}})).unwrap();
        for (pref, mx, os, want) in [
            ("auto", &m, "macos", true),
            ("cmux", &m, "macos", true),
            ("iTerm", &m, "macos", false),
            ("Terminal", &m, "macos", false),
            ("auto", &m, "windows", false),
            ("cmux", &m, "linux", false),
            ("auto", &o, "macos", true),
            ("auto", &o, "windows", true),
            ("orca", &o, "windows", true),
            ("Windows Terminal", &o, "windows", false),
            ("auto", &o, "linux", false),
        ] {
            assert_eq!(route(pref, Some(mx), os).is_some(), want, "{pref} {} {os}", mx.kind);
        }
        assert!(route("cmux", None, "macos").is_none());
        // cmux를 골랐는데 이 세션은 cmux 밖 → 원래 방식: open -a cmux <cwd>
        if cfg!(target_os = "macos") {
            let cwd = std::env::temp_dir().to_string_lossy().to_string();
            assert_eq!(command_for(&cwd, "cmux").unwrap().1, ["-a", "cmux", cwd.as_str()]);
        }
    }

    /// 실제 타임아웃 실행기 + 응답 없는 가짜 cmux(스크립트): 제한 시간 안에 denied로 끝난다
    #[cfg(unix)]
    #[test]
    fn cmux_timeout_real_runner() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("wr-fake-cmux-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let cli = d.join("cmux");
        // 래퍼가 손자(sleep)를 띄우고 기다림 → 시간 초과 때 그룹째 끝나야 한다(PR #39 리뷰 🔵1)
        let pidf = d.join("pid");
        std::fs::write(&cli, format!("#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n", pidf.display())).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let c = cmux_cmds(&cli, &mux("workspace:1", None));
        let t = std::time::Instant::now();
        // 병렬 테스트로 바쁠 때도 sh가 손자 pid를 적을 시간(너무 짧으면 손자를 띄우기 전에 끝남)
        let limit = std::time::Duration::from_millis(1000);
        let r = jump_mux(&c, |p, a| {
            assert_ne!(p, Path::new("/usr/bin/open"), "실패하면 앱을 띄우지 않는다");
            crate::mcp_connect::run_with_timeout(p, a, None, limit)
        });
        assert!(matches!(r, "mux-denied" | "mux-off"), "{r}");
        assert!(t.elapsed() < std::time::Duration::from_secs(8), "{:?}", t.elapsed());
        let pid = std::fs::read_to_string(&pidf).unwrap().trim().to_string();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let alive = std::process::Command::new("/bin/kill")
            .args(["-0", &pid])
            .status()
            .unwrap()
            .success();
        assert!(!alive, "손자 프로세스 {pid}가 남음");
        std::fs::remove_dir_all(&d).ok();
    }
}

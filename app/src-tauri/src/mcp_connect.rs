//! MCP 보고 연결·해제 (설정 → AI 연결 → MCP 보고). 대상 3개: Claude Code · Codex CLI · Antigravity CLI (ARCHITECTURE §8.5).
//!
//! | CLI | 어디에 | 근거 |
//! |---|---|---|
//! | Claude Code | `claude mcp add -s user waitscape -- <bin> mcp --reports <abs>` → `~/.claude.json`(Claude Code가 씀) + 선택: `settings.json` `permissions.allow`에 도구 2개 | <https://code.claude.com/docs/en/mcp> · <https://code.claude.com/docs/en/permissions> |
//! | Codex CLI | `$CODEX_HOME/config.toml`(기본 `~/.codex/config.toml`) `[mcp_servers.waitscape]` `command`·`args`·`enabled_tools`·`env_vars` | <https://learn.chatgpt.com/docs/extend/mcp?surface=cli> |
//! | Antigravity CLI | `~/.gemini/config/mcp_config.json` `mcpServers.waitscape` `command`·`args`·`enabledTools` | <https://antigravity.google/docs/mcp?tab=cli> |
//!
//! - `~/.claude.json`은 Claude Code가 수시로 다시 쓰는 큰 파일이라 직접 고치지 않고 공식 CLI로만 바꾼다(실행 전에 백업 사본은 남김).
//! - Codex `env_vars`("Environment variables to allow and forward", 위 문서)에는 멀티플렉서 이동 env(`term::env_allow()`, 지금은 Orca 두 개·cmux 두 개)만 넣는다(#37·#40).
//!   Orca·cmux 밖에서는 값이 없어 아무것도 넘어가지 않는다. Orca 토큰류(`ORCA_AGENT_HOOK_TOKEN` 등)는 넣지 않는다. Antigravity는 고정 값을 넣는 `env`뿐이라(전달 옵션이 문서에 없음) 넣지 않는다.
//! - Codex의 도구별 `approval_mode`는 문서에 값 의미(`approve` 등)가 없어 쓰지 않는다. Antigravity는 trust 옵션이 문서에 없다.
//! - 미리보기·확인 창에는 **우리 항목 줄만**(파일 경로 + 넣을/뺄 블록 + "그 외 내용은 그대로/서식만") 보여 주고, 문맥 줄은 없다.
//!   다른 서버의 env 토큰·settings.json env 값이 화면에 나오지 않게. 표시 줄은 `report::clean`(마스킹)을 한 번 더 거친다.
//! - 쓰기 절차(파일): 읽기 → 없거나 해석 실패면 **중단**(Claude settings.json만 예외: 없으면 `{}`로 새로 만듦) → 미리보기 → 사용자 확인(네이티브 창) → 백업
//!   `<이름>.bak-waiting-room-<시각>` → mtime 재확인 → 임시 파일 + rename (`hooks_config::write_raw`).
//! - 연결 기록 `<Claude 루트>/waiting-room/mcp-connect.json`: 우리가 **새로 넣은** 것만 적는다(연결 전부터 있던 서버 항목·권한 규칙·
//!   부모 키는 해제 때 남김). **마지막으로 우리가 쓴 한 번**의 전후 sha256·백업을 적어 두고, 해제 때 파일이 그 바이트 그대로일 때만 백업을
//!   되돌린다(바이트 동일). 다시 연결하면 기준을 그 쓰기로 갱신한다(사이에 생긴 사용자 편집을 지우지 않게). 그 밖에는 우리 항목만 구조적으로
//!   지운다(JSON 키 순서·들여쓰기, TOML 주석·순서, CRLF 보존).
//! - Claude: CLI가 성공하면 파일 쓰기 전에 기록부터 저장(뒤가 실패해도 앱에서 해제 가능). 옛 경로를 고치다 remove 뒤 add가 실패하면
//!   `claude mcp add-json`으로 원래 등록을 되돌린다.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};
use wr_core::hooks_config as hc;
use wr_core::mcp_config::{self as mc, Entry};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cli {
    Claude,
    Codex,
    Antigravity,
}

impl Cli {
    pub const ALL: [Cli; 3] = [Cli::Claude, Cli::Codex, Cli::Antigravity];

    pub fn id(self) -> &'static str {
        match self {
            Cli::Claude => "claude",
            Cli::Codex => "codex",
            Cli::Antigravity => "antigravity",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Cli::Claude => "Claude Code",
            Cli::Codex => "Codex CLI",
            Cli::Antigravity => "Antigravity CLI",
        }
    }

    /// 실행 파일 이름 (Antigravity CLI는 `agy`)
    pub fn bin_name(self) -> &'static str {
        match self {
            Cli::Claude => "claude",
            Cli::Codex => "codex",
            Cli::Antigravity => "agy",
        }
    }

    pub fn parse(s: &str) -> Option<Cli> {
        Cli::ALL.into_iter().find(|c| c.id() == s)
    }
}

/// 경로 묶음. 앱은 `from_env`, 테스트는 임시 폴더로 직접 만든다(실제 홈은 건드리지 않음)
#[derive(Clone, Debug)]
pub struct McpPaths {
    pub home: PathBuf,
    /// Claude Code 사용자 설정(`~/.claude.json`, `CLAUDE_CONFIG_DIR`이 있으면 그 안)
    pub claude_json: PathBuf,
    /// 권한 규칙을 넣는 `settings.json`
    pub claude_settings: PathBuf,
    pub codex_config: PathBuf,
    pub antigravity_config: PathBuf,
    /// 고정 경로의 wr-hook (훅과 같은 파일)
    pub bin: PathBuf,
    pub reports: PathBuf,
    pub record: PathBuf,
    /// CLI 실행 파일 (찾지 못하면 None)
    pub clis: BTreeMap<&'static str, PathBuf>,
}

impl McpPaths {
    pub fn new(home: &Path, claude_root: &Path, claude_settings: &Path, bin: &Path, reports: &Path) -> McpPaths {
        let default_root = home.join(".claude");
        McpPaths {
            home: home.to_path_buf(),
            // Claude Code는 CLAUDE_CONFIG_DIR이 있으면 그 안의 .claude.json을 쓴다
            claude_json: if claude_root == default_root {
                home.join(".claude.json")
            } else {
                claude_root.join(".claude.json")
            },
            claude_settings: claude_settings.to_path_buf(),
            // CODEX_HOME은 앱 프로세스 env만 본다(Finder로 연 앱은 셸 env가 없음 → 기본 ~/.codex). 실제로 고칠 경로는 설정 화면 표에 그대로 보여 준다
            codex_config: std::env::var_os("CODEX_HOME")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("config.toml"),
            // 문서는 `~/.gemini/config/mcp_config.json`만 적는다. Windows의 `%USERPROFILE%\.gemini\config\…`는 문서에 없는 [추정]
            antigravity_config: home.join(".gemini").join("config").join("mcp_config.json"),
            bin: bin.to_path_buf(),
            reports: reports.to_path_buf(),
            record: claude_root.join("waiting-room").join("mcp-connect.json"),
            clis: BTreeMap::new(),
        }
    }

    /// 로그인 셸 PATH로 CLI를 찾는다 (Finder로 연 앱은 셸 PATH가 없음)
    pub fn find_clis(mut self) -> McpPaths {
        for c in Cli::ALL {
            if let Some(p) = which(c.bin_name(), &self.home) {
                self.clis.insert(c.id(), p);
            }
        }
        self
    }

    fn config_of(&self, cli: Cli) -> &Path {
        match cli {
            Cli::Claude => &self.claude_json,
            Cli::Codex => &self.codex_config,
            Cli::Antigravity => &self.antigravity_config,
        }
    }

    fn cmd(&self) -> String {
        self.bin.to_string_lossy().into_owned()
    }

    fn rep(&self) -> String {
        self.reports.to_string_lossy().into_owned()
    }
}

/* ---------- CLI 찾기·실행 ---------- */

/// 로그인 셸의 PATH + 흔한 설치 위치. 한 번만 계산
fn search_path(home: &Path) -> Vec<PathBuf> {
    use std::sync::OnceLock;
    static LOGIN: OnceLock<Option<String>> = OnceLock::new();
    let login = LOGIN.get_or_init(|| {
        if cfg!(windows) {
            return None;
        }
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| s.starts_with('/'))
            .unwrap_or_else(|| "/bin/zsh".into());
        let out = run_with_timeout(
            Path::new(&shell),
            &["-lc".into(), "printf %s \"$PATH\"".into()],
            None,
            Duration::from_secs(5),
        )
        .ok()?;
        Some(out.trim().to_string())
    });
    let mut v: Vec<PathBuf> = vec![];
    for src in [login.clone(), std::env::var("PATH").ok()].into_iter().flatten() {
        v.extend(std::env::split_paths(&src));
    }
    for d in [".local/bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".cargo/bin"] {
        v.push(home.join(d));
    }
    v.push("/opt/homebrew/bin".into());
    v.push("/usr/local/bin".into());
    v.retain(|p| p.is_absolute());
    v.dedup();
    v
}

fn which(name: &str, home: &Path) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd"] } else { &[""] };
    search_path(home)
        .into_iter()
        .flat_map(|d| exts.iter().map(move |e| d.join(format!("{name}{e}"))))
        .find(|p| p.is_file())
}

/// 시간 초과 때 자식과 그 자손(래퍼 스크립트가 띄운 손자)까지 끝낸다.
/// - unix: 자식을 새 프로세스 그룹(`process_group(0)` = setpgid)으로 띄우고 `killpg(SIGKILL)`. libc 의존성 대신 FFI 한 줄(wr-core pid 확인과 같은 방식)
/// - Windows: 시스템 `taskkill.exe /T /F /PID <자식>`(고정 경로, 부모 pid로 자손까지)을 부른 뒤 `kill`. Orca CLI(`orca.exe` 런처 → Electron Node)도
///   손자를 띄우므로(#54). Job Object는 windows-sys 의존성과 unsafe FFI가 더 필요하고, CI가 Windows에서 앱 크레이트를 빌드하지 않아 검증할 수 없어 쓰지 않는다(PR #39 리뷰 🔵1)
#[cfg(unix)]
fn kill_tree(child: &mut std::process::Child) {
    extern "C" {
        fn killpg(pgrp: i32, sig: i32) -> i32;
    }
    const SIGKILL: i32 = 9;
    // SAFETY: 우리가 만든 프로세스 그룹 id(= 자식 pid)에 신호만 보낸다
    if let Ok(pg) = i32::try_from(child.id()) {
        unsafe {
            killpg(pg, SIGKILL);
        }
    }
    child.kill().ok();
}

#[cfg(windows)]
fn kill_tree(child: &mut std::process::Child) {
    let mut tk = Command::new(r"C:\Windows\System32\taskkill.exe");
    tk.args(["/T", "/F", "/PID", &child.id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut tk);
    tk.status().ok();
    child.kill().ok();
}

#[cfg(not(any(unix, windows)))]
fn kill_tree(child: &mut std::process::Child) {
    child.kill().ok();
}

/// Windows: 콘솔 프로그램(Claude CLI·`orca.exe`·PowerShell·reg·taskkill)이 콘솔 창을 띄우지 않게 `CREATE_NO_WINDOW`
fn no_window(_cmd: &mut Command) {
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(_cmd, 0x0800_0000);
}

/// 셸 없이 절대 경로 + 인자 배열로 실행. stdout을 돌려주고, 실패·시간 초과면 짧은 오류 문구 (시간 초과면 프로세스 그룹째 끝냄).
/// 출력은 UTF-8이 아닌 바이트를 �로 바꿔 읽는다(윈도우 `reg.exe`는 시스템 코드 페이지로 써서, 다른 앱의 한글 이름 한 줄 때문에 전체를 잃지 않게)
pub fn run_with_timeout(prog: &Path, args: &[String], path_env: Option<&str>, limit: Duration) -> Result<String, String> {
    use std::io::Read;
    let mut cmd = Command::new(prog);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    no_window(&mut cmd);
    if let Some(p) = path_env {
        cmd.env("PATH", p);
    }
    let mut child = cmd.spawn().map_err(|e| format!("실행 실패: {}", e.kind()))?;
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let lossy = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut b = vec![];
            r.read_to_end(&mut b).ok();
            String::from_utf8_lossy(&b).into_owned()
        })
    };
    let t1 = lossy(Box::new(out));
    let t2 = lossy(Box::new(err));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                kill_tree(&mut child);
                child.wait().ok();
                return Err("시간 초과".into());
            }
        }
    };
    let stdout = t1.join().unwrap_or_default();
    let stderr = t2.join().unwrap_or_default();
    if status.success() {
        Ok(stdout)
    } else {
        // 오류 문구는 첫 줄만, 길이 제한 (CLI가 무엇을 출력할지 모르므로 마스킹)
        let line = stderr.lines().chain(stdout.lines()).find(|l| !l.trim().is_empty()).unwrap_or("");
        let line: String = wr_core::redact::redact(line).chars().take(160).collect();
        Err(format!("종료 코드 {}: {line}", status.code().unwrap_or(-1)))
    }
}

/// 테스트에서 바꿔 끼우는 CLI 실행기 (`prog`, `args`) → stdout
pub type Runner<'a> = &'a dyn Fn(&Path, &[String]) -> Result<String, String>;

pub fn default_runner(home: &Path) -> impl Fn(&Path, &[String]) -> Result<String, String> {
    let path = std::env::join_paths(search_path(home))
        .ok()
        .map(|p| p.to_string_lossy().into_owned());
    move |prog: &Path, args: &[String]| run_with_timeout(prog, args, path.as_deref(), Duration::from_secs(10))
}

/* ---------- 연결 기록 ---------- */

/// 마지막으로 우리가 그 파일을 쓴 한 번의 기록. 해제 때 "지금 파일 == after"이면(그 뒤로 아무도 안 고침) 백업(= 그 쓰기 직전 바이트)을 되돌린다
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileRec {
    /// 그 쓰기 직전 sha256
    pub before: String,
    /// 우리가 쓴 결과 sha256
    pub after: String,
    pub backup: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliRecord {
    pub at: u64,
    /// 서버 항목을 우리가 새로 넣었음 (false = 연결 전부터 있던 우리 형식 항목 → 해제 때 남김)
    #[serde(default)]
    pub server_added: bool,
    /// 부모 키(`mcpServers` / `[mcp_servers]`)를 우리가 만들었음
    #[serde(default)]
    pub created_parent: bool,
    #[serde(default)]
    pub file: Option<FileRec>,
    /// Claude: 우리가 넣은 권한 규칙
    #[serde(default)]
    pub allow: Option<mc::AllowAdded>,
    #[serde(default)]
    pub allow_file: Option<FileRec>,
    /// Claude: settings.json이 없어서 우리가 새로 만들었음 (해제 때 빈 객체만 남으면 지움)
    #[serde(default)]
    pub allow_created_file: bool,
    /// Codex: 우리가 `env_vars`에 더한 이름 (원래 있던 이름은 적지 않음 → 해제 때 이것만 뺀다, #37)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_added: Vec<String>,
    /// Codex: `env_vars` 키 자체를 우리가 만들었음 (해제 때 비면 키도 지움)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub env_created: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Record {
    pub v: u32,
    #[serde(default)]
    pub clis: BTreeMap<String, CliRecord>,
}

impl Record {
    pub fn load(p: &Path) -> Record {
        std::fs::read(p)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Record {
                v: 1,
                ..Default::default()
            })
    }

    fn save(&self, p: &Path) -> Result<(), String> {
        let mut text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        text.push('\n');
        // 우리 파일이라 백업 없이 임시 파일 + rename만
        let dir = p.parent().ok_or("경로 오류")?;
        std::fs::create_dir_all(dir).map_err(|e| e.kind().to_string())?;
        let tmp = dir.join(format!(".mcp-connect.tmp-{}", std::process::id()));
        std::fs::write(&tmp, text).map_err(|e| e.kind().to_string())?;
        std::fs::rename(&tmp, p).map_err(|e| {
            std::fs::remove_file(&tmp).ok();
            e.kind().to_string()
        })
    }

    /// 한 CLI 기록만 바꿔 저장 (None = 지움)
    fn put(p: &Path, cli: Cli, rec: Option<CliRecord>) -> Result<(), String> {
        let mut r = Record::load(p);
        r.v = 1;
        match rec {
            Some(x) => r.clis.insert(cli.id().into(), x),
            None => r.clis.remove(cli.id()),
        };
        r.save(p)
    }
}

/// SHA-256 소문자 16진 64자. 모드 설치 기록(`mode_install`)도 같은 형식을 쓴다
pub(crate) fn sha(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/* ---------- 파일 읽기 · 형식 ---------- */

struct Raw {
    bytes: Vec<u8>,
    mtime: Option<SystemTime>,
    exists: bool,
}

fn read_opt(p: &Path, home: &Path) -> Result<Option<Raw>, String> {
    match std::fs::read(p) {
        Ok(bytes) => Ok(Some(Raw {
            bytes,
            mtime: hc::mtime_of(p),
            exists: true,
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{} 읽기 실패: {}", short(p, home), e.kind())),
    }
}

fn read_raw(p: &Path, home: &Path) -> Result<Raw, String> {
    read_opt(p, home)?.ok_or_else(|| format!("{} 파일이 없어요 — 그 AI 도구를 한 번 실행한 뒤 다시 시도해 주세요", short(p, home)))
}

fn short(p: &Path, home: &Path) -> String {
    crate::commands::tilde(&p.to_string_lossy(), &home.to_string_lossy())
}

fn parse_json(raw: &Raw, p: &Path, home: &Path) -> Result<Value, String> {
    let v: Value = serde_json::from_slice(&raw.bytes).map_err(|_| format!("{}을(를) 해석할 수 없어 건드리지 않았어요", short(p, home)))?;
    if !v.is_object() {
        return Err(format!("{} 최상위가 객체가 아니라 건드리지 않았어요", short(p, home)));
    }
    Ok(v)
}

/// 원본이 CRLF면 결과도 CRLF로 (Windows에서 만든 파일을 통째로 LF로 바꾸지 않게)
pub fn eol_like(out: String, like: &str) -> String {
    if like.contains("\r\n") {
        out.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        out
    }
}

/// 원본의 들여쓰기·끝 줄바꿈·CRLF를 따라 JSON을 쓴다 (한 줄짜리 원본이면 한 줄로)
pub fn json_like(v: &Value, like: &[u8]) -> Vec<u8> {
    use serde::Serialize as _;
    let text = String::from_utf8_lossy(like);
    let trimmed = text.trim_end();
    let mut out = if !trimmed.contains('\n') && !trimmed.is_empty() {
        serde_json::to_vec(v).unwrap_or_default()
    } else {
        let indent: String = text
            .lines()
            .skip(1)
            .find(|l| l.starts_with([' ', '\t']))
            .map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').collect())
            .unwrap_or_else(|| "  ".into());
        let mut buf = vec![];
        let f = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, f);
        v.serialize(&mut ser).ok();
        buf
    };
    if text.ends_with('\n') || like.is_empty() {
        out.push(b'\n');
    }
    eol_like(String::from_utf8_lossy(&out).into_owned(), &text).into_bytes()
}

/// 화면에 보여 줄 명령 한 줄: 공백·특수문자가 있는 인자는 따옴표로 (실제 실행은 셸 없이 인자 배열)
pub fn shell_line(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            let plain = !a.is_empty() && a.chars().all(|c| c.is_ascii_alphanumeric() || "_-./:=@%+,~".contains(c));
            if plain {
                a.clone()
            } else if cfg!(windows) {
                format!("\"{}\"", a.replace('"', "\\\""))
            } else {
                format!("'{}'", a.replace('\'', "'\\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/* ---------- Codex (TOML, 원문 보존) ---------- */

fn toml_err(p: &Path, home: &Path) -> String {
    format!("{}을(를) 해석할 수 없어 건드리지 않았어요", short(p, home))
}

fn codex_table(doc: &toml_edit::DocumentMut) -> Option<&dyn toml_edit::TableLike> {
    doc.get("mcp_servers")
        .and_then(|s| s.as_table_like())
        .and_then(|t| t.get(mc::SERVER))
        .and_then(|e| e.as_table_like())
}

fn codex_state(doc: &toml_edit::DocumentMut, bin: &str, reports: &str) -> Entry {
    let present = doc
        .get("mcp_servers")
        .and_then(|s| s.as_table_like())
        .and_then(|t| t.get(mc::SERVER))
        .is_some();
    if !present {
        return Entry::None;
    }
    let Some(t) = codex_table(doc) else { return Entry::Other };
    let command = t.get("command").and_then(|c| c.as_str()).unwrap_or("");
    let args: Vec<&str> = t
        .get("args")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect())
        .unwrap_or_default();
    // 판정 규칙은 JSON과 같게(mcp_config::is_ours)
    if !mc::is_ours(&json!({"command": command, "args": args})) {
        return Entry::Other;
    }
    // env_vars에 멀티플렉서 env(#37·#40)가 다 있어야 최신. 없으면(PR #36 때 연결 · Orca 전 cmux 두 개만) Stale → "다시 연결" 안내
    let names = env_names(t.get("env_vars"));
    let env_ok = wr_core::term::env_allow().iter().all(|e| names.iter().any(|n| n == e));
    if command == bin && args == mc::server_args(reports) && env_ok {
        Entry::Ours
    } else {
        Entry::Stale
    }
}

/// `env_vars` 항목의 이름들: 문자열 또는 `{ name = "...", source = ... }` 표
fn env_names(item: Option<&toml_edit::Item>) -> Vec<String> {
    let Some(a) = item.and_then(|i| i.as_array()) else { return vec![] };
    a.iter()
        .filter_map(|v| {
            v.as_str()
                .or_else(|| v.as_inline_table().and_then(|t| t.get("name")).and_then(|n| n.as_str()))
                .map(String::from)
        })
        .collect()
}

fn str_array<'a>(items: impl IntoIterator<Item = &'a str>) -> toml_edit::Item {
    toml_edit::value(toml_edit::Array::from_iter(items))
}

/// `codex_with` 결과
pub struct CodexWith {
    pub text: String,
    /// 부모 표 `[mcp_servers]`를 새로 만들었음
    pub created: bool,
    /// `env_vars`에 우리가 더한 이름 (원래 있던 이름은 빼고)
    pub env_added: Vec<String>,
    /// `env_vars` 키가 없어서 새로 만들었음
    pub env_created: bool,
}

/// `[mcp_servers.waitscape]`를 넣은(고친) 문서. `env_vars`는 덮어쓰지 않고 우리 이름만 더한다(순서 유지·중복 없음·표 항목 보존)
pub fn codex_with(text: &str, bin: &str, reports: &str) -> Result<CodexWith, &'static str> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|_| "parse")?;
    let created = doc.get("mcp_servers").is_none();
    let servers = doc.entry("mcp_servers").or_insert_with(|| {
        let mut t = toml_edit::Table::new();
        t.set_implicit(true);
        toml_edit::Item::Table(t)
    });
    let servers = servers.as_table_mut().ok_or("shape")?;
    let item = servers.entry(mc::SERVER).or_insert_with(|| {
        let mut t = toml_edit::Table::new();
        // 앞 내용과 한 줄 띄움 (빈 파일이면 띄우지 않음)
        if !text.trim().is_empty() {
            t.decor_mut().set_prefix("\n");
        }
        toml_edit::Item::Table(t)
    });
    let t = item.as_table_mut().ok_or("shape")?;
    t["command"] = toml_edit::value(bin);
    t["args"] = str_array(mc::server_args(reports).iter().map(|s| s.as_str()));
    // 도구 2개만 노출 (Codex `enabled_tools` = 허용 목록)
    t["enabled_tools"] = str_array(mc::TOOLS);
    // 멀티플렉서 이동 정보(#37): Codex는 MCP 서버에 env를 거의 넘기지 않으므로 어댑터 표의 env만 전달 허용(지금은 Orca 핸들·경로, cmux 두 ID. 토큰·소켓 비밀번호는 넣지 않음)
    let env_created = t.get("env_vars").is_none();
    if env_created {
        t["env_vars"] = toml_edit::value(toml_edit::Array::new());
    }
    let have = env_names(t.get("env_vars"));
    let arr = t["env_vars"].as_array_mut().ok_or("shape")?;
    let mut env_added = vec![];
    for e in wr_core::term::env_allow() {
        if !have.iter().any(|n| n == e) {
            arr.push(e);
            env_added.push(e.to_string());
        }
    }
    Ok(CodexWith {
        text: eol_like(doc.to_string(), text),
        created,
        env_added,
        env_created,
    })
}

/// 연결 전부터 있던 우리 형식 항목에서 우리가 더한 `env_vars` 이름만 뺀다(#37). `drop_key`면 비었을 때 키도 지움
pub fn codex_drop_env(text: &str, names: &[String], drop_key: bool) -> Result<String, &'static str> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|_| "parse")?;
    let Some(t) = doc
        .get_mut("mcp_servers")
        .and_then(|s| s.as_table_like_mut())
        .and_then(|s| s.get_mut(mc::SERVER))
        .and_then(|e| e.as_table_like_mut())
    else {
        return Ok(text.to_string());
    };
    let Some(arr) = t.get_mut("env_vars").and_then(|i| i.as_array_mut()) else {
        return Ok(text.to_string());
    };
    arr.retain(|v| !v.as_str().is_some_and(|s| names.iter().any(|n| n == s)));
    if drop_key && arr.is_empty() {
        t.remove("env_vars");
    }
    Ok(eol_like(doc.to_string(), text))
}

/// 우리 표만 지운 문서 텍스트. `drop_parent`이고 `[mcp_servers]`가 비면 그것도 지운다. 우리 항목이 아니면 그대로
pub fn codex_without(text: &str, drop_parent: bool) -> Result<String, &'static str> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|_| "parse")?;
    if matches!(codex_state(&doc, "", ""), Entry::None | Entry::Other) {
        return Ok(text.to_string());
    }
    let servers = doc.get_mut("mcp_servers").and_then(|s| s.as_table_like_mut()).ok_or("shape")?;
    servers.remove(mc::SERVER);
    if drop_parent && servers.is_empty() {
        doc.remove("mcp_servers");
    }
    Ok(eol_like(doc.to_string(), text))
}

/* ---------- 미리보기 (우리 항목만) ---------- */

/// 미리보기·확인 창 한 줄: 혹시 모를 시크릿을 한 번 더 가린다(report.rs와 같은 정화·마스킹)
fn shown(s: &str) -> String {
    wr_core::report::clean(s, 400)
}

/// 우리 항목의 알려진 키만 (사용자가 같은 항목에 넣었을 수 있는 env 등은 이름 개수만)
fn entry_lines(sign: char, head: &str, e: &Value) -> Vec<String> {
    let mut out = vec![format!("{sign} {head}")];
    let Some(o) = e.as_object() else { return out };
    let mut others = 0;
    for (k, v) in o {
        if ["command", "args", "enabledTools", "enabled_tools", "env_vars", "type"].contains(&k.as_str()) {
            out.push(format!("{sign}   {k} = {v}"));
        } else {
            others += 1;
        }
    }
    if others > 0 {
        out.push(format!("{sign}   (+{others})"));
    }
    out
}

fn codex_entry_value(text: &str) -> Value {
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        return json!({});
    };
    let Some(t) = codex_table(&doc) else { return json!({}) };
    let mut o = serde_json::Map::new();
    for (k, item) in t.iter() {
        let v = item.as_str().map(|s| json!(s)).or_else(|| {
            item.as_array()
                .map(|a| json!(a.iter().map(|x| x.as_str().unwrap_or("?").to_string()).collect::<Vec<_>>()))
        });
        o.insert(k.to_string(), v.unwrap_or(json!("…")));
    }
    Value::Object(o)
}

/* ---------- 계획 ---------- */

/// 쓸(지울) 파일 하나
#[derive(Debug)]
pub struct FileChange {
    pub path: PathBuf,
    mtime: Option<SystemTime>,
    exists: bool,
    before: Vec<u8>,
    /// None = 파일을 지움 (우리가 만든 빈 settings.json)
    pub after: Option<Vec<u8>>,
    /// 백업 원본을 그대로 되돌림 (바이트 동일 해제)
    pub restore: bool,
    /// Claude 권한 파일인가 (기록 위치 구분)
    allow: bool,
}

#[derive(Debug)]
pub struct Plan {
    pub cli: Cli,
    pub connect: bool,
    pub files: Vec<FileChange>,
    /// 실행할 CLI 명령들 (Claude)
    pub cmds: Vec<Vec<String>>,
    /// remove 성공 뒤 add가 실패하면 원래 등록을 되돌리는 명령 (`claude mcp add-json`)
    rollback: Option<Vec<String>>,
    /// 화면용: 우리 항목만 (`@ 파일`, `$ 명령`, `+ …`/`- …`). 다른 내용·문맥 줄은 없음
    pub diff: Vec<String>,
    /// 화면용 안내 코드: `not-ours`, `rest-same`(그 외 내용 그대로), `reformat`(그 외 줄은 서식만), `new-file`
    pub notes: Vec<String>,
    /// 적용 뒤 이 CLI의 연결 기록 (None = 지움)
    rec: Option<CliRecord>,
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.cmds.is_empty()
    }

    pub fn to_json(&self, home: &Path) -> Value {
        let h = home.to_string_lossy();
        json!({
            "cli": self.cli.id(),
            "connect": self.connect,
            "empty": self.is_empty(),
            "files": self.files.iter().map(|f| crate::commands::tilde(&f.path.to_string_lossy(), &h)).collect::<Vec<_>>(),
            "diff": self.shown_lines(home),
            "notes": self.notes,
        })
    }

    fn note(&mut self, n: &str) {
        if !self.notes.iter().any(|x| x == n) {
            self.notes.push(n.into());
        }
    }

    /// 화면(웹 미리보기·네이티브 확인 창)에 보여 줄 줄: 홈은 `~`로, 혹시 모를 시크릿은 가림
    pub fn shown_lines(&self, home: &Path) -> Vec<String> {
        let h = home.to_string_lossy();
        self.diff.iter().map(|l| shown(&crate::commands::tilde(l, &h))).collect()
    }

    /// 파일 변경 추가: 화면에는 `@ 경로` + 우리 항목 줄만. `rest_same`이 거짓이면 "그 외 줄은 서식만 바뀜"
    #[allow(clippy::too_many_arguments)]
    fn file(
        &mut self,
        path: &Path,
        raw: Raw,
        after: Option<Vec<u8>>,
        restore: bool,
        allow: bool,
        lines: Vec<String>,
        rest_same: bool,
        home: &Path,
    ) {
        if after.as_deref() == Some(&raw.bytes[..]) && raw.exists {
            return;
        }
        let tag = if !raw.exists {
            " (새 파일)"
        } else if after.is_none() {
            " (파일 삭제 — 앱이 만든 빈 파일)"
        } else {
            ""
        };
        if !raw.exists {
            self.note("new-file");
        }
        self.diff.push(format!("@ {}{tag}", short(path, home)));
        self.diff.extend(lines);
        self.note(if rest_same || restore { "rest-same" } else { "reformat" });
        self.files.push(FileChange {
            path: path.to_path_buf(),
            mtime: raw.mtime,
            exists: raw.exists,
            before: raw.bytes,
            after,
            restore,
            allow,
        });
    }
}

fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 해제 때: 지금 파일이 **마지막으로 우리가 쓴 바이트 그대로**이고 백업이 그 쓰기 직전 바이트 그대로일 때만 원본 바이트.
/// 그 밖에는 None → 우리 항목만 구조적으로 지운다
fn restorable(cur: &[u8], rec: Option<&FileRec>) -> Option<Vec<u8>> {
    let r = rec?;
    if sha(cur) != r.after {
        return None;
    }
    let b = std::fs::read(r.backup.as_ref()?).ok()?;
    (sha(&b) == r.before).then_some(b)
}

/// 바뀔 내용을 계산한다(아무것도 쓰지 않음). `auto_allow`는 Claude 연결에만 쓰인다
pub fn plan(p: &McpPaths, cli: Cli, connect: bool, auto_allow: bool) -> Result<Plan, String> {
    let record = Record::load(&p.record);
    let old = record.clis.get(cli.id()).cloned();
    let (bin, rep) = (p.cmd(), p.rep());
    let mut out = Plan {
        cli,
        connect,
        files: vec![],
        cmds: vec![],
        rollback: None,
        diff: vec![],
        notes: vec![],
        rec: None,
    };
    // 연결: 기존 기록(연결 전부터 있던 항목 기억)을 이어 간다 / 해제: 남길 것이 없으면 지움
    let mut rec = old.clone().unwrap_or_default();
    rec.at = now_s();
    let path = p.config_of(cli).to_path_buf();
    let raw = read_raw(&path, &p.home)?;
    let other = || {
        format!(
            "{}에 이름이 같은 다른 서버(waitscape)가 있어 건드리지 않았어요",
            short(&path, &p.home)
        )
    };
    let added = old.as_ref().is_some_and(|r| r.server_added);
    match cli {
        Cli::Codex => {
            let text = String::from_utf8(raw.bytes.clone()).map_err(|_| toml_err(&path, &p.home))?;
            let doc: toml_edit::DocumentMut = text.parse().map_err(|_| toml_err(&path, &p.home))?;
            let st = codex_state(&doc, &bin, &rep);
            let strip = |t: &str, drop: bool| codex_without(t, drop).unwrap_or_default();
            if connect {
                if st == Entry::Other {
                    return Err(other());
                }
                let w = codex_with(&text, &bin, &rep).map_err(|_| toml_err(&path, &p.home))?;
                let (next, created) = (w.text, w.created);
                if old.is_none() {
                    rec.server_added = st == Entry::None;
                    rec.created_parent = created;
                    rec.env_created = w.env_created;
                }
                // 우리가 더한 env 이름만 기록(다시 연결해도 앞서 더한 것은 유지)
                for n in w.env_added {
                    if !rec.env_added.contains(&n) {
                        rec.env_added.push(n);
                    }
                }
                let mut lines = vec![];
                if st == Entry::Stale {
                    lines.extend(entry_lines('-', "[mcp_servers.waitscape]", &codex_entry_value(&text)));
                }
                lines.extend(entry_lines('+', "[mcp_servers.waitscape]", &codex_entry_value(&next)));
                let same = strip(&text, created) == strip(&next, created);
                out.file(&path, raw, Some(next.into_bytes()), false, false, lines, same, &p.home);
                out.rec = Some(rec);
            } else if !added {
                if st != Entry::None {
                    out.note("not-ours");
                    // 항목은 남기되 우리가 env_vars에 더한 이름만 뺀다(#37, 사용자가 넣은 이름은 그대로)
                    let env = old.as_ref().map(|r| r.env_added.clone()).unwrap_or_default();
                    if !env.is_empty() {
                        let drop = old.as_ref().is_some_and(|r| r.env_created);
                        let next = codex_drop_env(&text, &env, drop).map_err(|_| toml_err(&path, &p.home))?;
                        let lines = vec![format!("- [mcp_servers.waitscape] env_vars: {}", env.join(", "))];
                        out.file(&path, raw, Some(next.into_bytes()), false, false, lines, true, &p.home);
                    }
                }
                out.rec = None;
            } else {
                let lines = entry_lines('-', "[mcp_servers.waitscape]", &codex_entry_value(&text));
                if let Some(b) = restorable(&raw.bytes, old.as_ref().and_then(|r| r.file.as_ref())) {
                    out.file(&path, raw, Some(b), true, false, lines, true, &p.home);
                } else if st != Entry::None {
                    let drop = old.as_ref().is_some_and(|r| r.created_parent);
                    let next = codex_without(&text, drop).map_err(|_| toml_err(&path, &p.home))?;
                    out.file(&path, raw, Some(next.into_bytes()), false, false, lines, true, &p.home);
                }
                out.rec = None;
            }
        }
        Cli::Antigravity => {
            let v = parse_json(&raw, &path, &p.home)?;
            let st = mc::entry_state(v.get("mcpServers"), &bin, &rep);
            let same = json_like(&v, &raw.bytes) == raw.bytes;
            let cur = v.pointer("/mcpServers/waitscape").cloned().unwrap_or(json!({}));
            if connect {
                if st == Entry::Other {
                    return Err(other());
                }
                if old.is_none() {
                    rec.server_added = st == Entry::None;
                    rec.created_parent = v.get("mcpServers").is_none();
                }
                let entry = mc::antigravity_entry(&bin, &rep);
                let next = mc::with_server(&v, entry.clone())
                    .ok_or_else(|| format!("{}의 mcpServers 형식이 달라 건드리지 않았어요", short(&path, &p.home)))?;
                let mut lines = vec![];
                if st == Entry::Stale {
                    lines.extend(entry_lines('-', "mcpServers.waitscape", &cur));
                }
                lines.extend(entry_lines('+', "mcpServers.waitscape", &entry));
                let bytes = if next == v {
                    raw.bytes.clone()
                } else {
                    json_like(&next, &raw.bytes)
                };
                out.file(&path, raw, Some(bytes), false, false, lines, same, &p.home);
                out.rec = Some(rec);
            } else if !added {
                if st != Entry::None {
                    out.note("not-ours");
                }
            } else {
                let lines = entry_lines('-', "mcpServers.waitscape", &cur);
                if let Some(b) = restorable(&raw.bytes, old.as_ref().and_then(|r| r.file.as_ref())) {
                    out.file(&path, raw, Some(b), true, false, lines, true, &p.home);
                } else {
                    let next = mc::without_server(&v, old.as_ref().is_some_and(|r| r.created_parent));
                    if next != v {
                        let bytes = json_like(&next, &raw.bytes);
                        out.file(&path, raw, Some(bytes), false, false, lines, same, &p.home);
                    }
                }
            }
        }
        Cli::Claude => {
            // ~/.claude.json은 읽기만 (상태 확인). 바꾸는 건 claude CLI
            let v = parse_json(&raw, &path, &p.home)?;
            let st = mc::entry_state(v.get("mcpServers"), &bin, &rep);
            let exe = p.clis.get("claude").map(|x| x.to_string_lossy().into_owned());
            let add = mc::claude_add_args(&bin, &rep);
            let need_cli = |out: &mut Plan, args: Vec<String>| -> Result<(), String> {
                let exe = exe.clone().ok_or_else(|| {
                    format!(
                        "claude 명령을 찾지 못했어요. 터미널에서 직접 실행해 주세요: claude {}",
                        shell_line(&add)
                    )
                })?;
                out.diff.push(format!("$ claude {}", shell_line(&args)));
                out.cmds.push(std::iter::once(exe).chain(args).collect());
                Ok(())
            };
            let sp = p.claude_settings.clone();
            if connect {
                match st {
                    Entry::Other => return Err(other()),
                    Entry::None => {
                        rec.server_added = true;
                        need_cli(&mut out, add.clone())?;
                    }
                    Entry::Stale => {
                        if old.is_none() {
                            rec.server_added = false;
                        }
                        need_cli(&mut out, mc::claude_remove_args())?;
                        need_cli(&mut out, add.clone())?;
                        // add가 실패하면 원래 등록(옛 경로·env 등 그대로)을 되돌린다
                        if let (Some(e), Some(x)) = (v.pointer("/mcpServers/waitscape"), exe.clone()) {
                            out.rollback = Some(vec![
                                x,
                                "mcp".into(),
                                "add-json".into(),
                                "-s".into(),
                                "user".into(),
                                mc::SERVER.into(),
                                e.to_string(),
                            ]);
                        }
                    }
                    Entry::Ours => {
                        if old.is_none() {
                            rec.server_added = false;
                        }
                    }
                }
                if auto_allow {
                    // settings.json이 없으면 {}에서 시작해 새로 만든다 (Claude Code를 실행해도 생기지 않을 수 있음)
                    let sraw = read_opt(&sp, &p.home)?.unwrap_or(Raw {
                        bytes: vec![],
                        mtime: None,
                        exists: false,
                    });
                    let sv = if sraw.exists { parse_json(&sraw, &sp, &p.home)? } else { json!({}) };
                    let (next, added) = mc::with_allow_tracked(&sv)
                        .ok_or_else(|| format!("{}의 permissions 형식이 달라 건드리지 않았어요", short(&sp, &p.home)))?;
                    // 이미 기록이 있으면(다시 연결) 처음 기록을 유지 — 해제 때 원래 상태로
                    if rec.allow.is_none() {
                        rec.allow = Some(added);
                        rec.allow_created_file = !sraw.exists;
                    }
                    if next != sv || !sraw.exists {
                        let lines = mc::allow_diff(&sv, &next);
                        let same = !sraw.exists || json_like(&sv, &sraw.bytes) == sraw.bytes;
                        let bytes = json_like(&next, &sraw.bytes);
                        out.file(&sp, sraw, Some(bytes), false, true, lines, same, &p.home);
                    }
                }
                out.rec = Some(rec);
            } else {
                let mut keep = rec.clone();
                if added && matches!(st, Entry::Ours | Entry::Stale) {
                    need_cli(&mut out, mc::claude_remove_args())?;
                } else if st != Entry::None {
                    out.note("not-ours");
                }
                keep.server_added = false;
                keep.file = None;
                let mut keep_allow = false;
                if let Some(added_rules) = old.as_ref().and_then(|r| r.allow.clone()) {
                    match read_opt(&sp, &p.home) {
                        Ok(Some(sraw)) => {
                            let sv = parse_json(&sraw, &sp, &p.home)?;
                            let next = mc::without_added(&sv, &added_rules);
                            let lines = mc::allow_diff(&sv, &next);
                            if let Some(b) = restorable(&sraw.bytes, old.as_ref().and_then(|r| r.allow_file.as_ref())) {
                                let gone = old.as_ref().is_some_and(|r| r.allow_created_file) && b.is_empty();
                                out.file(&sp, sraw, (!gone).then_some(b), true, true, lines, true, &p.home);
                            } else if next != sv {
                                let gone = old.as_ref().is_some_and(|r| r.allow_created_file) && next == json!({});
                                let same = json_like(&sv, &sraw.bytes) == sraw.bytes;
                                let bytes = json_like(&next, &sraw.bytes);
                                out.file(&sp, sraw, (!gone).then_some(bytes), false, true, lines, same, &p.home);
                            }
                        }
                        Ok(None) => {}
                        // 읽지 못하면 규칙 기록은 남긴다(나중에 다시 해제할 수 있게)
                        Err(_) => keep_allow = true,
                    }
                }
                out.rec = keep_allow.then(|| {
                    keep.allow_file = None;
                    keep
                });
            }
        }
    }
    Ok(out)
}

/// 쓰기 결과
#[derive(Debug, Serialize)]
pub struct Applied {
    pub changed: bool,
    pub backups: Vec<String>,
}

fn write_one(f: &FileChange, tag: &str) -> Result<Option<PathBuf>, String> {
    match &f.after {
        Some(bytes) => hc::write_raw(&f.path, f.exists, f.mtime, bytes, tag).map_err(|e| e.to_string()),
        None => {
            if hc::mtime_of(&f.path) != f.mtime {
                return Err(hc::HookError::Changed.to_string());
            }
            std::fs::remove_file(&f.path).map_err(|e| format!("파일 오류: {}", e.kind()))?;
            Ok(None)
        }
    }
}

/// 계획대로 쓴다: (Claude) `~/.claude.json` 백업 사본 → CLI 실행 → (CLI가 바꿨으면 기록부터 저장) → 파일마다 백업·mtime 재확인·원자적 쓰기 → 연결 기록.
/// 확인(사용자 동의)은 부르는 쪽이 먼저 받는다
pub fn apply(p: &McpPaths, plan: Plan, run: Runner, tag: &str) -> Result<Applied, String> {
    let mut backups = vec![];
    let h = p.home.to_string_lossy().into_owned();
    if !plan.cmds.is_empty() {
        // Claude Code가 쓸 파일이지만, 바꾸기 전 사본은 우리가 남긴다
        let cj = &p.claude_json;
        let name = cj.file_name().and_then(|n| n.to_str()).unwrap_or(".claude.json");
        let mut b = cj.with_file_name(format!("{name}.bak-waiting-room-{tag}"));
        let mut n = 2;
        while b.exists() {
            b = cj.with_file_name(format!("{name}.bak-waiting-room-{tag}-{n}"));
            n += 1;
        }
        std::fs::copy(cj, &b).map_err(|e| format!("백업 실패: {}", e.kind()))?;
        let bshort = crate::commands::tilde(&b.to_string_lossy(), &h);
        backups.push(b.to_string_lossy().into_owned());
        for (i, c) in plan.cmds.iter().enumerate() {
            if let Err(e) = run(Path::new(&c[0]), &c[1..]) {
                let what = format!("claude {}", c[1..3.min(c.len())].join(" "));
                // remove는 됐는데 add가 실패 → 원래 등록 되돌리기
                if i > 0 {
                    if let Some(rb) = &plan.rollback {
                        return Err(match run(Path::new(&rb[0]), &rb[1..]) {
                            Ok(_) => format!("{what} 실패 — {e}. 원래 등록은 되돌렸어요"),
                            Err(_) => format!("{what} 실패 — {e}. 원래 등록을 되돌리지 못했어요. 백업: {bshort}"),
                        });
                    }
                }
                return Err(format!("{what} 실패 — {e}. 백업: {bshort}"));
            }
        }
        // CLI가 이미 바꿨으므로, 뒤의 파일 쓰기가 실패해도 앱이 해제할 수 있게 기록부터 남긴다
        // (연결: 서버만 반영하고 권한 규칙 기록은 이전 그대로 / 해제: 서버만 뺀 기록)
        let prev = Record::load(&p.record).clis.get(plan.cli.id()).cloned();
        let interim = if plan.connect {
            plan.rec.clone().map(|mut r| {
                let pv = prev.clone().unwrap_or_default();
                r.allow = pv.allow;
                r.allow_file = pv.allow_file;
                r.allow_created_file = pv.allow_created_file;
                r
            })
        } else {
            prev.map(|mut r| {
                r.server_added = false;
                r
            })
        };
        Record::put(&p.record, plan.cli, interim)?;
    }
    let mut rec = plan.rec.clone();
    for f in &plan.files {
        let bk = write_one(f, tag).map_err(|e| {
            if plan.cmds.is_empty() {
                e
            } else if plan.connect {
                format!("서버는 등록됐어요. 권한 규칙은 쓰지 못했어요(다시 시도해 주세요) — {e}")
            } else {
                format!("서버 등록은 지웠어요. 권한 규칙은 지우지 못했어요(다시 시도해 주세요) — {e}")
            }
        })?;
        if let Some(b) = &bk {
            backups.push(b.to_string_lossy().into_owned());
        }
        if let (true, Some(r), Some(after)) = (plan.connect, rec.as_mut(), &f.after) {
            // 마지막 쓰기 기준으로 갱신 (다시 연결하면 그 직전 바이트·이번 백업) — 해제 때 사이에 생긴 사용자 편집을 지우지 않게
            let fr = FileRec {
                before: sha(&f.before),
                after: sha(after),
                backup: bk.as_ref().map(|b| b.to_string_lossy().into_owned()),
            };
            if f.allow {
                r.allow_file = Some(fr);
            } else {
                r.file = Some(fr);
            }
        }
    }
    Record::put(&p.record, plan.cli, rec)?;
    Ok(Applied {
        changed: !plan.is_empty(),
        backups,
    })
}

/* ---------- 상태 ---------- */

/// 설정 화면 한 줄: `{id, name, detected, cli, config, state: missing|detected|connected|other|error, managed, error?, autoAllow?}`
pub fn status(p: &McpPaths) -> Value {
    let record = Record::load(&p.record);
    let (bin, rep) = (p.cmd(), p.rep());
    let rows: Vec<Value> = Cli::ALL
        .iter()
        .map(|&cli| {
            let path = p.config_of(cli);
            let cli_path = p.clis.get(cli.id());
            let dir_exists = path.parent().is_some_and(|d| d.is_dir()) && (cli != Cli::Claude || path.is_file());
            let detected = cli_path.is_some() || dir_exists;
            let mut row = json!({
                "id": cli.id(),
                "name": cli.name(),
                "detected": detected,
                "cli": cli_path.map(|x| short(x, &p.home)),
                "config": short(path, &p.home),
                // 앱이 연결한 기록이 있음 (해제 가능) / 서버 항목을 앱이 넣었음 (아니면 "직접 등록함")
                "managed": record.clis.contains_key(cli.id()),
                "added": record.clis.get(cli.id()).is_some_and(|r| r.server_added),
                // 우리 형식이지만 예전 설정(다른 경로·Codex env_vars 없음) → 화면에 "다시 연결" 안내
                "stale": false,
            });
            let entry = match read_raw(path, &p.home) {
                Err(e) => {
                    if path.exists() {
                        row["error"] = json!(e);
                    }
                    None
                }
                Ok(raw) => match cli {
                    Cli::Codex => match std::str::from_utf8(&raw.bytes)
                        .ok()
                        .and_then(|t| t.parse::<toml_edit::DocumentMut>().ok())
                    {
                        Some(doc) => Some(codex_state(&doc, &bin, &rep)),
                        None => {
                            row["error"] = json!(toml_err(path, &p.home));
                            None
                        }
                    },
                    _ => match parse_json(&raw, path, &p.home) {
                        Ok(v) => Some(mc::entry_state(v.get("mcpServers"), &bin, &rep)),
                        Err(e) => {
                            row["error"] = json!(e);
                            None
                        }
                    },
                },
            };
            row["entry"] = json!(entry);
            row["stale"] = json!(entry == Some(Entry::Stale));
            row["state"] = json!(match entry {
                _ if row.get("error").is_some() => "error",
                Some(Entry::Ours) | Some(Entry::Stale) => "connected",
                Some(Entry::Other) => "other",
                _ if detected => "detected",
                _ => "missing",
            });
            if cli == Cli::Claude {
                let have = hc::load(&p.claude_settings)
                    .map(|l| mc::allow_diff(&mc::without_allow(&l.value), &l.value).len() == mc::TOOLS.len())
                    .unwrap_or(false);
                row["autoAllow"] = json!(have);
            }
            row
        })
        .collect();
    json!({"clis": rows, "bin": short(&p.bin, &p.home), "reports": short(&p.reports, &p.home)})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct T {
        dir: PathBuf,
        p: McpPaths,
    }

    impl Drop for T {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).ok();
        }
    }

    /// 실제 홈은 건드리지 않는다: 임시 HOME
    fn setup(name: &str) -> T {
        let dir = std::env::temp_dir().join(format!("ws-mcp-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let home = dir.join("home");
        let root = home.join(".claude");
        std::fs::create_dir_all(root.join("waiting-room/bin")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::create_dir_all(home.join(".gemini/config")).unwrap();
        let mut p = McpPaths::new(
            &home,
            &root,
            &root.join("settings.json"),
            &root.join("waiting-room/bin/wr-hook"),
            &root.join("waiting-room/reports.jsonl"),
        );
        p.codex_config = home.join(".codex/config.toml");
        p.clis.insert("claude", PathBuf::from("/fake/bin/claude"));
        T { dir, p }
    }

    fn backups(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".bak-waiting-room-"))
            .count()
    }

    const CODEX: &str = "# 내 설정\nmodel = \"o4\"   # 주석 유지\n\n[mcp_servers.github]\ncommand = \"gh\"\nargs = [\"mcp\"] # 뒤 주석\n\n[profiles.fast]\nmodel = \"x\"\n";

    #[test]
    fn codex_round_trip_byte_identical() {
        let t = setup("codex");
        let p = &t.p;
        std::fs::write(&p.codex_config, CODEX).unwrap();
        let none: Runner = &|_, _| panic!("Codex는 CLI를 실행하지 않음");
        let pl = plan(p, Cli::Codex, true, false).unwrap();
        assert!(pl.diff.iter().any(|l| l == "+ [mcp_servers.waitscape]"), "{:?}", pl.diff);
        apply(p, pl, none, "t1").unwrap();
        let text = std::fs::read_to_string(&p.codex_config).unwrap();
        // 기존 줄·주석·순서는 그대로, 우리 표는 같은 [mcp_servers.*] 무리 끝(github 다음)에 들어간다
        assert_eq!(codex_without(&text, false).unwrap(), CODEX, "우리 표만 빼면 원문 그대로:\n{text}");
        assert!(text.contains("model = \"o4\"   # 주석 유지") && text.contains("args = [\"mcp\"] # 뒤 주석"));
        assert!(text.find("[mcp_servers.waitscape]") < text.find("[profiles.fast]"));
        assert!(text.contains("enabled_tools = [\"waitscape_status\", \"waitscape_board\"]"));
        assert!(
            text.contains("env_vars = [\"ORCA_TERMINAL_HANDLE\", \"ORCA_WORKTREE_PATH\", \"CMUX_WORKSPACE_ID\", \"CMUX_SURFACE_ID\"]"),
            "{text}"
        );
        assert!(text.contains("args = [\"mcp\", \"--reports\","));
        assert_eq!(backups(&t.dir.join("home/.codex")), 1);
        assert_eq!(status(p)["clis"][1]["state"], "connected");
        // 다시 연결: 바뀔 것 없음
        assert!(plan(p, Cli::Codex, true, false).unwrap().is_empty());
        let pl = plan(p, Cli::Codex, false, false).unwrap();
        assert!(pl.files[0].restore, "그대로면 백업 원본으로");
        apply(p, pl, none, "t2").unwrap();
        assert_eq!(std::fs::read_to_string(&p.codex_config).unwrap(), CODEX, "바이트 동일");
        assert_eq!(status(p)["clis"][1]["state"], "detected");
    }

    #[test]
    fn codex_structural_remove_after_other_edits() {
        let t = setup("codex2");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        // [mcp_servers] 표가 없던 파일 → 해제하면 우리가 만든 부모도 지움
        let orig = "model = \"o4\"\n# 끝 주석\n";
        std::fs::write(&p.codex_config, orig).unwrap();
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        // 그 사이 사용자가 다른 줄을 고침 → 백업 복원 불가, 우리 표만 지운다
        let edited = std::fs::read_to_string(&p.codex_config).unwrap().replace("o4", "o5");
        std::fs::write(&p.codex_config, &edited).unwrap();
        let pl = plan(p, Cli::Codex, false, false).unwrap();
        assert!(!pl.files[0].restore);
        apply(p, pl, none, "b").unwrap();
        assert_eq!(std::fs::read_to_string(&p.codex_config).unwrap(), orig.replace("o4", "o5"));
    }

    #[test]
    fn codex_preexisting_entry_is_kept_on_disconnect() {
        let t = setup("codex3");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        let mine = format!(
            "[mcp_servers.waitscape] # 내가 README 보고 넣음\ncommand = \"{}\"\nargs = [\"mcp\", \"--reports\", \"{}\"]\n",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.codex_config, &mine).unwrap();
        let pl = plan(p, Cli::Codex, true, false).unwrap();
        apply(p, pl, none, "a").unwrap();
        let after = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(after.contains("# 내가 README 보고 넣음") && after.contains("enabled_tools"));
        assert_eq!(status(p)["clis"][1]["added"], false);
        let pl = plan(p, Cli::Codex, false, false).unwrap();
        assert_eq!(pl.notes, ["not-ours", "rest-same"], "연결 전부터 있던 항목은 해제 때 남김");
        apply(p, pl, none, "b").unwrap();
        let back = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(back.contains("# 내가 README 보고 넣음") && back.contains("[mcp_servers.waitscape]"));
        assert!(!back.contains("env_vars"), "우리가 만든 env_vars 키는 해제 때 지움:\n{back}");
        // 다른 서버가 같은 이름이면 거부
        std::fs::write(&p.codex_config, "[mcp_servers.waitscape]\ncommand = \"npx\"\nargs = [\"x\"]\n").unwrap();
        assert!(plan(p, Cli::Codex, true, false).unwrap_err().contains("다른 서버"));
    }

    /// PR #39 리뷰 🟡2: env_vars 없이 연결해 둔(PR #36) Codex 항목은 Stale("다시 연결" 안내), 다시 연결하면 최신
    #[test]
    fn codex_without_env_vars_is_stale_and_reconnect_fixes() {
        let t = setup("codex-mig");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        std::fs::write(&p.codex_config, CODEX).unwrap();
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        // PR #36 형식으로 되돌림: env_vars 줄만 없앰
        let text = std::fs::read_to_string(&p.codex_config).unwrap();
        let old: String = text
            .lines()
            .filter(|l| !l.starts_with("env_vars"))
            .map(|l| format!("{l}\n"))
            .collect();
        std::fs::write(&p.codex_config, &old).unwrap();
        let st = status(p);
        assert_eq!(
            (st["clis"][1]["state"].clone(), st["clis"][1]["stale"].clone()),
            (json!("connected"), json!(true))
        );
        let pl = plan(p, Cli::Codex, true, false).unwrap();
        assert!(
            pl.diff.iter().any(|l| l.starts_with("- ")),
            "고칠 때 옛 항목도 보여 줌: {:?}",
            pl.diff
        );
        assert!(pl.diff.iter().any(|l| l.contains("env_vars")), "{:?}", pl.diff);
        apply(p, pl, none, "b").unwrap();
        assert_eq!(status(p)["clis"][1]["stale"], false);
        assert!(
            plan(p, Cli::Codex, true, false).unwrap().is_empty(),
            "다시 연결 뒤에는 바뀔 것 없음"
        );
        // 해제: 우리가 넣은 표째 지움 → 원문 그대로
        apply(p, plan(p, Cli::Codex, false, false).unwrap(), none, "c").unwrap();
        assert_eq!(
            codex_without(&std::fs::read_to_string(&p.codex_config).unwrap(), false).unwrap(),
            CODEX
        );
    }

    /// #40: Orca 전(cmux 두 개만) 연결은 Stale → 다시 연결하면 Orca 두 이름만 더하고 사용자 항목은 그대로
    #[test]
    fn codex_cmux_only_env_vars_is_stale() {
        let t = setup("codex-orca");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        let old = format!(
            "[mcp_servers.waitscape]\ncommand = \"{}\"\nargs = [\"mcp\", \"--reports\", \"{}\"]\nenabled_tools = [\"waitscape_status\", \"waitscape_board\"]\nenv_vars = [\"MY_PROXY\", \"CMUX_WORKSPACE_ID\", \"CMUX_SURFACE_ID\"]\n",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.codex_config, &old).unwrap();
        assert_eq!(status(p)["clis"][1]["stale"], true, "Orca env가 없음");
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        let after = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(
            after.contains(
                r#"env_vars = ["MY_PROXY", "CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID", "ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH"]"#
            ),
            "{after}"
        );
        assert!(!after.contains("TOKEN"), "토큰류 env는 넣지 않음");
        assert_eq!(status(p)["clis"][1]["stale"], false);
        assert_eq!(
            Record::load(&p.record).clis["codex"].env_added,
            ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH"]
        );
    }

    /// PR #39 리뷰 🟡3: 사용자가 넣은 env_vars는 덮어쓰지 않고 합친다. 해제 때는 우리가 더한 이름만 뺀다
    #[test]
    fn codex_user_env_vars_are_merged_and_kept() {
        let t = setup("codex-env");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        let mine = format!(
            "[mcp_servers.waitscape]\ncommand = \"{}\"\nargs = [\"mcp\", \"--reports\", \"{}\"]\nenv_vars = [\"MY_PROXY\", {{ name = \"CMUX_SURFACE_ID\", source = \"local\" }}]\n",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.codex_config, &mine).unwrap();
        assert_eq!(status(p)["clis"][1]["stale"], true, "CMUX_WORKSPACE_ID가 없음");
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        let after = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(
            after.contains(
                r#"env_vars = ["MY_PROXY", { name = "CMUX_SURFACE_ID", source = "local" }, "ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH", "CMUX_WORKSPACE_ID"]"#
            ),
            "원래 항목 순서·표 항목 보존 + 없는 이름만 더함:\n{after}"
        );
        let rec = Record::load(&p.record);
        assert_eq!(
            rec.clis["codex"].env_added,
            ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH", "CMUX_WORKSPACE_ID"],
            "우리가 더한 이름만 기록"
        );
        assert!(!rec.clis["codex"].env_created);
        assert_eq!(status(p)["clis"][1]["stale"], false);
        // 해제: 연결 전부터 있던 항목이라 남기되 우리가 더한 이름만 뺀다
        let pl = plan(p, Cli::Codex, false, false).unwrap();
        assert!(pl.notes.contains(&"not-ours".to_string()));
        apply(p, pl, none, "b").unwrap();
        let back = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(
            back.contains(r#"env_vars = ["MY_PROXY", { name = "CMUX_SURFACE_ID", source = "local" }]"#),
            "사용자 env_vars는 원래대로:\n{back}"
        );
        assert!(!back.contains("CMUX_WORKSPACE_ID") && !back.contains("ORCA_"));
        assert!(!Record::load(&p.record).clis.contains_key("codex"));
    }

    #[test]
    fn broken_or_missing_files_are_refused() {
        let t = setup("broken");
        let p = &t.p;
        assert!(
            plan(p, Cli::Codex, true, false).unwrap_err().contains("없어요"),
            "없으면 만들지 않음"
        );
        assert!(!p.codex_config.exists());
        std::fs::write(&p.codex_config, "[mcp_servers\nx=").unwrap();
        assert!(plan(p, Cli::Codex, true, false).unwrap_err().contains("해석할 수 없어"));
        std::fs::write(&p.antigravity_config, "{ nope").unwrap();
        assert!(plan(p, Cli::Antigravity, true, false).unwrap_err().contains("해석할 수 없어"));
        std::fs::write(&p.antigravity_config, "[]").unwrap();
        assert!(plan(p, Cli::Antigravity, true, false).is_err());
        assert_eq!(std::fs::read_to_string(&p.antigravity_config).unwrap(), "[]");
        assert!(plan(p, Cli::Claude, true, true).unwrap_err().contains(".claude.json"));
        let st = status(p);
        assert_eq!(st["clis"][1]["state"], "error");
        assert_eq!(st["clis"][0]["state"], "detected", "CLI가 있으면 감지됨");
        assert_eq!(backups(&t.dir.join("home/.codex")), 0);
    }

    #[test]
    fn antigravity_round_trip_keeps_order_and_indent() {
        let t = setup("agy");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        let orig = "{\n    \"mcpServers\": {\n        \"github\": {\n            \"$typeName\": \"x\",\n            \"command\": \"gh\",\n            \"args\": [\"mcp\"]\n        }\n    },\n    \"z\": 1\n}";
        std::fs::write(&p.antigravity_config, orig).unwrap();
        let pl = plan(p, Cli::Antigravity, true, false).unwrap();
        apply(p, pl, none, "a").unwrap();
        let text = std::fs::read_to_string(&p.antigravity_config).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        let keys: Vec<_> = v["mcpServers"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["github", "waitscape"]);
        assert_eq!(v["mcpServers"]["waitscape"]["enabledTools"], json!(mc::TOOLS));
        assert!(text.contains("\n        \"waitscape\""), "원본 4칸 들여쓰기 유지:\n{text}");
        assert!(!text.ends_with('\n'), "끝 줄바꿈 없던 원본은 그대로");
        apply(p, plan(p, Cli::Antigravity, false, false).unwrap(), none, "b").unwrap();
        assert_eq!(std::fs::read_to_string(&p.antigravity_config).unwrap(), orig, "바이트 동일");
        // 다른 키가 바뀐 뒤 해제: 우리 항목만 빠지고 순서 유지, 우리가 만든 mcpServers는 비면 지움
        std::fs::write(&p.antigravity_config, "{\"a\":1}\n").unwrap();
        apply(p, plan(p, Cli::Antigravity, true, false).unwrap(), none, "c").unwrap();
        let mut v: Value = serde_json::from_slice(&std::fs::read(&p.antigravity_config).unwrap()).unwrap();
        v["b"] = json!(2);
        std::fs::write(&p.antigravity_config, serde_json::to_string(&v).unwrap() + "\n").unwrap();
        apply(p, plan(p, Cli::Antigravity, false, false).unwrap(), none, "d").unwrap();
        assert_eq!(std::fs::read_to_string(&p.antigravity_config).unwrap(), "{\"a\":1,\"b\":2}\n");
    }

    #[test]
    fn claude_uses_cli_and_tracks_rules() {
        let t = setup("claude");
        let p = &t.p;
        std::fs::write(
            &p.claude_json,
            "{\"numStartups\": 3, \"mcpServers\": {\"other\": {\"command\": \"x\"}}}",
        )
        .unwrap();
        // 연결 전부터 규칙 하나가 있던 settings.json (사용자 형식 그대로 되돌아와야 함)
        let settings = "{\n  \"permissions\": {\n    \"allow\": [\n      \"mcp__waitscape__waitscape_status\"\n    ]\n  },\n  \"theme\": \"dark\"\n}\n";
        std::fs::write(&p.claude_settings, settings).unwrap();
        let calls = RefCell::new(vec![]);
        let run = |prog: &Path, args: &[String]| {
            calls.borrow_mut().push((prog.to_path_buf(), args.to_vec()));
            Ok(String::new())
        };
        let pl = plan(p, Cli::Claude, true, true).unwrap();
        assert_eq!(pl.cmds.len(), 1);
        apply(p, pl, &run, "a").unwrap();
        {
            let c = calls.borrow();
            assert_eq!(c[0].0, PathBuf::from("/fake/bin/claude"));
            assert_eq!(c[0].1[..6], ["mcp", "add", "-s", "user", "waitscape", "--"]);
        }
        assert_eq!(backups(&t.dir.join("home")), 1, "~/.claude.json 사본");
        let s: Value = serde_json::from_slice(&std::fs::read(&p.claude_settings).unwrap()).unwrap();
        assert_eq!(s["permissions"]["allow"].as_array().unwrap().len(), 2);
        let rec = Record::load(&p.record);
        assert_eq!(
            rec.clis["claude"].allow.as_ref().unwrap().rules,
            vec!["mcp__waitscape__waitscape_board".to_string()]
        );
        // CLI가 등록한 것처럼 흉내
        let cj = format!(
            "{{\"numStartups\": 3, \"mcpServers\": {{\"other\": {{\"command\": \"x\"}}, \"waitscape\": {{\"type\": \"stdio\", \"command\": \"{}\", \"args\": [\"mcp\", \"--reports\", \"{}\"]}}}}}}",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.claude_json, cj).unwrap();
        let st = status(p);
        assert_eq!(st["clis"][0]["state"], "connected");
        assert_eq!(st["clis"][0]["autoAllow"], true);
        let pl = plan(p, Cli::Claude, false, false).unwrap();
        assert_eq!(pl.cmds[0][1..], mc::claude_remove_args()[..]);
        apply(p, pl, &run, "b").unwrap();
        assert_eq!(
            std::fs::read_to_string(&p.claude_settings).unwrap(),
            settings,
            "원래 있던 규칙은 남고 바이트 동일"
        );
        assert!(Record::load(&p.record).clis.is_empty());
        // CLI를 못 찾으면 수동 명령 안내
        let mut q = p.clone();
        q.clis.clear();
        std::fs::write(&p.claude_json, "{}").unwrap();
        assert!(plan(&q, Cli::Claude, true, false)
            .unwrap_err()
            .contains("claude mcp add -s user waitscape --"));
        // CLI 실패면 settings.json은 쓰지 않음
        let fail = |_: &Path, _: &[String]| Err("boom".to_string());
        let before = std::fs::read(&p.claude_settings).unwrap();
        assert!(apply(p, plan(p, Cli::Claude, true, true).unwrap(), &fail, "c").is_err());
        assert_eq!(std::fs::read(&p.claude_settings).unwrap(), before);
    }

    /// PR #36 리뷰 🔴-1: 연결 → 사용자가 우리 표를 지우고 다른 서버 추가 → 다시 연결 → 해제해도 사용자 편집이 남아야 한다
    #[test]
    fn reconnect_then_disconnect_keeps_user_edits() {
        let t = setup("reconn");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        std::fs::write(&p.codex_config, "model = \"o4\"\n").unwrap();
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        let user = "model = \"o4\"\n\n[mcp_servers.github]\ncommand = \"gh\"\n";
        std::fs::write(&p.codex_config, user).unwrap();
        assert_eq!(status(p)["clis"][1]["state"], "detected");
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "b").unwrap();
        let pl = plan(p, Cli::Codex, false, false).unwrap();
        apply(p, pl, none, "c").unwrap();
        assert_eq!(std::fs::read_to_string(&p.codex_config).unwrap(), user, "github 서버가 남아야 함");
        // Antigravity도 같은 규칙
        std::fs::write(&p.antigravity_config, "{\"mcpServers\": {}}\n").unwrap();
        apply(p, plan(p, Cli::Antigravity, true, false).unwrap(), none, "d").unwrap();
        let user = "{\"mcpServers\": {\"gh\": {\"command\": \"gh\"}}}\n";
        std::fs::write(&p.antigravity_config, user).unwrap();
        apply(p, plan(p, Cli::Antigravity, true, false).unwrap(), none, "e").unwrap();
        apply(p, plan(p, Cli::Antigravity, false, false).unwrap(), none, "f").unwrap();
        assert_eq!(std::fs::read_to_string(&p.antigravity_config).unwrap(), user);
    }

    /// PR #36 리뷰 🔴-2: 미리보기·확인 창에 다른 서버의 env 값·settings.json env 값이 나오면 안 된다 (5가지 경우)
    #[test]
    fn preview_never_shows_other_values() {
        const V: &str = "SENTINEL-not-for-screen-42";
        let t = setup("mask");
        let p = &t.p;
        let check = |pl: &Plan, case: &str| {
            let j = pl.to_json(&p.home).to_string();
            assert!(!j.contains(V), "{case}: {j}");
            assert!(pl.shown_lines(&p.home).iter().all(|l| !l.contains(V)), "{case}");
            assert!(!pl.diff.is_empty(), "{case}");
        };
        // (a) 한 줄짜리 mcp_config.json
        std::fs::write(
            &p.antigravity_config,
            format!("{{\"mcpServers\":{{\"github\":{{\"command\":\"gh\",\"env\":{{\"GITHUB_TOKEN\":\"{V}\"}}}}}}}}"),
        )
        .unwrap();
        check(&plan(p, Cli::Antigravity, true, false).unwrap(), "a");
        // (b) 여러 줄이지만 서버 객체를 한 줄로 씀 → 다시 직렬화돼도 화면엔 우리 항목만
        std::fs::write(
            &p.antigravity_config,
            format!(
                "{{\n  \"mcpServers\": {{\n    \"github\": {{\"command\": \"gh\", \"env\": {{\"GITHUB_TOKEN\": \"{V}\"}}}}\n  }}\n}}\n"
            ),
        )
        .unwrap();
        let pl = plan(p, Cli::Antigravity, true, false).unwrap();
        check(&pl, "b");
        assert!(pl.notes.contains(&"reformat".to_string()));
        // (d) 한 줄짜리 settings.json의 env
        std::fs::write(&p.claude_json, "{}").unwrap();
        std::fs::write(&p.claude_settings, format!("{{\"env\":{{\"ANTHROPIC_API_KEY\":\"{V}\"}}}}")).unwrap();
        check(&plan(p, Cli::Claude, true, true).unwrap(), "d");
        // (e) pretty settings.json, env가 마지막 키 (문맥 줄로 새던 경우)
        std::fs::write(
            &p.claude_settings,
            format!("{{\n  \"permissions\": {{\n    \"allow\": []\n  }},\n  \"env\": {{\n    \"ANTHROPIC_API_KEY\": \"{V}\"\n  }}\n}}\n"),
        )
        .unwrap();
        let pl = plan(p, Cli::Claude, true, true).unwrap();
        check(&pl, "e");
        assert!(pl.notes.contains(&"rest-same".to_string()));
        // (f) Codex: [mcp_servers.github.env]가 마지막 표
        std::fs::write(
            &p.codex_config,
            format!("[mcp_servers.github]\ncommand = \"gh\"\n\n[mcp_servers.github.env]\nGITHUB_TOKEN = \"{V}\"\n"),
        )
        .unwrap();
        check(&plan(p, Cli::Codex, true, false).unwrap(), "f");
        // 우리 항목 줄이 혹시 시크릿 모양이면 가린다 (report.rs 마스킹)
        assert!(!shown(&format!("+ x = \"ghp_{}\"", "a".repeat(36))).contains(&"a".repeat(36)));
    }

    /// 🟡-1: claude mcp add는 됐는데 settings.json 쓰기가 실패 → 기록은 남아 앱에서 해제할 수 있다
    #[test]
    fn cli_ok_but_settings_write_fails_still_records_server() {
        let t = setup("partial");
        let p = &t.p;
        std::fs::write(&p.claude_json, "{}").unwrap();
        std::fs::write(&p.claude_settings, "{}\n").unwrap();
        let sp = p.claude_settings.clone();
        // 확인 창이 떠 있는 동안 다른 프로그램이 settings.json을 고친 것처럼
        let run = move |_: &Path, _: &[String]| {
            std::fs::write(&sp, "{\"theme\": \"dark\"}\n").unwrap();
            let f = std::fs::File::options().write(true).open(&sp).unwrap();
            f.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1)).unwrap();
            Ok(String::new())
        };
        let e = apply(p, plan(p, Cli::Claude, true, true).unwrap(), &run, "a").unwrap_err();
        assert!(e.contains("서버는 등록됐어요"), "{e}");
        let rec = Record::load(&p.record);
        assert!(rec.clis["claude"].server_added && rec.clis["claude"].allow.is_none());
        let cj = format!(
            "{{\"mcpServers\": {{\"waitscape\": {{\"command\": \"{}\", \"args\": [\"mcp\", \"--reports\", \"{}\"]}}}}}}",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.claude_json, cj).unwrap();
        assert_eq!(status(p)["clis"][0]["managed"], true);
        assert_eq!(plan(p, Cli::Claude, false, false).unwrap().cmds.len(), 1, "해제 가능");
    }

    /// 🟡-2: 옛 경로 등록을 고치다 remove는 되고 add가 실패하면 원래 등록을 되돌린다
    #[test]
    fn stale_fix_rolls_back_when_add_fails() {
        let t = setup("rollback");
        let p = &t.p;
        let old = json!({"type": "stdio", "command": "/old/waiting-room/bin/wr-hook", "args": ["mcp"], "env": {"A": "1"}});
        std::fs::write(&p.claude_json, json!({"mcpServers": {"waitscape": old.clone()}}).to_string()).unwrap();
        let calls = RefCell::new(vec![]);
        let run = |_: &Path, args: &[String]| {
            calls.borrow_mut().push(args.to_vec());
            if args[1] == "add" {
                Err("시간 초과".to_string())
            } else {
                Ok(String::new())
            }
        };
        let e = apply(p, plan(p, Cli::Claude, true, false).unwrap(), &run, "a").unwrap_err();
        assert!(e.contains("원래 등록은 되돌렸어요"), "{e}");
        let c = calls.borrow();
        assert_eq!(c.len(), 3);
        assert_eq!(c[2][..6], ["mcp", "add-json", "-s", "user", "waitscape", &old.to_string()]);
        assert!(Record::load(&p.record).clis.is_empty(), "아무것도 바뀌지 않았으니 기록 없음");
    }

    /// 🟡-3: settings.json이 없으면 {}에서 시작해 새로 만들고, 해제하면 우리가 만든 파일을 지운다
    #[test]
    fn missing_settings_is_created_and_removed() {
        let t = setup("newsettings");
        let p = &t.p;
        std::fs::write(&p.claude_json, "{}").unwrap();
        let ok = |_: &Path, _: &[String]| Ok(String::new());
        let pl = plan(p, Cli::Claude, true, true).unwrap();
        assert!(pl.notes.contains(&"new-file".to_string()) && pl.diff.iter().any(|l| l.contains("(새 파일)")));
        let r = apply(p, pl, &ok, "a").unwrap();
        assert_eq!(r.backups.len(), 1, "~/.claude.json 사본만 (settings.json은 백업할 원본 없음)");
        let v: Value = serde_json::from_slice(&std::fs::read(&p.claude_settings).unwrap()).unwrap();
        assert_eq!(v["permissions"]["allow"].as_array().unwrap().len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p.claude_settings).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let cj = format!(
            "{{\"mcpServers\": {{\"waitscape\": {{\"command\": \"{}\", \"args\": [\"mcp\", \"--reports\", \"{}\"]}}}}}}",
            p.cmd(),
            p.rep()
        );
        std::fs::write(&p.claude_json, cj).unwrap();
        apply(p, plan(p, Cli::Claude, false, false).unwrap(), &ok, "b").unwrap();
        assert!(!p.claude_settings.exists(), "앱이 만든 빈 파일은 지움");
    }

    /// 🟡-4: CRLF 파일은 CRLF 그대로 (구조적 제거로 해제해도)
    #[test]
    fn crlf_is_kept() {
        let t = setup("crlf");
        let p = &t.p;
        let none: Runner = &|_, _| unreachable!();
        let orig = "model = \"o4\"\r\n\r\n[mcp_servers.github]\r\ncommand = \"gh\"\r\n";
        std::fs::write(&p.codex_config, orig).unwrap();
        apply(p, plan(p, Cli::Codex, true, false).unwrap(), none, "a").unwrap();
        let text = std::fs::read_to_string(&p.codex_config).unwrap();
        assert!(!text.replace("\r\n", "").contains('\n'), "LF만 있는 줄 없음: {text:?}");
        let edited = text.replace("o4", "o5");
        std::fs::write(&p.codex_config, &edited).unwrap();
        apply(p, plan(p, Cli::Codex, false, false).unwrap(), none, "b").unwrap();
        assert_eq!(std::fs::read_to_string(&p.codex_config).unwrap(), orig.replace("o4", "o5"));
        let j = "{\r\n  \"mcpServers\": {\r\n    \"gh\": {\r\n      \"command\": \"gh\"\r\n    }\r\n  },\r\n  \"x\": 1\r\n}\r\n";
        std::fs::write(&p.antigravity_config, j).unwrap();
        apply(p, plan(p, Cli::Antigravity, true, false).unwrap(), none, "c").unwrap();
        let text = std::fs::read_to_string(&p.antigravity_config).unwrap();
        assert!(!text.replace("\r\n", "").contains('\n'));
        std::fs::write(&p.antigravity_config, text.replace("\"x\": 1", "\"x\": 2")).unwrap();
        apply(p, plan(p, Cli::Antigravity, false, false).unwrap(), none, "d").unwrap();
        assert_eq!(
            std::fs::read_to_string(&p.antigravity_config).unwrap(),
            j.replace("\"x\": 1", "\"x\": 2")
        );
    }

    #[test]
    fn manual_command_is_quoted() {
        let a: Vec<String> = ["mcp", "add", "/opt/my dir/x", "it's"].iter().map(|s| s.to_string()).collect();
        let l = shell_line(&a);
        if cfg!(windows) {
            assert_eq!(l, "mcp add \"/opt/my dir/x\" \"it's\"");
        } else {
            assert_eq!(l, "mcp add '/opt/my dir/x' 'it'\\''s'");
        }
    }

    #[test]
    fn runner_times_out_and_masks() {
        if cfg!(windows) {
            return;
        }
        let r = run_with_timeout(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 3".into()],
            None,
            Duration::from_millis(200),
        );
        assert_eq!(r.unwrap_err(), "시간 초과");
        let r = run_with_timeout(
            Path::new("/bin/sh"),
            &["-c".into(), "echo out; exit 0".into()],
            None,
            Duration::from_secs(5),
        );
        assert_eq!(r.unwrap(), "out\n");
        let r = run_with_timeout(
            Path::new("/bin/sh"),
            &["-c".into(), "echo bad >&2; exit 3".into()],
            None,
            Duration::from_secs(5),
        );
        assert_eq!(r.unwrap_err(), "종료 코드 3: bad");
    }
}

//! `wr-hook report`·`wr-hook run` — MCP를 못 쓰는(또는 쓰지 않는) 스크립트·에이전트가 사이드카와 **같은 형식**으로 `reports.jsonl`에
//! 보고하는 명령줄 입구. 기록·정화는 사이드카 코드를 그대로 쓴다(`mcp::append`, `report::status_of`·`board_of`·`key_ok`·`clean`).
//!
//! - `wr-hook report <hello|status|board|bye> --key K [--provider P | --client NAME] …` — 한 줄 append 후 바로 종료.
//!   성공(또는 `WAITING_ROOM_REPORTS=off`)은 출력 없이 0, 틀린 입력은 stderr 한 줄 + 2, 쓰기 실패는 stderr 한 줄 + 1.
//! - `wr-hook run [옵션] -- <명령…>` — 명령을 자식으로 실행하면서 hello → status working → (끝) status done → bye.
//!   stdin/stdout/stderr·종료 코드는 그대로 통과(신호로 끝나면 128+신호). 보고 실패·보고 옵션 오류는 명령 실행에 영향이 없다.
//!   pid는 래퍼 자신 — 래퍼가 죽으면 리더가 세션을 끝낸다. 자식 env에 `WAITSCAPE_PARENT=<이 세션 key>`를 넣어
//!   그 안에서 부른 `report`·`run`이 `--parent`를 생략해도 부모가 남는다.
//! - 경로: `--reports` > `WAITING_ROOM_REPORTS` > `$CLAUDE_CONFIG_DIR/waiting-room/reports.jsonl` > `~/.claude/waiting-room/reports.jsonl`
//!   (사이드카와 같은 `mcp::reports_path`).
//! - 속도 제한은 없다(프로세스 하나에 한 줄) — 부르는 쪽이 바뀔 때만 부른다.
#![deny(clippy::print_stdout)]

use crate::mcp::{append, reports_path, Head};
use crate::report::{self, board_of, key_ok, provider_of, status_of, PROVIDERS};
use crate::{env, now};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

/// `run`: 이만큼 넘게 걸려 성공하면 `big`(큰 일 축하)
pub const RUN_BIG_AFTER: f64 = 600.0;
/// 자식 env로 넘기는 부모 세션 key
pub const PARENT_ENV: &str = "WAITSCAPE_PARENT";
/// `run`이 자식 종료·신호를 확인하는 주기
const POLL: std::time::Duration = std::time::Duration::from_millis(100);

const REPORT_USAGE: &str = "usage: wr-hook report <hello|status|board|bye> --key KEY [--provider claude|codex|gemini|other] [--client NAME]
  [--cwd DIR] [--pid N] [--parent KEY] [--reports PATH|off]
  status: --state working|asking|done [--title T] [--step N --total M] [--big] [--cheer C]
  board:  --line TEXT (1-4) [--done I[,I…]]";
const RUN_USAGE: &str = "usage: wr-hook run [--provider P] [--client NAME] [--title T] [--key KEY] [--cwd DIR] [--parent KEY]
  [--cheer C] [--reports PATH|off] -- <command> [args…]";

/// 명령줄 옵션 (report·run 공통)
#[derive(Default, Debug)]
pub struct Opts {
    provider: Option<String>,
    client: Option<String>,
    client_version: Option<String>,
    key: Option<String>,
    cwd: Option<String>,
    pid: Option<String>,
    parent: Option<String>,
    reports: Vec<String>,
    state: Option<String>,
    title: Option<String>,
    step: Option<String>,
    total: Option<String>,
    big: bool,
    cheer: Option<String>,
    lines: Vec<String>,
    done: Vec<String>,
}

/// `--opt 값`·`--opt=값` 해석. `run`이면 `--` 또는 첫 비옵션 인자에서 멈추고 나머지(명령)를 돌려준다
pub fn parse(args: &[String], run: bool) -> Result<(Opts, Vec<String>), String> {
    let mut o = Opts::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            return Ok((o, args[i + 1..].to_vec()));
        }
        if run && !a.starts_with("--") {
            return Ok((o, args[i..].to_vec()));
        }
        let (name, inline) = match a.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n, Some(v.to_string())),
            _ => (a.as_str(), None),
        };
        if name == "--big" {
            o.big = true;
            i += 1;
            continue;
        }
        let mut val = || -> Result<String, String> {
            if let Some(v) = &inline {
                return Ok(v.clone());
            }
            i += 1;
            args.get(i).cloned().ok_or_else(|| format!("{name} needs a value"))
        };
        match name {
            "--provider" => o.provider = Some(val()?),
            "--client" => o.client = Some(val()?),
            "--client-version" => o.client_version = Some(val()?),
            "--key" => o.key = Some(val()?),
            "--cwd" => o.cwd = Some(val()?),
            "--pid" => o.pid = Some(val()?),
            "--parent" => o.parent = Some(val()?),
            "--reports" => {
                let v = val()?;
                o.reports = vec!["--reports".into(), v];
            }
            "--state" => o.state = Some(val()?),
            "--title" => o.title = Some(val()?),
            "--step" => o.step = Some(val()?),
            "--total" => o.total = Some(val()?),
            "--cheer" => o.cheer = Some(val()?),
            "--line" => o.lines.push(val()?),
            "--done" => o.done.push(val()?),
            _ => return Err(format!("unknown option: {}", report::clean(name, 32))),
        }
        i += 1;
    }
    if run {
        return Err("missing command (use: wr-hook run [options] -- <command>)".into());
    }
    Ok((o, vec![]))
}

/// 정수 인자 (bool·실수는 거절 — status_of와 같은 규칙으로 넘기기 위해 JSON 정수로)
fn int_arg(name: &str, v: &Option<String>) -> Result<Option<Value>, String> {
    match v {
        None => Ok(None),
        Some(s) => s
            .trim()
            .parse::<i64>()
            .map(|n| Some(json!(n)))
            .map_err(|_| format!("{name} must be an integer")),
    }
}

/// 검증을 마친 보고 머리 (소유 값)
#[derive(Debug, Clone)]
pub struct Who {
    pub path: Option<PathBuf>,
    pub key: String,
    pub provider: &'static str,
    pub client: Option<(String, String)>,
    pub cwd: String,
    pub pid: Option<u32>,
    pub parent: Option<String>,
    pub term: Option<Value>,
}

impl Who {
    /// `get`은 env 조회(테스트에서 바꿔 끼움). `key`가 없으면 `default_key`
    fn from(o: &Opts, get: &dyn Fn(&str) -> Option<String>, default_key: Option<String>) -> Result<Who, String> {
        let client = match &o.client {
            Some(c) => {
                let n = report::clean(c, 64);
                if n.is_empty() {
                    return Err("--client must not be empty".into());
                }
                Some((n, report::clean(o.client_version.as_deref().unwrap_or(""), 64)))
            }
            None => None,
        };
        let provider = match (&o.provider, &client) {
            (Some(p), _) => PROVIDERS
                .iter()
                .copied()
                .find(|x| *x == p.as_str())
                .ok_or_else(|| format!("--provider must be one of: {}", PROVIDERS.join(", ")))?,
            (None, Some((n, _))) => provider_of(n),
            (None, None) => return Err("--provider (or --client) is required".into()),
        };
        let key = o.key.clone().or(default_key).ok_or("--key is required")?;
        if !key_ok(&key) {
            return Err("--key must be 1-120 chars of A-Z a-z 0-9 - _ .".into());
        }
        let parent = o.parent.clone().or_else(|| get(PARENT_ENV)).filter(|p| !p.is_empty());
        if parent.as_deref().is_some_and(|p| !key_ok(p)) {
            return Err("--parent must be 1-120 chars of A-Z a-z 0-9 - _ .".into());
        }
        let pid = match o.pid.as_deref().map(str::trim) {
            None => None,
            Some("0") => None,
            Some(s) => Some(
                s.parse::<u32>()
                    .ok()
                    .filter(|&p| p > 0 && p <= i32::MAX as u32)
                    .ok_or("--pid must be a positive process id (0 = none)")?,
            ),
        };
        let here = std::env::current_dir().unwrap_or_default();
        let cwd = match &o.cwd {
            Some(c) if c.is_empty() => return Err("--cwd must not be empty".into()),
            Some(c) => here.join(c),
            None => here,
        };
        Ok(Who {
            path: reports_path(&o.reports),
            key,
            provider,
            client,
            cwd: cwd.to_string_lossy().into_owned(),
            pid,
            parent,
            term: crate::term::from_env(get),
        })
    }

    /// 한 줄 기록 (`off`면 아무것도 하지 않고 true)
    pub fn write(&self, typ: &str, payload: Map<String, Value>) -> bool {
        let Some(path) = &self.path else { return true };
        #[cfg(unix)]
        let ppid = Some(std::os::unix::process::parent_id());
        #[cfg(not(unix))]
        let ppid = None;
        let head = Head {
            key: &self.key,
            provider: self.provider,
            cwd: &self.cwd,
            pid: self.pid,
            ppid,
            term: self.term.as_ref(),
            parent: self.parent.as_deref(),
        };
        append(path, typ, &head, payload)
    }

    /// hello payload (사이드카와 같은 `client: {name, version}`)
    pub fn hello(&self) -> Map<String, Value> {
        let mut p = Map::new();
        if let Some((n, v)) = &self.client {
            p.insert("client".into(), json!({"name": n, "version": v}));
        }
        p
    }
}

/// 옵션 → (기록 종류, payload). status·board는 사이드카와 같은 정화(`status_of`·`board_of`)를 거친다
pub fn payload(typ: &str, o: &Opts) -> Result<Map<String, Value>, String> {
    match typ {
        "status" => {
            let mut d = Map::new();
            if let Some(s) = &o.state {
                d.insert("state".into(), json!(s));
            }
            if let Some(t) = &o.title {
                d.insert("title".into(), json!(t));
            }
            if let Some(n) = int_arg("--step", &o.step)? {
                d.insert("step".into(), n);
            }
            if let Some(n) = int_arg("--total", &o.total)? {
                d.insert("total".into(), n);
            }
            if o.big {
                d.insert("big".into(), json!(true));
            }
            if let Some(c) = &o.cheer {
                d.insert("cheer".into(), json!(c));
            }
            status_of(&Value::Object(d))
        }
        "board" => {
            let mut done = vec![];
            for d in o.done.iter().flat_map(|s| s.split(',')).filter(|s| !s.trim().is_empty()) {
                done.push(int_arg("--done", &Some(d.to_string()))?.unwrap_or(Value::Null));
            }
            board_of(&json!({"lines": o.lines, "done": done})).map_err(|_| "board needs 1-4 non-empty --line".into())
        }
        "hello" | "bye" => Ok(Map::new()),
        _ => Err("event must be one of: hello, status, board, bye".into()),
    }
}

/// `wr-hook report …` → 종료 코드
pub fn report_main(args: &[String]) -> i32 {
    if args.is_empty() || matches!(args[0].as_str(), "-h" | "--help") {
        eprintln!("{REPORT_USAGE}");
        return if args.is_empty() { 2 } else { 0 };
    }
    match report_cmd(args, &env) {
        Ok(true) => 0,
        Ok(false) => {
            eprintln!("wr-hook report: could not write the reports file");
            1
        }
        Err(e) => {
            eprintln!("wr-hook report: {e}");
            2
        }
    }
}

/// 검증 → 기록. Ok(false) = 쓰기 실패
pub fn report_cmd(args: &[String], get: &dyn Fn(&str) -> Option<String>) -> Result<bool, String> {
    let typ = args[0].as_str();
    let (o, _) = parse(&args[1..], false)?;
    let p = payload(typ, &o)?;
    let who = Who::from(&o, get, None)?;
    let p = if typ == "hello" { who.hello() } else { p };
    Ok(who.write(typ, p))
}

/// 자식 종료 상태 → 셸 관례의 종료 코드 (신호면 128+신호)
fn exit_code(st: std::process::ExitStatus) -> i32 {
    if let Some(c) = st.code() {
        return c;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(s) = st.signal() {
            return 128 + s;
        }
    }
    1
}

/// 끝 보고 payload: 실패면 cheer "실패(코드 N)", 성공이면 `--cheer`, 오래 걸린 성공은 big
pub fn done_payload(code: i32, secs: f64, title: &Option<String>, cheer: &Option<String>) -> Map<String, Value> {
    let mut d = json!({"state": "done"});
    if let Some(t) = title {
        d["title"] = json!(t);
    }
    if code != 0 {
        d["cheer"] = json!(format!("실패(코드 {code})"));
    } else {
        if let Some(c) = cheer {
            d["cheer"] = json!(c);
        }
        if secs >= RUN_BIG_AFTER {
            d["big"] = json!(true);
        }
    }
    status_of(&d).unwrap_or_default()
}

#[cfg(unix)]
mod sig {
    use std::sync::atomic::{AtomicI32, Ordering};
    /// 받은 신호 (0 = 없음). 처리기는 이 값만 바꾼다
    pub static GOT: AtomicI32 = AtomicI32::new(0);
    extern "C" {
        fn signal(sig: i32, handler: extern "C" fn(i32)) -> usize;
        fn kill(pid: i32, sig: i32) -> i32;
        fn getpgrp() -> i32;
        fn tcgetpgrp(fd: i32) -> i32;
    }
    extern "C" fn on_sig(s: i32) {
        GOT.store(s, Ordering::SeqCst);
    }
    /// SIGHUP 1, SIGINT 2, SIGTERM 15 (macOS·Linux 같음)
    pub fn install() {
        for s in [1, 2, 15] {
            // SAFETY: 처리기는 원자 변수 하나만 바꾼다(async-signal-safe)
            unsafe {
                signal(s, on_sig);
            }
        }
    }
    /// 받은 신호를 자식에게 전달. 단말에서 누른 Ctrl-C는 같은 전경 프로세스 그룹인 자식도 이미 받았으므로 다시 보내지 않는다
    pub fn forward(child: u32) {
        let s = GOT.swap(0, Ordering::SeqCst);
        if s == 0 {
            return;
        }
        // SAFETY: 읽기 전용 조회와 자식 pid로의 신호 전송
        unsafe {
            if s == 2 && tcgetpgrp(0) == getpgrp() {
                return;
            }
            if let Ok(p) = i32::try_from(child) {
                kill(p, s);
            }
        }
    }
}

/// `wr-hook run …` → 종료 코드 (자식의 종료 코드)
pub fn run_main(args: &[String]) -> i32 {
    if args.first().is_some_and(|a| matches!(a.as_str(), "-h" | "--help")) {
        eprintln!("{RUN_USAGE}");
        return 0;
    }
    let (o, cmd) = match parse(args, true) {
        Ok(x) if !x.1.is_empty() => x,
        Ok(_) => {
            eprintln!("wr-hook run: missing command\n{RUN_USAGE}");
            return 2;
        }
        Err(e) => {
            eprintln!("wr-hook run: {e}\n{RUN_USAGE}");
            return 2;
        }
    };
    let start = now();
    let prog = std::path::Path::new(&cmd[0])
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| cmd[0].clone());
    // 제목 기본값은 실행 파일 이름뿐 — 인자(프롬프트·경로)는 싣지 않는다
    let title = Some(o.title.clone().unwrap_or_else(|| prog.clone()));
    let me = std::process::id();
    let kp = o
        .provider
        .clone()
        .or_else(|| o.client.as_deref().map(|c| provider_of(&report::clean(c, 64)).to_string()))
        .filter(|p| key_ok(p))
        .unwrap_or_else(|| "ai".into());
    let default_key = format!("{kp}-run-{me}-{}", (start * 1000.0) as u64);
    let mut o = o;
    o.pid = Some(me.to_string());
    // 보고 옵션이 틀려도 명령은 실행한다(보고만 끔)
    let who = match Who::from(&o, &env, Some(default_key)) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("wr-hook run: reporting off: {e}");
            None
        }
    };
    let report = |typ: &str, p: Map<String, Value>| {
        if let Some(w) = &who {
            w.write(typ, p);
        }
    };
    if let Some(w) = &who {
        report("hello", w.hello());
        let mut d = json!({"state": "working"});
        if let Some(t) = &title {
            d["title"] = json!(t);
        }
        report("status", status_of(&d).unwrap_or_default());
    }
    let mut c = std::process::Command::new(&cmd[0]);
    c.args(&cmd[1..]);
    if let Some(w) = &who {
        c.env(PARENT_ENV, &w.key);
    }
    #[cfg(unix)]
    sig::install();
    let code = match c.spawn() {
        Err(e) => {
            eprintln!("wr-hook run: cannot run {}: {}", report::clean(&prog, 64), e.kind());
            if e.kind() == std::io::ErrorKind::NotFound {
                127
            } else {
                126
            }
        }
        Ok(mut child) => loop {
            #[cfg(unix)]
            sig::forward(child.id());
            match child.try_wait() {
                Ok(Some(st)) => break exit_code(st),
                Ok(None) => std::thread::sleep(POLL),
                Err(_) => break child.wait().map(exit_code).unwrap_or(1),
            }
        },
    };
    report("status", done_payload(code, now() - start, &None, &o.cheer));
    report("bye", Map::new());
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn tmp(tag: &str) -> PathBuf {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("wr-cli-unit-{tag}-{}-{t}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d.join("reports.jsonl")
    }

    fn lines(p: &PathBuf) -> Vec<Value> {
        std::fs::read_to_string(p)
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn writes_sidecar_format() {
        let p = tmp("fmt");
        let ps = p.to_string_lossy().into_owned();
        let base = ["--key", "review-pr58-1", "--cwd", "/w/waitscape", "--pid", "4242", "--reports", &ps];
        let cmd = |extra: &[&str]| {
            let mut v = a(extra);
            v.extend(a(&base));
            report_cmd(&v, &no_env)
        };
        assert_eq!(cmd(&["hello", "--client", "antigravity-cli", "--parent", "sid-1"]), Ok(true));
        let k = ["gh", "p_", "aBcDeFgH12345678"].concat();
        let t = format!("PR #58 교차 리뷰 {k}");
        assert_eq!(
            cmd(&[
                "status",
                "--provider",
                "gemini",
                "--state",
                "working",
                "--title",
                &t,
                "--step",
                "2",
                "--total",
                "6"
            ]),
            Ok(true)
        );
        assert_eq!(
            cmd(&[
                "board",
                "--provider",
                "gemini",
                "--line",
                "✓ base 0건",
                "--line",
                "⏳ state",
                "--done",
                "0"
            ]),
            Ok(true)
        );
        assert_eq!(cmd(&["bye", "--provider", "gemini"]), Ok(true));
        let all = lines(&p);
        assert_eq!(all.len(), 4);
        for l in &all {
            for k in ["v", "ts", "type", "key", "provider", "cwd", "pid", "wr"] {
                assert!(l.get(k).is_some(), "{k} 없음: {l}");
            }
            assert_eq!((l["provider"].as_str(), l["pid"].as_i64()), (Some("gemini"), Some(4242)));
        }
        assert_eq!(all[0]["client"], json!({"name": "antigravity-cli", "version": ""}));
        assert_eq!(all[0]["parent"], json!("sid-1"));
        assert!(all[1].get("parent").is_none());
        assert_eq!(all[1]["title"], json!("PR #58 교차 리뷰 <REDACTED>"), "사이드카와 같은 마스킹");
        assert_eq!((all[1]["step"].as_i64(), all[1]["total"].as_i64()), (Some(2), Some(6)));
        assert_eq!(all[2]["lines"], json!(["✓ base 0건", "⏳ state"]));
        assert_eq!(all[2]["done"], json!([0]));
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    #[test]
    fn rejects_bad_input() {
        let p = tmp("bad");
        let ps = p.to_string_lossy().into_owned();
        let r = |v: &[&str]| {
            let mut v = a(v);
            v.extend(a(&["--reports", &ps]));
            report_cmd(&v, &no_env)
        };
        assert!(r(&["status", "--provider", "cursor", "--key", "k", "--state", "working"]).is_err());
        assert!(r(&["status", "--provider", "gemini", "--key", "../x", "--state", "working"]).is_err());
        assert!(r(&["status", "--provider", "gemini", "--state", "working"]).is_err(), "key 필수");
        assert!(r(&["status", "--key", "k", "--state", "working"]).is_err(), "provider 필수");
        assert!(r(&["status", "--provider", "gemini", "--key", "k", "--state", "nope"]).is_err());
        assert!(r(&["status", "--provider", "gemini", "--key", "k", "--state", "working", "--step", "x"]).is_err());
        assert!(r(&["board", "--provider", "gemini", "--key", "k"]).is_err());
        assert!(r(&["oops", "--provider", "gemini", "--key", "k"]).is_err());
        assert!(r(&["bye", "--provider", "gemini", "--key", "k", "--pid", "-3"]).is_err());
        assert!(r(&["bye", "--provider", "gemini", "--key", "k", "--parent", "a b"]).is_err());
        assert!(r(&["bye", "--provider", "gemini", "--key", "k", "--frob", "1"]).is_err());
        assert!(!p.exists(), "틀린 입력은 아무것도 쓰지 않는다");
        // --client만 주면 표시 규칙(provider_of)으로 provider를 정한다. 모든 PROVIDERS를 받는다
        for (c, want) in [
            ("codex-mcp-client", "codex"),
            ("claude-code", "claude"),
            ("antigravity-cli", "gemini"),
        ] {
            assert_eq!(r(&["hello", "--client", c, "--key", "k"]), Ok(true));
            assert_eq!(lines(&p).last().unwrap()["provider"], json!(want));
        }
        for prov in PROVIDERS {
            assert_eq!(r(&["bye", "--provider", prov, "--key", "k"]), Ok(true));
        }
        // off면 쓰지 않고 성공
        let off = report_cmd(&a(&["bye", "--provider", "gemini", "--key", "k", "--reports", "off"]), &no_env);
        assert_eq!(off, Ok(true));
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    #[test]
    fn parent_from_env_and_done_payload() {
        let p = tmp("env");
        let ps = p.to_string_lossy().into_owned();
        let get = |k: &str| (k == PARENT_ENV).then(|| "codex-run-1-2".to_string());
        let v = a(&["hello", "--provider", "claude", "--key", "k2", "--reports", &ps]);
        assert_eq!(report_cmd(&v, &get), Ok(true));
        assert_eq!(lines(&p)[0]["parent"], json!("codex-run-1-2"));
        assert!(lines(&p)[0].get("pid").is_none(), "--pid 없으면 pid 없음(bye·STALE로 끝남)");
        let d = done_payload(3, 5.0, &None, &Some("좋아".into()));
        assert_eq!(Value::Object(d), json!({"state": "done", "cheer": "실패(코드 3)"}));
        let d = done_payload(0, RUN_BIG_AFTER, &None, &Some("좋아".into()));
        assert_eq!(Value::Object(d), json!({"state": "done", "big": true, "cheer": "좋아"}));
        std::fs::remove_dir_all(p.parent().unwrap()).ok();
    }

    #[test]
    fn run_parse_stops_at_command() {
        let (o, cmd) = parse(&a(&["--provider", "gemini", "--title=리뷰", "--", "agy", "-p", "--x"]), true).unwrap();
        assert_eq!((o.provider.as_deref(), o.title.as_deref()), (Some("gemini"), Some("리뷰")));
        assert_eq!(cmd, a(&["agy", "-p", "--x"]));
        let (_, cmd) = parse(&a(&["--client", "codex-mcp-client", "codex", "exec", "hi"]), true).unwrap();
        assert_eq!(cmd, a(&["codex", "exec", "hi"]));
        assert!(parse(&a(&["--provider", "gemini"]), true).is_err());
    }
}

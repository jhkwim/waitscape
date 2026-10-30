//! `wr-hook report`·`wr-hook run` 통합 테스트: 실제 바이너리가 쓴 줄을 wr-core 리더(`providers::mcp`)로 읽어
//! 스튜디오에 보일 세션이 되는지 확인한다. 기록 파일은 모두 임시 폴더(`WAITING_ROOM_REPORTS`). 실제 ~/.claude는 건드리지 않는다.

use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use wr_core::clock::Tz;
use wr_core::provider::{Ctx, Provider};
use wr_core::providers::mcp::{McpConfig, McpProvider};

const BIN_PATH: &str = env!("CARGO_BIN_EXE_wr-hook");

/// `report`를 모르는 오래된 바이너리(앱 빌드가 사이드카로 덮어쓴 경우)는 훅 모드로 0을 돌려준다 → 고칠 방법과 함께 실패
fn bin() -> &'static str {
    let out = Command::new(BIN_PATH).arg("report").stdin(Stdio::null()).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "{BIN_PATH}가 `report`를 모름 — `sh scripts/build_sidecar.sh` 후 target/debug/wr-hook을 지우고 다시 테스트"
    );
    BIN_PATH
}

fn tmp(tag: &str) -> PathBuf {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("wr-report-it-{tag}-{}-{t}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d.join("reports.jsonl")
}

fn cmd(p: &Path) -> Command {
    let mut c = Command::new(bin());
    c.env("WAITING_ROOM_REPORTS", p)
        .env_remove("WAITSCAPE_PARENT")
        .env_remove("CLAUDE_CONFIG_DIR");
    c
}

fn report(p: &Path, args: &[&str]) -> Output {
    cmd(p).arg("report").args(args).stdin(Stdio::null()).output().unwrap()
}

fn reader(p: &Path) -> McpProvider {
    McpProvider::new(McpConfig {
        path: p.to_path_buf(),
        on: true,
        check_pids: true,
        hide_user: vec![],
        hide_builtin: true,
    })
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}

fn ctx() -> Ctx {
    Ctx {
        now: now(),
        tz: Tz::Fixed(0),
        home: String::new(),
    }
}

fn records(p: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// hello(antigravity-cli) → status → board → bye: 리더가 Gemini(표시 이름 Antigravity) 세션 하나로 보고, bye 뒤에는 끝낸다
#[test]
fn report_round_trip_through_reader() {
    let p = tmp("rt");
    let me = std::process::id().to_string(); // 살아 있는 pid (수명 기준)
    let base = [
        "--provider",
        "gemini",
        "--key",
        "review-pr58-20261030-120000",
        "--cwd",
        "/w/waitscape",
        "--pid",
        &me,
    ];
    let ok = |extra: &[&str]| {
        let mut a: Vec<&str> = extra.to_vec();
        a.extend(base);
        let o = report(&p, &a);
        assert_eq!(o.status.code(), Some(0), "{}", String::from_utf8_lossy(&o.stderr));
        assert!(o.stdout.is_empty() && o.stderr.is_empty(), "성공은 조용히");
    };
    ok(&["hello", "--client", "antigravity-cli"]);
    let secret = ["sk-", "ant-", "api03-", "ZZZZZZZZZZZZZZZZ"].concat();
    let title = format!("PR #58 교차 리뷰 {secret}");
    ok(&["status", "--state", "working", "--title", &title, "--step", "1", "--total", "6"]);
    ok(&["board", "--line", "✓ base 0건", "--line", "⏳ state", "--done", "0"]);
    let mut m = reader(&p);
    let s = m.snapshot(&ctx());
    assert_eq!(s.sessions.len(), 1);
    let x = &s.sessions[0];
    assert_eq!((x.status, x.provider, x.project.as_str()), ("working", Some("gemini"), "waitscape"));
    assert_eq!(x.prompt, json!("PR #58 교차 리뷰 <REDACTED>"), "마스킹");
    let r = x.report.as_ref().unwrap();
    assert_eq!((r["step"].clone(), r["total"].clone()), (json!(1), json!(6)));
    assert_eq!(r["board"]["lines"], json!(["✓ base 0건", "⏳ state"]));
    assert_eq!(r["board"]["done"], json!([0]));
    let i = m.infos();
    assert_eq!((i[0].id, i[0].name), ("gemini", "Antigravity"));
    assert!(!std::fs::read_to_string(&p).unwrap().contains(&secret));
    ok(&["status", "--state", "done", "--cheer", "지적 🔴0 🟡1 🔵2"]);
    let s = m.snapshot(&ctx());
    assert_eq!(s.sessions[0].status, "done");
    assert_eq!(s.sessions[0].report.as_ref().unwrap()["cheer"], json!("지적 🔴0 🟡1 🔵2"));
    ok(&["bye"]);
    assert!(m.snapshot(&ctx()).sessions.is_empty(), "bye로 끝");
    std::fs::remove_dir_all(p.parent().unwrap()).ok();
}

/// 틀린 입력: 0이 아닌 종료 코드 + stderr 한 줄, 아무것도 쓰지 않는다
#[test]
fn report_rejects_bad_input() {
    let p = tmp("bad");
    for a in [
        &["status", "--provider", "cursor", "--key", "k", "--state", "working"][..],
        &["status", "--provider", "gemini", "--key", "../x", "--state", "working"],
        &["status", "--provider", "gemini", "--key", "k", "--state", "busy"],
        &["board", "--provider", "gemini", "--key", "k"],
    ] {
        let o = report(&p, a);
        assert_eq!(o.status.code(), Some(2), "{a:?}");
        let err = String::from_utf8_lossy(&o.stderr);
        assert!(err.starts_with("wr-hook report: ") && err.lines().count() == 1, "{err}");
    }
    assert!(!p.exists());
    std::fs::remove_dir_all(p.parent().unwrap()).ok();
}

/// run: 출력·종료 코드 통과, hello → working → done(실패 코드) → bye, 부모 key를 자식 env로
#[test]
fn run_wraps_command() {
    if cfg!(windows) {
        return;
    }
    let p = tmp("run");
    let o = cmd(&p)
        .args([
            "run",
            "--client",
            "codex-mcp-client",
            "--title",
            "야간 점검",
            "--parent",
            "sid-abc",
            "--",
        ])
        .args(["sh", "-c", "echo out; echo err >&2; echo \"$WAITSCAPE_PARENT\"; exit 3"])
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(3));
    let out = String::from_utf8_lossy(&o.stdout);
    let mut lines = out.lines();
    assert_eq!(lines.next(), Some("out"));
    let key = lines.next().unwrap().to_string();
    assert!(key.starts_with("codex-run-"), "{key}");
    assert_eq!(String::from_utf8_lossy(&o.stderr), "err\n");
    let all = records(&p);
    let types: Vec<_> = all.iter().map(|l| l["type"].as_str().unwrap().to_string()).collect();
    assert_eq!(types, ["hello", "status", "status", "bye"]);
    assert!(all
        .iter()
        .all(|l| l["key"] == json!(key) && l["provider"] == "codex" && l["parent"] == "sid-abc"));
    assert_eq!(all[0]["client"]["name"], "codex-mcp-client");
    assert_eq!(
        (all[1]["state"].as_str(), all[1]["title"].as_str()),
        (Some("working"), Some("야간 점검"))
    );
    assert_eq!(
        (all[2]["state"].as_str(), all[2]["cheer"].as_str()),
        (Some("done"), Some("실패(코드 3)"))
    );
    // 보고를 못 써도(경로가 폴더) 명령은 그대로
    let o = Command::new(bin())
        .env("WAITING_ROOM_REPORTS", p.parent().unwrap())
        .args(["run", "--provider", "claude", "--", "sh", "-c", "exit 0"])
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(0));
    // 보고 옵션이 틀려도(값이 틀림·모르는 옵션) `--` 뒤 명령은 실행(경고만)
    for bad in [&["--provider", "cursor"][..], &["--frobnicate", "x", "--provider", "gemini"]] {
        let o = cmd(&p).arg("run").args(bad).args(["--", "sh", "-c", "exit 5"]).output().unwrap();
        assert_eq!(o.status.code(), Some(5), "{bad:?}");
        assert!(String::from_utf8_lossy(&o.stderr).contains("reporting off"));
    }
    // provider claude: 직원이 생기지 않는다는 경고 한 줄, 실행은 그대로
    let o = cmd(&p)
        .args(["run", "--client", "claude-code", "--", "sh", "-c", "exit 0"])
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&o.stderr).contains("provider claude"));
    // 없는 명령 → 127
    let o = cmd(&p)
        .args(["run", "--provider", "gemini", "--", "/nonexistent/agy-xyz"])
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(127));
    std::fs::remove_dir_all(p.parent().unwrap()).ok();
}

/// run: SIGTERM을 자식에게 전달하고, 끝 보고(done·bye)를 남긴 뒤 128+15로 끝난다. 실행 중에는 리더에 세션이 보인다
#[cfg(unix)]
#[test]
fn run_forwards_sigterm() {
    let p = tmp("sig");
    let mut child = cmd(&p)
        .args(["run", "--provider", "gemini", "--client", "antigravity-cli", "--", "sleep", "30"])
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let t0 = std::time::Instant::now();
    while records(&p).len() < 2 && t0.elapsed() < std::time::Duration::from_secs(10) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let mut m = reader(&p);
    let s = m.snapshot(&ctx());
    assert_eq!((s.sessions.len(), s.sessions[0].status), (1, "working"));
    assert_eq!(s.sessions[0].prompt, json!("sleep"), "제목 기본값은 실행 파일 이름(인자 없음)");
    Command::new("kill").args(["-TERM", &child.id().to_string()]).status().unwrap();
    let t0 = std::time::Instant::now();
    let st = loop {
        if let Some(st) = child.try_wait().unwrap() {
            break st;
        }
        assert!(t0.elapsed() < std::time::Duration::from_secs(10), "신호를 전달하지 않음");
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    assert_eq!(st.code(), Some(128 + 15));
    let all = records(&p);
    let types: Vec<_> = all.iter().map(|l| l["type"].as_str().unwrap().to_string()).collect();
    assert_eq!(types, ["hello", "status", "bye"], "중단은 done 없이 bye만(일지 집계에 넣지 않음)");
    assert!(m.snapshot(&ctx()).sessions.is_empty());
    std::fs::remove_dir_all(p.parent().unwrap()).ok();
}

/// 무시(SIG_IGN)로 물려받은 SIGTERM(nohup·`&`)은 되살리지 않는다: 래퍼도 자식도 계속 돌고 정상 끝(done) 보고
#[cfg(unix)]
#[test]
fn run_keeps_ignored_signals() {
    let p = tmp("ign");
    let script = format!("trap '' TERM; exec '{}' run --provider gemini -- sleep 1", bin());
    let mut child = Command::new("sh")
        .args(["-c", &script])
        .env("WAITING_ROOM_REPORTS", &p)
        .env_remove("WAITSCAPE_PARENT")
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let t0 = std::time::Instant::now();
    while records(&p).len() < 2 && t0.elapsed() < std::time::Duration::from_secs(10) {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    Command::new("kill").args(["-TERM", &child.id().to_string()]).status().unwrap();
    let st = child.wait().unwrap();
    assert_eq!(st.code(), Some(0), "무시된 SIGTERM으로 끝나면 안 됨");
    let all = records(&p);
    let types: Vec<_> = all.iter().map(|l| l["type"].as_str().unwrap().to_string()).collect();
    assert_eq!(types, ["hello", "status", "status", "bye"]);
    assert_eq!(all[2]["state"], "done");
    std::fs::remove_dir_all(p.parent().unwrap()).ok();
}

/// `report --help`는 기능 표시 문자열을 내고 0 (스크립트가 옛 wr-hook과 구분하는 데 씀)
#[test]
fn report_help_has_capability() {
    let o = Command::new(bin())
        .args(["report", "--help"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&o.stderr).contains("waitscape-report-cli-v1"));
}

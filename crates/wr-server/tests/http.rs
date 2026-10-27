//! wr-server HTTP 동작: Host 검사(DNS 리바인딩), HEAD 제한, 정적 규칙, /state·/trace·/daylog, POST /daylog/seen(CSRF), 메서드 제한. 포트 7792(사용 중이면 빈 포트).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// 지정 포트 7792(사용 중이면 빈 포트). 이미 다른 프로세스가 쓰고 있으면(그 프로세스는 건드리지 않음) 빈 포트로 대신한다.
fn pick_port() -> u16 {
    if std::net::TcpListener::bind(("127.0.0.1", 7792)).is_ok() {
        return 7792;
    }
    std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port()
}

/// 지금 시각의 훅 이벤트 몇 줄 (fixture 이벤트는 실제 시계로는 6시간이 지나 숨겨지므로)
fn fresh_log() -> std::path::PathBuf {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let dir = std::env::temp_dir().join(format!("wr-http-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("events.jsonl");
    let lines = [
        serde_json::json!({"ts": now - 5.0, "sid": "fx-flow", "cwd": "/Users/alex/dev/shop-api", "event": "UserPromptSubmit", "text": "테스트"}),
        serde_json::json!({"ts": now - 2.0, "sid": "fx-flow", "cwd": "/Users/alex/dev/shop-api", "event": "PreToolUse", "icon": "📖", "text": "a.py 읽는 중", "kind": "read"}),
    ];
    std::fs::write(&p, lines.iter().map(|l| l.to_string() + "\n").collect::<String>()).unwrap();
    p
}

/// 외부 모드 하나가 든 사용자 모드 폴더
fn user_modes() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("wr-http-modes-{}", std::process::id()));
    let m = d.join("demo");
    std::fs::create_dir_all(&m).unwrap();
    std::fs::write(m.join("mode.json"), r#"{"id":"demo","entry":"mode.js","styles":["mode.css"]}"#).unwrap();
    std::fs::write(m.join("mode.js"), "Core.registerMode({id:'demo'})").unwrap();
    std::fs::write(d.join("outside.js"), "secret").unwrap();
    d
}

/// 일지 폴더 (사용자 실제 폴더에 쓰지 않게 임시 폴더)
fn daylog_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("wr-http-daylog-{}", std::process::id()))
}

/// 헤더·본문을 직접 넣는 요청 → (상태 코드, 본문)
fn raw(port: u16, head: &str, body: &str) -> (u16, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(s, "{head}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).to_string();
    let (h, b) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    (h.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0), b.to_string())
}

struct Srv(Child);
impl Drop for Srv {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(port: u16) -> Srv {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fx = root.join("fixtures/input");
    let child = Command::new(env!("CARGO_BIN_EXE_wr-server"))
        .args(["--port", &port.to_string(), "--root", root.to_str().unwrap()])
        .env("WAITING_ROOM_LOG", fresh_log())
        .env("WAITING_ROOM_STATUS", fx.join("statusline.json"))
        .env("WAITING_ROOM_PROJECTS", fx.join("projects"))
        .env("WAITING_ROOM_SOURCE", "hooks")
        .env("WAITING_ROOM_MODES", user_modes())
        .env("WAITING_ROOM_DAYLOG", daylog_dir())
        // MCP 보고도 사용자 실제 폴더 대신 fixture
        .env("WAITING_ROOM_REPORTS", fx.join("reports.jsonl"))
        .env_remove("WAITING_ROOM_POLL_USAGE")
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Srv(child)
}

/// (상태 코드, 헤더 원문, 본문)
fn req(port: u16, method: &str, path: &str, host: Option<&str>) -> (u16, String, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let h = host.map(|h| format!("Host: {h}\r\n")).unwrap_or_default();
    write!(s, "{method} {path} HTTP/1.1\r\n{h}Connection: close\r\n\r\n").unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let code = head.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    (code, head.to_string(), body.to_string())
}

#[test]
fn http_rules() {
    let port = pick_port();
    let _srv = start(port);
    let req = |m: &str, p: &str, h: Option<&str>| req(port, m, p, h);
    let ok = format!("127.0.0.1:{port}");
    let lh = format!("LOCALHOST:{port}");

    // Host 검사
    assert_eq!(req("GET", "/state", Some(&format!("evil.example:{port}"))).0, 403);
    assert_eq!(req("GET", "/state", Some("127.0.0.1:7777")).0, 403, "다른 포트 Host 거부");
    assert_eq!(req("GET", "/state", None).0, 403);
    // 중복 Host 헤더는 둘 다 허용 값이어도 403 (프록시·파서 불일치 악용 방지)
    let dup = format!("{ok}\r\nHost: {ok}");
    assert_eq!(req("GET", "/state", Some(&dup)).0, 403, "중복 Host 거부");
    let dup2 = format!("{ok}\r\nHost: evil.example:{port}");
    assert_eq!(req("GET", "/state", Some(&dup2)).0, 403);
    let (c, h, body) = req("GET", "/state", Some(&lh));
    assert_eq!(c, 200);
    assert!(h.contains("application/json") && h.contains("no-store"));
    assert!(!h.to_ascii_lowercase().contains("access-control"), "CORS 헤더 없음");
    let st: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(st["sessions"].as_array().is_some_and(|a| !a.is_empty()));

    // /trace
    let (c, _, b) = req("GET", "/trace?session=..%2Fetc%2Fpasswd", Some(&ok));
    assert_eq!((c, b.as_str()), (400, r#"{"error":"bad-session"}"#));
    let (c, _, b) = req("GET", "/trace?session=fx-flow&prompt=last", Some(&ok));
    let t: serde_json::Value = serde_json::from_str(&b).unwrap();
    assert_eq!((c, t["session"].as_str()), (200, Some("fx-flow")));
    assert!(t["steps"].as_array().unwrap().len() > 10);

    // 정적 규칙 (web/ 루트, server.py STATIC과 같은 정규식)
    let (c, h, b) = req("GET", "/core/core.js", Some(&ok));
    assert_eq!(c, 200);
    assert!(h.contains("text/javascript") && h.contains("no-cache") && h.contains("nosniff") && !b.is_empty());
    assert_eq!(req("GET", "/modes/flow/mode.js", Some(&ok)).0, 200);
    assert_eq!(req("GET", "/modes/index.json", Some(&ok)).0, 200);
    assert_eq!(req("GET", "/", Some(&ok)).0, 200);
    assert_eq!(req("GET", "/?x=1", Some(&ok)).0, 200, "경로 기준 매칭(쿼리 무시)");
    assert_eq!(req("GET", "/brand.json", Some(&ok)).0, 200);
    let (c, h, _) = req("GET", "/fonts/Galmuri11.woff2", Some(&ok));
    assert_eq!(c, 200);
    assert!(h.contains("font/woff2"), "{h}");
    for bad in [
        "/fonts/OFL.txt",
        "/fonts/../server.py",
        "/fonts/a/b.woff2",
        "/fonts/x.ttf",
        "/server.py",
        "/core.js",
        "/modes/../server.py",
        "/core/../../server.py",
        "/fixtures/fake_secrets.json",
        "/web/index.html",
    ] {
        assert_eq!(req("GET", bad, Some(&ok)).0, 404, "{bad}");
    }

    // 모드 목록·외부 모드 샌드박스
    let (c, _, b) = req("GET", "/modes", Some(&ok));
    let m: serde_json::Value = serde_json::from_str(&b).unwrap();
    assert_eq!(c, 200);
    assert!(m["modes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["dir"] == "demo" && x["source"] == "user"));
    let (c, h, b) = req("GET", "/_modes/demo/index.html", Some(&ok));
    assert_eq!(c, 200);
    assert!(h.contains("Content-Security-Policy") && h.contains("connect-src 'none'") && h.contains("sandbox allow-scripts"));
    assert!(h.contains(&format!("script-src http://127.0.0.1:{port}/_modes/demo/")));
    assert!(b.contains("/_sdk/mode-sdk.js"));
    assert_eq!(req("GET", "/_modes/demo/mode.js", Some(&ok)).0, 200);
    assert_eq!(req("GET", "/_modes/demo/../outside.js", Some(&ok)).0, 404);
    assert_eq!(req("GET", "/_modes/nope/mode.js", Some(&ok)).0, 404);
    let (c, h, _) = req("GET", "/_sdk/mode-sdk.js", Some(&ok));
    assert!(c == 200 && h.contains("Content-Security-Policy"));

    // HEAD: GET과 같은 헤더, 본문 없음
    let (c, h, b) = req("HEAD", "/core/core.css", Some(&ok));
    assert_eq!((c, b.len()), (200, 0));
    assert!(h.contains("Content-Length"));
    assert_eq!(req("HEAD", "/server.py", Some(&ok)).0, 404);
    assert_eq!(req("HEAD", "/core/core.js", Some("evil:1")).0, 403);

    // 퇴근 일보: GET /daylog, POST /daylog/seen (JSON만·같은 출처만)
    let (c, h, b) = req("GET", "/daylog", Some(&ok));
    assert!(c == 200 && h.contains("application/json") && h.contains("no-store"), "{h}");
    let d: serde_json::Value = serde_json::from_str(&b).unwrap();
    assert!(
        d["day"].as_str().is_some_and(|x| x.len() == 10) && d["rule"]["day_hour"] == 4,
        "{d}"
    );
    assert_eq!(req("GET", "/daylog?day=yesterday", Some(&ok)).0, 200);
    let (c, _, b) = req("GET", "/daylog?day=..%2Fetc", Some(&ok));
    assert_eq!((c, b.as_str()), (400, r#"{"error":"bad-day"}"#));
    let post = |extra: &str, ctype: &str, body: &str| {
        raw(
            port,
            &format!("POST /daylog/seen HTTP/1.1\r\nHost: {ok}\r\n{extra}Content-Type: {ctype}\r\n"),
            body,
        )
    };
    let (c, b) = post(
        &format!("Origin: http://{ok}\r\nSec-Fetch-Site: same-origin\r\n"),
        "application/json",
        r#"{"day":"yesterday"}"#,
    );
    let v: serde_json::Value = serde_json::from_str(&b).unwrap();
    assert!(c == 200 && v["seen"].as_f64().is_some(), "{b}");
    assert_eq!(
        post("Origin: http://evil.example\r\n", "application/json", r#"{"day":"today"}"#).0,
        403,
        "다른 출처"
    );
    assert_eq!(
        post("Sec-Fetch-Site: cross-site\r\n", "application/json", r#"{"day":"today"}"#).0,
        403
    );
    assert_eq!(post("", "text/plain", r#"{"day":"today"}"#).0, 415, "단순 요청(폼·text/plain) 거부");
    assert_eq!(
        post("", "application/json", &format!(r#"{{"day":"today","x":"{}"}}"#, "a".repeat(2000))).0,
        413
    );
    assert_eq!(post("", "application/json", r#"{"day":"../x"}"#).0, 400);
    assert_eq!(post("", "application/json", "[]").0, 400);
    assert_eq!(req("POST", "/daylog/seen", Some("evil:1")).0, 403, "Host 검사가 먼저");
    let y = std::fs::read_dir(daylog_dir())
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().ends_with(".json"));
    assert!(y, "일지는 WAITING_ROOM_DAYLOG 폴더에만");
    std::fs::remove_dir_all(daylog_dir()).ok();

    // 그 밖의 메서드
    assert_eq!(req("POST", "/state", Some(&ok)).0, 501);
    assert_eq!(req("PUT", "/daylog/seen", Some(&ok)).0, 501);
}

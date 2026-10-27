//! wr-server — 브라우저용 127.0.0.1 HTTP 서버 (server.py와 같은 엔드포인트·규칙). 개발/웹 사용용이며 데스크톱 앱은 띄우지 않는다.
//!
//! - `GET /state`, `GET /trace?session=&prompt=&since=` (인자 120자 제한, 잘못된 세션 400)
//! - `GET /daylog?day=today|yesterday|YYYY-MM-DD`(퇴근 일보 하루 집계, 잘못된 날 400), `POST /daylog/seen`(본문 `{"day":…}`,
//!   JSON만·1KB 이하·Origin/Sec-Fetch-Site가 있으면 같은 출처만 — CSRF 방지). 일지는 1분마다 tick으로도 쌓인다
//! - `GET /modes`(내장 + 사용자 모드 목록), `/brand.json`, 정적 `web/` = `/`·`/index.html` + `STATIC` 정규식(server.py와 같은 규칙),
//!   `/_sdk/*`·`/_modes/<id>/…`(외부 모드 샌드박스: CSP·Permissions-Policy). HEAD는 모든 경로에서 GET과 같은 헤더(본문 없음),
//!   그 밖의 경로 404, 다른 메서드 501(POST는 /daylog/seen만). 규칙은 `wr_core::modes`(앱의 `wrmode:` 프로토콜과 공유)
//! - `Host`가 `localhost:<포트>`·`127.0.0.1:<포트>`가 아니거나 둘 이상이면 403 (DNS 리바인딩 방지). CORS 헤더 없음. 127.0.0.1에만 바인딩
//! - 환경변수(server.py 호환): `WAITING_ROOM_PORT`, `WAITING_ROOM_LOG`, `WAITING_ROOM_STATUS`, `WAITING_ROOM_PROJECTS`,
//!   `WAITING_ROOM_POLL_USAGE=1`(한도 조회, 기본 꺼짐), `WAITING_ROOM_MODES`(사용자 모드 폴더),
//!   `WAITING_ROOM_DAYLOG`(일지 폴더, 기본 `<Claude 루트>/waiting-room/daylog`, `off`면 끔),
//!   추가: `WAITING_ROOM_SOURCE=auto|hooks|transcript`, `WAITING_ROOM_ROOT`(저장소 루트: brand.json·web/)
//! - 인자: `--port N`, `--root DIR`(저장소 루트), `--keychain`(macOS: 시작할 때 한 번 키체인에서 토큰 읽기 — 사용자가 명시적으로 준 경우만)

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server};
use wr_core::modes::{self, mime_of, rules, sandbox_csp, PERMISSIONS_POLICY, SDK};
use wr_core::{Engine, TraceQuery};

struct App {
    engine: Mutex<Engine>,
    /// 저장소 루트 (brand.json)
    root: PathBuf,
    /// 프론트 정적 루트 (= root/web, Tauri frontendDist와 같은 폴더)
    web: PathBuf,
    user_modes: PathBuf,
    home: PathBuf,
    allowed: [String; 2],
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

/// server.py `send_body()`: Content-Type·Content-Length·Cache-Control·nosniff (+ 샌드박스 CSP)
fn send_body(req: Request, body: Vec<u8>, ctype: &str, head: bool, cache: &str, csp: Option<String>) {
    let len = body.len();
    let mut r = Response::from_data(if head { vec![] } else { body })
        .with_status_code(200)
        .with_header(header("Content-Type", ctype))
        .with_header(header("Cache-Control", cache))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    if let Some(c) = csp {
        r = r
            .with_header(header("Content-Security-Policy", &c))
            .with_header(header("Permissions-Policy", PERMISSIONS_POLICY))
            .with_header(header("Referrer-Policy", "no-referrer"));
    }
    if head {
        r = r.with_header(header("Content-Length", &len.to_string()));
    }
    let _ = req.respond(r);
}

fn send_file(req: Request, path: &Path, head: bool, csp: Option<String>) {
    match std::fs::read(path) {
        Ok(body) => send_body(req, body, mime_of(&path.to_string_lossy()), head, "no-cache", csp),
        Err(_) => error(req, 404, "File not found"),
    }
}

fn error(req: Request, code: u16, msg: &str) {
    let body = format!("<!DOCTYPE HTML>\n<html><head><title>Error</title></head><body><h1>Error {code}</h1><p>{msg}</p></body></html>\n");
    let r = Response::from_data(body.into_bytes())
        .with_status_code(code)
        .with_header(header("Content-Type", "text/html;charset=utf-8"));
    let _ = req.respond(r);
}

/// `parse_qs(query)`에서 첫 값 (빈 값은 없음 취급, + → 공백, %XX → UTF-8(잘못된 바이트는 U+FFFD))
fn query_arg(q: &str, key: &str) -> String {
    for pair in q.split('&') {
        let Some((k, v)) = pair.split_once('=') else { continue };
        if unquote(k) == key {
            let v = unquote(v);
            if !v.is_empty() {
                return v;
            }
        }
    }
    String::new()
}

fn unquote(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                let h = &b[i + 1..i + 3];
                match std::str::from_utf8(h)
                    .ok()
                    .filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit()))
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(x) => {
                        out.push(x);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// JSON 응답 (상태 코드 지정)
fn send_json(req: Request, code: u16, body: &serde_json::Value, head: bool) {
    let b = serde_json::to_vec(body).unwrap_or_default();
    let r = Response::from_data(if head { vec![] } else { b })
        .with_status_code(code)
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    let _ = req.respond(r);
}

fn header_values(req: &Request, name: &'static str) -> Vec<String> {
    req.headers()
        .iter()
        .filter(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().trim().to_ascii_lowercase())
        .collect()
}

/// POST /daylog/seen — 쓰기 엔드포인트는 이것 하나. 다른 사이트가 보내지 못하게 JSON 본문만 받고
/// (단순 요청이 아니라 preflight가 필요한데 OPTIONS·CORS 응답이 없음) Origin·Sec-Fetch-Site가 있으면 같은 출처인지 본다.
fn daylog_seen(app: &App, req: Request, host: &str, body: &[u8], too_big: bool) {
    let origin_ok = header_values(&req, "Origin").iter().all(|o| *o == format!("http://{host}"));
    let site_ok = header_values(&req, "Sec-Fetch-Site")
        .iter()
        .all(|s| s == "same-origin" || s == "none");
    if !origin_ok || !site_ok {
        return error(req, 403, "Forbidden origin");
    }
    let ctype = header_values(&req, "Content-Type").into_iter().next().unwrap_or_default();
    if ctype.split(';').next().unwrap_or("").trim() != "application/json" {
        return error(req, 415, "JSON only");
    }
    if too_big || body.len() > 1024 {
        return error(req, 413, "Body too large");
    }
    let v: serde_json::Value = serde_json::from_slice(if body.is_empty() { b"{}" } else { body }).unwrap_or_default();
    let r = match v.get("day").and_then(|d| d.as_str()) {
        Some(day) => app.engine.lock().unwrap_or_else(|e| e.into_inner()).daylog_seen(day),
        None => wr_core::DayReply {
            status: 400,
            body: serde_json::json!({"error": "bad-day"}),
        },
    };
    send_json(req, r.status, &r.body, false)
}

fn handle(app: &App, req: Request, body: &[u8], too_big: bool) {
    // Host 헤더가 둘 이상이면(둘 다 허용 값이어도) 거부: 프록시·파서마다 어느 쪽을 보는지 달라 검사를 우회할 수 있다
    let mut hosts = req.headers().iter().filter(|h| h.field.equiv("Host"));
    let host = hosts
        .next()
        .map(|h| h.value.as_str().trim().to_ascii_lowercase())
        .unwrap_or_default();
    if hosts.next().is_some() || !app.allowed.contains(&host) {
        return error(req, 403, "Forbidden host");
    }
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("").to_string();
    let head = match req.method() {
        Method::Get => false,
        Method::Head => true,
        Method::Post if path == "/daylog/seen" => return daylog_seen(app, req, &host, body, too_big),
        _ => return error(req, 501, "Unsupported method"),
    };
    let json_ct = "application/json; charset=utf-8";
    let r = rules();
    if path == "/state" {
        let st = app.engine.lock().unwrap_or_else(|e| e.into_inner()).state();
        return send_body(req, serde_json::to_vec(&st).unwrap_or_default(), json_ct, head, "no-store", None);
    }
    if path == "/trace" {
        let q = url.split_once('?').map(|x| x.1).unwrap_or("");
        let q = q.split('#').next().unwrap_or("");
        let tq = TraceQuery {
            session: query_arg(q, "session"),
            prompt: query_arg(q, "prompt"),
            since: query_arg(q, "since"),
        };
        let res = app.engine.lock().unwrap_or_else(|e| e.into_inner()).trace(&tq);
        let body = serde_json::to_vec(&res.body).unwrap_or_default();
        if res.status == 400 {
            let r = Response::from_data(if head { vec![] } else { body })
                .with_status_code(400)
                .with_header(header("Content-Type", json_ct))
                .with_header(header("Cache-Control", "no-store"));
            let _ = req.respond(r);
            return;
        }
        return send_body(req, body, json_ct, head, "no-store", None);
    }
    if path == "/daylog" {
        let q = url.split_once('?').map(|x| x.1).unwrap_or("");
        let q = q.split('#').next().unwrap_or("");
        let day = query_arg(q, "day");
        let r = app.engine.lock().unwrap_or_else(|e| e.into_inner()).daylog(&day);
        return send_json(req, r.status, &r.body, head);
    }
    if path == "/modes" {
        let v = modes::list_modes(&app.web, &app.user_modes, &app.home);
        return send_body(req, serde_json::to_vec(&v).unwrap_or_default(), json_ct, head, "no-store", None);
    }
    if path == "/" || path == "/index.html" {
        return send_file(req, &app.web.join("index.html"), head, None);
    }
    if path == "/brand.json" {
        return send_file(req, &app.root.join("brand.json"), head, None);
    }
    if r.static_re.is_match(&path) {
        // 코어와 내장 모드 패키지 (경로는 정규식으로 제한: 폴더 이름에 점이 없어 ".."이 들어갈 수 없음)
        return send_file(req, &app.web.join(path.trim_start_matches('/')), head, None);
    }
    let origin = format!("http://{host}");
    if let Some((_, f)) = SDK.iter().find(|(p, _)| *p == path) {
        return send_file(req, &app.web.join(f), head, Some(sandbox_csp(&origin, "_none")));
    }
    if let Some(c) = r.mode_file.captures(&path) {
        let (mid, rel) = (c[1].to_string(), c[2].to_string());
        let csp = sandbox_csp(&origin, &mid);
        if rel == "index.html" {
            return match modes::sandbox_page(&app.user_modes, &mid) {
                Some(body) => send_body(req, body, mime_of("x.html"), head, "no-cache", Some(csp)),
                None => error(req, 404, "File not found"),
            };
        }
        return match modes::mode_file(&app.user_modes, &mid, &rel) {
            Some(full) => send_file(req, &full, head, Some(csp)),
            None => error(req, 404, "File not found"),
        };
    }
    error(req, 404, "File not found")
}

fn default_root() -> PathBuf {
    if let Ok(p) = std::env::var("WAITING_ROOM_ROOT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    if repo.join("web").join("index.html").exists() {
        return repo.canonicalize().unwrap_or(repo);
    }
    std::env::current_dir().unwrap_or_default()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let port: u16 = arg("--port")
        .or_else(|| std::env::var("WAITING_ROOM_PORT").ok())
        .and_then(|p| p.parse().ok())
        .unwrap_or(7777);
    let root = arg("--root").map(PathBuf::from).unwrap_or_else(default_root);
    let engine = Engine::from_env();
    let poll_on = wr_core::ClaudeConfig::from_env(&wr_core::paths::OsEnv).poll_on;
    let env = wr_core::paths::OsEnv;
    let home = wr_core::paths::home_dir(&env);
    let claude = wr_core::ClaudeConfig::from_env(&env);
    let user_modes = std::env::var("WAITING_ROOM_MODES")
        .ok()
        .filter(|v| !v.is_empty())
        .map(|p| wr_core::paths::expand_tilde(&p, &home))
        .unwrap_or_else(|| claude.root.join("waiting-room").join("modes"));
    let app = Arc::new(App {
        engine: Mutex::new(engine),
        web: root.join("web"),
        root,
        user_modes,
        home,
        allowed: [format!("localhost:{port}"), format!("127.0.0.1:{port}")],
    });
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("포트 {port}를 열 수 없음: {e}");
            std::process::exit(1);
        }
    };
    println!(
        "☕ Waitscape: http://localhost:{port}  (정적 {}, 사용자 모드 폴더 {})",
        app.web.display(),
        app.user_modes.display()
    );
    if poll_on {
        start_poll(app.clone(), args.iter().any(|a| a == "--keychain"));
    }
    let daylog_on = app
        .engine
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .daylog_dir()
        .map(|d| d.display().to_string());
    if let Some(d) = daylog_on {
        println!("📋 퇴근 일보 일지: {d} (14일 보존, 끄기: WAITING_ROOM_DAYLOG=off)");
        // 화면을 열지 않아도 일지가 쌓이게 1분마다 상태를 만든다 (턴 완료·한도 표본·퇴근 판정용 활동 시각)
        let a = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            a.engine.lock().unwrap_or_else(|e| e.into_inner()).state();
        });
    }
    let mut workers = vec![];
    for _ in 0..4 {
        let s = server.clone();
        let a = app.clone();
        workers.push(std::thread::spawn(move || {
            while let Ok(mut req) = s.recv() {
                // 본문: POST /daylog/seen만 쓴다(1KB 넘으면 거부). 나머지는 연결 재사용을 위해 비운다(상한 64KB)
                let mut body = vec![];
                let mut sink = [0u8; 4096];
                let mut left = 64 * 1024;
                let rd = req.as_reader();
                while left > 0 {
                    match rd.read(&mut sink) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if body.len() <= 1024 {
                                body.extend_from_slice(&sink[..n.min(left)]);
                            }
                            left -= n.min(left);
                        }
                    }
                }
                let too_big = body.len() > 1024;
                handle(&a, req, &body, too_big)
            }
        }));
    }
    for w in workers {
        let _ = w.join();
    }
}

/// 사용 한도 직접 조회 (WAITING_ROOM_POLL_USAGE=1일 때만). 토큰은 `.credentials.json` → (`--keychain`을 줬으면) 시작 시 키체인 1회
fn start_poll(app: Arc<App>, keychain: bool) {
    use wr_core::providers::claude::usage::UsageClient;
    let creds = wr_core::ClaudeConfig::from_env(&wr_core::paths::OsEnv).credentials;
    let mut client = UsageClient::new(creds, env!("CARGO_PKG_VERSION"));
    println!("🔄 사용 한도 직접 조회: 120초마다 (api.anthropic.com, 헤더에 OAuth 토큰만)");
    if keychain {
        let now = wr_core::Clock::System.now();
        if let Err(e) = client.load_keychain(now) {
            eprintln!("키체인에서 토큰을 읽지 못함: {e}");
        }
    }
    std::thread::spawn(move || loop {
        let now = wr_core::Clock::System.now();
        if let Some(p) = client.poll(now) {
            app.engine.lock().unwrap_or_else(|e| e.into_inner()).set_polled("claude", p);
        }
        std::thread::sleep(std::time::Duration::from_secs(5));
    });
}

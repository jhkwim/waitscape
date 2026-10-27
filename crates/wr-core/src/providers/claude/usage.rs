//! Claude 사용 한도 조회 (usage_poll.py 이식 + ARCHITECTURE §3.7 정책).
//!
//! - 요청: `GET https://api.anthropic.com/api/oauth/usage` (외부 통신은 이 파일 한 곳뿐)
//!   헤더 `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: Waitscape/<버전>`. 본문 없음.
//! - 토큰: ① `<claude루트>/.credentials.json`의 `claudeAiOauth.accessToken`(만료됐으면 안 씀)
//!   ② macOS 키체인 "Claude Code-credentials"는 **`load_keychain()`을 명시적으로 부를 때만**(자동 폴링에서 금지).
//! - 토큰은 메모리(`Secret`)에만. 오류 문자열에는 코드만(`HTTP 401`, `network`, `no-token` …).
//! - 실패하면 limits만 None. refresh 하지 않음.

use crate::limits::{parse_retry_after, Backoff, Secret};
use crate::provider::Polled;
use crate::py::{get, num};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const URL: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA: &str = "oauth-2025-04-20";

/// 응답 키 → state 키
const KEYS: [(&str, &str); 3] = [
    ("five_hour", "five_hour"),
    ("seven_day", "seven_day"),
    ("extra_usage", "spend_limit"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSource {
    None,
    File,
    Keychain,
}

pub struct UsageClient {
    pub url: String,
    pub user_agent: String,
    pub credentials: PathBuf,
    pub backoff: Backoff,
    pub timeout: Duration,
    token: Option<(Secret, Option<f64>)>,
    pub source: TokenSource,
}

impl std::fmt::Debug for UsageClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UsageClient")
            .field("url", &self.url)
            .field("source", &self.source)
            .field("token", &self.token.as_ref().map(|_| "***"))
            .finish()
    }
}

/// `resets_at`: ISO 문자열 또는 epoch(초/밀리초) → epoch 초
fn epoch(v: Option<&Value>) -> Value {
    match v {
        None | Some(Value::Null) => Value::Null,
        Some(Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            json!(if f > 1e12 { f / 1000.0 } else { f })
        }
        Some(Value::String(s)) => crate::clock::iso(s, crate::clock::Tz::Fixed(0))
            .map(Value::from)
            .unwrap_or(Value::Null),
        Some(_) => Value::Null,
    }
}

/// 응답 JSON → state.d.ts `Limits`. 알 수 없는 형식이면 None
pub fn convert(d: &Value) -> Option<Value> {
    let mut out = Map::new();
    for (src, dst) in KEYS {
        let Some(v) = get(d, src).filter(|v| v.is_object()) else { continue };
        let Some(pct) = num(get(v, "utilization")).or_else(|| num(get(v, "used_percentage"))) else {
            continue;
        };
        out.insert(dst.into(), json!({"used_percentage": pct, "resets_at": epoch(get(v, "resets_at"))}));
    }
    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

/// `.credentials.json` → (토큰, 만료 epoch초). 만료됐으면 None
pub fn read_credentials_file(p: &Path, now: f64) -> Option<(Secret, Option<f64>)> {
    let raw = std::fs::read(p).ok()?;
    parse_credentials(&raw, now)
}

fn parse_credentials(raw: &[u8], now: f64) -> Option<(Secret, Option<f64>)> {
    let d: Value = serde_json::from_slice(raw).ok()?;
    let o = get(&d, "claudeAiOauth")?;
    let tok = get(o, "accessToken")?.as_str()?.to_string();
    let exp = num(get(o, "expiresAt")).map(|e| if e > 1e12 { e / 1000.0 } else { e });
    if exp.is_some_and(|e| e <= now) || tok.is_empty() {
        return None;
    }
    Some((Secret::new(tok), exp))
}

impl UsageClient {
    pub fn new(credentials: PathBuf, version: &str) -> UsageClient {
        UsageClient {
            url: URL.into(),
            user_agent: format!("Waitscape/{version}"),
            credentials,
            backoff: Backoff::default(),
            timeout: Duration::from_secs(10),
            token: None,
            source: TokenSource::None,
        }
    }

    /// 사용자가 [키체인에서 읽기]를 눌렀을 때만 호출 (macOS). 암호 창이 뜰 수 있다.
    /// `security` 명령을 인자 배열로 실행(셸 없음). 토큰은 메모리에만.
    pub fn load_keychain(&mut self, now: f64) -> Result<(), &'static str> {
        if !cfg!(target_os = "macos") {
            return Err("unsupported");
        }
        let out = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
            .map_err(|_| "keychain")?;
        if !out.status.success() {
            return Err("keychain");
        }
        let t = parse_credentials(out.stdout.trim_ascii(), now).ok_or("keychain-format")?;
        self.token = Some(t);
        self.source = TokenSource::Keychain;
        self.backoff.resume();
        Ok(())
    }

    /// 테스트·앱 주입용
    pub fn set_token(&mut self, token: String, expires: Option<f64>) {
        self.token = Some((Secret::new(token), expires));
        self.source = TokenSource::File;
        self.backoff.resume();
    }

    /// 파일 토큰을 다시 읽는다(자동 경로). 키체인은 건드리지 않는다.
    fn ensure_token(&mut self, now: f64) -> bool {
        if let Some((_, exp)) = &self.token {
            if exp.is_none_or(|e| e > now) {
                return true;
            }
            self.token = None;
        }
        if let Some(t) = read_credentials_file(&self.credentials, now) {
            self.token = Some(t);
            self.source = TokenSource::File;
            return true;
        }
        self.source = TokenSource::None;
        false
    }

    /// 주기가 됐으면 한 번 조회. 아직이면 None (호출자는 2초 tick 등에서 자유롭게 부른다)
    pub fn poll(&mut self, now: f64) -> Option<Polled> {
        if !self.backoff.due(now) {
            return None;
        }
        Some(self.fetch(now))
    }

    /// 한 번 조회 (백오프 갱신 포함)
    pub fn fetch(&mut self, now: f64) -> Polled {
        if !self.ensure_token(now) {
            self.backoff.failed(now);
            return Polled {
                limits: None,
                ts: 0.0,
                err: Some("no-token".into()),
            };
        }
        let auth = format!("Bearer {}", self.token.as_ref().unwrap().0.expose());
        let agent = ureq::AgentBuilder::new().timeout(self.timeout).build();
        let res = agent
            .get(&self.url)
            .set("Authorization", &auth)
            .set("anthropic-beta", BETA)
            .set("User-Agent", &self.user_agent)
            .call();
        drop(zeroize::Zeroizing::new(auth));
        match res {
            Ok(r) => {
                let body: Option<Value> = r.into_string().ok().and_then(|s| serde_json::from_str(&s).ok());
                match body.as_ref().and_then(convert) {
                    Some(l) => {
                        self.backoff.ok(now);
                        Polled {
                            limits: Some(l),
                            ts: now,
                            err: None,
                        }
                    }
                    None => {
                        self.backoff.failed(now);
                        Polled {
                            limits: None,
                            ts: 0.0,
                            err: Some("format".into()),
                        }
                    }
                }
            }
            Err(ureq::Error::Status(code, r)) => {
                match code {
                    429 => self.backoff.too_many(now, parse_retry_after(r.header("Retry-After"))),
                    401 | 403 => {
                        self.token = None;
                        self.backoff.halt();
                    }
                    _ => self.backoff.failed(now),
                }
                Polled {
                    limits: None,
                    ts: 0.0,
                    err: Some(format!("HTTP {code}")),
                }
            }
            Err(_) => {
                self.backoff.failed(now);
                Polled {
                    limits: None,
                    ts: 0.0,
                    err: Some("network".into()),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// 정해진 응답을 순서대로 돌려주는 목 서버. 받은 요청 원문을 기록한다.
    fn mock(responses: Vec<String>) -> (String, Arc<Mutex<Vec<String>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(vec![]));
        let s2 = seen.clone();
        std::thread::spawn(move || {
            for resp in responses {
                let Ok((mut c, _)) = l.accept() else { return };
                let mut buf = [0u8; 4096];
                let n = c.read(&mut buf).unwrap_or(0);
                s2.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_string());
                let _ = c.write_all(resp.as_bytes());
            }
        });
        (format!("http://{addr}/api/oauth/usage"), seen)
    }

    fn resp(code: &str, extra: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        )
    }

    fn client(url: String) -> UsageClient {
        let mut c = UsageClient::new(PathBuf::from("/nonexistent/.credentials.json"), "0.0.0-test");
        c.url = url;
        c
    }

    fn fake_token() -> String {
        ["tok", "-", "FAKE", "-", "0123456789"].concat()
    }

    #[test]
    fn ok_429_401_and_network() {
        let body = r#"{"five_hour":{"utilization":63.5,"resets_at":"2026-10-20T21:00:00Z"},"seven_day":{"utilization":27,"resets_at":null},"extra_usage":{"utilization":1}}"#;
        let (url, seen) = mock(vec![
            resp("200 OK", "", body),
            resp("429 Too Many Requests", "Retry-After: 42\r\n", "{}"),
            resp("429 Too Many Requests", "", "{}"),
            resp("401 Unauthorized", "", "{}"),
        ]);
        let mut c = client(url);
        let tok = fake_token();
        c.set_token(tok.clone(), None);
        let p = c.fetch(1000.0);
        assert_eq!(p.err, None);
        let l = p.limits.unwrap();
        assert_eq!(l["five_hour"]["used_percentage"], json!(63.5));
        assert_eq!(l["five_hour"]["resets_at"], json!(1792530000.0));
        assert!(l.get("spend_limit").is_some());
        assert_eq!(c.backoff.next_at, 1120.0);

        let p = c.fetch(2000.0);
        assert_eq!(p.err.as_deref(), Some("HTTP 429"));
        assert_eq!(c.backoff.next_at, 2042.0);
        let p = c.fetch(3000.0);
        assert_eq!(p.err.as_deref(), Some("HTTP 429"));
        assert_eq!(c.backoff.next_at, 3240.0, "Retry-After 없으면 2^n분");
        assert!(c.poll(3100.0).is_none(), "백오프 중에는 조회 안 함");

        let p = c.fetch(4000.0);
        assert_eq!(p.err.as_deref(), Some("HTTP 401"));
        assert!(c.backoff.halted);
        assert!(c.poll(1e12).is_none(), "401 뒤에는 다시 읽기 전까지 중단");

        let reqs = seen.lock().unwrap().clone();
        assert!(reqs[0].contains("anthropic-beta: oauth-2025-04-20"));
        assert!(reqs[0].starts_with("GET /api/oauth/usage"));
        // 토큰은 요청 헤더에만 있고 어떤 출력에도 없다
        assert!(reqs[0].contains(&tok));
        assert!(!format!("{c:?}").contains(&tok));
        assert!(!format!("{p:?}").contains(&tok));

        // 네트워크 오류 (닫힌 포트)
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = format!("http://{}/x", l.local_addr().unwrap());
        drop(l);
        let mut c = client(dead);
        c.set_token(fake_token(), None);
        let p = c.fetch(10.0);
        assert_eq!((p.limits, p.err.as_deref()), (None, Some("network")));
    }

    #[test]
    fn credentials_file_and_expiry() {
        let tok = fake_token();
        let raw = format!(r#"{{"claudeAiOauth":{{"accessToken":"{tok}","expiresAt":1792519200000}}}}"#);
        assert!(parse_credentials(raw.as_bytes(), 1792519000.0).is_some());
        assert!(parse_credentials(raw.as_bytes(), 1792519300.0).is_none(), "만료 토큰은 쓰지 않음");
        let mut c = client("http://127.0.0.1:9/".into());
        let p = c.fetch(0.0);
        assert_eq!(p.err.as_deref(), Some("no-token"));
        assert_eq!(c.source, TokenSource::None);
    }
}

//! `wrmode:` 커스텀 프로토콜 — 외부(사용자) 모드를 샌드박스 iframe에 서빙한다 (ARCHITECTURE §4.5).
//! origin: mac/linux `wrmode://localhost`, Windows `http://wrmode.localhost`. 경로 규칙은 wr-server와 같다(`wr_core::modes`):
//!   `/_sdk/{mode-sdk.js,core-lib.js,sandbox.css}`  — 앱에 내장된 web/ 자산
//!   `/_modes/<id>/index.html`                     — 호스트가 만든 iframe 문서(인라인 스크립트 없음)
//!   `/_modes/<id>/<rel>`                          — 사용자 모드 폴더 안의 파일만(정규화, `..`·링크·html 거부, 확장자 화이트리스트)
//! 모든 응답에 CSP(`connect-src 'none'` 등)·Permissions-Policy·nosniff. GET만.

use std::path::PathBuf;
use tauri::http::{header, Response, StatusCode};
use wr_core::modes::{self, mime_of, rules, sandbox_csp, PERMISSIONS_POLICY, SDK};

pub const ORIGIN: &str = if cfg!(windows) {
    "http://wrmode.localhost"
} else {
    "wrmode://localhost"
};

pub struct Served {
    pub status: StatusCode,
    pub body: Vec<u8>,
    pub ctype: &'static str,
    pub csp: Option<String>,
}

fn not_found() -> Served {
    Served {
        status: StatusCode::NOT_FOUND,
        body: b"not found".to_vec(),
        ctype: "text/plain; charset=utf-8",
        csp: Some("default-src 'none'; sandbox".into()),
    }
}

/// 경로 → 응답 (테스트 가능하게 Tauri와 분리). `asset`: 앱 내장 web/ 자산 읽기
pub fn serve(method: &str, path: &str, user_modes: &std::path::Path, asset: &dyn Fn(&str) -> Option<Vec<u8>>) -> Served {
    if method != "GET" && method != "HEAD" {
        return Served {
            status: StatusCode::METHOD_NOT_ALLOWED,
            ..not_found()
        };
    }
    if let Some((_, file)) = SDK.iter().find(|(p, _)| *p == path) {
        return match asset(file) {
            Some(body) => Served {
                status: StatusCode::OK,
                ctype: mime_of(file),
                body,
                csp: Some(sandbox_csp(ORIGIN, "_none_")),
            },
            None => not_found(),
        };
    }
    let Some(c) = rules().mode_file.captures(path) else {
        return not_found();
    };
    let (mid, rel) = (c[1].to_string(), c[2].to_string());
    let csp = Some(sandbox_csp(ORIGIN, &mid));
    if rel == "index.html" {
        return match modes::sandbox_page(user_modes, &mid) {
            Some(body) => Served {
                status: StatusCode::OK,
                body,
                ctype: "text/html; charset=utf-8",
                csp,
            },
            None => not_found(),
        };
    }
    match modes::mode_file(user_modes, &mid, &rel).and_then(|p: PathBuf| std::fs::read(&p).ok().map(|b| (p, b))) {
        Some((p, body)) => Served {
            status: StatusCode::OK,
            body,
            ctype: mime_of(&p.to_string_lossy()),
            csp,
        },
        None => not_found(),
    }
}

pub fn to_response(s: Served, head: bool) -> Response<Vec<u8>> {
    let font = s.ctype.starts_with("font/");
    let mut r = Response::builder()
        .status(s.status)
        .header(header::CONTENT_TYPE, s.ctype)
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Permissions-Policy", PERMISSIONS_POLICY);
    if let Some(c) = s.csp {
        r = r.header(header::CONTENT_SECURITY_POLICY, c);
    }
    if font {
        // 폰트 요청은 CORS 모드라 opaque origin(샌드박스) iframe에서 읽으려면 필요. 폰트 파일에만 준다
        r = r.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    }
    r.body(if head { vec![] } else { s.body }).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_and_csp() {
        let d = std::env::temp_dir().join(format!("ws-proto-{}", std::process::id()));
        let m = d.join("demo");
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("mode.json"), r#"{"id":"demo","entry":"mode.js","styles":["mode.css"]}"#).unwrap();
        std::fs::write(m.join("mode.js"), "1").unwrap();
        std::fs::write(d.join("secret.js"), "s").unwrap();
        let asset = |p: &str| if p == "sdk/mode-sdk.js" { Some(b"sdk".to_vec()) } else { None };
        let ok = serve("GET", "/_modes/demo/mode.js", &d, &asset);
        assert_eq!(ok.status, StatusCode::OK);
        assert!(ok.csp.as_ref().unwrap().contains("connect-src 'none'"));
        assert!(ok.csp.as_ref().unwrap().contains(&format!("{ORIGIN}/_modes/demo/")));
        let page = serve("GET", "/_modes/demo/index.html", &d, &asset);
        assert_eq!(page.ctype, "text/html; charset=utf-8");
        assert!(String::from_utf8(page.body).unwrap().contains("/_sdk/mode-sdk.js"));
        assert_eq!(serve("GET", "/_sdk/mode-sdk.js", &d, &asset).body, b"sdk");
        for bad in [
            "/_modes/demo/../secret.js",
            "/_modes/../secret.js",
            "/secret.js",
            "/_modes/demo/mode.json/x",
            "/_sdk/other.js",
        ] {
            assert_eq!(serve("GET", bad, &d, &asset).status, StatusCode::NOT_FOUND, "{bad}");
        }
        assert_eq!(
            serve("POST", "/_modes/demo/mode.js", &d, &asset).status,
            StatusCode::METHOD_NOT_ALLOWED
        );
        std::fs::remove_dir_all(d).ok();
    }
}

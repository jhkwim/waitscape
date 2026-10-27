//! 모드 패키지 발견·서빙 규칙 (server.py `list_modes()`, `mode_file()`, `sandbox_csp()`, `sandbox_page()`, `MIME` 이식).
//! wr-server(브라우저 `/modes`·`/_modes/…`)와 데스크톱 앱(`wrmode:` 프로토콜, P3)이 같이 쓴다. 프로바이더와 무관한 공통 모듈.

use crate::py::get;
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 확장자 → Content-Type
pub fn mime(ext: &str) -> Option<&'static str> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "md" => "text/plain; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        _ => return None,
    })
}

/// 경로의 Content-Type (모르는 확장자는 octet-stream)
pub fn mime_of(path: &str) -> &'static str {
    mime(path.rsplit('.').next().unwrap_or("")).unwrap_or("application/octet-stream")
}

pub struct Rules {
    /// 코어·내장 모드 패키지 정적 파일
    pub static_re: Regex,
    pub mode_id: Regex,
    /// `/_modes/<id>/<rel>`
    pub mode_file: Regex,
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| Rules {
        static_re: Regex::new(r"^/(core/[a-z0-9-]+\.(js|css)|fonts/[A-Za-z0-9-]+\.woff2|modes/index\.json|modes/[a-z0-9-]+/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(js|css|json|svg|png|md))$").unwrap(),
        mode_id: Regex::new(r"^[a-z0-9][a-z0-9-]{0,31}$").unwrap(),
        mode_file: Regex::new(r"^/_modes/([a-z0-9][a-z0-9-]{0,31})/((?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/){0,4}[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$").unwrap(),
    })
}

/// 샌드박스 SDK 경로 → web/ 안의 파일
pub const SDK: [(&str, &str); 3] = [
    ("/_sdk/mode-sdk.js", "sdk/mode-sdk.js"),
    ("/_sdk/core-lib.js", "core/core-lib.js"),
    ("/_sdk/sandbox.css", "sdk/sandbox.css"),
];

/// `_read_manifest(path)`: 읽기만(검증은 프론트 한 곳에서). 64KB 제한, 링크 거부
pub fn read_manifest(path: &Path) -> (Option<Value>, Option<String>) {
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (None, Some("mode.json이 없어요".into())),
        Err(_) => return (None, Some("mode.json을 읽을 수 없어요 (OSError)".into())),
        Ok(m) if m.file_type().is_symlink() || m.len() > 65536 => return (None, Some("mode.json이 너무 크거나 링크예요".into())),
        Ok(_) => {}
    }
    let raw = match std::fs::read(path) {
        Ok(r) => r,
        Err(_) => return (None, Some("mode.json을 읽을 수 없어요 (OSError)".into())),
    };
    let Ok(text) = std::str::from_utf8(&raw) else {
        return (None, Some("mode.json을 읽을 수 없어요 (UnicodeDecodeError)".into()));
    };
    match serde_json::from_str::<Value>(text) {
        Ok(v) => (Some(v), None),
        Err(_) => (None, Some("mode.json을 읽을 수 없어요 (JSONDecodeError)".into())),
    }
}

/// 내장(web/modes/index.json 순서) + 사용자 모드 폴더. 절대 경로는 응답에 넣지 않는다(홈은 ~로 축약).
pub fn list_modes(web: &Path, user_modes: &Path, home: &Path) -> Value {
    let r = rules();
    let mut out = vec![];
    let builtin: Vec<Value> = std::fs::read(web.join("modes").join("index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| get(&v, "builtin").and_then(|b| b.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|d| r.mode_id.is_match(&crate::py::py_str(d)))
        .collect();
    for d in builtin {
        let (m, err) = read_manifest(&web.join("modes").join(crate::py::py_str(&d)).join("mode.json"));
        let mut o = json!({"dir": d, "source": "builtin", "manifest": m});
        if let Some(e) = err {
            o["error"] = json!(e);
        }
        out.push(o);
    }
    let mut names: Vec<String> = std::fs::read_dir(user_modes)
        .map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    names.sort();
    names.truncate(100);
    for d in names {
        let full = user_modes.join(&d);
        if d.starts_with('.') || !full.is_dir() {
            continue;
        }
        let link = std::fs::symlink_metadata(&full)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if !r.mode_id.is_match(&d) || link {
            out.push(json!({"dir": crate::py::take(&d, 40), "source": "user", "manifest": null,
                            "error": "폴더 이름은 모드 id 형식이어야 하고 링크가 아니어야 해요"}));
            continue;
        }
        let (m, err) = read_manifest(&full.join("mode.json"));
        let mut o = json!({"dir": d, "source": "user", "manifest": m});
        if let Some(e) = err {
            o["error"] = json!(e);
        }
        out.push(o);
    }
    let um = user_modes.to_string_lossy().to_string();
    let h = home.to_string_lossy().to_string();
    let sep = std::path::MAIN_SEPARATOR;
    let shown = if !h.is_empty() && um.starts_with(&format!("{h}{sep}")) {
        format!("~{}", &um[h.len()..])
    } else {
        um
    };
    json!({"modes": out, "userDir": shown, "devDirs": []})
}

/// 확장자 화이트리스트 (html 제외)
pub fn mode_ext_ok(ext: &str) -> bool {
    let e = ext.to_ascii_lowercase();
    e != "html" && mime(&e).is_some()
}

/// `mode_file(mid, rel)`: 사용자 모드 폴더 안의 파일만. 정규화 후 폴더 밖·심볼릭 링크·허용 안 된 확장자 거부
pub fn mode_file(user_modes: &Path, mid: &str, rel: &str) -> Option<PathBuf> {
    let base = std::fs::canonicalize(user_modes.join(mid)).ok()?;
    let full = std::fs::canonicalize(base.join(rel)).ok()?;
    if !full.starts_with(&base) || full == base || !mode_ext_ok(rel.rsplit('.').next().unwrap_or("")) {
        return None;
    }
    let mut p = user_modes.join(mid);
    for part in rel.split('/') {
        p = p.join(part);
        if std::fs::symlink_metadata(&p).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
            return None;
        }
    }
    if full.is_file() {
        Some(full)
    } else {
        None
    }
}

/// 외부 모드 iframe 응답 CSP (ARCHITECTURE.md §4.5)
pub fn sandbox_csp(origin: &str, mid: &str) -> String {
    let me = format!("{origin}/_modes/{mid}/");
    let sdk = format!("{origin}/_sdk/");
    format!(
        "default-src 'none'; script-src {me} {sdk}; style-src {me} {sdk} 'unsafe-inline'; img-src {me} data: blob:; \
         font-src {me} data:; media-src {me} data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; \
         worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts"
    )
}

pub const PERMISSIONS_POLICY: &str =
    "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()";

/// 패키지 안 상대 경로 검사 (`^(?!/)(?!.*(^|/)\.\.?(/|$))[A-Za-z0-9._/-]{1,128}$`)
/// 모드 패키지 안의 상대 경로 규칙 (entry·styles·아이콘). 설치 검사와 서빙이 같이 쓴다
pub fn rel_ok(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 128
        && !p.starts_with('/')
        && p.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'/' | b'-'))
        && !p.split('/').any(|seg| seg == "." || seg == "..")
}

fn esc(x: &str) -> String {
    x.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;")
}

/// 외부 모드를 싣는 iframe 문서. 인라인 스크립트 없음(CSP). SDK가 모드 코드보다 먼저 실행된다.
pub fn sandbox_page(user_modes: &Path, mid: &str) -> Option<Vec<u8>> {
    let (m, _) = read_manifest(&user_modes.join(mid).join("mode.json"));
    let m = m.filter(|m| m.is_object() && crate::py::truthy(m))?;
    let entry = get(&m, "entry")
        .filter(|v| crate::py::truthy(v))
        .cloned()
        .unwrap_or(json!("mode.js"));
    let entry = entry.as_str()?.to_string();
    if !rel_ok(&entry) || !entry.ends_with(".js") {
        return None;
    }
    let styles: Vec<String> = get(&m, "styles")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .filter(|x| rel_ok(x) && x.ends_with(".css"))
                .take(8)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let mut s = String::from("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><link rel=\"stylesheet\" href=\"/_sdk/sandbox.css\">");
    for x in &styles {
        s.push_str(&format!("<link rel=\"stylesheet\" href=\"{}\">", esc(x)));
    }
    s.push_str("<script src=\"/_sdk/core-lib.js\"></script><script src=\"/_sdk/mode-sdk.js\"></script>");
    s.push_str(&format!("<script src=\"{}\"></script></head><body></body></html>", esc(&entry)));
    Some(s.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_rules() {
        let r = rules();
        for ok in [
            "/core/core.js",
            "/core/core.css",
            "/modes/index.json",
            "/modes/flow/mode.js",
            "/modes/hamster/assets.v2.png",
        ] {
            assert!(r.static_re.is_match(ok), "{ok}");
        }
        for bad in [
            "/server.py",
            "/modes/../server.py",
            "/core/../x.js",
            "/modes/flow/../../x.js",
            "/fixtures/fake_secrets.json",
            "/core.js",
        ] {
            assert!(!r.static_re.is_match(bad), "{bad}");
        }
        assert!(r.mode_file.is_match("/_modes/my-mode/assets/a.png"));
        assert!(!r.mode_file.is_match("/_modes/my-mode/../x.js"));
        assert!(rel_ok("a/b.css") && !rel_ok("../a.css") && !rel_ok("/a.js") && !rel_ok("a/./b.js"));
    }

    #[test]
    fn mode_file_rejects_escape_and_links() {
        let d = std::env::temp_dir().join(format!("wr-modes-{}", std::process::id()));
        let m = d.join("demo");
        std::fs::create_dir_all(m.join("assets")).unwrap();
        std::fs::write(m.join("mode.js"), "x").unwrap();
        std::fs::write(m.join("page.html"), "x").unwrap();
        std::fs::write(d.join("secret.js"), "x").unwrap();
        assert!(mode_file(&d, "demo", "mode.js").is_some());
        assert!(mode_file(&d, "demo", "page.html").is_none(), "html은 화이트리스트 밖");
        assert!(mode_file(&d, "demo", "../secret.js").is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.join("secret.js"), m.join("assets/l.js")).unwrap();
            assert!(mode_file(&d, "demo", "assets/l.js").is_none(), "링크 거부");
        }
        std::fs::write(m.join("mode.json"), r#"{"entry":"mode.js","styles":["mode.css","../x.css"]}"#).unwrap();
        let page = String::from_utf8(sandbox_page(&d, "demo").unwrap()).unwrap();
        assert!(page.contains("href=\"mode.css\"") && !page.contains("../x.css"));
        std::fs::remove_dir_all(&d).ok();
    }
}

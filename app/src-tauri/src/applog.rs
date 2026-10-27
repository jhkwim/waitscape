//! 앱 파일 로그 (진단용). GUI 앱(특히 Windows)은 stderr가 아무 데도 남지 않으므로 같은 줄을 앱 로그 폴더에도 쓴다.
//! - 위치: `app_log_dir()` = 맥 `~/Library/Logs/<identifier>/`, 윈도우 `%LOCALAPPDATA%\<identifier>\logs\` 의 `waitscape.log`
//! - 줄: `2026-10-27T09:12:03 [태그] 메시지` (로컬 시각, 시간대는 시작 줄에). 1MB가 넘으면 `waitscape.old.log`로 한 번 돌리고 새로 시작
//! - 개인정보: 메시지는 시크릿 마스킹(`wr_core::redact`) → 홈 경로 `~` → 한 줄·2000자로. 토큰·프롬프트 내용은 애초에 넘기지 않는다
//! - `wlog!("태그", "형식", 인자…)` = stderr(`[waitscape] [태그] …`) + 파일. `init` 전에는 stderr만

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const FILE: &str = "waitscape.log";
pub const OLD: &str = "waitscape.old.log";
pub const MAX: u64 = 1024 * 1024;

struct Sink {
    dir: PathBuf,
    home: String,
}

static SINK: OnceLock<Sink> = OnceLock::new();
/// 여러 스레드가 한 줄을 섞어 쓰거나 동시에 돌리지 않게
static LOCK: Mutex<()> = Mutex::new(());

#[macro_export]
macro_rules! wlog {
    ($tag:expr, $($arg:tt)+) => {
        $crate::applog::write($tag, &format!($($arg)+))
    };
}

/// setup 맨 앞에서 한 번. 폴더를 못 만들어도 앱은 그대로(쓰기 실패는 조용히 넘어감)
pub fn init(dir: PathBuf, home: &Path) {
    std::fs::create_dir_all(&dir).ok();
    SINK.set(Sink {
        dir,
        home: home.to_string_lossy().into_owned(),
    })
    .ok();
}

/// 로그 폴더 (설정 → 앱 정보 → [로그 폴더 열기])
pub fn dir() -> Option<PathBuf> {
    SINK.get().map(|s| s.dir.clone())
}

pub fn write(tag: &str, msg: &str) {
    let msg = clean(msg, SINK.get().map_or("", |s| s.home.as_str()));
    eprintln!("[waitscape] [{tag}] {msg}");
    let Some(s) = SINK.get() else { return };
    let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    append(&s.dir, &line(&ts, tag, &msg), MAX).ok();
}

/// 시크릿 마스킹 → 홈 `~` → 줄바꿈·제어 문자는 공백, 2000자까지
pub fn clean(msg: &str, home: &str) -> String {
    let s = crate::commands::tilde(&wr_core::redact::redact(msg), home);
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).take(2000).collect()
}

pub fn line(ts: &str, tag: &str, msg: &str) -> String {
    format!("{ts} [{tag}] {msg}\n")
}

/// 한 줄 덧붙이기. 붙이면 `max`를 넘으면 먼저 `waitscape.old.log`로 돌린다(옛 것은 버림).
/// 매번 열고 닫는다: 열어 둔 파일은 Windows에서 이름을 바꿀 수 없고, 로그는 드물게 쓴다
pub fn append(dir: &Path, line: &str, max: u64) -> std::io::Result<()> {
    let p = dir.join(FILE);
    let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if len > 0 && len + line.len() as u64 > max {
        std::fs::remove_file(dir.join(OLD)).ok();
        // 다른 프로그램이 파일을 잡고 있어(Windows) 못 돌리면 그대로 이어 쓴다. 너무 커지면(4배) 그때만 버린다
        if std::fs::rename(&p, dir.join(OLD)).is_err() && len > max.saturating_mul(4) {
            return Ok(());
        }
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&p)?
        .write_all(line.as_bytes())
}

/// 시작 줄: 앱 버전·OS·아키텍처·WebView 버전·시간대 (Windows는 WebView2 런타임 버전)
pub fn hello(version: &str) {
    let wv = tauri::webview_version().unwrap_or_else(|e| format!("알 수 없음({e})"));
    write(
        "app",
        &format!(
            "시작 v{version} · {} {} · WebView {wv} · 시간대 UTC{} · {}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            chrono::Local::now().format("%:z"),
            if cfg!(debug_assertions) {
                "디버그 빌드"
            } else {
                "릴리스 빌드"
            }
        ),
    );
}

/// 지금 스레드 이름 (교착 진단: 메인 스레드에서 창을 만들었는지)
pub fn thread() -> String {
    std::thread::current().name().unwrap_or("?").to_string()
}

/// 멈춤 감시: `limit` 안에 이 값이 사라지지(= 단계가 끝나지) 않으면 "멈춤 의심" 한 줄. 늦게라도 끝나면 걸린 시간을 한 줄 더.
/// 감시 스레드는 `limit`만큼 자고 끝난다
pub struct Watch {
    done: Arc<AtomicBool>,
    t0: Instant,
    tag: &'static str,
    what: &'static str,
    limit: Duration,
}

pub fn watch(tag: &'static str, what: &'static str, limit: Duration) -> Watch {
    let done = Arc::new(AtomicBool::new(false));
    let d = done.clone();
    std::thread::spawn(move || {
        std::thread::sleep(limit);
        if !d.load(Ordering::Acquire) {
            write(tag, &format!("{what}: {}초가 지나도 안 끝남 — 멈춤 의심(교착?)", limit.as_secs()));
        }
    });
    Watch {
        done,
        t0: Instant::now(),
        tag,
        what,
        limit,
    }
}

impl Watch {
    pub fn ms(&self) -> u128 {
        self.t0.elapsed().as_millis()
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Release);
        let el = self.t0.elapsed();
        if el >= self.limit {
            write(self.tag, &format!("{}: 늦게 끝남 ({:.1}초)", self.what, el.as_secs_f64()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ws-applog-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn line_format() {
        assert_eq!(
            line("2026-10-27T09:12:03", "widget", "build 성공"),
            "2026-10-27T09:12:03 [widget] build 성공\n"
        );
        // chrono 형식이 정확히 `YYYY-MM-DDTHH:MM:SS`인지
        let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        assert_eq!(ts.len(), 19);
        assert_eq!(&ts[10..11], "T");
    }

    #[test]
    fn clean_masks_home_secrets_and_newlines() {
        let h = "/Users/<u>";
        assert_eq!(clean("감시 실패 /Users/<u>/.claude/x: 없음", h), "감시 실패 ~/.claude/x: 없음");
        assert_eq!(clean("C:\\Users\\<u>\\AppData\\x", "C:\\Users\\<u>"), "~\\AppData\\x");
        assert_eq!(clean("줄1\n줄2\r\t끝", h), "줄1 줄2  끝");
        let fake = ["sk-ant-", "api03-", &"A".repeat(40)].concat();
        let out = clean(&format!("오류 {fake}"), h);
        assert!(!out.contains(&fake), "{out}");
        assert_eq!(clean(&"가".repeat(3000), h).chars().count(), 2000);
    }

    #[test]
    fn rotates_once_over_max() {
        let d = tmp("rot");
        let l = "x".repeat(40) + "\n";
        for _ in 0..2 {
            append(&d, &l, 100).unwrap();
        }
        assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap().len(), 82);
        assert!(!d.join(OLD).exists());
        // 세 번째 줄을 붙이면 100바이트를 넘음 → 지금 파일이 old로, 새 파일은 그 줄만
        append(&d, &l, 100).unwrap();
        assert_eq!(std::fs::read_to_string(d.join(OLD)).unwrap().len(), 82);
        assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap(), l);
        // 다시 넘치면 옛 old는 버리고 한 번 더 돌린다(파일은 늘 둘까지)
        append(&d, &l, 100).unwrap();
        append(&d, &l, 100).unwrap();
        assert_eq!(std::fs::read_to_string(d.join(OLD)).unwrap().len(), 82);
        assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap(), l);
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 2);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn single_huge_line_does_not_rotate_empty_file() {
        let d = tmp("big");
        append(&d, &"y".repeat(500), 100).unwrap();
        assert!(!d.join(OLD).exists());
        std::fs::remove_dir_all(&d).ok();
    }
}

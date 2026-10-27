//! 앱 안 업데이트 (docs/RELEASE.md, ARCHITECTURE §6.4).
//! - 확인: 시작 15초 뒤 + 하루 1번. 1시간마다 깨어나 마지막 확인이 24시간 넘었는지 본다(잠자기 동안 멈추는 시계 때문에 24시간 sleep은 쓰지 않음).
//!   설정 `updateCheck`가 꺼져 있으면 자동 확인은 하지 않는다(설정 화면의 [지금 확인]은 된다).
//! - 새 버전이면: OS 알림 1회("새 버전 나왔어요!") + 트레이 "업데이트 있음" + 모든 창에 `update` 이벤트(배너·스튜디오 사장님 말풍선).
//! - 설치: 사용자가 눌렀을 때만(`update_install`). 내려받기 → minisign 서명 검증(플러그인) → 설치 → 다시 시작. 몰래 설치하지 않는다.
//! - 받는 곳은 배포 전용 공개 저장소 `jhkwim/waitscape-releases`(본 저장소는 비공개). 실패(오프라인, latest.json 404 등)는 로그만 남기고 화면에는 오류를 띄우지 않는다.
//!   공개 키가 자리표시자(`<REPLACE_WITH_SECRET_MANAGER>`)인 빌드는 아예 확인하지 않는다.
//! - `updater` 기능을 끄고 빌드하면(Mac App Store 플레이버) 플러그인·네트워크 코드가 빠지고 status의 compiled가 false다.

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 자동 확인 간격
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 3600);

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Found {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

/// 앱 전체에서 하나 (`app.manage`)
#[derive(Default)]
pub struct Updates {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    found: Option<Found>,
    last_check: Option<SystemTime>,
    /// "" | "checking" | "downloading" | "installing"
    phase: &'static str,
    #[cfg(feature = "updater")]
    notified: Option<String>,
    #[cfg(feature = "updater")]
    pending: Option<tauri_plugin_updater::Update>,
}

/// 이 빌드에 업데이터가 들어 있나 (cargo feature `updater`)
pub fn compiled() -> bool {
    cfg!(feature = "updater")
}

/// 공개 키가 실제 값인가 (비었거나 자리표시자면 false)
pub fn pubkey_ready(pk: &str) -> bool {
    let pk = pk.trim();
    !pk.is_empty() && !pk.contains("REPLACE_WITH")
}

/// 마지막 확인이 없거나 `CHECK_EVERY`가 지났으면 true (시계가 거꾸로 갔어도 true)
pub fn is_due(last: Option<SystemTime>, now: SystemTime) -> bool {
    last.is_none_or(|l| now.duration_since(l).map_or(true, |d| d >= CHECK_EVERY))
}

/// 업데이트 확인을 할 수 있는 빌드인가: 기능이 켜져 있고 tauri.conf.json의 plugins.updater.pubkey가 실제 값
pub fn ready(app: &AppHandle) -> bool {
    compiled()
        && app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|u| u.get("pubkey"))
            .and_then(|p| p.as_str())
            .is_some_and(pubkey_ready)
}

/// 트레이가 보는 값: 새 버전이 있으면 그 버전
pub fn available(app: &AppHandle) -> Option<String> {
    app.try_state::<Updates>()
        .and_then(|s| s.inner.lock().unwrap().found.as_ref().map(|f| f.version.clone()))
}

/// 화면(설정·배너)이 보는 상태
pub fn status(app: &AppHandle) -> Value {
    let (found, phase, last) = match app.try_state::<Updates>() {
        Some(s) => {
            let g = s.inner.lock().unwrap();
            (g.found.clone(), g.phase, g.last_check)
        }
        None => (None, "", None),
    };
    json!({
        "compiled": compiled(),
        "ready": ready(app),
        "current": app.package_info().version.to_string(),
        "available": found,
        "phase": phase,
        "lastCheck": last.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64),
    })
}

/// 자동 확인 루프 시작 (setup에서 한 번)
pub fn start(app: &AppHandle) {
    if !ready(app) {
        wlog!(
            "update",
            "업데이트 확인 꺼짐: {}",
            if compiled() {
                "공개 키가 아직 없음 (docs/RELEASE.md)"
            } else {
                "이 빌드에는 업데이터가 없음"
            }
        );
    }
    #[cfg(feature = "updater")]
    if ready(app) {
        let app = app.clone();
        std::thread::Builder::new()
            .name("wr-updater".into())
            .spawn(move || {
                std::thread::sleep(Duration::from_secs(15));
                loop {
                    let on = app
                        .try_state::<std::sync::Arc<crate::backend::Backend>>()
                        .is_some_and(|b| b.settings().update_check);
                    let last = app.state::<Updates>().inner.lock().unwrap().last_check;
                    if on && is_due(last, SystemTime::now()) {
                        let _ = tauri::async_runtime::block_on(imp::check(&app));
                    }
                    std::thread::sleep(Duration::from_secs(3600));
                }
            })
            .ok();
    }
}

/// 설정에서 확인을 다시 켰을 때 등: 백그라운드로 한 번 확인
pub fn kick(app: &AppHandle) {
    #[cfg(feature = "updater")]
    if ready(app) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = imp::check(&app).await;
        });
    }
    #[cfg(not(feature = "updater"))]
    let _ = app;
}

/// [지금 확인] → { result: "available" | "latest" | "unavailable" | "disabled", status }
/// "unavailable" = 확인하지 못함(오프라인·비공개 저장소 등). 화면은 오류가 아니라 "지금은 확인할 수 없어요"로만 보여 준다
pub async fn check_now(app: &AppHandle) -> Value {
    if !ready(app) {
        return json!({"result": "disabled", "status": status(app)});
    }
    #[cfg(feature = "updater")]
    let result = match imp::check(app).await {
        Ok(Some(_)) => "available",
        Ok(None) => "latest",
        Err(()) => "unavailable",
    };
    #[cfg(not(feature = "updater"))]
    let result = "disabled";
    json!({"result": result, "status": status(app)})
}

/// 사용자가 [지금 업데이트]를 눌렀을 때: 내려받기 → 서명 검증 → 설치 → 다시 시작 (성공하면 돌아오지 않는다)
pub async fn install(app: AppHandle) -> Result<(), String> {
    let en = app
        .try_state::<std::sync::Arc<crate::backend::Backend>>()
        .is_some_and(|b| b.settings().lang == "en");
    if !ready(&app) {
        return Err(if en {
            "Updates are not available in this build"
        } else {
            "이 빌드에서는 업데이트를 할 수 없어요"
        }
        .into());
    }
    #[cfg(feature = "updater")]
    {
        imp::install(app, en).await
    }
    #[cfg(not(feature = "updater"))]
    {
        let _ = (app, en);
        Ok(())
    }
}

#[cfg(feature = "updater")]
mod imp {
    use super::{status, Found, Updates};
    use std::time::{Duration, SystemTime};
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_plugin_updater::UpdaterExt;

    fn set_phase(app: &AppHandle, phase: &'static str) {
        app.state::<Updates>().inner.lock().unwrap().phase = phase;
        app.emit("update", status(app)).ok();
    }

    fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, tauri_plugin_updater::Error> {
        let app2 = app.clone();
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            // Windows: 설치 프로그램을 띄우고 앱이 바로 끝나므로 창 위치를 먼저 저장
            .on_before_exit(move || {
                if let Some(wp) = app2.try_state::<crate::winpos::WinPos>() {
                    wp.flush();
                }
            })
            .build()
    }

    /// 확인 1회. Ok(Some) = 새 버전, Ok(None) = 최신, Err = 확인 못 함(로그만)
    pub async fn check(app: &AppHandle) -> Result<Option<Found>, ()> {
        {
            let st = app.state::<Updates>();
            let mut g = st.inner.lock().unwrap();
            if !g.phase.is_empty() {
                return Ok(g.found.clone());
            }
            g.phase = "checking";
        }
        let r = match updater(app) {
            Ok(u) => u.check().await,
            Err(e) => Err(e),
        };
        let st = app.state::<Updates>();
        let mut first = None;
        let out = {
            let mut g = st.inner.lock().unwrap();
            g.phase = "";
            match r {
                Ok(Some(u)) => {
                    g.last_check = Some(SystemTime::now());
                    let f = Found {
                        version: u.version.clone(),
                        notes: u.body.clone().unwrap_or_default().chars().take(4000).collect(),
                        date: u.date.map(|d| d.to_string()),
                    };
                    if g.notified.as_deref() != Some(f.version.as_str()) {
                        g.notified = Some(f.version.clone());
                        first = Some(f.version.clone());
                    }
                    g.found = Some(f.clone());
                    g.pending = Some(u);
                    Ok(Some(f))
                }
                Ok(None) => {
                    g.last_check = Some(SystemTime::now());
                    g.found = None;
                    g.pending = None;
                    Ok(None)
                }
                Err(e) => {
                    // 비공개 저장소(404)·오프라인 등. 화면에는 띄우지 않는다. 다음 시각에 다시
                    wlog!("update", "업데이트 확인 실패(조용히 넘어감): {e}");
                    g.last_check = Some(SystemTime::now());
                    Err(())
                }
            }
        };
        if let Some(v) = first {
            let be = app.try_state::<std::sync::Arc<crate::backend::Backend>>();
            let (en, quiet, plain) = be
                .map(|b| b.settings())
                .map(|s| (s.lang == "en", s.quiet, s.nunchi))
                .unwrap_or((false, false, false));
            let name = crate::brand_name();
            let (title, body) = if plain {
                // 🙈 눈치 모드: 담백하게(이모지·느낌표 없음), 소리 없음
                let t = if en { "Update available" } else { "업데이트가 있습니다" };
                (t.to_string(), format!("v{v}"))
            } else if en {
                (
                    "A new version is out!".to_string(),
                    format!("{name} v{v} — update from the tray menu or the window."),
                )
            } else {
                (
                    "새 버전 나왔어요!".to_string(),
                    format!("{name} v{v} — 트레이 메뉴의 '업데이트 있음'이나 창에서 업데이트할 수 있어요."),
                )
            };
            crate::backend::os_notify(app, &title, &body, quiet || plain);
        }
        let app2 = app.clone();
        app.run_on_main_thread(move || crate::tray::refresh(&app2)).ok();
        app.emit("update", status(app)).ok();
        out
    }

    pub async fn install(app: AppHandle, en: bool) -> Result<(), String> {
        let msg = |ko: &str, e: &str| if en { e.to_string() } else { ko.to_string() };
        let pending = {
            let st = app.state::<Updates>();
            let g = st.inner.lock().unwrap();
            if matches!(g.phase, "downloading" | "installing") {
                return Err(msg("이미 업데이트하는 중이에요", "Already updating"));
            }
            g.pending.clone()
        };
        let upd = match pending {
            Some(u) => u,
            None => {
                let _ = check(&app).await;
                app.state::<Updates>()
                    .inner
                    .lock()
                    .unwrap()
                    .pending
                    .clone()
                    .ok_or_else(|| msg("새 버전을 찾지 못했어요", "No new version found"))?
            }
        };
        set_phase(&app, "downloading");
        let (mut got, mut last_pct) = (0u64, u64::MAX);
        let r = upd
            .download_and_install(
                |n, total| {
                    got += n as u64;
                    let pct = total.map(|t| (got * 100 / t.max(1)).min(100)).unwrap_or(0);
                    if pct != last_pct {
                        last_pct = pct;
                        app.emit(
                            "update-progress",
                            serde_json::json!({"phase": "downloading", "pct": pct, "got": got, "total": total}),
                        )
                        .ok();
                    }
                },
                || {
                    app.state::<Updates>().inner.lock().unwrap().phase = "installing";
                    app.emit("update-progress", serde_json::json!({"phase": "installing"})).ok();
                },
            )
            .await;
        match r {
            Ok(()) => {
                if let Some(wp) = app.try_state::<crate::winpos::WinPos>() {
                    wp.flush();
                }
                wlog!("update", "업데이트 설치됨 → 다시 시작");
                app.restart()
            }
            Err(e) => {
                wlog!("update", "업데이트 실패: {e}");
                set_phase(&app, "");
                Err(msg(
                    "업데이트하지 못했어요. 나중에 다시 해 볼게요",
                    "Could not update. Please try again later",
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pubkey_placeholder_is_not_ready() {
        assert!(!pubkey_ready("<REPLACE_WITH_SECRET_MANAGER>"));
        assert!(!pubkey_ready("  "));
        assert!(pubkey_ready("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0QK"));
    }

    #[test]
    fn due_once_a_day() {
        let now = SystemTime::now();
        assert!(is_due(None, now));
        assert!(!is_due(Some(now - Duration::from_secs(3600)), now));
        assert!(is_due(Some(now - CHECK_EVERY), now));
        // 시계가 거꾸로 갔으면(마지막 확인이 미래) 다시 확인
        assert!(is_due(Some(now + Duration::from_secs(60)), now));
    }

    #[test]
    fn conf_has_endpoint_and_placeholder() {
        // 저장소 설정: 엔드포인트는 배포 전용 공개 저장소의 GitHub Releases latest.json(https), 공개 키는 실제 값(minisign)
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let u = &conf["plugins"]["updater"];
        let ep = u["endpoints"][0].as_str().unwrap();
        assert!(ep.starts_with("https://github.com/") && ep.ends_with("/releases/latest/download/latest.json"));
        assert!(u["pubkey"].as_str().is_some_and(pubkey_ready));
        // 서명 키가 없는 로컬 빌드가 깨지지 않게 기본은 false (CI가 시크릿이 있을 때만 --config로 켠다)
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], false);
    }
}

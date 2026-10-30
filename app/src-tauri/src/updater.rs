//! 앱 안 업데이트 (docs/RELEASE.md, ARCHITECTURE §6.4).
//! - 확인: 시작 15초 뒤 + 하루 1번. 1시간마다 깨어나 마지막 확인이 24시간 넘었는지 본다(잠자기 동안 멈추는 시계 때문에 24시간 sleep은 쓰지 않음).
//!   확인에 실패하면(오프라인 등) 24시간을 기다리지 않고 1시간 뒤 다시 해 본다. 연달아 실패하면 1→2→4→8→16→24시간으로 늘린다(`retry_after`, #67).
//!   이 시각들은 메모리에만 있다(앱을 다시 켜면 15초 뒤 새로 확인).
//! - 이미 확인하는 중에 [지금 확인]을 누르면 새로 확인하지 않고 그 확인이 끝나기를 기다려 같은 결과를 돌려준다(#67).
//!   설정 `updateCheck`가 꺼져 있으면 자동 확인은 하지 않는다(설정 화면의 [지금 확인]은 된다).
//! - 새 버전이면: OS 알림 1회("새 버전 나왔어요!") + 트레이 "업데이트 있음" + 모든 창에 `update` 이벤트(배너·스튜디오 사장님 말풍선).
//! - 설치: 사용자가 눌렀을 때만(`update_install`). 내려받기 → minisign 서명 검증(플러그인) → 설치 → 다시 시작. 몰래 설치하지 않는다.
//! - 받는 곳은 코드 저장소 `jhkwim/waitscape`의 GitHub Releases(0.4.0까지는 배포 전용 저장소 `jhkwim/waitscape-releases`, #22). 실패(오프라인, latest.json 404 등)는 로그만 남기고 화면에는 오류를 띄우지 않는다.
//!   공개 키가 자리표시자(`<REPLACE_WITH_SECRET_MANAGER>`)인 빌드는 아예 확인하지 않는다.
//! - `updater` 기능을 끄고 빌드하면(Mac App Store 플레이버) 플러그인·네트워크 코드가 빠지고 status의 compiled가 false다.

use serde_json::{json, Value};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 자동 확인 간격
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 3600);
/// 확인에 실패했을 때 첫 재시도 간격 (연달아 실패하면 두 배씩, `CHECK_EVERY`까지)
pub const RETRY_FIRST: Duration = Duration::from_secs(3600);
/// 진행 중인 확인을 기다리는 최대 시간 (플러그인 요청 제한 30초 + 여유)
#[cfg_attr(not(feature = "updater"), allow(dead_code))] // 업데이터 없는 빌드에선 테스트만 쓴다
const WAIT_MAX: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Found {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

/// 앱 전체에서 하나 (`app.manage`)
#[cfg_attr(not(feature = "updater"), allow(dead_code))] // 업데이터 없는 빌드에선 테스트만 쓴다
#[derive(Default)]
pub struct Updates {
    inner: Mutex<Inner>,
    /// 확인 1회가 끝날 때마다 깨운다 (진행 중인 확인을 기다리는 [지금 확인])
    done: Condvar,
}

#[cfg_attr(not(feature = "updater"), allow(dead_code))] // 업데이터 없는 빌드에선 테스트만 쓴다
#[derive(Default)]
struct Inner {
    found: Option<Found>,
    /// 마지막으로 확인에 성공한 시각 (화면의 lastCheck)
    last_check: Option<SystemTime>,
    /// 마지막으로 확인을 시도한 시각 (성공·실패 모두) — 다음 자동 확인 시각의 기준
    last_try: Option<SystemTime>,
    /// 연달아 실패한 횟수 (성공하면 0)
    fails: u32,
    /// 끝난 확인 수 (기다리는 쪽이 "내가 기다리던 확인이 끝났나"를 본다)
    checks: u64,
    /// 마지막 확인이 실패했나
    last_failed: bool,
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

/// 다음 확인까지 기다릴 시간: 성공했으면(`fails == 0`) `CHECK_EVERY`, 실패했으면 1·2·4·8·16시간… 최대 `CHECK_EVERY`
pub fn retry_after(fails: u32) -> Duration {
    if fails == 0 {
        return CHECK_EVERY;
    }
    RETRY_FIRST.saturating_mul(1u32 << (fails - 1).min(5)).min(CHECK_EVERY)
}

/// 마지막 시도가 없거나 `retry_after(fails)`가 지났으면 true (시계가 거꾸로 갔어도 true)
pub fn is_due(last_try: Option<SystemTime>, fails: u32, now: SystemTime) -> bool {
    let wait = retry_after(fails);
    last_try.is_none_or(|l| now.duration_since(l).map_or(true, |d| d >= wait))
}

/// 확인을 시작하려 할 때의 판단 (`Updates::begin`)
#[cfg_attr(not(feature = "updater"), allow(dead_code))] // 업데이터 없는 빌드에선 테스트만 쓴다
#[derive(Debug, PartialEq)]
enum Begin {
    /// 내가 확인한다 (phase = "checking"으로 바꿨음)
    Start,
    /// 이미 확인하는 중: 끝난 확인 수가 이 값에서 바뀌기를 기다린다
    Wait(u64),
    /// 내려받기·설치 중: 지금 아는 결과 그대로
    Busy(Option<Found>),
}

#[cfg_attr(not(feature = "updater"), allow(dead_code))] // 업데이터 없는 빌드에선 테스트만 쓴다
impl Updates {
    fn begin(&self) -> Begin {
        let mut g = self.inner.lock().unwrap();
        match g.phase {
            "" => {
                g.phase = "checking";
                Begin::Start
            }
            "checking" => Begin::Wait(g.checks),
            _ => Begin::Busy(g.found.clone()),
        }
    }

    /// 확인 1회를 끝낸다: 시각·실패 횟수를 적고 phase를 비우고 기다리는 쪽을 깨운다
    /// phase는 "checking"일 때만 비운다 — 확인하는 동안 시작된 설치("downloading"·"installing")를 지우지 않게
    fn finish(&self, ok: bool, now: SystemTime) {
        let mut g = self.inner.lock().unwrap();
        if g.phase == "checking" {
            g.phase = "";
        }
        g.last_try = Some(now);
        if ok {
            g.last_check = Some(now);
            g.fails = 0;
        } else {
            g.fails = g.fails.saturating_add(1);
        }
        g.last_failed = !ok;
        g.checks += 1;
        drop(g);
        self.done.notify_all();
    }

    /// 진행 중인 확인(`Begin::Wait(seen)`)이 끝나기를 최대 `max`까지 기다려 그 결과를 돌려준다. 시간이 넘으면 Err(확인 못 함)
    fn wait_result(&self, seen: u64, max: Duration) -> Result<Option<Found>, ()> {
        let g = self.inner.lock().unwrap();
        let (g, t) = self
            .done
            .wait_timeout_while(g, max, |g| g.checks == seen && g.phase == "checking")
            .unwrap();
        if t.timed_out() || g.last_failed {
            Err(())
        } else {
            Ok(g.found.clone())
        }
    }

    fn due(&self, now: SystemTime) -> bool {
        let g = self.inner.lock().unwrap();
        is_due(g.last_try, g.fails, now)
    }

    /// 설치 시작: 단계 검사와 "downloading" 표시를 한 락 안에서 한다(이중 설치 방지).
    /// `take`가 설치할 것을 꺼내면 Ok, 이미 설치 중이면 Err(Claim::Busy), 꺼낼 게 없으면 Err(Claim::Missing)
    fn claim_install<T>(&self, take: impl FnOnce(&Inner) -> Option<T>) -> Result<T, Claim> {
        let mut g = self.inner.lock().unwrap();
        if matches!(g.phase, "downloading" | "installing") {
            return Err(Claim::Busy);
        }
        let t = take(&g).ok_or(Claim::Missing)?;
        g.phase = "downloading";
        Ok(t)
    }
}

/// `Updates::claim_install` 실패 이유
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
#[derive(Debug, PartialEq)]
enum Claim {
    Busy,
    Missing,
}

/// `begin()`이 Start를 준 뒤 들고 있는 가드. 확인 도중 패닉이 나도 Drop에서 실패로 끝내
/// phase가 "checking"에 영원히 남지 않게 한다. 정상 경로는 `done(ok)`
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
struct CheckGuard<'a> {
    u: &'a Updates,
    armed: bool,
}

#[cfg_attr(not(feature = "updater"), allow(dead_code))]
impl<'a> CheckGuard<'a> {
    fn new(u: &'a Updates) -> Self {
        Self { u, armed: true }
    }

    fn done(mut self, ok: bool) {
        self.armed = false;
        self.u.finish(ok, SystemTime::now());
    }
}

impl Drop for CheckGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.u.finish(false, SystemTime::now());
        }
    }
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
                    // 성공 뒤엔 24시간, 실패 뒤엔 1시간부터(백오프). 1시간마다 깨므로 그보다 자주 묻지 않는다
                    if on && app.state::<Updates>().due(SystemTime::now()) {
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
/// "unavailable" = 확인하지 못함(오프라인·아직 게시 전 404 등). 화면은 오류가 아니라 "지금은 확인할 수 없어요"로만 보여 준다
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
    use super::{status, Begin, CheckGuard, Claim, Found, Updates, WAIT_MAX};
    use std::time::Duration;
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
    /// 이미 확인하는 중이면 새로 묻지 않고 그 확인이 끝나기를 기다려 같은 결과를 돌려준다(#67: 예전엔 바로 "최신"으로 보였음)
    pub async fn check(app: &AppHandle) -> Result<Option<Found>, ()> {
        let st = app.state::<Updates>();
        match st.begin() {
            Begin::Start => {}
            Begin::Busy(found) => return Ok(found),
            Begin::Wait(seen) => {
                let app = app.clone();
                return tauri::async_runtime::spawn_blocking(move || app.state::<Updates>().wait_result(seen, WAIT_MAX))
                    .await
                    .unwrap_or(Err(()));
            }
        }
        let guard = CheckGuard::new(&st);
        let r = match updater(app) {
            Ok(u) => u.check().await,
            Err(e) => Err(e),
        };
        let mut first = None;
        let out = {
            let mut g = st.inner.lock().unwrap();
            match r {
                Ok(Some(u)) => {
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
                    g.found = None;
                    g.pending = None;
                    Ok(None)
                }
                Err(e) => {
                    // 아직 게시 전(404)·오프라인 등. 화면에는 띄우지 않는다. 다음 시각(1시간부터 늘려 가며)에 다시
                    wlog!("update", "업데이트 확인 실패(조용히 넘어감, {}번째): {e}", g.fails + 1);
                    Err(())
                }
            }
        };
        guard.done(out.is_ok());
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
        let busy = || msg("이미 업데이트하는 중이에요", "Already updating");
        let claim = || app.state::<Updates>().claim_install(|g| g.pending.clone());
        let upd = match claim() {
            Ok(u) => u,
            Err(Claim::Busy) => return Err(busy()),
            Err(Claim::Missing) => {
                let _ = check(&app).await;
                match claim() {
                    Ok(u) => u,
                    Err(Claim::Busy) => return Err(busy()),
                    Err(Claim::Missing) => return Err(msg("새 버전을 찾지 못했어요", "No new version found")),
                }
            }
        };
        // phase는 claim_install이 이미 "downloading"으로 바꿨다. 화면에 알린다
        app.emit("update", status(&app)).ok();
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

    const H: Duration = Duration::from_secs(3600);

    #[test]
    fn due_once_a_day() {
        let now = SystemTime::now();
        assert!(is_due(None, 0, now));
        assert!(!is_due(Some(now - H), 0, now));
        assert!(!is_due(Some(now - CHECK_EVERY + Duration::from_secs(1)), 0, now));
        assert!(is_due(Some(now - CHECK_EVERY), 0, now));
        // 시계가 거꾸로 갔으면(마지막 확인이 미래) 다시 확인
        assert!(is_due(Some(now + Duration::from_secs(60)), 0, now));
        assert!(is_due(Some(now + Duration::from_secs(60)), 3, now));
    }

    #[test]
    fn retry_backs_off_up_to_a_day() {
        let hours: Vec<u64> = (0..10).map(|f| retry_after(f).as_secs() / 3600).collect();
        assert_eq!(hours, [24, 1, 2, 4, 8, 16, 24, 24, 24, 24]);
        assert_eq!(retry_after(u32::MAX), CHECK_EVERY);
    }

    #[test]
    fn failed_check_retries_in_an_hour() {
        // 가짜 시계: 실패한 시각 t0 → 59분 뒤는 아직, 1시간 뒤엔 다시 (예전엔 24시간 뒤)
        let t0 = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let u = Updates::default();
        assert!(u.due(t0));
        assert_eq!(u.begin(), Begin::Start);
        u.finish(false, t0);
        assert!(!u.due(t0 + H - Duration::from_secs(60)));
        assert!(u.due(t0 + H));
        // 두 번째 실패 → 2시간
        let t1 = t0 + H;
        u.begin();
        u.finish(false, t1);
        assert!(!u.due(t1 + H));
        assert!(u.due(t1 + 2 * H));
        // 성공하면 다시 하루 1번, 실패 횟수도 0으로
        let t2 = t1 + 2 * H;
        u.begin();
        u.finish(true, t2);
        assert!(!u.due(t2 + 23 * H));
        assert!(u.due(t2 + CHECK_EVERY));
        let g = u.inner.lock().unwrap();
        assert_eq!((g.fails, g.last_check, g.last_try), (0, Some(t2), Some(t2)));
    }

    #[test]
    fn failure_does_not_move_last_success() {
        let t0 = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let u = Updates::default();
        u.begin();
        u.finish(true, t0);
        u.begin();
        u.finish(false, t0 + H);
        assert_eq!(u.inner.lock().unwrap().last_check, Some(t0));
    }

    #[test]
    fn second_check_waits_for_the_one_in_flight() {
        use std::sync::Arc;
        let u = Arc::new(Updates::default());
        assert_eq!(u.begin(), Begin::Start); // 백그라운드 확인 시작
        let Begin::Wait(seen) = u.begin() else {
            panic!("진행 중이면 기다려야 함")
        };
        let u2 = u.clone();
        let waiter = std::thread::spawn(move || u2.wait_result(seen, Duration::from_secs(10)));
        std::thread::sleep(Duration::from_millis(50));
        // 백그라운드 확인이 새 버전을 찾고 끝남 → 기다리던 [지금 확인]도 같은 결과 (예전엔 None = "최신")
        let f = Found {
            version: "9.9.9".into(),
            notes: String::new(),
            date: None,
        };
        u.inner.lock().unwrap().found = Some(f.clone());
        u.finish(true, SystemTime::now());
        assert_eq!(waiter.join().unwrap(), Ok(Some(f)));
        assert_eq!(u.begin(), Begin::Start); // 끝났으니 다음엔 새로 확인
    }

    #[test]
    fn waiting_reports_failure_and_timeout() {
        use std::sync::Arc;
        let u = Arc::new(Updates::default());
        u.begin();
        let Begin::Wait(seen) = u.begin() else { panic!() };
        let u2 = u.clone();
        let waiter = std::thread::spawn(move || u2.wait_result(seen, Duration::from_secs(10)));
        std::thread::sleep(Duration::from_millis(50));
        u.finish(false, SystemTime::now());
        assert_eq!(waiter.join().unwrap(), Err(())); // 실패 → "지금은 확인할 수 없어요"
                                                     // 끝나지 않는 확인: 시간이 넘으면 확인 못 함으로
        u.begin();
        let Begin::Wait(seen) = u.begin() else { panic!() };
        assert_eq!(u.wait_result(seen, Duration::from_millis(20)), Err(()));
    }

    #[test]
    fn finishing_check_keeps_install_phase() {
        // 확인하는 동안 설치가 시작되면(phase "downloading") 확인이 끝나도 지우지 않는다
        let u = Updates::default();
        assert_eq!(u.begin(), Begin::Start);
        assert_eq!(u.claim_install(|_| Some(())), Ok(()));
        u.finish(true, SystemTime::now());
        assert_eq!(u.inner.lock().unwrap().phase, "downloading");
        // 이미 설치 중이면 두 번째 설치는 막힌다
        assert_eq!(u.claim_install(|_| Some(())), Err(Claim::Busy));
        assert_eq!(u.begin(), Begin::Busy(None));
    }

    #[test]
    fn claim_install_needs_something_to_install() {
        let u = Updates::default();
        assert_eq!(u.claim_install(|_| None::<()>), Err(Claim::Missing));
        assert_eq!(u.inner.lock().unwrap().phase, ""); // 실패하면 phase 그대로
        assert_eq!(u.claim_install(|_| Some(7)), Ok(7));
        assert_eq!(u.inner.lock().unwrap().phase, "downloading");
    }

    #[test]
    fn guard_finishes_as_failure_on_panic() {
        let u = Updates::default();
        assert_eq!(u.begin(), Begin::Start);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _g = CheckGuard::new(&u);
            panic!("확인 도중 패닉");
        }));
        assert!(r.is_err());
        let g = u.inner.lock().unwrap();
        assert_eq!((g.phase, g.fails, g.last_failed, g.checks), ("", 1, true, 1));
    }

    #[test]
    fn guard_done_finishes_once() {
        let u = Updates::default();
        u.begin();
        CheckGuard::new(&u).done(true);
        let g = u.inner.lock().unwrap();
        // disarm 뒤 Drop에서 다시 finish(false)를 하지 않는다
        assert_eq!((g.phase, g.fails, g.last_failed, g.checks), ("", 0, false, 1));
        assert!(g.last_check.is_some());
    }

    #[test]
    fn busy_installing_returns_known_result() {
        let u = Updates::default();
        u.inner.lock().unwrap().phase = "downloading";
        assert_eq!(u.begin(), Begin::Busy(None));
    }

    #[test]
    fn conf_has_endpoint_and_placeholder() {
        // 저장소 설정: 엔드포인트는 코드 저장소 GitHub Releases의 latest.json(https), 공개 키는 실제 값(minisign)
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let u = &conf["plugins"]["updater"];
        let ep = u["endpoints"][0].as_str().unwrap();
        assert_eq!(ep, "https://github.com/jhkwim/waitscape/releases/latest/download/latest.json");
        assert!(u["pubkey"].as_str().is_some_and(pubkey_ready));
        // 서명 키가 없는 로컬 빌드가 깨지지 않게 기본은 false (CI가 시크릿이 있을 때만 --config로 켠다)
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], false);
    }
}

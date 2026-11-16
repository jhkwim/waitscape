//! 트레이/메뉴바 (ARCHITECTURE §3.4). 메뉴: (새 버전이 있으면 맨 위에 🎁 업데이트 있음) · (기다리는 세션이 있으면 다음 세션 · 세션 목록) · 큰 화면 · 미니 보기(포켓·스튜디오 중 마지막, 체크 = 지금 미니) · 모드 ▸(목록 자동) · 회의 모드 · 🙈 눈치 모드 · 설정… · 종료.
//! 큰 화면과 미니 보기는 전환(둘 중 하나만 보임). 모드 선택·설정…도 큰 화면으로 돌아간다.
//! 모드 목록은 메인 창 코어가 켜진 모드 순서대로 알려 준다(`set_tray_modes`). macOS 메뉴바에는 `⏳2 ❗1` 요약을 띄운다.

use crate::backend::Backend;
use std::sync::Arc;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

const ICON: &[u8] = include_bytes!("../icons/tray.png");
const ICON_ALERT: &[u8] = include_bytes!("../icons/tray-alert.png");
pub const TRAY_ID: &str = "waitscape";

fn t(lang: &str, k: &str) -> &'static str {
    let en = lang == "en";
    match k {
        "open" => {
            if en {
                "Full Window"
            } else {
                "큰 화면"
            }
        }
        "modes" => {
            if en {
                "Modes"
            } else {
                "모드"
            }
        }
        "widget" => {
            if en {
                "Mini View"
            } else {
                "미니 보기"
            }
        }
        "quiet" => {
            if en {
                "Meeting Mode (silent)"
            } else {
                "회의 모드 (무음)"
            }
        }
        "nunchi" => {
            if en {
                "🙈 Low-Profile Mode"
            } else {
                "🙈 눈치 모드"
            }
        }
        "settings" => {
            if en {
                "Settings…"
            } else {
                "설정…"
            }
        }
        "quit" => {
            if en {
                "Quit"
            } else {
                "종료"
            }
        }
        "update" => {
            if en {
                "Update available"
            } else {
                "업데이트 있음"
            }
        }
        "next" => {
            if en {
                "Next Session"
            } else {
                "다음 세션"
            }
        }
        "none" => {
            if en {
                "(open the window once)"
            } else {
                "(창을 한 번 열면 채워져요)"
            }
        }
        _ => "",
    }
}

/// 모드 ▸ 하위 메뉴(트레이와 창 우클릭 메뉴가 함께 씀). 목록은 메인 창 코어가 알려 준 켜진 모드 순서
/// 눈치 모드면 메뉴 글자 앞의 이모지를 뗀다("🙈 눈치 모드" → "눈치 모드")
pub fn plain_label(label: &str, nunchi: bool) -> String {
    if !nunchi {
        return label.to_string();
    }
    let t = label.trim_start_matches(|c: char| !c.is_alphanumeric() && !('가'..='힣').contains(&c));
    t.trim().to_string()
}

pub fn modes_submenu(app: &AppHandle, be: &Backend) -> tauri::Result<Submenu<Wry>> {
    let s = be.settings();
    let lang = s.lang.as_str();
    let (modes, current) = be.tray_modes.lock().unwrap().clone();
    let sub = Submenu::with_id(app, "modes", t(lang, "modes"), true)?;
    if modes.is_empty() {
        sub.append(&MenuItem::with_id(app, "mode-none", t(lang, "none"), false, None::<&str>)?)?;
    }
    for m in modes.iter().take(20) {
        let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("");
        // 눈치 모드면 모드 아이콘(이모지)을 빼고 이름만
        let icon = if s.nunchi {
            ""
        } else {
            m.get("icon").and_then(|x| x.as_str()).unwrap_or("")
        };
        let label = format!("{} {}", icon, m.get("name").and_then(|x| x.as_str()).unwrap_or(id));
        sub.append(&CheckMenuItem::with_id(
            app,
            format!("mode:{id}"),
            label.trim(),
            true,
            id == current,
            None::<&str>,
        )?)?;
    }
    Ok(sub)
}

/// 메뉴에 둘 기다리는 세션 수 상한
const WAIT_MAX: usize = 8;

/// 답을 기다리는 세션 (sid, 권한이면 true, 프로젝트) — 인박스(core-lib.js `inboxQueue`)와 같은 기준·순서:
/// 추정(guess) 제외, 권한 → 질문, 오래 기다린 순
pub fn waiting(st: &serde_json::Value) -> Vec<(String, bool, String)> {
    let s = |x: &serde_json::Value, k: &str| x.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut v: Vec<(bool, f64, String, String)> = st
        .get("sessions")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter(|x| s(x, "status") == "needs_input" && s(x, "confidence") != "guess" && !s(x, "sid").is_empty())
        .map(|x| {
            let since = x.get("since").and_then(|v| v.as_f64()).unwrap_or(0.0);
            (s(x, "ask") == "permission", since, s(x, "sid"), s(x, "project"))
        })
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.total_cmp(&b.1)).then(a.2.cmp(&b.2)));
    v.into_iter().map(|(p, _, sid, pr)| (sid, p, pr)).collect()
}

/// 목록 줄 글자: 🔑/❓ + 프로젝트(같은 이름이 여럿이면 뒤에 (2)…). 눈치 모드면 이모지 없이
fn wait_labels(w: &[(String, bool, String)], nunchi: bool) -> Vec<String> {
    let mut seen: std::collections::HashMap<&str, usize> = Default::default();
    w.iter()
        .map(|(_, perm, pr)| {
            let name = if pr.trim().is_empty() { "?" } else { pr.as_str() };
            let n = seen.entry(name).or_insert(0);
            *n += 1;
            let name: String = name.chars().take(40).collect();
            let name = if *n > 1 { format!("{name} ({n})") } else { name };
            if nunchi {
                name
            } else {
                format!("{} {name}", if *perm { "🔑" } else { "❓" })
            }
        })
        .collect()
}

fn build_menu(app: &AppHandle, be: &Backend) -> tauri::Result<Menu<Wry>> {
    let s = be.settings();
    let lang = s.lang.as_str();
    let sub = modes_submenu(app, be)?;
    let widget = CheckMenuItem::with_id(app, "widget", t(lang, "widget"), true, s.widget, None::<&str>)?;
    let quiet = CheckMenuItem::with_id(app, "quiet", t(lang, "quiet"), true, s.quiet, None::<&str>)?;
    // 전역 단축키를 메뉴 오른쪽에 표시(맥 ⌃Q · 윈도우 Alt+`). 메뉴가 못 읽는 조합이면 표시 없이. 눈치 모드면 라벨도 이모지 없이
    let key = Some(crate::nunchi::effective_key(&s.nunchi_key, s.nunchi_global)).filter(|k| !k.is_empty()); // 스위치가 꺼져 있으면 표시 없음
    let nl = plain_label(t(lang, "nunchi"), s.nunchi);
    let nunchi = CheckMenuItem::with_id(app, "nunchi", &nl, true, s.nunchi, key)
        .or_else(|_| CheckMenuItem::with_id(app, "nunchi", &nl, true, s.nunchi, None::<&str>))?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", t(lang, "open"), true, None::<&str>)?,
            &widget,
            &sub,
            &quiet,
            &nunchi,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", t(lang, "settings"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", t(lang, "quit"), true, None::<&str>)?,
        ],
    )?;
    // 기다리는 세션이 있으면 맨 위에: 다음 세션(늘 같은 자리) · 세션 목록 — 누르면 그 세션으로(#188)
    let w = be.last.lock().unwrap().as_ref().map(waiting).unwrap_or_default();
    if !w.is_empty() {
        menu.prepend(&PredefinedMenuItem::separator(app)?)?;
        let labels = wait_labels(&w, s.nunchi);
        for ((sid, _, _), label) in w.iter().zip(labels).take(WAIT_MAX).rev() {
            menu.prepend(&MenuItem::with_id(app, format!("jump:{sid}"), label, true, None::<&str>)?)?;
        }
        let next = plain_label(&format!("⏭ {}", t(lang, "next")), s.nunchi);
        menu.prepend(&MenuItem::with_id(app, "jump-next", next, true, None::<&str>)?)?;
    }
    // 새 버전이 있으면 맨 위에 (누르면 큰 화면 + 업데이트 대화상자. 설치는 거기서 사용자가 누를 때만)
    if let Some(v) = crate::updater::available(app) {
        let label = format!("🎁 {} (v{v})", t(lang, "update"));
        menu.prepend(&PredefinedMenuItem::separator(app)?)?;
        menu.prepend(&MenuItem::with_id(app, "update", label, true, None::<&str>)?)?;
    }
    Ok(menu)
}

pub fn create(app: &AppHandle, be: Arc<Backend>) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, &be)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(true)
        .tooltip(crate::brand_name())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, ev| on_menu(app, ev.id().as_ref()))
        .build(app)
}

/// 메뉴를 다시 만든다 (모드 목록·언어·체크 상태가 바뀌었을 때)
/// 메뉴 다시 만들기. 어느 스레드에서 불러도 메인 스레드에서 실행(설정 저장은 async 명령·작업 스레드에서도 일어남)
pub fn refresh(app: &AppHandle) {
    let a = app.clone();
    app.run_on_main_thread(move || refresh_now(&a)).ok();
}

fn refresh_now(app: &AppHandle) {
    let Some(be) = app.try_state::<Arc<Backend>>() else { return };
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(m) = build_menu(app, &be) {
        tray.set_menu(Some(m)).ok();
    }
}

/// 창을 열고 닫는 메뉴 동작은 메뉴 이벤트(메인 스레드) 밖 작업 스레드에서: Windows(WebView2)는 이벤트 핸들러 안에서
/// 창을 만들면 교착한다(위젯·큰 창 재생성). 연타하면 앞 전환이 끝날 때까지 무시(같은 label 창을 두 번 만들지 않게)
fn switch_windows(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::AcqRel) {
        // 앞 전환이 멈춰(교착) 있으면 여기서 계속 무시된다 → 로그로 알 수 있게
        wlog!("tray", "앞 창 전환이 아직 안 끝나 무시");
        return;
    }
    let a = app.clone();
    std::thread::spawn(move || {
        wlog!("tray", "창 전환 시작 (작업 스레드)");
        f(&a);
        BUSY.store(false, Ordering::Release);
        refresh(&a);
    });
}

/// 메뉴 선택 처리 — 트레이와 창 우클릭 메뉴(ctxmenu.rs)가 함께 쓴다(메뉴 이벤트는 앱 전체로 옴)
pub fn on_menu(app: &AppHandle, id: &str) {
    let be = app.state::<Arc<Backend>>().inner().clone();
    // 화면을 바꾸는 다른 동작이면 "설정을 닫으면 미니 보기로" 표시를 지운다(원치 않는 복귀 방지)
    if matches!(id, "open" | "widget" | "update" | "settings") || id.starts_with("mode:") {
        crate::windows::clear_return_mini();
    }
    match id {
        "settings-mini" => switch_windows(app, |a| {
            // 미니 보기에서 연 설정: 닫으면 그 미니 보기로 돌아간다(windows::return_mini)
            crate::windows::mark_return_mini(a);
            if crate::windows::to_big(a) {
                a.emit_to("main", "open-settings", serde_json::json!({ "fromMini": true })).ok();
            } else {
                crate::windows::clear_return_mini();
            }
        }),
        "open" => switch_windows(app, |a| {
            let _ = crate::windows::to_big(a);
        }),
        "widget" => {
            use crate::windows::View;
            let now = if be.settings().widget { View::Mini } else { View::Big };
            match now.toggled() {
                View::Mini => switch_windows(app, |a| {
                    wlog!("tray", "트레이 → 미니 보기");
                    if crate::windows::to_mini(a, None).is_err() {
                        let _ = crate::windows::to_big(a);
                    }
                }),
                View::Big => switch_windows(app, |a| {
                    let _ = crate::windows::to_big(a);
                }),
            }
        }
        "quiet" => {
            let q = !be.settings().quiet;
            crate::commands::save_patch(app, &be, serde_json::json!({"quiet": q})).ok();
            refresh(app);
        }
        "nunchi" => {
            crate::nunchi::toggle(app);
            refresh(app);
        }
        "update-check" => {
            // 우클릭 메뉴: 지금 확인(결과는 평소처럼 알림·트레이·창 배너로)
            let a = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::updater::check_now(&a).await;
            });
        }
        "logs" => {
            if let Some(dir) = crate::applog::dir() {
                std::thread::spawn(move || {
                    if let Err(e) = crate::commands::open_dir(&dir) {
                        wlog!("app", "로그 폴더 열기 실패: {e}");
                    }
                });
            }
        }
        x if x.starts_with("ctx-go:") || x.starts_with("ctx-copy:") => {
            // 세션 이동·폴더 경로 복사는 우클릭한 창의 웹이(토스트·클립보드) — id = ctx-<동작>:<창>:<sid>
            let mut p = x.splitn(3, ':');
            let (Some(k), Some(label), Some(sid)) = (p.next(), p.next(), p.next()) else {
                return;
            };
            let act = if k == "ctx-go" { "go" } else { "copy" };
            app.emit_to(label, "ctx-action", serde_json::json!({ "act": act, "sid": sid })).ok();
        }
        "jump-next" => {
            // 누른 때의 가장 급한 세션(메뉴를 연 뒤 바뀌었을 수 있음)
            let first = be.last.lock().unwrap().as_ref().and_then(|v| waiting(v).into_iter().next());
            if let Some((sid, _, _)) = first {
                let a = app.clone();
                std::thread::spawn(move || crate::backend::jump_to_session(&a, &sid, "트레이 다음 세션"));
            }
        }
        x if x.starts_with("jump:") => {
            // 터미널·편집기 열기(osascript 등)는 메뉴 이벤트(메인 스레드) 밖에서
            let (a, sid) = (app.clone(), x[5..].to_string());
            std::thread::spawn(move || crate::backend::jump_to_session(&a, &sid, "트레이 세션 목록"));
        }
        "update" => switch_windows(app, |a| {
            if crate::windows::to_big(a) {
                a.emit_to("main", "update-show", ()).ok(); // 가드에 막힌 전환이면 건너뜀
            }
        }),
        "settings" => switch_windows(app, |a| {
            if crate::windows::to_big(a) {
                a.emit_to("main", "open-settings", ()).ok(); // 가드에 막힌 전환이면 건너뜀
            }
        }),
        "quit" => {
            // 창 위치는 이동·크기 변경 뒤 winpos가 저장하고, 대기 중인 것은 RunEvent::Exit에서 flush
            app.exit(0);
        }
        x if x.starts_with("mode:") => {
            let m = x[5..].to_string();
            switch_windows(app, move |a| {
                if crate::windows::to_big(a) {
                    a.emit_to("main", "set-mode", &m).ok();
                }
            });
        }
        _ => {}
    }
}

/// state가 바뀔 때·새 버전을 찾았을 때: 메뉴바 요약 텍스트(mac, 새 버전이면 🎁)와 아이콘(입력 필요 점)
pub fn update_summary(app: &AppHandle, st: &serde_json::Value) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let ss = st.get("sessions").and_then(|s| s.as_array()).cloned().unwrap_or_default();
    let status = |s: &serde_json::Value| s.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let working = ss.iter().filter(|s| matches!(status(s).as_str(), "working" | "agents")).count();
    let calling = ss.iter().filter(|s| status(s) == "needs_input").count();
    // 🙈 눈치 모드면 이모지 없이 숫자만 ("2 · 1")
    let plain = app.try_state::<Arc<Backend>>().is_some_and(|b| b.settings().nunchi);
    let mut parts = vec![];
    if working > 0 {
        parts.push(if plain { format!("{working}") } else { format!("⏳{working}") });
    }
    if calling > 0 {
        parts.push(if plain { format!("{calling}") } else { format!("❗{calling}") });
    }
    // 새 버전이 있으면 메뉴바 제목 맨 앞에 🎁 (#92 — 메뉴를 열지 않아도 보이게). 🙈 눈치 모드면 없음
    if !plain && crate::updater::available(app).is_some() {
        parts.insert(0, "🎁".to_string());
    }
    let title = parts.join(if plain { " · " } else { " " });
    // 기다리는 세션 목록이 바뀌었으면 메뉴를 다시 만든다(바뀔 때만 — 열린 메뉴를 자꾸 갈아 끼우지 않게)
    {
        use std::sync::Mutex;
        static LAST: Mutex<Vec<(String, bool, String)>> = Mutex::new(Vec::new());
        let w: Vec<_> = waiting(st).into_iter().take(WAIT_MAX).collect();
        let mut last = LAST.lock().unwrap();
        if *last != w {
            *last = w;
            refresh(app);
        }
    }
    let app2 = app.clone();
    let alert = calling > 0;
    // 트레이 조작은 메인 스레드에서
    app.run_on_main_thread(move || {
        if let Some(tray) = app2.tray_by_id(TRAY_ID) {
            #[cfg(target_os = "macos")]
            tray.set_title(if title.is_empty() { None } else { Some(title.as_str()) }).ok();
            #[cfg(not(target_os = "macos"))]
            tray.set_tooltip(Some(if title.is_empty() { crate::brand_name() } else { title.clone() }))
                .ok();
            if let Ok(img) = Image::from_bytes(if alert { ICON_ALERT } else { ICON }) {
                tray.set_icon(Some(img)).ok();
                tray.set_icon_as_template(true).ok();
            }
        }
    })
    .ok();
    let _ = tray;
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn waiting_matches_inbox_order() {
        let st = json!({"sessions": [
            {"sid": "q1", "status": "needs_input", "ask": "question", "since": 10.0, "project": "web"},
            {"sid": "g", "status": "needs_input", "ask": "permission", "confidence": "guess", "since": 1.0, "project": "x"},
            {"sid": "p2", "status": "needs_input", "ask": "permission", "since": 30.0, "project": "api"},
            {"sid": "p1", "status": "needs_input", "ask": "permission", "since": 20.0, "project": "api"},
            {"sid": "w", "status": "working", "since": 0.0, "project": "y"},
            {"sid": "u", "status": "needs_input", "since": 5.0, "project": ""},
        ]});
        let w = super::waiting(&st);
        let ids: Vec<_> = w.iter().map(|x| x.0.as_str()).collect();
        assert_eq!(
            ids,
            ["p1", "p2", "u", "q1"],
            "권한 먼저, 같은 종류는 오래 기다린 순, 추정·작업 중 제외"
        );
        assert_eq!(super::wait_labels(&w, false), ["🔑 api", "🔑 api (2)", "❓ ?", "❓ web"]);
        assert_eq!(super::wait_labels(&w, true), ["api", "api (2)", "?", "web"]);
    }

    #[test]
    fn plain_label_drops_leading_emoji_in_nunchi() {
        assert_eq!(super::plain_label("🙈 눈치 모드", true), "눈치 모드");
        assert_eq!(super::plain_label("🙈 Low-Profile Mode", true), "Low-Profile Mode");
        assert_eq!(super::plain_label("🙈 눈치 모드", false), "🙈 눈치 모드");
        assert_eq!(super::plain_label("회의 모드 (무음)", true), "회의 모드 (무음)");
    }
}

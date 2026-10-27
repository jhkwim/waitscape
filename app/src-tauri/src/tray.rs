//! 트레이/메뉴바 (ARCHITECTURE §3.4). 메뉴: (새 버전이 있으면 맨 위에 🎁 업데이트 있음) · 큰 화면 · 미니 보기(포켓·스튜디오 중 마지막, 체크 = 지금 미니) · 모드 ▸(목록 자동) · 회의 모드 · 🙈 눈치 모드 · 설정… · 종료.
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
                "Mode"
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

/// state가 바뀔 때: 메뉴바 요약 텍스트(mac)와 아이콘(입력 필요 점)
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
    let title = parts.join(if plain { " · " } else { " " });
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
    #[test]
    fn plain_label_drops_leading_emoji_in_nunchi() {
        assert_eq!(super::plain_label("🙈 눈치 모드", true), "눈치 모드");
        assert_eq!(super::plain_label("🙈 Low-Profile Mode", true), "Low-Profile Mode");
        assert_eq!(super::plain_label("🙈 눈치 모드", false), "🙈 눈치 모드");
        assert_eq!(super::plain_label("회의 모드 (무음)", true), "회의 모드 (무음)");
    }
}

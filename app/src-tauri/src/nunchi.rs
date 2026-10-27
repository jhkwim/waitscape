//! 🙈 눈치 모드 (#51): 전역 단축키(tauri-plugin-global-shortcut, Rust에서만 등록) · 창 제목 · 단축키 상태.
//! 켜고 끄기는 settings `nunchi` 하나 — 단축키·트레이·웹(B 키)이 모두 `save_patch`로 바꾸고, 모든 창은 `settings` 이벤트로 함께 전환한다.
//! 단축키를 다른 앱이 이미 쓰면 등록이 실패한다 → 로그 + 설정 화면 안내(`nunchi_status`). 손쉬운 사용 권한은 필요 없다(Carbon 핫키).

use crate::backend::Backend;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 눈치 모드 창 제목·알림 제목(프로젝트를 모를 때)
pub const TITLE: &str = "Agent Sessions";

/// 지금 등록된 단축키·키 문자열·마지막 오류 (설정 화면 안내용). 상태 락은 짧게만 쥔다(등록 중에는 쥐지 않음)
#[derive(Default, Clone, Debug, PartialEq)]
pub struct HkState {
    pub reg: Option<Shortcut>,
    pub key: String,
    pub err: Option<String>,
}

#[derive(Default)]
pub struct Hotkey {
    inner: Mutex<HkState>,
    /// 등록·해제를 한 번에 하나씩(빠른 연속 저장). 이 락은 메인 스레드에서 잡지 않는다
    apply: Mutex<()>,
}

/// 할 일: 건너뜀 · (옛 등록 해제 후) 새 키 등록. 같은 키로 **이미 등록 성공**했을 때만 건너뛴다(실패했으면 같은 키로 다시 시도 가능), force면 늘 다시
#[derive(Debug, PartialEq)]
pub enum Plan {
    Skip,
    Apply { unreg: Option<Shortcut>, key: String },
}

/// 실제로 등록할 키: 전역 단축키 스위치가 꺼져 있으면 빈 키(= 등록 해제), 저장된 키 값은 건드리지 않는다
pub fn effective_key(key: &str, global: bool) -> &str {
    if global {
        key
    } else {
        ""
    }
}

pub fn plan(cur: &HkState, want: &str, force: bool) -> Plan {
    if !force && cur.key == want && cur.reg.is_some() {
        return Plan::Skip;
    }
    Plan::Apply {
        unreg: cur.reg,
        key: want.to_string(),
    }
}

/// 플러그인: 등록한 단축키를 누르면(뗄 때 말고) 눈치 모드 토글.
/// 큰 창이 보이면 그 창 코어에 맡긴다(`nunchi-key`): 전환 연출 중에 또 누르면 되돌리지 않고 "바로 끝"이어야 해서(B 키와 같은 규칙)
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _sc, ev| {
            if ev.state() != ShortcutState::Pressed {
                return;
            }
            let shown = app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(false));
            if shown {
                app.emit_to("main", "nunchi-key", ()).ok();
            } else {
                let a = app.clone();
                std::thread::spawn(move || toggle(&a));
            }
        })
        .build()
}

/// 켜고 끄기: 지금 값을 settings 락 안에서 뒤집는다(연타해도 읽고-쓰기 사이에 끼어들지 않음)
pub fn toggle(app: &AppHandle) {
    let Some(be) = app.try_state::<Arc<Backend>>() else { return };
    if let Err(e) = crate::commands::save_patch_with(app, &be, |s| serde_json::json!({ "nunchi": !s.nunchi })) {
        wlog!("nunchi", "전환 실패: {e}");
    }
}

/// 단축키를 (다시) 등록한다 — 키는 **실행 시점의 설정**에서 읽는다(빠른 연속 저장 때 늦게 도착한 옛 키로 덮지 않게). 빈 키면 끔.
/// 메인 스레드에서 부르지 말 것: 플러그인이 메인 스레드 작업을 기다린다. 그동안 상태 락(inner)은 쥐지 않아 `nunchi_status`가 막히지 않는다
pub fn apply_key(app: &AppHandle, force: bool) {
    let (Some(hk), Some(be)) = (app.try_state::<Hotkey>(), app.try_state::<Arc<Backend>>()) else {
        return;
    };
    let _one = hk.apply.lock().unwrap_or_else(|e| e.into_inner());
    let s = be.settings();
    let want = effective_key(&s.nunchi_key, s.nunchi_global).to_string();
    let cur = hk.inner.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let Plan::Apply { unreg, key } = plan(&cur, &want, force) else {
        return;
    };
    let gs = app.global_shortcut();
    if let Some(old) = unreg {
        gs.unregister(old).ok();
    }
    let res = if key.is_empty() {
        Ok(None)
    } else {
        Shortcut::from_str(&key)
            .map_err(|e| e.to_string())
            .and_then(|sc| gs.register(sc).map(|_| Some(sc)).map_err(|e| e.to_string()))
    };
    let next = match res {
        Ok(reg) => {
            if reg.is_some() {
                wlog!("nunchi", "단축키 등록: {key}");
            } else {
                wlog!("nunchi", "단축키 끔");
            }
            HkState { reg, key, err: None }
        }
        Err(e) => {
            // 다른 앱이 선점했거나 형식이 틀림 → 설정 화면에 안내([다시 시도] 가능)
            wlog!("nunchi", "단축키 등록 실패 {key}: {e}");
            HkState {
                reg: None,
                key,
                err: Some(e),
            }
        }
    };
    *hk.inner.lock().unwrap_or_else(|e| e.into_inner()) = next;
}

/// 설정 화면용 `{ key, ok, err }`
pub fn status(app: &AppHandle) -> serde_json::Value {
    let Some(hk) = app.try_state::<Hotkey>() else {
        return serde_json::Value::Null;
    };
    let g = hk.inner.lock().unwrap_or_else(|e| e.into_inner());
    serde_json::json!({ "key": g.key, "ok": g.reg.is_some(), "err": g.err })
}

/// 창 제목: 눈치 모드면 "Agent Sessions" (웹의 document.title은 OS 창 제목에 이어지지 않는다)
fn title(on: bool, widget: bool) -> String {
    match (on, widget) {
        (true, _) => TITLE.into(),
        (false, false) => crate::brand_name(),
        (false, true) => format!("{} · Widget", crate::brand_name()),
    }
}

/// 새로 만드는 창의 제목 (설정을 아직 못 읽었으면 평소 이름)
pub fn title_for(app: &AppHandle, widget: bool) -> String {
    title(app.try_state::<Arc<Backend>>().is_some_and(|b| b.settings().nunchi), widget)
}

pub fn titles(app: &AppHandle, on: bool) {
    for (label, widget) in [("main", false), ("widget", true)] {
        if let Some(w) = app.get_webview_window(label) {
            w.set_title(&title(on, widget)).ok();
        }
    }
}

/// 시작: 단축키 등록(작업 스레드) + 창 제목
pub fn start(app: &AppHandle, on: bool) {
    app.manage(Hotkey::default());
    titles(app, on);
    let a = app.clone();
    std::thread::spawn(move || apply_key(&a, false));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_key_parses() {
        assert!(Shortcut::from_str(crate::settings::NUNCHI_KEY).is_ok());
        assert!(Shortcut::from_str("Alt+Shift+B").is_ok());
        // 플랫폼 기본값이 모두 플러그인 형식으로 읽힘(맥 ⌃Q = Control+KeyQ, 윈도우 Alt+`)
        assert!(Shortcut::from_str(crate::settings::NUNCHI_KEY_MAC).is_ok() && Shortcut::from_str(crate::settings::NUNCHI_KEY_PC).is_ok());
        assert!(Shortcut::from_str("Shift+").is_err());
    }

    #[test]
    fn retry_after_failure_and_force() {
        let sc = Shortcut::from_str("Alt+Shift+B").unwrap();
        let ok = HkState {
            reg: Some(sc),
            key: "Alt+Shift+B".into(),
            err: None,
        };
        // 같은 키로 이미 등록됨 → 건너뜀, force([다시 시도])면 해제 후 다시
        assert_eq!(plan(&ok, "Alt+Shift+B", false), Plan::Skip);
        assert_eq!(
            plan(&ok, "Alt+Shift+B", true),
            Plan::Apply {
                unreg: Some(sc),
                key: "Alt+Shift+B".into()
            }
        );
        // 같은 키로 실패했으면 다시 시도한다(예전엔 건너뛰어 재등록이 막혔음)
        let failed = HkState {
            reg: None,
            key: "Alt+Shift+B".into(),
            err: Some("HotKey already registered".into()),
        };
        assert_eq!(
            plan(&failed, "Alt+Shift+B", false),
            Plan::Apply {
                unreg: None,
                key: "Alt+Shift+B".into()
            }
        );
        // 다른 키 → 옛 등록 해제 후 새 키, 빈 키 → 해제만
        assert_eq!(
            plan(&ok, "Ctrl+Alt+N", false),
            Plan::Apply {
                unreg: Some(sc),
                key: "Ctrl+Alt+N".into()
            }
        );
        assert_eq!(
            plan(&ok, "", false),
            Plan::Apply {
                unreg: Some(sc),
                key: String::new()
            }
        );
        assert_eq!(
            plan(&HkState::default(), "", false),
            Plan::Apply {
                unreg: None,
                key: String::new()
            }
        );
    }

    #[test]
    fn global_switch_unregisters_and_restores() {
        let sc = Shortcut::from_str("Control+KeyQ").unwrap();
        let on = HkState {
            reg: Some(sc),
            key: "Control+KeyQ".into(),
            err: None,
        };
        // 스위치를 끄면 빈 키 → 지금 등록을 해제
        assert_eq!(effective_key("Control+KeyQ", false), "");
        assert_eq!(
            plan(&on, effective_key("Control+KeyQ", false), false),
            Plan::Apply {
                unreg: Some(sc),
                key: String::new()
            }
        );
        // 다시 켜면 저장된 키로 재등록
        let off = HkState {
            reg: None,
            key: String::new(),
            err: None,
        };
        assert_eq!(
            plan(&off, effective_key("Control+KeyQ", true), false),
            Plan::Apply {
                unreg: None,
                key: "Control+KeyQ".into()
            }
        );
        assert_eq!(plan(&on, effective_key("Control+KeyQ", true), false), Plan::Skip);
    }
}

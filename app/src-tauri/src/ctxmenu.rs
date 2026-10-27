//! 창 우클릭 메뉴(네이티브). WebView 기본 메뉴(새로고침·검사) 대신 — 입력란은 웹이 기본 편집 메뉴를 그대로 둔다.
//! 항목은 순수 함수 `spec`(테스트)으로 정하고, 고르면 트레이 메뉴와 같은 처리(`tray::on_menu`, 메뉴 이벤트는 앱 전체로 온다)를 탄다.
//! 세션 위에서 열면 맨 위에 [cmux로 이동]·[폴더 경로 복사] — 이 둘은 그 창 웹(`ctx-action` 이벤트)이 처리해 토스트·클립보드를 쓴다.

use crate::backend::Backend;
use serde_json::Value;
use std::sync::Arc;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, WebviewWindow, Wry};

#[derive(Debug, Clone, PartialEq)]
pub enum MItem {
    /// 누를 수 없는 제목 줄(스튜디오 직원 이름표 등)
    Title(String),
    Act {
        id: String,
        label: String,
        checked: Option<bool>,
        accel: Option<String>,
    },
    Sep,
    /// 모드 ▸ (트레이와 같은 목록)
    Modes,
}

/// 메뉴를 정하는 데 필요한 것만
#[derive(Debug, Clone, Default)]
pub struct MenuCtx {
    pub widget: bool,
    pub en: bool,
    pub nunchi: bool,
    pub quiet: bool,
    /// 전역 단축키(켜져 있을 때만) — 눈치 모드 항목 옆 표시
    pub accel: Option<String>,
    pub updater: bool,
    /// 우클릭한 자리의 세션: (sid, 멀티플렉서 이름 cmux|Orca, 폴더를 아는가)
    pub session: Option<(String, Option<String>, bool)>,
    pub title: Option<String>,
}

/// 창 안 단축키 ⌘2 / Ctrl+2 = 미니 보기 ↔ 큰 화면(웹 core.js가 처리, 메뉴엔 표시만)
const MINI_KEY: &str = "CmdOrCtrl+2";

fn l(en: bool, ko: &str, e: &str) -> String {
    (if en { e } else { ko }).to_string()
}

/// 메뉴 항목 구성(순수 함수). 위젯은 짧게: 큰 화면으로 · 눈치 모드 · 회의 모드 · 설정… · 종료
pub fn spec(c: &MenuCtx) -> Vec<MItem> {
    let en = c.en;
    let act = |id: &str, label: String| MItem::Act {
        id: id.into(),
        label,
        checked: None,
        accel: None,
    };
    let mut v = vec![];
    if let Some(t) = c.title.as_ref().filter(|t| !t.trim().is_empty()) {
        v.push(MItem::Title(t.chars().take(60).collect()));
    }
    if let Some((sid, mux, cwd)) = &c.session {
        if let Some(m) = mux {
            v.push(act(
                &format!("go:{sid}"),
                if en { format!("Go to {m}") } else { format!("{m}로 이동") },
            ));
        }
        if *cwd {
            v.push(act(&format!("copy:{sid}"), l(en, "폴더 경로 복사", "Copy folder path")));
        }
        if mux.is_some() || *cwd {
            v.push(MItem::Sep);
        }
    }
    // 눈치 모드가 켜져 있으면 메뉴 글자도 담백하게(이모지 없이)
    let nx = if c.nunchi {
        l(en, "눈치 모드", "Low-Profile Mode")
    } else {
        l(en, "🙈 눈치 모드", "🙈 Low-Profile Mode")
    };
    let nunchi = MItem::Act {
        id: "nunchi".into(),
        label: nx,
        checked: Some(c.nunchi),
        accel: c.accel.clone(),
    };
    let quiet = MItem::Act {
        id: "quiet".into(),
        label: l(en, "회의 모드 (무음)", "Meeting Mode (silent)"),
        checked: Some(c.quiet),
        accel: None,
    };
    // 위젯에서 연 설정은 닫으면 미니 보기로 돌아온다(tray "settings-mini")
    let settings = act(if c.widget { "settings-mini" } else { "settings" }, l(en, "설정…", "Settings…"));
    let quit = act("quit", l(en, "종료", "Quit"));
    if c.widget {
        v.extend([
            MItem::Act {
                id: "open".into(),
                label: l(en, "큰 화면으로", "Full Window"),
                checked: None,
                accel: Some(MINI_KEY.into()),
            },
            nunchi,
            quiet,
            MItem::Sep,
            settings,
            MItem::Sep,
            quit,
        ]);
        return v;
    }
    let mini = if c.nunchi {
        l(en, "미니 보기", "Mini View")
    } else {
        l(en, "📌 미니 보기", "📌 Mini View")
    };
    let mini = MItem::Act {
        id: "widget".into(),
        label: mini,
        checked: None,
        accel: Some(MINI_KEY.into()),
    };
    v.extend([nunchi, mini, MItem::Modes, quiet, MItem::Sep, settings]);
    if c.updater {
        v.push(act("update-check", l(en, "업데이트 확인", "Check for Updates")));
    }
    v.extend([act("logs", l(en, "로그 폴더 열기", "Open Logs Folder")), MItem::Sep, quit]);
    v
}

/// 우클릭한 세션의 이동 정보(마지막 state에서 다시 찾음 — 웹이 준 값은 sid뿐)
fn session_info(be: &Backend, sid: &str) -> Option<(String, Option<String>, bool)> {
    let st = be.last.lock().unwrap().clone()?;
    let s = st
        .get("sessions")?
        .as_array()?
        .iter()
        .find(|x| x.get("sid").and_then(Value::as_str) == Some(sid))?
        .clone();
    let mux = s.pointer("/jump/mux/kind").and_then(Value::as_str).and_then(|k| match k {
        "cmux" => Some("cmux".to_string()),
        "orca" => Some("Orca".to_string()),
        _ => None,
    });
    let cwd = s.get("cwd").and_then(Value::as_str).is_some_and(|c| !c.is_empty());
    Some((sid.to_string(), if cfg!(feature = "terminal-jump") { mux } else { None }, cwd))
}

/// 메뉴를 만들어 그 창에 띄운다. 메인 스레드 작업은 tauri가 맡는다(async 명령에서 부를 것 — WebView2 교착 규칙)
pub fn popup(app: &AppHandle, w: &WebviewWindow, sid: Option<String>, title: Option<String>) -> Result<(), String> {
    let be = app.state::<Arc<Backend>>().inner().clone();
    let s = be.settings();
    let accel = Some(crate::nunchi::effective_key(&s.nunchi_key, s.nunchi_global).to_string()).filter(|k| !k.is_empty());
    let c = MenuCtx {
        widget: w.label() == "widget",
        en: s.lang == "en",
        nunchi: s.nunchi,
        quiet: s.quiet,
        accel,
        updater: crate::updater::compiled(),
        session: sid.as_deref().filter(|x| x.len() <= 128).and_then(|x| session_info(&be, x)),
        title,
    };
    let label = w.label().to_string();
    let menu = build(app, &be, &spec(&c), &label).map_err(|e| e.to_string())?;
    w.popup_menu(&menu).map_err(|e| e.to_string())
}

fn build(app: &AppHandle, be: &Backend, items: &[MItem], label: &str) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let mut n = 0;
    for it in items {
        n += 1;
        match it {
            MItem::Title(t) => menu.append(&MenuItem::with_id(app, format!("ctx-title-{n}"), t, false, None::<&str>)?)?,
            MItem::Sep => menu.append(&PredefinedMenuItem::separator(app)?)?,
            MItem::Modes => menu.append(&crate::tray::modes_submenu(app, be)?)?,
            MItem::Act {
                id,
                label: text,
                checked,
                accel,
            } => {
                // 이동·복사는 그 창 웹이 처리: id에 창 이름을 붙임(go:<창>:<sid>)
                let id = match id.split_once(':') {
                    Some((k @ ("go" | "copy"), sid)) => format!("ctx-{k}:{label}:{sid}"),
                    _ => id.clone(),
                };
                let a = accel.as_deref();
                let item: Box<dyn IsMenuItem<Wry>> = match checked {
                    Some(c) => Box::new(
                        CheckMenuItem::with_id(app, &id, text, true, *c, a)
                            .or_else(|_| CheckMenuItem::with_id(app, &id, text, true, *c, None::<&str>))?,
                    ),
                    None => Box::new(
                        MenuItem::with_id(app, &id, text, true, a).or_else(|_| MenuItem::with_id(app, &id, text, true, None::<&str>))?,
                    ),
                };
                menu.append(item.as_ref())?
            }
        }
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[MItem]) -> Vec<String> {
        v.iter()
            .map(|i| match i {
                MItem::Title(t) => format!("title:{t}"),
                MItem::Act { id, .. } => id.clone(),
                MItem::Sep => "-".into(),
                MItem::Modes => "modes".into(),
            })
            .collect()
    }

    #[test]
    fn main_menu_without_session() {
        let c = MenuCtx {
            accel: Some("Control+KeyQ".into()),
            updater: true,
            ..Default::default()
        };
        assert_eq!(
            ids(&spec(&c)),
            [
                "nunchi",
                "widget",
                "modes",
                "quiet",
                "-",
                "settings",
                "update-check",
                "logs",
                "-",
                "quit"
            ]
        );
        // 업데이터가 빠진 빌드엔 업데이트 확인 없음, 눈치 모드 옆 단축키 표시
        let v = spec(&MenuCtx {
            updater: false,
            ..c.clone()
        });
        assert!(!ids(&v).contains(&"update-check".to_string()));
        assert!(matches!(&v[0], MItem::Act { accel: Some(k), checked: Some(false), .. } if k == "Control+KeyQ"));
    }

    #[test]
    fn session_items_on_top() {
        let base = MenuCtx {
            title: Some("🐱 waitscape · 실행 중".into()),
            ..Default::default()
        };
        let with_mux = MenuCtx {
            session: Some(("s1".into(), Some("cmux".into()), true)),
            ..base.clone()
        };
        let v = spec(&with_mux);
        assert_eq!(ids(&v)[..5], ["title:🐱 waitscape · 실행 중", "go:s1", "copy:s1", "-", "nunchi"]);
        assert!(matches!(&v[1], MItem::Act { label, .. } if label == "cmux로 이동"));
        // mux 없음 → 복사만, 폴더도 모르면 세션 항목 없음(구분선도 없음)
        assert_eq!(
            ids(&spec(&MenuCtx {
                session: Some(("s1".into(), None, true)),
                ..Default::default()
            }))[..3],
            ["copy:s1", "-", "nunchi"]
        );
        assert_eq!(
            ids(&spec(&MenuCtx {
                session: Some(("s1".into(), None, false)),
                ..Default::default()
            }))[0],
            "nunchi"
        );
        // 영어
        let v = spec(&MenuCtx {
            en: true,
            session: Some(("s1".into(), Some("Orca".into()), false)),
            ..Default::default()
        });
        assert!(matches!(&v[0], MItem::Act { label, .. } if label == "Go to Orca"));
    }

    #[test]
    fn widget_and_nunchi_labels() {
        let w = MenuCtx {
            widget: true,
            quiet: true,
            ..Default::default()
        };
        assert_eq!(ids(&spec(&w)), ["open", "nunchi", "quiet", "-", "settings-mini", "-", "quit"]);
        assert!(matches!(&spec(&w)[2], MItem::Act { checked: Some(true), .. }));
        // 눈치 모드가 켜져 있으면 이모지 없는 문구
        let on = spec(&MenuCtx {
            nunchi: true,
            ..Default::default()
        });
        assert!(matches!(&on[0], MItem::Act { label, checked: Some(true), .. } if label == "눈치 모드"));
        assert!(matches!(&on[1], MItem::Act { label, accel: Some(k), .. } if label == "미니 보기" && k == "CmdOrCtrl+2"));
        assert!(matches!(&spec(&MenuCtx { en: true, ..Default::default() })[1], MItem::Act { label, .. } if label == "📌 Mini View"));
        assert!(
            matches!(&spec(&MenuCtx { widget: true, ..Default::default() })[0], MItem::Act { accel: Some(k), .. } if k == "CmdOrCtrl+2")
        );
        let off = spec(&MenuCtx {
            en: true,
            ..Default::default()
        });
        assert!(matches!(&off[0], MItem::Act { label, .. } if label == "🙈 Low-Profile Mode"));
    }
}

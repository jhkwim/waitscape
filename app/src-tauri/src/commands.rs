//! 프론트가 부르는 명령 (`Core.api` tauri 구현과 1:1, web/core/api.js). 창별 허용은 capabilities/*.json이 정하고,
//! 설치·훅·터미널처럼 부작용이 큰 명령은 여기서도 메인 창인지 한 번 더 확인한다.

use crate::backend::{os_notify, Backend};
use crate::mcp_connect::{self as mcpc, Cli};
use crate::settings::AppSettings;
use crate::{hooks, mode_install, terminal, updater, windows};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use wr_core::TraceQuery;

type B<'a> = State<'a, Arc<Backend>>;

fn main_only(w: &WebviewWindow) -> Result<(), String> {
    if w.label() == "main" {
        Ok(())
    } else {
        Err("main window only".into())
    }
}

/// 메인 + 위젯(미니 보기). 위젯에서 직원·완료 보고를 눌러 그 세션으로 가는 명령만 쓴다(인자는 sid뿐, 값은 서버 state에서 다시 찾음)
fn main_or_widget(w: &WebviewWindow) -> Result<(), String> {
    if matches!(w.label(), "main" | "widget") {
        Ok(())
    } else {
        Err("main or widget window only".into())
    }
}

/// 설정 저장 + 부작용 + 모든 창에 `settings` 이벤트
pub fn save_patch(app: &AppHandle, be: &Backend, patch: Value) -> Result<Value, String> {
    save_patch_with(app, be, |_| patch)
}

/// 지금 설정을 보고 patch를 만드는 저장(읽고-쓰기를 settings 락 안에서 한 번에 — 🙈 눈치 모드 토글 연타)
pub fn save_patch_with(app: &AppHandle, be: &Backend, make: impl FnOnce(&AppSettings) -> Value) -> Result<Value, String> {
    let (before, after) = {
        let mut s = be.settings.lock().unwrap();
        let next = s.patched(&make(&s))?;
        let before = s.clone();
        *s = next.clone();
        (before, next)
    };
    after.save(&be.settings_path).map_err(|e| format!("설정 저장 실패: {}", e.kind()))?;
    if before.usage_lookup != after.usage_lookup {
        be.engine.lock().unwrap().set_poll_on(after.usage_lookup);
        be.kick();
    }
    if before.mcp_reports != after.mcp_reports {
        be.engine.lock().unwrap().set_reports_on(after.mcp_reports);
        be.kick();
    }
    if before.hide_projects != after.hide_projects || before.hide_builtin != after.hide_builtin {
        be.engine.lock().unwrap().set_hide(&after.hide_projects, after.hide_builtin);
        be.kick();
    }
    if before.autostart != after.autostart {
        use tauri_plugin_autostart::ManagerExt;
        let m = app.autolaunch();
        let r = if after.autostart { m.enable() } else { m.disable() };
        if let Err(e) = r {
            wlog!("app", "자동 시작 설정 실패: {e}");
        }
    }
    if !before.update_check && after.update_check {
        updater::kick(app);
    }
    if before.nunchi != after.nunchi {
        wlog!("nunchi", "눈치 모드 {}", if after.nunchi { "켬" } else { "끔" });
        crate::nunchi::titles(app, after.nunchi);
        if let Some(v) = be.last.lock().unwrap().clone() {
            crate::tray::update_summary(app, &v); // 메뉴바 요약도 담백하게
        }
    }
    if before.nunchi_key != after.nunchi_key || before.nunchi_global != after.nunchi_global {
        let a = app.clone();
        std::thread::spawn(move || crate::nunchi::apply_key(&a, false));
    }
    if before.lang != after.lang
        || before.quiet != after.quiet
        || before.widget != after.widget
        || before.nunchi != after.nunchi
        || before.nunchi_global != after.nunchi_global
        || before.nunchi_key != after.nunchi_key
    {
        crate::tray::refresh(app);
    }
    let v = serde_json::to_value(&after).unwrap();
    app.emit("settings", &v).ok();
    Ok(v)
}

#[tauri::command]
pub fn get_state(be: B) -> Value {
    be.state_value()
}

#[derive(serde::Deserialize, Default)]
pub struct TraceArgs {
    #[serde(default)]
    session: String,
    #[serde(default)]
    prompt: Value,
    #[serde(default)]
    since: String,
}

#[tauri::command]
pub async fn get_trace(be: B<'_>, q: TraceArgs) -> Result<Value, String> {
    let prompt = match q.prompt {
        Value::Null => "last".to_string(),
        Value::String(s) => s,
        other => other.to_string(),
    };
    let r = be.engine.lock().unwrap().trace(&TraceQuery {
        session: q.session,
        prompt,
        since: q.since,
    });
    Ok(r.body)
}

/// 퇴근 일보 하루 집계 (`GET /daylog`와 같은 본문). day = today | yesterday | YYYY-MM-DD (없으면 today)
#[tauri::command]
pub async fn get_daylog(w: WebviewWindow, be: B<'_>, day: Option<String>) -> Result<Value, String> {
    let day = day.as_deref().unwrap_or("today");
    let r = be.engine.lock().unwrap().daylog(day);
    if r.status != 200 {
        daylog_err(w.label(), day, &r.body);
    }
    // HTTP(api.js의 json())처럼 오류도 {"error": …} 본문으로 돌려준다 → 두 백엔드에서 프론트 처리가 같다
    Ok(r.body)
}

/// 일보 오류는 파일 로그에 (프론트는 60초마다 다시 묻는다 → 같은 오류는 한 번만)
fn daylog_err(label: &str, day: &str, body: &Value) {
    static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    let msg = format!("get_daylog({day}) ← {label}: {body}");
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if *last != msg {
        wlog!("daylog", "{msg}");
        *last = msg;
    }
}

/// 그날 일보를 봤다고 기록 (`POST /daylog/seen`과 같음). 메인 창만
#[tauri::command]
pub async fn daylog_seen(w: WebviewWindow, be: B<'_>, day: String) -> Result<Value, String> {
    main_only(&w)?;
    let r = be.engine.lock().unwrap().daylog_seen(&day);
    // HTTP(api.js의 json())처럼 오류도 {"error": …} 본문으로 돌려준다 → 두 백엔드에서 프론트 처리가 같다
    Ok(r.body)
}

/// 저장할 파일 이름: 경로 구분자·제어 문자를 빼고 .png로 끝나게 (대화상자 기본값일 뿐, 실제 경로는 사용자가 고름)
pub fn png_name(name: &str) -> String {
    let base: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(80)
        .collect();
    let base = base.trim().trim_start_matches('.').to_string();
    let base = if base.is_empty() { "waitscape.png".to_string() } else { base };
    if base.to_ascii_lowercase().ends_with(".png") {
        base
    } else {
        format!("{base}.png")
    }
}

const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// 퇴근 일보 카드 이미지 저장(메인 창만): PNG 본문만 받고(8MB 이하) 저장 대화상자에서 고른 경로에 쓴다. 취소면 null
#[tauri::command]
pub async fn save_image(app: AppHandle, w: WebviewWindow, name: String, data: Vec<u8>) -> Result<Option<String>, String> {
    main_only(&w)?;
    if data.len() > 8 * 1024 * 1024 || !data.starts_with(PNG_MAGIC) {
        return Err("bad-image".into());
    }
    let mut d = app.dialog().file().set_file_name(png_name(&name)).add_filter("PNG", &["png"]);
    if let Ok(dir) = app.path().download_dir() {
        d = d.set_directory(dir);
    }
    let Some(p) = d.blocking_save_file().and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::write(&p, &data).map_err(|e| e.to_string())?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn get_settings(be: B) -> Value {
    serde_json::to_value(be.settings()).unwrap()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, w: WebviewWindow, be: B, patch: Value) -> Result<Value, String> {
    // 위젯 창은 회의 모드·눈치 모드 켜고 끄기만 바꿀 수 있다
    if w.label() != "main" && patch.as_object().is_none_or(|o| o.keys().any(|k| k != "quiet" && k != "nunchi")) {
        return Err("widget may only change quiet or nunchi".into());
    }
    save_patch(&app, &be, patch)
}

#[tauri::command]
pub fn get_brand() -> Value {
    serde_json::from_str(crate::BRAND).unwrap_or(Value::Null)
}

/// 내장(앱에 들어 있는 web/modes) + 사용자 모드 폴더
#[tauri::command]
pub fn list_modes(app: AppHandle, w: WebviewWindow, be: B) -> Value {
    // 창 코어가 시작할 때 한 번 부른다 → 위젯 웹뷰의 JS·IPC가 실제로 도는지 진단 (rescan 때도 한 줄)
    wlog!("page", "list_modes ← {} (코어 시작)", w.label());
    let res = app.asset_resolver();
    let read = |p: &str| res.get(p.to_string()).map(|a| a.bytes);
    let rules = wr_core::modes::rules();
    let builtin: Vec<String> = read("modes/index.json")
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("builtin").and_then(|b| b.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| d.as_str().map(String::from))
        .filter(|d| rules.mode_id.is_match(d))
        .collect();
    let mut out: Vec<Value> = builtin
        .iter()
        .map(
            |d| match read(&format!("modes/{d}/mode.json")).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                Some(m) => json!({"dir": d, "source": "builtin", "manifest": m}),
                None => json!({"dir": d, "source": "builtin", "manifest": null, "error": "mode.json을 읽을 수 없어요"}),
            },
        )
        .collect();
    let none = be.staging.join("__no_web__");
    let user = wr_core::modes::list_modes(&none, &be.user_modes, &be.home);
    if let Some(a) = user.get("modes").and_then(|m| m.as_array()) {
        out.extend(a.iter().cloned());
    }
    json!({"modes": out, "userDir": user.get("userDir"), "devDirs": []})
}

pub fn builtin_ids(app: &AppHandle) -> Vec<String> {
    app.asset_resolver()
        .get("modes/index.json".into())
        .and_then(|a| serde_json::from_slice::<Value>(&a.bytes).ok())
        .and_then(|v| v.get("builtin").and_then(|b| b.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| d.as_str().map(String::from))
        .collect()
}

/// 메인 창의 메모 준비 알림 등 (done/input/stall은 백엔드가 직접 보내므로 프론트는 보내지 않는다)
#[tauri::command]
pub fn notify(app: AppHandle, w: WebviewWindow, be: B, title: String, body: String) -> Result<(), String> {
    main_only(&w)?;
    let t: String = title.chars().take(140).collect();
    let b: String = body.chars().take(280).collect();
    os_notify(&app, &t, &b, be.settings().quiet);
    Ok(())
}

/// 미니 보기로 전환: 위젯 창을 띄우고 큰 창은 숨긴다 (메인 창의 📌 미니 보기·포켓 위에 띄우기)
/// async: Windows(WebView2)에서는 동기 명령 안에서 창을 만들면 메인 스레드가 막혀 멈춘다(Tauri 문서 'Create windows in async commands')
#[tauri::command]
pub async fn open_widget(app: AppHandle, mode_id: Option<String>) -> Result<bool, String> {
    wlog!(
        "widget",
        "open_widget 명령 진입 (모드 {mode_id:?}, 스레드 {})",
        crate::applog::thread()
    );
    if mode_id.as_deref().is_some_and(|m| !windows::WIDGET_MODES.contains(&m)) {
        return Err("v1: 위젯은 포켓·스튜디오 모드만".into());
    }
    // Ok(false) = 직전 전환 직후라 무시함(연타 가드, windows::SETTLE)
    windows::to_mini(&app, mode_id.as_deref()).map_err(|e| {
        wlog!("widget", "open_widget 실패 → 화면에 이유 표시: {e}");
        e.to_string()
    })
}

/// 미니 보기 끝: 위젯을 닫고 큰 창으로 복귀 (위젯의 ⤢ 크게 보기)
/// async: 큰 창을 다시 만들어야 할 때가 있어 open_widget과 같은 이유
#[tauri::command]
pub async fn close_widget(app: AppHandle) -> Result<(), String> {
    wlog!("widget", "close_widget 명령 진입 (스레드 {})", crate::applog::thread());
    let _ = windows::to_big(&app);
    Ok(())
}

/// 큰 창 설정 대화상자가 닫힘 → 미니 보기에서 열었던 거면 그 미니 보기로(아니면 아무것도 안 함). 메인 창만
#[tauri::command(async)]
pub fn return_mini(app: AppHandle, w: WebviewWindow) -> Result<bool, String> {
    main_only(&w)?;
    Ok(windows::return_mini(&app))
}

/// 큰 창에서 다른 화면 동작(모드 바꾸기 등)을 했다 → 설정을 닫아도 미니로 돌아가지 않음. 메인 창만
#[tauri::command]
pub fn clear_return_mini(w: WebviewWindow) -> Result<(), String> {
    main_only(&w)?;
    windows::clear_return_mini();
    Ok(())
}

/// 숨겨 둔 위젯 웹이 "다시 보임"을 받았다는 응답(없으면 2초 뒤 위젯을 새로 만듦 — windows::watch_ack). 위젯 창만
#[tauri::command]
pub fn widget_ack(w: WebviewWindow) -> Result<(), String> {
    if w.label() != "widget" {
        return Err("widget only".into());
    }
    windows::widget_ack();
    Ok(())
}

#[tauri::command]
pub fn widget_resize(app: AppHandle, w: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if w.label() != "widget" {
        return Err("widget only".into());
    }
    if !(width.is_finite() && height.is_finite()) {
        return Err("bad size".into());
    }
    windows::resize_widget(&app, width, height);
    Ok(())
}

#[tauri::command]
pub fn set_tray_modes(app: AppHandle, w: WebviewWindow, be: B, modes: Vec<Value>, current: String) -> Result<(), String> {
    main_only(&w)?;
    let clean: Vec<Value> = modes
        .into_iter()
        .take(30)
        .map(|m| {
            let s = |k: &str| {
                m.get(k)
                    .and_then(|x| x.as_str())
                    .map(|x| x.chars().take(40).collect::<String>())
                    .unwrap_or_default()
            };
            json!({"id": s("id"), "name": s("name"), "icon": s("icon")})
        })
        .collect();
    *be.tray_modes.lock().unwrap() = (clean, current.chars().take(40).collect());
    let app2 = app.clone();
    app.run_on_main_thread(move || crate::tray::refresh(&app2)).ok();
    Ok(())
}

/// 세션 cwd에서 터미널(또는 편집기) 열기. 멀티플렉서 세션(`jump.mux`, Orca·cmux)이면 그 터미널·워크스페이스·패널로.
/// result: "opened" | "unsupported" | "mux" | "mux-app" | "mux-launch" | "mux-off" | "mux-denied" (+ kind). 프론트는 unsupported·mux-off·mux-denied면 cwd를 복사
/// async + spawn_blocking: 멀티플렉서 CLI는 명령마다 최대 3초라 메인(UI) 스레드에서 돌리지 않는다
#[tauri::command]
pub async fn open_terminal(w: WebviewWindow, be: B<'_>, sid: String) -> Result<Value, String> {
    main_or_widget(&w)?;
    let sess = be
        .last
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.get("sessions").and_then(|x| x.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.get("sid").and_then(|x| x.as_str()) == Some(sid.as_str()));
    let cwd = sess
        .as_ref()
        .and_then(|s| s.get("cwd").and_then(|x| x.as_str()).map(String::from))
        .unwrap_or_default();
    let mux = sess.as_ref().and_then(|s| s.get("jump")).and_then(terminal::Mux::of);
    let (pref, home, cwd2, mux2) = (be.settings().terminal, be.home.clone(), cwd.clone(), mux.clone());
    let r = tauri::async_runtime::spawn_blocking(move || terminal::open(&cwd2, &pref, mux2.as_ref(), &home))
        .await
        .map_err(|e| e.to_string())?;
    let copy = matches!(r, "unsupported" | "mux-off" | "mux-denied");
    let kind = mux.as_ref().filter(|_| r.starts_with("mux")).map(|m| m.kind);
    Ok(json!({"result": r, "kind": kind, "cwd": if copy { json!(cwd) } else { Value::Null }}))
}

/* ---------- 훅 ---------- */

fn hook_paths(be: &Backend) -> hooks::HookPaths {
    hooks::HookPaths::new(&be.claude.root, &be.claude.settings)
}

#[tauri::command]
pub fn hooks_status(be: B) -> Value {
    let p = hook_paths(&be);
    let mut v = hooks::status(&p, &be.home);
    // 온보딩의 접힌 "자세히 보기"용: 켜면 추가될 항목 (읽기만)
    if let Ok((_, _, d)) = hooks::plan(&p, true) {
        let h = be.home.to_string_lossy();
        v["preview"] = json!(d.iter().map(|l| tilde(l, &h)).collect::<Vec<_>>());
    }
    v
}

/// 문자열 안의 홈 경로를 `~`로 줄인다. 경로 경계(`/` `\\` 또는 끝)에서만 바꾼다 (`/Users/<u>`가 `/Users/<u>x`를 건드리지 않게)
pub fn tilde(s: &str, home: &str) -> String {
    let h = home.trim_end_matches(['/', '\\']);
    if h.is_empty() {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(h) {
        let after = &rest[i + h.len()..];
        let before_ok = i == 0
            || !rest[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.');
        let after_ok = after.is_empty()
            || after.starts_with(['/', '\\'])
            || !after
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.');
        out.push_str(&rest[..i]);
        out.push_str(if before_ok && after_ok { "~" } else { h });
        rest = after;
    }
    out.push_str(rest);
    out
}

/// 훅 설치/제거: 바뀔 내용을 **네이티브 확인 대화상자**로 보여 주고 동의를 받은 뒤에만 쓴다.
/// 예외: 첫 실행 온보딩의 [Claude Code 훅 켜기] 버튼(`onboarding`) — 그 버튼이 동의이므로 확인 창 없이 설치만 한다(백업·원자적 쓰기는 같음).
/// 생략은 백엔드 표시 파일(`hooks::ONBOARDING_MARK`)로 앱 평생 한 번만, 그 뒤 `onboarding:true`는 확인 창으로 간다
fn hooks_change(app: &AppHandle, be: &Backend, install: bool, ask: bool) -> Result<Value, String> {
    let p = hook_paths(be);
    let (loaded, next, diff) = hooks::plan(&p, install)?;
    if diff.is_empty() {
        return Ok(json!({"changed": false, "status": hooks::status(&p, &be.home)}));
    }
    if !ask {
        return hooks_write(be, &p, &loaded, &next, install);
    }
    let en = be.settings().lang == "en";
    let short = |s: &str| tilde(s, &be.home.to_string_lossy());
    let lines: Vec<String> = diff.iter().take(12).map(|l| short(l)).collect();
    let msg = if en {
        format!(
            "{} Claude Code hooks in {}.\n\nA backup is saved next to it (settings.json.bak-waiting-room-<time>). Other hooks are kept.\n\n{}",
            if install { "Add" } else { "Remove" },
            short(&p.settings.to_string_lossy()),
            lines.join("\n")
        )
    } else {
        format!(
            "{}의 Claude Code 훅을 {}.\n\n바꾸기 전에 같은 폴더에 백업(settings.json.bak-waiting-room-<시각>)을 만들고, 다른 훅은 그대로 둡니다.\n\n{}",
            short(&p.settings.to_string_lossy()),
            if install { "추가합니다" } else { "제거합니다" },
            lines.join("\n")
        )
    };
    let ok = app
        .dialog()
        .message(msg)
        .title(if en { "Hooks" } else { "훅 설정" })
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            (if install {
                if en {
                    "Install"
                } else {
                    "설치"
                }
            } else if en {
                "Remove"
            } else {
                "제거"
            })
            .into(),
            (if en { "Cancel" } else { "취소" }).into(),
        ))
        .blocking_show();
    if !ok {
        return Ok(json!({"changed": false, "cancelled": true, "status": hooks::status(&p, &be.home)}));
    }
    hooks_write(be, &p, &loaded, &next, install)
}

fn hooks_write(
    be: &Backend,
    p: &hooks::HookPaths,
    loaded: &wr_core::hooks_config::Loaded,
    next: &Value,
    install: bool,
) -> Result<Value, String> {
    let r = hooks::apply(p, loaded, next, install)?;
    be.kick();
    Ok(json!({
        "changed": r.changed,
        "backup": r.backup.map(|b| tilde(&b.to_string_lossy(), &be.home.to_string_lossy())),
        "status": hooks::status(p, &be.home),
    }))
}

#[tauri::command]
pub async fn hooks_install(app: AppHandle, w: WebviewWindow, be: B<'_>, onboarding: Option<bool>) -> Result<Value, String> {
    main_only(&w)?;
    // 확인 창 생략은 백엔드 기록(앱 설정 폴더의 표시 파일)으로 딱 한 번. 웹 localStorage는 판단에 쓰지 않는다
    let marker = be.settings_path.with_file_name(hooks::ONBOARDING_MARK);
    let skip = onboarding == Some(true) && hooks::take_onboarding_skip(&marker);
    hooks_change(&app, &be, true, !skip)
}

#[tauri::command]
pub async fn hooks_uninstall(app: AppHandle, w: WebviewWindow, be: B<'_>) -> Result<Value, String> {
    main_only(&w)?;
    hooks_change(&app, &be, false, true)
}

/* ---------- MCP 보고 연결 (Claude Code · Codex · Antigravity) ---------- */

fn mcp_paths(be: &Backend) -> mcpc::McpPaths {
    let reports = wr_core::providers::mcp::McpConfig::from_env(&wr_core::paths::OsEnv, &be.claude).path;
    mcpc::McpPaths::new(&be.home, &be.claude.root, &be.claude.settings, &hook_paths(be).bin, &reports).find_clis()
}

fn mcp_cli(cli: &str) -> Result<Cli, String> {
    Cli::parse(cli).ok_or_else(|| "알 수 없는 CLI".to_string())
}

#[tauri::command]
pub async fn mcp_status(w: WebviewWindow, be: B<'_>) -> Result<Value, String> {
    main_only(&w)?;
    let mut v = mcpc::status(&mcp_paths(&be));
    v["sidecar"] = json!(hooks::sidecar_ok(&hook_paths(&be)));
    Ok(v)
}

/// 바뀔 내용 미리보기 (아무것도 쓰지 않음)
#[tauri::command]
pub async fn mcp_plan(w: WebviewWindow, be: B<'_>, cli: String, connect: bool, auto_allow: bool) -> Result<Value, String> {
    main_only(&w)?;
    let p = mcp_paths(&be);
    Ok(mcpc::plan(&p, mcp_cli(&cli)?, connect, auto_allow)?.to_json(&p.home))
}

/// 연결/해제: 계획을 다시 계산해 **네이티브 확인 창**으로 보여 주고 동의를 받은 뒤에만 쓴다(웹 쪽 미리보기는 안내용, 우회 불가)
#[tauri::command]
pub async fn mcp_apply(app: AppHandle, w: WebviewWindow, be: B<'_>, cli: String, connect: bool, auto_allow: bool) -> Result<Value, String> {
    main_only(&w)?;
    if connect && !be.settings().mcp_reports {
        return Err("MCP 보고를 먼저 켜 주세요".into());
    }
    let cli = mcp_cli(&cli)?;
    let p = mcp_paths(&be);
    let plan = mcpc::plan(&p, cli, connect, auto_allow)?;
    let en = be.settings().lang == "en";
    let short = |s: &str| tilde(s, &be.home.to_string_lossy());
    if !plan.is_empty() {
        // 우리 항목 줄만(문맥 줄 없음, 마스킹됨) + 그 외 내용 안내
        let all = plan.shown_lines(&p.home);
        let mut lines: Vec<String> = all.iter().take(16).cloned().collect();
        if all.len() > 16 {
            lines.push("…".into());
        }
        for n in &plan.notes {
            lines.push(
                match (n.as_str(), en) {
                    ("rest-same", false) => "그 외 내용은 바뀌지 않아요",
                    ("rest-same", true) => "Nothing else in the file changes",
                    ("reformat", false) => "그 외 줄은 서식(들여쓰기·줄바꿈)만 바뀌고 내용은 같아요",
                    ("reformat", true) => "Other lines only change formatting; their content stays the same",
                    ("new-file", false) => "파일이 없어 새로 만들어요(백업할 원본 없음)",
                    ("new-file", true) => "The file doesn't exist, so it is created (no original to back up)",
                    _ => continue,
                }
                .into(),
            );
        }
        let msg = if en {
            format!(
                "{} {} for Waitscape MCP reports.\n\nFiles are backed up next to them (*.bak-waiting-room-<time>) and only our entry is touched.\n\n{}",
                if connect { "Connect" } else { "Disconnect" },
                cli.name(),
                lines.join("\n")
            )
        } else {
            format!(
                "{}에 Waitscape MCP 보고를 {}.\n\n바꾸기 전에 같은 폴더에 백업(*.bak-waiting-room-<시각>)을 만들고, 우리 항목만 건드립니다.\n\n{}",
                cli.name(),
                if connect { "연결합니다" } else { "해제합니다" },
                lines.join("\n")
            )
        };
        let ok = app
            .dialog()
            .message(msg)
            .title(if en { "MCP reports" } else { "MCP 보고" })
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                (match (connect, en) {
                    (true, true) => "Connect",
                    (true, false) => "연결",
                    (false, true) => "Disconnect",
                    (false, false) => "해제",
                })
                .into(),
                (if en { "Cancel" } else { "취소" }).into(),
            ))
            .blocking_show();
        if !ok {
            return Ok(json!({"changed": false, "cancelled": true, "status": mcpc::status(&p)}));
        }
        if connect {
            hooks::ensure_bin(&hook_paths(&be))?;
        }
    }
    let notes = plan.notes.clone();
    let run = mcpc::default_runner(&be.home);
    let tag = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into());
    let r = mcpc::apply(&p, plan, &run, &tag)?;
    be.kick();
    Ok(json!({
        "changed": r.changed,
        "backups": r.backups.iter().map(|b| short(b)).collect::<Vec<_>>(),
        "notes": notes,
        "status": mcpc::status(&p),
    }))
}

/* ---------- 사용 한도 ---------- */

#[tauri::command]
pub fn usage_status(be: B) -> Value {
    be.usage_status()
}

/// [키체인에서 읽기] — 사용자가 버튼을 눌렀을 때만. 암호 창이 뜰 수 있다. 토큰은 메모리에만
#[tauri::command]
pub async fn usage_keychain(w: WebviewWindow, be: B<'_>) -> Result<Value, String> {
    main_only(&w)?;
    if !be.settings().usage_lookup {
        return Err("사용 한도 조회를 먼저 켜 주세요".into());
    }
    let now = be.engine.lock().unwrap().now();
    let r = be.usage.lock().unwrap().load_keychain(now);
    if let Err(code) = r {
        return Ok(json!({"ok": false, "err": code, "status": be.usage_status()}));
    }
    let p = be.usage.lock().unwrap().fetch(now);
    be.engine.lock().unwrap().set_polled("claude", p);
    be.kick();
    Ok(json!({"ok": true, "status": be.usage_status()}))
}

/* ---------- 모드 설치 ---------- */

#[tauri::command]
pub async fn pick_mode_source(app: AppHandle, w: WebviewWindow, kind: String) -> Result<Option<String>, String> {
    main_only(&w)?;
    let d = app.dialog().file();
    let p = if kind == "zip" {
        d.add_filter("zip", &["zip"]).blocking_pick_file()
    } else {
        d.blocking_pick_folder()
    };
    Ok(p.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn prepare_mode_install(app: AppHandle, w: WebviewWindow, be: B<'_>, path: String) -> Result<Value, String> {
    main_only(&w)?;
    let id = format!(
        "s{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let stage = be.staging.join(&id);
    let lang = be.settings().lang;
    let st = mode_install::prepare(std::path::Path::new(&path), &stage, &builtin_ids(&app), &be.user_modes, &lang)?;
    let mut info = st.info.clone();
    info["stage"] = json!(id);
    let mut stages = be.stages.lock().unwrap();
    // 오래된 스테이징 정리 (하나만 유지)
    for (_, old) in stages.drain() {
        std::fs::remove_dir_all(&old.dir).ok();
    }
    stages.insert(id, st);
    Ok(info)
}

#[tauri::command]
pub async fn commit_mode_install(w: WebviewWindow, be: B<'_>, stage: String) -> Result<Value, String> {
    main_only(&w)?;
    let st = be
        .stages
        .lock()
        .unwrap()
        .remove(&stage)
        .ok_or("설치 준비가 만료됐어요. 다시 선택해 주세요")?;
    // 실패해도 commit이 기존 판을 되돌려 두므로 스테이징은 지워도 된다
    let r = mode_install::commit(&st, &be.user_modes);
    std::fs::remove_dir_all(&st.dir).ok();
    r?;
    Ok(json!({"id": st.id}))
}

#[tauri::command]
pub fn cancel_mode_install(be: B, stage: String) {
    if let Some(st) = be.stages.lock().unwrap().remove(&stage) {
        std::fs::remove_dir_all(&st.dir).ok();
    }
}

#[tauri::command]
pub async fn delete_mode(app: AppHandle, w: WebviewWindow, be: B<'_>, id: String) -> Result<bool, String> {
    main_only(&w)?;
    let en = be.settings().lang == "en";
    let ok = app
        .dialog()
        .message(if en {
            format!("Delete the mode '{id}' from your modes folder?")
        } else {
            format!("사용자 모드 '{id}'를 지울까요? (폴더가 삭제돼요)")
        })
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            (if en { "Delete" } else { "삭제" }).into(),
            (if en { "Cancel" } else { "취소" }).into(),
        ))
        .blocking_show();
    if !ok {
        return Ok(false);
    }
    mode_install::remove(&be.user_modes, &id)?;
    Ok(true)
}

#[tauri::command]
pub fn open_modes_dir(w: WebviewWindow, be: B) -> Result<(), String> {
    main_only(&w)?;
    open_dir(&be.user_modes)
}

/// 앱 로그 폴더 열기 (설정 → 일반 → 앱 정보). 문제가 생기면 이 폴더의 waitscape.log를 보내 달라고 안내한다
#[tauri::command]
pub fn open_log_dir(w: WebviewWindow) -> Result<(), String> {
    main_only(&w)?;
    let dir = crate::applog::dir().ok_or("로그 폴더를 알 수 없어요")?;
    open_dir(&dir)
}

/// 오픈소스 라이선스 고지(설정 → 일반 → 앱 정보, #9). 릴리스 빌드가 넣은 THIRD_PARTY_LICENSES.html을 기본 브라우저로 연다.
/// 개발 빌드에는 build.rs가 만든 자리표시 파일이 들어 있다
#[tauri::command]
pub fn open_licenses(app: AppHandle, w: WebviewWindow) -> Result<(), String> {
    main_only(&w)?;
    let p = app
        .path()
        .resolve(LICENSES_FILE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !p.is_file() {
        return Err("이 빌드에는 라이선스 목록이 없어요".into());
    }
    open_dir_or_file(&p)
}

/// 번들 리소스 안 라이선스 고지 파일 이름 (tauri.conf.json bundle.resources·build.rs·release.yml과 같게)
pub const LICENSES_FILE: &str = "THIRD_PARTY_LICENSES.html";

/// 폴더를 OS 파일 관리자로 연다(없으면 만든다)
pub(crate) fn open_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    open_dir_or_file(dir)
}

/// OS 기본 프로그램으로 연다(폴더 → 파일 관리자, .html → 기본 브라우저). 인자 배열로만 넘긴다
fn open_dir_or_file(path: &std::path::Path) -> Result<(), String> {
    let prog = if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(prog).arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, w: WebviewWindow, be: B, on: bool) -> Result<Value, String> {
    main_only(&w)?;
    save_patch(&app, &be, json!({"autostart": on}))
}

/* ---------- 앱 정보·업데이트 ---------- */

/// 앱 버전과 이 빌드에 들어 있는 기능(빌드 플레이버). 화면은 꺼진 기능의 UI를 숨긴다
#[tauri::command]
pub fn app_info(app: AppHandle) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "features": {
            "updater": updater::compiled(),
            "terminalJump": cfg!(feature = "terminal-jump"),
        },
        "updateReady": updater::ready(&app),
        "debug": cfg!(debug_assertions),
    })
}

/// 창 우클릭 메뉴(네이티브, ctxmenu.rs). sid = 우클릭한 자리의 세션(있으면), title = 비활성 제목 줄(스튜디오 직원 이름표 등).
/// async = 메인 스레드 밖에서 부르고 메뉴 표시는 tauri가 메인 스레드로(WebView2 교착 규칙)
#[tauri::command(async)]
pub fn context_menu(app: AppHandle, w: WebviewWindow, sid: Option<String>, title: Option<String>) -> Result<(), String> {
    main_or_widget(&w)?;
    crate::ctxmenu::popup(&app, &w, sid, title)
}

/// 메뉴와 같은 동작을 웹 버튼에서(위젯의 ⚙ = 큰 화면 + 설정). 허용된 것만
#[tauri::command(async)]
pub fn menu_action(app: AppHandle, w: WebviewWindow, id: String) -> Result<(), String> {
    main_or_widget(&w)?;
    if !matches!(id.as_str(), "settings" | "settings-mini" | "open") {
        return Err("not allowed".into());
    }
    crate::tray::on_menu(&app, &id);
    Ok(())
}

/// 🙈 눈치 모드 단축키 상태 `{ key, ok, err }` (다른 앱이 선점하면 err). 메인 창만.
/// async = 메인 스레드 밖에서(단축키 등록이 메인 스레드 작업을 기다리는 동안 상태를 물어도 교착 없음)
#[tauri::command(async)]
pub fn nunchi_status(app: AppHandle, w: WebviewWindow) -> Result<Value, String> {
    main_only(&w)?;
    Ok(crate::nunchi::status(&app))
}

/// 🙈 단축키 다시 등록(키가 같아도 — 설정 화면 [다시 시도]). 결과 상태를 돌려준다. 메인 창만
#[tauri::command(async)]
pub fn nunchi_retry(app: AppHandle, w: WebviewWindow) -> Result<Value, String> {
    main_only(&w)?;
    crate::nunchi::apply_key(&app, true);
    Ok(crate::nunchi::status(&app))
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Value {
    updater::status(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle, w: WebviewWindow) -> Result<Value, String> {
    main_only(&w)?;
    Ok(updater::check_now(&app).await)
}

/// 사용자가 누른 [지금 업데이트]: 내려받기·서명 검증·설치 후 다시 시작 (성공하면 응답 전에 앱이 다시 시작됨)
#[tauri::command]
pub async fn update_install(app: AppHandle, w: WebviewWindow) -> Result<(), String> {
    main_only(&w)?;
    updater::install(app).await
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        get_state,
        get_trace,
        get_daylog,
        daylog_seen,
        save_image,
        get_settings,
        set_settings,
        get_brand,
        list_modes,
        notify,
        open_widget,
        close_widget,
        widget_ack,
        return_mini,
        clear_return_mini,
        widget_resize,
        set_tray_modes,
        open_terminal,
        hooks_status,
        hooks_install,
        hooks_uninstall,
        mcp_status,
        mcp_plan,
        mcp_apply,
        usage_status,
        usage_keychain,
        pick_mode_source,
        prepare_mode_install,
        commit_mode_install,
        cancel_mode_install,
        delete_mode,
        open_modes_dir,
        open_log_dir,
        open_licenses,
        autostart_set,
        app_info,
        nunchi_status,
        nunchi_retry,
        context_menu,
        menu_action,
        update_status,
        update_check,
        update_install,
    ]
}

#[cfg(test)]
mod tests {
    use super::{png_name, tilde};

    #[test]
    fn png_name_is_a_plain_file_name() {
        assert_eq!(png_name("waitscape-일보-2026-10-23.png"), "waitscape-일보-2026-10-23.png");
        assert_eq!(png_name("../../etc/passwd"), "etcpasswd.png");
        assert_eq!(png_name("a/b\\c:d*?.PNG"), "abcd.PNG");
        assert_eq!(png_name(".hidden"), "hidden.png");
        assert_eq!(png_name("\u{0}\n"), "waitscape.png");
        assert_eq!(png_name(&"x".repeat(200)).len(), 84);
    }

    #[test]
    fn tilde_respects_path_boundary() {
        let h = "/Users/<u>";
        assert_eq!(tilde("/Users/<u>/.claude/settings.json", h), "~/.claude/settings.json");
        assert_eq!(tilde("/Users/alex/.claude/settings.json", h), "/Users/alex/.claude/settings.json");
        assert_eq!(tilde("/Users/<u>", h), "~");
        assert_eq!(tilde("- Stop: /Users/<u>/b /Users/<u>x/b", h), "- Stop: ~/b /Users/<u>x/b");
        assert_eq!(tilde("/Users/<u>/x", ""), "/Users/<u>/x");
        assert_eq!(tilde("C:\\Users\\<u>\\x", "C:\\Users\\<u>"), "~\\x");
        assert_eq!(tilde("C:\\Users\\<u>x\\x", "C:\\Users\\<u>"), "C:\\Users\\<u>x\\x");
    }
}

//! 창 구성 (ARCHITECTURE §3.3): `main`(모드 화면, 닫기 = 숨김) / `widget`(위젯 창 = 포켓 또는 스튜디오 미니 보기: 항상 위·무테·투명·작업 표시줄 없음).
//! 둘은 **전환**이다: 큰 화면(main만 보임) ↔ 미니 보기(widget만, main은 숨김). 미니 보기 여부는 설정 `widget`에 남아 재시작에도 이어진다.
//! 두 창 모두 **내비게이션 정책**을 건다: 앱 문서(tauri://localhost)와 외부 모드 iframe(wrmode://localhost) 말고는 이동 거부.
//! macOS WKWebView는 하위 frame 이동도 `decidePolicyForNavigationAction`으로 오므로(wry `navigation_handler`)
//! 샌드박스 iframe이 `location.href = "https://…?데이터"`로 자기 자신을 옮기는 탈출을 여기서 막는다(브라우저 버전의 알려진 한계).
//! Windows(WebView2)는 wry가 메인 frame만 거르므로 하위 frame은 P4에서 `FrameNavigationStarting`으로 보강한다.

use crate::applog;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

/// 창 build·전환이 이 시간 안에 안 끝나면 "멈춤 의심" 로그 (Windows WebView2 교착 진단)
const STALL: Duration = Duration::from_secs(5);

/// 허용하는 문서 주소 — **이 플랫폼의 커스텀 프로토콜 형태만** 정확히 일치시킨다.
pub fn nav_allowed(u: &Url) -> bool {
    nav_allowed_on(u, cfg!(windows))
}

/// - macOS/Linux: `tauri://localhost/…`, `wrmode://localhost/…`
/// - Windows(WebView2): `http(s)://tauri.localhost/…`, `http(s)://wrmode.localhost/…`
///
/// 포트·사용자 정보가 붙은 주소는 거부한다. macOS에서도 `*.localhost`는 127.0.0.1로 풀리므로
/// `http://wrmode.localhost:8080/…`을 허용하면 샌드박스 모드가 로컬 서버로 데이터를 실어 보낼 수 있다.
pub fn nav_allowed_on(u: &Url, windows: bool) -> bool {
    if u.about_blank_like() {
        return true;
    }
    if u.port().is_some() || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    match (windows, u.scheme()) {
        (false, "tauri" | "wrmode") => u.host_str() == Some("localhost"),
        (true, "http" | "https") => matches!(u.host_str(), Some("tauri.localhost" | "wrmode.localhost")),
        _ => false,
    }
}

trait AboutBlank {
    fn about_blank_like(&self) -> bool;
}
impl AboutBlank for Url {
    fn about_blank_like(&self) -> bool {
        self.scheme() == "about" && matches!(self.path(), "blank" | "srcdoc")
    }
}

fn guard<'a>(
    app: &AppHandle,
    b: WebviewWindowBuilder<'a, Wry, AppHandle>,
    label: &'static str,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let a = app.clone();
    b.on_navigation(move |u| {
        let ok = nav_allowed(u);
        #[cfg(debug_assertions)]
        wlog!(
            "nav",
            "{label} {}://{}{} → {}",
            u.scheme(),
            u.host_str().unwrap_or(""),
            u.path(),
            if ok { "허용" } else { "거부" }
        );
        if !ok {
            wlog!("nav", "내비게이션 거부({label}): {}://{}", u.scheme(), u.host_str().unwrap_or(""));
            // 외부 모드가 탈출을 시도했을 수 있음 → 코어가 그 모드를 끈다
            a.emit_to(label, "nav-blocked", json_url(u)).ok();
        }
        ok
    })
    .on_new_window(|u, _| {
        wlog!("nav", "새 창 거부: {}://{}", u.scheme(), u.host_str().unwrap_or(""));
        NewWindowResponse::Deny
    })
    // 웹뷰가 실제로 문서를 불러왔는지 (위젯이 빈 창·안 뜸 진단). 쿼리는 남기지 않는다
    .on_page_load(|w, p| {
        let u = p.url();
        let ev = match p.event() {
            PageLoadEvent::Started => "로드 시작",
            PageLoadEvent::Finished => "로드 끝",
        };
        wlog!(
            "page",
            "{} {ev} {}://{}{}",
            w.label(),
            u.scheme(),
            u.host_str().unwrap_or(""),
            u.path()
        );
    })
}

fn json_url(u: &Url) -> serde_json::Value {
    // 쿼리(유출하려던 데이터일 수 있음)는 넘기지 않는다
    serde_json::json!({ "scheme": u.scheme(), "host": u.host_str() })
}

/// 지금 보이는 화면. 큰 창과 미니 창은 동시에 보이지 않는다
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    /// 큰 화면: main 창만
    Big,
    /// 미니 보기: widget 창만 (main은 숨김 — 닫지 않으므로 상태·설정은 그대로)
    Mini,
}

impl View {
    /// 앱 시작: 마지막이 미니 보기였으면(설정 `widget`) 미니로
    pub fn at_start(widget_setting: bool) -> Self {
        if widget_setting {
            View::Mini
        } else {
            View::Big
        }
    }
    /// 트레이 "미니 보기" 체크를 눌렀을 때 갈 화면
    pub fn toggled(self) -> Self {
        match self {
            View::Big => View::Mini,
            View::Mini => View::Big,
        }
    }
    /// (main 보임, widget 열림)
    pub fn windows(self) -> (bool, bool) {
        (self == View::Big, self == View::Mini)
    }
}

pub fn create_main(app: &AppHandle, visible: bool) -> tauri::Result<WebviewWindow> {
    let b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title(crate::nunchi::title_for(app, false))
        .inner_size(1100.0, 760.0)
        .min_inner_size(420.0, 320.0)
        .visible(visible);
    let w = guard(app, b, "main").build()?;
    crate::winpos::attach(app, &w);
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            // 닫기 = 숨김 (트레이에 상주, 알림은 계속)
            api.prevent_close();
            w2.hide().ok();
        }
    });
    Ok(w)
}

pub fn show_main(app: &AppHandle) {
    let w = match app.get_webview_window("main") {
        Some(w) => w,
        None => match create_main(app, true) {
            Ok(w) => w,
            Err(e) => {
                wlog!("main", "메인 창 다시 만들기 실패: {e}");
                return;
            }
        },
    };
    w.unminimize().ok();
    w.show().ok();
    w.set_focus().ok();
}

/// 미니 보기 여부를 설정에 남긴다(바뀔 때만 → save_patch가 트레이 체크를 갱신하고 `settings`를 퍼뜨림)
fn persist(app: &AppHandle, mini: bool) {
    let Some(be) = app.try_state::<std::sync::Arc<crate::backend::Backend>>() else {
        return;
    };
    if be.settings().widget != mini {
        crate::commands::save_patch(app, &be, serde_json::json!({ "widget": mini })).ok();
    }
}

/* ---------- 큰 화면 ↔ 미니 보기 전환 가드 ----------
⌘2·트레이·버튼·우클릭이 연달아 오면 위젯을 띄웠다 숨겼다 하는 사이 WebKit이 망가질 수 있다(실기기 크래시 #60: 위젯 WKWebView를
닫아 파괴한 직후 RemoteScrollingCoordinatorProxy가 그 뷰의 대기 중 스크롤 업데이트를 읽어 SIGSEGV). 그래서
① 위젯은 파괴하지 않고 숨겼다가 다시 쓰고 ② 실제로 화면이 바뀌는 전환은 하나씩, 끝난 뒤 SETTLE 동안은 무시한다(한 곳: 여기) */
pub const SETTLE: Duration = Duration::from_millis(350);

/// 전환 가드 상태: 진행 중인가, 마지막 전환이 끝난 시각
#[derive(Default)]
pub struct Gate {
    busy: bool,
    last_end: Option<Instant>,
}

/// 새 전환을 받아도 되나(순수 함수): 진행 중이 아니고, 마지막 전환이 끝난 지 settle 이상 지났을 때
pub fn gate_allows(busy: bool, since_last: Option<Duration>, settle: Duration) -> bool {
    !busy && since_last.is_none_or(|d| d >= settle)
}

static GATE: Mutex<Gate> = Mutex::new(Gate {
    busy: false,
    last_end: None,
});

/// 화면을 바꾸는 전환 하나를 가드 안에서. 막히면 false(로그). f가 panic해도 busy는 풀린다(drop 가드)
fn guarded(what: &str, f: impl FnOnce()) -> bool {
    guarded_on(&GATE, SETTLE, what, f)
}

fn guarded_on(gate: &Mutex<Gate>, settle: Duration, what: &str, f: impl FnOnce()) -> bool {
    {
        let mut g = gate.lock().unwrap_or_else(|e| e.into_inner());
        if !gate_allows(g.busy, g.last_end.map(|t| t.elapsed()), settle) {
            wlog!("widget", "{what} 무시 (직전 전환 중이거나 {} ms 안)", settle.as_millis());
            return false;
        }
        g.busy = true;
    }
    struct Release<'a>(&'a Mutex<Gate>);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
            g.busy = false;
            g.last_end = Some(Instant::now());
        }
    }
    let _release = Release(gate);
    f();
    true
}

/// 지금 미니 보기인가(위젯 창이 있고 보임)
fn widget_shown(app: &AppHandle) -> bool {
    app.get_webview_window("widget").is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// 미니 보기로: 위젯을 먼저 띄운 뒤 큰 창을 숨긴다(창이 하나도 안 보이는 순간이 없게). 위젯을 못 띄우면 큰 창은 그대로.
/// 이미 미니 보기면(모드만 바꾸기) 가드 없이, 실제로 화면이 바뀌면 전환 가드 안에서(연타 무시). Ok(false) = 가드에 막혀 아무것도 안 함
pub fn to_mini(app: &AppHandle, mode: Option<&str>) -> tauri::Result<bool> {
    if widget_shown(app) {
        return open_widget(app, mode).map(|_| true);
    }
    let mut r = Ok(());
    if !guarded("미니 보기 전환", || r = to_mini_now(app, mode)) {
        return Ok(false);
    }
    r.map(|_| true)
}

fn to_mini_now(app: &AppHandle, mode: Option<&str>) -> tauri::Result<()> {
    wlog!("widget", "미니 보기로 (모드 {}, 스레드 {})", mode.unwrap_or("-"), applog::thread());
    let t = applog::watch("widget", "미니 보기 전환", STALL);
    if let Err(e) = open_widget(app, mode) {
        wlog!("widget", "위젯을 못 띄워 큰 창은 그대로: {e}");
        return Err(e);
    }
    match app.get_webview_window("main").map(|w| w.hide()) {
        Some(Ok(())) => wlog!("widget", "main 숨김"),
        Some(Err(e)) => wlog!("widget", "main 숨기기 실패: {e}"),
        None => wlog!("widget", "main 창 없음 (숨길 것 없음)"),
    }
    persist(app, true);
    wlog!("widget", "미니 보기 끝 ({} ms)", t.ms());
    Ok(())
}

/// 큰 화면으로: 큰 창을 보이고 위젯은 숨긴다 (트레이 "큰 화면"·설정…·모드 선택, Dock 클릭, 다시 실행, 위젯의 ⤢).
/// 이미 큰 화면이면 큰 창만 앞으로(가드 없음 — 설정…·모드 선택이 막히지 않게), 미니 보기에서 돌아올 때만 전환 가드
/// false = 가드에 막힘(뒤따르는 동작 — 설정 열기·모드 선택 — 도 건너뛸 것)
pub fn to_big(app: &AppHandle) -> bool {
    if !widget_shown(app) {
        show_main(app);
        persist(app, false);
        return true;
    }
    guarded("큰 화면 전환", || to_big_now(app))
}

fn to_big_now(app: &AppHandle) {
    wlog!("main", "큰 화면으로 (스레드 {})", applog::thread());
    let _t = applog::watch("main", "큰 화면 전환", STALL);
    show_main(app);
    persist(app, false);
    close_widget(app);
}

/// 시작 화면을 띄운다 (main은 setup에서 숨긴 채 만들어 두고 여기서 결정)
pub fn start(app: &AppHandle, view: View) {
    let (_, mini) = view.windows();
    if mini && to_mini_now(app, None).is_ok() {
        return;
    }
    show_main(app);
    persist(app, false);
}

/// 위젯 창에 띄울 수 있는 내장 모드 (mode.json `"widget": true`와 맞춘다)
pub const WIDGET_MODES: [&str; 2] = ["pocket", "studio"];

/// `mode`가 있으면 `widget.html#<mode>`. 없으면(앱 재시작·트레이) 프론트가 마지막에 띄운 모드를 고른다.
/// 이미 열려 있으면 해시만 바꾼다 → 위젯 코어가 hashchange에서 다시 불러온다
pub fn open_widget(app: &AppHandle, mode: Option<&str>) -> tauri::Result<()> {
    let mode = mode.filter(|m| WIDGET_MODES.contains(m));
    if let Some(w) = app.get_webview_window("widget") {
        // 숨겨 둔 위젯을 다시 씀(새로 만들지 않음). 모드가 다르면 해시만 바꿔 위젯 코어가 다시 불러온다
        wlog!("widget", "위젯 다시 보임 (모드 {})", mode.unwrap_or("-"));
        if let (Some(m), Ok(mut url)) = (mode, w.url()) {
            if url.fragment() != Some(m) {
                url.set_fragment(Some(m));
                if let Err(e) = w.navigate(url) {
                    wlog!("widget", "모드 바꾸기(해시) 실패: {e}");
                }
            }
        }
        crate::winpos::reposition(app, &w); // 숨긴 사이 모니터를 뺐으면 화면 안으로
        if let Err(e) = w.show() {
            wlog!("widget", "보이기 실패: {e}");
        }
        app.emit_to("widget", "widget-visible", true).ok(); // 위젯 웹: 애니메이션·갱신 다시 + ack(widget_ack)
        watch_ack(app);
        app.emit("widget", serde_json::json!({ "open": true })).ok();
        return Ok(());
    }
    let path = mode.map_or_else(|| "widget.html".to_string(), |m| format!("widget.html#{m}"));
    wlog!("widget", "새로 만듦: {path} (스레드 {})", applog::thread());
    let b = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App(path.into()))
        .title(crate::nunchi::title_for(app, true))
        .inner_size(300.0, 132.0)
        .min_inner_size(120.0, 40.0)
        .max_inner_size(820.0, 900.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .resizable(true)
        .focused(false)
        // 비활성(키 윈도가 아닌) 위젯에서도 첫 클릭이 바로 버튼에 먹게 (창 활성화용으로 버려지지 않게)
        .accept_first_mouse(true);
    let w = {
        let t = applog::watch("widget", "위젯 build", STALL);
        let r = guard(app, b, "widget").build();
        match &r {
            Ok(_) => wlog!("widget", "build 성공 ({} ms)", t.ms()),
            Err(e) => wlog!("widget", "build 실패 ({} ms): {e}", t.ms()),
        }
        r?
    };
    crate::winpos::attach(app, &w);
    let a = app.clone();
    w.on_window_event(move |e| {
        // 어떤 길로 닫히든(✕·Cmd+W) 파괴하지 않고 숨긴 뒤 큰 화면으로 → 창이 하나도 안 보이는 상태를 만들지 않는다.
        // 앱 종료(app.exit)는 CloseRequested를 거치지 않으므로 미니 보기 설정은 남아 다음 시작이 미니가 된다
        if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            wlog!("widget", "위젯 닫기 요청 → 숨기고 큰 화면");
            show_main(&a);
            persist(&a, false);
            hide_widget(&a);
        }
    });
    app.emit("widget", serde_json::json!({ "open": true })).ok();
    Ok(())
}

/* ---------- 미니 보기에서 연 설정: 닫으면 미니 보기로 돌아가기 ----------
위젯 톱니·위젯 우클릭 "설정…"·위젯 ⌘,로 열면(tray "settings-mini") 그때 위젯 모드를 적어 두고, 큰 창 설정 대화상자가 닫히면
(commands::return_mini) 그 모드로 미니 보기. 그 사이 트레이·메뉴로 다른 화면 동작을 하면 지운다(원치 않는 복귀 방지) */
static RETURN_MINI: Mutex<Option<String>> = Mutex::new(None);

/// 미니에서 설정을 열었다: 돌아갈 위젯 모드(지금 위젯 해시)를 적어 둔다
pub fn mark_return_mini(app: &AppHandle) {
    let mode = app
        .get_webview_window("widget")
        .and_then(|w| w.url().ok())
        .and_then(|u| u.fragment().map(String::from));
    *RETURN_MINI.lock().unwrap_or_else(|e| e.into_inner()) = Some(mode.unwrap_or_default());
}

pub fn clear_return_mini() {
    RETURN_MINI.lock().unwrap_or_else(|e| e.into_inner()).take();
}

/// 설정이 닫힘: 적어 둔 게 있으면 미니 보기로(전환 가드에 막히면 SETTLE 뒤 한 번 더). 반환 = 복귀했나
pub fn return_mini(app: &AppHandle) -> bool {
    let Some(mode) = RETURN_MINI.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return false;
    };
    let mode = Some(mode.as_str()).filter(|m| !m.is_empty());
    wlog!("widget", "설정을 닫음 → 미니 보기로 돌아감 (모드 {})", mode.unwrap_or("-"));
    match to_mini(app, mode) {
        Ok(true) => true,
        Ok(false) => {
            std::thread::sleep(SETTLE);
            to_mini(app, mode).unwrap_or(false)
        }
        Err(e) => {
            wlog!("widget", "미니 보기 복귀 실패: {e}");
            false
        }
    }
}

/* 숨겨 둔 WKWebView의 콘텐츠 프로세스가 그 사이 죽었으면(메모리 압박 등) 다시 보여도 빈 창이다 →
다시 보일 때 웹이 widget_ack을 보내고, 2초 안에 없으면 그 위젯을 버리고 새로 만든다(로그). 보이는 창이라 파괴해도 대기 중인 갱신이 없다 */
static ACK: Mutex<Option<Instant>> = Mutex::new(None);

/// 위젯 웹이 "다시 보임"을 받았다(commands::widget_ack)
pub fn widget_ack() {
    *ACK.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
}

fn watch_ack(app: &AppHandle) {
    let shown_at = Instant::now();
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        let ok = ACK.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| t >= shown_at);
        if ok || !widget_shown(&a) {
            return;
        }
        wlog!("widget", "다시 보인 위젯이 2초 안에 응답 없음 → 새로 만듦");
        let mode = a
            .get_webview_window("widget")
            .and_then(|w| w.url().ok())
            .and_then(|u| u.fragment().map(String::from));
        if let Some(w) = a.get_webview_window("widget") {
            w.destroy().ok();
        }
        if let Err(e) = open_widget(&a, mode.as_deref()) {
            wlog!("widget", "위젯 다시 만들기 실패 → 큰 화면: {e}");
            to_big_now(&a);
        }
    });
}

/// 위젯을 숨긴다(파괴하지 않음 — 위 SETTLE 주석의 WebKit 크래시). 다음 미니 보기는 같은 창을 다시 보인다.
/// Windows(WebView2)도 숨김·재사용이 안전하다: 창을 새로 만들지 않으니 이벤트 핸들러 안 창 생성 교착(0.2.2) 위험이 오히려 준다
pub fn close_widget(app: &AppHandle) {
    hide_widget(app);
}

fn hide_widget(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        if w.is_visible().unwrap_or(false) {
            app.emit_to("widget", "widget-visible", false).ok(); // 위젯 웹: 숨은 동안 애니메이션·갱신 멈춤
            match w.hide() {
                Ok(()) => wlog!("widget", "위젯 숨김"),
                Err(e) => wlog!("widget", "위젯 숨기기 실패: {e}"),
            }
            app.emit("widget", serde_json::json!({ "open": false })).ok();
        }
    }
}

/// 위젯이 내용에 맞춰 크기를 바꿀 때 (입력 필요 → 펼침, 해결 → 접힘). 논리 픽셀, 범위 제한
pub fn resize_widget(app: &AppHandle, w: f64, h: f64) {
    if let Some(win) = app.get_webview_window("widget") {
        let w = w.clamp(120.0, 820.0);
        let h = h.clamp(40.0, 900.0);
        win.set_size(tauri::LogicalSize::new(w, h)).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (주소, macOS/Linux 허용, Windows 허용)
    const TABLE: &[(&str, bool, bool)] = &[
        ("tauri://localhost/index.html", true, false),
        ("wrmode://localhost/_modes/demo/index.html", true, false),
        ("http://tauri.localhost/index.html", false, true),
        ("https://tauri.localhost/index.html", false, true),
        ("http://wrmode.localhost/_modes/demo/index.html", false, true),
        ("https://wrmode.localhost/_modes/demo/index.html", false, true),
        ("about:blank", true, true),
        ("about:srcdoc", true, true),
        // 포트가 붙은 localhost 계열 (회귀: 리뷰 C1)
        ("http://wrmode.localhost:8080/x?d=secret", false, false),
        ("https://tauri.localhost:3000/?d=1", false, false),
        ("tauri://localhost:1234/", false, false),
        ("wrmode://localhost:80/x", false, false),
        // 다른 플랫폼 형태·사용자 정보
        ("http://user:pw@wrmode.localhost/x", false, false),
        ("http://wrmode.localhost@evil.example/", false, false),
        // 그 밖
        ("https://evil.example/?d=secret", false, false),
        ("http://127.0.0.1:7777/state", false, false),
        ("http://localhost/", false, false),
        ("wrmode://evil.example/x", false, false),
        ("tauri://evil.example/", false, false),
        ("data:text/html,hi", false, false),
        ("javascript:alert(1)", false, false),
        ("file:///etc/hosts", false, false),
        ("http://tauri.localhost.evil.example/", false, false),
        ("http://evil.tauri.localhost/", false, false),
        ("about:config", false, false),
    ];

    #[test]
    fn view_switch() {
        // 시작: 마지막 설정대로, 큰 창과 위젯은 동시에 보이지 않는다
        assert_eq!(View::at_start(true), View::Mini);
        assert_eq!(View::at_start(false), View::Big);
        assert_eq!(View::Big.windows(), (true, false));
        assert_eq!(View::Mini.windows(), (false, true));
        // 트레이 "미니 보기" 체크 토글
        assert_eq!(View::Big.toggled(), View::Mini);
        assert_eq!(View::Mini.toggled(), View::Big);
        for v in [View::Big, View::Mini] {
            let (main, widget) = v.windows();
            assert!(main ^ widget, "{v:?}: 항상 창 하나만");
        }
    }

    #[test]
    fn transition_gate() {
        let s = SETTLE;
        assert!(gate_allows(false, None, s), "처음");
        assert!(!gate_allows(true, None, s), "진행 중");
        assert!(!gate_allows(false, Some(Duration::from_millis(100)), s), "직전 전환 직후(연타)");
        assert!(gate_allows(false, Some(Duration::from_millis(400)), s), "충분히 지난 뒤");
        assert!(gate_allows(false, Some(s), s));
        assert!((300..=400).contains(&(s.as_millis() as u32)));
    }

    #[test]
    fn gate_released_even_if_transition_panics() {
        let gate = Mutex::new(Gate::default());
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            guarded_on(&gate, Duration::ZERO, "t", || panic!("boom"))
        }));
        assert!(r.is_err());
        let g = gate.lock().unwrap_or_else(|e| e.into_inner());
        assert!(!g.busy && g.last_end.is_some(), "panic 뒤에도 busy가 풀림");
        drop(g);
        // 막힌 전환은 false, settle이 0이면 다시 받음
        let gate = Mutex::new(Gate::default());
        assert!(guarded_on(&gate, Duration::from_secs(60), "a", || {}));
        assert!(!guarded_on(&gate, Duration::from_secs(60), "b", || unreachable!()));
        assert!(guarded_on(&Mutex::new(Gate::default()), Duration::ZERO, "c", || {}));
    }

    #[test]
    fn return_mini_mark_and_clear() {
        *RETURN_MINI.lock().unwrap() = Some("studio".into());
        clear_return_mini();
        assert!(RETURN_MINI.lock().unwrap().is_none(), "다른 동작을 하면 복귀 표시를 지움");
    }

    #[test]
    fn navigation_policy() {
        for (url, mac, win) in TABLE {
            let u = Url::parse(url).unwrap();
            assert_eq!(nav_allowed_on(&u, false), *mac, "macOS/Linux: {url}");
            assert_eq!(nav_allowed_on(&u, true), *win, "Windows: {url}");
        }
    }
}

//! 백엔드 공유 상태와 백그라운드 루프 (ARCHITECTURE §3.2).
//! - `Engine`(wr-core)은 `Mutex` 하나. 파일 감시(notify, `watch_paths()`) 이벤트는 150ms 디바운스 후, 그리고 2초 tick마다
//!   `state()`를 만들어 **바뀐 때만**(`now` 제외 digest) `state` 이벤트를 모든 창에 보낸다. 10초마다 heartbeat.
//! - 같은 루프에서 상태 전이를 감지해 OS 알림(회의 모드면 무음, 🙈 눈치 모드면 담백한 문구·무음)을 보내고 트레이를 갱신한다 — 창이 닫혀 있어도 동작.
//! - 사용 한도 조회는 설정에서 동의했을 때만 별도 스레드에서 120초 주기(UsageClient의 백오프)로.

use crate::detect::{Detector, Kind};
use crate::settings::AppSettings;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use wr_core::providers::claude::usage::{TokenSource, UsageClient};
use wr_core::providers::mcp::{McpConfig, McpProvider};
use wr_core::{ClaudeConfig, ClaudeProvider, Engine, EngineConfig};

pub const DEBOUNCE: Duration = Duration::from_millis(150);
pub const TICK: Duration = Duration::from_secs(2);
pub const HEARTBEAT: Duration = Duration::from_secs(10);

pub struct Backend {
    pub engine: Mutex<Engine>,
    pub settings: Mutex<AppSettings>,
    pub settings_path: PathBuf,
    pub claude: ClaudeConfig,
    pub usage: Mutex<UsageClient>,
    pub user_modes: PathBuf,
    pub staging: PathBuf,
    pub home: PathBuf,
    pub detector: Mutex<Detector>,
    /// 마지막으로 보낸 state (트레이 요약·터미널 cwd 찾기)
    pub last: Mutex<Option<Value>>,
    pub stages: Mutex<HashMap<String, crate::mode_install::Staged>>,
    /// 트레이 모드 목록 [{id, name, icon}] + 현재 모드 (프론트가 알려 줌)
    pub tray_modes: Mutex<(Vec<Value>, String)>,
    kick: Mutex<Option<Sender<()>>>,
}

impl Backend {
    pub fn new(app_data: PathBuf, app_config: PathBuf) -> Backend {
        let env = wr_core::paths::OsEnv;
        let claude = ClaudeConfig::from_env(&env);
        let cfg = EngineConfig::from_env(&env);
        let home = PathBuf::from(&cfg.home);
        let settings_path = app_config.join("settings.json");
        let settings = AppSettings::load(&settings_path);
        let mut engine = Engine::new(cfg);
        // 퇴근 일보 일지: WAITING_ROOM_DAYLOG(off면 끔) 또는 <Claude 루트>/waiting-room/daylog (Python 서버와 같은 폴더·형식)
        engine.set_daylog(wr_core::daylog::dir_from_env(&env, &claude.root));
        engine.add(Box::new(ClaudeProvider::new(claude.clone())));
        // MCP 보고 리더: <Claude 루트>/waiting-room/reports.jsonl (WAITING_ROOM_REPORTS). 켜고 끄는 건 앱 설정(기본 꺼짐)
        engine.add(Box::new(McpProvider::new(McpConfig::from_env(&env, &claude))));
        engine.set_reports_on(settings.mcp_reports);
        engine.set_poll_on(settings.usage_lookup);
        engine.set_hide(&settings.hide_projects, settings.hide_builtin);
        let usage = UsageClient::new(claude.credentials.clone(), env!("CARGO_PKG_VERSION"));
        // 사용자 모드 폴더: WAITING_ROOM_MODES(개발·테스트) > 앱 데이터 폴더/modes (ARCHITECTURE Q3)
        let user_modes = std::env::var("WAITING_ROOM_MODES")
            .ok()
            .filter(|v| !v.is_empty())
            .map(|v| wr_core::paths::expand_tilde(&v, &home))
            .unwrap_or_else(|| app_data.join("modes"));
        // 업데이트 도중 앱이 꺼져 남은 .<id>.new-*/.<id>.old-* 정리 (기존 판이 비켜 있기만 하면 되돌린다)
        crate::mode_install::recover(&user_modes);
        Backend {
            engine: Mutex::new(engine),
            settings: Mutex::new(settings),
            settings_path,
            claude,
            usage: Mutex::new(usage),
            user_modes,
            staging: app_data.join("staging"),
            home,
            detector: Mutex::new(Detector::default()),
            last: Mutex::new(None),
            stages: Mutex::new(HashMap::new()),
            tray_modes: Mutex::new((vec![], String::new())),
            kick: Mutex::new(None),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }

    /// 다음 tick을 앞당긴다 (파일 변경·한도 갱신·설정 변경)
    pub fn kick(&self) {
        if let Some(tx) = self.kick.lock().unwrap().as_ref() {
            tx.send(()).ok();
        }
    }

    pub fn state_value(&self) -> Value {
        let st = self.engine.lock().unwrap().state();
        serde_json::to_value(&st).unwrap_or(Value::Null)
    }

    pub fn usage_status(&self) -> Value {
        let u = self.usage.lock().unwrap();
        let last = self.last.lock().unwrap();
        let poll = last.as_ref().and_then(|s| s.get("poll")).cloned().unwrap_or(Value::Null);
        json!({
            "on": self.settings.lock().unwrap().usage_lookup,
            "source": match u.source { TokenSource::None => "none", TokenSource::File => "file", TokenSource::Keychain => "keychain" },
            "err": poll.get("err").cloned().unwrap_or(Value::Null),
            "limitsTs": last.as_ref().and_then(|s| s.get("limits_ts")).cloned().unwrap_or(Value::Null),
            "keychain": cfg!(target_os = "macos"),
        })
    }
}

/// OS 알림 한 건. 회의 모드면 소리 없이.
pub fn os_notify(app: &AppHandle, title: &str, body: &str, quiet: bool) {
    // 제목에 프로젝트 이름이 들어가므로 파일 로그에는 남기지 않는다(디버그 빌드 stderr만)
    #[cfg(debug_assertions)]
    eprintln!("[waitscape] OS 알림{}: {title}", if quiet { "(무음)" } else { "" });
    let mut b = app.notification().builder().title(title).body(body);
    if !quiet {
        b = b.sound("default");
    }
    if let Err(e) = b.show() {
        wlog!("notify", "알림 실패: {e}");
    }
}

/// 시작 진단 한 줄(별도 스레드): 퇴근 일보 일지 사용 여부·폴더(`~`로)·폴더 읽기·오늘 완료 수.
/// 스튜디오 HUD의 🏃 퇴근·📋 일보는 오늘 완료가 1건 이상일 때만 보이므로 "안 보여요" 진단에 쓴다
pub fn log_daylog(be: Arc<Backend>) {
    std::thread::spawn(move || {
        let dir = be.engine.lock().unwrap().daylog_dir().map(|d| d.to_path_buf());
        let Some(dir) = dir else {
            wlog!("daylog", "일지 꺼짐 (WAITING_ROOM_DAYLOG=off)");
            return;
        };
        let read = match std::fs::read_dir(&dir) {
            Ok(rd) => format!("파일 {}개", rd.count()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "폴더 아직 없음(첫 완료 때 만듦)".into(),
            Err(e) => format!("폴더 읽기 실패: {e}"),
        };
        let r = be.engine.lock().unwrap().daylog("today");
        let today = match r.body.get("done").and_then(|d| d.as_u64()) {
            Some(n) => format!("오늘 {} 완료 {n}건", r.body.get("day").and_then(|d| d.as_str()).unwrap_or("?")),
            None => format!("오늘 집계 실패: {}", r.body.get("error").unwrap_or(&r.body)),
        };
        wlog!("daylog", "일지 켜짐 {} · {read} · {today}", dir.display());
    });
}

/// 파일 감시 + tick 루프 시작
pub fn start(app: &AppHandle, be: Arc<Backend>) {
    let (tx, rx) = channel::<()>();
    *be.kick.lock().unwrap() = Some(tx.clone());
    start_watcher(&be, tx);

    let app2 = app.clone();
    let be2 = be.clone();
    std::thread::Builder::new()
        .name("ws-engine".into())
        .spawn(move || {
            let mut last_digest = None;
            let mut last_emit = Instant::now() - HEARTBEAT;
            loop {
                match rx.recv_timeout(TICK) {
                    Ok(()) => {
                        // 디바운스: 150ms 동안 조용해질 때까지 모은다
                        while rx.recv_timeout(DEBOUNCE).is_ok() {}
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                let st = be2.engine.lock().unwrap().state();
                let d = st.digest();
                let changed = last_digest != Some(d);
                if !changed && last_emit.elapsed() < HEARTBEAT {
                    continue;
                }
                last_digest = Some(d);
                last_emit = Instant::now();
                let v = serde_json::to_value(&st).unwrap_or(Value::Null);
                app2.emit("state", &v).ok();
                if changed {
                    on_changed(&app2, &be2, &v);
                }
                *be2.last.lock().unwrap() = Some(v);
            }
        })
        .expect("engine thread");

    let be3 = be.clone();
    std::thread::Builder::new()
        .name("ws-usage".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));
            if !be3.settings.lock().unwrap().usage_lookup {
                continue;
            }
            let now = be3.engine.lock().unwrap().now();
            let polled = be3.usage.lock().unwrap().poll(now);
            if let Some(p) = polled {
                be3.engine.lock().unwrap().set_polled("claude", p);
                be3.kick();
            }
        })
        .expect("usage thread");
}

fn on_changed(app: &AppHandle, be: &Backend, v: &Value) {
    let s = be.settings();
    let alerts = be.detector.lock().unwrap().feed(v, &s.lang);
    for a in alerts {
        let on = match a.kind {
            Kind::Done => s.notify.done,
            Kind::Input => s.notify.input,
            Kind::Stall => s.notify.stall,
        };
        if on && s.nunchi {
            // 🙈 눈치 모드: 담백한 문구, 효과음 없음
            let (t, b) = a.plain(&s.lang);
            os_notify(app, &t, &b, true);
        } else if on {
            os_notify(app, &a.title, &a.body, s.quiet);
        }
    }
    crate::tray::update_summary(app, v);
}

fn start_watcher(be: &Arc<Backend>, tx: Sender<()>) {
    use notify::{RecursiveMode, Watcher};
    let paths = be.engine.lock().unwrap().watch_paths();
    let exts: Vec<&'static str> = paths.iter().flat_map(|p| p.exts.iter().copied()).collect();
    let tx2 = tx.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        let hit = ev.paths.iter().any(|p| {
            let name = p.to_string_lossy();
            exts.is_empty() || exts.iter().any(|e| name.ends_with(e))
        });
        if hit {
            tx2.send(()).ok();
        }
    });
    let Ok(mut w) = watcher else {
        wlog!("watch", "파일 감시를 시작하지 못했어요 — 2초 tick으로만 갱신");
        return;
    };
    for p in paths {
        // 아직 없는 경로(예: 훅을 켜기 전 events.jsonl)는 있는 부모 폴더를 얕게 본다
        let mut target = p.path.clone();
        let mut mode = if p.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        while !target.exists() {
            match target.parent() {
                Some(par) => {
                    target = par.to_path_buf();
                    mode = RecursiveMode::NonRecursive;
                }
                None => break,
            }
        }
        if target.exists() {
            if let Err(e) = w.watch(&target, mode) {
                wlog!("watch", "감시 실패 {}: {e}", target.display());
            }
        }
    }
    // 감시자는 앱이 끝날 때까지 살아 있어야 한다
    std::mem::forget(w);
    let _ = tx;
}

/// 앱 데이터 폴더들
pub fn dirs(app: &AppHandle) -> (PathBuf, PathBuf) {
    let p = app.path();
    (
        p.app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("waitscape")),
        p.app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("waitscape")),
    )
}

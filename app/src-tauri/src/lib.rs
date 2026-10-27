//! Waitscape 데스크톱 앱 (Tauri 2 셸, ARCHITECTURE §3·§4 P3).
//! 프론트는 저장소의 `web/` 그대로(frontendDist). 백엔드는 wr-core `Engine` + 파일 감시 push, 트레이, 포켓 위젯,
//! OS 알림, 🙈 눈치 모드(전역 단축키·nunchi.rs), 설정·훅 설치, 터미널 이동, `wrmode:` 샌드박스 모드 서빙·설치, 앱 안 업데이트(updater.rs), 진단용 파일 로그(applog.rs, `wlog!`).
//! 빌드 플레이버: cargo feature `updater`·`terminal-jump`(기본 켜짐). 끄면 해당 코드가 빠진다(docs/RELEASE.md).

#[macro_use]
pub mod applog;
mod backend;
pub mod commands;
mod ctxmenu;
pub mod detect;
#[cfg(debug_assertions)]
mod e2e;
pub mod hooks;
pub mod mcp_connect;
pub mod mode_install;
pub mod nunchi;
pub mod orca_find;
pub mod protocol;
pub mod settings;
pub mod terminal;
mod tray;
pub mod updater;
pub mod windows;
pub mod winpos;

use backend::Backend;
use std::sync::Arc;
use tauri::{Manager, RunEvent};

/// 앱 이름·식별자의 원본 (tauri.conf.json과 일치하는지 build.rs가 검사)
pub const BRAND: &str = include_str!("../../../brand.json");

pub fn brand_name() -> String {
    serde_json::from_str::<serde_json::Value>(BRAND)
        .ok()
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from))
        .unwrap_or_else(|| "Waitscape".into())
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = windows::to_big(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(nunchi::plugin())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .register_asynchronous_uri_scheme_protocol("wrmode", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let Some(be) = app.try_state::<Arc<Backend>>().map(|s| s.inner().clone()) else {
                responder.respond(protocol::to_response(
                    protocol::Served {
                        status: tauri::http::StatusCode::SERVICE_UNAVAILABLE,
                        body: vec![],
                        ctype: "text/plain",
                        csp: Some("default-src 'none'".into()),
                    },
                    false,
                ));
                return;
            };
            let method = req.method().as_str().to_string();
            let path = req.uri().path().to_string();
            std::thread::spawn(move || {
                let res = app.asset_resolver();
                let asset = |p: &str| res.get(p.to_string()).map(|a| a.bytes);
                let served = protocol::serve(&method, &path, &be.user_modes, &asset);
                responder.respond(protocol::to_response(served, method == "HEAD"));
            });
        })
        .invoke_handler(commands::handler())
        .setup(|app| {
            let h = app.handle().clone();
            // 파일 로그(진단)는 맨 먼저: 이후 단계의 실패도 남게. 폴더를 모르면 stderr만
            if let (Ok(dir), Ok(home)) = (h.path().app_log_dir(), h.path().home_dir()) {
                applog::init(dir, &home);
            }
            applog::hello(&h.package_info().version.to_string());
            let (data, config) = backend::dirs(&h);
            // 창 위치·크기(논리 좌표) — 창을 만들기 전에
            app.manage(winpos::WinPos::load(config.clone()));
            let be = Arc::new(Backend::new(data, config));
            // 이미 훅을 켠 사용자: 설치된 wr-hook을 이 버전의 sidecar로 조용히 맞춘다(별도 스레드, settings.json은 안 건드림)
            hooks::refresh_on_start(hooks::HookPaths::new(&be.claude.root, &be.claude.settings));
            app.manage(be.clone());
            app.manage(updater::Updates::default());
            // 큰 창은 숨긴 채 만들고, 마지막 화면(큰 화면/미니 보기)으로 시작
            windows::create_main(&h, false)?;
            tray::create(&h, be.clone())?;
            // 🙈 눈치 모드: 전역 단축키(작업 스레드에서 등록) + 창 제목
            nunchi::start(&h, be.settings().nunchi);
            windows::start(&h, windows::View::at_start(be.settings().widget));
            backend::log_daylog(be.clone());
            backend::start(&h, be);
            updater::start(&h);
            #[cfg(debug_assertions)]
            e2e::start(&h);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Waitscape를 시작하지 못했어요");

    app.run(|app, ev| match ev {
        // macOS Dock 아이콘 클릭 → 큰 화면 (미니 보기였다면 위젯을 닫고 큰 창 복귀).
        // 미니 창은 이미 항상 위에 떠 있어 "앞으로"가 할 일이 없고, Dock 클릭 = 앱 창 열기가 macOS의 관례
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            let _ = windows::to_big(app);
        }
        // 마지막 창이 닫혀도 트레이에 남는다(종료는 트레이 메뉴에서)
        RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
        RunEvent::ExitRequested { code: Some(c), .. } => wlog!("app", "종료 요청 (code {c})"),
        RunEvent::Exit => {
            // 창 위치 저장이 아직 대기 중(이동 직후 종료)이면 바로 쓴다
            if let Some(wp) = app.try_state::<winpos::WinPos>() {
                wp.flush();
            }
            wlog!("app", "종료");
        }
        _ => {}
    });
}

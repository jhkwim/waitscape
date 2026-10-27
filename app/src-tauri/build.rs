//! 1) brand.json ↔ tauri.conf.json(productName·identifier) 일치 검사 — 이름·식별자는 brand.json 한 곳에서 정한다.
//!    앱 버전은 Cargo.toml `[workspace.package] version` 하나가 원본이다. tauri.conf.json version이 다르면 빌드를 멈춘다
//!    (올릴 때는 `python3 scripts/version.py bump <버전>`이 함께 바꾼다. docs/RELEASE.md).
//! 2) sidecar(wr-hook)가 아직 없으면 자리표시 파일을 만든다(cargo test/clippy가 깨지지 않게).
//!    실제 바이너리는 `sh scripts/build_sidecar.sh`(cargo tauri dev/build가 자동 실행). 자리표시로는 훅 설치가 거부된다.
//! 3) 앱 명령 권한 목록(AppManifest) — capabilities/*.json에서 창별로 허용한다.

use std::path::Path;

pub const STUB_MARK: &str = "WAITSCAPE_SIDECAR_STUB";

const COMMANDS: &[&str] = &[
    "get_state",
    "get_trace",
    "get_daylog",
    "daylog_seen",
    "save_image",
    "get_settings",
    "set_settings",
    "get_brand",
    "list_modes",
    "notify",
    "open_widget",
    "close_widget",
    "widget_resize",
    "set_tray_modes",
    "open_terminal",
    "hooks_status",
    "hooks_install",
    "hooks_uninstall",
    "mcp_status",
    "mcp_plan",
    "mcp_apply",
    "usage_status",
    "usage_keychain",
    "pick_mode_source",
    "prepare_mode_install",
    "commit_mode_install",
    "cancel_mode_install",
    "delete_mode",
    "open_modes_dir",
    "open_log_dir",
    "autostart_set",
    "app_info",
    "nunchi_status",
    "nunchi_retry",
    "widget_ack",
    "return_mini",
    "clear_return_mini",
    "context_menu",
    "menu_action",
    "update_status",
    "update_check",
    "update_install",
];

fn main() {
    let brand: serde_json::Value = serde_json::from_str(&std::fs::read_to_string("../../brand.json").expect("brand.json")).unwrap();
    let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").unwrap()).unwrap();
    for (b, c) in [("name", "productName"), ("identifier", "identifier")] {
        assert_eq!(
            brand[b], conf[c],
            "brand.json의 {b}와 tauri.conf.json의 {c}가 달라요. brand.json을 기준으로 맞춰 주세요"
        );
    }
    let ver = std::env::var("CARGO_PKG_VERSION").unwrap();
    assert_eq!(
        conf["version"].as_str(),
        Some(ver.as_str()),
        "tauri.conf.json의 version이 Cargo.toml workspace 버전({ver})과 달라요. python3 scripts/version.py bump {ver} 로 맞춰 주세요"
    );
    println!("cargo:rerun-if-changed=../../brand.json");

    let triple = std::env::var("TARGET").unwrap();
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let side = format!("binaries/wr-hook-{triple}{ext}");
    if !Path::new(&side).exists() {
        std::fs::create_dir_all("binaries").unwrap();
        std::fs::write(
            &side,
            format!("#!/bin/sh\n# {STUB_MARK}: sh scripts/build_sidecar.sh 로 실제 wr-hook을 만드세요\nexit 0\n"),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&side, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        println!("cargo:warning=wr-hook sidecar가 없어 자리표시를 만들었어요 ({side}). 훅 설치를 하려면 sh scripts/build_sidecar.sh");
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri-build");
}

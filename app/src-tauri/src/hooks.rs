//! 훅 켜기·끄기 (앱 쪽): 번들된 sidecar `wr-hook`을 고정 경로(`<claude루트>/waiting-room/bin/wr-hook`)에 복사하고
//! `wr_core::hooks_config`로 settings.json을 백업 후 병합한다(ARCHITECTURE §5.1–5.2).
//! 고정 경로에 복사하는 이유: 앱을 옮기거나 업데이트해도 settings.json의 경로가 깨지지 않게.
//! 경로는 `ClaudeConfig`(= `CLAUDE_CONFIG_DIR` 존중)에서 오므로 테스트는 임시 폴더를 주입해서 한다.
//! 같은 바이너리가 MCP 보고 사이드카(`wr-hook mcp`)로 CLI 세션 내내 떠 있을 수 있다 → Windows에서는 실행 중인 exe를
//! 덮어쓸 수 없으므로 옛 파일을 비켜 놓고 새 파일을 넣는다(`wr_core::binswap` — Windows CI에서 테스트되는 코어 크레이트에 둠).
//! 앱 시작 시 자동 갱신(`refresh_bin`): settings.json에 우리 항목이 이미 있고 sidecar와 설치본이 다르면 바이너리만 바꾼다.
//! settings.json은 읽기만 한다 — 사용자가 이미 동의한 우리 파일만 교체.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use wr_core::hooks_config as hc;

pub const STUB_MARK: &[u8] = b"WAITSCAPE_SIDECAR_STUB";

#[derive(Clone, Debug)]
pub struct HookPaths {
    /// Claude Code 설정 루트(~/.claude 또는 CLAUDE_CONFIG_DIR). 없으면 Claude Code가 없다고 본다(온보딩 안내)
    pub root: PathBuf,
    pub settings: PathBuf,
    pub bin: PathBuf,
    /// 앱에 들어 있는 원본 (sidecar)
    pub sidecar: Option<PathBuf>,
}

impl HookPaths {
    pub fn new(claude_root: &Path, settings: &Path) -> HookPaths {
        let exe = if cfg!(windows) { "wr-hook.exe" } else { "wr-hook" };
        HookPaths {
            root: claude_root.to_path_buf(),
            settings: settings.to_path_buf(),
            bin: claude_root.join("waiting-room").join("bin").join(exe),
            // Tauri는 externalBin을 메인 실행 파일 옆에 target triple 없이 둔다 (mac: Contents/MacOS/wr-hook)
            sidecar: std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(exe))),
        }
    }

    pub fn cmd(&self) -> String {
        self.bin.to_string_lossy().into_owned()
    }
}

fn is_stub(p: &Path) -> bool {
    std::fs::read(p)
        .map(|b| b.len() < 4096 && b.windows(STUB_MARK.len()).any(|w| w == STUB_MARK))
        .unwrap_or(true)
}

pub fn sidecar_ok(p: &HookPaths) -> bool {
    p.sidecar.as_deref().is_some_and(|s| s.is_file() && !is_stub(s))
}

/// sidecar → 고정 경로 (내용이 다를 때만), 실행 권한, `--version`으로 동작 확인
pub fn ensure_bin(p: &HookPaths) -> Result<(), String> {
    let src = p
        .sidecar
        .as_deref()
        .filter(|_| sidecar_ok(p))
        .ok_or("앱에 wr-hook이 들어 있지 않아요 (개발 빌드라면 sh scripts/build_sidecar.sh 후 다시 빌드하세요)")?;
    let new = std::fs::read(src).map_err(|e| format!("wr-hook 읽기 실패: {}", e.kind()))?;
    if std::fs::read(&p.bin).ok().as_deref() != Some(&new[..]) {
        let dir = p.bin.parent().unwrap();
        std::fs::create_dir_all(dir).map_err(|e| format!("폴더 만들기 실패: {}", e.kind()))?;
        let tmp = dir.join(".wr-hook.tmp");
        std::fs::write(&tmp, &new).map_err(|e| format!("복사 실패: {}", e.kind()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.kind().to_string())?;
        }
        wr_core::binswap::swap_in(&tmp, &p.bin).map_err(|e| format!("복사 실패: {}", e.kind()))?;
    }
    let out = std::process::Command::new(&p.bin)
        .arg("--version")
        .output()
        .map_err(|e| format!("wr-hook 실행 실패: {}", e.kind()))?;
    if !out.status.success() || !String::from_utf8_lossy(&out.stdout).starts_with("wr-hook ") {
        return Err("wr-hook이 올바르게 실행되지 않아요".into());
    }
    Ok(())
}

pub fn status(p: &HookPaths, home: &Path) -> Value {
    let short = |x: &Path| {
        let s = x.to_string_lossy().to_string();
        let h = home.to_string_lossy().to_string();
        if !h.is_empty() && s.starts_with(&h) {
            format!("~{}", &s[h.len()..])
        } else {
            s
        }
    };
    let base = json!({
        "settingsPath": short(&p.settings),
        "binPath": short(&p.bin),
        "sidecar": sidecar_ok(p),
        "binInstalled": p.bin.is_file(),
        "claudeDir": p.root.is_dir(),
        "refreshError": REFRESH_ERR.lock().ok().and_then(|e| e.clone()),
    });
    match hc::load(&p.settings) {
        Ok(l) => {
            let st = hc::status(&l.value, &p.cmd());
            let mut v = base;
            v["status"] = serde_json::to_value(st).unwrap();
            v
        }
        Err(e) => {
            let mut v = base;
            v["error"] = json!(e.to_string());
            v
        }
    }
}

/// 바뀔 내용 (확인 대화상자에 보여 줌)
pub fn plan(p: &HookPaths, install: bool) -> Result<(hc::Loaded, Value, Vec<String>), String> {
    let l = hc::load(&p.settings).map_err(|e| e.to_string())?;
    let next = if install {
        hc::merged(&l.value, &p.cmd())
    } else {
        hc::removed(&l.value)
    };
    let d = hc::diff(&l.value, &next);
    Ok((l, next, d))
}

pub fn apply(p: &HookPaths, l: &hc::Loaded, next: &Value, install: bool) -> Result<hc::Report, String> {
    if install {
        ensure_bin(p)?;
        set_refresh_err(None);
    }
    let tag = chrono_tag();
    hc::write(&p.settings, l, next, &tag).map_err(|e| e.to_string())
}

/// 온보딩 확인 생략을 이미 썼다는 표시(앱 설정 폴더 — 웹뷰가 고칠 수 없는 곳)
pub const ONBOARDING_MARK: &str = "hooks-onboarding-used";

/// 온보딩 [훅 켜기]의 확인 창 생략을 **한 번만** 허용한다. 표시 파일을 원자적으로 새로 만들 수 있을 때만 true
/// (허용하는 즉시 기록 → 설치가 실패해도 다시 생략하지 않음). 이미 있거나 만들 수 없으면 false = 확인 창 경로
pub fn take_onboarding_skip(marker: &Path) -> bool {
    if let Some(d) = marker.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    std::fs::OpenOptions::new().write(true).create_new(true).open(marker).is_ok()
}

/// 시작 시 자동 갱신 결과
#[derive(Debug, PartialEq, Eq)]
pub enum Refresh {
    /// sidecar가 없거나 스텁(개발 빌드) — 아무것도 안 함
    NoSidecar,
    /// settings.json에 우리 훅 항목이 없음(동의 전) — 아무것도 안 함
    NotInstalled,
    /// 설치본이 sidecar와 같음
    Same,
    /// 설치본을 sidecar로 바꿈
    Updated,
}

/// 마지막 자동 갱신 실패(설정 → AI 연결에 안내). 훅을 다시 켜거나 갱신에 성공하면 지운다
static REFRESH_ERR: Mutex<Option<String>> = Mutex::new(None);

fn set_refresh_err(e: Option<String>) {
    if let Ok(mut g) = REFRESH_ERR.lock() {
        *g = e;
    }
}

/// 이미 훅을 켠 사용자의 wr-hook을 앱에 든 sidecar로 맞춘다. settings.json은 읽기만 한다
pub fn refresh_bin(p: &HookPaths) -> Result<Refresh, String> {
    if !sidecar_ok(p) {
        return Ok(Refresh::NoSidecar);
    }
    let installed = hc::load(&p.settings).is_ok_and(|l| hc::status(&l.value, &p.cmd()).installed);
    if !installed {
        return Ok(Refresh::NotInstalled);
    }
    let src = p.sidecar.as_deref().unwrap();
    let new = std::fs::read(src).map_err(|e| format!("wr-hook 읽기 실패: {}", e.kind()))?;
    if std::fs::read(&p.bin).ok().as_deref() == Some(&new[..]) {
        return Ok(Refresh::Same);
    }
    ensure_bin(p)?;
    Ok(Refresh::Updated)
}

/// 앱 시작: 별도 스레드에서 갱신(메인 스레드·시작을 막지 않음). 실패는 로그 + 설정 화면 안내
pub fn refresh_on_start(p: HookPaths) {
    std::thread::spawn(move || match refresh_bin(&p) {
        Ok(Refresh::Updated) => {
            set_refresh_err(None);
            wlog!("hooks", "wr-hook 갱신: {}", p.bin.display());
        }
        Ok(_) => {}
        Err(e) => {
            wlog!("hooks", "wr-hook 자동 갱신 실패: {e}");
            set_refresh_err(Some(e));
        }
    });
}

fn chrono_tag() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 실제 ~/.claude는 건드리지 않는다: 임시 루트를 주입
    #[test]
    fn install_uninstall_in_temp_root() {
        let root = std::env::temp_dir().join(format!("ws-hooks-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        let settings = root.join("settings.json");
        let orig = r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"say hi"}]}]},"theme":"dark"}"#;
        std::fs::write(&settings, orig).unwrap();
        // 가짜 sidecar: --version에 응답하는 스크립트
        let side = root.join("side-wr-hook");
        std::fs::write(&side, "#!/bin/sh\necho \"wr-hook 0.0.0\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&side, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut p = HookPaths::new(&root, &settings);
        p.sidecar = Some(side.clone());
        let (l, next, diff) = plan(&p, true).unwrap();
        assert_eq!(diff.len(), 9);
        let r = apply(&p, &l, &next, true).unwrap();
        assert!(r.changed && r.backup.as_ref().unwrap().exists());
        assert!(p.bin.is_file());
        let st = status(&p, &root);
        assert_eq!(st["status"]["complete"], true);
        assert_eq!(st["settingsPath"], "~/settings.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "say hi", "기존 훅 보존");
        let (l, next, _) = plan(&p, false).unwrap();
        apply(&p, &l, &next, false).unwrap();
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(back, serde_json::from_str::<Value>(orig).unwrap(), "제거하면 원래대로");
        // 자리표시 sidecar는 거부
        std::fs::write(&side, "#!/bin/sh\n# WAITSCAPE_SIDECAR_STUB\nexit 0\n").unwrap();
        std::fs::remove_file(&p.bin).unwrap();
        let (l, next, _) = plan(&p, true).unwrap();
        assert!(apply(&p, &l, &next, true).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    /// 확인 생략은 첫 호출만: 두 번째부터는 확인 창 경로(false)
    #[test]
    fn onboarding_skip_only_once() {
        let dir = std::env::temp_dir().join(format!("ws-onbskip-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let m = dir.join("cfg").join(ONBOARDING_MARK);
        assert!(take_onboarding_skip(&m), "첫 호출은 생략");
        assert!(m.is_file(), "허용하는 즉시 기록");
        assert!(!take_onboarding_skip(&m), "두 번째는 확인 창");
        assert!(!take_onboarding_skip(&m));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn script(p: &Path, ver: &str) {
        std::fs::write(p, format!("#!/bin/sh\necho \"wr-hook {ver}\"\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    /// 자동 갱신 조건: 스텁 / 항목 없음 / 같음 / 다름. 임시 HOME만 쓴다
    #[test]
    fn refresh_bin_conditions() {
        let home = std::env::temp_dir().join(format!("ws-refresh-{}", std::process::id()));
        std::fs::remove_dir_all(&home).ok();
        let root = home.join(".claude");
        std::fs::create_dir_all(&root).unwrap();
        let settings = root.join("settings.json");
        let orig = r#"{"theme":"dark"}"#;
        std::fs::write(&settings, orig).unwrap();
        let side = home.join("side-wr-hook");
        script(&side, "2.0.0");
        let mut p = HookPaths::new(&root, &settings);
        p.sidecar = Some(side.clone());
        let st = status(&p, &home);
        assert_eq!(st["claudeDir"], true);

        // 항목 없음: 바이너리를 만들지 않는다
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::NotInstalled);
        assert!(!p.bin.exists());

        // 항목 있음 + 설치본이 옛 버전 → 바이너리만 교체, settings.json은 그대로
        let next = hc::merged(&hc::load(&settings).unwrap().value, &p.cmd());
        std::fs::write(&settings, serde_json::to_string(&next).unwrap()).unwrap();
        let before = std::fs::read(&settings).unwrap();
        std::fs::create_dir_all(p.bin.parent().unwrap()).unwrap();
        script(&p.bin, "1.0.0");
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::Updated);
        assert_eq!(std::fs::read(&p.bin).unwrap(), std::fs::read(&side).unwrap());
        assert_eq!(std::fs::read(&settings).unwrap(), before, "settings.json은 건드리지 않음");

        // 같음 → 아무것도 안 함
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::Same);

        // 항목 있음 + 설치본 없음 → 다시 넣는다
        std::fs::remove_file(&p.bin).unwrap();
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::Updated);
        assert!(p.bin.is_file());

        // 스텁 sidecar(개발 빌드) → 설치본을 건드리지 않는다
        let installed = std::fs::read(&p.bin).unwrap();
        std::fs::write(&side, "#!/bin/sh\n# WAITSCAPE_SIDECAR_STUB\nexit 0\n").unwrap();
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::NoSidecar);
        assert_eq!(std::fs::read(&p.bin).unwrap(), installed);
        // sidecar 자체가 없음
        p.sidecar = None;
        assert_eq!(refresh_bin(&p).unwrap(), Refresh::NoSidecar);

        // Claude Code 설정 폴더가 없으면 claudeDir=false (온보딩은 안내만)
        let gone = HookPaths::new(&home.join("nope"), &home.join("nope/settings.json"));
        assert_eq!(status(&gone, &home)["claudeDir"], false);
        std::fs::remove_dir_all(&home).ok();
    }
}

//! 앱 설정 (`<앱 설정 폴더>/settings.json`). 백엔드가 알아야 하는 것만 둔다(ARCHITECTURE §3.5).
//! 화면 취향(마지막 모드 등)은 웹 localStorage에 그대로 둔다. 쓰기는 임시 파일 + rename.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct NotifyKinds {
    pub done: bool,
    pub input: bool,
    pub stall: bool,
    pub memo: bool,
}

impl Default for NotifyKinds {
    fn default() -> Self {
        NotifyKinds {
            done: true,
            input: true,
            stall: true,
            memo: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    /// 사용 한도 직접 조회 동의 (**기본 꺼짐**)
    pub usage_lookup: bool,
    pub notify: NotifyKinds,
    /// 회의 모드: OS 알림은 보내되 소리 없음, 화면 연출·소리 끔
    pub quiet: bool,
    /// 사용자가 고른 언어 ("auto" | "ko" | "en")
    pub lang_pref: String,
    /// 실제로 쓰는 언어(프론트가 auto를 풀어서 알려 줌) — OS 알림·트레이 문구
    pub lang: String,
    /// 로그인 시 자동 시작 (tauri-plugin-autostart). 기본 꺼짐
    pub autostart: bool,
    /// 터미널로 이동할 때 쓸 앱 ("auto" | "Terminal" | "iTerm" | "Visual Studio Code" | "Cursor" | "Ghostty" | "WezTerm" | "Warp" | "cmux").
    /// auto나 세션의 멀티플렉서 kind면(cmux) 그 세션(`jump.mux`)의 워크스페이스·패널로 간다. Orca 세션은 auto일 때만 Orca로 (terminal.rs)
    pub terminal: String,
    /// 모드 켜기·순서·외부 모드 권한 동의 `{ order: [id], enabled: {id: bool}, ack: {id: sig} }` (프론트 형식 그대로)
    pub modes: Value,
    /// 포켓 위젯을 띄워 둔 상태였나 (다음 실행 때 다시 띄움)
    pub widget: bool,
    /// 숨길 프로젝트 패턴(경로·이름 일부, 대소문자 무시). 맞는 프로젝트의 트랜스크립트는 스캔도 하지 않는다 (wr-core `hide.rs`)
    pub hide_projects: Vec<String>,
    /// 알려진 플러그인 내부 세션(claude-mem 관찰자 등) 기본 숨김
    pub hide_builtin: bool,
    /// 기본은 활성 세션만 보기 (작업 중·입력 필요·멈춤 의심·서브에이전트 실행 중 + 끝난 지 `recent_minutes`분 이내). 화면(core.js)이 적용
    pub active_only: bool,
    /// 끝난 세션을 계속 보여 주는 시간(분). 1~1440
    pub recent_minutes: u32,
    /// 새 버전 확인(시작할 때 + 하루 1번, GitHub Releases의 latest.json). 기본 켜짐. 설치는 사용자가 눌렀을 때만 (updater.rs)
    pub update_check: bool,
    /// MCP 보고(실험): AI가 `wr-hook mcp`로 보낸 보고(reports.jsonl·훅 report)를 읽어 state에 넣는다. **기본 꺼짐** (설정 화면은 PR 2)
    pub mcp_reports: bool,
    /// 🙈 눈치 모드: 화면을 평범한 업무 툴("Agent Sessions")로, 창 제목·OS 알림 문구도 담백하게(이모지·효과음 없음). 다시 켜도 유지
    pub nunchi: bool,
    /// 눈치 모드 전역 단축키(Tauri 형식, 기본은 플랫폼별 `NUNCHI_KEY` — 맥 ⌃Q · 윈도우 Alt+`). 빈 문자열 = 단축키 끔(스위치 `nunchi_global`도 있음)
    pub nunchi_key: String,
    /// 단축키 기본값 이전 표시(`migrate_key`): 1 = 예전 파일, 4 = 옮김 끝(그 뒤 사용자가 옛 값을 골라도 유지)
    #[serde(default = "key_v1")]
    pub nunchi_key_v: u32,
    /// 눈치 모드 연출: false = 짧게(블라인드만, 기본) · true = 퇴장·출근 연출까지(스튜디오)
    pub nunchi_long: bool,
    /// 눈치 화면 밝기: "system"(기본, OS 라이트/다크를 실시간으로 따름) | "light" | "dark"
    pub nunchi_theme: String,
    /// 다른 앱을 쓰는 중에도 전역 단축키 쓰기(기본 켜짐). 끄면 등록만 해제하고 `nunchi_key`는 그대로 둔다(다시 켜면 그 키로). 창 안 ⌘1·B와는 무관
    pub nunchi_global: bool,
}

/// 눈치 모드 **전역** 기본 단축키(플랫폼별, 다른 앱을 쓰는 중에도). 앱 창 안에서는 따로 ⌘1 / Ctrl+1 · B(웹 core.js `nunchiHotkey`).
/// - 윈도우·리눅스: Alt+` (`Alt+Backquote`, 숫자 1 왼쪽 키 — Ctrl+Q(종료)·Alt+Z(NVIDIA 오버레이)·⌃`(VS Code 터미널)는 피함).
///   키 코드(물리 키) 기준이라 한국어 자판에서 그 자리가 ₩로 찍혀도 같은 키(윈도우 VK_OEM_3)
/// - macOS: ⌃Q (`Control+KeyQ`) — 맥북에서 한 손(왼손)으로 누르기 쉬움. macOS 15부터 RegisterEventHotKey가 수식키가
///   **Option만·Option+Shift만**인 조합을 실제 키 입력에서 막아(키로거 방지, 등록은 "성공"하지만 눌러도 안 옴) ⌥` 대신.
///   ⌃⌥`는 한 손으로 누르기 어렵다는 피드백으로 바꿈. 키 이름은 global-hotkey 0.8의 정식 형식 `KeyQ`
pub const NUNCHI_KEY: &str = if cfg!(target_os = "macos") { NUNCHI_KEY_MAC } else { NUNCHI_KEY_PC };
pub const NUNCHI_KEY_MAC: &str = "Control+KeyQ";
/// 지금까지 맥 기본값이었던 것들(맥에서 저장돼 있으면 ⌃Q로 한 번 옮김)
const MAC_OLD: [&str; 2] = ["Alt+Backquote", "Control+Alt+Backquote"];
pub const NUNCHI_KEY_PC: &str = "Alt+Backquote";
/// 첫 버전의 기본 단축키(설정 파일에 남아 있으면 새 기본값으로 한 번 옮김)
pub const NUNCHI_KEY_OLD: &str = "CmdOrCtrl+Shift+H";
const KEY_V: u32 = 4;

/// 그 파일 버전(`nunchiKeyV`)이 쓰일 때의 기본 단축키 — 그 값과 **정확히 같을 때만** 옮긴다(그 버전에서 사용자가 고른 다른 값은 유지)
/// v1(표시 없음) = 첫 기본값 `CmdOrCtrl+Shift+H` · v2 = 맥 `Alt+Backquote`(Option 단독이라 안 눌림) · v3 = 맥 `Control+Alt+Backquote`(한 손으로 어려움).
/// 윈도우·리눅스는 v2부터 지금과 같은 `Alt+Backquote`라 옮길 것 없음
fn default_at(v: u32, mac: bool) -> Option<&'static str> {
    match (v, mac) {
        (0 | 1, _) => Some(NUNCHI_KEY_OLD),
        (2, true) => Some(MAC_OLD[0]),
        (3, true) => Some(MAC_OLD[1]),
        _ => None,
    }
}

/// 기본값 이전(한 번만): 저장된 키가 그 파일 버전의 기본값이면 지금 플랫폼 기본값으로. 반환 (키, 버전)
pub fn migrate_key(key: &str, v: u32, mac: bool) -> (String, u32) {
    if v >= KEY_V {
        return (key.to_string(), v);
    }
    let new = if mac { NUNCHI_KEY_MAC } else { NUNCHI_KEY_PC };
    let old = default_at(v, mac) == Some(key);
    (if old { new.to_string() } else { key.to_string() }, KEY_V)
}
fn key_v1() -> u32 {
    1
}

const MODS: [&str; 15] = [
    "cmd",
    "command",
    "super",
    "meta",
    "ctrl",
    "control",
    "cmdorctrl",
    "cmdorcontrol",
    "commandorcontrol",
    "commandorctrl",
    "alt",
    "option",
    "shift",
    "altgr",
    "fn",
];

/// 이 플랫폼 기준 검사 (`check_key_for`)
pub fn check_key(key: &str) -> Result<String, String> {
    check_key_for(key, cfg!(target_os = "macos"))
}

/// 눈치 모드 단축키 형식 검사: 빈 값(= 끔) 또는 "수식키+…+키" — 수식키 1개 이상, 마지막은 수식키가 아닌 키 하나.
/// 글자·숫자·+ 만(48자 이내). mac이면 수식키가 Option만·Option+Shift만인 조합은 거부(macOS 15+가 실제 입력을 막음, 위 NUNCHI_KEY).
/// 실제로 등록되는지(다른 앱 선점)는 nunchi.rs가 따로 알려 준다. OS를 인자로 받아 모든 OS에서 테스트한다
pub fn check_key_for(key: &str, mac: bool) -> Result<String, String> {
    let k = key.trim();
    if k.is_empty() {
        return Ok(String::new());
    }
    let bad = |why: &str| Err(format!("bad nunchiKey: {why}"));
    if k.len() > 48 || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '+') {
        return bad("letters, digits and + only");
    }
    let parts: Vec<&str> = k.split('+').collect();
    if parts.iter().any(|p| p.is_empty()) {
        return bad("empty part");
    }
    let is_mod = |p: &&str| MODS.contains(&p.to_ascii_lowercase().as_str());
    let (last, mods) = parts.split_last().expect("not empty");
    if is_mod(last) || mods.is_empty() || !mods.iter().all(is_mod) {
        return bad("needs at least one modifier (Cmd/Ctrl/Alt/Shift) and one key");
    }
    let opt = |p: &&str| matches!(p.to_ascii_lowercase().as_str(), "alt" | "option" | "altgr");
    let shift = |p: &&str| p.eq_ignore_ascii_case("shift");
    if mac && mods.iter().any(opt) && mods.iter().all(|p| opt(p) || shift(p)) {
        return bad("macos-option-only (add Control or Cmd)");
    }
    Ok(k.to_string())
}

pub const MAX_HIDE_PATTERNS: usize = 100;
pub const MAX_HIDE_LEN: usize = 200;

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            usage_lookup: false,
            notify: NotifyKinds::default(),
            quiet: false,
            lang_pref: "auto".into(),
            lang: "ko".into(),
            autostart: false,
            terminal: "auto".into(),
            modes: json!({}),
            widget: false,
            hide_projects: vec![],
            hide_builtin: true,
            active_only: true,
            recent_minutes: 30,
            update_check: true,
            mcp_reports: false,
            nunchi: false,
            nunchi_key: NUNCHI_KEY.into(),
            nunchi_key_v: KEY_V,
            nunchi_long: false,
            nunchi_theme: "system".into(),
            nunchi_global: true,
        }
    }
}

/// 프론트(`set_settings`)가 바꿀 수 있는 키
const PATCHABLE: [&str; 20] = [
    "usageLookup",
    "notify",
    "quiet",
    "langPref",
    "lang",
    "autostart",
    "terminal",
    "modes",
    "widget",
    "hideProjects",
    "hideBuiltin",
    "activeOnly",
    "recentMinutes",
    "updateCheck",
    "mcpReports",
    "nunchi",
    "nunchiKey",
    "nunchiLong",
    "nunchiTheme",
    "nunchiGlobal",
];

pub const TERMINALS: [&str; 9] = [
    "auto",
    "Terminal",
    "iTerm",
    "Visual Studio Code",
    "Cursor",
    "Ghostty",
    "WezTerm",
    "Warp",
    "cmux",
];

impl AppSettings {
    pub fn load(path: &Path) -> AppSettings {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<AppSettings>(&b).ok())
            .map(|s| s.sanitized())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        std::fs::rename(&tmp, path)
    }

    fn sanitized(mut self) -> AppSettings {
        if !matches!(self.lang_pref.as_str(), "auto" | "ko" | "en") {
            self.lang_pref = "auto".into();
        }
        if !matches!(self.lang.as_str(), "ko" | "en") {
            self.lang = "ko".into();
        }
        if !TERMINALS.contains(&self.terminal.as_str()) {
            self.terminal = "auto".into();
        }
        if !self.modes.is_object() {
            self.modes = json!({});
        }
        // 숨길 프로젝트: 공백 제거·중복 제거·개수/길이 제한
        let mut seen: Vec<String> = vec![];
        for p in std::mem::take(&mut self.hide_projects) {
            let p: String = p.trim().chars().take(MAX_HIDE_LEN).collect();
            if !p.is_empty() && !seen.contains(&p) && seen.len() < MAX_HIDE_PATTERNS {
                seen.push(p);
            }
        }
        self.hide_projects = seen;
        self.recent_minutes = self.recent_minutes.clamp(1, 1440);
        // 단축키: 옛 기본값은 한 번 새 기본값으로 → 파일에서 읽은 값이 이상하면 기본값(설정 화면에서 바꿀 때는 patched가 오류로 막음), 빈 값은 끔
        (self.nunchi_key, self.nunchi_key_v) = migrate_key(self.nunchi_key.trim(), self.nunchi_key_v, cfg!(target_os = "macos"));
        self.nunchi_key = check_key(&self.nunchi_key).unwrap_or_else(|_| NUNCHI_KEY.into());
        if !matches!(self.nunchi_theme.as_str(), "system" | "light" | "dark") {
            self.nunchi_theme = "system".into();
        }
        // 모드 설정은 작게 유지(악의적/깨진 값 방지)
        if serde_json::to_string(&self.modes).map(|s| s.len()).unwrap_or(0) > 64 * 1024 {
            self.modes = json!({});
        }
        self
    }

    /// 허용된 키만 덮어쓴다. 형식이 틀리면 Err(그대로 둠)
    pub fn patched(&self, patch: &Value) -> Result<AppSettings, String> {
        let Some(p) = patch.as_object() else {
            return Err("patch must be an object".into());
        };
        let mut v = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (k, x) in p {
            if !PATCHABLE.contains(&k.as_str()) {
                return Err(format!("unknown setting: {k}"));
            }
            if k == "nunchiKey" {
                // 잘못된 단축키는 조용히 바꾸지 않고 오류(설정 화면에 표시, 저장 안 됨)
                check_key(x.as_str().ok_or("bad setting: nunchiKey")?)?;
            }
            v[k] = x.clone();
        }
        let s: AppSettings = serde_json::from_value(v).map_err(|e| format!("bad setting: {e}"))?;
        Ok(s.sanitized())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_patch() {
        let s = AppSettings::default();
        assert!(!s.usage_lookup && !s.autostart && s.notify.done);
        let p = s.patched(&json!({"quiet": true, "notify": {"done": false}})).unwrap();
        assert!(p.quiet && !p.notify.done && p.notify.input);
        assert!(s.patched(&json!({"evil": 1})).is_err());
        assert!(s.patched(&json!({"quiet": "yes"})).is_err());
        assert_eq!(s.patched(&json!({"terminal": "rm -rf"})).unwrap().terminal, "auto");
        // 숨김 설정
        assert!(s.hide_builtin && s.active_only && s.recent_minutes == 30 && s.hide_projects.is_empty());
        let h = s
            .patched(&json!({"hideProjects": [" a/b ", "a/b", "", "c"], "recentMinutes": 99999, "activeOnly": false}))
            .unwrap();
        assert_eq!(h.hide_projects, vec!["a/b", "c"]);
        assert_eq!((h.recent_minutes, h.active_only), (1440, false));
        assert!(s.patched(&json!({"hideProjects": "x"})).is_err());
        // 업데이트 확인: 기본 켜짐, 끌 수 있음. 이 키가 없던 예전 settings.json도 켜짐으로 읽힌다
        assert!(s.update_check);
        assert!(!s.patched(&json!({"updateCheck": false})).unwrap().update_check);
        let old: AppSettings = serde_json::from_value(json!({"quiet": true})).unwrap();
        assert!(old.update_check);
        // MCP 보고: 기본 꺼짐, 켤 수 있음
        assert!(!s.mcp_reports && !old.mcp_reports);
        assert!(s.patched(&json!({"mcpReports": true})).unwrap().mcp_reports);
        // 눈치 모드: 기본 꺼짐·짧은 연출·기본 단축키. 예전 settings.json도 같은 기본값
        assert!(!s.nunchi && !s.nunchi_long && !old.nunchi);
        assert_eq!((s.nunchi_key.as_str(), old.nunchi_key.as_str()), (NUNCHI_KEY, NUNCHI_KEY));
        let n = s
            .patched(&json!({"nunchi": true, "nunchiLong": true, "nunchiKey": " Ctrl+Alt+B "}))
            .unwrap();
        assert!(n.nunchi && n.nunchi_long);
        assert_eq!(n.nunchi_key, "Ctrl+Alt+B");
        // 잘못된 단축키는 오류(저장 안 됨) — 조용히 기본값으로 바꾸지 않음
        for bad in ["Cmd+Shift+H; rm", "H", "Shift+", "Ctrl+Shift", "A+B", "Ctrl++H"] {
            assert!(s.patched(&json!({ "nunchiKey": bad })).is_err(), "{bad}");
        }
        assert!(s.patched(&json!({"nunchiKey": 3})).is_err());
        assert_eq!(s.patched(&json!({"nunchiKey": ""})).unwrap().nunchi_key, "");
        assert_eq!(check_key_for(" Alt+F12 ", false).unwrap(), "Alt+F12");
        // 파일에 깨진 값이 있으면 읽을 때 기본값
        let broken: AppSettings = serde_json::from_value(json!({"nunchiKey": "H"})).unwrap();
        assert_eq!(broken.sanitized().nunchi_key, NUNCHI_KEY);
        // 기본 단축키(플랫폼별): 맥 ⌃Q, 그 밖 Alt+`. 옛 기본값이 저장된 파일은 한 번 새 기본값으로, 사용자가 바꾼 값은 그대로
        assert_eq!(check_key(NUNCHI_KEY).unwrap(), NUNCHI_KEY);
        assert_eq!(
            NUNCHI_KEY,
            if cfg!(target_os = "macos") {
                "Control+KeyQ"
            } else {
                "Alt+Backquote"
            }
        );
        let was: AppSettings = serde_json::from_value(json!({"nunchiKey": NUNCHI_KEY_OLD})).unwrap();
        let was = was.sanitized();
        assert_eq!((was.nunchi_key.as_str(), was.nunchi_key_v), (NUNCHI_KEY, KEY_V));
        let mine: AppSettings = serde_json::from_value(json!({"nunchiKey": "Ctrl+Alt+N"})).unwrap();
        assert_eq!(mine.sanitized().nunchi_key, "Ctrl+Alt+N");
        // 옮긴 뒤(v2)에 사용자가 옛 조합을 직접 고르면 유지
        let again = was.patched(&json!({ "nunchiKey": NUNCHI_KEY_OLD })).unwrap();
        assert_eq!(again.nunchi_key, NUNCHI_KEY_OLD);
        let round: AppSettings = serde_json::from_value(serde_json::to_value(&again).unwrap()).unwrap();
        assert_eq!(round.sanitized().nunchi_key, NUNCHI_KEY_OLD);
        // 눈치 화면 밝기: 기본 system, light/dark, 잘못된 값은 system
        assert_eq!((s.nunchi_theme.as_str(), old.nunchi_theme.as_str()), ("system", "system"));
        assert_eq!(s.patched(&json!({"nunchiTheme": "dark"})).unwrap().nunchi_theme, "dark");
        assert_eq!(s.patched(&json!({"nunchiTheme": "neon"})).unwrap().nunchi_theme, "system");
        assert_eq!(
            serde_json::to_value(s.patched(&json!({"nunchiTheme": "light"})).unwrap()).unwrap()["nunchiTheme"],
            json!("light")
        );
        let v = serde_json::to_value(&n).unwrap();
        assert_eq!(
            (v["nunchi"].clone(), v["nunchiKey"].clone(), v["nunchiLong"].clone()),
            (json!(true), json!("Ctrl+Alt+B"), json!(true))
        );
        let dir = std::env::temp_dir().join(format!("ws-settings-{}", std::process::id()));
        let f = dir.join("settings.json");
        p.save(&f).unwrap();
        assert_eq!(AppSettings::load(&f), p);
        std::fs::write(&f, "garbage").unwrap();
        assert_eq!(AppSettings::load(&f), AppSettings::default());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn nunchi_key_platform_rules() {
        // macOS: Option만·Option+Shift만은 거부(15+가 실제 입력을 막음), Control·⌘를 더하면 OK. 다른 OS는 그대로 허용
        for k in ["Alt+Backquote", "Option+K", "Alt+Shift+H", "Shift+Alt+F12"] {
            assert!(check_key_for(k, true).unwrap_err().contains("macos-option-only"), "{k}");
            assert!(check_key_for(k, false).is_ok(), "{k}");
        }
        for k in ["Control+Alt+Backquote", "Cmd+Alt+B", "CmdOrCtrl+Shift+H", "Shift+F12"] {
            assert!(check_key_for(k, true).is_ok(), "{k}");
        }
        assert!(check_key_for(NUNCHI_KEY_MAC, true).is_ok() && check_key_for(NUNCHI_KEY_PC, false).is_ok());
        // 이전: 첫 기본값은 어디서나, 둘째 기본값(Alt+Backquote)은 맥에서만 새 기본값으로. 다른 값·이미 옮긴 파일은 그대로
        // 맥: 지금까지의 기본값 3종 → ⌃Q, 윈도우: 첫 기본값만 → Alt+`
        assert_eq!(NUNCHI_KEY_MAC, "Control+KeyQ");
        assert_eq!(migrate_key(NUNCHI_KEY_OLD, 1, true), (NUNCHI_KEY_MAC.into(), 4));
        assert_eq!(migrate_key("Alt+Backquote", 2, true), (NUNCHI_KEY_MAC.into(), 4));
        assert_eq!(migrate_key("Control+Alt+Backquote", 3, true), (NUNCHI_KEY_MAC.into(), 4));
        assert_eq!(migrate_key(NUNCHI_KEY_OLD, 1, false), (NUNCHI_KEY_PC.into(), 4));
        // 그 버전의 기본값과 정확히 같을 때만: v2 파일의 CmdOrCtrl+Shift+H·v3 파일의 Alt+Backquote는 사용자가 고른 값 → 유지
        assert_eq!(migrate_key(NUNCHI_KEY_OLD, 2, false), (NUNCHI_KEY_OLD.into(), 4));
        assert_eq!(migrate_key(NUNCHI_KEY_OLD, 3, true), (NUNCHI_KEY_OLD.into(), 4));
        assert_eq!(migrate_key("Alt+Backquote", 3, true), ("Alt+Backquote".into(), 4));
        assert_eq!(migrate_key("Control+Alt+Backquote", 2, true), ("Control+Alt+Backquote".into(), 4));
        assert_eq!(migrate_key("Alt+Backquote", 3, false), ("Alt+Backquote".into(), 4));
        assert_eq!(migrate_key("Control+Alt+Backquote", 3, false), ("Control+Alt+Backquote".into(), 4));
        assert_eq!(migrate_key("Ctrl+Alt+N", 1, true), ("Ctrl+Alt+N".into(), 4));
        assert_eq!(migrate_key("", 1, true), (String::new(), 4));
        assert_eq!(migrate_key("Control+Alt+Backquote", 4, true), ("Control+Alt+Backquote".into(), 4));
    }

    #[test]
    fn nunchi_global_switch() {
        // 기본 켜짐(예전 파일도), 끄고 켜도 키 값은 그대로, 직렬화 이름 nunchiGlobal
        let s = AppSettings::default();
        let old: AppSettings = serde_json::from_value(json!({"quiet": true})).unwrap();
        assert!(s.nunchi_global && old.nunchi_global);
        let off = s.patched(&json!({"nunchiGlobal": false})).unwrap();
        assert!(!off.nunchi_global);
        assert_eq!(off.nunchi_key, s.nunchi_key);
        assert_eq!(serde_json::to_value(&off).unwrap()["nunchiGlobal"], json!(false));
        assert!(s.patched(&json!({"nunchiGlobal": "no"})).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_rejects_option_only_in_settings() {
        let s = AppSettings::default();
        assert!(s
            .patched(&json!({"nunchiKey": "Alt+Backquote"}))
            .unwrap_err()
            .contains("macos-option-only"));
        assert_eq!(s.nunchi_key, "Control+KeyQ");
        for (k, v) in [("Alt+Backquote", 2), ("Control+Alt+Backquote", 3)] {
            let prev: AppSettings = serde_json::from_value(json!({"nunchiKey": k, "nunchiKeyV": v})).unwrap();
            assert_eq!(prev.sanitized().nunchi_key, "Control+KeyQ");
        }
    }
}

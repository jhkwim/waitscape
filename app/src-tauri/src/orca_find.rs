//! Orca 설치 찾기 (#54, ARCHITECTURE §3.6 'Orca CLI 찾기'). 설치 경로와 무관하게 앱 본체와 CLI를 찾는다. PATH는 보지 않는다.
//! 순서: ① 실행 중인 Orca 프로세스의 실행 파일 경로 ② 설치 정보(윈도우 레지스트리 Uninstall 항목 · 맥 Spotlight 번들 ID)
//! ③ 고정 후보(맥 `/Applications`·`~/Applications`·Homebrew 링크, 윈도우 `%LOCALAPPDATA%\Programs\orca`).
//! - 윈도우: `<설치 폴더>\Orca.exe` + `<설치 폴더>\resources\bin\orca.exe`(네이티브 CLI 런처). `orca.cmd`는 cmd 셸을 거치므로 쓰지 않는다.
//! - 맥: `<X>.app/Contents/MacOS/Orca` + `<X>.app/Contents/Resources/bin/orca`(Electron을 Node 모드로 돌리는 bash 스크립트).
//! - 검증(`verify`): 실행 파일 이름이 Orca(대소문자 무관)이고, 실제 경로(canonicalize)로 앱·CLI가 설치 폴더·번들 안이며 파일이다.
//! - 프로세스 목록: 맥 `/bin/ps -axo comm=`(실행 파일 전체 경로). 윈도우는 `tasklist.exe`가 경로를 주지 않아 내장 PowerShell 5.1(고정 경로)로
//!   `Get-Process -Name Orca`의 `Path`만 읽는다(고정 스크립트, 사용자 값 없음, 출력은 UTF-8로 — 한글 사용자 폴더).
//!   Win32 API(`QueryFullProcessImageNameW`)는 unsafe FFI라, 앱 크레이트를 Windows에서 빌드하지 않는 CI로 검증할 수 없어 쓰지 않는다.
//! - 레지스트리: `reg.exe query <HKCU|HKLM>\…\Uninstall /s` 출력에서 `DisplayName`이 `Orca`·`Orca <버전>`인 키의
//!   `InstallLocation` → `DisplayIcon` → `UninstallString`의 폴더(electron-builder 설치본은 InstallLocation을 안 쓸 수 있다).
//! - 실행기(`run`)는 바꿔 끼울 수 있다(테스트는 가짜). 경로 계산·파싱은 순수 함수라 모든 OS에서 테스트한다.

use crate::mcp_connect::Runner;
use crate::terminal::Cmd;
use std::path::{Path, PathBuf};

/// 맥 Orca 번들 ID (Orca.app Info.plist `CFBundleIdentifier`)
pub const BUNDLE_ID: &str = "com.stablyai.orca";
const PS: &str = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
const PS_SCRIPT: &str =
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process -Name Orca -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }";
const REG: &str = r"C:\Windows\System32\reg.exe";
const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// 찾은 Orca 설치
#[derive(Debug, Clone, PartialEq)]
pub struct Install {
    /// 윈도우 `Orca.exe` · 맥 `X.app` 번들
    pub app: PathBuf,
    /// 윈도우 `resources\bin\orca.exe` · 맥 `Contents/Resources/bin/orca`
    pub cli: PathBuf,
    pub win: bool,
    /// 어디서 찾았나(로그): "프로세스" | "레지스트리" | "Spotlight" | "고정"
    pub via: &'static str,
}

impl Install {
    /// 앱을 앞으로(꺼져 있으면 띄움). 윈도우 = `Orca.exe`를 인자 없이(단일 인스턴스 → 기존 창이 앞으로), 맥 = `open <번들>`
    pub fn front(&self) -> Cmd {
        if self.win {
            (self.app.clone(), vec![])
        } else {
            (PathBuf::from("/usr/bin/open"), vec![self.app.to_string_lossy().into_owned()])
        }
    }
}

/// 경로 끝 이름 (`/`·`\` 둘 다 구분자로 — 윈도우 경로를 다른 OS에서도 테스트)
fn base(s: &str) -> &str {
    s.rsplit(['/', '\\']).next().unwrap_or(s)
}

/// 앱 실행 파일 이름이 Orca인가 (윈도우 `Orca.exe`, 맥 `Orca`, 대소문자 무관)
fn is_orca(p: &str, win: bool) -> bool {
    base(p).eq_ignore_ascii_case(if win { "orca.exe" } else { "orca" })
}

/// 앱 실행 파일 → (앱, CLI) 경로 계산(파일은 보지 않음). 윈도우 `…\Orca.exe` → 같은 폴더 `resources\bin\orca.exe`,
/// 맥 `…/X.app/Contents/MacOS/Orca` → `X.app` · `X.app/Contents/Resources/bin/orca`
pub fn from_exe(exe: &Path, win: bool) -> Option<(PathBuf, PathBuf)> {
    if !is_orca(&exe.to_string_lossy(), win) {
        return None;
    }
    if win {
        return Some((exe.to_path_buf(), exe.parent()?.join("resources").join("bin").join("orca.exe")));
    }
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    let ok = macos.file_name()? == "MacOS" && contents.file_name()? == "Contents" && app.extension()? == "app";
    ok.then(|| (app.to_path_buf(), app.join("Contents").join("Resources").join("bin").join("orca")))
}

/// 설치 폴더(윈도우)·번들(맥) → 앱 실행 파일
pub fn exe_in(root: &Path, win: bool) -> PathBuf {
    if win {
        root.join("Orca.exe")
    } else {
        root.join("Contents").join("MacOS").join("Orca")
    }
}

/// 검증: 이름이 Orca, 실제 경로로 앱·CLI가 설치 폴더·번들 안의 파일. 실행은 원래 경로로(윈도우 canonicalize는 `\\?\` 접두가 붙음)
pub fn verify(exe: &Path, win: bool, via: &'static str) -> Result<Install, String> {
    let (app, cli) = from_exe(exe, win).ok_or("Orca 실행 파일이 아님")?;
    let root = if win { exe.parent().unwrap_or(exe) } else { app.as_path() };
    let real = |p: &Path| std::fs::canonicalize(p).map_err(|e| format!("{} 없음({:?})", p.display(), e.kind()));
    let (root_r, exe_r, cli_r) = (real(root)?, real(exe)?, real(&cli)?);
    if !exe_r.is_file() || !exe_r.starts_with(&root_r) || !is_orca(&exe_r.to_string_lossy(), win) {
        return Err(format!("{}: 앱 실행 파일이 아님", exe.display()));
    }
    if !cli_r.is_file() || !cli_r.starts_with(&root_r) {
        return Err(format!("{}: CLI가 설치 폴더 밖이거나 파일이 아님", cli.display()));
    }
    Ok(Install { app, cli, win, via })
}

/// 프로세스 목록 명령: 맥 `ps`(실행 파일 전체 경로), 윈도우 PowerShell `Get-Process -Name Orca`의 경로 (둘 다 읽기 전용)
pub fn procs_cmd(win: bool) -> Cmd {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect();
    if win {
        (PathBuf::from(PS), a(&["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT]))
    } else {
        (PathBuf::from("/bin/ps"), a(&["-axo", "comm="]))
    }
}

/// 프로세스 목록(한 줄에 실행 파일 경로) → Orca 실행 파일들 (중복 제거, 순서 유지. Electron 보조 프로세스도 같은 경로)
pub fn parse_procs(out: &str, win: bool) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = vec![];
    for l in out.lines().map(str::trim).filter(|l| !l.is_empty() && is_orca(l, win)) {
        if !v.iter().any(|p| p.as_os_str() == l) {
            v.push(PathBuf::from(l));
        }
    }
    v
}

/// 레지스트리 조회 명령 (HKCU 먼저 — 사용자 단위 기본 설치)
pub fn reg_cmds() -> Vec<Cmd> {
    ["HKCU", "HKLM"]
        .iter()
        .map(|h| (PathBuf::from(REG), vec!["query".into(), format!(r"{h}\{UNINSTALL}"), "/s".into()]))
        .collect()
}

/// Uninstall 항목 이름이 Orca인가: `Orca` 또는 `Orca 1.4.2`처럼 버전이 붙은 것 (OrcaSlicer 같은 다른 앱은 아님)
pub fn display_is_orca(n: &str) -> bool {
    let n = n.trim().to_ascii_lowercase();
    n == "orca" || n.strip_prefix("orca ").is_some_and(|r| r.starts_with(|c: char| c.is_ascii_digit()))
}

/// 값에서 실행 파일 경로 꺼내기: 따옴표 안, 아니면 `.exe`까지 (`"C:\…\Uninstall Orca.exe" /currentuser`, `C:\…\Orca.exe,0`)
fn exe_part(v: &str) -> &str {
    let v = v.trim();
    if let Some(r) = v.strip_prefix('"') {
        return r.split('"').next().unwrap_or(r);
    }
    match v.to_ascii_lowercase().find(".exe") {
        Some(i) => &v[..i + 4],
        None => v,
    }
}

/// `reg query …\Uninstall /s` 출력 → Orca 설치 폴더 후보.
/// 키(`HKEY_` 줄)마다 `이름    REG_형식    값`을 모아, DisplayName이 Orca면 InstallLocation → DisplayIcon·UninstallString의 폴더 순
pub fn parse_reg(out: &str) -> Vec<String> {
    let mut found: Vec<String> = vec![];
    let mut key: Vec<(String, String)> = vec![];
    let mut flush = |key: &mut Vec<(String, String)>| {
        let get = |n: &str| key.iter().find(|(k, _)| k.eq_ignore_ascii_case(n)).map(|(_, v)| v.as_str());
        if get("DisplayName").is_some_and(display_is_orca) {
            let loc = get("InstallLocation").map(|v| v.trim().trim_matches('"').trim_end_matches('\\').to_string());
            let dir = |n: &str| get(n).and_then(|v| exe_part(v).rsplit_once('\\')).map(|(d, _)| d.to_string());
            for d in [loc, dir("DisplayIcon"), dir("UninstallString")].into_iter().flatten() {
                if !d.is_empty() && !found.contains(&d) {
                    found.push(d);
                }
            }
        }
        key.clear();
    };
    for l in out.lines() {
        if l.starts_with("HKEY_") {
            flush(&mut key);
        } else if let Some((name, rest)) = l.trim().split_once(" REG_") {
            let val = rest.split_once(char::is_whitespace).map_or("", |(_, v)| v.trim());
            key.push((name.trim().to_string(), val.to_string()));
        }
    }
    flush(&mut key);
    found
}

/// Spotlight 번들 ID 검색 (읽기 전용, 셸 없이 질의 문자열 하나)
pub fn mdfind_cmd() -> Cmd {
    (
        PathBuf::from("/usr/bin/mdfind"),
        vec![format!("kMDItemCFBundleIdentifier == '{BUNDLE_ID}'")],
    )
}

/// `mdfind` 출력 → 번들 후보 (휴지통·마운트된 디스크 이미지는 뺌)
pub fn parse_mdfind(out: &str) -> Vec<PathBuf> {
    out.lines()
        .map(str::trim)
        .filter(|l| l.starts_with('/') && !l.contains("/.Trash/") && !l.starts_with("/Volumes/"))
        .map(PathBuf::from)
        .collect()
}

/// 고정 후보(앱 실행 파일). 맥 Homebrew 링크(`/opt/homebrew/bin/orca` 등)는 실제 위치가 번들 안 CLI일 때만 그 번들
pub fn fixed(home: &Path, local: Option<&Path>, win: bool) -> Vec<PathBuf> {
    if win {
        return local.map(|l| exe_in(&l.join("Programs").join("orca"), true)).into_iter().collect();
    }
    let mut v: Vec<PathBuf> = [PathBuf::from("/Applications"), home.join("Applications")]
        .iter()
        .map(|d| exe_in(&d.join("Orca.app"), false))
        .collect();
    for l in ["/opt/homebrew/bin/orca", "/usr/local/bin/orca"] {
        if let Some(b) = std::fs::canonicalize(l)
            .ok()
            .filter(|r| r.ends_with("Contents/Resources/bin/orca"))
            .and_then(|r| r.ancestors().nth(4).map(Path::to_path_buf))
        {
            v.push(exe_in(&b, false));
        }
    }
    v
}

/// Orca 찾기: 프로세스 → 레지스트리·Spotlight → 고정 후보. 어디서 찾았는지·못 찾은 이유를 `wlog!`로 남긴다
pub fn find(home: &Path, local: Option<&Path>, win: bool, run: Runner) -> Option<Install> {
    let mut why: Vec<String> = vec![];
    let first = |cands: Vec<PathBuf>, via: &'static str, why: &mut Vec<String>| {
        cands
            .iter()
            .find_map(|exe| verify(exe, win, via).map_err(|e| why.push(format!("{via}: {e}"))).ok())
    };
    let call = |(p, a): Cmd, via: &str, why: &mut Vec<String>| {
        run(&p, &a)
            .map_err(|e| why.push(format!("{via} 조회 실패: {e}")))
            .unwrap_or_default()
    };
    let procs = parse_procs(&call(procs_cmd(win), "프로세스", &mut why), win);
    if procs.is_empty() {
        why.push("실행 중인 Orca 없음".into());
    }
    let mut got = first(procs, "프로세스", &mut why);
    if got.is_none() {
        let (cands, via) = if win {
            let dirs: Vec<String> = reg_cmds()
                .into_iter()
                .flat_map(|c| parse_reg(&call(c, "레지스트리", &mut why)))
                .collect();
            (dirs.iter().map(|d| exe_in(Path::new(d), true)).collect(), "레지스트리")
        } else {
            let b = parse_mdfind(&call(mdfind_cmd(), "Spotlight", &mut why));
            (b.iter().map(|b| exe_in(b, false)).collect(), "Spotlight")
        };
        got = first(cands, via, &mut why).or_else(|| first(fixed(home, local, win), "고정", &mut why));
    }
    match &got {
        Some(i) => crate::wlog!("orca", "Orca CLI {} ({}에서 찾음)", i.cli.display(), i.via),
        None => crate::wlog!("orca", "Orca CLI를 찾지 못함 — {}", why.join(" · ")),
    }
    got
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 가짜 설치 폴더 (윈도우 구조 `Orca.exe` + `resources/bin/orca.exe`, 맥 구조 `X.app/Contents/…`)
    fn fake_install(tag: &str, win: bool) -> (PathBuf, PathBuf) {
        let d = std::env::temp_dir().join(format!("wr-orca-find-{tag}-{}", std::process::id()));
        let root = if win { d.join("orca") } else { d.join("Orca Beta.app") };
        let exe = exe_in(&root, win);
        let (_, cli) = from_exe(&exe, win).unwrap();
        for f in [&exe, &cli] {
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, "").unwrap();
        }
        (d, exe)
    }

    #[test]
    fn exe_to_cli_paths() {
        // 윈도우: 같은 폴더의 resources\bin\orca.exe (대소문자 무관)
        let (app, cli) = from_exe(Path::new("/u/AppData/Local/Programs/orca/ORCA.EXE"), true).unwrap();
        assert_eq!(app, Path::new("/u/AppData/Local/Programs/orca/ORCA.EXE"));
        assert_eq!(cli, Path::new("/u/AppData/Local/Programs/orca/resources/bin/orca.exe"));
        // 맥: 번들을 잘라 Contents/Resources/bin/orca (번들 이름은 상관없음)
        let (app, cli) = from_exe(Path::new("/Users/alex/Apps/Orca 2.app/Contents/MacOS/Orca"), false).unwrap();
        assert_eq!(app, Path::new("/Users/alex/Apps/Orca 2.app"));
        assert_eq!(cli, Path::new("/Users/alex/Apps/Orca 2.app/Contents/Resources/bin/orca"));
        for bad in [
            "/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper",
            "/Applications/Orca.app/Contents/Resources/bin/orca",
            "/tmp/MacOS/Orca",
            "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
        ] {
            assert_eq!(from_exe(Path::new(bad), false), None, "{bad}");
        }
        assert_eq!(from_exe(Path::new("/p/orca-slicer.exe"), true), None);
        assert_eq!(exe_in(Path::new("/p/orca"), true), Path::new("/p/orca/Orca.exe"));
        assert_eq!(
            exe_in(Path::new("/A/Orca.app"), false),
            Path::new("/A/Orca.app/Contents/MacOS/Orca")
        );
    }

    #[test]
    fn verify_inside_install() {
        for win in [true, false] {
            let (d, exe) = fake_install(if win { "vw" } else { "vm" }, win);
            let i = verify(&exe, win, "프로세스").unwrap();
            assert_eq!((i.win, i.via), (win, "프로세스"));
            assert!(i.cli.is_file());
            // CLI가 없으면 거부
            std::fs::remove_file(&i.cli).unwrap();
            assert!(verify(&exe, win, "고정").is_err());
            std::fs::remove_dir_all(&d).ok();
        }
        // 이름이 다른 exe는 거부 (파일이 있어도)
        let d = std::env::temp_dir().join(format!("wr-orca-find-name-{}", std::process::id()));
        std::fs::create_dir_all(d.join("resources/bin")).unwrap();
        std::fs::write(d.join("Other.exe"), "").unwrap();
        std::fs::write(d.join("resources/bin/orca.exe"), "").unwrap();
        assert!(verify(&d.join("Other.exe"), true, "프로세스").is_err());
        std::fs::remove_dir_all(&d).ok();
    }

    /// 설치 폴더 안의 CLI가 밖의 파일로 가는 링크면 거부
    #[cfg(unix)]
    #[test]
    fn verify_rejects_cli_outside() {
        let (d, exe) = fake_install("link", true);
        let (_, cli) = from_exe(&exe, true).unwrap();
        let evil = d.join("evil.exe");
        std::fs::write(&evil, "").unwrap();
        std::fs::remove_file(&cli).unwrap();
        std::os::unix::fs::symlink(&evil, &cli).unwrap();
        let e = verify(&exe, true, "프로세스").unwrap_err();
        assert!(e.contains("CLI가 설치 폴더 밖"), "{e}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn procs_parse() {
        let mac = "/sbin/launchd\n/Applications/Orca.app/Contents/MacOS/Orca\n\
                   /Applications/Orca.app/Contents/Frameworks/Orca Helper (Renderer).app/Contents/MacOS/Orca Helper (Renderer)\n\
                   /Applications/Orca.app/Contents/MacOS/Orca\n/usr/local/bin/orca\n";
        assert_eq!(
            parse_procs(mac, false),
            [
                PathBuf::from("/Applications/Orca.app/Contents/MacOS/Orca"),
                PathBuf::from("/usr/local/bin/orca")
            ]
        );
        let win = "C:\\Users\\김\\AppData\\Local\\Programs\\orca\\Orca.exe\r\n\r\nC:\\Users\\김\\AppData\\Local\\Programs\\orca\\Orca.exe\r\nC:\\x\\orca-slicer.exe\r\n";
        assert_eq!(
            parse_procs(win, true),
            [PathBuf::from("C:\\Users\\김\\AppData\\Local\\Programs\\orca\\Orca.exe")]
        );
        let (p, a) = procs_cmd(true);
        assert_eq!(p, Path::new(PS));
        assert_eq!(a[..3], ["-NoProfile", "-NonInteractive", "-Command"]);
        assert!(a[3].contains("Get-Process -Name Orca") && a[3].contains("UTF8"));
        assert_eq!(procs_cmd(false), (PathBuf::from("/bin/ps"), vec!["-axo".into(), "comm=".into()]));
    }

    #[test]
    fn reg_parse() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{1111}\r\n\
            \x20   DisplayName    REG_SZ    한컴오피스\r\n\
            \x20   InstallLocation    REG_SZ    C:\\Hnc\r\n\r\n\
            HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\5f8e-orca\r\n\
            \x20   DisplayName    REG_SZ    Orca 1.4.241\r\n\
            \x20   DisplayIcon    REG_SZ    C:\\Users\\alex\\AppData\\Local\\Programs\\orca\\Orca.exe,0\r\n\
            \x20   UninstallString    REG_SZ    \"C:\\Users\\alex\\AppData\\Local\\Programs\\orca\\Uninstall Orca.exe\" /currentuser\r\n\r\n\
            HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OrcaSlicer\r\n\
            \x20   DisplayName    REG_SZ    OrcaSlicer\r\n\
            \x20   InstallLocation    REG_SZ    C:\\Program Files\\OrcaSlicer\r\n\
            HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\orca2\r\n\
            \x20   InstallLocation    REG_SZ    \"D:\\Tools\\Orca\\\"\r\n\
            \x20   DisplayName    REG_SZ    Orca\r\n";
        assert_eq!(
            parse_reg(out),
            ["C:\\Users\\alex\\AppData\\Local\\Programs\\orca", "D:\\Tools\\Orca"]
        );
        assert_eq!(parse_reg(""), Vec::<String>::new());
        for (n, want) in [
            ("Orca", true),
            ("orca 2.0", true),
            (" Orca 1.4.241 ", true),
            ("OrcaSlicer", false),
            ("Orca Slicer", false),
            ("Orcanize 1", false),
        ] {
            assert_eq!(display_is_orca(n), want, "{n}");
        }
        let c = reg_cmds();
        assert_eq!(c[0].0, Path::new(REG));
        assert_eq!(c[0].1, ["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall", "/s"]);
        assert!(c[1].1[1].starts_with("HKLM\\"));
    }

    #[test]
    fn mdfind_parse() {
        assert_eq!(mdfind_cmd().1, ["kMDItemCFBundleIdentifier == 'com.stablyai.orca'"]);
        let out = "/Applications/Orca.app\n/Users/alex/.Trash/Orca.app\n/Volumes/Orca 1.4/Orca.app\n/Users/alex/Apps/Orca.app\n";
        assert_eq!(
            parse_mdfind(out),
            [PathBuf::from("/Applications/Orca.app"), PathBuf::from("/Users/alex/Apps/Orca.app")]
        );
    }

    #[test]
    fn front_cmd() {
        let i = Install {
            app: PathBuf::from("C:/u/Programs/orca/Orca.exe"),
            cli: PathBuf::from("C:/u/Programs/orca/resources/bin/orca.exe"),
            win: true,
            via: "프로세스",
        };
        assert_eq!(i.front(), (PathBuf::from("C:/u/Programs/orca/Orca.exe"), vec![]));
        let m = Install {
            app: PathBuf::from("/Applications/Orca.app"),
            win: false,
            ..i
        };
        assert_eq!(
            m.front(),
            (PathBuf::from("/usr/bin/open"), vec!["/Applications/Orca.app".to_string()])
        );
        assert_eq!(
            fixed(Path::new("/h"), Some(Path::new("/h/AppData/Local")), true),
            [PathBuf::from("/h/AppData/Local/Programs/orca/Orca.exe")]
        );
        assert!(fixed(Path::new("/h"), None, true).is_empty());
        assert_eq!(
            fixed(Path::new("/h"), None, false)[1],
            Path::new("/h/Applications/Orca.app/Contents/MacOS/Orca")
        );
    }

    /// 찾기 순서: 실행 중 프로세스 → (꺼져 있으면) 레지스트리 → 고정 후보
    #[test]
    fn find_order() {
        let (d, exe) = fake_install("order", true);
        let exe_s = exe.to_string_lossy().into_owned();
        let root_s = exe.parent().unwrap().to_string_lossy().into_owned();
        let none = Path::new("/nonexistent-local");
        // ① 프로세스 경로에서
        let log = std::cell::RefCell::new(vec![]);
        let run = |p: &Path, _: &[String]| -> Result<String, String> {
            log.borrow_mut().push(p.to_path_buf());
            Ok(format!("{exe_s}\r\n"))
        };
        let i = find(Path::new("/h"), Some(none), true, &run).unwrap();
        assert_eq!((i.app.as_path(), i.via), (exe.as_path(), "프로세스"));
        assert_eq!(*log.borrow(), [PathBuf::from(PS)], "프로세스에서 찾으면 레지스트리는 보지 않음");
        // ② 꺼져 있음 → 레지스트리 InstallLocation
        let reg =
            format!("HKEY_CURRENT_USER\\X\\orca\n    DisplayName    REG_SZ    Orca 1.4.0\n    InstallLocation    REG_SZ    {root_s}\n");
        let run = |p: &Path, _: &[String]| -> Result<String, String> {
            if p == Path::new(REG) {
                Ok(reg.clone())
            } else {
                Ok(String::new())
            }
        };
        assert_eq!(find(Path::new("/h"), Some(none), true, &run).unwrap().via, "레지스트리");
        // ③ 둘 다 실패 → %LOCALAPPDATA%\Programs\orca
        let local = d.join("local");
        std::fs::create_dir_all(local.join("Programs")).unwrap();
        std::fs::rename(exe.parent().unwrap(), local.join("Programs").join("orca")).unwrap();
        let fail = |_: &Path, _: &[String]| -> Result<String, String> { Err("시간 초과".into()) };
        let i = find(Path::new("/h"), Some(&local), true, &fail).unwrap();
        assert_eq!(i.via, "고정");
        // 어디에도 없으면 None
        assert_eq!(find(Path::new("/h"), Some(none), true, &fail), None);
        std::fs::remove_dir_all(&d).ok();
    }
}

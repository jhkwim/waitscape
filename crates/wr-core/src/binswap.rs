//! 실행 파일 교체 (앱이 sidecar `wr-hook`을 고정 경로로 복사할 때). 앱(`app/src-tauri/src/hooks.rs`)과 wr-hook 통합 테스트가 같은 코드를 쓴다.
//!
//! `wr-hook mcp`(MCP 보고 사이드카)는 CLI 세션 내내 떠 있다. Windows는 실행 중인 exe를 rename 대상으로 덮어쓸 수 없으므로
//! 기존 파일을 `wr-hook.old-<ms>-<pid>.exe`로 비켜 놓고(실행 중이어도 이름 변경은 됨) 새 파일을 넣는다. 실패하면 되돌린다.
//! 옛 파일은 다음 교체 때 정리(아직 실행 중이면 지워지지 않으니 그다음에 다시). macOS/Linux는 rename 덮어쓰기(실행 중 프로세스는 옛 inode).
//! 비켜 놓기 경로는 `aside` 인자로도 고를 수 있어 모든 OS의 CI에서 테스트한다. 의존성 없음(wr-hook 테스트가 `#[path]`로 포함).
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// 같은 초에 두 번 교체해도 이름이 겹치지 않게 밀리초 + pid
pub fn tag() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}-{}", std::process::id())
}

/// 비켜 놓은 옛 실행 파일 이름 (`wr-hook.old-<tag>.exe`)
pub fn old_name(bin: &Path, tag: &str) -> PathBuf {
    let stem = bin.file_stem().and_then(|s| s.to_str()).unwrap_or("wr-hook");
    let ext = bin
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    bin.with_file_name(format!("{stem}.old-{tag}{ext}"))
}

/// 지난번에 비켜 놓은 옛 실행 파일 정리 (실행 중이라 못 지운 것은 남는다). 지운 개수
pub fn sweep_old(bin: &Path) -> usize {
    let (Some(dir), Some(stem)) = (bin.parent(), bin.file_stem().and_then(|s| s.to_str())) else {
        return 0;
    };
    let pre = format!("{stem}.old-");
    let mut n = 0;
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.file_name().to_str().is_some_and(|f| f.starts_with(&pre)) && std::fs::remove_file(e.path()).is_ok() {
            n += 1;
        }
    }
    n
}

/// 새 파일(`tmp`)을 `bin` 자리에 넣는다. `aside`면 기존 파일을 먼저 비켜 놓는다(Windows 방식)
pub fn swap_in_with(tmp: &Path, bin: &Path, aside: bool) -> std::io::Result<()> {
    sweep_old(bin);
    if !aside || !bin.exists() {
        return std::fs::rename(tmp, bin);
    }
    let old = old_name(bin, &tag());
    std::fs::rename(bin, &old)?;
    std::fs::rename(tmp, bin).inspect_err(|_| {
        std::fs::rename(&old, bin).ok();
    })
}

/// 이 OS에 맞게 교체 (Windows만 비켜 놓기)
pub fn swap_in(tmp: &Path, bin: &Path) -> std::io::Result<()> {
    swap_in_with(tmp, bin, cfg!(windows))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wr-swap-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn names_and_tags() {
        let d = PathBuf::from("bin");
        assert_eq!(old_name(&d.join("wr-hook.exe"), "42"), d.join("wr-hook.old-42.exe"));
        assert_eq!(old_name(&d.join("wr-hook"), "42"), d.join("wr-hook.old-42"));
        assert!(tag().ends_with(&format!("-{}", std::process::id())));
    }

    /// 비켜 놓기 경로(Windows 방식)를 모든 OS에서: 새 내용이 들어가고, 옛 파일이 남았다가 다음 교체 때 정리된다
    #[test]
    fn aside_swap_and_sweep() {
        let d = dir("aside");
        let bin = d.join("wr-hook.exe");
        std::fs::write(&bin, b"v1").unwrap();
        let tmp = d.join(".wr-hook.tmp");
        std::fs::write(&tmp, b"v2").unwrap();
        swap_in_with(&tmp, &bin, true).unwrap();
        assert_eq!(std::fs::read(&bin).unwrap(), b"v2");
        assert!(!tmp.exists());
        let olds = || {
            std::fs::read_dir(&d)
                .unwrap()
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().contains(".old-"))
                .count()
        };
        assert_eq!(olds(), 1);
        std::fs::write(&tmp, b"v3").unwrap();
        swap_in_with(&tmp, &bin, true).unwrap();
        assert_eq!(
            (std::fs::read(&bin).unwrap(), olds()),
            (b"v3".to_vec(), 1),
            "지난 옛 파일은 정리, 이번 것 하나"
        );
        // 새 파일이 없으면 실패하고 원래 파일로 되돌린다
        assert!(swap_in_with(&d.join("missing"), &bin, true).is_err());
        assert_eq!(std::fs::read(&bin).unwrap(), b"v3");
        // 덮어쓰기 방식
        std::fs::write(&tmp, b"v4").unwrap();
        swap_in_with(&tmp, &bin, false).unwrap();
        assert_eq!(std::fs::read(&bin).unwrap(), b"v4");
        std::fs::remove_dir_all(&d).ok();
    }
}

//! 크로스플랫폼 경로 (맥·윈도우 홈, `CLAUDE_CONFIG_DIR`). 환경 조회는 `EnvSource`로 주입 가능.

use std::path::PathBuf;

/// 환경변수 읽기 (테스트에서 바꿔 끼울 수 있게)
pub trait EnvSource {
    fn var(&self, k: &str) -> Option<String>;
}

/// 실제 프로세스 환경
pub struct OsEnv;

impl EnvSource for OsEnv {
    fn var(&self, k: &str) -> Option<String> {
        std::env::var(k).ok().filter(|v| !v.is_empty())
    }
}

/// 맵 기반 환경 (테스트용)
impl EnvSource for std::collections::HashMap<String, String> {
    fn var(&self, k: &str) -> Option<String> {
        self.get(k).cloned().filter(|v| !v.is_empty())
    }
}

/// 사용자 홈: 유닉스 `HOME`, 윈도우 `USERPROFILE`(없으면 `HOMEDRIVE`+`HOMEPATH`)
pub fn home_dir(env: &dyn EnvSource) -> PathBuf {
    if cfg!(windows) {
        if let Some(p) = env.var("USERPROFILE") {
            return PathBuf::from(p);
        }
        if let (Some(d), Some(p)) = (env.var("HOMEDRIVE"), env.var("HOMEPATH")) {
            return PathBuf::from(format!("{d}{p}"));
        }
        env.var("HOME").map(PathBuf::from).unwrap_or_default()
    } else {
        env.var("HOME")
            .or_else(|| env.var("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_default()
    }
}

/// `~` 확장 (앞의 `~/` 또는 `~` 하나만)
pub fn expand_tilde(p: &str, home: &std::path::Path) -> PathBuf {
    if p == "~" {
        home.to_path_buf()
    } else if let Some(r) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        home.join(r)
    } else {
        PathBuf::from(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn home_and_tilde() {
        let mut e = HashMap::new();
        e.insert("HOME".to_string(), "/Users/alex".to_string());
        e.insert("USERPROFILE".to_string(), r"C:\Users\alex".to_string());
        let h = home_dir(&e);
        if cfg!(windows) {
            assert_eq!(h, PathBuf::from(r"C:\Users\alex"));
        } else {
            assert_eq!(h, PathBuf::from("/Users/alex"));
        }
        assert_eq!(expand_tilde("~/x", std::path::Path::new("/h")), PathBuf::from("/h/x"));
    }
}

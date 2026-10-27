//! 숨길 프로젝트 규칙: 플러그인이 만드는 내부 세션(예: claude-mem 관찰자)과 사용자가 지정한 패턴.
//!
//! 패턴은 **부분 문자열**(대소문자 무시)이고, 비교 전에 양쪽을 같은 방식으로 정규화한다: 영숫자가 아닌 글자는 모두 `-`.
//! Claude Code가 프로젝트 폴더 이름을 만드는 방식(`/Users/alex/.claude-mem/x` → `-Users-alex--claude-mem-x`)과 같아서,
//! 패턴 `.claude-mem/observer-sessions`이 폴더 이름에도, 작업 폴더(cwd) 경로에도 맞는다.
//! 폴더 이름에 맞으면 그 폴더의 트랜스크립트는 **스캔 자체를 건너뛴다**(수천 개 파일을 매번 읽지 않도록).

/// 기본으로 숨기는 플러그인 내부 세션 (데이터). 웹(core-lib.js `DEFAULT_HIDE_PROJECTS`)·server.py `DEFAULT_HIDE`와 같은 목록
pub const DEFAULT_HIDE: &[&str] = &[".claude-mem/observer-sessions"];

fn norm(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_lowercase().next().unwrap_or(c)
            } else {
                '-'
            }
        })
        .collect()
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct HideRules {
    /// 정규화된 패턴
    pats: Vec<String>,
}

impl HideRules {
    /// `builtin`이면 기본 목록을 더한다. 영숫자가 하나도 없는 패턴(빈 값·`/`)은 모든 것에 맞으므로 버린다.
    pub fn new(user: &[String], builtin: bool) -> HideRules {
        let mut pats: Vec<String> = vec![];
        let base = if builtin { DEFAULT_HIDE } else { &[] };
        for p in base.iter().copied().chain(user.iter().map(|s| s.as_str())) {
            let p = p.trim();
            if !p.chars().any(|c| c.is_alphanumeric()) {
                continue;
            }
            let n = norm(p);
            if !pats.contains(&n) {
                pats.push(n);
            }
        }
        HideRules { pats }
    }

    pub fn is_empty(&self) -> bool {
        self.pats.is_empty()
    }

    /// 경로(cwd) 또는 프로젝트 폴더 이름이 숨김 대상인가
    pub fn matches(&self, path_or_dir: &str) -> bool {
        if self.pats.is_empty() || path_or_dir.is_empty() {
            return false;
        }
        let n = norm(path_or_dir);
        self.pats.iter().any(|p| n.contains(p.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_matches_dir_and_cwd() {
        let r = HideRules::new(&[], true);
        assert!(r.matches("-Users-alex--claude-mem-observer-sessions"));
        assert!(r.matches("/Users/alex/.claude-mem/observer-sessions"));
        assert!(r.matches("C:\\Users\\alex\\.claude-mem\\observer-sessions"));
        assert!(!r.matches("-Users-alex-Documents-ai"));
        assert!(!r.matches(""));
        assert!(!HideRules::new(&[], false).matches("-Users-alex--claude-mem-observer-sessions"));
    }

    #[test]
    fn user_patterns() {
        let r = HideRules::new(&["My-Scratch".into(), "  ".into(), "/".into(), "".into()], false);
        assert!(!r.is_empty());
        assert!(r.matches("/work/my_scratch/app"));
        assert!(r.matches("-work-my-scratch-app"));
        assert!(!r.matches("/work/other"));
        assert!(HideRules::new(&["/".into(), "".into()], false).is_empty());
        assert!(HideRules::new(&["프로젝트".into()], false).matches("/work/프로젝트/a"));
    }
}

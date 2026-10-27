//! 화면에 내보내는 자유 텍스트 가공 (공통). server.py `clip()` 이식.

use crate::py::{clen, squash_ws, take};
use crate::redact::redact;
use regex::Regex;
use std::sync::OnceLock;

pub const TEXT_MAX: usize = 160;

fn scratch_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"/private/tmp/claude-\d+/[^/\s]+/[^/\s]+/scratchpad/").unwrap())
}

/// 마스킹 → 스크래치 경로 축약 → cwd 상대화 → 홈 `~` → 공백 정리 → n자 절단(…)
/// (마스킹을 먼저 해야 잘린 비밀 조각이 새지 않음)
pub fn clip(s: &str, n: usize, cwd: &str, home: &str) -> String {
    let s = redact(s);
    let mut s = scratch_re().replace_all(&s, "scratch/").into_owned();
    if clen(cwd) > 1 {
        let sep = if cwd.contains('\\') && !cwd.contains('/') { '\\' } else { '/' };
        let pre = format!("{}{}", cwd.trim_end_matches(sep), sep);
        s = s.replace(&pre, "");
    }
    if !home.is_empty() {
        s = s.replace(home, "~");
    }
    let s = squash_ws(&s);
    if clen(&s) > n {
        let mut t = take(&s, n - 1).to_string();
        t.push('…');
        t
    } else {
        s
    }
}

/// `" ".join(redact(s).split())[:n]` (말줄임표 없이 자름 — scan()의 say)
pub fn say(s: &str, n: usize) -> String {
    take(&squash_ws(&redact(s)), n).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_order() {
        let home = "/Users/alex";
        assert_eq!(clip("/Users/alex/dev/x/a.py", 160, "/Users/alex/dev/x", home), "a.py");
        assert_eq!(clip("/Users/alex/other", 160, "", home), "~/other");
        assert_eq!(clip("a  b\nc", 4, "", home), "a b…");
        let k = ["sk-", "ant-", "zzzzzzzzzzzz"].concat();
        let out = clip(&format!("{k} tail"), 8, "", home);
        assert!(!out.contains("zzzz"));
        assert_eq!(clip("/private/tmp/claude-501/a/b/scratchpad/f.txt", 160, "", home), "scratch/f.txt");
    }
}

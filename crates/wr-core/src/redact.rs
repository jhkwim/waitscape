//! 민감 정보 마스킹 (server.py `SECRET`/`BEARER`/`SECRET_KV`/`redact()`와 같은 정규식).
//! 여러 번 적용해도 결과가 같다(idempotent). 마스킹 → 절단 순서를 지키는 것은 호출하는 쪽 책임.
//!
//! wr-hook도 이 파일을 `#[path]`로 포함한다(의존성: regex만).
#![allow(dead_code)]

use regex::Regex;
use std::borrow::Cow;
use std::sync::OnceLock;

pub const MASK: &str = "<REDACTED>";

struct Pats {
    secret: Regex,
    bearer: Regex,
    kv: Regex,
}

fn pats() -> &'static Pats {
    static P: OnceLock<Pats> = OnceLock::new();
    P.get_or_init(|| Pats {
        secret: Regex::new(
            r"(?-u)sk-ant-[\w-]+|\bgh[pousr]_\w{8,}|\bgithub_pat_\w+|\bAKIA[0-9A-Z]{12,}|\bxox[bpasr]-[\w-]+|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*",
        )
        .expect("secret regex"),
        bearer: Regex::new(r"(?i-u)\b(Bearer|Basic)\s+[\w.~+/=-]{8,}").expect("bearer regex"),
        kv: Regex::new(
            r#"(?i)((?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?)([^\s"'&,;)}\]]+)"#,
        )
        .expect("kv regex"),
    })
}

/// 정규식이 하나도 맞지 않을 만한 짧은 문자열은 빨리 통과시킨다.
fn maybe_secret(s: &str) -> bool {
    // 모든 패턴은 최소 3글자 ASCII 접두어를 가진다(sk-, gh?, git, AKI, xox, eyJ, bea/bas, 키 이름들)
    s.len() >= 3
}

/// `redact(s)`
pub fn redact(s: &str) -> String {
    redact_cow(s).into_owned()
}

pub fn redact_cow(s: &str) -> Cow<'_, str> {
    if !maybe_secret(s) {
        return Cow::Borrowed(s);
    }
    let p = pats();
    let a = p.secret.replace_all(s, MASK);
    let b = p
        .bearer
        .replace_all(&a, |c: &regex::Captures| format!("{} {}", &c[1], MASK))
        .into_owned();
    let c =
        p.kv.replace_all(&b, |c: &regex::Captures| format!("{}{}", &c[1], MASK))
            .into_owned();
    if c == s {
        Cow::Borrowed(s)
    } else {
        Cow::Owned(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 시크릿 감지 도구(check_secrets.py 등)에 걸리지 않도록 테스트 키는 조각을 이어 붙여 만든다.
    fn j(parts: &[&str]) -> String {
        parts.concat()
    }

    // 리뷰 F1: 한글 등 비ASCII 문자 바로 뒤에 붙은 시크릿도 마스킹(\b·\w는 ASCII 기준)
    #[test]
    fn masks_after_non_ascii() {
        let g = j(&["gh", "p_", "aBcDeFgH12345678"]);
        let a = j(&["AK", "IA", "ABCDEFGHIJKLMNOP"]);
        for (pre, k) in [("토큰", g.as_str()), ("키", a.as_str()), ("인증Bearer ", "abcdefgh12345678")] {
            let out = redact(&format!("{pre}{k}입니다"));
            assert!(!out.contains(k), "{out}");
            assert!(out.contains(MASK), "{out}");
        }
        // 시크릿 뒤에 붙은 한글 조사는 보존
        assert!(redact(&format!("{g}를")).ends_with("를"));
    }

    #[test]
    fn masks_token_patterns() {
        let cases = [
            j(&["sk-", "ant-", "api03-", "AbCdEf0123456789"]),
            j(&["gh", "p_", "aBcDeFgH12345678"]),
            j(&["github", "_pat_", "11ABCDEFG0123456789"]),
            j(&["AK", "IA", "ABCDEFGHIJKLMNOP"]),
            j(&["xo", "xb-", "1234-5678-abcdef"]),
            j(&["ey", "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "sig_abc"]),
        ];
        for k in &cases {
            let out = redact(&format!("key {} end", k));
            assert!(!out.contains(k.as_str()), "{out}");
            assert!(out.contains(MASK));
        }
    }

    #[test]
    fn masks_bearer_and_kv() {
        let b = j(&["Bea", "rer ", "abcdefgh12345678"]);
        // server.py와 같음: Bearer 값이 먼저 가려지고, "Authorization:" 키 값(Bearer)도 가려진다
        assert_eq!(redact(&format!("Authorization: {b}")), "Authorization: <REDACTED> <REDACTED>");
        assert_eq!(redact(&format!("curl -H '{b}'")), "curl -H 'Bearer <REDACTED>'");
        let pw = j(&["pass", "word=", "hunter2"]);
        assert_eq!(redact(&pw), "password=<REDACTED>");
        assert_eq!(redact("API_KEY: \"abc\""), "API_KEY: \"<REDACTED>\"");
        assert_eq!(redact("평범한 문장"), "평범한 문장");
    }

    #[test]
    fn idempotent() {
        let s = format!(
            "{} token=x1 {}",
            j(&["gh", "o_", "12345678abcd"]),
            j(&["Bas", "ic ", "QWxhZGRpbjpvcGVu"])
        );
        let once = redact(&s);
        assert_eq!(redact(&once), once);
    }
}

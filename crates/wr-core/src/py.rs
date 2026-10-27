//! Python 참조 구현(server.py/hook.py)과 결과를 맞추기 위한 작은 도우미.
//! 길이·절단은 코드 포인트 기준(파이썬 str), 공백은 파이썬 `str.split()`과 같은 집합을 쓴다.
//!
//! 이 파일은 wr-hook에서도 `#[path]`로 그대로 포함하므로 serde_json 외 의존성을 쓰지 않는다.
#![allow(dead_code)]

use serde_json::Value;

/// 파이썬 `str.isspace()`와 같은 공백 판정 (Rust `char::is_whitespace` + \x1c–\x1f).
pub fn is_py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// `" ".join(s.split())`
pub fn squash_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for w in s.split(is_py_space).filter(|w| !w.is_empty()) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    out
}

/// `s.strip()`
pub fn strip(s: &str) -> &str {
    s.trim_matches(is_py_space)
}

/// 코드 포인트 수
pub fn clen(s: &str) -> usize {
    s.chars().count()
}

/// `s[:n]` (코드 포인트)
pub fn take(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// `s if len(s) <= n else s[:n-1] + "…"`
pub fn ellipsize(s: String, n: usize) -> String {
    if clen(&s) <= n {
        s
    } else {
        let mut t = take(&s, n.saturating_sub(1)).to_string();
        t.push('…');
        t
    }
}

/// 파이썬 진릿값
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// `d.get(k)` (객체가 아니면 None)
pub fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(k))
}

/// `d.get(k)`가 참이면 그 값
pub fn get_truthy<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    get(v, k).filter(|x| truthy(x))
}

/// 파이썬 `str(x)`의 근사 (None→"None", True→"True", 정수→숫자, 실수→repr, 문자열 그대로)
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if n.is_f64() {
                let f = n.as_f64().unwrap_or(0.0);
                if f.fract() == 0.0 && f.abs() < 1e16 {
                    format!("{:.1}", f)
                } else {
                    format!("{}", f)
                }
            } else {
                n.to_string()
            }
        }
        other => other.to_string(),
    }
}

/// `str(s or "")`
pub fn py_str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// 문자열이면 그 값, 아니면 None
pub fn as_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(|x| x.as_str())
}

/// `os.path.basename(p.rstrip("/")) or "?"` — 윈도우 경로(\)도 나눈다.
pub fn project_name(cwd: &str) -> String {
    let t = cwd.trim_end_matches(['/', '\\']);
    let base = t.rsplit(['/', '\\']).next().unwrap_or("");
    if base.is_empty() {
        "?".into()
    } else {
        base.to_string()
    }
}

/// `os.path.basename(p)` (/ 와 \ 모두)
pub fn basename(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or("")
}

/// 파이썬 `int(s)` 근사: 앞뒤 공백, 부호, 숫자 사이 밑줄 허용. 실패하면 None.
pub fn py_int(s: &str) -> Option<i64> {
    let t = strip(s);
    let (neg, digits) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    if digits.is_empty() || digits.starts_with('_') || digits.ends_with('_') || digits.contains("__") {
        return None;
    }
    let mut n: i128 = 0;
    for c in digits.chars() {
        if c == '_' {
            continue;
        }
        let d = c.to_digit(10)? as i128;
        n = (n * 10 + d).min(i64::MAX as i128 + 1);
    }
    let n = if neg { -n } else { n };
    Some(n.clamp(i64::MIN as i128, i64::MAX as i128) as i64)
}

/// 숫자 Value → f64
pub fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn squash_and_ellipsize() {
        assert_eq!(squash_ws("  a \n b\u{1f}c  "), "a b c");
        assert_eq!(ellipsize("가나다라".into(), 3), "가나…");
        assert_eq!(ellipsize("가나다".into(), 3), "가나다");
        assert_eq!(take("가나다", 2), "가나");
    }

    #[test]
    fn ints_and_names() {
        assert_eq!(py_int(" 1_0 "), Some(10));
        assert_eq!(py_int("-3"), Some(-3));
        assert_eq!(py_int("x"), None);
        assert_eq!(project_name("/Users/alex/dev/shop/"), "shop");
        assert_eq!(project_name(r"C:\Users\alex\proj"), "proj");
        assert_eq!(project_name(""), "?");
        assert_eq!(py_str(&serde_json::json!(5)), "5");
        assert_eq!(py_str(&serde_json::json!(null)), "None");
    }
}

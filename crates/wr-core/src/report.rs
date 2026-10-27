//! MCP 보고(`waitscape_status`·`waitscape_board`) 입력 정화와 접기 — 사이드카(`wr-hook mcp`)·훅 분기(`wr-hook`)·리더
//! (`providers::mcp`, Claude 훅 리더)가 **같은 코드**를 쓴다. Python은 `mcp_report.py`(같은 규칙, 공유 fixture `fixtures/mcp/sanitize.json`).
//!
//! - 문자열: 제어문자(Cc) 제거(개행·탭·CR은 공백) → 형식 문자(Cf 표 `FORMAT`) 제거 → NFC 정규화 → 공백 정리·trim → `redact()` → 문자 수 절단(…)
//!   (NFC: NFD 한글 자모·결합 악센트를 완성형으로 — Python `unicodedata.normalize("NFC")`와 같은 결과, 공유 fixture)
//! - 숫자: `1 ≤ step ≤ total ≤ 99`일 때만 둘 다 남긴다(하나라도 어긋나면 둘 다 버림). bool·실수는 정수가 아님
//! - 검증 실패(필수 인자 없음·enum 밖·`lines`가 배열 아님)는 `Err(고칠 방법 한 줄)` → 사이드카가 `isError`로 돌려준다.
//!   길이 초과·범위 밖 값은 조용히 정화한다(모델이 재시도하지 않게).
//!
//! wr-hook도 이 파일을 `#[path]`로 포함하므로 `crate::py`, `crate::redact`, serde_json, icu_normalizer만 쓴다.
#![allow(dead_code)]

use crate::py::{ellipsize, squash_ws};
use crate::redact::redact;
use serde_json::{json, Map, Value};

pub const TITLE_MAX: usize = 60;
pub const CHEER_MAX: usize = 60;
pub const LINE_MAX: usize = 32;
pub const LINES_MAX: usize = 4;
pub const STEP_MAX: i64 = 99;
pub const STATES: [&str; 3] = ["working", "asking", "done"];
/// 기록 줄 형식 버전 (리더는 모르는 값을 무시)
pub const VERSION: i64 = 1;
/// 큰 일 축하(`big`)를 보여 주는 시간 (done 뒤 10분)
pub const BIG_FOR: f64 = 600.0;
/// 훅 이벤트의 도구 이름 접두어 (Claude Code: `mcp__<서버>__<도구>`)
pub const HOOK_PREFIX: &str = "mcp__waitscape__";
/// 기록 줄의 `provider` 값
pub const PROVIDERS: [&str; 4] = ["claude", "codex", "gemini", "other"];

const STATE_ERR: &str = "state must be one of: working, asking, done";
const LINES_ERR: &str = "lines must be an array of 1-4 short strings";

/// 보이지 않는 형식 문자(유니코드 일반 범주 Cf) — 토큰 사이에 끼워 마스킹 정규식을 피하는 데 쓰일 수 있어 지운다.
/// 범주 API가 없고 유니코드 버전에 따라 범주가 달라질 수 있으므로 Python(`mcp_report.py` `FORMAT`)과 같은 표를 하드코딩한다.
pub const FORMAT: [(u32, u32); 11] = [
    (0x00AD, 0x00AD),   // soft hyphen
    (0x061C, 0x061C),   // arabic letter mark
    (0x180E, 0x180E),   // mongolian vowel separator
    (0x200B, 0x200F),   // zero width space/non-joiner/joiner, LRM, RLM
    (0x202A, 0x202E),   // bidi embedding·override
    (0x2060, 0x2064),   // word joiner, invisible operators
    (0x2066, 0x206F),   // bidi isolate, deprecated format
    (0xFEFF, 0xFEFF),   // BOM / zero width no-break space
    (0xFFF9, 0xFFFB),   // interlinear annotation
    (0xE0001, 0xE0001), // language tag
    (0xE0020, 0xE007F), // tag characters
];

fn invisible(c: char) -> bool {
    let c = c as u32;
    FORMAT.iter().any(|&(a, b)| a <= c && c <= b)
}

/// 자유 텍스트 한 줄 정화 (`n`자, 넘으면 끝을 …로)
pub fn clean(s: &str, n: usize) -> String {
    let mut t = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\n' | '\t' | '\r') {
            t.push(' ');
        } else if !c.is_control() && !invisible(c) {
            t.push(c);
        }
    }
    let t = icu_normalizer::ComposingNormalizerBorrowed::new_nfc().normalize(&t);
    ellipsize(squash_ws(&redact(&squash_ws(&t))), n)
}

/// JSON 정수 (bool·실수·문자열은 아님)
fn int(v: Option<&Value>) -> Option<i64> {
    v.filter(|x| x.is_i64() || x.is_u64()).and_then(|x| x.as_i64())
}

fn text(v: Option<&Value>, n: usize) -> Option<String> {
    v.and_then(|x| x.as_str()).map(|s| clean(s, n)).filter(|s| !s.is_empty())
}

/// `waitscape_status` 인자 → `{state, title?, step?, total?, big?, cheer?}` (big·cheer는 done일 때만)
pub fn status_of(d: &Value) -> Result<Map<String, Value>, String> {
    let st = d
        .get("state")
        .and_then(|v| v.as_str())
        .filter(|s| STATES.contains(s))
        .ok_or(STATE_ERR)?;
    let mut o = Map::new();
    o.insert("state".into(), json!(st));
    if let Some(t) = text(d.get("title"), TITLE_MAX) {
        o.insert("title".into(), json!(t));
    }
    if let (Some(a), Some(b)) = (int(d.get("step")), int(d.get("total"))) {
        if 1 <= a && a <= b && b <= STEP_MAX {
            o.insert("step".into(), json!(a));
            o.insert("total".into(), json!(b));
        }
    }
    if st == "done" {
        if d.get("big") == Some(&Value::Bool(true)) {
            o.insert("big".into(), json!(true));
        }
        if let Some(c) = text(d.get("cheer"), CHEER_MAX) {
            o.insert("cheer".into(), json!(c));
        }
    }
    Ok(o)
}

/// `waitscape_board` 인자 → `{lines, done}` (앞 4줄, 줄당 32자, done은 줄 범위 안의 고유 번호 오름차순)
pub fn board_of(d: &Value) -> Result<Map<String, Value>, String> {
    let arr = d.get("lines").and_then(|v| v.as_array()).ok_or(LINES_ERR)?;
    let lines: Vec<String> = arr
        .iter()
        .take(LINES_MAX)
        .map(|v| v.as_str().map(|s| clean(s, LINE_MAX)).unwrap_or_default())
        .collect();
    if lines.iter().all(|l| l.is_empty()) {
        return Err(LINES_ERR.into());
    }
    let mut done: Vec<i64> = d
        .get("done")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| int(Some(v)))
        .filter(|&i| 0 <= i && (i as usize) < lines.len())
        .collect();
    done.sort_unstable();
    done.dedup();
    let mut o = Map::new();
    o.insert("lines".into(), json!(lines));
    o.insert("done".into(), json!(done));
    Ok(o)
}

/// MCP `clientInfo.name` → 프로바이더 (Antigravity CLI는 Gemini 소품을 같이 쓴다)
pub fn provider_of(client: &str) -> &'static str {
    let c = client.to_ascii_lowercase();
    if c.contains("claude") {
        "claude"
    } else if c.contains("codex") {
        "codex"
    } else if c.contains("gemini") || c.contains("antigravity") {
        "gemini"
    } else {
        "other"
    }
}

/// 기록 줄의 세션 키로 쓸 수 있나 (영숫자·`-_.`, 1–120자)
pub fn key_ok(k: &str) -> bool {
    !k.is_empty() && k.len() <= 120 && k.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// 보고를 순서대로 접은 결과 (세션 하나). `state.d.ts` `Report`로 내보낸다
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fold {
    /// 마지막 보고 시각
    pub ts: f64,
    pub state: Option<String>,
    pub title: Option<String>,
    pub step: Option<(i64, i64)>,
    /// (줄, 끝난 줄 번호, 시각)
    pub board: Option<(Vec<String>, Vec<i64>, f64)>,
    /// state=done이고 big일 때 그 시각
    pub big: Option<f64>,
    pub cheer: Option<String>,
}

impl Fold {
    /// status 보고 반영 (`m`은 `status_of` 결과). 제목이 없으면 직전 제목을 이어 쓴다(예: 제목 없는 done)
    pub fn status(&mut self, m: &Map<String, Value>, ts: f64) {
        let st = m.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if let Some(t) = m.get("title").and_then(|v| v.as_str()) {
            self.title = Some(t.to_string());
        }
        self.step = match (int(m.get("step")), int(m.get("total"))) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => None,
        };
        let done = st == "done";
        self.big = (done && m.get("big") == Some(&Value::Bool(true))).then_some(ts);
        self.cheer = if done {
            m.get("cheer").and_then(|v| v.as_str()).map(String::from)
        } else {
            None
        };
        self.state = Some(st);
        self.ts = self.ts.max(ts);
    }

    /// board 보고 반영 (`m`은 `board_of` 결과)
    pub fn board(&mut self, m: &Map<String, Value>, ts: f64) {
        let lines = m
            .get("lines")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect())
            .unwrap_or_default();
        let done = m
            .get("done")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
            .unwrap_or_default();
        self.board = Some((lines, done, ts));
        self.ts = self.ts.max(ts);
    }

    /// `state.d.ts` `Report`
    pub fn value(&self, now: f64) -> Value {
        let mut o = Map::new();
        o.insert("source".into(), json!("mcp"));
        o.insert("ts".into(), json!(self.ts));
        if let Some(s) = &self.state {
            o.insert("state".into(), json!(s));
        }
        if let Some(t) = &self.title {
            o.insert("title".into(), json!(t));
        }
        if let Some((a, b)) = self.step {
            o.insert("step".into(), json!(a));
            o.insert("total".into(), json!(b));
        }
        if let Some((lines, done, ts)) = &self.board {
            o.insert("board".into(), json!({"lines": lines, "done": done, "ts": ts}));
        }
        if let Some(t) = self.big.filter(|&t| now - t < BIG_FOR) {
            o.insert("big".into(), json!({"title": self.title.clone().unwrap_or_default(), "ts": t}));
        }
        if let Some(c) = &self.cheer {
            o.insert("cheer".into(), json!(c));
        }
        Value::Object(o)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 공유 fixture: Python mcp_report.py(scripts/test_mcp_reports.py)와 같은 결과여야 한다
    #[test]
    fn shared_sanitize_fixture() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/mcp/sanitize.json");
        let fx: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        let secrets: Vec<(String, String)> = {
            let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fake_secrets.json");
            let d: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
            d.as_object()
                .unwrap()
                .iter()
                .filter(|(k, _)| !k.starts_with('$'))
                .map(|(k, v)| {
                    let s: String = v.as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
                    (format!("@@FAKE_{k}@@"), s)
                })
                .collect()
        };
        let fill = |s: &str| secrets.iter().fold(s.to_string(), |a, (k, v)| a.replace(k, v));
        for c in fx["clean"].as_array().unwrap() {
            let got = clean(&fill(c["in"].as_str().unwrap()), c["n"].as_u64().unwrap() as usize);
            assert_eq!(got, c["out"].as_str().unwrap(), "clean {c}");
        }
        for (k, f) in [("status", status_of as fn(&Value) -> _), ("board", board_of)] {
            for c in fx[k].as_array().unwrap() {
                let inp: Value = serde_json::from_str(&fill(&c["in"].to_string())).unwrap();
                let got = match f(&inp) {
                    Ok(m) => Value::Object(m),
                    Err(e) => json!({"error": e}),
                };
                assert_eq!(got, c["out"], "{k} {}", c["in"]);
            }
        }
    }

    #[test]
    fn providers_and_keys() {
        assert_eq!(provider_of("claude-code"), "claude");
        assert_eq!(provider_of("codex-mcp-client"), "codex");
        assert_eq!(provider_of("gemini-cli-mcp-client"), "gemini");
        assert_eq!(provider_of("Antigravity"), "gemini");
        assert_eq!(provider_of("cursor"), "other");
        assert!(key_ok("codex-48213-1761379800000-0a1b2c3d"));
        assert!(!key_ok("../x") && !key_ok("") && !key_ok(&"a".repeat(121)));
    }

    #[test]
    fn fold_keeps_title_and_expires_big() {
        let mut f = Fold::default();
        f.status(
            &status_of(&json!({"state": "working", "title": "결제 리팩터", "step": 2, "total": 5})).unwrap(),
            10.0,
        );
        f.status(
            &status_of(&json!({"state": "done", "big": true, "cheer": "잘했어요"})).unwrap(),
            20.0,
        );
        let v = f.value(30.0);
        assert_eq!(v["title"], json!("결제 리팩터"));
        assert!(v.get("step").is_none(), "단계는 이어 쓰지 않는다");
        assert_eq!(v["big"], json!({"title": "결제 리팩터", "ts": 20.0}));
        assert_eq!(v["cheer"], json!("잘했어요"));
        assert!(f.value(20.0 + BIG_FOR).get("big").is_none());
    }
}

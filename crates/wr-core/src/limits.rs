//! 사용 한도 조회 공통 부분: 주기·지수 백오프·Retry-After, 비밀 문자열 래퍼.
//! 프로바이더별 API 클라이언트(예: `providers::claude::usage`)가 이 틀을 쓴다.

use serde_json::{Map, Value};
use zeroize::Zeroizing;

/// 기본 조회 주기 (초)
pub const INTERVAL: f64 = 120.0;
/// 백오프 상한 (초)
pub const MAX_BACKOFF: f64 = 3600.0;

/// 메모리에만 두는 토큰. Debug/Display는 `***`, 드롭 시 0으로 지움.
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(s: String) -> Secret {
        Secret(Zeroizing::new(s))
    }
    /// 헤더에 넣을 때만 꺼낸다
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("***")
    }
}

impl std::fmt::Display for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("***")
    }
}

/// 다음 조회 시각 계산기
#[derive(Debug, Clone, PartialEq)]
pub struct Backoff {
    pub interval: f64,
    /// 연속 429 횟수
    pub strikes: u32,
    /// 다음 조회 가능 시각 (epoch 초)
    pub next_at: f64,
    /// 401/403 이후: 토큰을 다시 읽기 전까지 멈춤
    pub halted: bool,
}

impl Default for Backoff {
    fn default() -> Self {
        Backoff {
            interval: INTERVAL,
            strikes: 0,
            next_at: 0.0,
            halted: false,
        }
    }
}

impl Backoff {
    pub fn due(&self, now: f64) -> bool {
        !self.halted && now >= self.next_at
    }
    pub fn ok(&mut self, now: f64) {
        self.strikes = 0;
        self.next_at = now + self.interval;
    }
    /// 429: Retry-After(초)가 있으면 그것, 없으면 2·4·8…분(최대 60분)
    pub fn too_many(&mut self, now: f64, retry_after: Option<f64>) {
        self.strikes += 1;
        let wait = match retry_after {
            Some(s) if s.is_finite() && s >= 0.0 => s.min(MAX_BACKOFF),
            _ => (120.0 * 2f64.powi(self.strikes as i32 - 1)).min(MAX_BACKOFF),
        };
        self.next_at = now + wait.max(1.0);
    }
    /// 네트워크 오류 등: 평소 주기로 다시
    pub fn failed(&mut self, now: f64) {
        self.next_at = now + self.interval;
    }
    /// 401/403: 토큰 무효 → 다시 읽기 전까지 중단
    pub fn halt(&mut self) {
        self.halted = true;
    }
    pub fn resume(&mut self) {
        self.halted = false;
        self.strikes = 0;
        self.next_at = 0.0;
    }
}

/// Retry-After 헤더: 초 단위 정수만 해석 (HTTP-date는 무시 → 지수 백오프)
pub fn parse_retry_after(v: Option<&str>) -> Option<f64> {
    v.and_then(|s| s.trim().parse::<f64>().ok())
}

/// 같은 창으로 보는 `resets_at` 오차 (초). 창 길이(최소 5시간)보다 훨씬 작다. 직접 조회와 statusline이 반올림이 다를 수 있음
pub const SAME_WINDOW: f64 = 120.0;

fn reset_of(v: &Value) -> Option<f64> {
    v.get("resets_at").and_then(|x| x.as_f64()).filter(|x| x.is_finite())
}

fn pct_of(v: &Value) -> Option<f64> {
    v.get("used_percentage").and_then(|x| x.as_f64()).filter(|x| x.is_finite())
}

/// 한도 두 보고를 합친다. 같은 창(같은 `resets_at`) 안의 사용률은 **단조 증가**하므로 창별로 최댓값을 남긴다.
/// - 이미 지난 창(`resets_at <= now`)은 버린다.
/// - 두 보고의 창이 다르면 더 늦게 끝나는(= 더 최근) 창이 이긴다.
/// - 한쪽에 그 창이 없으면(예: 5시간 없음) 다른 쪽을 그대로 둔다.
/// - `resets_at`을 모르는 보고(null)는 상대와 같은 창으로 본다.
///
/// 합친 결과가 비면 `Null`. 파이썬 `statusline_tap.merge_limits`/`server.merge_limits`와 같은 규칙
/// (fixtures/limits_merge.json으로 양쪽을 검증).
pub fn merge_limits(prev: &Value, new: &Value, now: f64) -> Value {
    let mut keys: Vec<&String> = vec![];
    for src in [prev, new] {
        if let Some(o) = src.as_object() {
            for k in o.keys() {
                if !keys.contains(&k) {
                    keys.push(k);
                }
            }
        }
    }
    let mut out = Map::new();
    for k in keys {
        let cands: Vec<&Value> = [prev, new]
            .iter()
            .filter_map(|s| s.get(k.as_str()))
            .filter(|c| c.is_object())
            .filter(|c| reset_of(c).is_none_or(|r| r > now))
            .collect();
        let Some(best) = pick_window(&cands) else { continue };
        out.insert(k.clone(), best);
    }
    if out.is_empty() {
        Value::Null
    } else {
        Value::Object(out)
    }
}

fn pick_window(c: &[&Value]) -> Option<Value> {
    let mut it = c.iter();
    let mut best: Value = (*it.next()?).clone();
    for x in it {
        let (rb, rx) = (reset_of(&best), reset_of(x));
        let same = match (rb, rx) {
            (Some(a), Some(b)) => (a - b).abs() < SAME_WINDOW,
            _ => true,
        };
        if same {
            // 숫자 표현(13 vs 13.0)을 바꾸지 않으려고 원래 Value를 고른다
            let pick = |key: &str, f: fn(&Value) -> Option<f64>| -> Option<Value> {
                match (f(&best), f(x)) {
                    (Some(a), Some(b)) => Some(best.get(key).cloned().filter(|_| a >= b).unwrap_or_else(|| x[key].clone())),
                    (None, Some(_)) => Some(x[key].clone()),
                    _ => None,
                }
            };
            let pct = pick("used_percentage", pct_of);
            let reset = pick("resets_at", reset_of);
            if let Some(o) = best.as_object_mut() {
                if let Some(p) = pct {
                    o.insert("used_percentage".into(), p);
                }
                if let Some(r) = reset {
                    o.insert("resets_at".into(), r);
                }
            }
        } else if rx > rb {
            best = (*x).clone();
        }
    }
    Some(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_sequence() {
        let mut b = Backoff::default();
        assert!(b.due(0.0));
        b.too_many(0.0, None);
        assert_eq!(b.next_at, 120.0);
        b.too_many(0.0, None);
        assert_eq!(b.next_at, 240.0);
        for _ in 0..10 {
            b.too_many(0.0, None);
        }
        assert_eq!(b.next_at, 3600.0);
        b.too_many(0.0, Some(30.0));
        assert_eq!(b.next_at, 30.0);
        b.ok(100.0);
        assert_eq!((b.strikes, b.next_at), (0, 220.0));
        b.halt();
        assert!(!b.due(1e9));
        assert_eq!(format!("{:?} {}", Secret::new("abc".into()), Secret::new("abc".into())), "*** ***");
    }

    #[test]
    fn merge_cases_from_shared_fixture() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/limits_merge.json");
        let doc: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        for c in doc["cases"].as_array().unwrap() {
            let got = merge_limits(&c["prev"], &c["new"], c["now"].as_f64().unwrap());
            assert_eq!(got, c["expect"], "{}", c["name"]);
        }
    }

    #[test]
    fn merge_is_stable_when_repeated() {
        // 같은 보고를 여러 번 합쳐도(깜빡임 방지) 결과가 변하지 않는다
        let a = serde_json::json!({"five_hour": {"used_percentage": 13, "resets_at": 2000}, "seven_day": {"used_percentage": 52, "resets_at": 5000}});
        let stale = serde_json::json!({"seven_day": {"used_percentage": 23, "resets_at": 5000}});
        let mut cur = a.clone();
        for _ in 0..5 {
            cur = merge_limits(&cur, &stale, 1000.0);
            cur = merge_limits(&cur, &a, 1000.0);
        }
        assert_eq!(cur, a);
    }
}

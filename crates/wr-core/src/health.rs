//! 멈춤 판정 틀 (공통). server.py `health()`.

use crate::model::Health;

/// 모델 응답이 이만큼(초) 없으면 느림/멈춤 의심
pub const SLOW: f64 = 120.0;
pub const STALL: f64 = 300.0;
/// 도구 하나가 이만큼 안 끝나면 느림/멈춤 의심
pub const TOOL_SLOW: f64 = 120.0;
pub const TOOL_STALL: f64 = 600.0;

/// 대기 중 도구(이름, 시작 시각, 삽입 순서) 중 가장 오래된 것 → 도구 시간, 없으면 조용한 시간으로 판정.
pub fn health<'a>(pending: impl IntoIterator<Item = (&'a str, f64)>, last_ts: f64, last_event: f64, now: f64) -> Option<Health> {
    let mut oldest: Option<(&str, f64)> = None;
    for p in pending {
        if oldest.is_none_or(|o| p.1 < o.1) {
            oldest = Some(p);
        }
    }
    if let Some((name, since)) = oldest {
        let run = now - since;
        if run >= TOOL_SLOW {
            return Some(Health {
                level: if run >= TOOL_STALL { "stall" } else { "slow" },
                tool: Some(name.to_string()),
                secs: run,
            });
        }
        return None;
    }
    let quiet = now - last_ts.max(last_event);
    if quiet >= SLOW {
        return Some(Health {
            level: if quiet >= STALL { "stall" } else { "slow" },
            tool: None,
            secs: quiet,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels() {
        assert_eq!(health([], 0.0, 0.0, 400.0).unwrap().level, "stall");
        assert_eq!(health([], 0.0, 0.0, 130.0).unwrap().level, "slow");
        assert!(health([], 50.0, 0.0, 100.0).is_none());
        let h = health([("Bash", 10.0), ("Read", 5.0), ("Grep", 5.0)], 0.0, 0.0, 200.0).unwrap();
        assert_eq!((h.level, h.tool.as_deref(), h.secs), ("slow", Some("Read"), 195.0));
        assert!(health([("Bash", 150.0)], 0.0, 0.0, 200.0).is_none());
    }
}

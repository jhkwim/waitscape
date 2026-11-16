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

/// 메인 세션 판정(#182): 서브에이전트가 정상으로 일하는 중이면(`agent_busy` — 트랜스크립트로 판정을 거쳤고 멈춤 의심이 아님) 메인의 Agent·Task 대기는 뺀다 —
/// 포그라운드 서브에이전트는 끝날 때까지 결과가 없어 대기로 남기 때문. 뺀 뒤 남은 대기가 있으면 그것으로,
/// 없으면 정상(멈춤은 서브에이전트 자신의 판정이 보여 줌). server.py `main_health()`.
pub fn main_health<'a>(
    pending: impl IntoIterator<Item = (&'a str, f64)>,
    last_ts: f64,
    last_event: f64,
    now: f64,
    agent_busy: bool,
) -> Option<Health> {
    let all: Vec<(&str, f64)> = pending.into_iter().collect();
    if agent_busy && all.iter().any(|p| is_agent(p.0)) {
        let rest: Vec<(&str, f64)> = all.into_iter().filter(|p| !is_agent(p.0)).collect();
        return if rest.is_empty() {
            None
        } else {
            health(rest, last_ts, last_event, now)
        };
    }
    health(all, last_ts, last_event, now)
}

fn is_agent(name: &str) -> bool {
    matches!(name, "Agent" | "Task")
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

    #[test]
    fn agent_wait() {
        // 서브에이전트가 일하는 중: Agent 대기는 빼고, 남은 게 없으면 정상
        assert!(main_health([("Agent", 0.0)], 0.0, 0.0, 900.0, true).is_none());
        assert!(main_health([("Task", 0.0)], 0.0, 0.0, 900.0, true).is_none());
        // 남은 대기가 있으면 그것으로
        let h = main_health([("Agent", 0.0), ("Bash", 100.0)], 0.0, 0.0, 800.0, true).unwrap();
        assert_eq!((h.level, h.tool.as_deref()), ("stall", Some("Bash")));
        // 서브에이전트가 멈춤 의심이거나 없으면 그대로
        assert_eq!(main_health([("Agent", 0.0)], 0.0, 0.0, 900.0, false).unwrap().level, "stall");
        // Agent 대기가 없으면 agent_busy여도 조용한 시간 판정 그대로
        assert_eq!(main_health([], 0.0, 0.0, 400.0, true).unwrap().level, "stall");
    }
}

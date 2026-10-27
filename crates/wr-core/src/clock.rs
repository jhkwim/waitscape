//! 시계·시간대 주입 (테스트 결정성). 엔진의 모든 "지금"과 "오늘"은 여기서 나온다.

use chrono::{DateTime, FixedOffset, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};

/// 시간대: 시스템 로컬(TZ 환경변수 존중) 또는 고정 오프셋(초)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Tz {
    #[default]
    Local,
    Fixed(i32),
}

/// 현재 시각 공급자. `Fixed`는 테스트·스냅샷용.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum Clock {
    #[default]
    System,
    Fixed(f64),
}

impl Clock {
    pub fn now(&self) -> f64 {
        match self {
            Clock::System => {
                let d = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default();
                d.as_secs_f64()
            }
            Clock::Fixed(t) => *t,
        }
    }
}

fn utc(ts: f64) -> DateTime<Utc> {
    let secs = ts.floor();
    let nanos = ((ts - secs) * 1e9) as u32;
    Utc.timestamp_opt(secs as i64, nanos.min(999_999_999)).single().unwrap_or_default()
}

impl Tz {
    /// `time.localtime(ts)`의 날짜
    pub fn local_date(&self, ts: f64) -> NaiveDate {
        let u = utc(ts);
        match self {
            Tz::Local => u.with_timezone(&Local).date_naive(),
            Tz::Fixed(off) => u
                .with_timezone(&FixedOffset::east_opt(*off).unwrap_or(FixedOffset::east_opt(0).unwrap()))
                .date_naive(),
        }
    }

    /// `datetime.fromtimestamp(ts)` — 로컬 시각(naive)
    pub fn local_naive(&self, ts: f64) -> NaiveDateTime {
        let u = utc(ts);
        match self {
            Tz::Local => u.with_timezone(&Local).naive_local(),
            Tz::Fixed(off) => u
                .with_timezone(&FixedOffset::east_opt(*off).unwrap_or(FixedOffset::east_opt(0).unwrap()))
                .naive_local(),
        }
    }

    /// 로컬 시각(naive) → epoch 초 (`mktime`)
    pub fn local_to_epoch(&self, n: NaiveDateTime) -> f64 {
        fn pick<T: TimeZone>(r: LocalResult<DateTime<T>>) -> Option<f64> {
            match r {
                LocalResult::Single(d) => Some(micros(d.timestamp(), d.timestamp_subsec_micros())),
                LocalResult::Ambiguous(a, _) => Some(micros(a.timestamp(), a.timestamp_subsec_micros())),
                LocalResult::None => None,
            }
        }
        let r = match self {
            Tz::Local => pick(Local.from_local_datetime(&n)),
            Tz::Fixed(off) => pick(
                FixedOffset::east_opt(*off)
                    .unwrap_or(FixedOffset::east_opt(0).unwrap())
                    .from_local_datetime(&n),
            ),
        };
        r.unwrap_or_else(|| {
            let u = n.and_utc();
            micros(u.timestamp(), u.timestamp_subsec_micros())
        })
    }

    /// 그날 자정 (`mktime(strptime(today))`)
    pub fn day_start(&self, now: f64) -> f64 {
        let d = self.local_date(now);
        self.local_to_epoch(d.and_hms_opt(0, 0, 0).unwrap())
    }
}

/// 파이썬 `timedelta.total_seconds()`와 같은 반올림: 정수 마이크로초 / 1e6
fn micros(secs: i64, us: u32) -> f64 {
    (secs as i128 * 1_000_000 + us as i128) as f64 / 1e6
}

/// `datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()` — 오프셋이 없으면 로컬 시각으로 본다.
pub fn iso(t: &str, tz: Tz) -> Option<f64> {
    let s = t.replace('Z', "+00:00");
    if let Ok(d) = DateTime::parse_from_rfc3339(&s) {
        return Some(micros(d.timestamp(), d.timestamp_subsec_micros()));
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f%:z", "%Y-%m-%d %H:%M:%S%.f%:z", "%Y-%m-%dT%H:%M%:z"] {
        if let Ok(d) = DateTime::parse_from_str(&s, f) {
            return Some(micros(d.timestamp(), d.timestamp_subsec_micros()));
        }
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&s, f) {
            return Some(tz.local_to_epoch(n));
        }
        if f == "%Y-%m-%d" {
            if let Ok(d) = NaiveDate::parse_from_str(&s, f) {
                return Some(tz.local_to_epoch(d.and_hms_opt(0, 0, 0).unwrap()));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_and_days() {
        let tz = Tz::Fixed(9 * 3600);
        assert_eq!(iso("2026-10-20T18:00:00.000Z", tz), Some(1792519200.0));
        assert_eq!(iso("2026-10-20T18:00:00.500Z", tz), Some(1792519200.5));
        assert_eq!(iso("2026-10-21T03:00:00", tz), Some(1792519200.0));
        assert_eq!(iso("nope", tz), None);
        // 2026-10-21 00:00 KST
        assert_eq!(tz.day_start(1792519200.0), 1792508400.0);
        assert_eq!(Clock::Fixed(5.0).now(), 5.0);
    }
}

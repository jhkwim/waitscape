//! 퇴근 일보용 하루치 기록(일지). 참조 구현 `daylog.py`와 같은 규칙·같은 파일 형식(둘이 같은 폴더를 함께 써도 된다).
//!
//! 엔진이 상태를 만들 때마다 프로바이더가 감지한 전이(턴 완료·질문 대기·세션 활동, [`DayFeed`])와 사용 한도를 받아
//! 하루 단위 파일에 쌓고([`DayLog::record`]), 카드에 바로 쓸 모양으로 집계한다([`DayLog::report`]).
//!
//! - 하루: 현지 시각 새벽 4시 ~ 다음 날 새벽 4시 (03:59는 전날, 04:00부터 오늘)
//! - 파일: `<폴더>/<YYYY-MM-DD>.json` (기본 `<Claude 루트>/waiting-room/daylog`, `WAITING_ROOM_DAYLOG`로 변경, `off`면 끔)
//! - 쓰기: `<폴더>/daylog.lock` 파일 잠금 아래 읽기 → 병합 → 임시 파일 → 교체 (Python 서버와 앱이 같이 써도 안전)
//! - 보존: 14일이 지난 파일은 지운다. 외부 전송 없음. 프로젝트 이름·프롬프트 요약은 `redact()` 후 60자
//! - 중복: 훅과 트랜스크립트가 같은 턴을 조금 다른 시각으로 볼 수 있어, 같은 세션에서 시작·끝이 5초 안이면 같은 턴
//! - 퇴근 판정: 오늘은 마지막 활동이 정오 이후이고 45분 동안 어느 세션도 활동이 없으면 준비됨(다시 활동하면 풀림).
//!   지난 날은 끝났으므로 준비됨. 본 시각(`seen`)이 준비된 시각보다 이르면 `unseen`

use crate::clock::Tz;
use crate::paths::{expand_tilde, home_dir, EnvSource};
use crate::py::{ellipsize, project_name, squash_ws};
use crate::redact::redact;
use chrono::{Duration, NaiveDate};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 하루 경계(현지 시각)
pub const DAY_HOUR: u32 = 4;
/// 이만큼(초) 아무 세션도 활동이 없으면 퇴근으로 본다
pub const QUIET: f64 = 45.0 * 60.0;
/// 자동 퇴근 판정은 마지막 활동이 이 시각 이후일 때만
pub const AFTER_HOUR: u32 = 12;
/// 큰 일 = 실행 10분 이상
pub const BIG: f64 = 600.0;
/// 응답에 담는 큰 일 수
pub const BIG_LIST: usize = 10;
/// 보존 기간(일)
pub const KEEP_DAYS: i64 = 14;
/// 한도 표본 간격(초)
pub const SAMPLE_EVERY: f64 = 300.0;
/// 활동 시각은 이만큼 바뀌었거나 이만큼 조용해졌을 때만 파일에 쓴다
pub const ACT_STEP: f64 = 60.0;
/// 같은 턴·대기로 보는 시각 오차(초)
pub const SAME: f64 = 5.0;
/// 같은 리셋 시각으로 보는 오차(초)
pub const SAME_RESET: f64 = 120.0;
/// 프롬프트 요약 길이
pub const TEXT: usize = 60;
/// 응답에 담는 칭찬 한마디 수 (최근 것부터)
pub const CHEERS: usize = 5;
pub const VERSION: u32 = 1;

// ---------- 프로바이더가 넘겨주는 전이 ----------

/// 끝난 턴 하나 (start = 프롬프트, end = 끝난 시각)
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedTurn {
    pub sid: String,
    pub cwd: String,
    pub prompt: String,
    pub start: f64,
    pub end: f64,
    /// AI가 MCP 보고(`waitscape_status` done + big)로 큰 일이라고 알림
    pub big: bool,
    /// 그 턴의 칭찬 한마디 (MCP 보고 cheer)
    pub cheer: Option<String>,
}

/// 질문 대기 한 번 (입력 필요 시작 → 다음 진행)
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedWait {
    pub sid: String,
    pub t0: f64,
    pub t1: f64,
}

/// 세션의 마지막 활동 시각
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedAct {
    pub sid: String,
    pub cwd: String,
    pub last: f64,
}

/// 프로바이더 한 번 읽은 결과 중 일지로 갈 것
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DayFeed {
    pub turns: Vec<FeedTurn>,
    pub waits: Vec<FeedWait>,
    pub act: Vec<FeedAct>,
}

// ---------- 파일 형식 (v1, daylog.py 머리말) ----------

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Turn {
    pub sid: String,
    pub provider: String,
    pub project: String,
    pub job: String,
    pub start: f64,
    pub t: f64,
    pub run: f64,
    /// AI가 큰 일이라고 알림 (있을 때만 파일에 씀 — daylog.py와 같은 모양)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub by_ai: bool,
    /// 칭찬 한마디 (마스킹 후 60자)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cheer: Option<String>,
}

impl Turn {
    /// self가 같은 턴 o에 없는 AI 보고(by_ai·cheer)를 갖고 있나
    fn adds(&self, o: &Turn) -> bool {
        (self.by_ai && !o.by_ai) || (self.cheer.is_some() && o.cheer.is_none())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Wait {
    pub sid: String,
    pub provider: String,
    pub t0: f64,
    pub t1: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Act {
    pub sid: String,
    pub provider: String,
    pub project: String,
    pub first: f64,
    pub last: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Sample {
    pub t: f64,
    pub five_hour: Option<f64>,
    pub five_hour_resets: Option<f64>,
    pub seven_day: Option<f64>,
    pub seven_day_resets: Option<f64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Outage {
    pub t0: f64,
    pub t1: Option<f64>,
    pub resets: Option<f64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Journal {
    pub v: u32,
    pub day: String,
    pub turns: Vec<Turn>,
    pub waits: Vec<Wait>,
    pub act: Vec<Act>,
    pub limits: Vec<Sample>,
    pub outages: Vec<Outage>,
    pub seen: Option<f64>,
}

impl Journal {
    pub fn empty(day: &str) -> Journal {
        Journal {
            v: VERSION,
            day: day.to_string(),
            turns: vec![],
            waits: vec![],
            act: vec![],
            limits: vec![],
            outages: vec![],
            seen: None,
        }
    }
}

// ---------- 날짜 ----------

fn date(day: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()
}

fn fmt(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// ts가 속한 하루(현지 시각에서 4시간을 뺀 날짜)
pub fn day_of(tz: Tz, ts: f64) -> String {
    fmt((tz.local_naive(ts) - Duration::hours(DAY_HOUR as i64)).date())
}

/// 하루 이름을 n일 옮긴다
pub fn shift(day: &str, n: i64) -> String {
    date(day).map(|d| fmt(d + Duration::days(n))).unwrap_or_default()
}

/// 그날(달력 날짜) + add_days일의 hour시 정각 epoch
pub fn day_at(tz: Tz, day: &str, hour: u32, add_days: i64) -> f64 {
    let d = date(day).unwrap_or_default() + Duration::days(add_days);
    tz.local_to_epoch(d.and_hms_opt(hour, 0, 0).unwrap())
}

fn is_day_str(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// today | yesterday | YYYY-MM-DD(보존 기간 안, 오늘 이전) → 하루 이름. 아니면 None
pub fn resolve(tz: Tz, which: &str, now: f64) -> Option<String> {
    let today = day_of(tz, now);
    match which {
        "" | "today" => Some(today),
        "yesterday" => Some(shift(&today, -1)),
        w if is_day_str(w) && date(w).is_some() => (shift(&today, -KEEP_DAYS).as_str() < w && w <= today.as_str()).then(|| w.to_string()),
        _ => None,
    }
}

/// 일지 폴더: `WAITING_ROOM_DAYLOG`(off/0이면 끔, 빈 값은 다른 환경변수처럼 "없음"으로 봄 — server.py와 같음) 또는 `<Claude 루트>/waiting-room/daylog`
pub fn dir_from_env(env: &dyn EnvSource, claude_root: &Path) -> Option<PathBuf> {
    match env.var("WAITING_ROOM_DAYLOG") {
        Some(v) if v == "off" || v == "0" => None,
        Some(v) => Some(expand_tilde(&v, &home_dir(env))),
        None => Some(claude_root.join("waiting-room").join("daylog")),
    }
}

// ---------- 텍스트·중복 ----------

/// 마스킹 → 공백 정리 → n자 절단(…)
pub fn clip(s: &str, n: usize) -> String {
    ellipsize(squash_ws(&redact(s)), n)
}

fn project_of(cwd: &str) -> String {
    clip(&project_name(cwd), TEXT)
}

fn same_turn(a: &Turn, b: &Turn) -> bool {
    a.sid == b.sid && a.provider == b.provider && (a.t - b.t).abs() <= SAME && (a.start - b.start).abs() <= SAME
}

fn same_wait(a: &Wait, b: &Wait) -> bool {
    a.sid == b.sid && a.provider == b.provider && (a.t0 - b.t0).abs() <= SAME && (a.t1 - b.t1).abs() <= SAME
}

fn fcmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}

fn text_or<'a>(v: Option<&'a Value>, d: &'a str) -> &'a str {
    v.and_then(|x| x.as_str()).unwrap_or(d)
}

/// 읽은 일지를 정해진 모양으로 (잘못된 항목은 버림, 텍스트는 다시 마스킹)
pub fn normalize(v: &Value, day: &str) -> Journal {
    let mut out = Journal::empty(day);
    let Some(o) = v.as_object() else { return out };
    let list = |k: &str| -> Vec<&serde_json::Map<String, Value>> {
        o.get(k)
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_object()).collect())
            .unwrap_or_default()
    };
    let sid_of = |x: &serde_json::Map<String, Value>| x.get("sid").and_then(|s| s.as_str()).map(str::to_string);
    for x in list("turns") {
        if let (Some(sid), Some(start), Some(t)) = (sid_of(x), num(x.get("start")), num(x.get("t"))) {
            out.turns.push(Turn {
                sid,
                provider: text_or(x.get("provider"), "claude").into(),
                project: clip(text_or(x.get("project"), "?"), TEXT),
                job: clip(text_or(x.get("job"), ""), TEXT),
                start,
                t,
                run: t - start,
                by_ai: x.get("by_ai") == Some(&Value::Bool(true)),
                cheer: x
                    .get("cheer")
                    .and_then(|c| c.as_str())
                    .map(|c| clip(c, TEXT))
                    .filter(|c| !c.is_empty()),
            });
        }
    }
    for x in list("waits") {
        if let (Some(sid), Some(t0), Some(t1)) = (sid_of(x), num(x.get("t0")), num(x.get("t1"))) {
            out.waits.push(Wait {
                sid,
                provider: text_or(x.get("provider"), "claude").into(),
                t0,
                t1,
            });
        }
    }
    for x in list("act") {
        if let (Some(sid), Some(first), Some(last)) = (sid_of(x), num(x.get("first")), num(x.get("last"))) {
            out.act.push(Act {
                sid,
                provider: text_or(x.get("provider"), "claude").into(),
                project: clip(text_or(x.get("project"), "?"), TEXT),
                first,
                last,
            });
        }
    }
    for x in list("limits") {
        if let Some(t) = num(x.get("t")) {
            out.limits.push(Sample {
                t,
                five_hour: num(x.get("five_hour")),
                five_hour_resets: num(x.get("five_hour_resets")),
                seven_day: num(x.get("seven_day")),
                seven_day_resets: num(x.get("seven_day_resets")),
            });
        }
    }
    for x in list("outages") {
        if let Some(t0) = num(x.get("t0")) {
            out.outages.push(Outage {
                t0,
                t1: num(x.get("t1")),
                resets: num(x.get("resets")),
            });
        }
    }
    out.seen = num(o.get("seen"));
    out
}

// ---------- 파일 잠금·원자적 쓰기 ----------

/// `<경로>.lock` 배타 잠금 (statusline_tap.py `_Lock`과 같은 flock. 3초 안에 못 얻으면 잠금 없이 진행 — 절대 실패하지 않음)
struct FileLock(#[allow(dead_code)] Option<std::fs::File>);

fn lock(dir: &Path) -> FileLock {
    let mut o = std::fs::OpenOptions::new();
    o.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let Ok(f) = o.open(dir.join("daylog.lock")) else {
        return FileLock(None);
    };
    let end = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match f.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < end => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(_) => break,
        }
    }
    FileLock(Some(f))
}

fn make_dir(dir: &Path) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(dir)
}

fn sig(p: &Path) -> Option<(SystemTime, u64)> {
    let m = std::fs::metadata(p).ok()?;
    Some((m.modified().ok()?, m.len()))
}

static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// ---------- 일지 ----------

#[derive(Default)]
struct Delta {
    turns: Vec<Turn>,
    waits: Vec<Wait>,
    act: Vec<Act>,
    limits: Vec<Sample>,
    open: Option<Outage>,
    close: Option<(f64, f64)>,
    force: bool,
}

type SeenKey = (u8, String, String, u64, u64);

pub struct DayLog {
    pub dir: PathBuf,
    tz: Tz,
    cache: HashMap<String, (Option<(SystemTime, u64)>, Journal)>,
    /// 이미 일지에 있는 것으로 확인한 피드 키 (매번 마스킹·비교하지 않게)
    seen: HashSet<SeenKey>,
    cleaned: Option<String>,
}

impl DayLog {
    pub fn new(dir: PathBuf, tz: Tz) -> DayLog {
        DayLog {
            dir,
            tz,
            cache: HashMap::new(),
            seen: HashSet::new(),
            cleaned: None,
        }
    }

    pub fn path(&self, day: &str) -> PathBuf {
        self.dir.join(format!("{day}.json"))
    }

    fn load(&self, day: &str) -> Journal {
        let v = std::fs::read(self.path(day))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .unwrap_or(Value::Null);
        normalize(&v, day)
    }

    /// 하루 일지 (파일이 바뀌었을 때만 다시 읽음)
    pub fn get(&mut self, day: &str) -> &Journal {
        let s = sig(&self.path(day));
        let fresh = matches!(self.cache.get(day), Some((c, _)) if *c == s);
        if !fresh {
            let j = if s.is_some() { self.load(day) } else { Journal::empty(day) };
            if self.cache.len() > 8 {
                self.cache.clear();
            }
            self.cache.insert(day.to_string(), (s, j));
        }
        &self.cache[day].1
    }

    fn write(&mut self, day: &str, j: Journal) {
        let p = self.path(day);
        let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp = PathBuf::from(format!("{}.{}.{}.tmp", p.display(), std::process::id(), seq));
        let body = serde_json::to_vec(&j).unwrap_or_default();
        let ok = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut o = std::fs::OpenOptions::new();
            o.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                o.mode(0o600);
            }
            let mut f = o.open(&tmp)?;
            f.write_all(&body)?;
            f.sync_all()?;
            drop(f);
            std::fs::rename(&tmp, &p)
        })();
        if ok.is_err() {
            std::fs::remove_file(&tmp).ok();
        }
        self.cache.insert(day.to_string(), (sig(&p), j));
    }

    /// 보존 기간이 지난 하루 파일과 오래된 임시 파일을 지운다(하루 한 번)
    pub fn cleanup(&mut self, today: &str, now: f64) {
        if self.cleaned.as_deref() == Some(today) {
            return;
        }
        self.cleaned = Some(today.to_string());
        let cut = shift(today, -KEEP_DAYS);
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return };
        for e in rd.flatten() {
            let nm = e.file_name().to_string_lossy().into_owned();
            let old_day = nm.strip_suffix(".json").is_some_and(|d| is_day_str(d) && d <= cut.as_str());
            let old_tmp = nm.ends_with(".tmp")
                && e.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .is_some_and(|d| d.as_secs_f64() < now - 3600.0);
            if old_day || old_tmp {
                std::fs::remove_file(e.path()).ok();
            }
        }
    }

    /// 전이·한도를 일지에 반영한다. 바뀐 게 있을 때만 파일에 쓴다. 쓴 날 목록을 돌려줌.
    /// `feeds` = [(프로바이더 id, 피드)], `limits` = state의 limits
    pub fn record(&mut self, feeds: &[(&str, &DayFeed)], limits: &Value, now: f64) -> Vec<String> {
        let tz = self.tz;
        let today = day_of(tz, now);
        let yday = shift(&today, -1);
        let jy = self.get(&yday).clone();
        let jt = self.get(&today).clone();
        let jof = |d: &str| if d == today { &jt } else { &jy };
        let in_days = |d: &str| d == today || d == yday;
        if self.seen.len() > 20000 {
            self.seen.clear();
        }
        let mut delta: BTreeMap<String, Delta> = BTreeMap::new();
        for (prov, f) in feeds {
            for x in &f.turns {
                let key: SeenKey = (b't', prov.to_string(), x.sid.clone(), x.start.to_bits(), x.end.to_bits());
                if self.seen.contains(&key) {
                    continue;
                }
                let d = day_of(tz, x.end);
                if !in_days(&d) {
                    continue;
                }
                let rec = Turn {
                    sid: x.sid.clone(),
                    provider: prov.to_string(),
                    project: project_of(&x.cwd),
                    job: clip(&x.prompt, TEXT),
                    start: x.start,
                    t: x.end,
                    run: x.end - x.start,
                    by_ai: x.big,
                    cheer: x.cheer.as_deref().map(|c| clip(c, TEXT)).filter(|c| !c.is_empty()),
                };
                let pend = delta.get(&d).map(|z| z.turns.as_slice()).unwrap_or(&[]);
                // 이미 있는 턴이면 건너뜀. 단 AI 보고(by_ai·cheer)를 새로 더할 게 있으면 합치러 간다
                if jof(&d).turns.iter().chain(pend).any(|o| same_turn(&rec, o) && !rec.adds(o)) {
                    self.seen.insert(key);
                    continue;
                }
                delta.entry(d).or_default().turns.push(rec);
            }
            for x in &f.waits {
                let key: SeenKey = (b'w', prov.to_string(), x.sid.clone(), x.t0.to_bits(), x.t1.to_bits());
                if self.seen.contains(&key) {
                    continue;
                }
                let d = day_of(tz, x.t1);
                if !in_days(&d) {
                    continue;
                }
                let rec = Wait {
                    sid: x.sid.clone(),
                    provider: prov.to_string(),
                    t0: x.t0,
                    t1: x.t1,
                };
                let pend = delta.get(&d).map(|z| z.waits.as_slice()).unwrap_or(&[]);
                if jof(&d).waits.iter().chain(pend).any(|o| same_wait(&rec, o)) {
                    self.seen.insert(key);
                    continue;
                }
                delta.entry(d).or_default().waits.push(rec);
            }
            for x in &f.act {
                let last = x.last;
                let d = day_of(tz, last);
                if !in_days(&d) {
                    continue;
                }
                let old = jof(&d).act.iter().find(|o| o.provider == *prov && o.sid == x.sid);
                if let Some(o) = old {
                    if !(last > o.last && (last - o.last >= ACT_STEP || now - last >= ACT_STEP)) {
                        continue;
                    }
                }
                delta.entry(d).or_default().act.push(Act {
                    sid: x.sid.clone(),
                    provider: prov.to_string(),
                    project: project_of(&x.cwd),
                    first: last,
                    last,
                });
            }
        }

        // 사용 한도: 정전(5시간 100%) 구간 + 표본 (오늘 파일)
        let pick = |k: &str| {
            let w = limits.get(k).filter(|w| w.is_object());
            (
                num(w.and_then(|w| w.get("used_percentage"))),
                num(w.and_then(|w| w.get("resets_at"))),
            )
        };
        let (p5, r5) = pick("five_hour");
        let (p7, r7) = pick("seven_day");
        let mut open: Option<(String, Outage)> = None;
        for d in [&today, &yday] {
            if let Some(o) = jof(d).outages.iter().rev().find(|o| o.t1.is_none()) {
                open = Some((d.to_string(), o.clone()));
                break;
            }
        }
        let mut force = false;
        match &open {
            None => {
                if p5.is_some_and(|p| p >= 100.0) {
                    delta.entry(today.clone()).or_default().open = Some(Outage {
                        t0: now,
                        t1: None,
                        resets: r5,
                    });
                    force = true;
                }
            }
            Some((d, o)) => {
                let gone = o.resets.is_some_and(|r| r <= now);
                if gone || p5.is_some_and(|p| p < 100.0) {
                    let t1 = if gone { now.min(o.resets.unwrap()) } else { now };
                    delta.entry(d.clone()).or_default().close = Some((o.t0, t1.max(o.t0)));
                    force = true;
                }
            }
        }
        if p5.is_some() || p7.is_some() {
            let dt = delta.get(&today);
            let active =
                force || !jt.act.is_empty() || !jt.turns.is_empty() || dt.is_some_and(|z| !z.act.is_empty() || !z.turns.is_empty());
            let due = jt.limits.last().is_none_or(|s| now - s.t >= SAMPLE_EVERY);
            if active && (force || due) {
                let z = delta.entry(today.clone()).or_default();
                z.limits.push(Sample {
                    t: now,
                    five_hour: p5,
                    five_hour_resets: r5,
                    seven_day: p7,
                    seven_day_resets: r7,
                });
                z.force = force;
            }
        }
        if delta.is_empty() || make_dir(&self.dir).is_err() {
            return vec![];
        }
        let _g = lock(&self.dir);
        let mut wrote = vec![];
        for (d, z) in delta {
            let mut j = self.load(&d);
            apply(&mut j, z);
            self.write(&d, j);
            wrote.push(d);
        }
        self.cleanup(&today, now);
        wrote
    }

    /// 그날 일보를 봤다고 기록 → `{day, seen}`. 잘못된 날이면 None
    pub fn mark_seen(&mut self, which: &str, now: f64) -> Option<Value> {
        let day = resolve(self.tz, which, now)?;
        if make_dir(&self.dir).is_err() {
            return Some(json!({"day": day, "seen": null}));
        }
        let _g = lock(&self.dir);
        let mut j = self.load(&day);
        j.seen = Some(now);
        self.write(&day, j);
        Some(json!({"day": day, "seen": now}))
    }

    /// 카드에 바로 쓸 하루 집계. 잘못된 날이면 None
    pub fn report(&mut self, which: &str, now: f64) -> Option<Value> {
        let tz = self.tz;
        let day = resolve(tz, which, now)?;
        let today = day_of(tz, now);
        let j = self.get(&day).clone();
        let mut out = summarize(tz, &j, &day, now, day == today);
        out["prev"] = if day == today {
            let yd = shift(&day, -1);
            let y = self.get(&yd).clone();
            let ys = summarize(tz, &y, &yd, now, false);
            let mut p = serde_json::Map::new();
            for k in ["day", "done", "ready", "ready_at", "seen", "unseen"] {
                p.insert(k.into(), ys[k].clone());
            }
            Value::Object(p)
        } else {
            Value::Null
        };
        Some(out)
    }
}

/// 잠금 안에서 방금 읽은 일지에 변경분을 합친다 (다른 프로세스가 그 사이 쓴 것과도 중복 제거)
fn apply(j: &mut Journal, z: Delta) {
    for r in z.turns {
        match j.turns.iter_mut().find(|o| same_turn(&r, o)) {
            None => j.turns.push(r),
            // 같은 턴: AI 보고 표시만 더한다(먼저 있던 값은 그대로)
            Some(o) => {
                o.by_ai |= r.by_ai;
                if o.cheer.is_none() {
                    o.cheer = r.cheer;
                }
            }
        }
    }
    j.turns.sort_by(|a, b| {
        fcmp(a.t, b.t)
            .then_with(|| a.sid.cmp(&b.sid))
            .then_with(|| a.provider.cmp(&b.provider))
    });
    for r in z.waits {
        if !j.waits.iter().any(|o| same_wait(&r, o)) {
            j.waits.push(r);
        }
    }
    j.waits.sort_by(|a, b| {
        fcmp(a.t1, b.t1)
            .then_with(|| a.sid.cmp(&b.sid))
            .then_with(|| a.provider.cmp(&b.provider))
    });
    for r in z.act {
        match j.act.iter_mut().find(|o| o.provider == r.provider && o.sid == r.sid) {
            None => j.act.push(r),
            Some(o) => {
                o.first = o.first.min(r.first);
                if r.last >= o.last {
                    o.last = r.last;
                    o.project = r.project;
                }
            }
        }
    }
    j.act.sort_by(|a, b| a.provider.cmp(&b.provider).then_with(|| a.sid.cmp(&b.sid)));
    if let Some((t0, t1)) = z.close {
        for o in j.outages.iter_mut() {
            if o.t1.is_none() && o.t0 == t0 {
                o.t1 = Some(t1);
            }
        }
    }
    if let Some(o) = z.open {
        if !j.outages.iter().any(|x| x.t1.is_none()) {
            j.outages.push(o);
        }
    }
    j.outages.sort_by(|a, b| fcmp(a.t0, b.t0));
    for s in z.limits {
        if z.force || j.limits.last().is_none_or(|l| s.t - l.t >= SAMPLE_EVERY) {
            j.limits.push(s);
        }
    }
    j.limits.sort_by(|a, b| fcmp(a.t, b.t));
}

fn opt(v: Option<f64>) -> Value {
    v.map(Value::from).unwrap_or(Value::Null)
}

/// 하루 집계 (daylog.py `summarize`)
pub fn summarize(tz: Tz, j: &Journal, day: &str, now: f64, is_today: bool) -> Value {
    let start = day_at(tz, day, DAY_HOUR, 0);
    let end = day_at(tz, day, DAY_HOUR, 1);
    let noon = day_at(tz, day, AFTER_HOUR, 0);
    let run = |t: &Turn| t.t - t.start;
    let done = j.turns.len();
    let work: f64 = j.turns.iter().map(run).sum();
    // 큰 일 = 10분 넘게 걸린 턴 + AI가 MCP 보고로 큰 일이라고 알린 턴(by_ai)
    let mut bigs: Vec<&Turn> = j.turns.iter().filter(|t| run(t) >= BIG || t.by_ai).collect();
    bigs.sort_by(|a, b| fcmp(run(b), run(a)).then_with(|| fcmp(a.t, b.t)).then_with(|| a.sid.cmp(&b.sid)));
    let big: Vec<Value> = bigs
        .iter()
        .take(BIG_LIST)
        .map(|t| {
            let mut v = json!({"sid": t.sid, "provider": t.provider, "project": t.project, "job": t.job, "run": run(t), "t": t.t});
            if t.by_ai {
                v["by_ai"] = json!(true);
            }
            v
        })
        .collect();
    let cheered: Vec<Value> = j
        .turns
        .iter()
        .filter_map(|t| {
            t.cheer
                .as_ref()
                .map(|c| json!({"sid": t.sid, "provider": t.provider, "text": c, "t": t.t}))
        })
        .collect();
    let cheers = cheered[cheered.len().saturating_sub(CHEERS)..].to_vec();
    let wn = j.waits.len();
    let wavg = (wn > 0).then(|| j.waits.iter().map(|w| w.t1 - w.t0).sum::<f64>() / wn as f64);
    // 직원(세션)별 완료 수·작업 시간 (프로젝트는 마지막 턴의 것)
    let mut order: Vec<(String, String)> = vec![];
    let mut by: HashMap<(String, String), (String, i64, f64)> = HashMap::new();
    for t in &j.turns {
        let k = (t.provider.clone(), t.sid.clone());
        let e = by.entry(k.clone()).or_insert_with(|| {
            order.push(k);
            (String::new(), 0, 0.0)
        });
        e.0 = t.project.clone();
        e.1 += 1;
        e.2 += run(t);
    }
    let mut workers: Vec<(String, String, String, i64, f64)> = order
        .into_iter()
        .map(|k| {
            let (p, d, w) = by[&k].clone();
            (k.0, k.1, p, d, w)
        })
        .collect();
    workers.sort_by(|a, b| {
        b.3.cmp(&a.3)
            .then_with(|| fcmp(b.4, a.4))
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| a.1.cmp(&b.1))
    });
    let workers: Vec<Value> = workers
        .into_iter()
        .map(|(prov, sid, project, d, w)| json!({"sid": sid, "provider": prov, "project": project, "done": d, "work": w}))
        .collect();
    let lasts = j
        .act
        .iter()
        .map(|a| a.last)
        .chain(j.turns.iter().map(|t| t.t))
        .chain(j.waits.iter().map(|w| w.t1));
    let last = lasts.fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x))));
    let firsts = j
        .act
        .iter()
        .map(|a| a.first)
        .chain(j.turns.iter().map(|t| t.start))
        .chain(j.waits.iter().map(|w| w.t0));
    let first = firsts.fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.min(x))));
    // 막차: 마지막으로 활동한 직원 (시각, 프로바이더, 세션 순 비교. 같으면 먼저 본 것)
    let cands = j
        .act
        .iter()
        .map(|a| (a.last, a.provider.as_str(), a.sid.as_str(), a.project.as_str()))
        .chain(
            j.turns
                .iter()
                .map(|t| (t.t, t.provider.as_str(), t.sid.as_str(), t.project.as_str())),
        );
    let mut lc: Option<(f64, &str, &str, &str)> = None;
    for c in cands {
        let later = match lc {
            None => true,
            Some(b) => fcmp(c.0, b.0).then_with(|| c.1.cmp(b.1)).then_with(|| c.2.cmp(b.2)) == std::cmp::Ordering::Greater,
        };
        if later {
            lc = Some(c);
        }
    }
    let mut rs: Vec<f64> = j.limits.iter().filter_map(|s| s.five_hour_resets).collect();
    rs.sort_by(|a, b| fcmp(*a, *b));
    let mut resets: Vec<f64> = vec![];
    for r in rs {
        if start <= r && r <= now.min(end) && resets.last().is_none_or(|l| r - l > SAME_RESET) {
            resets.push(r);
        }
    }
    let week: Vec<f64> = j.limits.iter().filter_map(|s| s.seven_day).collect();
    let peak = j
        .limits
        .iter()
        .filter_map(|s| s.five_hour)
        .fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x))));
    // 퇴근 판정
    let mut ready_at = None;
    let mut reason = None;
    if done > 0 {
        if let Some(l) = last {
            let ra = (l >= noon).then_some(l + QUIET);
            if is_today {
                if let Some(r) = ra.filter(|r| now >= *r) {
                    ready_at = Some(r);
                    reason = Some("quiet");
                }
            } else if end <= now {
                match ra.filter(|r| *r <= end) {
                    Some(r) => {
                        ready_at = Some(r);
                        reason = Some("quiet");
                    }
                    None => {
                        ready_at = Some(end);
                        reason = Some("day-over");
                    }
                }
            }
        }
    }
    let unseen = ready_at.is_some_and(|r| j.seen.is_none_or(|s| s < r));
    json!({
        "v": VERSION, "day": day, "today": is_today, "start": start, "end": end, "now": now,
        "done": done, "work": work, "big": big, "big_count": bigs.len(), "cheers": cheers,
        "wait": {"avg": opt(wavg), "n": wn},
        "mvp": workers.first().cloned().unwrap_or(Value::Null),
        "workers": workers,
        "first": opt(first), "last": opt(last), "quiet": opt(last.map(|l| now - l)),
        "last_call": lc.map(|(t, p, s, pr)| json!({"sid": s, "provider": p, "project": pr, "t": t})).unwrap_or(Value::Null),
        "limits": {
            "samples": j.limits,
            "resets": resets,
            "weekly": if week.is_empty() { Value::Null } else { json!({"from": week[0], "to": week[week.len() - 1]}) },
            "peak": opt(peak),
        },
        "outages": j.outages.iter().map(|o| json!({"t0": o.t0, "t1": opt(o.t1)})).collect::<Vec<_>>(),
        "outage_count": j.outages.len(),
        "ready": ready_at.is_some(), "ready_at": opt(ready_at), "reason": reason,
        "seen": opt(j.seen), "unseen": unseen,
        "rule": {"day_hour": DAY_HOUR, "quiet_min": (QUIET / 60.0) as i64, "after_hour": AFTER_HOUR,
                 "big_min": (BIG / 60.0) as i64, "keep_days": KEEP_DAYS},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KST: Tz = Tz::Fixed(9 * 3600);
    /// 2026-10-21 00:00 KST
    const MID: f64 = 1792508400.0;
    const H: f64 = 3600.0;

    fn tmp(tag: &str) -> PathBuf {
        let t = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("wr-daylog-{tag}-{}-{t}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn turn(sid: &str, start: f64, end: f64) -> FeedTurn {
        FeedTurn {
            sid: sid.into(),
            cwd: "/Users/alex/dev/shop".into(),
            prompt: "고쳐줘".into(),
            start,
            end,
            ..Default::default()
        }
    }

    fn feed(turns: Vec<FeedTurn>) -> DayFeed {
        let act = turns
            .iter()
            .map(|t| FeedAct {
                sid: t.sid.clone(),
                cwd: t.cwd.clone(),
                last: t.end,
            })
            .collect();
        DayFeed { turns, waits: vec![], act }
    }

    fn rec(dl: &mut DayLog, f: &DayFeed, now: f64) {
        dl.record(&[("claude", f)], &Value::Null, now);
    }

    #[test]
    fn day_boundary_at_4am() {
        let d = MID + 4.0 * H; // 2026-10-21 04:00 KST
        assert_eq!(day_of(KST, d - 1.0), "2026-10-20");
        assert_eq!(day_of(KST, d), "2026-10-21");
        assert_eq!(day_at(KST, "2026-10-21", DAY_HOUR, 0), d);
        assert_eq!(day_at(KST, "2026-10-21", DAY_HOUR, 1), d + 24.0 * H);
        assert_eq!(resolve(KST, "yesterday", d), Some("2026-10-20".into()));
        assert_eq!(resolve(KST, "today", d - 1.0), Some("2026-10-20".into()));
        assert_eq!(resolve(KST, "2026-10-08", d), Some("2026-10-08".into()));
        assert_eq!(resolve(KST, "2026-10-07", d), None, "보존 기간 밖");
        assert_eq!(resolve(KST, "2026-10-22", d), None, "미래");
        for bad in ["../x", "2026-13-01", "2026-1-01", "20261021000"] {
            assert_eq!(resolve(KST, bad, d), None, "{bad}");
        }
        // 03:59에 끝난 턴은 어제 파일, 04:00에 끝난 턴은 오늘 파일
        let dir = tmp("boundary");
        let mut dl = DayLog::new(dir.clone(), KST);
        rec(
            &mut dl,
            &feed(vec![turn("a", d - 100.0, d - 1.0), turn("b", d - 10.0, d)]),
            d + 60.0,
        );
        assert_eq!(
            dl.load("2026-10-20").turns.iter().map(|t| t.sid.as_str()).collect::<Vec<_>>(),
            ["a"]
        );
        assert_eq!(
            dl.load("2026-10-21").turns.iter().map(|t| t.sid.as_str()).collect::<Vec<_>>(),
            ["b"]
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn auto_leave_needs_afternoon_and_45_quiet_minutes() {
        let dir = tmp("ready");
        let mut dl = DayLog::new(dir.clone(), KST);
        // 오전에만 일하고 멈춤 → 오후가 돼도 자동 퇴근 아님(점심 공백 오판 방지)
        rec(&mut dl, &feed(vec![turn("a", MID + 9.0 * H, MID + 11.0 * H)]), MID + 11.0 * H);
        let r = dl.report("today", MID + 15.0 * H).unwrap();
        assert_eq!((r["ready"].clone(), r["done"].clone()), (json!(false), json!(1)));
        // 오후 활동 → 마지막 활동 + 45분부터 준비됨 (44:59는 아직)
        let last = MID + 18.0 * H;
        rec(&mut dl, &feed(vec![turn("a", MID + 17.0 * H, last)]), last);
        assert_eq!(dl.report("today", last + QUIET - 1.0).unwrap()["ready"], json!(false));
        let r = dl.report("today", last + QUIET).unwrap();
        assert_eq!(
            (r["ready"].clone(), r["ready_at"].clone(), r["reason"].clone()),
            (json!(true), json!(last + QUIET), json!("quiet"))
        );
        assert_eq!(r["unseen"], json!(true));
        assert_eq!(r["big_count"], json!(2), "2시간·1시간 턴은 큰 일");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reactivity_refreshes_and_seen_tracks_ready_at() {
        let dir = tmp("again");
        let mut dl = DayLog::new(dir.clone(), KST);
        let l1 = MID + 19.0 * H;
        rec(&mut dl, &feed(vec![turn("a", l1 - 600.0, l1)]), l1);
        let t = l1 + QUIET + 60.0;
        assert_eq!(dl.report("today", t).unwrap()["ready"], json!(true));
        assert_eq!(dl.mark_seen("today", t).unwrap()["seen"], json!(t));
        assert_eq!(dl.report("today", t).unwrap()["unseen"], json!(false));
        // 다시 활동(세션 활동만, 턴 완료 전) → 준비 풀림
        let l2 = t + 600.0;
        let f = DayFeed {
            act: vec![FeedAct {
                sid: "b".into(),
                cwd: "/x/ui".into(),
                last: l2,
            }],
            ..Default::default()
        };
        rec(&mut dl, &f, l2);
        let r = dl.report("today", l2 + 60.0).unwrap();
        assert_eq!((r["ready"].clone(), r["last"].clone()), (json!(false), json!(l2)));
        // 다시 45분 조용 → 준비됨 + 본 뒤에 갱신됐으므로 unseen
        let r = dl.report("today", l2 + QUIET).unwrap();
        assert_eq!((r["ready"].clone(), r["unseen"].clone()), (json!(true), json!(true)));
        assert_eq!(r["last_call"]["sid"], json!("b"), "막차 = 마지막 활동 세션");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn yesterday_report_and_seen() {
        let dir = tmp("yday");
        let mut dl = DayLog::new(dir.clone(), KST);
        // 어제(10-20) 22시 퇴근, 오늘(10-21) 아침 첫 활동
        let y = MID - 2.0 * H;
        rec(&mut dl, &feed(vec![turn("a", y - 900.0, y)]), y);
        let morning = MID + 9.0 * H;
        rec(&mut dl, &feed(vec![turn("b", morning - 60.0, morning)]), morning);
        let r = dl.report("today", morning).unwrap();
        assert_eq!(r["prev"]["day"], json!("2026-10-20"));
        assert_eq!(
            (r["prev"]["ready"].clone(), r["prev"]["unseen"].clone()),
            (json!(true), json!(true))
        );
        let y_r = dl.report("yesterday", morning).unwrap();
        assert_eq!((y_r["reason"].clone(), y_r["ready_at"].clone()), (json!("quiet"), json!(y + QUIET)));
        assert_eq!(y_r["prev"], Value::Null);
        dl.mark_seen("yesterday", morning + 5.0).unwrap();
        assert_eq!(dl.report("today", morning + 10.0).unwrap()["prev"]["unseen"], json!(false));
        // 새벽 3시 반에 끝난 날은 준비 시각이 하루 끝(04:00)으로 잘림
        let mut dl2 = DayLog::new(tmp("late"), KST);
        let late = MID + 3.5 * H;
        rec(&mut dl2, &feed(vec![turn("a", late - 60.0, late)]), late);
        let r = dl2.report("yesterday", MID + 10.0 * H).unwrap();
        assert_eq!(
            (r["reason"].clone(), r["ready_at"].clone()),
            (json!("day-over"), json!(MID + 4.0 * H))
        );
        std::fs::remove_dir_all(dir).ok();
        std::fs::remove_dir_all(&dl2.dir).ok();
    }

    #[test]
    fn retention_cleanup() {
        let dir = tmp("keep");
        for d in ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-20"] {
            std::fs::write(dir.join(format!("{d}.json")), "{}").unwrap();
        }
        std::fs::write(dir.join("notes.json"), "{}").unwrap();
        let mut dl = DayLog::new(dir.clone(), KST);
        let now = MID + 10.0 * H; // 오늘 = 10-21 → 14일 지난 10-07 이전은 삭제
        rec(&mut dl, &feed(vec![turn("a", now - 60.0, now)]), now);
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.ends_with(".lock"))
            .collect();
        names.sort();
        assert_eq!(names, ["2026-10-08.json", "2026-10-20.json", "2026-10-21.json", "notes.json"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn concurrent_writers_keep_every_turn() {
        let dir = tmp("race");
        let now = MID + 10.0 * H;
        let hs: Vec<_> = (0..6)
            .map(|w| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    // 각자 따로 연 일지(= 다른 프로세스와 같은 상황): 캐시가 낡아도 잠금 안에서 다시 읽고 합친다
                    let mut dl = DayLog::new(dir, KST);
                    for i in 0..15 {
                        let t = now - 3000.0 + (w * 100 + i) as f64 * 7.0;
                        rec(&mut dl, &feed(vec![turn(&format!("w{w}"), t - 30.0, t)]), now);
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        let j = DayLog::new(dir.clone(), KST).load("2026-10-21");
        assert_eq!(j.turns.len(), 90, "갱신이 사라지면 안 됨");
        assert_eq!(j.act.len(), 6);
        assert!(std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn dedupe_masking_waits_and_limits() {
        let dir = tmp("misc");
        let mut dl = DayLog::new(dir.clone(), KST);
        let now = MID + 10.0 * H;
        let key = ["sk-", "ant-", "zzzzzzzzzzzzzzzz"].concat();
        let mut t = turn("a", now - 900.0, now - 100.0);
        t.prompt = format!("키 {key} 바꿔");
        t.cwd = format!("/Users/alex/dev/{key}");
        let mut f = feed(vec![t.clone()]);
        f.waits.push(FeedWait {
            sid: "a".into(),
            t0: now - 800.0,
            t1: now - 700.0,
        });
        let lim = json!({"five_hour": {"used_percentage": 40, "resets_at": now + 3.0 * H}, "seven_day": {"used_percentage": 10, "resets_at": now + 90.0 * H}});
        dl.record(&[("claude", &f)], &lim, now);
        // 훅·트랜스크립트가 같은 턴을 몇 초 다르게 본 것 → 중복 아님으로 세면 안 됨
        let mut t2 = t.clone();
        t2.start += 2.0;
        t2.end += 3.0;
        dl.record(&[("claude", &feed(vec![t2]))], &lim, now + 10.0);
        let text = std::fs::read_to_string(dl.path("2026-10-21")).unwrap();
        assert!(!text.contains("zzzzzzzz"), "프롬프트·프로젝트는 마스킹");
        let r = dl.report("today", now + 20.0).unwrap();
        assert_eq!(
            (r["done"].clone(), r["wait"]["avg"].clone(), r["wait"]["n"].clone()),
            (json!(1), json!(100.0), json!(1))
        );
        assert_eq!(r["limits"]["samples"].as_array().unwrap().len(), 1, "5분 안에는 표본 하나");
        // 정전: 100% → 열림, 리셋 시각이 지나면 그 시각에 닫힘
        let out = json!({"five_hour": {"used_percentage": 100, "resets_at": now + 600.0}});
        dl.record(&[], &out, now + 300.0);
        dl.record(&[], &Value::Null, now + 900.0);
        let r = dl.report("today", now + 1000.0).unwrap();
        assert_eq!(r["outages"], json!([{"t0": now + 300.0, "t1": now + 600.0}]));
        assert_eq!(r["outage_count"], json!(1));
        assert_eq!(r["limits"]["peak"], json!(100.0));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reads_python_written_file() {
        // daylog.py가 쓴 모양(정수 시각, 빠진 키, 잘못된 항목)도 읽는다
        let v = json!({"v": 1, "day": "2026-10-21", "turns": [{"sid": "a", "start": 1792549200, "t": 1792550000, "project": "p"}, {"sid": 3}],
                       "waits": [{"sid": "a", "provider": "claude", "t0": 1, "t1": 2}], "act": "x", "limits": [{"t": 5, "five_hour": 7}],
                       "outages": [{"t0": 9, "t1": null}], "seen": true});
        let j = normalize(&v, "2026-10-21");
        assert_eq!(j.turns.len(), 1);
        assert_eq!(
            (j.turns[0].provider.as_str(), j.turns[0].run, j.turns[0].job.as_str()),
            ("claude", 800.0, "")
        );
        assert_eq!(
            (j.waits.len(), j.act.len(), j.limits[0].five_hour, j.outages[0].t1, j.seen),
            (1, 0, Some(7.0), None, None)
        );
    }

    /// AI 보고: big이면 10분 미만도 큰 일(by_ai), cheer는 최근 5개. 먼저 기록된 같은 턴(훅·트랜스크립트)에 나중에 온 보고를 합친다
    #[test]
    fn ai_big_and_cheers_merge() {
        let d = tmp("ai");
        let mut dl = DayLog::new(d.clone(), KST);
        let now = MID + 15.0 * H;
        let plain = feed(vec![turn("s1", now - 300.0, now - 200.0)]);
        rec(&mut dl, &plain, now);
        assert!(dl.report("today", now).unwrap()["big"].as_array().unwrap().is_empty());
        let mut t = turn("s1", now - 299.0, now - 198.0);
        t.big = true;
        t.cheer = Some("깔끔하게 끝냈어요".into());
        rec(&mut dl, &feed(vec![t]), now);
        let r = dl.report("today", now).unwrap();
        assert_eq!(r["done"], json!(1), "같은 턴은 하나");
        assert_eq!(r["big"][0]["by_ai"], json!(true));
        assert_eq!(
            r["cheers"],
            json!([{"sid": "s1", "provider": "claude", "text": "깔끔하게 끝냈어요", "t": now - 200.0}])
        );
        let mut many = vec![];
        for k in 0..7 {
            let mut x = turn(&format!("m{k}"), now - 100.0 + k as f64 * 10.0, now - 95.0 + k as f64 * 10.0);
            x.cheer = Some(format!("한마디 {k}"));
            many.push(x);
        }
        rec(&mut dl, &feed(many), now);
        let c = dl.report("today", now).unwrap()["cheers"].clone();
        let texts: Vec<&str> = c.as_array().unwrap().iter().map(|x| x["text"].as_str().unwrap()).collect();
        assert_eq!(texts, vec!["한마디 2", "한마디 3", "한마디 4", "한마디 5", "한마디 6"]);
        std::fs::remove_dir_all(&d).ok();
    }
}

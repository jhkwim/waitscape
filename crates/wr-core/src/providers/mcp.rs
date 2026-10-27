//! MCP 보고 프로바이더 — `wr-hook mcp` 사이드카가 쓴 `reports.jsonl`을 증분으로 읽어 세션을 만든다 (server.py `read_reports()`와 같은 규칙).
//!
//! - 기록 줄 v1: `{v, ts, type: hello|status|board|bye, key, provider, cwd, pid?, ppid?, wr, …}`. 모르는 `v`·형식이 틀린 줄은 버린다.
//!   같은 사용자의 다른 프로세스도 이 파일을 쓸 수 있으므로 리더에서 다시 정화한다(`report::status_of`·`board_of`).
//! - key별 마지막 상태를 맵에 둔다(읽은 줄 수와 무관). `bye`나 사이드카 프로세스가 사라지면(pid 확인) 끝, 6시간(STALE) 소식이 없으면 숨김.
//!   30분 넘게 보고 없는 working은 `confidence: "guess"`(멈췄을 수도).
//! - Claude(`provider:"claude"`) 사이드카 보고는 세션을 만들지 않는다 → `orphans`로 엔진에 넘기고, 엔진이 훅 보고가 없는
//!   같은 cwd의 활성 Claude 세션이 **하나뿐일 때만** 붙인다(훅이 꺼진 사용자용 대체 경로. 기본은 훅 `report` 이벤트).
//! - 회전은 리더 한 곳에서: 끝까지 읽은 뒤 1MB를 넘으면 `reports.1.jsonl`로 이름을 바꾸고 오프셋을 0으로.
//!   사이드카는 쓸 때마다 파일을 새로 열기 때문에 다음 기록은 새 `reports.jsonl`로 간다. 파일이 바뀌면(크기 감소·파일 식별자 변경) 처음부터.
//! - 오늘 집계·일지: working→done을 한 턴(`big`·`cheer` 포함), asking→다음 보고를 질문 대기로 세어 도구별 피드(`Snapshot::days`)로 넘긴다.
//!   세션 키가 STALE로 지워져도 집계가 남게 따로 최근 `FEED_MAX`개를 기억한다 (server.py `report_day`).
//! - 표시 이름: provider id는 계약대로 `gemini`지만, 보이는 Gemini 세션이 모두 Antigravity CLI(`hello`의 clientInfo.name)면 이름을 "Antigravity"로.

use crate::daylog::{DayFeed, FeedAct, FeedTurn, FeedWait};
use crate::hide::HideRules;
use crate::model::{ProviderInfo, Session};
use crate::paths::{expand_tilde, home_dir, EnvSource};
use crate::provider::{cap, Ctx, Orphan, Provider, Snapshot, WatchPath};
use crate::providers::claude::config::ClaudeConfig;
use crate::providers::claude::hooks::new_session;
use crate::providers::claude::STALE;
use crate::py::{get, num, project_name, take};
use crate::report::{board_of, key_ok, status_of, Fold, PROVIDERS, VERSION};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// 이 크기를 넘으면 리더가 회전한다
pub const ROTATE_AT: u64 = 1 << 20;
/// 이만큼 보고가 없는 working은 추정(guess)
pub const GUESS_AFTER: f64 = 1800.0;
/// 기록 줄의 cwd 최대 길이 (사이드카와 같음)
pub const CWD_MAX: usize = 400;
/// 일지·오늘 집계용으로 기억하는 MCP 턴·대기 수
pub const FEED_MAX: usize = 200;

#[derive(Clone, Debug)]
pub struct McpConfig {
    /// `WAITING_ROOM_REPORTS` 또는 `<Claude 루트>/waiting-room/reports.jsonl`
    pub path: PathBuf,
    /// 읽기 켜짐 (앱: 설정 `mcpReports`, 기본 꺼짐 / wr-server: `WAITING_ROOM_REPORTS=off`가 아니면 켜짐)
    pub on: bool,
    /// 사이드카 pid가 살아 있는지 확인 (테스트에서 끔)
    pub check_pids: bool,
    pub hide_user: Vec<String>,
    pub hide_builtin: bool,
}

impl McpConfig {
    pub fn from_env(env: &dyn EnvSource, claude: &ClaudeConfig) -> McpConfig {
        let v = env.var("WAITING_ROOM_REPORTS");
        let home = home_dir(env);
        McpConfig {
            on: v.as_deref() != Some("off"),
            path: v
                .filter(|p| p != "off")
                .map(|p| expand_tilde(&p, &home))
                .unwrap_or_else(|| claude.root.join("waiting-room").join("reports.jsonl")),
            check_pids: true,
            hide_user: claude.hide_user.clone(),
            hide_builtin: claude.hide_builtin,
        }
    }
}

/// 사이드카 세션 하나 (key별)
#[derive(Clone, Debug)]
struct Entry {
    provider: &'static str,
    cwd: String,
    pid: Option<i64>,
    last: f64,
    status: &'static str,
    since: f64,
    started: Option<f64>,
    run: f64,
    ended: bool,
    fold: Fold,
    /// 멀티플렉서 이동 정보 (사이드카가 `term`을 실어 보냈을 때만, `term::jump_of`로 다시 검증)
    jump: Option<Value>,
    /// 질문 대기 시작 (asking → 다음 보고)
    wait0: Option<f64>,
    /// hello의 clientInfo.name이 Antigravity CLI
    agy: bool,
}

impl Entry {
    fn new(ts: f64) -> Entry {
        Entry {
            provider: "other",
            cwd: String::new(),
            pid: None,
            last: ts,
            status: "idle",
            since: ts,
            started: None,
            run: 0.0,
            ended: false,
            fold: Fold::default(),
            jump: None,
            wait0: None,
            agy: false,
        }
    }

    fn reported(&self) -> bool {
        self.fold.state.is_some() || self.fold.board.is_some()
    }
}

pub struct McpProvider {
    pub cfg: McpConfig,
    off: u64,
    ident: Option<(u64, u64)>,
    keys: BTreeMap<String, Entry>,
    last_report: Option<f64>,
    hide: HideRules,
    /// 지난 snapshot에서 보인 도구 (`infos()`)
    seen: Vec<&'static str>,
    /// 지난 snapshot에서 보인 Gemini 세션이 모두 Antigravity CLI
    agy: bool,
    /// 일지로 넘길 끝난 턴·질문 대기 `(도구, 피드 항목)` (최근 `FEED_MAX`개)
    turns: Vec<(&'static str, FeedTurn)>,
    waits: Vec<(&'static str, String, FeedWait)>,
}

/// 파일 식별자: unix (dev, inode), 그 외 생성 시각. 바뀌면 다른 파일(회전·교체)
fn ident(m: &std::fs::Metadata) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some((m.dev(), m.ino()))
    }
    #[cfg(not(unix))]
    {
        let d = m.created().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
        Some((d.as_secs(), d.subsec_nanos() as u64))
    }
}

/// 사이드카 프로세스가 살아 있나. 확인할 수 없으면 true(숨기지 않음)
#[cfg(unix)]
pub fn alive(pid: i64) -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    let Ok(p) = i32::try_from(pid) else { return true };
    if p <= 0 {
        return true; // 0·음수는 프로세스 그룹을 뜻하므로 확인하지 않는다
    }
    // SAFETY: 시그널 0은 보내지 않고 존재·권한만 확인한다
    if unsafe { kill(p, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(3) // ESRCH만 "없음"
}

#[cfg(windows)]
pub fn alive(pid: i64) -> bool {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn GetExitCodeProcess(h: *mut c_void, code: *mut u32) -> i32;
        fn CloseHandle(h: *mut c_void) -> i32;
    }
    const QUERY_LIMITED: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    let Ok(p) = u32::try_from(pid) else { return true };
    // SAFETY: 조회 권한으로만 열고 바로 닫는다
    unsafe {
        let h = OpenProcess(QUERY_LIMITED, 0, p);
        if h.is_null() {
            // 없는 pid는 ERROR_INVALID_PARAMETER(87). 권한 부족 등은 살아 있다고 본다
            return std::io::Error::last_os_error().raw_os_error() != Some(87);
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code);
        CloseHandle(h);
        ok == 0 || code == STILL_ACTIVE
    }
}

#[cfg(not(any(unix, windows)))]
pub fn alive(_pid: i64) -> bool {
    true
}

fn int(v: Option<&Value>) -> Option<i64> {
    v.filter(|x| x.is_i64() || x.is_u64()).and_then(|x| x.as_i64())
}

fn info_of(id: &'static str, agy: bool) -> ProviderInfo {
    let name = match id {
        "codex" => "Codex",
        "gemini" if agy => "Antigravity",
        "gemini" => "Gemini",
        _ => "Other",
    };
    ProviderInfo {
        id,
        name,
        icon: None,
        capabilities: vec![cap::REPORT],
    }
}

impl McpProvider {
    pub fn new(cfg: McpConfig) -> McpProvider {
        let hide = HideRules::new(&cfg.hide_user, cfg.hide_builtin);
        McpProvider {
            cfg,
            off: 0,
            ident: None,
            keys: BTreeMap::new(),
            last_report: None,
            hide,
            seen: vec![],
            agy: false,
            turns: vec![],
            waits: vec![],
        }
    }

    /// 기록 줄 하나 반영 (server.py `_report_line`)
    fn apply(&mut self, raw: &[u8]) {
        let Ok(d) = serde_json::from_slice::<Value>(raw) else { return };
        if int(get(&d, "v")) != Some(VERSION) {
            return;
        }
        let Some(ts) = num(get(&d, "ts")).filter(|t| t.is_finite()) else {
            return;
        };
        let Some(typ) = get(&d, "type").and_then(|v| v.as_str()) else {
            return;
        };
        let Some(key) = get(&d, "key").and_then(|v| v.as_str()).filter(|k| key_ok(k)) else {
            return;
        };
        let rep = match typ {
            "status" => match status_of(&d) {
                Ok(m) => Some(m),
                Err(_) => return,
            },
            "board" => match board_of(&d) {
                Ok(m) => Some(m),
                Err(_) => return,
            },
            "hello" | "bye" => None,
            _ => return,
        };
        let e = self.keys.entry(key.to_string()).or_insert_with(|| Entry::new(ts));
        let p = get(&d, "provider").and_then(|v| v.as_str()).unwrap_or("");
        e.provider = PROVIDERS.iter().copied().find(|x| *x == p).unwrap_or("other");
        if let Some(c) = get(&d, "cwd").and_then(|v| v.as_str()) {
            e.cwd = take(c, CWD_MAX).to_string();
        }
        if let Some(pid) = int(get(&d, "pid")) {
            e.pid = Some(pid);
        }
        if let Some(j) = get(&d, "term").and_then(crate::term::jump_of) {
            e.jump = Some(j);
        }
        if let Some(c) = get(&d, "client").and_then(|c| get(c, "name")).and_then(|v| v.as_str()) {
            e.agy = c.to_ascii_lowercase().contains("antigravity");
        }
        e.last = e.last.max(ts);
        match (typ, rep) {
            ("status", Some(m)) => {
                let st = m.get("state").and_then(|v| v.as_str()).unwrap_or("");
                // 일지: 질문 대기 = asking → 다음 보고(working·done)
                if st != "asking" {
                    if let Some(t0) = e.wait0.take() {
                        let w = FeedWait {
                            sid: key.to_string(),
                            t0,
                            t1: ts,
                        };
                        push_feed(&mut self.waits, (e.provider, e.cwd.clone(), w), |a, b| a.2 == b.2);
                    }
                } else if e.wait0.is_none() {
                    e.wait0 = Some(ts);
                }
                e.fold.status(&m, ts);
                if st == "done" {
                    if let Some(s) = e.started.take() {
                        e.run = ts - s;
                        let t = FeedTurn {
                            sid: key.to_string(),
                            cwd: e.cwd.clone(),
                            prompt: e.fold.title.clone().unwrap_or_default(),
                            start: s,
                            end: ts,
                            big: m.get("big") == Some(&Value::Bool(true)),
                            cheer: m.get("cheer").and_then(|v| v.as_str()).map(String::from),
                        };
                        push_feed(&mut self.turns, (e.provider, t), |a, b| {
                            a.1.sid == b.1.sid && a.1.start == b.1.start && a.1.end == b.1.end
                        });
                    }
                } else if e.started.is_none() {
                    e.started = Some(ts);
                }
                let status = match st {
                    "working" => "working",
                    "asking" => "needs_input",
                    _ => "done",
                };
                if e.status != status {
                    e.status = status;
                    e.since = ts;
                }
                self.last_report = Some(self.last_report.map_or(ts, |l| l.max(ts)));
            }
            ("board", Some(m)) => {
                e.fold.board(&m, ts);
                self.last_report = Some(self.last_report.map_or(ts, |l| l.max(ts)));
            }
            ("bye", _) => {
                e.ended = true;
                e.wait0 = None;
            }
            _ => {}
        }
    }

    /// 새 줄 읽기 + 회전
    fn refresh(&mut self) {
        let path = self.cfg.path.clone();
        let Ok(meta) = std::fs::metadata(&path) else {
            self.off = 0;
            self.ident = None;
            return;
        };
        let id = ident(&meta);
        if id != self.ident || meta.len() < self.off {
            self.off = 0;
            self.ident = id;
        }
        let mut off = self.off;
        let mut lines = vec![];
        let _ = crate::jsonl::read_lines(&path, &mut off, |raw| lines.push(raw.to_vec()));
        for raw in &lines {
            self.apply(raw);
        }
        self.off = off;
        if off >= ROTATE_AT && crate::jsonl::size(&path) == Some(off) {
            let old = path.with_file_name("reports.1.jsonl");
            if std::fs::rename(&path, &old).is_ok() {
                self.off = 0;
                self.ident = None;
            }
        }
    }

    /// 오늘 집계(`today.done`·`waited`)와 도구별 일지 피드 (Claude 사이드카·숨길 프로젝트 제외. server.py `report_day`)
    fn feed(&self, ctx: &Ctx, out: &mut Snapshot) {
        let ok = |prov: &str, cwd: &str| prov != "claude" && !self.hide.matches(cwd);
        let today = ctx.tz.local_date(ctx.now);
        let mut feeds: BTreeMap<&'static str, DayFeed> = BTreeMap::new();
        let mut waited = 0.0;
        for (prov, t) in &self.turns {
            if !ok(prov, &t.cwd) {
                continue;
            }
            if ctx.tz.local_date(t.end) == today {
                out.today.done += 1;
                waited += t.end - t.start;
            }
            feeds.entry(prov).or_default().turns.push(t.clone());
        }
        out.today.waited = waited;
        for (prov, cwd, w) in &self.waits {
            if ok(prov, cwd) {
                feeds.entry(prov).or_default().waits.push(w.clone());
            }
        }
        for (key, e) in &self.keys {
            if ok(e.provider, &e.cwd) {
                feeds.entry(e.provider).or_default().act.push(FeedAct {
                    sid: key.clone(),
                    cwd: e.cwd.clone(),
                    last: e.last,
                });
            }
        }
        out.days = feeds.into_iter().collect();
    }

    fn session(key: &str, e: &Entry, now: f64) -> Session {
        let mut s = new_session(key.to_string(), e.since);
        let title = json!(e.fold.title.clone().unwrap_or_default());
        s.project = project_name(&e.cwd);
        s.status = e.status;
        s.started = e.started;
        s.prompt = title.clone();
        if e.status == "needs_input" {
            s.note = Some(title);
        }
        s.run = e.run;
        s.last = e.last;
        s.cwd = e.cwd.clone();
        s.source = Some("mcp");
        s.confidence = Some(if e.status == "working" && now - e.last >= GUESS_AFTER {
            "guess"
        } else {
            "sure"
        });
        s.provider = Some(e.provider);
        s.report = e.reported().then(|| e.fold.value(now));
        s.jump = e.jump.clone();
        s.mask();
        s
    }
}

/// 같은 전이를 두 번 넣지 않는다(파일을 처음부터 다시 읽는 경우). 오래된 것부터 버림
fn push_feed<T>(v: &mut Vec<T>, x: T, same: impl Fn(&T, &T) -> bool) {
    if !v.iter().any(|o| same(o, &x)) {
        v.push(x);
        if v.len() > FEED_MAX {
            v.remove(0);
        }
    }
}

impl Provider for McpProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: "mcp",
            name: "MCP",
            icon: None,
            capabilities: vec![cap::REPORT],
        }
    }

    fn infos(&self) -> Vec<ProviderInfo> {
        self.seen.iter().map(|id| info_of(id, self.agy)).collect()
    }

    /// 꺼져 있어도 감시는 한다(앱은 시작할 때 한 번만 감시를 등록하므로, 나중에 켜도 바로 반영되게)
    fn watch_paths(&self) -> Vec<WatchPath> {
        vec![WatchPath {
            path: self.cfg.path.clone(),
            recursive: false,
            exts: vec!["jsonl"],
        }]
    }

    fn snapshot(&mut self, ctx: &Ctx) -> Snapshot {
        if !self.cfg.on {
            self.seen.clear();
            return Snapshot::default();
        }
        self.refresh();
        let now = ctx.now;
        self.keys.retain(|_, e| now - e.last < STALE);
        let mut out = Snapshot {
            report_ts: self.last_report,
            ..Default::default()
        };
        let mut seen = vec![];
        let (mut gem, mut agy) = (0, 0);
        for (key, e) in self.keys.iter_mut() {
            if e.ended || self.hide.matches(&e.cwd) {
                continue;
            }
            if self.cfg.check_pids && e.pid.is_some_and(|p| !alive(p)) {
                e.ended = true;
                continue;
            }
            if e.provider == "claude" {
                if e.reported() {
                    out.orphans.push(Orphan {
                        key: key.clone(),
                        cwd: e.cwd.clone(),
                        ts: e.fold.ts,
                        report: e.fold.value(now),
                    });
                }
                continue;
            }
            if !seen.contains(&e.provider) {
                seen.push(e.provider);
            }
            if e.provider == "gemini" {
                gem += 1;
                agy += e.agy as i32;
            }
            out.sessions.push(Self::session(key, e, now));
        }
        seen.sort_unstable();
        self.seen = seen;
        self.agy = gem > 0 && agy == gem;
        self.feed(ctx, &mut out);
        out
    }

    fn set_hide(&mut self, user: &[String], builtin: bool) {
        let all: Vec<String> = self.cfg.hide_user.iter().chain(user.iter()).cloned().collect();
        self.hide = HideRules::new(&all, builtin && self.cfg.hide_builtin);
    }

    fn set_reports_on(&mut self, on: bool) {
        self.cfg.on = on;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::Tz;
    use std::io::Write;

    fn tmp(tag: &str) -> PathBuf {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("wr-mcp-{tag}-{}-{t}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn prov(path: PathBuf) -> McpProvider {
        McpProvider::new(McpConfig {
            path,
            on: true,
            check_pids: true,
            hide_user: vec![],
            hide_builtin: true,
        })
    }

    fn ctx(now: f64) -> Ctx {
        Ctx {
            now,
            tz: Tz::Fixed(0),
            home: String::new(),
        }
    }

    fn append(p: &std::path::Path, line: &Value) {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
        f.write_all(format!("{line}\n").as_bytes()).unwrap();
    }

    fn rec(key: &str, ts: f64, typ: &str, extra: Value) -> Value {
        let mut v = json!({"v": 1, "ts": ts, "type": typ, "key": key, "provider": "codex", "cwd": "/w/shop"});
        v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        v
    }

    #[test]
    fn codex_turn_and_guess() {
        let d = tmp("turn");
        let p = d.join("reports.jsonl");
        append(&p, &rec("k1", 100.0, "hello", json!({"client": {"name": "codex-mcp-client"}})));
        append(
            &p,
            &rec(
                "k1",
                110.0,
                "status",
                json!({"state": "working", "title": "리팩터", "step": 1, "total": 3}),
            ),
        );
        let mut m = prov(p.clone());
        let s = m.snapshot(&ctx(120.0));
        let x = &s.sessions[0];
        assert_eq!(
            (x.status, x.started, x.provider, x.source),
            ("working", Some(110.0), Some("codex"), Some("mcp"))
        );
        assert_eq!(x.report.as_ref().unwrap()["step"], json!(1));
        assert_eq!(m.infos()[0].id, "codex");
        assert_eq!(m.snapshot(&ctx(110.0 + GUESS_AFTER)).sessions[0].confidence, Some("guess"));
        append(&p, &rec("k1", 200.0, "status", json!({"state": "asking", "title": "어느 쪽?"})));
        let x = m.snapshot(&ctx(201.0)).sessions.remove(0);
        assert_eq!((x.status, x.note.clone()), ("needs_input", Some(json!("어느 쪽?"))));
        append(&p, &rec("k1", 300.0, "status", json!({"state": "done"})));
        let x = m.snapshot(&ctx(301.0)).sessions.remove(0);
        assert_eq!(
            (x.status, x.started, x.run, x.prompt.clone()),
            ("done", None, 190.0, json!("어느 쪽?"))
        );
        append(&p, &rec("k1", 310.0, "bye", json!({})));
        assert!(m.snapshot(&ctx(311.0)).sessions.is_empty());
        std::fs::remove_dir_all(&d).ok();
    }

    /// 오늘 집계·일지 피드: working→asking→working→done(big·cheer) = 턴 1 + 질문 대기 1. 다시 읽어도(파일 교체) 중복 없음.
    /// Claude 사이드카·숨길 프로젝트는 빠지고, 세션이 bye로 끝나도 오늘 집계는 남는다
    #[test]
    fn day_feed_and_today() {
        let d = tmp("day");
        let p = d.join("reports.jsonl");
        append(&p, &rec("k1", 100.0, "status", json!({"state": "working", "title": "결제"})));
        append(&p, &rec("k1", 150.0, "status", json!({"state": "asking", "title": "할까요?"})));
        append(&p, &rec("k1", 170.0, "status", json!({"state": "asking"})));
        append(&p, &rec("k1", 200.0, "status", json!({"state": "working"})));
        append(
            &p,
            &rec(
                "k1",
                400.0,
                "status",
                json!({"state": "done", "big": true, "cheer": "버그까지 잡았어요"}),
            ),
        );
        append(&p, &rec("k1", 410.0, "bye", json!({})));
        let mut c = rec("c1", 100.0, "status", json!({"state": "working"}));
        c["provider"] = json!("claude");
        append(&p, &c);
        c["ts"] = json!(300.0);
        c["state"] = json!("done");
        append(&p, &c);
        let mut h = rec("h1", 100.0, "status", json!({"state": "working"}));
        h["cwd"] = json!("/Users/alex/.claude-mem/observer-sessions");
        append(&p, &h);
        h["ts"] = json!(300.0);
        h["state"] = json!("done");
        append(&p, &h);
        let mut m = prov(p.clone());
        let s = m.snapshot(&ctx(500.0));
        assert!(s.sessions.is_empty(), "bye로 끝난 세션");
        assert_eq!((s.today.done, s.today.waited), (1, 300.0));
        assert_eq!(s.days.len(), 1);
        let (id, f) = &s.days[0];
        assert_eq!(*id, "codex");
        assert_eq!(f.turns.len(), 1);
        let t = &f.turns[0];
        assert_eq!((t.start, t.end, t.big, t.prompt.as_str()), (100.0, 400.0, true, "할까요?"));
        assert_eq!(t.cheer.as_deref(), Some("버그까지 잡았어요"));
        assert_eq!(f.waits.iter().map(|w| (w.t0, w.t1)).collect::<Vec<_>>(), vec![(150.0, 200.0)]);
        assert_eq!(f.act.len(), 1);
        // 같은 내용으로 파일이 바뀌어 처음부터 다시 읽어도 턴·대기는 하나씩
        let body = std::fs::read(&p).unwrap();
        std::fs::remove_file(&p).unwrap();
        std::fs::write(&p, body).unwrap();
        let s = m.snapshot(&ctx(501.0));
        assert_eq!((s.today.done, s.days[0].1.turns.len(), s.days[0].1.waits.len()), (1, 1, 1));
        // 다음 날: 일지 피드에는 남고 오늘 집계에서는 빠진다
        assert_eq!(m.snapshot(&ctx(86400.0 + 10.0)).today.done, 0);
        std::fs::remove_dir_all(&d).ok();
    }

    /// 표시 이름: 보이는 Gemini 세션이 모두 Antigravity CLI면 "Antigravity", 하나라도 Gemini CLI면 "Gemini" (id는 그대로 gemini)
    #[test]
    fn antigravity_display_name() {
        let d = tmp("agy");
        let p = d.join("reports.jsonl");
        let mut a = rec("a1", 100.0, "hello", json!({"client": {"name": "antigravity-cli", "version": "1"}}));
        a["provider"] = json!("gemini");
        append(&p, &a);
        let mut m = prov(p.clone());
        m.snapshot(&ctx(110.0));
        let i = m.infos();
        assert_eq!((i[0].id, i[0].name), ("gemini", "Antigravity"));
        let mut g = rec("g1", 120.0, "hello", json!({"client": {"name": "gemini-cli-mcp-client"}}));
        g["provider"] = json!("gemini");
        append(&p, &g);
        m.snapshot(&ctx(130.0));
        assert_eq!(m.infos()[0].name, "Gemini");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rejects_bad_lines_and_routes_claude() {
        let d = tmp("bad");
        let p = d.join("reports.jsonl");
        append(&p, &rec("k1", 100.0, "status", json!({"state": "nope"})));
        append(&p, &json!({"v": 2, "ts": 1.0, "type": "hello", "key": "k2"}));
        append(&p, &rec("../x", 100.0, "hello", json!({})));
        std::fs::OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"not json\n")
            .unwrap();
        let mut c = rec("c1", 100.0, "board", json!({"lines": ["계획"]}));
        c["provider"] = json!("claude");
        append(&p, &c);
        let mut m = prov(p);
        let s = m.snapshot(&ctx(120.0));
        assert!(s.sessions.is_empty());
        assert_eq!(s.orphans.len(), 1);
        assert_eq!(s.orphans[0].report["board"]["lines"], json!(["계획"]));
        assert_eq!(s.report_ts, Some(100.0));
        std::fs::remove_dir_all(&d).ok();
    }

    /// T7: 1MB를 넘으면 리더가 회전하고, 그다음 기록(사이드카처럼 열고 쓰기)은 새 파일에서 처음부터 읽힌다
    #[test]
    fn rotates_and_resets_offset() {
        let d = tmp("rot");
        let p = d.join("reports.jsonl");
        let pad = "x".repeat(900);
        let mut n = 0;
        while crate::jsonl::size(&p).unwrap_or(0) <= ROTATE_AT {
            append(&p, &rec(&format!("k{n}"), 100.0, "hello", json!({"pad": pad})));
            n += 1;
        }
        let mut m = prov(p.clone());
        m.snapshot(&ctx(101.0));
        assert!(d.join("reports.1.jsonl").exists() && !p.exists());
        assert_eq!(m.off, 0);
        append(&p, &rec("new", 102.0, "status", json!({"state": "working", "title": "새 파일"})));
        let s = m.snapshot(&ctx(103.0));
        let x = s.sessions.iter().find(|x| x.sid == "new").unwrap();
        assert_eq!(x.prompt, json!("새 파일"));
        std::fs::remove_dir_all(&d).ok();
    }

    /// T11: 사이드카가 bye 없이 죽으면(pid 없음) 세션을 끝낸다
    #[test]
    fn dead_pid_ends_session() {
        let d = tmp("pid");
        let p = d.join("reports.jsonl");
        let mut child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
            .args(if cfg!(windows) { ["/C", "exit 0"] } else { ["-c", "exit 0"] })
            .spawn()
            .unwrap();
        let pid = child.id() as i64;
        child.wait().unwrap();
        append(&p, &rec("dead", 100.0, "status", json!({"state": "working", "pid": pid})));
        append(
            &p,
            &rec("live", 100.0, "status", json!({"state": "working", "pid": std::process::id()})),
        );
        let mut m = prov(p);
        let sids: Vec<String> = m.snapshot(&ctx(101.0)).sessions.into_iter().map(|s| s.sid).collect();
        assert_eq!(sids, ["live"]);
        std::fs::remove_dir_all(&d).ok();
    }

    /// 엔진: 보고 읽기를 끄면 세션·`state.mcp`가 빠지고, `last_report_age`만 바뀐 상태는 같은 digest
    #[test]
    fn engine_switch_and_digest() {
        use crate::{Clock, Engine, EngineConfig};
        let d = tmp("eng");
        let p = d.join("reports.jsonl");
        append(&p, &rec("k1", 100.0, "status", json!({"state": "working"})));
        let mut e = Engine::new(EngineConfig {
            clock: Clock::Fixed(101.0),
            tz: Tz::Fixed(0),
            home: String::new(),
            emit_providers: true,
        });
        e.add(Box::new(prov(p)));
        let a = e.state_at(101.0);
        assert_eq!(a.sessions[0].provider, Some("codex"));
        assert_eq!(a.mcp.as_ref().unwrap().last_report_age, Some(1.0));
        assert_eq!(a.providers.as_ref().unwrap()[0].id, "codex");
        assert_eq!(a.digest(), e.state_at(105.0).digest());
        e.set_reports_on(false);
        let b = e.state_at(106.0);
        assert!(b.sessions.is_empty() && b.mcp.is_none());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn off_reads_nothing() {
        let d = tmp("off");
        let p = d.join("reports.jsonl");
        append(&p, &rec("k1", 100.0, "status", json!({"state": "working"})));
        let mut m = prov(p);
        m.set_reports_on(false);
        assert!(m.snapshot(&ctx(101.0)).sessions.is_empty());
        m.set_reports_on(true);
        assert_eq!(m.snapshot(&ctx(101.0)).sessions.len(), 1);
        std::fs::remove_dir_all(&d).ok();
    }
}

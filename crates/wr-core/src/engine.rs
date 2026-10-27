//! 엔진: 프로바이더를 묶어 `/state`·`/trace`를 만든다. 시계·시간대·홈을 주입할 수 있다(테스트 결정성).
//!
//! 데스크톱 앱(P3)에서는 `Engine`을 `Mutex`로 감싸 두고
//! - 파일 감시(`watch_paths()`) 이벤트(디바운스 150ms)와 2초 tick마다 `state_if_changed()`를 불러 바뀐 때만 `state` 이벤트를 보내고,
//! - 흐름 모드가 켜져 있을 때만 `trace()`를 부른다.
//!
//! MCP 보고: 프로바이더가 넘긴 `orphans`(Claude 사이드카 보고)는 **훅이 설치·동작 중이면 버린다**(훅 report가 정확한 세션·턴·서브에이전트를
//! 구분하므로. 사이드카 보고를 붙이면 같은 폴더의 다른 창·지난 턴 보드·서브에이전트 계획이 엉뚱하게 붙는다). 훅이 없을 때만 보고가 없는 같은 cwd의
//! 활성 Claude 세션이 하나뿐이고 그 세션의 마지막 프롬프트 뒤 보고일 때 붙인다 (server.py `attach_orphans`와 같은 규칙). 보고 읽기가 꺼져 있으면(`set_reports_on(false)`) 모든 `report`·`state.mcp`를 뺀다.

use crate::clock::{Clock, Tz};
use crate::daylog::{DayFeed, DayLog};
use crate::model::{McpInfo, Poll, ProviderInfo, Session, State, Today};
use crate::paths::{home_dir, EnvSource, OsEnv};
use crate::provider::{Ctx, Orphan, Polled, Provider, TraceQuery, TraceReply, WatchPath};
use crate::providers::claude::{config::ClaudeConfig, ClaudeProvider};
use crate::providers::mcp::{McpConfig, McpProvider};
use serde_json::{json, Value};

#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub clock: Clock,
    pub tz: Tz,
    /// 텍스트에서 `~`로 줄일 홈 경로
    pub home: String,
    /// state에 `providers`·세션 `provider`를 넣을지 (@since 1.1)
    pub emit_providers: bool,
}

impl EngineConfig {
    pub fn from_env(env: &dyn EnvSource) -> EngineConfig {
        EngineConfig {
            clock: Clock::System,
            tz: Tz::Local,
            home: home_dir(env).to_string_lossy().into_owned(),
            emit_providers: true,
        }
    }
}

pub struct Engine {
    pub cfg: EngineConfig,
    providers: Vec<Box<dyn Provider>>,
    last_digest: Option<u64>,
    /// 퇴근 일보 일지 (None이면 기록하지 않음. `from_env`·앱은 켜고, 테스트용 `new`는 꺼진 채)
    daylog: Option<DayLog>,
    /// MCP 보고 읽기 (앱 설정 `mcpReports`. 끄면 `report`·`state.mcp`를 내보내지 않는다)
    reports_on: bool,
}

/// 사이드카 보고를 Claude 세션에 붙일 때 "활성"으로 보는 시간 (마지막 활동 10분 이내)
pub const ATTACH_WINDOW: f64 = 600.0;

/// `orphans`를 붙인다: 최신 보고부터, 훅 보고가 없고 cwd가 같은 활성 Claude 세션이 **정확히 하나**일 때만 (못 붙이면 버림)
fn attach_orphans(tagged: &mut [(&'static str, Session)], mut orphans: Vec<Orphan>, now: f64) {
    let hooked: Vec<bool> = tagged.iter().map(|(_, s)| s.report.is_some()).collect();
    orphans.sort_by(|a, b| b.ts.total_cmp(&a.ts).then_with(|| a.key.cmp(&b.key)));
    for o in orphans {
        let hits: Vec<usize> = tagged
            .iter()
            .enumerate()
            .filter(|(i, (id, s))| {
                *id == "claude" && !hooked[*i] && s.cwd == o.cwd && now - s.last < ATTACH_WINDOW && s.prompt_ts.is_none_or(|p| o.ts >= p)
            })
            .map(|(i, _)| i)
            .collect();
        if let [i] = hits[..] {
            let s = &mut tagged[i].1;
            if s.report.is_none() {
                s.report = Some(o.report);
            }
        }
    }
}

/// GET /daylog·POST /daylog/seen 응답: HTTP 상태 코드 + 본문
#[derive(Clone, Debug)]
pub struct DayReply {
    pub status: u16,
    pub body: Value,
}

/// HTTP 인자와 같은 길이 제한 (server.py do_GET: 120자)
fn cap120(s: &str) -> String {
    crate::py::take(s, 120).to_string()
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> Engine {
        Engine {
            cfg,
            providers: vec![],
            last_digest: None,
            daylog: None,
            reports_on: true,
        }
    }

    /// 환경변수(`WAITING_ROOM_*`, `CLAUDE_CONFIG_DIR`)로 Claude 프로바이더 + MCP 보고 리더를 단 엔진
    /// (`WAITING_ROOM_REPORTS=off`면 보고 읽기 끔)
    pub fn from_env() -> Engine {
        let mut e = Engine::new(EngineConfig::from_env(&OsEnv));
        let claude = ClaudeConfig::from_env(&OsEnv);
        e.set_daylog(crate::daylog::dir_from_env(&OsEnv, &claude.root));
        let mcp = McpConfig::from_env(&OsEnv, &claude);
        e.reports_on = mcp.on;
        e.add(Box::new(ClaudeProvider::new(claude)));
        e.add(Box::new(McpProvider::new(mcp)));
        e
    }

    /// MCP 보고 읽기 켜기·끄기 (앱 설정)
    pub fn set_reports_on(&mut self, on: bool) {
        self.reports_on = on;
        for x in self.providers.iter_mut() {
            x.set_reports_on(on);
        }
    }

    /// 일지 폴더를 정한다(None = 끔). 시간대는 엔진 설정을 따른다
    pub fn set_daylog(&mut self, dir: Option<std::path::PathBuf>) {
        self.daylog = dir.map(|d| DayLog::new(d, self.cfg.tz));
    }

    pub fn daylog_dir(&self) -> Option<&std::path::Path> {
        self.daylog.as_ref().map(|d| d.dir.as_path())
    }

    pub fn add(&mut self, p: Box<dyn Provider>) {
        self.providers.push(p);
    }

    pub fn providers(&self) -> Vec<ProviderInfo> {
        self.providers.iter().flat_map(|p| p.infos()).collect()
    }

    pub fn ctx_at(&self, now: f64) -> Ctx {
        Ctx {
            now,
            tz: self.cfg.tz,
            home: self.cfg.home.clone(),
        }
    }

    pub fn now(&self) -> f64 {
        self.cfg.clock.now()
    }

    /// 파일 감시 대상 (모든 프로바이더)
    pub fn watch_paths(&self) -> Vec<WatchPath> {
        self.providers.iter().flat_map(|p| p.watch_paths()).collect()
    }

    pub fn state(&mut self) -> State {
        let now = self.now();
        self.state_at(now)
    }

    /// 주어진 시각의 /state
    pub fn state_at(&mut self, now: f64) -> State {
        let ctx = self.ctx_at(now);
        let mut tagged: Vec<(&'static str, Session)> = vec![];
        let mut orphans = vec![];
        let mut report_ts: Option<f64> = None;
        let mut hooks_active = false;
        let mut today = Today::default();
        let mut limits = None;
        let mut hooks = None;
        let mut feeds: Vec<(&'static str, DayFeed)> = vec![];
        let emit = self.cfg.emit_providers;
        for p in self.providers.iter_mut() {
            let id = p.info().id;
            let mut snap = p.snapshot(&ctx);
            feeds.push((id, std::mem::take(&mut snap.day)));
            feeds.append(&mut snap.days);
            tagged.extend(snap.sessions.into_iter().map(|s| (id, s)));
            orphans.append(&mut snap.orphans);
            hooks_active |= snap.hooks_active;
            if let Some(t) = snap.report_ts {
                report_ts = Some(report_ts.map_or(t, |r: f64| r.max(t)));
            }
            today.merge(&snap.today);
            if limits.is_none() {
                limits = snap.limits;
            }
            if hooks.is_none() {
                hooks = snap.hooks;
            }
        }
        if !self.reports_on {
            tagged.iter_mut().for_each(|(_, s)| s.report = None);
        } else if !hooks_active {
            attach_orphans(&mut tagged, orphans, now);
        }
        // MCP 세션은 프로바이더가 도구(codex·gemini…)를 정해 둔다
        let mut sessions: Vec<Session> = tagged
            .into_iter()
            .map(|(id, mut s)| {
                s.provider = if emit { Some(s.provider.unwrap_or(id)) } else { None };
                s
            })
            .collect();
        sessions.sort_by(|a, b| a.sid.cmp(&b.sid).then_with(|| a.provider.cmp(&b.provider)));
        let (lim, lim_ts, src, poll) = match limits {
            Some(b) => (b.limits, b.limits_ts, b.src, b.poll),
            None => (Value::Null, Value::Null, "statusline", Poll { on: false, err: None }),
        };
        if !self.reports_on {
            // 보고 읽기가 꺼져 있으면 훅으로 들어온 AI 보고(큰 일 표시·칭찬 한마디)도 일지에 남기지 않는다
            for (_, f) in feeds.iter_mut() {
                for t in f.turns.iter_mut() {
                    t.big = false;
                    t.cheer = None;
                }
            }
        }
        if let Some(dl) = self.daylog.as_mut() {
            let refs: Vec<(&str, &DayFeed)> = feeds.iter().map(|(id, f)| (*id, f)).collect();
            dl.record(&refs, &lim, now);
        }
        State {
            now,
            sessions,
            waited_today: today.waited,
            done_today: today.done,
            today_kinds: today.kinds,
            today_agents: today.agents,
            today_tokens: today.tokens,
            limits: lim,
            limits_ts: lim_ts,
            limits_src: src,
            poll,
            hooks,
            providers: if emit { Some(self.providers()) } else { None },
            mcp: self.reports_on.then(|| McpInfo {
                last_report_age: report_ts.map(|t| now - t),
            }),
        }
    }

    /// push용: `now`를 뺀 내용이 직전과 다를 때만 Some
    pub fn state_if_changed(&mut self) -> Option<State> {
        let s = self.state();
        let d = s.digest();
        if self.last_digest == Some(d) {
            return None;
        }
        self.last_digest = Some(d);
        Some(s)
    }

    pub fn trace(&mut self, q: &TraceQuery) -> TraceReply {
        let now = self.now();
        self.trace_at(q, now)
    }

    /// 주어진 시각의 /trace (인자는 120자로 자른다)
    pub fn trace_at(&mut self, q: &TraceQuery, now: f64) -> TraceReply {
        let q = TraceQuery {
            session: cap120(&q.session),
            prompt: cap120(&q.prompt),
            since: cap120(&q.since),
        };
        let ctx = self.ctx_at(now);
        let mut out = None;
        for p in self.providers.iter_mut() {
            if let Some(r) = p.trace(&ctx, &q) {
                out = Some(r);
                break;
            }
        }
        for p in self.providers.iter_mut() {
            p.gc();
        }
        out.unwrap_or(TraceReply {
            status: 200,
            body: json!({"session": q.session, "error": "no-transcript"}),
        })
    }

    /// GET /daylog?day=today|yesterday|YYYY-MM-DD — 상태를 한 번 만들어 일지를 최신으로 한 뒤 하루 집계
    pub fn daylog(&mut self, which: &str) -> DayReply {
        let now = self.now();
        self.daylog_at(which, now)
    }

    pub fn daylog_at(&mut self, which: &str, now: f64) -> DayReply {
        if self.daylog.is_none() {
            return DayReply {
                status: 404,
                body: json!({"error": "off"}),
            };
        }
        self.state_at(now);
        let which = crate::py::take(which, 20);
        match self.daylog.as_mut().and_then(|d| d.report(which, now)) {
            Some(body) => DayReply { status: 200, body },
            None => DayReply {
                status: 400,
                body: json!({"error": "bad-day"}),
            },
        }
    }

    /// POST /daylog/seen — 그날 일보를 봤다고 기록
    pub fn daylog_seen(&mut self, which: &str) -> DayReply {
        let now = self.now();
        self.daylog_seen_at(which, now)
    }

    pub fn daylog_seen_at(&mut self, which: &str, now: f64) -> DayReply {
        match self.daylog.as_mut() {
            None => DayReply {
                status: 404,
                body: json!({"error": "off"}),
            },
            Some(d) => match d.mark_seen(which, now) {
                Some(body) => DayReply { status: 200, body },
                None => DayReply {
                    status: 400,
                    body: json!({"error": "bad-day"}),
                },
            },
        }
    }

    /// 사용 한도 조회 켜짐 표시(state.poll.on)를 모든 프로바이더에 반영 (앱 설정에서 켜고 끌 때)
    pub fn set_poll_on(&mut self, on: bool) {
        for x in self.providers.iter_mut() {
            x.set_poll_on(on);
        }
    }

    /// 숨길 프로젝트 규칙을 모든 프로바이더에 반영 (앱 설정에서 바꿀 때)
    pub fn set_hide(&mut self, user: &[String], builtin: bool) {
        for x in self.providers.iter_mut() {
            x.set_hide(user, builtin);
        }
    }

    /// 사용 한도 조회 결과를 해당 프로바이더에 넣는다
    pub fn set_polled(&mut self, provider: &str, p: Polled) {
        for x in self.providers.iter_mut() {
            if x.info().id == provider {
                x.set_polled(p.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::claude::hooks::new_session;

    fn claude(sid: &str, cwd: &str, last: f64, prompt_ts: Option<f64>) -> (&'static str, Session) {
        let mut s = new_session(sid.into(), last);
        s.cwd = cwd.into();
        s.prompt_ts = prompt_ts;
        ("claude", s)
    }

    fn orphan(cwd: &str, ts: f64) -> Orphan {
        Orphan {
            key: "k".into(),
            cwd: cwd.into(),
            ts,
            report: serde_json::json!({"ts": ts}),
        }
    }

    /// 훅이 없을 때의 대체 경로: 같은 cwd 활성 세션이 하나뿐이고 마지막 프롬프트 뒤 보고일 때만 붙는다
    #[test]
    fn attach_rules_without_hooks() {
        let mut t = vec![claude("a", "/w", 100.0, Some(50.0))];
        attach_orphans(&mut t, vec![orphan("/w", 60.0)], 120.0);
        assert!(t[0].1.report.is_some());
        let mut t = vec![claude("a", "/w", 100.0, Some(70.0))];
        attach_orphans(&mut t, vec![orphan("/w", 60.0)], 120.0);
        assert!(t[0].1.report.is_none(), "지난 턴 보고");
        let mut t = vec![claude("a", "/w", 100.0, None), claude("b", "/w", 100.0, None)];
        attach_orphans(&mut t, vec![orphan("/w", 60.0)], 120.0);
        assert!(t.iter().all(|(_, s)| s.report.is_none()), "후보가 둘");
        let mut t = vec![claude("a", "/w", 100.0, None)];
        attach_orphans(&mut t, vec![orphan("/w", 60.0)], 100.0 + ATTACH_WINDOW);
        assert!(t[0].1.report.is_none(), "활성 아님");
    }
}

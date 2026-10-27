//! Claude Code 프로바이더 (첫 번째 구현).
//!
//! - 훅 이벤트(events.jsonl) → `hooks` (server.py 상태 기계, 유령 에이전트 필터)
//! - 트랜스크립트(`projects/*/<sid>.jsonl`, `<sid>/subagents/`) → `scan`(토큰·발화·실행 중 도구), `tonly`(훅 없는 판정), `trace`(흐름 모드)
//! - 사용 한도(oauth usage API) → `usage`
//! - statusline 탭 파일(선택) → 컨텍스트 %·한도

pub mod config;
pub mod describe;
pub mod hooks;
pub mod scan;
pub mod tonly;
pub mod trace;
#[cfg(feature = "usage")]
pub mod usage;

use crate::daylog::{DayFeed, FeedAct, FeedTurn, FeedWait};
use crate::health::health;
use crate::hide::HideRules;
use crate::limits::merge_limits;
use crate::model::{tok_sum, HooksInfo, LimitsBlock, Poll, ProviderInfo, Session, Today, Usage};
use crate::provider::{cap, Ctx, Polled, Provider, Snapshot, TraceQuery, TraceReply, WatchPath};
use crate::py::{get, project_name, truthy};
use config::{ClaudeConfig, SourceMode};
use hooks::{EventLog, HookSession};
use indexmap::IndexMap;
use scan::Scans;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// 이 시간 동안 소식 없는 세션은 숨김
pub const STALE: f64 = 6.0 * 3600.0;

/// 에이전트의 마지막 활동이 STALE 이상 지났는가 (정확히 6시간부터 true. server.py `now - last >= STALE`)
pub fn agent_stale(last: f64, now: f64) -> bool {
    now - last >= STALE
}
/// 병합: 최근 이만큼 안에 훅 이벤트가 있으면 훅이 정한 상태를 쓴다
pub const HOOK_FRESH: f64 = 600.0;
/// SessionEnd 뒤 이 시간(초) 안의 트랜스크립트 기록은 같은 세션의 마무리로 보고 재개로 치지 않는다
const ENDED_GRACE: f64 = 5.0;

pub struct ClaudeProvider {
    pub cfg: ClaudeConfig,
    log: EventLog,
    scans: Scans,
    paths: HashMap<String, PathBuf>,
    tracer: trace::Tracer,
    tonly: tonly::TOnly,
    polled: Polled,
    hooks_cache: Option<(Option<std::time::SystemTime>, bool)>,
    hide: HideRules,
    /// 지금까지 본 statusline 한도의 창별 병합 상태 (파일이 오래된 값으로 덮여도 내려가지 않게)
    sl_memo: Value,
}

/// 파일 이름으로 써도 안전한 id인가 (경로 구분자·`..` 금지)
fn safe_name(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\', '\0'])
}

impl ClaudeProvider {
    pub fn new(cfg: ClaudeConfig) -> Self {
        let cfg_hide = cfg.hide_rules();
        ClaudeProvider {
            cfg,
            log: EventLog::default(),
            scans: Scans::default(),
            paths: HashMap::new(),
            tracer: trace::Tracer::default(),
            tonly: tonly::TOnly::default(),
            polled: Polled::default(),
            hooks_cache: None,
            hide: cfg_hide,
            sl_memo: Value::Null,
        }
    }

    /// `transcript(sid)`: `projects/*/<sid>.jsonl` (찾으면 기억)
    fn transcript(&mut self, sid: &str) -> Option<PathBuf> {
        if let Some(p) = self.paths.get(sid) {
            return Some(p.clone());
        }
        if !safe_name(sid) {
            return None;
        }
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&self.cfg.projects).ok()?.flatten().map(|d| d.path()).collect();
        dirs.sort();
        let name = format!("{sid}.jsonl");
        for d in dirs {
            let p = d.join(&name);
            if p.is_file() {
                self.paths.insert(sid.to_string(), p.clone());
                return Some(p);
            }
        }
        None
    }

    fn statusline(&self) -> Value {
        let Some(p) = &self.cfg.status else { return Value::Null };
        std::fs::read(p)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .filter(|v| v.is_object())
            .unwrap_or(Value::Null)
    }

    /// settings.json에 이 앱(또는 레거시 hook.py) 훅이 등록돼 있나 (mtime 캐시)
    fn hooks_installed(&mut self) -> bool {
        let mt = std::fs::metadata(&self.cfg.settings).and_then(|m| m.modified()).ok();
        if let Some((m, v)) = self.hooks_cache {
            if m == mt {
                return v;
            }
        }
        let v = std::fs::read_to_string(&self.cfg.settings)
            .map(|s| {
                let s = s.replace("\\\\", "/");
                s.contains("waiting-room/bin/wr-hook") || s.contains("wr-hook") || s.contains("waiting-room/hook.py")
            })
            .unwrap_or(false);
        self.hooks_cache = Some((mt, v));
        v
    }

    /// server.py `expire_agents()` — Stop이 누락돼 running으로 남은 에이전트 정리.
    /// 마지막 활동(훅 `last`와 트랜스크립트 마지막 기록 중 늦은 것)이 STALE보다 오래됐으면 done + stale로 바꾼다.
    fn expire_agents(&mut self, h: &mut HookSession, ctx: &Ctx) {
        if !h.agents.values().any(|a| a.status == "running" && agent_stale(a.last, ctx.now)) {
            return;
        }
        let path = self.transcript(&h.s.sid);
        for a in h.agents.values_mut() {
            if a.status != "running" || !agent_stale(a.last, ctx.now) {
                continue;
            }
            let mut last = a.last;
            if let Some(p) = &path {
                let s = p.to_string_lossy();
                let sub = PathBuf::from(&s[..s.len() - ".jsonl".len()])
                    .join("subagents")
                    .join(format!("agent-{}.jsonl", a.aid));
                if safe_name(&a.aid) && sub.exists() {
                    last = last.max(self.scans.get(&sub, ctx.tz).last_ts);
                }
            }
            if agent_stale(last, ctx.now) {
                a.status = "done";
                a.ended = Some(last);
                a.stale = Some(true);
                a.health = None;
            }
        }
    }

    /// server.py `add_tokens()` — 토큰·발화·멈춤 판정을 트랜스크립트에서
    fn add_tokens(&mut self, h: &mut HookSession, day_start: f64, today_msgs: &mut Vec<Usage>, ctx: &Ctx) {
        let Some(path) = self.transcript(&h.s.sid) else { return };
        let main = self.scans.get(&path, ctx.tz);
        let mut msgs: Vec<Usage> = main.msgs.values().copied().collect();
        if h.s.status == "working" {
            h.s.say = Some(main.say.clone());
            h.s.health = Some(health(
                main.pending.values().map(|(n, t)| (n.as_str(), *t)),
                main.last_ts,
                h.s.last,
                ctx.now,
            ));
        }
        let sub_dir = {
            let s = path.to_string_lossy();
            PathBuf::from(&s[..s.len() - ".jsonl".len()]).join("subagents")
        };
        for a in h.agents.values_mut() {
            let sub = sub_dir.join(format!("agent-{}.jsonl", a.aid));
            let empty = scan::ScanCache::default();
            let c = if safe_name(&a.aid) { self.scans.get(&sub, ctx.tz) } else { &empty };
            a.tokens = Some(tok_sum(c.msgs.values(), 0.0).total);
            a.say = Some(c.say.clone());
            // 트랜스크립트가 없으면 조용한 시간을 잴 근거가 없으므로 멈춤 판정 생략
            if a.status == "running" && safe_name(&a.aid) && sub.exists() {
                a.health = Some(health(
                    c.pending.values().map(|(n, t)| (n.as_str(), *t)),
                    c.last_ts,
                    a.last,
                    ctx.now,
                ));
            }
            msgs.extend(c.msgs.values().copied());
        }
        h.s.tokens = Some(tok_sum(msgs.iter(), h.s.prompt_ts.filter(|&x| x != 0.0).unwrap_or(0.0)));
        today_msgs.extend(msgs.into_iter().filter(|m| m.ts >= day_start));
    }

    fn finish_hook_session(h: HookSession, sl: &Value, now: f64) -> Session {
        let mut s = h.s;
        s.report = h.fold.map(|f| f.value(now));
        s.project = project_name(&s.cwd);
        let mut agents: Vec<_> = h.agents.into_values().collect();
        agents.sort_by(|a, b| a.since.partial_cmp(&b.since).unwrap_or(std::cmp::Ordering::Equal));
        s.agents = agents;
        // 메인은 멈췄지만 백그라운드 에이전트가 아직 일하는 경우
        if matches!(s.status, "done" | "idle") && s.agents.iter().any(|a| a.status == "running") {
            s.status = "agents";
        }
        s.ctx = ctx_of(sl, &s.sid);
        s
    }

    /// 한도: statusline 값과 직접 조회 값 중 더 최근 것이 `src`·`limits_ts`를 정하고, 내용은 창별 최댓값으로 합친다
    /// (오래된 세션이 보낸 낮은 값·5시간 없는 값·지난 창이 섞이지 않게. 규칙은 `limits::merge_limits`)
    fn limits_block(&mut self, sl: &Value, now: f64) -> LimitsBlock {
        let sl_ts = get(sl, "limits_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let poll = Poll {
            on: self.cfg.poll_on,
            err: self.polled.err.clone(),
        };
        // 파일을 읽을 때마다 이전 관찰값과 합친다 (파일 한 장만 보면 오래된 세션 값에 덮여 깜빡임)
        let seen = get(sl, "limits").cloned().unwrap_or(Value::Null);
        self.sl_memo = merge_limits(&self.sl_memo, &seen, now);
        let sl_limits = self.sl_memo.clone();
        match &self.polled.limits {
            Some(l) if truthy(l) && self.polled.ts > sl_ts => LimitsBlock {
                limits: merge_limits(&sl_limits, l, now),
                limits_ts: self.polled.ts.into(),
                src: "poll",
                poll,
            },
            _ => LimitsBlock {
                limits: sl_limits,
                limits_ts: get(sl, "limits_ts").cloned().unwrap_or(Value::Null),
                src: "statusline",
                poll,
            },
        }
    }

    /// 사용자가 [키체인에서 읽기]를 눌렀을 때처럼 명시적으로 부르는 경로용 접근자
    pub fn credentials_path(&self) -> &Path {
        &self.cfg.credentials
    }
}

fn ctx_of(sl: &Value, sid: &str) -> Value {
    get(sl, "sessions")
        .and_then(|s| get(s, sid))
        .filter(|v| truthy(v))
        .and_then(|v| get(v, "ctx"))
        .cloned()
        .unwrap_or(Value::Null)
}

impl Provider for ClaudeProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: "claude",
            name: "Claude",
            icon: None,
            capabilities: vec![
                cap::SUBAGENTS,
                cap::HOOKS,
                cap::LIMITS,
                cap::TODOS,
                cap::THINKING,
                cap::TRACE,
                cap::TOKENS,
            ],
        }
    }

    fn watch_paths(&self) -> Vec<WatchPath> {
        let mut v = vec![WatchPath {
            path: self.cfg.projects.clone(),
            recursive: true,
            exts: vec!["jsonl", "json"],
        }];
        if self.cfg.source != SourceMode::Transcript {
            v.push(WatchPath {
                path: self.cfg.log.clone(),
                recursive: false,
                exts: vec![],
            });
        }
        if let Some(s) = &self.cfg.status {
            v.push(WatchPath {
                path: s.clone(),
                recursive: false,
                exts: vec![],
            });
        }
        v
    }

    fn snapshot(&mut self, ctx: &Ctx) -> Snapshot {
        let now = ctx.now;
        let tz = ctx.tz;
        let day_start = ctx.day_start();
        let mode = self.cfg.source;
        let v11 = self.cfg.v11_fields;

        // 1) 훅
        let (mut hook_map, mut today, last_event, report_ts) = if mode == SourceMode::Transcript {
            (IndexMap::new(), Today::default(), None, None)
        } else {
            self.log.refresh(&self.cfg.log.clone());
            // 숨길 프로젝트(플러그인 내부 세션)의 이벤트는 집계에도 넣지 않는다 (server.py build_state와 같음)
            let hide = &self.hide;
            let evs = self
                .log
                .recent()
                .filter(|e| hide.is_empty() || !get(e, "cwd").and_then(|c| c.as_str()).is_some_and(|c| hide.matches(c)));
            let r = hooks::replay(evs, now, tz);
            (r.sessions, r.today, r.last_event, r.last_report)
        };
        let mut today_msgs: Vec<Usage> = vec![];
        // 숨길 프로젝트(플러그인 내부 세션 등)는 토큰 스캔도 하지 않는다
        if !self.hide.is_empty() {
            hook_map.retain(|_, h| !self.hide.matches(&h.s.cwd));
        }
        // 일지: 훅 세션의 끝난 턴·질문 대기·마지막 활동 (server.py와 같은 순서·규칙)
        let mut day = DayFeed::default();
        for h in hook_map.values() {
            day.turns.extend(h.turns.iter().cloned());
            day.waits.extend(h.waits.iter().cloned());
            day.act.push(FeedAct {
                sid: h.s.sid.clone(),
                cwd: h.s.cwd.clone(),
                last: h.s.last,
            });
        }
        let sids: Vec<String> = hook_map.keys().cloned().collect();
        for sid in &sids {
            let mut h = hook_map.swap_remove(sid).unwrap();
            if h.s.last >= day_start {
                self.add_tokens(&mut h, day_start, &mut today_msgs, ctx);
            }
            hook_map.insert(sid.clone(), h);
        }
        today.tokens = tok_sum(today_msgs.iter(), 0.0);
        let sl = self.statusline();

        // 2) 트랜스크립트 전용 (Transcript / Auto)
        let mut sessions: Vec<Session> = vec![];
        let mut done_sids: HashSet<String> = HashSet::new();
        if mode != SourceMode::Hooks {
            let found = self.tonly.discovery.find(&self.cfg.projects, now, day_start, &self.hide);
            let keep: HashSet<PathBuf> = found.iter().map(|(_, p)| p.clone()).collect();
            for (sid, path) in &found {
                let hook = hook_map.get(sid);
                // 최근 훅이 있는 세션은 훅이 맡는다. 훅이 SessionEnd로 끝낸 세션은 트랜스크립트가 그 뒤로 이어졌는지 확인한다(재개).
                if hook.is_some_and(|h| now - h.s.last < HOOK_FRESH && !h.status_ended) {
                    continue;
                }
                let Some(r) = self.tonly.session(sid, path, &mut self.scans, now, tz, day_start) else {
                    continue;
                };
                if hook.is_some_and(|h| h.status_ended && r.last_ts <= h.s.last + ENDED_GRACE) {
                    continue; // 정말 끝난 세션: 3단계에서 숨김
                }
                // 일지: 훅 기록이 전혀 없는 세션만 트랜스크립트에서 (훅이 있으면 1단계 피드가 맡는다. 겹쳐도 5초 오차로 중복 제거)
                if hook.is_none() && !self.hide.matches(&r.session.cwd) {
                    let (cwd, sid) = (&r.session.cwd, sid.clone());
                    day.turns.extend(r.turns.iter().map(|(start, end, prompt)| FeedTurn {
                        sid: sid.clone(),
                        cwd: cwd.clone(),
                        prompt: prompt.clone(),
                        start: *start,
                        end: *end,
                        ..Default::default()
                    }));
                    day.waits.extend(r.waits.iter().map(|(t0, t1)| FeedWait {
                        sid: sid.clone(),
                        t0: *t0,
                        t1: *t1,
                    }));
                    day.act.push(FeedAct {
                        sid,
                        cwd: cwd.clone(),
                        last: r.last_ts,
                    });
                }
                // 오늘 집계: 훅 기록이 없거나, 훅 기록이 전부 오늘 이전이라 1단계에서 더해진 게 없을 때만 합친다
                if hook.is_none_or(|h| h.s.last < day_start) {
                    today.merge(&r.today);
                }
                // STALE이 지난 세션은 오늘 집계에만 넣고 목록에는 넣지 않는다
                if now - r.last_ts >= STALE {
                    continue;
                }
                let mut s = r.session;
                // 폴더 이름으로 못 거른 것(비ASCII 경로 등)은 cwd로
                if self.hide.matches(&s.cwd) {
                    continue;
                }
                s.ctx = ctx_of(&sl, sid);
                s.mask();
                sessions.push(s);
                done_sids.insert(sid.clone());
            }
            self.tonly.retain(&keep);
        }

        // 3) 훅 세션 (Hooks 전부 / Auto는 트랜스크립트로 대체되지 않은 것)
        for (sid, h) in hook_map {
            if done_sids.contains(&sid) || h.s.status == "ended" || now - h.s.last >= STALE {
                continue;
            }
            let mut h = h;
            self.expire_agents(&mut h, ctx);
            let mut s = Self::finish_hook_session(h, &sl, now);
            if v11 {
                s.source = Some("hook");
                s.confidence = Some("sure");
            }
            s.mask();
            sessions.push(s);
        }
        sessions.sort_by(|a, b| a.sid.cmp(&b.sid));

        let hooks = if v11 {
            Some(HooksInfo {
                installed: self.hooks_installed() || last_event.is_some(),
                last_event_age: last_event.map(|t| now - t),
            })
        } else {
            None
        };
        Snapshot {
            sessions,
            today,
            limits: Some(self.limits_block(&sl, now)),
            hooks,
            day,
            days: vec![],
            orphans: vec![],
            report_ts,
            hooks_active: mode != SourceMode::Transcript && (last_event.is_some() || self.hooks_installed()),
        }
    }

    fn trace(&mut self, ctx: &Ctx, q: &TraceQuery) -> Option<TraceReply> {
        let path = if trace::sid_ok(&q.session) {
            self.transcript(&q.session)
        } else {
            None
        };
        let which = if q.prompt.is_empty() { "last" } else { q.prompt.as_str() };
        Some(
            self.tracer
                .build(&q.session, path.as_deref(), which, &q.since, ctx.now, ctx.tz, &ctx.home),
        )
    }

    fn set_poll_on(&mut self, on: bool) {
        self.cfg.poll_on = on;
    }

    fn set_hide(&mut self, user: &[String], builtin: bool) {
        // 환경변수(WAITING_ROOM_HIDE*)로 준 것도 유지
        let all: Vec<String> = self.cfg.hide_user.iter().chain(user.iter()).cloned().collect();
        let r = HideRules::new(&all, builtin && self.cfg.hide_builtin);
        if r != self.hide {
            self.hide = r;
            self.tonly.discovery.reset();
        }
    }

    fn set_polled(&mut self, p: Polled) {
        // 실패하면 직전 한도는 그대로 두고 오류 코드만 바꾼다 (server.py poll_loop와 같음)
        if let Some(new) = p.limits {
            // 직전 조회와 창별 최댓값으로 합친다 (같은 창 안에서 사용률은 줄지 않음)
            let prev = self.polled.limits.clone().unwrap_or(Value::Null);
            let merged = merge_limits(&prev, &new, p.ts);
            self.polled = Polled {
                limits: Some(if merged.is_null() { new } else { merged }),
                ts: p.ts,
                err: None,
            };
        } else {
            self.polled.err = p.err;
        }
    }

    fn gc(&mut self) {
        self.tracer.gc();
    }
}

#[cfg(test)]
mod stale_tests {
    use super::*;

    #[test]
    fn agent_stale_boundary() {
        let now = 1_000_000.0;
        assert!(!agent_stale(now - (6.0 * 3600.0 - 60.0), now), "5시간 59분은 유지");
        assert!(agent_stale(now - (6.0 * 3600.0 + 60.0), now), "6시간 1분은 종료");
        assert!(agent_stale(now - 6.0 * 3600.0, now), "정확히 6시간부터 종료(server.py >=)");
    }
}

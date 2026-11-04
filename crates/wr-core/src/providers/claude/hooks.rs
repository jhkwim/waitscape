//! 훅 이벤트 로그(events.jsonl) 증분 읽기 + 세션 상태 기계 (server.py `build_state()` 앞부분, `track_agent()`,
//! `take_pending()`, `close_agents()` 이식). 유령 에이전트 필터(SubagentStart 없이 타입도 없는 aid 무시) 포함.
//!
//! MCP 보고(`report` 필드가 있는 PreToolUse, wr-hook이 `mcp__waitscape__*` 호출에서 기록): 도구 호출로 세지 않고
//! (말풍선·활동·종류 집계 없음) 세션의 `report`로 접는다. 서브에이전트(`aid`)의 보고는 무시, 새 프롬프트에서 비운다.

use crate::clock::Tz;
use crate::daylog::{FeedTurn, FeedWait};
use crate::jsonl::ident;
use crate::model::{Activity, Agent, AgentTool, Session, Today};
use crate::py::{get, num, py_str, truthy};
use crate::report::{board_of, status_of, Fold};
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::Path;

/// server.py가 보는 최근 줄 수
pub const LOG_LINES: usize = 5000;
/// 이만큼 커지면 리더(앱)가 `events.1.jsonl`로 회전한다 (#122). 쓰는 쪽(wr-hook)은 회전하지 않는다 —
/// 여러 훅 프로세스가 동시에 돌고 Windows는 열린 파일 rename이 실패할 수 있어서(mcp.rs `ROTATE_AT`과 같은 방식)
pub const LOG_ROTATE_AT: u64 = 5 << 20;

/// events.jsonl 링버퍼. 매번 전체를 다시 파싱하지 않고 새 줄만 읽는다 (#122 회전).
/// - 처음 읽을 때는 회전된 `events.1.jsonl`의 줄을 먼저 채운다(server.py처럼 둘을 이어 최근 5000줄)
/// - 회전·교체(파일 식별자가 바뀜)돼도 버퍼는 그대로, 옛 파일에 늦게 붙은 줄(회전 순간 열려 있던 훅이 쓴 것)을 마저 읽은 뒤 새 파일을 처음부터
/// - 같은 파일이 잘리면 처음부터(+ events.1 다시 채움), 두 파일이 모두 없으면 비움
#[derive(Debug, Default)]
pub struct EventLog {
    off: u64,
    lines: VecDeque<Option<Value>>,
    /// 개행 없는 마지막 줄 (파이썬 readlines()는 이것도 한 줄로 본다)
    tail: Option<Option<Value>>,
    /// 읽고 있는 events.jsonl 식별자 (`jsonl::ident`)
    ident: Option<(u64, u64)>,
    /// 회전된 파일(events.1.jsonl)의 (식별자, 읽은 위치) — 같은 파일이면 늦게 붙은 줄을 이어 읽는다
    prev: Option<(Option<(u64, u64)>, u64)>,
    /// 처음 읽기(events.1 채우기)를 했나
    loaded: bool,
}

/// 열린 파일 `f`의 `off`부터 완성된 줄을 `f`에 넘기고 (읽은 끝, 개행 없는 마지막 조각)을 돌려준다 — 경로를 다시 열지 않아 교체 경합이 없다
fn read_handle(f: &mut std::fs::File, mut off: u64, mut each: impl FnMut(&[u8])) -> (u64, Vec<u8>) {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    if f.seek(SeekFrom::Start(off)).is_err() {
        return (off, vec![]);
    }
    let mut r = BufReader::with_capacity(1 << 20, f);
    let mut buf = Vec::with_capacity(1 << 16);
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(n) if n > 0 && buf.last() == Some(&b'\n') => {
                off += n as u64;
                each(&buf);
            }
            _ => return (off, std::mem::take(&mut buf)),
        }
    }
}

impl EventLog {
    pub fn refresh(&mut self, path: &Path) {
        self.refresh_at(path, LOG_ROTATE_AT);
    }

    fn push(lines: &mut VecDeque<Option<Value>>, raw: &[u8]) {
        lines.push_back(serde_json::from_slice(raw).ok());
        if lines.len() > LOG_LINES {
            lines.pop_front();
        }
    }

    /// 회전된 파일: 처음이면 처음부터(채우기), 아니면 기억한 같은 파일의 늦게 붙은 줄만
    fn drain_old(&mut self, old: &Path) {
        let Ok(mut f) = std::fs::File::open(old) else { return };
        let Ok(meta) = f.metadata() else { return };
        let id = ident(&meta);
        let from = match self.prev {
            Some((pid, poff)) if pid == id && meta.len() >= poff => poff,
            Some(_) => return, // 다른 파일(또 회전됨 등) — 버퍼에 이미 있던 줄을 다시 넣지 않는다
            None if !self.loaded => 0,
            None => return,
        };
        let lines = &mut self.lines;
        let (end, _) = read_handle(&mut f, from, |raw| Self::push(lines, raw));
        self.prev = Some((id, end));
    }

    /// `rotate_at` 바이트를 넘으면 회전 (테스트는 작은 값)
    pub fn refresh_at(&mut self, path: &Path, rotate_at: u64) {
        let old = path.with_file_name("events.1.jsonl");
        if !self.loaded {
            self.drain_old(&old);
            self.loaded = true;
        }
        let Ok(mut f) = std::fs::File::open(path) else {
            // 없음: 방금 회전해 다음 훅이 새 파일을 만들기 전이면 events.1의 늦은 줄만. 둘 다 없으면 지운 것 → 비움
            self.drain_old(&old);
            if !old.exists() {
                self.lines.clear();
                self.prev = None;
            }
            self.off = 0;
            self.ident = None;
            self.tail = None;
            return;
        };
        let Ok(meta) = f.metadata() else { return };
        let (sz, id) = (meta.len(), ident(&meta));
        if id != self.ident {
            // 다른 파일(누가 회전·교체): 내가 읽던 파일이 지금 events.1이면 그 뒤에 붙은 줄을 마저 읽는다
            if self.ident.is_some() {
                self.prev = Some((self.ident, self.off));
            }
            self.drain_old(&old);
            self.off = 0;
            self.ident = id;
        } else if sz < self.off {
            // 같은 파일이 잘림 → 처음부터 (events.1 다시 채움)
            *self = EventLog {
                ident: id,
                ..EventLog::default()
            };
            self.drain_old(&old);
            self.loaded = true;
        } else if self.prev.is_some() {
            self.drain_old(&old); // 우리가 회전한 뒤 늦게 붙은 줄
        }
        let lines = &mut self.lines;
        let (off, rest) = read_handle(&mut f, self.off, |raw| Self::push(lines, raw));
        self.off = off;
        self.tail = (!rest.is_empty()).then(|| serde_json::from_slice(&rest).ok());
        // 끝까지 다 읽었고(미완성 줄 없음) 충분히 크면 회전. 회전 순간 열려 있던 훅이 쓴 줄은 다음에 events.1에서 마저 읽는다.
        // rename이 실패하면(Windows에서 대상이 열려 있음 등) 다음에 다시
        if off >= rotate_at && self.tail.is_none() && std::fs::rename(path, &old).is_ok() {
            self.prev = Some((id, off));
            self.off = 0;
            self.ident = None;
        }
    }

    /// 최근 5000줄 (마지막 미완성 줄 포함)
    pub fn recent(&self) -> impl Iterator<Item = &Value> {
        let total = self.lines.len() + self.tail.is_some() as usize;
        let skip = total.saturating_sub(LOG_LINES);
        self.lines.iter().chain(self.tail.iter()).skip(skip).filter_map(|v| v.as_ref())
    }
}

/// 훅으로 만든 세션 (내부 필드 포함)
#[derive(Debug, Clone)]
pub struct HookSession {
    pub s: Session,
    pub agents: IndexMap<String, Agent>,
    pending_agents: Vec<(Value, Value, Value)>,
    /// 이 세션의 마지막 훅 이벤트 시각 (= s.last)
    pub status_ended: bool,
    /// 일지용: 끝난 턴(Stop), 질문 대기(진행 중 턴의 Notification → 다음 UserPromptSubmit·Resume·PreToolUse·Stop)
    pub turns: Vec<FeedTurn>,
    pub waits: Vec<FeedWait>,
    wait0: Option<f64>,
    /// MCP 보고 (훅 `report` 이벤트를 접은 것)
    pub fold: Option<Fold>,
    /// 질문 판정(#118): PermissionRequest 시각 — permission_prompt 알림으로 확인되기 전(추정)
    perm_t: Option<f64>,
    /// 지금 질문이 추정(guess)인가 — PermissionRequest만 오고 아직 알림 확인 전
    pub guess: bool,
    /// 서브에이전트가 올린 질문이면 그 aid들 (모두 다시 움직이면 풀림). 메인이 올린 질문이면 비어 있음
    ask_aids: Vec<String>,
    /// 질문 직전 (status, since) — 서브에이전트 해제·바로 승인 되돌림 때 이 상태로 돌아간다(끝난 세션이 working으로 되살아나지 않게)
    pre: Option<(&'static str, f64)>,
}

/// PermissionRequest 뒤 이만큼 permission_prompt 알림(약 6초 대기 뒤 옴)이 없으면 바로 승인된 것으로 본다 (#118)
pub const PERM_QUICK: f64 = 10.0;

/// 질문 신호(#118): Some((종류, 확실)) — None이면 상태를 바꾸지 않는 이벤트.
/// 알림 종류가 없는 옛 Claude Code의 Notification은 예전처럼 질문(종류 없음)
fn ask_signal(e: &Value, ev: &str) -> Option<(Option<&'static str>, bool)> {
    match ev {
        "Notification" => match get(e, "ntype").and_then(|v| v.as_str()) {
            None => Some((None, true)),
            Some("permission_prompt") => Some((Some("permission"), true)),
            Some("elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input") => Some((Some("question"), true)),
            Some(_) => None, // idle_prompt(끝난 뒤 입력 기다림)·auth_success·quota_* 등은 질문이 아님
        },
        // 사람 없는 세션(claude -p)의 권한 요청은 곧바로 거부되므로 질문이 아님
        "PermissionRequest" if !get(e, "una").is_some_and(truthy) => Some((Some("permission"), false)),
        _ => None,
    }
}

/// 질문 신호를 세션에 반영 (메인·서브에이전트 공통)
fn apply_ask(h: &mut HookSession, e: &Value, ts: f64, kind: Option<&'static str>, sure: bool, aid: Option<String>) {
    let s = &mut h.s;
    let text = getd(e, "text", json!(""));
    if s.status == "needs_input" {
        // 이미 질문 중: 처음 시각을 지킨다. 추정이면 확실로 올리고 대기 시작은 PermissionRequest 시각
        if sure && h.guess {
            h.guess = false;
            if let Some(t0) = h.perm_t.take() {
                let was_working = h.pre.is_some_and(|(st, _)| st == "working");
                if was_working && s.started.is_some_and(|x| x != 0.0) && h.wait0.is_none() {
                    h.wait0 = Some(t0);
                }
            }
        }
        if s.ask.is_none() {
            s.ask = kind;
        }
        // 서브에이전트들이 올린 질문에 다른 서브에이전트가 더하면 모두 풀려야 풀림 (메인이 올린 질문엔 더하지 않음)
        if let Some(a) = aid {
            if !h.ask_aids.is_empty() && !h.ask_aids.contains(&a) {
                h.ask_aids.push(a);
            }
        }
        return;
    }
    if sure && s.status == "working" && s.started.is_some_and(|x| x != 0.0) && h.wait0.is_none() {
        h.wait0 = Some(ts);
    }
    h.pre = Some((s.status, s.since));
    s.status = "needs_input";
    s.since = ts;
    s.note = Some(text);
    s.ask = kind;
    h.guess = !sure;
    h.perm_t = if sure { None } else { Some(ts) };
    h.ask_aids = aid.into_iter().collect();
}

/// 질문 표시를 지운다(다음 도구·프롬프트·재개·Stop·종료가 상태를 정함)
fn clear_ask(h: &mut HookSession) {
    h.s.ask = None;
    h.perm_t = None;
    h.guess = false;
    h.ask_aids.clear();
    h.pre = None;
}

/// 추정 권한 요청이 `at` 시각까지 PERM_QUICK초 넘게 확인되지 않았으면 바로 승인된 것 — 다음 이벤트 처리 전·재생 끝에 본다
fn quick_approved(h: &mut HookSession, at: f64) {
    if let (true, Some(t0)) = (h.guess && h.s.status == "needs_input", h.perm_t) {
        if at - t0 > PERM_QUICK {
            end_ask(h, t0);
        }
    }
}

/// 메인 이벤트 없이 질문이 풀림(서브에이전트가 다시 움직임·바로 승인): 질문 직전 상태로 — 일하던 중이었으면 `ts`부터 working
fn end_ask(h: &mut HookSession, ts: f64) {
    let pre = h.pre;
    clear_ask(h);
    match pre {
        Some((st, since)) if st != "working" => {
            h.s.status = st;
            h.s.since = since;
        }
        _ => {
            h.s.status = "working";
            h.s.since = ts;
        }
    }
    h.status_ended = h.s.status == "ended";
}

/// 파이썬 dict 키를 JSON 키 문자열로
pub fn json_key(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

fn getd(e: &Value, k: &str, d: Value) -> Value {
    get(e, k).cloned().unwrap_or(d)
}

pub fn new_session(sid: String, ts: f64) -> Session {
    Session {
        sid,
        project: String::new(),
        status: "idle",
        since: ts,
        started: None,
        prompt: json!(""),
        note: None,
        tools: 0,
        tokens: None,
        ctx: Value::Null,
        todos: vec![],
        agents: vec![],
        activity: vec![],
        health: None,
        say: None,
        source: None,
        confidence: None,
        ask: None,
        provider: None,
        report: None,
        kinds: IndexMap::new(),
        kind: None,
        trail: vec![],
        run: 0.0,
        last: ts,
        prompt_ts: None,
        cwd: String::new(),
        jump: None,
    }
}

fn take_pending(q: &mut Vec<(Value, Value, Value)>, atype: Option<&Value>) -> (Value, Value) {
    if let Some(i) = q.iter().position(|(_, _, want)| truthy(want) && atype == Some(want)) {
        let (d, b, _) = q.remove(i);
        return (d, b);
    }
    if let Some(i) = q.iter().position(|(_, _, want)| !truthy(want)) {
        let (d, b, _) = q.remove(i);
        return (d, b);
    }
    if !q.is_empty() {
        let (d, b, _) = q.remove(0);
        return (d, b);
    }
    (json!(""), json!(false))
}

fn track_agent(h: &mut HookSession, e: &Value, ev: &str, ts: f64) {
    let aid = py_str(get(e, "aid").unwrap_or(&Value::Null));
    let atype = get(e, "atype");
    if !h.agents.contains_key(&aid) {
        // SubagentStart 없이 타입도 없이 나타나는 aid는 Claude Code 내부 보조 에이전트
        // (턴 종료 직후 SubagentStop만 오거나 PreToolUse 하나만 남음, 트랜스크립트 없음) → 무시
        if ev != "SubagentStart" && !atype.is_some_and(truthy) {
            return;
        }
        let (desc, bg) = if ev == "SubagentStart" {
            take_pending(&mut h.pending_agents, atype)
        } else {
            (json!(""), json!(false))
        };
        let t = atype.filter(|v| truthy(v)).map(py_str).unwrap_or_else(|| "agent".into());
        h.agents.insert(
            aid.clone(),
            Agent {
                aid: aid.clone(),
                atype: t,
                desc,
                bg,
                status: "running",
                since: ts,
                ended: None,
                stale: None,
                tools: 0,
                now: None,
                recent: vec![],
                last: ts,
                tokens: None,
                say: None,
                health: None,
            },
        );
    }
    let a = h.agents.get_mut(&aid).unwrap();
    a.last = ts;
    if ev == "PreToolUse" {
        a.tools += 1;
        let now = AgentTool {
            icon: getd(e, "icon", json!("🔧")),
            text: getd(e, "text", json!("")),
            kind: getd(e, "kind", json!("other")),
        };
        a.recent.push(now.clone());
        if a.recent.len() > 3 {
            a.recent.remove(0);
        }
        a.now = Some(now);
    } else if ev == "SubagentStop" {
        a.status = "done";
        a.ended = Some(ts);
    }
}

/// 훅 `report` 필드(정화된 `tool_input` 사본) → (도구, 다시 정화한 값). 형식이 틀리면 None
fn report_of(r: &Value) -> Option<(&'static str, serde_json::Map<String, Value>)> {
    match get(r, "tool").and_then(|v| v.as_str()) {
        Some("status") => status_of(r).ok().map(|m| ("status", m)),
        Some("board") => board_of(r).ok().map(|m| ("board", m)),
        _ => None,
    }
}

/// 훅 이벤트 재생 결과
pub struct Replay {
    pub sessions: IndexMap<String, HookSession>,
    pub today: Today,
    /// 마지막 훅 이벤트 시각
    pub last_event: Option<f64>,
    /// 마지막 MCP 보고 이벤트 시각
    pub last_report: Option<f64>,
}

/// 훅 이벤트를 순서대로 돌려 세션 상태를 만든다. today 집계(waited, done, kinds, agents)도 함께.
pub fn replay<'a>(events: impl Iterator<Item = &'a Value>, now: f64, tz: Tz) -> Replay {
    let today = tz.local_date(now);
    let mut sessions: IndexMap<String, HookSession> = IndexMap::new();
    let mut t = Today::default();
    let mut last_event: Option<f64> = None;
    let mut last_report: Option<f64> = None;
    for e in events {
        let (Some(sidv), Some(ts)) = (get(e, "sid"), num(get(e, "ts"))) else {
            continue;
        };
        let sid = py_str(sidv);
        last_event = Some(last_event.map_or(ts, |l: f64| l.max(ts)));
        let ev = get(e, "event").and_then(|v| v.as_str()).unwrap_or("");
        let rep = if ev == "PreToolUse" {
            get(e, "report").filter(|v| v.is_object())
        } else {
            None
        };
        let rep = rep.map(|r| (r, report_of(r)));
        if rep.as_ref().is_some_and(|(_, ok)| ok.is_some()) {
            last_report = Some(last_report.map_or(ts, |l: f64| l.max(ts)));
        }
        let h = sessions.entry(sid.clone()).or_insert_with(|| HookSession {
            s: new_session(sid.clone(), ts),
            agents: IndexMap::new(),
            pending_agents: vec![],
            status_ended: false,
            turns: vec![],
            waits: vec![],
            wait0: None,
            fold: None,
            perm_t: None,
            guess: false,
            ask_aids: vec![],
            pre: None,
        });
        if let Some(c) = get(e, "cwd").filter(|v| truthy(v)) {
            h.s.cwd = py_str(c);
        }
        quick_approved(h, ts);
        // 멀티플렉서(Orca·cmux) 이동 정보: 마지막으로 받은 올바른 값 (서브에이전트 이벤트도 같은 셸이라 받는다)
        if let Some(j) = get(e, "term").and_then(crate::term::jump_of) {
            h.s.jump = Some(j);
        }
        h.s.last = ts;
        if tz.local_date(ts) == today {
            if ev == "PreToolUse" && rep.is_none() {
                *t.kinds.entry(json_key(&getd(e, "kind", json!("other")))).or_insert(0) += 1;
            } else if ev == "SubagentStart" {
                t.agents += 1;
            }
        }
        if get(e, "aid").is_some_and(truthy) {
            // 서브에이전트의 MCP 보고는 메인 보드를 덮지 않게 버린다
            let aid = py_str(get(e, "aid").unwrap_or(&Value::Null));
            if rep.is_none() {
                track_agent(h, e, ev, ts);
                // 서브에이전트가 권한·질문을 기다리면 메인도 멈춘 것 — 메인 질문으로 올린다(백그라운드 에이전트는 제외, #118)
                if let Some((kind, sure)) = ask_signal(e, ev) {
                    // 등록된 포그라운드 에이전트만 (유령 보조 에이전트·백그라운드 제외)
                    if h.agents.get(&aid).is_some_and(|a| !truthy(&a.bg)) {
                        apply_ask(h, e, ts, kind, sure, Some(aid));
                    }
                    continue;
                }
            }
            // 질문을 올린 서브에이전트가 다시 움직임(MCP 보고 포함) → 그 에이전트는 답을 받음. 모두 받으면 질문이 풀린다
            if matches!(ev, "PreToolUse" | "SubagentStop") && h.s.status == "needs_input" && h.ask_aids.contains(&aid) {
                h.ask_aids.retain(|a| *a != aid);
                if h.ask_aids.is_empty() {
                    if let Some(t0) = h.wait0.take() {
                        h.waits.push(FeedWait {
                            sid: sid.clone(),
                            t0,
                            t1: ts,
                        });
                    }
                    end_ask(h, ts);
                }
            }
            continue;
        }
        let s = &mut h.s;
        if let Some(td) = get(e, "todos").filter(|v| !v.is_null()) {
            s.todos = td.as_array().cloned().unwrap_or_default();
        }
        if let Some(tn) = get(e, "task_new").filter(|v| truthy(v)) {
            let id = get(tn, "id")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| json!((s.todos.len() + 1).to_string()));
            s.todos
                .push(json!({"id": id, "text": getd(tn, "text", Value::Null), "status": "pending"}));
        }
        if let Some(u) = get(e, "task_upd").filter(|v| truthy(v)) {
            let uid = getd(u, "id", Value::Null);
            let ust = getd(u, "status", Value::Null);
            let utx = getd(u, "text", Value::Null);
            for td in s.todos.iter_mut() {
                if let Value::Object(o) = td {
                    if o.get("id") == Some(&uid) {
                        if truthy(&ust) {
                            o.insert("status".into(), ust.clone());
                        }
                        if truthy(&utx) && ust.as_str() == Some("in_progress") {
                            o.insert("text".into(), utx.clone());
                        }
                    }
                }
            }
            s.todos.retain(|td| get(td, "status").and_then(|v| v.as_str()) != Some("deleted"));
        }
        if let Some(d) = get(e, "agent_desc").filter(|v| truthy(v)) {
            h.pending_agents
                .push((d.clone(), getd(e, "bg", json!(false)), getd(e, "agent_req", json!(""))));
        }
        // 일지: 질문 대기 구간 (server.py build_state와 같은 규칙. 끝난 뒤 오는 알림은 대기가 아님 —
        // 대기 시작은 apply_ask가 정한다: 확실한 질문만, 추정이 확인되면 PermissionRequest 시각부터)
        match ev {
            "UserPromptSubmit" | "Resume" | "PreToolUse" | "Stop" => {
                if let Some(t0) = h.wait0.take() {
                    h.waits.push(FeedWait {
                        sid: sid.clone(),
                        t0,
                        t1: ts,
                    });
                }
            }
            "SessionEnd" => h.wait0 = None,
            _ => {}
        }
        if matches!(ev, "UserPromptSubmit" | "Resume" | "PreToolUse" | "Stop" | "SessionEnd") {
            clear_ask(h);
        }
        if let Some((kind, sure)) = ask_signal(e, ev) {
            apply_ask(h, e, ts, kind, sure, None);
        }
        let s = &mut h.s;
        match ev {
            "PostToolUse" => continue,
            "UserPromptSubmit" => {
                if !s.todos.is_empty()
                    && s.todos
                        .iter()
                        .all(|td| get(td, "status").and_then(|v| v.as_str()) == Some("completed"))
                {
                    s.todos.clear();
                }
                h.agents.retain(|_, a| a.status == "running");
                h.fold = None;
                s.prompt_ts = Some(ts);
                s.status = "working";
                s.since = ts;
                s.started = Some(ts);
                s.tools = 0;
                s.prompt = getd(e, "text", json!(""));
                s.activity.clear();
                s.kind = Some(json!("think"));
                s.kinds.clear();
                s.trail.clear();
            }
            "Resume" => {
                if s.status != "working" {
                    s.status = "working";
                    s.since = ts;
                    s.started = Some(s.started.filter(|&x| x != 0.0).unwrap_or(ts));
                }
            }
            "PreToolUse" => {
                if s.status != "working" {
                    s.status = "working";
                    s.since = ts;
                }
                if let Some((_, r)) = &rep {
                    match r {
                        Some(("status", m)) => h.fold.get_or_insert_with(Fold::default).status(m, ts),
                        Some((_, m)) => h.fold.get_or_insert_with(Fold::default).board(m, ts),
                        None => {}
                    }
                    h.status_ended = h.s.status == "ended";
                    continue;
                }
                s.tools += 1;
                let k = getd(e, "kind", json!("other"));
                *s.kinds.entry(json_key(&k)).or_insert(0) += 1;
                let icon = getd(e, "icon", json!("🔧"));
                let text = getd(e, "text", json!(""));
                s.trail.push([k.clone(), icon.clone(), text.clone()]);
                if s.trail.len() > 300 {
                    s.trail.remove(0);
                }
                s.activity.push(Activity { ts, icon, text });
                if s.activity.len() > 6 {
                    s.activity.remove(0);
                }
                s.kind = Some(k);
                // AskUserQuestion·ExitPlanMode(wr-hook이 ask로 표시): 사람이 답해야 다음으로 감 — 트랜스크립트 전용(tonly.rs)과 같은 규칙
                if let Some(a) = get(e, "ask").and_then(|v| v.as_str()) {
                    let note = if a == "plan" {
                        "계획 승인을 기다리는 중"
                    } else {
                        "질문에 답을 기다리는 중"
                    };
                    if s.started.is_some_and(|x| x != 0.0) && h.wait0.is_none() {
                        h.wait0 = Some(ts);
                    }
                    s.status = "needs_input";
                    s.since = ts;
                    s.note = Some(json!(note));
                    s.ask = Some("question");
                }
            }
            "Stop" => {
                if let Some(st) = s.started.filter(|&x| x != 0.0) {
                    s.run = ts - st;
                    // 이번 턴에 AI가 MCP로 끝(done)을 보고했으면 큰 일 표시·칭찬 한마디도 일지로 (보고 읽기가 꺼져 있으면 엔진이 지움)
                    let fin = h.fold.as_ref().filter(|f| f.state.as_deref() == Some("done"));
                    h.turns.push(FeedTurn {
                        sid: sid.clone(),
                        cwd: s.cwd.clone(),
                        prompt: s.prompt.as_str().unwrap_or("").to_string(),
                        start: st,
                        end: ts,
                        big: fin.is_some_and(|f| f.big.is_some()),
                        cheer: fin.and_then(|f| f.cheer.clone()),
                    });
                    if tz.local_date(ts) == today {
                        t.waited += ts - st;
                        t.done += 1;
                    }
                }
                s.status = "done";
                s.since = ts;
                s.started = None;
            }
            "SessionEnd" => {
                s.status = "ended";
                h.status_ended = true;
                for a in h.agents.values_mut() {
                    if a.status == "running" {
                        a.status = "done";
                        a.ended = Some(ts);
                    }
                }
            }
            _ => {}
        }
        // SessionEnd 뒤에 같은 세션이 재개돼 상태가 바뀌었다면 종료 표시를 푼다
        h.status_ended = h.s.status == "ended";
    }
    // 권한 요청 뒤 PERM_QUICK초 동안 확인 알림이 없으면 바로 승인(또는 거절)된 것 → 질문 직전 상태로 (#118)
    for h in sessions.values_mut() {
        quick_approved(h, now);
    }
    Replay {
        sessions,
        today: t,
        last_event,
        last_report,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(v: Value) -> Value {
        v
    }

    /// #118 일지 대기: 유휴 알림·바로 승인은 대기가 아니고, 알림으로 확인된 권한은 PermissionRequest 시각부터 센다
    #[test]
    fn ask_waits() {
        let evs = vec![
            json!({"ts": 1.0, "sid": "a", "event": "UserPromptSubmit"}),
            json!({"ts": 5.0, "sid": "a", "event": "Stop"}),
            json!({"ts": 60.0, "sid": "a", "event": "Notification", "ntype": "idle_prompt"}),
            json!({"ts": 1.0, "sid": "b", "event": "UserPromptSubmit"}),
            json!({"ts": 10.0, "sid": "b", "event": "PermissionRequest"}),
            json!({"ts": 12.0, "sid": "b", "event": "PreToolUse"}),
            json!({"ts": 1.0, "sid": "c", "event": "UserPromptSubmit"}),
            json!({"ts": 10.0, "sid": "c", "event": "PermissionRequest"}),
            json!({"ts": 16.0, "sid": "c", "event": "Notification", "ntype": "permission_prompt"}),
            json!({"ts": 30.0, "sid": "c", "event": "PreToolUse"}),
        ];
        let r = replay(evs.iter(), 100.0, Tz::Fixed(0));
        let w = |sid: &str| r.sessions[sid].waits.iter().map(|w| (w.t0, w.t1)).collect::<Vec<_>>();
        assert_eq!(r.sessions["a"].s.status, "done");
        assert!(w("a").is_empty() && w("b").is_empty());
        assert_eq!(w("c"), vec![(10.0, 30.0)]);
        assert_eq!((r.sessions["c"].s.status, r.sessions["c"].s.ask), ("working", None));
    }

    /// #122: 리더가 회전해도 최근 줄 버퍼(세션)는 그대로, 회전 순간 열려 있던 훅이 옛 파일에 쓴 줄도 마저 읽음,
    /// 처음 켤 때 events.1을 먼저 채움(server.py와 같음), 같은 파일이 잘리면 처음부터(+ events.1), 둘 다 지우면 비움
    #[test]
    fn log_rotation_keeps_recent() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("wr-rot-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("events.jsonl");
        let old = dir.join("events.1.jsonl");
        let line = |sid: &str| format!("{{\"ts\": 1.0, \"sid\": \"{sid}\", \"event\": \"UserPromptSubmit\"}}\n");
        let open = || std::fs::OpenOptions::new().create(true).append(true).open(&p).unwrap();
        let sids = |l: &EventLog| l.recent().map(|v| v["sid"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let mut log = EventLog::default();
        open().write_all((line("a") + &line("b")).as_bytes()).unwrap();
        let mut late = open(); // 회전 순간 열려 있던 훅
        log.refresh_at(&p, 40);
        assert!(old.exists() && !p.exists(), "다 읽고 40바이트 넘으면 회전");
        assert_eq!(sids(&log), ["a", "b"]);
        late.write_all(line("late").as_bytes()).unwrap(); // 이름이 바뀐 옛 파일 끝에 붙음
        drop(late);
        log.refresh_at(&p, 1 << 20);
        assert_eq!(sids(&log), ["a", "b", "late"], "새 파일이 생기기 전에도 버퍼 유지 + 늦은 줄");
        open().write_all(line("c").as_bytes()).unwrap();
        log.refresh_at(&p, 1 << 20);
        open().write_all(line("d").as_bytes()).unwrap();
        log.refresh_at(&p, 1 << 20);
        assert_eq!(sids(&log), ["a", "b", "late", "c", "d"], "새 파일은 처음부터, 중복 없음");
        // 처음 켤 때: events.1을 먼저 채운다
        let mut cold = EventLog::default();
        cold.refresh_at(&p, 1 << 20);
        assert_eq!(sids(&cold), ["a", "b", "late", "c", "d"]);
        // 다른 리더가 회전 → 내가 읽던 파일(이제 events.1)에 늦게 붙은 줄도
        open().write_all(line("e").as_bytes()).unwrap();
        let mut other = EventLog::default();
        other.refresh_at(&p, 1); // 회전
        let mut late = std::fs::OpenOptions::new().append(true).open(&old).unwrap();
        late.write_all(line("f").as_bytes()).unwrap();
        drop(late);
        open().write_all(line("gg").as_bytes()).unwrap();
        cold.refresh_at(&p, 1 << 20);
        assert_eq!(
            sids(&cold),
            ["a", "b", "late", "c", "d", "e", "f", "gg"],
            "남이 회전해도 유실·중복 없음"
        );
        std::fs::write(&p, line("h")).unwrap(); // 같은 파일이 잘림(더 짧게) → 처음부터(events.1 + 지금 파일)
        cold.refresh_at(&p, 1 << 20);
        assert_eq!(sids(&cold), ["c", "d", "e", "f", "h"]);
        std::fs::remove_file(&p).unwrap();
        std::fs::remove_file(&old).unwrap(); // 둘 다 지움 → 비움
        cold.refresh_at(&p, 1 << 20);
        assert!(sids(&cold).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ghost_agents_are_ignored() {
        let evs = [
            ev(json!({"ts": 1.0, "sid": "s", "event": "UserPromptSubmit", "text": "hi"})),
            ev(json!({"ts": 2.0, "sid": "s", "event": "SubagentStop", "aid": "ghost"})),
            ev(json!({"ts": 3.0, "sid": "s", "event": "PreToolUse", "aid": "ghost2", "icon": "📖", "text": "x"})),
            ev(json!({"ts": 4.0, "sid": "s", "event": "PreToolUse", "kind": "agent", "agent_desc": "조사", "agent_req": "Explore"})),
            ev(json!({"ts": 5.0, "sid": "s", "event": "SubagentStart", "aid": "real", "atype": "Explore"})),
        ];
        let r = replay(evs.iter(), 10.0, Tz::Fixed(0));
        let (s, last) = (r.sessions, r.last_event);
        let h = &s["s"];
        assert_eq!(h.agents.keys().collect::<Vec<_>>(), ["real"]);
        assert_eq!(h.agents["real"].desc, json!("조사"));
        assert_eq!(last, Some(5.0));
    }

    #[test]
    fn stop_counts_today() {
        let evs = [
            json!({"ts": 100.0, "sid": "s", "event": "UserPromptSubmit"}),
            json!({"ts": 130.0, "sid": "s", "event": "Stop"}),
        ];
        let Replay { sessions: s, today: t, .. } = replay(evs.iter(), 200.0, Tz::Fixed(0));
        assert_eq!((s["s"].s.status, s["s"].s.run, t.done, t.waited), ("done", 30.0, 1, 30.0));
    }

    /// MCP 보고 이벤트는 도구로 세지 않고 report로 접힌다. 서브에이전트 보고는 무시, 새 프롬프트에서 비움
    #[test]
    fn mcp_report_events() {
        let st = |ts: f64, extra: Value| {
            let mut e = json!({"ts": ts, "sid": "s", "event": "PreToolUse",
                               "report": {"tool": "status", "state": "working", "title": "리팩터", "step": 1, "total": 2}});
            e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            e
        };
        let evs = [
            json!({"ts": 1.0, "sid": "s", "event": "UserPromptSubmit", "text": "hi"}),
            st(2.0, json!({})),
            json!({"ts": 3.0, "sid": "s", "event": "PreToolUse", "report": {"tool": "board", "lines": ["a", "b"], "done": [1]}}),
            json!({"ts": 4.0, "sid": "s", "event": "SubagentStart", "aid": "x", "atype": "Explore"}),
            json!({"ts": 5.0, "sid": "s", "event": "PreToolUse", "aid": "x", "atype": "Explore", "report": {"tool": "board", "lines": ["sub"]}}),
            json!({"ts": 6.0, "sid": "s", "event": "PreToolUse", "report": {"tool": "status", "state": "nope"}}),
        ];
        let r = replay(evs.iter(), 10.0, Tz::Fixed(0));
        let h = &r.sessions["s"];
        assert_eq!((h.s.tools, h.s.activity.len(), h.s.kinds.len(), r.today.kinds.len()), (0, 0, 0, 0));
        assert_eq!(h.agents["x"].tools, 0);
        let v = h.fold.as_ref().unwrap().value(10.0);
        assert_eq!(
            (v["title"].clone(), v["board"]["lines"].clone()),
            (json!("리팩터"), json!(["a", "b"]))
        );
        assert_eq!(r.last_report, Some(5.0), "서브에이전트 보고도 연결 신호로는 센다");
        let mut evs = evs.to_vec();
        evs.push(json!({"ts": 7.0, "sid": "s", "event": "UserPromptSubmit", "text": "새 일"}));
        assert!(replay(evs.iter(), 10.0, Tz::Fixed(0)).sessions["s"].fold.is_none());
    }

    // 리뷰 F4: SessionEnd 뒤 같은 세션이 재개되면 status_ended가 풀려야 한다
    #[test]
    fn resume_after_session_end_clears_ended() {
        let evs = [
            json!({"ts": 100.0, "sid": "s", "event": "UserPromptSubmit"}),
            json!({"ts": 130.0, "sid": "s", "event": "SessionEnd"}),
        ];
        let m = replay(evs.iter(), 200.0, Tz::Fixed(0)).sessions;
        assert!(m["s"].status_ended);
        let evs = [
            json!({"ts": 100.0, "sid": "s", "event": "UserPromptSubmit"}),
            json!({"ts": 130.0, "sid": "s", "event": "SessionEnd"}),
            json!({"ts": 300.0, "sid": "s", "event": "UserPromptSubmit"}),
        ];
        let m = replay(evs.iter(), 400.0, Tz::Fixed(0)).sessions;
        assert_eq!((m["s"].status_ended, m["s"].s.status), (false, "working"));
    }
}

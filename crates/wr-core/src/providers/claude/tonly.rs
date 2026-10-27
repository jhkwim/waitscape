//! 트랜스크립트 전용 판정 (훅 없음). 규칙: fixtures/transcript-only/RULES.md.
//! 줄을 증분으로 읽어 턴 상태를 쌓아 두고, 상태(status·since·confidence)는 요청 시각(now)에 결정한다.

use super::describe::{describe, kind_of, short, sval, todos_of};
use super::hooks::new_session;
use super::scan::{blocks, key_of, parse_line, ScanCache};
use super::trace::{load_meta, text_of, Meta};
use crate::clock::Tz;
use crate::health::health;
use crate::hide::HideRules;
use crate::jsonl::{read_lines, size};
use crate::model::{tok_sum, Activity, Agent, Session, Today, Usage};
use crate::py::{get, project_name, py_str, strip, truthy};
use crate::redact::redact;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const STALE: f64 = 6.0 * 3600.0;
/// 권한이 필요할 수 있는 도구가 결과 없이 이만큼 기다리면 "입력 필요일 수도"
pub const INPUT_GUESS: f64 = 8.0;
/// stop_reason 없는 마지막 발화 뒤 이만큼 조용하면 "끝난 것 같음"
pub const DONE_GUESS: f64 = 30.0;

fn needs_permission(tool: &str) -> bool {
    matches!(
        tool,
        "Bash" | "Edit" | "MultiEdit" | "Write" | "NotebookEdit" | "WebFetch" | "WebSearch"
    ) || tool.starts_with("mcp__")
}

fn terminal(stop: &str) -> bool {
    matches!(stop, "end_turn" | "stop_sequence" | "max_tokens" | "refusal")
}

#[derive(Debug, Clone, PartialEq)]
enum Last {
    None,
    Prompt,
    ToolResult,
    Notify,
    Interrupt(f64),
    Assistant(f64, Option<String>),
}

#[derive(Debug, Clone)]
struct TAgent {
    ts: f64,
    aid: Option<String>,
    atype: Option<String>,
    desc: String,
    bg: bool,
    /// 동기 호출 결과 도착 시각
    done_ts: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct TCache {
    off: u64,
    cwd: String,
    first_ts: Option<f64>,
    last_ts: f64,
    prompt: String,
    prompt_ts: Option<f64>,
    turn_start: f64,
    turn_open: bool,
    work_since: f64,
    working: bool,
    run: f64,
    tools: i64,
    kinds: IndexMap<String, i64>,
    kind: Option<String>,
    activity: Vec<Activity>,
    trail: Vec<[Value; 3]>,
    todos: Vec<Value>,
    task_new: HashMap<String, String>,
    task_upd: HashMap<String, (String, Value, String)>,
    pend: IndexMap<String, (String, f64)>,
    last: Last,
    agents: IndexMap<String, TAgent>,
    notified: HashMap<String, f64>,
    /// 끝난 턴 (시작, 끝, 프롬프트 요약)
    finished: Vec<(f64, f64, String)>,
    /// 일지용 질문 대기: AskUserQuestion·ExitPlanMode tool_use → 그 결과(답)
    waits: Vec<(f64, f64)>,
    tool_log: Vec<(f64, &'static str)>,
    agent_starts: Vec<f64>,
    pending_cmd: Option<(f64, String)>,
}

impl Default for TCache {
    fn default() -> Self {
        TCache {
            off: 0,
            cwd: String::new(),
            first_ts: None,
            last_ts: 0.0,
            prompt: String::new(),
            prompt_ts: None,
            turn_start: 0.0,
            turn_open: false,
            work_since: 0.0,
            working: false,
            run: 0.0,
            tools: 0,
            kinds: IndexMap::new(),
            kind: None,
            activity: vec![],
            trail: vec![],
            todos: vec![],
            task_new: HashMap::new(),
            task_upd: HashMap::new(),
            pend: IndexMap::new(),
            last: Last::None,
            agents: IndexMap::new(),
            notified: HashMap::new(),
            finished: vec![],
            waits: vec![],
            tool_log: vec![],
            agent_starts: vec![],
            pending_cmd: None,
        }
    }
}

struct Res {
    agent_id: Regex,
    task_id: Regex,
    cmd_name: Regex,
    cmd_args: Regex,
}

fn res() -> &'static Res {
    static R: OnceLock<Res> = OnceLock::new();
    R.get_or_init(|| Res {
        agent_id: Regex::new(r"agentId: ([A-Za-z0-9_-]+)").unwrap(),
        task_id: Regex::new(r"<task-id>([\w-]+)</task-id>").unwrap(),
        cmd_name: Regex::new(r"<command-name>(.*?)</command-name>").unwrap(),
        cmd_args: Regex::new(r"(?s)<command-args>(.*?)</command-args>").unwrap(),
    })
}

impl TCache {
    fn set_working(&mut self, ts: f64) {
        if !self.working {
            self.working = true;
            self.work_since = ts;
        }
    }

    fn finish(&mut self, end: f64, count: bool) {
        if self.turn_open {
            self.run = end - self.turn_start;
            if count {
                self.finished.push((self.turn_start, end, self.prompt.clone()));
            }
            self.turn_open = false;
        }
        self.working = false;
    }

    fn apply_prompt(&mut self, ts: f64, text: &str) {
        if let Last::Assistant(t, _) = self.last {
            if self.turn_open && self.pend.is_empty() {
                self.finish(t, true);
            }
        }
        if !self.todos.is_empty()
            && self
                .todos
                .iter()
                .all(|t| get(t, "status").and_then(|v| v.as_str()) == Some("completed"))
        {
            self.todos.clear();
        }
        self.prompt = short(&redact(text), 60);
        self.prompt_ts = Some(ts);
        self.turn_start = ts;
        self.turn_open = true;
        self.working = true;
        self.work_since = ts;
        self.tools = 0;
        self.kinds.clear();
        self.kind = Some("think".into());
        self.activity.clear();
        self.trail.clear();
        self.pend.clear();
        self.last = Last::Prompt;
    }

    fn flush_cmd(&mut self) {
        if let Some((t, txt)) = self.pending_cmd.take() {
            self.apply_prompt(t, &txt);
        }
    }

    fn line(&mut self, assistant: bool, ts: f64, d: &Value) {
        if get(d, "isMeta").is_some_and(truthy) || get(d, "isSidechain").is_some_and(truthy) {
            return;
        }
        self.first_ts.get_or_insert(ts);
        self.last_ts = self.last_ts.max(ts);
        if let Some(c) = get(d, "cwd").filter(|v| truthy(v)) {
            self.cwd = py_str(c);
        }
        let nullv = Value::Null;
        let m = get(d, "message").filter(|m| m.is_object()).unwrap_or(&nullv);
        if assistant {
            self.flush_cmd();
            for blk in blocks(m) {
                if get(blk, "type").and_then(|t| t.as_str()) != Some("tool_use") {
                    continue;
                }
                let name = get(blk, "name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let inp = get(blk, "input").unwrap_or(&nullv);
                let key = key_of(get(blk, "id"));
                self.set_working(ts);
                self.tools += 1;
                let k = kind_of(&name);
                *self.kinds.entry(k.to_string()).or_insert(0) += 1;
                self.kind = Some(k.to_string());
                let (icon, text) = describe(&name, inp, true);
                self.trail.push([json!(k), json!(icon), json!(text)]);
                if self.trail.len() > 300 {
                    self.trail.remove(0);
                }
                self.activity.push(Activity {
                    ts,
                    icon: json!(icon),
                    text: json!(text),
                });
                if self.activity.len() > 6 {
                    self.activity.remove(0);
                }
                self.tool_log.push((ts, k));
                match name.as_str() {
                    "TodoWrite" => self.todos = todos_of(inp, true),
                    "TaskCreate" => {
                        self.task_new.insert(key.clone(), short(&sval(get(inp, "subject"), true), 60));
                    }
                    "TaskUpdate" => {
                        let id = py_str(get(inp, "taskId").unwrap_or(&json!("")));
                        let st = get(inp, "status").cloned().unwrap_or(Value::Null);
                        let src = get(inp, "activeForm").filter(|v| truthy(v)).or_else(|| get(inp, "subject"));
                        self.task_upd.insert(key.clone(), (id, st, short(&sval(src, true), 60)));
                    }
                    "Agent" | "Task" => {
                        self.agents.insert(
                            key.clone(),
                            TAgent {
                                ts,
                                aid: None,
                                atype: get(inp, "subagent_type").filter(|v| truthy(v)).map(py_str),
                                desc: short(&sval(get(inp, "description"), true), 50),
                                bg: get(inp, "run_in_background").is_some_and(truthy),
                                done_ts: None,
                            },
                        );
                        self.agent_starts.push(ts);
                    }
                    _ => {}
                }
                self.pend.insert(key, (name, ts));
            }
            let stop = get(m, "stop_reason").filter(|v| truthy(v)).map(py_str);
            if stop.as_deref().is_some_and(terminal) && self.pend.is_empty() {
                self.finish(ts, true);
            }
            self.last = Last::Assistant(ts, stop);
            return;
        }
        // user
        let bl = blocks(m);
        if bl.iter().any(|b| get(b, "type").and_then(|t| t.as_str()) == Some("tool_result")) {
            self.flush_cmd();
            for blk in bl {
                if get(blk, "type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                let key = key_of(get(blk, "tool_use_id"));
                let Some((name, t0)) = self.pend.shift_remove(&key) else {
                    continue;
                };
                if name == "AskUserQuestion" || name == "ExitPlanMode" {
                    self.waits.push((t0, ts));
                }
                if let Some(subject) = self.task_new.remove(&key) {
                    let resp = get(d, "toolUseResult").filter(|v| truthy(v));
                    let task = resp.map(|r| get(r, "task").unwrap_or(r));
                    let id = task
                        .and_then(|t| get(t, "id"))
                        .map(py_str)
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| (self.todos.len() + 1).to_string());
                    self.todos.push(json!({"id": id, "text": subject, "status": "pending"}));
                }
                if let Some((id, st, text)) = self.task_upd.remove(&key) {
                    for t in self.todos.iter_mut() {
                        if let Value::Object(o) = t {
                            if o.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
                                if truthy(&st) {
                                    o.insert("status".into(), st.clone());
                                }
                                if !text.is_empty() && st.as_str() == Some("in_progress") {
                                    o.insert("text".into(), json!(text));
                                }
                            }
                        }
                    }
                    self.todos.retain(|t| get(t, "status").and_then(|v| v.as_str()) != Some("deleted"));
                }
                if let Some(a) = self.agents.get_mut(&key) {
                    let txt = text_of(get(blk, "content"));
                    if let Some(c) = res().agent_id.captures(&txt) {
                        a.aid = Some(c[1].to_string());
                    }
                    if !txt.contains("Async agent launched") {
                        a.done_ts = Some(ts);
                    }
                }
            }
            self.set_working(ts);
            self.last = Last::ToolResult;
            return;
        }
        let full = text_of(get(m, "content"));
        let text = strip(&full);
        if text.is_empty() {
            return;
        }
        if text.starts_with("<local-command-stdout>") && self.pending_cmd.is_some() {
            // 로컬 명령(/clear, /model 등): 프롬프트·상태 변화 없음
            self.pending_cmd = None;
            return;
        }
        self.flush_cmd();
        if text.starts_with("[Request interrupted") {
            self.finish(ts, false);
            self.pend.clear();
            self.last = Last::Interrupt(ts);
        } else if text.starts_with("<task-notification>") {
            if let Some(c) = res().task_id.captures(text) {
                self.notified.insert(c[1].to_string(), ts);
            }
            if !self.working {
                self.working = true;
                self.work_since = ts;
                if !self.turn_open {
                    self.turn_open = true;
                    self.turn_start = ts;
                }
            }
            self.last = Last::Notify;
        } else if text.starts_with("<command-name>") {
            let r = res();
            let nm = r.cmd_name.captures(text).map(|m| m[1].to_string()).unwrap_or_else(|| "/?".into());
            let ar = r.cmd_args.captures(text).map(|m| m[1].to_string()).unwrap_or_default();
            self.pending_cmd = Some((ts, format!("{nm} {ar}")));
        } else if !text.starts_with('<') {
            self.apply_prompt(ts, text);
        }
    }

    fn read(&mut self, path: &Path, tz: Tz) {
        let Some(sz) = size(path) else { return };
        if sz < self.off {
            *self = TCache::default();
        }
        let mut off = self.off;
        let _ = read_lines(path, &mut off, |raw| {
            if let Some((assistant, ts, d)) = parse_line(raw, tz) {
                self.line(assistant, ts, &d);
            }
        });
        self.off = off;
    }
}

/// 트랜스크립트 전용 엔진 캐시 (세션 파일·서브에이전트 메타)
#[derive(Debug, Default)]
pub struct TOnly {
    pub discovery: Discovery,
    files: HashMap<PathBuf, TCache>,
    meta: HashMap<PathBuf, Meta>,
}

/// 계산 결과 하나 (세션 + 오늘 집계 기여분)
pub struct TResult {
    pub session: Session,
    pub today: Today,
    pub last_ts: f64,
    /// 일지용: 최근 이틀 안에 끝난 턴 (추정 종료는 넣지 않음 — 나중에 이어지면 같은 턴이 둘로 남으므로)과 질문 대기
    pub turns: Vec<(f64, f64, String)>,
    pub waits: Vec<(f64, f64)>,
}

/// 파일을 읽을 최소 mtime. 목록에는 STALE 안의 세션만 넣지만, 오늘 끝난 세션(STALE이 지났어도)은 오늘 집계에 들어가야 하므로
/// 오늘 시작 시각까지 넓혀 읽는다.
fn mtime_cutoff(now: f64, day_start: f64) -> f64 {
    (now - STALE).min(day_start)
}

/// projects/*/*.jsonl 중 mtime이 STALE 안(또는 오늘 안)인 파일 (sid → 경로). 같은 sid가 여러 폴더에 있으면 가장 최근 mtime
pub fn discover(projects: &Path, now: f64, day_start: f64, hide: &HideRules) -> Vec<(String, PathBuf)> {
    let cutoff = mtime_cutoff(now, day_start);
    let mut best: HashMap<String, (f64, PathBuf)> = HashMap::new();
    let Ok(dirs) = std::fs::read_dir(projects) else { return vec![] };
    for d in dirs.flatten() {
        if !d.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        // 숨길 프로젝트는 폴더 안을 읽지도 않는다
        if d.file_name().to_str().is_some_and(|n| hide.matches(n)) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(d.path()) else { continue };
        for f in files.flatten() {
            let name = f.file_name();
            let Some(name) = name.to_str() else { continue };
            let Some(sid) = name.strip_suffix(".jsonl") else { continue };
            let Ok(md) = f.metadata() else { continue };
            if !md.is_file() {
                continue;
            }
            let mt = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            if mt < cutoff {
                continue;
            }
            let e = best.entry(sid.to_string()).or_insert((f64::MIN, PathBuf::new()));
            if mt > e.0 {
                *e = (mt, f.path());
            }
        }
    }
    let mut v: Vec<(String, PathBuf)> = best.into_iter().map(|(k, (_, p))| (k, p)).collect();
    v.sort();
    v
}

/// 세션 파일 발견 캐시: 30초마다 전체 다시 보기, 그 사이에는 폴더 mtime(새 파일)과 최근 파일만 stat
#[derive(Debug, Default)]
pub struct Discovery {
    /// 마지막 전체 다시 보기를 한 (주입 시계) 시각
    last_full: Option<f64>,
    dirs: HashMap<PathBuf, Option<std::time::SystemTime>>,
    recent: Vec<(String, PathBuf)>,
}

/// 전체 다시 보기 간격(초). 주입된 시계(`now`) 기준
pub const FULL_RESCAN: f64 = 30.0;

fn mtime_of(p: &Path) -> Option<f64> {
    std::fs::metadata(p)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs_f64())
}

impl Discovery {
    /// 규칙이 바뀌면 다음 `find`에서 전체를 다시 본다
    pub fn reset(&mut self) {
        self.last_full = None;
    }

    pub fn find(&mut self, projects: &Path, now: f64, day_start: f64, hide: &HideRules) -> Vec<(String, PathBuf)> {
        let dirs_now: HashMap<PathBuf, Option<std::time::SystemTime>> = std::fs::read_dir(projects)
            .map(|rd| {
                rd.flatten()
                    .filter(|d| d.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .filter(|d| !d.file_name().to_str().is_some_and(|n| hide.matches(n)))
                    .map(|d| (d.path(), d.metadata().and_then(|m| m.modified()).ok()))
                    .collect()
            })
            .unwrap_or_default();
        let cutoff = mtime_cutoff(now, day_start);
        // 시계가 뒤로 가도(재생·테스트) 전체 다시 보기
        let full_due = self.last_full.is_none_or(|t| now - t >= FULL_RESCAN || now < t);
        if full_due || dirs_now.len() != self.dirs.len() {
            self.recent = discover(projects, now, day_start, hide);
            self.last_full = Some(now);
            self.dirs = dirs_now;
            return self.recent.clone();
        }
        // 폴더 mtime이 바뀐 곳(파일 생성·삭제)만 다시 나열, 나머지는 알던 최근 파일만 stat
        let changed: Vec<PathBuf> = dirs_now
            .iter()
            .filter(|(d, m)| self.dirs.get(*d) != Some(m))
            .map(|(d, _)| d.clone())
            .collect();
        let mut out: HashMap<String, (f64, PathBuf)> = HashMap::new();
        for (sid, p) in &self.recent {
            if changed.iter().any(|d| p.starts_with(d)) {
                continue;
            }
            if let Some(mt) = mtime_of(p).filter(|mt| *mt >= cutoff) {
                out.insert(sid.clone(), (mt, p.clone()));
            }
        }
        for d in &changed {
            for f in std::fs::read_dir(d).into_iter().flatten().flatten() {
                let name = f.file_name();
                let Some(sid) = name.to_str().and_then(|n| n.strip_suffix(".jsonl")) else {
                    continue;
                };
                let Some(mt) = mtime_of(&f.path()).filter(|mt| *mt >= cutoff) else {
                    continue;
                };
                let e = out.entry(sid.to_string()).or_insert((f64::MIN, PathBuf::new()));
                if mt > e.0 {
                    *e = (mt, f.path());
                }
            }
        }
        self.dirs = dirs_now;
        let mut v: Vec<(String, PathBuf)> = out.into_iter().map(|(k, (_, p))| (k, p)).collect();
        v.sort();
        self.recent = v.clone();
        v
    }
}

impl TOnly {
    /// 한 세션 계산. `scans`는 /state와 같은 scan() 캐시(토큰·발화·서브에이전트)
    pub fn session(&mut self, sid: &str, path: &Path, scans: &mut super::scan::Scans, now: f64, tz: Tz, day_start: f64) -> Option<TResult> {
        let c = self.files.entry(path.to_path_buf()).or_default();
        c.read(path, tz);
        let first_ts = c.first_ts?;
        // STALE이 지난 세션도 계산한다: 오늘 끝난 일은 오늘 집계에 들어가야 하고, 목록에 넣을지는 호출하는 쪽이 `last_ts`로 정한다.
        // 아직 확정되지 않은 슬래시 명령은 프롬프트로 본다(복사본에서)
        let owned;
        let c: &TCache = if c.pending_cmd.is_some() {
            let mut x = c.clone();
            x.flush_cmd();
            owned = x;
            &owned
        } else {
            c
        };
        let (main_msgs, main_last, main_say) = {
            let m = scans.get(path, tz);
            (m.msgs.values().copied().collect::<Vec<Usage>>(), m.last_ts, m.say.clone())
        };
        let mut status: &'static str;
        let mut since;
        let mut confidence = "sure";
        let mut note: Option<Value> = None;
        let mut done_guess_end: Option<f64> = None;
        if c.prompt_ts.is_none() {
            status = "idle";
            since = first_ts;
        } else if let Last::Interrupt(t) = c.last {
            status = "done";
            since = t;
        } else if !c.pend.is_empty() {
            status = "working";
            since = c.work_since;
            if let Some((name, t)) = c.pend.values().find(|(n, _)| n == "AskUserQuestion" || n == "ExitPlanMode") {
                status = "needs_input";
                since = *t;
                note = Some(json!(if name == "AskUserQuestion" {
                    "질문에 답을 기다리는 중"
                } else {
                    "계획 승인을 기다리는 중"
                }));
            } else if let Some((name, t)) = c.pend.values().find(|(n, t)| needs_permission(n) && now - t >= INPUT_GUESS) {
                status = "needs_input";
                since = *t;
                confidence = "guess";
                note = Some(json!(format!("{name} 승인을 기다리는 중일 수 있어요")));
            }
        } else {
            match &c.last {
                Last::Assistant(t, stop) => {
                    if stop.as_deref().is_some_and(terminal) {
                        status = "done";
                        since = *t;
                    } else if now - t < DONE_GUESS {
                        status = "working";
                        since = c.work_since;
                    } else {
                        status = "done";
                        since = *t;
                        confidence = "guess";
                        if c.turn_open {
                            done_guess_end = Some(*t);
                        }
                    }
                }
                _ => {
                    status = "working";
                    since = c.work_since;
                }
            }
        }
        let started = match status {
            "working" | "needs_input" => Some(if c.turn_open { c.turn_start } else { since }),
            _ => None,
        };
        let mut run = c.run;
        if let Some(e) = done_guess_end {
            run = e - c.turn_start;
        }

        // 서브에이전트
        let sub_dir = {
            let s = path.to_string_lossy();
            PathBuf::from(&s[..s.len() - ".jsonl".len()]).join("subagents")
        };
        if !c.agents.is_empty() {
            load_meta(self.meta.entry(sub_dir.clone()).or_default(), &sub_dir);
        }
        let meta = self.meta.get(&sub_dir);
        let prompt_ts = c.prompt_ts.unwrap_or(0.0);
        let mut agents: Vec<Agent> = vec![];
        let mut sub_msgs: Vec<Usage> = vec![];
        for (key, ta) in &c.agents {
            let Some(aid) = ta.aid.clone().or_else(|| meta.and_then(|m| m.by_tool.get(key).cloned())) else {
                continue;
            };
            let j = meta.and_then(|m| m.by_aid.get(&aid)).cloned().unwrap_or(json!({}));
            let ap = sub_dir.join(format!("agent-{aid}.jsonl"));
            let exists = ap.exists();
            let sc: ScanCache = if exists { scans.get(&ap, tz).clone() } else { ScanCache::default() };
            let mut done = get(&j, "finished").is_some_and(truthy)
                || c.notified.contains_key(&aid)
                || ta.done_ts.is_some()
                || sc.handback.is_some()
                || (exists && sc.pending.is_empty() && sc.stop.as_ref().is_some_and(|s| s.1 == "end_turn") && now - sc.last_ts > 30.0);
            let last = if exists && sc.first_ts.is_some() { sc.last_ts } else { ta.ts };
            // Stop이 누락된 채 STALE보다 오래 조용한 에이전트는 끝난 것으로 본다 (server.py expire_agents와 같은 규칙)
            let stale = !done && super::agent_stale(last, now);
            done |= stale;
            let ended = if done {
                Some(if exists && sc.first_ts.is_some() {
                    sc.last_ts
                } else {
                    c.notified.get(&aid).copied().or(ta.done_ts).unwrap_or(ta.ts)
                })
            } else {
                None
            };
            // 토큰은 목록에서 빼기 전에 센다(오늘 합계는 지난 턴 에이전트도 포함)
            sub_msgs.extend(sc.msgs.values().copied());
            // 이번 프롬프트 전에 이미 끝난 에이전트는 목록에서 정리 (훅의 "새 프롬프트 때 끝난 에이전트 정리"와 같은 효과).
            // 이전 턴에 시작해 이번 턴 도중에 끝난 에이전트는 남긴다.
            // stale(Stop 누락 정리)는 훅 경로처럼 done+stale로 남긴다(목록에서 지우지 않음)
            if drop_before_prompt(ended, stale, prompt_ts) {
                continue;
            }
            let atype = get(&j, "agentType")
                .filter(|v| truthy(v))
                .map(py_str)
                .or_else(|| ta.atype.clone())
                .unwrap_or_else(|| "agent".into());
            let desc = get(&j, "description")
                .filter(|v| truthy(v))
                .map(|v| short(&redact(&py_str(v)), 50))
                .unwrap_or_else(|| ta.desc.clone());
            agents.push(Agent {
                aid,
                atype,
                desc: json!(desc),
                bg: json!(ta.bg),
                status: if done { "done" } else { "running" },
                since: sc.first_ts.unwrap_or(ta.ts),
                ended,
                stale: stale.then_some(true),
                tools: sc.tools,
                now: sc.recent.last().cloned(),
                recent: sc.recent.clone(),
                last,
                tokens: Some(tok_sum(sc.msgs.values(), 0.0).total),
                say: Some(sc.say.clone()),
                health: if !done && exists {
                    Some(health(sc.pending.values().map(|(n, t)| (n.as_str(), *t)), sc.last_ts, last, now))
                } else {
                    None
                },
            });
        }
        agents.sort_by(|a, b| a.since.partial_cmp(&b.since).unwrap_or(std::cmp::Ordering::Equal));
        if matches!(status, "done" | "idle") && agents.iter().any(|a| a.status == "running") {
            status = "agents";
        }

        let mut s = new_session(sid.to_string(), since);
        s.status = status;
        s.since = since;
        s.started = started;
        s.prompt = json!(c.prompt);
        s.note = note;
        s.tools = c.tools;
        let mut all = main_msgs;
        all.extend(sub_msgs);
        s.tokens = Some(tok_sum(all.iter(), prompt_ts));
        s.todos = c.todos.clone();
        s.agents = agents;
        s.activity = c.activity.clone();
        if status == "working" {
            s.health = Some(health(c.pend.values().map(|(n, t)| (n.as_str(), *t)), main_last, c.last_ts, now));
            s.say = Some(main_say);
        }
        s.source = Some("transcript");
        s.confidence = Some(confidence);
        s.kinds = c.kinds.clone();
        s.kind = c.kind.clone().map(Value::String);
        s.trail = c.trail.clone();
        s.run = run;
        s.last = c.last_ts;
        s.prompt_ts = c.prompt_ts;
        s.cwd = c.cwd.clone();
        s.project = project_name(&c.cwd);

        let mut today = Today::default();
        if c.last_ts >= day_start {
            today.tokens = tok_sum(all.iter().filter(|m| m.ts >= day_start), 0.0);
        }
        let ends = c
            .finished
            .iter()
            .map(|(s, e, _)| (*s, *e))
            .chain(done_guess_end.map(|e| (c.turn_start, e)));
        for (st, en) in ends {
            if tz.local_date(en) == tz.local_date(now) {
                today.waited += en - st;
                today.done += 1;
            }
        }
        for (t, k) in &c.tool_log {
            if *t >= day_start {
                *today.kinds.entry(k.to_string()).or_insert(0) += 1;
            }
        }
        today.agents = c.agent_starts.iter().filter(|t| **t >= day_start).count() as i64;
        Some(TResult {
            session: s,
            today,
            last_ts: c.last_ts,
            turns: c.finished.iter().filter(|x| x.1 >= now - 2.0 * 86400.0).cloned().collect(),
            waits: c.waits.iter().filter(|x| x.1 >= now - 2.0 * 86400.0).copied().collect(),
        })
    }

    /// 더 이상 발견되지 않는 파일 캐시 정리
    pub fn retain(&mut self, keep: &std::collections::HashSet<PathBuf>) {
        self.files.retain(|p, _| keep.contains(p));
    }
}

/// 이번 프롬프트 전에 끝난 에이전트를 목록에서 뺄지. stale 정리분은 훅 경로와 같게 남긴다.
fn drop_before_prompt(ended: Option<f64>, stale: bool, prompt_ts: f64) -> bool {
    !stale && ended.is_some_and(|e| e < prompt_ts)
}

#[cfg(test)]
mod hide_tests {
    use super::*;

    #[test]
    fn hidden_project_dirs_are_not_scanned() {
        let root = std::env::temp_dir().join(format!("wr-hide-{}", std::process::id()));
        let obs = root.join("-Users-alex--claude-mem-observer-sessions");
        let ok = root.join("-Users-alex-app");
        std::fs::create_dir_all(&obs).unwrap();
        std::fs::create_dir_all(&ok).unwrap();
        for i in 0..5 {
            std::fs::write(obs.join(format!("o{i}.jsonl")), "{}\n").unwrap();
        }
        std::fs::write(ok.join("a.jsonl"), "{}\n").unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let hide = HideRules::new(&[], true);
        let found = discover(&root, now, now, &hide);
        assert_eq!(found.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(), vec!["a"]);
        assert_eq!(discover(&root, now, now, &HideRules::default()).len(), 6);
        // Discovery 캐시 경로도 같은 규칙
        let mut d = Discovery::default();
        assert_eq!(d.find(&root, now, now, &hide).len(), 1);
        assert_eq!(d.find(&root, now, now, &hide).len(), 1);
        d.reset();
        assert_eq!(d.find(&root, now, now, &HideRules::default()).len(), 6);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn stale_agent_kept_like_hook_path() {
        // stale의 ended(마지막 활동)는 prompt_ts보다 앞서도 목록에 남아야 한다(훅 경로와 같은 결과)
        assert!(!drop_before_prompt(Some(10.0), true, 100.0));
        assert!(drop_before_prompt(Some(10.0), false, 100.0), "일반 종료분은 기존대로 정리");
        assert!(!drop_before_prompt(None, false, 100.0));
    }
}

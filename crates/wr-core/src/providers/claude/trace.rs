//! Claude 트랜스크립트 → 흐름 모드 단계 (server.py `tr_scan()`, `_tool_step()`, `_agent_meta()`, `build_trace()` 이식).
//! 단계 보정·600단계 제한·커서는 공통 `crate::trace`.

use super::scan::{blocks, key_of, parse_line};
use crate::clock::Tz;
use crate::jsonl::{has_type_marker, read_lines, size};
use crate::provider::TraceReply;
use crate::py::{get, num, project_name, py_int, py_str, py_str_or_empty, strip, take, truthy};
use crate::text::{clip, TEXT_MAX};
use crate::trace::{cut_older, phases, since_v, Step, Ver};
use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 캐시하는 트랜스크립트 수 상한 (오래 안 본 것부터 버림)
pub const TRACE_FILES: usize = 48;

struct Res {
    sid: Regex,
    aid: Regex,
    file: Regex,
    writes: Regex,
    agent_id: Regex,
    summary: Regex,
    task_id: Regex,
    cmd_name: Regex,
    cmd_args: Regex,
}

fn res() -> &'static Res {
    static R: OnceLock<Res> = OnceLock::new();
    R.get_or_init(|| Res {
        sid: Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$").unwrap(),
        aid: Regex::new(r"^[A-Za-z0-9_-]{1,64}$").unwrap(),
        file: Regex::new(
            r"[\w./~$-]*\w\.(?:py|html?|js|mjs|cjs|ts|tsx|jsx|css|scss|md|json|jsonl|png|jpe?g|svg|sh|ya?ml|toml|txt|swift|go|rs|java|kt|sql|rb|php|c|h|cpp|vue|svelte)\b",
        )
        .unwrap(),
        writes: Regex::new(r#"sed -i|\.write(_text)?\(|open\([^)]*['"][wa]|>>?\s*[\w./~-]+\.\w+|\btee\b|\b(cp|mv|rm|mkdir|touch)\s"#).unwrap(),
        agent_id: Regex::new(r"agentId: ([A-Za-z0-9_-]+)").unwrap(),
        summary: Regex::new(r"(?s)<summary>(.*?)</summary>").unwrap(),
        task_id: Regex::new(r"<task-id>([\w-]+)</task-id>").unwrap(),
        cmd_name: Regex::new(r"<command-name>(.*?)</command-name>").unwrap(),
        cmd_args: Regex::new(r"(?s)<command-args>(.*?)</command-args>").unwrap(),
    })
}

/// 세션 id 형식 검사 (경로 탈출 방지)
pub fn sid_ok(sid: &str) -> bool {
    res().sid.is_match(sid)
}

#[derive(Debug, Clone)]
pub struct Prompt {
    pub t: f64,
    pub at: usize,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct TrCache {
    pub off: u64,
    pub steps: Vec<Step>,
    pub pend: IndexMap<String, usize>,
    pub prompts: Vec<Prompt>,
    pub stop: Option<(f64, String)>,
    pub last: f64,
    pub cwd: String,
    pub task: String,
    pub handback: Option<f64>,
    pub used: f64,
}

#[derive(Debug, Default)]
pub struct Meta {
    pub seen: HashSet<String>,
    pub by_tool: HashMap<String, String>,
    pub by_aid: HashMap<String, Value>,
}

/// `_agent_meta(sub_dir)`: subagents/*.meta.json → toolUseId·aid별 메타 (새 파일만 읽고, 안 끝난 에이전트는 매번 다시 읽음)
pub fn load_meta(mm: &mut Meta, sub_dir: &Path) {
    let Ok(rd) = std::fs::read_dir(sub_dir) else { return };
    let mut names: Vec<String> = rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).collect();
    names.sort();
    for nm in names {
        if !(nm.starts_with("agent-") && nm.ends_with(".meta.json")) || nm.len() < 16 {
            continue;
        }
        let aid = nm[6..nm.len() - 10].to_string();
        if mm.seen.contains(&nm) && mm.by_aid.get(&aid).and_then(|j| get(j, "finished")).is_some_and(truthy) {
            continue;
        }
        let Ok(bytes) = std::fs::read(sub_dir.join(&nm)) else { continue };
        let Ok(j) = serde_json::from_slice::<Value>(&bytes) else { continue };
        if !j.is_object() {
            continue;
        }
        mm.seen.insert(nm.clone());
        if let Some(tu) = get(&j, "toolUseId").filter(|v| truthy(v)) {
            mm.by_tool.insert(key_of(Some(tu)), aid.clone());
        }
        mm.by_aid.insert(aid, j);
    }
}

/// trace 쪽 전역 상태 (server.py `_tr`, `_tr_meta`, `_tr_v`, `_tr_gen`)
#[derive(Debug)]
pub struct Tracer {
    pub files: IndexMap<PathBuf, TrCache>,
    meta: HashMap<PathBuf, Meta>,
    pub ver: Ver,
    pub gen: u64,
}

impl Default for Tracer {
    fn default() -> Self {
        Tracer {
            files: IndexMap::new(),
            meta: HashMap::new(),
            ver: Ver::default(),
            gen: 1,
        }
    }
}

/// `_text_of(content)`
pub fn text_of(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter(|b| get(b, "type").and_then(|t| t.as_str()) == Some("text"))
            .map(|b| get(b, "text").and_then(|t| t.as_str()).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

fn or_keys<'a>(inp: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().filter_map(|k| get(inp, k)).find(|v| truthy(v))
}

/// `_tool_step(name, inp, cwd)`
pub fn tool_step(st: &mut Step, name: &str, inp: &Value, cwd: &str, home: &str) {
    let empty = json!({});
    let inp = if inp.is_object() { inp } else { &empty };
    let s = |keys: &[&str]| py_str_or_empty(or_keys(inp, keys));
    st.tool = Some(clip(name, 40, "", home));
    let mut files = vec![];
    let mut writes = false;
    let mut act = "other";
    match name {
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let f = s(&["file_path", "notebook_path"]);
            st.target = Some(clip(&f, 100, cwd, home));
            if !f.is_empty() {
                files.push(clip(&f, 200, cwd, home));
            }
            writes = name != "Read";
            act = if writes { "edit" } else { "read" };
        }
        "Bash" => {
            let cmd = s(&["command"]);
            let tgt = s(&["description", "command"]);
            st.target = Some(clip(&tgt, 100, cwd, home));
            st.cmd = Some(clip(&cmd, 100, cwd, home));
            let set: std::collections::BTreeSet<String> = res()
                .file
                .find_iter(&cmd)
                .map(|m| m.as_str())
                .filter(|x| !x.contains("Chrome"))
                .map(|x| clip(x, 200, cwd, home))
                .collect();
            files = set.into_iter().take(6).collect();
            writes = res().writes.is_match(&cmd);
            act = if writes { "edit" } else { "run" };
        }
        "Grep" | "Glob" => {
            st.target = Some(clip(&s(&["pattern"]), 80, cwd, home));
            if let Some(p) = get(inp, "path").filter(|v| truthy(v)) {
                files.push(clip(&py_str(p), 100, cwd, home));
            }
            act = "search";
        }
        "Agent" | "Task" => {
            st.target = Some(clip(&s(&["description"]), 80, cwd, home));
            let at = or_keys(inp, &["subagent_type"])
                .map(py_str)
                .unwrap_or_else(|| "general-purpose".into());
            st.atype = Some(clip(&at, 40, "", home));
            act = "agent";
        }
        "WebFetch" | "WebSearch" => {
            st.target = Some(clip(&s(&["url", "query"]), 80, cwd, home));
            act = "web";
        }
        "Skill" => {
            st.target = Some(clip(&s(&["skill"]), 60, "", home));
        }
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => {
            st.target = Some("할 일 정리".into());
            act = "plan";
        }
        _ => {
            let t = or_keys(inp, &["description", "file_path"])
                .map(py_str)
                .unwrap_or_else(|| name.to_string());
            st.target = Some(clip(&t, 80, cwd, home));
        }
    }
    st.files = files;
    st.writes = writes;
    st.act = Some(act);
}

impl Tracer {
    /// `tr_scan(path, main)` — 새로 붙은 줄만 읽어 단계·요청 경계를 모은다
    pub fn scan(&mut self, path: &Path, main: bool, now: f64, tz: Tz, home: &str) -> bool {
        let Some(sz) = size(path) else {
            return self.files.contains_key(path);
        };
        let reset = match self.files.get(path) {
            None => true,
            Some(c) => sz < c.off,
        };
        if reset {
            if self.files.contains_key(path) {
                self.gen += 1;
            }
            self.files.insert(path.to_path_buf(), TrCache::default());
        }
        let ver = &mut self.ver;
        let c = self.files.get_mut(path).unwrap();
        c.used = now;
        if sz == c.off {
            return true;
        }
        let mut off = c.off;
        let r = res();
        let _ = read_lines(path, &mut off, |raw| {
            if !has_type_marker(raw) {
                return;
            }
            let Some((assistant, ts, d)) = parse_line(raw, tz) else { return };
            if c.cwd.is_empty() {
                if let Some(cw) = get(&d, "cwd").filter(|v| truthy(v)) {
                    c.cwd = py_str(cw);
                }
            }
            let cwd = c.cwd.clone();
            c.last = c.last.max(ts);
            let nullv = Value::Null;
            let m = get(&d, "message").filter(|m| m.is_object()).unwrap_or(&nullv);
            if assistant {
                if let Some(sr) = get(m, "stop_reason").filter(|v| truthy(v)) {
                    c.stop = Some((ts, py_str(sr)));
                }
                let mut think_ms = num(get(&d, "thinkingDurationMs")).unwrap_or(0.0);
                for blk in blocks(m) {
                    if !blk.is_object() {
                        continue;
                    }
                    match get(blk, "type").and_then(|t| t.as_str()) {
                        Some("thinking") => {
                            let raw_t = get(blk, "thinking").and_then(|t| t.as_str()).unwrap_or("");
                            let txt = strip(raw_t);
                            if !txt.is_empty() || think_ms >= 20000.0 {
                                let mut st = Step::new(c.steps.len(), ts, ver.bump(), "think");
                                st.text = Some(clip(txt, TEXT_MAX, &cwd, home));
                                st.dur_ms = Some(think_ms as i64);
                                c.steps.push(st);
                                think_ms = 0.0;
                            }
                        }
                        Some("text") => {
                            if let Some(t) = get(blk, "text").and_then(|t| t.as_str()).filter(|t| !strip(t).is_empty()) {
                                let mut st = Step::new(c.steps.len(), ts, ver.bump(), "say");
                                st.text = Some(clip(t, TEXT_MAX, &cwd, home));
                                c.steps.push(st);
                            }
                        }
                        Some("tool_use") => {
                            let name = get(blk, "name").and_then(|n| n.as_str()).unwrap_or("");
                            let mut st = Step::new(c.steps.len(), ts, ver.bump(), "tool");
                            tool_step(&mut st, name, get(blk, "input").unwrap_or(&nullv), &cwd, home);
                            let tu = key_of(get(blk, "id"));
                            st.tu = Some(tu.clone());
                            if st.tool.as_deref() == Some("SubagentHandback") {
                                c.handback = Some(ts);
                            }
                            c.pend.insert(tu, c.steps.len());
                            c.steps.push(st);
                        }
                        _ => {}
                    }
                }
                return;
            }
            // user
            if get(&d, "isMeta").is_some_and(truthy) || (get(&d, "isSidechain").is_some_and(truthy) && main) {
                return;
            }
            let bl = blocks(m);
            let mut any_result = false;
            for blk in bl {
                if get(blk, "type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                any_result = true;
                let Some(i) = c.pend.shift_remove(&key_of(get(blk, "tool_use_id"))) else {
                    continue;
                };
                let st = &mut c.steps[i];
                let ok = !get(blk, "is_error").is_some_and(truthy);
                st.ok = Some(ok);
                st.dur_ms = Some(((ts - st.t).max(0.0) * 1000.0) as i64);
                let resv = text_of(get(blk, "content"));
                if !ok {
                    st.err = Some(clip(&resv, 120, &cwd, home));
                }
                if st.act == Some("agent") && st.aid.as_deref().is_none_or(|a| a.is_empty()) {
                    if let Some(am) = r.agent_id.captures(&resv) {
                        st.aid = Some(am[1].to_string());
                    }
                }
                st.v = ver.bump();
            }
            if any_result {
                return;
            }
            let full = text_of(get(m, "content"));
            let text = strip(&full);
            if text.is_empty() {
                return;
            }
            if !main {
                if c.task.is_empty() {
                    c.task = clip(text, 120, &cwd, home);
                }
                return;
            }
            if text.starts_with("<task-notification>") {
                let sm = r.summary.captures(text).map(|m| m[1].to_string());
                let tm = r.task_id.captures(text).map(|m| m[1].to_string());
                let mut st = Step::new(c.steps.len(), ts, ver.bump(), "notify");
                st.text = Some(clip(sm.as_deref().unwrap_or("에이전트 소식"), 120, &cwd, home));
                st.aid = tm;
                c.steps.push(st);
            } else if text.starts_with("<command-name>") {
                let nm = r.cmd_name.captures(text).map(|m| m[1].to_string()).unwrap_or_else(|| "/?".into());
                let ar = r.cmd_args.captures(text).map(|m| m[1].to_string()).unwrap_or_default();
                c.prompts.push(Prompt {
                    t: ts,
                    at: c.steps.len(),
                    text: clip(&format!("{nm} {ar}"), TEXT_MAX, &cwd, home),
                });
            } else if !text.starts_with('<') {
                c.prompts.push(Prompt {
                    t: ts,
                    at: c.steps.len(),
                    text: clip(text, 400, &cwd, home),
                });
            }
        });
        c.off = off;
        true
    }

    fn agent_meta(&mut self, sub_dir: &Path) {
        load_meta(self.meta.entry(sub_dir.to_path_buf()).or_default(), sub_dir);
    }

    /// `trace_gc()`
    pub fn gc(&mut self) {
        if self.files.len() > TRACE_FILES {
            let mut order: Vec<(PathBuf, f64)> = self.files.iter().map(|(p, c)| (p.clone(), c.used)).collect();
            order.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            let n = self.files.len() - TRACE_FILES;
            for (p, _) in order.into_iter().take(n) {
                self.files.shift_remove(&p);
            }
        }
    }

    /// `build_trace(sid, which, since)` — transcript는 이미 찾은 경로(없으면 None)
    #[allow(clippy::too_many_arguments)]
    pub fn build(&mut self, sid: &str, path: Option<&Path>, which: &str, since: &str, now: f64, tz: Tz, home: &str) -> TraceReply {
        if sid.is_empty() || !sid_ok(sid) {
            return TraceReply {
                status: 400,
                body: json!({"error": "bad-session"}),
            };
        }
        let Some(path) = path.filter(|p| p.exists()) else {
            return TraceReply {
                status: 200,
                body: json!({"session": sid, "error": "no-transcript"}),
            };
        };
        self.scan(path, true, now, tz, home);
        // 캐시를 잠시 꺼내 쓰고 끝에 돌려놓는다(에이전트 파일 스캔이 self.files를 같이 쓰므로)
        let mut c = match self.files.get_mut(path) {
            Some(x) => std::mem::take(x),
            None => TrCache::default(),
        };
        let reply = self.build_with(&mut c, sid, path, which, since, now, tz, home);
        if let Some(x) = self.files.get_mut(path) {
            *x = c;
        }
        reply
    }

    #[allow(clippy::too_many_arguments)]
    fn build_with(
        &mut self,
        c: &mut TrCache,
        sid: &str,
        path: &Path,
        which: &str,
        since: &str,
        now: f64,
        tz: Tz,
        home: &str,
    ) -> TraceReply {
        let cwd = c.cwd.clone();
        let prompts = if c.prompts.is_empty() {
            vec![Prompt {
                t: c.steps.first().map(|s| s.t).unwrap_or(c.last),
                at: 0,
                text: String::new(),
            }]
        } else {
            c.prompts.clone()
        };
        let n = prompts.len();
        let pi = if which.is_empty() || which == "last" {
            n - 1
        } else {
            match py_int(which) {
                Some(x) => x.clamp(0, (n - 1) as i64) as usize,
                None => n - 1,
            }
        };
        let p = prompts[pi].clone();
        let hi = if pi + 1 < n { prompts[pi + 1].at } else { c.steps.len() };
        let lo = p.at.min(c.steps.len());
        let hi = hi.max(lo).min(c.steps.len());
        phases(&mut c.steps[lo..hi], &mut self.ver);
        let sub_dir = {
            let s = path.to_string_lossy();
            PathBuf::from(&s[..s.len() - ".jsonl".len()]).join("subagents")
        };
        let notified: HashMap<String, f64> = {
            let mut m = HashMap::new();
            for st in &c.steps[lo..hi] {
                if st.kind == "notify" {
                    if let Some(a) = st.aid.as_ref().filter(|a| !a.is_empty()) {
                        m.insert(a.clone(), st.t);
                    }
                }
            }
            m
        };
        let mut lanes: Vec<Value> = vec![];
        let mut agent_lanes: Vec<(String, Vec<Step>)> = vec![];
        let mut have_meta = false;
        for i in lo..hi {
            if c.steps[i].act != Some("agent") {
                continue;
            }
            if !have_meta {
                self.agent_meta(&sub_dir);
                have_meta = true;
            }
            let meta = self.meta.get(&sub_dir).unwrap();
            let st = &c.steps[i];
            let aid = st
                .aid
                .clone()
                .filter(|a| !a.is_empty())
                .or_else(|| st.tu.as_ref().and_then(|t| meta.by_tool.get(t).cloned()));
            if aid.is_some() && st.aid.as_deref().is_none_or(|a| a.is_empty()) {
                c.steps[i].aid = aid.clone();
            }
            let st = c.steps[i].clone();
            let Some(aid) = aid.filter(|a| res().aid.is_match(a)) else {
                continue;
            };
            let j = self
                .meta
                .get(&sub_dir)
                .and_then(|m| m.by_aid.get(&aid))
                .cloned()
                .unwrap_or(json!({}));
            let ap = sub_dir.join(format!("agent-{aid}.jsonl"));
            let have = ap.exists() && self.scan(&ap, false, now, tz, home);
            let ac = if have { self.files.get_mut(&ap) } else { None };
            let (ast, alast, ahand, apend_empty, astop, atask) = match ac {
                Some(ac) => {
                    phases(&mut ac.steps, &mut self.ver);
                    (
                        ac.steps.clone(),
                        Some(ac.last),
                        ac.handback,
                        ac.pend.is_empty(),
                        ac.stop.clone(),
                        ac.task.clone(),
                    )
                }
                None => (vec![], None, None, true, None, String::new()),
            };
            let mut t_end = st.t;
            if let Some(x) = ast.last() {
                t_end = t_end.max(x.t);
            }
            if let Some(l) = alast {
                t_end = t_end.max(l);
            }
            let done = get(&j, "finished").is_some_and(truthy)
                || notified.contains_key(&aid)
                || (have && ahand.is_some())
                || (have && apend_empty && astop.as_ref().is_some_and(|s| s.1 == "end_turn") && now - alast.unwrap_or(0.0) > 30.0);
            let desc_src = get(&j, "description")
                .filter(|v| truthy(v))
                .map(py_str)
                .or_else(|| st.target.clone().filter(|t| !t.is_empty()))
                .unwrap_or(atask);
            let typ = get(&j, "agentType")
                .filter(|v| truthy(v))
                .map(py_str)
                .or_else(|| st.atype.clone().filter(|t| !t.is_empty()))
                .unwrap_or_else(|| "agent".into());
            let t_join = notified.get(&aid).copied().or(if have { ahand } else { None });
            lanes.push(json!({
                "id": aid, "desc": clip(&desc_src, 80, &cwd, home), "type": clip(&typ, 40, "", home),
                "from": st.s, "t_start": st.t, "t_end": t_end, "t_join": t_join,
                "status": if done { "done" } else if have { "running" } else { "unknown" },
                "fail": ast.iter().filter(|x| x.ok == Some(false)).count(),
            }));
            agent_lanes.push((aid, ast));
        }
        let main = &c.steps[lo..hi];
        let last_prompt = pi == n - 1;
        let stop = c.stop.clone();
        let running_agents = lanes.iter().any(|l| l["status"] == "running");
        let mstat = if !last_prompt {
            "done"
        } else if !c.pend.is_empty()
            || stop.as_ref().is_none_or(|s| s.1 != "end_turn")
            || (!main.is_empty() && stop.as_ref().unwrap().0 < main[main.len() - 1].t)
        {
            "running"
        } else if running_agents {
            "waiting"
        } else {
            "done"
        };
        let mut t_end = p.t;
        if let Some(x) = main.last() {
            t_end = t_end.max(x.t);
        }
        if let Some(s) = &stop {
            if s.0 >= p.t && (last_prompt || s.0 < prompts[pi + 1].t) {
                t_end = t_end.max(s.0);
            }
        }
        lanes.insert(
            0,
            json!({"id": "main", "desc": "메인 Claude", "type": "main", "t_start": p.t, "t_end": t_end, "status": mstat,
                   "fail": main.iter().filter(|x| x.ok == Some(false)).count()}),
        );
        let mut allst: Vec<(f64, &str, &Step)> = main.iter().map(|x| (x.t, "main", x)).collect();
        for (aid, ss) in &agent_lanes {
            allst.extend(ss.iter().map(|x| (x.t, aid.as_str(), x)));
        }
        allst.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let (kept, older) = cut_older(allst);
        let key = format!("{}.{}", self.gen, pi);
        let sv = since_v(since, &key);
        let out_steps: Vec<Value> = kept
            .iter()
            .filter(|(_, _, x)| x.v as i128 > sv as i128)
            .map(|(_, lane, x)| x.publish(lane))
            .collect();
        let total = main.len() + agent_lanes.iter().map(|(_, s)| s.len()).sum::<usize>();
        let plist: Vec<Value> = prompts
            .iter()
            .enumerate()
            .map(|(i, q)| json!({"i": i, "t": q.t, "text": take(&q.text, 80)}))
            .collect();
        let pfrom = plist.len().saturating_sub(30);
        TraceReply {
            status: 200,
            body: json!({
                "session": sid, "project": project_name(&cwd), "now": now,
                "prompts": plist[pfrom..].to_vec(),
                "prompt": {"i": pi, "t": p.t, "text": p.text, "last": last_prompt, "t_next": if pi + 1 < n { json!(prompts[pi + 1].t) } else { Value::Null }},
                "cursor": format!("{}.{}", key, self.ver.0), "full": sv == 0, "lanes": lanes, "steps": out_steps, "older": older,
                "total": total,
            }),
        }
    }
}

//! 흐름 모드(/trace) 공통 부분: 단계 모델, 단계(phase) 판정·다수결 보정, 발화 성격(claim),
//! 600단계 제한과 older 요약, 증분 커서 버전. server.py `tr_phases()`, `_phase()`, `_pub()`, `build_trace()` 뒷부분 이식.
//! 프로바이더는 자기 트랜스크립트를 `Step`으로 정규화해서 넘긴다.

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// 응답 하나에 담는 단계 수 상한
pub const TRACE_MAX: usize = 600;

/// 단계가 생기거나 바뀔 때마다 오르는 번호 (증분 커서)
#[derive(Debug, Default, Clone)]
pub struct Ver(pub u64);

impl Ver {
    pub fn bump(&mut self) -> u64 {
        self.0 += 1;
        self.0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub s: usize,
    pub t: f64,
    pub v: u64,
    /// "tool" | "say" | "think" | "notify"
    pub kind: &'static str,
    pub text: Option<String>,
    pub dur_ms: Option<i64>,
    pub tool: Option<String>,
    pub target: Option<String>,
    pub cmd: Option<String>,
    pub files: Vec<String>,
    pub writes: bool,
    /// read|edit|run|search|agent|web|plan|other
    pub act: Option<&'static str>,
    /// None = 아직 결과 없음
    pub ok: Option<bool>,
    /// 도구 호출 id (내부용, 내보내지 않음)
    pub tu: Option<String>,
    pub err: Option<String>,
    pub aid: Option<String>,
    pub atype: Option<String>,
    pub phase: Option<&'static str>,
    pub claim: Option<&'static str>,
}

impl Step {
    pub fn new(s: usize, t: f64, v: u64, kind: &'static str) -> Step {
        Step {
            s,
            t,
            v,
            kind,
            text: None,
            dur_ms: None,
            tool: None,
            target: None,
            cmd: None,
            files: vec![],
            writes: false,
            act: None,
            ok: None,
            tu: None,
            err: None,
            aid: None,
            atype: None,
            phase: None,
            claim: None,
        }
    }

    /// `_pub(st, lane)`: 내부 필드(v, tu)와 빈 값(None·""·[]·false, 단 ok=false는 보냄)을 뺀다
    pub fn publish(&self, lane: &str) -> Value {
        let mut o = Map::new();
        o.insert("s".into(), json!(self.s));
        o.insert("t".into(), json!(self.t));
        o.insert("kind".into(), json!(self.kind));
        let mut put = |k: &str, v: &Option<String>| {
            if let Some(x) = v.as_deref().filter(|x| !x.is_empty()) {
                o.insert(k.into(), json!(x));
            }
        };
        put("text", &self.text);
        put("tool", &self.tool);
        put("target", &self.target);
        put("cmd", &self.cmd);
        put("err", &self.err);
        put("aid", &self.aid);
        put("atype", &self.atype);
        if let Some(d) = self.dur_ms {
            o.insert("dur_ms".into(), json!(d));
        }
        if !self.files.is_empty() {
            o.insert("files".into(), json!(self.files));
        }
        if self.writes {
            o.insert("writes".into(), json!(true));
        }
        if let Some(a) = self.act {
            o.insert("act".into(), json!(a));
        }
        if let Some(ok) = self.ok {
            o.insert("ok".into(), json!(ok));
        }
        if let Some(p) = self.phase {
            o.insert("phase".into(), json!(p));
        }
        if let Some(c) = self.claim {
            o.insert("claim".into(), json!(c));
        }
        o.insert("lane".into(), json!(lane));
        Value::Object(o)
    }
}

struct Res {
    verify: Regex,
    plan: Regex,
    done: Regex,
    img: Regex,
    claims: Vec<(&'static str, Regex)>,
}

fn res() -> &'static Res {
    static R: OnceLock<Res> = OnceLock::new();
    R.get_or_init(|| Res {
        verify: Regex::new(r"(?i)screenshot|verify|test|confirm|check|measure|captur|lint|확인|검증|테스트|스크린샷|점검").unwrap(),
        plan: Regex::new(r"(?i)\bplan\b|계획|방식|맡길|나눠|I'll|I will|할게요|하겠습니다|\bnext\b|now i|let me|first,|순서").unwrap(),
        done: Regex::new(r"(?i)완성|만들었|완료|done|finished|works|all set|됐어요|되었습니다").unwrap(),
        img: Regex::new(r"\.(png|jpe?g)$").unwrap(),
        claims: vec![
            (
                "conclusion",
                Regex::new(r"(?i)원인|because|correctly|works|정상|완성|만들었|완료|확인했|됐어요|turns out|found").unwrap(),
            ),
            (
                "hypothesis",
                Regex::new(r"(?i)것 같|아마|probably|likely|might|seems|suspect|의심|일 수|maybe").unwrap(),
            ),
            (
                "decision",
                Regex::new(r"(?i)그래서|so i|i'll|i will|할게요|plan|방식|대신|instead|now i|next|하겠습니다").unwrap(),
            ),
            (
                "check",
                Regex::new(r"(?i)확인|check|verify|confirm|살펴|let me|look at|볼게").unwrap(),
            ),
        ],
    })
}

/// 보고로 보는 도구 이름 (프로바이더 공통 이름으로 정규화돼 있다고 본다)
pub const REPORT_TOOLS: [&str; 3] = ["SubagentHandback", "SendUserFile", "SendMessage"];

fn raw_phase(st: &Step, seen_edit: bool) -> Option<&'static str> {
    let r = res();
    match st.kind {
        "say" => {
            let t = st.text.as_deref().unwrap_or("");
            if r.plan.is_match(t) && !r.done.is_match(t) {
                Some("plan")
            } else {
                None
            }
        }
        "tool" => {
            let n = st.tool.as_deref().unwrap_or("");
            let tg = st.target.as_deref().unwrap_or("");
            match st.act {
                Some("edit") => return Some("edit"),
                Some("agent") => return Some("delegate"),
                Some("plan") => return Some("plan"),
                _ => {}
            }
            if REPORT_TOOLS.contains(&n) {
                return Some("report");
            }
            if (n == "Read" && r.img.is_match(tg)) || r.verify.is_match(tg) {
                return Some("verify");
            }
            Some(if seen_edit { "explore" } else { "understand" })
        }
        _ => None,
    }
}

/// 근거가 확실한 단계는 보정하지 않음
const FIXED: [&str; 4] = ["edit", "delegate", "plan", "report"];

/// 단계 판정 + 앞뒤 5단계(±2) 다수결 보정 + 한 단계짜리 튐 제거. 바뀐 단계는 버전을 올린다.
pub fn phases(steps: &mut [Step], ver: &mut Ver) {
    let mut seen = false;
    let mut raw = Vec::with_capacity(steps.len());
    for st in steps.iter() {
        let p = raw_phase(st, seen);
        seen = seen || p == Some("edit");
        raw.push(p);
    }
    let tools: Vec<usize> = (0..steps.len()).filter(|&i| steps[i].kind == "tool").collect();
    let tp: Vec<Option<&'static str>> = tools.iter().map(|&i| raw[i]).collect();
    let mut sm = tp.clone();
    for j in 0..tp.len() {
        if tp[j].is_some_and(|p| FIXED.contains(&p)) {
            continue;
        }
        // 삽입 순서를 지키는 카운터 (동점이면 먼저 나온 값)
        let mut cnt: Vec<(Option<&'static str>, f64)> = Vec::new();
        let lo = j.saturating_sub(2);
        let hi = (j + 3).min(tp.len());
        for (k, &p) in tp.iter().enumerate().take(hi).skip(lo) {
            if matches!(p, Some("plan") | Some("report") | Some("delegate")) {
                continue;
            }
            let w = 1.0 + if k == j { 0.5 } else { 0.0 };
            match cnt.iter_mut().find(|(q, _)| *q == p) {
                Some(e) => e.1 += w,
                None => cnt.push((p, w)),
            }
        }
        if !cnt.is_empty() {
            let mut best = cnt[0];
            for &c in &cnt[1..] {
                if c.1 > best.1 {
                    best = c;
                }
            }
            sm[j] = best.0;
        }
    }
    let fixed = |p: Option<&str>| p.is_some_and(|x| FIXED.contains(&x));
    for j in 1..sm.len().saturating_sub(1) {
        if sm[j] != sm[j - 1] && sm[j] != sm[j + 1] && !fixed(sm[j]) && !fixed(sm[j - 1]) {
            sm[j] = sm[j - 1];
        }
    }
    let mut fin = raw.clone();
    for (j, &i) in tools.iter().enumerate() {
        fin[i] = sm[j];
    }
    let r = res();
    let mut prev = "understand";
    for (i, st) in steps.iter_mut().enumerate() {
        let p = fin[i].unwrap_or(prev);
        if matches!(st.kind, "say" | "think") {
            if let Some(t) = st.text.as_deref().filter(|t| !t.is_empty()) {
                st.claim = Some(r.claims.iter().find(|(_, re)| re.is_match(t)).map(|(k, _)| *k).unwrap_or("note"));
            }
        }
        if st.phase != Some(p) {
            st.phase = Some(p);
            st.v = ver.bump();
        }
        if st.kind == "tool" || fin[i].is_some() {
            prev = p;
        }
    }
}

/// 파이썬 `float // 60` (정확히 같은 반올림)
pub fn py_floordiv(vx: f64, wx: f64) -> f64 {
    let m = vx % wx;
    let mut div = (vx - m) / wx;
    if m != 0.0 && ((wx < 0.0) != (m < 0.0)) {
        div -= 1.0;
    }
    let mut fd = div.floor();
    if div - fd > 0.5 {
        fd += 1.0;
    }
    fd
}

/// 시간순 정렬(안정)된 (t, lane, step) 목록에서 최근 TRACE_MAX개만 남기고 그 앞은 레인·분 단위로 요약
pub fn cut_older<'a>(mut allst: Vec<(f64, &'a str, &'a Step)>) -> (Vec<(f64, &'a str, &'a Step)>, Value) {
    if allst.len() <= TRACE_MAX {
        return (allst, Value::Null);
    }
    let cut = allst[allst.len() - TRACE_MAX].0;
    struct Bin {
        lane: String,
        t: i64,
        n: i64,
        fail: i64,
        ph: Vec<(Option<&'static str>, i64)>,
    }
    let mut bins: IndexMap<(String, i64), Bin> = IndexMap::new();
    let split = allst.len() - TRACE_MAX;
    for (t, lane, x) in &allst[..split] {
        let m = py_floordiv(*t, 60.0) as i64 * 60;
        let b = bins.entry((lane.to_string(), m)).or_insert_with(|| Bin {
            lane: lane.to_string(),
            t: m,
            n: 0,
            fail: 0,
            ph: vec![],
        });
        b.n += 1;
        b.fail += (x.ok == Some(false)) as i64;
        if x.kind == "tool" {
            match b.ph.iter_mut().find(|(p, _)| *p == x.phase) {
                Some(e) => e.1 += 1,
                None => b.ph.push((x.phase, 1)),
            }
        }
    }
    let kept = allst.split_off(split);
    let vals: Vec<&Bin> = bins.values().collect();
    let from = vals.len().saturating_sub(600);
    let out: Vec<Value> = vals[from..]
        .iter()
        .map(|b| {
            let phase = if b.ph.is_empty() {
                Some("understand")
            } else {
                let mut best = b.ph[0];
                for &c in &b.ph[1..] {
                    if c.1 > best.1 {
                        best = c;
                    }
                }
                best.0
            };
            json!({"lane": b.lane, "t": b.t, "n": b.n, "fail": b.fail, "phase": phase})
        })
        .collect();
    (kept, json!({"cut": cut, "bins": out}))
}

/// 커서 "<gen>.<prompt>.<v>"의 since를 해석: key가 같으면 v, 아니면 0
pub fn since_v(since: &str, key: &str) -> i64 {
    if since.is_empty() {
        return 0;
    }
    match since.rsplit_once('.') {
        Some((head, tail)) if head == key => crate::py::py_int(tail).unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(s: usize, name: &str, act: &'static str, target: &str) -> Step {
        let mut st = Step::new(s, s as f64, 0, "tool");
        st.tool = Some(name.into());
        st.act = Some(act);
        st.target = Some(target.into());
        st
    }

    #[test]
    fn smoothing_and_versions() {
        let mut v = Ver::default();
        let mut steps = vec![
            tool(0, "Read", "read", "a.py"),
            tool(1, "Read", "read", "b.py"),
            tool(2, "Bash", "run", "run tests"),
            tool(3, "Read", "read", "c.py"),
            tool(4, "Edit", "edit", "c.py"),
            tool(5, "Read", "read", "d.py"),
        ];
        phases(&mut steps, &mut v);
        let p: Vec<_> = steps.iter().map(|s| s.phase.unwrap()).collect();
        assert_eq!(p, ["understand", "understand", "understand", "understand", "edit", "explore"]);
        let before = v.0;
        phases(&mut steps, &mut v);
        assert_eq!(v.0, before, "같은 입력이면 버전이 오르지 않음");
    }

    #[test]
    fn floordiv_and_since() {
        assert_eq!(py_floordiv(125.0, 60.0), 2.0);
        assert_eq!(py_floordiv(-1.0, 60.0), -1.0);
        assert_eq!(since_v("1.0.25", "1.0"), 25);
        assert_eq!(since_v("2.0.25", "1.0"), 0);
        assert_eq!(since_v("1.0.x", "1.0"), 0);
    }
}

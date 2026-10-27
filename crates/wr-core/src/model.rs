//! 공통 데이터 모델 = types/state.d.ts 계약. 모든 프로바이더는 여기로 정규화한다.
//!
//! "키 없음"과 "null"을 구분해야 하는 필드는 `Option<Option<T>>`(바깥 None = 키 없음)로 둔다.
//! 훅·트랜스크립트에서 온 자유 텍스트는 원래 값 그대로(`Value`) 들고 있다가 `mask()`로 마스킹한다.

use crate::redact::redact;
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Health {
    /// "slow" | "stall"
    pub level: &'static str,
    pub tool: Option<String>,
    pub secs: f64,
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Tokens {
    pub new: i64,
    pub cached: i64,
    pub out: i64,
    pub total: i64,
}

impl Tokens {
    pub fn add(&mut self, o: &Tokens) {
        self.new += o.new;
        self.cached += o.cached;
        self.out += o.out;
        self.total += o.total;
    }
}

/// 메시지 하나의 usage (시각, new, cached, out)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Usage {
    pub ts: f64,
    pub new: i64,
    pub cached: i64,
    pub out: i64,
}

/// `tok_sum(msgs, since)`
pub fn tok_sum<'a>(msgs: impl IntoIterator<Item = &'a Usage>, since: f64) -> Tokens {
    let mut t = Tokens::default();
    for m in msgs {
        if m.ts >= since {
            t.new += m.new;
            t.cached += m.cached;
            t.out += m.out;
        }
    }
    t.total = t.new + t.out;
    t
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Activity {
    pub ts: f64,
    pub icon: Value,
    pub text: Value,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AgentTool {
    pub icon: Value,
    pub text: Value,
    pub kind: Value,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Agent {
    pub aid: String,
    #[serde(rename = "type")]
    pub atype: String,
    pub desc: Value,
    pub bg: Value,
    pub status: &'static str,
    pub since: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
    pub tools: i64,
    pub now: Option<AgentTool>,
    pub recent: Vec<AgentTool>,
    pub last: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub say: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<Option<Health>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub sid: String,
    pub project: String,
    pub status: &'static str,
    pub since: f64,
    pub started: Option<f64>,
    pub prompt: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<Value>,
    pub tools: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Tokens>,
    pub ctx: Value,
    pub todos: Vec<Value>,
    pub agents: Vec<Agent>,
    pub activity: Vec<Activity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<Option<Health>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub say: Option<String>,
    /// @since 1.1 "hook" | "transcript"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
    /// @since 1.1 "sure" | "guess"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<&'static str>,
    /// @since 1.1 프로바이더 id (예: "claude")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<&'static str>,
    /// @since 1.2 @unstable AI가 MCP 도구로 직접 보고한 내용 (`report::Fold::value`, types/state.d.ts `Report`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<Value>,
    pub kinds: IndexMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<Value>,
    pub trail: Vec<[Value; 3]>,
    pub run: f64,
    pub last: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_ts: Option<f64>,
    pub cwd: String,
    /// @since 1.3 @unstable 세션으로 바로 이동할 정보. cmux `{"mux": {"kind", "workspace", "surface"?}}` · Orca(1.4) `{"mux": {"kind": "orca", "surface", "path"?}}` (`term::jump_of`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<Value>,
}

/// 문자열이고 비어 있지 않으면 마스킹 (`_mask`)
pub fn mask(v: &Value) -> Value {
    match v {
        Value::String(s) if !s.is_empty() => Value::String(redact(s)),
        other => other.clone(),
    }
}

fn mask_in(v: &mut Value) {
    *v = mask(v);
}

impl Session {
    /// server.py `mask_state()` — 자유 텍스트를 값만 바꿔 마스킹
    pub fn mask(&mut self) {
        mask_in(&mut self.prompt);
        if let Some(n) = self.note.as_mut() {
            mask_in(n);
        }
        if let Some(s) = self.say.as_mut() {
            *s = redact(s);
        }
        for a in &mut self.activity {
            mask_in(&mut a.text);
        }
        for t in &mut self.trail {
            mask_in(&mut t[2]);
        }
        for t in &mut self.todos {
            if let Value::Object(o) = t {
                let v = mask(o.get("text").unwrap_or(&Value::Null));
                o.insert("text".into(), v);
            }
        }
        for a in &mut self.agents {
            mask_in(&mut a.desc);
            if let Some(s) = a.say.as_mut() {
                *s = redact(s);
            }
            if let Some(n) = a.now.as_mut() {
                mask_in(&mut n.text);
            }
            for x in &mut a.recent {
                mask_in(&mut x.text);
            }
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Poll {
    pub on: bool,
    pub err: Option<String>,
}

/// types/state.d.ts `State.mcp` (@since 1.2): MCP 보고 연결 상태
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct McpInfo {
    /// 마지막 보고(status·board) 이후 초. 보고가 없으면 None
    pub last_report_age: Option<f64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HooksInfo {
    pub installed: bool,
    pub last_event_age: Option<f64>,
}

/// types/state.d.ts `Provider` (@since 1.1). capabilities는 `{기능: true}` 객체로 나간다(없는 키 = false)
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProviderInfo {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<&'static str>,
    #[serde(serialize_with = "caps_as_object")]
    pub capabilities: Vec<&'static str>,
}

fn caps_as_object<S: serde::Serializer>(caps: &[&'static str], s: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut m = s.serialize_map(Some(caps.len()))?;
    for c in caps {
        m.serialize_entry(c, &true)?;
    }
    m.end()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct State {
    pub now: f64,
    pub sessions: Vec<Session>,
    pub waited_today: f64,
    pub done_today: i64,
    pub today_kinds: IndexMap<String, i64>,
    pub today_agents: i64,
    pub today_tokens: Tokens,
    pub limits: Value,
    pub limits_ts: Value,
    pub limits_src: &'static str,
    pub poll: Poll,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hooks: Option<HooksInfo>,
    /// @since 1.1 연결된 프로바이더 목록
    #[serde(skip_serializing_if = "Option::is_none")]
    pub providers: Option<Vec<ProviderInfo>>,
    /// @since 1.2 MCP 보고 연결 상태 (보고 읽기가 켜져 있을 때만)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp: Option<McpInfo>,
}

impl State {
    /// `now`를 뺀 직렬화 해시 — push 방식에서 "바뀌었을 때만 보내기"에 쓴다.
    pub fn digest(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut v = serde_json::to_value(self).unwrap_or(Value::Null);
        if let Value::Object(o) = &mut v {
            o.remove("now");
            for (k, age) in [("hooks", "last_event_age"), ("mcp", "last_report_age")] {
                if let Some(Value::Object(h)) = o.get_mut(k) {
                    h.remove(age);
                }
            }
        }
        let mut h = std::collections::hash_map::DefaultHasher::new();
        v.to_string().hash(&mut h);
        h.finish()
    }
}

/// 사용 한도 블록 (state 최상위 limits/limits_ts/limits_src/poll)
#[derive(Clone, Debug, PartialEq)]
pub struct LimitsBlock {
    pub limits: Value,
    pub limits_ts: Value,
    pub src: &'static str,
    pub poll: Poll,
}

/// 오늘 집계
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Today {
    pub waited: f64,
    pub done: i64,
    pub kinds: IndexMap<String, i64>,
    pub agents: i64,
    pub tokens: Tokens,
}

impl Today {
    pub fn merge(&mut self, o: &Today) {
        self.waited += o.waited;
        self.done += o.done;
        for (k, v) in &o.kinds {
            *self.kinds.entry(k.clone()).or_insert(0) += v;
        }
        self.agents += o.agents;
        self.tokens.add(&o.tokens);
    }
}

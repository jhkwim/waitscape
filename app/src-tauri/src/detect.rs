//! 상태 전이 감지 → OS 알림 문구 (ARCHITECTURE §3.2 "전이 감지는 백엔드"). 창이 닫혀 트레이만 남아도 한 번만 보낸다.
//! 규칙은 web/core/core.js `detect()`·core-lib.js `stalls()`와 같다. 웹 코어는 앱에서 done/input/stall OS 알림을 보내지 않는다(중복 방지).
//! 메모 준비 알림(memo)은 메모가 웹 localStorage에 있으므로 메인 창이 보낸다.
//! 🙈 눈치 모드면 `Alert::plain`의 담백한 문구(제목 = 프로젝트, "작업이 끝났습니다 · 13분", 이모지 없음)를 보낸다.

use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Done,
    Input,
    Stall,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    pub kind: Kind,
    pub title: String,
    pub body: String,
    /// 눈치 모드 문구용: 프로젝트 이름, 분(완료 = 실행 시간, 멈춤 = 응답 없는 시간, 모르면 0), 추정 질문인가
    pub project: String,
    pub mins: i64,
    pub guess: bool,
}

impl Alert {
    /// 눈치 모드 알림 (제목, 본문): 업무 툴 알림처럼 — 제목은 프로젝트, 본문은 상태 한 줄. 프롬프트·질문 내용도 넣지 않는다
    pub fn plain(&self, lang: &str) -> (String, String) {
        let en = lang == "en";
        let m = self.mins;
        let body = match (self.kind, en) {
            (Kind::Done, false) if m > 0 => format!("작업이 끝났습니다 · {m}분"),
            (Kind::Done, false) => "작업이 끝났습니다".into(),
            (Kind::Done, true) if m > 0 => format!("Task finished · {m} min"),
            (Kind::Done, true) => "Task finished".into(),
            (Kind::Input, false) => if self.guess {
                "확인이 필요할 수 있습니다"
            } else {
                "입력이 필요합니다"
            }
            .into(),
            (Kind::Input, true) => if self.guess { "May need input" } else { "Input needed" }.into(),
            (Kind::Stall, false) => format!("응답이 없습니다 · {m}분"),
            (Kind::Stall, true) => format!("No response · {m} min"),
        };
        let title = if self.project.trim().is_empty() {
            crate::nunchi::TITLE.to_string()
        } else {
            clip(&self.project, 80)
        };
        (title, body)
    }
}

#[derive(Default)]
pub struct Detector {
    prev: HashMap<String, String>,
    stalls: HashSet<String>,
    primed: bool,
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn tr(lang: &str, key: &str) -> &'static str {
    let en = lang == "en";
    match (key, en) {
        ("done", false) => "{p} 작업 완료",
        ("done", true) => "{p} finished",
        ("input", false) => "{p} 입력 필요",
        ("input", true) => "{p} needs input",
        ("input?", false) => "{p} 확인이 필요할 수도 있어요",
        ("input?", true) => "{p} may need your input",
        ("stall", false) => "{p} 멈춤 의심",
        ("stall", true) => "{p} may be stuck",
        ("stall.body", false) => "{who}: {m}분째 응답 없음",
        ("stall.body", true) => "{who}: no response for {m} min",
        ("main", false) => "메인 세션",
        ("main", true) => "Main session",
        _ => "",
    }
}

fn clip(t: &str, n: usize) -> String {
    t.chars().take(n).collect()
}

impl Detector {
    /// 새 state를 보고 보낼 알림 목록. 첫 state는 기준만 잡고 알리지 않는다(앱을 켜자마자 몰려오는 알림 방지)
    pub fn feed(&mut self, st: &Value, lang: &str) -> Vec<Alert> {
        let mut out = vec![];
        let sessions = st.get("sessions").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        // 멈춤 의심: 메인(작업 중) + 실행 중 서브에이전트
        let mut now_stalls = HashSet::new();
        for x in &sessions {
            let sid = s(x, "sid");
            let project = s(x, "project");
            let stalled = |v: &Value| v.get("health").and_then(|h| h.get("level")).and_then(|l| l.as_str()) == Some("stall");
            let secs = |v: &Value| v.get("health").and_then(|h| h.get("secs")).and_then(|n| n.as_f64()).unwrap_or(0.0);
            let mut cand = vec![];
            if s(x, "status") == "working" && stalled(x) {
                cand.push((sid.to_string(), tr(lang, "main").to_string(), secs(x)));
            }
            for a in x.get("agents").and_then(|a| a.as_array()).into_iter().flatten() {
                if s(a, "status") == "running" && stalled(a) {
                    let who = [s(a, "desc"), s(a, "type")].into_iter().find(|w| !w.is_empty()).unwrap_or("agent");
                    cand.push((format!("{sid}:{}", s(a, "aid")), who.to_string(), secs(a)));
                }
            }
            for (key, who, secs) in cand {
                if self.primed && !self.stalls.contains(&key) {
                    let m = ((secs / 60.0).floor() as i64).max(1);
                    out.push(Alert {
                        kind: Kind::Stall,
                        title: tr(lang, "stall").replace("{p}", project),
                        body: tr(lang, "stall.body")
                            .replace("{who}", &clip(&who, 60))
                            .replace("{m}", &m.to_string()),
                        project: project.to_string(),
                        mins: m,
                        guess: false,
                    });
                }
                now_stalls.insert(key);
            }
        }
        self.stalls = now_stalls;
        for x in &sessions {
            let sid = s(x, "sid").to_string();
            let status = s(x, "status").to_string();
            if let Some(p) = self.prev.get(&sid) {
                if self.primed && *p != status {
                    let project = s(x, "project");
                    if status == "done" {
                        let prompt = x.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
                        let run = x.get("run").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        out.push(Alert {
                            kind: Kind::Done,
                            title: tr(lang, "done").replace("{p}", project),
                            body: clip(prompt, 120),
                            project: project.to_string(),
                            // 1분 미만은 1분으로(0분 표기 없음), 실행 시간을 모르면 0 = 분 생략
                            mins: if run > 0.0 { ((run / 60.0).round() as i64).max(1) } else { 0 },
                            guess: false,
                        });
                    } else if status == "needs_input" {
                        let guess = s(x, "confidence") == "guess";
                        let note = x.get("note").and_then(|v| v.as_str()).unwrap_or("");
                        out.push(Alert {
                            kind: Kind::Input,
                            title: tr(lang, if guess { "input?" } else { "input" }).replace("{p}", project),
                            body: clip(note, 160),
                            project: project.to_string(),
                            mins: 0,
                            guess,
                        });
                    }
                }
            }
            self.prev.insert(sid, status);
        }
        // 사라진 세션 정리
        let live: HashSet<&str> = sessions.iter().map(|x| s(x, "sid")).collect();
        self.prev.retain(|k, _| live.contains(k.as_str()));
        self.primed = true;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn st(status: &str, health: Option<&str>) -> Value {
        json!({"sessions": [{"sid": "a", "project": "demo", "status": status, "prompt": "fix it", "note": "Bash 허용?",
            "health": health.map(|l| json!({"level": l, "secs": 400.0})), "agents": []}]})
    }

    #[test]
    fn transitions_once() {
        let mut d = Detector::default();
        assert!(d.feed(&st("working", Some("stall")), "ko").is_empty(), "첫 state는 기준만");
        assert!(d.feed(&st("working", Some("stall")), "ko").is_empty(), "이미 알던 멈춤");
        let a = d.feed(&st("needs_input", None), "ko");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].kind, Kind::Input);
        assert_eq!(a[0].title, "demo 입력 필요");
        assert!(d.feed(&st("needs_input", None), "ko").is_empty());
        let a = d.feed(&st("working", Some("stall")), "en");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "demo may be stuck");
        assert_eq!(a[0].body, "Main session: no response for 6 min");
        let a = d.feed(&st("done", None), "ko");
        assert_eq!(
            a,
            vec![Alert {
                kind: Kind::Done,
                title: "demo 작업 완료".into(),
                body: "fix it".into(),
                project: "demo".into(),
                mins: 0,
                guess: false,
            }]
        );
        let mut g = st("needs_input", None);
        g["sessions"][0]["confidence"] = json!("guess");
        assert_eq!(d.feed(&g, "ko")[0].title, "demo 확인이 필요할 수도 있어요");
    }

    #[test]
    fn nunchi_plain_text() {
        let mut d = Detector::default();
        let mut w = st("working", None);
        w["sessions"][0]["project"] = json!("api-server");
        d.feed(&w, "ko");
        let mut done = w.clone();
        done["sessions"][0]["status"] = json!("done");
        done["sessions"][0]["run"] = json!(790.0);
        let a = d.feed(&done, "ko").remove(0);
        assert_eq!(a.plain("ko"), ("api-server".into(), "작업이 끝났습니다 · 13분".into()));
        assert_eq!(a.plain("en").1, "Task finished · 13 min");
        // 문구에 이모지·프롬프트가 없다
        for (t, b) in [a.plain("ko"), a.plain("en")] {
            assert!(!b.contains("fix it") && t.is_ascii() && b.chars().all(|c| (c as u32) < 0x2000 || ('가'..='힣').contains(&c)));
        }
        let short = Alert { mins: 0, ..a.clone() };
        assert_eq!(short.plain("ko").1, "작업이 끝났습니다");
        let ask = d.feed(&st("needs_input", None), "en").remove(0);
        assert_eq!(ask.plain("ko"), ("demo".into(), "입력이 필요합니다".into()));
        assert_eq!(
            Alert {
                guess: true,
                ..ask.clone()
            }
            .plain("en")
            .1,
            "May need input"
        );
        let stall = d.feed(&st("working", Some("stall")), "ko").remove(0);
        assert_eq!(stall.plain("ko").1, "응답이 없습니다 · 6분");
        assert_eq!(
            Alert {
                project: " ".into(),
                ..stall
            }
            .plain("ko")
            .0,
            "Agent Sessions"
        );
    }
}

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
    /// 질문 종류(state `ask`, #120): "permission" | "question" | "" 모름
    pub ask: &'static str,
    /// 🧪 완료한 턴의 마지막 테스트(state `test`, #138): "pass" | "fail" | "" 안 돌림
    pub test: &'static str,
}

/// 🧪 눈치 모드 완료 문구 뒤 " · 테스트 통과/실패"(이모지 없음 — 눈치 알림은 업무 툴처럼)
fn test_note(t: &str, en: bool) -> &'static str {
    match (t, en) {
        ("pass", false) => " · 테스트 통과",
        ("fail", false) => " · 테스트 실패",
        ("pass", true) => " · tests passed",
        ("fail", true) => " · tests failed",
        _ => "",
    }
}

impl Alert {
    /// 눈치 모드 알림 (제목, 본문): 업무 툴 알림처럼 — 제목은 프로젝트, 본문은 상태 한 줄. 프롬프트·질문 내용도 넣지 않는다
    pub fn plain(&self, lang: &str) -> (String, String) {
        let en = lang == "en";
        let m = self.mins;
        let body = match (self.kind, en) {
            (Kind::Done, false) if m > 0 => format!("작업이 끝났습니다 · {m}분{}", test_note(self.test, en)),
            (Kind::Done, false) => format!("작업이 끝났습니다{}", test_note(self.test, en)),
            (Kind::Done, true) if m > 0 => format!("Task finished · {m} min{}", test_note(self.test, en)),
            (Kind::Done, true) => format!("Task finished{}", test_note(self.test, en)),
            (Kind::Input, false) => match (self.guess, self.ask) {
                (true, _) => "확인이 필요할 수 있습니다",
                (_, "permission") => "승인이 필요합니다",
                (_, "question") => "답변이 필요합니다",
                _ => "입력이 필요합니다",
            }
            .into(),
            (Kind::Input, true) => match (self.guess, self.ask) {
                (true, _) => "May need input",
                (_, "permission") => "Approval needed",
                (_, "question") => "Answer needed",
                _ => "Input needed",
            }
            .into(),
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

/// 같은 세션의 질문 알림은 10분에 한 번(#126, PRD §4.4 — core.js detect()의 INPUT_GAP과 같은 값)
const INPUT_GAP: f64 = 600.0;

#[derive(Default)]
pub struct Detector {
    prev: HashMap<String, String>,
    stalls: HashSet<String>,
    /// 세션별 마지막 질문 알림 시각(state.now 기준)
    last_input: HashMap<String, f64>,
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
        ("perm", false) => "🔑 {p} 권한 승인 필요",
        ("perm", true) => "🔑 {p} needs your approval",
        ("ask", false) => "❓ {p}의 질문",
        ("ask", true) => "❓ {p} has a question",
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
        // 질문 알림 간격용 시각. state에 now가 없으면(옛 테스트 입력) 간격을 두지 않는다
        let now = st.get("now").and_then(|x| x.as_f64());
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
                        ask: "",
                        test: "",
                    });
                }
                now_stalls.insert(key);
            }
        }
        self.stalls = now_stalls;
        for x in &sessions {
            let sid = s(x, "sid").to_string();
            // 훅의 추정 권한 요청(confidence guess + ask permission: PermissionRequest만 오고 아직 확인 전 — 보통 몇 초 안에 바로 승인됨)은
            // 알리지 않고 따로 기억한다 — 확실해지는 순간(guess → sure) 처음으로 알린다 (#118, core.js detect()와 같은 규칙).
            // 트랜스크립트 추정(확실해질 일이 없음)은 예전처럼 "확인이 필요할 수도"로 알린다
            let status = match s(x, "status") {
                "needs_input" if s(x, "confidence") == "guess" && s(x, "ask") == "permission" => "needs_input?".to_string(),
                st => st.to_string(),
            };
            if let Some(p) = self.prev.get(&sid) {
                if self.primed && *p != status {
                    let project = s(x, "project");
                    if status == "done" {
                        let prompt = x.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
                        let run = x.get("run").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let test = match s(x, "test") {
                            "pass" => "pass",
                            "fail" => "fail",
                            _ => "",
                        };
                        // 🧪 완료한 턴에 테스트를 돌렸으면 본문 앞에 결과(#138)
                        let mark = match test {
                            "pass" => "🧪✓ ",
                            "fail" => "🧪✗ ",
                            _ => "",
                        };
                        out.push(Alert {
                            kind: Kind::Done,
                            title: tr(lang, "done").replace("{p}", project),
                            body: format!("{mark}{}", clip(prompt, 120)),
                            project: project.to_string(),
                            // 1분 미만은 1분으로(0분 표기 없음), 실행 시간을 모르면 0 = 분 생략
                            mins: if run > 0.0 { ((run / 60.0).round() as i64).max(1) } else { 0 },
                            guess: false,
                            ask: "",
                            test,
                        });
                    } else if status == "needs_input" && !now.is_some_and(|n| self.last_input.get(&sid).is_some_and(|t| n - t < INPUT_GAP))
                    {
                        if let Some(n) = now {
                            self.last_input.insert(sid.clone(), n);
                        }
                        let guess = s(x, "confidence") == "guess";
                        let note = x.get("note").and_then(|v| v.as_str()).unwrap_or("");
                        let ask = match s(x, "ask") {
                            "permission" => "permission",
                            "question" => "question",
                            _ => "",
                        };
                        let key = match (guess, ask) {
                            (true, _) => "input?",
                            (_, "permission") => "perm",
                            (_, "question") => "ask",
                            _ => "input",
                        };
                        out.push(Alert {
                            kind: Kind::Input,
                            title: tr(lang, key).replace("{p}", project),
                            body: clip(note, 160),
                            project: project.to_string(),
                            mins: 0,
                            guess,
                            ask,
                            test: "",
                        });
                    }
                }
            }
            self.prev.insert(sid, status);
        }
        // 사라진 세션 정리
        let live: HashSet<&str> = sessions.iter().map(|x| s(x, "sid")).collect();
        self.prev.retain(|k, _| live.contains(k.as_str()));
        self.last_input.retain(|k, _| live.contains(k.as_str()));
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

    /// 🧪 #138: 완료한 턴에 테스트를 돌렸으면 알림 본문 앞에 결과 기호
    #[test]
    fn done_test_mark() {
        let mut d = Detector::default();
        d.feed(&st("working", None), "ko");
        let mut v = st("done", None);
        v["sessions"][0]["test"] = json!("fail");
        let a = d.feed(&v, "ko").remove(0);
        assert_eq!((a.test, a.body.as_str()), ("fail", "🧪✗ fix it"));
        d.feed(&st("working", None), "ko");
        let a = d.feed(&st("done", None), "ko").remove(0);
        assert_eq!((a.test, a.body.as_str()), ("", "fix it"));
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
                ask: "",
                test: "",
            }]
        );
        // #118: 훅의 추정 권한 요청은 알리지 않고, 확실해지는 순간 한 번 알린다
        let mut g = st("needs_input", None);
        g["sessions"][0]["confidence"] = json!("guess");
        g["sessions"][0]["ask"] = json!("permission");
        assert!(d.feed(&g, "ko").is_empty(), "추정은 알리지 않음");
        assert!(d.feed(&g, "ko").is_empty());
        let a = d.feed(&st("needs_input", None), "ko");
        assert_eq!((a.len(), a[0].title.as_str()), (1, "demo 입력 필요"), "추정 → 확실");
        assert!(d.feed(&g, "ko").is_empty(), "확실 → 추정은 다시 알리지 않음");
        // 트랜스크립트 추정(ask 없음)은 예전처럼 "확인이 필요할 수도"
        d.feed(&st("working", None), "ko");
        let mut t = st("needs_input", None);
        t["sessions"][0]["confidence"] = json!("guess");
        assert_eq!(d.feed(&t, "ko")[0].title, "demo 확인이 필요할 수도 있어요");
        // #120: 질문 종류별 문구 (권한 / 질문), 눈치 문구도
        d.feed(&st("working", None), "ko");
        let mut p = st("needs_input", None);
        p["sessions"][0]["ask"] = json!("permission");
        let a = d.feed(&p, "ko").remove(0);
        assert_eq!(
            (a.title.as_str(), a.plain("ko").1.as_str(), a.plain("en").1.as_str()),
            ("🔑 demo 권한 승인 필요", "승인이 필요합니다", "Approval needed")
        );
        d.feed(&st("working", None), "en");
        let mut q = st("needs_input", None);
        q["sessions"][0]["ask"] = json!("question");
        let a = d.feed(&q, "en").remove(0);
        assert_eq!(
            (a.title.as_str(), a.plain("ko").1.as_str()),
            ("❓ demo has a question", "답변이 필요합니다")
        );
    }

    #[test]
    fn input_gap_per_session() {
        let at = |status: &str, now: f64| {
            let mut v = st(status, None);
            v["now"] = json!(now);
            v
        };
        let mut d = Detector::default();
        d.feed(&at("working", 1000.0), "ko");
        assert_eq!(d.feed(&at("needs_input", 1001.0), "ko").len(), 1);
        d.feed(&at("working", 1010.0), "ko");
        assert!(
            d.feed(&at("needs_input", 1100.0), "ko").is_empty(),
            "10분 안의 두 번째 질문은 조용히"
        );
        d.feed(&at("working", 1200.0), "ko");
        assert!(d.feed(&at("done", 1300.0), "ko").len() == 1, "완료 알림은 간격과 무관");
        d.feed(&at("working", 1500.0), "ko");
        assert_eq!(d.feed(&at("needs_input", 1601.0), "ko").len(), 1, "10분이 지나면 다시 알림");
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
        // 🧪 #138: 눈치 문구에 테스트 결과(이모지 없이)
        assert_eq!(
            Alert {
                test: "fail",
                ..short.clone()
            }
            .plain("ko")
            .1,
            "작업이 끝났습니다 · 테스트 실패"
        );
        assert_eq!(
            Alert { test: "pass", ..a.clone() }.plain("en").1,
            format!("Task finished · {} min · tests passed", a.mins)
        );
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

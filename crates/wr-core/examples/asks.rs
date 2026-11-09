//! 질문 알림 실사용 측정 (#136, docs/PRD.md §5.2) — 훅 로그를 다시 돌려 질문 알림이 얼마나 맞는지 숫자로 본다.
//!
//!   cargo run -p wr-core --example asks                     # 기본 로그(events.1.jsonl → events.jsonl)
//!   cargo run -p wr-core --example asks -- <파일…>           # 지정한 로그
//!   cargo run -p wr-core --example asks -- --detail         # 가짜 후보 목록(이유·세션 해시·종류·끝난 이유·초·시각)
//!   cargo run -p wr-core --example asks -- --dedupe         # 훅이 두 번 등록돼 겹친 줄을 하나로(정보가 많은 줄을 남김)
//!
//! 판정은 앱과 같은 `hooks::replay`(질문 구간 `Replay::asks`)를 쓰고, 알림은 앱 규칙을 흉내 낸다:
//! 확실해진 질문만(추정 권한은 알리지 않음) · 같은 세션 10분에 한 번(`detect.rs` `INPUT_GAP`).
//! 앱은 파일이 바뀔 때만 상태를 보고 숨긴 프로젝트는 알리지 않으므로 근사치다.
//! 새 훅(0.6.4~)은 알림 종류(`ntype`)를 남긴다. 그 전 기록(옛 훅 기간)은 따로 센다.
//!
//! 개인정보: 숫자와 세션 해시만 출력한다. 로그의 `text`(프롬프트·명령 요약)·경로는 내보내지 않는다. 외부 통신 없음.

use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use wr_core::clock::Tz;
use wr_core::paths::OsEnv;
use wr_core::providers::claude::config::ClaudeConfig;
use wr_core::providers::claude::hooks::{replay, AskSpan};

/// `app/src-tauri/src/detect.rs` `INPUT_GAP`과 같은 값(같은 세션의 질문 알림 최소 간격)
const INPUT_GAP: f64 = 600.0;
/// 알림 뒤 이보다 빨리 풀리면 사람이 반응한 게 아니라고 본다
const FAST: f64 = 3.0;
const BUCKETS: [(&str, f64); 4] = [("<3초", 3.0), ("3–10초", 10.0), ("10–60초", 60.0), (">60초", f64::INFINITY)];

fn kind_name(k: Option<&str>) -> &'static str {
    match k {
        Some("permission") => "🔑 권한",
        Some("question") => "❓ 질문",
        _ => "· 종류 없음",
    }
}

/// 세션 id를 그대로 내보내지 않게 짧은 해시(FNV-1a)로
fn tag(sid: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in sid.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{:06x}", h & 0xff_ffff)
}

/// 가짜 후보의 이유. 서브에이전트가 다시 움직여 풀린 것(sub)은 그것만으로는 후보가 아니다(사람이 승인한 결과) — 3초 안이면 fast로 센다.
/// 바로 승인(quick)은 애초에 알리지 않는다
/// - idle: 끝난(done) 뒤 생긴 종류 없는 질문 = 옛 훅(알림 종류를 안 남김)의 유휴 알림이 질문으로 되살아남(A단계 #118이 고친 문제)
/// - resume: 에이전트 결과 보고(Resume — 사람 입력이 아님)로 풀림
/// - fast: 알림 뒤 3초 안에 풀림(사람이 반응할 수 없는 시간)
fn fake(sp: &AskSpan, at: f64) -> Option<&'static str> {
    if sp.kind.is_none() && sp.from == "done" {
        Some("idle")
    } else if sp.end == "Resume" {
        Some("resume")
    } else if sp.t1.is_some_and(|t1| t1 - at < FAST) {
        Some("fast")
    } else {
        None
    }
}

#[derive(Default)]
struct Row {
    n: usize,
    end: BTreeMap<&'static str, usize>,
    dur: [usize; 4],
    fake: BTreeMap<&'static str, usize>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let detail = args.iter().any(|a| a == "--detail");
    let dedupe = args.iter().any(|a| a == "--dedupe");
    let mut files: Vec<PathBuf> = args.iter().filter(|a| !a.starts_with("--")).map(PathBuf::from).collect();
    if files.is_empty() {
        let log = ClaudeConfig::from_env(&OsEnv).log;
        files = vec![log.with_file_name("events.1.jsonl"), log];
    }
    let mut evs: Vec<Value> = vec![];
    for f in &files {
        let Ok(txt) = std::fs::read_to_string(f) else { continue };
        evs.extend(txt.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()));
    }
    let ts_of = |e: &Value| e.get("ts").and_then(|v| v.as_f64());
    // 같은 세션·이벤트·에이전트·문구가 0.5초 안에 두 번 = 훅이 두 번 등록됨(예: 옛 hook.py가 wr-hook과 함께 남음) → 판정이 흔들린다.
    // --dedupe면 겹친 쌍 중 정보가 많은 줄(ntype·ask·term이 있는 새 훅 줄)만 남긴다
    let field = |e: &Value, k: &str| e.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut seen: HashMap<(String, String, String, String), (f64, usize)> = HashMap::new();
    let mut dup = 0;
    // 마지막으로 "계속" 겹친 때: 10분 안에 겹침이 또 있었던 것만(동시에 끝난 서브에이전트 등 우연히 한 번 겹친 줄은 빼고)
    let (mut last_dup, mut prev_dup) = (f64::MIN, f64::MIN);
    let mut kept: Vec<Value> = Vec::with_capacity(evs.len());
    for e in evs {
        let Some(t) = ts_of(&e) else { continue };
        let key = (field(&e, "sid"), field(&e, "event"), field(&e, "aid"), field(&e, "text"));
        let width = |v: &Value| v.as_object().map_or(0, |o| o.len());
        match seen.get(&key) {
            Some(&(p, at)) if (t - p).abs() < 0.5 => {
                dup += 1;
                if (t - prev_dup).abs() < 600.0 {
                    last_dup = last_dup.max(t);
                }
                prev_dup = t;
                if dedupe {
                    if width(&e) > width(&kept[at]) {
                        kept[at] = e;
                    }
                    continue;
                }
            }
            _ => {}
        }
        seen.insert(key, (t, kept.len()));
        kept.push(e);
    }
    let evs = kept;
    let ts: Vec<f64> = evs.iter().filter_map(ts_of).collect();
    let (Some(first), Some(last)) = (ts.iter().cloned().reduce(f64::min), ts.iter().cloned().reduce(f64::max)) else {
        println!("읽을 훅 로그가 없어요 ({}개 파일)", files.len());
        return;
    };
    // 새 훅(0.6.4~)은 알림 종류(ntype)를 남긴다. 그 전 줄은 옛 훅 기간으로 따로 센다
    // (새 훅만 남기는 것: 알림 종류 ntype · PreToolUse의 ask · PermissionRequest 이벤트)
    let new_hook = evs
        .iter()
        .filter(|e| {
            e.get("ntype").is_some() || e.get("ask").is_some() || e.get("event").and_then(|v| v.as_str()) == Some("PermissionRequest")
        })
        .filter_map(ts_of)
        .reduce(f64::min);
    let period = |t: f64| if new_hook.is_some_and(|n| t >= n) { "새 훅" } else { "옛 훅" };
    let tz = Tz::Local;
    let r = replay(evs.iter(), last, tz);
    let day = |t: f64| tz.local_date(t).to_string();
    let hm = |t: f64| tz.local_naive(t).format("%H:%M").to_string();
    println!(
        "훅 로그 {}줄 · {} {} ~ {} {} (로그는 최대 약 10MB라 하루치를 다 못 담을 수 있어요)",
        evs.len(),
        day(first),
        hm(first),
        day(last),
        hm(last)
    );
    if dup * 5 > evs.len() + dup * usize::from(dedupe) {
        // 마지막 겹침이 로그 끝보다 1시간 넘게 앞서면 중복 등록은 이미 풀렸다(예: 옛 hook.py를 지움) — 그 전 숫자만 부풀려진다
        let last_dup = if last_dup == f64::MIN { prev_dup } else { last_dup };
        let when = format!("{} {}", day(last_dup), hm(last_dup));
        let fix = if dedupe {
            "겹친 줄은 하나로 줄여 셌어요(--dedupe)"
        } else {
            "겹친 기간의 숫자는 부풀려져요. --dedupe로 겹친 줄을 하나로 줄여 잴 수 있어요"
        };
        if last - last_dup > 3600.0 {
            println!("⚠️ {when}까지 같은 이벤트가 두 번씩 기록됐어요({dup}줄) — 그 뒤로는 겹치지 않아요(중복 등록이 풀림). {fix}");
        } else {
            println!(
                "⚠️ 같은 이벤트가 두 번씩 기록되고 있어요({dup}줄, 마지막 {when}) — 훅이 두 번 등록됐을 수 있어요(옛 hook.py 등). {fix}"
            );
        }
    }
    match new_hook {
        Some(n) => println!("새 훅(알림 종류를 남김) 첫 기록: {} {} — 그 전은 옛 훅 기간", day(n), hm(n)),
        None => println!("알림 종류를 남긴 기록이 없어요 — 모두 옛 훅 기간(설정 → AI 연결 → 다시 켜기로 훅을 새로 켜면 정확해져요)"),
    }

    // 앱 규칙대로 알림이 갔을 구간만: 확실해진 때(sure_at) · 같은 세션 10분 간격
    let mut spans: Vec<&AskSpan> = r.asks.iter().collect();
    spans.sort_by(|a, b| a.sure_at.unwrap_or(a.t0).total_cmp(&b.sure_at.unwrap_or(b.t0)));
    let mut last_alert: HashMap<&str, f64> = HashMap::new();
    let (mut guess_only, mut gapped, mut chained) = (0, 0, 0);
    // "기간 · 날짜" → 종류 → 줄
    let mut table: BTreeMap<String, BTreeMap<&'static str, Row>> = BTreeMap::new();
    let mut sum: BTreeMap<&'static str, (usize, usize)> = BTreeMap::new();
    let mut cands: Vec<(f64, &AskSpan, &'static str)> = vec![];
    for sp in spans {
        let Some(at) = sp.sure_at else {
            guess_only += 1;
            continue;
        };
        // 질문에서 질문으로 이어진 구간: 앱은 상태 문자열이 바뀔 때만 알리므로 알림이 아니다(추정 → 확실은 알림)
        if sp.from == "needs_input" {
            chained += 1;
            continue;
        }
        if last_alert.get(sp.sid.as_str()).is_some_and(|t| at - t < INPUT_GAP) {
            gapped += 1;
            continue;
        }
        last_alert.insert(&sp.sid, at);
        let row = table
            .entry(format!("{} · {}", day(at), period(at)))
            .or_default()
            .entry(kind_name(sp.kind))
            .or_default();
        row.n += 1;
        *row.end.entry(sp.end).or_default() += 1;
        if let Some(t1) = sp.t1 {
            let d = t1 - at;
            row.dur[BUCKETS.iter().position(|(_, hi)| d < *hi).unwrap_or(3)] += 1;
        }
        let s = sum.entry(period(at)).or_default();
        s.0 += 1;
        if let Some(why) = fake(sp, at) {
            *row.fake.entry(why).or_default() += 1;
            s.1 += 1;
            cands.push((at, sp, why));
        }
    }
    println!("알리지 않은 구간: 추정(바로 승인 등) {guess_only} · 질문에서 이어진 질문 {chained} · 10분 간격으로 생략 {gapped}\n");
    for (d, kinds) in &table {
        println!("■ {d}");
        for (k, row) in kinds {
            let nf: usize = row.fake.values().sum();
            let fk: Vec<String> = row.fake.iter().map(|(w, n)| format!("{w} {n}")).collect();
            let ends: Vec<String> = row.end.iter().map(|(e, n)| format!("{e} {n}")).collect();
            let dur: Vec<String> = BUCKETS.iter().zip(row.dur).map(|((b, _), n)| format!("{b} {n}")).collect();
            let why = if fk.is_empty() {
                String::new()
            } else {
                format!(" ({})", fk.join(" · "))
            };
            println!("  {k}  알림 {} · 가짜 후보 {nf}{why}", row.n);
            println!("      풀린 이유: {}", ends.join(" · "));
            println!("      알림 뒤 풀리기까지: {}", dur.join(" · "));
        }
    }
    println!();
    for (p, (n, f)) in &sum {
        let pct = if *n > 0 { *f as f64 * 100.0 / *n as f64 } else { 0.0 };
        println!("합계 {p}: 알림 {n} · 가짜 후보 {f} ({pct:.0}%)");
    }
    println!(
        "가짜 후보 = idle(끝난 뒤 종류 없는 알림이 질문이 됨, 옛 훅) · resume(에이전트 결과 보고로 풀림) · fast(알림 뒤 {FAST:.0}초 안에 풀림). open = 로그 끝까지 질문 중"
    );
    if detail && !cands.is_empty() {
        println!("\n가짜 후보 목록 (이유 · 세션 해시 · 종류 · 질문 전 상태 · 끝난 이유 · 알림 뒤 초 · 시각)");
        for (at, sp, why) in &cands {
            let secs = sp.t1.map(|t1| format!("{:.1}초", t1 - at)).unwrap_or_else(|| "-".into());
            println!(
                "  {why} · {} · {} · {} · {} · {} · {} {}",
                tag(&sp.sid),
                kind_name(sp.kind),
                sp.from,
                sp.end,
                secs,
                day(*at),
                hm(*at)
            );
        }
    }
}

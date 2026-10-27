//! 실제 데이터 성능 측정 (읽기 전용: 파일을 열어 읽기만 한다).
//!
//!   cargo run --release -p wr-core --example bench [-- <트랜스크립트.jsonl>]
//!
//! 1) 가장 큰(또는 지정한) 트랜스크립트 하나의 첫 스캔(state용 scan + trace용 tr_scan)과 변화 없는 재스캔
//! 2) 실제 ~/.claude 전체로 Engine::state() (Auto 모드) 첫 호출·두 번째 호출, Hooks 모드 비교
//! 3) 가장 최근 세션 /trace 첫 호출·두 번째 호출

use std::path::PathBuf;
use std::time::Instant;
use wr_core::providers::claude::scan::{scan, ScanCache};
use wr_core::providers::claude::trace::Tracer;
use wr_core::{ClaudeConfig, ClaudeProvider, Engine, EngineConfig, SourceMode, TraceQuery, Tz};

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn biggest(projects: &PathBuf) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for d in std::fs::read_dir(projects).ok()?.flatten() {
        for f in std::fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let n = f.metadata().map(|m| m.len()).unwrap_or(0);
                if best.as_ref().is_none_or(|b| n > b.0) {
                    best = Some((n, p));
                }
            }
        }
    }
    best.map(|b| b.1)
}

fn main() {
    let env = wr_core::paths::OsEnv;
    let cfg = ClaudeConfig::from_env(&env);
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .or_else(|| biggest(&cfg.projects))
        .expect("트랜스크립트 없음");
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("파일: {:.1} MB", size as f64 / 1e6);

    let t = Instant::now();
    let mut c = ScanCache::default();
    scan(&mut c, &path, Tz::Local);
    println!(
        "state scan 첫 스캔: {:.0} ms ({:.0} MB/s), 메시지 {}개",
        ms(t),
        size as f64 / 1e6 / t.elapsed().as_secs_f64(),
        c.msgs.len()
    );
    let t = Instant::now();
    scan(&mut c, &path, Tz::Local);
    println!("state scan 증분(변화 없음): {:.3} ms", ms(t));

    let mut tr = Tracer::default();
    let t = Instant::now();
    tr.scan(&path, true, 0.0, Tz::Local, "");
    let steps = tr.files.get(&path).map(|c| c.steps.len()).unwrap_or(0);
    println!("trace tr_scan 첫 스캔: {:.0} ms, 단계 {}개", ms(t), steps);
    let t = Instant::now();
    tr.scan(&path, true, 0.0, Tz::Local, "");
    println!("trace tr_scan 증분(변화 없음): {:.3} ms", ms(t));

    {
        let now = wr_core::Clock::System.now();
        let t = Instant::now();
        let mut n = 0;
        for _ in 0..10 {
            n = wr_core::providers::claude::tonly::discover(&cfg.projects, now, now - 86400.0, &wr_core::hide::HideRules::default()).len();
        }
        println!("discover() (projects/*/*.jsonl stat): {:.1} ms, 최근 파일 {n}개", ms(t) / 10.0);
    }
    for mode in [SourceMode::Auto, SourceMode::Hooks] {
        let mut cfg = ClaudeConfig::from_env(&env);
        cfg.source = mode;
        cfg.v11_fields = mode != SourceMode::Hooks;
        let mut e = Engine::new(EngineConfig::from_env(&env));
        e.add(Box::new(ClaudeProvider::new(cfg)));
        let t = Instant::now();
        let st = e.state();
        let first = ms(t);
        let t = Instant::now();
        let st2 = e.state();
        let second = ms(t);
        let mut ticks = vec![];
        for _ in 0..20 {
            let t = Instant::now();
            let _ = e.state();
            ticks.push(ms(t));
        }
        ticks.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let bytes = serde_json::to_vec(&st2).unwrap().len();
        println!(
            "Engine::state() [{mode:?}] 첫 {first:.0} ms / 두 번째 {second:.1} ms / tick 중앙값 {:.1} ms — 세션 {}개, JSON {:.1} KB",
            ticks[10],
            st.sessions.len(),
            bytes as f64 / 1024.0
        );
        if mode == SourceMode::Auto {
            if let Some(s) = st.sessions.iter().max_by(|a, b| a.last.partial_cmp(&b.last).unwrap()) {
                let q = TraceQuery {
                    session: s.sid.clone(),
                    ..Default::default()
                };
                let t = Instant::now();
                let r = e.trace(&q);
                let a = ms(t);
                let cursor = r.body["cursor"].as_str().unwrap_or("").to_string();
                let t = Instant::now();
                let r2 = e.trace(&TraceQuery {
                    since: cursor,
                    ..q.clone()
                });
                println!(
                    "Engine::trace() 최근 세션 첫 {a:.0} ms (단계 {}) / since 커서 재요청 {:.1} ms (단계 {})",
                    r.body["total"],
                    ms(t),
                    r2.body["steps"].as_array().map(|x| x.len()).unwrap_or(0)
                );
            }
        }
    }
}

#[allow(dead_code)]
fn discover_bench() {}

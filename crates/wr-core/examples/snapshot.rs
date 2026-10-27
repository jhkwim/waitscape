//! Rust 스냅샷 러너 — scripts/snapshot.py와 같은 cases.json·고정 시계로 결과를 만든다.
//!
//!   cargo run -p wr-core --example snapshot -- --out <폴더> [--transcript-only <state.json>]
//!   python3 scripts/compare.py fixtures/expected <폴더> --ignore provider,providers
//!   python3 scripts/check_transcript_only.py <state.json>
//!
//! (scripts/rust_parity.sh가 위 과정을 한 번에 한다.)

include!("../tests/support/runner.rs");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let root = arg("--root").map(PathBuf::from).unwrap_or_else(repo_root);
    let cfg = load(&root.join("fixtures/fixture.json"));
    // 시간대 고정 (chrono Local은 TZ를 따른다). 스레드를 만들기 전에 설정
    std::env::set_var("TZ", cfg["tz"].as_str().unwrap_or("UTC"));
    let mut bad = 0;
    if let Some(out) = arg("--out") {
        let out = PathBuf::from(out);
        std::fs::create_dir_all(&out).unwrap();
        let (results, leaks) = run_cases(&root);
        for (name, v) in &results {
            std::fs::write(out.join(format!("{name}.json")), serde_json::to_string_pretty(v).unwrap() + "\n").unwrap();
        }
        for l in &leaks {
            println!("LEAK {l}");
        }
        bad += leaks.len();
        println!("Rust 결과 {}개 → {}", results.len(), out.display());
    }
    if let Some(p) = arg("--transcript-only") {
        let (st, leaks) = run_transcript_only(&root);
        std::fs::write(&p, serde_json::to_string_pretty(&st).unwrap() + "\n").unwrap();
        for l in &leaks {
            println!("LEAK {l}");
        }
        bad += leaks.len();
        println!("트랜스크립트 전용 state → {p}");
    }
    std::process::exit(if bad > 0 { 1 } else { 0 });
}

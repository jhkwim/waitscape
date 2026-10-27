//! 동등성 검증: Python 참조 구현(server.py)이 만든 fixtures/expected/*.json과 Rust 결과가 같아야 한다.
//! 트랜스크립트 전용 엔진은 fixtures/transcript-only/expected.json(손으로 쓴 기대값)과 부분 비교.

include!("support/runner.rs");

fn set_tz(root: &Path) {
    let cfg = load(&root.join("fixtures/fixture.json"));
    std::env::set_var("TZ", cfg["tz"].as_str().unwrap());
}

#[test]
fn golden_parity() {
    let root = repo_root();
    set_tz(&root);
    let (results, leaks) = run_cases(&root);
    assert!(leaks.is_empty(), "가짜 시크릿 노출: {leaks:?}");
    let exp_dir = root.join("fixtures/expected");
    let mut names: Vec<String> = std::fs::read_dir(&exp_dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().into_string().unwrap())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    let mut bad = vec![];
    for nm in &names {
        let exp = load(&exp_dir.join(nm));
        let key = nm.trim_end_matches(".json");
        let Some((_, got)) = results.iter().find(|(k, _)| k == key) else {
            bad.push(format!("{nm}: 결과 없음"));
            continue;
        };
        let mut out = vec![];
        diff(&exp, got, "", &mut out, &["provider", "providers"]);
        for o in out.iter().take(10) {
            bad.push(format!("{nm}: {o}"));
        }
    }
    assert_eq!(names.len(), 23);
    assert!(bad.is_empty(), "동등성 실패:\n{}", bad.join("\n"));
}

#[test]
fn transcript_only_24() {
    let root = repo_root();
    set_tz(&root);
    let (st, leaks) = run_transcript_only(&root);
    assert!(leaks.is_empty(), "{leaks:?}");
    let bad = check_transcript_only(&root, &st);
    assert!(bad.is_empty(), "트랜스크립트 전용 판정 실패:\n{}", bad.join("\n"));
    // 계약 1.1 필드
    assert_eq!(st["providers"][0]["id"], json!("claude"));
    assert_eq!(st["providers"][0]["capabilities"]["subagents"], json!(true));
    assert!(st["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["provider"] == json!("claude") && s["source"] == json!("transcript")));
}

/// Auto 모드: 최근 훅 이벤트가 있는 세션은 훅, 나머지는 트랜스크립트 (같은 입력으로 두 소스 병합)
#[test]
fn auto_merge_prefers_fresh_hooks() {
    let root = repo_root();
    set_tz(&root);
    let secrets = fake_secrets(&root);
    let work = temp_dir("auto");
    stage(&root.join("fixtures/input"), &work, &secrets);
    // 트랜스크립트 전용 세션도 같은 projects 폴더에 넣는다
    stage(&root.join("fixtures/transcript-only/input"), &work, &secrets);
    let now = load(&root.join("fixtures/fixture.json"))["now"].as_f64().unwrap();
    let mut e = engine(&work, "/Users/alex", now, SourceMode::Auto);
    let st = serde_json::to_value(e.state_at(now)).unwrap();
    let by = |sid: &str| st["sessions"].as_array().unwrap().iter().find(|s| s["sid"] == json!(sid)).cloned();
    // fx-flow: 훅 이벤트가 10분 안 → hook
    assert_eq!(by("fx-flow").unwrap()["source"], json!("hook"));
    // to-ask: 훅 없음 → transcript
    let ask = by("to-ask").unwrap();
    assert_eq!(
        (ask["source"].clone(), ask["status"].clone()),
        (json!("transcript"), json!("needs_input"))
    );
    assert!(st["hooks"]["last_event_age"].as_f64().is_some());
    let text = st.to_string();
    assert!(secrets.iter().all(|(_, v)| !text.contains(v.as_str())));
    std::fs::remove_dir_all(&work).ok();
}

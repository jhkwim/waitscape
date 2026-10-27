//! **디버그 빌드 전용** E2E 드라이버 (릴리스 빌드에는 컴파일되지 않음: lib.rs의 `#[cfg(debug_assertions)]`).
//! `WAITSCAPE_E2E_DIR=<폴더>`를 주고 실행하면 그 폴더의 `<창 label>.<이름>.js`를 차례로 그 창에서 실행하고
//! 결과(JSON 문자열)를 `<이름>.out`에 쓴다. 화면 자동화 도구 없이 앱 안 동작(모드 전환, 탈출 시험 결과 읽기)을 확인하는 용도.

use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub fn start(app: &AppHandle) {
    let Some(dir) = std::env::var_os("WAITSCAPE_E2E_DIR").map(PathBuf::from) else {
        return;
    };
    wlog!("e2e", "E2E 드라이버 켜짐: {}", dir.display());
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(300));
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "js"))
            .collect();
        files.sort();
        for f in files {
            let name = f.file_name().unwrap().to_string_lossy().to_string();
            let Some((label, rest)) = name.split_once('.') else { continue };
            let js = std::fs::read_to_string(&f).unwrap_or_default();
            std::fs::remove_file(&f).ok();
            let out = dir.join(format!("{}.out", rest.trim_end_matches(".js")));
            match app.get_webview_window(label) {
                Some(w) => {
                    let r = w.eval_with_callback(js, move |res| {
                        std::fs::write(&out, res).ok();
                    });
                    if let Err(e) = r {
                        eprintln!("[e2e] eval 실패: {e}");
                    }
                }
                None => {
                    std::fs::write(&out, format!("\"no window {label}\"")).ok();
                }
            }
        }
    });
}

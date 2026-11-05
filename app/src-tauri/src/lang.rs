//! 백엔드가 화면에 돌려주는 문구의 언어 고르기 (#76). 기본은 한국어, 설정 언어가 `en`이면 영어.

/// 설정 언어로 문구 고르기: `l!(en, "한국어 {x}", "English {x}")`. 인자·암묵적 캡처는 `format!`과 같다
macro_rules! l {
    ($en:expr, $ko:literal, $eng:literal $(, $a:expr)* $(,)?) => {
        if $en {
            format!($eng $(, $a)*)
        } else {
            format!($ko $(, $a)*)
        }
    };
}

/// wr-core `HookError`(문구가 server.py와 같아 엔진에서는 한국어 고정)를 설정 언어로 — 영어 문장 안에 끼워 넣을 때 (#76)
pub fn hook_err(e: &wr_core::hooks_config::HookError, en: bool) -> String {
    use wr_core::hooks_config::HookError as H;
    if !en {
        return e.to_string();
    }
    match e {
        H::Parse => "Couldn't parse settings.json, so it was left untouched".into(),
        H::NotObject => "settings.json isn't a JSON object at the top level, so it was left untouched".into(),
        H::Changed => "settings.json changed in the meantime. Please try again".into(),
        H::Io(x) => format!("File error: {x}"),
    }
}

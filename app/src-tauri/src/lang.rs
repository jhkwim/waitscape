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

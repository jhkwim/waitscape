# 이번 패스의 관점: 플랫폼 차이(Windows·macOS·Linux)

이번 패스에서는 **이 관점만** 본다. 다른 관점(체크리스트·보안 일반론·서식·문서)은 기본 패스와 다른 렌즈가 맡는다.
이 앱은 macOS·Windows로 배포되고 CI는 Linux에서도 돈다. 변경된 코드가 **다른 OS에서** 어떻게 되는지 따진다.

1. **인코딩**: Python `open()`·`read_text()`·`write_text()`·`subprocess(..., text=True)`에 `encoding="utf-8"`이 빠졌나? Windows 기본은 cp1252라 한글·이모지·cargo JSON에서 UnicodeDecodeError가 난다. `print`/stdout으로 한글·이모지를 내보낼 때 `sys.stdout.reconfigure(encoding="utf-8")`나 `PYTHONUTF8=1`이 필요한가?
2. **표준 입력**: 훅이 받는 JSON을 바이트로 읽어 UTF-8로 디코딩하나(콘솔 코드페이지에 기대지 않나)?
3. **경로**: `/` 하드코딩, `os.sep`, 드라이브 문자(`C:\`)·UNC(`\\server\share`)·`\\?\` 접두사, 대소문자를 구분하지 않는 파일시스템, 긴 경로, `HOME` vs `USERPROFILE`·`APPDATA`·`LOCALAPPDATA`.
4. **파일 작업**: 줄바꿈 CRLF, 열려 있는 파일의 rename·삭제 실패(Windows 잠금), 실행 비트·`chmod`, `.cmd`/`.bat`·셸 스크립트를 가정한 실행, 원자적 쓰기(임시 파일 → rename)가 Windows에서도 되는가.
5. **Rust**: `std::process::Command`(콘솔 창 뜸 `CREATE_NO_WINDOW`), 경로 `to_str().unwrap()`(비 UTF-8 경로 panic), `cfg(windows)`·`cfg(target_os = "macos")` 분기가 빠졌거나 한쪽만 테스트되나.
6. **CI·워크플로**: Windows 러너의 셸(bash vs pwsh), `python3` vs `python`, 경로 구분자, 환경 변수 문법.
7. **웹뷰 차이**: WebView2(Windows)·WKWebView(macOS)에서 다른 API·CSS(예: `container` 쿼리, 스크롤바, 이모지 폰트, 클립보드).

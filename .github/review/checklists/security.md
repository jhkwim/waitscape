# 체크리스트: 보안 (security)

diff가 아래 영역에 닿을 때만 확인한다. 항목마다 "어떤 입력 → 어떤 결과"를 직접 따라가 보고, 막는 코드가 있으면 지적하지 않는다.

## S1. 시크릿·토큰
- [ ] 실제 형태 키(`AKIA[0-9A-Z]{16}`, `gh[pousr]_` + 36자, `github_pat_`, `xox[abprs]-`, `sk-ant-` + 20자 이상, `-----BEGIN … PRIVATE KEY-----`)가 코드·fixture·문서·CI 로그 출력에 있는가 → 🔴
- [ ] OAuth 토큰이 지나가는 모든 경로: 구조체 `Debug`/`Display`/`Serialize` 파생, `format!`/`println!`/`eprintln!`/`log::`, `anyhow`/`Error` 메시지(`{:?}`로 요청 헤더가 찍히는지), panic 메시지, state·이벤트 파일, 프론트로 가는 IPC 응답
- [ ] 토큰 보관: `Zeroizing`/drop 시 지움, 파일에 쓰지 않음, refresh 하지 않음, 만료(`expiresAt`) 확인
- [ ] 키체인 접근이 사용자 동작 없이 자동으로 일어나는가(암호 창이 시작 시 뜸)
- [ ] 검출기(예: `check_secrets.py`) 자체가 찾은 값을 로그에 너무 많이 출력하는가(접두사 외 실제 문자 노출)

## S2. 로컬 HTTP 서버 (DNS 리바인딩·CSRF)
- [ ] 바인딩 주소가 `127.0.0.1`(not `0.0.0.0`/`::`)인가
- [ ] `Host` 검사: 포트까지 일치, 대소문자, `Host` 없음/중복, `localhost.:7777`, `127.0.0.1.nip.io` 같은 변형 → 403인가. 검사가 **모든 경로**(정적 파일·`/_modes`·`/_sdk` 포함)보다 먼저인가
- [ ] 메서드: GET/HEAD 외 거부, 상태를 바꾸는 GET이 새로 생기지 않았는가
- [ ] CORS 헤더(`Access-Control-Allow-Origin`)를 새로 내보내지 않는가
- [ ] 응답에 홈 경로·cwd·토큰이 들어가지 않는가(`~` 축약)

## S3. 경로 탈출·파일 서빙
- [ ] 요청 경로를 **퍼센트 디코딩한 뒤** 정규화·검사하는가(`%2e%2e`, `%2f`, 이중 인코딩, 백슬래시 `\`, 널 바이트)
- [ ] `canonicalize` 후 루트 접두사 비교인가(문자열 `starts_with`만이면 `/modes-evil` 같은 형제 폴더 통과)
- [ ] 심볼릭 링크 거부(링크 자체와 중간 디렉터리), Windows 드라이브 문자·UNC 경로
- [ ] 확장자 화이트리스트가 대소문자·이중 확장자(`x.js.exe`)에서 맞게 동작하는가
- [ ] 세션 ID 등 쿼리 값이 파일 경로로 들어가기 전에 `[A-Za-z0-9_-]` 검증을 거치는가

## S4. 외부 모드 샌드박스
- [ ] iframe `sandbox`에 `allow-same-origin`/`allow-popups`/`allow-top-navigation`/`allow-forms`가 추가되지 않았는가
- [ ] CSP가 **모든** `/_modes/…`·`wrmode:` 응답(오류 응답·404 포함)에 붙는가. `connect-src 'none'`·`frame-src 'none'`·`worker-src 'none'`·`form-action 'none'`·`base-uri 'none'`
- [ ] 브리지: `event.source === iframe.contentWindow` 확인, op 화이트리스트, `needs` 권한 확인이 **호스트 쪽**에서(SDK 쪽 확인만으로는 무의미), 메시지 크기·빈도 제한
- [ ] 외부 모드로 가는 state 정제(`cwd`·`@unstable` 제거)가 새 필드에도 적용되는가
- [ ] 앱: Tauri capability가 `main`/`widget`/`manager` 창에만, `remote.urls` 비어 있음, 커스텀 스킴 핸들러가 모드 폴더 밖 파일을 주지 않음, 하위 frame 외부 내비게이션 거부
- [ ] 외부 모드 HTML 생성 시 `mode.json` 값(이름·id·styles)을 HTML에 그대로 넣는가(속성·스크립트 인젝션)

## S5. 명령 실행·인젝션
- [ ] `sh -c`/`cmd /C`/`osascript -e`/PowerShell 문자열에 경로·cwd·세션 값·모드 이름을 끼워 넣는가 → 인자 배열로
- [ ] 인자 배열이라도 `-`로 시작하는 값이 옵션으로 해석되는가(`--` 구분자)
- [ ] `innerHTML`/템플릿 문자열에 state·trace·mode.json 텍스트가 `esc()` 없이 들어가는가(XSS → 메인 문서는 신뢰 컨텍스트라 🔴)

## S6. settings.json·사용자 파일 쓰기
- [ ] 파싱 실패/객체가 아님/`hooks`가 배열이 아님 → 중단(덮어쓰기 금지), panic 없음
- [ ] 쓰기 전 백업, 임시 파일 + rename(같은 파일 시스템), 쓰기 직전 mtime 재확인
- [ ] 우리 항목 판별이 너무 넓지 않은가(사용자의 다른 훅을 지움) / 너무 좁지 않은가(중복 설치)
- [ ] 제거 후 빈 배열·빈 객체 정리 방식이 사용자 구조를 바꾸지 않는가

## S7. zip 설치
- [ ] 엔트리 이름 `..`, 절대 경로, `C:`, 백슬래시, 심볼릭 링크 엔트리, 같은 이름 중복
- [ ] 크기 상한을 **압축 해제 후 실제 바이트**로 세는가(헤더의 선언 크기만 믿으면 zip bomb)
- [ ] 개수·확장자 제한, 임시 폴더 정리, 설치 실패 시 기존 모드 보존(덮어쓰기 원자성)
- [ ] 권한(`needs`)이 늘어난 업데이트에서 다시 동의받는가

## S8. 외부 통신·개인 정보
- [ ] 새 외부 요청(URL 상수, `ureq`/`reqwest`/`fetch`/CDN 링크)이 `ARCHITECTURE.md` §7.1에 대상·데이터와 함께 적혀 있는가
- [ ] `curl`/`wget`에 환경변수·토큰을 넘기는 스크립트
- [ ] 텔레메트리·오류 수집이 새로 생겼는가
- [ ] fixture·테스트·로그에 실제 홈 경로·실제 트랜스크립트·소속 조직명

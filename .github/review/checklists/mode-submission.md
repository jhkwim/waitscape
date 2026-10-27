# 체크리스트: 모드 제출·내장 모드 추가 (mode-submission)

대상: `web/modes/<id>/` 추가·변경, 외부 모드 패키지(zip·폴더) 검토. 기준: `MODES.md` §2·§4·§7·§11, `types/mode.schema.json`.

## M1. 패키지·매니페스트
- [ ] 폴더 이름 = `mode.json` `id` = `registerMode({ id })`, 형식 `^[a-z0-9][a-z0-9-]{0,31}$`, 내장 id와 겹치지 않음
- [ ] `python3 scripts/validate_modes.py <경로>/mode.json` 통과, `apiVersion`이 호스트(1.0) 범위
- [ ] `entry`·`styles`·`icon` 파일이 실제로 패키지 안에 있음, 허용 확장자만(js, css, json, svg, png, jpg, webp, gif, woff2, ttf, mp3, ogg, wav, md, txt)
- [ ] 내장으로 넣을 때: `web/modes/index.json` 등록, `README.md` 구조 섹션 갱신(필수)

## M2. 권한 (`needs`) — 최소 권한
- [ ] 선언한 권한(trace·memo·notify·clipboard)마다 코드에서 실제로 쓰는 곳이 있는가(안 쓰는 권한 = 🟡 불필요한 권한)
- [ ] 쓰는데 선언 안 한 권한 → 외부 모드에서 `undefined`로 깨짐(`if (ctx.memo)` 확인 누락)
- [ ] `clipboard.write`·`memo.copy`가 사용자 클릭 핸들러 안에서만 호출되는가

## M3. 샌드박스 규칙 (외부 모드로 실행될 때 깨지거나, 탈출을 시도하는 코드)
- [ ] `fetch`/XHR/WebSocket/EventSource/`sendBeacon`/`Image().src=외부`/`RTCPeerConnection` — 데이터 유출 시도로 보이면 🔴
- [ ] `location.href`/`location.assign`/`window.open`/`top`/`parent` 접근 — 자기 이동 유출(알려진 한계)을 노리는 코드면 🔴
- [ ] 외부 CDN 폰트·이미지·CSS `@import` (CSP로 막혀 깨짐 + 내장이면 외부 통신 정책 위반)
- [ ] 전역 `document`/`window`/`localStorage`/`setInterval` 직접 사용(내장 모드 규칙 위반, 외부 모드는 store가 브리지)
- [ ] 난독화·minify된 코드, `eval`/`new Function`/동적 스크립트 삽입 — 검토 불가 사유로 `question`

## M4. 품질 (사용자에게 보이는 실패만)
- [ ] 다른 모드로 10번 왕복 시 타이머·리스너 증가(ctx 헬퍼 미사용)
- [ ] 회의 모드에서 소리·움직임, 라이트/다크, ko/en
- [ ] "Claude" 문구 하드코딩(프로바이더 이름 사용), 프로바이더 기능 없을 때 UI 숨김
- [ ] state 필드 nullable(`limits: null`, `ctx` 없음) 처리 — 값이 없을 때 예외로 화면 전체가 멈추는가

## M5. 자산·라이선스
- [ ] 폰트·이미지·소리가 `assets/`에 있고 라이선스(OFL·CC 등) 명시, 재배포 가능한가
- [ ] 스크린샷·예시 데이터에 실제 프롬프트·경로가 없는가

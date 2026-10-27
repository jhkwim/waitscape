# 체크리스트: 웹 프론트 (frontend)

대상: `web/core/*`, `web/sdk/*`, `web/modes/*`, `web/index.html`, `tools/dev.ts`. 빌드 없는 순수 JS(브라우저 + WebKit/WebView2).

## F1. XSS·인젝션 (메인 문서 = 신뢰 컨텍스트)
- [ ] state·trace·mode.json·메모에서 온 문자열이 `innerHTML`/`insertAdjacentHTML`/템플릿 문자열에 `Core.esc()` 없이 들어가는가(속성 값 안 따옴표 포함)
- [ ] `href`/`src`에 사용자 유래 값(`javascript:` URL)
- [ ] 설정 화면(Shadow DOM)도 같은 규칙

## F2. 샌드박스 브리지 (`bridge-host.js`·`mode-sdk.js`)
- [ ] `security.md` S4. 특히 권한 확인이 호스트 쪽에서, 응답 `postMessage(…, "*")`에 민감 정보가 없는가
- [ ] 두 번째 `load` 감지 → iframe 제거·모드 끄기 경로가 모든 진입점(재마운트·개발 새로고침)에서 유지되는가
- [ ] rate limit(notify 분당 6회, chime 초당 1회, store 256KB)이 우회되는가(여러 키로 쪼개기, 타이머 리셋)

## F3. 모드 수명 주기·누수
- [ ] 모드 코드가 `setInterval`/`addEventListener`/`requestAnimationFrame`/`fetch`/전역 `document`·`window`·`localStorage`를 직접 쓰는가 (`ctx.every/after/loop/listen`, `ctx.doc/win/store`, `ctx.api`)
- [ ] unmount 후 DOM·CSS·타이머가 남는가(10번 왕복 시 증가)
- [ ] 상태를 mount 클로저 밖 전역에 두는가(두 문서에 동시에 뜰 때 공유)

## F4. 데이터 계층 (`Core.api`)
- [ ] http/tauri 두 구현의 응답 형태가 같은가(`types/state.d.ts`)
- [ ] 폴링: 탭 숨김 시 멈춤, 중복 타이머, 실패 시 백오프, 응답 순서 뒤바뀜(늦게 온 옛 응답이 새 상태를 덮음)
- [ ] `/trace`는 흐름 모드가 켜져 있을 때만, `since` 커서 증분 병합 정확성

## F5. 계약·호환
- [ ] state 필드 사용이 `types/state.d.ts`와 맞는가(nullable 처리, 단위: 초/밀리초/epoch)
- [ ] 외부 모드에 `@unstable`·`cwd` 의존이 생기지 않는가
- [ ] `apiVersion` 판정·`types/CHANGELOG.md` 갱신(ctx 함수·브리지 메시지 추가 시)
- [ ] 문구에 "Claude" 하드코딩 대신 `Core.provider(state, s).name`, 프로바이더 기능 없을 때 UI 숨김(`Core.can`)

## F6. WebKit/WebView2 (ARCHITECTURE.md §5.3)
- [ ] Safari 미지원 API(Document PiP, Web `Notification` in WKWebView 등)를 분기 없이 호출
- [ ] `backdrop-filter`에 `-webkit-` 접두사, `color-mix()` 최소 버전
- [ ] 외부 CDN 폰트·이미지(외부 통신 + 오프라인 깨짐) — `web/fonts/`·`assets/` 번들이어야 함

## F7. 알림·설정
- [ ] 완료/입력 필요/멈춤 알림이 **한 번만** 가는가(재연결·모드 전환·여러 탭에서 중복)
- [ ] 회의 모드에서 소리·움직임 0
- [ ] localStorage 키 충돌(`mode:<id>:` 접두사), JSON 파싱 실패 시 기본값

## F8. 개발 서버 (`tools/dev.ts`)
- [ ] 백엔드 프록시 대상이 127.0.0.1/localhost로만 제한되는가(`WR_BACKEND`), 개발 서버도 `Host` 검사·127.0.0.1 바인딩인가
- [ ] 파일 감시 경로가 저장소 밖을 서빙하지 않는가

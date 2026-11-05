# Mode API 변경 내역

앱 버전과 별개. minor = 추가만, major = 제거·의미 변경 (정책: `ctx.d.ts` 머리말, ARCHITECTURE.md §4.3).

## 1.0 (P2)
- 첫 공개 계약: `state.d.ts`, `trace.d.ts`, `ctx.d.ts`, `mode.schema.json`
- 모드 패키지 = 폴더 + `mode.json` (`id, name, icon, version, apiVersion, entry, styles, author, description, license, needs, uses, locale, chimeWave, widget`)
- `ctx` 추가분(이전 비공식 ctx 대비): `ctx.api.trace`(needs `trace`), `ctx.store`(모드별 네임스페이스), `ctx.notify`, `ctx.clipboard.write`, `ctx.host`, `ctx.lang`, `ctx.info`
- `Core.provider / can / providerBadge` — 세션의 AI 코딩 도구와 기능 플래그 (state의 `providers`·`session.provider`는 1.1에서 들어올 예정, 없으면 Claude)
- 외부 모드: 샌드박스 iframe + postMessage 브리지 (`BridgeOp`), @unstable state 필드 제거
- deprecated: `registerMode({ label, icon, chimeWave, css })` → mode.json이 우선 (호환용으로 남김)

## 1.1 (예정, P1)
- state: `agent.stale?: true` (추가만) — SubagentStop 없이 6시간 넘게 활동이 없던 에이전트는 `status:"done"` + `stale:true`로 내려감(`ended` = 마지막 활동). 멈춤 판정·running 집계에서 제외
- `ctx.api.showMain()` (@trusted, 앱 위젯 창 전용) 추가: 미니 보기 끝 → 큰 창 복귀. `ctx.api.openWidget`은 의미 변경 없이 "큰 창을 숨기는 미니 보기 전환"으로 동작하며 메인 창에만 노출
- `ctx.api.openTerminal(sid)` (@trusted, 앱 전용) 선언 추가: `"opened" | "unsupported"`. 내부 `CoreApi.openTerminal`은 `{ result, cwd }`를 돌려줌(`"focused"` 없음)
- state: `session.provider`, `state.providers[]`, `session.source`, `session.confidence`, `state.hooks`
- 퇴근 일보: `GET /daylog?day=today|yesterday|YYYY-MM-DD` → `types/daylog.d.ts` `DayLog`, `POST /daylog/seen` (JSON 본문만, 같은 출처만).
  Tauri `get_daylog`·`daylog_seen`, `CoreApi.daylog?`·`daylogSeen?`(코어 전용 @unstable — 외부 모드 브리지에는 없음). `/state` 형식은 그대로
- 앱 업데이트(코어 전용, 앱만): `CoreApi.appInfo()` → `{ version, features: { updater, terminalJump } }`(빌드 플레이버로 꺼진 기능은 코어가 UI를 숨김), `CoreApi.update`(확인·설치, `UpdateStatus`), 설정 `AppSettings.updateCheck`(기본 켜짐). 외부 모드 브리지에는 없음
- 퇴근 일보 화면: `CoreApi.saveImage?(name, bytes)` → 저장한 경로 | null(취소) — Tauri `save_image`(메인 창 전용, PNG·8MB 이하만, 저장 위치는 사용자가 대화상자에서 고름). 브라우저는 다운로드로 대신. 코어 전용(외부 모드 브리지에는 없음)

## 1.2 (예정, MCP 보고 PR 1)
- state: `session.report?: Report` (@unstable — 외부 모드 브리지가 뺌), `session.source`에 `"mcp"` 추가(훅 없는 AI CLI의 MCP 보고 세션, `provider`: `"codex" | "gemini" | "other"`),
  `ProviderCapability`에 `"report"`, `state.mcp?: { last_report_age }`(@unstable). 모두 추가만. `/state`의 기존 필드 의미는 그대로
- `Report` = `{ source: "mcp", ts, state?, title?, step?, total?, board?: { lines, done, ts }, big?: { title, ts }, cheer? }` — 서버에서 정화·마스킹·절단된 값
- 앱 설정 `AppSettings.mcpReports?`(실험, 기본 꺼짐). 화면 표시(스튜디오 보드·단계 칸·큰 일 축하)와 일보 `cheers`는 PR 3
- (PR 2, 코어 전용·앱만) `CoreApi.mcp?` = `{ status(), plan(cli, connect, autoAllow), apply(cli, connect, autoAllow) }` — Tauri `mcp_status`·`mcp_plan`·`mcp_apply`(메인 창 전용).
  `cli`: `"claude" | "codex" | "antigravity"`. 외부 모드 브리지에는 없음. state 계약 변화 없음(Antigravity 세션의 `provider`는 `"gemini"`)
- (PR 3) `/daylog`(`DayLog`, 코어 전용): `cheers: { sid, provider, text, t }[]`(AI 칭찬 한마디, 최근 5개), `DayBigJob.by_ai?: true`(AI가 큰 일이라고 알림 — 10분 미만도 큰 일). 추가만.
  일지 파일 `turns[]`에 선택 키 `by_ai`·`cheer`(옛 파일·옛 리더와 호환). MCP 세션의 끝난 일이 `/state`의 `done_today`·`waited_today`에 들어간다(의미는 그대로 "오늘 끝난 턴").
  `providers[]`: 보이는 Gemini 세션이 모두 Antigravity CLI면 `name: "Antigravity"`(id는 `"gemini"` 그대로). 스튜디오 화면 표시(보드·단계·칭찬)는 내장 모드 안의 일 — 외부 모드 계약 변화 없음

## 1.3 (예정, 멀티플렉서 이동 #37)
- state: `session.jump?: Jump` (@unstable — 외부 모드 브리지가 뺌) = `{ mux?: { kind, workspace, surface? } }`. kind는 지금 `"cmux"`만. 추가만
- 훅 이벤트(events.jsonl): 선택 필드 `term.mux` (훅이 어댑터 표의 허용 목록 env만 읽음 — cmux: `CMUX_WORKSPACE_ID`·`CMUX_SURFACE_ID`). MCP 사이드카 기록 줄도 같은 `term`
- `ctx.api.openTerminal(sid)` 반환은 그대로(`"opened" | "unsupported"`). 멀티플렉서 세션이면 그 워크스페이스·패널로 간다. 내부 `CoreApi.openTerminal`의 `result`에
  `"mux" | "mux-app" | "mux-off" | "mux-denied"`와 `kind` 추가(코어 전용). 앱 설정 `terminal`에 `"cmux"` 추가

## 1.4 (예정, Orca 이동 #40)
- state: `Jump.mux`에 `kind: "orca"` 형태 추가 = `{ kind: "orca", surface, path? }` — `surface`는 Orca 터미널 핸들(`term_…`), `path`는 worktree 절대 경로(선택 필드 `path` 추가만).
  cmux 형태 `{ kind: "cmux", workspace, surface? }`는 그대로. `workspace`는 이제 cmux에서만 있다(모르는 kind는 무시하는 기존 규칙 그대로). 외부 모드 브리지에는 계속 없음
- 훅 이벤트 `term.mux`도 같은 형태. 훅이 읽는 env 허용 목록에 `ORCA_TERMINAL_HANDLE`·`ORCA_WORKTREE_PATH` 추가(토큰류는 읽지 않음)
- 내부 `CoreApi.openTerminal`의 `result`에 `"mux-launch"`(Orca가 꺼져 있어 앱만 띄움) 추가(코어 전용). `ctx.api.openTerminal` 반환은 그대로

## 1.5 (예정, 진단 로그)
- 내부 `CoreApi.openLogDir?()` 추가(코어 전용·앱 메인 창만): Tauri `open_log_dir` — 앱 로그 폴더(`waitscape.log`)를 연다. 외부 모드 브리지에는 없음
- `ctx.api.openWidget` 반환·의미는 그대로. 실패하면 코어가 이유를 toast로 띄우고(그 뒤 reject는 그대로), 10초 안에 답이 없으면 로그 폴더 안내 toast. state 계약 변화 없음

## 1.6 (예정, 🙈 눈치 모드 #51)
- 모드 인스턴스 훅(선택, 내장 모드만): `nunchi(ev, opts)` — `"leave"`(Promise, 퇴장이 끝나면) · `"hide"` · `"arrive"`(`{ long, say }`), `nunchiOrder()` → 눈치 화면 행 순서(sid 배열). 없으면 코어가 블라인드만
- `ctx.nunchi = { on, phase }`(@trusted), 코어 이벤트 `"nunchi"` `{ on, phase }`, `ctx.settings.nunchi`·`setNunchi`(@trusted)
- 앱 설정 `AppSettings.nunchi?`·`nunchiKey?`(전역, 기본 맥 `"Control+KeyQ"` · 그 밖 `"Alt+Backquote"`)·`nunchiGlobal?`(기본 true)·`nunchiLong?`·`nunchiTheme?`(`"system" | "light" | "dark"`).
- `Core.muxName(s)`(core-lib 순수 함수): 멀티플렉서(cmux·Orca)에서 연 세션이면 표시 이름, 아니면 "" — 스튜디오·눈치 화면이 같은 판단으로 이동 버튼을 띄움. 내부 `CoreApi.nunchiStatus?()`(코어 전용·앱 메인 창만) → `{ key, ok, err }`. 외부 모드 브리지에는 없음
- 모드 인스턴스 훅(선택) `contextTitle(sid)` → 앱 우클릭 메뉴 제목 줄(스튜디오 = 직원 이름표). 내부 `CoreApi.contextMenu?(sid, title)`·`menuAction?(id)`(코어 전용, 메인·위젯 창)
- 창 안 단축키 ⌘1(맥)/Ctrl+1 = 눈치 모드, ⌘2/Ctrl+2 = 미니 보기 추가(샌드박스 SDK가 키 `"nunchi"`·`"mini"`로, ⌘,는 `","`로 호스트에 넘김 — 브리지 `key` 허용 목록에 추가).
  SDK 우클릭 → 브리지 `ctxmenu`(앱이면 같은 앱 메뉴, 입력란 제외). 키 판정은 반복(`repeat`) 무시·물리 키(`code`) 기준
- 단축키 `B`의 의미 변경: 업무 모드 ↔ 직전 모드 → 눈치 모드 켜고 끄기(모드는 여전히 이 키를 쓰지 말 것). state 계약 변화 없음

## 1.7 (예정, 질문 판정 jhkwim/waitscape#118)
- state: `session.ask?: "permission" | "question"` (추가만) — `needs_input`일 때 질문 종류. 없으면 모름(옛 Claude Code·트랜스크립트·MCP)
- state: 훅 세션도 `confidence: "guess"`가 될 수 있음 — 권한 요청(PermissionRequest)만 오고 아직 알림으로 확인 전. 10초 안에 확인이 없으면 `working`으로 돌아감
- 의미 보정(버그 수정): 끝난 세션에 오는 Claude의 유휴 알림(`idle_prompt`)은 더 이상 `needs_input`을 만들지 않음. 같은 질문에 알림이 또 와도 `since`는 처음 시각
- 훅 이벤트(events.jsonl): Notification `ntype`, `PermissionRequest`(icon·text·kind, 사람 없는 세션이면 `una`), AskUserQuestion·ExitPlanMode PreToolUse에 `ask`

## 1.9 (예정, 🧪 테스트 배지 jhkwim/waitscape#138)
- state: `session.test?: "pass" | "fail"` (추가만) — 이번 턴의 마지막 테스트 실행 결과(Claude 트랜스크립트의 Bash 테스트 명령 + `is_error`, 거절·차단 제외). 명령 원문 없음
- `InboxItem.test?` (추가만) — 완료 항목에 그 결과를 싣는다
- 완료 OS 알림 본문 앞에 `🧪✓`/`🧪✗`, 눈치 모드 완료 문구 뒤 " · 테스트 통과/실패"

## 1.8 (예정, 관제 인박스 jhkwim/waitscape#126)
- `CoreLib.inboxQueue(sessions, now, seen?)` · `CoreLib.INBOX_KINDS` (추가만) — 지금 사람 손이 필요한 세션 순서(🔑 권한 → ❓ 질문 → 💤 멈춤 → ✉️ 확인 안 한 완료, 같은 종류는 오래 기다린 순). 추정(`confidence: "guess"`)·idle은 넣지 않음. 외부 모드도 씀
- `Core.inbox` (@trusted, 코어가 본 항목을 기억): `list()` · `go()`(N) · `skip()`(Shift+N) · `mark(sid)`. 이벤트 `inbox`(목록이 바뀜) · `inbox-go`(N으로 고른 항목 — 모드가 그 직원을 보여 줌)
- 호스트 단축키에 **N**(다음으로 이동)·**Shift+N**(건너뛰기) 추가 — 외부 모드 iframe 안에서 눌러도 SDK가 넘긴다. 모드는 N을 따로 쓰지 말 것
- 같은 세션의 질문 알림(소리·OS 알림)은 10분에 한 번. `input` 이벤트는 그대로 매번
- (코어 전용, #128) 설정 `AppSettings.inboxKey`·`inboxGlobal`, 내부 `CoreApi.nunchiStatus(which?)`·`nunchiRetry(which?)`(`"inbox"`). 모드 계약 변화 없음

## (코어 전용, cmux AppleScript 이동 jhkwim/waitscape#102)
- 내부 `CoreApi.openTerminal?()` 결과에 `"mux-perm"` 추가(코어 전용): cmux 소켓이 막혀 AppleScript로 가려 했는데 macOS 자동화 허용이 없음 → cwd 복사. 모드 계약(state·ctx·브리지) 변화 없음

## (코어 전용, 오픈소스 라이선스 jhkwim/waitscape#9)
- 내부 `CoreApi.openLicenses?()` 추가(코어 전용·앱 메인 창만): Tauri `open_licenses` — 번들에 든 `THIRD_PARTY_LICENSES.html`을 기본 브라우저로 연다. 모드 계약(state·ctx·브리지) 변화 없음

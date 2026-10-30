# ARCHITECTURE — 데스크톱 앱(Tauri 2) + 모드 플랫폼 v1

> 상태: **P0·P1·P2·P3 구현됨**(P3는 macOS에서 검증), P4 이후 설계 · 작성일 2026-10-21 · 구현 메모: P2 §8.1 · P1 §8.2 · P3 §8.3
> 범위: 현재의 "Python 서버 + 브라우저 탭" 대시보드를 **맥·윈도우용 데스크톱 앱**으로 옮기고, 모드를 **외부에서 만들어 설치할 수 있는 플랫폼**으로 만든다.
>
> 표기: **[확인]** 공식 문서·코드에서 확인한 사실 · **[추정]** 경험·간접 근거에 기반한 판단 · **[PoC]** 구현 초기에 작은 실험으로 확인해야 하는 항목

---

## 0. 요약 — 핵심 결정

1. **Rust 워크스페이스**: `crates/wr-core`(server.py 이식: 읽기·state·trace·한도·마스킹) + `crates/wr-hook`(초경량 훅 CLI) + `crates/wr-server`(브라우저용 HTTP, 선택) + `app/src-tauri`(Tauri 셸). 크레이트 이름에 `core`를 그대로 쓰지 않는다(Rust 표준 `core`와 충돌).
2. **훅은 선택**: 기본은 트랜스크립트만 읽는다. 훅을 켜면 "입력 필요"·서브에이전트·할 일이 정확해진다. 두 소스를 세션 단위로 병합하고, 각 세션에 `source`를 표시한다.
3. **데이터 전달은 push 방식**: 데스크톱 앱에서는 Rust가 파일을 감시(디바운스 150ms)하고 2초마다 tick을 돌려 state가 바뀔 때만 `state` 이벤트를 보낸다. 브라우저에서는 지금처럼 1초 폴링한다. 프론트는 `Core.api` 하나만 본다.
4. **OS 알림·상태 전이 감지는 백엔드가 담당**: 창이 닫혀 트레이만 남아도 알림이 한 번만, 확실하게 간다.
5. **모드 = 폴더 + `mode.json`**: 내장 6개도 같은 형식으로 바꾸고 `MANIFEST` 하드코딩은 없앤다. 앱 번들에 든 내장 모드와 사용자 모드 폴더를 자동으로 찾는다.
6. **신뢰 경계**: 내장 모드는 메인 문서에서 바로 실행한다. 외부 모드는 **`sandbox="allow-scripts"` iframe + 별도 스킴(`wrmode:`) + CSP `connect-src 'none'`**에서 돌리고, postMessage 브리지로 `ctx`의 일부만 쓴다. 권한은 `mode.json`의 `needs`로 선언한다.
7. **공개 계약**: `types/state.d.ts`·`trace.d.ts`·`mode.schema.json`을 API v1로 고정한다. 하위 호환을 지키는 동안은 minor만 올리고, major는 브리지 어댑터로 한 세대 더 지원한다.
8. **한도 조회**: PokeTokenBar 방식을 따른다(`.credentials.json` 우선, 맥 키체인은 사용자가 버튼을 눌렀을 때만, 120초 폴링, 429 지수 백오프, refresh 안 함). 기본값은 꺼짐이고 첫 실행 때 동의를 받는다.
9. **배포**: GitHub Actions로 macOS universal `.dmg`와 Windows NSIS `.exe`·`.msi`를 만든다. 처음엔 미서명(맥은 ad-hoc)으로 내고 우회 안내문을 붙인다. 공증·서명·자동 업데이트는 2단계로 미룬다.
10. **Rust 없이 지금 할 수 있는 일**: 계약(타입·스키마), fixture와 Python 골든 스냅샷, `Core.api`, 모드 패키지 전환, 샌드박스 브리지, Safari(WebKit) 호환성 점검, 폰트 번들, 개인 흔적 제거, CI 초안.

---

## 1. 현재 구조 분석 (as-is)

| 파일 | 역할 | 이식 시 주의 |
|---|---|---|
| `hook.py` (97줄) | 훅 stdin → 요약 이벤트 1줄을 `~/.claude/waiting-room/events.jsonl`에 append | 프롬프트 60자를 **마스킹 없이** 기록함 (§7) |
| `server.py` (768줄) | `build_state()`: events.jsonl 끝 5000줄을 **매 요청마다 전부 다시 파싱**. `scan()`: 트랜스크립트를 오프셋 캐시로 증분 읽기(토큰·마지막 발화·실행 중 도구). `build_trace()`: 흐름 모드용 단계·레인·phase·claim, 버전 커서 증분. `redact()/clip()` 마스킹 | 상태 기계가 **훅 이벤트에 의존**함(status·needs_input·todos·agents). 트랜스크립트만으로 동작하려면 새 판정 로직이 필요(§2.3) |
| `statusline_tap.py` | statusline stdin의 `rate_limits`·컨텍스트%를 저장 | 사용자가 따로 설정한 statusline 연결에 의존함 → 앱에서는 기본 경로에서 뺀다(§3.7) |
| `usage_poll.py` | 키체인 토큰으로 `/api/oauth/usage` 조회 | macOS `security` 명령에 의존함 |
| `core.js` (474줄) | 폴링, 시계 보정, 전이 감지(소리·Notification), 메모, 한도 순수 함수, 모드 레지스트리·지연 로딩·CSS 교체 | `fetch('/state')`가 하드코딩돼 있음. `MANIFEST`도 하드코딩. 숫자키 순서가 MANIFEST에 묶여 있음 |
| `modes/*.js|css` (6개, 약 5천 줄) | `Core.registerMode` 플러그인 | `flow.js`가 `fetch('/trace')`를 직접 부름. `pocket.js`는 Document PiP를 씀(WebKit에 없음). `hamster.css`는 외부 CDN 폰트를 `@import`함 |

모드가 실제로 쓰는 API(grep 집계): `ctx.memo`(30), `ctx.now`(21), `ctx.settings`(20), `ctx.on`(19), `ctx.after`(15), `C.store`(14), `ctx.switcher`(13), `ctx.listen`(12), `ctx.notif`(10), `ctx.every`(8), `C.sessionStatus/limits/limitNote/summary/stalls/isActive/hash`, `C.mount`(pocket PiP), `ctx.audio`, `ctx.loop`. 이 집합을 **ctx v1의 최소 표면**으로 삼는다.

---

## 2. 전체 구조 (to-be)

### 2.1 저장소 레이아웃

```
claude-waiting-room/
├─ Cargo.toml                 # [workspace] members = crates/*, app/src-tauri
├─ crates/
│  ├─ wr-core/                # lib: server.py 이식 + 트랜스크립트 전용 엔진 + 한도 + 마스킹 + 훅 설치 로직
│  │  └─ src/{paths,events,transcript,state,trace,phase,redact,limits,credentials,hooks_config,engine}.rs
│  ├─ wr-hook/                # bin "wr-hook": stdin → events.jsonl append (의존성: serde_json만)
│  └─ wr-server/              # bin "wr-server": 브라우저용 127.0.0.1 HTTP (/state, /trace, 정적, 외부 모드)
├─ app/
│  └─ src-tauri/              # Tauri 셸: 명령·이벤트·트레이·창·커스텀 프로토콜·설정·앱 안 업데이트(updater.rs)
│     ├─ tauri.conf.json
│     └─ capabilities/{main.json,widget.json}
├─ web/                       # 프론트(빌드 없는 순수 JS 유지). Tauri frontendDist, wr-server 정적 루트
│  ├─ index.html  widget.html  manager.html
│  ├─ core/{core.js,core-lib.js,api.js,bridge-host.js,core.css}
│  ├─ sdk/mode-sdk.js         # 샌드박스 iframe 안에서 Core/ctx를 흉내 내는 SDK (외부 모드용)
│  ├─ modes/<id>/{mode.json,mode.js,mode.css,icon.svg}
│  └─ fonts/                  # Galmuri11, Jua (OFL) 번들
├─ types/                     # 공개 계약 (API v1) — P0: state.d.ts, trace.d.ts 작성됨
│  ├─ state.d.ts  trace.d.ts  ctx.d.ts
│  └─ state.schema.json  trace.schema.json  mode.schema.json   # d.ts에서 생성
├─ fixtures/{fixture.json, cases.json, fake_secrets.json, make_fixtures.py, input/, expected/, transcript-only/}   # P0 작성됨
├─ templates/mode-starter/    # 모드 템플릿
├─ scripts/{snapshot.py, compare.py, check_transcript_only.py}  (P0) + {version.py, make_latest_json.py} (릴리스) + tools/{dev.ts, gen-schema.ts, parity.ts}
├─ CHANGELOG.md  docs/{INSTALL.md, RELEASE.md}
├─ legacy/python/             # server.py hook.py usage_poll.py statusline_tap.py (P1 동등성 검증 끝나면 이동)
└─ .github/workflows/{ci.yml, rust.yml, release-prep.yml, release.yml}
```

### 2.2 `wr-core` 모듈과 server.py 대응

| 모듈 | 내용 | server.py 원본 |
|---|---|---|
| `paths` | Claude 설정 루트(`CLAUDE_CONFIG_DIR`가 있으면 그것 [추정: 지원 여부 PoC], 없으면 `~/.claude`), 프로젝트 폴더, 이벤트 로그, 앱 데이터 폴더 | `LOG`, `PROJECTS`, `STATUS` |
| `events` | events.jsonl **증분 읽기**(오프셋 + 파일 크기 감소 시 재시작). 최근 N줄 링버퍼 | `build_state()` 앞부분 (지금은 매번 전체 readlines) |
| `transcript` | 줄 단위 이어 읽기 캐시(LRU 64개), 불완전한 마지막 줄 보류 | `scan()`, `tr_scan()` |
| `state` | 세션 상태 기계, 토큰(메시지 id로 중복 제거), health(SLOW/STALL), today 집계, limits 병합 | `build_state()`, `add_tokens()`, `health()`, `track_agent()` |
| `trace` / `phase` | 단계·레인·커서·older bins, phase 다수결, claim 휴리스틱 | `build_trace()`, `tr_phases()`, `_tool_step()` |
| `redact` | `SECRET`/`BEARER`/`SECRET_KV` 정규식과 `clip()` (마스킹 → 경로 축약 → 절단 순서 유지) | `redact()`, `clip()` |
| `limits` + `credentials` | 사용량 API 클라이언트, 토큰 소스, 백오프 상태 | `usage_poll.py` |
| `hooks_config` | settings.json 백업·병합·제거 (앱과 CLI가 같이 씀) | (신규. README의 수동 절차를 자동화) |
| `engine` | 위 모듈을 묶는 `Engine { fn state(&mut self, now) -> State; fn trace(&mut self, q) -> Trace }`. 시계를 주입할 수 있음(테스트용) | — |

주요 의존성(예정): `serde`/`serde_json`, `regex`, `time`(ISO 파싱), `notify`(파일 감시, 앱에서만), `ureq`+`rustls`(한도 조회), `dirs`, macOS 전용 `security-framework`(키체인). HTTP 서버(`wr-server`)는 `tiny_http`로 간단히 시작한다(server.py와 같은 동기 모델). [추정: SSE가 필요해지면 axum으로 교체]

### 2.3 두 데이터 소스: 트랜스크립트(기본) + 훅(선택)

지금 상태 기계는 훅 이벤트가 있어야 돈다. 앱 기본값인 "훅 없이"를 지원하려면 **트랜스크립트만으로 상태를 정하는 판정**을 새로 설계해야 한다. 이 프로젝트에서 동작이 새로 생기는 유일한 영역이므로 fixture로 따로 검증한다.

| 필드 | 훅 있음 (현행) | 트랜스크립트만 (신규) |
|---|---|---|
| 세션 발견 | events의 sid | `projects/*/*.jsonl` 중 mtime이 6시간(STALE) 안인 것 |
| `working` | UserPromptSubmit / PreToolUse | 마지막 의미 있는 줄이 사용자 프롬프트나 tool_result이거나, 대기 중인 tool_use가 있음 |
| `done` | Stop | 마지막 assistant의 `stop_reason == "end_turn"`이고 대기 중인 tool_use 없음 |
| `needs_input` | Notification 훅 (정확) | **정확히 알 수 없음** [추정: 권한 프롬프트는 트랜스크립트에 남지 않음]. 휴리스틱 `needs_input?`: 권한이 필요할 수 있는 도구(Bash/Edit/Write/WebFetch/MCP)의 tool_use가 N초(기본 8초) 넘게 결과 없이 대기 → `confidence: "guess"`로 표시. 알림은 "확인 필요할 수도" 문구로 약하게 |
| `ended` | SessionEnd | 판정 불가 → done 5분 뒤 idle, 6시간 뒤 숨김 |
| agents | SubagentStart/Stop | `<sid>/subagents/agent-*.jsonl` + `*.meta.json`(이미 trace에서 씀) |
| todos | TodoWrite·TaskCreate·TaskUpdate | 같은 tool_use input을 트랜스크립트에서 읽음 |
| activity/trail/kinds | 훅의 요약 | tool_use에 `describe()`/`KINDS` 이식본 적용 |
| 터미널 힌트 | 훅이 env를 기록 (§3.6) | 없음 → "폴더에서 터미널 열기"로 대체 |

> 에이전트: SubagentStop이 누락돼 running으로 남은 에이전트는, 마지막 활동(훅 `last`와 에이전트 트랜스크립트 마지막 기록 중 늦은 것)이 STALE(6시간, 세션 숨김과 같은 상수)보다 오래되면 `status:"done"` + `stale:true`(`ended` = 마지막 활동)로 내려가 멈춤 판정·running 집계에서 빠진다. 토큰 집계는 유지. server.py `expire_agents`, Rust `expire_agents`/`agent_stale`(트랜스크립트 전용은 tonly.rs)가 같은 규칙.

병합 규칙: 세션별로 **최근 10분 안에 훅 이벤트가 있으면 훅이 정한 status·note·todos·agents가 우선**하고, 토큰·발화·health·도구 상세는 언제나 트랜스크립트에서 가져온다. state에 `session.source: "hook" | "transcript"`와 전역 `hooks: { installed, last_event_age }`를 추가한다(하위 호환 필드 추가 = minor).

### 2.4 Python 코드의 운명

- **P1 동안**: `server.py`를 **참조 구현(oracle)**으로 둔다. P0의 보안 수정(§7.3 마스킹·Host 검사) 이후로는 코드를 고치지 않고 `scripts/snapshot.py`가 `server` 모듈을 import해서 `time`을 가짜 시계로 몽키패치한 뒤 `build_state()`·`build_trace()` 결과를 JSON으로 덤프한다. 서버(7777)는 띄우지 않는다.
- **동등성 검증**: `fixtures/input/` + `fixtures/cases.json`(합성 데이터만. 실제 트랜스크립트는 개인정보라서 커밋하지 않음)을 순서대로 실행해
  `snapshot.py → fixtures/expected/*.json` ↔ `cargo test -p wr-core`(같은 입력, 같은 `now`, `TZ=Asia/Seoul`)의 출력을 **정규화한 JSON으로 비교**한다(키 정렬, 부동소수 1e-6 허용, cursor는 `gen.prompt`만. `scripts/compare.py`).
  시나리오 예: 단일 세션 완료, 서브에이전트 병렬, 입력 필요, 멈춤 의심(도구/모델), 파일 잘림(크기 감소), 불완전한 마지막 줄, 마스킹 문자열 모음, 600단계 초과(older bins), 증분 커서(since).
- **P1 완료 후**: `legacy/python/`으로 옮기고 README에서 "개발용·비권장"으로 표기한다. 한 릴리스 뒤에 삭제한다. 브라우저로 쓰고 싶은 사용자는 `wr-server`를 쓴다.
- 트랜스크립트 전용 엔진(§2.3)은 Python에 없는 기능이라 골든은 손으로 쓴 기대값으로 만든다.

---

### 2.5 프로바이더 플랫폼 (P1에서 구조 도입, Claude만 구현)

Claude 외 AI 코딩 도구(Codex CLI, Gemini CLI, OpenCode, Cursor 등)도 붙일 수 있게 `wr-core`의 데이터 소스를 **프로바이더(어댑터)**로 나눈다.

```
wr-core
├─ 공통: model(계약 타입) · redact/text(마스킹·절단) · health(멈춤 판정 틀) · trace(단계 보정·600 제한·커서)
│        · limits(주기·백오프·비밀 래퍼) · modes · clock/paths/jsonl · engine(프로바이더 합치기)
├─ provider.rs   trait Provider { info() → {id, name, capabilities}; watch_paths(); snapshot(ctx) → 세션·오늘 집계·한도;
│                                 trace(ctx, q) → Option; set_polled(p); gc() }
├─ providers/claude/   트랜스크립트 형식, 훅 이벤트(유령 에이전트 필터, Stop 누락 에이전트는 6시간 뒤 정리), 트랜스크립트 전용 판정, oauth usage, statusline 탭
└─ providers/mcp.rs    MCP 보고 리더(reports.jsonl) — 훅 없는 CLI(Codex·Antigravity 등) 세션 + Claude 사이드카 보고(orphans → 엔진이 붙임) (§8.5)
```
- 출력: 세션마다 `provider`(예: `"claude"`), 최상위 `providers: [{id, name, icon?, capabilities: {subagents: true, …}}]`(@since 1.1, optional).
  기능이 없으면 키가 없고 모드는 그 UI를 숨긴다(`types/state.d.ts` `ProviderCapability`). 동등성 비교는 이 두 필드만 무시한다(`compare.py --ignore provider,providers`).
- 엔진은 프로바이더 결과를 **합치기만** 한다: 세션은 sid(+provider)로 정렬, 오늘 집계는 더하기, 한도(`limits*`·`poll`)는 처음으로 한도를 내는 프로바이더 것.
  /trace는 앞에서부터 `Some`을 돌려주는 프로바이더(현재 Claude만).

**외부(커뮤니티) 프로바이더 확장 — 설계만, 미구현**

| 방식 | 내용 | 장점 | 단점 |
|---|---|---|---|
| 내장(Rust 모듈) | `providers/<id>/`에 구현, 앱과 같이 배포 | 빠름, 같은 테스트·마스킹 보장 | 우리가 리뷰·배포해야 함 |
| **외부 프로세스 (추천)** | 아무 언어의 실행 파일이 **정규화 이벤트를 JSON Lines로 stdout**에 낸다(LSP처럼 `{"v":1,"type":"hello","id","name","capabilities"}` → `session`/`status`/`tool`/`tokens`/`agent`/`limits` 이벤트). `wr-core`의 `ExternalProvider`가 프로세스를 띄워 줄을 읽고 공통 모델로 쌓는다. 요청이 필요하면 stdin으로 `{"type":"trace","session":…}` | 언어 무관, 크래시가 앱을 안 죽임, 기존 CLI 로그 파서를 그대로 재사용 | 프로세스 관리·버전 협상 필요 |
| WASM(향후) | `wasmtime` 등으로 샌드박스 실행, 파일 읽기는 호스트가 허용한 경로만 | 진짜 샌드박스(권한 최소) | 런타임 크기, 파일 감시·증분 읽기 API를 따로 설계해야 함 |

- 보안: 외부 프로세스는 **사용자 권한 그대로** 실행된다(파일·네트워크를 다 쓸 수 있음 — 샌드박스가 아님). 그래서 ① 설치·첫 실행 때 명시적 동의(경로·명령·요청 기능 표시) ② 셸 없이 인자 배열로 실행 ③ 환경변수 화이트리스트로 전달(토큰 계열 제거) ④ 받은 텍스트는 우리 `redact()`를 다시 거침 ⑤ 줄 크기·속도 제한(예: 줄 256KB, 초당 200줄), 응답 없으면 종료 ⑥ 기본 꺼짐. 강한 격리가 필요해지면 WASM으로 간다.
- 이벤트 스키마는 `types/provider-events.d.ts`(예정)로 고정하고 버전 정책은 Mode API와 같은 major.minor.

## 3. 프론트 데이터 계층과 Tauri 셸

### 3.1 `Core.api` 추상화

core.js의 `fetch("/state")`와 flow.js의 `fetch("/trace")`를 아래 인터페이스 하나로 바꾼다. 구현체는 런타임에 고른다.

```ts
interface CoreApi {
  kind: "tauri" | "http";
  subscribe(onState: (s: State) => void): () => void;   // tauri: listen("state") + 최초 invoke("get_state") / http: 1초 폴링
  trace(q: { session: string; prompt?: number | "last"; since?: string }, signal?: AbortSignal): Promise<Trace>;
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<void> };  // http: 읽기 전용(기본값)
  notify?(title: string, body: string): void;            // tauri: 백엔드 경유 / http: Web Notification
  openTerminal?(sid: string): Promise<"focused" | "opened" | "unsupported">;  // tauri 전용
  openWidget?(modeId: string): Promise<void>;            // tauri 전용 (PiP 대체)
  modes(): Promise<ModeInfo[]>;                          // 발견된 모드 목록 (§4.2)
}
```
- 판별: `window.__TAURI_INTERNALS__`가 있으면 tauri, 없으면 http. [추정: Tauri 2는 전역 `__TAURI__` 노출이 기본 꺼져 있음. `withGlobalTauri` 대신 내부 객체로 판별하거나 `@tauri-apps/api`를 벤더링]
- `ctx.api`로 모드에 노출하는 것은 `trace`뿐이다(권한 `needs: ["trace"]`). 나머지는 코어가 쓴다.

### 3.2 폴링 vs push — **push 채택(앱), 폴링 유지(브라우저)**

| | 1초 폴링 (현행) | 백엔드 push (채택) |
|---|---|---|
| 지연 | 평균 0.5초 | 파일 변경 후 약 150ms |
| 유휴 비용 | 초당 events.jsonl 전체 파싱(현행) + JSON 직렬화 | 변경이 없으면 2초 tick 비교만 |
| 창 여러 개(메인·위젯) | 창마다 폴링 | 한 번 계산해서 broadcast |
| 창이 없을 때 알림 | 불가 (페이지가 살아 있어야 함) | 백엔드가 감지해서 OS 알림 |

- 감시 대상: `events.jsonl`(파일), `projects/`(재귀, 확장자 `.jsonl`, `.meta.json`만). macOS FSEvents와 Windows ReadDirectoryChangesW 모두 `notify` 크레이트로 처리한다. [추정: 프로젝트 폴더가 커도 FSEvents는 디렉터리 단위라 부담이 작음 — PoC로 CPU 측정]
- **2초 tick**은 반드시 필요하다. health(조용한 시간)는 파일이 바뀌지 않아도 시간이 지나면 변하기 때문이다.
- 직렬화한 state에서 `now`를 뺀 해시가 직전과 같으면 보내지 않는다. 대신 10초마다 heartbeat를 보낸다.
- trace는 push하지 않는다. 흐름 모드가 켜져 있을 때만 `invoke("get_trace")`로 2초 폴링한다(현행 비용 0 원칙 유지).
- 전이 감지(done/input/stall/memo-ready)는 **백엔드 `engine`이 하고 OS 알림까지 보낸다.** 프론트 `detect()`는 화면 연출용 이벤트만 낸다. 모드별 `texts` 문구는 메인 창이 보일 때만 소리·연출에 쓰고, OS 알림 문구는 기본 문구와 설정의 언어를 따른다.

### 3.3 창 구성

| 창 label | 내용 | 설정 |
|---|---|---|
| `main` | `index.html` (모드 화면) | 닫기 = 숨김(트레이 상주). 크기·위치는 `winpos.rs`(논리 좌표 `window-pos.json`. window-state 플러그인은 배율 2 화면에서 2배로 복원돼 뺐다) |
| `widget` | `widget.html#<모드>` — 위젯 창(PiP 대체). 포켓 또는 스튜디오 미니 보기(mode.json `"widget": true`인 내장 모드). 해시 없으면 마지막 모드 | `alwaysOnTop`, `decorations: false`, `transparent: true`, `skipTaskbar: true`, `visibleOnAllWorkspaces: true`[확인: 창 설정 항목. 플랫폼별 동작은 PoC], 위치만 `winpos.rs`로 복원(크기는 내용 기준), 화면 밖이면 기본 모니터 오른쪽 아래. 드래그는 `data-tauri-drag-region` |
| `manager` | 모드 관리·설정 | 일반 창 |

- [확인] `app.macOSPrivateApi`(투명 창용)는 Tauri 2.12.1부터 no-op이고 해당 API가 항상 켜져 있다. 그 이전 버전에서는 `true`로 켜야 하며, App Store 배포는 불가하다(지금은 직접 배포만. 나중 Mac App Store판은 빌드 플레이버로 준비만 해 둠 — §6.5, docs/RELEASE.md §8).
- 창마다 Core가 따로 돈다(별도 webview). 메모 동기화는 같은 origin의 localStorage `storage` 이벤트로 하고, 설정 변경은 백엔드의 `settings` 이벤트로 퍼뜨린다.
- pocket 모드의 `documentPictureInPicture` 분기는 `ctx.api.openWidget`이 있으면 그걸 쓰도록 바꾼다(브라우저에서는 기존 PiP 유지).

### 3.4 트레이 / 메뉴바

- `TrayIconBuilder`(Tauri 2 코어 `tray-icon` 기능). 아이콘 상태는 기본·작업 중·입력 필요(빨간 점) 3종이다. macOS는 `set_title`로 메뉴바에 `⏳2 ❗1` 같은 텍스트를 띄운다[추정: title은 macOS 전용].
- 메뉴: 세션 목록(상태 아이콘 + 프로젝트 + 경과 시간 → 누르면 터미널로 이동) / 큰 화면 / 미니 보기(체크) / 회의 모드 / 모드 관리… / 설정… / 종료. (구현: [새 버전이 있으면 맨 위 🎁 업데이트 있음] · 큰 화면 · 미니 보기 · 모드 ▸ · 회의 모드 · 🙈 눈치 모드 · 설정… · 종료, 세션 목록은 미구현. 눈치 모드면 메뉴바 요약은 숫자만 `2 · 1`)
- macOS에서 Dock 아이콘을 숨기는 메뉴바 전용 모드(`ActivationPolicy::Accessory`)는 설정으로 둔다(열린 질문 Q6).
- `tauri-plugin-single-instance`로 중복 실행을 막는다. 두 번째 실행은 메인 창을 띄우기만 한다.

### 3.5 알림·자동 시작·설정

- **OS 알림**: `tauri-plugin-notification`. 회의 모드면 OS 알림은 그대로 보내되 소리만 끈다(OS의 집중 모드는 사용자가 정한다). 첫 실행 때 권한을 요청한다. [추정: macOS 미서명 앱도 알림 권한 요청이 가능함 — PoC]
- **자동 시작(선택)**: `tauri-plugin-autostart`(mac LaunchAgent, win 레지스트리 Run). 기본값은 꺼짐.
- **설정 화면**(`manager.html`의 탭):
  - 훅: 상태(설치됨/아님/구버전), [설치] [제거], 마지막 이벤트 시각
  - 사용 한도: 조회 켜기·끄기, 토큰 출처 표시(파일/키체인/없음), [키체인에서 지금 읽기](맥), 마지막 오류
  - 알림: 완료·입력 필요·멈춤 의심 각각 켜기·끄기, 회의 모드, 소리
  - 일반: 자동 시작, 메뉴바 전용(맥), 언어, 이벤트 로그 보관 크기, 업데이트(새 버전 확인 켜기·끄기, [지금 확인]) — §6.4
  - 모드: §4.6
- 백엔드가 알아야 하는 설정은 앱 설정 폴더의 `settings.json`에 두고, 화면 취향(마지막 모드 등)은 지금처럼 localStorage에 둔다.

### 3.6 터미널로 이동 — 가능 범위

훅이 켜져 있으면 `wr-hook`이 `SessionStart`·`UserPromptSubmit`에서 **터미널 힌트**를 함께 기록한다: `TERM_PROGRAM`, `ITERM_SESSION_ID`, `TERM_SESSION_ID`, `WT_SESSION`, 제어 터미널 tty(유닉스는 `/dev/tty`의 ttyname). 모두 로컬 파일에만 남는다.

| 대상 | 방법 | 정밀도 | 근거 |
|---|---|---|---|
| macOS Terminal.app | AppleScript: tty가 일치하는 tab을 `selected`로 바꾸고 창을 앞으로 | 탭 단위 | [추정: Terminal 스크립팅 사전의 `tab.tty` 속성] |
| iTerm2 | AppleScript: `ITERM_SESSION_ID`의 uuid와 같은 `session.id`를 select | 세션(분할 창) 단위 | [추정] |
| VS Code / Cursor 내장 터미널 | `code -r <cwd>`(또는 `open -a … <cwd>`)로 그 폴더 창을 앞으로 | 창 단위(터미널 패널 선택 불가) | [추정] |
| Ghostty / WezTerm / 기타 | 앱 활성화만 | 앱 단위 | [추정] |
| Windows Terminal | 창 활성화(`SetForegroundWindow`). 탭 지정은 공개 API가 없음 | 창 단위 | [추정] |
| 훅 없음 | "이 폴더에서 새 터미널 열기" (mac `open -a Terminal <cwd>`, win `wt -d <cwd>`) | — | [추정] |

**멀티플렉서 어댑터 (#37 cmux · #40 Orca, 구현됨)** — 세션이 멀티플렉서(여러 워크스페이스·패널·터미널을 가진 앱) 안에서 돌면 그 자리로 바로 간다.
- 어댑터 표 하나(`wr-core/src/term.rs` `ADAPTERS` ↔ `mcp_report.py` `MUX`): 종류(kind), 읽을 env(허용 목록)와 필드, **필드별** 형식 검증. 위에서부터 먼저 맞는 줄:
  | kind | env (허용 목록) → 필드 | 형식 |
  |---|---|---|
  | `orca` | `ORCA_TERMINAL_HANDLE` 필수 → `surface`, `ORCA_WORKTREE_PATH` 선택 → `path` | 핸들 = `term_` + UUID 또는 `term_` + 16진수 32자(Orca 1.4 소스의 발급 형식), 경로 = 절대 경로(`/…`, 윈도우 `C:\…`·`C:/…`·UNC `\\server\share…`·`\\?\C:\…`·`\\?\UNC\server\share…` — #61. `C:foo`·`dev\shop` 같은 상대 경로, `\\.\` 장치 경로, `\\?\GLOBALROOT\…`는 아님)·1–1024자·제어 문자 없음 |
  | `cmux` | `CMUX_WORKSPACE_ID` 필수 → `workspace`, `CMUX_SURFACE_ID` 선택 → `surface` | UUID 또는 `workspace:2` 같은 짧은 참조 |

  표에 없는 env(`ORCA_AGENT_HOOK_TOKEN`·`ORCA_AGENT_LAUNCH_TOKEN` 같은 토큰류, `ORCA_WORKTREE_ID`·`ORCA_WORKSPACE_ID`·`ORCA_TAB_ID`·`ORCA_PANE_KEY`, `CMUX_*TOKEN*`, `CMUX_SOCKET_PASSWORD`, 소켓 경로 등)는
  읽지도 기록하지도 않는다. Orca가 먼저인 까닭: cmux 셸에서 Orca를 띄우면 Orca 터미널이 `CMUX_*`를 물려받을 수 있지만 `ORCA_TERMINAL_HANDLE`은 Orca 터미널 안에서만 생긴다.
  다른 앱은 공식 문서·실기기로 env·ID 형식을 확인한 뒤 줄을 더한다.
- 훅(`wr-hook`·`hook.py`)은 모든 이벤트 끝에 `term: {mux: {kind, …필드}}`(cmux `{kind, workspace, surface?}` · Orca `{kind, surface, path?}`)를 붙인다(맞는 값이 있을 때만). MCP 사이드카(`wr-hook mcp`)도 기록 줄마다 같은 `term`.
  리더(`server.py`·wr-core)는 같은 표로 **다시 검증**해 세션 `jump.mux`에 마지막 올바른 값을 둔다(서브에이전트 이벤트 포함, 모르는 kind·키는 버림). 골든 `fixtures/mux/term_cases.json`.
- 앱(`terminal.rs`): 설정이 `auto`이거나 세션 kind와 같으면 kind별 명령 생성 함수(`mux_cmds` → `cmux_cmds` · `orca_cmds`)가 만든 명령을 셸 없이 인자 배열·명령마다 3초 제한으로 실행한다.
  cmux = 번들 CLI(`/Applications/cmux.app/Contents/Resources/bin/cmux`, `~/Applications`도; PATH는 보지 않음) `select-workspace --workspace <w>` → `focus-panel --panel <s> --workspace <w>`
  (실패해도 계속) → `open -a cmux`. 워크스페이스 선택이 실패하면 읽기 전용 `workspace list`로 소켓을 확인해, 되면 앱만 앞으로(`mux-app`, 워크스페이스가 닫힘),
  안 되면 앱 실행 여부(`/bin/ps -axo comm=`에 `<앱>/Contents/MacOS/cmux`가 있는지, 읽기 전용)로 나눠 꺼져 있으면 `mux-off`, 켜져 있는데 막혔으면 `mux-denied`
  (cmux 설정에서 외부 소켓 접근을 막았거나 비밀번호) → 프론트가 경로를 복사하고 이유를 토스트로. CLI가 없거나 모르는 kind면 원래 방식. feature `terminal-jump`를 끄면 없음.
  **Orca** = macOS·Windows(#54). **CLI 찾기**(`orca_find.rs`, 설치 경로와 무관, PATH는 보지 않음) — 위에서부터 처음 검증을 통과한 것:
  1. 실행 중인 Orca 프로세스의 실행 파일 경로. 맥 `/bin/ps -axo comm=`에서 `…/X.app/Contents/MacOS/Orca` → 번들 `X.app` → `X.app/Contents/Resources/bin/orca`.
     윈도우 `…\Orca.exe` → 같은 폴더 `resources\bin\orca.exe`(네이티브 CLI 런처). 윈도우 프로세스 경로는 `tasklist.exe`가 주지 않아
     내장 PowerShell 5.1(`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command`, 고정 스크립트
     `Get-Process -Name Orca`의 `Path`, 출력 UTF-8)로 읽는다. Win32 API(`QueryFullProcessImageNameW`)는 새 크레이트가 없으면 unsafe FFI인데,
     앱 크레이트를 Windows에서 빌드하는 CI가 없어 검증할 수 없으므로 쓰지 않는다(Cargo.lock에 `sysinfo` 같은 프로세스 크레이트도 없음).
  2. 꺼져 있으면 설치 정보. 윈도우 `C:\Windows\System32\reg.exe query HKCU|HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall /s`에서
     `DisplayName`이 `Orca`·`Orca <버전>`인 키의 `InstallLocation`(없으면 `DisplayIcon`·`UninstallString`의 폴더 — electron-builder 설치본).
     맥 `/usr/bin/mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'"`(휴지통·`/Volumes/` 디스크 이미지는 뺌).
  3. 고정 후보: 맥 `/Applications/Orca.app`·`~/Applications/Orca.app`, `/opt/homebrew/bin/orca`·`/usr/local/bin/orca`는 실제 위치가 번들 안 CLI일 때만 그 번들.
     윈도우 `%LOCALAPPDATA%\Programs\orca`(사용자 단위 기본 설치).
  - 공통 검증: 실행 파일 이름이 Orca(대소문자 무관), canonicalize한 앱·CLI가 설치 폴더·번들 안(접두 비교)이고 파일. `orca.cmd`는 cmd 셸을 거치므로 쓰지 않는다.
    조회 명령은 셸 없이 고정 경로·명령마다 5초 제한(PowerShell이 처음 뜰 때 느림). 어디서 찾았는지(프로세스·레지스트리·Spotlight·고정)·못 찾은 이유는 앱 로그(`[orca]`).
  - **앞으로·띄우기**: 맥 `open <찾은 번들>`(Launch Services, 꺼져 있으면 띄움). 윈도우 = 찾은 `Orca.exe`를 인자 없이 실행하고 기다리지 않는다(꺼져 있던 앱을 시간 제한으로 죽이지 않게).
    근거: Orca 본체(`out/main/index.js`)가 `app.requestSingleInstanceLock()` + `second-instance` → `requestDesktopActivation` → 기존 창 복원·`focus({steal})`,
    win32면 `moveTop()`·잠깐 `setAlwaysOnTop`으로 앞으로 가져온다. CLI의 `orca open`("Launch Orca and wait for the runtime")도 내부에서 같은 실행 파일을 다시 띄울 뿐이고
    (`runtime/launch.js` `launchOrcaApp`), 꺼져 있으면 최대 15초 기다려 3초 제한에 걸리며 시간 초과 정리(자손까지)가 막 띄운 앱을 죽일 수 있어 쓰지 않는다. 포커스 전용 CLI 명령은 없다.
  ① `orca terminal switch --terminal <핸들> --json` 성공(종료 코드 0이고 JSON `ok`가 false가 아님) → 앱을 앞으로(`mux`).
  ② 실패(Orca를 다시 켜면 핸들이 바뀜 · `terminal_handle_stale`)면 읽기 전용 `orca status --json`으로 나눈다:
  런타임에 닿으면(`runtime.reachable`) 경로가 있을 때 읽기 전용 `orca terminal list --worktree path:<경로> --json`에서 아래 규칙으로 하나 골라 switch → 앱을 앞으로(`mux`),
  못 고르면 앱만 앞으로(`mux-app`, "Orca에서 터미널을 찾지 못함"). 앱이 꺼져 있으면(`app.running: false`) 앱만 띄우고(`mux-launch`), 그것도 안 되면 `mux-off`.
  켜져 있는데 런타임에 닿지 않거나 상태를 못 읽으면 `mux-denied`. `mux-off`·`mux-denied`는 프론트가 경로를 복사하고 이유를 알린다.
  **Orca 다시 찾기 규칙**(`orca_pick`): `result.terminals[]` 중 ① 핸들 형식이 맞고 원래(만료된) 핸들이 아님 ② `worktreePath`가 세션 경로와 같음(끝 `/` 무시. 윈도우 형태 경로는 `/`→`\`, `\\?\`·`\\?\UNC\` 접두사 제거, 끝 `\` 무시, 대소문자 무시)
  ③ `connected: true`. 그중 ④ 에이전트가 도는 창(`agentIdentity` 있음) 먼저 ⑤ `lastOutputAt`이 가장 늦은 것 ⑥ 같으면 목록 앞쪽. `send`·`create` 같은 상태를 바꾸는 명령은 쓰지 않는다.
  설정의 터미널 앱 목록에는 Orca가 없다(Orca 세션은 `auto`일 때 Orca로, 다른 앱을 고르면 원래대로). cmux는 macOS만, Orca는 macOS·Windows(`route`).
  `open_terminal` 명령은 async + `spawn_blocking`(최대 몇 초 걸려도 UI 스레드를 막지 않음). 시간 초과 때 unix는 자식을 새 프로세스 그룹으로 띄워 `killpg`로 자손까지 끝낸다.
  Windows는 `C:\Windows\System32\taskkill.exe /T /F /PID <자식>`으로 자손까지(Orca CLI 런처가 Electron Node를 띄움). Job Object FFI는 앱 크레이트를 빌드하지 않는 Windows CI로 검증할 수 없어 쓰지 않는다.
  Windows에서는 자식(CLI·PowerShell·reg·taskkill)을 `CREATE_NO_WINDOW`로 띄워 콘솔 창이 깜빡이지 않게 한다(GUI 앱 `Orca.exe`는 제외). 출력은 UTF-8이 아닌 바이트를 �로 바꿔 읽는다(`reg.exe`는 시스템 코드 페이지).
- MCP 세션: Codex는 연결 블록 `env_vars`(문서: "Environment variables to allow and forward")에 표의 env 이름을 **더한다**(§8.5). 사용자가 넣어 둔 항목(문자열·`{name, source}` 표)은
  순서 그대로 두고 없는 이름만 붙이며, 더한 이름만 연결 기록(`env_added`, 키를 만들었으면 `env_created`)에 남겨 해제 때 그것만 뺀다. `env_vars`에 표의 이름(지금 Orca 두 개·cmux 두 개)이 다 없으면
  (PR #36 때 연결 · Orca 전에 cmux 두 이름만 넣은 연결) 상태를 Stale로 보고 설정 화면에 "다시 연결" 버튼·안내를 띄운다. Antigravity는 고정 값 `env`만 있어 넣지 않는다.
- 외부(샌드박스) 모드에는 `jump`를 넘기지 않는다(브리지 UNSTABLE).
- 스튜디오(앱): 질문 중·일을 마친 직원, 완료 배너·로비 완료 보고 말풍선 말고도 **일하는 중**에 그 직원의 층 이름표·단계 명패(미니 보기는 이름표 칩)를 누르면 이동한다
  (멀티플렉서 세션은 그 자리, 아니면 폴더 열기). 직원 캐릭터·모니터를 누르는 반응(POKE)은 그대로다(모니터 연타 이스터에그가 다른 앱으로 넘어가지 않게 모니터는 이동하지 않음). 마우스를 올리면 하단 캡션(로비는 하단 자막)에
  "🖥️ Orca로 이동"·"🖥️ cmux로 이동"·"🖥️ 터미널로 이동"(title 툴팁 없음). 연타해도 2초에 한 번.

- macOS는 처음 쓸 때 "자동화(Apple Events)" 권한 창이 뜬다. Info.plist에 `NSAppleEventsUsageDescription` 문구를 넣는다.
- 셸 명령을 문자열로 조립하지 않는다. `std::process::Command`에 인자 배열로 넘기고, AppleScript에는 값을 인자(`on run argv`)로 전달한다(인젝션 방지).

### 3.7 사용 한도 조회 (PoC 결과 반영)

| 항목 | 정책 |
|---|---|
| 요청 | `GET https://api.anthropic.com/api/oauth/usage`, 헤더 `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: <앱이름>/<버전>`. 본문 없음 [확인: PokeTokenBar·현 usage_poll.py] |
| 응답 사용 | `five_hour`·`seven_day`(·`extra_usage`)의 `{utilization, resets_at(ISO)}`만 쓴다 → 현행 `limits` 형태(`used_percentage`, `resets_at` epoch)로 변환 |
| 토큰 출처 | ① `<claude루트>/.credentials.json`의 `claudeAiOauth.accessToken`(`expiresAt`가 지났으면 쓰지 않음) ② **macOS 키체인 "Claude Code-credentials"는 사용자가 [키체인에서 읽기]를 눌렀을 때만** 읽는다(암호 창 방지). 읽은 토큰은 메모리에만 두고 `expiresAt`까지 재사용한다 |
| 주기 | 120초. 429면 `Retry-After`를 우선하고, 없으면 2·4·8…분, 최대 60분 지수 백오프. 401/403이면 토큰 무효로 보고 중단한 뒤 "다시 읽기" 안내 |
| 실패 시 | 한도 UI만 숨긴다(`limits: null`, `poll.err`에 사유 코드). 다른 기능에는 영향 없음 |
| 하지 않는 것 | 토큰 refresh, 토큰의 디스크·로그 기록, 토큰을 프론트로 전달 |
| statusline 탭 | 기본 경로에서 뺀다. 고급 옵션으로 `wr-hook statusline --wrap "<기존 명령>"`(stdin을 기존 statusline에 넘기고 출력은 그대로 통과시키면서 rate_limits만 저장)을 v1.1 후보로 둔다 |

참고: 이 맥에는 `~/.claude/.credentials.json`이 **없다**(확인). macOS 사용자는 대부분 키체인 경로를 타게 되므로 첫 실행 온보딩에서 "키체인에서 한 번 읽기(암호 창이 뜰 수 있음, '항상 허용' 권장)"를 안내한다.

---

## 4. 모드 플랫폼 v1 (핵심)

### 4.1 모드 패키지 형식

```
<id>/
├─ mode.json        필수
├─ mode.js          entry (Core.registerMode 호출)
├─ mode.css         선택
├─ icon.svg|png     선택 (없으면 icon 이모지)
└─ assets/…         선택 (폰트·이미지·소리. 같은 패키지 안의 상대 경로로만 참조)
```

```jsonc
// mode.json (스키마: types/mode.schema.json)
{
  "id": "board",                    // ^[a-z0-9][a-z0-9-]{0,31}$, 전역 고유. 내장 id와 겹치면 설치 거부
  "name": "전광판",                  // 또는 { "ko": "전광판", "en": "Scoreboard" }
  "icon": "🏟️",                     // 이모지 또는 패키지 안 파일 경로
  "version": "1.2.0",               // semver
  "apiVersion": "1.0",              // 이 모드가 기대하는 최소 Mode API (major.minor)
  "entry": "mode.js",
  "styles": ["mode.css"],
  "author": { "name": "…", "url": "…" },
  "description": "스포츠 중계 LED 전광판",
  "license": "MIT",
  "needs": ["trace", "memo"],       // 권한 선언 (§4.4)
  "chimeWave": "square",            // 선택: 기존 registerMode 옵션을 정적으로도 선언 가능
  "widget": false                   // 선택: 위젯 창으로 띄울 수 있는 모드인가 (v1은 내장만)
}
```
- `mode.js`의 `registerMode({ id, mount })`에서 `id`는 mode.json과 일치해야 한다. `label`·`icon`은 mode.json이 우선한다.
- **내장 6개 전환**: `modes/hamster.js` → `web/modes/hamster/{mode.json,mode.js,mode.css}`. 코드 변경은 ① `fetch('/trace')` → `ctx.api.trace` ② pocket PiP 분기 ③ hamster.css의 CDN `@import` → `@font-face url(../../fonts/…)` 정도다.

### 4.2 발견·로딩

| 출처 | 위치 | 신뢰 |
|---|---|---|
| 내장 | 앱 리소스 `web/modes/*/mode.json` (빌드 때 `modes/index.json` 생성) | trusted (메인 문서에서 직접 실행) |
| 사용자 | **앱 데이터 폴더 `modes/`**(추천, Q3): mac `~/Library/Application Support/<identifier>/modes/`, win `%APPDATA%\<identifier>\modes\`. 대안은 `~/.claude/waiting-room/modes/` | external (샌드박스) |
| 개발 | 설정의 "개발 폴더 추가"로 임의 경로를 링크(복사 안 함, 감시함) | external + dev |

- 백엔드 `list_modes`는 각 폴더의 `mode.json`을 스키마로 검증해 `{id, name, icon, version, source, trusted, enabled, needs, compat, error?}`를 반환한다. 깨진 패키지는 목록에 오류와 함께 보이고 실행되지 않는다.
- **순서**: 내장(고정 순서) → 사용자(설치 순). 관리 화면에서 드래그로 바꿀 수 있다(`modeOrder`). 숫자키 1~9와 전환기는 이 목록에서 **자동 생성**한다. `MANIFEST`·`probe()`(HEAD 요청)는 삭제한다.
- `B` 키는 🙈 눈치 모드 토글(#51, 예전에는 내장 `work` 업무 모드 토글 — §8.6).
- 로딩은 지금처럼 **선택될 때 지연 로딩**하고, 바꾸면 완전히 정리한다. 외부 모드는 iframe을 통째로 제거하는 것으로 정리한다(누수 걱정이 오히려 적다).

### 4.3 API 버전 정책

- **Mode API 버전** = `major.minor`이고 앱 버전과 별개다. 시작은 `1.0`.
  - minor: 필드·ctx 함수 **추가**만 한다. state에 새 필드가 생기는 것도 minor다.
  - major: 제거·의미 변경·형식 변경.
- 호환 판정: 모드의 `apiVersion` major == 호스트 major이고 minor <= 호스트 minor면 실행한다. 모드 minor가 더 크면 "앱 업데이트 필요"로 끈다. major가 하나 낮으면(N-1) **브리지 어댑터**로 변환해서 실행한다(외부 모드만. 내장은 항상 최신). 그보다 낮으면 실행하지 않는다.
- deprecated: 문서·`ctx.d.ts`에 `@deprecated`를 달고, 모드가 쓰면 콘솔 경고를 1회 띄운다. 최소 **두 번의 minor** 동안 유지한 뒤 다음 major에서 제거한다. 변경 내역은 `types/CHANGELOG.md`에 남긴다.
- state 필드 안정성: `.d.ts`에서 **stable**(계약)과 `/** @unstable */`(내장 모드 전용, 예고 없이 바뀔 수 있음)로 나눈다. 초안:
  - stable: `now, sessions[].{sid, project, status, since, started, prompt, note, tools, tokens, ctx, todos, agents[].{aid,type,desc,status,since,ended,tokens,health,say,now}, activity, health, say, source}, waited_today, done_today, today_tokens, today_kinds, today_agents, limits, limits_ts, limits_src, poll, hooks`
  - unstable: `trail, kinds, kind, run, last, cwd`(cwd는 개인정보이므로 외부 모드에는 `project`만 준다 — 아래 §4.4)
- trace 스키마(`trace.d.ts`)는 docs/DEVELOPMENT.md의 `/trace` 응답 명세를 그대로 타입으로 옮기고 `needs: ["trace"]` 모드에만 제공한다.

### 4.4 `ctx` v1 명세와 권한

| ctx 항목 | 내장 | 외부(샌드박스) | 권한 |
|---|---|---|---|
| `root, doc, win` | ✅ | ✅ (iframe 자신의 document) | — |
| `state`, `now()`, `on(evt)` (`state, done, input, stall, memo-ready, memo, settings, mode`) | ✅ | ✅ (브리지로 복제) | — |
| `every/after/loop/listen` | ✅ | ✅ (SDK가 iframe 안에서 구현) | — |
| `settings.quiet` (읽기) | ✅ | ✅ | — |
| `settings.setQuiet` | ✅ | ❌ | — |
| `core` 순수 함수(`fmt, limits, summary, …`) | ✅ | ✅ (`core-lib.js`를 SDK에 같이 실음) | — |
| `store.get/set` | localStorage | 브리지 → 모드별 네임스페이스 `mode:<id>:`, 총 256KB 제한 | — |
| `audio()` | ✅ | iframe 자체 AudioContext. 회의 모드면 SDK가 `suspend()` | — |
| `switcher` | DOM 요소 | 호스트가 iframe 밖 오른쪽 아래에 띄움(외부 모드는 위치 지정 불가) | — |
| `api.trace()` | ✅ | ✅ | `trace` |
| `memo.get/set/ready/copy` | ✅ | ✅ | `memo` |
| `notify(title, body)` | ✅ | ✅ (분당 6회 제한, 앞에 모드 이름 표시) | `notify` |
| `clipboard.write(text)` | ✅ | ✅ (사용자 클릭 직후에만) | `clipboard` |
| `notif.request`, `setMode`, `modes()` | ✅ | `setMode`·`modes()`만 | — |
| `openWidget`, `openTerminal`, `C.mount`(추가 document) | ✅ | ❌ (v1 미지원) | — |

- 외부 모드에 넘기는 state는 **브리지에서 정제**한다: `cwd`·`unstable` 필드를 빼고, 텍스트는 이미 백엔드에서 마스킹된 값만 보낸다.
- `ctx.host = { kind: "tauri"|"http", apiVersion: "1.0", trusted: boolean }`를 추가한다.

### 4.5 보안 격리 (외부 모드)

```
메인 webview (tauri://localhost 또는 http://tauri.localhost)        ← Tauri IPC 가능 (capability: main)
 └─ <iframe sandbox="allow-scripts"                                   ← allow-same-origin 없음 → opaque origin
            src="wrmode://localhost/<id>/index.html"  (win: http://wrmode.localhost/<id>/…)
            allow="">                                                ← 권한 정책 전부 차단
       ├─ 호스트가 만든 index.html: CSP + mode-sdk.js + core-lib.js + mode.css + mode.js
       └─ postMessage ⇄ bridge-host.js (메시지 스키마 검증, 권한 확인, rate limit)
```

- **스킴 분리**: `register_asynchronous_uri_scheme_protocol("wrmode", …)`로 **모드 폴더 안의 파일만** 서빙한다(경로 정규화, `..`·심볼릭 링크 거부, 확장자 화이트리스트). [확인] 커스텀 스킴 origin은 mac/linux가 `wrmode://localhost/`, Windows는 `http://wrmode.localhost/`다.
- **응답 헤더 CSP**(모든 응답):
  `default-src 'none'; script-src <wrmode-origin>/<id>/ <wrmode-origin>/_sdk/; style-src <같은 범위> 'unsafe-inline'; img-src <같은 범위> data: blob:; font-src <같은 범위> data:; media-src <같은 범위> blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`
  → 네트워크 요청, 외부 이미지 비콘, 중첩 frame, 폼 전송이 모두 막힌다. sandbox에 `allow-popups`·`allow-top-navigation`이 없으므로 창 열기·상위 이동도 안 된다.
- **IPC 차단**: [확인] CVE-2024-35222 수정(2.0.0-beta.19) 이후 Tauri는 iframe에 IPC 초기화 스크립트를 넣지 않고 invoke key로 하위 frame을 막는다. 단 Windows는 "iframe origin이 창 origin과 같으면" 예외였다. → 별도 스킴 + opaque origin이라 두 조건 모두 해당하지 않는다. capability는 `windows: ["main","widget","manager"]`에만 주고 `remote.urls`는 비운다. [확인] 공식 문서: Linux·Android는 iframe과 창 요청을 구분하지 못한다(우리는 Linux를 대상으로 하지 않음).
- **브리지 규칙**: 호스트는 `event.source === iframe.contentWindow`인 메시지만 받는다(opaque origin이라 `origin`은 `"null"`). 메시지는 `{v:1, id, op, args}` 형식이고 op 화이트리스트와 권한을 확인한다. 응답은 `targetOrigin: "*"`로 보내되 민감 정보를 담지 않는다.
- **브라우저(wr-server)에서**: 같은 iframe 구조를 `/_modes/<id>/` 경로로 서빙한다. sandbox만으로도 origin이 opaque가 되므로 같은 서버를 써도 격리된다. CSP는 같은 헤더를 쓴다.
- **성능·UX 영향**:
  - state 복제: postMessage 구조화 복제는 현재 state(수십 KB) 기준 1Hz면 무시할 만하다. [추정] trace(최대 600단계)는 요청할 때만 보낸다.
  - 외부 모드는 메인 document의 `body[data-mode]`·`.quiet` 클래스를 받지 못하므로 SDK가 iframe `<body>`에 같은 속성을 붙인다. 투명 배경·전체 화면 레이아웃은 iframe 100% 크기로 맞춘다.
  - 오디오 자동 재생은 iframe 안에서 사용자 제스처가 필요하다. 클릭은 iframe 안에서 일어나므로 보통 문제없다.
  - 키보드: iframe에 포커스가 있으면 숫자키·`B`가 호스트에 가지 않으므로 SDK가 해당 키를 호스트로 전달한다.
- **알려진 한계(정직하게 표기)**:
  - **iframe 자기 이동(브라우저 버전)**: sandbox·CSP 어느 것도 iframe이 *자기 자신*을 다른 주소로 이동시키는 것(`location.href = "https://…?데이터"`)을 막지 못한다(CSP `navigate-to`는 표준에서 빠짐). P2 테스트에서 실제로 요청 1건이 나감을 확인했다. 완화: 호스트가 두 번째 `load`를 감지하면 즉시 iframe을 지우고 모드를 끈다(이후 메시지가 새 문서로 가지 않음). **앱(P3)에서는 webview 내비게이션 정책으로 하위 frame의 외부 이동을 거부한다** [PoC: wry/Tauri `on_navigation`이 하위 frame에도 불리는지 mac·win 각각 확인, 안 되면 WKWebView `decidePolicyForNavigationAction`·WebView2 `FrameNavigationStarting`을 직접]. 설치 경고 문구에 이 한계를 적는다.
  - **WebRTC는 CSP의 통제를 받지 않는다**(`RTCPeerConnection`으로 STUN 요청이 나갈 수 있음). 완화책으로 SDK가 모드 코드보다 먼저 관련 생성자를 지운다. 다만 우회 가능성이 있으므로 [PoC]로 WebKit·WebView2 각각에서 실제로 나가는지 확인한다.
  - 샌드박스는 **데이터 유출을 막는 장치**일 뿐 CPU를 과하게 쓰거나 화면을 속이는 모드(가짜 알림 UI)를 막지는 못한다. → 설치 시 경고, 문제 시 바로 끄기, 위젯 창 금지로 대응한다.
  - 외부 모드도 프롬프트 요약·프로젝트명 같은 **작업 내용은 본다**. 그래서 설치 화면에 "이 모드는 세션 내용을 볼 수 있지만 밖으로 보낼 수는 없습니다"라고 명시한다.

### 4.6 설치·관리 UI (`manager.html` → "모드" 탭)

- 목록: 아이콘·이름·버전·작성자·출처 배지(내장/사용자/개발)·호환성·권한 칩, 켜기·끄기 토글, 순서 드래그, [폴더 열기], [삭제](사용자 모드만).
- **설치**: [폴더에서 설치]·[zip에서 설치]·창에 끌어다 놓기 → 백엔드 `install_mode(path)`:
  1. zip이면 임시 폴더에 풀기: 경로 탈출(`..`, 절대 경로)·심볼릭 링크 거부, 최대 20MB·500개 파일, 확장자 화이트리스트(js, css, json, svg, png, jpg, webp, gif, woff2, ttf, mp3, ogg, wav, md, txt)
  2. `mode.json` 스키마 검증, id 충돌·apiVersion 호환 확인
  3. **확인 대화상자**: "직접 만들지 않은 모드입니다. 출처를 믿을 때만 설치하세요" + 요청 권한 목록(사람이 읽는 문장) + 파일 수·크기
  4. `<modes>/<id>/`로 복사하고 파일 SHA-256 목록을 `.install.json`에 기록(이후 바뀌면 "설치 후 수정됨" 배지)
  5. 설치 직후에는 **꺼진 상태**다. 사용자가 켜야 전환기에 나타난다
- 업데이트: 같은 id에 더 높은 version을 설치하면 덮어쓴다. 권한이 늘었으면 다시 확인받는다. 새 판을 `<modes>/.<id>.new-*`로 옮기고 기존 판을 `.<id>.old-*`로 비켜 둔 뒤 바꿔 끼우며, 실패하면 기존 판을 되돌린다. 도중에 앱이 꺼져 남은 흔적은 다음 실행 때 정리한다(`.old-*`만 남았으면 되돌림). 숨김 파일·`__MACOSX`·`desktop.ini`·`Thumbs.db`는 조용히 건너뛴다.
- 내장 모드는 끌 수만 있고 지울 수는 없다. 마지막 남은 모드는 끌 수 없다.

### 4.7 개발 키트

- `templates/mode-starter/`: `mode.json`, `mode.js`(state 표 + 타이머 + 메모 예시), `mode.css`(라이트·다크 토큰), `README.md`.
- **fixture 재생**: `?fixture=<scenario>&speed=4`를 주면 `Core.api`가 `fixtures/scenarios/*/timeline.json`(시간순 state 스냅샷)을 재생한다. 브라우저·앱 모두 Claude를 실행하지 않고도 모드를 개발할 수 있다.
- **개발 모드**: 개발 폴더로 링크한 모드는 백엔드가 감시해서 파일이 바뀌면 `mode-reload` 이벤트를 보낸다. 외부 모드는 iframe을 다시 만들고 내장은 다시 mount한다. 관리 화면에는 콘솔 에러 수와 `Core._debug()` 타이머·리스너 수를 보여 준다(누수 체크).
- `MODES.md`를 **Mode API v1 가이드**로 바꾼다: 패키지 형식 → mode.json 레퍼런스 → ctx v1 표(권한 열 포함) → state/trace 타입 링크 → 샌드박스에서 안 되는 것 → 체크리스트(기존 9장 + "외부 모드로 실행해서 확인") → 배포(zip 만드는 법).
- `wr-server --modes-dir <path>`로 브라우저에서도 외부 모드를 그대로 시험할 수 있다.

---

## 5. 크로스플랫폼

### 5.1 경로

| 항목 | macOS | Windows |
|---|---|---|
| Claude 루트 | `~/.claude` | `%USERPROFILE%\.claude` [추정: Windows Claude Code 기본값] |
| 트랜스크립트 | `<루트>/projects/<인코딩된 경로>/<sid>.jsonl` | 같음 (폴더 이름 인코딩 규칙은 다를 수 있으나 우리는 glob만 하므로 무관) |
| 자격증명 | 키체인 "Claude Code-credentials" (파일은 보통 없음 — 이 맥에서 확인) | `<루트>\.credentials.json` [추정] |
| 이벤트 로그 | `~/.claude/waiting-room/events.jsonl` (현행 유지 — Python 개발 서버와 공유) | `%USERPROFILE%\.claude\waiting-room\events.jsonl` |
| 훅 바이너리 | `~/.claude/waiting-room/bin/wr-hook` | `%USERPROFILE%\.claude\waiting-room\bin\wr-hook.exe` |
| MCP 보고 기록 | `~/.claude/waiting-room/reports.jsonl` (`wr-hook mcp`가 append, §8.5) | `%USERPROFILE%\.claude\waiting-room\reports.jsonl` |
| 앱 설정·사용자 모드 | `~/Library/Application Support/<identifier>/` | `%APPDATA%\<identifier>\` |
| 진단 로그 (`applog.rs`) | `~/Library/Logs/<identifier>/waitscape.log` (Tauri `app_log_dir`) | `%LOCALAPPDATA%\<identifier>\logs\waitscape.log` |

- 훅 바이너리를 앱 번들 안이 아니라 **고정 경로에 복사**하는 이유: 사용자가 앱을 옮기거나 업데이트해도 settings.json의 경로가 깨지지 않게 하기 위해서다. 앱은 시작할 때마다 별도 스레드에서 settings.json에 우리 항목이 있으면(이미 동의한 경우) 사이드카와 설치본 내용을 비교해 다르면 `ensure_bin`만 다시 한다(`hooks::refresh_bin` — settings.json은 읽기만, 사이드카가 스텁이면 아무것도 안 함, Windows는 binswap). 실패하면 로그 + 설정 → AI 연결에 "[훅 켜기]를 다시" 안내(`hooks_status.refreshError`), 시작은 막지 않는다.
- 이벤트 로그 회전: **아직 구현되지 않았다**(설계만 — 5MB에서 `events.1.jsonl`로 rename. 별도 이슈로 남김). 리더는 끝 5000줄만 보므로 파일이 커져도 상태는 맞다.
  MCP 보고 파일(`reports.jsonl`)은 Rust 리더가 1MB에서 `reports.1.jsonl`로 회전한다(사이드카는 쓸 때마다 파일을 열기 때문에 안전, §8.5).

### 5.2 훅 커맨드 형식

[확인] 현재 Claude Code 문서: shell 형식은 mac/linux `sh -c`, Windows는 Git Bash로 실행하고 Git Bash가 없으면 PowerShell을 쓴다. `args`를 주면 **셸 없이 실행(exec form)**하는데, Windows에서는 실제 `.exe`여야 한다.

- **채택: exec form**(셸 인용 문제 자체를 없앰)
  ```json
  { "type": "command", "command": "C:\\Users\\me\\.claude\\waiting-room\\bin\\wr-hook.exe", "args": ["event"] }
  ```
  macOS도 같은 형식에 절대 경로를 넣는다.
- **대체: shell form** (`args`를 모르는 구버전 Claude Code용. [PoC] `args`를 지원하는 최소 버전 확인): 경로를 `/`로 바꾸고 **공백이 없을 때만** 인용 없이 쓴다(Git Bash·PowerShell 모두에서 동작). 공백이 있으면 Git Bash용 `"C:/…/wr-hook.exe"`를 쓴다. PowerShell 폴백에서는 따옴표로 감싼 문자열이 실행되지 않으므로 이 경우는 지원 범위 밖으로 안내한다.
- 등록 이벤트: `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse(matcher TaskCreate|TaskUpdate), Notification, Stop, SessionEnd, SubagentStart, SubagentStop`(현행과 같음). Notification은 matcher 없이 전부 받고 `wr-hook`이 `permission_prompt`·`idle_prompt` 등 유형을 기록한다.
- **설치·제거 절차(`hooks_config`)**: settings.json 읽기 → 파싱 실패 시 중단(덮어쓰지 않음) → `settings.json.bak-waiting-room-<timestamp>` 백업 → 기존 항목은 보존하고 우리 항목(명령 경로에 `waiting-room/bin/wr-hook`가 들어 있는 것)만 추가하거나 제거(멱등) → 쓰기 직전 mtime을 다시 확인 → 임시 파일 + rename으로 원자적 쓰기. 제거하면 우리 항목만 지운다. 설정 화면에서 바뀔 내용을 diff로 보여 주고 동의를 받는다.
- **콘솔 깜빡임(Windows)**: Claude Code(node)가 이미 콘솔을 가진 상태에서 파이프로 띄우므로 console subsystem exe도 새 창이 뜨지 않을 것으로 본다[추정]. 깜빡이면 `#![windows_subsystem = "windows"]`로 바꾼다(파이프 stdin은 상속되므로 동작함 [추정]). → [PoC] 둘 다 측정.
- 성능 목표: `wr-hook` 1회 실행 < 10ms, 바이너리 < 1MB. 의존성은 serde_json만 쓰고, 정규식 마스킹은 작은 자체 구현으로 한다.
- 앱을 지우고 훅만 남은 경우: 실행 파일이 없으면 Claude Code가 훅 오류를 보여 준다. → 안내문에 "삭제 전에 설정에서 훅 제거"를 넣고, `wr-hook`이 고정 경로에 남아 있는 한 단독으로도 문제없이 동작(append만)한다.

### 5.3 WebKit(맥) / WebView2(윈도우) 점검 목록

WebView2는 Chromium이라 지금(크롬 테스트)과 거의 같다. **위험은 macOS WKWebView 쪽**에 있다. 이 맥의 Safari가 같은 엔진이므로 Rust 없이 Safari로 `http://localhost:7777`(또는 dev 서버)을 열어 지금 바로 점검할 수 있다.

| 항목 | 사용처 | WebKit 상태 | 조치 |
|---|---|---|---|
| `color-mix()` | board, flow, hamster, pocket, work | Safari 16.2+ [추정] | 최소 macOS를 13 이상으로(Q8). 그보다 낮게 갈 거면 폴백 색 |
| `backdrop-filter` | flow, orbit, pocket | 접두사 없는 버전은 Safari 18부터 [추정]. pocket 2곳·flow 3곳에 `-webkit-`가 없었음 | **완료(P4-a)**: `-webkit-backdrop-filter` 추가 |
| Document PiP | pocket | 없음 | Tauri 위젯 창으로 대체(§3.3) |
| Web `Notification` | core | WKWebView에서 사용 불가로 간주 [추정] | 백엔드 알림으로 대체 |
| `AudioContext` 자동 재생 | core chime, hamster | 사용자 제스처 필요 | 현행 `pointerdown` 해제 유지. 첫 클릭 전 알림음은 OS 알림 소리로 대체 |
| CDN 폰트 `@import` | hamster.css (Google Fonts Jua, jsDelivr Galmuri) | 앱 CSP(`font-src 'self' data:`)가 막아 대체 폰트로 보였음 | **완료(P4-a)**: Galmuri11 Regular·Bold를 `web/fonts/`에 번들(OFL), `@font-face` 로컬 로딩. Jua(대체 폰트용)는 제거. 외부 요청 0건 |
| `Menlo`, `SF Mono`, `Pretendard` | 여러 CSS | Windows에 없음 | 스택 `ui-monospace, Menlo, Consolas, monospace` / 한글 `Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui` |
| 이모지 | 전 모드 | Windows는 Segoe UI Emoji라 모양·폭이 다름 | 레이아웃이 폭에 의존하는 곳을 점검(햄찌 말풍선, 전광판 칩) |
| `navigator.clipboard` | memo.copy | 보안 컨텍스트 + 제스처 필요. 기존 execCommand 폴백 있음 | 클릭 핸들러 안에서만 호출하는지 확인 |
| SVG text 측정 | flow `textW` | 폰트 메트릭 차이 | 라벨 겹침을 눈으로 확인 |
| 스크롤바·`overflow` | flow 캔버스 | WebKit 오버레이 스크롤바 | 스크롤 영역 확인 |
| `localStorage` 지속성 | 전체 | Tauri origin 고정이면 유지됨 [추정] | 앱 업데이트 후 메모 유지되는지 PoC |
| 투명 창 + blur 성능 | 위젯 | GPU 부하 | 위젯에서는 blur 끄는 옵션 |
| 단축키 | core | `e.key` 동일 | Windows `Alt` 메뉴 충돌 없는지 |

---

## 6. 빌드·배포

### 6.1 로컬 (macOS)
```
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cargo install tauri-cli --version "^2" --locked
cargo tauri dev                                   # 개발
cargo tauri build --target universal-apple-darwin # → .app, .dmg
```
- `bundle.macOS.signingIdentity: "-"`(ad-hoc). arm64는 서명되지 않은 바이너리를 실행할 수 없으므로 ad-hoc 서명은 필수다[추정: Rust 링커가 기본으로 ad-hoc 서명하지만 번들에도 명시].
- `minimumSystemVersion: "13.0"`(Q8), Info.plist에 `NSAppleEventsUsageDescription`.
- `wr-hook`은 `bundle.externalBin`(sidecar)으로 앱에 넣는다. [확인] 플랫폼별 이름 규칙은 `wr-hook-<target-triple>[.exe]`다. 사용자가 훅을 켤 때(첫 실행 온보딩 ② 또는 설정 → AI 연결) §5.1의 고정 경로로 복사하고, 이후 앱 시작 때 내용이 다르면 바꾼다(§5.1).
- 첫 실행 온보딩(`manager.js` `onboarding()`): ① 사용 한도 조회 동의 → ② "Claude Code 훅 켜기 (추천)"(앱만). ②의 버튼 = 동의라서 `hooks_install({onboarding:true})`는 네이티브 확인 창 없이 같은 백업·원자적 쓰기로 설치한다. 단 생략은 **백엔드 기록으로 한 번만**: 앱 설정 폴더의 `hooks-onboarding-used`를 `create_new`로 만들 수 있을 때만 생략하고(허용 즉시 기록, 설치가 실패해도 남음), 이미 있으면 `onboarding:true`라도 확인 창으로 간다. localStorage `onb:hooks`는 화면 표시용일 뿐 판단에 쓰지 않는다(바뀌는 내용은 접힌 "자세히 보기", `hooks_status.preview`). 설정 화면의 [훅 켜기]는 그대로 미리보기 + 확인 창.
  한 번만 묻는다(localStorage `onb:hooks`): 기존 사용자도 훅이 꺼져 있으면 다음 시작에 ②만 한 번, 이미 켰으면 조용히 표시만. `~/.claude`(`claudeDir`)가 없으면 새 사용자는 안내만, 기존 사용자는 Claude Code가 생길 때까지 묻지 않는다.

### 6.2 GitHub Actions
- `ci.yml`(PR·main push): Python 참조 구현·fixture·스키마·시크릿·커밋 작성자 검사.
- `rust.yml`(Rust 관련 경로가 바뀐 PR·main push만, 수동 실행 가능): Linux 린트 잡(`cargo fmt --check`, `clippy -D warnings`)과 테스트 잡(`cargo test`, 동등성 `scripts/rust_parity.sh`)을 동시에(캐시 저장은 main에서만, CI 빌드는 디버그 정보 끔), Windows에서 코어 크레이트 테스트. macOS는 PR 검사에서 빼고 `release.yml`에서만 빌드(Linux·Windows 검사로 충분, 맥 러너 대기를 줄임).
- `release-prep.yml`(수동 실행, Linux 1개): 버전 입력 → `scripts/version.py bump` → 버전·CHANGELOG PR(`release/vX.Y.Z`, 작성자 github-actions[bot]). 그 PR이 병합되면 태그 `vX.Y.Z`를 붙이고 `release.yml`을 workflow_dispatch로 부른다(GITHUB_TOKEN 태그는 push 트리거를 깨우지 않음). 권한은 잡별로 최소(`contents: write`+`pull-requests: write`는 PR 잡, `contents: write`+`actions: write`는 태그 잡).
- `release.yml`(태그 `v*`, 수동 실행은 태그·main만, 구현은 tauri-action 대신 `@tauri-apps/cli` 직접 호출): 매트릭스
  - `macos-latest` → `--target universal-apple-darwin` → `.dmg`(universal 하나)
  - `windows-latest` → NSIS `.exe`(사용자 단위 설치, 관리자 권한 불필요) + `.msi`
  - 결과물은 **draft release**로 올리고 SHA-256 체크섬 파일을 첨부한다. 사람이 확인한 뒤 공개한다.
  - 업데이터 서명 시크릿(`TAURI_SIGNING_PRIVATE_KEY`·`_PASSWORD`)이 있고 `tauri.conf.json`의 공개 키가 실제 값이면 `--config`로 `createUpdaterArtifacts`를 켜서 `.app.tar.gz`·`.sig`를 만들고, 초안 잡이 `scripts/make_latest_json.py`로 `latest.json`을 올린다. 없으면 그 부분만 건너뛴다.
- 시크릿: 모두 선택. GitHub Environments 시크릿에만 둔다 — `release`(`APPLE_*`, `TAURI_SIGNING_PRIVATE_KEY` 등, release.yml build 잡). 배포 규칙은 태그 `v*`·`main`(docs/RELEASE.md §5). release.yml의 `guard` 잡(수동 실행을 태그·main으로)은 실수 방지용이고 보안 경계는 환경 배포 규칙이다. 저장소에는 `<REPLACE_WITH_SECRET_MANAGER>` 플레이스홀더만 둔다(업데이터 공개 키는 비밀이 아니어서 `tauri.conf.json`에 실제 값이 들어 있다. 비밀 키는 관리자 기기와 release 환경 시크릿에만).

### 6.3 미서명 배포 안내문(릴리스 노트 템플릿)
- **macOS**: "'Waitscape.app'을(를) 열지 않음" 경고가 뜨면 [완료] 뒤 **시스템 설정 → 개인정보 보호 및 보안 → '그래도 열기'**를 누른다. macOS 15부터 Control-클릭(우클릭 → 열기) 우회가 없어졌다(2026-10-28 실기기 확인, jhkwim/waitscape#25). 고급 사용자는 `xattr -dr com.apple.quarantine "/Applications/<앱>.app"`을 써도 된다.
- **Windows**: SmartScreen이 막으면 "추가 정보 → 실행"을 누른다. WebView2가 없는 PC에서는 설치 프로그램이 내려받는다(인터넷 필요).
- 체크섬 확인 방법을 안내한다(`shasum -a 256`, `Get-FileHash`).

### 6.4 버전·릴리스
- 앱 버전은 semver 하나로 관리한다. **원본 = `Cargo.toml` `[workspace.package] version`**, 따라가는 곳(`tauri.conf.json`, `Cargo.lock` 워크스페이스 패키지)은 `scripts/version.py bump`가 함께 바꾼다. 일치 검사는 세 겹: `version.py check`(CI python 잡), `build.rs`(tauri.conf.json ≠ `CARGO_PKG_VERSION`이면 빌드 중단), release.yml(태그 = 버전). Mode API 버전은 따로 둔다(§4.3).
- `CHANGELOG.md`(앱, Keep a Changelog)와 `types/CHANGELOG.md`(API)를 분리한다. 릴리스 때 `[Unreleased]`가 새 버전 절이 되고, 비어 있으면 지난 태그 이후 PR 제목으로 채운다.
- **앱 안 업데이트**(`tauri-plugin-updater` 2.14, `app/src-tauri/src/updater.rs`): 시작 15초 뒤 + 하루 1번(1시간마다 깨어 24시간 경과 확인) `…/releases/latest/download/latest.json` 확인 → 새 버전이면 OS 알림 1회 + 트레이 항목 + `update` 이벤트(코어 배너, 스튜디오는 사장님 말풍선). 설치는 사용자가 대화상자에서 누를 때만(`update_install`, 메인 창 전용): 내려받기 → minisign 서명 검증 → 설치 → `restart()`. 몰래 설치하지 않는다. 설정 `updateCheck`(기본 켜짐)로 자동 확인을 끈다.
  - 확인 주소는 코드 저장소 `jhkwim/waitscape`의 GitHub Releases다. 0.4.0까지는 배포 전용 저장소 `jhkwim/waitscape-releases`였고, 0.4.1(다리 버전)·0.4.2를 거기에도 복사해 옛 앱이 새 주소로 넘어오게 한 뒤 보관했다(#22). 실패(오프라인·아직 게시 전 404)는 로그만, 화면에는 "지금은 확인할 수 없어요" 정도로만. 공개 키가 자리표시자인 빌드는 확인하지 않는다(`updater::ready`). 켜는 순서는 docs/RELEASE.md §5·§6.

### 6.5 빌드 플레이버 (구조만)
- 앱 크레이트 cargo feature `updater`·`terminal-jump`(기본 켜짐). 끄면 해당 코드(플러그인·네트워크, 다른 앱 실행)가 컴파일에서 빠지고, 웹은 `app_info.features`를 보고 UI를 숨긴다(`core.js applyAppInfo` → `ctx.api.openTerminal` 없음, 설정 카드·배너 없음). 명령·capabilities 목록은 플레이버와 관계없이 같다(빠진 기능은 `disabled`/`unsupported` 응답). CI가 `--no-default-features` clippy로 깨지지 않게 지킨다.
- Mac App Store판(계획만): 식별자 `io.github.jhkwim.waitscape.mas`(직접 배포판 `io.github.jhkwim.waitscape`와 분리), `--no-default-features`, App Sandbox entitlements, `~/.claude` 접근은 security-scoped bookmark로 재설계. 자세히 docs/RELEASE.md §8.

---

## 7. 보안·개인정보

### 7.1 외부 통신 목록 (전부)

| # | 대상 | 시점 | 보내는 데이터 | 기본값 |
|---|---|---|---|---|
| 1 | `https://api.anthropic.com/api/oauth/usage` (GET) | 120초마다, 백오프 | 헤더: `Authorization: Bearer <OAuth access token>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: <앱>/<버전>`. 본문 없음 | **꺼짐**(온보딩에서 동의) |
| 2 | Microsoft WebView2 부트스트래퍼 | Windows 설치 시 WebView2가 없을 때만 | 표준 다운로드 요청 | 설치 프로그램 |
| 3 | `https://github.com/jhkwim/waitscape/releases/latest/download/latest.json` (코드 저장소 Releases, 0.4.0까지는 `waitscape-releases`, GET, 리다이렉트 → release-assets.githubusercontent.com) | 시작 15초 뒤 + 하루 1번, 설정의 [지금 확인] | IP, User-Agent. 본문·토큰 없음 | **켜짐**(설정 → 업데이트로 끔. 공개 키 없는 빌드·`updater` 기능을 뺀 빌드는 안 함) |
| 3b | 같은 릴리스의 `.app.tar.gz` / `.exe` / `.msi` | 사용자가 [지금 업데이트]를 눌렀을 때만 | IP, User-Agent | 누를 때만 |
| — | ~~fonts.googleapis.com, cdn.jsdelivr.net~~ | — | — | **제거**(폰트 번들) |

- 텔레메트리·오류 수집은 없다. 외부 모드는 CSP로 통신이 차단된다(§4.5).
- MCP 보고 사이드카(`wr-hook mcp`, §8.5)는 AI CLI와 stdio로만 말하고 로컬 파일에 append한다 — 리스너·네트워크 코드가 없어 이 목록은 그대로다.
- 셸에서 `curl`/`wget`에 환경변수를 넘기는 코드는 만들지 않는다. 앱의 HTTP는 사용 한도(`ureq`, `limits.rs`)와 업데이터(`tauri-plugin-updater`의 reqwest, `updater.rs`) 두 곳에서만 나간다.

### 7.2 토큰 취급
- 메모리(`Zeroizing<String>`)에만 둔다. 디스크·로그·state·프론트·에러 메시지에 넣지 않는다(에러는 `HTTP 401` 같은 코드만).
- `Debug`/`Display` 구현은 `***`로 출력한다. 로그 크레이트에 들어가는 문자열도 `redact()`를 한 번 더 거친다.
- 키체인은 사용자가 버튼을 눌렀을 때만 읽는다. refresh는 하지 않으므로 Claude Code가 토큰을 갱신하면 다음 파일 읽기나 버튼으로 새 토큰을 쓴다.

### 7.3 마스킹 — 현행의 빈틈과 보강
- 🟡 **`/state`의 텍스트는 지금 마스킹되지 않는다.** `prompt`(hook.py 60자), `say`(트랜스크립트 160자), `activity.text`(Bash 명령 설명·명령), `note`가 그대로 나간다. `/trace`만 `clip()`을 거친다. → `wr-hook`이 기록할 때, 그리고 `wr-core`가 state를 만들 때 모든 자유 텍스트에 같은 `redact()`를 적용한다.
- 🟡 **로컬 HTTP 서버의 DNS 리바인딩**: server.py는 127.0.0.1에 바인딩하지만 `Host` 헤더를 검사하지 않는다. 악성 웹페이지가 리바인딩으로 `/state`(프롬프트 요약)를 읽을 수 있다. → `wr-server`는 `Host`가 `127.0.0.1:<port>`·`localhost:<port>`가 아니면 403을 반환하고, CORS 헤더를 주지 않는다. 데스크톱 앱은 HTTP 서버를 아예 띄우지 않는다(IPC만 씀).
- 마스킹 패턴(현행 유지 + 이식): `sk-ant-…`, `gh[pousr]_…`, `github_pat_…`, `AKIA…`, `xox[bpasr]-…`, JWT(`eyJ….….…`), `Bearer/Basic …`, `password|secret|token|api_key|…=값`. Rust에서는 같은 정규식을 fixture로 회귀 테스트한다. **마스킹 → 절단** 순서를 지킨다.
- 개인 경로: trace는 `~` 축약과 cwd 상대화를 한다. 외부 모드에는 `cwd`를 주지 않는다.

### 7.4 개인 흔적 제거 체크리스트 (공개 저장소 기준)

`grep -rni "<개인 이름·계정>\|<개인 홈 경로>\|statusline"` 결과 (P0에서 정리하고 공개 전(#66)에 다시 확인함. 아래 '조치' 열이 반영된 상태). 계속 지키는 검사는 `scripts/check_secrets.py`(홈 경로·대시 인코딩 홈 경로 포함)가 CI에서 한다:

| 위치 | 내용 | 조치 |
|---|---|---|
| `README.md` 훅 등록 | `python3 <개인 절대 경로>/hook.py` | 앱 설정의 자동 설치로 대체. 문서에는 `<설치 경로>`로 |
| `README.md` 사용 한도 | "개인 statusline의 `~/.claude/<개인 폴더>/…` 연결 기능" | 문단 삭제. 한도는 사용량 API로 설명 |
| `README.md` 사용 한도 | `python3 <개인 절대 경로>/statusline_tap.py` | 삭제 (statusline 탭은 고급 옵션 문서로) |
| `core.js:118` | "statusline 연결이 필요해요" (한도 없음 안내) | ✅ P2: "설정에서 사용 한도 조회를 켜 주세요"(ko/en, `core-lib.js` `limitNote`) |
| `usage_poll.py` | macOS `security` 의존, 주석 "Claude Code의 /usage가 쓰는 것과 같은 비공개 API" | Rust 이식 후 legacy로. 비공개 API라는 사실은 앱 설정 화면 문구로 유지 |
| `hook.py` 등 | 없음 | — |
| 저장소 메타 | P0에서 `git init`(커밋 전) | `git init`, `.gitignore`(`.env`, `*.pem`, `*.key`, `secrets/`, `node_modules/`, `dist/`, `target/`, `app/src-tauri/gen/`), 커밋 저자는 GitHub noreply 이메일(Q2) |
| 번들 식별자 | 미정 | 소속 도메인 식별자 금지 → 중립 식별자(Q1). 이름·식별자는 `brand.json` 한 곳에서 |
| fixture | P0 작성 | 실제 트랜스크립트·개인 홈 경로를 넣지 않는다. 합성 경로 `/Users/alex/dev/<이름>` 사용. CI에서 개인 경로(`/Users/<이름>`, `-Users-<이름>-`) grep이 0건인지 검사 |

---

## 8. 단계별 실행 계획

현재 이 맥: **Rust 미설치**(확인: `rustc`/`cargo` 없음), Node 24.15, Bun 1.3.10, Xcode CLT 있음. → **★ 표시는 Rust 없이 지금 시작할 수 있는 작업.**

| ID | 작업 | 담당 파일/디렉터리 | 입력 → 출력 | 완료 기준 | 의존 |
|---|---|---|---|---|---|
| **P0-a ★** | 저장소 정리 | `.gitignore`, README, `git init` | 현 저장소 → 깨끗한 git 저장소 | §7.4 grep 0건, 정책상 필수 ignore 항목 포함 | — |
| **P0-b ★** | 공개 계약 초안 | `types/*.d.ts` (✅ state·trace), `tools/gen-schema.ts` | server.py·README·MODES.md → `state/trace/ctx.d.ts`, `*.schema.json` | 현재 7777 응답 샘플(읽기만)과 실데이터가 스키마 검증 통과 | — |
| **P0-c ★** | fixture + Python 골든 | ✅ `fixtures/{input,expected}`, `scripts/{snapshot,compare}.py` | 합성 시나리오 9종 이상 → `expected.*.json` | server.py를 고치지 않고 몽키패치만으로 결정적 출력(두 번 돌려 같은 결과) | P0-b |
| **P0-d ★** | 트랜스크립트 전용 판정 명세 | ✅ `fixtures/transcript-only/{RULES.md,expected.json,input}` | 상태 규칙 → 손으로 쓴 기대값 | 시나리오별 기대 status·needs_input?에 합의 | P0-c |
| **P2-a ★** | `Core.api` + 순수 함수 분리 | `web/core/{api.js,core-lib.js,core.js}`, flow·pocket 수정 | core.js → http 구현 + fixture 재생 구현 | 6개 모드가 브라우저에서 기존과 똑같이 동작. `fetch(` 직접 호출 0건(api.js 제외) | P0-b |
| **P2-b ★** | 모드 패키지 전환 | `web/modes/<id>/mode.json…`, `tools/dev.ts`(Bun dev 서버, 정적 + `/state`·`/trace`를 7777로 프록시, `modes/index.json` 생성) | MANIFEST → mode.json 발견 | MANIFEST 삭제, 숫자키·전환기 자동, dev 서버 별도 포트(예: 7780) | P2-a |
| **P2-c ★** | 샌드박스 브리지 | `web/core/bridge-host.js`, `web/sdk/mode-sdk.js`, `web/modes/_template/` (§8.1) | ctx v1 표 → iframe 실행 | 스타터 모드가 외부 모드로 동작. `fetch`·`img` 외부 요청·`window.open`이 차단됨을 테스트 페이지로 확인(크롬·Safari) | P2-a, P2-b |
| **P2-d ★** | 모드 관리 UI (프론트) | `web/core/manager.js`·`manager.css` (설정 패널, §8.1) | 모드 목록 API → 화면 | dev 서버 기준 목록·켜기/끄기·순서 동작. 설치는 P3-d에서 연결 | P2-b |
| **P4-a ★** | WebKit 점검 + 폰트 번들 | `web/modes/*/mode.css`, `web/fonts/` | §5.3 표 → 수정 | Safari에서 6개 모드·라이트/다크·회의 모드 확인, 외부 폰트 요청 0건 | P2-b (또는 현 파일에 먼저) |
| **P4-b ★** | CI 초안 | `.github/workflows/*` | — | JS·스키마 잡은 지금 통과, Rust 잡은 P1 뒤에 활성화 | P0-a |
| **P1-a** | `wr-core` state | `crates/wr-core/{events,transcript,state,redact}` | fixture → state | P0-c 골든과 동등(§2.4 정규화) | P0-c, **Rust** |
| **P1-b** | `wr-core` trace | `crates/wr-core/{trace,phase}` | fixture → trace(증분 커서 포함) | 골든과 동등 | P0-c, Rust (P1-a와 병렬) |
| **P1-c** | 트랜스크립트 전용 엔진 + 병합 | `crates/wr-core/engine` | P0-d → 구현 | P0-d 기대값 통과, 훅 시나리오는 P1-a와 결과 같음 | P1-a, P0-d |
| **P1-d** | 한도·자격증명 | `crates/wr-core/{limits,credentials}` | §3.7 → 클라이언트 | 목 서버로 200/401/429(Retry-After)/네트워크 오류 테스트, 토큰이 어떤 출력에도 없음 | Rust (병렬) |
| **P1-e** | `wr-hook` + `hooks_config` | `crates/wr-hook`, `crates/wr-core/hooks_config` | hook.py → exe, settings 병합 | hook.py와 같은 입력이면 같은 줄 출력(마스킹 추가분 제외). settings.json 병합·제거 멱등 테스트, 실행 < 10ms | Rust (병렬) |
| **P1-f** | `wr-server` | `crates/wr-server` | wr-core → HTTP | 기존 모드가 wr-server로 동작, Host 검사, 외부 모드 경로 서빙 | P1-a, P1-b, P2-c |
| **P3-a** | Tauri 골격 + 명령·push | `app/src-tauri` | wr-core → `get_state`/`get_trace`/`state` 이벤트, `wrmode` 프로토콜, capabilities | 메인 창에서 6개 모드 동작, 감시 기반 갱신 지연 < 300ms | P1-a, P2-a |
| **P3-b** | 트레이·위젯·알림·자동 시작 | `app/src-tauri/src/{tray,windows,notify}.rs` | §3.3–3.5 | 창 닫아도 알림 1회, 위젯 always-on-top·위치 기억 | P3-a |
| **P3-c** | 설정·훅 설치·터미널 이동·한도 | `app/src-tauri/src/{settings,terminal}.rs`, `web/manager.html` | §3.5–3.7 | 훅 설치→이벤트 수신→제거→원복(백업 비교), Terminal/iTerm 이동 | P3-a, P1-d, P1-e |
| **P3-d** | 모드 설치·개발 모드 | `app/src-tauri/src/modes.rs` | §4.6–4.7 | zip-slip 테스트 통과, 설치 → 확인 → 켜기, 파일 수정 시 자동 새로고침 | P3-a, P2-c, P2-d |
| **P4-c** | 패키징·릴리스 | `tauri.conf.json`, `release.yml`, 안내문 | — | 태그 → draft release에 dmg·exe·msi, 깨끗한 맥·윈도우 VM에서 설치·실행 | P3-* |
| **P4-d** | WebView2·Windows 실기 점검 | — | §5.3, §5.2 | Windows에서 훅(exec form)·콘솔 깜빡임·폰트·이모지 확인 | P4-c |

### 8.1 P2 구현 메모 (계획과 달라진 점)

- **완료**: P2-a(`Core.api`, `core-lib.js` 분리, `fetch` 직접 호출은 `api.js`뿐), P2-b(모드 패키지 + `/modes` 발견 + `tools/dev.ts`), P2-c(샌드박스 브리지·SDK·스타터), P2-d(설정 화면). 남은 것: fixture 재생(`?fixture=`)은 미구현 → P3-a 전에.
- 레이아웃: 프론트는 `web/`로 옮겼다(Tauri `frontendDist = web`). `brand.json`은 루트에 두고 서버가 `/brand.json`으로 준다 → **P3: 빌드 때 `web/`로 복사하거나 `get_brand` 명령**.
- 템플릿은 `templates/mode-starter/` 대신 **`web/modes/_template/`**(id `starter`). `_`로 시작해 내장 목록·서빙 대상이 아니다.
- 관리 화면은 별도 `manager.html` 대신 **메인 문서의 설정 패널**(`web/core/manager.js`, Shadow DOM — 모드 CSS가 닿지 않음). 쉼표 키·전환기 맨 아래 "⚙️ 설정…"으로 어느 모드에서든 연다. P3에서 manager 창으로 옮길 때 같은 파일을 쓴다.
- 모드 켜기·순서·외부 모드 동의(권한 서명)는 localStorage(`modes:enabled`, `modes:order`, `modes:ack`). P3에서 백엔드 `settings.json`으로 옮긴다. 브라우저 버전은 **설치·삭제를 하지 않는다**(쓰기 엔드포인트를 만들면 CSRF 여지가 생김) → 폴더 복사·삭제 안내 + 다시 찾기.
- 개발 모드: 개발 서버가 `index.html`에 `<meta name="wr-dev">`를 넣으면 코어가 `/_dev/events`(SSE)에 붙는다. 모드 파일 변경 → 그 모드만 다시 올림(외부는 iframe 재생성, 내장은 캐시 무효화 후 재마운트), 코어 파일 변경 → 새로고침. 외부 모드 CSP의 origin은 개발 서버가 자기 주소로 바꿔 준다.
- mode.json에 `uses`(안내용 프로바이더 기능)·`locale`(모드 문구 언어 — 다르면 코어 기본 알림 문구) 추가. state에 `session.provider`·`state.providers`(@since 1.1, P1) 타입 추가, `Core.provider/can/providerBadge`.
- `texts`(알림 문구 함수)는 postMessage로 넘길 수 없어 외부 모드는 기본 문구를 쓴다.
- 탈출 테스트(Chrome 155, 로컬 canary 서버): fetch·XHR·sendBeacon·WebSocket·EventSource·img·CSS url·script·link prefetch·중첩 iframe·Worker·window.open·top 이동·폼·alert·parent/localStorage/cookie 접근·WebRTC 모두 차단(canary 0건). 자기 이동만 1건 통과 → 위 §4.5 한계.

### 8.2 P1 구현 메모 (설계와 달라진 점)

- **완료**: P1-a·b·c·d·f + P1-e 중 `wr-hook`(동등성 `scripts/rust_parity.sh`: 15/15, 24/24 — 이후 일지 시나리오로 23/23, §8.4). **미구현**: `hooks_config`(settings.json 병합·제거) → P3-c에서. `hooks.installed`는 지금 settings.json에 `wr-hook`/`waiting-room/hook.py` 문자열이 있는지(또는 이벤트가 있는지)로만 본다.
- 모듈 배치는 §2.2 대신 §2.5 프로바이더 구조: Claude 전용(`events`·`transcript`·`state`·`credentials`)은 `providers/claude/{hooks,scan,tonly,trace,usage,describe,config}.rs`, 공통은 최상위.
- 소스 모드 3가지: `Hooks`(server.py와 동일, 동등성 검증·1.1 필드 없음) / `Transcript` / **`Auto`(기본)**. Auto 병합: 최근 10분 안에 훅 이벤트가 있거나 SessionEnd를 받은 세션은 훅 결과 전체를 쓰고(`source:"hook"`), 아니면 트랜스크립트 판정(`source:"transcript"`). §2.3의 "status 등만 훅, 토큰 등은 트랜스크립트"와 결과는 같다(훅 경로도 토큰·발화·health는 트랜스크립트에서 읽으므로).
- 트랜스크립트 전용 규칙 해석(RULES.md에 없던 부분): 대기 도구는 **가장 오래된 것 하나가 아니라** 질문/계획 도구가 하나라도 있으면 sure, 아니면 권한 도구 중 8초 넘은 것 → guess. 새 프롬프트·중단 때 대기 도구를 비운다(이전 턴의 결과 없는 도구로 멈춤 오판 방지). stop_reason `refusal`도 끝으로 본다. 끝난 서브에이전트는 "지난 턴에 시작했고 이제 끝난 것"을 보여 줄 때 뺀다(새 프롬프트 시점이 아니라 계산 시점에 판정). 오늘 `today_kinds`는 메인 트랜스크립트의 도구만 센다.
- 한도 조회: 키체인은 `security-framework` 대신 **`/usr/bin/security`를 인자 배열로** 실행(의존성·서명 문제 없음), `load_keychain()`을 부를 때만. 401/403이면 다시 읽기 전까지 중단, 429는 Retry-After(초) → 없으면 2·4·8…분(최대 60분). 오류 코드 `no-token`·`network`·`format`·`HTTP <n>`. 주기 120초(server.py는 300초). HTTP는 `ureq`(rustls), `usage` 기능 플래그로 뺄 수 있음.
- 경로: `CLAUDE_CONFIG_DIR`가 있으면 로그·statusline·projects·자격증명 기본값이 그 아래로 간다(server.py는 항상 `~/.claude`). `WAITING_ROOM_*`가 있으면 그것이 우선. `wr-hook`도 `WAITING_ROOM_LOG`를 따른다(hook.py는 고정 경로).
- 증분: events.jsonl은 링버퍼(최근 5000줄, 파일이 줄면 처음부터). 세션 발견은 30초마다 전체, 그 사이엔 폴더 mtime(새 파일)과 최근 파일만 stat. `_paths` 캐시처럼 sid→경로는 찾으면 기억한다. state용 scan 캐시는 아직 상한이 없다(Python과 같음) → P3에서 LRU 검토.
- `wr-hook`: 출력은 hook.py와 **바이트 단위로 같다**(키 순서·`", "` 구분자, ts 제외 — 15종 입력 비교). 마스킹은 절단 전. `wr-core`의 `py.rs`·`redact.rs`·`describe.rs`를 `#[path]`로 공유(의존성 serde_json·regex만). 크기 1.17MB(cargo strip) / 0.95MB(`strip`) — **`cargo build -p wr-hook`로 따로 빌드**해야 한다(워크스페이스 전체 빌드는 regex 기능이 합쳐져 1.9MB). Windows 콘솔: 기본 console 서브시스템, `--features windows-gui`로 GUI 서브시스템 빌드 가능(P4-d PoC).
- `wr-server`: server.py의 최신 라우팅(`/state`·`/trace`·`/modes`·`/brand.json`·`web/` 정적·`/_sdk/`·`/_modes/<id>/` + CSP)을 그대로 따른다. 모드 발견·서빙 규칙은 `wr_core::modes`(앱의 `wrmode:` 프로토콜과 공유). 차이: 오류 페이지 본문 문구, JSON 공백.
- 의존성(전부 MIT/Apache): serde, serde_json(preserve_order), regex, indexmap, chrono(clock), zeroize, ureq(rustls) / wr-server에 tiny_http. `time`·`dirs`·`security-framework`·`notify`는 쓰지 않음(notify는 P3 앱에서).

### 8.3 P3 구현 메모 (설계와 달라진 점)

- **완료**: P3-a(골격·push·`wrmode:`·capabilities), P3-b(트레이·위젯·알림·자동 시작), P3-c(설정·훅 설치·터미널 이동·한도), P3-d 중 설치·삭제·켜기/순서 영속. **미구현**: 개발 폴더 링크·`mode-reload`(앱), "설치 후 수정됨" 배지(`.install.json` 해시는 기록만), 트레이 세션 목록.
- 크레이트 `app/src-tauri`(이름 `waitscape`, Tauri 2.12.4 · 플러그인 notification/dialog/autostart/single-instance, `notify` 8, `zip` 2). Rust 1.90+ 필요(크레이트별 `rust-version`).
- **큰 화면 ↔ 미니 보기**: 두 창은 전환이라 동시에 보이지 않는다(`windows::View`). `open_widget`(메인 📌 미니 보기·포켓 위에 띄우기, 트레이 "미니 보기") = 위젯을 띄운 뒤 main을 **숨김**(닫지 않음). `close_widget`(위젯 ⤢ 크게 보기·`window.close()`) · 트레이 "큰 화면"·설정…·모드 선택 · Dock 클릭(Reopen) · 다시 실행(single-instance) = main을 보이고 위젯을 닫음. 위젯이 어떤 길로 닫히든(Cmd+W 포함) `CloseRequested`에서 큰 창을 되살려 창이 하나도 안 보이는 상태를 만들지 않는다. 미니 여부는 설정 `widget`에 남고(앱 종료는 CloseRequested를 거치지 않아 유지) 다음 시작은 main을 숨긴 채 만들어 그 화면으로 연다. Dock 클릭을 "큰 화면"으로 둔 이유: 미니 창은 이미 항상 위에 보여 "앞으로"가 할 일이 없고, Dock 클릭 = 앱 창 열기가 macOS 관례. 브라우저(PiP)는 탭을 숨길 수 없어 기존대로 창이 하나 더 뜬다.
- **창**: `main`(index.html, 닫기 = 숨김) + `widget`(widget.html — 별도 셸 파일, 코어가 `<meta name="wr-widget">`를 보고 `#<모드>`(없으면 localStorage `widget:mode`, 기본 포켓)를 '떨어진 창' 모양으로만 mount. `open_widget(modeId)`는 `pocket`·`studio`만 받고, 이미 열린 창이면 해시만 바꿔 코어가 다시 불러온다). `manager` 창은 만들지 않고 P2의 설정 패널을 그대로 쓴다. 위젯 크기 맞춤은 포켓의 `win.resizeTo`를 `widget_resize` 명령으로 연결(WKWebView는 `outerWidth`가 0이라 코어가 inner와 같게 보정), 끌기는 `start_dragging`.
- **push**: 감시 이벤트 → 150ms 조용해질 때까지 모은 뒤, 또는 2초 tick마다 `state()` → digest가 바뀌면 `state` emit(+10초 heartbeat). 측정: 이벤트 append → 프론트 수신 160~190ms. trace는 push하지 않음(`get_trace`).
- **알림**: 전이 감지는 `detect.rs`(core.js `detect()`와 같은 규칙, 첫 state는 기준만). 웹 코어는 `api.backendNotifies`면 done/input/stall OS 알림을 보내지 않고, 메모 준비 알림만 메인 창이 `notify` 명령으로 보낸다(위젯 창은 소리·알림 없음). 회의 모드 = OS 알림은 보내되 `sound` 없음. `confidence: "guess"`면 "확인이 필요할 수도" 문구.
- **설정 영속**: 백엔드 `settings.json`(앱 설정 폴더) = 한도 동의·알림 종류·회의 모드·언어(pref + 실제 언어)·자동 시작·터미널 앱·모드 `{order, enabled, ack}`·위젯 열림. 다른 창·트레이의 변경은 `settings` 이벤트로 퍼진다. 위젯 창은 `quiet`만 바꿀 수 있다(명령에서 검사).
- **훅 설치**: `wr_core::hooks_config`(신규) + 앱 `hooks.rs`. 확인은 **네이티브 대화상자**(Rust에서 띄움 — 웹 코드로 우회 불가, 기본 버튼 = 취소)에 바뀔 항목 diff를 보여 준다. sidecar가 개발용 자리표시면 거부. 고정 경로 복사 후 `--version`으로 동작 확인. 경로는 `ClaudeConfig`(=`CLAUDE_CONFIG_DIR`)를 따르므로 시험은 임시 루트로 했다(설치 → 제거 시 원본과 JSON 동일, 백업 2개 확인).
- **사용 한도**: 동의(`usageLookup`)가 켜지면 `Engine::set_poll_on(true)`(state.poll.on) + 별도 스레드에서 `UsageClient::poll()`(120초·백오프). 키체인은 `usage_keychain` 명령(버튼)에서만.
- **터미널 이동**: 멀티플렉서(cmux·Orca) 세션은 그 워크스페이스·패널·터미널로(§3.6 '멀티플렉서 어댑터'). 그 밖에는 훅 터미널 힌트가 아직 없어 세션 `cwd`에서 열기만 한다 — mac `/usr/bin/open -a <화이트리스트 앱> <cwd>`, win `wt -d <cwd>`, 실패하면 프론트가 경로를 복사. 탭 포커스(AppleScript tty 매칭)는 힌트를 기록한 뒤.
- **샌드박스(앱)**: 주소는 wr-server와 같은 모양 `wrmode://localhost/_modes/<id>/…`·`/_sdk/…`(`sandbox_csp()`·`sandbox_page()` 그대로 공유). 메인 창 CSP: `frame-src wrmode:`, `connect-src ipc:`, `style-src 'unsafe-inline'`(모드 인라인 스타일 — `dangerousDisableAssetCspModification: ["style-src"]`). 외부 CDN 폰트 `@import`(hamster)는 앱 CSP로 막혀 대체 폰트로 보인다 → P4-a 폰트 번들.
  - 내비게이션 정책: 메인·위젯 창에 `on_navigation`(tauri://localhost·wrmode://localhost·Windows의 `*.localhost`·about:blank만) + `on_new_window` 거부. 메인 frame 외부 이동 거부 확인.
  - **탈출 시험 결과(macOS 27 WKWebView, canary 127.0.0.1:7795)**: fetch·img·sendBeacon·WebSocket·window.open·top 이동·parent/localStorage 접근·`fetch("ipc://…")` 모두 차단(canary 0건). `__TAURI_INTERNALS__` 없음. `window.webkit.messageHandlers.ipc`는 iframe에서도 **보이지만** 위조 메시지(set_settings)는 Tauri가 거부(설정 변화 없음 — invoke key·origin 검사). **자기 이동(`location.href = https://…`)도 요청 0건**: WebKit이 opaque-origin 샌드박스 iframe의 이동을 내비게이션 정책 단계 전에 막았다(우리 `on_navigation`까지 오지 않음). 코어는 두 번째 load로 감지해 모드를 끈다. 즉 브라우저 버전의 알려진 한계(§4.5)가 앱(mac)에서는 재현되지 않았다. Windows(WebView2)는 wry가 메인 frame만 거르므로 P4-d에서 `FrameNavigationStarting`으로 보강·실측.
- **capabilities**: `main`(창 label main: event listen/unlisten + 앱 명령 전부), `widget`(get_state·get_settings·set_settings(quiet만)·get_brand·list_modes·close_widget·widget_resize·start_dragging·open_terminal(sid만 받고 서버 state에서 다시 찾음)). 앱 명령은 `build.rs` AppManifest로 권한을 만들어 창별로만 허용. remote URL 없음.
- **이름·식별자**: tauri.conf.json은 JSON이라 brand.json을 읽지 못하므로 `build.rs`가 두 값이 다르면 빌드를 멈춘다. 브랜드는 `get_brand` 명령으로 프론트에 준다.
- **진단 로그(`applog.rs`, `fix/win-diag`)**: GUI 앱은 stderr가 남지 않아(특히 Windows) Windows 사용자의 "📌 미니 보기를 눌러도 반응 없음"을 원인 확인할 수 없었다.
  `wlog!("태그", …)` = stderr + `app_log_dir()/waitscape.log`(줄 `YYYY-MM-DDTHH:MM:SS [태그] 메시지`, 로컬 시각, 1MB 넘으면 `waitscape.old.log`로 한 번 회전, 쓸 때마다 열고 닫음 — 열린 파일은 Windows에서 이름을 못 바꿈).
  메시지는 `wr_core::redact` → 홈 `~` → 한 줄·2000자. 토큰·프롬프트·알림 제목(프로젝트 이름)은 넘기지 않는다. 시작 줄 = 앱 버전·OS·아키텍처·`tauri::webview_version()`·시간대, 이어서 일지 사용 여부·폴더·오늘 완료 수.
  미니 보기 전환은 단계마다 한 줄(명령 진입·스레드 이름, 이미 창 있음/새로 만듦, build 성공·실패+ms, main 숨김, 끝), 웹뷰 `on_page_load`(로드 시작·끝)와 `list_modes ← <창>`(창 코어가 실제로 돌아 IPC가 됨)으로 위젯 웹뷰가 살아 있는지 본다.
  `applog::watch`가 build·전환이 5초 안에 안 끝나면 "멈춤 의심" 한 줄(교착 확인), 트레이 전환이 앞 전환에 막혀 무시되면 그것도 남긴다.
  화면: `ctx.api.openWidget`을 코어가 감싸 실패 이유를 toast로("미니 보기를 열 수 없어요: …"), 10초 무응답이면 "설정 → 일반 → 앱 정보 → 로그 폴더" 안내. 설정 → 일반 → 앱 정보 [로그 폴더 열기](`open_log_dir`, 메인 창만, `open_modes_dir`와 같은 방식)
- **E2E**: 화면 자동화 대신 디버그 빌드 전용 `WAITSCAPE_E2E_DIR` 드라이버(`eval_with_callback`)로 모드 전환·위젯·알림·설치·탈출 시험을 돌렸다. `#[cfg(debug_assertions)]`라 릴리스 바이너리에는 없다(문자열 검사로 확인).

- **한도 깜빡임·숨길 세션 수정(`fix/limits-and-hidden-sessions`)**
  - *한도*: 여러 세션이 각자 마지막 요청 시점의 오래된 `rate_limits`를 statusline으로 보내(특히 플러그인 내부 세션) 마지막 값이 덮어쓰면 5h `null`·주간 값이 오르내렸다.
    같은 창(같은 `resets_at`) 안의 사용률은 단조 증가하므로 `limits::merge_limits`(Rust)/`statusline_tap.merge_limits`(Python)가 **창별 최댓값**을 남긴다 — 더 늦게 끝나는 창이 최신, 지난 창(`resets_at <= now`) 폐기, 없는 창은 기존 값 유지, `resets_at`이 null이면 상대와 같은 창, 오차 120초 안이면 같은 창.
    쓰기(`statusline_tap.py`)는 `flock` 아래 읽기→병합→교체(프로세스별 임시 파일)로 동시 실행에도 갱신이 사라지지 않는다. `limits_ts`는 새 정보가 들어온 때만 갱신. 읽기(`ClaudeProvider::limits_block`·`set_polled`, `server.py build_state`)도 같은 규칙을 적용하되, **파일 한 장이 아니라 지금까지 본 값(메모리 `sl_memo`)에 계속 합친다** — 옛 탭이 파일을 오래된 값으로 덮어써도 /state는 내려가지 않는다(시작 직후 첫 몇 초는 처음 읽은 값에서 오르기만 함; 영속하지 않음). 회귀: `scripts/test_flicker_state.py`. 공통 케이스 `fixtures/limits_merge.json`.
  - *숨김*: 데이터 = `hide.rs` `DEFAULT_HIDE` + 설정/환경변수 패턴. 정규화(영숫자 외 → `-`) 후 부분 문자열 비교라 폴더 이름(`-Users-a--claude-mem-observer-sessions`)과 cwd 둘 다에 맞는다.
    백엔드: `Discovery`·`discover()`가 맞는 **폴더를 열지 않고**, 훅 이벤트는 cwd로 걸러 집계·토큰 스캔에서 뺀다(비ASCII 경로는 스캔 후 cwd로 한 번 더). 앱 설정 `hideProjects/hideBuiltin`은 `Engine::set_hide`로 즉시 반영.
    화면: `core-lib.js filterSessions`가 "활성 세션만"(작업 중·입력 필요·멈춤 의심·서브에이전트 실행 중 + 끝난 지 `recentMinutes`분, 기본 30)을 적용하고 `state.hidden`을 붙인다 → 모드는 수정 없이 걸러진 state를 받음, 전환기 옆 "+N개 숨김" 토글. 트레이·OS 알림은 백엔드의 전체 state 기준(작업 중·입력 필요만 세므로 영향 없음).

### 8.4 퇴근 일보 일지 (`feat/daily-log`, 데이터·API만 — 화면은 다음 단계)

- **왜 일지 파일인가**: `/state`의 오늘 집계(`done_today`·`waited_today`)는 events.jsonl 끝 5000줄을 매번 다시 돌려 얻는 값이라 회전·잘림에 약하고,
  어제 값·한도 추이(statusline은 현재 값만)는 어디에도 남지 않는다. 그래서 상태 엔진이 이미 감지한 전이를 **하루 파일**로 쌓는다.
- **수집 지점 = 상태 엔진**: server.py `build_state()`와 Rust `hooks::replay`가 같은 규칙으로 피드를 만든다 — 턴 완료(Stop, `started`가 있을 때),
  질문 대기(진행 중 턴(`working`+`started`)의 Notification → 다음 UserPromptSubmit·Resume·PreToolUse·Stop. 끝난 뒤 오는 "입력 기다림" 알림은 제외),
  세션 마지막 활동(`last`). 트랜스크립트 전용 세션(Rust만)은 `tonly`의 끝난 턴(추정 종료 제외)과 AskUserQuestion·ExitPlanMode → 답을 쓰고,
  **훅 기록이 전혀 없는 세션만** 넣는다. 같은 턴을 두 소스가 보면 세션 같고 시작·끝 5초 안 → 하나. 숨길 프로젝트는 넣지 않는다.
  엔진(`Engine::state_at`)은 프로바이더 id를 붙여 `DayLog::record`에 넘기고, 같은 자리에서 state의 `limits`로 표본(5분)·정전(5시간 ≥100% 구간)을 남긴다.
  화면을 열지 않아도 쌓이게 server.py·wr-server는 1분 tick, 앱은 기존 2초 tick.
- **파일**: `<폴더>/<YYYY-MM-DD>.json`(4시 경계), 폴더 0700·파일 0600, `daylog.lock` flock 아래 읽기→병합→임시 파일→rename (statusline_tap.py와 같은 패턴,
  Rust는 `File::try_lock` = flock이라 Python 서버와 앱이 동시에 써도 됨 → MSRV 1.89). 쓰기는 바뀐 게 있을 때만(활동 시각은 60초 단위 또는 조용해진 뒤 한 번).
  14일 지난 파일·1시간 지난 임시 파일은 하루 한 번 정리. 텍스트는 `redact()` 후 60자(프로젝트 이름·프롬프트 요약), 읽을 때도 다시 마스킹.
- **판정**: 하루 = 현지 04:00~다음 날 04:00. 준비됨 = 완료 ≥1 + 마지막 활동이 그날 정오 이후 + 그 뒤 45분 무활동(재활동하면 풀리고 `ready_at`이 바뀜).
  지난 날은 완료가 있으면 준비됨(`quiet` 또는 `day-over`). `unseen` = `seen < ready_at` → 다음 날 오늘 응답의 `prev.unseen`으로 "어제 일보".
  수동 퇴근·미리보기·퇴근 시각 옵션은 프론트 몫(`quiet`·`last` 제공).
- **API**: `GET /daylog?day=`(state를 한 번 만든 뒤 집계), `POST /daylog/seen`(유일한 쓰기 엔드포인트 — JSON 본문만·1KB·Origin/Sec-Fetch-Site 같은 출처만, OPTIONS·CORS 없음),
  Tauri `get_daylog`(메인·위젯)·`daylog_seen`(메인). 계약 `types/daylog.d.ts`. `/state`는 바뀌지 않는다.
- **검증**: fixture 끝에 일지 시나리오(03:59:59/04:00:00 경계, 질문 대기, 끝난 뒤 알림, 큰 일, 정전 열림·리셋에 닫힘, 어제 seen, 13:59:59/14:00 준비 경계, 잘못된 날)
  → `daylog.*.json` 8개 동등성(23/23). 단위: `daylog.rs` tests·`tests/daylog.rs`·`scripts/test_daylog.py`(여러 프로세스 동시 쓰기·HTTP CSRF 포함).

**병렬 진행 흐름**
```
지금(★, Rust 없음):  P0-a ─┐
                     P0-b ─┼─ P0-c ─ P0-d
                           └─ P2-a ─ P2-b ─┬─ P2-c ─┐
                                           ├─ P2-d  │
                                           └─ P4-a  │      P4-b
Rust 설치 후:   P1-a ∥ P1-b ∥ P1-d ∥ P1-e  → P1-c, P1-f     │
                       └──────────── P3-a ─ P3-b ∥ P3-c ∥ P3-d ─ P4-c ─ P4-d
```
에이전트 여러 개에 나눠 맡길 때 파일이 겹치지 않는 묶음: {P0-b, P0-c, P0-d} / {P2-a, P2-b} → {P2-c} ∥ {P2-d} ∥ {P4-a} / {P1-a, P1-c} ∥ {P1-b} ∥ {P1-d} ∥ {P1-e}. **같은 시간에 core.js를 건드리는 작업은 P2-a 하나로 직렬화한다.**

**초기 PoC 목록(P3-a 착수 첫날)**: ① `wrmode://` iframe에서 IPC가 없는지(mac·win), CSP가 적용되는지, WebRTC가 나가는지 ② 투명·무테·always-on-top 위젯이 모든 Space·전체 화면 앱 위에 뜨는지 ③ 미서명 앱의 알림 권한 ④ `wr-hook.exe` 콘솔 깜빡임 ⑤ exec form `args`를 지원하는 최소 Claude Code 버전 ⑥ `notify` 감시 CPU 사용량.

### 8.5 MCP 보고 (PR 1 `feat/mcp-server`: 사이드카 + 기록·읽기 + state / PR 2 `feat/mcp-connect`: 설정 화면 + Claude Code·Codex·Antigravity 연결 / PR 3 `feat/mcp-studio`: 스튜디오 화면·칭찬 한마디·오늘 집계·일지)

- **구조**: AI CLI → stdio(JSON-RPC) → `wr-hook mcp`(훅과 같은 바이너리의 하위 명령, 새 sidecar 없음) → `reports.jsonl` append → `wr-core` `providers/mcp.rs`·server.py `read_reports()`.
  리스너·네트워크 없음(§7.1 그대로). `events.jsonl`에 섞지 않는 이유: 구버전 리더가 모든 줄을 Claude 세션으로 만들기 때문(새 이벤트 이름 → 유령 세션).
- **도구 2개**: `waitscape_status`(state `working|asking|done`, `title` ≤60, `step ≤ total ≤ 99`, done 때 `big`·`cheer` ≤60), `waitscape_board`(≤4줄 × 32자, 0부터 `done`).
  스키마 `additionalProperties:false`, annotations는 정직하게(readOnly false·destructive false·idempotent true·openWorld false). 서버가 다시 검증한다(클라이언트가 스키마를 강제하지 않을 수 있음).
- **프로토콜**(legacy 개정 2025-11-25·2025-06-18·2025-03-26·2024-11-05, 없으면 2025-11-25): `tools` capability 선언, `server/discover`(2026-07-28 probe) 포함 모르는 메서드는
  초기화 전후 상관없이 즉시 -32601(이중 지원 클라이언트가 initialize로 되돌아감, -32020~-32099는 쓰지 않음), 알림·클라이언트 응답은 무응답, batch -32600, 파싱 실패 -32700,
  모르는 도구 -32602, 필수 인자·enum 위반은 `isError:true` + 고칠 방법 한 줄, 길이·범위 초과는 조용히 정화 후 `ok`, 쓰기 실패·패닉도 `ok`(요청마다 catch_unwind — 모델 재시도 방지를 위한 의도적 예외).
  stdout은 compact JSON 응답만(`#![deny(clippy::print_stdout)]`), stdin 한 줄 1MB 상한·`\r\n` 허용. 2026-07-28(handshake 없음) 지원은 PR 4 후보.
- **기록 줄 v1**: 모든 줄에 `v, ts, type(hello|status|board|bye), key, provider, cwd, pid, (unix ppid), wr`(자기완결 — 창 밖으로 밀려도 세션을 잃지 않음), hello에 `client`·`proto`.
  선택 필드 `parent`(이 작업을 시킨 세션의 key·sid, #58 — `wr-hook report`·`run`만 씀). 두 리더는 모르는 필드를 무시하므로 v는 1 그대로이고, 화면 연결은 아직 없음(데이터만).
  `wr-hook report`(한 줄)·`wr-hook run`(명령 감싸기)은 같은 기록 함수(`mcp::append`)·같은 정화를 쓰고 `pid`는 호출자가 고른다(report `--pid`, run은 래퍼 자신. report에 `--pid`가 없으면 pid 없음 → bye·STALE로만 끝남).
  `key = <provider>-<pid>-<시작 ms>-<난수 8hex>`. 쓸 때마다 열기·한 번 write·닫기(회전 대비, 부분 쓰기 재시도 없음), 줄 2KB 상한(넘으면 보드 줄부터 덜어 냄).
  속도 제한: 버스트 6·초당 0.5 토큰, 같은 내용 생략, state 전이는 별도 버킷(버스트 10·초당 1)으로 즉시, 넘치면 종류별 **최신 1건 보류** → 토큰이 차면(타이머) 또는 EOF 때 기록(마지막 상태를 버리지 않음).
  done을 기록할 때는 보류된 보드를 먼저 쓴다. unix는 SIGTERM·SIGINT·SIGHUP을 `signal()` FFI로 받아 플래그만 세우고 루프(200ms 확인)가 보류분·`bye`를 쓰고 끝낸다.
  Windows는 신호 처리 생략: CLI가 쓰는 TerminateProcess는 잡을 수 없고, Ctrl 이벤트는 콘솔을 공유할 때만 와서 파이프로 띄운 사이드카에는 보통 없다.
  id는 문자열·64비트 정수만(null·객체·실수·더 큰 정수는 -32600), `--reports`가 상대 경로면 무시하고 다음 순위.
  경로는 `--reports <절대 경로>` > `WAITING_ROOM_REPORTS` > `CLAUDE_CONFIG_DIR` > `~/.claude` — Codex는 MCP 서버에 기본 허용 env만 넘기므로 등록 명령은 항상 인자로 준다.
- **정화**(사이드카·훅 분기·두 리더 공통 = `wr-core/src/report.rs` ↔ `mcp_report.py`, 공유 fixture `fixtures/mcp/sanitize.json`): Cc 제거(개행·탭→공백) → 형식 문자 Cf 표
  (soft hyphen·LRM/RLM·word joiner·bidi·제로폭·BOM·태그 문자 등, 두 언어에 같은 표 `FORMAT` — 토큰 사이에 끼워 마스킹을 피하는 것 방지) 제거 →
  NFC 정규화(Rust `icu_normalizer`, Python `unicodedata` — NFD 한글 자모·결합 악센트를 완성형으로, 절단도 완성형 기준) → 공백 정리 →
  `redact()` → 문자 수(`chars()`=파이썬 `len`) 절단. 리더도 같은 정화를 다시 한다(같은 사용자의 다른 프로세스가 쓸 수 있는 파일).
- **Claude 세션 매칭 = 훅 우선**: 우리 `PreToolUse` 훅(matcher 없음)이 `mcp__waitscape__*` 호출을 보면 `icon/text/kind` 대신 정화한 `report`를 기록한다(정확한 sid, `/clear` 무관).
  리더는 이 줄을 도구로 세지 않고(말풍선·활동·종류 집계 없음) `session.report`로 접는다. `aid`(서브에이전트) 보고는 버리고, 새 프롬프트에서 비운다. hook.py도 같은 줄(골든 `fixtures/mcp/hook_cases.json`).
  사이드카의 `provider:"claude"` 줄은 세션을 만들지 않는다. **훅이 설치·동작 중이면(설정에 등록됐거나 훅 이벤트가 있음) 전부 버린다** — 붙이면 같은 폴더의
  다른 창(A 보고가 B에)·새 프롬프트에서 비운 지난 턴 보드·서브에이전트 계획이 엉뚱하게 붙는다(PR #35 리뷰, `tests/mcp_orphans.rs`). 훅이 없을 때만 보고가 없고
  cwd(`CLAUDE_PROJECT_DIR`)가 같은 활성(10분) Claude 세션이 하나뿐이고 그 세션의 마지막 프롬프트 뒤 보고일 때 붙인다. 못 붙이면 버림(Q3).
- **그 밖의 프로바이더**: key별 세션(`source:"mcp"`, `provider` codex|gemini|other — Antigravity CLI는 Gemini 계열이라 `gemini`(소품 공유), status working/needs_input(note=title)/done/idle). bye 또는 사이드카 pid가 사라지면(unix `kill(pid,0)`, Windows `OpenProcess`) 끝,
  30분 무보고 working은 `confidence:"guess"`, 6시간 STALE. `providers[]`에는 지금 보이는 도구만 `{report: true}`로.
  표시 이름: id는 계약대로 `gemini`, 보이는 Gemini 세션이 **모두** hello의 `clientInfo.name`에 "antigravity"가 있을 때만 `name: "Antigravity"`(근거가 없거나 섞이면 "Gemini". Rust만 — server.py는 `providers`를 내지 않음).
- **오늘 집계·일지 (PR 3)**: MCP 세션의 working→done = 한 턴(`today.done`·`waited`, 일지 `turns`의 `job` = 마지막 title), asking → 다음 보고 = 질문 대기(`waits`), key별 마지막 보고 = 활동(`act`).
  세션 키가 STALE로 지워져도 남게 리더가 따로 최근 200개(`FEED_MAX`)를 기억하고, 같은 전이는 다시 읽어도 한 번만. 일지 피드는 도구 id별(`Snapshot::days` ↔ `report_day()`)이라 provider가 codex·gemini로 남는다.
  Claude 사이드카·숨길 프로젝트는 빠진다. done 보고의 `big` → 턴의 `by_ai`(10분 미만이어도 큰 일), `cheer` → 턴의 `cheer`(마스킹 후 60자). 훅 Claude 세션은 그 턴 안에서 done을 보고했으면 Stop 턴에 같은 표시.
  같은 턴이 먼저(트랜스크립트 등) 기록돼 있으면 AI 표시만 합친다. 보고 읽기가 꺼져 있으면 훅으로 온 표시도 일지에 남기지 않는다. `/daylog`에 `cheers`(최근 5개)·`big[].by_ai`.
- **화면 (PR 3, 스튜디오)**: AI 보드는 그 층 책상 배치의 왼쪽 벽(회의 보드 자리)에 동물 글씨체로 써 내려감(줄이 바뀌면 다시 쓰고 done만 바뀌면 ✓), "✍️ AI가 씀" 딱지.
  서브에이전트 회의 보드가 우선(회의가 끝나 책상으로 돌아오면 다시 씀), 세션이 끝나고(done·idle) 보드가 10분 안 바뀌면 지우개로 지우고 내림. 🤫 문구 숨김이면 물결 낙서(✓는 그대로).
  단계 = 책상 앞 명패 "3/5"(마지막 단계 금색) + 간판 칸, 제목은 명패·보드에 마우스를 올리면 그 층 하단 캡션(로비는 이름표 옆 칩 → 하단 자막, title 툴팁 없음).
  MCP 세션 간판은 AI 제목. 큰 일(`report.big`) 완료 = 기존 큰 완료 연출 + 사장님 칭찬 말풍선(보고마다 1번·90초에 1번·5.5초). 사장님 말풍선 우선순위: 질문 해결 인사 > **칭찬 한마디** > 전력 > 새 버전 > 일보
  (짧고 드문 이벤트라 긴 상태 알림인 전력보다 앞, 질문하러 와 있으면 미뤘다가 1분 넘으면 생략). AI 문자열은 `esc()`·textContent로만. 공유 카드(일보)에는 AI 한마디를 기본으로 넣지 않는다(설정 "카드에 AI 한마디", 🤫면 항상 뺌).
  (PR #38 리뷰) 글자 단위 연출·자르기(`cut`·`fitW`·카드 `fit`)는 그래핌 단위(`Intl.Segmenter`, 없으면 정규식 폴백) — 결합 기호·국기·피부톤이 쪼개지지 않음.
  아랍·히브리 등 오른쪽→왼쪽·연결 문자가 있는 줄은 글자 span 대신 줄 하나(`dir="auto"`)를 쓰는 방향으로 clip해서 드러냄.
  카드·복사 텍스트의 AI 한마디는 같은 44글자로 맞추고 카드는 두 줄 줄바꿈(넘치면 …”), 칭찬은 사장실에 직원이 와 있는 동안(질문·감사·돌아가는 중) 보류했다가 한 번만.
  OS 알림 본문에 MCP 세션의 AI 제목이 나갈 때는 "✍️ Codex: …"처럼 출처를 붙인다(core 기본 문구·스튜디오 둘 다).
- **state(1.2, 추가만)**: `session.report`(@unstable, 외부 모드 브리지가 뺌), `source:"mcp"`, `ProviderCapability "report"`, `state.mcp.last_report_age`(digest에서 제외). `/state` 기존 필드 의미는 그대로.
- **켜기**: 앱 설정 `mcpReports`(기본 꺼짐 — 꺼지면 읽지도 내보내지도 않음, 설정 → AI 연결 → "MCP 보고 (실험)" 스위치). server.py·wr-server는 `WAITING_ROOM_REPORTS=off`가 아니면 읽는다.
- **회전**: 리더(Rust) 한 곳에서 1MB 넘으면 끝까지 읽은 뒤 `reports.1.jsonl`로 rename + 오프셋 0. 파일 식별자(unix dev+inode, 그 밖 생성 시각)나 크기가 바뀌면 처음부터. server.py는 회전하지 않는다.
- **Windows 교체**: 사이드카가 세션 내내 떠 있으므로 `ensure_bin`은 기존 `wr-hook.exe`를 `wr-hook.old-<ms>-<pid>.exe`로 비켜 놓고(실행 중이어도 이름 변경은 됨) 새 파일을 넣는다. 옛 파일은 다음 번에 정리.
  로직은 `wr-core/src/binswap.rs`(Windows CI가 도는 크레이트)에 두고, wr-hook 통합 테스트가 실제 사이드카를 띄운 채 교체해 본다.
  macOS/Linux는 rename 덮어쓰기(실행 중 프로세스는 옛 inode) — 구버전 사이드카가 계속 쓸 수 있어 줄에 `v`·`wr`를 넣고 리더는 모르는 `v`를 버린다.
- **자동 허용(🔴 도구 단위)**: `mcp_config.rs`가 `permissions.allow`에 `mcp__waitscape__waitscape_status`·`mcp__waitscape__waitscape_board` **두 개만** 넣고 뺀다(서버 전체 `mcp__waitscape`는 쓰지 않음,
  사용자가 직접 넣은 규칙은 그대로). 연결 명령 `claude mcp add -s user waitscape -- <bin> mcp --reports <abs>`(`~/.claude.json`은 직접 쓰지 않음).
- **연결·해제 (PR 2, `app/src-tauri/src/mcp_connect.rs`)** — 대상은 Claude Code·Codex CLI·Antigravity CLI(Gemini CLI는 2026-06-18 Antigravity CLI로 대체되어 넣지 않음):

  | CLI | 바꾸는 곳 | 근거 |
  |---|---|---|
  | Claude Code | `claude mcp add/remove -s user waitscape`(CLI가 `~/.claude.json`을 씀, 실행 전 사본 백업) + 선택(기본 체크) `settings.json` `permissions.allow` 도구 2개 | https://code.claude.com/docs/en/mcp · https://code.claude.com/docs/en/permissions |
  | Codex CLI | `$CODEX_HOME/config.toml`(기본 `~/.codex/config.toml`) `[mcp_servers.waitscape]` `command`·`args`·`enabled_tools`(도구 2개)·`env_vars`(멀티플렉서 ID env만, #37) — `toml_edit`로 주석·순서 보존 | https://learn.chatgpt.com/docs/extend/mcp?surface=cli |
  | Antigravity CLI | `~/.gemini/config/mcp_config.json` `mcpServers.waitscape` `command`·`args`·`enabledTools`(도구 2개). 전용 add 명령·trust 옵션은 문서에 없음. Windows 경로(`%USERPROFILE%\.gemini\config\…`)는 문서에 없는 [추정] | https://antigravity.google/docs/mcp?tab=cli |

  절차: [연결…]/[해제…] → 웹 미리보기(`mcp_plan`, 읽기만 — **우리 항목 줄만**: 파일 경로 + 넣을/뺄 블록 + "그 외 내용은 그대로/서식만", 문맥 줄 없음, `report::clean` 마스킹) → [적용] → 백엔드가 계획을 다시 계산해 **네이티브 확인 창** → (연결이면 `ensure_bin`) →
  `<이름>.bak-waiting-room-<ms>` 백업 → mtime 재확인 → 임시 파일 + rename(`hooks_config::write_raw`, 권한·심볼릭 링크 유지). 설정 파일이 없거나 해석할 수 없으면 쓰지 않고 오류(Claude `settings.json`만 없으면 `{}`로 새로 만들고 해제 때 빈 파일이면 지움), CRLF는 CRLF로,
  같은 이름의 다른 서버가 있으면 건드리지 않음. 연결 기록 `<Claude 루트>/waiting-room/mcp-connect.json`: CLI별로 **우리가 새로 넣은 것**(서버 항목·권한 규칙·부모 키)과
  **마지막 쓰기**의 전후 sha256·백업 경로(다시 연결하면 갱신). 해제는 기록에 있는 것만 지운다(연결 전부터 있던 항목은 "직접 등록함"으로 남김). 파일이 마지막으로 우리가 쓴 바이트 그대로일 때만 백업을 되돌려 **바이트 동일**,
  그 사이 다른 내용이 바뀌었으면 우리 항목만 구조적으로 지운다(JSON 키 순서·들여쓰기·끝 줄바꿈, TOML 주석·순서 보존). Codex `approval_mode`는 값 의미가 문서에 없어 쓰지 않는다.
  Claude: CLI가 성공하면 파일 쓰기 전에 기록부터 저장(뒤가 실패해도 해제 가능), 옛 경로 고치기에서 remove 뒤 add가 실패하면 `claude mcp add-json`으로 원래 등록 복구. 수동 명령 안내는 공백 경로를 따옴표로.
  CLI 찾기: Finder로 연 앱은 셸 PATH가 없으므로 로그인 셸 PATH(1회) + 흔한 설치 위치에서 찾고, 실행은 셸 없이 절대 경로 + 인자 배열, 10초 제한, 오류 문구는 마스킹 후 한 줄.
  Tauri 명령 `mcp_status`·`mcp_plan`·`mcp_apply`는 메인 창 전용(capabilities `main.json` + `main_only`), 연결은 `mcpReports`가 켜져 있을 때만.
- **검증**: `wr-hook/tests/mcp_script.rs`(실제 바이너리: discover→initialize→initialized→ping→tools/list→tools/call→EOF, 버전 협상, 오류표, stdout 위생, 1MB·잘못된 UTF-8·`\r\n`,
  경로 우선순위(env 비움), stdin을 연 채 1초 안 응답, 8프로세스×200줄 동시 append), 단위(coalesce·전이·2KB, 회전, 죽은 pid, 끄기·digest, 훅 report 재생, 권한 규칙),
  동등성 23/23에 MCP 시나리오(Codex 턴·큰 일·보드, Gemini guess·재마스킹, hello만, bye, STALE, 숨김, Claude 훅 보고·사이드카 붙이기·쌍둥이 cwd 버림, 잘못된 줄),
  `scripts/test_mcp_reports.py`(정화 fixture·hook.py 골든·리더·오늘 집계/일지 피드), PR 3: 단위(`day_feed_and_today`·`antigravity_display_name`·`ai_big_and_cheers_merge` ↔ `test_daylog.py` `test_ai_report`),
  동등성 fixture에 훅 Claude 턴의 done(big·cheer) → Stop(`fx-mcp-cheer`)과 Codex 턴의 일지·오늘 집계.

### 8.6 🙈 눈치 모드 (#51, `feat/nunchi`)

- **상태 한 곳**: 설정 `nunchi`(+ `nunchiKey`·`nunchiLong`). 켜고 끄는 경로(전역 단축키·트레이·B 키·설정 화면·위젯)는 모두 `save_patch` → `settings` 이벤트 → 창마다 코어 `CoreNunchi.set`.
  백엔드가 알아야 하는 것(알림 문구·효과음·창 제목·메뉴바 요약)이 있어 settings에 둔다. 브라우저 버전은 이 브라우저에만(B 키만).
- **전역 단축키**: `tauri-plugin-global-shortcut`을 Rust에서만 등록(웹 capabilities 없음, `nunchi.rs`). 등록은 작업 스레드(플러그인이 메인 스레드 작업을 기다림).
  누르면 큰 창이 보일 때는 그 창 코어에 맡긴다(`nunchi-key` 이벤트) — 전환 연출 중에 또 누르면 되돌리지 않고 "즉시 끝"이어야 하는데 연출 단계는 웹만 안다. 큰 창이 숨어 있으면(미니 보기·트레이) 백엔드가 바로 토글.
  다른 앱이 선점하면 등록 실패 → 로그 + `nunchi_status`(메인 창 전용) → 설정 카드 안내와 [다시 시도](`nunchi_retry`, 키가 같아도 재등록). macOS는 Carbon 핫키라 손쉬운 사용 권한이 필요 없다(추정, 실기기 확인 필요).
  교착 방지(#58 리뷰): 등록·해제는 플러그인이 메인 스레드 작업을 기다리므로 상태 락을 쥔 채 하지 않는다(계획 → 락 해제 → 등록 → 기록), 상태·재시도 명령은 async(메인 스레드 밖).
  키는 실행 시점의 설정에서 다시 읽고, 형식(수식키 1개 이상 + 키)이 틀리면 저장 자체를 거절한다. 토글은 settings 락 안에서 읽고 뒤집는다(`save_patch_with`).
- **소리·알림**: 눈치 모드면 코어 `audio()`가 null, 이미 만든 AudioContext는 suspend(햄찌 음악 등 모든 모드), 외부 모드 iframe에는 quiet로 전달. 모드가 직접 보내는 알림(kind 없음, 외부 모드 포함)은 막고 콘솔에만.
  같은 창에서 방금(0.8초) 바꾼 값보다 늦게 도착한 `settings` 이벤트는 무시하고 잠시 뒤 백엔드 값으로 한 번 맞춘다(B 연타 깜빡임). 켤 때 열린 설정·대화상자는 닫는다.
- **단축키 두 층**: 창 안 = ⌘1(맥)/Ctrl+1 · B(판정은 nunchi.js `lib.hotkey` 순수 함수 — 수식키 없는 1~9는 모드 전환, 입력란 무시. 위젯·PiP·외부 모드 iframe도),
  전역 = 맥 `Control+KeyQ`(⌃Q, 맥북에서 한 손으로 쉬움 — ⌃⌥`는 어렵다는 피드백), 윈도우·리눅스 `Alt+Backquote`(Alt+`, 숫자 1 왼쪽 키 — Ctrl+Q=종료·Alt+Z=NVIDIA 오버레이·⌃`=VS Code 터미널은 피함).
  전역은 설정 스위치 `nunchiGlobal`(기본 켜짐)로 끈다 — `effective_key`가 빈 키로 바꿔 등록만 해제하고 `nunchiKey`는 보존(다시 켜면 그 키로), 트레이 표시도 숨김. 끄면 창 안 단축키만. 브라우저 판은 ⌘1·Ctrl+1이 탭 이동에 쓰일 수 있어 화면 힌트는 B.
  macOS 15부터 RegisterEventHotKey가 수식키가 Option만·Option+Shift만인 조합을 실제 키 입력에서 막는다(키로거 방지 — 등록 "성공" 로그가 나오지만 눌러도 핸들러가 불리지 않고 System Events 합성 키만 옴, 실기기 확인).
  그래서 `check_key_for(key, mac)`가 맥에서 그런 조합을 거부한다(설정 화면 안내). 이전 `migrate_key`(nunchiKeyV 4): 첫 기본값 `CmdOrCtrl+Shift+H`, 맥의 `Alt+Backquote`·`Control+Alt+Backquote` → 새 기본값.
  global-hotkey 0.8의 `Backquote`는 물리 키 코드라 한국어 자판에서 그 키가 ₩로 찍혀도 같은 키(맥 kVK_ANSI_Grave · 윈도우 VK_OEM_3). 옛 기본값은 한 번만 옮긴다(그 뒤 사용자가 옛 조합을 고르면 유지).
- **표 정보**는 state에 이미 있는 것만: `ctx`(컨텍스트 %)·`todos`·`report.step/total/title`(MCP)·`agents`·`health`·한도 `pace`. 오늘 요약은 코어 `Core.api.daylog("today")`(일보와 같은 4시 경계)를 눈치 화면이 보일 때 1분마다,
  없으면 state의 `done_today`·끝난 세션 `run`만. 이동 버튼은 core-lib `muxName(s)`(스튜디오 완료 보고·질문 말풍선과 같은 판단) — `jump.mux`가 없는 세션은 `open_terminal`이 폴더로 새 터미널을 열어 기대와 달라서 버튼을 두지 않는다.
- **밝기**: 설정 `nunchiTheme` = system(prefers-color-scheme 실시간) | light | dark — 큰 화면·위젯·PiP 목록·블라인드·고양이가 한 값을 따른다.
- **위젯 창 수명**: 미니 보기 → 큰 화면 때 위젯을 파괴하지 않고 `hide()`, 다시 미니 보기면 `show()`(모드가 다르면 해시만). ✕·⌘W도 `prevent_close` 후 숨김.
  이유: 실기기 크래시(#60) — 위젯 WKWebView를 닫은 직후 WebKit `RemoteScrollingCoordinatorProxy`가 그 뷰의 대기 중 스크롤 업데이트를 읽어 SIGSEGV(메인 스레드, 우리 프레임 없음).
  화면이 실제로 바뀌는 전환은 `windows::guarded` 한 곳에서 하나씩, 끝난 뒤 `SETTLE`(350ms) 동안 무시(⌘2·트레이·버튼·우클릭 모두 to_mini/to_big을 거침). 숨은 위젯 웹은 `widget-visible`로 멈춤·재개.
  Windows(WebView2)는 창을 새로 만들지 않으니 이벤트 핸들러 안 창 생성 교착 위험이 오히려 준다.
- **우클릭 메뉴(앱)**: 웹 `contextmenu` → `context_menu`(async, 메인·위젯 권한) → `ctxmenu::spec`(순수 함수, 테스트) → tauri `Menu` + `popup_menu`(메인 스레드 작업은 tauri가 맡음).
  고른 항목은 트레이와 같은 `tray::on_menu`(메뉴 이벤트는 앱 전체로 옴), 세션 이동·경로 복사는 우클릭한 창 웹에 `ctx-action`. 입력란은 기본 편집 메뉴, 개발 빌드는 Shift+우클릭으로 WebView 기본 메뉴.
  눈치 화면 [설정]은 설정 창을 그 위에 연다(켜는 순간만 열린 대화상자를 닫음). 위젯 ⚙·위젯 우클릭 "설정…"·위젯 ⌘,는 `menu_action("settings-mini")`(허용 목록 settings·settings-mini·open만).
  **미니에서 연 설정은 닫으면 미니로**: `settings-mini`가 `windows::mark_return_mini`(위젯 해시 모드 기억) 뒤 큰 화면 + `open-settings {fromMini}`. 설정을 닫으면 웹이 `return_mini` → `to_mini`(게이트에 걸리면 SETTLE 뒤 한 번 더).
  사용자가 그 사이 다른 화면 동작(트레이 큰 화면·미니 보기·모드·설정, 설정 안 모드 변경)을 하면 표시를 지운다(`clear_return_mini`). 설정 머리 아래 "닫으면 미니 보기로 돌아가요".
- **브라우저 PiP**(미니 보기·포켓을 Document PiP로 띄운 창): `Core.mount(doc)`로 올린 추가 문서마다 작은 목록을 붙여 함께 덮는다(연출 없이 바로).
- **화면은 코어**(`web/core/nunchi.js·css`): 어느 모드에서든 같은 업무 화면·블라인드. 모드는 선택 훅만 — 인스턴스 `nunchi(ev)`(퇴장·출근 연출)·`nunchiOrder()`(행 순서), 정의 `nunchiCat(doc)`(구석 고양이, 다른 모드를 보고 있어도 스튜디오 스크립트만 불러 스프라이트를 빌림).
  긴 연출은 스튜디오만, 다른 모드는 블라인드만. 눈치 화면이 블라인드 위(z), 덮인 동안 스튜디오·미니 보기는 정적(1초마다)이라 비용이 거의 없다.
- **스튜디오 연출 = 정식 상태**: 시안의 frame() 훅 대신 actor `goal: "out"`, `loc: "out" | "door"`, `lift`(walk/wait/board)와 엘리베이터 상태 기계(idle → move → open → hold → close, SCAN, 여러 명)로.
  기존 질문 흐름도 같은 엘리베이터·대기 자리를 쓴다(통로 칸에 떠 있지 않고 자기 층 바닥에서 기다림 — 사용자 피드백). 직원 층은 통로 바로 왼쪽이 화분·바닥 2 칸이라 첫 빈자리가 책상과 화분 사이.
- **알림**: `detect.rs` `Alert::plain` — 제목 = 프로젝트, 본문 = 상태 한 줄(완료는 실행 분), 이모지·프롬프트·질문 내용 없음, 소리 없음. 메모 알림(웹)은 메모 내용만. OS가 붙이는 앱 이름(Waitscape)은 바꿀 수 없다.

---

## 9. 열린 질문 (사용자 결정 필요) + 추천

| # | 질문 | 추천 |
|---|---|---|
| Q1 | **앱 이름·번들 식별자**. "Claude"를 이름에 넣으면 상표 문제가 생길 수 있음 [추정] | 이름은 중립적으로(예: "모찌 대기실 / Mochi Waiting Room"), 설명에만 "for Claude Code (비공식)"을 쓴다. 식별자는 개인 도메인이나 `io.github.<계정>.waitingroom` |
| Q2 | 공개 저장소 위치·라이선스·커밋 저자 | 개인 GitHub 계정, **MIT**(PokeTokenBar와 같고 모드 생태계에 유리), 저자 이메일은 GitHub noreply(`34022877+jhkwim@users.noreply.github.com`) |
| Q3 | 사용자 모드 폴더 | 앱 데이터 폴더(OS 관례, 앱 삭제와 함께 정리). 관리 화면에 [폴더 열기] 제공. 이벤트 로그만 `~/.claude/waiting-room/`에 유지 |
| Q4 | 한도 조회 기본값·맥 키체인 | 기본 꺼짐 → 온보딩에서 "켜기 + 키체인에서 한 번 읽기"를 권한다. 읽은 토큰은 만료까지 메모리에서 재사용 |
| Q5 | 외부 모드를 "신뢰해서 직접 실행"하는 옵션 | **v1은 없음**. 샌드박스만 둔다(내장 모드 PR로 기여하면 내장으로 승격) |
| Q6 | 맥에서 Dock 아이콘 숨김(메뉴바 전용) 기본값 | 기본은 Dock 표시, 설정에서 끌 수 있게 |
| Q7 | Python 제거 시점 | P1 동등성 통과 → `legacy/`로 → 다음 릴리스에서 삭제 |
| Q8 | 최소 OS | macOS 13+, Windows 10 1809+ (color-mix 때문) |
| Q9 | UI 언어 | 외부 배포라면 v1부터 ko/en 문자열 테이블(코어·관리 화면·알림). 모드 안 문구는 모드가 결정 |
| Q10 | statusline 탭(`--wrap`) 제공 | v1 미제공. 사용량 API로 충분하고 사용자 statusline을 건드리는 위험이 큼 |
| Q11 | 트랜스크립트 전용 모드의 "입력 필요" 추정 알림 | 기본은 "확인 필요할 수도" 약한 알림. 훅 설치를 권하는 배너 한 줄 |
| Q12 | 서명·공증 시점 | 사용자 피드백 뒤에 결정. Apple Developer($99/년)가 생기면 공증을 먼저 하고, Windows 서명(인증서 비용)은 그다음 |

---

### 부록 A. 참고 출처
- Tauri 2 설정 레퍼런스(`macOSPrivateApi`, `externalBin`, bundle targets, security): https://v2.tauri.app/reference/config/
- Tauri 2 capabilities(창 label 기준, `remote.urls`, Linux/Android iframe 구분 불가): https://v2.tauri.app/security/capabilities/
- 커스텀 프로토콜 origin(mac `<scheme>://localhost`, win `http://<scheme>.localhost`): https://docs.rs/tauri/latest/tauri/struct.Builder.html
- 공식 플러그인 목록(notification, autostart, window-state, single-instance, updater 등): https://v2.tauri.app/plugin/
- iframe IPC 취약점·수정(CVE-2024-35222 / GHSA-57fm-592m-34r7): https://github.com/advisories/GHSA-57fm-592m-34r7
- Claude Code 훅(셸 실행 방식, `args` exec form, `shell` 필드, Notification matcher): https://code.claude.com/docs/en/hooks
- PokeTokenBar(MIT) 분석 결과: 이전 단계 조사(사용량 API 헤더·폴링·백오프·자격증명 우선순위)

# 프로젝트 요약 (리뷰어가 먼저 읽는 문서)

**Waitscape** — AI 코딩 에이전트(현재 Claude Code)의 세션을 실시간으로 보여 주는 **비공식 로컬 대시보드**. 개인 MIT 오픈소스 프로젝트(공개 저장소). 상용 서비스가 아니며 사용자 데이터를 서버로 보내지 않는다.
코드는 Claude가 쓰고, Gemini가 교차 리뷰하고, Claude가 지적을 검증하고, 사람이 승인한다.

## 1. 구성 요소

| 영역 | 위치 | 상태 |
|---|---|---|
| 웹 프론트 (빌드 없는 순수 JS) | `web/` — `core/`(코어·데이터 계층·설정 화면·샌드박스 브리지), `sdk/`(샌드박스 iframe 안 SDK), `modes/<id>/`(모드 패키지) | 구현됨 |
| Python 참조 백엔드 | `server.py`(HTTP, `/state`·`/trace`·`/modes`·`/_modes`), `hook.py`(Claude Code 훅), `usage_poll.py`, `statusline_tap.py` | 구현됨. P1 이후 **동등성 기준(oracle)** — 고치지 않음 |
| 공개 계약 (Mode API v1) | `types/state.d.ts`·`trace.d.ts`·`ctx.d.ts`·`mode.schema.json`·`CHANGELOG.md` | 고정. minor=추가만, major=제거·의미 변경 |
| 동등성 fixture | `fixtures/`(합성 데이터만), `scripts/snapshot.py`·`compare.py` | Python 결과 = `fixtures/expected/` |
| Rust 백엔드 (P1) | `crates/wr-core`(읽기·state·trace·마스킹·한도·프로바이더), `crates/wr-hook`(훅 CLI), `crates/wr-server`(브라우저용 HTTP) | PR 진행 중 |
| 데스크톱 앱 (P3) | `app/src-tauri`(Tauri 2: push·트레이·위젯·OS 알림·훅 설치·`wrmode:` 스킴·zip 설치) | PR 진행 중 |
| CI·릴리스 | `.github/workflows/`(`ci.yml` 파이썬·시크릿·작성자, `rust.yml` Rust, `release-prep.yml`·`release.yml` 빌드·초안 릴리스) | 구현됨 |

## 2. 데이터 흐름

```
Claude Code ──(훅 stdin JSON)──▶ hook.py / wr-hook ──append──▶ ~/.claude/waiting-room/events.jsonl
Claude Code ──(직접 기록)──────▶ ~/.claude/projects/<인코딩 경로>/<sid>.jsonl (+ <sid>/subagents/agent-*.jsonl)
                                         │  (증분 읽기: 오프셋 캐시, 크기 감소 시 처음부터, 불완전한 마지막 줄 보류)
                                         ▼
                     server.py / wr-core  ──▶ state(세션·토큰·health·한도) / trace(단계·레인·phase)
                                         │      ※ 자유 텍스트는 redact() → 경로 축약 → clip() 순서
            ┌────────────────────────────┴───────────────────────────┐
  브라우저: HTTP 127.0.0.1 (/state 1초 폴링)              앱: Tauri IPC + push 이벤트 (HTTP 서버 없음)
            └──────────────▶ web/core (Core.api) ──▶ 내장 모드(메인 문서) / 외부 모드(샌드박스 iframe, postMessage 브리지)
선택: 사용 한도 ── GET https://api.anthropic.com/api/oauth/usage (OAuth 토큰, 기본 꺼짐)
앱 업데이터 ── GET https://github.com/jhkwim/waitscape/releases/latest/download/latest.json (0.4.0까지는 waitscape-releases) (토큰 없음, 기본 켜짐, 설정에서 끔)
            └─ 사용자가 [지금 업데이트]를 누를 때만 같은 릴리스의 설치 파일을 내려받고 minisign 서명 검증
  ※ 외부 통신은 이 둘뿐(전체 목록 ARCHITECTURE.md §7.1)
```

## 3. 신뢰 경계 (공격자 모델)

1. **악성 웹페이지 ↔ 로컬 HTTP 서버**: 사용자가 연 아무 사이트나 `http://127.0.0.1:<포트>`로 요청 가능. 방어 = 127.0.0.1 바인딩 + `Host` 헤더가 `localhost:<포트>`/`127.0.0.1:<포트>`만 허용(DNS 리바인딩) + CORS 헤더 없음 + GET/HEAD만(상태 변경 없음 → CSRF 없음).
2. **외부 모드(사용자 설치 코드) ↔ 호스트**: `sandbox="allow-scripts"` iframe(opaque origin) + CSP `connect-src 'none'` 등 + 브리지(메시지 출처 `event.source` 확인, op 화이트리스트, `needs` 권한, rate limit, state 정제: `cwd`·`@unstable` 제거). 알려진 한계: 브라우저 버전에서 iframe 자기 이동 1회(문서화됨).
3. **트랜스크립트·훅 입력 → 화면**: 프롬프트·명령·출력에 시크릿이 섞여 있다고 가정. 모든 자유 텍스트는 마스킹 후 절단. 세션 ID는 `[A-Za-z0-9_-]`만, 경로는 정해진 폴더 안에서만.
4. **앱 ↔ 사용자 설정 파일**: `~/.claude/settings.json`에 훅을 넣고 뺀다 — 남의 항목을 절대 잃으면 안 된다.
5. **OAuth 토큰**: 메모리에만. 디스크·로그·state·프론트·에러 메시지 금지. refresh 안 함.

## 4. 민감 영역 지도 (diff가 여기 닿으면 diff 밖까지 읽어라)

| 영역 | 어디 | 반드시 확인할 것 |
|---|---|---|
| **settings.json 수정** (훅 설치·제거) | `wr-core` `hooks_config`/`providers/claude/hooks.rs`, 앱 명령 | 파싱 실패 시 중단(덮어쓰기 금지), 백업 `settings.json.bak-waiting-room-<ts>`, 우리 항목(`waiting-room/bin/wr-hook`)만 추가·제거(멱등), 쓰기 직전 mtime 재확인, 임시 파일+rename 원자적 쓰기, 객체가 아닌 JSON·누락 키에서 panic 없음 |
| **OAuth 토큰·키체인** | `usage_poll.py`, `wr-core` `limits`/credentials, 앱 | `.credentials.json` 우선(만료 확인), 키체인은 사용자 버튼 때만, `Zeroizing`, `Debug`/`Display`/에러에 토큰 없음, 401/403 중단, 429 백오프(`Retry-After`), 기본 꺼짐 |
| **샌드박스** | `web/core/bridge-host.js`, `web/sdk/mode-sdk.js`, `server.py` `/_modes`, `wr-server`, 앱 `wrmode:` 스킴 | CSP 헤더가 **모든** 응답에, `allow-same-origin` 없음, `event.source` 검사, op·권한 검사, state 정제, 두 번째 `load` 감지 시 제거, 앱은 하위 frame 외부 내비게이션 거부 |
| **외부 프로세스 실행** | `usage_poll.py`(`security`), 앱(터미널 열기·폴더 열기), 훅 명령 형식 | 셸 문자열 조립 금지(인자 배열), 사용자·트랜스크립트 유래 값(경로·cwd)이 명령 인자로 갈 때 옵션 주입(`-`로 시작) 방지, Windows 인용 |
| **zip 설치** | 앱 `install_mode` | 경로 탈출(`..`·절대 경로·드라이브 문자)·심볼릭 링크 거부, 최대 20MB·500개, 확장자 화이트리스트, zip bomb(압축 해제 크기 기준), id 형식·내장 id 충돌, 설치 후 꺼진 상태, `.install.json` 해시 |
| **HTTP 서버** | `server.py`, `crates/wr-server` | 127.0.0.1만, `Host` 검사(포트 포함, 대소문자, 누락 시 403), GET/HEAD만, 정적 파일 화이트리스트, 경로 정규화(퍼센트 디코딩 후 검사), 쿼리 파라미터 검증(`session` 형식, `since`·`prompt` 파싱 실패 처리), 응답 크기 상한 |
| **마스킹** | `server.py` `redact()/clip()`, `wr-core` `redact.rs`, `hook.py`/`wr-hook` | 패턴: `sk-ant-`, `gh[pousr]_`, `github_pat_`, `AKIA`, `xox[bpasr]-`, JWT, `Bearer/Basic`, `password|secret|token|api_key=…`. **마스킹 → 절단** 순서(절단 먼저 하면 잘린 시크릿이 패턴을 피함). 멀티바이트 경계에서 자를 때 panic 없음 |
| **파일 읽기** | `wr-core` jsonl·scan·trace, `server.py` `scan()` | 파일 잘림(크기 감소)·회전·불완전한 마지막 줄·잘못된 UTF-8·거대한 한 줄·심볼릭 링크, 캐시 상한(LRU), 6시간 STALE |

## 5. 리뷰에서 기억할 사실

- 로컬 전용 앱이다. "인터넷에 노출된 서버" 전제의 지적(인증 토큰 없음 등)은 틀린 지적이다 — 위 신뢰 경계 기준으로 판단하라.
- `server.py`는 P1 동안 **고치지 않는 기준 구현**이다. Rust 쪽이 Python과 **다르게** 동작하면(동등성 깨짐) 그 자체가 지적 대상이다. 단, `fixtures/transcript-only/`의 트랜스크립트 전용 엔진은 Python에 없는 신규 기능이다.
- 문서에 `[추정]`·`[PoC]`로 표시된 항목은 아직 확인 전인 설계다. 코드가 그 가정에 기대면 `question`으로 묻는다.
- 공개 계약(`types/`)의 필드 의미·단위를 바꾸면 major 변경이다. 필드 추가는 minor + `types/CHANGELOG.md`.
- 커밋에는 `Co-Authored-By:` 한 줄만, 세션·대화 링크 금지(CONTRIBUTING §6).

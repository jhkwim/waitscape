# 트랜스크립트 전용 판정 규칙 (훅 없음) — v1 초안

ARCHITECTURE.md §2.3을 구체화한 규칙이다. 구현은 P1(`crates/wr-core` engine), 기대값은 `expected.json`(손으로 쓴 값), 입력은 `input/`(`fixtures/make_fixtures.py`가 생성).
Python 참조 서버에는 이 기능이 없으므로 `fixtures/expected/`(동등성)와 별개로 검증한다.

결과는 `/state`의 `Session`과 같은 모양(types/state.d.ts)에 `source: "transcript"`, `confidence`를 붙인다.

## 0. 상수

| 이름 | 값 | 뜻 |
|---|---|---|
| `STALE` | 6시간 | 마지막 기록이 이보다 오래되면 목록에서 뺌 |
| `INPUT_GUESS` | 8초 | 권한이 필요할 수 있는 도구가 결과 없이 이만큼 기다리면 "입력 필요일 수도" |
| `DONE_GUESS` | 30초 | `stop_reason`이 없는 마지막 발화 뒤 이만큼 조용하면 "끝난 것 같음" |
| `SLOW/STALL`, `TOOL_SLOW/TOOL_STALL` | 120/300, 120/600초 | server.py와 같음(health) |

## 1. 세션 발견

- 후보: `<projects>/*/*.jsonl` (한 단계 아래만. `<sid>/subagents/`는 세션이 아님). 파일 이름(확장자 제외) = `sid`.
- 파일 mtime이 `now - STALE`보다 오래되면 열지 않는다(비용 절감용 사전 필터).
- **숨김 판정은 파일 안 마지막 유효 기록의 `timestamp` 기준**: `now - last_ts >= STALE`이면 뺀다(mtime은 git checkout·복사로 바뀌므로 판정에 쓰지 않음).
- 단 **오늘(`day_start` 이후) 활동이 있는 세션은 STALE이어도 읽어서 오늘 집계(`today_*`)에는 넣고, 목록(`sessions`)에서만 뺀다**(훅 경로와 같은 규칙). 사전 필터 mtime 기준은 `min(now - STALE, day_start)`.
- `ended`는 알 수 없다. 끝난 세션은 `done`으로 남다가 6시간 뒤 사라진다.

## 2. 줄 읽기

- 개행으로 끝난 줄만 읽는다. **개행 없는 마지막 줄은 쓰는 중**이므로 다음 읽기로 미룬다(server.py `scan()`과 같음).
- 파일 크기가 줄면 처음부터 다시 읽는다.
- `type`이 `user`/`assistant`인 줄만 본다. `isMeta: true` 줄은 무시한다. 메인 파일에서 `isSidechain: true` 줄은 무시한다.
- 사용자 줄 분류(텍스트 = string content 또는 text 블록을 이은 것):

| 분류 | 조건 | 효과 |
|---|---|---|
| tool_result | content에 `tool_result` 블록 | 대기 중 도구를 해소. 상태 → working |
| 프롬프트 | 텍스트가 `<`로 시작하지 않고 `[Request interrupted`로 시작하지 않음 | 새 턴. `prompt`·`prompt_ts`·`started` 갱신, `tools`·`kinds`·`activity`·`trail` 초기화, 끝난 에이전트 정리, 할 일이 모두 completed면 비움 |
| 슬래시 명령 | `<command-name>`으로 시작 | 프롬프트로 취급, 문구는 `"/이름 인자"`. 단 **바로 다음 유효 사용자 줄이 `<local-command-stdout>`이고 그 사이에 assistant 줄이 없으면 로컬 명령**(/clear, /model 등) → 프롬프트·상태 변화 없음 |
| 에이전트 알림 | `<task-notification>`으로 시작 | 재개(hook의 Resume): 상태 → working, `started`가 없으면 이 시각. 프롬프트 아님. `<task-id>` 에이전트를 done으로 |
| 중단 | `[Request interrupted`로 시작 | 상태 → done(`started` = null). 오늘 집계(done_today·waited_today)에는 넣지 않음 |
| 기타 `<…>` | `<local-command-stdout>`, `<system-reminder>` 등 | 무시 |

- `prompt` 문구: 마스킹(`redact`) → 공백 정리 → 60자 절단(hook.py `short()`와 같은 길이, 순서만 마스킹 먼저).

## 3. 상태 판정 (세션 마지막 상태)

대기 중 도구 = 결과(tool_result)가 아직 없는 tool_use. 판정은 위에서부터 처음 맞는 것.

1. 프롬프트가 한 번도 없음 → `idle` (`since` = 첫 유효 기록 시각)
2. 마지막 이벤트가 **중단** → `done`
3. 대기 중 도구가 있음 (가장 오래된 것 기준, `wait = now - tool_use.ts`)
   - `AskUserQuestion`, `ExitPlanMode` → `needs_input`, `confidence: "sure"`, `since` = tool_use 시각
     (`note`: 각각 "질문에 답을 기다리는 중", "계획 승인을 기다리는 중")
   - 권한이 필요할 수 있는 도구 = `Bash`, `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `mcp__*` 이고 `wait >= INPUT_GUESS`
     → `needs_input`, `confidence: "guess"`, `since` = tool_use 시각, `note` = "<도구> 승인을 기다리는 중일 수 있어요".
     `run_in_background` Bash도 예외 없음(실제로는 실행 직후 결과가 오므로 오래 대기하면 오히려 권한 대기일 가능성이 큼).
     오래 걸리는 명령(테스트 등)과 구별할 수 없으므로 알림은 약하게(Q11), 훅 설치 권유 배너를 띄운다.
   - 그 밖(Read/Grep/Glob/Agent/Task/TodoWrite/Skill 등 또는 8초 미만) → `working`
4. 마지막 유효 줄이 프롬프트·tool_result·에이전트 알림 → `working`
5. 마지막 유효 줄이 assistant
   - `stop_reason`이 `end_turn`/`stop_sequence`/`max_tokens` → `done` (`since` = 그 줄 시각)
   - `stop_reason`이 없음(null) → `now - ts < DONE_GUESS`면 `working`, 아니면 `done` + `confidence: "guess"`
6. 결과가 done/idle인데 실행 중인 서브에이전트가 있으면 → `agents` (since는 done의 since 그대로)

- `since`: working은 그 턴이 working이 된 시각(프롬프트 또는 재개 시각. 도구가 돌아도 바뀌지 않음), done은 끝난 줄 시각.
- `started`: working·needs_input·agents(메인 진행 중)이면 턴 시작 시각, done이면 null.
- `run`: 마지막으로 끝난 턴의 `끝 - 시작` (초).
- `confidence`: 위에서 "guess"가 아니면 "sure".
- `health`: status가 working일 때만 server.py `health()`와 같은 식(대기 중 도구 → 도구 시간, 없으면 `now - 마지막 기록`). 그 밖은 null.
- `say`: working일 때 메인의 마지막 assistant 텍스트(마스킹 → 공백 정리 → 160자).

## 4. 도구 요약·할 일·에이전트

- `tools`·`kinds`·`activity`(최근 6)·`trail`(최근 300): 이번 턴 메인 tool_use마다 hook.py `describe()`(아이콘·문구)와 `KINDS`를 적용. 텍스트는 마스킹.
- `todos`:
  - `TodoWrite` input의 `todos` → 통째로 교체. 항목 `{text: in_progress면 activeForm 아니면 content (60자), status}`.
  - `TaskCreate` → `{id, text: subject, status: "pending"}` 추가. id는 같은 줄의 결과(`toolUseResult.task.id` [추정: PoC로 필드 확인])에서, 없으면 순번.
  - `TaskUpdate` → id가 같은 항목의 status 갱신, `deleted`면 제거, in_progress면 text를 activeForm으로.
- `agents`: 이번 턴의 `Agent`/`Task` tool_use 하나 = 에이전트 하나.
  - `aid`: tool_result의 `agentId: <id>` 또는 `subagents/agent-<aid>.meta.json`의 `toolUseId`로 연결. 둘 다 없으면 아직 목록에 넣지 않음.
  - `type`: meta `agentType` → input `subagent_type` → "agent". `desc`: meta `description` → input `description` (50자, 마스킹).
  - `since`: 서브에이전트 트랜스크립트 첫 기록 시각(없으면 tool_use 시각). `bg`: input `run_in_background`.
  - done 조건(하나라도): meta `finished` / 메인의 `<task-notification>`에 그 task-id / 서브에이전트가 `SubagentHandback` 호출 /
    동기 호출(비동기 시작 메시지가 아님)의 tool_result 도착 / 서브에이전트 트랜스크립트가 대기 도구 없이 `end_turn`으로 끝나고 30초 조용.
  - `ended`: 서브에이전트 트랜스크립트 마지막 기록 시각(없으면 done을 알게 된 줄의 시각).
  - `tokens`·`say`·`health`: server.py와 같음(서브에이전트 트랜스크립트 기준, health는 running일 때만).
- `tokens`(세션): 메인 + 서브에이전트 usage를 메시지 id로 중복 제거, 마지막 프롬프트 이후만.
- 오늘 집계(`done_today`, `waited_today`, `today_*`): 오늘(로컬 자정 이후) 끝난 턴(5번 규칙의 done, 중단 제외)과 오늘 tool_use 기준.

## 5. 훅과 병합 (§2.3)

- 같은 sid에 최근 10분 안의 훅 이벤트가 있으면 **status·since·started·note·todos·agents는 훅 값**, 나머지(tokens·say·health)는 트랜스크립트 값. `source: "hook"`.
- 아니면 이 문서 규칙. `source: "transcript"`.
- 전역 `hooks: { installed, last_event_age }`.

## 6. 알려진 한계

- 권한 프롬프트는 트랜스크립트에 남지 않는다 → `needs_input`은 추정(guess). 긴 명령과 구분 불가.
- `stop_reason` 없는 발화(null)는 끝났는지 알 수 없다 → 30초 규칙으로 추정. [PoC] 현재 Claude Code가 마지막 assistant 줄에 `stop_reason`을 쓰는지 실제 트랜스크립트로 확인.
- 세션 종료(SessionEnd)·터미널 위치는 알 수 없다.

## 7. 기대값 파일 형식 (`expected.json`)

`cases.<sid>`에 **확인할 필드만** 적는다(부분 비교). `listed: false`면 목록에 없어야 한다. 배열의 객체도 적힌 키만 비교한다.
비교: `python3 scripts/check_transcript_only.py <구현이 낸 state.json>` (sessions[]를 sid로 찾아 비교, 숫자 허용 오차 1e-6).
시각은 `fixtures/fixture.json`의 `now` 기준 절대 epoch 초, 시간대 Asia/Seoul.
입력의 `@@FAKE_*@@` 자리표시자는 `fixtures/fake_secrets.json`의 조각을 이어 붙여 치환한 복사본으로 돌린다(`scripts/snapshot.py`의 `stage_input()`과 같음).

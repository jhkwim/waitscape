# 리뷰 프롬프트 보정 기록 (Calibration)

> 참고: 아래 `#번호`는 이 저장소를 공개 저장소로 옮기기 전(비공개 개발 저장소)의 PR 번호다. 공개 저장소에서는 같은 번호가 다른 PR을 가리킬 수 있다.

같은 PR을 **기본 프롬프트**와 **새 프롬프트(v1→v3)**로 리뷰시키고, Claude가 지적마다 코드를 열어 검증해 비교했다.
리뷰어: Gemini 4 Argon (Medium), Antigravity CLI `--mode plan`. 날짜: 2026-10-21. PR에 댓글은 달지 않았다(보정 단계).

## 대상

| PR | 내용 | 체크리스트(`--auto`) |
|---|---|---|
| #10 `chore/repo-setup` | CI·이슈/PR 템플릿·CONTRIBUTING·SECURITY·검사 스크립트 3개 (14파일, diff 834줄) | ci, security |
| #1 `feat/p1-rust-backend` | Rust 백엔드 wr-core/wr-hook/wr-server (40파일, diff 7,526줄) | ci, rust, security |

## 지표 정의

- **근거율**: `파일:줄`이 PR 헤드의 실제 위치(±3줄)와 맞고, `scenario`가 "입력/상황 → 잘못된 결과"를 갖춘 지적 / 전체
- **사소율**: 고쳐도 사용자·보안에 영향이 없는 지적(취향, 미세 성능, 테스트 전용 경합, 템플릿 문구 등) / 전체
- **정확도**: (맞고 의미 있는 지적 + 부분적으로 맞음×0.5) / 전체 (❓ question 제외). "틀림"은 사실 오류·문서화된 설계와 상충
- 검증: Claude가 각 지적의 코드를 열어 확인했고, 필요한 것은 재현했다(예: 한글 뒤 시크릿 미마스킹 → Python `re`로 동일 정규식 실행해 매칭 0건 확인, 고정된 액션 SHA → GitHub API로 존재 확인).

## 결과 요약

| PR | 프롬프트 | 소요 | 지적 수 | 근거율 | 사소율 | 정확도 | 비고 |
|---|---|---|---|---|---|---|---|
| #10 | 기본 ("이 PR 리뷰해줘") | 124초 | 8 | 0% | 38% | 50% | 최상위 경고가 **환각**: "액션 SHA가 존재하지 않아 CI가 즉시 실패" → SHA 둘 다 실존, CI 통과. 줄 번호는 diff 줄(`pr.diff#L382`). 결과가 plan 아티팩트(마크다운)로 나오고 "수정까지 할까요?"를 물음 |
| #10 | v1 | 236초 | 3 (🟡3) | 100% | 0% | 83% | 3건 모두 실제 문제지만 **등급 과대**(검사 스크립트 빈틈을 🟡로) |
| #10 | v2 | 69초 | **0** | — | — | — | 등급 하향 규칙을 "버리라"로 해석 → **과잉 억제**(v1의 맞는 지적까지 사라짐) |
| #10 | **v3 (최종)** | 149초 | 4 (🔵3 ❓1) | 100% | 0% | 83% | 등급 적정. SHA 존재 여부를 지어내지 않고 ❓로 질문. 새로 찾음: 한글 바로 뒤 시크릿을 `check_secrets.py`가 못 잡음 |
| #1 | 기본 | 335초 | 10 | 0% | 60% | 20% | 줄 번호가 diff 줄(356줄짜리 `mod.rs`에 `#L3691`). 1건은 문서화된 설계와 상충(401/403 후 중단 = ARCHITECTURE §3.7). 사소: TZ `set_var` 테스트 경합, `ScanCache` clone 비용, HEAD 헤더 일관성 등 |
| #1 | v1 | 571초 | 6 (🟡4 🔵2) | 100% | 17% | 83% | 새로 찾음: `status_ended` 미해제, `<task-notification>` 턴 마감 누락. 기본 프롬프트가 찾은 서브에이전트 토큰 누락은 놓침 |
| #1 | v2 | 148초 | 4 (🟡3 🔵1) | 75% | 0% | 88% | 새로 찾음: **한글 뒤 시크릿 마스킹 누락**(🟡). 한 지적의 `evidence`에 무관한 trace 분석이 섞임 |
| #1 | **v3 (최종)** | 574초 | 7 (🟡6 🔵1) | 100% | 0% | 79% | 지금까지 확인된 실제 버그 5종을 **한 번에 모두** 보고(서브에이전트 토큰·오늘 집계·`status_ended`·한글 마스킹·시계 주입 우회). 🟡 2건은 등급 과대(404 응답 CSP, `Instant::now`) |

요약: 기본 → v3에서 **근거율 0% → 100%, 사소율 38~60% → 0%, 정확도 20~50% → 79~83%**, 환각 1건 → 0건(❓로 전환). 출력이 JSON으로 고정돼 자동 처리 가능.

## 검증된 주요 지적 (다음 단계 본 리뷰에서 PR 댓글로 처리할 것)

| PR | 위치 | 내용 | 판정 |
|---|---|---|---|
| #1 | `crates/wr-core/src/redact.rs:23` | `\bgh[pousr]_`·`\bAKIA`·`\bxox…`·`\beyJ`·`\b(Bearer|Basic)`가 유니코드 `\b`라 **한글 바로 뒤에 붙은 시크릿을 마스킹하지 않음**(`키는ghp_…`) → `/state`·`/trace`·`events.jsonl`에 원문. `server.py`도 같은 빈틈 | ✅ 🟡 (재현함) |
| #1 | `crates/wr-core/src/providers/claude/tonly.rs:612` | 지난 턴의 끝난 서브에이전트를 `continue`로 빼면서 `sub_msgs.extend`도 건너뜀 → 트랜스크립트 모드 `today_tokens`에서 서브에이전트 토큰 누락 | ✅ 🟡 |
| #1 | `crates/wr-core/src/providers/claude/mod.rs:284` | Auto 모드에서 훅 기록이 남은(어제 등) 세션이 트랜스크립트 판정으로 넘어가면 `if hook.is_none()` 때문에 오늘 집계 전체 누락 | ✅ 🔵~🟡 (훅을 끈 사용자에게만) |
| #1 | `crates/wr-core/src/providers/claude/hooks.rs:325` + `mod.rs:277` | `SessionEnd` 뒤 `status_ended`가 다시 꺼지지 않음 → 훅을 끈 뒤 재개한 세션이 `/state`에서 사라짐 | ✅ 🔵~🟡 |
| #1 | `crates/wr-core/src/providers/claude/tonly.rs:457` | `Discovery`가 주입 시계 대신 `Instant::now()` → 고정 시계 테스트 결정성 깨짐 | ✅ 🔵 (등급 과대) |
| #10 | `scripts/check_secrets.py:25-30` | 한글 바로 뒤 키 미검출, 홈 경로 예외(`alex\b`)가 `alex-kim`·`user.lee`를 통과 | ✅ 🔵 |
| #10 | `scripts/validate_modes.py:44` | 인자로 파일을 주면 폴더 이름=`id` 검사를 건너뜀(모드 제출 템플릿이 안내하는 방식) | ✅ 🔵 |

🔴(배포 차단)은 두 PR 모두 **없음**.

## 회차별 프롬프트 변경

### v1 (초안)
`REVIEW_PROMPT.md` §0~§7, `context.md`(신뢰 경계·민감 영역 지도), 체크리스트 5종, `schema.json` + `--json-schema` 구조화 출력.
기본 프롬프트 결과를 먼저 본 뒤 `checklists/ci.md` C1에 "액션 SHA 존재 여부를 추측하지 말 것"을 넣었다(환각 대응).

### v2 (등급 과대 대응)
- `REVIEW_PROMPT.md` §4에 **등급 보정 규칙**: 개발용 검사 도구의 빈틈은 기본 🔵, 설계 문서의 "할 예정" 기능 부재는 지적 안 함, 로컬 사용자 조작 전제는 🟡 미만, 정확성 버그는 빈도로 🟡/🔵.
- `checklists/rust.md` R4-1 **집계 누락 패턴**(조기 `continue`가 누적을 건너뛰는지, 소스 모드별 집계 대조, 다시 꺼지지 않는 플래그, 시계 주입 우회). v1이 기본 프롬프트가 찾은 토큰 누락을 놓쳤기 때문(특정 답을 적지 않고 **패턴**으로만).
- 결과: PR #1은 좋아졌지만 PR #10이 0건(과잉 억제), 한 지적에 무관한 근거가 섞임.

### v3 (최종)
- §4: "등급을 **낮추는** 규칙이지 **버리는** 규칙이 아니다 — 시나리오가 있으면 🔵로라도 보고", 방어 정규식은 **경계 입력(한글 뒤·대소문자·구두점·길이)을 직접 대입**, 기존 Python에 같은 빈틈이 있어도 이식했다면 지적.
- §3-5: 한 지적의 `evidence`에는 그 지적의 근거만.

## 남은 한계와 운영 권장

- **실행마다 결과가 흔들린다**(같은 프롬프트로도 v1·v2·v3가 서로 다른 버그를 찾음). 큰 PR(Rust·앱)은 `run_review.sh`를 **2회 돌려 합집합**을 검증하는 것을 권장. 비용은 회당 약 10분.
- 등급은 여전히 약간 높게 나온다(v3 PR #1 🟡 6건 중 2건 과대). TRIAGE의 "✅ 반영(등급 조정)"으로 처리.
- 커밋된 파일 범위 밖(저장소 설정, GitHub 원격 상태)은 리뷰어가 볼 수 없다 → ❓로 오는 것이 정상.
- 지표가 TRIAGE.md §4 기준(정확도 < 60% 또는 사소율 > 20%가 2회 연속)에 걸리면 v4 회차를 이 파일에 추가한다.

## Flash 비교 (모델 자동 선택의 근거)

같은 v3 프롬프트·`--auto` 체크리스트로 `gemini-3.8-flash-medium`을 1회씩 돌려 Argon medium v3와 비교했다(2026-10-21). 지적마다 PR 헤드 코드를 열어 검증했다. "찾은 실제 문제"는 CALIBRATION 위 표의 검증된 실제 문제 기준이다.

| PR | 모델 | 소요 | 실패/재시도 | 지적 | 근거율 | 사소율 | 정확도 | 찾은 실제 문제 |
|---|---|---|---|---|---|---|---|---|
| #10 | Argon medium v3 | 149초 | 없음 | 4 (🔵3 ❓1) | 100% | 0% | 83% | 3건(한글 뒤 키·홈경로 예외·폴더=id) |
| #10 | **Flash medium** | 396초(+1차 실패) | 1차 "command 권한 자동 거부" 실패 → 재시도 성공 | 2 (🔵1 ❓1) | 100% | 0% | 100% | 1건(홈경로 `\b` 예외). 한글 뒤 키·폴더=id는 놓침 |
| #10 | Flash high(참고) | 666초 | 없음 | 6 (🔵4 ❓2) | 100% | 25% | 75% | 3건(홈경로·개인키 패턴 부재·`validate_modes` 예외). 한글 뒤 키는 놓침. PR 템플릿 `--leak` 누락은 사소 |
| #1 | Argon medium v3 | 574초 | 없음 | 7 (🟡6 🔵1) | 100% | 0% | 79% | 5종(서브에이전트 토큰·오늘 집계·`status_ended`·한글 마스킹·시계 주입) |
| #1 | **Flash medium** | 873초 | 없음 | 4 (🟡1 🔵3) | 100% | 0% | 88% | 시계 주입·404 CSP + **새로** `rust_parity.sh` 파이프 종료코드 무시. 나머지 4종은 놓침 |

Flash #1 지적 판정: 시계 주입 ✅, 404에 CSP 없음 ✅(🔵가 적정 — Argon은 🟡로 과대), `rust_parity.sh`의 `| tail -1`이 `check_transcript_only.py` 실패를 가림 ✅(Argon이 못 찾은 새 문제), `usage.rs` 응답 크기 상한 없음 ◐ (맞는 관찰이지만 ureq `into_string`은 기본 10MiB 상한이 있어 "OOM"은 과장 → 0.5점).

해석:
- **정확도(맞는 지적/전체)는 Flash가 Argon보다 낮지 않다**(#10 +17%p, #1 +9%p, 둘 다 15%p 하락 조건에 해당 없음). 근거율 100%, 사소율 0%, 환각 0건도 같다.
- 그러나 정확도는 **재현율(놓침)을 보지 않는다.** Flash는 찾은 실제 문제가 적다: #10 1/3, #1 2/7(대신 Argon이 못 찾은 1건을 찾음). 한글 뒤 시크릿 미마스킹, 서브에이전트 토큰 누락 같은 **경계 입력·집계 경로 추적**을 놓쳤다. → 보안·정확성 민감 영역은 Argon, 문서·CI·UI는 Flash의 얕은 점검으로 충분하다는 규칙이 데이터와 맞는다.
- **시간은 줄지 않았다**(벽시계 Flash 396~873초 > Argon 149~574초). 절약되는 것은 시간이 아니라 **토큰(비용)** 이다. Flash는 가끔 셸 명령 권한이 필요하다며 1차 실행이 실패한다(헤드리스는 거부) — `run_review.sh`의 재시도로 해결됐다. `--dangerously-skip-permissions`는 쓰지 않는다.
- 표본이 PR 2개·각 1회라 오차가 크다(같은 프롬프트도 회차마다 다른 버그를 찾는 것은 위 "남은 한계"와 동일). 큰 PR에서는 그래서 Flash+Argon 합집합을 기본으로 한다. 이 표는 `metrics.md`가 쌓이면 갱신한다.

### 결정된 모델 규칙 (`run_review.sh`)

기본안 유지(Flash가 Argon보다 15%p 넘게 낮지 않으므로 "Argon low" 대체는 하지 않음). 단 **Flash는 재현율이 낮다는 근거로 보안 민감·큰 PR에는 Argon을 항상 포함**한다.

| tier | 조건 | 실행 |
|---|---|---|
| light | 변경 < 800줄(추가+삭제), 보안 민감 아님 | Flash medium 1회(렌즈 기본 켬 뒤로는 기본 + 렌즈 5개, §렌즈) |
| full | 변경 ≥ 800줄, 보안 민감 아님 | Flash + Argon medium, 합집합 |
| security | 라벨 `security`, `security` 체크리스트 대상, 또는 민감 경로(hooks/settings.json·usage·토큰·키체인·sandbox·wrmode·CSP·capabilities·zip 설치·외부 프로세스·HTTP 서버) | Argon medium (≥ 800줄이면 + Flash) |

`WR_MODEL`(강제 — Argon은 1회, Flash는 렌즈 포함), `WR_TIER=light|full|security`로 수동 지정. 선택 결과와 이유는 실행 로그와 결과 JSON의 `meta`(tier·changed_lines·reason·models·seconds)에 남고, 합집합의 각 지적에는 `found_by`가 붙는다. 참고로 PR #10은 라벨 `security`라서 자동 선택이면 Argon이다(이번 Flash 측정은 `WR_MODEL`로 강제).

## 렌즈(관점) 다회 리뷰 (2026-10-29, #41)

- 문제: 공개 저장소 PR 8개 중 7개에서 Flash 0건. 같은 PR에서 Claude 검증 리뷰는 실제 버그를 찾음 — #34 Windows cp1252 인코딩, #39 프로토타입 키·클릭 겹침, #40 턴마다 리셋되는 시간·도구 기준·눈치 모드 해제 뒤 깃발 재솟음. #40을 Argon으로 비교하니 🔵2(재솟음 + 자리 비운 로봇의 배터리 — Claude가 놓친 것). Argon은 토큰 소비가 커서 상시 쓰기 어려움.
- 가설: 한 번에 모든 관점 + 파일 읽기 8회 제한 → 큰 파일을 겉핥기. 놓친 버그는 대부분 "특정 상황에서"(새 턴·눈치 해제·자리 비움·특수 키) 생김.
- 방법: `WR_LENSES`로 Flash에 기본 패스(체크리스트 담당) + 관점마다 1회를 동시에(lenses/state·screen·interact·data·platform — platform은 #34 Windows 인코딩 같은 OS 차이 담당). 렌즈마다 체크아웃을 복제해 따로 실행(agy 전역 캐시가 cwd 키로 겹침), 렌즈 패스는 파일 읽기 15회, 항목마다 확인 근거를 summary에 남기게. 각 렌즈는 "이번 패스는 이 관점만, 문제 없으면 0건"으로 시작해 상황 목록을 하나씩 따지게 함. 합집합 병합(found_by = 모델/렌즈).
- 측정 계획(완료 — 위 1차 측정, 실제로는 기본 패스 + 렌즈 5개): 다음 PR(스튜디오 직원 몸짓 묶음)에서 Flash 1회 / Flash 렌즈 4회 / Claude를 같은 커밋에 돌려 지적 수·정확도·중복·소요를 metrics에 남기고, 효과가 있으면 기본으로 켠다.
- 1차 측정(#43 직원 몸짓 묶음, 같은 커밋): Flash 1회 0건 · Flash 기본+렌즈 5개 5건(실제 1 — screen 렌즈의 "퇴근 연출 중 문어 다리 잔상", Claude와 같은 버그 / 오탐 3 — mkEl 인자 수·인라인 높이·하품 1프레임, 질문 1 — 문어 neck 메타(확인 결과 문제 없음), 모두 data 렌즈: 정의·설정 코드를 끝까지 안 보고 추측. 오탐 둘은 사실 screen·state 주제라 범위 밖 지적이기도) · Claude 🟡2(+도감 오염)·🔵5. 동시 실행이라 이번엔 시간이 1회와 비슷(492초 vs 517초), 토큰은 Flash 6회분.
- 조치: data 렌즈에만 "인자·값 존재·호출 순서 지적은 정의를 열어 확인한 뒤에만, 못 했으면 question" 규칙 추가 — 2차 측정(건물 묶음 PR)에서 이 규칙의 효과만 따로 본 뒤, 효과가 있으면 공통 `LENS_RULE`로 옮기고 data 렌즈엔 범위 경고만 남긴다.
- 2차 측정(#45 건물 묶음, data 규칙 조임 뒤): Flash 1회 1건(실제 1 — 비둘기 클릭 시 날아가기 생략, **Claude가 놓침**) · Flash 기본+렌즈 5개 6건(실제 4 + 중복 1: 비둘기·청소 재개 층(base·state·interact 세 렌즈)·우산 툴팁·매 프레임 탐색 / 오탐 1: state의 x 누적) · Claude 🟡2·🔵7. data 렌즈 오탐 3 → 0. 시간 1회 273초 vs 렌즈 617초(동시).
- 결론(2026-10-29): 렌즈를 **기본으로 켬**(`WR_LENSES` 기본값, Flash에만, Argon은 1회). data 렌즈의 오탐 방지 규칙은 공통 렌즈 패스 규칙으로 옮김. 렌즈 지적은 여전히 Claude가 코드로 검증한 뒤 반영. 비용: Flash 6회분, 시간은 1회의 1~2.3배(가장 느린 렌즈가 기준). 공통 오탐 방지 규칙이 data 외 렌즈에서도 효과가 있는지는 다음 PR들에서 metrics로 계속 본다.

## Antigravity CLI 사용 메모

- 반드시 `~/.local/bin/agy`(진짜 실행 파일). `--model`을 항상 명시한다(지정하지 않으면 CLI 설정값을 따름). 교차 리뷰이므로 `agy models`의 `claude-*`·`gpt-*` 모델은 쓰지 않고 `gemini-*`만 쓴다. 모델은 `run_review.sh`가 고른다(아래 규칙).
- `--output-format text`의 plan 모드는 결과를 `~/.gemini/antigravity-cli/brain/<id>/*.md` **아티팩트로 쓰고** 표준 출력에는 진행 독백과 "수정까지 할까요?" 질문만 남는다 → 자동화에 부적합. `--output-format json --json-schema schema.json`을 쓰면 `structured_output` 필드에 스키마를 지킨 JSON이 들어온다(검증됨).
- 소요(렌즈 없이): 작은 PR 1~4분, 7천 줄 PR 약 10분. 렌즈를 켜면 가장 느린 렌즈 기준 4~10분. `--print-timeout 15m`이면 충분했다. 실패(비정상 종료·`structured_output` 없음)는 이번 8회 실행에서 0건이었지만 `run_review.sh`는 1회 재시도한다.
- 리뷰어는 체크아웃 폴더의 파일을 실제로 열어 읽는다(`checked` 필드). 시크릿 검사는 diff만 보므로, 체크아웃 전체에 실제 키가 있으면 안 된다(저장소 규칙상 없음).

## Flash headless 실행 실패 (2026-10-22 기록)

- 증상: Flash(`gemini-3.8-flash-medium`)를 `agy -p --mode plan`으로 돌리면 출력이 없다. PR #11 2회 연속, PR #1 Argon 첫 시도(read_file)도 같은 계열.
- 원인: headless(`-p`)는 사용자에게 권한을 물을 수 없어, `permissions.allow`에 없는 도구 호출(`command`=셸 등)은 **자동 거부**되고 결과가 비어 `no output produced — a tool required the "command" permission` 오류로 끝난다(`--output-format stream-json`으로 재현: Flash가 `git status; git log -1 --stat`을 실행하려다 거부). 읽기 도구도 허용 목록 밖 경로면 같은 식으로 막힌다. 모델이 diff를 직접 못 보니 셸·파일 읽기를 남발하는 것도 원인. 별개로 Flash는 파일을 조각조각 읽느라 6분 넘게 걸려 `--print-timeout`에 걸리기도 했다.
- 하지 않은 것: `--dangerously-skip-permissions`(모든 도구 자동 승인), 사용자 전역 설정(`~/.gemini/`) 수정.
- 해결(`run_review.sh`): ① diff를 프롬프트에 직접 포함(`WR_EMBED`, 기본 120000바이트) ② "셸 금지·읽기 전용 도구(read_file/view_file, grep_search, list_dir, find_by_name)만·파일 읽기 최대 8회" 규칙을 프롬프트에 명시 ③ 1차 실패(권한 거부·타임아웃·구조화 출력 없음) 시 **도구를 전혀 쓰지 않는 엄격 프롬프트**(`.strict.md`, diff만으로 답하고 확정 불가 항목은 `question`)로 재시도. 재시도 로그에 1차 실패 사유가 남는다.
- 시험(PR #10, `WR_MODEL=gemini-3.8-flash-medium`): 수정 후 2회 모두 구조화 출력 정상(241초 0건, 270초 2건: 🔵1 ❓1). 수정 전 같은 명령은 출력 없음. 주의: Flash 0건 회차가 있어 정확도는 여전히 Argon보다 낮다(위 "Flash 비교").
- 남은 한계: 엄격 재시도는 파일 전체를 못 보므로 지적이 diff 범위로 한정된다. 실행별로 허용 도구를 제한하는 공식 인자는 `agy` 도움말에 없다(전역 `permissions.allow`·플러그인 에이전트 `tools:`만). 필요하면 플러그인 에이전트로 도구를 읽기 전용 목록으로 고정하는 방법을 후속 검토.

## 화면 검수(visual) (2026-10-30, #59)

`visual_review.sh` + `lenses/visual.md` — 고정 스크린샷 매트릭스를 Gemini Flash에 보여 주고 지적 후보를 받는다. 운영 규칙은 `TRIAGE.md` §6.

- **가능성 확인**: `agy -p --mode plan --output-format json --json-schema`에서 리뷰어가 `read_file`로 작업 폴더의 PNG를 열면 **이미지가 그대로 보인다**(합성 PNG의 글자 `ZEBRA 7391`·도형 색·위치를 정확히 답함, 24초·약 25k 토큰). 첨부 플래그는 없고(`agy --help`), 이미지 파일을 작업 폴더에 두고 읽게 하는 방식만 쓴다. 권한 우회 플래그는 쓰지 않는다.
- **좌표 주의**: 리뷰어가 적는 좌표는 축소본 기준인 것으로 보인다(1280px 이미지의 x≈795–878을 x≈615–688로 — 약 0.78배). 좌표 차이는 기각 사유가 아니고, 같은 문제가 그 근처에 보이는지로 판단한다.

### 1차 측정 — #57(🎃 시즌 팩) base `f493976` ↔ head `a828a1b`

장면: 기본 매트릭스 23장 + `--extra decor`(꾸미기 판 → 5F → 바닥 1 칸, light·dark) = head 25장(+ base 25장), 묶음 4개(studio-light 2·studio-dark 2) 동시 실행. Claude가 스크린샷을 직접 열어 판정했고, 꾸미기 카드 줄은 브라우저에서 `scrollWidth`를 재어 확인했다.

| 회차 | 프롬프트 | 소요(촬영+검수 최대) | 토큰 | 지적 🔴/🟡/🔵/❓ | 판정 | 정확도(❓ 제외) |
|---|---|---|---|---|---|---|
| v1 | `visual.md` 초안 | 94 + 148초 | 204k | 0/1/0/0 | V1 🟡 "마녀 솥 카드 잘림" ❌ `intended` — 카드 줄이 `overflow-x: auto`(scrollWidth 908 > 858)인 가로 스크롤이라 마지막 카드가 반쯤 보이는 것이 정상. 관찰 자체(잘려 보임)는 사실 | 0% |
| v2 | + 움직이지 않는 라벨끼리 겹침은 rm·980에서 확인 · 기존 문제도 `[기존]` 🔵로 보고 · 가로 스크롤 줄 끝 잘림은 ❓ | 94 + 288초 | 257k | 0/0/3/2 | V2 ✅ · V3 ✅ · V1 ◐(같은 원인 중복, 무엇이 무엇을 덮는지 반대로 읽음) · V4·V5 ❓ → 가로 스크롤(위와 같음)로 해소 | 83% |

- **찾은 실제 문제(1종, 이 PR이 만든 것은 아님 — base에도 똑같이 있음)**: 층 간판의 상태 표(작업 중·완료·승인 대기)가 그 층 직원 이름표의 앞부분을 덮는다 — 980 너비(ko·en 모두, rm 정지 화면에서도 재현: 3F `펭귄·Claude` → `de`만, 2F `수달·Gemini` → `·Gemini`, 1F `사장님 (나)` 가림), 1280 영어에서도 4F `obot·Codex`·3F `nguin·Claude`. v1은 놓쳤고 Claude도 처음엔 980만 봤다(1280 영어는 v2가 찾음). 별도 이슈 후보.
- 이 PR의 의도된 화면 변화(🎨 버튼의 🎃 점, 꾸미기 판 머리의 `11/7까지`, 🎃 할로윈 머리표·한정판 딱지)는 두 회차 모두 문제 없음으로 판단했고 Claude 확인도 같다. 회귀 0건.
- 해석: v1은 "회귀만 본다"로 읽혀 기존 문제를 넘겼다 → v2에서 기존 문제를 🔵 `[기존]`으로 받게 하자 재현율이 올랐다. 오탐은 의도된 가로 스크롤 1종뿐이고 v2에선 ❓로 내려왔다. 같은 원인을 묶음마다 따로 내므로(V1~V3) 묶음 간 병합은 Claude가 한다.
- 비용: 회당 Gemini 약 200~260k 토큰(묶음당 45~90k), 벽시계 4~6.5분(촬영 1.5분 + 가장 느린 묶음). 촬영은 head·base 순서로 25장씩 약 45초.

### 결정성 측정 (PR #65 리뷰 반영 뒤)

- `Math.random` 시드 고정(mulberry32, `WR_VIS_SEED`)의 효과: quick 6장을 시드 끔·켬으로 각 3회 찍어 쌍별 픽셀 비교 — 바뀐 비율 평균 끔 0.15~0.17% / 켬 0.13~0.20%, 완전히 같은 장면 2~3/6 → **효과 없음(오차 안)**. 남은 차이는 `performance.now` 기반 애니메이션 시점(직원 걷기·말풍선·비둘기) 때문이고, studio는 배치에 자체 해시(fnv)를 써서 `Math.random` 영향이 작다. 시드는 해가 없어 기본으로 두되, base↔head 비교의 신뢰는 rm 장면에 둔다.

### 다음 측정 계획

- 다음 `web/` 화면 PR 2~3개에서 v2 그대로 돌려 `metrics.md`에 행을 남긴다(TRIAGE §6 지표 규칙). 정확도 < 60%가 2회면 v3.
- 후보 개선(측정 전): 좌표를 % 로도 받기 · 묶음 간 같은 원인 자동 병합 · `--modes all` 비용 측정 · 배율 2(`WR_VIS_DSF=2`)가 작은 글자 판독에 주는 효과.

## 모듈 점검(sweep) · 릴리스 전 점검 (2026-10-30, #60·#61)

- 목적: 넉넉한 Gemini 토큰을 PR 밖(이미 main에 있는 코드·문서)에도 쓰되 앱 품질은 낮추지 않는다 — Gemini 출력은 후보, Claude가 코드로 검증한 것만 이슈·수정이 된다(TRIAGE.md §7).
- 설계: `sweep.sh`는 `modules.txt`의 모듈 코드를 **줄 번호와 함께 프롬프트에 싣는다**(읽기 한도 8/15회를 모듈 밖 호출부 확인에만 쓰게, 줄 번호 오차 방지). 큰 `web/modes/studio/mode.js`(5,700줄·550KB)는 구역 표지로 6조각. PR 전제(diff·"바꾸지 않은 코드는 지적 안 함")는 `SWEEP_PROMPT.md`가 바꾼다. 패스·병합은 `run_review.sh`와 같은 규칙(공용 `lib.sh`·`review_lib.py`). 지난 점검과 같은 지적에는 `repeat_of`.
  `release_check.sh`는 docs·i18n 렌즈(문서·사전을 프롬프트에, 코드는 grep_search로 확인) + 노트 초안 패스(도구 없음, `notes_schema.json`)를 동시에.
- 판정 기준은 위 "지표 정의"와 같다. 정확도 = ✅ / 전체(❓ 제외).

### 1차 측정 (커밋 `a828a1b`, `gemini-3.8-flash-medium`, 재시도 0회)

| 대상 | 패스 | 소요(벽시계) | 지적 🔴/🟡/🔵/❓ | ✅ 실제 | ❌ 오탐 | 정확도 | 비고 |
|---|---|---|---|---|---|---|---|
| sweep `mode-install` | base·data·platform (3) | 486초 | 0/3/2/0 | 3 | 2 | 60% | 실제 3건 모두 🔵로 하향. 오탐 2 = zip 크레이트 동작 추측(platform)·외부 모드 로딩 경로 미확인(data) |
| sweep `updater` | base·state·data·platform (4) | 291초 | 0/4/1/0 | 4 | 1 | 80% | 실제 4건 모두 🔵로 하향(🟡 과대). state·data 렌즈는 0건 — 지적 5건 중 4건이 base |
| release_check | docs·i18n·notes (3) | 450초 | 0/2/1/0 | 3 | 0 | 100% | 노트 초안은 CHANGELOG 사실만 옮김(지어낸 사실 0), 질문 3건 중 1건(11/7 포함 여부)은 코드로 답함 |

판정 (Claude가 각 `file:line`을 열어 확인):

| 대상 | ID | 위치 | 지적 | 판정 | 근거 |
|---|---|---|---|---|---|
| mode-install | F1 | `app/src-tauri/src/mode_install.rs:345` | 업데이트 설치가 기존 폴더를 먼저 지우고 rename — rename 실패 시 옛 버전·스테이징 모두 사라짐 | ✅ 🟡→🔵 | 345~349줄 `remove` 뒤 `rename`, `commands.rs:705`가 실패해도 스테이징 삭제. 같은 볼륨 rename이라 실패는 드묾(Windows 잠금), 잃는 것은 다시 설치할 수 있는 모드 파일 |
| mode-install | F2 | `mode_install.rs:74` | `Budget.bytes += n` 오버플로 → 총량 20MB 검사 우회 | ✅ 🟡→🔵 (재현 안 함) | 릴리스 프로필에 `overflow-checks` 없음(Cargo.toml:24). ZIP64 선언 크기를 2^64 근처로 두면 합이 감김. 항목당 실제 읽기는 `take(MAX_BYTES+1)`로 20MB 상한이라 최악 500×20MB 디스크 사용. `saturating_add`로 충분 |
| mode-install | F3 | `mode_install.rs:135` | 백슬래시 경로 zip이 macOS에서 `enclosed_name` 때문에 거부 | ❌ `hallucination` | zip 9.0.5 `path.rs:60`이 이름을 `Utf8WindowsPath`로 나눠 구성요소마다 push → macOS에서도 `assets/icon.png` |
| mode-install | F4 | `crates/wr-core/src/modes.rs:50` | id `constructor`면 `core.js` `scripts[id] ||=`가 프로토타입을 집음 | ❌ `already-handled` | `loadScript`는 내장(신뢰) 모드만 부름(`core.js:597`·`661`), 외부 모드는 `attachExternal`. 내장 id는 고정 |
| mode-install | F5 | `mode_install.rs:63` | Windows 폴더 설치 때 `desktop.ini`·`Thumbs.db`가 있으면 확장자 거부로 설치 실패 | ✅ 🔵 | `skip_name`은 점·`__MACOSX`만, `ext_ok` 화이트리스트에 ini·db 없음 |
| updater | F1 | `app/src-tauri/src/updater.rs:295` | `install` phase 검사와 설정 사이 경합 → 동시 다운로드 | ❌ `already-handled` | 유일한 호출부 `manager.js:204`가 누르는 즉시 버튼을 끔, 트레이 "update"는 창만 엶(`tray.rs:274`). 백엔드 가드 보강은 선택 |
| updater | F2 | `updater.rs:255` | 확인 실패(오프라인)에도 `last_check` 갱신 → 24시간 재시도 안 함 | ✅ 🟡→🔵 | `is_due`가 `CHECK_EVERY` 기준, 루프는 1시간마다 깨지만 실패 시각으로 막힘. 주석 "다음 시각에 다시"의 의도(1시간/24시간) 확인 필요 |
| updater | F3 | `updater.rs:217` | 백그라운드 확인 중 [지금 확인] → 진행 중 결과 대신 `found=None` → "최신 버전이에요" | ✅ 🟡→🔵 | 216~220줄 조기 반환, `check_now` 152~156줄이 `Ok(None)`→`latest`. 시작 15초 뒤·설정 재켜기 직후 몇 초 창에서만 |
| updater | F4 | `scripts/version.py:139` | `subprocess.run(text=True)` 인코딩 미지정 → Windows에서 한글 커밋 제목 디코딩 실패 | ✅ 🟡→🔵 | 개발용 스크립트(§4 보정: 🔵). Release Prep은 Linux라 CI 영향 없음, 로컬 Windows `bump`에서만 |
| updater | F5 | `scripts/version.py:209` | `check` 오류가 안내하는 `bump <지금 버전>`은 `new <= cur`로 항상 거부 | ✅ 🔵 | 209줄 안내 ↔ 244줄 검사 |
| release | F1 | `docs/DEVELOPMENT.md:271` | 숫자키 기본 순서가 "1 햄찌 … 7 스튜디오"인데 실제는 1 스튜디오 | ✅ 🟡→🔵 | `web/modes/index.json` builtin 순서가 studio부터, `core.js:291` `ordered()`. 개발 문서라 🔵 |
| release | F2 | `docs/INSTALL.md:68`·`:120` | 「현재 한계」가 "코드 서명·공증은 아직 없습니다" — 0.4.2부터 macOS 공증(같은 문서 위쪽·CHANGELOG 0.4.2) | ✅ 🟡 | 사용자 문서 안 모순(ko·en 둘 다) |
| release | F3 | `web/core/i18n.js:245` | `nx.subs` en "{n} sub-agents" → "1 sub-agents" | ✅ 🔵 | `nunchi.js:311`·`312`에서 `sb.length`로 그대로 |

해석:
- 오탐 3건 중 2건은 **외부 라이브러리·다른 파일의 동작을 열어 보지 않고 추측**(F3 zip 크레이트, F4 로딩 경로), 1건은 **UI가 이미 막는 경합**. 1차 측정 때는 오탐 방지 규칙이 렌즈 패스에만 있었다 → 그 뒤 `SWEEP_PROMPT.md`에 기본 패스용 오탐 방지 규칙(모듈 밖 코드에 기대는 지적은 직접 열어 확인한 뒤에만)을 넣었다. 효과는 2차 측정에서 본다.
- 등급은 여전히 과대(🟡 7건 중 6건이 🔵 적정). sweep은 오래된 코드라 "평범하게 하루 한 번"인 버그가 드물다 — Claude 판정에서 대부분 🔵로 내린다.
- 렌즈 기여: updater는 state·data 0건, platform 1건(version.py 인코딩). mode-install은 base·data·platform이 F1을 함께 찾음(독립 확증 아님). 렌즈 효과는 PR 때(§렌즈)보다 약하다 — 모듈 3~4개 더 재고 0건이 이어지는 렌즈는 그 모듈에서 뺀다.
- 비용: 모듈당 패스 3~4회, 프롬프트 66~78KB(입력 약 20~26k 토큰/패스 + 도구 호출마다 맥락 재전송분 — agy JSON에 토큰 사용량이 없어 실측 불가). 벽시계는 가장 느린 패스 기준 5~8분. 전체 21모듈 추정은 `sweep.sh list`.
- 실제 이슈 후보(앱 코드 수정은 이 브랜치에서 하지 않음): mode-install F1·F2·F5, updater F2·F3·F4·F5, 문서 F1·F2, i18n F3.

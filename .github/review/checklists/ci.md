# 체크리스트: CI·저장소 설정·문서 (ci)

대상: `.github/workflows/*`, `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md`, `scripts/*`(검사 도구), `CONTRIBUTING.md`·`SECURITY.md`·`README.md`·`docs/DEVELOPMENT.md`.

## C1. 워크플로 권한·트리거
- [ ] 최상위 `permissions`가 최소(`contents: read`)이고 잡에서 넓히지 않는가
- [ ] `pull_request_target`·`workflow_run`으로 **포크 코드를 쓰기 권한/시크릿과 함께** 실행하는가 → 🔴
- [ ] `${{ github.event.pull_request.title }}`·`head_ref`·이슈 본문 등 공격자 제어 값이 `run:` 셸에 직접 들어가는가(스크립트 인젝션) → 환경변수로 넘겨야 함
- [ ] `actions/checkout`에 `persist-credentials: false`
- [ ] 서드파티 액션이 **커밋 SHA**로 고정되어 있는가(태그만이면 🟡). SHA의 존재 여부는 추측으로 판단하지 말 것 — 모르면 지적하지 않거나 `question`(이 저장소 CI 실행 결과로 이미 확인됐을 수 있다)
- [ ] `concurrency`·`timeout-minutes`가 있어 무한 실행·중복 실행을 막는가

## C2. 검사가 실제로 검사하는가
- [ ] 각 단계가 실패해야 할 때 실패하는가: 종료 코드를 삼키는 `|| true`, 파이프 뒤 종료 코드(`set -o pipefail` 없음), 스크립트가 예외 대신 0을 반환하는 경로
- [ ] 검사 대상 범위: `git ls-files`만 보는지(새 파일은 커밋돼야 보임 — CI에선 정상), 바이너리·특정 확장자 건너뛰기가 시크릿을 놓치는가
- [ ] 결정성 검사(`make_fixtures.py` 재실행 후 diff, `snapshot.py --check` 2회)가 추적 안 된 새 파일도 잡는가
- [ ] 검사 도구가 **찾은 시크릿을 로그에 출력**하는가(공개 저장소의 CI 로그는 공개) — 출력은 종류·위치·짧은 접두사까지만
- [ ] 정규식 검출기: 실제 형태는 잡고(길이·문자 집합) 문서 예시·자리표시자는 놓아 주는가. 예외 목록(`alex`, `runner` 등)이 의도보다 넓게 통과시키는 입력을 **구체적 문자열로** 제시할 수 있을 때만 지적
- [ ] 의존성 설치 버전 고정(`pip install x==버전`), 해시 고정 여부

## C3. 문서·템플릿 정합성
- [ ] 문서에 적힌 명령이 실제로 존재·동작하는가(스크립트 이름·옵션·경로) — 직접 파일을 열어 확인
- [ ] 문서끼리 모순: README·CONTRIBUTING·PR 템플릿·ARCHITECTURE가 같은 규칙을 다르게 말하는가(예: 검사 개수 15/15, 커밋 트레일러 형식)
- [ ] 링크 대상(파일·절 번호 `§`)이 존재하는가
- [ ] 보안 신고 경로(`security/advisories/new`)는 저장소 설정 "Private vulnerability reporting"이 켜져 있어야 동작 — 문서만으로는 확인 불가하므로 필요하면 `question`
- [ ] 문서 갱신 의무(필수, REVIEW_PROMPT §6): 새 디렉터리·스크립트가 `docs/DEVELOPMENT.md` 구조 섹션(최상위 폴더면 README 「프로젝트 구조」도)에 반영됐는가

## C4. 개인 정보·흔적
- [ ] 템플릿·문서·스크립트에 실제 홈 경로·이메일·소속 조직명·세션 링크
- [ ] 커밋 트레일러 규칙(`Co-Authored-By:` 한 줄, 세션 링크 금지)과 템플릿 문구가 일치하는가

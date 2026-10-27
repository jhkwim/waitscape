# 기여 안내 / Contributing

Waitscape에 관심 가져 주셔서 고맙습니다. 이 문서는 한국어가 기준이고 핵심 규칙은 영어를 같이 적습니다.
Thanks for your interest in Waitscape! Korean is the primary language here; key rules are also given in English.

- 설계: [`ARCHITECTURE.md`](ARCHITECTURE.md) · 모드 만들기: [`MODES.md`](MODES.md) · 보안 신고: [`SECURITY.md`](SECURITY.md) · 행동 강령: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## 1. 개발 환경 / Dev setup

| 필요 / Requires | 용도 / Purpose |
|---|---|
| Python 3.9+ (stdlib only) | 참조 백엔드 `server.py`, 훅 `hook.py`, 검사 스크립트 |
| [Bun](https://bun.sh) (선택 / optional) | 개발 서버 `tools/dev.ts` (자동 새로고침) |
| `pip install jsonschema` (선택) | `scripts/validate_modes.py` |
| Rust stable (P1부터 / from P1) | `crates/wr-core`·`wr-hook`·`wr-server`, Tauri 앱 |

```sh
python3 server.py            # http://localhost:7777 (환경변수: .env.example)
bun tools/dev.ts             # http://localhost:7780 — 파일 저장 시 자동 새로고침
```

커밋 전에 CI와 같은 검사를 돌려 주세요 / Run the CI checks locally before pushing:

```sh
python3 scripts/check_secrets.py --leak     # 시크릿·개인 경로 패턴 + 마스킹 유출
python3 scripts/snapshot.py --check         # 기준 결과 동등성·결정성 (15/15)
python3 scripts/selftest_transcript_only.py # 트랜스크립트 전용 규칙 검사기 자체 점검
python3 scripts/validate_modes.py           # mode.json 스키마 검증
python3 scripts/selftest_check_secrets.py   # 시크릿·경로 탐지 회귀 테스트
```

`server.py` 동작을 **의도적으로** 바꿨다면 `python3 scripts/snapshot.py`로 기준 결과를 다시 만들고, PR에 이유를 적어 주세요.
fixture에는 합성 데이터만 넣습니다(실제 트랜스크립트·개인 경로·진짜 시크릿 금지. 가짜 시크릿은 `fixtures/fake_secrets.json`에 조각으로).

## 2. 브랜치·커밋 규칙 / Branches & commits

- `main`에 직접 푸시하지 않습니다. 모든 변경은 PR로 / Never push to `main`; everything goes through a PR.
- 브랜치 이름 / Branch names: `<type>/<짧은-설명>` — 예 `feat/mode-aquarium`, `fix/flow-cursor`, `docs/modes-provider`, `chore/ci-rust`
- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 형식 / Use Conventional Commits:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:` (+ 선택 범위 `feat(flow): …`). 제목은 72자 이내, 본문엔 "왜"를.
- 커밋 작성자·커미터 이메일은 **GitHub noreply 이메일**을 권장합니다 / Prefer your GitHub noreply email for commits:
  `<ID>+<사용자명>@users.noreply.github.com` (GitHub → Settings → Emails → "Keep my email addresses private"에 표시됨). 메인테이너 커밋도 noreply 이메일을 씁니다.
  ```sh
  git config user.email "<ID>+<사용자명>@users.noreply.github.com"   # 이 저장소에서만
  ```
  CI(`scripts/check_commit_emails.py`)는 저장소 시크릿 `BLOCKED_EMAIL_DOMAINS`의 도메인 이메일을 막습니다(특정 주소를 강제하지는 않음. 로컬 확인 예: `BLOCKED_EMAIL_DOMAINS=example.com python3 scripts/check_commit_emails.py origin/main..HEAD`).
- 한 PR = 한 주제. 서식 변경과 동작 변경을 섞지 않습니다.

## 3. 이슈 → PR 흐름 / Issue → PR flow

1. 이슈 먼저: 버그·기능·모드·프로바이더 템플릿 중 하나로 등록 (작은 오타 수정은 바로 PR 가능).
2. 하겠다고 댓글을 남기면 담당자로 지정합니다. `good first issue`·`help wanted` 라벨부터 시작해 보세요.
3. 브랜치를 만들고 작업 → 로컬 검사 → PR. 본문에 `Fixes #<번호>`를 넣고 템플릿 체크리스트를 채웁니다.
4. CI 통과 + 메인테이너 검토 → squash merge. (혼자 운영하는 프로젝트라 외부 PR은 메인테이너가 읽고 승인하며, 메인테이너 본인 PR은 CI 통과 + 셀프 리뷰로 병합합니다. 답이 늦어도 양해해 주세요.)

### 처음 기여하는 분께 / First-time contributors

- **첫 PR은 CI가 바로 돌지 않습니다**: GitHub 정책상 처음 기여하는 계정의 포크 PR은 메인테이너가 "Approve and run"을 눌러야 워크플로가 시작됩니다. 체크가 "승인 대기"로 보여도 정상입니다 / Your first PR's CI waits for maintainer approval.
- **포크 PR에는 시크릿이 전달되지 않습니다**: 그래서 커밋 작성자 이메일 검사(`authors` 잡)는 차단 도메인 목록이 비어 건너뜁니다. 위 이메일 규칙은 지켜 주세요 / Forked PRs skip the author-email check (no secrets).
- **Rust CI는 경로 필터가 있습니다**: `rust.yml`은 `crates/**`·`app/**`·`Cargo.*`·`fixtures/**`·`server.py` 등 Rust 결과에 영향을 주는 파일이 바뀐 PR에서만 돕니다(목록은 워크플로 파일). 웹 모드·문서만 바꾼 PR에는 Python CI(`ci.yml`)만 보입니다.
- `.github/review/`는 메인테이너가 쓰는 선택적 교차 리뷰 도구입니다. 기여자는 몰라도 되고 따로 돌릴 필요가 없습니다 / `.github/review/` is an optional maintainer-only tool; you can ignore it.

라벨: 영역 `mode` `core` `backend` `provider` `app` `docs` `security`, 종류 `bug` `enhancement`, 단계 `P1`~`P4`(ARCHITECTURE.md §8).

## 4. 모드 기여 / Contributing a mode

- 형식·`ctx` 권한·샌드박스·체크리스트는 [`MODES.md`](MODES.md). 스타터는 `web/modes/_template/`.
- 새 모드는 먼저 **외부 모드**(사용자 모드 폴더)로 만들어 샌드박스에서 시험한 뒤, **모드 제출** 이슈로 공유합니다.
- 내장으로 넣는 PR이면: `web/modes/<id>/`에 추가, `web/modes/index.json`에 등록, `README.md` 구조 섹션 갱신, MODES.md §11 체크리스트 통과.
- `needs` 권한은 꼭 필요한 것만. 외부 폰트·이미지 CDN은 쓰지 말고 `assets/`에 번들(라이선스 확인).
- 문구에 "Claude"를 박지 말고 `Core.provider(state, s).name`을 씁니다(MODES.md §6).

## 5. 프로바이더 기여 / Contributing a provider

- 먼저 **프로바이더 요청** 이슈로 도구 이름·기록 파일 위치·형식·기능(`capabilities`)을 정리합니다.
- 데이터 계약은 `types/state.d.ts`의 `provider`·`providers`(@since 1.1). 구현은 P1 Rust 백엔드(`crates/wr-core`)의 프로바이더 구조 위에 올립니다.
- 합성 fixture(실제 세션 기록 금지)와 기대값을 함께 PR에 넣어 주세요.

## 6. AI 사용 공개 / AI disclosure

AI 코딩 도구(Claude Code, Codex, Copilot 등)를 써도 됩니다. 다만 **공개**하고 **사람이 책임**집니다.
AI tools are welcome, but use must be **disclosed** and a **human is accountable**.

- **커밋**: AI가 함께 작성한 커밋은 메시지 끝에 `Co-Authored-By:` 줄을 붙입니다 / Add a `Co-Authored-By:` trailer to AI-assisted commits:
  ```
  feat(flow): 실패 소용돌이 크기를 실패 횟수에 비례

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
  세션 링크·대화 공유 링크 등 **개인 대화로 이어지는 링크는 넣지 않습니다** / Do **not** include session or conversation links.
- **PR**: 설명에 사용한 AI 도구와 범위를 적습니다(템플릿의 "AI 사용" 항목) / State which AI tools you used in the PR description.
- **책임 / Accountability**: PR 작성자가 모든 줄을 읽고 이해했으며, 동작·라이선스·보안에 대한 책임은 사람 작성자에게 있습니다. 리뷰 질문에 "AI가 그렇게 했어요"는 답이 아닙니다.
- AI 도구에 시크릿·실제 세션 기록·공개하면 안 되는 코드(직장 코드 등)를 넣지 마세요.

## 7. 라이선스 / License

기여한 내용은 [MIT 라이선스](LICENSE)로 배포됩니다 / Contributions are licensed under MIT.

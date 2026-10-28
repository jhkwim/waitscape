# 릴리스 · 앱 안 업데이트 (관리자용)

버전 올리기부터 사용자의 앱이 "새 버전 나왔어요!"를 띄우기까지의 흐름과, 사람이 해야 할 일을 정리한다.
사용자용 설치·업데이트 안내는 [INSTALL.md](INSTALL.md).

## 1. 한눈에

```
[Actions → Release Prep → Run workflow]  입력: 0.2.0 | major | minor | patch      (Linux 1개, 수십 초)
        │  scripts/version.py bump → Cargo.toml · tauri.conf.json · Cargo.lock · CHANGELOG.md
        ▼
[PR  release/v0.2.0  "chore(release): v0.2.0"]   ← 사람이 CI 돌리고(§4) 검토·병합
        │  병합되면 release-prep.yml의 tag 잡 (Linux 1개)
        ▼
[태그 v0.2.0 = 병합 커밋]  →  release.yml을 그 태그로 실행 (workflow_dispatch)
        │  macOS universal(.dmg·.app.zip) + Windows x64(.exe·.msi) 빌드
        │  업데이터 서명 시크릿이 있으면 .app.tar.gz·.sig + latest.json도
        ▼
[초안(draft) 릴리스]  ← 사람이 파일·노트 확인 후 Publish
        │  게시하면 publish-public.yml이 공개 저장소(jhkwim/waitscape-releases)로 복사(§6)
        │  그래야 releases/latest/download/latest.json이 새 버전을 가리킨다(초안은 안 보임)
        ▼
[설치된 앱]  시작할 때 + 하루 1번 latest.json 확인 → OS 알림 · 트레이 "🎁 업데이트 있음" · 배너/스튜디오 사장님 말풍선
        │  사용자가 [지금 업데이트하고 다시 시작]을 누를 때만
        ▼
내려받기 → minisign 서명 검증 → 설치 → 다시 시작
```

- 관련 파일: `.github/workflows/release-prep.yml`, `.github/workflows/release.yml`, `.github/workflows/publish-public.yml`, `scripts/version.py`, `scripts/make_latest_json.py`,
  `app/src-tauri/src/updater.rs`, `app/src-tauri/tauri.conf.json`(`plugins.updater`), `CHANGELOG.md`.
- Actions 시간: 릴리스 빌드(맥·윈도우)는 태그에서만 돈다. 버전 PR·태그 잡은 Linux 1개이고 빌드하지 않는다. 다른 PR이 닫힐 때도 release-prep.yml이 깨어나지만 잡 조건이 맞지 않아 러너를 쓰지 않는다.

## 2. 버전은 한 곳

원본은 **`Cargo.toml`의 `[workspace.package] version`** 하나다. 크레이트(`crates/*`, `app/src-tauri`)는 `version.workspace = true`로 따라간다.
나머지는 `scripts/version.py`가 맞춘다.

| 위치 | 역할 | 누가 맞추나 |
|---|---|---|
| `Cargo.toml` `[workspace.package] version` | **원본** | `version.py bump` |
| `app/src-tauri/tauri.conf.json` `version` | 설치 파일 이름·업데이터가 비교하는 버전 | `version.py bump` (다르면 `build.rs`가 빌드를 멈춤) |
| `Cargo.lock` 워크스페이스 패키지 4개 | 잠금 파일 | `version.py bump` |
| `CHANGELOG.md` | `[Unreleased]` → `[X.Y.Z] - 날짜` (비어 있으면 지난 태그 이후 PR 제목으로 채움) | `version.py bump` |
| 실행 중 버전(`CARGO_PKG_VERSION`) | User-Agent(`brand.json`의 `<VERSION>`), 업데이터 현재 버전 | 빌드 때 자동 |

`brand.json`에는 버전이 없다. `mode.json`의 `version`은 모드 자체 버전이라 상관없다. Mode API 버전은 따로(`types/CHANGELOG.md`).

```
python3 scripts/version.py show                      # 0.1.0
python3 scripts/version.py check [--tag v0.1.0]      # 모두 같은지 (CI python 잡이 매번 실행)
python3 scripts/version.py bump minor --dry-run      # 바뀔 파일만 보여 줌
python3 scripts/version.py bump 0.2.0                # 실제로 (보통은 Release Prep이 대신 함)
python3 scripts/version.py notes 0.2.0               # CHANGELOG의 그 절 (릴리스 노트·latest.json notes)
```

## 3. 릴리스하는 법

1. 평소에 PR마다 `CHANGELOG.md`의 `[Unreleased]`에 한 줄씩 적는다(안 적어도 릴리스 때 PR 제목으로 채워진다).
2. GitHub → **Actions → Release Prep → Run workflow** → 브랜치 `main`, 버전에 `0.2.0` 또는 `minor` 등.
3. `release/v0.2.0` PR이 생긴다. **CI를 돌린다(§4)**. CHANGELOG 문구를 다듬고 싶으면 그 브랜치에 커밋을 더한다.
4. PR을 병합한다 → 태그 `v0.2.0`이 붙고 Release 워크플로가 시작된다(Actions 탭에서 확인).
5. 끝나면 **Releases의 초안**을 연다. 확인할 것:
   - 파일: `.dmg`, `.app.zip`, `.exe`, `.msi`, `SHA256SUMS.txt` (업데이터 서명을 켰다면 `.app.tar.gz`, `*.sig`, `latest.json`)
   - `latest.json`의 `version`이 태그와 같고 `platforms`에 `darwin-aarch64`·`darwin-x86_64`·`windows-x86_64`가 있는지
   - 노트(바뀐 점)
6. **Publish release**. 이때부터 설치된 앱이 새 버전을 찾는다(다음 시작 때 또는 하루 안에).

손으로 할 때(워크플로를 못 쓸 때): `python3 scripts/version.py bump 0.2.0` → PR → 병합 → `git tag v0.2.0 <병합 커밋> && git push origin v0.2.0`. 사람이 push한 태그는 release.yml을 바로 깨운다.

문제가 생기면: 초안은 지우고(태그도 지우고) 고친 뒤 다시. 이미 게시했다면 다음 patch 버전으로 고친다(같은 버전 번호를 다시 쓰지 않는다 — 앱은 버전이 커질 때만 업데이트로 본다).

## 4. 버전 PR에 CI 돌리기 (중요)

Release Prep은 `GITHUB_TOKEN`으로 브랜치를 push하고 PR을 만든다. GitHub는 `GITHUB_TOKEN`이 만든 이벤트로 다른 워크플로를 깨우지 않으므로
**이 PR에는 CI(ci.yml·rust.yml)가 저절로 돌지 않는다.** 병합 전에 아래 중 하나를 한다.

- **PR을 닫았다가 다시 열기**(Close → Reopen). 사람이 한 이벤트라 CI가 돈다. 가장 간단하다.
- 또는 그 브랜치에 **빈 커밋을 push**: `git fetch origin release/v0.2.0 && git switch release/v0.2.0 && git commit --allow-empty -m "ci: 검사 실행" && git push`
- 매번 번거로우면: 저장소 시크릿에 권한을 좁힌 fine-grained PAT(이 저장소만, Contents·Pull requests 쓰기)나 GitHub App 토큰을 두고
  release-prep.yml의 checkout `token:`과 `GH_TOKEN`을 그 시크릿으로 바꾼다. **토큰 값·개인 이메일을 워크플로 파일에 직접 쓰지 않는다.**

병합 뒤 태그 잡도 `GITHUB_TOKEN`으로 태그를 만들기 때문에 release.yml의 `push: tags`는 깨어나지 않는다. 그래서 태그 잡이 `gh workflow run release.yml --ref vX.Y.Z`로 직접 부른다(workflow_dispatch는 예외적으로 허용됨).

커밋 작성자: 워크플로가 만드는 커밋은 `github-actions[bot]`(GitHub 기본 봇 신원)이다. 개인 이메일은 쓰지 않는다(사람이 만드는 커밋은 GitHub noreply 이메일, CONTRIBUTING §2).

## 5. 업데이터 서명 키 (사람이 한 번만)

앱 안 업데이트는 **Tauri 업데이터 서명**(minisign)으로 내려받은 파일을 검증한다. Apple Developer ID·Windows 코드 서명과는 **별개**이고 인증서가 필요 없다.
저장소에는 비밀 키를 절대 두지 않는다. 공개 키만 `tauri.conf.json`에 들어간다(공개 키는 비밀이 아니다. 2026-10-27에 키를 만들어 넣었다 — 키 ID `2F4EA67B38262C6B`).

체크리스트:

- [x] **키 만들기** (내 맥에서, 저장소 폴더 밖에):
  ```
  cargo tauri signer generate -w ~/.tauri/waitscape.key
  ```
  암호를 묻는다(권장: 암호 사용). `~/.tauri/waitscape.key`(비밀 키)와 `~/.tauri/waitscape.key.pub`(공개 키)가 생긴다.
- [ ] **백업**: 비밀 키 파일과 암호를 비밀번호 관리자 등 안전한 곳에 따로 보관한다.
  > ⚠️ 이 키를 잃어버리면 이미 설치된 앱에 **더 이상 업데이트를 보낼 수 없다**(새 키로 서명한 파일은 옛 앱이 거부). 사용자가 새 설치 파일을 손으로 받아야 한다. 키가 새면 누구나 가짜 업데이트를 서명할 수 있으니 즉시 새 키로 바꾸고 공지한다.
- [ ] **release 환경 시크릿 등록** (저장소 시크릿이 아니라 **Environments**에. 아래 「배포 환경」 참고): GitHub → Settings → Environments → `release` → Environment secrets → Add secret
  - `TAURI_SIGNING_PRIVATE_KEY` = `~/.tauri/waitscape.key` 파일 **내용 전체**
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = 키 암호 (암호 없이 만들었으면 등록하지 않아도 됨)
  - (선택) Apple 코드 서명·공증도 같은 `release` 환경에: `APPLE_CERTIFICATE`(base64 .p12, 줄바꿈 있어도 됨), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, 공증은 `APPLE_ID`·`APPLE_PASSWORD`(앱 암호)·`APPLE_TEAM_ID`
  - 예전에 저장소 시크릿(Settings → Secrets and variables → Actions)에 넣었다면 환경으로 옮기고 저장소 시크릿은 지운다
- [x] **공개 키 붙여넣기**: `~/.tauri/waitscape.key.pub` 내용(한 줄)을 `app/src-tauri/tauri.conf.json`의 `plugins.updater.pubkey` 자리표시자 대신 넣고 PR로 병합한다.
- [ ] 비밀 키 파일을 저장소 안에 두지 않았는지 확인 (`.gitignore`가 `*.key`를 막지만, 애초에 `~/.tauri/`에 둔다).

### 배포 환경 (GitHub Environments)

공개 저장소에서는 누구나 PR을 열 수 있으므로, 서명·배포 시크릿은 **환경 시크릿**으로만 두고 정해진 ref에서만 열리게 한다.

| 환경 | 쓰는 잡 | 시크릿 | 배포 브랜치·태그 규칙 (Settings → Environments → 환경 → Deployment branches and tags → Selected) |
|---|---|---|---|
| `release` | `release.yml` build | `TAURI_SIGNING_PRIVATE_KEY`(`_PASSWORD`), `APPLE_*`(선택) | 태그 `v*`, 브랜치 `main` |
| `mirror` | `publish-public.yml` mirror | `RELEASES_REPO_TOKEN` | 같은 규칙: 태그 `v*`, 브랜치 `main` |

- 환경이 없으면 GitHub가 첫 실행 때 규칙 없는 빈 환경을 만든다 → 시크릿이 없어 서명·복사만 건너뛴다. 처음 한 번 위 표대로 만들고 규칙을 건다.
- release.yml의 `guard` 잡은 태그 `v*`·`main`이 아닌 수동 실행을 일찍 실패시키는 **실수 방지용**이다. 보안 경계는 위 환경 배포 규칙이다(규칙을 반드시 건다).
- 포크 PR 워크플로에는 시크릿이 전달되지 않고(GitHub 기본), ci.yml·rust.yml은 시크릿을 쓰지 않는다(ci.yml의 `BLOCKED_EMAIL_DOMAINS`만 예외, 포크 PR에서는 건너뜀).

시크릿이 없으면 release.yml은 업데이터 서명 단계만 건너뛰고(`.app.tar.gz`·`.sig`·`latest.json` 없음) 나머지는 성공한다.
시크릿은 있는데 공개 키가 아직 자리표시자면 경고(`::warning::`)를 남기고 역시 건너뛴다(검증할 수 없는 앱을 만들지 않기 위해).

앱 쪽 규칙(`updater.rs`): 공개 키가 자리표시자인 빌드는 **업데이트 확인을 아예 하지 않는다**(설정 화면에 "이 빌드는 업데이트 서명 키가 없어 확인하지 않아요"). 그래서 공개 키를 넣은 첫 버전은 사용자가 한 번은 손으로 설치해야 하고, 그 다음부터 앱 안 업데이트가 된다.

## 6. 배포 전용 공개 저장소 (`jhkwim/waitscape-releases`)

**설치·업데이트의 공식 위치는 배포 전용 공개 저장소 `jhkwim/waitscape-releases`다.** 코드 저장소(`jhkwim/waitscape`)도 공개지만
설치 파일·`latest.json`은 계속 배포 저장소에만 올린다. 이미 설치된 앱의 업데이터 엔드포인트(`tauri.conf.json` `plugins.updater.endpoints`)가
배포 저장소를 가리키므로 **이 주소는 바꾸지 않는다**(바꾸면 옛 앱이 새 버전을 못 찾는다).
(처음에 배포 저장소를 따로 둔 까닭: 코드 저장소가 비공개였던 동안 Release 파일을 인증 없이 받을 수 없었다. 공개 뒤에도 주소 고정을 위해 유지한다.)

```
[본 저장소 초안 릴리스]  latest.json의 내려받기 주소는 처음부터 공개 저장소 (release.yml RELEASES_REPO)
        │  사람이 Publish
        ▼
[publish-public.yml]  release: published → 본 저장소 파일 내려받기 → SHA256SUMS 확인 → latest.json 주소 확인
        │  RELEASES_REPO_TOKEN으로
        ▼
[공개 저장소 같은 태그 릴리스]  같은 제목·노트·파일. 사전 릴리스면 사전 릴리스, 본 저장소에서 Latest면 Latest
        ▼
[설치된 앱]  https://github.com/jhkwim/waitscape-releases/releases/latest/download/latest.json
```

처음 한 번 (사람이):

1. 공개 저장소 만들기: README(받는 곳·설치 안내) 하나만 든 `jhkwim/waitscape-releases`(Public, 위키·이슈 끔). 코드는 올리지 않는다.
2. 토큰: GitHub → Settings → Developer settings → Fine-grained tokens → 새 토큰
   - Repository access: **Only select repositories → `jhkwim/waitscape-releases`** 하나
   - Permissions: **Contents: Read and write** (나머지 없음), 만료일을 정해 두고 달력에 적어 둔다
   - 본 저장소 → Settings → Environments → `mirror` → Environment secrets → `RELEASES_REPO_TOKEN`에 등록(위 「배포 환경」 규칙)
3. §5 체크리스트(업데이터 서명 키·공개 키)를 끝낸다.
4. §3대로 릴리스하고 초안을 **게시** → Actions의 "Publish Public"이 끝나면 확인:
   브라우저로 `https://github.com/jhkwim/waitscape-releases/releases/latest/download/latest.json`을 열어 새 버전 JSON이 보이는지.
5. 공개 키가 든 첫 버전은 사용자가 한 번 손으로 설치한다. 그 다음 버전부터 앱이 스스로 알린다(시작 15초 뒤 확인).

- 토큰이 없으면 "Publish Public"은 경고만 남기고 건너뛴다(본 저장소 릴리스는 그대로).
- 다시 복사: Actions → Publish Public → Run workflow → 태그 입력. 이미 있으면 파일을 덮어쓰고 노트를 갱신한다.
- 공개 저장소 릴리스를 손으로 고치지 않는다(다음 복사 때 덮어씀). 노트는 본 저장소 릴리스에서 고치고 다시 복사한다.
- 잘못 게시했으면: 공개 저장소 릴리스를 먼저 지운다(앱이 받지 않게). 이미 퍼졌으면 다음 patch로 고친다.

엔드포인트는 `tauri.conf.json`의 `plugins.updater.endpoints`다. `latest`는 초안·사전 릴리스를 건너뛰므로, 게시 전에는 사용자에게 보이지 않는다.

## 7. latest.json 형식

`scripts/make_latest_json.py`가 초안 릴리스 잡에서 만든다(서명 `.sig`가 있을 때만).

```json
{
  "version": "0.2.0",
  "notes": "CHANGELOG의 [0.2.0] 절",
  "pub_date": "2026-10-23T03:04:05Z",
  "platforms": {
    "darwin-aarch64":    { "url": ".../v0.2.0/Waitscape-macos-universal.app.tar.gz", "signature": "<.sig 내용>" },
    "darwin-x86_64":     { "url": "(같은 universal 묶음)", "signature": "..." },
    "windows-x86_64":    { "url": ".../v0.2.0/Waitscape_0.2.0_x64-setup.exe", "signature": "..." },
    "windows-x86_64-msi":{ "url": ".../v0.2.0/Waitscape_0.2.0_x64_en-US.msi", "signature": "..." }
  }
}
```

(`darwin-*-app`, `windows-x86_64-nsis` 키도 함께 쓴다 — 설치 형식별 키를 먼저 찾는 업데이터용.) Windows는 `installMode: passive`(진행 창만, 묻지 않음)로 설치 후 앱을 다시 띄운다.

### 배포 대상(OS)을 늘릴 때
Dependabot 경고 중 배포 대상에서 쓰이지 않아 닫은 것은 `.github/platform-advisories.json`에 적어 둔다(지금: `glib` — Linux 전용, #15).
`release.yml`에 Linux(matrix `os: ubuntu-*` 또는 `--bundles deb·appimage·rpm`)를 더하면 CI의 `scripts/check_platform_advisories.py`가 실패하며 다시 열 경고를 알려 준다.
그 경고를 다시 열고(Security → Dependabot → 닫은 경고 → Reopen) 고친 버전으로 올린 뒤 기록에서 지운다.

## 8. 빌드 플레이버 (Mac App Store 대비, 구조만)

앱 크레이트(`app/src-tauri/Cargo.toml`)의 컴파일 타임 기능:

| feature | 기본 | 끄면 |
|---|---|---|
| `updater` | 켜짐 | `tauri-plugin-updater`·네트워크 코드가 빠짐. 설정의 업데이트 카드·배너·말풍선·트레이 항목이 사라짐 |
| `terminal-jump` | 켜짐 | 다른 앱 실행(`open -a`, `wt -d`) 코드가 빠짐. 모드의 '터미널로 이동' 버튼과 설정의 터미널 앱 선택이 사라짐 |

```
cargo tauri build --no-default-features                 # 둘 다 끔 (스토어용 모양)
cargo tauri build --no-default-features --features updater   # 골라서
cargo clippy -p waitscape --all-targets --no-default-features -- -D warnings   # CI(rust.yml)도 검사
```

웹 화면은 `app_info` 명령의 `features`로 켜진 기능을 알고 UI를 숨긴다(`web/core/core.js` `applyAppInfo`). 명령·권한 목록은 플레이버와 관계없이 같고, 빠진 기능의 명령은 `disabled`/`unsupported`를 돌려준다.

**Mac App Store 계획 (아직 만들지 않음)**:
- 식별자 분리: 직접 배포판 `io.github.jhkwim.waitscape`, 스토어판 `io.github.jhkwim.waitscape.mas`. `brand.json`에 `identifierMas`를 두고, 스토어 빌드는 `tauri.mas.conf.json`(identifier·서명·entitlements)을 `--config`로 덮어쓴다. `build.rs`의 brand 검사도 두 값을 알게 바꾼다.
- 데이터 폴더가 식별자에 따라 달라지므로(샌드박스 컨테이너) 두 판을 함께 쓰면 설정이 따로 논다 — 안내 필요.
- 스토어판은 `--no-default-features`(업데이트는 스토어가, 다른 앱 실행은 샌드박스에서 막힘). 훅 설치(`~/.claude` 쓰기)·트랜스크립트 읽기는 App Sandbox에서 사용자가 폴더를 골라 주는 security-scoped bookmark가 필요하다 → 별도 설계.
- 서명: Apple Distribution 인증서 + 프로비저닝 프로필 + `com.apple.security.app-sandbox` entitlements. 릴리스 워크플로에 별도 잡으로(태그에서만).

## 9. 문제 해결

| 증상 | 원인·해결 |
|---|---|
| Release Prep: "브랜치가 이미 있다" | 이전 버전 PR이 열려 있음 → 병합하거나 브랜치 삭제 후 다시 |
| Release Prep: "새 버전이 지금 버전보다 커야" | 입력을 확인(같은 버전·낮은 버전 불가) |
| 버전 PR에 체크가 안 보임 | §4 (닫았다 다시 열기) |
| 병합했는데 태그가 안 생김 | PR 브랜치 이름이 `release/vX.Y.Z`인지, 같은 저장소 브랜치인지. Actions의 Release Prep → tag 잡 로그 |
| release.yml "태그와 앱 버전이 다르다" | 태그를 손으로 잘못 붙임 → 태그 삭제 후 `version.py check --tag`로 확인 |
| 초안에 latest.json이 없음 | `release` 환경 시크릿 없음 또는 공개 키 자리표시자(빌드 로그의 "업데이터 서명" 단계) |
| 게시했는데 공개 저장소에 없음 | Actions → Publish Public 로그. `mirror` 환경의 `RELEASES_REPO_TOKEN` 없음·만료, 환경 배포 규칙이 그 태그를 막음, 또는 latest.json 주소가 공개 저장소가 아님(이 변경 전 버전) |
| 앱이 새 버전을 못 찾음 | 초안을 게시했는지, 배포 저장소(`waitscape-releases`)로 복사됐는지, 설치된 앱이 공개 키가 든 빌드인지, 설정에서 확인을 껐는지. 앱 로그(`[waitscape] 업데이트 확인 실패`) |
| "업데이트하지 못했어요" | 서명 불일치(다른 키로 서명) 또는 내려받기 실패. 키를 바꿨다면 새 설치 파일을 손으로 |

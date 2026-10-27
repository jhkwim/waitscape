# 🐹 모찌 햄찌네 (Claude 대기실)

Claude Code가 일하는 동안 보는 대시보드. 여러 세션의 진행 상황을 실시간으로 중계하고, 끝나거나 입력이 필요하면 알려준다.

## 실행
```
python3 server.py   # → http://localhost:7777
```
포트 변경: `WAITING_ROOM_PORT=8000 python3 server.py` (환경변수 목록: [`.env.example`](.env.example))
브라우저 주소는 `http://localhost:<포트>` 또는 `http://127.0.0.1:<포트>`만 받는다(Host 검사, 아래 '안전'). 빌드에는 Rust 1.88 이상이 필요하다(`Cargo.lock` 의존성 기준).

> 데스크톱 앱(Tauri 2) + 모드 플랫폼으로 옮기는 중이다. 설계: [`ARCHITECTURE.md`](ARCHITECTURE.md). 앱 이름은 **Waitscape**(최종 확인 전)이고 [`brand.json`](brand.json) 한 곳에서 정한다.

### 데스크톱 앱 (Tauri 2, `app/src-tauri`)
필요: Rust 1.90+ (CI·릴리스는 1.90.0 고정), Tauri CLI 2(`cargo install tauri-cli --version "^2" --locked`), macOS 13+ (Windows 10 1809+는 P4에서 실기 점검).
```
cd app/src-tauri
cargo tauri dev                       # 개발 실행 (beforeDevCommand가 wr-hook sidecar를 먼저 빌드)
cargo tauri build --bundles app       # → target/release/bundle/macos/Waitscape.app (ad-hoc 서명, 미공증)
cargo tauri build --debug --bundles app   # 디버그 .app (빠름)
cargo tauri build --target universal-apple-darwin   # 배포용 universal (.app·.dmg)
```
- **처음 실행하면 온보딩에서 훅을 켜요**: ① 사용 한도 조회 동의 → ② "Claude Code 훅 켜기 (추천)". 버튼을 누르면 그 자리에서 설치한다(`~/.claude/settings.json`에 우리 항목만 추가, 바꾸기 전 백업, 바뀌는 내용은 "자세히 보기"). [나중에]를 눌렀으면 설정 → AI 연결 → [훅 켜기](미리보기·확인 창)로 켠다. `~/.claude`가 없으면 안내만 한다.
  이미 쓰던 사용자는 훅이 꺼져 있을 때 한 번만 묻는다. 앱을 업데이트하면 설치된 `wr-hook`은 시작할 때 조용히 새 버전으로 바뀐다(훅을 켠 경우만, settings.json은 그대로).
- 프론트는 `web/` 그대로 쓴다(frontendDist, 빌드 단계 없음). 데이터는 백엔드가 **push**한다: 파일 감시(150ms 디바운스) + 2초 tick, 바뀐 때만 `state` 이벤트.
- 창을 닫으면 메뉴바(트레이)에 남는다. 트레이: 큰 화면 · 미니 보기(체크 = 지금 미니, 마지막에 띄운 포켓/스튜디오 미니 보기) · 모드 ▸ · 회의 모드(무음) · 🙈 눈치 모드 · 설정… · 종료. Dock 아이콘은 표시(기본).
- **큰 화면 ↔ 미니 보기는 전환**이다(둘 중 하나만 보임). 미니 보기 = 큰 창은 숨기고(닫지 않음) 항상 위 작은 창만. 작은 창의 **⤢ 크게 보기**(마우스를 올리면 보임, 닫기와 같은 동작)·트레이 "큰 화면"·설정…·모드 선택·Dock 아이콘 클릭·앱 다시 실행 → 작은 창을 숨기고(다음에 다시 씀) 큰 창 복귀. 마지막이 미니 보기였으면 다음 시작도 미니(설정 `widget`).
- 창 **우클릭 메뉴**(네이티브): 눈치 모드·미니 보기·모드·회의 모드·설정·업데이트 확인·로그 폴더·종료, 세션 위면 [cmux/Orca로 이동]·[폴더 경로 복사]. 입력란은 기본 편집 메뉴
- 완료·입력 필요·멈춤 의심 **OS 알림은 백엔드가 보낸다**(창이 닫혀도 1회. 회의 모드면 소리 없이). 메모 준비 알림만 메인 창이 보낸다.
- 🙈 **눈치 모드**(#51): 창이 앞에 있을 때 **⌘1**(윈도우 Ctrl+1)·**B**, 다른 앱을 쓰는 중에도 전역 단축키 맥 ⌃Q · 윈도우 Alt+` (설정 → 일반에서 변경, 스위치로 끄기 — 키 값은 그대로, 끄면 창 안 단축키만. macOS 15+는 Option만 쓰는 전역 단축키를 막음) · 트레이 "🙈 눈치 모드" · 창 안 **B** 키 → 평범한 업무 툴 화면 "Agent Sessions"(탭·요약·한도 막대·세션 표·최근 활동, 미니 창은 작은 목록).
  표에는 진행(컨텍스트·할 일·단계)·서브에이전트 펼치기·오늘 요약·주의 배지, [cmux로 이동]/[Orca로 이동]은 그 앱에서 연 세션만. 화면 밝기는 시스템·라이트·다크.
  창 제목·OS 알림("api-server · 작업이 끝났습니다 · 13분")도 담백하게, 효과음 없음. 데이터·세션 이동·자금 적립은 그대로, 다시 켜도 유지. 연출은 기본 블라인드만(짧게),
  설정 "퇴장·출근 연출까지"면 스튜디오 직원들이 가방 들고 엘리베이터 → 1층 현관문으로 퇴근했다가 커피 들고 출근. 전환 중 또 누르면 바로 끝, 움직임 줄이기·회의 모드면 바로
- 포켓 모드의 **위에 띄우기** = 미니 보기: 항상 위 위젯 창(무테·투명, 위치·크기 기억)만 남는다. 입력이 필요하면 저절로 펼쳐진다.
- 스튜디오 모드의 **📌 미니 보기**: 같은 위젯 창에 282×162 도트 "로비 카메라"(`widget.html#studio`). 브라우저(비앱)에서는 큰 탭을 숨길 수 없어 PiP 창이 하나 더 뜬다. 평소엔 1층 사장실, 일이 생기면 카메라가 그 층으로 가서 담고 돌아온다:
  질문 = 그 층 클로즈업 + 하단 자막(7초 넘으면 사장실과 번갈아 대기 시간 표시), 완료 = 사장실에서 보고·끄덕임(실행 10분 이상인 큰 완료만 그 층 → 옥상 폭죽 → 보고·박수), 출동(서브에이전트) = 엘리베이터를 따라 2F 회의실로(화이트보드를 팀 수만큼 나눠 할 일·✓를 적고, 끝나면 지움).
  마우스를 올리면 나오는 **🎥컷/🎥팬** 버튼으로 전환 방식을 고른다(기본 컷 = 짧은 아이리스, 출동만 따라가는 팬 / 팬 = 모든 이동을 세로로). 회의 모드·움직임 줄이기면 효과 없는 컷.
  **층 둘러보기**: 휠·트랙패드 세로 스크롤(한 번에 한 층) · 마우스를 올리면 나오는 ▲▼ · 키보드 ↑↓(Esc = 자동으로) · 상단 바 상태 점 클릭(그 직원 층) · "다음 ❓4F" 칩 클릭.
  둘러보는 동안(마지막 조작 후 10초)은 자동 카메라가 멈추고 새 질문·완료는 "다음" 칩에만 쌓이며, 층마다 이름표 아래에 동물·프로바이더·상태가 보인다. 10초 조작이 없으면 자동 카메라로 돌아가 밀린 일을 보여 준다. 창 드래그는 빈 곳을 끌면 그대로.
- 스튜디오의 **전력·날씨**: 5시간 한도 사용률 = 건물의 하루 시계. 0~49% 맑은 낮 → 50~79% 노을(창 그림자가 길어지고 아래층부터 불이 켜짐) → 80~99% 저녁 절전(조명 반만·깜빡임, 화면보호기, 자판기 꺼짐) → 100% 정전(번쩍·"퍽!", 촛불이 하나씩, 펭귄 손전등, 고양이는 눈만, 로봇 눈 조명, 사장님 당황, "리셋까지 h:mm" 표지판, 이웃 건물은 불 켜짐). 리셋 시각이 다가오면 닭이 울고, 리셋되면 해가 뜨고 아래층부터 "딸깍" 불이 켜진 뒤 다들 기지개.
  주간 한도는 날씨(60% 구름 · 80% 비 · 90% 눈, 옥상에 눈이 쌓임) — 도감 › 설정 › 효과의 **🌦️ 날씨(주간 한도)**로 켠다(기본 꺼짐). 한도 정보가 없으면(다른 프로바이더·조회를 켜지 않음) 늘 맑은 낮.
  숫자·리셋 시간은 늘 보이고, 단계는 밝기·아이콘·문구·게이지 무늬로도 구분(색맹·다크 테마). 회의 모드·움직임 줄이기면 깜빡임·흔들림 없음. 미니 보기는 지금 보이는 방에 같은 규칙이고, 하단 자막은 절전에 들어설 때·정전 동안·리셋 순간만.
- 스튜디오의 **👆 클릭 반응**: 직원(동물 7종 · 사장님)과 소품(모니터·커피·화분·책장·창문·화이트보드·벽시계·자판기·엘리베이터…)을 누르면 작게 반응한다. 같은 반응은 연속으로 안 나오고, 4번 연타하면 "일하는 중이에요!". 질문 중인 직원을 누르면 터미널로 이동.
- **cmux로 바로 이동**(앱, #37): cmux에서 연 세션이면 질문 중·일을 마친 직원, 완료 배너·로비의 완료 보고 말풍선을 누를 때 그 cmux 워크스페이스·패널로 간다(버튼·하단 자막이 "cmux로 이동").
  훅이 `CMUX_WORKSPACE_ID`·`CMUX_SURFACE_ID` **두 값만** 기록한다(토큰·소켓 비밀번호는 읽지 않음). cmux 설정에서 외부 소켓 접근을 막았거나 비밀번호를 걸었으면 경로 복사로 대신하고,
  워크스페이스가 닫혔으면 cmux만 앞으로 띄운다. Codex는 MCP 연결 때 `env_vars`에 두 이름을 더한다(원래 있던 항목은 그대로, 해제 때 더한 것만 뺌). 이미 연결해 둔 Codex는 설정 → AI 연결에 "다시 연결" 안내가 뜬다.
  cmux가 꺼져 있으면 그렇게 알려 준다. Antigravity 세션은 아직 안 됨
- **Orca로 바로 이동**(앱, #40): Orca 터미널에서 연 세션도 같은 자리를 누르면 그 Orca 터미널로 간다("Orca로 이동"). 훅이 `ORCA_TERMINAL_HANDLE`·`ORCA_WORKTREE_PATH` **두 값만** 기록한다
  (`ORCA_AGENT_HOOK_TOKEN` 같은 토큰은 읽지 않음). Orca를 다시 켜서 터미널 핸들이 바뀌었으면 그 worktree의 터미널 목록에서 다시 찾고(에이전트가 도는 창 → 최근 출력 순),
  못 찾으면 Orca만 앞으로, Orca가 꺼져 있으면 Orca를 열고, 그래도 안 되면 경로를 복사하고 이유를 알린다. Codex는 `env_vars`에 두 이름을 더 넣는다(이미 연결한 Codex는 "다시 연결").
  macOS·Windows 모두(#54): Orca 위치는 실행 중인 Orca → 설치 정보(윈도우 레지스트리·맥 Spotlight) → 기본 설치 경로 순으로 찾아, 어디에 설치했든 동작한다
- **일하는 중에도 이동**(앱): 스튜디오에서 직원의 층 이름표·단계 명패, 미니 보기의 이름표 칩을 누르면 그 세션으로 간다(Orca·cmux면 그 자리, 아니면 폴더 열기).
  마우스를 올리면 하단 캡션에 "🖥️ Orca로 이동" 등. 직원·모니터를 누르는 반응은 그대로
  숨은 **이스터에그 8개**는 도감에 🥚 n/8로 모이고(못 찾은 건 힌트만), 회의 모드·움직임 줄이기면 말풍선만, 소리는 🔊일 때만. 미니 보기에서도 같은 반응(누르는 자리를 끌면 창이 움직임).
- 스튜디오의 **📋 퇴근 일보**: 오후에 다들 45분쯤 조용해지면 사장님이 종이를 흔들며 "일보 나왔어요!" — 누르면 위층부터 불이 꺼지고 1층 발표판에서 완료 → 작업 시간 → MVP 순으로 발표한 뒤 공유 카드가 나온다.
  HUD **🏃 퇴근**은 "다들 1층으로 모여~!"부터 바로, **📋 일보**는 지금까지 카드만. 카드: 💾 이미지 저장(2배 PNG) · 🙈 프로젝트 이름 숨김 · 📋 텍스트 복사. 다음 날 아침엔 "☀️ 어제 일보", 미니 보기는 알림 한 줄.
- 설정(쉼표 키 · 트레이 설정…): **훅** 켜기/끄기(앱에 든 `wr-hook`을 `~/.claude/waiting-room/bin/`에 복사하고 `~/.claude/settings.json`을
  백업한 뒤 우리 항목만 병합 — 네이티브 확인 창), **사용 한도** 조회 동의(기본 꺼짐)·[키체인에서 읽기](맥), 언어, 자동 시작(기본 꺼짐),
  **세션 표시**(활성 세션만·시간·숨길 프로젝트, 아래 '세션 숨김'), 터미널 앱(업무 모드 '터미널 열기' = 세션 폴더에서 Terminal/iTerm/VS Code/cmux 등 열기, 기본값이면 cmux·Orca 세션은 그 패널·터미널로, 안 되면 경로 복사), 모드 설치(폴더·zip·끌어다 놓기)·삭제·켜기/순서, **업데이트**(새 버전 확인 켜기·끄기, 지금 확인).
- 앱 설정·사용자 모드: `~/Library/Application Support/io.github.jhkwim.waitscape/{settings.json,modes/}` (Windows `%APPDATA%\io.github.jhkwim.waitscape\`).
- 진단 로그: `~/Library/Logs/io.github.jhkwim.waitscape/waitscape.log` (Windows `%LOCALAPPDATA%\io.github.jhkwim.waitscape\logs\`, 1MB면 `waitscape.old.log`로 한 번 돌림). 설정 → 일반 → 앱 정보 → [로그 폴더 열기]. 토큰·프롬프트 내용은 남기지 않고 홈 경로는 `~`로 줄인다
  경로 환경변수(`CLAUDE_CONFIG_DIR`, `WAITING_ROOM_*`)는 wr-server와 같다 — 시험할 때 임시 폴더를 주면 실제 `~/.claude`를 건드리지 않는다.
- 앱 아이콘: ☕ 커피잔 햄찌 — 매끈한 머그·배경 + 도트 햄찌(하이브리드). 원본은 `app/src-tauri/icons/src/app-icon/`(배경 SVG·햄찌 도트, 작은 크기는 별도 손도트), 결과 PNG/icns/ico는 커밋됨. 트레이 아이콘 다시 만들기: `sh scripts/make_icons.sh` (rsvg-convert 필요)
- 미서명 앱 첫 실행: "확인되지 않은 개발자" → 시스템 설정 → 개인정보 보호 및 보안 → '그래도 열기'. Windows는 SmartScreen '추가 정보 → 실행'. 자세한 안내·체크섬 확인·제거: [`docs/INSTALL.md`](docs/INSTALL.md)

설치·업데이트(사용자):
- 설치: [Releases](https://github.com/jhkwim/waitscape-releases/releases/latest)(배포 전용 공개 저장소)에서 `.dmg`(맥) 또는 `.exe`·`.msi`(윈도우). 안내: [`docs/INSTALL.md`](docs/INSTALL.md)
- **업데이트**: 앱이 시작할 때 + 하루 1번 새 버전을 확인한다(배포 전용 공개 저장소 `jhkwim/waitscape-releases`의 `latest.json`만 읽음). 새 버전이면 OS 알림 "새 버전 나왔어요!" + 트레이 **🎁 업데이트 있음** + 창 배너(스튜디오 모드는 사장님 말풍선). 눌러서 **[지금 업데이트하고 다시 시작]**을 고를 때만 내려받아 서명(minisign)을 확인하고 설치한다 — 몰래 설치하지 않는다. 설정 → 일반 → 업데이트에서 확인을 끄거나 [지금 확인]
- 설치 파일·`latest.json`의 공식 위치는 배포 전용 공개 저장소 [`jhkwim/waitscape-releases`](https://github.com/jhkwim/waitscape-releases/releases)다(이 코드 저장소에는 설치 파일을 올리지 않는다. 앱의 업데이터도 거기만 본다): [`docs/RELEASE.md`](docs/RELEASE.md) §6. 업데이터 공개 키가 없는 옛 빌드는 새 설치 파일을 한 번 받아 덮어 설치한다(설정·모드는 그대로).

릴리스(관리자, 자세히: [`docs/RELEASE.md`](docs/RELEASE.md)):
- **Actions → Release Prep → Run workflow**(버전 `0.2.0` 또는 `major`/`minor`/`patch`) → `scripts/version.py bump`가 버전(원본 `Cargo.toml` → `tauri.conf.json`·`Cargo.lock`)과 `CHANGELOG.md`를 올린 PR을 만든다 → 병합하면 태그 `vX.Y.Z` + `release.yml`이 macOS universal(`.dmg`·`.app.zip`)·Windows x64(NSIS `.exe`·`.msi`)를 빌드해 `SHA256SUMS.txt`와 함께 **초안(draft) 릴리스** → 확인 후 직접 게시.
- 업데이터 서명 시크릿(`TAURI_SIGNING_PRIVATE_KEY`)이 있으면 `.app.tar.gz`·`.sig`·`latest.json`도 올라간다. 초안을 게시하면 `publish-public.yml`이 공개 저장소로 복사한다(시크릿 `RELEASES_REPO_TOKEN`). 없으면 그 부분만 건너뛴다. Apple 서명·공증도 시크릿(`APPLE_CERTIFICATE` 등)이 있을 때만(없으면 미서명, 맥은 ad-hoc).
- 직접 태그 `vX.Y.Z`를 push해도 같은 빌드가 돈다. 수동 실행(Actions → Release)은 기본으로 아티팩트만 만든다(`publish=false`, 14일 보관).
- 버전을 손으로 바꾸지 말고 `python3 scripts/version.py bump <버전> [--dry-run]`. 일치 검사: `python3 scripts/version.py check`(CI·`build.rs`도 검사).
- 빌드 플레이버: `cargo tauri build --no-default-features`(또는 `--features updater` 등) — 업데이터·터미널 이동을 뺀 빌드(나중 Mac App Store용 구조). 기본은 둘 다 켜짐.

개발(모드 만들기): `python3 server.py` + `bun tools/dev.ts` → http://localhost:7780 (파일을 저장하면 자동 새로고침. [`MODES.md`](MODES.md) §10)

Rust 백엔드(P1, server.py와 같은 엔드포인트·환경변수):
```
cargo run --release -p wr-server            # → http://localhost:7777 (WAITING_ROOM_PORT / --port로 변경)
cargo build --release -p wr-hook            # 훅 바이너리 (따로 빌드해야 작게 나옴: 워크스페이스 전체 빌드는 regex 기능이 합쳐져 커짐)
```
`wr-server`는 기본으로 훅 + 트랜스크립트를 세션별로 병합한다(`WAITING_ROOM_SOURCE=auto|hooks|transcript`). 훅이 없어도 세션이 보인다.

## 세션 숨김 (기본은 활성 세션만)
- **플러그인 내부 세션 기본 숨김**: claude-mem 관찰자(`~/.claude-mem/observer-sessions`)처럼 플러그인이 계속 만드는 세션은 목록에 나오지 않고,
  해당 프로젝트 폴더의 트랜스크립트는 **읽지도 않는다**(수천 개여도 비용 없음). 기본 목록은 `crates/wr-core/src/hide.rs`의 `DEFAULT_HIDE`(웹 `core-lib.js`, `server.py`에도 같은 목록).
- **숨길 프로젝트**: 설정 → 일반 → 세션 표시에서 한 줄에 하나씩(경로·이름의 일부, 대소문자 무시, 영숫자 아닌 글자는 `-`로 같게 봄). 앱은 `settings.json`에 저장하고 백엔드가 스캔을 건너뛴다. 브라우저 버전은 이 브라우저에만 저장(화면에서만 거름).
  서버 쪽 환경변수: `WAITING_ROOM_HIDE`(쉼표 구분), `WAITING_ROOM_HIDE_DEFAULTS=0`(기본 목록 끄기)
- **활성 세션만 보기**(기본 켜짐): 작업 중·입력 필요·멈춤 의심·서브에이전트 실행 중 + 끝난 지 30분 이내. 나머지는 모드 전환기 옆의 **+N개 숨김**을 눌러 펼친다.
  설정에서 시간(1~1440분)을 바꾸거나 끌 수 있다. 모든 모드에 공통(코어가 거른 state를 모드에 준다; `state.hidden = { n, project }`)
- 📋 퇴근 일보: 서버·앱이 상태를 만들 때마다 턴 완료·질문 대기·세션 활동·사용 한도 표본을 하루치 일지에 쌓는다.
  하루 = 새벽 4시 경계, 일지 = `~/.claude/waiting-room/daylog/<YYYY-MM-DD>.json`(14일 보존, 외부 전송 없음, `WAITING_ROOM_DAYLOG`로 폴더 변경·`off`로 끔).
  오후에 마지막 활동 뒤 45분 동안 모든 세션이 조용하면 그날 일보가 "준비됨"(다시 활동하면 풀리고 갱신), 못 본 일보는 다음 날 `prev.unseen`으로. API는 아래 `/daylog`
  화면(🏢 스튜디오): 준비되면 사장님이 종이를 들고 "일보 나왔어요!"(화면을 가로채지 않음) → 누르면 1층 발표 연출 → 공유 카드(PNG 저장·이름 숨김·텍스트 복사).
  HUD 🏃 퇴근(바로 연출) · 📋 일보(지금까지), 고급 옵션 퇴근 시각, 다음 날 "☀️ 어제 일보", 미니 보기 알림 한 줄. 자세한 규칙은 MODES.md 「퇴근 일보」
- 테스트: `python3 scripts/test_limits_merge.py`, `python3 scripts/test_stale_agents.py`, `python3 scripts/test_daylog.py`, `node scripts/test_core_hide.js`, `node scripts/test_nunchi.js`, `cargo test --workspace`, `sh scripts/rust_parity.sh`

## 구조
- `hook.py` — Claude Code hook. 이벤트를 요약해 `~/.claude/waiting-room/events.jsonl`에 추가
- `server.py` — 로그를 세션별 상태로 집계해 `/state`로 제공 (stdlib only, 127.0.0.1 바인딩). 흐름 모드 전용 `/trace`,
  퇴근 일보 `/daylog`, 모드 목록 `/modes`, 외부 모드 샌드박스 `/_modes/<id>/…`·`/_sdk/…`도 제공 (아래 'API')
- `daylog.py` — 퇴근 일보용 하루치 일지(4시 경계 하루 파일, flock 원자적 쓰기, 14일 보존)와 카드용 집계. server.py가 상태를 만들 때 기록
- `mcp_report.py` — MCP 보고(waitscape_status·waitscape_board) 정화·접기 규칙 (Rust `wr-core/src/report.rs`와 같음) + 멀티플렉서 이동 정보 어댑터 표(`MUX`, Rust `term.rs`와 같음). hook.py·server.py가 씀
- 화면 = **공통 코어 + 모드 패키지** (Mode API v1. 켜진 모드만 불러오고 실행. 작성법은 [`MODES.md`](MODES.md))
  ```
  web/                      프론트 정적 루트 (빌드 없음. 앱(Tauri)의 frontendDist가 될 폴더)
    index.html              얇은 셸: core/*.js만 로드. 제목(앱 이름)은 brand.json에서
    widget.html             (앱 전용) 위젯 창 셸 — 코어가 widget.html#<모드>(포켓·스튜디오, mode.json "widget": true)를 '떨어진 창' 모양으로만 올림
    fonts/                  번들 폰트(Galmuri11 Regular·Bold woff2, SIL OFL 1.1 — 라이선스 `OFL.txt`). 햄찌·스튜디오(미니 보기·퇴근 일보 카드) 모드가 `@font-face`로 로컬 로딩(외부 요청 없음)
    core/
      i18n.js               코어·설정 화면·알림 문구 ko/en (언어: 설정 → 자동이면 OS/브라우저 언어)
      core-lib.js           순수 함수(포맷·세션·사용 한도·프로바이더·API 버전 판정). 샌드박스 SDK와 공유
      api.js                Core.api 데이터 계층: http(/state 1초 폴링·/trace·/modes) / tauri(invoke·listen push, 설정·훅·모드 설치·위젯·터미널)
      nunchi.js|css         🙈 눈치 모드: 업무 툴 화면 "Agent Sessions"·위젯 작은 목록·도트 블라인드(빼꼼 고양이)·구석 고양이. 모드 훅 nunchi()/nunchiOrder()로 긴 연출(스튜디오)
      core.js               state 수신·시계 보정, 완료/입력 필요/멈춤 의심 감지 → 소리·알림 1회 + 이벤트 버스, 회의 모드·언어·알림 설정,
                            메모(memo:<세션ID>), 모드 발견·검증(mode.json·apiVersion)·켜기/순서·전환·지연 로딩, 개발 모드 자동 새로고침
      bridge-host.js        외부 모드 샌드박스 iframe + postMessage 브리지(권한 확인·state 정제·rate limit). 외부 모드를 켤 때만 로드
      manager.js|css        설정 화면(Shadow DOM): 모드 목록·켜기/끄기·순서·설치/삭제 안내·권한 경고, 언어, 회의 모드, 알림, 사용 한도 동의, 개발
      core.css              리셋, 모드 전환기 기본 모양, 회의 모드, 외부 모드 iframe·토스트·프로바이더 배지
    sdk/
      mode-sdk.js           샌드박스 iframe 안의 Core/ctx (외부 모드용)
      sandbox.css           샌드박스 기본 스타일
    modes/
      index.json            내장 모드 목록·기본 순서
      <id>/mode.json        모드 패키지: 매니페스트(이름 ko/en·아이콘·버전·apiVersion·권한) + mode.js + mode.css
      hamster/              🐹 햄찌 모드: 세션마다 햄찌 한 마리(도구별 모션·말풍선, 콕 찌르기), 아기 햄찌, 연주회, 칭호,
                            리플레이, 색종이, 오늘의 햄찌 카드, 스트레칭 제안
      work/                 💼 업무 모드: KPI 행 + 사용 한도 + 세션 테이블
      pocket/               📌 포켓: 3단계 크기 위젯, Document PiP로 다른 앱 위에 띄우기 (앱에서는 항상 위 위젯 창)
      board/                🏟️ 전광판: 스포츠 중계 LED 전광판(팀 레인·문자중계·속보 티커·MVP)
      orbit/                🪐 궤도: 한도 태양 + 세션 행성/서브에이전트 달 앰비언트 화면
      flow/                 🌊 흐름: Claude의 생각 흐름. 한 요청을 '생각의 강'(메인 강 + 서브에이전트 지류, 단계 색, 도구 점,
                            발화 말풍선, 실패 소용돌이, 조용히 생각)으로, 구간을 누르면 탐험 지도(다녀간 파일·명령), 돌아보기(마인드맵)
      studio/               🏢 스튜디오(기본): 세션마다 한 층, 도트 동물 직원 7종(세션 ID 해시) + ✨반짝이, 프로바이더 소품, 도구별 코드 조각·타자 소리,
                            서브에이전트 = 아기 동물 회의(회의실 화이트보드: desc 한 줄씩 적고 ✓ → 다 끝나면 지우기, 🤫 문구 숨김 설정), 입력 필요 = 엘리베이터로 1층 사장실 방문(질문 문구·터미널로 이동), 완료(10분 이상이면 큰 완료)·번아웃 연출,
                            자금(잘 쓰기 재화)·평판·직원 도감·상점(보기용)·🎨 층 꾸미기(프로젝트별 소품·동물 취향)·오늘의 성과, 👆 클릭 반응·이스터에그 8개(도감 🥚 n/8). 저장은 ctx.store만
                            📋 퇴근 일보(Core.api.daylog): 사장님 종이 알림 → 1층 발표 연출 → 공유 카드(canvas, PNG 저장·이름 숨김·텍스트 복사), 🏃 퇴근·📋 일보 버튼
                            한도 = 건물 전력·날씨: 5시간 한도 사용률이 하루 시계(0~49% 낮 · 50~79% 노을 · 80~99% 절전 · 100% 정전(촛불·손전등) ·
                            리셋 = 닭 울음·해 뜸·아래층부터 불 켜짐), 주간 한도 = 날씨(구름·비·눈, 도감 설정에서 켬, 기본 꺼짐). 큰 화면·미니 보기 둘 다
                            작은 창(앱 위젯·브라우저 PiP)에서는 "미니 보기": 282×162 로비 카메라(옥상·직원 층·2F 회의실·1F 사장실을 세로로 쌓고
                            이벤트 때 그 방으로 이동, 우선순위 질문>완료>출동) + 상단 바(한도·상태 도트·대기) + 하단 자막. 전환 컷/팬은 ctx.store "lobbyCam", 회의 모드면 정적.
                            휠·▲▼·↑↓·상태 점·다음 칩으로 직접 층 둘러보기(10초 조작 없으면 자동 카메라로)
      _template/            외부 모드 최소 예제(스타터: 세션 표 + 타이머 + 메모 + trace). 복사해서 사용자 모드 폴더에
  tools/dev.ts              Bun 개발 서버: 백엔드 프록시 + 파일 감시 → 저장하면 자동 새로고침 (bun tools/dev.ts → :7780)
  MODES.md                  Mode API v1 가이드 (패키지 형식, mode.json, ctx 권한 표, 프로바이더, 샌드박스, 체크리스트)
  ```
  사용자(외부) 모드 폴더: `~/.claude/waiting-room/modes/<id>/` (`WAITING_ROOM_MODES`로 변경). 새로 찾은 모드는 꺼진 채로 나타나고,
  설정에서 "직접 만들지 않은 모드" 경고와 권한을 확인한 뒤 켠다. 샌드박스에서 실행된다.
- Rust 백엔드 (Cargo 워크스페이스: crates/* + 데스크톱 앱 app/src-tauri)
  ```
  Cargo.toml                워크스페이스 (members = crates/*, app/src-tauri, 공통 의존성·릴리스 프로필)
  rustfmt.toml              cargo fmt 설정 (줄 폭 140)
  crates/
    wr-core/                라이브러리: server.py 이식 + 프로바이더 구조 (첫 구현 = Claude Code)
      src/engine.rs           Engine: 프로바이더를 묶어 state()/trace() — 시계·시간대·홈 주입, 바뀐 때만 push(state_if_changed), 감시 경로
      src/provider.rs         Provider 트레이트(세션 발견·증분 읽기·정규화·기능 플래그) + Ctx·Snapshot·TraceQuery·Polled
      src/model.rs            공통 모델 = types/state.d.ts (Session·Agent·Tokens·Health·State·ProviderInfo), 마스킹
      src/redact.rs, text.rs  마스킹 정규식·clip() (마스킹 → 경로 축약 → 절단)
      src/health.rs           멈춤 판정 틀 (SLOW/STALL, TOOL_SLOW/TOOL_STALL)
      src/trace.rs            흐름 단계 모델, phase 다수결 보정·claim, 600단계 제한·older 요약, since 커서
      src/limits.rs           사용 한도 공통: 120초 주기·429 지수 백오프·Retry-After, 토큰 래퍼(메모리에만, Debug=***)
      src/daylog.rs           퇴근 일보 일지 = daylog.py 이식(같은 파일 형식·규칙): 프로바이더 전이 피드 기록, 하루 집계, seen, 보존 정리
      src/modes.rs            모드 패키지 발견·서빙 규칙(/modes, /_modes, CSP) — wr-server와 앱(wrmode:)이 공유
      src/hooks_config.rs     Claude settings.json 훅 설치·제거: 우리 항목만 식별, 백업 + mtime 재확인 + 원자적 쓰기, 멱등
      src/report.rs           MCP 보고 입력 정화(제어·양방향·제로폭 문자 제거 → 마스킹 → 문자 수 절단)·검증·접기 — wr-hook 사이드카·훅 분기와 공유
      src/term.rs             멀티플렉서 이동 정보(#37·#40): 어댑터 표(Orca·cmux) — 허용 목록 env만 읽기·ID 형식 검증·읽을 때 재검증. wr-hook과 공유
      src/mcp_config.rs       MCP 보고 연결의 순수 변환: `claude mcp add` 인자, 권한 규칙(도구 2개만·넣은 것만 되돌리기), mcpServers 항목(Antigravity)
      src/binswap.rs          실행 파일 교체(Windows: 실행 중인 wr-hook.exe를 비켜 놓기) — 앱이 쓰고 Windows CI에서 테스트
      src/clock.rs, paths.rs, jsonl.rs, py.rs   시계·시간대, 홈·CLAUDE_CONFIG_DIR, JSONL 증분 읽기, 파이썬 호환 문자열 도우미
      src/providers/claude/   Claude 전용: config(환경변수) · hooks(events.jsonl 상태 기계, 유령 에이전트 필터 · Stop 누락 에이전트 6시간 후 정리) · scan(토큰·발화) ·
                              tonly(훅 없는 트랜스크립트 전용 판정) · trace(흐름 단계) · describe(도구 요약, wr-hook과 공유) · usage(oauth usage API)
      src/providers/mcp.rs    MCP 보고 리더: reports.jsonl 증분 읽기·key별 상태·pid 생존 확인·1MB 회전 → Codex·Antigravity 등 세션(source "mcp"),
                              Claude 사이드카 보고는 엔진이 같은 cwd의 활성 세션 하나에만 붙임
      examples/snapshot.rs    Rust 스냅샷 러너 (cases.json·고정 시계 → fixtures/expected와 같은 형식)
      examples/bench.rs       실제 트랜스크립트 성능 측정 (읽기 전용)
      tests/parity.rs         동등성 23/23(일지 8 포함) · 트랜스크립트 전용 24/24 · Auto 병합 (cargo test)
      tests/daylog.rs         일지 수집 경로(트랜스크립트 전용 세션의 턴·질문 대기, 끈 엔진은 쓰지 않음)
      tests/review_fixes.rs   교차 리뷰 회귀(오늘 집계·STALE·세션 재개·탐색 시계)
      tests/mcp_orphans.rs    훅이 동작 중이면 Claude 사이드카 보고를 붙이지 않음(같은 폴더 두 창·비운 보드·서브에이전트 보드)
    wr-hook/                훅 CLI (hook.py 동등 + 절단 전 마스킹). 절대 실패하지 않음(exit 0), 의존성 serde_json·regex
      src/mcp.rs              `wr-hook mcp` = MCP stdio 서버(보고 사이드카): 도구 2개 → reports.jsonl append. 네트워크 없음 (아래 'MCP 보고')
      tests/mcp_script.rs     실제 바이너리로 JSON-RPC 대본(핸드셰이크·오류표·stdout 위생·줄 경계·경로 우선순위·동시 append)
    wr-server/              브라우저용 127.0.0.1 HTTP (server.py와 같은 엔드포인트·Host 검사·정적 규칙, tiny_http). tests/http.rs
  app/src-tauri/            데스크톱 앱 (Tauri 2, 크레이트 waitscape)
    tauri.conf.json           frontendDist=../../web, 앱 CSP, externalBin(wr-hook sidecar), 번들 설정 (이름·식별자는 brand.json과 build.rs가 일치 검사)
    capabilities/             main.json(메인 창) · widget.json(위젯: 읽기·회의 모드·자기 창만) — 외부 모드 iframe/원격 URL 권한 없음
    build.rs                  brand 검사, 버전 검사(tauri.conf.json = Cargo workspace), sidecar 자리표시, 앱 명령 권한 목록(AppManifest)
    icons/                    앱 아이콘(원본 icons/src/app-icon/: 배경 SVG + 햄찌 도트) · 트레이 아이콘(icons/src/tray*.svg → scripts/make_icons.sh)
    src/lib.rs                플러그인(single-instance·notification·dialog·autostart·updater·global-shortcut), wrmode: 프로토콜, 실행 루프
    src/applog.rs             진단 파일 로그 `wlog!`(stderr + 앱 로그 폴더 waitscape.log, 1MB 회전, 시크릿 마스킹·홈 `~`) · 시작 줄(버전·OS·WebView) · 멈춤 감시(5초)
    src/updater.rs            앱 안 업데이트(feature `updater`): 시작 + 하루 1번 latest.json 확인 → 알림·트레이·`update` 이벤트, 누를 때만 내려받기·서명 검증·설치·재시작
    src/backend.rs            Engine(Mutex) + 파일 감시·2초 tick push + 전이 감지 → OS 알림 + 사용 한도 폴링 스레드
    src/commands.rs           Core.api tauri 명령 (get_state·get_trace·get_daylog·daylog_seen·save_image(일보 카드 PNG 저장 대화상자)·settings·list_modes·위젯·트레이·훅·mcp_status/plan/apply(MCP 연결, 메인 창 전용)·한도·모드 설치·터미널·app_info·open_log_dir·update_*)
    src/detect.rs             완료/입력 필요/멈춤 의심 전이 → 알림 문구 (ko/en)
    src/tray.rs, windows.rs   트레이 메뉴·메뉴바 요약 / 메인·위젯 창(큰 화면 ↔ 미니 보기 전환 `View`·`to_big`·`to_mini`), 내비게이션 정책(앱·wrmode 문서만), 새 창 거부
    src/ctxmenu.rs            창 우클릭 메뉴(네이티브): 항목 구성 순수 함수 spec(테스트) + popup_menu, 선택 처리는 트레이와 공유
    src/nunchi.rs             🙈 눈치 모드: 전역 단축키(tauri-plugin-global-shortcut, Rust에서만 등록·실패 상태 `nunchi_status`)·창 제목 Agent Sessions
    src/winpos.rs             창 위치·크기 저장/복원(논리 좌표, 설정 폴더 window-pos.json): main 위치·크기, widget 위치만, 화면 밖·엉망인 값은 기본 모니터로
    src/protocol.rs           wrmode://localhost/_sdk/·/_modes/<id>/ 서빙 + CSP·Permissions-Policy
    src/mode_install.rs       폴더·zip 설치(스테이징·zip-slip·링크·확장자·20MB/500개 제한·SHA-256 기록), 삭제
    src/hooks.rs, settings.rs, terminal.rs   훅 sidecar 복사·설치 / 앱 settings.json / 세션 cwd에서 터미널 열기·멀티플렉서(cmux 패널·Orca 터미널)로 이동(인자 배열·타임아웃, feature `terminal-jump`)
    src/orca_find.rs          Orca 앱·CLI 찾기(#54, 맥·윈도우): 실행 중 프로세스 → 레지스트리·Spotlight → 고정 후보, 설치 폴더 안인지 검증, 찾은 경로·실패 이유 로그
    src/mcp_connect.rs        MCP 보고 연결·해제(Claude Code CLI·Codex config.toml(toml_edit)·Antigravity mcp_config.json): 미리보기·백업·원자적 쓰기·연결 기록(바이트 동일 해제)
    src/e2e.rs                디버그 빌드 전용 E2E 드라이버(WAITSCAPE_E2E_DIR). 릴리스에는 컴파일되지 않음
  ```
- 설계·계약·검증
  ```
  ARCHITECTURE.md     데스크톱 앱(Tauri 2) + 모드 플랫폼 v1 설계 (Rust 이식, 프로바이더 플랫폼, 샌드박스, 배포, 단계별 계획)
  types/state.d.ts    GET /state 응답 공식 타입 = Mode API v1 공개 계약 (필드 의미·단위·nullable, stable/@unstable, 프로바이더)
  types/trace.d.ts    GET /trace 응답 공식 타입
  types/daylog.d.ts   GET /daylog 응답(퇴근 일보 하루 집계)·POST /daylog/seen 타입 (@since 1.1, 코어 전용)
  types/ctx.d.ts      모드가 받는 ctx·Core 순수 함수·mode.json·Core.api·샌드박스 브리지 메시지 타입, API 버전 정책
  types/mode.schema.json  mode.json JSON Schema
  types/CHANGELOG.md  Mode API 변경 내역
  fixtures/           합성 테스트 데이터 (실제 트랜스크립트·개인 경로 없음, 가짜 시크릿은 자리표시자로만)
    fixture.json        기준 시각(now)·시간대·홈 고정값
    make_fixtures.py    input/과 transcript-only/input/ 생성기 (결정적)
    cases.json          기준 결과 시나리오 (state/trace/daylog 호출·파일 덧붙이기·자르기 순서)
    fake_secrets.json   마스킹 검증용 가짜 시크릿 조각 (실행 시 이어 붙임)
    input/              훅 이벤트 + 트랜스크립트 + MCP 보고(reports.jsonl) 입력
    mcp/                MCP 보고 공유 골든: sanitize.json(정화 규칙, Rust·Python 같은 결과), hook_cases.json(hook.py ↔ wr-hook 훅 줄)
    expected/           Python 서버의 기준 결과 (Rust 구현과 동등성 비교용)
    transcript-only/    훅 없이 트랜스크립트만으로 상태를 정하는 규칙(RULES.md)·입력·손으로 쓴 기대값(expected.json)
  scripts/
    snapshot.py         server.py를 import해 시계를 고정하고 cases.json대로 기준 결과 생성 (--check: 비교만)
    compare.py          기준 결과 ↔ 다른 구현 결과를 정규화 비교 (--ignore k1,k2: 1.1 추가 필드 무시)
    check_transcript_only.py  트랜스크립트 전용 엔진 결과를 기대값과 부분 비교
    rust_parity.sh      Rust 러너 실행 → compare.py(23/23) + check_transcript_only.py(24/24) 한 번에
    test_daylog.py      일지 회귀: 4시 경계·자동 퇴근(오후·45분)·재활동 갱신·어제 seen·보존 정리·여러 프로세스 동시 쓰기·HTTP(CSRF 규칙)
    test_mcp_reports.py MCP 보고 회귀: 정화 규칙 fixture·hook.py 훅 골든·server.py reports.jsonl 리더(줄 경계·파일 교체·pid·off)·오늘 집계/일지 피드·멀티플렉서 이동 정보(fixtures/mux)
    build_sidecar.sh    wr-hook을 따로 빌드해 app/src-tauri/binaries/wr-hook-<triple>로 복사 (cargo tauri dev/build가 자동 실행)
    make_icons.sh       앱·트레이 아이콘 생성 (SVG → PNG/icns/ico)
    selftest_transcript_only.py  위 검사기·기대값 자체 점검 (엔진이 생기는 P1 전까지 CI에서)
    check_secrets.py    커밋된 파일의 실제 형태 시크릿(AKIA·ghp_·xox·sk-ant)·개인 경로 검사 (--leak: 기준 결과 마스킹 유출)
    validate_modes.py   web/modes/*/mode.json을 types/mode.schema.json으로 검증 (jsonschema 필요)
    selftest_check_secrets.py  check_secrets.py 탐지 패턴 회귀 테스트 (점·하이픈 사용자명 경로, 대시 인코딩 홈 경로, 비ASCII 인접 시크릿)
    check_commit_emails.py  커밋 작성자·커미터 이메일이 차단 도메인이면 실패 (환경변수 BLOCKED_EMAIL_DOMAINS, CI에선 저장소 시크릿)
    version.py          앱 버전 한 곳 관리: show / check [--tag] / bump X.Y.Z|major|minor|patch [--dry-run] / notes (CHANGELOG 절)
    make_latest_json.py 업데이터 매니페스트 latest.json 생성 (서명 .sig가 있을 때만, release.yml)
    test_release_scripts.py  위 두 스크립트 회귀 테스트 (가짜 저장소, CI)
  .github/
    workflows/ci.yml    PR·main push: Python·스키마·시크릿·커밋 작성자 검사
    workflows/rust.yml  Rust 관련 파일이 바뀐 PR·main push에서만: Linux 전체 fmt·clippy·test·동등성, Windows는 코어 크레이트 테스트
    workflows/release-prep.yml  수동 실행(버전 입력) → 버전·CHANGELOG PR / 그 PR 병합 → 태그 vX.Y.Z + release.yml 실행 (Linux 1개)
    workflows/publish-public.yml  릴리스 게시 → 배포 전용 공개 저장소(jhkwim/waitscape-releases)에 같은 태그로 복사 (mirror 환경의 RELEASES_REPO_TOKEN 있을 때)
    workflows/release.yml  태그 v*·수동 실행(태그·main만, release 환경): macOS universal .dmg·.app, Windows NSIS·MSI(미서명) + SHA256SUMS (+ 업데이터 서명·latest.json, 시크릿 있을 때) → 초안 릴리스
    ISSUE_TEMPLATE/     버그·기능·모드 제출·프로바이더 요청 (한/영)
    dependabot.yml      의존성 업데이트 PR: GitHub Actions·Cargo 주 1회, 종류별 최대 5개
    PULL_REQUEST_TEMPLATE.md
    review/     (메인테이너 전용·선택) AI 교차 리뷰(Gemini) 프롬프트·프로젝트 요약·영역별 체크리스트·실행기(run_review.sh — PR 크기·민감도로 Flash/Argon 자동 선택, 규칙은 TRIAGE §5)·판정 규칙(TRIAGE)·보정 기록(CALIBRATION)·지표(metrics)
  docs/INSTALL.md     미서명 설치 안내(Gatekeeper·SmartScreen)·체크섬 확인·훅은 선택·업데이트·제거 방법 (한/영)
  docs/RELEASE.md     릴리스 흐름(버튼 → PR → 태그 → 빌드 → 앱 알림), 업데이터 서명 키 만들기·배포 환경(release·mirror) 시크릿 등록, 배포 전용 공개 저장소, 빌드 플레이버·스토어 계획
  CHANGELOG.md        앱 변경 내역 (릴리스 때 scripts/version.py가 [Unreleased]를 새 버전 절로)
  CONTRIBUTING.md     개발 환경·브랜치/커밋 규칙·이슈→PR·모드/프로바이더 기여·AI 사용 공개
  SECURITY.md         취약점 비공개 신고 (GitHub Security Advisories)
  CODE_OF_CONDUCT.md  Contributor Covenant 2.1
  brand.json          앱 이름(Waitscape, 최종 확인 전)·식별자 — 이름은 여기서만 읽는다
  .env.example        server.py·wr-server·데스크톱 앱·개발 서버 환경변수 목록
  LICENSE             MIT
  ```
  모드 전환: 각 모드 화면의 전환기(드롭다운), 숫자 **1~9**(켜진 모드 순서. 기본 1 햄찌 · 2 업무 · 3 포켓 · 4 전광판 · 5 궤도 · 6 흐름 · 7 스튜디오),
  **B**·**⌘1**(윈도우 Ctrl+1) = 🙈 눈치 모드 켜고 끄기(예전 업무 모드 전환을 대체), **⌘2**(Ctrl+2) = 미니 보기 ↔ 큰 화면(앱), **,**·**⌘,** = 설정, URL `/#<id>`(`/#daily` = 햄찌 모드 + 오늘의 햄찌 카드). 선택은 localStorage `mode`에 기억

## API
응답의 공식 타입은 [`types/state.d.ts`](types/state.d.ts), [`types/trace.d.ts`](types/trace.d.ts), 모드 쪽은 [`types/ctx.d.ts`](types/ctx.d.ts) (Mode API v1).
- `GET /state` — 모든 모드가 쓰는 세션 상태 (코어의 `Core.api`가 1초마다 폴링). 프롬프트·발화·도구 설명·알림·할 일·에이전트 설명은 `/trace`와 같은 규칙으로 마스킹
- `GET /trace?session=<세션ID>&prompt=<번호|last>&since=<커서>` — 🌊 흐름 모드 전용. **흐름 모드가 켜져 있을 때만** 2초마다 호출되고
  (탭이 숨겨지면 멈춤) 다른 모드에선 호출 0회·서버 비용 0.
  - 세션 트랜스크립트와 `subagents/agent-<id>.jsonl`을 줄 단위로 이어 읽어 캐시(새로 붙은 줄만 파싱). `since`에 이전 응답의 `cursor`를
    주면 새로 생기거나 바뀐 단계만 돌려줌(`full: false`)
  - 응답: `{ session, project, now, prompts:[{i,t,text}], prompt:{i,t,text,last,t_next}, cursor, full, total,
    lanes:[{id:"main"|agentId, desc, type, t_start, t_end, t_join, status:"running|waiting|done", fail}],
    steps:[{lane, s, t, kind:"tool|say|think|notify", tool, target, cmd, files[], writes, act, ok, err, dur_ms, phase, claim, text}],
    older:{cut, bins:[{lane,t,n,fail,phase}]}|null }`
  - `phase` = 이해·탐색·계획·수정·검증·위임·보고(서버에서 판정 후 앞뒤 5단계 다수결 보정), `claim` = 발화의 결정·확인·가설·결론(문구 휴리스틱)
  - 안전: 세션 ID는 `[A-Za-z0-9_-]` 형식만 허용(아니면 400), 트랜스크립트는 `~/.claude/projects/*/<ID>.jsonl`에서만 찾음.
    모든 텍스트는 민감 정보 마스킹(`sk-ant-`, `ghp_`, `AKIA`, `xox?-`, `Bearer …`, `password=`·`token=`·`api_key=` 류 값 → `<REDACTED>`) 후 160자 절단.
    한 응답은 최근 600단계까지, 그 앞은 레인·분 단위 요약(`older`)
- `GET /daylog?day=today|yesterday|YYYY-MM-DD` — 퇴근 일보 하루 집계(공식 타입 [`types/daylog.d.ts`](types/daylog.d.ts)). 하루 = 현지 새벽 4시 경계.
  상태를 한 번 만들어 일지를 최신으로 한 뒤 돌려준다. 날짜는 보존 기간(14일) 안·오늘 이전만(아니면 400 `bad-day`), 일지를 끄면 404 `off`
  - 응답(요약): `{ day, today, start, end, done, work, big:[{sid,provider,project,job,run,t}], big_count, wait:{avg,n},
    workers:[{sid,provider,project,done,work}], mvp, first, last, quiet, last_call:{sid,provider,project,t},
    limits:{samples:[{t,five_hour,five_hour_resets,seven_day,seven_day_resets}], resets, weekly:{from,to}, peak},
    outages:[{t0,t1}], outage_count, ready, ready_at, reason:"quiet"|"day-over", seen, unseen, prev:{day,done,ready,ready_at,seen,unseen}, rule }`
  - 기록: 턴 완료(Stop / 트랜스크립트 end_turn — 세션·프로바이더·프로젝트·프롬프트 요약(마스킹 60자)·실행 초), 질문 대기(진행 중 턴의 입력 필요 → 다음 진행),
    세션별 첫·마지막 활동, 사용 한도 표본(5분 간격)·정전(5시간 100%) 구간. 훅과 트랜스크립트가 같은 턴을 보면 5초 오차로 하나로 친다
  - 준비됨(`ready`): 오늘은 마지막 활동이 정오 이후 + 45분 동안 모든 세션 무활동(다시 활동하면 풀리고 `ready_at`이 바뀜 = 갱신), 지난 날은 완료가 있으면 항상.
    `unseen` = 준비됐고 `seen`이 없거나 `ready_at`보다 이름. 오늘 응답의 `prev`로 "어제 일보"를 띄울지 정한다
- `POST /daylog/seen` 본문 `{"day":"today"|"yesterday"|"YYYY-MM-DD"}` — 그날 일보를 봤다고 기록 → `{ day, seen }`.
  `Content-Type: application/json`만(아니면 415 — 폼·text/plain 같은 단순 요청은 다른 사이트에서 보낼 수 있으므로), 1KB 이하(413),
  `Origin`·`Sec-Fetch-Site`가 있으면 같은 출처만(403). JSON POST는 preflight가 필요한데 OPTIONS·CORS 응답이 없어 다른 사이트에서는 막힌다
- `GET /modes` — 모드 발견: 내장(`web/modes/index.json` 순서) + 사용자 모드 폴더의 `mode.json` 원본(64KB 제한, 검증은 코어가).
  응답 `{ modes: [{ dir, source: "builtin"|"user", manifest|null, error? }], userDir, devDirs }` (홈 경로는 `~`로 축약)
- `GET /_modes/<id>/index.html` — 외부 모드 샌드박스 문서(서버가 생성: SDK → core-lib → 모드 CSS → 모드 JS). `/_modes/<id>/<파일>`은
  사용자 모드 폴더 안 파일만(경로 정규화, 링크·폴더 밖·허용 안 된 확장자 거부). 모든 응답에 CSP(`connect-src 'none'`, 스크립트는
  그 모드 폴더·`/_sdk/`만, `sandbox allow-scripts` 등)·Permissions-Policy. `GET /_sdk/{mode-sdk.js,core-lib.js,sandbox.css}`
- `GET /brand.json` — 앱 이름·식별자
- 안전(공통): 127.0.0.1에만 바인딩하고, `Host` 헤더가 `localhost:<포트>`·`127.0.0.1:<포트>`가 아니거나 둘 이상이면 403(DNS 리바인딩 방지). CORS 헤더 없음.
  GET·HEAD만, 예외는 위 `POST /daylog/seen` 하나(본 시각 기록뿐, 위 CSRF 규칙). 그 밖의 메서드 501. 정적 파일은 `web/index.html`·`web/core/*.js|css`·`web/modes/index.json`·
  `web/modes/<id>/<파일>.(js|css|json|svg|png|md)`만 서빙

## 테스트 (기준 결과)
```
python3 fixtures/make_fixtures.py     # 합성 입력 다시 만들기 (생성기를 고쳤을 때만)
python3 scripts/snapshot.py --check   # server.py 결과가 fixtures/expected와 같은지(두 번 실행해 결정성도 확인)
python3 scripts/snapshot.py           # server.py 동작을 의도적으로 바꿨을 때 기준 결과 갱신
python3 scripts/compare.py fixtures/expected <다른 구현의 결과 폴더>
sh scripts/rust_parity.sh             # Rust(wr-core) 동등성 23/23 + 트랜스크립트 전용 24/24
python3 scripts/test_daylog.py        # 퇴근 일보 일지 회귀 (임시 폴더만 씀, server.py는 빈 포트(7800 우선)로 잠깐 띄움)
python3 scripts/test_mcp_reports.py   # MCP 보고 회귀 (임시 폴더만 씀)
cargo test --workspace                # 단위 테스트 + 동등성 + HTTP(포트 7792, 사용 중이면 빈 포트)
python3 scripts/check_secrets.py --leak         # 시크릿·개인 경로 패턴 + 기준 결과 마스킹 유출
python3 scripts/selftest_transcript_only.py     # 트랜스크립트 전용 규칙 검사기 자체 점검
python3 scripts/validate_modes.py               # mode.json 스키마 검증 (pip install jsonschema)
python3 scripts/selftest_check_secrets.py       # 시크릿·경로 탐지 패턴 회귀 테스트
BLOCKED_EMAIL_DOMAINS=example.com python3 scripts/check_commit_emails.py origin/main..HEAD   # 커밋 이메일 검사 (예시 도메인은 가짜 값)
```
CI(`.github/workflows/ci.yml`)가 PR과 main push마다 위 검사를 돌린다. Rust 검사(`.github/workflows/rust.yml`)는 러너 시간을 아끼려고 Rust와 기준 결과에 영향을 주는 파일이 바뀐 PR·main push에서만 돈다(main은 다음 PR이 쓸 캐시를 만들기 위해, 수동 실행 가능). Rust 1.90.0 고정: Linux에서 `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `sh scripts/rust_parity.sh`(앱 빌드용 시스템 라이브러리를 apt로 설치), Windows에서 `cargo test -p wr-core -p wr-hook -p wr-server`. macOS는 PR 검사에서 뺐다(Linux·Windows 검사로 충분, 맥 앱 빌드는 `release.yml`).
`BLOCKED_EMAIL_DOMAINS`(쉼표 구분)는 커밋 이메일 검사의 차단 도메인 목록이다. CI에서는 저장소 시크릿으로 넣고(Settings → Secrets and variables → Actions), 비어 있으면 검사를 건너뛴다. 값은 코드·문서에 적지 않는다.
기준 결과는 가짜 시크릿 원문이 하나라도 남으면 실패한다. 서버(포트)는 띄우지 않는다.

## Hook 등록
데스크톱 앱은 온보딩·설정 → AI 연결에서 `wr-hook`을 등록한다(위 '데스크톱 앱'). 아래는 브라우저 버전(`server.py`)용 수동 등록이다.
`~/.claude/settings.json`의 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`(TaskCreate|TaskUpdate), `Notification`, `Stop`, `SessionEnd`, `SubagentStart`, `SubagentStop`에
`python3 <설치 경로>/hook.py` 등록(`<설치 경로>` = 이 저장소를 받은 폴더의 절대 경로). 제거하려면 해당 항목 삭제
(등록 전 백업: `~/.claude/settings.json.bak-waiting-room`).

## MCP 보고 (실험, 기본 꺼짐)
AI가 MCP 도구 2개로 진행 상황을 직접 알린다: `waitscape_status`(state `working|asking|done`, `title`, `step`/`total`, done 때 `big`·`cheer`)와
`waitscape_board`(계획 ≤4줄, 끝난 줄 번호 `done`). 보조 프로그램은 훅과 같은 바이너리의 하위 명령 `wr-hook mcp`(stdio, 네트워크 없음)이고,
호출을 정화·마스킹해 `~/.claude/waiting-room/reports.jsonl`에 한 줄씩 남긴 뒤 `ok`만 돌려준다. 앱·서버가 이 파일과 훅의 `report` 이벤트를 읽어
`/state`의 `session.report`(Claude 세션)·`source: "mcp"` 세션(Codex·Antigravity 등)으로 내보낸다.
스튜디오에서는 그 층 벽 보드에 AI가 쓴 계획(✓·"✍️ AI가 씀"), 책상 명패에 단계 "3/5", 큰 일을 끝내면 사장님 칭찬 말풍선이 뜬다(자세히는 MODES.md 스튜디오).
MCP 세션의 끝난 일도 오늘 완료 수와 퇴근 일보에 들어가고(`by_ai` 큰 일 · `cheers`), AI 한마디는 공유 카드에 기본으로 넣지 않는다.
- 켜기: 앱은 설정 → **AI 연결** → "MCP 보고 (실험)" 스위치(기본 꺼짐, 설정 파일 `mcpReports`), `server.py`·`wr-server`는 기본으로 읽음(`WAITING_ROOM_REPORTS=off`면 끔)
- 앱에서 연결: 같은 화면의 표에서 AI 도구별 상태(미설치/감지됨/연결됨)를 보고 [연결…] → 바뀔 내용 미리보기 → [적용] → 확인 창 → 백업 후 적용.
  [해제…]는 앱이 넣은 것만 지운다(연결 전부터 있던 항목은 그대로, 파일이 그대로면 원본과 바이트 동일). 설정 파일이 없거나 깨졌으면 쓰지 않는다.

  | 도구 | 바꾸는 곳 |
  |---|---|
  | Claude Code | `claude mcp add -s user waitscape …`(아래와 같은 명령) + "이 두 도구만 확인 없이 실행"(기본 체크) → `settings.json` `permissions.allow` |
  | Codex CLI | `~/.codex/config.toml`(`CODEX_HOME`) `[mcp_servers.waitscape]` — `command`, `args = ["mcp", "--reports", <절대 경로>]`, `enabled_tools`(도구 2개), `env_vars = ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_PATH", "CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID"]`(Orca·cmux 이동용, 값이 없으면 아무것도 안 넘어감) |
  | Antigravity CLI | `~/.gemini/config/mcp_config.json` `mcpServers.waitscape` — `command`, `args`, `enabledTools`(도구 2개) |

  Gemini CLI는 Antigravity CLI로 대체되어 대상에서 뺐다. 연결 기록: `~/.claude/waiting-room/mcp-connect.json`
- Claude Code 수동 연결 (앱이 훅을 설치하면 `wr-hook`이 `<Claude 루트>/waiting-room/bin/`에 있다. 경로는 **절대 경로**로):
  ```
  claude mcp add -s user waitscape -- <홈>/.claude/waiting-room/bin/wr-hook mcp --reports <홈>/.claude/waiting-room/reports.jsonl
  claude mcp remove -s user waitscape      # 해제
  ```
  `--reports`를 인자로 주는 이유: 일부 CLI(Codex)는 MCP 서버에 기본 환경변수만 넘긴다. 확인창을 없애려면 `~/.claude/settings.json`의
  `permissions.allow`에 **도구 두 개만** 넣는다: `"mcp__waitscape__waitscape_status"`, `"mcp__waitscape__waitscape_board"`
  (`mcp__waitscape`처럼 서버 전체를 허용하면 같은 이름의 다른 서버 도구까지 열린다). 두 도구는 화면 글자만 바꾸고 파일·명령·네트워크를 건드리지 않는다
- 훅이 설치·동작 중이면 Claude 보고는 훅의 `PreToolUse` 이벤트로만 정확한 세션에 붙는다(도구 말풍선으로는 세지 않음, 사이드카 쪽 Claude 보고는 버림 —
  같은 폴더의 다른 창·지난 턴·서브에이전트 보고가 섞이지 않게). 훅이 없을 때만 같은 폴더의 활성 Claude 세션이 하나뿐이고 마지막 프롬프트 뒤 보고일 때 붙인다
- 기록 줄은 1MB가 넘으면 앱(Rust 리더)이 `reports.1.jsonl`로 돌린다. 사이드카는 SIGTERM·SIGINT·SIGHUP(unix)이나 stdin EOF에 보류분을 쓰고 끝낸다.
  진단 로그는 `WR_MCP_DEBUG=1`일 때만 stderr

## 놀거리
- 🎵 연주회: 도구 호출마다 음이 울림 (읽기=피아노, 수정=마림바, 실행=드럼, 검색=벨). 아기 햄찌는 한 옥타브 위
- 🏷️ 칭호: 작업량이 아니라 도구 사용 스타일로 정함. 상단 칭호를 누르면 "오늘의 햄찌" 카드 (`/#daily`로 바로 열기)
- 📼 리플레이: 끝난 작업을 빨리감기로 다시 보기
- 🥜 볼주머니 메모: 다음 프롬프트를 적어두면 끝날 때 꺼내줌 (브라우저 localStorage에만 저장)
- 🪙 토큰: 세션 트랜스크립트(`~/.claude/projects/*/<세션ID>.jsonl`, 서브에이전트는 `<세션ID>/subagents/`)의 usage를 메시지 id로 중복 제거해 합산.
  표시값 = 새 입력(input + cache_creation) + 출력. 캐시 읽기는 따로 툴팁/오늘의 햄찌 카드에 표시
- 🍙 사용 한도: 아래 '사용 한도 직접 조회'를 켜는 것이 기본 방법이다.
  (고급·선택) `statusline_tap.py`는 statusline stdin의 `rate_limits`(5시간/주간/추가 사용)와 세션별 컨텍스트 사용률을
  `~/.claude/waiting-room/statusline.json`에 저장한다. 출력이 없으므로 기존 statusline을 대체하지 말고, 기존 statusline 명령이
  stdin을 이 스크립트에도 넘기도록 직접 연결해야 한다(`python3 <설치 경로>/statusline_tap.py`)
  여러 세션(플러그인이 띄우는 내부 세션 포함)이 각자 오래된 값을 보내도 한도가 깜빡이지 않도록 **창별로 최댓값을 남긴다**: 같은 창(같은 `resets_at`) 안에서
  사용률은 줄지 않으므로 큰 값을 유지하고, 더 늦게 끝나는 창이 최신, 이미 지난 창은 버리며, 5시간 값이 없는 보고는 기존 5시간 값을 지우지 않는다.
  파일은 잠금 안에서 읽기→병합→교체(원자적)로 쓴다. 읽는 쪽(`server.py`, `wr-core`)도 같은 규칙을 지금까지 본 값에 계속 적용(옛 탭이 파일을 덮어써도 화면은 내려가지 않음; `fixtures/limits_merge.json`으로 양쪽 검증)
- 💼 업무 모드: 햄찌·게임 요소 없이 관측 대시보드로 전환(햄찌 모드는 내려가서 실행되지 않음). 모드 전환기 또는 숫자 키 (`/#work`로 바로 열기). 눈치 보일 땐 🙈 눈치 모드(**B**)
  KPI 행(활성/입력 필요/멈춤 의심/서브에이전트/완료/토큰/대기) + 사용 한도 + 세션 테이블(행 클릭으로 프롬프트·활동·서브에이전트·할 일·메모 펼침).
  입력 필요·멈춤 의심 세션은 위로 정렬되고 자동으로 펼쳐짐. 펼침 상태는 localStorage `opsOpen`, 메모는 게임 모드와 같은 `memo:<세션ID>` 키 공유
- 🔍 에이전트 상세 + 멈춤 감지: 트랜스크립트에서 마지막 발화(💬)와 실행 중인 도구를 읽음.
  모델 응답이 2분/5분 없으면 느림/멈춤 의심, 도구 하나가 2분/10분 안 끝나면 느림/멈춤 의심 (`server.py`의 `SLOW`, `STALL`, `TOOL_SLOW`, `TOOL_STALL`)
- 🔄 사용 한도 직접 조회 (선택): `WAITING_ROOM_POLL_USAGE=1 python3 server.py`로 켜면 5분마다
  `api.anthropic.com/api/oauth/usage`를 조회 (키체인의 Claude Code OAuth 토큰 사용, 메모리에만 보관).
  비공개 API라 Claude Code 업데이트로 바뀔 수 있음. 단독 테스트: `python3 usage_poll.py`

## 기여
이슈·PR 환영. [`CONTRIBUTING.md`](CONTRIBUTING.md)(개발 환경·커밋 규칙·AI 사용 공개), 모드 만들기 [`MODES.md`](MODES.md),
보안 신고 [`SECURITY.md`](SECURITY.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## 라이선스
MIT — [`LICENSE`](LICENSE)

### 서드파티
- **Galmuri11** (도트 폰트, 햄찌 모드·스튜디오 미니 보기) — © 2019–2025 Lee Minseo, [SIL Open Font License 1.1](web/fonts/OFL.txt).
  npm 패키지 [`galmuri@2.40.3`](https://www.npmjs.com/package/galmuri)(jsDelivr)의 `Galmuri11.woff2`·`Galmuri11-Bold.woff2`를 그대로 `web/fonts/`에 넣었다(수정·서브셋 없음). 출처: <https://github.com/quiple/galmuri>

---
Built with [Claude Code](https://claude.com/claude-code).

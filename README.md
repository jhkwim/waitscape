<div align="center">

<img src="docs/assets/icon.png" width="128" alt="Waitscape 아이콘 — 커피잔 속 도트 햄찌">

# Waitscape

**AI가 일하는 동안, 기다림을 볼거리로.**

[![Release](https://img.shields.io/github/v/release/jhkwim/waitscape?color=444d56&label=release)](https://github.com/jhkwim/waitscape/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-13%2B-0969da)](docs/INSTALL.md)
[![Windows](https://img.shields.io/badge/Windows-10%2B-0969da)](docs/INSTALL.md)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)](https://tauri.app)
[![License](https://img.shields.io/badge/license-MIT-3fb950)](LICENSE)

**한국어** · [English](README.en.md)

</div>

Waitscape는 Claude Code·Codex 같은 AI 코딩 에이전트의 세션을 **도트 사무실**로 보여 주는 데스크톱 앱이에요. 세션 하나가 직원 한 명이 되어 자기 층에서 일하고, 질문이 생기면 엘리베이터를 타고 1층 사장님(나)에게 물으러 와요. 일이 끝나면 보고하러 오고요. 터미널을 계속 들여다보지 않아도 지금 누가 무엇을 하고, 누가 나를 기다리는지 한눈에 보여요.

<div align="center">
<img src="docs/assets/studio.gif" width="860" alt="스튜디오 모드 — 층마다 일하는 동물 직원, 질문하러 엘리베이터를 타는 펭귄, 큰 일을 끝낸 로봇">
<br><sub>화면의 세션·프로젝트는 모두 가짜 데이터예요.</sub>
</div>

## 왜

- **기다림이 지루하지 않게.** 에이전트가 10분, 30분씩 일할 때 볼 게 생겨요. 동물 직원 7종이 도구를 쓸 때마다 타자를 치고, 서브에이전트가 생기면 회의실에 모여요.
- **놓치지 않게.** 질문이 오면 OS 알림과 함께 직원이 사장실로 와요. 훅을 켜 두면 누르는 순간 그 세션의 터미널(cmux·Orca)로 바로 이동해요.
- **한도도 한눈에.** Claude 5시간 사용 한도가 건물의 하루 시계예요. 많이 쓸수록 해가 지고, 다 쓰면 정전이 나요.

## 어떻게 동작하나요

1. 🪝 **처음 실행할 때 훅을 켜요.** 앱이 Claude Code 설정(`~/.claude/settings.json`)을 백업한 뒤 Waitscape 항목만 더해요. 켜지 않아도 세션 기록만으로 동작해요.
2. 👀 **평소처럼 AI에게 일을 시켜요.** 앱은 내 컴퓨터에 있는 세션 기록과 훅 이벤트를 읽어 상태를 만들어요. 따로 서버를 띄울 필요가 없어요.
3. 🏢 **화면을 골라 보세요.** 기본은 스튜디오예요. 작은 미니 보기를 다른 창 위에 띄워 두거나, 눈치가 보이면 업무 툴처럼 생긴 화면으로 바꿀 수 있어요.

## 둘러보기

<table>
<tr>
<td width="44%" align="center"><img src="docs/assets/mini.gif" width="300" alt="미니 보기 — 질문 클로즈업, 답변 후 복귀, 옥상 축하, 사장실 보고"></td>
<td width="56%" valign="middle">
<h3>📌 미니 보기</h3>
항상 위에 떠 있는 작은 "로비 카메라"예요. 평소엔 사장실을 비추다가, 일이 생기면 그 층으로 가서 담고 돌아와요. 질문이면 클로즈업과 자막, 큰 일을 끝내면 옥상에서 폭죽을 터뜨리고 사장실로 보고하러 와요. 휠이나 ↑↓로 층을 직접 둘러볼 수도 있어요.
</td>
</tr>
<tr>
<td colspan="2" valign="middle">
<h3>⚡ 한도 = 건물 전력</h3>
5시간 한도 사용률에 따라 건물의 하루가 흘러가요. 50%부터 노을이 지고 아래층부터 불이 켜져요. 80%부터는 절전이라 조명이 반만 켜지고 자판기가 꺼져요. 100%가 되면 정전이 나서 촛불과 손전등에 의지하고, 표지판에 "리셋까지 h:mm"가 떠요. 리셋되면 닭이 울고 해가 떠요. 주간 한도는 날씨(구름·비·눈)로 켤 수 있어요.
<p align="center"><img src="docs/assets/power.png" width="860" alt="낮 · 노을 · 정전"></p>
</td>
</tr>
<tr>
<td width="56%" valign="middle">
<h3>🙈 눈치 모드</h3>
회사에서 게임처럼 보여 눈치가 보이면 <b>⌃Q</b>(Windows <b>Alt+`</b>)를 눌러 보세요. 블라인드가 착 내려오고 평범한 업무 툴 "Agent Sessions"로 바뀌어요. 다른 앱을 쓰는 중에도 돼요. 세션 표, 진행 상황, 한도 막대는 그대로 보이고 알림도 담백해져요. 다시 누르면 직원들이 커피를 들고 출근해요.
</td>
<td width="44%" align="center"><img src="docs/assets/nunchi.png" width="420" alt="눈치 모드 — 평범한 업무 툴처럼 보이는 Agent Sessions 화면"></td>
</tr>
<tr>
<td width="44%" align="center"><img src="docs/assets/modes.png" width="420" alt="햄찌 · 전광판 · 궤도 · 업무 모드"></td>
<td width="56%" valign="middle">
<h3>🎨 여러 화면 모드</h3>
스튜디오 말고도 화면이 더 있어요. 🐹 햄찌(세션마다 햄찌 한 마리), 🏟️ 전광판(스포츠 중계), 🪐 궤도(한도 태양과 세션 행성), 💼 업무(관측 대시보드), 🌊 흐름(AI의 생각 흐름), 📌 포켓(작은 위젯)이에요. 숫자 키로 바로 바꿀 수 있고, 직접 <a href="MODES.md">모드를 만들어</a> 넣을 수도 있어요.
</td>
</tr>
</table>

## 이 밖에도

- **바로 이동** — 질문 중인 직원, 완료 배너, 층 이름표를 누르면 그 세션의 cmux 패널이나 Orca 터미널로 가요. 그 밖에는 세션 폴더에서 터미널(또는 편집기)을 열어요. 바로 이동은 훅을 켰을 때 동작해요.
- **👆 클릭 반응** — 직원과 소품(모니터·커피·화분·자판기·엘리베이터…)을 누르면 작게 반응해요. 숨은 이스터에그가 8개 있어요.
- **📋 퇴근 일보** — 오후에 다들 45분쯤 조용해지면 사장님이 "일보 나왔어요!" 하고 종이를 흔들어요. 오늘 끝낸 일, 작업 시간, MVP를 발표하고 공유 카드(PNG)를 만들어 줘요.
- **🎨 층 꾸미기** — 일을 마치면 모이는 자금으로 소품을 사서 프로젝트 층을 꾸며요. 동물마다 좋아하는 소품이 있어요. 결제는 없어요.
- **서브에이전트 회의** — 서브에이전트가 생기면 아기 동물들이 회의실에 모여 화이트보드에 할 일을 적고 ✓를 쳐요.
- **🔕 회의 모드** — 소리와 깜빡임을 끄고 조용히 보여 줘요. OS의 "움직임 줄이기" 설정도 따라요.
- **앱 안 업데이트** — 새 버전이 나오면 알려 주고, 눌렀을 때만 서명을 확인한 뒤 설치해요.
- **한국어·영어** — OS 언어를 따르고, 설정에서 바꿀 수 있어요.

## 지원 도구

| 도구 | 세션 보기 | 연결 방법 | 사용 한도 |
|---|---|---|---|
| **Claude Code** | ✅ | 훅(권장) 또는 세션 기록 자동 읽기 | ✅ 5시간·주간 (조회 동의 시) |
| **Codex CLI** | ✅ (실험) | 설정 → AI 연결 → MCP 보고 | — |
| **Antigravity CLI** | ✅ (실험) | 설정 → AI 연결 → MCP 보고 | — |

터미널 바로 이동은 **cmux**(macOS)와 **Orca**(macOS·Windows)에서 연 세션을 지원해요. Antigravity 세션은 화면에 Gemini로 표시돼요.

## 설치

### 요구사항

- macOS 13 이상 (Apple 칩·Intel 공용 universal)
- Windows 10 1809 이상 (x64)

### 내려받기

[최신 릴리스](https://github.com/jhkwim/waitscape/releases/latest)에서 macOS는 `.dmg`, Windows는 `.exe`나 `.msi`를 받으세요.

아직 코드 서명·공증이 되어 있지 않아서 처음 열 때 경고가 떠요. 한 번만 허용하면 돼요.

- **macOS:** "열지 않음" 창이 뜨면 **완료**를 누르고(휴지통으로 옮기지 마세요) **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**. macOS 14 이하는 앱을 **우클릭 → 열기**로도 돼요.
- **Windows:** SmartScreen 창에서 **추가 정보 → 실행**.

체크섬 확인과 제거 방법은 [설치 안내](docs/INSTALL.md)에 있어요.

### 소스에서 빌드

Rust 1.90 이상과 Tauri CLI 2가 필요해요.

```bash
cargo install tauri-cli --version "^2" --locked
cd app/src-tauri
cargo tauri dev      # 개발 실행
cargo tauri build    # 설치 파일 만들기
```

브라우저 버전(`python3 server.py`), 테스트, API는 [개발 문서](docs/DEVELOPMENT.md)를 보세요.

## 프라이버시

- **내 컴퓨터에서만 읽어요.** 세션 기록과 훅 이벤트는 로컬 파일에서 읽고 밖으로 보내지 않아요. 프롬프트·도구 설명은 화면에 보이기 전에 토큰·비밀번호 같은 값을 가려요.
- **앱이 보내는 요청은 두 곳뿐이에요.**
  - `api.anthropic.com`: Claude 사용 한도 조회. 설정에서 동의해야 켜지고 기본은 꺼져 있어요. Claude Code 로그인 토큰을 헤더로 보내고, 토큰은 메모리에만 둬요.
  - `github.com/jhkwim/waitscape` 릴리스: 새 버전 확인(`latest.json`). [지금 업데이트]를 누를 때만 같은 곳에서 설치 파일을 받아요. 확인은 설정에서 끌 수 있어요.
  - Windows 설치 때 WebView2가 없으면 설치 프로그램이 Microsoft에서 받아요.
- **설정을 바꿀 땐 내용을 보여 줘요.** 훅을 켜면 `wr-hook` 실행 파일을 `~/.claude/waiting-room/bin/`에 복사하고, `~/.claude/settings.json`을 백업한 뒤 Waitscape 항목만 더해요("자세히 보기"로 바뀌는 내용 확인). MCP 연결도 미리보기·백업 뒤 적용하고, 해제하면 더한 것만 빼요.
- **진단 로그**에는 토큰·프롬프트 내용을 남기지 않고, 홈 경로는 `~`로 줄여요.

## 프로젝트 구조

| 폴더 | 내용 |
|---|---|
| `app/src-tauri/` | 데스크톱 앱 (Tauri 2) |
| `crates/` | Rust 코어(`wr-core`)·훅(`wr-hook`)·브라우저용 서버(`wr-server`) |
| `web/` | 화면: 공통 코어와 모드 패키지 (빌드 단계 없음) |
| `types/` | `/state`·`/trace`·모드 API 공식 타입 |
| `fixtures/`, `scripts/` | 테스트 데이터와 검사 도구 |
| `docs/` | [설치](docs/INSTALL.md)·[릴리스](docs/RELEASE.md)·[개발 문서](docs/DEVELOPMENT.md) |

파일별 설명은 [개발 문서의 「구조」](docs/DEVELOPMENT.md#구조)에, 설계는 [ARCHITECTURE.md](ARCHITECTURE.md)에 있어요.

## 기여

버그 제보, 아이디어, 새 모드 모두 환영해요. 시작은 [CONTRIBUTING.md](CONTRIBUTING.md)를 보세요.

- 모드 만들기: [MODES.md](MODES.md)
- 보안 신고: [SECURITY.md](SECURITY.md)
- 행동 강령: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## 라이선스

[MIT](LICENSE). 도트 폰트 **Galmuri11**은 [SIL Open Font License 1.1](web/fonts/OFL.txt)을 따라요.

Waitscape는 비공식 개인 프로젝트예요. Anthropic·OpenAI·Google과 제휴하거나 승인받은 관계가 아니에요. Claude, Codex, Antigravity는 각 회사의 상표예요.

<sub>Built with [Claude Code](https://claude.com/claude-code).</sub>

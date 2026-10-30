# 설치 · 제거 / Install · Uninstall

**macOS**: 0.4.2부터 설치 파일이 **Developer ID로 서명되고 Apple 공증**을 받아, 처음 한 번 "인터넷에서 다운로드한 앱" 확인 창에서 [열기]만 누르면 됩니다. 0.4.1 이하는 미서명이라 아래 방법으로 엽니다.<br>
**Windows**: 아직 코드 서명이 없어 처음 실행할 때 SmartScreen 경고가 나옵니다.

**macOS**: from 0.4.2 the app is **signed with a Developer ID and notarized by Apple**, so macOS only asks once to confirm opening an app downloaded from the internet (0.4.1 and earlier: see below). **Windows**: not code-signed yet, so SmartScreen may warn on first launch.

받는 곳 / Download: [Releases](https://github.com/jhkwim/waitscape/releases/latest) (`.dmg` macOS, `.exe`·`.msi` Windows, `SHA256SUMS.txt`)

## 한국어

### 0. 체크섬 확인 (권장)
받은 파일이 릴리스에 올라온 것과 같은지 SHA-256으로 확인합니다. `SHA256SUMS.txt`를 같은 폴더에 두고:
- macOS: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`
- Windows (PowerShell): `Get-FileHash .\<파일이름> -Algorithm SHA256` 결과를 `SHA256SUMS.txt`의 해당 줄과 비교
- Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

### 1. macOS (13 이상, Apple 칩·Intel 공용)
0.4.2 이상은 `.dmg`를 열고 응용 프로그램 폴더로 끌어다 놓은 뒤 열고, "인터넷에서 다운로드한 앱" 확인 창에서 **열기**를 누르면 됩니다. 아래 2~4번은 0.4.1 이하(미서명) 또는 경고가 뜰 때만입니다.

1. `.dmg`를 열고 Waitscape를 응용 프로그램 폴더로 끌어다 놓습니다.
2. 처음 열 때 "'Waitscape.app'을(를) 열지 않음"(버튼은 [휴지통으로 이동]·[완료]) 경고가 나오면 **완료**를 누르고(휴지통으로 옮기지 마세요), **시스템 설정 → 개인정보 보호 및 보안** 아래쪽의 Waitscape가 차단되었다는 문구 옆 **그래도 열기** → 암호(또는 Touch ID). 이 버튼은 앱을 열려고 한 뒤 1시간쯤만 보이니 안 보이면 앱을 한 번 더 열어 보세요. 다시 열 때 확인 창이 한 번 더 뜨면 **열기**를 누릅니다.
3. macOS 14 이하는 응용 프로그램에서 Waitscape를 **우클릭(Control-클릭) → 열기 → 열기**로도 됩니다(macOS 15부터는 이 방법이 막혔어요). 한 번 허용하면 다음부터는 경고가 없고, 앱 안 업데이트로 받은 새 버전에는 다시 뜨지 않습니다.
4. 그래도 "손상되었다"고 나오면 격리 표시를 지웁니다: `xattr -dr com.apple.quarantine /Applications/Waitscape.app`

### 2. Windows (10 1809 이상, x64)
1. `.exe`(설치 프로그램, 사용자 단위) 또는 `.msi`를 실행합니다.
2. "Windows의 PC 보호" (SmartScreen) 창이 뜨면 **추가 정보 → 실행**을 누릅니다.
3. WebView2 런타임이 없으면 설치 프로그램이 안내합니다(Windows 11과 최신 Windows 10에는 이미 있습니다).

### 3. 훅은 선택입니다
훅(Claude Code 이벤트 수집)을 켜지 않아도 앱은 세션 기록(트랜스크립트)만으로 동작합니다. 켜고 싶으면 앱의 **설정 → AI 연결 → 훅 켜기**를 누르세요.
앱에 든 `wr-hook`을 `~/.claude/waiting-room/bin/`에 복사하고, `~/.claude/settings.json`을 백업한 뒤 Waitscape 항목만 추가합니다(확인 창이 먼저 뜹니다). 사용 한도 조회도 설정에서 동의해야 켜집니다(기본 꺼짐).

### 4. 업데이트
- 앱이 **시작할 때 + 하루 1번** 새 버전을 확인합니다(`jhkwim/waitscape` 릴리스의 `latest.json`만 읽어요. 보내는 것: IP·User-Agent. 0.4.0까지는 배포 전용 저장소 `jhkwim/waitscape-releases`를 읽었어요). 확인하지 못했으면(인터넷 끊김 등) 1시간 뒤부터 다시 확인합니다(계속 안 되면 간격을 늘려 최대 하루 1번, 업데이트 확인이 켜져 있을 때).
- 새 버전이 있으면 OS 알림 **"새 버전 나왔어요!"**, 트레이(메뉴바)에 **🎁 업데이트 있음**, 창 아래 배너(스튜디오 모드에서는 1층 사장님 말풍선)가 나옵니다.
- 눌러서 **지금 업데이트하고 다시 시작**을 고를 때만 내려받고, 서명(minisign)을 확인한 뒤 설치하고 다시 시작합니다. 몰래 설치하지 않습니다. 설정·사용자 모드·메모는 그대로입니다.
- 끄기: **설정 → 일반 → 업데이트 → 새 버전 확인** 끄기. [지금 확인]으로 직접 확인할 수도 있습니다.
- v0.3.0보다 옛 버전은 앱 안 업데이트가 동작하지 않습니다(서명 키가 없던 빌드). 한 번만 Releases에서 새 설치 파일을 받아 그대로 덮어 설치하세요(1·2번과 같음, 데이터는 유지). 그 다음부터는 앱이 알려 줍니다.

### 5. 제거
1. 앱 **설정 → AI 연결 → 훅 끄기** (설정 파일에서 우리 항목만 지우고, 백업은 남깁니다). 훅을 켠 적이 없으면 건너뜁니다.
2. 앱 삭제
   - macOS: 응용 프로그램의 Waitscape를 휴지통으로 (자동 시작을 켰다면 설정에서 먼저 끄기)
   - Windows: 설정 → 앱 → 설치된 앱 → Waitscape → 제거
3. 데이터 폴더 삭제 (원하면)
   | | macOS | Windows |
   |---|---|---|
   | 앱 설정·사용자 모드 | `~/Library/Application Support/io.github.jhkwim.waitscape/` | `%APPDATA%\io.github.jhkwim.waitscape\` |
   | 진단 로그 | `~/Library/Logs/io.github.jhkwim.waitscape/` | `%LOCALAPPDATA%\io.github.jhkwim.waitscape\logs\` |
   | 훅 바이너리·이벤트 로그 | `~/.claude/waiting-room/` | `%USERPROFILE%\.claude\waiting-room\` |
   | settings.json 백업 | `~/.claude/` 안의 백업 파일 | `%USERPROFILE%\.claude\` 안의 백업 파일 |

   Claude Code 자체의 `~/.claude/projects/`(트랜스크립트)는 Waitscape가 읽기만 하며 지우지 않습니다.

### 6. 문제 해결: 로그 폴더 보내기
버튼이 반응하지 않거나 창이 안 뜨면 앱의 진단 로그를 이슈에 붙여 주세요.
1. 앱 **설정 → 일반 → 앱 정보 → [로그 폴더 열기]** (창을 열 수 없으면 아래 경로를 직접 엽니다)
   | macOS | Windows |
   |---|---|
   | `~/Library/Logs/io.github.jhkwim.waitscape/` | `%LOCALAPPDATA%\io.github.jhkwim.waitscape\logs\` (탐색기 주소창에 그대로 붙여 넣기) |
2. `waitscape.log`(있으면 `waitscape.old.log`도)를 첨부합니다. 문제를 한 번 재현한 직후의 파일이 좋아요.
- 들어 있는 것: 앱 버전·OS·WebView 버전, 창 열기·숨기기 단계와 오류, 일보 폴더 사용 여부·오늘 완료 수. 토큰·프롬프트 내용은 남기지 않고 홈 경로는 `~`로 줄입니다. 그래도 보내기 전에 한 번 열어 보세요.
- 파일은 1MB가 넘으면 `waitscape.old.log`로 한 번 돌아가므로 두 개를 넘지 않습니다.

### 현재 한계
코드 서명·공증은 아직 없습니다. 그래서 위 경고가 나옵니다. 서명은 인증서가 준비되면 릴리스 워크플로에서 시크릿으로 켤 수 있게 자리만 만들어 두었습니다.
앱 안 업데이트는 업데이터 서명 키가 들어간 빌드부터 동작합니다(관리자 안내: [RELEASE.md](RELEASE.md)).

---

## English

### 0. Verify the checksum (recommended)
Put `SHA256SUMS.txt` next to the download and run:
- macOS: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`
- Windows (PowerShell): `Get-FileHash .\<file> -Algorithm SHA256`, then compare with the matching line in `SHA256SUMS.txt`
- Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

### 1. macOS (13+, universal: Apple silicon and Intel)
From 0.4.2, open the `.dmg`, drag Waitscape to Applications, open it and click **Open** when macOS asks to confirm an app downloaded from the internet. Steps 2–4 are only for 0.4.1 and earlier (unsigned) or if you still see a warning.

1. Open the `.dmg` and drag Waitscape to Applications.
2. If macOS says “Waitscape.app” Not Opened (buttons: Move to Trash / Done), click **Done** (do not move it to the Trash), then go to **System Settings → Privacy & Security**, find “Waitscape.app” was blocked to protect your Mac., and click **Open Anyway** (password or Touch ID). The button only shows for about an hour after you try to open the app, so open it once more if you don't see it. If a confirmation appears when you reopen the app, click **Open**.
3. On macOS 14 and earlier you can also **right-click (Control-click) Waitscape in Applications → Open → Open** (macOS 15 removed this route). After one approval the warning will not return, including for versions installed through in-app updates.
4. If it still reports "damaged", clear the quarantine flag: `xattr -dr com.apple.quarantine /Applications/Waitscape.app`

### 2. Windows (10 1809+, x64)
1. Run the `.exe` (per-user installer) or the `.msi`.
2. If SmartScreen ("Windows protected your PC") appears, click **More info → Run anyway**.
3. If the WebView2 runtime is missing, the installer will guide you (it is preinstalled on Windows 11 and current Windows 10).

### 3. The hook is optional
Waitscape works from Claude Code transcripts alone. To also use hooks, turn them on in **Settings → AI tools → Turn on hooks**. The app copies its bundled `wr-hook` to `~/.claude/waiting-room/bin/`, backs up `~/.claude/settings.json`, and adds only its own entries (after a confirmation dialog). Usage-limit polling is also opt-in (off by default).

### 4. Updates
- The app checks for a new version **at start and once a day** (it only fetches `latest.json` from the `jhkwim/waitscape` releases; sends your IP and User-Agent. Up to 0.4.0 it read the separate `jhkwim/waitscape-releases` repository). If a check fails (e.g. offline), it tries again starting an hour later (backing off to at most once a day if it keeps failing, while update checks are on).
- When one is out you get an OS notification **"A new version is out!"**, a **🎁 Update available** tray item, and a banner (in Studio mode, the boss says it in a speech bubble).
- Nothing is installed until you press **[Update now and restart]**: it downloads, verifies the minisign signature, installs and restarts. Settings, user modes and memos are kept.
- To turn checks off: **Settings → General → Updates → Check for new versions**. **Check now** checks on demand.
- Versions older than v0.3.0 cannot update in-app (built without the signing key). Download the new installer from Releases once and install over the old one (data is kept); after that the app tells you.

### 5. Uninstall
1. **Settings → AI tools → Turn off hooks** in the app (removes only our entries and keeps the backup). Skip if you never enabled it.
2. Delete the app: drag Waitscape to the Trash (macOS; turn off auto-start first if enabled), or Settings → Apps → Waitscape → Uninstall (Windows).
3. Optionally delete the data folders listed in the table above. Claude Code's own `~/.claude/projects/` transcripts are only read, never modified.

### 6. Troubleshooting: send the logs folder
If a button does nothing or a window doesn't appear, please attach the app's diagnostic log to your issue.
1. **Settings → General → About → [Open logs folder]** in the app (if you can't open the window, open the folder directly)
   | macOS | Windows |
   |---|---|
   | `~/Library/Logs/io.github.jhkwim.waitscape/` | `%LOCALAPPDATA%\io.github.jhkwim.waitscape\logs\` (paste into the Explorer address bar) |
2. Attach `waitscape.log` (and `waitscape.old.log` if present), ideally right after reproducing the problem once.
- What's inside: app version, OS, WebView version, window open/hide steps and errors, whether the daily-report folder is used and today's completed count. No tokens or prompt text; your home path is shortened to `~`. Please glance at it before sending anyway.
- When the file passes 1MB it is rotated once to `waitscape.old.log`, so there are never more than two.

### Limitations
No code signing or notarization yet, hence the warnings. The release workflow has a placeholder that turns signing on when certificate secrets are configured.
In-app updates work from the first build that carries the updater public key (maintainers: [RELEASE.md](RELEASE.md)).

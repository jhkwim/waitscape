# 보안 정책 / Security Policy

## 취약점 신고 / Reporting a vulnerability

**공개 이슈·PR·토론에 쓰지 마세요.** GitHub Security Advisories로 비공개 신고해 주세요.
**Please do not open public issues, PRs, or discussions.** Report privately via GitHub Security Advisories:

👉 https://github.com/jhkwim/waitscape/security/advisories/new
(저장소 → Security → Advisories → "Report a vulnerability")

> 메모(메인테이너): 저장소를 공개로 바꾼 직후 **Settings → Code security → Private vulnerability reporting을 켜야** 위 링크가 동작합니다(저장소가 비공개였던 동안에는 쓸 수 없었음). 켜고 링크가 열리는 것을 확인하면 이 메모를 지웁니다.

포함해 주시면 좋은 것 / Please include:
- 영향 받는 버전·커밋, 실행 방식(브라우저+`server.py` / 앱) / Affected version or commit, how it runs
- 재현 단계, 개념 증명(PoC) / Steps to reproduce, proof of concept
- 예상 영향(데이터 유출, 샌드박스 탈출 등) / Expected impact

신고 내용에 **진짜 토큰·실제 세션 기록을 넣지 마세요**. 합성 예시로 충분합니다.
Do not include real tokens or real session logs; synthetic examples are enough.

## 처리 / Response

개인이 관리하는 프로젝트라 정해진 SLA는 없지만, 보통 7일 안에 첫 답을 드리고 수정 후 Advisory로 공개합니다(신고자 크레딧 포함, 원하면 익명).
This is a personal project with no formal SLA; we aim to respond within 7 days and publish an advisory after a fix (with credit, or anonymously).

## 범위 / Scope

특히 관심 있는 영역 / Areas of particular interest:
- 외부 모드 샌드박스 탈출(iframe → 호스트 데이터·네트워크) — 알려진 한계: 브라우저 버전의 iframe 자기 이동(MODES.md §7)
- `/state`·`/trace`의 마스킹 우회(프롬프트·명령에 든 시크릿 노출)
- 로컬 서버 `Host` 검사 우회(DNS 리바인딩), 경로 탈출(`/_modes/…`)
- 사용 한도 조회 토큰의 노출(디스크·로그·프론트)

## 지원 버전 / Supported versions

최신 릴리스([`jhkwim/waitscape-releases`](https://github.com/jhkwim/waitscape-releases/releases/latest))와 `main`의 최신 커밋을 지원합니다. 이전 버전은 앱 안 업데이트로 최신 릴리스로 올려 주세요.
The latest release (published at `jhkwim/waitscape-releases`) and the latest `main` are supported. Please update older versions to the latest release.

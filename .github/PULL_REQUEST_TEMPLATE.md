## 변경 요약 / Summary

<!-- 무엇을, 왜 바꿨는지 1~3줄 / What changed and why, in 1–3 lines -->

## 관련 이슈 / Related issues

<!-- 예: Fixes #12 (병합 시 이슈가 닫힘) · Refs #34 (닫지 않음) -->
Fixes #

## 스크린샷 / Screenshots

<!-- 화면이 바뀌었다면 전·후, 라이트·다크 (실제 프롬프트·경로가 보이지 않게) / Before & after, light & dark, no real prompts or paths -->

## 체크리스트 / Checklist

**문서 / Docs**
- [ ] 새 모듈·서비스·디렉터리 → `docs/DEVELOPMENT.md` 구조 섹션 갱신 / New module or directory → docs/DEVELOPMENT.md structure updated
- [ ] API(`/state`·`/trace`·`ctx`·브리지 메시지) 추가·변경 → `docs/DEVELOPMENT.md` API 섹션, `types/*.d.ts`, `types/CHANGELOG.md` 갱신 / API change → docs & types updated
- [ ] 환경변수 추가 → `.env.example` 반영 / New env var → `.env.example`
- [ ] 해당 없음 / Not applicable

**안전 / Safety**
- [ ] 시크릿·토큰·개인 경로·회사 정보 없음 (`python3 scripts/check_secrets.py --leak`) / No secrets, tokens, personal paths, company info
- [ ] 새 외부 통신 없음 (있다면 대상·보내는 데이터를 위에 명시하고 ARCHITECTURE.md §7.1 갱신) / No new network calls (or documented)

**검증 / Verification**
- [ ] 동등성 스냅샷 통과 (`python3 scripts/snapshot.py --check`, 15/15) / Parity snapshot passes
- [ ] `server.py` 동작을 의도적으로 바꿨다면 기준 결과를 다시 만들고 이유를 적음 / If behavior changed intentionally, regenerated expected output and explained why
- [ ] 모드를 건드렸다면 `python3 scripts/validate_modes.py` 통과, MODES.md §11 체크리스트 확인 / Mode changes: schema passes, MODES.md §11 checked

**AI 사용 / AI assistance** ([CONTRIBUTING.md](https://github.com/jhkwim/waitscape/blob/main/CONTRIBUTING.md) "AI 사용 공개")
- [ ] AI 도구를 쓰지 않음 / No AI tools used
- [ ] AI 도구를 씀 — 도구 이름: <!-- 예: Claude Code --> · 커밋에 `Co-Authored-By:` 표시 · 변경 내용을 직접 읽고 이해했으며 책임은 작성자에게 있음 / AI used — tool named, commits carry `Co-Authored-By:`, I reviewed and take responsibility

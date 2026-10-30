# 교차 리뷰 품질 지표 (누적)

> 참고: 아래 `#번호`는 이 저장소를 공개 저장소로 옮기기 전(비공개 개발 저장소)의 PR 번호다. 공개 저장소에서는 같은 번호가 다른 PR을 가리킬 수 있다.

정의는 [`TRIAGE.md`](TRIAGE.md) §4. 리뷰마다 한 줄씩 **추가**한다. 보정(calibration) 실행 결과는 [`CALIBRATION.md`](CALIBRATION.md)에 따로 있다.

| 날짜 | PR | 프롬프트 | 체크리스트 | 소요(초) | 지적 🔴/🟡/🔵/❓ | 근거율 | 반영률 | 정확도 | 사소율 | 기각 사유 | 토론 | 놓친 문제 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-21 | #10 | v3 | ci, security | 396(+실패 1회) | 0/0/1/1 | 100% | - | 100% | 0% | - | - | 한글 뒤 키·폴더=id 검사 (Flash medium, 보정) |
| 2026-10-21 | #10 | v3 | ci, security | 666 | 0/0/4/2 | 100% | - | 75% | 25% | - | - | 한글 뒤 키 (Flash high, 보정) |
| 2026-10-21 | #1 | v3 | ci, rust, security | 873 | 0/1/3/0 | 100% | - | 88% | 0% | - | - | 서브에이전트 토큰·오늘 집계·status_ended·한글 마스킹 (Flash medium, 보정) |
| 2026-10-21 | #10 | v3 | ci, security | 90 | 0/0/2/0 | 100% | - | - | - | - | - | 자동 선택 검증(tier=security → Argon medium 1회, 보정. 지적 2건은 위 알려진 🔵와 동일) |
| 2026-10-26 | #47 | 00fe2b1 | frontend | 586 | 0/0/1/0 | 100% | 100% | 100% | 0% | - | - | - (Flash medium) |
| 2026-10-26 | #50 | d43a0b3 | security, ci, rust | 398 | 0/1/0/0 | 100% | 100% | 100% | 0% | - | - | - (Argon 429로 Flash medium 대체) |
| 2026-10-27 | #52 | 0f9ea47 | rust, frontend | 484 | 0/0/1/0 | 100% | 100% | 100% | 0% | - | - | - (Flash medium) |
| 2026-10-27 | #56 | 96a2471 | rust, security | 404 | 0/0/0/0 | - | - | - | - | - | - | - (Flash medium) |
| 2026-10-27 | #58 | e6944a8 | auto (Flash) + Claude 전문가 | 470 | 0/4/5/3 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 12건 (Flash medium·Claude) |
| 2026-10-27 | #58 | b7d4c4b | Claude 전문가(2차) | 553 | 0/4/8/1 | 100% | 100% | 100% | 0% | - | - | - (Claude) |
| 2026-10-27 | #64 | 3bdf4eb | auto (Flash) + Claude 전문가 | 259 | 0/1/2/1 | 100% | 100% | 100% | 0% | - | - | - (Argon 429로 Flash medium 대체, ❓1은 🟡과 중복) |
| 2026-10-27 | #65 | 269afef | auto (Flash) + Claude 전문가 | 324 | 0/2/3/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 5건 (Flash medium·Claude) |
| 2026-10-27 | #67 | fed50ba | auto (Flash) + Claude 전문가 | 255 | 0/0/8/3 | 100% | 100% | 100% | 0% | - | - | Flash 1건 → Claude가 10건 (Flash medium·Claude) |
| 2026-10-28 | #7 (공개 저장소) | 9580aad | ci (Flash) + Claude 전문가 | 142 | 0/4/10/0 | 100% | 93% | 100% | 0% | 캡처 속 햄찌 모드 옛 이름은 실제 앱 문자열이라 유지 | - | Flash 1건(구조 트리) → Claude가 영어 화면 이름·프라이버시 범위·훅 필요 조건 등 13건 (Flash medium·Claude) |
| 2026-10-28 | #12 | 6a564c2 | ci (Flash) + Claude 전문가 | 37 | 0/1/1/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 CHANGELOG 같은 절 중복·주석 2곳 (Flash medium·Claude) |
| 2026-10-28 | #14 | 98e6c2a | ci (Flash) + Claude 전문가 | 227 | 0/0/4/0 | 100% | 75% | 100% | 25% | apt 캐시는 허용 액션 밖·효과 작음 | - | Flash 0건 → Claude가 린트 잡의 불필요한 sidecar 빌드·릴리스 캐시 기대치 등 4건 (Flash medium·Claude) |
| 2026-10-28 | #16 | cca88e7 | ci (Flash) + Claude 전문가 | 219 | 1/1/1/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 Linux 배포 추가 방식 9가지 놓침(🔴)·문서 과장·프리릴리스 비교 (Flash medium·Claude) |
| 2026-10-28 | #18 | 138341d | rust (Flash) + Claude 전문가 | 90 | 0/0/1/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 같은 16진 변환 두 곳(공용으로) 1건 (Flash medium·Claude) |
| 2026-10-28 | #20→#21 | 565d4d7 | ci (Flash) + Claude 전문가 | 89 | 0/3/4/0 | 100% | 86% | 100% | 14% | 목록 빈 줄은 원래 형식 | - | Flash 0건 → Claude가 릴리스 본문 #번호 오링크·tokio 보안 근거·브랜치 이름이 release-prep 태그 잡에 걸림 등 7건 (Flash medium·Claude) |
| 2026-10-28 | #23 | 85d785f | ci, security (Flash) + Claude 전문가 | 111 | 0/1/3/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 다리 버전 Latest 누락 시 조용히 끊김(🟡)·주석·리다이렉트 호스트·정리 시점 (Flash medium·Claude) |
| 2026-10-28 | #26 | 5f022e0 | ci (Flash) + Claude 전문가 | - | 0/2/4/0 | 100% | 100% | 100% | 0% | 한국어 창 제목은 사용자 스크린샷과 같음 | - | Flash 0건 → Claude가 `**[완료]**를` 굵게 깨짐·남은 옛 문구 등 6건 (Flash medium·Claude) |
| 2026-10-28 | #28 | 96020b7 | ci, security (Flash) + Claude 전문가 | - | 0/4/6/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 umask가 빌드 전체에 걸림·pipefail 거짓 실패·dmg 미공증 등 (Tauri 소스로 확인) (Flash medium·Claude) |
| 2026-10-28 | #30 | f28e582 | ci, security (Flash) + Claude 전문가 | - | 0/4/5/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 업데이터 키 유출 시 회전 가능(재설치 불필요)·인증서 폐기 영향·API 키 범위·"경고 없이" 과장 등 (Flash medium·Claude) |
| 2026-10-28 | #32 | e37bfff | ci (Flash) + Claude 전문가 | - | 0/1/2/0 | 100% | 67% | 100% | 0% | 지난 0.4.1 노트 문구는 이력이라 유지 | - | Flash 0건 → Claude가 병합 뒤 정리 시점·PAT 폐기·남은 '복사' 문구 (Flash medium·Claude) |
| 2026-10-29 | #42 | bf0f0a8 | ci (Flash 렌즈 base+state+platform 자가 시험) + Claude 전문가 | 235 | 0/1/1/0 | 100% | 100% | 100% | 0% | - | - | Flash 렌즈(base)가 복제 경합·문서 누락 2건 → Claude가 Ctrl-C 고아 agy·전역 캐시 충돌·재시도 순서·기본 패스 없음·platform 렌즈·0건 유도 문구 등 (Flash medium·Claude) |
| 2026-10-29 | #39 | ac7b0cb | frontend (Flash) + Claude 전문가 | - | 0/2/8/0 | 100% | 90% | 100% | 10% | 서 있는 고양이 크기는 다른 누를 자리와 겹치지 않게 2배 유지 | - | Flash 0건 → Claude가 Object 프로토타입 키 TypeError·고양이와 👆·현관문 클릭 충돌 등 (Flash medium·Claude) |
| 2026-10-29 | #40 | 844061f | frontend (Flash·Argon 비교) + Claude 전문가 | 436·188 | 0/1/6/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 · Argon 🔵2(깃발 재솟음 = Claude와 같음, 자리 비운 로봇의 배터리·케이블 = Claude가 놓침) · Claude가 턴마다 리셋되는 시간·도구 기준 등 (Flash medium·Argon medium·Claude) |
| 2026-10-29 | #43 | 8760842 | frontend — Flash 1회 vs Flash 렌즈(base+5) + Claude 전문가 | 1회 492 · 렌즈 517 | 0/2/5/0 | 100% | 100% | 100% | 0% | 렌즈 오탐 3(mkEl 인자·인라인 높이·하품 1프레임) + 질문 1(neck 메타, 문제 없음), 모두 data 렌즈 | - | Flash 1회 0건 · 렌즈 5건 중 실제 1(퇴근 연출 문어 다리 = Claude와 같음) · Claude 🟡2(+도감 오염)·🔵5 (Flash medium·Claude) |
| 2026-10-29 | #45 | e34b8e5 | frontend — Flash 1회 vs Flash 렌즈(base+5, data 규칙 조임) + Claude 전문가 | 1회 273 · 렌즈 617 | 0/3/9/0 | 100% | 100% | 92% | 0% | 렌즈 오탐 1(점검 몸짓 x 누적 — placeActor가 매 프레임 다시 씀) | - | Flash 1회 1건(비둘기 날아가기 생략 = Claude가 놓침) · 렌즈 6건 중 실제 4+중복 1(비둘기·청소 재개 층(3렌즈)·우산 툴팁·매 프레임 탐색) · Claude 🟡2·🔵7 (Flash medium·Claude) |
| 2026-10-29 | #44 | f8ba129 | ci (Flash) + Claude 전문가 | - | 0/1/3/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 측정 기록과 metrics 불일치·계획 줄 정리·공통 규칙 안 (Flash medium·Claude) |
| 2026-10-29 | #33 | 2dba0b6 | frontend (Flash) + Claude 전문가 | - | 0/0/2/0 | 100% | 100% | 100% | 0% | - | - | Flash 0건 → Claude가 아주 좁을 때 제목 한 글자만 남음·툴팁 (Flash medium·Claude) |
| 2026-10-29 | #34 | feb0721 | auto (Flash) + Claude 전문가 | 309 | 1/4/9/0 | 100% | 86% | 93% | 7% | Windows explorer는 .html을 기본 브라우저로 엶(오탐) | - | Flash가 문서 누락·방어 코드 → Claude가 Windows cp1252 인코딩(🔴)·WebView2 SDK 고지 누락·괄호 검사 등 (Flash medium·Claude) |
| 2026-10-29 | #46 | 6d13b73 | auto (Flash 기본+렌즈 5) + Claude 전문가 | 401 | 0/2/5/0 | 100% | 100% | 100% | 0% | - | - | Flash 6패스 모두 0건(문서·스크립트만 바뀐 PR) → Claude가 단계표·WR_MODEL 설명이 렌즈 기본과 어긋남(🟡2), DRY 출력·CALIBRATION 시간 서술(🔵) (Flash medium 렌즈·Claude) |
| 2026-10-29 | #48 | ab0676a | auto (security → Argon 1회) + Claude 전문가 | 25 | 0/0/3/0 | 100% | 100% | 100% | 0% | - | - | Argon 0건 → Claude가 약한 테스트(slip·abs가 진입 파일 없음으로 통과)를 지적, 강화하다 `../` 항목이 숨김 파일로 조용히 버려지던 것 발견 (Argon medium·Claude) |
| 2026-10-29 | #49 | 3b9c3a8 → b940080 | auto (Flash 1회 → 수정 후 기본+렌즈 5) + Claude 전문가 | 381 / 470 | 0/1/0/0 → 0/0/0/0 | 100% | 100% | 100% | 0% | - | - | Flash 1회가 기념일 한마디 소실(🟡)을 Claude와 같이 찾음, 수정 후 렌즈 6패스 0건. Claude가 말풍선 3개 겹침(🟡)·커피 조건·m 정규화(🔵) 추가 (Flash medium·Claude) |
| 2026-10-29 | #52 | 첫 커밋 | auto (Flash 기본+렌즈 5) + Claude 전문가 | 189 | 0/2/4/0 | 100% | 100% | 100% | 0% | - | - | Flash 6패스 0건(문서 PR) → Claude가 README 문구와 실제 규칙 불일치(깃발 100·500·1000, 금요일 17시~)를 MODES.md·코드와 대조해 찾음 (Flash medium 렌즈·Claude) |
| 2026-10-29 | #56 | b2cca39 | auto (Flash 기본+렌즈 5) + Claude 전문가 | 208 | 0/0/7/0 | 100% | 86% | 100% | 0% | - | - | Flash 6패스 0건(문서 PR) → Claude가 연출은 라디오·스튜디오 전용, 큰 화면 복귀 ⌘2·우클릭 누락, Dock은 macOS 등 표기 정확도 (Flash medium 렌즈·Claude) |
| 2026-10-29 | #57 | 19f6fb8 | auto (Flash 기본+렌즈 5) + Claude 전문가 | 442 | 0/1/7/0 | 100% | 100% | 100% | 0% | - | - | Flash 6패스 0건 → Claude가 이전 버전 다운그레이드 시 모르는 소품 id로 판이 멈춤(🟡, 0.5.0 코드 대조)·개발 쿼리가 sp 저장·시즌 뒤 한마디·매 프레임 innerHTML 등 (Flash medium 렌즈·Claude) |
| 2026-10-30 | #65 | 첫 커밋 | auto (Flash 기본+렌즈 5) + Claude 전문가 | 255 | 0/0/0/0 → Claude 2/4/6/0 | 100% | 100% | - | 0% | - | - | Flash 6패스 0건 → Claude가 공격 페이지·심볼릭 링크로 외부 통신 차단 우회(🔴, 재현)·루트 밖 파일 노출(🔴, 재현) 등 보안 결함 (Flash medium 렌즈·Claude) |

모델 비교 요약은 [`CALIBRATION.md`](CALIBRATION.md) "Flash 비교". "-"는 반영·토론이 없는 보정 실행이라는 뜻.

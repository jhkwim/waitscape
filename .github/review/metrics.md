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

모델 비교 요약은 [`CALIBRATION.md`](CALIBRATION.md) "Flash 비교". "-"는 반영·토론이 없는 보정 실행이라는 뜻.

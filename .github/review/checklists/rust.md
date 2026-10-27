# 체크리스트: Rust 백엔드 (rust)

대상: `crates/wr-core`, `crates/wr-hook`, `crates/wr-server`, `app/src-tauri`. clippy·rustfmt가 잡는 것은 지적하지 않는다.

## R1. 동등성 (Python `server.py` = 기준)
- [ ] 같은 입력에서 Python과 다른 결과가 나오는 분기: 정렬 기준(안정 정렬·동률 처리), 부동소수 반올림, 시간 파싱(UTC/로컬, `Z`·오프셋·소수 초), 문자열 절단(Python은 **문자(code point)** 단위, Rust `&s[..n]`은 **바이트** 단위 → 멀티바이트에서 panic 또는 길이 차이)
- [ ] Python `dict` 순서·`json.dumps` 형식(공백·`ensure_ascii`)에 기대는 출력(예: wr-hook이 바이트 단위로 같아야 함)
- [ ] 정규식 차이: Python `re`와 Rust `regex`의 `\b`·`\w`(유니코드 기본값 차이), 탐욕/비탐욕, look-around 미지원으로 바꾼 부분의 의미 변화
- [ ] fixture가 그 분기를 실제로 밟는가 — 안 밟으면 "어떤 입력이 차이를 드러내는지" 구체적으로

## R2. panic·오류 처리 (외부 입력 경로)
- [ ] 트랜스크립트·이벤트 JSON·settings.json·HTTP 요청·mode.json에서 오는 값에 `unwrap()`/`expect()`/인덱싱 `[i]`/슬라이싱 `[a..b]`/`as` 캐스트 오버플로
- [ ] 한 줄 파싱 실패가 전체 상태 계산을 멈추는가(그 줄만 건너뛰어야 함)
- [ ] wr-hook은 **항상 exit 0** 이어야 함(훅 실패가 Claude Code 작업을 막으면 안 됨) — 모든 오류 경로 확인
- [ ] HTTP 핸들러 panic이 서버 스레드를 죽이는가

## R3. 파일 증분 읽기
- [ ] 오프셋 캐시: 파일 크기가 줄면 처음부터, 같은 크기로 교체(회전) 감지(inode/mtime), 불완전한 마지막 줄은 다음 읽기로 보류(오프셋을 줄 끝까지만 전진)
- [ ] 잘못된 UTF-8 → `from_utf8_lossy` 또는 줄 건너뛰기(panic·전체 실패 금지)
- [ ] 거대한 한 줄(수십 MB)·거대한 파일: 읽기 상한, 메모리 상한
- [ ] 캐시(세션·트랜스크립트·trace) 상한(LRU) — 오래 켜 두면 무한히 커지는가
- [ ] 심볼릭 링크·권한 없는 파일·사라진 파일(경합) 처리

## R4. 시간·상태 기계
- [ ] 시계 주입(테스트용 `now`)을 우회해 `SystemTime::now()`를 직접 부르는 곳(테스트 결정성 깨짐)
- [ ] 음수 시간차(`now < ts`, 시계 되돌림), `u64` 뺄셈 언더플로(release에서 wrap → 엄청난 경과 시간)
- [ ] 상태 전이: done/needs_input/stall 판정 경계값(2분/5분/10분, 6시간 STALE), 훅 우선 병합(최근 10분)
- [ ] 토큰 합산: 메시지 id 중복 제거, 서브에이전트 포함 범위

## R4-1. 집계 누락 패턴 (보정 v2 — 실제로 놓쳤던 종류)
- [ ] 루프 안의 **조기 `continue`/`return`이 그 뒤의 누적(`extend`, `+=`, `merge`, `push`)까지 건너뛰는가** — 화면 목록에서 빼려는 항목이 합계(토큰·완료 수·오늘 집계)에서도 빠지는지 줄 단위로 확인
- [ ] 같은 집계 필드(오늘 집계·세션 토큰 등)가 **소스 모드별(Hooks / Transcript / Auto) 경로에서 각각 어떻게 계산되는지** 대조 — 한 경로에만 있는 조건이 다른 경로에서 메워지는지
- [ ] 한 번 켜지면 다시 꺼지지 않는 플래그와, 그 플래그로 처리 경로를 고정하는 분기(세션 재개·재시작 시나리오)
- [ ] 시계 주입(`now` 인자)과 섞인 `Instant::now()`/`SystemTime::now()` — 캐시 만료가 실제 시계로 돌면 테스트·재생 결정성이 깨짐

## R5. 동시성 (wr-server·앱)
- [ ] `Mutex` 잡은 채 파일 I/O·네트워크(한도 조회) → 전체 요청 정지
- [ ] `lock().unwrap()` poisoning 연쇄 panic
- [ ] 백그라운드 스레드(한도 폴링·파일 감시)의 종료·재시작, 중복 생성

## R6. 마스킹·텍스트
- [ ] 모든 자유 텍스트 필드(prompt, say, note, activity.text, todos, agent desc, trace text/cmd/target)가 `redact()`를 거치는가 — 새로 추가된 필드 포함
- [ ] 순서: redact → 경로 축약 → clip. clip이 문자 경계 안전한가
- [ ] Rust 정규식이 Python 패턴과 같은 범위를 잡는가(`fixtures/fake_secrets.json` 각 종류)

## R7. 한도 조회·네트워크 (`limits`)
- [ ] 외부 요청은 이 모듈 한 곳에서만, 기본 꺼짐, 타임아웃 설정(없으면 스레드 영구 정지)
- [ ] 401/403 중단, 429 `Retry-After` 우선 + 지수 백오프(최대 60분), 응답 크기 상한
- [ ] TLS: `rustls`, 인증서 검증 끄는 옵션 없음
- [ ] 토큰 취급은 `security.md` S1

## R8. HTTP (`wr-server`)
- [ ] `security.md` S2·S3 전부. 추가로: 쿼리 파싱(`since`·`prompt` 숫자 변환 실패 → 400, panic 금지), 응답 헤더(CSP·`X-Content-Type-Options`·`Cache-Control`)가 Python과 같은가
- [ ] 요청 본문·헤더 크기 제한, 느린 클라이언트(슬로로리스)로 단일 스레드 서버가 멈추는가

## R9. 빌드·의존성
- [ ] 새 크레이트: 유지 상태, 기본 기능(`default-features`) 과다, 네트워크·TLS 크레이트가 wr-hook에 끌려 들어가는가(wr-hook은 serde_json만)
- [ ] `build.rs`·proc-macro가 네트워크·파일을 건드리는가
- [ ] `Cargo.lock` 커밋 여부(바이너리라 커밋해야 함), `target/` 무시

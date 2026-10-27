/**
 * GET /daylog 응답 — 퇴근 일보(하루 마감 리포트) 데이터 · Tauri `invoke("get_daylog", { day })`도 같은 본문
 *
 * @since 1.1 (추가만. 코어 전용 — 외부 모드 ctx에는 아직 노출하지 않음 @unstable)
 *
 * 출처: daylog.py `summarize()`(참조 구현) = crates/wr-core/src/daylog.rs · 기준 결과: fixtures/expected/daylog.*.json
 *
 * 규칙
 * - 하루 = **현지 시각 새벽 4시 ~ 다음 날 새벽 4시** (03:59에 끝난 일은 전날, 04:00부터 오늘). `/state`의 `done_today`(자정 기준)와 다를 수 있다.
 * - 시각은 epoch 초, 기간은 초. 텍스트(`project`, `job`)는 서버에서 마스킹(`<REDACTED>`) 후 60자.
 *   화면의 "🙈 프로젝트 이름 숨김"은 프론트가 `project`·`job`을 가린다(데이터는 그대로).
 * - 직원(동물)은 `sid` 해시(core-lib `hash`)로, 프로바이더 색은 `provider`로 정한다.
 * - 일지는 사용자 데이터 폴더(`~/.claude/waiting-room/daylog/<YYYY-MM-DD>.json`)에만 있고 14일 뒤 지워진다. 외부 전송 없음.
 *
 * 요청
 * - `GET /daylog?day=today|yesterday|YYYY-MM-DD` (기본 today. 날짜는 보존 기간 14일 안, 오늘 이전만) → 200 `DayLog`
 *   · 잘못된 날 400 `{ error: "bad-day" }` · 일지를 끈 서버(`WAITING_ROOM_DAYLOG=off`) 404 `{ error: "off" }`
 * - `POST /daylog/seen` 본문 `{ "day": "today" | "yesterday" | "YYYY-MM-DD" }` (`Content-Type: application/json`만, 1KB 이하,
 *   `Origin`/`Sec-Fetch-Site`가 있으면 같은 출처만) → 200 `{ day, seen }` · Tauri `invoke("daylog_seen", { day })`(메인 창만)
 */

export interface DayLog {
  v: 1;
  /** 하루 이름 (YYYY-MM-DD, 4시 경계 기준) */
  day: string;
  /** 요청 시점의 오늘인가 */
  today: boolean;
  /** 그날 04:00 / 다음 날 04:00 (epoch) */
  start: number;
  end: number;
  now: number;
  /** ✅ 완료한 턴 수 (Stop / 트랜스크립트 end_turn) */
  done: number;
  /** ⏱ 총 작업 시간 = 턴 실행 시간 합(초, 세션이 겹치면 더함) */
  work: number;
  /** 🎉 큰 일 (실행 10분 이상, 또는 AI가 MCP 보고로 큰 일이라고 알림 `by_ai`) — 실행 시간 긴 순, 최대 10개 */
  big: DayBigJob[];
  /** 큰 일 전체 개수 (`big`은 10개까지만) */
  big_count: number;
  /** ✍️ AI가 MCP 보고(waitscape_status done + cheer)로 남긴 칭찬 한마디 — 끝난 시각 순, 최근 5개. 텍스트는 마스킹 후 60자.
   *  공유 카드·복사 텍스트에는 기본으로 넣지 않는다(스튜디오 설정에서 켤 때만, 🤫 숨김이면 항상 뺌) @since 1.2 */
  cheers: { sid: string; provider: string; text: string; t: number }[];
  /** 💬 질문에 답하기까지 평균 대기 (진행 중 턴의 입력 필요 → 다음 진행. 훅: Notification → 다음 이벤트, 트랜스크립트: AskUserQuestion·ExitPlanMode → 답). 없으면 avg null */
  wait: { avg: number | null; n: number };
  /** 직원(세션)별 완료 — 완료 수 많은 순, 같으면 일한 시간 긴 순 */
  workers: DayWorker[];
  /** 🏆 MVP = workers[0] */
  mvp: DayWorker | null;
  /** 그날 첫·마지막 활동 (세션 활동·턴·대기 중 가장 이른/늦은 시각) */
  first: number | null;
  last: number | null;
  /** now - last (초) */
  quiet: number | null;
  /** 🌙 막차 = 마지막으로 활동한 세션 */
  last_call: { sid: string; provider: string; project: string; t: number } | null;
  /** 📈 사용 한도 추이 */
  limits: {
    /** 표본 (5분 간격, 정전 시작·끝에 추가). 값은 사용률 %(0–100+), 없으면 null */
    samples: { t: number; five_hour: number | null; five_hour_resets: number | null; seven_day: number | null; seven_day_resets: number | null }[];
    /** ↺ 그날 지나간 5시간 창 리셋 시각 */
    resets: number[];
    /** 주간 사용률 그날 첫 표본 → 마지막 표본 */
    weekly: { from: number; to: number } | null;
    /** 5시간 사용률 최댓값 */
    peak: number | null;
  };
  /** 🕯 정전(5시간 한도 100%) 구간. t1 null = 아직 정전 중 */
  outages: { t0: number; t1: number | null }[];
  outage_count: number;
  /**
   * 일보 준비됨 (퇴근 판정)
   * - 오늘: 완료 1건 이상 + 마지막 활동이 정오(12:00) 이후 + 그 뒤 45분 동안 어느 세션도 활동 없음 → `reason: "quiet"`.
   *   다시 활동하면 false로 돌아가고, 다시 45분 조용하면 새 `ready_at`으로 준비됨(= 갱신된 일보).
   * - 지난 날: 완료가 있으면 준비됨. 마지막 활동 + 45분이 하루 안이면 "quiet", 아니면(오전에만 일함·새벽까지 일함) "day-over"(ready_at = end).
   * - 수동 🏃 퇴근·📋 미리보기·고급 옵션 퇴근 시각은 프론트가 정한다(`quiet`, `last`로 판정 가능).
   */
  ready: boolean;
  ready_at: number | null;
  reason: "quiet" | "day-over" | null;
  /** 이 날 일보를 본 시각 (POST /daylog/seen) */
  seen: number | null;
  /** 준비됐고 아직 안 봤음 (seen이 없거나 ready_at보다 이름 → 다시 활동 후 갱신된 일보도 true) */
  unseen: boolean;
  /** 오늘 요청일 때만: 어제 요약. 다음 날 첫 활동 때 `prev.unseen`이면 "어제 일보"를 띄운다. 다른 날 요청이면 null */
  prev: { day: string; done: number; ready: boolean; ready_at: number | null; seen: number | null; unseen: boolean } | null;
  /** 판정 상수 (화면 안내 문구용) */
  rule: { day_hour: 4; quiet_min: 45; after_hour: 12; big_min: 10; keep_days: 14 };
}

export interface DayBigJob {
  sid: string;
  provider: string;
  /** 프로젝트 폴더 이름 (마스킹) */
  project: string;
  /** 프롬프트 요약 (마스킹, 60자) */
  job: string;
  /** 실행 시간(초) */
  run: number;
  /** 끝난 시각 */
  t: number;
  /** AI가 MCP 보고로 "큰 일"이라고 알림 (10분 미만일 수 있음). 아니면 키 없음 @since 1.2 */
  by_ai?: true;
}

export interface DayWorker {
  sid: string;
  provider: string;
  /** 마지막 턴의 프로젝트 */
  project: string;
  done: number;
  /** 일한 시간(초) */
  work: number;
}

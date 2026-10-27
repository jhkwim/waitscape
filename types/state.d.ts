/**
 * GET /state 응답 — Mode API v1 공개 계약 (state)
 *
 * @version 1.0
 *
 * 출처: server.py `build_state()` (참조 구현) · 기준 결과: fixtures/expected/state*.json
 *
 * 공통 규칙
 * - 시각(`*_ts`, `since`, `started`, `last`, `ended`, `now`, `resets_at`)은 **epoch 초**(소수 허용, UTC 기준 절대 시각).
 *   경과 시간은 `ctx.now() - since`처럼 서버 시계(`now`)로 보정해서 잰다.
 * - 기간(`secs`, `run`, `waited_today`)은 **초**.
 * - 토큰 수는 **개수**(정수).
 * - "?"(optional) = 그 키가 아예 없을 수 있음. "| null" = 키는 있지만 값이 없음. 두 경우를 구분해서 다룬다.
 * - 자유 텍스트(prompt, note, say, activity.text, trail 텍스트, todos.text, agents.desc/say/now.text)는 서버에서
 *   민감 정보 마스킹(`<REDACTED>`)을 거친 값이다. 모드는 추가로 HTML 이스케이프만 하면 된다.
 * - 안정성 표시: 표시가 없으면 **stable**(계약, major 전까지 의미·형식 유지).
 *   `@unstable` = 내장 모드 전용, 예고 없이 바뀔 수 있음. 외부(샌드박스) 모드에는 브리지가 빼고 보낸다.
 *   `@since 1.x` = 그 minor에서 추가됨(Python 참조 서버에는 아직 없음 → 있을 때만 쓰도록 optional).
 * - 버전 정책(ARCHITECTURE.md §4.3): 필드 **추가**는 minor, 제거·의미 변경은 major. 버전은 응답 본문이 아니라
 *   `ctx.host.apiVersion`과 mode.json `apiVersion`으로 주고받는다(그래서 응답에 schema 필드를 넣지 않음).
 */

export const STATE_API_VERSION: "1.0";

/** 세션 상태. "ended"(SessionEnd)와 6시간(STALE) 동안 소식 없는 세션은 목록에서 빠지므로 오지 않는다. */
export type SessionStatus =
  /** 이벤트는 있지만 아직 프롬프트가 없음 (예: SessionStart만) */
  | "idle"
  /** 메인 Claude가 일하는 중 (프롬프트 제출·도구 실행·에이전트 결과로 재개) */
  | "working"
  /** 사용자 입력이 필요함 (훅: Notification. 트랜스크립트 전용: 추정 → `confidence: "guess"`) */
  | "needs_input"
  /** 메인 턴이 끝남. 화면에서는 `Core.sessionStatus()`가 5분 뒤 "idle"로 보여 준다(서버 값은 계속 "done") */
  | "done"
  /** 메인은 멈췄지만(done/idle) 백그라운드 서브에이전트가 아직 실행 중 */
  | "agents";

/** 도구 분류 (hook.py `KINDS`). mcp__* 도구는 "web"으로 센다. 프롬프트 직후에는 "think". */
export type ToolKind = "read" | "edit" | "bash" | "search" | "web" | "agent" | "todo" | "other";

/** 느림/멈춤 의심. 정상이면 null. */
export interface Health {
  /** slow: 모델 응답 2분(SLOW) 또는 도구 하나 2분(TOOL_SLOW) 이상 / stall: 모델 5분(STALL) 또는 도구 10분(TOOL_STALL) 이상 */
  level: "slow" | "stall";
  /** 오래 걸리는 도구 이름(실행 중인 도구 중 가장 오래된 것). 모델 응답 대기면 null */
  tool: string | null;
  /** 조용했던 시간 또는 도구 실행 시간 (초) */
  secs: number;
}

/** 토큰 합계 (트랜스크립트 usage를 메시지 id로 중복 제거). */
export interface Tokens {
  /** 새 입력 = input_tokens + cache_creation_input_tokens */
  new: number;
  /** 캐시 읽기 = cache_read_input_tokens */
  cached: number;
  /** 출력 = output_tokens */
  out: number;
  /** 화면 표시값 = new + out (cached 제외) */
  total: number;
}

/** 최근 도구 활동 한 줄 (훅 PreToolUse 요약). 최대 6개, 오래된 것부터. */
export interface Activity {
  /** 기록 시각 (epoch 초) */
  ts: number;
  /** 도구 아이콘 이모지 (📖 ✏️ 📝 ⚡ 🔍 🌐 🤖 🗒️ 📨 🔌 🔧) */
  icon: string;
  /** 사람이 읽는 요약 ("Login.swift 읽는 중", Bash 설명/명령 60자 등). 마스킹됨 */
  text: string;
}

/** 할 일 하나. TodoWrite면 id 없음, TaskCreate/TaskUpdate면 id 있음. "deleted"는 오지 않는다. */
export interface Todo {
  /** TaskCreate의 작업 id (문자열). TodoWrite 항목에는 없음 */
  id?: string;
  /** 할 일 문구 (진행 중이면 activeForm, 60자). 마스킹됨 */
  text: string;
  status: "pending" | "in_progress" | "completed";
}

/** 서브에이전트 현재 도구 (훅 기준) */
export interface AgentTool {
  icon: string;
  /** 마스킹됨 */
  text: string;
  kind: ToolKind;
}

export interface Agent {
  /** 에이전트 id (훅 agent_id, `subagents/agent-<aid>.jsonl`) */
  aid: string;
  /** subagent_type (예: "Explore", "general-purpose"). 모르면 "agent" */
  type: string;
  /** Agent 도구 호출의 description (50자). 모르면 "". 마스킹됨 */
  desc: string;
  /** run_in_background 요청 여부 (참고용. Claude Code가 bg 없이도 백그라운드로 돌릴 수 있어 신뢰도 낮음) */
  bg: boolean;
  status: "running" | "done";
  /** 시작 시각 (epoch 초) */
  since: number;
  /** 끝난 시각 (epoch 초). status가 "done"일 때만 */
  ended?: number;
  /** true면 SubagentStop 없이 마지막 활동(훅·트랜스크립트 중 늦은 것)이 6시간(STALE) 넘게 지나 끝난 것으로 처리됨. 이때 ended = 마지막 활동 시각 */
  stale?: boolean;
  /** 이 에이전트의 도구 호출 수 */
  tools: number;
  /** 지금(마지막) 도구. 아직 없으면 null */
  now: AgentTool | null;
  /** 최근 도구 최대 3개 (오래된 것부터, 마지막 항목 = now) */
  recent: AgentTool[];
  /** 마지막 훅 이벤트 시각 (epoch 초) */
  last: number;
  /** 토큰 합계(new + out). 세션 마지막 이벤트가 오늘(로컬 자정 이후)일 때만 계산되므로 없을 수 있음 */
  tokens?: number;
  /** 트랜스크립트의 마지막 발화 (160자, 마스킹됨). tokens와 같은 조건 */
  say?: string;
  /** 실행 중이고 트랜스크립트 파일이 있을 때만 키가 생김 */
  health?: Health | null;
}

export interface Session {
  /** 세션 id (Claude Code session_id) */
  sid: string;
  /** cwd의 마지막 폴더 이름. 모르면 "?" */
  project: string;
  status: SessionStatus;
  /** 현재 status가 시작된 시각 (epoch 초) */
  since: number;
  /** 지금 턴(프롬프트)이 시작된 시각. 턴이 끝나면(done) null */
  started: number | null;
  /** 마지막 프롬프트 요약 (훅 60자, 마스킹됨). 없으면 "" */
  prompt: string;
  /** 마지막 Notification 문구 (80자, 마스킹됨). 한 번 생기면 이후 status가 바뀌어도 남는다. 없으면 키 없음 */
  note?: string;
  /** 이번 턴의 도구 호출 수 (메인만) */
  tools: number;
  /** 이번 턴 토큰 (메인 + 서브에이전트, 마지막 프롬프트 이후). 트랜스크립트가 없거나 마지막 이벤트가 오늘이 아니면 키 없음 */
  tokens?: Tokens;
  /** 컨텍스트 사용률 % (statusline 탭이 있을 때만 값, 없으면 null) */
  ctx: number | null;
  /** 할 일 목록 (없으면 []) */
  todos: Todo[];
  /** 서브에이전트 (since 오름차순). 새 프롬프트 때 끝난 에이전트는 정리됨 */
  agents: Agent[];
  /** 최근 도구 활동 최대 6개 */
  activity: Activity[];
  /** status가 "working"이고 tokens 조건을 만족할 때만 키가 생김. 정상이면 null */
  health?: Health | null;
  /** 메인의 마지막 발화 (160자, 마스킹 → 절단). health와 같은 조건 */
  say?: string;
  /** 세션 출처 (P1 트랜스크립트 전용 엔진에서 추가). 없으면 "hook"으로 간주 @since 1.1.
   *  "mcp" = 훅이 없는 AI CLI(Codex·Gemini 등)가 MCP 도구로 보고해 생긴 세션 (sid = 사이드카 세션 키, tools·todos·agents는 비어 있음) @since 1.2 */
  source?: "hook" | "transcript" | "mcp";
  /** status 판정의 확실성. "guess" = 트랜스크립트 전용 추정(예: 입력 필요일 수도). 없으면 "sure" @since 1.1 */
  confidence?: "sure" | "guess";

  /** 이 세션을 만든 AI 코딩 도구 id (State.providers[].id). 없으면 "claude" @since 1.1. MCP 세션은 "codex" | "gemini" | "other" */
  provider?: string;
  /** @unstable AI가 MCP 도구(waitscape_status·waitscape_board)로 직접 보고한 내용. 보고 읽기가 켜져 있고 보고가 있을 때만.
   *  외부(샌드박스) 모드에는 브리지가 뺀다(AI 원문을 외부 코드에 넘기지 않음) @since 1.2 */
  report?: Report;
  /** @unstable 도구 종류별 횟수 (이번 턴) */
  kinds: Partial<Record<ToolKind, number>>;
  /** @unstable 마지막 도구 종류. 프롬프트 직후 "think". 프롬프트가 없었으면 키 없음 */
  kind?: ToolKind | "think";
  /** @unstable 이번 턴 도구 기록 [kind, icon, text] 최대 300개 (리플레이용). text는 마스킹됨 */
  trail: [ToolKind, string, string][];
  /** @unstable 직전에 끝난 턴의 소요 시간 (초). 아직 없으면 0 */
  run: number;
  /** @unstable 마지막 훅 이벤트 시각 (epoch 초) */
  last: number;
  /** @unstable 마지막 프롬프트 시각 (epoch 초). 프롬프트가 없었으면 키 없음 */
  prompt_ts?: number;
  /** @unstable 작업 폴더 절대 경로 — 개인정보. 외부 모드에는 주지 않는다(project만) */
  cwd: string;
  /** @unstable 이 세션으로 바로 이동할 정보. 멀티플렉서(세션이 도는 터미널 앱)에서 연 세션일 때만. 외부 모드에는 브리지가 뺀다 @since 1.3 */
  jump?: Jump;
}

/** 세션으로 이동할 정보 (@since 1.3 @unstable). 서버가 어댑터 표(wr-core `term.rs`)로 다시 검증한 값만 */
export interface Jump {
  /** 멀티플렉서 자리. kind는 "cmux" · "orca"(@since 1.4) (늘어날 수 있음 — 모르는 kind는 무시).
   *  cmux: 워크스페이스·패널 ID = UUID 또는 짧은 참조("workspace:2", "surface:5").
   *  orca: `surface` = 터미널 핸들("term_" + UUID 등, Orca를 다시 켜면 바뀔 수 있음), `path` = worktree 절대 경로(선택) */
  mux?: { kind: string; workspace: string; surface?: string } | { kind: "orca"; surface: string; path?: string };
}

/** AI가 MCP 도구로 직접 보고한 내용 (@since 1.2 @unstable). 문자열은 서버에서 제어·양방향·제로폭 문자 제거 → 마스킹 → 절단을 거친 값.
 *  모드는 HTML 이스케이프만 하고 링크·마크다운으로 해석하지 않는다. Claude 세션은 상태·말풍선은 훅 그대로, 이 값은 보드·단계 칸용. */
export interface Report {
  source: "mcp";
  /** 마지막 보고 시각 (epoch 초) */
  ts: number;
  /** 마지막 waitscape_status의 state. Claude 세션에서는 참고용(세션 status는 훅이 정함) */
  state?: "working" | "asking" | "done";
  /** 지금 하는 일 / 질문 (≤60자). 제목 없이 온 보고는 직전 제목을 이어 씀 */
  title?: string;
  /** 단계 (1 ≤ step ≤ total ≤ 99일 때만 둘 다 있음) */
  step?: number;
  total?: number;
  /** AI가 쓴 화이트보드 (≤4줄 × 32자). done = 끝난 줄 번호(0부터, 오름차순) */
  board?: { lines: string[]; done: number[]; ts: number };
  /** 방금 끝난 일이 큰 일이라고 AI가 알림 (state=done + big, 그 뒤 10분 동안만) */
  big?: { title: string; ts: number };
  /** state=done 때 AI가 남긴 칭찬 한마디 (≤60자). 스튜디오는 big일 때 사장님 축하 말풍선에, 일보(`DayLog.cheers`)에도 남는다. 공유 카드에는 기본으로 넣지 않는다 */
  cheer?: string;
}

/** 사용 한도 창 하나 (statusline rate_limits 또는 사용량 API를 같은 모양으로 변환) */
export interface LimitWindow {
  /** 사용률 % (0–100, 소수 가능) */
  used_percentage: number;
  /** 리셋 시각 (epoch 초). 모르면 null */
  resets_at: number | null;
}

export interface Limits {
  /** 5시간 창 */
  five_hour?: LimitWindow;
  /** 주간 창 */
  seven_day?: LimitWindow;
  /** 추가 사용(extra usage) 한도 */
  spend_limit?: LimitWindow;
  /** statusline 원본을 그대로 넘기므로 다른 키가 올 수 있음 (모드는 위 세 키만 쓸 것) */
  [k: string]: LimitWindow | undefined;
}

export interface State {
  /** 서버 현재 시각 (epoch 초). 클라이언트 시계 보정 기준 */
  now: number;
  /** 보이는 세션 (sid 오름차순) */
  sessions: Session[];
  /** 오늘(로컬 자정 이후) 끝난 턴들의 소요 시간 합 (초). 진행 중인 턴은 포함 안 함(Core.summary가 더함) */
  waited_today: number;
  /** 오늘 끝난 턴 수 */
  done_today: number;
  /** 오늘 도구 종류별 호출 수 (메인 + 서브에이전트) */
  today_kinds: Partial<Record<ToolKind, number>>;
  /** 오늘 시작된 서브에이전트 수 */
  today_agents: number;
  /** 오늘 토큰 합계 (오늘 이벤트가 있는 세션의 트랜스크립트 중 오늘 메시지만) */
  today_tokens: Tokens;
  /** 사용 한도. 출처가 없으면 null. 창별로 최댓값·최신 창만 남긴 값: 같은 창(`resets_at`) 안에서 사용률은 줄지 않고, 이미 지난 창은 빠진다 (오래된 세션의 보고로 깜빡이지 않음) */
  limits: Limits | null;
  /** limits를 받은 시각 (epoch 초). 없으면 null */
  limits_ts: number | null;
  /** limits 출처: 직접 조회(poll)가 statusline보다 최근이면 "poll" */
  limits_src: "poll" | "statusline";
  /** 사용 한도 직접 조회 상태 */
  poll: {
    /** 직접 조회가 켜져 있나 (기본 꺼짐) */
    on: boolean;
    /** 마지막 조회 실패 사유 코드 (예: "HTTP 429", "TimeoutError"). 토큰 등 민감 정보는 절대 넣지 않음. 성공·미조회면 null */
    err: string | null;
  };
  /** 훅 설치 상태 (P1 병합 엔진에서 추가) @since 1.1 */
  hooks?: {
    installed: boolean;
    /** 마지막 훅 이벤트 이후 초. 이벤트가 없으면 null */
    last_event_age: number | null;
  };
  /** 코어(core.js)가 걸러 낸 세션 수. 걸러 낸 게 없으면 키 없음. 백엔드 응답에는 없고 모드가 받는 state에만 붙는다 @since 1.1 */
  hidden?: {
    /** 활성이 아니라서 접어 둔 세션 수 (작업 중·입력 필요·멈춤 의심·서브에이전트 실행 중이 아니고 끝난 지 `recentMinutes`분 넘음). "+N개 숨김"으로 펼침 */
    n: number;
    /** 숨길 프로젝트(플러그인 내부 세션·사용자 패턴)라서 뺀 세션 수 */
    project: number;
  };
  /** 화면에 나오는 AI 코딩 도구 목록 (P1 프로바이더 구조에서 추가). 없으면 Claude Code 하나뿐 @since 1.1 */
  providers?: Provider[];
  /** @unstable MCP 보고 연결 상태 (보고 읽기가 켜져 있을 때만) @since 1.2 */
  mcp?: {
    /** 마지막 보고(훅 report 이벤트·reports.jsonl의 status/board) 이후 초. 보고가 없으면 null */
    last_report_age: number | null;
  };
}

/** 프로바이더 = 세션을 만든 AI 코딩 도구 (예: "claude", "codex", "gemini"). @since 1.1 */
export interface Provider {
  /** 세션의 `provider` 값과 같음 */
  id: string;
  /** 화면 표시 이름 (예: "Claude", "Codex") */
  name: string;
  /** 선택: 이모지 아이콘. 없으면 Core.provider()가 기본값을 고름 */
  icon?: string;
  /** 이 도구가 제공하는 기능. 키가 없으면 false로 본다(Claude는 데이터가 없을 때 전부 true). 없는 기능의 UI는 모드가 숨긴다 */
  capabilities: Partial<Record<ProviderCapability, boolean>>;
}
/** subagents: agents[] · hooks: 정확한 입력 필요/할 일 · limits: 사용 한도 · todos: todos[] · thinking: 생각 단계/think · trace: /trace 흐름 기록 · tokens: 토큰 합계
 *  · report: AI가 MCP 도구로 직접 보고(session.report) @since 1.2 */
export type ProviderCapability = "subagents" | "hooks" | "limits" | "todos" | "thinking" | "trace" | "tokens" | "report";

/**
 * GET /trace?session=<sid>&prompt=<번호|last>&since=<cursor> 응답 — Mode API v1 공개 계약 (trace)
 *
 * @version 1.0
 *
 * 출처: server.py `build_trace()`, `tr_scan()`, `tr_phases()`, `_pub()` · 기준 결과: fixtures/expected/trace.*.json
 * 권한: mode.json `needs: ["trace"]`인 모드에만 `ctx.api.trace()`로 제공한다.
 *
 * 공통 규칙 (state.d.ts와 같음)
 * - 시각 `t*`, `now`, `cut`은 epoch 초(소수), `dur_ms`만 밀리초.
 * - 텍스트는 마스킹(`<REDACTED>`) → 홈 경로 `~` 축약·cwd 상대화·스크래치패드 경로 `scratch/` 축약 → 공백 정리 → 길이 절단 순서로 가공됨.
 * - Step의 optional 필드는 **값이 없으면 키 자체가 빠진다**(null·""·[]·false를 보내지 않음. 단 `ok: false`는 보냄).
 * - 응답 크기: steps는 최근 600개(TRACE_MAX)까지, 그 앞은 `older.bins`로 레인·분 단위 요약.
 * - 증분: 이전 응답의 `cursor`를 `since`로 주면 그 뒤에 생기거나 바뀐 단계만 온다(`full: false`).
 *   cursor 형식 "<gen>.<prompt>.<v>" — gen(캐시 세대)이나 prompt가 다르면 전체(`full: true`)를 다시 보낸다.
 *   v는 구현 내부 카운터라 값 자체에 의미를 두지 말 것(불투명 문자열로 다룬다).
 */

export const TRACE_API_VERSION: "1.0";

/** 단계(phase): 서버가 판정 후 앞뒤 5단계 다수결로 보정. 이해 → 탐색 → 계획 → 수정 → 검증 → 위임 → 보고 */
export type Phase = "understand" | "explore" | "plan" | "edit" | "verify" | "delegate" | "report";

/** 발화 성격 (문구 휴리스틱). 해당 없으면 "note" */
export type Claim = "conclusion" | "hypothesis" | "decision" | "check" | "note";

/** 도구 행동 종류 */
export type Act = "read" | "edit" | "run" | "search" | "agent" | "web" | "plan" | "other";

interface StepBase {
  /** 레인 id: "main" 또는 에이전트 id */
  lane: string;
  /** 레인 안 순번 (0부터, 그 트랜스크립트 전체 기준이라 요청 중간부터 시작할 수 있음) */
  s: number;
  /** 기록 시각 (epoch 초) */
  t: number;
  phase: Phase;
}

/** 도구 호출 */
export interface ToolStep extends StepBase {
  kind: "tool";
  /** 도구 이름 (40자) */
  tool: string;
  /** 대상 요약: 파일 경로·Bash 설명·검색 패턴·URL 등 (80–100자). 없으면 키 없음 */
  target?: string;
  /** Bash 명령 원문 요약 (100자) — Bash만 */
  cmd?: string;
  /** 다녀간 파일 (Read/Edit 대상, Bash 명령에서 찾은 파일 최대 6개, Grep/Glob path). 없으면 키 없음 */
  files?: string[];
  /** 파일을 바꾸는 호출이면 true. 아니면 키 없음 */
  writes?: true;
  act: Act;
  /** 결과: true 성공 / false 실패. **키 없음 = 아직 실행 중(결과 없음)** */
  ok?: boolean;
  /** 실행 시간 (밀리초). 결과가 왔을 때만 */
  dur_ms?: number;
  /** 실패 메시지 (120자). ok가 false일 때만 */
  err?: string;
  /** Agent/Task 호출이면 서브에이전트 id (결과의 agentId 또는 meta.json으로 연결) */
  aid?: string;
  /** Agent/Task의 subagent_type (40자) */
  atype?: string;
}

/** 발화 (assistant text) */
export interface SayStep extends StepBase {
  kind: "say";
  /** 160자 */
  text: string;
  claim: Claim;
}

/** 속생각 (thinking). 내용이 비어도 20초 이상 생각했으면 단계로 남는다 */
export interface ThinkStep extends StepBase {
  kind: "think";
  /** 160자. 비어 있으면 키 없음(이때 claim도 없음) */
  text?: string;
  claim?: Claim;
  /** 생각한 시간 (밀리초). 0이면 0 */
  dur_ms: number;
}

/** 에이전트 완료 알림 (<task-notification>) — 메인 레인만 */
export interface NotifyStep extends StepBase {
  kind: "notify";
  /** <summary> 내용 (120자). 없으면 "에이전트 소식" */
  text: string;
  /** <task-id> (있을 때만) */
  aid?: string;
}

export type Step = ToolStep | SayStep | ThinkStep | NotifyStep;

export interface MainLane {
  id: "main";
  desc: string;
  type: "main";
  /** 이 요청(프롬프트) 시작 시각 */
  t_start: number;
  /** 마지막 단계 또는 멈춘 시각 */
  t_end: number;
  /** running: 진행 중 / waiting: 메인은 끝났지만 실행 중 에이전트를 기다림 / done: 끝남(지난 요청은 항상 done) */
  status: "running" | "waiting" | "done";
  /** 실패한 도구 수 */
  fail: number;
}

export interface AgentLane {
  /** 에이전트 id */
  id: string;
  /** meta.json description → Agent 호출 description → 에이전트 첫 프롬프트 (80자) */
  desc: string;
  /** agentType 또는 subagent_type. 모르면 "agent" */
  type: string;
  /** 갈라진 메인 단계 번호 (MainLane 단계의 `s`) */
  from: number;
  t_start: number;
  t_end: number;
  /** 메인에 합류한 시각(task-notification 또는 SubagentHandback). 아직이면 null */
  t_join: number | null;
  /** unknown: 트랜스크립트가 아직 없음 */
  status: "running" | "done" | "unknown";
  fail: number;
}

export type Lane = MainLane | AgentLane;

/** 600단계 초과분 요약 (레인 × 1분) */
export interface OlderBin {
  lane: string;
  /** 분 시작 시각 (epoch 초, 60의 배수) */
  t: number;
  /** 단계 수 */
  n: number;
  /** 실패 수 */
  fail: number;
  /** 그 분의 도구 단계 다수 phase. 도구가 없으면 "understand" */
  phase: Phase;
}

export interface Trace {
  session: string;
  /** cwd의 마지막 폴더 이름. 모르면 "?" */
  project: string;
  /** 서버 현재 시각 */
  now: number;
  /** 요청(프롬프트) 목록, 최근 30개. text 80자 */
  prompts: { i: number; t: number; text: string }[];
  /** 지금 보여 주는 요청 */
  prompt: {
    i: number;
    t: number;
    /** 400자 (슬래시 명령은 "/이름 인자") */
    text: string;
    /** 마지막 요청인가 */
    last: boolean;
    /** 다음 요청 시각. 마지막이면 null */
    t_next: number | null;
  };
  /** 다음 증분 요청에 since로 줄 불투명 문자열 */
  cursor: string;
  /** true면 steps가 이 요청의 전체(최근 600개), false면 since 이후 바뀐 것만 */
  full: boolean;
  /** 첫 항목은 항상 MainLane */
  lanes: [MainLane, ...AgentLane[]];
  /** 시각 오름차순 */
  steps: Step[];
  /** 600단계를 넘었을 때만 */
  older: { cut: number; bins: OlderBin[] } | null;
  /** 이 요청의 전체 단계 수 (모든 레인, 요약된 것 포함) */
  total: number;
}

/** 오류 응답. bad-session은 HTTP 400, no-transcript는 200 */
export type TraceError =
  /** 세션 id 형식 위반 (^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$) */
  | { error: "bad-session" }
  /** 트랜스크립트 파일을 찾지 못함 */
  | { session: string; error: "no-transcript" };

export type TraceResponse = Trace | TraceError;

export interface TraceQuery {
  session: string;
  /** 요청 번호(0부터, 범위 밖이면 가장 가까운 값으로) 또는 "last"(기본) */
  prompt?: number | "last";
  /** 이전 응답의 cursor */
  since?: string;
}

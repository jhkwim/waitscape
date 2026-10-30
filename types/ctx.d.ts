/**
 * Mode API v1 — 모드가 받는 `ctx`, `Core` 순수 함수, `mode.json`, 샌드박스 브리지 메시지의 공식 타입
 *
 * @version 1.0
 *
 * 구현: web/core/core.js(내장 = 신뢰, 메인 문서) · web/sdk/mode-sdk.js(외부 = 샌드박스 iframe) · web/core/bridge-host.js
 * 데이터 계약: ./state.d.ts(ctx.state) · ./trace.d.ts(ctx.api.trace) · 패키지 스키마: ./mode.schema.json
 *
 * 버전 정책 (ARCHITECTURE.md §4.3)
 * - Mode API 버전은 "major.minor"이며 앱 버전과 별개다. 지금 호스트는 1.0.
 * - minor: 필드·함수 **추가**만. major: 제거·의미 변경·형식 변경.
 * - 호환 판정 (`Core.apiCompat`): 모드 mode.json `apiVersion`의 major == 호스트 major 이고 minor <= 호스트 minor면 실행.
 *   모드 minor가 더 크면 "앱 업데이트 필요"로 꺼진다. major가 한 단계 낮으면(N-1) 외부 모드에 한해 브리지 어댑터로 실행(v1에는 해당 없음).
 *   그보다 낮거나 형식이 틀리면 실행하지 않는다. 판정 결과는 설정 화면에 문장으로 보인다.
 * - `@deprecated` 항목은 최소 두 minor 동안 유지하고 쓰면 콘솔 경고 1회. 변경 내역: ./CHANGELOG.md
 *
 * 표기
 * - `@permission x` = mode.json `needs`에 x가 있어야 외부 모드에서 생긴다(없으면 그 속성 자체가 undefined). 내장 모드는 항상 있음.
 * - `@trusted` = 내장 모드에만 있음(외부 모드에서는 undefined).
 * - `@since 1.x` = 그 minor에서 추가됨.
 */

import type { State, Session, Agent, Health, Provider, ProviderCapability } from "./state";
import type { Trace } from "./trace";
import type { DayLog } from "./daylog";

export const MODE_API_VERSION: "1.0";

/* ------------------------------------------------------------------ mode.json */

export type Permission =
  /** ctx.api.trace — 세션 흐름 기록(/trace) 읽기 */
  | "trace"
  /** ctx.memo — 다음 프롬프트 메모 읽기·쓰기 */
  | "memo"
  /** ctx.notify — 알림 보내기 (외부: 분당 6회, 제목 앞에 [모드 이름]) */
  | "notify"
  /** ctx.clipboard.write — 클립보드 쓰기 (외부: 사용자 클릭 직후에만) */
  | "clipboard";

export type Localized = string | { ko?: string; en?: string };

/** 모드 패키지 = 폴더(이름 = id) + mode.json + entry JS (+ CSS, 아이콘, assets/) */
export interface ModeManifest {
  /** ^[a-z0-9][a-z0-9-]{0,31}$ · 폴더 이름과 같아야 함 · 내장 id와 겹치면 거부 */
  id: string;
  /** 표시 이름. 설정 언어로 고름 */
  name: Localized;
  /** 이모지(최대 4글자) 또는 패키지 안 .svg/.png 경로. 없으면 ▫️ */
  icon?: string;
  /** semver (예: "1.2.0") */
  version: string;
  /** 이 모드가 기대하는 최소 Mode API ("major.minor") */
  apiVersion: string;
  /** 기본 "mode.js". 패키지 안 상대 경로(`..`·절대 경로 금지) */
  entry?: string;
  /** CSS 파일들 (최대 8개, 패키지 안 상대 경로) */
  styles?: string[];
  author?: string | { name: string; url?: string };
  description?: Localized;
  license?: string;
  /** 요청 권한. 외부 모드는 켤 때 사용자에게 문장으로 보여 주고 동의를 받는다. 권한이 늘면 다시 동의 */
  needs?: Permission[];
  /**
   * 안내용: 화면이 쓰는 프로바이더 기능 (state.d.ts ProviderCapability). 실행을 막지는 않는다.
   * 프로바이더에 그 기능이 없을 때 해당 UI를 숨기는 것은 모드의 책임 (`Core.can(state, s, "subagents")`) @since 1.0
   */
  uses?: ProviderCapability[];
  /** 모드 안 문구(texts 포함)의 언어. 설정 언어와 다르면 코어는 알림·탭 제목에 기본 문구를 쓴다 */
  locale?: "ko" | "en";
  /** 완료/입력 필요 알림음 파형 */
  chimeWave?: OscillatorType;
  /** 위젯 창으로 띄울 수 있는 모드인가 (v1: 내장만) */
  widget?: boolean;
}

/** 코어가 발견·검증한 모드 (Core.manage.list(), 설정 화면) */
export interface ModeInfo {
  id: string;
  dir: string;
  source: "builtin" | "user" | "dev";
  /** 내장 = true (메인 문서에서 직접 실행) / 외부 = false (샌드박스) */
  trusted: boolean;
  name: string;
  icon: string;
  version?: string;
  apiVersion?: string;
  needs: Permission[];
  uses: ProviderCapability[];
  compat: { ok: boolean; code: "ok" | "bad" | "needs-update" | "adapter" | "too-old" };
  /** 깨진 패키지 사유 (있으면 실행하지 않음) */
  error: string | null;
  enabled?: boolean;
}

/* ------------------------------------------------------------------ registerMode */

export interface ModeTexts {
  done?(s: Session): [title: string, body: string];
  input?(s: Session): [title: string, body: string];
  stall?(x: StallInfo): [title: string, body: string];
  memo?(s: Session, text: string): [title: string, body: string];
  title?(x: { calling: number; working: number; total: number; state: State | null }): string;
}

export interface ModeDefinition {
  /** mode.json id와 같아야 함 */
  id: string;
  /** mount는 인스턴스를 돌려준다. 상태는 mount 클로저 안에(같은 모드가 두 문서에 동시에 뜰 수 있음) */
  mount(root: HTMLElement, ctx: ModeContext): ModeInstance | void;
  /** @trusted 이 모드가 메인 화면일 때 코어 알림·탭 제목 문구 (외부 모드는 함수를 넘길 수 없어 기본 문구) */
  texts?: ModeTexts;
  /** @deprecated mode.json의 name/icon/chimeWave를 쓴다 (호환용으로 무시됨) */
  label?: string;
  icon?: string;
  chimeWave?: OscillatorType;
}

export interface ModeInstance {
  /** 새 state 도착 (http: 1초마다, 앱: 바뀔 때마다 + heartbeat) */
  update?(state: State, ctx: ModeContext): void;
  /** ctx로 만들지 않은 자원만 정리 */
  unmount?(ctx: ModeContext): void;
  /** 🙈 눈치 모드 연출 훅(내장 모드만, 선택 @since 1.6). 없으면 코어가 블라인드만 내린다.
   *  "leave"(긴 연출일 때만): 퇴장 연출을 시작하고 다 나가면 끝나는 Promise(null = 연출 없이 블라인드만, 코어는 15초까지 기다림)
   *  "hide": 블라인드가 다 내려옴(뒤 화면을 비워도 됨) · "arrive": 블라인드가 다 올라감 — long이면 출근 연출, say면 한마디(처음엔 꼭, 이후 약 1/3) */
  nunchi?(ev: "leave" | "hide" | "arrive", opts: { long?: boolean; say?: boolean }): Promise<void> | null | void;
  /** 🙈 눈치 화면 표의 행 순서(sid 배열). 스튜디오 = 층 순서(맨 위층부터). 없으면 입력 대기 → 실행 중 → 완료 @since 1.6 */
  nunchiOrder?(): string[];
  /** 앱 우클릭 메뉴의 제목 줄(그 세션 위에서 열었을 때). 스튜디오 = "🐱 waitscape · 작업 중" — 눈치 모드면 코어가 표 상태로 바꿈 @since 1.6 */
  contextTitle?(sid: string): string | null;
}

/* ------------------------------------------------------------------ ctx */

export interface StallInfo {
  /** 알림 중복 방지 키: sid 또는 sid:aid */
  key: string;
  sid: string;
  project: string;
  agent: Agent | null;
  health: Health;
  session: Session;
}

export interface CoreEvents {
  state: State;
  done: Session;
  input: Session;
  stall: StallInfo;
  "memo-ready": Session;
  /** @permission memo */
  memo: { sid: string; value: string };
  /** 회의 모드·언어·알림 설정이 바뀜 */
  settings: { quiet: boolean };
  /** 메인 화면 모드가 바뀜 */
  mode: string;
}

export interface TraceQuery {
  /** 세션 id ([A-Za-z0-9_-]) */
  session: string;
  /** 요청 번호 또는 "last" (기본) */
  prompt?: number | "last";
  /** 이전 응답의 cursor → 바뀐 단계만 */
  since?: string;
}

export interface HostInfo {
  kind: "http" | "tauri";
  /** 호스트의 Mode API 버전 (예: "1.0") */
  apiVersion: string;
  /** 내장 모드면 true */
  trusted: boolean;
}

export interface ModeContext {
  id: string;
  /** 이 모드 전용 컨테이너 (`display: contents`). DOM 조회는 root 기준 */
  root: HTMLElement;
  /** 모드가 올라간 document/window (외부 모드: iframe 자신의 것). 전역 document/window 대신 쓴다 */
  doc: Document;
  win: Window;
  /** 마지막 state (아직 없으면 null). 외부 모드에는 @unstable 필드(cwd, trail, kinds, kind, run, last, prompt_ts)를 뺀 정제본 */
  readonly state: State | null;
  /** 서버 시계로 보정한 현재 epoch 초 */
  now(): number;
  /** 지금 UI 언어 (설정 → 자동이면 OS/브라우저 언어) */
  readonly lang: "ko" | "en";
  /** 메인 창 mount면 true */
  isMain: boolean;
  host: HostInfo;
  /** 이 모드의 mode.json 요약 */
  info: Partial<ModeInfo> | null;

  /** 코어 이벤트 구독 (unmount 때 자동 해제). 해제 함수 반환 */
  on<K extends keyof CoreEvents>(evt: K, fn: (data: CoreEvents[K]) => void): () => void;
  /** setInterval / setTimeout / rAF 루프(fn이 false면 멈춤) / addEventListener — 모두 unmount 때 자동 정리 */
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
  loop(fn: (ts: number) => boolean | void): () => void;
  listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): () => void;

  settings: {
    /** 회의 모드(무음). 켜지면 코어가 소리를 끄고 body.quiet로 애니메이션을 끈다 */
    readonly quiet: boolean;
    /** @trusted */
    setQuiet?(v: boolean): void;
    /** 🙈 눈치 모드(코어가 업무 화면으로 덮음) @trusted @since 1.6 */
    readonly nunchi?: boolean;
    /** @trusted @since 1.6 */
    setNunchi?(v: boolean): void;
  };
  /** 🙈 눈치 모드 상태 @trusted @since 1.6. phase: off | leaving(퇴장·블라인드 내려옴) | plain(업무 화면) | returning(블라인드 올라감).
   *  바뀔 때 코어 이벤트 "nunchi" { on, phase }. 켜져 있으면 효과음을 내지 말 것(코어 chime은 이미 꺼짐) */
  /** 위젯 창이 숨겨져 있음(미니 보기 → 큰 화면 때 위젯은 파괴하지 않고 숨김). 애니메이션을 멈출 것. 바뀌면 이벤트 "paused" @trusted @since 1.6 */
  readonly paused?: boolean;
  nunchi?: { readonly on: boolean; readonly phase: "off" | "leaving" | "plain" | "returning" };
  /** 브라우저 알림 권한. 외부 모드에서는 항상 { supported: false, canAsk: false } */
  notif: { readonly supported: boolean; readonly granted: boolean; readonly canAsk: boolean; request(): Promise<NotificationPermission | "unsupported"> };

  /** 모드별 저장소 (키 앞에 `mode:<id>:`가 붙음). 외부: 총 256KB, set은 Promise */
  store: { get(key: string, fallback?: string | null): string | null; set(key: string, value: string | null): void | Promise<unknown> };
  /** AudioContext. 내장: 코어 소유(공유) / 외부: iframe 자체, 회의 모드면 suspend */
  audio(): AudioContext | null;
  /** 코어 알림음 (외부: 초당 1회) */
  chime(kind: "done" | "input"): void;
  /** 모드 전환기. 내장은 원하는 자리에 append, 외부는 호스트가 iframe 밖 오른쪽 아래에 띄움(이 요소는 숨겨진 더미) */
  switcher: HTMLElement;
  setMode(id: string): void;
  /** 켜져 있는 모드 목록 (전환기 순서) */
  modes(): { id: string; name: string; label: string; icon: string }[];

  api: {
    /** @permission trace — 흐름 기록. AbortSignal로 취소(외부: 결과만 무시) */
    trace?(q: TraceQuery, signal?: AbortSignal): Promise<Trace>;
    /** @trusted 앱(Tauri) 메인 창에서만: 미니 보기로 전환 — 위젯 창을 열고 큰 창은 숨김 (P3).
     *  실패하면 코어가 이유를 toast로 띄운 뒤 reject하고, 10초 안에 답이 없으면 로그 폴더 안내 toast(@since 1.5) — 모드는 따로 알리지 않아도 된다 */
    openWidget?(modeId: string): Promise<void>;
    /** @trusted 앱(Tauri) 위젯 창에서만: 미니 보기 끝 — 위젯을 닫고 큰 창 복귀(⤢ 크게 보기). `window.close()`도 같은 동작 */
    showMain?(): Promise<void>;
    /** @trusted 앱(Tauri)에서만: 세션 작업 폴더에서 터미널 열기(멀티플렉서 세션이면 그 워크스페이스·패널로 @since 1.3). 안 되면 경로를 클립보드로 복사하고 "unsupported".
     *  터미널 이동을 뺀 빌드(cargo feature `terminal-jump` 끔)에서는 없다 — 있을 때만 버튼을 그린다 */
    openTerminal?(sid: string): Promise<"opened" | "unsupported">;
  };
  /** @permission memo — 다음 프롬프트 메모 (localStorage `memo:<sid>`, 모든 모드 공유) */
  memo?: {
    get(sid: string): string;
    set(sid: string, value: string): void;
    /** 완료 시 메모가 있었으면 true (고치거나 복사하면 false) */
    ready(sid: string): boolean;
    /** 클립보드로 꺼내고 비움 (외부: 클릭 직후에만). ta: 실패 시 select+execCommand용 textarea */
    copy(sid: string, ta?: HTMLTextAreaElement): Promise<boolean>;
  };
  /** @permission notify — 알림 (외부: 분당 6회, 제목 앞에 [모드 이름]) */
  notify?(title: string, body?: string): void | Promise<unknown>;
  /** @permission clipboard */
  clipboard?: { write(text: string): Promise<unknown> };

  /** 순수 함수 묶음 (= window.Core) */
  core: CoreLib;
}

/* ------------------------------------------------------------------ Core 순수 함수 (core-lib.js) */

export interface LimitCalc {
  used: number | null; pace: number | null; over: boolean; low: boolean; wasReset: boolean; reset: number | null;
  eta: number | null; proj: "reset" | "full" | "unused" | "safe" | "eta" | null; shown: boolean; left: number | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  icon: string;
  /** 모든 키가 채워짐: 데이터에 없으면 Claude는 true, 다른 프로바이더는 false */
  capabilities: Record<ProviderCapability, boolean>;
}

export interface CoreLib {
  readonly lang: "ko" | "en";
  hash(s: string): number;
  pick<T>(a: T[]): T;
  esc(s: unknown): string;
  /** "7:01" / "1시간 3분" (en: "1h 3m") */
  fmt(sec: number): string;
  /** "125k" */
  fmtTok(n: number): string;
  /** "7m 04s" */
  dur(sec: number): string;
  hms(ts: number): string;
  untilText(epoch: number, now: number): string;
  clockText(epoch: number, now: number): string;
  spanText(sec: number): string;
  /** 완료 5분 뒤 "idle" */
  sessionStatus(s: Session, now: number): Session["status"];
  isActive(s: Session): boolean;
  stalls(state: State | null): StallInfo[];
  summary(state: State | null, now: number): { sessions: Session[]; working: Session[]; calling: Session[]; waited: number };
  limitCalc(v: { used_percentage: number; resets_at: number | null } | undefined, win: number, now: number): LimitCalc;
  limits(state: State | null, now: number): { five: LimitCalc; week: LimitCalc; extra: LimitCalc; low: { key: "five" | "week"; left: number; reset: number | null } | null };
  limitNote(state: State, now: number, icons?: { poll?: string; stale?: string }): string;
  /** 세션의 프로바이더(없으면 Claude)와 기능 플래그 */
  provider(state: State | null, s?: Session): ProviderInfo;
  /** 그 세션의 프로바이더가 기능을 제공하나 — 없으면 해당 UI를 숨길 것 */
  can(state: State | null, s: Session, cap: ProviderCapability): boolean;
  /** 멀티플렉서(cmux·Orca)에서 연 세션(`jump.mux`)이면 표시 이름("cmux" | "Orca"), 아니면 "". 이동 버튼은 이 값이 있을 때만 @since 1.6 */
  muxName(s: Session | null | undefined): string;
  /** 세션 목록용 배지 HTML (`<span class="core-provider" data-provider>`). 기본: Claude 하나뿐이면 "" */
  providerBadge(state: State | null, s: Session, opts?: { hideDefault?: boolean; iconOnly?: boolean }): string;
  readonly apiVersion: string;
  apiCompat(v: string, host?: string): ModeInfo["compat"];
}

/** window.Core (메인 문서). 외부 모드의 window.Core는 registerMode + CoreLib + state/now/on만 있다 */
export interface CoreGlobal extends CoreLib {
  registerMode(def: ModeDefinition): void;
  readonly state: State | null;
  now(): number;
  on: ModeContext["on"];
  /** @trusted 이하 */
  setMode?(id: string): Promise<boolean>;
  mount?(id: string, opts: { doc?: Document; root?: HTMLElement; isMain?: boolean }): Promise<{ id: string; ctx: ModeContext; unmount(): void }>;
  store?: { get(k: string, d?: string | null): string | null; set(k: string, v: string): void };
  api?: CoreApi;
}

/* ------------------------------------------------------------------ Core.api (코어 전용 데이터 계층) */

export interface CoreApi {
  kind: "http" | "tauri";
  /** http: /state 1초 폴링 · tauri: invoke("get_state") + listen("state") */
  subscribe(onState: (s: State) => void): () => void;
  trace(q: TraceQuery, signal?: AbortSignal): Promise<Trace>;
  /** @since 1.1 퇴근 일보 하루 집계 (http: GET /daylog · tauri: invoke("get_daylog")). 코어 전용 — 외부 모드 브리지에는 없음 */
  daylog?(day?: "today" | "yesterday" | string): Promise<DayLog>;
  /** @since 1.1 그날 일보를 봤다고 기록 (http: POST /daylog/seen · tauri: invoke("daylog_seen"), 메인 창만) */
  daylogSeen?(day: "today" | "yesterday" | string): Promise<{ day: string; seen: number | null }>;
  /** @since 1.1 tauri 전용(메인 창): 퇴근 일보 카드 PNG를 저장 대화상자로 저장 → 고른 경로, 취소면 null. http에는 없음(브라우저 다운로드) */
  saveImage?(name: string, bytes: Uint8Array): Promise<string | null>;
  /** http: 이 브라우저의 localStorage에만 저장(백엔드는 읽지 않음) */
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<void> };
  notify?(title: string, body: string): void;
  /** [P3] tauri 전용 */
  /** 멀티플렉서(cmux·Orca) 세션이면 그 자리로: mux = 이동, mux-app = 대상이 닫혀(Orca: 터미널을 못 찾아) 앱만 앞으로, mux-launch = (Orca) 꺼져 있어 앱만 띄움(@since 1.4),
   *  mux-off = 앱이 꺼져 있어 cwd 복사, mux-denied = 외부 제어가 막혀(Orca: 응답 없음) cwd 복사(kind = 멀티플렉서) @since 1.3 */
  openTerminal?(sid: string): Promise<{ result: "opened" | "unsupported" | "mux" | "mux-app" | "mux-launch" | "mux-off" | "mux-denied"; kind?: string | null; cwd: string | null }>;
  openWidget?(modeId: string): Promise<void>;
  /** @since 1.5 tauri 메인 창: 앱 로그 폴더(waitscape.log, 진단용) 열기 — 설정 → 일반 → 앱 정보 */
  openLogDir?(): Promise<void>;
  /** tauri 메인 창: 오픈소스 라이선스 고지(THIRD_PARTY_LICENSES.html)를 기본 브라우저로 연다 — 설정 → 일반 → 앱 정보 */
  openLicenses?(): Promise<void>;
  /** 발견된 모드(검증 전 원본) */
  modes(): Promise<{ modes: { dir: string; source: ModeInfo["source"]; manifest: ModeManifest | null; error?: string }[]; userDir: string | null; devDirs: string[] }>;
  brand(): Promise<{ name: string; identifier?: string; tagline?: string }>;
  /** tauri 메인 창: 앱 버전과 빌드 기능(빌드 플레이버, docs/RELEASE.md §8) */
  appInfo?(): Promise<{ version: string; features: { updater: boolean; terminalJump: boolean }; updateReady: boolean }>;
  /** tauri 메인 창: 앱 안 업데이트. 이벤트 `update`(상태)·`update-progress`·`update-show`. install은 성공하면 앱이 다시 시작돼 돌아오지 않는다 */
  update?: {
    status(): Promise<UpdateStatus>;
    check(): Promise<{ result: "available" | "latest" | "unavailable" | "disabled"; status: UpdateStatus }>;
    install(): Promise<void>;
  };
}

/** 코어 내부용(모드 API 아님). `Core.update.available`·`Core.update.open()`은 내장 모드(스튜디오 사장님 말풍선)가 쓴다 */
export interface UpdateStatus {
  compiled: boolean;
  ready: boolean;
  current: string;
  available: { version: string; notes: string; date: string | null } | null;
  phase: "" | "checking" | "downloading" | "installing";
  /** 마지막으로 확인에 성공한 시각(ms). 실패만 했으면 null */
  lastCheck: number | null;
}

export interface AppSettings {
  /** 사용 한도 직접 조회 동의 (기본 false). 실제 조회는 P1/P3 */
  usageLookup: boolean;
  /** 알림 종류별 켜기 */
  notify: { done: boolean; input: boolean; stall: boolean; memo: boolean };
  /** 숨길 프로젝트 패턴 (경로·이름의 일부, 대소문자 무시). 앱에서는 백엔드가 맞는 프로젝트의 트랜스크립트를 스캔하지 않는다 */
  hideProjects: string[];
  /** 알려진 플러그인 내부 세션(claude-mem 관찰자 등) 기본 숨김 (기본 true) */
  hideBuiltin: boolean;
  /** 활성 세션만 보기 (기본 true). false면 끝난 세션도 전부 */
  activeOnly: boolean;
  /** 끝난 세션을 계속 보여 주는 시간 (분, 1–1440, 기본 30) */
  recentMinutes: number;
  /** (앱) 새 버전 확인 — 시작할 때 + 하루 1번 (기본 true). 설치는 늘 사용자가 누를 때만 */
  updateCheck?: boolean;
  /** (앱, 실험) MCP 보고 읽기 — AI가 `wr-hook mcp`로 보낸 보고를 state(`session.report`·`state.mcp`)에 넣음 (기본 false) @since 1.2 */
  mcpReports?: boolean;
  /** 🙈 눈치 모드 켜짐 (기본 false, 다시 켜도 유지). 앱은 OS 알림 문구·창 제목·트레이도 담백하게 @since 1.6 */
  nunchi?: boolean;
  /** (앱) 눈치 모드 전역 단축키 — Tauri 형식(기본: 맥 "Control+KeyQ" = ⌃Q, 그 밖 "Alt+Backquote" = Alt+`, "" = 끔 → 창 안 ⌘1·Ctrl+1·B만). 수식키 1개 이상 + 키 하나, 맥은 Option만·Option+Shift만 불가(macOS 15+ 제한) @since 1.6 */
  /** (앱) 다른 앱을 쓰는 중에도 전역 단축키 쓰기(기본 true). false면 등록만 해제하고 nunchiKey는 그대로. 창 안 ⌘1·Ctrl+1·B와 무관 @since 1.6 */
  nunchiGlobal?: boolean;
  /** 눈치 화면 밝기: "system"(기본, OS를 따름) | "light" | "dark" @since 1.6 */
  nunchiTheme?: "system" | "light" | "dark";
  nunchiKey?: string;
  /** 눈치 모드 연출: false = 짧게(블라인드만, 기본) · true = 퇴장·출근 연출까지(스튜디오) @since 1.6 */
  nunchiLong?: boolean;
}

/* ------------------------------------------------------------------ 샌드박스 브리지 (외부 모드 ⇄ 호스트, postMessage) */

/** 모든 메시지는 { wr: 1, type, ... }. 호스트는 event.source === iframe.contentWindow 인 것만 받는다 (origin은 opaque "null") */
export type FrameToHost =
  | { wr: 1; type: "hello" }
  | { wr: 1; type: "call"; id: number; op: BridgeOp; args?: Record<string, unknown> };

export type BridgeOp =
  | "store.set"     // {key, value|null}      256KB
  | "trace"         // TraceQuery             @permission trace
  | "memo.set"      // {sid, value}           @permission memo
  | "memo.copy"     // {sid}                  @permission memo · 사용자 활성화 필요
  | "notify"        // {title, body}          @permission notify · 분당 6회
  | "clipboard.write" // {text}               @permission clipboard · 사용자 활성화 필요
  | "setMode"       // {id}                   켜진 모드만
  | "key"           // {key: 1-9 | b | B | ,} 호스트 단축키 전달
  | "chime"         // {kind}                 초당 1회
  | "log";          // {text}                 오류 보고 (설정 → 개발)

export type HostToFrame =
  | { wr: 1; type: "init"; mode: { id: string; name: string; version: string; needs: Permission[] }; host: HostInfo; lang: "ko" | "en"; quiet: boolean;
      now: number; state: State | null; memos?: Record<string, { text: string; ready: boolean }>; store: Record<string, string>; modes: { id: string; name: string; icon: string }[] }
  | { wr: 1; type: "state"; state: State; now: number; memos?: Record<string, { text: string; ready: boolean }> }
  | { wr: 1; type: "event"; evt: Exclude<keyof CoreEvents, "state" | "settings">; data: unknown }
  | { wr: 1; type: "settings"; quiet: boolean; lang: "ko" | "en" }
  | { wr: 1; type: "modes"; modes: { id: string; name: string; icon: string }[] }
  | { wr: 1; type: "reply"; id: number; ok: true; result: unknown }
  | { wr: 1; type: "reply"; id: number; ok: false; error: string };

export type { Provider, ProviderCapability };

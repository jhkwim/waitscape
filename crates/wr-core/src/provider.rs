//! 프로바이더(데이터 소스 어댑터) 계약.
//!
//! 프로바이더 하나 = AI 코딩 도구 하나(Claude Code, 나중에 Codex CLI·Gemini CLI 등).
//! 각 프로바이더는 자기 형식(트랜스크립트·훅 로그·사용량 API)을 **증분으로** 읽고 공통 모델(`model.rs`)로 정규화한다.
//! 엔진(`engine.rs`)은 프로바이더 결과를 합치기만 한다(세션 합치기·정렬, 오늘 집계 합산, 한도 선택).
//!
//! 외부(커뮤니티) 프로바이더는 ARCHITECTURE.md "프로바이더 플랫폼" 절의 외부 프로세스 프로토콜로 붙인다(설계만).

use crate::clock::Tz;
use crate::daylog::DayFeed;
use crate::model::{HooksInfo, LimitsBlock, ProviderInfo, Session, Today};
use serde_json::Value;
use std::path::PathBuf;

/// 기능 플래그 (types/state.d.ts `ProviderCapability`). state에는 `{기능: true}` 객체로 나간다.
pub mod cap {
    /// 서브에이전트(병렬 작업자)를 구분해서 보여 줄 수 있음
    pub const SUBAGENTS: &str = "subagents";
    /// 훅(도구 이벤트 push)을 받을 수 있음 → 입력 필요 판정이 정확
    pub const HOOKS: &str = "hooks";
    /// 사용 한도(요금제 창) 조회 가능
    pub const LIMITS: &str = "limits";
    /// 할 일 목록
    pub const TODOS: &str = "todos";
    /// 속생각(thinking) 단계
    pub const THINKING: &str = "thinking";
    /// /trace(흐름 모드) 단계 데이터
    pub const TRACE: &str = "trace";
    /// 토큰 사용량
    pub const TOKENS: &str = "tokens";
    /// AI가 MCP 도구로 직접 보고 (@since 1.2)
    pub const REPORT: &str = "report";
}

/// 프로바이더 호출 맥락: 주입 가능한 시계·시간대·홈 (테스트 결정성)
#[derive(Clone, Debug)]
pub struct Ctx {
    pub now: f64,
    pub tz: Tz,
    /// 텍스트의 홈 경로를 `~`로 줄일 때 쓰는 값
    pub home: String,
}

impl Ctx {
    /// 오늘(로컬 자정) 시작 epoch
    pub fn day_start(&self) -> f64 {
        self.tz.day_start(self.now)
    }
}

/// 감시할 경로 (앱의 파일 감시용). `recursive`면 하위 폴더 포함, `exts`는 관심 확장자(빈 값 = 전부)
#[derive(Clone, Debug, PartialEq)]
pub struct WatchPath {
    pub path: PathBuf,
    pub recursive: bool,
    pub exts: Vec<&'static str>,
}

/// 프로바이더 한 번 읽은 결과
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    pub sessions: Vec<Session>,
    pub today: Today,
    /// 한도를 지원하는 프로바이더만
    pub limits: Option<LimitsBlock>,
    pub hooks: Option<HooksInfo>,
    /// 퇴근 일보 일지로 갈 전이(턴 완료·질문 대기·세션 활동). 엔진이 프로바이더 id를 붙여 `DayLog`에 넣는다
    pub day: DayFeed,
    /// 여러 도구의 세션을 내는 프로바이더(MCP 보고)의 도구별 일지 피드 `(도구 id, 피드)`. 엔진이 `day`와 함께 일지에 넣는다
    pub days: Vec<(&'static str, DayFeed)>,
    /// 세션을 만들지 않는 MCP 보고(Claude 사이드카, 훅이 없을 때의 대체 경로). 엔진이 같은 cwd의 Claude 세션 하나에 붙인다
    pub orphans: Vec<Orphan>,
    /// 마지막 MCP 보고 시각 (`state.mcp.last_report_age`)
    pub report_ts: Option<f64>,
    /// 훅이 설치돼 있거나 훅 이벤트가 있음 → Claude 보고는 훅 경로만 믿고 사이드카 `orphans`는 버린다
    pub hooks_active: bool,
}

/// 붙일 곳을 찾는 MCP 보고 (`Snapshot::orphans`)
#[derive(Clone, Debug, PartialEq)]
pub struct Orphan {
    /// 사이드카 세션 키 (같은 시각일 때 순서용)
    pub key: String,
    pub cwd: String,
    pub ts: f64,
    /// types/state.d.ts `Report`
    pub report: Value,
}

/// /trace 질의 (HTTP 인자 처리 후 값)
#[derive(Clone, Debug, Default)]
pub struct TraceQuery {
    pub session: String,
    /// "" | "last" | 번호
    pub prompt: String,
    pub since: String,
}

/// /trace 응답: HTTP 상태 코드 + 본문
#[derive(Clone, Debug)]
pub struct TraceReply {
    pub status: u16,
    pub body: Value,
}

/// 사용 한도 조회 결과 (프로바이더별 API 클라이언트가 만들어 엔진에 넣는다)
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Polled {
    /// state.d.ts `Limits` 모양. 실패하면 None
    pub limits: Option<Value>,
    /// 성공 시각
    pub ts: f64,
    /// 실패 사유 코드 (토큰 등 민감 정보 없음)
    pub err: Option<String>,
}

pub trait Provider: Send {
    /// id·표시 이름·기능 플래그
    fn info(&self) -> ProviderInfo;
    /// `state.providers`에 내보낼 목록. 기본은 `info()` 하나. 여러 도구의 세션을 내는 프로바이더(MCP 보고)는 지금 보이는 도구들
    fn infos(&self) -> Vec<ProviderInfo> {
        vec![self.info()]
    }
    /// 파일 감시 대상 (앱이 notify로 감시하다가 바뀌면 엔진 tick을 앞당긴다)
    fn watch_paths(&self) -> Vec<WatchPath>;
    /// 세션 발견 + 증분 읽기 + 정규화. 캐시는 프로바이더 안에 둔다.
    fn snapshot(&mut self, ctx: &Ctx) -> Snapshot;
    /// 흐름 모드 단계. 이 프로바이더가 trace를 지원하지 않으면 None
    fn trace(&mut self, _ctx: &Ctx, _q: &TraceQuery) -> Option<TraceReply> {
        None
    }
    /// 사용 한도 조회 결과 반영 (limits 기능이 있는 프로바이더만)
    fn set_polled(&mut self, _p: Polled) {}
    /// 사용 한도 조회가 켜져 있는지 표시만 바꾼다(state.poll.on). 실제 조회는 앱/서버가 한다
    fn set_poll_on(&mut self, _on: bool) {}
    /// 숨길 프로젝트 패턴 (기본 목록 사용 여부 + 사용자 패턴). 맞는 프로젝트의 트랜스크립트는 스캔하지 않는다
    fn set_hide(&mut self, _user: &[String], _builtin: bool) {}
    /// MCP 보고 읽기 켜기·끄기 (앱 설정. 꺼지면 읽지도 내보내지도 않는다)
    fn set_reports_on(&mut self, _on: bool) {}
    /// 캐시 정리 기회 (요청 사이)
    fn gc(&mut self) {}
}

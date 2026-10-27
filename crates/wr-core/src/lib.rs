//! # wr-core — Waitscape 백엔드 코어
//!
//! server.py를 이식한 상태·흐름(trace) 엔진. 데이터 소스는 **프로바이더**(AI 코딩 도구별 어댑터)로 나뉘고,
//! 첫 구현은 Claude Code(`providers::claude`)다.
//!
//! ```no_run
//! let mut engine = wr_core::Engine::from_env();
//! let state = engine.state();                       // = GET /state
//! let trace = engine.trace(&wr_core::TraceQuery { session: "abc".into(), ..Default::default() }); // = GET /trace
//! println!("{}", serde_json::to_string(&state).unwrap());
//! # let _ = trace;
//! ```
//!
//! 공통 모듈: `model`(계약 타입), `redact`/`text`(마스킹·절단), `health`(멈춤 판정), `trace`(단계 보정·600 제한·커서),
//! `limits`(백오프·비밀 래퍼), `clock`(시계·시간대 주입), `paths`(홈·환경), `jsonl`(증분 읽기), `provider`(어댑터 계약),
//! `report`(MCP 보고 정화·접기 — wr-hook 사이드카와 공유), `term`(멀티플렉서 이동 정보: 어댑터 표·env 허용 목록·검증 — wr-hook과 공유), `mcp_config`(Claude Code 연결 명령·권한 규칙).

pub mod binswap;
pub mod clock;
pub mod daylog;
pub mod engine;
pub mod health;
pub mod hide;
pub mod hooks_config;
pub mod jsonl;
pub mod limits;
pub mod mcp_config;
pub mod model;
pub mod modes;
pub mod paths;
pub mod provider;
pub mod py;
pub mod redact;
pub mod report;
pub mod term;
pub mod text;
pub mod trace;

pub mod providers {
    pub mod claude;
    pub mod mcp;
}

pub use clock::{Clock, Tz};
pub use daylog::DayLog;
pub use engine::{DayReply, Engine, EngineConfig};
pub use model::State;
pub use provider::{Ctx, Polled, Provider, TraceQuery, TraceReply};
pub use providers::claude::{config::ClaudeConfig, config::SourceMode, ClaudeProvider};

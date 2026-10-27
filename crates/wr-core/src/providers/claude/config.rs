//! Claude 프로바이더 설정 (경로·소스 모드·한도 조회 플래그). 환경변수는 server.py와 호환(`WAITING_ROOM_*`).

use crate::hide::HideRules;
use crate::paths::{expand_tilde, home_dir, EnvSource};
use std::path::PathBuf;

/// 세션 상태를 무엇으로 정할지
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceMode {
    /// 훅 이벤트만 (server.py와 동일. 동등성 검증용)
    Hooks,
    /// 트랜스크립트만 (fixtures/transcript-only/RULES.md)
    Transcript,
    /// 세션별 병합: 최근 10분 안에 훅 이벤트가 있으면 훅, 아니면 트랜스크립트 (앱 기본값)
    Auto,
}

impl SourceMode {
    pub fn parse(s: &str) -> Option<SourceMode> {
        match s.trim().to_ascii_lowercase().as_str() {
            "hooks" | "hook" => Some(SourceMode::Hooks),
            "transcript" | "transcripts" => Some(SourceMode::Transcript),
            "auto" => Some(SourceMode::Auto),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ClaudeConfig {
    /// Claude 설정 루트: `CLAUDE_CONFIG_DIR` 또는 `~/.claude`
    pub root: PathBuf,
    /// 훅 이벤트 로그 (`WAITING_ROOM_LOG`, 기본 `<root>/waiting-room/events.jsonl`)
    pub log: PathBuf,
    /// statusline 탭 결과 (`WAITING_ROOM_STATUS`, 기본 `<root>/waiting-room/statusline.json`). 없으면 무시
    pub status: Option<PathBuf>,
    /// 트랜스크립트 폴더 (`WAITING_ROOM_PROJECTS`, 기본 `<root>/projects`)
    pub projects: PathBuf,
    /// 훅 설치 여부 판정에 읽는 settings.json
    pub settings: PathBuf,
    /// OAuth 자격증명 파일 (`<root>/.credentials.json`)
    pub credentials: PathBuf,
    pub source: SourceMode,
    /// 사용 한도 조회 켜짐 표시 (`WAITING_ROOM_POLL_USAGE=1`). **기본 꺼짐**. 실제 조회는 `usage` 모듈이 한다.
    pub poll_on: bool,
    /// state에 `source`·`confidence`·`provider`·`hooks`·`providers` 같은 1.1 필드를 넣을지 (Hooks 모드 동등성 검증에서는 끔)
    pub v11_fields: bool,
    /// 숨길 프로젝트 (기본 목록 + `WAITING_ROOM_HIDE`(쉼표 구분) + 앱 설정). `WAITING_ROOM_HIDE_DEFAULTS=0`이면 기본 목록 제외
    pub hide_user: Vec<String>,
    pub hide_builtin: bool,
}

impl ClaudeConfig {
    pub fn hide_rules(&self) -> HideRules {
        HideRules::new(&self.hide_user, self.hide_builtin)
    }
}

impl ClaudeConfig {
    pub fn from_env(env: &dyn EnvSource) -> ClaudeConfig {
        let home = home_dir(env);
        let root = env
            .var("CLAUDE_CONFIG_DIR")
            .map(|p| expand_tilde(&p, &home))
            .unwrap_or_else(|| home.join(".claude"));
        let p = |k: &str, d: PathBuf| env.var(k).map(|v| expand_tilde(&v, &home)).unwrap_or(d);
        let source = env
            .var("WAITING_ROOM_SOURCE")
            .and_then(|s| SourceMode::parse(&s))
            .unwrap_or(SourceMode::Auto);
        ClaudeConfig {
            log: p("WAITING_ROOM_LOG", root.join("waiting-room").join("events.jsonl")),
            status: Some(p("WAITING_ROOM_STATUS", root.join("waiting-room").join("statusline.json"))),
            projects: p("WAITING_ROOM_PROJECTS", root.join("projects")),
            settings: root.join("settings.json"),
            credentials: root.join(".credentials.json"),
            source,
            poll_on: env.var("WAITING_ROOM_POLL_USAGE").as_deref() == Some("1"),
            v11_fields: source != SourceMode::Hooks,
            hide_user: env
                .var("WAITING_ROOM_HIDE")
                .map(|v| v.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
                .unwrap_or_default(),
            hide_builtin: env.var("WAITING_ROOM_HIDE_DEFAULTS").as_deref() != Some("0"),
            root,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn env_compat() {
        let mut e = HashMap::new();
        e.insert("HOME".to_string(), "/Users/alex".to_string());
        e.insert("USERPROFILE".to_string(), "/Users/alex".to_string());
        let c = ClaudeConfig::from_env(&e);
        assert_eq!(c.projects, PathBuf::from("/Users/alex/.claude/projects"));
        assert!(!c.poll_on);
        assert_eq!(c.source, SourceMode::Auto);
        e.insert("CLAUDE_CONFIG_DIR".to_string(), "~/cc".to_string());
        e.insert("WAITING_ROOM_LOG".to_string(), "/tmp/ev.jsonl".to_string());
        e.insert("WAITING_ROOM_SOURCE".to_string(), "hooks".to_string());
        let c = ClaudeConfig::from_env(&e);
        assert_eq!(c.projects, PathBuf::from("/Users/alex/cc/projects"));
        assert_eq!(c.log, PathBuf::from("/tmp/ev.jsonl"));
        assert!(!c.v11_fields);
    }
}

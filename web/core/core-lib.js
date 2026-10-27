/* core-lib — DOM·네트워크를 쓰지 않는 순수 함수 모음 (Mode API v1 `ctx.core`의 함수 부분)
   메인 문서(core.js)와 외부 모드 샌드박스(sdk/mode-sdk.js)가 같은 파일을 쓴다.
   문구가 들어가는 포맷 함수는 현재 UI 언어(setLang)를 따른다. 한국어 출력은 v1 이전과 글자 하나까지 같다. */
(() => {
"use strict";
let lang = "ko";
const W = {  // 포맷 단어
  ko: { soon: "곧", h: "시간", m: "분", d: "일", after: "후", tomorrow: "내일", days: ["일", "월", "화", "수", "목", "금", "토"], dayFmt: (d, w, hm) => `${d}일 ${w}요일 ${hm}` },
  en: { soon: "soon", h: "h", m: "m", d: "d", after: "", tomorrow: "tomorrow", days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], dayFmt: (d, w, hm) => `${w} ${d} ${hm}` },
};
const w = () => W[lang] || W.ko;

/* ---------- 포맷 ---------- */
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = sec => {  // 7:01 / 1시간 3분 (en: 1h 3m)
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  return lang === "en" ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n || 0);
const dur = sec => {  // 1h 05m / 7m 04s / 9s
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
};
const hms = ts => { const d = new Date(ts * 1000); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":"); };
function spanText(sec) {
  const m = Math.max(0, Math.floor(sec / 60)), h = Math.floor(m / 60), d = Math.floor(h / 24), x = w();
  if (lang === "en") return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  return d > 0 ? `${d}${x.d} ${h % 24}${x.h}` : h > 0 ? `${h}${x.h} ${m % 60}${x.m}` : `${m}${x.m}`;
}
function untilText(epoch, now) {
  const m = Math.floor((epoch - now) / 60);
  if (!(m > 0)) return w().soon;
  return lang === "en" ? `in ${spanText(m * 60)}` : `${spanText(m * 60)} 후`;
}
function clockText(epoch, now) {
  const d = new Date(epoch * 1000), n = new Date(now * 1000), x = w();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === n.toDateString()) return hm;
  const tomorrow = new Date(n); tomorrow.setDate(n.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `${x.tomorrow} ${hm}`;
  return x.dayFmt(d.getDate(), x.days[d.getDay()], hm);
}

/* ---------- 세션 ---------- */
// 완료 후 5분 지나면 '대기'로 본다
const sessionStatus = (s, now) => s.status === "done" && now - s.since > 300 ? "idle" : s.status;
const isActive = s => s.status === "working" || s.status === "agents";
// 멈춤 의심 목록: 메인 세션(작업 중) + 실행 중 서브에이전트. key는 알림 중복 방지용
function stalls(st) {
  const out = [];
  for (const s of (st && st.sessions) || []) {
    if (s.status === "working" && s.health && s.health.level === "stall") out.push({ key: s.sid, sid: s.sid, project: s.project, agent: null, health: s.health, session: s });
    for (const a of s.agents || []) if (a.status === "running" && a.health && a.health.level === "stall")
      out.push({ key: s.sid + ":" + a.aid, sid: s.sid, project: s.project, agent: a, health: a.health, session: s });
  }
  return out;
}
function summary(st, now) {
  const ss = (st && st.sessions) || [];
  const working = ss.filter(isActive), calling = ss.filter(s => s.status === "needs_input");
  const live = working.reduce((t, s) => t + (s.started ? now - s.started : 0), 0);
  return { sessions: ss, working, calling, waited: ((st && st.waited_today) || 0) + live };
}

/* ---------- 세션 숨김 (숨길 프로젝트 + 기본은 활성 세션만) ----------
   백엔드(wr-core hide.rs, server.py)도 같은 규칙으로 스캔 자체를 건너뛴다. 여기서는 화면용으로 한 번 더 적용(브라우저 설정·Python 서버 포함) */
// 알려진 플러그인 내부 세션 (wr-core `DEFAULT_HIDE`, server.py `DEFAULT_HIDE`와 같은 목록)
const DEFAULT_HIDE_PROJECTS = [".claude-mem/observer-sessions"];
const DEFAULT_RECENT_MINUTES = 30;
// 영숫자가 아닌 글자는 모두 '-' (Claude Code의 프로젝트 폴더 이름 규칙) → 패턴이 폴더 이름·경로 어디에든 맞음
const normPath = s => Array.from(String(s || "").toLowerCase(), c => /[\p{L}\p{N}]/u.test(c) ? c : "-").join("");
function hideMatcher(user, builtin = true) {
  const pats = [...(builtin ? DEFAULT_HIDE_PROJECTS : []), ...(Array.isArray(user) ? user : [])]
    .map(x => String(x || "").trim()).filter(x => /[\p{L}\p{N}]/u.test(x)).map(normPath);
  return cwd => !!cwd && pats.some(p => normPath(cwd).includes(p));
}
// 지금 보여 줄 만한 세션: 작업 중·입력 필요·멈춤 의심·서브에이전트 실행 중, 또는 끝난 지 minutes분 이내
function isLive(s, now, minutes = DEFAULT_RECENT_MINUTES) {
  if (s.status === "working" || s.status === "needs_input" || s.status === "agents") return true;
  if ((s.agents || []).some(a => a.status === "running")) return true;
  if (s.health && s.health.level === "stall") return true;
  return now - Math.max(s.since || 0, s.last || 0) < minutes * 60;
}
// st에서 숨길 세션을 뺀 새 state와 개수. opts: { hide: [], builtin, activeOnly, minutes, showAll }
// 숨길 프로젝트는 showAll이어도 항상 숨김(설정에서 뺄 때까지). 반환 hidden = { n(활성이 아니라서), project(숨길 프로젝트) }
function filterSessions(st, now, opts = {}) {
  const ss = (st && st.sessions) || [];
  const hide = hideMatcher(opts.hide, opts.builtin !== false);
  const minutes = opts.minutes > 0 ? opts.minutes : DEFAULT_RECENT_MINUTES;
  let project = 0, inactive = 0;
  const kept = [];
  for (const s of ss) {
    if (hide(s.cwd)) { project++; continue; }
    if (opts.activeOnly !== false && !opts.showAll && !isLive(s, now, minutes)) { inactive++; continue; }
    kept.push(s);
  }
  if (!project && !inactive && !(st && st.hidden)) return st;
  return { ...st, sessions: kept, hidden: { n: inactive, project } };
}

/* ---------- 사용 한도 ---------- */
const LIMIT_WINDOWS = { five: ["five_hour", 18000], week: ["seven_day", 604800], extra: ["spend_limit", 0] };
// v: { used_percentage, resets_at }, win: 창 길이(초). 반환값의 proj:
//   "reset"(리셋 시각 지남, 새 값 대기) | "full"(100%) | "unused"(0%) | "safe"(리셋 전 소진 없음) | "eta"(리셋 전 소진 예상, eta=시각) | null
function limitCalc(v, win, now) {
  const reset = (v && v.resets_at) || null;
  const wasReset = !!(reset && reset <= now);  // 지난 값은 의미 없음
  const used = !wasReset && v && v.used_percentage != null ? Math.min(100, Number(v.used_percentage)) : null;
  const elapsed = win && reset ? Math.min(win, Math.max(0, win - (reset - now))) : null;
  const pace = elapsed != null ? elapsed / win * 100 : null;  // 시간 경과로 본 적정 사용량
  const over = used != null && pace != null && used > pace + 5;
  let proj = null, eta = null;
  if (used != null && elapsed > 300 && reset) {
    if (used >= 100) proj = "full";
    else if (used <= 0) proj = "unused";
    else { eta = now + (100 - used) / (used / elapsed); proj = eta >= reset ? "safe" : "eta"; }
  }
  if (wasReset) proj = "reset";
  return { v, win, reset, wasReset, used, elapsed, pace, over, proj, eta,
    low: used != null && used >= 90, left: used == null ? null : Math.max(0, Math.round(100 - used)),
    shown: !!(v && v.used_percentage != null) };
}
// 전체 한도: { five, week, extra, low: 90% 넘은 첫 한도 {key, left, reset} | null }
function limits(st, now) {
  const L = (st && st.limits) || {}, out = { low: null };
  for (const [k, [field, win]] of Object.entries(LIMIT_WINDOWS)) {
    out[k] = limitCalc(L[field], win, now);
    if (k !== "extra" && out[k].low && !out.low) out.low = { key: k, left: out[k].left, reset: out[k].reset };
  }
  return out;
}
// 한도 출처 안내 한 줄 (icons: { poll, stale } 접두사)
function limitNote(st, now, icons = {}) {
  const en = lang === "en";
  if (!st.limits) return en ? "No usage-limit data yet · turn on usage lookup in Settings" : "한도 정보가 아직 없어요 · 설정에서 사용 한도 조회를 켜 주세요";
  if (st.poll && st.poll.on) return (icons.poll || "") + (en
    ? `Checked every 5 min · updated ${spanText(now - st.limits_ts)} ago` + (st.poll.err ? ` · last check failed (${st.poll.err})` : "")
    : `5분마다 직접 조회 · ${spanText(now - st.limits_ts)} 전 갱신` + (st.poll.err ? ` · 마지막 조회 실패 (${st.poll.err})` : ""));
  // 한도를 주는 프로바이더 이름 (state.providers가 없으면 Claude Code)
  const by = ((st.providers || []).find(p => p && p.capabilities && p.capabilities.limits) || {}).name || "Claude Code";
  return now - st.limits_ts > 120 ? (icons.stale || "") + (en
    ? `As of ${spanText(now - st.limits_ts)} ago · refreshes when ${by} sends its next request`
    : `${spanText(now - st.limits_ts)} 전 기준 · ${by}가 다음 요청을 보내면 갱신돼요`) : "";
}

/* ---------- 프로바이더 (Claude Code 외 AI 코딩 도구; state.providers·session.provider는 @since 1.1 예정, 없으면 Claude) ---------- */
const CAPS = ["subagents", "hooks", "limits", "todos", "thinking", "trace", "tokens"];
const KNOWN = {  // 아이콘·이름 기본값 (state.providers가 이름을 주면 그쪽이 우선)
  claude: { name: "Claude", icon: "✳️" }, codex: { name: "Codex", icon: "🧩" }, gemini: { name: "Gemini", icon: "♊" },
};
// provider(state, session?) → { id, name, icon, capabilities: { subagents, hooks, limits, todos, thinking, trace, tokens } }
// 기능 플래그가 데이터에 없으면 Claude는 모두 true(현행 동작), 그 밖의 프로바이더는 false로 본다(모르는 기능은 숨김)
function provider(st, s) {
  const id = (s && s.provider) || "claude";
  const p = ((st && st.providers) || []).find(x => x && x.id === id) || {};
  const k = KNOWN[id] || {};
  const c = p.capabilities || {}, dflt = id === "claude";
  const capabilities = Object.fromEntries(CAPS.map(f => [f, typeof c[f] === "boolean" ? c[f] : dflt]));
  return { id, name: p.name || k.name || id, icon: p.icon || k.icon || "🤖", capabilities };
}
const can = (st, s, cap) => provider(st, s).capabilities[cap] === true;
// 세션 목록용 배지 HTML: <span class="core-provider" data-provider="codex">🧩 Codex</span>
// opts.hideDefault: 프로바이더가 Claude 하나뿐이면 빈 문자열(지금 화면과 같게)
function providerBadge(st, s, { hideDefault = true, iconOnly = false } = {}) {
  const p = provider(st, s);
  const only = !((st && st.providers) || []).some(x => x && x.id !== "claude") && p.id === "claude";
  if (hideDefault && only) return "";
  return `<span class="core-provider" data-provider="${esc(p.id)}" title="${esc(p.name)}">${esc(p.icon)}${iconOnly ? "" : " " + esc(p.name)}</span>`;
}

/* ---------- Mode API 버전 ---------- */
const API_VERSION = "1.0";
// 모드의 apiVersion("major.minor")을 호스트와 비교 → { ok, code }. code: ok | bad | needs-update | adapter | too-old
function apiCompat(v, host = API_VERSION) {
  const p = s => { const m = /^(\d{1,3})\.(\d{1,4})$/.exec(String(s ?? "")); return m ? [+m[1], +m[2]] : null; };
  const a = p(v), h = p(host);
  if (!a) return { ok: false, code: "bad" };
  if (a[0] === h[0]) return a[1] <= h[1] ? { ok: true, code: "ok" } : { ok: false, code: "needs-update" };
  if (a[0] > h[0]) return { ok: false, code: "needs-update" };
  // N-1 major는 브리지 어댑터로 지원 예정(§4.3). v1에는 이전 major가 없으므로 어댑터가 없다
  return { ok: false, code: ADAPTERS[a[0]] ? "adapter" : "too-old" };
}
const ADAPTERS = {};

/* 세션으로 바로 갈 수 있나: 멀티플렉서(cmux #37 · Orca #40)에서 연 세션(jump.mux)이면 그 표시 이름, 아니면 "".
   스튜디오 완료 보고·질문 말풍선과 🙈 눈치 화면 [cmux로 이동]이 같은 판단을 쓴다(없으면 폴더 열기로 새 터미널이 떠서 기대와 다름) */
const MUX_NAME = { cmux: "cmux", orca: "Orca" };   // wr-core term.rs 어댑터 표와 같이 늘림
const muxName = s => (s && s.jump && s.jump.mux && MUX_NAME[s.jump.mux.kind]) || "";

window.CoreLib = {
  get lang() { return lang; },
  setLang(l) { lang = l === "en" ? "en" : "ko"; },
  hash, pick, esc, fmt, fmtTok, dur, hms, untilText, clockText, spanText,
  sessionStatus, isActive, isLive, hideMatcher, filterSessions, DEFAULT_HIDE_PROJECTS, DEFAULT_RECENT_MINUTES,
  stalls, summary, limitCalc, limits, limitNote,
  provider, can, providerBadge, PROVIDER_CAPS: CAPS,
  API_VERSION, apiCompat, muxName, MUX_NAME,
};
})();

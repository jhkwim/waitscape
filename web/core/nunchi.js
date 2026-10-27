/* 🙈 눈치 모드 (#51) — 화면을 평범한 업무 툴("Agent Sessions")로 바꾸는 코어 부품. 어느 모드에서든 동작한다.
   · 켜고 끄기 = 설정 `nunchi` 하나(앱: 전역 단축키·트레이·B 키 → 백엔드 settings → 모든 창). core.js가 set(on)을 부른다
   · 연출: 짧게(기본) = 도트 블라인드만 1초 안에 착착 · 길게(설정 nunchiLong) = 메인 모드가 def.nunchi(ev)로 퇴장·출근을 그림(지금은 스튜디오만)
     움직임 줄이기·회의 모드·창 숨김이면 연출 없이 바로. 전환 중에 한 번 더 누르면 즉시 끝(급할 때)
   · 메인 창 = 표 화면(탭·요약·한도 막대·세션 표·최근 활동) + 구석 회색 고양이, 위젯 창 = 담백한 작은 목록. 데이터·알림·이동은 그대로
   · 모드 훅 def.nunchi(ev, o): "leave" → Promise(퇴장이 끝나면) · "hide"(블라인드가 다 내려옴) · "arrive" { long, say } · "show"(바로 원래대로)
     def.nunchiOrder() → 표 행 순서(sid 배열) · def.nunchiCat(doc) → 구석 고양이 스프라이트 { idle, hover } */
(() => {
"use strict";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeIn = k => { k = clamp(k, 0, 1); return k * k; };
const ease = k => { k = clamp(k, 0, 1); return k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
const stripIcon = s => String(s || "").replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "");
const RUN = { working: 1, agents: 1 };

/* ---------- 순수 함수 (scripts/test_nunchi.js) ---------- */
// 상태 → [i18n 키, 점 색 클래스]
const stat = s => s.status === "needs_input" ? ["nx.st.ask", "ask"] : RUN[s.status] ? ["nx.st.run", "run"] : s.status === "done" ? ["nx.st.done", "done"] : ["nx.st.idle", "idle"];
// 경과: 실행 중 = 시작부터 · 입력 대기 = 기다린 시간 · 완료 = 걸린 시간
const elapsed = (s, now) => s.status === "done" ? s.run || 0 : s.status === "needs_input" ? now - s.since : now - (s.started || s.since);
// 현재 작업 한 줄(이모지 아이콘은 뺌). 없으면 null → 화면 기본 문구
function task(s) {
  if (s.status === "needs_input") return s.note || null;
  const a = s.activity && s.activity[s.activity.length - 1];
  if (s.status === "done") return s.prompt || (a ? stripIcon(a.text) : null);
  return a ? stripIcon(a.text) : s.prompt || null;
}
// 행 순서: 모드가 준 순서(스튜디오 = 맨 위층부터) → 나머지는 입력 대기·실행 중·완료 순
function order(sessions, sids) {
  const pos = new Map((sids || []).map((x, i) => [x, i]));
  const rk = x => pos.has(x.sid) ? pos.get(x.sid) : 100 + ({ needs_input: 0, working: 1, agents: 1, done: 2 }[x.status] ?? 3);
  return sessions.slice().sort((a, b) => rk(a) - rk(b) || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
}
const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const hhmm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
// 사용량 구간 색: 70% 미만 초록 · 70~89 앰버 · 90 이상 빨강 (한도·컨텍스트 막대)
const zone = u => u == null ? "" : u >= 90 ? "hi" : u >= 70 ? "mid" : "ok";
// 프로바이더 색 점 클래스(브랜드 느낌): claude · codex · gemini · 그 밖
const pvClass = id => "pvd pvd-" + (["claude", "codex", "gemini"].includes(id) ? id : "other");
// 처음엔 꼭, 이후 약 1/3 — 사장님 "다들 어디 갔다 왔어?"
const sayOnce = (count, r) => count === 0 || r < 1 / 3;
// 표에 넣는 숫자(도구 수): 숫자가 아니면 0 — HTML로 들어가므로 문자열을 그대로 쓰지 않음
const count = v => Math.max(0, Math.floor(Number(v) || 0));
// 진행 상황: 컨텍스트 사용률(statusline이 있을 때) · 할 일 완료/전체 · AI가 MCP로 알린 단계(n/총 + 제목). 없는 건 null
function progress(s) {
  const c = typeof s.ctx === "number" && isFinite(s.ctx) ? clamp(Math.round(s.ctx), 0, 100) : null;
  const td = Array.isArray(s.todos) && s.todos.length ? [s.todos.filter(x => x.status === "completed").length, s.todos.length] : null;
  const r = s.report && typeof s.report === "object" ? s.report : null;
  const step = r && Number.isInteger(r.step) && Number.isInteger(r.total) && r.step >= 1 && r.step <= r.total ? { n: r.step, of: r.total, title: String(r.title || "") } : null;
  return { ctx: c, todo: td, step };
}
// 주의 표시: 멈춤 의심(메인 작업 중 또는 실행 중 서브에이전트) · 컨텍스트 85% 이상 → [i18n 키, 값]
const CTX_WARN = 85;
function alerts(s) {
  const out = [], ag = Array.isArray(s.agents) ? s.agents : [];
  if ((s.status === "working" && s.health && s.health.level === "stall") || ag.some(a => a.status === "running" && a.health && a.health.level === "stall")) out.push(["nx.b.stall", null]);
  const c = progress(s).ctx;
  if (c != null && c >= CTX_WARN) out.push(["nx.b.ctx", c]);
  return out;
}
// 펼쳐 볼 서브에이전트(업무 모드와 같은 기준: 설명·도구가 있거나 실행 중) — 경과 = 실행 중이면 지금까지, 끝났으면 걸린 시간
const subs = (s, now) => (Array.isArray(s.agents) ? s.agents : []).filter(a => a.desc || a.tools || a.status === "running")
  .map(a => ({ desc: a.desc || "", type: a.type || "agent", run: a.status === "running", el: Math.max(0, (a.status === "running" ? now : a.ended || a.last || now) - (a.since || now)) }));
// 오늘 요약: 일보(daylog, 4시 경계)가 있으면 그것, 없으면 state에서 셀 수 있는 것만(완료 수·가장 오래 걸린 끝난 일). 보여 줄 게 없으면 null
function today(day, st) {
  const ok = day && typeof day === "object" && !day.error && typeof day.done === "number";
  const done = ok ? day.done : st && typeof st.done_today === "number" ? st.done_today : null;
  let longest = ok && Array.isArray(day.big) && day.big[0] ? { project: day.big[0].project || "", run: day.big[0].run || 0 } : null;
  if (!longest && st) for (const s of st.sessions || []) if (s.status === "done" && s.run > 0 && (!longest || s.run > longest.run)) longest = { project: s.project, run: s.run };
  const work = ok && day.work > 0 ? day.work : null, wait = ok && day.wait && day.wait.avg != null ? day.wait.avg : null;
  return done || work || longest || wait != null ? { done: done || 0, work, longest, wait } : null;
}
/* 창 안 단축키 판정(코어 keydown): ⌘1(맥)·Ctrl+1(그 밖) = 눈치 모드, ⌘2·Ctrl+2 = 미니 보기(위젯에선 큰 화면으로), 수식키 없는 B = 눈치 모드, 수식키 없는 1~9 = 모드 전환, 쉼표 = 설정.
   입력란(textarea·input·select·편집 가능)에서는 아무것도 안 함. 그 밖의 수식키 조합은 브라우저·OS에 맡김(null).
   e: { key, code, metaKey, ctrlKey, altKey, shiftKey, target: { tagName, isContentEditable } } */
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
function hotkey(e, mac) {
  if (e.repeat) return null;   // 길게 누르면 반복 토글하지 않음
  const tg = e.target || {};
  if (/^(TEXTAREA|INPUT|SELECT)$/.test(tg.tagName || "") || tg.isContentEditable) return null;
  // 물리 키(code) 기준 — 한국어 입력 중엔 B가 "ㅠ"로 오므로 e.key만 보면 안 먹는다
  const d = /^Digit([1-9])$/.exec(e.code || ""), num = d ? +d[1] : /^[1-9]$/.test(e.key) ? +e.key : 0;
  const one = num === 1, two = num === 2, comma = e.code === "Comma" || e.key === ",";
  if (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) return e.altKey || e.shiftKey ? null : one ? "nunchi" : two ? "mini" : comma ? "settings" : null;   // ⌘2 = 미니 보기 ↔ 큰 화면 · ⌘, = 설정
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code === "KeyB" || e.key === "b" || e.key === "B") return "nunchi";
  if (comma) return "settings";
  return num ? "mode:" + num : null;
}
// 창 안 단축키 표기: 맥 ⌘1, 그 밖 Ctrl+1 · 설정 ⌘, / Ctrl+,
const appKeyLabel = mac => mac ? "⌘1" : "Ctrl+1";
const setKeyLabel = mac => mac ? "⌘," : "Ctrl+,";
const miniKeyLabel = mac => mac ? "⌘2" : "Ctrl+2";
/* 우클릭한 자리의 세션: [data-sid](눈치 표·미니 목록·업무 모드 행·스튜디오 층 이름표·로비 점) → 스튜디오 누를 자리 [data-pk="<sid>.<대상>"](사장실·회의실·옥상 제외) */
function sidAt(el) {
  const a = el && el.closest ? el.closest("[data-sid]") : null;
  if (a && a.dataset.sid) return a.dataset.sid;
  const p = el && el.closest ? el.closest("[data-pk]") : null, k = p && String(p.dataset.pk || "").split(".")[0];
  return k && !["boss", "meet", "roof"].includes(k) ? k : null;
}
const lib = { hotkey, appKeyLabel, setKeyLabel, miniKeyLabel, sidAt, isMac, stat, elapsed, task, order, clock, sayOnce, stripIcon, count, progress, alerts, subs, today, zone, pvClass };

/* ---------- 도트 블라인드 (슬랫 단위로 끊겨 내려옴 = 착착, 줄은 레일 속도 반대로 흔들림) ---------- */
function Blind(doc, o) {
  const mk = (tag, cls, p, html) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; p.appendChild(e); return e; };
  const P = o.pitch, el = mk("div", "nx-blind" + (o.mini ? " mini" : ""), doc.body);
  el.setAttribute("aria-hidden", "true");
  mk("div", "nx-bh", el); const slats = mk("div", "nx-bs", el), rail = mk("div", "nx-br", el), cord = mk("div", "nx-bc", rail); mk("i", "", cord);
  const peek = o.mini ? null : mk("div", "nx-peek", el, `<div class="pk-g"><i class="e l"><b></b></i><i class="e r"><b></b></i></div><div class="pk-u"></div><div class="pk-d"></div><s class="f l"></s><s class="f r"></s>`);
  let gap0 = -1, swing = 0, swV = 0, lastY = 0, H = 0;
  return {
    el,
    /* p: 0..1 내려온 정도 · tilt: 0 틈 보임 .. 1 닫힘 */
    set(p, tilt, dt) {
      H = doc.defaultView.innerHeight;
      const full = H - o.head - o.rail, h = p >= 1 ? full : Math.floor(full * clamp(p, 0, 1) / P) * P;
      el.style.display = p <= 0 ? "none" : "block";
      slats.style.height = h + "px"; rail.style.top = (o.head + h) + "px";
      const gap = Math.round((1 - clamp(tilt, 0, 1)) * o.gap);
      if (gap !== gap0) { gap0 = gap; el.style.setProperty("--gap", gap + "px"); }
      const y = o.head + h, v = dt ? (y - lastY) / dt : 0; lastY = y;
      if (dt) { swV += (-swing * 90 - swV * 6 - clamp(v, -2000, 2000) * .012) * dt; swing += swV * dt; } else { swing = swV = 0; }
      cord.style.transform = `rotate(${clamp(swing, -24, 24).toFixed(1)}deg)`;
    },
    /* 빼꼼: k 0..1 벌어짐 · look -1..1 눈동자 · blink */
    peek(k, look, blink) {
      if (!peek) return;
      if (k <= 0) { peek.style.display = "none"; return; }
      peek.style.display = "block"; peek.style.top = (Math.round(H * .44 / P) * P + o.head) + "px";
      peek.style.setProperty("--k", Math.round(k * o.peekOpen) + "px"); peek.style.setProperty("--lx", Math.round(look * 2) * 2 + "px");
      peek.classList.toggle("blink", !!blink);
    },
  };
}

const GEAR = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" stroke-linecap="round"/><circle cx="8" cy="8" r="4.6"/></svg>`;
const MINI = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2"/><rect x="7.8" y="7.6" width="4.8" height="4" rx="1" fill="currentColor" stroke="none"/></svg>`;
const LOGO = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" opacity=".14"/><rect x="4" y="4.5" width="8" height="1.6" rx=".8" fill="currentColor"/><rect x="4" y="7.2" width="5.5" height="1.6" rx=".8" fill="currentColor" opacity=".7"/><rect x="4" y="9.9" width="6.8" height="1.6" rx=".8" fill="currentColor" opacity=".45"/></svg>`;

/* env: { doc, widget, t(k,p), L, state(), now(), hook(ev,o), order(), cat(), long(), quiet(), openTerminal?, showMain?, store, onPhase(phase) } */
function create(env) {
  const { doc, L } = env, win = doc.defaultView, W = !!env.widget;
  const t = (k, p) => env.t(k, p), esc = L.esc;
  const mqRM = win.matchMedia("(prefers-reduced-motion: reduce)"), mqDark = win.matchMedia("(prefers-color-scheme: dark)");
  const reduced = () => mqRM.matches || env.quiet() || doc.hidden;
  let on = false, phase = "off", seq = 0, raf = 0, A = null, root = null, blind = null, catEl = null, filter = "all";
  const setPhase = p => { if (phase === p) return; phase = p; doc.documentElement.classList.toggle("nx-on", p === "plain"); env.onPhase(p); };

  /* ---------- 화면 ---------- */
  function build() {
    if (root) return;
    if (!W) {
      root = doc.body.appendChild(doc.createElement("div"));
      root.className = "nx-plain"; root.setAttribute("role", "main"); root.setAttribute("aria-label", "Agent Sessions");
      root.innerHTML = `<header class="nx-top"><div class="nx-brand">${LOGO}<b>Agent Sessions</b></div><nav class="nx-tabs" role="tablist"></nav><span class="nx-sp"></span><span class="nx-upd"><i></i><span class="u"></span></span><button type="button" class="nx-gear nx-minib" data-act="nx-mini">${MINI}<span class="lb"></span><kbd></kbd></button><button type="button" class="nx-gear" data-act="nx-settings">${GEAR}<span class="lb"></span><kbd></kbd></button></header>
        <section class="nx-sum"><div class="nx-left"><div class="nx-stats"><div class="c-run"><span data-l="run"></span><b data-k="run">0</b></div><div class="c-ask"><span data-l="ask"></span><b data-k="ask">0</b></div><div class="c-done"><span data-l="done"></span><b data-k="done">0</b></div></div><div class="nx-today" hidden></div></div>
          <div class="nx-lims"><div class="nx-lim" data-w="five"><span class="n"></span><span class="bar"><i></i><u></u></span><span class="v"></span><span class="r"></span><span class="bd" hidden></span></div><div class="nx-lim" data-w="week"><span class="n"></span><span class="bar"><i></i><u></u></span><span class="v"></span><span class="r"></span><span class="bd" hidden></span></div></div></section>
        <div class="nx-card"><table class="nx-tbl"><colgroup><col class="c-p"><col class="c-s"><col><col class="c-g"><col class="c-e"><col class="c-n"><col class="c-o"></colgroup><thead><tr></tr></thead><tbody></tbody></table></div>
        <section class="nx-log"><h4></h4><ol></ol></section>
        <footer class="nx-foot"><span class="hk"><i></i><span></span></span><span class="pv"></span><span class="cap" role="status"></span><span class="nx-sp"></span><span class="back"></span><span class="lc"></span></footer>
        <div class="nx-cat" aria-hidden="true"><img alt=""><span class="z">z</span><span class="nx-shh"></span></div>`;
      root.addEventListener("click", e => {
        const tb = e.target.closest("[data-f]");
        if (tb) { filter = tb.dataset.f; labels(); render(); return; }
        if (e.target.closest("[data-act=nx-settings]")) { env.openSettings && env.openSettings(); return; }
        if (e.target.closest("[data-act=nx-mini]")) { env.openMini && env.openMini(); return; }
        const tg = e.target.closest("[data-sub]");
        if (tg) { const k = tg.dataset.sub; if (opened.has(k)) opened.delete(k); else opened.add(k); saveOpened(); render(); return; }
        const b = e.target.closest("[data-open]");
        if (b && env.openTerminal) env.openTerminal(b.dataset.open);
      });
      /* 하단 캡션: 이동할 수 없는 행의 "—" 등에 마우스를 올리면 이유 한 줄(title 툴팁 대신) */
      const cap = root.querySelector(".nx-foot .cap");
      root.addEventListener("mouseover", e => { const c = e.target.closest("[data-cap]"); cap.textContent = c ? t(c.dataset.cap) : ""; });
      root.addEventListener("mouseleave", () => { cap.textContent = ""; });
      catEl = root.querySelector(".nx-cat");
    } else {
      root = doc.body.appendChild(doc.createElement("div"));
      root.className = "nx-plain nx-mini";
      root.innerHTML = `<header class="nm-top">${LOGO}<b>Agent Sessions</b><span class="nm-sum"></span>${env.miniSettings ? `<button type="button" class="nm-gear" data-act="nm-settings">${GEAR}</button>` : ""}${env.showMain ? `<button type="button" class="nm-big" data-act="big">⤢</button>` : ""}</header><ul class="nm-list"></ul><footer class="nm-lim"><span class="n"></span><span class="bar"><i></i></span><span class="v"></span></footer>`;
      const big = root.querySelector(".nm-big"); if (big) big.addEventListener("click", () => env.showMain());
      root.addEventListener("click", e => {
        if (e.target.closest("[data-act=nm-settings]")) { env.miniSettings(); return; }   // 큰 화면 + 설정
        const b = e.target.closest("[data-open]"); if (b && env.openTerminal) env.openTerminal(b.dataset.open);
      });
    }
    blind = W ? Blind(doc, { pitch: 9, gap: 3, head: 9, rail: 9, mini: true }) : Blind(doc, { pitch: 14, gap: 4, head: 16, rail: 14, peekOpen: 15 });
    blind.set(0, 0, 0);
    labels(); theme(); op(0);
  }
  function labels() {   // 언어가 바뀔 때도
    if (!root) return;
    if (W) { const b = root.querySelector(".nm-big"); if (b) { b.title = t("nx.big"); b.setAttribute("aria-label", t("nx.big")); }
      const g = root.querySelector(".nm-gear"); if (g) g.setAttribute("aria-label", t("nx.settings")); root.querySelector(".nm-lim .n").textContent = t("nx.five.s"); return; }
    root.querySelector(".nx-tabs").innerHTML = ["all", "run", "ask", "done"].map(f => `<button type="button" role="tab" data-f="${f}" aria-selected="${filter === f}" class="${filter === f ? "on" : ""}">${esc(t("nx.tab." + f))}</button>`).join("");
    for (const k of ["run", "ask", "done"]) root.querySelector(`[data-l="${k}"]`).textContent = t("nx.sum." + k);
    root.querySelector('[data-w="five"] .n').textContent = t("nx.five"); root.querySelector('[data-w="week"] .n').textContent = t("nx.week");
    root.querySelector("thead tr").innerHTML = ["nx.col.p", "nx.col.s", "nx.col.t", "nx.col.g", "nx.col.e", "nx.col.n", ""].map((k, i) => `<th${i >= 4 ? ' class="r"' : ""}>${k ? esc(t(k)) : ""}</th>`).join("");
    root.querySelector(".nx-log h4").textContent = t("nx.log");
    root.querySelector(".nx-upd .u").textContent = t("nx.live");
    const mb = root.querySelector(".nx-minib"); mb.hidden = !env.openMini;   // 미니 보기(앱만): 위젯은 눈치 목록으로 뜸
    mb.querySelector(".lb").textContent = t("nx.mini"); mb.querySelector("kbd").textContent = miniKeyLabel(isMac());
    mb.setAttribute("aria-label", t("nx.mini") + " (" + miniKeyLabel(isMac()) + ")");
    const gear = root.querySelector(".nx-gear:not(.nx-minib)"); gear.hidden = !env.openSettings;
    gear.querySelector(".lb").textContent = t("nx.settings"); gear.querySelector("kbd").textContent = setKeyLabel(isMac());
    gear.setAttribute("aria-label", t("nx.settings") + " (" + setKeyLabel(isMac()) + ")");
    root.querySelector(".nx-shh").textContent = t("nx.shh");
    root.querySelector(".nx-foot .lc").textContent = t("nx.local");
    // 돌아가는 법 힌트: 앱 = ⌘1 / Ctrl+1, 브라우저 = B(⌘1·Ctrl+1은 브라우저 탭 이동과 겹칠 수 있음)
    root.querySelector(".nx-foot .back").textContent = t("nx.back", { k: env.app ? appKeyLabel(isMac()) : "B" }) + (env.openMini ? " · " + t("nx.miniKey", { k: miniKeyLabel(isMac()) }) : "");
    root.querySelector("tbody")._h = null; root.querySelector(".nx-log ol")._h = null;
  }
  /* 밝기: 설정 nunchiTheme = system(OS를 실시간으로 따름) | light | dark — 화면·블라인드·고양이 모두 */
  const isDark = () => { const v = env.theme ? env.theme() : "system"; return v === "dark" || (v !== "light" && mqDark.matches); };
  const theme = () => { const d = isDark(); if (root) root.classList.toggle("dark", d); if (blind) blind.el.classList.toggle("dark", d); };
  if (mqDark.addEventListener) mqDark.addEventListener("change", theme);
  function op(v) { if (!root) return; root.style.opacity = String(v); root.style.visibility = v > 0 ? "visible" : "hidden"; root.style.pointerEvents = v >= 1 ? "auto" : "none"; }

  /* 구석 고양이: 스튜디오 고양이 스프라이트 축소(회색·졸음) → 마우스를 올리면 색 + 팔 들고 "쉿" */
  let catReq = false;
  function cat() {
    if (W || !catEl || catReq) return;
    catReq = true;
    Promise.resolve(env.cat()).then(c => {
      if (!c) { catEl.hidden = true; return; }
      const im = catEl.querySelector("img"), set = s => { im.src = s.url; im.style.width = s.w + "px"; im.style.height = s.h + "px"; };
      set(c.idle);
      catEl.addEventListener("mouseenter", () => set(c.hover)); catEl.addEventListener("mouseleave", () => set(c.idle));
    }, () => { catEl.hidden = true; });
  }

  /* 서브에이전트 펼침(세션별로 이 브라우저에 기억) */
  const opened = new Set((() => { try { const v = JSON.parse(env.store.get("nunchi:open", "[]")); return Array.isArray(v) ? v.slice(-50) : []; } catch { return []; } })());
  const saveOpened = () => { try { env.store.set("nunchi:open", JSON.stringify([...opened].slice(-50))); } catch {} };
  /* 오늘 요약: 코어 Core.api.daylog(일보)가 있으면 눈치 화면이 보이는 동안 1분마다 읽음 */
  let day = null, dayAt = 0;
  function pollDay() {
    if (!env.daylog || W || phase !== "plain" || Date.now() - dayAt < 60000) return;
    dayAt = Date.now();
    Promise.resolve(env.daylog()).then(d => { day = d; render(); }, () => { day = null; });
  }

  /* 최근 활동: 상태가 바뀌거나 작업이 바뀌면 한 줄(최근 6개) */
  let logs = [], seenSt = {}, seenAct = {};
  function track(st) {   // 문구는 i18n 키(k)로 남겨 언어를 바꿔도 따라감, 작업 내용은 그대로(v)
    const now = env.now(), first = !Object.keys(seenSt).length;
    for (const x of st.sessions) {
      const a = x.activity && x.activity[x.activity.length - 1], key = a ? a.text : "", ps = seenSt[x.sid];
      const lbl = x.status === "done" ? "nx.ev.done" : x.status === "needs_input" ? "nx.ev.ask" : null;
      if (first) {
        if (RUN[x.status]) { logs.push({ t: x.started || x.since, p: x.project, k: "nx.ev.start" }); if (a) logs.push({ t: a.ts || now, p: x.project, v: stripIcon(key) }); }
        else logs.push({ t: x.since, p: x.project, k: lbl || "nx.st.idle" });
      } else if (ps === undefined) logs.push({ t: now, p: x.project, k: "nx.ev.start" });
      else if (ps !== x.status) logs.push({ t: now, p: x.project, k: lbl || (ps === "needs_input" ? "nx.ev.resume" : "nx.st.run") });
      else if (key && seenAct[x.sid] !== key && RUN[x.status]) logs.push({ t: a.ts || now, p: x.project, v: stripIcon(key) });
      seenSt[x.sid] = x.status; seenAct[x.sid] = key;
    }
    logs.sort((a, b) => b.t - a.t); logs = logs.slice(0, 6);
  }

  const it = (k, v) => `<span><em>${esc(t(k))}</em> ${esc(v)}</span>`;
  function render() {
    const st = env.state();
    if (!root || !st || phase === "off") return;
    const now = env.now(), list = order(st.sessions, env.order());
    const nRun = list.filter(x => RUN[x.status]).length, nAsk = list.filter(x => x.status === "needs_input").length;
    const lim = L.limits(st, now);
    const left = r => r && r > now ? t("nx.reset", { v: L.spanText(Math.floor((r - now) / 60) * 60) }) : "";
    if (W) {
      root.querySelector(".nm-sum").textContent = t("nx.mini.sum", { r: nRun, a: nAsk });
      const h = list.slice(0, 5).map(x => { const [k, c] = stat(x), mx = env.openTerminal ? L.muxName(x) : "";
        return `<li class="s-${c}" data-sid="${esc(x.sid)}"><i></i><span class="p">${esc(x.project)}</span>${mx ? `<button type="button" class="go" data-open="${esc(x.sid)}" aria-label="${esc(t("nx.go", { m: mx }))}">↗ ${esc(mx)}</button>` : "<span></span>"}<span class="s">${esc(t(k))}</span><span class="t">${clock(elapsed(x, now))}</span></li>`; }).join("")
        || `<li class="empty">${esc(t("nx.empty"))}</li>`;
      const ul = root.querySelector(".nm-list"); if (ul._h !== h) { ul._h = h; ul.innerHTML = h; }
      const u = lim.five.used;
      root.querySelector(".nm-lim i").style.width = (u == null ? 0 : clamp(u, 0, 100)) + "%"; root.querySelector(".nm-lim i").className = zone(u);
      root.querySelector(".nm-lim .v").textContent = u == null ? "—" : Math.round(u) + "%" + (lim.five.reset > now ? " · " + L.untilText(lim.five.reset, now) : "");
      return;
    }
    cat();
    const num = (k, v) => { const e = root.querySelector(`[data-k="${k}"]`); if (e.textContent !== String(v)) { e.textContent = v; e.classList.remove("bump"); void e.offsetWidth; e.classList.add("bump"); } };
    pollDay();
    const sum = today(day, st);
    num("run", nRun); num("ask", nAsk); num("done", sum ? sum.done : st.done_today || 0);   // 일보가 있으면 같은 기준(4시 경계)으로
    for (const k of ["five", "week"]) {
      const l = lim[k], e = root.querySelector(`[data-w="${k}"]`), u = l.used, i = e.querySelector("i"), p = e.querySelector("u");
      i.style.width = (u == null ? 0 : clamp(u, 0, 100)) + "%";
      i.className = zone(u);   // 사용량 구간 색(페이스 초과는 옆 배지로)
      p.style.display = u != null && l.pace != null ? "block" : "none"; p.style.left = clamp(l.pace || 0, 0, 100) + "%";
      e.querySelector(".v").textContent = u == null ? "—" : Math.round(u) + "%";
      e.querySelector(".r").textContent = u == null ? "" : left(l.reset);
      const bd = e.querySelector(".bd"); bd.hidden = !l.over; bd.textContent = t("nx.b.pace");   // 한도 페이스 초과
    }
    const tdEl = root.querySelector(".nx-today"), secs = v => v < 60 ? t("nx.sec", { n: Math.round(v) }) : L.spanText(v);
    const th = !sum ? "" : (sum.work ? it("nx.td.work", L.spanText(sum.work)) : "")
      + (sum.longest ? it("nx.td.long", `${sum.longest.project} · ${secs(sum.longest.run)}`) : "") + (sum.wait != null ? it("nx.td.wait", secs(sum.wait)) : "");
    tdEl.hidden = !th;   // 완료 수는 바로 위 요약에 — 카드는 작업 시간·가장 오래 걸린 일·입력 대기 평균
    if (tdEl._h !== th) { tdEl._h = th; tdEl.innerHTML = th; }
    const vis = list.filter(x => filter === "all" || (filter === "run" ? RUN[x.status] : filter === "ask" ? x.status === "needs_input" : x.status === "done"));
    const prov = x => (L.provider(st, x) || {}).name || "";
    const tb = root.querySelector("tbody");
    /* 진행 상황 셀: 컨텍스트(우선) · 할 일 · 단계(좁으면 단계 → 할 일 순으로 숨김) */
    const prog = x => { const g = progress(x), out = [];
      if (g.ctx != null) out.push(`<span class="pg pg-ctx${g.ctx >= CTX_WARN ? " hi" : g.ctx >= 70 ? " mid" : ""}"><i><b style="width:${g.ctx}%"></b></i>${g.ctx}%</span>`);
      if (g.todo) out.push(`<span class="pg pg-todo"><i><b style="width:${Math.round(g.todo[0] / g.todo[1] * 100)}%"></b></i>${esc(t("nx.pg.todo", { d: g.todo[0], n: g.todo[1] }))}</span>`);
      if (g.step) out.push(`<span class="pg pg-step">${g.step.n}/${g.step.of}${g.step.title ? " " + esc(g.step.title) : ""}</span>`);
      return out.join("") || `<span class="nil">—</span>`; };
    const html = vis.map(x => { const [k, c] = stat(x), sb = subs(x, now), open = sb.length && opened.has(x.sid), mx = env.openTerminal ? L.muxName(x) : "";
      const al = alerts(x), stuck = al.some(a => a[0] === "nx.b.stall");
      const badges = al.map(([bk, v]) => `<span class="bd${bk === "nx.b.stall" ? " stall" : ""}">${esc(t(bk, { v }))}</span>`).join("");
      const tog = sb.length ? `<button type="button" class="tog" data-sub="${esc(x.sid)}" aria-expanded="${!!open}" aria-label="${esc(t("nx.subs", { n: sb.length }))}"></button>` : "";
      const row = `<tr data-sid="${esc(x.sid)}" class="s-${c}${open ? " opened" : ""}"><td><div class="p">${tog}${esc(x.project)}</div><div class="m"><i class="${pvClass((L.provider(st, x) || {}).id)}"></i>${esc(prov(x))} · ${esc(String(x.sid).slice(0, 6))}${sb.length ? ` · ${esc(t("nx.subs", { n: sb.length }))}` : ""}${badges}</div></td>`
        + `<td><span class="st ${stuck ? "stall" : c}"><i></i>${esc(t(k))}</span></td><td class="task"><span>${esc(task(x) || t(x.status === "needs_input" ? "nx.task.ask" : "nx.task.run"))}</span></td>`
        + `<td class="prog">${prog(x)}</td><td class="r num">${clock(elapsed(x, now))}</td><td class="r num">${count(x.tools)}</td>`
        + `<td class="r">${mx ? `<button type="button" class="open" data-open="${esc(x.sid)}">${esc(t("nx.go", { m: mx }))}</button>` : env.openTerminal ? `<span class="nogo" data-cap="nx.nogo">—</span>` : ""}</td></tr>`;
      const kids = !open ? "" : sb.map(a => `<tr class="sub"><td colspan="3"><span class="sd">${esc(a.desc || a.type)}</span><span class="sy">${esc(a.type)}</span></td>`
        + `<td><span class="st ${a.run ? "run" : "done"}"><i></i>${esc(t(a.run ? "nx.st.run" : "nx.st.done"))}</span></td><td class="r num">${clock(a.el)}</td><td></td><td></td></tr>`).join("");
      return row + kids; }).join("")
      || `<tr class="empty"><td colspan="7">${esc(t("nx.empty"))}</td></tr>`;
    if (tb._h !== html) { tb._h = html; tb.innerHTML = html; }
    const ol = root.querySelector(".nx-log ol"), lh = logs.map(l => `<li><time>${hhmm(l.t)}</time><b>${esc(l.p)}</b><span>${esc(l.k ? t(l.k) : l.v)}</span></li>`).join("");
    if (ol._h !== lh) { ol._h = lh; ol.innerHTML = lh; }
    const hk = st.hooks && st.hooks.installed, f = root.querySelector(".nx-foot .hk");
    f.hidden = !hk; f.lastChild.textContent = t("nx.hooks");
    root.querySelector(".nx-foot .pv").textContent = (st.providers || []).map(p => p && p.name).filter(Boolean).join(" · ");
  }

  /* ---------- 전환 ---------- */
  const hook = (ev, o) => { try { return env.hook(ev, o || {}); } catch (e) { console.error("[nunchi] 모드 훅 오류", e); return null; } };
  function loop(step) {
    win.cancelAnimationFrame(raf);
    let last = 0;
    const f = ts => { raf = 0; const dt = last ? Math.min(.1, (ts - last) / 1000) : 0; last = ts; if (step(dt) !== false) raf = win.requestAnimationFrame(f); };
    raf = win.requestAnimationFrame(f);
  }
  function stop() { win.cancelAnimationFrame(raf); raf = 0; A = null; }
  function plainNow() { stop(); blind.set(0, 0, 0); blind.peek(0); op(1); setPhase("plain"); hook("hide"); render(); }
  function studioNow(o) { stop(); blind.set(0, 0, 0); blind.peek(0); op(0); setPhase("off"); if (o) hook("arrive", o); }
  const say = () => { const n = +env.store.get("nunchi:said", "0") || 0, s = sayOnce(n, Math.random()); env.store.set("nunchi:said", String(n + 1)); return s; };

  /* 켜기: (긴 연출이면 모드의 퇴장이 끝난 뒤) 블라인드 착착 → 살짝 닫힘 → 화면 */
  function leave() {
    const my = ++seq;
    setPhase("leaving");
    const p = !W && env.long() ? hook("leave") : null;
    const drop = () => {
      if (my !== seq) return;
      const D = W ? .42 : .62, TL = W ? .1 : .14, FD = W ? .14 : .2;
      A = { t: 0 };
      loop(dt => {
        if (my !== seq) return false;
        const k = (A.t += dt) / D;
        blind.set(k >= 1 ? 1 : easeIn(k) * .9 + k * .1, A.t > D ? (A.t - D) / TL : 0, dt);
        op(clamp((A.t - D - TL) / FD, 0, 1));
        if (A.t >= D + TL + FD + .05) { plainNow(); return false; }
      });
    };
    if (p && typeof p.then === "function") Promise.race([p, new Promise(r => win.setTimeout(r, 15000))]).then(drop, drop);
    else drop();
  }
  /* 끄기: 화면 걷힘 → (긴 연출) 블라인드 틈으로 빼꼼 → 틈 열림 → 착착 올라감 → 모드가 출근 */
  function arrive() {
    const my = ++seq, long = !W && env.long(), sayIt = !W && say();
    setPhase("returning");
    blind.set(1, 1, 0);
    if (!long) hook("arrive", { long: false, say: sayIt });   // 짧게: 블라인드를 올리기 전에 직원부터 자리에(빈 스튜디오가 비치지 않게)
    const F0 = W ? .12 : .18, pk = long ? [F0 + .05, F0 + .95] : null, tOpen = pk ? pk[1] + .05 : F0 + .02, TL = .14, UP = W ? .4 : .62;
    A = { t: 0 };
    loop(dt => {
      if (my !== seq) return false;
      const tt = (A.t += dt);
      op(1 - clamp(tt / F0, 0, 1));
      if (pk && tt >= pk[0] && tt < pk[1]) {
        const u = (tt - pk[0]) / (pk[1] - pk[0]);
        blind.peek(u < .14 ? ease(u / .14) : u > .86 ? 1 - ease((u - .86) / .14) : 1, u < .3 ? 0 : u < .5 ? -1 : u < .68 ? 1 : 0, u > .7 && u < .76);
      } else blind.peek(0);
      const up = (tt - tOpen - TL) / UP;
      blind.set(up <= 0 ? 1 : 1 - (easeIn(up) * .9 + up * .1), tt < tOpen ? 1 : 1 - (tt - tOpen) / TL, dt);
      if (tt >= tOpen + TL + UP) { studioNow(long ? { long, say: sayIt } : null); return false; }
    });
  }
  /* 전환 중에 단축키·B를 또 누르면 = 지금 목표로 바로(급할 때). 전환 중이 아니면 false */
  function skip() {
    if (phase === "leaving") { seq++; plainNow(); return true; }
    if (phase === "returning") { seq++; studioNow({ long: false, say: false }); return true; }
    return false;
  }
  function set(v, o = {}) {
    v = !!v;
    build();
    if (phase === "leaving") { seq++; plainNow(); if (v) { on = true; return; } }   // 전환 중 또 누름: 지금 목표로 바로
    else if (phase === "returning") { seq++; studioNow({ long: false, say: false }); if (!v) { on = false; return; } }
    if (v === on && (phase !== "off") === v) return;
    on = v;
    if (o.instant || reduced()) { if (on) plainNow(); else studioNow({ long: false, say: false }); return; }
    if (on) leave(); else arrive();
  }

  win.setInterval(render, 1000);
  return {
    get on() { return on; },
    get phase() { return phase; },   // off | leaving | plain | returning
    set, skip,
    restyle() { theme(); render(); },   // 설정(밝기)이 바뀌었을 때
    state(st) { track(st); render(); },
    lang() { labels(); render(); },
  };
}

window.CoreNunchi = { create, lib };
})();

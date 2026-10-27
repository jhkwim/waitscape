/* 💼 업무 모드: 관측 대시보드 (KPI 행 + 사용 한도 + 세션 테이블, 행을 펼쳐 프롬프트·활동·서브에이전트·할 일·메모)
   코어가 처음 선택될 때만 불러오고, 다른 모드로 바꾸면 unmount로 DOM·타이머를 모두 정리한다. */
(() => {
"use strict";
const C = window.Core;
const { esc, fmtTok, dur, hms, clockText, untilText, spanText } = C;

const STATUS_LABEL = { working: "작업 중", agents: "에이전트 실행 중", needs_input: "입력 필요", done: "완료", idle: "대기" };
const OPS_TAG = { "📖": "READ", "✏️": "EDIT", "📝": "WRITE", "⚡": "BASH", "🔍": "SEARCH", "🌐": "WEB", "🤖": "AGENT",
  "🗒️": "TODO", "📨": "REPORT", "🔌": "MCP", "🔧": "TOOL" };
const opsTag = icon => OPS_TAG[icon] || "TOOL";
const OPS_RANK = { needs_input: 0, working: 2, agents: 2, done: 3, idle: 4 };
const SVG_CHEV = `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_NOTE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const NIL = `<span class="nil">—</span>`;

function healthText(h) {
  const m = Math.max(1, Math.floor(h.secs / 60));
  return h.tool ? `${h.tool} ${m}분째 실행 중` + (h.level === "stall" ? " · 멈춤 의심" : " · 느림")
    : h.level === "stall" ? `${m}분째 응답 없음 · 멈춤 의심` : `${m}분째 응답 대기 · 느림`;
}
const opsAgents = s => s.agents.filter(a => a.desc || a.tools || a.status === "running");
function opsHealth(s, status) {
  const hs = [];
  if (status === "working" && s.health) hs.push(s.health);
  for (const a of s.agents) if (a.status === "running" && a.health) hs.push(a.health);
  return hs.find(h => h.level === "stall") || hs.find(h => h.level === "slow") || null;
}
function healthPill(h, active) {
  if (!h) return active ? `<span class="hp ok"><i class="dot"></i>정상</span>` : NIL;
  const m = Math.max(1, Math.floor(h.secs / 60));
  return `<span class="hp ${h.level}" title="${esc(healthText(h))}"><i class="dot"></i>${h.level === "stall" ? "멈춤 의심" : "느림"} · ${m}분</span>`;
}
const ctxCell = c => c == null ? NIL
  : `<span class="mbar ${c >= 85 ? "danger" : c >= 70 ? "warn" : ""}" title="컨텍스트 사용률"><i><b style="width:${Math.min(100, c)}%"></b></i><em>${Math.round(c)}%</em></span>`;
function todoCell(t) {
  if (!t.length) return NIL;
  const d = t.filter(x => x.status === "completed").length;
  return `<span class="mbar todo"><em>${d}/${t.length}</em><i><b style="width:${d / t.length * 100}%"></b></i></span>`;
}
const kpi = (label, val, sub, cls = "") =>
  `<div class="kpi ${cls}"><div class="k-label"><i class="dot"></i>${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

const MARKUP = `
<header>
  <div class="title">Claude 세션 모니터</div>
  <span class="live" id="ops-live"></span>
  <div class="hud">
    <button class="btn" id="quiet-btn" title="움직임과 소리를 꺼요">무음</button>
    <button class="btn" id="notif-btn">알림 켜기</button>
  </div>
</header>
<section class="banner" id="banner" hidden>
  <div class="banner-inner">
    <div class="banner-emoji" id="banner-emoji"></div>
    <div><div class="banner-title" id="banner-title"></div><div class="banner-body" id="banner-body"></div></div>
  </div>
</section>
<section class="ops-kpi" id="ops-kpi" aria-label="요약 지표"></section>
<section class="gauges" id="gauges">
  <div class="gauge" id="g-five" data-base="#3b82f6"><span class="g-label">5시간 한도</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="gauge" id="g-week" data-base="#34c759"><span class="g-label">주간 한도</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="gauge" id="g-extra" data-base="#a98bff" hidden><span class="g-label">추가 사용</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="g-note" id="g-note"></div>
</section>
<section id="ops" aria-label="세션 목록">
  <div class="ops-head"><h2>세션 <span id="ops-count">0</span></h2>
    <div class="ops-actions"><button class="btn" id="ops-expand">모두 펼치기</button><button class="btn" id="ops-collapse">모두 접기</button></div></div>
  <div class="ops-table" role="table">
    <div class="op-cols ops-th" role="row"><span></span><span>세션</span><span>상태</span><span class="num">경과</span><span class="num c-tools">도구</span><span class="num c-tok">토큰</span><span class="c-ctx">컨텍스트</span><span class="num c-ag">에이전트</span><span class="c-todo">할 일</span><span class="c-health">상태 점검</span></div>
    <div id="ops-body"></div>
  </div>
</section>`;

const ROW = `<div class="op-cols op-row" role="row" tabindex="0"></div>
  <div class="op-detail"><div class="pane p1"></div><div class="pane p2"></div>
    <div class="pane p3"><div class="p3-dyn blk"></div>
      <div class="blk memo-w"><h4>다음 프롬프트 메모</h4><textarea placeholder="끝나면 보낼 다음 지시를 적어두세요" aria-label="다음 프롬프트 메모"></textarea>
        <div class="row"><span>완료 시 알림 · 이 브라우저에만 저장</span><button class="btn">복사</button></div></div>
      <div class="blk term-w" hidden><button class="btn term-btn" title="이 세션의 폴더에서 터미널 열기 (앱 전용)">⌨️ 터미널 열기</button></div></div></div>`;

C.registerMode({
  id: "work", label: "업무", icon: "💼",
  chimeWave: "sine",
  texts: {
    done: s => [`${s.project} 작업 완료`, s.prompt || ""],
    input: s => [`${s.project} 입력 필요`, s.note || ""],
    stall: x => [`${x.project} 멈춤 의심`, `${x.agent ? x.agent.desc || x.agent.type : "메인 세션"}: ${healthText(x.health)}`],
    memo: (s, text) => [`${s.project} 메모 준비됐어요`, text.slice(0, 80)],
    title: ({ calling, working }) => calling ? `(${calling}) 입력 필요 · 세션 모니터` : working ? `${working}개 작업 중 · 세션 모니터` : "Claude 세션 모니터",
  },

  mount(root, ctx) {
    const { doc } = ctx;
    const $ = sel => root.querySelector(sel);
    let last = null;
    let opsOpen = {};
    try { opsOpen = JSON.parse(C.store.get("opsOpen") || "{}") || {}; } catch {}
    const saveOpsOpen = () => {
      const live = new Set((last ? last.sessions : []).map(s => s.sid));
      for (const k of Object.keys(opsOpen)) if (!live.has(k)) delete opsOpen[k];
      C.store.set("opsOpen", JSON.stringify(opsOpen));
    };

    root.innerHTML = MARKUP;
    ctx.switcher.querySelector("select").classList.add("btn");
    $(".hud").insertBefore(ctx.switcher, $("#quiet-btn"));

    function setBanner(e, t, b) {
      $("#banner-emoji").textContent = e;
      $("#banner-title").textContent = t;
      $("#banner-body").textContent = b;
    }

    function renderLimits(now) {
      const L = C.limits(last, now);
      for (const [key, id] of [["five", "g-five"], ["week", "g-week"], ["extra", "g-extra"]]) {
        const g = $("#" + id), c = L[key], { used, pace, wasReset, reset } = c;
        if (key === "extra") g.hidden = !c.shown;
        g.querySelector(".g-pct").textContent = wasReset ? "리셋됨" : used == null ? "-" : `${Math.round(used)}%`;
        g.querySelector(".g-bar i").style.width = (used ?? 0) + "%";
        const pm = g.querySelector(".pace");
        pm.hidden = pace == null || wasReset;
        if (pace != null) { pm.style.left = pace + "%"; pm.title = `시간 기준 적정 사용량 ${Math.round(pace)}%`; }
        g.style.setProperty("--g", used == null ? "#b5a89b" : used >= 90 ? "#ff5a5a" : c.over ? "#ff9f40" : g.dataset.base);
        g.classList.toggle("over", c.over);
        g.classList.toggle("low", c.low);
        g.querySelector(".g-reset").textContent = wasReset ? `${clockText(reset, now)}에 리셋됨`
          : reset ? `리셋 ${clockText(reset, now)} · ${spanText(reset - now)} 남음` : "";
        const paceGap = used != null && pace != null ? ` · 페이스 ${Math.round(pace)}% 대비 ${used - pace >= 0 ? "+" : "−"}${Math.abs(Math.round(used - pace))}%p` : "";
        g.querySelector(".g-proj").textContent = {
          full: "한도 도달 · 리셋 대기",
          unused: "현재 속도 유지 시 리셋 전 소진 없음",
          safe: "현재 속도 유지 시 리셋 전 소진 없음" + paceGap,
          eta: c.eta && `예상 소진 ${clockText(c.eta, now)} · 리셋 ${spanText(reset - c.eta)} 전` + paceGap,
          reset: "다음 요청 시 갱신",
        }[c.proj] || "";
      }
      $("#g-note").textContent = C.limitNote(last, now);
      return L.low && [{ five: "5시간 한도", week: "주간 한도" }[L.low.key], L.low.left, L.low.reset];
    }

    function renderOps(now) {
      const ss = last.sessions;
      // 실시간 표시: 마지막 /state 응답이 얼마나 오래됐나
      const lag = Math.max(0, now - last.now), lv = $("#ops-live");
      lv.classList.toggle("stale", lag > 4);
      setHTML(lv, `<i class="dot"></i>${lag > 4 ? `지연 ${Math.round(lag)}초` : "실시간"} · ${hms(last.now)}`);

      // KPI
      const st = ss.map(s => C.sessionStatus(s, now));
      const active = st.filter(x => x === "working" || x === "agents").length;
      const calling = ss.filter(s => s.status === "needs_input");
      let stall = 0, slow = 0, agRun = 0;
      const stallWho = [];
      ss.forEach((s, i) => {
        if (st[i] === "working" && s.health) s.health.level === "stall" ? (stall++, stallWho.push(s.project)) : slow++;
        for (const a of s.agents) if (a.status === "running") {
          agRun++;
          if (a.health) a.health.level === "stall" ? (stall++, stallWho.push(`${s.project}/${a.desc || a.type}`)) : slow++;
        }
      });
      const tt = last.today_tokens || {};
      const { waited } = C.summary(last, now);
      setHTML($("#ops-kpi"), [
        kpi("활성 세션", `${active}<small>/ ${ss.length}</small>`, `대기 ${st.filter(x => x === "idle" || x === "done").length} · 입력 대기 ${calling.length}`, active ? "live-on" : ""),
        kpi("입력 필요", calling.length, calling.length ? esc(calling.map(s => s.project).join(", ")) : "대기 중인 요청 없음", calling.length ? "warn" : ""),
        kpi("멈춤 의심", stall, stall ? esc(stallWho.join(", ")) + (slow ? ` · 느림 ${slow}` : "") : slow ? `느림 ${slow}건` : "응답 지연 없음", stall ? "danger" : slow ? "warn" : ""),
        kpi("서브에이전트", agRun, `오늘 ${last.today_agents || 0}개 시작`, agRun ? "live-on" : ""),
        kpi("오늘 완료", last.done_today || 0, "완료된 요청"),
        kpi("오늘 토큰", fmtTok(tt.total), `입력 ${fmtTok(tt.new)} · 출력 ${fmtTok(tt.out)} · 캐시 ${fmtTok(tt.cached)}`),
        kpi("오늘 대기 시간", dur(waited), "Claude 작업 완료까지 누적"),
      ].join(""));

      // 세션 테이블
      const body = $("#ops-body");
      $("#ops-count").textContent = ss.length;
      if (!ss.length) {
        setHTML(body, `<div class="ops-empty">활성 세션 없음<small>Claude Code에서 프롬프트를 보내면 여기에 표시됩니다</small></div>`);
        return;
      }
      if (body.querySelector(".ops-empty")) { body.innerHTML = ""; body._html = null; }
      const rows = ss.map((s, i) => {
        const status = st[i], h = opsHealth(s, status);
        return { s, i, status, h, rank: status === "needs_input" ? 0 : h && h.level === "stall" ? 1 : OPS_RANK[status] ?? 5 };
      }).sort((a, b) => a.rank - b.rank || a.i - b.i);
      const seen = new Set();
      rows.forEach(({ s, status, h }, idx) => {
        seen.add(s.sid);
        let el = doc.getElementById("op-" + s.sid);
        if (!el) {
          el = doc.createElement("div");
          el.id = "op-" + s.sid; el.dataset.sid = s.sid;   // 앱 우클릭 메뉴가 세션을 알 수 있게
          el.innerHTML = ROW;
          const row = el.querySelector(".op-row");
          const toggle = () => { opsOpen[s.sid] = !el.classList.contains("open"); saveOpsOpen(); render(); };
          row.onclick = toggle;
          row.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
          const ta = el.querySelector("textarea"), btn = el.querySelector(".memo-w .btn");
          if (ctx.api.openTerminal) {   // 앱(Tauri): 세션 cwd에서 터미널 열기
            el.querySelector(".term-w").hidden = false;
            el.querySelector(".term-btn").onclick = e => { e.stopPropagation(); ctx.api.openTerminal(s.sid); };
          }
          ta.value = ctx.memo.get(s.sid);
          ta.oninput = () => ctx.memo.set(s.sid, ta.value);
          btn.onclick = async e => {
            e.stopPropagation();
            if (!ta.value.trim()) { ta.focus(); return; }
            await ctx.memo.copy(s.sid, ta);
            btn.textContent = "복사됨"; ctx.after(1800, () => btn.textContent = "복사");
          };
        }
        if (body.children[idx] !== el) body.insertBefore(el, body.children[idx] || null);
        const open = opsOpen[s.sid] ?? (status === "needs_input" || !!(h && h.level === "stall"));
        el.className = `op ${status} ${h ? h.level : ""} ${open ? "open" : ""} ${opsAgents(s).length ? "" : "no-ag"}`;
        const row = el.querySelector(".op-row");
        row.setAttribute("aria-expanded", open);

        // 메모 상태 (햄찌 모드와 같은 localStorage 키를 코어가 관리)
        const ta = el.querySelector("textarea");
        const memo = ctx.memo.get(s.sid);
        if (doc.activeElement !== ta && ta.value !== memo) ta.value = memo;
        const ready = ctx.memo.ready(s.sid);
        el.querySelector(".memo-w").classList.toggle("ready", ready);

        const ags = opsAgents(s), run = ags.filter(a => a.status === "running"), back = ags.filter(a => a.status === "done");
        const lastAct = s.activity[s.activity.length - 1];
        const sub = status === "needs_input" ? esc(s.note || "확인 필요")
          : status === "working" ? (lastAct ? `<span class="tag">${opsTag(lastAct.icon)}</span>${esc(lastAct.text)}` : "생각 중")
          : status === "agents" ? `서브에이전트 ${run.length}개 실행 중` + (run.length ? " · " + esc(run.map(a => a.desc || a.type).join(", ")) : "")
          : s.prompt ? esc(s.prompt) : "대기 중";
        setHTML(row, `${SVG_CHEV}
          <div class="op-name"><div class="op-proj"><b>${esc(s.project)}</b><span class="sid" title="${esc(s.sid)}">${esc(s.sid.slice(0, 8))}</span>${
            memo.trim() ? `<span class="memo-flag ${ready ? "ready" : ""}" title="${ready ? "메모 준비됨 · 펼쳐서 복사" : "메모 있음"}">${SVG_NOTE}</span>` : ""}</div>
            <div class="op-sub" title="${esc(s.prompt || "")}">${sub}</div></div>
          <div><span class="st ${status}"><i class="dot"></i>${STATUS_LABEL[status]}</span></div>
          <div class="num">${dur(now - s.since)}</div>
          <div class="num c-tools">${s.tools || NIL}</div>
          <div class="num c-tok" title="${s.tokens ? `새 입력 ${fmtTok(s.tokens.new)} · 출력 ${fmtTok(s.tokens.out)} · 캐시 읽기 ${fmtTok(s.tokens.cached)}` : ""}">${s.tokens && s.tokens.total ? fmtTok(s.tokens.total) : NIL}</div>
          <div class="c-ctx">${ctxCell(s.ctx)}</div>
          <div class="num c-ag">${ags.length ? `${run.length}<span class="muted"> / ${ags.length}</span>` : NIL}</div>
          <div class="c-todo">${todoCell(s.todos)}</div>
          <div class="c-health">${healthPill(h, status === "working" || status === "agents")}</div>`);
        if (!open) return;

        // 상세: 요청 · 활동
        const acts = s.activity.map(a => `<li><time>${hms(a.ts)}</time><span class="tag">${opsTag(a.icon)}</span><span>${esc(a.text)}</span></li>`).join("");
        setHTML(el.querySelector(".p1"),
          (status === "needs_input" ? `<div class="blk"><div class="callout warn">${esc(s.note || "터미널에서 확인이 필요합니다.")}</div></div>` : "")
          + `<div class="blk"><h4>프롬프트</h4><div class="prompt-txt">${s.prompt ? esc(s.prompt) : NIL}</div></div>`
          + (s.say ? `<div class="blk"><h4>마지막 응답</h4><div class="say-txt">${esc(s.say)}</div></div>` : "")
          + `<div class="blk"><h4>최근 활동 <span>도구 ${s.tools}회</span></h4>${acts ? `<ul class="act">${acts}</ul>` : `<div class="none">활동 기록 없음</div>`}</div>`);
        // 상세: 서브에이전트
        setHTML(el.querySelector(".p2"), `<h4>서브에이전트 <span>실행 ${run.length} · 완료 ${back.length}</span></h4>`
          + (!ags.length ? `<div class="none">서브에이전트 없음</div>` : run.map(a => `
            <div class="ag ${a.health ? a.health.level : ""}">
              <div class="ag-top"><div class="ag-name"><i class="dot"></i><span title="${esc(a.desc || a.type)}">${esc(a.desc || a.type)}</span></div>
                <div class="ag-meta">${dur(now - a.since)} · 도구 ${a.tools}${a.tokens ? " · " + fmtTok(a.tokens) : ""}</div></div>
              <div class="ag-type"><span>${esc(a.type)}${a.bg ? " · 백그라운드" : ""}</span>${a.health ? healthPill(a.health) : ""}</div>
              ${a.say ? `<div class="ag-say" title="${esc(a.say)}">${esc(a.say)}</div>` : ""}
              <ul class="act sm">${(a.recent || []).map(r => `<li><span class="tag">${opsTag(r.icon)}</span><span>${esc(r.text)}</span></li>`).join("") || `<li><span class="tag">INIT</span><span>시작 중</span></li>`}</ul>
            </div>`).join("")
            + (back.length ? `<div class="ag-done">${back.map(a => `<div><span title="${esc(a.desc)}">${esc(a.desc || a.type)}</span><em>${dur(a.ended - a.since)}${a.tokens ? " · " + fmtTok(a.tokens) : ""}</em></div>`).join("")}</div>` : "")));
        // 상세: 할 일
        const t = s.todos, done = t.filter(x => x.status === "completed").length;
        setHTML(el.querySelector(".p3-dyn"), t.length
          ? `<h4>할 일 <span>${done} / ${t.length}</span></h4><div class="pbar"><b style="width:${done / t.length * 100}%"></b></div>
             <ul class="td">${t.map(x => `<li class="${esc(x.status)}"><i></i><span title="${esc(x.text)}">${esc(x.text)}</span></li>`).join("")}</ul>`
          : `<h4>할 일</h4><div class="none">할 일 목록 없음</div>`);
      });
      for (const el of [...body.children]) if (el.id && !seen.has(el.id.slice(3))) el.remove();
    }

    function render() {
      if (!last) return;
      const now = ctx.now();
      const { calling } = C.summary(last, now);
      const low = renderLimits(now);
      const stalls = C.stalls(last);
      const br = $("#banner");
      if (calling.length) {
        br.hidden = false; br.className = "banner call";
        setBanner("⚠️", `입력 필요 · ${calling.map(s => s.project).join(", ")}`,
          calling.map(s => s.note).filter(Boolean)[0] || "터미널에서 권한 요청 또는 질문에 응답이 필요합니다.");
      } else if (stalls.length) {
        const x = stalls[0];
        br.hidden = false; br.className = "banner call stall";
        setBanner("⚠️", `${x.project} · ${x.agent ? x.agent.desc || x.agent.type : "메인 세션"}: ${healthText(x.health)}`,
          (stalls.length > 1 ? `외 ${stalls.length - 1}건 · ` : "") + "터미널에서 상태를 확인해 보세요 (권한 요청, 네트워크, 무한 대기 등).");
      } else if (low) {
        br.hidden = false; br.className = "banner call";
        setBanner("⚠️", `${low[0]} 잔여 ${low[1]}%`,
          low[2] ? `${untilText(low[2], now)} 리셋 (${clockText(low[2], now)}) · 큰 작업은 리셋 이후 권장` : "사용량 관리 필요");
      } else {
        br.hidden = true;
      }
      renderOps(now);
    }

    /* ----- 버튼 ----- */
    const qb = $("#quiet-btn"), nb = $("#notif-btn");
    const applySettings = () => { qb.classList.toggle("on", ctx.settings.quiet); nb.hidden = !ctx.notif.canAsk; };
    qb.onclick = () => ctx.settings.setQuiet(!ctx.settings.quiet);
    nb.onclick = () => ctx.notif.request();
    $("#ops-expand").onclick = () => { for (const s of (last ? last.sessions : [])) opsOpen[s.sid] = true; saveOpsOpen(); render(); };
    $("#ops-collapse").onclick = () => { for (const s of (last ? last.sessions : [])) opsOpen[s.sid] = false; saveOpsOpen(); render(); };
    applySettings();
    ctx.on("settings", applySettings);
    ctx.on("memo-ready", render);

    ctx.every(250, render);  // 경과 시간·실시간 표시 갱신 (이 모드가 켜져 있을 때만)

    return {
      update(state) { last = state; render(); },
    };
  },
});
})();

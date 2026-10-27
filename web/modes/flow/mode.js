/* 🌊 흐름 모드: Claude가 어떻게 생각하고 일하는지를 '강'으로 그린다.
   · 생각의 강(메인): 선택한 세션의 한 요청 구간. 왼→오 시간, 메인 강 + 서브에이전트 지류(갈라짐/합류),
     단계 색(이해·탐색·계획·수정·검증·위임·대기), 도구 호출 점, 발화 말풍선, 실패 소용돌이, 90초+ 공백 = 조용히 생각
   · 탐험 지도: 강의 구간/지류를 누르면 그 구간에서 다녀간 파일·명령을 섬 지도로 (오른쪽 서랍), 또는 요청 전체를 지도 뷰로
   · 돌아보기: 요청을 마인드맵으로 (발화 문구 휴리스틱이라 판단 분류는 틀릴 수 있음)
   데이터는 이 모드 전용 서버 엔드포인트 /trace 를 2초마다 증분 폴링(since 커서). 탭이 숨겨지면 멈추고,
   타이머·리스너는 ctx로만 만들어 unmount 때 자동 정리 → 다른 모드에선 /trace 요청 0회. */
(() => {
"use strict";
const C = window.Core;
const { esc } = C;

const PH = { understand: "이해", explore: "탐색", plan: "계획", edit: "수정", verify: "검증", delegate: "위임", report: "보고", wait: "대기" };
const ACT = { read: "읽기", edit: "수정", run: "실행", search: "검색", agent: "위임", web: "웹", plan: "할 일", other: "도구" };
const ACT_ICON = { read: "📖", edit: "✏️", run: "⌨️", search: "🔎", agent: "🤖", web: "🌐", plan: "🗒️", other: "🧰" };
const CLAIM = { decision: "결정", conclusion: "결론", hypothesis: "가설", check: "확인", note: "메모" };
const RANK = { needs_input: 0, working: 1, agents: 2, done: 3, idle: 4 };
const ST_TXT = { needs_input: "입력 필요", working: "작업 중", agents: "에이전트", done: "완료", idle: "대기" };
const LANE_COL = ["#ff7eb6", "#a48cff", "#ffd166", "#5ee0c4", "#ff9f6b", "#7cc4ff", "#c3e88d", "#f78c6c"];
const EMO = { Explore: "🔎", Plan: "📐", "general-purpose": "🛠️", "claude-code-guide": "📚" };
const GAP = 90, POLL_MS = 2000, PADL = 56, PADR = 150, GAPW = 64;

const two = n => String(n).padStart(2, "0");
const hm = e => { const d = new Date(e * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const hms = e => `${hm(e)}:${two(new Date(e * 1000).getSeconds())}`;
const span = s => (s = Math.max(1, Math.round(s))) < 60 ? `${s}초` : s < 3600
  ? `${Math.floor(s / 60)}분${s % 60 >= 5 ? ` ${s % 60}초` : ""}` : `${Math.floor(s / 3600)}시간 ${Math.floor(s % 3600 / 60)}분`;
const clean = t => String(t || "").replace(/\*\*|`|#+\s|\|/g, "").replace(/\s+/g, " ").trim();
const cut = (t, n) => (t = String(t || "")).length > n ? t.slice(0, n - 1) + "…" : t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const f1 = n => Math.round(n * 10) / 10;
const laneEmoji = l => l.id === "main" ? "🧭" : EMO[l.type] || "🤖";
const actOf = s => s.ok === false ? "fail" : (s.act || "other");
// 명령의 머리(실행 파일 + 하위 명령)만 남겨 지도에서 같은 종류의 명령을 한 곳으로 묶음
const cmdHead = c => { const w = String(c || "").replace(/^(cd \S+ (&&|;) ?)+/, "").trim().split(/\s+/).filter(x => !/^-/.test(x)); return cut(w.slice(0, /^(git|npm|npx|pnpm|yarn|docker|kubectl|python3?|node|go|cargo|make|gh)$/.test(w[0]) ? 2 : 1).join(" ") || "명령", 26); };
const setHTML = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };
// 뒤에서부터 찾기
// 글자 폭 대략치 (한글·이모지 넓게)
const textW = (t, size) => [...String(t)].reduce((w, ch) => w + (/[\u1100-\uffff]/.test(ch) ? (ch.codePointAt(0) > 0xffff ? 1.25 : .95) : .56), 0) * size;
function placeLabels(labels, placed = []) {
  const out = [];
  for (const q of labels.slice().sort((a, b) => b.pri - a.pri)) {
    const w = textW(q.text, q.size), x = q.anchor === "middle" ? q.x0 - w / 2 : q.x0;
    for (const dy of q.dys) {
      const r = { x, y: q.y0 + dy - q.size, w, h: q.size + 4 + q.extraH };
      if (placed.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) continue;
      placed.push(r); out.push(q.html(q.y0 + dy)); break;
    }
  }
  return out.join("");
}
function lastIdx(arr, t, key = "t") { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][key] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }

const MARKUP = `
<header class="fl-top">
  <div class="fl-brand"><span class="fl-logo">🌊</span><div><b>흐름</b><small>Claude의 생각 흐름</small></div></div>
  <nav class="fl-sess" aria-label="세션"></nav>
  <div class="fl-right"><span class="fl-live"><i></i><span class="fl-clock"></span></span></div>
</header>
<div class="fl-bar">
  <div class="fl-views" role="tablist">
    <button data-view="river" role="tab">🌊<span> 생각의 강</span></button>
    <button data-view="map" role="tab">🗺️<span> 탐험 지도</span></button>
    <button data-view="mind" role="tab">🧠<span> 돌아보기</span></button>
  </div>
  <label class="fl-req"><b>요청</b><select aria-label="요청 선택"></select></label>
  <div class="fl-legend"></div>
</div>
<main class="fl-stage">
  <div class="fl-scroll"><div class="fl-canvas"><svg class="fl-svg" xmlns="http://www.w3.org/2000/svg"></svg><div class="fl-bubs"></div></div></div>
  <div class="fl-mapview" hidden></div>
  <div class="fl-mind" hidden></div>
  <aside class="fl-now" hidden></aside>
  <aside class="fl-drawer" hidden></aside>
  <div class="fl-empty" hidden></div>
</main>`;

C.registerMode({
  id: "flow", label: "흐름", icon: "🌊",
  texts: {
    title: ({ calling, working }) => calling ? `(${calling}) 입력 필요 · 흐름` : working ? `🌊 ${working}개 흐르는 중` : "🌊 흐름",
  },
  mount(root, ctx) {
    const doc = ctx.doc;
    root.innerHTML = MARKUP;
    const $ = s => root.querySelector(s);
    $(".fl-right").append(ctx.switcher);
    const el = {
      sess: $(".fl-sess"), clock: $(".fl-clock"), live: $(".fl-live"), req: $(".fl-req select"), legend: $(".fl-legend"),
      stage: $(".fl-stage"), scroll: $(".fl-scroll"), canvas: $(".fl-canvas"), svg: $(".fl-svg"), bubs: $(".fl-bubs"),
      mapview: $(".fl-mapview"), mind: $(".fl-mind"), now: $(".fl-now"), drawer: $(".fl-drawer"), empty: $(".fl-empty"),
    };
    let sid = C.store.get("flow:sid"), pinned = false, promptSel = "last";
    let view = C.store.get("flow:view", "river");
    if (!["river", "map", "mind"].includes(view)) view = "river";
    let D = null, inflight = null, dead = false, sel = null, netErr = false, lastSig = "", stick = true;

    el.legend.innerHTML = Object.entries(PH).filter(([k]) => k !== "report")
      .map(([k, n]) => `<span><i class="sw-${k}"></i>${n}</span>`).join("") +
      `<span class="lg-fail">🌀 실패·재시도</span><span class="lg-quiet">💭 조용히 생각</span>`;

    /* ---------- 세션 선택 ---------- */
    function sessions() {
      const st = ctx.state; if (!st) return [];
      const now = ctx.now();
      return st.sessions.map(s => ({ s, st: C.sessionStatus(s, now) }))
        .sort((a, b) => (RANK[a.st] ?? 5) - (RANK[b.st] ?? 5) || b.s.last - a.s.last);
    }
    function pickSession(list) {
      if (!list.length) return null;
      const cur = list.find(x => x.s.sid === sid);
      if (cur && (pinned || RANK[cur.st] <= 2)) return sid;
      const best = list[0];
      if (!cur) return best.s.sid;
      return RANK[best.st] <= 2 ? best.s.sid : sid;
    }
    function selectSession(id, byUser) {
      if (byUser) pinned = true;
      if (id === sid && D) return;
      sid = id; promptSel = "last"; sel = null;
      C.store.set("flow:sid", id);
      reset(); poll();
    }
    function reset() { if (inflight) inflight.abort(); inflight = null; D = null; lastSig = ""; stick = true; render(); }
    function drawTabs(list) {
      const html = list.slice(0, 7).map(({ s, st }) => {
        const stall = s.health && s.health.level === "stall";
        return `<button class="fl-tab st-${st}${stall ? " stall" : ""}${s.sid === sid ? " on" : ""}" data-sid="${esc(s.sid)}" title="${esc(s.prompt || "")}">
          <i></i><b>${esc(s.project || "?")}</b><small>${stall ? "멈춤 의심" : ST_TXT[st] || st}${s.agents && s.agents.some(a => a.status === "running") ? ` · 🤖${s.agents.filter(a => a.status === "running").length}` : ""}</small></button>`;
      }).join("") + (list.length > 7 ? `<span class="fl-more">+${list.length - 7}</span>` : "");
      setHTML(el.sess, html || `<span class="fl-none">지켜볼 세션 없음</span>`);
    }
    el.sess.onclick = e => { const b = e.target.closest("[data-sid]"); if (b) selectSession(b.dataset.sid, true); };
    el.req.onchange = () => { promptSel = el.req.value; sel = null; reset(); poll(); };
    root.querySelector(".fl-views").onclick = e => {
      const b = e.target.closest("[data-view]"); if (!b) return;
      view = b.dataset.view; C.store.set("flow:view", view); lastSig = ""; render();
    };

    /* ---------- trace 폴링 (이 모드가 떠 있을 때만, Core.api 경유) ---------- */
    async function poll() {
      if (dead || !sid || doc.hidden || inflight) return;
      const key = sid + "|" + promptSel;
      const since = D && D.key === key && !D.err ? D.cursor : "";
      const ac = new AbortController(); inflight = ac;
      try {
        const j = await ctx.api.trace({ session: sid, prompt: promptSel, since }, ac.signal);
        if (dead || key !== sid + "|" + promptSel) return;
        merge(j, key); netErr = false;
      } catch (e) { if (e.name !== "AbortError") netErr = true; }
      finally { if (inflight === ac) inflight = null; }
      if (!dead) render();
    }
    function merge(j, key) {
      if (j.error) { D = { key, err: j.error }; return; }
      if (!D || D.key !== key || D.err || j.full) D = { key, steps: new Map() };
      for (const s of j.steps) D.steps.set(s.lane + ":" + s.s, s);
      if (j.older) for (const [k, s] of D.steps) if (s.t < j.older.cut) D.steps.delete(k);
      Object.assign(D, { lanes: j.lanes, older: j.older, prompts: j.prompts, prompt: j.prompt, cursor: j.cursor,
        project: j.project, total: j.total });
      D.list = [...D.steps.values()].sort((a, b) => a.t - b.t || (a.lane === b.lane ? a.s - b.s : 0));
      D.laneOf = Object.fromEntries(D.lanes.map((l, i) => [l.id, Object.assign(l, { idx: i, col: i ? LANE_COL[(i - 1) % LANE_COL.length] : "var(--fl-ink)" })]));
    }
    ctx.every(POLL_MS, poll);
    ctx.listen(doc, "visibilitychange", () => { if (!doc.hidden) poll(); });
    ctx.listen(ctx.win, "resize", () => { lastSig = ""; render(); });
    ctx.listen(doc, "keydown", e => { if (e.key === "Escape" && sel) { sel = null; lastSig = ""; render(); } });
    ctx.every(1000, () => { el.clock.textContent = hms(ctx.now()); });
    el.scroll.addEventListener("scroll", () => { stick = el.scroll.scrollLeft + el.scroll.clientWidth >= el.scroll.scrollWidth - 40; }, { passive: true });

    /* ---------- 그리기 ---------- */
    function isLive() {
      if (!D || !D.lanes) return false;
      return (D.prompt.last && D.lanes[0].status !== "done") || D.lanes.some(l => l.status === "running");
    }
    function render() {
      if (dead) return;
      const list = sessions();
      const want = pickSession(list);
      if (want && want !== sid) { selectSession(want, false); return; }
      drawTabs(list);
      el.clock.textContent = hms(ctx.now());
      for (const b of root.querySelectorAll(".fl-views button")) b.classList.toggle("on", b.dataset.view === view), b.setAttribute("aria-selected", b.dataset.view === view);
      // 요청 선택
      if (D && D.prompts) {
        const opts = D.prompts.slice().reverse().slice(0, 12).map((p, k) =>
          `<option value="${k === 0 ? "last" : p.i}">${k === 0 ? "최근 · " : ""}${hm(p.t)} ${esc(cut(p.text || "(요청 기록 없음)", 60))}</option>`);
        if (promptSel !== "last" && !D.prompts.slice(-12).some(p => String(p.i) === String(promptSel)))
          opts.push(`<option value="${esc(promptSel)}">${esc(cut(D.prompt.text, 60))}</option>`);
        setHTML(el.req, opts.join(""));
        el.req.value = promptSel === "last" || (D.prompt.last && +promptSel === D.prompt.i) ? "last" : String(promptSel);
        el.req.title = D.prompt.text || "";
      } else setHTML(el.req, `<option>—</option>`);
      const live = isLive();
      el.live.classList.toggle("on", live);
      // 빈 상태
      let empty = "";
      if (!ctx.state) empty = `<b>대기실 서버에 연결하는 중…</b>`;
      else if (!list.length) empty = `<div class="fl-e-ico">🏞️</div><b>지금 지켜볼 세션이 없어요</b><p>Claude Code에서 요청을 보내면 여기에 생각의 강이 흐르기 시작해요.</p>`;
      else if (!D) empty = netErr ? `<b>흐름을 불러오지 못했어요</b><p>서버가 /trace를 지원하는 새 버전인지 확인해 주세요.</p>` : `<div class="fl-e-ico">🌊</div><b>강물을 끌어오는 중…</b>`;
      else if (D.err === "no-transcript") empty = `<div class="fl-e-ico">📭</div><b>이 세션의 트랜스크립트를 찾지 못했어요</b><p>Claude Code가 아직 기록을 남기지 않았거나(방금 시작), 다른 위치(~/.claude/projects 밖)에 있어요.<br>다른 세션을 골라 보세요.</p>`;
      else if (D.err) empty = `<b>흐름을 읽을 수 없어요</b><p>${esc(D.err)}</p>`;
      else if (!D.list.length && !(D.older && D.older.bins.length)) empty = `<div class="fl-e-ico">💭</div><b>${D.prompt.last && live ? "생각을 시작하는 중…" : "이 요청엔 도구 호출이나 발화 기록이 없어요"}</b><p>${esc(cut(D.prompt.text, 140))}</p>`;
      el.empty.hidden = !empty; setHTML(el.empty, empty);
      const show = !empty;
      el.scroll.hidden = !(show && view === "river");
      el.now.hidden = !(show && view === "river");
      el.mapview.hidden = !(show && view === "map");
      el.mind.hidden = !(show && view === "mind");
      el.drawer.hidden = !(show && sel && view === "river");
      if (!show) return;
      const W = el.stage.clientWidth, H = el.stage.clientHeight;
      const sig = [D.cursor, view, W, H, sel && sel.key, live ? Math.floor(ctx.now() / 2) : ""].join("|");
      if (sig === lastSig) return;
      lastSig = sig;
      if (view === "river") { drawRiver(W, H, live); drawNow(live); drawDrawer(); }
      else if (view === "map") drawMapView(W, H);
      else drawMind(W, H, live);
    }

    /* ---------- 생각의 강 ---------- */
    function drawRiver(W, H, live) {
      const now = ctx.now(), lanes = D.lanes, main = lanes[0];
      const L = lanes.map(l => ({ l, pts: [], steps: [] }));
      const byId = Object.fromEntries(L.map(x => [x.l.id, x]));
      for (const s of D.list) {
        const b = byId[s.lane]; if (!b) continue;
        b.steps.push(s);
        if (s.kind === "tool") b.pts.push({ t: s.t, w: 1, p: s.phase });
        else if (s.lane === "main" && s.kind === "say" && s.phase === "plan") b.pts.push({ t: s.t, w: .5, p: "plan" });
      }
      if (D.older) for (const bn of D.older.bins) { const b = byId[bn.lane]; if (b) b.pts.push({ t: bn.t + 30, w: bn.n, p: bn.phase, bin: 1 }); }
      for (const b of L) b.pts.sort((x, y) => x.t - y.t);
      // 각 레인의 시간 범위
      const agentsEnd = Math.max(0, ...L.slice(1).map(b => b.l.status === "running" ? now : (b.l.t_join || b.l.t_end)));
      for (const b of L) {
        const l = b.l;
        b.tb = l.t_start;
        if (l.id === "main") b.te = live ? now : Math.max(l.t_end, agentsEnd);
        else b.te = l.status === "running" ? Math.max(now, l.t_end) : (l.t_join || l.t_end);
        b.te = Math.max(b.te, b.tb + 1);
        b.join = l.id !== "main" && l.status !== "running";
      }
      // 시간축: 모든 레인을 합쳐 90초 넘게 아무 일도 없는 구간은 고정 폭으로 압축
      const times = [];
      for (const b of L) { times.push(b.tb, b.te); for (const p of b.pts) times.push(p.t); }
      const ts = [...new Set(times.map(t => Math.round(t)))].sort((a, b) => a - b);
      let active = 0, gaps = 0;
      for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > GAP) gaps++; else active += g; }
      const padR = W >= 1000 ? Math.min(400, W * .3) : PADR;
      const k = clamp((W - PADL - padR - gaps * GAPW) / Math.max(active, 1), .35, 6);
      const bp = [{ t: ts[0] - 6, x: PADL - 6 * k }];
      bp[0].x = PADL - 6 * Math.min(k, 3);
      let x = PADL;
      bp.push({ t: ts[0], x });
      for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; x += g > GAP ? GAPW : g * k; bp.push({ t: ts[i], x, gap: g > GAP }); }
      const CW = Math.max(W, x + padR);
      const xOf = t => { const i = clamp(lastIdx(bp, t), 0, bp.length - 2); const a = bp[i], b = bp[i + 1]; if (t >= b.t) return b.x + (t - b.t) * Math.min(k, 3); return a.x + (b.x - a.x) * (t - a.t) / ((b.t - a.t) || 1); };
      const tOf = xx => { const i = clamp(lastIdx(bp, xx, "x"), 0, bp.length - 2); const a = bp[i], b = bp[i + 1]; if (xx >= b.x) return b.t + (xx - b.x) / Math.min(k, 3); return a.t + (b.t - a.t) * (xx - a.x) / ((b.x - a.x) || 1); };
      // 지류 배치: 시간이 겹치지 않으면 같은 줄을 나눠 씀
      const rows = [];
      for (const b of L.slice(1).sort((p, q) => p.tb - q.tb)) {
        const xs = xOf(b.tb) - 20, xe = Math.max(xOf(b.te) + 30, xs + 270);
        for (let r = 0; ; r++) {
          const side = r % 2 ? 1 : -1, lvl = (r >> 1) + 1;
          const row = rows[r] || (rows[r] = { side, lvl, occ: [] });
          if (!row.occ.some(([a, c]) => xs < c && xe > a)) { row.occ.push([xs, xe]); b.side = side; b.lvl = lvl; break; }
        }
      }
      const A = Math.max(0, ...L.filter(b => b.side < 0).map(b => b.lvl)), B = Math.max(0, ...L.filter(b => b.side > 0).map(b => b.lvl));
      const top = 66, bottom = 46, usable = H - top - bottom;
      const sp = Math.min(150, usable / (A + B + 1));
      const mainY = top + (usable - (A + B) * sp) / 2 + A * sp;
      for (const b of L) b.y = b.l.id === "main" ? mainY : mainY + b.side * b.lvl * sp;
      const halfMax = clamp(sp * .17, 6, 12);
      // 굵기 = 주변 ±40초의 도구 호출 수, 위치 = 갈라짐/합류 곡선
      for (const b of L) {
        const xb = xOf(b.tb), xe = xOf(b.te), F = Math.max(4, Math.min(80, (xe - xb) / 2.2)), xj = xe;
        b.xb = xb; b.xe = xe;
        b.yAt = xx => {
          if (b.l.id === "main") return mainY;
          let y = b.y;
          if (xx < xb + F) y = mainY + (b.y - mainY) * smooth((xx - xb) / F);
          if (b.join && xx > xj - F) y = mainY + (b.y - mainY) * smooth((xj - xx) / F);
          return y;
        };
        const pt = b.pts, nT = pt.map(p => p.t);
        b.wAt = xx => {
          const t = tOf(xx); let n = 0;
          for (let i = Math.max(0, lastIdx(pt, t - 40)); i < pt.length && pt[i].t <= t + 40; i++) if (pt[i].t >= t - 40) n += pt[i].w;
          let w = 3.5 + Math.min(halfMax * 2 - 3.5, n * 2.1);
          if (b.l.id !== "main") { w *= Math.min(1, .3 + .7 * (xx - xb) / 60); if (b.join) w *= Math.min(1, .3 + .7 * (xe - xx) / 60); }
          return w;
        };
        // 단계 판정: 마지막으로 지난 점의 단계, 메인은 에이전트를 기다리는 긴 공백 = 대기
        const agentRun = t => L.some(o => o !== b && o.l.id !== "main" && o.tb <= t && o.te >= t);
        b.phAt = t => {
          const i = lastIdx(pt, t);
          if (!pt.length) return b.l.id === "main" ? "plan" : "understand";
          const cur = pt[Math.max(0, i)], nx = pt[i + 1];
          if (b.l.id === "main") {
            const gapEnd = nx ? nx.t : b.te;
            if (i >= 0 && gapEnd - cur.t > GAP && t > cur.t + 8 && agentRun(t)) return "wait";
          }
          return cur.p || "understand";
        };
        const samp = [];
        for (let xx = xb; xx <= xe + .01; xx += 4) samp.push(xx);
        if (samp[samp.length - 1] < xe) samp.push(xe);
        b.samp = samp.map(xx => ({ x: xx, y: b.yAt(xx), w: b.wAt(xx), p: b.phAt(tOf(xx)) }));
        void nT;
      }
      const out = [];
      const add = s => out.push(s);
      // 축·그리드
      const minStep = [1, 2, 5, 10, 15, 30, 60].find(m => m * 60 * k >= 84) || 120;
      const ticks = [];
      for (let i = 1; i < bp.length; i++) {
        const a = bp[i - 1], b = bp[i];
        if (b.gap) {
          const xm = (a.x + b.x) / 2;
          add(`<g class="fl-brk"><rect x="${f1(a.x + 6)}" y="${top - 8}" width="${f1(b.x - a.x - 12)}" height="${f1(H - top - bottom + 14)}" rx="8"/>` +
            `<text x="${f1(xm)}" y="${H - 18}" text-anchor="middle">≈ ${esc(span(b.t - a.t))}</text></g>`);
          continue;
        }
        const st = minStep * 60;
        for (let t = Math.ceil(a.t / st) * st; t < b.t; t += st) ticks.push(t);
      }
      let lastTx = -1e9;
      for (const t of ticks) {
        const tx = xOf(t); if (tx - lastTx < 60) continue; lastTx = tx;
        add(`<line class="fl-grid" x1="${f1(tx)}" x2="${f1(tx)}" y1="${top - 10}" y2="${H - bottom + 6}"/><text class="fl-axis" x="${f1(tx)}" y="${H - 18}" text-anchor="middle">${hm(t)}</text>`);
      }
      // 강
      const bandsOut = [], marks = [], labels = [], heads = [], lblRects = [];
      // 글자 겹침 방지: 우선순위 높은 것부터 놓고, 겹치면 세로로 조금 옮겨 보고 안 되면 생략
      const lab = (pri, text, x0, y0, anchor, size, html, dys = [0], extraH = 0) => labels.push({ pri, text, x0, y0, anchor, size, html, dys, extraH });
      L.forEach(b => {
        const s = b.samp; if (s.length < 2) return;
        const col = b.l.col;
        const topE = s.map(q => `${f1(q.x)},${f1(q.y - q.w / 2 - 6)}`), botE = s.slice().reverse().map(q => `${f1(q.x)},${f1(q.y + q.w / 2 + 6)}`);
        bandsOut.push(`<polygon class="fl-glow" points="${topE.concat(botE).join(" ")}" style="fill:${col}"/>`);
        // 단계별 띠 (같은 단계 연속 구간 = 다각형 하나, 누르면 탐험 지도)
        let i0 = 0;
        for (let i = 1; i <= s.length; i++) {
          if (i < s.length && s[i].p === s[i0].p) continue;
          const seg = s.slice(i0, Math.min(i + 1, s.length));
          const pts = seg.map(q => `${f1(q.x)},${f1(q.y - q.w / 2)}`).concat(seg.slice().reverse().map(q => `${f1(q.x)},${f1(q.y + q.w / 2)}`));
          const t0 = tOf(seg[0].x), t1 = tOf(seg[seg.length - 1].x);
          const on = sel && sel.lane === b.l.id && sel.t0 <= t0 + 1 && sel.t1 >= t1 - 1;
          bandsOut.push(`<polygon class="fl-band ph-${s[i0].p}${on ? " sel" : ""}" points="${pts.join(" ")}" data-lane="${esc(b.l.id)}" data-t0="${t0}" data-t1="${t1}" data-p="${s[i0].p}"><title>${PH[s[i0].p]} · ${hm(t0)}–${hm(t1)} · 눌러서 탐험 지도</title></polygon>`);
          const wpx = seg[seg.length - 1].x - seg[0].x;
          if (wpx >= 46 && s[i0].p !== "wait") {
            const mid = seg[seg.length >> 1];
            const ph = s[i0].p;
            lab(1, PH[ph], mid.x, mid.y - mid.w / 2 - 7, "middle", 10.5, y => `<text class="fl-plabel ph-t-${ph}" x="${f1(mid.x)}" y="${f1(y)}" text-anchor="middle">${PH[ph]}</text>`);
          }
          i0 = i;
        }
        const cl = "M" + s.map(q => `${f1(q.x)},${f1(q.y)}`).join(" L");
        const running = b.l.status === "running" || (b.l.id === "main" && live);
        bandsOut.push(`<path class="fl-flow${running ? " run" : ""}" d="${cl}"/>`);
        // 도구 호출 점·실패 소용돌이
        let lastFailX = -1e9;
        b.steps.forEach((st, j) => {
          if (st.kind === "think" && st.dur_ms >= 20000) {
            const tx = xOf(st.t), ty = b.yAt(tx);
            marks.push(`<circle class="fl-think" cx="${f1(tx)}" cy="${f1(ty)}" r="5"><title>💭 ${hms(st.t)} · ${span(st.dur_ms / 1000)} 생각${st.text ? " · " + esc(st.text) : ""}</title></circle>`);
            return;
          }
          if (st.kind !== "tool") return;
          const tx = xOf(st.t), w = b.wAt(tx), ty = b.yAt(tx) + (((st.s * 7) % 9) - 4) * w / 18;
          const a = actOf(st);
          const tip = `${hms(st.t)} · ${esc(st.tool)} ${esc(st.target || "")}${st.dur_ms != null ? ` · ${span(st.dur_ms / 1000)}` : st.ok == null ? " · 실행 중" : ""}${st.err ? "\n✗ " + esc(st.err) : ""}`;
          if (a === "fail") {
            let d = ""; for (let q = 0; q <= 46; q++) { const ang = q * .34, r = 1.2 + q * .26; d += (q ? "L" : "M") + f1(tx + Math.cos(ang) * r) + "," + f1(ty + Math.sin(ang) * r * .75); }
            marks.push(`<g class="fl-whirl"><path d="${d}"/><circle cx="${f1(tx)}" cy="${f1(ty)}" r="11" class="hit"><title>${tip}</title></circle></g>`);
            if (tx - lastFailX > 150) {
              const nxt = b.steps.slice(j + 1).find(z => z.kind === "tool");
              const retry = nxt && (nxt.tool === st.tool || (nxt.target && nxt.target === st.target) || nxt.act === st.act);
              const ft = `🌀 ${st.tool} 실패${retry ? ` → ${nxt.tool}로 재시도` : ""}`;
              lab(3, ft, tx - 6, ty + w / 2 + 24, "start", 10.5, y => `<text class="fl-fail" x="${f1(tx - 6)}" y="${f1(y)}">${esc(ft)}</text>`, [0, 14, -40]);
              lastFailX = tx;
            }
            return;
          }
          marks.push(`<circle class="fl-dot a-${a}" cx="${f1(tx)}" cy="${f1(ty)}" r="${a === "agent" ? 4.6 : st.ok == null ? 3.4 : 2.7}"><title>${tip}</title></circle>`);
        });
        // 긴 침묵 (레인별 90초+ 공백)
        const pt = b.pts.filter(p => !p.bin);
        const gapsL = [];
        for (let i = 1; i < pt.length; i++) if (pt[i].t - pt[i - 1].t > GAP) gapsL.push([pt[i - 1].t, pt[i].t]);
        if (pt.length && live && (b.l.status === "running" || (b.l.id === "main" && b.l.status !== "done")) && now - pt[pt.length - 1].t > GAP) gapsL.push([pt[pt.length - 1].t, now, 1]);
        if (b.l.id === "main" && pt.length && !live && b.te - pt[pt.length - 1].t > GAP) gapsL.push([pt[pt.length - 1].t, b.te, 2]);
        for (const [g0, g1, open] of gapsL) {
          const x0 = xOf(g0), x1 = xOf(g1), xm = (x0 + x1) / 2, y = b.yAt(xm);
          if (x1 - x0 < 50 && !open) continue;
          const waiting = b.l.id === "main" && L.some(o => o.l.id !== "main" && o.tb < g1 && o.te > g0 + 5);
          const txt = waiting ? (open ? "⏳ 에이전트 기다리는 중" : "⏳ 에이전트 결과 기다림") : `💭 ${span(g1 - g0)}${open === 1 ? "째" : ""} 조용히 생각`;
          const lx = open === 1 ? Math.max(x0 + 40, x1 - 70) : xm;
          lab(open ? 4 : 2, txt, lx, y + b.wAt(xm) / 2 + 18, "middle", 10.5, yy => `<text class="fl-quiet${waiting ? " wait" : ""}" x="${f1(lx)}" y="${f1(yy)}" text-anchor="middle">${txt}</text>`, [0, 13]);
        }
        // 이름표
        const nx = b.l.id === "main" ? PADL - 4 : b.xb + Math.min(90, (b.xe - b.xb) / 2 + 10);
        const ny = b.l.id === "main" ? mainY + 34 : b.y - (b.side < 0 ? 26 : 26);
        const meta = b.l.id === "main" ? (D.project ? `메인 흐름 · ${D.project}` : "메인 흐름") : `${b.l.type} · ${hm(b.l.t_start)} 출발${b.l.status === "running" ? "" : ` · ${span(b.te - b.tb)}`}`;
        const nm = `${laneEmoji(b.l)} ${cut(b.l.desc, 30)}`;
        lab(9, nm.length > meta.length ? nm : meta, nx, ny, "start", 12, yy => `<g class="fl-lname" data-lane="${esc(b.l.id)}"><text x="${f1(nx)}" y="${f1(yy)}">${esc(nm)}</text><text class="sub" x="${f1(nx)}" y="${f1(yy + 13)}">${esc(meta)}</text></g>`, [0], 16);
        // 갈라짐·합류 표시
        if (b.l.id !== "main") {
          marks.push(`<circle class="fl-fork" cx="${f1(b.xb)}" cy="${f1(mainY)}" r="5.5" style="stroke:${col}"/>`);
          if (b.join) marks.push(`<g class="fl-join" style="--c:${col}"><circle cx="${f1(b.xe)}" cy="${f1(mainY)}" r="7"/><text x="${f1(b.xe)}" y="${f1(mainY + 3.5)}" text-anchor="middle">✓</text></g>`);
        }
        // 지금 위치 (흐르는 레인의 머리)
        if (running) {
          const hx = b.l.id === "main" ? xOf(now) : xOf(Math.max(now, b.tb));
          heads.push(`<g class="fl-head" transform="translate(${f1(hx)},${f1(b.yAt(hx))})" style="--c:${b.l.id === "main" ? "var(--fl-ink)" : col}"><circle class="rip" r="10"/><circle class="core" r="4.6"/></g>`);
        }
      });
      if (live) {
        const nx = xOf(now);
        add(`<line class="fl-nowline" x1="${f1(nx)}" x2="${f1(nx)}" y1="${top - 14}" y2="${H - bottom + 6}"/><text class="fl-axis now" x="${f1(nx)}" y="${H - 4}" text-anchor="middle">지금 ${hms(now)}</text>`);
      }
      // 이전 단계 요약 구간 표시
      if (D.older) add(`<text class="fl-axis" x="${f1(xOf(D.older.cut))}" y="${top - 18}" text-anchor="end">← 오래된 ${D.total - D.list.length}단계는 분 단위로 요약</text>`);
      el.svg.setAttribute("width", CW); el.svg.setAttribute("height", H);
      el.svg.setAttribute("viewBox", `0 0 ${CW} ${H}`);
      el.canvas.style.width = CW + "px"; el.canvas.style.height = H + "px";
      el.svg.innerHTML = `<defs><filter id="fl-soft" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>` +
        out.join("") + bandsOut.join("") + marks.join("") + placeLabels(labels, lblRects) + heads.join("");
      drawBubbles(L, xOf, CW, H, top, bottom, lblRects);
      if (stick) el.scroll.scrollLeft = el.scroll.scrollWidth;
    }

    function drawBubbles(L, xOf, CW, H, top, bottom, obstacles) {
      const now = ctx.now(), picks = [];
      for (const b of L) {
        const says = b.steps.filter(s => (s.kind === "say" || (s.kind === "think" && s.text)) && clean(s.text).length > 8);
        let lastX = 1e9, n = 0;
        const minGap = b.l.id === "main" ? 230 : 260, max = b.l.id === "main" ? 6 : 2;
        for (let i = says.length - 1; i >= 0 && n < max; i--) {
          const s = says[i], x = xOf(s.t);
          if (b.l.id !== "main" && !/conclusion|decision|hypothesis/.test(s.claim)) continue;
          if (lastX - x < minGap) continue;
          lastX = x; n++;
          picks.push({ s, b, x, y: b.yAt(x) });
        }
      }
      picks.sort((p, q) => q.s.t - p.s.t);
      const take = picks.slice(0, 12);
      el.bubs.innerHTML = take.map((p, i) => {
        const t = clean(p.s.text), fresh = now - p.s.t < 25;
        return `<div class="fl-bub${fresh ? " new" : ""}${p.s.kind === "think" ? " think" : ""}${i > 4 ? " old" : ""}" data-i="${i}"><div class="w">${laneEmoji(p.b.l)} ${hm(p.s.t)} · ${CLAIM[p.s.claim] || "발화"}${p.s.kind === "think" ? " · 속생각" : ""}</div>${esc(cut(t, 96))}</div>`;
      }).join("");
      // 겹치지 않게 배치: 강 위/아래 후보 중 다른 말풍선·강과 안 겹치는 자리
      const placed = [], tails = [], obs = obstacles.map(o => ({ x: o.x - 4, y: o.y - 3, w: o.w + 8, h: o.h + 6 }));
      const hitsRiver = (r) => L.some(b => b.samp.some((q, i) => i % 3 === 0 && q.x > r.x - 4 && q.x < r.x + r.w + 4 && q.y + q.w / 2 + 4 > r.y && q.y - q.w / 2 - 4 < r.y + r.h));
      const free = r => r.y >= top - 6 && r.y + r.h <= H - bottom && r.x >= 4 && r.x + r.w <= CW - 4 &&
        !placed.concat(obs).some(o => r.x < o.x + o.w + 8 && r.x + r.w + 8 > o.x && r.y < o.y + o.h + 6 && r.y + r.h + 6 > o.y) && !hitsRiver(r);
      [...el.bubs.children].forEach((d, i) => {
        const p = take[i], w = d.offsetWidth, h = d.offsetHeight;
        const prefer = p.b.l.id === "main" ? (i % 2 ? 1 : -1) : (p.b.side || -1);
        const cands = [];
        for (const side of [prefer, -prefer]) for (const off of [30, 56, 90, 130, 175]) for (const dx of [-24, -w + 30, -w / 2, 40, -w - 40])
          cands.push({ x: clamp(p.x + dx, 6, CW - w - 6), y: side < 0 ? p.y - off - h : p.y + off, w, h, side });
        const r = cands.find(free);
        if (!r) { d.remove(); return; }
        placed.push(r);
        d.style.left = r.x + "px"; d.style.top = r.y + "px";
        tails.push(`<line class="fl-tail" x1="${f1(p.x)}" y1="${f1(p.y + (r.side < 0 ? -6 : 6))}" x2="${f1(p.x)}" y2="${f1(r.side < 0 ? r.y + r.h : r.y)}"/><circle class="fl-saydot" cx="${f1(p.x)}" cy="${f1(p.y)}" r="3"/>`);
      });
      el.svg.insertAdjacentHTML("beforeend", tails.join(""));
    }

    function drawNow(live) {
      const now = ctx.now();
      const order = D.lanes.slice().sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || a.idx - b.idx);
      const rows = order.slice(0, 6).map(l => {
        const steps = D.list.filter(s => s.lane === l.id);
        const lastTool = [...steps].reverse().find(s => s.kind === "tool");
        const lastAny = steps[steps.length - 1];
        let st;
        if (l.id === "main") st = l.status === "waiting" ? `<span class="mut">⏳ 에이전트 기다림</span>` : l.status === "done" ? `<span class="mut">✓ 끝남</span>` : "";
        else st = l.status === "running" ? "" : `<span class="mut">✓ 합류</span>`;
        if (!st) {
          const quiet = lastAny ? now - lastAny.t : 0;
          const ph = lastTool ? lastTool.phase : "understand";
          st = quiet > GAP ? `<span class="chip ph-c-understand">💭 ${span(quiet)}째 생각</span>` : `<span class="chip ph-c-${ph}">${PH[ph]}</span>`;
          st += `<span class="what">${lastTool ? esc(lastTool.tool + " " + cut(lastTool.target || "", 34)) : "생각 중"}</span>`;
        }
        return `<div class="row" data-lane="${esc(l.id)}"><span class="em" style="color:${l.col}">${laneEmoji(l)}</span><b>${esc(cut(l.desc, 14))}</b>${st}</div>`;
      });
      const more = order.length > 6 ? `<div class="row mut">+${order.length - 6}개 지류</div>` : "";
      const fails = D.lanes.reduce((n, l) => n + (l.fail || 0), 0);
      const tools = D.list.filter(s => s.kind === "tool").length;
      setHTML(el.now, `<div class="k">${live ? "지금 강 위에서" : "이 요청의 강"}<span>${D.total}단계 · 도구 ${tools}${fails ? ` · 🌀${fails}` : ""}</span></div>${rows.join("")}${more}`);
    }
    el.now.onclick = e => { const r = e.target.closest("[data-lane]"); if (r) openSel(r.dataset.lane); };

    /* ---------- 강 → 탐험 지도 서랍 ---------- */
    function openSel(lane, t0, t1, p) {
      const l = D.laneOf[lane]; if (!l) return;
      const whole = t0 == null;
      sel = { lane, t0: whole ? -Infinity : +t0, t1: whole ? Infinity : +t1, key: `${lane}|${t0}|${t1}`,
        label: `${laneEmoji(l)} ${l.desc}${whole ? " · 전체" : ` · ${PH[p] || ""} ${hm(+t0)}–${hm(+t1)}`}` };
      lastSig = ""; render();
    }
    el.svg.addEventListener("click", e => {
      const b = e.target.closest("[data-lane]"); if (!b) return;
      if (b.dataset.t0) openSel(b.dataset.lane, b.dataset.t0, b.dataset.t1, b.dataset.p); else openSel(b.dataset.lane);
    });
    function drawDrawer() {
      if (!sel) { el.drawer.innerHTML = ""; return; }
      const steps = D.list.filter(s => s.lane === sel.lane && s.t >= sel.t0 - 1 && s.t <= sel.t1 + 1);
      el.drawer.innerHTML = `<div class="dh"><div><small>탐험 지도</small><b>${esc(cut(sel.label, 60))}</b></div><button class="x" aria-label="닫기">✕</button></div>
        <div class="dmap"></div><div class="dlist"></div>`;
      el.drawer.querySelector(".x").onclick = () => { sel = null; lastSig = ""; render(); };
      const m = el.drawer.querySelector(".dmap");
      drawMap(m, steps, m.clientWidth, m.clientHeight, true);
      el.drawer.querySelector(".dlist").innerHTML = topList(steps, 6) + stepList(steps);
    }

    /* ---------- 탐험 지도 ---------- */
    function islandOf(f) {
      if (/^scratch\//.test(f)) { const d = f.split("/").slice(1, -1); return "🧪 스크래치" + (d.length ? " · " + d.slice(-2).join("/") : ""); }
      if (/^(~|\/)/.test(f)) { const seg = f.split("/").filter(Boolean); return "📁 " + seg.slice(0, Math.min(2, seg.length - 1)).join("/"); }
      const i = f.lastIndexOf("/");
      return i < 0 ? "📦 프로젝트" : "📂 " + f.slice(0, i).split("/").slice(-2).join("/");
    }
    function mapModel(steps) {
      const nodes = new Map(), trans = new Map();
      const prevBy = {};
      for (const s of steps) {
        if (s.kind !== "tool") continue;
        const a = s.act || "other";
        let keys;
        if (s.files && s.files.length) keys = s.files.map(f => ["f:" + f, islandOf(f), f.split("/").pop()]);
        else if (a === "run" || a === "edit") { const h = cmdHead(s.cmd || s.target); keys = [["c:" + h, "⌨️ 터미널", h]]; }
        else if (a === "search") keys = [["q:" + cut(s.target, 22), "🔎 검색", cut(s.target, 22)]];
        else if (a === "web") keys = [["w:" + cut(s.target, 26), "🌐 바깥", cut(s.target, 26)]];
        else if (a === "agent") keys = [["a:" + cut(s.target, 22), "🤖 위임", cut(s.target, 22)]];
        else keys = [["o:" + s.tool, "🧰 도구", s.tool]];
        keys.forEach(([key, isl, label], ki) => {
          let n = nodes.get(key);
          if (!n) nodes.set(key, n = { key, isl, label, full: key.slice(2), visits: 0, acts: {}, fail: 0, last: 0, lanes: new Set() });
          n.visits++; n.acts[a] = (n.acts[a] || 0) + 1; n.last = Math.max(n.last, s.t); n.lanes.add(s.lane);
          if (s.ok === false) n.fail++;
          if (ki === 0) {
            const pv = prevBy[s.lane];
            if (pv && pv !== key) { const tk = pv + ">" + key; const t = trans.get(tk) || { a: pv, b: key, n: 0, act: a, fail: 0, t: 0 }; t.n++; t.act = a; t.t = s.t; t.fail += s.ok === false; trans.set(tk, t); }
            prevBy[s.lane] = key;
          }
        });
      }
      for (const n of nodes.values()) n.act = Object.entries(n.acts).sort((x, y) => y[1] - x[1])[0][0];
      // 섬: 많이 들른 순 8개, 나머지는 '기타'
      const isl = new Map();
      for (const n of nodes.values()) { const g = isl.get(n.isl) || { name: n.isl, nodes: [], visits: 0 }; g.nodes.push(n); g.visits += n.visits; isl.set(n.isl, g); }
      let groups = [...isl.values()].sort((a, b) => b.visits - a.visits);
      if (groups.length > 9) {
        const rest = groups.slice(8), other = { name: "🗂️ 기타", nodes: [], visits: 0 };
        for (const g of rest) { for (const n of g.nodes) { n.isl = other.name; other.nodes.push(n); } other.visits += g.visits; }
        groups = groups.slice(0, 8).concat(other);
      }
      return { nodes, trans: [...trans.values()], groups };
    }
    function drawMap(host, steps, W, H, compact) {
      const M = mapModel(steps);
      if (!M.nodes.size) { host.innerHTML = `<div class="fl-mempty">이 구간엔 다녀간 파일이나 명령이 없어요 (생각·발화만 있음)</div>`; return; }
      const cx = W / 2, cy = H / 2;
      // 섬 배치: 크기 비례 반지름, 간단한 밀어내기
      const G = M.groups;
      const scale = compact ? .75 : 1;
      G.forEach((g, i) => {
        g.nodes.sort((a, b) => b.visits - a.visits);
        g.r = (26 + 13 * Math.sqrt(g.nodes.length) + 3 * Math.sqrt(g.visits)) * scale;
        // 가장 큰 섬은 가운데, 나머지는 타원 고리 위에 고르게
        const ang = (i - 1) * 2 * Math.PI / Math.max(1, G.length - 1) - Math.PI / 2;
        const rx = i ? W * .33 : 0, ry = i ? H * .32 : 0;
        g.x = cx + Math.cos(ang) * rx; g.y = cy + Math.sin(ang) * ry;
      });
      // 넘치면 섬 크기를 줄임
      const area = G.reduce((t, g) => t + Math.PI * (g.r + 14) ** 2, 0), cap = W * H * .55;
      if (area > cap) { const f = Math.sqrt(cap / area); for (const g of G) g.r *= f; }
      for (let it = 0; it < 220; it++) {
        for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) {
          const a = G[i], b = G[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, need = a.r + b.r + 34;
          if (d < need) { const p = (need - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * p; a.y -= uy * p; b.x += ux * p; b.y += uy * p; }
        }
        for (const g of G) { g.x += (cx - g.x) * .004; g.y += (cy - g.y) * .006; g.x = clamp(g.x, g.r + 10, W - g.r - 10); g.y = clamp(g.y, g.r + 26, H - g.r - 10); }
      }
      // 섬 안의 노드: 해바라기 배치
      const pos = {};
      for (const g of G) g.nodes.forEach((n, j) => {
        const rr = g.nodes.length === 1 ? 0 : (g.r - 16) * Math.sqrt((j + .5) / g.nodes.length), ang = j * 2.39996;
        n.x = g.x + Math.cos(ang) * rr; n.y = g.y + 6 + Math.sin(ang) * rr * .85;
        n.r = (3.5 + 2.4 * Math.sqrt(n.visits)) * (compact ? .9 : 1);
        pos[n.key] = n;
      });
      const latest = steps.filter(s => s.kind === "tool").slice(-1)[0];
      const out = [];
      for (const g of G) out.push(`<g class="fl-isl"><ellipse cx="${f1(g.x)}" cy="${f1(g.y + 4)}" rx="${f1(g.r + 6)}" ry="${f1(g.r * .92)}"/><text x="${f1(g.x)}" y="${f1(g.y - g.r * .92 + 4)}" text-anchor="middle">${esc(cut(g.name, 26))}</text></g>`);
      const tr = M.trans.sort((a, b) => b.n - a.n).slice(0, 260);
      const recent = new Set(M.trans.sort((a, b) => b.t - a.t).slice(0, 4).map(t => t.a + ">" + t.b));
      for (const t of tr) {
        const a = pos[t.a], b = pos[t.b]; if (!a || !b) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, bend = .18;
        const qx = mx - dy * bend, qy = my + dx * bend;
        out.push(`<path class="fl-edge a-${t.fail ? "fail" : t.act}${recent.has(t.a + ">" + t.b) ? " hot" : ""}" d="M${f1(a.x)},${f1(a.y)} Q${f1(qx)},${f1(qy)} ${f1(b.x)},${f1(b.y)}" style="stroke-width:${f1(Math.min(4, .8 + t.n * .6))}"/>`);
      }
      const ranked = [...M.nodes.values()].sort((a, b) => b.visits - a.visits);
      const showLbl = new Set(ranked.slice(0, compact ? 10 : 22).map(n => n.key));
      for (const n of M.nodes.values()) {
        const isLatest = latest && ((latest.files || []).some(f => "f:" + f === n.key) || n.full === cut(latest.target, 26));
        out.push(`<g class="fl-node a-${n.fail && n.fail === n.visits ? "fail" : n.act}${isLatest ? " cur" : ""}"><circle cx="${f1(n.x)}" cy="${f1(n.y)}" r="${f1(n.r)}"><title>${esc(n.full)} · ${n.visits}번 (${Object.entries(n.acts).map(([k, v]) => ACT[k] + " " + v).join(", ")})${n.fail ? ` · 실패 ${n.fail}` : ""}</title></circle>` +
          (n.visits > 1 ? `<text class="cnt" x="${f1(n.x)}" y="${f1(n.y + 3.2)}" text-anchor="middle">${n.visits}</text>` : "") +
          (showLbl.has(n.key) ? `<text class="lbl" x="${f1(n.x)}" y="${f1(n.y + n.r + 11)}" text-anchor="middle">${esc(cut(n.label, compact ? 18 : 24))}</text>` : "") + `</g>`);
      }
      host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
    }
    function topList(steps, n) {
      const M = mapModel(steps);
      const top = [...M.nodes.values()].sort((a, b) => b.visits - a.visits).slice(0, n);
      if (!top.length) return "";
      const max = top[0].visits;
      return `<div class="fl-top-h">가장 많이 들른 곳</div>` + top.map(t => `<div class="fl-topr" title="${esc(t.full)}"><span>${esc(cut(t.label, 22))}</span><i>${Object.entries(t.acts).map(([k, v]) => `<em class="a-${k}" style="width:${f1(v / max * 100)}%"></em>`).join("")}</i><b>${t.visits}</b></div>`).join("");
    }
    function stepList(steps) {
      const rows = steps.filter(s => s.kind === "tool" || s.kind === "say").slice(-14).reverse().map(s => s.kind === "say"
        ? `<li class="say">💬 <span>${esc(cut(clean(s.text), 90))}</span><time>${hm(s.t)}</time></li>`
        : `<li class="a-${actOf(s)}">${ACT_ICON[s.act] || "🧰"} <span><b>${esc(s.tool)}</b> ${esc(cut(s.target || "", 60))}${s.err ? `<em>✗ ${esc(cut(s.err, 70))}</em>` : ""}</span><time>${hm(s.t)}</time></li>`);
      return rows.length ? `<div class="fl-top-h">최근 걸음</div><ul class="fl-steps">${rows.join("")}</ul>` : "";
    }
    function drawMapView(W, H) {
      const side = W > 900 ? 300 : 0;
      el.mapview.innerHTML = `<div class="mv-map"></div>${side ? `<div class="mv-side"></div>` : ""}`;
      const m = el.mapview.querySelector(".mv-map");
      drawMap(m, D.list, W - side, H, false);
      if (!side) return;
      const cards = D.lanes.map(l => {
        const ss = D.list.filter(s => s.lane === l.id && s.kind === "tool");
        const last = ss[ss.length - 1];
        const stTxt = l.id === "main" ? (l.status === "waiting" ? "⏳ 기다림" : l.status === "done" ? "✓ 끝남" : "● 작업 중") : l.status === "running" ? "● 작업 중" : "✓ 합류";
        return `<div class="mv-card" data-lane="${esc(l.id)}"><div class="h"><span style="color:${l.col}">${laneEmoji(l)}</span><b>${esc(cut(l.desc, 18))}</b><small class="${l.status === "running" ? "on" : ""}">${stTxt}</small></div>
          <div class="s">${last ? `<span class="ph-t-${last.phase}">${PH[last.phase]}</span> ${esc(cut(last.target || last.tool, 28))}` : "생각만"} · ${ss.length}걸음</div>
          <div class="trail">${ss.slice(-28).map(s => `<i class="a-${actOf(s)}"></i>`).join("")}</div></div>`;
      }).join("");
      el.mapview.querySelector(".mv-side").innerHTML = `<div class="fl-top-h">탐험대</div>${cards}${topList(D.list, 8)}
        <div class="mv-leg"><span class="a-read">읽기·검색</span><span class="a-edit">수정</span><span class="a-run">실행·검증</span><span class="a-agent">위임</span><span class="a-fail">실패</span></div>`;
    }
    el.mapview.onclick = e => { const c = e.target.closest(".mv-card"); if (c) { view = "river"; C.store.set("flow:view", view); openSel(c.dataset.lane); } };

    /* ---------- 돌아보기 (마인드맵) ---------- */
    function drawMind(W, H, live) {
      const main = D.list.filter(s => s.lane === "main");
      const says = main.filter(s => (s.kind === "say" || (s.kind === "think" && s.text)) && clean(s.text).length > 6);
      // 결정·결론을 우선해 최대 7개 가지
      const agentsN = Math.min(D.lanes.length - 1, W < 900 ? 2 : 4);
      const MAXB = Math.max(3, (W < 900 ? 5 : 8) - agentsN);
      let chosen = says;
      if (says.length > MAXB) {
        const pri = s => ({ conclusion: 3, decision: 3, hypothesis: 2, check: 1 })[s.claim] || 0;
        const idx = says.map((s, i) => [i, pri(s) + (i === says.length - 1 ? 5 : 0) + (i === 0 ? 4 : 0)]).sort((a, b) => b[1] - a[1]).slice(0, MAXB).map(x => x[0]).sort((a, b) => a - b);
        chosen = idx.map(i => says[i]);
      }
      const branches = chosen.map((s, i) => {
        const nxt = chosen[i + 1] ? chosen[i + 1].t : Infinity;
        const tools = main.filter(x => x.kind === "tool" && x.t >= s.t && x.t < nxt);
        return { s, tools, kind: "say" };
      });
      if (!branches.length && main.some(x => x.kind === "tool")) branches.push({ s: { t: D.prompt.t, text: "(발화 없이 바로 작업)", claim: "note", kind: "say" }, tools: main.filter(x => x.kind === "tool"), kind: "say" });
      for (const l of D.lanes.slice(1).sort((a, b) => D.list.filter(s => s.lane === b.id).length - D.list.filter(s => s.lane === a.id).length).slice(0, agentsN).sort((a, b) => a.t_start - b.t_start)) {
        const ss = D.list.filter(s => s.lane === l.id);
        const concl = [...ss].reverse().find(s => s.kind === "say" && clean(s.text).length > 6);
        branches.push({ s: { t: l.t_start, text: concl ? concl.text : l.desc, claim: concl ? concl.claim : "note", kind: "agent" }, tools: ss.filter(s => s.kind === "tool"), lane: l, kind: "agent" });
      }
      H -= 34;
      const cx = W / 2, cy = H / 2 + 4, n = branches.length;
      const R1x = Math.min(W * .27, 360), R1y = Math.min(H * .34, 240);
      const out = [], cards = [], leaves = [];
      // 카드 자리 먼저 정하고(겹침 판정용), 잎은 카드·중심과 안 겹치는 것만
      const boxes = [{ x: cx - 150, y: cy - 75, w: 300, h: 150 }];
      branches.forEach((b, i) => {
        b.ang = -Math.PI / 2 + (i + .5) * 2 * Math.PI / Math.max(n, 1);
        b.bx = clamp(cx + Math.cos(b.ang) * R1x, 116, W - 116); b.by = clamp(cy + Math.sin(b.ang) * R1y, 64, H - 64);
        boxes.push({ x: b.bx - 112, y: b.by - 60, w: 224, h: 120 });
      });
      const hit = r => boxes.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
      branches.forEach((b, i) => {
        const ang = b.ang, bx = b.bx, by = b.by;
        const col = b.kind === "agent" ? b.lane.col : `var(--fl-${b.s.claim === "conclusion" ? "verify" : b.s.claim === "decision" ? "plan" : b.s.claim === "hypothesis" ? "warn" : "understand"})`;
        out.push(`<path class="fl-mlink" d="M${f1(cx)},${f1(cy)} Q${f1(cx + Math.cos(ang) * R1x * .5 + Math.sin(ang) * 30)},${f1(cy + Math.sin(ang) * R1y * .5 - Math.cos(ang) * 20)} ${f1(bx)},${f1(by)}" style="stroke:${col}"/>`);
        const label = b.kind === "agent" ? `<span class="cl ag">🤖 지류</span>` : `<span class="cl c-${b.s.claim}">${CLAIM[b.s.claim] || "메모"}</span>`;
        const fails = b.tools.filter(t => t.ok === false).length;
        cards.push(`<div class="fl-mcard${b.s.kind === "think" ? " think" : ""}${b.kind === "agent" ? " agent" : ""}" style="left:${f1(bx)}px;top:${f1(by)}px">
          <div class="h">${label}<span>${b.kind === "agent" ? esc(cut(b.lane.desc, 22)) : b.s.kind === "think" ? "💭 속생각" : "💬 발화"}</span><time>${hm(b.s.t)}</time></div>
          <p>${esc(cut(clean(b.s.text), 110))}</p><div class="f">도구 ${b.tools.length}${fails ? ` · 🌀${fails}` : ""}</div></div>`);
        // 잎: 그 판단 뒤에 이어진 도구 호출 (최대 4) — 카드 바깥쪽 옆에 세로로
        const tl = b.tools.slice(0, 4), more = b.tools.length - tl.length;
        const items = tl.map(t => ({ html: `<i class="a-${actOf(t)}"></i>${ACT_ICON[t.act] || "🧰"} ${esc(cut(t.target || t.tool, 22))} ${t.ok === false ? "✗" : t.ok ? "✓" : "…"}`, title: `${t.tool} ${t.target || ""}` }));
        if (more > 0) items.push({ html: `+${more}개 더`, title: "" });
        const right = Math.cos(ang) >= -.05, colX = right ? bx + 124 : bx - 124;
        const room = right ? W - colX : colX;
        if (room < 120) return;
        items.forEach((it, j) => {
          const ly = by + (j - (items.length - 1) / 2) * 23;
          if (ly < 14 || ly > H - 14) return;
          const lw = Math.min(220, room - 8), rr = { x: right ? colX : colX - lw, y: ly - 10, w: lw, h: 20 };
          if (hit(rr)) return;
          boxes.push(rr);
          out.push(`<path class="fl-mleaf" d="M${f1(right ? bx + 110 : bx - 110)},${f1(by)} C${f1(colX + (right ? -6 : 6))},${f1(by)} ${f1(colX + (right ? -10 : 10))},${f1(ly)} ${f1(colX)},${f1(ly)}"/>`);
          leaves.push(`<div class="fl-leaf ${right ? "r" : "l"}" style="${right ? "left" : "right"}:${f1(right ? colX : W - colX)}px;top:${f1(ly)}px;max-width:${f1(Math.min(220, room - 8))}px" title="${esc(it.title)}">${it.html}</div>`);
        });
      });
      const totalTools = D.list.filter(s => s.kind === "tool").length, sayN = D.list.filter(s => s.kind === "say").length;
      const thinkN = D.list.filter(s => s.kind === "think").length, thinkTxt = D.list.filter(s => s.kind === "think" && s.text).length;
      const fails = D.list.filter(s => s.ok === false).length;
      el.mind.innerHTML = `<svg width="${W}" height="${H}">${out.join("")}</svg>${leaves.join("")}${cards.join("")}
        <div class="fl-mcenter" style="left:${f1(cx)}px;top:${f1(cy)}px"><div class="h">💬 사용자 요청 · ${hm(D.prompt.t)}</div><p>${esc(cut(D.prompt.text || "(요청 기록 없음)", 120))}</p>
          <div class="f">가지 ${branches.length} · 도구 ${totalTools} · 실패 ${fails}${live ? " · <b>진행 중</b>" : ""}</div></div>
        <div class="fl-mfoot"><span class="st"><b>${sayN}</b> 발화 · <b>${totalTools}</b> 도구 호출 · 읽히는 속생각 <b>${thinkTxt}/${thinkN}</b></span>
          <span class="lg"><span class="cl c-decision">결정</span>할게요·I'll <span class="cl c-check">확인</span>Let me check <span class="cl c-hypothesis">가설</span>것 같아요·probably <span class="cl c-conclusion">결론</span>원인은·완료</span>
          <span class="nt" title="문구만 보고 나눈 것이라 틀릴 수 있어요. 속생각(thinking)은 대부분 비어 있어 발화와 도구 호출로 추정해요.">ⓘ 발화 문구 휴리스틱 · 틀릴 수 있어요${live ? " · 진행 중이라 지금까지의 모습" : ""}</span></div>`;
    }

    return {
      update() { render(); if (sid && !D && !inflight) poll(); },
      unmount() { dead = true; if (inflight) inflight.abort(); inflight = null; },
    };
  },
});
})();

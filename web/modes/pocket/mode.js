/* 📌 포켓 모드: 다른 작업 화면 구석에 늘 떠 있는 초소형 위젯
   · 크기 3단계: 알약(상태 점 + 5시간 % + 리셋까지) / 기본(한도 바 + 세션 리스트) / 펼침(세션 상세 + 메모)
   · 입력 필요·메모 준비 시 자동으로 펼침 → 해결되면 원래 크기로
   · Document Picture-in-Picture로 같은 모드를 '항상 위' 창에 추가 mount (Core.mount("pocket", { doc })).
     지원 안 하는 브라우저는 버튼을 숨기고 탭 안에서 위젯 모양으로만 보여줌 */
(() => {
"use strict";
const C = window.Core;
const { esc } = C;

const SIZES = ["pill", "card", "full"];
const SIZE_LABEL = { pill: "알약", card: "기본", full: "펼침" };
const STATUS_LABEL = { working: "작업 중", agents: "에이전트 실행 중", needs_input: "입력 필요", done: "완료", idle: "대기" };
const RANK = { ask: 0, stall: 1, work: 2, ag: 2, done: 3, idle: 4 };
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const PIP_W = 340;
const pad2 = n => String(n).padStart(2, "0");

/* ---------- 순수 함수 ---------- */
const ago = sec => {  // 2분 / 1시간 5분
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return m < 60 ? `${m}분` : h < 24 ? `${h}시간 ${m % 60}분` : `${Math.floor(h / 24)}일`;
};
const hmLeft = sec => { const m = Math.max(0, Math.floor(sec / 60)); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };  // 1:48
function resetText(epoch, now) {
  if (!epoch) return "";
  if (epoch - now < 86400) return `${hmLeft(epoch - now)} 후 리셋`;
  const d = new Date(epoch * 1000);
  return `${DAYS[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())} 리셋`;
}
// 세션에서 가장 나쁜 건강 상태 (메인 세션 작업 중 + 실행 중 에이전트)
function worstHealth(s, status) {
  const hs = [];
  if (status === "working" && s.health) hs.push(s.health);
  for (const a of s.agents) if (a.status === "running" && a.health) hs.push(a.health);
  return hs.find(h => h.level === "stall") || hs.find(h => h.level === "slow") || null;
}
function dotKind(status, h) {
  if (status === "needs_input") return "ask";
  if (h && h.level === "stall") return "stall";
  return { working: "work", agents: "ag", done: "done" }[status] || "idle";
}
const askKind = s => /permission/i.test(s.note || "") ? "허가 요청" : "입력 대기";
function askTitle(s) {
  const n = s.note || "", m = n.match(/permission to use ([\w.:-]+)/i);
  if (m) return `${m[1]} 실행을 허가할까요?`;
  if (/waiting for your input/i.test(n)) return "다음 지시를 기다려요";
  return n || "터미널에서 확인이 필요해요";
}
const lastAct = s => s.activity[s.activity.length - 1] || null;
const codeLine = s => { const a = lastAct(s); return a ? (s.kind === "bash" ? "$ " : "") + a.text : ""; };
const stallNote = h => h && h.level === "stall" ? `${Math.max(1, Math.floor(h.secs / 60))}분째 무응답` : h ? `${Math.max(1, Math.floor(h.secs / 60))}분째 느림` : "";
const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

/* ---------- 아이콘 (16px 선) ---------- */
const ico = d => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  min: ico("M4 8h8"),
  grow: ico("M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9 7M3.5 12.5 7 9"),
  shrink: ico("M12.5 6.5h-3v-3M3.5 9.5h3v3M9.5 6.5 13 3M6.5 9.5 3 13"),
  close: ico("M4.5 4.5l7 7M11.5 4.5l-7 7"),
  bell: ico("M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1H3zM6.5 13.5a1.6 1.6 0 0 0 3 0"),
  moon: ico("M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"),
  big: ico("M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"),
  pin: ico("M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5"),
};

/* ---------- 마크업 ---------- */
const WIDGET = `
<div class="pk-w" data-size="card">
  <div class="pk-in">
    <button class="pk-pill" data-act="open" title="펼치기"><span class="pk-dots"></span><b class="pk-pct"></b><span class="pk-left"></span></button>
    <div class="pk-card">
      <div class="pk-tb">
        <span class="pk-live"></span><span class="pk-tt"></span>
        <span class="pk-tools">
          <button class="pk-ib" data-act="quiet"></button>
          <button class="pk-ib" data-act="notif" title="알림 켜기">${I.bell}</button>
          <button class="pk-ib" data-act="pill" title="알약으로 줄이기">${I.min}</button>
          <button class="pk-ib" data-act="full"></button>
          <button class="pk-ib pk-x" data-act="close" title="창 닫기">${I.close}</button>
        </span>
      </div>
      <div class="pk-lim"></div>
      <div class="pk-rows" role="list"></div>
    </div>
    <section class="pk-det" hidden>
      <div class="pk-det-dyn"></div>
      <label class="pk-memo"><span class="pk-memo-l"></span>
        <textarea rows="2" placeholder="끝나면 보낼 다음 지시를 적어두세요" aria-label="다음 프롬프트 메모"></textarea></label>
      <div class="pk-acts"><button class="pk-b pk-pri" data-act="copy">메모 복사</button><button class="pk-b" data-act="dismiss"></button></div>
    </section>
  </div>
</div>`;

const STAGE = `
<div class="pk-stage">
  <header class="pk-head">
    <div class="pk-brand"><span class="pk-logo">📌</span><div><b>포켓</b><small>다른 작업 화면 구석에 띄워두는 세션 위젯</small></div></div>
    <div class="pk-hud"></div>
  </header>
  <div class="pk-ctl">
    <div class="pk-seg" role="radiogroup" aria-label="위젯 크기">
      ${SIZES.map(z => `<button role="radio" data-size="${z}" data-act="size"><i class="pk-si ${z}"></i>${SIZE_LABEL[z]}</button>`).join("")}
    </div>
    <button class="pk-pipbtn" data-act="pip" hidden>${I.pin}<span>위에 띄우기</span></button>
  </div>
  <div class="pk-floor">${WIDGET}</div>
  <p class="pk-guide"></p>
</div>`;

C.registerMode({
  id: "pocket", label: "포켓", icon: "📌",
  chimeWave: "sine",
  texts: {
    done: s => [`${s.project} 끝났어요`, s.prompt || ""],
    input: s => [`${s.project} · ${askTitle(s)}`, codeLine(s) || s.note || ""],
    memo: (s, text) => [`${s.project} 메모 준비됐어요`, text.slice(0, 80)],
    title: ({ calling, working }) => calling ? `(${calling}) 입력 필요 · 포켓` : working ? `${working}개 작업 중 · 포켓` : "Claude 포켓",
  },

  mount(root, ctx) {
    const { doc, win } = ctx;
    const $ = sel => root.querySelector(sel);
    const detached = !ctx.isMain;                         // PiP 창(또는 다른 문서)에 올라간 mount
    const isPip = detached && win.top === win;            // iframe이 아니라 독립 창 → 창 크기 맞춤
    const sizeKey = detached ? "pocket:size:pip" : "pocket:size";
    let size = SIZES.includes(C.store.get(sizeKey)) ? C.store.get(sizeKey) : "card";
    let last = null, picked = null, eff = null, lastFit = "";
    const snooze = new Map();      // sid → 이 시각까지 자동 펼침 안 함
    const memoShow = new Set();    // 메모 준비로 자동 펼친 세션
    let pipWin = null;             // (메인) 열어둔 PiP 창

    root.innerHTML = detached ? `<div class="pk-floor">${WIDGET}</div>` : STAGE;
    if (detached) doc.documentElement.classList.add("pk-pip");
    const W = $(".pk-w"), ta = $(".pk-memo textarea");
    if (!isPip) $('[data-act="close"]').remove();
    else if (ctx.api.showMain) {   // 앱 위젯 = 미니 보기: 닫기 대신 ⤢ 크게 보기(위젯 닫고 큰 창 복귀) — 창이 하나도 안 보이는 상태를 만들지 않는다
      const xb = $('[data-act="close"]');
      xb.dataset.act = "big"; xb.classList.remove("pk-x"); xb.innerHTML = I.big; xb.title = "크게 보기"; xb.setAttribute("aria-label", "크게 보기");
    }
    if (detached) { ctx.switcher.hidden = true; root.append(ctx.switcher); }   // 추가 창: 메인 화면 전환은 탭에서
    else { ctx.switcher.querySelector("select").classList.add("pk-sel"); $(".pk-hud").append(ctx.switcher); }

    const pipApi = !detached && win.documentPictureInPicture;
    if (pipApi && pipApi.window && pipApi.window.document.body.dataset.mode === "pocket") bindPip(pipApi.window);   // 다른 모드를 다녀오는 사이 열려 있던 포켓 창(스튜디오 로비 창은 제외)

    /* ----- 세션 행 데이터 ----- */
    function rowsOf(now) {
      return last.sessions.map((s, i) => {
        const status = C.sessionStatus(s, now), h = worstHealth(s, status), kind = dotKind(status, h);
        return { s, i, status, h, kind };
      }).sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.i - b.i);
    }
    function focusOf(rows, now) {
      if (picked) { const r = rows.find(r => r.s.sid === picked); if (r) return { r, why: "pick" }; picked = null; }
      const ask = rows.find(r => r.kind === "ask" && !(snooze.get(r.s.sid) > now));
      if (ask) return { r: ask, why: "ask" };
      const mr = rows.find(r => memoShow.has(r.s.sid) && ctx.memo.ready(r.s.sid));
      if (mr) return { r: mr, why: "memo" };
      if (size === "full" && rows.length) return { r: rows[0], why: "top" };
      return null;
    }

    /* ----- 그리기 ----- */
    const dot = kind => `<i class="pk-dot ${kind}"></i>`;
    function limitHTML(c, label, now, key) {
      if (!c.shown && !c.wasReset) return "";
      const used = c.used, color = used == null ? "na" : c.low ? "low" : c.over ? "over" : key;
      const gap = used != null && c.pace != null ? used - c.pace : null;
      const paceTxt = c.wasReset ? "리셋됨 · 다음 요청 시 갱신" : c.proj === "full" ? "한도 도달"
        : c.low ? `잔여 ${c.left}%` : gap == null ? "" : gap > 5 ? `페이스 +${Math.round(gap)}%` : gap < -5 ? "여유" : "적정";
      return `<div class="pk-l ${color}" title="${c.pace != null ? `시간 기준 적정 사용량 ${Math.round(c.pace)}%` : ""}">
        <div class="pk-k"><span>${label}</span><b>${c.wasReset ? "–" : used == null ? "-" : Math.round(used) + "%"}</b></div>
        <div class="pk-track"><i style="width:${used ?? 0}%"></i>${c.pace != null && !c.wasReset ? `<u style="left:${c.pace}%"></u>` : ""}</div>
        <div class="pk-k pk-ks"><span class="pk-pace">${paceTxt}</span><span>${c.wasReset ? "" : resetText(c.reset, now)}</span></div></div>`;
    }
    function ctxDonut(r) {
      const c = r.s.ctx;
      if (c == null) return "";
      const col = c >= 85 ? "low" : c >= 70 ? "over" : r.kind;
      return `<span class="pk-ctx ${col}" style="--p:${Math.min(100, c)}" title="컨텍스트 ${Math.round(c)}% 사용"><i></i><em>${Math.round(c)}</em></span>`;
    }
    function rowHTML(r, now, sel) {
      const { s, status, h, kind } = r, a = lastAct(s);
      const run = s.agents.filter(x => x.status === "running");
      let sub, extra = "", right;
      if (kind === "ask") {
        sub = `<span class="pk-hi">${askKind(s)}</span>${a ? ` · <code>${esc(a.text)}</code>` : ""}`;
      } else if (status === "agents") {
        sub = `에이전트 ${run.length}${s.tools ? ` · ${s.tools}회` : ""}`;
      } else if (status === "working") {
        sub = a ? `${esc(a.text)} · ${s.tools}회` : "생각 중";
      } else {
        sub = `${STATUS_LABEL[status]}${s.prompt ? ` · ${esc(s.prompt)}` : ""}`;
      }
      if (kind === "stall" || (h && status !== "needs_input")) sub += ` <span class="pk-warn ${h.level}">· ${stallNote(h)}</span>`;
      const t = s.todos;
      if (t.length && (status === "working" || status === "agents")) {
        const d = t.filter(x => x.status === "completed").length;
        extra += `<div class="pk-todo" title="할 일 ${d}/${t.length}"><i style="width:${d / t.length * 100}%"></i></div>`;
      }
      if (run.length) extra += `<div class="pk-chips">${run.slice(0, 3).map(x =>
        `<span class="${x.health && x.health.level === "stall" ? "stall" : ""}" title="${esc(x.desc || x.type)}">${esc(x.desc || x.type)}</span>`).join("")}${run.length > 3 ? `<span>+${run.length - 3}</span>` : ""}</div>`;
      if (kind === "ask") right = `<span class="pk-age ask">${ago(now - s.since)}</span>`;
      else if (status === "done" || status === "idle") right = `<span class="pk-age">${ago(now - s.since)} 전</span>`;
      else right = ctxDonut(r) || `<span class="pk-age">${ago(now - s.since)}</span>`;
      return `<div class="pk-row ${kind}${sel ? " sel" : ""}" role="listitem" tabindex="0" data-sid="${esc(s.sid)}" data-act="pick">
        ${dot(kind)}<div class="pk-mid"><div class="pk-nm">${esc(s.project)}${ctx.memo.get(s.sid).trim() ? `<span class="pk-mflag${ctx.memo.ready(s.sid) ? " ready" : ""}" title="메모 있음">✎</span>` : ""}</div>
        <div class="pk-sub">${sub}</div>${extra}</div><div class="pk-rt">${right}</div></div>`;
    }
    let detSid = null;
    function renderDet(f, now) {
      const det = $(".pk-det");
      det.hidden = !f;
      if (!f) { detSid = null; return; }
      const { s, status, h, kind } = f.r;
      det.className = `pk-det ${kind}`;
      let html;
      if (kind === "ask") {
        const code = codeLine(s);
        html = `<div class="pk-dh">${dot("ask")}입력 필요 · ${esc(s.project)} · ${ago(now - s.since)} 전</div>
          <div class="pk-dt">${esc(askTitle(s))}</div>${code ? `<pre class="pk-code">${esc(code)}</pre>` : ""}
          <div class="pk-dn">터미널에서 응답하면 저절로 접혀요</div>`;
      } else {
        const a = lastAct(s), run = s.agents.filter(x => x.status === "running");
        const live = status === "working" || status === "agents";
        html = `<div class="pk-dh">${dot(kind)}${STATUS_LABEL[status]} · ${esc(s.project)} · ${ago(now - s.since)}${live ? "째" : " 전"}</div>
          <div class="pk-dt pk-clamp" title="${esc(s.prompt || "")}">${esc(s.prompt || "프롬프트 없음")}</div>
          ${s.say ? `<div class="pk-say pk-clamp">💬 ${esc(s.say)}</div>` : ""}
          ${status === "working" && a ? `<pre class="pk-code">${esc(codeLine(s))}</pre>` : ""}
          ${h && status === "working" ? `<div class="pk-dn ${h.level}">${h.tool ? esc(h.tool) + " " : ""}${stallNote(h)}${h.level === "stall" ? " · 터미널을 확인해 보세요" : ""}</div>` : ""}
          ${run.length ? `<ul class="pk-ags">${run.map(x => `<li class="${x.health ? x.health.level : ""}">${dot(x.health && x.health.level === "stall" ? "stall" : "ag")}<span>${esc(x.desc || x.type)}</span><em>${x.health ? stallNote(x.health) : ago(now - x.since)}</em></li>`).join("")}</ul>` : ""}`;
      }
      setHTML($(".pk-det-dyn"), html);
      if (detSid !== s.sid) { detSid = s.sid; ta.value = ctx.memo.get(s.sid); }
      else if (doc.activeElement !== ta) { const m = ctx.memo.get(s.sid); if (ta.value !== m) ta.value = m; }
      const ready = ctx.memo.ready(s.sid);
      $(".pk-memo").classList.toggle("ready", ready);
      $(".pk-memo-l").textContent = ready ? "메모 준비됨 · 복사해서 붙여넣으세요" : "다음 프롬프트 메모";
      $('[data-act="copy"]').classList.toggle("empty", !ta.value.trim());
      $('[data-act="dismiss"]').textContent = { ask: "5분 뒤 다시", memo: "닫기", pick: "접기", top: "접기" }[f.why];
    }

    function render() {
      const now = ctx.now();
      if (!last) { $(".pk-tt").textContent = "연결 중…"; applySize(size === "pill" ? "pill" : "card"); return; }
      const rows = rowsOf(now), f = focusOf(rows, now);
      const calling = rows.filter(r => r.kind === "ask").length, live = rows.filter(r => r.status === "working" || r.status === "agents").length;
      const L = C.limits(last, now);

      // 알약
      const five = L.five;
      setHTML($(".pk-dots"), rows.filter(r => r.kind !== "idle").slice(0, 8).map(r => dot(r.kind)).join("") || dot("idle"));
      $(".pk-pct").textContent = five.used != null ? `${Math.round(five.used)}%` : `${rows.length}세션`;
      $(".pk-pct").className = "pk-pct " + (five.low ? "low" : five.over ? "over" : "");
      $(".pk-left").textContent = five.used != null && five.reset ? hmLeft(five.reset - now) : "";
      $(".pk-pill").title = `${calling ? `입력 필요 ${calling} · ` : ""}작업 중 ${live} · 5시간 한도 ${five.used != null ? Math.round(five.used) + "%" : "정보 없음"}${five.reset ? " · " + resetText(five.reset, now) : ""}`;

      // 제목줄
      $(".pk-live").className = "pk-live " + (calling ? "ask" : live ? "on" : "");
      $(".pk-tt").textContent = `Claude 대기실 · ${rows.length} 세션`;

      // 한도
      const lim = limitHTML(L.five, "5시간", now, "five") + limitHTML(L.week, "주간", now, "week") + (L.extra.shown ? limitHTML(L.extra, "추가", now, "extra") : "");
      const note = C.limitNote(last, now);
      setHTML($(".pk-lim"), lim ? lim + (note && !last.limits ? "" : note ? `<div class="pk-note">${esc(note)}</div>` : "") : `<div class="pk-note">${esc(note)}</div>`);
      $(".pk-lim").classList.toggle("three", L.extra.shown);

      // 세션
      setHTML($(".pk-rows"), rows.length ? rows.map(r => rowHTML(r, now, f && f.why === "pick" && f.r === r)).join("")
        : `<div class="pk-empty">활성 세션 없음<small>Claude Code에 프롬프트를 보내면 여기에 나타나요</small></div>`);

      renderDet(f, now);
      // 알약 + 자동 펼침이면 알약 아래에 카드만 붙임(③), 그 밖의 펼침은 기본 창 + 상세
      const auto = !!f && (f.why === "ask" || f.why === "memo") && size !== "full";
      applySize(f ? (auto && size === "pill" ? "pill" : "full") : size === "full" ? "card" : size, auto);
      if (!detached) renderStage();
    }
    function applySize(next, auto = false) {
      W.dataset.auto = auto ? "1" : "";
      if (next === eff) { if (isPip) fit(false); return; }
      eff = next; W.dataset.size = next;
      const fb = $('[data-act="full"]');
      fb.innerHTML = next === "full" ? I.shrink : I.grow;
      fb.title = next === "full" ? "상세 접기" : "펼치기 (세션 상세·메모)";
      if (isPip) fit(false);
    }
    // PiP 창 크기를 내용에 맞춤. resizeTo는 사용자 조작(클릭) 직후에만 허용되는 경우가 많아 실패는 무시 (창 안에서 스크롤)
    function fit(force) {
      const box = $(".pk-in").getBoundingClientRect();
      const w = eff === "pill" && $(".pk-det").hidden ? Math.ceil(box.width) : PIP_W, h = Math.ceil(box.height);
      const key = `${eff}:${w}:${h}`;
      if (!force && key === lastFit) return;
      lastFit = key;
      try { win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight)); } catch {}
    }
    function setSize(z) {
      size = z; C.store.set(sizeKey, z);
      if (z !== "full") picked = null;
      render();
      if (isPip) fit(true);
    }

    /* ----- 메인 탭: 크기 전환·PiP 안내 ----- */
    function renderStage() {
      for (const b of root.querySelectorAll(".pk-seg button")) {
        const on = b.dataset.size === size;
        b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
      }
      const pb = $(".pk-pipbtn");
      pb.hidden = !pipApi && !ctx.api.openWidget;
      pb.classList.toggle("on", !!pipWin);
      pb.lastElementChild.textContent = pipWin ? "띄운 창 닫기" : "위에 띄우기";
      const g = $(".pk-guide");
      const txt = !pipApi && !ctx.api.openWidget
        ? `이 브라우저는 ‘항상 위’ 창(Document Picture-in-Picture)을 지원하지 않아요. Chrome·Edge 116 이상에서 쓸 수 있어요.<br>대신 이 탭을 작은 창으로 떼어 화면 구석에 두세요.`
        : ctx.api.openWidget ? `<b>위에 띄우기</b>를 누르면 미니 보기: 이 큰 창은 숨고, 다른 앱 위에도 늘 떠 있는 작은 창만 남아요.<br>입력이 필요하면 저절로 펼쳐지고, 작은 창의 ⤢(크게 보기)로 이 화면에 돌아와요.`
        : pipWin ? `<b>위에 떠 있어요.</b> 다른 앱으로 가도 화면 구석에 남아요. 창을 닫으면 이 탭으로 돌아와요.`
        : `<b>위에 띄우기</b>를 누르면 다른 앱 위에도 늘 떠 있는 작은 창으로 열려요.<br>입력이 필요하면 저절로 펼쳐지고, 해결되면 다시 접혀요.`;
      setHTML(g, txt);
      W.classList.toggle("ghost", !!pipWin);
    }
    function bindPip(pw) {
      pipWin = pw;
      ctx.listen(pw, "pagehide", () => { if (pipWin === pw) { pipWin = null; render(); } }, { once: true });
    }
    async function openPip() {
      if (ctx.api.openWidget) { ctx.api.openWidget("pocket").catch(e => win.console.warn("[pocket] 위젯 창을 열 수 없어요", e)); return; }   // 앱(Tauri): PiP 대신 위젯 창 (P3). 실패 이유는 코어가 toast로
      if (!pipApi) return;
      if (pipWin) { pipWin.close(); return; }
      const box = $(".pk-in").getBoundingClientRect();
      C.store.set("pocket:size:pip", size);
      let pw;
      try {
        pw = await pipApi.requestWindow({ width: eff === "pill" ? Math.ceil(box.width) : PIP_W, height: Math.max(56, Math.ceil(box.height)) });
      } catch (e) { console.warn("[pocket] PiP 창을 열 수 없어요", e); return; }
      const base = pw.document.createElement("base");   // 상대 경로(core/core.css·modes/pocket/mode.css)를 이 탭 기준으로
      base.href = win.location.href;
      pw.document.head.append(base);
      pw.document.title = "Claude 포켓";
      bindPip(pw);
      render();
      try { await C.mount("pocket", { doc: pw.document }); } catch (e) { console.error("[pocket] PiP mount 실패", e); pw.close(); }
    }

    /* ----- 입력 ----- */
    ctx.listen(root, "click", e => {
      const b = e.target.closest("[data-act]");
      if (!b || !root.contains(b)) return;
      const act = b.dataset.act;
      if (act === "open") setSize("card");
      else if (act === "pill") setSize("pill");
      else if (act === "full") eff === "full" && size !== "full" ? dismiss() : setSize(size === "full" ? "card" : "full");
      else if (act === "size") setSize(b.dataset.size);
      else if (act === "quiet") ctx.settings.setQuiet(!ctx.settings.quiet);
      else if (act === "notif") ctx.notif.request();
      else if (act === "close") win.close();
      else if (act === "big") ctx.api.showMain();
      else if (act === "pip") openPip();
      else if (act === "pick") { picked = picked === b.dataset.sid ? null : b.dataset.sid; render(); if (isPip) fit(true); }
      else if (act === "copy") copyMemo(b);
      else if (act === "dismiss") dismiss();
    });
    ctx.listen(root, "keydown", e => {
      const row = e.target.closest && e.target.closest(".pk-row");
      if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
      if (e.key === "Escape" && !$(".pk-det").hidden) dismiss();
    });
    ta.addEventListener("input", () => { if (detSid) { ctx.memo.set(detSid, ta.value); $('[data-act="copy"]').classList.toggle("empty", !ta.value.trim()); } });
    async function copyMemo(b) {
      if (!detSid) return;
      if (!ta.value.trim()) { ta.focus(); return; }
      await ctx.memo.copy(detSid, ta);
      memoShow.delete(detSid);
      b.textContent = "복사됨";
      ctx.after(1500, () => { b.textContent = "메모 복사"; render(); });
    }
    function dismiss() {
      const f = last && focusOf(rowsOf(ctx.now()), ctx.now());
      if (!f) return;
      if (f.why === "ask") snooze.set(f.r.s.sid, ctx.now() + 300);
      else if (f.why === "memo") memoShow.delete(f.r.s.sid);
      else if (f.why === "pick") picked = null;
      else if (f.why === "top") size = "card", C.store.set(sizeKey, "card");
      render();
      if (isPip) fit(true);
    }

    /* ----- 코어 이벤트 ----- */
    const applySettings = () => {
      const q = $('[data-act="quiet"]');
      q.innerHTML = I.moon;
      q.classList.toggle("on", ctx.settings.quiet);
      q.title = ctx.settings.quiet ? "회의 모드 켜짐 · 소리·움직임 꺼짐 (누르면 끔)" : "회의 모드 (소리·움직임 끄기)";
      $('[data-act="notif"]').hidden = !ctx.notif.canAsk;
    };
    applySettings();
    ctx.on("settings", applySettings);
    ctx.on("input", s => { snooze.delete(s.sid); if (picked && picked !== s.sid) picked = null; render(); });
    ctx.on("memo-ready", s => { memoShow.add(s.sid); render(); });
    ctx.on("memo", () => render());
    ctx.every(1000, render);   // 경과 시간·리셋까지 남은 시간
    render();

    return {
      update(state) { last = state; render(); },
      unmount() {
        if (detached) doc.documentElement.classList.remove("pk-pip");
        // 메인 탭의 포켓을 떠나도 PiP 창은 그대로 둔다(독립 mount). 다시 포켓으로 오면 bindPip으로 이어받음
      },
    };
  },
});
})();

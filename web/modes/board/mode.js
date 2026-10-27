/* 🏟️ 전광판 모드: 스포츠 중계 LED 전광판처럼 "오늘의 경기"를 생중계
   · 헤더: LIVE + 5시간 창 남은 시간 대형 LED 시계(주간 한도 = 시즌) + 5H 사용률·페이스
   · 세션 = 팀 레인 (도구 호출 수 = PLAYS 점수, 토큰, 현재 플레이, 할 일 칸 게이지, 서브에이전트 = 출전 선수 칩)
     입력 필요 = TIMEOUT 레인 + YOUR CALL 깃발, 멈춤 의심 = 옐로/레드카드 + 경과, 완료 = FINAL 세리머니
   · 오른쪽 PLAY-BY-PLAY 문자중계(세션 activity를 시간순으로 합침) + 오늘의 MVP, 하단 BREAKING 티커
   코어가 처음 선택될 때만 불러오고, 다른 모드로 바꾸면 unmount로 DOM·타이머를 모두 정리한다. */
(() => {
"use strict";
const C = window.Core;
const { esc, fmt, fmtTok, dur, hms, clockText, spanText } = C;

const PALETTE = ["cyn", "vio", "grn", "pnk", "blu", "lim"];
const RANK = { needs_input: 0, working: 2, agents: 2, done: 3, idle: 4 };
const STATUS_WORD = { working: "공격 중", agents: "출전 중", needs_input: "감독 호출", done: "경기 종료", idle: "휴식" };
// 플레이 스타일 (도구 사용 비율로 정함, 햄찌 칭호 로직과 같은 방식)
const STYLE = { read: "분석형 플레이메이커", edit: "정밀 타격형", bash: "파워 히터", search: "스카우트형",
  web: "원정 전문", agent: "감독형 사령탑", todo: "전술가", other: "멀티 플레이어" };
const hm = ts => hms(ts).slice(0, 5);
const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const clock = sec => {  // 1:48:12 / 48:12
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + ":" + String(s).padStart(2, "0");
};
function styleOf(kinds) {
  const e = Object.entries(kinds || {}).filter(([k]) => k !== "think" && k !== "other");
  const total = e.reduce((t, [, n]) => t + n, 0);
  if (total < 3) return null;
  const [top, n] = e.sort((a, b) => b[1] - a[1])[0];
  return n / total < .35 ? "올라운더" : STYLE[top] || STYLE.other;
}
// 메인 세션의 건강 상태 (working일 때만) / 서브에이전트 중 가장 나쁜 것
function laneHealth(s, status) {
  const hs = [];
  if (status === "working" && s.health) hs.push(s.health);
  for (const a of s.agents) if (a.status === "running" && a.health) hs.push(a.health);
  return hs.find(h => h.level === "stall") || hs.find(h => h.level === "slow") || null;
}

const MARKUP = `
<div class="bd">
  <header class="bd-head">
    <div class="bd-box bd-league">
      <span class="bd-live" id="bd-live">LIVE</span>
      <div class="bd-lg-txt"><small id="bd-date">CLAUDE LEAGUE</small><b id="bd-games">오늘의 경기</b>
        <div class="bd-today" id="bd-today"></div></div>
      <div class="bd-ctl">
        <button class="bd-btn" id="bd-quiet" title="움직임과 소리를 꺼요">회의 모드</button>
        <button class="bd-btn" id="bd-notif">알림 켜기</button>
      </div>
    </div>
    <div class="bd-box bd-clock bd-dots" id="bd-clock">
      <div class="bd-lbl" id="bd-clock-lbl">5시간 창 남은 시간</div>
      <div class="bd-t bd-mono bd-glow" id="bd-clock-t">0:00</div>
      <div class="bd-q" id="bd-clock-q"></div>
    </div>
    <div class="bd-box bd-pace" id="bd-pace">
      <div class="bd-stat"><div class="bd-lbl">5H 사용</div><div class="bd-v bd-mono bd-glow" id="bd-used">-</div>
        <div class="bd-bar"><i id="bd-used-bar"></i><u id="bd-pace-mark"></u></div></div>
      <div class="bd-stat" id="bd-gap-w"><div class="bd-lbl">페이스</div><div class="bd-v bd-mono bd-glow" id="bd-gap">-</div>
        <div class="bd-gap-txt" id="bd-gap-txt"></div></div>
      <div class="bd-note" id="bd-note"></div>
    </div>
  </header>
  <main class="bd-field">
    <section class="bd-lanes" id="bd-lanes" aria-label="세션"></section>
    <aside class="bd-side">
      <div class="bd-box bd-pbp"><h4>PLAY-BY-PLAY</h4><ul id="bd-pbp"></ul></div>
      <div class="bd-box bd-mvp" id="bd-mvp" hidden></div>
    </aside>
  </main>
  <footer class="bd-ticker" id="bd-ticker"><div class="bd-tag" id="bd-tag">BREAKING</div><div class="bd-track"><div class="bd-run" id="bd-run"></div></div></footer>
</div>`;

const LANE = `<div class="bd-stripe"></div>
  <div class="bd-team"><b></b><small></small><button class="bd-memo-btn" title="다음 프롬프트 메모 (작전판)">작전판</button></div>
  <div class="bd-play"></div>
  <div class="bd-side-stat"></div>
  <div class="bd-score"><div class="bd-n bd-mono bd-glow"></div><small>PLAYS</small></div>
  <div class="bd-goal" aria-hidden="true"><span>FINAL</span></div>
  <div class="bd-memo"><textarea placeholder="작전판: 이 경기가 끝나면 보낼 다음 지시" aria-label="다음 프롬프트 메모"></textarea>
    <button class="bd-btn bd-copy">복사</button><span class="bd-memo-hint">끝나면 알려줘요 · 이 브라우저에만 저장</span></div>`;

C.registerMode({
  id: "board", label: "전광판", icon: "🏟️",
  chimeWave: "triangle",
  texts: {
    done: s => [`🏁 FINAL · ${s.project}`, s.prompt || "경기 종료"],
    input: s => [`⏸ TIMEOUT · ${s.project}`, s.note || "감독 판단이 필요해요 — 터미널로!"],
    stall: x => [`🟥 ${x.project} 부상 의심`, `${x.agent ? x.agent.desc || x.agent.type : "메인 세션"} · ${Math.max(1, Math.floor(x.health.secs / 60))}분째 응답 없음`],
    memo: (s, text) => [`📋 ${s.project} 작전판 준비됨`, text.slice(0, 80)],
    title: ({ calling, working }) => calling ? `⏸ (${calling}) TIMEOUT · 전광판` : working ? `● LIVE ${working}경기 · 전광판` : "전광판",
  },

  mount(root, ctx) {
    const { doc } = ctx;
    const $ = sel => root.querySelector(sel);
    root.innerHTML = MARKUP;
    ctx.switcher.querySelector("select").classList.add("bd-btn");
    $(".bd-ctl").prepend(ctx.switcher);

    let last = null, seeded = false;
    const colors = {};           // sid → 팔레트 색 (처음 본 순서대로)
    const prev = {};             // sid → { started, status, since, tools, todoDone, stall }
    const prevAg = {};           // sid:aid → { tools, status }
    const memoOpen = new Set();
    const feed = [], feedKeys = new Set();
    const colorOf = sid => colors[sid] ||= PALETTE[Object.keys(colors).length % PALETTE.length];

    /* ----- 문자중계 피드 ----- */
    function push(key, ts, who, color, html) {
      if (feedKeys.has(key)) return;
      feedKeys.add(key);
      feed.push({ key, ts, who, color, html, fresh: seeded });
      if (feed.length > 80) {
        feed.sort((a, b) => b.ts - a.ts);
        for (const x of feed.splice(60)) feedKeys.delete(x.key);
      }
    }
    function collect(now) {
      for (const s of last.sessions) {
        const col = colorOf(s.sid), p = prev[s.sid] || {}, who = s.project;
        if (s.started && s.started !== p.started)
          push(`ko:${s.sid}:${s.started}`, s.started, who, col, `킥오프 — ${esc(s.prompt || "새 경기")}`);
        for (const a of s.activity) if (a.icon !== "🤖")  // 서브에이전트 투입은 아래 agents에서 이름과 함께
          push(`a:${s.sid}:${a.ts}:${a.text}`, a.ts, who, col, `${esc(a.icon)} ${esc(a.text)}`);
        if (s.status === "needs_input" && (p.status !== "needs_input" || p.since !== s.since))
          push(`in:${s.sid}:${s.since}`, s.since, who, "led", `⏸ 타임아웃 요청 — 감독 판단 대기${s.note ? ` · ${esc(s.note)}` : ""}`);
        if (s.status === "done" && (p.status !== "done" || p.since !== s.since))
          push(`fin:${s.sid}:${s.since}`, s.since, who, col, `🏁 <b class="bd-fin">FINAL</b> · ${s.tools} 플레이${s.run ? ` · 경기 시간 ${dur(s.run)}` : ""}`);
        const stall = s.status === "working" && s.health && s.health.level === "stall";
        if (stall && !p.stall && seeded)
          push(`st:${s.sid}:${s.since}:${Math.floor(now / 60)}`, now, who, "red", `🚑 부상 의심 — ${esc(s.health.tool || "응답")} ${Math.max(1, Math.floor(s.health.secs / 60))}분째, VAR 판독 중`);
        const td = s.todos.filter(t => t.status === "completed").length;
        if (seeded && p.todoDone != null && td > p.todoDone && s.todos.length)
          push(`td:${s.sid}:${s.started}:${td}`, now, who, col, `✅ 할 일 ${td}번째 완료 · ${td}/${s.todos.length}`);
        for (const a of s.agents) {
          const k = s.sid + ":" + a.aid, pa = prevAg[k], name = a.desc || a.type;
          push(`ags:${k}`, a.since, who, col, `🤖 <em>선수 투입</em> ${esc(name)} <span class="bd-dim">(${esc(a.type)})</span>`);
          if (a.now && (!pa || a.tools > pa.tools))
            push(`agt:${k}:${a.tools}`, pa ? now : a.last || a.since, name, "vio", `${esc(a.now.icon)} ${esc(a.now.text)}`);
          if (a.status === "done" && a.ended)
            push(`agd:${k}`, a.ended, name, "vio", `↩︎ 벤치 복귀 · ${dur(a.ended - a.since)}${a.tokens ? ` · ${fmtTok(a.tokens)}` : ""}`);
          prevAg[k] = { tools: a.tools, status: a.status };
        }
        prev[s.sid] = { started: s.started, status: s.status, since: s.since, tools: s.tools, todoDone: td, stall };
      }
      seeded = true;
    }
    const feedEls = new Map();  // key → li (증분 갱신: 새 항목만 번쩍)
    function renderFeed() {
      feed.sort((a, b) => b.ts - a.ts);
      const ul = $("#bd-pbp"), top = feed.slice(0, 40);
      const empty = ul.querySelector(".bd-empty");
      if (!top.length) { if (!empty) ul.innerHTML = `<li class="bd-empty">아직 중계할 플레이가 없어요</li>`; return; }
      if (empty) empty.remove();
      const keep = new Set();
      top.forEach((x, i) => {
        keep.add(x.key);
        let li = feedEls.get(x.key);
        if (!li) {
          li = doc.createElement("li");
          li.innerHTML = `<span class="bd-mono" title="${hms(x.ts)}">${hm(x.ts)}</span><p><b class="c-${x.color}">${esc(x.who)}</b> ${x.html}</p>`;
          if (x.fresh) li.className = "bd-new";
          feedEls.set(x.key, li);
        }
        if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
      });
      for (const [k, li] of feedEls) if (!keep.has(k)) { li.remove(); feedEls.delete(k); }
      for (const x of feed) x.fresh = false;
    }

    /* ----- 헤더: 시계 · 페이스 ----- */
    function renderHead(now) {
      const ss = last.sessions, L = C.limits(last, now), five = L.five, week = L.week;
      const lag = Math.max(0, now - last.now), live = $("#bd-live");
      live.classList.toggle("stale", lag > 4);
      setText(live, lag > 4 ? "DELAY" : "LIVE");
      live.title = lag > 4 ? `${Math.round(lag)}초째 신호 없음` : `${hms(last.now)} 기준`;
      const d = new Date(now * 1000);
      setText($("#bd-date"), `CLAUDE LEAGUE · ${d.getMonth() + 1}월 ${d.getDate()}일`);
      setText($("#bd-games"), ss.length ? `오늘의 경기 ${ss.length}` : "오늘의 경기 없음");
      const tt = last.today_tokens || {}, { waited } = C.summary(last, now);
      setHTML($("#bd-today"), [
        last.done_today ? `<span>FINAL <b>${last.done_today}</b></span>` : "",
        tt.total ? `<span title="새 입력 ${fmtTok(tt.new)} · 출력 ${fmtTok(tt.out)} · 캐시 읽기 ${fmtTok(tt.cached)}">토큰 <b>${fmtTok(tt.total)}</b></span>` : "",
        waited >= 60 ? `<span>경기 시간 <b>${dur(waited)}</b></span>` : "",
      ].join(""));

      // 시계: 5시간 창 남은 시간 (한도 정보가 없으면 현재 시각)
      const ct = $("#bd-clock-t"), box = $("#bd-clock");
      const hasFive = five.reset && !five.wasReset;
      box.classList.toggle("warn", !!(hasFive && five.low));
      if (hasFive) {
        setText($("#bd-clock-lbl"), "5시간 창 남은 시간");
        setText(ct, clock(five.reset - now));
        box.title = `리셋 ${clockText(five.reset, now)}`;
      } else {
        setText($("#bd-clock-lbl"), five.wasReset ? "5시간 창 리셋됨 · 갱신 대기" : "경기장 시각");
        setText(ct, hms(now));
        box.title = "";
      }
      const q = [];
      if (week.shown) q.push(week.wasReset ? `SEASON 리셋됨` : `SEASON <span>${Math.round(week.used)}%</span>` + (week.reset ? ` · ${clockText(week.reset, now)} 종료` : ""));
      if (L.extra.shown && L.extra.used != null) q.push(`추가 <span>${Math.round(L.extra.used)}%</span>`);
      if (!q.length && !last.limits) q.push("한도 정보 없음");
      setHTML($("#bd-clock-q"), q.join(" · "));

      // 5H 사용률 · 페이스
      const pace = $("#bd-pace");
      pace.hidden = five.used == null;
      $(".bd-head").classList.toggle("no-pace", pace.hidden);
      if (five.used != null) {
        const used = five.used, tone = used >= 90 ? "red" : five.over ? "led2" : "led";
        pace.dataset.tone = tone;
        setText($("#bd-used"), Math.round(used) + "%");
        $("#bd-used-bar").style.width = used + "%";
        const pm = $("#bd-pace-mark");
        pm.hidden = five.pace == null;
        if (five.pace != null) { pm.style.left = five.pace + "%"; pm.title = `시간 기준 적정선 ${Math.round(five.pace)}%`; }
        const gw = $("#bd-gap-w");
        gw.hidden = five.pace == null;
        if (five.pace != null) {
          const g = Math.round(used - five.pace);
          gw.dataset.tone = g > 5 ? "led2" : g < -5 ? "grn" : "led";
          setText($("#bd-gap"), (g > 0 ? "+" : g < 0 ? "−" : "±") + Math.abs(g));
          setText($("#bd-gap-txt"), five.proj === "eta" && five.eta ? `${clockText(five.eta, now)} 소진 예상`
            : five.proj === "full" ? "한도 도달" : g > 5 ? "권장선보다 빠름" : g < -5 ? "여유 있음" : "권장선 페이스");
        }
      }
      setText($("#bd-note"), C.limitNote(last, now));
      return L;
    }

    /* ----- 레인 ----- */
    function scoreDigits(el, n) {
      const str = String(n), old = el._score;
      if (old === str) return;
      el.innerHTML = [...str].map((ch, i) => {
        const j = i - (str.length - (old || "").length);  // 오른쪽 정렬로 비교
        const changed = old != null && (j < 0 || old[j] !== ch);
        return `<span class="${changed ? "bd-flip" : ""}">${ch}</span>`;
      }).join("");
      if (old != null && +str > +old) {
        const lane = el.closest(".bd-lane");
        lane.classList.remove("bd-bump"); void lane.offsetWidth; lane.classList.add("bd-bump");
      }
      el._score = str;
    }
    function makeLane(s) {
      const el = doc.createElement("div");
      el.className = "bd-lane";
      el.id = "bd-" + s.sid;
      el.innerHTML = LANE;
      const ta = el.querySelector("textarea"), copy = el.querySelector(".bd-copy");
      ta.value = ctx.memo.get(s.sid);
      ta.oninput = () => ctx.memo.set(s.sid, ta.value);
      el.querySelector(".bd-memo-btn").onclick = () => {
        memoOpen.has(s.sid) ? memoOpen.delete(s.sid) : memoOpen.add(s.sid);
        render();
        if (memoOpen.has(s.sid)) ta.focus();
      };
      copy.onclick = async () => {
        if (!ta.value.trim()) { ta.focus(); return; }
        await ctx.memo.copy(s.sid, ta);
        copy.textContent = "복사됨 ✓"; ctx.after(1800, () => copy.textContent = "복사");
        render();
      };
      return el;
    }
    function renderLane(el, s, status, now) {
      const h = laneHealth(s, status), mainH = status === "working" && s.health ? s.health : null;
      const timeout = status === "needs_input", injury = !timeout && h && h.level === "stall";
      const tone = timeout ? "led" : injury ? "red" : colorOf(s.sid);
      const memo = ctx.memo.get(s.sid), ready = ctx.memo.ready(s.sid);
      const open = memoOpen.has(s.sid) || ready;
      const cls = `bd-lane bd-box c-${tone} st-${status}` + (timeout ? " timeout" : "") + (injury ? " injury" : h ? " slow" : "") + (open ? " memo-open" : "");
      if (el._cls !== cls) {  // 연출용 클래스(bd-bump·goal·whistle)는 건드리지 않음
        const fx = ["bd-bump", "goal", "whistle"].filter(c => el.classList.contains(c));
        el.className = cls; fx.forEach(c => el.classList.add(c)); el._cls = cls;
      }
      const run = s.agents.filter(a => a.status === "running"), back = s.agents.filter(a => a.status === "done");
      const lag = Math.max(0, now - last.now);

      // 팀
      setText(el.querySelector(".bd-team b"), s.project);
      el.querySelector(".bd-team b").title = s.sid;
      const sub = [status === "agents" || (status === "working" && run.length) ? `${run.length}인 출전` : STATUS_WORD[status]];
      if (status !== "idle") sub.push(status === "done" ? hm(s.since) : clock(now - (s.started || s.since)));
      if (s.ctx != null) sub.push(`컨텍스트 ${Math.round(s.ctx)}%`);
      setText(el.querySelector(".bd-team small"), sub.join(" · "));
      const mb = el.querySelector(".bd-memo-btn");
      mb.classList.toggle("has", !!memo.trim());
      mb.classList.toggle("ready", ready);
      setText(mb, ready ? "작전판 준비됨" : memo.trim() ? "작전판 ✎" : "작전판");

      // 현재 플레이
      const lastAct = s.activity[s.activity.length - 1];
      let play = "";
      if (timeout) {
        play = `<div class="bd-now">⏸ 감독 호출 <span class="bd-flag">YOUR CALL</span></div>`
          + `<div class="bd-now bd-cmd bd-mono">${esc(s.note || (lastAct ? lastAct.text : "터미널에서 응답이 필요해요"))}</div>`;
      } else if (status === "done" || status === "idle") {
        play = `<div class="bd-now">${status === "done" ? `<span class="bd-flag fin">FINAL</span> ` : `<span class="bd-dim">휴식 · </span>`}${esc(s.prompt || "경기 종료")}</div>`
          + (status === "done" && s.say ? `<div class="bd-now bd-say">“${esc(s.say)}”</div>` : "");
      } else {
        const card = mainH ? `<span class="bd-flag ${mainH.level === "stall" ? "red" : "yel"}">${mainH.level === "stall" ? "레드카드 · 멈춤 의심" : "옐로카드 · 느림"}</span>`
          : h ? `<span class="bd-flag ${h.level === "stall" ? "red" : "yel"}">${h.level === "stall" ? "선수 부상 의심" : "선수 느림"}</span>` : "";
        const now0 = status === "agents" && !lastAct ? `🧑‍🤝‍🧑 서브에이전트 ${run.length}명 출전 중`
          : lastAct ? `${esc(lastAct.icon)} ${esc(lastAct.text)}` : "💭 작전 구상 중";
        play = `<div class="bd-now">${status === "agents" ? `🧑‍🤝‍🧑 서브에이전트 ${run.length}명 출전 중` : now0} ${card}</div>`;
        if (mainH) {
          const m = Math.max(1, Math.floor((mainH.secs + lag) / 60));
          play += `<div class="bd-now bd-why">${mainH.tool ? `${esc(mainH.tool)} 도구가 ${m}분째 끝나지 않음` : `${m}분째 응답 없음`}${mainH.level === "stall" ? " · VAR 판독 중" : " · 지켜보는 중"}</div>`;
        }
      }
      if (run.length || back.length) {
        play += `<div class="bd-players">` + run.map(a => {
          const card = a.health ? (a.health.level === "stall" ? "red" : "yel") : "";
          const tip = `${a.type} · ${dur(now - a.since)} · 도구 ${a.tools}${a.now ? " · " + a.now.text : ""}${a.health ? ` · ${Math.max(1, Math.floor(a.health.secs / 60))}분째 응답 없음` : ""}`;
          return `<span class="bd-pl ${card}" title="${esc(tip)}">${esc(a.type)} · ${esc(a.desc || "출전")}${a.tools ? ` <i>${a.tools}</i>` : ""}</span>`;
        }).join("") + (back.length ? `<span class="bd-pl out" title="${esc(back.map(a => a.desc || a.type).join(", "))}">↩︎ 벤치 ${back.length}</span>` : "") + `</div>`;
      }
      if (s.todos.length && status !== "idle") {
        const d = s.todos.filter(t => t.status === "completed").length;
        play += `<div class="bd-yard"><div class="bd-cells">${s.todos.map(t =>
          `<i class="${t.status === "completed" ? "on" : t.status === "in_progress" ? "cur" : ""}" title="${esc(t.text)}"></i>`).join("")}</div><span class="bd-mono">${d}/${s.todos.length}</span></div>`;
      }
      setHTML(el.querySelector(".bd-play"), play);

      // 보조 수치: 상황에 따라 대기 시간 / 도구 경과 / 토큰 / 경기 시간
      let lbl = "", val = "", hot = false;
      if (timeout) { lbl = "대기"; val = clock(now - s.since); hot = true; }
      else if (mainH) { lbl = mainH.tool ? "도구 경과" : "무응답"; val = clock(mainH.secs + lag); hot = true; }
      else if (status === "done" && s.run) { lbl = "경기 시간"; val = dur(s.run); }
      else if (s.tokens && s.tokens.total) { lbl = "TOKENS"; val = fmtTok(s.tokens.total); }
      else if (status === "idle") { lbl = "휴식"; val = spanText(now - s.since); }
      setHTML(el.querySelector(".bd-side-stat"), val
        ? `<small>${lbl}</small><div class="bd-mono ${hot ? "bd-glow" : ""}" ${s.tokens && lbl !== "TOKENS" ? `title="토큰 ${fmtTok(s.tokens.total)}"` : ""}>${esc(val)}</div>`
        : "");
      scoreDigits(el.querySelector(".bd-n"), s.tools || 0);

      // 작전판(메모)
      const ta = el.querySelector("textarea");
      if (doc.activeElement !== ta && ta.value !== memo) ta.value = memo;
      el.querySelector(".bd-memo").classList.toggle("ready", ready);
    }
    function renderLanes(now) {
      const box = $("#bd-lanes"), ss = last.sessions;
      if (!ss.length) {
        setHTML(box, `<div class="bd-box bd-nogame"><div class="bd-mono bd-glow">0 : 0</div><b>킥오프 전</b><small>Claude Code에서 프롬프트를 보내면 경기가 시작돼요</small></div>`);
        return;
      }
      if (box.querySelector(".bd-nogame")) { box.innerHTML = ""; box._html = null; }
      const rows = ss.map((s, i) => {
        const status = C.sessionStatus(s, now), h = laneHealth(s, status);
        return { s, i, status, rank: status === "needs_input" ? 0 : h && h.level === "stall" ? 1 : RANK[status] ?? 5 };
      }).sort((a, b) => a.rank - b.rank || a.i - b.i);
      const seen = new Set();
      rows.forEach(({ s, status }, idx) => {
        seen.add("bd-" + s.sid);
        let el = doc.getElementById("bd-" + s.sid);
        if (!el || !box.contains(el)) el = makeLane(s);
        if (box.children[idx] !== el) box.insertBefore(el, box.children[idx] || null);
        renderLane(el, s, status, now);
      });
      for (const el of [...box.children]) if (!seen.has(el.id)) el.remove();
      box.classList.toggle("many", rows.length > 5);
    }

    /* ----- MVP ----- */
    function renderMvp() {
      const box = $("#bd-mvp");
      const best = [...last.sessions].filter(s => s.tools > 0).sort((a, b) => b.tools - a.tools)[0];
      box.hidden = !best;
      if (!best) return;
      const k = best.kinds || {}, total = Object.values(k).reduce((t, n) => t + n, 0);
      const editPct = total ? Math.round(((k.edit || 0) / total) * 100) : 0;
      const style = styleOf(k);
      const bits = [`${best.tools} 플레이`];
      if (editPct) bits.push(`수정 비율 ${editPct}%`);
      if (best.tokens && best.tokens.total) bits.push(`토큰 ${fmtTok(best.tokens.total)}`);
      setHTML(box, `<div class="bd-medal">MVP</div><div class="bd-mvp-txt"><b class="c-${colorOf(best.sid)}">${esc(best.project)}</b>
        <small>${bits.join(" · ")}${style ? ` · “${esc(style)}”` : ""}</small></div>`);
    }

    /* ----- 티커 ----- */
    function renderTicker(now, L) {
      const items = [], ss = last.sessions;
      let urgent = false;
      for (const s of ss) if (s.status === "needs_input") {
        urgent = true;
        items.push(`<span class="hot">⚠ ${esc(s.project)} 감독 호출 ${Math.max(1, Math.ceil((now - s.since) / 60))}분째 — 터미널로!${s.note ? ` (${esc(s.note)})` : ""}</span>`);
      }
      for (const x of C.stalls(last))
        items.push(`<span>■ ${esc(x.project)}${x.agent ? ` · ${esc(x.agent.desc || x.agent.type)}` : ""} ${x.health.tool ? esc(x.health.tool) + " " : ""}${Math.max(1, Math.floor(x.health.secs / 60))}분째 무응답, VAR 판독 중</span>`);
      if (L.five.used != null) {
        const g = L.five.pace != null ? Math.round(L.five.used - L.five.pace) : null;
        items.push(`<span>■ 5시간 한도 ${Math.round(L.five.used)}%${g != null ? g > 5 ? ` · 권장 페이스보다 ${g}%p 빠름` : g < -5 ? ` · 권장 페이스보다 ${-g}%p 여유` : " · 권장 페이스 유지" : ""}</span>`);
      }
      if (L.low) items.push(`<span class="hot">⚠ ${L.low.key === "five" ? "5시간" : "주간"} 한도 잔여 ${L.low.left}% — 큰 작업은 리셋 후에</span>`);
      for (const s of ss) {
        const run = s.agents.filter(a => a.status === "running").length;
        if (run >= 2) items.push(`<span>■ ${esc(s.project)} ${run}인 협공 진행 중</span>`);
      }
      for (const s of ss) if (C.sessionStatus(s, now) === "done")
        items.push(`<span>🏁 FINAL · ${esc(s.project)} ${s.tools} 플레이${s.run ? ` · ${dur(s.run)}` : ""}</span>`);
      if (last.done_today) items.push(`<span>■ 오늘 ${last.done_today}경기 종료${last.today_tokens && last.today_tokens.total ? ` · 토큰 ${fmtTok(last.today_tokens.total)}` : ""}</span>`);
      if (!items.length) items.push(`<span>■ 오늘의 경기 대기 중 · 프롬프트를 보내면 킥오프!</span>`);
      const tk = $("#bd-ticker"), runEl = $("#bd-run");
      tk.classList.toggle("urgent", urgent);
      setText($("#bd-tag"), urgent ? "BREAKING" : "NEWS");
      const one = items.join("");
      if (runEl._one !== one) {
        runEl._one = one;
        runEl.innerHTML = `<div>${one}</div><div aria-hidden="true">${one}</div>`;
        const len = runEl.firstChild.textContent.length;
        const sec = Math.max(18, Math.round(len * 0.22));
        if (runEl._sec !== sec) { runEl._sec = sec; runEl.style.animationDuration = sec + "s"; }
      }
    }

    function render() {
      if (!last) return;
      const now = ctx.now();
      const L = renderHead(now);
      renderLanes(now);
      renderFeed();
      renderMvp();
      renderTicker(now, L);
    }

    /* ----- 세리머니: 완료 = FINAL / 골 ----- */
    ctx.on("done", s => {
      const el = doc.getElementById("bd-" + s.sid);
      if (!el || ctx.settings.quiet) return;
      el.classList.remove("goal"); void el.offsetWidth; el.classList.add("goal");
      ctx.after(3200, () => el.classList.remove("goal"));
    });
    ctx.on("input", s => {
      const el = doc.getElementById("bd-" + s.sid);
      if (!el || ctx.settings.quiet) return;
      el.classList.remove("whistle"); void el.offsetWidth; el.classList.add("whistle");
      ctx.after(1600, () => el.classList.remove("whistle"));
    });
    ctx.listen(root, "animationend", e => { if (e.animationName === "bd-bump") e.target.classList.remove("bd-bump"); });

    /* ----- 버튼 ----- */
    const qb = $("#bd-quiet"), nb = $("#bd-notif");
    const applySettings = () => {
      qb.classList.toggle("on", ctx.settings.quiet);
      qb.textContent = ctx.settings.quiet ? "회의 모드 ON" : "회의 모드";
      nb.hidden = !ctx.notif.canAsk;
    };
    qb.onclick = () => ctx.settings.setQuiet(!ctx.settings.quiet);
    nb.onclick = () => ctx.notif.request();
    applySettings();
    ctx.on("settings", applySettings);
    ctx.on("memo-ready", s => { memoOpen.add(s.sid); render(); });

    ctx.every(500, render);  // 시계·경과 시간

    return {
      update(state) { last = state; collect(ctx.now()); render(); },
    };
  },
});
})();

/* 🪐 궤도 모드: 세션들이 '사용 한도'라는 태양 주위를 도는 조용한 우주 앰비언트 화면.
   태양 = 5시간 한도(안쪽 호) + 주간 한도(바깥 호) + 페이스 눈금, 행성 = 세션(색 = 상태, 링 = 컨텍스트 %),
   파동 = 도구 호출, 달 = 서브에이전트, 붉은 점선 궤도 = 멈춤 의심, 주황 신호 + 카드 = 입력 필요, 별똥별 = 호출 끝.
   그림은 canvas 두 장(정적 배경 / 움직이는 전경), 글자·호버는 DOM. rAF는 ctx.loop로만 돌리고
   탭이 숨겨지거나 회의 모드·prefers-reduced-motion이면 루프를 멈추고 정적 배치로 한 장만 그린다. */
(() => {
"use strict";
const C = window.Core;
const { esc, fmtTok, dur, hms, clockText, spanText } = C;

const TAU = Math.PI * 2, K = 0.62;  // K: 궤도 기울기(타원 세로 비율)
const COL = { work: "#7cc4ff", agent: "#b69cff", ask: "#ffb547", stall: "#ff6b6b", done: "#6ee7b7", idle: "#7a83b8" };
const LABEL = { work: "작업 중", agent: "에이전트 공전", ask: "입력 필요", stall: "멈춤 의심", done: "완료", idle: "대기" };
const SPEED = { work: 1, agent: .8, ask: 0, stall: .03, done: .22, idle: .08 };  // 공전 속도 배율
const RANK = { work: 0, agent: 0, ask: 0, stall: 0, done: 1, idle: 2 };           // 궤도 순서(안쪽부터)
const TOOL = { read: "Read", edit: "Edit", bash: "Bash", search: "Search", web: "Web", agent: "Agent", todo: "Todo", think: "생각 중", other: "Tool" };
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const FPS_MS = 40, CALM_MS = 90;  // 앰비언트 화면이라 ~25fps, 움직임이 거의 없을 땐 ~11fps

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${clamp(a, 0, 1)})`; };
const mixHex = (a, b, t) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const two = n => String(n).padStart(2, "0");
const hm = epoch => { const d = new Date(epoch * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const shortWhen = (epoch, now) => epoch - now < 6 * 86400 && epoch - now > 86400
  ? `${DAYS[new Date(epoch * 1000).getDay()]} ${hm(epoch)}` : clockText(epoch, now);
const mins = sec => Math.max(1, Math.floor(sec / 60));
const ago = sec => sec < 60 ? "방금" : spanText(sec) + " 전";
// 세션 → 화면 상태
function vis(s, now) {
  const st = C.sessionStatus(s, now);
  if (st === "working") return s.health && s.health.level === "stall" ? "stall" : "work";
  return st === "agents" ? "agent" : st === "needs_input" ? "ask" : st === "done" ? "done" : "idle";
}
function healthText(h) {
  return h.tool ? `${h.tool} ${mins(h.secs)}분째 실행 중` : `${mins(h.secs)}분째 응답 없음`;
}
function askText(note) {
  const m = /permission to use (\S+)/i.exec(note || "");
  if (m) return `${m[1]} 허가를 기다려요`;
  if (/waiting for your input/i.test(note || "")) return "입력을 기다려요";
  return note || "응답을 기다려요";
}
const runAgents = s => s.agents.filter(a => a.status === "running");
// 시드 고정 난수 (별 배치가 새로고침해도 같게)
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }
const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

const MARKUP = `
<div class="ob-sky" aria-hidden="true"><canvas class="ob-bg"></canvas><canvas class="ob-orb"></canvas><canvas class="ob-fg"></canvas></div>
<div class="ob-layer"></div>
<div class="ob-sun" aria-live="off"><b class="ob-sun1"></b><span class="ob-sun2"></span><span class="ob-sun3"></span></div>
<header class="ob-top">
  <div class="ob-brand">Orbit · 궤도 모드<b class="ob-head">고요한 우주</b></div>
  <div class="ob-right">
    <div class="ob-clock"><div class="ob-time">--:--</div><div class="ob-reset"></div></div>
    <div class="ob-hud"><button class="ob-btn" id="ob-quiet" type="button" title="움직임과 소리를 꺼요">무음</button><button class="ob-btn" id="ob-notif" type="button">알림 켜기</button></div>
  </div>
</header>
<div class="ob-legend" aria-label="범례">
  <span><i style="--c:${COL.work}"></i>작업 중</span><span><i style="--c:${COL.agent}"></i>에이전트 공전</span>
  <span><i style="--c:${COL.ask}"></i>입력 필요</span><span><i style="--c:${COL.stall}"></i>멈춤 의심</span>
  <span><i style="--c:${COL.done}"></i>완료</span>
  <small>링 = 컨텍스트 · 달 = 서브에이전트<br>태양 = 5시간·주간 한도</small>
</div>
<div class="ob-foot" aria-live="polite"><span class="ob-relay"></span><span class="ob-caret"></span></div>
<button class="ob-ask" type="button" hidden>
  <span class="ob-ask-k"></span><span class="ob-ask-h"></span><code class="ob-ask-d"></code><span class="ob-ask-m">터미널로 돌아가면 궤도로 복귀합니다</span>
</button>
<aside class="ob-panel" hidden aria-label="세션 상세">
  <div class="ob-pdyn"></div>
  <div class="ob-memo"><h4>다음 프롬프트 메모</h4><textarea rows="2" placeholder="끝나면 보낼 다음 지시" aria-label="다음 프롬프트 메모"></textarea>
    <div class="ob-mrow"><span>완료 시 알림 · 이 브라우저에만 저장</span><button class="ob-btn" type="button">복사</button></div></div>
  <div class="ob-hint">클릭하면 고정 · 메모 쓰기</div>
</aside>`;

C.registerMode({
  id: "orbit", label: "궤도", icon: "🪐",
  chimeWave: "sine",
  texts: {
    done: s => [`${s.project} 궤도 한 바퀴 완료`, s.prompt || ""],
    input: s => [`${s.project} 신호 수신`, askText(s.note)],
    stall: x => [`${x.project} 궤도 이탈 의심`, `${x.agent ? x.agent.desc || x.agent.type : "메인 세션"}: ${healthText(x.health)}`],
    memo: (s, text) => [`${s.project} 메모 준비됐어요`, text.slice(0, 80)],
    title: ({ calling, working }) => calling ? `(${calling}) 신호 수신 · 궤도` : working ? `${working}개 공전 중 · 궤도` : "궤도 · Claude 대기실",
  },

  mount(root, ctx) {
    const { doc, win } = ctx;
    root.innerHTML = MARKUP;
    const $ = sel => root.querySelector(sel);
    $(".ob-hud").prepend(ctx.switcher);
    ctx.switcher.querySelector("select").classList.add("ob-btn");

    const bg = $(".ob-bg"), orb = $(".ob-orb"), fg = $(".ob-fg"), g = fg.getContext("2d"), og = orb.getContext("2d"), layer = $(".ob-layer");
    const panel = $(".ob-panel"), pdyn = $(".ob-pdyn"), ta = panel.querySelector("textarea"), copyBtn = panel.querySelector(".ob-memo .ob-btn");
    const askCard = $(".ob-ask");

    let last = null;
    let W = 0, H = 0, dpr = 1, S = 1, cx = 0, cy = 0, rMin = 0, rMax = 0;
    const P = new Map();           // sid → 행성
    let twinkles = [];             // 반짝이는 별 몇 개 (전경에서 그림)
    const shots = [];              // 별똥별
    const flashes = [];            // 입력 필요 순간 번쩍임
    let clock = 0, lastShot = -99; // 애니메이션 시간(초)
    let hover = null, pinned = null, hoverOff = null;
    let orbKey = "";
    let stop = null, prevTs = 0, busy = true, caretOn = null;
    const caret = $(".ob-caret");

    /* ---------- 움직임 정책: 회의 모드·감속 설정·숨김 탭 ---------- */
    const rm = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const moving = () => !ctx.settings.quiet && !(rm && rm.matches);
    function sync() {
      const run = moving() && !doc.hidden;
      if (run && !stop) { prevTs = 0; stop = ctx.loop(frame); }
      else if (!run && stop) { stop(); stop = null; }
      if (!moving()) { settle(); paint(); }
    }
    function frame(ts) {
      if (prevTs && ts - prevTs < (busy ? FPS_MS : CALM_MS)) return;
      const dt = prevTs ? Math.min(.1, (ts - prevTs) / 1000) : 0;
      prevTs = ts;
      clock += dt;
      step(dt);
      paint();
    }

    /* ---------- 크기·배경 ---------- */
    function resize() {
      W = win.innerWidth; H = win.innerHeight; dpr = Math.min(2, win.devicePixelRatio || 1);
      S = clamp(Math.min(W / 1280, H / 800), .5, 1.6);
      cx = W / 2; cy = H * .52;
      const side = W < 560 ? 70 * S + 40 : 190 * S + 30;  // 라벨 자리
      rMax = Math.max(60, Math.min(W / 2 - side, (H / 2 - 110 * S - 10) / K));
      rMin = Math.min(rMax * .62, Math.max(95 * S, 150 * S));
      for (const c of [bg, orb, fg]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); og.setTransform(dpr, 0, 0, dpr, 0, 0); orbKey = "";
      drawBg();
      const sun = $(".ob-sun");
      sun.style.left = cx + "px"; sun.style.top = cy + 84 * S + "px";
      root.style.setProperty("--s", S.toFixed(3));
      layout();
      if (!stop) { settle(); paint(); }
    }
    function drawBg() {
      const b = bg.getContext("2d");
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = Math.hypot(W, H) * .62;
      const gr = b.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, "#141a4a"); gr.addColorStop(.35, "#0c1030"); gr.addColorStop(.8, "#05060d"); gr.addColorStop(1, "#04050a");
      b.fillStyle = gr; b.fillRect(0, 0, W, H);
      // 성운 얼룩 두 개
      for (const [x, y, r, c] of [[W * .18, H * .25, 360, "#3b2a7a"], [W * .85, H * .78, 420, "#123a6a"]]) {
        const n = b.createRadialGradient(x, y, 0, x, y, r * S);
        n.addColorStop(0, rgba(c, .16)); n.addColorStop(1, rgba(c, 0));
        b.fillStyle = n; b.fillRect(0, 0, W, H);
      }
      // 별
      const rand = rng(42), count = Math.round(W * H / 5200);
      twinkles = [];
      for (let i = 0; i < count; i++) {
        const x = rand() * W, y = rand() * H, r = rand() < .08 ? 1.3 : rand() * .8 + .3, a = rand() * .55 + .12;
        if (i % 37 === 0) { twinkles.push({ x, y, r: r + .3, ph: rand() * TAU, sp: .6 + rand() * 1.2 }); continue; }
        b.fillStyle = rand() < .15 ? `rgba(190,205,255,${a})` : `rgba(255,255,255,${a})`;
        b.beginPath(); b.arc(x, y, r, 0, TAU); b.fill();
      }
      // 태양 후광(정적)
      const sg = b.createRadialGradient(cx, cy, 0, cx, cy, 120 * S);
      sg.addColorStop(0, "rgba(255,214,150,.42)"); sg.addColorStop(.35, "rgba(255,170,100,.18)"); sg.addColorStop(1, "rgba(255,150,90,0)");
      b.fillStyle = sg; b.beginPath(); b.arc(cx, cy, 120 * S, 0, TAU); b.fill();
    }

    /* ---------- 행성 관리 ---------- */
    function freeAngle() {  // 기존 행성들 사이 가장 넓은 각 간격의 가운데 (라벨이 덜 겹치게)
      const as = [...P.values()].filter(p => !p.gone).map(p => ((p.a % TAU) + TAU) % TAU).sort((a, b) => a - b);
      if (!as.length) return -Math.PI * .25;
      let best = 0, at = 0;
      as.forEach((a, i) => { const nx = i + 1 < as.length ? as[i + 1] : as[0] + TAU; if (nx - a > best) { best = nx - a; at = a + (nx - a) / 2; } });
      return at;
    }
    function addPlanet(s) {
      const el = doc.createElement("div");
      el.className = "ob-p";
      el.innerHTML = `<button class="ob-hit" type="button"></button><div class="ob-lbl"><b class="ob-n"></b><span class="ob-m"></span><span class="ob-c"></span><span class="ob-moons"></span></div>`;
      const p = { sid: s.sid, s, el, hit: el.firstChild, lbl: el.lastChild, a: freeAngle(), r: 0, rT: 0, spd: 0, appear: 0, gone: false,
        v: "idle", tools: null, agentsRun: new Set(), ripples: [], side: null, flipAt: -9, o: 0, size: 12 };
      const enter = () => { if (hoverOff) { hoverOff(); hoverOff = null; } hover = p; showPanel(); };
      const leave = () => { if (hoverOff) hoverOff(); hoverOff = ctx.after(140, () => { hoverOff = null; if (hover === p) { hover = null; showPanel(); } }); };
      for (const t of [p.hit, p.lbl]) { t.onmouseenter = enter; t.onmouseleave = leave; t.onclick = e => { e.stopPropagation(); pin(p); }; }
      p.hit.onfocus = enter; p.hit.onblur = leave;
      layer.appendChild(el);
      P.set(s.sid, p);
      return p;
    }
    function layout() {  // 궤도 반지름 목표값: 진행 중 → 완료 → 대기 순으로 안쪽부터
      const list = [...P.values()].filter(p => !p.gone).sort((a, b) => RANK[a.v] - RANK[b.v] || (a.sid < b.sid ? -1 : 1));
      const n = list.length;
      const gap = n > 1 ? Math.min((rMax - rMin) / (n - 1), 120 * S) : 0;
      const base = n === 1 ? rMin + (rMax - rMin) * .3 : rMin;
      list.forEach((p, i) => {
        p.rT = base + i * gap;
        if (!p.r) p.r = p.rT + 50 * S;  // 처음 나타날 때 바깥에서 미끄러져 들어옴
        const period = 80 * Math.pow(p.rT / Math.max(1, rMin), 1.5);
        p.spdT = TAU / period * SPEED[p.v];
      });
      for (const p of P.values()) if (p.gone) p.spdT = 0;
    }
    function settle() {  // 정적 배치: 보간 없이 목표값으로
      for (const [sid, p] of P) {
        if (p.gone) { removePlanet(sid, p); continue; }
        p.appear = 1; p.r = p.rT; p.spd = 0; p.ripples.length = 0;
      }
      shots.length = 0; flashes.length = 0;
    }
    function removePlanet(sid, p) {
      p.el.remove(); P.delete(sid);
      if (hover === p) hover = null;
      if (pinned === p) { pinned = null; }
      showPanel();
    }
    function step(dt) {
      const k = 1 - Math.exp(-dt * 2.2), kf = 1 - Math.exp(-dt * 3.5);
      busy = shots.length > 0 || flashes.length > 0;
      for (const [sid, p] of P) {
        p.appear += ((p.gone ? 0 : 1) - p.appear) * kf;
        if (p.gone && p.appear < .02) { removePlanet(sid, p); continue; }
        p.r += (p.rT - p.r) * k;
        p.spd += ((p.spdT || 0) - p.spd) * k;
        p.a += p.spd * dt;
        if (p.ripples.length && clock - p.ripples[0] > 2.6) p.ripples.shift();
        // 작업 중·입력 필요(맥동)이거나 자리를 옮기는 중이면 부드럽게, 아니면 낮은 프레임으로
        if (p.v === "work" || p.v === "agent" || p.v === "ask" || p.ripples.length || p.next || p.gone || p.appear < .99 || Math.abs(p.r - p.rT) > .5) busy = true;
      }
      while (shots.length && clock - shots[0].t0 > shots[0].life) shots.shift();
      while (flashes.length && clock - flashes[0].t0 > 1.6) flashes.shift();
    }
    function pos(p) {
      const x = cx + p.r * Math.cos(p.a), y = cy + p.r * K * Math.sin(p.a);
      const depth = Math.sin(p.a);  // 아래(가까이) +1, 위(멀리) -1
      return { x, y, depth, size: p.size * (1 + .1 * depth) * (.4 + .6 * p.appear) };
    }
    function shoot(p, big = false) {
      if (!moving() || doc.hidden) return;
      if (!big && clock - lastShot < 4) return;  // 별똥별은 가끔만
      lastShot = clock;
      let x, y, dir;
      if (p) {
        const q = pos(p);
        x = q.x; y = q.y;
        const out = Math.atan2(y - cy, x - cx), tan = p.a + Math.PI / 2;  // 바깥 + 진행 방향 사이로 날아감
        dir = Math.atan2(Math.sin(out) + Math.sin(tan) * .6, Math.cos(out) + Math.cos(tan) * .6) + (Math.random() - .5) * .4;
      } else {
        x = W * (.55 + Math.random() * .35); y = H * (.08 + Math.random() * .2); dir = Math.PI * (.82 + Math.random() * .1);
      }
      shots.push({ x, y, dir, t0: clock, life: big ? 1.6 : 1.1, dist: (big ? 320 : 170) * S, big });
    }

    /* ---------- 그리기 ---------- */
    function paint() {
      g.clearRect(0, 0, W, H);
      const L = C.limits(last, ctx.now());
      // 반짝이는 별
      for (const t of twinkles) {
        const a = .25 + .45 * (.5 + .5 * Math.sin(clock * t.sp + t.ph));
        g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(t.x, t.y, t.r, 0, TAU); g.fill();
      }
      const ps = [...P.values()].map(p => ({ p, q: pos(p) }));
      // 궤도: 별도 캔버스에 두고 반지름·상태가 바뀔 때만 다시 그림
      const key = ps.map(({ p }) => `${p.r.toFixed(1)}${p.v}${p.appear.toFixed(2)}`).join("|");
      if (key !== orbKey) {
        orbKey = key;
        og.clearRect(0, 0, W, H);
        og.lineWidth = 1;
        for (const { p } of ps) {
          const stall = p.v === "stall";
          og.setLineDash(stall ? [3, 6] : p.v === "idle" ? [1, 5] : []);
          og.strokeStyle = stall ? rgba(COL.stall, .5 * p.appear) : p.v === "ask" ? rgba(COL.ask, .22 * p.appear) : `rgba(159,176,255,${(p.v === "idle" ? .1 : .14) * p.appear})`;
          og.beginPath(); og.ellipse(cx, cy, p.r, p.r * K, 0, 0, TAU); og.stroke();
        }
      }
      // 꼬리: 움직이는 행성 뒤로 궤도를 따라 흐려지는 선
      for (const { p } of ps) {
        if (p.spd <= 0 || !(p.v === "work" || p.v === "agent")) continue;
        const span = Math.min(1.1, p.spd * 26), c = COL[p.v], N = 8;
        g.lineWidth = 2.2 * S + .4; g.lineCap = "round";
        for (let i = 0; i < N; i++) {
          const a0 = p.a - span * i / N, a1 = p.a - span * (i + 1) / N;
          g.strokeStyle = rgba(c, .38 * (1 - i / N) * p.appear);
          g.beginPath(); g.ellipse(cx, cy, p.r, p.r * K, 0, a1, a0); g.stroke();
        }
      }
      drawSun(L);
      // 멀리 있는 것부터
      ps.sort((a, b) => a.q.y - b.q.y);
      for (const { p, q } of ps) drawPlanet(p, q);
      // 별똥별
      for (const s of shots) {
        const u = (clock - s.t0) / s.life, e = 1 - Math.pow(1 - u, 2);
        const hx = s.x + Math.cos(s.dir) * s.dist * e, hy = s.y + Math.sin(s.dir) * s.dist * e;
        const len = (s.big ? 90 : 55) * S * Math.min(1, u * 3);
        const tx = hx - Math.cos(s.dir) * len, ty = hy - Math.sin(s.dir) * len;
        const fade = u < .75 ? 1 : 1 - (u - .75) / .25;
        const lg = g.createLinearGradient(tx, ty, hx, hy);
        lg.addColorStop(0, "rgba(124,196,255,0)"); lg.addColorStop(1, `rgba(220,236,255,${.9 * fade})`);
        g.strokeStyle = lg; g.lineWidth = s.big ? 2.4 : 1.6; g.lineCap = "round";
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
        g.fillStyle = `rgba(255,255,255,${fade})`; g.beginPath(); g.arc(hx, hy, s.big ? 2.4 : 1.7, 0, TAU); g.fill();
      }
      placeLabels(ps);
      if (hover && !pinned) placePanel(hover);
      // 중계 커서 깜박임 (CSS 애니메이션 대신: 스타일 재계산을 줄임)
      const on = stop ? clock % 1.1 < .55 : null;
      if (on !== caretOn) { caretOn = on; caret.style.opacity = on == null ? "" : on ? "1" : "0"; }
    }
    function arc(r, frac, w, col) {
      g.lineWidth = w; g.lineCap = "round";
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      if (frac > 0) { g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, frac)); g.stroke(); }
    }
    function drawSun(L) {
      const f = L.five, w = L.week, used = f.used != null ? f.used / 100 : 0;
      const breathe = 1 + .035 * Math.sin(clock * .9);
      // 많이 쓸수록 태양이 붉어짐
      const core = mixHex("#fff3d6", "#ffb08a", clamp((used - .5) / .5, 0, 1));
      const R = 22 * S * breathe;
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 2.6);
      cg.addColorStop(0, "rgba(255,246,224,.95)"); cg.addColorStop(.38, "rgba(255,208,138,.55)"); cg.addColorStop(1, "rgba(255,154,90,0)");
      g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, R * 2.6, 0, TAU); g.fill();
      g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
      const fiveCol = f.used == null ? "rgba(255,255,255,.2)" : f.used >= 90 ? COL.stall : f.over ? "#ff9a5a" : "#ffc37a";
      arc(46 * S, f.wasReset ? 0 : used, 4 * S, fiveCol);
      arc(54 * S, w.used != null && !w.wasReset ? w.used / 100 : 0, 1.5 * S, w.used >= 90 ? COL.stall : "#b8c1ff");
      if (f.pace != null && !f.wasReset) {  // 페이스 눈금: 시간 경과로 본 적정 사용량
        const a = -Math.PI / 2 + TAU * f.pace / 100;
        g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 1.5; g.lineCap = "butt";
        g.beginPath(); g.moveTo(cx + 40 * S * Math.cos(a), cy + 40 * S * Math.sin(a)); g.lineTo(cx + 60 * S * Math.cos(a), cy + 60 * S * Math.sin(a)); g.stroke();
      }
    }
    function drawPlanet(p, q) {
      const { x, y, size } = q, c = COL[p.v], al = p.appear, s = p.s;
      const stall = p.v === "stall", live = p.v === "work" || p.v === "agent", anim = !!stop;
      // 후광
      if (!stall) {
        const hg = g.createRadialGradient(x, y, size * .6, x, y, size * 2.6);
        hg.addColorStop(0, rgba(c, (p.v === "idle" ? .1 : .28) * al)); hg.addColorStop(1, rgba(c, 0));
        g.fillStyle = hg; g.beginPath(); g.arc(x, y, size * 2.6, 0, TAU); g.fill();
      }
      // 작업 중: 잔잔한 맥동 / 도구 호출: 또렷한 파동
      g.lineWidth = 1;
      if (live && anim) for (let k = 0; k < 2; k++) {
        const u = ((clock / 2.8) + k / 2) % 1;
        g.strokeStyle = rgba(c, .28 * (1 - u) * al); g.beginPath(); g.arc(x, y, size * (1 + 1.6 * u), 0, TAU); g.stroke();
      }
      for (const t0 of p.ripples) {
        const u = (clock - t0) / 2.6, e = 1 - Math.pow(1 - u, 3);
        g.lineWidth = 1.6 * (1 - u) + .4;
        g.strokeStyle = rgba(c, .75 * (1 - u) * al); g.beginPath(); g.arc(x, y, size + 6 + e * 46 * S, 0, TAU); g.stroke();
      }
      // 입력 필요: 주황 신호(봉화)
      if (p.v === "ask") {
        const b = anim ? .5 + .5 * Math.sin(clock * 3.9) : .6;
        g.fillStyle = rgba(c, (.08 + .1 * b) * al); g.beginPath(); g.arc(x, y, size + 16 * S, 0, TAU); g.fill();
        if (anim) {
          const u = (clock / 2.4) % 1;
          g.lineWidth = 1; g.strokeStyle = rgba(c, .55 * (1 - u) * al); g.beginPath(); g.arc(x, y, size + (16 + 30 * u) * S, 0, TAU); g.stroke();
        } else { g.lineWidth = 1; g.strokeStyle = rgba(c, .45); g.beginPath(); g.arc(x, y, size + 30 * S, 0, TAU); g.stroke(); }
      }
      for (const f of flashes) if (f.sid === p.sid) {
        const u = (clock - f.t0) / 1.6;
        g.lineWidth = 2; g.strokeStyle = rgba(c, .8 * (1 - u)); g.beginPath(); g.arc(x, y, size + (8 + 70 * u) * S, 0, TAU); g.stroke();
      }
      // 컨텍스트 링
      const rr = size + 6 * S;
      g.lineWidth = 2; g.lineCap = "round";
      g.strokeStyle = `rgba(255,255,255,${.1 * al})`; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
      if (s.ctx != null) {
        g.strokeStyle = rgba(s.ctx >= 85 ? COL.stall : c, .92 * al);
        g.beginPath(); g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(s.ctx / 100, 0, 1)); g.stroke();
      }
      // 행성 몸체
      const pg = g.createRadialGradient(x - size * .35, y - size * .35, 0, x, y, size);
      pg.addColorStop(0, stall ? "rgba(255,210,210,.55)" : "#ffffff"); pg.addColorStop(.28, stall ? "#8a3a46" : c);
      pg.addColorStop(1, stall ? "#2a0f17" : p.v === "idle" ? "#10132c" : "#14183a");
      g.globalAlpha = al * (stall ? .78 : p.v === "idle" ? .7 : 1);
      g.fillStyle = pg; g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill();
      g.globalAlpha = 1;
      // 달 = 실행 중 서브에이전트
      const moons = runAgents(s).slice(0, 6);
      moons.forEach((a, i) => {
        const mr = size + (14 + i * 7) * S, per = 7 + i * 3.2, ph = (C.hash(a.aid) % 628) / 100;
        const ang = ph + (anim ? clock * TAU / per : 0);
        const dim = a.health && a.health.level === "stall";
        g.lineWidth = 1; g.strokeStyle = rgba(dim ? COL.stall : COL.agent, (dim ? .22 : .14) * al);
        g.setLineDash(dim ? [2, 4] : []);
        g.beginPath(); g.arc(x, y, mr, 0, TAU); g.stroke(); g.setLineDash([]);
        const mx = x + mr * Math.cos(ang), my = y + mr * Math.sin(ang), msz = Math.max(1.6, (3.6 - i * .35) * S + .4);
        if (!dim) {
          const mg = g.createRadialGradient(mx, my, 0, mx, my, msz * 3);
          mg.addColorStop(0, `rgba(226,216,255,${.5 * al})`); mg.addColorStop(1, "rgba(226,216,255,0)");
          g.fillStyle = mg; g.beginPath(); g.arc(mx, my, msz * 3, 0, TAU); g.fill();
        }
        g.fillStyle = dim ? `rgba(120,70,82,${al})` : `rgba(236,230,255,${al})`;
        g.beginPath(); g.arc(mx, my, msz, 0, TAU); g.fill();
      });
    }

    /* ---------- 라벨(DOM): 위치는 매 프레임, 내용은 상태가 바뀔 때만 ---------- */
    function placeLabels(ps) {
      const anim = !!stop;
      for (const { p, q } of ps) {
        const dx = q.x - cx;
        if (!anim) { p.side = dx < 0 ? "L" : "R"; p.flipAt = -9; p.next = null; }
        else {
          if (!p.side) p.side = dx < 0 ? "L" : "R";
          // 히스테리시스: 중심을 충분히 넘어가야 반대편으로. 흐려졌다가 반대편에서 나타남
          const want = p.side === "R" && dx < -p.r * .3 ? "L" : p.side === "L" && dx > p.r * .3 ? "R" : p.side;
          if (want !== p.side && !p.next) { p.next = want; p.flipAt = clock; }
          if (p.next && clock - p.flipAt >= .3) { p.side = p.next; p.next = null; }
        }
        const fu = (clock - p.flipAt) / .6;
        const o = (anim && fu < 1 ? Math.abs(Math.cos(Math.PI * fu)) : 1) * p.appear;
        p.el.style.transform = `translate3d(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px,0)`;
        if (Math.abs(o - p.o) > .02 || (o === 1 && p.o !== 1)) { p.o = o; p.el.style.opacity = o.toFixed(2); }
        const off = Math.round(q.size + 14 * S), hit = Math.round((q.size + 10) * 2);
        if (p._off !== off) { p._off = off; p.el.style.setProperty("--off", off + "px"); }
        if (p._hit !== hit) { p._hit = hit; p.el.style.setProperty("--hit", hit + "px"); }
        const cls = `ob-p ${p.v} side-${p.side}${p === hover || p === pinned ? " on" : ""}${p.gone ? " gone" : ""}`;
        if (p.el.className !== cls) p.el.className = cls;
      }
    }
    function renderLabel(p, now) {
      const s = p.s, run = runAgents(s);
      const tok = s.tokens && s.tokens.total ? " · " + fmtTok(s.tokens.total) : "";
      const meta = {
        work: () => `${TOOL[s.kind] || "Tool"} · ${s.tools}회${tok}`,
        agent: () => `에이전트 ${run.length} · ${s.tools}회${tok}`,
        ask: () => `입력 대기 ${mins(now - s.since)}분`,
        stall: () => healthText(s.health),
        done: () => `완료 · ${ago(now - s.since)}`,
        idle: () => `대기 · ${spanText(now - s.since)}`,
      }[p.v]();
      const memo = ctx.memo.get(s.sid).trim(), ready = ctx.memo.ready(s.sid);
      setText(p.lbl.querySelector(".ob-n"), s.project);
      setHTML(p.lbl.querySelector(".ob-m"), esc(meta) + (memo ? ` <em class="${ready ? "ready" : ""}" title="${ready ? "메모 준비됨" : "메모 있음"}">${ready ? "✎ 메모 준비됨" : "✎"}</em>` : ""));
      setText(p.lbl.querySelector(".ob-c"), s.ctx != null ? `컨텍스트 ${Math.round(s.ctx)}%` : "");
      setHTML(p.lbl.querySelector(".ob-moons"), run.slice(0, 4).map(a => {
        const st = a.health && a.health.level === "stall";
        return `<span class="${st ? "dim" : ""}">☾ ${esc(a.type)} · ${esc(a.desc || "작업 중")}${st ? " · 멈춤 의심" : ""}</span>`;
      }).join("") + (run.length > 4 ? `<span>☾ 외 ${run.length - 4}개</span>` : ""));
      p.hit.setAttribute("aria-label", `${s.project} · ${LABEL[p.v]} · ${meta}`);
    }

    /* ---------- 상세 패널 (호버 = 미리보기, 클릭 = 고정 + 메모) ---------- */
    function pin(p) {
      if (pinned === p) { pinned = null; showPanel(); return; }
      pinned = p; showPanel(); placePanel(p);
    }
    function showPanel() {
      const p = pinned || hover;
      if (!p || !P.has(p.sid)) { panel.hidden = true; panel._sid = null; return; }
      panel.hidden = false;
      panel.classList.toggle("pinned", p === pinned);
      const now = ctx.now(), s = p.s, ags = s.agents.filter(a => a.desc || a.tools || a.status === "running");
      const acts = s.activity.slice(-4).reverse();
      const t = s.todos, td = t.filter(x => x.status === "completed").length;
      setHTML(pdyn, `
        <div class="ob-ph"><i style="--c:${COL[p.v]}"></i><b>${esc(s.project)}</b><span>${LABEL[p.v]} · ${dur(now - s.since)}</span>${p === pinned ? `<button class="ob-x" type="button" aria-label="닫기">×</button>` : ""}</div>
        ${p.v === "ask" ? `<div class="ob-callout">${esc(askText(s.note))}</div>` : ""}
        ${p.v === "stall" ? `<div class="ob-callout stall">${esc(healthText(s.health))} · 터미널을 확인해 보세요</div>` : ""}
        <h4>프롬프트</h4><p class="ob-prompt">${s.prompt ? esc(s.prompt) : "—"}</p>
        ${s.say ? `<h4>마지막 발화</h4><p class="ob-say">${esc(s.say)}</p>` : ""}
        <h4>최근 도구 <span>${s.tools}회${s.tokens && s.tokens.total ? " · " + fmtTok(s.tokens.total) + " 토큰" : ""}${s.ctx != null ? ` · 컨텍스트 ${Math.round(s.ctx)}%` : ""}</span></h4>
        ${acts.length ? `<ul class="ob-acts">${acts.map(a => `<li><time>${hms(a.ts)}</time><span>${esc(a.icon)} ${esc(a.text)}</span></li>`).join("")}</ul>` : `<p class="ob-none">아직 도구 호출 없음</p>`}
        ${ags.length ? `<h4>달 · 서브에이전트 <span>${ags.filter(a => a.status === "running").length} / ${ags.length}</span></h4><ul class="ob-ags">${ags.map(a => {
          const st = a.health && a.health.level === "stall";
          return `<li class="${a.status} ${st ? "stall" : ""}"><b>☾ ${esc(a.desc || a.type)}</b><span>${esc(a.type)} · ${a.status === "running" ? dur(now - a.since) + (a.now ? " · " + esc(a.now.text) : "") : "완료 " + dur((a.ended || now) - a.since)}${st ? " · 멈춤 의심" : ""}</span></li>`;
        }).join("")}</ul>` : ""}
        ${t.length ? `<h4>할 일 <span>${td} / ${t.length}</span></h4><div class="ob-bar"><b style="width:${td / t.length * 100}%"></b></div>` : ""}`);
      const x = pdyn.querySelector(".ob-x");
      if (x) x.onclick = e => { e.stopPropagation(); pinned = null; showPanel(); };
      if (panel._sid !== s.sid) { panel._sid = s.sid; ta.value = ctx.memo.get(s.sid); }
      else if (doc.activeElement !== ta && ta.value !== ctx.memo.get(s.sid)) ta.value = ctx.memo.get(s.sid);
      panel.querySelector(".ob-memo").classList.toggle("ready", ctx.memo.ready(s.sid));
      if (!stop || p === pinned) placePanel(p);
    }
    function placePanel(p) {
      if (panel.hidden) return;
      const q = pos(p), pw = panel.offsetWidth || 300, ph = panel.offsetHeight || 200;
      // 라벨 반대편에 둠
      let x = p.side === "L" ? q.x + q.size + 24 * S : q.x - q.size - 24 * S - pw;
      if (x < 12 || x + pw > W - 12) x = p.side === "L" ? q.x - q.size - 24 * S - pw : q.x + q.size + 24 * S;
      x = clamp(x, 12, W - pw - 12);
      const y = clamp(q.y - ph / 2, 12, H - ph - 12);
      panel.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
    }
    ta.oninput = () => { if (panel._sid) ctx.memo.set(panel._sid, ta.value); };
    copyBtn.onclick = async e => {
      e.stopPropagation();
      if (!panel._sid || !ta.value.trim()) { ta.focus(); return; }
      await ctx.memo.copy(panel._sid, ta);
      copyBtn.textContent = "복사됨"; ctx.after(1600, () => { copyBtn.textContent = "복사"; });
    };
    panel.onclick = e => e.stopPropagation();
    panel.onmouseenter = () => { if (hoverOff && !pinned) { hoverOff(); hoverOff = null; } };
    panel.onmouseleave = () => { if (!pinned && hover) { const h = hover; hoverOff = ctx.after(140, () => { hoverOff = null; if (hover === h) { hover = null; showPanel(); } }); } };
    ctx.listen(doc, "keydown", e => { if (e.key === "Escape" && pinned) { pinned = null; showPanel(); } });
    root.querySelector(".ob-sky").onclick = () => { if (pinned) { pinned = null; showPanel(); } };
    askCard.onclick = () => { const p = P.get(askCard._sid); if (p) { pinned = null; pin(p); } };

    /* ---------- 글자: 시계·태양·중계·신호 카드 ---------- */
    function renderChrome(now) {
      const L = C.limits(last, now), f = L.five, w = L.week;
      setText($(".ob-time"), hm(now));
      setText($(".ob-reset"), f.wasReset ? "5시간 창 리셋됨 · 다음 요청 때 갱신" : f.reset ? `5시간 창 리셋까지 ${Math.floor((f.reset - now) / 3600)}:${two(Math.floor((f.reset - now) % 3600 / 60))}` : "");
      if (!last) return;
      const ss = last.sessions;
      setText($(".ob-head"), ss.length ? `${ss.length}개의 세션이 공전 중` : "고요한 우주");
      // 태양 아래 글자
      const gap = f.used != null && f.pace != null && !f.wasReset ? Math.round(f.used - f.pace) : null;
      setText($(".ob-sun1"), f.wasReset ? "5시간 창 리셋됨" : f.used == null ? "사용 한도 정보 없음" : `5시간 ${Math.round(f.used)}%` + (gap != null ? ` · 페이스 ${gap >= 0 ? "+" : "−"}${Math.abs(gap)}%p` : ""));
      $(".ob-sun1").className = "ob-sun1" + (f.used >= 90 ? " low" : f.over ? " over" : "");
      setText($(".ob-sun2"), w.used == null ? (w.wasReset ? "주간 리셋됨" : "") : `주간 ${Math.round(w.used)}%` + (w.reset ? ` · ${shortWhen(w.reset, now)} 리셋` : ""));
      const note = C.limitNote(last, now);
      setText($(".ob-sun3"), f.proj === "eta" && f.eta ? `지금 속도면 ${clockText(f.eta, now)} 소진` : f.proj === "full" ? "한도 도달 · 리셋 대기" : note);
      $(".ob-sun3").classList.toggle("warn", f.proj === "eta" || f.proj === "full");
      // 중계 한 줄: 가장 최근에 움직인 세션
      const act = ss.filter(s => s.status === "working" || s.status === "agents")
        .map(s => ({ s, ts: Math.max(s.activity.length ? s.activity[s.activity.length - 1].ts : 0, ...s.agents.filter(a => a.status === "running").map(a => a.last || 0)) }))
        .sort((a, b) => b.ts - a.ts)[0];
      let relay;
      if (act) {
        const s = act.s, la = s.activity[s.activity.length - 1], run = runAgents(s);
        const t = s.todos.length ? ` · 할 일 ${s.todos.filter(x => x.status === "completed").length}/${s.todos.length}` : "";
        const ra = run.filter(a => a.now).sort((a, b) => (b.last || 0) - (a.last || 0))[0];
        const what = s.status === "agents" ? `달 ${run.length}개가 도는 중${ra ? " · " + ra.now.text : ""}`
          : s.health && s.health.level === "stall" ? healthText(s.health)
          : la ? la.text : "생각하는 중";
        relay = `<em>${esc(s.project)}</em> ${esc(what)}${esc(t)}`;
      } else if (ss.some(s => s.status === "needs_input")) relay = "모든 궤도가 신호 응답을 기다리는 중";
      else relay = ss.length ? `모든 궤도가 고요해요 · 오늘 ${last.done_today || 0}번 완료` : "세션이 없어요 · Claude Code에서 프롬프트를 보내면 새 행성이 떠올라요";
      const rl = $(".ob-relay");
      if (rl._html !== relay) { rl.innerHTML = relay; rl._html = relay; rl.classList.remove("in"); void rl.offsetWidth; rl.classList.add("in"); }
      $(".ob-caret").style.setProperty("--c", act ? COL[vis(act.s, now)] : COL.idle);
      // 신호 수신 카드
      const calling = ss.filter(s => s.status === "needs_input").sort((a, b) => a.since - b.since);
      askCard.hidden = !calling.length;
      if (calling.length) {
        const s = calling[0], la = s.activity[s.activity.length - 1];
        askCard._sid = s.sid;
        setText(askCard.querySelector(".ob-ask-k"), `● 신호 수신 · ${ago(now - s.since)}${calling.length > 1 ? ` · 외 ${calling.length - 1}개` : ""}`);
        setText(askCard.querySelector(".ob-ask-h"), `${s.project} · ${askText(s.note)}`);
        const d = askCard.querySelector(".ob-ask-d");
        d.hidden = !la;
        if (la) setText(d, (la.icon === "⚡" ? "$ " : la.icon + " ") + la.text);
      }
    }
    function renderAll() {
      if (!last) { renderChrome(ctx.now()); return; }
      const now = ctx.now();
      for (const p of P.values()) if (!p.gone) renderLabel(p, now);
      renderChrome(now);
      if (panel._sid || hover || pinned) showPanel();
    }

    /* ---------- 상태 반영 ---------- */
    function update(state) {
      last = state;
      const now = ctx.now(), seen = new Set();
      for (const s of state.sessions) {
        seen.add(s.sid);
        let p = P.get(s.sid);
        if (!p) p = addPlanet(s);
        p.gone = false;
        p.s = s;
        p.v = vis(s, now);
        p.size = (13 + Math.min(8, Math.log2(1 + ((s.tokens && s.tokens.total) || 0) / 15000) * 2.2)) * S;
        // 도구 호출 → 파동, 끝난 호출 → 별똥별
        const tools = s.tools + s.agents.reduce((t, a) => t + (a.tools || 0), 0);
        if (p.tools != null && tools > p.tools && stop) {
          p.ripples.push(clock); if (p.ripples.length > 4) p.ripples.shift();
          shoot(p);
        }
        p.tools = tools;
        const run = new Set(runAgents(s).map(a => a.aid));
        for (const aid of p.agentsRun) if (!run.has(aid)) shoot(p);  // 달이 임무를 마치고 떠남
        p.agentsRun = run;
      }
      for (const [sid, p] of P) if (!seen.has(sid)) { p.gone = true; if (!stop) removePlanet(sid, p); }
      layout();
      renderAll();
      if (!stop) { settle(); paint(); }
    }

    /* ---------- 설정 버튼 ---------- */
    const qb = $("#ob-quiet"), nb = $("#ob-notif");
    const applySettings = () => {
      qb.classList.toggle("on", ctx.settings.quiet); qb.textContent = ctx.settings.quiet ? "무음 켜짐" : "무음";
      nb.hidden = !ctx.notif.canAsk;
      sync();
    };
    qb.onclick = () => ctx.settings.setQuiet(!ctx.settings.quiet);
    nb.onclick = () => ctx.notif.request();

    ctx.on("settings", applySettings);
    ctx.on("done", s => { const p = P.get(s.sid); shoot(p, true); });
    ctx.on("input", s => { if (stop) flashes.push({ sid: s.sid, t0: clock }); });
    ctx.on("memo", renderAll);
    ctx.on("memo-ready", renderAll);
    ctx.listen(doc, "visibilitychange", sync);
    ctx.listen(win, "resize", resize);
    if (rm) ctx.listen(rm, "change", sync);
    ctx.every(1000, () => { if (!doc.hidden) renderAll(); });  // 경과 분·시계

    resize();
    applySettings();
    renderChrome(ctx.now());

    return {
      update,
      unmount() { P.clear(); shots.length = 0; },
    };
  },
});
})();

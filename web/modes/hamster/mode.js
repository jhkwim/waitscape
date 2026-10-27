/* 🐹 햄찌 모드: 도트풍 게임 UI (집·말풍선·아기 햄찌·연주회·칭호·리플레이·색종이·오늘의 햄찌 카드)
   코어가 처음 선택될 때만 불러오고, 다른 모드로 바꾸면 unmount로 DOM·타이머·소리를 모두 정리한다. */
(() => {
"use strict";
const C = window.Core;
const { hash, pick, esc, fmt, fmtTok, untilText, clockText, spanText } = C;

const STATUS = {
  working: ["일하는 중", "var(--working)"],
  agents: ["파티 출동!", "var(--working)"],
  needs_input: ["불러요!", "var(--input)"],
  done: ["클리어!", "var(--done)"],
  idle: ["쿨쿨", "var(--idle)"],
};
const LINES = {
  think: ["음… 생각 중", "어디부터 볼까?", "볼주머니 정리 중"],
  other: ["뚝딱뚝딱", "잠깐만요~"],
  read: ["흠흠… 읽는 중", "이 파일 재밌다", "밑줄 쫙"],
  edit: ["고쳐볼게!", "갉작갉작", "여기 살짝만…"],
  bash: ["영차영차!", "쳇바퀴 풀가동!", "돌려보는 중!"],
  search: ["어디 있지…?", "킁킁, 냄새가 나", "여기 있나…?"],
  web: ["물어보고 올게!", "인터넷 다녀올게"],
  agent: ["도와줘~!", "아기들아 출동!"],
  todo: ["퀘스트 정리!", "체크체크 ✓"],
  wait: ["아기들 기다리는 중", "언제 오려나…"],
  needs_input: ["이거 해도 돼요?", "저 좀 봐주세요!", "허락이 필요해요 🙏"],
  done: ["다 했어요!", "냠냠 보상 타임", "확인해 주세요 💛"],
  idle: ["쿨…", "Zzz…"],
  stuck: ["음… 막혔나? 🤔", "응답이 안 와요…", "멍… 🫥"],
};
const AGE_LINES = { 1: "조금만 기다려요 💦", 5: "집중 모드!", 15: "밤새는 거 아니죠…?" };
const POKE = ["히히 간지러워", "콕!", "일하는 중이라구요", "볼 만지지 마요~", "💛"];
const FURS = [
  ["#f3c58e", "#fff3e2"], ["#f7e6c8", "#fffaf1"], ["#cfc8bf", "#f4f0ea"],
  ["#c99a6e", "#f3dfc8"], ["#fbf3ea", "#ffffff"], ["#e8b07a", "#fbe7d0"],
];
const ROOFS = ["#ff8a7a", "#7ac4ff", "#ffb84d", "#a98bff", "#5fcf9a", "#ff9ec7"];
const BREAKS = [
  ["🙆", "목 스트레칭", "고개를 천천히 좌우로 10초씩 기울여 보세요."],
  ["👀", "20-20-20", "6m 먼 곳을 20초 동안 바라보세요."],
  ["💧", "물 한 잔", "햄찌도 일하는데 나도 수분 보충."],
  ["🧘", "깊은 숨 세 번", "4초 들이쉬고, 4초 참고, 6초 내쉬기."],
  ["🙌", "어깨 으쓱", "어깨를 귀까지 올렸다 툭 떨어뜨리기 5번."],
  ["✍️", "다음 프롬프트 생각", "끝나면 뭘 시킬지 미리 적어두면 대기 시간이 줄어요."],
];
const furStyle = sid => { const [f, b] = FURS[hash(sid) % FURS.length]; return `--fur:${f};--belly:${b}`; };

function healthText(h) {
  const m = Math.max(1, Math.floor(h.secs / 60));
  if (h.tool) return h.level === "stall" ? `⚠️ ${h.tool} ${m}분째 안 끝남 · 멈춤 의심` : `⏳ ${h.tool} 실행 ${m}분째`;
  return h.level === "stall" ? `⚠️ ${m}분째 응답 없음 · 멈춤 의심` : `💭 ${m}분째 생각 중`;
}

/* ---------- 🐹 도트 햄찌: 문자 그림 → <path> (한 칸 = 5) ----------
   문자 = 색 클래스 k-문자 (CSS 참고), "." = 빈칸. mirror면 왼쪽 절반을 좌우 반전해 붙임 */
const PX = 5;
function spr(rows, ox = 0, oy = 0, mirror = false) {
  const d = {};
  rows.forEach((r, y) => {
    if (mirror) r += [...r].reverse().join("");
    for (let x = 0; x < r.length;) {
      let n = 1;
      while (r[x + n] === r[x]) n++;
      if (r[x] !== ".") (d[r[x]] ||= []).push(`M${(ox + x) * PX} ${(oy + y) * PX}h${n * PX}v${PX}h${-n * PX}z`);
      x += n;
    }
  });
  return Object.entries(d).map(([c, p]) => `<path class="k-${c}" d="${p.join("")}"/>`).join("");
}
function wheelSprite() {  // 쳇바퀴: 테두리 고리 + 바큇살 두 프레임(+ / ×)을 번갈아 보여 돌아가는 것처럼
  const ring = [], a = [], b = [];
  for (let y = -1; y < 27; y++) for (let x = -1; x < 25; x++) {
    const dx = x + .5 - 12, dy = y + .5 - 13, r = Math.hypot(dx, dy), c = `M${x * PX} ${y * PX}h${PX}v${PX}h${-PX}z`;
    if (Math.abs(r - 11.5) < .62) ring.push(c);
    else if (r < 11) {
      if (Math.abs(dx) < 1 || Math.abs(dy) < 1) a.push(c);
      else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < .8) b.push(c);
    }
  }
  return `<path class="k-s" d="${ring.join("")}"/><path class="k-s spk spk-a" d="${a.join("")}"/><path class="k-s spk spk-b" d="${b.join("")}"/>`;
}
let SPR = null;  // 첫 mount 때 한 번 만듦
const sprites = () => SPR ||= {
  wheel: wheelSprite(),
  ears: spr(["...ooo......", "..oppfo.....", "..offfo....."], 0, 2, true),
  body: spr([
    "....oooooooo",
    "..ooffffffff",
    ".offllffffff",
    ".offlfffffff",
    "offfffffffff",
    "offfffffffff",
    "offfffffffff",
    "offcccfffffp",
    "offcccffffof",
    "offffffffffo",
    "offffffbbbbb",
    "offfffbbbbbb",
    "offfffhhbbbb",
    "odffffhhbbbb",
    ".odfffbbbbbb",
    ".oddfffbbbbb",
    "..oddffhhbbb",
    "...ooooooooo",
  ], 0, 4, true),
  open: spr(["ew......ew", "ee......ee", "ee......ee"], 7, 8),
  closed: spr(["e..e....e..e", ".ee......ee."], 6, 9),
  band: spr(["...rrrrrrrrr", "..RRRRRRRRRR"], 0, 5, true) + spr([".rr", "rr.", "r.r"], 21, 4),
  glasses: spr(["nnnn....nnnn", "n..nnnnnn..n", "n..n....n..n", "nnnn....nnnn"], 6, 7),
  book: spr(["kkkkkkkkkk", "kwwwkkwwwk", "kwGGkkGGwk", "kwwwkkwwwk", "kuuuuuuuuk"], 7, 17),
  pencil: spr([".....kk.", "....kpk.", "...kyyk.", "..kyyk..", ".kTTk...", "kkk....."], 15, 12),
  lens: spr([".kkkk...", "kwLLLk..", "kLLLLk..", "kLLLLk..", ".kkkkn..", ".....nn.", "......nn"], 16, 14),
  sign: spr(Array(14).fill("n"), 20, 7)
    + spr(["kkkkkkkkk", "kyyyyyyyk", "kyyykyyyk", "kyyykyyyk", "kyyykyyyk", "kyyyyyyyk", "kyyykyyyk", "kyyyyyyyk", "kkkkkkkkk"], 16, -1),
  flower: spr(["...kk...", "..kyyk..", ".kynnyk.", "kynnnnyk", ".kynnyk.", "..kyyk..", "...gg...", "..ggg..."], 8, 14),
  heart: spr([".kk.kk.", "kwHkHHk", "kHHHHHk", ".kHHHk.", "..kHk..", "...k..."], 22, 0),
  plane: spr(["......k", "....kkk", "..kkwwk", "kkwwwwk", "..kkwk.", "....kk."], 22, 0),
  scroll: spr([".kkkkk.", "kqqqqqk", "kqnnnqk", "kqqqqqk", "kqnnqqk", ".kkkkk."], 18, 16),
  think: spr([".kkkkk.", "kwwwwwk", "kwkwkwk", "kwwwwwk", ".kkkkk.", "kk....."], 22, 0),
  star: spr(["...k...", "..kyk..", ".kyyyk.", "kyywyyk", ".kyyyk.", "..kyk..", "...k..."], 22, 0),
  hourglass: spr(["kkkkk", "kyyyk", ".kyk.", ".kwk.", "kwywk", "kkkkk"], 23, 0),
  zz: spr([".....zzz", "......z.", "zzzz.zzz", "..z.....", ".z......", "zzzz...."], 22, 0),
  sweat: spr([".u.", "uwu", "uuu", ".u."], 22, 5),
  candle: spr(["..k..", ".kkk.", ".kCk.", ".kCk.", ".kCk.", "kkkkk"], -5, 16),
  flame: spr(["..a..", ".aya."], -5, 14),
};
function hamster(props = true) {
  const S = sprites();
  return `<svg class="ham" viewBox="0 0 120 112" shape-rendering="crispEdges">
  ${props ? `<g class="p p-bash wheel">${S.wheel}</g>` : ""}
  <g class="body">
    <g class="ears">${S.ears}</g>${S.body}
    <g class="open">${S.open}</g><g class="closed">${S.closed}</g>
    ${props ? `<g class="a a-band">${S.band}</g>
    <g class="p p-read">${S.glasses}${S.book}</g>
    <g class="p p-edit">${S.pencil}</g>
    <g class="p p-search">${S.lens}</g>
    <g class="p p-input">${S.sign}</g>
    <g class="p p-done">${S.flower}</g>` : ""}
  </g>
  ${props ? `<g class="p p-web">${S.plane}</g><g class="p p-todo">${S.scroll}</g>
  <g class="p p-think">${S.think}</g><g class="p p-agent">${S.star}</g>
  <g class="p p-wait">${S.hourglass}</g><g class="p p-done">${S.heart}</g>
  <g class="p p-sleep">${S.zz}</g>
  <g class="a a-sweat">${S.sweat}</g><g class="a a-candle">${S.candle}<g class="flame">${S.flame}</g></g>` : ""}
</svg>`;
}

/* ---------- 🏷️ 칭호: 작업량이 아니라 스타일로 ---------- */
const STYLE = {
  read: ["📚", "독서광 햄찌"], edit: ["✏️", "장인 햄찌"], bash: ["💪", "쳇바퀴 근육맨"], search: ["🕵️", "탐정 햄찌"],
  web: ["🌐", "탐험가 햄찌"], agent: ["👑", "대가족 햄찌"], todo: ["📋", "계획왕 햄찌"], other: ["🔧", "만능 햄찌"],
};
function titleFor(kinds, { agents = 0, run = 0, done = false } = {}) {
  const entries = Object.entries(kinds || {}).filter(([k]) => k !== "think" && k !== "other");
  const total = entries.reduce((t, [, n]) => t + n, 0);
  if (total < 3) return done && total && run < 120 ? ["⚡", "번개 햄찌"] : null;
  if (agents >= 3) return STYLE.agent;
  if (run >= 900) return ["🕯️", "야근 햄찌"];
  const [top, n] = entries.sort((a, b) => b[1] - a[1])[0];
  return n / total < .35 ? ["🎨", "올라운더 햄찌"] : STYLE[top] || STYLE.other;
}
const KIND_LABEL = { read: "📖 읽기", edit: "✏️ 수정", bash: "⚡ 실행", search: "🔍 검색", web: "🌐 웹", agent: "🤖 에이전트", todo: "📋 계획" };

/* ---------- 🎵 연주회 음색 ---------- */
const PENTA = [0, 2, 4, 7, 9];
const PADS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];

const MARKUP = `
<div class="sky" aria-hidden="true">
  <div class="stars"></div><div class="moon"></div>
  <div class="cloud" style="top:60px; animation-duration:70s; animation-delay:-20s"></div>
  <div class="cloud" style="top:150px; animation-duration:95s; animation-delay:-60s; transform:scale(.7)"></div>
  <div class="cloud" style="top:260px; animation-duration:120s; animation-delay:-5s"></div>
  <div class="hill h1"></div><div class="hill h2"></div>
</div>
<header>
  <div class="title">🐹 모찌 햄찌네</div>
  <div class="hud">
    <div class="res" title="일하는 햄찌"><span class="ic">🐹</span><b id="n-working">0</b></div>
    <div class="res" title="부르는 햄찌"><span class="ic">❗</span><b id="n-input">0</b></div>
    <div class="res" title="오늘 끝낸 일 = 모은 해바라기씨"><span class="ic">🌻</span><b id="seeds">0</b></div>
    <div class="res" id="tok-pill" title="오늘 쓴 토큰"><span class="ic">🪙</span><b id="today-tok">0</b></div>
    <div class="res" title="오늘 기다린 시간"><span class="ic">⏱</span><b id="waited">0분</b></div>
    <div class="res clickable" id="title-pill" title="오늘의 햄찌 카드 보기"><span class="ic">🏷️</span><b id="today-title">새내기 햄찌</b></div>
    <button class="btn" id="music-btn" title="도구 호출마다 음이 울려요">🎵 연주회</button>
    <button class="btn" id="quiet-btn" title="움직임과 소리를 꺼요">🔇 회의 모드</button>
    <button class="btn" id="notif-btn">🔔 알림 켜기</button>
  </div>
</header>
<section class="gauges" id="gauges">
  <div class="gauge" id="g-five" data-base="#3b82f6"><span class="g-label">🍙 5시간 기력</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="gauge" id="g-week" data-base="#34c759"><span class="g-label">🥜 주간 식량</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="gauge" id="g-extra" data-base="#a98bff" hidden><span class="g-label">💳 추가 사용</span><span class="g-reset"></span><b class="g-pct">-</b>
    <div class="g-bar"><i></i><em class="pace"></em></div><div class="g-proj"></div></div>
  <div class="g-note" id="g-note"></div>
</section>
<section class="banner" id="banner" hidden>
  <div class="banner-inner">
    <div class="banner-emoji" id="banner-emoji"></div>
    <div><div class="banner-title" id="banner-title"></div><div class="banner-body" id="banner-body"></div></div>
  </div>
</section>
<main id="grid"></main>
<div class="modal" id="modal" hidden>
  <div class="daily">
    <button class="btn close" id="modal-close">✕</button>
    <div class="date" id="d-date"></div>
    <div id="d-ham" style="--fur:#f3c58e;--belly:#fff3e2" data-pose="done"></div>
    <div class="big-title" id="d-title"></div>
    <div class="sub">오늘의 햄찌 · 스크린샷 찍어서 자랑하세요 📸</div>
    <div class="stats" id="d-stats"></div>
    <div class="bars" id="d-bars"></div>
  </div>
</div>`;

const CARD = `<div class="alert-mark">❗</div>
  <div class="roof"><div class="sign"></div><span class="badge"></span></div>
  <div class="body-wrap">
    <div class="room">
      <div class="window"></div>
      <div class="chips"><span class="chip big timer"></span><span class="chip tools"></span><span class="chip tok" title="이번 의뢰에 쓴 토큰 (새 입력 + 출력)"></span><span class="chip ctx" title="컨텍스트 사용률"></span><span class="chip health" hidden></span></div>
      <div class="bubble"></div>
      <div class="stage" title="콕 찔러보기"></div>
      <div class="babies"><div class="side l"></div><div class="side r"></div></div>
      <div class="stamp"><span>QUEST CLEAR!</span></div>
      <div class="title-chip"></div>
      <button class="btn replay-btn" hidden title="방금 한 일 다시 보기">📼 리플레이</button>
    </div>
    <div class="party" hidden><div class="party-head"><span>⚔️ 파티</span><b></b></div>
      <div class="party-list"></div><div class="returned"></div></div>
    <div class="quest-req"></div>
    <div class="say-line"></div>
    <div class="memo"><textarea placeholder="🥜 볼주머니 메모 · 다음에 시킬 일"></textarea><button class="btn copy">📋 꺼내기</button></div>
    <div class="progress" hidden><div class="sec-title"><span>📜 퀘스트</span><b></b></div><div class="xp"><i></i></div><ul class="todos"></ul></div>
    <div><div class="sec-title"><span>🎮 행동 로그</span></div><ul class="log"></ul></div>
  </div>`;

C.registerMode({
  id: "hamster", label: "햄찌", icon: "🐹",
  chimeWave: "square",
  // 코어 알림·탭 제목 문구
  texts: {
    done: s => [`🐹 ${s.project} 퀘스트 클리어!`, s.prompt || ""],
    input: s => [`❗ ${s.project} 햄찌가 불러요`, s.note || ""],
    stall: x => [`⚠️ ${x.project} 멈춤 의심`, `${x.agent ? x.agent.desc || x.agent.type : "메인"}: ${healthText(x.health)}`],
    memo: (s, text) => [`🥜 ${s.project} 메모 준비됐어요`, text.slice(0, 80)],
    title: ({ calling, working }) => calling ? `❗(${calling}) 햄찌가 불러요` : working ? `🐹 ${working}마리 일하는 중` : "🐹 모찌 햄찌네",
  },

  mount(root, ctx) {
    const { doc } = ctx;
    const $ = sel => root.querySelector(sel);
    const card = sid => doc.getElementById("s-" + sid);
    const quiet = () => ctx.settings.quiet;
    let last = null, breakIdx = 0, breakShownAt = 0, dailyChecked = false;

    root.innerHTML = MARKUP;
    // 모드 전환기는 예전 '업무 모드' 버튼 자리에, 도트 버튼 모양으로
    ctx.switcher.querySelector("select").classList.add("btn");
    $(".hud").insertBefore(ctx.switcher, $("#quiet-btn"));

    /* ----- 소리: 모드 전용 버스 (unmount 때 끊어서 즉시 조용히) ----- */
    let bus = null;
    const out = () => {
      const ac = ctx.audio(); if (!ac) return null;
      if (!bus) { bus = ac.createGain(); bus.connect(ac.destination); }
      return ac;
    };
    function voice(f, when, { type = "sine", dur = .5, vol = .07, attack = .005, to = null, partial = 0 } = {}) {
      const ac = out(); if (!ac) return;
      const t = ac.currentTime + when;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur * .6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus); o.start(t); o.stop(t + dur + .05);
      if (partial) voice(f * partial, when, { type: "sine", dur: dur * .4, vol: vol * .3 });
    }

    /* ----- 🎵 연주회: 도구 호출 = 음표 ----- */
    let music = C.store.get("music") === "1";
    const prevTools = {}, walk = {};
    function nextNote(sid, octave) {
      walk[sid] = Math.max(0, Math.min(9, (walk[sid] ?? 4) + pick([-2, -1, 1, 1, 2])));
      const d = walk[sid], midi = 60 + (hash(sid) % 2) * 12 + octave * 12 + Math.floor(d / 5) * 12 + PENTA[d % 5];
      return 440 * Math.pow(2, (midi - 69) / 12);
    }
    const INSTR = {
      read:   f => w => voice(f, w, { type: "triangle", dur: .7, vol: .08 }),
      edit:   f => w => voice(f, w, { dur: .3, vol: .1, partial: 4 }),
      bash:   f => w => { voice(140, w, { dur: .25, vol: .18, to: 45 }); voice(f / 2, w + .06, { type: "triangle", dur: .2, vol: .04 }); },
      search: f => w => voice(f * 2, w, { dur: 1.4, vol: .05, partial: 2.76 }),
      web:    f => w => voice(f, w, { type: "sawtooth", dur: .18, vol: .03 }),
      agent:  f => w => voice(f, w, { dur: .25, vol: .06, to: f * 2 }),
      todo:   f => w => { voice(f, w, { type: "triangle", dur: .5, vol: .05 }); voice(f * 1.25, w + .05, { type: "triangle", dur: .5, vol: .05 }); },
    };
    function playKind(sid, kind, when = 0, octave = 0) {
      if (!music || quiet()) return;
      (INSTR[kind] || INSTR.web)(nextNote(sid, octave))(when);
    }
    function playNotes(s) {
      const m = prevTools[s.sid];
      prevTools[s.sid] = s.tools;
      if (m !== undefined && s.tools > m)
        for (let i = 0; i < Math.min(4, s.tools - m); i++) playKind(s.sid, s.kind, i * .14);
      // 아기 햄찌들은 한 옥타브 위에서 작게
      for (const a of s.agents) {
        const k = s.sid + ":" + a.aid, o = prevTools[k];
        prevTools[k] = a.tools;
        if (o !== undefined && a.tools > o && a.now) playKind(a.aid, a.now.kind, .07, 1);
      }
    }
    // 누군가 일하는 동안 4초마다 잔잔한 코드 깔기
    let padIdx = 0;
    ctx.every(4000, () => {
      if (!music || quiet() || !last || !last.sessions.some(C.isActive)) return;
      PADS[padIdx++ % PADS.length].forEach(f => voice(f / 2, 0, { dur: 3.8, vol: .018, attack: 1.2 }));
    });

    /* ----- 말풍선·콕 찌르기·축하 ----- */
    function say(el, text) {
      const b = el.querySelector(".bubble");
      if (b.textContent === text) return;
      b.textContent = text;
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      el.dataset.saidAt = Date.now();
      placeBubble(el);
    }
    // 말풍선이 오른쪽 위 타이머 칩과 겹치지 않게: 넘치면 왼쪽으로 밀고, 그래도 넘치면 폭을 줄임(말줄임)
    function placeBubble(el) {
      const room = el.querySelector(".room"), b = el.querySelector(".bubble"), t = el.querySelector(".timer");
      if (!room.clientWidth) return;
      const limit = t.parentNode.offsetLeft + t.offsetLeft - 8;  // 타이머 칩 왼쪽 - 여백 (등장 애니메이션 transform 영향 없게 offset 기준)
      b.style.marginLeft = "";
      b.style.maxWidth = `min(58%, ${Math.max(40, limit - 8)}px)`;
      const left = b.offsetLeft - b.offsetWidth * 0.62, right = left + b.offsetWidth;  // translateX(-62%) 반영
      if (right > limit) b.style.marginLeft = Math.round(limit - right) + "px";
    }
    function setTimer(el, text) {
      const t = el.querySelector(".timer");
      if (t.textContent === text) return;
      const relayout = t.textContent.length !== text.length;
      t.textContent = text;
      if (relayout) placeBubble(el);
    }
    // 방 안 타이머는 좁은 칩이라 1시간 넘으면 짧게: 3h57m
    const timerText = sec => sec >= 3600 ? `${Math.floor(sec / 3600)}h${String(Math.floor(sec % 3600 / 60)).padStart(2, "0")}m` : fmt(sec);
    function poke(el) {
      const st = el.querySelector(".stage");
      st.classList.remove("poked"); void st.offsetWidth; st.classList.add("poked");
      ctx.after(400, () => st.classList.remove("poked"));
      say(el, pick(POKE));
      el.dataset.pokedAt = Date.now();
      if (quiet()) return;
      const h = doc.createElement("span");
      h.className = "heart"; h.textContent = "💛"; h.style.setProperty("--dx", (Math.random() * 30 - 15) + "px");
      st.appendChild(h); ctx.after(1000, () => h.remove());
    }
    function celebrate(el) {
      el.classList.remove("clear"); void el.offsetWidth; el.classList.add("clear");
      ctx.after(2700, () => el.classList.remove("clear"));
      if (quiet()) return;
      const room = el.querySelector(".room");
      const colors = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#ff9ec7", "#a98bff"];
      for (let i = 0; i < 28; i++) {
        const c = doc.createElement("span");
        c.className = "confetti";
        c.style.left = Math.random() * 100 + "%";
        c.style.background = pick(colors);
        c.style.setProperty("--dx", (Math.random() * 80 - 40) + "px");
        c.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
        c.style.animationDelay = Math.random() * .3 + "s";
        room.appendChild(c); ctx.after(2000, () => c.remove());
      }
    }

    /* ----- 오늘의 햄찌 카드 ----- */
    function openDaily() {
      if (!last) return;
      const kinds = last.today_kinds || {};
      const t = titleFor(kinds, { agents: last.today_agents || 0 }) || ["🐣", "새내기 햄찌"];
      const d = new Date();
      $("#d-date").textContent = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
      $("#d-ham").innerHTML = hamster();
      $("#d-title").textContent = t.join(" ");
      $("#d-stats").innerHTML = [
        ["🌻", `클리어 ${last.done_today || 0}`], ["⏱", `기다림 ${Math.round(last.waited_today / 60)}분`], ["🐹", `아기 ${last.today_agents || 0}마리`],
        ["🪙", `토큰 ${fmtTok((last.today_tokens || {}).total)}`], ["♻️", `캐시 ${fmtTok((last.today_tokens || {}).cached)}`],
      ].map(([i, v]) => `<div class="res"><span class="ic">${i}</span><b>${v}</b></div>`).join("");
      const top = Object.entries(kinds).filter(([k]) => KIND_LABEL[k]).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const max = Math.max(1, ...top.map(([, n]) => n));
      $("#d-bars").innerHTML = top.map(([k, n]) =>
        `<div><span>${KIND_LABEL[k]}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></div>`).join("");
      $("#modal").hidden = false;
    }

    /* ----- 📼 리플레이: 방금 한 일을 빨리감기 ----- */
    function replay(el, sid) {
      const s = last && last.sessions.find(x => x.sid === sid);
      if (!s || !s.trail.length || el._replay) return;
      const n = Math.min(28, s.trail.length);
      const steps = Array.from({ length: n }, (_, i) => s.trail[Math.floor(i * s.trail.length / n)]);
      el._replay = true;
      el.dataset.age = "0";
      let i = 0;
      const tick = () => {
        if (i >= steps.length) {
          el._replay = false; el.dataset.pose = "done"; say(el, "다 했어요!"); celebrate(el);
          return;
        }
        const [kind, icon, text] = steps[i];
        el.dataset.pose = kind;
        say(el, `${icon} ${text}`);
        setTimer(el, `📼 ${i + 1}/${steps.length}`);
        playKind(sid, kind);
        i++;
        ctx.after(quiet() ? 250 : 420, tick);
      };
      tick();
    }

    /* ----- 🥜 볼주머니 메모 (코어 memo와 공유) ----- */
    function setupMemo(el, sid) {
      const ta = el.querySelector(".memo textarea"), btn = el.querySelector(".memo .copy");
      ta.value = ctx.memo.get(sid);
      ta.oninput = () => { ctx.memo.set(sid, ta.value); el.querySelector(".memo").classList.remove("ready"); };
      btn.onclick = async () => {
        if (!ta.value.trim()) { ta.focus(); return; }
        await ctx.memo.copy(sid, ta);
        el.querySelector(".memo").classList.remove("ready");
        btn.textContent = "✓ 복사됨"; ctx.after(1800, () => btn.textContent = "📋 꺼내기");
        say(el, "터미널에 ⌘V 하세요!");
      };
    }

    function renderTodos(el, todos) {
      const box = el.querySelector(".progress");
      box.hidden = !todos.length;
      if (!todos.length) return;
      const done = todos.filter(t => t.status === "completed").length;
      box.querySelector(".sec-title b").textContent = `${done} / ${todos.length}`;
      box.querySelector(".xp i").style.width = (done / todos.length * 100) + "%";
      const cur = Math.max(0, todos.findIndex(t => t.status !== "completed"));
      const start = Math.max(0, Math.min(cur - 1, todos.length - 4));
      const mark = { completed: "⭐", in_progress: "▶", pending: "☆" };
      box.querySelector(".todos").innerHTML = todos.slice(start, start + 4)
        .map(t => `<li class="${t.status}">${mark[t.status] || "☆"} ${esc(t.text)}</li>`).join("");
    }

    function renderAgents(el, s, now) {
      // 도구도 안 쓰고 이름도 없는 내부 에이전트는 숨김
      const agents = s.agents.filter(a => a.desc || a.tools || a.status === "running");
      const box = el.querySelector(".party");
      const running = agents.filter(a => a.status === "running"), back = agents.filter(a => a.status === "done");
      // 방 바닥: 엄마 양옆으로 아기들 (최대 6마리)
      const bkey = running.map(a => a.aid).join();
      const babies = el.querySelector(".babies");
      if (babies.dataset.key !== bkey) {
        const shown = running.slice(0, 6), half = Math.ceil(shown.length / 2);
        babies.querySelector(".l").innerHTML = shown.slice(0, half).map(() => hamster(false)).join("");
        babies.querySelector(".r").innerHTML = shown.slice(half).map(() => hamster(false)).join("")
          + (running.length > 6 ? `<span class="more">+${running.length - 6}</span>` : "");
        babies.dataset.key = bkey;
      }
      box.hidden = !agents.length;
      if (!agents.length) return;
      const stuck = running.filter(a => a.health && a.health.level === "stall").length;
      box.querySelector(".party-head b").textContent = (stuck ? `⚠️ ${stuck}개 멈춤 의심 · ` : "") + (running.length ? `${running.length}마리 출동 중` : `${back.length}마리 귀환`);
      const list = box.querySelector(".party-list");
      list.hidden = !running.length;
      list.innerHTML = running.map(a => `
        <div class="member running ${a.health ? a.health.level : ""}" style="${furStyle(s.sid)}">
          ${hamster(false)}
          <div class="member-body">
            <div class="member-name">${esc(a.desc || a.type)}</div>
            <div class="member-type">${esc(a.type)}${a.bg ? " · 백그라운드" : ""}</div>
            ${a.say ? `<div class="member-say" title="${esc(a.say)}">💬 “${esc(a.say)}”</div>` : ""}
            <ul class="member-recent">${(a.recent || []).map(r => `<li>${r.icon} ${esc(r.text)}</li>`).join("") || `<li>🐾 출발!</li>`}</ul>
            ${a.health ? `<span class="health-tag ${a.health.level}">${healthText(a.health)}</span>` : ""}
          </div>
          <div class="member-meta"><b>${fmt(now - a.since)}</b>🔧${a.tools}${a.tokens ? ` · 🪙${fmtTok(a.tokens)}` : ""}</div>
        </div>`).join("");
      box.querySelector(".returned").innerHTML = back.length
        ? "🌻 귀환 " + back.map(a => `<span title="${esc(a.desc)}">${esc(a.desc || a.type)} · ${fmt(a.ended - a.since)}${a.tokens ? " · 🪙" + fmtTok(a.tokens) : ""}</span>`).join("")
        : "";
    }

    /* ----- 🍙 사용 한도: 남은 양으로 보여주기 ----- */
    function renderLimits(now) {
      const L = C.limits(last, now);
      for (const [key, id] of [["five", "g-five"], ["week", "g-week"], ["extra", "g-extra"]]) {
        const g = $("#" + id), c = L[key], { used, pace, wasReset, reset } = c;
        if (key === "extra") g.hidden = !c.shown;
        g.querySelector(".g-pct").textContent = wasReset ? "가득!" : used == null ? "-" : `${Math.round(used)}%`;
        g.querySelector(".g-bar i").style.width = (used ?? 0) + "%";
        const pm = g.querySelector(".pace");
        pm.hidden = pace == null || wasReset;
        if (pace != null) { pm.style.left = pace + "%"; pm.title = `시간 기준 적정 사용량 ${Math.round(pace)}%`; }
        g.style.setProperty("--g", used == null ? "#b5a89b" : used >= 90 ? "#ff5a5a" : c.over ? "#ff9f40" : g.dataset.base);
        g.classList.toggle("over", c.over);
        g.classList.toggle("low", c.low);
        g.querySelector(".g-reset").textContent = wasReset ? `${clockText(reset, now)}에 리셋됨`
          : reset ? `${spanText(reset - now)} (${clockText(reset, now)})` : "";
        g.querySelector(".g-proj").textContent = {
          full: "😵 다 썼어요 · 리셋까지 쉬어요",
          unused: "✓ 현재 속도로는 리셋 전 한도 도달 없음",
          safe: "✓ 현재 속도로는 리셋 전 한도 도달 없음",
          eta: c.eta && `⚠ 현재 속도면 ${clockText(c.eta, now)}쯤 한도 도달 (리셋 ${spanText(reset - c.eta)} 전)`,
          reset: "다음 Claude 요청 때 새 값으로 갱신돼요",
        }[c.proj] || "";
      }
      $("#g-note").textContent = C.limitNote(last, now, { poll: "🔄 ", stale: "⏱ " });
      return L.low && [{ five: "🍙 5시간 기력", week: "🥜 주간 식량" }[L.low.key], L.low.left, L.low.reset];
    }
    function setBanner(e, t, b) {
      $("#banner-emoji").textContent = e;
      $("#banner-title").textContent = t;
      $("#banner-body").textContent = b;
    }

    function render() {
      if (!last) return;
      const now = ctx.now();
      const grid = $("#grid");
      const ss = last.sessions;
      if (!ss.length) grid.innerHTML = `<div class="empty">🐹 아직 햄찌가 없어요<br><small>Claude Code에서 프롬프트를 보내면 햄찌가 출근해요</small></div>`;
      const seen = new Set();
      for (const s of ss) {
        seen.add(s.sid);
        let el = card(s.sid);
        if (!el) {
          if (grid.querySelector(".empty")) grid.innerHTML = "";
          el = doc.createElement("article");
          el.id = "s-" + s.sid;
          el.style.setProperty("--roof", ROOFS[hash(s.sid) % ROOFS.length]);
          el.innerHTML = CARD;
          el.querySelector(".stage").setAttribute("style", furStyle(s.sid));
          el.querySelector(".stage").innerHTML = hamster();
          el.querySelector(".babies").setAttribute("style", furStyle(s.sid));
          el.querySelector(".stage").onclick = () => poke(el);
          el.querySelector(".replay-btn").onclick = () => replay(el, s.sid);
          setupMemo(el, s.sid);
          grid.appendChild(el);
        }
        const status = C.sessionStatus(s, now);
        const elapsed = now - s.since;
        const pose = status === "working" ? (s.kind || "think") : status === "agents" ? "wait" : status;
        const age = status === "working" || status === "agents" ? (elapsed >= 900 ? "15" : elapsed >= 300 ? "5" : elapsed >= 60 ? "1" : "0") : "0";
        el.className = "house " + status + (el.classList.contains("clear") ? " clear" : "") + (el._replay ? " replaying" : "");
        const t = titleFor(s.kinds, { agents: s.agents.length, run: s.run, done: status === "done" || status === "idle" });
        el.querySelector(".title-chip").textContent = t ? t.join(" ") : "";
        el.querySelector(".replay-btn").hidden = !(s.trail.length && (status === "done" || status === "idle")) || el._replay;
        if (!el._replay) {
          el.dataset.age = age;
          const recentlyPoked = Date.now() - (+el.dataset.pokedAt || 0) < 2000;
          if (!recentlyPoked && (el.dataset.pose !== pose || Date.now() - (+el.dataset.saidAt || 0) > 7000)) {
            const stuckNow = status === "working" && s.health && s.health.level === "stall";
            say(el, stuckNow ? pick(LINES.stuck) : age !== "0" && Math.random() < 0.3 ? AGE_LINES[age] : pick(LINES[pose] || LINES.other));
          }
          el.dataset.pose = pose;
          setTimer(el, "⏱ " + timerText(elapsed));
        }

        renderTodos(el, s.todos);
        renderAgents(el, s, now);
        el.querySelector(".sign").textContent = "🏠 " + s.project;
        el.querySelector(".sign").title = s.sid;
        const [label, color] = STATUS[status];
        const badge = el.querySelector(".badge");
        badge.textContent = label; badge.style.background = color;
        el.querySelector(".tools").textContent =
          status === "agents" ? "🐹 ×" + s.agents.filter(a => a.status === "running").length : "🔧 ×" + s.tools;
        const cx = el.querySelector(".ctx");
        cx.hidden = s.ctx == null;
        if (s.ctx != null) cx.textContent = "🧠 " + Math.round(s.ctx) + "%";
        const tk = el.querySelector(".tok");
        tk.hidden = !(s.tokens && s.tokens.total);
        if (s.tokens) { tk.textContent = "🪙 " + fmtTok(s.tokens.total); tk.title = `이번 의뢰 · 새 입력 ${fmtTok(s.tokens.new)} · 출력 ${fmtTok(s.tokens.out)} · 캐시 읽기 ${fmtTok(s.tokens.cached)}`; }
        const hc = el.querySelector(".chip.health"), h = status === "working" ? s.health : null;
        hc.hidden = !h;
        hc.className = "chip health " + (h ? h.level : "");
        if (h) { hc.textContent = h.level === "stall" ? "⚠️ 멈춤 의심" : "⏳ 느림"; hc.title = healthText(h); }
        el.querySelector(".say-line").textContent = status === "working" && s.say ? `💬 “${s.say}”` : "";
        el.querySelector(".quest-req").textContent = s.prompt ? "📮 의뢰: " + s.prompt : "";
        el.querySelector(".memo").classList.toggle("ready", ctx.memo.ready(s.sid));
        const log = el.querySelector(".log");
        const items = status === "needs_input" ? [{ icon: "❗", text: s.note || "확인이 필요해요" }]
          : status === "working" ? s.activity
          : status === "agents" ? [{ icon: "⏳", text: "파티원 귀환 대기 중" }]
          : [{ icon: "🏁", text: s.prompt ? "퀘스트 완료" : "새 의뢰 기다리는 중" }];
        const key = JSON.stringify(items);
        if (log.dataset.key !== key) {
          const wasLen = log.children.length;
          log.innerHTML = items.slice(-4).map((a, i, arr) => `<li class="${i === arr.length - 1 && wasLen ? "new" : ""}"><span>${a.icon}</span><span>${esc(a.text)}</span></li>`).join("")
            || `<li><span>💭</span><span>생각하는 중</span></li>`;
          log.dataset.key = key;
        }
      }
      for (const el of [...grid.querySelectorAll("article")]) if (!seen.has(el.id.slice(2))) el.remove();

      const { working, calling, waited } = C.summary(last, now);
      $("#n-working").textContent = working.length;
      $("#n-input").textContent = calling.length;
      $("#seeds").textContent = last.done_today || 0;
      const tt0 = last.today_tokens || {};
      $("#today-tok").textContent = fmtTok(tt0.total);
      $("#tok-pill").title = `오늘 쓴 토큰 · 새 입력 ${fmtTok(tt0.new)} · 출력 ${fmtTok(tt0.out)} · 캐시 읽기 ${fmtTok(tt0.cached)}`;
      const tt = titleFor(last.today_kinds || {}, { agents: last.today_agents || 0 });
      $("#today-title").textContent = tt ? tt[1] : "새내기 햄찌";
      $("#waited").textContent = Math.round(waited / 60) + "분";

      const low = renderLimits(now);
      const stalls = C.stalls(last);
      const br = $("#banner");
      const longest = Math.max(0, ...working.map(s => now - s.since));
      if (calling.length) {
        br.hidden = false; br.className = "banner call";
        setBanner("🙋", calling.map(s => s.project).join(", ") + " 햄찌가 불러요!", "터미널로 돌아가서 확인해 주세요.");
      } else if (stalls.length) {
        const x = stalls[0];
        br.hidden = false; br.className = "banner call stall";
        setBanner("⚠️", `${x.project} · ${x.agent ? x.agent.desc || x.agent.type : "메인"}: ${healthText(x.health).replace("⚠️ ", "")}`,
          (stalls.length > 1 ? `외 ${stalls.length - 1}건 · ` : "") + "터미널에서 상태를 확인해 보세요 (권한 요청, 네트워크, 무한 대기 등).");
      } else if (low) {
        br.hidden = false; br.className = "banner call";
        setBanner("😵", `${low[0]}이 ${low[1]}% 남았어요`, low[2] ? `${untilText(low[2], now)} 다시 가득 차요. 큰 작업은 그 뒤에!` : "아껴 써요!");
      } else if (longest >= 60) {
        br.hidden = false; br.className = "banner";
        if (Date.now() - breakShownAt > 40000) {
          breakIdx = (breakIdx + 1) % BREAKS.length; breakShownAt = Date.now();
          setBanner(...BREAKS[breakIdx]);
        }
      } else {
        br.hidden = true; breakShownAt = 0;
      }
    }

    /* ----- 버튼 ----- */
    const qb = $("#quiet-btn"), nb = $("#notif-btn"), mb = $("#music-btn");
    const applySettings = () => { qb.classList.toggle("on", quiet()); nb.hidden = !ctx.notif.canAsk; };
    qb.onclick = () => ctx.settings.setQuiet(!quiet());
    nb.onclick = () => ctx.notif.request();
    const applyMusic = () => mb.classList.toggle("on", music);
    mb.onclick = () => {
      music = !music; ctx.audio(); C.store.set("music", music ? "1" : "0"); applyMusic();
      if (music) [523, 659, 784].forEach((f, i) => voice(f, i * .12, { type: "triangle", dur: .5, vol: .06 }));
    };
    $("#title-pill").onclick = openDaily;
    $("#modal-close").onclick = () => $("#modal").hidden = true;
    $("#modal").onclick = e => { if (e.target.id === "modal") e.currentTarget.hidden = true; };
    applySettings(); applyMusic();

    /* ----- 코어 이벤트 ----- */
    ctx.on("settings", applySettings);
    ctx.on("done", s => { const el = card(s.sid); if (el) celebrate(el); });
    ctx.on("memo-ready", s => {
      const el = card(s.sid); if (!el) return;
      el.querySelector(".memo").classList.add("ready");
      el.dataset.pokedAt = Date.now() + 3000;  // 말풍선 잠시 고정
      say(el, "🥜 메모 꺼내줄게! 📋 눌러요");
    });
    ctx.on("memo", ({ sid, value }) => {  // 다른 창/모드에서 고친 메모 반영
      const ta = card(sid) && card(sid).querySelector(".memo textarea");
      if (ta && doc.activeElement !== ta && ta.value !== value) ta.value = value;
    });

    const placeAll = () => root.querySelectorAll(".house").forEach(placeBubble);
    ctx.listen(ctx.win, "resize", placeAll);
    if (doc.fonts) doc.fonts.ready.then(() => ctx.after(0, placeAll));  // 도트 폰트가 늦게 오면 폭이 바뀜
    ctx.every(250, render);  // 타이머·말풍선 갱신 (이 모드가 켜져 있을 때만)

    return {
      update(state) {
        last = state;
        for (const s of state.sessions) playNotes(s);
        render();
        if (!dailyChecked) { dailyChecked = true; if (ctx.win.location.hash === "#daily") openDaily(); }
      },
      unmount() {
        if (bus) { try { bus.disconnect(); } catch {} bus = null; }  // 예약된 음까지 즉시 끊기
      },
    };
  },
});
})();

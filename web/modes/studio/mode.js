/* 🏢 스튜디오 모드: 세션 하나 = 도트 동물 직원 한 마리. 층 = 세션, 1층 = 사장실(입력 필요 → 엘리베이터로 질문하러 옴).
   자금은 "잘 쓰기" 재화(완료·페이스 준수·적은 토큰), 도감·상점은 ctx.store에만 저장. 외부 에셋 0 — 스프라이트는 문자 도트 → canvas data URL.
   코어가 처음 선택될 때만 불러오고, 다른 모드로 바꾸면 DOM·타이머·rAF·리스너를 모두 걷어낸다. */
(() => {
"use strict";
const C = window.Core;
const { esc } = C;

/* ================= 도트 캐릭터 7종 (16열 문자 그림 → 스프라이트) ================= */
const P0 = { O: "#3a2430", P: "#2c2030", Q: "#2c2030", W: "#ffffff", Z: "#8a2d3c", C: "#ff9aa6", N: "#d9667a", M: "#b5504a", I: "#f7a9a0" };
const CH = [
{ id: "ham", rows: ["..FF........FF..", ".FIFF......FFIF.", ".FFFFFFFFFFFFFF.", "FFFFFFFFFFFFFFFF", "FFFFFLLLLLLFFFFF", "FFFLLLLLLLLLLFFF", "FFLPWLLLLLLPWLFF", "FFLQQLLLLLLQQLFF", "FFCCLLLNNLLLCCFF", "FFLCLLLMMLLLCLFF", ".FFLLLLLLLLLLFF.", ".FFFBBBBBBBBFFF.", "..FFBBBBBBBBFF..", "..FFBBBBBBBBFF.."],
  legs: { s: ["...FF......FF..."], a: ["..FF........FF.."], b: ["....FF....FF...."] },
  pal: { F: "#e9a352", L: "#fff1d6", B: "#f28a3d" }, arm: { y: 11, x: 1, s: "F", h: "L" },
  meta: { er: 6, xl: 3, xr: 11, neck: 10, n0: 2, n1: 13, hat: 2, h0: 1, h1: 14 }, hands: { w: 16, c: "#e9a352" } },
{ id: "peng", rows: ["......KKKK......", "....KKKKKKKK....", "...KKKKKKKKKK...", "..KKKKKKKKKKKK..", "..KKLLKKKKLLKK..", "..KLLLLKKLLLLK..", "..KLPWLKKLPWLK..", "..KLQQLYYLQQLK..", "..KKLLLYYLLLKK..", "..KKKLLLLLLKKK..", ".KKKKLLLLLLKKKK.", ".KKKKLLLLLLKKKK.", ".KKKKLLLLLLKKKK.", ".KKKKLLLLLLKKKK.", "..KKKLLLLLLKKK..", "...KKKLLLLKKK...", "....KKKKKKKK...."],
  legs: { s: ["....YYY..YYY....", "...YYYY..YYYY..."], a: ["...YYY....YYY...", "..YYY......YYY.."], b: ["....YYYYYYYY....", "....YYY....YYY.."] },
  pal: { K: "#3b4466", L: "#fffaf0", Y: "#ffa83a" }, arm: { y: 11, x: 1, s: "K", h: "K" },
  meta: { er: 6, xl: 4, xr: 10, neck: 9, n0: 2, n1: 13, hat: 1, h0: 3, h1: 12 }, hands: { w: 14, c: "#3b4466" } },
{ id: "bvr", rows: ["....FF....FF....", "...FFFFFFFFFF...", "..FFFFFFFFFFFF..", "..FFFFFFFFFFFF..", ".FFFLLLLLLLLFFF.", ".FFLPWLLLLPWLFF.", ".FFLQQLLLLQQLFF.", ".FFLLLLNNLLLLFF.", "..FFLLLTTLLLFF..", "..FFLLLTTLLLFF..", "...FFFFFFFFFF...", "..FFBBBBBBBBFF..", "..FFBBBBBBBBFF..", "..FFBAAAAAABFFR.", "...FBBBBBBBBFRR."],
  legs: { s: ["..FFF......FFFRR", "..FFF......FFF.."], a: ["..FFF.....FFF.RR", "..FF.......FFF.."], b: ["...FFF....FFF.RR", "...FFF....FFF..."] },
  pal: { F: "#a8693a", L: "#f1cf9d", B: "#4f7fb8", A: "#ffcf3f", T: "#fffdf5", N: "#4a2e2a", R: "#6b4228" }, arm: { y: 12, x: 2, s: "F", h: "L" },
  meta: { er: 5, xl: 3, xr: 10, neck: 10, n0: 3, n1: 12, hat: 1, h0: 2, h1: 13 }, hands: { w: 16, c: "#a8693a" } },
{ id: "otr", rows: ["...FF......FF...", "..FFFFFFFFFFFF..", ".FFFFFFFFFFFFFF.", ".FFFLLLLLLLLFFF.", ".FFLLLLLLLLLLFF.", ".FLLPWLLLLPWLLF.", ".FLLQQLLLLQQLLF.", ".FLLLLLNNLLLLLF.", "..FLLLWMMWLLLF..", "..FFLLLLLLLLFF..", "...FFFFFFFFFF...", "...FFBBBBBBFF...", "...FFBBBBBBFF...", "...FFBBBBBBFFRR.", "....FBBBBBBF.RRR"],
  legs: { s: ["....FF....FF....", "....FF....FF...."], a: ["...FF......FF...", "..FF........FF.."], b: ["....FFF..FFF....", "....FFF..FFF...."] },
  pal: { F: "#9a6b4b", L: "#ecd3b4", B: "#4aa9a5", N: "#3a2a30", R: "#6f4a35" }, arm: { y: 12, x: 3, s: "F", h: "L" },
  meta: { er: 5, xl: 4, xr: 10, neck: 10, n0: 3, n1: 12, hat: 1, h0: 2, h1: 13 }, hands: { w: 22, c: "#ecd3b4" } },
{ id: "oct", rows: [".....FFFFFF.....", "...FFFFFFFFFF...", "..FFFFFFFFFFFF..", ".FFFLLFFFFFFFFF.", ".FFFFFFFFFFFFFF.", ".FFLLLLFFLLLLFF.", ".FFLPWLFFLPWLFF.", ".FFLQQLFFLQQLFF.", ".FFFLLFFFFLLFFF.", ".FFFFFFMMFFFFFF.", "..FFFFFFFFFFFF..", "...FFFFFFFFFF...", "..FFFFFFFFFFFF.."],
  legs: { s: ["..FF.FF..FF.FF..", "..FF.FF..FF.FF.."], a: [".FF.FF....FF.FF.", "FF.FF......FF.FF"], b: ["...FF.FF.FF.FF..", "..FF.FF.FF.FF..."] },
  pal: { F: "#b57be0", L: "#e6c9fb", M: "#7a3a8c" }, closed: "F", arm: { y: 12, x: 2, s: "F", h: "L" },
  meta: { er: 6, xl: 4, xr: 10, neck: 10, n0: 2, n1: 13, hat: 1, h0: 2, h1: 13 }, hands: { w: 12, c: "#b57be0" } },
{ id: "bot", rows: [".......AA.......", ".......KK.......", "..FFFFFFFFFFFF..", ".FFFFFFFFFFFFFF.", ".FFLLLLLLLLLLFF.", ".FFLPWLLLLPWLFF.", ".FFLQQLLLLQQLFF.", ".FFLLLLLLLLLLFF.", ".FFLLLMMMMLLLFF.", ".FFFFFFFFFFFFFF.", "..FFFFFFFFFFFF..", ".....KKKKKK.....", "..FFFFFFFFFFFF..", ".FFBBBBBBBBBBFF.", ".FFBDDBBBBEEBFF.", ".FFBBBBBBBBBBFF.", "..FFFFFFFFFFFF.."],
  legs: { s: ["...FFF....FFF...", "..FFFF....FFFF.."], a: ["..FFF......FFF..", "..FFFF....FFFF.."], b: ["....FFF..FFF....", "...FFFF..FFFF..."] },
  pal: { F: "#bcc6d6", K: "#6b7690", L: "#1f2c4a", P: "#6af0ff", Q: "#2ec9e0", M: "#6af0ff", B: "#8b97ad", A: "#ff5a5a", D: "#7dff9c", E: "#ffd23f", Y: "#ffd23f", O: "#2e3650" },
  arm: { y: 13, x: 1, s: "F", h: "Y" }, tint: "A",
  meta: { er: 5, xl: 3, xr: 10, neck: 11, n0: 3, n1: 12, hat: 2, h0: 1, h1: 14 }, hands: { w: 16, c: "#8b97ad" } },
{ id: "cat", rows: ["..FF........FF..", "..FIF......FIF..", "..FFFFFSSFFFFF..", ".FFFFFSFFSFFFFF.", ".FFFLLLLLLLLFFF.", ".FFLPWLLLLPWLFF.", ".FFLQQLLLLQQLFF.", "WFFLLLLNNLLLLFFW", ".FFFLLLMMLLLFFF.", "..FFFLLLLLLFFF..", "...FFFFFFFFFF...", "..FFBBBBBBBBFF..", "..FFBBBBBBBBFF..", "..FFBBBBBBBBFF..", "...FFBBBBBBFF..."],
  legs: { s: ["...FF......FF...", "...FF......FF..."], a: ["..FF........FF..", "..FF........FF.."], b: ["....FF....FF....", "....FF....FF...."] },
  tail: [[13, 14, "F"], [13, 15, "F"], [12, 15, "F"], [11, 15, "F"], [10, 15, "S"], [9, 15, "S"]],
  pal: { F: "#e8944a", S: "#c46f2a", L: "#fff1dc", I: "#f7a9a0", N: "#d9667a", M: "#8a4a40", B: "#6c7aa0" }, arm: { y: 13, x: 2, s: "F", h: "L" },
  meta: { er: 5, xl: 3, xr: 10, neck: 10, n0: 3, n1: 12, hat: 2, h0: 1, h1: 14 }, hands: { w: 16, c: "#fff1dc" } },
];
const BYID = {}; CH.forEach(c => (BYID[c.id] = c));
const SP = CH.map(c => c.id);
const BOSS = Object.assign({}, CH[0], { id: "boss", pal: { F: "#b87a4a", L: "#ffe7c4", B: "#34457f", A: "#ffd23f", T: "#e85050" } });
BYID.boss = BOSS;
/* ✨ 반짝이(희귀 색) 팔레트 */
const SH = { ham: { F: "#f7b6cf", L: "#fff6fb", B: "#b86ad8" }, peng: { K: "#6a4ab8", L: "#fffaf0", Y: "#ffd23f" }, bvr: { F: "#6fb6a0", L: "#e6f5dc", B: "#c8508a", R: "#4a7a6a" },
  otr: { F: "#5fb2d8", L: "#e2f6ff", B: "#e8a23c", R: "#3f86a8" }, oct: { F: "#ff8fb3", L: "#ffe0ea", M: "#a83a5c" }, bot: { F: "#f3d36b", K: "#a8863a", B: "#d9b24f" },
  cat: { F: "#cdd6ff", S: "#8f9be8", L: "#ffffff", B: "#8d7ae0" } };
/* 🌺 금요일 오후 하와이안 셔츠(TINY, 큰 화면만): 몸통(B) 색 — 동물 기본 몸통 색과 다른 계열 · 몸통이 없는 펭귄·문어는 꽃 목걸이 */
const ALOHA = { ham: "#2bb5a8", bvr: "#ff7a6b", otr: "#ff7a9a", cat: "#ff9a3c", bot: "#2bb5a8" };
const NAME = { ham: ["햄찌", "Hamster"], peng: ["펭귄", "Penguin"], bvr: ["비버", "Beaver"], otr: ["수달", "Otter"], oct: ["문어", "Octopus"], bot: ["로봇", "Robot"], cat: ["고양이", "Cat"] };
const EMO = { ham: "🐹", peng: "🐧", bvr: "🦫", otr: "🦦", oct: "🐙", bot: "🤖", cat: "🐱" };
/* 프로바이더 소품: Claude 주황 목도리 · Codex 초록 비니 · Gemini 파란 안경 · 그 외 회색 모자 */
const PROV = {
  claude: { c: "#ff7a3c", tag: "#f28a3d", acc: "scarf" }, codex: { c: "#2fbf71", tag: "#2fa862", acc: "hat" },
  gemini: { c: "#4a63e0", tag: "#4a63e0", acc: "glass" }, other: { c: "#8a8f9c", tag: "#7a7f8c", acc: "hat" },
};
const provKey = id => (PROV[id] ? id : "other");
const ACC_NAME = { claude: ["🧣 목도리", "🧣 scarf"], codex: ["🧢 비니", "🧢 beanie"], gemini: ["👓 안경", "👓 glasses"], other: ["🎩 회색 모자", "🎩 gray hat"] };

const PAD = 6, PL = 6, S = 4, SB = 3;
function lighten(h, k) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255, f = v => Math.round(v + (255 - v) * k); return "#" + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, "0")).join(""); }
function palOf(ch, o) {
  const p = Object.assign({}, P0, ch.pal);
  if (o.shiny && SH[ch.id]) Object.assign(p, SH[ch.id]);
  if (ch.id === "peng") p.J = lighten(p.K, .3);
  if (o.prov) { p.V = PROV[o.prov].c; if (ch.tint) p[ch.tint] = PROV[o.prov].c; }
  if (o.specs) p.V = "#2e2040";   // 📋 퇴근 일보: 사장님 발표용 안경(프로바이더 소품 아님)
  if (o.aloha) { if (ALOHA[ch.id]) p.B = ALOHA[ch.id]; p.H = "#fff3a0"; p.h = "#ff5a8a"; }   // 🌺 꽃 H(노랑) · h(분홍)
  if (o.baby) { for (const k in p) if (!"OPQWZ".includes(k) && !(ch.tint === k)) p[k] = lighten(p[k], .3); p.G = "#5fcf6a"; }
  if (o.sil) { for (const k in p) p[k] = "#3d3358"; p.O = "#241c3a"; }
  return p;
}
/* 문자 그리드: 앉기/다리/표정(eyes c = 감음, mouth o = 벌림)/팔(l r u) */
function mkGrid(ch, o) {
  let rows = ch.rows.slice();
  if (!o.seated) rows = rows.concat(ch.legs[o.legs || "s"]);
  const g = rows.map(r => ("." .repeat(PAD) + r + ".".repeat(PAD)).split(""));
  const set = (y, x, c) => { const X = x + PAD; if (g[y] && X >= 0 && X < g[y].length) g[y][X] = c; };
  if (ch.tail) ch.tail.forEach(([y, x, c]) => set(y, x, c));
  if (o.eyes === "c") {
    const cl = ch.closed || "L";
    g.forEach(r => r.forEach((c, i) => { if (c === "P") r[i] = cl; }));
    const er = ch.meta.er; [ch.meta.xl, ch.meta.xr].forEach(x => { set(er, x, cl); set(er, x + 1, cl); });
  }
  if (o.mouth === "o") g.forEach(r => r.forEach((c, i) => { if (c === "M") r[i] = "Z"; }));
  const a = ch.arm, arm = side => { for (let k = 1; k <= 5; k++) { const t = k >= 4 ? a.h : a.s;
    for (let d = 0; d < (k >= 4 ? 3 : 2); d++) { const x = a.x - k + d - (k >= 4 ? 1 : 0); set(a.y - k, side ? 15 - x : x, t); } } };
  if (o.arms === "l" || o.arms === "u") arm(0);
  if (o.arms === "r" || o.arms === "u") arm(1);
  return g;
}
function acc(g, ch, prov) {
  if (!prov) return;
  const m = ch.meta, V = "V", a = PROV[prov].acc, er = m.er;
  const set = (y, x, c) => { const X = x + PL; if (g[y] && X >= 0 && X < g[y].length) g[y][X] = c; }, get = (y, x) => g[y] && g[y][x + PL] || ".";
  if (a === "scarf") { for (let x = m.n0; x <= m.n1; x++) set(m.neck, x, V); set(m.neck + 1, m.n1 - 3, V); set(m.neck + 1, m.n1 - 2, V); set(m.neck + 2, m.n1 - 3, V); }
  if (a === "hat") { for (let y = m.hat; y <= m.hat + 1; y++) for (let x = m.h0; x <= m.h1; x++) if (get(y, x) !== ".") set(y, x, V);
    for (let x = m.h0 + 1; x <= m.h1 - 1; x++) if (get(m.hat - 1, x) !== ".") set(m.hat - 1, x, V); }
  if (a === "glass") { [m.xl, m.xr].forEach(x => { for (let i = -1; i <= 2; i++) { set(er - 1, x + i, V); set(er + 2, x + i, V); } for (let j = 0; j <= 1; j++) { set(er + j, x - 1, V); set(er + j, x + 2, V); } });
    for (let x = m.xl + 3; x < m.xr - 1; x++) set(er, x, V); }
}
function mkG(ch, o) {
  const R = ch.rows.length, g = mkGrid(ch, o);
  const set = (y, x, c) => { const X = x + PL; if (g[y] && X >= 0 && X < g[y].length) g[y][X] = c; };
  if (o.boss) { [6, 8, 10].forEach(x => set(1, x, "A")); for (let x = 5; x <= 11; x++) set(2, x, "A"); set(R - 3, 7, "T"); set(R - 3, 8, "T"); set(R - 2, 7, "T"); set(R - 2, 8, "T"); }
  acc(g, ch, o.prov);
  if (o.specs) acc(g, ch, "gemini");   // 안경 모양만 빌려 씀(색은 palOf의 V)
  if (o.aloha) {   // 🌺 몸통 칸에 띄엄띄엄 꽃 · 몸통(B)이 없으면 목에 꽃 목걸이
    let hit = false; g.forEach((r, y) => r.forEach((c, x) => { if (c !== "B") return; hit = true; const q = (x * 2 + y * 3) % 7; if (q === 0) r[x] = "H"; else if (q === 3) r[x] = "h"; }));
    if (!hit) for (let x = ch.meta.n0; x <= ch.meta.n1; x++) set(ch.meta.neck, x, x % 2 ? "H" : "h");
    const fy = ch.meta.hat, fx = ch.meta.h1 - 1; [[0, 0, "H"], [-1, 0, "h"], [1, 0, "h"], [0, -1, "h"], [0, 1, "h"]].forEach(([dy, dx, c]) => set(fy + dy, fx + dx, c));   // 귀 옆 히비스커스(앉아 있으면 몸통이 책상에 가려서)
  }
  if (o.baby && ch.id !== "bot") {   // 아기: 정수리 새싹
    let y = 0; while (y < g.length && g[y][PL + 7] === "." && g[y][PL + 8] === ".") y++;
    const need = Math.max(0, 2 - y); for (let i = 0; i < need; i++) g.unshift(Array(g[0].length).fill(".")); y += need; g.pre = need;
    g[y - 1][PL + 7] = "G"; g[y - 1][PL + 8] = "G"; g[y - 2][PL + 6] = "G"; g[y - 2][PL + 9] = "G";
  }
  return g;
}
function trim(g) {
  let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
  g.forEach((r, y) => r.forEach((c, x) => { if (c !== ".") { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }));
  return g.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1));
}
const spriteCache = new Map();
function sprite(doc, ch, o, scale) {
  const k = ch.id + JSON.stringify(o) + scale, hit = spriteCache.get(k);
  if (hit) return hit;
  const raw = mkG(ch, o), g = o.trim ? trim(raw) : raw;
  const h = g.length, w = g[0].length, pal = palOf(ch, o), cv = doc.createElement("canvas");
  cv.width = w + 2; cv.height = h + 2;
  const c = cv.getContext("2d");
  const f = (x, y) => g[y] && g[y][x] && g[y][x] !== "." ? pal[g[y][x]] || "#f0f" : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const col = f(x, y); if (col) { c.fillStyle = col; c.fillRect(x + 1, y + 1, 1, 1); } }
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) { if (f(x, y)) continue; if (f(x - 1, y) || f(x + 1, y) || f(x, y - 1) || f(x, y + 1)) { c.fillStyle = pal.O; c.fillRect(x + 1, y + 1, 1, 1); } }
  const res = { url: cv.toDataURL(), cv, w: (w + 2) * scale, h: (h + 2) * scale, R: ch.rows.length, pre: raw.pre || 0 };   // cv: 퇴근 일보 카드(canvas)가 그대로 찍음
  if (spriteCache.size > 600) spriteCache.clear();
  spriteCache.set(k, res);
  return res;
}

/* 🙈 눈치 모드 도트 소품: 서류 가방 · 커피 · 현관 종 (문자 그림 → canvas, 외곽선 포함) */
const NXP = {
  bag: { s: ["..KKKK..", "..K..K..", "KKKKKKKK", "KBBBBBBK", "KBBYYBBK", "KDDDDDDK", "KKKKKKKK"], c: { K: "#2e2040", B: "#a8693a", D: "#7a4a2a", Y: "#ffd23f" } },
  cup: { s: [".KKKK.", "KWWWWK", ".KCCK.", ".KSSK.", ".KCCK.", "..KK.."], c: { K: "#2e2040", W: "#fff8e8", C: "#f6efdc", S: "#3fa35a" } },
  bell: { s: ["..K..", ".KYK.", "KYYYK", "KYYYK", "KKKKK", "..K.."], c: { K: "#2e2040", Y: "#ffd23f" } },
};
const nxpCache = {};
function nxPix(doc, name, sc) {
  const k = name + sc; if (nxpCache[k]) return nxpCache[k];
  const a = NXP[name], cv = doc.createElement("canvas"); cv.width = a.s[0].length; cv.height = a.s.length;
  const g = cv.getContext("2d"); a.s.forEach((r, y) => [...r].forEach((ch, x) => { if (a.c[ch]) { g.fillStyle = a.c[ch]; g.fillRect(x, y, 1, 1); } }));
  return (nxpCache[k] = { url: cv.toDataURL(), w: cv.width * sc, h: cv.height * sc });
}

/* ================= 해시·날짜·텍스트 ================= */
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }   // FNV-1a
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * clamp(k, 0, 1);
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
/* 글자 = 그래핌(사용자가 보는 한 글자): 결합 기호·국기·피부톤·ZWJ 이모지를 쪼개지 않는다. Intl.Segmenter가 없으면 정규식으로 비슷하게 */
const GSEG = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const GRE = /\p{Regional_Indicator}{2}|[\s\S](?:[\p{M}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F]|\u200D[\s\S])*/gu;
const graphemes = s => { s = String(s || ""); return GSEG ? Array.from(GSEG.segment(s), x => x.segment) : s.match(GRE) || []; };
const cut = (s, n) => { const a = graphemes(s); return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
/* 오른쪽→왼쪽·글자가 이어지는 문자(아랍·히브리 등): 글자 단위 연출을 하지 않고 줄 하나로 드러낸다 */
const JOINED = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const muxOf = s => C.muxName(s);   // 멀티플렉서에서 연 세션(#37 cmux · #40 Orca): '터미널로 이동'이 그 세션 자리로 감 (코어와 같은 판단, 🙈 눈치 화면도)
/* 🖥️ 이동 문구: "Orca로 이동" · "cmux로 이동" · "터미널로 이동"(그 밖은 폴더 열기). 버튼·하단 캡션·로비 자막이 같은 문구(title 툴팁은 쓰지 않음) */
const goLabel = (s, X) => muxOf(s) ? X(`${muxOf(s)}로 이동`, `Go to ${muxOf(s)}`) : X("터미널로 이동", "Go to terminal");
const ICON_KIND = { "📖": "read", "✏️": "edit", "📝": "edit", "⚡": "bash", "🔍": "search", "🌐": "web", "🤖": "agent", "🗒️": "todo", "📨": "agent", "🔌": "web" };
const KIND_ICON = { read: "📖", edit: "✏️", bash: "⚡", search: "🔍", web: "🌐", agent: "🤖", todo: "🗒️", think: "💭", other: "🔧" };
/* 도구 종류별 날아오르는 코드 조각 */
const FRAGS = {
  edit: ["{ }", "</>", ";", "( )", "=>", "[ ]", "&&"],
  bash: ["$ _", ">_", "$", "&&", "|", "#!"],
  read: ["📖", ".md", "📄", "§"],
  search: ["🔍", "*", "?", "//"],
  web: ["🌐", "://", "↗"],
  agent: ["👥", "▶", "…"],
  todo: ["✓", "☐", "📝", "[x]"],
  think: ["…", "💭", "?", "!"],
  other: ["⚙", "…", "·"],
};
function tokenFrom(text) {
  const m = String(text || "").match(/\.[A-Za-z]{1,5}(?![A-Za-z0-9])/g);   // 파일 확장자(.rs .ts …)만
  return m && m.length ? m[Math.floor(Math.random() * m.length)] : null;
}

/* ================= 모드 ================= */
const MAXF = 6;          // 최대 층 수 (1층 사장실 제외)
const E_X = 723;         // 엘리베이터 문 앞 x (카 안 = 이 자리에서 타고 내림)
const ASK_X = 598;       // 사장님 앞에서 질문하는 자리
/* 엘리베이터 기다리는 자리(질문하러 갈 때·🙈 눈치 모드 퇴장·출근 모두 같은 규칙): 자기 층 바닥, 통로 왼쪽에서 엘리베이터 쪽을 보고 선다.
   직원 층은 통로 바로 왼쪽이 화분·🎨 바닥 2 칸이라 그 왼쪽(책상과 화분 사이) 첫 빈자리, 1층은 통로 바로 왼쪽. 여럿이면 한 칸(LIFT_GAP)씩 왼쪽으로 줄.
   회의 배치 층은 테이블(350~620)·아기 자리가 통로 왼쪽을 다 차지해서 테이블 왼쪽(벽시계 앞) 첫 빈자리.
   통로(shaft) 칸에는 차가 서서 문이 열린 뒤에만 들어간다(E_X에서 탐) */
const LIFT_STAFF = 566, LIFT_MEET = 318, LIFT_1F = E_X - 87, LIFT_GAP = 76;
const DESK_X = 385, BOARD_X = 278;   // 직원 자리: 책상 층 의자 · 회의 배치 화이트보드 앞
const SIGN_X = 522;   // 책상 층 작업 표지판 왼쪽 끝(오른쪽은 통로 앞까지). 직원이 이 아래로 오면 표지판을 위로 접음(얼굴이 보이게, #62)
const DOOR_X = 438, DOOR_W = 54, DOOR_CX = DOOR_X + DOOR_W / 2;   // 🙈 1층 현관문(창과 자판기 사이: 꾸미기 칸·👆 누를 자리와 안 겹침)
const FHS = 134, FHB = 140;
const WALLS = ["#ffeec2", "#ffe3b0", "#f9efc8", "#fbe2c0", "#fff1cc"], WALL_LO = ["#f2d79a", "#f0c88c", "#ebdba6", "#eeca9c", "#f5de9f"];
const T = { desk: "#c98d5a", deskTop: "#e9b377", roof: "#f6a43c", chair: "#d0905a" };
const SHOP = [
  { id: "plant", e: "🪴", n: ["화분", "Plant"], p: 300, lv: 1 },
  { id: "coffee", e: "☕", n: ["커피머신", "Coffee"], p: 800, lv: 1 },
  { id: "clock", e: "🕰️", n: ["벽시계", "Clock"], p: 600, lv: 2 },
  { id: "plush", e: "🧸", n: ["인형", "Plush"], p: 500, lv: 2 },
  { id: "neon", e: "💡", n: ["네온사인", "Neon"], p: 1500, lv: 3 },
  { id: "frame", e: "🖼️", n: ["액자", "Frame"], p: 1200, lv: 4 },
  { id: "trophy", e: "🏆", n: ["트로피", "Trophy"], p: 2500, lv: 5 },
];
/* 완료(done) = AI가 응답을 끝내고 사용자 차례가 됨(하루 수십 번). 그 작업의 실행 시간(run)이 이만큼 넘을 때만 "큰 일 완료"로 크게 축하 */
const BIG_DONE_SEC = 600;
const isBig = run => (run || 0) >= BIG_DONE_SEC;
/* 💰 벌이(완료 보상, 시안 4 "과금 균형" 제안): 완료 +25 · 실행 30초 미만은 +10("ㅇㅋ" 같은 짧은 턴 반복 방지) · 큰 일(10분↑ 또는 AI가 큰 일 보고) +75 · 아주 큰 일(30분↑) +125.
   토큰 절약 +5 · 페이스 준수 1시간 +10은 그대로. 실행 시간을 모르는 완료(run 0)는 기본 +25. 저장된 자금은 건드리지 않음(앞으로 벌 때만 바뀜).
   하루 예상(완료 30번 중 큰 일 3번): 보통 27 × 25 = 675 + 큰 일 3 × 75 = 225 → 900, 페이스 준수 ≈ 4시간 +40, 토큰 절약 ≈ 2번 +10 ⇒ ≈ 950
   (예전: 30 × 25 = 750 + 50 ≈ 800). 아주 큰 일은 하루 0~1번 +50 더. 층 꾸미기 가격(80~600)이면 소품 1~2개/일, 한 층 5칸 ≈ 1,200 = 하루 반, 6층 전부 ≈ 2주 */
const EARN = { done: 25, short: 10, big: 75, huge: 125, SHORT_SEC: 30, HUGE_SEC: 1800 };
const earnOf = s => { const run = (s && s.run) || 0; return run >= EARN.HUGE_SEC ? EARN.huge : bigOf(s) ? EARN.big : run > 0 && run < EARN.SHORT_SEC ? EARN.short : EARN.done; };
/* ✍️ MCP 보고(session.report, @unstable): AI가 waitscape_status·waitscape_board로 직접 쓴 제목·단계·보드·큰 일.
   문자열은 서버가 정화·마스킹·절단한 값 → 화면엔 esc()·textContent로만(링크·마크다운 해석 없음) */
const repOf = s => { const r = s && s.report; return r && typeof r === "object" ? r : null; };
const stepOf = s => { const r = repOf(s); return r && Number.isInteger(r.step) && Number.isInteger(r.total) && r.step >= 1 && r.step <= r.total ? r : null; };
const bigOf = s => isBig(s && s.run) || !!(repOf(s) && repOf(s).big);   // 10분 넘게 걸렸거나 AI가 큰 일이라고 알림(done 뒤 10분)
const boardOf = s => { const b = repOf(s) && repOf(s).board; return b && Array.isArray(b.lines) && b.lines.some(x => x) ? b : null; };
const CARD_CHEER = 44;   // 공유 카드·복사 텍스트에 넣는 AI 한마디 최대 글자(카드 두 줄에 들어가는 길이)
const AIB_KEEP = 600, AIB_ERASE = 1.6, CHEER_SEC = 5.5, CHEER_GAP = 90;
/* AI 보드를 내릴 시각(epoch): 세션이 끝나 있고(done·idle) 보드가 10분 넘게 안 바뀌었으면 그때 지우기 시작. 아니면 null */
const aibOff = (s, kind) => { const b = boardOf(s); return b && (kind === "done" || kind === "idle") ? (b.ts || 0) + AIB_KEEP : null; };
const aibOn = (s, kind, now) => { const o = aibOff(s, kind); return !!boardOf(s) && !(o != null && now >= o + AIB_ERASE); };
const PROV_COLOR = { claude: "#f28a3d", codex: "#3fa35a", gemini: "#5a6ad8", other: "#7a7f8c" };

/* ================= 전력·날씨: 5시간 한도 = 건물 전력(하루 시계) · 주간 한도 = 날씨(선택) =================
   하루 시계: 5시간 한도 사용률 0~49% 낮(여유) · 50~79% 노을 · 80~99% 저녁 절전(조명 반만·깜빡·자판기 꺼짐) · 100% 정전(촛불·손전등·고양이 눈).
   리셋되면 닭 울음 → 해 뜸 → 아래층부터 딸깍 불이 켜짐 → 기지개. 리셋 직전(남은 8초)에도 닭이 먼저 울어요.
   주간 한도 → 날씨(구름 60~ · 비 80~ · 눈 90~, 옥상에 눈): 기본 꺼짐, 도감 설정(cfg.weather)에서 켬. 건물 밖 하늘과 창에만, 실내는 그대로.
   데이터는 state.limits(five_hour·seven_day)와 Core.limits()만. 한도 정보가 없으면(다른 프로바이더·조회 안 함) 늘 맑은 낮.
   색만으로 구분하지 않음: 숫자·리셋 시간은 늘 보이고, 단계는 밝기·아이콘·문구·게이지 무늬(세로 칸·가로줄·사선·체크)로도 구분.
   회의 모드·움직임 줄이기(정적)면 깜빡임·흔들림·번쩍임 없음. 라이트맵·날씨 캔버스는 값이 바뀔 때만 다시 그림.
   큰 화면(powerBig)과 미니 보기(powerMini)가 같은 시계(pwClock)를 쓴다 — 스튜디오 본체와 섞이지 않게 이 블록에 모아 둠. */
const PW_PH = { day: ["☀️", "여유", "Spare", "#4fc86a"], sunset: ["🌇", "노을", "Sunset", "#ffb03a"], save: ["🌙", "절전", "Power save", "#ff7a3c"], out: ["🕯️", "정전", "Blackout", "#e8505a"], reset: ["🌅", "리셋", "Reset", "#6ac8ff"] };
/* 게이지 무늬(색맹 구분): 낮 = 세로 칸(기존) · 노을 = 가로줄 · 절전 = 사선 · 정전 = 체크 · 리셋 = 무늬 없음 */
const PW_PAT = {
  day: "repeating-linear-gradient(90deg,transparent 0 6px,rgba(46,32,64,.55) 6px 8px),",
  sunset: "repeating-linear-gradient(0deg,transparent 0 3px,rgba(46,32,64,.5) 3px 5px),",
  save: "repeating-linear-gradient(135deg,transparent 0 3px,rgba(46,32,64,.55) 3px 5px),",
  out: "repeating-conic-gradient(rgba(46,32,64,.5) 0 25%,transparent 0 50%) 0 0/6px 6px,",
  reset: "",
};
const pwRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const pwMix = (a, b, k) => { const A = pwRgb(a), B = pwRgb(b); return "#" + A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, "0")).join(""); };
function pwKc(K, p) { if (p <= K[0][0]) return K[0][1]; for (let i = 1; i < K.length; i++) if (p <= K[i][0]) return pwMix(K[i - 1][1], K[i][1], (p - K[i - 1][0]) / (K[i][0] - K[i - 1][0])); return K[K.length - 1][1]; }
function pwKv(K, p) { if (p <= K[0][0]) return K[0][1]; for (let i = 1; i < K.length; i++) if (p <= K[i][0]) return lerp(K[i - 1][1], K[i][1], (p - K[i - 1][0]) / (K[i][0] - K[i - 1][0])); return K[K.length - 1][1]; }
const pwH = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pwHM = s => { const m = Math.max(0, Math.ceil((s || 0) / 60)); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); };   // 리셋까지 h:mm (남은 분은 올림: 0:00은 진짜 리셋 때만)
/* 하늘 (p = 하루 시계 0 아침 → 100 밤). gw = 날씨 회색 · 다크 테마는 채도를 35% 낮춤(단계 밝기 차이는 유지) */
const PW_SKY_T = [[0, "#86ccf6"], [40, "#62b8f4"], [55, "#8a6ab8"], [68, "#5a4a9a"], [80, "#2a2a68"], [92, "#14123a"], [100, "#0b0a22"]];
const PW_SKY_B = [[0, "#e2f4ff"], [40, "#cdeeff"], [55, "#ffc48a"], [68, "#ff8a6a"], [80, "#7a5a9a"], [92, "#2e2a5e"], [100, "#1a1840"]];
function pwSky(p, gw, dark) {
  let a = pwKc(PW_SKY_T, p), b = pwKc(PW_SKY_B, p);
  if (gw) { a = pwMix(a, "#8a92a8", gw); b = pwMix(b, "#aab0c0", gw); }
  if (dark) { a = pwMix(a, "#0b0a22", .35); b = pwMix(b, "#0b0a22", .35); }
  return [a, b];
}
const PW_CLOUD = [[0, "#ffffff"], [45, "#ffffff"], [60, "#ffd0c0"], [75, "#c08ab0"], [90, "#4a4478"], [100, "#2e2a50"]];
/* 도트 원(해·달) */
const pwDiscs = new Map();
function pwDisc(doc, r, col, cut) {
  const k = r + col + (cut || 0); if (pwDiscs.has(k)) return pwDiscs.get(k);
  const c = doc.createElement("canvas"), d = r * 2 + 1; c.width = d; c.height = d; const g = c.getContext("2d");
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) { const dx = x - r, dy = y - r; if (dx * dx + dy * dy <= r * r + r * .6) { if (cut && (dx - cut) * (dx - cut) + (dy + 1) * (dy + 1) <= r * r) continue; g.fillStyle = col; g.fillRect(x, y, 1, 1); } }
  const u = c.toDataURL(); pwDiscs.set(k, u); return u;
}
/* 캐릭터 눈 위치(스프라이트 칸, 테두리 1칸 포함): 정전 때 고양이·로봇 눈만 빛나게 */
const pwEyeCache = new Map();
function pwEyes(ch, o) {
  const k = ch.id + JSON.stringify(o); if (pwEyeCache.has(k)) return pwEyeCache.get(k);
  let g = mkG(ch, o), ox = 0, oy = 0;
  if (o.trim) { let y0 = 1e9, x0 = 1e9; g.forEach((r, y) => r.forEach((c, x) => { if (c !== ".") { y0 = Math.min(y0, y); x0 = Math.min(x0, x); } })); oy = -y0; ox = -x0; }
  const out = [];
  g.forEach((r, y) => r.forEach((c, x) => { if (c === "P" && r[x - 1] !== "P") out.push([x + ox + 1, y + oy + 1]); }));
  const res = out.slice(0, 2); pwEyeCache.set(k, res); return res;
}
/* 라이트맵: 어둠(D)을 칸 단위로 칠하고 광원 주변만 4단계 계단식으로 밝힘. 광원 목록·어둠이 그대로면 다시 그리지 않음 */
function pwLightmap(doc, parent, x, y, w, h, cell, z) {
  const c = doc.createElement("canvas"); c.className = "b pw-lm";
  Object.assign(c.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px", zIndex: String(z), pointerEvents: "none", display: "none" });
  parent.appendChild(c);
  const W = c.width = Math.ceil(w / cell), H = c.height = Math.ceil(h / cell), g = c.getContext("2d"), img = g.createImageData(W, H), acc = new Float32Array(W * H);
  let sig = "";
  return { c, draw(D, L, dark, warm) {
    const s = D <= .003 ? "0" : D.toFixed(3) + (dark || "") + L.map(q => [q.x | 0, q.y | 0, q.r | 0, q.i.toFixed(2), q.cone ? q.dir : ""].join(",")).join("|");
    if (s === sig) return; sig = s;
    if (D <= .003) { c.style.display = "none"; return; }
    c.style.display = "block";
    acc.fill(0);
    for (const q of L) {   // 광원마다 자기 반경 안의 칸만 더함(전체 칸 × 광원 수를 돌지 않음)
      const i0 = Math.max(0, Math.floor((q.x - q.r - x) / cell)), i1 = Math.min(W - 1, Math.ceil((q.x + q.r - x) / cell));
      const j0 = Math.max(0, Math.floor((q.y - q.r - y) / cell)), j1 = Math.min(H - 1, Math.ceil((q.y + q.r - y) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = x + (i + .5) * cell - q.x, dy = y + (j + .5) * cell - q.y, dd = Math.sqrt(dx * dx + dy * dy);
        if (dd > q.r) continue;
        let v;
        if (q.cone) { let a = Math.atan2(dy, dx) - q.dir; a = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); v = a < q.cone ? (1 - dd / q.r) * (1.3 - a / q.cone) : 0; v = Math.max(v, 1 - dd / (q.r0 || 12)); }
        else v = 1 - dd / q.r;
        if (v > 0) acc[j * W + i] += v * q.i;
      }
    }
    const d = img.data, [dr, dg, db] = pwRgb(dark || "#0a0820"), [wr, wg, wb] = pwRgb(warm || "#ffb84a");
    for (let p = 0; p < W * H; p++) {
      const q = Math.min(4, Math.floor(Math.min(1, acc[p]) * 4 + .001)) / 4, a = D * (1 - q), wk = D > .2 && q >= .5 ? (q - .25) * .3 * D : 0, A = a + wk, o = p * 4;
      if (A <= .003) { d[o + 3] = 0; continue; }
      d[o] = (dr * a + wr * wk) / A; d[o + 1] = (dg * a + wg * wk) / A; d[o + 2] = (db * a + wb * wk) / A; d[o + 3] = 255 * Math.min(1, A);
    }
    g.putImageData(img, 0, 0);
  } };
}
/* 날씨 입자(주간 한도 80~ 비, 90~ 눈). skip(x, y) = 그리지 않을 칸 */
function pwRain(cv, wk, t, still, skip, dens) {
  const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
  if (wk < 80) return;
  const snow = wk >= 90, n = Math.round((snow ? 70 : 90) * (dens || 1) * cv.width * cv.height / 46000) + 6;
  g.fillStyle = snow ? "#ffffff" : "rgba(70,100,170,.75)";
  for (let i = 0; i < n; i++) {
    let x = Math.floor(pwH(i) * cv.width); const sp = snow ? 6 : 40, y = Math.floor((pwH(i + 99) * cv.height + (still ? 0 : t * sp * (.7 + pwH(i + 7) * .6))) % cv.height);
    if (snow && !still) x = Math.floor(x + Math.sin(t * 1.5 + i) * 2);
    if (skip && skip(x, y)) continue;
    if (snow) g.fillRect(x, y, 1, 1); else g.fillRect(x, y, 1, Math.max(2, Math.round(cv.height / 60)));
  }
}

/* 시계: state → 단계. 리셋(50% 넘게 쓰다가 30%p 이상 뚝 떨어짐 또는 리셋 시각 지남) 순간과 단계 진입 시각을 기억 */
const PW_RESET_LEN = 6.2;
function pwClock() {
  const c = { r: { has: false, pct: null, ph: "day", rem: null, wk: null }, seen: false, outT: -1e9, saveT: -1e9, sunT: -1e9, flkT: -1e9, resetT: -1e9, from: null, sky: 12, D: 0 };
  c.read = (st, now, tc) => {
    const L = C.limits(st, now), f = L.five, has = !!(st && st.limits) && (f.used != null || f.wasReset);
    const pct = has ? (f.used != null ? clamp(f.used, 0, 100) : 0) : null;
    const ph = !has ? "day" : pct >= 100 ? "out" : pct >= 80 ? "save" : pct >= 50 ? "sunset" : "day";
    const p = c.r, first = !c.seen;
    if (!first && p.has && has && p.pct >= 50 && pct <= p.pct - 30) { c.resetT = tc; c.from = { sky: c.sky, D: c.D, ph: p.ph }; }
    const enter = (k, cur) => { if (ph === k && (first || p.ph !== k)) c[cur] = first ? tc - 99 : tc; };   // 앱을 켰을 때 이미 그 단계면 도입부(번쩍·말풍선)는 건너뜀
    enter("out", "outT"); enter("save", "saveT"); enter("sunset", "sunT");
    if (has && pct >= 97 && pct < 100 && !(p.pct >= 97 && p.pct < 100)) c.flkT = first ? tc - 99 : tc;
    c.seen = true;
    c.r = { has, pct, ph, rem: f.reset ? f.reset - now : null, wk: L.week.used, pace: f.pace };
    return c.r;
  };
  /* 한 장면의 환경. fb = 아래층부터 0(사장실) 1 2 … · half = 절전 때 꺼지는 자리 */
  c.env = (tc, T, still, dark, wxOn) => {
    const r0 = c.r, k = tc - c.resetT, rs = !!c.from && k >= 0 && k < PW_RESET_LEN;
    const ph = rs ? "reset" : r0.ph, pct = r0.pct == null ? 0 : r0.pct;
    let sky = r0.has ? pct : 12, D = 0, tint = null;
    if (ph === "sunset") { D = pwKv([[50, 0], [79, .28]], pct); tint = ["#ffb070", pwKv([[50, .05], [79, .35]], pct)]; }
    if (ph === "save") { D = pwKv([[80, .42], [99, .55]], pct); tint = ["#8a86d8", .35]; }
    if (ph === "out") { D = .88; tint = ["#5a5aa8", .45]; }
    if (ph === "reset") { sky = lerp(c.from.sky, sky, ease(k / 3.4)); D = lerp(c.from.D, 0, ease((k - .8) / 3)); tint = ["#ffc080", .35 * (1 - ease((k - 1) / 4))]; }
    if (dark && tint) tint = [pwMix(tint[0], "#ffffff", .35), tint[1]];
    c.sky = sky; c.D = D;
    const wk = wxOn && r0.wk != null ? r0.wk : 0, o = ph === "out" ? tc - c.outT : 99, r = rs ? k : 99;
    const E = { ph, pct, has: r0.has, rem: r0.rem, sky, D, tint, wk, gw: clamp((wk - 60) / 25, 0, 1) * .55, o, r, still, T, dark,
      sv: tc - c.saveT, st: tc - c.sunT, fk: tc - c.flkT,
      night: clamp((sky - 82) / 10, 0, 1), cityOn: sky > 70, neon: ph === "day" || ph === "sunset" || (ph === "reset" && r > 2.2),
      vOff: ph === "save" || ph === "out" || (ph === "reset" && r < 2),
      steam: ph === "day" || (ph === "reset" && r > 3) ? 2 : ph === "sunset" ? 1 : 0,   // 커피 김: 시간이 갈수록 식고 리셋 뒤 새 커피
      dead: ph === "out" || (ph === "reset" && r < 1.1),   // 화면·타자 멈춤
      flash: ph === "out" && o < .18 && !still, pop: ph === "out" && o < 1.2,
      rooster: (ph === "out" && r0.rem != null && r0.rem <= 8 && r0.rem > -2) || (ph === "reset" && r < .6) };
    E.lit = (fb, half) => {
      if (ph === "sunset") return pct >= 56 + Math.min(fb, 6) * 3 ? 1 : 0;   // 아래층부터 하나둘 불이 켜짐
      if (ph === "save") { if (pct >= 97) return still ? 1 : (pwH(Math.floor(T * 14) + fb * 7) < .45 ? 0 : 1); if (half) return 0; return still ? 1 : (pwH(Math.floor(T * 5) + fb * 13) < .12 ? .3 : 1); }
      if (ph === "reset") { const on = .8 + fb * .45; return r >= on && r < 5.2 ? 1 : 0; }
      return 0;
    };
    E.mon = (fb, half) => ph === "out" ? "off" : ph === "reset" ? (r >= 1.1 + fb * .45 ? "code" : "off") : ph === "save" && (half || fb === 0) ? "saver" : "code";
    E.candle = (fb, k) => (ph === "out" && o >= 1.2 + k * .3) || (ph === "reset" && r < 1.2 + fb * .45);
    E.click = fb => { const on = .8 + fb * .45; return ph === "reset" && r >= on && r < on + .7; };
    E.stretch = fb => { const s0 = 2.6 + fb * .18; return ph === "reset" && r >= s0 && r < s0 + 1.4; };
    E.flick = s => still ? 1 : .8 + .2 * pwH(Math.floor(T * 9) + s * 31);
    E.half = fb => fb % 2 === 1;
    return E;
  };
  return c;
}
const PW_MPAT = { day: "", sunset: "repeating-linear-gradient(0deg,transparent 0 2px,rgba(46,32,64,.55) 2px 3px),", save: "repeating-linear-gradient(135deg,transparent 0 2px,rgba(46,32,64,.6) 2px 4px),", out: "repeating-conic-gradient(rgba(46,32,64,.55) 0 25%,transparent 0 50%) 0 0/4px 4px,", reset: "" };   // 로비 상단 바(9px) 게이지 무늬
const pwIcon = ph => PW_PH[ph][0];
const pwWxIcon = wk => wk == null ? "" : wk >= 90 ? "❄️" : wk >= 80 ? "🌧️" : wk >= 60 ? "☁️" : "☀️";
const pwGaugeBg = (ph, has) => has ? PW_PAT[ph] + PW_PH[ph][3] : "";

/* ---------- 큰 화면 ---------- */
function powerBig(h) {
  const { doc, win, mkEl, sty, txt, html, X, view, hud } = h;
  const clk = pwClock(), dark = () => !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches);
  const box = (p, x, y, w, hh, bg, css) => mkEl("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: hh + "px", background: bg }, css || {}));
  const show = (e, on) => sty(e, "display", on ? "block" : "none");
  /* 하늘 소품: 달 · 별 · 이웃 건물(창은 저녁·정전 때 켜짐) · 회색 구름 · 날씨 캔버스 */
  const stu = view.closest(".stu"), sun = view.querySelector(".sun"), hills = [...view.querySelectorAll(".hill")], ground = view.querySelector(".ground"),
    birds = [...view.querySelectorAll(".bird")];
  const moon = mkEl("img", "pw-moon", view, { display: "none" }); moon.alt = ""; moon.src = pwDisc(doc, 5, "#fff6d0", 3);
  const stars = [...Array(30)].map((_, i) => mkEl("i", "pw-star", view, { left: (pwH(i) * 98).toFixed(1) + "%", top: Math.round(6 + pwH(i + 40) * 220) + "px" }));
  const city = mkEl("div", "pw-city", view), cityW = [];
  [[0, 132, 46], [52, 92, 38], [96, 156, 50], [200, 118, 40]].forEach(([x, hh, w]) => { const b = box(city, x, 156 - hh, w, hh, "var(--pw-city)"); for (let yy = 10; yy < hh - 10; yy += 16) for (let xx = 8; xx < w - 8; xx += 12) cityW.push(box(b, xx, yy, 4, 6, "#ffe27a", { opacity: "0" })); });
  const lampPost = box(city, 164, 66, 4, 90, "#4a4060"), lampHead = box(city, 154, 60, 24, 8, "#8a8098", { border: "2px solid #2e2040" });
  const gclouds = [[14, 10, 1.5], [40, 34, 1.25], [63, 6, 1.75], [84, 40, 1.25]].map(([l, t, k]) => {   // 날씨: 회색 도트 구름(시안과 같은 3조각)
    const c = mkEl("div", "pw-gcl", view, { left: l + "%", top: t + "px", display: "none" });
    [[0, 8, 64, 16], [12, 0, 28, 12], [36, 4, 20, 8]].forEach(([x, y, w, hh]) => box(c, Math.round(x * k / 4) * 4, Math.round(y * k / 4) * 4, Math.round(w * k / 4) * 4, Math.round(hh * k / 4) * 4, "currentColor"));
    return c; });
  const wx = mkEl("canvas", "pw-wx", view);
  /* HUD 단계 배지 */
  const badge = mkEl("div", "hb pwph", null, null, `<span class="ic"></span><b></b>`); badge.hidden = true;
  hud.insertBefore(badge, hud.querySelector(".askchip"));
  let G = null;
  /* 층을 다시 지을 때: 조명·촛불·화면 덮개·창 하늘·햇빛 자국·자판기·말풍선 */
  function build(o) {
    const { bld, FL, FT, BASE, n, sceneH, wins, roofY } = o;
    G = Object.assign({}, o, { fl: [] });
    G.tint = box(bld, 0, roofY, 860, sceneH - roofY, "transparent", { zIndex: 17, mixBlendMode: "multiply", pointerEvents: "none", display: "none" });
    G.lm = pwLightmap(doc, bld, 0, roofY, 860, sceneH - roofY, 4, 18);   // 층 이름표(20) 아래, 액터(8) 위 — 복제 이름표·말풍선은 19
    G.snow = box(bld, -4, roofY - 6, 868, 8, "#fff", { zIndex: 6, display: "none", boxShadow: "0 2px 0 #d8e4f0" });
    G.flash = box(bld, 0, 0, 860, sceneH, "#fff", { zIndex: 45, opacity: "0", pointerEvents: "none" });
    G.pop = mkEl("div", "b pw-pop", bld, { left: "372px", top: (roofY - 34) + "px", display: "none" }, "⚡ " + X("퍽!", "Pop!"));
    G.rooster = mkEl("div", "bub pw-say", bld, { left: "330px", top: (roofY - 22) + "px", display: "none" }, "🐓 " + X("꼬끼오~!", "Cock-a-doodle-doo!"));
    G.out = mkEl("div", "b pw-out", bld, { display: "none" });
    G.save = mkEl("div", "b pw-tagc", bld, { display: "none" }, X("절전", "Saving"));
    G.torch = mkEl("div", "b", bld, { zIndex: 26, display: "none" }); box(G.torch, 0, 0, 16, 7, "#5a6070", { border: "2px solid #2e2040" }); box(G.torch, 14, -1, 4, 9, "#fff3a8");
    G.eyes = [0, 1, 2, 3].map(() => box(bld, 0, 0, 8, 8, "#c8ff6a", { zIndex: 26, display: "none" }));
    G.lifts = [];
    G.sign = bld.querySelector(".sign");
    G.shaft = bld.querySelector(".shaft");
    for (let i = 0; i <= n; i++) {
      const fl = FL[i], F = fl.F, B = BASE[i], boss = i === n, f = fl.f, meet = !!(f && f.layout === "meet"), T0 = FT[i];
      const r = { i, fb: n - i, boss, meet, has: boss || !!f, F, B, T0 };
      const lx = boss ? 150 : meet ? 485 : 470;
      box(F, lx - 1, 0, 2, 8, "var(--line)", { zIndex: 4 }); box(F, lx - 15, 8, 30, 8, "#6a5a88", { border: "2px solid var(--line)", zIndex: 4 });
      r.bulb = box(F, lx - 6, 16, 12, 4, "#8a8098", { zIndex: 4 }); r.lx = lx; r.ly = T0 + 22;
      r.click = mkEl("div", "b pw-click", bld, { left: (lx + 18) + "px", top: (T0 + 10) + "px", display: "none" }, X("딸깍", "click"));
      r.str = mkEl("div", "b pw-str", bld, { display: "none" }, X("으라차~", "Stretch~"));
      if (r.has) {
        const cx = boss ? 160 : meet ? 384 : 342, top = boss ? B - 26 : meet ? B - 22 : B - 26;
        r.cx = cx; r.cy = T0 + top - 16;
        r.candle = mkEl("div", "b", bld, { left: (cx - 5) + "px", top: (T0 + top - 24) + "px", zIndex: 22, display: "none" });
        box(r.candle, 1, 8, 8, 16, "#fff3d6", { border: "2px solid #2e2040" }); r.flame = box(r.candle, 3, 0, 4, 8, "#ffb03a"); box(r.flame, 1, 3, 2, 4, "#fff3a8");
      }
      if (boss) {   // 사장실 화면(장식 줄)을 덮는 판 · 자판기
        r.scr = { x: 206, y: B - 92, w: 64, h: 44 };
        r.cover = box(F, 206, B - 92, 64, 44, "#0e0b1a", { zIndex: 11, display: "none", overflow: "hidden" }); r.saver = box(r.cover, 0, 0, 6, 6, "#ffd23f");
        r.vend = box(F, 496, B - 56, 46, 56, "#e85050", { border: "3px solid var(--line)", zIndex: 4 });
        r.vglass = box(F, 501, B - 51, 26, 28, "#cfefff", { border: "2px solid #2e2040", zIndex: 5 });
        ["#ffd23f", "#2fbf71", "#4a63e0", "#ff8fb3", "#fff", "#ff7a3c"].forEach((cl, j) => box(F, 504 + (j % 3) * 7, 54 + B - 51 - 50 + Math.floor(j / 3) * 12, 5, 8, cl, { zIndex: 6 }));
        r.vlogo = box(F, 501, B - 20, 26, 6, "#fff", { zIndex: 5 }); box(F, 530, B - 44, 5, 12, "#2e2040", { zIndex: 5 }); box(F, 502, B - 11, 24, 6, "#2e2040", { zIndex: 5 });
        r.vx = 519; r.vy = T0 + B - 30;
      } else if (f && !meet && fl.desk) {
        r.scr = { x: 449, y: B - 87, w: 58, h: 40 };
        r.cover = mkEl("div", "b", fl.desk.sc, { left: "0", top: "0", right: "0", bottom: "0", background: "#0e0b1a", zIndex: 5, display: "none" }); r.saver = box(r.cover, 0, 0, 6, 6, "#ffd23f");
        r.steam = [0, 1].map(j => box(F, 512 + j * 6, B - 62, 2, 8, "rgba(255,255,255,.9)", { zIndex: 11, display: "none" }));
      }
      r.wins = wins.filter(w => w.f === F).map(w => {
        const sky = box(F, w.x + 3, w.y + 3, w.w - 6, w.h - 6, "transparent", { zIndex: 2 });
        const lp = box(F, w.x, B - 8, w.w, 8, "rgba(255,240,180,.55)", { zIndex: 2, display: "none" });
        return Object.assign({ sky, lp }, w);
      });
      G.fl.push(r);
    }
  }
  /* 액터 이름표·말풍선이 어둠에 묻히지 않게: 어두울 땐 같은 모양의 복제본을 라이트맵 위에 띄움 */
  function lift(src, on) {   // 읽기(위치)만 — 쓰기는 liftApply에서 한꺼번에(강제 레이아웃 한 번)
    if (!on || !src.isConnected || src.style.display === "none" || (src.classList.contains("bub") && src.style.display !== "block")) return { src, off: true };
    let x = 0, y = 0, e = src;
    while (e && e !== G.bld) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return e !== G.bld ? { src, off: true } : { src, x, y };
  }
  function liftApply(q) {
    const src = q.src; let L = src._pwl;
    if (q.off) { if (L) { sty(L, "display", "none"); sty(src, "visibility", ""); } return; }
    if (!L || !L.isConnected) { L = src._pwl = mkEl("div", "", G.bld); G.lifts.push(L); }
    if (L.className !== src.className + " pw-lift") L.className = src.className + " pw-lift";
    html(L, src.innerHTML); sty(L, "background", src.style.background || ""); sty(L, "bottom", "auto"); sty(L, "left", q.x + "px"); sty(L, "top", q.y + "px"); sty(L, "display", "block");
    sty(src, "visibility", "hidden");
  }
  let E = null, wxSig = "", liftT = -1, liftOn = false, vwS = [0, 0];
  const api = {
    build,
    read(st, now) { return clk.read(st, now, win.performance.now() / 1000); },
    resize() { vwS = [Math.ceil(view.clientWidth / 4), Math.ceil(view.clientHeight / 4)]; },
    phase: () => E ? E.ph : "day",
    out: () => !!E && E.ph === "out",
    vOff: () => !!E && E.vOff,   // 👆 POKE: 자판기 누름 → 절전이면 안 나옴
    vendEl: i => G && G.fl[i] ? G.fl[i].vend : null,
    wxIcon: () => h.cfg().weather && clk.r.wk != null ? " " + pwWxIcon(clk.r.wk) : "",
    wk: () => h.cfg().weather && clk.r.wk != null ? clk.r.wk : 0,   // ☂️ TINY 우산 꽂이: 날씨를 켰을 때만 주간 한도 %(비 80~ · 눈 90~)
    night: () => E ? E.night : 0,   // 🐦 TINY 비둘기: 밤엔 안 앉음
    /* HUD: 전력 게이지 무늬·색, 머리줄(정전이면 "리셋까지 h:mm"), 단계 배지 */
    hud(Q) {
      const r = clk.r, ph = E ? E.ph : r.ph;
      badge.hidden = !r.has;
      if (!r.has) return;
      sty(Q.pwI, "background", pwGaugeBg(ph, true));
      const P = PW_PH[ph];
      html(Q.pwH, `<span class="t" title="${X("전력 · 5시간 한도", "Power · 5h limit")}">${X("전력 · 5시간 한도", "Power · 5h limit")}</span>${r.rem != null ? `<span class="r">${ph === "out" ? X("리셋까지 ", "reset in ") + "<b>" + pwHM(r.rem) + "</b>" : X("리셋 ", "reset ") + esc(C.fmt(Math.max(0, r.rem)))}</span>` : ""}`);
      sty(badge, "background", P[3]); txt(badge.firstChild, P[0]); txt(badge.lastChild, X(P[1], P[2]));
      badge.setAttribute("aria-label", `${X("전력", "Power")} ${X(P[1], P[2])} · ${Math.round(r.pct)}%`);
    },
    /* 직원(자기 책상): 정전·리셋 첫 순간엔 타자 대신 앉아 있기 · 기지개. 반환 null = 평소대로 */
    hold(i, f, a) {
      if (!E || !G || !G.fl[i]) return null;
      const r = G.fl[i], fb = r.fb;
      if (E.ph === "out") {
        const cat = f.animal === "cat";
        const say = cat && E.o >= .8 && E.o < 3 ? X("(눈만 반짝)", "(just eyes)") : G.torchI === i && E.o >= 2.2 && E.o < 4.6 ? X("손전등 있어요 🔦", "Got a flashlight 🔦") : "";
        return { p: { view: "front", seated: 1, eyes: "o", mouth: E.o < 1.4 ? "o" : "" }, scr: "off", say };
      }
      if (E.ph === "reset") {
        if (E.stretch(fb)) return { p: { view: "front", seated: 1, arms: "u", eyes: "c" }, scr: E.mon(fb, false) === "off" ? "off" : "on" };
        if (E.r < 1.1 + fb * .45) return { p: { view: "front", seated: 1, eyes: "o" }, scr: "off" };
        return null;
      }
      if (E.ph === "save" && E.pct < 97 && E.pct >= 84 && G.darkI === i) return { say: X("어두워…", "So dark…") };
      return null;
    },
    /* 사장님(평소 자리): 정전 당황 · 리셋 만세 · 단계 들어설 때 한마디 */
    boss(ph) {
      if (!E) return null;
      const P = { view: "front", seated: 1, eyes: ph.blink ? "c" : "o" };
      if (E.ph === "out") {
        if (E.o < 3.5) return { p: { view: "front", seated: 1, arms: "u", mouth: "o" }, dx: E.still ? 0 : (Math.floor(E.T * 12) % 2) * 4, say: X("으앗! 정전이다?! 💦", "Whoa! Blackout?! 💦") };
        return { p: P, dx: 0, say: E.o < 9 ? X("촛불 켜! 리셋 기다리자 🕯️", "Candles on! Wait for reset 🕯️") : "" };
      }
      if (E.ph === "reset") {
        const up = E.r >= 1 && E.r < 2.6;
        return { p: up ? { view: "front", seated: 1, arms: "u", mouth: "o" } : P, dx: 0, say: E.r >= 1 && E.r < 4.2 ? X("불 들어왔다! 다시 출근~", "Power's back! Back to work~") : "" };
      }
      if (E.ph === "save") { const fl = E.pct >= 97 && E.fk < 6; return (fl || E.sv < 8) ? { p: P, dx: 0, say: fl ? X("어, 어… 깜빡인다?!", "Uh-oh… it's flickering?!") : X("절전! 불 반만 켜자 💡", "Power save! Half the lights 💡") } : null; }
      if (E.ph === "sunset" && E.st < 8) return { p: P, dx: 0, say: X("벌써 노을이네… ☕", "Sunset already… ☕") };
      return null;
    },
    /* 한 프레임: 하늘 → 창 → 층별 조명 → 특수 효과 → 라이트맵 → 말풍선 띄우기 → 날씨 */
    frame(T, tc, anim, A) {
      if (!G) return;
      const dk = dark(), wxOn = !!h.cfg().weather;
      E = clk.env(tc, T, !anim, dk, wxOn);
      const [st, sb] = pwSky(E.sky, wxOn ? E.gw : 0, dk);
      sty(stu, "background", `linear-gradient(${st} 0, ${sb} 70%, ${pwMix(sb, "#ffffff", dk ? 0 : .25)} 100%)`);
      /* 해(아침엔 낮게 → 정오 높이 → 노을 때 건물 뒤로) · 달 · 별 */
      const sy = E.sky <= 30 ? lerp(70, 24, ease(E.sky / 30)) : lerp(24, 220, ease((E.sky - 30) / 52));
      sty(sun, "top", Math.round(sy) + "px");
      sty(sun, "background", E.sky > 52 ? "#ff8a4a" : dk ? "#e8ecff" : "#ffe36b"); sty(sun, "borderColor", E.sky > 52 ? "#e0602a" : dk ? "#aab4e8" : "#f5b82e");
      sty(sun, "opacity", String(clamp(1 - E.gw * 1.4, 0, 1) * (E.sky > 84 ? 0 : 1)));
      sty(moon, "display", E.night > 0 ? "block" : "none"); sty(moon, "opacity", String(E.night));
      stars.forEach((s, i) => sty(s, "opacity", String(E.night * (E.still ? .85 : (pwH(i + Math.floor(T * 2)) > .3 ? 1 : .45)))));
      const cc = pwKc(PW_CLOUD, E.sky);
      const ccv = wxOn && E.wk >= 60 ? pwMix(cc, "#8a8aa0", clamp((E.wk - 55) / 30, 0, 1) * .7) : cc;
      if (stu._pwc !== ccv) { stu._pwc = ccv; stu.style.setProperty("--pw-cloud", ccv); }
      gclouds.forEach(g => { show(g, wxOn && E.wk >= 60); if (wxOn && E.wk >= 60) sty(g, "color", pwMix(cc, "#8a8aa0", .55)); });
      const dim = 1 - E.D * .75 - E.night * .1;
      hills.concat(ground ? [ground] : []).forEach(e => sty(e, "filter", dim < .99 ? `brightness(${dim.toFixed(2)})` : ""));
      birds.forEach(b => sty(b, "display", E.sky > 75 ? "none" : ""));   // 새는 밤엔 자러 감
      cityW.forEach((w, i) => sty(w, "opacity", E.cityOn && pwH(i) > .35 ? "1" : "0"));   // 이웃 건물: 저녁엔 불, 우리 건물이 정전이어도 그대로
      sty(city, "filter", E.D > .01 || E.sky > 70 ? `brightness(${(1 - Math.min(.6, E.sky > 70 ? .5 : E.D * .5)).toFixed(2)})` : "");
      const lampOn = E.sky > 66; sty(lampHead, "background", lampOn ? "#ffe27a" : "#8a8098"); sty(lampHead, "boxShadow", lampOn ? "0 0 0 4px rgba(255,226,122,.35), 0 12px 0 8px rgba(255,226,122,.12)" : "none");
      /* 간판 네온 · 엘리베이터 통로(라이트맵 위에 있어 따로 어둡게) · 옥상 눈 */
      if (G.sign) { sty(G.sign, "filter", E.neon ? "" : "brightness(.55) saturate(.6)"); sty(G.sign, "boxShadow", E.neon && E.sky > 60 ? "0 0 0 3px rgba(255,210,63,.35)" : ""); }
      if (G.shaft) sty(G.shaft, "filter", E.D > .01 ? `brightness(${(1 - E.D * .72).toFixed(2)})` : "");
      show(G.snow, wxOn && E.wk >= 90);
      /* 층마다 */
      const L = [];
      const darkHalf = G.fl.filter(r => r.has && !r.boss && E.half(r.fb));
      G.darkI = darkHalf.length ? darkHalf[darkHalf.length - 1].i : -1;
      let torchI = -1, k = 0;
      const staff = (i) => { const f = A.model.floors[i], a = f && A.actors.get(f.sid); return f && a && a.loc === "home" && !a.moving && !["ask", "stall"].includes(f.kind) && f.layout !== "meet" ? { f, a } : null; };
      G.fl.forEach(r => { const s = !r.boss && staff(r.i); if (s && s.f.animal === "peng" && torchI < 0) torchI = r.i; });
      if (torchI < 0) { const t = G.fl.find(r => { const s = !r.boss && staff(r.i); return s && s.f.animal !== "cat" && s.f.animal !== "bot"; }); if (t) torchI = t.i; }
      G.torchI = torchI;
      let ei = 0;
      G.fl.forEach(r => {
        const half = E.half(r.fb) && !r.boss, lv = r.has ? E.lit(r.fb, half) : 0;
        sty(r.bulb, "background", lv > 0 ? "#fff3a8" : "#8a8098"); sty(r.bulb, "zIndex", lv > 0 ? "23" : "4"); sty(r.bulb, "boxShadow", lv > 0 ? "0 4px 0 2px rgba(255,236,150,.6)" : "none");
        if (lv > 0) L.push({ x: r.lx, y: r.ly, r: 130, i: 1.15 * lv });
        show(r.click, E.click(r.fb) && r.has);
        /* 창: 하늘 일부 + 노을에 길어지는 햇빛 자국 */
        const Lk = E.sky < 40 ? 0 : E.sky < 78 ? ease((E.sky - 40) / 38) : 0, lpOn = E.sky < 78 && E.D < .5;
        r.wins.forEach(w => {
          sty(w.sky, "background", `linear-gradient(${st}, ${sb})`); if (w.gl) sty(w.gl, "opacity", E.sky < 85 ? "1" : ".2");
          show(w.lp, lpOn); if (lpOn) { const hh = Lk > .5 ? 4 : 8; sty(w.lp, "width", Math.round((w.w + Lk * 90) / 4) * 4 + "px"); sty(w.lp, "left", Math.round((w.x - Lk * 70) / 4) * 4 + "px"); sty(w.lp, "height", hh + "px"); sty(w.lp, "top", (r.B - hh) + "px"); sty(w.lp, "background", E.sky < 50 ? "rgba(255,240,180,.55)" : "rgba(255,170,100,.5)"); }
        });
        /* 화면: 사장실은 덮개로 끔, 직원은 hold가 끔. 절전 반쪽 자리는 화면보호기 */
        const s = !r.boss && staff(r.i), m = r.has ? E.mon(r.fb, half) : "code";
        if (r.cover) {
          const on = r.boss ? m !== "code" : m === "saver" && !!s;
          show(r.cover, on);
          if (on) { show(r.saver, m === "saver"); if (m === "saver") { const u = (E.still ? 30 : T * 30) + r.i * 50, W_ = r.scr.w - 6, H_ = r.scr.h - 6; sty(r.saver, "left", Math.round(Math.abs((u % (W_ * 2)) - W_) / 2) * 2 + "px"); sty(r.saver, "top", Math.round(Math.abs(((u * .7) % (H_ * 2)) - H_) / 2) * 2 + "px"); sty(r.saver, "background", ["#ffd23f", "#ff8fb3", "#7dff9c"][Math.floor(u / 88) % 3]); } }
        }
        if (r.scr && m !== "off" && (r.boss || s)) L.push({ x: r.scr.x + r.scr.w / 2, y: r.T0 + r.scr.y + r.scr.h / 2, r: 44, i: .8 });
        if (r.steam) r.steam.forEach((e, j) => { const on = j < E.steam && !!s; show(e, on); if (on) sty(e, "top", (r.B - 62 - (E.still ? 0 : Math.floor(T * 4 + j * 2) % 3 * 2)) + "px"); });
        /* 촛불: 정전 뒤 하나씩(고양이는 눈만 반짝) */
        if (r.candle) {
          const cat = !r.boss && A.model.floors[r.i] && A.model.floors[r.i].animal === "cat";
          const on = !cat && E.candle(r.fb, k++); show(r.candle, on);
          if (on) { const fl = E.flick(r.i); sty(r.flame, "height", (fl > .9 ? 8 : 6) + "px"); sty(r.flame, "top", (fl > .9 ? 0 : 2) + "px"); L.push({ x: r.cx, y: r.cy, r: 66, i: fl }); }
        }
        /* 자판기 */
        if (r.vend) {
          sty(r.vglass, "background", E.vOff ? "#4a4a60" : "#cfefff"); sty(r.vlogo, "background", E.vOff ? "#6a3040" : "#fff"); sty(r.vend, "background", E.vOff ? "#a84050" : "#e85050");
          if (!E.vOff) L.push({ x: r.vx, y: r.vy, r: 40, i: .6 });
          show(G.save, E.ph === "save"); if (E.ph === "save") { sty(G.save, "left", "494px"); sty(G.save, "top", (r.T0 + r.B - 78) + "px"); }
          show(G.out, E.ph === "out" && E.o >= 1.2);
          if (E.ph === "out") { sty(G.out, "left", "318px"); sty(G.out, "top", (r.T0 + 22) + "px");
            html(G.out, `🕯️ ${X("정전 · 5시간 한도 100%", "Blackout · 5h limit 100%")}<br>${X("리셋까지", "Reset in")} <span class="big">${E.rem != null ? pwHM(E.rem) : "—"}</span>`); }
        }
        /* 기지개 */
        const ss = s && E.stretch(r.fb); show(r.str, !!ss); if (ss) { sty(r.str, "left", "262px"); sty(r.str, "top", (r.T0 + r.B - 86) + "px"); }
        /* 손전등 · 눈 */
        if (s && E.ph === "out") {
          const an = s.f.animal, el = s.a.el, x0 = parseFloat(el.style.left) || 0, y0 = r.T0 + (parseFloat(el.style.top) || 0);
          if ((an === "cat" || an === "bot") && E.o >= .6) {
            const blinkOff = an === "cat" && !E.still && Math.floor(T * 1.3) % 5 === 0;
            pwEyes(BYID[an], { view: "front", seated: 1, eyes: "o", prov: s.f.pk, shiny: s.f.shiny }).forEach(([cx, cy]) => {
              const e = G.eyes[ei++]; if (!e) return;
              sty(e, "left", (x0 + cx * 4) + "px"); sty(e, "top", (y0 + cy * 4) + "px"); show(e, !blinkOff);
              sty(e, "background", an === "cat" ? "#c8ff6a" : "#6af0ff"); sty(e, "boxShadow", `0 0 0 2px ${an === "cat" ? "rgba(200,255,106,.35)" : "rgba(106,240,255,.35)"}`);
            });
            if (an === "bot") L.push({ x: x0 + 60, y: y0 + 28, r: 34, i: .7 });
          }
          if (r.i === torchI && E.o >= 2) {
            const tx = 396, ty = r.T0 + r.B - 46; show(G.torch, true); sty(G.torch, "left", tx + "px"); sty(G.torch, "top", ty + "px");
            L.push({ x: tx + 18, y: ty + 4, r: 190, i: 1.3, cone: .32, dir: -.75, r0: 14 });
          }
        }
      });
      while (ei < G.eyes.length) show(G.eyes[ei++], false);
      if (!(E.ph === "out" && E.o >= 2 && torchI >= 0)) show(G.torch, false);
      /* 정전 순간 번쩍 + 퍽 · 닭 울음 */
      sty(G.flash, "opacity", E.flash ? ".55" : "0"); show(G.pop, E.pop);
      show(G.rooster, E.rooster);
      /* 색조 + 라이트맵 */
      show(G.tint, !!E.tint && E.tint[1] > .005); if (E.tint) { sty(G.tint, "background", E.tint[0]); sty(G.tint, "opacity", E.tint[1].toFixed(3)); }
      G.lm.draw(E.D, L, dk ? "#060414" : "", "");
      /* 어두우면 액터 이름표·말풍선을 라이트맵 위로 */
      const on = E.D >= .2;
      if (on || liftOn) {   // 위치 읽기(레이아웃)는 초당 6번까지만
        if (!on || tc - liftT > .16) { liftT = tc; liftOn = on;
          const all = [...A.actors.values()].flatMap(a => [a].concat(a.babies || [])); if (A.boss) all.push(A.boss);
          const qs = []; all.forEach(a => { const ok = on && a.par !== A.carEl; qs.push(lift(a.tag, ok), lift(a.bub, ok)); }); qs.forEach(liftApply); }
      }
      /* 날씨 캔버스(건물 뒤 하늘): 비·눈일 때만 매 프레임, 그 밖엔 한 번 지움 */
      const [vw, vh] = vwS;
      if (wx.width !== vw || wx.height !== vh) { wx.width = vw; wx.height = vh; wxSig = ""; }
      const wsig = wxOn && E.wk >= 80 ? (E.still ? "s" + E.wk : "a" + T) : "0";
      if (wsig !== wxSig) { wxSig = wsig; pwRain(wx, wxOn ? E.wk : 0, T, E.still, null, 1.5); }   // 건물이 하늘 대부분을 가려서 조금 촘촘히
    },
  };
  return api;
}

/* ---------- 미니 보기(282×162): 지금 보이는 방에 같은 규칙 ---------- */
function powerMini(h) {
  const { doc, win, mk, sty, txt, html, X, cfg } = h;
  const clk = pwClock(), dark = () => !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches);
  const box = (p, x, y, w, hh, bg, css) => mk("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: hh + "px", background: bg }, css || {}));
  const show = (e, on) => sty(e, "display", on ? "block" : "none");
  const FY = 132;
  let E = null;
  const flash = h.vp ? mk("div", "b", h.vp, { left: "0", top: "0", width: "282px", height: "144px", background: "#fff", opacity: "0", zIndex: "85", pointerEvents: "none" }) : null;   // 정전 순간 번쩍
  const sunU = pwDisc(doc, 3, "#ffd23f"), sunU2 = pwDisc(doc, 3, "#ff8a4a"), moonU = pwDisc(doc, 2, "#fff6d0", 1);
  /* 방마다 붙이는 소품(방을 다시 지을 때) */
  function room(R, fb, animal) {
    const p = R.p, P = R.pw = { fb, animal };
    if (R.type === "roof") {
      P.sky = box(p, 0, 0, 282, 144, "transparent", { display: "none" }); p.insertBefore(P.sky, p.children[1] || null);
      P.sun = mk("img", "b", p, { width: "21px", height: "21px", left: "246px", top: "9px" }); P.sun.alt = ""; p.insertBefore(P.sun, P.sky.nextSibling);
      P.moon = mk("img", "b", p, { width: "15px", height: "15px", left: "222px", top: "12px", display: "none" }); P.moon.alt = ""; P.moon.src = moonU; p.insertBefore(P.moon, P.sun.nextSibling);
      P.cw = [];
      [6, 15].forEach(xx => [84, 93, 102].forEach(yy => P.cw.push(box(p, xx, yy, 3, 3, "#ffe27a", { opacity: "0", zIndex: 19 }))));   // 이웃 건물 창(물탱크·엘리베이터 기계실에 가리지 않는 왼쪽 건물만)
      P.rain = mk("canvas", "b pw-rain", p, { left: "0", top: "0", width: "282px", height: (FY - 21) + "px", zIndex: "5" }); P.rain.width = 94; P.rain.height = Math.round((FY - 21) / 3);
      P.snow = [[0, FY - 6, 282, 6], [27, FY - 75, 42, 3], [213, FY - 54, 66, 3], [0, FY - 24, 282, 3]].map(([x, y, w, hh]) => box(p, x, y, w, hh, "#fff", { zIndex: 8, display: "none" }));
      P.dim = box(p, 0, 0, 282, 144, "#0a0820", { zIndex: 17, opacity: "0", pointerEvents: "none", display: "none" });   // 옥상은 바깥이라 라이트맵 대신 고르게 어둡게
      P.tint = box(p, 0, 0, 282, 144, "transparent", { zIndex: 18, mixBlendMode: "multiply", pointerEvents: "none", display: "none" });
      P.rooster = mk("div", "bub", p, { left: "96px", top: "36px", display: "none", zIndex: 30 }, "🐓 " + X("꼬끼오~!", "Cock-a-doodle-doo!"));
      return;
    }
    const boss = R.type === "boss", meet = R.type === "meet";
    /* 창: 하늘·해·달·비 */
    P.win = box(p, 129, 15, 63, 33, "transparent", { zIndex: 2, overflow: "hidden" });
    P.sun = mk("img", "b", P.win, { width: "21px", height: "21px" }); P.sun.alt = "";
    P.moon = mk("img", "b", P.win, { width: "15px", height: "15px", left: "39px", top: "3px", display: "none" }); P.moon.alt = ""; P.moon.src = moonU;
    P.rain = mk("canvas", "b pw-rain", P.win, { left: "0", top: "0", width: "63px", height: "33px" }); P.rain.width = 21; P.rain.height = 11;
    P.lp = box(p, 126, FY - 6, 69, 6, "rgba(255,240,180,.55)", { zIndex: 2, display: "none" });
    /* 조명 */
    const lx = boss ? 117 : 150;
    box(p, lx - 1, 0, 2, 3, "var(--ln)", { zIndex: 7 }); box(p, lx - 9, 3, 18, 6, "#6a5a88", { border: "2px solid var(--ln)", zIndex: 7 });
    P.bulb = box(p, lx - 3, 9, 6, 3, "#8a8098", { zIndex: 7 }); P.lx = lx; P.ly = 14;
    /* 촛불 */
    const cx = boss ? 21 : meet ? 90 : 60, top = meet ? FY - 30 : FY - 30;
    P.cx = cx; P.cy = top - 10;
    P.candle = mk("div", "b", p, { left: (cx - 3) + "px", top: (top - 15) + "px", zIndex: 22, display: "none" });
    box(P.candle, 0, 6, 6, 9, "#fff3d6", { border: "1px solid #2e2040" }); P.flame = box(P.candle, 2, 0, 3, 6, "#ffb03a");
    /* 화면 덮개(꺼짐·화면보호기) · 커피 김 */
    if (R.scr) { P.cover = mk("div", "b", R.scr, { left: "0", top: "0", right: "0", bottom: "0", background: "#0e0b1a", zIndex: 5, display: "none" }); P.saver = box(P.cover, 0, 0, 3, 3, "#ffd23f"); P.scrX = boss ? 100 : 148; }
    if (R.mug) P.steam = [0, 1].map(j => box(p, (boss ? 78 : 126) + j * 3, FY - 60, 1, 6, "rgba(255,255,255,.9)", { zIndex: 13, display: "none" }));
    /* 자판기(사장실) */
    if (boss) {
      P.vend = box(p, 186, FY - 60, 30, 60, "#e85050", { border: "2px solid var(--ln)", zIndex: 4 });
      P.vglass = box(p, 190, FY - 54, 16, 24, "#cfefff", { border: "2px solid #2e2040", zIndex: 4 });
      ["#ffd23f", "#2fbf71", "#ff8fb3"].forEach((c, j) => box(p, 193 + j * 4, FY - 50, 3, 6, c, { zIndex: 4 }));
      P.vlogo = box(p, 190, FY - 26, 16, 3, "#fff", { zIndex: 4 });
    }
    /* 눈·손전등 */
    P.eyes = [0, 1].map(() => box(p, 0, 0, 6, 6, "#c8ff6a", { zIndex: 24, display: "none" }));
    P.torch = mk("div", "b", p, { zIndex: 24, display: "none" }); box(P.torch, 0, 0, 9, 5, "#5a6070", { border: "1px solid #2e2040" }); box(P.torch, 9, 0, 3, 5, "#fff3a8");
    P.tint = box(p, 0, 0, 282, 144, "transparent", { zIndex: 18, mixBlendMode: "multiply", pointerEvents: "none", display: "none" });
    P.lm = pwLightmap(doc, p, 0, 0, 282, 144, 3, 19);
  }
  const api = {
    room,
    read(st, now) { return clk.read(st, now, win.performance.now() / 1000); },
    on: () => !!E && E.ph !== "day",
    dead: () => !!E && E.dead,
    out: () => !!E && E.ph === "out",
    vOff: () => !!E && E.vOff,
    wxIcon: () => cfg().weather && clk.r.wk != null ? pwWxIcon(clk.r.wk) + " " : "",
    /* 상단 바: 게이지 무늬 + 단계 아이콘 */
    hud(Q) {
      const r = clk.r, ph = E ? E.ph : r.ph, gw = Q.gi.parentNode;
      if (!r.has) { sty(Q.pwi, "display", "none"); gw.classList.add("seg"); return; }
      sty(Q.gi, "background", PW_MPAT[ph] + PW_PH[ph][3]);
      gw.classList.toggle("seg", ph === "day");
      sty(Q.pwi, "display", ""); txt(Q.pwi, pwIcon(ph));
      Q.pwi.setAttribute("aria-label", `${X(PW_PH[ph][1], PW_PH[ph][2])} · ${Math.round(r.pct)}%${r.rem != null ? " · " + X("리셋 ", "reset ") + pwHM(r.rem) : ""}`);
    },
    /* 하단 자막: 절전 들어설 때(8초) · 정전 내내(리셋까지) · 리셋 순간만 */
    sub(tc) {
      if (!E) return "";
      if (E.ph === "out") return `🕯️ ${X("정전 · 리셋까지", "Blackout · reset in")} ${E.rem != null ? pwHM(E.rem) : "—"}`;
      if (E.ph === "reset" && E.r < 5) return `🌅 ${X("한도 리셋 · 새 아침!", "Limit reset · new morning!")}`;
      if (E.ph === "save" && E.sv < 8) return `🌙 ${X("절전 · 5시간 한도", "Power save · 5h limit")} ${Math.round(E.pct)}%`;
      return "";
    },
    /* 사장님: 정전 당황(흔들림) · 리셋 만세 */
    boss(T, anim) {
      if (!E) return null;
      if (E.ph === "out" && E.o < 3.5) return { p: { seated: 1, arms: "u", mouth: "o" }, dx: anim ? (Math.floor(T * 12) % 2) * 3 : 0, say: X("정전?! 💦", "Blackout?! 💦") };
      if (E.ph === "out") return { p: { seated: 1, eyes: "o" }, dx: 0, say: "" };
      if (E.ph === "reset" && E.r < 1) return { p: { seated: 1 }, dx: 0, say: "" };
      if (E.ph === "reset" && E.r < 2.8) return { p: { seated: 1, arms: "u", mouth: "o" }, dx: 0, say: E.r < 3 ? X("불 들어왔다!", "Power's back!") : "" };
      return null;
    },
    /* 직원 방: 정전엔 가만히 앉아 있기 · 리셋 때 기지개 */
    staff(R, f) {
      if (!E || !R.pw) return null;
      const fb = R.pw.fb;
      if (E.ph === "out") return { o: { mouth: E.o < 1.4 ? "o" : "", arms: "" }, say: f.animal === "cat" && E.o >= .8 && E.o < 3 ? X("(눈만 반짝)", "(just eyes)") : "" };
      if (E.ph === "reset" && E.stretch(fb)) return { o: { arms: "u", eyes: "c" } };
      return null;
    },
    /* 한 프레임(보이는 방만) */
    frame(rooms, vis, T, anim, A) {
      const dk = dark(), wxOn = !!cfg().weather, tc = win.performance.now() / 1000;
      E = clk.env(tc, T, !anim, dk, wxOn);
      const [st, sb] = pwSky(E.sky, wxOn ? E.gw : 0, dk);
      const k = E.sky <= 30 ? 0 : ease((E.sky - 30) / 52), sunU_ = E.sky > 52 ? sunU2 : sunU;
      if (flash) sty(flash, "opacity", E.ph === "out" && E.o < .3 && anim ? ".55" : "0");   // 8fps라 큰 화면보다 조금 길게
      rooms.forEach(R => {
        const P = R.pw; if (!P || !vis(R)) return;
        if (R.type === "roof") {
          sty(P.sky, "display", E.has ? "block" : "none"); sty(P.sky, "background", `linear-gradient(${st}, ${sb})`);
          if (P.sun.src !== sunU_) P.sun.src = sunU_;
          sty(P.sun, "top", Math.round(lerp(9, 120, k) / 3) * 3 + "px"); sty(P.sun, "opacity", String(clamp(1 - E.gw * 1.4, 0, 1)));
          show(P.moon, E.night > 0); sty(P.moon, "opacity", String(E.night));
          if (E.night > 0 && R.stars) R.stars.forEach((s, i) => sty(s, "opacity", String(E.night * (E.still ? .9 : ((Math.floor(T * 2) + i) % 3 === 0 ? .4 : .9)))));
          P.cw.forEach((w, i) => sty(w, "opacity", E.cityOn && pwH(i) > .35 ? "1" : "0"));
          P.snow.forEach(e => show(e, wxOn && E.wk >= 90));
          show(P.dim, E.D > .01); sty(P.dim, "opacity", (E.D * .6).toFixed(3));
          const ccv = pwKc(PW_CLOUD, E.sky), cl = wxOn && E.wk >= 60 ? pwMix(ccv, "#8a8aa0", clamp((E.wk - 55) / 30, 0, 1) * .7) : ccv;
          if (P._cl !== cl) { P._cl = cl; R.p.style.setProperty("--cloud", cl !== "#ffffff" ? cl : ""); }
          show(P.tint, !!E.tint && E.tint[1] > .005); if (E.tint) { sty(P.tint, "background", E.tint[0]); sty(P.tint, "opacity", (E.tint[1] * .7).toFixed(3)); }
          show(P.rooster, E.rooster);
          const rs = wxOn && E.wk >= 80 ? (E.still ? "s" : "a" + T) : "0"; if (P._rs !== rs) { P._rs = rs; pwRain(P.rain, wxOn ? E.wk : 0, T, E.still, null); }
          return;
        }
        const fb = P.fb, boss = R.type === "boss", half = E.half(fb) && !boss, L = [];
        /* 창 */
        sty(P.win, "background", `linear-gradient(${st}, ${sb})`);
        if (P.sun.src !== sunU_) P.sun.src = sunU_;
        sty(P.sun, "left", Math.round(lerp(30, 6, k) / 3) * 3 + "px"); sty(P.sun, "top", Math.round(lerp(3, 39, k) / 3) * 3 + "px"); sty(P.sun, "opacity", String(clamp(1 - E.gw * 1.4, 0, 1)));
        show(P.moon, E.night > 0); sty(P.moon, "opacity", String(E.night));
        const rs = wxOn && E.wk >= 80 ? (E.still ? "s" : "a" + T) : "0"; if (P._rs !== rs) { P._rs = rs; pwRain(P.rain, wxOn ? E.wk : 0, T * .35, E.still, null); }
        const Lk = E.sky < 40 ? 0 : E.sky < 78 ? ease((E.sky - 40) / 38) : 0, lpOn = E.sky < 78 && E.D < .5;
        show(P.lp, lpOn); if (lpOn) { const hh = Lk > .5 ? 3 : 6; sty(P.lp, "width", Math.round((69 + Lk * 54) / 3) * 3 + "px"); sty(P.lp, "left", Math.round((126 - Lk * 45) / 3) * 3 + "px"); sty(P.lp, "height", hh + "px"); sty(P.lp, "top", (FY - hh) + "px"); sty(P.lp, "background", E.sky < 50 ? "rgba(255,240,180,.55)" : "rgba(255,170,100,.5)"); }
        /* 조명 */
        const lv = E.lit(fb, half);
        sty(P.bulb, "background", lv > 0 ? "#fff3a8" : "#8a8098"); sty(P.bulb, "zIndex", lv > 0 ? "23" : "7");
        if (lv > 0) L.push({ x: P.lx, y: P.ly, r: 100, i: 1.1 * lv });
        /* 화면 */
        const occupied = boss || (R.type === "staff" && A.home(R));
        const m = E.mon(fb, half);
        if (P.cover) {
          const on = occupied && m !== "code"; show(P.cover, on);
          if (on) { show(P.saver, m === "saver"); if (m === "saver") { const u = E.still ? 20 : T * 20; sty(P.saver, "left", Math.round(Math.abs((u % 66) - 33) / 3) * 3 + "px"); sty(P.saver, "top", Math.round(Math.abs(((u * .7) % 66) - 33) / 3) * 3 + "px"); } }
          if (occupied && m !== "off") L.push({ x: P.scrX, y: FY - 54, r: 30, i: .8 });
        }
        if (P.steam) P.steam.forEach((e, j) => show(e, occupied && j < E.steam));
        /* 촛불(고양이는 눈만) */
        const candle = (occupied || R.type === "meet" && A.meetBusy()) && P.animal !== "cat" && E.candle(fb, fb);
        show(P.candle, candle);
        if (candle) { const f = E.flick(fb + 2); sty(P.flame, "height", (f > .9 ? 6 : 4) + "px"); sty(P.flame, "top", (f > .9 ? 0 : 2) + "px"); L.push({ x: P.cx, y: P.cy, r: 48, i: f }); }
        /* 자판기 */
        if (P.vend) { sty(P.vglass, "background", E.vOff ? "#4a4a60" : "#cfefff"); sty(P.vend, "background", E.vOff ? "#a84050" : "#e85050"); sty(P.vlogo, "background", E.vOff ? "#6a3040" : "#fff"); if (!E.vOff) L.push({ x: 201, y: FY - 42, r: 26, i: .6 }); }
        /* 고양이·로봇 눈 · 펭귄 손전등 */
        let ei = 0;
        if (R.type === "staff" && occupied && E.ph === "out" && R.actor && R.actor.style.display !== "none") {
          const an = P.animal, x0 = parseFloat(R.actor.style.left) || 0, y0 = parseFloat(R.actor.style.top) || 0;
          if ((an === "cat" || an === "bot") && E.o >= .6) {
            const off = an === "cat" && !E.still && Math.floor(T * 1.3) % 5 === 0;
            pwEyes(BYID[an], { trim: 1, seated: 1 }).forEach(([cx, cy]) => { const e = P.eyes[ei++]; if (!e) return; sty(e, "left", (x0 + cx * 3) + "px"); sty(e, "top", (y0 + cy * 3) + "px"); show(e, !off); sty(e, "background", an === "cat" ? "#c8ff6a" : "#6af0ff"); });
            if (an === "bot") L.push({ x: x0 + 24, y: y0 + 21, r: 26, i: .7 });
          }
          const torch = an === "peng" && E.o >= 2; show(P.torch, torch);
          if (torch) { const tx = R.x + 6, ty = FY - 39; sty(P.torch, "left", tx + "px"); sty(P.torch, "top", ty + "px"); L.push({ x: tx + 11, y: ty + 2, r: 120, i: 1.3, cone: .34, dir: -.6, r0: 9 }); }
        } else show(P.torch, false);
        while (ei < P.eyes.length) show(P.eyes[ei++], false);
        show(P.tint, !!E.tint && E.tint[1] > .005); if (E.tint) { sty(P.tint, "background", E.tint[0]); sty(P.tint, "opacity", E.tint[1].toFixed(3)); }
        P.lm.draw(E.D, L, dk ? "#060414" : "", "");
      });
    },
  };
  return api;
}

/* ================= 미니 보기 (작은 창: 앱 위젯 창 · 브라우저 Document PiP) =================
   메인 문서가 아닌 곳(ctx.isMain === false)에 올라가면 건물 전체 대신 282×162, 3× 도트의 "로비 카메라"를 그린다.
   세계 = 방을 세로로 쌓은 기둥(옥상 · 직원 층(3F~) · 2F 회의실 · 1F 사장실, 방마다 282×144). 카메라 = 기둥의 세로 위치 하나(줌 없음, 정수 배율 유지).
   평소엔 사장실. 이벤트가 나면 그 장소로 가서 담고, 끝나면 사장실로 돌아온다. 우선순위 질문 > 완료 > 출동, 샷마다 최소 체류.
   - 질문: 그 층 클로즈업 + 하단 자막. 7초 넘으면 사장실(대기 시간)과 번갈아. 해결되면 기뻐하는 컷 후 복귀. 직원은 내려오지 않음
   - 완료: 평소엔 사장실에서 바로 보고(직원이 엘리베이터로 내려와 보고 + 사장님 끄덕임)
     큰 완료(실행 BIG_DONE_SEC 이상): 그 층 → 옥상 폭죽 → 사장실(보고 + 사장님 박수)
   - 출동(서브에이전트): 엘리베이터를 따라가는 샷 → 2F 회의실
   전환은 ctx.store "lobbyCam": cut(기본, 0.36초 아이리스 · 출동만 따라가는 팬) | pan(모든 이동을 세로 팬, 멀면 중간 층 건너뜀).
   회의 모드·움직임 줄이기·창 숨김이면 정적(상태만, 효과 없는 컷). 층 번호는 로비 기준(회의실이 2F라 직원은 3F부터, 오래된 세션이 아래).
   둘러보기(사용자가 직접 층 이동): 휠·트랙패드 세로 스크롤(한 번에 한 층) · 호버 ▲▼ · 키보드 ↑↓(Esc = 자동으로) · 상단 바 상태 점 · "다음" 칩.
   마지막 조작 후 LOOK_SEC 동안은 자동 카메라를 멈춘다(질문·완료는 "다음" 칩에 층과 함께 쌓임). 조작이 없으면 자동 카메라로 돌아가 밀린 이벤트를 처리. */
function mountLobby(root, ctx) {
  const doc = ctx.doc, win = ctx.win, $ = s => root.querySelector(s);
  const en = () => ctx.lang === "en", X = (ko, enS) => en() ? enS : ko;
  const aName = id => NAME[id][en() ? 1 : 0];
  const clockT = () => win.performance.now() / 1000;
  const U = 3, W = 282, H = 162, HH = 18, RH = 144, FY = RH - 12, EX = 246, TX = 177;
  const isWin = win.top === win;   // 독립 창(앱 위젯·PiP): 창 크기를 장면에 맞추고 닫기 버튼을 둔다
  const mk = (tag, cls, p, css, h) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); if (h != null) e.innerHTML = h; if (p) p.appendChild(e); return e; };
  const sty = (e, k, v) => { const c = e._s || (e._s = {}); if (c[k] !== v) { c[k] = v; e.style[k] = v; } };
  const txt = (e, v) => { if (e._t !== v) { e._t = v; e.textContent = v; } };
  const html = (e, v) => { if (e._h !== v) { e._h = v; e.innerHTML = v; } };
  const box = (p, x, y, w, h, bg, css) => mk("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: h + "px", background: bg }, css || {}));
  const bx = (p, x, y, w, h, bg, bw, css) => box(p, x, y, w, h, bg, Object.assign({ border: (bw || 3) + "px solid var(--ln)" }, css || {}));
  const sn = v => Math.round(v / U) * U;   // 도트 1칸(3px) 격자
  const ease5 = k => { k = clamp(k, 0, 1); return k * k * k * (k * (k * 6 - 15) + 10); };
  const mss = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b; };   // 받침 있으면 a
  /* 동물 배정은 메인 스튜디오와 같은 설정(ctx.store "cfg")·같은 해시. 메인 창에서 바꾸면 다음 sync에 반영 */
  let cfg, pool, cfgRaw = null;
  function readCfg() {
    const raw = ctx.store.get("cfg", "") || "";
    if (raw === cfgRaw) return;
    cfgRaw = raw; cfg = { animals: SP.slice(), fixed: null };
    try { const j = JSON.parse(raw || "null"); if (j && typeof j === "object") cfg = Object.assign(cfg, j); } catch {}
    pool = Array.isArray(cfg.animals) ? cfg.animals.filter(a => SP.includes(a)) : [];
  }
  readCfg();
  const animalOf = sid => ({ id: cfg.fixed && SP.includes(cfg.fixed) ? cfg.fixed : (pool.length ? pool : SP)[fnv(sid) % (pool.length || SP.length)], shiny: fnv(sid + "*") % 64 === 0 });
  const camPref = () => ctx.store.get("lobbyCam", "cut") === "pan" ? "pan" : "cut";

  /* ---------- 틀: 상단 바 · 뷰포트(세계) · 자막 · 다음 칩 · 버튼 ---------- */
  if (isWin) doc.documentElement.classList.add("stu-lobby");
  root.innerHTML = `<div class="slb"><div class="lw"></div></div>`;
  ctx.switcher.hidden = true; root.append(ctx.switcher);   // 추가 창: 모드 전환은 메인 창에서
  const slb = $(".slb"), lw = $(".lw");
  sty(lw, "width", W + "px"); sty(lw, "height", H + "px");
  const hud = mk("div", "hud", lw, { height: HH + "px" }, `<span>⚡</span><div class="gauge seg"><i></i><u></u></div><b class="gp"></b><span class="pwi"></span><span class="dots"></span><b class="wk"></b><span class="fill"></span><b class="pk-egg"></b><span class="chip bn" hidden></span><span class="chip askc blink" hidden></span>`);
  const HQ = { gi: hud.querySelector(".gauge i"), gu: hud.querySelector(".gauge u"), gp: hud.querySelector(".gp"), pwi: hud.querySelector(".pwi"), dots: hud.querySelector(".dots"), wk: hud.querySelector(".wk"), egg: hud.querySelector(".pk-egg"), bn: hud.querySelector(".bn"), askc: hud.querySelector(".askc") };
  const vp = mk("div", "b vp", lw, { left: "0", top: HH + "px", width: W + "px", height: RH + "px" });
  const world = mk("div", "b world", vp, { left: "0", top: "0", width: W + "px" });
  const iris = mk("div", "iris", vp, { display: "none" });
  const nextEl = mk("span", "chip next", lw); nextEl.hidden = true;
  const subEl = mk("div", "sub", lw, { display: "none" });
  const pwM = powerMini({ doc, win, mk, sty, txt, html, X, cfg: () => cfg, vp });   // 전력·날씨
  let bossNow = "work";
  const pkM = pokeMini({ ctx, doc, win, mk, sty, html, X, cfg: () => cfg, clockT, model: () => model, aName, kick: () => kick(), world: () => world, vOff: () => pwM.vOff(),   // 👆 클릭 반응
    home: R => { const f = model.bySid.get(R.key); return !!f && !(V && V.info.sid === f.sid && !["fetch", "home"].includes(V.ph)); }, bossState: () => bossNow, carBusy: () => !!D || !!V,
    resetIn: () => { const l = C.limits(ctx.state, ctx.now()).five; return l && l.reset ? Math.max(0, l.reset - ctx.now()) : null; }, actorOf: R => R.actor });
  const drM = dayrepMini({ ctx, mk, sty, txt, X, lw, clockT });   // 📋 퇴근 일보 알림 줄(누르면 큰 화면 카드)
  const dcM = decorMini({ ctx, win, mk, sty, html, X, aName, josa: (w, a, b) => josa(w, a, b), hide: () => !!cfg.hideText });   // 🎨 층 소품 · 택배 자막(저장은 읽기만)
  /* 앱 위젯 = 미니 보기: ⤢ 크게 보기(위젯 닫고 큰 창 복귀). 닫기도 같은 동작이라 ✕는 두지 않는다. 브라우저 PiP는 ✕(닫으면 탭으로) */
  const bigBtn = ctx.api.showMain ? `<button type="button" data-act="big" aria-label="${X("크게 보기", "Full window")}">⤢</button>` : "";
  const xBtn = isWin && !bigBtn ? `<button type="button" data-act="close" aria-label="${X("닫기", "Close")}">✕</button>` : "";
  const ctl = mk("div", "ctl", lw, null, `<button type="button" data-act="cam" class="cam"></button><button type="button" data-act="quiet"></button>${bigBtn}${xBtn}`);
  const qb = ctl.querySelector('[data-act="quiet"]'), cb = ctl.querySelector('[data-act="cam"]');
  /* 둘러보기 ▲▼: 오른쪽 가장자리 세로 한 쌍(위 = 다음 칩, 아래 = 호버 버튼 줄 사이) */
  const nav = mk("div", "nav", lw, null, `<button type="button" data-act="up">▲</button><button type="button" data-act="down">▼</button>`);
  const nU = nav.firstChild, nD = nav.lastChild;
  nextEl.dataset.act = "next";

  const actor = (p, z) => { const e = mk("div", "act", p, { zIndex: String(z || 8) }), i = mk("img", "", e); i.alt = ""; i.draggable = false; e.im = i; e.k = ""; e.style.display = "none"; return e; };
  /* 캐릭터는 늘 앞모습(좌우 반전 없음) */
  function show(a, s, x, yb, o = {}) {
    if (a.k !== s.url) { a.k = s.url; a.im.src = s.url; a.im.style.width = s.w + "px"; a.im.style.height = s.h + "px"; }
    sty(a, "display", "block");
    sty(a, "left", sn(x - s.w / 2) + "px"); sty(a, "top", Math.round(yb - s.h + (o.dy || 0)) + "px");
    sty(a.im, "transform", o.rot ? `rotate(${o.rot}deg)` : "none");
    if (o.z != null) sty(a, "zIndex", String(o.z));
    if (o.op != null) sty(a, "opacity", String(o.op));
  }
  const hide = a => sty(a, "display", "none");
  const sprOf = (v, o, sc) => sprite(doc, BYID[v.animal], Object.assign({ trim: 1, prov: v.pk, shiny: v.shiny }, o), sc || U);
  const bossSpr = o => sprite(doc, BOSS, Object.assign({ trim: 1, boss: 1 }, o), U);
  function bubble(e, h, x, y, tx) { sty(e, "display", "block"); html(e, h); sty(e, "left", x + "px"); sty(e, "top", y + "px"); if (e._tx !== tx) { e._tx = tx; e.style.setProperty("--tx", tx + "px"); } }

  /* ---------- 데이터 → 모델 ---------- */
  const KCOL = { work: "#4fc86a", agents: "#5aa8ff", ask: "#ffc83a", stall: "#e0605a", done: "#ff6b8a", idle: "#9a8cb0" };
  let model = { floors: [], dotSids: [], staff: [], bySid: new Map(), askers: [], askSet: new Set(), working: 0, waiting: 0, stall: 0, five: { used: null } };
  const prevRaw = new Map(), prevAg = new Map(), firstSeen = new Map();
  let firstSync = true;
  const launches = [], dispatches = [], reports = [];   // 카메라가 아직 담지 않은 완료·출동, 1층으로 내려올 완료 보고
  let lastReport = null, meetSid = null;
  const wbT = WB.tracker(), aiT = WB.aiTracker();
  function infoOf(s, st, kind) {
    const an = animalOf(s.sid), pid = C.provider(st, s), sub = C.can(st, s, "subagents"), rp = repOf(s);
    return { sid: s.sid, kind, animal: an.id, shiny: an.shiny, pk: provKey(pid.id), pname: pid.name, floor: 0,
      project: s.project || "", note: s.note || "", guess: s.confidence === "guess", run: s.run || 0, since: s.since || 0, s, mux: muxOf(s),
      step: stepOf(s), title: rp && rp.title || "", cheer: rp && rp.big && rp.cheer || "", aib: aibOn(s, kind, ctx.now()),   // ✍️ MCP 보고
      ag: sub ? (s.agents || []).filter(a => a.status === "running") : [], agAll: sub ? s.agents || [] : [] };
  }
  function sync() {
    const st = ctx.state; if (!st) return;
    readCfg();
    const now = ctx.now(), tc = clockT();
    pwM.read(st, now); dcM.read(tc);
    const list = st.sessions.map(s => {
      const status = C.sessionStatus(s, now), stall = !!(s.health && s.health.level === "stall");
      const kind = status === "needs_input" ? "ask" : stall ? "stall" : status === "working" ? "work" : status === "agents" ? "agents" : status === "done" ? "done" : "idle";
      return { s, kind, rank: { ask: 0, stall: 1, work: 2, agents: 2, done: 3, idle: 4 }[kind] };
    });
    list.sort((a, b) => a.rank - b.rank || (a.kind === "ask" ? a.s.since - b.s.since : 0) || (a.s.sid < b.s.sid ? -1 : a.s.sid > b.s.sid ? 1 : 0));   // 메인 스튜디오와 같은 기준으로 6명 고름
    const top = list.slice(0, MAXF);
    list.forEach(f => { if (!firstSeen.has(f.s.sid)) firstSeen.set(f.s.sid, f.s.started || now); });
    /* 로비의 층은 상태가 바뀌어도 자리를 옮기지 않게: 먼저 출근한 순서(아래부터 3F) */
    const staff = top.map(f => infoOf(f.s, st, f.kind)).sort((a, b) => (firstSeen.get(a.sid) - firstSeen.get(b.sid)) || (a.sid < b.sid ? -1 : 1));
    staff.forEach((f, i) => { f.floor = i + 3; });
    const bySid = new Map(staff.map(f => [f.sid, f]));
    const askers = staff.filter(f => f.kind === "ask").sort((a, b) => a.since - b.since);
    for (const f of list) {
      const sid = f.s.sid, raw = f.s.status, prev = prevRaw.get(sid), inf = bySid.get(sid);
      if (!firstSync && prev !== undefined && prev !== raw && raw === "done" && inf) { launches.push({ info: inf, at: tc, big: bigOf(f.s) }); if (launches.length > 3) launches.shift(); }
      prevRaw.set(sid, raw);
      const n = inf ? inf.ag.length : 0, pn = prevAg.get(sid);
      if (!firstSync && inf && pn !== undefined && n > pn && !dispatches.some(d => d.sid === sid) && !(D && D.sid === sid)) dispatches.push({ sid, n: Math.min(3, n), at: tc });
      prevAg.set(sid, n);
    }
    if (prevRaw.size > 120) [...prevRaw.keys()].slice(0, 40).forEach(k => { prevRaw.delete(k); prevAg.delete(k); firstSeen.delete(k); });
    const aiFirst0 = firstSync;
    firstSync = false;
    model = { floors: top.map(f => f.kind), dotSids: top.map(f => f.s.sid), staff, bySid, askers, askSet: new Set(askers.map(a => a.sid)), working: list.filter(f => f.kind === "work" || f.kind === "agents").length,
      waiting: list.filter(f => f.kind === "ask").length, stall: list.filter(f => f.kind === "stall").length, five: C.limits(st, now).five };
    staff.forEach(f => wbT.update(f.sid, f.agAll, tc, firstSync, f.animal)); wbT.sweep(tc);   // 🧑‍🏫 2F 회의실 보드 팀
    staff.forEach(f => aiT.update(f.sid, f.aib ? boardOf(f.s) : null, tc, aiFirst0)); aiT.sweep(new Set(staff.map(f => f.sid)));   // ✍️ 그 층 벽 보드
    const sig = staff.map(f => f.sid + f.animal + f.pk + (f.shiny ? "*" : "") + f.project + (f.aib ? "w" : "")).join(",") + "|" + ctx.lang + (cfg.hideText ? "|h" : "") + "|" + dcM.sig();
    if (sig !== buildSig) { buildSig = sig; build(); }
    renderHud();
    if (!animOn()) draw(0, false);
  }
  function renderHud() {
    const lc = model.five, ok = lc && lc.used != null;
    sty(HQ.gi, "width", ok ? clamp(lc.used, 0, 100) + "%" : "0%");
    sty(HQ.gi, "background", !ok ? "#4fc86a" : lc.over || lc.low ? "#ff5a5a" : lc.pace != null && lc.used > lc.pace ? "#ffc83a" : "#4fc86a");
    sty(HQ.gu, "display", ok && lc.pace != null ? "block" : "none"); if (ok && lc.pace != null) sty(HQ.gu, "left", clamp(lc.pace, 0, 100) + "%");
    txt(HQ.gp, ok ? Math.round(lc.used) + "%" : "—");
    pwM.hud(HQ);
    const ks = model.floors.slice(0, 5);
    while (HQ.dots.children.length < ks.length) mk("i", "dot", HQ.dots);
    while (HQ.dots.children.length > ks.length) HQ.dots.lastChild.remove();
    ks.forEach((k, i) => { const d = HQ.dots.children[i]; sty(d, "background", KCOL[k]); const c = "dot" + (k === "ask" ? " blink" : ""); if (d.className !== c) d.className = c;
      const f = model.bySid.get(model.dotSids[i]); d.dataset.act = "dot"; d.dataset.sid = model.dotSids[i];   // data-act: 누르면 그 층으로(창 드래그 대상에서 빠짐)
      const tt = f ? `${f.floor}F ${EMO[f.animal]} ${f.project} · ${stLabel(f)} — ${X("눌러서 보기", "click to view")}` : ""; if (d.getAttribute("aria-label") !== tt) d.setAttribute("aria-label", tt); });
    txt(HQ.wk, pwM.wxIcon() + X(`작업 ${model.working}`, `Busy ${model.working}`));
    const eg = pkM.eggN(); txt(HQ.egg, eg && !model.waiting && !model.stall ? "🥚" + eg + "/8" : ""); HQ.egg.setAttribute("aria-label", X(`이스터에그 ${eg}/8`, `Easter eggs ${eg}/8`));   // 상단 바가 좁아서 대기·멈춤 칩이 있으면 숨김
    HQ.bn.hidden = !model.stall; txt(HQ.bn, "💤 " + model.stall);
    HQ.askc.hidden = !model.waiting; txt(HQ.askc, X(`❓ 대기 ${model.waiting}`, `❓ Wait ${model.waiting}`));
    const q = !!ctx.settings.quiet;
    txt(qb, q ? "🔇" : "🪑"); qb.classList.toggle("on", q);
    qb.setAttribute("aria-label", q ? X("회의 모드 끄기 (움직임 켜기)", "Quiet mode off (motion on)") : X("회의 모드: 움직임 없이 상태만", "Quiet mode: status only, no motion"));
    const pan = camPref() === "pan";
    txt(cb, pan ? X("🎥팬", "🎥Pan") : X("🎥컷", "🎥Cut"));
    const nt = X("(휠·↑↓ · 10초 뒤 자동 카메라)", "(wheel·↑↓ · auto camera after 10s)");
    nU.setAttribute("aria-label", X("위층 보기", "Floor up")); nD.setAttribute("aria-label", X("아래층 보기", "Floor down"));
    cb.setAttribute("aria-label", (pan ? X("카메라: 팬 — 층 사이를 세로로 이동 (누르면 컷)", "Camera: pan — glide between floors (click for cut)") : X("카메라: 컷 — 툭 바뀌고 출동만 따라감 (누르면 팬)", "Camera: cut — quick cuts, follows only dispatches (click for pan)"))
      + (animOn() ? "" : X(" · 지금은 정적이라 효과 없음", " · static now, no effect")));
  }

  /* ---------- 세계(방 기둥) 짓기: 층 구성이 바뀔 때만 ---------- */
  let buildSig = null, rooms = [], NR = 0, keyIdx = new Map(), car, dl, dr, babies = [];
  const RT = r => r * RH;
  const yOfRoom = r => RT(r) + FY - 78;   // 그 방에 선 엘리베이터 카의 월드 y
  const idxOf = key => key === "roof" ? 0 : key === "meet" ? NR - 2 : key === "boss" ? NR - 1 : keyIdx.has(key) ? keyIdx.get(key) : NR - 1;
  const floorOfIdx = r => NR - r;   // 1F = 맨 아래
  function wallRoom(R) {
    const p = R.p;
    box(p, 0, 0, 219, FY, `linear-gradient(var(--wall) 0 ${FY - 36}px,var(--wallLo) ${FY - 36}px)`); box(p, 273, 0, 9, FY, `linear-gradient(var(--wall) 0 ${FY - 36}px,var(--wallLo) ${FY - 36}px)`);
    for (let x = 0; x < 219; x += 60) box(p, x, 0, 3, FY - 36, "var(--shade)");
    box(p, 0, FY, W, 12, "var(--slab)", { borderTop: "3px solid var(--ln)", zIndex: 7 });
    bx(p, 219, FY - 81, 54, 81, "transparent", 3, { zIndex: 7, pointerEvents: "none" });
    R.lamp = bx(p, 231, FY - 102, 30, 18, "#2e2040", 3, { zIndex: 7, color: "#7dff9c", textAlign: "center", lineHeight: "12px", whiteSpace: "nowrap" });
    R.tag = mk("span", "chip rtag", p); R.info = mk("span", "rinfo", p, { display: "none" });
    R.bub = mk("div", "bub", p, { display: "none" });
  }
  function desk(R, DX, hc) {
    const p = R.p;
    R.winEl = bx(p, 126, 12, 69, 39, "var(--glass)", 3, { zIndex: 2 }); box(p, 159, 12, 3, 39, "var(--ln)", { zIndex: 3 }); box(p, 132, 18, 15, 6, "rgba(255,255,255,.75)", { zIndex: 3 });
    R.monEl = bx(p, 78 + DX, FY - 78, 45, 48, "#2e2a40", 3, { zIndex: 8 }); box(p, 96 + DX, FY - 30, 9, 6, "var(--ln)", { zIndex: 8 });
    R.scr = box(p, 81 + DX, FY - 75, 39, 39, "var(--mon)", { zIndex: 9, overflow: "hidden" }); R.lns = [0, 1, 2, 3, 4].map(k => box(R.scr, 3, 3 + k * 6, 18, 3, "#7dff9c"));
    bx(p, 9 + DX, FY - 30, 114, 9, "var(--deskTop)", 3, { zIndex: 9 }); bx(p, 12 + DX, FY - 21, 108, 21, "var(--desk)", 3, { zIndex: 9 });
    box(p, 24 + DX, FY - 33, 42, 3, "#3a3a52", { border: "1px solid #1e1830", zIndex: 11 });
    R.hands = [0, 1].map(k => box(p, 24 + DX + k * 27, FY - 33, 15, 9, hc, { border: "3px solid var(--ln)", zIndex: 12 }));
    bx(p, 18 + DX, FY - 60, 54, 39, "var(--chair)", 3, { zIndex: 4 });
    R.mug = mk("div", "b emo", p, { left: (72 + DX) + "px", top: (FY - 52) + "px", fontSize: "18px", zIndex: 13 }, "☕");
    R.x = 45 + DX; R.actor = actor(p, 8);
    R.spk = [0, 1, 2].map(() => mk("i", "spk", p, { zIndex: 31, display: "none" }, "✦"));
  }
  function staffRoom(R, f) {   // 직원 책상은 가운데(말풍선 꼬리가 창 안에 들어오게)
    const p = R.p, v = fnv(f.sid) % 3;
    wallRoom(R); desk(R, 48, BYID[f.animal].hands.c);
    R.plantEl = mk("div", "b emo", p, { left: "180px", top: (FY - 45) + "px", fontSize: "27px", zIndex: 5 }, ["🪴", "🌵", "🌿"][v]);
    if (dcM.noPlant(f)) { R.noPlant = 1; R.plantEl.style.display = "none"; }   // 🎨 바닥 2 소품이 화분 자리를 씀
    dcM.room(R);
    if (v === 0) { R.shelfEl = bx(p, 6, FY - 96, 45, 96, "#a9744c", 3, { zIndex: 3 }); R.books = []; [0, 1, 2].forEach(q => { box(p, 9, FY - 90 + q * 30, 39, 3, "var(--ln)", { zIndex: 4 }); for (let i = 0; i < 4; i++) R.books.push(box(p, 12 + i * 9, FY - 84 + q * 30, 6, 18, ["#ff6b8a", "#5aa8ff", "#ffd23f", "#6adf8a"][(i + q) % 4], { zIndex: 4 })); }); }
    if (v === 1) { R.shelfEl = bx(p, 6, FY - 96, 42, 96, "#5a5a78", 3, { zIndex: 3 }); R.leds = [0, 1, 2, 3].map(q => { box(p, 12, FY - 87 + q * 21, 30, 12, "#2e2a40", { zIndex: 4 }); return box(p, 15, FY - 84 + q * 21, 6, 3, q % 2 ? "#7dff9c" : "#ffd23f", { zIndex: 5 }); }); }
    if (v === 2) { R.shelfEl = mk("div", "b emo", p, { left: "9px", top: (FY - 36) + "px", fontSize: "30px", zIndex: 5 }, "📦"); bx(p, 6, 30, 45, 30, "#fff", 3, { zIndex: 3 }); ["#ff6b8a", "#5aa8ff", "#6adf8a"].forEach((cl, k) => box(p, 12, 36 + k * 6, [27, 18, 24][k], 3, cl, { zIndex: 4 })); }
    R.tag.style.background = PROV[f.pk].tag; txt(R.tag, `${f.shiny ? "✨" : ""}${EMO[f.animal]} ${f.floor}F · ${cfg.hideText ? "🤫" : cut(f.project, 14)}`);
    if (ctx.api.openTerminal) { R.tag.dataset.act = "jump"; R.tag.dataset.sid = f.sid; }   // 🖥️ 이름표 칩을 누르면 그 세션으로(일하는 중에도). 하단 자막에 "🖥️ Orca로 이동" 등
    /* ✍️ 단계 칩(이름표 옆 "3/5" — 마우스를 올리면 하단 자막에 AI가 쓴 제목) · AI 보드(창 자리, 이름표 아래) */
    R.stp = mk("span", "chip rstp", p, { display: "none" }); R.stp.dataset.act = "step"; R.stp.dataset.sid = f.sid;
    if (f.aib) {
      R.aiB = bx(p, 54, 18, 159, 46, "var(--wb)", 3, { zIndex: 6 });   // 모니터(z8)가 보드 아래 오른쪽을 살짝 가림 = 앞에 놓인 느낌
      R.aiW = mk("div", "b wbx", p, { left: "57px", top: "21px", width: "153px", height: "40px", zIndex: 7, overflow: "hidden" });
      R.aiTag = mk("div", "b aiw", p, { left: "58px", top: "59px", zIndex: 8 }, "✍️ AI");   // 보드 아래 테두리에 붙인 딱지(오른쪽 위는 "다음" 칩 자리)
    }
  }
  function meetRoom(R) {   // 🧑‍🏫 큰 화이트보드 · 테이블 · 의자(앉을 때만) · 도넛 상자 — 그리기는 drawMeet
    const p = R.p; wallRoom(R);
    R.wbEl = bx(p, 6, 6, 207, 72, "var(--wb)", 3, { zIndex: 2 }); box(p, 9, 75, 201, 3, "#b8c4d4", { zIndex: 3 });
    R.wb = mk("div", "b wbx", p, { left: "9px", top: "9px", width: "201px", height: "66px", zIndex: 4, overflow: "hidden" });
    bx(p, 72, FY - 30, 141, 9, "var(--deskTop)", 3, { zIndex: 9 }); bx(p, 78, FY - 21, 129, 21, "var(--desk)", 3, { zIndex: 9 });
    R.plantEl = mk("div", "b emo", p, { left: "24px", top: (FY - 45) + "px", fontSize: "27px", zIndex: 5 }, "🪴");
    R.mugEl = mk("div", "b emo", p, { left: "80px", top: (FY - 42) + "px", fontSize: "12px", zIndex: 10 }, "☕");
    R.dbox = mk("div", "b", p, { left: "186px", top: (FY - 36) + "px", zIndex: 10 });
    R.seat = [0, 1, 2, 3].map(() => { const d = mk("img", "b", p, { zIndex: 11, display: "none" }); d.alt = ""; return { a: actor(p, 5), ch: bx(p, 0, FY - 48, 30, 24, "var(--chair)", 3, { zIndex: 3, display: "none" }), d }; });
    R.yawn = mk("div", "b", p, { display: "none", zIndex: 30, fontSize: "12px", color: "#6a5a88" }, X("하암", "yawn"));
    R.dood = mk("div", "b", p, { zIndex: 5, display: "none" });
    R.tag.style.background = "#3a6fc8"; txt(R.tag, X("📋 2F · 회의실", "📋 2F · Meeting"));
  }
  function bossRoom(R) {   // 1F 사장실 (예전 미니 보기 그대로)
    const p = R.p; wallRoom(R); desk(R, 0, "#b87a4a");
    box(p, 111, FY - 6, 108, 6, "var(--rug)", { opacity: .55, zIndex: 2 });
    R.plantEl = mk("div", "b emo", p, { left: "126px", top: (FY - 45) + "px", fontSize: "27px", zIndex: 5 }, "🪴");
    R.z = [0, 1, 2].map(() => mk("div", "z", p, { display: "none", zIndex: 25 }, "Z"));
    R.nod = mk("div", "b emo", p, { left: "57px", top: (FY - 81) + "px", fontSize: "15px", zIndex: 25, display: "none" }, "👍");
    R.vis = actor(p, 20); R.vbub = mk("div", "bub", p, { display: "none", zIndex: 30 });
    R.cf = [...Array(18)].map((_, i) => box(p, 0, 0, 6, 6, ["#ff6b8a", "#ffd23f", "#5aa8ff", "#6adf8a", "#b48aff"][i % 5], { zIndex: 40, display: "none" }));
    R.paper = box(p, 63, FY - 70, 12, 15, "#fff", { zIndex: 9, border: "2px solid #2e2040", display: "none" }); [0, 1, 2].forEach(k => box(R.paper, 2, 2 + k * 3, 6, 1, "#7a6a8a"));   // 📋 일보 종이
    R.tag.style.background = "#34457f"; txt(R.tag, X("🐹 사장실 · 1F", "🐹 Boss · 1F"));
  }
  function roofRoom(R) {
    const p = R.p;
    box(p, 0, 0, W, RH, "linear-gradient(var(--sky) 0,var(--sky2) 100%)");
    R.stars = [...Array(14)].map((_, k) => box(p, (k * 97) % 279, (k * 37) % 84, 3, 3, "#fff", { opacity: "0" }));
    [[18, 24, 48], [186, 15, 60], [120, 42, 33]].forEach(([x, y, w]) => { box(p, x, y, w, 9, "var(--cloud)"); box(p, x + 9, y - 6, w - 18, 6, "var(--cloud)"); });
    [[0, 78, 33, 54], [36, 93, 24, 39], [246, 84, 36, 48], [210, 99, 30, 33]].forEach(([x, y, w, hh]) => box(p, x, y, w, hh, "var(--city)"));
    box(p, 0, FY, W, 12, "var(--roof)", { borderTop: "3px solid var(--ln)", zIndex: 7 });
    box(p, 0, FY - 21, W, 3, "var(--ln)", { zIndex: 6 }); for (let x = 0; x < W; x += 18) box(p, x, FY - 21, 3, 21, "var(--ln)", { zIndex: 6 });
    bx(p, 24, FY - 63, 48, 42, "#9fb4c8", 3, { zIndex: 5 }); box(p, 30, FY - 72, 36, 12, "#7d93ab", { border: "3px solid var(--ln)", zIndex: 5 });
    bx(p, 213, FY - 51, 66, 51, "#c9b8a0", 3, { zIndex: 5 }); mk("div", "b emo", p, { left: "234px", top: (FY - 42) + "px", fontSize: "18px", zIndex: 6 }, "🛗");
    box(p, 186, FY - 90, 3, 90, "var(--ln)", { zIndex: 5 }); R.flag = box(p, 189, FY - 90, 24, 15, "#ff6b8a", { border: "3px solid var(--ln)", zIndex: 5 });
    R.tubes = [0, 1, 2].map(k => bx(p, 96 + k * 30, FY - 39, 12, 18, "#ff6b8a", 3, { zIndex: 5 }));
    R.tag = mk("span", "chip rtag", p, { background: "#c0567a" }); txt(R.tag, X("🏢 옥상", "🏢 Rooftop")); R.info = mk("span", "rinfo", p, { display: "none" });
    R.ban = mk("div", "banner", p, { display: "none" });
    R.fw = [];
    [{ u: .15, x: 66, y: 30, c: "#ff6b8a" }, { u: .6, x: 204, y: 24, c: "#ffd23f" }, { u: 1.05, x: 141, y: 39, c: "#5aa8ff" }, { u: 1.6, x: 45, y: 21, c: "#6adf8a" }, { u: 2.05, x: 234, y: 42, c: "#b48aff" }]
      .forEach(b => { for (let k = 0; k < 12; k++) R.fw.push({ b, k, e: box(p, 0, 0, 3, 3, b.c, { zIndex: 8, display: "none", boxShadow: "0 0 0 1px rgba(46,32,64,.6)" }) }); });
  }
  function build() {
    world.textContent = "";
    const top = model.staff.slice().reverse();   // 위층부터
    const keys = ["roof", ...top.map(f => f.sid), "meet", "boss"];
    NR = keys.length; keyIdx = new Map(keys.map((k, r) => [k, r]));
    sty(world, "height", RT(NR) + "px");
    rooms = keys.map((key, r) => ({ key, r, p: mk("div", "room", world, { top: RT(r) + "px" }), R: {} }));
    rooms.forEach(R => {
      R.R = R;
      if (R.key === "roof") { R.type = "roof"; roofRoom(R); }
      else if (R.key === "meet") { R.type = "meet"; meetRoom(R); }
      else if (R.key === "boss") { R.type = "boss"; bossRoom(R); }
      else { R.type = "staff"; R.f = model.bySid.get(R.key); staffRoom(R, R.f); }
    });
    /* 엘리베이터 통로(옥상 아래 전부) · 카 · 아기(서브에이전트) */
    box(world, 219, RH, 54, RT(NR) - RH, "var(--shaft)", { zIndex: 1 }); box(world, EX - 1, RH, 3, RT(NR) - RH, "#6a5a88", { zIndex: 1 });
    car = box(world, 222, yOfRoom(NR - 1), 48, 78, "var(--cab)", { zIndex: 4, borderBottom: "6px solid #8a7a60" });
    dl = box(world, 222, 0, 24, 78, "var(--door)", { border: "2px solid var(--ln)", zIndex: 6 }); dr = box(world, 246, 0, 24, 78, "var(--door)", { border: "2px solid var(--ln)", zIndex: 6 });
    babies = [0, 1, 2].map(() => actor(world, 10));
    rooms.forEach(R => pwM.room(R, R.type === "boss" ? 0 : R.type === "meet" ? 1 : R.type === "staff" ? R.f.floor - 1 : -1, R.f && R.f.animal));
    pkM.reset(); const topS = rooms.find(R => R.type === "staff"); rooms.forEach(R => pkM.room(R, R === topS));   // 👆 누를 자리·효과 층
    if (cam.beat) cam.beat.y0 = null;
  }

  /* ---------- 엘리베이터: 출동(D)과 완료 보고(V)가 한 대를 번갈아 씀. 쉬는 자리는 1F ---------- */
  let D = null, V = null;
  const travel = (a, b) => clamp(.4 + .4 * Math.abs(a - b), .8, 2.2);
  function dTimes(d) {   // 출동 타임라인(시안 기준 u: 카 도착 = -0.2)
    const fr = idxOf(d.sid), mt = NR - 2;
    const up = travel(fr, NR - 1), ride = clamp(.3 + .5 * Math.abs(mt - fr), .8, 1.8), back = travel(mt, NR - 1);
    const a = up + .2;   // s(시작부터 초) = u + a
    return { fr, mt, up, ride, back, a, rideAt: a + 2.4, meetAt: a + 2.4 + ride, end: a + 2.4 + ride + 3.6 + back };
  }
  function carState(tc) {
    const boss = yOfRoom(NR - 1);
    let y = boss, door = 0, dir = "";
    if (!D && !V) { const pc = pkM.car(tc, null, NR, yOfRoom, travel); if (pc) return pc; }   // 👆 엘리베이터 호출(출동·보고가 쓰는 중이면 예약)
    if (D) {
      const T = dTimes(D), s = tc - D.t0, u = s - T.a, yf = yOfRoom(T.fr), ym = yOfRoom(T.mt);
      if (s < T.up) { y = lerp(boss, yf, ease(s / T.up)); dir = "▲"; }
      else if (u < 2.4) { y = yf; door = u < .3 ? 0 : u < .6 ? ease((u - .3) / .3) : u < 2 ? 1 : 1 - ease((u - 2) / .4); }
      else if (u < 2.4 + T.ride) { y = lerp(yf, ym, ease5((u - 2.4) / T.ride)); dir = ym > yf ? "▼" : "▲"; }
      else { const v = u - T.ride + .8;   // 시안의 회의실 도착(3.2) 기준으로 맞춤
        if (v < 5.6) { y = ym; door = v < 3.5 ? ease((v - 3.2) / .3) : v < 4.6 ? 1 : v < 5 ? 1 - ease((v - 4.6) / .4) : 0; }
        else { y = lerp(ym, boss, ease((v - 5.6) / T.back)); dir = "▼"; } }
    } else if (V) {
      const k = clockT() - V.t, yf = yOfRoom(idxOf(V.info.sid)), dd = vDur(V), ph = V.ph;
      if (ph === "fetch") { y = lerp(boss, yf, ease(k / dd)); dir = "▲"; }
      else if (ph === "down") { y = lerp(yf, boss, ease(k / dd)); dir = "▼"; }
      else if (ph === "up") { y = lerp(boss, yf, ease(k / VDUR.up)); dir = "▲"; }
      else if (ph === "home") { y = lerp(yf, boss, ease(k / dd)); dir = "▼"; }
      else door = ph === "open" ? ease(k / VDUR.open) : ph === "out" ? (k < .9 ? 1 : 1 - ease((k - .9) / .6)) : ph === "back" ? (k > VDUR.back - .6 ? ease((k - VDUR.back + .6) / .6) : 0) : ph === "in" ? 1 : ph === "close" ? 1 - ease(k / VDUR.close) : 0;
    }
    return { y, door, dir };
  }
  /* 완료 보고(1층): 카가 데리러 감 → 내려옴 → 걸어 나옴 → 보고(큰 완료면 박수, 평소엔 끄덕임) → 돌아감 → 카가 1F로 */
  const VDUR = { open: .6, out: 1.6, report: 4.2, nod: 3, back: 1.5, in: .45, close: .6, up: .9 };
  const vDur = v => travel(idxOf(v.info.sid), NR - 1);
  function stepVisitor(tc) {
    if (!V && !D && !pkM.riding()) while (reports.length) { const r = reports.shift(); if (tc - r.at < 30 && model.bySid.has(r.info.sid)) { V = { info: r.info, big: r.big, ph: "fetch", t: tc }; break; } }
    if (!V) return;
    const k = tc - V.t, go = ph => { V.ph = ph; V.t = tc; };
    if (!model.bySid.has(V.info.sid) && ["fetch", "down"].includes(V.ph)) { V = null; return; }
    switch (V.ph) {
      case "fetch": if (k >= vDur(V)) go("down"); break;
      case "down": if (k >= vDur(V)) go("open"); break;
      case "open": if (k >= VDUR.open) go("out"); break;
      case "out": if (k >= VDUR.out) go("stay"); break;
      case "stay": if (k >= (V.big ? VDUR.report : VDUR.nod)) go("back"); break;
      case "back": if (k >= VDUR.back) go("in"); break;
      case "in": if (k >= VDUR.in) go("close"); break;
      case "close": if (k >= VDUR.close) go("up"); break;
      case "up": if (k >= VDUR.up) go("home"); break;
      case "home": if (k >= vDur(V)) V = null; break;
    }
  }

  /* ---------- 감독: 샷(질문 > 완료 > 출동, 최소 체류). 평소 완료는 사장실만, 큰 완료는 그 층 → 옥상 ---------- */
  const PRI = { ask: 4, askalt: 4, launch: 3, dispatch: 2, deliv: 1, idle: 0 };
  const DWELL = { ask: 3, askalt: 2.4, launch: 4.3, dispatch: 99, deliv: 2, idle: 0 };
  const TAIL = 1.4, ASK_ALT = 7, ALT_LEN = 2.4, ASK_MAXWAIT = 1.5, L_FLOOR = 1.3, L_ROOF = 4.3, L_SMALL = 2, EXPIRE = 30;
  let shot = { k: "idle", t0: 0 };
  const askAt = new Map();   // 질문을 처음 본 시각(카메라 기준)
  function candidate(tc) {
    const a = model.askers.find(x => !(shot.ask && shot.ask.sid === x.sid));
    if (a) { if (!askAt.has(a.sid)) askAt.set(a.sid, tc); return { k: "ask", info: a, at: askAt.get(a.sid) }; }
    while (launches.length && tc - launches[0].at >= EXPIRE) launches.shift();
    if (launches.length) return { k: "launch", ev: launches[0], at: launches[0].at };
    while (dispatches.length && (tc - dispatches[0].at >= 15 || !model.bySid.has(dispatches[0].sid))) dispatches.shift();
    if (dispatches.length && !D && !V && !pkM.riding()) return { k: "dispatch", ev: dispatches[0], at: dispatches[0].at };
    /* 🎨 택배 도착(큰 화면에서 산 소품): 그 층을 4.6초 비춤 */
    while (dcM.peek() && (tc - dcM.peek().t0 >= 15 || !model.staff.some(f => dcM.keyOf(f) === dcM.peek().p))) dcM.take();
    const dv = dcM.peek(); if (dv) return { k: "deliv", ev: Object.assign({ sid: model.staff.find(f => dcM.keyOf(f) === dv.p).sid }, dv), at: dv.t0 };
    return null;
  }
  function endLaunch(tc) {   // 1층 완료 보고를 줄 세움(정적이면 사장실로 돌아온 뒤 잠깐 보고 장면)
    const r = { info: shot.ev.info, big: shot.ev.big, at: tc };
    reports.push(r); lastReport = r; if (reports.length > 3) reports.shift();
  }
  function startShot(n, tc) {
    if (shot.k === "launch" && shot.ev && !shot.ended) { shot.ended = 1; endLaunch(tc); }
    const s = { k: n ? n.k : "idle", t0: tc };
    if (n && n.k === "ask") { s.ask = n.info; }
    if (n && n.k === "launch") { s.ev = n.ev; launches.splice(launches.indexOf(n.ev), 1); }
    if (n && n.k === "deliv") { s.ev = n.ev; dcM.take(); }
    if (n && n.k === "dispatch") { s.ev = n.ev; dispatches.splice(dispatches.indexOf(n.ev), 1); D = { sid: n.ev.sid, n: n.ev.n, t0: tc }; meetSid = n.ev.sid; }
    shot = s;
    if (s.k === "launch" && !s.ev.big) { s.ended = 1; endLaunch(tc); }   // 평소 완료: 옥상 없이 곧장 사장실 보고
  }
  function direct(tc) {
    for (const sid of [...askAt.keys()]) if (!model.askSet.has(sid) && !(shot.ask && shot.ask.sid === sid)) askAt.delete(sid);
    if (look || pkM.holdKey(tc)) return;   // 둘러보는 중·방금 누른 방을 보는 중: 새 샷을 시작하지 않음(이벤트는 다음 칩에 쌓임)
    const el = tc - shot.t0, best = candidate(tc);
    if (shot.k === "ask" || shot.k === "askalt") {
      const sid = shot.ask.sid, live = model.askSet.has(sid);
      if (live) shot.ask = model.bySid.get(sid) || shot.ask;
      else if (shot.solved == null) shot.solved = tc;
      if (shot.k === "ask") {
        if (shot.solved != null && tc - shot.solved >= TAIL) { askAt.delete(sid); startShot(candidate(tc), tc); }
        else if (live && el >= ASK_ALT) { const a = shot.ask; startShot(null, tc); shot.k = "askalt"; shot.ask = a; }
      } else if (!live || el >= ALT_LEN) { const a = shot.ask, sv = shot.solved; startShot(null, tc); shot.k = "ask"; shot.ask = a; if (sv != null) shot.solved = sv; }
      return;
    }
    if (shot.k === "launch" && el >= L_FLOOR && !shot.ended) { shot.ended = 1; endLaunch(tc); }   // 옥상 폭죽 동안 카가 보고할 직원을 데리러 감
    if (shot.k === "launch" && el >= (shot.ev.big ? L_ROOF : L_SMALL)) { startShot(best, tc); return; }
    if (shot.k === "dispatch" && (!D || tc - D.t0 >= dTimes(D).meetAt + 1.8)) { startShot(best, tc); return; }
    if (shot.k === "deliv" && el >= 4.6) { startShot(best, tc); return; }
    if (best && PRI[best.k] > PRI[shot.k] && (el >= DWELL[shot.k] || (best.k === "ask" && tc - best.at >= ASK_MAXWAIT))) startShot(best, tc);
  }
  /* 지금 샷이 보여 줄 방(key) */
  function wantKey(tc, still) {
    if (look) return look.key;
    const hk = pkM.holdKey(tc); if (hk && (hk === "boss" || hk === "meet" || model.bySid.has(hk))) return hk;
    const el = tc - shot.t0;
    if (shot.k === "ask") return shot.ask.sid;
    if (shot.k === "launch") return !shot.ev.big ? "boss" : el < L_FLOOR ? shot.ev.info.sid : "roof";
    if (shot.k === "deliv") return model.bySid.has(shot.ev.sid) ? shot.ev.sid : "boss";
    if (shot.k === "dispatch" && D) { const T = dTimes(D), s = tc - D.t0; return s < T.rideAt ? D.sid : s < T.meetAt && !still ? "car" : "meet"; }
    return "boss";
  }

  /* ---------- 둘러보기: 사용자가 고른 방(look). 마지막 조작 후 LOOK_SEC 지나면 자동 카메라로 ---------- */
  const LOOK_SEC = 10;
  let look = null;
  function suspendShot(tc) {   // 자동 샷을 내려놓음: 질문은 대기열(askers)에 남고, 아직 못 담은 완료는 다시 줄 앞에
    if (shot.k === "launch" && shot.ev && !shot.ended) launches.unshift(shot.ev);
    shot = { k: "idle", t0: tc };
  }
  function setLook(key) {
    const tc = clockT();
    if (!look) suspendShot(tc);
    look = { key, t: tc };
    kick();
  }
  function curIdx() {
    if (look) return idxOf(look.key);
    const b = cam.beat; if (!b) return NR - 1;
    return b.key === "car" ? clamp(Math.round(cam.y / RH), 0, NR - 1) : idxOf(b.key);
  }
  function step(d) {   // d: -1 위층(옥상 쪽) · +1 아래층(사장실 쪽)
    if (!rooms.length) return;
    setLook(rooms[clamp(curIdx() + d, 0, NR - 1)].key);
  }
  function endLook() { if (look) { look = null; kick(); } }
  /* 다음 칩 항목: 아직 못 담은 질문·완료(층과 함께, 지금 보고 있는 층은 빼고). 첫 항목 = 칩을 누르면 갈 층 */
  function pending(tc) {
    const fl = sid => { const f = model.bySid.get(sid); return f ? f.floor + "F" : ""; };
    return model.askers.filter(a => !(shot.ask && shot.ask.sid === a.sid) && !(look && look.key === a.sid)).map(a => ({ sid: a.sid, t: "❓" + fl(a.sid) }))
      .concat(launches.filter(l => tc - l.at < EXPIRE && model.bySid.has(l.info.sid) && !(look && look.key === l.info.sid)).map(l => ({ sid: l.info.sid, t: (l.big ? "🎉" : "✅") + fl(l.info.sid) })));
  }
  const KLBL = { work: ["⌨️ 작업 중", "⌨️ Working"], agents: ["🤖 서브 출동", "🤖 Sub-agents"], ask: ["❓ 답 대기", "❓ Waiting"], stall: ["💤 멈춤 의심", "💤 Stalled?"], done: ["✅ 완료", "✅ Done"], idle: ["☕ 쉬는 중", "☕ Idle"] };
  function stLabel(f) {
    const l = KLBL[f.kind][en() ? 1 : 0];
    return f.kind === "ask" ? `${l} ${mss(ctx.now() - f.since)}` : f.kind === "agents" && f.ag.length ? `${l} ${f.ag.length}` : l;
  }
  function infoText(R) {   // 둘러볼 때 방 이름표 아래 한 줄
    if (R.type === "staff") { const f = model.bySid.get(R.key) || R.f; return `${aName(f.animal)} · ${f.pname} · ${stLabel(f)}`; }
    if (R.type === "boss") return X(`사장님 · 작업 ${model.working} · 대기 ${model.waiting}`, `Boss · busy ${model.working} · waiting ${model.waiting}`);
    if (R.type === "meet") { const o = model.staff.find(f => f.ag.length); return o ? X(`${o.floor}F ${aName(o.animal)}의 서브 ${o.ag.length}명 회의 중`, `${o.ag.length} sub${o.ag.length > 1 ? "s" : ""} of ${o.floor}F ${aName(o.animal)}`) : X("비어 있음 · 서브 출동 때 모여요", "Empty · subs meet here"); }
    return X("큰 일 완료 때 폭죽을 쏴요", "Fireworks for big wins");
  }

  /* ---------- 카메라: 비트(방) 전환 = 컷(아이리스) | 팬(세로 이동) | 정적(효과 없는 컷) ---------- */
  const cam = { beat: null, trans: null, y: 0 };
  const FOCUS = { roof: [141, 60], staff: [93, 90], meet: [135, 96], boss: [45, 96] };
  const typeOf = key => key === "roof" ? "roof" : key === "meet" ? "meet" : key === "boss" || key === "car" ? "boss" : "staff";
  const panDur = dy => clamp(.32 + .14 * Math.abs(dy) / RH, .42, .75);
  function keyY(key, cs) { return key === "car" ? clamp(cs.y - (FY - 78), 0, RT(NR - 1)) : RT(idxOf(key)); }
  function camStep(tc, cs, still) {
    const want = wantKey(tc, still), style = still ? "still" : camPref();
    const b = cam.beat;
    if (!b) { cam.beat = { key: want, t0: tc, y0: null }; return; }
    if (cam.trans && tc - cam.trans.t0 >= .15) {   // 아이리스가 다 닫히면 방을 바꿈
      cam.beat = { key: cam.trans.to, t0: tc, y0: null, open: tc }; cam.trans = null;
    }
    if (cam.trans) { cam.trans.to = want; return; }
    if (want === cam.beat.key) return;
    const cont = want === "car" || cam.beat.key === "car";   // 엘리베이터 따라가기: 이어지는 움직임이라 효과 없음
    if (style === "cut" && !cont) { cam.trans = { to: want, t0: tc, from: cam.beat.key }; return; }
    cam.beat = { key: want, t0: tc, y0: style === "pan" && !cont ? cam.y : null, prevSub: subNow };
  }
  function camY(tc, cs) {
    const b = cam.beat, tgt = keyY(b.key, cs);
    if (b.y0 == null) return tgt;
    const dy = tgt - b.y0, D_ = panDur(dy), k = (tc - b.t0) / D_;
    if (!dy || k >= 1) { b.y0 = null; return tgt; }
    const q = ease5(k), d = Math.abs(dy) / RH;
    if (d <= 2) return b.y0 + dy * q;
    const sg = Math.sign(dy); return q < .5 ? b.y0 + sg * RH * 2 * q : tgt - sg * RH * 2 * (1 - q);   // 익스프레스: 화면상 두 층만 움직이고 중간 층은 건너뜀
  }
  function irisNow(tc) {
    if (cam.trans) { const f = FOCUS[typeOf(cam.trans.from)]; return { f, r: sn(180 * (1 - (tc - cam.trans.t0) / .15)) }; }
    const b = cam.beat;
    if (b && b.open != null && tc - b.open < .21) return { f: FOCUS[typeOf(b.key)], r: sn(180 * ease((tc - b.open) / .21)) };
    return null;
  }

  /* ---------- 자막 ---------- */
  let subNow = "";
  const who = f => `${f.shiny ? "✨" : ""}${EMO[f.animal]} ${aName(f.animal)}`;
  const goMux = f => (f && f.mux && ctx.api.openTerminal ? f.mux : "");   // 완료 보고를 누르면 그 멀티플렉서(cmux)로 (앱에서만). 반환 = 표시 이름
  const doneSub = f => { const n = aName(f.animal); return goMux(f) ? X(`✅ ${n}${josa(n, "이", "가")} 일을 마쳤어요 · 보고를 누르면 ${goMux(f)}로 이동`, `✅ ${n} is done · click the report to go to ${goMux(f)}`) : X(`✅ ${n}${josa(n, "이", "가")} 일을 마쳤어요 · 확인해 주세요`, `✅ ${n} is done · please check`); };   // 프로바이더는 보고 말풍선에(자막 한 줄에 안 들어감)
  function subText(tc) {
    const el = tc - shot.t0, f = shot.ask || (shot.ev && shot.ev.info);
    switch (shot.k) {
      case "ask": return shot.solved != null ? X("✅ 답변 완료! 다시 작업하러 가요", "✅ Answered! Back to work")
        : X(`${who(f)}(${f.pname})${josa(f.pname, "이", "가")} 답을 기다려요`, `${who(f)} (${f.pname}) is waiting for you`);
      case "askalt": return X(`❓ ${f.floor}F ${aName(f.animal)} 답 대기 ${mss(ctx.now() - f.since)} · ${goMux(f) ? `누르면 ${goMux(f)}로 이동` : "터미널 확인"}`, `❓ ${f.floor}F ${aName(f.animal)} waiting ${mss(ctx.now() - f.since)} · ${goMux(f) ? `click to go to ${goMux(f)}` : "check terminal"}`);
      case "launch": if (!shot.ev.big) break;   // 평소 완료는 아래 보고 자막
        return el < L_FLOOR ? X(`🎉 ${f.floor}F ${aName(f.animal)}(${f.pname}) 큰 일 완료!`, `🎉 ${f.floor}F ${aName(f.animal)} (${f.pname}) big one done!`)
        : X(`🎆 옥상에서 축하 폭죽 · ${aName(f.animal)}(${f.pname})`, `🎆 Rooftop fireworks · ${aName(f.animal)} (${f.pname})`);
      case "deliv": return dcM.sub(shot.ev, model.bySid.get(shot.ev.sid));
      case "dispatch": {
        if (!D) return "";
        const T = dTimes(D), s = tc - D.t0, p = model.bySid.get(D.sid);
        if (!p) return "";
        if (s < T.rideAt) return X(`🤖 ${p.floor}F ${aName(p.animal)}${josa(aName(p.animal), "이", "가")} 서브 ${D.n}명을 출동시켜요`, `🤖 ${p.floor}F ${aName(p.animal)} sends out ${D.n} sub-agent${D.n > 1 ? "s" : ""}`);
        if (s < T.meetAt) return X(`🛗 ${p.floor}F → 2F 회의실로 내려가요`, `🛗 ${p.floor}F → 2F meeting room`);
        return wbSub(tc) || X(`📋 2F 회의실 · 서브 회의 ${p.ag.length}명`, `📋 2F meeting · ${p.ag.length} sub-agent${p.ag.length > 1 ? "s" : ""}`);
      }
    }
    if (V) {
      const n = aName(V.info.animal);
      if (V.ph === "stay") return V.big ? (V.info.cheer && !cfg.hideText ? `👏 ${aName(V.info.animal)}: “${cut(V.info.cheer, 20)}”` : X("👏 사장님이 박수를 보내요", "👏 The boss applauds")) : doneSub(V.info);   // ✍️ AI 한마디가 있으면 그걸로
      if (["fetch", "down", "open", "out"].includes(V.ph)) return X(`🛗 ${n}${josa(n, "이", "가")} 완료 보고하러 와요`, `🛗 ${n} is coming down to report`);
    }
    if (shot.k === "launch") return doneSub(shot.ev.info);   // 평소 완료인데 엘리베이터가 아직 바쁨
    return "";
  }

  /* ---------- 🧑‍🏫 2F 회의실 화이트보드 (규칙은 WB 블록): 팀 수만큼 보드를 나눔 · 아기는 엘리베이터로 와서 앉고, 팀이 끝나면 지우고 떠남 ---------- */
  const wbLab = t => { const f = model.bySid.get(t.sid); return { em: f ? EMO[f.animal] : "", fl: f ? f.floor + "F" : "", proj: f ? f.project : "", name: f ? aName(f.animal) : "" }; };
  const wbSub = tc => WB.sub(wbT.list().filter(t => model.bySid.has(t.sid)), tc, X, wbLab, !!cfg.hideText);
  function meetSeats(tc) {   // 자리: 1팀 3명 · 2팀 2명씩 · 3팀+ 1명씩(최대 4) — 일하는 아기 먼저
    const present = wbT.list().filter(t => tc >= t.t0 && !(t.gone != null && tc >= t.gone) && model.bySid.has(t.sid));
    const per = present.length <= 1 ? 3 : present.length === 2 ? 2 : 1, seats = [];
    present.forEach(t => t.mem.slice().sort((a, b) => WB.isDone(a, tc) - WB.isDone(b, tc) || a.j - b.j).slice(0, per).sort((a, b) => a.j - b.j).forEach(m => seats.push({ T: t, m })));
    seats.length = Math.min(4, seats.length);
    seats.forEach((s, i) => { s.x = sn(84 + (i + .5) * (120 / seats.length)); });
    return { present, seats };
  }
  function drawMeet(MR, tc, T, anim, ms, dTrans) {   // 반환: 움직이는 중(빠른 루프)
    const still = !anim, blink = anim && (T % 3.7) < .14, hop = anim ? Math.abs(Math.sin(T * 7)) : 0, wk = anim ? Math.floor(T * 4) % 2 : 0;
    html(MR.wb, WB.render(WB.cols(ms.present, tc, 0, 201), tc, { lh: 13, pt: 1, sc: 1, H: 66, still, hide: !!cfg.hideText, en: en(), lab: wbLab }));
    /* 지운 자리 구석에 ♥/★ 낙서(7초) */
    const er = wbT.list().filter(t => t.ee != null && tc >= t.ee && tc < t.dood).sort((a, b) => b.ee - a.ee)[0];
    if (er) { const a = fnv(er.sid) % 2 ? WB.ART.star : WB.ART.heart; html(MR.dood, WB.img(a, 1, 0, 0, `opacity:${(still ? 1 : clamp((tc - er.ee) / .4, 0, 1)).toFixed(2)}`));
      sty(MR.dood, "left", (196 - (fnv(er.sid) % 3) * 10) + "px"); sty(MR.dood, "top", "63px"); sty(MR.dood, "display", "block"); }
    else sty(MR.dood, "display", "none");
    MR.seat.forEach(s => { hide(s.a); sty(s.ch, "display", "none"); sty(s.d, "display", "none"); });
    sty(MR.yawn, "display", "none");
    ms.seats.forEach((s, i) => {
      const m = s.m, Tm = s.T, q = MR.seat[i], f = model.bySid.get(Tm.sid);
      if (!f || dTrans === Tm.sid) return;   // 엘리베이터를 타고 오는 중(출동 샷이 그림)
      const u = tc - (Tm.t0 + .15 + m.j * .35), v = Tm.leave != null ? tc - (Tm.leave + m.j * .3) : -1;
      let x = s.x, seated = false, walk = false, op = 1;
      if (still) { if (v >= 0) return; seated = true; }
      else if (v >= 0) { if (v < 1) { x = lerp(s.x, EX, v); walk = true; } else if (v < 1.3) { x = EX; op = 1 - (v - 1) / .3; } else return; }
      else if (u < 0) return; else if (u < .3) { x = EX; op = u / .3; } else if (u < 1.3) { x = lerp(EX, s.x, u - .3); walk = true; } else seated = true;
      const d = WB.isDone(m, tc), just = d && anim && tc - m.doneAt < .9, yawning = anim && WB.yawn(Tm, tc) === m;
      const o = { baby: 1, eyes: yawning || (d && !just && seated) ? "c" : blink ? "c" : "o" }; if (just) { o.arms = "u"; o.mouth = "o"; } if (yawning) o.mouth = "o";
      if (seated) {
        o.seated = 1; sty(q.ch, "display", "block"); sty(q.ch, "left", (s.x - 15) + "px");
        show(q.a, sprOf(f, o, 2), s.x, FY - 12, { dy: just ? -Math.round(hop * 2) * 2 : 0, z: 5, op: 1 });
        if (d && !just) { const ds = WB.pix(WB.ART.dn, 2); if (q.d._u !== ds.url) { q.d._u = ds.url; q.d.src = ds.url; } sty(q.d, "width", ds.w + "px"); sty(q.d, "height", ds.h + "px"); sty(q.d, "display", "block"); sty(q.d, "left", (s.x + 3) + "px"); sty(q.d, "top", (FY - 39) + "px"); }
        if (yawning) { sty(MR.yawn, "display", "block"); sty(MR.yawn, "left", (s.x + 12) + "px"); sty(MR.yawn, "top", (FY - 54 - Math.round(((tc - Tm.t0) % 20) * 2)) + "px"); }
      } else { o.legs = walk ? (wk ? "a" : "b") : "s"; show(q.a, sprOf(f, o, 2), x, FY - 3, { dy: walk && wk ? -2 : 0, op, z: 10 }); }
    });
    /* 도넛 상자: 끝낸 아기가 하나씩 가져감 */
    const dl = Math.max(0, 3 - ms.present.reduce((n, t) => n + WB.doneN(t, tc), 0));
    html(MR.dbox, `<div style="position:relative;width:21px;height:6px;background:#ffb3c8;border:2px solid #4a3560">${[0, 1, 2].map(i => i < dl ? `<i style="position:absolute;left:${1 + i * 6}px;top:-4px;width:5px;height:4px;background:#ff8ab0;border:1px solid #7a4a2a;border-radius:2px"></i>` : "").join("")}</div>`);
    sty(MR.dbox, "display", ms.present.length ? "block" : "none");
    sty(MR.tag, "display", ms.present.length || er ? "none" : "");   // 회의 중엔 방 이름표를 숨겨 보드를 키움
    sty(MR.bub, "display", "none");
    return ms.present.length > 0 || !!er;
  }

  /* ---------- 한 프레임 ---------- */
  function draw(T, anim) {
    const tc = clockT(), still = !anim;
    if (look && tc - look.t >= LOOK_SEC) look = null;   // 조작이 없으면 자동 카메라로(밀린 이벤트는 아래 direct가 처리)
    direct(tc);
    if (anim) stepVisitor(tc); else { V = null; reports.length = 0; }
    if (D && tc - D.t0 >= dTimes(D).end) D = null;
    const cs = anim ? carState(tc) : { y: yOfRoom(NR - 1), door: 0, dir: "" };
    camStep(tc, cs, still);
    const cy = sn(camY(tc, cs)); cam.y = cy;
    sty(world, "transform", `translateY(${-cy}px)`);
    rooms.forEach(R => sty(R.p, "display", RT(R.r) < cy + RH && RT(R.r + 1) > cy ? "block" : "none"));
    const vis = R => RT(R.r) < cy + RH && RT(R.r + 1) > cy;
    const blink = anim && (T % 3.7) < .14, hop = anim ? Math.abs(Math.sin(T * 7)) : 0, wk = anim ? Math.floor(T * 4) % 2 : 0, mot = anim ? 1 : 0;
    const el = tc - shot.t0;
    const sv = anim ? V : staticVisitor(tc), vk = sv ? tc - sv.t : 0, ph = sv ? sv.ph : "";
    const dU = D ? tc - D.t0 - dTimes(D).a : null;
    /* 직원 층 */
    rooms.forEach(R => {
      if (R.type !== "staff" || !vis(R)) return;
      const f = model.bySid.get(R.key) || R.f;
      const o = { seated: 1, eyes: blink ? "c" : "o" };
      let dy = 0, bub = null, typing = (f.kind === "work" || f.kind === "agents") && !pwM.dead(), sp = false;
      if (f.kind === "stall" || f.kind === "idle") { o.eyes = "c"; typing = false; }
      if (f.kind === "done") typing = false;
      const solved = (shot.k === "ask" || shot.k === "askalt") && shot.ask.sid === f.sid && shot.solved != null;
      if (f.kind === "ask" && !solved) { typing = false; o.arms = "r"; dy = -Math.round(Math.abs(Math.sin(T * 4)) * 2) * U * mot; sp = true;
        bub = look ? [`❓ ${esc(cut(f.note || X("확인이 필요해요", "Needs your input"), 17))}`, 6, 42] : [`❓ ${esc(cut(f.note || X("확인이 필요해요", "Needs your input"), 17))}${f.guess ? " " + X("(추정)", "(guess)") : ""}<span class="f">⌨️ ${X("터미널에서 답해 주세요", "Please answer in the terminal")}</span>`, 6, 22]; }
      if (solved) { typing = false; o.arms = "u"; o.mouth = "o"; dy = -Math.round(hop * 4) * U; sp = true; bub = [X("고마워요! 바로 실행할게요 🚀", "Thanks! On it 🚀"), 24, 30]; }
      if (shot.k === "launch" && shot.ev.big && shot.ev.info.sid === f.sid && el < L_ROOF) { typing = false; o.arms = "u"; o.mouth = "o"; dy = -Math.round(hop * 4) * U; sp = true; bub = [X("🎉 다 했어요!", "🎉 All done!"), 84, 36]; }
      if (D && D.sid === f.sid && dU >= -.2 && dU < 2.4) { typing = false; o.arms = "r"; bub = [X(`🤖 서브 ${D.n}명 출동!`, `🤖 ${D.n} subs, go!`), 6, 36]; }
      if (!bub && f.kind !== "ask" && f.kind !== "stall") { const pq = pwM.staff(R, f); if (pq) { Object.assign(o, pq.o); if (pq.say) bub = [pq.say, 6, 42]; } }   // 정전·리셋
      const rx = f.kind === "idle" && !bub ? dcM.restX(f) : null;   // 🎨 쉴 때는 좋아하는 소품 앞에 서서(하트)
      if (V && V.info.sid === f.sid && !["fetch", "home"].includes(V.ph)) hide(R.actor);   // 1층에 보고하러 가 있음
      else if (rx != null) show(R.actor, sprOf(f, { eyes: "c", mouth: anim && Math.floor(T / 2) % 3 === 0 ? "o" : "" }), rx, FY - 3, { z: 11 });
      else { const pz = pkM.pose(R.key, o, anim, R.r - 1), s = sprOf(f, o); show(R.actor, s, R.x + Math.round(pz.dx), FY - 12, { dy: dy + Math.round(pz.dy), rot: pz.rot ? Math.round(pz.rot) : 0, z: 8 }); pkM.after(R, R.actor, s, BYID[f.animal], Object.assign({ prov: f.pk, shiny: f.shiny }, o), pz, anim); }   // 👆 클릭 반응 몸짓
      dcM.draw(R, f, T, tc, anim, rx != null ? rx : R.x, rx != null);
      const fast = anim && pkM.fast(R.key) ? 3 : 1;   // 모니터 "타자 빨라짐" · 카페인
      R.hands.forEach((hd, k) => { sty(hd, "display", typing ? "block" : "none"); sty(hd, "marginTop", (mot && typing && (Math.floor(T * 4 * fast) + k) % 2 ? -U : 0) + "px"); });
      R.lns.forEach((l, k) => { const s = Math.floor(T * 2 * fast * fast) * mot * (typing ? 1 : 0) + k * 7; sty(l, "display", f.kind === "idle" ? "none" : "block"); sty(l, "width", (9 + (s * 37 % 27)) + "px"); sty(l, "left", (3 + ((s * 13) % 3) * 3) + "px"); sty(l, "background", ["#7dff9c", "#ffd23f", "#5aa8ff", "#ff9ad0", "#7dff9c"][(k + s) % 5]); });
      if (bub) { bubble(R.bub, bub[0], bub[1], bub[2], R.x - bub[1] - 9); sty(R.bub, "maxWidth", (W - 6 - bub[1]) + "px"); } else sty(R.bub, "display", "none");
      const hot = f.kind === "ask" && pkM.askHot(R.key); if (R.bub.classList.contains("hot") !== hot) R.bub.classList.toggle("hot", hot);   // 질문 중 직원을 누르면 말풍선 강조
      sty(R.tag, "display", bub && bub[2] < 30 ? "none" : "");   // 큰 말풍선이 뜨면 방 이름표는 숨김(자막이 대신 설명)
      R.spk.forEach((e, i) => { const on = f.shiny && sp; sty(e, "display", on ? "block" : "none"); if (on) { const P = [[-36, -66], [27, -72], [33, -45]][i]; sty(e, "left", (R.x + P[0]) + "px"); sty(e, "top", (FY + P[1]) + "px"); } });
      if (R.leds) R.leds.forEach((e, q) => sty(e, "background", (Math.floor(T * 1.5 * mot) + q) % 2 ? "#7dff9c" : "#ffd23f"));
      /* ✍️ 단계 칩 · AI 보드(로비는 3줄: 4줄이면 지금 할 일 근처만) */
      const st_ = f.step && ["work", "agents", "ask"].includes(f.kind) ? f.step : null, tagOn_ = R.tag.style.display !== "none";
      sty(R.stp, "display", st_ && tagOn_ ? "" : "none");
      if (st_ && tagOn_) { txt(R.stp, `${st_.step}/${st_.total}`); sty(R.stp, "background", st_.step === st_.total ? "#c9940f" : "#34457f"); sty(R.stp, "left", (5 + R.tag.offsetWidth + 3) + "px"); }
      if (R.aiW) { const Bd = aiT.get(f.sid), off = aibOff(f.s, f.kind), now = ctx.now();
        const lk = !!look;   // 둘러볼 때는 이름표 아래 정보 줄이 보드 윗줄을 덮으므로 2줄만 아래로
        html(R.aiW, Bd ? WB.aiRender(Bd, tc, { x: 1, w: 150, lh: 13, pt: lk ? 15 : 0, rows: lk ? 2 : 3, still, hide: !!cfg.hideText, an: f.animal, sc: 1, H: 40, erase: off != null && now >= off ? (now - off) / AIB_ERASE : null }) : "");
        if (Bd && WB.aiStretch(Bd, tc, still) && !bub && (f.kind === "work" || f.kind === "agents" || f.kind === "done")) {   // 마지막 ✓ → 기지개
          const s2 = sprOf(f, { seated: 1, arms: "u", eyes: "c" }); show(R.actor, s2, R.x, FY - 12, { dy: -U });
        } }
    });
    /* 사장님 (1F) */
    const BR = rooms[NR - 1];
    {
      const alt = shot.k === "askalt", clap = sv && ph === "stay" && sv.big, nod = sv && ph === "stay" && !sv.big;
      const drn = !sv && !alt ? drM.note() : null;   // 📋 일보 알림: 종이를 들고 있음(질문·보고가 먼저, 정전·리셋 몸짓이 있으면 그쪽)
      const doze = !sv && !model.working && shot.k === "idle" && !drn;
      const cofK = (tc % 28) - 20, cof = anim && !sv && !doze && !alt && !drn && shot.k === "idle" && cofK >= 0 && cofK < 1.7;
      const typing = !clap && !doze && !cof && !alt && !drn && model.working > 0 && !pwM.dead();
      const ty = anim ? Math.floor(T * 2) % 2 : 0;
      BR.hands.forEach((h, j) => { sty(h, "display", typing ? "block" : "none"); sty(h, "marginTop", (typing && (ty + j) % 2 ? -U : 0) + "px"); });
      const sd0 = anim && typing ? Math.floor(T) : 0;
      BR.lns.forEach((l, j) => { const sd = sd0 + j * 7, on = typing || cof || alt; sty(l, "display", on || doze ? "block" : "none"); sty(l, "width", (doze ? 6 : 9 + (sd * 37 % 27)) + "px"); sty(l, "left", (3 + ((sd * 13) % 3) * 3) + "px");
        sty(l, "background", doze ? "#3a4a6a" : ["#7dff9c", "#ffd23f", "#5aa8ff", "#ff9ad0", "#7dff9c"][(j + sd) % 5]); });
      let bp = { seated: 1, eyes: blink ? "c" : "o" }, bdy = 0;
      if (clap) { bp = { seated: 1, arms: "u", mouth: "o", eyes: "o" }; bdy = -Math.round(hop * 4) * U; }
      const dn = nod && anim && Math.floor(vk * 2.5) % 2;
      if (nod) { bp = { seated: 1, eyes: dn ? "c" : "o" }; bdy = dn ? 2 * U : 0; }   // 가볍게 끄덕 + 👍
      sty(BR.nod, "display", nod ? "block" : "none"); if (nod) sty(BR.nod, "marginTop", (dn ? U : 0) + "px");
      if (cof) bp = { seated: 1, eyes: "c" };
      if (doze) { bp = { seated: 1, eyes: "c" }; bdy = anim && Math.floor(T * 1.2) % 2 ? U : 0; }
      if (alt) bp = { seated: 1, arms: "r", eyes: blink ? "c" : "o" };
      const pq = !sv && !alt ? pwM.boss(T, anim) : null;   // 정전 당황 · 리셋 만세
      if (pq) { bp = pq.p; bdy = 0; }
      if (drn && !pq) { bp = { seated: 1, arms: "r", specs: 1, eyes: blink ? "c" : "o" }; bdy = 0; }
      sty(BR.paper, "display", drn && !pq ? "block" : "none"); if (drn) sty(BR.paper, "top", (FY - 70 + (anim && Math.floor(T * 2) % 2 ? U : 0)) + "px");
      bossNow = doze ? "doze" : cof ? "coffee" : "work";
      { const bz = pkM.pose("boss", bp, anim, NR - 2), bsp = bossSpr(bp); show(BR.actor, bsp, 45 + (pq ? pq.dx : 0) + Math.round(bz.dx), FY - 12, { dy: bdy + Math.round(bz.dy), z: 8, rot: bz.rot ? Math.round(bz.rot) : 0 }); pkM.after(BR, BR.actor, bsp, BOSS, Object.assign({ boss: 1 }, bp), bz, anim); }   // 👆
      const lift = cof ? Math.round(Math.sin(Math.min(1, cofK / .5) * Math.PI / 2) * 4) * U : 0;
      sty(BR.mug, "top", (FY - 52 - lift) + "px"); sty(BR.mug, "left", (cof ? 60 : 72) + "px");
      BR.z.forEach((z, i) => { if (!doze) { sty(z, "display", "none"); return; } const p = anim ? ((T * .45 + i / 3) % 1) : i * .3;
        sty(z, "display", "block"); sty(z, "left", Math.round(66 + p * 12 + i * 6) + "px"); sty(z, "top", Math.round(FY - 84 - p * 24) + "px"); sty(z, "opacity", String(1 - p * .8)); sty(z, "fontSize", Math.round(12 + p * 8) + "px"); });
      if (alt) { const f = shot.ask, n = aName(f.animal); bubble(BR.bub, X(`❓ ${f.floor}F ${n}${josa(n, "이", "가")} 기다려요`, `❓ ${f.floor}F ${n} is waiting`), 12, 27, 24); }
      else if (pq && pq.say) bubble(BR.bub, pq.say, 30, 27, 14);
      else if (drn && drM.age(tc) < 8) bubble(BR.bub, drn.kind === "morning" ? X("좋은 아침! ☀️", "Morning! ☀️") : X("일보 나왔어요!", "Report's ready!"), 84, 36, 10);
      else sty(BR.bub, "display", "none");
      sty(BR.tag, "display", alt ? "none" : "");
      /* 완료 보고하러 온 직원 */
      BR.cf.forEach(c => sty(c, "display", "none"));
      let bubOn = false;
      const shown = sv && (ph === "open" ? vk > VDUR.open * .4 : ph === "in" ? vk < VDUR.in * .5 : ["out", "stay", "back"].includes(ph));
      if (!shown) hide(BR.vis);
      else {
        const c = sv.info, walk = ph === "out" || ph === "back", x = ph === "out" ? lerp(EX, TX, vk / VDUR.out) : ph === "back" ? lerp(TX, EX, vk / VDUR.back) : ph === "stay" ? TX : EX;
        const o = { legs: walk ? (wk ? "a" : "b") : "s", eyes: blink ? "c" : "o" };
        if (ph === "stay" && sv.big) { o.arms = "u"; o.mouth = "o"; }
        const vdy = walk ? (wk ? -U : 0) : ph === "stay" && sv.big ? -Math.round(hop * 5) * U : 0;
        const hx = sn(x);
        show(BR.vis, sprOf(c, o), hx, FY - 3, { dy: vdy, rot: walk && anim ? (wk ? 3 : -3) : 0, z: 20 });
        if (ph === "stay") {
          bubOn = true; BR.vbub.className = "bub rep"; sty(BR.vbub, "top", "12px"); sty(BR.vbub, "background", "#fff6d0");
          html(BR.vbub, `<span class="chip" style="background:${sv.big ? "#ff6b8a" : "#3fa35a"}">${sv.big ? "🎉 " + X("큰 일 완료!", "Big one done!") : "✅ " + X("완료 보고", "Done")} ${esc(cut(c.project, 14))}</span><span class="ft2">${c.run ? "⏱ " + esc(C.fmt(c.run)) + " · " : ""}${esc(aName(c.animal))} · ${esc(c.pname)} · ${c.floor}F</span>${goMux(c) ? `<span class="ft2 go">↗ ${X(`${goMux(c)}로 이동`, `Go to ${goMux(c)}`)}</span>` : ""}`);
          if (goMux(c)) { BR.vbub.dataset.act = "go"; BR.vbub.dataset.sid = c.sid; } else delete BR.vbub.dataset.act;   // 👆 보고 말풍선을 누르면 그 cmux 세션으로
          sty(BR.vbub, "display", "block");   // 글이 길면(영어 등) 창 안에 들어오게 왼쪽으로 당김
          const bl = sn(Math.max(6, Math.min(78, W - 3 - BR.vbub.offsetWidth)));
          sty(BR.vbub, "left", bl + "px"); if (BR.vbub._tx !== hx - bl - 6) { BR.vbub._tx = hx - bl - 6; BR.vbub.style.setProperty("--tx", BR.vbub._tx + "px"); }
          if (anim && sv.big && vk < 3) BR.cf.forEach((cc, i) => { const a = (i / 18) * Math.PI * 2, s2 = 30 + (i % 4) * 14; sty(cc, "display", "block"); sty(cc, "left", sn(hx + Math.cos(a) * s2 * vk * 1.1) + "px"); sty(cc, "top", sn(FY - 48 + Math.sin(a) * s2 * vk * .7 + 60 * vk * vk) + "px"); });
        }
      }
      sty(BR.vbub, "display", bubOn ? "block" : "none"); if (!bubOn) delete BR.vbub.dataset.act;
      if (bubOn) sty(BR.tag, "display", "none");
    }
    /* 엘리베이터 카 · 층 표시(그 층에 있으면 nF, 아니면 카가 있는 쪽 화살표) */
    const dw = Math.max(3, sn(24 * (1 - cs.door)));
    sty(car, "top", Math.round(cs.y) + "px"); sty(dl, "top", Math.round(cs.y) + "px"); sty(dr, "top", Math.round(cs.y) + "px");
    sty(dl, "width", dw + "px"); sty(dr, "width", dw + "px"); sty(dr, "left", (270 - dw) + "px");
    rooms.forEach(R => {
      if (!R.lamp || !vis(R)) return;
      const d = cs.y - yOfRoom(R.r), here = Math.abs(d) < RH / 2;
      txt(R.lamp, pwM.dead() ? "--" : here ? floorOfIdx(R.r) + "F" : d < 0 ? "▲" : "▼");   // 정전 땐 꺼짐
      sty(R.lamp, "color", pwM.dead() ? "#5a5070" : here ? "#7dff9c" : "#a99bc8");
    });
    /* 아기(서브에이전트): 출동 샷이면 엘리베이터를 타고 오고, 아니면 회의실(🧑‍🏫 화이트보드 · 자리)에서 */
    const MR = rooms[NR - 2], my = RT(NR - 2);
    const ms = meetSeats(tc), dTrans = D && anim && dU - dTimes(D).ride + .8 < 4.4 ? D.sid : null;
    babies.forEach(hide);
    if (dTrans) {
      const T_ = dTimes(D), p = model.bySid.get(D.sid), fy = RT(T_.fr), dSeat = ms.seats.filter(s => s.T.sid === D.sid);
      if (p) for (let k = 0; k < D.n; k++) {
        const xs = [189, 207, 171][k], xin = [237, 255, 246][k], xseat = dSeat[k] ? dSeat[k].x : [117, 153, 189][k], v = dU - T_.ride + .8;
        let s = null;
        if (dU < .2) s = null;
        else if (dU < .6) s = { x: xs, yb: fy + FY - 3, pop: (dU - .2) / .4 };
        else if (dU < .9) s = { x: xs, yb: fy + FY - 3 };
        else if (dU < 1.8) s = { x: lerp(xs, xin, (dU - .9) / .9), yb: fy + FY - 3, walk: 1 };
        else if (v < 3.5) s = { x: xin, yb: cs.y + 72, inCar: 1 };
        else s = { x: lerp(xin, xseat, (v - 3.5) / .9), yb: my + FY - 3, walk: 1 };
        if (!s) continue;
        const o = { baby: 1, legs: s.walk ? ((wk + k) % 2 ? "a" : "b") : "s", eyes: blink ? "c" : "o" };
        show(babies[k], sprOf(p, o, 2), s.x, s.yb, { dy: s.walk && (wk + k) % 2 ? -2 : s.pop != null ? Math.round((1 - clamp(s.pop, 0, 1)) * -12) : 0, op: s.pop != null ? clamp(s.pop, 0, 1) : 1, z: s.inCar ? 5 : 10 });
      }
    }
    const wbBusy = MR && vis(MR) ? drawMeet(MR, tc, T, anim, ms, dTrans) : false;
    /* 옥상 */
    const RR = rooms[0];
    if (vis(RR)) {
      const dark = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches;
      const ru = shot.k === "launch" && shot.ev.big ? el - L_FLOOR : -1;
      RR.stars.forEach((s2, k) => sty(s2, "opacity", dark ? (mot && (Math.floor(T * 2) + k) % 3 === 0 ? ".4" : ".9") : "0"));
      sty(RR.flag, "transform", `skewY(${mot && Math.floor(T * 3) % 2 ? -6 : 0}deg)`);
      RR.tubes.forEach((tb, k) => sty(tb, "background", ru >= 0 && mot && Math.floor(ru * 4 + k) % 2 ? "#ffd23f" : "#ff6b8a"));
      RR.fw.forEach(p => sty(p.e, "display", "none"));
      if (ru >= 0 && ru < 3.4) {
        RR.fw.forEach((p, i) => { const a = ru - p.b.u, ang = p.k / 12 * Math.PI * 2;
          if (!mot) { if (i >= 36) return; sty(p.e, "display", "block"); sty(p.e, "left", sn(p.b.x + Math.cos(ang) * 21) + "px"); sty(p.e, "top", sn(p.b.y + Math.sin(ang) * 15) + "px"); sty(p.e, "opacity", "1"); return; }
          if (a < 0 || a > 1.4) return; const r = 24 * (1 - Math.pow(1 - Math.min(1, a / .7), 3));
          sty(p.e, "display", "block"); sty(p.e, "left", sn(p.b.x + Math.cos(ang) * r) + "px"); sty(p.e, "top", sn(p.b.y + Math.sin(ang) * r * .8 + 9 * a * a) + "px"); sty(p.e, "opacity", String(a > 1 ? 1 - (a - 1) / .4 : 1)); });
        sty(RR.ban, "display", "block"); txt(RR.ban, X(`🎉 ${cut(shot.ev.info.project, 16)} 큰 일 완료!`, `🎉 ${cut(shot.ev.info.project, 16)} big one done!`));
        sty(RR.ban, "left", sn((W - RR.ban.offsetWidth) / 2) + "px"); sty(RR.ban, "top", (mot ? sn(57 - (ru < .3 ? (1 - ru / .3) * 12 : 0)) : 57) + "px");
      } else sty(RR.ban, "display", "none");
    }
    const pkBusy = pkM.frame(vis, anim);   // 👆 소품 반응·말풍선(반응이 없으면 그리지 않음)
    /* 전력·날씨: 보이는 방에만 */
    pwM.frame(rooms, vis, T, anim, { home: R => { const f = model.bySid.get(R.key); return !!f && !(V && V.info.sid === f.sid && !["fetch", "home"].includes(V.ph)); }, meetBusy: () => wbBusy || ms.present.length > 0 });   // 회의실에 아기들이 있으면(화이트보드 회의) 정전 때 촛불 등
    /* 아이리스(컷) */
    const ir = anim ? irisNow(tc) : null;
    if (ir) { sty(iris, "display", "block"); sty(iris, "left", (ir.f[0] - ir.r) + "px"); sty(iris, "top", (ir.f[1] - ir.r) + "px"); sty(iris, "width", ir.r * 2 + "px"); sty(iris, "height", ir.r * 2 + "px"); }
    else sty(iris, "display", "none");
    /* 자막: 팬 앞 절반은 떠나는 장면의 자막 */
    subNow = subText(tc) || pwM.sub(tc);
    const b = cam.beat, panning = b && b.y0 != null && (tc - b.t0) < panDur(keyY(b.key, cs) - b.y0) * .5;
    const left = look ? Math.max(1, Math.ceil(LOOK_SEC - (tc - look.t))) : 0;
    const tip = tipOf(tipEl);   // 버튼에 마우스·포커스가 있으면 그 설명이 자막 자리를 잠깐 차지(떠나면 원래 자막)
    const pkS = pkM.sub(tc);
    const st = tip || pkS || (look ? X(`👀 둘러보는 중 · ${left}초 뒤 자동 카메라`, `👀 Browsing · auto camera in ${left}s`) : panning ? b.prevSub || "" : cam.trans ? subEl._t || "" : subNow);
    sty(subEl, "display", st ? "block" : "none"); txt(subEl, st);
    drM.frame(st);   // 📋 자막이 비었을 때만 일보 알림 줄 subEl.classList.toggle("look", !!look && !tip && !pkS); subEl.classList.toggle("tip", !!tip);
    /* 다음 칩: 아직 못 담은 질문·완료(큰 완료 🎉, 평소 ✅)와 그 층. 누르면 첫 항목의 층으로 */
    const q = pending(tc);
    nextEl.hidden = !q.length; txt(nextEl, X("다음 ", "Next ") + q.slice(0, 2).map(x => x.t).join(" ") + (q.length > 2 ? ` +${q.length - 2}` : ""));   // 두 개까지(방 이름표와 안 겹치게)
    nextEl.setAttribute("aria-label", q.length ? X(`눌러서 ${q[0].t} 보기`, `Click to view ${q[0].t}`) : "");
    /* 둘러볼 때: 방 이름표 아래 정보 줄 */
    rooms.forEach(R => { if (!R.info) return; const on = !!look && vis(R) && R.tag.style.display !== "none"; sty(R.info, "display", on ? "block" : "none"); if (on) txt(R.info, infoText(R)); });
    const ci = curIdx(); setOff(nU, ci <= 0); setOff(nD, ci >= NR - 1);
    setHov();
    return !!look || shot.k !== "idle" || !!V || !!D || !!cam.trans || (b && b.y0 != null) || !!ir || cof_(tc, anim) || wbBusy || pkBusy;
  }
  const cof_ = (tc, anim) => anim && (tc % 28) - 20 >= 0 && (tc % 28) - 20 < 1.7;
  function staticVisitor(tc) {   // 정적: 방금 완료면 5초간 사장님 앞에서 보고
    if (lastReport && tc - lastReport.at < 8 && model.bySid.has(lastReport.info.sid) && shot.k === "idle") return { info: lastReport.info, big: lastReport.big, ph: "stay", t: tc - 3 };
    return null;
  }

  /* ---------- 창 크기: 장면을 정수 배율 근처로 맞춤 ---------- */
  function fitScale() {
    const k = Math.max(.5, Math.min(win.innerWidth / W, win.innerHeight / H));
    sty(lw, "transform", `scale(${k})`);
  }
  if (isWin) {   // 앱 위젯은 코어가 resizeTo → widget_resize로 연결. PiP는 사용자 조작 없이 실패할 수 있어 무시
    const k = Math.max(1, Math.round(Math.min(win.innerWidth / W, win.innerHeight / H) || 1));
    try { if (Math.abs(win.innerWidth - W * k) > 2 || Math.abs(win.innerHeight - H * k) > 2) win.resizeTo(W * k + (win.outerWidth - win.innerWidth), H * k + (win.outerHeight - win.innerHeight)); } catch {}
  }
  ctx.listen(win, "resize", fitScale);
  fitScale();

  /* ---------- 입력 ---------- */
  ctx.listen(root, "click", e => {
    const b = e.target.closest("[data-act]"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    if (b.dataset.act === "quiet") { if (ctx.settings.setQuiet) ctx.settings.setQuiet(!ctx.settings.quiet); }
    else if (b.dataset.act === "cam") { ctx.store.set("lobbyCam", camPref() === "pan" ? "cut" : "pan"); renderHud(); }
    else if (b.dataset.act === "big") ctx.api.showMain();
    else if (b.dataset.act === "close") win.close();
    else if (b.dataset.act === "up") step(-1);
    else if (b.dataset.act === "down") step(1);
    else if (b.dataset.act === "dot" || b.dataset.act === "step") { if (model.bySid.has(b.dataset.sid)) setLook(b.dataset.sid); }
    else if (b.dataset.act === "next") { const q = pending(clockT()); if (q.length) setLook(q[0].sid); }
    else if (b.dataset.act === "poke") pkM.tap(b, e);   // 👆 클릭 반응
    else if (b.dataset.act === "dr") drM.tap();   // 📋 큰 화면에서 일보 카드
    else if (b.dataset.act === "go") { const f = model.bySid.get(b.dataset.sid); if (goMux(f)) Promise.resolve(ctx.api.openTerminal(f.sid)).catch(() => {}); }   // 완료 보고 → 그 멀티플렉서(Orca·cmux) 세션
    else if (b.dataset.act === "jump") { if (model.bySid.has(b.dataset.sid)) pkM.jump(b.dataset.sid); }   // 🖥️ 이름표 칩 → 그 세션(멀티플렉서 또는 터미널). 연타는 2초에 한 번
  });
  /* 호버 버튼 보이기: CSS :hover 대신 JS로 판단(.slb.hov).
     macOS 앱 위젯(WKWebView, 포커스 안 받는 창)은 창이 키 윈도가 아니면 mousemove가 안 와서 :hover가 안 켜지거나 늦게 바뀜.
     휠·키는 비활성 창에도 오므로 → ① 마우스가 창 안에 있음 ② 최근 휠·키·포커스 조작(HOV_MS) ③ 둘러보는 중 — 하나라도면 보임 */
  const HOV_MS = 3000;
  let ptrIn = false, actUntil = 0, hovT = 0, tipEl = null;
  function setHov() { const on = ptrIn || win.performance.now() < actUntil || !!look || ctl.contains(doc.activeElement) || nav.contains(doc.activeElement); if (slb.classList.contains("hov") !== on) slb.classList.toggle("hov", on); }
  function poke() { actUntil = win.performance.now() + HOV_MS; setHov(); win.clearTimeout(hovT); hovT = win.setTimeout(setHov, HOV_MS + 30); }
  function setOff(b, off) { const v = off ? "true" : "false"; if (b.getAttribute("aria-disabled") !== v) b.setAttribute("aria-disabled", v); }
  /* 설명 문구(지금 상태 반영). 작은 창이라 기본 title 툴팁 대신 하단 자막 줄에만 띄움(겹쳐 보이지 않게 title은 쓰지 않고 aria-label만) */
  function tipOf(b) {
    if (!b || !b.isConnected) return "";
    const a = b.dataset.act, pan = camPref() === "pan", q = !!ctx.settings.quiet;
    if (a === "cam") return animOn() ? (pan ? X("🎥 지금 팬(위아래로 훑기) · 누르면 컷", "🎥 Now pan (glide) · click for cut") : X("🎥 지금 컷(툭 넘어감) · 누르면 팬", "🎥 Now cut (quick) · click for pan"))
      : X("🎥 카메라 컷↔팬 (지금은 정지 화면)", "🎥 Camera cut↔pan (static now)");
    if (a === "quiet") return q ? X("🔇 회의 모드 켜짐 · 누르면 다시 움직여요", "🔇 Quiet on · click to resume motion") : X("🪑 회의 모드: 움직임·소리 멈춤", "🪑 Quiet mode: stop motion & sound");
    if (a === "big") return X("⤢ 큰 화면으로 돌아가기", "⤢ Back to the full window");
    if (a === "close") return X("✕ 닫기", "✕ Close");
    if (a === "up") return b.getAttribute("aria-disabled") === "true" ? X("▲ 맨 위층(옥상)이에요", "▲ Already at the top (roof)") : X("▲ 위층 보기 · 휠·↑ 키도 돼요", "▲ Floor up · wheel or ↑ works too");
    if (a === "down") return b.getAttribute("aria-disabled") === "true" ? X("▼ 맨 아래층(1F)이에요", "▼ Already at the bottom (1F)") : X("▼ 아래층 보기 · 휠·↓ 키도 돼요", "▼ Floor down · wheel or ↓ works too");
    if (a === "dot") { const f = model.bySid.get(b.dataset.sid); return f ? `${f.floor}F ${EMO[f.animal]} ${cut(f.project, 14)} · ${stLabel(f)} — ${X("누르면 이동", "click to go")}` : ""; }
    if (a === "step") { const f = model.bySid.get(b.dataset.sid); return f && f.step ? `✍️ ${f.floor}F ${f.step.step}/${f.step.total} · ${cfg.hideText ? "🤫" : f.title ? cut(f.title, 30) : X("단계 보고", "step report")}` : ""; }
    if (a === "jump") { const f = model.bySid.get(b.dataset.sid); return f ? "🖥️ " + goLabel(f.s, X) : ""; }
    if (a === "next") { const p = pending(clockT()); const f = p.length && model.bySid.get(p[0].sid); return f ? X(`👉 누르면 ${f.floor}F로 이동`, `👉 Click to go to ${f.floor}F`) : ""; }
    return "";
  }
  const tipTarget = t => { const b = t && t.closest ? t.closest("[data-act]") : null; return b && root.contains(b) && b.dataset.act !== "dexclose" && b.dataset.act !== "poke" && b.dataset.act !== "dr" ? b : null; };
  function setTip(b) { if (tipEl === b) return; tipEl = b; kick(); }
  ctx.listen(doc, "mousemove", e => { if (!ptrIn) { ptrIn = true; setHov(); } setTip(tipTarget(e.target)); pkM.hover(e.target.closest ? e.target.closest('[data-act="poke"]') : null); });
  ctx.listen(doc, "mouseover", e => { if (!ptrIn) { ptrIn = true; setHov(); } setTip(tipTarget(e.target)); });
  ctx.listen(doc, "mouseout", e => { if (!e.relatedTarget) { ptrIn = false; setTip(null); setHov(); pkM.hover(null); } });   // 창 밖으로
  ctx.listen(win, "blur", () => { ptrIn = false; setTip(null); setHov(); });
  ctx.listen(doc, "focusin", e => { const b = tipTarget(e.target); if (b && b.matches(":focus-visible")) setTip(b); poke(); });
  ctx.listen(doc, "focusout", () => { win.setTimeout(() => { const b = tipTarget(doc.activeElement); setTip(b && b.matches(":focus-visible") ? b : null); setHov(); }, 0); });
  ctx.listen(doc, "keydown", poke);
  ctx.listen(root, "wheel", poke, { passive: true });

  /* 휠·트랙패드: 한 번에 한 층. 제스처(휠이 QUIET 넘게 쉬었다 다시 시작)의 첫 이벤트에서 바로 한 층(기기마다 한 칸 크기가 달라서),
     그 뒤 STEP_LOCK 동안은 무시하고, 계속 굴리면 WHEEL_MIN만큼 더 쌓일 때 한 층씩 → 관성 스크롤에 여러 층이 휙 넘어가지 않게 */
  const WHEEL_MIN = 100, STEP_LOCK = 550, QUIET = 220;
  let wAcc = 0, wLast = -1e9, wLock = 0;
  ctx.listen(root, "wheel", e => {
    const t = win.performance.now(), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? RH : 1);
    if (!dy || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // 가로 스크롤은 무시
    if (e.cancelable) e.preventDefault();
    const fresh = t - wLast > QUIET; wLast = t;
    if (fresh) { wAcc = 0; wLock = 0; }
    if (t < wLock) return;
    if (wAcc && Math.sign(wAcc) !== Math.sign(dy)) wAcc = 0;
    wAcc += dy;
    if (fresh ? Math.abs(dy) >= 2 : Math.abs(wAcc) >= WHEEL_MIN) { step(wAcc > 0 ? 1 : -1); wAcc = 0; wLock = t + STEP_LOCK; }
  }, { passive: false });
  /* 키보드(창에 포커스가 있을 때): ↑↓ 층 이동 · Esc 자동 카메라로 */
  ctx.listen(doc, "keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]"))) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(e.key === "ArrowUp" ? -1 : 1); }
    else if (e.key === "Escape" && look) { e.preventDefault(); endLook(); }
  });

  /* ---------- 루프: 평소엔 초당 8번만, 이벤트·전환 땐 25번. 회의 모드·움직임 줄이기·숨김이면 정적(1초마다) ---------- */
  const rm = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const animOn = () => !ctx.settings.quiet && !rm.matches && !doc.hidden && !ctx.paused && !(ctx.nunchi && ctx.nunchi.phase === "plain");   // 🙈 눈치 목록이 덮는 동안·숨겨 둔 위젯은 정적
  let stopLoop = null, lastDraw = 0, busy = true;
  function kick() { lastDraw = 0; busy = true; if (!animOn()) draw(0, false); }   // 조작 직후 바로 그림(정적이면 1초 주기를 기다리지 않음)
  function ensureLoop() {
    slb.classList.toggle("static", !animOn());
    if (animOn()) {
      if (!stopLoop) stopLoop = ctx.loop(ts => {
        if (!animOn()) { stopLoop = null; ensureLoop(); return false; }
        if (ts - lastDraw < (busy ? 40 : 125)) return;
        lastDraw = ts; busy = draw(ts / 1000, true);
      });
    } else { if (stopLoop) { stopLoop(); stopLoop = null; } cam.trans = null; draw(0, false); }
  }
  ctx.listen(doc, "visibilitychange", ensureLoop);
  if (rm.addEventListener) ctx.listen(rm, "change", ensureLoop);
  ctx.on("settings", () => { renderHud(); ensureLoop(); });
  ctx.on("nunchi", () => ensureLoop());   // 🙈 눈치 목록이 덮이고 걷힐 때
  ctx.on("paused", () => ensureLoop());   // 위젯 창 숨김·다시 보임
  ctx.every(1000, () => { if (ctx.paused) return; pkM.reload(); if (dcM.read(clockT())) sync(); if (!animOn()) draw(0, false); });
  sync(); if (!rooms.length) { buildSig = "|" + ctx.lang; build(); } renderHud(); ensureLoop();
  return {
    update() { sync(); },
    unmount() { doc.documentElement.classList.remove("stu-lobby"); },
  };
}

/* ================= 🧑‍🏫 회의실 화이트보드 (큰 화면 층 보드 · 로비 2F 회의실 보드 공용) =================
   서브에이전트(아기)가 모이면 보드에 팀 이름과 할 일(에이전트당 한 줄)을 적고, 끝나면 ✓, 팀이 다 끝나면 부모가 만세 → 지우개로 지운다.
   - 줄 문구 = agents[].desc(서버 마스킹 · 50자). 비면 type 이름 + 번호("#1 일반 작업"). now.text(지금 도구)는 보드에 안 쓰고 테이블 위 말풍선에만.
   - ✓ = agents[].status "done". 끝낸 아기는 팀이 끝날 때까지 도넛을 들고 쉬고, 팀이 끝나면 만세 → 지우기("정리 시간") 뒤 원래 배치로.
   - cfg.hideText(🤫 프로젝트·작업 문구 숨김)면 머리줄 "🤫 비밀 회의", 줄은 물결 낙서(✓는 그대로).
   - 시각은 이 창이 상태 변화를 처음 본 시각(clockT 초). 처음 열 때 이미 회의 중이던 팀은 다 써진 상태로 시작.
   - 정적(회의 모드·움직임 줄이기·숨김)이면 쓰기·지우기 애니메이션 없이 결과만.
   깨알 디테일: 동물별 글씨체 · 쓰는 마커만 받침대에서 빠짐 · 가끔 뚜껑이 굴러떨어짐 · 가끔 잉크가 흐려짐("어, 잉크가…") · 도넛 상자가 비어 감 ·
   벽시계 분침 · 길어지면 하품 · 지운 자리 ♥/★ 낙서(로비). */
const WB = (() => {
  const INK = ["#2a62c9", "#d23a4a", "#1f9a5a", "#8a4ad0"];
  const TYPEN = { Explore: ["둘러보기", "Explore"], "general-purpose": ["일반 작업", "General"], Plan: ["계획", "Plan"], agent: ["맡은 일", "Task"] };
  /* 동물별 글씨: 펭귄 반듯 · 비버 굵게 · 햄찌 통통 튐 · 고양이 낙서 · 문어 물결 · 로봇 또박또박(자간) · 수달 살짝 기울임 */
  const HAND = { peng: {}, bvr: { b: 1 }, ham: { jy: 1 }, cat: { jy: 2, rot: 7 }, oct: { wave: 1 }, bot: { ls: 1 }, otr: { jy: 1, rot: 3 } };
  const ART = {
    box: { r: ["KKKKKKK", "K.....K", "K.....K", "K.....K", "K.....K", "K.....K", "KKKKKKK"], p: { K: "#6a6a80" } },
    chk: { r: [".......G", "......GG", "G....GG.", "GG..GG..", ".GGGG...", "..GG...."], p: { G: "#1f9a5a" } },
    mk: { r: ["......KK", ".....KCK", "....KCK.", "...KCK..", "..KCK...", ".KWK....", "KWK.....", "KK......"], p: { K: "#2e2040", C: "#e04050", W: "#f0e8f0" } },
    er: { r: ["KKKKKKKKKK", "KYYYYYYYYK", "KYYYYYYYYK", "KBBBBBBBBK", "KBBBBBBBBK", "KKKKKKKKKK"], p: { K: "#2e2040", Y: "#e9b377", B: "#5a7ad8" } },
    cap: { r: ["KKK", "KCK", "KKK"], p: { K: "#2e2040", C: "#e04050" } },
    dn: { r: [".KKK.", "KPWPK", "KW.WK", "KPWPK", ".KKK."], p: { K: "#7a4a2a", P: "#ff8ab0", W: "#ffd0e0" } },
    heart: { r: [".KK.KK.", "KRRKRRK", "KRRRRRK", ".KRRRK.", "..KRK..", "...K..."], p: { K: "#2e2040", R: "#ff6b8a" } },
    star: { r: ["...K...", "..KYK..", "KKKYKKK", ".KYYYK.", ".KYKYK.", "KK...KK"], p: { K: "#2e2040", Y: "#ffd23f" } },
    wave: { r: [".C..", "C.C.", "...C"], p: { C: "#2a62c9" } },   // 🤫 문구 숨김: 물결 낙서 한 칸(가로 반복)
  };
  const cache = new Map();
  function pix(art, sc, ink) {   // 문자 그림 → canvas data URL (C = 잉크 색)
    const k = art.r.join("|") + (ink || "") + sc, hit = cache.get(k); if (hit) return hit;
    const h = art.r.length, w = Math.max(...art.r.map(r => r.length)), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d");
    art.r.forEach((row, y) => [...row].forEach((ch, x) => { const col = ch === "C" && ink ? ink : art.p[ch]; if (ch !== "." && col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); } }));
    const v = { url: cv.toDataURL(), w: w * sc, h: h * sc }; if (cache.size > 300) cache.clear(); cache.set(k, v); return v;
  }
  const img = (art, sc, x, y, css, ink) => { const s = pix(art, sc, ink); return `<img class="b" alt="" src="${s.url}" style="left:${x}px;top:${y}px;width:${s.w}px;height:${s.h}px;${css || ""}">`; };
  /* ---------- 문구 ---------- */
  const clean = s => String(s || "").replace(/<REDACTED>/g, "▒▒").replace(/\s+/g, " ").trim();
  const WIDE = /[ᄀ-ᇿ㄰-㆏가-힣▒…]/, EMOJI = /\p{Extended_Pictographic}/u;
  const cw = ch => EMOJI.test(ch) ? 13 : WIDE.test(ch) ? 12 : /[️‍]/.test(ch) ? 0 : 7;   // Galmuri11 12px 대략 글자 폭
  const gw = g => EMOJI.test(g) || /\p{Regional_Indicator}/u.test(g) ? 13 : cw([...g][0]);   // 그래핌 하나의 폭(결합 기호·피부톤은 앞 글자에 붙음)
  function fitW(s, px) { let w = 0, o = ""; for (const g of graphemes(s)) { const c = gw(g); if (w + c > px) return o.replace(/\s+$/, "") + "…"; w += c; o += g; } return o; }
  function lineOf(m, en) { const a = m.a; if (clean(a.desc)) return clean(a.desc); const t = TYPEN[a.type]; return `#${m.j + 1} ${t ? t[en ? 1 : 0] : clean(a.type) || (en ? "Task" : "맡은 일")}`; }
  function hand(s, an, seed, shown, mk) {
    const h = HAND[an] || {}, cs = graphemes(s); let o = "";
    if (JOINED.test(s)) {   // 줄 하나(dir=auto)를 쓰는 방향으로 clip해서 드러냄 — 글자마다 inline-block이면 bidi·연결이 깨진다
      const k = cs.length ? Math.min(1, shown / cs.length) : 1, rtl = /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(s), cl = Math.round((1 - k) * 100);
      return `<span dir="auto" style="display:inline-block;${h.b ? "font-weight:700;" : ""}clip-path:inset(0 ${rtl ? 0 : cl}% 0 ${rtl ? cl : 0}%)">${esc(s)}</span>${mk || ""}`;
    }
    cs.forEach((ch, i) => {
      if (i === shown && mk) o += mk;
      const r = fnv(seed + ":" + i); let tf = "";
      const jy = h.wave ? Math.round(Math.sin(i * 1.3) * 1.4) : h.jy ? ((r % 3) - 1) * h.jy : 0;
      if (jy) tf += `translateY(${jy}px)`; if (h.rot) tf += ` rotate(${((r >> 4) % 3 - 1) * h.rot}deg)`;
      o += `<span class="c" style="${tf ? "transform:" + tf + ";" : ""}${i >= shown ? "visibility:hidden;" : ""}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`;
    });
    if (shown >= cs.length && mk) o += mk;
    return `<span style="${h.b ? "font-weight:700;" : ""}${h.ls ? "letter-spacing:1px;" : ""}">${o}</span>`;
  }
  /* 손에 든 마커(지금 쓰는 글자 끝에 붙어 다님) */
  const marker = (ink, dy) => { const s = pix(ART.mk, 1, ink); return `<span class="mkr"><img alt="" src="${s.url}" style="top:${-6 + dy}px;width:${s.w}px;height:${s.h}px"></span>`; };

  /* ---------- 팀 추적: 세션별 { t0, mem[{aid,j,a,wt,doneAt}], end, es, ee, leave, gone, off } ---------- */
  const TM = { cheer: 1.2, erase: 1.6, off: .6, walk: 1.4, dood: 7 };
  const isDone = (m, t) => m.doneAt != null && t >= m.doneAt;
  const doneN = (T, t) => T.mem.filter(m => isDone(m, t)).length;
  function tracker() {
    const teams = new Map(); let seen = new Set();
    const live = T => T.ee == null || T.gone == null;
    function pickInk(sid) {
      const used = new Set([...teams.values()].filter(live).map(T => T.ink));
      const i0 = fnv(sid) % INK.length;
      for (let k = 0; k < INK.length; k++) { const c = INK[(i0 + k) % INK.length]; if (!used.has(c)) return c; }
      return INK[i0];
    }
    function add(T, a, tc, first) {
      const j = T.mem.length, prev = T.mem[j - 1];
      const wt = first ? -1e9 : Math.max(T.t0 + .75 + j * .95, prev ? prev.wt + .95 : 0, tc + .3);
      const m = { aid: a.aid, j, a, wt, dur: 1, doneAt: a.status === "running" ? null : first ? -1e9 : 0 };
      T.mem.push(m); T.by.set(a.aid, m);
    }
    function end(T, tc) { T.end = tc; T.es = tc + TM.cheer; T.ee = T.es + TM.erase; T.leave = T.ee + .2; T.gone = T.leave + TM.walk + .9; T.off = T.ee + TM.off; T.dood = T.ee + TM.dood; }
    return {
      /* sid의 agents 전체(agAll)를 한 번 반영. first = 이 창이 상태를 처음 받음 */
      update(sid, agAll, tc, first, animal) {
        seen.add(sid);
        agAll = (agAll || []).filter(a => a && a.aid);
        const run = agAll.filter(a => a.status === "running");
        let T = teams.get(sid);
        if (T && T.end != null && run.length) { teams.delete(sid); T = null; }   // 정리 중에 새 출동 → 새 보드
        if (!T) {
          if (!run.length) return;
          const s0 = Math.min(...run.map(a => a.since || 0));
          T = { sid, t0: first ? tc - 60 : tc, mem: [], by: new Map(), end: null, ink: pickInk(sid), animal,
            dry: fnv(sid + ":ink") % 4 === 1 ? 1 : -1, cap: fnv(sid + ":cap") % 2 === 0, off: null, gone: null, ee: null, es: null };
          teams.set(sid, T);
          (first ? agAll : agAll.filter(a => a.status === "running" || (a.ended || 0) >= s0 - 1)).forEach(a => add(T, a, tc, first));
        } else if (T.end == null) run.forEach(a => { if (!T.by.has(a.aid)) add(T, a, tc, false); });
        T.animal = animal || T.animal;
        if (T.end != null) return;
        const byAid = new Map(agAll.map(a => [a.aid, a]));
        T.mem.forEach(m => { const a = byAid.get(m.aid); if (a) m.a = a; if ((!a || a.status !== "running") && m.doneAt == null) m.doneAt = tc; });
        if (T.mem.every(m => m.doneAt != null)) end(T, first ? tc - 60 : tc);
      },
      sweep(tc) {   // 이번 sync에 안 보인 세션의 팀 · 다 끝난 팀 정리
        for (const [sid, T] of teams) if (!seen.has(sid) || (T.dood != null && tc > Math.max(T.dood, T.gone))) teams.delete(sid);
        seen = new Set();
      },
      team: sid => teams.get(sid) || null,
      list: () => [...teams.values()].sort((a, b) => a.t0 - b.t0),
      meeting(sid, tc) { const T = teams.get(sid); return !!T && (T.off == null || tc < T.off); },
      due(tc) {   // 큰 화면: 정리 시간이 끝나 책상 배치로 돌아갈 팀이 생겼나(한 번만 true)
        let d = false; for (const T of teams.values()) if (T.off != null && tc >= T.off && !T.offDone) { T.offDone = 1; d = true; } return d;
      },
    };
  }

  /* ---------- 보드 그리기: cols = [{ T, x, w, mode: full|short|pips, div, divK }] ---------- */
  function render(cols, t, o) {   // o: { lh, pt, sc(지우개 배율), big, H, still, hide, en, lab: T => { em, fl, proj } }
    let h = "";
    cols.forEach(c => {
      const T = c.T, mode = c.mode, x0 = c.x, top = o.pt, st = o.still, L = o.lab(T);
      let s = "";
      /* 머리줄: 이모지 · 층 · 프로젝트 (왼쪽부터 써짐) + n/총 */
      const hp = st ? 1 : clamp((t - T.t0 - .25) / .4, 0, 1), dn = doneN(T, t), tot = T.mem.length;
      const head = o.hide ? (mode === "full" ? "🤫 " + (o.en ? "Secret meeting" : "비밀 회의") : "🤫 " + L.fl) : mode === "full" ? `${L.em} ${L.fl} ${L.proj}` : `${L.em} ${L.fl}`;
      s += `<div class="wbt" style="left:${x0}px;top:${top}px;color:${T.ink};font-weight:700;clip-path:inset(0 ${Math.round(100 - hp * 100)}% 0 0)">${esc(fitW(head, mode === "pips" ? c.w : c.w - 30))}</div>`;
      if (mode !== "pips" && hp > 0) s += `<div class="wbt" style="left:${x0 + c.w - 26}px;top:${top}px;color:#6a6a80;width:24px;text-align:right">${dn}/${tot}</div>`;
      s += `<div class="b" style="left:${x0}px;top:${top + o.lh - 1}px;width:${Math.round((c.w - 4) * hp)}px;height:1px;background:${T.ink};opacity:.5"></div>`;
      if (mode === "pips") {   /* 3팀+: 글 없이 □✓ 칸만 */
        const per = Math.max(1, Math.floor((c.w + 4) / 15));
        T.mem.forEach((m, j) => { if (!st && t < m.wt) return; const px = x0 + (j % per) * 15, py = top + o.lh + 4 + Math.floor(j / per) * 15;
          s += img(ART.box, 1, px, py); if (isDone(m, t)) s += img(ART.chk, 1, px + 1, py - 1, st ? "" : `opacity:${clamp((t - Math.max(m.doneAt, m.wt)) / .25, 0, 1).toFixed(2)}`); });
      } else {
        const maxL = mode === "short" ? 3 : o.big ? 4 : 3, show = T.mem.slice(0, maxL), extra = tot - show.length;
        show.forEach((m, li) => {
          if (!st && t < m.wt) return;
          const y = top + o.lh * (li + 1) + 3, room = c.w - (o.big ? 22 : 15) - (extra && li === maxL - 1 ? 16 : 0);
          const txt = fitW(lineOf(m, o.en), room), n = graphemes(txt).length, dur = .25 + n * .05; m.dur = dur;
          const p = st ? 1 : clamp((t - m.wt) / dur, 0, 1), shown = Math.floor(p * n + 1e-6);
          const d = isDone(m, t), dk = d ? (st ? 1 : clamp((t - Math.max(m.doneAt, m.wt + dur)) / .3, 0, 1)) : 0;
          const dry = T.dry >= 0 && T.mem.length > T.dry && li >= T.dry;   // 다 쓴 마커: 이 줄부터 잉크가 흐릿
          s += img(ART.box, 1, x0, y + 3);
          if (dk > 0) s += img(ART.chk, 1, x0 + 1, y + 1, dk < 1 ? `transform:scale(${(1 + (1 - dk) * .6).toFixed(2)});transform-origin:3px 6px` : "");
          const mk = p < 1 ? marker(T.ink, dry && Math.floor(t * 10) % 2 ? -1 : 0) : "";
          const body = o.hide ? `<span class="sq" style="width:${Math.round(Math.min(room, n * 9) * p)}px;background-image:url(${pix(ART.wave, 1, T.ink).url})"></span>${mk}` : hand(txt, T.animal, T.sid + m.aid, shown, mk);
          s += `<div class="wbt" style="left:${x0 + 11}px;top:${y}px;color:${T.ink};opacity:${((dry ? .55 : 1) * (d ? .62 : 1)).toFixed(2)}">${body}</div>`;
          if (extra && li === maxL - 1) s += `<div class="wbt" style="left:${x0 + c.w - 16}px;top:${y}px;color:#6a6a80">+${extra}</div>`;
        });
      }
      /* 지우개: 왼쪽부터 지그재그로 지워 나감 + 얼룩 */
      if (T.es != null && t >= T.es) {
        if (st) s = "";
        else {
          const ek = (t - T.es) / TM.erase, ex = Math.round(c.w * clamp(ek, 0, 1));
          s = `<div class="b" style="left:0;top:0;right:0;bottom:0;clip-path:inset(0 0 0 ${x0 - 1 + ex}px)">${s}</div>`;
          if (ek < 1.6) s += `<div class="b" style="left:${x0 - 2}px;top:${top}px;width:${ex}px;height:${o.H - top - 4}px;background:repeating-linear-gradient(170deg,rgba(150,160,190,.22) 0 4px,transparent 4px 9px);opacity:${clamp(1.6 - ek, 0, 1).toFixed(2)}"></div>`;
          if (ek < 1) { const yy = top + Math.round((Math.sin(ek * Math.PI * 7) * .5 + .5) * (o.H - top - 8 - 6 * o.sc)); s += img(ART.er, o.sc, x0 + ex - 6 * o.sc, yy, "z-index:3"); }
        }
      }
      if (c.div) s += `<div class="b" style="left:${c.x - 5}px;top:${top - 1}px;width:1px;height:${Math.round((o.H - top - 6) * (st ? 1 : clamp(c.divK, 0, 1)))}px;background:#9aa8c0"></div>`;
      h += s;
    });
    return h;
  }
  /* 미니: 보드 하나를 지금 회의 중인 팀 수만큼 나눔(1팀 글 · 2팀 짧은 글 · 3팀+ 칸만) */
  function cols(teams, t, x, w) {
    const act = teams.filter(T => t >= T.t0 && !(T.ee != null && t >= T.ee)), n = act.length;
    if (!n) return [];
    const gap = n > 1 ? 10 : 0, cwid = Math.floor((w - gap * (n - 1)) / n), mode = n === 1 ? "full" : n === 2 ? "short" : "pips";
    return act.map((T, i) => ({ T, x: x + i * (cwid + gap), w: cwid, mode, div: i > 0, divK: i ? (t - Math.max(T.t0, act[i - 1].t0)) / .5 : 0 }));
  }
  /* 부모(보드 앞): 쓰는 중 · 지우는 중 · 만세 · 한마디 */
  function pose(T, t, still, en) {
    const writing = !still && (T.mem.some(m => t >= m.wt && t < m.wt + m.dur) || (t >= T.t0 + .25 && t < T.t0 + .65));
    const erasing = !still && T.es != null && t >= T.es && t < T.ee;
    const cheer = T.end != null && t >= T.end && t < T.es;
    let say = "";
    if (T.dry >= 0 && T.mem[T.dry] && !still) { const w = T.mem[T.dry].wt; if (t >= w + .2 && t < w + 2.2) say = en ? "Uh, the ink…" : "어, 잉크가…"; }
    if (cheer) say = en ? "Meeting done! 👏" : "회의 끝! 👏";
    return { writing, erasing, cheer, say };
  }
  /* 회의가 길어지면(45초+) 20초마다 아직 일하는 아기 하나가 하품 */
  function yawn(T, t) {
    const u = t - T.t0; if (u < 45 || T.end != null || u % 20 >= 1.8) return null;
    const run = T.mem.filter(m => !isDone(m, t)); return run.length ? run[Math.floor(u / 20) % run.length] : null;
  }
  /* 로비 자막: 최근 일(합류 · ✓ · 회의 끝 · 지우기 · 하품) → 없으면 팀별 n/총 */
  function sub(teams, t, X, lab, hide) {
    const ev = [];
    teams.forEach((T, i) => { const L = lab(T), nm = X(`${L.fl} ${L.name} 팀`, `${L.fl} ${L.name} team`);
      if (t >= T.t0 && t < T.t0 + 2.6) ev.push([T.t0, i && teams.length > 1 ? X(`🤖 ${nm} ${T.mem.length}명 합류 · 보드 나눔`, `🤖 ${nm} +${T.mem.length} · board split`) : X(`🤖 ${nm} ${T.mem.length}명이 회의하러 와요`, `🤖 ${nm}: ${T.mem.length} coming to meet`)]);
      T.mem.forEach(m => { if (m.doneAt > 0 && t >= m.doneAt && t < m.doneAt + 1.6 && (T.end == null || m.doneAt < T.end)) ev.push([m.doneAt, X(`✓ ${nm} #${m.j + 1} 끝 · 도넛 하나 가져가요`, `✓ ${nm} #${m.j + 1} done · grabs a donut`)]); });
      if (T.end != null && t >= T.end && t < T.ee + .4) ev.push([T.end, t < T.es ? X(`👏 ${nm} 회의 끝!`, `👏 ${nm} meeting done!`) : X(`🧽 ${nm} 보드를 지워요`, `🧽 ${nm} wipes the board`)]);
      if (yawn(T, t)) ev.push([t - 1, X(`🥱 회의가 길어져요 · ${nm} ${doneN(T, t)}/${T.mem.length}`, `🥱 Long meeting · ${nm} ${doneN(T, t)}/${T.mem.length}`)]); });
    if (ev.length) return ev.sort((a, b) => b[0] - a[0])[0][1];
    const act = teams.filter(T => T.end == null);
    if (!act.length) return "";
    if (hide) return X(`📋 2F 회의실 · 🤫 비밀 회의 ${act.length}팀`, `📋 2F meeting · 🤫 ${act.length} secret team${act.length > 1 ? "s" : ""}`);
    return X("📋 2F 회의실 · ", "📋 2F · ") + act.map(T => { const L = lab(T); return `${L.em} ${L.fl} ${doneN(T, t)}/${T.mem.length}`; }).join(" · ");
  }

  /* ---------- ✍️ AI 보드(MCP waitscape_board): 세션별 { key, lines, doneAt[], wt[[쓰기 시작, 걸리는 시간]], end, allAt, ink } ----------
     시각은 이 창이 보드를 처음 본 시각(clockT). 줄이 바뀌면 새로 쓰고, done만 바뀌면 ✓만 찍는다. 처음 열 때 이미 있던 보드는 다 써진 상태 */
  const aiDur = s => .25 + Math.min(32, graphemes(s).length) * .05;
  function aiTracker() {
    const m = new Map();
    return {
      update(sid, b, tc, first) {
        if (!b) { m.delete(sid); return; }
        const lines = b.lines.slice(0, 4).map(x => clean(x)), n = lines.length, key = lines.join("\n");
        const dn = new Set((Array.isArray(b.done) ? b.done : []).filter(i => Number.isInteger(i) && i >= 0 && i < n));
        let B = m.get(sid);
        if (!B || B.key !== key) {
          const t0 = first ? tc - 60 : tc + (B ? .2 : 0);
          let t = t0 + .35; const wt = lines.map(x => { const w = [t, aiDur(x)]; t += w[1] + .15; return w; });
          B = { sid, key, lines, wt, t0, end: t, ink: INK[fnv(sid + ":ai") % INK.length], doneAt: lines.map((_, i) => dn.has(i) ? -1e9 : null), allAt: null };
          if (!first && dn.size === n) B.allAt = B.end + .3;   // 처음부터 다 끝난 보드: 다 쓰고 나서 기지개
          m.set(sid, B); return;
        }
        const was = B.doneAt.every(d => d != null);
        B.doneAt = B.doneAt.map((d, i) => dn.has(i) ? (d != null ? d : first ? -1e9 : Math.max(tc, B.end)) : null);
        const all = dn.size === n;
        if (all && !was && !first) B.allAt = Math.max(tc, B.end) + .45;   // 마지막 ✓가 찍히고 조금 뒤
        if (!all) B.allAt = null;
      },
      get: sid => m.get(sid) || null,
      sweep(live) { for (const k of [...m.keys()]) if (!live.has(k)) m.delete(k); },
    };
  }
  /* o: { x, w, lh, pt, rows(보이는 줄 수), still, hide, an(동물 글씨체), sc(지우개 배율), H, erase(0~1 지우는 중) } */
  function aiRender(B, t, o) {
    const st = o.still, n = B.lines.length, rows = Math.min(n, o.rows || 4);
    let from = 0, s = "";
    if (n > rows) { const fu = B.doneAt.findIndex(d => d == null); from = clamp((fu < 0 ? n : fu) - 1, 0, n - rows); }   // 칸이 모자라면 지금 할 일 근처만
    for (let li = from; li < from + rows; li++) {
      const [wt, dur] = B.wt[li]; if (!st && t < wt) continue;
      const y = o.pt + o.lh * (li - from), txt = fitW(B.lines[li], o.w - 14), nn = graphemes(txt).length;
      const p = st ? 1 : clamp((t - wt) / dur, 0, 1), shown = Math.floor(p * nn + 1e-6);
      const da = B.doneAt[li], d = da != null && t >= da, dk = d ? (st ? 1 : clamp((t - Math.max(da, wt + dur)) / .3, 0, 1)) : 0;
      s += img(ART.box, 1, o.x, y + 3);
      if (dk > 0) s += img(ART.chk, 1, o.x + 1, y + 1, dk < 1 ? `transform:scale(${(1 + (1 - dk) * .6).toFixed(2)});transform-origin:3px 6px` : "");
      const mk = p < 1 ? marker(B.ink, 0) : "";
      const body = o.hide ? `<span class="sq" style="width:${Math.round(Math.min(o.w - 14, nn * 9) * p)}px;background-image:url(${pix(ART.wave, 1, B.ink).url})"></span>${mk}` : hand(txt, o.an, B.sid + ":" + li, shown, mk);
      s += `<div class="wbt" style="left:${o.x + 11}px;top:${y}px;color:${B.ink};opacity:${d ? .62 : 1}">${body}</div>`;
    }
    if (o.erase != null) {   /* 지우개: 왼쪽부터 지그재그 */
      if (st) return "";
      const ek = clamp(o.erase, 0, 1), ex = Math.round((o.x + o.w) * ek), yy = o.pt + Math.round((Math.sin(ek * Math.PI * 7) * .5 + .5) * (o.H - o.pt - 8 - 6 * o.sc));
      s = `<div class="b" style="left:0;top:0;right:0;bottom:0;clip-path:inset(0 0 0 ${ex}px)">${s}</div>`;
      if (ek < 1) s += img(ART.er, o.sc, ex - 6 * o.sc, yy, "z-index:3");
    }
    return s;
  }
  /* 다 쓴 뒤 마커 뚜껑 "딸깍"(소리 없음): 끝난 지 0~.45초 → 0~1, 그 밖은 null */
  const aiCap = (B, t, still) => still || !B || t < B.end || t >= B.end + .45 ? null : (t - B.end) / .45;
  /* 마지막 ✓ 뒤 기지개(1.6초) */
  const aiStretch = (B, t, still) => !still && !!B && B.allAt != null && t >= B.allAt && t < B.allAt + 1.6;
  return { ART, INK, pix, img, clean, fitW, lineOf, tracker, render, cols, pose, yawn, sub, isDone, doneN, TM, aiTracker, aiRender, aiCap, aiStretch };
})();

/* ================= 👆 클릭 반응 · 이스터에그 (POKE: 큰 화면 pokeBig · 미니 보기 pokeMini 공용) =================
   직원(동물 7종 + 사장님)과 소품을 누르면 작게 반응한다. 규칙(시안 studio-click 그대로):
   - 대상마다 반응 3~4개를 셔플 주머니로 돌림 → 같은 반응이 연속으로 나오지 않음. 직원을 0.8초 안쪽 간격으로 4번 연타하면 짜증("일하는 중이에요!" 💢 💧)
   - 누른 자리 작은 파티클 + 0.25초 squash · 커서를 올리면 포인터 + 흰 도트 외곽선(미니 보기는 1px)
   - 회의 모드·움직임 줄이기 = 움직임 없이 말풍선(과 결과)만. 소리는 🔊 켰을 때만(Web Audio 합성, 작게 · 회의 모드면 끔), "♪ 꽥" 표기도 그때만
   - 이스터에그 8개 → 도감 🥚 n/8. 찾은 것·화이트보드 낙서·핀 꽃은 ctx.store("poke")에 영구, 연타·셔플·꽂힌 책은 창마다 메모리
   - 질문 중인 직원을 누르면 말풍선 강조 + (앱이면) 실제 "터미널로 이동"
   - 엘리베이터 호출은 직원이 쓰는 중이면 예약(비면 그때 감). 직원 이동이 항상 우선
   - 미니 보기의 누를 수 있는 것 = [data-act="poke"]: 코어(bootWidget)가 누른 채 4px 넘게 움직일 때만 창 끌기로 넘긴다
   반응이 없으면 그리지 않음(층마다 fx 한 줄을 비운 뒤엔 건드리지 않음) → 평소 프레임 비용은 그대로. */
const PK = (() => {
  const K = "#4a3560";
  const ART = {
    plant: { r: ["..G.....G...", ".GGG.GG.GGG.", "GGLGGGGGGLGG", ".GGGLGGLGGG.", "..GGGGGGGG..", "....GGGG....", ".....GG.....", "..KKKKKKKK..", "..KPPPPPPK..", "..KPPPPPPK..", "...KPPPPK...", "...KKKKKK..."], p: { K, G: "#5fcf6a", L: "#3a9a4a", P: "#d9744a" } },
    flower: { r: [".P.P.", "PPYPP", ".PPP.", "..G.."], p: { P: "#ff8ab0", Y: "#ffd23f", G: "#3a9a4a" } },
    leaf: { r: [".GG", "GGL", "GL."], p: { G: "#5fcf6a", L: "#3a9a4a" } },
    clock: { r: ["..KKKKKK..", ".KWWWWWWK.", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", ".KWWWWWWK.", "..KKKKKK.."], p: { K, W: "#fffaf0" } },
    clockG: { r: ["..KKKKKK..", ".KWWWWWWK.", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", ".KWWWWWWK.", "..KKKKKK.."], p: { K: "#c9940f", W: "#fff6d8" } },   // 상점 벽시계 = 금테
    mug: { r: ["KKKKKK..", "KBBBBKKK", "KWWWWK.K", "KWWWWK.K", "KWWWWKKK", "KWWWWK..", ".KKKK..."], p: { K, B: "#6b3f2a", W: "#fff" } },
    can: { r: ["KKKK", "KRRK", "KWWK", "KRRK", "KRRK", "KKKK"], p: { K, R: "#ff5a6a", W: "#fff" } },
    lemon: { r: ["KKKK", "KYYK", "KWWK", "KYYK", "KYYK", "KKKK"], p: { K, Y: "#ffd23f", W: "#fff" } },
    coin: { r: [".KK.", "KYYK", "KYYK", ".KK."], p: { K, Y: "#ffd23f" } },
    birdU: { r: ["B.....B", ".B...B.", "..BBB..", ".BBBBBY", "..BBB.."], p: { B: "#5a7ae0", Y: "#ffb03a" } },
    birdD: { r: [".......", "..BBB..", ".BBBBBY", "B.BBB.B", "......."], p: { B: "#5a7ae0", Y: "#ffb03a" } },
    birdS: { r: [".BB..", "BWBB.", "BBBBY", ".BBB.", ".Y.Y."], p: { B: "#5a7ae0", W: "#fff", Y: "#ffb03a" } },
    cloud: { r: ["..WWW...", ".WWWWWW.", "WWWWWWWW"], p: { W: "#ffffff" } },
    sheart: { r: [".W.W.", "WWWWW", ".WWW.", "..W.."], p: { W: "#ffffff" } },
    book: { r: ["KKKKK", "KRRRK", "KRWRK", "KRRRK", "KKKKK"], p: { K, R: "#5aa8ff", W: "#fff" } },
    obook: { r: ["KK...KK", "KWWKWWK", "KWWKWWK", ".KKKKK."], p: { K, W: "#fff" } },
    seed: { r: [".K.", "KWK", "KSK", "KSK", ".K."], p: { K: "#2e2040", W: "#fff7e0", S: "#5a4a40" } },
    hammer: { r: ["KKKKK", "KGGGK", "KKKKK", "..KB.", "..KB.", "..KB.", "..KK."], p: { K, G: "#bcc6d6", B: "#c98d5a" } },
    letter: { r: ["KKKKKKK", "KKWWWKK", "KWKWKWK", "KWWKWWK", "KKKKKKK"], p: { K, W: "#fff" } },
    sweat: { r: [".B.", "BBB", "BWB", ".B."], p: { B: "#5aa8ff", W: "#dff4ff" } },
    anger: { r: ["RR.RR", "R...R", ".....", "R...R", "RR.RR"], p: { R: "#ff4f6a" } },
    ink: { r: [".KKK.", "KKKKK", "KKKKK", ".KKK."], p: { K: "#3a2a52" } },
    pebble: { r: [".GG.", "GWGG", "GGGG", ".GG."], p: { G: "#9aa0b0", W: "#e2e6ee" } },
    cup: { r: ["KKKK.", "KWWKK", "KWWK.", "KWWKK", ".KK.."], p: { K, W: "#fff" } },
    spark: { r: [".Y.", "YWY", ".Y."], p: { Y: "#ffd23f", W: "#fff" } },
    bolt: { r: ["..Y", ".Y.", "YYY", ".Y.", "Y.."], p: { Y: "#ffd23f" } },
    drop: { r: ["B", "B"], p: { B: "#7a4a2a" } },
    wdrop: { r: ["B", "B"], p: { B: "#5aa8ff" } },
    bwrap: { r: ["WWWWW", "W.W.W", "WWWWW"], p: { W: "#e8f4ff" } },
  };
  /* 화이트보드 낙서(마커) 7개 → 7개 모이면 명작(MASTER) */
  const DOOD = [
    { r: ["...R...", "..RRR..", "RRRRRRR", ".RRRRR.", ".R...R."], p: { R: "#ff9a3c" } },
    { r: [".RR.RR.", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."], p: { R: "#ff6b8a" } },
    { r: ["B.....B", "BB...BB", "B.B.B.B", "B.....B", ".BBBBB."], p: { B: "#5aa8ff" } },
    { r: [".G...G..", "G.G.G.G.", "...G...G"], p: { G: "#3fbf6a" } },
    { txt: "LGTM", c: "#3a6fc8" },
    { r: ["....O..", "OOOOOO.", "....O.."], p: { O: "#ff9a3c" } },
    { r: [".....G", "....G.", "G..G..", ".GG..."], p: { G: "#3fbf6a" } }];
  const DPOS = [[148, 8], [186, 10], [150, 34], [188, 38], [146, 62], [190, 64], [124, 12]];
  const MASTER = { r: [".BB........BB.", "B..B......B..B", "B...BBBBBB...B", ".B..........B.", "B...KK..KK...B", "B...KK..KK...B", "B.PP..RR..PP.B", "B.PP......PP.B", ".B...B..B...B.", "..B...BB...B..", "...BBBBBBBB..."], p: { B: "#c0703a", K: "#2e2040", P: "#ff8ab0", R: "#d9667a" } };
  /* 반응 정의: n = 이름(자막·도감), t = 말풍선, s = 소리 표기, snd = 합성음 */
  const P_ = (ko, en) => [ko, en];
  const AR = {
    peng: [{ n: P_("뒤뚱 점프", "Waddle hop"), t: P_("꽥!", "Quack!"), s: P_("꽥", "quack"), m: "waddle", snd: "quack" }, { n: P_("날개 파닥", "Flap flap"), t: P_("파닥파닥!", "Flap flap!"), s: P_("파닥", "flap"), m: "flap", snd: "flap" }, { n: P_("고개 갸웃", "Head tilt"), t: P_("…꽥?", "…Quack?"), s: P_("뿅", "boop"), m: "tilt", snd: "blip" }],
    cat: [{ n: P_("귀 쫑긋", "Ears up"), t: P_("냥?", "Mew?"), s: P_("냥", "mew"), m: "ear", snd: "meow" }, { n: P_("골골송", "Purring"), t: P_("골골~ ♪", "Purr~ ♪"), s: P_("골골", "purr"), m: "purr", snd: "purr" }, { n: P_("기지개", "Stretch"), t: P_("냐아앙~", "Nyaaa~"), s: P_("냐앙", "nya"), m: "stretch", snd: "meow" }],
    bot: [{ n: P_("눈 빙글", "Eye spin"), t: P_("삐빅?", "Beep-boop?"), s: P_("삐빅", "beep"), m: "eyes", snd: "beep" }, { n: P_("안테나 반짝", "Antenna blink"), t: P_("01001!", "01001!"), s: P_("띠링", "ding"), m: "ant", snd: "ping" }, { n: P_("처리 중", "Processing"), t: P_("처리 중…", "Processing…"), s: P_("위잉", "whirr"), m: "tilt", snd: "hum" }],
    bvr: [{ n: P_("앞니 반짝", "Tooth shine"), t: P_("딱딱!", "Clack clack!"), s: P_("딱", "clack"), m: "teeth", snd: "tick" }, { n: P_("꼬리 탁", "Tail slap"), t: P_("탁!", "Slap!"), s: P_("탁", "slap"), m: "tail", snd: "thud" }, { n: P_("망치 번쩍", "Hammer time"), t: P_("뚝딱!", "Bang bang!"), s: P_("뚝딱", "bang"), m: "tool", snd: "hammer" }],
    otr: [{ n: P_("조약돌 저글링", "Pebble juggling"), t: P_("헤헤 보세요", "Hehe, look!"), s: P_("달그락", "clatter"), m: "juggle", snd: "rattle" }, { n: P_("손 비비기", "Paw rub"), t: P_("뭐 줄 거예요?", "Got a treat?"), s: P_("슥슥", "rub"), m: "rub", snd: "whoosh" }, { n: P_("배 통통", "Belly pat"), t: P_("통통!", "Pat pat!"), s: P_("통통", "pat"), m: "pat", snd: "thud2" }],
    oct: [{ n: P_("먹물 퐁", "Ink puff"), t: P_("앗, 미안!", "Oops, sorry!"), s: P_("퐁", "poof"), m: "ink", snd: "pop" }, { n: P_("팔 흔들기", "Arm wave"), t: P_("안녕안녕!", "Hi hi!"), s: P_("흔들", "wave"), m: "wave", snd: "whoosh" }, { n: P_("빨개짐", "Blush"), t: P_("부끄…", "So shy…"), s: P_("뿅", "boop"), m: "blush", snd: "blip" }],
    ham: [{ n: P_("볼 빵빵", "Puffy cheeks"), t: P_("찍!", "Squeak!"), s: P_("찍", "squeak"), m: "cheek", snd: "squeak" }, { n: P_("해바라기씨", "Sunflower seed"), t: P_("냠냠", "Nom nom"), s: P_("오독", "crunch"), m: "seed", snd: "crunch" }, { n: P_("데굴", "Roll"), t: P_("데굴데굴~", "Rolly rolly~"), s: P_("데굴", "roll"), m: "roll", snd: "roll" }],
  };
  const ANGRY = [P_("일하는 중이에요!", "I'm working!"), P_("집중 깨져요~", "You broke my focus~"), P_("나중에 놀아요!", "Play later!")];
  const BOSSW = [{ n: P_("끄덕", "Nod"), t: P_("엣헴!", "Ahem!"), s: P_("흠", "hmm"), m: "nod", snd: "thud" }, { n: P_("엄지 척", "Thumbs up"), t: P_("수고 많아~ 👍", "Nice work~ 👍"), s: P_("뿅", "boop"), m: "thumb", snd: "blip" }, { n: P_("허허", "Chuckle"), t: P_("허허허", "Ho ho ho"), s: P_("허허", "ho ho"), m: "sway", snd: "hoho" }];
  const BOSSN = [P_("왜, 왜 그러나?", "W-what is it?"), P_("허허… 간지럽네", "Heh… that tickles"), P_("그만~ 일해야지", "Enough~ back to work"), P_("(뿌듯)", "(proud)"), P_("엣헴엣헴", "Ahem ahem"), P_("알았어 알았어", "Okay, okay")];
  const BABY = [{ n: P_("아기 깡충", "Baby hop"), t: P_("응애?", "Goo?"), s: P_("뿅", "boop"), m: "bhop", snd: "squeak" }, { n: P_("까꿍", "Peekaboo"), t: P_("까꿍!", "Peekaboo!"), s: P_("까꿍", "boo"), m: "bhop", snd: "blip" }, { n: P_("도넛 냠", "Donut nom"), t: P_("(도넛 냠)", "(nom donut)"), s: P_("냠", "nom"), m: "bhop", snd: "crunch" }];
  const EGGS = [
    { id: "jack", e: "🎰", n: P_("자판기 당첨", "Vending jackpot"), c: P_("자판기를 연달아 5번 (가끔)", "Vending machine 5× in a row (sometimes)"), h: P_("오늘 운이 좋다면… 끈기도 필요해요", "If luck is on your side… keep at it") },
    { id: "trick", e: "🌻", n: P_("사장님 개인기", "Boss's party trick"), c: P_("사장님 10번 연속", "The boss 10× in a row"), h: P_("사장님은 칭찬에 약해요. 아주 많이", "The boss loves attention. Lots of it") },
    { id: "cuckoo", e: "🕰️", n: P_("햄찌 뻐꾸기", "Hamster cuckoo"), c: P_("벽시계를 정각(○○:00)에", "The wall clock right on the hour"), h: P_("시계가 딱 맞을 때 누가 인사해요", "Someone says hi when the clock is exact") },
    { id: "letter", e: "✉️", n: P_("새의 편지", "A bird's letter"), c: P_("창가에 새가 앉아 있을 때 창문", "The window while a bird sits on the sill"), h: P_("창가에 손님이 앉아 있을 때", "When a guest sits by the window") },
    { id: "wave", e: "🌊", n: P_("파도타기", "The wave"), c: P_("6초 안에 직원 모두 한 번씩", "Every staff member once within 6 s"), h: P_("모두에게 한 번씩 인사하면", "Say hi to everyone") },
    { id: "bsod", e: "😵", n: P_("모니터 기절", "Monitor faint"), c: P_("모니터 6번 연타", "The monitor 6× rapidly"), h: P_("모니터를 너무 괴롭히면…", "Bug the monitor too much…") },
    { id: "art", e: "🖼️", n: P_("화이트보드 명작", "Whiteboard masterpiece"), c: P_("화이트보드 낙서 7개", "7 doodles on the whiteboard"), h: P_("그리다 보면 작품이 돼요", "Keep doodling and it becomes art") },
    { id: "caff", e: "⚡", n: P_("카페인 풀파워", "Caffeine overdrive"), c: P_("4초 안에 커피 3번", "Coffee 3× within 4 s"), h: P_("커피를 연거푸 마시면", "Drink coffee back to back") }];
  const EGG = {}; EGGS.forEach(e => (EGG[e.id] = e));
  const ONAME = { mon: P_("모니터", "Monitor"), mug: P_("커피", "Coffee"), plant: P_("화분", "Plant"), win: P_("창문", "Window"), win2: P_("창문", "Window"), elev: P_("엘리베이터", "Elevator"), wb: P_("화이트보드", "Whiteboard"),
    clock: P_("벽시계", "Wall clock"), vend: P_("자판기", "Vending machine"), cart: P_("상점 카트", "Shop cart"), baby: P_("아기", "Baby") };
  const SHELFN = [P_("책장", "Bookshelf"), P_("서버랙", "Server rack"), P_("책꽂이", "Shelf"), P_("상자", "Box")];
  /* 같은 반응 연속 금지: 한 바퀴(주머니)를 섞어 차례로 꺼내고, 새 주머니 첫 장이 직전 것과 같으면 바꿈. 첫 번째 누름은 늘 0번(대표 반응) */
  function pickV(s, nv) {
    if (nv < 2) return 0;
    if (s.n === 0) { s.prev = 0; const a = [...Array(nv - 1).keys()].map(i => i + 1); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } s.bag = a; return 0; }   // 첫 바퀴는 나머지를 모두 한 번씩
    if (!s.bag.length) { const a = [...Array(nv).keys()]; for (let i = nv - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } if (a[0] === s.prev) [a[0], a[1]] = [a[1], a[0]]; s.bag = a; }
    const v = s.bag.shift(); s.prev = v; return v;
  }
  /* 회의 모드·움직임 줄이기면 소리 없음. 볼륨은 타자 소리 수준(0.03~0.06) */
  function tone(ac, t, type, f0, f1, d, vol) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .02);
  }
  let nbuf = null, nac = null;
  function noise(ac, t, d, type, f0, f1, vol) {
    if (nac !== ac) { const len = Math.floor(ac.sampleRate * .5), b = ac.createBuffer(1, len, ac.sampleRate), x = b.getChannelData(0); for (let i = 0; i < len; i++) x[i] = Math.random() * 2 - 1; nbuf = b; nac = ac; }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nbuf; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + d); f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t, Math.random() * .3); s.stop(t + d + .02);
  }
  const SND = {
    quack: (a, t) => { tone(a, t, "square", 520, 300, .12, .03); tone(a, t + .02, "sawtooth", 260, 180, .1, .015); },
    flap: (a, t) => [0, .07, .14].forEach(d => noise(a, t + d, .05, "bandpass", 1800, 0, .08)),
    blip: (a, t) => tone(a, t, "sine", 600, 1400, .1, .05),
    meow: (a, t) => { tone(a, t, "triangle", 520, 900, .12, .045); tone(a, t + .12, "triangle", 900, 560, .16, .04); },
    purr: (a, t) => [0, .16, .32].forEach(d => tone(a, t + d, "sawtooth", 70, 60, .13, .02)),
    beep: (a, t) => { tone(a, t, "square", 1200, 0, .06, .025); tone(a, t + .08, "square", 1600, 0, .06, .025); },
    ping: (a, t) => tone(a, t, "sine", 1760, 0, .18, .04),
    hum: (a, t) => tone(a, t, "sawtooth", 110, 150, .4, .02),
    tick: (a, t) => noise(a, t, .03, "highpass", 3000, 0, .12),
    thud: (a, t) => tone(a, t, "sine", 180, 80, .12, .07),
    thud2: (a, t) => { tone(a, t, "sine", 200, 90, .1, .06); tone(a, t + .14, "sine", 200, 90, .1, .06); },
    hammer: (a, t) => [0, .15].forEach(d => { noise(a, t + d, .03, "highpass", 2500, 0, .12); tone(a, t + d, "sine", 160, 80, .08, .05); }),
    rattle: (a, t) => [0, .06, .13].forEach(d => noise(a, t + d, .05, "bandpass", 900, 0, .1)),
    whoosh: (a, t) => noise(a, t, .22, "bandpass", 600, 2400, .07),
    pop: (a, t) => tone(a, t, "sine", 380, 900, .08, .06),
    squeak: (a, t) => tone(a, t, "sine", 1800, 2600, .07, .035),
    crunch: (a, t) => [0, .09].forEach(d => noise(a, t + d, .04, "highpass", 2500, 0, .1)),
    roll: (a, t) => [0, .1, .2].forEach((d, i) => tone(a, t + d, "sine", 260 - i * 30, 140, .08, .05)),
    huff: (a, t) => noise(a, t, .18, "lowpass", 900, 300, .12),
    slurp: (a, t) => noise(a, t, .3, "bandpass", 400, 1600, .07),
    hiss: (a, t) => noise(a, t, .28, "highpass", 3500, 1500, .07),
    coin: (a, t) => { tone(a, t, "square", 988, 0, .07, .025); tone(a, t + .07, "square", 1319, 0, .22, .025); },
    fanfare: (a, t) => [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * .09, "triangle", f, 0, .16, .045)),
    chime: (a, t) => [880, 1175, 1568].forEach((f, i) => tone(a, t + i * .1, "sine", f, 0, .3, .04)),
    cuckoo: (a, t, n) => { for (let i = 0; i < (n || 1); i++) { tone(a, t + i * .6, "sine", 784, 0, .14, .05); tone(a, t + i * .6 + .17, "sine", 622, 0, .24, .05); } },
    marker: (a, t) => [0, .07].forEach(d => tone(a, t + d, "square", 2200, 2600, .04, .012)),
    ding: (a, t) => { tone(a, t, "triangle", 1568, 0, .5, .045); tone(a, t + .02, "sine", 2093, 0, .3, .02); },
    hoho: (a, t) => [0, .14, .28].forEach(d => tone(a, t + d, "triangle", 220, 200, .1, .04)),
    heart: (a, t) => [0, .18].forEach(d => tone(a, t + d, "sine", 80, 60, .1, .09)),
    chirp: (a, t) => [0, .1].forEach(d => tone(a, t + d, "sine", 2400, 3200, .06, .03)),
    fizz: (a, t) => { noise(a, t, .03, "highpass", 2500, 0, .12); noise(a, t + .3, .25, "highpass", 5000, 3000, .05); },
    boing: (a, t) => tone(a, t, "sine", 200, 620, .2, .06),
    keys: (a, t) => [0, .05, .1, .15, .2].forEach(d => noise(a, t + d, .03, "bandpass", 3000, 0, .07)),
    bell: (a, t) => [0, .12].forEach(d => { tone(a, t + d, "triangle", 2637, 0, .22, .03); tone(a, t + d + .01, "sine", 3520, 0, .14, .012); }),   // 🙈 현관 종 딸랑
  };
  function play(ac, name, n) { const f = SND[name]; if (!ac || !f || ac.state !== "running") return; try { f(ac, ac.currentTime + .01, n); } catch {} }
  return { ART, DOOD, DPOS, MASTER, AR, ANGRY, BOSSW, BOSSN, BABY, EGGS, EGG, ONAME, SHELFN, pickV, play };
})();

/* 창마다 하나: 누른 기록 → 반응(R). ctx.store("poke") = { eggs: {id: 찾은 시각}, wb: [낙서 번호], art: 명작 시각, fl: {층: 꽃 핀 시각} } */
function pkState(ctx) {
  const L = p => Array.isArray(p) ? p[ctx.lang === "en" ? 1 : 0] : p || "";
  const st = new Map(), out = new Map(), books = {};
  let wave = [], waveT = -99, toast = null, last = null, raw = null, sv = null, onSave = null;
  const fresh = () => ({ eggs: {}, wb: [], art: 0, fl: {} });
  function load() {
    const r = ctx.store.get("poke", "") || "";
    if (r === raw && sv) return false;
    raw = r; sv = fresh();
    try { const j = JSON.parse(r || "null"); if (j && typeof j === "object") { if (j.eggs && typeof j.eggs === "object") sv.eggs = j.eggs; if (Array.isArray(j.wb)) sv.wb = j.wb.filter(v => v >= 0 && v < 7).slice(0, 7); sv.art = +j.art || 0; if (j.fl && typeof j.fl === "object") sv.fl = j.fl; } } catch {}
    return true;
  }
  function save() { const k = Object.keys(sv.fl); if (k.length > 40) k.slice(0, k.length - 40).forEach(x => delete sv.fl[x]); raw = JSON.stringify(sv); try { ctx.store.set("poke", raw); } catch {} if (onSave) onSave(); }
  load();
  const eggN = () => PK.EGGS.filter(e => sv.eggs[e.id]).length;
  function egg(id, R) { R.egg = id; if (!sv.eggs[id]) { sv.eggs[id] = Date.now(); save(); toast = { id, t0: R.t0, n: eggN() }; R.newEgg = 1; } }
  const act = (k, tc) => { const R = out.get(k); return R && tc - R.t0 < R.dur ? R : null; };
  /* I: { fk 층 키, obj, kind staff|meet|boss, an 동물, ask, away, stall, bs 사장님 상태, deco 책장 종류, bird 창가 새, clock {s 하루 초, reset 리셋까지 초|null}, vOff 자판기 꺼짐, carBusy, staff [직원 층 키], x, y, src } */
  function tap(I, tc) {
    load();
    const key = I.fk + "." + I.obj, obj = I.obj;
    let s = st.get(key); if (!s) { s = { n: 0, last: -9, streak: 0, bag: [], prev: -1, hist: [] }; st.set(key, s); }
    const gap = obj === "a" && I.kind === "boss" ? 1.2 : obj === "mug" ? 1.6 : .8;
    s.streak = tc - s.last < gap ? s.streak + 1 : 1; s.last = tc; s.hist.push(tc); if (s.hist.length > 12) s.hist.shift();
    const R = { k: key, fk: I.fk, obj, kind: I.kind, an: I.an, deco: I.deco || 0, t0: tc, n: s.n, streak: s.streak, dur: 1.5, v: 0, x: I.x, y: I.y, src: I.src, t: "", name: "", s: "", snd: "" };
    const set = (a, x) => Object.assign(R, { m: a.m, t: L(a.t), name: L(a.n), s: L(a.s), snd: a.snd }, x || {});
    const pick = (arr, x) => { const v = PK.pickV(s, arr.length); set(arr[v], Object.assign({ v }, x || {})); };
    const P2 = (ko, en) => L([ko, en]);
    if (obj === "a" && I.kind !== "boss") {
      if (I.away || I.stall) Object.assign(R, { m: "away", t: I.stall ? P2("💤 …zZ (응답 없음)", "💤 …zZ (no reply)") : P2("(자리 비움)", "(away)"), name: I.stall ? P2("멈춤 의심 → 쿨쿨", "Stalled → snoozing") : P2("자리 비움", "Away"), s: "", dur: 1.4 });
      else if (s.streak >= 4) Object.assign(R, { m: "angry", t: L(PK.ANGRY[(s.n + fnv(I.fk)) % 3]), name: P2("연타 → 짜증", "Spam → grumpy"), s: P2("흥", "hmph"), snd: "huff", dur: 1.7 });
      else pick(PK.AR[I.an] || PK.AR.ham, { dur: 1.5 });
      if (I.ask) { R.ask = 1; R.dur = Math.max(R.dur, 2.4); }
    } else if (obj === "a") {
      const bs = I.bs || "work"; R.bs = bs;
      if (s.streak >= 10) { Object.assign(R, { m: "trick", t: P2("짜잔~ 볼주머니 저글링 🌻", "Ta-da~ cheek-pouch juggling 🌻"), name: P2("개인기 (10번째)", "Party trick (10th)"), s: P2("빰빠밤", "ta-da"), snd: "fanfare", dur: 3.4 }); egg("trick", R); }
      else if (s.streak >= 4) Object.assign(R, { m: "nod", t: L(PK.BOSSN[(s.streak - 4) % PK.BOSSN.length]), name: P2("계속 누르면 쑥스러움", "Keeps clicking → bashful"), s: P2("흠", "hmm"), snd: "thud", dur: 1.2 });
      else if (bs === "coffee" && s.streak === 1) Object.assign(R, { m: "spill", t: P2("앗 뜨거! ☕", "Ouch, hot! ☕"), name: P2("커피 중 깜짝 → 출렁", "Startled mid-coffee → spill"), s: P2("철렁", "splash"), snd: "hiss", dur: 1.6 });
      else if (bs === "doze" && s.streak === 1) Object.assign(R, { m: "startle", t: P2("안 잤어! 진짜야!", "I wasn't asleep! Really!"), name: P2("조는 중 깜짝 → 화들짝", "Dozing → jolt awake"), s: P2("화들짝", "jolt"), snd: "boing", dur: 1.8 });
      else pick(PK.BOSSW, { dur: 1.4 });
    } else if (obj === "baby") pick(PK.BABY, { dur: 1.2 });
    else if (obj === "mug") {
      const n3 = s.hist.filter(x => tc - x < 4).length;
      if (n3 >= 3 && I.kind !== "meet") { Object.assign(R, { m: "caff", t: P2("카페인 풀파워! ⚡", "Caffeine overdrive! ⚡"), name: P2("카페인 풀파워", "Caffeine overdrive"), s: P2("두근", "thump"), snd: "heart", dur: 4 }); egg("caff", R); s.hist = []; }
      else { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["slurp", "hsteam", "hot"][v], t: [P2("후루룩", "Slurp"), P2("(김이 하트 모양)", "(heart-shaped steam)"), P2("앗 뜨거!", "Ouch, hot!")][v], name: [P2("김 모락 · 후루룩", "Steam · slurp"), P2("김이 하트로", "Heart steam"), P2("앗 뜨거 · 김 확", "Too hot · puff")][v], s: [P2("후루룩", "slurp"), P2("모락", "puff"), P2("치익", "hiss")][v], snd: ["slurp", "blip", "hiss"][v], dur: 1.6 }); }
    } else if (obj === "mon") {
      if (s.streak >= 6) { Object.assign(R, { m: "bsod", t: P2("…껐다 켰어요", "…turned it off and on"), name: P2("모니터 기절 → 재부팅", "Monitor faint → reboot"), s: P2("피융", "fzzt"), snd: "hiss", dur: 2.8 }); egg("bsod", R); }
      else { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["frag", "pass", "type"][v], t: ["", "", P2("타닥타닥", "Tap tap tap")][v], name: [P2("코드 조각 튐", "Code bits fly"), P2("✓ 테스트 통과", "✓ Tests pass"), P2("타자 빨라짐", "Typing speeds up")][v], s: [P2("톡", "tok"), P2("띵", "ding"), P2("타닥", "tap")][v], snd: ["tick", "ping", "keys"][v], dur: 1.3 }); }
    } else if (obj === "plant") {
      const v = PK.pickV(s, 4), m = ["sway", "leaf", "flower", "sway"][v];
      Object.assign(R, { v, m, name: { sway: P2("살랑 흔들", "Sway"), leaf: P2("잎 하나 팔랑", "A leaf flutters"), flower: P2("꽃이 폈다!", "It bloomed!") }[m], s: P2("사락", "rustle"), snd: m === "flower" ? "pop" : "whoosh", dur: 1.2 });
      if (m === "flower") { sv.fl[I.fk] = Date.now(); save(); }
    } else if (obj === "vend") {
      const pv = out.get(key), busy = pv && tc - pv.t0 < 1.3 && ["can", "lemon", "coin", "jack"].includes(pv.m);
      if (I.vOff) Object.assign(R, { m: "off", t: P2("💤 절전 중이라 안 나와요", "💤 Power save · nothing comes out"), name: P2("절전 → 안 나옴", "Power save → nothing"), s: "…", snd: "thud", dur: 1.8 });
      else if (s.streak >= 5 && (!sv.eggs.jack || Math.random() < .34)) { Object.assign(R, { m: "jack", t: P2("당첨! 하나 더 🎉", "Jackpot! One more 🎉"), name: P2("당첨! 하나 더", "Jackpot! One more"), s: P2("빠밤", "ta-da"), snd: "fanfare", dur: 2.8 }); egg("jack", R); }
      else if (busy) Object.assign(R, { m: "rattle", t: P2("덜컹덜컹", "Rattle rattle"), name: P2("연타 → 덜컹", "Spam → rattle"), s: P2("덜컹", "clunk"), snd: "rattle", dur: 1.2, keep: pv.m === "rattle" ? pv.keep : pv });
      else { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["can", "lemon", "coin"][v], t: [P2("칙! 🥤", "Psst! 🥤"), P2("오늘의 추천: 레몬맛", "Today's pick: lemon"), P2("잔돈 10원 🪙", "Change: 10 won 🪙")][v], name: [P2("캔 덜컹 → 칙!", "Can clunk → psst!"), P2("레몬맛 추천", "Lemon pick"), P2("잔돈 굴러감", "Change rolls out")][v], s: [P2("덜컹", "clunk"), P2("덜컹", "clunk"), P2("또르르", "clink")][v], snd: ["fizz", "rattle", "coin"][v], dur: 1.8 }); }
    } else if (obj === "elev") {
      const v = PK.pickV(s, 3);
      Object.assign(R, { v, m: "elev", t: ["", P2("(화분이 혼자 탔어요)", "(a plant rode alone)"), P2("👋 안녕하세요~", "👋 Hello~")][v], name: [P2("띵! 빈 카", "Ding! Empty car"), P2("화분 승객", "Plant passenger"), P2("아기 직원 인사", "Baby says hi")][v], s: P2("띵", "ding"), snd: "ding", dur: 3.2 });
      if (I.carBusy) Object.assign(R, { res: 1, t: P2("🛗 예약! 직원이 쓰는 중이에요", "🛗 Booked! Staff is riding"), name: P2("예약 → 비면 와요", "Booked → comes when free"), dur: 1.8 });
    } else if (obj === "clock") {
      const cs = I.clock ? I.clock.s : 0, hm = `${String(Math.floor(cs / 3600)).padStart(2, "0")}:${String(Math.floor(cs % 3600 / 60)).padStart(2, "0")}`, rs = I.clock && I.clock.reset != null ? I.clock.reset : null;
      const rsT = rs == null ? "" : `${Math.floor(rs / 3600)}${P2("시간 ", "h ")}${Math.floor(rs % 3600 / 60)}${P2("분", "m")}`;
      if (Math.floor(cs % 3600 / 60) === 0) { Object.assign(R, { m: "cuckoo", t: P2("뻐꾹!", "Cuckoo!"), hr: (Math.floor(cs / 3600) % 12) || 12, name: P2("정각 → 햄찌 뻐꾸기", "On the hour → hamster cuckoo"), s: P2("뻐꾹", "cuckoo"), snd: "cuckoo", dur: 3.2 }); egg("cuckoo", R); }
      else { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["wob", "spin", "tick"][v], t: `🕰️ ${P2("지금", "Now")} ${hm}${rs != null ? " · " + P2("한도 리셋까지 ", "limit resets in ") + rsT : ""}`, ts: `${hm}${rs != null ? " · " + P2("리셋 ", "reset ") + Math.floor(rs / 3600) + ":" + String(Math.floor(rs % 3600 / 60)).padStart(2, "0") : ""}`, name: [P2("시각 · 리셋까지", "Time · until reset"), P2("바늘 빙글", "Hands spin"), P2("똑딱 흔들", "Tick-tock wobble")][v], s: P2("똑딱", "tick"), snd: "tick", dur: 1.9 }); }
    } else if (obj === "wb") {
      if (sv.art) { sv.wb = []; sv.art = 0; save(); Object.assign(R, { m: "wipe", t: P2("다시 그려요", "Fresh start"), name: P2("지우개 쓱", "Eraser swipe"), s: P2("쓱싹", "swish"), snd: "whoosh", dur: 1 }); }
      else {
        sv.wb.push(sv.wb.length % 7); R.di = sv.wb.length - 1; Object.assign(R, { m: "draw", name: P2(`낙서 추가 (${sv.wb.length}/7)`, `Doodle (${sv.wb.length}/7)`), s: P2("끽끽", "squeak"), snd: "marker", dur: .9 });
        if (sv.wb.length >= 7) { sv.art = Date.now(); Object.assign(R, { m: "art", t: P2("명작! ✨", "Masterpiece! ✨"), name: P2("명작 완성", "Masterpiece done"), snd: "fanfare", dur: 2.6 }); egg("art", R); }
        save();
      }
    } else if (obj === "shelf") {
      if (I.deco === 1) { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["led", "fan", "ping"][v], t: ["", P2("위잉~", "Whirr~"), "ping 12ms ✓"][v], name: [P2("LED 다다닥", "LED flicker"), P2("팬 위잉", "Fan whirr"), P2("핑 12ms", "Ping 12ms")][v], s: [P2("다다닥", "blink"), P2("위잉", "whirr"), P2("핑", "ping")][v], snd: ["beep", "hum", "ping"][v], dur: 1.3 }); }
      else if (I.deco === 3) { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["boxhop", "bwrap", "peek"][v], t: [P2("(…텅 비었어요)", "(…it's empty)"), P2("뽁!", "Pop!"), P2("택배 왔나?", "A delivery?")][v], name: [P2("상자 들썩", "Box hop"), P2("뽁뽁이 톡", "Bubble wrap pop"), P2("상자 속 확인", "Peek inside")][v], s: [P2("덜컥", "clunk"), P2("뽁", "pop"), P2("부스럭", "rustle")][v], snd: ["thud", "pop", "whoosh"][v], dur: 1.3 }); }
      else if (I.deco === 0 && books[I.fk] != null) { Object.assign(R, { m: "bookin", name: P2("책 쏙 (원위치)", "Book back in"), s: P2("쏙", "tuck"), snd: "pop", dur: .6, bk: books[I.fk] }); books[I.fk] = null; }
      else { const v = PK.pickV(s, 3), ms = I.deco === 0 ? ["bookout", "bookdrop", "read"] : ["read", "bookdrop", "dust"]; Object.assign(R, { v, m: ms[v], t: ms[v] === "dust" ? P2("에취!", "Achoo!") : "", name: { bookout: P2("책 한 권 삐죽", "A book sticks out"), bookdrop: P2("책 툭 떨어짐", "A book drops"), read: P2("펼친 책 둥실", "Open book floats"), dust: P2("먼지 폴폴 → 에취", "Dust puff → achoo") }[ms[v]], s: { bookout: P2("스윽", "slide"), bookdrop: P2("툭", "thump"), read: P2("팔락", "flip"), dust: P2("에취", "achoo") }[ms[v]], snd: { bookout: "whoosh", bookdrop: "thud", read: "whoosh", dust: "huff" }[ms[v]], dur: 1.4, bk: (s.n * 3 + 7) % (I.nb || 15) }); if (ms[v] === "bookout") books[I.fk] = R.bk; }
    } else if (obj === "win" || obj === "win2") {
      if (I.bird && obj === "win") { Object.assign(R, { m: "letter", t: P2("편지다! ✉️", "A letter! ✉️"), name: P2("새가 편지를 두고 감", "The bird left a letter"), s: P2("짹", "tweet"), snd: "chirp", dur: 3 }); egg("letter", R); }
      else { const v = PK.pickV(s, 3); Object.assign(R, { v, m: ["bird", "cloud", "fog"][v], name: [P2("새가 푸드덕", "A bird flutters by"), P2("구름 둥실", "A cloud drifts"), P2("입김 하트", "Breath heart")][v], s: [P2("푸드덕", "flutter"), "", P2("호~", "hah~")][v], snd: ["flap", "", "whoosh"][v], dur: 1.8 }); }
    } else if (obj === "cart") Object.assign(R, { m: "wob", t: P2("🛒 소품은 자금으로!", "🛒 Decor costs funds!"), name: P2("카트 덜컹", "Cart rattle"), s: P2("덜컹", "clunk"), snd: "rattle", dur: 1.4 });
    else return null;
    /* 파도타기: 6초 안에 직원 모두(직원이 하나뿐이면 사장님까지) 한 번씩 */
    if (obj === "a") {
      const need = (I.staff || []).length >= 2 ? I.staff : (I.staff || []).length === 1 ? I.staff.concat(["boss"]) : [];
      wave = wave.filter(w => tc - w.t < 6 && w.fk !== I.fk); wave.push({ fk: I.fk, t: tc });
      if (need.length >= 2 && need.every(k => wave.some(w => w.fk === k))) { waveT = tc; R.wave = 1; egg("wave", R); wave = []; }
    }
    s.n++; out.set(key, R); last = R;
    return R;
  }
  return {
    L, tap, act, load, save, sv: () => sv, eggN, out: () => out, books, last: () => last,
    toast: tc => toast && tc - toast.t0 < 2.8 ? toast : null,
    wave: tc => tc - waveT < 2.6 ? tc - waveT : null,
    busy: tc => { if (toast && tc - toast.t0 < 3) return true; if (tc - waveT < 2.6) return true; for (const R of out.values()) if (tc - R.t0 < R.dur + .1) return true; return false; },
    onSave: f => { onSave = f; },
    tgName: (R, aName) => R.obj === "a" ? (R.kind === "boss" ? L(["👑 사장님", "👑 Boss"]) : `${EMO[R.an] || ""} ${aName(R.an)}`) : R.obj === "shelf" ? L(PK.SHELFN[R.deco || 0]) : L(PK.ONAME[R.obj]),
  };
}

/* 그리기 도우미(두 화면 공용, HTML 문자열) */
const pkR = Math.round;
const pkIp = (x, y, w, h, c, css) => `<i class="b" style="left:${pkR(x)}px;top:${pkR(y)}px;width:${pkR(w)}px;height:${pkR(h)}px;background:${c};${css || ""}"></i>`;
const pkIm = (a, sc, x, y, css) => WB.img(a, sc, pkR(x), pkR(y), css || "");
const pkAh = (a, sc) => a.r.length * sc, pkAw = (a, sc) => Math.max(...a.r.map(r => r.length)) * sc;
const pkLab = (x, y, t, css) => `<b class="pk-l" style="left:${pkR(x)}px;top:${pkR(y)}px;${css || ""}">${t}</b>`;
const PK_OUT = "text-shadow:1px 1px 0 #2e2040,-1px 0 0 #2e2040,0 -1px 0 #2e2040,1px 0 0 #2e2040,0 1px 0 #2e2040,-1px -1px 0 #2e2040";
const pkSq = u => u < .07 ? [1.1, .88] : u < .16 ? [.95, 1.06] : u < .25 ? [1.02, .98] : [1, 1];   // 누른 순간 squash 0.25초
const pkSnd = (on, x, y, t, u) => !on || u > 1 || !t ? "" : `<b class="pk-snd" style="left:${pkR(Math.max(2, x))}px;top:${pkR(y - u * 10)}px;opacity:${(1 - Math.max(0, u - .6) / .4).toFixed(2)}">♪ ${t}</b>`;
const pkBird = t => (t % 12) >= 3.6 && (t % 12) < 7.2;   // 창가에 새가 앉아 있는 시간(12초 중 3.6초)
/* 스프라이트 칸 → 화면 좌표 (trim이면 잘라낸 만큼 당김) */
const pkBB = new Map();
function pkCell(A, col, row) {
  let off = pkBB.get(A.k);
  if (!off) { const g = mkG(A.ch, A.o); let x0 = 0, y0 = 0; if (A.o.trim) { x0 = 1e9; y0 = 1e9; g.forEach((r, y) => r.forEach((c, x) => { if (c !== ".") { x0 = Math.min(x0, x); y0 = Math.min(y0, y); } })); } off = [x0, y0, g.pre || 0]; if (pkBB.size > 300) pkBB.clear(); pkBB.set(A.k, off); }
  return [A.left + (PL + col - off[0] + 1) * A.sc, A.top + (row + off[2] - off[1] + 1) * A.sc];
}
/* 직원 몸짓: o(포즈)를 고치고 { dx, dy, rot, sx, sy, ex[] } 반환. 정적이면 움직임 없이 표정만 */
function pkPose(R, ua, o, still, k, u) {
  const P = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, ex: [] }, ex = P.ex, m = R.m;
  if (m === "angry") { o.eyes = "c"; if (!still) P.dx = (Math.floor(ua * 28) % 2 ? 1 : -1) * (ua < .45 ? pkR(2 * k) : 0); ex.push("angry"); }
  else if (m === "away") return P;
  else if (!still) {
    if (m === "waddle") { if (ua < .6) { P.dy = -Math.abs(Math.sin(ua * Math.PI / .3)) * 12 * k; P.rot = Math.floor(ua / .3) % 2 ? 7 : -7; } }
    else if (m === "flap") { if (ua < .9) { o.arms = Math.floor(ua / .1) % 2 ? "u" : ""; P.dy = -(Math.floor(ua / .1) % 2) * u; } }
    else if (m === "tilt") { P.rot = -10 * Math.sin(clamp(ua / .25, 0, 1) * Math.PI / 2) * (ua > 1.1 ? clamp((1.4 - ua) / .3, 0, 1) : 1); ex.push("q"); }
    else if (m === "ear") { if (ua < .14) { P.dy = -u; P.sy = 1.07; } ex.push("ear"); }
    else if (m === "purr") { if (ua < 1.3) P.rot = Math.sin(ua * 9) * 4; o.eyes = "c"; ex.push("notes"); }
    else if (m === "stretch") { o.arms = "u"; o.eyes = "c"; o.mouth = "o"; P.sy = 1 + .08 * Math.sin(clamp(ua / .8, 0, 1) * Math.PI); }
    else if (m === "eyes") ex.push("eyes");
    else if (m === "ant") { ex.push("ant"); if (ua < .2) P.dy = -u; }
    else if (m === "teeth") { ex.push("teeth"); if (ua < .2) P.sy = 1.05; }
    else if (m === "tail") { ex.push("dust"); if (ua < .3) P.dy = -Math.sin(ua / .3 * Math.PI) * 8 * k; }
    else if (m === "tool") { o.arms = "r"; ex.push("hammer"); }
    else if (m === "juggle") { o.arms = "u"; ex.push("peb"); }
    else if (m === "rub") { if (ua < 1.1) o.arms = Math.floor(ua / .15) % 2 ? "l" : "r"; o.mouth = "o"; }
    else if (m === "pat") { if (ua < .9) P.dy = -(Math.floor(ua / .15) % 2) * u; ex.push("tong"); }
    else if (m === "ink") { o.eyes = "c"; ex.push("ink"); }
    else if (m === "wave") { if (ua < 1.2) o.arms = ["l", "u", "r", "u"][Math.floor(ua / .15) % 4]; }
    else if (m === "blush") { if (ua < 1.4) o.shiny = 1; o.eyes = "c"; ex.push("cheek"); }
    else if (m === "cheek") { if (ua < .9) { P.sx = 1.13; P.sy = .93; } ex.push("cheek"); }
    else if (m === "seed") { if (ua < 1.2) o.mouth = Math.floor(ua * 8) % 2 ? "o" : ""; ex.push("seed"); }
    else if (m === "roll") { if (ua < .8) { P.rot = ease(ua / .8) * 360; P.dy = -Math.sin(ua / .8 * Math.PI) * 10 * k; } }
    else if (m === "spill") { o.eyes = "o"; o.arms = "r"; if (ua < .3) P.dy = -Math.sin(ua / .3 * Math.PI) * 8 * k; ex.push("spill"); }
    else if (m === "startle") { o.eyes = "o"; o.mouth = "o"; o.arms = "u"; if (ua < .35) P.dy = -Math.sin(ua / .35 * Math.PI) * 12 * k; ex.push("bang"); }
    else if (m === "nod") { if (ua < .6) P.dy = (Math.floor(ua / .15) % 2) * u; }
    else if (m === "thumb") { o.arms = "r"; ex.push("thumb"); }
    else if (m === "sway") { if (ua < 1) P.rot = Math.sin(ua * 10) * 4; o.mouth = "o"; }
    else if (m === "trick") { o.arms = "u"; o.mouth = "o"; if (ua < 2.5) { P.sx = 1.1; P.sy = .95; } else if (ua < 3.1) { P.dy = 4 * k; o.arms = ""; o.eyes = "c"; } ex.push("trick"); }
    else if (m === "bhop") { if (ua < .4) P.dy = -Math.sin(ua / .4 * Math.PI) * 8 * k; o.mouth = "o"; }
  }
  if (still && (m === "spill" || m === "thumb" || m === "tool")) o.arms = "r";
  if (still && (m === "startle" || m === "trick")) { o.eyes = "o"; o.mouth = "o"; }
  if (still && m === "blush") ex.push("cheek");
  if (!still && m !== "trick" && m !== "cheek" && m !== "roll") { const q = pkSq(ua); if (q[0] !== 1) { P.sx *= q[0]; P.sy *= q[1]; } }
  return P;
}
/* 직원 둘레 효과(A = { left, top, w, h, sc, ch, o, k: 캐시 키 }) → HTML */
function pkAround(R, ua, P, A, still, k, mini) {
  const ex = P.ex, s2 = mini ? 2 : 3, hx = A.left + A.w / 2, top = A.top, E = c => pkCell(A, c[0], c[1]), meta = A.ch.meta;
  let h = "";
  if (ex.includes("angry")) { h += pkIm(PK.ART.anger, s2, A.left + A.w - pkR(14 * k), top + pkR(6 * k)); h += pkIm(PK.ART.sweat, s2, A.left + pkR(10 * k), top + pkR(16 * k) + (still ? 0 : pkR(Math.min(ua, 1) * 14 * k)), `opacity:${still ? 1 : clamp(1.6 - ua, 0, 1)}`); }
  if (ex.includes("q") && ua < 1.3) h += pkLab(hx + 14 * k, top - 4 * k, "?", `font-size:${pkR(18 * k)}px;line-height:${pkR(18 * k)}px;color:#ffd23f;${PK_OUT}`);
  if (ex.includes("ear") && ua < .8 && Math.floor(ua * 8) % 2 === 0) [[3, 0], [12, 0]].forEach((c, j) => { const [x, y] = E(c), d = j ? 1 : -1; h += pkIp(x + d * 5 * k, y - 8 * k, 2, pkR(5 * k), "#ffd23f") + pkIp(x, y - 11 * k, 2, pkR(5 * k), "#ffd23f") + pkIp(x - d * 4 * k, y - 9 * k, 2, pkR(4 * k), "#ffd23f"); });
  if (ex.includes("notes") && ua < 1.4) for (let j = 0; j < 2; j++) { const ph = clamp(ua * 1.2 - j * .3, 0, 1); if (ph > 0 && ph < 1) h += pkLab(hx + (12 + j * 10) * k, top - ph * 26 * k, "♪", `font-size:${pkR(14 * k)}px;line-height:${pkR(14 * k)}px;color:#ff6b8a;opacity:${(1 - ph).toFixed(2)};${PK_OUT}`); }
  if (ex.includes("eyes") && ua < 1.3) [[meta.xl, meta.er], [meta.xr, meta.er]].forEach(c => { const [x, y] = E(c), a = ua * 14; h += pkIp(x, y, A.sc * 2, A.sc * 2, "#1f2c4a") + pkIp(x + A.sc / 2 + Math.cos(a) * A.sc / 2, y + A.sc / 2 + Math.sin(a) * A.sc / 2, A.sc, A.sc, "#6af0ff"); });
  if (ex.includes("ant") && ua < 1) { const [x, y] = E([7, 0]), c = ["#ff5a5a", "#ffd23f", "#7dff9c", "#6af0ff"][Math.floor(ua * 12) % 4]; h += pkIp(x, y, A.sc * 2, A.sc, c); if (Math.floor(ua * 6) % 2 === 0) h += pkIp(x - 5 * k, y - 4 * k, pkR(3 * k), 2, c) + pkIp(x + A.sc * 2 + 2 * k, y - 4 * k, pkR(3 * k), 2, c) + pkIp(x + A.sc - 1, y - 8 * k, 2, pkR(3 * k), c); }
  if (ex.includes("teeth") && ua < .9) { const [x, y] = E([7, 8]); h += pkIm(PK.ART.spark, s2, x - 2 * k + (ua * 4 % 2 < 1 ? 0 : 2), y - 2 * k - ua * 6 * k); }
  if (ex.includes("dust") && ua < .8) for (let j = 0; j < 3; j++) { const a = ua / .8; h += pkIp(A.left + A.w - 6 * k + j * 6 * k + a * 10 * k * (j - 1), top + A.h - 6 * k - a * 10 * k, pkR(5 * k), pkR(5 * k), "rgba(220,200,170,.9)", `opacity:${(1 - a).toFixed(2)};border-radius:50%`); }
  if (ex.includes("hammer") && ua < 1.2) { const sw = Math.floor(ua / .15) % 2 ? -30 : 10; h += pkIm(PK.ART.hammer, s2, A.left + A.w - 10 * k, top + 2 * k, `transform:rotate(${sw}deg);transform-origin:50% 100%`); }
  if (ex.includes("peb") && ua < 1.4) for (let j = 0; j < 3; j++) { const ph = (ua * 1.5 + j / 3) % 1, xa = ph < .5 ? lerp(-1, 1, ph * 2) : lerp(1, -1, (ph - .5) * 2); h += pkIm(PK.ART.pebble, mini ? 1 : 2, hx + xa * 12 * k - 4, top - 6 * k - Math.abs(Math.sin(ph * Math.PI)) * 18 * k); }
  if (ex.includes("tong") && ua < .9 && Math.floor(ua / .15) % 2) h += pkLab(A.left + A.w - 10 * k, top + A.h / 2, mini ? "통" : "통!", `font-size:${pkR(11 * k) + 1}px;line-height:${pkR(11 * k) + 1}px;color:#fff;${PK_OUT}`);
  if (ex.includes("ink") && ua < 1.3) { const a = clamp(ua / 1.3, 0, 1); for (let j = 0; j < 3; j++) h += pkIm(PK.ART.ink, mini ? 2 : 3 + Math.floor(a * 2), hx - 10 * k + (j - 1) * 12 * k * (.5 + a), top + A.h - 14 * k - a * 8 * k * (j % 2), `opacity:${(1 - a).toFixed(2)}`); }
  if (ex.includes("cheek") && (ua < 1.3 || still)) [[meta.xl - 1, meta.er + 2], [meta.xr + 1, meta.er + 2]].forEach(c => { const [x, y] = E(c); h += pkIp(x, y, A.sc * 2, A.sc, "#ff8ab0", "opacity:.9"); });
  if (ex.includes("seed") && ua < 1.2) { const [x, y] = E([7, 9]); h += pkIm(PK.ART.seed, mini ? 1 : 2, x, y - 2 * k); }
  if (ex.includes("bang") && ua < 1) { h += pkLab(hx + 18 * k, top - 14 * k, "!", `font-size:${pkR(20 * k)}px;line-height:${pkR(20 * k)}px;color:#ff5a5a;${PK_OUT}`); for (let j = 0; j < 3; j++) h += pkLab(hx + (j - 1) * 18 * k * ua * 2, top - ua * 30 * k, "Z", `font-size:${pkR(12 * k)}px;color:#5a63c8;opacity:${clamp(1 - ua * 1.5, 0, 1).toFixed(2)}`); }
  if (ex.includes("thumb") && ua < 1.2) h += `<div class="b emo" style="left:${pkR(A.left + A.w - 10 * k)}px;top:${pkR(top + 10 * k - (still ? 0 : Math.min(ua, .2) * 20 * k))}px;font-size:${pkR(18 * k)}px;line-height:1">👍</div>`;
  if (ex.includes("spill") && ua < .9 && !still) { const a = ua / .9, cx = A.left + A.w - 6 * k, cy = top + 30 * k; for (let j = 0; j < 3; j++) h += pkIm(PK.ART.drop, s2, cx + (j - 1) * 8 * k + a * (j - 1) * 10 * k, cy - 10 * k + a * a * 40 * k - (1 - a) * a * 30 * k, `opacity:${(1 - a).toFixed(2)}`); }
  if (ex.includes("trick")) { const a = ua;
    if (a < 2.5) for (let j = 0; j < 3; j++) { const ph = (a * 1.4 + j / 3) % 1, xa = ph < .5 ? lerp(-1, 1, ph * 2) : lerp(1, -1, (ph - .5) * 2); h += pkIm(PK.ART.seed, s2, hx + xa * 16 * k - 4, top - 8 * k - Math.abs(Math.sin(ph * Math.PI)) * 26 * k); }
    if (a > 2.3 && a < 3.4) for (let j = 0; j < 10; j++) { const an = j / 10 * 6.283, d = (a - 2.3) * 60 * k; h += pkIp(hx + Math.cos(an) * d, top + 10 * k + Math.sin(an) * d * .6, pkR(5 * k), pkR(5 * k), ["#ff6b8a", "#ffd23f", "#5aa8ff", "#6adf8a", "#b48aff"][j % 5], `opacity:${clamp(3.4 - a, 0, 1).toFixed(2)}`); }
    if (a < 2.5 && Math.floor(a * 4) % 2) h += pkIm(PK.ART.spark, s2, hx - 24 * k, top + 4 * k) + pkIm(PK.ART.spark, s2, hx + 20 * k, top - 2 * k); }
  return h;
}
/* 카페인 풀파워: 눈 반짝 + 번개 */
function pkCaff(uc, A, still, k, mini) {
  const meta = A.ch.meta, hx = A.left + A.w / 2; let h = "";
  if (Math.floor(uc * 6) % 2 || still) [[meta.xl, meta.er], [meta.xr, meta.er]].forEach(c => { const [x, y] = pkCell(A, c[0], c[1]); h += pkIm(PK.ART.spark, mini ? 1 : 2, x, y); });
  if (!still) for (let j = 0; j < 3; j++) { const ph = (uc * 2 + j / 3) % 1; h += pkIm(PK.ART.bolt, mini ? 2 : 3, hx + [-30, 26, -20][j] * k, A.top + [6, 16, 36][j] * k - ph * 10 * k, `opacity:${(1 - ph).toFixed(2)}`); }
  return h;
}
/* 누른 자리 파티클(0.4초) */
function pkBurst(R, tc, mini) {
  const a = (tc - R.t0) / .4; if (a < 0 || a > 1 || R.x == null) return "";
  const n = mini ? 4 : 6, ps = mini ? 2 : 4; let h = "";
  for (let j = 0; j < n; j++) { const an = j / n * 6.283 + (fnv(R.k) % 7) * .3, d = (mini ? 3 : 5) + a * (mini ? 10 : 22); h += pkIp(R.x + Math.cos(an) * d - ps / 2, R.y + Math.sin(an) * d - ps / 2, ps, ps, ["#ffd23f", "#fff", "#ff9ab0"][j % 3], `opacity:${(1 - a).toFixed(2)};box-shadow:0 0 0 1px rgba(46,32,64,.5)`); }
  return h;
}
/* 소품 반응(두 화면 공용). r = 층/방 소품 참조 · V = { mini, k } · 반환 { fx, bub } (bub = { h, x, y, cls }) */
function pkProps(V, r, P, tc, still, sndOn, T) {
  const mini = V.mini, k = V.k, ps = mini ? 2 : 3, fk = r.fk, A = o => P.act(fk + "." + o, tc), sv = P.sv();
  let fx = "", bub = null, bubT = -1;
  const nb = (R, b) => { if (!bub || R.t0 >= bubT) { bubT = R.t0; b.t0 = R.t0; bub = b; } };   // 가장 최근에 누른 것의 말풍선 하나만
  const sty = V.sty, html = V.html;
  const sqT = (e, R, uu) => { if (!e) return; const q = R && !still ? pkSq(uu) : [1, 1]; sty(e, "transform", q[0] !== 1 ? `scale(${q[0]},${q[1]})` : ""); sty(e, "transformOrigin", "50% 100%"); };
  /* 모니터 */
  if (r.mon) { const R = A("mon"), uu = R ? tc - R.t0 : 0, M = r.mon; let sh = "";
    if (R && R.m !== "bsod") sqT(M.el, R, uu); else sqT(M.el, null, 0);
    if (R) {
      if (R.m === "frag" && !still && uu < 1.1) { const bits = ["{ }", ";", "=>", "</>", "if", "++"], n = mini ? 3 : 5; for (let j = 0; j < n; j++) { const vx = (j - (n - 1) / 2) * (mini ? 10 : 14), a = uu; fx += pkLab(M.x + M.w / 2 + vx * a * 2.2 - 8 * k, M.y + 6 * k - (a * 80 - a * a * 90) * k, bits[(j + R.n) % 6], `color:${["#7dff9c", "#ffd23f", "#5aa8ff", "#ff9ab0", "#c8b0ff"][j % 5]};opacity:${clamp(1.1 - a, 0, 1).toFixed(2)};${PK_OUT}`); } }
      if (R.m === "frag" && still) sh = `<b class="pk-l" style="left:4px;top:4px;color:#7dff9c">{ ; }</b>`;
      if (R.m === "pass" && uu < 1.2) sh = `<div class="b" style="left:0;top:0;right:0;bottom:0;background:#1f6b3a"></div><b class="pk-l" style="left:${mini ? 3 : 8}px;top:${mini ? 13 : 14}px;color:#fff">✓ PASS</b>`;
      if (R.m === "type" && (Math.floor(uu * 4) % 2 === 0 || still)) sh = `<b class="pk-l" style="left:3px;bottom:2px;top:auto;color:#fff">&gt; _</b>`;
      if (R.m === "bsod") { if (uu < 1.7 || still) sh = `<div class="b" style="left:0;top:0;right:0;bottom:0;background:#2a5adf"></div><b class="pk-l" style="left:${mini ? 4 : 8}px;top:${mini ? 3 : 5}px;color:#fff;font-size:${mini ? 12 : 16}px;line-height:${mini ? 12 : 16}px">:(</b><b class="pk-l" style="left:${mini ? 4 : 8}px;top:${mini ? 20 : 26}px;color:#cfe0ff">${P.L(mini ? ["재부팅", "reboot"] : ["재부팅 중…", "rebooting…"])}</b>`;
        else if (uu < 2) sh = `<div class="b" style="left:0;top:0;right:0;bottom:0;background:#000"></div>`;
        if (uu >= 1.6 || still) nb(R, { h: R.t, x: M.x + M.w / 2, y: M.y - (mini ? 22 : 34) }); }
      if (R.m === "type" && R.t) nb(R, { h: R.t, x: M.x + M.w / 2, y: M.y - (mini ? 22 : 34) });
      if (!still) fx += pkSnd(sndOn, M.x + M.w - 6 * k, M.y - 4 * k, R.s, uu / 1.2);
    }
    if (M.ov) html(M.ov, sh);
  }
  /* 커피 */
  if (r.mug) { const R = A("mug"), uu = R ? tc - R.t0 : 0, M = r.mug, mx = M.x, my = M.y, ms = ps;
    sqT(M.el, R && R.m !== "caff" ? R : null, uu);
    const steam = (n, hg, op) => { let s = ""; for (let j = 0; j < n; j++) { const ph = ((still ? .4 : tc * 1.1) + j / n) % 1; s += pkIp(mx + (2 + j * 2) * ms + Math.sin(ph * 6 + j) * ms, my - ms - ph * hg, pkR(ms * .7) || 1, pkR(ms * 1.6), "rgba(255,255,255,.9)", `opacity:${(op * (1 - ph)).toFixed(2)};box-shadow:0 0 0 1px rgba(46,32,64,.15)`); } return s; };
    if (R) {
      if (R.m === "slurp") { fx += steam(3, 22 * k, 1); }
      if (R.m === "hsteam" && (uu < 1.5 || still)) { fx += pkIm(PK.ART.sheart, ps, mx + ms, my - 8 * k - (still ? 6 * k : uu * 26 * k), `opacity:${still ? 1 : clamp(1.5 - uu, 0, 1).toFixed(2)}`) + steam(3, 18 * k, 1); }
      if (R.m === "hot") { fx += steam(5, 30 * k, 1); if (!still && uu < .8) for (let j = 0; j < 2; j++) fx += pkIm(PK.ART.wdrop, ps, mx + (j ? ms * 8 : -ms * 2) + (j ? 1 : -1) * uu * 14 * k, my - uu * 10 * k + uu * uu * 30 * k); }
      if (R.m === "caff") fx += steam(4, 26 * k, 1);
      if (R.m !== "caff" && !still) fx += pkSnd(sndOn, mx + ms * 9, my - 6 * k, R.s, uu / 1.2);
      if (r.mugBub && R.t && R.m !== "caff") nb(R, { h: R.t, x: mx + ms * 4, y: my - (mini ? 24 : 40) });
    }
  }
  /* 화분 (핀 꽃은 저장돼서 남음) */
  if (r.plant) { const R = A("plant"), uu = R ? tc - R.t0 : 0, G = r.plant; let rr = 0;
    if (R && !still && uu < 1) rr = Math.sin(uu * 16) * 9 * (1 - uu);
    sty(G.el, "transform", rr ? `rotate(${pkR(rr)}deg)` : ""); sty(G.el, "transformOrigin", "50% 100%");
    const fl = sv.fl[fk], pop = fl ? (still || !R || R.m !== "flower" ? 1 : clamp(uu / .25, 0, 1)) : 0;
    if (G.fl) html(G.fl, fl ? pkIm(PK.ART.flower, G.fs, G.fx0, G.fy0, `transform:scale(${pop.toFixed(2)});transform-origin:50% 100%`) + pkIm(PK.ART.flower, G.fs, G.fx1, G.fy1, `transform:scale(${pop.toFixed(2)});transform-origin:50% 100%`) : "");
    if (R) {
      if (R.m === "leaf" && !still && uu < 1.2) fx += pkIm(PK.ART.leaf, ps, G.x + G.w * .6 + Math.sin(uu * 7) * 6 * k, G.y + 2 * ps + uu * 30 * k, `opacity:${clamp(1.2 - uu, 0, 1).toFixed(2)}`);
      if (R.m === "flower" && uu < 1.2 && !still) fx += pkIm(PK.ART.spark, ps, G.x + ps, G.y - 4 * ps) + pkIm(PK.ART.spark, ps, G.x + G.w - 2 * ps, G.y - 3 * ps);
      if (!still) fx += pkSnd(sndOn, G.x + G.w, G.y, R.s, uu / 1.2);
    }
  }
  /* 책장 · 서버랙 · 상자 */
  if (r.shelf) { const R = A("shelf"), uu = R ? tc - R.t0 : 0, g = r.shelf, gx = g.x, gy = g.y;
    if (g.deco === 1 || g.deco === 3) sqT(g.el, R, uu);
    const bo = P.books[fk];
    (g.books || []).forEach((b, j) => { let y = 0; if (bo === j) y = -(mini ? 5 : 10); if (R && R.m === "bookout" && R.bk === j && !still && uu < .15) y = -pkR(4 * k * uu / .15 * 2); if (R && R.m === "bookin" && R.bk === j && !still && uu < .2) y = pkR(2 * k);
      sty(b, "transform", y ? `translateY(${y}px)` : ""); sty(b, "opacity", R && R.m === "bookdrop" && R.bk === j && uu < R.dur ? "0" : "1"); });
    (g.leds || []).forEach((l, j) => { let c = g.ledC[j]; if (R && R.m === "led" && uu < 1 && !still) c = ["#ff6b6b", "#6adf8a", "#ffd23f", "#6af0ff"][(Math.floor(uu * 20) + j) % 4]; sty(l, "background", c); });
    if (R) {
      const bj = R.bk || 0, bk = g.books && g.books[bj], bxp = bk ? gx + g.bx(bj) : gx + g.w / 2 - 6 * k, byp = bk ? gy + g.by(bj) : gy + 10 * k;
      if (R.m === "bookdrop") { const a = still ? 1 : clamp(uu / .5, 0, 1), fy = r.floorY - (mini ? 8 : 12); fx += pkIm(PK.ART.book, ps, bxp, lerp(byp, fy - (mini ? 10 : 15), a * a), `transform:rotate(${pkR(a * 80)}deg)`); if (a >= 1 && uu < 1.2 && !still) for (let j = 0; j < 3; j++) fx += pkIp(bxp + (j - 1) * 8 * k * (uu * 2), fy - 4 * k - uu * 6 * k, pkR(4 * k), pkR(4 * k), "rgba(220,200,170,.9)", `border-radius:50%;opacity:${clamp(1.2 - uu, 0, 1).toFixed(2)}`); }
      if (R.m === "read" && (uu < 1.4 || still)) fx += pkIm(PK.ART.obook, ps, gx + g.w * .3, gy - 14 * k - (still ? 0 : Math.sin(uu * 5) * 3 * k)) + (still ? "" : pkLab(gx + g.w * .75, gy - 20 * k - uu * 8 * k, "♪", `color:#ff6b8a;${PK_OUT}`));
      if (R.m === "dust" && uu < 1.2) { if (!still) for (let j = 0; j < 5; j++) { const a = clamp(uu / 1.2, 0, 1); fx += pkIp(gx + g.w * (.2 + j * .15) + Math.sin(j * 3 + uu * 4) * 6 * k, gy + 6 * k - a * 20 * k - j * 3, pkR(4 * k), pkR(4 * k), "rgba(210,200,190,.85)", `border-radius:50%;opacity:${(1 - a).toFixed(2)}`); } nb(R, { h: R.t, x: gx + g.w / 2, y: gy - (mini ? 22 : 36) }); }
      if (R.m === "fan" && uu < 1.2 && !still) for (let j = 0; j < 3; j++) { const ph = (uu * 2 + j / 3) % 1; fx += pkIp(gx + g.w + ph * 30 * k, gy + (20 + j * 22) * k * (mini ? .8 : 1), pkR(10 * k), 2, "rgba(255,255,255,.9)", `opacity:${(1 - ph).toFixed(2)}`); }
      if (R.m === "ping" && (uu < 1.3 || still)) fx += pkLab(gx + 4 * k, gy - 14 * k - (still ? 0 : uu * 6 * k), "ping 12ms ✓", `color:#7dff9c;${PK_OUT}`);
      if (R.m === "bwrap" && (uu < 1 || still)) fx += pkIm(PK.ART.bwrap, ps, gx + g.w / 2 - 6 * k, gy - 8 * k - (still ? 0 : uu * 10 * k), `opacity:${still ? 1 : clamp(1 - uu, 0, 1).toFixed(2)}`);
      if (["fan", "boxhop", "bwrap", "peek"].includes(R.m) && R.t) nb(R, { h: R.t, x: gx + g.w / 2, y: gy - (mini ? 22 : 36) });
      if (!still) fx += pkSnd(sndOn, gx + g.w - 6 * k, gy - 4 * k, R.s, uu / 1.2);
    }
  }
  /* 창문 (+ 창가에 앉은 새: 맨 위 직원 층의 왼쪽 창) */
  (r.wins || []).forEach(w => { const R = A(w.obj), uu = R ? tc - R.t0 : 0, bs = mini ? 2 : 4; let sky = "";
    if (R) { if (R.m === "cloud") { const a = still ? .5 : clamp(uu / 1.8, 0, 1); sky += pkIm(PK.ART.cloud, bs, lerp(-24 * k, w.w, a), w.h * .3); }
      if (R.m === "fog" && (uu < 1.8 || still)) sky += `<div class="b" style="left:0;top:0;right:0;bottom:0;background:rgba(255,255,255,${(still ? .5 : .6 * clamp(1.8 - uu, 0, 1)).toFixed(2)})"></div>` + pkIm(PK.ART.sheart, bs, w.w / 2 - 8 * k, w.h / 2 - 7 * k, `filter:drop-shadow(1px 1px 0 #9fb4c8);opacity:${still ? 1 : clamp(1.8 - uu, 0, 1).toFixed(2)}`); }
    if (w.sky) html(w.sky, sky);
    const sit = w.bird && pkBird(tc) && !(R && R.m === "letter");
    if (w.birdEl) { sty(w.birdEl, "display", sit ? "block" : "none"); if (sit) sty(w.birdEl, "marginTop", (still ? 0 : Math.floor(tc * 2) % 4 === 0 ? -1 : 0) + "px"); }
    if (R) {
      if (R.m === "bird" && !still && uu < 1.6) { const a = uu / 1.6; fx += pkIm(Math.floor(uu * 8) % 2 ? PK.ART.birdU : PK.ART.birdD, bs, w.x + w.w * .4 + a * 140 * k, w.y + w.h * .5 - a * 70 * k + Math.sin(a * 12) * 3); }
      if (R.m === "bird" && still) fx += pkIm(PK.ART.birdU, bs, w.x + w.w * .6, w.y + 4);
      if (R.m === "letter") { const a = uu; if (!still && a < 1.4) fx += pkIm(Math.floor(a * 8) % 2 ? PK.ART.birdU : PK.ART.birdD, bs, w.x + w.w - 16 * k + a * 90 * k, w.y + w.h - 14 * k - a * 60 * k);
        const ly = still ? w.y + w.h + 30 * k : w.y + w.h - 6 * k + clamp(a / .9, 0, 1) * 36 * k; fx += pkIm(PK.ART.letter, ps, w.x + w.w - 20 * k + (still ? 0 : Math.sin(a * 6) * 4 * k * (1 - clamp(a / .9, 0, 1))), Math.min(ly, r.floorY - pkAh(PK.ART.letter, ps)));
        if (a > 1 || still) nb(R, { h: R.t, x: w.x + w.w / 2, y: w.y + w.h + (mini ? 6 : 10) }); }
      if (!still) fx += pkSnd(sndOn, w.x + w.w - 8 * k, w.y - 2, R.s, uu / 1.2);
    } });
  /* 화이트보드: 낙서(저장) → 7개면 명작, 다음 누름에 지움 */
  if (r.wb) { const g = r.wb, R = A("wb"), uu = R ? tc - R.t0 : 0, sc = mini ? .92 : 1; let h = "";
    if (sv.art) { const ms = mini ? 2 : 3, w = pkAw(PK.MASTER, ms), mx = pkR(g.w * .62), my = pkR(g.h * .1); h += pkIm(PK.MASTER, ms, mx, my);
      if (R && R.m === "art" && uu < 2.4 && !still) for (let j = 0; j < 6; j++) { const an = j / 6 * 6.283 + uu * 2; h += pkIm(PK.ART.spark, mini ? 1 : 2, mx + w / 2 + Math.cos(an) * (mini ? 30 : 60), my + 16 * k + Math.sin(an) * (mini ? 16 : 28)); }
      if (R && R.m === "art") nb(R, { h: R.t, x: g.x + g.w * .7, y: g.y - (mini ? 4 : 6) }); }
    else sv.wb.forEach((di, j) => { const D = PK.DOOD[di], [x0, y0] = PK.DPOS[di], x = pkR(x0 * sc * g.w / 220), y = pkR(y0 * g.h / 84), ds = mini ? 1 : 2, grow = still || !(R && R.m === "draw" && R.di === j) ? 1 : clamp(uu / .3, 0, 1), cp = `clip-path:inset(0 ${pkR((1 - grow) * 100)}% 0 0)`;
      h += D.txt ? `<b class="pk-l" style="left:${x}px;top:${y}px;color:${D.c};font-size:${mini ? 9 : 12}px;line-height:${mini ? 9 : 12}px;${cp}">${D.txt}</b>` : WB.img(D, ds, x, y, cp); });
    if (R && R.m === "wipe" && uu < .6 && !still) { const a = uu / .6; h += pkIp(lerp(0, g.w, a) - 20, 0, 24 * k, g.h, "#ffd0e0", "border:2px solid #4a3560"); }
    if (R && R.m === "wipe") nb(R, { h: R.t, x: g.x + g.w / 2, y: g.y - (mini ? 4 : 6) });
    html(g.layer, h);
    if (R && !still) fx += pkSnd(sndOn, g.x + g.w - 10, g.y + 4, R.s, uu / 1.2);
  }
  /* 벽시계 */
  if (r.clock) { const g = r.clock, R = A("clock"), uu = R ? tc - R.t0 : 0, cs = g.secs();
    let mr = (cs % 3600) / 3600 * 360; const hr = (cs % 43200) / 43200 * 360;
    if (R && R.m === "spin" && !still && uu < .8) mr += ease(uu / .8) * 360;
    sty(g.hm, "transform", `rotate(${pkR(mr / 30) * 30}deg)`); sty(g.hh, "transform", `rotate(${pkR(hr / 30) * 30}deg)`);
    let rr = 0; if (R && !still && (R.m === "wob" || R.m === "cuckoo") && uu < 1) rr = Math.sin(uu * 18) * 7 * (1 - uu); if (R && R.m === "tick" && !still && uu < 1) rr = Math.floor(uu * 6) % 2 ? 4 : -4;
    sty(g.el, "transform", rr ? `rotate(${pkR(rr)}deg)` : ""); sty(g.el, "transformOrigin", "50% 0");
    if (R) {
      if (R.m === "cuckoo") { const a = uu, up = still ? 1 : a < .3 ? a / .3 : a > 2.8 ? clamp((3.2 - a) / .4, 0, 1) : 1, hs = sprite(V.doc, BYID.ham, { seated: 1, trim: 1, mouth: Math.floor(a / .6) % 2 ? "" : "o", eyes: "o" }, mini ? 1 : 2), bob = still ? 0 : Math.floor(a / .6) % 2 ? 0 : -2 * k;
        fx += `<img class="b" alt="" src="${hs.url}" style="left:${pkR(g.x + g.w / 2 - hs.w / 2)}px;top:${pkR(g.y + 2 * k - hs.h * up + bob)}px;width:${hs.w}px;height:${hs.h}px;clip-path:inset(0 0 ${pkR((1 - up) * 100)}% 0)">`;
        const nth = Math.min(Math.min(R.hr, 3), Math.floor(a / .6) + 1); if (a < 2.8 || still) nb(R, { h: `${P.L(["뻐꾹!", "Cuckoo!"])} ×${nth}`, x: mini ? g.x - 22 : g.x - 70, y: mini ? g.y + g.w + 4 : g.y + 6 }); }
      else if (R.t) nb(R, { h: mini ? R.ts : R.t, x: mini ? g.x - 50 : g.x - 150, y: mini ? g.y + g.w + 4 : g.y + 6 });
      if (!still) fx += pkSnd(sndOn, g.x + g.w, g.y, R.s, uu / 1.2);
    }
  }
  /* 자판기 */
  if (r.vend) { const g = r.vend, R = A("vend"), uu = R ? tc - R.t0 : 0, gx = g.x, gy = g.y, gw = g.w, gh = g.h, cs = ps, s_ = gw / 56;
    let tr = ""; if (R && !still) { if (["rattle", "jack", "can", "lemon", "coin"].includes(R.m) && uu < .3) tr = `translateX(${Math.floor(uu * 30) % 2 ? 2 : -2}px)`; if (R.m === "off") { const q = pkSq(uu); if (q[0] !== 1) tr = `scale(${q[0]},${q[1]})`; } }
    sty(g.el, "transform", tr); sty(g.el, "transformOrigin", "50% 100%");
    const canAt = (art, u0, j) => { if (uu < u0 && !still) return ""; const a = still ? 1 : clamp((uu - u0) / .25, 0, 1), b = still ? 1 : clamp((uu - u0 - .35) / .3, 0, 1), x = gx + (8 + j * 10) * s_ + b * (gw * .55 + j * 10 * s_), y = lerp(gy + gh * .55, gy + gh - 12 * s_, a * a) + (b > 0 ? -Math.sin(b * Math.PI) * 12 * k + b * (12 * s_ - pkAh(art, cs) + 2) : 0);
      return pkIm(art, cs, x, Math.min(y, r.floorY - pkAh(art, cs)), uu > R.dur - .3 && !still ? `opacity:${clamp((R.dur - uu) / .3, 0, 1).toFixed(2)}` : ""); };
    if (R) {
      if (R.m === "can" || R.m === "lemon") fx += canAt(R.m === "can" ? PK.ART.can : PK.ART.lemon, .1, 0);
      if (R.m === "coin" && (uu < 1.8 || still)) { const a = still ? 1 : clamp(uu / 1.2, 0, 1); fx += pkIm(PK.ART.coin, cs, gx + gw * .8 + a * 30 * k, r.floorY - pkAh(PK.ART.coin, cs) - Math.abs(Math.sin(a * 9)) * 6 * k * (1 - a), `transform:rotate(${pkR(a * 720)}deg)`); }
      if (R.m === "jack") { fx += canAt(PK.ART.can, .15, 0) + canAt(PK.ART.lemon, .45, 1); if (uu < 2.4 && !still) for (let j = 0; j < 8; j++) { const an = j / 8 * 6.283 + uu; fx += pkIp(gx + gw / 2 + Math.cos(an) * (30 + uu * 10) * k, gy + gh * .3 + Math.sin(an) * (30 + uu * 10) * k, pkR(4 * k), pkR(4 * k), ["#ffd23f", "#ff6b8a", "#5aa8ff", "#6adf8a"][j % 4]); }
        if (uu < 2.4) fx += pkLab(g.lx, g.ly, "777", `color:#e85050;background:#fff;font-size:${mini ? 8 : 11}px;line-height:${mini ? 8 : 11}px;padding:0 1px;${Math.floor(uu * 8) % 2 && !still ? "background:#ffd23f" : ""}`); }
      if (R.m === "rattle" && R.keep && (R.keep.m === "can" || R.keep.m === "lemon")) fx += pkIm(R.keep.m === "can" ? PK.ART.can : PK.ART.lemon, cs, gx + 8 * s_ + gw * .55, r.floorY - pkAh(PK.ART.can, cs));
      if (R.m === "off") fx += pkLab(gx + gw / 2 - 8 * k, gy + 8 * k, "zZ", `color:#9a9ab8;${PK_OUT}`);
      if (R.t && (R.m !== "can" || uu > .5 || still)) nb(R, { h: R.t, x: gx + gw / 2, y: gy - (mini ? 22 : 40) });
      if (!still) fx += pkSnd(sndOn, gx + gw - 6 * k, gy + 10 * k, R.s, uu / 1.2);
    }
  }
  /* 상점 카트 */
  if (r.cart) { const R = A("cart"), uu = R ? tc - R.t0 : 0; sty(r.cart.el, "transform", R && !still && uu < .6 ? `rotate(${pkR(Math.sin(uu * 20) * 5)}deg)` : ""); sty(r.cart.el, "transformOrigin", "50% 100%");
    if (R) { nb(R, { h: R.t, x: r.cart.x + 54, y: r.cart.y - 36, top: 1 }); if (!still) fx += pkSnd(sndOn, r.cart.x - 30, r.cart.y - 10, R.s, uu / 1.2); } }
  /* 누른 자리 파티클(누른 화면에서만) */
  if (!still) for (const R of P.out().values()) if (R.fk === fk && tc - R.t0 < .4 && R.obj !== "elev") fx += pkBurst(R, tc, mini);
  return { fx, bub };
}

/* ---------- 👆 큰 화면: 층마다 누를 자리(.pk-hit [data-act=poke])·효과 층·말풍선. 층을 다시 지을 때 build ---------- */
function pokeBig(h) {
  const { ctx, doc, win, mkEl, sty, html, X } = h;
  const P = pkState(ctx), V = { mini: false, k: 1, sty, html, doc };
  const box = (p, x, y, w, hh, bg, css) => mkEl("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: hh + "px", background: bg }, css || {}));
  const sndOn = () => !!h.cfg.sound && !ctx.settings.quiet && !doc.hidden;
  let G = null, HOV = null, dirty = true, was = false;
  const toast = mkEl("div", "pk-toast", h.main); toast.style.display = "none";
  const pimg = (p, art, sc, x, y, z) => { const s = WB.pix(art, sc), e = mkEl("img", "b", p, { left: x + "px", top: y + "px", width: s.w + "px", height: s.h + "px", zIndex: String(z || 6) }); e.alt = ""; e.src = s.url; e.draggable = false; return e; };
  const hit = (p, fk, obj, x, y, w, hh, z) => { const e = mkEl("div", "pk-hit", p, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px", zIndex: String(z || 60) }); e.dataset.act = "poke"; e.dataset.pk = fk + "." + obj; return e; };
  /* 층 짓기: o = { bld, FL, FT, BASE, FH, n, carEl, wins } (FL[i] = { F, B, f, boss, desk, wbd, shelf, mon, cart }) */
  function build(o) {
    G = { bld: o.bld, FT: o.FT, FH: o.FH, n: o.n, carEl: o.carEl, fl: [], byFk: new Map() };
    let topDesk = -1;
    o.FL.forEach((fl, i) => {
      const f = fl.f, boss = i === o.n; if (!boss && !f) return;
      const meet = !boss && f.layout === "meet", fk = boss ? "boss" : f.sid, F = fl.F, B = fl.B;
      const r = { i, fk, kind: boss ? "boss" : meet ? "meet" : "staff", F, B, floorY: B, T0: o.FT[i], wins: [], els: {}, an: boss ? "boss" : f.animal };
      r.fx = mkEl("div", "b pk-fx", F, { left: "0", top: "0", zIndex: "40" });
      r.bub = mkEl("div", "pk-bub", F, { display: "none" }); r.hint = mkEl("div", "pk-hint", F, { display: "none" });
      const wn = (obj, x, y, w, hh) => { const gl = o.wins.find(q => q.f === F && q.x === x); const sky = box(F, x + 3, y + 3, w - 6, hh - 6, "transparent", { zIndex: "3", overflow: "hidden", pointerEvents: "none" });
        const q = { obj, x: x + 3, y: y + 3, w: w - 6, h: hh - 6, sky, gl: gl && gl.el }; r.wins.push(q); r.els[obj] = [gl && gl.el]; return q; };
      if (boss) {
        r.mon = { el: fl.mon, x: 200, y: B - 98, w: 76, h: 56, ov: box(F, 206, B - 92, 64, 44, "transparent", { zIndex: "10", overflow: "hidden", pointerEvents: "none" }) };
        const gold = h.owned("clock"), ce = mkEl("div", "b", F, { left: "518px", top: "28px", width: "40px", height: "40px", zIndex: "3" });
        pimg(ce, gold ? PK.ART.clockG : PK.ART.clock, 4, 0, 0, 1);
        const hm = box(ce, 18, 8, 4, 12, "#2e2040", { transformOrigin: "50% 100%", zIndex: "2" }), hh2 = box(ce, 18, 12, 4, 8, "#d23a4a", { transformOrigin: "50% 100%", zIndex: "2" });
        if (gold) box(ce, 18, 40, 4, 10, "#c9940f", { zIndex: "0" });   // 금테 시계: 작은 추
        r.clock = { el: ce, hm, hh: hh2, x: 518, y: 28, w: 40, secs: () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); } };
        const ve = h.vendEl(i);
        r.vend = { el: ve, x: 496, y: B - 56, w: 52, h: 62, lx: 503, ly: B - 21 };
        r.cart = { el: fl.cart, x: 790, y: B - 62 };
        wn("win", 330, 40, 100, 62); wn("win2", 580, 40, 100, 62);
        r.els = Object.assign(r.els, { mon: [fl.mon], clock: [ce], vend: [ve], cart: [fl.cart] });
        hit(F, fk, "a", 56, B - 88, 86, 84); hit(F, fk, "mon", 200, B - 98, 76, 58); hit(F, fk, "clock", 514, 24, 48, 48); hit(F, fk, "vend", 494, B - 58, 56, 60);
        hit(F, fk, "win", 330, 40, 100, 62); hit(F, fk, "win2", 580, 40, 92, 62); hit(F, fk, "cart", 792, B - 62, 50, 62);
        /* 사장님 평소 몸짓(커피·꾸벅): 전용 요소(매 프레임 HTML을 만들지 않음) */
        r.zs = [0, 1, 2].map(() => mkEl("div", "b pk-z", F, { display: "none", zIndex: "26" }, "Z"));
        r.cup = pimg(F, PK.ART.cup, 3, 0, 0, 14); r.cup.style.display = "none";
        r.steam = [0, 1].map(() => box(F, 0, 0, 2, 4, "rgba(255,255,255,.9)", { zIndex: "14", display: "none" }));
      } else if (meet) {
        r.wb = { x: 33, y: 31, w: 214, h: 78, layer: mkEl("div", "b", F, { left: "33px", top: "31px", width: "214px", height: "78px", zIndex: "6", overflow: "hidden", pointerEvents: "none" }) };
        r.mug = { el: pimg(F, PK.ART.mug, 3, 580, B - 43, 10), x: 580, y: B - 43 }; r.mugBub = 1;
        wn("win2", 782, 38, 58, 50);
        r.els = Object.assign(r.els, { wb: [fl.wbd && fl.wbd.board], mug: [r.mug.el] });
        hit(F, fk, "a", 236, B - 104, 84, 104); hit(F, fk, "wb", 30, 28, 220, 84); hit(F, fk, "mug", 576, B - 48, 30, 30); hit(F, fk, "win2", 792, 38, 48, 50);
      } else {
        const d = fl.desk;
        r.mon = { el: d.mon, x: 444, y: B - 92, w: 68, h: 52, ov: mkEl("div", "b", d.sc, { left: "0", top: "0", right: "0", bottom: "0", zIndex: "4", pointerEvents: "none" }) };
        r.mug = { el: pimg(F, PK.ART.mug, 3, 508, B - 47, 10), x: 508, y: B - 47 }; r.mugBub = 1;
        const sh = fl.shelf;   // ✍️ AI 보드가 있는 층은 책장·왼쪽 창 자리를 보드가 덮음(누를 자리도 없음)
        if (sh) { r.shelf = Object.assign({ deco: sh.deco, bx: j => 8 + (j % 5) * 10, by: j => Math.floor(j / 5) * 27 }, sh); wn("win", 150, 34, 90, 56); }
        wn("win2", 782, 38, 58, 50);
        if (topDesk < 0 && sh) topDesk = i;
        r.els = Object.assign(r.els, { mon: [d.mon], mug: [r.mug.el] }, sh ? { shelf: [sh.el] } : {});
        hit(F, fk, "a", 343, B - 88, 84, 86); hit(F, fk, "mon", 444, B - 92, 68, 58); if (sh) hit(F, fk, "shelf", 24, 26, 78, 98); hit(F, fk, "mug", 503, B - 52, 32, 30);
        if (sh) hit(F, fk, "win", 150, 34, 90, 56); hit(F, fk, "win2", 792, 38, 48, 50);
      }
      /* 화분(시안의 도트 화분 · 상점 화분을 사면 한 단계 큰 화분). 회의 배치는 아기 자리를 비켜 작은 화분. 🎨 바닥 2 칸에 소품이 있으면 그 층은 화분 없음 */
      if (boss || !(h.noPlant && h.noPlant(f))) { const big = h.owned("plant") && !meet, sc = meet ? 2 : big ? 4 : 3, x = boss ? (big ? 296 : 300) : meet ? 638 : big ? 606 : 614, y = B - 12 * sc;
        const g = mkEl("div", "b", F, { left: x + "px", top: y + "px", width: 12 * sc + "px", height: 12 * sc + "px", zIndex: "7" }); pimg(g, PK.ART.plant, sc, 0, 0, 1); const flL = mkEl("div", "b", g, { left: "0", top: "0", zIndex: "2" });
        r.plant = { el: g, fl: flL, x, y, w: 12 * sc, fs: sc, fx0: 3.5 * sc, fy0: -2 * sc, fx1: 7 * sc, fy1: 0 }; r.els.plant = [g];
        hit(F, fk, "plant", x - 6, y - 6, 12 * sc + 12, 12 * sc + 6); }
      G.fl[i] = r; G.byFk.set(fk, r);
    });
    /* 창가에 앉는 새: 맨 위 책상 층의 왼쪽 창 */
    if (topDesk >= 0) { const r = G.fl[topDesk], w = r.wins.find(q => q.obj === "win"); if (w) { w.bird = 1; w.birdEl = pimg(r.F, PK.ART.birdS, 4, w.x + w.w - 14, w.y + w.h - pkAh(PK.ART.birdS, 4) + 3, 5); w.birdEl.style.display = "none"; } }
    /* 엘리베이터: 층마다 통로 자리 · 카 안 승객 · 통로 위 효과 */
    G.ev = []; for (let i = 0; i <= o.n; i++) { const r = G.fl[i]; if (!r) continue; const e = hit(o.bld, r.fk, "elev", 674, o.FT[i], 110, o.FH[i], 62); e.classList.add("ev"); r.els.elev = [e]; G.ev[i] = e; }
    G.ride = mkEl("div", "b", o.carEl, { left: "0", top: "0", width: "90px", height: "108px", zIndex: "3", pointerEvents: "none" });
    G.top = mkEl("div", "b", o.bld, { left: "0", top: "0", zIndex: "75", pointerEvents: "none" });
    HOV = null; dirty = true;
  }
  /* 누르면 */
  const pkCar = { q: null, cur: null };
  function tap(el, e) {
    if (!G) return;
    const [fk, obj] = el.dataset.pk.split("."), r = G.byFk.get(fk); if (!r) return;
    const tc = h.clockT(), M = h.model(), f = r.kind === "boss" ? null : M.floors.find(x => x.sid === fk);
    if (r.kind !== "boss" && !f) return;
    const a = f ? h.actors.get(fk) : null, base = obj === "elev" ? G.bld : r.F, br = base.getBoundingClientRect(), k = h.scale();
    const x = (e.clientX - br.left) / k, y = (e.clientY - br.top) / k;
    const staff = M.floors.map(q => q.sid);
    const I = { fk, obj, kind: r.kind, an: r.an, x: obj === "elev" ? x : x, y, src: "big", staff,
      ask: !!f && f.kind === "ask", stall: !!f && f.kind === "stall", away: !!f && (!a || a.loc !== "home" || a.moving || a.par !== r.F),
      bs: r.kind === "boss" ? bossState(tc, h.anim()) : "", deco: r.shelf ? r.shelf.deco : 0, vOff: h.vOff(),
      bird: obj === "win" && !!(r.wins.find(w => w.obj === "win") || {}).bird && pkBird(tc), carBusy: obj === "elev" && (!!h.car.owner || !!pkCar.cur),
      clock: obj === "clock" ? { s: r.clock.secs(), reset: h.resetIn() } : null };
    if (obj === "baby") { I.obj = "baby"; }
    const R = P.tap(I, tc); if (!R) return;
    if (obj === "baby") R.bi = +el.dataset.bi || 0;
    if (R.obj === "elev" && !R.res) { pkCar.cur = null; pkCar.q = { fi: r.i, R }; }
    else if (R.obj === "elev" && R.res) pkCar.q = { fi: r.i, R };
    if (R.newEgg) h.hud();
    if (sndOn()) { PK.play(ctx.audio(), R.snd, R.hr ? Math.min(R.hr, 3) : 0); if (R.newEgg) win.setTimeout(() => PK.play(ctx.audio(), "chime"), 380); }
    const doneMux = !!f && f.kind === "done" && !!muxOf(f.s);   // 멀티플렉서(Orca·cmux)에서 일을 마친 직원(완료 보고) → 그 세션으로
    if (R.ask || doneMux) jump(fk);   // 질문 중 직원 → 실제로 터미널로(연타해도 한 번). 모니터는 POKE 반응만(연타 이스터에그 bsod가 다른 앱으로 넘어가지 않게)
    try { ctx.store.set("pokeCam", JSON.stringify({ sid: fk, t: Date.now() })); } catch {}   // 미니 보기(PiP)가 열려 있으면 그 층으로
    dirty = true; h.kick();
  }
  /* 🖥️ 그 세션으로 이동(앱에서만). 연타해도 2초에 한 번(tap.term) — 층 이름표·단계 명패·질문·완료가 같이 씀 */
  function jump(fk) { const tc = h.clockT(); if (!h.canTerm || tc - (tap.term || -9) <= 2) return; tap.term = tc; Promise.resolve(ctx.api.openTerminal(fk)).catch(() => {}); }
  /* 사장님 평소 상태(큰 화면에도 커피·꾸벅): 아무도 일하지 않으면 꾸벅, 28초마다 커피 한 모금 */
  function bossState(tc, anim) {
    const M = h.model(), working = M.floors.some(f => ["work", "agents", "ask"].includes(f.kind));
    if (!working) return "doze";
    return anim && (tc % 28) >= 20 && (tc % 28) < 23.5 ? "coffee" : "work";
  }
  /* 직원(자기 층) 몸짓: placeActor가 놓은 뒤 덮어씀. 반환 없음, 둘레 효과는 r.afx */
  function actor(i, fl, f, a, T, tc, anim) {
    const r = G && G.fl[i]; if (!r) return;
    r.afx = ""; r.abub = null;
    if (a.babies) a.babies.forEach((b, j) => { if (b.el.dataset.pk !== f.sid + ".baby") { b.el.dataset.act = "poke"; b.el.dataset.pk = f.sid + ".baby"; b.el.dataset.bi = String(j); } });
    const R = P.act(f.sid + ".a", tc), Rc = P.act(f.sid + ".mug", tc), caff = Rc && Rc.m === "caff" ? Rc : null, Rmo = P.act(f.sid + ".mon", tc), wv = P.wave(tc), W2 = wv == null ? null : wv - i * .22;
    if (a.bub.classList.contains("pk-hot") && !(R && R.ask)) a.bub.classList.remove("pk-hot");
    const RB = P.act(f.sid + ".baby", tc);
    if (RB && a.babies && a.babies[RB.bi] && a.babies[RB.bi].par) { const b = a.babies[RB.bi], ub = tc - RB.t0, still = !anim;
      const o = JSON.parse(b.pose); const pz = pkPose(RB, ub, o, still, 1, 3); h.setP(b, o); sty(b.el, "top", (parseFloat(b.el.style.top) + pkR(pz.dy)) + "px");
      if (pz.sx !== 1 || pz.sy !== 1) sty(b.img, "transform", `scale(${pz.sx.toFixed(3)},${pz.sy.toFixed(3)})`);
      r.abub = { h: RB.t, x: parseFloat(b.el.style.left) + b.w / 2, y: parseFloat(b.el.style.top) - 34, t0: RB.t0 }; }
    if (R) a.fragAt = Math.max(a.fragAt || 0, tc + .6);   // 반응 말풍선 동안엔 코드 조각을 잠깐 쉼(겹치지 않게)
    if (!R && !caff && W2 == null && !(Rmo && Rmo.m === "type")) return;
    if (a.par !== r.F || a.loc !== "home" || a.moving || f.kind === "stall") { if (R) r.abub = { h: R.t, x: r.kind === "meet" ? 278 : 385, y: r.B - 120, t0: R.t0 }; return; }
    const still = !anim, o = JSON.parse(a.pose), ua = R ? tc - R.t0 : 0;
    let pz = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, ex: [] };
    if (R) pz = pkPose(R, ua, o, still, 1, 4);
    if (caff) { o.eyes = "o"; if (!still && Math.floor((tc - caff.t0) * 10) % 2) pz.dy -= 1; }
    if (W2 != null && W2 > 0 && W2 < .5 && !still) { pz.dy = -Math.sin(W2 / .5 * Math.PI) * 12; o.arms = "u"; o.mouth = "o"; }
    h.setP(a, o);
    const L0 = parseFloat(a.el.style.left), T0 = parseFloat(a.el.style.top), left = L0 + pkR(pz.dx), top = T0 + pkR(pz.dy);
    sty(a.el, "left", left + "px"); sty(a.el, "top", top + "px");
    const tr = (a.img.style.transform && a.img.style.transform !== "none" && !/rotate|scale/.test(a.img.style.transform) ? "" : "") + (pz.rot ? `rotate(${pkR(pz.rot)}deg) ` : "") + (pz.sx !== 1 || pz.sy !== 1 ? `scale(${pz.sx.toFixed(3)},${pz.sy.toFixed(3)})` : "");
    sty(a.img, "transform", tr.trim()); sty(a.img, "transformOrigin", "50% 100%");
    /* 빠른 타자(모니터 반응·카페인): 손·화면 줄 */
    if (fl.desk && (caff || (Rmo && Rmo.m === "type")) && f.kind !== "ask" && anim && fl.desk.hands[0].style.display !== "none") {
      const sp = caff ? 12 : 10; fl.desk.hands.forEach((hd, j) => sty(hd, "marginTop", ((Math.floor(T * sp) + j) % 2 ? -4 : 0) + "px"));
      fl.desk.sc.lines.forEach((l, j) => { const sd = Math.floor(T * 14) + j * 7; sty(l, "width", (8 + (sd * 37 % 36)) + "px"); sty(l, "background", ["#7dff9c", "#ffd23f", "#5aa8ff", "#ff9ab0", "#c8b0ff"][(sd + j) % 5]); });
    }
    const A = { left, top, w: a.w, h: a.h, sc: a.scale, ch: a.ch, o: JSON.parse(a.pose), k: a.pose };
    let fx = "";
    if (R) fx += pkAround(R, ua, pz, A, still, 1, false);
    if (caff) fx += pkCaff(tc - caff.t0, A, still, 1, false);
    if (R && R.s && !still && R.m !== "away") fx += pkSnd(sndOn(), left - 44, top + 14, R.s, ua / 1.2);
    r.afx = fx;
    /* 말풍선: 질문 중이면 원래 말풍선을 강조 + 터미널 안내, 아니면 머리 위 */
    const askHome = f.kind === "ask";
    if (R && askHome) {
      a.bub.classList.add("pk-hot"); html(a.bub, a.bub.innerHTML.replace(/<small class="pk-s">.*<\/small>$/, "") + (R.t && R.m !== "angry" ? ` <small class="pk-s">${R.t}</small>` : ""));
      sty(r.hint, "display", "block"); html(r.hint, h.canTerm ? (muxOf(f.s) ? X(`↗ ${muxOf(f.s)}로 이동했어요`, `↗ Jumped to ${muxOf(f.s)}`) : X("↗ 터미널로 이동했어요", "↗ Jumped to the terminal")) : X("⌨️ 터미널에서 답해 주세요", "⌨️ Please answer in the terminal"));
      sty(r.hint, "left", pkR(left + a.w + 8) + "px"); sty(r.hint, "top", pkR(top + 6) + "px");
      if (R.m === "angry") r.abub = { h: R.t, x: left + a.w / 2, y: top - 40, t0: R.t0 };
    } else {
      if (a.bub.classList.contains("pk-hot")) a.bub.classList.remove("pk-hot");
      const t = R && R.t ? R.t : caff ? caff.t : W2 != null && W2 > -.3 && W2 < 1.2 && i === 0 ? X("전원 집합! 🌊", "Everyone, wave! 🌊") : "";
      if (t) { r.abub = { h: t, x: left + a.w / 2, y: top - 40, t0: R ? R.t0 : caff ? caff.t0 : tc }; sty(a.tag, "display", "none"); }
    }
  }
  /* 사장님: placeActor 대신 frame에서 놓은 뒤 */
  function bossIdle(tc, anim) { return bossState(tc, anim); }
  function bossAfter(boss, bf, T, tc, anim, n, busy) {
    const r = G && G.fl[n]; if (!r) return;
    r.bfx = ""; r.bbub = null;
    const still = !anim, bs = busy ? "work" : bossState(tc, anim), R = P.act("boss.a", tc), wv = P.wave(tc), W2 = wv == null ? null : wv - n * .22, ua = R ? tc - R.t0 : 0;
    /* 평소 몸짓: 꾸벅(Z) · 커피 한 모금(컵 + 김) */
    const doze = bs === "doze" && !busy && !(R && ["startle", "trick"].includes(R.m)), cof = bs === "coffee" && !busy && !(R && ["startle", "trick", "thumb"].includes(R.m));
    r.cof = cof;   // ☕ TINY 사장님 머그: 실제로 커피를 드는 동안 책상 머그를 치움
    const L0 = parseFloat(boss.el.style.left), T0 = parseFloat(boss.el.style.top);
    r.zs.forEach((z, j) => { if (!doze || (R && ua < R.dur)) { sty(z, "display", "none"); return; } const ph = still ? j * .3 : (T * .6 + j / 3) % 1; sty(z, "display", "block"); sty(z, "left", pkR(L0 + boss.w / 2 + 14 + ph * 16) + "px"); sty(z, "top", pkR(T0 + 10 - ph * 24) + "px"); sty(z, "opacity", (1 - ph * .8).toFixed(2)); sty(z, "fontSize", pkR(12 + j * 3 + ph * 4) + "px"); });
    if (!R && !cof && !doze && W2 == null) { sty(r.cup, "display", "none"); r.steam.forEach(s => sty(s, "display", "none")); return; }
    const o = JSON.parse(boss.pose);
    if (doze && !R) o.eyes = "c";
    if (cof) o.arms = "r";
    let pz = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, ex: [] };
    if (R) pz = pkPose(R, ua, o, still, 1, 4);
    if (W2 != null && W2 > 0 && W2 < .5 && !still) { pz.dy = -Math.sin(W2 / .5 * Math.PI) * 12; o.arms = "u"; o.mouth = "o"; }
    h.setP(boss, o);
    const left = L0 + pkR(pz.dx), top = T0 + pkR(pz.dy);
    sty(boss.el, "left", left + "px"); sty(boss.el, "top", top + "px");
    sty(boss.img, "transform", ((pz.rot ? `rotate(${pkR(pz.rot)}deg) ` : "") + (pz.sx !== 1 || pz.sy !== 1 ? `scale(${pz.sx.toFixed(3)},${pz.sy.toFixed(3)})` : "")).trim());
    /* 커피 컵: 출렁이면 기울고 쏟아짐 */
    const sp = R && R.m === "spill" && !still ? ua : null, cupOn = cof || (R && R.m === "spill");
    sty(r.cup, "display", cupOn ? "block" : "none");
    if (cupOn) { const hx = left + boss.w - 30, hy = top + 44; sty(r.cup, "left", pkR(hx) + "px"); sty(r.cup, "top", pkR(hy - (sp != null && sp < .5 ? 6 : 0)) + "px"); sty(r.cup, "transform", sp != null && sp < .6 ? `rotate(${sp < .3 ? 25 : 10}deg)` : "");
      r.steam.forEach((s, j) => { const ph = still ? .4 : (T * 1.2 + j * .5) % 1; sty(s, "display", "block"); sty(s, "left", pkR(hx + 3 + j * 6 + Math.sin(ph * 6 + j) * 2) + "px"); sty(s, "top", pkR(hy - 8 - ph * 12) + "px"); sty(s, "opacity", (1 - ph).toFixed(2)); }); }
    else r.steam.forEach(s => sty(s, "display", "none"));
    const A = { left, top, w: boss.w, h: boss.h, sc: boss.scale, ch: BOSS, o: JSON.parse(boss.pose), k: boss.pose };
    let fx = ""; if (R) fx += pkAround(R, ua, pz, A, still, 1, false);
    if (R && R.s && !still) fx += pkSnd(sndOn(), left - 44, top + 14, R.s, ua / 1.2);
    r.bfx = fx;
    const t = R && R.t ? R.t : W2 != null && W2 > -.3 && W2 < 1.4 ? X("오, 다들 힘내자!", "Oh, go team!") : "";
    if (t) { r.bbub = { h: t, x: left + boss.w / 2, y: top - 40, t0: R ? R.t0 : tc }; sty(boss.tag, "display", "none"); bubbleOff(boss); }
  }
  const bubbleOff = a => sty(a.bub, "display", "none");
  /* 엘리베이터 호출(직원이 쓰면 양보 → 비면 그때 감) */
  function car(dt, anim, tc) {
    if (!G) return;
    const c = h.car;
    if (!anim) { pkCar.cur = null; pkCar.q = null; return; }
    if (c.owner) { if (pkCar.cur) { pkCar.q = pkCar.q || { fi: pkCar.cur.fi, R: pkCar.cur.R }; pkCar.cur = null; } return; }
    if (!pkCar.cur && pkCar.q) { pkCar.cur = { fi: pkCar.q.fi, R: pkCar.q.R, ph: "go", t: 0 }; pkCar.q = null; }
    const p = pkCar.cur; if (!p) return;
    p.t += dt;
    if (p.ph === "go") { const d = p.fi - c.row; if (Math.abs(d) < 1e-3) { c.row = p.fi; p.ph = "open"; p.t = 0; p.arr = tc; if (sndOn()) PK.play(ctx.audio(), "ding"); } else c.row += Math.sign(d) * Math.min(Math.abs(d), 1.7 * dt); c.door = 0; }
    else if (p.ph === "open") { c.door = ease(p.t / .4); if (p.t >= .4) { p.ph = "hold"; p.t = 0; } }
    else if (p.ph === "hold") { c.door = 1; if (p.t >= 1.1) { p.ph = "close"; p.t = 0; } }
    else if (p.ph === "close") { c.door = 1 - ease(p.t / .4); if (p.t >= .4) { pkCar.cur = null; c.door = 0; } }
    dirty = true;
  }
  const carBusy = () => !!pkCar.cur;
  /* 한 프레임: 층마다 소품 효과 + 말풍선, 엘리베이터 위 효과, 토스트 */
  function frame(T, tc, anim) {
    if (!G) return;
    const still = !anim, so = sndOn();
    /* 창가 새는 늘(반응 없이도) */
    G.fl.forEach(r => r && r.wins.forEach(w => { if (w.birdEl) { const R = P.act(r.fk + ".win", tc), sit = pkBird(tc) && !(R && R.m === "letter"); sty(w.birdEl, "display", sit ? "block" : "none"); if (sit) sty(w.birdEl, "marginTop", (still ? 0 : Math.floor(tc * 2) % 4 === 0 ? -4 : 0) + "px"); } }));
    const busy = P.busy(tc) || !!pkCar.cur || !!pkCar.q;
    if (!busy && !dirty) { if (was) { was = false; clear(); } return; }
    was = busy; dirty = false;
    G.fl.forEach(r => { if (!r) return;
      const { fx, bub } = pkProps(V, r, P, tc, still, so, T);
      html(r.fx, fx + (r.afx || "") + (r.bfx || ""));
      let b = bub; [r.abub, r.bbub].forEach(x => { if (x && (!b || x.t0 >= (b.t0 || 0))) b = x; });
      if (b && b.h && b.top) { G.topBub = `<div class="pk-bub" style="left:${pkR(b.x)}px;top:${pkR(r.T0 + b.y)}px;transform:translateX(-100%)">${b.h}</div>`; b = null; }   // 엘리베이터 통로 위로(카트 등 통로 오른쪽)
      if (b && b.h) { html(r.bub, b.h); sty(r.bub, "display", "block"); sty(r.bub, "left", pkR(clamp(b.x, 40, 820)) + "px"); sty(r.bub, "top", pkR(Math.max(2, b.y)) + "px"); } else sty(r.bub, "display", "none");
      const R = P.act(r.fk + ".a", tc); if (!(R && R.ask)) sty(r.hint, "display", "none");
    });
    /* 질문하러 사장실에 내려가 있는 직원의 층을 누르면: 사장실 질문 말풍선(터미널로 이동 버튼)을 강조 */
    const ab = h.askb(); if (ab) { const sid = ab.style.display !== "none" && ab.dataset.sid, R = sid ? P.act(sid + ".a", tc) : null, hot = !!(R && R.ask); if (ab.classList.contains("pk-hot") !== hot) ab.classList.toggle("pk-hot", hot); }
    /* 엘리베이터: 띵! · 오는 중 · 예약 · 승객 */
    let top = G.topBub || "", rid = ""; G.topBub = "";
    const p = pkCar.cur, q = pkCar.q;
    const carY = 40 + 6 + (parseFloat(G.carEl.style.top) || 0);
    if (p && p.ph !== "go") { const u = tc - p.arr; if (u < 1.2) top += pkLab(744, carY - 18 - (still ? 0 : u * 8), X("띵!", "Ding!"), `font-size:16px;line-height:16px;color:#ffd23f;${PK_OUT}`) + (so ? pkSnd(true, 744, carY + 8, X("띵", "ding"), u) : "");
      if (p.R.v === 1) rid = WB.img(PK.ART.plant, 3, 30, 60); if (p.R.v === 2) { const b = sprite(doc, BYID.ham, { baby: 1, trim: 1, arms: Math.floor(tc * 5) % 2 ? "r" : "", eyes: "o" }, 3); rid = `<img class="b" alt="" src="${b.url}" style="left:${pkR(45 - b.w / 2)}px;top:${pkR(108 - b.h)}px;width:${b.w}px;height:${b.h}px">`; }
      if (p.R.t && h.car.door > .5) top += `<div class="pk-bub" style="left:729px;top:${pkR(carY - 44)}px">${p.R.t}</div>`; }
    if (p && p.ph === "go") top += pkLab(682, G.FT[p.fi] + 22, X("🛗 오는 중…", "🛗 On its way…"), `color:#fff;${PK_OUT}`);
    if (q) top += pkLab(682, G.FT[q.fi] + 22, X("🛗 예약됨", "🛗 Booked"), `color:#ffd23f;${PK_OUT}`);
    G.fl.forEach(r => { if (!r) return; const R = P.act(r.fk + ".elev", tc); if (!R) return;
      if (R.res && tc - R.t0 < 1.8) top += `<div class="pk-bub" style="left:729px;top:${pkR(G.FT[r.i] + 8)}px">${R.t}</div>`;
      if (still && !R.res) top += `<div class="pk-bub" style="left:729px;top:${pkR(G.FT[r.i] + 8)}px">${X("띵!", "Ding!")}${R.t ? " " + R.t : ""}</div>`;
      if (!still && tc - R.t0 < .4) top += pkBurst(R, tc, false); });
    html(G.top, top); html(G.ride, h.car.door > 0 ? rid : "");
    /* 이스터에그 토스트 */
    const ts = P.toast(tc);
    if (ts) { const e = PK.EGG[ts.id]; html(toast, `🥚 ${X("이스터에그 발견!", "Easter egg found!")} ${e.e} ${P.L(e.n)}<small>${X("도감에 모았어요", "Added to the dex")} · ${ts.n}/8</small>`); sty(toast, "display", "block"); sty(toast, "transform", `translateX(-50%) translateY(${still ? 0 : pkR(Math.max(0, .2 - (tc - ts.t0)) * 40)}px)`); }
    else sty(toast, "display", "none");
  }
  function clear() {
    if (!G) return;
    G.fl.forEach(r => { if (!r) return; html(r.fx, ""); sty(r.bub, "display", "none"); sty(r.hint, "display", "none"); });
    html(G.top, ""); html(G.ride, ""); sty(toast, "display", "none");
    dirty = true; const tc = h.clockT(); G.fl.forEach(r => { if (r) { r.afx = ""; r.bfx = ""; r.abub = r.bbub = null; pkProps(V, r, P, tc, true, false, 0); } }); dirty = false;   // 소품을 원래대로(저장된 꽃·낙서는 남음)
  }
  /* 호버: 흰 도트 외곽선(요소가 없으면 자리만 살짝 밝게) */
  const OUT = "drop-shadow(2px 0 0 #fff6c8) drop-shadow(-2px 0 0 #fff6c8) drop-shadow(0 2px 0 #fff6c8) drop-shadow(0 -2px 0 #fff6c8) brightness(1.06)";
  function elsOf(key) {
    if (!G || !key) return [];
    const [fk, obj] = key.split("."), r = G.byFk.get(fk); if (!r) return [];
    if (obj === "a") { const a = fk === "boss" ? h.bossAct() : h.actors.get(fk); return a ? [a.img] : []; }
    if (obj.startsWith("baby")) { const a = h.actors.get(fk), b = a && a.babies && a.babies[+obj.split("#")[1] || 0]; return b ? [b.img] : []; }
    return (r.els[obj] || []).filter(Boolean);
  }
  function setHover(key, el) {
    if (key === (HOV && HOV.key)) return;
    if (HOV) { elsOf(HOV.key).forEach(e => sty(e, "filter", "")); if (HOV.el) HOV.el.classList.remove("on"); }
    HOV = key ? { key, el } : null;
    if (HOV) { const els = elsOf(key); els.forEach(e => sty(e, "filter", OUT)); if (!els.length || key.endsWith(".elev")) el.classList.add("on"); }
  }
  ctx.listen(h.view, "mousemove", e => { const t = e.target.closest && e.target.closest("[data-act=poke]"); setHover(t ? t.dataset.pk + (t.dataset.bi ? "#" + t.dataset.bi : "") : null, t); });
  ctx.listen(h.view, "mouseleave", () => setHover(null));
  /* 도감: 이스터에그 칸(찾은 것 = 조건, 못 찾은 것 = 힌트만) */
  function dexHtml() {
    P.load(); const sv = P.sv(), n = P.eggN();
    return `<div class="pk-dex"><h4>🥚 ${X("이스터에그", "Easter eggs")} <span class="cnt">${n}/8</span><small>${X("찾은 것만 조건이 보여요 · 못 찾은 건 힌트만", "Conditions show once found · hints only for the rest")}</small></h4><div class="eg">${PK.EGGS.map(e => { const f = sv.eggs[e.id];
      return `<div class="${f ? "f" : ""}"><b>${f ? e.e + " " + esc(P.L(e.n)) : "❔ ???"}</b>${f ? esc(P.L(e.c)) + `<em>${esc(ymd(new Date(f)))}</em>` : X("힌트: ", "Hint: ") + esc(P.L(e.h))}</div>`; }).join("")}</div></div>`;
  }
  return { build, tap, jump, actor, bossIdle, bossAfter, car, carBusy, frame,
    bossCof: () => !!(G && G.fl[G.n] && G.fl[G.n].cof), bossBub: () => !!(G && G.fl[G.n] && G.fl[G.n].bbub),   // ☕🎂 TINY 사장님 묶음: 커피 드는 중 · 👆 사장님 반응 말풍선
    dexHtml, eggN: () => (P.load(), P.eggN()), reload: () => { if (P.load()) dirty = true; }, busy: tc => P.busy(tc) || !!pkCar.cur };
}

/* ---------- 👆 미니 보기(282×162): 같은 반응의 축소판. 누를 자리 = [data-act=poke](코어가 4px 넘게 끌 때만 창 끌기) ---------- */
function pokeMini(h) {
  const { ctx, doc, win, mk, sty, html, X } = h;
  const P = pkState(ctx), V = { mini: true, k: .75, sty, html, doc };
  const FY = 132, W = 282;
  const sndOn = () => h.cfg().sound !== false && !ctx.settings.quiet && !doc.hidden;
  const box = (p, x, y, w, hh, bg, css) => mk("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: hh + "px", background: bg }, css || {}));
  const hit = (p, key, obj, x, y, w, hh) => { const e = mk("div", "pk-hit", p, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px" }); e.dataset.act = "poke"; e.dataset.pk = key + "." + obj; return e; };
  const pimg = (p, art, sc, x, y, z) => { const s = WB.pix(art, sc), e = mk("img", "b", p, { left: x + "px", top: y + "px", width: s.w + "px", height: s.h + "px", zIndex: String(z || 6) }); e.alt = ""; e.src = s.url; e.draggable = false; return e; };
  const twid = s => [...String(s).replace(/<[^>]+>/g, "")].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 12 : 6), 0);
  let rooms = [], hold = null, HOV = null, dirty = true, was = false, ride = null, rideQ = null, rider = null;
  /* 방마다 (build 때): 소품 참조 · 누를 자리 · 효과 층 · 말풍선 */
  function room(R, topStaff) {
    const p = R.p, key = R.key, r = { R, fk: key, kind: R.type === "boss" ? "boss" : R.type === "meet" ? "meet" : "staff", floorY: FY, wins: [], els: {} };
    R.pk = r; if (R.type === "roof") return;
    r.fx = mk("div", "b", p, { left: "0", top: "0", zIndex: "40", pointerEvents: "none" });
    r.bub = mk("div", "bub pk", p, { display: "none", zIndex: "33" });
    const wn = (gl) => { const sky = box(p, 129, 15, 63, 33, "transparent", { zIndex: "3", overflow: "hidden", pointerEvents: "none" }); const q = { obj: "win", x: 129, y: 15, w: 63, h: 33, sky, gl }; r.wins.push(q); r.els.win = [gl]; hit(p, key, "win", 126, 12, 69, 39); return q; };
    if (R.type === "staff") {
      const v = fnv(key) % 3;
      r.an = R.f.animal;
      r.mon = { el: R.monEl, x: 126, y: 54, w: 45, h: 48, ov: mk("div", "b", R.scr, { left: "0", top: "0", right: "0", bottom: "0", zIndex: "4", pointerEvents: "none" }) };
      r.mug = { el: R.mug, x: 120, y: FY - 48 }; r.mugBub = 1;
      r.shelf = v === 0 ? { deco: 0, el: R.shelfEl, x: 6, y: 36, w: 45, h: 96, books: R.books, bx: j => 6 + (j % 4) * 9, by: j => 12 + Math.floor(j / 4) * 30 }
        : v === 1 ? { deco: 1, el: R.shelfEl, x: 6, y: 36, w: 42, h: 96, leds: R.leds, ledC: R.leds.map((_, q) => q % 2 ? "#7dff9c" : "#ffd23f") }
        : { deco: 3, el: R.shelfEl, x: 6, y: 96, w: 36, h: 36 };
      /* ✍️ AI 보드가 창을 덮은 층은 창 반응 없음 */
      const q = R.aiB ? {} : wn(R.winEl); if (topStaff && !R.aiB) { q.bird = 1; q.birdEl = pimg(p, PK.ART.birdS, 2, 129 + 63 - 12, 15 + 33 - pkAh(PK.ART.birdS, 2) + 2, 5); q.birdEl.style.display = "none"; }
      if (!R.noPlant) { r.plant = { el: R.plantEl, fl: mk("div", "b", R.plantEl, { left: "0", top: "0" }), x: 180, y: FY - 45, w: 30, fs: 2, fx0: 8, fy0: -4, fx1: 16, fy1: -1 }; r.els.plant = [R.plantEl]; }   // 🎨 바닥 2 소품이 화분 자리를 씀
      Object.assign(r.els, { mon: [R.monEl], mug: [R.mug], shelf: [R.shelfEl] });
      hit(p, key, "a", 66, 58, 54, 62); hit(p, key, "mon", 126, 54, 45, 48); hit(p, key, "mug", 117, FY - 52, 24, 22);
      if (v === 2) hit(p, key, "shelf", 6, 92, 40, 40); else hit(p, key, "shelf", 6, 36, 45, 96);
      if (!R.noPlant) hit(p, key, "plant", 178, FY - 48, 34, 36);
    } else if (R.type === "boss") {
      r.an = "boss";
      r.mon = { el: R.monEl, x: 78, y: 54, w: 45, h: 48, ov: mk("div", "b", R.scr, { left: "0", top: "0", right: "0", bottom: "0", zIndex: "4", pointerEvents: "none" }) };
      r.mug = { el: R.mug, get x() { return parseFloat(R.mug.style.left) || 72; }, get y() { return (parseFloat(R.mug.style.top) || FY - 52) + 4; } }; r.mugBub = 1;
      wn(R.winEl);
      const ce = mk("div", "b", p, { left: "198px", top: "13px", width: "20px", height: "20px", zIndex: "3" }); pimg(ce, PK.ART.clock, 2, 0, 0, 1);
      r.clock = { el: ce, hm: box(ce, 9, 4, 2, 6, "#2e2040", { transformOrigin: "50% 100%", zIndex: "2" }), hh: box(ce, 9, 6, 2, 4, "#d23a4a", { transformOrigin: "50% 100%", zIndex: "2" }), x: 198, y: 13, w: 20,
        secs: () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); } };
      r.vend = { el: R.pw && R.pw.vend, x: 186, y: FY - 60, w: 34, h: 64, lx: 191, ly: FY - 27 };
      r.plant = { el: R.plantEl, fl: mk("div", "b", R.plantEl, { left: "0", top: "0" }), x: 126, y: FY - 45, w: 30, fs: 2, fx0: 8, fy0: -4, fx1: 16, fy1: -1 };
      Object.assign(r.els, { mon: [R.monEl], mug: [R.mug], clock: [ce], vend: [r.vend.el], plant: [R.plantEl] });
      hit(p, key, "a", 18, 58, 54, 62); hit(p, key, "mon", 78, 54, 45, 48); hit(p, key, "mug", 66, FY - 54, 24, 22); hit(p, key, "vend", 184, FY - 62, 36, 62); hit(p, key, "clock", 196, 11, 24, 24); hit(p, key, "plant", 124, FY - 48, 34, 36);
      r.zz = null;
    } else if (R.type === "meet") {
      r.wb = { x: 9, y: 9, w: 201, h: 66, layer: mk("div", "b", p, { left: "9px", top: "9px", width: "201px", height: "66px", zIndex: "6", overflow: "hidden", pointerEvents: "none" }) };
      r.plant = { el: R.plantEl, fl: mk("div", "b", R.plantEl, { left: "0", top: "0" }), x: 24, y: FY - 45, w: 30, fs: 2, fx0: 8, fy0: -4, fx1: 16, fy1: -1 };
      r.mug = { el: R.mugEl, x: 80, y: FY - 40 };
      Object.assign(r.els, { wb: [R.wbEl], plant: [R.plantEl], mug: [R.mugEl] });
      hit(p, key, "wb", 6, 6, 207, 72); hit(p, key, "plant", 22, FY - 48, 34, 36); hit(p, key, "mug", 76, FY - 44, 20, 18);
    }
    r.els.elev = [hit(p, key, "elev", 219, 51, 54, 81)];
    rooms.push(r); dirty = true;
  }
  function reset() { rooms = []; HOV = null; rider = null; }
  /* 누르면 */
  function tap(el, e) {
    const [key, obj] = el.dataset.pk.split("."), r = rooms.find(q => q.fk === key); if (!r) return;
    const tc = h.clockT(), M = h.model(), f = r.kind === "staff" ? M.bySid.get(key) : null;
    const rc = r.R.p.getBoundingClientRect(), x = (e.clientX - rc.left) / rc.width * W, y = (e.clientY - rc.top) / rc.height * 144;
    const I = { fk: key, obj, kind: r.kind, an: r.an, x, y, src: "mini", staff: M.staff.map(q => q.sid), ask: !!f && f.kind === "ask", stall: !!f && f.kind === "stall", away: !!f && !h.home(r.R),
      bs: r.kind === "boss" ? h.bossState() : "", deco: r.shelf ? r.shelf.deco : 0, nb: r.shelf && r.shelf.books ? r.shelf.books.length : 15, vOff: h.vOff(),
      bird: obj === "win" && !!(r.wins[0] || {}).bird && pkBird(tc), carBusy: obj === "elev" && (h.carBusy() || !!ride), clock: obj === "clock" ? { s: r.clock.secs(), reset: h.resetIn() } : null };
    const R = P.tap(I, tc); if (!R) return;
    if (R.obj === "elev") { if (R.res) rideQ = { r: r.R.r, R }; else if (!ride) ride = { r: r.R.r, R, t0: tc }; }
    if (sndOn()) { PK.play(ctx.audio(), R.snd, R.hr ? Math.min(R.hr, 3) : 0); if (R.newEgg) win.setTimeout(() => PK.play(ctx.audio(), "chime"), 380); }
    if (R.ask || (f && f.mux && f.kind === "done")) jump(key);   // 질문 중 · 멀티플렉서(Orca·cmux)에서 일을 마친 직원 → 그 세션으로
    hold = { key, until: tc + Math.max(3.2, R.dur + .6) };   // 반응을 보는 동안 카메라가 다른 층으로 가지 않게
    dirty = true; h.kick();
  }
  /* 🖥️ 그 세션으로 이동(앱에서만). 연타해도 2초에 한 번(tap.term) — 질문·완료 반응과 이름표 칩이 같이 씀 */
  function jump(key) { const tc = h.clockT(); if (!ctx.api.openTerminal || tc - (tap.term || -9) <= 2) return; tap.term = tc; Promise.resolve(ctx.api.openTerminal(key)).catch(() => {}); }
  /* 큰 화면에서 누른 층으로(브라우저 PiP·앱 위젯 모두 같은 저장소) */
  ctx.listen(win, "storage", e => { if (!e.key || !/pokeCam$/.test(e.key) || !e.newValue) return; try { const j = JSON.parse(e.newValue); if (j && Date.now() - j.t < 3000 && (j.sid === "boss" || h.model().bySid.has(j.sid))) { hold = { key: j.sid, until: h.clockT() + 4 }; h.kick(); } } catch {} if (P.load()) dirty = true; });
  const holdKey = tc => hold && tc < hold.until ? hold.key : null;
  /* 엘리베이터 호출: 출동·완료 보고가 쓰는 중이면 예약 → 비면 감. 반환 = carState 덮어쓰기 */
  function car(tc, cs, NR, yOf, travel) {
    if (!ride && rideQ && !h.carBusy()) { ride = { r: rideQ.r, R: rideQ.R, t0: tc }; rideQ = null; }
    if (!ride) return null;
    if (ride.r >= NR) { ride = null; return null; }
    const tr = travel(NR - 1, ride.r), u = tc - ride.t0, boss = yOf(NR - 1), y1 = yOf(ride.r);
    let y = y1, door = 0, dir = "";
    if (u < tr) { y = lerp(boss, y1, ease(u / tr)); dir = y1 < boss ? "▲" : "▼"; }
    else if (u < tr + 1.9) { const v = u - tr; door = v < .4 ? ease(v / .4) : v < 1.5 ? 1 : 1 - ease((v - 1.5) / .4); if (!ride.ding) { ride.ding = 1; if (sndOn()) PK.play(ctx.audio(), "ding"); } }
    else if (u < tr * 2 + 1.9) { y = lerp(y1, boss, ease((u - tr - 1.9) / tr)); dir = y1 < boss ? "▼" : "▲"; }
    else { ride = null; return null; }
    ride.door = door; ride.y = y;
    return { y, door, dir };
  }
  const riding = () => !!ride || !!rideQ;
  /* 직원 몸짓(보여 주기 전): o를 고치고 { dx, dy, rot, sx, sy } */
  function pose(key, o, anim, idx) {
    const tc = h.clockT(), R = P.act(key + ".a", tc), Rc = P.act(key + ".mug", tc), caff = Rc && Rc.m === "caff", wv = P.wave(tc), W2 = wv == null ? null : wv - idx * .22, still = !anim;
    let pz = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, ex: [] };
    if (R) pz = pkPose(R, tc - R.t0, o, still, .75, 3);
    if (caff) o.eyes = "o";
    if (W2 != null && W2 > 0 && W2 < .5 && !still) { pz.dy = -Math.sin(W2 / .5 * Math.PI) * 9; o.arms = "u"; o.mouth = "o"; }
    pz.R = R; pz.caff = caff ? Rc : null; pz.W2 = W2;
    pz.say = W2 != null && W2 > -.3 && W2 < 1.3 ? (key === "boss" ? X("오, 다들 힘내자!", "Oh, go team!") : idx === 0 ? X("전원 집합! 🌊", "Everyone, wave! 🌊") : "") : "";
    return pz;
  }
  /* 보여 준 뒤: 확대·기울임 · 둘레 효과 · 말풍선. el = .act, s = 스프라이트 정보, ch·o = 그린 포즈 */
  function after(R0, el, s, ch, o, pz, anim) {
    const r = R0.pk; if (!r) return;
    const tc = h.clockT(), still = !anim, R = pz.R;
    if (pz.sx !== 1 || pz.sy !== 1 || pz.rot) sty(el.im, "transform", ((pz.rot ? `rotate(${pkR(pz.rot)}deg) ` : "") + (pz.sx !== 1 || pz.sy !== 1 ? `scale(${pz.sx.toFixed(3)},${pz.sy.toFixed(3)})` : "")).trim());
    const left = parseFloat(el.style.left), top = parseFloat(el.style.top), A = { left, top, w: s.w, h: s.h, sc: 3, ch, o: Object.assign({ trim: 1 }, o), k: s.url };
    let fx = "";
    if (R) { fx += pkAround(R, tc - R.t0, pz, A, still, .75, true); if (R.s && !still && R.m !== "away") fx += pkSnd(sndOn(), left - 30, top + 10, R.s, (tc - R.t0) / 1.2); }
    if (pz.caff) fx += pkCaff(tc - pz.caff.t0, A, still, .75, true);
    r.afx = fx;
    const t = R && R.t ? R.t : pz.caff ? pz.caff.t : pz.say || "";
    r.abub = t ? { h: t, x: left + s.w / 2, y: top - 24, t0: R ? R.t0 : tc } : null;
    if (R && R.ask) r.abub = null;
  }
  /* 질문 중 직원 말풍선 강조 */
  const fast = key => { const tc = h.clockT(), a = P.act(key + ".mon", tc), b = P.act(key + ".mug", tc); return !!((a && a.m === "type") || (b && b.m === "caff")); };
  const askHot = key => { const R = P.act(key + ".a", h.clockT()); return !!(R && R.ask); };
  /* 보이는 방마다 소품 효과 + 말풍선 + 승객 */
  function frame(vis, anim) {
    const tc = h.clockT(), still = !anim, so = sndOn();
    rooms.forEach(r => r.wins.forEach(w => { if (w.birdEl) { const R = P.act(r.fk + ".win", tc), sit = vis(r.R) && pkBird(tc) && !(R && R.m === "letter"); sty(w.birdEl, "display", sit ? "block" : "none"); if (sit) sty(w.birdEl, "marginTop", (still ? 0 : Math.floor(tc * 2) % 4 === 0 ? -1 : 0) + "px"); } }));
    const busy = P.busy(tc) || riding();
    if (!busy && !dirty) { if (was) { was = false; clear(); } return false; }
    was = busy; dirty = false;
    rooms.forEach(r => { if (!vis(r.R)) return;
      const { fx, bub } = pkProps(V, r, P, tc, still, so, 0);
      html(r.fx, fx + (r.afx || ""));
      let b = bub; if (r.abub && (!b || r.abub.t0 >= (b.t0 || 0))) b = r.abub;
      const er = P.act(r.fk + ".elev", tc);
      if (er && (er.res || still) && tc - er.t0 < 1.8) b = { h: er.res ? er.t : X("띵!", "Ding!") + (er.t ? " " + er.t : ""), x: 214, y: 26, t0: er.t0 };
      if (ride && ride.r === r.R.r && ride.door > .5 && ride.R.t) b = { h: ride.R.t, x: 200, y: 30, t0: ride.R.t0 };
      if (b && b.h) { const w = twid(b.h) + 16, l = clamp(pkR(b.x - w / 2), 2, W - w - 4); html(r.bub, b.h); sty(r.bub, "display", "block"); sty(r.bub, "left", l + "px"); sty(r.bub, "top", pkR(clamp(b.y, 2, 110)) + "px"); r.bub.style.setProperty("--tx", clamp(pkR(b.x - l - 6), 6, w - 14) + "px"); }
      else sty(r.bub, "display", "none");
      r.afx = ""; r.abub = null;
    });
    /* 엘리베이터 승객(화분 · 아기 햄찌) */
    if (!rider) { rider = mk("img", "b", h.world(), { zIndex: "5", display: "none" }); rider.alt = ""; }
    const v = ride && ride.door > 0 ? ride.R.v : 0;
    if (v) { const s = v === 1 ? WB.pix(PK.ART.plant, 2) : sprite(doc, BYID.ham, { baby: 1, trim: 1, eyes: "o", arms: Math.floor(tc * 5) % 2 ? "r" : "" }, 2);
      if (rider._u !== s.url) { rider._u = s.url; rider.src = s.url; } sty(rider, "display", "block"); sty(rider, "width", s.w + "px"); sty(rider, "height", s.h + "px"); sty(rider, "left", pkR(246 - s.w / 2) + "px"); sty(rider, "top", pkR(ride.y + 72 - s.h) + "px"); }
    else sty(rider, "display", "none");
    return busy;
  }
  function clear() { const tc = h.clockT(); rooms.forEach(r => { html(r.fx, ""); sty(r.bub, "display", "none"); pkProps(V, r, P, tc, true, false, 0); }); if (rider) sty(rider, "display", "none"); }
  /* 자막: 방금 누른 것(2.6초) · 이스터에그 발견 · 질문 중 → 터미널 */
  function sub(tc) {
    const ts = P.toast(tc); if (ts) return `🥚 ${X("이스터에그 발견!", "Easter egg!")} ${P.L(PK.EGG[ts.id].n)} (${ts.n}/8)`;
    const L = P.last(); if (!L || tc - L.t0 > 2.6) return "";
    if (L.ask) return ctx.api.openTerminal ? X("↗ 터미널로 이동했어요", "↗ Jumped to the terminal") : X("⌨️ 터미널에서 답해 주세요", "⌨️ Please answer in the terminal");
    return `${P.tgName(L, h.aName)} · ${L.name}`;
  }
  /* 호버: 1px 흰 도트 외곽선 */
  const OUT = "drop-shadow(1px 0 0 #fff6c8) drop-shadow(-1px 0 0 #fff6c8) drop-shadow(0 1px 0 #fff6c8) drop-shadow(0 -1px 0 #fff6c8) brightness(1.06)";
  function elsOf(key) { if (!key) return []; const [fk, obj] = key.split("."), r = rooms.find(q => q.fk === fk); if (!r) return []; if (obj === "a") { const a = h.actorOf(r.R); return a ? [a.im] : []; } return (r.els[obj] || []).filter(Boolean); }
  function hover(t) {
    const key = t ? t.dataset.pk : null; if (key === (HOV && HOV.key)) return;
    if (HOV) { elsOf(HOV.key).forEach(e => sty(e, "filter", "")); HOV.el.classList.remove("on"); }
    HOV = key ? { key, el: t } : null;
    if (HOV) { const els = elsOf(key); els.forEach(e => sty(e, "filter", OUT)); if (!els.length || key.endsWith(".elev")) t.classList.add("on"); }
  }
  return { room, reset, tap, jump, holdKey, car, riding, pose, after, askHot, fast, frame, sub, hover, eggN: () => (P.load(), P.eggN()), reload: () => { if (P.load()) dirty = true; }, busy: tc => P.busy(tc) || riding() };
}

/* ================= 📋 퇴근 일보 (DAYREP: 공용 규칙·카드 DR · 큰 화면 dayrepBig · 미니 보기 dayrepMini. 본체에는 연결 줄만) =================
   데이터 = Core.api.daylog(day) (types/daylog.d.ts, 하루 = 새벽 4시 경계). 화면을 가로채지 않는다: 준비되면 사장님이 종이를 흔들며 알리고, 누르면 발표.
   - 오늘 ready(완료 1건+ · 정오 이후 · 45분 무활동)면 "📋 일보 나왔어요!" → 누르면 "자동 퇴근" 연출(사장님 혼자 불 끄고 발표) → 카드
   - 🏃 퇴근(HUD) = 바로 "다들 1층으로 모여~" 연출(직원이 없으면 그날 일한 직원이 엘리베이터로 옴) → 카드 · 📋 일보 = 지금까지 일보 카드만
   - 고급 옵션 퇴근 시각(cfg.offAt, 기본 끔): 그 시각이 지나면 같은 알림 → "모여~" 연출
   - 다음 날 첫 활동 때 prev.unseen이면 "☀️ 좋은 아침! 어제 일보" 알림 → 어제 카드(출근 장면)
   - 본 일보는 ctx.store("dayrep") = { day, done }로 기억(같은 날 완료 수가 늘지 않으면 다시 알리지 않음), ready인 날은 daylogSeen(day)
   - 알림 우선순위(사장님 말풍선): 질문 해결 인사 > 전력(정전·리셋) > 새 버전 > 일보. 👆 사장님을 누르면 그 반응이 잠깐 먼저.
   - 회의 모드·움직임 줄이기면 연출 없이 바로 카드. API가 없거나(외부 브라우저 구버전 등) 오늘 완료가 없으면 버튼을 숨긴다. */
const DR = (() => {
  const pad = n => String(n).padStart(2, "0");
  const WD = { ko: "일월화수목금토", en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
  const dOf = day => { const [y, m, d] = String(day || "").split("-").map(Number); return new Date(y || 2000, (m || 1) - 1, d || 1); };
  const dayLabel = (day, en) => `${String(day).replace(/-/g, ".")} (${en ? WD.en[dOf(day).getDay()] : WD.ko[dOf(day).getDay()]})`;
  const md = day => { const d = dOf(day); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const hm = t => { const d = new Date(t * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const hms = s => { s = Math.max(0, Math.round(s || 0)); return { h: Math.floor(s / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; };
  const dur = (s, en) => { const p = hms(s); return en ? (p.h ? `${p.h}h ${p.m}m` : p.m ? `${p.m}m` : `${p.s}s`) : (p.h ? `${p.h}시간 ${p.m}분` : p.m ? `${p.m}분` : `${p.s}초`); };
  const waitT = (s, en) => { const p = hms(s), m = p.h * 60 + p.m; return en ? (m ? `${m}m ${p.s}s` : `${p.s}s`) : (m ? `${m}분 ${p.s}초` : `${p.s}초`); };
  const ok = d => !!d && typeof d === "object" && !d.error && d.v === 1 && typeof d.done === "number" && typeof d.day === "string";
  /* 일보를 못 읽은 이유를 콘솔에 (HUD는 그대로 숨김. 백엔드 오류는 앱 로그 waitscape.log에도). 같은 이유는 한 번만 */
  const warned = new Set();
  const warn = (where, e) => { const k = String((e && (e.message || e.error)) || e); if (warned.has(k)) return; warned.add(k); console.warn(`[studio] 일보를 못 읽었어요(${where})`, k); };
  /* 퇴근 시각(HH:MM) → 그날의 epoch. 새벽 4시 전 시각은 다음 날 새벽 */
  const offEpoch = (d, at) => { const m = /^(\d{1,2}):(\d{2})$/.exec(at || ""); if (!m) return null; const x = dOf(d.day); x.setHours(+m[1], +m[2], 0, 0); if (+m[1] < 4) x.setDate(x.getDate() + 1); return x.getTime() / 1000; };
  /* 지금 띄울 알림: ready(오늘 자동) > time(퇴근 시각) > morning(어제 못 본 일보). memo = 마지막으로 본 { day, done } */
  function notice(d, memo, offAt, now) {
    if (!ok(d) || !d.today) return null;
    const seen = (day, n) => !!memo && memo.day === day && n <= (memo.done || 0);
    if (d.ready && d.unseen && d.done > 0 && !seen(d.day, d.done)) return { kind: "ready", day: d.day, done: d.done, big: d.big_count || 0, auto: true };
    if (offAt && d.done > 0) { const t = offEpoch(d, offAt); if (t && now >= t && now < d.end && !(d.seen && d.seen >= t) && !seen(d.day, d.done)) return { kind: "time", day: d.day, done: d.done, big: d.big_count || 0 }; }
    const p = d.prev; if (p && p.unseen && p.done > 0 && d.first != null && !seen(p.day, p.done)) return { kind: "morning", day: p.day, done: p.done, big: 0 };
    return null;
  }
  const memoOf = ctx => { try { const j = JSON.parse(ctx.store.get("dayrep", "") || "null"); return j && typeof j === "object" ? j : null; } catch { return null; } };
  /* 칭찬 한마디: 데이터에서 골라 쓰는 템플릿(먼저 맞는 규칙).
     AI가 MCP 보고로 남긴 한마디(d.cheers)는 공유 카드에 기본으로 넣지 않는다 — 설정 "📋 카드에 AI 한마디"를 켜고 🤫 숨김이 꺼져 있을 때만(o.cheer) */
  function praise(d, X, who, kind, cheer) {
    const ai = cheer && Array.isArray(d.cheers) && d.cheers.length ? d.cheers[d.cheers.length - 1] : null;
    /* AI 한마디: 카드(PNG)와 복사 텍스트가 같은 내용이 되게 44글자(그래핌)로 맞춘 뒤 따옴표로 감싼다 — 카드는 두 줄로 줄바꿈, 넘치면 …”. [2] = AI 표시 */
    if (ai && typeof ai.text === "string" && ai.text) { const n = who(ai.sid, ai.provider).name; return [`“${cut(ai.text, CARD_CHEER)}”`, kind === "morning" ? X("오늘도 잘 부탁해요 ☀️", "Let's have a good one today ☀️") : X(`— ${n}의 한마디 ✍️`, `— ${n} ✍️`), true]; }
    const big = d.big_count || 0, out = d.outage_count || 0, w = d.wait || {}, lc = d.last_call, pk = d.limits && d.limits.peak;
    const tail = kind === "morning" ? X("오늘도 잘 부탁해요 ☀️", "Let's have a good one today ☀️") : null;
    let r;
    if (out && big) r = [X(`정전도 ${out}번 버티고 큰 일 ${big}건 끝!`, `Survived ${out} blackout${out > 1 ? "s" : ""} and wrapped ${big} big one${big > 1 ? "s" : ""}!`), X("내일도 이 페이스로 가자 🍀", "Same pace tomorrow 🍀")];
    else if (out) r = [X(`정전을 ${out}번이나 버텼어요!`, `Made it through ${out} blackout${out > 1 ? "s" : ""}!`), X("촛불 켜고 끝까지 해냈다 🕯", "Candles on, all the way 🕯")];
    else if (big >= 3) r = [X(`큰 일을 ${big}건이나 끝냈어요!`, `${big} big ones done!`), X("오늘 진짜 많이 했다 🎉", "What a productive day 🎉")];
    else if (w.avg != null && w.n >= 2 && w.avg < 60) r = [X(`질문엔 평균 ${waitT(w.avg)} 만에 답했어요!`, `Answered questions in ${waitT(w.avg, true)} on average!`), X("손발이 척척 맞았어요 🤝", "Great teamwork 🤝")];
    else if (w.avg != null && w.avg > 600) r = [X("답 기다리느라 다들 목이 빠졌어요 😅", "Everyone waited quite a while for answers 😅"), X("내일은 조금 더 자주 들러 주세요", "Drop by a bit more often tomorrow")];
    else if (lc && (new Date(lc.t * 1000).getHours() >= 22 || new Date(lc.t * 1000).getHours() < 4)) { const n = who(lc.sid, lc.provider).name; r = [X(`${n}, 막차까지 달렸어요 🌙`, `${n} worked till the last train 🌙`), X("내일은 일찍 퇴근해요", "Let's leave earlier tomorrow")]; }
    else if (pk != null && pk < 50 && d.done >= 5) r = [X(`한도를 ${Math.round(pk)}%만 쓰고 끝냈어요!`, `Finished using only ${Math.round(pk)}% of the limit!`), X("여유롭고 알찬 하루 🌿", "Relaxed and fruitful 🌿")];
    else if ((d.workers || []).length >= 4) r = [X(`${d.workers.length}명이 함께 일했어요!`, `${d.workers.length} staff worked together!`), X("팀워크 최고 👏", "Top teamwork 👏")];
    else r = [X(`완료 ${d.done}건, 수고 많았어요!`, `${d.done} done, great work!`), X("푹 쉬고 내일 또 봐요 🌙", "Rest well, see you tomorrow 🌙")];
    if (tail) r[1] = tail;
    return r;
  }
  /* 🙈 프로젝트 이름 숨김: 큰 일 목록에 나온 순서대로 A, B, C… (데이터는 그대로, 화면·이미지·텍스트만) */
  const anon = d => { const m = new Map(); (d.big || []).forEach(b => { if (!m.has(b.project)) m.set(b.project, m.size < 26 ? String.fromCharCode(65 + m.size) : "?"); }); return m; };
  const titleOf = (kind, X) => kind === "morning" ? X("어제 일보", "Yesterday's report") : kind === "preview" ? X("지금까지 일보", "Report so far") : X("퇴근 일보", "Daily report");
  /* 📋 텍스트 복사 */
  function text(d, o) {
    const { X, who, en } = o, am = anon(d), L = [];
    L.push(`📋 ${titleOf(o.kind, X)} · ${dayLabel(d.day, en)} — Waitscape Studio`);
    L.push(`✅ ${X("완료", "Done")} ${d.done}${X("건", "")} · 🎉 ${X("큰 일", "Big ones")} ${d.big_count || 0}${X("건", "")} · ⏱ ${X("총 작업", "Work")} ${dur(d.work, en)}` + (d.wait && d.wait.avg != null ? ` · 💬 ${X("답하기까지 평균", "Avg. reply")} ${waitT(d.wait.avg, en)}` : ""));
    if ((d.big || []).length) { L.push(`🎉 ${X("큰 일 완료", "Big ones done")}`); d.big.slice(0, 10).forEach(b => L.push(` · ${b.by_ai ? "✍️" : ""}${who(b.sid, b.provider).label} — ${o.hide ? "🔒 " + X("프로젝트", "Project") + " " + am.get(b.project) : `${b.project} · ${b.job}`} (${dur(b.run, en)})`)); }
    if (d.mvp) { const w = who(d.mvp.sid, d.mvp.provider); L.push(`🏆 ${X("MVP", "MVP")}: ${w.label} (${X("완료", "done")} ${d.mvp.done}${X("건", "")} · ${dur(d.mvp.work, en)})`); }
    const bd = []; if (d.last_call) bd.push(`🌙 ${X("막차", "Last one out")}: ${who(d.last_call.sid, d.last_call.provider).label} · ${hm(d.last_call.t)}`); if (d.outage_count) bd.push(`🕯 ${X(`정전 ${d.outage_count}번 버팀`, `Survived ${d.outage_count} blackout${d.outage_count > 1 ? "s" : ""}`)}`);
    if (bd.length) L.push(bd.join(" · "));
    const lim = d.limits || {}; if (lim.peak != null || lim.weekly) L.push(`📈 ${X("5시간 한도 최고", "5h limit peak")} ${lim.peak != null ? Math.round(lim.peak) + "%" : "—"}` + (lim.weekly ? ` · ${X("주간", "weekly")} ${Math.round(lim.weekly.from)}% → ${Math.round(lim.weekly.to)}%` : ""));
    const p = praise(d, X, who, o.kind, o.cheer); L.push(p[2] ? `💬 ${p[0]} ${p[1]}` : `💬 "${p[0]} ${p[1]}"`);
    return L.join("\n");
  }

  /* ---------- 공유 카드 (canvas 432×590, 2배로 그림 = 저장 PNG 864×1180) — 시안 그대로 ---------- */
  const W = 432, H = 590;
  const COL = dark => dark ? { card: "#1f1932", tx: "#f1e9ff", sub: "#a99cc4", ln: "#0d0818", box: "#2b2446", hd: "#2e2246", dash: "rgba(169,156,196,.3)", grid: "rgba(255,255,255,.18)", wk: "#8a9aff", stain: "rgba(210,160,110,.2)" }
    : { card: "#fffaf0", tx: "#2e2040", sub: "#7a6a8a", ln: "#2e2040", box: "#fff1d6", hd: "#4a3560", dash: "rgba(122,106,138,.35)", grid: "rgba(46,32,64,.18)", wk: "#4a63e0", stain: "rgba(150,100,60,.26)" };
  const FONT = (sz, wt) => `${wt || 700} ${sz}px Galmuri11, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`;
  function draw(cv, d, o) {
    const { X, who, en, doc } = o, c = COL(o.dark), am = anon(d);
    const sc = o.sc || 2;
    cv.width = W * sc; cv.height = H * sc;
    const g = cv.getContext("2d");
    g.setTransform(sc, 0, 0, sc, 0, 0); g.imageSmoothingEnabled = false; g.textBaseline = "alphabetic";
    const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const frame = (x, y, w, h, bw, col, fill) => { if (fill) rect(x, y, w, h, fill); rect(x, y, w, bw, col); rect(x, y + h - bw, w, bw, col); rect(x, y, bw, h, col); rect(x + w - bw, y, bw, h, col); };
    const fit = (s, w, sz) => { g.font = FONT(sz || 12); s = String(s); if (g.measureText(s).width <= w) return s; const a = graphemes(s); while (a.length > 1 && g.measureText(a.join("") + "…").width > w) a.pop(); return a.join("") + "…"; };
    const tw = (s, sz) => { g.font = FONT(sz || 12); return g.measureText(String(s)).width; };
    /* 그래핌 단위 줄바꿈(최대 n줄). 넘치면 마지막 줄 끝을 …로 줄이되 끝 글자(닫는 따옴표)는 남긴다 */
    const wrap = (s, w, n) => {
      const a = graphemes(s), end = a[a.length - 1], out = [];
      let cur = "";
      for (let i = 0; i < a.length; i++) {
        if (cur && tw(cur + a[i]) > w) { if (out.length === n - 1) { let r = cur; while (r && tw(r + "…" + end) > w) r = graphemes(r).slice(0, -1).join(""); out.push(r + "…" + end); return out; } out.push(cur); cur = a[i].trimStart(); }
        else cur += a[i];
      }
      out.push(cur); return out;
    };
    /* y = 줄 윗변(시안 CSS 좌표). 12px 줄높이 14 → 기준선 +11, 24px 줄높이 28 → +22 */
    const tx = (x, y, s, sz, col, al) => { sz = sz || 12; g.font = FONT(sz); g.fillStyle = col || c.tx; g.textAlign = al || "left"; g.fillText(String(s), x, y + Math.round(sz * .92)); g.textAlign = "left"; };
    const spr = (s, x, y) => { if (s && s.cv) g.drawImage(s.cv, x, y, s.w, s.h); };
    /* 바탕 · 테두리(3px) — 안쪽 좌표는 (3,3)부터(시안 CSS의 border-box 안) */
    frame(0, 0, W, H, 3, c.ln, c.card);
    g.save(); g.beginPath(); g.rect(3, 3, W - 6, H - 6); g.clip(); g.translate(3, 3);
    const IW = W - 6;
    /* 머리 */
    rect(0, 0, IW, 61, c.hd); rect(0, 61, IW, 3, c.ln);
    const bs = sprite(doc, BOSS, { trim: 1, boss: 1, specs: 1, seated: 1, view: "front", eyes: "o", legs: "s" }, 3); spr(bs, 8, 4 + Math.max(0, Math.round((54 - bs.h) / 2)));
    tx(66, 10, titleOf(o.kind, X), 24, "#fff");
    tx(66, 40, o.kind === "morning" ? `☀️ ${X("좋은 아침!", "Good morning!")} · ${dayLabel(d.day, en)}` : o.kind === "preview" ? `${dayLabel(d.day, en)} · ${hm(d.now)} ${X("기준 · 아직 근무 중", "· still at work")}` : `${dayLabel(d.day, en)} · Waitscape Studio`, 12, "#e2d6ff");
    { const sx = IW - 12 - 60, pre = o.kind === "preview", red = pre ? "#9a8cb0" : "#e8505a";   // 도장: 참 잘했어요(미리보기는 "작성 중")
      frame(sx, 8, 60, 48, 3, red, pre ? "#f3eefa" : "#fff4f0");
      const l = pre ? [X("작성", "Draft"), X("중…", "…")] : [X("참", "Well"), X("잘했어요", "done!")];
      tx(sx + 30, 8 + 3 + 4, l[0], 12, red, "center"); tx(sx + 30, 8 + 3 + 18, l[1], 12, red, "center"); }
    /* 숫자 타일 4개 */
    const unit = (n, u) => [[String(n), 24], [u, 12]];
    const wk = hms(d.work), wt = d.wait && d.wait.avg != null ? hms(d.wait.avg) : null;
    const tiles = [
      [o.kind === "morning" ? "✅ " + X("완료", "Done") : "✅ " + X("오늘 완료", "Done today"), unit(d.done, X("건", ""))],
      ["🎉 " + X("큰 일 완료", "Big ones"), unit(d.big_count || 0, X("건", ""))],
      ["⏱ " + X("총 작업", "Work time"), wk.h ? [[String(wk.h), 24], [X("시간", "h"), 12], [pad(wk.m), 24]] : [[String(wk.m), 24], [X("분", "m"), 12]]],
      ["💬 " + X("답하기까지", "Reply wait"), !wt ? [["—", 24]] : wt.h * 60 + wt.m ? [[String(wt.h * 60 + wt.m), 24], [X("분", "m"), 12], [pad(wt.s), 24], [X("초", "s"), 12]] : [[String(wt.s), 24], [X("초", "s"), 12]]],
    ];
    tiles.forEach(([lab, val], i) => {
      const x = 12 + i * 103, y = 76; frame(x, y, 98, 52, 2, c.ln, c.box);
      tx(x + 6, y + 4, fit(lab, 86), 12, c.sub);
      let xx = x + 6; val.forEach(([s, sz]) => { g.font = FONT(sz); g.fillStyle = c.tx; g.fillText(s, xx, y + 18 + 22); xx += g.measureText(s).width; });
    });
    const bm = (d.rule && d.rule.big_min) || 10;
    tx(12, 136, fit(X(`🎉 큰 일 = ${bm}분 넘게 걸린 작업 · 💬 = 질문 뒤 내가 답하기까지 평균`, `🎉 big one = ran over ${bm} min · 💬 = avg. time until I answered`), 402), 12, c.sub);
    /* 🎉 큰 일 목록 */
    tx(12, 158, "🎉 " + X("큰 일 완료", "Big ones done"), 12, c.tx);
    if ((d.big_count || 0) > 3) tx(414, 158, X(`전체 ${d.big_count}건 중 3건`, `3 of ${d.big_count}`), 12, c.sub, "right");
    const bigs = (d.big || []).slice(0, 3);
    const dash = y => { g.fillStyle = c.dash; for (let x = 12; x < 414; x += 8) g.fillRect(x, y, 4, 2); };
    if (!bigs.length) { tx(12, 179, X("오늘은 큰 일 없이 잔잔하게 흘러갔어요 🍵", "No big ones today — a calm day 🍵"), 12, c.sub); dash(194); }
    bigs.forEach((b, i) => {
      const y = 176 + i * 22, w = who(b.sid, b.provider), mins = Math.max(1, Math.round(b.run / 60));
      const m = en ? `${mins}m` : `${mins}분`, mw = tw(m);
      tx(12, y + 3, fit((b.by_ai ? "✍️" : "") + w.label, 116), 12, c.tx);   // ✍️ = AI가 큰 일이라고 알린 일(10분 미만일 수 있음)
      if (o.hide) tx(136, y + 3, "🔒 " + X("프로젝트", "Project") + " " + am.get(b.project), 12, c.sub);
      else tx(136, y + 3, fit(`${b.project} · ${b.job}`, 414 - 136 - mw - 8), 12, c.tx);
      tx(414, y + 3, m, 12, c.tx, "right");
      dash(y + 18);
    });
    /* 🏆 MVP · 완료 수 막대 */
    const mv = d.mvp;
    tx(12, 250, "🏆 " + (o.kind === "morning" ? X("어제의 MVP", "Yesterday's MVP") : o.kind === "preview" ? X("지금까지 MVP", "MVP so far") : X("오늘의 MVP", "Today's MVP")), 12, c.tx);
    if (mv) {
      const w = who(mv.sid, mv.provider), ps = sprite(doc, w.ch, { trim: 1, view: "front", prov: w.pk, shiny: w.shiny, arms: "u", mouth: "o", eyes: "o", legs: "s" }, 3);
      spr(ps, 14, 268 + Math.max(0, 64 - ps.h));
      const tx0 = 20 + ps.w;
      tx(tx0, 272, fit(`${w.shiny ? "✨" : ""}${w.name} · ${w.pname}`, 226 - tx0), 12, c.tx);
      tx(tx0, 288, fit(X(`완료 ${mv.done}건`, `${mv.done} done`), 226 - tx0, 24), 24, c.tx);
      tx(tx0, 318, fit(X(`일한 시간 ${dur(mv.work)}`, `worked ${dur(mv.work, true)}`), 226 - tx0), 12, c.sub);
    }
    const ws = (d.workers || []).slice(0, 4), mx = Math.max(1, ...ws.map(x => x.done));
    tx(236, 250, X("완료 수", "Done by staff"), 12, c.sub);
    ws.forEach((x, i) => {
      const y = 266 + i * 16, w = who(x.sid, x.provider), bw = Math.max(4, Math.round(x.done / mx * 120));
      tx(236, y, w.emo, 12, c.tx);
      frame(254, y + 1, bw + 4, 12, 2, c.ln, PROV[w.pk].c);
      tx(254 + bw + 10, y, String(x.done), 12, c.tx);
    });
    if ((d.workers || []).length > 4) tx(236 + 160, 266 + 3 * 16, `+${d.workers.length - 4}`, 12, c.sub, "right");
    /* 배지: 🌙 막차 · 🕯 정전 버팀 */
    let bx0 = 12;
    const badge = (s, bg) => { const w = Math.ceil(tw(s)) + 14; if (bx0 + w > 414) return; frame(bx0, 338, w, 18, 2, c.ln, bg); tx(bx0 + 7, 338 + 2, s, 12, "#2e2040"); bx0 += w + 8; };
    if (d.last_call) { const w = who(d.last_call.sid, d.last_call.provider); badge(`🌙 ${X("막차", "Last out")}: ${w.shiny ? "✨" : ""}${w.emo} ${w.name} · ${hm(d.last_call.t)}`, "#ffe27a"); }
    if (d.outage_count) badge(`🕯 ${X(`정전 ${d.outage_count}번 버팀`, `${d.outage_count} blackout${d.outage_count > 1 ? "s" : ""} survived`)}`, "#cfe3ff");
    /* 📈 5시간 한도 추이: 정전 빗금 · ↺ 리셋 · 주간 점선 */
    const lim = d.limits || {}, wkl = lim.weekly;
    tx(12, 366, "📈 " + X("5시간 한도 사용 추이", "5-hour limit usage"), 12, c.tx);
    if (wkl) tx(12 + tw("📈 " + X("5시간 한도 사용 추이", "5-hour limit usage")) + 4, 366, `· ${X("주간", "weekly")} ${Math.round(wkl.from)}% → ${Math.round(wkl.to)}%`, 12, c.sub);
    frame(12, 384, 402, 88, 2, c.ln, c.box);
    const S = (lim.samples || []).filter(s => s && typeof s.t === "number").sort((a, b) => a.t - b.t);
    const has5 = S.some(s => s.five_hour != null);
    if (!has5) { tx(213, 420, X("📭 한도 기록이 없어요", "📭 No limit data"), 12, c.sub, "center"); }
    else {
      const t0r = Math.min(S[0].t, d.first || S[0].t), t1r = Math.max(S[S.length - 1].t, d.last || 0);
      let t0 = Math.floor(t0r / 3600) * 3600, t1 = Math.ceil(t1r / 3600) * 3600; if (t1 - t0 < 6 * 3600) t1 = t0 + 6 * 3600;
      const GW = 199, GH = 42, cg = doc.createElement("canvas"); cg.width = GW; cg.height = GH; const q = cg.getContext("2d");
      const X_ = t => Math.round((t - t0) / (t1 - t0) * (GW - 1)), Y_ = v => Math.round(GH - 3 - clamp(v, 0, 100) / 100 * (GH - 6));
      const lastT = S[S.length - 1].t;
      (d.outages || []).forEach(ot => { const a = X_(ot.t0), b = Math.max(a + 1, X_(ot.t1 == null ? lastT : ot.t1)); q.fillStyle = "rgba(232,80,90,.25)"; q.fillRect(a, 0, b - a, GH); q.fillStyle = "rgba(232,80,90,.6)"; for (let yy = 0; yy < GH; yy += 2) for (let xx = a; xx < b; xx++) if ((xx + yy) % 4 === 0) q.fillRect(xx, yy, 1, 1); });
      q.fillStyle = c.grid; [25, 50, 75].forEach(v => { for (let xx = 0; xx < GW; xx += 3) q.fillRect(xx, Y_(v), 1, 1); });
      const line = (key, col, dotted) => {
        q.fillStyle = col; let prev = null;
        S.forEach(s => {
          const v = s[key]; if (v == null) { prev = null; return; }
          if (prev && s.t - prev.t <= 20 * 60) {
            const xa = X_(prev.t), xb = X_(s.t), ya = Y_(prev.v), yb = Y_(v);
            if (dotted) { for (let xx = xa; xx <= xb; xx++) if (xx % 4 === 0) q.fillRect(xx, Math.round(ya + (yb - ya) * (xx - xa) / Math.max(1, xb - xa)), 2, 1); }
            else if (xb - xa <= 1) q.fillRect(xb, Math.min(ya, yb), 2, Math.abs(yb - ya) + 2);
            else { let py = ya; for (let xx = xa; xx <= xb; xx++) { const yy = Math.round(ya + (yb - ya) * (xx - xa) / (xb - xa)); q.fillRect(xx, Math.min(py, yy), 2, Math.abs(yy - py) + 2); py = yy; } }
          }
          prev = { t: s.t, v };
        });
      };
      line("seven_day", c.wk, true); line("five_hour", "#ff7a3c", false);
      g.drawImage(cg, 14, 386, GW * 2, GH * 2);
      const px = t => 14 + X_(t) * 2;
      const lab = (x, y, s, col) => { const w = tw(s); x = clamp(x, 16, 412 - w); rect(x - 2, y, w + 4, 14, c.box); tx(x, y, s, 12, col); };
      const o1 = (d.outages || [])[0]; if (o1) lab(px(o1.t0) - 10, 452, X("정전", "Blackout"), "#e8505a");
      const r1 = (lim.resets || []).find(t => t >= t0 && t <= t1); if (r1) lab(px(r1) + 4, 390, "↺ " + X("리셋", "reset"), "#ff7a3c");
      const lw = S.filter(s => s.seven_day != null).pop(); if (lw) lab(px(lw.t) - 46, Math.max(388, 386 + Y_(lw.seven_day) * 2 - 18), "┅ " + X("주간", "weekly"), c.wk);
      const hl = t => en ? `${new Date(t * 1000).getHours()}h` : `${pad(new Date(t * 1000).getHours())}${X("시", "")}`;
      const nL = 4; for (let k = 0; k < nL; k++) { const t = t0 + (t1 - t0) * k / (nL - 1); tx(k === 0 ? 12 : k === nL - 1 ? 414 : 12 + 402 * k / (nL - 1), 476, hl(Math.round(t / 3600) * 3600), 12, c.sub, k === 0 ? "left" : k === nL - 1 ? "right" : "center"); }
    }
    /* 칭찬 한마디(사장님) */
    const b2 = sprite(doc, BOSS, { trim: 1, boss: 1, specs: 1, seated: 1, view: "front", eyes: "o", mouth: "o" }, 2); spr(b2, 12, 500);
    const pr = praise(d, X, who, o.kind, o.cheer);
    /* AI 한마디는 두 줄까지 줄바꿈(넘치면 …”, 닫는 따옴표는 남김) + 출처 한 줄 → 말풍선을 아래로 14px 늘림(바닥 줄과 안 겹침) */
    const lines = pr[2] ? wrap(pr[0], 320, 2) : [fit(pr[0], 320)], bh = pr[2] && lines.length > 1 ? 60 : 46;
    frame(74, 498, 340, bh, 3, "#2e2040", "#fff");
    g.fillStyle = "#2e2040"; g.beginPath(); g.moveTo(74, 508); g.lineTo(65, 514); g.lineTo(74, 520); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(77, 511); g.lineTo(71, 514); g.lineTo(77, 517); g.fill();
    lines.forEach((l, i) => tx(85, 504 + i * 15, l, 12, "#2e2040"));
    tx(pr[2] ? 404 : 85, 504 + lines.length * (pr[2] ? 15 : 16), fit(pr[1], 320), 12, pr[2] ? "#7a6a8a" : "#2e2040", pr[2] ? "right" : "left");
    /* 바닥: 🏢 · 날짜 · 미니 직원들(어제 일보 = 출근하는 직원들 + 해) */
    tx(12, 562, `🏢 waitscape · ${dayLabel(d.day, en)}`, 12, c.sub);
    const mini = (d.workers || []).slice(0, 4).map(x => who(x.sid, x.provider));
    let mxr = 414;
    mini.slice().reverse().forEach((w, k) => {
      const s = sprite(doc, w.ch, o.kind === "morning" ? { trim: 1, view: "front", prov: w.pk, shiny: w.shiny, legs: k % 2 ? "a" : "b", eyes: "o" } : { trim: 1, view: "front", prov: w.pk, shiny: w.shiny, seated: 1, eyes: k % 2 ? "c" : "o" }, 1);
      mxr -= s.w; spr(s, mxr, 578 - s.h); mxr -= 2;
    });
    if (o.kind === "morning" && mini.length) tx(mxr - 2, 562, "☀️☕", 12, c.tx, "right");
    /* 커피 얼룩(깨알) */
    g.strokeStyle = c.stain; g.lineWidth = 5; g.beginPath(); g.arc(IW + 26 - 29, 292 + 29, 26.5, 0, Math.PI * 2); g.stroke();
    rect(IW - 38 - 6, 354, 6, 6, c.stain); rect(IW - 50, 362, 4, 4, c.stain);
    g.restore();
    return cv;
  }
  return { ok, warn, notice, memoOf, praise, text, draw, dayLabel, md, hm, dur, waitT, titleOf, anon, W, H, off: false, fail: 0 };   // off: 일지를 끈 서버(404 "off")·/daylog가 없는 옛 서버(3번 연속 실패) — 이 문서에선 다시 묻지 않음
})();

/* ---------- 📋 큰 화면: 알림(사장님 종이) · 발표 연출 · 카드. h = 스튜디오 본체 연결(층·액터·그리기 도우미) ---------- */
function dayrepBig(h) {
  const { ctx, doc, win, mkEl, sty, txt, html, X, view } = h;
  const api = C.api || {}, can = typeof api.daylog === "function";
  const en = () => ctx.lang === "en";
  const BX = 420, SLOT0 = 70, DOOR = 664;   // 사장님 발표 자리 · 줄 선 자리(1F) · 엘리베이터 앞(여기서 타서 사라짐)
  const BD = { x: 16, y: 4, w: 364, h: 42 };     // 1F 발표판(층 이름표는 연출 중 숨김)
  let today = null, note = null, noteAt = 0, lastPoll = -1e9, polling = false, S = null, G = null, card = null, opening = false;
  const born = h.clockT();
  /* 카드 겹: 연출 위 dim + 카드 + 버튼 + 토스트 */
  const ov = mkEl("div", "dr-ov", view); ov.hidden = true;
  ov.innerHTML = `<div class="dr-box"><canvas class="dr-cv" role="img"></canvas><div class="dr-btns">
    <button type="button" data-act="dr-save"></button><button type="button" data-act="dr-hide"></button><button type="button" data-act="dr-copy"></button><button type="button" data-act="dr-close" class="x"></button></div><div class="dr-toast" role="status"></div></div>`;
  const box = ov.querySelector(".dr-box"), cv = ov.querySelector(".dr-cv"), toastEl = ov.querySelector(".dr-toast");
  const skip = mkEl("button", "tbtn dr-skip", view); skip.type = "button"; skip.dataset.act = "dr-skip"; skip.hidden = true;
  const who = (sid, prov) => { const an = h.animalOf(sid), pk = provKey(prov), ch = BYID[an.id]; const nm = NAME[an.id][en() ? 1 : 0], pname = h.provName(prov);
    return { id: an.id, ch, pk, shiny: an.shiny, emo: EMO[an.id], name: nm, pname, label: `${an.shiny ? "✨" : ""}${EMO[an.id]} ${nm}·${pname}` }; };
  const nowS = () => ctx.now();
  function poll(force) {
    if (!can || polling || DR.off) return;
    const tc = h.clockT(); if (!force && tc - lastPoll < 60) return;
    lastPoll = tc; polling = true;
    Promise.resolve(api.daylog("today")).then(d => { today = DR.ok(d) ? d : null; if (d && d.error === "off") DR.off = true; else if (!today) DR.warn("big", d); DR.fail = 0; }, e => { today = null; DR.warn("big", e); if (++DR.fail >= 3) DR.off = true; }).finally(() => { polling = false; refresh(); });
  }
  function refresh() {
    const n = !S && !card ? DR.notice(today, DR.memoOf(ctx), h.cfg.offAt, nowS()) : null;
    if ((n && n.kind + n.day) !== (note && note.kind + note.day)) noteAt = h.clockT();
    note = n; h.hud(); h.kick();
  }
  /* HUD 버튼(🏃 퇴근 · 📋 일보): API·오늘 완료가 있을 때만 */
  function hud(go, cb) {
    const on = can && !!today && today.done > 0;
    go.hidden = !on; cb.hidden = !on;
    txt(go, "🏃 " + X("퇴근", "Clock out")); go.title = X("지금 퇴근: 사장님이 직원을 1층에 모아 오늘 일보를 발표해요", "Clock out now: the boss gathers everyone on 1F and presents today's report");
    txt(cb, "📋 " + X("일보", "Report")); cb.title = note ? X("일보가 나왔어요 · 눌러서 카드 보기", "The report is ready · click to view") : X("지금까지의 일보 미리보기", "Preview today's report so far");
    cb.classList.toggle("on", !!note); cb.classList.toggle("blink", !!note && h.anim());
  }
  /* ---------- 장면 ---------- */
  function build(o) {
    G = o; const n = o.n, bf = o.FL[n];
    G.ovs = o.FL.slice(0, n).map((fl, i) => { const e = h.box(fl.F, 0, 0, 860, o.FH[i], "rgba(14,10,34,.62)", { zIndex: 16, pointerEvents: "none", display: "none" });
      const ck = mkEl("div", "b dr-click", fl.F, { left: "488px", top: "6px", display: "none" }, X("딸깍", "click")); return { e, ck }; });
    G.board = mkEl("div", "b dr-board", bf.F, { left: BD.x + "px", top: BD.y + "px", width: BD.w + "px", height: BD.h + "px", display: "none" });
    G.ptr = [0, 1, 2, 3, 4, 5].map(k => h.box(bf.F, 0, 0, 4, 4, k === 5 ? "#e85050" : "#6a4a3a", { zIndex: 21, display: "none" }));
    G.conf = [...Array(36)].map((_, i) => h.box(bf.F, 0, 0, 4, 4, ["#ff6b8a", "#ffd23f", "#4fc86a", "#6ac8ff", "#b57be0"][i % 5], { zIndex: 30, display: "none" }));
    G.zz = mkEl("div", "b dr-z", o.bld, { display: "none" }, "z");
    G.wake = mkEl("div", "b dr-wake", o.bld, { display: "none" }, X("!? 번쩍", "!? Huh"));
    G.paper = h.box(bf.F, 0, 0, 12, 15, "#fff", { zIndex: 13, border: "2px solid #2e2040", display: "none" }); [0, 1, 2].forEach(k => h.box(G.paper, 2, 2 + k * 3, 6, 1, "#7a6a8a"));
  }
  const show = (e, on) => sty(e, "display", on ? "block" : "none");
  /* 연출 계획: 줄 설 직원(화면의 직원 + 오늘 일한 직원, MVP는 꼭) · 퇴근 시각 · 불 끄는 시각 · 발표판 시각 */
  function plan(d, v, kind) {
    const M = h.model(), fls = M.floors;
    const onS = fls.map((f, i) => ({ sid: f.sid, fi: i, a: h.actors.get(f.sid), animal: f.animal, pk: f.pk, shiny: f.shiny, meet: f.layout === "meet" })).filter(m => m.a);
    const sp = onS.length ? Math.min(1, 4.2 / onS.length) : 1;
    onS.forEach((m, k) => { m.L = .8 + k * sp; m.A = m.L + 2.0; });
    let mem = [], extra = [];
    if (v === "gather") {
      mem = onS.slice(0, 6);
      const mvp = d.mvp;
      if (mvp && mem.length === 6 && !mem.some(m => m.sid === mvp.sid)) mem.pop();
      const ids = new Set(mem.map(m => m.sid)), add = [];
      if (mvp && !ids.has(mvp.sid)) add.push(mvp);
      (d.workers || []).forEach(w => { if (mem.length + add.length < 5 && !ids.has(w.sid) && !add.some(x => x.sid === w.sid)) add.push(w); });
      let t = mem.length ? Math.max(...mem.map(m => m.A)) : .4;
      add.forEach(w => { const an = h.animalOf(w.sid), pk = provKey(w.provider), a = h.mkActor(BYID[an.id], { prov: pk, shiny: an.shiny, label: "", color: PROV[pk].tag });
        t += .8; extra.push(a); mem.push({ sid: w.sid, fi: -1, a, animal: an.id, pk, shiny: an.shiny, L: null, A: t, extra: true }); });
      const sw = mem.length <= 5 ? 72 : 60; mem.forEach((m, j) => { m.sx = SLOT0 + j * sw; });
    }
    if (v === "morning") {   // ☀️ 어제 일보: 출근한 직원이 아래층부터 "좋은 아침!" → 사장님 종이에서 카드
      onS.slice().reverse().forEach((m, k) => { m.g = .5 + k * .45; m.L = m.A = null; });
      const tC = Math.max(3.2, Math.max(0, ...onS.map(m => m.g)) + 1.5);
      return { v, d, kind, t0: h.clockT(), onS, mem: [], extra: [], leaveOnly: onS, offs: [], tA: 0, tB: 1e9, tC, mvpI: -1, dz: -1, lines: [], nm: null,
        say: [[0, tC + 9, X("☀️ 좋은 아침! 어제 일보 볼까요?", "☀️ Good morning! Shall we look at yesterday?")]] };
    }
    const leaveOnly = onS.filter(m => !mem.includes(m));
    const lastA = mem.length ? Math.max(...mem.map(m => m.A)) : 0, lastL = onS.length ? Math.max(...onS.map(m => m.L)) + 1.5 : 0;
    const offs = [];
    for (let i = 0; i < h.n(); i++) { const m = onS.find(q => q.fi === i); offs[i] = m ? m.L + 1.6 : .5 + i * .35; }
    const tA = v === "alone" ? Math.max(1.4, lastL + 1.2, offs.length ? Math.max(...offs) + .6 : 0) : 0;
    const tB = v === "gather" ? Math.max(5.4, lastA + 1.6) : tA + 2.4;
    const tC = tB + (v === "gather" ? 9.4 : 8.6);
    const mvpI = d.mvp ? mem.findIndex(m => m.sid === d.mvp.sid) : -1;
    let dz = -1; if (mem.length >= 3) for (let j = mem.length - 1; j >= 0; j--) if (j !== mvpI) { dz = j; break; }
    const nm = d.mvp ? who(d.mvp.sid, d.mvp.provider) : null, du = DR.dur(d.work, en());
    const done = d.done, big = d.big_count || 0;
    const say = v === "gather" ? [
      [0, 2.6, kind === "time" ? X("⏰ 퇴근 시간! 다들 1층으로 모여~ 📣", "⏰ Time to go! Everyone to 1F~ 📣") : X("다들 1층으로 모여~! 📣", "Everyone, to the 1st floor~! 📣")],
      [2.6, tB - .2, X("오늘 하루 정리하자!", "Let's wrap up the day!")],
      [tB + .4, tB + 2, X("오늘 일보 발표합니다! 📋", "Here's today's report! 📋")],
      [tB + 2, tB + 3.5, X(`완료 ${done}건, 큰 일 ${big}건!`, `${done} done, ${big} big one${big === 1 ? "" : "s"}!`)],
      [tB + 3.5, tB + 5, X(`다 합쳐 ${du} 일했어요`, `${du} of work in total`)],
      [tB + 5, tB + 6.8, nm ? X(`오늘의 MVP는… ${nm.name}! 🎉`, `Today's MVP is… ${nm.name}! 🎉`) : X("다들 MVP예요! 🎉", "You're all MVPs! 🎉")],
      [tB + 6.8, tC + 9, X("다들 수고했어요 👏", "Great work, everyone 👏")]] : [
      [.4, tA - .2, X("어라…?", "Huh…?")],
      [tA, tA + 2.4, X("다들 갔네… 일보는 내가 써 둘게 📝", "Everyone's gone… I'll write the report 📝")],
      [tB + .3, tB + 2, X("흠흠, 오늘 일보는…", "Ahem, today's report…")],
      [tB + 2, tB + 3.5, X(`완료 ${done}건, 큰 일 ${big}건!`, `${done} done, ${big} big one${big === 1 ? "" : "s"}!`)],
      [tB + 3.5, tB + 5, X(`다 합쳐 ${du} 일했네`, `${du} of work in total`)],
      [tB + 5, tB + 6.8, nm ? X(`오늘의 MVP는… ${nm.name}! 🎉`, `Today's MVP is… ${nm.name}! 🎉`) : X("다들 MVP야! 🎉", "All MVPs! 🎉")],
      [tB + 6.8, tC + 9, X("다들 수고했어 👏 (혼잣말)", "Good job, all 👏 (to myself)")]];
    const lines = [[tB + 2, `✅ ${X("완료", "Done")} ${done}${X("건", "")} · 🎉 ${X("큰 일", "Big")} ${big}${X("건", "")}`], [tB + 3.5, `⏱ ${X("총 작업", "Work")} ${du}`], [tB + 5, nm ? `🏆 ${X("오늘의 MVP", "MVP")} · ${nm.emo} ${nm.name}!` : `🏆 ${X("모두 MVP!", "All MVPs!")}`]];
    return { v, d, kind, t0: h.clockT(), onS, mem, extra, leaveOnly, offs, tA, tB, tC, mvpI, dz, say, lines, nm };
  }
  function start(d, v, kind) {
    if (S) end(); closeCard(true);
    if (v === "gather" && !h.model().floors.length && !(d.workers || []).length) v = "alone";
    S = plan(d, v, kind); note = null; skip.hidden = false; txt(skip, "⏭ " + X("바로 카드 보기", "Skip to card")); h.hud(); h.kick();
  }
  function end() {   // 장면을 원래대로(직원·불·이름표)
    if (!S) return;
    S.mem.concat(S.leaveOnly).forEach(m => { if (m.a && m.a.el) { sty(m.a.el, "display", ""); sty(m.a.el, "opacity", ""); h.bubble(m.a, "", false); } });
    S.extra.forEach(a => h.dropActor(a));
    if (G) { G.ovs.forEach(o => { show(o.e, false); show(o.ck, false); }); show(G.board, false); G.ptr.forEach(p => show(p, false)); G.conf.forEach(p => show(p, false)); show(G.zz, false); show(G.wake, false);
      const bf = G.FL[G.n]; if (bf && bf.tag) sty(bf.tag, "display", ""); }
    const b = h.bossAct(); if (b) { sty(b.el, "zIndex", ""); b.bub.classList.remove("updb", "drsay"); }
    S = null; skip.hidden = true; h.kick();
  }
  const active = () => !!S;
  /* 엘리베이터: 연출 동안 1층에 세워 두고 도착마다 문을 연다 */
  function car(tc, c, n) {
    const u = tc - S.t0; let door = 0;
    S.mem.forEach(m => { const k = u - m.A; if (k > -.5 && k < 1.2) door = Math.max(door, k < -.2 ? ease((k + .5) / .3) : k < .8 ? 1 : 1 - ease((k - .8) / .4)); });
    c.row = n; c.door = door;   // 타고 있던 직원(owner)은 그대로 두고 연출이 끝나면 이어서 감
  }
  const dyHop = (k, amp) => -Math.round(Math.abs(Math.sin(k * 7)) * amp / 2) * 2;
  /* 직원(자기 층 or 1층 줄) — 본체의 placeActor 대신 */
  function staff(i, fl, f, a, T, tc, ph) {
    const u = tc - S.t0, m = S.mem.find(q => q.a === a) || S.leaveOnly.find(q => q.a === a);
    if (!m) { sty(a.el, "display", "none"); return; }
    place(m, u, T, tc, ph, fl, f);
  }
  function place(m, u, T, tc, ph, fl, f) {
    const a = m.a, n = h.n(), B = G.BASE, d = S.d;
    const fi = m.fi >= 0 ? h.floorOf(m.sid) : -1;
    const hide = () => { sty(a.el, "display", "none"); h.bubble(a, "", false); };
    if (S.v === "morning") {
      if (fi == null || fi < 0) return hide();
      const F = G.FL[fi], meet = f && f.layout === "meet", gr = u >= m.g && u < m.g + 1.7;
      if (F.desk) F.desk.hands.forEach(e => sty(e, "display", "none"));
      h.setP(a, { view: "front", seated: meet ? 0 : 1, legs: "s", eyes: gr ? "o" : ph.blink ? "c" : "o", mouth: gr ? "o" : "", arms: gr ? (Math.floor((u - m.g) * 6) % 2 ? "u" : "r") : "" });
      h.put(a, F.F, meet ? 278 : 385, B[fi] - (meet ? 2 : 6), { dy: gr ? dyHop(u - m.g, 6) : 0 }); sty(a.el, "display", ""); sty(a.el, "zIndex", "8"); h.tagOn(a, !gr);
      h.bubble(a, gr ? X("좋은 아침! ☕", "Morning! ☕") : "", gr); return;
    }
    if (m.fi >= 0 && u < m.L + 1.5) {
      if (fi == null || fi < 0) return hide();
      const F = G.FL[fi], meet = f && f.layout === "meet", dx = meet ? 278 : 385;
      sty(a.el, "display", ""); sty(a.el, "zIndex", "8");
      if (F.desk) F.desk.hands.forEach(e => sty(e, "display", "none"));
      if (u >= m.L && a.babies) a.babies.forEach(b => { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); b.par = null; });
      if (u >= m.L && F.mb) sty(F.mb, "display", "none");
      if (u < m.L) {   // 아직 자리: "모여~"에 고개 듦
        h.setP(a, { view: "front", seated: meet ? 0 : 1, legs: "s", eyes: ph.blink ? "c" : "o", mouth: u < 1.6 && S.v === "gather" ? "o" : "" });
        h.put(a, F.F, dx, B[fi] - (meet ? 2 : 6)); h.tagOn(a, true); h.bubble(a, "", false); return;
      }
      const k = u - m.L;
      if (k < .6) { h.setP(a, { view: "front", legs: "s", eyes: "o", mouth: "o", arms: Math.floor(k * 6) % 2 ? "u" : "r" }); h.put(a, F.F, dx, B[fi] - 2); h.tagOn(a, false); h.bubble(a, X("퇴근 👋", "Bye 👋"), true); return; }
      const q = (k - .6) / .9, x = lerp(dx, DOOR, q), tg = h.parentFor(fi, x, B[fi] - 2);
      h.setP(a, { view: "front", legs: ph.wk ? "a" : "b", eyes: "o" }); h.put(a, tg.p, tg.x, tg.feet, { dy: ph.wk ? -4 : 0, rot: ph.wk ? 3 : -3 }); sty(a.el, "zIndex", String(tg.z || 8)); h.tagOn(a, false); h.bubble(a, "", false);
      sty(a.el, "opacity", q > .8 ? String(Math.max(0, (1 - q) / .2).toFixed(2)) : "");   // 엘리베이터에 타며 사라짐
      return;
    }
    if (m.A == null || u < m.A - .05) return hide();
    /* 1층 줄 */
    const k = u - m.A, tB = S.tB, j = S.mem.indexOf(m), mvp = j === S.mvpI, dz = j === S.dz;
    const walk = k < 1.2, x = walk ? lerp(E_X, m.sx, ease(k / 1.2)) : m.sx;
    let o = { view: "front", legs: walk ? (ph.wk ? "a" : "b") : "s", eyes: ph.blink ? "c" : "o" }, dy = walk ? (ph.wk ? -4 : 0) : 0, say = "";
    if (!walk) {
      const clap = (u >= tB + 2 && u < tB + 2.8) || (u >= tB + 5.2 && u < tB + 7.5);
      if (clap) o.arms = Math.floor(tc * 8 + j) % 2 ? "u" : "";
      if (u >= tB - .4 && u < tB + 2) o.eyes = ph.blink ? "c" : "o";
      if (mvp && u >= tB + 5 && u < tB + 7.5) { o = { view: "front", legs: "s", arms: "u", mouth: "o", eyes: "o" }; dy = dyHop(u - tB - 5, 12); }
      if (mvp && u >= tB + 5.6 && u < tB + 7.6) say = X(`제가요?! ${EMO[m.animal]}`, `Me?! ${EMO[m.animal]}`);
      if (dz && u >= tB + .6 && u < tB + 5.1) o = { view: "front", legs: "s", eyes: "c" };
      if (dz && u >= tB + 5.1 && u < tB + 5.8) o = { view: "front", legs: "s", eyes: "o", mouth: "o", arms: "u" };
      if (u >= S.tC) { o.arms = ""; o.mouth = mvp ? "o" : ""; }
    }
    const tg = h.parentFor(n, x, B[n] - 2);
    sty(a.el, "display", ""); sty(a.el, "opacity", k < .25 ? (k / .25).toFixed(2) : ""); h.setP(a, o); h.put(a, tg.p, tg.x, tg.feet, { dy, flip: walk, rot: walk ? (ph.wk ? 3 : -3) : 0 });
    sty(a.el, "zIndex", String(tg.z || (walk && k < .3 ? 9 : 20))); h.tagOn(a, false); h.bubble(a, say, !!say);
  }
  /* 사장님 — 본체의 사장님 그리기 대신 */
  function boss(b, bf, T, tc, ph) {
    const u = tc - S.t0, n = h.n(), B = G.BASE[n], tB = S.tB, al = S.v === "alone";
    if (S.v === "morning") {
      h.setP(b, { view: "front", seated: 1, eyes: ph.blink ? "c" : "o", arms: "r", specs: 1, mouth: Math.floor(tc * 4) % 2 ? "o" : "" }); h.put(b, bf.F, bf.chx, B - 6, { dy: ph.bob ? -1 : 0 }); h.tagOn(b, false);
      sty(b.el, "zIndex", "40"); sty(b.el, "pointerEvents", ""); b.bub.classList.add("updb", "drsay"); h.bubble(b, esc(S.say[0][2]), u < S.tC);
      G.ptr.forEach(p => show(p, false)); paper(b, bf, tc, true, true); return;
    }
    const up = al ? S.tA : 0, wk0 = up + (al ? .3 : .4), wk1 = up + 2.0;
    sty(bf.tag, "display", u >= (al ? S.tA : .2) ? "none" : "");
    let x, o, feet, dy = 0, z = "40";
    if (u < up) { o = { view: "front", seated: 1, eyes: ph.blink ? "c" : "o", mouth: u > .4 ? "o" : "", specs: 0 }; x = bf.chx; feet = B - 6; z = ""; }
    else if (u < wk1) { const k = (u - wk0) / (wk1 - wk0); x = lerp(bf.chx, BX, ease(k)); o = { view: "front", legs: k > 0 && k < 1 ? (ph.wk ? "a" : "b") : "s", eyes: "o", specs: 1 }; feet = B - 2; dy = k > 0 && k < 1 && ph.wk ? -4 : 0; }
    else {
      x = BX; feet = B - 2;
      const pt = u >= tB + .4 && u < S.tC - .4, hands = u >= tB + 5 && u < tB + 6;
      o = { view: "front", legs: "s", eyes: ph.blink ? "c" : "o", specs: 1, mouth: Math.floor(tc * 4) % 2 ? "o" : "" };
      if (pt) o.arms = "l";
      if (hands) { o.arms = "u"; o.mouth = "o"; dy = dyHop(u - tB - 5, 8); }
      if (u >= tB + 6.8) { o.arms = Math.floor(tc * 8) % 2 ? "u" : ""; }
      if (u >= S.tC) { o.arms = ""; o.mouth = "o"; }
    }
    h.setP(b, o); h.put(b, bf.F, x, feet, { dy }); h.tagOn(b, false); sty(b.el, "zIndex", z); sty(b.el, "pointerEvents", "");
    const sy = S.say.find(s => u >= s[0] && u < s[1]);
    b.bub.classList.toggle("updb", u >= up); b.bub.classList.add("drsay");
    h.bubble(b, sy ? esc(sy[2]) : "", !!sy);
    /* 포인터(왼손 → 발표판 오른쪽 끝) */
    const pt = u >= tB + .4 && u < S.tC - .4 && !(u >= tB + 5 && u < tB + 6);
    const hx = x - b.w / 2 + 10, hy = feet - b.h + 22 + dy;
    G.ptr.forEach((p, k) => { show(p, pt); if (pt) { sty(p, "left", Math.round(hx - k * 4) + "px"); sty(p, "top", Math.round(hy - k * 4) + "px"); } });
    show(G.paper, false);
  }
  /* 알림 중인 사장님: 종이를 들고 흔듦(본체가 말풍선을 이미 정함) */
  function paper(b, bf, T, anim, force) {
    if (!G || (S && !force)) return;
    const on = force || (!!note && !card);
    show(G.paper, on);
    if (on) { const L = parseFloat(b.el.style.left) || 0, Tp = parseFloat(b.el.style.top) || 0; sty(G.paper, "left", Math.round(L + b.w - 14) + "px"); sty(G.paper, "top", Math.round(Tp + 8 + (anim && Math.floor(T * 3) % 2 ? -4 : 0)) + "px"); sty(G.paper, "transform", anim && Math.floor(T * 3) % 2 ? "rotate(-8deg)" : "rotate(6deg)"); }
  }
  /* 한 프레임: 불 끄기 · 발표판 · 꽃가루 · 졸음 · 카드 등장 */
  function frame(T, tc, anim) {
    if (!S || !G) return;
    if (!anim) { finish(false); return; }
    const u = tc - S.t0, n = h.n(), tB = S.tB;
    G.ovs.forEach((o, i) => { const t = S.offs[i]; const on = t != null && u >= t; show(o.e, on); if (on) sty(o.e, "opacity", String(Math.min(1, (u - t) / .25))); show(o.ck, on && u - t < .6); });
    if (S.v !== "morning") S.onS.forEach(m => { const fi = h.floorOf(m.sid), fl = fi != null && G.FL[fi]; if (!fl || !fl.tag || u < m.L + .6) return; const em = fl.tag.children[2]; txt(em, "🌙 " + X("퇴근", "Off")); sty(em, "background", "#6a5a88"); });
    /* 발표판 */
    const bOn = u >= tB;
    show(G.board, bOn);
    if (bOn) {
      const shown = S.lines.filter(l => u >= l[0]), k = shown.length;
      sty(G.board, "transform", `translateY(${Math.round(-Math.max(0, 1 - (u - tB) / .3) * 50)}px)`);
      html(G.board, `<div class="hd"><span>📋 ${esc(X("오늘의 일보", "Today's report"))}</span><span class="r">${esc(DR.md(S.d.day))} · ${k}/3</span></div><div class="ln">${k ? esc(shown[k - 1][1]) : "…"}</div>`);
    }
    /* 꽃가루 */
    G.conf.forEach((c, i) => { const v = u - tB - 5 - pwH(i) * .6, on = v > 0 && v < 2.6; show(c, on); if (on) { sty(c, "left", Math.round((40 + pwH(i + 3) * 420 + Math.sin(v * 4 + i) * 6) / 4) * 4 + "px"); sty(c, "top", Math.round((4 + v * (40 + pwH(i + 9) * 30)) / 4) * 4 + "px"); } });
    /* 졸던 직원: Z → MVP 발표에 "!? 번쩍" */
    const dzm = S.dz >= 0 ? S.mem[S.dz] : null, a = dzm && dzm.a;
    const zOn = !!a && u >= tB + 1 && u < tB + 5.1, wOn = !!a && u >= tB + 5.1 && u < tB + 6.4;
    show(G.zz, zOn); show(G.wake, wOn);
    if (a && (zOn || wOn)) { const L = parseFloat(a.el.style.left) || 0, Tp = parseFloat(a.el.style.top) || 0, base = a.par === G.bld ? 0 : G.FT[n];
      if (zOn) { const q = (tc * 1.2) % 1; sty(G.zz, "left", Math.round(L + a.w - 6 + q * 10) + "px"); sty(G.zz, "top", Math.round(base + Tp - 10 - q * 16) + "px"); txt(G.zz, q > .5 ? "Z" : "z"); }
      if (wOn) { sty(G.wake, "left", Math.round(L + a.w - 10) + "px"); sty(G.wake, "top", Math.round(base + Tp - 8) + "px"); } }
    S.extra.forEach(xa => { const m = S.mem.find(q => q.a === xa); if (m) place(m, u, T, tc, { wk: Math.floor(T * 4) % 2, blink: (T % 3.7) < .14 }, null, null); });   // 화면에 없던 직원(엘리베이터로만 옴)
    if (u >= S.tC && !card) finish(true);
  }
  function finish(fly) { if (!S || card || opening) return; const from = !G ? null : S.v === "morning" ? G.paper : G.board; openCard(S.d, S.kind, fly && from && from.style.display !== "none" ? from : null); }
  /* ---------- 카드 ---------- */
  const isDark = () => !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches);
  let fontsP = null;
  const fonts = () => fontsP || (fontsP = doc.fonts && doc.fonts.load ? Promise.all(["700 12px Galmuri11", "700 24px Galmuri11"].map(f => doc.fonts.load(f))).catch(() => {}) : Promise.resolve());
  const cheerOn = () => !!h.cfg.cardCheer && !h.cfg.hideText;   // AI 한마디는 켰을 때만(기본 숨김)
  const cardOpt = sc => ({ X, who, en: en(), doc, dark: isDark(), kind: card.kind, hide: !!h.cfg.hideText, cheer: cheerOn(), sc });
  function paint() {
    if (!card) return;
    const k = fitBox(); DR.draw(cv, card.d, cardOpt(Math.min(4, Math.max(2, Math.ceil((win.devicePixelRatio || 1) * k)))));   // 화면은 선명하게, 저장은 늘 2배
    cv.setAttribute("aria-label", DR.text(card.d, { X, who, en: en(), kind: card.kind, hide: !!h.cfg.hideText, cheer: cheerOn() }));
    const hd = !!h.cfg.hideText, bs = box.querySelectorAll("button");
    html(bs[0], "💾 " + esc(X("이미지 저장", "Save image"))); bs[0].title = X("카드만 2배 크기 PNG로 저장", "Save the card as a 2× PNG");
    html(bs[1], `🙈 ${esc(X("프로젝트 이름 숨김", "Hide project names"))}<span class="tg${hd ? " on" : ""}"><i></i></span>`); bs[1].setAttribute("aria-pressed", hd ? "true" : "false");
    html(bs[2], "📋 " + esc(X("텍스트 복사", "Copy text")));
    txt(bs[3], "✕"); bs[3].setAttribute("aria-label", X("닫기", "Close")); bs[3].title = X("닫기 (Esc)", "Close (Esc)");
  }
  function fitBox() {
    const W0 = view.clientWidth, H0 = view.clientHeight; if (!W0 || !H0) return 1;
    sty(ov, "left", view.scrollLeft + "px"); sty(ov, "top", view.scrollTop + "px"); sty(ov, "width", W0 + "px"); sty(ov, "height", H0 + "px");   // 보이는 영역에 딱 맞춤(스크롤·좁은 창)
    const k = Math.max(.4, Math.min(1.25, (W0 - 16) / (DR.W + 6), (H0 - 16) / (DR.H + 46)));
    sty(box, "transform", `scale(${k})`); return k;
  }
  function openCard(d, kind, fromEl) {   // fromEl: 카드가 날아 나올 자리(발표판·종이)
    opening = true;
    const from = fromEl ? fromEl.getBoundingClientRect() : null;
    fonts().then(() => {
      opening = false;
      card = { d, kind, prev: doc.activeElement };
      if (S) skip.hidden = true;
      ov.hidden = false; paint(); toastEl.hidden = true;
      const k = fitBox();
      const anim = h.anim();
      if (from && anim && from.width) {
        const to = box.getBoundingClientRect(), s = from.width / to.width;
        sty(box, "transition", "none"); sty(box, "transform", `translate(${Math.round(from.left - to.left)}px,${Math.round(from.top - to.top)}px) scale(${(s * k).toFixed(3)})`); sty(box, "transformOrigin", "0 0");
        sty(ov, "transition", "none"); sty(ov, "opacity", "0");
        void box.offsetWidth;
        sty(box, "transition", "transform 1.1s cubic-bezier(.4,0,.2,1)"); sty(ov, "transition", "opacity .6s"); sty(ov, "opacity", "1");
        sty(box, "transform", `scale(${k})`);
        ctx.after(1150, () => { sty(box, "transition", ""); sty(box, "transformOrigin", ""); });
      } else { sty(box, "transition", ""); sty(box, "transformOrigin", ""); sty(ov, "transition", ""); sty(ov, "opacity", "1"); }
      const b = box.querySelector('[data-act="dr-save"]'); if (b) b.focus({ preventScroll: true });
      /* 봤다고 기억(같은 날 완료가 늘면 다시 알림) · ready인 날은 서버에도 */
      try { const m = DR.memoOf(ctx); if (!(m && m.day === d.day && m.done >= d.done)) ctx.store.set("dayrep", JSON.stringify({ day: d.day, done: d.done, t: Date.now() })); } catch {}
      if (d.ready && kind !== "preview" && typeof api.daylogSeen === "function") Promise.resolve(api.daylogSeen(d.day)).catch(() => {}).finally(() => poll(true));
      note = null; h.hud(); h.kick();
    });
  }
  function closeCard(quiet) {
    if (!card) { ov.hidden = true; return; }
    const prev = card.prev; card = null; ov.hidden = true; end();
    if (!quiet && prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
    refresh();
  }
  let toastT = null;
  function toast(s) { txt(toastEl, s); toastEl.hidden = false; if (toastT) toastT(); toastT = ctx.after(2600, () => { toastEl.hidden = true; toastT = null; }); }
  const fileName = d => `waitscape-${X("일보", "daily")}-${d.day}.png`;
  function save() {
    if (!card) return;
    const d = card.d, name = fileName(d), c2 = DR.draw(doc.createElement("canvas"), d, cardOpt(2));   // 카드만 2배 = 864×1180
    c2.toBlob(async blob => {
      if (!blob) return toast(X("이미지를 만들지 못했어요", "Couldn't make the image"));
      if (typeof api.saveImage === "function") {   // 앱: 저장 대화상자(Rust, 메인 창만)
        try { const p = await api.saveImage(name, new Uint8Array(await blob.arrayBuffer())); if (p && p.error) throw new Error(p.error); toast(p ? "✓ " + X("저장됨", "Saved") + " · " + String(p).split(/[\\/]/).pop() : X("저장을 취소했어요", "Save cancelled")); }
        catch (e) { win.console.warn("[studio] 일보 저장 실패", e); toast(X("저장하지 못했어요", "Couldn't save")); }
        return;
      }
      const url = win.URL.createObjectURL(blob), a = doc.createElement("a"); a.href = url; a.download = name; a.hidden = true; doc.body.appendChild(a); a.click(); a.remove();
      ctx.after(4000, () => win.URL.revokeObjectURL(url));
      toast("✓ " + X("저장됨", "Saved") + " · " + name);
    }, "image/png");
  }
  function copy() {
    if (!card) return;
    Promise.resolve().then(() => ctx.clipboard.write(DR.text(card.d, { X, who, en: en(), kind: card.kind, hide: !!h.cfg.hideText, cheer: cheerOn() })))
      .then(() => toast("✓ " + X("텍스트를 복사했어요", "Copied as text")), () => toast(X("복사하지 못했어요", "Couldn't copy")));
  }
  /* 시작점: 알림 누름 · 🏃 · 📋 · 미니 보기에서 누름 */
  function fetchDay(day) { return Promise.resolve(api.daylog(day)).then(d => { if (!DR.ok(d)) throw new Error((d && d.error) || "bad"); return d; }); }
  function go(kind, day, o = {}) {
    if (!can || opening) return;
    fetchDay(day || "today").then(d => {
      if (!view.isConnected) return;   // 그사이 모드가 바뀜
      if (day == null || day === "today") today = d;
      if (kind === "preview" || o.direct || !h.anim()) openCard(d, kind === "preview" ? (d.ready ? "ready" : "preview") : kind, null);
      else start(d, kind === "morning" ? "morning" : kind === "ready" && o.auto ? "alone" : "gather", kind);
    }, e => win.console.warn("[studio] 일보를 받지 못했어요", e && e.message));
  }
  function tap(act) {
    if (act === "dr-open") { const n = note; if (n) go(n.kind, n.kind === "morning" ? n.day : "today", { auto: n.auto }); }
    else if (act === "dr-go") go("manual", "today");
    else if (act === "dr-card") { const n = note; if (n) go(n.kind === "morning" ? "morning" : "preview", n.kind === "morning" ? n.day : "today", { direct: true }); else go("preview", "today"); }
    else if (act === "dr-skip") finish(false);
    else if (act === "dr-save") save();
    else if (act === "dr-copy") copy();
    else if (act === "dr-hide") { h.cfg.hideText = !h.cfg.hideText; h.saveCfg(); paint(); h.kick(); }
    else if (act === "dr-close") closeCard();
  }
  /* 1초마다: 미니 보기에서 누른 일보 열기 · 60초마다 폴링 · 퇴근 시각 */
  function tick() {
    poll(false);
    let o = null; try { o = h.clockT() - born > 1.5 && view.isConnected ? JSON.parse(ctx.store.get("drOpen", "") || "null") : null; } catch {}   // 막 올라온 창(다시 마운트 중)은 잠깐 기다림
    if (o && o.t && Date.now() - o.t < 120000) { ctx.store.set("drOpen", ""); go(o.kind === "morning" ? "morning" : "preview", o.kind === "morning" ? o.day : "today", { direct: true }); }
    if (!S && !card) refresh();
    if (card) fitBox();
  }
  ctx.listen(doc, "keydown", e => { if (e.key === "Escape" && card) { e.preventDefault(); closeCard(); } });
  ctx.listen(win.matchMedia ? win.matchMedia("(prefers-color-scheme: dark)") : doc, "change", () => paint());
  ctx.after(1200, () => poll(true));
  return { build, active, car, staff, boss, paper, frame, tap, tick, hud, poll: () => poll(true), notice: () => (S || card ? null : note), noteAge: tc => tc - noteAt, open: () => !!card, can };
}

/* ---------- 📋 미니 보기: 하단 알림 한 줄 + 사장님이 종이를 듦(카메라 이동 없음) → 누르면 큰 화면에서 카드 ---------- */
function dayrepMini(h) {
  const { ctx, mk, sty, txt, X } = h;
  const api = C.api || {}, can = typeof api.daylog === "function";
  let today = null, note = null, noteAt = 0, last = -1e9, busy = false;
  const line = mk("button", "drn", h.lw, { display: "none" }); line.type = "button"; line.dataset.act = "dr";
  function poll(force) {
    if (!can || busy || DR.off) return; const tc = h.clockT(); if (!force && tc - last < 60) return; last = tc; busy = true;
    Promise.resolve(api.daylog("today")).then(d => { today = DR.ok(d) ? d : null; if (d && d.error === "off") DR.off = true; else if (!today) DR.warn("mini", d); DR.fail = 0; }, e => { today = null; DR.warn("mini", e); if (++DR.fail >= 3) DR.off = true; }).finally(() => { busy = false; refresh(); });
  }
  function refresh() {
    let cfg = {}; try { cfg = JSON.parse(ctx.store.get("cfg", "") || "{}") || {}; } catch {}
    const n = DR.notice(today, DR.memoOf(ctx), cfg.offAt, ctx.now());
    if ((n && n.kind + n.day) !== (note && note.kind + note.day)) noteAt = h.clockT();
    note = n;
  }
  /* 그리기: 자막이 비었을 때만 알림 줄(질문·완료 자막이 먼저) */
  function frame(sub) {
    const on = !!note && !sub;
    sty(line, "display", on ? "block" : "none");
    if (on) txt(line, note.kind === "morning" ? X("☀️ 어제 일보 · 좋은 아침! ▸", "☀️ Yesterday's report · good morning! ▸") : X(`📋 오늘 일보 도착! 완료 ${note.done} · 🎉${note.big} ▸`, `📋 Today's report! ${note.done} done · 🎉${note.big} ▸`));
    line.setAttribute("aria-label", X("누르면 큰 화면에서 일보 카드를 열어요", "Opens the report card in the full window"));
  }
  function tap() {
    if (!note) return;
    ctx.store.set("drOpen", JSON.stringify({ kind: note.kind, day: note.day, t: Date.now() }));   // 큰 화면이 1초 안에 카드를 연다
    if (ctx.api.showMain) ctx.api.showMain();
  }
  ctx.every(1000, () => { poll(false); refresh(); });
  ctx.after(1500, () => poll(true));
  return { frame, tap, note: () => note, age: tc => tc - noteAt, tip: () => X("📋 누르면 큰 화면에서 일보 카드를 열어요", "📋 Click to open the report card in the full window") };
}

/* ================= 🎨 층 꾸미기 (DECOR: 카탈로그·저장·소품 그리기 공용 · 큰 화면 decorBig · 미니 보기 decorMini. 본체에는 연결 줄만) =================
   완료로 모은 자금(💰)으로 층마다 소품을 사서 칸(벽 2 · 책상 1 · 바닥 2)에 둔다. 사장실 상점(SHOP 7종)은 그대로, 층 소품은 층마다 따로 산다.
   - 층 키 = 프로젝트 이름(session.project): 세션이 바뀌어도 꾸밈 유지. 7일 넘게 안 온 프로젝트의 소품은 창고(wh)로 → 다시 오면 그대로 복원(택배로 돌아옴)
   - 옮기기 무료(같은 종류 칸끼리 · 다른 층으로도) · 되팔기 50%
   - 직원(동물)마다 좋아하는 소품 2개(LIKES): 두면 하트, 쉴 때(idle) 그 옆에 가서 쉼
   - 카탈로그(CAT)는 저장과 따로: 팩 → 아이템(id · 가격 p · 칸 종류 slot · 해금 Lv · 그림). 테마·추가 팩은 packs에 한 덩이(그림은 팩의 art) 더하면 됨.
     결제 기능은 없음 — 자금(💰)으로만 산다
   - 🎃 시즌 팩(#54): 팩에 win: { from: [월, 일], to: [월, 일] }(양끝 포함 · 새벽 4시 경계 날짜 · from > to면 해를 넘김, 설날 같은 팩용)을 두면
     그 기간에만 꾸미기 판에 보이고 살 수 있음. 산 소품은 기간이 끝나도 그대로(옮기기·되팔기 50%·창고 복원 모두 평소처럼) — ITEMS(소유 조회)는 기간과 상관없이 모든 팩을 담음.
     팩 = { id, n: [ko, en], e: 이모지, win, art, items } · 아이템 ltd: 1 = "한정판" 딱지 · hi: [ko, en] = 도착했을 때 직원 한마디. 크리스마스·설날은 팩 한 덩이 추가로 끝.
     개발용 쿼리 ?season=halloween(그 팩 기간 강제, 쉼표로 여럿) · ?season=off(모든 시즌 팩 닫힘) · ?season=11-20(오늘을 그 월-일로) — sp(🎃 점)는 저장하지 않음
     모르는 소품 id(다운그레이드 등)는 그리지 않고 저장은 그대로 · 판에선 ❔ 카드 + 옮기기만(되팔기 없음)
   - 저장 ctx.store "decor" = { v: 1, fl: { 프로젝트: { s: {칸: id}, at: {칸: 산 시각(초)}, seen, wilt, wat } }, wh: { 프로젝트: { s, at, put } }, last: { p, slot, id, t, back }, sp: "팩id:해,…" }
     (sp = 그 시즌에 꾸미기 판을 한 번 열어 본 팩 키들(쉼표) → 🎨 버튼의 🎃 점을 거둠. v 1에 더한 필드라 없으면 빈 값, 옛 키 하나짜리도 그대로. 개발용 ?season= 쿼리일 땐 쓰지 않음)
     큰 화면만 쓰고 미니 보기는 읽기만(1초마다·상태가 올 때). 모르는 새 버전(v > 1)이면 읽기만 하고 덮어쓰지 않음 */
const DECOR = (() => {
  const K = "#4a3560";
  const ART = {
    plant3: { r: [".....RR.....", "....RYYR....", "..G..RR..G..", ".GGG.GG.GGG.", "GGLGGGGGGLGG", ".GGGLGGLGGG.", "..GGGGGGGG..", "....GGGG....", ".....GG.....", "..KKKKKKKK..", "..KPPPPPPK..", "..KPPPPPPK..", "...KPPPPK...", "...KKKKKK..."], p: { K, G: "#5fcf6a", L: "#3a9a4a", P: "#d9744a", R: "#ff8ab0", Y: "#ffd23f" } },
    plant2: { r: ["..G.....G...", ".GGG.GG.GGG.", "GGLGGGGGGLGG", ".GGGLGGLGGG.", "..GGGGGGGG..", "....GGGG....", ".....GG.....", "..KKKKKKKK..", "..KPPPPPPK..", "..KPPPPPPK..", "...KPPPPK...", "...KKKKKK..."], p: { K, G: "#5fcf6a", L: "#3a9a4a", P: "#d9744a" } },
    plant1: { r: ["....G.G.....", "...GGGGG....", "....GGG.....", ".....G......", "..KKKKKKKK..", "..KPPPPPPK..", "..KPPPPPPK..", "...KPPPPK...", "...KKKKKK..."], p: { K, G: "#5fcf6a", P: "#d9744a" } },
    wilt: { r: ["............", "....D.......", "...DDD..D...", "..D..DDDD...", ".D...DD..D..", ".....D....D.", ".....D......", "..KKKKKKKK..", "..KPPPPPPK..", "..KPPPPPPK..", "...KPPPPK...", "...KKKKKK..."], p: { K, D: "#b39a52", P: "#c9805a" } },
    cactus: { r: ["...GG...", "..GGGG..", "G.GLGG..", "GGGGGG.G", ".GGLGGGG", "..GGGG..", "..GGGG..", "KKKKKKKK", "KPPPPPPK", ".KPPPPK.", ".KKKKKK."], p: { K, G: "#4fb86a", L: "#2f8a45", P: "#e0a060" } },
    poster: { r: ["KKKKKKKKKKKK", "KTTTTTTTTTTK", "KTTTTTTSSTTK", "KTTTTTTSSTTK", "KTTTTTTTTTTK", "KTTTWTTTTTTK", "KTTWWWTTTTTK", "KTWWWWWTTWTK", "KWWWWWWWWWWK", "KWWWWWWWWWWK", "KttttttttttK", "KtKKtKtKKttK", "KttttttttttK", "KtKKKtKKtKtK", "KttttttttttK", "KKKKKKKKKKKK"], p: { K } },
    clock: { r: ["..KKKKKK..", ".KWWWWWWK.", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWWWWWWWK", ".KWWWWWWK.", "..KKKKKK.."], p: { K, W: "#fffaf0" } },
    lamp: { r: ["..KKKKKK..", ".KYYYYYYK.", "KYYYYYYYYK", "KKKKKKKKKK", ...Array(15).fill("....KK...."), "..KKKKKK..", ".KMMMMMMK.", "KKKKKKKKKK"], p: { K, Y: "#ffe08a", M: "#8a6ab0" } },
    rug: { r: ["...KKKKKKKKKKKKKKKKKKKKKKKK...", ".KKRRRRRRRRRRRRRRRRRRRRRRRRKK.", "KRRWRRWRRWRRWRRWRRWRRWRRWRRWRK", "KRYYYYYYYYYYYYYYYYYYYYYYYYYYRK", "KRRWRRWRRWRRWRRWRRWRRWRRWRRWRK", ".KKRRRRRRRRRRRRRRRRRRRRRRRRKK.", "...KKKKKKKKKKKKKKKKKKKKKKKK..."], p: { K, R: "#e0707e", W: "#ffe0b0", Y: "#c84a5e" } },
    tank: { r: ["KKKKKKKKKKKKKKKK", "KBBBBBBBBBBBBBBK", "KWWWWWWWWWWWWWWK", "KWWWWWWWWWWWWWWK", "KWWWWWWWWWWWWGWK", "KWGWWWWWWWWWGWWK", "KWGGWWWWWWWWGGWK", "KWWGWWWWWWWWWGWK", "KSSSSSSSSSSSSSSK", "KKKKKKKKKKKKKKKK"], p: { K, B: "#6a6a80", W: "#9fdcff", G: "#3fa35a", S: "#f0d08a" } },
    fish: { r: [".OO..", "OOOOT", ".OO.."], p: { O: "#ff8a3d", T: "#ffb36b" } },
    snack: { r: ["KKKKKKKKKKKKKKKKKKKK", "KRWRWRWRWRWRWRWRWRWK", ".KRWRWRWRWRWRWRWRWK.", "..K..............K..", "..K..............K..", "..KKKKKKKKKKKKKKKK..", "..KDDDDDDDDDDDDDDK..", "..KDPDDPDDPDDPDDDK..", "..KDDDDDDDDDDDDDDK..", "..KKKKKKKKKKKKKKKK..", "..KMMMMMMMMMMMMMMK..", "..KMMMMMMMMMMMMMMK..", "..KMMMMMMMMMMMMMMK..", "..KKKKKKKKKKKKKKKK..", "...KK..........KK..."], p: { K, R: "#ff6b8a", W: "#fff", D: "#fff1d6", P: "#ff8ab0", M: "#c98d5a" } },
    plush: { r: [".KK....KK.", "KBBK..KBBK", "KBBBBBBBBK", ".KBWBBWBK.", ".KBBNNBBK.", "..KBBBBK..", ".KBBBBBBK.", "KBBBBBBBBK", ".KBK..KBK.", "..K....K.."], p: { K, B: "#d99a5a", W: "#2e2040", N: "#7a4a2a" } },
    box: { r: ["KKKKKKKKKKKK", "KCCCCTTCCCCK", "KCCCCTTCCCCK", "KKKKKKKKKKKK", "KCCCCTTCCCCK", "KCCCCCCCCCCK", "KCCCCCCCCCCK", "KCCCCCCCCCCK", "KKKKKKKKKKKK"], p: { K, C: "#d9a05a", T: "#f0e0b0" } },
    can: { r: ["....KKK...", "K..KBBBK..", "KK.KBBBBK.", ".KKKBBBBK.", "...KBBBBK.", "...KKKKKK."], p: { K, B: "#5aa8ff" } },
    heart: { r: [".KK.KK.", "KRRKRRK", "KRRRRRK", ".KRRRK.", "..KRK..", "...K..."], p: { K: "#2e2040", R: "#ff6b8a" } },
  };
  /* 포스터 = 그 층 AI 색 테마 (T 바탕 · t 아래 띠 · S 해 · W 산) */
  const POSTER = { claude: { T: "#ff9a5c", t: "#fff1e0", S: "#ffe36b", W: "#c8502a" }, codex: { T: "#5fcf8a", t: "#eafff0", S: "#fff6a0", W: "#2f8a55" }, gemini: { T: "#7a8cff", t: "#eef0ff", S: "#ffe36b", W: "#3a4ac0" }, other: { T: "#b4b8c8", t: "#f4f4f8", S: "#ffe36b", W: "#5a5f72" } };
  /* 카탈로그 (가격: 시안 4 가격표 — 작은 것 반나절 · 중간 하루 · 큰 것 1~2일, 한 층 5칸 ≈ 1,200 = 하루 반) */
  const CAT = { v: 1, packs: [{ id: "base", n: ["기본 소품", "Basics"], art: {}, items: [
    { id: "cactus", slot: "desk", p: 80, lv: 1, a: "cactus", n: ["선인장", "Cactus"] },
    { id: "plush", slot: "desk", p: 180, lv: 1, a: "plush", n: ["곰 인형", "Teddy"] },
    { id: "tank", slot: "desk", p: 400, lv: 1, a: "tank", n: ["어항", "Fish tank"] },
    { id: "poster", slot: "wall", p: 150, lv: 1, a: "poster", n: ["포스터", "Poster"], note: ["AI 색 테마", "AI colors"] },
    { id: "clock", slot: "wall", p: 200, lv: 1, a: "clock", n: ["벽시계", "Clock"] },
    { id: "neon", slot: "wall", p: 500, lv: 4, n: ["네온사인", "Neon sign"] },
    { id: "plant", slot: "floor", p: 120, lv: 1, a: "plant3", n: ["화분", "Plant"], note: ["날마다 자라요", "Grows daily"] },
    { id: "lamp", slot: "floor", p: 220, lv: 1, a: "lamp", n: ["스탠드", "Floor lamp"] },
    { id: "rug", slot: "floor", p: 260, lv: 1, a: "rug", n: ["러그", "Rug"] },
    { id: "snack", slot: "floor", p: 600, lv: 3, a: "snack", n: ["간식 바", "Snack bar"] },
  ] },
  /* 🎃 할로윈(10/20~11/7). 줄 그림 batg는 아래 stamp로 조립 */
  { id: "halloween", n: ["할로윈", "Halloween"], e: "🎃", win: { from: [10, 20], to: [11, 7] }, art: {
    hwweb: { r: ["GGGGGGGGGGGGG", ".G..G.G.G..G.", ".GG.G.G.G.GG.", "..GGGGGGGGG..", "...G.G.G.G...", "....GGGGG....", ".....G.G.....", "......G......", "......G......", ".....KKK.....", "....KKRKK....", ".....K.K....."], p: { K, G: "#a89cc8", R: "#ff5a6a" } },
    hwjack: { r: ["....KKK.....", "....KSK.....", "..KKKSKKKK..", ".KOOoOOoOOK.", "KOOOoOOoOOOK", "KOYYoOOoYYOK", "KOYYoOOoYYOK", "KOOOoYYoOOOK", "KOYYYYYYYYOK", "KOOYoYYoYOOK", ".KOOoOOoOOK.", "..KKKKKKKK.."], p: { K, S: "#5f8a3a", O: "#ff8a3d", o: "#d9642a", Y: "#ffe36b" } },
    hwcandy: { r: ["...KKKK...", "..K....K..", ".K.RBBG.K.", "KKRRBGGRKK", "KOOOOOOOOK", "KOKOOOOKOK", "KOOOKKOOOK", "KOKKKKKKOK", ".KOOOOOOK.", "..KKKKKK.."], p: { K, O: "#ff8a3d", R: "#ff6b8a", B: "#5aa8ff", G: "#6adf8a" } },
    hwghost: { r: ["...KKKK...", "..KWWWWK..", ".KWWWWWWK.", ".KWKWWKWK.", ".KWKWWKWK.", "KWWWWWWWWK", "KWPWKKWPWK", "KWWWWWWWWK", "KWWWWWWWWK", "KWWKWWKWWK", ".KK.KK.KK."], p: { K, W: "#fbf8ff", P: "#ffb3c8" } },
    hwpot: { r: [".KKKKKKKKKKKKKK.", "KGGLGGGGGGLGGGGK", "KKKKKKKKKKKKKKKK", ".KDDDDDDDDDDDDK.", "KDDHDDDDDDDDDDDK", "KDHDDDDDDDDDDDDK", "KDHDDDDDDDDDDDDK", "KDDDDDDDDDDDDDDK", ".KDDDDDDDDDDDDK.", "..KKKKKKKKKKKK..", "..KK.RYR.RYR.KK.", ".KK..RRR.RRR..KK"], p: { K, G: "#7adf6a", L: "#c8ff9a", D: "#4a4060", H: "#7a7096", R: "#ff8a3d", Y: "#ffd23f" } },
  }, items: [
    { id: "hw_web", slot: "wall", p: 150, lv: 1, a: "hwweb", n: ["거미줄", "Spider web"] },
    { id: "hw_bats", slot: "wall", p: 240, lv: 1, a: "hwbats", n: ["박쥐 가랜드", "Bat garland"], dx: -4 },
    { id: "hw_candy", slot: "desk", p: 180, lv: 1, a: "hwcandy", n: ["사탕 바구니", "Candy bucket"], hi: ["사탕이다! 하나만…", "Candy! Just one…"] },
    { id: "hw_jack", slot: "desk", p: 300, lv: 1, a: "hwjack", n: ["호박 등불", "Pumpkin lamp"], note: ["반짝반짝", "Flickers"], hi: ["해피 할로윈! 🎃", "Happy Halloween! 🎃"] },
    { id: "hw_ghost", slot: "floor", p: 380, lv: 1, a: "hwghost", n: ["꼬마 유령", "Little ghost"], note: ["둥실둥실", "Floats"], hi: ["으앗, 유령?! 👻", "Eek, a ghost?! 👻"] },
    { id: "hw_pot", slot: "floor", p: 800, lv: 1, a: "hwpot", n: ["마녀 솥", "Cauldron"], ltd: 1, hi: ["보글보글… 뭐가 나올까?", "Bubble bubble… what's brewing?"] },
  ] }] };
  /* 작은 그림 여러 개를 한 판에 찍기(가랜드처럼 반복되는 그림) */
  const stamp = (w, hh, parts) => { const g = Array.from({ length: hh }, () => Array(w).fill(".")); parts.forEach(([r, x, y]) => r.forEach((row, j) => [...row].forEach((c, i) => { if (c !== "." && g[y + j] && x + i >= 0 && x + i < w) g[y + j][x + i] = c; }))); return g.map(r => r.join("")); };
  {   // 🦇 박쥐 가랜드: 양끝 끈(5칸, 벽 칸 위쪽에서 내려 걺) + 처진 줄(가운데 3칸 아래) + 박쥐 2 · 주황 깃발 1. 폭 17칸 = 큰 화면 51px(벽 1 칸 안 — 직원 이름표와 안 겹치게)
    const W = 17, sag = x => Math.round(3 * (1 - ((x - 8) / 8) ** 2)), line = [], pin = ["K", "K", "K", "K", "K"];
    for (let x = 0; x < W; x++) line.push([["K"], x, sag(x) + 5]);
    const bat = ["..P.P..", "P.PPP.P", "PPYPYPP", ".P.P.P."], flag = ["OOO", ".O."];
    CAT.packs.find(pk => pk.id === "halloween").art.hwbats = { r: stamp(W, 13, [...line, [bat, 0, sag(3) + 6], [bat, 10, sag(13) + 6], [flag, 7, sag(8) + 6], [pin, 0, 0], [pin, W - 1, 0]]), p: { K, P: "#5a3a7a", Y: "#ffe36b", O: "#ff8a3d" } };
  }

  const ITEMS = Object.create(null), PACK = Object.create(null);   // ITEMS = 모든 팩(기간과 상관없이 — 이미 산 소품을 찾을 때) · PACK = 팩 id → 팩. 프로토타입 없는 맵(저장의 모르는 id가 toString 같은 이름이어도 안전)
  CAT.packs.forEach(pk => { PACK[pk.id] = pk; Object.assign(ART, pk.art || {}); pk.items.forEach(it => { ITEMS[it.id] = Object.assign({ pack: pk.id }, it); }); });
  /* 🎃 시즌: 오늘(새벽 4시 경계, 퇴근 일보·달력과 같음)의 월·일 → 팩 기간 안인지. 개발용 ?season= (위 설명) */
  const SDEV = (() => { const o = { on: new Set(), off: false, md: 0 }; try { const v = (new URLSearchParams(location.search).get("season") || "").trim(), m = v.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) o.md = +m[1] * 100 + +m[2]; else if (v === "off") o.off = true; else v.split(",").filter(Boolean).forEach(x => o.on.add(x)); } catch {} return o; })();
  const mdOf = t => { const d = new Date((t - 4 * 3600) * 1000); return (d.getMonth() + 1) * 100 + d.getDate(); };
  const yearOf = t => new Date((t - 4 * 3600) * 1000).getFullYear();
  function packOpen(pk, t) {
    if (!pk || !pk.win) return !!pk;
    if (SDEV.off) return false; if (SDEV.on.has(pk.id)) return true;
    const m = SDEV.md || mdOf(t), a = pk.win.from[0] * 100 + pk.win.from[1], b = pk.win.to[0] * 100 + pk.win.to[1];
    return a <= b ? m >= a && m <= b : m >= a || m <= b;   // 해를 넘기는 기간(12/25 ~ 2/10 같은)
  }
  const onSale = (id, t) => !!ITEMS[id] && packOpen(PACK[ITEMS[id].pack], t);
  const seasons = t => CAT.packs.filter(pk => pk.win && packOpen(pk, t));
  /* 시즌 키(🎃 점을 거둔 기록): 해를 넘기는 팩은 시작한 해 기준 */
  const seasonKey = (pk, t) => pk.id + ":" + (yearOf(t) - (pk.win.from[0] * 100 + pk.win.from[1] > pk.win.to[0] * 100 + pk.win.to[1] && (SDEV.md || mdOf(t)) <= pk.win.to[0] * 100 + pk.win.to[1] ? 1 : 0));   // ?season=MM-DD면 그 가짜 날짜로
  const devSeason = () => !!(SDEV.on.size || SDEV.md || SDEV.off);   // 개발용 쿼리로 본 시즌은 sp(🎃 점 거둠)에 남기지 않음
  const untilOf = pk => pk.win.to[0] + "/" + pk.win.to[1];
  const LIKES = { ham: ["snack", "plant"], peng: ["tank", "lamp"], bvr: ["rug", "plant"], otr: ["tank", "snack"], oct: ["tank", "neon"], bot: ["neon", "lamp"], cat: ["tank", "rug"] };
  const SLOTS = ["W1", "W2", "D1", "F1", "F2"], KIND = { W1: "wall", W2: "wall", D1: "desk", F1: "floor", F2: "floor" };
  const SLOTN = { W1: ["벽 1", "Wall 1"], W2: ["벽 2", "Wall 2"], D1: ["책상", "Desk"], F1: ["바닥 1", "Floor 1"], F2: ["바닥 2", "Floor 2"] };
  /* 칸 기준점: 벽 = 위 가운데, 책상·바닥 = 아래 가운데. 큰 화면(층 좌표, B = 층 바닥선) · 미니 보기(방 좌표, FY = 132).
     큰 화면 벽 2는 간판(x 522~, y 40~) 위로 올려 둠(시안보다 20px 위) */
  const bigAt = (slot, B) => ({ W1: { x: 296, y: 24 }, W2: { x: 600, y: 2 }, D1: { x: 320, y: B - 26 }, F1: { x: 160, y: B - 2 }, F2: { x: 618, y: B - 2 } })[slot];
  const MINI = { W1: { x: 69, y: 27 }, W2: { x: 207, y: 30 }, D1: { x: 57, y: 102 }, F1: { x: 33, y: 132 }, F2: { x: 194, y: 132 } };
  const MSC = { plant: 3, cactus: 3 };   // 미니 보기에서 작은 화분·선인장은 한 단계 크게
  const zOf = (id, kind) => id === "rug" ? 2 : kind === "desk" ? 10 : kind === "floor" ? 7 : 3;
  const VER = 1, DAY = 86400, AWAY = 7 * DAY, WILT = 3 * DAY, WH_MAX = 100;
  const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const nmap = v => { const m = Object.create(null); Object.keys(obj(v)).forEach(k => { m[k] = v[k]; }); return m; };   // 프로젝트 이름 = 키: 프로토타입 없는 맵(constructor·__proto__ 같은 이름도 안전)
  const blank = () => ({ v: VER, fl: nmap(), wh: nmap(), last: null, sp: "" });
  function load(raw) {
    let j = null; try { j = JSON.parse(raw || "null"); } catch {}
    if (!j || typeof j !== "object" || typeof j.v !== "number") return blank();
    const d = { v: VER, fl: nmap(j.fl), wh: nmap(j.wh), last: j.last && typeof j.last === "object" ? j.last : null, sp: typeof j.sp === "string" ? j.sp : "", ro: j.v > VER };   // 더 새 버전이 쓴 저장: 읽기만
    [d.fl, d.wh].forEach(m => Object.keys(m).forEach(p => { const e = m[p] = obj(m[p]); e.s = obj(e.s); e.at = obj(e.at); }));
    return d;
  }
  const dump = d => JSON.stringify({ v: VER, fl: d.fl, wh: d.wh, last: d.last, sp: d.sp || "" });
  const hasPlant = F => !!F && Object.values(F.s).includes("plant");
  /* 층이 보임(now 초): 창고에서 복원 · 3일 넘게 안 왔으면 화분이 시듦 · seen 갱신(10분마다). 반환 { back: 복원된 칸들, ch: 저장할 변화 } | null */
  function touch(d, p, now) {
    let F = d.fl[p], back = null, ch = false;
    if (!F && d.wh[p]) { const w = d.wh[p]; F = d.fl[p] = { s: w.s, at: w.at, seen: now, wilt: hasPlant(w) ? 1 : 0 }; delete d.wh[p]; back = Object.keys(F.s); ch = true; }
    if (!F) return null;
    if (F.seen && now - F.seen >= WILT && hasPlant(F) && !F.wilt) { F.wilt = 1; ch = true; }
    if (!F.seen || now - F.seen > 600) { F.seen = now; ch = true; }
    return { back, ch };
  }
  /* 지금 층에 없는 프로젝트 중 7일 넘게 안 온 곳 → 창고 */
  function sweep(d, now, live) {
    let ch = false;
    Object.keys(d.fl).forEach(p => {
      const F = d.fl[p]; if (live.has(p) || now - (F.seen || 0) <= AWAY) return;
      if (Object.keys(F.s).length) d.wh[p] = { s: F.s, at: F.at, put: now };
      delete d.fl[p]; ch = true;
    });
    const w = Object.keys(d.wh); if (w.length > WH_MAX) { w.sort((a, b) => (d.wh[a].put || 0) - (d.wh[b].put || 0)).slice(0, w.length - WH_MAX).forEach(p => delete d.wh[p]); ch = true; }
    return ch;
  }
  /* 화분: 산 날 새싹 → 다음 날 잎 → 그다음부터 꽃. 시들면 그 층 완료 때 물 줌 */
  const plantArt = (F, slot, now) => F && F.wilt ? "wilt" : (d => d <= 0 ? "plant1" : d === 1 ? "plant2" : "plant3")(Math.floor((now - ((F && F.at[slot]) || now)) / DAY));
  /* 좋아하는 소품이 놓인 칸(바닥 먼저) */
  const likeSlot = (F, an) => { const L = LIKES[an] || []; return F ? ["F1", "F2", "D1", "W1", "W2"].find(sl => F.s[sl] && L.includes(F.s[sl])) || null : null; };
  const pimg = (art, sc, x, y, css, key) => { const s = WB.pix(art, sc, key); return `<img alt="" src="${s.url}" style="position:absolute;left:${x}px;top:${y}px;width:${s.w}px;height:${s.h}px;${css || ""}">`; };
  /* 소품 하나 → { w, ht, h(안쪽 HTML) }. o = { t, anim, fishX(0~1), fishDir, dark, prov, plant(그림 키), now(Date) } */
  function itemHTML(id, sc, o) {
    const t = o.t || 0, it = ITEMS[id];
    if (id === "neon") { const w = sc * 16, on = !o.anim || Math.floor(t * 3) % 9 !== 0;   // 가끔 깜빡
      return { w, ht: sc * 7, h: `<div style="position:absolute;inset:0;background:#3a1f4a;border:${sc}px solid #ff6bc0;color:#ff9ad8;font-weight:900;font-size:${sc * 4}px;line-height:${sc * 5}px;text-align:center;letter-spacing:0;text-shadow:${on ? "0 0 6px #ff6bc0" : "none"}">OK!</div>` }; }
    let art = ART[id === "plant" ? o.plant || "plant3" : it && it.a || id];
    const pk = id === "poster" ? "poster:" + (POSTER[o.prov] ? o.prov : "claude") : undefined;   // WB.pix 캐시 키는 문자 그림 + 잉크 → 팔레트만 다른 포스터는 키를 따로(포스터엔 잉크 칸 C가 없어 색은 그대로)
    if (id === "poster") art = { r: ART.poster.r, p: Object.assign({ K }, POSTER[o.prov] || POSTER.claude) };
    if (!art) return { w: 0, ht: 0, h: "" };
    const s = WB.pix(art, sc, pk); let h = pimg(art, sc, 0, 0, "", pk);
    if (id === "clock") {   // 진짜 시각(분침은 5분 칸)
      const d = o.now || new Date(), m = d.getMinutes(), md = Math.round(m / 5) * 30 % 360, hd = Math.round((d.getHours() % 12 + m / 60)) * 30 % 360, cx = s.w / 2 - sc / 2;
      h += `<i style="position:absolute;left:${cx}px;top:${sc * 2}px;width:${sc}px;height:${sc * 3}px;background:#2e2040;transform-origin:50% 100%;transform:rotate(${md}deg)"></i><i style="position:absolute;left:${cx}px;top:${sc * 3}px;width:${sc}px;height:${sc * 2}px;background:#d23a4a;transform-origin:50% 100%;transform:rotate(${hd}deg)"></i>`;
    }
    if (id === "tank") {   // 물고기가 직원 쪽으로 헤엄 · 기포 뽀글
      const fx = Math.round(sc * (2 + clamp(o.fishX == null ? .5 : o.fishX, 0, 1) * 8)), fy = sc * (4 + (o.anim ? Math.round(Math.sin(t * 2)) : 0));
      h += pimg(ART.fish, sc, fx, fy, `transform:scaleX(${o.fishDir < 0 ? 1 : -1})`);
      if (o.anim) { const bb = (t * .8) % 1; h += `<i style="position:absolute;left:${sc * 12}px;top:${Math.round(sc * (7 - bb * 5))}px;width:${sc}px;height:${sc}px;background:#fff;opacity:.8"></i>`; }
    }
    if (id === "hw_jack") {   // 🎃 촛불이 살랑(움직임 줄이기면 가만히) · 다크에서 더 밝게
      /* 살랑임은 CSS 애니메이션(stu-hwflk) — 그림 문자열이 시각과 무관해서 매 프레임 innerHTML을 다시 쓰지 않음 */
      h = `<i style="position:absolute;left:${-s.w / 2}px;top:${-s.h / 3}px;width:${s.w * 2}px;height:${s.h * 1.6}px;background:radial-gradient(ellipse at 50% 60%,rgba(255,170,60,${o.dark ? .5 : .28}),transparent 62%);pointer-events:none${o.anim ? ";animation:stu-hwflk 1.9s ease-in-out infinite" : ""}"></i>` + h;
    }
    if (id === "hw_ghost") {   // 👻 둥실둥실(정지면 살짝 뜬 채) + 바닥 그림자
      h = `<i style="position:absolute;left:${sc * 2}px;top:${s.h - sc}px;width:${s.w - sc * 4}px;height:${sc}px;border-radius:50%;background:rgba(46,32,64,${o.dark ? .35 : .18})"></i>` + pimg(art, sc, 0, -sc * 2, o.anim ? `--b:${sc * 1.5}px;animation:stu-hwbob 2.9s ease-in-out infinite` : "", pk);   // 둥실(stu-hwbob, --b만큼)
    }
    if (id === "hw_pot") {   // 🧪 보글보글 거품(정지면 하나만) · 다크에서 초록 김
      for (let i = 0; i < (o.anim ? 3 : 1); i++) { const bx = sc * [4, 9, 12][i], z = sc * (i === 1 ? 2 : 1);   // 거품은 CSS 애니메이션(stu-hwbub, --b만큼 솟음) · 정지면 하나만 떠 있음
        h += `<i style="position:absolute;left:${bx}px;top:${o.anim ? 0 : -sc * 2}px;width:${z}px;height:${z}px;background:#c8ff9a;border:1px solid #3a8a3a;${o.anim ? `--b:${sc * 5}px;opacity:0;animation:stu-hwbub 1.45s linear ${(-i * .48).toFixed(2)}s infinite` : "opacity:.7"}"></i>`; }
      if (o.dark) h = `<i style="position:absolute;left:${-s.w / 4}px;top:${-s.h / 2}px;width:${s.w * 1.5}px;height:${s.h}px;background:radial-gradient(ellipse at 50% 70%,rgba(122,223,106,.3),transparent 65%);pointer-events:none"></i>` + h;
    }
    if (id === "lamp" && o.dark) h = `<i style="position:absolute;left:${-s.w}px;top:${sc * 2}px;width:${s.w * 3}px;height:${s.h}px;background:radial-gradient(ellipse at 50% 0,rgba(255,230,140,.45),transparent 70%);pointer-events:none"></i>` + h;   // 다크에서만 불빛
    return { w: s.w, ht: s.h, h };
  }
  /* 택배 상자: 위에서 떨어져 통통 → 들썩 → 펑(u = 산 뒤 초, 1.1초에 소품이 나옴) */
  function boxHTML(a, kind, sc, u) {
    const bs = WB.pix(ART.box, sc), gy = kind === "wall" ? a.y + sc * 14 : a.y;
    let y, h = "";
    if (u < .45) y = lerp(-bs.h, gy - bs.h, (u / .45) * (u / .45)); else if (u < .65) y = gy - bs.h - Math.sin((u - .45) / .2 * Math.PI) * sc * 3; else y = gy - bs.h;
    if (u < 1.1) h += `<img class="b" alt="" src="${bs.url}" style="left:${Math.round(a.x - bs.w / 2)}px;top:${Math.round(y)}px;width:${bs.w}px;height:${bs.h}px;z-index:14;${u > .8 ? `transform:translateX(${Math.floor(u * 30) % 2 ? sc : -sc}px)` : ""}">`;
    if (u >= 1.05 && u < 1.4) { const r = (u - 1.05) / .35; for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2, dd = sc * (3 + r * 9); h += `<i class="b" style="left:${Math.round(a.x + Math.cos(an) * dd)}px;top:${Math.round(gy - bs.h / 2 + Math.sin(an) * dd)}px;width:${sc * 2}px;height:${sc * 2}px;background:#fff;border:1px solid #9a8ab0;opacity:${(1 - r).toFixed(2)};z-index:15"></i>`; } }
    return h;
  }
  /* 물뿌리개(시든 화분 → 그 층 완료 때 1.6초) */
  function canHTML(a, sc, u) {
    const cs = WB.pix(ART.can, sc), big = sc >= 3;
    let h = `<img class="b" alt="" src="${cs.url}" style="left:${a.x + (big ? 6 : 4)}px;top:${a.y - (big ? 66 : 46)}px;width:${cs.w}px;height:${cs.h}px;transform:rotate(-25deg);z-index:12">`;
    for (let i = 0; i < 3; i++) { const k = (u * 2 + i / 3) % 1; h += `<i class="b" style="left:${a.x - 2 + i * (big ? 5 : 4)}px;top:${Math.round(a.y - (big ? 48 : 34) + k * (big ? 16 : 12))}px;width:${big ? 3 : 2}px;height:${big ? 6 : 4}px;background:#5aa8ff;z-index:12"></i>`; }
    return h;
  }
  /* 하트 퐁퐁(t = 시계, 정지면 하나만 가만히) */
  function hearts(t, x, y, sc, seed, still) {
    const hs = WB.pix(ART.heart, sc);
    if (still) return `<img class="b" alt="" src="${hs.url}" style="left:${Math.round(x)}px;top:${Math.round(y - sc * 6)}px;width:${hs.w}px;height:${hs.h}px;z-index:30">`;
    let h = ""; for (let i = 0; i < 3; i++) { const u = (t * .8 + i / 3 + seed) % 1; h += `<img class="b" alt="" src="${hs.url}" style="left:${Math.round(x + (i - 1) * sc * 5 + Math.sin(u * 6 + i) * sc * 2)}px;top:${Math.round(y - u * sc * 12)}px;width:${hs.w}px;height:${hs.h}px;opacity:${(1 - u).toFixed(2)};z-index:30">`; }
    return h;
  }
  /* 소품 칸 하나 그리기 정보(큰 화면 sc 3 · 로비 sc 2): { x, y, w, ht, z, h } */
  function place(id, slot, a, sc, o) {
    const it = itemHTML(id, sc, o), k = KIND[slot], dx = ITEMS[id] && ITEMS[id].dx || 0;   // dx = 그림 칸 단위 가로 비킴(박쥐 가랜드: 직원 이름표 쪽에서 왼쪽으로)
    return { x: Math.round(a.x - it.w / 2 + dx * sc), y: k === "wall" ? a.y : a.y - it.ht, w: it.w, ht: it.ht, z: zOf(id, k), h: it.h };
  }
  const nameOf = (id, en) => ITEMS[id] ? ITEMS[id].n[en ? 1 : 0] : id;
  return { PACK, SDEV, devSeason, packOpen, onSale, seasons, seasonKey, untilOf, ART, CAT, ITEMS, LIKES, SLOTS, KIND, SLOTN, MINI, MSC, VER, DAY, bigAt, load, dump, touch, sweep, plantArt, likeSlot, itemHTML, boxHTML, canHTML, hearts, place, nameOf, hasPlant };
})();

/* ---------- 🎨 큰 화면: HUD [🎨 꾸미기] → 층 탭 → 칸 → 소품 카드(택배로 배달). h = 스튜디오 본체 연결 ---------- */
function decorBig(h) {
  const { ctx, doc, win, mkEl, sty, txt, html, X } = h, D = DECOR, en = () => ctx.lang === "en";
  const nowS = () => Date.now() / 1000, dark = () => !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches);
  let d = D.load(ctx.store.get("decor", ""));
  const save = () => { if (!d.ro) try { ctx.store.set("decor", D.dump(d)); } catch {} };
  const ui = { on: false, p: null, slot: null, hold: null };
  const dl = [], react = new Map(), water = new Map();   // 택배 { p, slot, id, t0 } · 새 소품 반응 프로젝트 → { id, t0 } · 물 주기 프로젝트 → t0
  let G = null, float = null, cap = "";
  const tray = mkEl("div", "dc-tray", h.main); tray.hidden = true;
  const plus = mkEl("div", "dc-plus", h.app, { display: "none" });
  const keyOf = f => f && f.s && f.s.project || "";
  const slotsOf = r => r.meet ? ["W2", "F1"] : D.SLOTS;   // 회의 배치(화이트보드·테이블)에선 벽 2·바닥 1만 보임 — 회의가 끝나면 그대로 돌아옴
  const nm = id => D.nameOf(id, en()), sn = sl => D.SLOTN[sl][en() ? 1 : 0];
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b; };
  const floorN = r => (h.n() + 1 - r.i) + "F";
  const cell = p => d.fl[p] || (d.fl[p] = { s: {}, at: {}, seen: nowS(), wilt: 0 });
  const liked = (an, id) => (D.LIKES[an] || []).includes(id);
  /* 🎃 지금 열린 시즌 팩들의 키 · 판을 열어 본 키(sp = 쉼표로 이은 키 — 옛 저장의 키 하나짜리도 그대로 읽힘) */
  const seaKeys = () => { const t = nowS(); return D.seasons(t).map(pk => ({ pk, k: D.seasonKey(pk, t) })); };
  const seenSet = () => new Set(String(d.sp || "").split(",").filter(Boolean));
  const ownIt = id => !!id && !!D.ITEMS[id];   // 모르는 소품(다운그레이드 · 새 버전 팩) 가드

  /* 상태 → 층마다 touch(창고 복원·시듦) · 오래 안 온 층은 창고로 */
  function read(floors, tc, first) {
    const now = nowS(), live = new Set(floors.map(keyOf).filter(Boolean));
    let ch = false;
    live.forEach(p => { const r = D.touch(d, p, now); if (!r) return; ch = ch || r.ch;
      if (r.back && r.back.length) { r.back.forEach((sl, j) => dl.push({ p, slot: sl, id: d.fl[p].s[sl], t0: tc + j * .25 })); if (!first) { d.last = { p, slot: r.back[0], id: d.fl[p].s[r.back[0]], t: Date.now(), back: 1 }; h.log("📦", X(`창고에서 돌아왔어요 · ${p} 소품 ${r.back.length}개`, `Back from storage · ${r.back.length} item(s) for ${p}`)); } } });
    if (D.sweep(d, now, live)) ch = true;
    if (ui.p && !live.has(ui.p)) { ui.p = null; ui.slot = null; }
    if (ch) save();
  }
  /* POKE 화분(바닥 2 자리)을 비킬 층 · 다시 지을 신호 */
  const f2 = p => !!(d.fl[p] && d.fl[p].s.F2);
  const noPlant = f => !!f && f.layout !== "meet" && f2(keyOf(f));
  const sig = () => Object.keys(d.fl).filter(f2).sort().join(",");

  function build(o) {
    G = { fl: [], boss: null };
    o.FL.forEach((fl, i) => {
      if (i === o.n) { G.boss = mkEl("div", "b dc-dim", fl.F, { left: "0", top: "0", width: "860px", height: "100%", display: "none", zIndex: "58" }); return; }
      const f = fl.f; if (!f) return;
      const r = { i, F: fl.F, B: fl.B, f, p: keyOf(f), meet: f.layout === "meet", el: {}, sl: {}, fishX: 1 };
      D.SLOTS.forEach(sl => { r.el[sl] = mkEl("div", "b dc-it", fl.F, { display: "none" }); });
      r.fx = mkEl("div", "b dc-fx", fl.F, { left: "0", top: "0", zIndex: "41" });
      r.dim = mkEl("div", "b dc-dim", fl.F, { left: "0", top: "0", width: "860px", height: "100%", display: "none", zIndex: "58" }); r.dim.dataset.act = "dc-tab"; r.dim.dataset.p = r.p;
      slotsOf(r).forEach(sl => {
        const a = D.bigAt(sl, fl.B), k = D.KIND[sl], w = k === "wall" ? 56 : k === "desk" ? 50 : 70, hh = k === "wall" ? 56 : k === "desk" ? 44 : 50;
        const e = r.sl[sl] = mkEl("div", "b dc-slot", fl.F, { left: (a.x - w / 2) + "px", top: (k === "wall" ? a.y - 4 : a.y - hh) + "px", width: w + "px", height: hh + "px", display: "none" });
        e.dataset.act = "dc-slot"; e.dataset.slot = sl; e.dataset.p = r.p;
      });
      G.fl.push(r);
    });
  }

  /* 직원이 쉴(idle) 때 갈 자리: 좋아하는 소품 옆(러그면 그 위) */
  function restX(f) {
    if (!f || f.layout === "meet" || ui.on) return null;
    const F = d.fl[keyOf(f)], sl = D.likeSlot(F, f.animal); if (!sl) return null;
    const a = D.bigAt(sl, 0), id = F.s[sl];
    return sl === "D1" ? 268 : D.KIND[sl] === "wall" ? a.x : id === "rug" ? a.x : a.x + (sl === "F2" ? -46 : 46);
  }
  /* 새 소품 반응(소품이 나온 뒤 2.3초): 좋아하면 만세 + "러그다! ♥", 아니면 "오~ 새거다" */
  function pose(f, a, tc, anim, ph) {
    const R = react.get(keyOf(f)); if (!R) return null;
    const u = tc - R.t0; if (u > 3.4) { react.delete(keyOf(f)); return null; } if (u < 1.1 || a.moving || a.loc !== "home") return null;
    const lk = liked(f.animal, R.id), n = nm(R.id);
    return { p: { view: "front", seated: 1, arms: lk ? "u" : "", mouth: "o", eyes: "o" }, dy: lk && anim ? -Math.round(ph.hop * 3) * 4 : 0,
      say: lk ? X(`${n}${josa(n, "이다", "다")}! ♥`, `A ${n.toLowerCase()}! ♥`) : ownIt(R.id) && D.ITEMS[R.id].hi && D.onSale(R.id, nowS()) ? D.ITEMS[R.id].hi[en() ? 1 : 0] : R.id === "tank" ? X("오, 물고기! 🐟", "Ooh, fish! 🐟") : X("오~ 새거다", "Ooh, something new") };
  }
  /* 완료 보상 → 자금 옆 +n · 시든 화분이면 물 주기(완료 배너 4.5초가 걷힌 뒤 1.6초, 그때까지 시든 채) */
  const WATER_AT = 4.6;
  function earn(f, amt, tc) {
    float = { amt, t0: tc };
    const p = keyOf(f), F = d.fl[p];
    if (F && F.wilt) { F.wilt = 0; if (!D.hasPlant(F)) { save(); return; }   // 시든 화분을 되팔거나 옮긴 층: 플래그만 정리(물 줄 화분이 없음)
      F.wat = nowS() + WATER_AT; water.set(p, tc + WATER_AT); save(); h.log("💧", X(`${p} 화분에 물 줬어요`, `Watered the plant at ${p}`)); }
  }

  function frame(T, tc, anim) {
    if (!G) return;
    const dk = dark(), now = nowS(), date = new Date(), still = !anim;
    G.fl.forEach(r => {
      const F = d.fl[r.p], s = F ? F.s : {}, vis = slotsOf(r), a = h.actors.get(r.f.sid), ax = a && a.x != null ? a.x : 385;
      D.SLOTS.forEach(sl => {
        const e = r.el[sl], id = vis.includes(sl) ? s[sl] : null, del = anim && id ? dl.find(x => x.p === r.p && x.slot === sl) : null, u = del ? tc - del.t0 : 9;
        if (!id || !D.ITEMS[id] || u < 1.1) { sty(e, "display", "none"); return; }
        const at = D.bigAt(sl, r.B), tgt = ax < at.x ? .1 : .85;
        if (id === "tank") r.fishX = anim ? lerp(r.fishX, tgt, .05) : tgt;
        const it = D.place(id, sl, at, 3, { t: T, anim, fishX: r.fishX + (anim ? .06 * Math.sin(T * 1.7) : 0), fishDir: tgt < .5 ? -1 : 1, dark: dk, prov: r.f.pk, plant: id === "plant" ? (water.has(r.p) && tc < water.get(r.p) + 1.1 ? "wilt" : D.plantArt(F, sl, now)) : null, now: date });
        sty(e, "display", "block"); sty(e, "left", it.x + "px"); sty(e, "top", it.y + "px"); sty(e, "width", it.w + "px"); sty(e, "height", it.ht + "px"); sty(e, "zIndex", String(it.z));
        const pop = u < 1.35 ? ease((u - 1.1) / .25) : 1; sty(e, "transform", pop < 1 ? `scale(${pop.toFixed(2)})` : "");
        html(e, it.h);
      });
      let fx = "";
      if (anim) dl.forEach(x => { const u = tc - x.t0; if (x.p === r.p && u >= 0 && u < 1.4 && vis.includes(x.slot)) fx += D.boxHTML(D.bigAt(x.slot, r.B), D.KIND[x.slot], 3, u); });
      const w = water.get(r.p), psl = vis.find(sl => s[sl] === "plant");
      if (w != null && anim && psl && tc >= w && tc - w < 1.6) fx += D.canHTML(D.bigAt(psl, r.B), 3, tc - w);
      if (w != null && tc - w > 2) water.delete(r.p);
      /* 하트: 새 소품이 좋아하는 거면(반응 중) · 좋아하는 소품 옆에서 쉴 때 · 일하다 가끔(45초에 한 번 1.5초) */
      if (a && a.par === r.F && !a.moving && a.loc === "home") {
        const R = react.get(r.p), lk = D.likeSlot(F, r.f.animal);
        if (R && liked(r.f.animal, R.id) && tc - R.t0 >= 1.1 && tc - R.t0 < 3.4) fx += D.hearts(T, ax + 60, r.B - 60, 3, .2, still);
        else if (lk && a.restX != null && a.x === a.restX) fx += D.hearts(T, ax + 34, r.B - 72, 2, 0, still);
        else if (lk && anim && ((tc + (fnv(r.f.sid) % 45)) % 45) < 1.5) fx += D.hearts(T, ax + 40, r.B - 104, 2, .5, false);
      }
      html(r.fx, fx);
      /* 꾸미기: 고른 층만 칸 표시, 다른 층은 어둡게(누르면 그 층으로) */
      const sel = ui.on && ui.p === r.p;
      sty(r.dim, "display", ui.on && ui.p && !sel ? "block" : "none");
      Object.keys(r.sl).forEach(sl => {
        const e = r.sl[sl], on = sel, cur = on && ui.slot === sl, hold = ui.hold && D.KIND[ui.hold.slot] === D.KIND[sl] && !(ui.hold.p === r.p && ui.hold.slot === sl);
        sty(e, "display", on ? "flex" : "none"); if (!on) return;
        const c = "b dc-slot" + (s[sl] ? " full" : "") + (cur ? " cur" : "") + (cur && anim && Math.floor(T * 4) % 2 ? " blk" : "") + (hold ? " drop" : "") + (ui.hold && !hold && !(ui.hold.p === r.p && ui.hold.slot === sl) ? " off" : "");
        if (e.className !== c) e.className = c;
        txt(e, s[sl] ? "" : "+ " + sn(sl));
      });
    });
    if (G.boss) sty(G.boss, "display", ui.on && ui.p ? "block" : "none");
    while (dl.length && tc - dl[0].t0 > 3) dl.shift();
    /* 자금 옆 숫자: 살 때 −(빨강, 아래로) · 벌 때 +(금색, 위로) */
    const fu = float ? tc - float.t0 : 9;
    if (float && anim && fu < 1.6 && h.money()) {
      const mr = h.money().getBoundingClientRect(), ar = h.app.getBoundingClientRect();
      sty(plus, "display", "block"); txt(plus, `💰 ${float.amt < 0 ? "−" : "+"}${Math.abs(float.amt)}`); sty(plus, "color", float.amt < 0 ? "#ff6b6b" : "#ffd23f");
      sty(plus, "left", Math.round(mr.right - ar.left + 6) + "px"); sty(plus, "top", Math.round(mr.top - ar.top + 6 + (float.amt < 0 ? fu * 10 : -fu * 10)) + "px");
    } else { sty(plus, "display", "none"); if (fu >= 1.6) float = null; }
  }

  /* ---------- 꾸미기 판(트레이) ---------- */
  function floorsUI() {   // 층 탭: 프로젝트마다 하나(위층부터)
    const M = h.model(), seen = new Set(), out = [];
    M.floors.forEach((f, i) => { const p = keyOf(f); if (!p || seen.has(p)) return; seen.add(p); out.push({ p, f, i }); });
    return out;
  }
  function card(id, F, an) {
    const it = D.ITEMS[id], lv = h.lv(), funds = h.funds(), here = F && F.s[ui.slot] === id, full = F && F.s[ui.slot] && !here;
    const lock = lv < it.lv, poor = funds < it.p && !here, like = liked(an, id), ih = D.itemHTML(id, id === "rug" || id === "snack" ? 2 : 3, { t: 0, fishX: .5, prov: "claude", plant: id === "plant" ? "plant3" : null });
    const k = Math.min(1, 64 / ih.ht, 92 / ih.w), other = F ? D.SLOTS.filter(sl => sl !== ui.slot && F.s[sl] === id) : [];
    const cls = "dc-card" + (here ? " here" : lock ? " lock" : full ? " dis" : poor ? " poor" : "") + (D.PACK[it.pack].win ? " sea" : "");
    const capT = here ? X(`${it.n[0]} · 이 칸에 놓여 있어요 · 옮기기는 무료, 되팔면 💰${Math.floor(it.p / 2)}`, `${it.n[1]} · placed here · moving is free, sell for 💰${Math.floor(it.p / 2)}`)
      : lock ? X(`🔒 스튜디오 Lv.${it.lv}에 열려요 (지금 Lv.${lv})`, `🔒 Unlocks at studio Lv.${it.lv} (now Lv.${lv})`)
      : full ? X("칸이 차 있어요 · 지금 소품을 옮기거나 되팔면 새로 둘 수 있어요", "This spot is taken · move or sell the current item first")
      : poor ? X(`💰 ${it.p - funds} 모자라요 · 완료하면 +25, 큰 일 +75`, `💰 ${it.p - funds} short · +25 per done, +75 for a big one`)
      : X(`💰${it.p}에 사서 ${sn(ui.slot)} 칸에 둬요 · 택배로 와요${like ? ` · ${EMO[an]} 좋아해요 ♥` : ""}`, `Buy for 💰${it.p} and place on ${sn(ui.slot)} · comes by delivery${like ? ` · ${EMO[an]} loves it ♥` : ""}`);
    return `<button type="button" class="${cls}" data-act="dc-buy" data-id="${id}" data-dcap="${esc(capT)}"${here || lock || full || poor ? ` aria-disabled="true"` : ""}>
      <span class="art" style="width:${ih.w}px;height:${ih.ht}px;transform:translateX(-50%) scale(${k.toFixed(3)})">${ih.h}</span>
      ${it.ltd ? `<span class="note ltd">${X("✨ 한정판", "✨ Limited")}</span>` : it.note ? `<span class="note">${esc(it.note[en() ? 1 : 0])}</span>` : ""}${like ? `<span class="like">♥ ${esc(h.aName(an))}</span>` : ""}
      <span class="ft"><span>${esc(it.n[en() ? 1 : 0])}${other.length ? ` <em>✓${esc(sn(other[0]))}</em>` : ""}</span><b>${here ? "✓ " + X("놓음", "Placed") : lock ? "Lv." + it.lv : "💰" + it.p}</b></span></button>`;
  }
  function renderTray() {
    tray.hidden = !ui.on; if (!ui.on) return;
    const fs = floorsUI(), cur = fs.find(x => x.p === ui.p), hide = h.hideText(), funds = h.funds();
    const chips = fs.map(x => `<button type="button" class="dc-chip${x.p === ui.p ? " on" : ""}" data-act="dc-tab" data-p="${esc(x.p)}" data-dcap="${esc(X(`${floorN({ i: x.i })} ${hide ? "🤫" : x.p} 층 꾸미기 · 꾸밈은 프로젝트에 붙어 있어요`, `Decorate ${floorN({ i: x.i })} ${hide ? "🤫" : x.p} · decor stays with the project`))}">${EMO[x.f.animal]} ${floorN({ i: x.i })} ${esc(hide ? "🤫" : cut(x.p, 14))}</button>`).join("");
    const whN = Object.keys(d.wh).length;
    let body;
    if (!cur) body = `<div class="msg">👆 ${X("꾸밀 층을 골라요 · 층 꾸밈은 <b>프로젝트</b>에 붙어서 세션이 새로 열려도 그대로예요", "Pick a floor · decor sticks to the <b>project</b>, so it stays when a new session opens")}${whN ? ` · 📦 ${X(`창고에 ${whN}층 보관 중(7일 넘게 안 온 프로젝트, 다시 오면 복원)`, `${whN} floor(s) in storage (back when the project returns)`)}` : ""}</div>`;
    else if (!ui.slot) { const an = cur.f.animal, L = D.LIKES[an] || [];
      body = `<div class="msg">👆 ${X(`${floorN({ i: cur.i })} ${h.aName(an)} 층의 칸(벽 2 · 책상 1 · 바닥 2)을 눌러요`, `Click a spot on ${floorN({ i: cur.i })} (2 wall · 1 desk · 2 floor)`)} · ${EMO[an]} ${X("좋아하는 것", "Likes")}: ${L.map(id => esc(nm(id))).join(", ")}${cur.f.layout === "meet" ? " · " + X("회의 중엔 벽 2·바닥 1만 보여요", "During a meeting only wall 2 · floor 1 show") : ""}</div>`; }
    else {
      const F = d.fl[ui.p], kind = D.KIND[ui.slot], an = cur.f.animal, have = F && F.s[ui.slot];
      /* 팩 순서대로: 기본 → 시즌 팩(기간 안이면 🎃 머리표 + 카드, 기간 밖이면 이 칸에 놓인 것만 — 되팔기·옮기기용) */
      const now = nowS();
      body = `<div class="cards">` + D.CAT.packs.map(pk => { const ids = pk.items.filter(it => it.slot === kind && (D.packOpen(pk, now) || have === it.id)).map(it => it.id); if (!ids.length) return "";
        const on = D.packOpen(pk, now), head = pk.win ? `<span class="dc-sec${on ? "" : " past"}" data-dcap="${esc(on ? X(`${pk.n[0]} 시즌 소품 · ${D.untilOf(pk)}까지만 살 수 있어요 · 산 소품은 시즌이 끝나도 그대로예요`, `${pk.n[1]} items · on sale until ${D.untilOf(pk)} · what you buy stays after the season`) : X("지난 시즌 소품 · 옮기기·되팔기는 그대로 돼요", "Past-season item · you can still move or sell it"))}"><b>${pk.e || "🎁"}</b>${esc(pk.n[en() ? 1 : 0])}<em>${on ? X(`${D.untilOf(pk)}까지`, `until ${D.untilOf(pk)}`) : X("시즌 끝", "Season over")}</em></span>` : "";
        return head + ids.map(id => card(id, F, an)).join(""); }).join("")
        /* ❔ 이 버전이 모르는 소품(새 버전에서 산 시즌 팩 등 — 다운그레이드): 저장은 그대로 두고 카드만 보여 줌 · 되팔기 없음(값을 모름) · 옮기기는 같은 종류 칸끼리라 안전 */
        + (have && !ownIt(have) ? `<button type="button" class="dc-card here unk" aria-disabled="true" data-dcap="${esc(X("새 버전에서 산 소품이에요 · 이 버전에선 보이지 않지만 저장은 그대로라 앱을 다시 올리면 돌아와요 · 옮기기만 돼요", "Item from a newer version · hidden here but kept, it comes back when you update · move only"))}"><span class="art unk">❔</span><span class="ft"><span>${X("새 버전 소품", "Newer item")}</span><b>✓ ${X("놓음", "Placed")}</b></span></button>` : "") + `</div>`;
      const hv = ownIt(have) ? D.ITEMS[have] : null, back = hv ? Math.floor(hv.p / 2) : 0;
      if (have && !ui.hold) body = body.replace(/<\/div>$/, `<div class="acts"><button type="button" class="dc-btn" data-act="dc-move" data-dcap="${esc(X("다른 칸(같은 종류 · 다른 층도)으로 옮겨요 · 무료", "Move to another spot of the same kind (any floor) · free"))}">↔ ${X("옮기기", "Move")}</button>${hv ? `<button type="button" class="dc-btn sell" data-act="dc-sell" data-dcap="${esc(X(`되팔면 산 값의 반 💰${back}을 돌려받아요`, `Sell back for half: 💰${back}`))}">💰 ${X("되팔기", "Sell")} +${back}</button>` : ""}</div></div>`);
    }
    const holdT = ui.hold ? `<span class="hold">↔ ${esc(nm(ui.hold.id))} · ${X("옮길 칸을 눌러요", "click where to put it")} <button type="button" class="dc-btn" data-act="dc-cancel">${X("취소", "Cancel")}</button></span>` : "";
    html(tray, `<div class="hd"><b class="ti">🎨 ${X("꾸미기", "Decorate")}</b>${chips}<span class="sp"></span>${D.seasons(nowS()).map(pk => `<span class="sea" data-dcap="${esc(X(`${pk.n[0]} 시즌 소품을 ${D.untilOf(pk)}까지 팔아요 · 칸을 누르면 보여요`, `${pk.n[1]} items on sale until ${D.untilOf(pk)} · pick a spot to see them`))}">${pk.e || "🎁"} ${X(`${D.untilOf(pk)}까지`, `until ${D.untilOf(pk)}`)}</span>`).join("")}${holdT}${cur && ui.slot && !ui.hold ? `<span class="where">${floorN({ i: cur.i })} · ${esc(sn(ui.slot))} ${X("칸", "")}</span>` : ""}<span class="fund">💰 ${funds.toLocaleString("en-US")}</span><button type="button" class="dc-btn ok" data-act="dc-done">✓ ${X("완료", "Done")}</button></div><div class="bd">${body}</div><div class="dc-cap"></div>`);
    txt(tray.querySelector(".dc-cap"), cap || X("옮기기 무료 · 되팔기 50% · 7일 넘게 안 온 프로젝트의 소품은 창고로 갔다가 다시 오면 돌아와요", "Moving is free · selling returns 50% · items of projects unseen for 7 days go to storage and come back with the project"));
  }
  ctx.listen(tray, "mouseover", e => { const c = e.target.closest ? e.target.closest("[data-dcap]") : null, v = c ? c.dataset.dcap : ""; if (v !== cap) { cap = v; const ce = tray.querySelector(".dc-cap"); if (ce) txt(ce, cap || X("옮기기 무료 · 되팔기 50% · 7일 넘게 안 온 프로젝트의 소품은 창고로 갔다가 다시 오면 돌아와요", "Moving is free · selling returns 50% · items of projects unseen for 7 days go to storage and come back with the project")); } });
  ctx.listen(tray, "mouseleave", () => { if (cap) { cap = ""; renderTray(); } });

  function set(on) {
    if (ui.on === !!on) return;
    ui.on = !!on; ui.slot = null; ui.hold = null; cap = "";
    if (on && !ui.p) { const fs = floorsUI(); if (fs.length === 1) ui.p = fs[0].p; }
    if (on && !D.devSeason()) { const ks = seaKeys().map(x => x.k), sp = ks.join(","); if (ks.length && ks.some(k => !seenSet().has(k))) { d.sp = sp; save(); } }   // 🎃 이번 시즌 판을 열어 봄 → 버튼 점 거둠(개발용 ?season= 쿼리면 저장 안 함)
    h.app.classList.toggle("dc-on", ui.on);
    renderTray(); h.layout(); h.kick(); h.hud();
  }
  function deliver(p, slot, id, tc) { dl.push({ p, slot, id, t0: tc }); react.set(p, { id, t0: tc }); d.last = { p, slot, id, t: Date.now() }; }
  function tap(act, b) {
    const tc = h.clockT();
    if (act === "dc-toggle") return set(!ui.on);
    if (!ui.on) return;
    if (act === "dc-done") return set(false);
    if (act === "dc-tab") { if (ui.p !== b.dataset.p) { ui.p = b.dataset.p; ui.slot = null; } }
    else if (act === "dc-slot") {
      const p = b.dataset.p, sl = b.dataset.slot;
      if (ui.hold) {   // 옮기기: 같은 종류 칸이면 놓기(차 있으면 맞바꿈)
        const H = ui.hold;
        if (D.KIND[sl] === D.KIND[H.slot] && !(H.p === p && H.slot === sl)) {
          const A = cell(H.p), Bc = cell(p), other = Bc.s[sl], oat = Bc.at[sl];
          Bc.s[sl] = H.id; Bc.at[sl] = A.at[H.slot] || nowS();
          if (other) { A.s[H.slot] = other; A.at[H.slot] = oat || nowS(); } else { delete A.s[H.slot]; delete A.at[H.slot]; }
          if (H.id === "plant") Bc.wilt = A.wilt && H.p === p ? A.wilt : 0;
          deliver(p, sl, H.id, tc); react.delete(p); save();
          h.log("↔", X(`${nm(H.id)} 옮김 → ${p} ${sn(sl)}`, `Moved ${nm(H.id)} → ${p} ${sn(sl)}`));
          if (sl === "F2" || H.slot === "F2") h.rebuild();
          ui.hold = null; ui.p = p; ui.slot = sl;
        }
      } else { ui.p = p; ui.slot = sl; }
    }
    else if (act === "dc-buy") {
      const id = b.dataset.id, it = D.ITEMS[id], p = ui.p, sl = ui.slot;
      if (!it || !p || !sl || D.KIND[sl] !== it.slot || !D.onSale(id, nowS())) return renderTray();   // 🎃 시즌이 끝난 팩은 못 삼(판을 열어 둔 채 기간이 지나도)
      const F = cell(p);
      if (F.s[sl] || h.lv() < it.lv || h.funds() < it.p) return renderTray();
      h.spend(it.p); F.s[sl] = id; F.at[sl] = nowS(); if (id === "plant") F.wilt = 0;
      deliver(p, sl, id, tc); float = { amt: -it.p, t0: tc }; save(); h.saveNow();
      const f = h.model().floors.find(x => keyOf(x) === p), lk = f && liked(f.animal, id);
      h.log("📦", X(`${nm(id)} 샀어요 · ${p} ${sn(sl)} −${it.p}${lk ? ` · ${h.aName(f.animal)}${josa(h.aName(f.animal), "이", "가")} 좋아해요 ♥` : ""}`, `Bought ${nm(id)} for ${p} ${sn(sl)} −${it.p}${lk ? ` · ${h.aName(f.animal)} loves it ♥` : ""}`));
      if (sl === "F2") h.rebuild();
    }
    else if (act === "dc-sell") {
      const F = d.fl[ui.p], id = F && F.s[ui.slot]; if (!id || !ownIt(id)) return renderTray();   // ❔ 모르는 소품은 되팔지 않음(지우면 새 버전에서 잃음)
      const back = Math.floor(D.ITEMS[id].p / 2);
      delete F.s[ui.slot]; delete F.at[ui.slot]; h.spend(-back); float = { amt: back, t0: tc }; save(); h.saveNow();
      h.log("💰", X(`${nm(id)} 되팔기 +${back}`, `Sold ${nm(id)} +${back}`));
      if (ui.slot === "F2") h.rebuild();
    }
    else if (act === "dc-move") { const F = d.fl[ui.p], id = F && F.s[ui.slot]; if (id) ui.hold = { p: ui.p, slot: ui.slot, id }; }
    else if (act === "dc-cancel") ui.hold = null;
    renderTray(); h.kick(); h.hud();
  }
  return {
    read, build, frame, restX, pose, earn, tap, noPlant, sig, set,
    restSay: f => { const F = d.fl[keyOf(f)], sl = D.likeSlot(F, f.animal), id = sl && F.s[sl]; return !id ? "" : id === "rug" ? X("러그 위가 최고 ♥", "Best spot: the rug ♥") : X(`${nm(id)} 옆이 최고 ♥`, `Love this ${nm(id).toLowerCase()} ♥`); },
    on: () => ui.on, tray: renderTray,
    trayH: () => ui.on ? tray.offsetHeight + 8 : 0,
    size: w => sty(tray, "width", Math.max(240, w) + "px"),
    key: e => { if (!ui.on || e.key !== "Escape") return false; if (ui.hold) { ui.hold = null; renderTray(); } else set(false); return true; },
    hudBtn: b => { const seen = seenSet(), nw = ui.on ? null : seaKeys().find(x => !seen.has(x.k)), pk = nw && nw.pk;   // 🎃 열린 시즌 중 아직 판을 안 열어 본 게 있으면 작은 점
      html(b, "🎨 " + X("꾸미기", "Decorate") + (pk ? `<span class="dc-new" aria-hidden="true">${pk.e || "🎁"}</span>` : ""));
      const lab = pk ? X(`꾸미기 · ${pk.n[0]} 시즌 소품이 왔어요 (${D.untilOf(pk)}까지)`, `Decorate · ${pk.n[1]} items are here (until ${D.untilOf(pk)})`) : "";
      if (b.title !== lab) { b.title = lab; if (lab) b.setAttribute("aria-label", lab); else b.removeAttribute("aria-label"); }
      b.classList.toggle("on", ui.on); },
  };
}

/* ---------- 🎨 미니 보기: 그 층 소품을 같은 칸 위치(작은 방)에 그림 · 택배 도착 자막(카메라가 그 층으로) · 물 주기 · 좋아하는 소품 옆에서 쉬기. 저장은 읽기만 ---------- */
function decorMini(h) {
  const { ctx, X } = h, D = DECOR, en = () => ctx.lang === "en";
  let raw = null, d = D.load(""), lastT = null, first = true;
  const evq = [], recent = [];   // 카메라가 담을 택배 · 그리는 중인 택배(상자 낙하)
  function read(tc) {
    const r = ctx.store.get("decor", "") || "";
    if (r === raw) return false;
    raw = r; d = D.load(r);
    const L = d.last;
    if (L && L.t !== lastT) { if (!first && Date.now() - L.t < 20000) { const e = Object.assign({}, L, { t0: tc }); evq.push(e); recent.push(e); if (evq.length > 3) evq.shift(); } lastT = L.t; }
    first = false;
    return true;
  }
  const keyOf = f => f && f.project || "";
  const sig = () => Object.keys(d.fl).filter(p => d.fl[p].s.F2).sort().join(",");
  const noPlant = f => !!(d.fl[keyOf(f)] && d.fl[keyOf(f)].s.F2);
  function room(R) { const p = R.p; R.dc = { el: {}, fx: h.mk("div", "b", p, { left: "0", top: "0", zIndex: "40", pointerEvents: "none" }), fishX: 1 }; D.SLOTS.forEach(sl => { R.dc.el[sl] = h.mk("div", "b", p, { display: "none", pointerEvents: "none" }); }); }
  /* 쉴 자리(좋아하는 소품 앞) */
  function restX(f) { const F = d.fl[keyOf(f)], sl = D.likeSlot(F, f.animal); return sl ? ({ D1: 30, W1: 69, W2: 200 })[sl] || D.MINI[sl].x : null; }
  function draw(R, f, T, tc, anim, ax, resting) {
    const F = d.fl[keyOf(f)], s = F ? F.s : {}, now = Date.now() / 1000, dk = !!(h.win.matchMedia && h.win.matchMedia("(prefers-color-scheme: dark)").matches), still = !anim;
    while (recent.length && tc - recent[0].t0 > 3) recent.shift();
    D.SLOTS.forEach(sl => {
      const e = R.dc.el[sl], id = s[sl], del = anim && id ? recent.find(x => x.p === keyOf(f) && x.slot === sl) : null, u = del ? tc - del.t0 : 9;
      if (!id || !D.ITEMS[id] || u < 1.1) { h.sty(e, "display", "none"); return; }
      const a = D.MINI[sl], tgt = ax < a.x ? .1 : .85;
      if (id === "tank") R.dc.fishX = anim ? lerp(R.dc.fishX, tgt, .08) : tgt;
      const it = D.place(id, sl, a, D.MSC[id] || 2, { t: T, anim, fishX: R.dc.fishX, fishDir: tgt < .5 ? -1 : 1, dark: dk, prov: f.pk, plant: id === "plant" ? (F.wat && now < F.wat + 1.1 && now > F.wat - 6 ? "wilt" : D.plantArt(F, sl, now)) : null });
      h.sty(e, "display", "block"); h.sty(e, "left", it.x + "px"); h.sty(e, "top", it.y + "px"); h.sty(e, "width", it.w + "px"); h.sty(e, "height", it.ht + "px"); h.sty(e, "zIndex", String(D.KIND[sl] === "floor" ? 6 : it.z));   // 로비: 바닥 소품(러그도)은 책장 앞 · 직원(8) 뒤
      const pop = u < 1.35 ? ease((u - 1.1) / .25) : 1; h.sty(e, "transform", pop < 1 ? `scale(${pop.toFixed(2)})` : ""); h.sty(e, "transformOrigin", "50% 100%");
      h.html(e, it.h);
    });
    let fx = "";
    if (anim) recent.forEach(x => { const u = tc - x.t0; if (x.p === keyOf(f) && u < 1.4) fx += D.boxHTML(D.MINI[x.slot], D.KIND[x.slot], 2, u); });
    const psl = D.SLOTS.find(sl => s[sl] === "plant");
    if (anim && psl && F.wat && now >= F.wat && now - F.wat < 1.6) fx += D.canHTML(D.MINI[psl], 2, now - F.wat);
    if (resting) fx += D.hearts(T, ax + 9, 72, 1, 0, still);
    else if (D.likeSlot(F, f.animal) && anim && f.kind !== "idle") { const L = recent.find(x => x.p === keyOf(f) && (D.LIKES[f.animal] || []).includes(x.id) && tc - x.t0 >= 1.1); if (L && tc - L.t0 < 3.4) fx += D.hearts(T, ax, 66, 1, .2, false); }
    h.html(R.dc.fx, fx);
  }
  /* 택배 자막 */
  function sub(e, fl) {
    const n = D.nameOf(e.id, en()), an = fl && fl.animal, nmA = an ? h.aName(an) : "";
    if (e.back) return X(`📦 창고에서 돌아왔어요 · ${fl ? fl.floor + "F " : ""}${h.hide() ? "🤫" : cut(e.p, 14)}`, `📦 Back from storage · ${fl ? fl.floor + "F " : ""}${h.hide() ? "🤫" : cut(e.p, 14)}`);
    if (an && (D.LIKES[an] || []).includes(e.id)) return X(`📦 택배 도착! ${n} · ${EMO[an]} ${nmA}${h.josa(nmA, "이", "가")} 좋아해요 ♥`, `📦 Delivery! ${n} · ${EMO[an]} ${nmA} loves it ♥`);
    if (e.id === "tank" && an) return X(`📦 어항 도착 · 물고기가 ${nmA}${h.josa(nmA, "을", "를")} 따라 헤엄쳐요`, `📦 Fish tank · the fish follows ${nmA}`);
    if (e.id === "poster" && fl) return X(`📦 포스터 도착 · ${fl.pname} 색 테마`, `📦 Poster · ${fl.pname} colors`);
    if (e.id === "plant") return X("📦 화분 도착 · 날마다 자라요 🌱", "📦 Plant · grows every day 🌱");
    const it = D.ITEMS[e.id]; if (it && it.hi && D.PACK[it.pack].win && D.onSale(e.id, Date.now() / 1000)) return X(`📦 ${n} 도착 · ${D.PACK[it.pack].e || ""} ${it.hi[0]}`, `📦 ${n} arrived · ${D.PACK[it.pack].e || ""} ${it.hi[1]}`);
    return X(`📦 ${n} 도착 · ${fl ? fl.floor + "F " + nmA : ""}`, `📦 ${n} arrived · ${fl ? fl.floor + "F " + nmA : ""}`);
  }
  return { read, sig, noPlant, room, restX, draw, sub, keyOf, take: () => evq.shift() || null, peek: () => evq[0] || null };
}

/* ================= ☕ 깨알 디테일 (TINY: 큰 화면 tinyBig만 · 미니 보기는 아직 없음. 본체에는 연결 줄만, #37) =================
   - ⏱️ 출근 기준: session.started·tools는 턴(프롬프트)마다 다시 시작하므로, 세션(sid)을 처음 본 시각(t0)과 누적 도구 수를 따로 기억(아래 저장 s).
     새벽 4시가 지나면 t0는 그날 처음 본 시각으로 다시 · 도구 수가 줄면(새 턴) 지난 턴 값을 누적에 더함
   - ☕ 빈 커피잔: 책상 배치 층에서 일하는 중(work·agents·ask·stall)이면 출근(t0)부터 20분마다 책상에 빈 잔 하나(최대 4).
     모니터 아래·직원과 모니터 사이에만 둠(🎨 책상 칸 · 👆 머그 · 작업 표지판 · 직원과 안 겹침). 세션이 사라지면 층과 같이 사라짐(저장 없음)
   - 📅 연속 출근 달력: 프로젝트(session.project)마다 최근 14일 중 "일한 날"을 ctx.store "tiny"에 저장(하루 = 새벽 4시 경계, 퇴근 일보와 같음).
     그 층 세션이 보이면 오늘을 기록 · 오늘로 끝나는 연속 2일 이상이면 왼쪽 창과 🎨 벽 1 사이 벽에 "🔥3" 달력.
     저장 = { v: 1, d: { 프로젝트: ["YYYY-MM-DD", …] }, s: { sid: { t0, acc, last, seen, day } } } · 큰 화면만 씀(상태가 올 때 바뀐 것만) · 모르는 새 버전(v > 1)이면 읽기만.
     s(#38)는 v 1에 더한 필드 — 없으면 빈 맵. 이틀 넘게 안 본 sid는 지우고 최대 100개
   - 🔦 야간 경비 고양이: 22:00~05:59에 1층(사장실) 바닥을 3~4분마다 한 번(약 12초) 손전등을 비추며 지나감. 사장님 책상 뒤 · 바닥 위(z 8), 고양이만 누를 수 있음.
     걷는 동안은 누를 수 없음(👆 사장님 자리를 가로채지 않게). 회의 모드·움직임 줄이기면 걷지 않고 화분과 현관문 사이에 작게 서서 문 쪽을 비춤 — 이때만 누르면 "순찰 중이에요 🔦".
     질문 말풍선이 1층을 덮는 동안 서 있는 고양이는 숨김 · 🙈 눈치 모드 동안은 잔·달력·고양이 모두 숨김
   - 🗂️ 책상 묶음(#38, 책상 배치 층만 · 저장 없음):
     📚 서류 더미 — session.ctx 80%↑면 책상 오른쪽 바닥에 서류 묶음(80 = 2 · 85 = 3 · 90↑ = 4 + 기울어 흔들흔들). title "컨텍스트 87%"
     🧥 겉옷 — 출근(t0) 뒤 1시간 넘게 일하면 의자 등받이 왼쪽에 겉옷(동물마다 색 하나). 앉아 있으면 소매만, 자리를 비우면 다 보임
     🎉 도구 깃발 — 누적 도구 수(지난 턴 + session.tools) 100 · 500 · 1000↑이면 모니터 위에 작은 깃발(100 · 500 · 1K 글자 + 단계 색). 보는 중에 처음 넘으면 톡 솟음
     🔋 로봇 배터리 — 직원이 로봇(bot)이고 자기 자리에 보일 때만(멈춤 의심·📋 일보 연출 중엔 없음) 머리 오른쪽(이름표 아래)에 4칸, 출근 뒤 1시간마다 1칸↓. 0칸이면 ⚡ + 바닥 콘센트까지 충전 케이블
   - 🤸 직원 몸짓 묶음(#38, placeActor가 놓은 뒤 덮어씀 · 👆 반응은 그다음 · 📋 일보 연출·🙈 눈치 모드엔 쉼):
     🦶 질문하러 엘리베이터를 기다리거나 1층 사장님 앞에 선 직원 — 그 자리에 온 뒤 1분↑ 발 동동(빠른 발 프레임 + 콩콩) · 3분↑ 주저앉고 💦(자기 층 순서 대기는 발 동동만). 답이 오면 바로 원래대로
     🐙 문어 직원이 타자 칠 때 손 대신 다리 끝 3개(빨판)가 번갈아 톡톡 — 손이 보일 때만(쉬거나 자리 비우면 없음)
     🥱 월요일(새벽 4시 기준) 출근(t0) 뒤 10분 동안 40초마다 한 번 하품(눈 감고 입 벌려 손으로 가림 + "하암~"). 앉아서 평소 자세일 때만 · 움직임 줄이기면 없음
     🌺 금요일 17:00~토요일 04:00 직원 몸통이 꽃무늬 하와이안 셔츠(펭귄·문어는 꽃 목걸이) + 귀 옆 히비스커스(앉으면 몸통이 책상에 가려서).
       큰 화면 setP 배우만(일보 연출 직원·아기 포함) — 사장님·도감·미니 보기·일보 카드 이미지는 그대로
   - 🏢 건물 묶음(#38):
     🐦 창틀 비둘기 — 4분마다 한 번(35초) 하늘을 날던 비둘기 하나가 어느 직원 층 오른쪽 창 위 창틀에 앉아 고개 까딱. 정전·밤엔 안 앉음.
       창 👆 누를 자리(창 안쪽) 바로 위라 겹치지 않음 · 앉아 있을 때만 누를 수 있고 누르면 파닥 날아감(다른 클릭 처리로 안 넘어감)
     ☂️ 우산 꽂이 — 1층 커피머신 자리와 현관문 사이. 날씨(주간 한도)가 비·눈이면 사장님 우산 + 직원 층 수만큼(최대 5, 동물마다 색·손잡이 높이), 아니면 사장님 우산 하나
     🛗 엘리베이터 점검 — 하루 1~2번 10분(10~18시 중 날짜 해시로 정해짐) 카 문에 "🔧 점검 중". 기다리는 직원은 계단 쪽으로 가려다 돌아오는 척만(실제 이동 규칙은 그대로)
     🧹 청소부 — 📋 퇴근 일보 카드를 닫으면 일 안 하는 층(완료·쉼)을 위층부터 한 층씩(5초) 빗자루로 쓸고 지나감 · 그새 다시 일하면 그 층은 건너뜀 · 움직임 줄이기면 생략
   - 👔 사장님 묶음(#38, 1층 사장님 책상 · 사장님 자리(👆 56~142)와 모니터(👆 200~) 사이):
     ☕ 머그컵 — 몸통에 짧은 글자(#1 · PR✓ · LGTM …), 누르면 다음 문구로 순환하고 전체 문구가 2.5초 떠오름(👆 POKE와 따로 · 이스터에그 집계와 무관).
       고른 문구는 저장 m. 사장님이 실제로 커피 컵을 든 동안(POKE bossAfter의 cof)은 책상 머그를 잠깐 치움 · 전체 문구 딱지는 머그 오른쪽 위에서 모니터 쪽으로
     🎂 설치 기념일 — 처음 연 날(저장 fd, 새벽 4시 기준)과 같은 월·일이면 N주년(첫해 당일 0주년은 없음, 2/29 설치면 평년엔 2/28): 책상에 케이크(초 N개, 최대 9 · 촛불 깜빡)
       + "🎉 N주년" 딱지 + 그날 한 번 사장님 한마디 "벌써 N년이네요!" — 사장님 말풍선·👆 반응·머그 딱지가 비어 있을 때까지 미뤘다가 말하고 그때 cd(한마디 한 날) 저장
   - 개발용 쿼리 ?tiny=night(밤처럼) · ?tiny=streak(3일 연속인 척) · ?tiny=cups(50분 일한 척) · ?tiny=desk(컨텍스트 92% · 도구 520 · 75분 · 로봇 배터리 0칸)
     · ?tiny=wait1(질문 1분 30초) · wait3(4분) · oct(모두 문어, 도감엔 안 남김) · monday · friday · pigeon(곧 앉음) · rain(비) · repair · clean(계속 청소) · cake(1주년) · mug(누른 문구 저장 안 함), 쉼표로 여럿. 저장에는 반영하지 않음 */
const TINY = (() => {
  const K = "#2e2040";
  const dev = (() => { try { return new Set((new URLSearchParams(location.search).get("tiny") || "").split(",")); } catch { return new Set(); } })();   // 개발용 쿼리(위 목록)
  const ART = {
    cup: { r: ["KDDK..", "KCCKKK", "KCCK.K", "KCCKKK", ".KKK.."], p: { K, D: "#7a4a2a" } },   // C = 잔 색(잉크)
    catA: { r: ["..........KKKKK.....", ".........KNNNNNK....", "........KNNNYNNNK...", "........KKKKKKKKKKK.", "........KGGGGGGGK...", ".K......KGGGKGGGK...", "KGK.....KGGGGGLLPK..", "KGK.....KGGGGLLLK...", ".KGK.....KKGGGKK....",
      "..KGKKKKKGGGGGGKKYYK", "...KGDGDGGGGGLLLKKK.", "...KGGGGGGGGGLLLK...", "...KGGKKKKKKKGGGK...", "...KGKKGK..KGKKGK...", "...KK.KK...KK.KK...."], p: { K, N: "#34457f", Y: "#ffd23f", G: "#9aa0b4", D: "#71778c", L: "#e4e7ef", P: "#ff8ab0" } },
  };
  ART.paper = { r: ["KKKKKKKKKKKK", "KWLWWLLWWLWK", "KKKKKKKKKKKK"], p: { K, W: "#fffdf5", L: "#b8c4d4" } };
  ART.coat = { r: ["...KKKKKK...", "..KCCKKCCK..", ".KCCCKKCCCK.", "KCCCCKKCCCCK", "KCCCCKYCCCCK", "KCKCCKKCCKCK", "KCKCCKYCCKCK", "KCKCCKKCCKCK", "KCKCCKKCCKCK", "KKKCCKKCCKKK", "..KCCKKCCK..", "..KKKKKKKK.."], p: { K, Y: "#ffd23f" } };   // C = 겉옷 색(잉크)
  ART.pigA = { r: ["..KKK.....", ".KGEGK....", "OKGGGK....", ".KNNGKKKK.", ".KNGGGGGGK", "..KGGDDGGK", "...KKKKKK.", "....O..O.."], p: { K, G: "#c4c8d6", E: "#2e2040", O: "#ff9a5a", N: "#6fb0a0", D: "#8f94a8" } };
  ART.pigB = { r: ["..........", "..KKK.....", ".KGEGK....", "OKNNGKKKK.", ".KNGGGGGGK", "..KGGDDGGK", "...KKKKKK.", "....O..O.."], p: ART.pigA.p };   // 고개 까딱
  ART.pigF = { r: ["K.......K.", "KK.KKK.KK.", ".KKGEGKK..", "OKGGGGGK..", ".KNGGGGGK.", "..KKKKKK..", "...O..O..."], p: ART.pigA.p };   // 파닥(날개 위로)
  ART.mop = { r: ["..KK....KK..", ".KPPK..KPPK.", ".KRRRRRRRRK.", "KRRWRRRRWRRK", "KGGGGGGGGGGK", "KGEGGGGGGEGK", "KGGGGPPGGGGK", ".KGGGGGGGGK.", "..KBBBBBBK..", ".KBBWBBWBBK.", ".KBBBBBBBBK.", "..KK....KK.."], p: { K, P: "#ffb0c0", R: "#e85050", W: "#fff", G: "#c9b8a0", E: "#2e2040", B: "#5aa8ff" } };   // 청소부 생쥐(빨간 두건·파란 앞치마)
  ART.mopB = { r: ART.mop.r.slice(0, 11).concat([".KK......KK."]), p: ART.mop.p };
  ART.broom = { r: ["K.......", ".K......", "..K.....", "...K....", "....K...", "...YYY..", "..YYYYY.", ".YYYYYYY"], p: { K: "#8a5a3a", Y: "#e8c15a" } };
  ART.catB = { r: ART.catA.r.slice(0, 13).concat(["..KGK..KGK.KGK..KGK.", "..KK....KK.KK....KK."]), p: ART.catA.p };
  const MUG = ["#fff8e8", "#ffc8d8", "#cfe6ff", "#fff1a8"];
  const CUP_X = [421, 487, 437, 453];   // 잔 왼쪽 x(책상 cx 420 기준): 직원 오른쪽 · 모니터 아래(받침 472~484 비킴) · 머그(508~) 앞까지
  const CUP_SEC = 1200, CUP_MAX = 4, KEEP = 14, VER = 1, P_MAX = 60, S_MAX = 100, S_AWAY = 2 * 86400;
  const PASS = 12, PERIOD = 210, X0 = 650, X1 = 16, STAND_X = 370;   // 서 있는 자리(가운데 x): 화분 누를 자리(~350)와 커피머신(392~)·현관문(438~) 사이, 창 누를 자리(~B−30)보다 아래
  const COAT = { ham: "#e85050", peng: "#3a6ad8", bvr: "#5f8a3a", otr: "#c8783a", oct: "#8a5ac8", bot: "#5a6078", cat: "#d9668a" };
  const PILE_X = 537, FLAG_X = 497, COAT_X = 344, OUT_X = 317;   // 서류(책상 오른쪽 끝 531 · 👆 머그 누를 자리 ~535 다음) · 깃발(모니터 위 오른쪽, 표지판 522 앞) · 겉옷(의자 왼쪽) · 콘센트(커피머신 ~316과 책상 330 사이)
  const FLAGS = [[1000, "1K", "#ffd23f"], [500, "500", "#5aa8ff"], [100, "100", "#6adf8a"]];
  const sheets = c => c >= 90 ? 4 : c >= 85 ? 3 : c >= 80 ? 2 : 0;
  const flagOf = n => FLAGS.find(f => n >= f[0]) || null;
  const battery = sec => Math.max(0, 4 - Math.floor(sec / 3600));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && Array.isArray(o[k]);   // 프로젝트 이름이 constructor·__proto__여도 안전하게
  const ownS = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && !!o[k] && typeof o[k] === "object" && Number.isFinite(o[k].t0);   // sid 기록
  const dayKey = t => ymd(new Date((t - 4 * 3600) * 1000));   // 하루 = 새벽 4시 경계
  const dayBefore = (k, n) => { const [y, m, d] = k.split("-").map(Number); return ymd(new Date(y, m - 1, d - n)); };
  function load(raw) {
    let j = null; try { j = JSON.parse(raw || "null"); } catch {}
    const d = Object.create(null), ss = Object.create(null);   // 프로토타입 없는 맵(프로젝트 이름 · sid = 키)
    if (!j || typeof j !== "object" || typeof j.v !== "number") return { v: VER, d, s: ss, m: 0, fd: "", cd: "" };
    if (j.d && typeof j.d === "object" && !Array.isArray(j.d)) Object.keys(j.d).forEach(p => { if (own(j.d, p)) d[p] = j.d[p].filter(x => typeof x === "string"); });
    if (j.s && typeof j.s === "object" && !Array.isArray(j.s)) Object.keys(j.s).forEach(k => { if (ownS(j.s, k)) { const e = j.s[k], n = v => Number.isFinite(v) ? v : 0; ss[k] = { t0: e.t0, acc: n(e.acc), last: n(e.last), seen: n(e.seen), day: typeof e.day === "string" ? e.day : "" }; } });
    const day = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
    return { v: VER, d, s: ss, m: Number.isInteger(j.m) && j.m >= 0 ? j.m % MUGS.length : 0, fd: day(j.fd), cd: day(j.cd), ro: j.v > VER };   // m 머그 문구 · fd 설치한 날 · cd 기념일 한마디 한 날(#38 사장님 묶음, v 1에 더한 필드)
  }
  const dump = s => JSON.stringify(Object.assign({ v: VER, d: s.d, s: s.s }, s.m ? { m: s.m } : null, s.fd ? { fd: s.fd } : null, s.cd ? { cd: s.cd } : null));
  /* 세션 출근 기록: 처음 보면 t0(이미 일하던 중이면 started) · 새벽 4시 넘으면 t0 = 지금 · 도구 수가 줄면 지난 턴을 누적 · 이틀 안 본 sid 정리 → 바뀌었으면 true */
  function track(s, floors, now, today) {
    let ch = false;
    floors.forEach(f => {
      const k = f.sid, tools = +f.s.tools || 0; if (!k) return;
      let E = ownS(s.s, k) ? s.s[k] : null;
      if (!E) { E = s.s[k] = { t0: Math.min(now, +f.s.started || now), acc: 0, last: tools, seen: now, day: today }; ch = true; }
      if (E.day !== today) { E.t0 = now; E.day = today; ch = true; }
      if (tools !== E.last) { if (tools < E.last) E.acc += E.last; E.last = tools; ch = true; }
      if (now - E.seen > 600) { E.seen = now; ch = true; }
    });
    const ks = Object.keys(s.s);
    ks.forEach(k => { if (now - s.s[k].seen > S_AWAY) { delete s.s[k]; ch = true; } });
    const rest = Object.keys(s.s); if (rest.length > S_MAX) { rest.sort((a, b) => s.s[a].seen - s.s[b].seen).slice(0, rest.length - S_MAX).forEach(k => delete s.s[k]); ch = true; }
    return ch;
  }
  /* 오늘 기록 · 14일 지난 날 정리 → 바뀌었으면 true */
  function mark(s, live, today) {
    const old = dayBefore(today, KEEP - 1); let ch = false;
    live.forEach(p => { const a = own(s.d, p) ? s.d[p] : (s.d[p] = []); if (!a.includes(today)) { a.push(today); ch = true; } });
    Object.keys(s.d).forEach(p => { const a = s.d[p].filter(x => x >= old && x <= today).sort(); if (a.length !== s.d[p].length) ch = true; if (a.length) s.d[p] = a; else { delete s.d[p]; ch = true; } });
    const ps = Object.keys(s.d); if (ps.length > P_MAX) { ps.sort((a, b) => (s.d[a].slice(-1)[0] < s.d[b].slice(-1)[0] ? -1 : 1)).slice(0, ps.length - P_MAX).forEach(p => delete s.d[p]); ch = true; }
    return ch;
  }
  const streak = (a, today) => { let n = 0; while (Array.isArray(a) && a.includes(dayBefore(today, n))) n++; return n; };
  const cups = (f, run) => !f || f.layout === "meet" || !["work", "agents", "ask", "stall"].includes(f.kind) ? 0 : Math.min(CUP_MAX, Math.floor(run / CUP_SEC));
  const night = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 6;
  const PIG = 240, PIG_SIT = 35, PIG_X = 806;   // 🐦 주기·머무는 초 · 창 위 창틀 x(창 782~840 · 👆 창 누를 자리 y 38~88 바로 위)
  const UMB_X = 422;
  ART.mugB = { r: ["KKKKKKKK..", "KWWWWWWK..", "KWWWWWWKKK", "KWWWWWWK.K", "KWWWWWWK.K", "KWWWWWWKKK", "KWWWWWWK..", ".KWWWWK...", "..KKKK...."], p: { K, W: "#fffaf0" } };
  ART.cake = { r: [".KKKKKKKKKK.", "KWWWWWWWWWWK", "KPWPPWPPWPPK", "KPPPPPPPPPPK", "KCCCCCCCCCCK", "KPPPPPPPPPPK", "KKKKKKKKKKKK"], p: { K, W: "#fffaf0", P: "#ff9ab8", C: "#fff1a8" } };
  /* ☕ 사장님 머그 문구: [머그에 찍는 짧은 글자, ko, en] */
  const MUGS = [["#1", "세계 최고 사장(아마도)", "World's OK-est boss"], ["☕", "커피 먼저", "Coffee first"], ["PR✓", "PR 승인 담당", "Chief PR approver"], ["BUG", "버그는 내 탓 아님", "Not my bug"],
    ["LGTM", "대충 좋아 보임", "Looks good to me"], ["5h", "한도는 소중해", "Mind the limit"], ["OK", "다 잘 될 거야", "It'll all be fine"], ["Zzz", "회의는 짧게", "Keep meetings short"]];
  const MUG_X = 166, CAKE_X = 143;   // 머그(166~196) · 케이크(143~167): 사장님 👆(~142)과 모니터 👆(200~) 사이 책상 위
  /* 🎂 기념일: fd(설치한 날) 기준 오늘이 같은 월·일이면 햇수(2/29 설치 → 평년엔 2/28), 아니면 0 */
  const anniv = (fd, today) => { const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fd || ""), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today || ""); if (!a || !b) return 0;
    const y = +b[1], leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0, md = a[2] === "02" && a[3] === "29" && !leap ? "02-28" : a[2] + "-" + a[3];
    return md === b[2] + "-" + b[3] ? Math.max(0, y - +a[1]) : 0; };   // ☂️ 커피머신(392~422)과 현관문(438~) 사이
  const repair = t => { const d = new Date(t * 1000), m = d.getHours() * 60 + d.getMinutes(), hh = fnv("fix" + dayKey(t)), n = 1 + (hh & 1);   // 🛗 하루 1~2번 10분, 10~18시
    for (let k = 0; k < n; k++) { const st = 600 + ((hh >>> (4 + k * 9)) % 470); if (m >= st && m < st + 10) return true; } return false; };
  const monday = t => new Date((t - 4 * 3600) * 1000).getDay() === 1;   // 새벽 4시 기준 하루
  const friday = t => { const d = new Date(t * 1000), w = d.getDay(), hh = d.getHours(); return (w === 5 && hh >= 17) || (w === 6 && hh < 4); };
  return { ART, MUG, CUP_X, PASS, PERIOD, X0, X1, STAND_X, COAT, PILE_X, FLAG_X, COAT_X, OUT_X, sheets, flagOf, battery, own, ownS, dayKey, load, dump, track, mark, streak, cups, night, monday, friday, repair, PIG, PIG_SIT, PIG_X, UMB_X, MUGS, MUG_X, CAKE_X, anniv, dev, fri: false, mon: false, fix: false };   // fix: 🛗 지금 점검 중(tinyBig.frame이 갱신)   // fri: 🌺 셔츠 입는 시간 · mon: 🥱 월요일(tinyBig.pre가 본체 frame 맨 앞에서 갱신, 본체 setP·actor가 읽음)
})();

/* ---------- ☕ 큰 화면: 층마다 빈 잔 · 연속 출근 달력 · 1층 야간 경비 고양이. h = 스튜디오 본체 연결 ---------- */
function tinyBig(h) {
  const { ctx, doc, mkEl, sty, html, txt, X } = h, T_ = TINY;
  const dev = T_.dev;
  let s = T_.load(ctx.store.get("tiny", "")), G = null, say = -9, day = "", st = new Map(), cur = new Map();   // st: 프로젝트 → 연속 일수 · cur: sid → 최신 층 객체(둘 다 read 때만)
  const pops = new Map();   // 🎉 sid → { st: 마지막으로 본 깃발 단계, t0: 솟은 시각 } (살아 있는 sid만)
  const save = () => { if (!s.ro) try { ctx.store.set("tiny", T_.dump(s)); } catch {} };
  const keyOf = f => f && f.s && f.s.project || "";
  /* 상태 → 오늘 일한 프로젝트 · 세션 출근 기록(큰 화면만 씀, 바뀌었을 때만 저장) */
  function read(floors) {
    floors = floors || []; const now = ctx.now(), live = new Set(floors.map(keyOf).filter(Boolean)); day = T_.dayKey(now);
    const a = T_.mark(s, live, day), b = T_.track(s, floors, now, day), c = !s.fd && (s.fd = day); if (a || b || c) save();   // fd: 처음 연 날(기존 사용자는 이 버전을 처음 연 날)
    cur = new Map(floors.map(f => [f.sid, f])); for (const k of pops.keys()) if (!cur.has(k)) pops.delete(k);
    st = new Map([...live].map(p => [p, (n => dev.has("streak") ? Math.max(3, n) : n)(T_.streak(T_.own(s.d, p) ? s.d[p] : null, day))]));
  }
  function build(o) {
    G = { fl: [], cat: null, tents: [], mug: null, cake: null, B: 0, umb: null, fix: null, pig: null, mop: null, sky: h.view ? h.view.querySelector(".bird") : null };   // sky: 하늘을 나는 비둘기 하나(내려앉는 동안 숨김)
    if (o.carEl) G.fix = mkEl("div", "b tn-fix", o.carEl, { display: "none" }, "🔧 " + X("점검 중", "Repair"));   // 🛗 카 문 스티커(카와 함께 움직임)
    o.FL.forEach((fl, i) => {
      if (i === o.n) {   // 1층: 경비 고양이 · 손전등 빛 · 말풍선
        const c = G.cat = { F: fl.F, B: fl.B }; G.B = fl.B;
        c.beam = mkEl("div", "b tn-beam", fl.F, { display: "none" });
        c.el = mkEl("img", "b tn-cat", fl.F, { display: "none", pointerEvents: "none" }); c.el.alt = ""; c.el.draggable = false; c.el.title = X("야간 경비 고양이", "Night guard cat");
        c.bub = mkEl("div", "bub tn-bub", fl.F, { display: "none" });
        G.mug = mkEl("div", "b tn-mug", fl.F, { left: T_.MUG_X + "px", top: (fl.B - 26 - 27) + "px" }, "<img alt=\"\" draggable=\"false\"><b></b>"); G.mug.firstChild.src = WB.pix(T_.ART.mugB, 3).url;   // ☕ 누르면 문구 순환
        G.mugT = mkEl("div", "b tn-mugt", fl.F, { display: "none" });   // 전체 문구(2.5초)
        G.cake = mkEl("div", "b tn-cake", fl.F, { left: T_.CAKE_X + "px", top: (fl.B - 26 - 14) + "px", display: "none" }); G.cake.innerHTML = `<img alt="" src="${WB.pix(T_.ART.cake, 2).url}"><span></span><em></em>`;
        G.bossB = mkEl("div", "bub tn-bossb", fl.F, { display: "none" });
        G.umb = mkEl("div", "b tn-umb", fl.F, { left: T_.UMB_X + "px", top: (fl.B - 34) + "px" });   // ☂️ (누를 수 없음 → title 없음)
        return;
      }
      const f = fl.f; if (!f) return;
      const r = { f, F: fl.F, B: fl.B, meet: f.layout === "meet", cups: [] };
      if (!r.meet) {   // 🗂️ 책상 묶음: 서류 · 겉옷 · 깃발 · (로봇) 배터리·케이블·콘센트
        const cs = WB.pix(T_.ART.coat, 2, T_.COAT[f.animal] || "#7a7f8c");
        r.coat = mkEl("img", "b tn-coat", fl.F, { left: (T_.COAT_X - cs.w / 2) + "px", top: (fl.B - 60) + "px", width: cs.w + "px", height: cs.h + "px", display: "none" }); r.coat.alt = ""; r.coat.src = cs.url; r.coat.draggable = false;
        r.pile = mkEl("div", "b tn-pile", fl.F, { left: T_.PILE_X + "px", top: (fl.B - 26) + "px", display: "none" });
        r.flag = mkEl("div", "b tn-flag", fl.F, { left: T_.FLAG_X + "px", top: (fl.B - 110) + "px", display: "none" }, "<i></i><b></b>");
        if (f.animal === "bot") { r.bat = mkEl("div", "b tn-bat", fl.F, { display: "none" }, "<i></i><i></i><i></i><i></i><u>⚡</u>"); r.bolt = r.bat.querySelector("u");
          r.out = mkEl("div", "b tn-out", fl.F, { left: T_.OUT_X + "px", top: (fl.B - 16) + "px", display: "none" }); r.out.title = X("충전하며 일하는 중 ⚡", "Working while charging ⚡");
          r.cab = mkEl("div", "b tn-cab", fl.F, { left: "0", top: "0", width: "1px", height: "1px", display: "none" }); }
      }
      if (fl.desk && f.animal === "oct") { fl.desk.hands.forEach(e => e.classList.add("tn-tent")); fl.desk.tent = mkEl("div", "b tn-tent", fl.F, { left: (DESK_X - 11) + "px", top: (fl.B - 43) + "px", width: "16px", height: "12px", background: "#b57be0", border: "3px solid #4a3560", zIndex: "11", display: "none" }); G.tents.push(fl.desk.tent); }   // 🐙 손 = 다리 끝 + 가운데 하나 더
      if (!r.meet) r.cups = T_.CUP_X.map((x, j) => { const p = WB.pix(T_.ART.cup, 2, T_.MUG[j]), e = mkEl("img", "b tn-cup", fl.F, { left: x + "px", top: (fl.B - 26 - p.h) + "px", width: p.w + "px", height: p.h + "px", display: "none" }); e.alt = ""; e.src = p.url; e.draggable = false; return e; });
      r.cal = mkEl("div", "b tn-cal", fl.F, { left: (r.meet || f.aib ? 253 : 243) + "px", top: "42px", display: "none" });   // 왼쪽 창(보드)과 🎨 벽 1 사이
      G.fl.push(r);
    });
  }
  ctx.listen(doc, "click", e => { if (!G || !G.cat || e.target !== G.cat.el) return; say = h.clockT(); h.kick(); });
  /* 🐦 비둘기를 누르면 파닥 날아감 — 캡처 단계에서 먼저 받아 다른 클릭 처리(👆·층 이동 등)로 넘기지 않음 */
  /* ☕ 사장님 머그: 누르면 다음 문구(캡처 단계에서 받아 👆 등 다른 클릭 처리로 넘기지 않음) */
  let mugT = -9, bossSay = -9;
  ctx.listen(doc, "click", e => { if (!G || !G.mug || !G.mug.contains(e.target) || G.mug.style.display === "none") return; e.stopPropagation(); e.preventDefault();
    s.m = (s.m + 1) % T_.MUGS.length; if (!dev.has("mug")) save(); mugT = h.clockT(); G.mug._k = null; h.kick(); }, true);
  const boss = (now, tc, anim, hid) => {
    if (!G.mug) return;
    const off = hid || (h.dr && h.dr()), M = T_.MUGS[s.m % T_.MUGS.length], en = ctx.lang === "en";
    const sip = !!(h.cof && h.cof());   // 👆 POKE 사장님이 실제로 커피 컵을 든 프레임(bossAfter의 cof)
    const mk = off || sip ? "x" : M[0] + ctx.lang;
    if (G.mug._k !== mk) { G.mug._k = mk; sty(G.mug, "display", mk === "x" ? "none" : "block"); if (mk !== "x") { txt(G.mug.lastChild, M[0]); G.mug.title = (en ? M[2] : M[1]) + X(" · 누르면 다른 문구", " · click for another"); } }
    const ts = !off && tc - mugT < 2.5; sty(G.mugT, "display", ts ? "block" : "none");
    if (ts) { txt(G.mugT, "☕ " + (en ? M[2] : M[1])); sty(G.mugT, "left", (T_.MUG_X + 20) + "px"); sty(G.mugT, "top", (G.B - 70 - (anim ? Math.round(Math.min(tc - mugT, .3) * 20) : 6)) + "px"); }   // 머그 오른쪽 위에서 모니터 쪽으로(사장님 머리 위 말풍선 줄과 안 겹침)
    /* 🎂 기념일 */
    const n = off ? 0 : dev.has("cake") ? 1 : T_.anniv(s.fd, day), ck = n ? n + ctx.lang : "";
    if (G.cake._k !== ck) { G.cake._k = ck; sty(G.cake, "display", n ? "block" : "none");
      if (n) { const c = Math.min(n, 9); html(G.cake.children[1], Array.from({ length: c }, (_, j) => `<i style="left:${Math.round(3 + (c > 1 ? j * 16 / (c - 1) : 8))}px"></i>`).join("")); txt(G.cake.children[2], X(`🎉 ${n}주년`, `🎉 ${n} yr${n > 1 ? "s" : ""}`)); } }
    if (n) G.cake.classList.toggle("dim", anim && Math.floor(tc * 3) % 2 === 1);   // 촛불 깜빡(정지면 켠 채로)
    /* 한마디는 사장님이 보이고 · 사장님 말풍선(🎁 새 버전 · 📋 일보 · 질문 인사 …)이 비어 있고 · 👆 사장님 반응·머그 딱지가 없을 때만. 그 전까진 미뤘다가 비면 그때(말한 뒤에야 cd 저장) */
    const bb = h.boss && h.boss(), free = !!bb && bb.el.style.display !== "none" && bb.bub.style.display !== "block" && !(h.pkBub && h.pkBub()) && !ts;
    if (n && s.cd !== day && bossSay < 0 && free) { bossSay = tc; if (!dev.has("cake")) { s.cd = day; save(); } }   // 그날 한 번
    const sayOn = n && bossSay >= 0 && tc - bossSay < 6 && free;
    sty(G.bossB, "display", sayOn ? "block" : "none");
    if (sayOn) { txt(G.bossB, X(`벌써 ${n}년이네요! 🎂`, `${n} year${n > 1 ? "s" : ""} already! 🎂`)); sty(G.bossB, "left", Math.round(parseFloat(bb.el.style.left) + bb.w / 2) + "px"); sty(G.bossB, "top", Math.round(parseFloat(bb.el.style.top) - 34) + "px"); }
  };
  const pg = { cyc: -1, sid: "", away: null };   // 이번 주기에 앉을 층(sid, 주기 시작 때 고정) · 누른 시각(1초 파닥 날아간 뒤 그 주기엔 다시 안 옴)
  ctx.listen(doc, "click", e => { if (!G || !G.pig || !G.pig.el.contains(e.target) || G.pig.el.style.pointerEvents !== "auto") return; e.stopPropagation(); e.preventDefault(); if (pg.away == null) pg.away = h.clockT(); h.kick(); }, true);
  const mop = { list: null, k: 0, t0: 0, prevDr: false };   // 🧹 청소 차례(층 sid 목록)
  const bldg = (now, tc, anim, hid) => {
    const dr = !!(h.dr && h.dr()), off = hid || dr, fls = G.fl;
    /* ☂️ 우산 꽂이: 사장님 우산 + (비·눈이면) 직원 층 수만큼(최대 4) */
    if (G.umb) { const wk = dev.has("rain") ? 85 : h.wk ? h.wk() : 0, ans = wk >= 80 ? fls.map(r => r.f.animal).slice(0, 4) : [], uk = (off ? "x" : wk >= 90 ? "s" : wk >= 80 ? "r" : "c") + ans.join();
      if (G.umb._k !== uk) { G.umb._k = uk; sty(G.umb, "display", off ? "none" : "block");
        const cs = ["#34457f"].concat(ans.map(an => T_.COAT[an] || "#7a7f8c"));
        html(G.umb, cs.map((c, j) => `<i style="left:${j * 3}px;height:${18 + (j * 5) % 7}px;background:${c}"></i>`).join("") + `<b></b>${wk >= 80 ? "<u></u>" : ""}`); } }
    /* 🛗 점검 스티커 */
    const fix = !off && (dev.has("repair") || T_.repair(now)); T_.fix = fix; if (G.fix) sty(G.fix, "display", fix && !(h.door && h.door() > .1) ? "block" : "none");   // 문이 열리면 스티커도 문과 함께 비킴
    /* 🐦 비둘기: 주기마다 층 하나(해시) · 정전·밤·숨김이면 안 앉음 */
    const per = dev.has("pigeon") ? 20 : T_.PIG, sit = dev.has("pigeon") ? 15 : T_.PIG_SIT, cyc = Math.floor(now / per), u = now % per, sky = G.sky;
    if (cyc !== pg.cyc) { pg.cyc = cyc; pg.away = null; pg.sid = fls.length ? fls[fnv("pig" + cyc) % fls.length].f.sid : ""; }   // 앉는 사이 층 수가 바뀌어도 그 층에 그대로
    const fi = fls.findIndex(q => q.f.sid === pg.sid), r = fls[fi], awayU = pg.away != null ? tc - pg.away : null;
    let show = !off && r && u < sit && !(h.out && h.out()) && !((h.night ? h.night() : 0) > .3);
    if (awayU != null && (!anim || awayU > 1)) show = false;   // 누르면 1초 파닥 날아간 뒤 숨김(정지면 바로)
    if (!G.pig || G.pig.F !== (r && r.F)) { if (G.pig) G.pig.el.remove(); G.pig = r ? { F: r.F, el: mkEl("img", "b tn-pig", r.F, { display: "none" }) } : null; if (G.pig) { G.pig.el.alt = ""; G.pig.el.draggable = false; G.pig.el.title = X("비둘기 (누르면 날아가요)", "Pigeon (click to shoo)"); } }
    if (sky) sty(sky, "visibility", show ? "hidden" : "");   // 하늘을 날던 그 비둘기가 내려앉은 것
    if (G.pig) { const P = G.pig.el; sty(P, "display", show ? "block" : "none");
      if (show) { const flyIn = anim ? clamp(u / 1.2, 0, 1) : 1, flyOut = anim ? (awayU != null ? clamp(awayU, 0, 1) : clamp((u - (sit - 1.2)) / 1.2, 0, 1)) : 0, flying = flyIn < 1 || flyOut > 0;
        const art = flying ? (Math.floor(tc * 10) % 2 ? T_.ART.pigF : T_.ART.pigA) : anim && Math.floor(tc * 1.6 + fi) % 3 === 0 ? T_.ART.pigB : T_.ART.pigA, p = WB.pix(art, 3);
        if (P._u !== p.url) { P._u = p.url; P.src = p.url; sty(P, "width", p.w + "px"); sty(P, "height", p.h + "px"); }
        const fx = (1 - flyIn) * 60 + flyOut * 70, fy = -(1 - flyIn) * 40 - flyOut * 50;
        sty(P, "left", Math.round(T_.PIG_X + fx) + "px"); sty(P, "top", Math.round(38 - p.h + fy) + "px"); sty(P, "opacity", flyOut > 0 ? (1 - flyOut).toFixed(2) : "");
        sty(P, "pointerEvents", flying ? "none" : "auto"); } }
    /* 🧹 청소부: 일보 연출이 끝나면(카드를 닫으면) 위층부터 · 일하는 층은 건너뜀 · 움직임 줄이기면 생략 */
    if (mop.prevDr && !dr && anim) mop.list = fls.map(q => q.f.sid), mop.k = 0, mop.t0 = tc;
    mop.prevDr = dr;
    if (dev.has("clean") && !mop.list && anim && !off) mop.list = fls.map(q => q.f.sid), mop.k = 0, mop.t0 = tc;
    if (off || !anim) mop.list = null;
    let me = null, mu = 0;
    while (mop.list && mop.k < mop.list.length) {
      const q = fls.find(z => z.f.sid === mop.list[mop.k]), busy = !q || ["work", "agents", "ask", "stall"].includes(q.f.kind);
      if (busy) { mop.k++; mop.t0 = tc; continue; }   // 일하는 층은 건너뜀(쓸다가 다시 일해도 바로 다음 층으로)
      mu = tc - mop.t0; if (mu < 5) { me = q; break; }
      mop.k++; mop.t0 = tc;
    }
    if (mop.list && mop.k >= mop.list.length) mop.list = null;
    if (!G.mop || G.mop.F !== (me && me.F)) { if (G.mop) G.mop.el.remove(); G.mop = me ? { F: me.F, el: mkEl("div", "b tn-mop", me.F), } : null;
      if (G.mop) { const b = WB.pix(T_.ART.mop, 3), br = WB.pix(T_.ART.broom, 3); G.mop.h = b.h;
        G.mop.body = mkEl("img", "b", G.mop.el, { left: "14px", top: "0px", width: b.w + "px", height: b.h + "px" }); G.mop.br = mkEl("img", "b", G.mop.el, { left: "-6px", top: (b.h - br.h + 2) + "px", width: br.w + "px", height: br.h + "px" }); G.mop.br.src = br.url;
        G.mop.dust = mkEl("div", "b tn-dust", G.mop.el, { top: (b.h - 6) + "px" }); [G.mop.body, G.mop.br].forEach(e => { e.alt = ""; e.draggable = false; }); } }
    if (G.mop) { const M = G.mop, x = lerp(720, 90, mu / 5), wk = Math.floor(tc * 6) % 2, b = WB.pix(wk ? T_.ART.mopB : T_.ART.mop, 3);   // 걸음(2프레임)에 바뀌는 것만
      if (M.body._u !== b.url) { M.body._u = b.url; M.body.src = b.url; }
      sty(M.el, "left", Math.round(x) + "px"); sty(M.el, "top", (me.B - M.h - (wk ? 2 : 0)) + "px");
      sty(M.br, "transform", `rotate(${wk ? 12 : -10}deg)`); sty(M.dust, "left", (wk ? -14 : -8) + "px"); sty(M.dust, "opacity", wk ? ".9" : ".5"); }
  };   // 🔦 고양이를 누르면 한마디
  function frame(T, tc, anim) {
    if (!G) return;
    const now = ctx.now(), hid = h.hidden();   // 🙈 눈치 모드: 모두 숨김
    if (hid || (h.dr && h.dr())) { G.tents.forEach(e => sty(e, "display", "none")); for (const a of h.actors.values()) if (a.tnx) { sty(a.tnx.sw, "display", "none"); sty(a.tnx.yw, "display", "none"); } }   // 🙈·📋 연출 중: 몸짓 소품 걷음(actor를 안 부름)
    if (T_.dayKey(now) !== day) read(h.floors());   // 새벽 4시가 넘으면 바로 오늘 기록(달력이 다음 상태까지 비지 않게)
    G.fl.forEach(r => {
      r.f = cur.get(r.f.sid) || r.f;   // 층 객체는 상태가 올 때마다 새로 생김(다시 짓지 않아도) → 최신 것으로
      r.run = runOf(r.f.sid, now);
      const n = hid ? 0 : T_.cups(r.f, Math.max(r.run, dev.has("cups") ? 3000 : 0)), cn = n + "";
      if (r.cn !== cn) { r.cn = cn; r.cups.forEach((e, j) => sty(e, "display", j < n ? "block" : "none")); r.cups.forEach(e => { e.title = n ? X(`빈 커피잔 ${n}개 · 출근한 지 ${n * 20}분+`, `${n} empty cup${n > 1 ? "s" : ""} · ${n * 20}+ min since clock-in`) : ""; }); }
      const d = hid ? 0 : st.get(keyOf(r.f)) || 0, dk = d >= 2 ? d + ctx.lang : "";
      if (r.dk !== dk) { r.dk = dk; sty(r.cal, "display", d >= 2 ? "block" : "none"); if (d >= 2) { html(r.cal, `<i></i><b>🔥${d}</b>`); r.cal.title = X(`연속 출근 ${d}일`, `${d}-day streak`); } }
      if (r.pile) desk(r, now, tc, anim, hid);
    });
    bldg(now, tc, anim, hid);   // 🏢 건물 묶음
    boss(now, tc, anim, hid);   // 👔 사장님 머그·기념일 케이크
    const c = G.cat; if (!c) return;
    const on = (dev.has("night") || T_.night(new Date(now * 1000))) && !hid;
    if (!on) { [c.el, c.beam, c.bub].forEach(e => sty(e, "display", "none")); return; }
    const per = dev.has("night") ? 16 : T_.PERIOD, cyc = Math.floor(now / per), u = (now % per) / T_.PASS, walk = anim && u < 1, ltr = cyc % 2 === 1;
    let x, left = true, art = T_.ART.catA;
    if ((anim && !walk) || (!walk && h.askOn())) { [c.el, c.beam, c.bub].forEach(e => sty(e, "display", "none")); return; }   // 순찰과 순찰 사이엔 어딘가 다른 층에 · 질문 말풍선이 덮으면 숨음
    if (walk) { x = ltr ? lerp(T_.X1, T_.X0, u) : lerp(T_.X0, T_.X1, u); left = !ltr; art = Math.floor(u * T_.PASS * 4) % 2 ? T_.ART.catB : T_.ART.catA; }
    else { x = T_.STAND_X; left = false; }   // 정적: 작게 서서 현관문 쪽을 비춤
    const sc = walk ? 3 : 2, p = WB.pix(art, sc), top = c.B - p.h + 1, xl = Math.round(x - p.w / 2);
    if (c.el._u !== p.url) { c.el._u = p.url; c.el.src = p.url; }
    sty(c.el, "display", "block"); sty(c.el, "left", xl + "px"); sty(c.el, "top", top + "px"); sty(c.el, "width", p.w + "px"); sty(c.el, "height", p.h + "px"); sty(c.el, "transform", left ? "scaleX(-1)" : ""); sty(c.el, "pointerEvents", walk ? "none" : "auto"); sty(c.el, "cursor", walk ? "" : "pointer");
    const bw = walk ? 84 : 40, bh = sc * 10, by = top + sc * 9.5 - bh / 2;   // 손전등 빛: 앞발 손전등에서 바닥 쪽으로 퍼지는 원뿔
    sty(c.beam, "display", "block"); sty(c.beam, "top", Math.round(by) + "px"); sty(c.beam, "height", bh + "px"); sty(c.beam, "width", bw + "px"); sty(c.beam, "left", (left ? xl + 2 - bw : xl + p.w - 2) + "px"); sty(c.beam, "transform", left ? "scaleX(-1)" : "");
    const b = tc - say < 2.6;
    sty(c.bub, "display", b ? "block" : "none");
    if (b) { html(c.bub, X("순찰 중이에요 🔦", "On patrol 🔦")); sty(c.bub, "left", Math.round(xl + p.w / 2) + "px"); sty(c.bub, "top", (top - 30) + "px"); }
  }
  /* 출근 뒤 지난 초 · 누적 도구 수(지난 턴 + 지금 턴) */
  const runOf = (sid, now) => T_.ownS(s.s, sid) ? Math.max(0, now - s.s[sid].t0) : 0;
  const toolsOf = f => T_.ownS(s.s, f.sid) ? s.s[f.sid].acc + (+f.s.tools || 0) : +f.s.tools || 0;
  /* 🗂️ 책상 묶음 한 층 */
  function desk(r, now, tc, anim, hid) {
    const S = r.f.s, fake = dev.has("desk"), on = !hid && ["work", "agents", "ask", "stall"].includes(r.f.kind);
    const cx = fake ? 92 : +S.ctx || 0, tools = fake ? 520 : toolsOf(r.f), run = Math.max(r.run, fake ? 4500 : 0);
    /* 📚 서류: 묶음마다 2px씩 엇갈림 · 90%↑는 기울어 흔들(정지면 기울기만) */
    const n = on ? T_.sheets(cx) : 0, pk = n + ctx.lang + Math.round(cx);
    if (r.pk !== pk) { r.pk = pk; sty(r.pile, "display", n ? "block" : "none");
      if (n) { const p = WB.pix(T_.ART.paper, 3); let hh = ""; for (let j = 0; j < n; j++) hh += `<img alt="" src="${p.url}" style="position:absolute;left:${[0, 2, -1, 1][j] * 2}px;bottom:${j * 6}px;width:${p.w}px;height:${p.h}px">`;
        html(r.pile, hh); sty(r.pile, "height", (n * 6 + 3) + "px"); sty(r.pile, "top", (r.B - n * 6 - 3) + "px"); r.pile.title = X(`컨텍스트 ${Math.round(cx)}%`, `Context ${Math.round(cx)}%`); } }
    if (n >= 4) sty(r.pile, "transform", `rotate(${anim ? (-3 + Math.sin(tc * 2.4) * 2).toFixed(1) : -3}deg)`); else sty(r.pile, "transform", "");
    /* 🧥 겉옷: 1시간 넘게 일함 */
    const dr = !!(h.dr && h.dr());   // 📋 퇴근 일보 연출 중: 직원이 퇴근·발표하러 자리를 비움 → 겉옷도 챙겨 감, 배터리·케이블 없음
    sty(r.coat, "display", on && !dr && run >= 3600 ? "block" : "none");
    /* 🎉 깃발: 단계는 늘 실제 값으로 기억(눈치 모드는 표시만 숨김) · 단계가 오르는 걸 보면 톡 솟음(.45초, 정지면 없음) */
    const F0 = T_.flagOf(tools), st = F0 ? F0[0] : 0, P = pops.get(r.f.sid), fg = hid ? null : F0;
    if (!P) pops.set(r.f.sid, { st, t0: -9 }); else if (st > P.st) { P.st = st; P.t0 = tc; } else P.st = st;
    const fk = fg ? fg[1] + ctx.lang : "";
    if (r.fk !== fk) { r.fk = fk; sty(r.flag, "display", fg ? "block" : "none"); if (fg) { const b = r.flag.querySelector("b"); b.textContent = fg[1]; sty(b, "background", fg[2]); r.flag.title = X(`도구 ${fg[0]}번 넘게 썼어요 🎉`, `${fg[0]}+ tool calls 🎉`); } }
    const pu = P ? tc - P.t0 : 9; sty(r.flag, "transform", fg && anim && pu < .45 ? `translateY(${Math.round((1 - ease(pu / .3)) * 14 - Math.sin(clamp(pu / .45, 0, 1) * Math.PI) * 3)}px)` : "");
    /* 🔋 로봇 배터리: 머리 오른쪽(이름표 아래) · 0칸이면 ⚡ + 케이블 */
    if (!r.bat) return;
    /* 직원이 자기 층에 실제로 보일 때만(멈춤 의심 = 바닥에 누워 졸음 · 일보 연출 · 숨김 제외). 케이블은 책상 의자에 앉아 있을 때만 */
    const a = h.actors.get(r.f.sid), home = on && !dr && r.f.kind !== "stall" && a && a.par === r.F && a.loc === "home" && !a.moving && a.el.style.display !== "none", lv = fake ? 0 : T_.battery(run);
    sty(r.bat, "display", home ? "flex" : "none"); const chg = home && lv === 0 && Math.abs(a.x - DESK_X) < 2; sty(r.out, "display", chg ? "block" : "none"); sty(r.cab, "display", chg ? "block" : "none");
    if (!home) return;
    const top = parseFloat(a.el.style.top) || 0; sty(r.bat, "left", Math.round(a.x + 34) + "px"); sty(r.bat, "top", Math.round(top + 10) + "px");
    if (r.bk !== lv) { r.bk = lv; r.bat.className = "b tn-bat l" + lv; }
    sty(r.bolt, "opacity", chg && anim && Math.floor(tc * 2) % 2 ? ".35" : "1");
    if (chg) {   // 케이블: 로봇 왼쪽 등 → 책상 뒤로 내려가 콘센트(SVG 곡선, 누르기 막지 않음)
      const x0 = Math.round(a.x - 24), y0 = r.B - 40, x1 = T_.OUT_X + 4, y1 = r.B - 11, L = Math.min(x0, x1) - 4, Tp = y0 - 4, ck = [x0, y0].join();
      if (r.ck !== ck) { r.ck = ck; sty(r.cab, "left", L + "px"); sty(r.cab, "top", Tp + "px"); sty(r.cab, "width", (Math.abs(x0 - x1) + 8) + "px"); sty(r.cab, "height", (y1 - Tp + 4) + "px");
        html(r.cab, `<svg width="${Math.abs(x0 - x1) + 8}" height="${y1 - Tp + 4}" style="display:block;overflow:visible"><path d="M${x0 - L} ${y0 - Tp} C ${x0 - L - 18} ${y0 - Tp + 2}, ${x1 - L + 2} ${y1 - Tp - 26}, ${x1 - L} ${y1 - Tp}" fill="none" stroke="#2e2040" stroke-width="3" stroke-linecap="round"/><path d="M${x0 - L} ${y0 - Tp} C ${x0 - L - 18} ${y0 - Tp + 2}, ${x1 - L + 2} ${y1 - Tp - 26}, ${x1 - L} ${y1 - Tp}" fill="none" stroke="#ffd23f" stroke-width="1"/></svg>`); }
    }
  }
  /* 🤸 직원 몸짓: placeActor가 놓은 직원을 덮어씀(본체 frame에서 👆 POKE 반응 바로 앞). 직원마다 💦 · "하암~" 딱지는 배우 요소 안에 */
  const extra = a => a.tnx || (a.tnx = { sw: mkEl("div", "tn-sw", a.el, { display: "none" }, "💦"), yw: mkEl("div", "tn-yawn", a.el, { display: "none" }) });
  function actor(i, fl, f, a, T, tc, anim) {
    const E = extra(a), now = ctx.now(), hid = h.hidden(), D = fl.desk; let sw = false, yw = false;
    if (D && D.tent) { const hs = D.hands[0].style; sty(D.tent, "display", hid ? "none" : hs.display || "block"); sty(D.tent, "marginTop", hs.marginTop === "-4px" ? "0px" : "-4px"); }   // 🐙 가운데 다리는 손과 엇박자
    /* 🦶 질문 대기: 엘리베이터 앞 · 1층 사장님 앞(주저앉기까지) · 자기 층 순서 대기(발 동동만). 시간은 그 자리에 도착한 때부터(자리를 옮기면 다시) */
    const wk = f.kind !== "ask" || a.moving || !a.par || !a.par.classList.contains("fl") ? "" : a.lift === "wait" ? "lift" : a.loc === "boss" && a.goal === "boss" ? "boss" : a.loc === "home" && a.goal !== "boss" ? "q" : "";
    if (!a.tnW || a.tnW.k !== wk) a.tnW = { k: wk, t0: now };
    /* 🛗 점검 중: 엘리베이터를 기다리다 4초마다 계단 쪽(왼쪽)으로 두어 걸음 가려다 돌아옴 — 그 1.6초에만 그림을 바꾸고(문이 열리는 중엔 안 함) 나머지는 아래 대기 몸짓 그대로.
       위치는 모델 a.x(층 안 좌표)에서 다시 계산 — 지난 프레임에 그린 값이 쌓이지 않음 */
    const fu = (tc + i * 1.3) % 4, fk = anim && fu < 1.6 ? Math.sin(fu / 1.6 * Math.PI) : 0;
    const fixG = !hid && T_.fix && fk > 0 && a.lift === "wait" && !a.moving && a.par && a.par.classList.contains("fl") && a.x != null && !(h.door && h.door() > 0);
    if (fixG) { const o = JSON.parse(a.pose), wl = Math.floor(tc * 8) % 2; h.setP(a, Object.assign(o, { seated: 0, legs: wl ? "a" : "b", eyes: "o" })); h.put(a, a.par, a.x - Math.round(fk * 12), parseFloat(a.par.style.height) - 10, { dy: wl ? -2 : 0, flip: true }); }
    if (!hid && wk && !fixG) {
      const w = Math.max(Math.min(now - a.tnW.t0, now - (f.s.since || now)), dev.has("wait3") ? 240 : dev.has("wait1") ? 90 : 0);
      if (w >= 60) {
        const o = JSON.parse(a.pose), flip = a.img.style.transform.includes("scaleX(-1)"), x = parseFloat(a.el.style.left) + a.w / 2, feet = parseFloat(a.par.style.height) - 10;
        let dy = 0, rot = 0;
        if (w >= 180 && wk !== "q") { Object.assign(o, { seated: 1, legs: "s", arms: "", mouth: "", eyes: anim && Math.floor(tc * .8 + i) % 4 === 0 ? "c" : "o" }); sw = true; }   // 주저앉기
        else { const tap = anim ? Math.floor(tc * 9 + i) % 2 : 0; Object.assign(o, { seated: 0, legs: anim ? (tap ? "a" : "b") : "a", eyes: "o" }); dy = anim ? (tap ? -3 : 0) : 0; rot = anim ? (tap ? 3 : -3) : 0; }   // 발 동동
        h.setP(a, o); h.put(a, a.par, x, feet, { dy, flip, rot });
      }
    }
    /* 🥱 월요일 출근 뒤 10분: 40초마다 2.6초 하품(앉아서 평소 자세일 때만 · 움직임 줄이기면 없음) */
    const Es = T_.ownS(s.s, f.sid) ? s.s[f.sid] : null;
    if (!hid && anim && Es && T_.mon && f.layout !== "meet" && f.kind !== "ask" && f.kind !== "stall" && a.loc === "home" && !a.moving && a.par === fl.F) {
      const u = dev.has("monday") ? now % 600 : now - Es.t0, ph = (u + fnv(f.sid) % 9) % 40, o = JSON.parse(a.pose);
      if (u < 600 && ph < 2.6 && o.seated && !o.arms && o.mouth !== "o") { h.setP(a, Object.assign(o, { eyes: "c", mouth: "o", arms: "r" })); yw = true; }
    }
    sty(E.sw, "display", sw ? "block" : "none"); if (sw) { sty(E.sw, "left", (a.w - 12) + "px"); sty(E.sw, "top", (anim && Math.floor(tc * 2) % 2 ? 2 : 6) + "px"); }
    sty(E.yw, "display", yw ? "block" : "none"); if (yw) { txt(E.yw, X("하암~", "yawn~")); sty(E.yw, "left", "-26px"); }   // 머리 왼쪽(오른쪽은 코드 조각·🔋 자리)
  }
  /* 요일·시각 판정은 본체 frame 맨 앞에서(경계에서 한 프레임 늦지 않게: setP·actor가 같은 프레임에 씀) */
  function pre() { const now = ctx.now(); T_.fri = dev.has("friday") || T_.friday(now); T_.mon = dev.has("monday") || T_.monday(now); }
  return { read, build, frame, actor, pre };
}

C.registerMode({
  id: "studio",
  /* 🙈 눈치 화면 구석 고양이(코어가 다른 모드에서도 빌려 씀): 앉아서 조는 고양이 · 눈 뜨고 팔 든 고양이(쉿), 2배 */
  nunchiCat: doc => ({ idle: sprite(doc, BYID.cat, { view: "front", seated: 1, eyes: "c", prov: "claude", trim: 1 }, 2), hover: sprite(doc, BYID.cat, { view: "front", seated: 1, eyes: "o", arms: "r", prov: "claude", trim: 1 }, 2) }),
  texts: {
    done: s => [bigOf(s) ? `🎉 ${s.project} 큰 일 완료!` : `✅ ${s.project} 완료`, s.source === "mcp" && s.prompt ? `✍️ ${C.provider(C.state, s).name}: ${s.prompt}` : s.prompt || ""],   // AI가 쓴 제목은 출처를 붙여서
    title: ({ calling, working, total }) => calling ? `(${calling}) ❓ 사장님, 질문 있어요` : working ? `🏢 ${working}명 일하는 중` : "🏢 스튜디오",
  },
  mount(root, ctx) {
    if (!ctx.isMain) return mountLobby(root, ctx);   // 작은 창(앱 위젯·PiP) = 미니 보기
    const doc = ctx.doc, win = ctx.win, $ = s => root.querySelector(s);
    const X = (ko, en) => ctx.lang === "en" ? en : ko;
    const aName = id => NAME[id][ctx.lang === "en" ? 1 : 0];
    const clockT = () => win.performance.now() / 1000;
    const mkEl = (tag, cls, p, css, html) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); if (html != null) e.innerHTML = html; if (p) p.appendChild(e); return e; };
    const sty = (e, k, v) => { const c = e._s || (e._s = {}); if (c[k] !== v) { c[k] = v; e.style[k] = v; } };
    const txt = (e, v) => { if (e._t !== v) { e._t = v; e.textContent = v; } };
    const html = (e, v) => { if (e._h !== v) { e._h = v; e.innerHTML = v; } };
    const canTerm = typeof ctx.api.openTerminal === "function";

    /* ---------- 저장 (ctx.store) ---------- */
    const DEF = () => ({ funds: 0, earned: 0, dones: {}, dex: {}, shop: {}, rep: {}, tok: { avg: 0, n: 0 }, paid: {}, day: { d: ymd(), earned: 0 }, paceSecs: 0 });
    const readJson = (k, d) => { try { const j = JSON.parse(ctx.store.get(k, "") || "null"); return j && typeof j === "object" ? j : d; } catch { return d; } };
    const sv = Object.assign(DEF(), readJson("save", {}));
    const cfg = Object.assign({ animals: SP.slice(), fixed: null, sound: true, frags: true, weather: false, hideText: false }, readJson("cfg", {}));   // hideText: 🤫 프로젝트·작업 문구 숨김(미니 보기도 같은 cfg)
    if (!Array.isArray(cfg.animals) || !cfg.animals.some(a => SP.includes(a))) cfg.animals = SP.slice();
    let dirty = false;
    const saveSoon = () => { dirty = true; };
    const flush = () => { if (!dirty) return; dirty = false; try { ctx.store.set("save", JSON.stringify(sv)); } catch {} };
    const saveCfg = () => { try { ctx.store.set("cfg", JSON.stringify(cfg)); } catch {} };
    if (sv.day.d !== ymd()) sv.day = { d: ymd(), earned: 0 };

    /* ---------- 상태 파생 ---------- */
    const isStall = s => !!(s.health && s.health.level === "stall");
    const animalOf = sid => {
      const pool = cfg.animals.filter(a => SP.includes(a));
      return { id: TINY.dev.has("oct") ? "oct" : cfg.fixed && SP.includes(cfg.fixed) ? cfg.fixed : (pool.length ? pool : SP)[fnv(sid) % (pool.length || SP.length)], shiny: fnv(sid + "*") % 64 === 0 };
    };
    const wbT = WB.tracker(), aiT = WB.aiTracker();
    function classify(s, st, now) {
      const status = C.sessionStatus(s, now);
      const kind = status === "needs_input" ? "ask" : isStall(s) ? "stall" : status === "working" ? "work" : status === "agents" ? "agents" : status === "done" ? "done" : "idle";
      const rank = { ask: 0, stall: 1, work: 2, agents: 2, done: 3, idle: 4 }[kind];
      const ag = C.can(st, s, "subagents") ? (s.agents || []).filter(a => a.status === "running") : [];
      const pid = C.provider(st, s);
      const an = animalOf(s.sid), pk = provKey(pid.id), agAll = C.can(st, s, "subagents") ? s.agents || [] : [];
      wbT.update(s.sid, agAll, clockT(), firstSync, an.id);   // 🧑‍🏫 화이트보드 팀(끝낸 아기도 팀이 끝날 때까지 회의 배치 유지)
      const layout = ag.length || wbT.meeting(s.sid, clockT()) ? "meet" : "desk";
      /* ✍️ AI 보드: 책상 배치일 때만(서브에이전트 회의 보드가 우선 — 회의가 끝나 책상으로 돌아오면 다시 써 내려감) */
      const aib = layout === "desk" && aibOn(s, kind, now);
      aiT.update(s.sid, aib ? boardOf(s) : null, clockT(), firstSync);
      return { s, sid: s.sid, kind, rank, status, ag, agAll, layout, aib, rep: repOf(s),
        animal: an.id, shiny: an.shiny, pk, pname: pid.name, label: `${an.shiny ? "✨" : ""}${aName(an.id)}·${pid.name}` };
    }
    let model = { floors: [], more: 0, hiddenAsk: 0, all: [], st: null }, floorIdx = new Map();
    let cheer = null, cheerAt = -1e9, hovCap = null, hovJump = null, bossFree = -1e9;   // 🎉 사장님 축하 말풍선 · ✍️ 마우스를 올린 층(하단 캡션)
    const cheerSeen = new Set();
    let lastState = null, firstSync = true, visitor = null;
    const prevRaw = new Map(), logs = [], actors = new Map();
    const pushLog = (icon, text) => { const t = ctx.now(); logs.unshift({ t, icon, text }); if (logs.length > 30) logs.pop(); };
    const stateAge = () => Math.max(0, ctx.now() - (lastState ? lastState.now : ctx.now()));

    /* ---------- 액터 ---------- */
    function mkActor(ch, opt) {
      const a = { ch, opt, scale: opt.scale || S, par: null, pose: "", w: 0, h: 0, sp: null };
      a.el = mkEl("div", "ch"); a.img = mkEl("img", "", a.el);
      a.tag = mkEl("div", "tag", a.el, { background: opt.color || "#34457f" }, esc((opt.shiny ? "✨" : "") + opt.label));
      a.bub = mkEl("div", "bub", a.el);
      if (opt.shiny) [["6%", "4%"], ["78%", "0%"], ["88%", "46%"]].forEach(([l, t], i) => mkEl("i", "spk", a.el, { left: l, top: t, animationDelay: (i * .37) + "s" }, "✦"));
      a.img.alt = ""; a.img.draggable = false;
      return a;
    }
    function setP(a, p) {
      const o = Object.assign({ prov: a.opt.prov, shiny: a.opt.shiny, baby: a.opt.baby, boss: a.opt.boss }, p, TINY.fri && !a.opt.boss ? { aloha: 1 } : null), k = JSON.stringify(o);   // 🌺 금요일 오후 셔츠
      if (a.pose !== k) { a.pose = k; const s = sprite(doc, a.ch, o, a.scale); a.img.src = s.url; a.img.style.width = s.w + "px"; a.img.style.height = s.h + "px"; a.w = s.w; a.h = s.h; a.sp = s; }
    }
    function put(a, parent, x, feet, o = {}) {
      if (a.par !== parent) { parent.appendChild(a.el); a.par = parent; }
      if (o.lying) {
        sty(a.el, "left", (x - a.w / 2) + "px"); sty(a.el, "top", (feet - a.w / 2 - a.h / 2) + "px");
        sty(a.img, "transformOrigin", "50% 50%"); sty(a.img, "transform", `rotate(-90deg) scale(${o.sc || 1})`);
      } else {
        sty(a.el, "left", (x - a.w / 2) + "px"); sty(a.el, "top", (feet - a.h + (o.dy || 0)) + "px");
        sty(a.img, "transformOrigin", "50% 100%");
        sty(a.img, "transform", (o.flip ? "scaleX(-1) " : "") + (o.rot ? `rotate(${o.flip ? -o.rot : o.rot}deg)` : ""));
      }
      sty(a.bub, "bottom", ((o.lying ? a.w : a.h) + (a.tag.style.display === "none" ? 8 : 24)) + "px");
    }
    function bubble(a, h, on) { sty(a.bub, "display", on ? "block" : "none"); if (on) html(a.bub, h); }
    const tagOn = (a, on) => sty(a.tag, "display", on && !(nSess >= 6 && !a.opt.boss) ? "" : "none");
    function dropActor(a) { if (a.el.parentNode) a.el.parentNode.removeChild(a.el); a.par = null; if (a.babies) a.babies.forEach(b => b.el.parentNode && b.el.parentNode.removeChild(b.el)); }
    function actorFor(f) {
      let a = actors.get(f.sid);
      const opt = { prov: f.pk, shiny: f.shiny, label: `${aName(f.animal)}·${f.pname}`, color: PROV[f.pk].tag };
      if (a && (a.ch.id !== f.animal || a.opt.shiny !== f.shiny || a.opt.prov !== f.pk || a.opt.label !== opt.label)) {
        dropActor(a); actors.delete(f.sid); a = null;
        if (car.owner && car.owner.sid === f.sid) car.owner = null;
      }
      if (!a) {
        a = mkActor(BYID[f.animal], opt);
        Object.assign(a, { sid: f.sid, loc: "home", x: null, moving: false, flip: false, goal: "home", askAt: -99, thanksT: null, launchUntil: 0, launchStart: 0, keyAt: 0, keyBurst: 0, fragAt: 0, babies: [], lastKind: "other", lastTxt: "", lift: null, nx: null });
        if (NX.hidden || NX.mode === "leave") Object.assign(a, { loc: "out", goal: "out" });   // 🙈 블라인드 뒤에 새로 온 세션도 "퇴근" 상태로
        actors.set(f.sid, a);
      }
      return a;
    }

    /* ---------- 엘리베이터: 한 대가 층마다 부른 직원을 태우고 내려 준다(질문하러 갈 때·돌아갈 때·🙈 눈치 모드 퇴장·출근) ----------
       직원: a.lift = "walk"(기다리는 자리로 감) → "wait"(자리에서 엘리베이터 쪽을 보고 기다림 = 부름) → "board"(차가 서서 문이 열리면 E_X로 들어감) → loc "car"(a.slot).
       차: idle → move(가장 가까운 같은 방향 정류장, 없으면 반대 방향 끝 호출로 = 엘리베이터 SCAN) → open → hold(내리고 타기) → close → …
       문은 그 층에 기다리는 사람이 자리에 도착한 다음에 열린다. 목적지: goal home = 자기 층, boss·out = 1층 */
    const car = { row: 0, st: "idle", t: 0, door: 0, owner: null, dir: 0, exitAt: 0 };
    let nSess = 1;      // 사람이 있는 층 수 (1층 사장실은 인덱스 nSess)
    const homeIdx = a => { const i = floorIdx.get(a.sid); return i == null ? 0 : i; };
    const destOf = a => a.goal === "home" ? homeIdx(a) : nSess;
    const fromOf = a => a.loc === "boss" ? nSess : homeIdx(a);
    const liftX = (fi, k) => (fi === nSess ? LIFT_1F : model.floors[fi] && model.floors[fi].layout === "meet" ? LIFT_MEET : LIFT_STAFF) - k * LIFT_GAP;
    const fastLift = () => !!NX.mode;   // 눈치 모드 연출은 빠르게(퇴장 1~2초 안에)
    /* 엘리베이터까지 걷기: 기다리는 자리(줄 순서 a.qk) → 차가 서서 문이 열리면 E_X로 */
    function liftWalk(a, fi, d) {
      if (a.lift === "board") { moveX(a, E_X, d * 1.3); return; }
      if (!a.lift) { a.lift = "walk"; a.liftAt = clockT(); }
      moveX(a, liftX(fi, a.qk || 0), d);
      if (!a.moving) { a.lift = "wait"; a.flip = false; }   // 엘리베이터 쪽을 봄
    }
    function carStep(dt, tc) {
      const all = [...actors.values()], fast = fastLift(), TD = fast ? .12 : .5, SPD = fast ? 7 : 1.7;
      const riders = all.filter(a => a.loc === "car"), calls = all.filter(a => a.lift && a.loc !== "car");
      car.owner = riders[0] || calls[0] || null;   // 쓰는 중이면 👆 엘리베이터 호출은 양보
      /* 줄 순서: 같은 층에서 먼저 온 순 */
      const byRow = new Map();
      calls.sort((p, q) => (p.liftAt || 0) - (q.liftAt || 0)).forEach(a => { const r = fromOf(a), k = byRow.get(r) || 0; a.qk = k; byRow.set(r, k + 1); });
      const here = r => Math.abs(car.row - r) < 1e-3;
      const dirOf = a => Math.sign(destOf(a) - fromOf(a)) || 1;
      const move = tgt => { const d = tgt - car.row; if (Math.abs(d) < 1e-3) { car.row = tgt; return true; } car.row += Math.sign(d) * Math.min(Math.abs(d), SPD * dt); return Math.abs(tgt - car.row) < 1e-3; };
      function next() {   // SCAN: 가는 방향 앞의 정류장(내릴 층·같은 방향 호출) → 없으면 그 방향 끝의 반대 호출 → 없으면 방향을 바꿈
        const r = car.row, reqs = riders.map(a => ({ row: destOf(a), dir: 0 })).concat(calls.map(a => ({ row: fromOf(a), dir: dirOf(a) })));
        if (!reqs.length) return null;
        if (reqs.some(q => here(q.row))) return car.row;
        if (!car.dir) car.dir = Math.sign(reqs[0].row - r);
        for (let pass = 0; pass < 2; pass++) {
          const d = car.dir, ahead = q => d > 0 ? q.row > r : q.row < r;
          const same = reqs.filter(q => ahead(q) && (q.dir === 0 || q.dir === d)).map(q => q.row);
          if (same.length) return d > 0 ? Math.min(...same) : Math.max(...same);
          const opp = reqs.filter(q => ahead(q)).map(q => q.row);
          if (opp.length) return d > 0 ? Math.max(...opp) : Math.min(...opp);
          car.dir = -d;
        }
        return null;
      }
      const row = Math.round(car.row);
      switch (car.st) {
        case "idle": case "move": {
          const tgt = next();
          if (tgt == null) { car.st = "idle"; car.dir = 0; car.door = Math.max(0, car.door - dt / .5); return; }
          if (car.door > 0) { car.door = Math.max(0, car.door - dt / TD); return; }
          car.st = "move";
          if (move(tgt)) {
            /* 문은 이 층에서 기다리는 사람이 자리에 온 뒤에 연다(오는 중이면 닫힌 채 기다림) */
            const r2 = Math.round(car.row);
            if (riders.some(a => destOf(a) === r2) || calls.some(a => fromOf(a) === r2 && a.lift === "wait")) { car.st = "open"; car.t = 0; }
          }
          break;
        }
        case "open": car.t += dt; car.door = ease(car.t / TD); if (car.t >= TD) { car.st = "hold"; car.t = 0; car.exitAt = 0; } break;
        case "hold": {
          car.t += dt; car.door = 1;
          /* 내리기: 한 명씩(.2초 간격) */
          const off = riders.filter(a => destOf(a) === row);
          if (off.length && car.t >= car.exitAt) { const a = off[0]; a.loc = row === nSess ? "boss" : "home"; a.x = E_X; a.moving = false; a.flip = true; a.lift = null; car.exitAt = car.t + (fast ? .14 : .25); }
          /* 타기: 이 층에서 기다리는 사람 중 차와 같은 방향(빈 차면 누구든) */
          const left = riders.filter(a => destOf(a) !== row);
          const dir = left.length ? Math.sign(destOf(left[0]) - row) : 0;
          for (const a of calls) if (fromOf(a) === row && a.lift !== "board" && (!dir || dirOf(a) === dir)) a.lift = "board";   // 문이 열려 있으면 오던 사람도 바로 탐
          for (const a of calls) if (a.lift === "board" && a.x === E_X) { a.loc = "car"; a.lift = null; a.slot = riders.length + calls.filter(b => b.loc === "car").length; a.moving = false; }
          const busy = off.length || calls.some(a => a.lift === "board") || (NX.hold && NX.hold(row));
          if (!busy && car.t >= (fast ? .1 : .35)) { car.st = "close"; car.t = 0; const rs = [...actors.values()].filter(a => a.loc === "car"); car.dir = rs.length ? Math.sign(destOf(rs[0]) - row) : 0; }
          break;
        }
        case "close":
          car.t += dt; car.door = 1 - ease(car.t / TD);
          {   // 닫히는데 같은 방향(빈 차면 누구든)으로 갈 사람이 오면 다시 열림 — 반대 방향 대기자로는 열지 않음(무한 재열림 방지)
            const rs = riders.filter(a => destOf(a) !== row), dir = rs.length ? Math.sign(destOf(rs[0]) - row) : 0;
            if (calls.some(a => fromOf(a) === row && a.lift === "wait" && (!dir || dirOf(a) === dir))) { car.st = "open"; car.t = TD * car.door; break; }
          }
          if (car.t >= TD) { car.st = "move"; car.door = 0; }
          break;
      }
    }

    /* ---------- 장면 만들기 (층 구성이 바뀔 때만 다시 만든다) ---------- */
    root.innerHTML = `<div class="stu">
      <div class="hud">
        <div class="hb logo"><span style="font-size:22px">🏢</span><div><div class="nm">Waitscape Studio</div><small class="t-tag"></small></div><span class="lv">Lv.1</span></div>
        <div class="hb money"><span style="font-size:20px">💰</span><div><small class="t-money"></small><div class="v">0</div></div></div>
        <div class="hb rep"><span style="font-size:20px">⭐</span><div><small class="t-rep"></small><div class="v2" style="color:#c9840f"></div></div></div>
        <div class="hb pow"><span style="font-size:20px">⚡</span><div style="flex:1;min-width:0"><small class="pw-h"></small><div style="display:flex;align-items:center;gap:6px"><div class="gauge"><i class="seg"></i><u></u></div><span class="v2 pw-v"></span></div></div></div>
        <div class="hb wk"><span style="font-size:20px">📅</span><div style="flex:1;min-width:0"><small class="t-wk"></small><div style="display:flex;align-items:center;gap:6px"><div class="gauge"><i class="seg" style="background:#5aa8ff"></i></div><span class="v2 wk-v"></span></div></div></div>
        <div class="hb askchip blink" hidden></div>
        <div class="hsp"></div>
        <button class="tbtn" data-act="dr-go" type="button" hidden></button>
        <button class="tbtn" data-act="dr-card" type="button" hidden></button>
        <button class="tbtn" data-act="decor" type="button"></button>
        <button class="tbtn" data-act="sound" type="button"></button>
        <button class="tbtn" data-act="quiet" type="button"></button>
        <button class="tbtn" data-act="dex" type="button"></button>
        <button class="tbtn sidebtn" data-act="side" type="button">📋</button>
      </div>
      <div class="main">
        <div class="view"><div class="sc"><div class="bld"></div></div></div>
        <button class="tbtn minibtn" data-act="mini" type="button" hidden></button>
        <aside class="side"></aside>
        <div class="dex"><div class="win"></div></div>
      </div>
    </div>`;
    const app = $(".stu"), hud = $(".hud"), view = $(".view"), sc = $(".sc"), bld = $(".bld"), side = $(".side"), dexEl = $(".dex");
    hud.appendChild(ctx.switcher);
    mkEl("div", "sun", view); mkEl("div", "hill", view, { left: "-40px", width: "420px", height: "90px" }); mkEl("div", "hill", view, { right: "-60px", width: "520px", height: "120px", background: "" }); mkEl("div", "ground", view);
    [["🕊️", 40, 0], ["🕊️", 70, -20], ["🕊️", 25, -35]].forEach(([e, t, d], i) => mkEl("div", "bird", view, { top: t + "px", animationDelay: d + "s", animationDuration: 55 + i * 12 + "s" }, e));
    [[8, 60, 70], [34, 150, 56], [18, 250, 80], [12, 420, 64], [46, 330, 48]].forEach(([t, l, w], i) => mkEl("div", "cloud", view, { top: t * 3 + "px", left: l * 2 + "px", width: w + "px", animationDelay: -i * 30 + "s", animationDuration: 90 + i * 35 + "s" }));
    view.insertBefore(sc, null);
    const pwB = powerBig({ doc, win, mkEl, sty, txt, html, X, view, hud, cfg: () => cfg });   // 전력·날씨
    const pkB = pokeBig({ ctx, doc, win, mkEl, sty, html, X, view, main: $(".main"), cfg, car, actors, setP, canTerm, clockT, model: () => model, bossAct: () => bossAct, owned: id => owned(id), noPlant: f => dcB.noPlant(f),   // 👆 클릭 반응 (🎨 바닥 2에 소품이 있으면 화분 자리를 비킴)
      vendEl: i => pwB.vendEl(i), vOff: () => pwB.vOff(), scale: () => scaleK, anim: () => animOn(), askb: () => askb, kick: () => { if (!animOn()) staticDraw(); }, hud: () => renderHud(),
      resetIn: () => { const l = C.limits(ctx.state, ctx.now()).five; return l && l.reset ? Math.max(0, l.reset - ctx.now()) : null; } });
    const drB = dayrepBig({ ctx, doc, win, mkEl, sty, txt, html, X, view, cfg, saveCfg, clockT, actors, mkActor, setP, put, bubble, tagOn, dropActor, animalOf,   // 📋 퇴근 일보
      box: (...a) => box(...a), parentFor: (...a) => parentFor(...a), model: () => model, n: () => nSess, bossAct: () => bossAct, floorOf: sid => floorIdx.get(sid),
      provName: id => C.provider(ctx.state, { provider: id }).name, anim: () => animOn(), kick: () => { if (!animOn()) staticDraw(); }, hud: () => renderHud() });
    const dcB = decorBig({ ctx, doc, win, mkEl, sty, txt, html, X, app, main: $(".main"), actors, aName, clockT, model: () => model, n: () => nSess,   // 🎨 층 꾸미기
      lv: () => lvOf(), funds: () => sv.funds, spend: v => { sv.funds -= v; saveSoon(); }, saveNow: () => { dirty = true; flush(); }, log: pushLog, hideText: () => !!cfg.hideText,
      money: () => HUDQ.money, kick: () => { if (!animOn()) staticDraw(); }, hud: () => renderHud(), layout: () => layout(), rebuild: () => { buildSig = ""; sync(); } });
    const tnB = tinyBig({ ctx, doc, mkEl, sty, html, X, clockT, kick: () => { if (!animOn()) staticDraw(); }, floors: () => model.floors, hidden: () => !!(NX.hidden || NX.mode), askOn: () => !!askb && askb.style.display !== "none", actors, dr: () => drB.active(), setP, put, txt, view, wk: () => pwB.wk(), night: () => pwB.night(), out: () => pwB.out(), door: () => car.door, boss: () => bossAct, cof: () => pkB.bossCof(), pkBub: () => pkB.bossBub() });   // ☕ 깨알 디테일: 빈 잔 · 연속 출근 달력 · 야간 경비 고양이 · 🗂️ 책상 묶음(서류·겉옷·깃발·로봇 배터리)
    const pwWins = [];

    let FL = [], FT = [], FH = [], BASE = [], carEl, dl, dr, lamp, banner, plusEl, confs = [], askb, bossFl, moreEl, scaleK = 1, sceneH = 0, buildSig = "";
    const OY = 6;
    const box = (p, x, y, w, h, bg, o) => mkEl("div", "b", p, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: h + "px", background: bg, zIndex: 2 }, o || {}));
    const bx = (p, x, y, w, h, bg, bd, z) => box(p, x, y, w, h, bg, { border: "3px solid " + (bd || "#4a3560"), zIndex: z || 1 });
    const emo = (p, x, y, size, e, z) => mkEl("div", "b", p, { left: x + "px", top: y + "px", fontSize: size + "px", zIndex: z || 10, lineHeight: 1 }, e);
    const win_ = (f, x, y, w, h) => { const el = bx(f, x, y, w, h, "#9fdcff", "#4a3560", 2); box(f, x + w / 2 + 1, y, 3, h, "#4a3560", { zIndex: 3 }); pwWins.push({ f, x, y, w, h, el, gl: box(f, x + 8, y + 8, 16, 8, "#fff", { zIndex: 3 }) }); return el; };
    const owned = id => !!sv.shop[id];

    function deskFront(f, B, cx, who) {
      const chx = cx - 35, r = { chx, B };
      bx(f, chx - 26, B - 58, 52, 58, T.chair, "#4a3560", 4);
      bx(f, cx - 95, B - 26, 200, 10, T.deskTop, "#4a3560", 9); bx(f, cx - 90, B - 17, 190, 17, T.desk, "#4a3560", 9); box(f, cx + 50, B - 14, 30, 10, "#b07848", { border: "2px solid #4a3560", zIndex: 10 });
      box(f, chx - 26, B - 32, 52, 7, "#5a5a78", { border: "2px solid #2e2040", zIndex: 10 });
      r.mon = bx(f, cx + 24, B - 92, 68, 52, "#2e2a40", "#4a3560", 8); box(f, cx + 52, B - 40, 12, 14, "#4a3560", { zIndex: 8 });
      const s = box(f, cx + 29, B - 87, 58, 40, "#16213a", { zIndex: 9, overflow: "hidden" });
      s.lines = []; for (let k = 0; k < 5; k++) s.lines.push(box(s, 3, 3 + k * 7, 20, 3, "#7dff9c"));
      r.sc = s;
      const h = BYID[who || "ham"].hands;
      r.hands = [0, 1].map(k => box(f, chx - 24 + k * 26, B - 40, h.w > 16 ? 20 : 16, 12, h.c, { border: "3px solid #4a3560", zIndex: 12 }));
      box(f, chx - 18, B - 29, 36, 5, "#3a3a52", { border: "1px solid #1e1830", zIndex: 11 });
      return r;   // 커피 잔은 👆 POKE가 도트 머그로 그림(누르면 김·하트·카페인)
    }
    function leftDecor(F, v, B) {   // 반환: 👆 POKE가 쓰는 책장·서버랙 참조(책 15권 · LED 8개)
      win_(F, 150, 34, 90, 56);
      const r = { deco: v, books: [], leds: [], ledC: [] };
      if (v === 0) { Object.assign(r, { el: bx(F, 24, 30, 70, 92, "#b8794b"), x: 24, y: 30, w: 76, h: 98 }); for (let k = 0; k < 3; k++) { box(F, 30, 44 + k * 27, 58, 3, "#4a3560"); for (let j = 0; j < 5; j++) r.books.push(box(F, 32 + j * 10, 30 + k * 27, 7, 14, ["#ff6b8a", "#5aa8ff", "#ffd23f", "#6adf8a", "#b48aff"][(j + k) % 5], { border: "2px solid #4a3560" })); } }
      else if (v === 1) { Object.assign(r, { el: bx(F, 24, 26, 76, 96, "#5a6078"), x: 24, y: 26, w: 82, h: 102 }); for (let k = 0; k < 4; k++) { box(F, 30, 34 + k * 21, 64, 13, "#2e3248", { border: "2px solid #1a1a28" }); r.ledC.push(k % 2 ? "#6adf8a" : "#ff6b6b", "#6adf8a"); r.leds.push(box(F, 34, 38 + k * 21, 5, 5, k % 2 ? "#6adf8a" : "#ff6b6b"), box(F, 44, 38 + k * 21, 5, 5, "#6adf8a")); } }
      else { Object.assign(r, { el: bx(F, 24, 30, 70, 92, "#9aa0b8"), x: 24, y: 30, w: 76, h: 98 }); for (let k = 0; k < 3; k++) emo(F, 32, 34 + k * 28, 20, "📚📚📖", 2); }
      return r;
    }
    function decorFloor(F, B, boss, meet) {
      /* 화분·벽시계는 👆 POKE가 도트로 그림(상점 화분 = 큰 화분 · 상점 벽시계 = 금테 시계) */
      /* 1층 액자·커피머신은 🙈 현관문(DOOR_X) 자리를 비켜 창 아래쪽에 */
      if (owned("frame")) emo(F, boss ? 292 : 300, boss ? 44 : 40, 30, "🖼️", 3);
      if (owned("coffee") && !meet) { if (boss) { bx(F, 392, B - 46, 30, 46, "#4a4a62", "#2e2040", 5); box(F, 398, B - 40, 18, 10, "#16213a", { zIndex: 6 }); box(F, 402, B - 24, 10, 10, "#ff6b6b", { zIndex: 6 }); emo(F, 396, B - 70, 18, "☕", 6); } else { bx(F, 286, B - 46, 30, 46, "#4a4a62", "#2e2040", 5); box(F, 292, B - 40, 18, 10, "#16213a", { zIndex: 6 }); box(F, 296, B - 24, 10, 10, "#ff6b6b", { zIndex: 6 }); emo(F, 290, B - 70, 18, "☕", 6); } }
      if (boss) {
        if (owned("plush")) emo(F, 40, B - 54, 26, "🧸", 11);
        if (owned("neon")) mkEl("div", "b nsign", F, { left: "136px", top: "46px", zIndex: 3 }, "OPEN");
        if (owned("trophy")) emo(F, 138, B - 58, 28, "🏆", 11);
      }
    }
    /* 엘리베이터 호출 버튼 ▲▼: 그 층에서 기다리는 사람이 있으면 가는 방향이 켜짐 */
    function hallBuild(F, B) { const e = mkEl("div", "b hall", F, { left: "658px", top: (B - 78) + "px" }); return { e, u: mkEl("i", "u", e), d: mkEl("i", "d", e) }; }
    /* 🙈 1층 현관문: 나무 문(왼쪽 경첩으로 열림) · 문 밖 하늘·잔디·구름·덤불 · 문 위 종 · 매트. 누르면 종만 딸랑 */
    function nxDoorBuild(F, B) {
      const d = {};
      d.frame = box(F, DOOR_X, B - 94, DOOR_W, 94, "#8a5a3a", { border: "3px solid #4a3560", zIndex: 3 });
      d.out = mkEl("div", "b nxout", F, { left: (DOOR_X + 6) + "px", top: (B - 88) + "px", width: (DOOR_W - 12) + "px", height: "88px", zIndex: 3 });
      mkEl("i", "nx-cloud", d.out); mkEl("i", "nx-bush", d.out);
      d.panel = mkEl("div", "b nxpanel", F, { left: (DOOR_X + 6) + "px", top: (B - 88) + "px", width: (DOOR_W - 12) + "px", height: "88px", zIndex: 4 });
      [8, 46].forEach(y => mkEl("i", "nx-dp", d.panel, { top: y + "px" }));
      mkEl("i", "nx-dk", d.panel);
      const s = nxPix(doc, "bell", 2);
      d.bell = mkEl("img", "b nxp", F, { left: (DOOR_X + DOOR_W - 12) + "px", top: (B - 104) + "px", width: s.w + "px", height: s.h + "px", zIndex: 5, transformOrigin: "50% 0" }); d.bell.src = s.url; d.bell.alt = "";
      box(F, DOOR_X - 6, B - 4, DOOR_W + 12, 5, "#c85a6a", { zIndex: 5, borderTop: "2px solid #8a2d3c" });
      d.hit = mkEl("div", "b", F, { left: DOOR_X + "px", top: (B - 104) + "px", width: DOOR_W + "px", height: "100px", zIndex: 6, cursor: "pointer" }); d.hit.dataset.act = "nxdoor";
      d.hit.setAttribute("aria-label", X("현관문", "Front door"));
      return d;
    }
    function nxDoorDraw(d, k, tc, anim) {
      sty(d.panel, "width", Math.round((DOOR_W - 12) * (1 - .82 * ease(k))) + "px");
      d.panel.classList.toggle("open", k > .4);
      const u = tc - NX.bellT, a = anim && u < 1.2 ? Math.sin(u * 22) * 26 * Math.exp(-u * 3.4) : 0;   // 종: 딸랑 흔들리다 멎음
      sty(d.bell, "transform", `rotate(${a.toFixed(1)}deg)`);
    }
    function mkSign(F, x) { const s = mkEl("div", "sign", F, { left: x + "px", top: "40px", transition: "none" }); s.fresh = true; s.t = mkEl("div", "", s); s.p = mkEl("div", "pips", s); for (let k = 0; k < 5; k++) mkEl("i", "", s.p); return s; }   // 새로 지은 표지판은 첫 프레임에 접힌 채로 바로(전환 없이)

    function build() {
      const fl = model.floors, n = nSess;
      for (const a of actors.values()) { a.par = null; a.babies.forEach(b => (b.par = null)); }
      if (bossAct) bossAct.par = null;
      bld.textContent = ""; pwWins.length = 0;
      FH = Array.from({ length: n + 1 }, (_, i) => i === n ? FHB : n >= 6 ? 120 : FHS);
      FT = [40 + OY]; for (let i = 1; i <= n; i++) FT[i] = FT[i - 1] + FH[i - 1];
      BASE = FH.map(h => h - 8);
      sceneH = FT[n] + FH[n] + 4;
      box(bld, 0, 18 + OY, 860, 22, T.roof, { border: "3px solid #4a3560", zIndex: 5 });
      mkEl("div", "sign", bld, { left: "28px", top: (-6 + OY) + "px", fontSize: "var(--f14)", zIndex: 7, background: "#ffd23f", maxWidth: "none" }, "🏢 Waitscape Studio");
      emo(bld, 760, OY - 6, 26, "🚩", 7);
      moreEl = mkEl("div", "more", bld, { top: (OY - 8) + "px", }); moreEl.hidden = true;
      FL = [];
      for (let i = 0; i <= n; i++) {
        const f = fl[i], boss = i === n, B = BASE[i], h = FH[i];
        const w = f ? fnv(f.sid) % 5 : i % 5;
        const F = mkEl("div", "fl", bld, { top: FT[i] + "px", height: h + "px", background: `linear-gradient(${WALLS[w]} 0 ${h - 46}px,${WALL_LO[w]} ${h - 46}px)` });
        mkEl("div", "slab", F);
        box(F, 0, h - 52, 860, 4, "rgba(74,53,96,.25)"); for (let x = 0; x < 860; x += 60) box(F, x, 0, 2, h - 52, "rgba(255,255,255,.35)", { zIndex: 0 });
        const r = { F, B, f, boss, desk: null, sign: null, tag: null, zs: [], sweat: null, tint: null };
        if (boss) {
          bossFl = r;
          win_(F, 330, 40, 100, 62); win_(F, 580, 40, 100, 62);
          bx(F, 36, B - 26, 264, 10, T.deskTop, "#4a3560", 9); bx(F, 42, B - 17, 252, 17, T.desk, "#4a3560", 9);
          r.mon = bx(F, 200, B - 98, 76, 56, "#2e2a40", "#4a3560", 8); box(F, 206, B - 92, 64, 44, "#16213a", { zIndex: 9 });
          for (let k = 0; k < 4; k++) box(F, 212, B - 86 + k * 9, [30, 44, 22, 36][k], 3, "#7dff9c", { zIndex: 10 });
          bx(F, 72, B - 58, 52, 32, "#5a5a78", "#2e2040", 4);
          r.cart = bx(F, 790, B - 62, 52, 62, "#ff6b8a", "#4a3560", 4); emo(F, 796, B - 52, 28, "🛒", 5);
          r.chx = 98;
          r.door = nxDoorBuild(F, B);   // 🙈 현관문(눈치 모드 퇴장·출근)
          const tg = mkEl("div", "ftag", F); tg.innerHTML = "<b></b><span></span><em></em>"; r.tag = tg;
          decorFloor(F, B, true, false);
        } else {
          const meet = f && f.layout === "meet", aib = !!(f && !meet && f.aib);
          if (aib) r.aib = aiBoardBuild(F, B);   // ✍️ AI가 쓴 보드가 책장·왼쪽 창 자리를 덮음(회의 보드와 같은 자리)
          else r.shelf = leftDecor(F, f ? fnv(f.sid) % 3 : 0, B);
          win_(F, 782, 38, 58, 50);
          if (meet) {
            r.wbd = boardBuild(F, B);   // 🧑‍🏫 화이트보드 · 테이블 · 시계 · 도넛 상자
            r.more = mkEl("div", "sign", F, { left: "578px", top: (B - 70) + "px", zIndex: 12, padding: "0 5px" }); r.more.hidden = true;
            r.mb = mkEl("div", "bub mbn", F, { left: "518px", display: "none", zIndex: 26, transform: "none" });   // 왼쪽 = 층 이름표 줄 끝 뒤(placeBabies)
          } else r.desk = deskFront(F, B, 420, f && f.animal);
          decorFloor(F, B, false, meet);
          if (f) {
            const go = el => { if (canTerm) { el.dataset.act = "jump"; el.dataset.sid = f.sid; el.dataset.jump = f.sid; } return el; };   // 🖥️ 누르면 그 세션으로(일하는 중에도)
            if (!meet) { r.sign = mkSign(F, SIGN_X); r.stp = go(mkEl("div", "b stp", F, { left: "450px", top: (B - 15) + "px", display: "none" })); r.stp.dataset.aicap = f.sid; }   // 책상 앞 단계 명패 "3/5"
            r.cap = mkEl("div", "aicap", F, { left: "34px", top: (B - 17) + "px", display: "none" });   // ✍️ 하단 캡션(명패·보드에 마우스를 올리면 AI가 쓴 제목 · 🖥️ 층 이름표·단계 명패면 이동 안내)
            const tg = go(mkEl("div", "ftag", F)); tg.innerHTML = "<b></b><span><i></i><i></i></span><em></em>"; r.tag = tg;   // span = 프로젝트 + "· 동물 · 프로바이더"(좁으면 뒤를 뺌, #64)
            r.tint = box(F, 0, 0, 860, h, "rgba(70,80,130,.18)", { zIndex: 15, pointerEvents: "none", display: "none" });
            r.zs = [0, 1, 2].map(() => mkEl("div", "z", F, { display: "none" }, "Z"));
            r.sweat = mkEl("div", "z", F, { fontSize: "22px", display: "none" }, "💧");
            r.gb = mkEl("div", "bub r", F, { left: "322px", top: (B - 104) + "px", width: "150px", display: "none" });
          }
          if (!f) mkEl("div", "empty", F, null, X("아직 출근한 직원이 없어요 🌙<br>Claude Code 등을 켜면 동물 직원이 출근해요", "No staff yet 🌙<br>Start an AI coding session and an animal clocks in"));
        }
        if (boss || f) r.hall = hallBuild(F, B);   // 엘리베이터 호출 버튼(통로 바로 왼쪽 벽)
        FL.push(r);
      }
      // 엘리베이터 통로 + 카 (모든 층 위로)
      const shaft = mkEl("div", "shaft", bld, { top: (40 + OY) + "px", height: (FT[n] + FH[n] - FT[0]) + "px" });
      carEl = mkEl("div", "car", shaft); lamp = mkEl("div", "lamp", carEl);
      dl = mkEl("div", "dr", carEl, { left: "0" }); dr = mkEl("div", "dr", carEl, { right: "0" });
      banner = mkEl("div", "banner", bld);
      plusEl = mkEl("div", "fx", bld, { fontWeight: 900, fontSize: "calc(20px*var(--inv))", color: "#e8a020", textShadow: "2px 2px 0 #2e2040", display: "none", whiteSpace: "nowrap" });
      confs = []; for (let i = 0; i < 24; i++) confs.push(mkEl("div", "fx", bld, { width: "8px", height: "8px", background: ["#ff6b8a", "#ffd23f", "#5aa8ff", "#6adf8a", "#b48aff"][i % 5], display: "none" }));
      askb = mkEl("div", "bub side ask", bld, { display: "none", zIndex: 70, pointerEvents: "auto" });
      fragEls.forEach(e => e.parentNode && e.parentNode.removeChild(e)); fragEls.length = 0; frags.length = 0;
      pwB.build({ bld, FL, FT, BASE, n, sceneH, wins: pwWins, roofY: 18 + OY });
      pkB.build({ bld, FL, FT, BASE, FH, n, carEl, wins: pwWins });   // 👆 누를 자리·효과 층
      drB.build({ bld, FL, FT, BASE, FH, n, carEl });   // 📋 불 끄기 덮개·1층 발표판·포인터·꽃가루·종이
      dcB.build({ FL, n });   // 🎨 칸마다 소품 · 꾸미기 칸 표시 · 다른 층 어둡게
      tnB.build({ FL, n, carEl });   // ☕ 빈 잔 · 📅 달력 · 🔦 1층 고양이
      layout();
    }

    function layout() {
      const narrow = app.clientWidth < 900;
      app.classList.toggle("narrow", narrow); app.classList.toggle("tiny", app.clientWidth < 560);
      if (!narrow) side.classList.remove("on");
      const th = dcB.trayH();   // 🎨 꾸미기 판이 열려 있으면 그만큼 건물을 아래로
      sty(view, "paddingTop", th ? th + "px" : ""); dcB.size(view.clientWidth);
      const W = view.clientWidth, H = view.clientHeight - th;
      if (!W || !H) return;
      const ws = 866, hs = sceneH || 700;
      let k = [3, 2, 1.5, 1.25, 1, .75, .5].find(s => s * ws <= W && s * hs <= H + 24);
      if (!k) k = Math.max(.25, Math.min(W / ws, H / hs));
      scaleK = k;
      sty(sc, "width", Math.round(ws * k) + "px"); sty(sc, "height", Math.round(hs * k) + "px");
      sty(bld, "transform", `scale(${k})`); bld.style.setProperty("--inv", String(Math.min(2, Math.max(1, 1 / k))));
      pwB.resize();
    }

    /* ---------- 소리: 키보드 타자 (Web Audio 합성, 작은 볼륨) ---------- */
    let noiseBuf = null, noiseAc = null, lastClick = 0;
    const soundOk = () => cfg.sound && !ctx.settings.quiet && !doc.hidden && !(ctx.nunchi && ctx.nunchi.on);   // 🙈 눈치 모드: 효과음 없음
    function keyClick(tc) {
      if (tc - lastClick < .045) return;
      const ac = ctx.audio();
      if (!ac || ac.state !== "running") return;
      lastClick = tc;
      try {
        if (noiseAc !== ac) {
          const len = Math.floor(ac.sampleRate * .05), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
          noiseBuf = b; noiseAc = ac;
        }
        const t = ac.currentTime, src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
        src.buffer = noiseBuf; src.playbackRate.value = .9 + Math.random() * .3;
        bp.type = "bandpass"; bp.frequency.value = 2200 + Math.random() * 2200; bp.Q.value = .9;
        g.gain.value = .05 + Math.random() * .03;
        src.connect(bp); bp.connect(g); g.connect(ac.destination); src.start(t); src.stop(t + .05);
        if (Math.random() < .35) {   // 바닥에 닿는 "탁"
          const o = ac.createOscillator(), g2 = ac.createGain();
          o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(80, t + .04);
          g2.gain.setValueAtTime(.03, t); g2.gain.exponentialRampToValueAtTime(.0001, t + .05);
          o.connect(g2); g2.connect(ac.destination); o.start(t); o.stop(t + .06);
        }
      } catch (e) { win.console.warn('studio key', e && e.message); }
    }
    function keyTick(a, tc) {
      if (tc < a.keyAt) return;
      if (a.keyBurst <= 0) { a.keyBurst = 6 + Math.floor(Math.random() * 10); a.keyAt = tc + .4 + Math.random() * .8; return; }
      a.keyBurst--; a.keyAt = tc + .06 + Math.random() * .1;
      if (soundOk()) keyClick(tc);
    }

    /* ---------- 코드 조각 (타이핑하는 머리 위로 날아오름) ---------- */
    const frags = [], fragEls = [];
    function spawnFrag(parent, x, y, kind, text) {
      if (frags.length >= 22) return;
      const pool = FRAGS[kind] || FRAGS.other;
      const t = (text && Math.random() < .38 && tokenFrom(text)) || pool[Math.floor(Math.random() * pool.length)];
      const e = fragEls.pop() || mkEl("div", "frag");
      e.className = "frag k-" + (FRAGS[kind] ? kind : "other"); e.textContent = t; e._s = {}; e.style.opacity = "0";
      parent.appendChild(e);
      frags.push({ e, parent, x, y, t0: clockT(), dx: (Math.random() - .5) * 46, rise: 40 + Math.random() * 26, life: 1.1 + Math.random() * .5 });
    }
    function stepFrags(tc) {
      for (let i = frags.length - 1; i >= 0; i--) {
        const f = frags[i], k = (tc - f.t0) / f.life;
        if (k >= 1) { f.e.parentNode && f.e.parentNode.removeChild(f.e); fragEls.push(f.e); frags.splice(i, 1); continue; }
        sty(f.e, "transform", `translate(${Math.round(f.x + f.dx * k)}px,${Math.round(f.y - f.rise * ease(k))}px) rotate(${Math.round(f.dx * k * .6)}deg)`);
        sty(f.e, "opacity", String(k < .15 ? k / .15 : k > .65 ? (1 - k) / .35 : 1));
      }
    }
    const kindOf = s => s.kind || (s.activity && s.activity.length ? ICON_KIND[s.activity[s.activity.length - 1].icon] : null) || "other";
    const lastAct = s => s.activity && s.activity.length ? s.activity[s.activity.length - 1] : null;

    /* ---------- 움직임 규칙 ---------- */
    const moveX = (a, tx, d) => { const dx = tx - a.x; if (Math.abs(dx) <= d) { a.x = tx; a.moving = false; return; } a.x += Math.sign(dx) * d; a.flip = dx < 0; a.moving = true; };
    function stepActor(a, f, dt, anim, tc) {
      const deskx = f.layout === "meet" ? BOARD_X : DESK_X;
      if (!anim) {   // 정지 모드: 목적지로 바로 이동
        a.moving = false; a.lift = null;
        if (a.goal === "out" || NX.hidden) { a.loc = "out"; return; }   // 🙈 블라인드 뒤: 모두 퇴근한 텅 빈 스튜디오
        if (a.nx && a.nx.carry) a.nx = null;
        if (a.goal === "boss" && tc - a.askAt > 0) { a.loc = "boss"; a.x = ASK_X; a.flip = true; } else { a.loc = "home"; a.x = a.restX != null ? a.restX : deskx; }
        if (a.goal === "home" && a.loc === "boss") a.loc = "home";
        return;
      }
      if (a.x == null) { a.x = deskx; a.loc = "home"; }
      if (a.loc === "car") return;   // 엘리베이터가 내려 줌(carStep)
      const d = 120 * dt, run = (NX.mode ? 330 : 120) * dt;
      /* 🙈 현관문: 밖(out) → 문으로 들어옴 / 문으로 나감 → 밖 */
      if (a.loc === "out") { if (a.goal !== "out" && a.nx && tc >= a.nx.inAt) { a.loc = "door"; a.nx.door = tc; a.nx.dir = "in"; NX.ring(tc); } return; }
      if (a.loc === "door") { if (tc - a.nx.door >= .26) { if (a.nx.dir === "out") a.loc = "out"; else { a.loc = "boss"; a.x = DOOR_CX; a.flip = false; a.moving = true; } } return; }
      if (a.goal === "out") {   // 🙈 퇴근: ❗(가방) → 엘리베이터 → 1층 → 현관문
        a.thanksT = null;
        if (tc < a.nx.at + .34) { a.moving = false; return; }   // ❗ 놀라서 가방을 챙기는 순간
        if (a.loc === "home") liftWalk(a, homeIdx(a), run);
        else if (a.loc === "boss") {
          if (a.lift) a.lift = null;
          moveX(a, DOOR_CX, run);
          if (!a.moving) { a.loc = "door"; a.nx.door = tc; a.nx.dir = "out"; NX.ring(tc); }
        }
        return;
      }
      const sp = a.nx && a.nx.carry ? 260 * dt : d;   // ☕ 출근하는 길은 조금 빠르게
      if (a.goal === "boss") {
        a.thanksT = null;
        if (a.loc === "home") {
          if (tc - a.askAt < 1.2) { a.moving = false; return; }          // 놀람(!) 연출
          liftWalk(a, homeIdx(a), d);
        } else if (a.loc === "boss") { a.lift = null; moveX(a, ASK_X, sp); if (!a.moving) a.flip = true; }   // ☕ 출근하자마자 커피를 든 채로 질문(해결되면 자리에 가서 내려놓음)
      } else if (a.loc === "boss") {
        if (!a.moving && a.x === ASK_X && a.thanksT == null) a.thanksT = tc;      // 해결 → 감사 인사
        if (a.thanksT != null && tc - a.thanksT < 1.8) { a.moving = false; return; }
        liftWalk(a, nSess, sp);
      } else if (a.loc === "home") {
        a.thanksT = null; a.lift = null;
        moveX(a, a.restX != null ? a.restX : deskx, a.nx && a.nx.carry ? 200 * dt : d);   // 🎨 쉴 때는 좋아하는 소품 옆으로
        if (!a.moving && a.nx && a.nx.carry) { a.nx = null; a.seatAt = tc; }   // 자리에 앉으면 커피는 책상에
      }
    }

    /* ---------- 🙈 눈치 모드 연출 (코어 core/nunchi.js가 부름: leave → hide → arrive | show) ----------
       퇴근(leave): 직원 goal "out" → ❗ 서류 가방 → 엘리베이터(맨 위층부터 태움) → 1층 → 현관문(loc "door" → "out") → 사장님 "🤫 쉿!" → 블라인드는 코어
       출근(arrive): loc "out" → 한 명씩 ☕ 들고 현관문 → 1층 엘리베이터(다 탈 때까지 열고 기다림) → 아래층부터 내려 줌 → 착석. 질문 있던 직원은 바로 사장님 앞
       긴 연출은 설정 nunchiLong + 움직임이 켜져 있을 때만. 블라인드 뒤(hidden)에는 텅 빈 스튜디오(사장님만)를 정적으로 그린다 */
    const NX = { mode: null, hidden: false, res: null, bellT: -9, doorK: 0, sayAt: null, shhAt: null, doneAt: null, hold: null,
      ring(tc) { NX.bellT = tc; } };
    function nxSettle() {   // 진행 중인 출근 연출을 바로 끝냄(자리로)
      for (const a of actors.values()) if (a.nx || a.loc === "out" || a.loc === "door") { a.nx = null; a.lift = null; a.moving = false; if (a.loc !== "car") { a.loc = a.goal === "boss" ? "boss" : "home"; a.x = a.goal === "boss" ? ASK_X : null; } }
      NX.mode = null; NX.hold = null;
    }
    function nxLeave() {
      const tc = clockT();
      if (!animOn() || drB.active()) return null;   // 연출 없이 블라인드만
      if (dcB.on()) dcB.set(false);
      nxSettle();
      const off = [.04, .17, .1, .23, .13, .2];
      model.floors.forEach((f, i) => { const a = actors.get(f.sid); if (!a) return; a.goal = "out"; a.thanksT = null; a.nx = { at: tc + off[i % off.length] + (a.loc === "boss" ? .02 : 0), carry: "bag" }; });
      visitor = null; cheer = null;
      Object.assign(NX, { mode: "leave", hidden: false, shhAt: null, doneAt: null, sayAt: null, hold: null });
      ensureLoop();
      return new Promise(res => { NX.res = res; });
    }
    function nxHide() {
      for (const a of actors.values()) Object.assign(a, { goal: "out", loc: "out", lift: null, moving: false, nx: null });
      Object.assign(car, { st: "idle", door: 0, row: nSess, dir: 0, owner: null });
      Object.assign(NX, { mode: null, hidden: true, hold: null, sayAt: null });
      if (NX.res) { NX.res(); NX.res = null; }
      ensureLoop(); staticDraw();
    }
    function nxArrive(o) {
      if (NX.res) { NX.res(); NX.res = null; }
      NX.hidden = false; NX.mode = null;
      const tc = clockT(), long = !!o.long && animOn();
      /* 질문은 가장 오래 기다린 한 명만 사장님 앞으로(평소 규칙) */
      visitor = null;
      const askers = model.floors.filter(f => f.kind === "ask").sort((a, b) => a.s.since - b.s.since);
      for (const a of actors.values()) Object.assign(a, { goal: "home", askAt: tc - 9, thanksT: null, lift: null, moving: false, nx: null });
      if (askers.length && actors.get(askers[0].sid)) { visitor = askers[0].sid; actors.get(visitor).goal = "boss"; }
      if (!long) {
        for (const a of actors.values()) Object.assign(a, a.goal === "boss" ? { loc: "boss", x: ASK_X, flip: true } : { loc: "home", x: null, flip: false });
        NX.sayAt = o.say ? tc + .15 : null;
      } else {
        /* 아래층 사람부터 문으로 들어오고, 질문 있던 직원은 맨 뒤(바로 사장님 앞으로) */
        const order = model.floors.map((f, i) => ({ a: actors.get(f.sid), i })).filter(r => r.a).sort((p, q) => (p.a.goal === "boss") - (q.a.goal === "boss") || q.i - p.i);
        order.forEach((r, k) => Object.assign(r.a, { loc: "out", x: DOOR_CX, nx: { inAt: tc + .1 + k * .45, carry: "cup" } }));
        Object.assign(car, { st: "idle", row: nSess, door: 0, dir: 0 });
        NX.mode = "arrive";
        /* 1층: 아직 문으로 들어오는 사람이 있으면 엘리베이터 문을 열어 두고 기다림 */
        NX.hold = row => row === nSess && [...actors.values()].some(a => a.goal === "home" && (a.loc === "out" || a.loc === "door" || (a.loc === "boss" && a.lift !== "board")));
        const k2 = order[Math.min(1, order.length - 1)];
        NX.sayAt = o.say && k2 ? k2.a.nx.inAt + .25 : null;   // 두 번째 사람이 들어올 때 "다들 어디 갔다 왔어?"
      }
      ensureLoop(); if (!animOn()) staticDraw();
    }
    /* 매 프레임: 퇴근이 다 끝났는지(코어에 알림) · 출근이 다 끝났는지 */
    function nxCheck(tc) {
      const list = [...actors.values()];
      if (NX.mode === "leave") {
        if (NX.shhAt == null && list.some(a => a.goal === "out" && ["boss", "door", "out"].includes(a.loc))) NX.shhAt = tc;
        if (list.every(a => a.loc === "out")) { if (NX.doneAt == null) NX.doneAt = tc; if (tc - NX.doneAt > .3 && NX.res) { NX.res(); NX.res = null; } }
      } else if (NX.mode === "arrive" && list.every(a => (!a.nx || a.loc === "boss" && a.goal === "boss") && !a.lift && a.loc !== "car" && !a.moving)) { NX.mode = null; NX.hold = null; }
    }
    /* 사장님 한마디: 퇴근하는 동안 "🤫 쉿!"(검지는 팔 하나로) · 출근하면 "다들 어디 갔다 왔어?"(처음엔 꼭, 이후 약 1/3 — 코어가 정함) */
    function nxBoss(tc, anim) {
      if (NX.mode === "leave" && NX.shhAt != null) return { say: "🤫 " + X("쉿!", "Shh!"), p: { arms: "r", eyes: "o" }, dy: 0 };
      if (NX.sayAt == null || NX.hidden) return null;
      const u = tc - NX.sayAt;
      if (u < 0) return null;
      if (u >= 2.65) { NX.sayAt = null; return null; }
      return { say: X("다들 어디 갔다 왔어?", "Where did everyone go?"), p: { mouth: "o", eyes: "o" }, dy: anim && u < .2 ? -Math.round(Math.sin(u / .2 * Math.PI) * 4) : 0 };
    }
    /* 문 열림 정도(누가 다가오거나 드나들 때) */
    function nxDoorWant(tc) {
      return [...actors.values()].some(a => a.loc === "door" || (a.loc === "boss" && a.goal === "out" && Math.abs(a.x - DOOR_CX) < 110) || (a.loc === "boss" && a.nx && a.nx.carry === "cup" && Math.abs(a.x - DOOR_CX) < 60) || (a.loc === "out" && a.goal !== "out" && a.nx && tc > a.nx.inAt - .12));
    }

    /* ---------- 한 프레임 그리기 ---------- */
    const STAT_COL = { ask: "#e8a020", stall: "#c85a5a", work: "#3fa35a", agents: "#4a8ae8", done: "#ff6b8a", idle: "#8a7aa0", away: "#8a7aa0", meet: "#4a8ae8", slow: "#d8902a" };
    let bossAct = null, fx = { sid: null, amt: 0 };
    const ensureBoss = () => {
      const l = X("사장님 (나)", "Boss (me)");
      if (bossAct && bossAct.opt.label !== l) { bossAct.opt.label = l; txt(bossAct.tag, l); }   // 언어를 바꾸면 머리 이름표도
      return bossAct || (bossAct = mkActor(BOSS, { boss: 1, label: l, color: "#34457f" }));
    };
    const parentFor = (fi, x, feet) => x > 640 ? { p: bld, x: x + 6, feet: feet + FT[fi], z: 40 } : { p: FL[fi].F, x, feet, z: null };

    function chipOf(f, a) {
      const k = f.kind, away = a.loc !== "home" || a.moving;
      if (k === "ask") return a.goal === "boss" ? (a.loc === "boss" && !a.moving ? [X("질문 중", "Asking"), STAT_COL.ask] : away ? [X("질문하러 이동", "Heading down"), STAT_COL.away] : [X("입력 필요", "Needs input"), STAT_COL.ask]) : [X("입력 필요 · 대기", "Needs input · queued"), STAT_COL.ask];
      if (k === "stall") return [X("멈춤 의심", "Stalled?"), STAT_COL.stall];
      if (away && k !== "ask") return [X("자리 비움", "Away"), STAT_COL.away];
      if (f.layout === "meet") { const d = f.agAll.filter(x => x.status === "done").length; return [X(`서브 회의 ${d}/${f.agAll.length}`, `Sub meeting ${d}/${f.agAll.length}`), STAT_COL.meet]; }
      if (k === "work" || k === "agents") return f.s.health && f.s.health.level === "slow" ? [X("생각이 길어요", "Slow…"), STAT_COL.slow] : [X("작업 중", "Working"), STAT_COL.work];
      if (k === "done") return [X("완료", "Done"), STAT_COL.done];
      return [X("대기", "Idle"), STAT_COL.idle];
    }
    function signOf(f, a) {
      const s = f.s, k = f.kind, td = s.todos || [], ac = lastAct(s);
      let title, on = 0, cur = -1;
      if (k === "ask") title = a.goal !== "boss" || (a.loc === "home" && !a.moving) ? "❓ " + X("입력 필요", "Needs input") : a.loc === "boss" && !a.moving ? "💬 " + X("질문 중", "Asking") : "🏃 " + X("질문하러 이동", "Heading down");
      else if (k === "stall") title = "💤 " + X("멈춤 의심", "Stalled?");
      else if (k === "done") { title = bigOf(s) ? "🎉 " + X("큰 일 완료!", "Big one done!") : "✅ " + X("완료", "Done"); on = 5; }
      else if (k === "idle") title = "💤 " + X("쉬는 중", "Resting");
      else if (f.layout === "meet") { const d = f.agAll.filter(x => x.status === "done").length, tot = Math.max(1, f.agAll.length); title = "🤝 " + X(`서브 ${d}/${tot}`, `Sub ${d}/${tot}`); on = Math.min(5, Math.round(d / tot * 5)); cur = on < 5 ? on : -1; }
      else {
        const ip = td.find(x => x.status === "in_progress"), rp = repOf(s), sp = stepOf(s);
        /* MCP 세션(도구 기록이 없음)은 AI가 쓴 제목. Claude 세션은 지금처럼 할 일·도구(제목은 명패·보드 캡션에) */
        const mt = !ip && s.source === "mcp" && rp && rp.title ? "✍️ " + (cfg.hideText ? X("작업 중", "Working") : cut(rp.title, 12)) : "";
        title = ip ? "🔨 " + cut(ip.text, 12) : mt || (ac ? ac.icon + " " + cut(ac.text, 12) : "🔨 " + X("작업 중", "Working"));
        if (td.length) { const dn = td.filter(x => x.status === "completed").length; on = Math.min(5, Math.round(dn / td.length * 5)); cur = ip && on < 5 ? on : -1; }
        else if (sp) { on = Math.min(5, Math.round((sp.step - 1) / sp.total * 5)); cur = on < 5 ? on : -1; }   // 단계 보고 n/총 → 칸
      }
      return { title, on, cur, pips: k === "done" || ((k === "work" || k === "agents") && (td.length > 0 || !!stepOf(s))) };
    }

    function frame(T, dt, anim) {
      if (wbT.due(clockT())) sync();   // 🧑‍🏫 회의 정리 시간이 끝난 층 → 책상 배치로 다시 짓기
      const tc = clockT(), n = nSess;
      tnB.pre();   // 🌺 금요일 셔츠 · 🥱 월요일 판정
      if (!FL.length) return;
      const DRon = drB.active();   // 📋 퇴근 일보 연출 중: 직원·사장님·엘리베이터를 연출이 그림
      if (DRon && dcB.on()) dcB.set(false);   // 🎨 꾸미기 판은 닫음
      const ph = anim ? { wk: Math.floor(T * 4) % 2, bob: Math.floor(T * 6) % 2, blink: (T % 3.7) < .14, hop: Math.abs(Math.sin(T * 7)), ty: Math.floor(T * 8) % 2 } : { wk: 0, bob: 0, blink: false, hop: 0, ty: 0 };
      if (anim && !DRon) carStep(dt, tc);
      if (DRon) drB.car(tc, car, n); else pkB.car(dt, anim, tc);   // 👆 엘리베이터 호출(직원이 쓰는 중이면 양보)
      /* 엘리베이터 위치 */
      const r = clamp(car.row, 0, n), i0 = Math.floor(r), i1 = Math.min(n, i0 + 1), kk = r - i0;
      const yb = lerp(FT[i0] + BASE[i0], FT[i1] + BASE[i1], kk);
      sty(carEl, "top", Math.round(yb - FT[0] - 114 + 8) + "px"); txt(lamp, pwB.out() ? "--" : (n + 1 - Math.round(r)) + "F");
      const pw = 44 * (1 - car.door) + 4 * car.door; sty(dl, "width", pw + "px"); sty(dr, "width", pw + "px");
      let asker = null, thanker = null;
      /* 층마다 */
      for (let i = 0; i < n; i++) {
        const fl = FL[i], f = model.floors[i];
        if (!fl || !f || !fl.f || fl.f.sid !== f.sid) continue;
        const a = actors.get(f.sid); if (!a) continue;
        a.restX = !DRon && f.kind === "idle" && a.goal === "home" ? dcB.restX(f) : null;   // 🎨 좋아하는 소품 옆(없으면 책상)
        if (a.restX == null || a.x !== a.restX) a.restAt = null;
        if (!DRon) stepActor(a, f, dt, anim, tc);
        if (fl.wbd) boardDraw(i, fl, f, tc, anim);
        if (fl.aib) aiBoardDraw(i, fl, f, tc, anim);
        if (fl.stp) stepDraw(fl, f, a, tc, anim);
        if (fl.cap) capDraw(fl, f);
        const info = DRon ? (drB.staff(i, fl, f, a, T, tc, ph), null) : placeActor(i, fl, f, a, T, tc, ph, anim);
        if (!DRon && a.loc === "boss" && !a.moving) { if (a.goal === "boss") asker = a; else thanker = a; }
        /* 표시 정보 */
        const [ct, cc] = chipOf(f, a), tg = fl.tag.children;
        txt(tg[0], (n + 1 - i) + "F"); txt(tg[1].children[0], cfg.hideText ? "🤫 " + X("비공개", "Private") : f.s.project); txt(tg[1].children[1], ` · ${f.label.replace("·", " · ")}`); txt(tg[2], ct); sty(tg[2], "background", cc);
        tagZone(a, fl.F); ftagFit(fl, [a], 0, SIGN_X - 4);   // 머리 이름표 자리를 피해 층 이름표 줄 맞춤 (#64) — 옮겨도 표지판 앞까지
        if (fl.sign) {
          const sg = signOf(f, a), up = !DRon && a.loc === "home" && a.x != null && a.x > SIGN_X - 30;   // 직원이 표지판 아래(걷기·엘리베이터 대기·바닥 2 소품 옆 휴식)면 접음 (#62)
          sty(fl.sign, "transition", anim && !fl.sign.fresh ? "" : "none"); fl.sign.fresh = false; fl.sign.classList.toggle("fold", up);
          html(fl.sign.t, "<b>" + esc(sg.title) + "</b>");
          [...fl.sign.p.children].forEach((p, j) => { const c = j < sg.on ? "on" : j === sg.cur ? "cur" : ""; if (p.className !== c) p.className = c; });
          sty(fl.sign.p, "display", sg.pips ? "flex" : "none");
        }
        if (info && info.babies) placeBabies(i, fl, f, a, T, ph, anim, tc);
        if (!DRon) tnB.actor(i, fl, f, a, T, tc, anim);   // 🤸 질문 대기 발 동동·주저앉기 · 문어 다리 타자 · 월요일 하품
        if (!DRon) pkB.actor(i, fl, f, a, T, tc, anim);   // 👆 누르면 몸짓·둘레 효과
      }
      if (visitor) { const va = actors.get(visitor); if (va && va.goal === "home" && va.loc === "home" && !va.moving) assignVisitor(); }
      nxCheck(tc);
      /* 🙈 1층 현관문(누가 드나들면 열림 · 종 딸랑) · 층마다 엘리베이터 호출 버튼(기다리는 사람이 있으면 그 방향이 켜짐) */
      if (FL[n].door) {
        NX.doorK = anim ? clamp(NX.doorK + (nxDoorWant(tc) ? 1 : -1) * dt / .13, 0, 1) : 0;
        nxDoorDraw(FL[n].door, NX.doorK, tc, anim);
      }
      for (let i = 0; i <= n; i++) {
        const hb = FL[i] && FL[i].hall; if (!hb) continue;
        let up = false, dn = false;
        for (const a of actors.values()) if (a.lift && a.loc !== "car" && (a.loc === "boss" ? n : floorIdx.get(a.sid)) === i) { if (destOf(a) > i) dn = true; else up = true; }
        hb.u.classList.toggle("on", up); hb.d.classList.toggle("on", dn);
      }
      /* 사장실 */
      const bf = FL[n], boss = ensureBoss();
      txt(bf.tag.children[0], "1F"); txt(bf.tag.children[1], X("사장실 · 나", "Boss office · me"));
      const askN = model.floors.filter(f => f.kind === "ask").length + model.hiddenAsk;
      txt(bf.tag.children[2], X(`승인 대기 ${askN}`, `Waiting ${askN}`)); sty(bf.tag.children[2], "background", "#34457f");
      let pqB = null, updB = false;
      /* 질문하러 와 있는 직원이 있으면(질문 말풍선이 사장님 자리를 덮음) 축하는 미뤘다가 끝나면 — 1분 넘게 밀리면 생략 */
      /* 사장실에 직원이 와 있는 동안(질문 중 · 감사 인사 · 엘리베이터로 돌아가는 중)은 계속 보류 — 프레임마다 판정하면 인사 말풍선과 번갈아 바뀐다.
         직원이 사장실을 떠난 뒤 0.4초 지나서 한 번만 5.5초 */
      const nb = DRon ? null : nxBoss(tc, anim);   // 🙈 "🤫 쉿!" · "다들 어디 갔다 왔어?"
      const bossBusy = DRon || !!nb || !!asker || !!thanker || [...actors.values()].some(a => a.loc === "boss" || (a.loc === "car" && a.goal === "home"));
      if (bossBusy) bossFree = tc;
      if (cheer && tc - bossFree < .4) { cheer.held = cheer.held || tc; cheer.t0 = tc; if (tc - cheer.held > 60) cheer = null; }
      if (cheer && tc - cheer.t0 >= CHEER_SEC) cheer = null;
      const ch = !bossBusy && tc - bossFree >= .4 ? cheer : null;
      if (DRon) drB.boss(boss, bf, T, tc, ph);
      else if (nb) {
        setP(boss, Object.assign({ view: "front", seated: 1, eyes: ph.blink ? "c" : "o" }, nb.p)); put(boss, bf.F, bf.chx, BASE[n] - 6, { dy: nb.dy }); tagOn(boss, false);
        boss.bub.classList.remove("updb"); sty(boss.el, "zIndex", ""); sty(boss.el, "pointerEvents", ""); bubble(boss, esc(nb.say), true);
      }
      else if (ch) {   // 🎉 칭찬 한마디: 질문 감사 다음 · 전력 말풍선보다 먼저(5.5초짜리라 정전·리셋 안내를 잠깐만 가림)
        setP(boss, { view: "front", seated: 1, legs: "s", eyes: ph.blink ? "c" : "o", mouth: "o", arms: anim && Math.floor((tc - ch.t0) * 3) % 2 ? "u" : "r" });
        put(boss, bf.F, bf.chx, BASE[n] - 6, { dy: anim && tc - ch.t0 < 1.2 ? -Math.round(ph.hop * 2) * 3 : 0 }); tagOn(boss, false);
        boss.bub.classList.add("updb"); sty(boss.el, "zIndex", "61"); sty(boss.el, "pointerEvents", "none");   // 사장님 오른쪽 옆(층 이름표·왼쪽 벽에 안 잘리게)
        const who = `${ch.shiny ? "✨" : ""}${EMO[ch.animal]} ${aName(ch.animal)}(${ch.pname})`;
        bubble(boss, `<span class="cheer">🎉 ${esc(who)} ${X("큰 일 끝! 수고했어요", "big one done! Nice work")}</span>${ch.text && !cfg.hideText ? `<small class="cheer2">“${esc(cut(ch.text, 30))}”</small>` : ""}`, true);
      }
      else if (thanker) { setP(boss, { view: "front", seated: 1, legs: "s", eyes: "o", mouth: "o", arms: "u" }); put(boss, bf.F, bf.chx, BASE[n] - 6, { dy: -ph.hop * 10 }); tagOn(boss, false); boss.bub.classList.remove("updb"); sty(boss.el, "zIndex", ""); bubble(boss, "✅ " + X("확인!", "Got it!"), true); }
      else {
        // 전력·날씨 연출(정전·리셋 말풍선)이 먼저, 없을 때 새 버전 알림(앱) → 누르면 업데이트 대화상자 (설치는 거기서 누를 때만)
        // 📋 퇴근 일보 알림은 그 아래: 사장님이 종이를 들고 "일보 나왔어요!"(누르면 발표) — 화면을 가로채지 않음
        const pq = pqB = pwB.boss(ph), upd = !(pq && pq.say) && ctx.core.update && ctx.core.update.available, dn = !(pq && pq.say) && !upd ? drB.notice() : null; updB = !!upd || !!dn;
        setP(boss, pq ? pq.p : dn ? { view: "front", seated: 1, eyes: ph.blink ? "c" : "o", arms: "r", specs: 1 } : { view: "front", seated: 1, eyes: ph.blink ? "c" : "o" }); tagOn(boss, !(pq && pq.say) && !dn);
        put(boss, bf.F, bf.chx + (pq ? pq.dx : 0), BASE[n] - 6, { dy: !pq && ph.bob ? -1 : 0 });
        boss.bub.classList.toggle("updb", !!upd || !!dn);   // 사장님 오른쪽 옆 (층 이름표와 겹치지 않게), 모니터보다 위
        sty(boss.el, "zIndex", upd || dn ? "61" : ""); sty(boss.el, "pointerEvents", upd || dn ? "none" : "");   // 👆 누를 자리(z60) 위로 — 말풍선 버튼만 눌리고 사장님 몸은 아래 누를 자리로 통과
        if (upd) bubble(boss, `<button type="button" class="upd" data-act="update" title="v${esc(upd.version)}">🎁 ${X("새 버전 나왔어요!", "New version is out!")}</button>`, true);
        else if (dn) bubble(boss, `<button type="button" class="upd" data-act="dr-open">${dn.kind === "morning" ? "☀️ " + X("좋은 아침! 어제 일보 왔어요", "Good morning! Yesterday's report") : dn.kind === "time" ? "⏰ " + X("퇴근 시간! 일보 나왔어요", "Time's up! Report's ready") : "📋 " + X("일보 나왔어요!", "Today's report is ready!")}</button>`, true);
        else bubble(boss, pq && pq.say || "", !!(pq && pq.say));
      }
      if (!DRon) pkB.bossAfter(boss, bf, T, tc, anim, n, !!thanker || !!pqB || updB || !!ch || !!nb);   // 👆 사장님: 꾸벅·커피 한 모금 · 누르면 반응 (말풍선이 있으면 양보)
      drB.paper(boss, bf, T, anim);   // 📋 알림 중이면 종이를 흔듦
      /* 질문 말풍선 (층 위로 넘칠 수 있게 건물 위에 직접) */
      const askL = asker && !DRon ? Math.round(asker.x + 6 - asker.w / 2 - 14 - 290) : null;   // 질문 말풍선 왼쪽 끝(폭 290)
      if (asker && !DRon) {
        const f = model.floors[floorIdx.get(asker.sid)], s = f && f.s;
        const q = s && s.note ? s.note : X("확인이 필요해요", "Needs your input");
        const h = `<span class="hd" style="background:${PROV[f.pk].c}">${f.shiny ? "✨" : ""}${EMO[f.animal]} ${esc(aName(f.animal))} · ${esc(f.pname)} ❓${s && s.confidence === "guess" ? " " + X("(추정)", "(guess)") : ""}</span>` +
          `<span class="q">${esc(q)}</span>${canTerm ? `<button class="btn" type="button" data-act="term" data-sid="${esc(asker.sid)}">🖥️ ${muxOf(s) ? X(`${muxOf(s)}로 이동`, `Go to ${muxOf(s)}`) : X("터미널로 이동", "Go to terminal")}</button>` : ""}` +
          `<span class="hint">${muxOf(s) ? X(`${muxOf(s)}에서 답해 주세요`, `Please answer in ${muxOf(s)}`) : X("터미널에서 답해 주세요", "Please answer in the terminal")}</span>`;
        html(askb, h); sty(askb, "display", "block"); askb.dataset.sid = asker.sid;   // 👆 POKE: 그 층을 누르면 이 말풍선 강조(터미널 버튼이 없는 브라우저도) sty(askb, "width", "290px");
        sty(askb, "left", askL + "px"); sty(askb, "top", (FT[n] - 34) + "px");
      } else sty(askb, "display", "none");
      tagZone(boss, bf.F); ftagFit(bf, [boss], 170, 666, askL != null ? askL - 6 - 4 : 1e4);   // 1층 이름표 줄이 "사장님 (나)"를 덮지 않게 (#64). 옮길 땐 천장 등(x 135~165) 뒤로, 질문 말풍선이 있으면 그 왼쪽 끝 앞까지(칩이 말풍선 밑에 숨지 않게 · 6 = 층 왼쪽 테두리, 말풍선은 건물 좌표)
      ftagFlush();
      /* 완료 연출 (배너·+자금, 큰 완료면 색종이까지) */
      const fa = fx.sid && actors.get(fx.sid), fi = fa ? floorIdx.get(fx.sid) : undefined;
      const lt = fa ? tc - fa.launchStart : 99;
      if (anim && fa && fi != null && lt >= 0 && lt < 4.5) {
        const f = model.floors[fi], ax = f.layout === "meet" ? 278 : 385, top = FT[fi];
        sty(banner, "display", "block"); html(banner, `${fx.big ? "🎉 " + X("큰 일 완료!", "Big one done!") : "✅ " + X("완료", "Done")}<small>${esc(f.label.replace("·", " · "))} · ${esc(cut(f.s.project, 16))}<br>${fx.big && fx.bonus > 0 ? `💰 ${X("기본", "base")} ${fx.base} + ${X("큰 일 보너스", "big bonus")} ${fx.bonus}${fx.tok ? " + " + X("절약", "saver") + " 5" : ""} = +${fx.amt}` : `${X("자금", "Funds")} 💰 +${fx.amt}`}</small>` +
          (canTerm && muxOf(f.s) ? `<button class="btn go" type="button" data-act="term" data-sid="${esc(f.sid)}">↗ ${X(`${muxOf(f.s)}로 이동`, `Go to ${muxOf(f.s)}`)}</button>` : ""));   // 완료 보고 → 그 멀티플렉서(cmux) 세션으로
        sty(banner, "left", "28px"); sty(banner, "top", (top + 22) + "px");
        sty(plusEl, "display", lt < 3 ? "block" : "none"); txt(plusEl, "💰 +" + fx.amt); sty(plusEl, "left", (ax + 58) + "px"); sty(plusEl, "top", Math.round(top + BASE[fi] - 110 - lt * 12) + "px");
        confs.forEach((c, j) => { if (lt > 3.5 || !fx.big) { sty(c, "display", "none"); return; } const an = (j / 24) * Math.PI * 2, sp2 = 36 + (j % 4) * 24; sty(c, "display", "block"); sty(c, "left", Math.round(ax + 6 + Math.cos(an) * sp2 * lt * 1.1) + "px"); sty(c, "top", Math.round(top + BASE[fi] - 70 + Math.sin(an) * sp2 * lt * .7 + 22 * lt * lt * 4) + "px"); });
      } else { sty(banner, "display", "none"); sty(plusEl, "display", "none"); confs.forEach(c => sty(c, "display", "none")); }
      if (anim) stepFrags(tc);
      pwB.frame(T, tc, anim, { actors, model, boss: bossAct, carEl });
      pkB.frame(T, tc, anim);   // 👆 소품 반응·말풍선·토스트(반응이 없으면 그리지 않음)
      drB.frame(T, tc, anim);   // 📋 불 끄기·발표판·꽃가루·카드 등장(연출 중일 때만)
      dcB.frame(T, tc, anim);   // 🎨 소품·택배·하트·물 주기 · 꾸미기 칸 · 자금 옆 숫자
      tnB.frame(T, tc, anim);   // ☕ 빈 잔 · 📅 연속 출근 · 🔦 순찰
    }

    /* 한 층의 동물 놓기 — 반환 { babies } */
    function placeActor(i, fl, f, a, T, tc, ph, anim) {
      const F = fl.F, B = fl.B, meet = f.layout === "meet", deskx = meet ? BOARD_X : DESK_X, k = f.kind, d = fl.desk;
      const lau = anim && a.launchUntil > tc;
      const setScreen = (mode, tt) => { if (!d) return; const on = mode !== "off"; sty(d.sc, "background", on ? "#16213a" : "#1a1a28");
        d.sc.lines.forEach((l, j) => { sty(l, "display", on ? "block" : "none"); const sd = mode === "type" ? Math.floor(tt * 3) + j * 7 : j * 5 + 3; sty(l, "width", (8 + (sd * 37 % 36)) + "px"); sty(l, "left", (3 + ((sd * 13) % 3) * 4) + "px"); sty(l, "background", ["#7dff9c", "#ffd23f", "#5aa8ff", "#ff9ab0", "#c8b0ff"][(sd + j) % 5]); }); };
      const hands = (on, ty) => { if (!d) return; d.hands.forEach((h, j) => { sty(h, "display", on ? "block" : "none"); sty(h, "marginTop", ((ty + j) % 2 ? -4 : 0) + "px"); }); };
      const zs = on => fl.zs.forEach(z => sty(z, "display", on ? "block" : "none"));
      const cup = (on, e) => { sty(fl.sweat, "display", on ? "block" : "none"); if (on) txt(fl.sweat, e); };
      sty(fl.tint, "display", "none"); zs(false); cup(false, ""); sty(fl.gb, "display", "none");
      if (a.bub.classList.contains("dcr")) a.bub.classList.remove("dcr");   // 🎨 쉬기 한마디(머리 오른쪽 옆)는 그 장면에서만
      const res = { babies: meet };
      /* 🙈 퇴근·출근: 밖(안 보임) · 현관문 · ❗ · 가방/커피 들고 걷기 · 엘리베이터 기다리기 */
      sty(a.el, "display", a.loc === "out" ? "none" : ""); sty(a.el, "opacity", ""); sty(a.img, "filter", "");
      if (a.loc === "out" || (a.goal === "out" && a.nx && tc >= a.nx.at) || (a.nx && a.nx.carry === "cup")) {   // 아기(서브에이전트)는 본체와 함께 자리를 비움
        res.babies = false; a.babies.forEach(b => { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); b.par = null; });
        if (fl.mb) sty(fl.mb, "display", "none");
      }
      if (a.loc === "out") { tagOn(a, false); bubble(a, "", false); nxCarry(a, null); setScreen("off"); hands(false, 0); return res; }
      const carry = a.nx && a.nx.carry, wk = Math.floor(tc * (carry === "bag" ? 12 : 8)) % 2;
      const walkP = { view: "front", legs: anim ? (wk ? "a" : "b") : "s", eyes: "o" };
      if (a.loc === "door") {   // 문 안으로(작아지고 어두워짐) / 문에서 나옴
        const u = clamp((tc - a.nx.door) / .26, 0, 1), k = a.nx.dir === "out" ? u : 1 - u, g = parentFor(nSess, DOOR_CX, BASE[nSess] - 2);
        setP(a, walkP); put(a, g.p, g.x, g.feet, { dy: -Math.round(k * 5) }); sty(a.el, "zIndex", "6");
        sty(a.img, "transform", `scale(${(1 - .16 * k).toFixed(3)})`); sty(a.img, "filter", `brightness(${(1 - .55 * k).toFixed(2)})`);
        sty(a.el, "opacity", String(clamp(a.nx.dir === "out" ? (1 - k) * 2.4 : u * 2.2, 0, 1).toFixed(2)));
        tagOn(a, false); bubble(a, "", false); nxCarry(a, carry, false, 0); return res;
      }
      if (a.loc === "car") {   // 여러 명이 타면 나란히(번갈아 눈 깜빡)
        const sl = a.slot || 0;
        setP(a, { view: "front", legs: "s", eyes: anim && Math.floor(tc * 1.7 + sl) % 3 === 0 ? "c" : "o", mouth: carry === "bag" ? "o" : "" }); tagOn(a, false); bubble(a, "", false);
        put(a, carEl, [44, 26, 62, 35, 53, 18][sl % 6], 106, { dy: -(sl % 2) * 2 }); sty(a.el, "zIndex", String(3 + sl % 3));
        nxCarry(a, carry, sl % 2 === 1, 0); setScreen("off"); hands(false, 0); return res;
      }
      const lift = a.lift === "wait" || a.lift === "board" || (carry && a.moving);
      const react = a.goal === "out" && a.loc === "home" && !a.lift && !a.moving && tc >= a.nx.at;
      if (lift || react) {
        const fiP = a.loc === "boss" ? nSess : i, g = parentFor(fiP, a.x, (a.loc === "boss" ? BASE[nSess] : B) - 2);
        let dy = 0, rot = 0, sw = 0, pop = 1, say = "";
        if (react) {   // ❗ 벌떡 → 가방이 손에 뿅
          const u = tc - a.nx.at;
          setP(a, { view: "front", legs: "s", eyes: "o", mouth: "o", arms: u < .2 ? "u" : "" });
          dy = u < .16 ? -Math.round(Math.sin(u / .16 * Math.PI) * 10) : 0; say = u < .3 ? "❗" : ""; pop = clamp((u - .1) / .12, 0, 1);
        } else if (a.lift === "wait") {   // 엘리베이터 쪽을 보고 발 동동 · 가끔 층 표시등을 올려다봄
          const tap = anim && Math.floor(tc * 6 + i) % 2, look = anim && (tc + i * .7) % 2.4 > 1.7;
          setP(a, { view: "front", legs: tap ? "a" : "s", eyes: look ? "o" : ph.blink ? "c" : "o" }); dy = tap ? -2 : 0; rot = look ? -5 : 0; sw = tap ? 5 : -3;
        } else {   // 걷기(가방은 크게 흔들림)
          setP(a, walkP); dy = anim && wk ? (carry === "bag" ? -5 : -3) : 0; rot = anim ? (wk ? 1 : -1) * (carry === "bag" ? 4 : 2) : 0; sw = carry === "bag" ? (wk ? 14 : -10) : 0;
        }
        put(a, g.p, g.x, g.feet, { dy, flip: a.flip, rot }); sty(a.el, "zIndex", String(g.z || (a.loc === "boss" ? 20 : 8)));
        tagOn(a, false); bubble(a, esc(say), !!say); nxCarry(a, carry || (react ? "bag" : null), a.flip, sw, pop, a.lift === "wait");   // 기다릴 땐 두 손으로 앞에 들고(책상·화분과 안 겹치게)
        setScreen("off"); hands(false, 0); return res;
      }
      nxCarry(a, a.loc === "boss" ? carry : null, true, 0);   // 질문하러 온 직원은 커피를 든 채로
      /* 이동 중 / 엘리베이터 / 사장실 */
      const onBoss = a.loc === "boss", fiP = onBoss ? nSess : i;
      const alert = a.goal === "boss" && !a.moving && a.loc === "home";
      const thanks = onBoss && a.goal === "home" && !a.moving && a.thanksT != null;
      const asking = onBoss && a.goal === "boss" && !a.moving;
      const queued = k === "ask" && a.goal !== "boss" && a.loc === "home" && !a.moving;
      if (a.moving || onBoss || alert || queued) {
        const walking = a.moving;
        setP(a, { view: "front", legs: walking ? (ph.wk ? "a" : "b") : "s", eyes: ph.blink ? "c" : "o", mouth: asking || thanks || alert || queued ? "o" : "", arms: asking ? "r" : thanks || alert || queued ? "u" : "" });
        tagOn(a, !(asking || thanks || alert || queued));
        let x = a.x == null ? deskx : a.x, feet = (onBoss ? BASE[nSess] : B) - 2, tgt;
        const dy = walking ? (ph.wk ? -4 : 0) : alert || queued ? -ph.hop * 16 : thanks ? -ph.hop * 14 : asking ? -Math.abs(Math.sin(T * 4)) * 6 : 0;
        tgt = parentFor(fiP, x, feet);
        put(a, tgt.p, tgt.x, tgt.feet, { dy, flip: a.flip || asking, rot: walking ? (ph.wk ? 3 : -3) : 0 });
        sty(a.el, "zIndex", String(tgt.z || (onBoss ? 20 : 8)));
        bubble(a, alert ? "❗ " + X("입력 필요!", "Needs input!") : queued ? "❗ " + X("입력 필요 (순서 대기)", "Needs input (waiting)") : thanks ? X("확인했어요! 계속할게요 🚀", "Thanks! Back to work 🚀") : "", alert || queued || thanks);
        if (a.el.contains(a.bub) && asking) bubble(a, "", false);
        setScreen("off"); hands(false, 0);
        return res;
      }
      /* 자기 층에서 */
      sty(a.el, "zIndex", "8");
      let sx = deskx;
      if (k === "stall") {
        const h = f.s.health || { secs: 0 }, secs = h.secs + stateAge(), m = Math.max(1, Math.floor(secs / 60));
        const lx = 270;
        setP(a, { view: "front", legs: "s", eyes: "c" }); tagOn(a, false);
        put(a, F, lx, B - 2, { lying: true, sc: 1 + Math.sin(T * 1.4) * .015 });
        html(fl.gb, `<span style="color:${PROV_COLOR[f.pk]}">${esc(aName(f.animal))} · ${esc(f.pname)}</span><br>💤 ${X("멍", "Zzz")} ${mmss(secs)}<br>${esc(h.tool ? X(`${cut(h.tool, 10)} ${m}분째`, `${cut(h.tool, 10)} ${m}m`) : X("응답 없음", "no reply"))}`); sty(fl.gb, "display", "block"); bubble(a, "", false);
        sty(fl.tint, "display", "block"); setScreen("off"); hands(false, 0);
        fl.zs.forEach((z, j) => { const p = ((T * .5 + j / 3) % 1); sty(z, "display", "block"); sty(z, "left", (lx - 48 - p * 10 + j * 6) + "px"); sty(z, "top", (B - 70 - p * 26) + "px"); sty(z, "opacity", String(1 - p)); sty(z, "fontSize", `calc(${14 + p * 10}px * var(--inv))`); });
        sty(fl.sweat, "display", "block"); txt(fl.sweat, "💧"); sty(fl.sweat, "left", (lx - 34) + "px"); sty(fl.sweat, "top", Math.round(B - 92 + ((T * 2) % 1) * 6) + "px"); sty(fl.sweat, "opacity", Math.floor(T * 2) % 2 ? "1" : ".5");
        return res;
      }
      bubble(a, "", false);
      if (lau) {
        const lt = tc - a.launchStart;
        setP(a, { view: "front", seated: meet ? 0 : 1, legs: "s", arms: "u", mouth: "o", eyes: "o" });
        put(a, F, sx, B - (meet ? 2 : 6), { dy: -Math.abs(Math.sin(lt * 7)) * 26 }); tagOn(a, false); setScreen("on"); hands(false, 0);
        return res;
      }
      if (meet) {   // 서브에이전트 회의: 본체는 화이트보드 앞에서 쓰고 · 설명하고 · 끝나면 만세 → 지우기
        const Tm = wbT.team(f.sid), w = Tm ? WB.pose(Tm, tc, !anim, ctx.lang === "en") : null;
        if (w && (w.writing || w.erasing || w.cheer)) {
          setP(a, { view: "front", legs: "s", eyes: ph.blink ? "c" : "o", mouth: w.cheer ? "o" : "", arms: w.cheer ? "u" : "l" });
          put(a, F, sx, B - 2, { dy: w.cheer ? -Math.round(ph.hop * 3) * 4 : anim && Math.floor(T * 6) % 2 ? -2 : 0 });
        } else {
          const pt = Math.floor(T / 3) % 3 === 0 && (T % 3) > 1;
          setP(a, { view: "front", legs: "s", eyes: ph.blink ? "c" : "o", mouth: pt ? "o" : "", arms: pt ? "r" : "" });
          put(a, F, sx, B - 2, { dy: ph.bob ? -1 : 0 });
        }
        tagOn(a, false); bubble(a, "", false);
        if (fl.wbd) { sty(fl.wbd.pb, "display", w && w.say ? "block" : "none"); if (w && w.say) txt(fl.wbd.pb, w.say); }
        return res;
      }
      const dr = dcB.pose(f, a, tc, anim, ph);   // 🎨 새 소품 도착: 좋아하는 거면 만세 + "러그다! ♥", 아니면 "오~"
      if (dr) { setP(a, dr.p); put(a, F, sx, B - 6, { dy: dr.dy }); tagOn(a, false); bubble(a, esc(dr.say), true); setScreen("on"); hands(false, 0); return res; }
      const hp = pwB.hold(i, f, a);   // 정전·리셋: 가만히 앉기 · 기지개 · 한마디
      if (hp && hp.p) { setP(a, hp.p); put(a, F, sx, B - 6); tagOn(a, true); bubble(a, hp.say || "", !!hp.say); setScreen(hp.scr === "off" ? "off" : "on"); hands(false, 0); return res; }
      if (hp && hp.say) bubble(a, hp.say, true);
      /* ✍️ 보드의 마지막 줄에 ✓가 찍히면 잠깐 기지개(움직임이 켜져 있을 때만) */
      if (fl.aib && WB.aiStretch(aiT.get(f.sid), tc, !anim)) {
        const u = tc - aiT.get(f.sid).allAt;
        setP(a, { view: "front", seated: 1, arms: "u", eyes: "c", mouth: u > .5 && u < 1.2 ? "o" : "" }); put(a, F, sx, B - 6, { dy: -Math.round(Math.sin(clamp(u / 1.6, 0, 1) * Math.PI) * 3) }); tagOn(a, true);
        setScreen("on"); hands(false, 0);
        return res;
      }
      const variant = fnv(a.sid) % 2;
      if (k === "idle") {
        if (a.restX != null && a.x === a.restX) {   // 🎨 좋아하는 소품 옆에서 쉼(하트는 DECOR가) · 도착하고 4.5초 한마디
          if (a.restAt == null) a.restAt = tc;
          const say = tc - a.restAt < 4.5 ? dcB.restSay(f) : "";
          setP(a, { view: "front", legs: "s", eyes: "c", mouth: anim && Math.floor(T / 2) % 3 === 0 ? "o" : "" }); put(a, F, a.x, B - 2, { dy: 0 }); tagOn(a, !say); bubble(a, esc(say), !!say); if (say) a.bub.classList.add("dcr");
          setScreen("off"); hands(false, 0);
          return res;
        }
        if (variant === 0) {   // 꾸벅꾸벅
          setP(a, { view: "front", seated: 1, eyes: "c" }); put(a, F, sx, B - 6, { dy: Math.floor(T * 1.2) % 2 ? 1 : 0 }); tagOn(a, true);
          fl.zs.forEach((z, j) => { const p = ((T * .4 + j / 3) % 1); sty(z, "display", "block"); sty(z, "left", (sx + 24 + p * 12 + j * 8) + "px"); sty(z, "top", (B - 104 - p * 26) + "px"); sty(z, "opacity", String(1 - p)); sty(z, "fontSize", `calc(${14 + p * 10}px * var(--inv))`); });
        } else {               // 커피 한 모금
          const sip = Math.floor(T / 2) % 2 === 1;
          setP(a, { view: "front", seated: 1, eyes: ph.blink ? "c" : "o", arms: sip ? "r" : "" }); put(a, F, sx, B - 6, { dy: ph.bob ? -1 : 0 }); tagOn(a, true);
          cup(true, "☕"); sty(fl.sweat, "left", (sx + (sip ? 30 : 36)) + "px"); sty(fl.sweat, "top", (B - (sip ? 76 : 60)) + "px"); sty(fl.sweat, "opacity", "1");
        }
        setScreen("off"); hands(false, 0);
        return res;
      }
      if (k === "done") {
        setP(a, { view: "front", seated: 1, eyes: ph.blink ? "c" : "o", mouth: "o" }); put(a, F, sx, B - 6, { dy: ph.bob ? -1 : 0 }); tagOn(a, true);
        setScreen("on"); hands(false, 0);
        return res;
      }
      /* 작업 중: 타이핑 + 코드 조각 + 소리 */
      const slow = f.s.health && f.s.health.level === "slow";
      setP(a, { view: "front", seated: 1, eyes: ph.blink ? "c" : "o" }); put(a, F, sx, B - 6, { dy: ph.bob ? -1 : 0 }); tagOn(a, true);
      setScreen("type", T); hands(true, ph.ty);
      if (slow) { cup(true, "💧"); sty(fl.sweat, "left", (sx + 26) + "px"); sty(fl.sweat, "top", Math.round(B - 6 - a.h + 6 + ((T * 2) % 1) * 4) + "px"); sty(fl.sweat, "opacity", Math.floor(T * 2) % 2 ? "1" : ".5"); }
      if (anim) {
        keyTick(a, tc);
        if (cfg.frags && tc >= a.fragAt) {
          a.fragAt = tc + .35 + Math.random() * .5;
          const kind = kindOf(f.s), ac = lastAct(f.s);
          spawnFrag(bld, sx - 2 + Math.random() * 30, FT[i] + B - 6 - a.h - 6, kind, ac && ac.text);
        }
      }
      return res;
    }

    /* 🙈 손에 든 가방·커피(직원 요소 안의 도트 이미지). 손 높이는 캐릭터 팔 위치(ch.arm.y)에서 */
    function nxCarry(a, name, flip, swing, pop, front) {
      if (!a.nxBag) { a.nxBag = mkEl("img", "nxp", a.el); a.nxCup = mkEl("img", "nxp", a.el); [a.nxBag, a.nxCup].forEach((e, k) => { const s = nxPix(doc, k ? "cup" : "bag", 4); e.src = s.url; e.alt = ""; e.draggable = false; e.style.width = s.w + "px"; e.style.height = s.h + "px"; }); }
      sty(a.nxBag, "display", name === "bag" ? "block" : "none"); sty(a.nxCup, "display", name === "cup" ? "block" : "none");
      if (!name) return;
      const e = name === "bag" ? a.nxBag : a.nxCup, s = nxPix(doc, name, 4), legs = a.pose.includes('"seated":1') ? 0 : a.ch.legs.s.length;
      const hy = (a.ch.arm.y + 2) * S + (a.h - (a.ch.rows.length + legs + 2) * S), cx = a.w / 2 + (front ? 0 : (flip ? -1 : 1) * 30);
      sty(e, "left", Math.round(cx - s.w / 2) + "px"); sty(e, "top", Math.round(name === "bag" ? hy - (front ? 4 : 12) : hy - s.h - 2) + "px");
      sty(e, "transform", `${pop != null && pop < 1 ? `scale(${pop.toFixed(2)}) ` : ""}rotate(${(swing || 0).toFixed(1)}deg)`);
    }

    /* 층 이름표 줄(층 번호 · 프로젝트 · 동물 · 프로바이더 · 상태 칩)이 직원 머리 이름표를 덮지 않게 (#64).
       창이 좁으면 글자 배율(--inv)이 커져 이름표 줄이 자리(책상·소품 옆·사장님 자리)의 머리 이름표까지 닿는다.
       머리 이름표가 이름표 줄 높이에 걸칠 때만, 차례로: ① "· 동물 · 프로바이더"를 뺌(바로 옆 머리 이름표에 같은 글)
       ② 그래도 길면 프로젝트를 말줄임 ③ 층 번호 + 상태 칩조차 안 들어가면(사장님 자리처럼 왼쪽 끝) 줄을 머리 이름표 오른쪽으로
       — 옮긴 줄은 mR(책상 층 = 표지판 앞, 1층 = 통로 앞) 안에서, 프로젝트 칸이 안 들어가면 빼고 ④ 그것도 안 되면 왼쪽에 층 번호 + 칩만.
       R은 무엇이 와도 넘지 않는 오른쪽 끝(1층 = 질문 말풍선 왼쪽 끝 — 말풍선이 칩을 덮지 않게). 상태 칩은 늘 다 보인다.
       줄였으면 전체 글은 title, 줄 전체 글은 늘 aria-label. 머리 이름표 자리는 제자리에 있을 때 잰 값(a.tz)을 기억 —
       걷거나 말풍선으로 잠깐 숨어도 이름표 줄이 들썩이지 않게. 잼은 이름표 글·자리·글자 배율·글꼴이 바뀔 때만(매 프레임 레이아웃 읽기 방지),
       바뀐 층들은 프레임 끝에 모아(ftagFlush) 쓰기 → 읽기 → 쓰기 한 번씩(층마다 리플로하지 않게).
       회의 층은 그대로: 본체 이름표는 숨고, 아기 "#1~3"은 테이블 위 회의 배너와 자리를 나눠 써서 줄을 줄이면 배너가 길어져 더 가림 */
    function tagZone(a, F) {
      if (!a || a.par !== F || a.moving || (a.loc && a.loc !== "home") || a.tag.style.display === "none") return;
      const k = a.tag.textContent + "|" + a.el.style.left + "|" + a.h + "|" + bld.style.getPropertyValue("--inv") + "|" + fontGen;
      if (a.tz && a.tz.F === F && a.tz.k === k) return;
      const w = a.tag.offsetWidth, l = a.el.offsetLeft + a.w / 2 - w / 2, t = a.el.offsetTop + a.tag.offsetTop;   // 이름표는 translateX(-50%) — offsetLeft 대신 몸 가운데에서
      a.tz = { F, k, l, r: l + w, t, b: t + a.tag.offsetHeight };
    }
    const ftQ = [];
    let fontGen = 0;   // 웹 글꼴이 늦게 들어오면 폭이 바뀜 → 이름표 맞춤·회의 배너를 다시 잼(아래 loadingdone)
    function ftagFit(fl, who, minL = 0, mR = 666, R = 1e4) {   // 666 = 엘리베이터 통로 앞
      const tg = fl.tag, zs = who.map(a => a && a.tz).filter(z => z && z.F === fl.F);
      const k = tg.textContent + "|" + fontGen + "|" + bld.style.getPropertyValue("--inv") + "|" + minL + "," + mR + "," + R + "|" + zs.map(z => z.k + z.t).join(";");
      if (fl.ftK !== k) { fl.ftK = k; ftQ.push({ fl, zs, minL, mR, R }); }
    }
    function ftagFlush() {
      if (!ftQ.length) return;
      const q = ftQ.splice(0), inv = +bld.style.getPropertyValue("--inv") || 1;
      q.forEach(o => {   // 쓰기: 원래대로
        const tg = o.fl.tag, sp = tg.children[1]; o.suf = sp.children[1];   // suf = "· 동물 · 프로바이더"(사장실 줄엔 없음)
        sty(tg, "left", ""); sty(sp, "maxWidth", ""); sty(sp, "display", ""); if (o.suf) sty(o.suf, "display", "");
      });
      q.forEach(o => {   // 읽기
        const tg = o.fl.tag, [b, sp, em] = tg.children;
        o.top = tg.offsetTop; o.h = tg.offsetHeight; o.x0 = tg.offsetLeft; o.fix = b.offsetWidth + em.offsetWidth + 8;   // 8 = 칸 사이 gap 두 번
        o.nat = sp.offsetWidth; o.sufW = o.suf ? o.suf.offsetWidth : 0; o.over = sp.scrollWidth > sp.clientWidth + 1;   // over = CSS max-width(360)로 이미 잘림
        o.full = [b.textContent, sp.textContent, em.textContent].join(" ");
      });
      q.forEach(o => {   // 쓰기: 맞춤
        const { fl, zs, minL, mR, R, x0, fix, suf } = o, tg = fl.tag, sp = tg.children[1];
        const bot = o.top + o.h - 3, hit = zs.filter(z => z.t < bot && z.b > o.top);   // 3 = 테두리끼리 살짝 닿는 정도는 그대로(글자는 안 가림)
        const zl = hit.length ? Math.min(...hit.map(z => z.l)) - 4 : 1e4, zr = hit.length ? Math.max(...hit.map(z => z.r)) + 4 : 0;   // 4 = 머리 이름표와의 틈
        const lim = Math.min(zl, R), fits = (L, end, w) => L + fix + w <= end, cap = w => sty(sp, "maxWidth", w + "px");
        let nat = o.nat, cut = o.over;
        if (!fits(x0, lim, nat)) {
          if (suf) { sty(suf, "display", "none"); nat = Math.max(0, nat - o.sufW); cut = true; }
          const mn = Math.min(nat, 40 * inv), L = Math.max(zr, minL), end = Math.min(mR, R);
          if (fits(x0, lim, nat)) { /* ① 로 충분 */ }
          else if (fits(x0, lim, mn)) { cap(lim - x0 - fix); cut = true; }   // ②
          else if (hit.length && fits(L, end, mn)) {   // ③ 옮긴 자리 — 공간이 있으면 "· 동물 · 프로바이더"도 다시
            sty(tg, "left", L + "px"); if (suf && fits(L, end, nat + o.sufW)) { sty(suf, "display", ""); nat += o.sufW; cut = o.over; }
            if (!fits(L, end, nat)) { cap(end - L - fix); cut = true; }
          } else {   // ③' 프로젝트 칸을 빼고 층 번호 + 칩만(옮기거나 ④ 왼쪽에) — 칩이 우선
            sty(sp, "display", "none"); cut = true;
            if (hit.length && L + fix - 4 <= end) sty(tg, "left", L + "px");   // -4 = 뺀 칸의 gap
            else if (x0 + fix - 4 > R) sty(tg, "left", Math.max(2, R - fix + 4) + "px");
          }
        }
        if (tg.title !== (cut ? sp.textContent : "")) tg.title = cut ? sp.textContent : "";
        if (tg.getAttribute("aria-label") !== o.full) { tg.setAttribute("role", "group"); tg.setAttribute("aria-label", o.full); }
        fl.ftS = tg.style.left + "|" + sp.style.maxWidth + "|" + sp.style.display + "|" + (suf ? suf.style.display : "");   // 회의 배너 자리(placeBabies)가 따라오게
      });
    }

    /* 서브에이전트 = 부모의 아기 버전, 회의 테이블에 앉음. 끝낸 아기(✓)는 팀이 끝날 때까지 도넛을 들고 쉼 */
    function placeBabies(i, fl, f, a, T, ph, anim, tc) {
      const B = fl.B, Tm = wbT.team(f.sid), w = fl.wbd, en = ctx.lang === "en";
      const mem = Tm ? Tm.mem : f.ag.map((x, j) => ({ aid: x.aid, j, a: x, wt: -1e9, doneAt: null }));
      const dn = m => WB.isDone(m, tc);
      const show = mem.slice().sort((p, q) => dn(p) - dn(q) || p.j - q.j).slice(0, 3).sort((p, q) => p.j - q.j);   // 일하는 아기 먼저 자리에
      const nB = show.length;
      while (a.babies.length < nB) a.babies.push(mkActor(BYID[f.animal], { prov: f.pk, baby: 1, scale: SB, label: "#" + (a.babies.length + 1), color: "#ff8a3d" }));
      const live = show.filter(m => !dn(m)), sp = live.length ? live[Math.floor(T / 3) % live.length] : null, talk = anim && (T % 3) < 2.6;
      const yw = Tm && anim ? WB.yawn(Tm, tc) : null;
      let top = B - 60, stallN = 0;
      if (w) { w.dn.forEach(e => sty(e, "display", "none")); sty(w.yawn, "display", "none"); }
      a.babies.forEach((b, k) => {
        const m = show[k], gone = !m || (Tm && Tm.leave != null && tc >= Tm.leave + m.j * .2);
        const pop = !gone && Tm && anim ? clamp((tc - Tm.t0 - .2 - m.j * .25) / .3, 0, 1) : 1;   // 하나씩 와서 앉음
        if (gone || pop <= 0) { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); b.par = null; return; }
        const ag = m.a, d = dn(m), just = d && anim && tc - m.doneAt < .9, stall = !d && ag.health && ag.health.level === "stall";
        const speaking = talk && sp === m && !stall, yawning = yw === m;
        if (stall) stallN++;
        setP(b, { view: "front", seated: 1, eyes: stall || yawning || (d && !just) ? "c" : ph.blink ? "c" : "o", mouth: just || speaking || yawning ? "o" : "", arms: just ? "u" : speaking ? "r" : "" });
        tagOn(b, true); txt(b.tag, stall ? "💤" : d ? "✓" : "#" + (m.j + 1)); sty(b.tag, "background", d ? "#1f9a5a" : "#ff8a3d");
        const x = 430 + k * 88;
        put(b, fl.F, x, B - 8, { dy: just ? -Math.round(ph.hop * 3) * 3 : speaking ? -Math.abs(Math.sin(T * 6)) * 5 : pop < 1 ? Math.round((1 - pop) * -14) : ((Math.floor(T * 3) + k) % 3 === 0 && anim && !stall && !d ? -3 : 0) });
        sty(b.el, "opacity", String(pop));
        bubble(b, "", false); top = Math.min(top, B - 8 - b.h - (nSess >= 6 ? 30 : 56));
        if (w && d && !just) { const e = w.dn[k], s2 = WB.pix(WB.ART.dn, 3); if (e._u !== s2.url) { e._u = s2.url; e.src = s2.url; } sty(e, "width", s2.w + "px"); sty(e, "height", s2.h + "px"); sty(e, "display", "block"); sty(e, "left", (x + 8) + "px"); sty(e, "top", (B - 34) + "px"); }
        if (w && yawning) { sty(w.yawn, "display", "block"); sty(w.yawn, "left", (x + 16) + "px"); sty(w.yawn, "top", (B - 74 - Math.round(((tc - Tm.t0) % 20) * 4)) + "px"); }
        if (anim && cfg.frags && !stall && !d && tc >= (b.fragAt || 0)) { b.fragAt = tc + 1 + Math.random() * 1.2; spawnFrag(bld, x + 2 + Math.random() * 20, FT[i] + B - 8 - b.h - 4, (ag.now && ag.now.kind) || "agent", ag.now && ag.now.text); }
      });
      /* 말풍선은 테이블 위 하나만: 회의 n/총 · 지금 말하는 아기의 도구(now.text — 보드엔 안 씀) */
      const tot = mem.length, dnN = mem.filter(dn).length;
      const say = cfg.hideText ? "🤫" : live.length && stallN === live.length ? "💤 " + X("응답 없음 · 멈춤 의심", "No reply · stalled?") : sp ? (sp.a.now ? sp.a.now.icon + " " + WB.clean(sp.a.now.text) : WB.lineOf(sp, en)) : "";
      /* 층 이름표(상태 칩까지) 줄 끝 뒤에서 시작해 통로 앞까지만 — 칩을 덮지 않게(#62). 남는 폭이 좁으면 "🤝 1/2"만, 그것도 안 들어가면 숨김
         (이름표 칩 "서브 회의 n/총"·보드 머리줄에 같은 진행이 있음. 이름표 아래로 내리면 아기 이름표·보드 글자를 가림).
         이름표 글·글꼴·글자 배율(--inv, 창이 좁으면 커짐)이 바뀔 때만 다시 잼(매 프레임 레이아웃 읽기 방지) */
      const inv = +bld.style.getPropertyValue("--inv") || 1, tk = fl.tag.textContent + "|" + fontGen + "|" + inv + fl.ftS;   // 이름표 줄 맞춤(#64: 말줄임·자리 옮김)이 바뀌어도 다시 잼
      if (fl.mbK !== tk) {
        fl.mbK = tk; const L = fl.tag.offsetLeft + fl.tag.offsetWidth + 6, room = 666 - L - 22;   // 22 = 말풍선 좌우 여백·테두리
        fl.mbFit = room >= 120 * inv ? 2 : room >= 40 * inv ? 1 : 0; sty(fl.mb, "left", L + "px"); sty(fl.mb, "maxWidth", Math.max(0, room) + "px");
      }
      const full = `🤝 ${X("회의", "Meeting")} ${dnN}/${tot}${say ? " · " + (sp && !cfg.hideText ? "#" + (sp.j + 1) + " " : "") + esc(cut(say, 18)) : ""}`;
      html(fl.mb, `<span class="ell">${fl.mbFit === 2 ? full : `🤝 ${dnN}/${tot}`}</span>`);
      sty(fl.mb, "top", Math.max(2, top) + "px"); sty(fl.mb, "display", fl.mbFit ? "block" : "none");
      if (fl.more) { fl.more.hidden = tot <= 3; txt(fl.more, "+" + (tot - 3)); }
    }

    /* ---------- 🧑‍🏫 회의 배치 소품: 화이트보드 · 마커 받침 · 벽시계 · 도넛 상자 (규칙은 WB 블록) ---------- */
    function boardBuild(F, B) {
      const w = {};
      w.board = box(F, 30, 28, 220, 84, "var(--wb)", { border: "3px solid #4a3560", zIndex: 4 });   // 창문(z3) 위를 덮음
      box(F, 27, 111, 226, 6, "#b8c4d4", { border: "2px solid #4a3560", zIndex: 5 });
      w.mks = [0, 1, 2].map(k => box(F, 60 + k * 16, 106, 12, 5, "#2e2040", { border: "1px solid #2e2040", zIndex: 6 }));
      w.el = mkEl("div", "b wbx", F, { left: "33px", top: "31px", width: "214px", height: "78px", zIndex: 5, overflow: "hidden" });
      bx(F, 350, B - 22, 270, 10, T.deskTop, "#4a3560", 9); bx(F, 356, B - 13, 258, 13, T.desk, "#4a3560", 9);
      w.dbox = mkEl("div", "b", F, { left: "372px", top: (B - 34) + "px", zIndex: 10 });
      w.clock = mkEl("div", "b", F, { left: (owned("frame") ? 342 : 300) + "px", top: "26px", width: "30px", height: "30px", borderRadius: "50%", background: "#fff", border: "3px solid #4a3560", zIndex: 3 });
      [[11, 0, 3, 3], [21, 11, 3, 3], [11, 21, 3, 3], [0, 11, 3, 3]].forEach(([x, y, ww, hh]) => box(w.clock, x, y, ww, hh, "#9a8cb0"));   // 눈금 12·3·6·9
      w.hand = box(w.clock, 11, 3, 3, 11, "#2e2040", { transformOrigin: "1px 11px" }); box(w.clock, 11, 11, 3, 3, "#d23a4a");
      w.pb = mkEl("div", "bub", F, { left: "392px", top: "8px", zIndex: 30 });   // 부모 한마디("어, 잉크가…" · "회의 끝! 👏") — 층 위로 잘리지 않게 머리 오른쪽 위
      const cs = WB.pix(WB.ART.cap, 3); w.cap = mkEl("img", "b", F, { zIndex: 12, display: "none", width: cs.w + "px", height: cs.h + "px" }); w.cap.alt = ""; w.cap.src = cs.url;
      w.dn = [0, 1, 2].map(() => { const e = mkEl("img", "b", F, { zIndex: 13, display: "none" }); e.alt = ""; return e; });
      w.yawn = mkEl("div", "b wbt", F, { display: "none", zIndex: 30, color: "#6a5a88", fontWeight: 700, textShadow: "1px 1px 0 #fff" }, X("하암~", "yawn~"));
      return w;
    }
    function boardDraw(i, fl, f, tc, anim) {
      const w = fl.wbd, Tm = wbT.team(f.sid), still = !anim;
      sty(w.pb, "display", "none");
      if (!Tm) { html(w.el, ""); sty(w.cap, "display", "none"); w.mks.forEach(e => sty(e, "display", "block")); html(w.dbox, ""); return; }
      html(w.el, WB.render([{ T: Tm, x: 3, w: 208, mode: "full" }], tc, { lh: 15, pt: 2, sc: 3, big: 1, H: 78, still, hide: cfg.hideText, en: ctx.lang === "en",
        lab: () => ({ em: EMO[f.animal], fl: (nSess + 1 - i) + "F", proj: f.s.project }) }));
      /* 받침대: 팀 잉크 마커만 손에(빠짐) */
      const on = Tm.ee == null || tc < Tm.ee;
      [Tm.ink, Tm.ink === "#d23a4a" ? "#2a62c9" : "#d23a4a", "#2e2040"].forEach((c, k) => { sty(w.mks[k], "background", c); sty(w.mks[k], "display", k === 0 && on && tc >= Tm.t0 + .4 ? "none" : "block"); });
      /* 마커 뚜껑: 가끔 처음 쓸 때 굴러떨어져 바닥에 남음 */
      const u = tc - Tm.t0 - .5;
      if (Tm.cap && on && u > 0) {
        let x, y; if (still || u >= 1.85) { x = 196; y = fl.B - 9; } else if (u < .35) { x = 62 + u * 40; y = 106 - Math.sin(u / .35 * Math.PI) * 8; } else if (u < .75) { const k = (u - .35) / .4; x = 76 + k * 20; y = 106 + k * k * (fl.B - 112); } else { const k = clamp((u - .75) / 1.1, 0, 1); x = 96 + ease(k) * 100; y = fl.B - 9; }
        sty(w.cap, "display", "block"); sty(w.cap, "left", Math.round(x) + "px"); sty(w.cap, "top", Math.round(y) + "px"); sty(w.cap, "transform", `rotate(${still || u >= 1.85 ? 0 : Math.round(u * 6) * 90}deg)`);
      } else sty(w.cap, "display", "none");
      /* 벽시계: 회의 15초마다 분침 한 칸 */
      sty(w.hand, "transform", `rotate(${Math.floor(Math.max(0, tc - Tm.t0) / 15) * 30}deg)`);
      /* 도넛 상자: 끝낸 아기가 하나씩 가져감 */
      const left = Math.max(0, 3 - WB.doneN(Tm, tc)), ds = WB.pix(WB.ART.dn, 2);
      html(w.dbox, `<div style="position:relative;width:42px;height:14px;background:#ffb3c8;border:3px solid #4a3560">${[0, 1, 2].map(k => k < left ? `<img alt="" src="${ds.url}" style="position:absolute;left:${2 + k * 12}px;top:-8px;width:10px;height:10px">` : "").join("")}</div>`);
    }

    /* ---------- ✍️ AI 보드(책상 층): 보드 · 마커 받침 · "✍️ AI가 씀" 딱지 (규칙은 WB 블록 aiTracker·aiRender) ---------- */
    function aiBoardBuild(F, B) {
      const w = {};
      w.board = box(F, 30, 28, 220, 84, "var(--wb)", { border: "3px solid #4a3560", zIndex: 4 });
      box(F, 27, 111, 226, 6, "#b8c4d4", { border: "2px solid #4a3560", zIndex: 5 });
      w.mks = [0, 1].map(k => box(F, 196 + k * 18, 106, 12, 5, k ? "#2e2040" : "#2a62c9", { border: "1px solid #2e2040", zIndex: 6 }));   // 오른쪽 끝 받침: 쓰는 마커만 빠짐
      w.el = mkEl("div", "b wbx", F, { left: "33px", top: "31px", width: "214px", height: "78px", zIndex: 5, overflow: "hidden" });
      w.el.dataset.aicap = "1";
      w.tag = mkEl("div", "b aiw", F, { left: "36px", top: "103px", zIndex: 7 }, "✍️ " + X("AI가 씀", "AI wrote"));   // 보드 받침에 붙인 딱지
      const cs = WB.pix(WB.ART.cap, 3); w.cap = mkEl("img", "b", F, { zIndex: 12, display: "none", width: cs.w + "px", height: cs.h + "px" }); w.cap.alt = ""; w.cap.src = cs.url;
      return w;
    }
    function aiBoardDraw(i, fl, f, tc, anim) {
      const w = fl.aib, Bd = aiT.get(f.sid), still = !anim, off = aibOff(f.s, f.kind), now = ctx.now();
      if (!Bd) { html(w.el, ""); return; }
      const erase = off != null && now >= off ? (now - off) / AIB_ERASE : null;
      w.el.dataset.aicap = f.sid;
      html(w.el, WB.aiRender(Bd, tc, { x: 3, w: 208, lh: 18, pt: 3, rows: 4, still, hide: cfg.hideText, an: f.animal, sc: 3, H: 78, erase }));
      /* 받침대: 쓰는 동안 그 잉크 마커가 빠졌다가, 다 쓰면 돌아와 뚜껑이 딸깍(소리 없음) */
      const writing = !still && tc >= Bd.t0 && tc < Bd.end;
      sty(w.mks[0], "background", Bd.ink); sty(w.mks[0], "display", writing ? "none" : "block");
      const ck = WB.aiCap(Bd, tc, still);
      if (ck != null) { const y = 106 - 9 + Math.round(ease(Math.min(1, ck / .7)) * 7); sty(w.cap, "display", "block"); sty(w.cap, "left", "198px"); sty(w.cap, "top", (ck > .7 ? 104 : y) + "px"); sty(w.cap, "transform", ck > .7 && ck < .85 ? "scaleY(.7)" : ""); }
      else sty(w.cap, "display", "none");
      sty(w.tag, "opacity", erase != null ? String(clamp(1 - erase, 0, 1)) : "1");
    }
    /* 단계 명패(책상 앞) "3/5": 단계가 바뀌면 한 번 휙 넘어감, 마지막 단계면 금색 */
    function stepDraw(fl, f, a, tc, anim) {
      const sp = stepOf(f.s), on = !!sp && (f.kind === "work" || f.kind === "agents" || f.kind === "ask");
      sty(fl.stp, "display", on ? "block" : "none"); if (!on) return;
      const k = sp.step + "/" + sp.total;
      if (a.stepK !== k) { a.stepAt = a.stepK == null ? -9 : tc; a.stepK = k; }
      txt(fl.stp, k); sty(fl.stp, "background", sp.step === sp.total ? "#ffd23f" : "#fffdf4");
      const u = anim ? (tc - a.stepAt) / .32 : 1;
      sty(fl.stp, "transform", u >= 0 && u < 1 ? `scaleY(${Math.abs(Math.cos(u * Math.PI)).toFixed(2)})` : "");
    }
    /* ✍️ 하단 캡션: 명패·AI 보드에 마우스를 올리면 그 층 아래에 AI가 쓴 제목. 🖥️ 층 이름표·단계 명패면 "🖥️ Orca로 이동" 등(title 툴팁은 쓰지 않음) */
    function capDraw(fl, f) {
      const r = f.rep, ai = hovCap === f.sid && !!r && !!(r.title || stepOf(f.s)), go = canTerm && hovJump === f.sid && !dcB.on();
      sty(fl.cap, "display", ai || go ? "block" : "none"); if (!ai && !go) return;
      const sp = stepOf(f.s);
      const aiT = ai ? "✍️ " + (cfg.hideText ? "🤫 " + X("작업 문구 숨김", "Text hidden") : r.title || X("단계 보고", "Step report")) + (sp ? ` · ${sp.step}/${sp.total}` : "") : "";
      txt(fl.cap, go ? "🖥️ " + goLabel(f.s, X) + (aiT ? " · " + aiT : "") : aiT);
    }
    ctx.listen(view, "mouseover", e => {
      const c = e.target.closest ? e.target.closest("[data-aicap]") : null, j = e.target.closest ? e.target.closest("[data-jump]") : null, v = c ? c.dataset.aicap : null, w = j ? j.dataset.jump : null;
      if (v !== hovCap || w !== hovJump) { hovCap = v; hovJump = w; if (!animOn()) staticDraw(); }
    });
    ctx.listen(view, "mouseleave", () => { if (hovCap || hovJump) { hovCap = hovJump = null; if (!animOn()) staticDraw(); } });

    /* ---------- 데이터 → 모델 → 보상 ---------- */
    const lastActTs = new Map(), prevStall = new Map();
    let lastTick = 0, okRun = 0, startedAt = ctx.now();
    const totalDones = () => Object.values(sv.dones).reduce((t, n) => t + n, 0);
    const lvOf = () => 1 + Math.floor(Math.sqrt(totalDones() / 2));
    const lvEmp = n => { const lv = 1 + Math.floor(Math.sqrt(n)); const lo = (lv - 1) ** 2, hi = lv * lv; return { lv, pct: Math.round((n - lo) / (hi - lo) * 100) }; };
    const prune = (o, max) => { const k = Object.keys(o); if (k.length > max) k.slice(0, k.length - max).forEach(x => delete o[x]); };

    function celebrate(f, tc) {
      const s = f.s;
      if (sv.paid[f.sid] === s.since) return;
      sv.paid[f.sid] = s.since; prune(sv.paid, 80);
      const big = bigOf(s), run = s.run || 0;
      let amt = earnOf(s), bonus = false;
      const tk = s.tokens && s.tokens.total;                   // 토큰을 많이 쓴다고 보상은 없다. 평소보다 적게 썼을 때만 +5
      if (tk > 0) { if (sv.tok.n >= 3 && tk < sv.tok.avg) { amt += 5; bonus = true; } sv.tok.avg = (sv.tok.avg * sv.tok.n + tk) / (sv.tok.n + 1); sv.tok.n = Math.min(sv.tok.n + 1, 60); }
      sv.funds += amt; sv.earned += amt; sv.day.earned += amt; sv.dones[f.sid] = (sv.dones[f.sid] || 0) + 1; prune(sv.dones, 200);
      const a = actors.get(f.sid);
      if (a) { a.launchStart = tc; a.launchUntil = tc + 4.5; fx = { sid: f.sid, amt, big, base: EARN.done, bonus: amt - (bonus ? 5 : 0) - EARN.done, tok: bonus }; }
      dcB.earn(f, amt, tc);   // 🎨 자금 옆 +n · 시든 화분에 물
      const short = !big && run > 0 && run < EARN.SHORT_SEC;
      pushLog(big ? "🎉" : "✅", X(`${f.label.replace("·", " · ")} · ${cut(s.project, 14)} ${big ? "큰 일 완료!" : "완료"} +${amt}${short ? " (짧은 턴)" : ""}${bonus ? " (토큰 절약 +5)" : ""}`, `${f.label.replace("·", " · ")} · ${cut(s.project, 14)} ${big ? "big one done!" : "done"} +${amt}${short ? " (quick turn)" : ""}${bonus ? " (token saver +5)" : ""}`));
      saveSoon();
    }

    /* 사장님께 질문하러 가는 직원은 한 번에 한 명. 해결돼 돌아오면 바로 다음 대기자 */
    function assignVisitor() {
      if (NX.mode === "leave" || NX.hidden) return;   // 🙈 퇴근 중·블라인드 뒤에는 질문하러 가지 않음(출근하면 다시)
      const floors = model.floors, tc = clockT();
      const askers = floors.filter(f => f.kind === "ask").sort((a, b) => a.s.since - b.s.since);
      if (visitor) { const a = actors.get(visitor), fv = floors.find(f => f.sid === visitor); if (!a || !fv) visitor = null; else if (fv.kind !== "ask" && a.loc === "home" && !a.moving) visitor = null; }
      if (!visitor && askers.length && ![...actors.values()].some(a => a.loc === "boss" || a.loc === "car")) { visitor = askers[0].sid; actors.get(visitor).askAt = tc; }
      actors.forEach((a, sid) => { a.goal = sid === visitor && floors.some(f => f.sid === sid && f.kind === "ask") ? "boss" : "home"; });
    }

    function sync() {
      const st = ctx.state;
      if (!st) return;
      lastState = st;
      const now = ctx.now(), tc = clockT();
      pwB.read(st, now);
      const list = st.sessions.map(s => classify(s, st, now));
      wbT.sweep(tc);
      list.sort((a, b) => a.rank - b.rank || (a.kind === "ask" ? a.s.since - b.s.since : 0) || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
      const floors = list.slice(0, MAXF);
      model = { floors, more: list.length - floors.length, hiddenAsk: list.slice(MAXF).filter(f => f.kind === "ask").length, st, all: list };
      nSess = Math.max(1, floors.length);
      floorIdx = new Map(floors.map((f, i) => [f.sid, i]));
      const live = new Set(floors.map(f => f.sid));
      floors.forEach(actorFor);
      for (const [sid, a] of [...actors]) if (!live.has(sid)) { dropActor(a); actors.delete(sid); if (car.owner === a) car.owner = null; if (visitor === sid) visitor = null; }
      /* 일어난 일 → 로그·보상 */
      if (firstSync) pushLog("🏢", X(`스튜디오 오픈 · ${list.length}명 출근`, `Studio open · ${list.length} on duty`));
      let actLogs = 0;
      for (const f of list) {
        const raw = f.s.status, prev = prevRaw.get(f.sid), nm = f.label.replace("·", " · ");
        if (!firstSync) {
          if (prev === undefined) pushLog("🚪", X(`${nm} · ${cut(f.s.project, 14)} 출근`, `${nm} · ${cut(f.s.project, 14)} clocked in`));
          else if (prev !== raw) {
            if (raw === "needs_input") pushLog("❓", X(`${nm} · 입력 필요!`, `${nm} · needs input!`));
            else if (raw === "done") celebrate(f, tc);
            else if (prev === "needs_input") pushLog("✅", X(`${nm} · 확인됨, 작업 재개`, `${nm} · resumed`));
          }
          if (f.kind === "stall" && !prevStall.get(f.sid)) pushLog("💤", X(`${nm} · 멈춤 의심`, `${nm} · may be stalled`));
          const ac = lastAct(f.s);
          if (ac && ac.ts > (lastActTs.get(f.sid) || 0) && actLogs < 3) { actLogs++; pushLog(ac.icon, `${nm} · ${cut(ac.text, 28)}`); }
        } else if (raw === "done") sv.paid[f.sid] = f.s.since;   // 이미 끝나 있던 것은 보상하지 않음
        prevRaw.set(f.sid, raw); prevStall.set(f.sid, f.kind === "stall");
        const ac = lastAct(f.s); if (ac) lastActTs.set(f.sid, ac.ts);
      }
      if (prevRaw.size > 120) [...prevRaw.keys()].slice(0, 40).forEach(k => prevRaw.delete(k));
      /* 도감: 처음 출근한 날 */
      for (const f of TINY.dev.has("oct") ? [] : floors) {   // 개발용 ?tiny=oct(모두 문어)는 도감에 남기지 않음
        const d = sv.dex[f.animal] || (sv.dex[f.animal] = {}), key = f.shiny ? "s" : "n";
        if (!d[key]) { d[key] = ymd(); saveSoon(); if (!firstSync) pushLog("📖", X(`새 동료 발견! ${f.shiny ? "✨ " : ""}${aName(f.animal)}`, `New staff! ${f.shiny ? "✨ " : ""}${aName(f.animal)}`)); }
      }
      /* 페이스 준수: 시간당 +10, 평판 */
      const dt = lastTick ? clamp(now - lastTick, 0, 5) : 0; lastTick = now;
      const five = C.limits(st, now).five, valid = five.used != null && five.pace != null, ok = valid && five.used <= five.pace;
      if (valid && dt > 0) {
        const hr = String(Math.floor(now / 3600)), b = sv.rep[hr] || (sv.rep[hr] = [0, 0]); b[1] += dt; if (ok) b[0] += dt;
        Object.keys(sv.rep).forEach(k => { if (+k < Math.floor(now / 3600) - 24) delete sv.rep[k]; });
      }
      if (ok) { okRun += dt; sv.paceSecs += dt; while (sv.paceSecs >= 3600) { sv.paceSecs -= 3600; sv.funds += 10; sv.earned += 10; sv.day.earned += 10; pushLog("⭐", X("페이스 준수 1시간 · +10", "On pace for an hour · +10")); } saveSoon(); }
      else if (valid) okRun = 0;
      if (sv.day.d !== ymd()) sv.day = { d: ymd(), earned: 0 };
      /* 사장님께 질문하러 가는 직원은 한 번에 한 명 */
      const askers = floors.filter(f => f.kind === "ask").sort((a, b) => a.s.since - b.s.since);
      assignVisitor();
      /* 층 구성이 바뀌면 다시 짓기 */
      aiT.sweep(new Set(list.map(f => f.sid)));
      /* 🎉 칭찬 한마디: AI가 큰 일로 보고한 완료(report.big)마다 한 번 · 90초에 한 번까지 · 5.5초만 (처음 열 때 이미 있던 건 조용히) */
      for (const f of floors) {
        const b = f.rep && f.rep.big; if (!b) continue;
        const k = f.sid + ":" + b.ts; if (cheerSeen.has(k)) continue;
        cheerSeen.add(k); if (cheerSeen.size > 60) cheerSeen.delete(cheerSeen.values().next().value);
        if (!firstSync && tc - cheerAt > CHEER_GAP) { cheerAt = tc; cheer = { sid: f.sid, t0: tc, animal: f.animal, shiny: f.shiny, pname: f.pname, pk: f.pk, text: f.rep.cheer || "" }; }
      }
      tnB.read(floors);   // 📅 오늘 일한 프로젝트 기록(새벽 4시 경계)
      dcB.read(floors, tc, firstSync);   // 🎨 층(프로젝트)이 보임 → 창고 복원·시듦 · 7일 안 온 층은 창고로
      const sig = floors.map(f => f.sid + f.layout + (f.aib ? "w" : "")).join(",") + "|" + nSess + "|" + Object.keys(sv.shop).sort().join(",") + "|" + ctx.lang + "|" + dcB.sig();
      if (sig !== buildSig) { buildSig = sig; build(); }
      if (moreEl) { moreEl.hidden = !model.more; txt(moreEl, X(`+${model.more}명 더`, `+${model.more} more`)); }
      renderHud(); renderSide();
      firstSync = false;
      if (!animOn()) staticDraw();
    }

    /* ---------- HUD ---------- */
    const HUDQ = { money: $(".money .v"), lv: $(".lv"), rep: $(".rep .v2"), pwH: $(".pw-h"), pwV: $(".pw-v"), pwI: $(".pow .gauge i"), pwU: $(".pow .gauge u"), wkV: $(".wk-v"), wkI: $(".wk .gauge i"), chip: $(".askchip") };
    function gauge(lc, now, iEl, uEl, vEl) {
      if (lc.used == null) { sty(iEl, "width", "0%"); if (uEl) sty(uEl, "display", "none"); txt(vEl, "—"); return; }
      const col = lc.over || lc.low ? "#ff5a5a" : lc.pace != null && lc.used > lc.pace ? "#ffc83a" : "#4fd06a";
      sty(iEl, "width", clamp(lc.used, 0, 100) + "%"); if (uEl !== iEl && iEl.className.includes("seg") && uEl) { sty(iEl, "background", col); }
      if (uEl) { sty(uEl, "display", lc.pace != null ? "block" : "none"); sty(uEl, "left", clamp(lc.pace || 0, 0, 100) + "%"); }
      txt(vEl, Math.round(lc.used) + "%");
    }
    function renderHud() {
      const st = ctx.state, now = ctx.now();
      txt($(".t-tag"), X("동물 직원 스튜디오", "Animal studio")); txt($(".t-money"), X("자금", "Funds")); txt($(".t-rep"), X("평판 · 페이스 준수", "Rep · on pace"));
      txt(HUDQ.money, sv.funds.toLocaleString("en-US")); txt(HUDQ.lv, "Lv." + lvOf());
      /* 평판: 최근 24시간 중 5시간 한도를 페이스 안에서 쓴 시간의 비율 */
      let ok = 0, tot = 0; Object.values(sv.rep).forEach(([o, t]) => { ok += o; tot += t; });
      if (tot < 300) txt(HUDQ.rep, "☆☆☆☆☆ —");
      else { const sc = Math.round((1 + 4 * ok / tot) * 2) / 2, full = Math.floor(sc); txt(HUDQ.rep, "★".repeat(full) + "☆".repeat(5 - full) + " " + sc.toFixed(1)); }
      const lim = C.limits(st, now);
      if (lim.five.used != null) {
        gauge(lim.five, now, HUDQ.pwI, HUDQ.pwU, HUDQ.pwV);
        html(HUDQ.pwH, `<span class="t" title="${X("전력 · 5시간 한도", "Power · 5h limit")}">${X("전력 · 5시간 한도", "Power · 5h limit")}</span>${lim.five.reset ? `<span class="r">${X("리셋", "reset")} ${esc(C.fmt(Math.max(0, lim.five.reset - now)))}</span>` : ""}`);
      } else { gauge({ used: null }, now, HUDQ.pwI, HUDQ.pwU, HUDQ.pwV); html(HUDQ.pwH, X(`<span class="t" title="전력 · 5시간 한도">전력 · 5시간 한도</span><span class="r">정보 없음</span>`, `<span class="t" title="Power · 5h limit">Power · 5h limit</span><span class="r">no data</span>`)); }
      pwB.hud(HUDQ);   // 단계 무늬·배지 · 정전이면 "리셋까지"
      gauge(lim.week, now, HUDQ.wkI, null, HUDQ.wkV); txt($(".t-wk"), X("주간 한도", "Weekly limit") + pwB.wxIcon());
      const calling = st ? st.sessions.filter(s => s.status === "needs_input").length : 0;
      HUDQ.chip.hidden = !calling; html(HUDQ.chip, `<span style="font-size:18px">❓</span>${X(`입력 대기 ${calling}`, `Waiting ${calling}`)}`);
      const sb = $('[data-act="sound"]'), qb = $('[data-act="quiet"]'), db = $('[data-act="dex"]');
      txt(sb, cfg.sound ? "🔊" : "🔈"); sb.classList.toggle("on", cfg.sound); sb.title = X("키보드 타자 소리 켜기/끄기", "Toggle keyboard typing sound");
      txt(qb, "🔇"); qb.classList.toggle("on", ctx.settings.quiet); qb.title = X("움직임과 소리를 꺼요", "Stop motion and sound");
      html(db, `📖 ${X("도감", "Dex")} <span class="pk-egg">🥚 ${pkB.eggN()}/8</span>`); db.title = X("직원 도감 · 이스터에그 · 설정", "Staff dex · easter eggs · settings");
      drB.hud($('[data-act="dr-go"]'), $('[data-act="dr-card"]'));   // 📋 🏃 퇴근 · 📋 일보 (API·오늘 완료가 있을 때만)
      dcB.hudBtn($('[data-act="decor"]')); dcB.tray();   // 🎨 꾸미기 버튼 · 판(자금·Lv 반영)
      const mb = $('[data-act="mini"]');
      mb.hidden = !canMini; txt(mb, "📌 " + X("미니 보기", "Mini view")); mb.classList.toggle("on", !!miniWin);
      mb.title = ctx.api.openWidget ? X("미니 보기: 큰 창을 숨기고 작은 창만 다른 앱 위에 띄워요. 작은 창의 ⤢로 돌아와요", "Mini view: hide this window and float a small one above other apps. ⤢ brings it back")
        : miniWin ? X("미니 보기 창 닫기", "Close mini view") : X("미니 보기: 작은 창으로 다른 앱 위에 띄우기", "Mini view: float a small window above other apps");
    }

    /* ---------- 미니 보기 띄우기: 앱은 위젯 창만 남기고 큰 창 숨김), 브라우저는 Document PiP (포켓 모드와 같은 방식) ---------- */
    const pipApi = win.documentPictureInPicture, canMini = !!(ctx.api.openWidget || pipApi);
    let miniWin = null;
    const bindMini = pw => { miniWin = pw; ctx.listen(pw, "pagehide", () => { if (miniWin === pw) { miniWin = null; renderHud(); } }, { once: true }); };
    if (pipApi && pipApi.window && pipApi.window.document.body.dataset.mode === "studio") bindMini(pipApi.window);   // 다른 모드를 다녀오는 사이 열려 있던 창
    async function openMini() {
      // 실패 이유·10초 무응답은 코어가 toast로 보여 준다(core.js openWidget)
      if (ctx.api.openWidget) { Promise.resolve(ctx.api.openWidget("studio")).catch(e => win.console.warn("[studio] 위젯 창을 열 수 없어요", e)); return; }
      if (!pipApi) return;
      if (miniWin) { miniWin.close(); return; }
      let pw;
      try { pw = await pipApi.requestWindow({ width: 282, height: 162 }); } catch (e) { win.console.warn("[studio] PiP 창을 열 수 없어요", e); return; }
      const base = pw.document.createElement("base");   // 상대 경로(core/core.css·modes/studio/mode.css)를 이 탭 기준으로
      base.href = win.location.href; pw.document.head.append(base);
      pw.document.title = "Waitscape Studio";
      bindMini(pw); renderHud();
      try { await C.mount("studio", { doc: pw.document }); } catch (e) { win.console.error("[studio] 미니 보기 mount 실패", e); pw.close(); }
    }

    /* ---------- 오른쪽 패널 ---------- */
    const KROLE = { edit: ["개발자", "Dev"], bash: ["엔지니어", "Eng"], read: ["리서처", "Researcher"], search: ["리서처", "Researcher"], web: ["리서처", "Researcher"], agent: ["팀장", "Lead"], todo: ["기획자", "Planner"] };
    const roleOf = s => { let best = null, n = 0; Object.entries(s.kinds || {}).forEach(([k, v]) => { if (KROLE[k] && v > n) { best = k; n = v; } }); return best ? KROLE[best][ctx.lang === "en" ? 1 : 0] : X("신입", "Rookie"); };
    function statusText(f, a) {
      const s = f.s, ac = lastAct(s);
      if (f.kind === "ask") return a && a.loc === "boss" && a.goal === "boss" ? "❓ " + X("사장님께 질문 중", "asking the boss") : a && a.goal === "boss" ? "🛗 " + X("질문하러 이동 중", "heading down") : "❗ " + X("입력 필요 (대기)", "needs input (queued)");
      if (f.kind === "stall") { const secs = (s.health ? s.health.secs : 0) + stateAge(); return `💤 ${X("멍", "Zzz")} ${mmss(secs)} · ${X("멈춤 의심", "stalled?")}`; }
      if (f.layout === "meet") return "📋 " + X(`회의 중 · 아기 ×${f.ag.length}`, `meeting · baby ×${f.ag.length}`) + (f.ag[0] && f.ag[0].desc ? " · " + cut(f.ag[0].desc, 12) : "");
      if (f.kind === "work" || f.kind === "agents") { const sp = stepOf(s), rp = repOf(s), pre = sp ? `${sp.step}/${sp.total} · ` : "";
        return !ac && rp && rp.title ? `✍️ ${pre}${cfg.hideText ? X("작업 중", "working") : cut(rp.title, 22)}` : pre + (ac ? `${ac.icon} ${cut(ac.text, 26)}` : "⌨️ " + X("작업 중", "working")); }
      if (f.kind === "done") return (bigOf(s) ? "🎉 " + X("큰 일 완료", "big one done") : "✅ " + X("완료", "done")) + (s.run ? " · " + C.fmt(s.run) : "");
      return "☕ " + X("쉬는 중", "resting");
    }
    const secHtml = {};
    const setSec = (id, cls, inner) => { let e = side.querySelector("[data-sec=" + id + "]"); if (!e) { e = mkEl("section", "sec pn " + cls); e.dataset.sec = id; side.appendChild(e); } html(e, inner); return e; };
    function renderSide() {
      const st = ctx.state, now = ctx.now(); if (!st) return;
      const fl = model.floors;
      let cards = fl.map(f => {
        const a = actors.get(f.sid), sp = sprite(doc, BYID[f.animal], { view: "front", legs: "s", eyes: "o", prov: f.pk, shiny: f.shiny, trim: 1 }, 2), L = lvEmp(sv.dones[f.sid] || 0), col = PROV_COLOR[f.pk];
        return `<div class="card"><div class="th"><img alt="" src="${sp.url}" style="width:${sp.w}px;height:${sp.h}px"></div><div class="inf"><div class="r1"><span class="nm">${f.shiny ? "✨ " : ""}${esc(aName(f.animal))} <span style="color:${col}">· ${esc(f.pname)}</span></span><span class="role" style="background:${col}">${esc(roleOf(f.s))}</span><span style="margin-left:auto">Lv.${L.lv}</span></div><div class="xp"><i style="width:${L.pct}%"></i></div><div class="st">${esc(statusText(f, a))}</div></div></div>`;
      }).join("");
      if (!fl.length) cards = `<div class="none">${X("출근한 직원이 없어요. AI 코딩 세션을 켜면 동물 직원이 출근해요.", "Nobody is here yet. Start an AI coding session to hire your first animal.")}</div>`;
      if (model.more) cards += `<div class="none">＋ ${X(`${model.more}명 더 있어요 (층은 최대 ${MAXF}개)`, `${model.more} more not shown (max ${MAXF} floors)`)}</div>`;
      setSec("emp", "", `<h3><span>👥 ${X("직원", "Staff")} (${model.all ? model.all.length : 0})</span><span>${X("Lv · 경험치", "Lv · XP")}</span></h3>${cards}`);
      const lg = logs.slice(0, 4).map((e, i) => `<div style="opacity:${1 - i * .15}"><b>[${esc(C.hms(e.t).slice(0, 5))}]</b> ${esc(e.icon)} ${esc(e.text)}</div>`).join("") || `<div class="none">${X("아직 기록이 없어요", "No activity yet")}</div>`;
      setSec("log", "", `<h3><span>📜 ${X("스튜디오 로그", "Studio log")}</span><span>⏱ ${esc(mmss(now - startedAt))}</span></h3><div class="log">${lg}</div>`);
      const dc = dexCounts();
      setSec("dex", "dexcard", "").onclick = openDex;
      const dcard = side.querySelector("[data-sec=dex]"); dcard.setAttribute("role", "button"); dcard.tabIndex = 0;
      html(dcard, `<div class="tx">📖 ${X("직원 도감", "Staff dex")}<small>${dc.sp}/7 · ✨${dc.sh}</small></div><div class="ic">${SP.map(id => { const d = sv.dex[id] || {}, found = d.n || d.s, sp = sprite(doc, BYID[id], { view: "front", legs: "s", eyes: "o", sil: !found, shiny: !d.n && !!d.s, trim: 1 }, 2); return `<span><img alt="" src="${sp.url}" style="width:${sp.w}px;height:${sp.h}px">${d.s ? "<em>✨</em>" : ""}</span>`; }).join("")}</div>`);
      const lv = lvOf();
      setSec("shop", "", `<h3><span>🛒 ${X("상점 · 꾸미기", "Shop · decorate")}</span><span>💰 ${sv.funds.toLocaleString("en-US")}</span></h3><div class="shop">${SHOP.map(it => {
        const own = owned(it.id), locked = lv < it.lv, afford = sv.funds >= it.p, nm = it.n[ctx.lang === "en" ? 1 : 0];
        return `<button class="sb ${own ? "own" : locked || !afford ? "dis" : ""}" type="button" data-act="buy" data-id="${it.id}" ${own ? "disabled" : ""} title="${esc(locked ? X(`스튜디오 Lv.${it.lv}에 열려요`, `Unlocks at studio Lv.${it.lv}`) : "")}">${it.e} ${esc(nm)} <s>${own ? "✓" : locked ? "Lv." + it.lv : "💰" + (it.p >= 1000 ? (it.p / 1000).toFixed(it.p % 1000 ? 1 : 0) + "k" : it.p)}</s></button>`;
      }).join("")}</div><button type="button" class="sb dcgo" data-act="decor">🎨 ${X("층마다 꾸미기 (프로젝트별 소품)", "Decorate floors (per project)")}</button><div class="tip">${X("꾸미기는 보기용이에요 (기능 없음). 자금은 작업을 잘 마치거나 한도를 아껴 쓸 때 쌓여요.", "Decor is for looks only. Funds grow when you finish work well and pace your limits.")}</div>`);
      const stallN = model.all ? model.all.filter(f => f.kind === "stall").length : 0, okMin = Math.floor(okRun / 60);
      setSec("res", "res", `<h3><span>🏆 ${X("오늘의 성과", "Today")}</span></h3><div class="log">
        <div>✅ ${X("완료", "Done")} <b>${st.done_today || 0}</b>${X("건", "")} · ${X("자금", "Funds")} <b>+${sv.day.earned}</b></div>
        <div>⭐ ${X("페이스 준수", "On pace")} <b>${okMin >= 1 ? esc(C.fmt(okRun)) : "—"}</b> ${X("연속", "streak")}</div>
        <div>💤 ${X("멈춤 의심", "Stalled")} <b style="color:${stallN ? "#c85a5a" : "inherit"}">${stallN}${X("건", "")}</b>${stallN ? " · " + X("복구 대기", "waiting") : ""}</div>
        <div>🍼 ${X("서브에이전트 투입", "Sub-agents sent")} <b>${st.today_agents || 0}</b>${X("명", "")}</div></div>`);
    }
    function dexCounts() { let sp = 0, sh = 0; SP.forEach(id => { const d = sv.dex[id]; if (d && (d.n || d.s)) sp++; if (d && d.s) sh++; }); return { sp, sh }; }

    /* ---------- 도감 · 설정 오버레이 ---------- */
    function dexCell(id, shiny) {
      const d = sv.dex[id] || {}, date = shiny ? d.s : d.n, found = !!date;
      const sp = sprite(doc, BYID[id], { view: "front", legs: "s", eyes: "o", sil: !found, shiny, trim: 1 }, 4);
      return `<div class="cell ${shiny ? "s" : "n"}${found ? "" : " un"}"><span class="lb">${shiny ? "✨ " + X("반짝이", "Shiny") : X("일반", "Normal")}</span><div class="sp"><img alt="" src="${sp.url}" style="width:${sp.w}px;height:${sp.h}px"></div>${found && shiny ? `<i class="spk" style="left:14%;top:26%">✦</i><i class="spk" style="left:76%;top:20%;animation-delay:.4s">✦</i><i class="spk" style="left:84%;top:58%;animation-delay:.8s">✦</i>` : ""}<div class="d">${found ? X("첫 출근 ", "First day ") + esc(date) : shiny ? X("아직 못 만남", "Not met yet") : X("미발견", "Undiscovered")}</div></div>`;
    }
    function renderDex() {
      const dc = dexCounts(), bs = sprite(doc, BOSS, { view: "front", legs: "s", eyes: "o", boss: 1, trim: 1 }, 2);
      const on = id => cfg.animals.includes(id);
      const w = $(".dex .win");
      w.innerHTML = `<h2>📖 ${X("직원 도감", "Staff dex")} <span class="cnt">${dc.sp}/7 · ✨${dc.sh}</span><span class="mas"><img alt="" src="${bs.url}" style="width:${bs.w}px;height:${bs.h}px"><span>👑 ${X("사장님 햄찌 = 마스코트 (도감 7종과 별개)", "Boss hamster = mascot (not in the 7)")}</span></span><button class="x" type="button" data-act="dexclose">✕ ${X("닫기", "Close")}</button></h2>
      <div class="sub">${X("출근한 적 있는 동물만 등록돼요. 어떤 동물이 올지는 세션 ID로 정해지고(해시), ✨반짝이는 작업량과 무관한 순수한 운이에요 (확률 1/64).", "Only animals that showed up are listed. The animal comes from the session ID hash; ✨ shiny is pure luck (1/64), unrelated to workload.")}</div>
      <div class="grid">${SP.map(id => { const d = sv.dex[id] || {}; return `<div class="col"><div class="nm"><span>${d.n || d.s ? EMO[id] + " " + esc(aName(id)) : "❔ ???"}</span><span>${d.n && d.s ? "✓✨" : d.s ? "✨" : d.n ? "✓" : ""}</span></div>${dexCell(id, false)}${dexCell(id, true)}</div>`; }).join("")}</div>
      ${pkB.dexHtml()}
      <div class="set"><div><h4>⚙ ${X("설정 · 동물별 켜기/끄기", "Settings · animals on/off")}</h4><div class="chips">${SP.map(id => `<button class="chip ${on(id) ? "" : "off"}" type="button" data-act="animal" data-id="${id}">${EMO[id]} ${esc(aName(id))} ${on(id) ? "ON" : "OFF"}</button>`).join("")}</div>
        <h4 style="margin-top:8px">${X("모두 ○○로 고정", "Everyone is a …")}</h4><div class="chips"><button class="chip fx2 ${cfg.fixed ? "" : "on"}" type="button" data-act="fixed" data-id="">🎲 ${X("랜덤 (기본)", "Random")}</button>${SP.map(id => `<button class="chip fx2 ${cfg.fixed === id ? "on" : ""}" type="button" data-act="fixed" data-id="${id}" title="${esc(aName(id))}">${EMO[id]}</button>`).join("")}</div>
        <h4 style="margin-top:8px">${X("효과", "Effects")}</h4><div class="chips"><button class="chip ${cfg.sound ? "" : "off"}" type="button" data-act="soundcfg">🔊 ${X("타자 소리", "Typing sound")} ${cfg.sound ? "ON" : "OFF"}</button><button class="chip ${cfg.frags ? "" : "off"}" type="button" data-act="fragcfg">{ } ${X("코드 조각", "Code bits")} ${cfg.frags ? "ON" : "OFF"}</button><button class="chip ${cfg.weather ? "" : "off"}" type="button" data-act="wxcfg" title="${esc(X("주간 한도를 날씨로: 60% 구름 · 80% 비 · 90% 눈(옥상에 쌓임). 건물 밖 하늘과 창에만", "Weekly limit as weather: 60% clouds · 80% rain · 90% snow on the roof. Sky and windows only"))}">🌦️ ${X("날씨(주간 한도)", "Weather (weekly)")} ${cfg.weather ? "ON" : "OFF"}</button></div></div>
        <div><h4>🤫 ${X("화면 공유용", "For screen sharing")}</h4><div class="chips"><button class="chip ${cfg.hideText ? "" : "off"}" type="button" data-act="hidetext" title="${esc(X("켜면 회의 보드에 \"🤫 비밀 회의\"와 물결 낙서만 (✓는 그대로) · 층 이름표의 프로젝트도 숨김 · 미니 보기·퇴근 일보 카드도 같이", "Meeting boards show \"🤫 Secret meeting\" and squiggles (✓ stays), floor tags hide project names, mini view and daily report card too"))}">🤫 ${X("프로젝트·작업 문구 숨김", "Hide project & task text")} ${cfg.hideText ? "ON" : "OFF"}</button></div>
        ${drB.can ? `<h4 style="margin-top:8px">📋 ${X("퇴근 일보 · 고급: 퇴근 시각", "Daily report · advanced: clock-out time")}</h4><div class="chips">${[null, "17:00", "18:00", "18:30", "19:00", "20:00", "21:00"].map(t => `<button class="chip fx2 ${(cfg.offAt || null) === t ? "on" : ""}" type="button" data-act="offat" data-id="${t || ""}" title="${esc(t ? X(`${t}이 지나면 사장님이 일보를 들고 알려요(누르면 발표)`, `After ${t} the boss holds up the report (click to present)`) : X("기본: 오후에 45분 동안 조용하면 자동으로 알려요", "Default: notifies after 45 quiet minutes in the afternoon"))}">${t ? "⏰ " + t : X("끄기 (기본: 자동)", "Off (default: auto)")}</button>`).join("")}</div>
        <div class="chips" style="margin-top:6px"><button class="chip ${cfg.cardCheer ? "" : "off"}" type="button" data-act="cardcheer" title="${esc(X("AI가 MCP 보고로 남긴 칭찬 한마디(waitscape_status cheer)를 일보 카드·복사 텍스트의 사장님 말풍선에 넣어요. 공유용이라 기본은 꺼짐 · 🤫 숨김이 켜져 있으면 넣지 않아요", "Put the AI's cheer line (from MCP reports) in the boss bubble of the report card and copied text. Off by default since cards get shared; never with 🤫 on"))}">✍️ ${X("카드에 AI 한마디", "AI cheer on card")} ${cfg.cardCheer ? "ON" : "OFF"}</button></div>` : ""}</div></div>
        <div class="roster"><h4>🎲 ${X("지금 출근 · 세션 ID → 해시 → 동물", "On duty · session ID → hash → animal")}</h4>${model.floors.map((f, i) => `<div><b>${nSess + 1 - i}F</b> #${esc(f.sid.slice(0, 4))} → ${f.shiny ? "✨ " : ""}${EMO[f.animal]} <b>${esc(aName(f.animal))}</b> · <span style="color:${PROV_COLOR[f.pk]};font-weight:900">${esc(f.pname)} ${ACC_NAME[f.pk][ctx.lang === "en" ? 1 : 0]}</span></div>`).join("") || `<div>${X("아직 없음", "Nobody yet")}</div>`}<div>🍼 ${X("서브에이전트 = 부모 동물의 아기 버전", "Sub-agent = baby version of its parent")}</div></div></div>
      <div class="note">💡 ${X("도감에는 처음 출근한 날만 기록해요 · 설정에서 꺼 둔 동물도 도감 기록은 그대로 · 👑 사장님 햄찌는 고정 마스코트 · 같은 세션은 항상 같은 동물이에요 (해시가 같으니까요). 소리·코드 조각은 회의 모드나 탭이 숨겨졌을 때 자동으로 멈춰요.", "The dex only records the first day. Disabled animals keep their record. The boss hamster is a fixed mascot. The same session is always the same animal (same hash). Sound and code bits stop automatically in quiet mode or when the tab is hidden.")}</div>`;
    }
    function openDex() { renderDex(); dexEl.classList.add("on"); const x = dexEl.querySelector('[data-act="dexclose"]'); if (x) x.focus(); }
    const closeDex = () => dexEl.classList.remove("on");

    /* ---------- 입력 ---------- */
    ctx.listen(root, "click", e => {
      if (e.target === dexEl) return closeDex();
      const b = e.target.closest("[data-act]"); if (!b) return;
      const act = b.dataset.act, id = b.dataset.id;
      if (dcB.on() && (act === "poke" || act === "jump" || act === "term")) return;   // 🎨 꾸미기 중엔 👆 반응·세션 이동을 쉼
      if (act === "mini") openMini();
      else if (act === "decor") dcB.tap("dc-toggle", b);
      else if (act.startsWith("dc-")) dcB.tap(act, b);   // 🎨 층 탭·칸·소품 카드·옮기기·되팔기
      else if (act === "sound") { cfg.sound = !cfg.sound; saveCfg(); renderHud(); if (cfg.sound) ctx.audio(); }
      else if (act === "quiet") ctx.settings.setQuiet && ctx.settings.setQuiet(!ctx.settings.quiet);
      else if (act === "dex") openDex();
      else if (act === "dexclose") closeDex();
      else if (act === "side") side.classList.toggle("on");
      else if (act === "poke") { if (!drB.active()) pkB.tap(b, e); }   // 👆 클릭 반응 (일보 연출 중엔 쉼)
      else if (act.startsWith("dr-")) drB.tap(act);   // 📋 퇴근 일보
      else if (act === "offat") { cfg.offAt = id || null; saveCfg(); renderDex(); drB.poll(); }
      else if (act === "term") { if (canTerm) Promise.resolve(ctx.api.openTerminal(b.dataset.sid)).catch(() => {}); }
      else if (act === "jump") { if (!drB.active()) pkB.jump(b.dataset.sid); }   // 🖥️ 층 이름표·단계 명패 → 그 세션 (모니터는 POKE 반응만)
      else if (act === "update") { if (ctx.core.update) ctx.core.update.open(); }
      else if (act === "nxdoor") { NX.ring(clockT()); if (soundOk() && cfg.sound) PK.play(ctx.audio(), "bell"); if (!animOn()) staticDraw(); }   // 🙈 현관 종(깨알)
      else if (act === "buy") { const it = SHOP.find(x => x.id === id); if (it && !owned(id) && sv.funds >= it.p && lvOf() >= it.lv) { sv.funds -= it.p; sv.shop[id] = 1; saveSoon(); pushLog("🛒", X(`${it.n[0]} 구입! (보기용)`, `Bought ${it.n[1]}!`)); sync(); } }
      else if (act === "animal") { const i = cfg.animals.indexOf(id); if (i >= 0) { if (cfg.animals.length > 1) cfg.animals.splice(i, 1); } else cfg.animals.push(id); saveCfg(); buildSig = ""; sync(); renderDex(); }
      else if (act === "fixed") { cfg.fixed = id || null; saveCfg(); buildSig = ""; sync(); renderDex(); }
      else if (act === "soundcfg") { cfg.sound = !cfg.sound; saveCfg(); renderHud(); renderDex(); if (cfg.sound) ctx.audio(); }
      else if (act === "fragcfg") { cfg.frags = !cfg.frags; saveCfg(); renderDex(); }
      else if (act === "wxcfg") { cfg.weather = !cfg.weather; saveCfg(); renderDex(); renderHud(); if (!animOn()) staticDraw(); }
      else if (act === "cardcheer") { cfg.cardCheer = !cfg.cardCheer; saveCfg(); renderDex(); }
      else if (act === "hidetext") { cfg.hideText = !cfg.hideText; saveCfg(); renderDex(); if (!animOn()) staticDraw(); }
    });
    ctx.listen(doc, "keydown", e => { if (e.key === "Escape" && dexEl.classList.contains("on")) closeDex(); else if (dcB.key(e)) e.preventDefault(); else if ((e.key === "Enter" || e.key === " ") && e.target && e.target.dataset && e.target.dataset.sec === "dex") { e.preventDefault(); openDex(); } });
    ctx.listen(win, "resize", layout);

    /* ---------- 루프: 움직일 때만 rAF, 회의 모드·탭 숨김·움직임 줄이기면 정적 ---------- */
    const rm = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    const animOn = () => !ctx.settings.quiet && !rm.matches && !doc.hidden && !NX.hidden;   // 🙈 블라인드 뒤에는 정적(1초마다)
    let stopLoop = null, lastTs = 0, lastDraw = 0;
    const staticDraw = () => { lastTs = 0; frame(0, 0, false); };
    function ensureLoop() {
      if (animOn()) {
        if (!stopLoop) stopLoop = ctx.loop(ts => {
          if (!animOn()) { stopLoop = null; staticDraw(); return false; }
          if (ts - lastDraw < 38) return;
          const dt = lastTs ? Math.min(.1, (ts - lastTs) / 1000) : 0; lastTs = ts; lastDraw = ts;
          frame(ts / 1000, dt, true);
        });
      } else { if (stopLoop) { stopLoop(); stopLoop = null; } staticDraw(); }
    }
    ctx.listen(doc, "visibilitychange", ensureLoop);
    if (rm.addEventListener) ctx.listen(rm, "change", ensureLoop);
    if (doc.fonts && doc.fonts.addEventListener) ctx.listen(doc.fonts, "loadingdone", () => { fontGen++; });   // 층 이름표 맞춤(#64) 다시 잼
    ctx.on("settings", () => { buildSig = ""; sync(); renderHud(); ensureLoop(); });
    ctx.on("update", () => sync());   // 새 버전 알림(사장님 말풍선)
    ctx.every(1000, () => { pkB.reload(); drB.tick(); renderHud(); if (ctx.state) renderSide(); flush(); layout(); if (!animOn() && FL.length) staticDraw(); });

    sync();
    if (!FL.length) { buildSig = "init"; build(); renderHud(); renderSide(); }
    if (ctx.nunchi && ctx.nunchi.phase === "plain") nxHide();   // 🙈 눈치 화면이 덮은 채로 올라옴(다시 켠 앱·모드 전환)
    ensureLoop();
    return {
      update() { sync(); },
      unmount() { flush(); if (NX.res) { NX.res(); NX.res = null; } },   // 퇴장 연출 중 다른 모드로 바뀌면 코어가 기다리지 않게
      /* 🙈 눈치 모드 훅(core/nunchi.js): leave → Promise(다 나가면) | null(블라인드만) · hide · arrive { long, say } */
      nunchi(ev, o) { return ev === "leave" ? nxLeave() : ev === "hide" ? nxHide() : ev === "arrive" ? nxArrive(o || {}) : null; },
      nunchiOrder: () => model.floors.map(f => f.sid),   // 눈치 화면 표 = 층 순서(맨 위층부터)
      /* 앱 우클릭 메뉴의 제목 줄: 그 직원 이름표 "🐱 waitscape · 실행 중"(눈치 모드면 코어가 이모지를 뗌) */
      contextTitle: sid => { const f = model.floors.find(x => x.sid === sid), a = actors.get(sid); return f ? `${EMO[f.animal]} ${cfg.hideText ? X("비공개", "Private") : f.s.project} · ${a ? chipOf(f, a)[0] : ""}` : null; },
    };
  },
});
})();

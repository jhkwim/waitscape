#!/usr/bin/env node
// 📔 목격 일지(#112) 테스트: 목록(무리·이름·조건·힌트 ko/en) · 저장 읽기/쓰기 · 개발용 쿼리 · 본체에서 부르는 h.spot id가 모두 목록에 있고 목록 id가 모두 불림 (Node만): node scripts/test_studio_spot.js
// web/modes/studio/mode.js에서 NAP·SPOT 부분만 떼어 실행한다(DOM 없이).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
global.location = { search: "" };
const code = cut("function fnv(", "\n") + "\n" + cut("const NAP = (() => {", "/* ---------- 😴 큰 화면") + "\n" + cut("const SPOT = (() => {", "/* ---------- 📔 큰 화면");
const S = new Function(code + "\nreturn SPOT;")();

// 목록: 29개 · id 겹치지 않음 · 무리는 정의된 것만 · 무리마다 하나 이상 · 글자 ko/en 모두 있음
assert.strictEqual(S.LIST.length, 29);
assert.strictEqual(new Set(S.LIST.map(x => x.id)).size, S.LIST.length, "id 중복");
const G = new Set(S.GROUPS.map(g => g.id));
S.LIST.forEach(x => { assert.ok(G.has(x.g), x.id + " 무리"); assert.ok(x.e, x.id + " 아이콘");
  ["n", "c", "h"].forEach(k => assert.ok(Array.isArray(x[k]) && x[k].length === 2 && x[k].every(t => typeof t === "string" && t.trim()), `${x.id}.${k} ko/en`)); });
S.GROUPS.forEach(g => assert.ok(S.LIST.some(x => x.g === g.id), g.id + " 비어 있음"));
assert.deepStrictEqual(S.LIST.filter(x => x.id.startsWith("lunch-")).map(x => x.id), ["lunch-bento", "lunch-ramen", "lunch-onigiri", "lunch-sandwich"], "점심 메뉴 = NAP.MENUS");
assert.ok(S.LIST.filter(x => x.id.startsWith("lunch-")).every(x => x.n[1][0] === x.n[1][0].toUpperCase()), "영어 메뉴 이름 첫 글자 대문자");

// 저장: 왕복 · 잘못된 값 버림 · 모르는 id는 그대로 · 새 버전이면 읽기만
const s = S.load(JSON.stringify({ v: 1, s: { doze: 1700000000000, future_thing: 1700000000001, bad: "x", neg: -1, inf: null } }));
assert.deepStrictEqual(s.s, { doze: 1700000000000, future_thing: 1700000000001 });
assert.strictEqual(s.ro, false);
assert.strictEqual(S.count(s), 1, "모르는 id는 개수에 안 셈");
assert.deepStrictEqual(S.load(S.dump(s)).s, s.s, "왕복");
["", "null", "[]", "{", "{\"s\":[1]}", "{\"s\":\"x\"}"].forEach(r => assert.deepStrictEqual(S.load(r).s, {}, "깨진 저장: " + r));
assert.strictEqual(S.load(JSON.stringify({ v: 2, s: { doze: 1 } })).ro, true, "새 버전이면 읽기만");
assert.strictEqual(S.load(JSON.stringify({ v: 2, s: { doze: 1 } })).s.doze, 1, "새 버전도 본 것은 보여 줌");

// 개발용 쿼리: 있으면 기록 안 함 · ?spot=all은 다 본 척
assert.deepStrictEqual(S.devOf(""), { ro: false, all: false });
["?tiny=desk", "?nap=1", "?wx=rain", "?evt=pizza", "?gacha=x", "?treat=on", "?dinner=a", "?season=10-31", "?mode=studio&nap=lunch"].forEach(q => assert.strictEqual(S.devOf(q).ro, true, q));
assert.deepStrictEqual(S.devOf("?spot=all"), { ro: true, all: true });
assert.strictEqual(S.devOf("?mode=studio&lang=en").ro, false, "개발용이 아닌 쿼리는 기록함");

// 본체: h.spot("…") 문자열 id는 모두 목록에 · 목록 id는 모두 어딘가에서 불림(점심·날씨는 템플릿)
const used = new Set([...src.matchAll(/h\.spot\("([a-z0-9-]+)"\)/g)].map(m => m[1]));
const tern = [...src.matchAll(/h\.spot\(([^)]*\?[^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/[?:] "([a-z0-9-]+)"/g)].map(x => x[1]));   // 삼항의 결과 쪽만(조건의 "q" 같은 건 빼고)
tern.forEach(id => used.add(id));
used.forEach(id => assert.ok(S.BY[id], "목록에 없는 id: " + id));
assert.ok(/h\.spot\("lunch-" \+ m\.id\)/.test(src), "점심 메뉴 기록");
assert.ok(/h\.spot\("wx-" \+ E\.wxK\)/.test(src), "날씨 기록");
S.LIST.filter(x => !x.id.startsWith("lunch-") && !x.id.startsWith("wx-")).forEach(x => assert.ok(used.has(x.id), "어디서도 안 부르는 id: " + x.id));

// 날씨: WX.KINDS의 모든 종류가 목록에 있음(종류가 늘면 여기서 잡힘)
const WX = new Function(cut("const WX = (() => {", "\nfunction ").replace(/^/, "") + "\nreturn WX;")();
WX.KINDS.forEach(k => assert.ok(S.BY["wx-" + k], "날씨 종류가 목록에 없음: " + k));
assert.deepStrictEqual(S.LIST.filter(x => x.mo).map(x => x.id).sort(), ["bonk", "yawn"], "움직임 전용 장면");

// spotBig: 한 번만 지급 · 숨김/새 버전/개발용이면 지급 없음 · 다른 창이 먼저 봤으면 지급 없음 · 움직임 줄이기면 분모에서 뺌
const big = cut("/* ---------- 📔 큰 화면", "C.registerMode({");
const mkBig = (o = {}) => {
  const store = new Map(Object.entries(o.store || {})), paid = [];
  global.location = { search: o.q || "" };
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const f = new Function("SPOT", "esc", big + "\nreturn spotBig;")(S, esc);
  let hidden = !!o.hidden, anim = o.anim !== false;
  const B = f({ ctx: { lang: "ko", store: { get: (k, d) => store.has(k) ? store.get(k) : d, set: (k, v) => store.set(k, v) } }, doc: { hidden: false },
    mkEl: () => ({ style: {} }), sty: () => {}, html: () => {}, X: (a) => a, main: {}, clockT: () => 0, hidden: () => hidden,
    spend: v => paid.push(v), saveNow: () => {}, float: () => {}, log: () => {}, hud: () => {}, anim: () => anim, redex: () => {} });
  return { B, store, paid, setHidden: v => (hidden = v), setAnim: v => (anim = v) };
};
const realNow = Date.now; let fake = 1e12; Date.now = () => (fake += 1500);   // 다른 창 확인 1초 간격을 넘기며
{ const t = mkBig(); t.B.see("doze"); t.B.see("doze"); assert.deepStrictEqual(t.paid, [-5], "한 번만 지급");
  assert.ok(JSON.parse(t.store.get("spot")).s.doze > 0, "저장"); assert.strictEqual(t.B.n(), 1);
  t.B.see("nope"); assert.strictEqual(t.paid.length, 1, "모르는 id 무시"); }
{ const t = mkBig({ hidden: true }); t.B.see("doze"); assert.deepStrictEqual(t.paid, [], "숨김이면 안 셈"); t.setHidden(false); t.B.see("doze"); assert.deepStrictEqual(t.paid, [-5]); }
{ const t = mkBig({ q: "?nap=1" }); t.B.see("doze"); assert.deepStrictEqual(t.paid, [], "개발용 쿼리"); assert.ok(!t.store.has("spot"), "개발용은 저장 안 함"); }
{ const t = mkBig({ store: { spot: JSON.stringify({ v: 2, s: {} }) } }); t.B.see("doze"); assert.deepStrictEqual(t.paid, [], "새 버전이면 읽기만"); }
{ const t = mkBig(); t.store.set("spot", JSON.stringify({ v: 1, s: { cups: 5 } })); t.B.see("cups"); assert.deepStrictEqual(t.paid, [], "다른 창이 먼저 봄"); }
{ const t = mkBig({ anim: false }); assert.strictEqual(t.B.total(), S.LIST.length - 2, "움직임 줄이기: 못 본 움직임 장면은 분모에서 뺌");
  t.setAnim(true); assert.strictEqual(t.B.total(), S.LIST.length); }
{ const t = mkBig({ q: "?spot=all" }); assert.strictEqual(t.B.n(), S.LIST.length, "?spot=all"); t.B.see("doze"); assert.deepStrictEqual(t.paid, []); }
Date.now = realNow;

console.log("studio spot ok —", S.LIST.length, "sightings");

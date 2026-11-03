#!/usr/bin/env node
// 🎲 스튜디오 랜덤 이벤트(#100) 테스트: 다음 이벤트 간격 · 고르기(🌠 밤만·드묾) · 보상 액수 · 하루 5번(새벽 4시 경계) · 저장 형식(새 버전은 읽기만) · 개발용은 저장 안 함 (Node만): node scripts/test_studio_events.js
// web/modes/studio/mode.js에서 TINY(하루 경계)·EVT 부분만 떼어 실행한다(DOM 없이, rng 주입).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
global.location = { search: "" };
const code = cut("const P0", "/* ================= 모드 ================= */") + cut("const TINY = (() => {", "/* ---------- ☕ 큰 화면") + cut("const EVT = (() => {", "/* ---------- 🎲 큰 화면");
const { EVT: V, TINY } = new Function("C", code + "\nreturn { EVT, TINY };")({ muxName: () => "" });
const seq = a => { let i = 0; return () => a[i++ % a.length]; };
let x = 777; const lcg = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296;

// 종류 6 · 보상 액수 · 머무는 시간(🌠 8초, 나머지 60초)
assert.deepStrictEqual(V.KINDS, ["pizza", "box", "cat", "printer", "balloon", "star"]);
assert.deepStrictEqual(V.KINDS.map(k => V.pay(k, () => 0)), [20, 10, 15, 20, 10, 30]);
assert.strictEqual(V.pay("box", () => .9999), 40); assert.strictEqual(V.pay("box", () => 0), 10);
for (let i = 0; i < 2000; i++) { const p = V.pay("box", lcg); assert.ok(p >= 10 && p <= 40 && p % 5 === 0, "택배 10~40(5 단위): " + p); }
assert.strictEqual(V.stay("star"), 8); assert.strictEqual(V.stay("pizza"), 60);
V.KINDS.forEach(k => { assert.ok(V.ICON[k] && V.NAME[k] && V.NAME[k].length === 2, k + " 이름·아이콘(ko·en)"); });

// 다음 이벤트까지 25~50분(양 끝 포함)
assert.strictEqual(V.gap(() => 0), 25 * 60); assert.strictEqual(V.gap(() => .99999999), 50 * 60);
for (let i = 0; i < 5000; i++) { const g = V.gap(lcg); assert.ok(Number.isInteger(g) && g >= 1500 && g <= 3000, "간격 " + g); }

// 고르기: 나올 수 있는 것만 · 🌠는 밤에만 · 드묾(무게 1 : 다른 것 3)
const all = () => true, day = k => k !== "star";
assert.strictEqual(V.pick(lcg, () => false), "", "아무것도 못 나오면 빈 문자열");
assert.strictEqual(V.pick(() => .999, k => k === "star"), "star");
for (let i = 0; i < 3000; i++) assert.notStrictEqual(V.pick(lcg, day), "star", "낮엔 별똥별 없음");
const cnt = {}, N = 160000; for (let i = 0; i < N; i++) { const k = V.pick(lcg, all); cnt[k] = (cnt[k] || 0) + 1; }
assert.ok(Math.abs(cnt.star / N - 1 / 16) < .006, "별똥별 ≈ 1/16: " + cnt.star / N);
["pizza", "box", "cat", "printer", "balloon"].forEach(k => assert.ok(Math.abs(cnt[k] / N - 3 / 16) < .008, k + " ≈ 3/16"));
assert.strictEqual(V.pick(seq([0]), k => k === "cat" || k === "balloon"), "cat"); assert.strictEqual(V.pick(seq([.99]), k => k === "cat" || k === "balloon"), "balloon");

// 하루 5번 · 새벽 4시 경계(TINY.dayKey와 같은 함수)
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm || 0).getTime() / 1000;
let s = V.load("");
for (let i = 0; i < 5; i++) { const r = V.claim(s, "pizza", at(2026, 11, 3, 10, i), () => 0, false); assert.deepStrictEqual(r, { amt: 20, save: true, capped: false }); }
assert.strictEqual(s.got, 5); assert.strictEqual(s.day, "2026-11-03"); assert.strictEqual(s.day, TINY.dayKey(at(2026, 11, 3, 10)));
let r = V.claim(s, "cat", at(2026, 11, 4, 3, 59), () => 0, false);   // 새벽 3:59 = 아직 어제
assert.deepStrictEqual(r, { amt: 0, save: true, capped: true }, "6번째: 보상 없이 반응만(만난 횟수는 셈)");
assert.strictEqual(s.n.cat, 1); assert.strictEqual(s.n.pizza, 5); assert.strictEqual(s.got, 5);
r = V.claim(s, "star", at(2026, 11, 4, 4, 0), () => 0, false);   // 새벽 4시 = 새 날
assert.deepStrictEqual(r, { amt: 30, save: true, capped: false }); assert.strictEqual(s.day, "2026-11-04"); assert.strictEqual(s.got, 1);
assert.strictEqual(V.gotOn(s, "2026-11-04"), 1); assert.strictEqual(V.gotOn(s, "2026-11-05"), 0, "날이 바뀌면 0부터");
assert.strictEqual(V.count(s), 3, "만난 종류(🎲 n/6)");
assert.deepStrictEqual(V.claim(s, "constructor", at(2026, 11, 4, 5), () => 0, false), { amt: 0, save: false, capped: false }, "모르는 종류는 무시");

// 개발용(?evt=): 저장·보상·만난 횟수 모두 그대로(#88처럼 실제 자금을 건드리지 않게)
const before = V.dump(s);
r = V.claim(s, "box", at(2026, 11, 4, 6), () => .5, true);
assert.deepStrictEqual(r, { amt: 0, save: false, capped: false }); assert.strictEqual(V.dump(s), before, "개발용이면 저장 객체도 안 바뀜");
assert.strictEqual(V.devOf("?evt=pizza"), "pizza"); assert.strictEqual(V.devOf("?mode=studio&evt=star"), "star");
assert.strictEqual(V.devOf("?evt=nope"), ""); assert.strictEqual(V.devOf(""), ""); assert.strictEqual(V.devOf("?evt=constructor"), "");
// 본체 연결: 개발용이면 save()가 저장소를 건드리지 않음 · 자금은 보상이 있을 때만(개발용은 0)
assert.ok(/const save = \(\) => \{ if \(!s\.ro && !dev\)/.test(src), "eventBig save는 개발용·새 버전이면 쓰지 않음");
assert.ok(/if \(r\.amt\) \{ h\.spend\(-r\.amt\)/.test(src), "자금은 실제 보상이 있을 때만");

// 저장: 왕복 · 모르는 종류 보존 · 잘못된 값 버림 · 새 버전(v > 1)은 읽기만(보상·저장 없음)
const raw = JSON.stringify({ v: 1, n: { pizza: 2, ufo: 1, cat: -1, box: "3", star: 1.5 }, day: "2026-11-03", got: 9, junk: 1 });
const L = V.load(raw);
assert.deepStrictEqual(Object.assign({}, L.n), { pizza: 2, ufo: 1 }); assert.strictEqual(L.got, 5, "got은 5를 넘지 않음"); assert.strictEqual(L.day, "2026-11-03");
assert.deepStrictEqual(JSON.parse(V.dump(L)), { v: 1, n: { pizza: 2, ufo: 1 }, day: "2026-11-03", got: 5 });
assert.deepStrictEqual(JSON.parse(V.dump(V.load(V.dump(L)))), JSON.parse(V.dump(L)), "왕복");
assert.strictEqual(V.count(L), 1, "모르는 종류는 n/6에서 빠짐");
assert.deepStrictEqual(JSON.parse(V.dump(V.load("깨짐"))), { v: 1, n: {}, day: "", got: 0 }); assert.ok(!V.load("깨짐").ro); assert.strictEqual(V.load("").got, 0);
assert.strictEqual(V.load(JSON.stringify({ v: 1, day: "어제", got: 3 })).got, 0, "날이 이상하면 got 0");
const P = V.load('{"v":1,"n":{"__proto__":{"x":1},"pizza":1}}'); assert.strictEqual(P.n.pizza, 1); assert.strictEqual(Object.getPrototypeOf(P.n), null);
const R = V.load(JSON.stringify({ v: 2, n: { pizza: 3, comet: 2 }, day: "2026-11-03", got: 1 }));
assert.ok(R.ro && !L.ro && !V.load("").ro);
const rb = V.dump(R); r = V.claim(R, "pizza", at(2026, 11, 3, 12), () => 0, false);
assert.deepStrictEqual(r, { amt: 0, save: false, capped: false }, "새 버전 저장: 반응만"); assert.strictEqual(V.dump(R), rb);
assert.strictEqual(V.count(R), 1, "새 버전도 읽기(🎲 n/6)는 됨");

// 그림: 모든 줄이 같은 폭(문자 그림 → 도트)
Object.entries(V.ART).forEach(([k, a]) => { const w = a.r[0].length; a.r.forEach((row, i) => assert.strictEqual(row.length, w, `${k} ${i}줄 폭`)); [...a.r.join("")].forEach(c => assert.ok(c === "." || c === "C" || a.p[c], `${k}: 팔레트에 없는 ${c}`)); });
assert.strictEqual(V.ART.dogB.r.length, V.ART.dog.r.length); assert.strictEqual(V.ART.catB.r.length, V.ART.cat.r.length); assert.strictEqual(V.ART.boxO.r.length, V.ART.box.r.length, "열린 상자도 같은 크기");
console.log("studio events: ok");

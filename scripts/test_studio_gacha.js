#!/usr/bin/env node
// 🎰 스튜디오 캡슐 뽑기(#86) 테스트: 확률 · 중복 환급 · 입사 지원서 소진 · 저장 형식 · 착용(같은 직원 = 프로젝트 + 프로바이더) · 액세서리 그림 (Node만): node scripts/test_studio_gacha.js
// web/modes/studio/mode.js에서 스프라이트·DECOR·GACHA 부분만 떼어 실행한다(DOM 없이, rng 주입).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
global.location = { search: "" };
const code = cut("const P0", "/* ================= 모드 ================= */") + cut("const DECOR = (() => {", "/* ---------- 🎨 큰 화면") + cut("const GACHA = (() => {", "/* ---------- 🎰 큰 화면");
const M = new Function("C", code + "\nreturn { GACHA, DECOR, GA_ACC, BYID, CH, mkG };")({ muxName: () => "" });
const { GACHA: GA, DECOR, GA_ACC, BYID, CH, mkG } = M;

// 카탈로그: 16종(액세서리 8 · 책상 6 · 지원서 2) · 책상 소품은 DECOR "gacha" 팩(팔지 않음)
assert.strictEqual(GA.ITEMS.length, 16);
assert.deepStrictEqual(["acc", "desk", "app"].map(k => GA.ITEMS.filter(it => it.k === k).length), [8, 6, 2]);
GA.ITEMS.filter(it => it.k === "desk").forEach(it => { assert.ok(DECOR.ITEMS[it.id] && DECOR.ITEMS[it.id].slot === "desk"); assert.strictEqual(DECOR.onSale(it.id, 1e9), false, it.id + " 는 팔지 않음"); });
assert.strictEqual(DECOR.onSale("cactus", 1e9), true, "기본 소품은 그대로 판매");
assert.strictEqual(GA.PRICE, 150); assert.strictEqual(GA.back(), 60);

// 확률: rng 주입 — 등급 경계(전설 < 5 ≤ 드묾 < 30 ≤ 흔함)
const seq = a => { let i = 0; return () => a[i++ % a.length]; };
const allLocked = () => true, none = () => false;
const t = r => GA.roll(GA.load(""), seq([r, 0]), allLocked).it.t;
assert.strictEqual(t(0), "l"); assert.strictEqual(t(.0499), "l"); assert.strictEqual(t(.05), "r"); assert.strictEqual(t(.2999), "r"); assert.strictEqual(t(.30), "c"); assert.strictEqual(t(.9999), "c");
// 분포(고정 시드 LCG 20만 번): 70/25/5 ± 0.6%p
let x = 12345; const lcg = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296;
const cnt = { c: 0, r: 0, l: 0 }, N = 200000, d0 = GA.load("");
for (let i = 0; i < N; i++) cnt[GA.roll(d0, lcg, allLocked).it.t]++;
Object.entries(GA.RATES).forEach(([k, p]) => assert.ok(Math.abs(cnt[k] / N * 100 - p) < .6, `${k} ${cnt[k] / N * 100}%`));

// 중복 환급 · 저장 반영
let d = GA.load("");
const r1 = GA.roll(d, seq([.5, 0]), allLocked); assert.strictEqual(r1.dup, false); assert.strictEqual(r1.back, 0); GA.apply(d, r1, 100);
const r2 = GA.roll(d, seq([.5, 0]), allLocked); assert.strictEqual(r2.it.id, r1.it.id); assert.strictEqual(r2.dup, true); assert.strictEqual(r2.back, 60); GA.apply(d, r2, 200);
assert.deepStrictEqual(d.own[r1.it.id], { n: 2, t: 100 }); assert.strictEqual(d.n, 2); assert.strictEqual(d.spent, 300); assert.strictEqual(d.back, 60);

// 입사 지원서: 잠긴 동물만 · 뽑으면 다시 안 나옴 · 둘 다 풀리면 풀에서 빠짐 · 비면 다른 등급으로
const apps = d1 => GA.poolOf(d1, allLocked).filter(it => it.k === "app").map(it => it.id);
d = GA.load(""); assert.deepStrictEqual(apps(d), ["app_owl", "app_hog"]);
GA.apply(d, { it: GA.BY.app_owl, dup: false, back: 0 }, 1); assert.deepStrictEqual(apps(d), ["app_hog"]);
assert.deepStrictEqual(GA.poolOf(GA.load(""), id => id === "hog").filter(it => it.k === "app").map(it => it.id), ["app_hog"], "풀린 부엉이 지원서는 빠짐");
assert.ok(!GA.poolOf(GA.load(""), none).some(it => it.k === "app"));
for (let i = 0; i < 2000; i++) assert.notStrictEqual(GA.roll(GA.load(""), lcg, none).it.k, "app");

// 착용: 같은 직원 = 프로바이더 + 프로젝트 · 가진 것만 · 슬롯이 맞는 것만
d = GA.load(""); const k = GA.staffKey("waitscape", "claude");
assert.strictEqual(k, "claude|waitscape"); assert.notStrictEqual(k, GA.staffKey("waitscape", "codex"));
GA.setWear(d, k, "h", "crown", 5); assert.strictEqual(GA.wearOf(d, k), null, "안 가진 건 안 씀");
GA.apply(d, { it: GA.BY.crown, dup: false, back: 0 }, 1); GA.apply(d, { it: GA.BY.sun, dup: false, back: 0 }, 1);
GA.setWear(d, k, "f", "sun", 6); assert.deepStrictEqual(GA.wearOf(d, k), { ac: "crown", af: "sun" });
GA.setWear(d, k, "h", "", 7); assert.deepStrictEqual(GA.wearOf(d, k), { ac: undefined, af: "sun" });
d.wear.bad = { h: "sun", f: "crown", t: 1 }; assert.strictEqual(GA.wearOf(d, "bad"), null, "슬롯이 틀리면 무시");
for (let i = 0; i < 230; i++) GA.setWear(d, "p|" + i, "h", "crown", 100 + i);
assert.ok(Object.keys(d.wear).length <= 200 && d.wear["p|229"] && !d.wear["p|0"], "착용 200개까지(오래된 것부터 정리)");

// 저장: 왕복 · 모르는 id 보존 · 잘못된 값 버림 · 새 버전은 읽기만(ro)
const raw = JSON.stringify({ v: 1, own: { crown: { n: 2, t: 9 }, future_hat: { n: 1, t: 3 }, bad: { n: "x" } }, wear: { "claude|a": { h: "crown", t: 1 }, "x|y": { h: 5 } }, n: 3, spent: 450, back: 60, last: { id: "crown", t: 9, dup: true } });
const L = GA.load(raw);
assert.deepStrictEqual(Object.keys(L.own).sort(), ["crown", "future_hat"]); assert.deepStrictEqual(Object.keys(L.wear), ["claude|a"]);
assert.deepStrictEqual(JSON.parse(GA.dump(L)), JSON.parse(GA.dump(GA.load(GA.dump(L)))), "왕복");
assert.ok(!L.ro && GA.load(JSON.stringify({ v: 2 })).ro && !GA.load("깨짐").ro);
assert.strictEqual(GA.count(L).have, 1, "모르는 id는 도감 수에서 빠짐");

// 그림: 11종 모두 액세서리를 쓰면 그림이 바뀌고, 머리 = 프로바이더 모자 대신 · 얼굴 = Gemini 안경 대신 · 아기·반짝이와 겹쳐도 됨
const G = (id, o) => JSON.stringify(mkG(BYID[id], Object.assign({ legs: "s" }, o)));
for (const ch of CH) for (const a of Object.keys(GA_ACC)) {
  const o = { [GA_ACC[a].s === "h" ? "ac" : "af"]: a };
  assert.notStrictEqual(G(ch.id, o), G(ch.id, {}), `${ch.id} ${a}`);
  assert.doesNotThrow(() => G(ch.id, Object.assign({ baby: 1, shiny: 1, aloha: 1, seated: 1, prov: "codex" }, o)));
}
const hasV = g => g.includes('"V"');
assert.ok(hasV(G("ham", { prov: "codex" })) && !hasV(G("ham", { prov: "codex", ac: "cone" })), "머리 액세서리 → 비니 대신");
assert.ok(hasV(G("ham", { prov: "gemini" })) && !hasV(G("ham", { prov: "gemini", af: "sun" })), "얼굴 액세서리 → 안경 대신");
assert.ok(hasV(G("ham", { prov: "claude", ac: "crown" })), "목도리는 그대로");
const tall = mkG(BYID.ham, { legs: "s", ac: "cone" }), base = mkG(BYID.ham, { legs: "s" });
assert.ok(tall.length > base.length && tall.pre === tall.length - base.length, "머리 위로 넘치면 줄이 늘고 pre에 기록");
// 지원서 unlock 실패(👔 hire 저장 ro 등) → 지원서를 빼고 다시 뽑음 · 성공이면 그대로 · 개발용(unlock 없음)은 풀지 않음
const forceApp = { id: "app_owl" };
let calls = 0;
assert.strictEqual(GA.draw(GA.load(""), seq([.1, 0]), allLocked, forceApp, () => { calls++; return true; }).it.id, "app_owl"); assert.strictEqual(calls, 1);
const fail = GA.draw(GA.load(""), seq([.1, 0]), allLocked, forceApp, () => false); assert.notStrictEqual(fail.it.k, "app", "못 풀면 지원서가 나오지 않음");
for (let i = 0; i < 500; i++) assert.notStrictEqual(GA.draw(GA.load(""), lcg, allLocked, null, () => false).it.k, "app");
assert.strictEqual(GA.draw(GA.load(""), seq([.1, 0]), allLocked, forceApp, null).it.id, "app_owl", "unlock 없음 = 개발용: 그대로");
// 돌리기 가능 여부: 새 버전 저장(ro) · 자금 부족 · 공짜
assert.strictEqual(GA.why(GA.load(JSON.stringify({ v: 2 })), 9999, false), "ro"); assert.strictEqual(GA.why(GA.load(""), 149, false), "poor");
assert.strictEqual(GA.why(GA.load(""), 0, true), ""); assert.strictEqual(GA.why(GA.load(""), 150, false), "");
// 회수: 화면에 없는 층·창고에 놓인 뽑기 소품도 찾아서 모두 뺌(한 개뿐 · 중복 놓임도 정리)
const dd = DECOR.load(JSON.stringify({ v: 1, fl: { gone: { s: { D1: "ga_trophy", W1: "poster" }, at: { D1: 1 } }, here: { s: {}, at: {} } }, wh: { old: { s: { D1: "ga_trophy" }, at: {}, put: 1 } } }));
assert.deepStrictEqual(DECOR.findAt(dd, "ga_trophy"), { p: "gone", sl: "D1", wh: false });
assert.strictEqual(DECOR.pull(dd, "ga_trophy").length, 2); assert.strictEqual(DECOR.findAt(dd, "ga_trophy"), null);
assert.deepStrictEqual(dd.fl.gone.s, { W1: "poster" }, "다른 소품은 그대로"); assert.deepStrictEqual(dd.wh.old.s, {});
// 선글라스: 렌즈 안에 눈동자(P)가 남아 정전 눈빛 자리가 있음 · 밤 부엉이 큰 눈은 선글라스 밖으로 안 나옴
const eyesP = g => g.reduce((n, r) => n + r.filter(c => c === "P").length, 0);
for (const ch of CH) assert.ok(eyesP(mkG(ch, { seated: 1, af: "sun" })) >= 2, ch.id + " 선글라스 눈빛 자리");
assert.strictEqual(JSON.stringify(mkG(BYID.owl, { seated: 1, af: "sun", eyes: "w" })), JSON.stringify(mkG(BYID.owl, { seated: 1, af: "sun", eyes: "o" })));
console.log("studio gacha: ok");

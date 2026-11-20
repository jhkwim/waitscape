#!/usr/bin/env node
// 🛒 스튜디오 상점·꾸미기 안전망(#197 1단계) 테스트: 본체 저장(SAVE) · 층 꾸밈 저장(DECOR load/dump·touch·sweep·pull) · 시즌 판매 · 카탈로그 (Node만): node scripts/test_studio_shop.js
// web/modes/studio/mode.js에서 스프라이트·SHOP·SAVE·DECOR·GACHA 부분만 떼어 실행한다(DOM 없이). 재설계 때 바뀌어야 하는 사실은 "#197"로 표시해 두었다.
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
global.location = { search: "" };
const code = cut("const P0", "/* ================= 모드 ================= */") + cut("/* 💾 스튜디오 본체 저장", "/* @test-end SAVE */")
  + cut("const DECOR = (() => {", "/* @test-end DECOR */") + cut("const GACHA = (() => {", "/* @test-end GACHA */");
const { SAVE, DECOR: D, GACHA: GA } = new Function("C", code + "\nreturn { SAVE, DECOR, GACHA };")({ muxName: () => "" });

/* ---------- 💾 본체 저장 SAVE ---------- */
{
  const z = SAVE.load("");
  assert.deepStrictEqual([z.funds, z.earned, z.doneN], [0, 0, 0]);
  assert.deepStrictEqual(Object.keys(SAVE.load("{깨진")), Object.keys(z), "깨진 JSON → 기본값");
  assert.strictEqual(SAVE.load("[1,2]").funds, 0, "배열 → 기본값");
  // 실제 저장 모양(v1, 버전 필드 없음): 값과 모르는 필드는 그대로
  const v1 = { funds: 4215, earned: 30120, dones: { a: 5, b: 3 }, dex: { cat: { n: 1 } }, shop: { plant: 1, coffee: 1 }, rep: {}, tok: { avg: 9, n: 2 }, paid: {}, day: { d: "2026-11-18", earned: 120 }, paceSecs: 30, combo: 2, future: { x: 1 } };
  const s = SAVE.load(JSON.stringify(v1));
  ["earned", "dones", "dex", "shop", "day", "combo", "future"].forEach(k => assert.deepStrictEqual(s[k], v1[k], k));
  // 🛒 사장실 상점 환불(#197, 한 번): 화분 300 + 커피머신 800 → 자금 +1,100 · 기록 mig.shop · 원본 shop은 그대로
  assert.deepStrictEqual([s.funds, s.refund, s.mig.shop], [4215 + 1100, 1100, 1100]);
  const again = SAVE.load(JSON.stringify(s));
  assert.deepStrictEqual([again.funds, again.refund], [5315, undefined], "다시 읽어도 두 번 돌려주지 않음");
  assert.strictEqual(SAVE.load(JSON.stringify({ shop: { trophy: 1, neon: 0, unknown: 1 } })).refund, 2500, "가진 것만 · 모르는 id는 0");
  const proto = SAVE.load(JSON.stringify({ funds: 5, shop: { toString: 1, constructor: 1, hasOwnProperty: 1 } }));
  assert.deepStrictEqual([proto.funds, proto.mig.shop], [5, 0], "프로토타입 이름은 값 없음(문자열 더하기 없음)");
  assert.strictEqual(SAVE.load(JSON.stringify({ v: 2, shop: { trophy: 1 }, funds: 10 })).funds, 10, "읽기 전용 저장은 환불하지 않음(새 버전이 할 일)");
  assert.deepStrictEqual(Object.values(SAVE.OLD_SHOP).reduce((a, b) => a + b, 0), 7400, "옛 상점 7종 값 합계");
  assert.strictEqual(s.doneN, 8, "doneN 없는 옛 저장은 지금 합계에서 시작(#195)");
  assert.strictEqual(SAVE.load(JSON.stringify(Object.assign({}, v1, { doneN: 50 }))).doneN, 50, "dones가 잘려 합계가 줄어도 doneN은 그대로");
  assert.strictEqual(SAVE.load(JSON.stringify(Object.assign({}, v1, { doneN: 3 }))).doneN, 8, "doneN이 합계보다 작으면 합계로");
  assert.deepStrictEqual(SAVE.load(JSON.stringify(s)), s, "load → JSON → load 왕복");
  assert.strictEqual(s.v, 1, "v 없는 옛 저장 = v1로 읽고 v를 붙임"); assert.strictEqual(s.ro, false);
  assert.ok(!("ro" in JSON.parse(JSON.stringify(s))), "ro는 저장에 남지 않음");
  const nw = SAVE.load(JSON.stringify(Object.assign({}, v1, { v: 2 })));
  assert.deepStrictEqual([nw.ro, nw.v, nw.funds], [true, 2, 4215], "더 새 버전 저장 = 읽기 전용, v는 그대로");
}

/* ---------- 💰 지갑 SAVE.wallet ---------- */
{
  let n = 0; const sv = SAVE.load(JSON.stringify({ funds: 300, earned: 1000, day: { d: "2026-11-18", earned: 40 } })), w = SAVE.wallet(sv, () => n++);
  assert.strictEqual(w.can(300), true); assert.strictEqual(w.can(301), false);
  [-1, NaN, Infinity, "5", undefined].forEach(p => assert.strictEqual(w.can(p), false, "이상한 값 " + p));
  assert.strictEqual(w.pay(301), false); assert.deepStrictEqual([sv.funds, n], [300, 0], "모자라면 아무것도 안 함");
  assert.strictEqual(w.pay(120), true); assert.deepStrictEqual([sv.funds, sv.earned, n], [180, 1000, 1], "결제는 벌이 통계를 안 건드림");
  w.give(60); assert.deepStrictEqual([sv.funds, sv.earned, sv.day.earned, n], [240, 1000, 40, 2], "보상 = 자금만");
  w.earn(25); assert.deepStrictEqual([sv.funds, sv.earned, sv.day.earned, n], [265, 1025, 65, 3], "벌이 = 자금·누적·오늘");
  w.give(-5); w.earn(-5); w.give(0); w.give(NaN); assert.deepStrictEqual([sv.funds, n], [265, 3], "음수·0·NaN 무시");
  assert.strictEqual(w.pay(0), true, "0원 결제는 됨(공짜)");
  const ro = SAVE.load(JSON.stringify({ v: 2, funds: 999 })), wr = SAVE.wallet(ro, () => { throw new Error("읽기 전용인데 저장 예약"); });
  assert.strictEqual(wr.can(1), false); assert.strictEqual(wr.pay(1), false); assert.strictEqual(ro.funds, 999, "읽기 전용 저장이면 결제 막음");
  wr.give(10); wr.earn(10); assert.strictEqual(ro.funds, 999, "읽기 전용이면 보상·벌이도 안 올림(저장 안 되는 숫자를 보이지 않게)"); assert.strictEqual(wr.ro(), true);
  // 손상된 저장: 값 종류가 다르면 그 칸만 기본값
  const bad = SAVE.load(JSON.stringify({ funds: "500", earned: null, day: null, dones: [1], shop: { plant: 1 }, combo: "x" }));
  assert.deepStrictEqual([bad.funds, bad.earned, bad.combo, Array.isArray(bad.dones), typeof bad.day.d, bad.shop.plant], [300, 0, 0, false, "string", 1], "자금 \"500\" → 0 + 화분 환불 300");
  SAVE.wallet(bad, () => {}).give(60); assert.strictEqual(bad.funds, 360, "문자열 더하기 없음");
  assert.strictEqual(SAVE.load(JSON.stringify({ day: { d: 5 } })).day.earned, 0);
}

/* ---------- 🎨 층 꾸밈 저장 DECOR ---------- */
{
  const b = D.load("");
  assert.deepStrictEqual([b.v, Object.keys(b.fl).length, Object.keys(b.wh).length, b.ro], [1, 0, 0, undefined]);
  assert.strictEqual(D.load("{깨진").v, 1); assert.strictEqual(D.load('{"fl":{}}').ro, undefined, "v 없음 → 빈 저장");
  assert.strictEqual(D.load('{"v":2,"fl":{}}').ro, true, "더 새 버전 = 읽기 전용(#195에서 사고팔기도 막음)");
  assert.strictEqual(D.load('{"v":1,"fl":{}}').ro, false);
  const v1 = { v: 1, fl: { web: { s: { W1: "poster", F1: "plant" }, at: { W1: 100, F1: 200 }, seen: 1000 } }, wh: { old: { s: { D1: "cactus" }, at: { D1: 50 }, put: 900 } }, last: { p: "web", slot: "W1", id: "poster", t: 1 }, sp: "halloween:2026" };
  const d = D.load(JSON.stringify(v1));
  assert.deepStrictEqual(JSON.parse(D.dump(d)), v1, "v1 load → dump 왕복");
  const proto = D.load('{"v":1,"fl":{"__proto__":{"s":{"W1":"poster"}},"constructor":{"s":{}}}}');
  assert.strictEqual(proto.fl.__proto__.s.W1, "poster", "프로젝트 이름이 __proto__여도 안전한 맵"); assert.strictEqual({}.s, undefined);
  assert.deepStrictEqual(D.load('{"v":1,"fl":{"a":7,"b":{"s":[1]}}}').fl.a, { s: {}, at: {} }, "이상한 층 값 → 빈 층");

  // touch: 창고에서 복원(화분이면 시든 채) · 3일 넘게 안 왔으면 시듦 · seen은 10분마다
  const DAY = 86400, t0 = 1_800_000_000;
  let x = D.load(JSON.stringify({ v: 1, fl: {}, wh: { p: { s: { F1: "plant", W1: "poster" }, at: { F1: 1, W1: 1 }, put: t0 } } }));
  let r = D.touch(x, "p", t0 + 10);
  assert.deepStrictEqual(r.back.sort(), ["F1", "W1"]); assert.strictEqual(r.ch, true); assert.strictEqual(x.wh.p, undefined); assert.strictEqual(x.fl.p.wilt, 1);
  assert.strictEqual(D.touch(x, "nope", t0), null, "꾸민 적 없는 층");
  x = D.load(JSON.stringify({ v: 1, fl: { p: { s: { F1: "plant" }, at: { F1: t0 }, seen: t0 } } }));
  assert.deepStrictEqual(D.touch(x, "p", t0 + 300), { back: null, ch: false }, "10분 안 = 변화 없음");
  D.touch(x, "p", t0 + 3 * DAY + 1); assert.strictEqual(x.fl.p.wilt, 1, "3일 넘게 안 옴 → 화분 시듦");

  // sweep: 7일 넘게 안 온 층 → 창고(빈 층은 그냥 지움) · 지금 보이는 층은 그대로 · 창고 100개 넘으면 오래된 것부터
  x = D.load(JSON.stringify({ v: 1, fl: { a: { s: { W1: "poster" }, at: {}, seen: t0 }, e: { s: {}, at: {}, seen: t0 }, live: { s: { W1: "poster" }, at: {}, seen: t0 }, new: { s: { W1: "poster" }, at: {}, seen: t0 + 6 * DAY } } }));
  assert.strictEqual(D.sweep(x, t0 + 8 * DAY, new Set(["live"])), true);
  assert.deepStrictEqual(Object.keys(x.fl).sort(), ["live", "new"]); assert.deepStrictEqual(Object.keys(x.wh), ["a"]); assert.strictEqual(x.wh.a.put, t0 + 8 * DAY);
  const many = { v: 1, fl: {}, wh: {} }; for (let i = 0; i < 103; i++) many.wh["w" + i] = { s: { W1: "poster" }, at: {}, put: i };
  x = D.load(JSON.stringify(many)); D.sweep(x, t0, new Set());
  assert.strictEqual(Object.keys(x.wh).length, 100); assert.ok(!x.wh.w0 && !x.wh.w2 && x.wh.w3, "창고 넘침: 오래된 것부터 지움");

  // 🏢 사장실·로비(#197 3b): 창고로 가지 않음 · 칸은 벽 2·바닥 2 · 사옥 소품(hq 팩)은 사장실·로비 전용 · 칸 자리는 직원 층과 다름
  x = D.load(JSON.stringify({ v: 1, fl: { ":boss": { s: { F1: "of_coffee" }, at: {}, seen: t0 }, ":lobby": { s: { F2: "of_sofa" }, at: {}, seen: t0 } }, wh: {} }));
  D.sweep(x, t0 + 30 * DAY, new Set());
  assert.deepStrictEqual([Object.keys(x.fl).sort(), Object.keys(x.wh)], [[":boss", ":lobby"], []], "사장실·로비는 오래 안 보여도 창고로 가지 않음");
  assert.deepStrictEqual(D.slotsFor(":boss"), ["W1", "W2", "F1", "F2"]); assert.deepStrictEqual(D.slotsFor("waitscape"), D.SLOTS);
  assert.ok(D.isHQ(":lobby") && !D.isHQ("lobby") && !D.isHQ("boss"), "프로젝트 이름 boss·lobby는 건물 층이 아님");
  assert.notDeepStrictEqual(D.bigAt("F1", 132, ":boss"), D.bigAt("F1", 132, "x"));
  const ofs = D.CAT.packs.find(pk => pk.id === "office");
  assert.ok(ofs && ofs.hq && !ofs.win && D.packOpen(ofs, t0), "사옥 소품 팩: 늘 팜 · hq 표시");
  ofs.items.forEach(it => { assert.ok(D.ART[it.a], "그림: " + it.id); assert.ok(it.slot === "wall" || it.slot === "floor", "책상 칸 없음: " + it.id); });
  ["coffee", "frame", "trophy"].forEach(k => assert.ok(ofs.items.some(it => it.id.includes(k === "frame" ? "portrait" : k)), "옛 상점 " + k + " 되살림"));

  // pull · findAt: 뽑기 소품은 하나뿐 — 층·창고 어디에 있든 모두 빼 옴
  x = D.load(JSON.stringify({ v: 1, fl: { a: { s: { D1: "g_x" }, at: { D1: 1 } } }, wh: { b: { s: { D1: "g_x", W1: "poster" }, at: {} } } }));
  assert.deepStrictEqual(D.findAt(x, "g_x"), { p: "a", sl: "D1", wh: false });
  assert.strictEqual(D.pull(x, "g_x").length, 2); assert.strictEqual(D.findAt(x, "g_x"), null); assert.strictEqual(x.wh.b.s.W1, "poster");
}

/* ---------- 🎃 시즌 판매 ---------- */
{
  const at = (m, d) => new Date(2026, m - 1, d, 12).getTime() / 1000;   // 새벽 4시 경계라 정오로
  const pk = (from, to) => ({ id: "t", win: { from, to } });
  assert.strictEqual(D.packOpen(pk([10, 20], [11, 7]), at(11, 7)), true); assert.strictEqual(D.packOpen(pk([10, 20], [11, 7]), at(11, 8)), false);
  assert.strictEqual(D.packOpen(pk([12, 25], [2, 10]), at(1, 5)), true, "해를 넘기는 기간"); assert.strictEqual(D.packOpen(pk([12, 25], [2, 10]), at(3, 1)), false);
  assert.strictEqual(D.packOpen({ id: "b" }, at(1, 1)), true, "기간 없는 팩 = 늘 판매");
  assert.strictEqual(D.onSale("no_such_item", at(1, 1)), false);
  GA.ITEMS.filter(it => it.k === "desk").forEach(it => assert.strictEqual(D.onSale(it.id, at(1, 1)), false, "뽑기 소품은 팔지 않음 " + it.id));
}

/* ---------- 📦 카탈로그 ---------- */
{
  Object.values(D.ITEMS).forEach(it => {
    assert.ok(D.KIND.W1 === it.slot || ["wall", "desk", "floor"].includes(it.slot), it.id + " 칸 종류");
    if (!D.PACK[it.pack].gacha) assert.ok(it.p > 0 && Number.isInteger(it.p), it.id + " 값");
    assert.ok(!it.a || D.ART[it.a], it.id + " 그림(ART) 있음");
  });
  Object.entries(D.LIKES).forEach(([an, L]) => L.forEach(id => assert.ok(D.ITEMS[id], `${an}이 좋아하는 ${id}가 카탈로그에 있음`)));
  assert.strictEqual(Object.keys(D.LIKES).length, 11, "동물 11종 모두 좋아하는 소품");
  assert.ok(!/\bconst SHOP = \[/.test(src), "사장실 상점(SHOP)은 #197에서 꾸미기로 합침 — 파는 곳은 DECOR 하나");
}
console.log("✅ studio shop safety ok");

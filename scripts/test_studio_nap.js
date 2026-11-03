#!/usr/bin/env node
// 😴 졸음 · 🍱 점심(#106) 테스트: 쉰 시간 → 단계 · 점심 시각 · 먹기 시작 · 먹은 단계 · 메뉴(날짜·직원마다, 하루 안에선 같음) · 그림(그릇은 남고 속만 빔) · 개발용 쿼리 (Node만): node scripts/test_studio_nap.js
// web/modes/studio/mode.js에서 NAP 부분만 떼어 실행한다(DOM 없이).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
const load = search => { global.location = { search }; const code = cut("function fnv(", "\n") + "\n" + cut("const NAP = (() => {", "/* ---------- 😴 큰 화면"); return new Function(code + "\nreturn NAP;")(); };
const N = load("");

// 단계: 0~5분 커피 · 5~15분 꾸벅 · 15분↑ 엎드림 ('활성 세션만' 기본 30분 안에 셋 다 보이게)
assert.deepStrictEqual([0, 299, 300, 899, 900, 1799, 99999].map(N.stage), [0, 0, 1, 1, 2, 2, 2]);
assert.ok(N.DEEP < 30 * 60, "엎드림은 30분 전에 시작");

// 점심: 현지 12:00~12:59만
const D = (h, m) => new Date(2026, 10, 3, h, m || 0);
assert.deepStrictEqual([D(11, 59), D(12, 0), D(12, 30), D(12, 59), D(13, 0), D(0, 0)].map(N.lunch), [false, true, true, true, false, false]);

// 먹기 시작 = 12:00과 쉬기 시작 중 늦은 쪽 · 먹은 단계 5·10·15분
const s = d => d.getTime() / 1000;
assert.strictEqual(N.mealStart(s(D(12, 30)), s(D(11, 0))), s(D(12, 0)), "오전부터 쉬었으면 12시부터");
assert.strictEqual(N.mealStart(s(D(12, 30)), s(D(12, 20))), s(D(12, 20)), "점심 중에 쉬기 시작하면 그때부터");
const t0 = s(D(12, 0));
assert.deepStrictEqual([0, 299, 300, 600, 899, 900, 3000].map(u => N.eaten(t0 + u, t0)), [0, 0, 1, 2, 2, 3, 3]);

// 메뉴: 넷 · 이름 ko/en · 같은 날 같은 직원은 같은 메뉴 · 날·직원이 바뀌면 고루 나옴
assert.deepStrictEqual(N.MENUS.map(m => m.id), ["bento", "ramen", "onigiri", "sandwich"]);
N.MENUS.forEach(m => assert.ok(m.n.length === 2 && m.n.every(x => x), m.id + " 이름"));
assert.strictEqual(N.menu("2026-11-03", "abc").id, N.menu("2026-11-03", "abc").id);
const seen = new Set(); for (let d = 1; d <= 28; d++) for (const sid of ["a", "b", "c"]) seen.add(N.menu(`2026-11-${String(d).padStart(2, "0")}`, sid).id);
assert.strictEqual(seen.size, 4, "한 달이면 네 메뉴가 다 나옴");

// 그림: 10칸 · 색 글자는 모두 팔레트에 있음 · 먹을수록 음식 칸이 줄고 빈 그릇이면 음식 글자가 없음 · 그릇·통(box)은 남음
const food = (m, a) => a.r.join("").split("").filter(c => m.food.includes(c)).length;
for (const m of N.MENUS) {
  const A = [0, 1, 2, 3].map(st => N.art(m.id, st));
  A.forEach((a, st) => { a.r.forEach(r => assert.strictEqual(r.length, 10, `${m.id}/${st} 폭 10`));
    a.r.join("").split("").filter(c => c !== ".").forEach(c => assert.ok(a.p[c], `${m.id}/${st} 색 없음: ${c}`)); });
  const n = A.map(a => food(m, a));
  assert.ok(n[0] > n[1] && n[1] > n[2] && n[3] === 0, `${m.id} 먹을수록 줄어듦: ${n}`);
  if (m.box) assert.ok(A[3].r.join("").includes("e") && A[3].r.join("").split("K").length === A[0].r.join("").split("K").length, m.id + " 빈 그릇은 테두리 그대로");
  else assert.ok(A[3].r.slice(0, -1).every(r => r === ".........."), m.id + " 다 먹으면 부스러기만");
  assert.strictEqual(N.art(m.id, 1), A[1], "그림은 캐시");
}
assert.strictEqual(N.art("nope", 0), null);

// 개발용 ?nap=1|2 · ?nap=lunch (외부 통신·저장 없음 — NAP에는 store·fetch가 없다)
assert.deepStrictEqual([0, 9999].map(load("?nap=1").stage), [1, 1]);
assert.deepStrictEqual([0, 10].map(load("?nap=2").stage), [2, 2]);
const L = load("?nap=lunch");
assert.ok(L.lunch(D(9, 0)), "?nap=lunch면 언제나 점심");
assert.strictEqual(L.mealStart(1000, 900), 900, "먹기 시작 = 쉬기 시작");
assert.deepStrictEqual([0, 6, 12, 18, 29, 30].map(u => L.eaten(900 + u, 900)), [0, 1, 2, 3, 3, 0], "18초에 다 먹고 30초 주기로 다시");
const block = cut("const NAP = (() => {", "/* ================= 🎲");
assert.ok(!/ctx\.store|fetch\(|XMLHttpRequest|WebSocket/.test(block), "졸음·점심은 저장·외부 통신 없음");

// 본체 연결: placeActor 쉬는 기본 자세는 모두 커피(옛 꾸벅 갈래 없음) · 덮어쓰기 순서(🐾 버릇 앞)
assert.ok(!/if \(variant === 0\) \{   \/\/ 꾸벅꾸벅/.test(src), "기본 쉬는 자세의 꾸벅 갈래는 napBig으로 옮김");
const loop = cut("napB.actor(i, fl, f, a, T, tc, anim)", "pkB.actor(i, fl, f, a, T, tc, anim)");
assert.ok(loop.includes("hbB.actor") && loop.includes("trB.actor"), "napB → hbB → trB 순서");
const nb = cut("function napBig(h) {", "/* ================= 🎲");
assert.ok(/s\.status === "done" \? t \+ 300 : t/.test(nb), "완료 → 5분 뒤 쉼이 된 세션은 쉬기 시작을 완료 + 5분으로(core-lib sessionStatus와 같은 300초)");
assert.ok(/sessionStatus = \(s, now\) => s\.status === "done" && now - s\.since > 300/.test(fs.readFileSync(path.join(__dirname, "..", "web/core/core-lib.js"), "utf8")), "core-lib의 완료 → 쉼 300초가 바뀌면 napBig도 맞출 것");
assert.ok(nb.includes('fl.sweat.textContent === "☕"'), "☕ 기본 쉬는 자세일 때만 덮어씀(🎨 소품 반응 등은 그대로)");
assert.ok(src.includes("napB.post(fl, a)") && src.includes("napB.off(a, f)"), "다른 반응 뒤 잠 표시 걷기 · 일보·회식 중에도 상태 따라가기");
console.log("OK: 졸음·점심");

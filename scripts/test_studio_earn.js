#!/usr/bin/env node
// 💰 벌이·⚡ 빠른 답장(#114) 테스트 (Node만): node scripts/test_studio_earn.js
// web/modes/studio/mode.js에서 EARN·FAST 부분만 떼어 실행한다(DOM 없이).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
const E = new Function(cut("const BIG_DONE_SEC", "/* ✍️ MCP 보고") + "\nreturn { EARN, earnOf, FAST, fastOf, fastReply };")();

// 완료 보상: 30초 미만 10 · 기본 25 · 10분↑ 50 · 30분↑ 75 · 실행 시간 모르면 25
const run = r => E.earnOf({ run: r });
assert.deepStrictEqual([run(0), run(5), run(29), run(30), run(599), run(600), run(1799), run(1800), run(7200)], [25, 10, 10, 25, 25, 50, 50, 75, 75]);
assert.strictEqual(E.earnOf(null), 25);
// AI가 "큰 일"이라고 보고해도 돈은 더 주지 않음(연출만)
assert.strictEqual(E.earnOf({ run: 40, report: { big: { ts: 1 } } }), 25);
assert.strictEqual(E.earnOf({ run: 5, report: { big: { ts: 1 } } }), 10);
// 오래 걸릴수록 늘긴 하지만 완만하게(30분 ≤ 기본의 3배)
assert.ok(E.EARN.huge <= E.EARN.done * 3);

// 빠른 답장: 1분 안이면 +10, 콤보마다 +5, 최대 +20 · 1분 넘으면 0·콤보 끊김
assert.deepStrictEqual(E.fastReply(0, 0), { amt: 10, n: 1 });
assert.deepStrictEqual(E.fastReply(60, 0), { amt: 10, n: 1 });
assert.deepStrictEqual(E.fastReply(61, 3), { amt: 0, n: 0 });
assert.deepStrictEqual(E.fastReply(-1, 2), { amt: 0, n: 0 }, "시각이 이상하면 0");
assert.deepStrictEqual(E.fastReply(NaN, 2), { amt: 0, n: 0 });
let n = 0; const got = [];
for (let i = 0; i < 6; i++) { const r = E.fastReply(20, n); n = r.n; got.push(r.amt); }
assert.deepStrictEqual(got, [10, 15, 20, 20, 20, 20]);
assert.deepStrictEqual(E.fastReply(20, undefined), { amt: 10, n: 1 });

// 본체 연결: 질문 → 작업 재개일 때만 quick, 질문 하나에 한 번(sv.paid "q:")
assert.ok(/prev === "needs_input"[^\n]*if \(raw === "working"\) quick\(/.test(src), "재개 때 quick 호출");
assert.ok(src.includes('k = "q:" + f.sid') && src.includes("sv.paid[k] === at"), "질문마다 한 번");
console.log("ok · studio earn");

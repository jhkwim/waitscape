#!/usr/bin/env node
// core-lib.js 관제 인박스 순서 테스트 (Node만 있으면 됨): node scripts/test_inbox.js
const fs = require("fs"), path = require("path"), assert = require("assert");
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, "..", "web/core/core-lib.js"), "utf8"))();
const L = window.CoreLib;
const NOW = 1000000;
const s = (sid, status, ago, extra = {}) => ({ sid, project: sid, status, since: NOW - ago, last: NOW - ago, agents: [], ...extra });
const stall = { level: "stall", tool: null, secs: 400 };
const ss = [
  s("q-new", "needs_input", 10, { ask: "question", note: "고를까요?" }),
  s("done-old", "done", 3000, { prompt: "테스트 고치기" }),
  s("perm", "needs_input", 30, { ask: "permission", note: "Bash: npm test" }),
  s("q-old", "needs_input", 90),                                   // ask 없음(옛 버전) → question
  s("guess", "needs_input", 500, { ask: "permission", confidence: "guess" }),
  s("tx", "needs_input", 500, { confidence: "guess", source: "transcript" }),
  s("stuck", "working", 900, { health: stall, last: NOW - 400, activity: [{ ts: 0, icon: "⚡", text: "cargo build" }] }),
  s("slow", "working", 900, { health: { level: "slow", tool: null, secs: 200 } }),
  s("bg-stall", "agents", 100, { agents: [{ aid: "a", status: "running", health: stall, since: NOW - 800, last: NOW - 500 }] }),
  s("done-new", "done", 60, { prompt: "문서" }),
  s("done-stale", "done", 9 * 3600),
  s("idle", "idle", 10),
  s("work", "working", 10),
];
const q = L.inboxQueue(ss, NOW);
assert.deepStrictEqual(q.map(x => x.sid), ["perm", "q-old", "q-new", "bg-stall", "stuck", "done-old", "done-new"]);
assert.deepStrictEqual(q.map(x => x.kind), ["permission", "question", "question", "stall", "stall", "done", "done"]);
assert.strictEqual(q[0].line, "Bash: npm test");
assert.strictEqual(q.find(x => x.sid === "stuck").line, "cargo build");
assert.strictEqual(q.find(x => x.sid === "stuck").since, NOW - 400);      // 멈춘 때 = now - health.secs
assert.strictEqual(q.find(x => x.sid === "bg-stall").since, NOW - 400);
// 같은 멈춤: last가 바뀌어도(서브에이전트 이벤트), 계산이 1~2초 흔들려도 건너뛴 상태 유지 · 새 멈춤(한참 뒤)은 다시 뜬다
const stuck = ss.find(x => x.sid === "stuck"), later = { ...stuck, last: NOW + 25, health: { ...stall, secs: 432 } };
assert.deepStrictEqual(L.inboxQueue([later], NOW + 30, { stuck: NOW - 400 }), []);
assert.strictEqual(L.inboxQueue([{ ...later, health: { ...stall, secs: 300 } }], NOW + 30, { stuck: NOW - 400 }).length, 1);
assert.strictEqual(q.find(x => x.sid === "done-old").line, "테스트 고치기");

// 본 항목(seen = 그 since)은 빠지고, since가 바뀌면(새 질문) 다시 뜬다
const seen = { perm: NOW - 30, "done-old": NOW - 3000, "q-new": 123, "q-old": NOW - 89 };   // 질문은 정확히 같은 since만
assert.deepStrictEqual(L.inboxQueue(ss, NOW, seen).map(x => x.sid), ["q-old", "q-new", "bg-stall", "stuck", "done-new"]);
const again = ss.map(x => x.sid === "perm" ? { ...x, since: NOW - 5 } : x);
assert.strictEqual(L.inboxQueue(again, NOW, seen)[0].sid, "perm");

// 같은 since면 sid 순(창마다 같은 순서)
assert.deepStrictEqual(L.inboxQueue([s("b", "done", 5), s("a", "done", 5)], NOW).map(x => x.sid), ["a", "b"]);
// 빈 입력
assert.deepStrictEqual(L.inboxQueue(null, NOW), []);
assert.deepStrictEqual(L.inboxQueue([{ status: "done" }], NOW), []);
assert.deepStrictEqual(L.INBOX_KINDS, ["permission", "question", "stall", "done"]);
console.log("test_inbox: ok");

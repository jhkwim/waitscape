#!/usr/bin/env node
// core-lib.js의 세션 숨김 규칙 테스트 (Node만 있으면 됨): node scripts/test_core_hide.js
const fs = require("fs"), path = require("path"), assert = require("assert");
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, "..", "web/core/core-lib.js"), "utf8"))();
const L = window.CoreLib;
const NOW = 1000000;
const s = (sid, cwd, status, ago, extra = {}) => ({ sid, cwd, status, since: NOW - ago, last: NOW - ago, agents: [], ...extra });
const st = { now: NOW, sessions: [
  s("obs", "/Users/alex/.claude-mem/observer-sessions", "working", 1),
  s("work", "/x/work", "working", 9999),
  s("ask", "/x/ask", "needs_input", 9999),
  s("old", "/x/old", "done", 3600),
  s("new", "/x/new", "done", 600),
  s("bg", "/x/bg", "done", 9999, { agents: [{ status: "running" }] }),
] };
const ids = r => r.sessions.map(x => x.sid);
let r = L.filterSessions(st, NOW, {});
assert.deepStrictEqual(ids(r), ["work", "ask", "new", "bg"]);
assert.deepStrictEqual(r.hidden, { n: 1, project: 1 });
assert.deepStrictEqual(ids(L.filterSessions(st, NOW, { showAll: true })), ["work", "ask", "old", "new", "bg"]);
assert.deepStrictEqual(ids(L.filterSessions(st, NOW, { activeOnly: false, builtin: false })), ["obs", "work", "ask", "old", "new", "bg"]);
assert.deepStrictEqual(ids(L.filterSessions(st, NOW, { minutes: 90, hide: ["X/ask"] })), ["work", "old", "new", "bg"]);
assert.strictEqual(L.filterSessions({ now: NOW, sessions: [s("w", "/a", "working", 1)] }, NOW, {}).hidden, undefined);
// Rust(wr-core hide.rs)·server.py의 기본 목록과 같아야 함
const root = path.join(__dirname, "..");
for (const p of L.DEFAULT_HIDE_PROJECTS) {
  assert(fs.readFileSync(path.join(root, "crates/wr-core/src/hide.rs"), "utf8").includes(`"${p}"`), "hide.rs 기본 목록과 다름");
  assert(fs.readFileSync(path.join(root, "server.py"), "utf8").includes(`"${p}"`), "server.py 기본 목록과 다름");
}
console.log("OK: core-lib 세션 숨김");

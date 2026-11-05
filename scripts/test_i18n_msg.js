// #76: 엔진·코어 validate()가 만드는 한국어 고정 문구가 영어 화면에서 영어로 보이는지 (web/core/i18n.js CoreI18n.msg)
const fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global; global.navigator = { language: "en" };
new Function(fs.readFileSync(path.join(__dirname, "../web/core/i18n.js"), "utf8"))();
const I = window.CoreI18n, en = m => I.msg("en", m);
// core.js validate()의 문구를 소스에서 모아(bad("…")·bad(`…`)) 모두 옮겨지는지 — 문구를 바꾸면 이 표도 함께 바꿔야 함
const core = fs.readFileSync(path.join(__dirname, "../web/core/core.js"), "utf8");
const sample = { "${entry.dir}": "foo", "${m.id}": "bar", "${PERMS.join(\", \")}": "state, trace", "${info.id}": "baz" };
const lits = [...core.matchAll(/bad\((?:entry\.error \|\| )?"([^"]*[가-힣][^"]*)"\)/g), ...core.matchAll(/bad\(`([^`]*[가-힣][^`]*)`\)/g)].map(m => m[1])
  .concat([...core.matchAll(/info\.error \|\| `([^`]*[가-힣][^`]*)`/g)].map(m => m[1]))
  .map(s => s.replace(/\$\{[^}]+\}/g, k => sample[k] ?? "x"));
assert.ok(lits.length >= 10, "validate 문구를 찾지 못함: " + lits.length);
for (const s of lits) assert.ok(!/[가-힣]/.test(en(s)), "영어로 옮기지 못함: " + s);
// 엔진(wr-core modes.rs·hooks_config.rs = server.py)의 한국어 문구도 소스에서 모아 확인 — 엔진에 문구가 늘면 표도 늘려야 함
const rs = f => fs.readFileSync(path.join(__dirname, "../crates/wr-core/src", f), "utf8").split("#[cfg(test)]")[0];
const eng = [...rs("modes.rs").matchAll(/"([^"\n]*[가-힣][^"\n]*)"/g), ...rs("hooks_config.rs").matchAll(/write!\(f, "([^"]*[가-힣][^"]*)"/g)]
  .map(m => m[1].replace(/\{[a-z_]*\}/g, "Permission denied"))
  .filter(s => !s.startsWith("//"));
assert.ok(eng.length >= 8, "엔진 문구를 찾지 못함: " + eng.length);
for (const s of eng) assert.ok(!/[가-힣]/.test(en(s)), "영어로 옮기지 못함(엔진): " + s);
assert.strictEqual(en("폴더 이름(foo)과 id(bar)가 달라요"), "Folder name (foo) and id (bar) differ");
assert.strictEqual(I.msg("ko", "mode.json이 없어요"), "mode.json이 없어요");   // 한국어 화면은 그대로
assert.strictEqual(en("same-key: inboxKey = nunchiKey"), "same-key: inboxKey = nunchiKey");   // 모르는 문구·코드는 그대로
assert.strictEqual(en(new Error("x")), "Error: x");
console.log(`test_i18n_msg: ok (validate ${lits.length}, 엔진 ${eng.length})`);

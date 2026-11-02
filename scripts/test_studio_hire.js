#!/usr/bin/env node
// 👔 스튜디오 채용(#85) 테스트: 지금 직원은 그대로 · 새 캐릭터는 새 세션부터 · 잠금/해제 · 창끼리 같은 동물 (Node만): node scripts/test_studio_hire.js
// web/modes/studio/mode.js에서 스프라이트·해시·HIRE 부분만 떼어 실행한다(DOM 없이).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const a = src.indexOf("const P0"), b = src.indexOf("/* ================= 모드 ================= */");
assert.ok(a > 0 && b > a, "mode.js 구간을 못 찾음");
global.location = { search: "" };
const M = new Function("C", src.slice(a, b) + "\nreturn { CH, SP, BYID, SH, ALOHA, NAME, EMO, fnv, HIRE, mkG };")({ muxName: () => "" });
const { SP, BYID, SH, ALOHA, NAME, EMO, fnv, HIRE } = M;

// 표: 새 4종이 동물별 테이블에 모두 있음 · 16열 그림
for (const id of ["fox", "panda", "owl", "hog"]) {
  assert.ok(SP.includes(id) && NAME[id] && EMO[id] && SH[id] && ALOHA[id], id + " 표 누락");
  BYID[id].rows.forEach(r => assert.strictEqual(r.length, 16, id + " 줄 길이"));
  Object.values(BYID[id].legs).forEach(L => L.forEach(r => assert.strictEqual(r.length, 16, id + " 다리 길이")));
}
assert.deepStrictEqual(SP.slice(0, 7), HIRE.BASE, "원래 7종 순서는 그대로(해시 결과 유지)");

// 가짜 ctx: 창 둘이 같은 저장(localStorage처럼)을 공유
const mem = new Map();
let NOW = 1_000_000, sessions = [];
const ctxOf = () => ({ store: { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => mem.set(k, String(v)) }, now: () => NOW, get state() { return { sessions }; } });
const old7 = sid => HIRE.BASE[fnv(sid) % 7];   // 이 버전 전의 배정
const cfg = HIRE.normCfg({ animals: HIRE.BASE.slice(), fixed: null });   // 예전에 저장한 설정(rv 없음)
assert.deepStrictEqual(cfg.animals, SP, "rv 전 설정은 새 캐릭터를 켠 것으로");
assert.strictEqual(cfg.rv, 2);

// 1) 업데이트 직후: 이미 있던 세션은 원래 동물
const oldSids = Array.from({ length: 60 }, (_, i) => "old-" + i);
sessions = oldSids.map(sid => ({ sid, since: NOW - 300, started: NOW - 900 }));
const big = HIRE.create(ctxOf()), mini = HIRE.create(ctxOf());
oldSids.forEach(sid => assert.strictEqual(big.animalOf(sid, cfg).id, old7(sid), "기존 세션 동물이 바뀜: " + sid));
oldSids.forEach(sid => assert.strictEqual(mini.animalOf(sid, cfg).id, old7(sid), "미니 보기도 같은 동물"));
assert.ok(big.locked("owl") && big.locked("hog") && !big.locked("fox") && !big.locked("panda"));

// 2) 새 세션부터 여우·판다가 섞임 · 잠긴 부엉이·고슴도치는 안 나옴 · 두 창이 같은 값
NOW += 100;
const newSids = Array.from({ length: 150 }, (_, i) => "new-" + i);
sessions = sessions.concat(newSids.map(sid => ({ sid, since: NOW - 5, started: NOW - 5 })));
const got = new Set(newSids.map(sid => big.animalOf(sid, cfg).id));
assert.ok(got.has("fox") && got.has("panda"), "새 세션에 여우·판다");
assert.ok(!got.has("owl") && !got.has("hog"), "잠긴 동물은 안 나옴");
newSids.forEach(sid => assert.strictEqual(mini.animalOf(sid, cfg).id, big.animalOf(sid, cfg).id, "창마다 다름: " + sid));

// 3) 잠금 해제(#86): 그 뒤 새 세션만 부엉이·고슴도치 후보, 이미 본 세션은 그대로
const before = new Map(newSids.concat(oldSids).map(sid => [sid, big.animalOf(sid, cfg).id]));
NOW += 100;
assert.strictEqual(big.unlock("owl"), true); assert.strictEqual(big.unlock("owl"), false); assert.strictEqual(big.unlock("fox"), false);
mini.refresh();
assert.ok(!big.locked("owl") && !mini.locked("owl") && big.locked("hog"));
before.forEach((id, sid) => { assert.strictEqual(big.animalOf(sid, cfg).id, id, "해제 뒤 바뀜: " + sid); assert.strictEqual(mini.animalOf(sid, cfg).id, id); });
NOW += 10;
const later = Array.from({ length: 150 }, (_, i) => "later-" + i);
sessions = sessions.concat(later.map(sid => ({ sid, since: NOW, started: NOW })));
const got2 = new Set(later.map(sid => big.animalOf(sid, cfg).id));
assert.ok(got2.has("owl") && !got2.has("hog"), "해제한 부엉이만 새로 섞임");

// 4) 설정 풀·고정: 사용자가 고르면 바로 반영(잠긴 동물은 고정 불가)
assert.strictEqual(big.animalOf("old-1", { animals: ["fox"] }).id, "fox", "풀에 여우만 → 옛 세션도 여우");
assert.strictEqual(big.animalOf("old-1", { animals: SP, fixed: "panda" }).id, "panda");
assert.strictEqual(big.animalOf("old-1", { animals: SP, fixed: "hog" }).id, old7("old-1"), "잠긴 동물 고정은 무시");

// 5) 저장 형식: hire v1 · seen v1(처음/마지막 본 시각) · 모르는 새 버전은 읽기만
const H = JSON.parse(mem.get("hire")), S = JSON.parse(mem.get("seen"));
assert.strictEqual(H.v, 1); assert.ok(H.at.fox > 0 && H.at.panda > 0 && H.at.owl > H.at.fox && !("hog" in H.at));
assert.strictEqual(S.v, 1); assert.ok(Array.isArray(S.s["old-1"]) && S.s["old-1"][0] === 1_000_000 - 900, "처음 본 시각 = min(지금, since, started)");
mem.set("hire", JSON.stringify({ v: 9, at: {} }));
const ro = HIRE.create(ctxOf()); assert.strictEqual(ro.unlock("hog"), false, "새 버전 저장은 건드리지 않음");
assert.strictEqual(mem.get("hire"), JSON.stringify({ v: 9, at: {} }));

// 6) 정리: 21일 안 본 sid는 지우고 최대 400개
mem.clear(); NOW = 5_000_000; sessions = [];
const c2 = HIRE.create(ctxOf());
for (let i = 0; i < 450; i++) { sessions.push({ sid: "s" + i, since: NOW, started: NOW }); c2.animalOf("s" + i, cfg); NOW += 1; }
assert.ok(Object.keys(JSON.parse(mem.get("seen")).s).length <= 400, "최대 400개");
NOW += 22 * 86400; sessions = [{ sid: "fresh", since: NOW, started: NOW }]; c2.animalOf("fresh", cfg);
assert.deepStrictEqual(Object.keys(JSON.parse(mem.get("seen")).s), ["fresh"], "21일 지난 sid 정리");

// 7) 스프라이트 옵션: 꼬리 살랑 · 밤눈 · 쭈뼛은 그림이 실제로 달라짐
const g = (id, o) => JSON.stringify(M.mkG(BYID[id], Object.assign({ legs: "s" }, o)));
assert.notStrictEqual(g("fox", {}), g("fox", { tw: 1 }));
assert.notStrictEqual(g("owl", {}), g("owl", { eyes: "w" }));
assert.notStrictEqual(g("hog", {}), g("hog", { spk: 1 }));
assert.strictEqual(g("cat", {}), g("cat", { tw: 1, spk: 1 }), "다른 동물엔 영향 없음");
console.log("studio hire: ok");

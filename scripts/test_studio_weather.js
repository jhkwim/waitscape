#!/usr/bin/env node
// 🌦️ 달력 날씨(#107) 테스트: 반구 · 계절 · 반나절마다 같은 날씨 · 계절 확률 · 안개는 오전만 · 그리기 값(wk) · 한도 날씨 우선 · 개발용 ?wx= · 외부 통신 없음 (Node만): node scripts/test_studio_weather.js
// web/modes/studio/mode.js에서 WX·pwClock 부분만 떼어 실행한다(DOM 없이).
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "web/modes/studio/mode.js"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, "구간을 못 찾음: " + a); return src.slice(i, j); };
const load = search => { global.location = { search }; return new Function(cut("function fnv(", "\n") + "\n" + cut("const WX = (() => {", "/* 날씨 입자") + "\nreturn WX;")(); };
const W = load("");

// 반구: 남반구 시간대만 뒤집음
["Australia/Sydney", "Pacific/Auckland", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Santiago", "Africa/Johannesburg"].forEach(z => assert.ok(W.south(z), z));
["Asia/Seoul", "America/New_York", "Europe/London", "Asia/Tokyo", "", "UTC", "America/Los_Angeles"].forEach(z => assert.ok(!W.south(z), z || "(없음)"));
assert.strictEqual(W.season(0, false), "winter"); assert.strictEqual(W.season(6, false), "summer"); assert.strictEqual(W.season(3, false), "spring"); assert.strictEqual(W.season(9, false), "autumn");
assert.strictEqual(W.season(0, true), "summer"); assert.strictEqual(W.season(6, true), "winter");

// 확률 표: 합 100 · 눈은 겨울만
Object.entries(W.P).forEach(([k, p]) => { assert.strictEqual(p.reduce((a, b) => a + b, 0), 100, k); if (k !== "winter") assert.strictEqual(p[3], 0, k + " 눈 없음"); });

// 반나절 안에선 같음 · 오전/오후는 다를 수 있음 · 결과는 다섯 중 하나
const D = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi || 0);
for (let d = 1; d <= 28; d++) {
  const a = W.kind(D(2026, 1, d, 0), "Asia/Seoul");
  [3, 7, 11].forEach(h => assert.strictEqual(W.kind(D(2026, 1, d, h, 59), "Asia/Seoul"), a, `1/${d} 오전 ${h}시`));
  const p = W.kind(D(2026, 1, d, 12), "Asia/Seoul");
  [15, 23].forEach(h => assert.strictEqual(W.kind(D(2026, 1, d, h, 59), "Asia/Seoul"), p, `1/${d} 오후 ${h}시`));
  assert.ok(W.KINDS.includes(a) && W.KINDS.includes(p));
  assert.notStrictEqual(p, "fog", "안개는 오전만");
}

// 분포: 한 해(반나절 730번) — 여름엔 눈 없음, 겨울엔 눈이 나옴, 북·남반구가 같은 날 다른 계절
const count = (m0, m1, tz) => { const c = {}; for (let m = m0; m <= m1; m++) for (let d = 1; d <= 28; d++) for (const h of [9, 15]) { const k = W.kind(D(2026, m, d, h), tz); c[k] = (c[k] || 0) + 1; } return c; };
const jul = count(6, 8, "Asia/Seoul"), jan = count(1, 2, "Asia/Seoul"), janS = count(1, 2, "Australia/Sydney");
assert.ok(!jul.snow, "북반구 여름엔 눈 없음"); assert.ok(jan.snow > 0, "북반구 겨울엔 눈"); assert.ok(!janS.snow, "남반구 1월(여름)엔 눈 없음");
assert.ok((jul.rain || 0) > (jan.rain || 0), "여름 비가 겨울 비보다 많음");
const tot = Object.values(jan).reduce((a, b) => a + b, 0); assert.ok(jan.clear / tot > .3 && jan.clear / tot < .6, "겨울 맑음 ≈ 45%: " + jan.clear / tot);

// 그리기 값: 기존 한도 날씨 길(60 구름 · 80 비 · 90 눈)과 같은 칸에 들어감
assert.deepStrictEqual(W.KINDS.map(k => W.WK[k]), [0, 70, 85, 95, 0]);
W.KINDS.forEach(k => assert.ok(W.ICON[k] && W.NAME[k].length === 2, k));

// 개발용 ?wx= 고정 · 모르는 값은 무시
assert.strictEqual(load("?wx=snow").kind(D(2026, 7, 1, 15), "Asia/Seoul"), "snow");
assert.strictEqual(load("?wx=nope").dev, "");

// pwClock.env: 한도 날씨를 켰고 주간 60%↑면 한도가 우선, 아니면 달력
const env = cut("const PW_RESET_LEN", "const PW_MPAT");
const C = { limits: (st) => ({ five: { used: 10, wasReset: false, reset: 0 }, week: { used: st.wk } }) };
const pw = new Function("C", "WX", "clamp", "lerp", "ease", "pwKv", "pwMix", "pwH", env + "\nreturn pwClock;")(C, W, (v, a, b) => Math.max(a, Math.min(b, v)), (a, b, t) => a + (b - a) * t, t => t, () => 0, a => a, () => 0);
const at = (wk, on, cal) => { const c = pw(); c.read({ limits: {}, wk }, 0, 0); const E = c.env(0, 0, true, false, on, cal); return [E.wxK, E.wk, E.lim, E.fog]; };
assert.deepStrictEqual(at(85, true, "clear"), ["rain", 85, true, false], "한도 85% → 비(한도 우선)");
assert.deepStrictEqual(at(95, true, "fog"), ["snow", 95, true, false]);
assert.deepStrictEqual(at(40, true, "snow"), ["snow", 95, false, false], "한도 60% 밑이면 달력");
assert.deepStrictEqual(at(95, false, "fog"), ["fog", 0, false, true], "한도 날씨를 끄면 언제나 달력");
assert.deepStrictEqual(at(95, false, undefined), ["clear", 0, false, false]);

// 외부 통신 없음
assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|geolocation/.test(cut("const WX = (() => {", "/* 날씨 입자")), "달력 날씨는 외부 통신·위치 없음");
console.log("OK: 달력 날씨");

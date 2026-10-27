#!/usr/bin/env node
// 🙈 눈치 모드 순수 함수 테스트 (core/nunchi.js의 lib, Node만 있으면 됨): node scripts/test_nunchi.js
const fs = require("fs"), path = require("path"), assert = require("assert");
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, "..", "web/core/nunchi.js"), "utf8"))();
const N = window.CoreNunchi.lib, NOW = 1000000;
const s = (sid, status, extra = {}) => ({ sid, status, since: NOW - 60, started: NOW - 600, run: 0, activity: [], ...extra });
// 상태 점·문구 키
assert.deepStrictEqual(N.stat(s("a", "needs_input")), ["nx.st.ask", "ask"]);
assert.deepStrictEqual(N.stat(s("a", "agents")), ["nx.st.run", "run"]);
assert.deepStrictEqual(N.stat(s("a", "done")), ["nx.st.done", "done"]);
assert.deepStrictEqual(N.stat(s("a", "idle")), ["nx.st.idle", "idle"]);
// 경과: 실행 중 = 시작부터, 입력 대기 = 기다린 시간, 완료 = 걸린 시간
assert.strictEqual(N.elapsed(s("a", "working"), NOW), 600);
assert.strictEqual(N.elapsed(s("a", "needs_input"), NOW), 60);
assert.strictEqual(N.elapsed(s("a", "done", { run: 412 }), NOW), 412);
assert.strictEqual(N.elapsed(s("a", "working", { started: null }), NOW), 60);
// 현재 작업: 이모지 아이콘은 빼고, 질문은 질문 문구, 완료는 프롬프트
assert.strictEqual(N.task(s("a", "working", { activity: [{ icon: "✏️", text: "✏️ README.md 수정" }] })), "README.md 수정");
assert.strictEqual(N.task(s("a", "needs_input", { note: "배포해도 될까요?" })), "배포해도 될까요?");
assert.strictEqual(N.task(s("a", "done", { prompt: "정리" })), "정리");
assert.strictEqual(N.task(s("a", "working")), null);
// 행 순서: 모드가 준 층 순서 먼저(맨 위층부터), 나머지는 입력 대기 → 실행 중 → 완료
const list = [s("d", "done"), s("w", "working"), s("q", "needs_input"), s("x", "working")];
assert.deepStrictEqual(N.order(list, ["x", "d"]).map(x => x.sid), ["x", "d", "q", "w"]);
assert.deepStrictEqual(N.order(list, null).map(x => x.sid), ["q", "w", "x", "d"]);
// 시계 표기
assert.strictEqual(N.clock(59), "0:59"); assert.strictEqual(N.clock(1531), "25:31"); assert.strictEqual(N.clock(3725), "1:02:05");
// 사장님 한마디: 처음엔 꼭, 이후 약 1/3
assert.strictEqual(N.sayOnce(0, .99), true);
assert.strictEqual(N.sayOnce(3, .2), true);
assert.strictEqual(N.sayOnce(3, .5), false);
// 도구 수: 숫자만(문자열·HTML이 표에 그대로 들어가지 않게)
assert.strictEqual(N.count(27), 27); assert.strictEqual(N.count("<img src=x>"), 0); assert.strictEqual(N.count(undefined), 0); assert.strictEqual(N.count(-3), 0); assert.strictEqual(N.count("12"), 12);
// 진행 상황: 컨텍스트 · 할 일 · MCP 단계(범위 밖 단계는 무시)
assert.deepStrictEqual(N.progress(s("a", "working", { ctx: 86.6, todos: [{ status: "completed" }, { status: "pending" }], report: { step: 2, total: 4, title: "테스트 작성" } })),
  { ctx: 87, todo: [1, 2], step: { n: 2, of: 4, title: "테스트 작성" } });
assert.deepStrictEqual(N.progress(s("a", "working", { ctx: null, todos: [], report: { step: 5, total: 4 } })), { ctx: null, todo: null, step: null });
// 주의 표시: 멈춤 의심(메인·실행 중 서브에이전트) · 컨텍스트 85% 이상
assert.deepStrictEqual(N.alerts(s("a", "working", { health: { level: "stall" }, ctx: 90 })), [["nx.b.stall", null], ["nx.b.ctx", 90]]);
assert.deepStrictEqual(N.alerts(s("a", "working", { agents: [{ status: "running", health: { level: "stall" } }], ctx: 84 })), [["nx.b.stall", null]]);
assert.deepStrictEqual(N.alerts(s("a", "done", { health: { level: "stall" } })), []);
// 서브에이전트 펼치기: 설명·도구·실행 중인 것만, 경과
const ag = N.subs(s("a", "working", { agents: [{ desc: "조사", type: "Explore", status: "running", since: NOW - 95 }, { desc: "", tools: 0, status: "done", since: NOW - 9 },
  { desc: "", type: "Plan", tools: 3, status: "done", since: NOW - 400, ended: NOW - 130 }] }), NOW);
assert.deepStrictEqual(ag, [{ desc: "조사", type: "Explore", run: true, el: 95 }, { desc: "", type: "Plan", run: false, el: 270 }]);
// 오늘 요약: 일보 우선, 없으면 state에서 완료 수·가장 오래 걸린 끝난 일, 아무것도 없으면 null
const st = { done_today: 2, sessions: [s("d", "done", { run: 412, project: "docs" }), s("w", "working", { run: 999 })] };
assert.deepStrictEqual(N.today(null, st), { done: 2, work: null, longest: { project: "docs", run: 412 }, wait: null });
assert.deepStrictEqual(N.today({ done: 7, work: 15060, big: [{ project: "api", run: 2280 }], wait: { avg: 84, n: 5 } }, st), { done: 7, work: 15060, longest: { project: "api", run: 2280 }, wait: 84 });
assert.deepStrictEqual(N.today({ error: "off" }, st).done, 2);
assert.strictEqual(N.today(null, { done_today: 0, sessions: [] }), null);
// [이동] 버튼: 멀티플렉서에서 연 세션만(core-lib muxName — 스튜디오 완료 보고와 같은 판단)
new Function(fs.readFileSync(path.join(__dirname, "..", "web/core/core-lib.js"), "utf8"))();
const M = window.CoreLib.muxName;
assert.strictEqual(M({ jump: { mux: { kind: "cmux" } } }), "cmux"); assert.strictEqual(M({ jump: { mux: { kind: "orca" } } }), "Orca");
assert.strictEqual(M({ jump: { mux: { kind: "tmux" } } }), ""); assert.strictEqual(M({}), ""); assert.strictEqual(M(null), "");
// 창 안 단축키: ⌘1(맥)·Ctrl+1(그 밖) = 눈치 모드, 수식키 없는 1~9 = 모드 전환, B = 눈치 모드, 쉼표 = 설정, 입력란은 무시
const k = (key, o = {}) => Object.assign({ key, code: /^[0-9]$/.test(key) ? "Digit" + key : "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: { tagName: "DIV" } }, o);
assert.strictEqual(N.hotkey(k("1", { metaKey: true }), true), "nunchi");
assert.strictEqual(N.hotkey(k("1", { ctrlKey: true }), false), "nunchi");
assert.strictEqual(N.hotkey(k("1", { ctrlKey: true }), true), null);    // 맥의 ⌃1은 우리 것이 아님
assert.strictEqual(N.hotkey(k("1", { metaKey: true }), false), null);   // 윈도우의 Win+1도
assert.strictEqual(N.hotkey(k("1", { metaKey: true, shiftKey: true }), true), null);
assert.strictEqual(N.hotkey(k("!", { metaKey: true, code: "Digit1" }), true), "nunchi");   // 자판 배열이 달라도 물리 키 1
assert.strictEqual(N.hotkey(k("1"), true), "mode:1"); assert.strictEqual(N.hotkey(k("7"), false), "mode:7");
assert.strictEqual(N.hotkey(k("b"), true), "nunchi"); assert.strictEqual(N.hotkey(k("B"), false), "nunchi");
assert.strictEqual(N.hotkey(k(","), true), "settings");
assert.strictEqual(N.hotkey(k("b", { metaKey: true }), true), null); assert.strictEqual(N.hotkey(k("3", { ctrlKey: true }), false), null);
for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.strictEqual(N.hotkey(k("1", { metaKey: true, target: { tagName } }), true), null);
assert.strictEqual(N.hotkey(k("b", { target: { tagName: "DIV", isContentEditable: true } }), true), null);
assert.strictEqual(N.hotkey(k(",", { metaKey: true }), true), "settings"); assert.strictEqual(N.hotkey(k(",", { ctrlKey: true }), false), "settings");
// ⌘2·Ctrl+2 = 미니 보기(위젯에선 큰 화면), 수식키 없는 2는 모드 전환 그대로, 입력란 무시
assert.strictEqual(N.hotkey(k("2", { metaKey: true }), true), "mini"); assert.strictEqual(N.hotkey(k("2", { ctrlKey: true }), false), "mini");
assert.strictEqual(N.hotkey(k("2"), true), "mode:2"); assert.strictEqual(N.hotkey(k("2", { metaKey: true, target: { tagName: "INPUT" } }), true), null);
assert.strictEqual(N.hotkey(k("2", { ctrlKey: true }), true), null); assert.strictEqual(N.miniKeyLabel(true), "⌘2"); assert.strictEqual(N.miniKeyLabel(false), "Ctrl+2");
// 길게 눌러 반복은 무시, 한국어 자판(B = "ㅠ")도 물리 키로, 쉼표·숫자도 code 기준
assert.strictEqual(N.hotkey(k("b", { repeat: true }), true), null); assert.strictEqual(N.hotkey(k("1", { metaKey: true, repeat: true }), true), null);
assert.strictEqual(N.hotkey(k("ㅠ", { code: "KeyB" }), true), "nunchi");
assert.strictEqual(N.hotkey(k("ㅠ", { code: "KeyB", metaKey: true }), true), null);
assert.strictEqual(N.hotkey(k("<", { code: "Comma" }), false), "settings");
assert.strictEqual(N.hotkey(k("!", { code: "Digit3" }), true), "mode:3");
assert.strictEqual(N.setKeyLabel(true), "⌘,"); assert.strictEqual(N.setKeyLabel(false), "Ctrl+,");
// 우클릭한 자리의 세션: data-sid 우선, 스튜디오 누를 자리 data-pk="<sid>.<대상>"(사장실·회의실·옥상은 세션 아님)
const el = (attrs, parent = null) => ({ dataset: attrs, closest(sel) { const k = sel === "[data-sid]" ? "sid" : "pk"; let e = this; while (e) { if (e.dataset[k]) return e; e = e.parent; } return null; }, parent });
assert.strictEqual(N.sidAt(el({}, el({ sid: "abc" }))), "abc");
assert.strictEqual(N.sidAt(el({ pk: "s1.a" })), "s1");
assert.strictEqual(N.sidAt(el({ pk: "boss.a" })), null); assert.strictEqual(N.sidAt(el({ pk: "meet.wb" })), null);
assert.strictEqual(N.sidAt(el({})), null); assert.strictEqual(N.sidAt(null), null);
assert.strictEqual(N.appKeyLabel(true), "⌘1"); assert.strictEqual(N.appKeyLabel(false), "Ctrl+1");
console.log("test_nunchi: ok");

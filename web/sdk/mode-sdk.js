/* mode-sdk — 외부 모드 샌드박스 iframe 안에서 Core/ctx(Mode API v1)를 흉내 낸다
   순서: core-lib.js → mode-sdk.js → (모드) mode.js. 호스트(bridge-host.js)와 postMessage로만 이야기한다.
   여기서 막을 수 없는 것은 서버 CSP·iframe sandbox가 막는다(네트워크, 부모 접근, 창 열기, 상위 이동, 폼, 중첩 frame, Worker).
   권한(mode.json needs)이 없는 ctx 항목은 아예 없다(undefined). 명세: types/ctx.d.ts */
(() => {
"use strict";
// 1) CSP가 통제하지 못하는 WebRTC는 모드 코드보다 먼저 지운다 (완전한 차단은 아님 — ARCHITECTURE.md §4.5 알려진 한계)
for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCSessionDescription", "RTCIceCandidate", "RTCRtpSender", "RTCRtpReceiver"]) {
  try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch {}
}

const L = window.CoreLib, P = window.parent;
const send = m => P.postMessage({ wr: 1, ...m }, "*");
let seq = 0;
const pending = new Map();
function call(op, args) {
  return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); send({ type: "call", id, op, args }); });
}
const log = text => { try { send({ type: "call", id: ++seq, op: "log", args: { text: String(text).slice(0, 500) } }); } catch {} };
window.addEventListener("error", e => log(e.message + (e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "")));
window.addEventListener("unhandledrejection", e => log("unhandled: " + (e.reason && e.reason.message || e.reason)));

let def = null, boot = null, state = null, offset = 0, quiet = false, modes = [], store = {}, memos = {};
const handlers = {};
const on = (evt, fn) => { (handlers[evt] ||= new Set()).add(fn); return () => handlers[evt].delete(fn); };
const emit = (evt, d) => { for (const fn of [...(handlers[evt] || [])]) { try { fn(d); } catch (e) { console.error(e); log(`${evt} handler: ${e.message}`); } } };
const now = () => Date.now() / 1000 - offset;

const Core = window.Core = {
  registerMode(d) {
    if (def) throw new Error("registerMode는 한 번만 부를 수 있어요");
    if (!d || !d.id || typeof d.mount !== "function") throw new Error("registerMode: id와 mount(root, ctx)가 필요해요");
    def = d; start();
  },
  get state() { return state; },
  get lang() { return L.lang; },
  now, on,
  hash: L.hash, pick: L.pick, esc: L.esc, fmt: L.fmt, fmtTok: L.fmtTok, dur: L.dur, hms: L.hms,
  untilText: L.untilText, clockText: L.clockText, spanText: L.spanText,
  sessionStatus: L.sessionStatus, isActive: L.isActive, stalls: L.stalls, summary: L.summary,
  limitCalc: L.limitCalc, limits: L.limits, limitNote: L.limitNote,
  provider: L.provider, can: L.can, providerBadge: L.providerBadge,
  apiVersion: L.API_VERSION, apiCompat: L.apiCompat,
};

let inst = null, ctx = null;
function start() {
  if (!def || !boot || inst) return;
  if (def.id !== boot.mode.id) { log(`registerMode id(${def.id})가 mode.json id(${boot.mode.id})와 달라요`); return; }
  const needs = new Set(boot.mode.needs);
  const doc = document, win = window;
  doc.body.dataset.mode = def.id;
  doc.body.classList.toggle("quiet", quiet);
  doc.documentElement.lang = L.lang;
  const root = doc.body.appendChild(doc.createElement("div"));
  root.className = "mode-root mode-" + def.id;
  const sw = doc.createElement("label"); sw.className = "core-switch"; sw.hidden = true;   // 외부 모드의 전환기는 호스트가 iframe 밖에 띄움
  let actx = null;
  ctx = {
    id: def.id, doc, win, root, switcher: sw, core: Core, isMain: true,
    info: { ...boot.mode },
    host: { ...boot.host },
    get state() { return state; },
    get lang() { return L.lang; },
    now,
    on,
    every: (ms, fn) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
    after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    loop(fn) { let id; const step = ts => { if (fn(ts) !== false) id = requestAnimationFrame(step); }; id = requestAnimationFrame(step); return () => cancelAnimationFrame(id); },
    listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); return () => target.removeEventListener(type, fn, opts); },
    settings: { get quiet() { return quiet; } },
    notif: { supported: false, granted: false, canAsk: false, request: () => Promise.resolve("unsupported") },
    store: {
      get: (k, d = null) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d,
      set: (k, v) => { k = String(k); if (v == null) delete store[k]; else store[k] = String(v); return call("store.set", { key: k, value: v == null ? null : String(v) }); },
    },
    audio() {   // iframe 자체 AudioContext. 회의 모드면 suspend
      try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (quiet) actx.suspend(); else if (actx.state === "suspended") actx.resume(); } catch {}
      return actx;
    },
    chime: kind => call("chime", { kind }),
    setMode: id => call("setMode", { id }),
    modes: () => modes.map(m => ({ ...m, label: m.name })),
    api: {},
  };
  if (needs.has("trace")) ctx.api.trace = (q, signal) => {
    const p = call("trace", q || {});
    return signal ? new Promise((res, rej) => {
      if (signal.aborted) return rej(new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")), { once: true });
      p.then(res, rej);
    }) : p;
  };
  if (needs.has("memo")) ctx.memo = {
    get: sid => (memos[sid] && memos[sid].text) || "",
    set(sid, value) { memos[sid] = { text: String(value ?? ""), ready: false }; return call("memo.set", { sid, value: String(value ?? "") }); },
    ready: sid => !!(memos[sid] && memos[sid].ready),
    async copy(sid, ta) { const ok = await call("memo.copy", { sid }); if (ok) { if (ta) ta.value = ""; memos[sid] = { text: "", ready: false }; } return ok; },
  };
  if (needs.has("notify")) ctx.notify = (title, body) => call("notify", { title, body });
  if (needs.has("clipboard")) ctx.clipboard = { write: text => call("clipboard.write", { text }) };
  try { inst = def.mount(root, ctx) || def; } catch (e) { console.error(e); log("mount: " + e.message); inst = {}; }
  if (state && inst.update) { try { inst.update(state, ctx); } catch (e) { log("update: " + e.message); } }
}

// 숫자키·B·쉼표·🙈 ⌘1/⌘2/⌘,(맥, 그 밖 Ctrl)는 호스트 단축키 → iframe에 포커스가 있어도 전달(코어 nunchi.js lib.hotkey와 같은 규칙:
// 길게 눌러 반복은 무시, 한국어 자판이어도 물리 키(code) 기준, 입력란 무시)
const keyOf = e => {
  if (e.repeat || /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return null;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || ""), d = /^Digit([1-9])$/.exec(e.code || ""), n = d ? d[1] : /^[1-9]$/.test(e.key) ? e.key : null;
  const comma = e.code === "Comma" || e.key === ",";
  if (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) return e.altKey || e.shiftKey ? null : n === "1" ? "nunchi" : n === "2" ? "mini" : comma ? "," : null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code === "KeyB" || e.key === "b" || e.key === "B") return "b";
  return comma ? "," : n;
};
document.addEventListener("keydown", e => {
  const k = keyOf(e);
  if (!k) return;
  if (k === "nunchi" || k === "mini" || (k === "," && (e.metaKey || e.ctrlKey))) e.preventDefault();
  send({ type: "call", id: ++seq, op: "key", args: { key: k } });
});
// 앱: 우클릭하면 호스트가 같은 앱 메뉴를 띄움(입력란은 기본 편집 메뉴 그대로)
document.addEventListener("contextmenu", e => {
  const t = (e.composedPath && e.composedPath()[0]) || e.target;
  if (t && (/^(TEXTAREA|INPUT|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  send({ type: "call", id: ++seq, op: "ctxmenu", args: {} });
});

window.addEventListener("message", e => {
  if (e.source !== P) return;   // 호스트(부모)가 보낸 것만
  const d = e.data;
  if (!d || d.wr !== 1) return;
  if (d.type === "init" && !boot) {
    boot = d; L.setLang(d.lang); quiet = !!d.quiet; modes = d.modes || []; store = d.store || {}; memos = d.memos || {};
    if (d.state) { state = d.state; offset = Date.now() / 1000 - d.now; }
    start();
  } else if (d.type === "state") {
    state = d.state; offset = Date.now() / 1000 - d.now; if (d.memos) memos = d.memos;
    if (inst && inst.update) { try { inst.update(state, ctx); } catch (e) { log("update: " + e.message); } }
    emit("state", state);
  } else if (d.type === "event") {
    if (d.evt === "memo" && d.data) memos[d.data.sid] = { text: d.data.value, ready: false };
    emit(d.evt, d.data);
  } else if (d.type === "settings") {
    quiet = !!d.quiet; L.setLang(d.lang);
    document.body.classList.toggle("quiet", quiet);
    document.documentElement.lang = L.lang;
    emit("settings", ctx ? ctx.settings : { quiet });
  } else if (d.type === "modes") {
    modes = d.modes || [];
  } else if (d.type === "reply") {
    const p = pending.get(d.id); if (!p) return;
    pending.delete(d.id); d.ok ? p.res(d.result) : p.rej(new Error(d.error));
  }
});
send({ type: "hello" });
})();

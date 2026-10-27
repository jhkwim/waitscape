/* bridge-host — 외부 모드를 샌드박스 iframe에서 돌리고 postMessage로 ctx 일부만 빌려준다 (ARCHITECTURE.md §4.4–4.5)
   · iframe: sandbox="allow-scripts"(allow-same-origin 없음 → opaque origin), 권한 정책 차단, 서버 응답 CSP로 네트워크 차단
   · 받는 메시지: event.source === 이 iframe 의 contentWindow 이고 { wr: 1, type, ... } 형식인 것만. op 화이트리스트 + mode.json needs 권한 확인
   · 보내는 state: @unstable 필드(cwd 등)를 뺀 정제본. targetOrigin은 "*"(opaque라 다른 값을 쓸 수 없음) → 민감 정보를 담지 않는다
   · iframe이 다른 문서로 이동하면(두 번째 load) 즉시 제거하고 모드를 끈다(이동 후 문서가 메시지를 받지 못하게)
   메시지 형식은 types/ctx.d.ts의 BridgeMessage. */
(() => {
"use strict";
const C = window.Core;
const UNSTABLE = ["kinds", "kind", "trail", "run", "last", "prompt_ts", "cwd", "report", "jump"];   // types/state.d.ts @unstable (Session). report = AI가 쓴 원문(MCP 보고)은 외부 코드에 넘기지 않음. jump = 멀티플렉서 ID(#37)
const EVENTS = ["state", "done", "input", "stall", "memo-ready", "memo", "settings", "mode"];
const KEYS = /^([1-9]|b|B|,|nunchi|mini)$/;   // nunchi·mini = 샌드박스 안에서 누른 ⌘1·⌘2(Ctrl+1·2), ⌘,는 ","로
const STORE_LIMIT = 256 * 1024, MSG_LIMIT = 64 * 1024, NOTIFY_PER_MIN = 6;
const SID = /^[A-Za-z0-9_-]{1,120}$/;
// 권한 정책: 강력한 기능은 cross-origin iframe에서 기본 차단이지만 명시적으로도 끈다 (알려진 이름만 — 모르는 이름은 콘솔 경고가 남)
const ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; fullscreen 'none'";

const cleanSession = s => { const o = {}; for (const k in s) if (!UNSTABLE.includes(k)) o[k] = s[k]; return o; };
const cleanState = st => { if (!st) return st; const { mcp, ...rest } = st; return { ...rest, sessions: (st.sessions || []).map(cleanSession) }; };   // state.mcp도 @unstable
function cleanEvent(evt, d) {
  if (evt === "state") return undefined;   // state는 별도 메시지로
  if (evt === "done" || evt === "input" || evt === "memo-ready") return cleanSession(d);
  if (evt === "stall") return { key: d.key, sid: d.sid, project: d.project, agent: d.agent, health: d.health, session: cleanSession(d.session) };
  if (evt === "settings") return undefined;
  return d;
}

function open(info, { root, url, onKey, onDead, onCtxMenu }) {
  const ns = "mode:" + info.id + ":";
  const has = p => info.needs.includes(p);
  const frame = document.createElement("iframe");
  frame.className = "core-xframe";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("allow", ALLOW);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "eager");
  frame.title = info.name;
  const msg = document.createElement("div");
  msg.className = "core-xmsg"; msg.textContent = C.t("x.loading");
  root.append(msg, frame);

  let loads = 0, ready = false, dead = false;
  const offs = [], errors = [];
  const stats = { messagesIn: 0, messagesOut: 0, rejected: 0 };
  const post = m => { if (dead || !frame.contentWindow) return; stats.messagesOut++; frame.contentWindow.postMessage({ wr: 1, ...m }, "*"); };
  const memos = st => {   // memo 권한이 있을 때만: 지금 세션들의 메모와 준비 표시
    if (!has("memo") || !st) return undefined;
    const o = {};
    for (const s of st.sessions || []) o[s.sid] = { text: C.memo.get(s.sid), ready: C.memo.ready(s.sid) };
    return o;
  };
  const storeSnapshot = () => {
    const o = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(ns)) o[k.slice(ns.length)] = localStorage.getItem(k); } } catch {}
    return o;
  };
  const storeSize = () => Object.entries(storeSnapshot()).reduce((n, [k, v]) => n + k.length + String(v).length, 0);
  const modesList = () => C.modes().filter(m => m.available).map(m => ({ id: m.id, name: m.name, icon: m.icon }));
  const settingsMsg = () => ({ type: "settings", quiet: C.settings.quiet || !!(C.nunchi && C.nunchi.on), lang: C.lang });   // 🙈 눈치 모드면 iframe도 무음(SDK가 AudioContext suspend)

  function init() {
    ready = true;
    msg.remove();
    post({ type: "init", mode: { id: info.id, name: info.name, version: info.version, needs: info.needs },
      host: { kind: C.api.kind, apiVersion: C.apiVersion, trusted: false },
      lang: C.lang, quiet: C.settings.quiet || !!(C.nunchi && C.nunchi.on), now: C.now(), state: cleanState(C.state), memos: memos(C.state),
      store: storeSnapshot(), modes: modesList() });
  }
  const reply = (id, ok, v) => post({ type: "reply", id, ok, ...(ok ? { result: v } : { error: String(v) }) });
  const notifyTimes = [];
  let lastChime = 0;

  // op 표: [필요 권한, 처리 함수(args) → 결과 | Promise]
  const OPS = {
    "store.set": [null, a => {
      if (typeof a.key !== "string" || a.key.length > 128) throw new Error("bad key");
      if (a.value == null) { localStorage.removeItem(ns + a.key); return true; }
      const v = String(a.value);
      if (storeSize() + a.key.length + v.length - (localStorage.getItem(ns + a.key) || "").length > STORE_LIMIT) throw new Error("store quota (256KB)");
      localStorage.setItem(ns + a.key, v); return true;
    }],
    "trace": ["trace", a => {
      if (!SID.test(a.session || "")) throw new Error("bad session");
      const prompt = a.prompt == null ? "last" : String(a.prompt);
      if (!/^(last|\d{1,6})$/.test(prompt)) throw new Error("bad prompt");
      return C.api.trace({ session: a.session, prompt, since: String(a.since || "").slice(0, 120) });
    }],
    "memo.set": ["memo", a => { if (!SID.test(a.sid || "")) throw new Error("bad sid"); C.memo.set(a.sid, String(a.value ?? "").slice(0, 8000)); return true; }],
    "memo.copy": ["memo", async a => {   // 클립보드 쓰기는 호스트가 한다(iframe은 clipboard-write 권한 없음). iframe 안 클릭은 상위 문서도 활성화함
      if (!SID.test(a.sid || "")) throw new Error("bad sid");
      if (!(navigator.userActivation && navigator.userActivation.isActive)) throw new Error("user activation required");
      return C.memo.copy(a.sid);
    }],
    "notify": ["notify", a => {
      const t = Date.now();
      while (notifyTimes.length && t - notifyTimes[0] > 60000) notifyTimes.shift();
      if (notifyTimes.length >= NOTIFY_PER_MIN) throw new Error("notify rate limit (6/min)");
      notifyTimes.push(t);
      C.notify(C.t("x.notifyPrefix", { name: info.name }) + String(a.title ?? "").slice(0, 120), String(a.body ?? "").slice(0, 240));
      return true;
    }],
    "clipboard.write": ["clipboard", async a => {
      if (!(navigator.userActivation && navigator.userActivation.isActive)) throw new Error("user activation required");
      await navigator.clipboard.writeText(String(a.text ?? "").slice(0, 100000)); return true;
    }],
    "setMode": [null, a => { if (!modesList().some(m => m.id === a.id)) throw new Error("unknown mode"); C.setMode(a.id); return true; }],
    "key": [null, a => { if (typeof a.key === "string" && KEYS.test(a.key)) onKey(a.key); return true; }],
    "ctxmenu": [null, () => { if (onCtxMenu) onCtxMenu(); return true; }],   // 샌드박스 안 우클릭(SDK가 입력란은 빼고 보냄)
    "chime": [null, a => { const t = Date.now(); if (t - lastChime > 1000) { lastChime = t; C.chime(a.kind === "done" ? "done" : "input"); } return true; }],
    "log": [null, a => { if (errors.length < 50) { errors.push(String(a.text || "").slice(0, 500)); console.warn(`[${info.id}·샌드박스]`, String(a.text || "").slice(0, 500)); } return true; }],
  };

  async function onMessage(e) {
    if (dead || e.source !== frame.contentWindow) return;   // 이 iframe이 보낸 것만 (origin은 opaque라 "null")
    const d = e.data;
    stats.messagesIn++;
    if (!d || typeof d !== "object" || d.wr !== 1 || typeof d.type !== "string") { stats.rejected++; return; }
    if (d.type === "hello") { if (!ready) init(); return; }
    if (d.type !== "call" || typeof d.op !== "string" || !Number.isInteger(d.id)) { stats.rejected++; return; }
    let size = 0; try { size = JSON.stringify(d.args ?? null).length; } catch { size = Infinity; }
    const op = Object.prototype.hasOwnProperty.call(OPS, d.op) ? OPS[d.op] : null;
    if (!op || size > MSG_LIMIT) { stats.rejected++; reply(d.id, false, op ? "message too large" : "unknown op: " + d.op); return; }
    if (op[0] && !has(op[0])) { stats.rejected++; reply(d.id, false, `permission '${op[0]}' not declared in mode.json needs`); return; }
    try { reply(d.id, true, await op[1](d.args && typeof d.args === "object" ? d.args : {})); }
    catch (err) { reply(d.id, false, err && err.message || err); }
  }
  window.addEventListener("message", onMessage);
  offs.push(() => window.removeEventListener("message", onMessage));

  // 이벤트 전달 (권한이 없는 memo 이벤트는 보내지 않음)
  for (const evt of EVENTS) {
    if (evt === "state") continue;
    if (evt === "memo" && !has("memo")) continue;
    if (evt === "settings") { offs.push(C.on("settings", () => ready && post(settingsMsg()))); continue; }
    offs.push(C.on(evt, data => ready && post({ type: "event", evt, data: cleanEvent(evt, data) })));
  }
  offs.push(C.on("modes", () => ready && post({ type: "modes", modes: modesList() })));

  frame.addEventListener("load", () => {
    loads++;
    if (loads > 1) { dispose(); onDead("navigated"); }   // 스스로 다른 주소로 이동함 → 바로 제거
  });
  const timer = setTimeout(() => { if (!ready && !dead) { msg.textContent = C.t("x.fail"); } }, 5000);
  frame.src = url;

  function dispose() {
    if (dead) return;
    dead = true; clearTimeout(timer);
    offs.forEach(f => f()); offs.length = 0;
    frame.remove(); msg.remove();
  }
  return {
    frame,
    update(st) { if (ready) post({ type: "state", state: cleanState(st), now: C.now(), memos: memos(st) }); },
    dispose,
    stats: () => ({ intervals: 0, timeouts: 0, rafs: 0, listeners: offs.length, ...stats, errors: errors.length, ready }),
    errors: () => errors.slice(),
  };
}

window.CoreBridge = { open, cleanState, UNSTABLE };
})();

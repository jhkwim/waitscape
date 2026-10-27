/* 코어 — 어느 모드를 보든 항상 동작하는 부분 (Mode API v1, 명세: types/ctx.d.ts)
   · 데이터는 Core.api(api.js)로만 받는다: http는 /state 1초 폴링, 앱(Tauri)은 push. 서버 시계 보정
   · 상태 전이 감지(완료 / 입력 필요 / 멈춤 의심) → 소리·알림 1회 + 이벤트 버스로 모드에 전달
   · 회의 모드·언어·알림 설정, 메모 저장(localStorage `memo:<sid>`), 순수 함수(core-lib.js)
   · 🙈 눈치 모드(nunchi.js): B 키·전역 단축키(앱)로 평범한 업무 화면 "Agent Sessions" ↔ 원래 모드. 제목·알림 문구도 담백하게, 효과음 없음
   · 모드 플랫폼: 모드 = 폴더 + mode.json. 목록은 발견(내장 modes/index.json + 사용자 모드 폴더)해서 만들고,
     내장 모드는 메인 문서에서 직접, 외부 모드는 샌드박스 iframe(bridge-host.js)에서 실행. 처음 선택될 때 지연 로딩,
     전환 시 이전 모드를 완전히 정리. 작성법은 MODES.md */
(() => {
"use strict";
const L = window.CoreLib, I18N = window.CoreI18n, api = window.CoreApi.create();
const TAURI = api.kind === "tauri", WIDGET = !!api.isWidget;   // 앱: 설정(회의 모드·언어·모드 켜기/순서)을 백엔드에도 저장

const DEFAULT_MODE = "studio", BOSS_MODE = "work", NUNCHI_TITLE = "Agent Sessions";
const HASH_ALIAS = { daily: "hamster" };  // /#daily = 햄찌 모드의 오늘의 햄찌 카드
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PERMS = ["trace", "memo", "notify", "clipboard"];

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const storeJson = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };

/* ---------- 언어 ---------- */
let langPref = store.get("lang", "auto"), lang = I18N.resolve(langPref);
L.setLang(lang);
const t = (k, p) => I18N.t(lang, k, p);
let brand = {};
const appName = () => (brand.name && !/^</.test(brand.name) ? brand.name : t("app.fallback"));

/* ---------- 이벤트 버스 ---------- */
const handlers = {};
function on(evt, fn) { (handlers[evt] ||= new Set()).add(fn); return () => handlers[evt].delete(fn); }
function emit(evt, data) {
  for (const fn of [...(handlers[evt] || [])]) { try { fn(data); } catch (e) { console.error(`[core] ${evt} 핸들러 오류`, e); } }
}

/* ---------- 공통 설정: 회의 모드(무음), 언어, 알림 종류, 사용 한도 동의 ---------- */
let app = { ...window.CoreApi.DEFAULT_SETTINGS };  // 백엔드 설정(api.settings). http에서는 이 브라우저에만 저장
const settings = {
  quiet: store.get("quiet") === "1",
  setQuiet(v, { local = false } = {}) {   // local: 백엔드에서 온 변경(다시 보내지 않음)
    settings.quiet = !!v; store.set("quiet", v ? "1" : "0");
    for (const m of mounts) m.doc.body.classList.toggle("quiet", settings.quiet);
    if (TAURI && !local) api.settings.set({ quiet: settings.quiet }).catch(() => {});
    emit("settings", settings);
  },
  get lang() { return lang; },
  get langPref() { return langPref; },
  setLang(pref, { local = false } = {}) {
    langPref = pref === "ko" || pref === "en" ? pref : "auto"; store.set("lang", langPref);
    lang = I18N.resolve(langPref); L.setLang(lang);
    if (TAURI && !WIDGET && !local) api.settings.set({ langPref, lang }).catch(() => {});   // OS 알림·트레이 문구 언어
    document.documentElement.lang = lang;
    rebuildNames(); refreshSwitchers(); updateTitle(); nx.lang();
    emit("settings", settings);
  },
  /* 🙈 눈치 모드: 앱은 백엔드 settings가 기준(모든 창·트레이·전역 단축키), 브라우저는 이 브라우저에만 */
  get nunchi() { return nx.on; },
  setNunchi(v, { local = false } = {}) {
    app = { ...app, nunchi: !!v };
    if (!local) { nxLocalAt = Date.now(); api.settings.set({ nunchi: !!v }).catch(() => {}); }
    nxSet(!!v);
    emit("settings", settings);
  },
  get app() { return app; },
  async set(patch) { app = { ...app, ...patch }; try { await api.settings.set(patch); } catch {} emit("settings", settings); },
};
const notif = {   // 앱(Tauri)은 백엔드가 OS 알림을 보내므로 웹 Notification 권한을 묻지 않는다
  get app() { return TAURI; },
  get supported() { return TAURI || "Notification" in window; },
  get granted() { return TAURI || (notif.supported && Notification.permission === "granted"); },
  get canAsk() { return !TAURI && notif.supported && Notification.permission !== "granted"; },  // '알림 켜기' 버튼을 보일지
  request() { if (TAURI) return Promise.resolve("granted"); if (!notif.supported) return Promise.resolve("unsupported");
    return Notification.requestPermission().then(p => { emit("settings", settings); return p; }); },
};
// kind(done/input/stall/memo)가 주어지면 설정에서 끈 종류는 보내지 않는다
function notify(title, body, kind) {
  if (kind && app.notify && app.notify[kind] === false) return;
  if (nx.on && !kind) { console.info("[core] 눈치 모드라 모드 알림을 보내지 않았어요"); return; }   // 🙈 모드가 직접 보내는 알림(외부 모드 포함)은 막음
  if (nx.on && kind) { const s = nunchiText(kind, title, body); title = s[0]; body = s[1]; }
  if (api.backendNotifies && (kind === "done" || kind === "input" || kind === "stall")) return;   // 앱: 백엔드가 이미 보냄(창이 닫혀 있어도)
  if (WIDGET) return;   // 위젯 창은 알림을 보내지 않는다(메인 창과 중복)
  if (api.notify) api.notify(title, body);
}

/* ---------- 소리: AudioContext는 코어가 하나만 소유 ---------- */
let actx = null, gesture = false;   // 사용자 제스처 전에는 AudioContext를 만들지 않음(WebKit·Chrome 자동재생 정책, 콘솔 경고 방지)
function audio() {
  if (nx.on) return null;   // 🙈 눈치 모드: 어떤 모드도 소리를 내지 않음(이미 받아 둔 AudioContext는 nxSet이 suspend)
  if (!actx && !gesture) return null;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {}
  return actx;
}
function chime(kind) {
  if (settings.quiet || WIDGET || nx.on) return;   // 🙈 눈치 모드: 효과음 없음
  const wave = (main && main.def.chimeWave) || "sine";
  try {
    const ctx = audio();
    if (!ctx) return;   // 첫 클릭 전: 소리 없음
    const notes = kind === "done" ? [523, 659, 784, 1047] : [880, 660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.1;
      o.frequency.value = f; o.type = wave;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

/* ---------- 메모 (모든 모드 공유: localStorage `memo:<sid>`) ---------- */
const memoReady = new Set();
const memo = {
  get: sid => store.get("memo:" + sid, ""),
  set(sid, value) { store.set("memo:" + sid, value); memoReady.delete(sid); emit("memo", { sid, value }); },
  ready: sid => memoReady.has(sid),  // 완료 시 메모가 있으면 true, 메모를 고치거나 복사하면 false
  async copy(sid, ta) {  // 클립보드로 꺼내고 비움. ta: 클립보드 API 실패 시 select+execCommand용 textarea
    const v = ta ? ta.value : memo.get(sid);
    if (!v.trim()) return false;
    try { await navigator.clipboard.writeText(v); } catch { if (ta) { ta.select(); ta.ownerDocument.execCommand("copy"); } }
    if (ta) ta.value = "";
    memo.set(sid, "");
    return true;
  },
};

/* ---------- 알림·탭 제목 기본 문구 (모드가 texts로 덮어씀. 모드 locale이 지금 언어와 다르면 기본 문구) ---------- */
/* ✍️ MCP 보고 세션(source "mcp")의 prompt·note는 AI가 직접 쓴 제목 → OS 알림에는 출처를 붙인다(앱이 하는 말처럼 보이지 않게) */
const aiSrc = (s, v) => v && s && s.source === "mcp" ? `✍️ ${L.provider(state, s).name}: ${v}` : v;
const DEFAULT_TEXTS = {
  done: s => [t("n.done", { p: s.project }), aiSrc(s, s.prompt || "")],
  input: s => [t("n.input", { p: s.project }), aiSrc(s, s.note || "")],
  stall: x => [t("n.stall", { p: x.project }), t("n.stall.body", { who: x.agent ? x.agent.desc || x.agent.type : t("n.main"), m: Math.max(1, Math.floor(x.health.secs / 60)) })],
  memo: (s, text) => [t("n.memo", { p: s.project }), text.slice(0, 80)],
  title: ({ calling, working }) => calling ? t("title.calling", { n: calling, app: appName() }) : working ? t("title.working", { n: working, app: appName() }) : appName(),
};
/* 🙈 눈치 모드 알림: 업무 툴처럼 — 제목 = 프로젝트, 본문 = 상태 한 줄(이모지·프롬프트 없음). 앱은 백엔드 detect.rs가 같은 규칙 */
let lastAlert = null;   // 방금 감지한 세션(제목·본문은 모드 문구라 프로젝트·시간을 따로 받음)
function nunchiText(kind, title, body) {
  const s = lastAlert, p = (s && s.project) || NUNCHI_TITLE;
  if (kind === "done") { const m = s && s.run > 0 ? Math.max(1, Math.round(s.run / 60)) : 0; return [p, m ? t("nx.n.doneM", { m }) : t("nx.n.done")]; }
  if (kind === "input") return [p, t("nx.n.ask")];
  if (kind === "stall") return [p, t("nx.n.stall", { m: s && s.health ? Math.max(1, Math.floor(s.health.secs / 60)) : 1 })];
  return [p, String(body || "").slice(0, 80)];   // memo: 메모 내용(사용자가 쓴 것)만
}
const text = (kind, ...a) => {
  const own = main && main.def.texts && (!main.info || !main.info.locale || main.info.locale === lang) && main.def.texts[kind];
  return (own || DEFAULT_TEXTS[kind])(...a);
};

/* ---------- state 수신 + 상태 전이 감지 ---------- */
let state = null, serverOffset = 0;
const now = () => Date.now() / 1000 - serverOffset;
const prevStatus = {};
let notifiedStall = new Set();

function detect(st) {
  // 새로 멈춤 의심이 생기면 한 번만
  const ss = L.stalls(st);
  for (const x of ss) if (!notifiedStall.has(x.key)) { chime("input"); lastAlert = { project: x.project, health: x.health }; notify(...text("stall", x), "stall"); emit("stall", x); }
  notifiedStall = new Set(ss.map(x => x.key));
  for (const s of st.sessions) {
    const p = prevStatus[s.sid];
    if (p && p !== s.status) {
      lastAlert = s;
      if (s.status === "done") {
        chime("done"); notify(...text("done", s), "done"); emit("done", s);
        const m = memo.get(s.sid);
        if (m.trim()) { memoReady.add(s.sid); notify(...text("memo", s, m), "memo"); emit("memo-ready", s); }
      } else if (s.status === "needs_input") {
        chime("input"); notify(...text("input", s), "input"); emit("input", s);
      }
    }
    prevStatus[s.sid] = s.status;
  }
}
function updateTitle() {
  if (nx.phase === "plain" || nx.phase === "returning") { if (document.title !== NUNCHI_TITLE) document.title = NUNCHI_TITLE; return; }
  if (!main) return;
  const sum = L.summary(state, now());
  document.title = text("title", { calling: sum.calling.length, working: sum.working.length, total: sum.sessions.length, state });
}
function pushState() {
  for (const m of mounts) if (m.inst && m.inst.update) { try { m.inst.update(state, m.ctx); } catch (e) { console.error(`[${m.id}] update 오류`, e); } }
}
/* 세션 숨김: 숨길 프로젝트 + 기본은 활성 세션만. 모드는 걸러진 state만 받는다(state.hidden = { n, project }). "+N개 숨김"으로 펼치기 */
let rawState = null, showAll = false;
let paused = false;   // 위젯 창이 숨겨져 있음(백엔드 widget-visible) — 파괴하지 않고 숨겼다 다시 씀
const hideOpts = () => ({ hide: app.hideProjects, builtin: app.hideBuiltin, activeOnly: app.activeOnly, minutes: app.recentMinutes, showAll });
const view = data => L.filterSessions(data, data.now, hideOpts());
function refreshHiddenChips() {
  const n = (state && state.hidden && state.hidden.n) || 0;
  for (const sel of switchers) {
    const b = sel.parentNode && sel.parentNode.querySelector(".core-hidden");
    if (!b) continue;
    b.hidden = !(n || showAll);
    b.textContent = showAll ? t("hid.collapse") : t("hid.more", { n });
    b.title = t("hid.title", { min: app.recentMinutes || L.DEFAULT_RECENT_MINUTES });
  }
}
function onState(data) {
  if (!data || !Array.isArray(data.sessions)) return;
  rawState = data;
  serverOffset = Date.now() / 1000 - data.now;
  state = view(data);
  if (paused) return;   // 숨겨 둔 위젯 창: 그리기·전이 감지·이벤트를 쉼(다시 보일 때 마지막 state로 한 번)
  pushState();  // 모드가 먼저 그리고(새 카드 생성) → 전이 이벤트(축하 연출 등)
  nx.state(state); for (const s of nxSubs) s.state(state);   // 🙈 눈치 화면(켜져 있을 때만 그림)
  detect(state);
  updateTitle();
  refreshHiddenChips();
  emit("state", state);
}
function refilter() { if (rawState) onState(rawState); }

/* ---------- 모드 목록: 발견 + 검증 + 사용자 설정(켜기·순서) ---------- */
let catalog = [];          // ModeInfo[] (types/ctx.d.ts) — 발견 순서(내장 고정 순서 → 사용자)
let discovery = { userDir: null, devDirs: [] };
const prefs = {
  order: storeJson("modes:order", []),        // id 순서 (관리 화면에서 바꿈)
  enabled: storeJson("modes:enabled", {}),    // id → bool (없으면: 내장 켜짐, 외부 꺼짐)
  ack: storeJson("modes:ack", {}),            // 외부 모드 id → 동의한 권한 서명(권한이 바뀌면 다시 확인)
  save() {
    store.set("modes:order", JSON.stringify(prefs.order)); store.set("modes:enabled", JSON.stringify(prefs.enabled)); store.set("modes:ack", JSON.stringify(prefs.ack));
    if (TAURI && !WIDGET) api.settings.set({ modes: { order: prefs.order, enabled: prefs.enabled, ack: prefs.ack } }).catch(() => {});   // 앱: settings.json에 영속
  },
  load(m) {   // 앱: 백엔드 settings.modes가 기준(비어 있으면 이 창의 localStorage 값을 올린다)
    if (!m || !m.order && !m.enabled && !m.ack) { if (TAURI && !WIDGET) prefs.save(); return; }
    prefs.order = Array.isArray(m.order) ? m.order : []; prefs.enabled = m.enabled || {}; prefs.ack = m.ack || {};
  },
};
const needsSig = info => info.needs.slice().sort().join(",");

const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._/-]{1,128}$/;
function validate(entry, builtinIds) {
  const m = entry.manifest, source = entry.source, trusted = source === "builtin";
  const info = { dir: entry.dir, id: entry.dir, source, trusted, manifest: m || null, error: entry.error || null, needs: [], styles: [],
    entry: "mode.js", compat: { ok: false, code: "bad" } };
  const bad = msg => { info.error = info.error || msg; return info; };
  if (!m || typeof m !== "object") return bad(entry.error || "mode.json을 읽을 수 없어요");
  if (!ID_RE.test(m.id || "")) return bad("id 형식이 잘못됐어요 (^[a-z0-9][a-z0-9-]{0,31}$)");
  info.id = m.id;
  if (m.id !== entry.dir) return bad(`폴더 이름(${entry.dir})과 id(${m.id})가 달라요`);
  if (!trusted && builtinIds.has(m.id)) return bad(`내장 모드와 id가 겹쳐요: ${m.id}`);
  const str = v => typeof v === "string" || (v && typeof v === "object" && Object.values(v).every(x => typeof x === "string"));
  if (!str(m.name)) return bad("name이 필요해요 (문자열 또는 { ko, en })");
  info.names = typeof m.name === "string" ? { ko: m.name, en: m.name } : m.name;
  info.icon = typeof m.icon === "string" && m.icon ? m.icon : "▫️";
  info.iconFile = /\.(svg|png)$/i.test(info.icon) && SAFE_PATH.test(info.icon) ? info.icon : null;
  if (info.iconFile) info.icon = "▫️";
  else if ([...info.icon].length > 4) info.icon = "▫️";
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(m.version || "")) return bad("version은 semver(예: 1.0.0)여야 해요");
  info.version = m.version;
  info.apiVersion = m.apiVersion;
  info.compat = L.apiCompat(m.apiVersion);
  if (m.entry != null && (typeof m.entry !== "string" || !SAFE_PATH.test(m.entry) || !/\.js$/.test(m.entry))) return bad("entry 경로가 잘못됐어요");
  info.entry = m.entry || "mode.js";
  const styles = m.styles == null ? [] : m.styles;
  if (!Array.isArray(styles) || styles.length > 8 || !styles.every(s => typeof s === "string" && SAFE_PATH.test(s) && /\.css$/.test(s))) return bad("styles 경로가 잘못됐어요");
  info.styles = styles;
  const needs = m.needs == null ? [] : m.needs;
  if (!Array.isArray(needs) || !needs.every(n => PERMS.includes(n))) return bad(`알 수 없는 권한이 있어요 (가능: ${PERMS.join(", ")})`);
  info.needs = [...new Set(needs)];
  info.author = typeof m.author === "string" ? { name: m.author } : m.author && typeof m.author.name === "string" ? { name: m.author.name, url: typeof m.author.url === "string" ? m.author.url : undefined } : null;
  info.description = str(m.description) ? m.description : "";
  info.license = typeof m.license === "string" ? m.license : "";
  info.chimeWave = ["sine", "square", "triangle", "sawtooth"].includes(m.chimeWave) ? m.chimeWave : undefined;
  info.locale = m.locale === "ko" || m.locale === "en" ? m.locale : undefined;
  info.uses = Array.isArray(m.uses) ? m.uses.filter(u => L.PROVIDER_CAPS.includes(u)) : [];   // 화면에 쓰는 프로바이더 기능(안내용)
  info.widget = trusted && m.widget === true;   // v1: 위젯 창은 내장만
  return info;
}
function rebuildNames() {
  for (const i of catalog) {
    i.name = i.names ? I18N.pick(i.names, lang) : i.id;
    i.label = i.name;   // 예전 이름(Core.modes()의 label) 호환
    i.desc = I18N.pick(i.description, lang);
  }
}
const isUsable = i => !i.error && i.compat.ok;
const isEnabled = i => {
  if (!isUsable(i)) return false;
  const v = prefs.enabled[i.id];
  if (i.trusted) return v !== false;
  return v === true && prefs.ack[i.id] === needsSig(i);   // 외부 모드는 동의한 뒤에만
};
function ordered() {
  const pos = id => { const k = prefs.order.indexOf(id); return k < 0 ? 1e4 + catalog.findIndex(i => i.id === id) : k; };
  return catalog.slice().sort((a, b) => pos(a.id) - pos(b.id));
}
const visible = () => ordered().filter(isEnabled);   // 전환기·숫자키 순서
const findInfo = id => catalog.find(i => i.id === id);

const warned = new Set();   // 같은 패키지 문제는 콘솔에 한 번만
async function discover() {
  let r;
  try { r = await api.modes(); } catch (e) { console.warn("[core] 모드 목록을 받지 못했어요", e); r = { modes: [] }; }
  const list = Array.isArray(r) ? r : r.modes || [];
  discovery = { userDir: r.userDir || null, devDirs: r.devDirs || [] };
  const builtinIds = new Set(list.filter(e => e.source === "builtin").map(e => e.dir));
  const seen = new Set();
  catalog = [];
  for (const e of list) {
    if (!e || typeof e.dir !== "string") continue;
    const info = validate(e, builtinIds);
    if (seen.has(info.id)) { info.error = info.error || `id가 겹쳐요: ${info.id}`; info.id = info.id + "~" + e.source; }   // 겹친 쪽은 목록에만(실행 안 함)
    seen.add(info.id);
    catalog.push(info);
  }
  rebuildNames();
  for (const i of catalog) if ((i.error || !i.compat.ok) && !warned.has(i.id + (i.error || i.compat.code)) && warned.add(i.id + (i.error || i.compat.code))) console.warn(`[core] 모드 '${i.dir}'를 쓸 수 없어요:`, i.error || t("compat." + i.compat.code, { v: i.apiVersion }));
  refreshSwitchers();
  emit("modes", catalog);
  return catalog;
}

/* 관리 화면에서 쓰는 조작 */
const modesApi = {
  list: () => ordered().map(i => ({ ...i, enabled: isEnabled(i), current: !!(main && main.id === i.id) })),
  get userDir() { return discovery.userDir; },
  get devDirs() { return discovery.devDirs; },
  rescan: () => discover(),
  setEnabled(id, on) {
    const i = findInfo(id);
    if (!i || !isUsable(i)) return false;
    if (!on && visible().filter(x => x.id !== id).length === 0) return false;   // 마지막 남은 모드는 끌 수 없음
    prefs.enabled[id] = !!on;
    if (on && !i.trusted) prefs.ack[id] = needsSig(i);
    prefs.save(); refreshSwitchers(); emit("modes", catalog);
    if (!on && main && main.id === id) setMode((visible()[0] || {}).id || DEFAULT_MODE);
    return true;
  },
  move(id, delta) {
    const ids = ordered().map(i => i.id), k = ids.indexOf(id), j = k + delta;
    if (k < 0 || j < 0 || j >= ids.length) return;
    [ids[k], ids[j]] = [ids[j], ids[k]];
    prefs.order = ids; prefs.save(); refreshSwitchers(); emit("modes", catalog);
  },
  forget(id) {   // 앱: 모드를 지운 뒤 켜기·순서·동의 기록도 지움
    delete prefs.enabled[id]; delete prefs.ack[id]; prefs.order = prefs.order.filter(x => x !== id); prefs.save();
  },
  needsAck: id => { const i = findInfo(id); return !!i && !i.trusted && prefs.enabled[id] === true && prefs.ack[id] !== needsSig(i); },
  compatText: i => i.error || (i.compat.ok ? "" : t("compat." + i.compat.code, { v: i.apiVersion })),
};

/* ---------- 모드 레지스트리 + 지연 로딩 (내장 = 신뢰, 메인 문서에서 실행) ---------- */
const registry = {};
const scripts = {};
const rev = {};   // 개발 모드: 파일이 바뀐 모드의 캐시 무효화 번호

function registerMode(def) {
  if (!def || !def.id || typeof def.mount !== "function") throw new Error("registerMode: id와 mount(root, ctx)가 필요해요");
  registry[def.id] = def;
  if (!findInfo(def.id)) console.warn(`[core] mode.json 없이 등록된 모드: ${def.id} (전환기에 나타나지 않아요)`);
}
const bust = id => rev[id] ? `?v=${rev[id]}` : "";
function loadScript(info) {
  const id = info.id;
  if (registry[id]) return Promise.resolve(registry[id]);
  return scripts[id] ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = api.modeBase(info) + info.entry + bust(id);
    s.dataset.modeJs = id;
    s.onload = () => registry[id] ? res(registry[id]) : (delete scripts[id], rej(new Error(`${s.src}가 Core.registerMode({ id: "${id}" })를 호출하지 않았어요`)));
    s.onerror = () => { delete scripts[id]; s.remove(); rej(new Error(t("mode.loadFail", { id }))); };
    document.head.appendChild(s);
  });
}
// 모드 CSS: media="not all"로 미리 받아두고, 이전 모드를 내린 뒤 켬 → 두 모드 CSS가 동시에 적용되는 순간이 없음
function preloadCss(info, doc) {
  return Promise.all(info.styles.map(file => new Promise(res => {
    const l = doc.createElement("link");
    l.rel = "stylesheet"; l.href = new URL(api.modeBase(info) + file + bust(info.id), location.href).href; l.media = "not all"; l.dataset.modeCss = info.id;
    l.onload = () => res(l); l.onerror = () => res(l);
    doc.head.appendChild(l);
  })));
}
function ensureCoreCss(doc) {
  if (doc === document || doc.querySelector("link[data-core-css]")) return;
  const l = doc.createElement("link");
  l.rel = "stylesheet"; l.href = new URL("core/core.css", location.href).href; l.dataset.coreCss = "";
  doc.head.appendChild(l);
}
const coreScripts = {};
function loadCoreScript(path) {   // 필요할 때만 싣는 코어 부품(bridge-host.js, manager.js)
  return coreScripts[path] ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = path; s.onload = res; s.onerror = () => { delete coreScripts[path]; s.remove(); rej(new Error(path + " 로드 실패")); };
    document.head.appendChild(s);
  });
}

/* ---------- 마운트 ---------- */
const mounts = new Set();
let main = null;  // 메인 창에 떠 있는 모드

function makeCtx(m) {
  const { doc } = m, win = doc.defaultView;
  const ivs = new Set(), tos = new Set(), rafs = new Set(), offs = [];
  const ns = "mode:" + m.id + ":";
  const ctx = {
    id: m.id, doc, win, root: m.root, switcher: m.switcher, core: Core, isMain: m.isMain,
    info: m.info ? { ...m.info } : null,
    host: { kind: api.kind, apiVersion: L.API_VERSION, trusted: true },
    get state() { return state; },
    get lang() { return lang; },
    get paused() { return paused; },   // 위젯 창이 숨겨져 있음(애니메이션을 멈출 것, 이벤트 "paused")
    now,
    on(evt, fn) { const off = on(evt, fn); offs.push(off); return off; },
    every(ms, fn) { const t = win.setInterval(() => { if (!paused) fn(); }, ms); ivs.add(t); return () => { win.clearInterval(t); ivs.delete(t); }; },   // 숨긴 위젯 창에서는 쉼
    after(ms, fn) { const t = win.setTimeout(() => { tos.delete(t); fn(); }, ms); tos.add(t); return () => { win.clearTimeout(t); tos.delete(t); }; },
    loop(fn) {  // rAF 루프 (fn(ts)가 false를 돌려주면 멈춤)
      let id;
      const step = ts => { rafs.delete(id); if ((paused || fn(ts) !== false) && !m.dead) { id = win.requestAnimationFrame(step); rafs.add(id); } };   // 숨긴 위젯 창: 그리기만 쉼
      id = win.requestAnimationFrame(step); rafs.add(id);
      return () => { win.cancelAnimationFrame(id); rafs.delete(id); };
    },
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      const off = () => target.removeEventListener(type, fn, opts);
      offs.push(off); return off;
    },
    store: { get: (k, d = null) => store.get(ns + k, d), set: (k, v) => store.set(ns + k, String(v)) },
    // openWidget(미니 보기로: 큰 창 숨김)은 앱(Tauri) 메인 창, openTerminal은 메인·위젯 창, showMain(미니 끝 → 큰 화면 복귀)은 앱 위젯 창에만 있음
    api: { trace: api.trace, openWidget: WIDGET || !api.openWidget ? undefined : openWidget, showMain: WIDGET ? () => api.closeWidget() : undefined, openTerminal: api.openTerminal && openTerminal },
    notify: (title, body) => notify(String(title), String(body ?? "")),
    clipboard: { write: v => navigator.clipboard.writeText(String(v)) },
    settings, notif, memo, audio,
    nunchi: { get on() { return nx.on; }, get phase() { return nx.phase; } },   // 🙈 눈치 모드 상태(연출 훅은 mount가 돌려주는 nunchi(ev, o))
    chime,
    setMode: id => setMode(id),
    modes: () => visible().map(x => ({ id: x.id, name: x.name, label: x.name, icon: x.icon, source: x.source })),
    _dispose() {
      ivs.forEach(t => win.clearInterval(t)); tos.forEach(t => win.clearTimeout(t)); rafs.forEach(t => win.cancelAnimationFrame(t));
      offs.forEach(f => f()); ivs.clear(); tos.clear(); rafs.clear(); offs.length = 0;
    },
    _stats: () => ({ intervals: ivs.size, timeouts: tos.size, rafs: rafs.size, listeners: offs.length }),
  };
  return ctx;
}

const switchers = new Set();
function makeSwitcher(doc) {
  const label = doc.createElement("label");
  label.className = "core-switch";
  const sel = doc.createElement("select");
  sel.addEventListener("change", () => {
    if (sel.value === "__settings") { sel.value = (main && main.id) || wanted; openSettings(); return; }
    setMode(sel.value);
  });
  label.appendChild(sel);
  const more = doc.createElement("button");   // "+N개 숨김" / "숨기기"
  more.type = "button"; more.className = "core-hidden"; more.hidden = true;
  more.addEventListener("click", () => { showAll = !showAll; refilter(); });
  label.appendChild(more);
  fillSwitcher(sel);
  return label;
}
function fillSwitcher(sel) {
  const cur = (main && main.id) || wanted;
  const list = visible();
  if (!list.some(m => m.id === cur) && findInfo(cur)) list.push(findInfo(cur));
  sel.parentNode && (sel.parentNode.title = t("sw.title", { n: Math.min(9, list.length) }));
  sel.setAttribute("aria-label", t("sw.label"));
  sel.innerHTML = list.map(m => `<option value="${L.esc(m.id)}">${m.icon} ${L.esc(m.name)}</option>`).join("")
    + `<option value="__settings">${L.esc(t("sw.settings"))}</option>`;
  sel.value = cur;
}
function refreshSwitchers() { for (const s of switchers) fillSwitcher(s); syncTray(); }
let trayQueued = false;
function syncTray() {   // 앱: 트레이 메뉴의 모드 목록 = 전환기 목록
  if (!api.setTrayModes || WIDGET || trayQueued) return;
  trayQueued = true;
  queueMicrotask(() => { trayQueued = false; api.setTrayModes(visible().map(m => ({ id: m.id, name: m.name, icon: m.iconFile ? "" : m.icon })), (main && main.id) || wanted); });
}

/* 창 안 단축키(판정은 nunchi.js lib.hotkey — 순수 함수, scripts/test_nunchi.js): ⌘1·Ctrl+1·B = 🙈 눈치 모드, 1~9 = 모드, 쉼표 = 설정 */
const keyHandler = e => {
  const a = window.CoreNunchi.lib.hotkey(e, window.CoreNunchi.lib.isMac());
  if (!a) return;
  if (a === "nunchi" && (e.metaKey || e.ctrlKey)) e.preventDefault();   // ⌘1·Ctrl+1: 브라우저 탭 이동 대신(막히지 않는 브라우저도 있어 화면 힌트는 B)
  if (a === "mini" && (e.metaKey || e.ctrlKey)) e.preventDefault();
  if (a === "nunchi") nunchiKey(); else if (a === "settings") openSettings(); else if (a === "mini") miniKey(); else hostKey(a.slice(5));
};
function hostKey(k) {   // 외부 모드 iframe에서 전달된 키도 여기로
  if (k === "b" || k === "B" || k === "nunchi") { nunchiKey(); return; }
  if (k === "mini") { miniKey(); return; }   // 샌드박스 안 ⌘2·Ctrl+2   // 🙈 눈치 모드 (예전 업무 모드 전환은 전환기·숫자 키로)
  if (k === ",") { openSettings(); return; }
  const n = +k;
  if (n >= 1 && n <= 9) { const m = visible()[n - 1]; if (m) setMode(m.id); }
}
const unlockAudio = () => { gesture = true; audio(); };

// 모드를 doc의 root에 올림. 메인 창이 아닌 곳(예: Document PiP 창)에도 같은 모드를 추가로 올릴 수 있음 (내장 모드만)
async function mount(id, { doc = document, root = null, isMain = false } = {}) {
  const info = findInfo(id);
  if (!info || !info.trusted) throw new Error("Core.mount: 내장 모드만 추가 문서에 올릴 수 있어요");
  const def = await loadScript(info);
  ensureCoreCss(doc);
  const links = await preloadCss(info, doc);
  const m = attach(def, info, doc, root, links, isMain);
  return { id: m.id, ctx: m.ctx, unmount: () => detach(m) };
}
function attach(def, info, doc, root, links, isMain) {
  root = root || doc.body.appendChild(doc.createElement("div"));
  root.classList.add("mode-root", "mode-" + def.id);
  const m = { id: def.id, def: { ...def, chimeWave: (info && info.chimeWave) || def.chimeWave }, info, doc, root, links, isMain, dead: false };
  m.switcher = makeSwitcher(doc);
  switchers.add(m.switcher.querySelector("select"));
  refreshHiddenChips();
  m.ctx = makeCtx(m);
  for (const l of links) l.media = "all";
  doc.body.dataset.mode = def.id;
  doc.body.classList.toggle("quiet", settings.quiet);
  if (doc !== document) {  // 추가 창(PiP 등): 단축키를 같이 받고, 창이 닫히면 자동 정리
    m.ctx.listen(doc, "keydown", keyHandler); m.ctx.listen(doc, "pointerdown", unlockAudio, { once: true });
    m.ctx.listen(doc.defaultView, "pagehide", () => detach(m));
    m.nxOff = nxSub(doc);   // 🙈 PiP 미니 창도 눈치 목록으로 덮음
    m.ctx.listen(doc, "contextmenu", onContextMenu);
  }
  mounts.add(m);
  try {
    m.inst = def.mount(root, m.ctx) || def;
  } catch (e) { console.error(`[${def.id}] mount 오류`, e); m.inst = {}; }
  // 모드가 전환기를 자기 UI에 두지 않았으면 오른쪽 아래에 띄움
  if (!root.contains(m.switcher)) { m.switcher.classList.add("floating"); doc.body.appendChild(m.switcher); }
  if (state && m.inst.update) { try { m.inst.update(state, m.ctx); } catch (e) { console.error(`[${def.id}] update 오류`, e); } }
  return m;
}
// 외부 모드: 샌드박스 iframe 하나를 통째로 올리고 내림 (bridge-host.js)
function attachExternal(info, root) {
  root.classList.add("mode-root", "mode-" + info.id);
  const m = { id: info.id, def: { id: info.id, chimeWave: info.chimeWave }, info, doc: document, root, links: [], isMain: true, dead: false, external: true };
  m.switcher = makeSwitcher(document);
  switchers.add(m.switcher.querySelector("select"));
  m.switcher.classList.add("floating");
  document.body.dataset.mode = info.id;
  document.body.classList.toggle("quiet", settings.quiet);
  m.frame = window.CoreBridge.open(info, { root, url: api.frameUrl(info), onKey: hostKey, onDead: why => { if (!m.dead) kill(m, why); },
    onCtxMenu: () => { if (TAURI && api.contextMenu) api.contextMenu(null, null).catch(() => {}); } });   // 샌드박스 안 우클릭(입력란 제외) → 같은 앱 메뉴
  m.inst = { update: st => m.frame.update(st) };
  m.ctx = { _dispose: () => m.frame.dispose(), _stats: () => m.frame.stats() };
  mounts.add(m);
  document.body.appendChild(m.switcher);
  return m;
}
function kill(m, why) {   // 외부 모드가 규칙을 어김(다른 페이지로 이동 등) → 내리고 끔
  console.warn(`[core] 외부 모드 '${m.id}'를 껐어요: ${why}`);
  prefs.enabled[m.id] = false; prefs.save();
  detach(m);
  refreshSwitchers();
  toast(t(why === "navigated" ? "x.navigated" : "x.fail"));
  setMode((visible()[0] || {}).id || DEFAULT_MODE);
}
function detach(m) {
  if (m.dead) return;
  m.dead = true;
  try { if (m.inst && m.inst.unmount) m.inst.unmount(m.ctx); } catch (e) { console.error(`[${m.id}] unmount 오류`, e); }
  m.ctx._dispose();
  m.root.replaceChildren();
  m.root.classList.remove("mode-" + m.id);
  m.switcher.remove();
  switchers.delete(m.switcher.querySelector("select"));
  for (const l of m.links) l.remove();
  if (m.doc.body.dataset.mode === m.id) delete m.doc.body.dataset.mode;
  mounts.delete(m);
  if (m.nxOff) m.nxOff();
  if (main === m) main = null;
}
function toast(msg) {
  const d = document.createElement("div");
  d.className = "core-toast"; d.setAttribute("role", "status"); d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 6000);
}

/* ---------- 모드 전환 ---------- */
let wanted = DEFAULT_MODE, lastNonBoss = DEFAULT_MODE, seq = 0;
const appRoot = () => document.getElementById("app") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "app" }));

async function setMode(id, { remember = true, force = false } = {}) {
  id = HASH_ALIAS[id] || id;
  if (!force && main && main.id === id && !main.dead) { refreshSwitchers(); return true; }
  const info = findInfo(id);
  if (!info || !isEnabled(info)) {
    if (info) console.warn("[core]", info.error || modesApi.compatText(info) || `모드가 꺼져 있어요: ${id}`);
    refreshSwitchers(); return false;
  }
  const my = ++seq, prevWanted = wanted;
  wanted = id;
  let def, links = [];
  try {
    if (info.trusted) { def = await loadScript(info); links = await preloadCss(info, document); }
    else await loadCoreScript("core/bridge-host.js");
  } catch (e) {
    console.warn("[core]", e.message);
    if (my === seq) { wanted = main ? main.id : prevWanted; refreshSwitchers(); }
    return false;
  }
  if (my !== seq) { for (const l of links) l.remove(); return false; }  // 그 사이 다른 모드가 눌림
  if (main) detach(main);
  main = info.trusted ? attach(def, info, document, appRoot(), links, true) : attachExternal(info, appRoot());
  if (id !== BOSS_MODE) lastNonBoss = id;
  if (remember) {
    store.set("mode", id); store.set("mode:last", lastNonBoss);
    const hash = location.hash.slice(1);
    if (hash && hash !== id && !(HASH_ALIAS[hash] === id)) history.replaceState(null, "", "#" + id);
  }
  refreshSwitchers();
  updateTitle();
  emit("mode", id);
  return true;
}
function toggleBoss() {
  const cur = main ? main.id : wanted;
  return setMode(cur === BOSS_MODE ? (lastNonBoss !== BOSS_MODE ? lastNonBoss : DEFAULT_MODE) : BOSS_MODE);
}
function modeFromHash() { const h = location.hash.slice(1); return HASH_ALIAS[h] || (h && ID_RE.test(h) ? h : null); }

/* ---------- 터미널로 이동 (앱): 세션 cwd에서 터미널 열기, 안 되면 경로 복사 ----------
   멀티플렉서(cmux #37 · Orca #40) 세션이면 백엔드가 그 자리로 간다: mux = 이동, mux-app = 대상이 닫혀(Orca: 터미널을 못 찾아) 앱만 앞으로,
   mux-launch = (Orca) 꺼져 있어 앱만 띄움, mux-off = 앱이 꺼져 있어(Orca: 띄우지도 못해) 경로 복사,
   mux-denied = 켜져 있는데 닿지 않아(cmux: 외부 접근 끔·비밀번호, Orca: 런타임 응답 없음) 경로 복사 + 이유. 모드에는 "opened" | "unsupported"만 돌려준다 */
const MUX_LABEL = L.MUX_NAME;   // 백엔드 kind → 표시 이름 (core-lib과 하나)
async function openTerminal(sid) {
  let r;
  try { r = await api.openTerminal(sid); } catch (e) { toast(String(e)); return "unsupported"; }
  const res = r && r.result, kind = String((r && r.kind) || ""), mx = { mux: MUX_LABEL[kind] || kind }, O = kind === "orca";
  if (res === "opened" || res === "mux") return "opened";
  if (res === "mux-app") { toast(t(O ? "term.orcaApp" : "term.muxApp", mx)); return "opened"; }
  if (res === "mux-launch") { toast(t("term.orcaLaunch", mx)); return "opened"; }
  if (r && r.cwd) { try { await navigator.clipboard.writeText(r.cwd); toast(t(res === "mux-denied" ? (O ? "term.orcaDenied" : "term.muxDenied") : res === "mux-off" ? (O ? "term.orcaOff" : "term.muxOff") : "term.copied", mx)); } catch { toast(r.cwd); } }
  else toast(t("term.none"));
  return "unsupported";
}

/* ---------- 미니 보기 열기 (앱 메인 창: 📌 미니 보기·포켓 위에 띄우기) ----------
   실패하면 이유를, 10초 안에 답이 없으면(Windows 교착 의심) 로그 폴더 안내를 toast로. 결과·오류는 모드에 그대로 돌려준다 */
function openWidget(modeId) {
  const what = t(modeId === "studio" ? "w.lobby" : "w.mini");
  const slow = setTimeout(() => toast(t("w.slow", { what })), 10000);
  return Promise.resolve(api.openWidget(modeId)).then(r => { clearTimeout(slow); return r; },
    e => { clearTimeout(slow); toast(t("w.fail", { what, why: String((e && e.message) || e) })); throw e; });
}

/* ---------- 🙈 눈치 모드 (nunchi.js) ----------
   화면·블라인드는 코어가, 긴 연출(퇴장·출근)은 메인 모드 인스턴스의 nunchi(ev, o)가 그린다(스튜디오). 표 행 순서는 nunchiOrder(),
   구석 고양이는 스튜디오 정의의 nunchiCat(doc) — 다른 모드를 보고 있어도 스튜디오 스크립트만 불러 스프라이트를 빌린다 */
const modeInst = () => main && !main.dead && !main.external && main.inst ? main.inst : null;
const nx = window.CoreNunchi.create({
  doc: document, widget: WIDGET, t, L, store,
  state: () => state, now: () => now(),
  hook: (ev, o) => { const i = modeInst(); return i && typeof i.nunchi === "function" ? i.nunchi(ev, o) : null; },
  order: () => { const i = modeInst(); try { return i && typeof i.nunchiOrder === "function" ? i.nunchiOrder() : null; } catch { return null; } },
  cat: async () => {
    const info = findInfo("studio");
    if (!info || !info.trusted || !isUsable(info)) return null;
    const def = await loadScript(info);
    return typeof def.nunchiCat === "function" ? def.nunchiCat(document) : null;
  },
  long: () => !!app.nunchiLong,
  theme: () => app.nunchiTheme || "system",
  daylog: api.daylog ? () => api.daylog("today") : null,   // 오늘 요약(일보와 같은 집계, 4시 경계)
  quiet: () => settings.quiet,
  openTerminal: sid => api.openTerminal ? openTerminal(sid) : undefined,
  showMain: WIDGET && api.closeWidget ? () => api.closeWidget() : null,
  openSettings: WIDGET ? null : () => openSettings(),   // 눈치 화면 머리줄 [설정] — 켜진 뒤 여는 설정 창은 눈치 화면 위에(닫는 건 켜는 순간뿐)
  openMini: !WIDGET && api.openWidget ? () => miniKey() : null,   // 눈치 화면 [미니 보기] — 위젯도 눈치 목록으로 뜸
  miniSettings: WIDGET && api.menuAction ? () => api.menuAction("settings-mini").catch(() => {}) : null,   // 위젯 ⚙ = 큰 화면 + 설정(닫으면 미니 보기로)
  onPhase: () => { updateTitle(); emit("nunchi", { on: nx.on, phase: nx.phase }); },
  app: TAURI,
});
/* 켜고 끄기를 모든 눈치 화면(메인 + PiP 미니 창)에 · 소리 멈춤/재개 · 켤 때 열린 설정·대화상자 닫기 */
let nxLocalAt = 0, nxRecheck = 0;
const nxSubs = new Set();   // 브라우저 Document PiP(미니 보기·포켓)의 작은 목록
function nxSet(v, o) {
  nx.set(v, o);
  for (const s of nxSubs) s.set(v, { instant: true });
  try { if (actx) { if (v) actx.suspend(); else if (gesture) actx.resume(); } } catch {}
  if (v) {
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    const host = document.getElementById("core-manager");
    if (host && host.shadowRoot) host.shadowRoot.querySelectorAll("dialog[open]").forEach(d => d.close());
  }
}
function nxSub(doc) {   // 추가 문서(PiP)에 작은 목록 — 메인의 블라인드·연출 없이 바로
  if (!doc.querySelector("link[data-nx-css]")) { const l = doc.createElement("link"); l.rel = "stylesheet"; l.href = new URL("core/nunchi.css", location.href).href; l.dataset.nxCss = ""; doc.head.appendChild(l); }
  const s = window.CoreNunchi.create({ doc, widget: true, t, L, store, miniSettings: () => openSettings(), state: () => state, now: () => now(), hook: () => null, order: () => null, cat: () => null,
    long: () => false, quiet: () => true, onPhase: () => {}, theme: () => app.nunchiTheme || "system", openTerminal: api.openTerminal ? sid => openTerminal(sid) : undefined });
  if (nx.on) s.set(true, { instant: true });
  if (state) s.state(state);
  nxSubs.add(s);
  return () => nxSubs.delete(s);
}
/* ⌘2·Ctrl+2: 큰 화면 → 미니 보기(지금 모드가 위젯을 지원하면 그것, 아니면 마지막에 띄운 미니 보기·스튜디오), 위젯 → 큰 화면 */
let miniAt = 0;   // ⌘2 연타: 0.4초 안의 다음 누름은 무시(백엔드도 전환 가드가 있음 — windows.rs SETTLE)
function miniKey() {
  if (Date.now() - miniAt < 400) return;
  miniAt = Date.now();
  if (WIDGET) { if (api.closeWidget) api.closeWidget(); return; }
  if (!api.openWidget) return;
  const cur = main && main.info && main.info.widget ? main.id : store.get("widget:mode", "studio");
  openWidget(cur).catch(() => {});
}
/* 앱 우클릭 메뉴(네이티브, ctxmenu.rs): WebView 기본 메뉴(새로고침·검사) 대신. 입력란은 기본 편집 메뉴 그대로, 브라우저 판은 가로채지 않음.
   개발 빌드는 Shift+우클릭이면 기본 메뉴(검사용). 세션 위면 sid(+ 모드가 주는 제목 줄 — 눈치 모드면 이모지 없이) */
function onContextMenu(e) {
  if (!TAURI || !api.contextMenu) return;
  const tg = (e.composedPath && e.composedPath()[0]) || e.target;   // 설정 화면(Shadow DOM) 안의 실제 대상 — 입력란이면 기본 편집 메뉴
  if (tg && (/^(TEXTAREA|INPUT|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
  if (appInfo.debug && e.shiftKey) return;
  e.preventDefault();
  const sid = tg && tg.closest ? window.CoreNunchi.lib.sidAt(tg) : null, i = modeInst();
  let title = null;
  try {
    const ss = sid && state && state.sessions.find(x => x.sid === sid);
    if (ss && nx.on) title = `${ss.project} · ${t(window.CoreNunchi.lib.stat(ss)[0])}`;   // 눈치 모드: 표와 같은 담백한 상태(이모지 없음)
    else if (sid && i && typeof i.contextTitle === "function") title = i.contextTitle(sid);
  } catch {}
  api.contextMenu(sid, title ? String(title) : null).catch(e2 => console.warn("[core] 우클릭 메뉴", e2));
}
/* 메뉴에서 고른 세션 동작(이 창에서): 그 세션으로 이동 · 폴더 경로 복사 */
function onCtxAction(p) {
  if (!p || typeof p.sid !== "string") return;
  if (p.act === "go" && api.openTerminal) { openTerminal(p.sid); return; }
  const s = rawState && rawState.sessions.find(x => x.sid === p.sid);
  if (p.act === "copy" && s && s.cwd) navigator.clipboard.writeText(s.cwd).then(() => toast(t("nx.copied", { p: s.project })), () => toast(s.cwd));
}
/* B 키·전역 단축키(앱 큰 창): 전환 중이면 바로 끝, 아니면 켜고 끄기 */
function nunchiKey() { if (!nx.skip()) settings.setNunchi(!nx.on); }

/* ---------- 빌드 기능 (앱 app_info.features): 꺼진 기능은 ctx·설정 화면에서 숨긴다 ---------- */
// 브라우저(http)에는 앱 기능이 없다. 앱은 cargo feature(updater·terminal-jump)를 그대로 알려 준다(docs/RELEASE.md '빌드 플레이버')
const appInfo = { version: "", features: { updater: false, terminalJump: !!api.openTerminal }, updateReady: false };
function applyAppInfo(i) {
  if (!i || typeof i !== "object") return;
  appInfo.version = String(i.version || "");
  appInfo.updateReady = !!i.updateReady;
  appInfo.debug = !!i.debug;   // 개발 빌드: Shift+우클릭 = WebView 기본 메뉴
  if (i.features && typeof i.features === "object") appInfo.features = { updater: !!i.features.updater, terminalJump: !!i.features.terminalJump };
  if (!appInfo.features.terminalJump) api.openTerminal = undefined;   // 모드의 '터미널로 이동' 버튼이 사라짐(ctx.api.openTerminal 없음)
}

/* ---------- 앱 업데이트 (앱 메인 창): 새 버전 배너 + 대화상자(manager.js). 확인·내려받기·설치는 백엔드(updater.rs) ---------- */
const update = {
  status: null,   // update_status 결과 { compiled, ready, current, available: { version, notes, date } | null, phase }
  get available() { return (this.status && this.status.available) || null; },
  open: () => openSettings("update"),
};
function setUpdate(st) {
  if (!st || typeof st !== "object") return;
  const before = update.available && update.available.version;
  update.status = st;
  renderUpdateBanner();
  if ((update.available && update.available.version) !== before) emit("update", update.available);
}
function renderUpdateBanner() {
  const a = update.available;
  let el = document.getElementById("core-update");
  if (!a || WIDGET || store.get("update:later") === a.version) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "core-update"; el.className = "core-update"; el.setAttribute("role", "status");
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.act === "later") { if (update.available) store.set("update:later", update.available.version); renderUpdateBanner(); }
      else update.open();
    });
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>🎁 ${L.esc(t("upd.banner", { v: a.version }))}</span><button type="button" data-act="open">${L.esc(t("upd.see"))}</button>`
    + `<button type="button" data-act="later" title="${L.esc(t("upd.later"))}" aria-label="${L.esc(t("upd.later"))}">✕</button>`;
}

/* ---------- 설정 화면 (manager.js는 처음 열 때 불러옴) ---------- */
async function openSettings(tab, opts) {   // opts.fromMini: 미니 보기에서 연 설정(닫으면 미니 보기로 돌아감)
  try { await loadCoreScript("core/manager.js"); window.CoreManager.open(tab, opts); } catch (e) { console.warn("[core]", e.message); }
}

/* ---------- 개발 모드: 개발 서버(tools/dev.ts)가 파일 변경을 알려 주면 자동 새로고침 ---------- */
const dev = { on: false, connected: false };
function connectDev() {
  dev.on = true;
  const es = new EventSource("/_dev/events");
  es.onopen = () => { dev.connected = true; emit("settings", settings); };
  es.onerror = () => { dev.connected = false; };
  es.onmessage = async e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === "core") { location.reload(); return; }
    if (msg.kind !== "mode") return;
    const before = main && main.id;
    await discover();
    const info = msg.dir && findInfo(msg.dir);
    if (info) {
      rev[info.id] = (rev[info.id] || 0) + 1;
      if (info.trusted) {
        delete registry[info.id]; delete scripts[info.id];
        document.querySelectorAll(`script[data-mode-js="${info.id}"]`).forEach(s => s.remove());
      }
    }
    if (before && (!info || info.id === before)) setMode(before, { force: true });
    else refreshSwitchers();
  };
}

/* ---------- 공개 API ---------- */
const Core = window.Core = {
  registerMode, setMode, toggleBoss, mount,
  get mode() { return main ? main.id : null; },
  get state() { return state; },
  get lang() { return lang; },
  t, appName, api, now, on, emit, settings, notif, notify, chime, audio, memo, store,
  modes: () => ordered().map(m => ({ id: m.id, name: m.name, label: m.name, icon: m.icon, source: m.source, available: isEnabled(m) })),
  manage: modesApi, openSettings, dev, toast,
  nunchi: { get on() { return nx.on; }, get phase() { return nx.phase; }, toggle: nunchiKey, set: v => settings.setNunchi(v) },
  appInfo, update,   // 앱 버전·빌드 기능, 새 버전(update.available·open()) — 스튜디오 사장님 말풍선·설정 화면이 씀
  // 순수 함수 (core-lib.js)
  hash: L.hash, pick: L.pick, esc: L.esc, fmt: L.fmt, fmtTok: L.fmtTok, dur: L.dur, hms: L.hms,
  untilText: L.untilText, clockText: L.clockText, spanText: L.spanText,
  sessionStatus: L.sessionStatus, isActive: L.isActive, stalls: L.stalls, summary: L.summary,
  limitCalc: L.limitCalc, limits: L.limits, limitNote: L.limitNote,
  filterSessions: L.filterSessions, isLive: L.isLive,
  provider: L.provider, can: L.can, providerBadge: L.providerBadge, muxName: L.muxName,
  apiVersion: L.API_VERSION, apiCompat: L.apiCompat,
  _debug: () => ({ mounts: [...mounts].map(m => ({ id: m.id, ...m.ctx._stats() })), handlers: Object.fromEntries(Object.entries(handlers).map(([k, v]) => [k, v.size])) }),
};

// 백엔드 설정 반영 (다른 창·트레이에서 바뀐 회의 모드·언어 포함)
function applyBackendSettings(s) {
  if (!s || typeof s !== "object") return;
  app = { ...app, ...s };
  if (typeof s.quiet === "boolean" && s.quiet !== settings.quiet) settings.setQuiet(s.quiet, { local: true });
  if (s.langPref && s.langPref !== langPref) settings.setLang(s.langPref, { local: true });
  if (typeof s.nunchi === "boolean" && s.nunchi !== nx.on) {   // 단축키·트레이·다른 창
    /* B 연타: 방금(0.8초 안) 이 창에서 바꿨으면 늦게 도착한 옛 이벤트는 무시하고, 잠시 뒤 백엔드 값으로 한 번 맞춤 */
    const age = Date.now() - nxLocalAt;
    if (age < 800) { clearTimeout(nxRecheck); nxRecheck = setTimeout(() => api.settings.get().then(v => { if (v && typeof v.nunchi === "boolean" && v.nunchi !== nx.on) nxSet(v.nunchi); }, () => {}), 900 - age); }
    else nxSet(s.nunchi);
  }
  emit("settings", settings);
}
on("settings", refilter);   // 숨김 설정이 바뀌면 바로 다시 거름 (refilter는 "state"만 보내므로 되돌아오지 않음)
on("settings", () => { nx.restyle(); for (const s of nxSubs) s.restyle(); });   // 🙈 눈치 화면 밝기(nunchiTheme)
function tauriBoot(s) {
  if (s) {
    if (typeof s.quiet === "boolean") { settings.quiet = s.quiet; store.set("quiet", s.quiet ? "1" : "0"); }
    if (s.langPref && s.langPref !== langPref) settings.setLang(s.langPref, { local: true });
    else if (!WIDGET && s.lang !== lang) api.settings.set({ langPref, lang }).catch(() => {});
    prefs.load(s.modes);
  }
  api.on("settings", applyBackendSettings);
  api.on("ctx-action", onCtxAction);   // 우클릭 메뉴의 세션 이동·경로 복사(이 창 것만 옴)
  if (WIDGET) api.on("widget-visible", v => {   // 숨김 = 타이머·그리기·감지 멈춤, 다시 보임 = 재개(마지막 state로 한 번) + 살아 있다는 응답
    paused = v === false;
    emit("paused", paused);
    if (!paused) { if (api.widgetAck) api.widgetAck().catch(() => {}); if (rawState) onState(rawState); }
  });
  document.addEventListener("contextmenu", onContextMenu);
  if (WIDGET) return;
  api.on("nunchi-key", nunchiKey);   // 전역 단축키(큰 창이 보일 때 백엔드가 이 창에 맡김)
  api.on("set-mode", id => { if (typeof id === "string") setMode(id); });
  api.on("open-settings", p => openSettings(undefined, { fromMini: !!(p && p.fromMini) }));
  if (api.update && appInfo.features.updater) {
    api.on("update", setUpdate);
    api.on("update-show", () => update.open());   // 트레이 "업데이트 있음"
    api.update.status().then(setUpdate, () => {});
    on("settings", renderUpdateBanner);   // 언어가 바뀌면 문구도
  }
  api.on("nav-blocked", () => { if (main && main.external && !main.dead) kill(main, "navigated"); });   // 샌드박스 탈출 시도(백엔드가 이동을 막음)
  api.on("tauri://drag-drop", async p => {   // 창에 끌어다 놓기 → 모드 설치
    const path = p && Array.isArray(p.paths) && p.paths[0];
    if (!path) return;
    await openSettings("modes");
    if (window.CoreManager && window.CoreManager.installPath) window.CoreManager.installPath(path);
  });
}
// 위젯 창(widget.html#<모드>): mode.json에 "widget": true인 내장 모드(포켓·스튜디오)를 '떨어진 창' 모양으로만 올린다.
// 해시가 없으면(앱 재시작·트레이) 마지막에 띄운 모드. 창 크기·닫기·끌기는 백엔드 명령으로
async function bootWidget(fallback) {
  // WKWebView는 outerWidth/Height가 0이라 모드의 "바깥 크기 = 안 + 테두리" 계산이 틀어진다 → 무테 창이므로 안 크기와 같게
  for (const k of ["Width", "Height"]) { try { Object.defineProperty(window, "outer" + k, { get: () => window["inner" + k], configurable: true }); } catch {} }
  window.resizeTo = (w, h) => api.resizeWidget(Math.round(w), Math.round(h));
  window.close = () => api.closeWidget();   // 위젯 닫기 = 미니 보기 끝 → 큰 화면 복귀(백엔드). 창이 하나도 안 보이는 상태를 만들지 않는다
  /* 위젯 창 단축키: 🙈 눈치 모드(⌘1·Ctrl+1·B)만 — 모드 전환·설정은 큰 창에서 */
  document.addEventListener("keydown", e => {   // 위젯: ⌘1·B = 눈치 모드, ⌘2 = 큰 화면으로
    const a = window.CoreNunchi.lib.hotkey(e, window.CoreNunchi.lib.isMac());
    if (a === "nunchi") { e.preventDefault(); nunchiKey(); } else if (a === "mini" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); miniKey(); }
    else if (a === "settings" && (e.metaKey || e.ctrlKey) && api.menuAction) { e.preventDefault(); api.menuAction("settings-mini").catch(() => {}); }   // ⌘, = 큰 화면 + 설정(닫으면 미니로)
  });
  // 창 끌기: 빈 자리는 누르자마자 끌기. 모드가 "누르면 반응"으로 표시한 자리([data-act="poke"])는 누른 채 4px 넘게 움직일 때만 끌기로 넘기고,
  // 그때 이어지는 click은 버린다(반응 없이 창만 움직임). 버튼·[data-act]는 끌기 대상이 아님. 상단 바·하단 자막 줄은 늘 빈 자리라 바로 끌림
  let press = null, dragged = false;
  document.addEventListener("mousedown", e => {
    press = null; dragged = false;
    if (e.button !== 0 || e.target.closest("button, textarea, input, select, a, label, [contenteditable]")) return;
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "poke") { press = { x: e.screenX, y: e.screenY }; return; }
    if (act) return;
    api.startDrag();
  });
  document.addEventListener("mousemove", e => {
    if (!press || !(e.buttons & 1)) { press = null; return; }
    if (Math.abs(e.screenX - press.x) > 4 || Math.abs(e.screenY - press.y) > 4) { press = null; dragged = true; api.startDrag(); }
  });
  document.addEventListener("mouseup", () => { press = null; });
  document.addEventListener("click", e => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
  api.subscribe(onState);
  const [, b, s, ai] = await Promise.all([discover(), api.brand().catch(() => ({})), api.settings.get().catch(() => null),
    api.appInfo ? api.appInfo().catch(() => null) : null]);
  brand = b || {}; if (s) app = { ...app, ...s };
  applyAppInfo(ai);   // 개발 빌드면 Shift+우클릭 = WebView 기본 메뉴(위젯도)
  tauriBoot(s);
  document.title = appName();
  if (app.nunchi) nxSet(true, { instant: true });   // 🙈 눈치 모드로 시작(다시 켜도 유지)
  const want = modeFromHash() || store.get("widget:mode") || fallback, wi = findInfo(want);
  const modeId = wi && wi.widget && isUsable(wi) ? want : fallback;
  store.set("widget:mode", modeId);
  if (location.hash.slice(1) !== modeId) history.replaceState(null, "", "#" + modeId);   // 같은 모드를 다시 열 때 hashchange가 안 나게
  window.addEventListener("hashchange", () => location.reload());   // 이미 열린 위젯에 다른 모드를 띄움(백엔드가 해시만 바꿈)
  try { await mount(modeId, { doc: document, root: appRoot(), isMain: false }); } catch (e) { console.error("[core] 위젯 mount 실패", e); }
}

async function boot() {
  const wmeta = document.querySelector('meta[name="wr-widget"]');
  if (WIDGET || wmeta) { document.documentElement.lang = lang; return bootWidget((wmeta && wmeta.content) || "pocket"); }
  document.documentElement.lang = lang;
  lastNonBoss = store.get("mode:last", DEFAULT_MODE);
  // 예전 버전의 업무 모드 저장값(work=1) 이어받기
  const saved = store.get("mode") || (store.get("work") === "1" ? BOSS_MODE : null);
  document.addEventListener("keydown", keyHandler);
  // WebKit은 pointerdown을 사용자 활성화로 안 칠 수 있어 click·keydown도 함께 (하나라도 먼저 오면 됨)
  for (const ev of ["pointerdown", "click", "keydown"]) document.addEventListener(ev, unlockAudio, { once: true });
  window.addEventListener("hashchange", () => { const h = modeFromHash(); if (h) setMode(h); });
  api.subscribe(onState);
  const [, b, s, ai] = await Promise.all([discover(), api.brand().catch(() => ({})), api.settings.get().catch(() => null),
    api.appInfo ? api.appInfo().catch(() => null) : null]);
  brand = b || {}; if (s) app = { ...app, ...s };
  applyAppInfo(ai);   // 모드를 올리기 전에(ctx.api.openTerminal 여부가 정해짐)
  if (TAURI) { tauriBoot(s); refreshSwitchers(); }
  if (app.nunchi) nxSet(true, { instant: true });   // 🙈 눈치 모드로 시작(다시 켜도 유지) — 모드를 올리기 전에 화면부터
  updateTitle();
  const first = visible()[0];
  const ok = await setMode(modeFromHash() || saved || DEFAULT_MODE);
  if (!ok && !main) { if (!(await setMode(DEFAULT_MODE)) && first) await setMode(first.id); }
  if (document.querySelector('meta[name="wr-dev"]')) connectDev();
  // 첫 실행 온보딩. 앱은 훅 단계(onb:hooks)를 기존 사용자에게도 한 번 — 이미 켰으면 manager가 조용히 넘어감
  if (!WIDGET && (!store.get("onboarded") || (TAURI && !store.get("onb:hooks")))) openSettings("onboarding");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

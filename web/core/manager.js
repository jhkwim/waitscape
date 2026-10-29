/* 설정 화면 — 어느 모드에서든 열린다(쉼표 키, 전환기의 ⚙️ 설정…). 처음 열 때 core.js가 이 파일을 불러옴.
   탭: 모드(목록·켜기/끄기·순서·외부 모드 설치 안내·삭제 안내·권한) / 일반(언어·회의 모드·알림) / 사용 한도(동의 자리) / 개발
   앱(Tauri)에서는 manager 창으로 옮기고 설치·삭제를 백엔드 명령으로 완성한다(P3-c, P3-d). */
(() => {
"use strict";
const C = window.Core, esc = C.esc, t = (k, p) => C.t(k, p);
const APP = C.api.kind === "tauri";   // 데스크톱 앱: 설치·삭제·훅·한도·자동 시작을 백엔드 명령으로
let dlg = null, tab = "modes", note = "", offs = [];
let hookInfo = null, usageInfo = null;   // 앱: 마지막으로 받은 훅·한도 상태
let mcpInfo = null, mcpPrev = null, mcpAllow = true, mcpJust = "", mcpBusy = false, mcpNote = "";   // 앱: MCP 연결 상태·미리보기·방금 연결한 CLI
let updNote = "", updBusy = false;        // 앱: 설정의 [지금 확인] 결과 문구
let logNote = "";                         // 앱: [로그 폴더 열기]·[오픈소스 라이선스] 실패 이유
let nxInfo = null, nxBusy = false, nxKeyErr = "", nxDraft = null;   // 앱: 🙈 눈치 모드 단축키 등록 상태 { key, ok, err } · 형식 오류 · 저장 안 된 입력

// 모드 CSS가 설정 화면에 새지 않도록 Shadow DOM 안에 그린다(모드는 body 아래 요소를 넓게 꾸미는 경우가 많음)
let shadow = null, cssReady = null;
function root() {
  if (shadow && shadow.host.isConnected) return shadow;
  const host = document.createElement("div");
  host.id = "core-manager";
  shadow = host.attachShadow({ mode: "open" });
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = new URL("core/manager.css", location.href).href;
  cssReady = new Promise(r => { l.onload = r; l.onerror = r; });
  shadow.appendChild(l);
  document.body.appendChild(host);
  return shadow;
}
const srcBadge = i => `<span class="mg-badge mg-src-${i.source}">${esc(t("m.src." + i.source))}</span>`;
const permList = needs => needs.length ? `<ul class="mg-perms">${needs.map(n => `<li>${esc(t("m.perm." + n))}</li>`).join("")}</ul>` : `<p class="mg-mute">${esc(t("m.perm.none"))}</p>`;
const iconOf = i => i.iconFile && C.api.modeBase ? `<img class="mg-icon-img" alt="" src="${esc(C.api.modeBase(i) + i.iconFile)}">` : esc(i.icon);

function modesTab() {
  const list = C.manage.list(), on = list.filter(i => i.enabled).length;
  const rows = list.map((i, k) => {
    const problem = C.manage.compatText(i);
    const ack = C.manage.needsAck(i.id);
    return `<li class="mg-mode${i.enabled ? " on" : ""}${problem ? " broken" : ""}" data-id="${esc(i.id)}">
      <div class="mg-mode-ico">${iconOf(i)}</div>
      <div class="mg-mode-body">
        <div class="mg-mode-top"><b>${esc(i.name || i.id)}</b> ${i.version ? `<span class="mg-mute">v${esc(i.version)}</span>` : ""} ${srcBadge(i)}
          ${i.trusted ? "" : `<span class="mg-badge mg-sbx" title="${esc(t("m.sandboxed"))}">🔒 ${esc(t("m.sandboxed"))}</span>`}
          ${i.current ? `<span class="mg-badge mg-cur">${esc(t("m.current"))}</span>` : ""}</div>
        ${i.desc ? `<div class="mg-mute mg-desc">${esc(i.desc)}</div>` : ""}
        ${!i.trusted && i.author && i.author.name ? `<div class="mg-mute mg-small">${esc(t("m.by"))} ${esc(i.author.name)}${i.license ? " · " + esc(i.license) : ""}</div>` : ""}
        ${i.trusted ? "" : `<div class="mg-warn">⚠️ <b>${esc(t("m.notMine"))}</b> — ${esc(t("m.notMine.body"))}</div>`}
        ${!i.trusted && i.needs ? `<div class="mg-small"><span class="mg-mute">${esc(t("m.perm"))}:</span> ${i.needs.length ? i.needs.map(n => `<span class="mg-chip">${esc(n)}</span>`).join(" ") : esc(t("m.perm.none"))}</div>` : ""}
        ${problem ? `<div class="mg-err">${esc(i.error ? t("m.broken") + ": " : "")}${esc(problem)}</div>` : ""}
        ${ack ? `<div class="mg-err">${esc(t("m.permChanged"))}</div>` : ""}
      </div>
      <div class="mg-mode-ctl">
        <button class="mg-ico-btn" data-act="up" title="${esc(t("m.up"))}" aria-label="${esc(t("m.up"))}" ${k === 0 ? "disabled" : ""}>↑</button>
        <button class="mg-ico-btn" data-act="down" title="${esc(t("m.down"))}" aria-label="${esc(t("m.down"))}" ${k === list.length - 1 ? "disabled" : ""}>↓</button>
        <label class="mg-toggle" title="${esc(i.enabled && on <= 1 ? t("m.lastOne") : "")}"><input type="checkbox" data-act="toggle" ${i.enabled ? "checked" : ""}
          ${problem || (i.enabled && on <= 1) ? "disabled" : ""} aria-label="${esc(i.name || i.id)}"><span></span></label>
        ${i.trusted ? "" : `<button class="mg-btn mg-small" data-act="delete">${esc(t("m.delete"))}</button>`}
      </div>
    </li>`;
  }).join("");
  const appInstall = `<section class="mg-card"><h3>${esc(t("m.install"))}</h3>
      <p>${esc(t("m.install.tauri.how"))}</p>
      <p><button class="mg-btn mg-primary" data-act="inst-folder">📁 ${esc(t("m.install.folder"))}</button>
        <button class="mg-btn" data-act="inst-zip">🗜️ ${esc(t("m.install.zip"))}</button>
        <button class="mg-btn" data-act="open-dir">${esc(t("m.install.openDir"))}</button>
        <button class="mg-btn" data-act="rescan">${esc(t("m.install.rescan"))}</button></p>
      <p class="mg-mute mg-small">⬇️ ${esc(t("m.install.drop"))} · <code>${esc(C.manage.userDir || "")}</code></p>
      <p class="mg-note">${esc(note)}</p></section>`;
  if (APP) return `<p class="mg-mute">${esc(t("m.found", { n: list.length }))}</p><ul class="mg-modes">${rows}</ul>${appInstall}`;
  return `<p class="mg-mute">${esc(t("m.found", { n: list.length }))}</p><ul class="mg-modes">${rows}</ul>
    <section class="mg-card"><h3>${esc(t("m.install"))}</h3>
      <p>${esc(t("m.install.how"))}</p>
      <p><span class="mg-mute">${esc(t("m.install.dir"))}:</span> <code>${esc(C.manage.userDir || "~/.claude/waiting-room/modes")}</code>
        <button class="mg-btn" data-act="rescan">${esc(t("m.install.rescan"))}</button> <span class="mg-note">${esc(note)}</span></p>
      <p class="mg-mute mg-small">${esc(t("m.install.devhint"))}</p>
      <p class="mg-mute mg-small">🖥️ ${esc(t("m.install.tauri"))}</p>
    </section>`;
}
function generalTab() {
  const s = C.settings, app = s.app, n = C.notif;
  const perm = n.app ? t("g.notif.app", { app: C.appName() }) : !n.supported ? t("g.notif.unsupported") : Notification.permission === "granted" ? t("g.notif.granted") : Notification.permission === "denied" ? t("g.notif.denied") : "";
  const TERMS = [["auto", t("g.terminal.auto")], ["Terminal", "Terminal"], ["iTerm", "iTerm2"], ["Visual Studio Code", "VS Code"], ["Cursor", "Cursor"], ["Ghostty", "Ghostty"], ["WezTerm", "WezTerm"], ["Warp", "Warp"], ["cmux", "cmux"]];
  const F = C.appInfo.features;   // 빌드 기능: 꺼진 기능의 카드는 보이지 않는다
  const about = `<section class="mg-card"><h3>${esc(t("g.about"))}</h3>
      <p>${esc(t("g.about.ver", { v: C.appInfo.version || "?" }))}</p>
      <p><button class="mg-btn" data-act="open-logs">${esc(t("g.about.logs"))}</button> <button class="mg-btn" data-act="open-licenses">${esc(t("g.about.licenses"))}</button> <span class="mg-note">${esc(logNote)}</span></p>
      <p class="mg-mute mg-small">${esc(t("g.about.desc"))}</p></section>`;
  const appOnly = !APP ? "" : `${F.updater ? updateCard() : ""}${C.api.openLogDir ? about : ""}<section class="mg-card"><h3>${esc(t("g.autostart"))}</h3>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="autostart" ${app.autostart ? "checked" : ""}><span></span></span> ${esc(t("g.autostart.desc"))}</label></section>
    ${!F.terminalJump ? "" : `<section class="mg-card"><h3>${esc(t("g.terminal"))}</h3>
      <select data-act="terminal" aria-label="${esc(t("g.terminal"))}">${TERMS.map(([v, l]) => `<option value="${esc(v)}" ${(app.terminal || "auto") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></section>`}`;
  const hideCard = `<section class="mg-card"><h3>${esc(t("g.hide"))}</h3>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="active-only" ${app.activeOnly !== false ? "checked" : ""}><span></span></span> ${esc(t("g.hide.active"))}</label>
      <p class="mg-mute mg-small">${esc(t("g.hide.active.desc"))}</p>
      <p><label>${esc(t("g.hide.min"))} <input type="number" min="1" max="1440" step="1" data-act="recent-min" value="${esc(app.recentMinutes || 30)}" style="width:5em"></label></p>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="hide-builtin" ${app.hideBuiltin !== false ? "checked" : ""}><span></span></span> ${esc(t("g.hide.builtin"))}</label>
      <p class="mg-mute mg-small">${esc(t("g.hide.builtin.desc"))}</p>
      <p><b>${esc(t("g.hide.list"))}</b></p>
      <textarea data-act="hide-list" rows="4" style="width:100%" spellcheck="false" placeholder=".claude-mem/observer-sessions">${esc((app.hideProjects || []).join("\n"))}</textarea>
      <p class="mg-mute mg-small">${esc(t("g.hide.list.desc"))}</p></section>`;
  return `<section class="mg-card"><h3>${esc(t("g.lang"))}</h3>
      <select data-act="lang" aria-label="${esc(t("g.lang"))}">
        ${[["auto", t("g.lang.auto")], ["ko", "한국어"], ["en", "English"]].map(([v, l]) => `<option value="${v}" ${s.langPref === v ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select></section>
    <section class="mg-card"><h3>${esc(t("g.quiet"))}</h3>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="quiet" ${s.quiet ? "checked" : ""}><span></span></span> ${esc(t("g.quiet.desc"))}</label></section>
    ${nunchiCard()}
    <section class="mg-card"><h3>${esc(t("g.notif"))}</h3>
      ${n.canAsk && window.Notification && Notification.permission !== "denied" ? `<p><button class="mg-btn" data-act="notif">${esc(t("g.notif.ask"))}</button></p>` : `<p class="mg-mute">${esc(perm)}</p>`}
      ${["done", "input", "stall", "memo"].map(k => `<label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="nk" data-k="${k}" ${app.notify[k] !== false ? "checked" : ""}><span></span></span> ${esc(t("g.notif." + k))}</label>`).join("")}
    </section>${hideCard}${appOnly}`;
}
/* 🙈 눈치 모드: 켜기 · 단축키(앱: 전역, 등록 실패 안내) · 연출 길이 · 밝기 */
/* 단축키 읽기 쉬운 표기: 맥은 기호(⌥⇧⌘⌃), 그 밖은 Alt+` 꼴 */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// 전역 기본 = 맥 ⌃Q · 윈도우 Alt+` (settings.rs NUNCHI_KEY), 창 안 = ⌘1 / Ctrl+1 · B (core.js keyHandler)
const NX_KEY = MAC ? "Control+KeyQ" : "Alt+Backquote";
function keyLabel(k) {
  if (!k) return "";
  const sym = { Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Space: "Space" };
  const mod = MAC ? { alt: "⌥", option: "⌥", shift: "⇧", cmd: "⌘", command: "⌘", super: "⌘", cmdorctrl: "⌘", commandorcontrol: "⌘", ctrl: "⌃", control: "⌃" }
    : { alt: "Alt+", option: "Alt+", shift: "Shift+", cmd: "Win+", command: "Win+", super: "Win+", cmdorctrl: "Ctrl+", commandorcontrol: "Ctrl+", ctrl: "Ctrl+", control: "Ctrl+" };
  const p = String(k).split("+"), last = p.pop();
  return p.map(x => mod[x.toLowerCase()] || x + "+").join("") + (sym[last] || last.replace(/^Key|^Digit/, ""));
}
function nunchiCard() {
  const app = C.settings.app, key = nxDraft != null ? nxDraft : app.nunchiKey == null ? NX_KEY : app.nunchiKey;
  if (APP && C.api.nunchiStatus && !nxInfo && !nxBusy) { nxBusy = true; C.api.nunchiStatus().then(r => { nxInfo = r || {}; }, () => { nxInfo = {}; }).finally(() => { nxBusy = false; render(); }); }
  /* 전역 단축키 스위치(nunchiGlobal, 기본 켜짐): 끄면 등록만 해제하고 키 값은 그대로 — 키 칸·버튼은 흐리게. 창 안 ⌘1·B는 늘 동작 */
  const on = app.nunchiGlobal !== false, dis = on ? "" : " disabled", appKey = MAC ? "⌘1" : "Ctrl+1";
  const inapp = `<p class="mg-inapp">${esc(t(!APP ? "g.nunchi.inappBrowser" : on ? "g.nunchi.inapp" : "g.nunchi.inappOnly", { k: appKey, m: MAC ? "⌘2" : "Ctrl+2" }))}</p>`;
  const st = !APP ? `${inapp}<p class="mg-mute mg-small">${esc(t("g.nunchi.keyBrowser"))}</p>`
    : `${inapp}<label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="nx-global" ${on ? "checked" : ""}><span></span></span> ${esc(t("g.nunchi.global", { k: keyLabel(key) || "—" }))}</label>
      <div class="mg-nxkey${on ? "" : " off"}"><p><label>${esc(t("g.nunchi.key"))} <input type="text" data-act="nx-key" value="${esc(key)}" spellcheck="false" autocomplete="off"${dis} style="width:13em;font:12px ui-monospace,Menlo,Consolas,monospace"></label>
        <b class="mg-kbd">${esc(keyLabel(key))}</b> <button class="mg-btn" data-act="nx-key-save"${dis}>${esc(t("g.nunchi.save"))}</button> <button class="mg-btn" data-act="nx-key-reset"${dis}>${esc(t("g.nunchi.reset"))}</button></p>
      <p class="mg-mute mg-small">${esc(t("g.nunchi.keyDesc"))}</p>
      ${!on ? "" : nxKeyErr ? `<p class="mg-err" role="alert">${esc(t(/macos-option-only/.test(nxKeyErr) ? "g.nunchi.macopt" : "g.nunchi.bad", { k: nxDraft || "" }))}</p>` : !nxInfo ? "" : nxInfo.err
        ? `<p class="mg-err" role="alert">${esc(t("g.nunchi.fail", { k: keyLabel(nxInfo.key), e: nxInfo.err }))} <button class="mg-btn" data-act="nx-key-retry">${esc(t("g.nunchi.retry"))}</button></p>`
        : nxInfo.ok ? `<p class="mg-note">${esc(t("g.nunchi.ok", { k: `${keyLabel(nxInfo.key)} (${nxInfo.key})` }))}</p>` : nxInfo.key === "" ? `<p class="mg-mute mg-small">${esc(t("g.nunchi.off"))}</p>` : ""}</div>`;
  return `<section class="mg-card"><h3>${esc(t("g.nunchi"))}</h3>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="nunchi" ${C.settings.nunchi ? "checked" : ""}><span></span></span> ${esc(t("g.nunchi.on"))} <span class="mg-mute mg-small">(B)</span></label>
      <p class="mg-mute mg-small">${esc(t("g.nunchi.desc"))}</p>${st}
      <p><b>${esc(t("g.nunchi.anim"))}</b></p>
      ${[[false, "g.nunchi.short"], [true, "g.nunchi.long"]].map(([v, k]) => `<label class="mg-row"><input type="radio" name="nx-long" data-act="nx-long" value="${v ? 1 : 0}" ${!!app.nunchiLong === v ? "checked" : ""}> ${esc(t(k))}</label>`).join("")}
      <p class="mg-mute mg-small">${esc(t("g.nunchi.animDesc"))}</p>
      <p><label><b>${esc(t("g.nunchi.theme"))}</b> <select data-act="nx-theme" aria-label="${esc(t("g.nunchi.theme"))}">${["system", "light", "dark"].map(v => `<option value="${v}" ${(app.nunchiTheme || "system") === v ? "selected" : ""}>${esc(t("g.nunchi.theme." + v))}</option>`).join("")}</select></label></p></section>`;
}
/* 단축키 저장: 형식이 틀리면 백엔드가 거절 → 저장하지 않고 안내. 맞으면 다시 등록(같은 키여도 = 다시 시도) → 상태를 다시 읽음 */
async function saveKey(v) {
  v = String(v || "").trim().replace(/\s+/g, "");
  nxDraft = v; nxKeyErr = "";
  try { await C.api.settings.set({ nunchiKey: v }); } catch (e) { nxKeyErr = String(e); render(); return; }
  nxDraft = null; C.settings.app.nunchiKey = v;
  await retryKey();
}
async function retryKey() {
  nxBusy = true; render();
  try { nxInfo = C.api.nunchiRetry ? await C.api.nunchiRetry() : null; } catch (e) { nxInfo = { key: C.settings.app.nunchiKey, ok: false, err: String(e) }; }
  nxBusy = false; render();
}
function updateCard() {
  const app = C.settings.app, a = C.update.available, ready = C.appInfo.updateReady;
  return `<section class="mg-card"><h3>${esc(t("g.upd"))} ${a ? `<span class="mg-badge">${esc(t("g.upd.avail", { v: a.version }))}</span>` : ""}</h3>
      <p>${esc(t("g.upd.cur", { v: C.appInfo.version }))}</p>
      <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="update-check" ${app.updateCheck !== false ? "checked" : ""} ${ready ? "" : "disabled"}><span></span></span> ${esc(t("g.upd.check"))}</label>
      <p class="mg-mute mg-small">${esc(t("g.upd.desc"))}</p>
      ${ready ? `<p><button class="mg-btn" data-act="update-now" ${updBusy ? "disabled" : ""}>${esc(t(updBusy ? "g.upd.checking" : "g.upd.now"))}</button>
        ${a ? `<button class="mg-btn mg-primary" data-act="update-open">${esc(t("upd.see"))}</button>` : ""} <span class="mg-note">${esc(updNote)}</span></p>`
        : `<p class="mg-mute mg-small">${esc(t("g.upd.disabled"))}</p>`}</section>`;
}
async function checkNow() {
  if (updBusy) return;
  updBusy = true; updNote = ""; render();
  try {
    const r = await C.api.update.check();
    updNote = t({ available: "g.upd.avail", latest: "g.upd.latest", disabled: "g.upd.disabled" }[r && r.result] || "g.upd.unavailable", { v: r && r.status && r.status.available ? r.status.available.version : "" });
  } catch { updNote = t("g.upd.unavailable"); }   // 실패는 오류가 아니라 '지금은 확인할 수 없어요'로만
  updBusy = false; render();
}

// CHANGELOG 절(마크다운 일부): "### 제목"만 굵게, 나머지는 글자 그대로(이스케이프)
const notesHtml = md => String(md).split("\n").map(l => /^#{1,6}\s/.test(l) ? `<b>${esc(l.replace(/^#+\s*/, ""))}</b>` : esc(l)).join("\n");
// 새 버전 대화상자: 트레이 "업데이트 있음"·배너·스튜디오 사장님 말풍선·설정에서 연다. 설치는 [지금 업데이트]를 눌렀을 때만
let updDlg = null;
function openUpdate() {
  const a = C.update.available;
  if (!a) { open("general"); return; }
  if (updDlg) { updDlg.querySelector(".mg-primary").focus(); return; }
  const c = updDlg = document.createElement("dialog");
  c.className = "mg-dlg mg-confirm mg-upd";
  c.setAttribute("aria-labelledby", "mg-upd-title");
  c.innerHTML = `<form method="dialog"><h2 id="mg-upd-title">${esc(t("upd.title"))}</h2>
    <p><b>${esc(t("upd.from", { cur: C.appInfo.version || (C.update.status && C.update.status.current) || "?", v: a.version }))}</b></p>
    ${a.notes ? `<h3>${esc(t("upd.notes"))}</h3><div class="mg-pre mg-upd-notes">${notesHtml(a.notes)}</div>` : ""}
    <p class="mg-mute mg-small">${esc(t("upd.safe"))}</p>
    <p class="mg-note mg-upd-st" role="status" aria-live="polite"></p>
    <div class="mg-actions"><button class="mg-btn" value="later">${esc(t("upd.later"))}</button>
      <button class="mg-btn mg-primary" type="button" data-act="install">${esc(t("upd.go"))}</button></div></form>`;
  const st = c.querySelector(".mg-upd-st"), go = c.querySelector("[data-act=install]"), later = c.querySelector("[value=later]");
  const offProg = C.api.on ? C.api.on("update-progress", p => {
    if (!p) return;
    st.textContent = p.phase === "installing" ? t("upd.inst") : p.total ? t("upd.down", { pct: p.pct }) : t("upd.down0");
  }) : () => {};
  go.addEventListener("click", async () => {
    go.disabled = later.disabled = true; st.textContent = t("upd.down0");
    try { await C.api.update.install(); }   // 성공하면 앱이 다시 시작돼 돌아오지 않는다
    catch (e) { st.textContent = String(e); go.disabled = later.disabled = false; }
  });
  c.addEventListener("keydown", e => e.stopPropagation());
  c.addEventListener("cancel", e => { if (go.disabled) e.preventDefault(); });   // 내려받는 중에는 Esc로 닫지 않음
  c.addEventListener("close", () => { offProg(); c.remove(); updDlg = null; }, { once: true });
  root().appendChild(c);
  c.showModal();
  go.focus();
}

function usageTab() {
  const on = !!C.settings.app.usageLookup;
  return `<section class="mg-card"><h3>${esc(t("u.title"))}</h3>
    <p>${esc(t("u.desc"))}</p>
    <label class="mg-row"><span class="mg-toggle"><input type="checkbox" data-act="usage" ${on ? "checked" : ""}><span></span></span> ${esc(t("u.consent"))}
      <span class="mg-badge">${esc(t(on ? "u.state.on" : "u.state.off"))}</span></label>
    <p class="mg-mute mg-small">${esc(t("u.what"))}</p>
    ${APP ? usageApp(on) : `<p class="mg-info">🚧 ${esc(t("u.placeholder"))}</p>`}</section>`;
}
function usageApp(on) {
  const u = usageInfo;
  if (!u) { refreshUsage(); return ""; }
  const st = u.err ? t("u.err", { e: u.err }) : u.limitsTs ? t("u.ok") : "—";
  return `<p>${esc(t("u.app.status", { src: t("u.src." + (u.source || "none")), st }))}</p>
    ${u.keychain ? `<p><button class="mg-btn" data-act="keychain" ${on ? "" : "disabled"}>🔑 ${esc(t("u.keychain"))}</button></p><p class="mg-mute mg-small">${esc(t("u.keychain.desc"))}</p>` : ""}`;
}
let usageBusy = false, hookBusy = false;
async function refreshUsage() { if (!APP || usageBusy) return; usageBusy = true; try { usageInfo = await C.api.usage.status(); } catch { usageInfo = {}; } usageBusy = false; render(); }
async function refreshHooks() { if (!APP || hookBusy) return; hookBusy = true; try { hookInfo = await C.api.hooks.status(); } catch (e) { hookInfo = { error: String(e) }; } hookBusy = false; render(); }
function hooksTab() {
  const h = hookInfo;
  if (!h) { refreshHooks(); return `<p class="mg-mute">…</p>`; }
  const s = h.status || {};
  const state = s.complete ? "on" : s.stale ? "stale" : s.installed ? "partial" : "off";
  const last = C.state && C.state.hooks && C.state.hooks.last_event_age;
  return `<section class="mg-card"><h3>${esc(t("h.title"))} <span class="mg-badge">${esc(t("h.state." + state))}</span></h3>
      <p>${esc(t("h.desc"))}</p>
      <p class="mg-mute mg-small">${esc(t("h.what", { bin: h.binPath || "", settings: h.settingsPath || "" }))}</p>
      ${h.error ? `<p class="mg-err">${esc(h.error)}</p>` : ""}
      ${s.legacy ? `<p class="mg-warn">⚠️ ${esc(t("h.legacy"))}</p>` : ""}
      ${h.refreshError ? `<p class="mg-warn">⚠️ ${esc(t("h.refreshErr", { e: h.refreshError }))}</p>` : ""}
      ${h.sidecar === false && !s.complete ? `<p class="mg-err">${esc(t("h.nosidecar"))}</p>` : ""}
      ${last != null ? `<p class="mg-mute mg-small">${esc(t("h.last", { s: Math.round(last) }))}</p>` : ""}
      <p><button class="mg-btn mg-primary" data-act="hooks-on" ${h.error || (h.sidecar === false) ? "disabled" : ""}>${esc(t("h.install"))}</button>
        <button class="mg-btn" data-act="hooks-off" ${s.installed && !h.error ? "" : "disabled"}>${esc(t("h.uninstall"))}</button>
        <span class="mg-note">${esc(note)}</span></p></section>${mcpCard()}`;
}

/* 앱: MCP 보고 연결 (Claude Code · Codex · Antigravity). 미리보기는 안내용 — [적용]하면 백엔드가 네이티브 확인 창을 한 번 더 띄운다 */
async function refreshMcp() { if (!APP || mcpBusy) return; mcpBusy = true; try { mcpInfo = await C.api.mcp.status(); } catch (e) { mcpInfo = { error: String(e), clis: [] }; } mcpBusy = false; render(); }
const MCP_ICON = { claude: "🧣", codex: "🧢", antigravity: "👓" };   // 스튜디오 층 소품과 같은 표시
function mcpRow(r, on, side) {
  const st = r.state, conn = st === "connected";
  const badge = `<span class="mg-badge mg-mcp-${st}${mcpJust === r.id ? " mg-pop" : ""}">${conn ? "● " : ""}${esc(t("mc.state." + st))}</span>`;
  const mine = conn && !r.added ? ` <span class="mg-mute mg-small">${esc(t("mc.mine"))}</span>` : "";
  const busy = mcpPrev && mcpPrev.cli === r.id;
  // 예전 설정(다른 경로·Codex env_vars 없음): "다시 연결"로 고침 (#37)
  const re = conn && r.stale ? `<button class="mg-btn mg-primary" data-act="mcp-plan" data-cli="${esc(r.id)}" data-connect="1" ${on && side && !busy ? "" : "disabled"}>${esc(t("mc.reconnect"))}</button> ` : "";
  const btn = conn
    ? `${re}<button class="mg-btn" data-act="mcp-plan" data-cli="${esc(r.id)}" data-connect="0" ${on && r.managed && !busy ? "" : "disabled"}>${esc(t("mc.disconnect"))}</button>`
    : `<button class="mg-btn mg-primary" data-act="mcp-plan" data-cli="${esc(r.id)}" data-connect="1" ${on && side && (st === "detected") && !busy ? "" : "disabled"}>${esc(t("mc.connect"))}</button>`;
  return `<tr><td>${MCP_ICON[r.id] || "🤖"} ${esc(r.name)}<div class="mg-mute mg-small"><code>${esc(r.config || "")}</code></div></td>
    <td>${badge}${mine}${conn && r.stale ? `<div class="mg-warn mg-small">${esc(t("mc.stale"))}</div>` : ""}${r.error ? `<div class="mg-err">${esc(r.error)}</div>` : ""}</td><td class="mg-mcp-act">${btn}</td></tr>`;
}
const diffLine = l => `<span class="${l.startsWith("+ ") ? "mg-d-add" : l.startsWith("- ") ? "mg-d-del" : l.startsWith("@ ") || l.startsWith("$ ") ? "mg-d-head" : "mg-d-ctx"}">${esc(l)}</span>`;
function mcpCard() {
  const on = !!C.settings.app.mcpReports;
  const m = mcpInfo;
  if (on && !m) refreshMcp();
  const side = !m || m.sidecar !== false;
  const pv = mcpPrev, pr = pv && pv.plan;
  const pname = pv && ((m && m.clis.find(r => r.id === pv.cli)) || {}).name;
  const preview = pv ? `<div class="mg-mcp-prev" role="region" aria-label="${esc(t("mc.preview", { name: pname, act: t(pv.connect ? "mc.act.connect" : "mc.act.disconnect") }))}">
      <h4>${esc(t("mc.preview", { name: pname, act: t(pv.connect ? "mc.act.connect" : "mc.act.disconnect") }))}</h4>
      ${pr.empty ? `<p class="mg-mute">${esc(t(pr.notes && pr.notes.includes("not-ours") ? "mc.notours" : "mc.nochange"))}</p>`
        : `<pre class="mg-pre mg-diff">${pr.diff.slice(0, 60).map(diffLine).join("\n")}${pr.diff.length > 60 ? "\n…" : ""}</pre>`}
      ${!pr.empty && pr.notes && pr.notes.includes("not-ours") ? `<p class="mg-mute mg-small">${esc(t("mc.notours"))}</p>` : ""}
      ${(pr.notes || []).filter(n => ["rest-same", "reformat", "new-file"].includes(n)).map(n => `<p class="mg-mute mg-small">ℹ️ ${esc(t("mc.note." + n))}</p>`).join("")}
      <p><button class="mg-btn mg-primary" data-act="mcp-apply">${esc(t("mc.apply"))}</button>
        <button class="mg-btn" data-act="mcp-cancel">${esc(t("mc.cancel"))}</button></p></div>` : "";
  return `<section class="mg-card mg-mcp"><h3 class="mg-mcp-h">✍️ ${esc(t("mc.title"))}
      <label class="mg-toggle mg-mcp-sw" title="${esc(t("mc.title"))}"><input type="checkbox" data-act="mcp-reports" aria-label="${esc(t("mc.title"))}" ${on ? "checked" : ""}><span></span></label></h3>
    <p>${esc(t("mc.desc"))}</p>
    ${!on ? `<p class="mg-mute mg-small">${esc(t("mc.off"))}</p>` : !m ? `<p class="mg-mute">…</p>` : `
    ${m.error ? `<p class="mg-err">${esc(m.error)}</p>` : ""}
    ${!side ? `<p class="mg-err">${esc(t("mc.nosidecar"))}</p>` : ""}
    <table class="mg-mcp-tbl"><thead><tr><th>${esc(t("mc.col.tool"))}</th><th>${esc(t("mc.col.state"))}</th><th></th></tr></thead>
      <tbody>${m.clis.map(r => mcpRow(r, on, side)).join("")}</tbody></table>
    <label class="mg-row mg-small"><input type="checkbox" data-act="mcp-allow" ${mcpAllow ? "checked" : ""}> ${esc(t("mc.allow"))}</label>
    <p class="mg-mute mg-small mg-mcp-why"><code>mcp__waitscape__waitscape_status</code> <code>mcp__waitscape__waitscape_board</code> — ${esc(t("mc.allow.why"))}</p>
    ${preview}
    <p class="mg-note" role="status" aria-live="polite">${esc(mcpNote)}</p>
    <p class="mg-mute mg-small">${esc(t("mc.foot"))}</p>`}</section>`;
}
async function mcpPlan(cli, connect) {
  mcpNote = "";
  try { mcpPrev = { cli, connect, plan: await C.api.mcp.plan(cli, connect, mcpAllow) }; }
  catch (e) { mcpPrev = null; mcpNote = String(e); }
  render();
}
async function mcpApply() {
  const pv = mcpPrev; if (!pv) return;
  try {
    const r = await C.api.mcp.apply(pv.cli, pv.connect, mcpAllow);
    mcpInfo = r.status ? { ...(mcpInfo || {}), ...r.status } : null;
    if (r.cancelled) mcpNote = t("mc.cancelled");
    else {
      const name = ((mcpInfo && mcpInfo.clis.find(x => x.id === pv.cli)) || {}).name || pv.cli;
      mcpNote = t(pv.connect ? "mc.done.connect" : "mc.done.disconnect", { name }) + (r.backups && r.backups.length ? " · " + t("mc.backup", { p: r.backups.join(", ") }) : "");
      // 작은 반응: 방금 연결한 줄의 배지가 한 번 톡 튄다 (움직임 줄이기 설정이면 CSS가 끈다)
      if (pv.connect) { mcpJust = pv.cli; setTimeout(() => { if (mcpJust === pv.cli) { mcpJust = ""; render(); } }, 1400); }
      mcpPrev = null;
    }
  } catch (e) { mcpNote = String(e); }
  render();
}

/* 앱: 모드 설치 (폴더·zip·끌어다 놓기 → 백엔드가 스테이징·검사 → 여기서 확인 → 설치) */
function confirmInstall(info) {
  return new Promise(res => {
    const c = document.createElement("dialog");
    c.className = "mg-dlg mg-confirm";
    const needs = info.needs || [];
    c.innerHTML = `<form method="dialog"><h2>${esc(t("m.install.ask", { name: info.name || info.id }))}</h2>
      <div class="mg-warn">⚠️ <b>${esc(t("m.notMine"))}</b><br>${esc(t("m.notMine.body"))}</div>
      <h3>${esc(t("m.perm"))}</h3>${permList(needs)}
      ${info.addedNeeds && info.addedNeeds.length && info.replaces ? `<p class="mg-err">${esc(t("m.install.added", { p: info.addedNeeds.join(", ") }))}</p>` : ""}
      <p class="mg-mute mg-small">${esc(info.id)} v${esc(info.version)}${info.author ? " · " + esc(t("m.by")) + " " + esc(info.author) : ""}${info.license ? " · " + esc(info.license) : ""}
        · ${esc(t("m.install.files", { n: info.files, kb: Math.max(1, Math.round(info.bytes / 1024)) }))}
        ${info.replaces ? " · " + esc(t("m.install.replaces", { v: info.replaces })) : ""}</p>
      ${info.description ? `<p class="mg-mute">${esc(info.description)}</p>` : ""}
      <div class="mg-actions"><button class="mg-btn" value="no">${esc(t("m.cancel"))}</button><button class="mg-btn mg-primary" value="yes">${esc(t("m.install.go"))}</button></div></form>`;
    c.addEventListener("keydown", e => e.stopPropagation());
    root().appendChild(c);
    c.addEventListener("close", () => { res(c.returnValue === "yes"); c.remove(); }, { once: true });
    c.showModal();
  });
}
async function installPath(path) {
  if (!APP || !path) return;
  let info;
  try { info = await C.api.modeAdmin.prepare(path); }
  catch (e) { note = t("m.install.fail", { e: String(e) }); tab = "modes"; render(); return; }
  if (!(await confirmInstall(info))) { C.api.modeAdmin.cancel(info.stage); return; }
  try {
    await C.api.modeAdmin.commit(info.stage);
    // 새 설치는 꺼진 상태. 권한이 늘어난 업데이트는 코어가 권한 서명을 비교해 다시 동의를 받는다
    await C.manage.rescan();
    note = t("m.install.done", { name: info.name || info.id });
  } catch (e) { note = t("m.install.fail", { e: String(e) }); }
  tab = "modes"; render();
}
function devTab() {
  const d = C._debug();
  const ext = document.querySelector(".core-xframe") ? d.mounts.find(m => m.errors != null) : null;
  return `<section class="mg-card"><h3>${esc(t("d.title"))}</h3><p>${esc(t(C.dev.on ? "d.on" : "d.off"))}</p></section>
    <section class="mg-card"><h3>${esc(t("d.debug"))}</h3><pre class="mg-pre">${esc(JSON.stringify(d, null, 1))}</pre>
    ${ext ? `<p>${esc(t("d.errors"))}: <b>${ext.errors}</b></p>` : ""}</section>`;
}

function render() {
  if (!dlg) return;
  const tabs = APP ? ["modes", "general", "hooks", "usage", "dev"] : ["modes", "general", "usage", "dev"];
  dlg.querySelector(".mg-tabs").innerHTML = tabs.map(k => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${esc(t("m.tab." + k))}</button>`).join("");
  dlg.querySelector(".mg-title").textContent = `⚙️ ${t("m.title")} · ${C.appName()}`;
  let back = dlg.querySelector(".mg-back");
  if (fromMini && !back) { back = document.createElement("p"); back.className = "mg-back mg-mute mg-small"; dlg.querySelector("header").after(back); }
  if (back) { back.hidden = !fromMini; back.textContent = t("m.backMini"); }
  dlg.querySelector(".mg-x").setAttribute("aria-label", t("m.close"));
  dlg.querySelector(".mg-body").innerHTML = tab === "modes" ? modesTab() : tab === "general" ? generalTab() : tab === "hooks" ? hooksTab() : tab === "usage" ? usageTab() : devTab();
}

function confirmEnable(info) {   // 외부 모드 켜기 전 확인: "직접 만들지 않은 모드" + 권한 문장
  return new Promise(res => {
    const c = document.createElement("dialog");
    c.className = "mg-dlg mg-confirm";
    c.innerHTML = `<form method="dialog"><h2>${esc(t("m.enableAsk", { name: info.name }))}</h2>
      <div class="mg-warn">⚠️ <b>${esc(t("m.notMine"))}</b><br>${esc(t("m.notMine.body"))}</div>
      <h3>${esc(t("m.perm"))}</h3>${permList(info.needs)}
      <p class="mg-mute mg-small">${esc(info.id)} v${esc(info.version)}${info.author && info.author.name ? " · " + esc(t("m.by")) + " " + esc(info.author.name) : ""}</p>
      <div class="mg-actions"><button class="mg-btn" value="no">${esc(t("m.cancel"))}</button><button class="mg-btn mg-primary" value="yes">${esc(t("m.enable"))}</button></div></form>`;
    root().appendChild(c);
    c.addEventListener("close", () => { res(c.returnValue === "yes"); c.remove(); }, { once: true });
    c.showModal();
  });
}
function showDelete(info) {
  const c = document.createElement("dialog");
  c.className = "mg-dlg mg-confirm";
  c.innerHTML = `<form method="dialog"><h2>${esc(t("m.delete"))}: ${esc(info.name)}</h2><p>${esc(t("m.delete.how"))}</p>
    <p><code>${esc((C.manage.userDir || "~/.claude/waiting-room/modes") + "/" + info.dir)}</code></p>
    <p class="mg-mute mg-small">🖥️ ${esc(t("m.delete.tauri"))}</p><div class="mg-actions"><button class="mg-btn mg-primary" value="ok">OK</button></div></form>`;
  root().appendChild(c);
  c.addEventListener("close", () => c.remove(), { once: true });
  c.showModal();
}

async function onClick(e) {
  const tb = e.target.closest("[data-tab]");
  if (tb) { tab = tb.dataset.tab; note = ""; if (tab === "hooks") { hookInfo = null; mcpInfo = null; mcpPrev = null; mcpNote = ""; } if (tab === "usage") usageInfo = null; render(); return; }
  if (e.target.closest(".mg-x")) { close(); return; }
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const id = b.closest("[data-id]") && b.closest("[data-id]").dataset.id;
  const info = id && C.manage.list().find(i => i.id === id);
  if (b.dataset.act === "up" || b.dataset.act === "down") C.manage.move(id, b.dataset.act === "up" ? -1 : 1);
  else if (b.dataset.act === "delete" && info && APP) {
    try { if (await C.api.modeAdmin.remove(info.dir)) { C.manage.forget(info.id); await C.manage.rescan(); note = t("m.deleted", { id: info.id }); } }
    catch (err) { note = String(err); }
  }
  else if (b.dataset.act === "delete" && info) showDelete(info);
  else if (b.dataset.act === "inst-folder" || b.dataset.act === "inst-zip") {
    let p = null;
    try { p = await C.api.modeAdmin.pick(b.dataset.act === "inst-zip" ? "zip" : "folder"); } catch (err) { note = String(err); }
    if (p) { await installPath(p); return; }
  }
  else if (b.dataset.act === "open-dir") C.api.modeAdmin.openDir().catch(err => { note = String(err); render(); });
  else if (b.dataset.act === "open-logs") { logNote = ""; C.api.openLogDir().catch(err => { logNote = String(err); render(); }); return; }
  else if (b.dataset.act === "open-licenses") { if (!C.api.openLicenses) return; logNote = ""; C.api.openLicenses().catch(err => { logNote = String(err); render(); }); return; }
  else if (b.dataset.act === "hooks-on" || b.dataset.act === "hooks-off") {
    try {
      const r = await (b.dataset.act === "hooks-on" ? C.api.hooks.install() : C.api.hooks.uninstall());
      hookInfo = r.status || null;
      note = r.cancelled ? t("h.cancelled") : r.backup ? t("h.backup", { p: r.backup }) : "";
    } catch (err) { note = String(err); hookInfo = null; }
  }
  else if (b.dataset.act === "mcp-plan") { await mcpPlan(b.dataset.cli, b.dataset.connect === "1"); return; }
  else if (b.dataset.act === "mcp-apply") { await mcpApply(); return; }
  else if (b.dataset.act === "mcp-cancel") { mcpPrev = null; mcpNote = ""; }
  else if (b.dataset.act === "keychain") {
    try { const r = await C.api.usage.keychain(); usageInfo = r.status; if (!r.ok) usageInfo = { ...usageInfo, err: r.err }; } catch (err) { usageInfo = { ...(usageInfo || {}), err: String(err) }; }
  }
  else if (b.dataset.act === "rescan") { await C.manage.rescan(); note = t("m.rescanned"); }
  else if (b.dataset.act === "update-now") { checkNow(); return; }
  else if (b.dataset.act === "update-open") { openUpdate(); return; }
  else if (b.dataset.act === "notif") await C.notif.request();
  else if (b.dataset.act === "nx-key-save") { const i = b.closest(".mg-card").querySelector('[data-act="nx-key"]'); await saveKey(i ? i.value : ""); return; }
  else if (b.dataset.act === "nx-key-reset") { await saveKey(NX_KEY); return; }
  else if (b.dataset.act === "nx-key-retry") { await retryKey(); return; }
  render();
}
async function onChange(e) {
  const el = e.target, act = el.dataset.act;
  if (act === "toggle") {
    const id = el.closest("[data-id]").dataset.id, info = C.manage.list().find(i => i.id === id);
    if (el.checked && info && !info.trusted && !(await confirmEnable(info))) { el.checked = false; return; }
    C.manage.setEnabled(id, el.checked);
  } else if (act === "lang") C.settings.setLang(el.value);
  else if (act === "quiet") C.settings.setQuiet(el.checked);
  else if (act === "nunchi") C.settings.setNunchi(el.checked);
  else if (act === "nx-long") await C.settings.set({ nunchiLong: el.value === "1" });
  else if (act === "nx-global") { await C.settings.set({ nunchiGlobal: el.checked }); nxInfo = null; setTimeout(() => render(), 400); }   // 백엔드가 등록 해제·재등록(작업 스레드) → 상태를 다시 읽음
  else if (act === "nx-theme") await C.settings.set({ nunchiTheme: ["light", "dark"].includes(el.value) ? el.value : "system" });
  else if (act === "nx-key") { nxDraft = el.value; return; }   // [저장]을 눌러야 바뀜(입력은 다시 그려도 남김)
  else if (act === "nk") await C.settings.set({ notify: { ...C.settings.app.notify, [el.dataset.k]: el.checked } });
  else if (act === "mcp-reports") { await C.settings.set({ mcpReports: el.checked }); mcpInfo = null; mcpPrev = null; }
  else if (act === "mcp-allow") { mcpAllow = el.checked; if (mcpPrev && mcpPrev.cli === "claude" && mcpPrev.connect) { await mcpPlan("claude", true); return; } }
  else if (act === "usage") { await C.settings.set({ usageLookup: el.checked }); usageInfo = null; }
  else if (act === "autostart") { try { await C.api.autostart(el.checked); C.settings.app.autostart = el.checked; } catch {} }
  else if (act === "terminal") await C.settings.set({ terminal: el.value });
  else if (act === "update-check") await C.settings.set({ updateCheck: el.checked });
  else if (act === "active-only") await C.settings.set({ activeOnly: el.checked });
  else if (act === "recent-min") await C.settings.set({ recentMinutes: Math.min(1440, Math.max(1, Math.round(+el.value) || 30)) });
  else if (act === "hide-builtin") await C.settings.set({ hideBuiltin: el.checked });
  else if (act === "hide-list") await C.settings.set({ hideProjects: [...new Set(el.value.split("\n").map(x => x.trim()).filter(Boolean))].slice(0, 100) });
  render();
}

let fromMini = false;   // 미니 보기에서 연 설정: 닫으면 미니 보기로 돌아감(그 사이 모드를 바꾸면 취소)
async function open(which, opts) {
  root(); await cssReady;
  if (opts && opts.fromMini) fromMini = true;
  if (which === "onboarding") return onboarding();
  if (which === "update") return openUpdate();
  if (which) tab = which;
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.className = "mg-dlg mg-main";
    dlg.setAttribute("aria-labelledby", "mg-title");
    dlg.innerHTML = `<header><h2 class="mg-title" id="mg-title"></h2><button class="mg-x" type="button">✕</button></header>
      <nav class="mg-tabs" role="tablist"></nav><div class="mg-body"></div>`;
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("change", onChange);
    dlg.addEventListener("keydown", e => e.stopPropagation());   // 설정 화면 안의 키는 모드 단축키로 가지 않음
    dlg.addEventListener("close", () => {
      offs.forEach(f => f()); offs = []; dlg.remove(); dlg = null;
      if (fromMini) { fromMini = false; if (C.api.returnMini) C.api.returnMini().catch(() => {}); }
    });
    root().appendChild(dlg);
    offs.push(C.on("modes", render), C.on("settings", render), C.on("mode", render), C.on("update", render),
      C.on("mode", () => { if (fromMini) { fromMini = false; if (C.api.clearReturnMini) C.api.clearReturnMini().catch(() => {}); render(); } }));   // 다른 동작 → 복귀 취소
    dlg.showModal();
  }
  render();
}
function close() { if (dlg) dlg.close(); }

// 첫 실행 온보딩: ① 사용 한도 직접 조회 동의(기본 꺼짐, 동의 저장만) → ② Claude Code 훅 켜기(앱에서만)
// ②는 한 번만 묻는다(store `onb:hooks`). 이미 온보딩을 마친 기존 사용자도 훅이 없으면 한 번 묻고, 이미 켰으면 조용히 넘어간다
async function onboarding() {
  const fresh = !C.store.get("onboarded");
  if (fresh) await usageStep();
  if (APP && !C.store.get("onb:hooks")) await hooksStep(fresh);
}
function usageStep() {
  return new Promise(res => {
    const c = document.createElement("dialog");
    c.className = "mg-dlg mg-confirm mg-onb";
    c.innerHTML = `<form method="dialog"><h2>${esc(t("o.title", { app: C.appName() }))}</h2><p>${esc(t("o.body"))}</p>
      <p class="mg-mute mg-small">${esc(t("u.what"))}</p>
      <div class="mg-actions"><button class="mg-btn" value="no">${esc(t("o.no"))}</button><button class="mg-btn mg-primary" value="yes">${esc(t("o.yes"))}</button></div></form>`;
    c.addEventListener("keydown", e => e.stopPropagation());
    root().appendChild(c);
    c.addEventListener("close", () => {
      C.store.set("onboarded", "1");
      C.settings.set({ usageLookup: c.returnValue === "yes" });
      c.remove(); res();
    }, { once: true });
    c.showModal();
  });
}
// ② 훅: 온보딩 버튼을 누른 것 자체가 동의 → 확인 창 없이 바로 설치(백업·원자적 쓰기는 설정 화면과 같음). 바뀌는 내용은 접힌 "자세히 보기"
async function hooksStep(fresh) {
  let h; try { h = await C.api.hooks.status(); } catch { return; }
  const s = h.status || {};
  if (s.installed) { C.store.set("onb:hooks", "1"); return; }   // 이미 켬(일부·옛 위치면 설정 → AI 연결이 고치라고 안내)
  if (!h.claudeDir && !fresh) return;                            // 기존 사용자 + Claude Code 없음: 나중에 생기면 그때 한 번
  return new Promise(res => {
    const c = document.createElement("dialog");
    c.className = "mg-dlg mg-confirm mg-onb mg-onb-hooks";
    const pv = (h.preview || []).slice(0, 12);
    const details = `<details class="mg-onb-more"><summary>${esc(t("o.h.more"))}</summary>
      <p class="mg-small">${esc(t("o.h.files", { settings: h.settingsPath || "", bin: h.binPath || "" }))}</p>
      ${pv.length ? `<pre class="mg-pre mg-diff">${pv.map(diffLine).join("\n")}</pre>` : ""}</details>`;
    c.innerHTML = !h.claudeDir
      ? `<form method="dialog"><p class="mg-step">${esc(t("o.step", { n: 2, of: 2 }))}</p><h2>${esc(t("o.h.title"))}</h2>
        <p>${esc(t("o.h.noclaude"))}</p>
        <div class="mg-actions"><button class="mg-btn mg-primary" value="ok">${esc(t("o.h.ok"))}</button></div></form>`
      : `<form method="dialog"><p class="mg-step">${esc(fresh ? t("o.step", { n: 2, of: 2 }) : t("o.h.new"))}</p><h2>${esc(t("o.h.title"))}</h2>
        <p>${esc(t("o.h.body"))}</p>${details}
        ${h.sidecar === false ? `<p class="mg-err">${esc(t("h.nosidecar"))}</p>` : ""}
        <p class="mg-note" role="status"></p>
        <div class="mg-actions"><button class="mg-btn" value="later">${esc(t("o.no"))}</button>
          <button class="mg-btn mg-primary" type="button" data-act="onb-hooks" ${h.sidecar === false ? "disabled" : ""}>${esc(t("o.h.on"))}</button></div></form>`;
    c.addEventListener("keydown", e => e.stopPropagation());
    c.addEventListener("click", async e => {
      const b = e.target.closest('[data-act="onb-hooks"]');
      if (!b || b.disabled) return;
      const msg = c.querySelector(".mg-note");
      b.disabled = true; b.textContent = t("o.h.busy"); msg.className = "mg-note"; msg.textContent = "";
      try {
        const r = await C.api.hooks.install(true);
        if (r && r.cancelled) {   // 1회 생략을 이미 쓴 뒤라 확인 창이 떴고 거기서 취소 → 켜지 않았으니 성공으로 보이지 않게
          b.disabled = false; b.textContent = t("o.h.on"); msg.textContent = t("h.cancelled");
          return;
        }
        c.querySelector(".mg-actions").innerHTML = `<button class="mg-btn mg-primary" value="done">${esc(t("o.h.done"))}</button>`;
        msg.className = "mg-note mg-onb-ok";
        msg.innerHTML = `<span class="mg-pop" aria-hidden="true">✓</span> ${esc(t("o.h.ok.line"))}`;
        hookInfo = r && r.status || null;
      } catch (err) {
        b.disabled = false; b.textContent = t("o.h.on");
        msg.className = "mg-note mg-err"; msg.textContent = String(err);
      }
    });
    root().appendChild(c);
    c.addEventListener("close", () => { C.store.set("onb:hooks", "1"); c.remove(); res(); }, { once: true });
    c.showModal();
  });
}

window.CoreManager = { open, close, installPath, openUpdate, get isOpen() { return !!dlg; } };
})();

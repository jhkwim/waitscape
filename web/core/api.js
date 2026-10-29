/* Core.api — 백엔드와 통신하는 유일한 계층 (ARCHITECTURE.md §3.1)
   코어와 모드는 fetch를 직접 부르지 않고 이 객체만 쓴다. 구현체는 런타임에 고른다:
   · http  : Python 서버(server.py) / 앞으로 wr-server. /state 1초 폴링, /trace, /modes, /brand.json, /daylog(퇴근 일보)
   · tauri : 데스크톱 앱(app/src-tauri). invoke("get_state") + listen("state") push, 설정·훅·모드 설치·위젯·터미널·업데이트
             빌드 플레이버(updater·terminal-jump)는 appInfo().features로 알고, 꺼진 기능은 코어가 숨긴다
   반환 모양은 types/ctx.d.ts의 CoreApi. */
(() => {
"use strict";

const json = async (url, opts) => { const r = await fetch(url, { cache: "no-store", ...opts }); return r.json(); };

const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = {
  usageLookup: false, notify: { done: true, input: true, stall: true, memo: true },
  // 세션 숨김: 숨길 프로젝트 패턴 + 알려진 플러그인 내부 세션 기본 숨김 + 기본은 활성 세션만(끝난 지 recentMinutes분 이내까지)
  hideProjects: [], hideBuiltin: true, activeOnly: true, recentMinutes: 30,
  // 🙈 눈치 모드: 켜짐·연출 길이(짧게 기본). 브라우저는 단축키 없이 B 키만
  nunchi: false, nunchiLong: false, nunchiTheme: "system", nunchiGlobal: true,
};
const local = {  // http 환경: 백엔드가 설정을 저장하지 않으므로 이 브라우저의 localStorage에 둔다(백엔드는 읽지 않음)
  get() { try { const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); return { ...DEFAULT_SETTINGS, ...v, notify: { ...DEFAULT_SETTINGS.notify, ...(v.notify || {}) } }; } catch { return { ...DEFAULT_SETTINGS }; } },
  set(patch) { const v = { ...local.get(), ...patch }; try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)); } catch {} return v; },
};

function httpApi() {
  return {
    kind: "http",
    subscribe(onState, { interval = 1000 } = {}) {
      let busy = false, stopped = false;
      const tick = async () => {
        if (busy || stopped) return;
        busy = true;
        try { const s = await json("/state"); if (!stopped) onState(s); } catch {}
        busy = false;
      };
      tick();
      const t = setInterval(tick, interval);
      return () => { stopped = true; clearInterval(t); };
    },
    trace(q, signal) {
      const p = new URLSearchParams({ session: q.session || "", prompt: String(q.prompt ?? "last"), since: q.since || "" });
      return json("/trace?" + p, { signal });
    },
    // 퇴근 일보 하루 집계 (types/daylog.d.ts). day = "today" | "yesterday" | "YYYY-MM-DD"
    daylog: (day = "today") => json("/daylog?" + new URLSearchParams({ day })),
    // 그날 일보를 봤다고 기록. JSON 본문이라 다른 사이트의 폼으로는 보낼 수 없다(서버가 Origin도 확인)
    daylogSeen: day => json("/daylog/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day }) }),
    settings: { get: async () => local.get(), set: async patch => { local.set(patch); } },
    notify(title, body) {
      if ("Notification" in window && Notification.permission === "granted") { try { new Notification(title, { body }); } catch {} }
    },
    // 발견된 모드 목록(검증 전 원본). { modes: [{ dir, source, manifest?, error? }], userDir, devDirs }
    modes: () => json("/modes"),
    brand: () => json("/brand.json"),
    // 모드 파일 위치: 내장은 메인 문서에서 직접 불러옴, 외부는 샌드박스 iframe 주소
    modeBase: info => info.trusted ? `modes/${info.dir}/` : `/_modes/${info.dir}/`,
    frameUrl: info => `/_modes/${info.dir}/index.html`,
  };
}

// 데스크톱 앱(Tauri 2). @tauri-apps/api를 쓰지 않고 내부 객체로 판별(ARCHITECTURE §3.1). Rust 명령: app/src-tauri/src/commands.rs
// 창마다 Core가 따로 돈다(main / widget). 백엔드가 파일 감시 + 2초 tick으로 state를 push하고, done/input/stall OS 알림도 직접 보낸다.
function tauriApi(T) {
  const invoke = (cmd, args) => T.invoke(cmd, args);
  const listen = (event, fn) => {  // plugin:event|listen — Tauri 2 내부 규약 (core:event:allow-listen)
    const handler = T.transformCallback(e => fn(e.payload));
    const p = invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler });
    return () => p.then(id => invoke("plugin:event|unlisten", { event, eventId: id })).catch(() => {});
  };
  const label = (T.metadata && T.metadata.currentWindow && T.metadata.currentWindow.label) || "main";
  const origin = /Windows/.test(navigator.userAgent) ? "http://wrmode.localhost" : "wrmode://localhost";  // 외부 모드 스킴
  return {
    kind: "tauri",
    window: label,
    isWidget: label === "widget",
    backendNotifies: true,   // done/input/stall OS 알림은 백엔드가 보냄 → 코어는 보내지 않는다(중복 방지)
    subscribe(onState) {
      invoke("get_state").then(onState, () => {});
      return listen("state", onState);
    },
    trace: (q, signal) => invoke("get_trace", { q }).then(r => { if (signal && signal.aborted) throw new DOMException("aborted", "AbortError"); return r; }),
    daylog: (day = "today") => invoke("get_daylog", { day }),
    daylogSeen: day => invoke("daylog_seen", { day }),
    // 퇴근 일보 카드 PNG 저장: 저장 대화상자(tauri-plugin-dialog) → 고른 경로에 씀. 취소면 null. 메인 창만. http에는 없음(브라우저 다운로드)
    saveImage: (name, bytes) => invoke("save_image", { name, data: Array.from(bytes) }),
    settings: { get: () => invoke("get_settings"), set: patch => invoke("set_settings", { patch }) },
    notify: (title, body) => { invoke("notify", { title, body }).catch(() => {}); },
    openTerminal: sid => invoke("open_terminal", { sid }),
    openWidget: modeId => invoke("open_widget", { modeId }),
    closeWidget: () => invoke("close_widget"),
    resizeWidget: (width, height) => invoke("widget_resize", { width, height }).catch(() => {}),
    startDrag: () => invoke("plugin:window|start_dragging", { label }).catch(() => {}),
    modes: () => invoke("list_modes"),
    brand: () => invoke("get_brand"),
    modeBase: info => info.trusted ? `modes/${info.dir}/` : `${origin}/_modes/${info.dir}/`,
    frameUrl: info => `${origin}/_modes/${info.dir}/index.html`,
    on: listen,   // 백엔드 이벤트: settings, set-mode, open-settings, nav-blocked, widget, tauri://drag-drop
    setTrayModes: (modes, current) => invoke("set_tray_modes", { modes, current }).catch(() => {}),
    // install(true) = 첫 실행 온보딩 버튼(그 버튼이 동의 → 백엔드 확인 창 생략). 설정 화면은 install() → 확인 창
    hooks: { status: () => invoke("hooks_status"), install: onboarding => invoke("hooks_install", onboarding ? { onboarding: true } : {}), uninstall: () => invoke("hooks_uninstall") },
    // MCP 보고 연결: 미리보기(plan)는 읽기만, 적용(apply)은 백엔드가 네이티브 확인 창을 한 번 더 띄운 뒤 쓴다. 메인 창만
    mcp: {
      status: () => invoke("mcp_status"),
      plan: (cli, connect, autoAllow) => invoke("mcp_plan", { cli, connect, autoAllow }),
      apply: (cli, connect, autoAllow) => invoke("mcp_apply", { cli, connect, autoAllow }),
    },
    usage: { status: () => invoke("usage_status"), keychain: () => invoke("usage_keychain") },
    modeAdmin: {
      pick: kind => invoke("pick_mode_source", { kind }),
      prepare: path => invoke("prepare_mode_install", { path }),
      commit: stage => invoke("commit_mode_install", { stage }),
      cancel: stage => invoke("cancel_mode_install", { stage }).catch(() => {}),
      remove: id => invoke("delete_mode", { id }),
      openDir: () => invoke("open_modes_dir"),
    },
    autostart: on => invoke("autostart_set", { on }),
    // 앱 로그 폴더(waitscape.log) 열기 — 문제 신고용. 메인 창만
    openLogDir: () => invoke("open_log_dir"),
    openLicenses: () => invoke("open_licenses"),
    // { version, features: { updater, terminalJump }, updateReady } — 메인 창만 (capabilities/main.json)
    appInfo: () => invoke("app_info"),
    // 🙈 눈치 모드 전역 단축키 등록 상태 { key, ok, err } — 다른 앱이 선점하면 err. 메인 창만
    nunchiStatus: () => invoke("nunchi_status"),
    nunchiRetry: () => invoke("nunchi_retry"),
    // 창 우클릭 메뉴(네이티브) · 메뉴와 같은 동작(위젯 ⚙ = 큰 화면 + 설정). 메인·위젯 창
    contextMenu: (sid, title) => invoke("context_menu", { sid: sid || null, title: title || null }),
    menuAction: id => invoke("menu_action", { id }),
    widgetAck: () => invoke("widget_ack"),
    // 미니 보기에서 연 설정: 닫으면 미니 보기로(돌아갈 게 없으면 아무것도 안 함) · 다른 화면 동작을 했으면 복귀 취소. 메인 창만
    returnMini: () => invoke("return_mini"),
    clearReturnMini: () => invoke("clear_return_mini"),   // 숨겨 둔 위젯이 다시 보였을 때 "살아 있음"(2초 안에 없으면 백엔드가 위젯을 새로 만듦)   // 키가 같아도 다시 등록(실패 안내의 [다시 시도])
    // 앱 안 업데이트: 이벤트 update(상태)·update-progress·update-show(트레이). 설치는 사용자가 눌렀을 때만
    update: { status: () => invoke("update_status"), check: () => invoke("update_check"), install: () => invoke("update_install") },
  };
}

window.CoreApi = {
  create() { const T = window.__TAURI_INTERNALS__; return T && typeof T.invoke === "function" ? tauriApi(T) : httpApi(); },
  DEFAULT_SETTINGS,
};
})();

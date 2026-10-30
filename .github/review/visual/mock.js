/* 화면 검수(visual_review.sh)용 가짜 Tauri 백엔드 — 세션·한도·퇴근 일보 모두 **가짜 데이터**(실제 기기·계정 정보 없음). capture.js가 index.html <head>에 끼운다.
   쿼리: ?mode=studio(모드) · ?five=70(5시간 한도 %, none=한도 없음, 100=정전) · ?rs=2.6(리셋까지 시간) · ?wk=20(주간 %) · ?lang=en
   ?old=1(세션 시작 70분 앞당김, ?old=N → N분) · ?noask=1(질문 없이 모두 작업) · ?ask2=1(질문 두 명) · ?stall=1(로봇 멈춤 의심)
   ?tools=N(도구 수 N부터 1초에 1씩) · ?turn=1(30초마다 새 턴) · ?daylog=1(퇴근 일보 fixture) · ?role=widget(미니 보기 창) */
(() => {
  const q = new URLSearchParams(location.search);
  const ROLE = q.get("role") === "widget" ? "widget" : "main";
  const T0 = Date.now() / 1000;
  function mkState(now) {
    const S = [];
    const OLD = q.has("old") ? (+q.get("old") > 1 ? +q.get("old") : 70) * 60 : 0;   // ?old=1 → 70분 더 일찍 시작(?old=N → N분)
    /* ?turn=1: 일하는 세션은 30초마다 새 턴(started = 이번 턴 시작 · tools = 40부터 1초에 3씩, 턴이 바뀌면 다시 40). 첫 턴은 원래 started(?old 반영) */
    const TURN = (st, t) => { if (!q.has("turn") || (st !== "working" && st !== "needs_input")) return {}; const el = t - T0, k = Math.floor(el / 30), ph = el % 30; return Object.assign({ tools: 40 + Math.floor(ph * 3) }, k > 0 ? { started: t - ph, _turnK: k } : {}); };
    const add = (sid, project, provider, status, extra) => S.push((o => (OLD && !o._turnK && (o.started -= OLD), o))(Object.assign({ sid, project, provider, status, since: now - 60, started: now - 600, run: 0, agents: [], activity: [], kinds: { edit: 4, read: 3, bash: 2 }, tools: 12, todos: [], trail: [], cwd: "/x/" + project }, extra, q.has("tools") ? { tools: +q.get("tools") + Math.floor(now - T0) } : {}, TURN(status, now))));
    add("8bbce2", "landing", "claude", q.has("noask") ? "working" : "needs_input", { note: "배포 전에 DB 마이그레이션 실행해도 될까요?", since: T0 - 48, started: T0 - 900, ctx: 31 });
    add("1d18e2", "waitscape", "claude", "working", { started: T0 - 1520, since: T0 - 1520, ctx: 87, activity: [{ icon: "✏️", text: "web/modes/studio/mode.js 수정", ts: now - 3 }] });
    add("4ddee2", "api-server", "codex", "working", { started: T0 - 760, since: T0 - 760, ctx: 54, activity: [{ icon: "⚡", text: "cargo test --workspace", ts: now - 2 }] });
    add("1000e2", "docs", "gemini", "done", { started: T0 - 562, since: T0 - 150, run: 412 });
    if (q.has("ask2")) Object.assign(S.find(x => x.sid === "4ddee2"), { status: "needs_input", since: T0 - 30, note: "테스트 먼저 돌려도 될까요?" });   // ?ask2=1: 질문 두 명(뒷사람은 자기 층에서 순서 대기)
    if (q.has("stall")) S.find(x => x.sid === "4ddee2").health = { level: "stall", secs: 420, tool: "Bash" };   // ?stall=1: 로봇(api-server)이 멈춤 의심
    const five = q.get("five");
    const rs = +(q.get("rs") || 2.6) * 3600;
    return { now, sessions: S, done_today: 3, today_agents: 2, hooks: { installed: true, last_event_age: 3 },
      limits: five === "none" ? {} : { five_hour: { used_percentage: +(five || 70), resets_at: T0 + rs }, seven_day: { used_percentage: +(q.get("wk") || 20), resets_at: T0 + 4.2 * 86400 } },
      limits_src: "statusline", limits_ts: now - 10, poll: { on: false, err: null },
      providers: [{ id: "claude", name: "Claude", capabilities: { subagents: true, limits: true, todos: true, tokens: true } }, { id: "codex", name: "Codex", capabilities: {} }, { id: "gemini", name: "Gemini", capabilities: {} }] };
  }
  const DAYLOG = {"big": [{"job": "큰 리팩터링", "project": "bigrepo", "provider": "claude", "run": 2900, "sid": "fx-big", "t": 1792519100}, {"job": "API 구조 조사해줘", "project": "api-server", "provider": "claude", "run": 890, "sid": "fx-party", "t": 1792519190}, {"by_ai": true, "job": "환불 로직 분리", "project": "shop-api", "provider": "codex", "run": 770, "sid": "codex-4821-1792518300000-0a1b2c3d", "t": 1792519080}, {"job": "어제 하던 것", "project": "yesterday", "provider": "claude", "run": 600, "sid": "fx-yday", "t": 1792505400}, {"by_ai": true, "job": "로그인 버그 고쳐줘", "project": "report-cheer", "provider": "claude", "run": 360, "sid": "fx-mcp-cheer", "t": 1792518860}], "big_count": 5, "cheers": [{"provider": "claude", "sid": "fx-mcp-cheer", "t": 1792518860, "text": "세션 만료까지 깔끔히 정리했어요"}, {"provider": "codex", "sid": "codex-4821-1792518300000-0a1b2c3d", "t": 1792519080, "text": "환불 버그까지 잡았어요"}], "day": "2026-10-20", "done": 12, "end": 1792522800.0, "first": 1792504800, "last": 1792519195, "last_call": {"project": "login-app", "provider": "claude", "sid": "fx-read", "t": 1792519195}, "limits": {"peak": 63.0, "resets": [], "samples": [{"five_hour": 63.0, "five_hour_resets": 1792530600.0, "seven_day": 27.0, "seven_day_resets": 1792929600.0, "t": 1792519200}], "weekly": {"from": 27.0, "to": 27.0}}, "mvp": {"done": 2, "project": "shop-api", "provider": "claude", "sid": "fx-flow", "work": 110}, "now": 1792519260, "outage_count": 0, "outages": [], "prev": {"day": "2026-10-19", "done": 0, "ready": false, "ready_at": null, "seen": null, "unseen": false}, "quiet": 65, "ready": false, "ready_at": null, "reason": null, "rule": {"after_hour": 12, "big_min": 10, "day_hour": 4, "keep_days": 14, "quiet_min": 45}, "seen": null, "start": 1792436400.0, "today": true, "unseen": false, "v": 1, "wait": {"avg": 51.5, "n": 2}, "work": 5980, "workers": [{"done": 2, "project": "shop-api", "provider": "claude", "sid": "fx-flow", "work": 110}, {"done": 1, "project": "bigrepo", "provider": "claude", "sid": "fx-big", "work": 2900}, {"done": 1, "project": "api-server", "provider": "claude", "sid": "fx-party", "work": 890}, {"done": 1, "project": "shop-api", "provider": "codex", "sid": "codex-4821-1792518300000-0a1b2c3d", "work": 770}, {"done": 1, "project": "yesterday", "provider": "claude", "sid": "fx-yday", "work": 600}, {"done": 1, "project": "report-cheer", "provider": "claude", "sid": "fx-mcp-cheer", "work": 360}, {"done": 1, "project": "notes", "provider": "claude", "sid": "fx-idle", "work": 200}, {"done": 1, "project": "blog", "provider": "claude", "sid": "fx-done", "work": 70}, {"done": 1, "project": "cmux-app", "provider": "claude", "sid": "fx-cmux", "work": 50}, {"done": 1, "project": "ghosts", "provider": "claude", "sid": "fx-stale", "work": 20}, {"done": 1, "project": "cmd", "provider": "claude", "sid": "fx-cmd", "work": 10}]};
  const cbs = {}; let nid = 1; const L = {};
  const lang = q.get("lang") || "ko";
  const settings = { usageLookup: false, notify: { done: true, input: true, stall: true, memo: true }, quiet: false, langPref: lang, lang, autostart: false,
    terminal: "auto", modes: {}, widget: false, hideProjects: [], hideBuiltin: true, activeOnly: true, recentMinutes: 30, updateCheck: false, nunchi: false, nunchiKey: "Control+KeyQ", nunchiLong: false, nunchiTheme: "system", nunchiGlobal: true };
  const fire = (event, payload) => (L[event] || []).forEach(h => cbs[h] && cbs[h]({ event, payload }));
  setInterval(() => fire("state", mkState(Date.now() / 1000)), 1000);
  async function listModes() {
    const idx = await (await fetch("modes/index.json")).json(), modes = [];
    for (const d of idx.builtin) modes.push({ dir: d, source: "builtin", manifest: await (await fetch(`modes/${d}/mode.json`)).json() });
    return { modes, userDir: "~/modes", devDirs: [] };
  }
  const H = {
    get_state: () => mkState(Date.now() / 1000),
    get_settings: () => settings, set_settings: ({ patch }) => { Object.assign(settings, patch); return { ...settings }; },
    get_brand: () => ({ name: "Waitscape", identifier: "io.github.jhkwim.waitscape" }), list_modes: listModes,
    app_info: () => ({ version: "0.4.2", features: { updater: false, terminalJump: true }, updateReady: false }),
    nunchi_status: () => ({ key: settings.nunchiKey, ok: true, err: null }),
    update_status: () => ({ compiled: false }), notify: () => null, set_tray_modes: () => null, usage_status: () => ({}), hooks_status: () => ({ state: "on" }),
    open_terminal: () => ({ result: "opened" }), open_widget: () => null, close_widget: () => null, widget_resize: () => null,
    get_daylog: () => { if (!q.has("daylog")) return { error: "off" };   // ?daylog=1: 저장소 fixtures/expected/daylog.today.json 본문을 오늘 날짜로(📋 퇴근 일보 연출 시험)
      const n = Date.now() / 1000, d = new Date((n - 4 * 3600) * 1000), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4).getTime() / 1000;
      return Object.assign(JSON.parse(JSON.stringify(DAYLOG)), { day, today: true, start: st, end: st + 86400, now: n, prev: null }); }, daylog_seen: () => null, mcp_status: () => ({}),
    context_menu: () => null, menu_action: () => null, return_mini: () => true, clear_return_mini: () => null,
    "plugin:event|listen": ({ event, handler }) => { (L[event] ||= []).push(handler); return nid++; },
    "plugin:event|unlisten": () => null, "plugin:window|start_dragging": () => null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: ROLE } },
    transformCallback: fn => { const id = nid++; cbs[id] = fn; return id; },
    invoke: async (cmd, args) => { if (cmd in H) return H[cmd](args || {}); console.warn("[mock] 모르는 명령", cmd); return null; },
  };
  try { localStorage.setItem("onboarded", "1"); localStorage.setItem("onb:hooks", "1"); localStorage.setItem("mode", q.get("mode") || "studio"); } catch {}
})();

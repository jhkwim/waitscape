#!/usr/bin/env node
/* 화면 검수용 고정 스크린샷 매트릭스 — 메인테이너 전용 선택 도구(visual_review.sh가 부른다). 가짜 백엔드(mock.js)만 쓴다.
 *
 * 사용:
 *   node capture.js shoot --web <web폴더> --out <출력폴더> [--matrix full|quick] [--modes studio|all] [--extra '이름=쿼리[|click=선택자]...' ...]
 *   node capture.js diff <base출력폴더> <head출력폴더>     # 같은 이름끼리 픽셀 비교 → <head>/diff.json
 *
 * 환경변수:
 *   WR_PLAYWRIGHT  playwright-core(또는 playwright) 모듈 경로. 저장소에 의존성을 넣지 않는다 — 예: 임시 폴더에서 `npm i playwright-core` 뒤 그 node_modules/playwright-core
 *   WR_CHROME      Chrome 실행 파일 (기본: macOS /Applications/Google Chrome.app/…, 그 밖은 playwright의 chrome 채널)
 *   WR_VIS_TIME    고정 시각(ISO, 예 2026-10-30T14:00:00). 기본: 오늘 14:00(현지) — Date만 고정, 애니메이션 시계(performance.now)는 그대로 흐른다
 *   WR_VIS_WAIT    로드 뒤 기다릴 ms (기본 3500) · WR_VIS_JOBS 동시 캡처 수 (기본 3) · WR_VIS_DSF 배율 (기본 1)
 *
 * 결정성: 날짜·시각·데이터·창 크기·대기 시간은 고정. 직원 걷기·깜빡임 같은 애니메이션 위치는 찍을 때마다 조금 다르다(움직임 줄이기 켠 장면은 대부분 정지).
 * 안전: 정적 서버는 127.0.0.1의 빈 포트에만 열고, 페이지의 외부 요청(127.0.0.1 밖)은 모두 막는다(PR 코드가 밖으로 통신하지 못하게).
 */
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };

function loadPlaywright() {
  const tries = [process.env.WR_PLAYWRIGHT, "playwright-core", "playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch {} }
  console.error("capture: playwright-core를 찾지 못함. WR_PLAYWRIGHT=<…/node_modules/playwright-core> 를 지정하세요 (임시 폴더에서 `npm i playwright-core`).");
  process.exit(2);
}
function chromeOpts() {
  if (process.env.WR_CHROME) return { executablePath: process.env.WR_CHROME };
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return process.platform === "darwin" && fs.existsSync(mac) ? { executablePath: mac } : { channel: "chrome" };
}

/* web 폴더 정적 서버 + index.html/widget.html <head>에 mock.js 주입. 127.0.0.1, 빈 포트 */
function serve(web) {
  const root = path.resolve(web), mock = fs.readFileSync(path.join(__dirname, "mock.js"));
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/__mock.js") { res.writeHead(200, { "Content-Type": MIME[".js"] }); return res.end(mock); }
    if (p === "/") p = "/index.html";
    const f = path.resolve(root, "." + p);
    if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, b) => {
      if (err) { res.writeHead(404); return res.end(); }
      if (p === "/index.html" || p === "/widget.html") b = Buffer.from(b.toString("utf8").replace("<head>", '<head>\n<script src="/__mock.js"></script>'));
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" }); res.end(b);
    });
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ srv, port: srv.address().port })));
}

/* 고정 매트릭스. state: 이름 → { q: 쿼리, act: 로드 뒤 동작 } */
const STATES = {
  normal: { q: "noask=1&five=40", note: "모두 작업 중, 한도 40%" },
  needs_input: { q: "ask2=1&five=70", note: "질문 두 명(대기 줄), 한도 70%" },
  blackout: { q: "noask=1&five=100", note: "정전(5시간 한도 100%)" },
  nunchi: { q: "noask=1&five=40", act: "nunchi", note: "눈치 모드 켬(B 키, 블라인드 내려온 뒤)" },
};
function matrix(kind, modes, extras) {
  const out = [], add = (mode, state, scheme, rm, lang, w, q = STATES[state].q, act = STATES[state].act, note = STATES[state].note) =>
    out.push({ name: [mode, state, scheme, lang, w].join("-") + (rm ? "-rm" : ""), mode, state, scheme, rm, lang, viewport: { width: w, height: 820 }, query: `mode=${mode}&${q}${lang === "en" ? "&lang=en" : ""}`, act: act || null, note });
  const S = ["light", "dark"];
  if (kind === "quick") {
    for (const sc of S) { add("studio", "normal", sc, false, "ko", 1280); add("studio", "blackout", sc, false, "ko", 1280); }
    add("studio", "needs_input", "light", false, "ko", 1280); add("studio", "nunchi", "light", false, "ko", 1280);
  } else {
    for (const sc of S) for (const rm of [false, true]) for (const lang of ["ko", "en"]) for (const w of [1280, 980]) add("studio", "normal", sc, rm, lang, w);
    for (const st of ["needs_input", "blackout", "nunchi"]) for (const sc of S) add("studio", st, sc, false, "ko", 1280);
    add("studio", "blackout", "dark", true, "ko", 1280);
  }
  if (modes === "all") for (const m of ["hamster", "work", "pocket", "board", "orbit", "flow"]) for (const sc of S) add(m, "normal", sc, false, "ko", 1280);
  for (const e of extras) {   // --extra '이름=쿼리[|click=CSS선택자]...' → studio, light·dark, ko, 1280. click은 차례로 누름(0.4초 간격)
    const [head, ...acts] = e.split("|"), i = head.indexOf("=");
    if (i < 1 || acts.some(a => !a.startsWith("click="))) { console.error("capture: --extra는 '이름=쿼리[|click=선택자]...'"); process.exit(2); }
    const nm = head.slice(0, i).replace(/[^a-z0-9_]/gi, "_"), q = head.slice(i + 1), clicks = acts.map(a => a.slice(6));
    for (const sc of S) add("studio", "x_" + nm, sc, false, "ko", 1280, q, clicks.length ? { clicks } : null, "추가 장면: " + q + (clicks.length ? " · 누름: " + clicks.join(" → ") : ""));
  }
  return out;
}

function fixedTime() {
  if (process.env.WR_VIS_TIME) { const t = new Date(process.env.WR_VIS_TIME); if (!isNaN(t)) return t; console.error("capture: WR_VIS_TIME 형식 오류"); process.exit(2); }
  const d = new Date(); d.setHours(14, 0, 0, 0); return d;
}

async function shoot(args) {
  const web = args.web, out = args.out;
  if (!web || !out || !fs.existsSync(path.join(web, "index.html"))) { console.error("capture: --web <index.html이 있는 폴더> --out <폴더> 필요"); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const shots = matrix(args.matrix || "full", args.modes || "studio", args.extra || []);
  const { chromium } = loadPlaywright(), { srv, port } = await serve(web);
  const T = fixedTime(), WAIT = +(process.env.WR_VIS_WAIT || 3500), JOBS = Math.max(1, +(process.env.WR_VIS_JOBS || 3)), DSF = +(process.env.WR_VIS_DSF || 1);
  const browser = await chromium.launch(Object.assign({ headless: true }, chromeOpts()));
  const index = { web: path.resolve(web), time: T.toISOString(), wait_ms: WAIT, dsf: DSF, shots: [] };
  let next = 0;
  async function one(s) {
    const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: DSF, locale: s.lang === "en" ? "en-US" : "ko-KR", timezoneId: "Asia/Seoul",
      colorScheme: s.scheme, reducedMotion: s.rm ? "reduce" : "no-preference" });
    await ctx.route("**/*", r => { const u = new URL(r.request().url()); return (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") ? r.continue() : r.abort(); });
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", e => errs.push("pageerror: " + e.message)); p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 300)); });
    await p.clock.setFixedTime(T);
    try {
      await p.goto(`http://127.0.0.1:${port}/?${s.query}`, { waitUntil: "load" }); await p.waitForTimeout(WAIT);
      if (s.act === "nunchi") { await p.keyboard.press("b"); await p.waitForTimeout(3000); }
      else if (s.act && s.act.clicks) for (const sel of s.act.clicks) { await p.click(sel, { timeout: 3000 }); await p.waitForTimeout(400); }
      if (s.act && s.act.clicks) await p.waitForTimeout(600);
      await p.mouse.move(1, 1);   // 호버 상태가 남지 않게
      await p.screenshot({ path: path.join(out, s.name + ".png") });
    } catch (e) { errs.push("capture: " + e.message.split("\n")[0]); }
    await ctx.close();
    const { act, ...rec } = s;
    index.shots.push(Object.assign(rec, { file: s.name + ".png", action: act, errors: errs }));
    console.log(`  ${s.name}${errs.length ? "  ⚠ " + errs.length + " errors" : ""}`);
  }
  await Promise.all(Array.from({ length: JOBS }, async () => { while (next < shots.length) await one(shots[next++]); }));
  await browser.close(); srv.close();
  index.shots.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2));
  console.log(`capture: ${index.shots.length}장 → ${out}`);
}

/* 같은 이름 PNG끼리 비교: 바뀐 픽셀 비율과 바뀐 영역 상자(x,y,w,h). 브라우저 캔버스로 디코드(추가 의존성 없음) */
async function diff(baseDir, headDir) {
  const { chromium } = loadPlaywright(), browser = await chromium.launch(Object.assign({ headless: true }, chromeOpts()));
  const p = await browser.newPage(), res = {};
  const head = JSON.parse(fs.readFileSync(path.join(headDir, "index.json"), "utf8"));
  for (const s of head.shots) {
    const a = path.join(baseDir, s.file), b = path.join(headDir, s.file);
    if (!fs.existsSync(a) || !fs.existsSync(b)) { res[s.file] = { base: fs.existsSync(a), head: fs.existsSync(b) }; continue; }
    res[s.file] = await p.evaluate(async ([A, B]) => {
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const [ia, ib] = await Promise.all([load(A), load(B)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size_changed: [ia.width, ia.height, ib.width, ib.height] };
      const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data; g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 48) {
          n++; const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width); if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py;
        }
      }
      return { changed: +(n / (c.width * c.height)).toFixed(4), box: n ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null };
    }, ["data:image/png;base64," + fs.readFileSync(a).toString("base64"), "data:image/png;base64," + fs.readFileSync(b).toString("base64")]);
  }
  await browser.close();
  fs.writeFileSync(path.join(headDir, "diff.json"), JSON.stringify(res, null, 2));
  const ch = Object.values(res).filter(r => r.changed > 0.001 || r.size_changed).length;
  console.log(`diff: ${Object.keys(res).length}장 중 ${ch}장이 0.1% 넘게 달라짐 → ${path.join(headDir, "diff.json")}`);
}

function parse(argv) {
  const a = { extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--web" || k === "--out" || k === "--matrix" || k === "--modes") a[k.slice(2)] = argv[++i];
    else if (k === "--extra") a.extra.push(argv[++i] || "");
    else { console.error("capture: 모르는 인자 " + k); process.exit(2); }
  }
  return a;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "shoot") shoot(parse(rest)).catch(e => { console.error(e); process.exit(1); });
else if (cmd === "diff" && rest.length === 2) diff(rest[0], rest[1]).catch(e => { console.error(e); process.exit(1); });
else { console.error("사용: node capture.js shoot --web <폴더> --out <폴더> [--matrix full|quick] [--modes studio|all] [--extra 이름=쿼리]\n      node capture.js diff <base폴더> <head폴더>"); process.exit(2); }

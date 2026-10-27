// 개발 서버 (Bun): 모드·코어 파일을 저장하면 열린 화면이 자동으로 새로고침된다 (ARCHITECTURE.md §4.7, P2-b)
//   bun tools/dev.ts                      → http://localhost:7780 (백엔드 http://127.0.0.1:7777 로 프록시)
//   WR_DEV_PORT=7781 WR_BACKEND=http://127.0.0.1:7791 WAITING_ROOM_MODES=<사용자 모드 폴더> bun tools/dev.ts
// 하는 일: ① 모든 요청을 백엔드(server.py, 나중엔 wr-server)로 전달(127.0.0.1만, Host를 백엔드 것으로 바꿈)
//          ② index.html에 <meta name="wr-dev"> 를 넣어 코어가 /_dev/events(SSE)에 붙게 함
//          ③ web/ 와 사용자 모드 폴더를 감시해서 바뀐 파일을 알림: 모드 폴더면 {kind:"mode", dir}, 그 밖의 web/ 파일이면 {kind:"core"}
//          ④ 외부 모드 응답의 CSP에 적힌 백엔드 주소를 이 서버 주소로 바꿈(샌드박스 스크립트가 이 origin에서 오므로)
// 외부 통신 없음: 127.0.0.1에만 바인딩하고 백엔드도 127.0.0.1/localhost만 허용한다.
import { watch } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB = join(ROOT, "web");
const PORT = Number(process.env.WR_DEV_PORT || 7780);
const BACKEND = new URL(process.env.WR_BACKEND || "http://127.0.0.1:7777");
const USER_MODES = process.env.WAITING_ROOM_MODES || join(homedir(), ".claude", "waiting-room", "modes");
if (!["127.0.0.1", "localhost"].includes(BACKEND.hostname)) throw new Error("WR_BACKEND는 127.0.0.1 또는 localhost여야 해요");

const clients = new Set<ReadableStreamDefaultController>();
const enc = new TextEncoder();
const pendingMsgs = new Map<string, object>();
let timer: Timer | null = null;
function notify(msg: { kind: string; dir?: string }) {   // 150ms 디바운스, 같은 대상은 한 번만
  pendingMsgs.set(msg.kind + ":" + (msg.dir || ""), msg);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    for (const m of pendingMsgs.values()) for (const c of clients) { try { c.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`)); } catch {} }
    console.log("↻", [...pendingMsgs.values()].map(m => JSON.stringify(m)).join(" "));
    pendingMsgs.clear();
  }, 150);
}
function watchDir(dir: string, classify: (rel: string) => { kind: string; dir?: string } | null) {
  try {
    watch(dir, { recursive: true }, (_e, file) => {
      if (!file) return;
      const rel = String(file).split(sep).join("/");
      if (/(^|\/)\.|~$|\.swp$/.test(rel)) return;
      const m = classify(rel);
      if (m) notify(m);
    });
    console.log("👀 감시:", dir);
  } catch (e) { console.warn("감시할 수 없어요:", dir, (e as Error).message); }
}
watchDir(WEB, rel => {
  const m = /^modes\/([a-z0-9][a-z0-9-]{0,31})\//.exec(rel);
  if (m) return { kind: "mode", dir: m[1] };
  if (rel.startsWith("modes/")) return { kind: "mode" };   // index.json·_template 등 → 목록만 다시
  return { kind: "core" };
});
watchDir(USER_MODES, rel => {
  const m = /^([a-z0-9][a-z0-9-]{0,31})(\/|$)/.exec(rel);
  return m ? { kind: "mode", dir: m[1] } : null;
});
watch(join(ROOT, "brand.json"), () => notify({ kind: "core" }));

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "";
    if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) return new Response("Forbidden host", { status: 403 });
    if (url.pathname === "/_dev/events") {
      let ctl: ReadableStreamDefaultController;
      const body = new ReadableStream({
        start(c) { ctl = c; clients.add(c); c.enqueue(enc.encode(": connected\n\n")); },
        cancel() { clients.delete(ctl); },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const r = await fetch(new URL(url.pathname + url.search, BACKEND), { method: req.method, headers: { host: BACKEND.host }, redirect: "manual" });
    const headers = new Headers(r.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    const csp = headers.get("content-security-policy");
    if (csp) headers.set("content-security-policy", csp.replaceAll(`http://${BACKEND.host}`, `http://${host}`));
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = (await r.text()).replace("<head>", '<head>\n<meta name="wr-dev" content="1">');
      return new Response(html, { status: r.status, headers });
    }
    return new Response(req.method === "HEAD" ? null : r.body, { status: r.status, headers });
  },
});
console.log(`🛠  개발 서버: http://localhost:${PORT}  (백엔드 ${BACKEND.origin}, 사용자 모드 ${relative(homedir(), USER_MODES).startsWith("..") ? USER_MODES : "~/" + relative(homedir(), USER_MODES)})`);

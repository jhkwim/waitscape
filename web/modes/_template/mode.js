/* 스타터 모드 — Mode API v1 최소 예제 (MODES.md, types/ctx.d.ts)
   외부 모드는 샌드박스 iframe에서 돈다: 네트워크·부모 문서·localStorage 없음. 필요한 것은 전부 ctx로. */
(() => {
const C = window.Core;
const T = {  // 모드 문구는 모드가 정한다. ctx.lang = "ko" | "en"
  ko: { title: "스타터", empty: "세션이 아직 없어요", project: "프로젝트", status: "상태", elapsed: "경과", agents: "에이전트", memo: "메모", steps: "단계 수", load: "불러오기",
        st: { working: "작업 중", needs_input: "입력 필요", done: "완료", idle: "대기", agents: "에이전트" } },
  en: { title: "Starter", empty: "No sessions yet", project: "Project", status: "Status", elapsed: "Elapsed", agents: "Agents", memo: "Memo", steps: "Steps", load: "Load",
        st: { working: "Working", needs_input: "Needs input", done: "Done", idle: "Idle", agents: "Agents" } },
};

C.registerMode({
  id: "starter",   // mode.json의 id와 같아야 함
  mount(root, ctx) {
    const t = () => T[ctx.lang] || T.en;
    root.innerHTML = `<header class="st-head"><h1></h1><span class="st-clock"></span></header><main class="st-main"></main>`;
    const $ = s => root.querySelector(s);
    const steps = {};                                   // sid → 흐름 기록 단계 수 (needs: trace)
    let busy = false;

    function draw() {
      const st = ctx.state, x = t(), now = ctx.now();
      $("h1").textContent = `🧪 ${x.title}`;
      if (!st || !st.sessions.length) { $(".st-main").innerHTML = `<p class="st-empty">${x.empty}</p>`; return; }
      // 포커스된 메모 칸은 다시 그리지 않음
      if (root.contains(ctx.doc.activeElement) && ctx.doc.activeElement.tagName === "INPUT") return;
      $(".st-main").innerHTML = `<table><thead><tr><th>${x.project}</th><th>${x.status}</th><th>${x.elapsed}</th>
        <th>${x.agents}</th>${ctx.memo ? `<th>${x.memo}</th>` : ""}${ctx.api.trace ? `<th>${x.steps}</th>` : ""}</tr></thead><tbody>` +
        st.sessions.map(s => {
          const status = C.sessionStatus(s, now);
          const canAgents = C.can(st, s, "subagents");     // 프로바이더에 그 기능이 없으면 칸을 비운다(모드 책임)
          return `<tr data-sid="${C.esc(s.sid)}">
            <td>${C.providerBadge(st, s)} ${C.esc(s.project)}</td>
            <td><span class="st-dot st-${status}"></span>${x.st[status] || status}</td>
            <td>${s.started ? C.fmt(now - s.started) : "—"}</td>
            <td>${canAgents ? s.agents.filter(a => a.status === "running").length : "—"}</td>
            ${ctx.memo ? `<td><input class="st-memo" value="${C.esc(ctx.memo.get(s.sid))}" aria-label="${x.memo}"></td>` : ""}
            ${ctx.api.trace ? `<td><button class="st-load">${steps[s.sid] ?? x.load}</button></td>` : ""}
          </tr>`;
        }).join("") + `</tbody></table>`;
    }

    ctx.listen(root, "change", e => {                   // 메모 저장 (needs: memo)
      const tr = e.target.closest("tr[data-sid]");
      if (tr && e.target.classList.contains("st-memo")) ctx.memo.set(tr.dataset.sid, e.target.value);
    });
    ctx.listen(root, "click", async e => {              // 흐름 기록 불러오기 (needs: trace)
      const tr = e.target.closest("tr[data-sid]");
      if (!tr || !e.target.classList.contains("st-load") || busy) return;
      busy = true;
      try { const tr2 = await ctx.api.trace({ session: tr.dataset.sid, prompt: "last" }); steps[tr.dataset.sid] = tr2.error ? "—" : tr2.total; }
      catch { steps[tr.dataset.sid] = "—"; }
      busy = false; draw();
    });
    ctx.every(1000, () => { $(".st-clock").textContent = C.hms(ctx.now()); });   // 자동 정리되는 타이머
    ctx.on("done", s => { $("h1").classList.add("st-flash"); ctx.after(800, () => $("h1").classList.remove("st-flash")); });
    ctx.on("settings", draw);                           // 언어·회의 모드가 바뀜
    return { update: draw };
  },
});
})();

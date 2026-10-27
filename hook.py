#!/usr/bin/env python3
"""Claude Code hook: stdin 이벤트를 요약해서 events.jsonl에 한 줄 추가. 절대 실패하지 않음."""
import json
import os
import sys
import time

LOG = os.path.expanduser("~/.claude/waiting-room/events.jsonl")


def short(s, n=80):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def describe(tool, inp):
    inp = inp or {}
    path = os.path.basename(inp.get("file_path") or inp.get("notebook_path") or "")
    if tool == "Read":
        return "📖", f"{path} 읽는 중"
    if tool in ("Edit", "MultiEdit", "NotebookEdit"):
        return "✏️", f"{path} 고치는 중"
    if tool == "Write":
        return "📝", f"{path} 쓰는 중"
    if tool == "Bash":
        return "⚡", short(inp.get("description") or inp.get("command"), 60)
    if tool in ("Grep", "Glob"):
        return "🔍", f"'{short(inp.get('pattern'), 40)}' 찾는 중"
    if tool in ("WebFetch", "WebSearch"):
        return "🌐", short(inp.get("query") or inp.get("url"), 60)
    if tool in ("Agent", "Task"):
        return "🤖", f"서브에이전트: {short(inp.get('description'), 50)}"
    if tool == "TodoWrite":
        return "🗒️", "할 일 정리 중"
    if tool == "SubagentHandback":
        return "📨", "결과 보고"
    if tool.startswith("mcp__"):
        return "🔌", tool.split("__")[-1]
    return "🔧", tool


KINDS = {"Read": "read", "Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit", "Write": "edit",
         "Bash": "bash", "Grep": "search", "Glob": "search", "WebFetch": "web", "WebSearch": "web",
         "Agent": "agent", "Task": "agent", "TodoWrite": "todo", "TaskCreate": "todo", "TaskUpdate": "todo"}


def main():
    d = json.load(sys.stdin)
    ev = {
        "ts": time.time(),
        "sid": d.get("session_id", "?"),
        "cwd": d.get("cwd", ""),
        "event": d.get("hook_event_name", ""),
    }
    if d.get("agent_id"):
        ev["aid"] = d["agent_id"]
        ev["atype"] = d.get("agent_type", "")
    tool, inp = d.get("tool_name", ""), d.get("tool_input") or {}
    if ev["event"] == "PreToolUse" and tool in ("mcp__waitscape__waitscape_status", "mcp__waitscape__waitscape_board"):
        # MCP 보고: 말풍선 대신 정화한 report (wr-hook과 같은 줄. 마스킹은 wr-hook만)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import mcp_report
        kind = "status" if tool.endswith("status") else "board"
        m, err = (mcp_report.status_of if kind == "status" else mcp_report.board_of)(inp)
        if err:
            return
        ev["report"] = dict({"tool": kind}, **m)
    elif ev["event"] == "PreToolUse":
        ev["icon"], ev["text"] = describe(tool, inp)
        ev["kind"] = KINDS.get(tool, "web" if tool.startswith("mcp__") else "other")
        if tool == "TodoWrite":
            ev["todos"] = [{"text": short(t.get("activeForm") if t.get("status") == "in_progress" else t.get("content"), 60),
                            "status": t.get("status")} for t in inp.get("todos", [])]
        elif tool in ("Agent", "Task"):
            ev["agent_desc"] = short(inp.get("description"), 50)
            ev["bg"] = bool(inp.get("run_in_background"))
            ev["agent_req"] = inp.get("subagent_type") or "general-purpose"
    elif ev["event"] == "PostToolUse":
        if tool == "TaskCreate":
            resp = d.get("tool_response") or {}
            task = resp.get("task", resp) if isinstance(resp, dict) else {}
            ev["task_new"] = {"id": str(task.get("id", "")), "text": short(inp.get("subject"), 60)}
        elif tool == "TaskUpdate":
            ev["task_upd"] = {"id": str(inp.get("taskId", "")), "status": inp.get("status"),
                              "text": short(inp.get("activeForm") or inp.get("subject"), 60)}
        else:
            return

    elif ev["event"] == "UserPromptSubmit":
        prompt = (d.get("prompt") or "").lstrip()
        if prompt.startswith(("<agent-message", "<task-notification", "[SYSTEM NOTIFICATION")):
            ev["event"] = "Resume"  # 에이전트 결과 보고: 새 프롬프트가 아님
        else:
            ev["text"] = short(prompt, 60)
    elif ev["event"] == "Notification":
        ev["text"] = short(d.get("message"), 80)
    # 멀티플렉서(Orca·cmux)에서 연 셸: 이동 정보. 어댑터 표의 env만 읽고 형식 검증(mcp_report.mux_term — wr-hook term.rs와 같은 표)
    try:  # 이동 정보가 실패해도 이벤트는 기록한다
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import mcp_report
        term = mcp_report.mux_term(os.environ)
        if term:
            ev["term"] = term
    except Exception:
        pass
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


try:
    main()
except Exception:
    pass
sys.exit(0)

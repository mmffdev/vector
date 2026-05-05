#!/usr/bin/env bash
# PostToolUse hook — fires after every tool call.
# Maintains a 10-minute sliding-window state file at /tmp/.claude-retro-loop-state.json.
# When all 5 signals fire within the window, writes the sentinel /tmp/.claude-retro-loop-trigger
# so the next UserPromptSubmit hook can inject a system-reminder telling the agent to run <r> --auto-loop.
#
# Signals (must ALL hit within 10-min window):
#   1. max(tool_repeats.values()) >= 4
#   2. files_read_unique == 0  (no NEW files read in window)
#   3. user_messages_in_window == 0
#   4. consecutive_same_error_class >= 3
#   5. edit_or_write_success_in_window == false
#
# Inputs (from Claude Code harness env):
#   CLAUDE_TOOL_NAME       — name of the tool that just ran (Bash, Read, Edit, etc.)
#   CLAUDE_TOOL_INPUT      — JSON of tool input
#   CLAUDE_TOOL_RESULT     — string/JSON of tool result (may be large)
#   CLAUDE_TOOL_IS_ERROR   — "true" if tool errored

set -u

STATE_FILE="/tmp/.claude-retro-loop-state.json"
TRIGGER_FILE="/tmp/.claude-retro-loop-trigger"

# If trigger already exists, do nothing — don't double-fire.
[[ -f "$TRIGGER_FILE" ]] && exit 0

python3 - <<PY
import json, os, sys, time, hashlib, re
from pathlib import Path

STATE = Path("$STATE_FILE")
TRIGGER = Path("$TRIGGER_FILE")
WINDOW_S = 600  # 10 minutes
NOW = time.time()

tool_name   = os.environ.get("CLAUDE_TOOL_NAME", "")
tool_input  = os.environ.get("CLAUDE_TOOL_INPUT", "")
tool_result = os.environ.get("CLAUDE_TOOL_RESULT", "")
is_error    = os.environ.get("CLAUDE_TOOL_IS_ERROR", "").lower() == "true"

if not tool_name:
    sys.exit(0)

# ---- Load state ---------------------------------------------------------
if STATE.exists():
    try:
        state = json.loads(STATE.read_text())
    except Exception:
        state = None
else:
    state = None

if not state or NOW - state.get("window_started_ts", 0) > WINDOW_S:
    state = {
        "window_started_ts": NOW,
        "window_started":    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW)),
        "tool_repeats":      {},
        "files_read":        [],         # unique paths
        "edit_write_ok":     False,
        "errors":            [],         # last few error class strings
        "user_msg_seen":     False,      # set by loop-injector when a user prompt arrives
    }

# ---- Update state -------------------------------------------------------
state["tool_repeats"][tool_name] = state["tool_repeats"].get(tool_name, 0) + 1

# Track file reads (unique only)
if tool_name == "Read":
    try:
        d = json.loads(tool_input) if tool_input else {}
        fp = d.get("file_path") or d.get("path") or ""
        if fp and fp not in state["files_read"]:
            state["files_read"].append(fp)
    except Exception:
        pass

# Track successful edit/write
if tool_name in ("Edit", "Write", "MultiEdit", "NotebookEdit") and not is_error:
    state["edit_write_ok"] = True

# Track error class — coarse classification of last few errors
def error_class(text: str) -> str:
    t = text.lower()
    if "exit status 1" in t: return "exit-1"
    if "permission denied" in t: return "permission-denied"
    if "not found" in t or "no such file" in t: return "not-found"
    if "timeout" in t: return "timeout"
    if "address already in use" in t or "port" in t and "bound" in t: return "port-collision"
    if "connection refused" in t: return "conn-refused"
    if "404" in t: return "http-404"
    if "400" in t: return "http-400"
    if "500" in t: return "http-500"
    if "syntax error" in t or "unexpected token" in t: return "syntax"
    if "undefined" in t and ("is not" in t or "reference" in t): return "undefined-ref"
    return "other"

if is_error or "exit status" in str(tool_result).lower()[:500]:
    state["errors"].append(error_class(str(tool_result)[:2000]))
    state["errors"] = state["errors"][-5:]

# ---- Compute signals ----------------------------------------------------
max_repeat            = max(state["tool_repeats"].values()) if state["tool_repeats"] else 0
files_read_unique     = len(state["files_read"])
last3                 = state["errors"][-3:]
same_err_streak       = (len(last3) == 3 and len(set(last3)) == 1)
edit_or_write_ok      = state["edit_write_ok"]
user_msg_in_window    = state.get("user_msg_seen", False)

signal_1 = max_repeat >= 4
signal_2 = files_read_unique == 0
signal_3 = not user_msg_in_window
signal_4 = same_err_streak
signal_5 = not edit_or_write_ok

# ---- Write state back ---------------------------------------------------
STATE.write_text(json.dumps(state, indent=2))

# ---- Fire trigger if all signals true -----------------------------------
if signal_1 and signal_2 and signal_3 and signal_4 and signal_5:
    state["triggered_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW))
    STATE.write_text(json.dumps(state, indent=2))
    TRIGGER.write_text(json.dumps({
        "triggered_at": state["triggered_at"],
        "signals": {
            "tool_repeats": state["tool_repeats"],
            "files_read_unique": files_read_unique,
            "consecutive_same_error_class": (last3[-1] if same_err_streak else None),
            "edit_or_write_success_in_window": edit_or_write_ok,
            "user_messages_in_window": 0 if signal_3 else 1,
        }
    }, indent=2))

sys.exit(0)
PY

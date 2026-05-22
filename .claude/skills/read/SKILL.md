---
name: read
description: List handover docs in `handovers/`, ask the user which one to load, then read the full file into the session and pin it as the active handover. Pairs with `<write>` which updates that same file at session end. Use when the user types `/read`, "read a handover", "load handover", or wants to resume a prior agent session.
---

# `<read>` Skill

Loads a handover document from `handovers/` into the session and pins it as **the active handover** so `<write>` knows which file to update later.

**Folder:** `handovers/` (project root). Created on demand if missing.
**Pointer file:** `.claude/active_handover.txt` — single line, the chosen file's repo-relative path. Read by `<write>` at session end.

This skill is the **session-start half** of the handover continuity pair. `<write>` is the session-end half.

---

## Flow

1. **List files**
   - Run `ls handovers/*.md 2>/dev/null` (or equivalent).
   - If the folder is empty / missing, tell the user: "No handover docs yet. Run `<write>` mid-session to draft one, or save a doc to `handovers/<name>.md` manually."
   - If exactly **one** file exists, skip the picker — pick it automatically and tell the user "Only one handover on disk — loading `<name>.md`."
   - If multiple files exist, present them via `AskUserQuestion`:
     - Header: `Handover`
     - Question: `Which handover do you want to load?`
     - Options: each file as a label (filename without extension), with the first line of the file (after stripping `#` and whitespace) as the description. Cap at 4 options — if more than 4, sort by `mtime` (most recent first) and show the top 4. Mention the remainder count if any.

2. **Pin the choice**
   - Write the chosen file's repo-relative path to `.claude/active_handover.txt` (single line, no trailing newline noise). Overwrite if it exists — only one active handover per session.

3. **Read the file**
   - Use the `Read` tool on the full file (no `limit` / `offset` — the whole thing is in scope).
   - Skim it and produce a **terse acknowledgement** in chat:
     - First line: `Loaded handover: <filename>` with the markdown link.
     - 2-4 bullet points summarising:
       - **What this surface is** — one line.
       - **State at handover** — what was DONE, latest commit if mentioned.
       - **Where to pick up next** — the first P1/P2 item from the "pick up next" section.
       - **Caveats** — one line if there are hard "don't change this" notes.
   - End with: "Tell me what you want to work on, or I can start on the top open item."

4. **Do NOT do anything else.**
   - `<read>` is purely a load + acknowledge. No edits to the file, no commits, no kicking off work autonomously.
   - The user drives what happens next.

---

## Edge cases

- **`.claude/active_handover.txt` already exists from a prior session.** Overwrite without comment — sessions don't share state, the new pick is canonical.
- **User types `/read <filename>` directly** (e.g. `/read agent_visual_app`). Skip the picker entirely, treat it as the chosen file, fall back to picker only if no match is found.
- **File doesn't exist** when reading. Report the mismatch — don't write the pointer. Suggest re-running without an argument.
- **Folder doesn't exist.** Don't create it — `<read>` is read-only on the filesystem aside from the pointer file. Tell the user "No `handovers/` folder yet — `<write>` will create one on first save."
- **A non-`.md` file is in `handovers/`.** Ignore silently. The picker is markdown-only.

---

## What this skill must NOT do

- Don't edit the handover file. That's `<write>`'s job.
- Don't commit anything. Same.
- Don't fan-out to multiple files at once. One active handover per session, full stop.
- Don't read partially — handovers are the agent's mental model for the session; load the whole file.
- Don't paraphrase rules into your own words in the acknowledgement — if the file says "don't fix V1", quote it verbatim.

---

## Companion skill

See [`<write>`](../write/SKILL.md) — call it at the end of a session (or whenever you've made enough progress to want it captured) to update the file `<read>` loaded.

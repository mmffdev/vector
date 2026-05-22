---
name: write
description: Update the active handover document (pinned by `<read>`) with this session's progress. Surgically refreshes "What is DONE", "Where to pick up next", and "Known caveats" sections; adds new sections only when there's structural new content. Use when the user types `/write`, "update the handover", or signals end-of-session intent.
---

# `<write>` Skill

Updates the active handover doc in `handovers/` with this session's work. Pairs with `<read>` which loaded the file at session start.

**Folder:** `handovers/`.
**Pointer file:** `.claude/active_handover.txt` — written by `<read>`, read here.

This skill is the **session-end half** of the handover continuity pair.

---

## Preconditions

Read `.claude/active_handover.txt` first.

- **If the pointer file is missing or empty:** the user hasn't run `<read>` yet. Two paths:
  1. If there's exactly one `.md` file in `handovers/`, treat that as the active handover and proceed (and write the pointer for the rest of the session).
  2. If there are multiple or none, **stop and ask** — present the picker the same way `<read>` does, but with the wording "Which handover should I update?" Use `AskUserQuestion`.
- **If the pointed file no longer exists** (renamed/deleted during session), tell the user and ask for the correct path. Don't auto-create.

---

## Flow

1. **Resolve the target.** Read `.claude/active_handover.txt`. Verify the file exists.

2. **Read it in full.** Use the `Read` tool, no offset/limit. You need the whole structure to update surgically.

3. **Survey the session.** Before drafting any changes, gather:
   - The files modified, created, deleted this session (`git status`, recent `Edit`/`Write` tool calls in conversation).
   - Recent commit hashes from this session (`git log -10 --oneline`).
   - Any TODOs that were completed or added.
   - New caveats, gotchas, or "don't change this" rules that emerged.
   - New decisions about design, scope, or priority.

4. **Diff session against handover.** For each load-bearing section of the handover, decide:
   - **"What is DONE / What's there"** — has the file/feature inventory changed? Add new entries for anything shipped this session. Don't remove anything that's still true.
   - **"Where to pick up next"** — anything that was P1/P2 and is now done? Move it to DONE and drop it from "pick up next". Anything new identified that the next agent should tackle? Append at the right priority.
   - **"Known caveats"** — any new "don't do X" learned this session? Add. Caveats are append-only unless one is explicitly invalidated.
   - **"Commits in scope"** — append new commit lines for this session.
   - **"How to verify"** — only update if the verification steps materially changed (new endpoint, new UI element, removed feature).
   - **"Open design questions"** — append new questions, mark answered ones as resolved (don't delete; cross out with `~~strikethrough~~` and note the resolution).

5. **Draft the changes.** Use `Edit` (not `Write` — surgical only) for each section that needs updating. One `Edit` call per logical change.
   - For section additions (a new caveat under "Known caveats"), find the section's last entry and edit `old_string` to append a new entry.
   - For inventory updates ("V2 ships X" → "V2 ships X, Y"), edit the exact line.
   - **Never use replace_all on prose** — too risky.

6. **Update the date footer.** Most handovers end with `**Authored:** <date> by Claude. If anything in this doc contradicts the code, trust the code and patch this file.` — update the date to today, prepend a `**Last updated:** <today>` line above the authored line if it doesn't exist yet.

7. **Report.** Tell the user, in 3-6 bullets:
   - File updated.
   - Sections changed (with counts: "Added 2 entries to 'What is DONE', 1 to 'Known caveats'").
   - Any sections you considered updating but left alone (and why).
   - Whether the doc still parses cleanly (no markdown link breaks, no orphaned headings).
   - **One question for the user**: "Anything else from this session worth capturing?" — they may remember something you missed.

8. **Do NOT commit.**
   - `<write>` is a file edit, not a git operation.
   - User decides if/when to commit (matches the explicit-commit habit per CLAUDE.md HARD RULE).
   - Don't stage the file either — leave the working tree as you found it (plus the new edit).

---

## Surgical update principles

**Preserve, don't paraphrase.** The previous agent's voice and structure are deliberate. Don't rewrite their bullets in your own style. Add new bullets in their style.

**Be additive on caveats.** "Don't do X" rules learned the hard way must persist across sessions. Never delete a caveat unless it has been explicitly invalidated by code change (e.g. "V1 has bugs" stops being true if V1 was deleted).

**Move done items, don't delete.** When a P1 task is shipped, move it from "Where to pick up next" into "What is DONE" — don't just remove it. Future agents need to see the trajectory.

**Cross out, don't erase.** When a design question is resolved, strike it through (`~~text~~`) and add a `→ Resolved: <decision>` note. Erasing erases the reasoning trail.

**Quote, don't summarise.** When recording a new rule (e.g. user said "never change V1"), use their exact words inside the caveat, not your paraphrase.

**Cap line lengths.** Most handover lines are under 120 chars. Match the style.

---

## Edge cases

- **Pointer file points at a file outside `handovers/`.** Refuse — handovers must live in `handovers/`. Tell the user, ask for re-pick via `<read>`.
- **Handover file is shorter than 50 lines.** Probably an early draft. Update it anyway but mention you noticed it's slim and suggest seeding more sections (file map, caveats, etc.) on next session.
- **Nothing changed this session worth recording.** Tell the user. Update only the `Last updated` date. Don't fabricate progress.
- **User runs `<write>` multiple times in a session.** Fine — each call updates the file with incremental progress. Each call updates `Last updated` to today.
- **Conflict: handover claims a thing is broken, but you fixed it this session.** Add a new bullet under "What is DONE" recording the fix; DO NOT delete the broken-claim line yet — strike it through with `~~...~~` and add `→ Fixed in <commit>` underneath. Future readers need both the historical state and the resolution.
- **Active handover was deleted mid-session.** Tell the user, ask if they want to re-create it (use the structure of the deleted file as scaffolding, draw from conversation memory) or pick a different one.

---

## What this skill must NOT do

- Don't commit or stage. File edit only.
- Don't push. Same reason.
- Don't rewrite the whole file. Surgical updates only — `Edit` not `Write`.
- Don't change tone. Preserve the previous agent's voice.
- Don't delete content. Move it, strike it through, or supersede it — never remove.
- Don't add fluff. New entries should match the file's existing density and signal-to-noise ratio.
- Don't add the agent's name or session details to every entry. The doc is collective; individual session attribution lives in the dated footer only.

---

## Companion skill

See [`<read>`](../read/SKILL.md) — call it at session start to load the file and pin it as active.

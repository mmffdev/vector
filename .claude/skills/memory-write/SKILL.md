---
name: memory-write
description: >
  Saves durable facts to context/MEMORY.md or context/USER.md.
  Triggers on "remember this", "note that", "update memory", "save this",
  "forget about". Three actions: add (append under the right section),
  replace (substring match + swap), remove (confirm with user first).
  Enforces 10 KB / 3 KB caps with dedup guard.
---

# memory-write

## Outcome

- Fact added to, updated in, or removed from `context/MEMORY.md` (or `context/USER.md` for user-profile facts).
- Character cap enforced (10,000 for MEMORY.md, 3,000 for USER.md).
- Confirmation: "Saved — will be active from next session."

## When to fire

User explicitly says: "remember this", "note that", "update memory", "save this", "forget about that", "make a note", or asks me to record something durable.

Do NOT fire for:
- Ephemeral session-scratch ("hold this thought") — that's conversation memory, not durable.
- Reading existing memory ("what does memory say about X?") — that's retrieval, see § Memory Retrieval in CLAUDE.md.
- Daily log entries — those are written silently by the session, not via this skill.

## Pick the target file

- **`context/USER.md`** — durable facts about Rick (background, preferences, working style, buyer profile). Rarely changes.
- **`context/MEMORY.md`** — everything else (HARD RULES, active mode, workflow rules, CSS conventions, test surface, active threads, environment notes, pending decisions).

## Steps

1. **Read the target file in full.**
2. **Determine action**: add, replace, or remove. Default = add unless the fact substring-matches an existing entry (then replace).
3. **Dedup check** — scan for substring match. If exists:
   - "remember" → replace in place.
   - "forget" → confirm with user, then delete.
4. **Cap check** — `wc -c < <file>`. If over cap (10,000 / 3,000), consolidate similar entries before writing.
5. **Pick the section** — for MEMORY.md: `## HARD RULES`, `## Active Mode`, `## Collaboration baseline`, `## Workflow rules`, `## CSS conventions`, `## Test surface`, `## Active Threads`, `## Environment Notes`, `## Pending Decisions`. If none fits, ask which section before writing.
6. **Write** — use Edit (preferred) with surgical old_string/new_string. Never rewrite the whole file unless consolidating.
7. **Confirm** — "Saved to `context/MEMORY.md` under `## <Section>` — will be active from next session."

## Format

- Lead with the rule/fact. Keep it tight — this file is loaded every session.
- For feedback-style entries, optional inline `**Why:**` and `**How to apply:**` lines if the rule has edge cases.
- Link related entries with `[[name]]` if useful.

## HARD RULES section

If the fact is a HARD RULE (incident-earned, never-overridable), write it in **both** `context/MEMORY.md` AND `.claude/CLAUDE.md` HARD RULES block at the top. Confirm with the user before adding a new HARD RULE — these are load-bearing.

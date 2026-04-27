# `<b>` — session boot file manager

Reads or creates boot files in the project memory directory.

**Memory dir:** `/Users/rick/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---PM/memory/`

## Syntax

```
<b> -<N> -R    Read boot<N>.md into context (restore only, no writes)
<b> -<N> -C    Create or update boot<N>.md from current session state
<b> -A -R      Read bootA.md (master record) into context
<b> -A -C      Write bootA.md — comprehensive master record of the entire session
```

**Examples:**
- `<b> -4 -R` — load boot4.md into context
- `<b> -4 -C` — snapshot current session state into boot4.md
- `<b> -5 -C` — create boot5.md for a new instance
- `<b> -A -C` — write the full-session master record to bootA.md
- `<b> -A -R` — load the master record into context

---

## `-R` — Read

1. Construct path: `<memory-dir>/boot<N>.md` (or `bootA.md` for `-A`)
2. If file does not exist: report `boot<N>.md not found` and stop.
3. Read the file with the Read tool (full file enters context).
4. **Lazy surface** — narrate ONLY these two sections:
   - **Current state** block: branch, story counter, phase (3–4 lines)
   - **What's next** numbered list verbatim
   All other sections are in context and available on request — do NOT narrate them unprompted.
5. Report: `Loaded boot<N>.md — branch <X>, last story <NNNNN>. Say "show [uncommitted | key facts | commits | what shipped]" for more.`

No writes. No MEMORY.md changes.

---

## `-C` — Create / Update (numbered)

Gather the following, then write the file.

### 1 — Gather git state (run in parallel)

```bash
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" log --oneline -8
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" status --short
```

### 2 — Gather story counter

Read `docs/c_story_index.md` — extract the **Last issued** ID.

### 3 — Write boot<N>.md

Use this exact template, substituting gathered values and session-specific content:

```markdown
---
name: Session bootup — <one-line description of this session's focus>
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: <current session ID if known, else omit>
---

## Current state (last updated: <YYYY-MM-DD>)

**Active branch:** `<branch>`
**Story index last issued:** `<NNNNN>`
**Phase:** <phase number and name>

---

## Planka card states

**In progress / Doing:**
- <list any cards currently in Doing>

**Completed (committed, move to Completed in Planka):**
- <list completed cards with commit hashes>

**Parked:**
- <list parked cards>

---

## Uncommitted on branch

<list each uncommitted file and what it contains, or "Branch is clean.">

---

## What shipped this session

<bullet list of the meaningful changes made this session>

---

## Recent commits

<paste the git log --oneline -8 output verbatim>

---

## What's next

<numbered list of the most actionable next steps, drawn from conversation context>

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
<add any session-specific non-obvious facts here>
```

### 4 — Update MEMORY.md (new file only)

If `boot<N>.md` did not previously exist, prepend a new entry to MEMORY.md under the session-restore block:

```
- [Session restore — <date> instance <N>](boot<N>.md) — <one-line hook matching the description field>
```

If the file already existed, skip this step (the MEMORY.md entry is already there).

### 5 — Report

```
Created boot<N>.md — branch <X>, last story <NNNNN>, <M> uncommitted files. MEMORY.md updated.
```
or
```
Updated boot<N>.md — branch <X>, last story <NNNNN>, <M> uncommitted files.
```

---

## `-A -C` — Master record (whole session)

Writes `bootA.md` — a comprehensive record of everything done across the entire session. Always overwrites. Never added to MEMORY.md.

### 1 — Gather git state (run in parallel)

```bash
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" log --oneline -20
git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" status --short
```

### 2 — Gather story counter

Read `docs/c_story_index.md` — extract the **Last issued** ID.

### 3 — Write bootA.md

```markdown
---
name: Master session record — <YYYY-MM-DD> — <one-line summary of session scope>
description: Full-session master record. All work streams, all cards, all decisions, all uncommitted changes, complete what's next.
type: project
---

## Session overview (last updated: <YYYY-MM-DD>)

**Active branch:** `<branch>`
**Story index last issued:** `<NNNNN>`
**Phase:** <phase number and name>
**Session scope:** <2–3 sentence summary of everything this session touched>

---

## All cards touched this session

**Completed and committed:**
- <NNNNN> — <title> (<commit hash>)

**In Doing:**
- <NNNNN> — <title>

**Created this session (Backlog):**
- <NNNNN> — <title>

**Parked / deferred:**
- <NNNNN> — <title> (<reason>)

---

## All uncommitted changes

<list every uncommitted file with a description of what it contains>

---

## Everything shipped this session

<comprehensive bullet list of ALL changes — tooling, UI, backend, memory, docs, config — grouped by work stream>

---

## Key decisions made

<bullet list of non-obvious decisions, design choices, architecture calls, or rejected alternatives — the "why" behind what was built>

---

## Full commit log (last 20)

<paste the git log --oneline -20 output verbatim>

---

## What's next

<numbered list of all actionable next steps across every work stream>

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
<add all session-specific non-obvious facts here>
```

### 4 — Report

```
Written bootA.md — full session master record. Branch <X>, last story <NNNNN>, <M> uncommitted files. <P> work streams covered.
```

Never updates MEMORY.md. bootA.md is standalone.

---

## Rules

- **Never** read or write any boot file other than the one specified.
- **`-R` is read-only.** If the user asks to update after a `-R`, they must run a separate `-C`.
- The **"Key facts" block is always copied verbatim** from the template above, then appended with any session-specific additions. Do not omit it.
- Pull "what's next", "what shipped", and "key decisions" from **conversation context**, not from git alone — git shows commits, not intent.
- **`-A` never touches MEMORY.md.** bootA.md is a standalone hand-off document.

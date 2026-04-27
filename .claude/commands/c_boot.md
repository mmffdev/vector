# `<boot>` — session boot file manager

Reads or creates numbered boot files in the project memory directory.

**Memory dir:** `/Users/rick/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---PM/memory/`

## Syntax

```
<boot> -<N> -R    Read boot<N>.md into context (restore only, no writes)
<boot> -<N> -C    Create or update boot<N>.md from current session state
```

**Examples:**
- `<boot> -4 -R` — load boot4.md into context
- `<boot> -4 -C` — snapshot current session state into boot4.md
- `<boot> -5 -C` — create boot5.md for a new instance

---

## `-R` — Read

1. Construct path: `<memory-dir>/boot<N>.md`
2. If file does not exist: report `boot<N>.md not found` and stop.
3. Read the file with the Read tool.
4. Apply the context: surface branch, story counter, uncommitted files, and "what's next" into the working conversation so the session can resume from there.
5. Report one-line summary: `Loaded boot<N>.md — branch <X>, last story <NNNNN>, <M> uncommitted files.`

No writes. No MEMORY.md changes.

---

## `-C` — Create / Update

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

## Rules

- **Never** read or write any boot file other than the one specified by `<N>`.
- **Never** modify `boot2.md` via `-C` — that file is the static tooling reference, not a session snapshot.
- **`-R` is read-only.** If the user asks to update after a `-R`, they must run a separate `-C`.
- The **"Key facts" block is always copied verbatim** from the template above, then appended with any session-specific additions. Do not omit it.
- Pull "what's next" and "what shipped" from **conversation context**, not from git alone — git shows commits, not intent.

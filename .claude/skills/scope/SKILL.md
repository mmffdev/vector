# `<scope>` Skill

Manages `Vector_Scope.md` as the single source of truth for all product scope, priorities, and progress.

**Scope file:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/Vector_Scope.md`

---

## Flags

### `<scope> -r` — Read & Discuss

1. Read `Vector_Scope.md` in full.
2. Identify all items marked `🔵 IN FLIGHT` — go to each one first and open discussion on its current state.
3. Scan for items with no priority set — flag them and suggest P1–P5 based on dependencies and context.
4. Scan for items that look done based on codebase evidence (see `-u` codebase check rules below) — surface these for confirmation before marking.
5. If user provides no message with `-r`, proactively surface: (a) any in-flight items, (b) unprioritised items, (c) anything that looks done but isn't marked, (d) anything you've been working on this session that maps to a scope item.
6. Wait for user direction before making any edits. `-r` is read and discuss only — no writes unless user confirms.

### `<scope> -a [message]` — Add

1. Read `Vector_Scope.md`.
2. If `[message]` is provided: parse it for new scope items. If not: synthesise from the current session discussion — identify what was discussed that isn't yet in the doc.
3. Determine the correct section for each new item. If it belongs under an existing item as a sub-item, use the next available sub-number (e.g. if 1.9 exists, new item is 1.10). If it's a new top-level area, add a new section header and extend the Table of Contents.
4. Check for duplicates — if the item already exists (exact or near-match), flag it rather than adding.
5. Set priority (P1–P5) on the new item. If unsure, ask.
6. Present the proposed insertions as a numbered list before writing — "I'm going to add: (1) ... (2) ..." — then write after confirmation OR if in auto mode, write immediately and report what was added.
7. Bump `Doc version` minor (0.1 → 0.2) and update `Last updated` date.
8. **After writing each new item**, register it in `.claude/scope-refs.map` — one line per item, tab-separated: `REF<tab>keyword1 keyword2 ...`. Use the actual ref as it appears in `Vector_Scope.md` (letter-prefixed: `B19.1.4`, `M3.1.1`, etc. — NOT bare numeric `1.4`, those don't exist in this scope file). Extract keywords from the item text (strip markdown, split on spaces, drop words shorter than 4 chars). This enables the commit hook to match future commits to this item by keyword before falling back to Unmatched.

**Map file format** (`.claude/scope-refs.map`):
```
B14.5	custom field library field types options
B8.1	api key sam_live blake3 scoped revokable last_used
B9.1	webhook subscriptions table url event filter secret retry
```

### `<scope> -u` — Update Progress

1. Read `Vector_Scope.md`.
2. For each item, run a codebase check (see rules below).
3. Apply markers:
   - `✅` + ~~strikethrough~~ — item is done (codebase evidence confirms)
   - `🔵 IN FLIGHT` — item is actively being worked (current session context or recent git commits reference it)
   - `❌ NFA` — user has marked this No Further Action; do not remove from doc, just mark
   - `⚠️` — item exists in codebase but partially — note what's missing inline
   - No marker — not started, no evidence
4. Below each modified item, append a `> Last checked: YYYY-MM-DD` blockquote.
5. Report a summary: X done, Y in flight, Z partial, N not started.
6. Bump `Doc version` minor and update `Last updated`.

### Codebase check rules (used by `-u` and `-r`)

For each scope item, determine done/partial/not-started by:
- Grepping backend Go files for handler, service, route, or table references matching the item
- Grepping frontend TSX/TS files for hook, page, or component references
- Checking git log for recent commits mentioning the item's key terms
- Checking the tech-debt register (`docs/c_tech_debt.md`) — if an item has an open TD entry, it is not fully done
- Never mark done based on a single file existing — look for the full stack (route + handler + frontend consumer) unless the item is explicitly backend-only or frontend-only

---

## Markers reference

| Marker | Meaning |
|---|---|
| `✅` + ~~strikethrough~~ | Done — confirmed by codebase check |
| `🔵 IN FLIGHT` | Actively being worked this session or in recent commits |
| `❌ NFA` | No Further Action — out of scope, no work planned |
| `⚠️ PARTIAL` | Exists but incomplete — inline note on what's missing |
| `[Pn]` | Priority — P1 (highest) to P5 (lowest) |

---

## Priority scale

| Level | Meaning |
|---|---|
| P1 | Must ship — blocks other work or is on the critical path |
| P2 | High value — next logical piece of the product |
| P3 | Important — planned, not urgent |
| P4 | Nice to have — do when adjacent work is touched |
| P5 | Aspirational — low urgency, revisit when relevant |

---

## Commit note rule (enforced by hook)

When a commit is made, the `scope-commit-note.sh` hook resolves the target scope item using this priority order:

1. **Explicit ref tag in commit message** — if the message contains `[B19.1.4]` or `[B19.1.4, M3.2.3]`, those refs are used directly. No further lookup needed. **This is the preferred path** — write the bracketed ref into your commit message any time the work maps to a known scope item.
2. **scope-refs.map lookup** — keywords registered when `-a` added the item are matched against the commit message and changed file list.
3. ~~File-path heuristics~~ — removed 2026-05-09 (was over-greedy: matched 10+ items per commit on common terms like "v1", "API", "spec", trashing the scope file). Untagged commits now flow straight to Unmatched.

If a match is found, appends under that item:
```
> Commit `abc1234` (YYYY-MM-DD): <first line of commit message>
```
If no match: appends to `## Unmatched Commits` at the bottom. Review these in the next `-r` session — either tag retrospectively or decide the work belongs outside scope.

---

## Session-start rule (enforced by hook)

At session start, `scope-session-start.sh` emits `additionalContext` containing:
- The count of in-flight items (`🔵 IN FLIGHT`)
- The count of items with no priority
- A one-line summary of the last 3 commits that matched scope items
- A prompt: "Vector_Scope.md has [N] in-flight items. Run `<scope> -r` to review."

This surfaces in the session-start digest alongside the librarian output.

---

## Rules

- Never delete a scope item — use `❌ NFA` instead.
- Never reorder existing ref numbers — append only. If a section grows, sub-items extend (1.9 → 1.10, not a reshuffle).
- Priorities are per-item, not per-section.
- `-r` is always safe — read-only until user confirms a change.
- When in auto mode, `-a` and `-u` write immediately and report.

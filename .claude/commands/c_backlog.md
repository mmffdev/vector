# `<backlog>` — feature backlog & module roadmap

Opens [`BACKLOG.md`](../../BACKLOG.md) at the repo root — Rick's owned roadmap of future modules (VECTOR, ORIGO, SIGMA, FLUX, SPINE, OPERATOR PLATFORM) and breakout ideas.

**File:** `BACKLOG.md` (repo root)

## Syntax

```
<backlog>        Open BACKLOG.md in the IDE
<backlog> -l     List all module codenames + their one-line meaning
```

---

## Default (no flags) — open

```bash
open "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/BACKLOG.md"
```

---

## `-l` — list module codenames

Read `BACKLOG.md`, extract every `### CODENAME — Module name` heading, print as a table:

```
VECTOR              — the live product
ORIGO               — Confluence-style Wiki
SIGMA               — OKRs
FLUX                — Design Thinking
SPINE               — Governance
OPERATOR PLATFORM   — mmff.io control tower
```

Do not read or surface the bullet items underneath unless Rick names a specific codename.

---

## Rules

- **Owned by Rick.** Claude does not surface, prioritise, scope, or act on any backlog item unless Rick explicitly points at one by name. Treat as roadmap context only.
- **Not a story queue.** For active work use `<stories>` (7-gate Fibonacci) and the plan JSON files under `dev/plans/`.
- **Codename register is canonical.** When the user mentions OKRs, Wiki, Design Thinking, or Governance, prefer the codename (SIGMA, ORIGO, FLUX, SPINE) when writing it back into docs or commits.
- The old Planka-board `<backlog>` lives at [`docs/archive/c_backlog_planka.md`](../../docs/archive/c_backlog_planka.md) — Planka is suspended; do not point new work there.

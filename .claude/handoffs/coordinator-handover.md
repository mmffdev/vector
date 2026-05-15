---
name: Coordinator Handover — Two Parallel Agents on MMFFDev-PM
description: Supervisor briefing for an agent coordinating Agent-A (portfolio templates) and Agent-B (artefacts). Covers state, contracts, conflict surfaces, controls.
type: project
---

> **Historical document.** Planka was decommissioned 2026-05-15; references to Planka cards, boards, or card-lifecycle moves below are frozen snapshots from when this handoff was written. Current story tracker = `dev/plans/PLA-NNNN.json` `work_item_backlog`.


## Your Role

You are the **coordinator** above two working agents on this repo. Both agents have been operating in parallel on adjacent but distinct DB/feature work. Your job is to:

1. Hold the global picture neither agent has alone
2. Sequence their work so they don't collide on shared files (main.go, migrations, schema)
3. Decide when each agent runs, pauses, or hands off
4. Verify integration when both streams converge
5. Be the only source of truth on cross-agent decisions

The two agents do **not** talk to each other. Everything they know about the other's work comes from you (or from committed files in git).

---

## Agent-A — Portfolio Templates (this agent)

**Branch:** main
**Status:** Phase complete; awaiting next directive
**Last commit:** `f0ad61f` — "Portfolio model: replace portfolio_models+layers with portfolio_templates (R010)"

### What Agent-A owns

- `db/library_schema/010_portfolio_templates.sql` (migration)
- `db/library_schema/seed/004_portfolio_templates.sql` (seed)
- `backend/internal/librarydb/list.go` — `ListPublishedModels`, `TemplateLayer` type
- `backend/internal/librarydb/fetch.go` — added `FetchTemplateByID` (saga bridge)
- `backend/internal/portfoliomodels/list.go` — wire DTO
- `backend/internal/portfoliomodels/adopt.go` — switched saga to `FetchTemplateByID`
- `app/(user)/portfolio-model/WizardModelCardList.tsx` — frontend consumption

### What Agent-A delivered

- Drops 7 old tables in `mmff_library` (portfolio_models + 5 children + shares)
- Replaces with single `portfolio_templates(id, name, description, layers JSONB)`
- Layers array index 0 = top tier; last = leaf — block order bug fixed structurally
- Adoption saga still works via synthesised Bundle from JSONB
- Backend compiles, TypeScript clean

### Open items for Agent-A

1. Apply migration `010` + seed `004` to **staging** and **production** library DBs (dev only so far)
2. Test end-to-end adoption flow against new schema (saga compiles but not exercised)
3. Planka cards 00165–00166 (Portfolio Settings page, padmin-only) still in Backlog
4. Delete superseded Planka cards 00158–00164 (dynamic workspace label stories)

### Agent-A constraints

- Knows portfolio domain deeply (saga, library DB, wizard UI)
- Has not touched vector DB schema or artefacts feature
- Has read access only to other agents' commits via git log

---

## Agent-B — Artefacts Three-Table Rewrite + Search Index Worker

**Branch:** main
**Status:** Phase complete; awaiting commit of remaining searchworker delta + 00157 doc
**Confirmed via Agent-B handoff** (`.claude/handoffs/artefacts-handoff.md` — content shared by user)

### Stories shipped (00151–00156)

- **00151** — `db/schema/060_artefact_schema_tables.sql`: drops 4-table pattern, creates 5 `*_schema` tables (one per Phase 1 artefact type), workspace-scoped via `UNIQUE(subscription_id, field_name)`
- **00152** — `db/schema/061_artefact_field_values_reshape.sql`: typed columns (`string_value`, `number_value`, `text_value`, `date_value`) + `schema_field_id` FK with `ON DELETE SET NULL`
- **00153/00154/00155** — `backend/internal/artefacts/` package: generic CRUD + schema mgmt + field values, mounted at `/api/artefacts/{type}` with padmin gate on schema mutations
- **00156** — `backend/internal/searchworker/worker.go` (NEW): outbox consumer, `FOR UPDATE SKIP LOCKED`, `pg_notify` wake-up + 5s polling fallback, Ollama embeddings via HTTP

### Important: commit reconciliation

Agent-B's handoff says *"final searchworker + main.go wiring not yet committed"* — but Agent-A **already committed `main.go` + artefacts package as `fa9b004`** on Agent-B's behalf to clear the working tree.

**When directing Agent-B next**, tell them:
- `fa9b004` already contains: `artefacts/handler.go`, `artefacts/service.go`, `artefacts/types.go`, the `main.go` route mount block (lines 462–488), and `cmd/server/main.go` artefactsH wiring
- They only need to commit: `searchworker/worker.go` + the *delta* in `main.go` for searchworker goroutine start (line ~565) + their handoff file

### Agent-B's open items

1. Commit searchworker delta + handoff (see above)
2. **Story 00157** — Samantha SDK fields API contract doc (NOT YET WRITTEN). Scope: `samantha.portfolio.renderField` options, getSchema/getValue/setValue, type-to-renderer map, `f_` prefix convention, staged-write flow, workspace scoping
3. Apply migrations 060/061 to staging/production (vector DB) when sync happens

### Agent-B operational notes (from their handoff)

- Worker requires Ollama running on `OLLAMA_URL` (default `http://localhost:11434`); if down, rows park at 5 attempts
- No retry backoff yet — failed rows retry immediately; flapping Ollama climbs counter fast
- Worker runs per backend instance; `SKIP LOCKED` prevents double-processing across replicas
- Adding a 6th artefact type requires updating BOTH `artefacts/types.go` registry AND `searchworker/worker.go` `coreTableMap`

---

## Conflict Surfaces

Files both agents may touch:

| File | Agent-A reason | Agent-B reason | Resolution |
|---|---|---|---|
| `backend/cmd/server/main.go` | None planned | Routes already wired | **Agent-A stays away** unless adopting saga changes routes |
| `db/schema/` | None — Agent-A only writes to `db/library_schema/` | Migrations 060/061 here | No collision |
| `db/library_schema/` | 010 + seed 004 written | Should not touch | No collision |
| `backend/internal/librarydb/` | Agent-A territory | Should not touch | No collision |
| `backend/internal/portfoliomodels/` | Agent-A territory | Should not touch | No collision |
| `backend/internal/artefacts/` | Should not touch | Agent-B territory | No collision |
| `backend/server` (binary) | Auto-rebuilt | Auto-rebuilt | Tracked file; ignore mtime noise |
| `MEMORY.md` | Reads + writes session restore entries | May write user/feedback memories | Each agent writes own files; index merges naturally |

**The one real conflict point is `main.go`.** Agent-B currently has wiring for artefacts. If Agent-A ever needs to add a route (e.g., for portfolio templates GET), it must merge against Agent-B's current state, not pre-Agent-B state.

---

## Database State Across Environments

| DB | Dev | Staging | Production |
|---|---|---|---|
| `mmff_library` (Agent-A's domain) | ✅ Has 010 migration + seed 004 | ❌ Old schema (portfolio_models still exists) | ❌ Old schema |
| `mmff_vector` (Agent-B's domain) | ✅ Has 060 + 061 (confirmed by Agent-B) | ❌ Old schema (4-table artefact pattern) | ❌ Old schema |

User has previously synced staging/prod to dev via `pg_dump -Fc` → `dropdb` → `pg_restore`. That sync was done **before** either set of migrations ran on dev, so staging/prod are behind on **both** databases.

**Next sync needs to push both DBs**, not just one.

**Tunnels:** Dev tunnel `localhost:5435`, staging `:5436`, prod `:5434`. Per active backend env marker in `.claude/CLAUDE.md`, current target is `dev`.

---

## Standing Hard Rules (apply to both agents)

These are user-imposed; both agents already follow them:

1. **No destructive git** without explicit user confirmation (`reset --hard`, `push --force`, `clean -f`, etc.)
2. **No new debt** — fix it now or surface it; standing register doesn't apply
3. **Card lifecycle** — every task moves Backlog → To Do → Doing → Completed in Planka
4. **Storify all layers** before starting (backend + frontend + migration + tests)
5. **7-gate story acceptance** — AIGEN + phase + feature + EST + RISK + description + 3 AC
6. **Auto mode is god state** — plan mode never blocks
7. **No browser alert/confirm/prompt** — in-page UI only
8. **Every button gets `.btn` + variant**

---

## Controls You Have

To direct Agent-A (this agent):

- Send a directive — agent picks it up next turn
- Ask for a status check on portfolio_templates / library DB state
- Order migration to staging/prod
- Order Planka card creation, transitions, or deletion
- Order an end-to-end adoption test
- Order memory writes (`<b> -<N> -C` snapshots)

To direct Agent-B (the other agent):

- You'll need their session ID or similar handle (not provided here)
- Confirm with the user how they want B addressed before issuing directives
- Until you can talk to B directly, treat their work as read-only history (committed files)

---

## Recommended Coordinator First Actions

1. **Read this file fully** — done if you're seeing this
2. **Read `.claude/handoffs/portfolio-templates-to-next-agent.md`** — Agent-A's technical handoff (full file-by-file detail)
3. **Read `git log -10 --oneline`** — see actual commit sequence
4. **Ask the user** — which agent should drive next, and what's the immediate goal?
5. **If migrations to staging/prod are next**, Agent-A is right tool — knows the saga, knows the dump/restore flow
6. **If artefacts work continues**, Agent-B drives — Agent-A doesn't know that codebase

---

## Decision Tree

```
Is the next task in mmff_library or portfolio domain?
├─ YES → Agent-A (this agent)
└─ NO
   ├─ Is it artefacts / mmff_vector schema?
   │  └─ YES → Agent-B
   └─ Is it cross-cutting (main.go, deployment, frontend shell)?
      └─ Coordinate: have one agent draft, other reviews via commit
```

---

## Files to Read for Full Context

- `.claude/CLAUDE.md` — project working practices
- `.claude/handoffs/portfolio-templates-to-next-agent.md` — Agent-A technical handoff
- `docs/c_story_index.md` — last issued story ID (currently 00170)
- `docs/c_backlog.md` — Planka card management
- `MEMORY.md` (in `~/.claude/projects/-Users-rick-...PM/memory/`) — auto-memory index

---

## Open Questions for the User

When you take over, you may want to ask:

1. Which agent drives next, and on what task?
2. Are staging/prod migrations urgent, or can they wait? (Both DBs behind now)
3. Should story 00157 (Samantha SDK fields API doc) be Agent-B's next task, or paused?
4. Should the `backend/server` binary be untracked from git (it's rebuilt on every backend run)?
5. Does the user want a single coordinated migration push (library 010+seed 004 AND vector 060/061 in one operation)?

---

You now have the full picture. Both agents are at safe pause points; the working tree is clean except for noise (binary + searchworker). Direct work from here.

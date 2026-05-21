# ⚠️ Active Refactor — ObjectTree V2

**Status:** IN PROGRESS — slices 0+1+2+3 complete, slice 4 next (drag/reparent rules to config)
**Owner:** Claude (working from Rick's main session)
**Active branch:** `refactor/objecttree-s3-chrome-to-kinds` (slice 3 — DenseGridHeader + ActionBar kind components, committed locally not yet pushed)
**Landed branches:** s0 (baseline), s1 (data hook), s2 (flyout shell), s3 (chrome kinds)
**Worktree:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector-refactor-objecttree-s0/`
**Plan:** [docs/c_c_objecttree_refactor_plan.md](docs/c_c_objecttree_refactor_plan.md)
**Started:** 2026-05-20

---

## What this file is for

A WIP flag at the repo root so any **other agent** working in this codebase can see, at a glance, which files are being actively refactored — and avoid touching them on `main` until the refactor lands. This file is deleted when the refactor merges.

If you are another agent and your task touches any file listed below: **stop, send a SendMessage to the human, ask whether to wait or coordinate.** Do not assume it is safe just because the file builds.

---

## The single-agent-ownership rule applies

Per the rule in [context/memory/c_workflow_rules.md](context/memory/c_workflow_rules.md): never spawn a second agent into a package another is currently or recently working — they adopt different mental models and break the seam. This refactor IS that "currently working" condition for everything below.

Origin of the rule: 2026-05-20 fields-domain incident where two agents wired the workspace-fields write API two different ways and the frontend imported names that didn't exist.

---

## Files I am claiming for this refactor

These are off-limits on `main` until each slice merges. The list grows slice by slice. When a slice lands on `main`, those files are released.

### Claimed for the WHOLE refactor (every slice touches these eventually)

- `app/components/ObjectTreeV2/**` — entire new directory, mine top to bottom
- `app/(user)/scope/page.tsx` — the dev harness page
- `docs/c_c_objecttree_refactor_plan.md` — the plan doc
- `docs/examples/p_wizard_workitems_v2.json` — schema example
- This file (`objectTreeRefactor.md`) — the WIP flag itself

### ~~Claimed by SLICE 1~~ — DONE (flat row store + window hook extraction)

- ✅ `app/components/ObjectTreeV2/hooks/useObjectTreeWindow.ts` (new) — landed
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — now consumes the new generic hook (V2 only; production ObjectTree untouched)
- ✅ `app/components/work-items-tree-config.tsx` — UNTOUCHED (production keeps using `useArtefactItemsWindow` here; the legacy hook stays)
- Note: the old artefact-coupled hook is NOT yet a "thin wrapper over the new one" as the plan called for. That migration happens when production swaps to V2 (Slice 6+). For now, two parallel paths.

### Claimed by SLICE 1.5 (plugin architecture, registries, context registry)

- `app/components/ObjectTreeV2/{registry,context,loader,ObjectTree}.ts(x)` (new)
- `app/components/ObjectTreeV2/{kinds,plugins,cells,flyouts}/**` (new subdirs)

### ~~Claimed by SLICE 2~~ — DONE (detail flyout shell + interaction contract)

- ✅ `app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout.tsx` (new)
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — now mounts the shell
- ✅ `app/components/ArtefactInlineForm/**` — UNTOUCHED. V2 wraps it in an inline `ArtefactBody` adapter; AIF's internals are still mounted via the legacy path for production pages.

### Claimed by SLICE 2.5 (backend `?fields=` contract — first backend touch)

- `backend/internal/artefactitems/handler.go` — add `?fields=` parsing
- `backend/internal/artefactitems/columns.go` (new) — per-resource column catalogue
- `backend/internal/portfolioitems/handler.go` — same parsing
- `backend/internal/portfolioitems/columns.go` (new)
- `backend/internal/timeboxsprints/handler.go` — same parsing
- `backend/internal/timeboxsprints/columns.go` (new)
- `backend/internal/timeboxreleases/handler.go` — same parsing
- `backend/internal/timeboxreleases/columns.go` (new)
- POSSIBLY `backend/cmd/server/main.go` — only if we add a new `GET /<resource>/columns` route (decision deferred to slice start)

### ~~Claimed by SLICE 3~~ — DONE (chrome to kind components)

- ✅ `app/components/ObjectTreeV2/kinds/DenseGridHeader.tsx` (new)
- ✅ `app/components/ObjectTreeV2/kinds/ActionBar.tsx` (new) — discriminated-union `CreateActionConfig` covers single + type-picker patterns
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — chrome JSX deleted, replaced with kind component mounts
- Panel kind deferred — `<Panel>` already exists as a project-wide primitive; V2 doesn't need its own variant.

### Claimed by SLICE 4 (drag/reparent rules into config)

- `app/components/ObjectTreeV2/plugins/DragEngine.tsx`
- Work-items config JSON (`p_wizard_workitems_v2.json`)

### Claimed by SLICE 4.5 (column selector)

- `app/components/ObjectTreeV2/plugins/ColumnPicker.tsx` (new)
- `app/components/ObjectTreeV2/hooks/useObjectTreeWindow.ts` — cache-merge logic

### Claimed by SLICE 4.6 (memoisation + cascade-scope reduction)

- ALL cell renderers in `app/components/ObjectTreeV2/cells/**` — React.memo audit
- `backend/internal/artefactitems/handler.go` — PATCH responses gain `touched_ids: string[]`
- POSSIBLY new `GET /<resource>/by-ids` endpoint and matching `main.go` route

### Claimed by SLICE 5 (timebox scope_propagation column)

- `backend/internal/{timeboxsprints,timeboxreleases}/{handler,service,sql}.go`
- `db/vector_artefacts/schema/0NN_*.sql` (new migration — number TBD)

### Claimed by SLICE 6 (sprint + release page swap)

- `app/(user)/sprints/page.tsx`
- `app/(user)/releases/page.tsx`
- New `app/components/TimeboxInlineForm/**`
- DELETE `app/components/TimeboxManager.tsx` and `app/hooks/useTimebox.ts` (after page swap proves green)

### Claimed by SLICE 7 (heartbeat UX)

- `TimeboxInlineForm` — propagation radio + inherited-row styling

### Claimed by SLICE 8 (milestones consolidation — optional)

- `app/(user)/milestones/page.tsx` (if exists)
- Possibly `backend/internal/timeboxmilestones/handler.go` (parity with 2.5)

---

## What other agents CAN safely work on

- Any path NOT listed above
- The ORIGINAL `app/components/ObjectTree/` (NOT the V2 directory) — production pages keep using it
- `app/(user)/work-items/page.tsx`, `app/(user)/portfolio-items/page.tsx`, `app/(user)/risk/page.tsx` — these stay on the legacy ObjectTree throughout the refactor; only swap to V2 in Slice 6+ AFTER coordination
- Any backend package NOT listed above
- All migrations not in the timebox space
- All docs not in the ObjectTree refactor plan

---

## Active branch / commits

```
refactor/objecttree-s0-baseline-and-tests
└── c77af29 feat(objecttree-v2): clone ObjectTree + /scope harness [solo-dev]
    (rebased onto main @ dbf1b98)
```

VSCode stays on `main`. The refactor lives in the sibling worktree directory. To work in it: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector-refactor-objecttree-s0"` — don't switch VSCode's branch.

---

## If you (other agent) absolutely need to touch something in my list

1. Don't.
2. If you really must, SendMessage to me first — the agentID for this work lives in the conversation context.
3. If I'm not active, leave a one-line note in this file under a new `## Held messages` section at the bottom with: the file you need, the change you need, and the reason. I'll handle it on my next turn.

---

## When this file gets deleted

Slice 8 merges (or the user decides to stop) → this file is removed in the same commit as the final slice. Until then, it stays at root as the load-bearing flag.

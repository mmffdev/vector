---
name: Flow-state seed model — kinds + is_pullable
description: Canonical 6-kind flow primitive + is_pullable flag; seed pill names align with kind values; PO-readiness deferred.
type: project
originSessionId: df609967-a682-4d82-9ea1-de98050b22cc
---
The flow-state model has **two orthogonal axes** plus six primitive kinds. Source of truth: scope entry FLOW1 in `Vector_Scope.md`.

## The two axes

| Axis | Column | Question it answers |
|---|---|---|
| Lifecycle | `flow_states.kind` | "Where in the lifecycle is this artefact?" |
| Team handoff | `flow_states.is_pullable` | "Can the team take this from this state right now?" |

## The six primitive kinds

`backlog | todo | in_progress | done | accepted | cancelled`

- **`backlog`** — pre-commitment, PO shaping zone, validation relaxed (DoR not enforced)
- **`todo`** — committed/shaped, not started; agnostic about pull-eligibility (compliance teams put gates here)
- **`in_progress`** — in flight
- **`done`** — done by the team
- **`accepted`** — accepted (often by PO/customer)
- **`cancelled`** — won't do

## Default seed (no compliance, agile baseline)

Pill name and kind align 1:1 in the seed — no mental remapping for new tenants:

| Pill (name) | kind | sort_order | is_initial | is_pullable |
|---|---|---|---|---|
| Backlog | `backlog` | 10 | true | false |
| To Do | `todo` | 20 | false | **true** |
| Doing | `in_progress` | 30 | false | false |
| Completed | `done` | 40 | false | false |
| Accepted | `accepted` | 50 | false | false |

8 transitions: 4 forward (Backlog → To Do → Doing → Completed → Accepted) + 4 back-steps.

## Compliance-gated tenant pattern

Multiple `kind='todo'` pills in a row, only the final one is pullable — the gate sits between them:

| Pill | kind | is_pullable |
|---|---|---|
| Backlog | `backlog` | false |
| To Do | `todo` | false |
| In Review | `todo` | false |
| Approved | `todo` | **true** |
| Doing | `in_progress` | false |
| ... | ... | ... |

Same schema, no special-casing.

## Why "Ready" was renamed to "To Do" in the seed

`Ready` carries pull-readiness connotations that compliance-gated teams reject (work can't be "Ready" before sign-off). `To Do` is neutral — just "not started". Tenants who want `Ready` rename deliberately. Pill name and kind label match (`To Do` ↔ `todo`) so the schema reads self-evidently.

## Pull-surface query (canonical)

```sql
WHERE flow_states.is_pullable = TRUE
   OR flow_states.kind IN ('in_progress','done','accepted')
```

OR clause keeps in-flight/done work visible on team boards even though those states aren't pullable (already pulled).

## PO-backlog query (canonical)

```sql
WHERE flow_states.kind = 'backlog'
   OR (flow_states.kind = 'todo' AND flow_states.is_pullable = FALSE)
```

Backlog zone + any compliance-gate `todo` pills sitting between backlog and the pullable one.

## Explicitly out of scope (FLOW1.4.1 — future)

Per-artefact `po_ready BOOLEAN` flag on the `artefacts` table. Visual aid for PO grooming, independent of which pill the artefact is in. Sort-to-top/badge UI. Optional DoR validation on toggle. **Do NOT bundle this into FLOW1.1–FLOW1.3.**

## Migration approach (FLOW1.1.3 / FLOW1.1.4)

Single migration `042_seed_kind_aligned_flow_pills.sql`:
1. Widen kind CHECK to 6 values.
2. Add `is_pullable BOOLEAN NOT NULL DEFAULT FALSE` column.
3. Re-seed default flows: rename `Ready → To Do` **in place** (preserves artefact FK refs); flip `Backlog.kind` from `todo` → `backlog`; set `is_pullable=TRUE` on the To Do pill.
4. Fold DE-Default + US-Default corruption repair into the same file: DELETE junk pills (TEST PILL, Lego, fwerrt, etc.); reset canonical pills' name/kind/sort_order/is_initial.
5. Idempotent guards so re-running is safe.

---
name: project-otv2-refactor-intent
description: "ObjectTreeV2 is intentionally being made stateless + generic — data in, render out, row type orthogonal. Don't claim coupling that the refactor was designed to remove."
metadata: 
  node_type: memory
  type: project
  originSessionId: 20efba71-f5d1-4a61-9ec1-4be66458518e
---

`<ObjectTreeV2>` was refactored (weeks before 2026-05-28) to be **stateless and row-type-generic** — data passed in, render comes out, the row shape is meant to be orthogonal to the component. The refactor genericised `useObjectTreeWindow<T>`, `ResourceTree<T>`, and `ObjectTreeDataConfig<T>` already; the orchestration layer in `p_ObjectTree.tsx` was not yet finished and still imports WorkItem-specific helpers (`buildWorkItemsColumns`, `useWorkItemsFilters`, `useWorkItemsSort`, `WorkItemsFilterChips`, `useWorkItemFlowStates`) directly. **Those imports are the unfinished part of the refactor, not the intended end state.**

**Why:** Rick is building OTV2 to be the canonical dense-grid primitive for every tabular admin surface in Vector (custom-fields, future: artefact-types admin, flow-states admin, role-permissions admin). A row-type-coupled OTV2 would force every new admin surface to either copy the chrome (drift) or fake a WorkItem shape (hack — fails the no-hacks hard rule). Genericising it finishes the refactor and unlocks every future admin grid for free.

**How to apply:** When asked to mount OTV2 on something that isn't WorkItem, **do not** propose:
- "Can't be done without a 1000-LOC refactor" (false — the inner generics are already there)
- "Adapt the row to look like a WorkItem" (hack — forbidden)
- "Build a parallel AdminGrid component" (lazy, creates drift)

**Do** propose: finish the prop-signature genericisation in `p_ObjectTree.tsx`, extract the WorkItem-specific orchestration (columns, filters, sort, patch, flow-states) into a per-data-type adapter behind an `ObjectTreeAdapter<T>` interface, leave the WorkItemsAdapter as the default so the 5 existing production mounts (work-items, portfolio-items, risk, value-sprint x2) keep working unchanged.

Spec: [[2026-05-28-objecttree-generic-rowtype-design]]. Related: [[user-stakeholder-foundation-mode]] — option B (finish the refactor) over option A (smallest patch).

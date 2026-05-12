---
name: feedback-shared-methods-home
description: Shared cross-runtime logic lives in app/lib/shared/<domain>/ + backend/internal/shared/<domain>/ with parity fixtures in dev/fixtures/shared/<domain>/; catalogue in docs/c_shared_methods.md
metadata:
  type: feedback
---

When writing logic that must produce identical output in two or more of {browser React, Node BFF Route Handler, Go public API}, place it under the shared substrate:

- **TS (cross-runtime):** `app/lib/shared/<domain>/<method>.ts` — no React imports, no Node-only APIs unless guarded.
- **Go:** `backend/internal/shared/<domain>/<method>.go` — pure logic, no HTTP wiring, no DB.
- **Parity fixtures:** `dev/fixtures/shared/<domain>/<method>.golden.json` — JSON golden used by both TS and Go test suites.
- **Catalogue:** append a row to `docs/c_shared_methods.md` (status: `experimental` → `evolving` → `stable`).

**Why:** Without a deliberate home, the second-occurrence drifts: a parallel utility appears in the consumer's folder, fixtures get skipped, the lint trio from PLA-0039 catches symptoms not causes. Established by PLA-0045 after PLA-0044 introduced the first three-surface shared method (the topology walker).

**How to apply:** When a new handler (`app/api/**/route.ts` or `backend/internal/**/handler.go`) needs logic that another surface also needs, write the shared core first (with fixture + parity tests), then both handlers become thin orchestrators that call it. The PostToolUse hook `.claude/hooks/shared-methods-reminder.sh` will nudge you when a new handler appears. If only one surface needs the logic, it does NOT belong in `shared/` — keep it local.

Related: [[reference-design-system]] for visual primitives. The lint allow-list at `dev/registries/shared_methods.json` permits `app/lib/shared/**` to be cross-imported from both `app/components/**` and `app/api/**/route.ts`.

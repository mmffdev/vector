# Shared Methods Catalogue

Single index of logic that is **deliberately re-used across more than one call surface** in Vector.

The three call surfaces are:

1. **Frontend React** — browser bundle, `app/components/**`, hooks, etc.
2. **BFF Next.js Route Handler** — Node runtime, `app/api/**/route.ts` (the `/_site` transport).
3. **Public Go API** — `backend/internal/**/handler.go` (the `/samantha/v2` transport).

A method qualifies as **shared** when at least two of those surfaces must produce identical output for identical input. Anything used in exactly one surface is not shared and does NOT belong in this catalogue.

See [`docs/c_c_transport_segregation.md`](c_c_transport_segregation.md) for the broader two-transport rule that motivates this catalogue.

---

## Where shared code lives

| Runtime | Path | Notes |
|---|---|---|
| TS (browser + Node) | `app/lib/shared/<domain>/` | Cross-runtime: must compile under both the browser bundle and Node 20 (used by Next.js Route Handlers). No React imports. No Node-only APIs (`fs`, `path`, etc.) unless guarded. |
| Go | `backend/internal/shared/<domain>/` | Pure-Go package, no HTTP wiring, no DB-specific code. Only domain logic. |
| Parity fixtures | `dev/fixtures/shared/<domain>/` | JSON golden files used by both TS and Go test suites to prove parity byte-for-byte. |

**Naming.** `<domain>` is a short noun matching the substrate the logic belongs to (e.g. `topology`, `flow`, `ranking`). One domain folder per substrate.

**Cross-import safety.** `app/lib/shared/**` is on the lint allow-list (`dev/registries/shared_methods.json`) so it can be imported from both `app/components/**` and `app/api/**/route.ts` without tripping `lint:writer-boundary` or `lint:transport-segregation`.

---

## Catalogue

| # | Domain | TS path | Go path | Fixtures | Status | Consumers | Plan |
|---|---|---|---|---|---|---|---|
| 1 | topology — walk & flatten | `app/lib/shared/topology/walker.ts` | `backend/internal/shared/topology/walker.go` | `dev/fixtures/shared/topology/` | live | `app/components/topology/layoutWithDagre.ts`, `app/components/topology/useTopologyTreeState.ts`, `app/components/TopologyTreeFlyout.tsx`, `app/components/ScopeRail.tsx`, `app/components/topology/UserNodeAssignment.tsx` (plus BFF `backend/internal/orgdesign/handler.go::Tree`) | [PLA-0044](../dev/plans/PLA-0044.md) |

---

## Adding a new shared method

1. **Confirm it qualifies.** Two or more of {browser React, Node BFF, Go API} must need identical output.
2. **Pick a domain.** Reuse an existing `<domain>` folder if the logic is in the same substrate; otherwise create a new one.
3. **Write TS first.** Place the file at `app/lib/shared/<domain>/<method>.ts`. No React imports. No Node-only APIs (or guard them behind `typeof window === "undefined"` checks).
4. **Write the parity fixture.** `dev/fixtures/shared/<domain>/<method>.golden.json` — input + expected output.
5. **Mirror in Go if needed.** If the public API surface needs it, write `backend/internal/shared/<domain>/<method>.go` and a Go test that loads the same fixture and asserts byte-identical output.
6. **Append a row** to the catalogue table above.
7. **Update memory.** If the domain is new and likely to grow, add a one-line note to `.claude/memory/feedback_shared_methods_home.md`.

---

## Conventions

- **No mutation of inputs.** Shared methods return new structures; they do not mutate their args.
- **No I/O.** No `fetch`, no DB, no `fs`. Pure functions only — orchestrators in the BFF / handler layer compose I/O around the shared core.
- **Generic over node shape.** Where the logic is structural (trees, graphs, ranking), accept generics + accessor funcs rather than locking to a concrete struct. See `walkTopology` in [PLA-0044](../dev/plans/PLA-0044.md) as the canonical example.
- **Status field meanings:**
  - `experimental` — first consumer is wiring; API can break.
  - `evolving` — two consumers; minor breaks allowed with a single-PR sweep.
  - `stable` — three or more consumers; breaking changes require an RFC.

---

## Related rules

- [`docs/c_c_transport_segregation.md`](c_c_transport_segregation.md) — two-transport rule.
- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — `lint:writer-boundary`, `lint:transport-segregation` allow-list lives in `dev/registries/shared_methods.json`.
- [`.claude/hooks/shared-methods-reminder.sh`](../.claude/hooks/shared-methods-reminder.sh) — PostToolUse soft-reminder fired when new `route.ts` or `handler.go` files appear.

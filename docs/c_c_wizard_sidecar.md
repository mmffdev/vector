# Wizard sidecar pattern (`p_wizard_*.json`)

Sidecar JSON drives data-shape, addressing, and backend wiring for [`<ObjectTree>`](../app/components/ObjectTree/p_ObjectTree.tsx) without touching component code. New domains adopt the substrate by adding a sidecar — they never fork the component.

## Files

- **Sidecars** — [`app/components/ObjectTree/configs/p_wizard_*.json`](../app/components/ObjectTree/configs/) — one per domain (`p_wizard_workitems.json`, `p_wizard_portfolio.json`, `p_wizard_strategy.json`).
- **Resolver** — [`app/lib/wizardLoader.ts`](../app/lib/wizardLoader.ts) — turns string component-name references into closures and column arrays.
- **Consumer** — [`app/components/ObjectTree/p_ObjectTree.tsx`](../app/components/ObjectTree/p_ObjectTree.tsx) — accepts a `wizardConfig` prop typed as [`ObjectTreeDataConfig`](../app/components/ObjectTree/p_ObjectTree.tsx).
- **Hook** — [`useArtefactItemsWindow`](../app/components/work-items-tree-config.tsx) (PLA-0037 / B21) — reads `resourceUrl` from the sidecar to drive apiV2 calls.

## Required keys

| Key | Type | Purpose |
|---|---|---|
| `dataType` | string | Identifier (`work_items`, `portfolio_items`, `strategy_items`). |
| `label` | string | Human label rendered in panel header / search placeholder fallback. |
| `searchPlaceholder` | string | Text input placeholder. |
| `ariaLabel` | string | Tree aria-label for accessibility. |
| `treeName` | string | Samantha addressable suffix (`workitems`, `portfolioitems`). |
| `resourceUrl` | string | apiV2 path prefix (`/work-items`, `/portfolio-items`). **Required** post-PLA-0037. |
| `scope` | `"work" \| "strategy"` | Backend scope discriminator hint. Drives diagnostics; routing is encoded by `resourceUrl`. |
| `dndResourceType` | string | Drag-and-drop resource identifier (`work_item`, `portfolio_item`). |
| `dndEnabled` | bool | Whether the tree shows drag handles. |
| `defaultSortKey` / `defaultSortDir` | string / `asc`/`desc` | Initial sort. |
| `paginationOptions` / `defaultPageSize` | number[] / number | Page-size chips. |
| `panelHeaderComponent` / `filterChipsComponent` | string | Component-name references; resolved by `wizardLoader`. |

## Backend wiring (PLA-0037 / B21)

`resourceUrl` ties the sidecar to a route group on the backend:

| `resourceUrl` | Server scope | Handler |
|---|---|---|
| `/work-items` | `scope='work'` | [`backend/internal/artefactitemsv2`](../backend/internal/artefactitemsv2/) |
| `/portfolio-items` | `scope='strategy'` | same handler, second `Service` instance with `scope="strategy"` |

Both endpoints are mounted from the same package via [`mountArtefactRoutes`](../backend/cmd/server/main.go) — any new endpoint added to one route group is registered against the other in the same edit. Scope leakage is pinned by [`TestScopeLeak_WorkServiceCannotSeeStrategyArtefacts`](../backend/internal/artefactitemsv2/service_test.go).

## Adding a new domain

1. Drop a `p_wizard_<domain>.json` next to the existing sidecars. Set `resourceUrl` and `scope` to match a backend route group.
2. If the backend doesn't yet expose the route group: add a second handler instance in [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) — re-use `mountArtefactRoutes`, never inline a fork.
3. Import the JSON in the page (e.g. `app/(user)/<domain>/list/page.tsx`), feed it through [`resolveWizardConfig`](../app/lib/wizardLoader.ts), and pass the result to `<ObjectTree wizardConfig={…} />`.
4. The sidecar is the only place that should know which apiV2 path the page reads. **Never hardcode `/work-items` or `/portfolio-items`** in the page — the sidecar drives.

## Anti-patterns

- Any `apiV2("/work-items…")` call outside [`useArtefactItemsWindow`](../app/components/work-items-tree-config.tsx) — that hook is the only sanctioned reader of artefact-item resources.
- A sidecar without `resourceUrl` — falls back to `mode === "portfolio_items"` heuristic, which is back-compat only and will be removed once every adopter migrates.
- A handler that hardcodes `scope='work'` in SQL — the field on `Service` is the single discriminator. See `lint:scope-literals` (planned, B21.3.4).

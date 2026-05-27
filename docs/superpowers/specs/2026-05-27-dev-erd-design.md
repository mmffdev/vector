# Dev ERD — Live + Snapshot Entity-Relationship Diagram

**Status:** Draft
**Date:** 2026-05-27
**Owner:** Rick
**Area:** FE-DEV-ERD (new sub-area of Dev Tools)
**Related:** SY003 (system substrate paper), `/dev/visualiser` (codegraph), `/dev/api-audit` (api-touchpoints)

---

## 1. Purpose

Give the dev/admin user a single live diagram of every table across both Vector databases
(`vector_artefacts` + `mmff_library`), their FK relationships, their soft cross-DB references,
and their grouping into product areas. The page must be both:

- **Live**: GET introspects pg catalogs on demand — always reflects whatever migrations have applied
- **Snapshot-able**: a button writes `dev/audits/erd.json` (committed to git, PR-diffable)

This mirrors the existing dual pattern used by `/dev/visualiser` (codegraph.json) and
`/dev/api-audit` (api-touchpoints.json).

**Non-goals:**

- Schema editing from the diagram (read-only)
- Inline migration generation
- Cross-tenant comparisons
- WebGL renderer (only if perf TD fires)

---

## 2. Scope

**Databases:** `vector_artefacts` (71 tenant tables, `vaPool`) + `mmff_library` (~12 library
tables, `libPools`) — rendered as a **single unified diagram** with a visual boundary line
between the two.

**Default view:** tables + FK edges only (compact). Columns expand in the right-side
Inspector when a node is clicked.

**Grouping:** product areas sourced from `dev/audits/system_areas.yaml` (the same taxonomy
used by `/dev/visualiser`). Tables not catalogued fall into an "Uncatalogued" group rather
than being hidden.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Frontend: dev/pages/DevErdPanel.tsx  (registered as /dev/erd) │
│  ┌──────────┬──────────────────────────────────┬─────────────┐ │
│  │ Filter   │   Cytoscape canvas (dagre)       │  Inspector  │ │
│  │ rail     │   - clusters per group           │  (columns,  │ │
│  │          │   - DB boundary line             │   FK counts)│ │
│  └──────────┴──────────────────────────────────┴─────────────┘ │
└─────────────────────────────┬──────────────────────────────────┘
                              │ fetch / POST
┌─────────────────────────────▼──────────────────────────────────┐
│  Backend: backend/internal/erd                                  │
│  - service.go     Service struct, vaPool + libPools, 60s cache │
│  - handler.go     GET (live) + POST (live + write snapshot)    │
│  - sql.go         pg catalog queries                            │
│  - groups.go      system_areas.yaml loader                      │
│  Mounted at:                                                    │
│    GET  /_site/admin/dev/erd       → live JSON                 │
│    POST /_site/admin/dev/erd       → live JSON + write file    │
│  Auth:  auth.RequirePermission(PortfolioList) — dev router      │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
       vector_artefacts                mmff_library
         (vaPool)                       (libPools)
       pg_catalog reads               pg_catalog reads
```

---

## 4. Wire Contract

### `GET /_site/admin/dev/erd`

Auth: in-browser via the existing dev-router perm-gate —
`auth.RequirePermission(permResolver, permissions.PortfolioList)` — the same gate
guarding `/dev/api-audit`, `/dev/codegraph`, etc. Curl/Scalar access uses the
seeded `DEV_API_KEY` Bearer token, which the perm middleware accepts equivalently.

Response (200):

```json
{
  "generated_at": "2026-05-27T03:45:00Z",
  "databases": [
    { "name": "vector_artefacts", "table_count": 71, "fk_count": 95 },
    { "name": "mmff_library",     "table_count": 12, "fk_count": 8  }
  ],
  "groups": [
    { "id": "sentinel",     "label": "Sentinel",     "source": "system_areas.yaml" },
    { "id": "topology",     "label": "Topology",     "source": "system_areas.yaml" },
    { "id": "artefacts",    "label": "Artefacts",    "source": "system_areas.yaml" },
    { "id": "uncatalogued", "label": "Uncatalogued", "source": "fallback" }
  ],
  "nodes": [
    {
      "id": "vector_artefacts.users",
      "database": "vector_artefacts",
      "table": "users",
      "group": "sentinel",
      "row_count": 142,
      "columns": [
        { "name": "users_id",      "type": "uuid", "is_pk": true,  "is_fk": false, "nullable": false },
        { "name": "users_email",   "type": "text", "is_pk": false, "is_fk": false, "nullable": false },
        { "name": "users_role_id", "type": "uuid", "is_pk": false, "is_fk": true,  "nullable": true  }
      ]
    }
  ],
  "edges": [
    {
      "id": "fk_users_role_id__users_roles_id",
      "from": "vector_artefacts.users",
      "to":   "vector_artefacts.users_roles",
      "from_column": "users_role_id",
      "to_column":   "users_roles_id",
      "kind": "hard_fk",
      "on_delete": "SET NULL"
    },
    {
      "id": "soft_artefacts_library_field_id",
      "from": "vector_artefacts.artefacts",
      "to":   "mmff_library.library_fields",
      "kind": "soft_ref",
      "evidence": "backend/internal/artefacts/service.go:412"
    }
  ]
}
```

### `POST /_site/admin/dev/erd`

Same payload as GET. Side effect: atomic write to `dev/audits/erd.json` (write to temp
file in same dir, then rename — no half-written file on crash). Returns 200 on success.

### Errors

- 401 — missing/invalid `DEV_API_KEY`
- 500 — pg query failure or yaml load failure (verbose error, dev-only)

---

## 5. Introspection Strategy

| Source | Used for |
|---|---|
| `pg_stat_user_tables` (per DB) | Tables + row count (cheap, no full COUNT(*)) |
| `information_schema.columns` + `table_constraints` (per DB) | Columns, types, nullable, PK flag |
| `pg_constraint` joined to `pg_attribute` (per DB) | Hard FKs, `ON DELETE`, multi-column FK support, self-references |
| **SY003** (`mmff_dev.dev_reports`) | Soft cross-DB refs (artefacts → mmff_library), evidence pointers |
| `dev/audits/system_areas.yaml` | Group assignment per table; fallback "Uncatalogued" |

**Caching:** 60-second in-process cache on the GET payload (column introspection is the
expensive part). POST always re-fetches before writing the snapshot.

**Performance budget:** GET <2s on dev with both DBs cold.

---

## 6. Frontend Panel Layout

`dev/pages/DevErdPanel.tsx` — three-column shell matching the existing `.dui-viz-shell`
convention from `DevVisualiserPanel`:

```
┌─────────────┬──────────────────────────────────────────┬──────────────┐
│ Filter rail │           Cytoscape canvas              │  Inspector   │
│  (220px)    │             (flex 1)                     │   (320px)    │
│             │                                          │              │
│ Databases   │   ┌───────────────────────────┐         │  Selected:   │
│  ☑ va       │   │ ░░░ Sentinel cluster ░░░  │         │  users       │
│  ☑ library  │   │  ▢ users ─→ ▢ users_roles │         │  ──────      │
│             │   │                            │         │  142 rows    │
│ Groups      │   │  ░░░ Topology cluster ░░░ │         │              │
│  ☑ sentinel │   │  ▢ topology_nodes ─→ ...  │         │  Columns:    │
│  ☑ topology │   │                            │         │  • users_id  │
│  ☑ artefacts│   │  ▢ artefacts ╌╌→ library_  │         │    PK uuid   │
│  ☑ uncatlg  │   │     fields  (soft ref)     │         │  • users_email│
│             │   └───────────────────────────┘         │    text      │
│ Edge kinds  │                                          │              │
│  ☑ hard FK  │   [⛶ Fit] [↻ Reload] [⤓ Snapshot]     │  FKs out: 3  │
│  ☑ soft ref │   [○ Live · 2026-05-27 03:45]          │  FKs in:  7  │
└─────────────┴──────────────────────────────────────────┴──────────────┘
```

**Cytoscape config:**
- Layout: `dagre`, rank direction `BT` (bottom-to-top) — root tables (those nothing
  references) at the bottom, leaf tables (those that only reference others) at the top;
  arrowheads point upward toward what each FK targets
- Nodes: rectangle, label = table name + row-count badge; background colour = group token
  (`--vector-sentinel`, `--vector-topology`, etc.)
- Edges: solid = hard FK, dashed = soft ref; arrowhead at "to" end
- Cluster boxes: Cytoscape `parent` nodes per group, nested under one parent per DB
- DB boundary: thick double-dashed line between the two DB parent nodes

**Interactions:**
- Click table → Inspector shows column list, PK/FK badges, FK-in/out counts, "Jump to
  SY003 entry" link
- Click edge → Inspector shows FK definition (from.col → to.col, `ON DELETE`, evidence
  if soft)
- Filter checkboxes hide nodes/edges live (no re-fetch)
- Toolbar:
  - **Fit** — re-center
  - **Reload** — re-GET live
  - **Snapshot** — POST → toast confirms `dev/audits/erd.json` written
- Header strip: live indicator (green dot + timestamp) or snapshot indicator (amber dot +
  filename + age)

**Styling:** all `.dui-*` per dev-UI primitives doc; no inline `style={{}}`. New CSS in
`dev/styles/dev-erd.css`.

---

## 7. Rail2 Nav Entry

Adding `/dev/erd` to the `dev_tools` rail follows the established pattern (mig 239
Reporting, mig 240 Visualiser).

**One new migration** in `db/mmff_vector/schema/`, next NNN resolved via `<migration>`
skill at implementation time (266 at time of writing). Grant scope mirrors **mig 239
(Reporting)** — all 6 system roles get read.

```sql
-- 266_dev_erd_page.sql
BEGIN;

WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES ('dev-erd', 'ERD', '/dev/erd', 'database', 'dev_tools', 'static', true, true, 18, NULL, NULL)
    ON CONFLICT (key_enum) WHERE (created_by IS NULL AND subscription_id IS NULL) DO NOTHING
    RETURNING id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT i.id, r.users_roles_id
  FROM inserted i, users_roles r
 WHERE r.users_roles_code IN ('grp_global','grp_portfolio','grp_product','grp_stakeholder','grp_team_lead','grp_team_member')
   AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
```

**Tab dispatch:** add to `app/(user)/dev/[tab]/page.tsx`:
- `TAB_TITLES["erd"] = "ERD"`
- `{tab === "erd" && <DevErdPanel />}`

---

## 8. File Map

### New

```
backend/internal/erd/
├── service.go          # Service struct, pool deps, 60s in-proc cache
├── service_test.go     # Unit tests: groupFor, parseColumns, parseEdges
├── handler.go          # GET + POST handlers, dev-key gate
├── handler_test.go     # Integration tests against live dev pools
├── sql.go              # pg catalog queries
├── groups.go           # system_areas.yaml loader
└── testdata/
    └── erd_response.golden.json

dev/pages/
├── DevErdPanel.tsx               # Three-column shell
├── DevErdCanvas.tsx              # Cytoscape mount + dagre layout
├── DevErdFilterRail.tsx          # DB/group/edge-kind toggles
├── DevErdInspector.tsx           # Right-side detail panel
└── __tests__/
    └── DevErdPanel.test.tsx

dev/styles/
└── dev-erd.css                   # `.dui-erd-*` classes

dev/audits/
└── erd.json                      # snapshot artefact (committed)

db/mmff_vector/schema/
├── 266_dev_erd_page.sql          # NNN resolved by <migration> at impl time
└── down/266_dev_erd_page_DOWN.sql
```

### Modified

```
backend/cmd/server/main.go             # mount /_site/admin/dev/erd GET + POST
app/(user)/dev/[tab]/page.tsx          # register "erd" tab → DevErdPanel
docs/c_scope.md                        # add FE-DEV-ERD live entry
docs/c_tech_debt.md                    # TD-ERD-LARGE-GRAPH-PERF, TD-ERD-SOFT-REF-EVIDENCE
docs/c_story_index.md                  # consume next story IDs
docs/c_plan_index.md                   # register PLA-NNNN
package.json                           # cytoscape, cytoscape-dagre, dagre
api-reference/static/siteAPI.yaml      # /_site/admin/dev/erd GET + POST contract
siteAPI.yaml                           # mirror
```

---

## 9. Testing

### Backend (Go)

- **Unit** — `groupFor(table)` resolution: known → correct group; unknown → "uncatalogued";
  YAML missing → fail loud (don't silently bucket everything).
- **Unit** — `parseColumns(pgRows)`: PK flag, FK flag, nullable, type normalisation
  (`character varying` → `text`).
- **Unit** — `parseEdges(pgConstraints)`: multi-column FK, `ON DELETE` captured,
  self-referencing FK (`topology_nodes_parent_id → topology_nodes_id`).
- **Integration** — `GET /_site/admin/dev/erd` against real `vaPool` + `libPools`:
  node count > 70, edge count > 90, no panic, <2s. Payload diffed against
  `testdata/erd_response.golden.json` (regenerated on intentional schema change).
- **Integration** — `POST /_site/admin/dev/erd`: writes `dev/audits/erd.json`, file
  matches GET payload, atomic write verified.
- **Auth gate** — request lacking `PortfolioList` permission → 401/403 (mirrors `/dev/api-audit` behaviour).
- **Cache** — second GET within 60s doesn't re-hit pg; after expiry refreshes.

### Frontend (Vitest)

- Three-column shell renders against a fixture JSON; jsdom skips Cytoscape mount.
- Filter toggles call the canvas wrapper with correct display flags (wrapper is mocked).
- Inspector renders PK/FK badges from a fixture node.
- Snapshot button POSTs (browser session-cookie auth, same as other dev pages); toast on success.

### Smoke (manual `<verify>`)

Open `http://localhost:3000/dev/erd`, confirm 71 va tables + 12 library tables visible,
FK edges rendered, snapshot click writes `dev/audits/erd.json` git-clean.

---

## 10. Acceptance Gates (`<stories>` 7-gate)

| Gate | Requirement |
|---|---|
| G1 | Story exists in `Vector_Scope.md` under new FE-DEV-ERD sub-area |
| G2 | PLA filed (≥3 stories: backend pkg, endpoints, frontend panel, migration+nav) |
| G3 | Tests written before impl (TDD via `<tdd>`) |
| G4 | Backend tests green, standard Go lints clean |
| G5 | Frontend tests green, `lint:no-raw-table` / `lint:page-description` clean |
| G6 | Manual smoke verified via `<verify>` |
| G7 | Snapshot endpoint produces stable diff-able `dev/audits/erd.json` (re-run = no diff if schema unchanged) |

---

## 11. Tech Debt Filed Upfront

| ID | Severity | Trigger | Note |
|---|---|---|---|
| `TD-ERD-LARGE-GRAPH-PERF` | S3 | dagre layout >500ms in dev | Switch Cytoscape to WebGL renderer if hit |
| `TD-ERD-SOFT-REF-EVIDENCE` | S2 | SY003 regenerated | ERD snapshot should be regenerated too — consider chaining `<report> -sy` to call POST |

---

## 12. Suggested PLA Shape

`PLA-ERD` — 4 stories, ~14pt total:

1. **ERD1** (5pt) — Backend `erd` package skeleton: SQL introspection, `groupFor`, unit tests
2. **ERD2** (3pt) — GET + POST handlers, integration tests, siteAPI contract, `main.go` mount
3. **ERD3** (3pt) — Frontend panel scaffold + Cytoscape + dagre against fixture
4. **ERD4** (3pt) — Filter rail + Inspector + Snapshot button + tests + `<verify>` smoke + mig 266 + rail2 nav

ERD1 + ERD3 parallelisable once the contract (Section 4) is locked.

---

## 13. Out of Scope (deferred)

- Schema editing from the diagram
- Inline ALTER generation
- Cross-tenant comparisons
- Auto-snapshot on migration apply (hook for `<migration>` skill — future)
- WebGL renderer (only if perf TD fires)

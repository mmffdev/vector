# Feature Areas — hierarchical label taxonomy

Every story card MUST carry exactly one feature label. Format:

- **Single domain:** `FE-AAA-0001` (e.g. `FE-DEV-0001`, `FE-SQL-0001`)
- **Domain + sub-domain:** `FE-AAA-BBB-0001` (e.g. `FE-POR-API-0001`, `FE-PAY-ITM-0001`)

The `-` separator is mandatory. 4-digit zero-padded counter is mandatory.

This is a **hard gate** — `<stories>` skill will not create a card without explicit area allocation.

---

## Complete feature areas (18 total)

### Product / User-Facing Features

| Code | Name | Scope | Typical Cards | Route | Notes |
|---|---|---|---|---|---|
| **POR** | Portfolio | Portfolio models, adoption flow, portfolio-scoped state, versioning | Model adoption, templates, wizards, model configuration, reset/unadopt | `/portfolio`, `/portfolio-model`, `/portfolio-settings` | Primary tenant orchestration |
| **LIB** | Library | MMFF-authored releases, templates, version management, release gating | Release channels, severity rendering, reconciler, audience targeting, gates | `/library-releases` | Read-only + gadmin gating |
| **ITM** | Items / Work Items | Work item types, state machines, custom fields, hierarchy, polymorphic writes | Item CRUD, state transitions, custom fields, type definitions, validators | `/backlog` (item view), `/dashboard` | Core schema + UI |
| **DAT** | Data / Graphs / Charts | Data visualization, graphing, charting, hierarchy rendering, visual analytics | Graph engine (DOM + SVG), tree views, charts, analytics dashboards, data export | `/dashboard`, graph canvas | Visual data representation |
| **UI** | User Interface | Components, layouts, pages, forms, styling, responsiveness, theming, accessibility | New pages, layouts, form validation, CSS themes, component library, spacing, typography | All pages; paired with feature | Client-side surfaces only |
| **UX** | User Experience | Navigation, workflows, interaction patterns, user flows, onboarding, usability | Navigation redesign, wizard flows, interaction improvements, accessibility, usability audits | Cross-page flows, sidebar, nav | User-centric design improvements |
| **SEC** | Security | Auth, encryption, RBAC, access control, compliance, audit logging, secrets | Login/logout, TOTP, API keys, permission gates, role enforcement, secret rotation, consent | `/login`, `/change-password`, role gates, audit logs | Product & system security |

### System / Internal Features

| Code | Name | Scope | Typical Cards | Notes |
|---|---|---|---|---|
| **GOV** | Governance | Feature flags, staged rollouts, canary deployments, A/B testing, kill switches, feature gates | Feature flag implementation, rollout strategies, kill switches, experiment management, gating rules | Control plane; infrastructure |
| **AUD** | Audit | Event logging, compliance logging, data lineage, change tracking, retention, reporting | Audit event schema, log aggregation, retention policies, compliance reports, audit trails | Infrastructure; compliance |
| **RED** | Redundancy | High availability, failover, replication, backup, disaster recovery, health checks | Backup automation, failover orchestration, replication logic, health check config | Infrastructure; ops |
| **RUL** | Rules & Logic | Business logic engines, validation rules, constraint enforcement, workflow orchestrators | Rule builders, validators, state machines, constraint checkers, orchestration logic | Core logic; pairs with feature |
| **API** | API / Endpoints | REST endpoints, GraphQL, payload schemas, error handling, versioning, cross-service contracts | New endpoints, schema changes at service boundary, error codes, middleware, response formats | Backend service surfaces; pairs with feature |
| **SQL** | Database / Schema | Migrations, DDL, constraints, indexes, data integrity, query optimization, referential patterns | New tables, column changes, FK patterns, constraints, performance tuning, migration tooling | Infrastructure; schema |
| **DCR** | Docker / Runtime | Container definitions, orchestration, deployment, CI/CD pipelines, infrastructure config | Dockerfile changes, compose updates, health checks, logging, monitoring, secrets provisioning | Infrastructure; infrastructure-as-code |
| **ALG** | Algorithm | Search, sort, matching, pathfinding, optimization, computational logic | Full-text search, ranking algorithms, path algorithms, matching algorithms, optimization | Core logic; pairs with feature |
| **DEV** | Developer Tooling | Internal debug UIs, test harnesses, seed scripts, planning docs, reference guides, test infrastructure | Dev gadmin pages, debug toggles, seed data, internal API docs, integration tests, performance tests | Not user-facing; `/dev/*` routes only |

---

## Feature area decision tree

**Start here: "What will the user / operator observe as done when this card ships?"**

### Layer 1: User-Facing vs System

**Is this directly observable by an end user?**

- **YES** → Continue to Layer 2 (Product Areas)
- **NO** → Continue to Layer 3 (System Areas)

---

### Layer 2: Product Areas (User-Facing)

1. **Is it a NEW PAGE or visible LAYOUT change?** → `UI` (user interface)
   - Example: "Add responsive breakpoints to dashboard" → UI
   - Example: "Implement theme switcher UI" → UI
   - Example: "Add pagination controls to item list" → UI

2. **Is it about the USER EXPERIENCE, navigation, or workflows?** → `UX` (user experience)
   - Example: "Redesign sidebar navigation grouping" → UX
   - Example: "Simplify portfolio adoption wizard flow" → UX
   - Example: "Add onboarding tour for new gadmins" → UX

3. **Is it DATA VISUALIZATION, charts, or graphs?** → `DAT` (data/graphs/charts)
   - Example: "Implement hierarchy tree visualization" → DAT
   - Example: "Add analytics dashboard with charts" → DAT
   - Example: "Render dependency graph with zoom/pan" → DAT

4. **Is it about PORTFOLIOS, MODELS, or tenant orchestration?** → `POR` (portfolio)
   - Example: "Portfolio model adoption saga (7-step wizard)" → POR
   - Example: "Portfolio theme application + cascade" → POR
   - Example: "Unadopt portfolio model from dev setup" → POR (gadmin reset feature)

5. **Is it about WORK ITEMS, STATES, or the core item system?** → `ITM` (items)
   - Example: "Add custom fields to work items" → ITM
   - Example: "Implement state transition validators" → ITM
   - Example: "Add item types and type-specific rules" → ITM

6. **Is it about LIBRARY RELEASES or version channels?** → `LIB` (library)
   - Example: "Add severity level enum to releases" → LIB
   - Example: "Implement release reconciler" → LIB
   - Example: "Add audience targeting to release gates" → LIB

7. **Is it SECURITY, AUTH, ENCRYPTION, or COMPLIANCE?** → `SEC` (security)
   - Example: "Implement TOTP 2FA" → SEC
   - Example: "Add role-based page gating" → SEC
   - Example: "Rotate secrets using AES-256-GCM" → SEC

---

### Layer 3: System Areas (Internal / Infrastructure)

1. **Does it require a NEW DATABASE MIGRATION or DDL change?** → `SQL` (database/schema)
   - Example: "Add item_key_aliases table + migration 027" → SQL
   - Example: "Add composite index on (subscription_id, created_at)" → SQL
   - Note: Schema work is always SQL, even if paired with an API endpoint

2. **Does it add a NEW REST ENDPOINT or change API contract?** → `API` (API/endpoints)
   - Example: "Add `/api/items/search` endpoint" → API
   - Example: "Bump API versioning, add deprecation headers" → API
   - Example: "Create `/api/portfolios/:id/unadopt` endpoint" → API
   - Note: If the endpoint serves a product feature, pair with feature area

3. **Is it DOCKER, DEPLOYMENT, or INFRASTRUCTURE CONFIG?** → `DCR` (Docker/runtime)
   - Example: "Add Dockerfile healthcheck" → DCR
   - Example: "Update docker-compose with sidecar logging service" → DCR
   - Example: "Implement secret provisioning in deployment" → DCR

4. **Is it FEATURE FLAGS, staged rollouts, or KILL SWITCHES?** → `GOV` (governance)
   - Example: "Add feature flag for new portfolio UI" → GOV
   - Example: "Implement canary deployment gate" → GOV
   - Example: "Add kill switch for experimental algorithm" → GOV

5. **Is it AUDIT LOGGING, compliance logging, or EVENT TRACKING?** → `AUD` (audit)
   - Example: "Add audit event schema for portfolio changes" → AUD
   - Example: "Implement compliance logging for data access" → AUD
   - Example: "Add change tracking for item state transitions" → AUD

6. **Is it REDUNDANCY, failover, HA, or BACKUP AUTOMATION?** → `RED` (redundancy)
   - Example: "Implement automatic database replication" → RED
   - Example: "Add failover orchestration logic" → RED
   - Example: "Backup automation + disaster recovery" → RED

7. **Is it VALIDATION RULES, CONSTRAINT ENFORCEMENT, or BUSINESS LOGIC?** → `RUL` (rules & logic)
   - Example: "Implement state transition validators" → RUL
   - Example: "Add constraint checker for polymorphic writes" → RUL
   - Example: "Implement workflow orchestrator" → RUL
   - Note: Logic paired with a product feature (e.g., ITM state machine) uses RUL

8. **Is it SEARCH, SORT, MATCHING, OPTIMIZATION algorithms?** → `ALG` (algorithm)
   - Example: "Implement full-text search with ranking" → ALG
   - Example: "Add pathfinding algorithm for hierarchy" → ALG
   - Example: "Implement fuzzy matching for item lookup" → ALG
   - Note: Core algorithm paired with a feature uses ALG, not the feature area

9. **Is it INTERNAL TOOLING, DEBUG, or PLANNING DOC?** → `DEV` (developer)
   - Example: "Dev gadmin page to reset adoption state" → DEV
   - Example: "Internal docs: portfolio action paths" → DEV
   - Example: "Debug toggle for feature flag X" → DEV
   - Example: "Integration test suite for portfolio adoption" → DEV

---

## The "pairs" rule

Some feature areas naturally pair with core product areas. When work spans both layers, **create separate cards**:

### API pairs with product features:
- Example: "Adopt portfolio model" splits into:
  - `POR0001` — Portfolio: implement adoption flow (frontend wizard + state orchestration)
  - `API0001` — API: create `/api/portfolios/:id/adopt` endpoint with payload schema
  - `SQL0001` — SQL: migration to add portfolio_model_adoption_state table

### RUL (business logic) pairs with product features:
- Example: "Item state machine with validation" splits into:
  - `ITM0001` — Items: add state transition UI and user-facing state machine
  - `RUL0001` — Rules: implement state transition validators and constraint checker

### ALG (algorithms) pair with product features:
- Example: "Search + ranking for items" splits into:
  - `ITM0001` — Items: add search input and result display
  - `ALG0001` — Algorithm: implement full-text search ranking logic

### DAT (data viz) pairs with product features:
- Example: "Graph visualization of portfolio hierarchy" splits into:
  - `POR0001` — Portfolio: add hierarchy visualization UI
  - `DAT0001` — Data: implement graph rendering engine

### UI / UX pairs with product features:
- When UI is minimal (buttons, labels), pair with feature (no separate UI card).
- When UI is substantial (new page, major redesign, responsive overhaul), split:
  - Feature card (POR/ITM/LIB/etc.)
  - `UI0001` — UI: implement layout, styling, responsiveness
  - `UX0001` — UX: optimize workflows, navigation

---

## Counter allocation (independent per area)

Each area starts at 0001 and increments independently:

| Area | Counter Format |
|---|---|
| POR | `FE-POR0001`, `FE-POR0002`, ... |
| LIB | `FE-LIB0001`, `FE-LIB0002`, ... |
| ITM | `FE-ITM0001`, `FE-ITM0002`, ... |
| DAT | `FE-DAT0001`, `FE-DAT0002`, ... |
| UI | `FE-UI0001`, `FE-UI0002`, ... |
| UX | `FE-UX0001`, `FE-UX0002`, ... |
| SEC | `FE-SEC0001`, `FE-SEC0002`, ... |
| GOV | `FE-GOV0001`, `FE-GOV0002`, ... |
| AUD | `FE-AUD0001`, `FE-AUD0002`, ... |
| RED | `FE-RED0001`, `FE-RED0002`, ... |
| RUL | `FE-RUL0001`, `FE-RUL0002`, ... |
| API | `FE-API0001`, `FE-API0002`, ... |
| SQL | `FE-SQL0001`, `FE-SQL0002`, ... |
| DCR | `FE-DCR0001`, `FE-DCR0002`, ... |
| ALG | `FE-ALG0001`, `FE-ALG0002`, ... |
| DEV | `FE-DEV0001`, `FE-DEV0002`, ... |
| POR-API | `FE-POR-API-0001`, `FE-POR-API-0002`, ... |
| POR-ITM | `FE-POR-ITM-0001`, `FE-POR-ITM-0002`, ... |

**Sub-domain codes** (`FE-AAA-BBB-0001`) scope work to a specific layer within a domain. Any valid 3-letter pair is allowed; propose + confirm before first use.

When a new counter is needed, propose the next sequential number; user confirms, allocate it, and add to the registry.

---

## Registry (Planka label IDs)

| Area | Label | Counter | Planka ID | Status | Notes |
|---|---|---|---|---|---|
| POR | `FE-POR0001` | 1/? | `1761991021719193091` | Active | Portfolio layer customisation (rename, reorder) |
| LIB | — | 0/? | — | Ready | Library releases |
| ITM | — | 0/? | — | Ready | Work items / state machines |
| DAT | — | 0/? | — | Ready | Data visualization / graphs |
| UI | `FE-UI0001` | 1/? | `1761472628301759780` | Active | Portfolio wizard + adoption pages |
| UI | `FE-UI0002` | 2/? | `1762058691722348184` | Active | Vector Design System facelift (all pages + components, branch: vector-rebrand-001) |
| UX | — | 0/? | — | Ready | User experience / workflows |
| SEC | `FE-SEC0001` | 1/? | `1760810747115341214` | Active | Security baseline |
| SEC | `FE-SEC0005` | 5/? | `1762205064870495730` | Active | Remote client access — MMFFDev admin login and dev panel access (PH-0020) |
| GOV | — | 0/? | — | Ready | Governance / feature flags |
| AUD | `FE-AUD0001` | 1/? | `1762012948181550696` | Active | Layer change audit logging |
| RED | — | 0/? | — | Ready | Redundancy / HA / backup |
| RUL | — | 0/? | — | Ready | Rules & logic / validators |
| API | `FE-API0001` | 1/? | `1761472630432466214` | Active | Portfolio adoption endpoints |
| API | `FE-API0002` | 2/? | `1761991023807956485` | Active | Layer batch rename/reorder endpoint |
| API | `FE-API0003` | 3/? | `1762013369910429311` | Active | Layer change history endpoint |
| API | `FE-API0004` | 4/? | `1762137672404436439` | Active | Samantha SDK — custom app developer API |
| API | `FE-API0005` | 5/? | `1762271935724521022` | Active | Navigation profile CRUD API |
| API | `FE-API0006` | 6/? | `1763620459506566186` | Active | User story CRUD API |
| API | `FE-API0007` | 7/? | `1763620460387370027` | Active | Defect CRUD API |
| SQL | `FE-SQL-0001` | 1/? | `1762271910986516028` | Active | Execution item migrations (user_stories, defects, item_labels, item_tags) |
| SQL | `FE-SQL-0002` | 2/? | `1763620456000128038` | Active | user_stories table migration |
| SQL | `FE-SQL-0003` | 3/? | `1763620456629273639` | Active | defects table migration |
| SQL | `FE-SQL-0004` | 4/? | `1763620458105668648` | Active | item_labels junction table migration |
| SQL | `FE-SQL-0005` | 5/? | `1763620458768368681` | Active | item_tags junction table migration |
| DCR | — | 0/? | — | Ready | Docker / runtime / infra |
| ALG | — | 0/? | — | Ready | Algorithms / search / matching |
| DEV | `FE-DEV0001` | 1/? | `1760909905369237242` | Active | Master debug toggle |
| DEV | `FE-DEV0002` | 2/? | `1761301483015374767` | Active | Planning docs (database mapping) |
| DEV | `FE-DEV0003` | 3/? | `1761469925852972291` | Active | Portfolio adoption action paths |
| DEV | `FE-DEV0004` | 4/? | `1762105753893602703` | Active | Service health panel (DevServicesPanel, DevStatusFloat, /api/dev/services) |
| POR-API | `FE-POR-API-0001` | 1/? | `1763600697053415384` | Active | Portfolio item metadata + custom fields API |
| POR-ITM | `FE-POR-ITM-0001` | 1/? | `1763600697623840729` | Active | Portfolio item rollup count materialisation |

---

## `<stories>` skill integration

**Step 0b — Feature area classification (BLOCKING, after story ID & phase):**

After allocating story IDs and phase, `<stories>` MUST:

1. Examine each story and classify it into exactly one area code using the decision tree.
2. Propose the classification to the user alongside the story approval list.
3. If a new area code is needed (rare), propose the next counter and ask for confirmation.
4. If the user disputes a classification, allow override: `"1:API 3:FRO"` to reassign cards 1 and 3.
5. Record `AREA_LABEL_ID` for each unique area in the batch before card creation.

**Example user approval prompt:**

```
Step 0b — Feature area classification:

1. Backend: archive old portfolio layers before adopting new model
   Area: SQL (migration + constraint logic)
   AC: ...

2. Backend: unadopt portfolio model from dev setup
   Area: API (new `/api/portfolios/:id/unadopt` endpoint)
   AC: ...

3. Dev doc: portfolio model adoption action paths
   Area: DEV (internal docs, no user-facing code)
   AC: ...

Approve all, or specify which numbers to create? [1,2,3]
Reclassify any? (e.g. "1:POR 2:FRO") or press Enter to proceed.
```

User confirms or overrides, then `<stories>` proceeds with Step 1 (dedup + parallel check).

---

## Hard rules (no exceptions)

1. **Every card gets exactly one area code.** If a story spans multiple areas, split it into multiple cards.
2. **Area codes are NOT optional.** If a story has no clear area, the skill stops and asks for clarification.
3. **Use the decision tree.** Start with Layer 1 (user-facing vs system), then Layer 2 or 3.
4. **Pairs must be separate cards.** API + feature, RUL + feature, ALG + feature, DAT + feature → two cards, two area labels.
5. **No catch-all areas.** Every area has a specific scope. If a story doesn't fit, ask the user.
6. **DEV is not a dumping ground.** DEV is for internal tooling and test infrastructure only — not general system work.

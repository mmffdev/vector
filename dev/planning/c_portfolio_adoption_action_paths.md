# Portfolio Model Adoption Action Paths

**Date:** 2026-04-26  
**Status:** Active (Phase 5 — CSS responsive design)  
**Scope:** Complete end-to-end tracing of portfolio-model adoption wizard from padmin trigger through final gadmin state.

This document traces every step, every API call, every database interaction, and every table mutation in the adoption saga. Read this to understand how the system moves from "no portfolio model selected" to "portfolio model fully adopted and ready to use."

---

## 0. Overview: The Adoption Flow

A **portfolio-model adoption** is a cross-database saga initiated by a padmin and orchestrated by the backend. It reads a complete portfolio-model bundle from `mmff_library` (MMFF-authored templates) and mirrors it into the tenant's `mmff_vector` schema so the tenant can use the model.

**Timeline:** Minutes (synchronous orchestration with progress streaming).

**Databases involved:**
- `mmff_vector` — tenant business data (primary)
- `mmff_library` — MMFF-authored content (read-only)

**Tables touched:**

| Database | Table | Operation | Purpose |
|---|---|---|---|
| mmff_vector | `subscriptions` | READ | confirm tenant exists |
| mmff_vector | `subscription_portfolio_model_state` | INSERT, UPDATE | track adoption state |
| mmff_vector | `subscription_layers` | INSERT | mirror portfolio layers |
| mmff_vector | `subscription_workflows` | INSERT | mirror workflows |
| mmff_vector | `subscription_workflow_transitions` | INSERT | mirror state transitions |
| mmff_vector | `subscription_artifacts` | INSERT | mirror artifact configs |
| mmff_vector | `subscription_terminology` | INSERT | mirror terminology overrides |
| mmff_vector | `pending_library_cleanup_jobs` | INSERT (on error) | enqueue cross-DB cleanup |
| mmff_vector | `error_events` | INSERT (on error) | log error for audit |
| mmff_library | `portfolio_models` | READ | fetch root bundle |
| mmff_library | `portfolio_model_layers` | READ | fetch layer hierarchy |
| mmff_library | `portfolio_model_workflows` | READ | fetch workflow definitions |
| mmff_library | `portfolio_model_workflow_transitions` | READ | fetch state transition rules |
| mmff_library | `portfolio_model_artifacts` | READ | fetch artifact configs |
| mmff_library | `portfolio_model_terminology` | READ | fetch terminology overrides |

---

## 1. Trigger: Padmin Login / Portfolio View (No Adoption Yet)

### 1.1 Page Load Detection

**Who:** Frontend (Next.js page component)  
**When:** Padmin logs in or navigates to `/portfolio` or `/portfolio-model`  
**Where:** `app/(user)/portfolio/page.tsx` or similar route

**What happens:**
1. Page mounts, calls `/api/portfolios/adoption-state` to fetch current adoption status
2. Backend queries: `SELECT * FROM subscription_portfolio_model_state WHERE subscription_id = $sub_id`
3. If result is empty (no rows), adoption hasn't started
4. Frontend detects empty state and auto-fires wizard modal

**Code pathways:**
- Frontend: `app/(user)/portfolio/page.tsx` → render → calls `useAdoptionState()` hook
- Backend: `backend/internal/handlers/adoption/get_state.go` → queries `subscription_portfolio_model_state`

**Database query:**
```sql
SELECT 
  id,
  subscription_id,
  status,
  adopted_model_id,
  adopted_model_version,
  started_at,
  completed_at,
  error_message
FROM subscription_portfolio_model_state
WHERE subscription_id = $1
ORDER BY started_at DESC
LIMIT 1;
```

**Result:** Empty result set → wizard fires.

---

## 2. Wizard Modal Render & Model Selection

### 2.1 Fetch Available Models

**Who:** Frontend (wizard modal component)  
**Endpoint:** `GET /api/portfolios/models`  
**Returns:** List of available portfolio models from `mmff_library`

**Backend implementation:** `backend/internal/handlers/adoption/list_models.go`

**Query against mmff_library:**
```sql
SELECT 
  id,
  model_family_id,
  version,
  name,
  description,
  published_by,
  published_at,
  archived_at
FROM portfolio_models
WHERE archived_at IS NULL
ORDER BY model_family_id, version DESC;
```

**Response (JSON):**
```json
[
  {
    "id": "uuid-1",
    "modelFamilyId": "family-1",
    "version": "1.0",
    "name": "Enterprise Portfolio Model",
    "description": "Suitable for large organizations with complex hierarchies",
    "publishedAt": "2026-03-15T00:00:00Z"
  },
  {
    "id": "uuid-2",
    "modelFamilyId": "family-2",
    "version": "1.2",
    "name": "Startup Portfolio Model",
    "description": "Lightweight model for small teams",
    "publishedAt": "2026-04-01T00:00:00Z"
  }
]
```

### 2.2 Padmin Selects & Confirms

**User action:** Clicks model → clicks Confirm button  
**Frontend:** Calls `POST /api/portfolios/adopt` with selection

**Payload:**
```json
{
  "modelFamilyId": "family-1",
  "version": "1.0"
}
```

---

## 3. Model Selection Endpoint: Validation & State Creation

### 3.1 Endpoint: POST /api/portfolios/adopt

**Handler:** `backend/internal/handlers/adoption/create_adoption.go`

**Step 1: Validate model exists in mmff_library (cross-DB lookup)**

Query:
```sql
SELECT id, model_family_id, version FROM portfolio_models
WHERE model_family_id = $1 AND version = $2 AND archived_at IS NULL;
```

If no row found: return **404 Not Found**.  
If found: record the `portfolio_models.id` (cross-DB foreign key).

**Step 2: Check subscription not already adopted**

Query:
```sql
SELECT id, status FROM subscription_portfolio_model_state
WHERE subscription_id = $1 AND status NOT IN ('failed', 'rolled_back');
```

If a row exists with status='in_progress' or 'completed': return **409 Conflict** ("Already adopted or in progress").

**Step 3: Insert adoption state record**

Insert into `mmff_vector`:
```sql
INSERT INTO subscription_portfolio_model_state (
  id,
  subscription_id,
  status,
  adopted_model_id,
  adopted_model_version,
  started_at
) VALUES (
  $1,           -- UUID (adoption_id)
  $2,           -- subscription_id from JWT
  'in_progress',
  $3,           -- portfolio_models.id from mmff_library
  $4,           -- version string
  NOW()
)
RETURNING id, subscription_id, status, adopted_model_id;
```

**Step 4: Start orchestrator (inline or async job)**

- If **inline:** call orchestrator synchronously within the same transaction
- If **async:** enqueue to a job queue (`pending_adoption_jobs` table, not yet designed)

For this doc, assume **inline orchestration** (synchronous, within same DB transaction).

**Response (200 OK):**
```json
{
  "adoptionId": "adoption-uuid-xyz",
  "adoptedModelId": "portfolio-models-uuid-1",
  "status": "in_progress",
  "streamUrl": "/api/portfolios/adoption-xyz/stream"
}
```

**Error responses:**
- `400 Bad Request` — missing or invalid payload
- `404 Not Found` — model not found in mmff_library
- `409 Conflict` — adoption already in progress or completed
- `500 Internal Server Error` — database or cross-DB lookup failed

---

## 4. Orchestrator: Walk Library Tree & Create Mirrors

### 4.1 Overview

**Orchestrator logic:** `backend/internal/handlers/adoption/orchestrate.go` (or similar)

**Goal:** Read the complete bundle from `mmff_library` and create mirror rows in `mmff_vector` adoption tables.

**Key insight:** The orchestrator walks a **tree structure**:
```
portfolio_models (root)
  └── portfolio_model_layers (children, may have parent_layer_id for nesting)
      └── portfolio_model_workflows (children of layers)
          └── portfolio_model_workflow_transitions (children of workflows)
  portfolio_model_artifacts (siblings of layers)
  portfolio_model_terminology (siblings of layers)
```

For each library row, the orchestrator creates a **mirror row** in the corresponding `subscription_*` table in `mmff_vector`.

### 4.2 Step 1: Read Portfolio Models Root

**Query mmff_library:**
```sql
SELECT id, model_family_id, version, name, description
FROM portfolio_models
WHERE id = $1;  -- $1 is the adopted_model_id from subscription_portfolio_model_state
```

**Record:** Fetch one root row. Note the `id` (library UUID).

### 4.3 Step 2: Read Layers (with hierarchy)

**Query mmff_library:**
```sql
SELECT 
  id,
  portfolio_models_id,
  parent_layer_id,
  position,
  name,
  description
FROM portfolio_model_layers
WHERE portfolio_models_id = $1  -- $1 is the portfolio_models.id
ORDER BY position;
```

**Result:** List of all layers for this model (e.g., 3–10 rows depending on model complexity).

**Example data:**
```
id: layer-uuid-1, parent_layer_id: NULL, name: "Strategic", position: 0
id: layer-uuid-2, parent_layer_id: NULL, name: "Portfolio", position: 1
id: layer-uuid-2-1, parent_layer_id: layer-uuid-2, name: "Sub-Portfolio A", position: 0
```

### 4.4 Step 3: Create Mirror Layers in mmff_vector

**For each library layer:**

Insert into `mmff_vector.subscription_layers`:
```sql
INSERT INTO subscription_layers (
  id,
  subscription_id,
  parent_layer_id,  -- IMPORTANT: references mirror parent, NOT library parent
  position,
  name,
  description,
  source_library_id,
  source_library_version
) VALUES (
  gen_random_uuid(),  -- NEW mirror UUID
  $1,                 -- subscription_id
  <mirror_parent_id or NULL>,  -- if parent_layer_id was NULL, this is NULL; else lookup mirror parent
  $2,                 -- position from library
  $3,                 -- name from library
  $4,                 -- description from library
  $5,                 -- library layer id (for reconciler)
  $6                  -- library version
);
```

**Key detail:** If library layer has `parent_layer_id = layer-uuid-2`, the orchestrator must:
1. Find the mirror UUID created for `layer-uuid-2` (via lookup in mirror rows created so far)
2. Set mirror `parent_layer_id` to that mirror UUID

This preserves the hierarchy in mmff_vector, but with new UUIDs.

**Side effect:** The orchestrator **remembers the mapping** (library UUID → mirror UUID) for later lookups.

```python
# In orchestrator code (pseudocode):
library_to_mirror_layers = {}
for lib_layer in library_layers:
    mirror_uuid = insert_mirror_layer(...)
    library_to_mirror_layers[lib_layer.id] = mirror_uuid
```

### 4.5 Step 4: Read Workflows (per layer)

**Query mmff_library:**
```sql
SELECT 
  id,
  portfolio_model_layers_id,
  position,
  name,
  is_default,
  description
FROM portfolio_model_workflows
WHERE portfolio_model_layers_id IN (
  SELECT id FROM portfolio_model_layers WHERE portfolio_models_id = $1
)
ORDER BY portfolio_model_layers_id, position;
```

**Result:** List of workflows grouped by layer.

### 4.6 Step 5: Create Mirror Workflows in mmff_vector

**For each library workflow:**

Insert into `mmff_vector.subscription_workflows`:
```sql
INSERT INTO subscription_workflows (
  id,
  subscription_id,
  layer_id,  -- References the MIRROR layer_id created in step 4.4
  position,
  name,
  is_default,
  description,
  source_library_id,
  source_library_version
) VALUES (
  gen_random_uuid(),  -- NEW mirror UUID
  $1,                 -- subscription_id
  <mirror_layer_id>,  -- Lookup from library_to_mirror_layers[library workflow.portfolio_model_layers_id]
  $2,                 -- position
  $3,                 -- name
  $4,                 -- is_default
  $5,                 -- description
  $6,                 -- library workflow id
  $7                  -- library version
);
```

**Side effect:** Remember mapping:
```python
library_to_mirror_workflows = {}
for lib_wf in library_workflows:
    mirror_uuid = insert_mirror_workflow(...)
    library_to_mirror_workflows[lib_wf.id] = mirror_uuid
```

### 4.7 Step 6: Read Transitions (per workflow)

**Query mmff_library:**
```sql
SELECT 
  id,
  portfolio_model_workflows_id,
  from_state_id,
  to_state_id,
  allowed_roles,
  description
FROM portfolio_model_workflow_transitions
WHERE portfolio_model_workflows_id IN (
  SELECT id FROM portfolio_model_workflows WHERE portfolio_model_layers_id IN (...)
)
ORDER BY portfolio_model_workflows_id;
```

### 4.8 Step 7: Create Mirror Transitions in mmff_vector

**For each library transition:**

Insert into `mmff_vector.subscription_workflow_transitions`:
```sql
INSERT INTO subscription_workflow_transitions (
  id,
  subscription_id,
  workflow_id,  -- References MIRROR workflow_id
  from_state_id,
  to_state_id,
  allowed_roles,
  description,
  source_library_id,
  source_library_version
) VALUES (
  gen_random_uuid(),  -- NEW mirror UUID
  $1,                 -- subscription_id
  <mirror_workflow_id>,  -- Lookup from library_to_mirror_workflows
  $2,                 -- from_state_id (may reference library state; mapping TBD)
  $3,                 -- to_state_id
  $4,                 -- allowed_roles
  $5,                 -- description
  $6,                 -- library transition id
  $7                  -- library version
);
```

### 4.9 Step 8: Read Artifacts & Terminology

**Artifacts query (mmff_library):**
```sql
SELECT 
  id,
  portfolio_models_id,
  artifact_type,
  is_enabled,
  config
FROM portfolio_model_artifacts
WHERE portfolio_models_id = $1;
```

**Terminology query (mmff_library):**
```sql
SELECT 
  id,
  portfolio_models_id,
  term_key,
  singular,
  plural,
  description
FROM portfolio_model_terminology
WHERE portfolio_models_id = $1;
```

### 4.10 Step 9: Create Mirror Artifacts & Terminology

**Artifacts insert (mmff_vector):**
```sql
INSERT INTO subscription_artifacts (
  id,
  subscription_id,
  artifact_type,
  is_enabled,
  config,
  source_library_id,
  source_library_version
) VALUES (...);
```

**Terminology insert (mmff_vector):**
```sql
INSERT INTO subscription_terminology (
  id,
  subscription_id,
  term_key,
  singular,
  plural,
  description,
  source_library_id,
  source_library_version
) VALUES (...);
```

---

## 5. Success Path: Mark Adoption Complete

### 5.1 Update subscription_portfolio_model_state

**After all mirror tables are populated:**

```sql
UPDATE subscription_portfolio_model_state
SET 
  status = 'completed',
  completed_at = NOW()
WHERE id = $1;  -- adoption_id
```

**What padmin sees:** Wizard modal closes, adoption completion page renders.  
**What gadmin sees:** Portfolio model is now available; subscription can use the adopted model.

---

## 6. Error Path: Adoption Failed

### 6.1 On orchestrator error (e.g., library table read fails)

**Update subscription_portfolio_model_state:**
```sql
UPDATE subscription_portfolio_model_state
SET 
  status = 'failed',
  error_message = $1,  -- error details
  completed_at = NOW()
WHERE id = $2;  -- adoption_id
```

**Insert error_events row (audit):**
```sql
INSERT INTO error_events (
  id,
  subscription_id,
  code,
  context,
  user_id,
  created_at
) VALUES (
  gen_random_uuid(),
  $1,  -- subscription_id
  'ADOPTION_ORCHESTRATOR_FAILED',
  jsonb_build_object(
    'adoptionId', $2,
    'errorMessage', $3,
    'adoptedModelId', $4
  ),
  $5,  -- user_id (padmin or NULL)
  NOW()
);
```

**Enqueue cleanup job (pending_library_cleanup_jobs):**
```sql
INSERT INTO pending_library_cleanup_jobs (
  id,
  subscription_id,
  payload,
  claimed_at,
  created_at
) VALUES (
  gen_random_uuid(),
  $1,  -- subscription_id
  jsonb_build_object(
    'adoptionId', $2,
    'action', 'delete_failed_adoption_mirrors',
    'tables', ARRAY['subscription_layers', 'subscription_workflows', ...]
  ),
  NULL,
  NOW()
);
```

**What padmin sees:** Wizard modal shows error message, offers retry option.

---

## 7. Progress Streaming (Optional, for real-time feedback)

### 7.1 SSE Endpoint: GET /api/portfolios/:adoptionId/stream

**Handler:** `backend/internal/handlers/adoption/stream_progress.go`

As each step completes, emit SSE event:

```
event: adoption-step
data: {"step": 1, "status": "completed", "message": "Reading model from library"}

event: adoption-step
data: {"step": 2, "status": "completed", "message": "Creating mirror layers"}

...

event: adoption-complete
data: {"status": "completed", "adoptedModelId": "...", "completedAt": "2026-04-26T...Z"}
```

**Frontend:** Opens SSE stream in wizard modal, updates progress bar as events arrive.

---

## 8. Final State: Gadmin Has Adoptable Portfolio Model

### 8.1 What gadmin can now do

After adoption completes, the subscription has:

- `subscription_portfolio_model_state.status = 'completed'`
- Mirror tables fully populated: `subscription_layers`, `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`, `subscription_terminology`
- Model ready to use in portfolio stack operations

**Gadmin next steps (outside adoption scope):**
- Create portfolios using the adopted model layers
- Assign workflows to items in the portfolio
- Use adoption-provided terminology and artifacts

---

## 9. Cross-DB Pointers & Reconciliation

### 9.1 source_library_id & source_library_version

Every mirror row carries:
- `source_library_id` — UUID of library row
- `source_library_version` — version of the portfolio model

**Purpose:** Future reconciler (not yet implemented) can:
1. Walk library rows
2. Find corresponding mirror rows via `source_library_id`
3. Detect orphans (mirrors with no library row) → delete
4. Detect divergence (library changed, mirror didn't) → alert/update

---

## 10. Appendix: Column Mappings

### 10.1 subscription_layers ← portfolio_model_layers

| Mirror Column | Library Column | Transformation |
|---|---|---|
| `id` | — | New UUID (gen_random_uuid) |
| `subscription_id` | — | From JWT (constant) |
| `parent_layer_id` | `parent_layer_id` | Lookup in library_to_mirror_layers, or NULL |
| `position` | `position` | Direct copy |
| `name` | `name` | Direct copy |
| `description` | `description` | Direct copy |
| `source_library_id` | `id` | Direct copy (for reconciler) |
| `source_library_version` | — | From portfolio_models.version (constant) |

### 10.2 subscription_workflows ← portfolio_model_workflows

| Mirror Column | Library Column | Transformation |
|---|---|---|
| `id` | — | New UUID |
| `subscription_id` | — | From JWT |
| `layer_id` | `portfolio_model_layers_id` | Lookup in library_to_mirror_layers |
| `position` | `position` | Direct copy |
| `name` | `name` | Direct copy |
| `is_default` | `is_default` | Direct copy |
| `description` | `description` | Direct copy |
| `source_library_id` | `id` | Direct copy |
| `source_library_version` | — | From portfolio_models.version |

### 10.3 subscription_workflow_transitions ← portfolio_model_workflow_transitions

| Mirror Column | Library Column | Transformation |
|---|---|---|
| `id` | — | New UUID |
| `subscription_id` | — | From JWT |
| `workflow_id` | `portfolio_model_workflows_id` | Lookup in library_to_mirror_workflows |
| `from_state_id` | `from_state_id` | Direct copy (or mapped via state vocabulary) |
| `to_state_id` | `to_state_id` | Direct copy |
| `allowed_roles` | `allowed_roles` | Direct copy |
| `description` | `description` | Direct copy |
| `source_library_id` | `id` | Direct copy |
| `source_library_version` | — | From portfolio_models.version |

### 10.4 subscription_artifacts ← portfolio_model_artifacts

| Mirror Column | Library Column | Transformation |
|---|---|---|
| `id` | — | New UUID |
| `subscription_id` | — | From JWT |
| `artifact_type` | `artifact_type` | Direct copy |
| `is_enabled` | `is_enabled` | Direct copy |
| `config` | `config` | Direct copy (JSONB) |
| `source_library_id` | `id` | Direct copy |
| `source_library_version` | — | From portfolio_models.version |

### 10.5 subscription_terminology ← portfolio_model_terminology

| Mirror Column | Library Column | Transformation |
|---|---|---|
| `id` | — | New UUID |
| `subscription_id` | — | From JWT |
| `term_key` | `term_key` | Direct copy |
| `singular` | `singular` | Direct copy |
| `plural` | `plural` | Direct copy |
| `description` | `description` | Direct copy |
| `source_library_id` | `id` | Direct copy |
| `source_library_version` | — | From portfolio_models.version |

---

## 11. Code References

| Component | File | Responsibility |
|---|---|---|
| Endpoint: GET /api/portfolios/adoption-state | `backend/internal/handlers/adoption/get_state.go` | Fetch current adoption state |
| Endpoint: GET /api/portfolios/models | `backend/internal/handlers/adoption/list_models.go` | List available models |
| Endpoint: POST /api/portfolios/adopt | `backend/internal/handlers/adoption/create_adoption.go` | Validate model, create state, trigger orchestrator |
| Orchestrator | `backend/internal/handlers/adoption/orchestrate.go` | Walk library tree, create mirror rows |
| Progress stream | `backend/internal/handlers/adoption/stream_progress.go` | SSE endpoint for progress |
| Frontend wizard | `app/(user)/portfolio/components/AdoptionWizard.tsx` | Modal UI, state detection, calls endpoints |
| Completion page | `app/(user)/portfolio/components/AdoptionComplete.tsx` | Shows adopted model details |
| Frontend hook | `app/lib/hooks/useAdoptionState.ts` | Fetches and watches adoption state |

---

## 12. Testing Checklist

- [ ] Adoption state detection fires wizard modal when no adoption exists
- [ ] Model list endpoint returns available models from mmff_library
- [ ] Adoption endpoint validates model exists (cross-DB lookup)
- [ ] Adoption endpoint creates subscription_portfolio_model_state row
- [ ] Orchestrator successfully reads all library tables
- [ ] Orchestrator creates all mirror rows with correct hierarchy preservation
- [ ] source_library_id is correctly carried in all mirror rows
- [ ] Adoption completes: status → 'completed', no errors logged
- [ ] Progress stream emits events as orchestrator proceeds (if implemented)
- [ ] Error path: status → 'failed', error_events row created, cleanup job enqueued
- [ ] Completion page renders with model details after adoption completes
- [ ] Dev reset tool empties all adoption tables (story 00054)

---

## 13. Known Gaps & Future Work

| Gap | Impact | Mitigation |
|---|---|---|
| Reconciler (cross-DB orphan detection) | Divergence between library and mirrors not detected | Monitoring/alerts TBD |
| Async orchestration | Currently inline; blocks endpoint response | Consider job queue for large bundles |
| State mapping (from_state_id / to_state_id) | How library states map to mirror states unclear | Clarify in states.md |
| Rollback on partial failure | If orchestrator fails mid-tree, partial mirrors left behind | Wrap in transaction or implement compensating actions |

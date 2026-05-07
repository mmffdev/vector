# PLA-0024 — `subscriptions` → `master_record_tenant` cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the codebase off `subscriptions` and onto `master_record_tenant.tenant_id` as the canonical tenant identity, with zero data loss and reversibility at every phase boundary.

**Architecture:** One atomic DB migration renames every FK column and creates a transitional `subscriptions` view (so unmigrated app code keeps reading). Backend and frontend then migrate package-by-package against the new column name. After all callers flip, the view is dropped and the legacy table is deleted.

**Tech Stack:** PostgreSQL (mmff_vector + mmff_library), Go (backend services + migration tool), Next.js / TypeScript (frontend + v2 API routes), Python (lint rules under `dev/scripts/`).

**Spec:** [`docs/superpowers/specs/2026-05-07-subscriptions-to-master-record-tenant-cutover-design.md`](../specs/2026-05-07-subscriptions-to-master-record-tenant-cutover-design.md).

---

## Pre-flight (before Task 1)

- [ ] **Confirm the working DB env is `dev`.** The HARD RULE pins backend to `dev`; this plan assumes that. Run `curl -s localhost:5100/api/env` and verify `env: "dev"`.
- [ ] **Take a backup** before Task 1: `pg_dump -h localhost -p 5435 -U mmff_dev mmff_vector > /tmp/pla-0024-pre-cutover-vector.sql` and same for `mmff_library`. The Phase 1 migration is reversible via the DOWN script, but the backup is the safety net of last resort.

---

## Phase 1 — DB cutover (1 task)

### Task 1: Atomic DB migration `129_subscriptions_to_master_record_tenant.sql`

**Files:**
- Create: `db/schema/129_subscriptions_to_master_record_tenant.sql`
- Create: `db/schema/down/129_subscriptions_to_master_record_tenant_DOWN.sql`
- Create: `db/library_schema/008_subscriptions_to_master_record_tenant.sql`
- Create: `db/library_schema/down/008_subscriptions_to_master_record_tenant_DOWN.sql`
- Modify: `docs/c_schema.md` (add migration row)

- [ ] **Step 1: Enumerate the live `subscriptions` columns**

The transitional view must mirror every original column. Capture the source-of-truth column list:

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "\d subscriptions"
```

Record the column list in a temporary scratchpad — used by step 3.

- [ ] **Step 2: Confirm the 36 vector tables holding `subscription_id`**

Cross-check the impact map list with the live DB:

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "SELECT table_name FROM information_schema.columns WHERE column_name = 'subscription_id' ORDER BY 1;"
```

Expected: ~37 rows (36 vector tables + `users`). Any drift between this list and the spec means the spec is stale — abort and update the spec first.

- [ ] **Step 3: Write `129_subscriptions_to_master_record_tenant.sql`**

Single transaction. Skeleton:

```sql
-- 129_subscriptions_to_master_record_tenant.sql
-- Atomic cutover: rename subscription_id → tenant_id on every FK table,
-- retarget FKs to master_record_tenant(tenant_id), preserve subscriptions
-- as a read-only view for unmigrated app code, retain physical legacy
-- table as _subscriptions_legacy for DOWN safety.

BEGIN;

-- 1. Free master_record_tenant.tenant_id from its FK to subscriptions
ALTER TABLE master_record_tenant
  DROP CONSTRAINT master_record_tenant_tenant_id_fkey;

-- 2. Rename subscriptions → _subscriptions_legacy
ALTER TABLE subscriptions RENAME TO _subscriptions_legacy;

-- 3. For each of the 36 FK tables: drop FK, rename col, add new FK
--    Use a DO block to keep this readable. Preserve original ON DELETE.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT tc.table_name, tc.constraint_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND kcu.column_name = 'subscription_id'
       AND tc.table_name <> '_subscriptions_legacy'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', rec.table_name, rec.constraint_name);
    EXECUTE format('ALTER TABLE %I RENAME COLUMN subscription_id TO tenant_id', rec.table_name);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES master_record_tenant(tenant_id) ON DELETE %s',
      rec.table_name,
      rec.table_name || '_tenant_id_fkey',
      rec.delete_rule
    );
  END LOOP;
END $$;

-- 4. Rename indexes that include subscription_id in their name
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT indexname, tablename FROM pg_indexes
     WHERE indexname LIKE '%subscription_id%'
       AND schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      rec.indexname,
      replace(rec.indexname, 'subscription_id', 'tenant_id')
    );
  END LOOP;
END $$;

-- 5. Recreate `subscriptions` as a read-only view over master_record_tenant
--    Enumerate columns from step 1 — replace the placeholder block below
--    with the actual column list. Map old name → new name.
CREATE VIEW subscriptions AS
  SELECT
    tenant_id              AS id,
    tenant_name            AS name,
    -- … enumerate every original subscriptions column here, mapping
    -- master_record_tenant.tenant_<x> → x where applicable …
    tenant_created_at      AS created_at,
    tenant_updated_at      AS updated_at,
    tenant_archived_at     AS archived_at
  FROM master_record_tenant;

-- 6. Rebuild any trigger functions that referenced `subscription_id`.
--    Audit by:
--      SELECT proname FROM pg_proc WHERE prosrc ILIKE '%subscription_id%';
--    Each match needs CREATE OR REPLACE FUNCTION updating internal refs.
--    (Add explicit CREATE OR REPLACE blocks here per match.)

COMMIT;
```

Replace the placeholder column list in step 5 with the actual column enumeration from step 1. Replace the comment block in step 6 with explicit `CREATE OR REPLACE FUNCTION` blocks for each matched trigger function.

- [ ] **Step 4: Write the paired DOWN script**

```sql
-- db/schema/down/129_subscriptions_to_master_record_tenant_DOWN.sql
BEGIN;

DROP VIEW subscriptions;
ALTER TABLE _subscriptions_legacy RENAME TO subscriptions;

-- Reverse the per-table FK rename loop, mirror of step 3 but with the
-- column going tenant_id → subscription_id and FK pointing back to
-- subscriptions(id). Same DO block shape.

-- Restore the master_record_tenant FK to subscriptions(id).
ALTER TABLE master_record_tenant
  ADD CONSTRAINT master_record_tenant_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES subscriptions(id);

-- Reverse the index rename loop.
-- Reverse the trigger-function rebuilds (CREATE OR REPLACE back to
-- pre-129 bodies — keep the originals at hand from step 6 of UP).

COMMIT;
```

- [ ] **Step 5: Write the paired library migration `008_subscriptions_to_master_record_tenant.sql`**

```sql
-- db/library_schema/008_subscriptions_to_master_record_tenant.sql
-- Library schema rename: app-enforced FKs to mmff_vector.subscriptions
-- become app-enforced FKs to mmff_vector.master_record_tenant. No DB
-- FK exists, so this is a pure column rename.

BEGIN;

ALTER TABLE portfolio_models       RENAME COLUMN owner_subscription_id   TO owner_tenant_id;
ALTER TABLE portfolio_model_shares RENAME COLUMN grantee_subscription_id TO grantee_tenant_id;
ALTER TABLE release_channel        RENAME COLUMN audience_subscription_ids TO audience_tenant_ids;

-- Rename indexes
ALTER INDEX idx_portfolio_models_owner RENAME TO idx_portfolio_models_owner_tenant;
-- … any other indexes with subscription_id in the name in mmff_library …

COMMIT;
```

DOWN reverses these three RENAMEs.

- [ ] **Step 6: Dry-run the vector migration**

```bash
go run ./backend/cmd/migrate -dry-run -db vector
```

Expected output: lists the new migrations 129 (and 130 if any) as pending, prints the SQL bodies, NO database state change. If the dry-run output mentions any unexpected table or any unrenamed column, abort.

- [ ] **Step 7: Apply the vector migration**

```bash
go run ./backend/cmd/migrate -db vector
```

Expected: `applied: 129_subscriptions_to_master_record_tenant.sql`. No errors.

- [ ] **Step 8: Verify with catalog queries**

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -c "
    SELECT count(*) AS remaining_subscription_id_cols
      FROM information_schema.columns
     WHERE column_name = 'subscription_id'
       AND table_name <> '_subscriptions_legacy';
    SELECT count(*) AS new_tenant_id_fks
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
     WHERE kcu.column_name = 'tenant_id';
    SELECT * FROM subscriptions LIMIT 1;
  "
```

Expected: `remaining_subscription_id_cols = 0`, `new_tenant_id_fks ≥ 36`, the `SELECT * FROM subscriptions` returns one row through the view.

- [ ] **Step 9: Apply the library migration and verify**

```bash
go run ./backend/cmd/migrate -db library
```

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_library -c "
    SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('portfolio_models','portfolio_model_shares','release_channel')
       AND column_name LIKE '%tenant%' ORDER BY 1;"
```

Expected: shows `owner_tenant_id`, `grantee_tenant_id`, `audience_tenant_ids`.

- [ ] **Step 10: Smoke-test the live app via the existing tenant-settings page**

The tenant-settings page reads/writes `master_record_tenant` directly and is unaffected by the rename. Open `/workspace-settings/organization`, change a value, click Accept changes. Expected: 200 OK, value persists. This proves the trigger function rebuilds and the FK retargeting did not break the existing PATCH flow.

- [ ] **Step 11: Update `docs/c_schema.md`**

Add a row to the migration list:

```
| 129 | `db/schema/129_subscriptions_to_master_record_tenant.sql` | Atomic rename of all `subscription_id` FKs to `tenant_id`; retargets FKs to `master_record_tenant`; preserves `subscriptions` as a read-only view |
```

And add a note to the `subscriptions` section indicating its physical table is now `_subscriptions_legacy` and the name `subscriptions` is a view.

- [ ] **Step 12: Commit**

```bash
git add db/schema/129_*.sql db/schema/down/129_*.sql \
        db/library_schema/008_*.sql db/library_schema/down/008_*.sql \
        docs/c_schema.md
git commit -m "feat(PLA-0024/00476): db — atomic subscriptions → master_record_tenant cutover + view"
```

---

## Phase 2 — Auth boundary (3 tasks)

### Task 2: Backend auth — `User.TenantID` + JWT claim flip with grace

**Files:**
- Modify: `backend/internal/auth/tokens.go`
- Modify: `backend/internal/auth/service.go`
- Modify: `backend/internal/auth/handler.go`
- Modify: `backend/internal/auth/middleware.go`
- Modify: `backend/internal/models/user.go` (or wherever `User` lives)
- Modify: `backend/internal/auth/tokens_test.go`
- Modify: `backend/internal/auth/service_test.go`

- [ ] **Step 1: Write a failing test for both-claim-shape grace acceptance**

Add to `backend/internal/auth/tokens_test.go`:

```go
func TestParseAccessToken_AcceptsLegacySubscriptionIDClaim(t *testing.T) {
    // Token issued with the OLD claim name `subscription_id` must still
    // parse cleanly into AccessClaims.TenantID.
    raw := mintTokenWithClaim(t, "subscription_id", "00000000-0000-0000-0000-000000000001")
    claims, err := ParseAccessToken(raw, testKey)
    if err != nil {
        t.Fatalf("expected legacy-claim token to parse, got %v", err)
    }
    if claims.TenantID.String() != "00000000-0000-0000-0000-000000000001" {
        t.Fatalf("expected tenant_id from legacy claim, got %s", claims.TenantID)
    }
}

func TestParseAccessToken_AcceptsNewTenantIDClaim(t *testing.T) {
    raw := mintTokenWithClaim(t, "tenant_id", "00000000-0000-0000-0000-000000000002")
    claims, err := ParseAccessToken(raw, testKey)
    if err != nil { t.Fatal(err) }
    if claims.TenantID.String() != "00000000-0000-0000-0000-000000000002" {
        t.Fatalf("expected tenant_id from new claim, got %s", claims.TenantID)
    }
}
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
go -C backend test ./internal/auth/... -run AccessToken -v
```

Expected: FAIL — `AccessClaims` has no `TenantID` field; the parser only knows `subscription_id`.

- [ ] **Step 3: Rename `SubscriptionID` → `TenantID` on `AccessClaims` and `User`**

In `backend/internal/auth/tokens.go`:

```go
type AccessClaims struct {
    UserID   uuid.UUID `json:"sub"`
    TenantID uuid.UUID `json:"tenant_id"`
    Role     string    `json:"role"`
    // … existing fields …
}

// UnmarshalJSON: accept both `tenant_id` (new) and `subscription_id` (legacy)
func (c *AccessClaims) UnmarshalJSON(data []byte) error {
    type wire struct {
        UserID         uuid.UUID `json:"sub"`
        TenantID       uuid.UUID `json:"tenant_id"`
        SubscriptionID uuid.UUID `json:"subscription_id"`
        Role           string    `json:"role"`
        // … rest …
    }
    var w wire
    if err := json.Unmarshal(data, &w); err != nil { return err }
    c.UserID = w.UserID
    c.Role  = w.Role
    if w.TenantID != uuid.Nil {
        c.TenantID = w.TenantID
    } else {
        c.TenantID = w.SubscriptionID
    }
    return nil
}
```

Token writers always emit `tenant_id`.

In the user model:

```go
type User struct {
    ID       uuid.UUID
    TenantID uuid.UUID
    // … rest …
}
```

- [ ] **Step 4: Update auth SQL and downstream call sites in this package**

`backend/internal/auth/service.go`: every `subscription_id` in SQL strings → `tenant_id`. Every `u.SubscriptionID` → `u.TenantID`.

`backend/internal/auth/handler.go`: response payload uses `tenant_id`.

`backend/internal/auth/middleware.go`: rename the API-key context key from `api_key_subscription_id` → `api_key_tenant_id`. Update every reader of that key (grep within `backend/internal/`).

- [ ] **Step 5: Run the full auth test suite**

```bash
go -C backend test ./internal/auth/... -v
```

Expected: all tests PASS, including the two from step 1.

- [ ] **Step 6: Run a global compile to surface every consumer that broke**

```bash
go -C backend build ./...
```

Expected: many compile errors — every `u.SubscriptionID` reference outside the auth package will fail. This is the purpose of step 6: it surfaces the full Phase 3 scope.

Capture the failure list to a scratchpad — it informs the per-package tasks below.

- [ ] **Step 7: Add a deprecated shim for the breakage list (temporary)**

To allow the build to stay green between this commit and the per-package commits, add a temporary getter on `User`:

```go
// Deprecated: use TenantID. Kept only during PLA-0024 phased migration.
// Remove in Phase 6.
func (u *User) SubscriptionID() uuid.UUID { return u.TenantID }
```

Then either (a) update all `u.SubscriptionID` (field access) → `u.SubscriptionID()` (method) in one mechanical sweep, or (b) accept the build break and proceed to Task 3 + Phase 3 immediately. Recommendation: (b) — a broken build that fails loudly is better than a working build that hides scope.

If you choose (a), grep and update:

```bash
grep -rln "u\.SubscriptionID\b" backend/internal/ \
  | xargs sed -i '' 's/u\.SubscriptionID\b/u.SubscriptionID()/g'
```

- [ ] **Step 8: Commit**

```bash
git add backend/internal/auth/ backend/internal/models/
git commit -m "feat(PLA-0024/00477): auth — User.TenantID + JWT claim flip with legacy grace"
```

### Task 3: Audit logger struct rename

**Files:**
- Modify: `backend/internal/auditlog/` (or wherever `AuditEntry` lives — locate via `grep -rn 'SubscriptionID' backend/internal/audit*`)
- Modify: paired `*_test.go`

- [ ] **Step 1: Write a failing test asserting new payload key**

```go
func TestAuditLog_WritesTenantIDPayload(t *testing.T) {
    e := AuditEntry{TenantID: knownTenant, Actor: knownUser, Event: "test"}
    body, err := json.Marshal(e)
    if err != nil { t.Fatal(err) }
    if !strings.Contains(string(body), `"tenant_id"`) {
        t.Fatalf("expected tenant_id in payload, got %s", body)
    }
}
```

- [ ] **Step 2: Run and confirm it fails**

```bash
go -C backend test ./internal/auditlog/... -run TenantIDPayload -v
```

Expected: FAIL.

- [ ] **Step 3: Rename `AuditEntry.SubscriptionID` → `TenantID`**

JSON tag becomes `json:"tenant_id"`. Audit writer call sites pass `TenantID: u.TenantID`.

- [ ] **Step 4: Update the audit reader to accept either key for historical rows**

Inside the audit query layer, when decoding stored rows:

```go
type wire struct {
    TenantID       *uuid.UUID `json:"tenant_id"`
    SubscriptionID *uuid.UUID `json:"subscription_id"`
    // … rest …
}
// after unmarshal:
if w.TenantID == nil { w.TenantID = w.SubscriptionID }
```

- [ ] **Step 5: Run the audit test suite**

```bash
go -C backend test ./internal/auditlog/... -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/auditlog/
git commit -m "feat(PLA-0024/00478): auditlog — TenantID payload key + legacy reader grace"
```

### Task 4: Frontend `AuthContext` — `tenant_id` with grace reader

**Files:**
- Modify: `app/contexts/AuthContext.tsx`
- Modify: `app/components/AppSidebar_2.tsx` (consumer)
- Modify: `app/(user)/work-items/page.tsx` (consumer)
- Modify: `app/(user)/admin/roles/page.tsx` (consumer)

- [ ] **Step 1: Update the `AuthUser` type to expose `tenant_id`**

```ts
type AuthUser = {
  id: string;
  tenant_id: string;
  // … existing fields …
};
```

- [ ] **Step 2: Add a grace reader on the response parser**

Where the auth response is normalised:

```ts
const tenantId = raw.tenant_id ?? raw.subscription_id ?? '';
const user: AuthUser = { id: raw.id, tenant_id: tenantId, /* … */ };
```

- [ ] **Step 3: Update the three consumer files to read `user.tenant_id`**

`AppSidebar_2.tsx:350,352`, `work-items/page.tsx:71`, `admin/roles/page.tsx:25` — each gets a one-line edit.

- [ ] **Step 4: Run the type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke — open the app, log in, confirm sidebar still renders**

The `tenant_id` is used for the workspace pill / domain display. If sidebar renders the tenant pill, the wire is correct.

- [ ] **Step 6: Commit**

```bash
git add app/contexts/AuthContext.tsx app/components/AppSidebar_2.tsx \
        "app/(user)/work-items/page.tsx" "app/(user)/admin/roles/page.tsx"
git commit -m "feat(PLA-0024/00479): frontend — AuthContext.tenant_id with subscription_id grace"
```

---

## Phase 3 — Backend services (6 tasks)

### Task 5: `entityrefs` SQL flip

**Files:**
- Modify: `backend/internal/entityrefs/service.go` (3 SQL strings at lines 86, 98, 129)
- Modify: `backend/internal/entityrefs/service_test.go` (if exists — else create a minimal one)

- [ ] **Step 1: Update SQL strings**

```bash
sed -i '' 's/subscription_id/tenant_id/g' backend/internal/entityrefs/service.go
```

Then read the file and confirm only SQL strings + struct fields (if any internal `SubscriptionID`) were touched. Revert any unintended hits.

- [ ] **Step 2: Update internal Go references**

Any local var `subID` / function param of that name → `tenantID`. Mechanical.

- [ ] **Step 3: Run the package tests**

```bash
go -C backend test ./internal/entityrefs/... -v
```

Expected: PASS. If tests reference `subscription_id` in fixture SQL, update those too.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/entityrefs/
git commit -m "feat(PLA-0024/00480): entityrefs — SQL + identifiers flip subscription_id → tenant_id"
```

### Task 6: `ranking` SQL flip

**Files:**
- Modify: `backend/internal/ranking/service.go` (6 SQL strings at lines 172,174,195,197,203,205)
- Modify: `backend/internal/ranking/handler.go:35,59`
- Modify: `backend/internal/ranking/service_test.go`

- [ ] **Step 1: Update SQL + identifiers in `service.go` and `handler.go`**

Same `sed` pattern as Task 5. Rename `Service.RankInput.SubscriptionID` → `TenantID` in the input struct. Update handler call sites (`SubscriptionID: u.SubscriptionID` → `TenantID: u.TenantID`).

- [ ] **Step 2: Run the package tests**

```bash
go -C backend test ./internal/ranking/... -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/ranking/
git commit -m "feat(PLA-0024/00481): ranking — SQL + identifiers flip subscription_id → tenant_id"
```

### Task 7: `portfolioitems` SQL flip

**Files:**
- Modify: `backend/internal/portfolioitems/service.go` (9 SQL strings: lines 125,129,142,178,204,219,244,297,322)
- Modify: `backend/internal/portfolioitems/handler.go` (4 call sites: lines 41,66,120,167)
- Modify: paired `*_test.go`

- [ ] **Step 1: Update SQL + identifiers**

Same pattern. The struct field `Item.SubscriptionID` may be exposed in JSON — check the `json:` tag. If exposed, the JSON key flips to `tenant_id` and any frontend consumer (handled in Phase 4) must be updated in the same release.

- [ ] **Step 2: Search for assignment patterns the `sed` may have missed**

```bash
grep -rn "SubscriptionID\|subscription_id" backend/internal/portfolioitems/
```

Expected: zero hits after the `sed`. Anything remaining is a typo or string concatenation — fix manually.

- [ ] **Step 3: Run the package tests**

```bash
go -C backend test ./internal/portfolioitems/... -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/portfolioitems/
git commit -m "feat(PLA-0024/00482): portfolioitems — SQL + identifiers flip subscription_id → tenant_id"
```

### Task 8: `workitems` + `workitemsv2` SQL flip

**Files:**
- Modify: `backend/internal/workitems/` (full sweep)
- Modify: `backend/internal/workitemsv2/` (full sweep)
- Modify: paired `*_test.go` files

- [ ] **Step 1: Inventory every reference**

```bash
grep -rn "subscription_id\|SubscriptionID" backend/internal/workitems backend/internal/workitemsv2
```

Record the line count per file. Each gets edited.

- [ ] **Step 2: Update SQL + identifiers**

```bash
find backend/internal/workitems backend/internal/workitemsv2 -name '*.go' \
  -exec sed -i '' 's/subscription_id/tenant_id/g; s/SubscriptionID/TenantID/g' {} +
```

Re-run the grep — expect zero hits.

- [ ] **Step 3: Run both package tests**

```bash
go -C backend test ./internal/workitems/... ./internal/workitemsv2/... -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/workitems/ backend/internal/workitemsv2/
git commit -m "feat(PLA-0024/00483): workitems(v2) — SQL + identifiers flip subscription_id → tenant_id"
```

### Task 9: `libraryreleases` SQL flip + cross-DB column rename

**Files:**
- Modify: `backend/internal/libraryreleases/handler.go` (lines 104,109,115,116,122)
- Modify: `backend/internal/libraryreleases/service.go` (sweep)
- Modify: `backend/internal/libraryreleases/reconciler.go` (if exists — `Reconciler.Count` per impact map)
- Modify: paired `*_test.go`

- [ ] **Step 1: Inventory + edit**

```bash
grep -rn "subscription_id\|SubscriptionID\|owner_subscription_id\|grantee_subscription_id\|audience_subscription_ids" \
  backend/internal/libraryreleases/
```

Edit every match. The cross-DB columns (`owner_tenant_id`, `grantee_tenant_id`, `audience_tenant_ids`) were already renamed by the library migration in Task 1; this commit makes the Go code match.

- [ ] **Step 2: Run the package tests**

```bash
go -C backend test ./internal/libraryreleases/... -v
```

Expected: PASS.

- [ ] **Step 3: Smoke — call a library endpoint that exercises Reconciler**

```bash
# From a logged-in session:
curl -s -b cookies.txt http://localhost:5100/api/library/portfolio-models | jq '.[0]'
```

Expected: returns a portfolio model with `owner_tenant_id` populated. No 500.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/libraryreleases/
git commit -m "feat(PLA-0024/00484): libraryreleases — SQL flip + cross-DB owner_tenant_id alignment"
```

### Task 10: Backend sweep — residual packages

**Files:** every Go file under `backend/` still containing `subscription_id` or `SubscriptionID`.

- [ ] **Step 1: Find residuals**

```bash
grep -rln "subscription_id\|SubscriptionID" backend/ \
  | grep -v _test.go | grep -v '\.git/' | sort
```

Expected: a short list — anything not covered by Tasks 5–9. Likely candidates: `cmd/server/main.go` comments, `apikeys/`, `dbcheck/`, `errorsreport/`, `roles/`, `workspaces/`.

- [ ] **Step 2: Edit each file**

Same `sed` pattern. Read each file after the edit and confirm only meaningful renames happened (comments mentioning the rename history can stay if narrative).

- [ ] **Step 3: Build + full test suite**

```bash
go -C backend build ./...
go -C backend test ./...
```

Expected: clean build, all tests pass.

- [ ] **Step 4: Drop the temporary `User.SubscriptionID()` shim from Task 2 step 7**

If you took option (a) in Task 2 step 7, the shim is now unused. Remove the deprecated method.

```bash
grep -rn "u\.SubscriptionID()" backend/
```

Expected: zero hits. If hits remain, those callers were missed — fix them. Then delete the shim:

```go
// Delete the entire deprecated method block from User.
```

- [ ] **Step 5: Run the full test suite again**

```bash
go -C backend test ./...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(PLA-0024/00485): backend sweep — residual subscription_id references + drop shim"
```

---

## Phase 4 — Frontend (4 tasks)

### Task 11: Wire types + AuthContext consumers

**Files:**
- Modify: `app/lib/workspacesApi.ts:24`
- Modify: `app/lib/topologyApi.ts:18,56`
- Modify: `app/(user)/workspace-settings/_shared.tsx:43`
- Modify: `app/hooks/useRealtimeSubscription.ts:14,32`

- [ ] **Step 1: Rename type fields**

`subscription_id: string` → `tenant_id: string` in each file.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: a list of errors — every consumer of these types that still reads `.subscription_id` fails. Fix each consumer (one-line edits each).

- [ ] **Step 3: Re-run type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/workspacesApi.ts app/lib/topologyApi.ts \
        "app/(user)/workspace-settings/_shared.tsx" \
        app/hooks/useRealtimeSubscription.ts
git commit -m "feat(PLA-0024/00488): frontend wire types — subscription_id → tenant_id"
```

### Task 12: v2 API routes SQL flip

**Files:**
- Modify: `app/api/v2/strategy-items/route.ts` (lines 60,92,117,139,146)
- Modify: `app/api/v2/strategy-items/[id]/route.ts` (lines 48,94,112)
- Modify: `app/api/v2/field-library/route.ts` (lines 7,57,96)
- Modify: `app/api/v2/field-library/[id]/route.ts:34`

- [ ] **Step 1: Update SQL strings**

```bash
sed -i '' 's/subscription_id/tenant_id/g' \
  app/api/v2/strategy-items/route.ts \
  "app/api/v2/strategy-items/[id]/route.ts" \
  app/api/v2/field-library/route.ts \
  "app/api/v2/field-library/[id]/route.ts"
```

- [ ] **Step 2: Type check + lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 3: Smoke — hit each route**

```bash
curl -s -b cookies.txt 'http://localhost:5101/api/v2/strategy-items' | jq '. | length'
curl -s -b cookies.txt 'http://localhost:5101/api/v2/field-library' | jq '. | length'
```

Expected: numeric responses (could be 0). No 500.

- [ ] **Step 4: Commit**

```bash
git add app/api/v2/
git commit -m "feat(PLA-0024/00491): frontend v2 routes — SQL flip subscription_id → tenant_id"
```

### Task 13: Portfolio-model props rename

**Files:**
- Modify: `app/(user)/portfolio-model/page.tsx` (lines 28,241,253,261,283)
- Modify: `app/(user)/portfolio-model/AdoptionOverlay.tsx` (lines 25,38,76,105,268,323,376)
- Modify: `app/(user)/portfolio-model/adoptionConstants.ts:43`

- [ ] **Step 1: Rename props mechanically**

```bash
sed -i '' 's/subscriptionId/tenantId/g; s/subscription_id/tenant_id/g' \
  "app/(user)/portfolio-model/page.tsx" \
  "app/(user)/portfolio-model/AdoptionOverlay.tsx" \
  "app/(user)/portfolio-model/adoptionConstants.ts"
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If a parent component still passes `subscriptionId={...}`, fix it.

- [ ] **Step 3: Smoke — open the portfolio-model page, run the adoption flow**

Adoption telemetry payload now sends `tenant_id`. Verify no 500.

- [ ] **Step 4: Commit**

```bash
git add "app/(user)/portfolio-model/"
git commit -m "feat(PLA-0024/00493): portfolio-model — props subscriptionId → tenantId"
```

### Task 14: `lint:no-subscription-id` rule

**Files:**
- Create: `dev/scripts/lint_no_subscription_id.py`
- Modify: `package.json` (add `lint:no-subscription-id` npm script)
- Modify: `docs/c_c_lint_rules.md` (document the new rule)

- [ ] **Step 1: Write a failing test fixture**

```bash
mkdir -p /tmp/lint-fixture/src
echo 'const x = "subscription_id";' > /tmp/lint-fixture/src/bad.ts
```

- [ ] **Step 2: Write the lint script**

```python
#!/usr/bin/env python3
# dev/scripts/lint_no_subscription_id.py
# Fails if any file under app/, backend/, dev/ contains subscription_id /
# subscriptionId / SubscriptionID. Exempt: db/schema/, db/library_schema/
# (historical migrations preserve original names), .git/, node_modules/.

import os
import re
import sys

ROOTS = ["app", "backend", "dev"]
EXEMPT_DIRS = {".git", "node_modules", "dist", ".next"}
EXEMPT_FILES_RE = re.compile(r"^db/(library_)?schema/")
PATTERNS = [
    re.compile(r"\bsubscription_id\b"),
    re.compile(r"\bsubscriptionId\b"),
    re.compile(r"\bSubscriptionID\b"),
]
EXEMPT_INLINE = "lint:no-subscription-id allow"  # comment on line allows it

def scan():
    hits = []
    for root in ROOTS:
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in EXEMPT_DIRS]
            if EXEMPT_FILES_RE.match(dp): continue
            for fn in files:
                if not fn.endswith((".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".sql", ".md")):
                    continue
                path = os.path.join(dp, fn)
                try:
                    with open(path, encoding="utf-8") as f:
                        for i, line in enumerate(f, 1):
                            if EXEMPT_INLINE in line: continue
                            for pat in PATTERNS:
                                if pat.search(line):
                                    hits.append((path, i, line.rstrip()))
                                    break
                except (UnicodeDecodeError, OSError):
                    pass
    return hits

if __name__ == "__main__":
    hits = scan()
    if hits:
        print(f"[lint:no-subscription-id] {len(hits)} forbidden reference(s):")
        for p, i, l in hits:
            print(f"  {p}:{i}  {l}")
        sys.exit(1)
    print("[lint:no-subscription-id] OK — 0 forbidden references.")
```

- [ ] **Step 3: Run against the fixture and confirm it catches**

```bash
cd /tmp/lint-fixture && python3 "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector/dev/scripts/lint_no_subscription_id.py"
```

Expected: exit 1, listing `src/bad.ts:1`.

- [ ] **Step 4: Add npm script**

In `package.json` `scripts`:

```json
"lint:no-subscription-id": "python3 dev/scripts/lint_no_subscription_id.py"
```

- [ ] **Step 5: Run from project root**

```bash
npm run lint:no-subscription-id
```

Expected: exit 0 if Phases 2–4 are clean, exit 1 with a hit list if any reference remains. If exit 1, fix each hit before proceeding.

- [ ] **Step 6: Document**

Add a row to `docs/c_c_lint_rules.md`:

```
- `lint:no-subscription-id` — Blocks any new `subscription_id` / `subscriptionId` / `SubscriptionID` reference in `app/`, `backend/`, `dev/`. Inline exemption: comment `lint:no-subscription-id allow` on the same line. Migrations under `db/schema/` and `db/library_schema/` are exempt (historical names preserved).
```

- [ ] **Step 7: Commit**

```bash
git add dev/scripts/lint_no_subscription_id.py package.json docs/c_c_lint_rules.md
git commit -m "feat(PLA-0024/00497): lint:no-subscription-id — block regressions"
```

---

## Phase 5 — Drop legacy (1 task)

### Task 15: Drop `subscriptions` view + `_subscriptions_legacy` table

**Files:**
- Create: `db/schema/130_drop_subscriptions_view_and_legacy.sql`
- Create: `db/schema/down/130_drop_subscriptions_view_and_legacy_DOWN.sql`
- Modify: `docs/c_schema.md` (remove subscriptions row)

**Pre-condition:** all of Phase 2/3/4 has been live for at least one full session-cycle with no read errors against the view. Confirm by checking server logs for any `relation "subscriptions" does not exist` or similar warnings — should be zero.

- [ ] **Step 1: Take a backup of `_subscriptions_legacy` (DOWN safety net)**

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/pg_dump -h localhost -p 5435 -U mmff_dev \
  -d mmff_vector -t _subscriptions_legacy \
  > /tmp/pla-0024-subscriptions-legacy.sql
```

Keep this backup until Phase 6 lands.

- [ ] **Step 2: Write the migration**

```sql
-- 130_drop_subscriptions_view_and_legacy.sql
BEGIN;
DROP VIEW IF EXISTS subscriptions;
DROP TABLE IF EXISTS _subscriptions_legacy;
COMMIT;
```

- [ ] **Step 3: Write the DOWN**

```sql
-- 130_drop_subscriptions_view_and_legacy_DOWN.sql
-- Restore _subscriptions_legacy from backup, then recreate the view.
-- The backup file path lives in the team's runbook.
\i /tmp/pla-0024-subscriptions-legacy.sql
-- Recreate the view (copy the CREATE VIEW from migration 129 step 5).
CREATE VIEW subscriptions AS
  SELECT tenant_id AS id, tenant_name AS name, /* … full column list … */
    FROM master_record_tenant;
```

- [ ] **Step 4: Dry-run**

```bash
go run ./backend/cmd/migrate -dry-run -db vector
```

- [ ] **Step 5: Apply**

```bash
go run ./backend/cmd/migrate -db vector
```

- [ ] **Step 6: Verify**

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "SELECT to_regclass('subscriptions'), to_regclass('_subscriptions_legacy');"
```

Expected: both NULL.

- [ ] **Step 7: Smoke — exercise tenant settings, work items, portfolio model**

Each was a Phase 3 / Phase 4 migration target. Each should still work end-to-end. No 500. No "relation does not exist" errors in backend logs.

- [ ] **Step 8: Update `docs/c_schema.md`**

Remove the `subscriptions` row from the table list. Add a note to the migration table for 130.

- [ ] **Step 9: Commit**

```bash
git add db/schema/130_*.sql db/schema/down/130_*.sql docs/c_schema.md
git commit -m "feat(PLA-0024/00498): db — drop subscriptions view + _subscriptions_legacy"
```

---

## Phase 6 — Documentation + memory (1 task)

### Task 16: Final docs + memory sweep + plan-index close-out

**Files:**
- Modify: `docs/c_schema.md` (final pass — every `subscription_id` reference removed, every table's `tenant_id` column documented)
- Modify: `docs/c_security.md` (auth-boundary references)
- Modify: `.claude/memory/project_subscriptions_rename.md` (mark complete or delete)
- Modify: `docs/c_plan_index.md` (PLA-0024 status → complete)
- Modify: `.claude/memory/MEMORY.md` (remove `project_subscriptions_rename` line if memory deleted)

- [ ] **Step 1: Run the lint rule one final time**

```bash
npm run lint:no-subscription-id
```

Expected: 0 hits. If any, they're documentation files — either fix them or add inline exemptions where the historical narrative is intentional (commit message references etc.).

- [ ] **Step 2: Update `docs/c_schema.md`**

Read the file. Remove every `subscription_id` mention. Where a table's columns are documented, replace with `tenant_id`. Add a "rename history" note at the top of `master_record_tenant` section: "subscriptions table dropped 2026-MM-DD via PLA-0024."

- [ ] **Step 3: Update `docs/c_security.md`**

Auth-boundary references update from `subscription_id` to `tenant_id`. If the security doc has a JWT claim diagram, update it.

- [ ] **Step 4: Update memory**

Edit `.claude/memory/project_subscriptions_rename.md`:

```yaml
---
name: subscriptions → master_record_tenant rename — COMPLETE
description: Cutover landed via PLA-0024 (2026-MM-DD). Kept for historical context; safe to delete after one cycle.
type: project
---
PLA-0024 closed 2026-MM-DD. All FKs renamed; `subscriptions` table and view dropped; `lint:no-subscription-id` blocks regressions.
```

- [ ] **Step 5: Update `docs/c_plan_index.md`**

Change PLA-0024 status from `active` to `complete`.

- [ ] **Step 6: Mirror memory to global**

Per project rule (memory dir is canonical, global is mirror):

```bash
cp ".claude/memory/project_subscriptions_rename.md" \
   "/Users/rick/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---Vector/memory/"
```

- [ ] **Step 7: Final lint sweep**

```bash
npm run lint:no-subscription-id
go -C backend build ./...
go -C backend test ./...
npx tsc --noEmit
npm run lint
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add docs/c_schema.md docs/c_security.md docs/c_plan_index.md \
        .claude/memory/project_subscriptions_rename.md \
        .claude/memory/MEMORY.md
git commit -m "docs(PLA-0024/00499): close-out — c_schema + c_security + plan index + memory"
```

---

## Acceptance check (after Task 16)

Run all of the following. Each must pass.

- [ ] `npm run lint:no-subscription-id` — exit 0, "0 forbidden references"
- [ ] `go -C backend build ./...` — clean build
- [ ] `go -C backend test ./...` — all tests pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — clean
- [ ] DB query: `SELECT count(*) FROM information_schema.columns WHERE column_name = 'subscription_id' AND table_schema = 'public';` — returns 0 in `mmff_vector` and `mmff_library`
- [ ] DB query: `SELECT to_regclass('subscriptions'), to_regclass('_subscriptions_legacy');` — both NULL
- [ ] Manual smoke: log in, open `/workspace-settings/organization`, edit and save — 200, persisted
- [ ] Manual smoke: open `/work-items`, drag a row to reorder — 200, persisted
- [ ] Manual smoke: open `/portfolio-model`, run an adoption — 200, telemetry payload contains `tenant_id`
- [ ] `docs/c_plan_index.md` shows PLA-0024 as `complete`

If every box is checked, the cutover is done. Run `<stories>` to register the 16 task IDs (00476–00499 plus skips for the omitted numbers in the spec preview) once Planka cards are needed for tracking — or skip Planka entirely if executing this plan inline.

## Rollback decision points

- After Task 1 (Phase 1 commit): `git revert <hash>` + run the 129 DOWN script. The view and `_subscriptions_legacy` are intact, so this is clean.
- After Task 2 (auth flip): both legacy and new claim shapes are accepted, so reverting the auth commit is safe — old tokens still parse.
- After Task 15 (drop legacy): rollback requires restoring `_subscriptions_legacy` from `/tmp/pla-0024-subscriptions-legacy.sql`. Don't lose that file.

## Open questions resolved by this plan (vs spec)

The spec's three open questions:
1. **Library schema renames in Phase 1** — bundled (Task 1 step 5).
2. **Drop `_subscriptions_legacy` immediately or keep one cycle** — kept until Phase 5; not dropped at Phase 1.
3. **Lint rule scope** — includes `dev/`, exempts only `db/schema/` and `db/library_schema/`; inline `lint:no-subscription-id allow` available.

If you disagree with any of these, say so and I'll revise before execution begins.

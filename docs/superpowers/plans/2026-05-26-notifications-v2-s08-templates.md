# S08 — Templates (DB-backed + interpolation + seeds) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Land `v2/templates/` package — DB-backed template lookup keyed by `(event_type, channel, locale, version, active=true)` + safe `{{ data.X }}` interpolation. Seed initial templates for `mention.created` + 5 artefact lifecycle events.

**Story estimate:** 5

**Wave:** 2 — parallel-safe with S02, S03, S05, S07

**Branch:** `notif-v2-s08`

---

## Read first (REQUIRED)

1. **Spec sections:**
   - "Architecture" → `v2/templates/` package layout
   - "End-to-end flow" → step 5 TEMPLATE RENDER (lookup + interpolate, render result lands in outbox row)
   - Locked decision: per-rule `template_override_id` can replace default lookup
   - "Data model" → `notifications_templates` DDL (mig 127, already applied)

2. **v1 reference:** `backend/internal/notifications/templates.go` — v1 has in-process Go funcs. v2 is DB-backed. Read but do not import.

3. **Cross-story dep:** depends on S02's `domain.Channel` (and event_type semantics). Import from domain only.

4. **HARD RULES:** strangler-fig, inspect-index, explicit-path adds.

---

## File structure

| File | Purpose |
|---|---|
| `backend/internal/notifications/v2/templates/service.go` | `Service` interface (Render, CRUD), pg-impl. Lookup query, version selection (latest active), template_override_id support |
| `backend/internal/notifications/v2/templates/interpolate.go` | Pure function `Interpolate(template string, data map[string]any) string` — `{{ data.X }}` and `{{ data.nested.Y }}` substitution, no arbitrary code execution |
| `backend/internal/notifications/v2/templates/interpolate_test.go` | Table-driven unit tests for interpolation (positive, missing-field, nested, no-template-vars) |
| `backend/internal/notifications/v2/templates/service_test.go` | Integration tests (real DB seeded with templates) |
| `db/vector_artefacts/schema/131_notif_v2_seed_templates.sql` | Migration that seeds initial templates for mention.created + artefact.flow_state_changed/blocked/owner_changed/assigned + library.release_published |

---

## Tasks

### Task 1 — Worktree confirm + read schema

- [ ] **1.1** `git branch --show-current` → `notif-v2-s08`
- [ ] **1.2** Read `db/vector_artefacts/schema/127_notif_v2_templates.sql` for the exact column names + UNIQUE constraint shape.

### Task 2 — `interpolate.go` + tests

- [ ] **2.1** Function signature:
  ```go
  // Interpolate substitutes {{ data.X }} placeholders in template with values from data.
  // Path is dot-separated (uses templates.GetField under the hood — or re-implement same shape as rules/jsonpath.go).
  // Missing fields render as empty string (do NOT panic; do NOT leave the literal {{ ... }} text).
  // Whitespace inside the braces is tolerated: {{data.X}} and {{ data.X }} both match.
  func Interpolate(template string, data map[string]any) string
  ```
  Use a regexp like `\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}` to match placeholders. Replace each match with the looked-up value (`fmt.Sprintf("%v", val)`).

- [ ] **2.2** Tests:
  - Empty template → ""
  - Template with no placeholders → unchanged
  - Single placeholder, present → substituted
  - Single placeholder, missing → empty string
  - Multiple placeholders → all substituted
  - Nested path (`data.actor.name`) → substituted
  - Whitespace variations → both work
  - Numeric value → renders as decimal string
  - Bool value → renders as "true"/"false"
  - Map/slice value → renders via %v (fine for v1; HTML-escape is a YAGNI for in-app text where format is markdown-like)

- [ ] **2.3** Commit.

### Task 3 — `service.go` (lookup + CRUD)

- [ ] **3.1** `Service` interface:
  ```go
  type Service interface {
      // Render performs the standard lookup (event_type, channel, locale=user_locale_or_en-GB, latest active version)
      // and returns (title, body). If no template found, returns ErrTemplateMissing.
      Render(ctx context.Context, eventType, channel, locale string, data map[string]any) (title, body string, err error)
      
      // RenderOverride uses a specific template ID (for rule template_override).
      RenderOverride(ctx context.Context, templateID uuid.UUID, data map[string]any) (title, body string, err error)
      
      // Create / Get / Update / Delete / List for admin UI in future PLA
      Create(ctx context.Context, t Template) (Template, error)
      Get(ctx context.Context, id uuid.UUID) (Template, error)
      Update(ctx context.Context, id uuid.UUID, patch Template) (Template, error)
      Delete(ctx context.Context, id uuid.UUID) error
      List(ctx context.Context, filter ListFilter) ([]Template, error)
  }
  ```

- [ ] **3.2** `pgService` impl:
  - `Render`: query `notifications_templates` WHERE event_type=$1 AND channel=$2 AND locale=$3 AND active=true ORDER BY version DESC LIMIT 1. If no row, fall back to locale='en-GB' query. If still no row, return `ErrTemplateMissing`.
  - Interpolate subject + body separately.
  - CRUD methods follow standard patterns.

- [ ] **3.3** Sentinel errors: `ErrTemplateMissing`, `ErrTemplateNotFound`, `ErrInvalidLocale`.

- [ ] **3.4** Compile + commit.

### Task 4 — Integration tests for service

- [ ] **4.1** Tagged integration. Seed 2-3 templates in `t.Cleanup`-able transactions. Test:
  - Render finds matching template by exact (event_type, channel, locale)
  - Render falls back to en-GB if no locale match
  - Render returns ErrTemplateMissing if no template at all
  - Render with template_override_id uses the override
  - Version selection picks highest version among active rows
  - CRUD round-trip: Create → Get → Update → List → Delete

- [ ] **4.2** Commit.

### Task 5 — Seed migration

- [ ] **5.1** Write `db/vector_artefacts/schema/131_notif_v2_seed_templates.sql` with header comment + BEGIN/COMMIT. INSERT rows for:

  | event_type | channel | subject template | body template |
  |---|---|---|---|
  | `mention.created` | `in_app` | `{{ data.actor_display_name }} mentioned you` | `In "{{ data.artefact_name }}": {{ data.snippet }}` |
  | `mention.created` | `email` | `You were mentioned in {{ data.artefact_name }}` | (multi-line body — see below) |
  | `artefact.flow_state_changed` | `in_app` | `{{ data.artefact_name }} moved to {{ data.new_state }}` | `Previous state: {{ data.old_state }}` |
  | `artefact.flow_state_changed` | `email` | `{{ data.artefact_name }} → {{ data.new_state }}` | ... |
  | `artefact.blocked` | `in_app` | `{{ data.artefact_name }} is blocked` | `Blocker: {{ data.blocker_reason }}` |
  | `artefact.blocked` | `email` | `Blocked: {{ data.artefact_name }}` | ... |
  | `artefact.owner_changed` | `in_app` | `{{ data.artefact_name }} owner changed` | `New owner: {{ data.new_owner_name }}` |
  | `artefact.owner_changed` | `email` | `Ownership change: {{ data.artefact_name }}` | ... |
  | `artefact.assigned` | `in_app` | `{{ data.actor_display_name }} assigned {{ data.artefact_name }} to you` | ... |
  | `artefact.assigned` | `email` | `New assignment: {{ data.artefact_name }}` | ... |
  | `library.release_published` | `in_app` | `New library release: v{{ data.version }}` | `{{ data.release_notes }}` |
  | `library.release_published` | `email` | `Library release v{{ data.version }} published` | ... |

  All locale='en-GB', version=1, active=true.

  Email bodies can be richer (multi-line) — feel free to use markdown-ish formatting.

- [ ] **5.2** Apply via psql, verify with:
  ```sql
  SELECT notifications_templates_event_type, notifications_templates_channel,
         length(notifications_templates_subject), length(notifications_templates_body)
  FROM notifications_templates
  ORDER BY notifications_templates_event_type, notifications_templates_channel;
  ```
  Expect 12 rows.

- [ ] **5.3** Commit: `feat(notif-v2): seed templates for mention + 5 artefact events`.

### Task 6 — Lint discipline

- [ ] **6.1** No new lint. Existing column-prefix lint scans the new mig.

- [ ] **6.2** Verify existing lints still pass.

### Task 7 — Final verification

- [ ] **7.1** Standard build + vet + tests. Confirm seed rows present.

### Task 8 — Report

```
S08 WORKER — STATUS: READY FOR VALIDATION
Branch: notif-v2-s08
Files: service.go, interpolate.go (+tests), migration 131 (seeds)
Commits: ~5
Templates seeded: 12 rows (6 event_types × 2 channels each — in_app + email)
Interpolation safety: regex-bounded substitution, no arbitrary code; missing fields = empty string (documented in comment)
Render fallback: locale-specific → en-GB → ErrTemplateMissing
```

---

## Definition of Done

1. 4 Go files + 1 SQL migration land
2. 12 seed templates present and queryable
3. All tests PASS
4. Build + vet clean
5. No imports from v1
6. Validator PASS

---

## Risks

| Risk | Mitigation |
|---|---|
| Regex catastrophic backtracking | Pattern `\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}` is linear-safe. Don't use `.*` in placeholder body |
| HTML escaping in email channel | YAGNI for v1; document in TD. The `RenderOverride` API is the seam to add per-channel post-processing later |
| Template version bumps | Spec says version is bumped on edit; for v1 the worker creates only version 1 rows. Future admin UI handles bumping |
| Missing data field rendered as empty | Document in operator-doc comment; this is preferred over rendering `{{ data.X }}` literal (would leak the placeholder into user-visible text) |
| Locale fallback chain | Two-step fallback only (specific → en-GB). If en-GB itself missing, ErrTemplateMissing — DO NOT fall further (no "any locale" wildcard) — would mask seed mistakes |

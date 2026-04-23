# Feature — Portfolio stack presets + two-party lock

Status: **proposal / not started.** Captures the 2026-04-24 design session. Supersedes any earlier assumption that `portfolio_item_types` is always seeded at tenant provisioning.

## What we're changing

Out-of-the-box state: a tenant's `portfolio_item_types` and `portfolio_item` tables are **empty for each workspace**. No default stack shape is imposed.

On first visit by a gadmin, the **Portfolio Settings** page renders a picker of **5 preset hierarchies + Custom** (6 cards). Choosing one seeds:

1. One `portfolio_item_types` row per layer (with tag, name, sort_order).
2. One `portfolio_item` seed asset per layer (named "My first <layer>"), nested per the layer order so the seed is a single chain.

The seeded stack is in state `proposed`. A **padmin** must accept it to move to state `locked`. Until locked, no execution work can be assigned. Once locked, the layer catalogue is immutable to both gadmin and padmin — changes require a support-issued unlock, which itself is refused if any execution item references a `portfolio_item` in that workspace.

Workspaces are independent: a tenant with Production, Training, and Testing workspaces can hold three different stack shapes, each with its own lifecycle.

## Why this shape

- **Empty-by-default** removes the assumption that every customer wants the Agency shape (Product → Theme → Business Objective → Feature). Enterprise, Rally, Jira, and SAFe customers do not.
- **Presets as data, not code** — adding a 6th preset is INSERTs into `portfolio_preset_layer`. No schema change, no code change.
- **Two-party lock** reflects real-world governance: the person who *proposes* the shape (gadmin, configuring the tenant) is not the person who *operates* under it (padmin, running the workspace day-to-day). Both must agree before work is assignable.
- **Per-workspace** matches how customers actually run multiple environments. A Production workspace on SAFe and a Training workspace on Agency should not fight over a shared type catalogue.

## Preset catalogue (v1)

Ordered top → bottom. `sort_order = 10, 20, 30, …` with gaps for future insertion.

| Preset | Slug | Layers (top → bottom) |
|---|---|---|
| Agency | `agency` | Product → Theme → Business Objective → Feature |
| Enterprise | `enterprise` | Strategic Objective → Portfolio Objective → Business Epic → Business Outcome → Feature |
| Rally | `rally` | Strategy → Initiative → Feature |
| Jira | `jira` | Initiative |
| SAFe | `safe` | Strategic Theme → Portfolio Backlog → Programme Backlog → Feature |

Notes:
- **Feature** is the portfolio/execution overlap per the SOW — every preset except Jira terminates at Feature. Jira is deliberately a single layer (execution stack handles everything below).
- **SAFe** has had Feature appended to the SOW-style chain so execution can hang off it consistently with the other presets. If a customer wants pure SOW SAFe with execution hanging off Programme Backlog, they use the Custom builder.
- **Tag vocabulary** (2–4 chars, unique per workspace): PR/TH/BO/FE (Agency), SO/PO/BE/BC/FE (Enterprise, BC = Business outCome to disambiguate from BO = Business Objective), ST/IN/FE (Rally), IN (Jira), STH/PBL/PGB/FE (SAFe). Gadmin can override tags at layer creation from the Custom builder; preset seeds are fixed.

## Data model

### New tables

```
portfolio_preset                       -- global catalogue, seeded once
  id              UUID PK
  slug            TEXT UNIQUE NOT NULL      -- agency/enterprise/rally/jira/safe
  title           TEXT NOT NULL
  description     TEXT NOT NULL
  sort_order      INT NOT NULL DEFAULT 0
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()

portfolio_preset_layer                 -- template rows per preset
  id              UUID PK
  preset_id       UUID NOT NULL REFERENCES portfolio_preset(id) ON DELETE CASCADE
  tag             TEXT NOT NULL CHECK (length(tag) BETWEEN 2 AND 4)
  name            TEXT NOT NULL
  sort_order      INT NOT NULL
  is_feature_layer BOOLEAN NOT NULL DEFAULT FALSE
  UNIQUE (preset_id, sort_order)
  UNIQUE (preset_id, tag)

portfolio_item                         -- replaces portfolio + product at v1+1
  id              UUID PK
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
  workspace_id    UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  type_id         UUID NOT NULL REFERENCES portfolio_item_types(id) ON DELETE RESTRICT
  parent_id       UUID REFERENCES portfolio_item(id) ON DELETE RESTRICT
  key_num         BIGINT NOT NULL CHECK (key_num > 0)
  name            TEXT NOT NULL
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  archived_at     TIMESTAMPTZ
  created_at, updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (tenant_id, key_num)
```

### Modified tables

```
portfolio_item_types
  + workspace_id  UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  -- Types scope shifts from tenant-wide to per-workspace.
  -- Drops UNIQUE (tenant_id, tag) / (tenant_id, name).
  -- Adds    UNIQUE (workspace_id, tag) / (workspace_id, name).

workspace
  + portfolio_preset_id    UUID REFERENCES portfolio_preset(id)
  + stack_state            TEXT NOT NULL DEFAULT 'empty'
                           CHECK (stack_state IN ('empty','proposed','locked'))
  + stack_proposed_at      TIMESTAMPTZ
  + stack_proposed_by      UUID REFERENCES users(id) ON DELETE RESTRICT
  + stack_locked_at        TIMESTAMPTZ
  + stack_locked_by        UUID REFERENCES users(id) ON DELETE RESTRICT

entity_stakeholders
  CHECK entity_kind IN (..., 'portfolio_item')

tenant_sequence
  + new scope value: 'portfolio_item' per-workspace (or encode as '{workspace_id}:portfolio_item')
```

### Triggers and guards

- `portfolio_item_types` INSERT/UPDATE/DELETE — reject if the target `workspace_id` has `stack_state = 'locked'`. (Support-unlock flips to `proposed` first.)
- `portfolio_item` INSERT — if `stack_state != 'locked'`, only the provisioning path may insert (seed path uses a session flag or SECURITY DEFINER function). User-driven creates blocked until locked.
- `workspace.stack_state` transitions — enforced by a state-machine trigger:
  - `empty → proposed` — requires `stack_proposed_by` set, `portfolio_preset_id` set, and at least one layer + one item created in the same transaction.
  - `proposed → proposed` (re-propose) — permitted, clears prior layers + items, writes a `portfolio.stack.repproposed` event.
  - `proposed → locked` — requires `stack_locked_by` set, **different from** `stack_proposed_by` (self-lock forbidden), and `stack_locked_by` holds a padmin grant on the workspace.
  - `proposed → empty` (reject) — clears preset, layers, items; permitted only by padmin.
  - `locked → proposed` — support only, via privileged RPC; refused if any execution work item references a `portfolio_item` in this workspace.

### What happens to `portfolio` and `product`

Both are legacy. Phase 1 keeps them in place for read compatibility. Phase 2 dual-writes. Phase 3 drops them and re-points execution FKs to `portfolio_item`.

## Lifecycle + audit log

Every state transition writes two things in the same transaction:

1. **Current state** onto the `workspace` row (stack_state, stack_*_at, stack_*_by, portfolio_preset_id).
2. **Immutable event** into the master `events` audit table (see [`feature_event_audit_log.md`](feature_event_audit_log.md)).

Reserved event types:

```
portfolio.stack.proposed          payload: { preset_slug, layers: [{tag, name, sort_order}] }
portfolio.stack.repproposed       payload: { preset_slug, layers: [...], previous_preset_slug }
portfolio.stack.rejected          payload: { rejected_preset_slug, note_token? }
portfolio.stack.locked            payload: { preset_slug }
portfolio.stack.support_unlocked  payload: { ticket_ref, note_token }
```

`entity_kind = 'workspace'`, `entity_id = workspace.id`. Free-text reason notes are tokenised per the audit log's PII rules.

## Bootstrap dependency on the audit log

The master `events` table (per `feature_event_audit_log.md`) is still proposal-stage. This feature needs *somewhere* to write events. Chosen path:

**Migration 017 creates a minimal `events` table** — id, tenant_id, workspace_id, entity_kind, entity_id, actor_user_id, event_type, occurred_at (server-default `clock_timestamp()`), payload jsonb, idempotency_key. Monthly partitioning from day one. UPDATE/DELETE revoked at role level. No hash chain columns yet — those land when the full audit log design is built, and a one-time re-hash pass backfills the chain over rows written before then.

This is an explicit debt item: S2 with trigger = "start of audit-log full implementation phase". Captured in the risk register below.

## Role permissions

- **gadmin**: propose, re-propose. Cannot lock (even if also padmin on the workspace — self-lock blocked server-side).
- **padmin**: accept (lock), reject (back to empty). Cannot propose.
- **support** (us): unlock via admin tool, refused when execution items exist.
- **user**: read-only on stack shape; cannot see preset picker.

## Frontend

Portfolio Settings page at `app/(user)/portfolio-settings/page.tsx` — replaces the current stub. Rendered by workspace context; routes per workspace are workspace-scoped.

### States

- **Empty** (gadmin view): 6-card grid. Each card: title, stacked-chip visual of layers, description, Accept button → confirm dialog listing exact layers → `POST /api/portfolio-stack/propose`.
  - Custom card → `/portfolio-settings/builder` (drag-to-order layer list, add/rename/remove rows, mark one as Feature).
- **Empty** (padmin/user): "Waiting for gadmin to propose a stack shape for this workspace."
- **Proposed** (gadmin): stack visualised; banner "Awaiting padmin acceptance." Actions: Re-propose (wipes current proposal, returns to empty).
- **Proposed** (padmin): stack visualised with preset description. Actions: **Accept** (→ locked) / **Reject** (→ empty, optional note).
- **Proposed** (user): "Stack shape pending approval. Ask your padmin to review."
- **Locked** (all roles): read-only tree view. Footer: "Locked by <padmin> on <date>. Changes require support."

No inline styles. BEM-lite classes: `.portfolio-presets`, `.portfolio-preset-card`, `.portfolio-preset-card__stack`, `.portfolio-preset-card__stack-chip`, `.portfolio-preset-card__actions`.

### Backend routes

- `GET /api/portfolio-stack/presets` — list preset rows (for card rendering).
- `GET /api/portfolio-stack/:workspaceId` — current state + layers + seed items.
- `POST /api/portfolio-stack/:workspaceId/propose` — body `{ preset_slug | layers: [...] }`. Gadmin only.
- `POST /api/portfolio-stack/:workspaceId/repropose` — same shape as propose, requires current state = proposed.
- `POST /api/portfolio-stack/:workspaceId/accept` — padmin only, requires actor != proposer.
- `POST /api/portfolio-stack/:workspaceId/reject` — padmin only, optional note.
- `POST /api/admin/portfolio-stack/:workspaceId/unlock` — support only, requires no execution items exist.

All writes transact workspace state + event emission atomically.

## Migrations

### `017_portfolio_presets.sql`

- Create `portfolio_preset`, `portfolio_preset_layer`. Seed the 5 presets.
- Create `portfolio_item` table.
- Create minimal `events` table (monthly-partitioned).
- Add columns to `workspace`: `portfolio_preset_id`, `stack_state`, `stack_proposed_at/by`, `stack_locked_at/by`. Default `stack_state = 'empty'`.
- Add `workspace_id` column to `portfolio_item_types`. Backfill: for each existing row, copy from its tenant's SPACE-00000001. Swap UNIQUE constraints.
- Add `'portfolio_item'` to `entity_stakeholders.entity_kind` CHECK.
- State-machine trigger on `workspace` for stack_state transitions.
- Mutation-guard triggers on `portfolio_item_types` and `portfolio_item`.

### `018_provision_change.sql`

- Modify `provision_tenant_defaults`: stop seeding `portfolio_item_types` (5 rows) and `PROD-00000001`. Keep `company_roadmap` + `SPACE-00000001` creation.
- Set new workspace rows to `stack_state = 'empty'`, `portfolio_preset_id = NULL`.
- Existing tenants are unaffected — their workspaces get `stack_state = 'locked'` and `portfolio_preset_id = <match of their current layers>`, with their existing `portfolio_item_types` rows remaining. Backfill job synthesises the matching preset row or marks the workspace as `preset_slug = 'legacy'` (reserved slug for migrated stacks).

### `019_portfolio_legacy_cutover.sql` (later phase)

- Dual-write to `portfolio_item` from `portfolio` / `product` writers.
- Switch readers.
- Drop `portfolio` and `product` tables.
- Re-point execution-item FKs (when execution tables exist) to `portfolio_item`.

## Phasing

1. **Phase 1 — preset pick + two-party lock for new tenants.** Migration 017 + 018. UI for new-workspace flow. Legacy tenants stamped as locked+legacy; their `portfolio` / `product` continues to work.
2. **Phase 2 — custom builder.** Drag-to-order layer editor for the Custom card. Feature-layer flag. Ships the builder route.
3. **Phase 3 — legacy cutover.** Migration 019. Dual-write, backfill, switch reads, drop old tables.
4. **Phase 4 — audit log hash chain backfill.** Once the full `events` design lands, re-hash all rows written in the minimal placeholder.

## Risk register

- **S1 — self-lock bypass.** A user who holds both gadmin and padmin on a workspace could lock their own proposal. Mitigation: server trigger enforces `stack_locked_by != stack_proposed_by`. Trigger: Phase 1 test coverage.
- **S1 — unlock with live work.** Support unlock while execution items exist would silently invalidate referenced types. Mitigation: unlock RPC counts execution items referencing any `portfolio_item` in the workspace; refuses if nonzero. Trigger: Phase 3 (when execution items exist in the schema).
- **S2 — minimal events table lacks hash chain.** Rows written in Phase 1 have no tamper evidence. Mitigation: documented debt; Phase 4 re-hash pass. Trigger: start of audit-log full implementation.
- **S2 — legacy `portfolio` + `product` tables coexist with `portfolio_item`.** Dual-reader state is confusing until Phase 3. Mitigation: mark both legacy tables as deprecated in their table comments; new code must write `portfolio_item` only. Trigger: any new writer against `portfolio` or `product` post-Phase-1.
- **S2 — per-workspace type uniqueness migration.** Existing `portfolio_item_types` rows are tenant-scoped; backfill must assign each to a workspace correctly. Mitigation: backfill copies to SPACE-00000001 (the seeded workspace per tenant) and logs any tenant with multiple workspaces for manual review. Trigger: Phase 1 deploy to tenants with >1 workspace.
- **S3 — preset catalogue drift between envs.** Adding a preset is a seed-data change; staging and prod could diverge. Mitigation: preset seeds live in the migration, not in runtime config. Trigger: never, if discipline holds.

## Open decisions

- **Seed asset naming.** "My first <layer name>" is a placeholder. Confirm tone — should seeds be named after the layer only ("Feature", "Strategic Objective") so they're obviously examples?
- **Preset upgrade path.** If we later add a 7th preset that a tenant wants to switch to, what's the migration? Today: support unlock + re-propose. Is that good enough, or do we need a data-preserving "map my stack onto the new preset" tool?
- **Visual stack map on cards.** Text chips vs icons vs a small diagram. Text chips cheapest; revisit after the first card design exists.
- **Jira single-layer UX.** A picker card that expands to show one layer may feel anaemic. Consider a subtitle on the Jira card explaining "Light-touch: one portfolio layer, execution stack below."

## Pointers

- Current schema: [`docs/c_c_schema_portfolio_stack.md`](../../docs/c_c_schema_portfolio_stack.md), [`docs/c_c_schema_item_types.md`](../../docs/c_c_schema_item_types.md).
- Provisioning function: `db/seed/001_default_workspace.sql` — `provision_tenant_defaults` + `trg_provision_on_first_gadmin`.
- Stub page to replace: `app/(user)/portfolio-settings/page.tsx`.
- Event audit log (dependency): [`feature_event_audit_log.md`](feature_event_audit_log.md).
- Polymorphic writer rules: [`docs/c_polymorphic_writes.md`](../../docs/c_polymorphic_writes.md).
- SOW (source of the SOW-era Agency stack): `local-assets/sow/StatementOfWork_Original r1.0.1.md` §2.

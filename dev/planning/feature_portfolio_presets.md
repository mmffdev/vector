# Feature — Portfolio stack presets, two-party lock, and workspace governance

Status: **proposal / not started.** Captures the 2026-04-23 → 2026-04-24 design sessions. Supersedes any earlier assumption that `portfolio_item_types` is always seeded at tenant provisioning, and any earlier model where Roadmap sat above Workspace. Vocabulary update: **Subscription** replaces **Tenant** throughout.

---

## Vocabulary changes (load-bearing)

This plan introduces three terminological shifts that the rest of the document uses:

- **Subscription** (was: Tenant). The contract / billing / ownership boundary. One Barclays-the-customer = one Subscription. The schema column rename is `tenant_id → subscription_id` (and `tenants → subscriptions`).
- **Workspace** is now the unit of operational governance. It owns its own roadmap, its own portfolio stack shape, its own grant ceiling, its own PAdmin(s).
- **Roadmap** moves down a level. Was `company_roadmap` (one per Subscription). Becomes `workspace_roadmap` (one per Workspace). See "Roadmap relocation" below.

The Subscription → Workspace → Portfolio Stack → Execution model now matches Rally's published data model — see the precedent citation in the next section.

---

## Why the per-workspace shape is right (Rally precedent)

Rally (CA Agile Central / Broadcom Rally Software) ships exactly this shape in production. From their public docs:

> "You can have one set of portfolio item types per workspace. All of the customizations that you make are available across each project/team in the workspace…"

Key facts from Rally's model that validate ours:

- `PortfolioItemType` is **workspace-scoped**, not subscription-scoped.
- Each workspace's portfolio item types have their own ordinals (parent-child position).
- Different workspaces in the same subscription **can have different shapes** — different depths, different layer names, different parent-child chains. e.g. Workspace A: `Initiative → Feature`. Workspace B: `Strategy → Initiative → Capability → Feature`.
- The subscription only seeds defaults at workspace creation; there is no "master hierarchy" that workspaces inherit from.

Sources (Broadcom TechDocs):
- https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/customizing-portfolio-item-types/portfolio-item-types.html
- https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/configuring-objectives-for-your-workspace/customize-objective-hierarchy-levels.html
- https://knowledge.broadcom.com/external/article/47750/how-workspace-scoping-in-the-rally-ui-af.html

**The Barclays example.** A single Barclays Subscription contains four Workspaces:

- Workspace 1: Investment Banking
- Workspace 2: Retail b2c (UK)
- Workspace 3: Retail b2b (UK)
- Workspace 4: Group back-office (HR, Legal, Audit, PMO)

Each workspace has its own PAdmin, its own portfolio stack shape, its own grant ceiling. Investment Banking and Group back-office should not share a roadmap, a portfolio hierarchy, or even visibility by default. This is Rally's model in production.

---

## What we're changing

Out-of-the-box state: a Subscription's `portfolio_item_types` and `portfolio_item` tables are **empty for each workspace**. No default stack shape is imposed.

On first visit by a GAdmin to a workspace's **Portfolio Settings**, the page renders a picker of **5 preset hierarchies + Custom** (6 cards). Choosing one seeds:

1. One `portfolio_item_types` row per layer (with tag, name, sort_order).
2. One `portfolio_item` seed asset per layer (named "My first <layer>"), nested per the layer order so the seed is a single chain.

The seeded stack is in state `proposed`. A **PAdmin** must accept it to move to state `locked`. Until locked, no execution work can be assigned. Once locked, the layer catalogue is immutable to both roles — changes require a support-issued unlock, refused if any execution item references a `portfolio_item` in that workspace.

Workspaces are independent: a Subscription with Production, Training, and Testing workspaces can hold three different stack shapes, each with its own lifecycle.

---

## Why this shape

- **Empty-by-default** removes the assumption that every customer wants the Agency shape (Product → Theme → Business Objective → Feature). Enterprise, Rally, Jira, and SAFe customers do not.
- **Presets as data, not code** — adding a 6th preset is INSERTs into `portfolio_preset_layer`. No schema change, no code change.
- **Two-party lock** reflects real-world governance: the person who *proposes* the shape (GAdmin, configuring the subscription) is not the person who *operates* under it (PAdmin, running the workspace day-to-day). Both must agree before work is assignable.
- **Per-workspace** matches how customers actually run multiple environments. A Production workspace on SAFe and a Training workspace on Agency should not fight over a shared type catalogue. **Rally has shipped this for over a decade** — it is the proven enterprise model.

---

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
- **SAFe** has had Feature appended to the SOW-style chain so execution can hang off it consistently with the other presets. If a customer wants pure SAFe with execution hanging off Programme Backlog, they use the Custom builder.
- **Tag vocabulary** (2–4 chars, unique per workspace): PR/TH/BO/FE (Agency), SO/PO/BE/BC/FE (Enterprise, BC = Business outCome to disambiguate from BO = Business Objective), ST/IN/FE (Rally), IN (Jira), STH/PBL/PGB/FE (SAFe). GAdmin can override tags at layer creation from the Custom builder; preset seeds are fixed.
- **Plus a reserved 6th preset row** with slug `legacy` — never user-selectable. Used to stamp existing workspaces during the rename + roadmap-relocate migrations so their pre-existing stack shape has a home in the new model.

---

## Roadmap relocation (was company_roadmap)

**Move:** rename `company_roadmap` to `workspace_roadmap`. Re-parent it from Subscription to Workspace. One roadmap per workspace, not one per subscription.

This is **option 2a** from the design discussion — keep the table, re-parent it. We considered 2b (collapse roadmap into `portfolio_item` at a reserved top layer) and rejected it for v1: the table currently carries no unique business columns, but it may grow them, and the rename is a smaller migration than a structural collapse.

Backfill rule: **one workspace gets the existing roadmap row, others get a new empty roadmap on first access.** Specifically: for each existing `company_roadmap`, attach it to that subscription's SPACE-00000001 (the seeded first workspace). Any other workspaces in the subscription get a freshly-created `workspace_roadmap` row at first read, named after the workspace.

Implication for GAdmin reporting: a "Subscription overview" view becomes an explicit aggregation across workspaces (one query: `WHERE subscription_id = …`). This is **better** than the company_roadmap-rooted model, because the natural query path no longer invites cross-workspace data leaks. Workspace 1's PAdmin physically cannot see Workspace 2 by descending a tree that does not exist.

---

## Workspace grants and governance ceiling

The access-control layer that makes this product saleable to regulated customers (banks, insurers, public sector). Two orthogonal constraints, composing into a single rule.

### Constraint 1 — role ceiling (already in standing memory)

No member can grant a level higher than their own. PAdmin can grant `editor` but not `padmin`. Editors and viewers cannot grant. GAdmin can grant up to subscription-wide GAdmin.

### Constraint 2 — workspace governance ceiling

A GAdmin can override Constraint 1 *downwards* on a per-workspace basis by setting a `grant_ceiling` on the workspace itself. PAdmins of that workspace cannot issue grants above the ceiling.

Effective grant power = **min(grantor's own level, workspace's grant_ceiling)**.

### Ceiling values

- `none` — workspace is invisible to everyone except its PAdmin(s) and GAdmins. PAdmin cannot grant anyone. Use for Risk, Audit, Compliance.
- `viewer` — PAdmin can grant `viewer` only.
- `editor` — PAdmin can grant `viewer` or `editor`. **Default for new workspaces.**
- `padmin` — PAdmin can grant up to co-padmin. Use for large workspaces needing a deputy.

### Ceiling change semantics

- **Loosening** (e.g. `viewer → editor`): applies immediately. Existing grants untouched; new grants up to the new ceiling become possible.
- **Tightening** (e.g. `editor → none`): existing grants **preserved**, new grants blocked. GAdmin sees a confirm dialog: "X existing editor grants will remain. Block new editor grants?" GAdmin may then run a separate revoke action to remove existing grants — each revocation is its own audit event.
- The ceiling change itself is an audit event: `portfolio.ceiling.changed`.

### GAdmin direct grant

GAdmin always bypasses the request-review flow — they are the authority. A GAdmin grant emits `portfolio.grant.issued` with an `origin: 'gadmin_direct'` payload field. PAdmins (or anyone below ceiling) must use the request flow.

### Request-review flow ("the massive part")

When a PAdmin hits the ceiling, they cannot grant — but they can file a governance request:

```
PAdmin (Sam on W2, ceiling=none) opens a team member's row
  → "Request elevated access"
  → form: subject user, requested level (viewer|editor|padmin),
          requested duration (permanent | time-boxed),
          scope note (free text → tokenised),
          justification (free text → tokenised)
  → submits → workspace_grant_request row, state=pending
  → audit event: portfolio.grant.requested

GAdmin notification: "W2 has a grant request from Sam for user Tom"
  → reviews → approve / deny / modify
    - approve → workspace_grant row created, state=granted
                → audit event: portfolio.grant.approved
                → notify PAdmin (and the original requester if different)
    - deny    → request row state=denied
                → audit event: portfolio.grant.denied
                → notify PAdmin only
    - modify  → reduces level or duration before granting
                → audit events: portfolio.grant.modified + portfolio.grant.approved
                → notify PAdmin

PAdmin can withdraw an open request:
    → state=withdrawn
    → audit event: portfolio.grant.withdrawn
    → no notification (PAdmin originated it)
```

### Denial visibility

PAdmin sees the full resolution (approved / denied / modified) and any reason note from the GAdmin. Subject user is **not** notified of the request unless it was approved. Bank-culture-friendly default: an "I was considered for a grant but denied" notification can leak organisational signal that some customers will not tolerate.

### Subscription-wide grants

**Not in v1.** Each workspace grant stands alone. When the future "global rights" feature lands (e.g. "make Tom viewer on every workspace in this subscription"), it expands to N per-workspace grants under the hood — same audit shape, same revocation paths, no parallel grant model. Avoids two ways to express the same authority.

### Server enforcement (belt and braces)

Grant-issuance endpoint checks, in order:

1. Actor has a grant on the workspace at level ≥ their target grant level (Constraint 1).
2. Actor's target grant level ≤ workspace's `grant_ceiling` (Constraint 2), unless actor is GAdmin.
3. Self-elevation is forbidden (`actor_id != subject_id`).
4. Removing the last `padmin` from a non-locked workspace is forbidden (no orphan workspaces).

Rules 1–2 enforced by middleware + a CHECK-style trigger on `workspace_grant`. Rules 3–4 are business logic in the grant service.

### Single access resolver (mandatory)

Every backend access check **must** route through one shared SQL function defined in migration 020:

```sql
fn_user_access_level(p_user_id UUID, p_workspace_id UUID) RETURNS TEXT
  -- Returns one of: 'gadmin', 'padmin', 'editor', 'viewer', 'none'
  -- Resolution order:
  --   1. If users.role = 'gadmin' AND user.subscription_id = workspace.subscription_id
  --        → 'gadmin' (implicit, not stored in workspace_grant)
  --   2. ELSE look up workspace_grant where (workspace_id, user_id);
  --      if expires_at IS NOT NULL AND expires_at <= NOW() → 'none'
  --      ELSE return access_level
  --   3. ELSE → 'none'
```

Note the resolver's return value space (`'gadmin' | 'padmin' | 'editor' | 'viewer' | 'none'`) is deliberately wider than `workspace_grant.access_level`'s CHECK domain (`'none' | 'viewer' | 'editor' | 'padmin'`) — `'gadmin'` is role-implicit and never stored, only returned.

Rule: **no backend code or trigger may compose its own GAdmin-OR-grant check.** Every reader, writer, middleware, audit emitter, and trigger calls `fn_user_access_level`. A lint/CI check greps for forbidden patterns (`workspace_grant` reads outside the resolver) and fails the build if found. This eliminates the "one site forgets the GAdmin branch and a workspace becomes invisible to its own GAdmin" failure mode.

### Time-boxed grant expiry

A scheduled sweeper (cron-style, runs every 5 minutes) materialises expiry:

```
SELECT workspace_id, user_id FROM workspace_grant
WHERE expires_at IS NOT NULL AND expires_at <= NOW()
  AND access_level != 'none';
-- For each row:
--   UPDATE workspace_grant SET access_level = 'none', updated_at = NOW()
--   INSERT events (event_type = 'portfolio.grant.revoked',
--                  payload.origin = 'expiry_sweep')
--   notify the workspace's PAdmin(s)
```

`fn_user_access_level` returns `'none'` for already-expired rows even before the sweeper runs, so security never depends on the sweeper's freshness — the sweeper is for audit-event materialisation and notification only.

---

## Data model

### Renamed tables

- `tenants` → `subscriptions`
- `tenant_sequence` → `subscription_sequence`
- `tenant_id` columns across the schema → `subscription_id`
- `provision_tenant_defaults()` → `provision_subscription_defaults()`
- `company_roadmap` → `workspace_roadmap` (and re-parent — see below)

### New tables

```
portfolio_preset                       -- global catalogue, seeded once
  id              UUID PK
  slug            TEXT UNIQUE NOT NULL      -- agency/enterprise/rally/jira/safe/legacy
  title           TEXT NOT NULL
  description     TEXT NOT NULL
  is_user_selectable BOOLEAN NOT NULL DEFAULT TRUE   -- 'legacy' is FALSE
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

portfolio_item                         -- replaces portfolio + product (Phase 3)
  id              UUID PK
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT
  workspace_id    UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  type_id         UUID NOT NULL REFERENCES portfolio_item_types(id) ON DELETE RESTRICT
  parent_id       UUID REFERENCES portfolio_item(id) ON DELETE RESTRICT
  key_num         BIGINT NOT NULL CHECK (key_num > 0)
  name            TEXT NOT NULL
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  archived_at     TIMESTAMPTZ
  created_at, updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (subscription_id, key_num)

workspace_grant                        -- per-workspace per-user access tier
  -- Holds only DELEGATED access. GAdmins are NOT represented here;
  -- their access derives from users.role on the subscription. This avoids
  -- N×M backfill whenever a workspace is added.
  -- 'none' is permitted as a level value to record explicit revocations
  -- with audit trail (a tombstone row), but is treated as no-access at
  -- read time. Plain DELETE is also permitted; both produce a
  -- portfolio.grant.revoked event.
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT
  workspace_id    UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  access_level    TEXT NOT NULL CHECK (access_level IN ('none','viewer','editor','padmin'))
  granted_by_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  granted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  expires_at              TIMESTAMPTZ NULL
  governance_request_id   UUID NULL REFERENCES workspace_grant_request(id)
  origin                  TEXT NOT NULL CHECK (origin IN ('gadmin_direct','padmin_in_ceiling','approved_request'))
  PRIMARY KEY (workspace_id, user_id)

workspace_grant_request                -- request-for-review records
  id UUID PK
  subscription_id          UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT
  workspace_id             UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  requested_by_user_id     UUID NOT NULL REFERENCES users(id)        -- the PAdmin
  subject_user_id          UUID NOT NULL REFERENCES users(id)        -- who it's for
  requested_level          TEXT NOT NULL CHECK (requested_level IN ('viewer','editor','padmin'))
  requested_expires_at     TIMESTAMPTZ NULL
  scope_note_token         UUID NULL                                 -- → pii_lookup
  justification_token      UUID NULL                                 -- → pii_lookup
  state                    TEXT NOT NULL CHECK (state IN ('pending','approved','denied','modified','withdrawn'))
  resolved_by_user_id      UUID NULL REFERENCES users(id)
  resolved_at              TIMESTAMPTZ NULL
  resolution_note_token    UUID NULL                                 -- → pii_lookup
  resulting_grant_level    TEXT NULL CHECK (resulting_grant_level IN ('viewer','editor','padmin'))
  resulting_expires_at     TIMESTAMPTZ NULL
  created_at, updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()

events                                 -- minimal placeholder; full design lands later
  id UUID PK
  subscription_id          UUID NOT NULL
  workspace_id             UUID NULL
  entity_kind              TEXT NOT NULL
  entity_id                UUID NOT NULL
  actor_user_id            UUID NULL
  event_type               TEXT NOT NULL
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  payload                  JSONB NOT NULL DEFAULT '{}'::jsonb
  idempotency_key          UUID NOT NULL UNIQUE
  -- Monthly partitioning from day one. UPDATE/DELETE revoked.
  -- Hash-chain columns added later — see feature_event_audit_log.md.
```

### Modified tables

```
workspace
  + portfolio_preset_id          UUID REFERENCES portfolio_preset(id)
  + stack_state                  TEXT NOT NULL DEFAULT 'empty'
                                 CHECK (stack_state IN ('empty','proposed','locked'))
  + stack_proposed_at            TIMESTAMPTZ
  + stack_proposed_by            UUID REFERENCES users(id) ON DELETE RESTRICT
  + stack_locked_at              TIMESTAMPTZ
  + stack_locked_by              UUID REFERENCES users(id) ON DELETE RESTRICT
  + grant_ceiling                TEXT NOT NULL DEFAULT 'editor'
                                 CHECK (grant_ceiling IN ('none','viewer','editor','padmin'))
  + grant_ceiling_changed_at     TIMESTAMPTZ
  + grant_ceiling_changed_by     UUID REFERENCES users(id)

workspace_roadmap                      -- renamed from company_roadmap
  - subscription_id UNIQUE constraint dropped (was 1:1 with subscription)
  + workspace_id UUID NOT NULL UNIQUE REFERENCES workspace(id)
  -- Backfill: existing rows attached to subscription's SPACE-00000001;
  -- additional workspaces get fresh rows on first access.

portfolio_item_types
  + workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT
  -- Scope shifts from subscription-wide to per-workspace.
  -- Drops UNIQUE (subscription_id, tag) / (subscription_id, name).
  -- Adds  UNIQUE (workspace_id, tag) / (workspace_id, name).

entity_stakeholders
  CHECK entity_kind IN (..., 'portfolio_item', 'workspace_roadmap')

subscription_sequence (renamed)
  + new scope value: per-workspace 'portfolio_item' counter
    (encoded as '{workspace_id}:portfolio_item' or as a separate scope row)
```

### Triggers and guards

- `portfolio_item_types` INSERT/UPDATE/DELETE — reject if the target `workspace_id` has `stack_state = 'locked'`. (Support-unlock flips to `proposed` first.)
- `portfolio_item` INSERT — if `stack_state != 'locked'`, only the seed path may insert (SECURITY DEFINER function or session GUC). User-driven creates blocked until locked.
- `workspace.stack_state` transitions — state-machine trigger:
  - `empty → proposed` — requires `stack_proposed_by` set, `portfolio_preset_id` set, ≥1 layer + 1 item created in the same transaction.
  - `proposed → proposed` (re-propose) — permitted, clears prior layers + items, writes `portfolio.stack.reproposed`.
  - `proposed → locked` — requires `stack_locked_by` set, **different from** `stack_proposed_by` (self-lock forbidden), and `stack_locked_by` holds a `padmin` grant on the workspace.
  - `proposed → empty` (reject) — clears preset, layers, items; PAdmin only.
  - `locked → proposed` — support only, via privileged RPC; refused if any execution work item references a `portfolio_item` in this workspace.
- `workspace.grant_ceiling` changes — trigger writes `portfolio.ceiling.changed` event. **Does not** revoke existing grants (preserve-on-tighten rule).
- `workspace_grant` INSERT/UPDATE — trigger checks Constraints 1 and 2; rejects on violation; rejects self-elevation; rejects last-padmin removal on non-locked workspaces.
- `portfolio_item` INSERT/UPDATE — trigger asserts `type_id`'s row in `portfolio_item_types` has the same `workspace_id` as the item itself. Cross-workspace type assignment is forbidden.
- `portfolio_item.parent_id` — trigger refuses cycles (walk parent chain up to a depth cap; reject if `id` reappears) and refuses parents in a different workspace. Layer-skip is **permitted in v1** (a level-3 item may sit directly under a level-1 parent) — strict sequential-layer enforcement is deferred until we have customer feedback.
- GAdmin implicit access — `workspace_grant` table does **not** carry GAdmin rows. Access checks resolve as `gadmin_for_subscription(actor, workspace.subscription_id) OR EXISTS(workspace_grant…)`. This keeps the grant table clean (it represents only delegated access, not role-implicit access) and avoids combinatorial backfill when a Subscription gains a new workspace.

### What happens to `portfolio` and `product`

Both are legacy. Phase 1 keeps them in place for read compatibility. Phase 3 dual-writes, switches readers, drops them.

---

## Lifecycle + audit log

Every state transition writes two things in the same transaction:

1. **Current state** onto the relevant row (`workspace`, `workspace_grant`, `workspace_grant_request`).
2. **Immutable event** into the `events` table (master audit log; minimal placeholder per the bootstrap dependency below).

### Reserved event types

```
portfolio.stack.proposed            payload: { preset_slug, layers: [{tag, name, sort_order}] }
portfolio.stack.reproposed         payload: { preset_slug, layers, previous_preset_slug }
portfolio.stack.rejected            payload: { rejected_preset_slug, note_token? }
portfolio.stack.locked              payload: { preset_slug }
portfolio.stack.support_unlocked    payload: { ticket_ref, note_token }

portfolio.ceiling.changed           payload: { previous_ceiling, new_ceiling, note_token? }

portfolio.grant.issued              payload: { workspace_id, subject_user_id, level, expires_at?, origin }
portfolio.grant.revoked             payload: { workspace_id, subject_user_id, prior_level, note_token? }
portfolio.grant.requested           payload: { request_id, subject_user_id, requested_level, requested_expires_at? }
portfolio.grant.approved            payload: { request_id, granted_level, granted_expires_at? }
portfolio.grant.denied              payload: { request_id, note_token? }
portfolio.grant.modified            payload: { request_id, original_level, original_expires_at?, granted_level, granted_expires_at? }
portfolio.grant.withdrawn           payload: { request_id }
```

Stack events: `entity_kind = 'workspace'`, `entity_id = workspace.id`.
Grant events: `entity_kind = 'workspace_grant'` or `'workspace_grant_request'` as appropriate.
Free-text notes are tokenised per the audit log's PII rules (`*_token` columns → `pii_lookup`).

### Bootstrap dependency on the audit log

The master `events` table (per `feature_event_audit_log.md`) is partially-committed. Migration 019 creates the **minimal events table** described in the data model — enough to record stack + grant lifecycle without the hash chain. When the full audit-log design lands, a one-time re-hash pass backfills chain columns over rows written before then. Documented as Phase 4.

---

## Role permissions summary

- **GAdmin** (subscription-wide):
  - Propose / re-propose stack on any workspace.
  - Cannot lock a stack they themselves proposed (self-lock blocked).
  - Can change `grant_ceiling` on any workspace.
  - Can issue grants directly, bypassing request flow.
  - Can resolve grant requests (approve/deny/modify).
  - Implicit `padmin`-level access to every workspace in their subscription.
- **PAdmin** (workspace-scoped):
  - Accept / reject proposed stack on their workspace (cannot accept their own proposal — n/a, since PAdmin can't propose).
  - Can issue grants up to `min(padmin, grant_ceiling)`.
  - Can file governance requests for grants above the ceiling.
  - Cannot change `grant_ceiling`.
- **Editor** (workspace-scoped):
  - Read + write portfolio + execution items per workspace stack.
  - Cannot issue grants.
- **Viewer** (workspace-scoped):
  - Read-only.
- **Support** (us, off-platform):
  - Unlock a locked stack via privileged RPC, refused when execution items exist.
- **User without a grant**: workspace is invisible.

---

## Frontend

Portfolio Settings page at `app/(user)/portfolio-settings/page.tsx` — replaces the current stub. Rendered per workspace; routes are workspace-scoped.

### Stack states (per-role views)

- **Empty** (GAdmin): 6-card grid. Each card: title, stacked-chip visual of layers, description, Accept button → confirm dialog → `POST /api/portfolio-stack/propose`.
  - Custom card → `/portfolio-settings/builder` (drag-to-order layer list, add/rename/remove rows, mark one as Feature). Phase 2.
- **Empty** (PAdmin / others): "Waiting for GAdmin to propose a stack shape for this workspace."
- **Proposed** (GAdmin): stack visualised; banner "Awaiting PAdmin acceptance." Actions: Re-propose.
- **Proposed** (PAdmin): stack visualised + preset description. Actions: **Accept** / **Reject** (optional note).
- **Proposed** (others): "Stack shape pending approval. Ask your PAdmin to review."
- **Locked** (everyone): read-only tree. Footer: "Locked by <PAdmin> on <date>. Changes require support."
- **Locked + legacy** (existing workspaces post-rename migration): same view, footer reads "Migrated from legacy stack on <date>." Re-propose hidden.

### Workspace governance + access tab

New tab on Workspace Settings:

- **Members table** — every user with an `access_level != 'none'` on this workspace. Columns: name, level, granted by, granted on, expires (or "Permanent"), origin (Direct / Approved / Migrated). Each row clickable for full audit trail.
- **Invite / change** action — for GAdmin or for PAdmin within ceiling. Opens a modal: subject user, level, optional expiry. Submit → `POST /api/workspace-grants/:workspaceId`.
- **Disabled-invite-with-affordance** — when PAdmin is at ceiling, the Invite button is enabled but submitting routes to the **Request elevated access** flow (different modal: subject + requested level + scope note + justification). Submits → `POST /api/workspace-grant-requests/:workspaceId`.
- **Governance ceiling** card — GAdmin only. Shows current ceiling, "Change" action with confirm dialog. Tightening confirm: "X grants above the new ceiling will be preserved. New grants above the ceiling will be blocked. Continue?"
- **Pending requests** sub-table — GAdmin sees all pending requests for this workspace. PAdmin sees their own. Resolution actions (approve / modify / deny) inline.

### GAdmin inbox

New page `/inbox/governance`: cross-workspace pending requests. Filters: by workspace, by requester, by age. Bulk actions (approve all from this PAdmin) deferred to v2.

### CSS classes (BEM-lite, in `globals.css`)

- `.portfolio-presets`, `.portfolio-preset-card`, `.portfolio-preset-card__stack`, `.portfolio-preset-card__stack-chip`, `.portfolio-preset-card__actions`
- `.portfolio-stack-tree`, `.portfolio-stack-tree__node`
- `.workspace-grants`, `.workspace-grants__row`, `.workspace-grants__level-badge`
- `.workspace-grants__ceiling`, `.workspace-grants__ceiling-warning`
- `.governance-request`, `.governance-request__form`, `.governance-request__resolution`

No inline styles. Theme-token-driven.

### Backend routes

```
GET  /api/portfolio-stack/presets
GET  /api/portfolio-stack/:workspaceId
POST /api/portfolio-stack/:workspaceId/propose
POST /api/portfolio-stack/:workspaceId/repropose
POST /api/portfolio-stack/:workspaceId/accept
POST /api/portfolio-stack/:workspaceId/reject
POST /api/admin/portfolio-stack/:workspaceId/unlock      -- support only

GET  /api/workspace-grants/:workspaceId                  -- list members
POST /api/workspace-grants/:workspaceId                  -- direct grant (gadmin) or padmin-within-ceiling
DELETE /api/workspace-grants/:workspaceId/:userId        -- revoke
POST /api/workspace-grants/:workspaceId/ceiling          -- gadmin only

GET  /api/workspace-grant-requests/:workspaceId          -- list (filtered by viewer's role)
POST /api/workspace-grant-requests/:workspaceId          -- create request (padmin)
POST /api/workspace-grant-requests/:requestId/approve    -- gadmin
POST /api/workspace-grant-requests/:requestId/modify     -- gadmin (body has reduced level/expiry)
POST /api/workspace-grant-requests/:requestId/deny       -- gadmin
POST /api/workspace-grant-requests/:requestId/withdraw   -- requester (padmin)

GET  /api/inbox/governance                               -- gadmin cross-workspace request inbox
```

All writes transact state + event emission atomically.

---

## Migrations

### `017_subscription_rename.sql`

Pure rename. No structural change. Atomic.

- `tenants → subscriptions`
- `tenant_id → subscription_id` on every table
- `tenant_sequence → subscription_sequence`
- `provision_tenant_defaults() → provision_subscription_defaults()`
- All indexes and FK constraint names renamed accordingly.

Code PR follows in the same release: every Go reference to `tenant`, every frontend use of "tenant" (sparse), every doc.

### `018_workspace_roadmap_relocate.sql`

- `company_roadmap → workspace_roadmap`
- Drop UNIQUE on `subscription_id` (was 1:1).
- Add `workspace_id` UUID NOT NULL UNIQUE.
- Backfill: each existing row gets attached to its subscription's SPACE-00000001 workspace.
- Add `entity_kind = 'workspace_roadmap'` to `entity_stakeholders` CHECK.
- App-side: any workspace reading without a roadmap gets one auto-created on first access (named after the workspace).

### `019_portfolio_presets.sql`

- Create `portfolio_preset` + `portfolio_preset_layer`. Seed the 5 user-selectable presets.
- Seed the reserved `legacy` preset row, then **per existing subscription, populate `portfolio_preset_layer` rows from that subscription's actual current `portfolio_item_types`** so the legacy preset is descriptive rather than empty. (If a subscription has multiple workspaces with diverging types today, the layer set is built from the union; the post-migration manual-review log flags those subscriptions for follow-up.)
- Create `portfolio_item` table.
- Create minimal partitioned `events` table.
- Add stack columns to `workspace`: `portfolio_preset_id`, `stack_state` (default `'empty'`), `stack_proposed_at/by`, `stack_locked_at/by`.
- Add `workspace_id` to `portfolio_item_types`. Backfill copies subscription-scoped rows to the subscription's SPACE-00000001. Multi-workspace subscriptions logged for manual review. Swap UNIQUE constraints.
- Add `'portfolio_item'` to `entity_stakeholders` CHECK.
- State-machine trigger on `workspace.stack_state`.
- Mutation-guard triggers on `portfolio_item_types` (workspace-locked check) and `portfolio_item` (type-belongs-to-workspace check + parent_id cycle/cross-workspace guard).
- Backfill existing workspaces: `stack_state = 'locked'`, `portfolio_preset_id = legacy`.

### `020_workspace_grants.sql`

- Create `workspace_grant` + `workspace_grant_request` tables.
- Add `grant_ceiling` (default `'editor'`) + `grant_ceiling_changed_at/by` to `workspace`.
- Create the **`fn_user_access_level(user_id, workspace_id)` resolver function** described in the data-model section. SECURITY DEFINER, owned by the schema owner, GRANT EXECUTE to the app role only.
- Add a request-rate-limit table `workspace_grant_request_rate` (composite key: `requester_user_id, subject_user_id, workspace_id, window_start_at`) — the request endpoint increments and refuses creation if more than N requests in window M (defaults: N=3, M=24h, both `app_settings`-tunable).
- Backfill (excludes GAdmins — their access is role-implicit, not grant-mediated): every existing user with `users.role IN ('padmin','user')` gets a per-workspace grant matching their effective access today (PAdmin → `padmin` on every workspace in their subscription; users → `editor` by default, env-var-tunable per deployment via `BACKFILL_DEFAULT_GRANT`).
- Triggers: enforce constraints on `workspace_grant` insert/update; emit `portfolio.ceiling.changed` on `workspace.grant_ceiling` update.
- Build-time lint: CI grep refuses any new code path that reads `workspace_grant` directly outside the resolver function or `app/server/access/` package.

### `021_provision_change.sql`

- Modify `provision_subscription_defaults`: stop seeding `portfolio_item_types` (5 rows) and `PROD-00000001`.
- New workspaces created post-migration: `stack_state = 'empty'`, `portfolio_preset_id = NULL`, `grant_ceiling = 'editor'`.
- Auto-create the workspace's roadmap row.
- Auto-create a `padmin`-level `workspace_grant` for the workspace's `owner_user_id`.

### `022_portfolio_legacy_cutover.sql` (Phase 3, later)

- Dual-write to `portfolio_item` from `portfolio` / `product` writers.
- Switch readers.
- Drop `portfolio` and `product` tables.
- Re-point execution-item FKs (when execution tables exist) to `portfolio_item`.

---

## Phasing

1. **Phase 1a-i — Subscription rename.** Migration 017 only. Land in its own PR. **Smoke gate**: deploy to staging, run the full backend test suite, run the e2e suite, then merge. Do NOT bundle 018 — the rename has the largest blast radius of anything in this plan.
2. **Phase 1a-ii — roadmap relocation.** Migration 018. Separate PR, lands after 1a-i is green in production.
3. **Phase 1b — preset wizard + two-party lock.** Migrations 019 + 021. Backend grant routes (read-only, since grants exist via backfill). UI: portfolio settings page with picker + states; locked-legacy view for existing workspaces. **Test gate**: assert that a fresh Subscription post-021 has empty `portfolio_item_types` and no `PROD-00000001` (the headline behavioural change of this whole feature).
4. **Phase 1c — workspace grants + governance.** Migration 020 (depends on 019 for `events`, and 018 for the workspace-scoped roadmap). `fn_user_access_level` resolver. Backend write routes for grants + requests. Time-boxed-expiry sweeper job. UI: workspace settings access tab; ceiling card; request flow modals; GAdmin inbox.
5. **Phase 2 — custom builder.** Drag-to-order layer editor for the Custom card. Feature-layer flag.
6. **Phase 3 — legacy cutover.** Migration 022. Dual-write, backfill, switch reads, drop old tables.
7. **Phase 4 — audit log hash chain backfill.** Once full `events` design lands, re-hash all rows written in the minimal placeholder.

---

## Risk register

- **S1 — self-lock bypass.** A user holding both GAdmin and PAdmin grants on the same workspace could lock their own stack proposal. Mitigation: server trigger enforces `stack_locked_by != stack_proposed_by`. Trigger: Phase 1b test coverage. **Note** the guard is per-row only — it does not stop a two-person collusion (GAdmin A proposes, GAdmin B locks while A wears the PAdmin hat). That class of bypass is policy / audit, not schema; flagged for the audit-log review checklist.
- **S1 — cross-workspace type assignment.** A `portfolio_item` could be inserted with a `type_id` belonging to a different workspace's `portfolio_item_types`, breaking the per-workspace catalogue isolation. Mitigation: trigger on `portfolio_item` asserts `type.workspace_id = item.workspace_id`. Trigger: Phase 1b.
- **S1 — `parent_id` cycle.** Self-referential FK with no cycle guard makes orphan loops possible. Mitigation: trigger walks parent chain up to a depth cap and refuses cycles + cross-workspace parents. Trigger: Phase 1b.
- **S1 — unlock with live work.** Support unlock while execution items exist would silently invalidate referenced types. Mitigation: unlock RPC counts execution items referencing any `portfolio_item` in the workspace; refuses if nonzero. Trigger: Phase 3 (when execution items exist in the schema).
- **S1 — ceiling bypass via direct DB write.** A backend bug or careless raw SQL could insert a `workspace_grant` above the ceiling. Mitigation: trigger on `workspace_grant` re-checks Constraint 2 server-side. Trigger: Phase 1c.
- **S1 — last-PAdmin orphan.** Removing the only PAdmin from a non-locked workspace leaves the workspace unmanageable. Mitigation: trigger refuses; UI hides the revoke action when only one PAdmin remains. Trigger: Phase 1c.
- **S1 — request flow used to launder authority.** A PAdmin could repeatedly file requests under different justifications hoping a GAdmin rubber-stamps. Mitigation: `workspace_grant_request_rate` table (Phase 1c) refuses creation if more than N requests in window M for the (requester, subject, workspace) tuple. Defaults N=3, M=24h, both `app_settings`-tunable. GAdmin inbox additionally shows recent-request count per requester. Trigger: Phase 1c.
- **S1 — access-check forgets GAdmin branch.** A reader/writer that queries `workspace_grant` directly and skips the GAdmin-implicit branch makes the workspace invisible to its own GAdmin. Mitigation: single `fn_user_access_level` resolver function; CI lint refuses any new code path that reads `workspace_grant` outside the resolver or `app/server/access/` package. Trigger: Phase 1c (lint must land with the resolver).
- **S2 — minimal events table lacks hash chain.** Rows written before Phase 4 have no tamper evidence. Mitigation: documented debt; Phase 4 re-hash pass. Trigger: start of audit-log full implementation.
- **S2 — legacy `portfolio` + `product` tables coexist with `portfolio_item`.** Dual-reader state is confusing until Phase 3. Mitigation: deprecation comments on both legacy tables; new code must write `portfolio_item` only. Trigger: any new writer against `portfolio` or `product` post-Phase-1.
- **S2 — per-workspace type uniqueness backfill.** Existing `portfolio_item_types` rows are subscription-scoped; backfill assigns each to SPACE-00000001 and logs subscriptions with >1 workspace for manual review. Mitigation: review log + the runbook entry "Subscription has multi-workspace `portfolio_item_types` backfill conflict" (must be authored before 019 ships, not during). Trigger: Phase 1b deploy to multi-workspace subscriptions.
- **S2 — cross-workspace sharing forecloses on assumption.** Phase 1 may bake in an assumption that breaks future cross-workspace work-sharing options (reference / clone / detached namespace). Mitigation: a foreclosure-check checklist runs as part of Phase 1b code review — every new query, FK, or constraint is asked "would this still work if a `portfolio_item` could be referenced by entities in a different workspace?" Trigger: Phase 1b PR review; carry forward through Phase 2.
- **S2 — grant backfill misclassification.** Phase 1c backfill defaults non-PAdmin users to `editor`; some customers may want stricter defaults. Mitigation: deploy-time toggle (env var) controls backfill default level; document per-deployment. Trigger: Phase 1c.
- **S2 — ceiling-tightening confusion.** GAdmins may expect tightening to revoke existing grants above the new ceiling and may be surprised it doesn't. Mitigation: confirm dialog text spells out the rule; "Revoke all grants above ceiling" companion action available. Trigger: first user feedback on the ceiling card.
- **S3 — preset catalogue drift between envs.** Preset seed lives in migration, not runtime config. Trigger: never, if discipline holds.
- **S3 — request inbox volume.** A subscription with hundreds of workspaces may overwhelm a single GAdmin's inbox. Mitigation: filters + bulk actions in v2. Trigger: GAdmin reports >50 pending requests at once.

---

## Open decisions

- **Seed asset naming.** "My first <layer name>" is a placeholder. Confirm tone — should seeds be named after the layer only (e.g. just "Feature", "Strategic Objective") so they're obviously examples? Or should they include the workspace name?
- **Preset upgrade path.** If we later add a 7th preset that a workspace wants to switch to, what's the migration? Today: support unlock + re-propose. Is that good enough, or do we need a data-preserving "map my stack onto the new preset" tool?
- **Visual stack map on cards.** Text chips vs icons vs a small diagram. Text chips cheapest; revisit after the first card design exists.
- **Jira single-layer UX.** A picker card that expands to show one layer may feel anaemic. Consider a subtitle: "Light-touch: one portfolio layer, execution stack below."
- **Time-boxed grant expiry handling.** **Decided** — auto-downgrade to `'none'` via the sweeper described in the data-model section; emit `portfolio.grant.revoked` with `origin: 'expiry_sweep'`; notify the PAdmin(s). The resolver returns `'none'` for already-expired rows even before the sweep runs.
- **Revoking a grant above the new ceiling — bulk or per-row?** Tightening the ceiling does not auto-revoke; a separate "Revoke all grants above ceiling" action is offered. Should this be one click + confirm, or one row at a time?
- **Sub-second freshness on PAdmin notification.** **Deferred to post-1c.** v1 ships in-app badge + count only; email and push are out of scope for the launch.

---

## Parked exploration — cross-workspace work sharing

Real customer need surfaced 2026-04-23: teams in different workspaces will sometimes need to share ownership of work that originates in one workspace. Example: Team A in Workspace 1 (Investment Banking) owns a Business Objective at their layer 3; Team C in Workspace 3 (Retail b2b) takes delivery of part of that work.

The mismatch: Workspace 1 and Workspace 3 may have **different stack shapes**. Workspace 3's layer 3 might be a different layer name entirely, or Workspace 3 may not have a "Business Objective" layer at all. Sharing a container across workspaces therefore cannot assume matching layer semantics.

Observations that should shape a future design:

- **Same-level entities are easy.** User Stories exist at a fixed execution level — always. A story can be delegated across workspaces with no layer mismatch because the level is identical everywhere.
- **Container ownership is the hard bit.** Teams genuinely need to own the *container* of their work (the Business Objective, the Feature), not just borrow story-level fragments. A receiving team without the matching container has nowhere logically to park the inherited work.
- **Possible shapes to explore later:**
  - **Cross-workspace reference** — the shared item stays in its home workspace; the other workspace gets a read-only reference. Receiving team cannot own it, only contribute stories.
  - **Portable container clone** — the shared container is cloned into the receiving workspace at a "nearest-matching" layer, with an explicit link back to the origin. Requires a layer-mapping decision at share time.
  - **Detached-container namespace** — a per-subscription "shared work pool" that sits outside any workspace's portfolio hierarchy, referenced by both. Avoids layer mismatch by not having layers.
- **Governance interaction.** Any share mechanism must respect `grant_ceiling` + workspace grants on both sides. A locked-down workspace (ceiling=none) cannot silently accept shared work from another workspace.
- **Audit implication.** Every cross-workspace share is an audit event with both workspace ids on the event row.

Not in scope for v1. Flagging here so the preset/stack design does not foreclose on any of these options later. Ensure `portfolio_item.workspace_id` remains the sole parent reference (no assumptions elsewhere that two items with the same `type_id.name` are the same layer — type identity is workspace-local by design).

---

## Pointers

- Current schema: [`docs/c_c_schema_portfolio_stack.md`](../../docs/c_c_schema_portfolio_stack.md), [`docs/c_c_schema_item_types.md`](../../docs/c_c_schema_item_types.md).
- Provisioning function: `db/seed/001_default_workspace.sql` — `provision_tenant_defaults` + `trg_provision_on_first_gadmin` (both renamed in migration 017).
- Stub page to replace: `app/(user)/portfolio-settings/page.tsx`.
- Event audit log (dependency): [`feature_event_audit_log.md`](feature_event_audit_log.md).
- Polymorphic writer rules: [`docs/c_polymorphic_writes.md`](../../docs/c_polymorphic_writes.md).
- SOW (source of the SOW-era Agency stack): `local-assets/sow/StatementOfWork_Original r1.0.1.md` §2.
- Rally precedent (per-workspace `PortfolioItemType`):
  - https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/managing-your-workspace/customizing-portfolio-item-types/portfolio-item-types.html
  - https://knowledge.broadcom.com/external/article/47750/how-workspace-scoping-in-the-rally-ui-af.html
- Standing memory: `feedback_role_ceiling.md` (the role-ceiling rule that Constraint 1 formalises in the schema).

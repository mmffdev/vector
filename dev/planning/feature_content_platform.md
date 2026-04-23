# Feature — Content platform (umbrella paper)

Status: **proposal / umbrella.** Sets the vision, architecture, and build order for Vector's content surface (wiki, layout pages, editorial workflow, entity bindings). Per-phase design papers follow this one; this paper is the frame they hang on.

Session: 2026-04-23. Informed by prior papers (theme maker, event audit log, polymorphic writes, form drafts) and the architectural discipline already established in the codebase.

## The shape in one sentence

**A content surface inside Vector where documents and layout pages are natively bound to the work they describe, unified by a single block library, a single audit chain, and a single theming system — the wiki that knows what you're working on.**

## Why we're building this

- **Rally's unclosed gaps** — identity, wiki, OKRs — are the gaps every adopter works around with Notion, Confluence, Google Docs, or SharePoint. Closing them inside the work tool removes the seam between writing and doing.
- **Every mature deployment of a PM tool is a content problem in disguise.** At 100k seats, the difference between a tool that sticks and a tool that zombies is whether the *context* around the work lives inside the tool or leaks into five others.
- **The architecture already points this way.** We have `page_registry`, polymorphic FKs, tenant isolation, a theme system, a planned audit chain. A content surface isn't a green-field addition — it's the next layer on the foundation already built.
- **No one in the category does this well.** Confluence bolts onto Jira awkwardly. SharePoint is unmoored from any work model. AEM is priced for enterprise publishing and built for it. Notion and Coda are delightful but have no PM spine. The niche "PM tool with a first-class wiki tied to the work" is genuinely unoccupied.

## Positioning — the opinion we hold

> **The wiki that knows what you're working on.**

Operationalised:

- **Pages live under the work hierarchy** (workspace → portfolio → product → page), not in a parallel "spaces" world. No free-standing repositories. Unbound pages allowed but flagged and nudged to bind.
- **Every block that *can* show live data, *should*.** OKR cards show live progress. Work-item embeds show current status. Charts query the real DB at view time. A page is never a stale snapshot — it's a living view.
- **Editorial workflow follows scope, not a tenant flag.** Tenant- and product-scoped pages always go through Draft → Review → Signoff → Published by named reviewers (assigned by talent, not org role). Team- and individual-scoped pages are Draft → Published with no signoff. Abundance lives at the team and individual level; bar-raising lives at the product and tenant level.
- **The wiki and the work share one audit chain.** "Show me everything that changed about this OKR last quarter" returns code, work, *and* writing in one timeline — because they're all events in the same chain.
- **No free-form anarchy.** Blocks are a closed set, extended deliberately. Theming is constrained to the token system. Editorial chaos is prevented by the shape of the tool, not by training.

What this opinion **rejects**:
- A "SharePoint-lite" free-form content repository with permissions as the primary gravity.
- A "Notion clone" optimised for individual expression over organisational alignment.
- An "AEM for product teams" — the publishing workflow is a *feature*, not the foundation.

## Architecture — what it looks like

### Page kinds

Two kinds, stored in the same `page_registry` with a `kind` discriminator:

- **`document`** — document-flow editing (prose, lists, tables, embeds). TipTap under the hood. Vertical stream, reading-oriented. The wiki.
- **`layout`** — canvas-flow editing (sections, columns, widgets, positioning). Puck under the hood. 2D composition, scanning-oriented. The AEM-flavoured surface for dashboards, OKR hubs, team landings.

Same URL space, same permissions, same audit chain, same block library. The editor differs; the semantics are identical.

### Shared block library

One React component per block, registered with both editors. The catalogue (extended per phase):

| Block | Renders | Binds to |
|---|---|---|
| Text / heading / list | inline content | — |
| Table | static or query-driven | optional DB query |
| Work-item card | live status, assignee, progress | `item_id` |
| Work-item list | filtered live list | portfolio / product / query |
| OKR card | objective + key-result progress | `okr_id` |
| OKR hierarchy | tree of objectives with rollup | workspace / portfolio |
| User card | avatar, role, contact | `user_id` |
| Team roster | members of a workspace/portfolio | `workspace_id` / `portfolio_id` |
| Chart | bar / line / pie from a saved query | `query_id` |
| Status rollup | aggregate status across a set | portfolio / product |
| Page embed | another page inline | `page_id` |
| Page list | child pages under a scope | workspace / portfolio / product |

Each block that binds to an entity registers a **reverse edge** in the `page_refs` table on save — so the referenced entity's detail page can show "5 pages reference this."

### Bidirectional link table

Same polymorphic discipline as `page_entity_refs` and `entity_stakeholders`:

```
page_refs (
  id uuid,
  tenant_id uuid,
  page_id uuid,
  block_id uuid,               -- block within the page
  entity_kind text,            -- 'work_item', 'okr', 'user', 'portfolio', 'product', 'query', 'page'
  entity_id uuid,
  created_at, archived_at
)
```

- Writer goes through the `entityrefs` service pattern (tenant-checking, orphan-preventing, same discipline as existing polymorphic refs — see `docs/c_polymorphic_writes.md`).
- On page save, the client sends the new set of references; the server diffs against current rows and inserts/archives as needed.
- On entity archive, `CleanupChildren` removes `page_refs` entries — same registry as the other polymorphic relationships.

Read side:
- **Page → entities**: JOIN `page_refs` to the target table, UNION across kinds, filter by tenant.
- **Entity → pages**: filter `page_refs` by `(entity_kind, entity_id, tenant_id)`.

Neither direction trusts the polymorphic row alone — both JOIN through to live parents, so an orphan never surfaces as a live link.

### Content storage

Content is **JSON, not markdown.** Reasons:
- Block-aware from day one; custom blocks are first-class, not "markdown + extensions."
- TipTap and Puck both serialise to JSON; round-trip is lossless.
- Migration to a different editor later is a JSON-to-JSON transform, not a re-parse.
- Markdown has no native representation for layout blocks, binding metadata, or per-block visibility rules.

```
page_content (
  page_id uuid PRIMARY KEY,
  tenant_id uuid,
  kind text,                 -- 'document' | 'layout'
  content jsonb,             -- current serialised editor state
  schema_version int,
  updated_by uuid,
  updated_at timestamptz
)

page_content_versions (
  id uuid,
  page_id uuid,
  tenant_id uuid,
  content jsonb,             -- snapshot at save time
  schema_version int,
  saved_by uuid,
  saved_at timestamptz,
  version_label text,        -- optional (auto-versioned or user-labelled)
  source_event_id uuid       -- links to the audit event for this save
)
```

Every save writes to both tables — `page_content` for current state (single row per page), `page_content_versions` for history (append-only). Rollback is a copy from versions → content, itself recorded as a new version.

### Editorial workflow

Gating follows the **page's scope**, not a tenant-wide tier. Four scopes, two workflow shapes:

**Reviewed scopes — full Draft → Review → Signoff → Published:**
- **Global (Tenant) pages** — anything published at the tenant level is visible to every member; the bar is "are we happy this represents us." Full workflow, always.
- **Product pages** — the product's canonical surface; same bar, same workflow.

**Unreviewed scopes — Draft → Published, author is owner:**
- **Team pages** — team-local knowledge, meeting notes, working docs. No signoff; abundance is the point.
- **Individual pages** — personal scratch, drafts-in-progress, private notes. Same as team, scoped to one user.

A team or individual page can be **promoted** to product or tenant scope; promotion triggers the reviewed workflow from that point (the page enters `in_review`, not auto-published).

**Reviewers are named user accounts, not role-derived.**
- Each reviewed scope declares a roster of reviewer slots with a **talent label** (e.g. "Product copywriter," "Brand guardian," "Legal reviewer," "Technical editor").
- A slot is filled by a specific user account — often a team member whose *talent* is copywriting even if their org role is something else.
- Multiple slots per scope are supported (e.g. tenant-level pages need copywriter + brand + legal); a publish requires all assigned slots to sign off.
- Slots are managed separately from org roles, in a roster UI we'll detail in the per-phase paper.

States across both shapes: `draft`, `in_review` (reviewed scopes only), `signed_off` (reviewed scopes only — all slots approved, ready to publish), `published`, `archived`. Every transition emits an audit event with actor, previous state, next state, and (for approvals) which slot signed off.

Scope-based gating means no tenant flag to toggle and no migration when a tenant matures — the same rules apply from day one; the product/tenant levels simply go unused until someone creates a page there.

### Theming integration

- Both editors render content through the theme-maker tokens — a page looks like Vector, not like a stock TipTap surface.
- Layout pages can **locally override** theme tokens at the section level (e.g. a hero section with a custom background colour) within the bounds of the theme maker's approved vocabulary. No arbitrary CSS.
- Block library components are authored against the token system, so theme changes propagate through pages automatically.

### Audit integration

Every content mutation emits an event to the audit chain defined in `feature_event_audit_log.md`:

- `page.created`, `page.updated`, `page.published`, `page.archived`
- `page.reverted` (with the version id restored from)
- `page_content.saved` (each auto-save or manual save — lighter, high-volume; may be rate-limited)
- `page_workflow.submitted`, `page_workflow.signed_off` (with slot + reviewer), `page_workflow.rejected` (with notes), `page_workflow.promoted` (scope change from team/individual to product/tenant) — reviewed scopes only

The `source_event_id` link in `page_content_versions` lets "show me all changes to this page last quarter" join to the same chain that covers work-item changes — one unified timeline.

### Deployment model — modular monolith, licence-gated

The content platform is a **paid add-on**, but isolation is *commercial*, not *physical*. It ships as a module inside Vector — same Postgres, same Go binary, same frontend build — with a hard internal boundary and a licence flag controlling exposure. This was weighed against a fully separate codebase + database + "handshaker" integration service and rejected: the integration tax on cross-process polymorphic FKs, a split audit chain, mirrored tenant/theme/role state, and doubled ops for a solo-operated project outweighed the commercial-separation benefit, given a package seam achieves the same discipline.

**Schema is always present; the feature is dormant until licensed:**
- Migrations create all content tables (`page_registry` extensions, `page_content`, `page_content_versions`, `page_refs`, `reviewer_slots`, `reviewer_roster`, workflow-state columns) on every tenant from Phase 1 onwards.
- Empty tables cost nothing. No conditional migrations, no per-tenant schema drift.
- Licence flag on `tenants.licences.content_platform` (or similar) gates exposure:
  - Routes under `/content/*` return 404 when the flag is off.
  - Nav entries do not render in the sidebar group catalogue.
  - API handlers return `403 feature_not_licensed` on mutation and read paths.
  - `entityrefs` does not register the `page_refs` kind, so other parts of the app cannot create references to content entities.
- Turning the flag on lights up the full surface — no deploy, no migration, no data move. Turning it off puts the feature back to sleep; rows persist, routes go dark.

**Handshaker as a Go package seam, not an HTTP hop:**
- Other Vector modules (work items, OKRs, users, portfolios) only reach content data through a single Go package — `pkg/content/handshake` or equivalent. That package exposes the read and write surface; direct table access from outside is disallowed by convention and enforced in code review.
- The package owns the licence check, the tenant check, and the audit-event emission for content mutations. Callers never hand-roll those.
- If commercial scale ever justifies a physical split (separate service, separate DB, separate repo), the seam is already drawn. The move becomes: replace the package's in-process calls with gRPC/HTTP, add an outbox for cross-DB consistency, run the two halves side-by-side. Until that day, we pay none of that cost.

**What stays unified:**
- **Audit chain.** Content events flow into the same hash-chained chain as work-item events; one timeline, one WORM archive, one verifier.
- **Theme system.** Content renders through the same tokens; no mirror.
- **Tenant and role model.** No duplication; the content module calls the existing services.
- **Polymorphic FKs on `page_refs`.** Real FKs to `work_items`, `okrs`, `users`, etc. `TestNoPolymorphicOrphans` extends to cover the new table. No eventual-consistency integration layer required.
- **Backups, migrations, tunnels, secrets.** One set, one procedure.

**Commercial gate, enforced in three places:**
1. **Feature flag** on the tenant row — hot-togglable.
2. **Handshaker package** checks the flag on every entry point and refuses with a typed error if off.
3. **Nav/route layer** hides content surfaces entirely when off, so an unlicensed tenant never sees a broken link.

Licence changes are themselves audit events (`tenant.licence.content_platform.enabled` / `.disabled`) with actor and effective-from timestamp.

## Why WordPress-headless isn't the substrate

Considered seriously (and the session discussed the install base — The Sun, The Times, NYT subdomains, etc). Rejected because:

- **Second backend** — PHP + MySQL alongside Go + Postgres. Two stacks for the product's life.
- **Second user / auth model** — WP's capability system doesn't align with Vector's tenant + role model. Bridging is a constant tax.
- **Plugin attack surface** — WP's biggest CVE source; even minimal plugin use means a perpetual update treadmill gating Vector releases.
- **Wrong primitive** — WP is built around posts + categories + tags. Pages bound to live work items, OKRs, and portfolios is an awkward fit; you end up using WP as a glorified blob store + editor and building the differentiator on top.
- **No unlock on the moat** — bidirectional binding to work data has to be built from scratch on top of WP, not provided by it. We pay full WP cost and still build the hard part.
- **Newsroom-analogy doesn't transfer** — WP's editorial depth justifies itself at The Sun / NYT because those are newsrooms. Product teams documenting decisions for collaborators have a different workflow shape.

Revisit if Vector ever ships a public-marketing-pages product; for the internal content surface, no.

Recorded here so the reasoning is recoverable, not relitigated.

## Why not Notion / Coda / SharePoint / AEM

Short form (each could be its own paragraph; the shape is what matters):

- **Notion / Coda** — delightful UX, no PM spine. Binding to *our* work model requires us to build the integration against their APIs, which gives us the worst of both worlds: their data lives outside our tenant + our audit log, and we own the fragile sync.
- **SharePoint** — the generality-divorced-from-the-work trap. The thing we're explicitly positioning against.
- **AEM** — the right architecture for the wrong business. Six-figure licences, Java stack, consultant-heavy deployments, optimised for enterprise publishing (author → publish → reader), not for collaborators documenting their own work. We borrow its *architectural* lessons (authoring workflow, template/component library, content reuse, versioning) without adopting its *operational* cost.
- **Confluence + Jira** — the thing users have and complain about. The seam between the two is the pain we remove by merging them on one data substrate.

## Build order — phases as architectural layers, not a deadline

Each phase ships a thing that stands alone as worth having. The project could stop after any phase and still be a net-positive addition.

### Phase 1 — Document pages + block library + entity bindings (the Confluence replacement)
- `kind = 'document'` in `page_registry`.
- TipTap editor mounted on page detail.
- Block library v1: text, heading, list, table, work-item card, OKR card, user card, page embed, page list.
- `page_content` + `page_content_versions` tables.
- `page_refs` polymorphic link table + `entityrefs` writer extension + `CleanupChildren` registry update.
- Audit events for create/update/publish/archive.
- Scope-based workflow plumbing: team/individual = Draft → Published; product/tenant = Draft → Review → Signed-off → Published with named reviewer slots.
- Reviewer roster UI and slot assignment per scope.
- Per-phase paper: `feature_content_document_pages.md`.

### Phase 2 — Layout pages (the AEM-flavoured surface)
- `kind = 'layout'` in `page_registry`.
- Puck editor mounted on layout pages.
- Block library extended: chart, status rollup, team roster, work-item list, OKR hierarchy.
- Layout-specific concerns: responsive breakpoints, section-level theme overrides, reusable templates.
- Per-phase paper: `feature_content_layout_builder.md`.

### Phase 3 — Editorial workflow depth
- Scheduled publishing and embargo dates for product/tenant pages.
- Multi-step approval chains beyond single-slot signoff (e.g. copywriter → brand → legal in order, not parallel).
- Reviewer delegation and out-of-office handoff.
- Rejection cycles with threaded notes; reviewer dashboards for pending queues.
- SLA timers and notifications on outstanding reviews.
- Per-phase paper: `feature_content_editorial_workflow.md`.

### Phase 4 — Real-time collaboration (the delight layer)
- Yjs + TipTap collab + Puck collab.
- Presence cursors, awareness, concurrent editing.
- Transport: self-hosted `y-websocket` or `Hocuspocus`.
- Deferred deliberately — the differentiator is the data binding, not the collab UX. Ship Phases 1–3 first; collab becomes a multiplier once the foundation is valuable on its own.
- Per-phase paper: `feature_content_realtime_collab.md`.

### Phase 5 — Templates, sharing, presets
- Built-in templates for common shapes (OKR page, project brief, decision log, retro, architecture record, meeting notes).
- Tenant-level template library.
- User-to-user page duplication.
- Per-phase paper: `feature_content_templates.md`.

## Open decisions (carry forward)

- **Reviewer slot roster UX.** How users see and manage the roster of reviewer slots per scope — a settings page, an inline picker on publish, or both. Affects Phase 1 UI surface.
- **Promotion semantics.** When a team/individual page is promoted to product/tenant scope, does the page enter `in_review` with the promoter as author, or does it stay published and enter `in_review` only on the next edit? First is stricter; second is less disruptive. Leaning strict — promotion is the moment of bar-raising.
- **Reviewer slot granularity.** One roster per scope (tenant-wide), or per workspace/product/team unit? Leaning per-unit so a product team can pick its own copywriter without depending on tenant admin.
- **Licence enforcement granularity.** Whether the licence is a boolean per tenant or a tiered SKU (e.g. "document pages only" vs "document + layout + workflow depth"). Leaning boolean for v1; revisit if packaging calls for it.
- **Handshaker package layout.** Whether the seam is one package (`pkg/content/handshake`) or split by domain (`pkg/content/pages`, `pkg/content/refs`, `pkg/content/workflow`). Leaning one package with sub-types until surface area demands a split.
- **Embed vs transclude semantics.** When a page embeds another page, does editing the embedded page change the embedder? Current leaning: embed = live reference (edits propagate); copy = snapshot (edits don't). Needs UX affordance.
- **Comments on pages.** Inline comments (like Google Docs) vs a comment thread at the bottom. Probably both eventually; in Phase 1 defer entirely or ship thread-at-bottom only.
- **Search.** Full-text search across page content. Postgres full-text indexes are fine for v1; only reach for Elastic / Meilisearch if measured pain. Where does search UI live — a global bar, per-workspace, or both?
- **PDF / print export.** A regulated-tenant feature eventually (auditor hands you a quarter's worth of pages as evidence). Defer to after Phase 3.
- **Page moves across hierarchy.** Moving a page from portfolio A to portfolio B — how do `page_refs` behave? Current leaning: refs stay as-is (they're page-scoped, not hierarchy-scoped), but tenant-id must match on move (we don't support cross-tenant moves).
- **Public share links.** External-share a page read-only. Powerful, security-sensitive. Defer to a dedicated paper after Phase 3.
- **Block SDK for custom blocks.** Whether to eventually expose a "tenant can register their own block" API — plays into the custom apps paste-model work. Defer to after Phase 4.

## Risk register (umbrella; per-phase papers carry their own)

- **S1 — scope sprawl.** The surface area tempts endless extension. Mitigation: each phase ships a self-contained thing worth having; the paper's block catalogue is the contract; new blocks require explicit paper updates. Trigger: the backlog starts growing faster than ships.
- **S1 — licence gate bypass.** A code path reads or writes content tables directly, skipping the handshaker package — unlicensed tenants see or mutate data. Mitigation: all content reads and writes go through `pkg/content/handshake`; direct imports of `pkg/content/store` from outside the module are forbidden by a lint rule or architecture test; handshaker owns licence + tenant + audit checks; integration test asserts unlicensed tenant gets `403` on every content route and sees no nav entries. Trigger: Phase 1 gating.
- **S1 — XSS via user-authored content.** Blocks render user input; a misconfigured block is a script injection vector. Mitigation: server-side sanitisation on content save (TipTap's sanitiser + allowlist of attributes); no raw HTML block; CSP that forbids inline script; reviewer audit of every new block before ship. Trigger: Phase 1 gating.
- **S2 — JSON schema drift.** Block shape changes; old saved pages have stale structures. Mitigation: every block carries a `schema_version`; renderers handle current + previous N versions; migrations run on read when old versions are encountered. Trigger: any block shape change.
- **S2 — editor lock-in.** TipTap or Puck gets abandoned; migration cost. Mitigation: content stored as editor-agnostic JSON where possible; block components are ours (the editor is a mounting harness, not the data model). Trigger: low probability near-term; revisit if community signals change.
- **S2 — page-refs orphaning work items.** A bug in the writer leaves `page_refs` rows pointing at deleted items. Mitigation: canary test (same pattern as `TestNoPolymorphicOrphans`) extended to cover `page_refs`; `CleanupChildren` updated; dispatch trigger at DB layer as backstop. Trigger: Phase 1 schema landing.
- **S2 — content versions table unbounded growth.** Every keystroke save multiplies storage. Mitigation: debounce saves (e.g. one version per 5-minute window of continuous editing, plus on-publish, plus on-manual-save); old auto-save versions collapse into a single "auto-saved during session" range. Trigger: Phase 1.
- **S2 — reviewer slot bus factor.** A reviewer slot filled by one person becomes a bottleneck (holiday, departure). Mitigation: slots support a primary + fallbacks list; any filled user can sign off; Phase 3 adds delegation and out-of-office. Trigger: Phase 1.
- **S2 — promotion sneaks past review.** A team page with an embarrassing passage gets promoted to tenant scope without passing through review. Mitigation: promotion forces `in_review` state; published-at-old-scope version is retained in history but the promoted version must be signed off. Trigger: Phase 1.
- **S3 — block library drift from theme system.** A block hardcodes a colour instead of using theme tokens. Mitigation: CSS review checklist for every new block; linter rule if affordable. Trigger: Phase 1 onwards.
- **S3 — forever-project trap.** Umbrella scope tempts endless foundation work with nothing shipped. Mitigation: each phase must ship something that stands alone as a net-positive addition to the product, testable and reviewable on its own terms. Trigger: if two consecutive phases spend more time on "plumbing" than "value."

## Cross-references

Patterns and systems this paper builds on:

- **Polymorphic FK discipline** — [`docs/c_polymorphic_writes.md`](../docs/c_polymorphic_writes.md) — `page_refs` follows this exactly.
- **`entityrefs` service** — [`docs/c_c_entityrefs_service.md`](../docs/c_c_entityrefs_service.md) — the writer surface `page_refs` extends.
- **Audit log** — [`feature_event_audit_log.md`](feature_event_audit_log.md) — the chain every content event flows through.
- **Theme maker** — [`feature_theme_maker.md`](feature_theme_maker.md) — the token system blocks and layouts render against.
- **Form drafts (IndexedDB)** — [`feature_form_drafts_indexeddb.md`](feature_form_drafts_indexeddb.md) — the long-form editor inherits the same draft semantics for in-progress edits.
- **Custom apps paste model** — [`feature_custom_apps_paste_model.md`](feature_custom_apps_paste_model.md) — future block SDK may share guardrail architecture.
- **Page registry schema** — `db/schema/009_page_registry.sql` — the table this work extends.
- **Existing page structure** — [`docs/c_page-structure.md`](../docs/c_page-structure.md) — the route group conventions this integrates into.

## Pointers (external)

- **TipTap** — https://tiptap.dev/ — MIT; React-native; ProseMirror-based. Editor choice for document pages.
- **Puck** — https://puckeditor.com/ — MIT; React-native; visual page builder framework. Editor choice for layout pages.
- **Craft.js** — https://craft.js.org/ — MIT; alternative page-builder framework. Fallback if Puck proves insufficient.
- **Yjs** — https://yjs.dev/ — MIT; CRDT framework for Phase 4 collab.
- **Hocuspocus** — https://tiptap.dev/hocuspocus/introduction — Yjs server for collab transport.

## What comes next (after this paper)

Per the per-phase-paper plan:

1. `feature_content_document_pages.md` — Phase 1 detail: schema, API surface, TipTap config, block v1 catalogue with component contracts, migration plan, test approach.
2. `feature_content_layout_builder.md` — Phase 2 detail.
3. `feature_content_editorial_workflow.md` — Phase 3 detail.
4. `feature_content_realtime_collab.md` — Phase 4 detail.
5. `feature_content_templates.md` — Phase 5 detail.

Written on demand, not up-front. The umbrella holds; the phases fill in when each is the next thing to think about.

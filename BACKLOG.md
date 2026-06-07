# Feature Backlog

> Owned by Rick. Claude does not surface, prioritise, scope, or act on any item here unless Rick explicitly points at one by name. Treat as roadmap context only.

---

### VECTOR
- 2026-05-16 — URL-state purge: move work-items + risk filter/sort off `useSearchParams` to component state (or `users_view_prefs` backend pref if cross-device persistence wanted). Drives the new "URL is path-only" rule (feedback_url_is_path_only). Current bug: NavigationPie chip writes URL but tree doesn't refetch — fix arrives with the move. Companion: TD-FILTER-MULTI backend pay-down so multi-select sends `?item_type=epic,story` and returns the matching set.
- 2026-04-25 — API Framework & Docs, user scripted apps that run in Vector
- 2026-04-25 — Vector Test Cases
- 2026-04-25 — Tooling Integration - User Integrations and Reporting patchways and hooks, Jenkins etc.
- 2026-04-25 — Custom Pages - Microsoft Style Intranet type
- 2026-04-25 — Custom Page Builder, Wordpress Style page designer, Blocks, drag and drop + templates
- 2026-04-25 — Github Integration to User Stories (Work Items)
- 2026-04-25 — Sharing Pages 
- 2026-04-25 — Custom Charts and Graphs
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-04-25 — COMBAT tie in 

### ORIGO — Confluence-style Wiki
- 2026-04-25 — Confluence version for vector
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 

### SIGMA — OKRs
- 2026-04-25 — OKRs system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 

### FLUX — Design Thinking
- 2026-04-25 — Design Thinking system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 

### SPINE — Governance
- 2026-04-25 — Governance system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 

### VISION - Systems Thinking
- 2026-04-27 — Design a Systems Thinking 
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 

### COMBAT - Red Team
- 2026-04-27 — Design a Systems Thinking 
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 
- 2026-04-25 — VISION tie in 
- 2026-05-18 — COMBAT tie in 
- 2026-05-18 — TRACKER tie in 


### LINK - Supply Chain



### MODULES
- 2026-05-18 — Cyber Security Apps




### All systems
- 2026-04-25 — Paywall - subscription system 
- 2026-04-25 — Accounts segment and billing for gadmin and new account type [backoffice] boffice@mmffdev.com 
- 2026-04-25 — Governance 
- 2026-04-25 — Language Packs  
- 2026-04-25 — Branding Strategic
- 2026-04-25 — Branding Product Sub Level Ident

### OPERATOR PLATFORM — mmff.io (or similar)
> The website and back-office platform for MMFF as owner/operator of Vector and all associated systems. Separate from the product itself. Think of it as the control tower.

- 2026-04-28 — Public marketing site — product overview, pricing, feature highlights for Vector and sibling products
- 2026-04-28 — Operator login — owner/operator authentication, separate from gadmin/padmin/user roles inside the product
- 2026-04-28 — Tenant management — create, suspend, delete customer organisations; view plan, usage, billing status
- 2026-04-28 — Subscription & billing management — plan assignment, trial controls, invoice history, Stripe or equivalent integration
- 2026-04-28 — System health dashboard — service status across dev/staging/prod; DB migration version per environment; uptime indicators
- 2026-04-28 — DB schema sync monitor — confirm which migrations have run on each environment (dev / staging / prod) so drift is visible at a glance
- 2026-04-28 — Release management — push new versions, flag breaking changes, manage staged rollouts
- 2026-04-28 — Support ticket console — view and respond to support requests raised from within the product
- 2026-04-28 — Audit log viewer — cross-tenant audit trail for compliance and incident review
- 2026-04-28 — Feature flag control — enable/disable features per tenant or globally without a deploy

### Breakout Ideas
- 2026-04-25 — Support-ticket reply flow ("Respond above this line") — separate sub-system. Outbound: unique From per thread `support+ticket-12345@vector.xxx` (routing token, lands in shared support@ mailbox). Inbound: mailbox poller parses ticket ID from recipient, strips quoted history at marker, posts body as a comment on ticket #12345. Auth: verify sender email matches a ticket participant, or unauthenticated path with token-in-address — decide before building.

### PRISM — Visual MBSE / Diagram Engine
> A visual modelling product line — "build our own Visual Paradigm" (NOT Rhapsody; reference is `MMFFDev - Vector Assets/Papers/Visual Paradigm - Full Features.pdf`). The half Vector LACKS: a direct-manipulation diagram canvas + formal models (UML / SysML / BPMN / ArchiMate) + the 150+ casual diagrams. The differentiator is asymmetry — Vector already owns a world-class agile/backlog engine (work items, sprints, burndown, dependency maps, RACI), so a SysML block tracing to a sprint story is a foreign key, not a tool integration. VP bolts weak agile onto a modeller; we'd bolt native modelling onto a strong delivery engine. **PARKED 2026-06-07 — finish Vector first; building a product on a still-moving core would create the very contention we're avoiding. Resume trigger: Vector stable enough to be a frozen platform to build against.**

**Architecture (decided, parked):**
- 2026-06-07 — Platform/product split (Atlassian/M365 pattern). Vector-core (identity + Sentinel clamp + tenancy + billing/entitlement) = the shared **platform**; backlog AND modeller are sibling **products** on it. Products link by reference + a platform permission check, never by reaching into each other's tables.
- 2026-06-07 — **Platform facade seam:** the modeller imports ONE named contract (identity / tenant / `sentinel.FromCtx` clamp / entitlement) — extends the existing Sentinel seam (`useSentinel()` / `FromCtx`) that lint already enforces. Define-the-seam-now is cheap (facade + lint, moves no auth code); physically carving auth/sentinel into a real `platform/` layer is a LATER, separately-risk-assessed refactor — or never. Seam is invisible to the modeller either way.
- 2026-06-07 — **Biggest constraint = parallel-dev file contention** (NOT context size). The deciding factor. Shared chokepoints today that would block two streams: single migration dir (`db/vector_artefacts/schema/` NNN numbering), single `backend/go.mod`, single root `package.json`, `app/globals.css` (22.7k lines), `backend/cmd/server/main.go` wiring (69 services), shared CI + 21 lint-registry JSONs. A walled in-repo package does NOT solve this (boundary lint stops imports, not shared-file edits). → Leaning **separate repo** (own deps / migrations / CSS / CI / deploy = zero shared files, two streams structurally cannot collide), connected over HTTP to the platform facade with **Sentinel as sole authz authority — queried, not duplicated** (keeps one-clamp SOC 2 story). Final seam choice (separate repo vs shared DB) not locked.

**Open questions when resumed:**
- 2026-06-07 — Metamodel base: model-elements-AS-artefacts (reuse clamp/search/fields/dependency-maps free; may strain generic schema) vs separate `model_*` tables (clean metamodel, re-implements clamp) vs hybrid (artefact identity + model sidecar, mirrors wizard/sidecar pattern). Claude owes a recommendation-after-schema-analysis.
- 2026-06-07 — Editor: today's `<DiagramCanvas>` (`docs/c_c_diagram_canvas.md`) is read-mostly (dagre auto-layout, 3k-node graph viewer) — WRONG shape for authoring. Build a sibling authoring-grade `ModelCanvas` (palette, hand-drawn typed connectors, ports, selection/undo, element-vs-view split per VP's "Single model element, multiple views") over a SHARED low-level substrate (Canvas2D layers / d3-zoom / snap-grid / worker).
- 2026-06-07 — Decompose sequence: platform seam → model-repository spine (metamodel + element/view + clamp + backlog traceability) → ModelCanvas → first notation (UML class or SysML BDD) → traceability surface → export (XMI/ReqIF/image). Each its own spec → plan.
- 2026-06-07 — Module identity unresolved: new named line vs fold into existing VISION (Systems Thinking). Decide on resume.
- 2026-04-25 — VECTOR tie in
- 2026-04-25 — ORIGO tie in
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in
- 2026-04-25 — SPINE tie in
- 2026-04-25 — VISION tie in

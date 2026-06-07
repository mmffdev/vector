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

### TOGAF — Enterprise Architecture Alignment
> A governance/positioning module mapping Vector's own architecture onto TOGAF's Architecture Development Method (ADM). The thesis: the Service Pillars refactor (PLA065) and the DB consolidation (PLA064) are not just engineering moves — they are an enterprise-architecture story a defence/finance buyer's architecture-review board already knows how to read. Each ADM phase has a concrete artefact in this repo; the work here is to surface that mapping as a procurement/audit narrative (and, later, as a product capability — Vector helping *customers* run their own ADM). Reference framework: The Open Group TOGAF 10. Sibling to SPINE (Governance).

**Phase A — Architecture Vision:**
- 2026-06-07 — The Service Pillars north star (PLA065) as the architecture vision — one named contract per pillar, identity/tenant/scope owned solely by Sentinel. Statement of Architecture Work + stakeholder map (defence/finance buyer, SOC 2 / ISO 27001 audiences per `context/USER.md`).

**Phase B — Business Architecture:**
- 2026-06-07 — Map the 9 pillars to business capabilities (delivery, governance, identity, library spine, etc.); show the capability → pillar → service lineage so a capability gap is traceable to a missing/owned service.

**Phase C — Information Systems Architecture:**
- 2026-06-07 — Data architecture: the DB consolidation from PLA064 — two databases (`vector_artefacts` canonical tenant DB, `mmff_library` read-only spine), the dropped legacy `mmff_vector`, full-table-name column convention, cross-DB soft-ref boundary. SY003 is the substrate source of truth.
- 2026-06-07 — Application architecture: the 9 Service Pillars (PLA065) — service boundaries, sole-writer ownership, the Sentinel clamp as the cross-cutting authorisation seam.

**Phase D — Technology Architecture:**
- 2026-06-07 — Infrastructure layer: Docker Swarm dev tier (`infra/swarm/`), PostgreSQL, shared services (`backend/internal/shared/` + `app/lib/shared/` parity), transport segregation (`/_site` + `/samantha/v2`). Map standards/platform services to the technology stack.

**Phase E — Opportunities & Solutions:**
- 2026-06-07 — Migration sequencing distilled from PLA064 (DB consolidation) + PLA065 (pillars) — capability increments, work packages, transition architectures between the pre-merge and post-pillars states.

**Phase F — Migration Planning:**
- 2026-06-07 — Phased rollout plan: dependency-ordered work packages, per-environment migration version tracking (ties to the OPERATOR PLATFORM DB schema sync monitor), implementation roadmap with risk-assessed gates.

**Phase G — Implementation Governance:**
- 2026-06-07 — The compliance machinery as ADM governance: the `lint:*` ratchets (column-prefix, sentinel-clamp, no-direct-workspace-id, transport trio), architectural decision records (`docs/adr/`), and the `<report>` reporting system as the governance log. Architecture contracts enforced in CI.

**Phase H — Architecture Change Management:**
- 2026-06-07 — Continuous-compliance loop: the tech-debt register (`docs/c_tech_debt.md`, identify/measure/recommend), the SY system papers (SY003 regenerated on every substrate change), and the requirement-driven change pipeline keeping the architecture description from drifting from the substrate.

- 2026-06-07 — VECTOR tie in
- 2026-06-07 — SPINE tie in
- 2026-06-07 — COMBAT tie in

### GULLFOSS — PRINCE2 / Waterfall Delivery Management
> The waterfall counterpart to Vector's agile engine. Named after Gullfoss, the Icelandic "golden falls" where the river drops in two great stages — the visual metaphor for the module: work cascades through PRINCE2 stages and product-based plans like water over a sequence of ledges, each gate releasing the flow to the next. The thesis: Vector already owns a world-class agile/backlog spine (work items, sprints, dependency maps, RACI, audit), and the heavy structure a PRINCE2/waterfall shop needs — stages, registers, plans, gates — is largely a different *projection and lifecycle* over the same artefact substrate, not a different product. The differentiator is having both methodologies first-class in ONE platform with ONE identity/scope/audit model, so a regulated buyer can run waterfall where mandated and agile where it pays, without two tools and two audit trails. Reference research report: **RES068** (filed in parallel). Sibling to SPINE (Governance); candidate pillar or sub-pillar under the Service Pillars architecture (PLA065).

**What it is:**
- 2026-06-07 — PRINCE2 + classic waterfall delivery management for the Vector suite: managed-stage lifecycle, product-based planning, the seven PRINCE2 themes/registers, and a Gantt/critical-path view sitting alongside (not replacing) the agile backlog.

**Core capabilities:**
- 2026-06-07 — PID management — Project Initiation Documentation as a structured, versioned, auditable artefact (business case, project approach, controls, role assignments).
- 2026-06-07 — Stage gates — managed-stage boundaries with end-stage assessments; gate = a flow transition that requires sign-off before the next stage's products are released (the "cascade ledge").
- 2026-06-07 — Product-based planning — product breakdown structure, product descriptions, product flow diagram; deliverables as first-class typed artefacts.
- 2026-06-07 — PRINCE2 registers — Risk, Issue, Quality, Daily Log, Lessons, plus Configuration Item records; each a register artefact type with its own lifecycle and audit trail.
- 2026-06-07 — Gantt + dependencies — schedule view with critical path, baselines, and dependency links reusing the existing artefact dependency-map substrate (PLA074 / B23).
- 2026-06-07 — Exception management — tolerance tracking (time/cost/scope/quality/risk/benefit), exception reports, and exception plans when a stage forecasts a breach.
- 2026-06-07 — Work packages — the unit of authorised work handed to a team; an artefact item promoted/projected as a work package with acceptance criteria and Configuration Item links.
- 2026-06-07 — Benefits tracking — benefits-realisation plan tied to the business case; post-stage and post-project benefit reviews.

**Market angle:**
- 2026-06-07 — UK government mandates PRINCE2 (GDS / major-projects portfolio) — a hard procurement gate competitors using agile-only tooling cannot meet. NATO/defence and JSP-440-adjacent programmes run stage-gated waterfall. Financial services, pharma (validated/GxP), and construction/infrastructure all default to gated, document-heavy delivery. Aligns directly with the defence/finance buyer profile in `context/USER.md`.

**Architecture:**
- 2026-06-07 — Fits as a pillar or sub-pillar within the Service Pillars architecture (PLA065) — one named contract, sole-writer ownership of its stage/register/plan tables, identity/tenant/scope resolved solely by the Sentinel clamp like every other pillar. No parallel auth, no second tenancy model.

**Integration (reuse, don't rebuild):**
- 2026-06-07 — Artefact items become work packages (projection/promotion over the existing artefact substrate, not a new entity); flows become stage transitions and gate sign-offs; existing auth (Sentinel), audit trail, and notifications are reused wholesale. PRINCE2 registers map onto artefact types + the dependency-map and outbox patterns already in place.

**Competitive edge:**
- 2026-06-07 — Modern, award-bar UX over a methodology usually served by grey enterprise tooling; AI-assisted PID drafting, register triage, and stage-report generation; security-first (Trust-No-One, SOC 2 / ISO 27001 audit narrative); and — the asymmetry — waterfall and agile living side by side in one platform with one clamp and one audit log, so a regulated org isn't forced to choose the tool over the method.

- 2026-06-07 — VECTOR tie in
- 2026-06-07 — SPINE tie in
- 2026-06-07 — SIGMA tie in
- 2026-06-07 — VISION tie in

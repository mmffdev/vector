# Feature Backlog

> Owned by Rick. Claude does not surface, prioritise, scope, or act on any item here unless Rick explicitly points at one by name. Treat as roadmap context only.
> Active sprint work lives in Planka: `http://localhost:3333`

---

### VECTOR
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

### ORIGO — Confluence-style Wiki
- 2026-04-25 — Confluence version for vector
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### SIGMA — OKRs
- 2026-04-25 — OKRs system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### FLUX — Design Thinking
- 2026-04-25 — Design Thinking system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### SPINE — Governance
- 2026-04-25 — Design Thinking
- 2026-04-25 — Vector tie in 
- 2026-04-25 — Sigma tie in 
- 2026-04-25 — Flux tie in 
- 2026-04-25 — Origo tie in 

### Systems Thinking
- 2026-04-27 — Design a Systems Thinking system

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
- 2026-04-25 — Rebuild Planka container from fork: add column/list headers showing X/X item counts and rolling averages (cycle time, lead time) across lists.
- 2026-04-25 — Support-ticket reply flow ("Respond above this line") — separate sub-system. Outbound: unique From per thread `support+ticket-12345@vector.xxx` (routing token, lands in shared support@ mailbox). Inbound: mailbox poller parses ticket ID from recipient, strips quoted history at marker, posts body as a comment on ticket #12345. Auth: verify sender email matches a ticket participant, or unauthenticated path with token-in-address — decide before building.

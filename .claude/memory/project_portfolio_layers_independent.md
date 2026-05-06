---
name: Portfolio strategy layers are tenant-built and fully independent (max depth 10)
description: Each portfolio_item_types row is an independent strategy layer with its own flow; tenants choose their own depth (2 to 10 layers) and can change it any time
type: project
originSessionId: 67d23c1d-67ab-4f68-9e41-b57f3d3c96a9
---
Each row in `portfolio_item_types` is one independent strategy layer (Theme, Initiative, Capability, Feature, etc.). Tenants build their own hierarchy and can add or remove layers at any time — depths of 2, 3, 6, etc. are all valid. **Hard cap: 10 layers** (confirmed by user 2026-05-05). Layers do NOT share state machines; each layer holds its own flow keyed on `o_flow_tenant.portfolio_item_type_id`.

**Why:** Vector is multi-tenant and consciously does not impose a fixed portfolio model (unlike Rally's Theme/Initiative/Feature trio). Each subscription invents its own depth and naming. The flow system was designed around this — `o_flow_tenant` dispatches to one of system_artefact_type_id / tenant_artefact_type_id / portfolio_item_type_id with an exactly-one CHECK precisely so each portfolio layer can hold its own flow without sharing.

**How to apply:**
- Never write code that assumes a fixed portfolio depth or a specific layer name.
- Enforce the **10-layer cap** at the write boundary (subscription_id, ordered count) — surface a clean validation error rather than letting the 11th INSERT succeed.
- Never share a flow row across layers — every (subscription × portfolio_item_type) pair gets its own 5 (or N) flow rows.
- When a `portfolio_item_types` row is INSERTED, the application must auto-seed a default 5-state flow (Backlog/Ready/Doing/Completed/Accepted) into `o_flow_tenant` for that row. Without this hook, a tenant adding a new layer mid-life ends up with a layer that has no states.
- Deletion cascades naturally: `o_flow_tenant.portfolio_item_type_id` is `ON DELETE CASCADE`, so dropping a layer drops its flow rows with it.
- `o_flow_tenant` also dispatches to `system_artefact_type_id` (Work Items, Defects, Tasks, Test Cases, Strategic, Epics) and `tenant_artefact_type_id` (gadmin-invented custom types) — same independence rule applies there too.

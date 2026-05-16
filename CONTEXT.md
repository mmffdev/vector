# Vector — Domain Language

The shared vocabulary used across this codebase. When code, docs, and conversation disagree, this file is the canonical reference. Entries here are facts about the *domain*, not implementation details — see `docs/c_c_naming_conventions.md` for code-level naming.

## Language

### Artefacts

**Artefact**:
A row in `vector_artefacts.artefacts`. The single substrate for all work and strategy items the user manipulates. Has a type, a flow state, a workspace, a number, fields.
_Avoid_: "item", "record", "thing", "object" (legacy "obj_*" tables are retired — never reach for them as nouns).

**Artefact Type**:
A row in `artefacts_types` that defines the kind of artefact (Epic, Story, Defect, Task, Risk, Portfolio Item, Theme, etc.). Carries a name, prefix, scope, colour, parent, and field bindings.
_Avoid_: "item type" (used in legacy code paths, but the canonical noun is "artefact type"). The terms are equivalent at the JSON wire-tag boundary only.

**Scope**:
The substrate slice an artefact belongs to. Two values: `work` (delivery items — Epic, Story, Task, Defect, Risk, Portfolio Item) and `strategy` (layered taxonomy — Theme, Business Objective, Product, custom strategy layers). A third scope is deliberately not modelled.

**Source**:
The provenance of an artefact-type row. Two values: `system` (seeded by MMFF, present in every subscription) and `tenant` (added by the customer or mirrored per-workspace from a system row).

**Prefix**:
The short identifier code on an artefact type. 2–3 letters. Used to form artefact display IDs like `US-0001` (Story), `DE-0017` (Defect), `RSK-0042` (Risk).

### Work-scope artefact types

**Epic**, **Story**, **Task**, **Defect**, **Risk**:
The five system work-scope types. All top-level (no parent), all `source='system'`, all seeded per-subscription. They share a kind-aligned flow shape (backlog → todo → in_progress → done → accepted) but each carries its own flow + secondary state machine + field set.

**Portfolio Item**:
A sixth work-scope system type used as the bottom-most layer of the strategy adoption tree. Unlike the other five, it bridges the work/strategy scopes via the topology canvas.

### Flows

**Flow** (or **Default Flow** or **Primary Flow**):
The state machine an artefact moves through, identified by `flows.flows_is_default=TRUE` for the artefact type. One per artefact type. Drives the kanban columns, the kind-aligned UI (pills, badges), and the standard transitions. Examples: `Story Flow`, `Defect Flow`, `Risk Flow`.

**Secondary Flow**:
An additional non-default flow attached to the same artefact type. Used when the domain needs a richer parallel state machine — e.g. Defect's bug-lifecycle (`Defect State`: Submitted/Open/Fixed/In Test/Not Reproducible/Deferred) running alongside its delivery workflow. Names follow the pattern `<Type> State`.
_Avoid_: "substate", "alt flow", "auxiliary state".

**Flow State**:
A node in a flow. Has a kind (`backlog | todo | in_progress | done | accepted | cancelled`), a sort order, an `is_initial` flag, and an `is_pullable` flag (whether the state appears as a kanban pull target).

**Transition**:
A directed edge between two flow states within the same flow. May carry a required permission. Self-loops forbidden.

### Adoption

**Adoption**:
The process of materialising a system or library artefact-type definition into a tenant's workspace. System work types are mirrored per-workspace by `portfoliomodels.adopt_work_types`. Strategy types are adopted via the library spine (`mmff_library.portfolio_template_layer_definitions`).

**Library Spine**:
The shared catalogue of strategy-layer definitions in `mmff_library`. Read-only from the customer's perspective. Strategy-scope types reference it via `artefacts_types_id_library_layer`. Work-scope types do NOT use it.

### Tenancy

**Subscription**:
The top-level tenant unit. Owns workspaces. System artefact-type rows are keyed per-subscription (a subscription is a "tenancy boundary" — adding a new system type means inserting one row per existing subscription).

**Workspace**:
A subscription-scoped container of artefacts. The unit users perceive as "their project area." Has its own field admissions, adopted types, and topology.

**Tenant**:
At code level, a synonym for "subscription" (legacy nomenclature). The customer-visible noun is always "subscription"; internal column names sometimes still say "tenant" (e.g. `master_record_tenants`).
_Avoid_: in customer-facing UI; in code, tolerate the legacy term but prefer "subscription."

### Surfaces

**Surface**:
A user-facing rendering of artefact data. The same artefacts can appear on multiple surfaces. Examples: `/work-items` (the master list), `/risk` (filtered to risks), the topology canvas, a wizard.

**Risk-as-row**:
Pattern: Risk appears as a row inside `/work-items` alongside Epic/Story/Task/Defect — its primary home. Honours "risks are the same as defects" literally.

**Risk-as-page** (or **Filtered View**):
Pattern: `/risk` is a secondary surface that renders the same `artefacts` data filtered to `type=risk`, with a domain-specific summary header (severity × likelihood). One source of truth, two presentations.

## Relationships

- A **Subscription** owns many **Workspaces**.
- A **Workspace** holds many **Artefacts**.
- Every **Artefact** has exactly one **Artefact Type** and at most one **Flow State** (the current state).
- An **Artefact Type** has exactly one **Default Flow** and zero or more **Secondary Flows**.
- A **Flow** owns many **Flow States** and many **Transitions**.
- A **System Artefact Type** is seeded per-**Subscription**, then mirrored per-**Workspace** as a `tenant`-source row via **Adoption**.
- A **Risk** is an **Artefact** of type Risk; it appears on the `/work-items` **Surface** as a row and on the `/risk` **Surface** as a filtered view.

## Example dialogue

> **Dev**: "Are we adding Risk to the Defect Flow?"
> **Domain expert**: "No — Risk gets its own Default Flow called Risk Flow, with risk-tuned state names (Identified/Analysing/Mitigating/Closed/Accepted). Same five kinds though, so the kind-aligned UI keeps working. And Risk also has a Secondary Flow called Risk State that runs in parallel, same shape as Defect State."

> **Dev**: "Where does Risk live in the UI?"
> **Domain expert**: "Risk-as-row is primary — `/work-items` shows Risks alongside Epics, Stories, Tasks, Defects. The `/risk` Surface is a Filtered View of the same Artefacts, rendered with a risk-specific summary header. Defect doesn't have its own page; Risk does — that's the only deliberate asymmetry."

## Flagged ambiguities

- **"Item" vs "artefact"** — historic code uses "item" (e.g. `WorkItemsSummary`, `validItemTypesByScope`). Treat as legacy. The canonical noun is "artefact" and new code uses that.
- **"Tenant" vs "subscription"** — see entry above. Tolerate in internal column names; prefer "subscription" in conversation and new code.
- **"Defect Flow" vs "Defect State"** — they are TWO flows attached to the SAME artefact type. Defect Flow is the default; Defect State is the secondary. Calling either one "the defect workflow" is ambiguous and forbidden in design docs.

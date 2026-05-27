# FlowBoard — Kanban board component (design)

**Date:** 2026-05-27
**Author:** Rick + Claude (brainstorming pass)
**Status:** Draft — awaiting user review
**Scope flag:** Standalone component, will be controlled by samanthaAPI later. Page (`/value-flow`) is the v1 host.

---

## 1. Purpose

A Kanban board (`<FlowBoard>`) whose columns are the **custom flow states of a selected artefact type**, whose cards are the live artefacts at the current sentinel scope, and whose card movement triggers the existing flow-state PATCH (which already runs the rollup recalc for parents).

The board is a **view**, not a system of record. Like ObjectTreeV2, it builds from artefacts and does not own them. The only state it persists is **policy** (WIP limits) and **preference** (per-user card field selection).

---

## 2. Architectural baseline

| Decision | Choice | Rationale |
|---|---|---|
| Component pattern | Mirrors ObjectTreeV2 — JSON sidecar + thin host page | Established Vector pattern; samanthaAPI-controllable later |
| Team model | Team ≡ topology node (Rally's "project IS team") | No new hierarchy; sentinel clamp already gives us scope |
| WIP storage | On the topology node, keyed by `flow_states_id` | No `flow_boards` table — board remains emergent |
| Card persistence | None — board reads live from `artefacts` | Same principle as ObjectTreeV2 |
| Rollup | Existing `backend/internal/artefactitems/recalc.go` runs server-side on PATCH | Already implemented; FlowBoard just trusts it |
| Sentinel | Board clamps to `useSentinel().sentinel_tenant` and current MEG node | HARD RULE: server-side filter is the gate; client filter is defence-in-depth |
| Epic exclusion | Sidecar config `exclude_prefixes: ["EP"]` | Epics are not draggable on a flow board (they roll up from children) |

---

## 3. Data model (new objects)

Three new tables. Migrations: next NNN starts at **132** (last applied = 131).

> **2026-05-27 correction.** The SQL snippets below show `BIGINT`/`BIGSERIAL` for illustrative purposes, but the **live `vector_artefacts` schema uses `UUID` for every PK and FK** (`topology_nodes.topology_nodes_id`, `users.users_id`, `artefact_types`/`artefacts_types.id` — all UUID). Implementation MUST use `UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `UUID NOT NULL` for FKs to match the live schema and avoid FK type mismatches. Also note: the artefact-types table was renamed `artefact_types → artefacts_types` in mig 062 (RF1.4.2 plural sweep); references in §3.3 and §8 should use `artefacts_types`.

### 3.1 `topology_nodes_members` (mig 132)

The foundation: who is a member of this node ("team"). Used by permission gates.

```sql
CREATE TABLE topology_nodes_members (
  topology_nodes_members_id          BIGSERIAL PRIMARY KEY,
  topology_nodes_members_node_id     BIGINT NOT NULL REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
  topology_nodes_members_user_id     BIGINT NOT NULL REFERENCES users(users_id) ON DELETE CASCADE,
  topology_nodes_members_role        TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'lead'
  topology_nodes_members_created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  topology_nodes_members_workspace_id BIGINT NOT NULL,                 -- denorm for sentinel clamp
  UNIQUE (topology_nodes_members_node_id, topology_nodes_members_user_id)
);
CREATE INDEX ix_topology_nodes_members_node ON topology_nodes_members(topology_nodes_members_node_id);
CREATE INDEX ix_topology_nodes_members_user ON topology_nodes_members(topology_nodes_members_user_id);
```

Every column carries the full table-name prefix per the HARD RULE on column naming. `topology_nodes_members_workspace_id` is denormalised because every sentinel-clamped query needs it without a join.

### 3.2 `topology_nodes_wip_limits` (mig 133)

The WIP-limit policy for a node, keyed by flow state.

```sql
CREATE TABLE topology_nodes_wip_limits (
  topology_nodes_wip_limits_id            BIGSERIAL PRIMARY KEY,
  topology_nodes_wip_limits_node_id       BIGINT NOT NULL REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
  topology_nodes_wip_limits_flow_state_id BIGINT NOT NULL REFERENCES flow_states(flow_states_id) ON DELETE CASCADE,
  topology_nodes_wip_limits_limit         INT,                          -- NULL = unlimited
  topology_nodes_wip_limits_workspace_id  BIGINT NOT NULL,
  topology_nodes_wip_limits_updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  topology_nodes_wip_limits_updated_by    BIGINT REFERENCES users(users_id),
  UNIQUE (topology_nodes_wip_limits_node_id, topology_nodes_wip_limits_flow_state_id)
);
CREATE INDEX ix_topology_nodes_wip_limits_node ON topology_nodes_wip_limits(topology_nodes_wip_limits_node_id);
```

`NULL = unlimited` (matches Rally's blank-means-infinity convention). Editing in the gear modal writes one row per column shown.

### 3.3 `users_flowboard_prefs` (mig 134)

Per-user card-field preferences, keyed by artefact type.

```sql
CREATE TABLE users_flowboard_prefs (
  users_flowboard_prefs_id               BIGSERIAL PRIMARY KEY,
  users_flowboard_prefs_user_id          BIGINT NOT NULL REFERENCES users(users_id) ON DELETE CASCADE,
  users_flowboard_prefs_artefact_type_id BIGINT NOT NULL REFERENCES artefact_types(artefact_types_id) ON DELETE CASCADE,
  users_flowboard_prefs_card_fields      JSONB NOT NULL,  -- e.g. ["id","title","assignee","points","priority"]
  users_flowboard_prefs_workspace_id     BIGINT NOT NULL,
  users_flowboard_prefs_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)
);
```

Default when no row exists = `["id","title","assignee","points","priority"]` (the Rally-matching default).

### 3.4 What we are NOT adding

- No `flow_boards` table — board is emergent from (node × type × flow_states × artefacts).
- No `teams` table — team is the node (`topology_nodes`); membership lives on `topology_nodes_members`.
- No board-level field overrides — card fields are user-prefs, panel chrome is sidecar config.

---

## 4. Component anatomy

```
app/components/FlowBoard/
├── p_FlowBoard.tsx                      ← top-level component (props contract — see §6)
├── loader.ts                            ← sidecar loader (mirror ObjectTreeV2/loader.ts)
├── registry.ts                          ← addressable registration (samantha._viewport.app._kind.panel.flow_board)
├── configs/
│   └── p_wizard_flowboard_workitems.json  ← first sidecar
├── hooks/
│   ├── useFlowBoardData.ts              ← merges flow_states + WIP rows + artefact rows
│   ├── useFlowStateTransitions.ts       ← caches allowed from→to per type for drag validation
│   └── useWipLimits.ts                  ← read + mutate WIP rows for a node
├── columns/
│   ├── BoardColumn.tsx                  ← header (title + count/limit + overage badge) + droppable area
│   └── BoardColumnHeader.tsx            ← `Doing (11/10)` + `+1` badge component
├── card/
│   ├── BoardCard.tsx                    ← draggable card, renders fields from user prefs
│   └── CardFieldRenderer.tsx            ← per-field renderers (id, title, assignee, points, priority)
├── settings/
│   └── WipSettingsModal.tsx             ← gear → modal with one input per column
└── __tests__/
    ├── loader.test.ts
    ├── BoardColumnHeader.test.tsx
    ├── transitions.test.ts
    └── permissions.test.ts
```

Mirrors ObjectTreeV2's shape so anyone who knows that surface can navigate this one.

---

## 5. Sidecar contract (`p_wizard_flowboard_<kind>.json`)

```jsonc
{
  "name": "flow_board_workitems",                    // addressable slot
  "title": "Work item flow",
  "description": "Drag work items across flow states. Counts and WIP shown per column.",

  "panel": {
    "tone": "neutral",
    "radius": "lg",
    "padding": "md",
    "title": "Flow board",
    "show_panel_chrome": true
  },

  "artefact_type_scope": "work",                     // 'work' | 'strategy'
  "exclude_prefixes": ["EP"],                        // Epics off the board
  "default_artefact_type_prefix": "US",              // Stories by default

  "type_switcher": {
    "show": true,
    "label": "Artefact type"
  },

  "card": {
    "default_fields": ["id", "title", "assignee", "points", "priority"],
    "renderer": "standard"                           // future: "compact" | "rich"
  },

  "columns": {
    "show_wip": true,
    "wip_format": "ratio_with_overage",              // Doing (11/10) +1
    "overage_tone": "danger"
  },

  "transitions": {
    "mode": "strict"                                 // honor flow_transitions allowed edges
  },

  "empty": {
    "title": "No work items here yet",
    "body": "Cards will appear as work items are created at this scope."
  }
}
```

samanthaAPI can override any field by passing a partial `configOverride` prop at mount time.

---

## 6. Component props contract

```ts
interface FlowBoardProps {
  /** Sidecar config — required. Imported JSON from app/components/FlowBoard/configs/. */
  config: FlowBoardConfig;

  /** Topology node the board belongs to. Defaults to sentinel.current_node if omitted. */
  topologyNodeId?: number;

  /** Selected artefact type. If omitted, component owns this as internal state. */
  artefactTypeId?: number;

  /** Called when the type switcher changes. If omitted, internal state drives the switcher. */
  onArtefactTypeChange?: (id: number) => void;

  /** Per-mount config override (samanthaAPI uses this to customise without forking JSON). */
  configOverride?: Partial<FlowBoardConfig>;
}
```

**Hybrid uncontrolled/controlled** pattern (from Q9 → option C, refined for sidecar precedent):
- The page does `<FlowBoard config={workItemsBoardJson} />` — that's the minimum.
- samanthaAPI does `<FlowBoard config={…} topologyNodeId={…} artefactTypeId={…} onArtefactTypeChange={…} configOverride={…} />` to take full control.

---

## 7. Behaviour

### 7.1 Data flow

```
useSentinel() ──→ sentinel.workspace_id + sentinel.current_node_id
                                   │
                                   ▼
           useFlowBoardData(node_id, type_id) ───┐
                                                  │
   ┌──────────────────────────────────────────────┤
   │                                              │
   ▼                                              ▼
flow_states (columns)                       artefacts (cards)
  + topology_nodes_wip_limits        clamped by sentinel + type
  + count per state                  + WHERE artefact_types.prefix != 'EP'
```

All queries clamped by `sentinel.workspace_id` server-side. Frontend filter is defence-in-depth.

### 7.2 Drag → drop

1. `onDragStart`: read `flow_transitions` for the source state. Highlight allowed target columns; dim disallowed ones (Q5 option A).
2. `onDragOver`: @dnd-kit collision detection restricted to allowed columns only.
3. `onDragEnd` on an allowed column: optimistic UI update + `PATCH /v1/api/artefacts/{id}` with `{flow_states_id: <new>}`.
4. Server validates the transition (existing `artefactitems` service) AND runs the rollup recalc for ancestors (`recalc.go`).
5. On 4xx: revert optimistic state, toast the error.

### 7.3 WIP header rendering (Q6 option D)

| State | Header |
|---|---|
| Limit set, under limit | `Doing (3/10)` |
| Limit set, at limit | `Doing (10/10)` |
| Limit set, over limit | `Doing (11/10)` + `+1` overage badge + red column-state class |
| No limit (NULL row) | `Doing (11)` |

Badge component is `<BoardColumnHeader>`; tone driven by sidecar `columns.overage_tone`.

### 7.4 WIP editing (Q7 option B)

- Gear icon top-right of the board opens `<WipSettingsModal>`.
- Modal lists every column for the current type with a numeric input (blank = unlimited).
- Save writes one row per column to `topology_nodes_wip_limits` (UPSERT on `(node_id, flow_state_id)`).
- Permission gate: only users with a row in `topology_nodes_members` for this node see the gear (Q8 option B with A foundation).

### 7.5 Card rendering

- Component reads `users_flowboard_prefs` for `(current_user, current_artefact_type)`.
- If no row: use sidecar `card.default_fields` (Rally-matching default).
- Each field is rendered by `CardFieldRenderer`; renderers are pure functions of the artefact row.

---

## 8. Backend surface

New endpoints (all under `/_site/` per transport segregation rules):

| Method | Path | Purpose |
|---|---|---|
| GET    | `/_site/flowboard/wip?node_id={id}&artefact_type_id={id}` | List WIP rows for board |
| PUT    | `/_site/flowboard/wip` | Upsert WIP for one (node, flow_state) |
| GET    | `/_site/flowboard/prefs?artefact_type_id={id}` | Read current user's card prefs |
| PUT    | `/_site/flowboard/prefs` | Update current user's card prefs |
| GET    | `/_site/topology/{id}/members` | List node members (used by permission gate) |

No new endpoint for fetching artefacts or flow states — reuse existing `artefacts.list` and `flow_states` endpoints with the appropriate filters.

Service package: `backend/internal/flowboard/` — handlers, service, sql.go (mirrors `notifications/v2/` layout).

Permission middleware: WIP write requires membership in `topology_nodes_members` for the target node; otherwise 403. Read is allowed for any user with `artefacts_read` at the node's scope.

---

## 9. Addressable surface

The board mounts as `samantha._viewport.app._kind.panel.flow_board_<kind>` (slot name from sidecar `name`). samanthaAPI can target:

- The board container (mount/unmount, swap config)
- The artefact-type switcher (force a selection)
- Individual columns (highlight, count query)
- Individual cards (focus, open detail flyout)
- The WIP modal (open, set values)

Registration via `app/components/AddressAnchorResolver.tsx` pattern, same as topology modals.

---

## 10. v1 ship slice (what's IN the first story batch)

- Migrations 132 / 133 / 134 — three new tables
- `backend/internal/flowboard/` service + 5 handlers
- `<FlowBoard>` component + loader + registry
- `p_wizard_flowboard_workitems.json` sidecar (first kind)
- Type dropdown, columns from `flow_states`, count headers
- Sentinel-clamped artefact query + Epic exclusion (`prefix != 'EP'`)
- @dnd-kit drag with hard-block on disallowed targets (Q5-A)
- Server-validated PATCH on drop (defence-in-depth)
- `<BoardColumnHeader>` with `(X/Y)` / `+N` overage badge / red tone (Q6-D)
- `<WipSettingsModal>` gear editor (Q7-B)
- Membership-gated WIP edit (Q8-B with `topology_nodes_members` foundation)
- Per-user card prefs read path (default Rally-matching layout applies until customised)
- Mount on `/value-flow` page, replacing the placeholder Panel

## 11. Deferred (named follow-up stories)

| Item | Reason |
|---|---|
| `flow_transitions` exit-rule checks (e.g. "all sub-tasks Done") | Mig 045 exists; layer on after v1 |
| Bulk / multi-select drag | v1 = single card |
| Swimlanes (group by assignee, sprint, priority) | Layer on; column structure designed to allow |
| Card-fields editor UI | Schema + read path in v1; visual editor follow-up |
| `p_wizard_flowboard_strategy.json` + risk sidecar | After workitems sidecar is proven |
| Rollup notification surfacing on board (toast "Epic auto-moved") | Notifications v2 hook; not v1 |
| WIP-limit history / audit | Reuse audit pattern in a follow-up |

## 12. Tech-debt entries to file

- **TD-FLOWBOARD-EXIT-RULES** — v1 honors only `from→to` allowed edges, not exit-rule predicates (mig 045). Trigger: any tenant reports "I expected this transition blocked by a precondition." S2.
- **TD-FLOWBOARD-CARD-PREFS-UI** — schema ships in v1, visual editor doesn't. Trigger: user feedback on card content. S3.
- **TD-FLOWBOARD-WIP-AUDIT** — WIP edits log who/when on the row, but no history table. Trigger: SOC 2 audit asks "who changed WIP and when historically?" S2.

---

## 13. Open questions (small, can be answered during implementation)

None blocking.

---

## 14. Sources

- [Rally — Set Up WIP Limits (Team Board)](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/tracking/team-board-page/set-up-work-in-progress-wip-limits.html)
- [Rally — Portfolio Kanban WIP App](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/extending-rally-with-apps/app-catalog/portfolio-kanban-board-app/work-in-progress-wip-limits-in-the-portfolio-kanban-board-app.html)
- [Rally — Project Hierarchy (Project ≡ Team)](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/set-up-your-projects-teams/understanding-the-rally-project-hierarchy.html)
- [Rally — Managing Project (Team) Membership](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/set-up-your-projects-teams/managing-project-team-membership.html)

# `<TimeboxManager>` — reusable time-boxed container surface

> **Status: built — PLA-0027 complete.** Go service `internal/timeboxsprints`, REST surface `/api/v2/timeboxes/sprints`, `app/components/TimeboxManager.tsx`, `app/components/timebox/kinds.ts`, and `app/(user)/planning/sprints/page.tsx` all shipped. Page registry row in `mmff_vector` (migration 129). First consumer is **Sprints** (Planning → Sprints); next likely consumer is **Releases**. Storage: [`db/artefacts_schema/025_timebox_sprints.sql`](../db/artefacts_schema/025_timebox_sprints.sql).

`<TimeboxManager>` will be a single React component in `app/components/TimeboxManager.tsx` that drives every time-boxed container surface in the product (sprints, releases, future kinds). The same component renders the list/grid view, the bulk-create form, and the per-row form. Behaviour and storage are switched by a single `kind` prop.

## Why one component

Sprints and releases share the *shape* — sequential dated containers, owned by a user, scoped to some location in the topology, with a numbered name + optional suffix, created in bulk via N-row forms. They diverge in *attributes* (sprints track velocity/creep; releases track version tags) and *rules* (sprints are non-overlapping at team level; releases may overlap, may not bind to a team). The reusable surface captures what's shared; the per-kind registry captures what differs.

## Storage rule — table per kind

Each timebox kind owns its own table.

| Kind | Table | Migration |
|---|---|---|
| `sprint` | `timebox_sprints` (vector_artefacts) | [`025_timebox_sprints.sql`](../db/artefacts_schema/025_timebox_sprints.sql) |
| `release` | `timebox_releases` *(not yet built)* | TBD |
| *future* | `timebox_<kind>` | TBD |

**No unified `timeboxes` table with a discriminator column.** Lifecycle rules and column shape diverge enough that a unified table forces nullable-everywhere columns and branch-on-kind code in every reader. Same component, different tables, different services. The shared substrate is the *interface*, not the storage.

## Kind registry

The kind→table→endpoint mapping lives in a single shared TS const at `app/components/timebox/kinds.ts` (not yet written). Both `<TimeboxManager>` and any caller import from there. Adding a kind = adding a row to the registry + writing the migration + writing the Go service. The component itself is not edited per kind.

```ts
// app/components/timebox/kinds.ts (planned shape)
export const TIMEBOX_KINDS = {
  sprint: {
    table: "timebox_sprints",
    apiBase: "/api/v2/timeboxes/sprints",
    namePrefix: "Sprint",
    bindsToTeam: true,           // requires org_node_id at team level
    enforcesNonOverlap: true,    // DB EXCLUDE constraint enforces
    tracksCreep: true,
  },
  // release: { … } — lands when timebox_releases ships
} as const;
export type TimeboxKind = keyof typeof TIMEBOX_KINDS;
```

## Prop surface (planned)

```ts
type TimeboxManagerProps = {
  kind: TimeboxKind;             // "sprint" | "release" | …; lowercase, matches addressable substrate
  workspaceId: string;
  orgNodeId?: string;            // required when kinds[kind].bindsToTeam
  view?: "list" | "create";      // defaults "list"; "create" opens the bulk-create form
  defaultCadenceDays?: number;   // 14 for sprints typically
};
```

The component consults `TIMEBOX_KINDS[kind]` for everything kind-specific: the API base, the name prefix shown in the form, whether to render the team-picker, whether to render the velocity/creep columns. Callers never pass per-kind config — only the `kind` itself.

## Samantha SDK addressing — three-level

Per [`c_c_addressables.md`](c_c_addressables.md), `<TimeboxManager>` registers a `_timebox` substrate with kind segmentation. Three resolution levels:

| Address | Refs | Example use |
|---|---|---|
| `samantha._timebox` | All timeboxes the caller can see, regardless of kind | Cross-kind dashboard ("what's live this week?") |
| `samantha._timebox.<kind>` | Collection of one kind | `samantha._timebox.sprint` → all sprints in scope |
| `samantha._timebox.<kind>.<name>` | One row | `samantha._timebox.sprint.sprint-0001` |

The `<name>` segment is the slugified `sprint_name` (lowercase, hyphenated). The collection address (`_timebox.<kind>`) is the catch-all for that kind — list operations, bulk operations, "all sprints in this team". The root (`_timebox`) is rarely written by app code; it exists so future cross-kind features have a stable handle.

## Sprint-specific contract (first consumer)

The Sprints page at Planning → Sprints uses `<TimeboxManager kind="sprint" workspaceId={…} orgNodeId={teamNodeId} />`. Behaviour the component must implement for sprints:

- **Default view** is the current sprint (the one whose `[sprint_date_start, sprint_date_end]` contains today). Falls back to next-future if none current; falls back to most-recent-past if no future.
- **Names** generated as `Sprint - <n>` where `<n>` is the next integer per `(workspace_id, org_node_id)`. Optional suffix yields `Sprint - <n> (Red Cherry)`.
- **Bulk create** — N rows, each with name + suffix (suffix optional), `sprint_date_start` (calendar), `sprint_cadence_days`, derived `sprint_date_end` (non-editable). Row 1's start defaults to `previous_sprint.sprint_date_end + 1 day` if any sprint exists for that team, else the user picks. Row N's start = row N-1's end + 1 day, hard-locked.
- **Sequencing invariant** — DB rejects overlaps via the `timebox_sprints_no_overlap` EXCLUDE constraint on `(workspace_id, org_node_id, daterange(start, end, '[]'))`. The adjacent-day rule (B.start = A.end + 1) is the writer service's job, not the DB's.
- **Topology binding** — sprints bind to the *lowest* org_node level (team). The writer service validates "is this node a leaf?" before insert. Cross-DB FK isn't possible (`org_nodes` lives in `mmff_vector`, `timebox_sprints` lives in `vector_artefacts`), so `org_node_id` is a soft UUID enforced by the service.

## Page placement

Sprints lives at **Planning → Sprints** (sub-tab of `/planning`). Primary page in the registry, but `default_parent` = `planning` so the sidebar nests it by default. If a user promotes it to L1 in Nav Preferences, the link still resolves to `/planning/sprints` and the secondary nav opens to the Sprints tab — per the deep-link contract in [`c_c_secondary_nav_deeplink.md`](c_c_secondary_nav_deeplink.md). Page registry row not yet written.

## Not yet built — checklist

- [ ] `app/components/TimeboxManager.tsx`
- [ ] `app/components/timebox/kinds.ts`
- [ ] Go service `internal/timeboxsprints` (sole writer; team-level validation; adjacency enforcement; bulk-create transaction)
- [ ] `/api/v2/timeboxes/sprints` REST surface
- [ ] `pages` registry row in `mmff_vector` for `planning/sprints`
- [ ] Samantha registration of `_timebox` substrate (3 levels)
- [ ] `app/(app)/planning/sprints/page.tsx` route
- [ ] Stories decomposed across all layers via `<stories>` under a fresh PLA-NNNN

# Rally → Vector vocabulary mapping

**Saved 2026-05-29.** When reading Rally specs, OpenAPI docs, admin-screen screenshots, or migration source material, translate the noun before writing it into Vector. Carrying Rally vocabulary into Vector code is forbidden — every column on the Vector substrate uses the Vector name, every commit message uses the Vector name, every spec doc uses the Vector name.

## Noun translations

| Rally term | Vector term | Vector column / table |
|---|---|---|
| Project | **topology node** | `artefacts.artefacts_topology_node_id` → `topology_nodes` |
| Iteration | **sprint** | `artefacts.artefacts_id_timebox_sprint` → `timeboxes_sprints` |
| Portfolio Item | **strategic artefact** | `artefacts` row where `artefacts_types.tier='strategy'` (slot `strt_*`) |
| Release | **release** (same) | `artefacts.artefacts_id_timebox_release` → `timeboxes_releases` |
| User Story | **story** | `artefacts` row where `artefacts_types.slot='wrk_story'` |
| Task | **task** | `artefacts` row where `artefacts_types.slot='wrk_task'` |
| Defect | **defect** | `artefacts` row where `artefacts_types.slot='wrk_defect'` |
| Risk | **risk** | `artefacts` row where `artefacts_types.slot='wrk_risk'` |

## Application rules

1. **When a Rally screenshot shows a field "Project (Object Selector)"**, the Vector equivalent already exists as `artefacts_topology_node_id`. Do NOT propose adding `artefacts_project_id`. The mapping is satisfied.
2. **When Rally shows "Iteration"** on an artefact type's field list, that maps to the existing `artefacts_id_timebox_sprint` FK. Do NOT propose adding `artefacts_iteration_id`.
3. **When Rally shows "Portfolio Item"** as an Object Selector on a User Story / Defect / etc., that is the parent-link to a strategic artefact — the existing parent-child FK on `artefacts` (via the parent column or a separate `artefacts_parent_id` if that exists) is the satisfaction. Confirm before adding new linkage.
4. **When Rally shows fields ON the Iteration / Release admin grid** (e.g. Iteration has its own "Planned Velocity", "End Date", "Theme"), those fields live on the **`timeboxes_sprints`** / **`timeboxes_releases`** table — NOT on `artefacts`. Don't conflate "Rally Iteration's Theme" with "an artefact's Theme" — Theme as displayed on the Iteration admin grid is `timeboxes_sprints_theme`.
5. **Slot families:** work-tier slots are `wrk_*` (wrk_story, wrk_task, wrk_defect, wrk_risk). Strategy-tier slots are `strt_*`. Test/QA family TBD. Use `artefacts_types.artefacts_types_slot` as the scope-gating column.

## Why this matters

Two things to a Vector-native reader who never used Rally:
- "Project" reads as a calendar/customer term, not a topology placement — using it would semantically lie about what the column represents
- "Iteration" reads as a generic loop construct, not as a fixed-cadence Scrum sprint — same lie

To anyone reading a Rally → Vector migration / spec, the translation table above is THE artefact that lets them work without having to know both vocabularies. Keep it current.

## Pinned by

- `context/MEMORY.md` Active Threads (short form, full session-load context)
- This file (long form, ref-able from migration commits / spec docs)
- `dev/research/rally_core_field_audit.md` (the earliest cross-reference work)

// Shared work-item-type catalogue + core-field mirror.
//
// Why this exists: two custom-fields admin pages were drifting copies of
// the same lists — `/workspace-admin/custom-fields/work-items` and
// `/workspace-settings/workspace-settings/custom-fields/work-items`.
// Filed as TD-WORKITEMS-DUPE; paid down 2026-05-16. Adding a new artefact
// type (e.g. `risk` per PLA-0052) should now touch ITEM_TYPES here,
// not both pages.
//
// Prefixes mirror `artefact_types.prefix` on the wire (WorkItem.type_prefix);
// the order here drives the per-type tab bar on the admin pages.

// PLA-0052 Story 11 — Risk added at tier 5. Order here matches the
// `artefacts_types_sort_order` seeded by the type-specific migrations
// (Epic→1, Story→2, Defect→3, Task→4, Risk→5) so the admin-tab UX matches
// the listing sort. TD-WORKITEMS-GENERIC (2026-05-16) replaced the
// backend CASE clause with that column join — the two are no longer
// independently maintained.
export const ITEM_TYPES = [
  { key: "epic",   label: "Epic",   prefix: "EP" },
  { key: "story",  label: "Story",  prefix: "US" },
  { key: "defect", label: "Defect", prefix: "DE" },
  { key: "task",   label: "Task",   prefix: "TA" },
  { key: "risk",   label: "Risk",   prefix: "RSK" },
] as const;

export type ItemTypeKey = typeof ITEM_TYPES[number]["key"];

// Read-only mirror of the core columns that exist on every work item.
// Source: vector_artefacts.artefacts (PLA-0023). Cannot be removed or
// hidden — the admin page surfaces them so users can see what's already
// covered before they add a custom field on top.
export interface CoreField {
  name:   string;
  label:  string;
  type:   string;
  source: string;
  note?:  string;
}

export const CORE_FIELDS: CoreField[] = [
  { name: "title",                       label: "Title",        type: "text", source: "artefacts.title" },
  { name: "description",                 label: "Description",  type: "text", source: "artefacts.description" },
  { name: "priority",                    label: "Priority",     type: "enum", source: "artefacts.priority",                       note: "critical / high / medium / low" },
  { name: "story_points",                label: "Story Points", type: "int",  source: "artefacts.story_points" },
  { name: "due_date",                    label: "Due Date",     type: "date", source: "artefacts.due_date" },
  { name: "artefacts_id_timebox_sprint", label: "Sprint",       type: "uuid", source: "artefacts.artefacts_id_timebox_sprint" },
  { name: "parent_artefact_id",          label: "Parent",       type: "uuid", source: "artefacts.parent_artefact_id" },
  { name: "position",                    label: "Position",     type: "int",  source: "artefacts.position",                      note: "rank within current scope (backlog or sprint)" },
  { name: "flow_state_id",               label: "Flow State",   type: "uuid", source: "artefacts.flow_state_id",                 note: "current state via flow_states.kind" },
];

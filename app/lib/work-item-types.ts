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

export const ITEM_TYPES = [
  { key: "epic",   label: "Epic",   prefix: "EP" },
  { key: "story",  label: "Story",  prefix: "US" },
  { key: "task",   label: "Task",   prefix: "TA" },
  { key: "defect", label: "Defect", prefix: "DE" },
] as const;

export type ItemTypeKey = typeof ITEM_TYPES[number]["key"];

// Read-only mirror of the core columns that exist on every work item.
// Source: vector_artefacts.artefacts (PLA-0023). Cannot be removed or
// hidden — the admin page surfaces them so users can see what's already
// covered before they add a custom field on top.
export interface CoreField {
  name:   string;
  type:   string;
  source: string;
  note?:  string;
}

export const CORE_FIELDS: CoreField[] = [
  { name: "title",                       type: "text", source: "artefacts.title" },
  { name: "description",                 type: "text", source: "artefacts.description" },
  { name: "priority",                    type: "enum", source: "artefacts.priority",                       note: "critical / high / medium / low" },
  { name: "story_points",                type: "int",  source: "artefacts.story_points" },
  { name: "due_date",                    type: "date", source: "artefacts.due_date" },
  { name: "artefacts_id_timebox_sprint", type: "uuid", source: "artefacts.artefacts_id_timebox_sprint" },
  { name: "parent_artefact_id",          type: "uuid", source: "artefacts.parent_artefact_id" },
  { name: "position",                    type: "int",  source: "artefacts.position",                      note: "rank within current scope (backlog or sprint)" },
  { name: "flow_state_id",               type: "uuid", source: "artefacts.flow_state_id",                 note: "current state via flow_states.kind" },
];

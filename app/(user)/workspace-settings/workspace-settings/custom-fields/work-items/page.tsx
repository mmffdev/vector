"use client";

import { useState } from "react";
import CustomFieldManager from "@/app/components/CustomFieldManager";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

// Prefixes come from artefact_types.prefix on the wire (WorkItem.type_prefix);
// mirrored here as a static label list for the per-type tab bar on this page.
const ITEM_TYPES = [
  { key: "epic",   label: "Epic",   prefix: "EP" },
  { key: "story",  label: "Story",  prefix: "US" },
  { key: "task",   label: "Task",   prefix: "TA" },
  { key: "defect", label: "Defect", prefix: "DE" },
] as const;
type ItemTypeKey = typeof ITEM_TYPES[number]["key"];

// Read-only mirror of the core columns that exist on every work item.
// Source: vector_artefacts.artefacts (PLA-0023). Cannot be removed or hidden.
interface CoreField {
  name:   string;
  type:   string;
  source: string;
  note?:  string;
}

const CORE_FIELDS: CoreField[] = [
  { name: "title",               type: "text",   source: "artefacts.title" },
  { name: "description",         type: "text",   source: "artefacts.description" },
  { name: "priority",            type: "enum",   source: "artefacts.priority",            note: "critical / high / medium / low" },
  { name: "story_points",        type: "int",    source: "artefacts.story_points" },
  { name: "due_date",            type: "date",   source: "artefacts.due_date" },
  { name: "artefacts_id_timebox_sprint", type: "uuid", source: "artefacts.artefacts_id_timebox_sprint" },
  { name: "parent_artefact_id",  type: "uuid",   source: "artefacts.parent_artefact_id" },
  { name: "position",            type: "int",    source: "artefacts.position",            note: "rank within current scope (backlog or sprint)" },
  { name: "flow_state_id",       type: "uuid",   source: "artefacts.flow_state_id",       note: "current state via flow_states.kind" },
];

export default function CustomFieldsWorkItemsPage() {
  const { full } = usePageTitle();
  const [selected, setSelected] = useState<ItemTypeKey>("story");
  const active = ITEM_TYPES.find((t) => t.key === selected) ?? ITEM_TYPES[1];

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Configure work item type definitions and workflow settings." />
      <Panel
        name="panel_custom_fields_work_items_header"
        className="page-panel-heading"
        title="Work Item Fields"
        description="Configure custom fields that appear on all work items in this workspace."
      />
    <div className="settings-panel settings-panel--wide">
      {/* ── Type selector ───────────────────────────────────────── */}
      <div className="settings-panel__header">
        <h3 className="eyebrow">Item type</h3>
      </div>
      <div className="form__row form__row--inline">
        {ITEM_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={"pill " + (selected === t.key ? "pill--info" : "pill--neutral")}
            aria-pressed={selected === t.key}
            onClick={() => setSelected(t.key)}
          >
            <strong>{t.prefix}</strong>&nbsp;·&nbsp;{t.label}
          </button>
        ))}
      </div>

      {/* ── Core fields (read-only) ─────────────────────────────── */}
      <div className="settings-panel__details">
        <h3 className="eyebrow">Core fields — {active.label} ({active.prefix})</h3>
        <p className="form__hint">
          These fields exist on every {active.label.toLowerCase()} and cannot be removed.
          Custom fields below are added on top of these.
        </p>
        <Table<CoreField>
          pageId="custom-fields-work-items"
          slot={`core_fields__${active.key}`}
          ariaLabel={`Core fields on every ${active.label}`}
          rows={CORE_FIELDS}
          rowKey={(f) => f.name}
          columns={[
            { key: "name",   header: "Field",
              kind: "custom",
              render: (f) => <code className="form__hint">{f.name}</code>,
            },
            { key: "type",   header: "Type",   width: 100,
              kind: "pill",
              pillVariant: () => "neutral",
              pillLabel: (f) => f.type,
            },
            { key: "source", header: "Source column" },
            { key: "note",   header: "Note",
              kind: "custom",
              render: (f) => f.note ? <span className="form__hint">{f.note}</span> : null,
            },
          ]}
        />
      </div>

      {/* ── Custom fields ──────────────────────────────────────── */}
      <div className="settings-panel__details">
        <CustomFieldManager
          itemType={active.key}
          itemTypeLabel={active.label}
          pageId="custom-fields-work-items"
        />
      </div>
    </div>
    </PageContent>
  );
}

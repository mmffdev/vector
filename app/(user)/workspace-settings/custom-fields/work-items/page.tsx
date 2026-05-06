"use client";

import { useState } from "react";
import Table from "@/app/components/Table";
import CustomFieldManager from "@/app/components/CustomFieldManager";

// Source of truth for prefixes lives in app/components/work-items-tree-config.tsx
// (TYPE_PREFIX). Mirrored here so this page can render the prefix without
// importing tree-internal config.
const ITEM_TYPES = [
  { key: "epic",   label: "Epic",   prefix: "EP" },
  { key: "story",  label: "Story",  prefix: "US" },
  { key: "task",   label: "Task",   prefix: "TA" },
  { key: "defect", label: "Defect", prefix: "DE" },
] as const;
type ItemTypeKey = typeof ITEM_TYPES[number]["key"];

// Read-only mirror of the core columns that exist on every work item.
// Source: db/schema/063, 065, 068. Cannot be removed or hidden.
interface CoreField {
  name:   string;
  type:   string;
  source: string;
  note?:  string;
}

const CORE_FIELDS: CoreField[] = [
  { name: "title",             type: "text",   source: "obj_work_items.title" },
  { name: "description",       type: "text",   source: "obj_work_items.description" },
  { name: "status",            type: "enum",   source: "obj_work_items.status",      note: "open / in_progress / done / cancelled" },
  { name: "priority",          type: "enum",   source: "obj_work_items.priority",    note: "critical / high / medium / low" },
  { name: "story_points",      type: "int",    source: "obj_work_items.story_points" },
  { name: "sprint_id",         type: "uuid",   source: "obj_work_items.sprint_id" },
  { name: "backlog_position",  type: "int",    source: "obj_work_items.backlog_position", note: "exclusive with sprint_position" },
  { name: "sprint_position",   type: "int",    source: "obj_work_items.sprint_position",  note: "exclusive with backlog_position" },
];

export default function CustomFieldsWorkItemsPage() {
  const [selected, setSelected] = useState<ItemTypeKey>("story");
  const active = ITEM_TYPES.find((t) => t.key === selected) ?? ITEM_TYPES[1];

  return (
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
  );
}

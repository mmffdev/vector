"use client";

// Shared body for the two custom-fields work-items admin pages
// (TD-WORKITEMS-DUPE pay-down, 2026-05-16). Both pages were byte-
// identical except for one `subtitle` string on PageHeading; that's
// the only thing left to pass per-page.
//
// Future artefact types (e.g. `risk` per PLA-0052) only need to extend
// app/lib/work-item-types.ts now — this body picks them up.

import { useState } from "react";
import CustomFieldManager from "@/app/components/CustomFieldManager";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import {
  ITEM_TYPES,
  CORE_FIELDS,
  type CoreField,
  type ItemTypeKey,
} from "@/app/lib/work-item-types";

type Props = {
  subtitle: string;
};

export default function CustomFieldsWorkItemsBody({ subtitle }: Props) {
  const { full } = usePageTitle();
  const [selected, setSelected] = useState<ItemTypeKey>("story");
  const active = ITEM_TYPES.find((t) => t.key === selected) ?? ITEM_TYPES[1];

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle={subtitle} />
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
              { key: "name", header: "Field",
                kind: "custom",
                render: (f) => <code className="form__hint">{f.name}</code>,
              },
              { key: "type", header: "Type", width: 100,
                kind: "pill",
                pillVariant: () => "neutral",
                pillLabel: (f) => f.type,
              },
              { key: "source", header: "Source column" },
              { key: "note", header: "Note",
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

"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Table, { type Column } from "@/app/components/Table";
import { usePageTitle } from "@/app/hooks/usePageTitle";

type PropRow = {
  id: string;
  prop: string;
  type: string;
  defaultValue: string;
  notes: string;
};

const propRows: PropRow[] = [
  { id: "name", prop: "name", type: "string", defaultValue: "—", notes: "Required. Snake-case, [a-z0-9_]{1,64}. Addressable substrate ID." },
  { id: "title", prop: "title", type: "ReactNode", defaultValue: "—", notes: "Renders the panel header (h²) with .panel__header / .panel__title CSS when present." },
  { id: "className", prop: "className", type: "string", defaultValue: "—", notes: "Appended to the root panel class." },
  { id: "children", prop: "children", type: "ReactNode", defaultValue: "—", notes: "Panel body content." },
  { id: "helpable", prop: "helpable", type: "boolean", defaultValue: "—", notes: "Pass false to suppress the help icon." },
  { id: "margin", prop: "margin", type: "[top?, right?, bottom?, left?]", defaultValue: '"0" per slot', notes: "CSS string per slot. Tokens: --gap-block-top/right/bottom/left (20px each)." },
  { id: "padding", prop: "padding", type: "[top?, right?, bottom?, left?]", defaultValue: "var(--space-4) = 16px per slot", notes: "CSS string per slot." },
  { id: "border", prop: "border", type: "{ type?, width?, color? }", defaultValue: "solid / 1px / var(--border)", notes: "type: solid | dashed | dotted | none. Omit prop = CSS class default." },
  { id: "background", prop: "background", type: "string", defaultValue: "transparent", notes: "Any CSS colour — hex, token, rgba." },
  { id: "radius", prop: "radius", type: "{ top?, right?, bottom?, left? }", defaultValue: '"0" per key', notes: "Maps to border-radius corners TL/TR/BR/BL. CSS string per key." },
];

const propColumns: Column<PropRow>[] = [
  { key: "prop", header: "Prop", render: (r) => <code>{r.prop}</code> },
  { key: "type", header: "Type", render: (r) => r.type },
  { key: "default", header: "Default", render: (r) => r.defaultValue },
  { key: "notes", header: "Notes", render: (r) => r.notes },
];

export default function AssetRegisterPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Registry of API assets and endpoint definitions." />
      <Panel
        name="panel_asset_register_header"
        className="page-panel-heading"
        title="Asset Register"
        description="Browse and manage the register of API assets and endpoint definitions for this workspace."
      />
      <PageDescription title="Asset Register" />

      <section id="panel">
        <Panel name="asset_register_panel" title="Panel">
          <Table
            pageId="vector_admin.api_manager.asset_register"
            slot="table_panel_props"
            ariaLabel="Panel props"
            columns={propColumns}
            rows={propRows}
            rowKey={(r) => r.id}
          />
        </Panel>
      </section>
    </PageContent>
  );
}

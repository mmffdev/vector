"use client";

// PLA-0015 — <Table> visual harness. Exercises every prop combination
// in isolation so a regression in any feature surfaces here before it
// hits a production call site. Not linked from primary nav — visit
// /table-harness directly.

import { useMemo, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";

interface DemoRow {
  id: string;
  name: string;
  code: string;
  count: number;
  status: "active" | "pending" | "blocked";
  notes: string;
}

const SEED: DemoRow[] = [
  { id: "1", name: "Alpha",  code: "ALP-001", count: 12, status: "active",  notes: "Lorem ipsum dolor sit amet." },
  { id: "2", name: "Bravo",  code: "BRV-002", count:  3, status: "pending", notes: "Consectetur adipiscing elit." },
  { id: "3", name: "Charlie",code: "CHA-003", count: 47, status: "blocked", notes: "Sed do eiusmod tempor." },
  { id: "4", name: "Delta",  code: "DLT-004", count:  1, status: "active",  notes: "Incididunt ut labore." },
  { id: "5", name: "Echo",   code: "ECH-005", count: 22, status: "pending", notes: "Et dolore magna aliqua." },
  { id: "6", name: "Foxtrot",code: "FOX-006", count:  8, status: "active",  notes: "Ut enim ad minim veniam." },
  { id: "7", name: "Golf",   code: "GLF-007", count: 33, status: "blocked", notes: "Quis nostrud exercitation." },
  { id: "8", name: "Hotel",  code: "HTL-008", count:  5, status: "active",  notes: "Ullamco laboris nisi." },
];

function statusVariant(r: DemoRow): "success" | "warning" | "danger" {
  if (r.status === "active") return "success";
  if (r.status === "pending") return "warning";
  return "danger";
}

export default function TableHarnessPage() {
  const { full } = usePageTitle();
  const [rows, setRows] = useState<DemoRow[]>(SEED);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, q, statusFilter]);

  const patchNotes = (id: string, val: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, notes: val } : r)));

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Visual harness for testing all Table component prop combinations." />
      <Panel
        name="panel_table_harness_header"
        className="page-panel-heading"
        title="Table Harness"
        description="Exercise every prop combination of the Table component to verify visual rendering and regressions."
      />
      <StrictRoute>
        <Panel name="harness_minimal" title="1. Minimal — text only, no toolbar">
          <Table<DemoRow>
            pageId="table-harness"
            slot="minimal"
            ariaLabel="Minimal demo"
            columns={[
              { key: "name", header: "Name", width: 160 },
              { key: "code", header: "Code", width: 140, kind: "mono" },
              { key: "count", header: "Count", width: 90, kind: "numeric" },
            ]}
            rows={SEED.slice(0, 4)}
            rowKey={(r) => r.id}
          />
        </Panel>

        <Panel name="harness_loading" title="2. Loading state">
          <Table<DemoRow>
            pageId="table-harness"
            slot="loading"
            ariaLabel="Loading demo"
            columns={[
              { key: "name", header: "Name" },
              { key: "code", header: "Code" },
            ]}
            rows={null}
            rowKey={(r) => r.id}
            loading
          />
        </Panel>

        <Panel name="harness_empty" title="3. Empty state">
          <Table<DemoRow>
            pageId="table-harness"
            slot="empty"
            ariaLabel="Empty demo"
            columns={[
              { key: "name", header: "Name" },
              { key: "code", header: "Code" },
            ]}
            rows={[]}
            rowKey={(r) => r.id}
            empty="No widgets yet — try adding one."
          />
        </Panel>

        <Panel name="harness_pills" title="4. Pill cells (variant + label derived from row)">
          <Table<DemoRow>
            pageId="table-harness"
            slot="pills"
            ariaLabel="Pill demo"
            columns={[
              { key: "name", header: "Name", width: 160 },
              {
                key: "status",
                header: "Status",
                width: 110,
                kind: "pill",
                pillVariant: statusVariant,
                pillLabel: (r) => r.status,
              },
              { key: "count", header: "Count", width: 90, kind: "numeric" },
            ]}
            rows={SEED}
            rowKey={(r) => r.id}
          />
        </Panel>

        <Panel name="harness_expand" title="5. Expander + panel">
          <Table<DemoRow>
            pageId="table-harness"
            slot="expand"
            ariaLabel="Expander demo"
            columns={[
              { key: "expander", width: 40, kind: "expander" },
              { key: "name", header: "Name", width: 160 },
              { key: "code", header: "Code", kind: "mono" },
            ]}
            rows={SEED.slice(0, 5)}
            rowKey={(r) => r.id}
            expandable={{
              renderPanel: (row) => (
                <div className="u-stack--gap-2">
                  <strong>{row.name}</strong>
                  <p>{row.notes}</p>
                </div>
              ),
            }}
          />
        </Panel>

        <Panel name="harness_edit" title="6. Inline edit (Enter saves, Esc cancels, async + validate)">
          <Table<DemoRow>
            pageId="table-harness"
            slot="edit"
            ariaLabel="Inline edit demo"
            columns={[
              { key: "name", header: "Name", width: 160 },
              {
                key: "notes",
                header: "Notes (click to edit)",
                editable: {
                  type: "text",
                  validate: (v) => (v.trim().length < 3 ? "Min 3 chars" : null),
                  onSave: async (row, val) => {
                    await new Promise((r) => setTimeout(r, 300));
                    patchNotes(row.id, val);
                  },
                },
              },
            ]}
            rows={rows.slice(0, 4)}
            rowKey={(r) => r.id}
          />
        </Panel>

        <Panel name="harness_full" title="7. Full kitchen sink — toolbar + filter + pagination + bespoke className hooks">
          <Table<DemoRow>
            pageId="table-harness"
            slot="full"
            ariaLabel="Kitchen-sink demo"
            columns={[
              { key: "expander", width: 40, kind: "expander" },
              { key: "name", header: "Name", width: 140 },
              { key: "code", header: "Code", width: 120, kind: "mono" },
              { key: "count", header: "Count", width: 90, kind: "numeric" },
              {
                key: "status",
                header: "Status",
                width: 110,
                kind: "pill",
                pillVariant: statusVariant,
                pillLabel: (r) => r.status,
              },
              {
                key: "custom",
                header: "Custom",
                kind: "custom",
                render: (r) => <em>{r.notes.slice(0, 24)}…</em>,
              },
            ]}
            rows={filtered}
            rowKey={(r) => r.id}
            expandable={{ renderPanel: (r) => <p>Notes: {r.notes}</p> }}
            pagination={{ pageSize: 3, page, onPageChange: setPage }}
            toolbar={{
              search: { value: q, onChange: setQ, placeholder: "Search by name…" },
              filters: [
                {
                  key: "status",
                  label: "Status",
                  value: statusFilter,
                  onChange: setStatusFilter,
                  options: [
                    { value: "all", label: "All" },
                    { value: "active", label: "Active" },
                    { value: "pending", label: "Pending" },
                    { value: "blocked", label: "Blocked" },
                  ],
                },
              ],
              actions: (
                <button type="button" className="btn btn--primary" disabled>
                  + New
                </button>
              ),
              meta: `${filtered.length} of ${rows.length}`,
            }}
            rowClassName={(r) => (r.status === "blocked" ? "harness-table__row--flagged" : undefined)}
            cellClassName={(r, c) => (c.key === "count" && r.count > 20 ? "harness-table__cell--hot" : undefined)}
            empty="No matches."
          />
        </Panel>
      </StrictRoute>
    </PageContent>
  );
}

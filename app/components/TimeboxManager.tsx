"use client";

// PLA-0027 / Story 00518 — <TimeboxManager> reusable timebox surface.
// Switches behaviour by `kind` prop; all per-kind config lives in kinds.ts.
// First consumer: kind="sprint" (Planning → Sprints).
// Second consumer: kind="release" (Planning → Releases).

import { useState } from "react";
import Panel from "@/app/components/Panel";
import Table, { Column, PillVariant } from "@/app/components/Table";
import { apiV2, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { TIMEBOX_KINDS, TimeboxKind } from "@/app/components/timebox/kinds";
import { useTimebox } from "@/app/hooks/useTimebox";

// ── Types ─────────────────────────────────────────────────────────────────────

// Generic row shape — field names vary by kind (sprint_name vs release_name etc.)
// We use a Record<string, unknown> internally and access via the rowPrefix.
export type TimeboxRow = Record<string, unknown> & { id: string; status: string };

export interface TimeboxManagerProps {
  kind: TimeboxKind;
  workspaceId: string;
  orgNodeId?: string;
}

// ── Status pill mapping ───────────────────────────────────────────────────────

function statusVariant(status: string): PillVariant {
  switch (status) {
    case "active": return "success";
    case "completed": return "neutral";
    default: return "info";
  }
}

// ── Bulk-create form ──────────────────────────────────────────────────────────

interface BulkRow {
  suffix: string;
  date_start: string;
  cadence_days: string;
  velocity: string;
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function deriveEnd(row: BulkRow): string {
  const cadence = parseInt(row.cadence_days, 10);
  if (!row.date_start || isNaN(cadence) || cadence <= 0) return "";
  return addDays(row.date_start, cadence - 1);
}

function makeEmptyRow(start: string, cadence: string): BulkRow {
  return { suffix: "", date_start: start, cadence_days: cadence, velocity: "" };
}

function buildRows(count: number, firstStart: string, cadence: string): BulkRow[] {
  const result: BulkRow[] = [];
  let start = firstStart;
  for (let i = 0; i < count; i++) {
    const row = makeEmptyRow(start, cadence);
    result.push(row);
    const end = deriveEnd(row);
    start = end ? addDays(end, 1) : "";
  }
  return result;
}

interface BulkCreateFormProps {
  cfg: typeof TIMEBOX_KINDS[TimeboxKind];
  kind: TimeboxKind;
  workspaceId: string;
  orgNodeId?: string;
  nextNumber: number;
  lastEndDate: string;
  onCreated: () => void;
  onCancel: () => void;
}

function BulkCreateForm({ cfg, kind, workspaceId, orgNodeId, nextNumber, lastEndDate, onCreated, onCancel }: BulkCreateFormProps) {
  const defaultCadence = "14";
  const firstStart = lastEndDate ? addDays(lastEndDate, 1) : "";
  const p = cfg.rowPrefix;

  const [count, setCount] = useState(1);
  const [rows, setRows] = useState<BulkRow[]>([makeEmptyRow(firstStart, defaultCadence)]);
  const [saving, setSaving] = useState(false);

  function applyCount(n: number) {
    const clamped = Math.max(1, Math.min(52, n));
    setCount(clamped);
    setRows(prev => {
      const cadence = prev[0]?.cadence_days ?? defaultCadence;
      const start = prev[0]?.date_start ?? firstStart;
      return buildRows(clamped, start, cadence);
    });
  }

  function updateRow(i: number, field: keyof BulkRow, value: string) {
    setRows(prev => {
      const next = prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
      if (field === "date_start" || field === "cadence_days") {
        for (let j = i + 1; j < next.length; j++) {
          const prevEnd = deriveEnd(next[j - 1]);
          next[j] = { ...next[j], date_start: prevEnd ? addDays(prevEnd, 1) : "" };
        }
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const items = rows.map((r, i) => {
        const velocity = parseInt(r.velocity, 10);
        return {
          [`${p}_name`]: `${cfg.namePrefix} ${nextNumber + i}`,
          [`${p}_suffix`]: r.suffix || undefined,
          [`${p}_cadence_days`]: parseInt(r.cadence_days, 10),
          [`${p}_date_start`]: r.date_start,
          [`${p}_date_end`]: deriveEnd(r),
          [`${p}_velocity`]: isNaN(velocity) ? undefined : velocity,
          org_node_id: orgNodeId,
        };
      });
      await apiV2(`${cfg.apiBase}/bulk-create?workspace_id=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ [cfg.listKey]: items }),
      });
      notify.success(`Created ${rows.length} ${rows.length === 1 ? kind : kind + "s"}`);
      onCreated();
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to create ${kind}s`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label className="form__label" style={{ margin: 0 }} htmlFor="timebox-count">
          Number of {cfg.namePrefix}s
        </label>
        <input
          id="timebox-count"
          className="form__input"
          type="number"
          min={1}
          max={52}
          value={count}
          onChange={e => applyCount(parseInt(e.target.value, 10) || 1)}
          style={{ width: 72 }}
        />
      </div>
      <Table<BulkRow & { _idx: number }>
        pageId={`timebox_${kind}_bulk_create`}
        slot="create"
        ariaLabel={`${cfg.namePrefix} bulk create`}
        columns={[
          {
            key: "_idx",
            header: "Name",
            kind: "custom",
            render: (r) => (
              <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>
                {cfg.namePrefix} {nextNumber + r._idx}
              </span>
            ),
          },
          {
            key: "suffix",
            header: "Suffix (optional)",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                value={r.suffix}
                onChange={e => updateRow(r._idx, "suffix", e.target.value)}
                placeholder="e.g. Red Cherry"
              />
            ),
          },
          {
            key: "date_start",
            header: "Start",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="date"
                value={r.date_start}
                onChange={e => updateRow(r._idx, "date_start", e.target.value)}
                required
                readOnly={r._idx > 0}
              />
            ),
          },
          {
            key: "cadence_days",
            header: "Cadence (days)",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="number"
                min={1}
                value={r.cadence_days}
                onChange={e => updateRow(r._idx, "cadence_days", e.target.value)}
                required
                style={{ width: 90 }}
              />
            ),
          },
          {
            key: "date_start",
            header: "End (derived)",
            kind: "mono",
            render: (r) => deriveEnd(r) || "—",
          },
          {
            key: "velocity",
            header: "Velocity",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="number"
                min={0}
                value={r.velocity}
                onChange={e => updateRow(r._idx, "velocity", e.target.value)}
                placeholder="—"
                style={{ width: 80 }}
              />
            ),
          },
        ]}
        rows={rows.map((r, i) => ({ ...r, _idx: i }))}
        rowKey={(r) => String(r._idx)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
          {saving ? "Creating…" : `Create ${rows.length === 1 ? cfg.namePrefix : `${rows.length} ${cfg.namePrefix}s`}`}
        </button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function TimeboxManagerInner({ kind, workspaceId, orgNodeId }: TimeboxManagerProps) {
  const cfg = TIMEBOX_KINDS[kind];
  const p = cfg.rowPrefix;
  const { rows, loading, reload } = useTimebox({ kind, workspaceId, orgNodeId });
  const [creating, setCreating] = useState(false);

  const columns: Column<TimeboxRow>[] = [
    {
      key: `${p}_name`,
      header: "Name",
      kind: "custom",
      render: (r) => {
        const suffix = r[`${p}_suffix`] as string | null;
        const name = r[`${p}_name`] as string;
        return suffix
          ? <>{name} <span style={{ color: "var(--ink-3)" }}>({suffix})</span></>
          : <>{name}</>;
      },
    },
    { key: `${p}_date_start`, header: "Start", kind: "mono" },
    { key: `${p}_date_end`, header: "End", kind: "mono" },
    { key: `${p}_cadence_days`, header: "Cadence (days)", kind: "numeric" },
    {
      key: "status",
      header: "Status",
      kind: "pill",
      pillVariant: (r) => statusVariant(r.status),
      pillLabel: (r) => r.status,
    },
    {
      key: `${p}_scope`,
      header: "Scope",
      kind: "numeric",
      render: (r) => String(r[`${p}_scope`] ?? "—"),
    },
    {
      key: `${p}_velocity`,
      header: "Velocity",
      kind: "numeric",
      render: (r) => String(r[`${p}_velocity`] ?? "—"),
    },
  ];

  const nextNumber = (rows?.length ?? 0) + 1;
  const lastEndDate = rows?.length
    ? [...rows].sort((a, b) =>
        String(b[`${p}_date_end`]).localeCompare(String(a[`${p}_date_end`]))
      )[0][`${p}_date_end`] as string
    : "";

  const panelTitle = (
    <span style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
      <span>{cfg.namePrefix}s</span>
      {!creating && (
        <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
          Create {cfg.namePrefix}s
        </button>
      )}
    </span>
  );

  return (
    <Panel name={`timebox_${kind}_list`} title={panelTitle}>
      {creating ? (
        <BulkCreateForm
          cfg={cfg}
          kind={kind}
          workspaceId={workspaceId}
          orgNodeId={orgNodeId}
          nextNumber={nextNumber}
          lastEndDate={lastEndDate}
          onCreated={() => { setCreating(false); void reload(); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Table<TimeboxRow>
          pageId={`timebox_${kind}`}
          slot="list"
          ariaLabel={`${cfg.namePrefix} list`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={`No ${kind}s found.`}
        />
      )}
    </Panel>
  );
}

// ── Samantha _timebox substrate registration ───────────────────────────────────

export default function TimeboxManager(props: TimeboxManagerProps) {
  const { address, Provider } = useRegisterAddressable({
    kind: "timebox",
    name: props.kind,
  });
  return (
    <Provider>
      <div data-address={address}>
        <TimeboxManagerInner {...props} />
      </div>
    </Provider>
  );
}

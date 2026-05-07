"use client";

// PLA-0027 / Story 00518 — <TimeboxManager> reusable timebox surface.
// Switches behaviour by `kind` prop; all per-kind config lives in kinds.ts.
// First consumer: <TimeboxManager kind="sprint"> on the Planning → Sprints page.

import { useEffect, useState, useCallback } from "react";
import Panel from "@/app/components/Panel";
import Table, { Column, PillVariant } from "@/app/components/Table";
import { api, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { TIMEBOX_KINDS, TimeboxKind } from "@/app/components/timebox/kinds";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintRow {
  id: string;
  sprint_name: string;
  sprint_suffix: string | null;
  sprint_date_start: string;
  sprint_date_end: string;
  sprint_cadence_days: number;
  status: "planned" | "active" | "completed";
  sprint_scope: number | null;
  sprint_velocity: number | null;
}

type AnyRow = SprintRow;

interface ListResponse {
  sprints?: SprintRow[];
  count: number;
}

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
  sprint_suffix: string;
  sprint_date_start: string;
  sprint_cadence_days: string;
  sprint_velocity: string;
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return "";
  // Parse as UTC to avoid DST/timezone shifts corrupting the date arithmetic.
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function deriveEnd(row: BulkRow): string {
  const cadence = parseInt(row.sprint_cadence_days, 10);
  if (!row.sprint_date_start || isNaN(cadence) || cadence <= 0) return "";
  return addDays(row.sprint_date_start, cadence - 1);
}

function makeEmptyRow(start: string, cadence: string): BulkRow {
  return { sprint_suffix: "", sprint_date_start: start, sprint_cadence_days: cadence, sprint_velocity: "" };
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

  const [count, setCount] = useState(1);
  const [rows, setRows] = useState<BulkRow[]>([makeEmptyRow(firstStart, defaultCadence)]);
  const [saving, setSaving] = useState(false);

  function applyCount(n: number) {
    const clamped = Math.max(1, Math.min(52, n));
    setCount(clamped);
    setRows(prev => {
      const cadence = prev[0]?.sprint_cadence_days ?? defaultCadence;
      const start = prev[0]?.sprint_date_start ?? firstStart;
      return buildRows(clamped, start, cadence);
    });
  }

  function updateRow(i: number, field: keyof BulkRow, value: string) {
    setRows(prev => {
      const next = prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
      if (field === "sprint_date_start" || field === "sprint_cadence_days") {
        for (let j = i + 1; j < next.length; j++) {
          const prevEnd = deriveEnd(next[j - 1]);
          next[j] = { ...next[j], sprint_date_start: prevEnd ? addDays(prevEnd, 1) : "" };
        }
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const sprints = rows.map((r, i) => {
        const velocity = parseInt(r.sprint_velocity, 10);
        return {
          sprint_name: `${cfg.namePrefix} ${nextNumber + i}`,
          sprint_suffix: r.sprint_suffix || undefined,
          sprint_cadence_days: parseInt(r.sprint_cadence_days, 10),
          sprint_date_start: r.sprint_date_start,
          sprint_date_end: deriveEnd(r),
          sprint_velocity: isNaN(velocity) ? undefined : velocity,
          org_node_id: orgNodeId,
        };
      });
      await api(`${cfg.apiBase}/bulk-create?workspace_id=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ sprints }),
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
        <label className="form__label" style={{ margin: 0 }} htmlFor="sprint-count">
          Number of {cfg.namePrefix}s
        </label>
        <input
          id="sprint-count"
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
            key: "sprint_suffix",
            header: "Suffix (optional)",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                value={r.sprint_suffix}
                onChange={e => updateRow(r._idx, "sprint_suffix", e.target.value)}
                placeholder="e.g. Red Cherry"
              />
            ),
          },
          {
            key: "sprint_date_start",
            header: "Start",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="date"
                value={r.sprint_date_start}
                onChange={e => updateRow(r._idx, "sprint_date_start", e.target.value)}
                required
                readOnly={r._idx > 0}
              />
            ),
          },
          {
            key: "sprint_cadence_days",
            header: "Cadence (days)",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="number"
                min={1}
                value={r.sprint_cadence_days}
                onChange={e => updateRow(r._idx, "sprint_cadence_days", e.target.value)}
                required
                style={{ width: 90 }}
              />
            ),
          },
          {
            key: "sprint_date_end",
            header: "End (derived)",
            kind: "mono",
            render: (r) => deriveEnd(r) || "—",
          },
          {
            key: "sprint_velocity",
            header: "Velocity",
            kind: "custom",
            render: (r) => (
              <input
                className="form__input"
                type="number"
                min={0}
                value={r.sprint_velocity}
                onChange={e => updateRow(r._idx, "sprint_velocity", e.target.value)}
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
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (orgNodeId) params.set("org_node_id", orgNodeId);
    try {
      const data = await api<ListResponse>(`${cfg.apiBase}?${params.toString()}`);
      const items = (data.sprints ?? []) as AnyRow[];
      setRows(items);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}s`);
      setRows([]);
    }
  }, [cfg.apiBase, kind, workspaceId, orgNodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<AnyRow>[] = [
    {
      key: "sprint_name",
      header: "Name",
      kind: "custom",
      render: (r) => {
        const s = r as SprintRow;
        return s.sprint_suffix
          ? <>{s.sprint_name} <span style={{ color: "var(--ink-3)" }}>({s.sprint_suffix})</span></>
          : <>{s.sprint_name}</>;
      },
    },
    { key: "sprint_date_start", header: "Start", kind: "mono" },
    { key: "sprint_date_end", header: "End", kind: "mono" },
    { key: "sprint_cadence_days", header: "Cadence (days)", kind: "numeric" },
    {
      key: "status",
      header: "Status",
      kind: "pill",
      pillVariant: (r) => statusVariant((r as SprintRow).status),
      pillLabel: (r) => (r as SprintRow).status,
    },
    {
      key: "sprint_scope",
      header: "Scope",
      kind: "numeric",
      render: (r) => String((r as SprintRow).sprint_scope ?? "—"),
    },
    {
      key: "sprint_velocity",
      header: "Velocity",
      kind: "numeric",
      render: (r) => String((r as SprintRow).sprint_velocity ?? "—"),
    },
  ];

  // Derive next sprint number and last end date from existing rows
  const nextNumber = (rows?.length ?? 0) + 1;
  const lastEndDate = rows?.length
    ? [...rows].sort((a, b) => b.sprint_date_end.localeCompare(a.sprint_date_end))[0].sprint_date_end
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
          onCreated={() => { setCreating(false); void load(); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Table<AnyRow>
          pageId={`timebox_${kind}`}
          slot="list"
          ariaLabel={`${cfg.namePrefix} list`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={rows === null}
          empty={`No ${kind}s found.`}
        />
      )}
    </Panel>
  );
}

// ── Samantha _timebox substrate registration (PLA-0027 / Story 00519) ─────────

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

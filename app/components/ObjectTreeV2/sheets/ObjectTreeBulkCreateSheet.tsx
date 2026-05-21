"use client";

// <ObjectTreeBulkCreateSheet> — inline bulk-create surface for
// ObjectTreeV2. Renders below the ActionBar and pushes the grid down
// (sheet, not modal — see slice 6 design decision 2026-05-21).
//
// TIMEBOXES-ONLY. The shell is generic so other kinds *could* use it
// in principle, but bulk-create is a domain-specific pattern owned by
// sprints + releases. Never wire a non-timebox grid to this sheet.
//
// Two cascade rules are hard-coded behind boolean flags (the JSON
// config toggles them, but the math lives here, not in the config):
//
//   cascadeStartFromPrevEnd  — row N's start = row (N-1)'s end + 1 day
//   deriveEndFromCadence     — end = start + (cadence_days - 1)
//
// The column list is data (declared per-kind in p_wizard_<kind>.json),
// the cascade rules are code. That split keeps the JSON honest — config
// describes *what* to render, never *how* to compute.

import React, { useState, useCallback, useMemo } from "react";
import Table, { Column } from "@/app/components/Table";

// ── Config shape ───────────────────────────────────────────────────────────

/**
 * Per-column descriptor for the bulk-create row table.
 *
 * `type` controls the rendered input:
 *   text     — plain text input
 *   date     — <input type="date">
 *   number   — <input type="number">
 *   derived  — read-only display, computed by the sheet (no input)
 */
export interface BulkColumnSpec {
  /** Stable key within the sheet's row model (e.g. "suffix", "date_start"). */
  key: string;
  /** Wire key used when serialising rows to the bulk-create payload. */
  wireKey: string;
  /** Column header text. */
  label: string;
  /** Renderer hint — drives input type and cascade behaviour. */
  type: "text" | "date" | "number" | "derived";
  /** Default value applied when the row is first created. */
  default?: string | number;
  /** When true on a "date" column, only row 0 is editable; later rows cascade. */
  lockAfterFirst?: boolean;
  /** When true, omit the wire key from the payload if the value is blank. */
  optional?: boolean;
  /** Required for type="derived" — keys whose values feed the derivation. */
  derivedFrom?: ReadonlyArray<string>;
  /** UI hint — pixel width for narrow numeric columns. */
  width?: number;
  /** Placeholder text for the input. */
  placeholder?: string;
}

export interface BulkCreateConfig {
  /** Button label that opens the sheet (also used as panel title). */
  label: string;
  /** Backend bulk-create endpoint, e.g. "/timebox-sprints/bulk-create". */
  endpoint: string;
  /** JSON list key on the bulk payload, e.g. "sprints" or "releases". */
  listKey: string;
  /** Name template, e.g. "Sprint {n}" — {n} substitutes nextNumber+i. */
  namePattern: string;
  /** Wire key the namePattern resolves to, e.g. "timeboxes_sprints_name". */
  namePrefixField: string;
  /** Default row count when the sheet opens. */
  defaultCount?: number;
  /** Maximum allowed row count. */
  maxCount?: number;
  /** Cascade rules — toggle math the shell performs. */
  rules?: {
    cascadeStartFromPrevEnd?: boolean;
    deriveEndFromCadence?: boolean;
  };
  /** Ordered column descriptors. */
  columns: ReadonlyArray<BulkColumnSpec>;
}

// ── Sheet props ────────────────────────────────────────────────────────────

export interface ObjectTreeBulkCreateSheetProps {
  config: BulkCreateConfig;
  /**
   * Hidden wire keys folded into every row's payload (e.g. workspace
   * scope, topology node, scope_propagation). Caller-supplied so the
   * sheet shell stays domain-agnostic.
   */
  payloadContext?: Record<string, unknown>;
  /** Next sequence number for namePattern substitution. */
  nextNumber: number;
  /** Anchor date for the first row's start; rows cascade forward from here. */
  startAnchor?: string;
  /** Submit handler — receives the prepared rows ready for POST. */
  onSubmit: (rows: Array<Record<string, unknown>>) => Promise<void> | void;
  /** Cancel handler — closes the sheet without submitting. */
  onCancel: () => void;
  /** Optional aria label override (defaults to config.label). */
  ariaLabel?: string;
}

// ── Date helpers ───────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return dt.toISOString().slice(0, 10);
}

// ── Row model ──────────────────────────────────────────────────────────────

type RowModel = Record<string, string>;

function buildEmptyRow(config: BulkCreateConfig, anchorStart: string): RowModel {
  const row: RowModel = {};
  for (const col of config.columns) {
    if (col.type === "derived") continue;
    if (col.type === "date" && col.lockAfterFirst) {
      row[col.key] = anchorStart;
    } else if (col.default !== undefined) {
      row[col.key] = String(col.default);
    } else {
      row[col.key] = "";
    }
  }
  return row;
}

function deriveValue(
  col: BulkColumnSpec,
  row: RowModel,
  rules: BulkCreateConfig["rules"],
): string {
  if (!col.derivedFrom || col.derivedFrom.length === 0) return "";
  // Only one derived rule exists today: date_end = start + (cadence-1).
  // Detect it by the columns it consumes; if the rule isn't enabled or
  // the inputs don't match, return blank.
  if (
    rules?.deriveEndFromCadence &&
    col.derivedFrom.length === 2 &&
    col.derivedFrom.some((k) => k.includes("start")) &&
    col.derivedFrom.some((k) => k.includes("cadence"))
  ) {
    const startKey = col.derivedFrom.find((k) => k.includes("start"))!;
    const cadenceKey = col.derivedFrom.find((k) => k.includes("cadence"))!;
    const start = row[startKey];
    const cadence = parseInt(row[cadenceKey] ?? "", 10);
    if (!start || isNaN(cadence) || cadence <= 0) return "";
    return addDays(start, cadence - 1);
  }
  return "";
}

function cascadeStarts(
  rows: RowModel[],
  config: BulkCreateConfig,
): RowModel[] {
  if (!config.rules?.cascadeStartFromPrevEnd) return rows;
  const dateCol = config.columns.find(
    (c) => c.type === "date" && c.lockAfterFirst,
  );
  if (!dateCol) return rows;

  const next = rows.map((r) => ({ ...r }));
  for (let i = 1; i < next.length; i++) {
    const prev = next[i - 1];
    // Find the derived end-date for the previous row.
    const endCol = config.columns.find(
      (c) => c.type === "derived" && c.derivedFrom?.includes(dateCol.key),
    );
    if (!endCol) continue;
    const prevEnd = deriveValue(endCol, prev, config.rules);
    next[i] = {
      ...next[i],
      [dateCol.key]: prevEnd ? addDays(prevEnd, 1) : "",
    };
  }
  return next;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ObjectTreeBulkCreateSheet({
  config,
  payloadContext = {},
  nextNumber,
  startAnchor = "",
  onSubmit,
  onCancel,
  ariaLabel,
}: ObjectTreeBulkCreateSheetProps) {
  const defaultCount = config.defaultCount ?? 1;
  const maxCount = config.maxCount ?? 52;
  const firstStart = startAnchor ? addDays(startAnchor, 1) : "";

  const [count, setCount] = useState(defaultCount);
  const [rows, setRows] = useState<RowModel[]>(() => {
    const seed = Array.from({ length: defaultCount }, () =>
      buildEmptyRow(config, firstStart),
    );
    return cascadeStarts(seed, config);
  });
  const [saving, setSaving] = useState(false);

  const applyCount = useCallback(
    (n: number) => {
      const clamped = Math.max(1, Math.min(maxCount, n));
      setCount(clamped);
      setRows((prev) => {
        if (clamped <= prev.length) return prev.slice(0, clamped);
        const additions = clamped - prev.length;
        const grown = [...prev];
        for (let i = 0; i < additions; i++) {
          grown.push(buildEmptyRow(config, ""));
        }
        return cascadeStarts(grown, config);
      });
    },
    [config, maxCount],
  );

  const updateCell = useCallback(
    (rowIdx: number, key: string, value: string) => {
      setRows((prev) => {
        const next = prev.map((r, i) =>
          i === rowIdx ? { ...r, [key]: value } : r,
        );
        return cascadeStarts(next, config);
      });
    },
    [config],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      try {
        const payload = rows.map((row, i) => {
          const out: Record<string, unknown> = { ...payloadContext };
          out[config.namePrefixField] = config.namePattern.replace(
            "{n}",
            String(nextNumber + i),
          );
          for (const col of config.columns) {
            let value: unknown;
            if (col.type === "derived") {
              value = deriveValue(col, row, config.rules);
            } else if (col.type === "number") {
              const parsed = parseInt(row[col.key] ?? "", 10);
              value = isNaN(parsed) ? undefined : parsed;
            } else {
              value = row[col.key] || undefined;
            }
            if (col.optional && (value === "" || value === undefined)) continue;
            out[col.wireKey] = value;
          }
          return out;
        });
        await onSubmit(payload);
      } finally {
        setSaving(false);
      }
    },
    [rows, payloadContext, config, nextNumber, onSubmit],
  );

  const tableColumns: Column<RowModel & { _idx: number }>[] = useMemo(() => {
    const cols: Column<RowModel & { _idx: number }>[] = [
      {
        key: "_name",
        header: "Name",
        kind: "custom",
        render: (r) => (
          <span style={{ fontWeight: 500, color: "var(--ink-muted)" }}>
            {config.namePattern.replace("{n}", String(nextNumber + r._idx))}
          </span>
        ),
      },
    ];
    for (const col of config.columns) {
      cols.push({
        key: col.key,
        header: col.label,
        kind: col.type === "derived" ? "mono" : "custom",
        render: (r) => renderCell(col, r, updateCell, config.rules),
      });
    }
    return cols;
  }, [config, nextNumber, updateCell]);

  const rowsWithIdx = useMemo<Array<RowModel & { _idx: number }>>(
    () =>
      rows.map(
        (r, i) => ({ ...r, _idx: i } as RowModel & { _idx: number }),
      ),
    [rows],
  );

  return (
    <form
      className="form objecttree-v2__bulk-sheet"
      onSubmit={handleSubmit}
      role="region"
      aria-label={ariaLabel ?? config.label}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label className="form__label" style={{ margin: 0 }} htmlFor="objecttree-v2-bulk-count">
          Number to create
        </label>
        <input
          id="objecttree-v2-bulk-count"
          className="form__input"
          type="number"
          min={1}
          max={maxCount}
          value={count}
          onChange={(e) => applyCount(parseInt(e.target.value, 10) || 1)}
          style={{ width: 72 }}
        />
      </div>
      <Table<RowModel & { _idx: number }>
        pageId="objecttree-v2-bulk-create"
        slot="create"
        ariaLabel={`${config.label} bulk create`}
        columns={tableColumns}
        rows={rowsWithIdx}
        rowKey={(r) => String(r._idx)}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary btn--sm"
          disabled={saving}
        >
          {saving ? "Creating…" : `Create ${rows.length}`}
        </button>
      </div>
    </form>
  );
}

// ── Cell renderer ──────────────────────────────────────────────────────────

function renderCell(
  col: BulkColumnSpec,
  row: RowModel & { _idx: number },
  updateCell: (rowIdx: number, key: string, value: string) => void,
  rules: BulkCreateConfig["rules"],
): React.ReactNode {
  if (col.type === "derived") {
    return deriveValue(col, row, rules) || "—";
  }
  const locked = col.type === "date" && col.lockAfterFirst && row._idx > 0;
  const widthStyle = col.width ? { width: col.width } : undefined;
  if (col.type === "date") {
    return (
      <input
        className="form__input"
        type="date"
        value={row[col.key] ?? ""}
        onChange={(e) => updateCell(row._idx, col.key, e.target.value)}
        required={!col.optional}
        readOnly={locked}
        placeholder={col.placeholder}
        style={widthStyle}
      />
    );
  }
  if (col.type === "number") {
    return (
      <input
        className="form__input"
        type="number"
        min={0}
        value={row[col.key] ?? ""}
        onChange={(e) => updateCell(row._idx, col.key, e.target.value)}
        required={!col.optional}
        placeholder={col.placeholder ?? (col.optional ? "—" : undefined)}
        style={widthStyle ?? { width: 90 }}
      />
    );
  }
  // text
  return (
    <input
      className="form__input"
      type="text"
      value={row[col.key] ?? ""}
      onChange={(e) => updateCell(row._idx, col.key, e.target.value)}
      required={!col.optional}
      placeholder={col.placeholder}
      style={widthStyle}
    />
  );
}

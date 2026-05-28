"use client";

// CustomFieldsAdapter — the per-row-type orchestration shim for the
// custom-fields catalogue admin grid. Mounted on
// /workspace-admin/custom-fields via the OTV2 generic surface (Task 5).
//
// Contract: see app/components/ObjectTreeV2/adapters/types.ts. The adapter
// owns:
//   - column shape (Label / Name / Type / Scope / Updated)
//   - filter chips + sort state (scope filter + label sort)
//   - patch wire (updateWorkspaceField)
//   - create-action (single "Create Field" button → opens header flyout)
//   - per-row buttons (Edit + Archive)
//   - row + create flyouts (the two-column edit form)
//
// Behaviour parity is the bar: every interaction the legacy /[id] editor
// supported (validate name/label, lock data-type on edit, replace bindings)
// goes through CustomFieldEditForm + the host of this adapter.
//
// Plan: docs/superpowers/plans/2026-05-28-objecttree-generic-rowtype.md
// (Task 3, Step 4).

import React, { useEffect, useRef, useState } from "react";
import {
  archiveWorkspaceField,
  getWorkspaceFields,
  updateWorkspaceField,
  type FieldUpdate,
  type WorkspaceField,
} from "@/app/lib/fieldsApi";
import CustomFieldFlyout from "@/app/components/CustomFields/CustomFieldFlyout";
import type { ColumnDef, RowButton } from "@/app/components/ResourceTree";
import type {
  AdapterColumnContext,
  AdapterCreateContext,
  AdapterFiltersResult,
  CreateActionResult,
  ObjectTreeAdapter,
  RenderCreateFlyoutContext,
  RenderRowFlyoutContext,
} from "@/app/components/ObjectTreeV2/adapters/types";

// ── Adapter options ─────────────────────────────────────────────────────────

export interface CustomFieldsAdapterOptions {
  /** The active workspace id — every wire call is scoped to it. */
  workspaceId: string;
}

// ── Filter state shape (stashed in filtersRef for the host fetch loop) ──────

interface CustomFieldsFilters {
  scope: "all" | "tenant" | "workspace" | "global";
}

// ── Internal: scope filter chip ─────────────────────────────────────────────
//
// Small pill-shaped chip with four options. Kept inline here because it's
// only used by this adapter; promoting it to a shared component is
// deferrable until a second consumer arrives.

interface ScopeFilterChipProps {
  value: CustomFieldsFilters["scope"];
  onChange: (next: CustomFieldsFilters["scope"]) => void;
}

const SCOPE_OPTIONS: { value: CustomFieldsFilters["scope"]; label: string }[] = [
  { value: "all", label: "All scopes" },
  { value: "tenant", label: "Tenant" },
  { value: "workspace", label: "Workspace" },
  { value: "global", label: "Global" },
];

function ScopeFilterChip({ value, onChange }: ScopeFilterChipProps) {
  return (
    <label className="custom-fields-scope-chip">
      <span className="custom-fields-scope-chip__Label">Scope</span>
      <select
        className="custom-fields-scope-chip__Select"
        value={value}
        onChange={(e) =>
          onChange(e.target.value as CustomFieldsFilters["scope"])
        }
      >
        {SCOPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Util: ISO → short locale date ───────────────────────────────────────────
//
// Keeps the dependency surface tight (no date-fns / dayjs needed). Falls
// back to the raw string when parsing fails so we never silently render
// "Invalid Date" inside the grid.

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createCustomFieldsAdapter(
  opts: CustomFieldsAdapterOptions,
): ObjectTreeAdapter<WorkspaceField> {
  const { workspaceId } = opts;

  return {
    // ── Extras: nothing to inject (no flowStates, no colourMap). ──────────
    useExtras(): Record<string, unknown> {
      return {};
    },

    // ── Filter chips + sort state ────────────────────────────────────────
    //
    // Per-grid filter prefs persistence is NOT wired here — inline useState
    // is fine for now (PLA-0023-style follow-up captures the migration).
    // The host's fetch loop reads filtersRef.current for the wire params.
    useFiltersAndSort(_opts: {
      prefKey: string;
      urlPrefix?: string;
    }): AdapterFiltersResult {
      void _opts; // pref keys deferred — see comment above.
      const [scope, setScope] = useState<CustomFieldsFilters["scope"]>("all");
      const [sortKey, setSortKey] = useState<string>("label");
      const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

      const filtersRef = useRef<CustomFieldsFilters>({ scope });
      // Keep filtersRef current so the host fetch loop sees the latest
      // scope when chips fire (matches the WorkItemsAdapter pattern).
      useEffect(() => {
        filtersRef.current = { scope };
      }, [scope]);

      return {
        filterChips: <ScopeFilterChip value={scope} onChange={setScope} />,
        sortKey,
        sortDir,
        setSort: (k: string, d: "asc" | "desc") => {
          setSortKey(k);
          setSortDir(d);
        },
        filtersRef: filtersRef as React.MutableRefObject<unknown>,
      };
    },

    // ── Column builder ──────────────────────────────────────────────────
    //
    // ctx.patchAndApply is the host's optimistic-patch closure. The
    // custom-fields columns are read-only display today (no inline edits
    // beyond Label / Name renames, which the flyout already covers), so
    // we don't wire it into any cell — leave the seam in place for when
    // inline edits land.
    buildColumns(ctx: AdapterColumnContext<WorkspaceField>): ColumnDef<WorkspaceField>[] {
      void ctx; // patchAndApply reserved for future inline-edit columns.
      return [
        {
          key: "label",
          label: "Label",
          width: null,
          render: (row) => <>{row.label}</>,
        },
        {
          key: "name",
          label: "Name",
          width: 200,
          align: "mono",
          render: (row) => <code>{row.name}</code>,
        },
        {
          key: "data_type",
          label: "Type",
          width: 140,
          render: (row) => <>{row.data_type}</>,
        },
        {
          key: "scope",
          label: "Scope",
          width: 120,
          render: (row) => <>{row.scope}</>,
        },
        {
          key: "updated_at",
          label: "Updated",
          width: 140,
          render: (row) => <>{formatShortDate(row.updated_at)}</>,
        },
      ];
    },

    // ── Patch wire ──────────────────────────────────────────────────────
    async patchRow(rowId: string, body: Partial<WorkspaceField>): Promise<WorkspaceField> {
      return await updateWorkspaceField(
        workspaceId,
        rowId,
        body as Partial<FieldUpdate>,
      );
    },

    // ── Fetch wire ──────────────────────────────────────────────────────
    //
    // The fields API returns {workspace_id, fields: [...]} — not the OTV2
    // canonical {items, total} envelope. Translate at the adapter boundary
    // so useObjectTreeWindow gets the shape it expects. The endpoint
    // doesn't paginate (returns all fields for the workspace); pagination
    // math is owned by ResourceTree's window logic at current scale (66
    // rows live). Add ?limit/?offset to the wire when catalogue size
    // grows past ~500.
    async fetchPage(): Promise<{ items: WorkspaceField[]; total: number }> {
      const rows = await getWorkspaceFields(workspaceId);
      // Drop global-scope rows from the admin grid view (read-only,
      // vector_admin-owned — they belong in a separate read-only surface,
      // not the catalogue editor).
      const items = rows.filter((r) => r.scope !== "global");
      return { items, total: items.length };
    },

    // ── Create action ───────────────────────────────────────────────────
    //
    // Single button — the catalogue surface only ever creates "one kind"
    // of thing (a field), so no type-picker. Clicking fires the host's
    // onOpenCreateFlyout callback, which the host wires up to mount
    // renderCreateFlyout() above the grid.
    buildCreateAction(ctx: AdapterCreateContext): CreateActionResult {
      return {
        node: (
          <button
            type="button"
            className="action-btn action-btn--primary"
            onClick={() => ctx.onOpenCreateFlyout?.()}
          >
            Create Field
          </button>
        ),
      };
    },

    // ── Per-row buttons (Edit + Archive) ────────────────────────────────
    buildRowButtons(
      row: WorkspaceField,
      ctx: { onOpenFlyout?: () => void },
    ): RowButton[] {
      return [
        {
          key: "edit",
          label: "Edit",
          onClick: () => ctx.onOpenFlyout?.(),
          variant: "ghost",
        },
        {
          key: "archive",
          label: "Archive",
          onClick: () => {
            // Confirm-then-archive matches the legacy editor's destructive-
            // action pattern. The host refetches the window on success via
            // its own onPatched / refetch chain (the same path inline
            // edits ride). No-op on cancel.
            if (
              typeof window !== "undefined" &&
              window.confirm(
                `Archive "${row.label}"? Existing values are preserved; the field disappears from new pickers.`,
              )
            ) {
              void archiveWorkspaceField(workspaceId, row.id);
            }
          },
          variant: "secondary",
        },
      ];
    },

    // ── Row + create flyouts ────────────────────────────────────────────
    renderRowFlyout(
      row: WorkspaceField,
      ctx: RenderRowFlyoutContext<WorkspaceField>,
    ): React.ReactNode {
      return (
        <CustomFieldFlyout
          workspaceId={workspaceId}
          initial={row}
          onClose={ctx.onClose}
          onSaved={ctx.onSaved}
        />
      );
    },
    renderCreateFlyout(
      ctx: RenderCreateFlyoutContext<WorkspaceField>,
    ): React.ReactNode {
      return (
        <CustomFieldFlyout
          workspaceId={workspaceId}
          initial={null}
          onClose={ctx.onClose}
          onSaved={ctx.onCreated}
        />
      );
    },
  };
}

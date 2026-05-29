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
import { apiSite } from "@/app/lib/api";
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
  // Source filter — "custom" (today's view, real catalogue rows only),
  // "core" (synthesised CORE rows only, read-only), or "all" (both,
  // merged client-side). Default is "custom" so the catalogue admin
  // grid keeps its existing semantics until the user opts in to the
  // unified view. Source-of-truth for CORE rows is the wire payload of
  // /work-items/columns (backend/internal/artefactitems/columns.go).
  source: "all" | "custom" | "core";
}

// Synthetic discriminator written into `scope` on CORE rows so the
// grid can detect them downstream. Real catalogue rows can never use
// this string — the CHECK constraint on artefacts_fields_library_scope
// limits it to "global" | "tenant" | "workspace".
const CORE_SCOPE_SENTINEL = "_core" as const;
type CoreScopeSentinel = typeof CORE_SCOPE_SENTINEL;

// Local widening of WorkspaceField["scope"] used at this adapter's
// equality-check seams. The synthesised CORE rows carry the sentinel
// string on scope, so every downstream comparison reads the row as
// FieldScopeOrCore. We deliberately keep the WorkspaceField wire type
// narrow (3 real scopes) and widen here at the boundary instead.
type FieldScopeOrCore = WorkspaceField["scope"] | CoreScopeSentinel;
const rowScope = (r: WorkspaceField): FieldScopeOrCore =>
  r.scope as FieldScopeOrCore;

// Synthetic id prefix written into `id` on CORE rows. Lets the rest of
// the codebase tell synthetic rows apart from real catalogue rows
// without having to peek at .scope (e.g. row key generation in the
// grid).
const CORE_ID_PREFIX = "_core::" as const;

// Wire shape for one entry returned by GET /work-items/columns. Mirrors
// backend/internal/artefactitems/columns.go::ColumnSpec; absent fields
// are omitempty on the server side and default to false on the client.
interface ColumnSpecWire {
  name: string;
  always_on?: boolean;
  label?: string;
  group?: string;
  default_visible?: boolean;
  addable: boolean;
}

interface ColumnsListResponse {
  columns: ColumnSpecWire[];
}

// Map a ColumnSpec.group string to a best-effort data_type. The columns
// endpoint doesn't carry a wire data-type today, so we read it off the
// section heading the picker uses to bucket columns. This is intentional
// best-effort labelling for the Type column in the admin grid — it is
// NOT load-bearing for any wire contract. The fallback "field" keeps
// the cell non-empty for groups we don't have a mapping for.
function inferCoreDataType(spec: ColumnSpecWire): string {
  // Hand-mapped from the existing ArtefactItemColumns groups + name
  // shape. Boolean columns are recognised by the `is_` prefix on
  // existing entries (is_blocked) and the boolean catalogue rows added
  // in this workstream (is_expedite, is_ready). Date columns end in
  // `_date` (due_date) or `_at` (created_at, updated_at, archived_at).
  // Everything else falls back to its group label.
  if (spec.name.startsWith("is_")) return "boolean";
  if (spec.name.endsWith("_date")) return "date";
  if (spec.name.endsWith("_at")) return "timestamp";
  switch (spec.group) {
    case "Priority & Estimation":
      return "number";
    case "Identity":
    case "Content":
    case "Workflow":
    case "Planning":
    case "Hierarchy":
    case "People":
    case "Topology":
    case "Visual":
    case "Audit":
      return spec.group.toLowerCase();
    default:
      return "field";
  }
}

// Synthesise a WorkspaceField-shaped row from one ColumnSpec. The id is
// a sentinel-prefixed marker, the scope is the CORE_SCOPE_SENTINEL so
// downstream code (buildRowButtons / renderRowFlyout / Source pill) can
// branch on it. archived_at is null because the column is live by
// definition (catalogue rows track archival; core columns either exist
// or they don't). created_at + updated_at are empty strings — the
// columns endpoint doesn't carry any temporal data, and the Updated
// cell renders "" via formatShortDate for empty inputs.
function synthesiseCoreRow(spec: ColumnSpecWire): WorkspaceField {
  return {
    id: CORE_ID_PREFIX + spec.name,
    subscription_id: null,
    name: spec.name,
    label: spec.label || spec.name,
    data_type: inferCoreDataType(spec),
    // The cast to WorkspaceField["scope"] keeps the type narrow at call
    // sites; the sentinel string is a deliberate synthetic widening
    // documented by CORE_SCOPE_SENTINEL above.
    scope: CORE_SCOPE_SENTINEL as unknown as WorkspaceField["scope"],
    created_at: "",
    updated_at: "",
  };
}

// fetchCoreColumns hits /_site/work-items/columns and returns the
// allow-list catalogue. Network errors fail open — empty list — so a
// transient outage doesn't break the custom grid view, only the core
// view. The caller logs the error to console for debug visibility.
async function fetchCoreColumns(): Promise<ColumnSpecWire[]> {
  try {
    const res = await apiSite<ColumnsListResponse>("/work-items/columns");
    return res.columns ?? [];
  } catch (err) {
    // Don't tank the whole grid if the columns endpoint blips. The
    // custom rows still render; only the synthesised CORE rows are
    // missing, which is the safer failure mode for a read-only view.
    // eslint-disable-next-line no-console
    console.warn("customFieldsAdapter: failed to fetch /work-items/columns", err);
    return [];
  }
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

// ── Internal: source filter chip ────────────────────────────────────────────
//
// Sibling of ScopeFilterChip — same pill geometry, different state. Toggles
// between catalogue rows only (custom), synthesised CORE rows only, or
// both merged client-side. Default is "custom" to match today's view.

interface SourceFilterChipProps {
  value: CustomFieldsFilters["source"];
  onChange: (next: CustomFieldsFilters["source"]) => void;
}

const SOURCE_OPTIONS: { value: CustomFieldsFilters["source"]; label: string }[] = [
  { value: "custom", label: "Custom only" },
  { value: "core", label: "Core only" },
  { value: "all", label: "All sources" },
];

function SourceFilterChip({ value, onChange }: SourceFilterChipProps) {
  return (
    <label className="custom-fields-scope-chip">
      <span className="custom-fields-scope-chip__Label">Source</span>
      <select
        className="custom-fields-scope-chip__Select"
        value={value}
        onChange={(e) =>
          onChange(e.target.value as CustomFieldsFilters["source"])
        }
      >
        {SOURCE_OPTIONS.map((o) => (
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

  // Factory-scoped pointer to the live filter state. useFiltersAndSort
  // re-points this on every render; fetchPage reads it. This lets
  // fetchPage stay sync with the chip state without the host needing
  // to thread filtersRef into the params shape (which it doesn't,
  // today). The pointer is single-mount per grid — the factory is
  // called once per ObjectTreeV2 mount.
  let currentFilters: CustomFieldsFilters = { scope: "all", source: "custom" };

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
      // Source defaults to "custom" — preserves today's view until the
      // user opts in to see CORE rows. See the 2026-05-29 core-field
      // demotion spec §4.3 for the design call.
      const [source, setSource] = useState<CustomFieldsFilters["source"]>("custom");
      const [sortKey, setSortKey] = useState<string>("label");
      const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

      const filtersRef = useRef<CustomFieldsFilters>({ scope, source });
      // Keep filtersRef AND the factory-scoped currentFilters pointer
      // current so the host fetch loop AND fetchPage see the latest
      // scope + source when chips fire (matches the WorkItemsAdapter
      // pattern; the currentFilters mirror is local because fetchPage
      // doesn't receive filtersRef in its params shape).
      useEffect(() => {
        filtersRef.current = { scope, source };
        currentFilters = { scope, source };
      }, [scope, source]);

      return {
        // Two chips rendered side-by-side in the ActionBar filter slot.
        // Order: Source first (the new toggle), Scope second (existing).
        // Wrapped in a fragment because filterChips is React.ReactNode.
        filterChips: (
          <>
            <SourceFilterChip value={source} onChange={setSource} />
            <ScopeFilterChip value={scope} onChange={setScope} />
          </>
        ),
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
          // CORE rows carry the CORE_SCOPE_SENTINEL ("_core") instead of a
          // real catalogue scope value — render that as the literal token
          // "core" so the cell reads cleanly without leaking the sentinel
          // syntax to end users.
          render: (row) => (
            <>{rowScope(row) === CORE_SCOPE_SENTINEL ? "core" : row.scope}</>
          ),
        },
        {
          key: "source",
          label: "Source",
          width: 100,
          // Source pill — distinguishes synthesised CORE rows from real
          // catalogue (CUSTOM) rows at a glance. CORE rows are visually
          // muted because they're read-only here (the inline edit form
          // doesn't apply); CUSTOM rows take the accent variant.
          render: (row) =>
            rowScope(row) === CORE_SCOPE_SENTINEL ? (
              <span className="source-pill source-pill--core">CORE</span>
            ) : (
              <span className="source-pill source-pill--custom">CUSTOM</span>
            ),
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
      // Read the active source filter from the factory-scoped mirror
      // (updated by useFiltersAndSort's effect). Default "custom" keeps
      // today's behaviour when the chip hasn't been touched yet.
      const source = currentFilters.source;

      // Custom catalogue rows — fetched unless the user opted out via
      // source="core". Global rows are dropped from the admin grid view
      // (read-only, vector_admin-owned; they belong in a separate
      // read-only surface, not the catalogue editor).
      const wantCustom = source === "custom" || source === "all";
      const wantCore = source === "core" || source === "all";

      const customPromise: Promise<WorkspaceField[]> = wantCustom
        ? getWorkspaceFields(workspaceId).then((rows) =>
            rows.filter((r) => r.scope !== "global"),
          )
        : Promise.resolve([]);

      // CORE rows — synthesised from /work-items/columns. Each spec
      // becomes one read-only WorkspaceField-shaped row keyed by the
      // CORE_ID_PREFIX. fetchCoreColumns fails open to [] on transient
      // errors so the rest of the grid keeps working.
      const corePromise: Promise<WorkspaceField[]> = wantCore
        ? fetchCoreColumns().then((cols) => cols.map(synthesiseCoreRow))
        : Promise.resolve([]);

      const [customRows, coreRows] = await Promise.all([customPromise, corePromise]);

      // Segmentation: in "all" mode show CUSTOM rows first, then CORE
      // (matches the user's mental model — the rows they own come first,
      // the schema-supplied rows come after as a reference set). Inside
      // each segment, preserve the server-supplied order (the host
      // applies sort on top via its sort state).
      const items: WorkspaceField[] = [...customRows, ...coreRows];
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
            className="btn btn--primary"
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
      // CORE rows are synthesised from the wire columns catalogue — they
      // have no underlying artefacts_fields_library row to edit or
      // archive. Returning an empty button list hides the action cluster
      // entirely for those rows.
      if (rowScope(row) === CORE_SCOPE_SENTINEL) return [];
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
      // CORE rows have no inline edit form — return null so the host
      // doesn't mount the CustomFieldFlyout for a row that has no
      // backing catalogue record. (The host treats null as "no flyout
      // available" and skips the open-on-click affordance.)
      if (rowScope(row) === CORE_SCOPE_SENTINEL) return null;
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

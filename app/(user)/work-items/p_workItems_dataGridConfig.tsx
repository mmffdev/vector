"use client";

// Page-owned sidecar — wires <DataGrid> for the work-items surface.
//
// IMPORTANT: this file lives in app/(user)/work-items/ ON PURPOSE.
// The DataGrid scaffold knows nothing about work-items; everything
// dataset-specific (columns, fetch endpoint, flyout body, row menu)
// is owned here. Editing this file CANNOT affect /risks, /value-sprint,
// or any other surface that mounts its own DataGrid config.
//
// To wire a new column, sort behaviour, or flyout content for the
// work-items grid — edit THIS file. Never reach into DataGrid/.

import React from "react";
import {
  TbAdjustmentsHorizontal,
  TbCircleCheck,
  TbCopy,
  TbEye,
  TbFlag,
  TbTrash,
  TbUser,
} from "react-icons/tb";
import { apiSite } from "@/app/lib/api";
import type {
  DataGridConfig,
  DataGridColumn,
  FetchParams,
  FetchResult,
  RowTreeCtx,
} from "@/app/components/DataGrid/types";
// Reuse ResourceTree's exported primary-cell helpers verbatim — the same
// ├─ / └─ tree lines + expander caret the OTV2 surface draws. They consume
// the RowTreeCtx geometry the DataGrid scaffold computes, so the grid and
// the tree render identical hierarchy chrome with zero duplicated SVG.
import {
  PrimaryCellTreeLines,
  PrimaryCellExpander,
} from "@/app/components/ResourceTree";
// Import the form BODY (named export), not the default envelope. The
// envelope adds its own slide-open animation + scroll-into-view designed
// for the bottom of an ObjectTree; the DataGrid row flyout already owns
// the open/close container, so we mount the body directly to avoid a
// double-wrap. The body assumes a non-null artefactId — which the flyout
// guarantees (it only renders renderBody for an opened row).
import { ArtefactInlineForm } from "@/app/components/ArtefactInlineForm/ArtefactInlineForm";

// ────────────────────────────────────────────────────────────────────────────
// Row shape (subset of WorkItem, scoped to what the grid renders)
// ────────────────────────────────────────────────────────────────────────────
export interface WorkItemRow {
  id:       string;        // "US-17357" — `${type_prefix}-${key_num}`
  uuid:     string;        // artefact UUID — used for /children + the flyout
  type:     string;        // real type_prefix ("US", "EP", "DE", "TA", "FE"…)
  summary:  string;
  status:   string;        // flow_state_code, 1–2 chars ("T","I","D","C"…)
  points:   number | null;
  owner:    string;
  parent:   string | null; // display label, e.g. "EP-11885 — Insurance · Clai…"
  parentId: string | null; // stable human id of the parent, e.g. "EP-11885" — used to nest
  sprint:   string | null;
  due:      string | null;
  childrenCount: number;   // IN-PAGE child count (see nestWindow) — drives the caret
  colour:   string | null; // per-artefact colour → leading stripe
}

// ────────────────────────────────────────────────────────────────────────────
// Cell renderers
// ────────────────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: WorkItemRow["type"] }) {
  return <span className="data-grid__cell_typeBadge">{type}</span>;
}

function IdCell({ row }: { row: WorkItemRow }) {
  return (
    <span className="data-grid__cell_idCell">
      <TypeBadge type={row.type} />
      <span className="data-grid__cell_idCell_id">{row.id}</span>
    </span>
  );
}

function StatusPills({ status }: { status: WorkItemRow["status"] }) {
  const stages: WorkItemRow["status"][] = ["T", "I", "D", "C"];
  return (
    <span className="data-grid__cell_statusPills">
      {stages.map((s) => (
        <span
          key={s}
          className={
            s === status
              ? "data-grid__cell_statusPills_pill data-grid__cell_statusPills_pill-active"
              : "data-grid__cell_statusPills_pill"
          }
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function OwnerPill({ name }: { name: string }) {
  return <span className="data-grid__cell_ownerPill">{name}</span>;
}

// Primary (tree) cell — the Summary column in tree mode. Draws the same
// indentation lines + expander caret as OTV2's primary column (via the
// shared ResourceTree helpers), then the title text. In flat mode treeCtx
// is undefined and only the title renders (back-compat).
function SummaryCell({
  row,
  treeCtx,
}: {
  row: WorkItemRow;
  treeCtx?: RowTreeCtx;
}) {
  if (!treeCtx) return <>{row.summary}</>;
  return (
    <span className="data-grid__cell_treeCell">
      <PrimaryCellTreeLines
        depth={treeCtx.depth}
        isLast={treeCtx.isLast}
        hasVisibleChildren={treeCtx.hasVisibleChildren}
        continuations={treeCtx.continuations}
      />
      <PrimaryCellExpander
        expanded={treeCtx.expanded}
        hasChildren={treeCtx.hasChildren}
        onToggle={treeCtx.toggle}
      />
      <span className="data-grid__cell_treeCell_label">{row.summary}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Columns
// ────────────────────────────────────────────────────────────────────────────

const columns: DataGridColumn<WorkItemRow>[] = [
  {
    id: "id",
    label: "ID",
    defaultWidth: 160,
    sortable: true,
    resizable: true,
    renderCell: (r) => <IdCell row={r} />,
  },
  {
    id: "summary",
    label: "Summary",
    defaultWidth: null, // flex
    sortable: true,
    renderCell: (r, treeCtx) => <SummaryCell row={r} treeCtx={treeCtx} />,
  },
  {
    id: "status",
    label: "Status",
    defaultWidth: 220,
    sortable: true,
    resizable: true,
    renderCell: (r) => <StatusPills status={r.status} />,
  },
  {
    id: "points",
    label: "Pts",
    defaultWidth: 70,
    sortable: true,
    resizable: true,
    renderCell: (r) => (r.points === null ? "—" : r.points),
  },
  {
    id: "owner",
    label: "Owner",
    defaultWidth: 130,
    sortable: true,
    resizable: true,
    renderCell: (r) => <OwnerPill name={r.owner} />,
  },
  {
    id: "parent",
    label: "Parent",
    defaultWidth: 200,
    sortable: true,
    resizable: true,
    renderCell: (r) => (r.parent ?? "—"),
  },
  {
    id: "sprint",
    label: "Sprint",
    defaultWidth: 140,
    sortable: true,
    resizable: true,
    renderCell: (r) => (r.sprint ?? "—"),
  },
  {
    id: "due",
    label: "Due",
    defaultWidth: 100,
    sortable: true,
    resizable: true,
    renderCell: (r) => (r.due ?? "—"),
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Real wire — GET /work-items via apiSite()
//
// apiSite() attaches the Bearer token and auto-forwards the URL ?meg=
// focus hint for GET /work-items (see withForwardedMeg in app/lib/api.ts),
// so this PoC inherits the EXACT same scope posture as the production
// OTV2 page: the Sentinel middleware applies the JWT-anchored subtree
// clamp at the wire level regardless of ?meg=. No scope authority lives
// here on the client — the server is the gate.
//
// Contract (same as work-items-tree-config.tsx refetchWindow):
//   GET /work-items?limit=<n>&offset=<n>[&sort=<key>&dir=<asc|desc>]
//     → { items: WireWorkItem[]; total: number }
//
// PoC limitations vs production (documented, not hidden):
//   • Free-text search is client-side over the fetched page only — the
//     /work-items GET endpoint has no `q`/`search` param (the real OTV2
//     filters client-side too; server-side search is the search service).
//   • Filters (type/status/priority/owner) are not wired — they need the
//     catalogue UUIDs the chips resolve; out of scope for this data PoC.
// ────────────────────────────────────────────────────────────────────────────

// The fields this PoC reads off the real wire row. The production
// WorkItem (work-items-tree-config.tsx:52) carries ~30 fields; we map
// only the columns the grid renders, plus `id` (the UUID) which the row
// flyout hands to the self-fetching ArtefactInlineForm.
interface WireWorkItem {
  id:           string;        // UUID — used to open the flyout form
  key_num:      number;
  type_prefix:  string;
  title:        string;
  flow_state_code: string;
  story_points: number | null;
  sprint:       { id: string; alias: string } | null;
  parent:       { id: string; type_prefix: string; key_num: number; title: string } | null;
  owner:        { id: string; display_name: string; avatar_url: string | null } | null;
  due_date:     string | null;
  children_count: number;      // >0 → row can expand (drives the caret)
  colour:       string | null; // per-artefact colour override → leading stripe
}

// columnId (PoC) → backend SortKey whitelist
// ("id"|"title"|"status"|"priority"|"points"|"sprint"|"due"). Columns
// with no server-side key (owner, parent) return null → no sort param,
// canonical order preserved.
const SORT_KEY_BY_COLUMN: Record<string, string | null> = {
  id: "id", summary: "title", status: "status", points: "points",
  sprint: "sprint", due: "due", owner: null, parent: null,
};

// The wire flow_state_code is a slug; the dense StatusPills column shows
// single-glyph stages. Map known slugs onto a T/I/D/C glyph so the active
// pill lights up. BEST-EFFORT: flow states are per-node-configurable
// (PLA068 flow-states-per-node), so this fixed map can't cover every slug
// ("doing", custom states…). Unknown slugs fall through to the raw code —
// the proper fix is a stage-order lookup off the node's flow-state set,
// out of scope for this data-validation PoC.
const STATUS_GLYPH_BY_CODE: Record<string, string> = {
  todo: "T", in_progress: "I", doing: "I", in_review: "D", review: "D", completed: "C", done: "C",
};

function mapWireRow(w: WireWorkItem): WorkItemRow {
  return {
    id:      `${w.type_prefix}-${w.key_num}`,
    uuid:    w.id,
    type:    w.type_prefix,
    summary: w.title,
    status:  STATUS_GLYPH_BY_CODE[w.flow_state_code] ?? w.flow_state_code,
    points:  w.story_points,
    owner:   w.owner?.display_name ?? "—",
    parent:  w.parent
      ? `${w.parent.type_prefix}-${w.parent.key_num} — ${w.parent.title}`
      : null,
    parentId: w.parent ? `${w.parent.type_prefix}-${w.parent.key_num}` : null,
    sprint:  w.sprint?.alias ?? null,
    due:     w.due_date,
    // Provisional — overwritten by nestWindow with the IN-PAGE count. The
    // server's children_count over-counts under a scope clamp (it includes
    // descendants filtered OUT of the page), which would make the caret
    // promise children that aren't there. nestWindow recomputes from the
    // rows actually present.
    childrenCount: w.children_count ?? 0,
    colour:  w.colour ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Windowed-tree nesting
//
// Under the production ?meg= Sentinel clamp the LIST endpoint returns the
// WHOLE in-scope subtree FLAT (it narrows by topology-node membership, and
// suppresses the `artefacts_id_parent IS NULL` roots-only filter while a
// scope is active — see backend/internal/artefactitems/service.go). So a
// single page already contains parents AND their descendants intermixed at
// the top level. We reconstruct the hierarchy client-side:
//
//   • ROOTS (the canopy) = rows whose parent is NOT present in the page.
//     This is the correct enterprise-portfolio behaviour: when you focus a
//     mid-tree node, an Epic's parent Feature legitimately lives ABOVE your
//     clearance and is scoped out — so that Epic is the visible root of its
//     branch. A row with no parent at all is also a root.
//   • childrenIndex maps a parent's human id → its in-page children, so the
//     grid's lazy fetchChildren resolves from memory (no second request, no
//     duplicate rows — the bug the naive flat+lazy combination produced).
//   • Each row's childrenCount is recomputed to the IN-PAGE count so the
//     caret only shows when there are children actually present to reveal.
//
// Pure presentation: the wire payload is unchanged and still exactly the
// authorised scope (Server Is The Gate). We only SHAPE what the server
// already cleared us to see.
// ────────────────────────────────────────────────────────────────────────────

interface NestedWindow {
  roots: WorkItemRow[];
  childrenIndex: Map<string, WorkItemRow[]>;
}

function nestWindow(rows: WorkItemRow[]): NestedWindow {
  const present = new Set(rows.map((r) => r.id));
  const childrenIndex = new Map<string, WorkItemRow[]>();

  for (const r of rows) {
    if (r.parentId && present.has(r.parentId)) {
      const bucket = childrenIndex.get(r.parentId);
      if (bucket) bucket.push(r);
      else childrenIndex.set(r.parentId, [r]);
    }
  }

  // Recompute every row's caret count from the rows actually present.
  for (const r of rows) {
    r.childrenCount = childrenIndex.get(r.id)?.length ?? 0;
  }

  const roots = rows.filter((r) => !r.parentId || !present.has(r.parentId));
  return { roots, childrenIndex };
}

// Last fetched page, keyed by the human row id (`${prefix}-${key_num}`).
// The grid renders rows by that human id, but ArtefactInlineForm fetches
// by UUID — so fetchDetail looks the clicked row up here to recover its
// `id` (UUID) and hands that to the form. Mirrors how the real OTV2 page
// holds windowRoots in state.
let lastWireById: Record<string, WireWorkItem> = {};

// parent human id → its in-page children, rebuilt by nestWindow on every
// fetchRows. fetchChildren resolves from here so expanding a row reveals the
// descendants already in the page instead of issuing a second request that
// would re-introduce them as duplicates.
let lastChildrenIndex: Map<string, WorkItemRow[]> = new Map();

async function fetchRows(params: FetchParams): Promise<FetchResult<WorkItemRow>> {
  const offset = (params.page - 1) * params.pageSize;
  let path = `/work-items?limit=${params.pageSize}&offset=${offset}`;
  if (params.sort) {
    const key = SORT_KEY_BY_COLUMN[params.sort.columnId];
    if (key) path += `&sort=${key}&dir=${params.sort.dir}`;
  }

  const res = await apiSite<{ items: WireWorkItem[]; total: number }>(path);

  // Cache the full wire rows by human id BEFORE client-side search so the
  // flyout can always resolve the row the user clicked.
  lastWireById = Object.fromEntries(
    res.items.map((w) => [`${w.type_prefix}-${w.key_num}`, w]),
  );

  const all = res.items.map(mapWireRow);

  // Client-side search over the fetched page (see PoC limitations above).
  // While searching, hierarchy is set aside: every matching row is shown
  // flat (a deep match shouldn't be hidden just because its parent didn't
  // match). nestWindow only runs on the unfiltered tree view.
  const q = params.search.trim().toLowerCase();
  if (q) {
    lastChildrenIndex = new Map();
    const rows = all.filter(
      (r) => r.id.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q),
    );
    return { rows, total: res.total ?? res.items.length };
  }

  // Windowed-tree nesting: return only the canopy roots; descendants are
  // revealed via fetchChildren from the index nestWindow builds.
  //
  // CROSS-PAGE NOTE: nesting is reconstructed from the CURRENT page only. A
  // parent on this page whose child sits on the next page would show a
  // smaller in-page caret count than the server's true total. The scoped
  // set on /scope currently fits inside one page (≈58 rows < pageSize), so
  // every parent and its descendants land together. If a scope ever exceeds
  // one page this needs a server-side nested/whole-subtree mode (option B)
  // rather than silently under-nesting — flagged, not papered over.
  const { roots, childrenIndex } = nestWindow(all);
  lastChildrenIndex = childrenIndex;
  return { rows: roots, total: roots.length };
}

// Child loader — resolves from the in-page index nestWindow built, NOT the
// network. Under the scope clamp the descendants are already in the fetched
// page (the LIST returns the whole in-scope subtree flat); re-fetching
// /{uuid}/children would re-introduce the same rows the grid already holds,
// duplicating them under their parent. Returning the indexed children keeps
// the tree consistent with the flat payload and makes expand instant.
//
// The rows are already in lastWireById (cached in fetchRows over the full
// page), so a child's flyout still resolves its UUID. Returns [] for a row
// with no in-page children — the caret only renders when childrenCount > 0,
// so this path is reached only when there genuinely are children to show.
async function fetchChildren(parent: WorkItemRow): Promise<WorkItemRow[]> {
  return lastChildrenIndex.get(parent.id) ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// Flyout — the REAL <ArtefactInlineForm> over LIVE data
//
// We mount the production work-items inline form (the same component the
// OTV2 surface uses) directly in the DataGrid row flyout. It is a fully
// prop-driven, self-fetching surface: given the artefact UUID + resource
// prefix it fetches its own detail, renders the real two-column layout,
// the ArtefactNodeDiagram hierarchy, the ColourPicker, the RichText
// description, per-type custom fields, and the live-catalogue selects
// (topology shown by NAME with ★ current-scope marker, owner/flow-state/
// sprint/release/milestone from /lookups + /topology), and auto-saves
// each field on blur via PATCH /work-items/{uuid}.
//
// fetchDetail's only job is to resolve the clicked row's UUID off the
// cached page — the form does the real read itself. This is DRY: zero
// form markup is duplicated here; the work-items surface and this grid
// render the exact same component.
// ────────────────────────────────────────────────────────────────────────────

interface FlyoutDetail {
  uuid: string;
}

async function fetchDetail(rowId: string): Promise<FlyoutDetail> {
  const wire = lastWireById[rowId];
  if (!wire) throw new Error(`Row ${rowId} not in the current page`);
  return { uuid: wire.id };
}

// ────────────────────────────────────────────────────────────────────────────
// Exported config — what the page hands to <DataGrid>
// ────────────────────────────────────────────────────────────────────────────

export const workItemsDataGridConfig: DataGridConfig<WorkItemRow> = {
  id: "work-items",

  title:               "Work items",
  titleDescription:    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do.",
  subTitle:            "Dense grid",
  subTitleDescription: "Spreadsheet-fast. 28px rows, single-character status, mono ID column.",
  identBlockText:      "05",
  searchPlaceholder:   "Search work items…",

  columns,
  rowIdOf: (r) => r.id,
  fetchRows,

  // Tree mode — windowed-tree nesting (see nestWindow). Under the production
  // ?meg= clamp the LIST returns the whole in-scope subtree FLAT, so we nest
  // client-side: fetchRows returns the canopy roots, fetchChildren resolves
  // descendants from the in-page index, and childrenCount is the in-page
  // count so the caret never over-promises. expandAllControl puts a master
  // caret in the header to open/close the entire hierarchy at once; rows
  // start collapsed and expand individually otherwise.
  tree: {
    getChildrenCount: (r) => r.childrenCount,
    fetchChildren,
    getColour: (r) => r.colour,
    expandAllControl: true,
  },

  // Leading multi-select checkbox column (OTV2 parity). The scaffold owns
  // the selected-id set; we only flip it on. No bulk-action bar yet, so we
  // don't observe the set — when one lands, add onSelectionChange here.
  selection: { enabled: true },

  // Leading cog column (OTV2 parity). Same three affordances OTV2's row cog
  // carries: Open routes to the inline form (view mode); Duplicate/Delete
  // open the form in their respective modes (the form owns the confirm +
  // the mutation). All three drive the SAME flyout the row-click opens.
  cogMenu: [
    {
      id: "open",
      label: "Open",
      icon: <TbEye aria-hidden />,
      onClick: (_row, ctx) => ctx.openFlyout("view"),
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: <TbCopy aria-hidden />,
      onClick: (_row, ctx) => ctx.openFlyout("duplicate"),
    },
    {
      id: "delete",
      label: "Delete",
      icon: <TbTrash aria-hidden />,
      onClick: (_row, ctx) => ctx.openFlyout("delete"),
    },
  ],

  // Drag-to-reorder (OTV2 parity). resourceType "work_item" matches the
  // backend rank registry; on drop the scaffold POSTs /samantha/v2/rank/move
  // via useResourceRank. getDescendants returns [] for now — the reorder
  // itself works (children follow their parent server-side); the only thing
  // [] costs is the cosmetic whole-subtree drag highlight, which needs the
  // scaffold's live flat list (not available to this module-constant config).
  // TD: surface a descendant resolver from the scaffold if the subtree-paint
  // is wanted. Reparent (canReparent/onReparent) deliberately unset — sibling
  // reorder only, matching the PoC scope.
  dnd: {
    resourceType: "work_item",
    getDescendants: () => [],
  },

  pageSizeOptions: [10, 25, 50, 100],
  defaultPageSize: 25,
  defaultSort:     null,

  rowFlyout: {
    fetchDetail,
    // Mount the real ArtefactInlineForm body. It owns its own action bar,
    // fetch, auto-save, and the full wired field set — so renderBody just
    // hands it the UUID + resource prefix and a close handler. We ignore
    // `mode` (the form is always the editable surface).
    renderBody: ({ data, ctx }) => {
      const { uuid } = data as FlyoutDetail;
      return (
        <ArtefactInlineForm
          artefactId={uuid}
          resourceUrl="/work-items"
          scope="work"
          onClose={ctx.close}
        />
      );
    },
    renderLoading: () => <p>Loading work item…</p>,
    renderError:   (e)  => <p>Failed to load: {String(e)}</p>,
  },

  createAction: {
    label: "Create New",
    onClick: (_ctx) => { /* would open the create wizard */ },
  },

  filters: [
    { id: "type",     label: "Type",     icon: <TbAdjustmentsHorizontal aria-hidden />, onClick: () => {} },
    { id: "status",   label: "Status",   icon: <TbCircleCheck           aria-hidden />, onClick: () => {} },
    { id: "priority", label: "Priority", icon: <TbFlag                  aria-hidden />, onClick: () => {} },
    { id: "owner",    label: "Owner",    icon: <TbUser                  aria-hidden />, onClick: () => {} },
  ],
};

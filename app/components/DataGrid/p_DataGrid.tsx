"use client";

// <DataGrid> — lightweight scaffold that mirrors the visible shell of
// ObjectTree (TitleBar, DataBar, ActionBar, Grid, Pagination). The
// scaffold is pure presentation + plumbing: it consumes a page-owned
// DataGridConfig and wires it to two hooks (column manager + row
// flyout). Everything page-specific lives in the config.

import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  TbCaretDownFilled,
  TbCaretUpFilled,
  TbChevronDown,
  TbChevronRight,
  TbDotsVertical,
  TbHelpHexagon,
  TbPlus,
  TbSearch,
  TbSettings,
} from "react-icons/tb";

import type {
  DataGridConfig,
  FetchResult,
  FlyoutMode,
  RowMenuCtx,
  RowMenuItem,
  RowTreeCtx,
} from "./types";
import { useColumnManager } from "./useColumnManager";
import { useRowFlyout } from "./useRowFlyout";
import { useDataGridTree, type FlatRow } from "./useDataGridTree";
import { useResourceRank } from "@/app/hooks/useResourceRank";

// ─── Leading control-column widths ──────────────────────────────────────────
// Identical to ResourceTree's lead-column constants so the two surfaces line
// up pixel-for-pixel: stripe → selection → drag → cog, each a fixed track
// before the user columns.
const STRIPE_COL_WIDTH    = 10;
const SELECTION_COL_WIDTH = 28;
const DRAG_COL_WIDTH      = 22;
const COG_COL_WIDTH       = 32;

export interface DataGridProps<TRow = unknown> {
  config: DataGridConfig<TRow>;
  className?: string;
}

export default function DataGrid<TRow>({
  config,
  className,
}: DataGridProps<TRow>) {
  const rootClass = className ? `data-grid ${className}` : "data-grid";

  // — Local state ——————————————————————————————————————————————————————————
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    config.defaultPageSize ?? config.pageSizeOptions?.[0] ?? 25,
  );

  // — Leading control columns (OTV2 parity) ————————————————————————————————
  // Order is fixed to match ResourceTree: stripe → selection → drag → cog.
  // Each enabled feature contributes one fixed track; their widths prepend
  // to gridTemplateColumns so the controls occupy real grid columns (not
  // borders/padding). All opt-in — a flat grid enables none and renders
  // exactly as before.
  const hasStripe    = !!config.tree?.getColour;
  const hasSelection = !!config.selection?.enabled;
  const hasDnd       = !!config.dnd;
  const hasCog       = !!config.cogMenu && config.cogMenu.length > 0;
  const hasExpandAll = !!config.tree?.expandAllControl;
  const leadWidths: number[] = [
    ...(hasStripe    ? [STRIPE_COL_WIDTH]    : []),
    ...(hasSelection ? [SELECTION_COL_WIDTH] : []),
    ...(hasDnd       ? [DRAG_COL_WIDTH]      : []),
    ...(hasCog       ? [COG_COL_WIDTH]       : []),
  ];

  const columnMgr = useColumnManager({
    columns:     config.columns,
    defaultSort: config.defaultSort ?? null,
    leadWidths,
  });

  const rowFlyout = useRowFlyout();

  // — Data fetch ——————————————————————————————————————————————————————————
  const [result, setResult] = useState<FetchResult<TRow>>({ rows: [], total: 0 });

  const refresh = useCallback(() => {
    let cancelled = false;
    config
      .fetchRows({ page, pageSize, sort: columnMgr.sort, search })
      .then((r) => { if (!cancelled) setResult(r); })
      .catch(() => { if (!cancelled) setResult({ rows: [], total: 0 }); });
    return () => { cancelled = true; };
  }, [config, page, pageSize, columnMgr.sort, search]);

  useEffect(() => { return refresh(); }, [refresh]);

  // — Derived ——————————————————————————————————————————————————————————————
  const { rows, total } = result;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd   = Math.min(page * pageSize, total);

  const pageSizes = config.pageSizeOptions ?? [10, 25, 50, 100];

  // — Tree mode ————————————————————————————————————————————————————————————
  // Active only when config.tree is set. In flat mode the hook still runs
  // (rules-of-hooks) but flatRows just mirrors rows with empty geometry and
  // the body loop ignores treeCtx — zero behaviour change.
  const treeMode = !!config.tree;
  const tree = useDataGridTree<TRow>(rows, config.tree, config.rowIdOf);

  // The render list — tree mode uses the flattened roots+descendants; flat
  // mode wraps each row in inert geometry. Computed once here so both the
  // body loop AND the drag-rank descendant resolver read the same list.
  const flatList: FlatRow<TRow>[] = treeMode
    ? tree.flatRows
    : rows.map<FlatRow<TRow>>((row) => ({
        row,
        id: config.rowIdOf(row),
        treeCtx: FLAT_TREE_CTX,
      }));

  // Keep the live flat list in a ref so useResourceRank's getDescendants can
  // resolve a row id → row without re-binding the hook on every keystroke.
  const flatListRef = useRef<FlatRow<TRow>[]>(flatList);
  flatListRef.current = flatList;

  const visibleRowIds = useMemo(() => flatList.map((f) => f.id), [flatList]);

  // Shared drag-rank wiring (opt-in). Always constructed (rules-of-hooks)
  // but inert unless config.dnd is set — the handle column only renders when
  // hasDnd, and only then are handleProps(id) spread onto a grip.
  const rank = useResourceRank({
    resourceType: config.dnd?.resourceType ?? "row",
    getDescendants: (id) => {
      if (!config.dnd?.getDescendants) return [];
      const fr = flatListRef.current.find((f) => f.id === id);
      return fr ? config.dnd.getDescendants(fr.row) : [];
    },
  });

  // — Selection (scaffold-owned) ———————————————————————————————————————————
  // The leading checkbox column's state lives here, not in the page config —
  // selection is grid-display state (same rationale as expansion living in
  // useDataGridTree). A page opts in with config.selection.enabled and may
  // observe the set via onSelectionChange. Range-select (shift-click) walks
  // the current visibleRowIds order between the last-toggled anchor and the
  // clicked row. Inert (set stays empty) when !hasSelection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastToggledRef = useRef<string | null>(null);
  const onSelectionChange = config.selection?.onSelectionChange;

  const emitSelection = useCallback(
    (next: Set<string>) => {
      onSelectionChange?.(next);
      return next;
    },
    [onSelectionChange],
  );

  const toggleRow = useCallback(
    (rowId: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const anchor = lastToggledRef.current;
        if (shiftKey && anchor && anchor !== rowId) {
          // Range-select: select every row between anchor and rowId in the
          // current visible order (inclusive). Mirrors OTV2/spreadsheet
          // shift-click. Falls back to single toggle if either id has since
          // scrolled out of the visible window.
          const ids = visibleRowIds;
          const a = ids.indexOf(anchor);
          const b = ids.indexOf(rowId);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            return emitSelection(next);
          }
        }
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        lastToggledRef.current = rowId;
        return emitSelection(next);
      });
    },
    [visibleRowIds, emitSelection],
  );

  const toggleAll = useCallback(
    (ids: string[]) => {
      setSelectedIds((prev) => {
        const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
        const next = allOn
          ? new Set([...prev].filter((id) => !ids.includes(id))) // clear visible
          : new Set([...prev, ...ids]); // select all visible
        return emitSelection(next);
      });
    },
    [emitSelection],
  );

  // When the roots refetch (sort / search / page / scope change) drop all
  // expansion + child caches so stale children don't survive under new roots.
  useEffect(() => {
    if (treeMode) tree.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, columnMgr.sort, search, treeMode]);

  // — Row flyout body fetch ————————————————————————————————————————————————
  // One fetch per rowId; cached across mode changes (see types.ts contract).
  const [detailCache, setDetailCache] = useState<Record<string, unknown>>({});
  const [detailErr, setDetailErr] = useState<Record<string, unknown>>({});
  const openRowId = rowFlyout.open?.rowId ?? null;
  useEffect(() => {
    if (!openRowId || !config.rowFlyout) return;
    if (openRowId in detailCache || openRowId in detailErr) return;
    let cancelled = false;
    config.rowFlyout
      .fetchDetail(openRowId)
      .then((d) => { if (!cancelled) setDetailCache((c) => ({ ...c, [openRowId]: d })); })
      .catch((e) => { if (!cancelled) setDetailErr((c) => ({ ...c, [openRowId]: e })); });
    return () => { cancelled = true; };
  }, [openRowId, config.rowFlyout, detailCache, detailErr]);

  // — Row menu context factory ————————————————————————————————————————————
  const makeRowMenuCtx = useCallback(
    (rowId: string): RowMenuCtx => ({
      openFlyout:  (mode: FlyoutMode) => rowFlyout.openFor(rowId, mode),
      closeFlyout: () => { if (rowFlyout.isOpenFor(rowId)) rowFlyout.close(); },
    }),
    [rowFlyout],
  );

  const gridTemplate = columnMgr.gridTemplateColumns;

  // — Render ———————————————————————————————————————————————————————————————
  return (
    <section className={rootClass}>
      <header className="data-grid__TitleBar">
        <div className="data-grid__TitleBar_Heading">
          <h1 className="data-grid__TitleBar_Heading_Title">{config.title}</h1>
          {config.titleDescription && (
            <p className="data-grid__TitleBar_Heading_Description">{config.titleDescription}</p>
          )}
        </div>
        <button
          type="button"
          className="data-grid__TitleBar_HelperBtn"
          aria-label={`Help for ${config.title}`}
        >
          <TbHelpHexagon aria-hidden="true" />
        </button>
      </header>

      <div className="data-grid__DataBar">
        <span className="data-grid__DataBar_Ident">{config.identBlockText}</span>
        <div className="data-grid__DataBar_Heading">
          <h1 className="data-grid__DataBar_Heading_Title">{config.subTitle}</h1>
          {config.subTitleDescription && (
            <p className="data-grid__DataBar_Heading_Description">{config.subTitleDescription}</p>
          )}
        </div>
      </div>

      <div className="data-grid__ActionBar">
        {config.createAction && (
          <button
            type="button"
            className="data-grid__ActionBar_CreateBtn"
            onClick={() => config.createAction!.onClick({ refresh: () => refresh() })}
          >
            <TbPlus aria-hidden="true" />
            <span>{config.createAction.label}</span>
          </button>
        )}

        <div className="data-grid__ActionBar_Search">
          <TbSearch aria-hidden="true" className="data-grid__ActionBar_Search_Icon" />
          <input
            type="search"
            className="data-grid__ActionBar_Search_Input"
            placeholder={config.searchPlaceholder ?? "Search…"}
            aria-label={config.searchPlaceholder ?? "Search"}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {config.filters && config.filters.length > 0 && (
          <div className="data-grid__ActionBar_Filters">
            {config.filters.map((f) => (
              <button
                key={f.id}
                type="button"
                className="data-grid__ActionBar_Filters_Btn"
                onClick={f.onClick}
              >
                {f.icon}
                <span>{f.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="data-grid__ActionBar_Filters_Clear"
              onClick={() => setSearch("")}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="data-grid__Grid" role="table" aria-label={config.subTitle} ref={columnMgr.containerRef}>
        <div
          className="data-grid__Grid_HeaderRow"
          role="row"
          style={{ gridTemplateColumns: gridTemplate }}
          ref={columnMgr.headerRowRef}
        >
          {/* Leading control headers — empty stripe slot, select-all checkbox,
              empty drag + cog slots. Order matches the body lead cells exactly
              (stripe → selection → drag → cog) so every track lines up. */}
          {hasStripe && (
            <div className="data-grid__Grid_HeaderRow_StripeCell" role="columnheader" aria-hidden />
          )}
          {hasSelection && (
            <div className="data-grid__Grid_HeaderRow_LeadCell" role="columnheader">
              <input
                type="checkbox"
                aria-label="Select all rows"
                checked={
                  visibleRowIds.length > 0 &&
                  visibleRowIds.every((id) => selectedIds.has(id))
                }
                onChange={() => toggleAll(visibleRowIds)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {hasDnd && (
            <div className="data-grid__Grid_HeaderRow_LeadCell" role="columnheader" aria-hidden />
          )}
          {hasCog && (
            <div
              className="data-grid__Grid_HeaderRow_LeadCell"
              role="columnheader"
              aria-hidden={!(hasExpandAll && treeMode)}
            >
              {hasExpandAll && treeMode && (
                <button
                  type="button"
                  className="data-grid__Grid_HeaderRow_ExpandAll"
                  aria-label={tree.allExpanded ? "Collapse all rows" : "Expand all rows"}
                  aria-expanded={tree.allExpanded}
                  title={tree.allExpanded ? "Collapse all" : "Expand all"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tree.allExpanded) tree.collapseAll();
                    else tree.expandAll();
                  }}
                >
                  {tree.allExpanded
                    ? <TbChevronDown  aria-hidden />
                    : <TbChevronRight aria-hidden />}
                </button>
              )}
            </div>
          )}
          {config.columns.map((col) => {
            const hp = columnMgr.getHeaderProps(col);
            return (
              <div
                key={col.id}
                className="data-grid__Grid_HeaderRow_Cell"
                role="columnheader"
                data-sort={hp["data-sort"]}
                data-sortable={hp["data-sortable"] || undefined}
                data-resizable={hp["data-resizable"] || undefined}
                onClick={hp.onClick}
              >
                <span className="data-grid__Grid_HeaderRow_Cell_Label">
                  {col.renderHeader ? col.renderHeader() : col.label}
                </span>
                {col.sortable && hp["data-sort"] === "asc"  && (
                  <TbCaretUpFilled   aria-hidden className="data-grid__Grid_HeaderRow_Cell_SortCaret" />
                )}
                {col.sortable && hp["data-sort"] === "desc" && (
                  <TbCaretDownFilled aria-hidden className="data-grid__Grid_HeaderRow_Cell_SortCaret" />
                )}
                {hp["data-resizable"] && (
                  <span
                    className="data-grid__Grid_HeaderRow_Cell_ResizeHandle"
                    onMouseDown={hp.onResizeMouseDown}
                    onDoubleClick={hp.onDoubleClick}
                    onClick={(e) => e.stopPropagation()}
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="data-grid__Grid_Body" role="rowgroup">
          {flatList.map(({ row, id: rowId, treeCtx }) => {
            const rp = rowFlyout.getRowProps(rowId);
            const isOpen = rowFlyout.isOpenFor(rowId);

            // — Structural + state classes (tree mode only) —
            // Mirrors ResourceTree: depth 0 = --epic, deeper = --child,
            // selected/open carry their own markers. Plus the page's own
            // rowClassName (e.g. the form-open barber-pole marker).
            const stripe = treeMode ? config.tree!.getColour?.(row) ?? null : null;
            const isSelected = hasSelection && selectedIds.has(rowId);
            const extraClass = config.rowClassName?.(row);

            // Drag-rank props (drop-target handlers + the dnd state class:
            // drag-row--dragging / --drop-above / --drop-below / --drop-
            // candidate). Destructured so its className MERGES with the
            // structural row class instead of clobbering it, and the
            // data-attr + handlers spread cleanly. Inert when !hasDnd.
            const rankRow = hasDnd
              ? rank.rowProps(rowId)
              : ({ className: "" } as ReturnType<typeof rank.rowProps>);
            const { className: rankClass, ...rankHandlers } = rankRow;

            // The open-flyout row gets the barber-pole (--form-open); a
            // checkbox-selected row that is NOT open gets the accent wash
            // (--selected). The two are mutually exclusive on a given row so
            // the open form always reads as the barber-pole, never a flat
            // wash. Mirrors OTV2 exactly.
            const showFormOpen = isOpen && !!config.rowFlyout;
            const rowClass = [
              "data-grid__Grid_Body_Row",
              isOpen && "data-grid__Grid_Body_Row-open",
              treeMode &&
                (treeCtx.depth === 0
                  ? "data-grid__Grid_Body_Row--epic"
                  : "data-grid__Grid_Body_Row--child"),
              showFormOpen && "data-grid__Grid_Body_Row--form-open",
              isSelected && !showFormOpen && "data-grid__Grid_Body_Row--selected",
              rankClass,
              extraClass,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <Fragment key={rowId}>
                <div
                  ref={(el) => columnMgr.registerBodyRow(rowId, el)}
                  className={rowClass}
                  role="row"
                  style={{ gridTemplateColumns: gridTemplate }}
                  data-open={rp["data-open"] || undefined}
                  aria-expanded={rp["aria-expanded"]}
                  onClick={rp.onClick}
                  {...rankHandlers}
                >
                  {/* — Leading control cells (OTV2 parity order):
                      stripe block → selection checkbox → drag grip → cog.
                      Each guarded; a flat grid renders none and the row is
                      exactly the old user-columns-only layout. */}
                  {hasStripe && (
                    <div
                      className="data-grid__Grid_Body_Row_StripeCell"
                      style={{ backgroundColor: stripe ?? undefined }}
                      role="cell"
                      aria-hidden
                    />
                  )}
                  {hasSelection && (
                    <div className="data-grid__Grid_Body_Row_LeadCell" role="cell">
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={isSelected}
                        onChange={(e) =>
                          toggleRow(rowId, (e.nativeEvent as MouseEvent).shiftKey)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  {hasDnd && (
                    <div className="data-grid__Grid_Body_Row_LeadCell" role="cell">
                      <span
                        className="data-grid__Grid_Body_Row_DragHandle"
                        aria-label="Drag to reorder"
                        {...rank.handleProps(rowId)}
                      >
                        ⠿
                      </span>
                    </div>
                  )}
                  {hasCog && (
                    <div className="data-grid__Grid_Body_Row_LeadCell" role="cell">
                      <CogMenuCell
                        row={row}
                        items={config.cogMenu!}
                        ctx={makeRowMenuCtx(rowId)}
                      />
                    </div>
                  )}
                  {config.columns.map((col) => (
                    <div
                      key={col.id}
                      className="data-grid__Grid_Body_Row_Cell"
                      role="cell"
                    >
                      {col.renderCell
                        ? col.renderCell(row, treeMode ? treeCtx : undefined)
                        : null}
                    </div>
                  ))}
                  {!hasCog && config.rowMenu && config.rowMenu.length > 0 && (
                    <RowMenuTrigger
                      row={row}
                      items={config.rowMenu}
                      ctx={makeRowMenuCtx(rowId)}
                    />
                  )}
                </div>
                {treeMode && tree.loadingIds.has(rowId) && (
                  <div
                    className="data-grid__Grid_Body_ChildLoading"
                    role="row"
                    aria-live="polite"
                    style={
                      {
                        "--data-grid-loading-indent": `${12 + (treeCtx.depth + 1) * 20 + 32}px`,
                      } as CSSProperties
                    }
                  >
                    Loading…
                  </div>
                )}
                {isOpen && config.rowFlyout && (
                  <div className="data-grid__Grid_Body_Flyout" role="region" aria-label="Row detail">
                    <div className="data-grid__Grid_Body_Flyout_Inner">
                      {renderFlyoutBody({
                        config,
                        rowId,
                        mode: rowFlyout.open!.mode,
                        data: detailCache[rowId],
                        error: detailErr[rowId],
                        ctx:  {
                          close:      rowFlyout.close,
                          switchMode: rowFlyout.switchMode,
                        },
                      })}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      <footer className="data-grid__Pagination">
        <span className="data-grid__Pagination_Range">
          {rangeStart}–{rangeEnd} of {total}
        </span>
        <div className="data-grid__Pagination_PageSizes">
          {pageSizes.map((n) => (
            <button
              key={n}
              type="button"
              className={
                n === pageSize
                  ? "data-grid__Pagination_PageSizes_Btn data-grid__Pagination_PageSizes_Btn-active"
                  : "data-grid__Pagination_PageSizes_Btn"
              }
              onClick={() => { setPageSize(n); setPage(1); }}
            >
              {n}
            </button>
          ))}
        </div>
      </footer>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Stable empty geometry for flat-mode rows. renderCell ignores its second
// arg in flat mode, so this is never read — it just satisfies the shared
// FlatRow shape without allocating a fresh object per row per render.
const FLAT_TREE_CTX: RowTreeCtx = {
  depth: 0,
  expanded: false,
  hasChildren: false,
  isLast: true,
  hasVisibleChildren: false,
  continuations: [],
  toggle: () => {},
};

function renderFlyoutBody<TRow>({
  config,
  rowId,
  mode,
  data,
  error,
  ctx,
}: {
  config: DataGridConfig<TRow>;
  rowId:  string;
  mode:   FlyoutMode;
  data:   unknown;
  error:  unknown;
  ctx:    { close: () => void; switchMode: (m: FlyoutMode) => void };
}): React.ReactNode {
  const rf = config.rowFlyout!;
  if (error !== undefined) {
    return rf.renderError ? rf.renderError(error, rowId) : <p>Failed to load.</p>;
  }
  if (data === undefined) {
    return rf.renderLoading ? rf.renderLoading(rowId) : <p>Loading…</p>;
  }
  return rf.renderBody({ data, mode, rowId, ctx });
}

function RowMenuTrigger<TRow>({
  row,
  items,
  ctx,
}: {
  row:   TRow;
  items: RowMenuItem<TRow>[];
  ctx:   RowMenuCtx;
}) {
  const [open, setOpen] = useState(false);
  const visible = items.filter((i) => (i.visible ? i.visible(row) : true));
  return (
    <div
      className="data-grid__Grid_Body_Row_Menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="data-grid__Grid_Body_Row_Menu_Trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
      >
        <TbDotsVertical aria-hidden />
      </button>
      {open && (
        <ul className="data-grid__Grid_Body_Row_Menu_List" role="menu">
          {visible.map((it) => (
            <li key={it.id} role="none">
              <button
                role="menuitem"
                type="button"
                className="data-grid__Grid_Body_Row_Menu_List_Item"
                onClick={() => { setOpen(false); it.onClick(row, ctx); }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── CogMenuCell ──────────────────────────────────────────────────────────────
// Leading gear column (OTV2 parity). Same item contract as RowMenuTrigger but
// rendered as the cog affordance OTV2 uses, with click-outside + Escape
// dismissal (the overflow menu lacks both; the cog is a more prominent control
// so it needs to close on blur). Lives in its own 32px lead track.
function CogMenuCell<TRow>({
  row,
  items,
  ctx,
}: {
  row:   TRow;
  items: RowMenuItem<TRow>[];
  ctx:   RowMenuCtx;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => (i.visible ? i.visible(row) : true));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="data-grid__Grid_Body_Row_Cog"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="data-grid__Grid_Body_Row_CogBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={() => setOpen((v) => !v)}
      >
        <TbSettings aria-hidden />
      </button>
      {open && (
        <div className="data-grid__Grid_Body_Row_CogMenu" role="menu">
          {visible.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              type="button"
              className="data-grid__Grid_Body_Row_CogMenu_Item"
              onClick={() => { setOpen(false); it.onClick(row, ctx); }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

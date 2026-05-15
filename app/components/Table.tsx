"use client";

// PLA-0015 — Declarative table primitive.
//
// Every <table> under app/** must come from this component (the four
// tree exceptions in dev/registries/raw-table-allow.txt notwithstanding).
// Catalog CSS lives in tree_accordion-dense__* — this is the only
// consumer. Spec: docs/c_c_table_component.md.

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MdOutlineArrowForwardIos } from "react-icons/md";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { useDraft } from "@/app/hooks/useDraft";

// ---------- Public types ----------

export type CellKind =
  | "text"
  | "mono"
  | "numeric"
  | "center"
  | "pill"
  | "expander"
  | "custom";

export type PillVariant = "success" | "warning" | "danger" | "info" | "neutral";

export interface ColumnEditable<R> {
  type: "text";
  onSave: (row: R, value: string) => void | Promise<void>;
  validate?: (value: string) => string | null;
}

export interface Column<R> {
  key: string;
  header?: ReactNode;
  width?: number | string;
  kind?: CellKind;
  render?: (row: R) => ReactNode;
  editable?: ColumnEditable<R>;
  pillVariant?: (row: R) => PillVariant;
  pillLabel?: (row: R) => ReactNode;
  thClassName?: string;
}

export interface ToolbarSearch {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export interface ToolbarFilter {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}

export interface ToolbarConfig {
  search?: ToolbarSearch;
  filters?: ToolbarFilter[];
  actions?: ReactNode;
  meta?: ReactNode;
}

export interface ExpandableConfig<R> {
  renderPanel: (row: R) => ReactNode;
  canExpand?: (row: R) => boolean;
}

export interface PaginationConfig {
  pageSize: number | "all";
  page: number;
  onPageChange: (n: number) => void;
}

export interface TableProps<R> {
  pageId: string;
  slot: string;
  ariaLabel: string;
  columns: Column<R>[];
  rows: R[] | null;
  rowKey: (r: R) => string;
  expandable?: ExpandableConfig<R>;
  pagination?: PaginationConfig;
  toolbar?: ToolbarConfig;
  empty?: string;
  loading?: boolean;
  rowClassName?: (r: R) => string | undefined;
  cellClassName?: (r: R, c: Column<R>) => string | undefined;
  onRowClick?: (r: R) => void;
  className?: string;
  // When true, the table grows to the natural height of its rows
  // (no max-height, no internal vertical scroll). Use for short
  // catalogue-style grids that should never paginate.
  noScroll?: boolean;
}

// ---------- Internal helpers ----------

function joinClass(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function cellKindClass(kind: CellKind | undefined): string {
  switch (kind) {
    case "mono":
      return "tree_accordion-dense__cell tree_accordion-dense__cell--mono";
    case "numeric":
      return "tree_accordion-dense__cell tree_accordion-dense__cell--numeric";
    case "center":
    case "pill":
      return "tree_accordion-dense__cell tree_accordion-dense__cell--center";
    case "expander":
    case "text":
    case "custom":
    case undefined:
    default:
      return "tree_accordion-dense__cell";
  }
}

function thKindClass(kind: CellKind | undefined): string {
  if (kind === "center" || kind === "pill" || kind === "expander") {
    return "tree_accordion-dense__th tree_accordion-dense__th--center";
  }
  if (kind === "numeric") {
    return "tree_accordion-dense__th tree_accordion-dense__th--numeric";
  }
  return "tree_accordion-dense__th";
}

function defaultRowValue<R>(row: R, key: string): string {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

// ---------- ExpanderButton ----------

function ExpanderButton({
  open,
  leaf,
  onToggle,
  ariaLabel,
}: {
  open: boolean;
  leaf?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  if (leaf) {
    return (
      <span
        className="tree_accordion-dense__expander tree_accordion-dense__expander--leaf"
        aria-hidden="true"
      />
    );
  }
  return (
    <button
      type="button"
      className={joinClass(
        "tree_accordion-dense__expander",
        open && "tree_accordion-dense__expander--open",
      )}
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-expanded={open}
    >
      <MdOutlineArrowForwardIos
        className="tree_accordion-dense__expander-icon"
        size={10}
      />
    </button>
  );
}

// ---------- EditableCell ----------

interface EditableCellProps<R> {
  row: R;
  rowKeyValue: string;
  column: Column<R>;
  formKey: string;
  initial: string;
}

function EditableCell<R>({
  row,
  rowKeyValue,
  column,
  formKey,
  initial,
}: EditableCellProps<R>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep `value` in sync when the underlying row mutates while not editing.
  useEffect(() => {
    if (!editing) setValue(initial);
  }, [initial, editing]);

  const scopeKey = `${rowKeyValue}:${column.key}`;

  const { save: saveDraft, clear: clearDraft } = useDraft<{ v: string }>(
    { formKey, scopeKey, initial: { v: initial } },
    (vals) => setValue(vals.v),
  );

  const beginEdit = useCallback(() => {
    setEditing(true);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const cancel = useCallback(() => {
    setValue(initial);
    setError(null);
    setEditing(false);
    void clearDraft();
  }, [initial, clearDraft]);

  const commit = useCallback(async () => {
    if (!column.editable) return;
    const validated = column.editable.validate?.(value) ?? null;
    if (validated) {
      setError(validated);
      return;
    }
    setSaving(true);
    try {
      await column.editable.onSave(row, value);
      await clearDraft();
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [column.editable, row, value, clearDraft]);

  if (!editing) {
    return (
      <button
        type="button"
        className="tree_accordion-dense__inline-edit-trigger"
        onClick={beginEdit}
        aria-label={`Edit ${column.key}`}
      >
        {value || <span className="tree_accordion-dense__cell--placeholder">—</span>}
      </button>
    );
  }

  return (
    <div className="u-stack--gap-1">
      <input
        ref={inputRef}
        type="text"
        className={joinClass("form__input", "form__input--sm", error && "has-error")}
        value={value}
        disabled={saving}
        onChange={(e) => {
          setValue(e.target.value);
          saveDraft({ v: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (!saving) void commit();
        }}
      />
      {error ? <div className="form__error">{error}</div> : null}
    </div>
  );
}

// ---------- Toolbar ----------

function Toolbar({ config }: { config: ToolbarConfig }) {
  const { search, filters, actions, meta } = config;
  if (!search && !filters?.length && !actions && !meta) return null;
  return (
    <div className="toolbar">
      {search ? (
        <input
          type="search"
          className="form__input form__input--sm"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? "Search…"}
          aria-label={search.placeholder ?? "Search"}
        />
      ) : null}
      {filters?.map((f) => (
        <label key={f.key} className="u-row u-row--gap-2">
          <span>{f.label}</span>
          <select
            className="form__select form__select--sm"
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {meta ? <div className="toolbar__meta">{meta}</div> : null}
      {actions ? <div className="toolbar__actions">{actions}</div> : null}
    </div>
  );
}

// ---------- Pagination ----------

function Pagination({
  config,
  total,
}: {
  config: PaginationConfig;
  total: number;
}) {
  const { pageSize, page, onPageChange } = config;
  const size = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);

  return (
    <div className="tree_accordion-dense__pagination tree_accordion-dense__pagination--bottom">
      <div className="tree_accordion-dense__pagination-info">
        {total === 0 ? "0 rows" : `${from}–${to} of ${total}`}
      </div>
      <div className="tree_accordion-dense__pagination-pager">
        <button
          type="button"
          className="tree_accordion-dense__pagination-btn"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page <= 0}
        >
          Prev
        </button>
        <span className="tree_accordion-dense__pagination-info">
          Page {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          className="tree_accordion-dense__pagination-btn"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------- Cell ----------

function Cell<R>({
  row,
  rowKeyValue,
  column,
  formKey,
  isOpen,
  onToggleExpand,
  expandable,
  cellClassName,
}: {
  row: R;
  rowKeyValue: string;
  column: Column<R>;
  formKey: string;
  isOpen: boolean;
  onToggleExpand: () => void;
  expandable?: ExpandableConfig<R>;
  cellClassName?: (r: R, c: Column<R>) => string | undefined;
}) {
  const baseClass = cellKindClass(column.kind);
  const extra = cellClassName?.(row, column);
  const className = joinClass(baseClass, extra);

  if (column.kind === "expander") {
    const leaf = expandable?.canExpand ? !expandable.canExpand(row) : false;
    return (
      <td className={className}>
        <ExpanderButton
          open={isOpen}
          leaf={leaf}
          onToggle={onToggleExpand}
          ariaLabel={isOpen ? "Collapse row" : "Expand row"}
        />
      </td>
    );
  }

  if (column.editable) {
    return (
      <td className={className}>
        <EditableCell
          row={row}
          rowKeyValue={rowKeyValue}
          column={column}
          formKey={formKey}
          initial={defaultRowValue(row, column.key)}
        />
      </td>
    );
  }

  if (column.kind === "pill") {
    const variant: PillVariant = column.pillVariant?.(row) ?? "neutral";
    const label = column.pillLabel?.(row) ?? defaultRowValue(row, column.key);
    return (
      <td className={className}>
        <span className={`pill pill--${variant}`}>{label}</span>
      </td>
    );
  }

  if (column.kind === "custom" || column.render) {
    return <td className={className}>{column.render ? column.render(row) : null}</td>;
  }

  return <td className={className}>{defaultRowValue(row, column.key)}</td>;
}

// ---------- Table ----------

export default function Table<R>(props: TableProps<R>) {
  const {
    pageId,
    slot,
    ariaLabel,
    columns,
    rows,
    rowKey,
    expandable,
    pagination,
    toolbar,
    empty = "No rows.",
    loading = false,
    rowClassName,
    cellClassName,
    onRowClick,
    className,
    noScroll = false,
  } = props;

  // PLA-0005 — keep the addressable substrate working. The old Table
  // exposed `name` directly; the declarative form derives a stable name
  // from pageId + slot so server-side addressables continue to resolve.
  // Substrate's NAME_RE rejects hyphens (DomRegistryContext.tsx:267) — we
  // normalise here so callers can pass natural kebab-case identifiers
  // (e.g. pageId="workspace-settings", slot="flows__<uuid>") without
  // tripping buildAddress. Matches the documented substrate behaviour
  // ("normalises legacy hyphenated names to underscores"). Lowercased
  // for the same reason: NAME_RE is `[a-z0-9_]`.
  const addressableName = `${pageId}__${slot}`.toLowerCase().replace(/-/g, "_");
  const { address, addressable_id, Provider } = useRegisterAddressable({
    kind: "table",
    name: addressableName,
  });

  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());

  // If the caller passes an `expander` column but no expandable config,
  // we still allow row toggling via that column. Expandable panel render
  // needs the explicit expandable.renderPanel.
  const hasExpanderColumn = columns.some((c) => c.kind === "expander");

  const formKey = `table:${pageId}:${slot}`;

  const totalRows = rows?.length ?? 0;

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (!pagination || pagination.pageSize === "all") return rows;
    const start = pagination.page * pagination.pageSize;
    return rows.slice(start, start + pagination.pageSize);
  }, [rows, pagination]);

  const colSpan = columns.length;

  const toggle = useCallback((key: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <Provider>
      <div
        className={joinClass("ui-table", className)}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
      >
        {toolbar ? <Toolbar config={toolbar} /> : null}
        <div className={joinClass("tree_accordion-dense__scroll", noScroll && "tree_accordion-dense__scroll-noscroll")}>
          <table className="tree_accordion-dense__table" aria-label={ariaLabel}>
            {columns.some((c) => c.width !== undefined) ? (
              <colgroup>
                {columns.map((c) => (
                  <col
                    key={c.key}
                    style={
                      c.width !== undefined
                        ? { width: typeof c.width === "number" ? `${c.width}px` : c.width }
                        : undefined
                    }
                  />
                ))}
              </colgroup>
            ) : null}
            <thead className="tree_accordion-dense__head">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={joinClass(thKindClass(c.kind), c.thClassName)}
                  >
                    {c.kind === "expander" ? "" : c.header ?? null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="tree_accordion-dense__row">
                  <td className="tree_accordion-dense__cell" colSpan={colSpan}>
                    Loading…
                  </td>
                </tr>
              ) : totalRows === 0 ? (
                <tr className="tree_accordion-dense__row">
                  <td className="tree_accordion-dense__cell" colSpan={colSpan}>
                    {empty}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const rk = rowKey(row);
                  const isOpen = openRows.has(rk);
                  const rowExtra = rowClassName?.(row);
                  const baseRowClass = joinClass(
                    "tree_accordion-dense__row",
                    isOpen && "tree_accordion-dense__row--open",
                    rowExtra,
                  );
                  const handleRowClick = onRowClick
                    ? () => onRowClick(row)
                    : hasExpanderColumn && expandable
                    ? () => toggle(rk)
                    : undefined;
                  return (
                    <RowFragment
                      key={rk}
                      row={row}
                      rowKeyValue={rk}
                      isOpen={isOpen}
                      rowClass={baseRowClass}
                      onRowClick={handleRowClick}
                      columns={columns}
                      formKey={formKey}
                      onToggleExpand={() => toggle(rk)}
                      expandable={expandable}
                      cellClassName={cellClassName}
                      colSpan={colSpan}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {pagination ? <Pagination config={pagination} total={totalRows} /> : null}
      </div>
    </Provider>
  );
}

// ---------- RowFragment ----------

function RowFragment<R>({
  row,
  rowKeyValue,
  isOpen,
  rowClass,
  onRowClick,
  columns,
  formKey,
  onToggleExpand,
  expandable,
  cellClassName,
  colSpan,
}: {
  row: R;
  rowKeyValue: string;
  isOpen: boolean;
  rowClass: string;
  onRowClick?: () => void;
  columns: Column<R>[];
  formKey: string;
  onToggleExpand: () => void;
  expandable?: ExpandableConfig<R>;
  cellClassName?: (r: R, c: Column<R>) => string | undefined;
  colSpan: number;
}) {
  return (
    <>
      <tr className={rowClass} onClick={onRowClick}>
        {columns.map((column) => (
          <Cell
            key={column.key}
            row={row}
            rowKeyValue={rowKeyValue}
            column={column}
            formKey={formKey}
            isOpen={isOpen}
            onToggleExpand={onToggleExpand}
            expandable={expandable}
            cellClassName={cellClassName}
          />
        ))}
      </tr>
      {expandable && isOpen ? (
        <tr className="tree_accordion-dense__row tree_accordion-dense__row--panel">
          <td className="tree_accordion-dense__cell" colSpan={colSpan}>
            {expandable.renderPanel(row)}
          </td>
        </tr>
      ) : null}
    </>
  );
}

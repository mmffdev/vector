"use client";

// <ColumnPicker> — Slice 4.5 of the ObjectTree refactor
// (docs/c_c_objecttree_refactor_plan.md).
//
// Rally-style "Show Fields" dropdown in the action bar that lets the user
// toggle which columns are visible on the grid. Draft/commit model:
// checkbox changes stay local until Apply, Cancel reverts.
//
// Built on top of:
//
//   Slice 2.5 — the backend ?fields= contract + /columns endpoint
//   Slice 4.6a — request coalescing (Apply triggers one refetch)
//
// Deferred:
//   - Server-side prefs persistence (cross-device). Local-only today.
//   - Cache-merge logic for back-fill of newly-added column data
//     (handled by useObjectTreeWindow via the fieldsSlice dep).
//   - Custom-field columns from a per-workspace catalogue. Catalogue is
//     static-per-build today; Slice 2.5 endpoint already exists.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdInfoOutline, MdSearch } from "react-icons/md";
import { TbColumns3 } from "react-icons/tb";

// ── Column catalogue types ──────────────────────────────────────────────────

export interface ColumnCatalogueEntry {
  /** Stable identifier — matches the ColumnDef.key on the rendered column. */
  key: string;
  /** Display label in the picker dropdown (and on the column header). */
  label: string;
  /**
   * The backend wire field name passed to ?fields=. Often the same
   * as `key` but not always — e.g. a "Status" column may aggregate
   * `flow_state_id,flow_state_name` over the wire.
   */
  wireKey: string;
  /**
   * Optional group label for picker organisation ("Identity", "People",
   * "Dates", "Custom fields", …). Entries without a group go in an
   * "Other" group at the bottom.
   */
  group?: string;
  /**
   * When false, the user can't toggle this column off (greyed checkbox).
   * Used for primary-ID / title columns the grid needs to function.
   */
  addable: boolean;
  /** Initial visibility on first ever load before any localStorage prefs. */
  defaultVisible: boolean;
}

export interface ColumnCatalogue {
  /** Full menu of available columns. */
  columns: ColumnCatalogueEntry[];
  /** localStorage key suffix; final key is `objecttree-v2.columns.<prefsKey>`. */
  prefsKey: string;
  /**
   * Optional cap on the number of user-addable columns that can be
   * visible at once. Excludes always-on columns. Surfaces as
   * "(N columns max)" in the header.
   */
  maxColumns?: number;
  /** Optional override for the trigger button label. Default: "Show Fields". */
  triggerLabel?: string;
  /** Optional override for the tooltip on the trigger. Default: "Show Columns". */
  triggerTooltip?: string;
}

// ── Hook: visible-keys state with localStorage persistence ──────────────────

const STORAGE_PREFIX = "objecttree-v2.columns.";

function readStoredKeys(prefsKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + prefsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

function writeStoredKeys(prefsKey: string, keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + prefsKey, JSON.stringify(keys));
  } catch {
    // localStorage may be disabled (private mode, quota) — non-fatal.
  }
}

export function useColumnPickerState(catalogue: ColumnCatalogue) {
  const defaults = useMemo(() => {
    const out: string[] = [];
    for (const c of catalogue.columns) {
      if (c.defaultVisible || !c.addable) out.push(c.key);
    }
    return out;
  }, [catalogue]);

  const [visibleKeys, setVisibleKeysRaw] = useState<string[]>(defaults);

  useEffect(() => {
    const stored = readStoredKeys(catalogue.prefsKey);
    if (stored) {
      const validKeys = new Set(catalogue.columns.map((c) => c.key));
      const alwaysOnKeys = catalogue.columns
        .filter((c) => !c.addable)
        .map((c) => c.key);
      const filtered = stored.filter((k) => validKeys.has(k));
      const next = Array.from(new Set([...alwaysOnKeys, ...filtered]));
      setVisibleKeysRaw(next);
    }
  }, [catalogue]);

  const setVisibleKeys = useCallback(
    (next: string[]) => {
      const alwaysOnKeys = catalogue.columns
        .filter((c) => !c.addable)
        .map((c) => c.key);
      const merged = Array.from(new Set([...alwaysOnKeys, ...next]));
      setVisibleKeysRaw(merged);
      writeStoredKeys(catalogue.prefsKey, merged);
    },
    [catalogue],
  );

  const resetToDefaults = useCallback(() => {
    setVisibleKeys(defaults);
  }, [defaults, setVisibleKeys]);

  const visibleWireKeys = useMemo(() => {
    const wireKeys: string[] = [];
    const byKey = new Map(catalogue.columns.map((c) => [c.key, c]));
    for (const k of visibleKeys) {
      const entry = byKey.get(k);
      if (entry) wireKeys.push(entry.wireKey);
    }
    return wireKeys;
  }, [catalogue, visibleKeys]);

  return {
    visibleKeys,
    visibleKeySet: useMemo(() => new Set(visibleKeys), [visibleKeys]),
    visibleWireKeys,
    setVisibleKeys,
    resetToDefaults,
  };
}

// ── ColumnPicker component ──────────────────────────────────────────────────

export interface ColumnPickerProps {
  catalogue: ColumnCatalogue;
  /** Currently-committed visible keys. */
  visibleKeys: string[];
  /** Setter — fires on Apply, not per checkbox toggle. */
  onChange: (next: string[]) => void;
  /** Optional reset-to-defaults callback. */
  onResetToDefaults?: () => void;
}

export function ColumnPicker({
  catalogue,
  visibleKeys,
  onChange,
  onResetToDefaults,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  // Draft state — what the user has toggled inside the open dropdown but
  // not yet committed. Initialised from the committed visibleKeys every
  // time the dropdown is opened, so Cancel-then-reopen is clean.
  const [draftKeys, setDraftKeys] = useState<string[]>(visibleKeys);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const draftSet = useMemo(() => new Set(draftKeys), [draftKeys]);

  // When opening, seed draft from committed state + clear search + focus
  // the search input. When closing, drop draft + search.
  useEffect(() => {
    if (open) {
      setDraftKeys(visibleKeys);
      setSearch("");
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, visibleKeys]);

  // Count of user-addable (non-always-on) draft columns — the value the
  // maxColumns cap actually gates.
  const { addableSelectedCount, addableTotal } = useMemo(() => {
    const addableKeys = new Set(
      catalogue.columns.filter((c) => c.addable).map((c) => c.key),
    );
    let selected = 0;
    for (const k of draftKeys) if (addableKeys.has(k)) selected++;
    return { addableSelectedCount: selected, addableTotal: addableKeys.size };
  }, [catalogue, draftKeys]);

  const atCap =
    typeof catalogue.maxColumns === "number" &&
    addableSelectedCount >= catalogue.maxColumns;

  // Group + filter by search.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, ColumnCatalogueEntry[]>();
    for (const col of catalogue.columns) {
      if (q && !col.label.toLowerCase().includes(q)) continue;
      const g = col.group ?? "Other";
      const list = map.get(g) ?? [];
      list.push(col);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [catalogue, search]);

  const toggle = useCallback(
    (key: string, entry: ColumnCatalogueEntry) => {
      if (!entry.addable) return;
      if (draftSet.has(key)) {
        setDraftKeys((prev) => prev.filter((k) => k !== key));
      } else {
        if (atCap) return;
        setDraftKeys((prev) => [...prev, key]);
      }
    },
    [draftSet, atCap],
  );

  const dirty = useMemo(() => {
    if (draftKeys.length !== visibleKeys.length) return true;
    const a = new Set(draftKeys);
    for (const k of visibleKeys) if (!a.has(k)) return true;
    return false;
  }, [draftKeys, visibleKeys]);

  const apply = useCallback(() => {
    onChange(draftKeys);
    setOpen(false);
  }, [draftKeys, onChange]);

  const cancel = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on outside-click (pointerdown, mirroring ObjectTreeDetailFlyout).
  // Cancel-equivalent — drops draft via the open-effect on next open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest?.("[data-objecttree-column-picker]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Escape key cancels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerLabel = catalogue.triggerLabel ?? "Show Fields";
  const triggerTooltip = catalogue.triggerTooltip ?? "Show Columns";
  const headerCap =
    typeof catalogue.maxColumns === "number"
      ? `(${catalogue.maxColumns} columns max)`
      : `(${addableSelectedCount} of ${addableTotal} selected)`;

  return (
    <span
      data-objecttree-column-picker
      className="column-picker__Wrap"
    >
      <button
        type="button"
        className={`tree_accordion-dense__filterbar-chip column-picker__Trigger${
          open ? " column-picker__Trigger--open" : ""
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-label={triggerTooltip}
        title={triggerTooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          <TbColumns3 size={14} />
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">
          {triggerLabel}
        </span>
      </button>
      {open && (
        <div
          className="column-picker__Panel"
          role="dialog"
          aria-label={triggerTooltip}
        >
          <div className="column-picker__PanelHeader">
            <span className="column-picker__PanelTitle">Show Columns</span>
            <button
              type="button"
              className="column-picker__PanelClose"
              onClick={cancel}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="column-picker__SearchRow">
            <span className="column-picker__SearchIcon" aria-hidden="true">
              <MdSearch size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="column-picker__SearchInput"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search columns"
            />
          </div>
          <div className="column-picker__SelectedHeader">
            <span className="column-picker__SelectedLabel">SELECTED</span>
            <span className="column-picker__SelectedCount">{headerCap}</span>
            <span
              className="column-picker__SelectedInfo"
              aria-hidden="true"
              title={
                typeof catalogue.maxColumns === "number"
                  ? `You can have up to ${catalogue.maxColumns} user-addable columns visible at once.`
                  : `${addableSelectedCount} of ${addableTotal} addable columns visible.`
              }
            >
              <MdInfoOutline size={13} />
            </span>
          </div>
          <div className="column-picker__List">
            {grouped.length === 0 && (
              <div className="column-picker__Empty">No columns match.</div>
            )}
            {grouped.map(([group, cols]) => (
              <div key={group} className="column-picker__Group">
                {grouped.length > 1 && (
                  <div className="column-picker__GroupHeading">{group}</div>
                )}
                {cols.map((col) => {
                  const checked = draftSet.has(col.key);
                  const disabled =
                    !col.addable || (!checked && atCap);
                  return (
                    <button
                      key={col.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      disabled={disabled}
                      onClick={() => toggle(col.key, col)}
                      className={`column-picker__Row${
                        checked ? " column-picker__Row--checked" : ""
                      }${disabled ? " column-picker__Row--disabled" : ""}`}
                    >
                      <span
                        className={`column-picker__Check${
                          checked ? " column-picker__Check--checked" : ""
                        }`}
                        aria-hidden="true"
                      >
                        {checked ? "✓" : ""}
                      </span>
                      <span className="column-picker__RowLabel">{col.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="column-picker__Footer">
            {onResetToDefaults && (
              <button
                type="button"
                onClick={() => {
                  // Reset draft to catalogue defaults (without committing
                  // until Apply). Always-on keys come in for free.
                  const defaults: string[] = [];
                  for (const c of catalogue.columns) {
                    if (c.defaultVisible || !c.addable) defaults.push(c.key);
                  }
                  setDraftKeys(defaults);
                }}
                className="column-picker__Reset"
              >
                Reset to defaults
              </button>
            )}
            <span className="column-picker__FooterSpacer" />
            <button
              type="button"
              onClick={cancel}
              className="column-picker__Cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!dirty}
              className="column-picker__Apply"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

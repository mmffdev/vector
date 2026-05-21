"use client";

// <ColumnPicker> — Slice 4.5 of the ObjectTree refactor
// (docs/c_c_objecttree_refactor_plan.md).
//
// Dropdown in the action bar that lets the user toggle which columns
// are visible on the grid. Built on top of:
//
//   Slice 2.5 — the backend ?fields= contract + /columns endpoint
//   Slice 4.6a — request coalescing (rapid checkbox toggles collapse
//                to one outgoing refetch)
//
// Scope of THIS slice — minimum viable picker:
//   ✓ Dropdown with grouped checkboxes
//   ✓ Always-on keys (e.g. id) appear but are disabled
//   ✓ defaultVisible: true picks the initial set
//   ✓ Reset-to-defaults action
//   ✓ visibleKeys state owned by the parent (V2's ObjectTree)
//   ✓ localStorage persistence (per-treeName prefs key)
//   ✓ Filters config.columns before passing to ResourceTree (visual
//     hide/show, not just wire-only)
//
// Deferred (call out in comments where they bite):
//   - Server-side prefs persistence (cross-device). Local-only today.
//   - Cache-merge logic for back-fill of newly-added column data
//     (today: the existing window refetch via useObjectTreeWindow
//     handles it via the fieldsSlice dep). Optimal cache merge that
//     preserves expanded sub-trees is a follow-up.
//   - Custom-field columns from a per-workspace catalogue. Catalogue
//     is static-per-build today; the column-catalogue endpoint already
//     exists (Slice 2.5) so future work can hydrate from it.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MdViewColumn, MdCheckBox, MdCheckBoxOutlineBlank } from "react-icons/md";

// ── Column catalogue types ──────────────────────────────────────────────────

/**
 * One entry in the column catalogue — what the user can pick in the
 * picker dropdown. Shape mirrors the docs/examples JSON example for
 * forward-compat with the Slice 6+ JSON config migration.
 */
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

/**
 * Hook that owns the picker's visible-keys state. Reads from
 * localStorage on mount (falls back to the catalogue's defaultVisible
 * set). Always-on (non-addable) columns are folded in unconditionally
 * so the picker can't accidentally exclude required columns.
 *
 * Returns the visible-keys Set + a setter (used by the picker) +
 * the corresponding wireKeys (used by useObjectTreeWindow's `fields`).
 */
export function useColumnPickerState(catalogue: ColumnCatalogue) {
  const defaults = useMemo(() => {
    const out: string[] = [];
    for (const c of catalogue.columns) {
      if (c.defaultVisible || !c.addable) out.push(c.key);
    }
    return out;
  }, [catalogue]);

  const [visibleKeys, setVisibleKeysRaw] = useState<string[]>(defaults);

  // Hydrate from localStorage after first paint (avoid hydration mismatch).
  useEffect(() => {
    const stored = readStoredKeys(catalogue.prefsKey);
    if (stored) {
      // Validate against the current catalogue — drop stale keys,
      // ensure always-on keys are present.
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
      // Always-on keys can't be removed.
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

  // Map visible keys → wireKeys for the data hook's ?fields= param.
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
  /** Currently-visible keys. */
  visibleKeys: string[];
  /** Setter — fires when the user toggles checkboxes. */
  onChange: (next: string[]) => void;
  /** Optional reset-to-defaults callback (rendered as a footer link). */
  onResetToDefaults?: () => void;
}

export function ColumnPicker({
  catalogue,
  visibleKeys,
  onChange,
  onResetToDefaults,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);

  // Group columns by their `group` field.
  const grouped = useMemo(() => {
    const map = new Map<string, ColumnCatalogueEntry[]>();
    for (const col of catalogue.columns) {
      const g = col.group ?? "Other";
      const list = map.get(g) ?? [];
      list.push(col);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [catalogue]);

  const toggle = useCallback(
    (key: string) => {
      if (visibleSet.has(key)) {
        onChange(visibleKeys.filter((k) => k !== key));
      } else {
        onChange([...visibleKeys, key]);
      }
    },
    [visibleKeys, visibleSet, onChange],
  );

  // Close on outside-click. The shell-style listener pattern used by
  // ObjectTreeDetailFlyout — pointerdown so we beat focus events.
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

  return (
    <span data-objecttree-column-picker className="tree_accordion-dense__filterbar-chip" style={{ position: "relative" }}>
      <button
        type="button"
        className="tree_accordion-dense__filterbar-chip"
        onClick={() => setOpen((o) => !o)}
        aria-label="Configure columns"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          <MdViewColumn size={14} />
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">Columns</span>
      </button>
      {open && (
        <div
          className="column-picker__panel"
          role="menu"
          aria-label="Columns"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            minWidth: 220,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--surface-elev)",
            border: "1px solid var(--ink-faint)",
            borderRadius: 6,
            padding: 8,
            zIndex: 30,
          }}
        >
          {grouped.map(([group, cols]) => (
            <div key={group} className="column-picker__group" style={{ marginBottom: 8 }}>
              <div
                className="column-picker__group-heading"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "var(--ink-muted)",
                  padding: "4px 6px",
                }}
              >
                {group}
              </div>
              {cols.map((col) => {
                const checked = visibleSet.has(col.key);
                const disabled = !col.addable;
                return (
                  <button
                    key={col.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => toggle(col.key)}
                    className="column-picker__row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "6px 6px",
                      border: "none",
                      background: "transparent",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.55 : 1,
                      textAlign: "left",
                      fontSize: 13,
                      color: "var(--ink)",
                    }}
                  >
                    {checked ? (
                      <MdCheckBox size={16} />
                    ) : (
                      <MdCheckBoxOutlineBlank size={16} />
                    )}
                    <span>{col.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {onResetToDefaults && (
            <button
              type="button"
              onClick={onResetToDefaults}
              className="column-picker__reset"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--ink-faint)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
                color: "var(--ink-muted)",
              }}
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
    </span>
  );
}

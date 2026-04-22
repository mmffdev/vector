"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
import {
  NAV_CATALOG,
  catalogFor,
  findCatalogEntry,
  type NavCatalogEntry,
} from "@/app/lib/navCatalog";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface StagedRow {
  key: string;
  isStartPage: boolean;
}

export default function NavManageModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const { prefs, save, reset } = useNavPrefs();
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate staged state from current prefs whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    const rows = prefs
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ key: p.item_key, isStartPage: p.is_start_page }));
    setStaged(rows);
    setError(null);
  }, [open, prefs]);

  const role = user?.role;

  const pool = useMemo<NavCatalogEntry[]>(() => {
    if (!role) return [];
    const stagedKeys = new Set(staged.map((r) => r.key));
    return catalogFor(role).filter((e) => e.pinnable && !stagedKeys.has(e.key));
  }, [role, staged]);

  const pinnedEntries = useMemo<(NavCatalogEntry & { isStartPage: boolean })[]>(
    () =>
      staged
        .map((r) => {
          const e = findCatalogEntry(r.key);
          return e ? { ...e, isStartPage: r.isStartPage } : null;
        })
        .filter((e): e is NavCatalogEntry & { isStartPage: boolean } => !!e),
    [staged],
  );

  if (!open) return null;

  const move = (index: number, delta: number) => {
    const next = staged.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStaged(next);
  };

  const unpin = (key: string) => {
    setStaged((cur) => cur.filter((r) => r.key !== key));
  };

  const pin = (key: string) => {
    setStaged((cur) => [...cur, { key, isStartPage: false }]);
  };

  const setStart = (key: string) => {
    setStaged((cur) =>
      cur.map((r) => ({ ...r, isStartPage: r.key === key ? !r.isStartPage : false })),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const startRow = staged.find((r) => r.isStartPage);
      await save({
        pinned: staged.map((r, i) => ({ item_key: r.key, position: i })),
        start_page_key: startRow?.key ?? null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      await reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to reset");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage navigation"
    >
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">Manage navigation</div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal__body">
          <div className="nav-manage__panes">
            <section className="nav-manage__pane" aria-label="Pinned">
              <h3 className="nav-manage__pane-title">Pinned</h3>
              {pinnedEntries.length === 0 ? (
                <p className="nav-manage__empty">No items pinned — the sidebar falls back to defaults.</p>
              ) : (
                <ul className="nav-manage__list">
                  {pinnedEntries.map((e, i) => (
                    <li key={e.key} className="nav-manage__row">
                      <span className="nav-manage__label">{e.label}</span>
                      <div className="nav-manage__actions">
                        <button
                          type="button"
                          className="nav-manage__btn"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label={`Move ${e.label} up`}
                          title="Move up"
                        >↑</button>
                        <button
                          type="button"
                          className="nav-manage__btn"
                          onClick={() => move(i, 1)}
                          disabled={i === pinnedEntries.length - 1}
                          aria-label={`Move ${e.label} down`}
                          title="Move down"
                        >↓</button>
                        <button
                          type="button"
                          className={`nav-manage__btn ${e.isStartPage ? "nav-manage__btn--active" : ""}`}
                          onClick={() => setStart(e.key)}
                          aria-label={e.isStartPage ? `Unset ${e.label} as start page` : `Set ${e.label} as start page`}
                          aria-pressed={e.isStartPage}
                          title={e.isStartPage ? "Start page (click to unset)" : "Set as start page"}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={e.isStartPage ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <path d="M9 22V12h6v10" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="nav-manage__btn nav-manage__btn--danger"
                          onClick={() => unpin(e.key)}
                          aria-label={`Unpin ${e.label}`}
                          title="Unpin"
                        >×</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="nav-manage__pane" aria-label="Available">
              <h3 className="nav-manage__pane-title">Available</h3>
              {pool.length === 0 ? (
                <p className="nav-manage__empty">Everything is pinned.</p>
              ) : (
                <ul className="nav-manage__list">
                  {pool.map((e) => (
                    <li key={e.key} className="nav-manage__row">
                      <span className="nav-manage__label">{e.label}</span>
                      <div className="nav-manage__actions">
                        <button
                          type="button"
                          className="nav-manage__btn"
                          onClick={() => pin(e.key)}
                          aria-label={`Pin ${e.label}`}
                          title="Pin"
                        >+</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {error && <p className="nav-manage__error" role="alert">{error}</p>}

          <div className="modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleReset}
              disabled={saving}
            >Reset to defaults</button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={saving}
            >Cancel</button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving}
            >{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Keep NAV_CATALOG reference live to avoid an unused-import warning if
// the file is tree-shaken down the line. Harmless.
void NAV_CATALOG;

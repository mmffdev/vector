"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

const MAX_PINNED = 20;

function PinnedRow({
  entry,
  onUnpin,
  onToggleStart,
}: {
  entry: NavCatalogEntry & { isStartPage: boolean };
  onUnpin: () => void;
  onToggleStart: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="nav-manage__row">
      <button
        type="button"
        className="nav-manage__drag"
        aria-label={`Reorder ${entry.label}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <span className="nav-manage__label">{entry.label}</span>
      <div className="nav-manage__actions">
        <button
          type="button"
          className={`nav-manage__btn ${entry.isStartPage ? "nav-manage__btn--active" : ""}`}
          onClick={onToggleStart}
          aria-label={entry.isStartPage ? `Unset ${entry.label} as start page` : `Set ${entry.label} as start page`}
          aria-pressed={entry.isStartPage}
          title={entry.isStartPage ? "Start page (click to unset)" : "Set as start page"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={entry.isStartPage ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
        </button>
        <button
          type="button"
          className="nav-manage__btn nav-manage__btn--danger"
          onClick={onUnpin}
          aria-label={`Unpin ${entry.label}`}
          title="Unpin"
        >×</button>
      </div>
    </li>
  );
}

export default function NavManageModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const { prefs, save, reset } = useNavPrefs();
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!open) return null;

  const atCap = staged.length >= MAX_PINNED;

  const unpin = (key: string) => {
    setStaged((cur) => cur.filter((r) => r.key !== key));
  };

  const pin = (key: string) => {
    if (atCap) return;
    setStaged((cur) => [...cur, { key, isStartPage: false }]);
  };

  const setStart = (key: string) => {
    setStaged((cur) =>
      cur.map((r) => ({ ...r, isStartPage: r.key === key ? !r.isStartPage : false })),
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStaged((cur) => {
      const from = cur.findIndex((r) => r.key === active.id);
      const to = cur.findIndex((r) => r.key === over.id);
      if (from < 0 || to < 0) return cur;
      return arrayMove(cur, from, to);
    });
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
              <h3 className="nav-manage__pane-title">
                Pinned <span className="nav-manage__count">{staged.length}/{MAX_PINNED}</span>
              </h3>
              {pinnedEntries.length === 0 ? (
                <p className="nav-manage__empty">No items pinned — the sidebar falls back to defaults.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={pinnedEntries.map((e) => e.key)} strategy={verticalListSortingStrategy}>
                    <ul className="nav-manage__list">
                      {pinnedEntries.map((e) => (
                        <PinnedRow
                          key={e.key}
                          entry={e}
                          onUnpin={() => unpin(e.key)}
                          onToggleStart={() => setStart(e.key)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
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
                          disabled={atCap}
                          aria-label={`Pin ${e.label}`}
                          title={atCap ? `Pinned limit (${MAX_PINNED}) reached` : "Pin"}
                        >+</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {atCap && <p className="nav-manage__notice">Pinned limit reached — unpin an item to add another.</p>}
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

void NAV_CATALOG;

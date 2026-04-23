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
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  useNavPrefs,
  type NavCatalogEntry,
  type NavTagGroup,
} from "@/app/contexts/NavPrefsContext";

const MAX_PINNED = 20;

interface DraftItem {
  key: string;
}

interface DraftState {
  groupOrder: string[];
  itemsByGroup: Record<string, DraftItem[]>;
  startPageKey: string | null;
}

const itemId = (k: string) => `item:${k}`;
const groupId = (g: string) => `group:${g}`;

function SortableItemRow({
  entry,
  isStart,
  onUnpin,
  onToggleStart,
}: {
  entry: NavCatalogEntry;
  isStart: boolean;
  onUnpin: () => void;
  onToggleStart: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId(entry.key) });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} className="nav-prefs__row">
      <button
        type="button"
        className="nav-prefs__drag"
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
      <span className="nav-prefs__label">{entry.label}</span>
      <div className="nav-prefs__actions">
        <button
          type="button"
          className={`nav-prefs__btn ${isStart ? "nav-prefs__btn--active" : ""}`}
          onClick={onToggleStart}
          aria-label={isStart ? `Unset ${entry.label} as start page` : `Set ${entry.label} as start page`}
          aria-pressed={isStart}
          title={isStart ? "Start page (click to unset)" : "Set as start page"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isStart ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
        </button>
        <button
          type="button"
          className="nav-prefs__btn nav-prefs__btn--danger"
          onClick={onUnpin}
          aria-label={`Unpin ${entry.label}`}
          title="Unpin"
        >×</button>
      </div>
    </li>
  );
}

function SortableGroupBlock({
  tag,
  items,
  startPageKey,
  onUnpin,
  onToggleStart,
  findEntry,
}: {
  tag: NavTagGroup;
  items: DraftItem[];
  startPageKey: string | null;
  onUnpin: (key: string) => void;
  onToggleStart: (key: string) => void;
  findEntry: (key: string) => NavCatalogEntry | undefined;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: groupId(tag.enum) });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const resolved = items
    .map((it) => ({ item: it, entry: findEntry(it.key) }))
    .filter((r): r is { item: DraftItem; entry: NavCatalogEntry } => !!r.entry);
  return (
    <div ref={setNodeRef} style={style} className="nav-prefs__group">
      <div className="nav-prefs__group-heading-row">
        <button
          type="button"
          className="nav-prefs__group-drag"
          aria-label={`Reorder ${tag.label} group`}
          title="Drag group to reorder"
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
        <h3 className="nav-prefs__group-heading">{tag.label}</h3>
      </div>
      <SortableContext items={resolved.map((r) => itemId(r.entry.key))} strategy={verticalListSortingStrategy}>
        <ul className="nav-prefs__list">
          {resolved.map(({ entry }) => (
            <SortableItemRow
              key={entry.key}
              entry={entry}
              isStart={startPageKey === entry.key}
              onUnpin={() => onUnpin(entry.key)}
              onToggleStart={() => onToggleStart(entry.key)}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}

export default function NavPreferencesPage() {
  const { user } = useAuth();
  const { prefs, save, reset, catalogue, findEntry, tagByEnum, tags } = useNavPrefs();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rehydrate draft from server prefs whenever prefs change and we don't
  // already have a draft diverging from the server.
  useEffect(() => {
    const sortedPrefs = prefs.slice().sort((a, b) => a.position - b.position);
    const groupOrder: string[] = [];
    const itemsByGroup: Record<string, DraftItem[]> = {};
    let startPageKey: string | null = null;
    for (const p of sortedPrefs) {
      if (p.is_start_page) startPageKey = p.item_key;
      const entry = findEntry(p.item_key);
      if (!entry) continue; // entry retired from catalogue — drop silently
      const tagEnum = entry.tagEnum || "personal";
      if (!(tagEnum in itemsByGroup)) {
        groupOrder.push(tagEnum);
        itemsByGroup[tagEnum] = [];
      }
      itemsByGroup[tagEnum].push({ key: p.item_key });
    }
    setDraft({ groupOrder, itemsByGroup, startPageKey });
    setError(null);
  }, [prefs, findEntry]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const totalPinned = useMemo(() => {
    if (!draft) return 0;
    return draft.groupOrder.reduce((acc, g) => acc + (draft.itemsByGroup[g]?.length ?? 0), 0);
  }, [draft]);

  // Pool: role-filtered catalogue (server already did the gate) minus
  // whatever is currently in the draft.
  const pool = useMemo<NavCatalogEntry[]>(() => {
    if (!draft) return [];
    const pinnedKeys = new Set<string>();
    for (const g of draft.groupOrder) {
      for (const it of draft.itemsByGroup[g] ?? []) pinnedKeys.add(it.key);
    }
    return catalogue
      .filter((e) => e.pinnable && !pinnedKeys.has(e.key))
      .slice()
      .sort((a, b) => {
        const ta = tagByEnum(a.tagEnum)?.defaultOrder ?? 99;
        const tb = tagByEnum(b.tagEnum)?.defaultOrder ?? 99;
        if (ta !== tb) return ta - tb;
        return a.defaultOrder - b.defaultOrder;
      });
  }, [draft, catalogue, tagByEnum]);

  if (!user || !draft) return null;

  const atCap = totalPinned >= MAX_PINNED;

  const pin = (key: string) => {
    if (atCap || !draft) return;
    const entry = findEntry(key);
    if (!entry) return;
    const tagEnum = entry.tagEnum || "personal";
    const exists = tagEnum in draft.itemsByGroup;
    setDraft({
      ...draft,
      groupOrder: exists ? draft.groupOrder : [...draft.groupOrder, tagEnum],
      itemsByGroup: {
        ...draft.itemsByGroup,
        [tagEnum]: [...(draft.itemsByGroup[tagEnum] ?? []), { key }],
      },
    });
  };

  const unpin = (key: string) => {
    if (!draft) return;
    const entry = findEntry(key);
    if (!entry) return;
    const tagEnum = entry.tagEnum || "personal";
    const remaining = (draft.itemsByGroup[tagEnum] ?? []).filter((it) => it.key !== key);
    const itemsByGroup = { ...draft.itemsByGroup };
    let groupOrder = draft.groupOrder;
    if (remaining.length === 0) {
      delete itemsByGroup[tagEnum];
      groupOrder = draft.groupOrder.filter((g) => g !== tagEnum);
    } else {
      itemsByGroup[tagEnum] = remaining;
    }
    setDraft({
      ...draft,
      groupOrder,
      itemsByGroup,
      startPageKey: draft.startPageKey === key ? null : draft.startPageKey,
    });
  };

  const toggleStart = (key: string) => {
    if (!draft) return;
    setDraft({ ...draft, startPageKey: draft.startPageKey === key ? null : key });
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!draft) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("group:") && overId.startsWith("group:")) {
      const a = activeId.slice("group:".length);
      const o = overId.slice("group:".length);
      const from = draft.groupOrder.indexOf(a);
      const to = draft.groupOrder.indexOf(o);
      if (from < 0 || to < 0) return;
      setDraft({ ...draft, groupOrder: arrayMove(draft.groupOrder, from, to) });
      return;
    }

    if (activeId.startsWith("item:") && overId.startsWith("item:")) {
      const aKey = activeId.slice("item:".length);
      const oKey = overId.slice("item:".length);
      const findOwner = (k: string) =>
        Object.entries(draft.itemsByGroup).find(([, list]) => list.some((it) => it.key === k))?.[0];
      const aGroup = findOwner(aKey);
      const oGroup = findOwner(oKey);
      if (!aGroup || !oGroup || aGroup !== oGroup) return;
      const list = draft.itemsByGroup[aGroup];
      const from = list.findIndex((it) => it.key === aKey);
      const to = list.findIndex((it) => it.key === oKey);
      if (from < 0 || to < 0) return;
      setDraft({
        ...draft,
        itemsByGroup: {
          ...draft.itemsByGroup,
          [aGroup]: arrayMove(list, from, to),
        },
      });
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const flat: { item_key: string; position: number }[] = [];
      for (const g of draft.groupOrder) {
        for (const it of draft.itemsByGroup[g] ?? []) {
          flat.push({ item_key: it.key, position: flat.length });
        }
      }
      await save({ pinned: flat, start_page_key: draft.startPageKey });
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to reset");
    } finally {
      setSaving(false);
    }
  };

  const renderedGroups = draft.groupOrder
    .map((enumKey) => {
      const tag = tagByEnum(enumKey);
      if (!tag) return null;
      const items = draft.itemsByGroup[enumKey] ?? [];
      if (items.length === 0) return null;
      return { tag, items };
    })
    .filter((g): g is { tag: NavTagGroup; items: DraftItem[] } => !!g);

  // Pool grouped by tag for readable "Available" rendering.
  const poolByTag = new Map<string, NavCatalogEntry[]>();
  for (const entry of pool) {
    const list = poolByTag.get(entry.tagEnum) ?? [];
    list.push(entry);
    poolByTag.set(entry.tagEnum, list);
  }
  const poolTags = tags
    .filter((t) => poolByTag.has(t.enum))
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder);

  return (
    <PageShell
      title="Navigation preferences"
      subtitle={`Pin up to ${MAX_PINNED} pages to your sidebar and pick a start page.`}
    >
      <div className="nav-prefs">
        <section className="nav-prefs__pane" aria-label="Pinned">
          <header className="nav-prefs__pane-header">
            <h2 className="nav-prefs__pane-title">
              Pinned <span className="nav-prefs__count">{totalPinned}/{MAX_PINNED}</span>
            </h2>
          </header>
          {renderedGroups.length === 0 ? (
            <p className="nav-prefs__empty">Nothing pinned — the sidebar will show defaults until you pin something.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={renderedGroups.map((g) => groupId(g.tag.enum))}
                strategy={verticalListSortingStrategy}
              >
                {renderedGroups.map((g) => (
                  <SortableGroupBlock
                    key={g.tag.enum}
                    tag={g.tag}
                    items={g.items}
                    startPageKey={draft.startPageKey}
                    onUnpin={unpin}
                    onToggleStart={toggleStart}
                    findEntry={findEntry}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </section>

        <section className="nav-prefs__pane" aria-label="Available">
          <header className="nav-prefs__pane-header">
            <h2 className="nav-prefs__pane-title">Available</h2>
          </header>
          {poolTags.length === 0 ? (
            <p className="nav-prefs__empty">Everything visible to your role is already pinned.</p>
          ) : (
            poolTags.map((tag) => (
              <div key={tag.enum} className="nav-prefs__group">
                <div className="nav-prefs__group-heading-row nav-prefs__group-heading-row--static">
                  <h3 className="nav-prefs__group-heading">{tag.label}</h3>
                </div>
                <ul className="nav-prefs__list">
                  {(poolByTag.get(tag.enum) ?? []).map((entry) => (
                    <li key={entry.key} className="nav-prefs__row">
                      <span className="nav-prefs__label">{entry.label}</span>
                      <div className="nav-prefs__actions">
                        <button
                          type="button"
                          className="nav-prefs__btn"
                          onClick={() => pin(entry.key)}
                          disabled={atCap}
                          aria-label={`Pin ${entry.label}`}
                          title={atCap ? `Pinned limit (${MAX_PINNED}) reached` : "Pin"}
                        >+</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section className="nav-prefs__pane nav-prefs__pane--custom" aria-label="Your custom pages">
          <header className="nav-prefs__pane-header">
            <h2 className="nav-prefs__pane-title">Your custom pages</h2>
          </header>
          <p className="nav-prefs__empty">
            Coming soon — build your own pages from charts, reports, and widgets.
          </p>
        </section>
      </div>

      {atCap && <p className="nav-prefs__notice">Pinned limit reached — unpin an item to add another.</p>}
      {error && <p className="nav-prefs__error" role="alert">{error}</p>}

      <div className="nav-prefs__actions-bar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={handleReset}
          disabled={saving}
        >Reset to defaults</button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >{saving ? "Saving…" : "Save"}</button>
      </div>
    </PageShell>
  );
}

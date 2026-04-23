"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
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
  type PutPrefsBody,
  type PutPrefsPinnedRow,
  type PutPrefsGroupRow,
} from "@/app/contexts/NavPrefsContext";

const MAX_PINNED = 50;
const MAX_CUSTOM_GROUPS = 10;
const MAX_CHILDREN_PER_PARENT = 8;
const MAX_GROUP_LABEL_LEN = 64;

// A bucket id is either "tag:<enum>" for a system tag bucket or
// "group:<id>" for a custom group bucket. Custom groups can be reordered;
// system tags stay where they are. Catalogue (non user_custom) items always
// sit in their tag bucket; only user_custom items can move into custom
// groups or nest under a parent.
type BucketKey = string;
const tagBucket = (e: string): BucketKey => `tag:${e}`;
const groupBucket = (id: string): BucketKey => `group:${id}`;

interface DraftItem {
  key: string;
  parent: string | null;
}

interface DraftGroup {
  id: string; // canonical UUID, or "new:<uuid>" for unsaved
  label: string;
  position: number;
}

interface DraftState {
  // bucketOrder is the visual top-to-bottom order of all buckets; it
  // includes both tag and custom buckets interleaved by user choice.
  bucketOrder: BucketKey[];
  // itemsByBucket: top-level items in each bucket, in render order.
  // children are stored separately keyed by parent.
  itemsByBucket: Record<BucketKey, DraftItem[]>;
  childrenByParent: Record<string, string[]>; // parentKey -> ordered child keys
  customGroups: DraftGroup[];
  startPageKey: string | null;
}

const itemDragId = (k: string) => `item:${k}`;
const groupHeaderDragId = (id: string) => `gheader:${id}`;

function nextSyntheticId(): string {
  return `new:${typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)}`;
}

function PinnedRow({
  entry,
  isStart,
  onUnpin,
  onToggleStart,
  draggable,
}: {
  entry: NavCatalogEntry;
  isStart: boolean;
  onUnpin: () => void;
  onToggleStart: () => void;
  draggable: boolean;
}) {
  const sortable = useSortable({ id: itemDragId(entry.key), disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} className="nav-prefs__row">
      {draggable && (
        <button
          type="button"
          className="nav-prefs__drag"
          aria-label={`Reorder ${entry.label}`}
          title="Drag to reorder or nest"
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
      )}
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

// Children list shown beneath a parent when expanded.
function ChildrenList({
  parentKey,
  childKeys,
  startPageKey,
  findEntry,
  onUnpin,
  onToggleStart,
}: {
  parentKey: string;
  childKeys: string[];
  startPageKey: string | null;
  findEntry: (k: string) => NavCatalogEntry | undefined;
  onUnpin: (k: string) => void;
  onToggleStart: (k: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `parent:${parentKey}` });
  return (
    <ul
      ref={setNodeRef}
      className={`nav-prefs__children ${isOver ? "nav-prefs__children--over" : ""}`}
    >
      <SortableContext items={childKeys.map(itemDragId)} strategy={verticalListSortingStrategy}>
        {childKeys.length === 0 && (
          <li className="nav-prefs__children-empty">Drag a custom page here to nest it.</li>
        )}
        {childKeys.map((ck) => {
          const e = findEntry(ck);
          if (!e) return null;
          return (
            <PinnedRow
              key={ck}
              entry={e}
              isStart={startPageKey === ck}
              onUnpin={() => onUnpin(ck)}
              onToggleStart={() => onToggleStart(ck)}
              draggable
            />
          );
        })}
      </SortableContext>
    </ul>
  );
}

// A single bucket (tag or custom) — sortable list of items + nested children.
function BucketBlock({
  bucketId,
  heading,
  items,
  childrenByParent,
  startPageKey,
  findEntry,
  onUnpin,
  onToggleStart,
  onRename,
  onRemoveGroup,
  isCustom,
}: {
  bucketId: BucketKey;
  heading: string;
  items: DraftItem[];
  childrenByParent: Record<string, string[]>;
  startPageKey: string | null;
  findEntry: (k: string) => NavCatalogEntry | undefined;
  onUnpin: (k: string) => void;
  onToggleStart: (k: string) => void;
  onRename?: (label: string) => void;
  onRemoveGroup?: () => void;
  isCustom: boolean;
}) {
  const headerSortable = useSortable({
    id: groupHeaderDragId(bucketId),
    disabled: !isCustom,
  });
  const dropZone = useDroppable({ id: `bucket:${bucketId}` });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(headerSortable.transform),
    transition: headerSortable.transition,
    opacity: headerSortable.isDragging ? 0.6 : 1,
  };

  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(heading);
  useEffect(() => { setDraftLabel(heading); }, [heading]);

  const commit = () => {
    setEditing(false);
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== heading && onRename) onRename(trimmed);
    else setDraftLabel(heading);
  };

  return (
    <div
      ref={headerSortable.setNodeRef}
      style={style}
      className={`nav-prefs__group ${isCustom ? "nav-prefs__group--custom" : ""}`}
    >
      <div className="nav-prefs__group-heading-row">
        {isCustom && (
          <button
            type="button"
            className="nav-prefs__group-drag"
            aria-label={`Reorder ${heading} group`}
            title="Drag group to reorder"
            {...headerSortable.attributes}
            {...headerSortable.listeners}
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
        )}
        {isCustom && editing ? (
          <input
            className="nav-prefs__group-rename"
            value={draftLabel}
            autoFocus
            maxLength={MAX_GROUP_LABEL_LEN}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setDraftLabel(heading); setEditing(false); }
            }}
          />
        ) : (
          <h3
            className="nav-prefs__group-heading"
            onDoubleClick={() => isCustom && setEditing(true)}
            title={isCustom ? "Double-click to rename" : undefined}
          >
            {heading}
          </h3>
        )}
        {isCustom && !editing && (
          <div className="nav-prefs__group-actions">
            <button
              type="button"
              className="nav-prefs__btn"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${heading} group`}
              title="Rename group"
            >✎</button>
            <button
              type="button"
              className="nav-prefs__btn nav-prefs__btn--danger"
              onClick={onRemoveGroup}
              aria-label={`Remove ${heading} group`}
              title="Remove group (items move to their tag groups)"
            >×</button>
          </div>
        )}
      </div>
      <SortableContext items={items.map((it) => itemDragId(it.key))} strategy={verticalListSortingStrategy}>
        <ul
          ref={dropZone.setNodeRef}
          className={`nav-prefs__list ${dropZone.isOver ? "nav-prefs__list--over" : ""}`}
        >
          {items.length === 0 && (
            <li className="nav-prefs__children-empty">
              {isCustom ? "Drag a custom page here." : "Empty — pin something below."}
            </li>
          )}
          {items.map((it) => {
            const entry = findEntry(it.key);
            if (!entry) return null;
            const childKeys = childrenByParent[it.key] ?? [];
            const draggable = entry.kind === "user_custom";
            return (
              <div key={it.key} className="nav-prefs__parent-wrap">
                <PinnedRow
                  entry={entry}
                  isStart={startPageKey === it.key}
                  onUnpin={() => onUnpin(it.key)}
                  onToggleStart={() => onToggleStart(it.key)}
                  draggable={draggable || childKeys.length > 0}
                />
                <ChildrenList
                  parentKey={it.key}
                  childKeys={childKeys}
                  startPageKey={startPageKey}
                  findEntry={findEntry}
                  onUnpin={onUnpin}
                  onToggleStart={onToggleStart}
                />
              </div>
            );
          })}
        </ul>
      </SortableContext>
    </div>
  );
}

export default function NavPreferencesPage() {
  const { user } = useAuth();
  const {
    prefs, customGroups, save, reset, catalogue,
    defaultPinned, findEntry, tagByEnum, tags,
  } = useNavPrefs();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate draft from server state. Both tag buckets and custom buckets
  // are produced in first-appearance order (matching sidebar logic), with
  // empty custom buckets appended by their saved position.
  useEffect(() => {
    const itemsByBucket: Record<BucketKey, DraftItem[]> = {};
    const childrenByParent: Record<string, string[]> = {};
    const orderSeen: BucketKey[] = [];
    let startPageKey: string | null = null;

    const note = (b: BucketKey) => { if (!orderSeen.includes(b)) orderSeen.push(b); };

    const pushTopLevel = (key: string, bucket: BucketKey) => {
      (itemsByBucket[bucket] ??= []).push({ key, parent: null });
      note(bucket);
    };

    if (prefs.length === 0) {
      for (const entry of defaultPinned) {
        pushTopLevel(entry.key, tagBucket(entry.tagEnum || "personal"));
      }
    } else {
      const sorted = prefs.slice().sort((a, b) => a.position - b.position);
      // First pass: top-level rows.
      for (const p of sorted) {
        if (p.is_start_page) startPageKey = p.item_key;
        if (p.parent_item_key) continue;
        const entry = findEntry(p.item_key);
        if (!entry) continue;
        const bucket = p.group_id
          ? groupBucket(p.group_id)
          : tagBucket(entry.tagEnum || "personal");
        pushTopLevel(p.item_key, bucket);
      }
      // Second pass: children, grouped by parent in position order.
      for (const p of sorted) {
        if (!p.parent_item_key) continue;
        if (!findEntry(p.item_key)) continue;
        (childrenByParent[p.parent_item_key] ??= []).push(p.item_key);
      }
    }

    // Append empty custom buckets by position.
    const haveCustom = new Set(orderSeen.filter((b) => b.startsWith("group:")));
    const emptyCustom = customGroups
      .filter((g) => !haveCustom.has(groupBucket(g.id)))
      .slice()
      .sort((a, b) => a.position - b.position);
    for (const g of emptyCustom) {
      const b = groupBucket(g.id);
      itemsByBucket[b] = itemsByBucket[b] ?? [];
      orderSeen.push(b);
    }

    setDraft({
      bucketOrder: orderSeen,
      itemsByBucket,
      childrenByParent,
      customGroups: customGroups.map((g) => ({ id: g.id, label: g.label, position: g.position })),
      startPageKey,
    });
    setError(null);
  }, [prefs, customGroups, defaultPinned, findEntry]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const totalPinned = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const b of draft.bucketOrder) n += draft.itemsByBucket[b]?.length ?? 0;
    for (const cks of Object.values(draft.childrenByParent)) n += cks.length;
    return n;
  }, [draft]);

  // "Available" pool: pinnable catalogue entries not already pinned anywhere.
  // Defensive dedupe by key — older catalogue rows occasionally surface twice
  // when an entity was upserted before the unique-index fix landed.
  const pool = useMemo<NavCatalogEntry[]>(() => {
    if (!draft) return [];
    const pinnedKeys = new Set<string>();
    for (const b of draft.bucketOrder) {
      for (const it of draft.itemsByBucket[b] ?? []) pinnedKeys.add(it.key);
    }
    for (const cks of Object.values(draft.childrenByParent)) {
      for (const ck of cks) pinnedKeys.add(ck);
    }
    const seen = new Set<string>();
    const out: NavCatalogEntry[] = [];
    for (const e of catalogue) {
      if (!e.pinnable || pinnedKeys.has(e.key) || seen.has(e.key)) continue;
      seen.add(e.key);
      out.push(e);
    }
    return out.sort((a, b) => {
      const ta = tagByEnum(a.tagEnum)?.defaultOrder ?? 99;
      const tb = tagByEnum(b.tagEnum)?.defaultOrder ?? 99;
      if (ta !== tb) return ta - tb;
      return a.defaultOrder - b.defaultOrder;
    });
  }, [draft, catalogue, tagByEnum]);

  if (!user || !draft) return null;

  const atCap = totalPinned >= MAX_PINNED;
  const groupsAtCap = draft.customGroups.length >= MAX_CUSTOM_GROUPS;

  const pin = (key: string) => {
    if (atCap) return;
    const entry = findEntry(key);
    if (!entry) return;
    const bucket = tagBucket(entry.tagEnum || "personal");
    const next = { ...draft };
    next.itemsByBucket = { ...draft.itemsByBucket };
    next.itemsByBucket[bucket] = [...(draft.itemsByBucket[bucket] ?? []), { key, parent: null }];
    next.bucketOrder = draft.bucketOrder.includes(bucket)
      ? draft.bucketOrder
      : [...draft.bucketOrder, bucket];
    setDraft(next);
  };

  const unpin = (key: string) => {
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
    };
    // Remove if it's a top-level item.
    let removed = false;
    for (const b of next.bucketOrder) {
      const list = next.itemsByBucket[b] ?? [];
      const idx = list.findIndex((it) => it.key === key);
      if (idx >= 0) {
        // Promote any of its children to the same bucket position.
        const orphans = next.childrenByParent[key] ?? [];
        const newList = list.filter((it) => it.key !== key);
        // Drop orphans entirely (unpin cascades).
        next.itemsByBucket[b] = newList;
        if (orphans.length > 0) delete next.childrenByParent[key];
        removed = true;
        break;
      }
    }
    if (!removed) {
      // Remove from a parent's children list.
      for (const parentKey of Object.keys(next.childrenByParent)) {
        const cks = next.childrenByParent[parentKey];
        if (cks.includes(key)) {
          next.childrenByParent[parentKey] = cks.filter((ck) => ck !== key);
          if (next.childrenByParent[parentKey].length === 0) delete next.childrenByParent[parentKey];
          break;
        }
      }
    }
    if (next.startPageKey === key) next.startPageKey = null;
    setDraft(next);
  };

  const toggleStart = (key: string) => {
    setDraft({ ...draft, startPageKey: draft.startPageKey === key ? null : key });
  };

  const addCustomGroup = () => {
    if (groupsAtCap) return;
    const id = nextSyntheticId();
    const used = new Set(draft.customGroups.map((g) => g.label.toLowerCase()));
    let n = 1;
    let label = `New group ${n}`;
    while (used.has(label.toLowerCase())) {
      n += 1;
      label = `New group ${n}`;
    }
    const position = draft.customGroups.length;
    const next: DraftState = {
      ...draft,
      customGroups: [...draft.customGroups, { id, label, position }],
      itemsByBucket: { ...draft.itemsByBucket, [groupBucket(id)]: [] },
      bucketOrder: [...draft.bucketOrder, groupBucket(id)],
    };
    setDraft(next);
  };

  const renameGroup = (id: string, label: string) => {
    const trimmed = label.trim().slice(0, MAX_GROUP_LABEL_LEN);
    if (!trimmed) return;
    const dup = draft.customGroups.some(
      (g) => g.id !== id && g.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (dup) {
      setError(`Group "${trimmed}" already exists.`);
      return;
    }
    setError(null);
    setDraft({
      ...draft,
      customGroups: draft.customGroups.map((g) => (g.id === id ? { ...g, label: trimmed } : g)),
    });
  };

  const removeGroup = (id: string) => {
    // Move all items in the group back to their tag bucket.
    const bucket = groupBucket(id);
    const items = draft.itemsByBucket[bucket] ?? [];
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      bucketOrder: draft.bucketOrder.filter((b) => b !== bucket),
      customGroups: draft.customGroups
        .filter((g) => g.id !== id)
        .map((g, i) => ({ ...g, position: i })),
    };
    delete next.itemsByBucket[bucket];
    for (const it of items) {
      const entry = findEntry(it.key);
      if (!entry) continue;
      const tb = tagBucket(entry.tagEnum || "personal");
      next.itemsByBucket[tb] = [...(next.itemsByBucket[tb] ?? []), it];
      if (!next.bucketOrder.includes(tb)) next.bucketOrder = [...next.bucketOrder, tb];
    }
    setDraft(next);
  };

  // Find which bucket / parent a given item key currently lives in.
  const findOwner = (key: string): { bucket: BucketKey | null; parent: string | null } => {
    for (const b of draft.bucketOrder) {
      if ((draft.itemsByBucket[b] ?? []).some((it) => it.key === key)) {
        return { bucket: b, parent: null };
      }
    }
    for (const [parentKey, cks] of Object.entries(draft.childrenByParent)) {
      if (cks.includes(key)) return { bucket: null, parent: parentKey };
    }
    return { bucket: null, parent: null };
  };

  const moveTopLevel = (key: string, fromBucket: BucketKey, toBucket: BucketKey, toIndex: number) => {
    const next: DraftState = { ...draft, itemsByBucket: { ...draft.itemsByBucket } };
    const fromList = (next.itemsByBucket[fromBucket] ?? []).filter((it) => it.key !== key);
    next.itemsByBucket[fromBucket] = fromList;
    const toList = (next.itemsByBucket[toBucket] ?? []).slice();
    const insertAt = Math.min(Math.max(toIndex, 0), toList.length);
    toList.splice(insertAt, 0, { key, parent: null });
    next.itemsByBucket[toBucket] = toList;
    if (!next.bucketOrder.includes(toBucket)) next.bucketOrder = [...next.bucketOrder, toBucket];
    setDraft(next);
  };

  const promoteChildToTopLevel = (key: string, fromParent: string, toBucket: BucketKey, toIndex: number) => {
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
    };
    const cks = (next.childrenByParent[fromParent] ?? []).filter((ck) => ck !== key);
    if (cks.length === 0) delete next.childrenByParent[fromParent];
    else next.childrenByParent[fromParent] = cks;
    const toList = (next.itemsByBucket[toBucket] ?? []).slice();
    const insertAt = Math.min(Math.max(toIndex, 0), toList.length);
    toList.splice(insertAt, 0, { key, parent: null });
    next.itemsByBucket[toBucket] = toList;
    setDraft(next);
  };

  const nestUnderParent = (key: string, parentKey: string) => {
    if (key === parentKey) return;
    const parentEntry = findEntry(parentKey);
    const childEntry = findEntry(key);
    if (!parentEntry || !childEntry) return;
    if (childEntry.kind !== "user_custom") return;
    // Parent must be top-level, not itself a child.
    const ownerOfParent = findOwner(parentKey);
    if (!ownerOfParent.bucket) return;
    // Cap on children per parent.
    const existing = draft.childrenByParent[parentKey] ?? [];
    if (existing.includes(key)) return;
    if (existing.length >= MAX_CHILDREN_PER_PARENT) {
      setError(`Maximum ${MAX_CHILDREN_PER_PARENT} sub-pages per page.`);
      return;
    }
    setError(null);
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
    };
    // Detach from current location.
    const owner = findOwner(key);
    if (owner.bucket) {
      next.itemsByBucket[owner.bucket] = (next.itemsByBucket[owner.bucket] ?? []).filter((it) => it.key !== key);
      // Also drop any of this key's own children (one-level nesting).
      const grandchildren = next.childrenByParent[key];
      if (grandchildren) {
        // Promote grandchildren back to the same bucket they would normally live in.
        for (const gck of grandchildren) {
          const ge = findEntry(gck);
          if (!ge) continue;
          const tb = tagBucket(ge.tagEnum || "personal");
          next.itemsByBucket[tb] = [...(next.itemsByBucket[tb] ?? []), { key: gck, parent: null }];
          if (!next.bucketOrder.includes(tb)) next.bucketOrder = [...next.bucketOrder, tb];
        }
        delete next.childrenByParent[key];
      }
    } else if (owner.parent) {
      const cks = (next.childrenByParent[owner.parent] ?? []).filter((ck) => ck !== key);
      if (cks.length === 0) delete next.childrenByParent[owner.parent];
      else next.childrenByParent[owner.parent] = cks;
    }
    next.childrenByParent[parentKey] = [...existing, key];
    setDraft(next);
  };

  const reorderChildren = (parentKey: string, fromIdx: number, toIdx: number) => {
    const list = draft.childrenByParent[parentKey] ?? [];
    if (fromIdx < 0 || toIdx < 0) return;
    setDraft({
      ...draft,
      childrenByParent: { ...draft.childrenByParent, [parentKey]: arrayMove(list, fromIdx, toIdx) },
    });
  };

  const reorderCustomBuckets = (fromBucket: BucketKey, toBucket: BucketKey) => {
    const fromIdx = draft.bucketOrder.indexOf(fromBucket);
    const toIdx = draft.bucketOrder.indexOf(toBucket);
    if (fromIdx < 0 || toIdx < 0) return;
    const newOrder = arrayMove(draft.bucketOrder, fromIdx, toIdx);
    // Recompute custom group positions based on the resulting order.
    const customOrder = newOrder.filter((b) => b.startsWith("group:"));
    const positionByGroupId = new Map<string, number>();
    customOrder.forEach((b, i) => positionByGroupId.set(b.slice("group:".length), i));
    setDraft({
      ...draft,
      bucketOrder: newOrder,
      customGroups: draft.customGroups.map((g) => ({
        ...g,
        position: positionByGroupId.get(g.id) ?? g.position,
      })),
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // 1) Custom group header reorder.
    if (activeId.startsWith("gheader:") && overId.startsWith("gheader:")) {
      const a = activeId.slice("gheader:".length);
      const o = overId.slice("gheader:".length);
      reorderCustomBuckets(a, o);
      return;
    }

    // 2) Item drag.
    if (!activeId.startsWith("item:")) return;
    const aKey = activeId.slice("item:".length);
    const aEntry = findEntry(aKey);
    if (!aEntry) return;
    const aOwner = findOwner(aKey);

    // 2a) Drop onto a parent's children droppable → nest under that parent.
    if (overId.startsWith("parent:")) {
      const parentKey = overId.slice("parent:".length);
      nestUnderParent(aKey, parentKey);
      return;
    }

    // 2b) Drop into an empty bucket droppable.
    if (overId.startsWith("bucket:")) {
      const targetBucket = overId.slice("bucket:".length);
      // Catalogue items are locked to their tag bucket.
      if (aEntry.kind !== "user_custom" && targetBucket !== tagBucket(aEntry.tagEnum || "personal")) return;
      // Custom items are not allowed in tag buckets either (per validator).
      // Actually: only user_custom may live in custom buckets; user_custom may live in their tag bucket too.
      if (aOwner.bucket === targetBucket && (draft.itemsByBucket[targetBucket] ?? []).length > 0) return;
      const toIndex = (draft.itemsByBucket[targetBucket] ?? []).length;
      if (aOwner.bucket) moveTopLevel(aKey, aOwner.bucket, targetBucket, toIndex);
      else if (aOwner.parent) promoteChildToTopLevel(aKey, aOwner.parent, targetBucket, toIndex);
      return;
    }

    // 2c) Drop onto another item.
    if (overId.startsWith("item:")) {
      const oKey = overId.slice("item:".length);
      const oOwner = findOwner(oKey);
      // Reorder within children of the same parent.
      if (aOwner.parent && aOwner.parent === oOwner.parent) {
        const list = draft.childrenByParent[aOwner.parent] ?? [];
        reorderChildren(aOwner.parent, list.indexOf(aKey), list.indexOf(oKey));
        return;
      }
      // Reorder within the same top-level bucket.
      if (aOwner.bucket && aOwner.bucket === oOwner.bucket) {
        const list = draft.itemsByBucket[aOwner.bucket] ?? [];
        const fromIdx = list.findIndex((it) => it.key === aKey);
        const toIdx = list.findIndex((it) => it.key === oKey);
        const next = { ...draft, itemsByBucket: { ...draft.itemsByBucket } };
        next.itemsByBucket[aOwner.bucket] = arrayMove(list, fromIdx, toIdx);
        setDraft(next);
        return;
      }
      // Cross-bucket move (custom item only — tag bucket items are locked).
      if (aOwner.bucket && oOwner.bucket && aOwner.bucket !== oOwner.bucket) {
        if (aEntry.kind !== "user_custom" && oOwner.bucket !== tagBucket(aEntry.tagEnum || "personal")) return;
        const toList = draft.itemsByBucket[oOwner.bucket] ?? [];
        const toIdx = toList.findIndex((it) => it.key === oKey);
        moveTopLevel(aKey, aOwner.bucket, oOwner.bucket, toIdx);
        return;
      }
      // Promote a child onto a top-level item in some bucket.
      if (aOwner.parent && oOwner.bucket) {
        if (aEntry.kind !== "user_custom" && oOwner.bucket !== tagBucket(aEntry.tagEnum || "personal")) return;
        const toList = draft.itemsByBucket[oOwner.bucket] ?? [];
        const toIdx = toList.findIndex((it) => it.key === oKey);
        promoteChildToTopLevel(aKey, aOwner.parent, oOwner.bucket, toIdx);
        return;
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Flatten: walk bucketOrder; for each top-level item emit it then its
      // children, all carrying a global running position.
      const pinned: PutPrefsPinnedRow[] = [];
      let pos = 0;
      for (const bucket of draft.bucketOrder) {
        const items = draft.itemsByBucket[bucket] ?? [];
        const isCustom = bucket.startsWith("group:");
        const groupId = isCustom ? bucket.slice("group:".length) : null;
        for (const it of items) {
          const entry = findEntry(it.key);
          if (!entry) continue;
          pinned.push({
            item_key: it.key,
            position: pos++,
            parent_item_key: null,
            group_id: entry.kind === "user_custom" ? groupId : null,
          });
          for (const ck of draft.childrenByParent[it.key] ?? []) {
            const childEntry = findEntry(ck);
            if (!childEntry) continue;
            pinned.push({
              item_key: ck,
              position: pos++,
              parent_item_key: it.key,
              group_id: null,
            });
          }
        }
      }
      const groups: PutPrefsGroupRow[] = draft.customGroups.map((g, i) => ({
        id: g.id,
        label: g.label,
        position: i,
      }));
      const body: PutPrefsBody = {
        pinned,
        start_page_key: draft.startPageKey,
        groups,
      };
      await save(body);
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

  // Build pool grouped by tag for display.
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

  // Resolve heading + custom flag for each bucket.
  const bucketHeading = (b: BucketKey): { heading: string; isCustom: boolean; groupId: string | null } => {
    if (b.startsWith("tag:")) {
      const tag = tagByEnum(b.slice("tag:".length));
      return { heading: tag?.label ?? b, isCustom: false, groupId: null };
    }
    const id = b.slice("group:".length);
    const g = draft.customGroups.find((g) => g.id === id);
    return { heading: g?.label ?? "(unnamed)", isCustom: true, groupId: id };
  };

  // Sortable ids for the group-header layer.
  const customBucketIds = draft.bucketOrder
    .filter((b) => b.startsWith("group:"))
    .map(groupHeaderDragId);

  return (
    <PageShell
      title="Navigation preferences"
      subtitle={`Pin up to ${MAX_PINNED} pages, group them, and pick a start page.`}
    >
      <div className="nav-prefs">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <section className="nav-prefs__pane" aria-label="Pinned">
            <header className="nav-prefs__pane-header">
              <h2 className="nav-prefs__pane-title">
                Pinned <span className="nav-prefs__count">{totalPinned}/{MAX_PINNED}</span>
              </h2>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={addCustomGroup}
                disabled={groupsAtCap}
                title={groupsAtCap ? `Cap of ${MAX_CUSTOM_GROUPS} custom groups reached` : "Add a custom group"}
              >
                + Custom group ({draft.customGroups.length}/{MAX_CUSTOM_GROUPS})
              </button>
            </header>
            {draft.bucketOrder.length === 0 ? (
              <p className="nav-prefs__empty">Nothing pinned — the sidebar will show defaults until you pin something.</p>
            ) : (
              <SortableContext items={customBucketIds} strategy={verticalListSortingStrategy}>
                {draft.bucketOrder.map((b) => {
                  const { heading, isCustom, groupId } = bucketHeading(b);
                  const items = draft.itemsByBucket[b] ?? [];
                  if (!isCustom && items.length === 0) return null;
                  return (
                    <BucketBlock
                      key={b}
                      bucketId={b}
                      heading={heading}
                      items={items}
                      childrenByParent={draft.childrenByParent}
                      startPageKey={draft.startPageKey}
                      findEntry={findEntry}
                      onUnpin={unpin}
                      onToggleStart={toggleStart}
                      onRename={isCustom && groupId ? (label) => renameGroup(groupId, label) : undefined}
                      onRemoveGroup={isCustom && groupId ? () => removeGroup(groupId) : undefined}
                      isCustom={isCustom}
                    />
                  );
                })}
              </SortableContext>
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
        </DndContext>

        <section className="nav-prefs__pane nav-prefs__pane--custom" aria-label="Your custom pages">
          <header className="nav-prefs__pane-header">
            <h2 className="nav-prefs__pane-title">Your custom pages</h2>
          </header>
          <p className="nav-prefs__empty">
            Coming soon — build your own pages from charts, reports, and widgets.
            Once created, drag them into a custom group or onto another page to nest.
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

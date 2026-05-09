"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MdOutlineSwapVert } from "react-icons/md";

export interface DevTab {
  key: string;
  label: string;
}

interface Props {
  tabs: readonly DevTab[];
  active: string;
  onChange: (key: string) => void;
  storageKey: string;
}

const DEFAULT_ORDER_KEY = (storageKey: string) => `${storageKey}.order`;

function loadOrder(storageKey: string, keys: string[]): string[] {
  try {
    const raw = localStorage.getItem(DEFAULT_ORDER_KEY(storageKey));
    if (!raw) return keys;
    const saved: string[] = JSON.parse(raw);
    // Merge: keep saved positions for known keys, append new keys at end.
    const liveSet = new Set(keys);
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const k of saved) {
      if (liveSet.has(k) && !seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
    for (const k of keys) {
      if (!seen.has(k)) ordered.push(k);
    }
    return ordered;
  } catch {
    return keys;
  }
}

function saveOrder(storageKey: string, order: string[]) {
  try {
    localStorage.setItem(DEFAULT_ORDER_KEY(storageKey), JSON.stringify(order));
  } catch {
    // Private mode / quota exceeded — non-fatal.
  }
}

// ---- Sortable tab (drag mode only) ----

interface SortableTabProps {
  tabKey: string;
  label: string;
  position: number;
  isActive: boolean;
  onClick: () => void;
}

function SortableTab({ tabKey, label, position, isActive, onClick }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tabKey });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      className={`dev-tab is-reorder${isActive ? " dev-tab--active" : ""}${isDragging ? " is-dragging" : ""}`}
      style={style}
      onClick={onClick}
    >
      <span className="dev-tabs__chip" aria-hidden="true">{position + 1}</span>
      <span>{label}</span>
    </button>
  );
}

// ---- Main component ----

export default function DevTabNav({ tabs, active, onChange, storageKey }: Props) {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const hasMountedRef = useRef(false);

  const [order, setOrder] = useState<string[]>(() =>
    loadOrder(storageKey, tabs.map((t) => t.key))
  );
  const [editMode, setEditMode] = useState(false);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  // Sync when tab catalog changes (unlikely for dev, but safe).
  useEffect(() => {
    setOrder((prev) => {
      const liveSet = new Set(tabs.map((t) => t.key));
      const filtered = prev.filter((k) => liveSet.has(k));
      const seen = new Set(filtered);
      for (const t of tabs) if (!seen.has(t.key)) filtered.push(t.key);
      return filtered;
    });
  }, [tabs]);

  // Measure indicator position using item refs (accurate across reordering).
  const measure = useCallback(() => {
    const nav = navRef.current;
    const btn = itemRefs.current.get(active);
    if (!nav || !btn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setIndicator({ left: btnRect.left - navRect.left, width: btnRect.width });
  }, [active]);

  useLayoutEffect(() => {
    measure();
    if (hasMountedRef.current) {
      setAnimate(true);
    } else {
      hasMountedRef.current = true;
    }
  }, [measure, active, order]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(nav);
    itemRefs.current.forEach((node) => { if (node) ro.observe(node); });
    return () => ro.disconnect();
  }, [measure, order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active: dragActive, over } = e;
    if (!over || dragActive.id === over.id) return;
    setOrder((prev) => {
      const oldIdx = prev.indexOf(dragActive.id as string);
      const newIdx = prev.indexOf(over.id as string);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      saveOrder(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const tabsByKey = new Map(tabs.map((t) => [t.key, t]));
  const orderedTabs = order.map((k) => tabsByKey.get(k)).filter(Boolean) as DevTab[];

  return (
    <nav
      ref={navRef}
      className={`dev-tabs${editMode ? " is-edit-mode" : ""}`}
    >
      {editMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={horizontalListSortingStrategy}>
            {orderedTabs.map((t, idx) => (
              <SortableTab
                key={t.key}
                tabKey={t.key}
                label={t.label}
                position={idx}
                isActive={t.key === active}
                onClick={() => onChange(t.key)}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        orderedTabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => { itemRefs.current.set(t.key, el); }}
            type="button"
            className={`dev-tab${t.key === active ? " dev-tab--active" : ""}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        ))
      )}

      {!editMode && indicator && (
        <span
          aria-hidden="true"
          className={`dev-tabs__indicator${animate ? " is-animated" : ""}`}
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}

      <button
        type="button"
        className={`dev-tabs__reorder-toggle${editMode ? " is-active" : ""}`}
        aria-label={editMode ? "Exit reorder mode" : "Reorder tabs"}
        aria-pressed={editMode}
        onClick={() => setEditMode((v) => !v)}
      >
        <MdOutlineSwapVert size={16} />
      </button>
    </nav>
  );
}

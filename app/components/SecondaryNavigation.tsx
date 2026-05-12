"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
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
import { usePathname } from "next/navigation";
import { MdOutlineSwapVert } from "react-icons/md";
import { apiSite as api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { useActiveNav } from "@/app/contexts/ActiveNavContext";

export interface SecondaryNavigationItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  disabled?: boolean;
  // Optional alphabetical key. Default ordering on a reorderable nav (no
  // saved order yet) sorts by sortKey ascending; falls back to a textual
  // form of `label` when absent. Plain strings are easier to compare than
  // ReactNode labels, so callers should pass it explicitly when label is
  // not a string.
  sortKey?: string;
}

interface Props<K extends string = string> {
  items: ReadonlyArray<SecondaryNavigationItem<K>>;
  active: K;
  onChange: (next: K) => void;
  ariaLabel: string;
  className?: string;
  // Stable string key identifying the page. Required when `reorderable` is
  // set; the per-user tab order is keyed by (user, subscription, pageId).
  pageId?: string;
  // Opt-in to reorder mode. When true, the far-right edit toggle renders
  // and (in edit mode) tabs become drag-sortable with numbered position
  // chips. Sliding indicator is suppressed during edit to avoid chasing.
  reorderable?: boolean;
  // Nav level. "l3" sticks directly below the L2 bar (lower z-index, no shadow, no gap).
  level?: "l2" | "l3";
}

interface TabOrderRow {
  tab_key: string;
  position: number;
}
interface TabOrderResp {
  page_id: string;
  items: TabOrderRow[];
}

const SAVE_DEBOUNCE_MS = 250;

// Derive a stable pageId from the URL path for any reorderable nav that
// doesn't pass one explicitly. The nav's *own* scope is the path minus
// the segment corresponding to its currently-active tab. Works at any
// depth (L2, L3, L4, ...): each layout's nav gets a unique stable key
// because every level above it stays in the prefix.
//
// Example:
//   path:        /workspace-settings/workspace-settings/custom-fields/work-items
//   active key:  "work_items"  → segment match "work-items"
//   derived id:  "workspace-settings__workspace-settings__custom-fields"
function derivePageIdFromPath(pathname: string, activeKey: string): string {
  const segs = pathname.split("/").filter(Boolean);
  const normalisedActive = activeKey.replace(/_/g, "-");
  // Strip the deepest segment matching the active tab key (handles
  // tab_key ↔ tab-key URL convention).
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] === normalisedActive || segs[i] === activeKey) {
      segs.splice(i, 1);
      break;
    }
  }
  return segs.join("__");
}

// Default ordering: by sortKey ascending; fallback to label text or key.
function labelText(label: React.ReactNode): string {
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  return "";
}

function defaultOrder<K extends string>(
  items: ReadonlyArray<SecondaryNavigationItem<K>>,
): K[] {
  return [...items]
    .sort((a, b) => {
      const ak = a.sortKey ?? labelText(a.label) ?? a.key;
      const bk = b.sortKey ?? labelText(b.label) ?? b.key;
      return ak.localeCompare(bk);
    })
    .map((i) => i.key);
}

// Apply a saved order to items. Saved keys not in the live catalog decay
// (ignored); live keys not in the saved order append at the end.
function applySavedOrder<K extends string>(
  items: ReadonlyArray<SecondaryNavigationItem<K>>,
  saved: ReadonlyArray<string>,
): K[] {
  const liveKeys = new Set(items.map((i) => i.key));
  const ordered: K[] = [];
  const seen = new Set<string>();
  for (const k of saved) {
    if (liveKeys.has(k as K) && !seen.has(k)) {
      ordered.push(k as K);
      seen.add(k);
    }
  }
  for (const i of items) {
    if (!seen.has(i.key)) ordered.push(i.key);
  }
  return ordered;
}

interface SortableTabProps {
  itemKey: string;
  label: React.ReactNode;
  position: number;
  isActive: boolean;
  disabled: boolean | undefined;
  onClick: () => void;
}

function SortableTab({
  itemKey,
  label,
  position,
  isActive,
  disabled,
  onClick,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemKey });

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
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      className={`navigation__item is-reorder${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
      style={style}
      onClick={onClick}
    >
      <span className="navigation__chip" aria-hidden="true">{position + 1}</span>
      <span className="navigation__label">{label}</span>
    </button>
  );
}

export default function SecondaryNavigation<K extends string = string>({
  items,
  active,
  onChange,
  ariaLabel,
  className,
  pageId: explicitPageId,
  reorderable = false,
  level,
}: Props<K>) {
  // Auto-derive a stable pageId from the URL path when none is supplied.
  // This makes the reorderable nav self-building at any depth (L2/L3/L4/…)
  // without each layout having to hand-pick a unique key. Explicit
  // pageIds still take precedence for layouts with bespoke keys.
  const pathname = usePathname() ?? "";
  const pageId = useMemo(
    () => explicitPageId ?? (reorderable ? derivePageIdFromPath(pathname, String(active)) : undefined),
    [explicitPageId, reorderable, pathname, active],
  );
  const cls = `navigation secondary tabular${className ? ` ${className}` : ""}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<K, HTMLButtonElement | null>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const hasMountedRef = useRef(false);
  const [animate, setAnimate] = useState(false);

  // Reorder state. `order` is the live render order of keys; when a saved
  // order is fetched it overlays the default. Default = alphabetical by
  // sortKey/label.
  const [order, setOrder] = useState<K[]>(() =>
    reorderable ? defaultOrder(items) : items.map((i) => i.key),
  );
  const [editMode, setEditMode] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOrderRef = useRef<K[] | null>(null);

  // Hydrate saved order from server once auth has finished bootstrapping.
  // Without the auth gate, the GET races AuthContext's token restore and
  // hits a 401 before the silent-refresh path is wired up.
  const { user, loading: authLoading } = useAuth();
  useEffect(() => {
    if (!reorderable || !pageId) return;
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api<TabOrderResp>(`/user/tab-order/${encodeURIComponent(pageId)}`);
        if (cancelled) return;
        if (resp.items.length > 0) {
          setOrder(applySavedOrder(items, resp.items.map((r) => r.tab_key)));
        }
      } catch {
        // Silent: read failure leaves the alphabetical default in place.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetch only when pageId / auth state changes; live items changes
    // apply via the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderable, pageId, authLoading, user?.id]);

  // Keep `order` in sync when items add/remove (e.g. perms-driven catalog
  // change). Preserve known positions; append new keys, drop missing ones.
  useEffect(() => {
    if (!reorderable) {
      setOrder(items.map((i) => i.key));
      return;
    }
    setOrder((prev) => {
      const liveKeys = new Set(items.map((i) => i.key));
      const filtered = prev.filter((k) => liveKeys.has(k));
      const seen = new Set(filtered);
      for (const i of items) if (!seen.has(i.key)) filtered.push(i.key);
      return filtered;
    });
  }, [items, reorderable]);

  // Build a render list using `order` against the items map.
  const itemsByKey = useMemo(() => {
    const m = new Map<K, SecondaryNavigationItem<K>>();
    for (const i of items) m.set(i.key, i);
    return m;
  }, [items]);

  // Publish active label up to <ActiveNavContext> so <PageDescription>
  // can default its title to the deepest active nav label. The publish
  // level is derived from the URL depth (number of path segments) so
  // multiple navs at the same `level` prop but different depths each
  // get their own slot in the stack.
  const { publish } = useActiveNav();
  const navDepth = useMemo(() => pathname.split("/").filter(Boolean).length, [pathname]);
  useEffect(() => {
    const activeItem = itemsByKey.get(active);
    const label = activeItem ? labelText(activeItem.label) : null;
    publish(navDepth, label);
    return () => publish(navDepth, null);
  }, [active, itemsByKey, publish, navDepth]);

  const orderedItems = useMemo(() => {
    return order.map((k) => itemsByKey.get(k)).filter(Boolean) as SecondaryNavigationItem<K>[];
  }, [order, itemsByKey]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const node = itemRefs.current.get(active);
    if (!container || !node) return;
    const cRect = container.getBoundingClientRect();
    const nRect = node.getBoundingClientRect();
    setIndicator({ left: nRect.left - cRect.left, width: nRect.width });
  }, [active]);

  useLayoutEffect(() => {
    measure();
    if (hasMountedRef.current) {
      setAnimate(true);
    } else {
      hasMountedRef.current = true;
    }
  }, [measure, active, orderedItems]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    itemRefs.current.forEach((node) => {
      if (node) ro.observe(node);
    });
    return () => ro.disconnect();
  }, [measure, orderedItems]);

  // Debounced save. Successive drops within 250ms collapse into one PUT.
  const scheduleSave = useCallback(
    (next: K[]) => {
      if (!pageId) return;
      pendingOrderRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const toSave = pendingOrderRef.current;
        pendingOrderRef.current = null;
        saveTimerRef.current = null;
        if (!toSave) return;
        const body = {
          items: toSave.map((k, idx) => ({ tab_key: k, position: idx })),
        };
        api(`/user/tab-order/${encodeURIComponent(pageId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }).catch(() => {
          // Silent: a failed save leaves the local order intact; next drag
          // will retry. A future story can surface an error toast.
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [pageId],
  );

  // Flush pending save on unmount so the last drop isn't dropped.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const toSave = pendingOrderRef.current;
        if (toSave && pageId) {
          const body = {
            items: toSave.map((k, idx) => ({ tab_key: k, position: idx })),
          };
          // Best-effort flush; ignore errors.
          api(`/user/tab-order/${encodeURIComponent(pageId)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          }).catch(() => {});
        }
      }
    };
  }, [pageId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active: dragActive, over } = e;
      if (!over || dragActive.id === over.id) return;
      setOrder((prev) => {
        const oldIdx = prev.indexOf(dragActive.id as K);
        const newIdx = prev.indexOf(over.id as K);
        if (oldIdx < 0 || newIdx < 0) return prev;
        const next = arrayMove(prev, oldIdx, newIdx);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const showReorderToggle = reorderable && !!pageId;

  return (
    <div className={`ui-sticky-subheader${level === "l3" ? " ui-sticky-subheader--l3" : ""}`}>
    <div
      ref={containerRef}
      className={`${cls}${editMode ? " is-edit-mode" : ""}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {editMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order as string[]} strategy={horizontalListSortingStrategy}>
            {orderedItems.map((item, idx) => (
              <SortableTab
                key={item.key}
                itemKey={item.key}
                label={item.label}
                position={idx}
                isActive={item.key === active}
                disabled={item.disabled}
                onClick={() => onChange(item.key)}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        orderedItems.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current.set(item.key, el);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={item.disabled}
              className={`navigation__item${isActive ? " is-active" : ""}`}
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </button>
          );
        })
      )}

      {!editMode && indicator && (
        <span
          aria-hidden="true"
          className={`navigation__indicator${animate ? " is-animated" : ""}`}
          style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }}
        />
      )}

      {showReorderToggle && (
        <button
          type="button"
          className={`navigation__reorder-toggle${editMode ? " is-active" : ""}`}
          aria-label={editMode ? "Exit reorder mode" : "Reorder tabs"}
          aria-pressed={editMode}
          onClick={() => setEditMode((v) => !v)}
        >
          <MdOutlineSwapVert size={16} />
        </button>
      )}
    </div>
    </div>
  );
}


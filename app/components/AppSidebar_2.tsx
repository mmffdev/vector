"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { useNavPrefs, type NavCatalogEntry } from "@/app/contexts/NavPrefsContext";
import NavManageModal from "@/app/components/NavManageModal";

const Icon = ({ d, d2 }: { d: string; d2?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {d2 && <path d={d2} />}
  </svg>
);

function IconFor({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "home":      return <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "eye":       return <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" d2="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "briefcase": return <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />;
    case "star":      return <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;
    case "clipboard": return <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />;
    case "list":      return <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
    case "warning":   return <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" d2="M12 9v4M12 17h.01" />;
    case "cog":       return <Icon d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    case "wrench":    return <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    default:          return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />;
  }
}

const STORAGE_KEY = "sidebar-collapsed";

function SortableSidebarItem({
  item,
  pathname,
  open,
}: {
  item: NavCatalogEntry;
  pathname: string;
  open: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="sidebar-item-wrap">
      <button
        type="button"
        className="sidebar-item__drag"
        aria-label={`Reorder ${item.label}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <svg width="12" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <Link
        href={item.href}
        className={`sidebar-item ${pathname.includes(item.href) ? "active" : ""}`}
        title={!open ? item.label : undefined}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <IconFor iconKey={item.icon} />
        <span className="sidebar-item__label">{item.label}</span>
      </Link>
    </div>
  );
}

export default function AppSidebar_2() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { prefs, save, catalogue, findEntry, defaultPinned } = useNavPrefs();
  const [collapsed, setCollapsed] = useState(false);
  const [peeked, setPeeked] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-sidebar-collapsed", collapsed ? "true" : "false");
    localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.setAttribute("data-sidebar-peeked", peeked ? "true" : "false");
  }, [peeked]);

  const pinnedKeys = useMemo(
    () => prefs.slice().sort((a, b) => a.position - b.position).map((p) => p.item_key),
    [prefs],
  );

  // Catalogue arrives role-filtered from the server, so no need to re-gate
  // by role on the client. Unknown pinned keys (e.g. a catalogue entry
  // retired since the user pinned it) drop out silently.
  const baseRenderedItems = useMemo<NavCatalogEntry[]>(() => {
    if (catalogue.length === 0) return [];
    if (pinnedKeys.length === 0) return defaultPinned;
    return pinnedKeys
      .map((k) => findEntry(k))
      .filter((e): e is NavCatalogEntry => !!e);
  }, [catalogue, pinnedKeys, defaultPinned, findEntry]);

  const renderedItems = useMemo(() => {
    if (!draftOrder) return baseRenderedItems;
    const byKey = new Map(baseRenderedItems.map((i) => [i.key, i]));
    return draftOrder
      .map((k) => byKey.get(k))
      .filter((i): i is NavCatalogEntry => !!i);
  }, [baseRenderedItems, draftOrder]);

  // Server has already filtered by role, so we just drop pinnable entries.
  const visibleDevItems = useMemo(
    () => catalogue.filter((e) => !e.pinnable),
    [catalogue],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!user) return null;

  const open = !collapsed || peeked;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = draftOrder ?? baseRenderedItems.map((i) => i.key);
    const from = current.indexOf(String(active.id));
    const to = current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setDraftOrder(arrayMove(current, from, to));
  };

  const acceptOrder = async () => {
    if (!draftOrder) return;
    setCommitting(true);
    try {
      const startKey = prefs.find((p) => p.is_start_page)?.item_key ?? null;
      await save({
        pinned: draftOrder.map((k, i) => ({ item_key: k, position: i })),
        start_page_key: startKey,
      });
      setDraftOrder(null);
    } finally {
      setCommitting(false);
    }
  };

  const undoOrder = () => setDraftOrder(null);

  return (
    <nav
      id="app-sidebar-nav"
      aria-label="Primary"
      className="app-sidebar-container"
      data-collapsed={collapsed ? "true" : "false"}
      data-open={open ? "true" : "false"}
      onMouseEnter={() => { if (collapsed) setPeeked(true); }}
      onMouseLeave={() => { if (peeked) setPeeked(false); }}
      onFocus={() => { if (collapsed) setPeeked(true); }}
      onBlur={(e) => { if (peeked && !e.currentTarget.contains(e.relatedTarget as Node)) setPeeked(false); }}
    >
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={() => {
          setCollapsed((c) => !c);
          setPeeked(false);
        }}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar-nav"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={renderedItems.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          {renderedItems.map((item) => (
            <SortableSidebarItem key={item.key} item={item} pathname={pathname} open={open} />
          ))}
        </SortableContext>
      </DndContext>

      {draftOrder && (
        <div className="sidebar-reorder-banner" role="status" aria-live="polite">
          <p className="sidebar-reorder-banner__text">You have changed the order of your navigation.</p>
          <div className="sidebar-reorder-banner__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={acceptOrder}
              disabled={committing}
            >{committing ? "Saving…" : "Accept"}</button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={undoOrder}
              disabled={committing}
            >Undo</button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="sidebar-item sidebar-item--button"
        onClick={() => setManageOpen(true)}
        title={!open ? "Manage navigation" : undefined}
        aria-label="Manage navigation"
      >
        <IconFor iconKey="cog" />
        <span className="sidebar-item__label">Manage nav</span>
      </button>

      {visibleDevItems.length > 0 && (
        <div className="sidebar-dev-group">
          {visibleDevItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`sidebar-item ${pathname.includes(item.href) ? "active" : ""}`}
              title={!open ? item.label : undefined}
            >
              <IconFor iconKey={item.icon} />
              <span className="sidebar-item__label">{item.label}</span>
            </Link>
          ))}
        </div>
      )}

      <NavManageModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </nav>
  );
}

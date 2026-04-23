"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  useNavPrefs,
  type NavCatalogEntry,
  type NavTagGroup,
  type NavCustomGroup,
} from "@/app/contexts/NavPrefsContext";

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
    case "pin":       return <Icon d="M12 17v5M9 10.76A2 2 0 0 1 8 9V4h8v5a2 2 0 0 1-1 1.76l-1 .58a2 2 0 0 0-1 1.76V17H10v-3.9a2 2 0 0 0-1-1.76z" />;
    case "folder":    return <Icon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />;
    case "package":   return <Icon d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />;
    case "pencil":    return <Icon d="M12 20h9" d2="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    default:          return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />;
  }
}

const STORAGE_KEY = "sidebar-collapsed";

const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

// Render-only item. Hover-flyout if it has children.
function SidebarItem({
  item,
  pathname,
  open,
  childItems,
}: {
  item: NavCatalogEntry;
  pathname: string;
  open: boolean;
  childItems: NavCatalogEntry[];
}) {
  const hasChildren = childItems.length > 0;
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  const label = hasChildren ? `${item.label} (${childItems.length})` : item.label;

  return (
    <div
      className={`sidebar-item-wrap ${hasChildren ? "sidebar-item-wrap--has-flyout" : ""}`}
      onMouseEnter={() => hasChildren && setFlyoutOpen(true)}
      onMouseLeave={() => hasChildren && setFlyoutOpen(false)}
      onFocus={() => hasChildren && setFlyoutOpen(true)}
      onBlur={(e) => {
        if (hasChildren && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setFlyoutOpen(false);
        }
      }}
    >
      <Link
        href={item.href}
        className={`sidebar-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
        title={!open ? label : undefined}
      >
        <IconFor iconKey={item.icon} />
        <span className="sidebar-item__label">{label}</span>
      </Link>

      {hasChildren && flyoutOpen && (
        <div className="sidebar-flyout" role="menu" aria-label={`${item.label} sub-pages`}>
          <div className="sidebar-flyout__heading">{item.label}</div>
          {childItems.map((child) => (
            <Link
              key={child.key}
              href={child.href}
              className={`sidebar-item sidebar-item--flyout ${isActivePath(pathname, child.href) ? "active" : ""}`}
              role="menuitem"
            >
              <IconFor iconKey={child.icon} />
              <span className="sidebar-item__label">{child.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppSidebar_2() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { prefs, customGroups, catalogue, findEntry, defaultPinned, tagByEnum } = useNavPrefs();
  const [collapsed, setCollapsed] = useState(false);
  const [peeked, setPeeked] = useState(false);

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

  // Sort prefs by position once; resolve catalogue entries.
  const sortedPrefs = useMemo(
    () => prefs.slice().sort((a, b) => a.position - b.position),
    [prefs],
  );

  // Index children of each parent_item_key, in position order.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, NavCatalogEntry[]>();
    for (const p of sortedPrefs) {
      if (!p.parent_item_key) continue;
      const e = findEntry(p.item_key);
      if (!e) continue;
      const list = map.get(p.parent_item_key) ?? [];
      list.push(e);
      map.set(p.parent_item_key, list);
    }
    return map;
  }, [sortedPrefs, findEntry]);

  // Top-level items (no parent), with their resolved catalogue entry,
  // pref row (for group_id), and child list.
  type Rendered = {
    entry: NavCatalogEntry;
    groupId: string | null; // custom group id or null
    children: NavCatalogEntry[];
  };

  const baseRendered: Rendered[] = useMemo(() => {
    if (catalogue.length === 0) return [];
    if (sortedPrefs.length === 0) {
      // Fallback to defaults when user has no prefs at all.
      return defaultPinned.map((entry) => ({
        entry,
        groupId: null,
        children: [],
      }));
    }
    const out: Rendered[] = [];
    for (const p of sortedPrefs) {
      if (p.parent_item_key) continue;
      const entry = findEntry(p.item_key);
      if (!entry) continue;
      out.push({
        entry,
        groupId: p.group_id ?? null,
        children: childrenByParent.get(p.item_key) ?? [],
      });
    }
    return out;
  }, [catalogue, sortedPrefs, defaultPinned, findEntry, childrenByParent]);

  // Build the render groups: system tag groups + custom groups, in
  // first-appearance order based on top-level prefs. Custom groups
  // are placed by their position relative to system groups via the
  // first item that references them (custom groups have no anchor
  // otherwise). If a custom group has no items it still renders as
  // an empty header — so empty custom groups are visible to the user.
  type RenderGroup =
    | { kind: "tag"; tag: NavTagGroup; items: Rendered[] }
    | { kind: "custom"; group: NavCustomGroup; items: Rendered[] };

  const renderGroups: RenderGroup[] = useMemo(() => {
    const tagBuckets: Record<string, Rendered[]> = {};
    const customBuckets: Record<string, Rendered[]> = {};
    const order: Array<{ kind: "tag" | "custom"; key: string }> = [];

    const note = (kind: "tag" | "custom", key: string) => {
      if (!order.find((o) => o.kind === kind && o.key === key)) {
        order.push({ kind, key });
      }
    };

    for (const r of baseRendered) {
      if (r.groupId) {
        (customBuckets[r.groupId] ??= []).push(r);
        note("custom", r.groupId);
      } else {
        const tagEnum = r.entry.tagEnum || "personal";
        (tagBuckets[tagEnum] ??= []).push(r);
        note("tag", tagEnum);
      }
    }

    // Append any custom groups that have no items yet, sorted by their own position.
    const seenCustom = new Set(order.filter((o) => o.kind === "custom").map((o) => o.key));
    const emptyCustom = customGroups
      .filter((g) => !seenCustom.has(g.id))
      .sort((a, b) => a.position - b.position);
    for (const g of emptyCustom) order.push({ kind: "custom", key: g.id });

    const out: RenderGroup[] = [];
    for (const o of order) {
      if (o.kind === "tag") {
        const tag = tagByEnum(o.key);
        if (!tag) continue;
        out.push({ kind: "tag", tag, items: tagBuckets[o.key] ?? [] });
      } else {
        const group = customGroups.find((g) => g.id === o.key);
        if (!group) continue;
        out.push({ kind: "custom", group, items: customBuckets[o.key] ?? [] });
      }
    }
    return out;
  }, [baseRendered, customGroups, tagByEnum]);

  const visibleDevItems = useMemo(
    () => catalogue.filter((e) => !e.pinnable),
    [catalogue],
  );

  if (!user) return null;

  const open = !collapsed || peeked;

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
      <div className="sidebar-toolbar">
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
        <Link
          href="/preferences/navigation"
          className="sidebar-edit-toggle"
          title="Edit navigation"
          aria-label="Edit navigation"
        >
          <IconFor iconKey="pencil" />
        </Link>
      </div>

      {renderGroups.map((g) => {
        if (g.items.length === 0 && g.kind === "tag") return null;
        const heading = g.kind === "tag" ? g.tag.label : g.group.label;
        const key = g.kind === "tag" ? `tag:${g.tag.enum}` : `custom:${g.group.id}`;
        return (
          <div key={key} className={`sidebar-group ${g.kind === "custom" ? "sidebar-group--custom" : ""}`}>
            <div className="sidebar-group__heading-row">
              <span className="sidebar-group__heading">{heading}</span>
            </div>
            {g.items.map((r) => (
              <SidebarItem
                key={r.entry.key}
                item={r.entry}
                pathname={pathname}
                open={open}
                childItems={r.children}
              />
            ))}
          </div>
        );
      })}

      <Link
        href="/preferences/navigation"
        className="sidebar-item"
        title={!open ? "Manage navigation" : undefined}
        aria-label="Manage navigation"
      >
        <IconFor iconKey="cog" />
        <span className="sidebar-item__label">Manage nav</span>
      </Link>

      {visibleDevItems.length > 0 && (
        <div className="sidebar-dev-group">
          {visibleDevItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`sidebar-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
              title={!open ? item.label : undefined}
            >
              <IconFor iconKey={item.icon} />
              <span className="sidebar-item__label">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

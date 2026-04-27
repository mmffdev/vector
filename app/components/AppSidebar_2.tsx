"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  useNavPrefs,
  type NavCatalogEntry,
  type NavTagGroup,
  type NavCustomGroup,
} from "@/app/contexts/NavPrefsContext";
import { NavIcon as IconFor } from "@/app/components/NavIcon";
import ProfileBar from "@/app/components/ProfileBar";

const STORAGE_KEY = "sidebar-collapsed";

const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

// Render-only item. Inline accordion when sidebar is open; hover-flyout when collapsed.
function SidebarItem({
  item,
  iconKey,
  pathname,
  open,
  childItems,
  childIconByKey,
}: {
  item: NavCatalogEntry;
  iconKey: string;
  pathname: string;
  open: boolean;
  childItems: NavCatalogEntry[];
  childIconByKey: Record<string, string>;
}) {
  const hasChildren = childItems.length > 0;
  const isAnyChildActive = childItems.some((c) => isActivePath(pathname, c.href));

  // Hover-driven expand — always open when a child is active
  const [hovered, setHovered] = useState(false);
  const expanded = isAnyChildActive || hovered;

  // Flyout state (collapsed sidebar only)
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!flyoutOpen || !rowRef.current) return;
    const update = () => {
      const r = rowRef.current?.getBoundingClientRect();
      if (r) setFlyoutPos({ top: r.top - 1, left: r.right });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [flyoutOpen]);

  // Collapsed sidebar — hover flyout (icon-only mode, no room for inline children)
  if (!open && hasChildren) {
    return (
      <div
        className="sidebar-item-wrap sidebar-item-wrap--has-flyout"
        onMouseEnter={() => setFlyoutOpen(true)}
        onMouseLeave={() => setFlyoutOpen(false)}
        onFocus={() => setFlyoutOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setFlyoutOpen(false);
        }}
      >
        <Link
          ref={rowRef}
          href={item.href}
          className={`sidebar-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
          title={item.label}
        >
          <IconFor iconKey={iconKey} />
          <span className="sidebar-item__label">{item.label}</span>
        </Link>
        {flyoutOpen && flyoutPos && (
          <div
            className="sidebar-flyout"
            role="menu"
            aria-label={`${item.label} sub-pages`}
            style={{ top: flyoutPos.top, left: flyoutPos.left }}
          >
            {childItems.map((child) => (
              <Link
                key={child.key}
                href={child.href}
                className={`sidebar-item sidebar-item--flyout ${isActivePath(pathname, child.href) ? "active" : ""}`}
                role="menuitem"
              >
                <IconFor iconKey={childIconByKey[child.key] ?? child.icon} />
                <span className="sidebar-item__label">{child.label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Expanded sidebar — hover to reveal inline children
  return (
    <div
      className="sidebar-item-wrap"
      onMouseEnter={() => hasChildren && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={item.href}
        className={`sidebar-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
        title={!open ? item.label : undefined}
      >
        <IconFor iconKey={iconKey} />
        <span className="sidebar-item__label">{item.label}</span>
      </Link>

      {hasChildren && expanded && (
        <div className="sidebar-children">
          {childItems.map((child) => (
            <Link
              key={child.key}
              href={child.href}
              className={`sidebar-item sidebar-item--child ${isActivePath(pathname, child.href) ? "active" : ""}`}
            >
              <IconFor iconKey={childIconByKey[child.key] ?? child.icon} />
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
  const { prefs, customGroups, catalogue, findEntry, defaultPinned, tags } = useNavPrefs();
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

  // Per-item icon overrides from user_nav_prefs.icon_override.
  const iconOverrideByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of prefs) if (p.icon_override) m[p.item_key] = p.icon_override;
    return m;
  }, [prefs]);

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

    for (const r of baseRendered) {
      if (r.groupId) {
        (customBuckets[r.groupId] ??= []).push(r);
      } else {
        const tagEnum = r.entry.tagEnum || "personal";
        (tagBuckets[tagEnum] ??= []).push(r);
      }
    }

    // System tag groups always render in canonical tag default_order — not
    // first-appearance order — so the group sequence is fixed for all users:
    // Personal → Admin Settings → Planning → Strategic (per page_tags.default_order).
    // Tags with no items are omitted. admin_menu tags (avatar-only) are excluded.
    const sortedTags = [...tags]
      .filter((t) => !t.isAdminMenu)
      .sort((a, b) => a.defaultOrder - b.defaultOrder);

    // Custom groups interleave after the tag group whose last item precedes
    // the first custom-group item in position order. For simplicity, append
    // all custom groups after system tag groups in their own position order.
    const out: RenderGroup[] = [];
    for (const tag of sortedTags) {
      const items = tagBuckets[tag.enum];
      if (!items || items.length === 0) continue;
      out.push({ kind: "tag", tag, items });
    }

    const allCustom = customGroups.slice().sort((a, b) => a.position - b.position);
    for (const group of allCustom) {
      out.push({ kind: "custom", group, items: customBuckets[group.id] ?? [] });
    }

    return out;
  }, [baseRendered, customGroups, tags]);

  const visibleDevItems = useMemo(
    () => catalogue.filter((e) => !e.pinnable),
    [catalogue],
  );

  if (!user) return null;

  const open = !collapsed || peeked;

  const workspaceName = user.subscription_id === "00000000-0000-0000-0000-000000000001"
    ? "MMFFDev"
    : user.subscription_id.slice(0, 8).toUpperCase();
  const initials = workspaceName.slice(0, 2).toUpperCase();

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
      <div className="sidebar-brand" aria-label="Workspace">
        <div className="sidebar-brand__logo" aria-hidden="true">{initials}</div>
        <div className="sidebar-brand__label">
          <small>Agency</small>
          <strong>{workspaceName}</strong>
        </div>
      </div>

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

      {open && <ProfileBar />}

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
                iconKey={iconOverrideByKey[r.entry.key] ?? r.entry.icon}
                pathname={pathname}
                open={open}
                childItems={r.children}
                childIconByKey={iconOverrideByKey}
              />
            ))}
          </div>
        );
      })}

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

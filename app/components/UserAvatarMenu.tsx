"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs, type NavCatalogEntry } from "@/app/contexts/NavPrefsContext";

function Icon({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  );
}

function IconFor({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "home":      return <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "briefcase": return <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />;
    case "cog":       return <Icon d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    case "wrench":    return <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    default:          return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />;
  }
}

function LogoutIcon() {
  return (
    <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" d2="M16 17l5-5-5-5M21 12H9" />
  );
}

export default function UserAvatarMenu() {
  const { user, logout } = useAuth();
  const { catalogue, tags } = useNavPrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Group pages whose tag is flagged is_admin_menu, role-filtered by the
  // server's catalogue. Ordering: tag.defaultOrder, then entry.defaultOrder.
  const groupedAdminPages = useMemo(() => {
    const adminTagEnums = new Set(tags.filter((t) => t.isAdminMenu).map((t) => t.enum));
    const byTag = new Map<string, NavCatalogEntry[]>();
    for (const entry of catalogue) {
      if (!adminTagEnums.has(entry.tagEnum)) continue;
      const list = byTag.get(entry.tagEnum) ?? [];
      list.push(entry);
      byTag.set(entry.tagEnum, list);
    }
    const orderedTags = tags
      .filter((t) => t.isAdminMenu && byTag.has(t.enum))
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    return orderedTags.map((tag) => ({
      tag,
      items: (byTag.get(tag.enum) ?? []).slice().sort((a, b) => a.defaultOrder - b.defaultOrder),
    }));
  }, [catalogue, tags]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="avatar-menu" ref={rootRef}>
      <button
        type="button"
        className="app-header-wrapper__avatar"
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initials}
      </button>
      {open && (
        <div className="avatar-menu__panel" role="menu" aria-label="Account menu">
          <div className="avatar-menu__header">
            <div className="avatar-menu__email">{user.email}</div>
            <div className="avatar-menu__role">{user.role}</div>
          </div>
          {groupedAdminPages.map(({ tag, items }) => (
            <div key={tag.enum} className="avatar-menu__group">
              <div className="avatar-menu__group-heading">{tag.label}</div>
              {items.map((entry) => (
                <Link
                  key={entry.key}
                  href={entry.href}
                  className="sidebar-item avatar-menu__item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <IconFor iconKey={entry.icon} />
                  <span className="sidebar-item__label">{entry.label}</span>
                </Link>
              ))}
            </div>
          ))}
          <div className="avatar-menu__group avatar-menu__group--footer">
            <button
              type="button"
              className="sidebar-item sidebar-item--button avatar-menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              <LogoutIcon />
              <span className="sidebar-item__label">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

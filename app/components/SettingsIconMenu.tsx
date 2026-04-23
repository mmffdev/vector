"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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

const ADMIN_SETTINGS_TAG = "admin_settings";

export default function SettingsIconMenu() {
  const { catalogue, tags } = useNavPrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Only the admin_settings group (Workspace + Portfolio settings).
  // Role-filtering is already applied server-side on the catalogue.
  const grouped = useMemo(() => {
    const tag = tags.find((t) => t.enum === ADMIN_SETTINGS_TAG);
    if (!tag) return null;
    const items: NavCatalogEntry[] = catalogue
      .filter((entry) => entry.tagEnum === ADMIN_SETTINGS_TAG)
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    if (items.length === 0) return null;
    return { tag, items };
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

  if (!grouped) return null;

  return (
    <div className="avatar-menu" ref={rootRef}>
      <button
        type="button"
        className="app-header-wrapper__icon-btn"
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="avatar-menu__panel" role="menu" aria-label="Settings menu">
          <div className="avatar-menu__group">
            <div className="avatar-menu__group-heading">{grouped.tag.label}</div>
            {grouped.items.map((entry) => (
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
        </div>
      )}
    </div>
  );
}

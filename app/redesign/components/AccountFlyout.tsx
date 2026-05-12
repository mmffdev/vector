"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs, type NavCatalogEntry } from "@/app/contexts/NavPrefsContext";
import { useTheme } from "@/app/hooks/useTheme";

function MiniIcon({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  );
}

function IconFor({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "home":
      return <MiniIcon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "briefcase":
      return <MiniIcon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />;
    case "cog":
      return <MiniIcon d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    case "wrench":
      return <MiniIcon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    default:
      return <MiniIcon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />;
  }
}

export default function AccountFlyout() {
  const { user, logout } = useAuth();
  const { catalogue, tags } = useNavPrefs();
  const { theme, toggle, mounted } = useTheme();
  const pathname = usePathname() ?? "";

  const groupedAdminPages = useMemo(() => {
    const adminTagEnums = new Set(
      tags.filter((t) => t.isAdminMenu && t.enum !== "admin_settings").map((t) => t.enum),
    );
    const byTag = new Map<string, NavCatalogEntry[]>();
    for (const entry of catalogue) {
      if (!adminTagEnums.has(entry.tagEnum)) continue;
      const list = byTag.get(entry.tagEnum) ?? [];
      list.push(entry);
      byTag.set(entry.tagEnum, list);
    }
    return tags
      .filter((t) => t.isAdminMenu && t.enum !== "admin_settings" && byTag.has(t.enum))
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((tag) => ({
        tag,
        items: (byTag.get(tag.enum) ?? []).slice().sort((a, b) => a.defaultOrder - b.defaultOrder),
      }));
  }, [catalogue, tags]);

  if (!user) return <aside className="rd-flyout" aria-label="Account" />;

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="rd-flyout" aria-label="Account">
      <h3 className="rd-flyout__title">Account</h3>

      <div className="rd-flyout__account-card">
        <div className="rd-flyout__account-email">{user.email}</div>
        <div className="rd-flyout__account-role">{user.role.label}</div>
      </div>

      <div className="rd-flyout__list">
        {groupedAdminPages.map(({ tag, items }) => (
          <div key={tag.enum} className="rd-flyout__group">
            <div className="rd-flyout__group-label">{tag.label}</div>
            {items.map((entry) => (
              <Link
                key={entry.key}
                href={entry.href}
                className={`rd-flyout__row${isActivePage(entry.href) ? " is-active" : ""}`}
                aria-current={isActivePage(entry.href) ? "page" : undefined}
              >
                <IconFor iconKey={entry.icon} />
                <span className="rd-flyout__row-label">{entry.label}</span>
              </Link>
            ))}
          </div>
        ))}

        <div className="rd-flyout__group">
          <div className="rd-flyout__group-label">Appearance</div>
          <button
            type="button"
            className="rd-flyout__row rd-flyout__row--button"
            onClick={() => toggle()}
            aria-label={mounted ? `Switch to ${theme === "light" ? "dark" : "light"} mode` : "Toggle theme"}
          >
            <MiniIcon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            <span className="rd-flyout__row-label">
              {mounted ? (theme === "light" ? "Dark mode" : "Light mode") : "Theme"}
            </span>
          </button>
          <Link
            href="/theme"
            className={`rd-flyout__row${isActivePage("/theme") ? " is-active" : ""}`}
          >
            <MiniIcon d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z" />
            <span className="rd-flyout__row-label">Theme settings</span>
          </Link>
        </div>

        <div className="rd-flyout__group">
          <div className="rd-flyout__group-label">Session</div>
          <button
            type="button"
            className="rd-flyout__row rd-flyout__row--button rd-flyout__row--danger"
            onClick={() => void logout()}
          >
            <MiniIcon
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
              d2="M16 17l5-5-5-5M21 12H9"
            />
            <span className="rd-flyout__row-label">Log out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

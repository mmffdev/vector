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

  // Admin pages are split into three groups by tag_enum. Mig 191 collapsed
  // the legacy single admin_settings tag + URL-prefix partitioning into
  // three regular pages_tags rows (workspace_admin, user_admin, vector_admin).
  // personal_settings tag is handled separately (account-settings link).
  const adminGroups = useMemo(() => {
    const wsAdmin = catalogue
      .filter((e) => e.tagEnum === "workspace_admin")
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    const userMgmt = catalogue
      .filter((e) => e.tagEnum === "user_admin")
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    const vectorAdmin = catalogue
      .filter((e) => e.tagEnum === "vector_admin")
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    return [
      wsAdmin.length    ? { label: "Workspace Admin",  items: wsAdmin }    : null,
      userMgmt.length   ? { label: "User Admin",       items: userMgmt }   : null,
      vectorAdmin.length ? { label: "Vector Admin",    items: vectorAdmin } : null,
    ].filter(Boolean) as { label: string; items: NavCatalogEntry[] }[];
  }, [catalogue]);

  if (!user) return <aside id="nav-primary-rail-2" className="nav-primary-rail-2" aria-label="Account" />;

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside id="nav-primary-rail-2" className="nav-primary-rail-2" aria-label="Account">
      <div className="nav-primary-rail-2__SectionDivider" aria-hidden />
      <div id="nav-primary-rail-2__SectionHeader" className="nav-primary-rail-2__SectionHeader">
        <h3 id="nav-primary-rail-2__SectionHeader_Title" className="nav-primary-rail-2__SectionHeader_Title">Account</h3>
      </div>

      <div id="nav-primary-rail-2__AccountCard" className="nav-primary-rail-2__AccountCard">
        <div className="nav-primary-rail-2__AccountCard_Email">{user.email}</div>
        <div className="nav-primary-rail-2__AccountCard_Role">{user.role.label}</div>
      </div>

      <div id="nav-primary-rail-2__PageList" className="nav-primary-rail-2__PageList">
        {adminGroups.map(({ label, items }) => (
          <div key={label} className="nav-primary-rail-2__PageList_Group">
            <div className="nav-primary-rail-2__PageList_Group_Label">{label}</div>
            {items.map((entry) => (
              <Link
                key={entry.key}
                href={entry.href}
                className={`nav-primary-rail-2__PageList_Group_Row${isActivePage(entry.href) ? " is-active" : ""}`}
                aria-current={isActivePage(entry.href) ? "page" : undefined}
              >
                <IconFor iconKey={entry.icon} />
                <span className="nav-primary-rail-2__PageList_Group_Row_Label">{entry.label}</span>
              </Link>
            ))}
          </div>
        ))}

        <div className="nav-primary-rail-2__PageList_Group">
          <div className="nav-primary-rail-2__PageList_Group_Label">Appearance</div>
          <button
            type="button"
            className="nav-primary-rail-2__PageList_Group_Row nav-primary-rail-2__PageList_Group_Row-button"
            onClick={() => toggle()}
            aria-label={mounted ? `Switch to ${theme === "light" ? "dark" : "light"} mode` : "Toggle theme"}
          >
            <MiniIcon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            <span className="nav-primary-rail-2__PageList_Group_Row_Label">
              {mounted ? (theme === "light" ? "Dark mode" : "Light mode") : "Theme"}
            </span>
          </button>
          <Link
            href="/theme"
            className={`nav-primary-rail-2__PageList_Group_Row${isActivePage("/theme") ? " is-active" : ""}`}
          >
            <MiniIcon d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z" />
            <span className="nav-primary-rail-2__PageList_Group_Row_Label">Theme settings</span>
          </Link>
        </div>

        <div className="nav-primary-rail-2__PageList_Group">
          <div className="nav-primary-rail-2__PageList_Group_Label">Session</div>
          <button
            type="button"
            className="nav-primary-rail-2__PageList_Group_Row nav-primary-rail-2__PageList_Group_Row-button nav-primary-rail-2__PageList_Group_Row-danger"
            onClick={() => void logout()}
          >
            <MiniIcon
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
              d2="M16 17l5-5-5-5M21 12H9"
            />
            <span className="nav-primary-rail-2__PageList_Group_Row_Label">Log out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

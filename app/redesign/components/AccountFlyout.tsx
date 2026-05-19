"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
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
  const { catalogue } = useNavPrefs();
  const { theme, toggle, mounted } = useTheme();
  const pathname = usePathname() ?? "";

  // Avatar Menu pages only. The earlier mig-191/192 sweep promoted
  // Workspace Admin / User Management / Vector Admin to first-class
  // rail-1 buckets, so the avatar flyout should ONLY render its own
  // avatar_menu tree (Account Settings, Navigation, Themes) plus the
  // static Appearance + Session blocks below.
  const avatarMenuPages = useMemo(() => {
    return catalogue
      .filter((e) => e.tagEnum === "avatar_menu")
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
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
        {avatarMenuPages.length > 0 && (
          <div className="nav-primary-rail-2__PageList_Group">
            {avatarMenuPages.map((entry) => (
              <div
                key={entry.key}
                className={`nav-primary-rail-2__PageList_Group_Row${isActivePage(entry.href) ? " is-active" : ""}`}
              >
                <Link
                  href={entry.href}
                  className="nav-primary-rail-2__PageList_Group_Row_Link"
                  aria-current={isActivePage(entry.href) ? "page" : undefined}
                >
                  <span className="nav-primary-rail-2__PageList_Group_Row_Icon">
                    <IconFor iconKey={entry.icon} />
                  </span>
                  <span className="nav-primary-rail-2__PageList_Group_Row_Label">{entry.label}</span>
                </Link>
              </div>
            ))}
          </div>
        )}

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

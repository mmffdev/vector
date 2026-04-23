"use client";

import { usePageHeaderState } from "@/app/contexts/PageHeaderContext";
import { useTheme } from "@/app/hooks/useTheme";
import { useAuth, type Role } from "@/app/contexts/AuthContext";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import { toTitleCase } from "@/app/lib/titleCase";

const roleLabels: Record<Role, string> = {
  user: "USER",
  padmin: "PADMIN",
  gadmin: "GADMIN",
};

export default function PageHeaderBar() {
  const header = usePageHeaderState();
  const { theme, toggle, mounted } = useTheme();
  const { user } = useAuth();

  return (
    <header className="page-header">
      <div className="page-header__left">
        <h1 className="page-header__title">
          Vector <span className="prefix prefix-pink">+</span> {header?.title ? toTitleCase(header.title) : null}
        </h1>
        {header?.breadcrumbs && <div className="page-header__breadcrumbs">{header.breadcrumbs}</div>}
      </div>

      <div className="page-header__actions">
        {header?.actions}

        {user && (
          <span className="role-badge" title="Your role (read-only)">
            {roleLabels[user.role]}
          </span>
        )}

        <button className="app-header-wrapper__icon-btn" title="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        <button className="app-header-wrapper__icon-btn" title="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button className="app-header-wrapper__icon-btn" title="Help" aria-label="Help">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>

        {mounted && (
          <button
            onClick={toggle}
            className="app-header-wrapper__icon-btn"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="19"
                height="19"
                fill={theme === "light" ? "#ffffff" : "#000000"}
                stroke={theme === "light" ? "#000000" : "#ffffff"}
                strokeWidth="1"
              />
              <rect
                x="3.5"
                y="3.5"
                width="13"
                height="13"
                fill={theme === "light" ? "#000000" : "#ffffff"}
              />
            </svg>
          </button>
        )}

        <UserAvatarMenu />
      </div>
    </header>
  );
}

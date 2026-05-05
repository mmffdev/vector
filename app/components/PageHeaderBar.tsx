"use client";

import { usePageHeaderRoot, usePageHeaderState } from "@/app/contexts/PageHeaderContext";
import { useTheme } from "@/app/hooks/useTheme";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import SettingsIconMenu from "@/app/components/SettingsIconMenu";
import EnvBadge from "@/app/components/EnvBadge";
import ProfileBar from "@/app/components/ProfileBar";
import { toTitleCase } from "@/app/lib/titleCase";

export default function PageHeaderBar() {
  // Use the root (bottom-of-stack) header so the bar keeps showing
  // the route the user navigated to even when an embedded subpage
  // pushes its own header on top (e.g. Workspace Settings tabs).
  // Falls back to the top of the stack until the root mounts and
  // honours an explicit barTitle override on either entry.
  const root = usePageHeaderRoot();
  const top = usePageHeaderState();
  const header = root ?? top;
  const { theme, toggle, mounted } = useTheme();

  return (
    <header className="page-header">
      <div className="page-header__left">
        <h1 className="page-header__title">
          Vector <span className="prefix prefix-pink">+</span> {(() => {
            const label = header?.barTitle ?? header?.title;
            return label ? toTitleCase(label) : null;
          })()}
        </h1>
        {header?.breadcrumbs && <div className="page-header__breadcrumbs">{header.breadcrumbs}</div>}
      </div>

      <div className="page-header__center">
        <ProfileBar />
      </div>

      <div className="page-header__actions">
        <button className="btn btn--icon btn--ghost app-header-wrapper__icon-btn" title="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        <SettingsIconMenu />

        <button className="btn btn--icon btn--ghost app-header-wrapper__icon-btn" title="Help" aria-label="Help">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>

        {mounted && (
          <button
            onClick={toggle}
            className="btn btn--icon btn--ghost app-header-wrapper__icon-btn"
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

        <EnvBadge />

        <UserAvatarMenu />
      </div>
    </header>
  );
}

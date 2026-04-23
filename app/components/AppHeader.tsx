"use client";

import { useTheme } from "@/app/hooks/useTheme";
import { useAuth, type Role } from "@/app/contexts/AuthContext";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import SettingsIconMenu from "@/app/components/SettingsIconMenu";

const roleLabels: Record<Role, string> = {
  user: "USER",
  padmin: "PADMIN",
  gadmin: "GADMIN",
};

export default function AppHeader() {
  const { theme, toggle, mounted } = useTheme();
  const { user } = useAuth();

  return (
    <header className={`app-header-wrapper app-header-wrapper--role-${user?.role ?? "user"}`}>
      <div className="app-header-wrapper__center">
        {user && (
          <span className="role-badge" title="Your role (read-only)">
            {roleLabels[user.role]}
          </span>
        )}
      </div>

      <div className="app-header-wrapper__actions">
        {/* Notifications */}
        <button className="app-header-wrapper__icon-btn" title="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="app-header-wrapper__badge">3+</span>
        </button>

        <SettingsIconMenu />

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={toggle}
            className="app-header-wrapper__icon-btn"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        )}

        <UserAvatarMenu />
      </div>
    </header>
  );
}

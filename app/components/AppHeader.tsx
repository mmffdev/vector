"use client";

import { useTheme } from "@/app/hooks/useTheme";
import { useAuth } from "@/app/contexts/AuthContext";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import SettingsIconMenu from "@/app/components/SettingsIconMenu";
import LibraryReleaseBadge from "@/app/components/LibraryReleaseBadge";

export default function AppHeader() {
  const { theme, toggle, mounted } = useTheme();
  const { user } = useAuth();

  return (
    <header className={`app-header-wrapper app-header-wrapper--role-${user?.role.code ?? "user"}`}>
      <div className="app-header-wrapper__center">
        {user && (
          <span className="role-badge" title="Your role (read-only)">
            {user.role.label.toUpperCase()}
          </span>
        )}
      </div>

      <div className="app-header-wrapper__actions">
        {/* Library release notifications — gadmin-only badge, bell-only for others */}
        <LibraryReleaseBadge />

        <SettingsIconMenu />

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={toggle}
            className="btn btn--icon btn--ghost app-header-wrapper__icon-btn"
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

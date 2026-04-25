"use client";

import { useTheme } from "@/app/hooks/useTheme";
import { useAuth, type Role } from "@/app/contexts/AuthContext";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import SettingsIconMenu from "@/app/components/SettingsIconMenu";
import LibraryReleaseBadge from "@/app/components/LibraryReleaseBadge";

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
        {/* Library release notifications — gadmin-only badge, bell-only for others */}
        <LibraryReleaseBadge />

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

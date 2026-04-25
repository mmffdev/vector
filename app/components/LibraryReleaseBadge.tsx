"use client";

/**
 * LibraryReleaseBadge — header notification icon for the mmff_library
 * release-notification channel (Phase 3, plan §12).
 *
 * Renders the bell icon for everyone; gadmins see a numeric badge driven
 * by LibraryReleasesContext (single shared poll). Click navigates to
 * /library-releases.
 */

import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { useLibraryReleases } from "@/app/contexts/LibraryReleasesContext";

export default function LibraryReleaseBadge() {
  const { user } = useAuth();
  const { count } = useLibraryReleases();

  const isGAdmin = user?.role === "gadmin";

  if (!isGAdmin) {
    return (
      <button className="app-header-wrapper__icon-btn" title="Notifications">
        <BellIcon />
      </button>
    );
  }

  return (
    <Link
      href="/library-releases"
      className="app-header-wrapper__icon-btn"
      title={count && count > 0 ? `${count} library release${count === 1 ? "" : "s"} to acknowledge` : "Library releases"}
    >
      <BellIcon />
      {count !== null && count > 0 && (
        <span className="app-header-wrapper__badge">
          {count > 9 ? "9+" : String(count)}
        </span>
      )}
    </Link>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

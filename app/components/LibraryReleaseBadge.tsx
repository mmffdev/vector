"use client";

/**
 * LibraryReleaseBadge — header notification icon for the mmff_library
 * release-notification channel (Phase 3, plan §12).
 *
 * Renders the bell icon for everyone, but only polls the count
 * endpoint and shows the badge for gadmins (plan §12: only the group
 * admin acts on releases). Polls every 5 minutes — matches the
 * reconciler's cache TTL so the badge stays in step without hammering
 * the backend.
 *
 * Click navigates to /library-releases.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

type CountResponse = {
  count: number;
  fresh: boolean;
};

const POLL_MS = 5 * 60 * 1000;

export default function LibraryReleaseBadge() {
  const { user } = useAuth();
  const [count, setCount] = useState<number | null>(null);

  const isGAdmin = user?.role === "gadmin";

  useEffect(() => {
    if (!isGAdmin) return;
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const data = await api<CountResponse>("/api/library/releases/count");
        if (!cancelled) setCount(data.count);
      } catch (err) {
        // 401/403 means session not yet established — leave badge blank.
        if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) {
          // log only — badge degrades to "no count" on transient errors
          console.warn("library releases count failed:", err);
        }
      }
    };

    void fetchCount();
    const id = window.setInterval(fetchCount, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isGAdmin]);

  // Non-gadmin: show the bell but no badge, no link (kept for visual parity).
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Globe, LogOut, Pencil, Settings } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import { TravelIndicator, useTravelIndicator } from "./nav_travel_indicator";
import { notifications } from "@/app/lib/apiSite";

// 60s polling fallback — real-time wire-up via useNotificationsStream
// is deferred (handover_rmq.md § stubs). Bell still updates within a
// minute without it.
const UNREAD_POLL_MS = 60_000;

export default function IconRail() {
  const { sections, accountSection, activeSectionId, setActiveSectionId, isScopeOpen, toggleScopeOpen, isDebugOpen, toggleDebugOpen } = useShell();
  const { user, logout } = useAuth();
  const router = useRouter();
  const accountActive = activeSectionId === ACCOUNT_SECTION_ID;
  const initials = user ? user.email.slice(0, 2).toUpperCase() : "??";

  // Bell unread-count poll. Silent on errors — the count is non-critical UI.
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(async () => {
    try {
      const res = await notifications.unreadCount();
      setUnread(res.unread);
    } catch {
      // Silent — keeps the rail working when the backend is down.
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const id = window.setInterval(refreshUnread, UNREAD_POLL_MS);
    // Cross-component refresh signal — other surfaces (inbox page,
    // toast host) dispatch `notifications:changed` after mark-read /
    // mark-all-read so the bell badge updates immediately instead of
    // waiting up to 60s for the next poll cycle.
    const onChanged = () => refreshUnread();
    window.addEventListener("notifications:changed", onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("notifications:changed", onChanged);
    };
  }, [user, refreshUnread]);

  const listRef = useRef<HTMLUListElement>(null);
  const { indicator, phase, setTarget } = useTravelIndicator(
    listRef,
    accountActive ? null : activeSectionId,
    { inset: 8 },
  );

  return (
    <nav className="rail-1" aria-label="Primary navigation rail">
      <div className="rail-1__header header-band">
        <button
          type="button"
          className={`rail-1__brand${isDebugOpen ? " is-debug-open" : ""}`}
          aria-label="Toggle debug panel"
          aria-pressed={isDebugOpen}
          onClick={toggleDebugOpen}
        >
          <img src="/logo-vector.png" alt="Vector" className="rail-1__brand_logo" />
        </button>
      </div>

      <div className="rail-1__content">
        <div className="rail-1__top">
          <button
            type="button"
            className={`rail-1__nav-btn${isScopeOpen ? " is-active" : ""}`}
            title="Workspace scope"
            aria-label="Toggle workspace scope"
            aria-pressed={isScopeOpen}
            onClick={toggleScopeOpen}
          >
            <Globe size={20} strokeWidth={1.75} />
            <span className="rail-1__nav-btn_label">Workspace</span>
          </button>

          <ul className="rail-1__nav" ref={listRef}>
            <TravelIndicator id="rail-1__nav_travel-indicator" indicator={indicator} phase={phase} />
            {sections.map((s) => {
              const active = s.id === activeSectionId;
              return (
                <li key={s.id} className="rail-1__nav_item">
                  <button
                    ref={(el) => setTarget(s.id, el)}
                    type="button"
                    className={`rail-1__nav-btn${active ? " is-active" : ""}`}
                    title={s.name}
                    aria-label={s.name}
                    aria-pressed={active}
                    onClick={() => {
                      setActiveSectionId(s.id);
                      const first = s.pages[0]?.href;
                      if (first) router.push(first);
                    }}
                  >
                    <NavIcon iconKey={s.icon} />
                    <span className="rail-1__nav-btn_label">{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rail-1__bottom">
          <Link
            href="/user/navigation"
            className="rail-1__util-btn"
            title="Edit navigation"
            aria-label="Edit navigation"
          >
            <Pencil size={18} strokeWidth={1.75} />
          </Link>
          <Link
            href="/dev/research"
            className="rail-1__util-btn"
            title="Dev Tools"
            aria-label="Dev Tools"
          >
            <Settings size={20} strokeWidth={1.75} />
          </Link>
          <button
            type="button"
            className="rail-1__util-btn rail-1__util-btn-bell"
            title={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          >
            <Bell size={20} strokeWidth={1.75} />
            {unread > 0 && (
              <span className="rail-1__util-btn-bell_badge" aria-hidden="true">
                {unread > 99 ? "100+" : unread}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`rail-1__user-btn${accountActive ? " is-active" : ""}`}
            title={user ? `Account — ${user.email}` : "Account"}
            aria-label="Account"
            aria-pressed={accountActive}
            onClick={() => {
              setActiveSectionId(ACCOUNT_SECTION_ID);
              const first = accountSection?.pages[0]?.href;
              if (first) router.push(first);
            }}
          >
            {initials}
          </button>
          <button
            type="button"
            className="rail-1__util-btn"
            title="Log out"
            aria-label="Log out"
            onClick={() => void logout()}
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </nav>
  );
}

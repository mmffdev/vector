"use client";

import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, Globe, Pencil, Settings } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import { TravelIndicator, useTravelIndicator } from "./nav_travel_indicator";

export default function IconRail() {
  const { sections, activeSectionId, setActiveSectionId, isScopeOpen, toggleScopeOpen, isDebugOpen, toggleDebugOpen } = useShell();
  const { user } = useAuth();
  const router = useRouter();
  const accountActive = activeSectionId === ACCOUNT_SECTION_ID;
  const initials = user ? user.email.slice(0, 2).toUpperCase() : "??";

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
            href="/preferences/navigation"
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
            className="rail-1__util-btn"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={20} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={`rail-1__user-btn${accountActive ? " is-active" : ""}`}
            title={user ? `Account — ${user.email}` : "Account"}
            aria-label="Account"
            aria-pressed={accountActive}
            onClick={() => setActiveSectionId(ACCOUNT_SECTION_ID)}
          >
            {initials}
          </button>
        </div>
      </div>
    </nav>
  );
}

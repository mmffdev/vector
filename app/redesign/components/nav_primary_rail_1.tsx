"use client";

import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, Pencil, Settings } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import ProfilePillStack from "./nav_primary_rail_1_NavProfilePillStack";
import { TravelIndicator, useTravelIndicator } from "./nav_travel_indicator";

export default function IconRail() {
  const { sections, activeSectionId, setActiveSectionId } = useShell();
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
    <nav id="nav-primary-rail-1" className="nav-primary-rail-1" aria-label="Primary navigation rail">
      <Link
        id="nav-primary-rail-1__brand"
        href="/dev"
        className="nav-primary-rail-1__brand"
        aria-label="Vector home (dev)"
      >
        <img
          src="/logo-vector.png"
          alt="Vector"
          className="nav-primary-rail-1__brand_logo"
        />
      </Link>

      <div id="nav-primary-rail-1__ProfileStack" className="nav-primary-rail-1__ProfileStack">
        <ProfilePillStack />
      </div>

      <div id="nav-primary-rail-1__divider" className="nav-primary-rail-1__divider" aria-hidden />

      <ul id="nav-primary-rail-1__NavBuckets" className="nav-primary-rail-1__NavBuckets" ref={listRef}>
        <TravelIndicator id="nav-primary-rail-1__NavBuckets_TravelIndicator" indicator={indicator} phase={phase} />
        {sections.map((s) => {
          const active = s.id === activeSectionId;
          return (
            <li key={s.id} id={`nav-primary-rail-1__NavBuckets_Items-${s.id}`} className="nav-primary-rail-1__NavBuckets_Items">
              <button
                id={`nav-primary-rail-1__NavBuckets_Items_Button-${s.id}`}
                ref={(el) => setTarget(s.id, el)}
                type="button"
                className={`nav-primary-rail-1__NavBuckets_Items_Button${active ? " is-active" : ""}`}
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
                <span className="nav-primary-rail-1__NavBuckets_Items_Button_Label">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div id="nav-primary-rail-1__Util" className="nav-primary-rail-1__Util">
        <Link
          id="nav-primary-rail-1__Util_Button-edit"
          href="/preferences/navigation"
          className="nav-primary-rail-1__Util_Button"
          title="Edit navigation"
          aria-label="Edit navigation"
        >
          <Pencil size={18} strokeWidth={1.75} />
        </Link>
        <Link
          id="nav-primary-rail-1__Util_Button-settings"
          href="/dev/research"
          className="nav-primary-rail-1__Util_Button"
          title="Dev Tools"
          aria-label="Dev Tools"
        >
          <Settings size={20} strokeWidth={1.75} />
        </Link>
        <button
          id="nav-primary-rail-1__Util_Button-notifications"
          type="button"
          className="nav-primary-rail-1__Util_Button"
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={20} strokeWidth={1.75} />
        </button>
        <button
          id="nav-primary-rail-1__Util_UserAccount"
          type="button"
          className={`nav-primary-rail-1__Util_UserAccount${accountActive ? " is-active" : ""}`}
          title={user ? `Account — ${user.email}` : "Account"}
          aria-label="Account"
          aria-pressed={accountActive}
          onClick={() => setActiveSectionId(ACCOUNT_SECTION_ID)}
        >
          {initials}
          {accountActive && <span id="nav-primary-rail-1__Util_UserAccount_Indicator" className="nav-primary-rail-1__Util_UserAccount_Indicator" aria-hidden />}
        </button>
      </div>
    </nav>
  );
}

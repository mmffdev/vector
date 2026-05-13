"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Pencil, Settings } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import ProfilePillStack from "./nav_primary_rail_1_NavProfilePillStack";

type IndicatorPhase = "idle" | "stretch" | "settle";

interface IndicatorBox {
  top: number;
  height: number;
}

export default function IconRail() {
  const { sections, activeSectionId, setActiveSectionId } = useShell();
  const { user } = useAuth();
  const router = useRouter();
  const accountActive = activeSectionId === ACCOUNT_SECTION_ID;
  const initials = user ? user.email.slice(0, 2).toUpperCase() : "??";

  const listRef = useRef<HTMLUListElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null);
  const [phase, setPhase] = useState<IndicatorPhase>("idle");
  const settleTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (accountActive) {
      setIndicator(null);
      setPhase("idle");
      return;
    }

    const target = buttonRefs.current.get(activeSectionId);
    const list = listRef.current;
    if (!target || !list) return;

    const INSET = 8;
    const newBox: IndicatorBox = {
      top: target.offsetTop + INSET,
      height: target.offsetHeight - INSET * 2,
    };

    if (indicator === null) {
      setIndicator(newBox);
      setPhase("idle");
      return;
    }

    const oldTop = indicator.top;
    const oldBottom = indicator.top + indicator.height;
    const newTop = newBox.top;
    const newBottom = newBox.top + newBox.height;

    const bridgeTop = Math.min(oldTop, newTop);
    const bridgeBottom = Math.max(oldBottom, newBottom);

    setIndicator({ top: bridgeTop, height: bridgeBottom - bridgeTop });
    setPhase("stretch");

    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      setIndicator(newBox);
      setPhase("settle");
    }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId, accountActive]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  return (
    <nav id="nav-primary-rail-1" className="nav-primary-rail-1" aria-label="Primary navigation rail">
      <Link
        id="nav-primary-rail-1__brand"
        href="/dev"
        className="nav-primary-rail-1__brand"
        aria-label="Vector home (dev)"
      >
        V
      </Link>

      <div id="nav-primary-rail-1__ProfileStack" className="nav-primary-rail-1__ProfileStack">
        <ProfilePillStack />
      </div>

      <div id="nav-primary-rail-1__divider" className="nav-primary-rail-1__divider" aria-hidden />

      <ul id="nav-primary-rail-1__NavBuckets" className="nav-primary-rail-1__NavBuckets" ref={listRef} style={{ border: "3px solid red" }}>
        {indicator && !accountActive && (
          <span
            id="nav-primary-rail-1__NavBuckets_TravelIndicator"
            className={`nav-primary-rail-1__NavBuckets_TravelIndicator nav-primary-rail-1__NavBuckets_TravelIndicator-${phase}`}
            style={{ top: indicator.top, height: indicator.height, border: "3px solid blue" }}
            aria-hidden
          />
        )}
        {sections.map((s, i) => {
          const active = s.id === activeSectionId;
          const debugColours = ["orange", "green", "hotpink", "teal", "gold", "tomato"];
          const debugColour = debugColours[i % debugColours.length];
          return (
            <li key={s.id} id={`nav-primary-rail-1__NavBuckets_Items-${s.id}`} className="nav-primary-rail-1__NavBuckets_Items" style={{ border: `3px solid ${debugColour}` }}>
              <button
                id={`nav-primary-rail-1__NavBuckets_Items_Button-${s.id}`}
                ref={(el) => {
                  if (el) buttonRefs.current.set(s.id, el);
                  else buttonRefs.current.delete(s.id);
                }}
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
                <span className="nav-primary-rail-1__NavBuckets_Items_Button_Label" style={{ border: "3px solid purple" }}>{s.name}</span>
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

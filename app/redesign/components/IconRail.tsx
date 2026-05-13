"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, Pencil } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { useNavOrderedPerspectives } from "../useNavOrderedPerspectives";
import Icon from "./Icon";
import PerspectiveAvatar from "./PerspectiveAvatar";
import EnvBadge from "@/app/components/EnvBadge";

// Travelling indicator phases
//   idle    — bar sits at the active icon's vertical slot
//   stretch — bar extends from previous-active extents to new-target extents
//             (so it visually "bridges" the journey on click)
//   settle  — bar contracts to just the new target, with an elastic ease
type IndicatorPhase = "idle" | "stretch" | "settle";

interface IndicatorBox {
  top: number;
  height: number;
}

export default function IconRail() {
  const { perspective, activeSectionId, setActiveSectionId } = useShell();
  const orderedPerspectives = useNavOrderedPerspectives();
  const { user } = useAuth();
  const accountActive = activeSectionId === ACCOUNT_SECTION_ID;
  const initials = user ? user.email.slice(0, 2).toUpperCase() : "??";
  // Use the NavPrefs-ordered version of the active perspective so the rail
  // honours both role gating and the user's `/preferences/navigation` order.
  const visiblePerspective =
    orderedPerspectives.find((p) => p.id === perspective.id) ?? perspective;

  // Section button refs keyed by section id so we can measure their offsetTop
  // when the active section changes, and animate a single travelling indicator
  // between them.
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null);
  const [phase, setPhase] = useState<IndicatorPhase>("idle");
  const settleTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    // Skip the rail indicator when the account flyout is active — the round
    // user button at the bottom owns its own indicator in that state.
    if (accountActive) {
      setIndicator(null);
      setPhase("idle");
      return;
    }

    const target = buttonRefs.current.get(activeSectionId);
    const list = listRef.current;
    if (!target || !list) return;

    // Match the original .rd-rail__indicator inset (8px top + bottom on the
    // 44px section button) so the bar sits flush with the icon centre rather
    // than overshooting the rounded corners.
    const INSET = 8;
    const newBox: IndicatorBox = {
      top: target.offsetTop + INSET,
      height: target.offsetHeight - INSET * 2,
    };

    if (indicator === null) {
      // First mount / first activation — drop the bar in place without
      // animating from somewhere arbitrary.
      setIndicator(newBox);
      setPhase("idle");
      return;
    }

    // Compute the bridge between old and new extents so the bar visually
    // stretches across the gap before contracting to the target.
    const oldTop = indicator.top;
    const oldBottom = indicator.top + indicator.height;
    const newTop = newBox.top;
    const newBottom = newBox.top + newBox.height;

    const bridgeTop = Math.min(oldTop, newTop);
    const bridgeBottom = Math.max(oldBottom, newBottom);

    setIndicator({ top: bridgeTop, height: bridgeBottom - bridgeTop });
    setPhase("stretch");

    // After the stretch transition completes, snap into settle phase with
    // just the target's dimensions; the elastic easing on .is-settle handles
    // the bounce-in.
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
    <nav className="rd-rail" aria-label="Primary navigation rail">
      <Link
        href="/dev"
        className="rd-rail__brand"
        aria-label="Vector home (dev)"
      >
        V
      </Link>

      <PerspectiveAvatar />

      <div className="rd-rail__divider" aria-hidden />

      <ul className="rd-rail__sections" ref={listRef}>
        {indicator && !accountActive && (
          <span
            className={`rd-rail__travel-indicator rd-rail__travel-indicator--${phase}`}
            style={{ top: indicator.top, height: indicator.height }}
            aria-hidden
          />
        )}
        {visiblePerspective.sections.map((s) => {
          const active = s.id === activeSectionId;
          return (
            <li key={s.id} className="rd-rail__section-item">
              <button
                ref={(el) => {
                  if (el) buttonRefs.current.set(s.id, el);
                  else buttonRefs.current.delete(s.id);
                }}
                type="button"
                className={`rd-rail__section${active ? " is-active" : ""}`}
                title={s.name}
                aria-label={s.name}
                aria-pressed={active}
                onClick={() => setActiveSectionId(s.id)}
              >
                <Icon name={s.icon} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rd-rail__util">
        <Link
          href="/preferences/navigation"
          className="rd-rail__util-btn"
          title="Edit navigation"
          aria-label="Edit navigation"
        >
          <Pencil size={18} strokeWidth={1.75} />
        </Link>
        <div className="rd-rail__util-slot" title="Environment">
          <EnvBadge />
        </div>
        <button type="button" className="rd-rail__util-btn" title="Notifications" aria-label="Notifications">
          <Bell size={20} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={`rd-rail__user${accountActive ? " is-active" : ""}`}
          title={user ? `Account — ${user.email}` : "Account"}
          aria-label="Account"
          aria-pressed={accountActive}
          onClick={() => setActiveSectionId(ACCOUNT_SECTION_ID)}
        >
          {initials}
          {accountActive && <span className="rd-rail__indicator" aria-hidden />}
        </button>
      </div>
    </nav>
  );
}

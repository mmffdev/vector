"use client";

import Link from "next/link";
import { Bell, Pencil } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell, ACCOUNT_SECTION_ID } from "../ShellContext";
import { useNavOrderedPerspectives } from "../useNavOrderedPerspectives";
import Icon from "./Icon";
import PerspectiveAvatar from "./PerspectiveAvatar";
import EnvBadge from "@/app/components/EnvBadge";

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

      <ul className="rd-rail__sections">
        {visiblePerspective.sections.map((s) => {
          const active = s.id === activeSectionId;
          return (
            <li key={s.id} className="rd-rail__section-item">
              <button
                type="button"
                className={`rd-rail__section${active ? " is-active" : ""}`}
                title={s.name}
                aria-label={s.name}
                aria-pressed={active}
                onClick={() => setActiveSectionId(s.id)}
              >
                <Icon name={s.icon} />
                {active && <span className="rd-rail__indicator" aria-hidden />}
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

"use client";

import Link from "next/link";
import { Bell, Settings, UserCircle } from "lucide-react";
import { useShell } from "../ShellContext";
import { perspectiveHomeHref } from "@/app/lib/nav-v2";
import Icon from "./Icon";
import PerspectiveAvatar from "./PerspectiveAvatar";

export default function IconRail() {
  const { perspective, activeSectionId, setActiveSectionId } = useShell();

  return (
    <nav className="rd-rail" aria-label="Primary navigation rail">
      <Link
        href={perspectiveHomeHref(perspective)}
        className="rd-rail__brand"
        aria-label="Vector home"
      >
        V
      </Link>

      <PerspectiveAvatar />

      <div className="rd-rail__divider" aria-hidden />

      <ul className="rd-rail__sections">
        {perspective.sections.map((s) => {
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
        <button type="button" className="rd-rail__util-btn" title="Notifications" aria-label="Notifications">
          <Bell size={20} strokeWidth={1.75} />
        </button>
        <button type="button" className="rd-rail__util-btn" title="Settings" aria-label="Settings">
          <Settings size={20} strokeWidth={1.75} />
        </button>
        <button type="button" className="rd-rail__user" title="Account" aria-label="Account">
          <UserCircle size={28} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  );
}

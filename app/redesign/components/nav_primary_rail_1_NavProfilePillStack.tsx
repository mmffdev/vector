"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavPrefs, type NavProfile } from "@/app/contexts/NavPrefsContext";

export default function ProfilePillStack() {
  const { profiles, activeProfileId, setActiveProfile } = useNavPrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const ordered = useMemo(
    () => profiles.slice().sort((a, b) => a.position - b.position),
    [profiles],
  );

  const active = ordered.find((p) => p.id === activeProfileId) ?? ordered[0];
  const others = ordered.filter((p) => p.id !== activeProfileId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  return (
    <div ref={ref} className="profile-pill">
      <button
        type="button"
        className="profile-pill__active"
        title={active.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="profile-pill__label">{profileBadge(active)}</span>
      </button>

      {others.length > 0 && (
        <ul
          className={`profile-pill__menu${open ? " is-open" : ""}`}
          role="listbox"
          aria-label="Switch profile"
        >
          {others.map((p) => (
            <li
              key={p.id}
              className="profile-pill__menu_item"
              role="option"
              aria-selected={false}
            >
              <button
                type="button"
                className="profile-pill__menu_item_pill"
                title={p.label}
                onClick={() => {
                  void setActiveProfile(p.id);
                  setOpen(false);
                }}
              >
                <span className="profile-pill__label">{profileBadge(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function profileBadge(p: NavProfile): string {
  const label = p.label.trim();
  if (!label) return "?";
  const parts = label.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

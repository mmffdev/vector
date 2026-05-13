"use client";

import { useMemo } from "react";
import { useNavPrefs, type NavProfile } from "@/app/contexts/NavPrefsContext";

/**
 * Vertical stack of profile pills at the top of the rail. Each pill switches
 * the active navigation profile (which scopes which customGroups + prefs the
 * rail consumes). Full CRUD lives on /preferences/navigation.
 */
export default function ProfilePillStack() {
  const { profiles, activeProfileId, setActiveProfile } = useNavPrefs();

  const ordered = useMemo(
    () => profiles.slice().sort((a, b) => a.position - b.position),
    [profiles],
  );

  if (ordered.length === 0) return null;

  return (
    <ul
      id="nav-primary-rail-1__ProfileStack_List"
      className="nav-primary-rail-1__ProfileStack_List"
      role="tablist"
      aria-label="Navigation profile"
    >
      {ordered.map((p) => {
        const active = p.id === activeProfileId;
        return (
          <li key={p.id} id={`nav-primary-rail-1__ProfileStack_List_Item-${p.id}`} className="nav-primary-rail-1__ProfileStack_List_Item">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`nav-primary-rail-1__ProfileStack_List_Item_Pill${active ? " is-active" : ""}`}
              title={p.label}
              onClick={() => {
                if (!active) void setActiveProfile(p.id);
              }}
            >
              <span className="nav-primary-rail-1__ProfileStack_List_Item_Pill_Label">
                {profileBadge(p)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Two-character badge: prefer initials of multi-word labels; otherwise the
 * first two letters of the label, upper-cased.
 */
function profileBadge(p: NavProfile): string {
  const label = p.label.trim();
  if (!label) return "?";
  const parts = label.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

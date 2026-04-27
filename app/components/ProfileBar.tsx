"use client";

import { useNavPrefs } from "@/app/contexts/NavPrefsContext";

export default function ProfileBar() {
  const { profiles, activeProfileId, setActiveProfile, loading } = useNavPrefs();

  if (loading || profiles.length === 0) return null;

  const ordered = profiles.slice().sort((a, b) => a.position - b.position);

  return (
    <div className="profile-bar" role="tablist" aria-label="Navigation profiles">
      {ordered.map((p) => {
        const active = p.id === activeProfileId;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`profile-bar__pill ${active ? "active" : ""}`}
            onClick={() => {
              if (!active) void setActiveProfile(p.id);
            }}
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

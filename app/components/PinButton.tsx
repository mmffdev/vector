"use client";

import { useState } from "react";
import { useNavPrefs, type EntityKind } from "@/app/contexts/NavPrefsContext";

interface Props {
  kind: EntityKind;
  id: string;
  label?: string;
}

// PinButton toggles a portfolio or product into the user's Bookmarks
// group in the sidebar. Authoritative state lives on the server; this
// component reads from NavPrefsContext (which already loads /api/nav/prefs)
// so the button reflects the same prefs row that drives the sidebar.
export default function PinButton({ kind, id, label }: Props) {
  const { isBookmarked, bookmark, unbookmark } = useNavPrefs();
  const [busy, setBusy] = useState(false);
  const pinned = isBookmarked(kind, id);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (pinned) await unbookmark(kind, id);
      else await bookmark(kind, id);
    } finally {
      setBusy(false);
    }
  };

  const text = label ?? (pinned ? "Unpin" : "Pin");
  return (
    <button
      type="button"
      className={`btn btn--small btn--ghost pin-button ${pinned ? "pin-button--pinned" : ""}`}
      onClick={onClick}
      disabled={busy}
      aria-pressed={pinned}
      title={pinned ? "Remove from sidebar bookmarks" : "Pin to sidebar bookmarks"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill={pinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 17v5M9 10.76A2 2 0 0 1 8 9V4h8v5a2 2 0 0 1-1 1.76l-1 .58a2 2 0 0 0-1 1.76V17H10v-3.9a2 2 0 0 0-1-1.76z" />
      </svg>
      <span>{text}</span>
    </button>
  );
}

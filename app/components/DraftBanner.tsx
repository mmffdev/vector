"use client";

import { useEffect, useState } from "react";

export interface DraftBannerProps {
  savedAt: string;          // ISO timestamp
  onRestore: () => void;    // copy draft into the form
  onDiscard: () => void;    // delete the draft
}

function humaniseSince(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "earlier";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Banner shown above a form when an unsubmitted draft exists for the
// current user. Restoration is explicit — the form never silently
// overwrites a fresh blank.
export default function DraftBanner({ savedAt, onRestore, onDiscard }: DraftBannerProps) {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="draft-banner" role="status" aria-live="polite">
      <span className="draft-banner__text">
        Restored draft from {humaniseSince(savedAt, now)}.
      </span>
      <div className="draft-banner__actions">
        <button
          type="button"
          className="draft-banner__btn draft-banner__btn--primary"
          onClick={onRestore}
        >
          Restore
        </button>
        <button
          type="button"
          className="draft-banner__btn"
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

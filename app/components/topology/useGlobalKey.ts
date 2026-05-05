"use client";

// PLA-0006/00335 — single keydown subscription used by every overlay
// piece that wants ESC (context menu, edit flyout, move-preview modal,
// page-level overlay close). Keeps the addEventListener / removeEventListener
// pair inside one place so AC #80 (no orphan listeners outside hooks) holds.
//
// Pass `enabled=false` to disable the subscription temporarily without
// changing call-site structure (e.g. the context menu's ESC binding only
// runs while the menu is open).

import { useEffect } from "react";

export function useGlobalKey(
  key: string,
  handler: (e: KeyboardEvent) => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === key) handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, enabled]);
}

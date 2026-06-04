"use client";

import { useEffect, useRef } from "react";
import "../shell.css";
import { ShellProvider, useShell } from "../ShellContext";
import { ViewportSlot } from "@/app/contexts/DomRegistryContext";
import IconRail from "./nav_primary_rail_1";
import SectionFlyout, { ScopeFlyout2 } from "./nav_primary_rail_2";
import AccountFlyout from "./AccountFlyout";
import RedesignTopBar from "./RedesignTopBar";
import StatusBarBottom from "./StatusBarBottom";
import DebugPanel from "./DebugPanel";
// QRCodeTrigger import removed 2026-05-24 when the global trigger
// was hidden. Re-add the import + uncomment the JSX below to unhide.
// Tracked: Vector_Scope.md → CHROME-QR.1.
import NotificationToastHost from "@/app/components/NotificationToastHost";

// Hover-open / hover-close delays for the rail-2 flyout. Open is short
// (snappy reveal) and close is generous (lets the user travel rail-1 →
// rail-2 without the panel collapsing under them).
const RAIL2_OPEN_DELAY_MS = 80;
const RAIL2_CLOSE_DELAY_MS = 220;

function ShellBody({ children }: { children: React.ReactNode }) {
  const {
    isAccountActive,
    isScopeOpen,
    isDebugOpen,
    isRail2Pinned,
    isRail2Visible,
    setRail2Hovered,
  } = useShell();

  // Debounced hover handlers — a single timeout tracks the pending state
  // change. Entering rail-1 or rail-2 cancels a pending close; leaving
  // schedules one. Pinned mode skips all of this so we don't churn
  // context state on every mouse move (rail-2 is already visible).
  const timerRef = useRef<number | null>(null);
  const cancelPending = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const scheduleOpen = () => {
    if (isRail2Pinned) return;
    cancelPending();
    timerRef.current = window.setTimeout(() => setRail2Hovered(true), RAIL2_OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    if (isRail2Pinned) return;
    cancelPending();
    timerRef.current = window.setTimeout(() => setRail2Hovered(false), RAIL2_CLOSE_DELAY_MS);
  };
  useEffect(() => () => cancelPending(), []);

  // ESC closes the hover flyout (doesn't unpin). Pin must be toggled
  // deliberately via the header button. Only mount the listener when
  // we're actually in flyout mode — no need to listen otherwise.
  useEffect(() => {
    if (isRail2Pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRail2Hovered(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRail2Pinned, setRail2Hovered]);

  function rail2() {
    if (isScopeOpen) return <ScopeFlyout2 />;
    if (isAccountActive) return <AccountFlyout />;
    return <SectionFlyout />;
  }

  // Shell modifier classes:
  //   --scope-open    : rail-2 widens to 320px for the workspace tree
  //   --rail2-overlay : rail-2 is in overlay (unpinned) mode → grid track 0
  //   --rail2-visible : rail-2 is currently painting
  // Overlay mode is off when scope or account is open (those are deliberate
  // toggles — content should push right, not get covered by a floating rail).
  const inOverlayMode = !isRail2Pinned && !isScopeOpen && !isAccountActive;
  const shellCls = [
    "rd-shell",
    isScopeOpen ? "rd-shell--scope-open" : null,
    inOverlayMode ? "rd-shell--rail2-overlay" : null,
    isRail2Visible ? "rd-shell--rail2-visible" : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Hover zones — both rails share the same debounce timer so moving the
  // mouse from rail-1 → rail-2 (or vice versa) cancels the pending close.
  // Each rail is wrapped in its own hover-aware div because the two are
  // in different grid tracks (or rail-2 is absolutely positioned in
  // overlay mode) and a single wrapper can't cover both with a single
  // mouseEnter/Leave pair.
  const hoverProps = {
    onMouseEnter: scheduleOpen,
    onMouseLeave: scheduleClose,
    onFocus: scheduleOpen,
    onBlur: scheduleClose,
  };

  return (
    <div className={shellCls}>
      <div className="rd-shell__rail-1-zone" {...hoverProps}>
        <ViewportSlot kind="side_bar"><IconRail /></ViewportSlot>
      </div>
      <div className="rd-shell__rail-2-zone" {...hoverProps}>
        {rail2()}
      </div>
      <main className="rd-shell__main">
        <ViewportSlot kind="header"><RedesignTopBar /></ViewportSlot>
        <ViewportSlot kind="app">
          {isDebugOpen && <DebugPanel />}
          <div className="rd-shell__main-body">{children}</div>
        </ViewportSlot>
        {/* Global QR trigger hidden 2026-05-24 pending design review.
            Re-enable via Vector_Scope.md → CHROME-QR.1 ("unhide the
            global QR trigger"). Import kept so re-enable is one line. */}
        {/* <div className="rd-shell__main_QrAnchor">
          <QRCodeTrigger />
        </div> */}
      </main>
      <footer className="rd-shell__statusbar" role="contentinfo" aria-label="Status bar">
        <StatusBarBottom />
      </footer>
      {/* Live notification toast stack — top-right overlay, lives
          above all other shell chrome. Self-renders nothing when
          there are no toasts; safe to mount unconditionally. */}
      <NotificationToastHost />
    </div>
  );
}

export default function RedesignShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <ShellBody>{children}</ShellBody>
    </ShellProvider>
  );
}

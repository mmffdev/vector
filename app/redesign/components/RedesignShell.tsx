"use client";

import "../shell.css";
import { ShellProvider, useShell } from "../ShellContext";
import { ViewportSlot } from "@/app/contexts/DomRegistryContext";
import IconRail from "./nav_primary_rail_1";
import SectionFlyout, { ScopeFlyout2 } from "./nav_primary_rail_2";
import AccountFlyout from "./AccountFlyout";
import RedesignTopBar from "./RedesignTopBar";
import DebugPanel from "./DebugPanel";
// QRCodeTrigger import removed 2026-05-24 when the global trigger
// was hidden. Re-add the import + uncomment the JSX below to unhide.
// Tracked: Vector_Scope.md → CHROME-QR.1.
import NotificationToastHost from "@/app/components/NotificationToastHost";

function ShellBody({ children }: { children: React.ReactNode }) {
  const { isAccountActive, isScopeOpen, isDebugOpen } = useShell();

  function rail2() {
    if (isScopeOpen) return <ScopeFlyout2 />;
    if (isAccountActive) return <AccountFlyout />;
    return <SectionFlyout />;
  }

  return (
    <div className={`rd-shell${isScopeOpen ? " rd-shell--scope-open" : ""}`}>
      <ViewportSlot kind="side_bar"><IconRail /></ViewportSlot>
      {rail2()}
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

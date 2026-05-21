"use client";

import "../shell.css";
import { ShellProvider, useShell } from "../ShellContext";
import { ViewportSlot } from "@/app/contexts/DomRegistryContext";
import IconRail from "./nav_primary_rail_1";
import SectionFlyout, { ScopeFlyout2 } from "./nav_primary_rail_2";
import AccountFlyout from "./AccountFlyout";
import RedesignTopBar from "./RedesignTopBar";
import DebugPanel from "./DebugPanel";
import QRCodeTrigger from "@/app/components/QRCodeTrigger";
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
        <div className="rd-shell__main_QrAnchor">
          <QRCodeTrigger />
        </div>
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

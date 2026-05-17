"use client";

import "../shell.css";
import { ShellProvider, useShell } from "../ShellContext";
import { ViewportSlot } from "@/app/contexts/DomRegistryContext";
import IconRail from "./nav_primary_rail_1";
import SectionFlyout, { ScopeFlyout2 } from "./nav_primary_rail_2";
import AccountFlyout from "./AccountFlyout";
import RedesignTopBar from "./RedesignTopBar";

function ShellBody({ children }: { children: React.ReactNode }) {
  const { isAccountActive, isScopeOpen } = useShell();

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
          <div className="rd-shell__main-body">{children}</div>
        </ViewportSlot>
      </main>
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

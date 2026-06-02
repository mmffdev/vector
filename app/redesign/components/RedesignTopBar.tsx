"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "../ShellContext";
import { useSentinel } from "@/app/sentinel/useSentinel";
import { PageHeaderContext } from "@/app/contexts/PageHeaderContext";
import ProfilePillStack from "./nav_primary_rail_1_NavProfilePillStack";

export default function RedesignTopBar() {
  const { activeSection, isAccountActive } = useShell();
  const pathname = usePathname() ?? "";
  const headerCtx = useContext(PageHeaderContext);
  const pageHeader = headerCtx?.top ?? null;

  const currentPage = activeSection?.pages.find(
    (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
  );

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? "Vector";

  // Hold the last non-empty title across the pop→push gap. Without this,
  // the title slot would briefly fall back to a URL-derived label (the
  // shell route name) between the outgoing page's PageHeading unmount
  // and the incoming page's mount — which reads as a flash.
  const [stickyTitle, setStickyTitle] = useState<string>("");
  const lastTitleRef = useRef<string>("");
  useEffect(() => {
    if (pageHeader?.title) {
      lastTitleRef.current = pageHeader.title;
      setStickyTitle(pageHeader.title);
    }
  }, [pageHeader?.title]);

  const displayTitle = pageHeader?.title || stickyTitle || currentPage?.name || sectionLabel;

  // Prefix the visible main title with the active sentinel focus node
  // when available: "<Node> + <Title>". Defensive: sentinel may be
  // loading or missing in some tests so fall back to the plain title.
  let displayTitlePrefixed = displayTitle;
  try {
    const sentinel = useSentinel();
    const focusNodeId = sentinel.sentinel_focus_node;
    if (focusNodeId) {
      const activeGrant = sentinel.sentinel_grants.find((g) => g.node_id === focusNodeId) ?? null;
      const nodeDisplay = activeGrant?.label_override ?? activeGrant?.name ?? null;
      if (nodeDisplay) displayTitlePrefixed = `${nodeDisplay} + ${displayTitle}`;
    }
  } catch (e) {
    // ignore — render plain displayTitle
    displayTitlePrefixed = displayTitle;
  }

  return (
    <div className="main_title header-band" role="banner">
      <h1 className="main_title__text">{displayTitlePrefixed}</h1>
      <div className="main_title__actions">
        {pageHeader?.actions}
        <ProfilePillStack />
      </div>
    </div>
  );
}

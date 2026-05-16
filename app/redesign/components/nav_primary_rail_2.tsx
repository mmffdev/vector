"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShell, type ShellPage } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import { TravelIndicator, useTravelIndicator } from "./nav_travel_indicator";

function formatNow(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

export default function SectionFlyout() {
  const { activeSection } = useShell();
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const groupRef = useRef<HTMLDivElement>(null);

  if (!activeSection) return <aside id="nav-primary-rail-2" className="nav-primary-rail-2" aria-label="Section" />;

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Two-pass render: top-level pages (no parent) first, then nested children
  // under their parent's row. Catalogue order already ranks by position.
  const tops = activeSection.pages.filter((p) => p.parentItemKey == null);
  const childrenByParent = new Map<string, ShellPage[]>();
  for (const p of activeSection.pages) {
    if (p.parentItemKey) {
      const arr = childrenByParent.get(p.parentItemKey) ?? [];
      arr.push(p);
      childrenByParent.set(p.parentItemKey, arr);
    }
  }

  // Pick the longest-matching page so nested children win over their parent.
  let activeKey: string | null = null;
  let bestLen = -1;
  for (const p of activeSection.pages) {
    if (isActivePage(p.href) && p.href.length > bestLen) {
      activeKey = p.itemKey;
      bestLen = p.href.length;
    }
  }

  return (
    <SectionFlyoutBody
      activeSection={activeSection}
      tops={tops}
      childrenByParent={childrenByParent}
      isActivePage={isActivePage}
      activeKey={activeKey}
      groupRef={groupRef}
      now={now}
    />
  );
}

function SectionFlyoutBody({
  activeSection,
  tops,
  childrenByParent,
  isActivePage,
  activeKey,
  groupRef,
  now,
}: {
  activeSection: NonNullable<ReturnType<typeof useShell>["activeSection"]>;
  tops: ShellPage[];
  childrenByParent: Map<string, ShellPage[]>;
  isActivePage: (href: string) => boolean;
  activeKey: string | null;
  groupRef: React.RefObject<HTMLDivElement>;
  now: Date;
}) {
  const { indicator, phase, setTarget } = useTravelIndicator(groupRef, activeKey, { inset: 4 });

  return (
    <aside id="nav-primary-rail-2" className="nav-primary-rail-2" aria-label={`${activeSection.name} pages`}>
      <div className="nav-primary-rail-2__SectionDivider" aria-hidden />
      <div id="nav-primary-rail-2__SectionHeader" className="nav-primary-rail-2__SectionHeader">
        <h3 id="nav-primary-rail-2__SectionHeader_Title" className="nav-primary-rail-2__SectionHeader_Title">{activeSection.name}</h3>
        <p id="nav-primary-rail-2__SectionHeader_Clock" className="nav-primary-rail-2__SectionHeader_Clock" aria-live="off">{formatNow(now)}</p>
      </div>

      <div id="nav-primary-rail-2__PageList" className="nav-primary-rail-2__PageList">
        <div
          id="nav-primary-rail-2__PageList_Group"
          className="nav-primary-rail-2__PageList_Group"
          ref={groupRef}
        >
          <TravelIndicator id="nav-primary-rail-2__PageList_Group_TravelIndicator" indicator={indicator} phase={phase} />
          {tops.map((p) => {
            const kids = childrenByParent.get(p.itemKey) ?? [];
            return (
              <div key={p.itemKey}>
                <PageRow page={p} active={isActivePage(p.href)} setRef={setTarget} />
                {kids.map((k) => (
                  <PageRow
                    key={k.itemKey}
                    page={k}
                    active={isActivePage(k.href)}
                    nested
                    setRef={setTarget}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function PageRow({
  page,
  active,
  nested = false,
  setRef,
}: {
  page: ShellPage;
  active: boolean;
  nested?: boolean;
  setRef: (key: string, el: HTMLElement | null) => void;
}) {
  return (
    <Link
      ref={(el) => setRef(page.itemKey, el)}
      href={page.href}
      className={`nav-primary-rail-2__PageList_Group_Row${active ? " is-active" : ""}${nested ? " is-nested" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-primary-rail-2__PageList_Group_Row_Icon">
        <NavIcon iconKey={page.icon} />
      </span>
      <span className="nav-primary-rail-2__PageList_Group_Row_Label">{page.name}</span>
    </Link>
  );
}

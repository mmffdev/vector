"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "../ShellContext";
import { flattenSectionPages } from "@/app/lib/nav-v2";
import { PageHeaderContext } from "@/app/contexts/PageHeaderContext";

export default function RedesignTopBar() {
  const { perspective, activeSection, isAccountActive } = useShell();
  const pathname = usePathname() ?? "";
  const headerCtx = useContext(PageHeaderContext);
  const pageHeader = headerCtx?.top ?? null;

  const currentPage = activeSection
    ? flattenSectionPages(activeSection).find(
        (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
      )
    : undefined;

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? perspective.name;

  return (
    <div className="rd-topbar" role="banner">
      <nav className="rd-topbar__crumbs" aria-label="Breadcrumb">
        <span className="rd-topbar__crumb">Vector</span>
        <span className="rd-topbar__crumb-sep">/</span>
        <span
          className={`rd-topbar__crumb${currentPage ? "" : " rd-topbar__crumb--current"}`}
        >
          {sectionLabel}
        </span>
        {currentPage && (
          <>
            <span className="rd-topbar__crumb-sep">/</span>
            <span className="rd-topbar__crumb rd-topbar__crumb--current">
              {currentPage.name}
            </span>
          </>
        )}
      </nav>
      {pageHeader?.actions && (
        <div className="rd-topbar__actions">{pageHeader.actions}</div>
      )}
    </div>
  );
}

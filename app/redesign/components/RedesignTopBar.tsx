"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "../ShellContext";
import { PageHeaderContext } from "@/app/contexts/PageHeaderContext";
import QRCodeTrigger from "@/app/components/QRCodeTrigger";

export default function RedesignTopBar() {
  const { activeSection, isAccountActive } = useShell();
  const pathname = usePathname() ?? "";
  const headerCtx = useContext(PageHeaderContext);
  const pageHeader = headerCtx?.top ?? null;

  const currentPage = activeSection?.pages.find(
    (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
  );

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? "Vector";

  return (
    <div className="nav-top-bar" role="banner">
      <nav className="nav-top-bar__Breadcrumbs" aria-label="Breadcrumb">
        <span className="nav-top-bar__Breadcrumbs_Crumb">Vector</span>
        <span className="nav-top-bar__Breadcrumbs_Sep">/</span>
        <span
          className={`nav-top-bar__Breadcrumbs_Crumb${currentPage ? "" : " nav-top-bar__Breadcrumbs_Crumb-current"}`}
        >
          {sectionLabel}
        </span>
        {currentPage && (
          <>
            <span className="nav-top-bar__Breadcrumbs_Sep">/</span>
            <span className="nav-top-bar__Breadcrumbs_Crumb nav-top-bar__Breadcrumbs_Crumb-current">
              {currentPage.name}
            </span>
          </>
        )}
      </nav>
      <div className="nav-top-bar__Actions">
        {pageHeader?.actions}
        <QRCodeTrigger />
      </div>
    </div>
  );
}

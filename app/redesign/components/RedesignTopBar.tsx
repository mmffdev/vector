"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useShell } from "../ShellContext";
import { flattenSectionPages } from "@/app/lib/nav-v2";

export default function RedesignTopBar() {
  const { perspective, activeSection, isAccountActive } = useShell();
  const pathname = usePathname() ?? "";

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
      <Link href="#" className="rd-topbar__action" aria-disabled>
        <Plus size={16} strokeWidth={1.75} />
        <span>New</span>
      </Link>
    </div>
  );
}

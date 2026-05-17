"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "../ShellContext";
import { PageHeaderContext } from "@/app/contexts/PageHeaderContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { workspacesApi } from "@/app/lib/workspacesApi";
import { useEffect, useState } from "react";
import ScopePicker from "@/app/components/ScopePicker";

function useWorkspaceName(workspaceId: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) { setName(null); return; }
    workspacesApi.list().then((ws) => {
      const match = ws.find((w) => w.id === workspaceId);
      setName(match?.name ?? null);
    }).catch(() => setName(null));
  }, [workspaceId]);
  return name;
}

export default function RedesignTopBar() {
  const { activeSection, isAccountActive } = useShell();
  const { user } = useAuth();
  const workspaceName = useWorkspaceName(user?.workspace_id ?? null);
  const pathname = usePathname() ?? "";
  const headerCtx = useContext(PageHeaderContext);
  const pageHeader = headerCtx?.top ?? null;

  const currentPage = activeSection?.pages.find(
    (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
  );

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? "Vector";

  return (
    <div className="nav-top-bar" role="banner">
      <ScopePicker />
      {workspaceName && (
        <span className="nav-top-bar__WorkspaceToken" title={`Active workspace: ${workspaceName}`}>
          {workspaceName}
        </span>
      )}
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
      {pageHeader?.actions && (
        <div className="nav-top-bar__Actions">{pageHeader.actions}</div>
      )}
    </div>
  );
}

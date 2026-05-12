"use client";

import { usePageHeader } from "@/app/contexts/PageHeaderContext";

interface PageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  // Override for the top header bar's "Vector + …" label. Defaults
  // to `title`. Useful for tabbed pages where the bar should keep
  // showing the route name while the in-page title row shows the
  // active tab's title.
  barTitle?: string;
}

export default function PageShell({ title, subtitle, children, actions, breadcrumbs, barTitle }: PageShellProps) {
  // The route/leaf labels appear in the top header strip via PageHeaderBar;
  // `actions` is promoted into the strip's action cluster. `subtitle` is no
  // longer rendered — kept on the API for now in case a page wants to surface
  // it elsewhere.
  usePageHeader({ title, subtitle, actions, breadcrumbs, barTitle });
  return (
    <div className="page-body">
      <div className="page-body__inner">
        {children}
      </div>
    </div>
  );
}

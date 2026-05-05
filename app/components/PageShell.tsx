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
  // Title, subtitle and actions are rendered outside the scroll container
  // by PageTitleRow (in UserLayout) so they never scroll with the content.
  usePageHeader({ title, subtitle, actions, breadcrumbs, barTitle });
  return (
    <div className="page-body">
      <div className="page-body__inner">
        {children}
      </div>
    </div>
  );
}

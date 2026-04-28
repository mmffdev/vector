"use client";

import { usePageHeader } from "@/app/contexts/PageHeaderContext";

interface PageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
}

export default function PageShell({ title, subtitle, children, actions, breadcrumbs }: PageShellProps) {
  // Title, subtitle and actions are rendered outside the scroll container
  // by PageTitleRow (in UserLayout) so they never scroll with the content.
  usePageHeader({ title, subtitle, actions, breadcrumbs });
  return (
    <div className="page-body">
      <div className="page-body__inner">
        {children}
      </div>
    </div>
  );
}

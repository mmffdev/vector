"use client";

import { usePageHeader } from "@/app/contexts/PageHeaderContext";

interface PageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
}

export default function PageShell({ title, children, actions, breadcrumbs }: PageShellProps) {
  usePageHeader({ title, actions, breadcrumbs });
  return <div className="page-body">{children}</div>;
}

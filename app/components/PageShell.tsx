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
  // Top app bar still shows the page title (Vector + <title>) plus
  // global tools; pass actions/breadcrumbs through the context so the
  // global bar can render them.
  usePageHeader({ title, actions, breadcrumbs });
  return (
    <div className="page-body">
      <div className="page-body__inner">
        {(title || subtitle || actions) && (
          <header className="page__head">
            <div className="page__head-text">
              {title && <h1 className="page__title">{title}</h1>}
              {subtitle && <p className="page__subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="page__actions">{actions}</div>}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

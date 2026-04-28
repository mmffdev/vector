"use client";

import { usePageHeaderState } from "@/app/contexts/PageHeaderContext";

export default function PageTitleRow() {
  const header = usePageHeaderState();
  if (!header?.title && !header?.subtitle && !header?.actions) return null;
  return (
    <div className="page-title-row">
      <div className="page-title-row__text">
        {header?.title && <h1 className="page__title">{header.title}</h1>}
        {header?.subtitle && <p className="page__subtitle">{header.subtitle}</p>}
      </div>
      {header?.actions && <div className="page__actions">{header.actions}</div>}
    </div>
  );
}

"use client";

import type React from "react";

interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Every leaf `page.tsx` under `app/(user)/**` MUST wrap its body in
 * <PageContent>. This emits a single `.page-content` block that sits as
 * the final sibling inside `.page-body__inner`, *after* any sticky
 * SecondaryNavigation bars rendered by parent layouts.
 *
 * The 32px gap below the last sticky nav bar lives on `.page-content`
 * itself (padding-top), so it scales to any nav depth — L2, L3, L4, … —
 * without per-level CSS rules. Each layout that adds a nav just adds
 * another sticky bar; the page-content wrapper consumes the residual
 * top gap regardless of how many bars stacked above.
 */
export default function PageContent({ children, className }: PageContentProps) {
  return (
    <div className={`page-content${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

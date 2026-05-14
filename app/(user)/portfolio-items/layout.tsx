"use client";

import { StrictRoute } from "@/app/contexts/DomRegistryContext";

export default function PortfolioItemsLayout({ children }: { children: React.ReactNode }) {
  return <StrictRoute>{children}</StrictRoute>;
}

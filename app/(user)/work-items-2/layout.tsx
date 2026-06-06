"use client";

import { StrictRoute } from "@/app/contexts/DomRegistryContext";

export default function WorkItems2Layout({ children }: { children: React.ReactNode }) {
  return <StrictRoute>{children}</StrictRoute>;
}

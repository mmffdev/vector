"use client";

import { usePathname } from "next/navigation";
import { useShell } from "@/app/redesign/ShellContext";

export function usePageTitle(): { sectionLabel: string; pageLabel: string; full: string } {
  const { activeSection, isAccountActive } = useShell();
  const pathname = usePathname() ?? "";

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? "Vector";

  const currentPage = activeSection?.pages.find(
    (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
  );

  const pageLabel = currentPage?.name ?? "";
  const full = pageLabel ? `${sectionLabel} · ${pageLabel}` : sectionLabel;

  return { sectionLabel, pageLabel, full };
}

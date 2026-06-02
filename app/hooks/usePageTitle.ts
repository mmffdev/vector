"use client";

import { usePathname } from "next/navigation";
import { useShell } from "@/app/redesign/ShellContext";
import { useSentinel } from "@/app/sentinel/useSentinel";

// Convert a URL segment like "artefact-types" into a display label
// like "Artefact Types". Used for L3+ leaf pages whose label isn't
// in the nav catalogue (the catalogue only carries top-level pages).
function humanise(seg: string): string {
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function usePageTitle(): { sectionLabel: string; pageLabel: string; leafLabel: string; full: string } {
  const { activeSection, isAccountActive } = useShell();
  const sentinel = useSentinel();
  const pathname = usePathname() ?? "";

  const sectionLabel = isAccountActive ? "Account" : activeSection?.name ?? "Vector";

  const currentPage = activeSection?.pages.find(
    (p) => pathname === p.href || pathname.startsWith(p.href + "/"),
  );

  const pageLabel = currentPage?.name ?? "";

  // Leaf segment beyond the catalogue-matched page. For
  // /workspace-admin/artefacts/artefact-types this strips
  // "artefact-types" and humanises it; for shell-only routes
  // (pathname === page.href) it stays empty.
  let leafLabel = "";
  if (currentPage && pathname !== currentPage.href) {
    const tail = pathname.slice(currentPage.href.length).replace(/^\/+|\/+$/g, "");
    const lastSeg = tail.split("/").pop() ?? "";
    if (lastSeg) leafLabel = humanise(lastSeg);
  }

  // If a sentinel focus node exists, resolve its display name from the
  // grants list and prefix the visible section with "<Node> + <Section>".
  let sectionWithPrefix = sectionLabel;
  try {
    const focusNodeId = sentinel.sentinel_focus_node;
    if (focusNodeId) {
      const activeGrant = sentinel.sentinel_grants.find((g) => g.node_id === focusNodeId) ?? null;
      const nodeDisplay = activeGrant?.label_override ?? activeGrant?.name ?? null;
      if (nodeDisplay) sectionWithPrefix = `${nodeDisplay} + ${sectionLabel}`;
    }
  } catch (e) {
    // Defensive: sentinel may be null/uninitialised in some tests — fall back
    // to the plain sectionLabel when anything goes wrong.
    sectionWithPrefix = sectionLabel;
  }

  const parts = [sectionWithPrefix, pageLabel, leafLabel].filter(Boolean);
  const full = parts.join(" · ");

  return { sectionLabel, pageLabel, leafLabel, full };
}

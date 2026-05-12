"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePageHeaderRoot, usePageHeaderState } from "@/app/contexts/PageHeaderContext";
import { useTheme } from "@/app/hooks/useTheme";
import { useTenantName } from "@/app/contexts/TenantContext";
import UserAvatarMenu from "@/app/components/UserAvatarMenu";
import SettingsIconMenu from "@/app/components/SettingsIconMenu";
import EnvBadge from "@/app/components/EnvBadge";
import ProfileBar from "@/app/components/ProfileBar";
import { toTitleCase } from "@/app/lib/titleCase";

// Friendly labels for URL segments that don't title-case cleanly. Anything
// not in this map falls through to toTitleCase(segment-with-dashes).
const SEGMENT_LABELS: Record<string, string> = {
  "workspace-settings": "Vector Settings",
  "vector-admin": "Vector Admin",
  "workspace_settings": "Workspace Settings",
  "custom-fields": "Custom Fields",
  "portfolio-model": "Portfolio Model",
  "artefact-types": "Artefact Types",
  "flow-states": "Flow States",
  "work-items": "Work Items",
  "api-manager": "API Manager",
  "tenant-details": "Tenant Details",
  "topology-map": "Topology Map",
};

function labelForSegment(seg: string): string {
  if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
  return toTitleCase(seg.replace(/-/g, " "));
}

export default function PageHeaderBar() {
  // Use the root (bottom-of-stack) header so the bar keeps showing
  // the route the user navigated to even when an embedded subpage
  // pushes its own header on top (e.g. Workspace Settings tabs).
  // Falls back to the top of the stack until the root mounts and
  // honours an explicit barTitle override on either entry.
  const root = usePageHeaderRoot();
  const top = usePageHeaderState();
  const header = root ?? top;
  const pathname = usePathname() ?? "/";
  const { theme, toggle, mounted } = useTheme();
  const workspaceName = useTenantName() || "MMFFDev";

  // Build breadcrumb chain: Vector (→ /dashboard) → each path segment.
  // Each segment links to its cumulative path. The final segment is the
  // current location (rendered non-link).
  const rawSegments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string; isCurrent: boolean }[] = [
    { label: "Vector", href: "/dashboard", isCurrent: false },
  ];
  rawSegments.forEach((seg, i) => {
    const href = "/" + rawSegments.slice(0, i + 1).join("/");
    crumbs.push({
      label: labelForSegment(seg),
      href,
      isCurrent: i === rawSegments.length - 1,
    });
  });

  return (
    <header className="page-header">
      <div className="page-header__brand" aria-label="Workspace">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-vector.png" alt="Vector" className="page-header__brand-logo" />
        <div className="page-header__brand-label">
          <small>Agency</small>
          <strong>{workspaceName}</strong>
        </div>
      </div>

      <div className="page-header__left">
        <h1 className="page-header__title">
          {(() => {
            // Chain the route label (from <PageShell barTitle> on the route
            // layout) and the active leaf label (top of header stack) with the
            // pink "+" splitter:  <Route> + <Sub-page>
            // When only a leaf exists, render it on its own.
            const route = root?.barTitle;
            const leaf  = top?.title ?? header?.title;
            const parts: string[] = [];
            if (route && route !== leaf) parts.push(toTitleCase(route));
            if (leaf) parts.push(toTitleCase(leaf));
            return parts.map((p, i) => (
              <span key={i}>
                {i > 0 && <> <span className="prefix prefix-pink">+</span> </>}
                {p}
              </span>
            ));
          })()}
        </h1>
        <div className="page-header__breadcrumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span className="page-header__breadcrumbs__sep">/</span>}
              {c.isCurrent ? (
                <span className="text-link" aria-current="page" style={{ cursor: "default", pointerEvents: "none" }}>
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="text-link">{c.label}</Link>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="page-header__center">
        <ProfileBar />
      </div>

      <div className="page-header__actions">
        {header?.actions && <div className="page-header__page-actions">{header.actions}</div>}
        <button className="btn btn--icon btn--ghost app-header-wrapper__icon-btn" title="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        <SettingsIconMenu />

        <button className="btn btn--icon btn--ghost app-header-wrapper__icon-btn" title="Help" aria-label="Help">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>

        {mounted && (
          <button
            onClick={toggle}
            className="btn btn--icon btn--ghost app-header-wrapper__icon-btn"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="19"
                height="19"
                fill={theme === "light" ? "#ffffff" : "#000000"}
                stroke={theme === "light" ? "#000000" : "#ffffff"}
                strokeWidth="1"
              />
              <rect
                x="3.5"
                y="3.5"
                width="13"
                height="13"
                fill={theme === "light" ? "#000000" : "#ffffff"}
              />
            </svg>
          </button>
        )}

        <EnvBadge />

        <UserAvatarMenu />
      </div>
    </header>
  );
}

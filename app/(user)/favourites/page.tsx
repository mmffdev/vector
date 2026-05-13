"use client";

// /favourites — pinned portfolios, products, and custom pages.
// Each pinned item is a .backlog-row for consistency with /backlog and
// /my-vista. Type labels render as .pill--neutral; empty state uses
// .placeholder.

import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

const PINS: Array<{ kind: "Portfolio" | "Product" | "Page"; name: string; href: string }> = [
  { kind: "Portfolio", name: "MMFF Standard", href: "/portfolio-model" },
  { kind: "Product", name: "Vector Design System", href: "/dev/library" },
  { kind: "Page", name: "Q3 release notes", href: "/p/q3-release" },
];

export default function Favourites() {
  const { full } = usePageTitle();
  const empty = PINS.length === 0;
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Quick access to your pinned items and saved views." />
      <Panel
        name="panel_favourites_header"
        className="page-panel-heading"
        title="Favourites"
        description="Access your pinned items, saved views, and frequently visited pages."
      />
      {empty ? (
        <div className="placeholder">
          <h3 className="placeholder__title">Nothing pinned yet</h3>
          <p className="placeholder__body">
            Pin a portfolio, product, or page to bookmark it here. Look for the
            star icon on any item header.
          </p>
        </div>
      ) : (
        <ul className="backlog-list" aria-label="Pinned items">
          {PINS.map((p) => (
            <li key={`${p.kind}:${p.name}`} className="backlog-row">
              <span className="backlog-row__id">&nbsp;</span>
              <a
                className="backlog-row__title u-ink u-no-decoration"
                href={p.href}
              >
                {p.name}
              </a>
              <span className="pill pill--neutral">{p.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </PageContent>
  );
}

"use client";

// /favourites — pinned portfolios, products, and custom pages.
// Story 00098 restyle: header (28px / --ink-muted) from PageShell.
// Each pinned item is a .backlog-row (surface card on --canvas with
// 1px --border, --radius-md, 14px 20px padding) for consistency
// with /backlog and /my-vista. Type labels render as
// .pill--neutral. Empty state uses .placeholder; no .empty-state,
// no .tag classes, no lime-green.

import PageShell from "@/app/components/PageShell";

const PINS: Array<{ kind: "Portfolio" | "Product" | "Page"; name: string; href: string }> = [
  { kind: "Portfolio", name: "MMFF Standard", href: "/portfolio-model" },
  { kind: "Product", name: "Vector Design System", href: "/dev/library" },
  { kind: "Page", name: "Q3 release notes", href: "/p/q3-release" },
];

export default function Favourites() {
  const empty = PINS.length === 0;
  return (
    <PageShell title="Favourites" subtitle="Your starred items">
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
                className="backlog-row__title"
                href={p.href}
                style={{ color: "var(--ink)", textDecoration: "none" }}
              >
                {p.name}
              </a>
              <span className="pill pill--neutral">{p.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

export interface AnchorNavItem {
  id: string;
  label: string;
  /** Optional indent level (0 = top, 1 = sub-item). Default 0. */
  depth?: number;
}

interface PageAnchorNavProps {
  items: AnchorNavItem[];
  /** CSS selector for the scroll container. Defaults to the nearest
   *  scrollable ancestor (.app-main-column). Pass null to use window. */
  scrollRoot?: string | null;
  /** px from the top of the scroll root at which a heading is considered
   *  "active". Default 120. */
  offsetPx?: number;
}

/**
 * Sticky left-rail table-of-contents.
 * Watches headings via IntersectionObserver and highlights the topmost visible
 * section. Clicking an item smooth-scrolls to that heading.
 *
 * Usage:
 *   <div className="anav-layout">
 *     <PageAnchorNav items={[{ id: "section-a", label: "Section A" }]} />
 *     <div className="anav-content">
 *       <section><h3 id="section-a">Section A</h3>…</section>
 *     </div>
 *   </div>
 */
export default function PageAnchorNav({
  items,
  scrollRoot = ".app-main-column",
  offsetPx = 120,
}: PageAnchorNavProps) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (items.length === 0) return;

    const rootEl = scrollRoot
      ? (document.querySelector(scrollRoot) as HTMLElement | null)
      : null;

    // Track which headings are currently intersecting.
    const visible = new Set<string>();

    const pickActive = () => {
      // Prefer the first item in document order that is visible.
      for (const item of items) {
        if (visible.has(item.id)) { setActive(item.id); return; }
      }
    };

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pickActive();
      },
      {
        root: rootEl,
        // Large bottom margin so a section "enters" well before its heading
        // reaches the top; negative top margin keeps it from activating
        // while still hidden above the fold.
        rootMargin: `-${offsetPx}px 0px -60% 0px`,
        threshold: 0,
      },
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [items, scrollRoot, offsetPx]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="anav" aria-label="Page sections">
      <ul className="anav__list" role="list">
        {items.map((item) => (
          <li key={item.id}>
            {item.depth === 0 ? (
              <p className="sidebar-section">{item.label}</p>
            ) : (
              <button
                type="button"
                className={`sidebar-item${active === item.id ? " active" : ""}`}
                onClick={() => scrollTo(item.id)}
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
